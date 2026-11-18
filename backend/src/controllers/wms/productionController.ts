// MES GIAI ĐOẠN 1 (14/11/2026 — kế hoạch docs/plans/MES_PHASE1_PLAN.md): MẺ CHẾ BIẾN · RÚT NVL · BỒN · TRUY XUẤT SẢN XUẤT.
//   • Kho chế biến = KHO PHỤ NỘI BỘ (Warehouse.parent_warehouse_id) — mẻ chỉ mở được ở kho phụ.
//   • Mọi lệnh ghi chạm ≥ 2 bảng đi qua hàm DB (khoá dòng, một giao dịch) — migration 20261114*.
//   • Lỗi nghiệp vụ từ hàm DB: 'MESERR:<MÃ>|<câu>' ⇒ `mesFail` dịch ra 404 / 422 / 409.
// Quyền: module `production` (view · open_batch · consume · reverse · qa_release · manage_tank · tank_ops · export).
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { db } from '../../lib/supabase'
import { z, zText, zDay } from '../../middlewares/validate'
import { ok, fail, failAny } from '../../utils/response'
import { resolveActorId, resolveActorName } from '../../utils/actor'
import { normalizeQR } from '../../utils/qrParser'
import { qtyIntegerError } from '../../utils/qtyUnits'
import type { Tables, TablesUpdate } from '../../types/database'
import { normalizeBatchCode } from '../../utils/batchCode'
import { normalizeCycle, CYCLE_RE, parseBatchLabel, batchLabelQr } from '../../utils/batchLabel'
import { processBlocksError } from '../../utils/processBlocks'
import { btpUseError } from '../../utils/semiFinished'
import { PRODUCTION_QA_GATES } from '../../utils/putaway'
import { invalidatePutawayConfig } from '../../services/putawayContext'
import { categoryAllowed, scopeCategoriesOf, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'
import { rotationConfigOf } from './outboundController'
import { qaHoldIds } from '../../services/qaStatus'
import { fetchAllRowsParallel } from '../../utils/pagination'
import { computePctDate, type MaterialShelfInfo } from '../../utils/shelfLife'
import {
  rotationSortKey, rotationDateOf, isRotationViolation, isPickEligible, isRotationReason, availableOf, ROTATION_DATE_LABEL, ROTATION_LABEL,
  type RotationEntry, type RotationPrinciple,
} from '../../utils/rotation'
import { vnDayOf, utcMs } from '../../utils/dates'

const nowIso = () => new Date().toISOString()
const scopeOf = (req: Request): string[] | null => (req.user?.warehouse_scope === 'NATIONAL' ? null : (req.user?.warehouse_ids ?? []))
/** Phạm vi của module Sản xuất: kho được giao, HOẶC kho CHA của nó được giao — kho phụ (kho chế biến) là tổ nội bộ của
 *  chính nhà máy đó, người coi nhà máy coi luôn kho chế biến (user chốt 14/11 qua bối cảnh Kho toàn cục = kho nhà máy). */
async function inScope(req: Request, wh: string | null | undefined): Promise<boolean> {
  const s = scopeOf(req)
  if (s === null) return true
  if (!wh) return false
  if (s.includes(wh)) return true
  const { data } = await db.from('Warehouse').select('parent_warehouse_id').eq('id', wh).maybeSingle()
  return !!data?.parent_warehouse_id && s.includes(data.parent_warehouse_id)
}
/** Kho đang lọc + các kho phụ trực thuộc (lọc theo kho nhà máy ⇒ thấy kho chế biến của nó). */
async function withChildren(wh: string): Promise<string[]> {
  const { data } = await db.from('Warehouse').select('id').eq('parent_warehouse_id', wh).limit(300)
  return [wh, ...(data ?? []).map(k => k.id)]
}
/** Mọi kho người gọi được thấy ở module này (được giao + kho phụ của chúng). null = toàn quốc. */
async function scopeWithChildren(req: Request): Promise<string[] | null> {
  const s = scopeOf(req)
  if (s === null || !s.length) return s
  const { data } = await db.from('Warehouse').select('id').in('parent_warehouse_id', s.slice(0, 300)).limit(1000)   // ≤300: phạm vi kho của MỘT người
  return [...new Set([...s, ...(data ?? []).map(k => k.id)])]
}
const SCOPE_MSG = 'Ngoài phạm vi kho được giao'
const jitter = (n: number) => new Promise(r => setTimeout(r, 20 + Math.floor(Math.random() * (60 + n * 40))))
/** Lượng trong bồn giữ tối đa 3 số lẻ (hàm chia theo tỷ lệ làm tròn 3 số lẻ — số lẻ hơn sẽ không chia khớp). */
export const round3 = (n: number) => Math.round(n * 1000) / 1000
const actor = (req: Request) => ({ actor_id: resolveActorId(req), actor_name: resolveActorName(req) })

/** Lỗi nghiệp vụ ném từ hàm DB ('MESERR:MÃ|câu') ⇒ đúng mã HTTP; còn lại để fail() dịch mã Postgres. */
const MES_RE = /MESERR:([A-Z_]+)\|([\s\S]+)$/
function mesFail(res: Response, e: unknown): Response {
  const msg = String((e as { message?: string } | null)?.message ?? '')
  const m = MES_RE.exec(msg)
  if (!m) return failAny(res, e)
  const [, code, text] = m
  const status = code === 'NOT_FOUND' ? 404 : ['QTY', 'REASON', 'UNIT', 'KIND', 'SAME_TANK', 'DUPLICATE', 'SELF', 'NAME', 'MISMATCH', 'RECIPE_MISMATCH', 'RECIPE_INACTIVE', 'CYCLE', 'BATCH_NO', 'TANK', 'NO_PLANT', 'FORM_INVALID',
    'EXPIRED', 'EXPIRED_REJECTED', 'NOT_EXPIRED', 'DECISION', 'SUBJECT', 'KEY', 'TIME', 'TOO_LONG', 'DATE_RANGE', 'WAREHOUSE'].includes(code) ? 422 : 409
  return fail(res, status, `MES_${code}`, text.trim())
}

type BatchRow = { id: string; warehouse_id: string; status: string; material_id: string; batch_code: string; planned_qty: number | null
  cycle: string | null; batch_no: number | null; tank_id: string | null; lead_ok_at: string | null; qa_ok_at: string | null }
async function loadBatch(id: string): Promise<BatchRow | null> {
  const { data } = await db.from('production_batch').select('id, warehouse_id, status, material_id, batch_code, planned_qty, cycle, batch_no, tank_id, lead_ok_at, qa_ok_at').eq('id', id).maybeSingle()
  return (data as BatchRow | null) ?? null
}
/** QA đã duyệt phiếu ⇒ phiếu khoá: muốn sửa định mức / kế hoạch / mã thì QA bỏ duyệt trước (user chốt 17/11). */
const APPROVED_MSG = 'QA đã duyệt phiếu của mẻ — bỏ duyệt rồi mới sửa được'
/** Kho bật "luồng chặt" (Warehouse.mes_flow_gate): chưa đủ hai bước duyệt thì CHƯA cấp nguyên liệu. Một hàm cho cả hai cửa cấp (quét tem · chọn lô). */
async function consumeGateError(b: BatchRow): Promise<string | null> {
  if (b.lead_ok_at && b.qa_ok_at) return null
  const { data: w } = await db.from('Warehouse').select('mes_flow_gate').eq('id', b.warehouse_id).maybeSingle()
  if (!w?.mes_flow_gate) return null
  return !b.lead_ok_at ? 'Trưởng ca chưa duyệt phiếu của mẻ — chưa cấp nguyên liệu được' : 'QA chưa duyệt phiếu của mẻ — chưa cấp nguyên liệu được'
}
type TankRow = { id: string; warehouse_id: string; code: string; unit: string; capacity: number; is_active: boolean }
async function loadTank(id: string): Promise<TankRow | null> {
  const { data } = await db.from('production_tank').select('id, warehouse_id, code, unit, capacity, is_active').eq('id', id).maybeSingle()
  return (data as TankRow | null) ?? null
}
/** Kho chế biến hợp lệ = kho PHỤ nội bộ đang hoạt động. Trả lỗi hoặc null. */
async function productionWhError(whId: string): Promise<string | null> {
  const { data: w } = await db.from('Warehouse').select('id, name, parent_warehouse_id, is_active').eq('id', whId).maybeSingle()
  if (!w) return 'Không tìm thấy kho'
  if (!w.parent_warehouse_id) return `"${w.name}" không phải kho chế biến — khai kho chế biến là kho phụ nội bộ (Cài đặt WMS → Kho → Trực thuộc kho)`
  if (w.is_active === false) return `Kho "${w.name}" đang ngừng hoạt động`
  return null
}

// ═══ MẺ ═════════════════════════════════════════════════════════════════════════════════════════

// GET /wms/production/batches — danh sách mẻ phân trang (dòng + tổng + ô band trong MỘT lời gọi)
export const zBatchListQuery = z.object({
  warehouse_id: zText(1, 64).optional(),
  // tình trạng của mẻ (18/11 — hàm SQL mes_batch_stage, một luật cho dòng · ô tổng · lọc) thay lọc Trạng thái + QA
  stage: z.enum(['new', 'wait_lead', 'wait_qa', 'working', 'filled', 'released', 'rejected', 'cancelled']).optional(),
  date_from: zDay.optional(), date_to: zDay.optional(),
  search: zText(0, 80).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(1).max(1000).optional(),
})
export async function listBatches(req: Request, res: Response) {
  try {
    const q = req.query as unknown as z.infer<typeof zBatchListQuery>
    let whIds: string[]
    if (q.warehouse_id) {
      if (!(await inScope(req, q.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
      whIds = await withChildren(q.warehouse_id)
    } else {
      const s = await scopeWithChildren(req)
      if (s === null) {
        const { data } = await db.from('Warehouse').select('id').not('parent_warehouse_id', 'is', null).limit(1000)
        whIds = (data ?? []).map(w => w.id)
      } else whIds = s
    }
    if (!whIds.length) return ok(res, { rows: [], summary: { total: 0 }, page: 1, page_size: q.pageSize ?? 100 })
    const { data, error } = await db.rpc('mes_batch_page', { p: {
      wh_ids: whIds, stage: q.stage ?? null, date_from: q.date_from ?? null, date_to: q.date_to ?? null,
      search: q.search ?? null, page: q.page ?? 1, page_size: q.pageSize ?? 100,
    } })
    if (error) return fail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// GET /wms/production/batches/next-code — số mẻ kế tiếp của chu kỳ + mã lô sẽ ghép (17/11: <chữ nhà máy><chu kỳ><số mẻ 4 số><mã bồn>)
export const zNextCodeQuery = z.object({ warehouse_id: zText(1, 64), cycle: zText(0, 20).optional(), tank_id: zText(1, 64).optional(), batch_no: z.coerce.number().int().min(1).max(9999).optional() })
export async function nextCode(req: Request, res: Response) {
  try {
    const q = req.query as unknown as z.infer<typeof zNextCodeQuery>
    if (!(await inScope(req, q.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data: plant } = await db.rpc('mes_plant_letter', { p_wh: q.warehouse_id })
    const cycle = normalizeCycle(q.cycle)
    let next_no: number | null = null
    if (CYCLE_RE.test(cycle)) {
      const { data: top } = await db.from('production_batch').select('batch_no').eq('warehouse_id', q.warehouse_id).eq('cycle', cycle)
        .neq('status', 'CANCELLED').not('batch_no', 'is', null).order('batch_no', { ascending: false }).limit(1)
      next_no = Math.min((top?.[0]?.batch_no ?? 0) + 1, 9999)
    }
    const no = q.batch_no ?? next_no
    let code: string | null = null
    if (plant && CYCLE_RE.test(cycle) && no && q.tank_id) {
      const { data: t } = await db.from('production_tank').select('code').eq('id', q.tank_id).maybeSingle()
      if (t) code = `${plant}${cycle}${String(no).padStart(4, '0')}${t.code}`
    }
    return ok(res, { plant: plant || null, cycle, next_no, code })
  } catch (e) { return failAny(res, e) }
}

/** Dòng cấp của mẻ kèm mã + tem (join theo khoá ngoại — kiểu sinh không có quan hệ nên khai tay) */
type ConsJoin = Tables<'batch_consumption'> & {
  material: { material_code: string; short_name: string | null; base_unit: string | null; entry_unit: string | null; units_per_carton: number | null
    shelf_life_days: number | null; supplier_shelf_life_overrides: unknown } | null
  entry: { cartons_remaining: number | null; production_date: string | null; expiry_date: string | null; expiry_calc: string | null
    shelf_life_days: number | null; ncc_id: string | null; location: { location_code: string | null } | null } | null
}
// GET /wms/production/batches/:id — đầu mẻ + NVL đã rút + bồn đã nạp + lần rút cho trang sổ
export async function getBatch(req: Request, res: Response) {
  try {
    const { data: b, error } = await db.from('production_batch')
      .select('*, material:Material!production_batch_material_id_fkey(id, material_code, short_name, base_unit, entry_unit, units_per_carton, category, tank_hold_hours), warehouse:Warehouse!production_batch_warehouse_id_fkey(id, code, name, parent_warehouse_id), recipe:production_recipe!production_batch_recipe_id_fkey(id, name, base_qty, is_active), tank:production_tank!production_batch_tank_id_fkey(id, code, name, capacity, unit)')
      .eq('id', req.params.id).maybeSingle()
    if (error) return fail(res, error)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const [{ data: cons }, { data: moves }, { data: lots }, { data: board }, { data: plogs }, { data: gate }, { data: scans }, { data: expiry }] = await Promise.all([
      db.from('batch_consumption')
        .select('*, material:Material!batch_consumption_material_id_fkey(material_code, short_name, base_unit, entry_unit, units_per_carton, shelf_life_days, supplier_shelf_life_overrides), entry:InventoryEntry!batch_consumption_entry_id_fkey(cartons_remaining, production_date, expiry_date, expiry_calc, shelf_life_days, ncc_id, location:Location(location_code))')
        .eq('batch_id', b.id).order('created_at').limit(2000),
      db.from('tank_movement').select('id, tank_id, kind, qty, packing_run_id, reason, warning, created_by_name, created_at, tank:production_tank!tank_movement_tank_id_fkey(code)')
        .eq('batch_id', b.id).order('created_at').limit(2000),
      db.from('tank_lot').select('id, tank_id, qty_in, qty_remaining, filled_at, expires_at, status, tank:production_tank!tank_lot_tank_id_fkey(code, unit)')
        .eq('batch_id', b.id).order('filled_at').limit(500),
      db.rpc('mes_batch_board', { p_batch_id: b.id }),
      db.from('batch_process_log').select('id, form, data, blocks, stamps, created_by_name, updated_by_name, confirmed_at, confirmed_by_name, updated_at').eq('batch_id', b.id).limit(10),
      db.rpc('mes_batch_gate', { p_batch_id: b.id }),
      db.from('batch_pour_scan').select('pallet_no, scanned_by_name, created_at').eq('batch_id', b.id).eq('label_ver', b.label_ver).order('pallet_no').limit(100),
      // NVL hết hạn: yêu cầu / quyết định QA của mẻ (17/11)
      db.from('mes_expiry_approval').select('id, entry_id, material_id, pallet_code, production_date, batch_lot, expiry_date, status, requested_by_name, requested_at, decided_by_name, decided_at, note, material:Material!mes_expiry_approval_material_id_fkey(material_code, short_name, base_unit, entry_unit, units_per_carton)')
        .eq('batch_id', b.id).order('created_at').limit(500),
    ])
    // tem pallet của mẻ đang hiệu lực (in lại không cần gọi thêm)
    const labels = b.label_at && b.label_count
      ? Array.from({ length: b.label_count }, (_, i) => ({ pallet_no: i + 1, qr: batchLabelQr(b.batch_code, i + 1, b.label_count as number, b.label_ver) })) : []
    // DÒNG MỞ RỘNG của bàn (18/11 — user: "expand sau khi quét xong tương tự bên xuất"): mỗi dòng cấp kèm %Date LÚC CẤP (giờ ghi
    // dòng, cùng computePctDate của "Lấy ở đâu" ⇒ khớp số người cấp thấy khi quét; như pct_date khoá lúc quét của Xuất kho) và
    // HSD hiệu lực (cột expiry_calc — cùng cột cửa cấp dùng chặn hàng hết hạn). Hạn dùng của mã chỉ để tính, không trả về.
    const consumption = ((cons ?? []) as unknown as ConsJoin[]).map(({ material, entry, ...c }) => {
      const shelf = material ? ({ shelf_life_days: material.shelf_life_days, supplier_shelf_life_overrides: material.supplier_shelf_life_overrides } as unknown as MaterialShelfInfo) : null
      const at = utcMs(c.created_at)
      const pct = computePctDate({ production_date: c.production_date ?? entry?.production_date ?? null, expiry_date: entry?.expiry_date ?? null,
        shelf_life_days: entry?.shelf_life_days ?? null, ncc_id: entry?.ncc_id ?? c.ncc_id ?? null }, shelf, Number.isFinite(at) ? at : Date.now())
      return { ...c,
        material: material ? { material_code: material.material_code, short_name: material.short_name, base_unit: material.base_unit, entry_unit: material.entry_unit, units_per_carton: material.units_per_carton } : null,
        entry: entry ? { cartons_remaining: entry.cartons_remaining, expiry_date: entry.expiry_date, location: entry.location } : null,
        pct_date: pct, expiry_date: dayOf(entry?.expiry_calc) }
    })
    return ok(res, { ...b, consumption, movements: moves ?? [], lots: lots ?? [], board: board ?? [], process_logs: plogs ?? [],
      gate: gate ?? null, pour_scans: scans ?? [], labels, expiry_approvals: expiry ?? [] })
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/batches — MỞ MẺ. 17/11: chu kỳ · số mẻ · bồn BẮT BUỘC; mã lô do DB ghép (hàm mes_batch_create khoá bồn,
// kiểm chỗ, sinh mã, ghi mẻ trong một giao dịch). Số mẻ để trống ⇒ số kế tiếp của chu kỳ.
export const zBatchCreate = z.object({
  warehouse_id: zText(1, 64), material_id: zText(1, 64), prod_date: zDay,
  cycle: zText(1, 20), batch_no: z.number().int().min(1).max(9999).optional(), tank_id: zText(1, 64),
  machine_code: zText(0, 20).optional(), shift: zText(0, 40).optional(),
  planned_qty: z.number().positive().max(10_000_000).nullable().optional(), note: zText(0, 500).optional(),
  recipe_id: zText(1, 64).optional(),   // công thức chọn lúc mở (trống = công thức mặc định của mã)
  extra_forms: z.array(zText(1, 20)).max(20).optional(),   // phiếu bổ sung của mẻ (vắng = mặc định theo mã BTP)
})
export async function createBatch(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zBatchCreate>
    if (!(await inScope(req, body.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const whErr = await productionWhError(body.warehouse_id)
    if (whErr) return fail(res, 422, 'NOT_PRODUCTION_WAREHOUSE', whErr)
    const { data: m } = await db.from('Material').select('id, material_code, batch_prefix, base_unit, is_active, is_semi_finished').eq('id', body.material_id).maybeSingle()
    if (!m) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mã bán thành phẩm')
    const btpErr = btpUseError(m)
    if (btpErr) return fail(res, 422, btpErr.code, btpErr.message)
    // công thức chọn lúc mở phải thuộc ĐÚNG mã và đang dùng — kiểm TRƯỚC khi tạo mẻ (không để mẻ ra đời với bàn trống vì chọn sai)
    if (body.recipe_id) {
      const { data: rc } = await db.from('production_recipe').select('id, material_id, name, is_active').eq('id', body.recipe_id).maybeSingle()
      if (!rc || rc.material_id !== m.id) return fail(res, 422, 'MES_RECIPE_MISMATCH', 'Công thức không thuộc mã bán thành phẩm đã chọn')
      if (!rc.is_active) return fail(res, 422, 'MES_RECIPE_INACTIVE', `Công thức "${rc.name}" đã ngừng dùng`)
    }
    const cycle = normalizeCycle(body.cycle)
    if (!CYCLE_RE.test(cycle)) return fail(res, 422, 'MES_CYCLE', 'Chu kỳ gồm 1–6 chữ / số, viết liền')
    const a = actor(req)
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data, error } = await db.rpc('mes_batch_create', { p: {
        warehouse_id: body.warehouse_id, material_id: m.id, prod_date: body.prod_date, cycle, batch_no: body.batch_no ?? null, tank_id: body.tank_id,
        machine_code: body.machine_code ? body.machine_code.toUpperCase() : null, shift: body.shift || null,
        planned_qty: body.planned_qty == null ? null : round3(body.planned_qty), note: body.note || null, ...a,
      } })
      if (!error) {
        const row = data as { id: string }
        // bàn làm việc: chép ĐỊNH MỨC của mã BTP thành yêu cầu nguyên liệu của mẻ (không có định mức ⇒ bàn trống, người mở tự khai)
        const { data: ap, error: apErr } = await db.rpc('mes_batch_apply_recipe', { p: { batch_id: row.id, recipe_id: body.recipe_id ?? null, actor_name: a.actor_name } })
        if (apErr) console.error('[production] apply recipe', apErr.message)
        const { error: fErr } = await db.rpc('mes_batch_set_forms', { p: { batch_id: row.id, ...(body.extra_forms ? { forms: body.extra_forms } : {}) } })
        if (fErr) console.error('[production] set forms', fErr.message)
        return ok(res, { ...row, requirement_count: (ap as { count?: number } | null)?.count ?? 0 }, 201)
      }
      if (error.code !== '23505') return mesFail(res, error)
      if (body.batch_no) return fail(res, 409, 'BATCH_NO_DUP', `Chu kỳ ${cycle} đã có mẻ số ${body.batch_no} — đổi số mẻ hoặc để trống cho app lấy số kế tiếp`)
      await jitter(attempt)   // hai người cùng mở mẻ một lúc ⇒ người sau lấy số kế
    }
    return fail(res, 409, 'BUSY', 'Nhiều người đang mở mẻ cùng lúc — thử lại')
  } catch (e) { return failAny(res, e) }
}

// PATCH /wms/production/batches/:id — sửa mẻ.
//   • Chu kỳ / số mẻ / BỒN (17/11): đổi được tới khi mẻ nạp bồn; mã lô ghép lại theo, tem đã in mất hiệu lực (trả `relabel`).
//   • Mã BTP: chỉ khi mẻ chưa rút NVL và chưa nạp bồn. QA đã duyệt phiếu ⇒ khoá mã / kế hoạch.
export const zBatchUpdate = z.object({
  material_id: zText(1, 64).optional(), prod_date: zDay.optional(),
  cycle: zText(1, 20).optional(), batch_no: z.number().int().min(1).max(9999).optional(), tank_id: zText(1, 64).optional(),
  machine_code: zText(0, 20).nullable().optional(), shift: zText(0, 40).nullable().optional(),
  planned_qty: z.number().positive().max(10_000_000).nullable().optional(), note: zText(0, 500).nullable().optional(),
})
export async function updateBatch(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zBatchUpdate>
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    if (b.status === 'CANCELLED') return fail(res, 409, 'BATCH_CANCELLED', 'Mẻ đã huỷ — không sửa được')
    const patch: TablesUpdate<'production_batch'> = { updated_at: nowIso() }
    if (body.prod_date !== undefined) patch.prod_date = body.prod_date
    if (body.machine_code !== undefined) patch.machine_code = body.machine_code ? body.machine_code.toUpperCase() : null
    if (body.shift !== undefined) patch.shift = body.shift || null
    if (body.note !== undefined) patch.note = body.note || null
    const matChanged = body.material_id !== undefined && body.material_id !== b.material_id
    const planChanged = body.planned_qty !== undefined && (body.planned_qty ?? null) !== (b.planned_qty == null ? null : Number(b.planned_qty))
    if ((matChanged || planChanged) && b.qa_ok_at) return fail(res, 409, 'MES_APPROVED', APPROVED_MSG)
    if (planChanged) patch.planned_qty = body.planned_qty == null ? null : round3(body.planned_qty)
    if (matChanged) {
      const [{ count: nc }, { count: nm }] = await Promise.all([
        db.from('batch_consumption').select('id', { count: 'exact', head: true }).eq('batch_id', b.id).is('reversed_at', null),
        db.from('tank_movement').select('id', { count: 'exact', head: true }).eq('batch_id', b.id),
      ])
      if ((nc ?? 0) > 0 || (nm ?? 0) > 0)
        return fail(res, 409, 'BATCH_LOCKED', 'Mẻ đã có NVL rút vào hoặc đã nạp bồn — không đổi được mã bán thành phẩm (chuỗi truy xuất đã ghi theo mã cũ)')
      const { data: m } = await db.from('Material').select('id, material_code, base_unit, is_active, is_semi_finished').eq('id', body.material_id as string).maybeSingle()
      if (!m) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mã bán thành phẩm')
      const btpErr = btpUseError(m)
      if (btpErr) return fail(res, 422, btpErr.code, btpErr.message)
      patch.material_id = m.id
    }
    // chu kỳ / số mẻ / bồn ⇒ hàm DB khoá bồn, kiểm chỗ, ghép lại mã lô
    const cycle = body.cycle !== undefined ? normalizeCycle(body.cycle) : undefined
    if (cycle !== undefined && !CYCLE_RE.test(cycle)) return fail(res, 422, 'MES_CYCLE', 'Chu kỳ gồm 1–6 chữ / số, viết liền')
    const idChanged = (cycle !== undefined && cycle !== b.cycle) || (body.batch_no !== undefined && body.batch_no !== b.batch_no)
      || (body.tank_id !== undefined && body.tank_id !== b.tank_id)
    const tankId = body.tank_id ?? b.tank_id
    // kế hoạch / mã đổi mà bồn giữ nguyên ⇒ vẫn phải vừa bồn (đổi bồn thì hàm mes_batch_identity tự kiểm)
    if ((planChanged || matChanged) && tankId && !(body.tank_id !== undefined && body.tank_id !== b.tank_id) && b.status === 'OPEN') {
      const { count: nf } = await db.from('tank_movement').select('id', { count: 'exact', head: true }).eq('batch_id', b.id).eq('kind', 'FILL')
      if (!nf) {
        const { error: roomErr } = await db.rpc('mes_tank_room_check', { p_tank: tankId, p_wh: b.warehouse_id, p_material: patch.material_id ?? b.material_id,
          p_planned: (patch.planned_qty !== undefined ? patch.planned_qty : b.planned_qty) as number, p_exclude: b.id })
        if (roomErr) return mesFail(res, roomErr)
      }
    }
    const { data, error } = await db.from('production_batch').update(patch).eq('id', b.id).select('*')
    if (error) return fail(res, error)
    if (!data?.length) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    let ident: { batch_code?: string; relabel?: boolean } = {}
    if (idChanged) {
      const { data: idr, error: idErr } = await db.rpc('mes_batch_identity', { p: {
        batch_id: b.id, ...(cycle !== undefined ? { cycle } : {}), ...(body.batch_no !== undefined ? { batch_no: body.batch_no } : {}),
        ...(body.tank_id !== undefined ? { tank_id: body.tank_id } : {}),
      } })
      if (idErr) return idErr.code === '23505' ? fail(res, 409, 'BATCH_NO_DUP', 'Chu kỳ này đã có mẻ mang số đó — đổi số mẻ') : mesFail(res, idErr)
      ident = (idr ?? {}) as typeof ident
    }
    // bàn làm việc theo kịp mẻ (C114): đổi mã BTP ⇒ chép định mức mã mới; đổi kế hoạch ⇒ yêu cầu nhân theo tỷ lệ kế hoạch mới / cũ
    if (matChanged || planChanged) {
      const { error: rErr } = await db.rpc('mes_batch_requirements_refresh', { p: { batch_id: b.id, reset: matChanged, old_planned: b.planned_qty, actor_name: actor(req).actor_name } })
      if (matChanged) {   // phiếu bổ sung theo mã mới (phiếu đã ghi giữ nguyên)
        const { error: fErr } = await db.rpc('mes_batch_set_forms', { p: { batch_id: b.id } })
        if (fErr) console.error('[production] set forms', fErr.message)
      }
      if (rErr) return fail(res, 409, 'MES_REQUIREMENTS_STALE', 'Đã lưu mẻ nhưng chưa tính lại được nguyên liệu yêu cầu — bấm "Chép lại theo định mức" trên bàn của mẻ')
    }
    return ok(res, { ...data[0], ...(ident.batch_code ? { batch_code: ident.batch_code } : {}), relabel: ident.relabel === true })
  } catch (e) { return failAny(res, e) }
}

// PUT /wms/production/batches/:id/forms — PHIẾU BỔ SUNG của mẻ (trưởng ca · QA thêm / bớt khi mẻ còn mở). Phiếu đã ghi không bỏ được.
export const zBatchForms = z.object({ forms: z.array(zText(1, 20)).max(20) })
export async function setBatchForms(req: Request, res: Response) {
  try {
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.rpc('mes_batch_set_forms', { p: { batch_id: b.id, forms: (req.body as z.infer<typeof zBatchForms>).forms } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/batches/:id/approve-lead · approve-qa — HAI BƯỚC DUYỆT PHIẾU (17/11): trưởng ca → QA.
// QA duyệt cần trưởng ca đã duyệt; trưởng ca bỏ duyệt cần QA chưa duyệt; QA bỏ duyệt chỉ khi mẻ chưa nạp bồn. CAS theo cột đang NULL / NOT NULL.
export const zApprove = z.object({ approve: z.boolean() })
async function approveStep(req: Request, res: Response, step: 'lead' | 'qa') {
  const { approve } = req.body as z.infer<typeof zApprove>
  const b = await loadBatch(req.params.id)
  if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
  if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
  if (b.status !== 'OPEN') return fail(res, 409, 'BATCH_STATUS', 'Mẻ không còn mở')
  const a = actor(req)
  const col = step === 'lead' ? 'lead_ok_at' : 'qa_ok_at'
  if (step === 'lead' && approve) {
    const { count } = await db.from('batch_requirement').select('id', { count: 'exact', head: true }).eq('batch_id', b.id).is('removed_at', null)
    if (!count) return fail(res, 409, 'MES_EMPTY_SHEET', 'Phiếu của mẻ chưa có nguyên liệu nào — khai nguyên liệu rồi mới duyệt')
  }
  if (step === 'lead' && !approve && b.qa_ok_at) return fail(res, 409, 'MES_APPROVED', 'QA đã duyệt — QA bỏ duyệt trước')
  if (step === 'qa' && approve && !b.lead_ok_at) return fail(res, 409, 'MES_NOT_APPROVED', 'Trưởng ca chưa duyệt phiếu')
  if (step === 'qa' && !approve) {
    const { count } = await db.from('tank_movement').select('id', { count: 'exact', head: true }).eq('batch_id', b.id)
    if (count) return fail(res, 409, 'MES_FILLED', 'Mẻ đã nạp bồn — không bỏ duyệt được nữa')
  }
  const patch: TablesUpdate<'production_batch'> = step === 'lead'
    ? { lead_ok_at: approve ? nowIso() : null, lead_ok_by: approve ? a.actor_id : null, lead_ok_by_name: approve ? a.actor_name : null, updated_at: nowIso() }
    : { qa_ok_at: approve ? nowIso() : null, qa_ok_by: approve ? a.actor_id : null, qa_ok_by_name: approve ? a.actor_name : null, updated_at: nowIso() }
  let q = db.from('production_batch').update(patch).eq('id', b.id).eq('status', 'OPEN')
  q = approve ? q.is(col, null) : q.not(col, 'is', null)
  if (step === 'lead' && !approve) q = q.is('qa_ok_at', null)
  if (step === 'qa' && approve) q = q.not('lead_ok_at', 'is', null)
  const { data, error } = await q.select('*')
  if (error) return fail(res, error)
  if (!data?.length) return fail(res, 409, 'BATCH_STATUS', 'Phiếu vừa được người khác duyệt / bỏ duyệt — tải lại')
  return ok(res, data[0])
}
export async function approveLead(req: Request, res: Response) { try { return await approveStep(req, res, 'lead') } catch (e) { return failAny(res, e) } }
export async function approveQa(req: Request, res: Response) { try { return await approveStep(req, res, 'qa') } catch (e) { return failAny(res, e) } }

// ─── BÀN LÀM VIỆC CỦA MẺ: yêu cầu nguyên liệu (14/11 đêm) ──────────────────────────────────────────────────────────
// PUT /wms/production/batches/:id/requirements — thay TRỌN danh sách yêu cầu của mẻ (mẻ đang mở). Dòng vắng mặt = bỏ yêu cầu;
// phần ĐÃ CẤP không bị đụng (vẫn hiện trên bàn là "ngoài yêu cầu").
// 17/11 (phiếu chế biến giấy): quyền RIÊNG `edit_requirement` (trưởng ca) · có thay đổi thì BẮT BUỘC lý do (hàm báo MESERR:REASON) ·
// dòng của công thức bị bỏ = bỏ MỀM (giữ định mức gốc) · `replaces` = đổi mã (dòng mới "thay cho" mã cũ của phiếu).
export const zRequirements = z.object({
  items: z.array(z.object({ material_id: zText(1, 64), qty: z.number().positive().max(10_000_000), note: zText(0, 200).optional(),
    replaces: zText(1, 64).optional() })).max(300),
  reason: zText(0, 200).optional(),
})
export async function setRequirements(req: Request, res: Response) {
  try {
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    if (b.qa_ok_at) return fail(res, 409, 'MES_APPROVED', APPROVED_MSG)
    const { items, reason } = req.body as z.infer<typeof zRequirements>
    const { data, error } = await db.rpc('mes_batch_set_requirements', { p: { batch_id: b.id, items: items.map(i => ({ ...i, qty: round3(i.qty) })),
      reason: reason?.trim() || null, actor_name: actor(req).actor_name } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}
// POST /wms/production/batches/:id/apply-recipe — chép CÔNG THỨC vào mẻ (recipe_id trống = công thức của mẻ / mặc định;
// replace = bỏ hết yêu cầu cũ trước — "đổi công thức")
export const zApplyRecipe = z.object({ replace: z.boolean().optional(), recipe_id: zText(1, 64).optional() })
export async function applyRecipe(req: Request, res: Response) {
  try {
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    if (b.qa_ok_at) return fail(res, 409, 'MES_APPROVED', APPROVED_MSG)
    const body = req.body as z.infer<typeof zApplyRecipe>
    const { data, error } = await db.rpc('mes_batch_apply_recipe', { p: { batch_id: b.id, replace: body.replace === true, recipe_id: body.recipe_id ?? null, actor_name: actor(req).actor_name } })
    if (error) return mesFail(res, error)
    if ((data as { no_recipe?: boolean } | null)?.no_recipe) return fail(res, 409, 'MES_NO_RECIPE', 'Mã bán thành phẩm này chưa có công thức đang dùng — khai ở Sản xuất (MES) → Định mức, hoặc tự thêm nguyên liệu cho mẻ')
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// ─── MẪU PHIẾU THEO DÕI (14/11 khuya — user: "những cái khác bạn cho nó là số liệu config được" + "cài đặt và cho phép sửa theo
// từng lần nếu muốn tại bàn"). Mỗi mẫu = một dòng production_process_form; blocks = các khối ô theo thứ tự hiện trên form.
// Một phiếu của mẻ có thể mang BẢN SỬA RIÊNG (batch_process_log.blocks) — thêm lần đổ / thêm ô cho riêng lần đó, mẫu chung không đổi.
// Mã ô (key) là thứ phiếu đã ghi bám vào ⇒ FE sinh một lần lúc thêm ô và không cho sửa; BE chỉ kiểm hình dạng + trùng.
const zFormCode = z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'Mã mẫu phiếu: chữ IN HOA / số / _, 2–20 ký tự')
const zFieldKind = z.enum(['num', 'time', 'text'])
const zFormField = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/), label: zText(1, 120), kind: zFieldKind,
  unit: z.string().trim().max(20).optional(), min: z.number().finite().optional(), max: z.number().finite().optional(),
  wide: z.boolean().optional(), prefill: z.enum(['machine_code', 'planned_qty']).optional(),
  required: z.boolean().optional(),   // 17/11: ô phải ghi trước khi nạp bồn (hàm mes_batch_gate đọc)
}).strict()
const zFieldsBlock = z.object({ type: z.literal('fields'), title: zText(1, 80), hint: z.string().trim().max(160).optional(), fields: z.array(zFormField).min(1).max(60) }).strict()
const zGridBlock = z.object({
  type: z.literal('grid'), key: z.string().regex(/^[a-z][a-z0-9]{0,11}$/), title: zText(1, 80), hint: z.string().trim().max(160).optional(),
  rows: z.number().int().min(1).max(30),
  cols: z.array(z.object({ key: z.string().regex(/^[a-z0-9]{1,8}$/), label: zText(1, 40) }).strict()).min(1).max(8),
  cells: z.array(z.object({ key: z.string().regex(/^[a-z0-9]{1,8}$/), label: zText(1, 20), kind: zFieldKind }).strict()).min(1).max(5),
}).strict()
const zBlocks = z.array(z.discriminatedUnion('type', [zFieldsBlock, zGridBlock])).min(1).max(30)
export const zProcessFormParams = z.object({ code: zFormCode })
export const zProcessFormPut = z.object({
  title: zText(1, 120), short: zText(1, 30), is_active: z.boolean(), sort_order: z.number().int().min(0).max(9999).optional(), blocks: zBlocks,
  // phiếu BỔ SUNG (17/11): chỉ có ở mẻ được chọn · material_ids = mã BTP mặc định có phiếu này
  optional: z.boolean().optional(), material_ids: z.array(zText(1, 64)).max(200).optional(),
})
/** luật hình dạng chung với FE `blocksError` — utils/processBlocks.ts (mirror test) */
export { processBlocksError }
// GET /wms/production/process-forms — mọi mẫu phiếu (kể cả đã ngưng dùng — trang mẻ tự lọc)
export async function listProcessForms(_req: Request, res: Response) {
  try {
    const { data, error } = await db.from('production_process_form').select('code, title, short, blocks, sort_order, is_active, optional, material_ids, updated_by_name, updated_at')
      .order('sort_order').order('code').limit(100)
    if (error) return fail(res, error)
    return ok(res, data ?? [])
  } catch (e) { return failAny(res, e) }
}
// PUT /wms/production/process-forms/:code — tạo / sửa một mẫu (quyền configure). Phiếu đã ghi giữ nguyên dữ liệu.
export async function putProcessForm(req: Request, res: Response) {
  try {
    const { code } = req.params as unknown as z.infer<typeof zProcessFormParams>
    const b = req.body as z.infer<typeof zProcessFormPut>
    const bad = processBlocksError(b.blocks)
    if (bad) return fail(res, 422, 'PROCESS_FORM_INVALID', bad)
    const mids = b.material_ids ? [...new Set(b.material_ids)] : undefined
    if (mids?.length) {
      const { data: ms } = await db.from('Material').select('id').in('id', mids).eq('is_semi_finished', true).limit(200)
      if ((ms?.length ?? 0) !== mids.length) return fail(res, 422, 'PROCESS_FORM_INVALID', 'Danh sách mã mặc định có mã không phải bán thành phẩm')
    }
    const row = { title: b.title, short: b.short, blocks: b.blocks, is_active: b.is_active, updated_by_name: actor(req).actor_name, updated_at: nowIso(),
      ...(b.sort_order != null ? { sort_order: b.sort_order } : {}), ...(b.optional !== undefined ? { optional: b.optional } : {}), ...(mids ? { material_ids: mids } : {}) }
    const { data: cur } = await db.from('production_process_form').select('code').eq('code', code).maybeSingle()
    if (cur) {
      const { data, error } = await db.from('production_process_form').update(row).eq('code', code).select('*')
      if (error) return fail(res, error)
      if (!data?.length) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẫu phiếu')
      return ok(res, data[0])
    }
    const { data, error } = await db.from('production_process_form').insert({ code, sort_order: 0, ...row }).select('*').single()
    if (error) return fail(res, error)
    return ok(res, data, 201)
  } catch (e) { return failAny(res, e) }
}

// ─── PHIẾU THEO DÕI của mẻ — thay phiếu giấy; ô theo MẪU PHIẾU, hoặc theo bản sửa riêng của phiếu (blocks) ────────────
// PUT /wms/production/batches/:id/process-log/:form — lưu TRỌN nội dung phiếu ({ mã_ô: giá_trị }); phiếu QA đã xác nhận ⇒ khoá
// blocks: mảng = bản sửa riêng cho lần này · null = về theo mẫu chung · bỏ trống = giữ nguyên
const zForm = zFormCode
export const zProcessLogParams = z.object({ id: zText(1, 64), form: zForm })
export const zProcessLogPut = z.object({
  // vắng = chỉ lưu CẤU TRÚC (18/11: phiếu ghi từng ô qua /cell — lưu cấu trúc không được đè giá trị người khác vừa ghi)
  data: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), z.string().max(300)).refine(o => Object.keys(o).length <= 300, 'Phiếu quá nhiều ô').optional(),
  blocks: zBlocks.nullable().optional(),
})
export async function putProcessLog(req: Request, res: Response) {
  try {
    const { form } = req.params as unknown as z.infer<typeof zProcessLogParams>
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    if (b.status === 'CANCELLED') return fail(res, 409, 'BATCH_CANCELLED', 'Mẻ đã huỷ — không ghi phiếu được')
    const { data: raw, blocks } = req.body as z.infer<typeof zProcessLogPut>
    if (blocks) { const bad = processBlocksError(blocks); if (bad) return fail(res, 422, 'PROCESS_FORM_INVALID', bad) }
    const custom = blocks === undefined ? {} : { blocks }
    if (raw === undefined && blocks === undefined) return fail(res, 422, 'VALIDATION_ERROR', 'Không có gì để lưu')
    // bỏ ô trống ⇒ phiếu chỉ giữ ô đã ghi. data vắng ⇒ chỉ lưu cấu trúc, giữ nguyên giá trị đang có
    const data = raw === undefined ? undefined : Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.trim()] as const).filter(([, v]) => v !== ''))
    const who = actor(req).actor_name
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data: cur } = await db.from('batch_process_log').select('id, confirmed_at, data, stamps').eq('batch_id', b.id).eq('form', form).maybeSingle()
      if (cur?.confirmed_at) return fail(res, 409, 'PROCESS_LOG_CONFIRMED', 'Phiếu đã được QA xác nhận — bỏ xác nhận rồi mới sửa được')
      if (!cur) {   // phiếu MỚI: mẫu đang dùng + phiếu có trên mẻ (phiếu bổ sung) — một luật với bấm giờ (mes_batch_form_error)
        const { data: why } = await db.rpc('mes_batch_form_error', { p_batch_id: b.id, p_form: form })
        if (why) { const [code, msg] = String(why).split('|'); return fail(res, code === 'NOT_FOUND' ? 404 : 409, code === 'NOT_FOUND' ? code : code === 'PROCESS_FORM_INACTIVE' ? code : `MES_${code}`, msg) }
      }
      if (cur) {
        // mốc giờ đã BẤM (stamps) mà nay sửa tay / xoá ⇒ ghi thêm người sửa + lúc sửa (lưu vết, user chốt 17/11)
        const old = (cur.data ?? {}) as Record<string, string>
        const stamps = { ...((cur.stamps ?? {}) as Record<string, Record<string, string>>) }
        if (data) for (const k of Object.keys(stamps)) if ((old[k] ?? '') !== (data[k] ?? '')) stamps[k] = { ...stamps[k], edited_by: who ?? '', edited_at: nowIso() }
        const { data: up, error } = await db.from('batch_process_log').update({ ...(data ? { data, stamps } : {}), ...custom, updated_by_name: who, updated_at: nowIso() })
          .eq('id', cur.id).is('confirmed_at', null).select('*')
        if (error) return fail(res, error)
        if (!up?.length) return fail(res, 409, 'PROCESS_LOG_CONFIRMED', 'Phiếu vừa được QA xác nhận — tải lại')
        return ok(res, up[0])
      }
      const { data: ins, error } = await db.from('batch_process_log')
        .insert({ id: randomUUID(), batch_id: b.id, form, data: data ?? {}, ...custom, created_by_name: who, updated_by_name: who, updated_at: nowIso() }).select('*').single()
      if (!error) return ok(res, ins, 201)
      if (error.code !== '23505') return fail(res, error)   // hai người cùng ghi lần đầu ⇒ vòng lại thành cập nhật
    }
    return fail(res, 409, 'BUSY', 'Phiếu đang được người khác ghi — thử lại')
  } catch (e) { return failAny(res, e) }
}
// PHIẾU GHI TỪNG Ô (18/11 — user: "chỉ để 1 nút mở phiếu ghi nhận tình trạng Bắt đầu, và cho nút ở các input, bấm vào sẽ hiện lên
// yêu cầu Input, nếu thời gian thì tự lấy thời gian"). Một hàm DB mes_log_cell: gộp đúng MỘT khoá dưới khoá tư vấn (mẻ, phiếu) ⇒
// nhiều người ghi các ô khác nhau không đè nhau (PUT trọn phiếu thì có thể đè).
async function logCell(req: Request, res: Response, p: Record<string, unknown>) {
  const { form } = req.params as unknown as z.infer<typeof zProcessLogParams>
  const b = await loadBatch(req.params.id)
  if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
  if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
  const { data, error } = await db.rpc('mes_log_cell', { p: { ...p, batch_id: b.id, form, actor_name: actor(req).actor_name } })
  if (error) return mesFail(res, error)
  return ok(res, data)
}
// POST /wms/production/batches/:id/process-log/:form/start — BẮT ĐẦU phiếu: tạo phiếu (điền sẵn máy / kế hoạch) + giờ máy chủ vào mốc giờ đầu
export async function startProcessLog(req: Request, res: Response) {
  try { return await logCell(req, res, { op: 'start' }) } catch (e) { return failAny(res, e) }
}
// POST /wms/production/batches/:id/process-log/:form/cell { key, value? } — ghi MỘT ô (ô nhóm hoặc ô bảng theo dõi).
// Không gửi value + ô Giờ ⇒ giờ máy chủ + người bấm (ô đã có giờ ⇒ 409 ALREADY); gửi value ⇒ ghi giá trị ('' = xoá ô), ô đã có thì giữ vết người sửa.
export const zProcessLogCell = z.object({ key: z.string().regex(/^[a-z0-9_]{1,40}$/), value: z.string().max(300).nullable().optional() })
export async function setProcessLogCell(req: Request, res: Response) {
  try {
    const { key, value } = req.body as z.infer<typeof zProcessLogCell>
    return await logCell(req, res, { op: 'set', key, ...(typeof value === 'string' ? { value } : {}) })
  } catch (e) { return failAny(res, e) }
}
// POST /wms/production/batches/:id/process-log/:form/confirm — QA xác nhận / bỏ xác nhận phiếu (quyền qa_release)
export const zProcessLogConfirm = z.object({ confirm: z.boolean() })
export async function confirmProcessLog(req: Request, res: Response) {
  try {
    const { form } = req.params as unknown as z.infer<typeof zProcessLogParams>
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { confirm } = req.body as z.infer<typeof zProcessLogConfirm>
    const a = actor(req)
    // xác nhận ⇒ chụp mẫu đang áp vào phiếu (nếu phiếu chưa có bản sửa riêng) — hồ sơ lô không đổi khi mẫu chung sửa về sau
    // bỏ xác nhận ⇒ bản chụp còn y hệt mẫu chung thì gỡ, để phiếu lại "theo mẫu chung" (không hiện thành "sửa riêng")
    let snap: { blocks?: TablesUpdate<'batch_process_log'>['blocks'] } = {}
    const { data: cur } = await db.from('batch_process_log').select('blocks').eq('batch_id', b.id).eq('form', form).maybeSingle()
    if (cur && (confirm ? cur.blocks == null : cur.blocks != null)) {
      const { data: pf } = await db.from('production_process_form').select('blocks').eq('code', form).maybeSingle()
      if (pf && confirm) snap = { blocks: pf.blocks }
      if (pf && !confirm && JSON.stringify(pf.blocks) === JSON.stringify(cur.blocks)) snap = { blocks: null }
    }
    const { data, error } = await db.from('batch_process_log')
      .update(confirm ? { ...snap, confirmed_at: nowIso(), confirmed_by: a.actor_id, confirmed_by_name: a.actor_name, updated_at: nowIso() }
        : { ...snap, confirmed_at: null, confirmed_by: null, confirmed_by_name: null, updated_at: nowIso() })
      .eq('batch_id', b.id).eq('form', form).select('*')
    if (error) return fail(res, error)
    if (!data?.length) return fail(res, 404, 'NOT_FOUND', 'Phiếu chưa có nội dung — ghi phiếu trước rồi mới xác nhận')
    return ok(res, data[0])
  } catch (e) { return failAny(res, e) }
}

// ─── ĐỊNH MỨC nguyên liệu của mã bán thành phẩm (một định mức / mã, cho một cỡ mẻ chuẩn) ──────────────────────────
const MAT_COLS = 'id, material_code, short_name, base_unit, entry_unit, units_per_carton, category'
// 17/11 — NHIỀU CÔNG THỨC cho một mã BTP (user: "ở nhiều thời điểm công thức sẽ khác nhau ⇒ tạo được nhiều để chọn dễ dàng").
// Mỗi mã có công thức đang dùng thì có đúng một công thức MẶC ĐỊNH (form Mở mẻ chọn sẵn). Tên công thức duy nhất trong một mã.
const RECIPE_COLS = `id, material_id, name, base_qty, note, is_active, is_default, updated_at, updated_by, material:Material!production_recipe_material_id_fkey(${MAT_COLS})`
export const zRecipeListQuery = z.object({ material_id: zText(1, 64).optional(), active: z.enum(['1']).optional() })
// GET /wms/production/recipes[?material_id=&active=1] — danh sách công thức (cấu hình: vài chục – vài trăm) + số dòng nguyên liệu
export async function listRecipes(req: Request, res: Response) {
  try {
    const q = req.query as unknown as z.infer<typeof zRecipeListQuery>
    let query = db.from('production_recipe').select(`${RECIPE_COLS}, lines:production_recipe_line(count)`)
    if (q.material_id) query = query.eq('material_id', q.material_id)
    if (q.active === '1') query = query.eq('is_active', true)
    const { data, error } = await query.order('updated_at', { ascending: false }).limit(1000)
    if (error) return fail(res, error)
    const rows = (data ?? [])
      .filter(r => categoryAllowed(req, (r.material as unknown as { category: string | null } | null)?.category))
      .map(({ lines, ...r }) => ({ ...r, line_count: (lines as unknown as { count: number }[] | null)?.[0]?.count ?? 0 }))
    return ok(res, rows)
  } catch (e) { return failAny(res, e) }
}
// GET /wms/production/recipes/:id — một công thức + các dòng
export async function getRecipe(req: Request, res: Response) {
  try {
    const { data: r, error } = await db.from('production_recipe').select(RECIPE_COLS).eq('id', req.params.id).maybeSingle()
    if (error) return fail(res, error)
    if (!r) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy công thức')
    if (!categoryAllowed(req, (r.material as unknown as { category: string | null } | null)?.category)) return fail(res, 403, 'FORBIDDEN', CATEGORY_FORBIDDEN_MSG)
    const { data: lines, error: lErr } = await db.from('production_recipe_line')
      .select(`id, material_id, qty, tol_pct, sort_order, note, material:Material!production_recipe_line_material_id_fkey(${MAT_COLS})`)
      .eq('recipe_id', r.id).order('sort_order').limit(500)
    if (lErr) return fail(res, lErr)
    return ok(res, { ...r, lines: lines ?? [] })
  } catch (e) { return failAny(res, e) }
}
const zRecipeLines = z.array(z.object({
  material_id: zText(1, 64), qty: z.number().positive().max(10_000_000), tol_pct: z.number().min(0).max(100).nullable().optional(), note: zText(0, 200).optional(),
})).max(300)
// PUT /wms/production/recipes/:id — sửa một công thức (thay trọn danh sách dòng) — quyền manage_recipe
export const zRecipePut = z.object({
  name: zText(1, 80), base_qty: z.number().positive().max(10_000_000), note: zText(0, 500).nullable().optional(),
  is_active: z.boolean().optional(), is_default: z.boolean().optional(), lines: zRecipeLines,
})
// POST /wms/production/recipes — tạo công thức MỚI cho một mã BTP (mã đã có công thức khác vẫn tạo thêm được)
export const zRecipeCreate = zRecipePut.extend({ material_id: zText(1, 64) })
async function saveRecipe(req: Request, res: Response, materialId: string, id: string | null) {
  const body = req.body as z.infer<typeof zRecipePut>
  const { data: m } = await db.from('Material').select('id, material_code, base_unit, category, is_semi_finished').eq('id', materialId).maybeSingle()
  if (!m) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mã bán thành phẩm')
  if (!categoryAllowed(req, m.category)) return fail(res, 403, 'FORBIDDEN', CATEGORY_FORBIDDEN_MSG)
  const btpErr = btpUseError(m)   // không xét is_active: công thức của mã đã ngừng vẫn sửa được (như trước)
  if (btpErr) return fail(res, 422, btpErr.code, btpErr.message)
  const { data, error } = await db.rpc('mes_recipe_save', { p: {
    id, material_id: m.id, name: body.name.trim(), base_qty: round3(body.base_qty), note: body.note ?? null,
    is_active: body.is_active ?? true, is_default: body.is_default ?? false,
    lines: body.lines.map(l => ({ ...l, qty: round3(l.qty), tol_pct: l.tol_pct ?? null })), actor_name: actor(req).actor_name,
  } })
  if (error) return mesFail(res, error)
  return ok(res, data, id ? 200 : 201)
}
export async function createRecipe(req: Request, res: Response) {
  try { return await saveRecipe(req, res, (req.body as z.infer<typeof zRecipeCreate>).material_id, null) } catch (e) { return failAny(res, e) }
}
export async function putRecipe(req: Request, res: Response) {
  try {
    const { data: cur } = await db.from('production_recipe').select('id, material_id').eq('id', req.params.id).maybeSingle()
    if (!cur) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy công thức')
    return await saveRecipe(req, res, cur.material_id, cur.id)
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/batches/:id/cancel — CAS theo trạng thái: hai người cùng bấm ⇒ một người thắng.
// (18/11) không còn "Đóng mẻ" / "Mở lại" — mẻ chỉ OPEN · CANCELLED; "xong" = đã nạp BTP vào bồn (tình trạng mes_batch_stage).
async function setBatchStatus(req: Request, res: Response, from: string[], to: string, extra: Record<string, unknown> = {}) {
  const b = await loadBatch(req.params.id)
  if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
  if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
  if (!from.includes(b.status)) return fail(res, 409, 'BATCH_STATUS', `Mẻ đang ở trạng thái ${b.status}`)
  const { data, error } = await db.from('production_batch').update({ status: to, updated_at: nowIso(), ...extra })
    .eq('id', b.id).in('status', [...from]).select('*')   // CAS theo trạng thái (2–3 giá trị), không phải danh sách id
  if (error) return fail(res, error)
  if (!data?.length) return fail(res, 409, 'BATCH_STATUS', 'Mẻ vừa được người khác đổi trạng thái — tải lại')
  return ok(res, data[0])
}
export async function cancelBatch(req: Request, res: Response) {
  try {
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const [{ count: nc }, { count: nm }] = await Promise.all([
      db.from('batch_consumption').select('id', { count: 'exact', head: true }).eq('batch_id', b.id).is('reversed_at', null),
      db.from('tank_movement').select('id', { count: 'exact', head: true }).eq('batch_id', b.id),
    ])
    if ((nc ?? 0) > 0) return fail(res, 409, 'BATCH_HAS_CONSUMPTION', `Mẻ còn ${nc} dòng NVL đã rút — huỷ từng dòng rút (hoàn tồn) trước khi huỷ mẻ`)
    if ((nm ?? 0) > 0) return fail(res, 409, 'BATCH_HAS_TANK', 'Mẻ đã nạp bồn — không huỷ được; phần trong bồn xả bỏ ở trang Bồn')
    return await setBatchStatus(req, res, ['OPEN'], 'CANCELLED')
  } catch (e) { return failAny(res, e) }
}

// (17/11) QA đạt / không đạt KHÔNG còn bấm ở mẻ — kết luận ở BỒN: POST /wms/production/tanks/:id/qa (hàm mes_tank_qa).

// ═══ RÚT NVL VÀO MẺ ════════════════════════════════════════════════════════════════════════════

// GET /wms/production/batches/:id/scan-check?code= — tra tem quét được trong KHO CỦA MẺ (cho màn xác nhận trước khi rút)
export const zScanCheckQuery = z.object({ code: zText(1, 200) })
export async function scanCheck(req: Request, res: Response) {
  try {
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const code = normalizeQR(String((req.query as { code: string }).code))
    const { data: rows, error } = await db.from('InventoryEntry')
      // import_date: khoá FIFO / LIFO (18/11) + hiện "nhập dd-mm-yyyy" trên thẻ tem vừa quét
      .select('id, pallet_code, material_id, cartons_remaining, cartons_imported, cartons_reserved, status, production_date, import_date, expiry_date, batch, ncc_id, shelf_life_days, qa_status_id, qa_status:QAStatus(code, name), location:Location(location_code), material:Material(material_code, short_name, base_unit, entry_unit, units_per_carton)')
      .eq('warehouse_id', b.warehouse_id).eq('pallet_code', code).in('status', ['IN_STOCK', 'PARTIAL']).limit(20)
    if (error) return fail(res, error)
    if (!rows?.length) {
      const { data: other } = await db.from('InventoryEntry').select('warehouse:Warehouse(name)').eq('pallet_code', code).in('status', ['IN_STOCK', 'PARTIAL']).limit(1).maybeSingle()
      const whName = (other?.warehouse as unknown as { name: string } | null)?.name
      return fail(res, 404, 'NOT_IN_WAREHOUSE', whName
        ? `Tem ${code} đang ở kho "${whName}", không ở kho của mẻ — chuyển hàng sang kho chế biến trước`
        : `Không tìm thấy tồn của tem ${code} trong kho của mẻ`)
    }
    if (rows.length > 1)
      return fail(res, 409, 'POOLED_CODE', `Mã ${code} là tồn gộp nhiều lô — dùng "Không có tem" để chọn đúng lô`)
    // như quét xuất: %Date + đúng / sai thứ tự luân chuyển (17/11) · HẠN + dòng QA duyệt của mẻ (hàng hết hạn chỉ cấp khi QA duyệt)
    const ctx = await mesPickContext(b.warehouse_id, rows[0].material_id, b.id)
    const e0 = rows[0] as unknown as PickRow
    return ok(res, { ...rows[0], pct_date: computePctDate(e0, ctx.material), rotation: mesRotationCheck(ctx, e0),
      expiry: expiryView(ctx.ranked.find(r => r.row.id === e0.id)) })
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/batches/:id/consume-scan — rút theo TEM (một dòng tồn)
export const zConsumeScan = z.object({
  entry_id: zText(1, 100), qty: z.number().positive().max(10_000_000), qty_semantics: z.literal('base'),
  // lấy khác thứ tự khi kho bật "bắt buộc" — mã lý do của ROTATION_REASONS (+ ": ghi chú"), quyền outbound.rotation_override
  rotation_override_reason: zText(1, 200).optional(),
})
export async function consumeScan(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zConsumeScan>
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const gateErr = await consumeGateError(b)
    if (gateErr) return fail(res, 409, 'MES_NOT_APPROVED', gateErr)
    const { data: e } = await db.from('InventoryEntry')
      .select('id, pallet_code, material_id, production_date, import_date, expiry_date, shelf_life_days, ncc_id, qa_status_id, cartons_remaining, cartons_imported, cartons_reserved, material:Material(base_unit, entry_unit, units_per_carton)')
      .eq('id', body.entry_id).maybeSingle()
    if (!e) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy dòng tồn')
    const intErr = qtyIntegerError(body.qty, e.material as unknown as { base_unit: string | null; entry_unit: string | null; units_per_carton: number | null } | null)
    if (intErr) return fail(res, 422, 'QTY_NOT_INTEGER', intErr)
    // LUÂN CHUYỂN — cùng luật cửa quét xuất (outboundController.scanItem): kho / loại kho bật "bắt buộc" ⇒ sai thứ tự
    // phải có người có quyền duyệt + lý do trong danh sách; không bật ⇒ chỉ ghi vết (màn hình nhắc trước khi bấm).
    // HẾT HẠN: cửa ghi mes_consume_scan tự chặn (expiry_calc + sổ duyệt của mẻ, một giao dịch với phép trừ tồn).
    const rot = mesRotationCheck(await mesPickContext(b.warehouse_id, e.material_id, b.id), e as unknown as PickRow)
    const gate = rotationGate(req, rot, body.rotation_override_reason)
    if (gate.error) return fail(res, 422, gate.error[0], gate.error[1])
    const { data, error } = await db.rpc('mes_consume_scan', { p: { batch_id: b.id, entry_id: body.entry_id, qty: body.qty, ...actor(req),
      rotation: { violation: rot.violation, principle: rot.principle, best_date: rot.best_date, override_reason: gate.override } } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// ── LUÂN CHUYỂN KHI CẤP NVL (17/11 — user: "khi quét tem trong Mẻ thì cũng phải có các chức năng như bên xuất hàng … xem
// được tồn kho đang ở đâu, date là gì, FIFO đã phù hợp chưa. Bản chất nó cũng là 1 loại xuất hàng"). CÙNG luật với quét
// xuất: nguyên tắc + "bắt buộc" theo cấu hình 2 tầng Kho → Loại kho (`rotationConfigOf`), khoá xếp `rotationSortKey`,
// vi phạm `isRotationViolation`, pallet so được `isPickEligible`, lý do vượt rào `ROTATION_REASONS`, quyền
// `outbound.rotation_override` (một NĂNG LỰC "được lấy khác thứ tự", như `inbound.putaway_override`).
// Khác DUY NHẤT là TẬP SO SÁNH: tồn của KHO CHẾ BIẾN theo cột warehouse_id, trạng thái IN_STOCK / PARTIAL (đúng tập mà
// mes_consume_scan cho rút) — pallet ở kho chế biến thường chưa xếp ô, tập của cửa xuất (lọc theo kho của Ô) sẽ bỏ sót.
type PickRow = RotationEntry & { id: string; pallet_code: string | null; batch?: string | null; material_id?: string
  qa_status?: { code: string; name: string } | null; location?: { location_code: string | null } | null
  /** HSD hiệu lực do trigger DB tính (inventory_expiry_calc) — CÙNG cột mà cửa ghi mes_consume_* dùng để chặn hàng hết hạn */
  expiry_calc?: string | null; import_date?: string | null }
type ExpiryApproval = { id: string; entry_id: string | null; material_id: string; production_date: string | null; batch_lot: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'; requested_by_name: string | null; requested_at: string | null
  decided_by_name: string | null; decided_at: string | null; note: string | null }
type Ranked = { row: PickRow; key: number | null; eligible: boolean; noTem: boolean; qaHeld: boolean; expired: boolean; approval: ExpiryApproval | null }
type PickCtx = { principle: RotationPrinciple; required: boolean; source: 'WAREHOUSE' | 'TYPE'; material: MaterialShelfInfo | null; ranked: Ranked[] }
const dayOf = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null)
const lotOf = (v: unknown): string | null => String(v ?? '').trim() || null
/** NVL HẾT HẠN (user chốt 17/11 "chặn và cho qua khi QA duyệt"): HSD hiệu lực < hôm nay giờ VN — khớp `expiry_calc < mes_vn_today()`
 *  ở cửa ghi (migration 20261117e). Ngày HSD còn dùng được; không biết HSD ⇒ không chặn. */
const isExpiredDay = (expiryCalc: unknown, today: string): boolean => { const d = dayOf(expiryCalc); return !!d && d < today }
/** Dòng duyệt của một TEM (entry) hay một LÔ không tem (mã + NSX + mã lô) — so theo cột của sổ duyệt, không ghép chuỗi khoá */
function approvalOf(list: ExpiryApproval[], row: PickRow, noTem: boolean): ExpiryApproval | null {
  return list.find(a => noTem
    ? !a.entry_id && a.material_id === row.material_id && dayOf(a.production_date) === dayOf(row.production_date) && lotOf(a.batch_lot) === lotOf(row.batch)
    : a.entry_id === row.id) ?? null
}
/** Tập so sánh luân chuyển của một mã trong kho chế biến. `batchId` có ⇒ đọc thêm sổ duyệt hàng hết hạn của mẻ: tem / lô hết hạn
 *  CHƯA được QA duyệt cho mẻ này KHÔNG được xếp hạng (không bắt người cấp "lấy hàng hết hạn trước") và đứng cuối như hàng QA giữ. */
async function mesPickContext(warehouseId: string, materialId: string, batchId?: string): Promise<PickCtx> {
  const [{ data: mat }, resolver, qaHold, appr] = await Promise.all([
    db.from('Material').select('material_code, category, shelf_life_days, supplier_shelf_life_overrides').eq('id', materialId).maybeSingle(),
    rotationConfigOf([warehouseId]), qaHoldIds(),
    batchId
      ? db.from('mes_expiry_approval').select('id, entry_id, material_id, production_date, batch_lot, status, requested_by_name, requested_at, decided_by_name, decided_at, note')
          .eq('batch_id', batchId).eq('material_id', materialId).limit(1000)
      : Promise.resolve({ data: [] as ExpiryApproval[] }),
  ])
  const cfg = resolver.of(warehouseId, mat?.category ?? null)
  const material = (mat ?? null) as unknown as MaterialShelfInfo | null
  const code = String(mat?.material_code ?? '').toUpperCase()
  const approvals = (appr.data ?? []) as ExpiryApproval[]
  const today = vnDayOf(new Date()) as string
  const rows = await fetchAllRowsParallel(() => db.from('InventoryEntry')
    .select('id, pallet_code, batch, material_id, qa_status_id, qa_status:QAStatus(code, name), cartons_remaining, cartons_imported, cartons_reserved, production_date, expiry_date, expiry_calc, import_date, ncc_id, shelf_life_days, location:Location(location_code)')
    .eq('warehouse_id', warehouseId).eq('material_id', materialId).in('status', ['IN_STOCK', 'PARTIAL']).gt('cartons_remaining', 0).order('id')) as PickRow[]
  const order = (r: Ranked) => (r.eligible ? 0 : r.qaHeld ? 2 : 1)   // cấp được → hết hạn chưa duyệt → QA giữ
  const ranked: Ranked[] = rows.map(row => {
    const noTem = String(row.pallet_code ?? '').toUpperCase() === code
    const expired = isExpiredDay(row.expiry_calc, today)
    const approval = approvalOf(approvals, row, noTem)
    const qaHeld = !!row.qa_status_id && qaHold.has(row.qa_status_id)
    const eligible = isPickEligible(row, qaHold) && (!expired || approval?.status === 'APPROVED')
    return { row, key: rotationSortKey(row, material, cfg.principle), eligible, noTem, qaHeld, expired, approval }
  }).sort((a, b) => (order(a) - order(b)) || ((a.key ?? Infinity) - (b.key ?? Infinity))
      || (a.row.pallet_code ?? '').localeCompare(b.row.pallet_code ?? ''))
  return { principle: cfg.principle, required: cfg.required, source: cfg.source, material, ranked }
}
/** Hàng nên lấy trước (cả có tem lẫn không tem) — null khi chưa có hàng nào cấp được có ngày */
const bestOf = (ctx: PickCtx) => ctx.ranked.find(r => r.eligible && r.key != null) ?? null
/** Chấm luân chuyển cho một khoá xếp (một tem vừa quét, hoặc một lô không tem đã chọn) — CÙNG luật cửa quét xuất */
function mesRotationVerdict(ctx: PickCtx, scannedKey: number | null, scannedDate: string | null, isBest: (r: Ranked) => boolean) {
  const best = bestOf(ctx)
  return {
    principle: ctx.principle, required: ctx.required, source: ctx.source, date_label: ROTATION_DATE_LABEL[ctx.principle],
    scanned_date: scannedDate,
    violation: !!best && !isBest(best) && isRotationViolation(scannedKey, best.key),
    best_date: best ? rotationDateOf(best.row, ctx.material, ctx.principle) : null,
    best_pallet_code: best && !best.noTem ? best.row.pallet_code : null, best_location_code: best?.row.location?.location_code ?? null,
    /** hàng nên lấy trước là hàng KHÔNG tem (chọn ở "Không có tem") — kèm lô / NSX để người cấp tìm */
    best_no_tem: !!best?.noTem, best_lot: best?.noTem ? lotOf(best.row.batch) : null,
    best_production_date: best?.noTem ? dayOf(best.row.production_date) : null,
  }
}
function mesRotationCheck(ctx: PickCtx, entry: PickRow) {
  return mesRotationVerdict(ctx, rotationSortKey(entry, ctx.material, ctx.principle), rotationDateOf(entry, ctx.material, ctx.principle),
    r => r.row.id === entry.id)
}
function mesRotationMessage(r: ReturnType<typeof mesRotationCheck>): string {
  const what = r.best_no_tem ? ` (hàng không tem${r.best_lot ? `, lô ${r.best_lot}` : ''})` : r.best_pallet_code ? ` (tem ${r.best_pallet_code})` : ''
  const where = r.best_location_code ? ` tại ${r.best_location_code}` : ''
  return `Kho yêu cầu lấy đúng ${ROTATION_LABEL[r.principle]}. Còn hàng ${r.date_label} ${r.best_date ?? '—'}${what}${where} phải dùng trước.`
}
/** Chặn lấy khác thứ tự khi kho / loại kho bật "bắt buộc" — một hàm cho hai cửa cấp (quét tem · chọn lô) */
function rotationGate(req: Request, rot: ReturnType<typeof mesRotationCheck>, rawReason: string | undefined): { error?: [string, string]; override: string | null } {
  if (!(rot.required && rot.violation)) return { override: null }
  const raw = String(rawReason ?? '').trim()
  if (!canRotationOverride(req)) return { error: ['ROTATION_VIOLATION', `${mesRotationMessage(rot)} Cần người có quyền duyệt lấy khác thứ tự.`], override: null }
  if (!isRotationReason(raw.split(':')[0].trim())) return { error: ['ROTATION_REASON_REQUIRED', `${mesRotationMessage(rot)} Chọn lý do để tiếp tục.`], override: null }
  return { override: raw.slice(0, 200) }
}
/** Tình trạng HẠN của một tem / lô với mẻ: hết hạn chưa · HSD · dòng QA duyệt (nếu có) */
const expiryView = (r: Ranked | undefined | null) => r
  ? { expired: r.expired, expiry_date: dayOf(r.row.expiry_calc), approval: r.approval }
  : { expired: false, expiry_date: null, approval: null }
const canRotationOverride = (req: Request): boolean =>
  req.user?.is_superadmin === true || (req.user?.module_permissions ?? {})['outbound']?.includes('rotation_override') === true

// GET /wms/production/batches/:id/pick-list?material_id= — "LẤY Ở ĐÂU" GOM THEO DATE như "Tồn kho theo %Date" của Xuất kho (user
// 17/11: "1 mã có 200 pallet thì có 200 dòng ư?"). Hàng CÓ TEM gom theo (ngày luân chuyển · ô · tình trạng); hàng KHÔNG TEM gom theo
// LÔ (NSX + mã lô — đơn vị chọn của cửa "Không có tem"); mỗi nhóm mở ra thấy từng tem / dòng tồn. Xếp như cửa cấp: cấp được (theo
// ngày, nhóm ít hàng trước — dọn hàng lẻ) → hết hạn chưa QA duyệt → QA giữ. Hạng 1 = nên lấy trước, tính CHUNG cả có tem lẫn không tem.
export const zPickListQuery = z.object({ material_id: zText(1, 64) })
type PickItem = { entry_id: string; pallet_code: string | null; batch: string | null; location_code: string | null; available: number
  import_date: string | null; expired: boolean; approval: ExpiryApproval | null }
type PickGroup = { key: string; kind: 'TEM' | 'LOT'; state: 'OK' | 'EXPIRED' | 'QA'; rank: number | null
  /** vị trí trong thứ tự CHUNG của cả có tem lẫn không tem (18/11 — "Lấy ở đâu" của cửa quét tem hiện cả hai, đúng thứ tự server) */
  pos: number
  rot_date: string | null; pct_date: number | null; expiry_date: string | null; production_date: string | null; batch_lot: string | null
  location_code: string | null; locations: string[]; available: number; count: number; qa_name: string | null
  /** nhóm có hàng quá HSD (kể cả đã được QA duyệt cho mẻ — khi đó state = OK) */
  expired: boolean; violation: boolean; approval: ExpiryApproval | null; items: PickItem[] }
const PICK_ITEM_CAP = 3000   // kho chế biến chỉ giữ hàng vài ngày — chặn trần phòng dữ liệu lạ, nhóm vẫn cộng đủ
export async function pickList(req: Request, res: Response) {
  try {
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const ctx = await mesPickContext(b.warehouse_id, (req.query as unknown as z.infer<typeof zPickListQuery>).material_id, b.id)
    const best = bestOf(ctx)
    const groups = new Map<string, PickGroup & { minKey: number | null }>()
    let nItems = 0
    for (const r of ctx.ranked) {
      const row = r.row
      const avail = availableOf(row)
      if (avail <= 0) continue
      const state: PickGroup['state'] = r.qaHeld ? 'QA' : r.expired && r.approval?.status !== 'APPROVED' ? 'EXPIRED' : 'OK'
      const rotDate = rotationDateOf(row, ctx.material, ctx.principle)
      const loc = row.location?.location_code ?? null
      const pd = dayOf(row.production_date), lot = lotOf(row.batch)
      const pct = computePctDate(row, ctx.material)
      const gk = r.noTem ? `L|${pd ?? ''}|${lot ?? ''}|${state}` : `T|${rotDate ?? ''}|${loc ?? ''}|${state}`
      let g = groups.get(gk)
      if (!g) {
        g = { key: gk, kind: r.noTem ? 'LOT' : 'TEM', state, rank: null, pos: 0, rot_date: rotDate, pct_date: pct, expiry_date: dayOf(row.expiry_calc),
          production_date: pd, batch_lot: r.noTem ? lot : null, location_code: r.noTem ? null : loc, locations: [], available: 0, count: 0,
          qa_name: r.qaHeld ? (row.qa_status?.name ?? row.qa_status?.code ?? null) : null, expired: false, violation: false,
          approval: r.noTem ? r.approval : null, items: [], minKey: r.key }
        groups.set(gk, g)
      }
      g.available += avail; g.count++
      if (r.expired) g.expired = true
      if (loc && !g.locations.includes(loc)) g.locations.push(loc)
      if (pct != null && (g.pct_date == null || pct < g.pct_date)) g.pct_date = pct   // FIFO / LIFO gom theo NSX — HSD trên tem có thể khác nhau
      if (r.key != null && (g.minKey == null || r.key < g.minKey)) g.minKey = r.key
      if (nItems < PICK_ITEM_CAP) {
        g.items.push({ entry_id: row.id, pallet_code: row.pallet_code, batch: row.batch ?? null, location_code: loc, available: avail,
          import_date: dayOf(row.import_date), expired: r.expired, approval: r.noTem ? null : r.approval })
        nItems++
      }
    }
    const stateOrder = { OK: 0, EXPIRED: 1, QA: 2 } as const
    const sorted = [...groups.values()].sort((a, b) => (stateOrder[a.state] - stateOrder[b.state])
      || ((a.minKey ?? Infinity) - (b.minKey ?? Infinity)) || (a.available - b.available) || a.key.localeCompare(b.key))
    let rank = 0
    const out: PickGroup[] = sorted.map(({ minKey, ...g }, i) => ({ ...g, pos: i,
      rank: g.state === 'OK' ? ++rank : null,
      violation: g.state === 'OK' && !!best && isRotationViolation(minKey, best.key) }))
    return ok(res, {
      principle: ctx.principle, required: ctx.required, source: ctx.source, date_label: ROTATION_DATE_LABEL[ctx.principle],
      today: vnDayOf(new Date()), total: ctx.ranked.length, truncated: nItems >= PICK_ITEM_CAP,
      best: best ? { kind: best.noTem ? 'LOT' : 'TEM', pallet_code: best.noTem ? null : best.row.pallet_code, location_code: best.row.location?.location_code ?? null,
        rot_date: rotationDateOf(best.row, ctx.material, ctx.principle), batch_lot: best.noTem ? lotOf(best.row.batch) : null,
        production_date: best.noTem ? dayOf(best.row.production_date) : null } : null,
      tem_groups: out.filter(g => g.kind === 'TEM'), lot_groups: out.filter(g => g.kind === 'LOT'),
    })
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/batches/:id/consume-lot — rút theo LÔ (không có tem): mã + NSX / mã lô + số lượng, FEFO trong lô
export const zConsumeLot = z.object({
  material_id: zText(1, 64), production_date: zDay.nullable(), batch_lot: zText(1, 60).nullable().optional(),
  qty: z.number().positive().max(10_000_000), qty_semantics: z.literal('base'),
  // 17/11 — đồng bộ cửa quét tem: lấy khác thứ tự khi kho bật "bắt buộc" (mã lý do ROTATION_REASONS, quyền outbound.rotation_override)
  rotation_override_reason: zText(1, 200).optional(),
})
export async function consumeLot(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zConsumeLot>
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const gateErr = await consumeGateError(b)
    if (gateErr) return fail(res, 409, 'MES_NOT_APPROVED', gateErr)
    const { data: m } = await db.from('Material').select('base_unit, entry_unit, units_per_carton').eq('id', body.material_id).maybeSingle()
    if (!m) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mã nguyên liệu')
    const intErr = qtyIntegerError(body.qty, m)
    if (intErr) return fail(res, 422, 'QTY_NOT_INTEGER', intErr)
    // LUÂN CHUYỂN — ĐỒNG BỘ cửa quét tem (17/11 "đồng bộ luôn phần không có tem"): lô đã chọn chấm như một tem — khoá xếp
    // của lô = sớm nhất trong các dòng không tem của lô; so với hàng nên lấy trước của CẢ mã (có tem lẫn không tem).
    const ctx = await mesPickContext(b.warehouse_id, body.material_id, b.id)
    const lot = lotOf(body.batch_lot)
    const inLot = (r: Ranked) => r.noTem && !r.qaHeld && dayOf(r.row.production_date) === body.production_date && lotOf(r.row.batch) === lot
    const mine = ctx.ranked.filter(inLot)
    const lotKey = mine.reduce<number | null>((k, r) => (r.key == null ? k : k == null ? r.key : Math.min(k, r.key)), null)
    const head = mine.find(r => r.key === lotKey) ?? mine[0]
    const rot = mesRotationVerdict(ctx, lotKey, head ? rotationDateOf(head.row, ctx.material, ctx.principle) : null, inLot)
    const gate = rotationGate(req, rot, body.rotation_override_reason)
    if (gate.error) return fail(res, 422, gate.error[0], gate.error[1])
    // HẾT HẠN: cửa ghi mes_consume_lot tự chặn lô quá HSD chưa có QA duyệt cho mẻ này
    const { data, error } = await db.rpc('mes_consume_lot', { p: {
      batch_id: b.id, material_id: body.material_id, production_date: body.production_date, batch_lot: body.batch_lot ?? null,
      qty: body.qty, ...actor(req),
      rotation: { violation: rot.violation, principle: rot.principle, best_date: rot.best_date, override_reason: gate.override },
    } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// ── NVL HẾT HẠN (user chốt 17/11 "chặn và cho qua khi QA duyệt") — duyệt TỪNG TEM hoặc TỪNG LÔ không tem, cho TỪNG MẺ ──
//   POST /batches/:id/expiry-approvals         (consume)         người cấp gửi QA duyệt  → PENDING (đã REJECTED thì gửi lại)
//   POST /batches/:id/expiry-approvals/decide  (approve_expired) QA duyệt / từ chối, kèm căn cứ — chưa có yêu cầu vẫn duyệt thẳng được
// Cả hai đi hàm DB (mes_expiry_request / mes_expiry_decide): mẻ phải đang mở, đối tượng phải ở kho của mẻ và ĐANG hết hạn
// (cùng định nghĩa `expiry_calc < hôm nay` với cửa cấp).
const zExpirySubject = {
  entry_id: zText(1, 100).optional(), material_id: zText(1, 64).optional(),
  production_date: zDay.nullable().optional(), batch_lot: zText(1, 60).nullable().optional(),
}
export const zExpiryRequest = z.object({ ...zExpirySubject, note: zText(0, 500).optional() })
export const zExpiryDecide = z.object({ ...zExpirySubject, decision: z.enum(['APPROVED', 'REJECTED']), note: zText(1, 500) })
async function expiryCall(req: Request, res: Response, fn: 'mes_expiry_request' | 'mes_expiry_decide', extra: Record<string, unknown>) {
  try {
    const body = req.body as z.infer<typeof zExpiryRequest>
    if (!body.entry_id && !body.material_id) return fail(res, 422, 'MES_SUBJECT', 'Chọn tem hoặc lô cần duyệt')
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.rpc(fn, { p: {
      batch_id: b.id, entry_id: body.entry_id ?? null, material_id: body.entry_id ? null : (body.material_id ?? null),
      production_date: body.production_date ?? null, batch_lot: body.batch_lot ?? null, note: body.note ?? null, ...extra, ...actor(req),
    } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}
export const expiryRequest = (req: Request, res: Response) => expiryCall(req, res, 'mes_expiry_request', {})
export const expiryDecide = (req: Request, res: Response) =>
  expiryCall(req, res, 'mes_expiry_decide', { decision: (req.body as z.infer<typeof zExpiryDecide>).decision })

// POST /wms/production/consumption/:id/reverse — huỷ dòng rút ghi nhầm (hoàn tồn, giữ vết)
export const zReverse = z.object({ reason: zText(1, 500) })
export async function reverseConsumption(req: Request, res: Response) {
  try {
    const { data: c } = await db.from('batch_consumption').select('id, batch:production_batch!batch_consumption_batch_id_fkey(warehouse_id)').eq('id', req.params.id).maybeSingle()
    if (!c) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy dòng rút')
    if (!(await inScope(req, (c.batch as unknown as { warehouse_id: string } | null)?.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.rpc('mes_consume_reverse', { p: { consumption_id: c.id, reason: (req.body as { reason: string }).reason, ...actor(req) } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// GET /wms/production/stock?warehouse_id=&material_id=&search= — tồn rút được ở kho chế biến: danh sách MÃ, hoặc các LÔ của một mã
export const zStockQuery = z.object({ warehouse_id: zText(1, 64), material_id: zText(1, 64).optional(), search: zText(0, 80).optional() })
export async function stock(req: Request, res: Response) {
  try {
    const q = req.query as unknown as z.infer<typeof zStockQuery>
    if (!(await inScope(req, q.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.rpc('mes_stock', { p_wh: q.warehouse_id, p_material: q.material_id ?? undefined, p_search: q.search ?? undefined, p_limit: 50 })
    if (error) return fail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// ═══ BỒN ═══════════════════════════════════════════════════════════════════════════════════════

type LotView = { id: string; tank_id: string; batch_id: string; qty_in: number; qty_remaining: number; filled_at: string; expires_at: string | null;
  batch: { batch_code: string; batch_no: number | null; cycle: string | null; shift: string | null; qa_status: string; material: { material_code: string; short_name: string | null } | null } | null }

// GET /wms/production/tanks?warehouse_id= — bồn của kho + lô đang chứa (mỗi kho vài chục bồn — không phân trang)
export const zTankListQuery = z.object({ warehouse_id: zText(1, 64).optional(), include_inactive: z.enum(['0', '1']).optional() })
export async function listTanks(req: Request, res: Response) {
  try {
    const q = req.query as unknown as z.infer<typeof zTankListQuery>
    if (q.warehouse_id && !(await inScope(req, q.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    let tq = db.from('production_tank').select('*, warehouse:Warehouse!production_tank_warehouse_id_fkey(code, name)').order('warehouse_id').order('code').limit(1000)
    if (q.warehouse_id) tq = tq.in('warehouse_id', (await withChildren(q.warehouse_id)).slice(0, 301))   // kho + ≤300 kho phụ trực thuộc (withChildren đã limit 300)
    else { const s = await scopeWithChildren(req); if (s !== null) { if (!s.length) return ok(res, []); tq = tq.in('warehouse_id', s.slice(0, 300)) } }   // ≤300: phạm vi kho của MỘT người
    if (q.include_inactive !== '1') tq = tq.eq('is_active', true)
    const { data: tanks, error } = await tq
    if (error) return fail(res, error)
    const ids = (tanks ?? []).map(t => t.id)
    const lots: LotView[] = []
    // SƠ ĐỒ BỒN 2D (18/11 g): sổ đóng gói ĐANG MỞ rút từ bồn ⇒ ống ra của bồn chạy tới máy đóng gói (đọc song song với lô)
    type RunView = { id: string; tank_id: string | null; machine_code: string; material_code: string; start_at: string; shift: string | null }
    const runs: RunView[] = []
    await Promise.all([
      (async () => {
        for (let i = 0; i < ids.length; i += 300) {
          const { data } = await db.from('tank_lot')
            .select('id, tank_id, batch_id, qty_in, qty_remaining, filled_at, expires_at, batch:production_batch!tank_lot_batch_id_fkey(batch_code, batch_no, cycle, shift, qa_status, material:Material!production_batch_material_id_fkey(material_code, short_name))')
            .in('tank_id', ids.slice(i, i + 300)).eq('status', 'ACTIVE').order('filled_at').limit(1000)
          lots.push(...((data ?? []) as unknown as LotView[]))
        }
      })(),
      (async () => {
        for (let i = 0; i < ids.length; i += 300) {
          const { data } = await db.from('packing_runs').select('id, tank_id, machine_code, material_code, start_at, shift')
            .in('tank_id', ids.slice(i, i + 300)).eq('status', 'OPEN').order('start_at').limit(1000)
          runs.push(...((data ?? []) as RunView[]))
        }
      })(),
    ])
    // mẻ đang mở ĐÃ ĐẶT bồn mà chưa nạp đủ ⇒ phần "sắp vào" của bồn (sơ đồ bồn vẽ phần này; tạo mẻ trừ phần này khỏi chỗ trống)
    type Planned = { id: string; tank_id: string | null; batch_code: string; cycle: string | null; batch_no: number | null; planned_qty: number | null
      shift: string | null; created_at: string; material: { material_code: string; short_name: string | null } | null }
    const planned: Planned[] = []
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await db.from('production_batch')
        .select('id, tank_id, batch_code, cycle, batch_no, planned_qty, shift, created_at, material:Material!production_batch_material_id_fkey(material_code, short_name)')
        .in('tank_id', ids.slice(i, i + 300)).eq('status', 'OPEN').order('created_at').limit(1000)
      planned.push(...((data ?? []) as unknown as Planned[]))
    }
    const filled = new Map<string, number>()
    const pids = planned.map(x => x.id)
    for (let i = 0; i < pids.length; i += 300) {
      const { data } = await db.from('tank_movement').select('batch_id, qty').in('batch_id', pids.slice(i, i + 300)).eq('kind', 'FILL').limit(5000)
      for (const mv of data ?? []) if (mv.batch_id) filled.set(mv.batch_id, (filled.get(mv.batch_id) ?? 0) + Number(mv.qty))
    }
    // SƠ ĐỒ BỒN (18/11 f — "bồn nằm sau khâu của mẻ ⇒ mẻ cũng hiện lên sơ đồ, liên kết với tình trạng"): mẻ sắp vào mang tình trạng + bước
    // đang tới, MỘT lần gọi cho mọi mẻ (mes_batch_steps → cùng hàm cổng mes_batch_gate với danh sách mẻ / trang mẻ)
    const waitIds = pids.filter(id => !filled.has(id))
    let steps: Record<string, { stage: string | null; step: string | null }> = {}
    if (waitIds.length) {
      const { data, error: se } = await db.rpc('mes_batch_steps', { p_ids: waitIds.slice(0, 2000) })
      if (se) return fail(res, se)
      steps = (data ?? {}) as typeof steps
    }
    const now = Date.now()
    const out = (tanks ?? []).map(t => {
      const ls = lots.filter(l => l.tank_id === t.id)
      const content = ls.reduce((s, l) => s + Number(l.qty_remaining), 0)
      // mẻ GIỮ CHỖ tới lần nạp đầu tiên (18/11 — bỏ "đóng mẻ": trước đây đóng mẻ mới nhả phần chưa nạp; cùng luật hàm mes_tank_room_check)
      const incoming = planned.filter(x => x.tank_id === t.id && !filled.has(x.id))
        .map(x => ({ batch_id: x.id, batch_code: x.batch_code, cycle: x.cycle, batch_no: x.batch_no, material_code: x.material?.material_code ?? null,
          material_name: x.material?.short_name ?? null, qty: round3(Math.max(Number(x.planned_qty ?? 0), 0)), started: false,
          shift: x.shift, created_at: x.created_at, stage: steps[x.id]?.stage ?? null, step: steps[x.id]?.step ?? null }))
        .filter(x => x.qty > 0)
      const qa = ls.map(l => l.batch?.qa_status)
      return {
        ...t, content, lots: ls, incoming, reserved: round3(incoming.reduce((s, x) => s + x.qty, 0)),
        runs: runs.filter(r => r.tank_id === t.id).map(r => ({ id: r.id, machine_code: r.machine_code, material_code: r.material_code, start_at: r.start_at, shift: r.shift })),
        qa_state: !ls.length ? 'EMPTY' : qa.includes('REJECTED') ? 'REJECTED' : qa.some(x => x !== 'RELEASED') ? 'HOLD' : 'RELEASED',
        qa_pending: ls.some(l => l.batch?.qa_status !== 'RELEASED'),
        expired: ls.some(l => !!l.expires_at && Date.parse(l.expires_at) < now),
        next_expiry: ls.map(l => l.expires_at).filter((x): x is string => !!x).sort()[0] ?? null,
      }
    })
    return ok(res, out)
  } catch (e) { return failAny(res, e) }
}

// GET /wms/production/tanks/:id/movements?page= — sổ bồn
export const zTankMovesQuery = z.object({ page: z.coerce.number().int().min(1).max(100000).optional() })
export async function tankMovements(req: Request, res: Response) {
  try {
    const t = await loadTank(req.params.id)
    if (!t) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy bồn')
    if (!(await inScope(req, t.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const page = Number((req.query as { page?: number }).page ?? 1), size = 200
    const { data, error, count } = await db.from('tank_movement')
      .select('id, kind, qty, packing_run_id, ref_tank_id, reason, warning, created_by_name, created_at, batch:production_batch!tank_movement_batch_id_fkey(batch_code)', { count: 'exact' })
      .eq('tank_id', t.id).order('created_at', { ascending: false }).range((page - 1) * size, page * size - 1)
    if (error) return fail(res, error)
    return ok(res, { rows: data ?? [], total: count ?? 0, page, pageSize: size })
  } catch (e) { return failAny(res, e) }
}

// PUT /wms/production/tank-layout — chỗ đặt bồn trên SƠ ĐỒ 2D (18/11 g, quyền manage_tank): [{ id, x, y }] theo điểm sơ đồ, tính trong khung
// kho chế biến của bồn; x = y = null ⇒ về tự xếp. Mọi bồn phải thuộc kho trong phạm vi người sửa. Ghi một lượt (RPC), realtime qua production_tank.
export const zTankLayout = z.object({
  items: z.array(z.object({
    id: zText(1, 64), x: z.number().int().min(0).max(100000).nullable(), y: z.number().int().min(0).max(100000).nullable(),
  }).refine(v => (v.x === null) === (v.y === null), 'x và y cùng có giá trị hoặc cùng để trống')).min(1).max(500),
})
export async function saveTankLayout(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zTankLayout>
    const ids = [...new Set(body.items.map(i => i.id))]
    if (ids.length !== body.items.length) return fail(res, 422, 'DUPLICATE', 'Một bồn chỉ có một chỗ đặt')
    const found: { id: string; warehouse_id: string }[] = []
    for (let i = 0; i < ids.length; i += 300) {
      const { data, error } = await db.from('production_tank').select('id, warehouse_id').in('id', ids.slice(i, i + 300))
      if (error) return fail(res, error)
      found.push(...(data ?? []))
    }
    if (found.length !== ids.length) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy bồn')
    const whs = [...new Set(found.map(t => t.warehouse_id))]
    for (const w of whs) if (!(await inScope(req, w))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.rpc('mes_tank_layout_save', { p: { items: body.items, warehouse_ids: whs, actor_name: actor(req).actor_name } })
    if (error) return mesFail(res, error)
    return ok(res, { updated: Number(data ?? 0) })
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/tanks · PATCH /wms/production/tanks/:id — danh mục bồn (manage_tank)
export const zTankCreate = z.object({
  warehouse_id: zText(1, 64), code: zText(1, 20), name: zText(0, 100).optional(), capacity: z.number().positive().max(10_000_000),
  unit: z.enum(['L', 'KG']), note: zText(0, 500).optional(),
})
export async function createTank(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zTankCreate>
    if (!(await inScope(req, body.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const whErr = await productionWhError(body.warehouse_id)
    if (whErr) return fail(res, 422, 'NOT_PRODUCTION_WAREHOUSE', whErr)
    const code = normalizeBatchCode(body.code)
    if (!/^[A-Z0-9][A-Z0-9_.-]{0,19}$/.test(code)) return fail(res, 422, 'TANK_CODE', 'Mã bồn chỉ gồm chữ, số và _ . - (tối đa 20 ký tự)')
    const a = actor(req)
    const { data, error } = await db.from('production_tank').insert({
      id: randomUUID(), warehouse_id: body.warehouse_id, code, name: body.name || null, capacity: body.capacity, unit: body.unit,
      note: body.note || null, is_active: true, created_by: a.actor_name, updated_by: a.actor_name, updated_at: nowIso(),
    }).select('*').single()
    if (error) return error.code === '23505' ? fail(res, 409, 'TANK_DUP', `Bồn ${code} đã có ở kho này`) : fail(res, error)
    return ok(res, data, 201)
  } catch (e) { return failAny(res, e) }
}
export const zTankUpdate = z.object({
  name: zText(0, 100).nullable().optional(), capacity: z.number().positive().max(10_000_000).optional(),
  unit: z.enum(['L', 'KG']).optional(), is_active: z.boolean().optional(), note: zText(0, 500).nullable().optional(),
})
export async function updateTank(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zTankUpdate>
    const t = await loadTank(req.params.id)
    if (!t) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy bồn')
    if (!(await inScope(req, t.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data: lots } = await db.from('tank_lot').select('qty_remaining').eq('tank_id', t.id).eq('status', 'ACTIVE').limit(500)
    const content = (lots ?? []).reduce((s, l) => s + Number(l.qty_remaining), 0)
    if (content > 0) {
      if (body.unit !== undefined && body.unit !== t.unit) return fail(res, 409, 'TANK_NOT_EMPTY', 'Bồn đang có hàng — không đổi đơn vị được')
      if (body.capacity !== undefined && body.capacity < content) return fail(res, 409, 'TANK_NOT_EMPTY', `Bồn đang chứa ${content} ${t.unit} — sức chứa không được nhỏ hơn`)
      if (body.is_active === false) return fail(res, 409, 'TANK_NOT_EMPTY', 'Bồn đang có hàng — rút / chuyển / xả hết trước khi ngừng dùng')
    }
    const patch: TablesUpdate<'production_tank'> = { updated_at: nowIso(), updated_by: resolveActorName(req) }
    if (body.name !== undefined) patch.name = body.name || null
    if (body.capacity !== undefined) patch.capacity = body.capacity
    if (body.unit !== undefined) patch.unit = body.unit
    if (body.is_active !== undefined) patch.is_active = body.is_active
    if (body.note !== undefined) patch.note = body.note || null
    const { data, error } = await db.from('production_tank').update(patch).eq('id', t.id).select('*')
    if (error) return fail(res, error)
    return ok(res, data?.[0] ?? null)
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/tanks/:id/fill — nạp BTP của mẻ vào bồn
export const zTankFill = z.object({ batch_id: zText(1, 64), qty: z.number().positive().max(10_000_000) })
export async function fillTank(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zTankFill>
    const t = await loadTank(req.params.id)
    if (!t) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy bồn')
    if (!(await inScope(req, t.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.rpc('mes_tank_fill', { p: { tank_id: t.id, batch_id: body.batch_id, qty: round3(body.qty), ...actor(req) } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/tanks/:id/adjust — khớp mức bồn với đồng hồ (bắt buộc lý do)
export const zTankAdjust = z.object({ level: z.number().min(0).max(10_000_000), reason: zText(1, 500) })
export async function adjustTank(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zTankAdjust>
    const t = await loadTank(req.params.id)
    if (!t) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy bồn')
    if (!(await inScope(req, t.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.rpc('mes_tank_adjust', { p: { tank_id: t.id, level: round3(body.level), reason: body.reason, ...actor(req) } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/tanks/:id/transfer — chuyển sang bồn khác cùng kho
export const zTankTransfer = z.object({ to_tank_id: zText(1, 64), qty: z.number().positive().max(10_000_000), reason: zText(0, 500).optional() })
export async function transferTank(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zTankTransfer>
    const t = await loadTank(req.params.id)
    if (!t) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy bồn')
    if (!(await inScope(req, t.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.rpc('mes_tank_transfer', { p: { from_tank_id: t.id, to_tank_id: body.to_tank_id, qty: round3(body.qty), reason: body.reason ?? null, ...actor(req) } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/tanks/:id/discard — xả bỏ (bắt buộc lý do)
export const zTankDiscard = z.object({ qty: z.number().positive().max(10_000_000), reason: zText(1, 500) })
export async function discardTank(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zTankDiscard>
    const t = await loadTank(req.params.id)
    if (!t) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy bồn')
    if (!(await inScope(req, t.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.rpc('mes_tank_take', { p: { tank_id: t.id, qty: round3(body.qty), kind: 'DISCARD', reason: body.reason, ...actor(req) } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/tanks/:id/qa — QA ĐẠT / KHÔNG ĐẠT / chờ ở BỒN (17/11): áp cho mọi mẻ đang có trong bồn — quyền qa_release
export const zTankQa = z.object({ qa_status: z.enum(['HOLD', 'RELEASED', 'REJECTED']), note: zText(0, 500).optional() })
export async function tankQa(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zTankQa>
    const t = await loadTank(req.params.id)
    if (!t) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy bồn')
    if (!(await inScope(req, t.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.rpc('mes_tank_qa', { p: { tank_id: t.id, qa_status: body.qa_status, note: body.note ?? null, ...actor(req) } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// ─── TEM PALLET CỦA MẺ + ĐỔ BỒN (17/11) ────────────────────────────────────────────────────────────────────────
// POST /wms/production/batches/:id/labels { count } — QA in tem pallet i/n của mẻ. Cùng số pallet + tem còn hiệu lực = in lại;
// đổi số pallet = bộ tem MỚI (tem cũ quét sẽ bị từ chối). Quyền print_label.
export const zBatchLabels = z.object({ count: z.number().int().min(1).max(99) })
export async function batchLabels(req: Request, res: Response) {
  try {
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.rpc('mes_batch_labels', { p: { batch_id: b.id, count: (req.body as z.infer<typeof zBatchLabels>).count, actor_name: actor(req).actor_name } })
    if (error) return mesFail(res, error)
    const r = data as { batch_code: string; count: number; ver: number; reprint: boolean }
    return ok(res, { ...r, labels: Array.from({ length: r.count }, (_, i) => ({ pallet_no: i + 1, qr: batchLabelQr(r.batch_code, i + 1, r.count, r.ver) })) })
  } catch (e) { return failAny(res, e) }
}

// "CHECK TRƯỚC KHI ĐỔ BỒN" CHỈ QUÉT (18/11 — user: "cái này chỉ quét, ko điền nhé"): bỏ khai chu kỳ · số mẻ · bồn đang đứng.
// Mẻ đến từ trang mẻ đang mở (batch_id), hoặc từ CHÍNH tem quét đầu tiên khi mở ở thẻ bồn (mã lô trong QR `MEB;<mã lô>;i;n;bản`);
// bồn đang đứng = thẻ bồn đã bấm ⇒ tem của mẻ thuộc bồn khác vẫn bị báo SAI BỒN ngay (mes_pour_scan).
// GET /wms/production/pour-status?batch_id= — tình trạng quét tem của một mẻ (form mở từ trang mẻ)
export const zPourStatusQuery = z.object({ batch_id: zText(1, 64) })
async function pourView(batchId: string) {
  const [{ data: b }, { data: gate }] = await Promise.all([
    db.from('production_batch').select('id, batch_code, cycle, batch_no, planned_qty, label_count, label_ver, label_at, tank_id, status, material:Material!production_batch_material_id_fkey(material_code, short_name, base_unit), tank:production_tank!production_batch_tank_id_fkey(id, code, capacity, unit)')
      .eq('id', batchId).maybeSingle(),
    db.rpc('mes_batch_gate', { p_batch_id: batchId }),
  ])
  if (!b) return null
  const [{ data: scans }, { data: mv }] = await Promise.all([
    db.from('batch_pour_scan').select('pallet_no, scanned_by_name, created_at').eq('batch_id', b.id).eq('label_ver', b.label_ver).order('pallet_no').limit(100),
    db.from('tank_movement').select('qty').eq('batch_id', b.id).eq('kind', 'FILL').limit(500),
  ])
  return { batch: b, scans: scans ?? [], gate: gate ?? null, filled: round3((mv ?? []).reduce((s, x) => s + Number(x.qty), 0)) }
}
export async function pourStatus(req: Request, res: Response) {
  try {
    const q = req.query as unknown as z.infer<typeof zPourStatusQuery>
    const b = await loadBatch(q.batch_id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    return ok(res, await pourView(b.id))
  } catch (e) { return failAny(res, e) }
}
// POST /wms/production/pour-scan { tank_id, code, batch_id? } — quét MỘT tem pallet của mẻ tại bồn; khớp mẻ + bồn + bản tem mới nhận.
// Không gửi batch_id (form mở ở thẻ bồn, chưa biết mẻ) ⇒ mẻ = mẻ ĐANG MỞ có mã lô in trong tem, cùng kho với bồn. Quyền pour.
export const zPourScan = z.object({ batch_id: zText(1, 64).optional(), tank_id: zText(1, 64), code: zText(1, 200) })
export async function pourScan(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zPourScan>
    const label = parseBatchLabel(body.code)
    if (!label) return fail(res, 422, 'NOT_BATCH_LABEL', 'Đây không phải tem pallet của mẻ — quét tem QA đã dán lên pallet của mẻ')
    let batchId = body.batch_id
    if (!batchId) {
      const t = await loadTank(body.tank_id)
      if (!t) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy bồn')
      if (!(await inScope(req, t.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
      const { data: hit } = await db.from('production_batch').select('id')
        .eq('warehouse_id', t.warehouse_id).eq('batch_code', label.batch_code).eq('status', 'OPEN').limit(1).maybeSingle()
      if (!hit) return fail(res, 404, 'MES_LABEL_NO_BATCH', `Không có mẻ đang mở mã lô ${label.batch_code} ở kho của bồn ${t.code} — tem cũ (mẻ đã đổi bồn / số mẻ) thì nhờ QA in lại tem`)
      batchId = hit.id
    }
    const b = await loadBatch(batchId)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { error } = await db.rpc('mes_pour_scan', { p: { batch_id: b.id, tank_id: body.tank_id, label_code: label.batch_code, pallet_no: label.pallet_no,
      pallet_total: label.pallet_total, label_ver: label.label_ver, ...actor(req) } })
    if (error) return mesFail(res, error)
    return ok(res, { pallet_no: label.pallet_no, ...(await pourView(b.id)) })
  } catch (e) { return failAny(res, e) }
}

// ─── CÀI ĐẶT MES (14/11 tối — user: "setting nào liên quan thì chuyển sang Cài đặt MES") ─────────────────────────
// Hai thứ, MỘT cửa đọc + MỘT cửa ghi:
//   • công tắc "rút bồn còn lô CHỜ QA" — 2 tầng Kho chế biến + Loại kho (cột production_qa_gate ở Warehouse /
//     warehouse_type_configs; trước nằm ở Cài đặt WMS). Lô QA LOẠI luôn chặn, không có công tắc.
//   • hạn lưu bồn (giờ) của mã bán thành phẩm (Material.tank_hold_hours; trước nằm ở form Mã hàng).
const zGate = z.enum(PRODUCTION_QA_GATES)
export const zSettingsQuery = z.object({ warehouse_id: zText(1, 64) })
export const zSettingsPut = z.object({
  warehouse_id: zText(1, 64),
  production_qa_gate: zGate.optional(),
  mes_flow_gate: z.boolean().optional(),   // 17/11: chưa duyệt đủ thì chưa cấp NVL · chưa đủ điều kiện thì chưa nạp bồn (mặc định tắt = như cũ)
  types: z.array(z.object({ type_code: zText(1, 64), production_qa_gate: zGate.nullable() })).max(200).optional(),
  hold_hours: z.array(z.object({ material_id: zText(1, 64), tank_hold_hours: z.number().int().min(1).max(8760).nullable() })).max(300).optional(),
})

async function settingsOf(req: Request, whId: string) {
  const scope = scopeCategoriesOf(req)
  let mq = db.from('Material').select('id, material_code, short_name, category, base_unit, tank_hold_hours')
    .not('tank_hold_hours', 'is', null).order('material_code').limit(500)
  if (scope) mq = mq.or(`category.is.null,category.in.(${scope.map(c => `"${c.replace(/"/g, '')}"`).join(',')})`)
  const [{ data: wh }, { data: types }, { data: mats }] = await Promise.all([
    db.from('Warehouse').select('id, code, name, production_qa_gate, mes_flow_gate').eq('id', whId).maybeSingle(),
    db.from('warehouse_type_configs').select('type_code, production_qa_gate, sort_order').eq('warehouse_id', whId)
      .order('sort_order', { ascending: true, nullsFirst: false }).order('type_code').limit(200),
    mq,
  ])
  return {
    warehouse_id: whId,
    production_qa_gate: wh?.production_qa_gate ?? 'WARN',
    mes_flow_gate: wh?.mes_flow_gate === true,
    types: (types ?? []).filter(t => categoryAllowed(req, t.type_code)).map(t => ({ type_code: t.type_code, production_qa_gate: t.production_qa_gate })),
    hold_hours: mats ?? [],
  }
}

export async function getSettings(req: Request, res: Response) {
  try {
    const { warehouse_id } = req.query as unknown as z.infer<typeof zSettingsQuery>
    if (!(await inScope(req, warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const whErr = await productionWhError(warehouse_id)
    if (whErr) return fail(res, 422, 'NOT_PRODUCTION_WAREHOUSE', whErr)
    return ok(res, await settingsOf(req, warehouse_id))
  } catch (e) { return failAny(res, e) }
}

export async function putSettings(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zSettingsPut>
    if (!(await inScope(req, body.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const whErr = await productionWhError(body.warehouse_id)
    if (whErr) return fail(res, 422, 'NOT_PRODUCTION_WAREHOUSE', whErr)
    const now = new Date().toISOString()
    const who = req.user?.name || null
    // kiểm hết rồi mới ghi — không ghi dở một nửa
    const types = body.types ?? []
    if (types.some(t => !categoryAllowed(req, t.type_code))) return fail(res, 403, 'FORBIDDEN', CATEGORY_FORBIDDEN_MSG)
    if (new Set(types.map(t => t.type_code)).size !== types.length) return fail(res, 422, 'DUPLICATE', 'Loại kho bị khai trùng')
    const holds = body.hold_hours ?? []
    if (new Set(holds.map(h => h.material_id)).size !== holds.length) return fail(res, 422, 'DUPLICATE', 'Mã hàng bị khai trùng')
    if (holds.length) {
      const { data: mats } = await db.from('Material').select('id, material_code, category, base_unit, is_semi_finished').in('id', holds.map(h => h.material_id)).limit(300)   // ≤300: zod chặn
      if ((mats ?? []).length !== holds.length) return fail(res, 404, 'NOT_FOUND', 'Có mã hàng không còn trong danh mục')
      if ((mats ?? []).some(m => !categoryAllowed(req, m.category))) return fail(res, 403, 'FORBIDDEN', CATEGORY_FORBIDDEN_MSG)
      // KHAI hạn lưu bồn chỉ cho mã BTP; GỠ hạn (null) thì mã nào cũng được — dọn được hạn cũ
      const setIds = new Set(holds.filter(h => h.tank_hold_hours != null).map(h => h.material_id))
      for (const m of mats ?? []) {
        const e = setIds.has(m.id) ? btpUseError(m) : null
        if (e) return fail(res, 422, e.code, e.message)
      }
    }
    if (types.length) {
      const { data: cur } = await db.from('warehouse_type_configs').select('type_code').eq('warehouse_id', body.warehouse_id).limit(500)
      const known = new Set((cur ?? []).map(r => r.type_code))
      const miss = types.find(t => !known.has(t.type_code))
      if (miss) return fail(res, 422, 'UNKNOWN_TYPE', `Kho này chưa có Loại kho "${miss.type_code.slice(0, 30)}"`)
    }

    if (body.production_qa_gate !== undefined || body.mes_flow_gate !== undefined) {
      const { data, error } = await db.from('Warehouse').update({
        ...(body.production_qa_gate !== undefined ? { production_qa_gate: body.production_qa_gate } : {}),
        ...(body.mes_flow_gate !== undefined ? { mes_flow_gate: body.mes_flow_gate } : {}), updated_at: now, updated_by: who })
        .eq('id', body.warehouse_id).select('id')
      if (error) return fail(res, error)
      if (!data?.length) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')
    }
    // số dòng = số Loại kho của MỘT kho / số mã đổi trong MỘT lần lưu (cấu hình, ≤ vài chục) — gom theo GIÁ TRỊ để ghi theo lô
    const byGate = new Map<string, string[]>()
    for (const t of types) { const k = t.production_qa_gate ?? ''; byGate.set(k, [...(byGate.get(k) ?? []), t.type_code]) }
    for (const [k, codes] of byGate) for (let i = 0; i < codes.length; i += 300) {
      const chunk = codes.slice(i, i + 300)
      const { error } = await db.from('warehouse_type_configs').update({ production_qa_gate: k || null, updated_at: now, updated_by: who })
        .eq('warehouse_id', body.warehouse_id).in('type_code', chunk)
      if (error) return fail(res, error)
    }
    const byHours = new Map<string, string[]>()
    for (const h of holds) { const k = h.tank_hold_hours == null ? '' : String(h.tank_hold_hours); byHours.set(k, [...(byHours.get(k) ?? []), h.material_id]) }
    for (const [k, ids] of byHours) for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300)
      const { error } = await db.from('Material').update({ tank_hold_hours: k ? Number(k) : null, updated_at: now })
        .in('id', chunk)
      if (error) return fail(res, error)
    }
    invalidatePutawayConfig(body.warehouse_id)
    return ok(res, await settingsOf(req, body.warehouse_id))
  } catch (e) { return failAny(res, e) }
}

// ─── BÁO CÁO SỬ DỤNG NGUYÊN VẬT LIỆU THEO CA (thay biểu mẫu giấy NB-QA-BM-CB.01 — 14/11 đêm) ───────────────────────
// Một báo cáo = một ca của một kho chế biến. Số tự tính từ các lần cấp nguyên liệu cho mẻ; người chỉ nhập TỒN CUỐI THỰC TẾ rồi chốt.
export const zShiftListQuery = z.object({ warehouse_id: zText(1, 64) })
export async function listShiftReports(req: Request, res: Response) {
  try {
    const { warehouse_id } = req.query as unknown as z.infer<typeof zShiftListQuery>
    if (!(await inScope(req, warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.from('production_shift_report')
      .select('id, warehouse_id, report_date, shift, from_at, to_at, status, note, opened_by_name, closed_by_name, created_at')
      .eq('warehouse_id', warehouse_id).order('from_at', { ascending: false }).limit(120)
    if (error) return fail(res, error)
    return ok(res, data ?? [])
  } catch (e) { return failAny(res, e) }
}
export const zShiftOpen = z.object({ warehouse_id: zText(1, 64), report_date: zDay, shift: zText(1, 40) })
export async function openShiftReport(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zShiftOpen>
    if (!(await inScope(req, body.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const whErr = await productionWhError(body.warehouse_id)
    if (whErr) return fail(res, 422, 'NOT_PRODUCTION_WAREHOUSE', whErr)
    const { data, error } = await db.rpc('mes_shift_open', { p: { ...body, shift: body.shift.trim(), actor_name: actor(req).actor_name } })
    if (error) return mesFail(res, error)
    return ok(res, data, 201)
  } catch (e) { return failAny(res, e) }
}
async function shiftWh(id: string): Promise<string | null> {
  const { data } = await db.from('production_shift_report').select('warehouse_id').eq('id', id).maybeSingle()
  return data?.warehouse_id ?? null
}
export async function getShiftReport(req: Request, res: Response) {
  try {
    const wh = await shiftWh(req.params.id)
    if (!wh) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy báo cáo ca')
    if (!(await inScope(req, wh))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.rpc('mes_shift_report', { p_report_id: req.params.id })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}
// PUT /wms/production/shift-reports/:id — lưu số đếm tồn cuối thực tế (nháp) hoặc CHỐT ca (close = true ⇒ chụp mọi con số, không sửa lại được)
export const zShiftSave = z.object({
  items: z.array(z.object({ material_id: zText(1, 64), qty_actual: z.number().min(0).max(100_000_000).nullable() })).max(500),
  note: zText(0, 1000).nullable().optional(), close: z.boolean().optional(),
})
export async function saveShiftReport(req: Request, res: Response) {
  try {
    const wh = await shiftWh(req.params.id)
    if (!wh) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy báo cáo ca')
    if (!(await inScope(req, wh))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const body = req.body as z.infer<typeof zShiftSave>
    if (new Set(body.items.map(i => i.material_id)).size !== body.items.length) return fail(res, 422, 'DUPLICATE', 'Một nguyên liệu bị khai hai lần')
    const a = actor(req)
    const { error } = await db.rpc('mes_shift_save', { p: {
      report_id: req.params.id, items: body.items.map(i => ({ material_id: i.material_id, qty_actual: i.qty_actual == null ? null : round3(i.qty_actual) })),
      ...(body.note !== undefined ? { note: body.note } : {}), close: body.close === true, actor_id: a.actor_id, actor_name: a.actor_name,
    } })
    if (error) return mesFail(res, error)
    const { data } = await db.rpc('mes_shift_report', { p_report_id: req.params.id })
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// ── BÁO CÁO NVL THEO CHU KỲ (18/11 f — user: "theo chu kỳ, chu kỳ là lớn hơn ca, mẻ" · "cuối chu kỳ, nhưng tách ra ca, mẻ — từ đó ra được
// các chỉ số của nhân sự, số liệu"). Chu kỳ = (kho chế biến, production_batch.cycle); ca của mẻ = ca khai lúc mở mẻ. Mọi con số tính ở DB
// (mes_cycle_list / mes_cycle_report — chỉ đọc sổ gốc; sheet thô của file đọc mes_consumption_raw), màn hình xem realtime qua chính các sổ đó.
export const zCycleListQuery = z.object({ warehouse_id: zText(1, 64), search: zText(0, 20).optional() })
export async function listCycles(req: Request, res: Response) {
  try {
    const q = req.query as unknown as z.infer<typeof zCycleListQuery>
    if (!(await inScope(req, q.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const search = q.search ? normalizeCycle(q.search) : ''
    const { data, error } = await db.rpc('mes_cycle_list', { p: { warehouse_id: q.warehouse_id, search: search || null } })
    if (error) return fail(res, error)
    return ok(res, data ?? [])
  } catch (e) { return failAny(res, e) }
}
export const zCycleQuery = z.object({ warehouse_id: zText(1, 64), cycle: zText(1, 20) })
/** kho trong phạm vi + chu kỳ đúng dạng (cùng luật ô Chu kỳ của form Mở mẻ) — trả null khi đã trả lỗi */
async function cycleArgs(req: Request, res: Response): Promise<{ wh: string; cycle: string } | null> {
  const q = req.query as unknown as z.infer<typeof zCycleQuery>
  if (!(await inScope(req, q.warehouse_id))) { fail(res, 403, 'FORBIDDEN', SCOPE_MSG); return null }
  const cycle = normalizeCycle(q.cycle)
  if (!CYCLE_RE.test(cycle)) { fail(res, 400, 'BAD_CYCLE', 'Chu kỳ chỉ gồm chữ và số, tối đa 6 ký tự'); return null }
  return { wh: q.warehouse_id, cycle }
}
// GET /wms/production/cycles/report?warehouse_id=&cycle= — mẻ · NVL × mẻ (định mức ↔ thực cấp) · nhân sự của một chu kỳ
export async function cycleReport(req: Request, res: Response) {
  try {
    const a = await cycleArgs(req, res)
    if (!a) return res
    const { data, error } = await db.rpc('mes_cycle_report', { p_wh: a.wh, p_cycle: a.cycle })
    if (error) return fail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}
// ── DỮ LIỆU THÔ TIÊU HAO NVL (18/11 g — user: "tiêu hao NVL phải làm dạng raw data, có đầy đủ thông tin hết — để còn làm việc với ERP SAP").
// Mỗi dòng MỘT phát sinh như chứng từ kho của SAP: CẤP (+SL, lúc cấp) · HUỶ CẤP (−SL, lúc huỷ) — lọc theo ngày của chính phát sinh (giờ VN).
// MỘT hàm DB (mes_consumption_raw) cho màn "Dữ liệu thô", file xuất của nó và sheet thô của báo cáo chu kỳ ⇒ hai file cùng khuôn cột.
const zRawBase = {
  warehouse_id: zText(1, 64), date_from: zDay.optional(), date_to: zDay.optional(), cycle: zText(0, 20).optional(), search: zText(0, 80).optional(),
  event: z.enum(['ISSUE', 'REVERSAL']).optional(), flag: z.enum(['rotation', 'expiry', 'reversed']).optional(), sort: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
}
export const zRawQuery = z.object({ ...zRawBase, page_size: z.coerce.number().int().min(1).max(1000).optional() })
export const zRawExportQuery = z.object({ ...zRawBase, part: z.enum(['events', 'req', 'fill']).optional(), page_size: z.coerce.number().int().min(1).max(2000).optional() })
const RAW_MAX_DAYS = 366
/** kho trong phạm vi · chu kỳ đúng dạng · khoảng ngày đủ hai đầu, tối đa 367 ngày (không chọn chu kỳ thì bắt buộc) — trả null khi đã trả lỗi */
async function rawArgs(req: Request, res: Response): Promise<Record<string, string | number | null> | null> {
  const q = req.query as unknown as z.infer<typeof zRawExportQuery>
  if (!(await inScope(req, q.warehouse_id))) { fail(res, 403, 'FORBIDDEN', SCOPE_MSG); return null }
  let cycle: string | null = null
  if (q.cycle) {
    cycle = normalizeCycle(q.cycle)
    if (!CYCLE_RE.test(cycle)) { fail(res, 400, 'BAD_CYCLE', 'Chu kỳ chỉ gồm chữ và số, tối đa 6 ký tự'); return null }
  }
  const from = q.date_from ?? null, to = q.date_to ?? null
  if (!!from !== !!to) { fail(res, 400, 'DATE_RANGE', 'Chọn đủ Từ ngày và Đến ngày'); return null }
  if (!cycle && !from) { fail(res, 400, 'DATE_RANGE', 'Chọn khoảng ngày (hoặc một chu kỳ)'); return null }
  if (from && to) {
    const d0 = Date.parse(`${from}T00:00:00Z`), d1 = Date.parse(`${to}T00:00:00Z`)
    if (!Number.isFinite(d0) || !Number.isFinite(d1)) { fail(res, 400, 'DATE_RANGE', 'Ngày không hợp lệ'); return null }
    const days = (d1 - d0) / 86_400_000
    if (days < 0 || days > RAW_MAX_DAYS) { fail(res, 400, 'DATE_RANGE', `Khoảng ngày không hợp lệ — Đến ngày phải sau Từ ngày, tối đa ${RAW_MAX_DAYS + 1} ngày`); return null }
  }
  return {
    warehouse_id: q.warehouse_id, date_from: from, date_to: to, cycle, search: q.search?.trim() || null, event: q.event ?? null, flag: q.flag ?? null,
    sort: q.sort ?? 'desc', page: q.page ?? 1,
  }
}
// GET /wms/production/consumption-raw — màn "Dữ liệu thô": một trang phát sinh + tổng + dải số (quyền view)
export async function consumptionRaw(req: Request, res: Response) {
  try {
    const a = await rawArgs(req, res)
    if (!a) return res
    const size = (req.query as unknown as z.infer<typeof zRawQuery>).page_size ?? 200
    const { data, error } = await db.rpc('mes_consumption_raw', { p: { ...a, part: 'events', mode: 'page', page_size: size } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}
// GET /wms/production/consumption-raw/export?part=events|req|fill — file xuất (và sheet thô của báo cáo chu kỳ): lật trang tới hết (quyền export)
export async function consumptionRawExport(req: Request, res: Response) {
  try {
    const a = await rawArgs(req, res)
    if (!a) return res
    const q = req.query as unknown as z.infer<typeof zRawExportQuery>
    // file thô đi theo thứ tự thời gian (cũ → mới) như sổ chứng từ, trừ khi gọi chỉ rõ
    const { data, error } = await db.rpc('mes_consumption_raw', { p: { ...a, sort: q.sort ?? 'asc', part: q.part ?? 'events', mode: 'rows', page_size: q.page_size ?? 2000 } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// GET /wms/production/tanks-for-run?warehouse_id= — bồn chọn được cho trang sổ đóng gói ở kho này:
// bồn của chính kho + bồn của các KHO PHỤ trực thuộc (nhà máy đóng gói rút từ bồn ở kho chế biến của mình)
export const zTanksForRunQuery = z.object({ warehouse_id: zText(1, 64) })
export async function tanksForRun(req: Request, res: Response) {
  try {
    const { warehouse_id } = req.query as unknown as z.infer<typeof zTanksForRunQuery>
    if (!(await inScope(req, warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data: kids } = await db.from('Warehouse').select('id').eq('parent_warehouse_id', warehouse_id).limit(300)
    const whs = [warehouse_id, ...(kids ?? []).map(k => k.id)]
    const { data, error } = await db.from('production_tank').select('id, code, name, unit, capacity, warehouse_id, warehouse:Warehouse!production_tank_warehouse_id_fkey(name)')
      .in('warehouse_id', whs).eq('is_active', true).order('code').limit(500)
    if (error) return fail(res, error)
    return ok(res, data ?? [])
  } catch (e) { return failAny(res, e) }
}

/** Bồn `tankId` có được gắn vào trang sổ của kho `runWh` không (cùng kho hoặc kho phụ trực thuộc). Trả lỗi hoặc null. */
export async function tankForRunError(tankId: string, runWh: string): Promise<string | null> {
  const t = await loadTank(tankId)
  if (!t) return 'Không tìm thấy bồn'
  if (!t.is_active) return `Bồn ${t.code} đang ngừng dùng`
  if (t.warehouse_id === runWh) return null
  const { data: w } = await db.from('Warehouse').select('parent_warehouse_id').eq('id', t.warehouse_id).maybeSingle()
  return w?.parent_warehouse_id === runWh ? null : `Bồn ${t.code} không thuộc kho này hay kho chế biến trực thuộc`
}

// ═══ TRUY XUẤT SẢN XUẤT ═══════════════════════════════════════════════════════════════════════

// GET /wms/production/genealogy?kind=BATCH|FG_PALLET|RM_PALLET&value= — gia phả lô: NVL → mẻ → bồn → trang sổ → pallet TP
// Phạm vi: kho được giao + KHO PHỤ trực thuộc (người coi nhà máy truy được tới kho chế biến của nhà máy đó; chỉ ĐỌC).
export const zGenealogyQuery = z.object({ kind: z.enum(['BATCH', 'FG_PALLET', 'RM_PALLET']), value: zText(1, 200) })
export async function genealogy(req: Request, res: Response) {
  try {
    const q = req.query as unknown as z.infer<typeof zGenealogyQuery>
    const whIds = await scopeWithChildren(req)
    const { data, error } = await db.rpc('mes_genealogy', { p_kind: q.kind, p_value: normalizeQR(q.value), p_wh_ids: whIds ?? undefined, p_limit: 50 })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

