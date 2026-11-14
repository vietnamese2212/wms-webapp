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
import type { TablesUpdate } from '../../types/database'
import { normalizeBatchCode, BATCH_CODE_RE, batchCodeStem, nextBatchCode } from '../../utils/batchCode'
import { PRODUCTION_QA_GATES } from '../../utils/putaway'
import { invalidatePutawayConfig } from '../../services/putawayContext'
import { categoryAllowed, scopeCategoriesOf, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'

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
  const status = code === 'NOT_FOUND' ? 404 : ['QTY', 'REASON', 'UNIT', 'KIND', 'SAME_TANK', 'DUPLICATE', 'SELF'].includes(code) ? 422 : 409
  return fail(res, status, `MES_${code}`, text.trim())
}

type BatchRow = { id: string; warehouse_id: string; status: string; material_id: string; batch_code: string }
async function loadBatch(id: string): Promise<BatchRow | null> {
  const { data } = await db.from('production_batch').select('id, warehouse_id, status, material_id, batch_code').eq('id', id).maybeSingle()
  return (data as BatchRow | null) ?? null
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
  status: z.enum(['OPEN', 'CLOSED', 'CANCELLED']).optional(),
  qa: z.enum(['HOLD', 'RELEASED', 'REJECTED']).optional(),
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
      wh_ids: whIds, status: q.status ?? null, qa: q.qa ?? null, date_from: q.date_from ?? null, date_to: q.date_to ?? null,
      search: q.search ?? null, page: q.page ?? 1, page_size: q.pageSize ?? 100,
    } })
    if (error) return fail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// GET /wms/production/batches/next-code — mã lô gợi ý (app sinh, người mở mẻ sửa được — user chốt 14/11)
export const zNextCodeQuery = z.object({ warehouse_id: zText(1, 64), material_id: zText(1, 64), prod_date: zDay, machine_code: zText(0, 20).optional() })
export async function nextCode(req: Request, res: Response) {
  try {
    const q = req.query as unknown as z.infer<typeof zNextCodeQuery>
    if (!(await inScope(req, q.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data: m } = await db.from('Material').select('material_code, batch_prefix').eq('id', q.material_id).maybeSingle()
    if (!m) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mã bán thành phẩm')
    const stem = batchCodeStem(m.batch_prefix || m.material_code, q.prod_date, q.machine_code)
    const { data: rows } = await db.from('production_batch').select('batch_code').eq('warehouse_id', q.warehouse_id).like('batch_code', `${stem}%`).limit(1000)
    return ok(res, { code: nextBatchCode(stem, (rows ?? []).map(r => r.batch_code)), stem })
  } catch (e) { return failAny(res, e) }
}

// GET /wms/production/batches/:id — đầu mẻ + NVL đã rút + bồn đã nạp + lần rút cho trang sổ
export async function getBatch(req: Request, res: Response) {
  try {
    const { data: b, error } = await db.from('production_batch')
      .select('*, material:Material!production_batch_material_id_fkey(id, material_code, short_name, base_unit, entry_unit, units_per_carton, category, tank_hold_hours), warehouse:Warehouse!production_batch_warehouse_id_fkey(id, code, name, parent_warehouse_id)')
      .eq('id', req.params.id).maybeSingle()
    if (error) return fail(res, error)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const [{ data: cons }, { data: moves }, { data: lots }, { data: board }] = await Promise.all([
      db.from('batch_consumption')
        .select('*, material:Material!batch_consumption_material_id_fkey(material_code, short_name, base_unit, entry_unit, units_per_carton), entry:InventoryEntry!batch_consumption_entry_id_fkey(cartons_remaining, expiry_date, location:Location(location_code))')
        .eq('batch_id', b.id).order('created_at').limit(2000),
      db.from('tank_movement').select('id, tank_id, kind, qty, packing_run_id, reason, warning, created_by_name, created_at, tank:production_tank!tank_movement_tank_id_fkey(code)')
        .eq('batch_id', b.id).order('created_at').limit(2000),
      db.from('tank_lot').select('id, tank_id, qty_in, qty_remaining, filled_at, expires_at, status, tank:production_tank!tank_lot_tank_id_fkey(code, unit)')
        .eq('batch_id', b.id).order('filled_at').limit(500),
      db.rpc('mes_batch_board', { p_batch_id: b.id }),
    ])
    return ok(res, { ...b, consumption: cons ?? [], movements: moves ?? [], lots: lots ?? [], board: board ?? [] })
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/batches — MỞ MẺ (mã lô trống ⇒ app tự sinh; trùng ⇒ 409, gợi ý tự sinh thì thử lại số kế)
export const zBatchCreate = z.object({
  warehouse_id: zText(1, 64), material_id: zText(1, 64), prod_date: zDay,
  batch_code: zText(0, 40).optional(), machine_code: zText(0, 20).optional(), shift: zText(0, 40).optional(), cycle: zText(0, 20).optional(),
  planned_qty: z.number().positive().max(10_000_000).nullable().optional(), note: zText(0, 500).optional(),
})
export async function createBatch(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zBatchCreate>
    if (!(await inScope(req, body.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const whErr = await productionWhError(body.warehouse_id)
    if (whErr) return fail(res, 422, 'NOT_PRODUCTION_WAREHOUSE', whErr)
    const { data: m } = await db.from('Material').select('id, material_code, batch_prefix, base_unit, is_active').eq('id', body.material_id).maybeSingle()
    if (!m) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mã bán thành phẩm')
    if (m.is_active === false) return fail(res, 422, 'MATERIAL_INACTIVE', `Mã ${m.material_code} đang ngừng dùng`)
    const unit = String(m.base_unit ?? '').toUpperCase()
    if (unit !== 'L' && unit !== 'KG')
      return fail(res, 422, 'BTP_UNIT', `Mã ${m.material_code} tính theo "${m.base_unit ?? '—'}" — bán thành phẩm vào bồn phải có đơn vị gốc L hoặc KG (sửa ở Mã hàng)`)
    const typed = body.batch_code ? normalizeBatchCode(body.batch_code) : ''
    if (body.batch_code && !BATCH_CODE_RE.test(typed)) return fail(res, 422, 'BATCH_CODE', 'Mã lô chỉ gồm chữ, số và _ . - (tối đa 40 ký tự)')
    const machine = body.machine_code ? body.machine_code.toUpperCase() : null
    const stem = batchCodeStem(m.batch_prefix || m.material_code, body.prod_date, machine)
    const a = actor(req)
    for (let attempt = 0; attempt < 6; attempt++) {
      let code = typed
      if (!code) {
        const { data: rows } = await db.from('production_batch').select('batch_code').eq('warehouse_id', body.warehouse_id).like('batch_code', `${stem}%`).limit(1000)
        code = nextBatchCode(stem, (rows ?? []).map(r => r.batch_code))
      }
      const row = {
        id: randomUUID(), warehouse_id: body.warehouse_id, batch_code: code, material_id: m.id, prod_date: body.prod_date,
        machine_code: machine, shift: body.shift || null, cycle: body.cycle || null, planned_qty: body.planned_qty ?? null, note: body.note || null,
        status: 'OPEN', qa_status: 'HOLD', opened_by: a.actor_id, opened_by_name: a.actor_name, updated_at: nowIso(),
      }
      const { data, error } = await db.from('production_batch').insert(row).select('*').single()
      if (!error) {
        // bàn làm việc: chép ĐỊNH MỨC của mã BTP thành yêu cầu nguyên liệu của mẻ (không có định mức ⇒ bàn trống, người mở tự khai)
        const { data: ap, error: apErr } = await db.rpc('mes_batch_apply_recipe', { p: { batch_id: data.id, actor_name: a.actor_name } })
        if (apErr) console.error('[production] apply recipe', apErr.message)
        return ok(res, { ...data, requirement_count: (ap as { count?: number } | null)?.count ?? 0 }, 201)
      }
      if (error.code !== '23505') return fail(res, error)
      if (typed) return fail(res, 409, 'BATCH_CODE_DUP', `Mã lô ${typed} đã có ở kho này — đổi mã khác hoặc để trống cho app tự sinh`)
      await jitter(attempt)   // hai người cùng mở mẻ một lúc ⇒ người sau lấy số kế
    }
    return fail(res, 409, 'BUSY', 'Nhiều người đang mở mẻ cùng lúc — thử lại')
  } catch (e) { return failAny(res, e) }
}

// PATCH /wms/production/batches/:id — sửa mẻ. Đổi MÃ BTP / mã lô chỉ khi mẻ chưa rút NVL và chưa nạp bồn.
export const zBatchUpdate = z.object({
  batch_code: zText(1, 40).optional(), material_id: zText(1, 64).optional(), prod_date: zDay.optional(),
  machine_code: zText(0, 20).nullable().optional(), shift: zText(0, 40).nullable().optional(), cycle: zText(0, 20).nullable().optional(),
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
    if (body.cycle !== undefined) patch.cycle = body.cycle || null
    if (body.planned_qty !== undefined) patch.planned_qty = body.planned_qty
    if (body.note !== undefined) patch.note = body.note || null
    const identity = (body.batch_code !== undefined && normalizeBatchCode(body.batch_code) !== b.batch_code)
      || (body.material_id !== undefined && body.material_id !== b.material_id)
    if (identity) {
      const [{ count: nc }, { count: nm }] = await Promise.all([
        db.from('batch_consumption').select('id', { count: 'exact', head: true }).eq('batch_id', b.id).is('reversed_at', null),
        db.from('tank_movement').select('id', { count: 'exact', head: true }).eq('batch_id', b.id),
      ])
      if ((nc ?? 0) > 0 || (nm ?? 0) > 0)
        return fail(res, 409, 'BATCH_LOCKED', 'Mẻ đã có NVL rút vào hoặc đã nạp bồn — không đổi được mã lô / mã bán thành phẩm (chuỗi truy xuất đã ghi theo mã cũ)')
      if (body.batch_code !== undefined) {
        const code = normalizeBatchCode(body.batch_code)
        if (!BATCH_CODE_RE.test(code)) return fail(res, 422, 'BATCH_CODE', 'Mã lô chỉ gồm chữ, số và _ . - (tối đa 40 ký tự)')
        patch.batch_code = code
      }
      if (body.material_id !== undefined) {
        const { data: m } = await db.from('Material').select('id, material_code, base_unit').eq('id', body.material_id).maybeSingle()
        if (!m) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mã bán thành phẩm')
        const unit = String(m.base_unit ?? '').toUpperCase()
        if (unit !== 'L' && unit !== 'KG') return fail(res, 422, 'BTP_UNIT', `Mã ${m.material_code} phải có đơn vị gốc L hoặc KG`)
        patch.material_id = m.id
      }
    }
    const { data, error } = await db.from('production_batch').update(patch).eq('id', b.id).select('*')
    if (error) return fail(res, error)
    if (!data?.length) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    return ok(res, data[0])
  } catch (e) { return failAny(res, e) }
}

// ─── BÀN LÀM VIỆC CỦA MẺ: yêu cầu nguyên liệu (14/11 đêm) ──────────────────────────────────────────────────────────
// PUT /wms/production/batches/:id/requirements — thay TRỌN danh sách yêu cầu của mẻ (mẻ đang mở). Dòng vắng mặt = bỏ yêu cầu;
// phần ĐÃ CẤP không bị đụng (vẫn hiện trên bàn là "ngoài yêu cầu").
export const zRequirements = z.object({
  items: z.array(z.object({ material_id: zText(1, 64), qty: z.number().positive().max(10_000_000), note: zText(0, 200).optional() })).max(300),
})
export async function setRequirements(req: Request, res: Response) {
  try {
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { items } = req.body as z.infer<typeof zRequirements>
    const { data, error } = await db.rpc('mes_batch_set_requirements', { p: { batch_id: b.id, items: items.map(i => ({ ...i, qty: round3(i.qty) })), actor_name: actor(req).actor_name } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}
// POST /wms/production/batches/:id/apply-recipe — chép lại ĐỊNH MỨC của mã BTP vào mẻ (replace = bỏ hết yêu cầu cũ trước)
export const zApplyRecipe = z.object({ replace: z.boolean().optional() })
export async function applyRecipe(req: Request, res: Response) {
  try {
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data, error } = await db.rpc('mes_batch_apply_recipe', { p: { batch_id: b.id, replace: (req.body as z.infer<typeof zApplyRecipe>).replace === true, actor_name: actor(req).actor_name } })
    if (error) return mesFail(res, error)
    if ((data as { no_recipe?: boolean } | null)?.no_recipe) return fail(res, 409, 'MES_NO_RECIPE', 'Mã bán thành phẩm này chưa khai định mức — khai ở Sản xuất (MES) → Định mức, hoặc tự thêm nguyên liệu cho mẻ')
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// ─── ĐỊNH MỨC nguyên liệu của mã bán thành phẩm (một định mức / mã, cho một cỡ mẻ chuẩn) ──────────────────────────
const MAT_COLS = 'id, material_code, short_name, base_unit, entry_unit, units_per_carton, category'
// GET /wms/production/recipes — danh sách định mức (cấu hình: vài chục – vài trăm mã BTP)
export async function listRecipes(req: Request, res: Response) {
  try {
    const { data, error } = await db.from('production_recipe')
      .select(`id, material_id, base_qty, note, is_active, updated_at, updated_by, material:Material!production_recipe_material_id_fkey(${MAT_COLS})`)
      .order('updated_at', { ascending: false }).limit(1000)
    if (error) return fail(res, error)
    const rows = (data ?? []).filter(r => categoryAllowed(req, (r.material as unknown as { category: string | null } | null)?.category))
    return ok(res, rows)
  } catch (e) { return failAny(res, e) }
}
// GET /wms/production/recipes/:materialId — định mức của một mã BTP (chưa khai ⇒ null)
export async function getRecipe(req: Request, res: Response) {
  try {
    const { data: r, error } = await db.from('production_recipe')
      .select(`id, material_id, base_qty, note, is_active, updated_at, updated_by, material:Material!production_recipe_material_id_fkey(${MAT_COLS})`)
      .eq('material_id', req.params.materialId).maybeSingle()
    if (error) return fail(res, error)
    if (!r) return ok(res, null)
    if (!categoryAllowed(req, (r.material as unknown as { category: string | null } | null)?.category)) return fail(res, 403, 'FORBIDDEN', CATEGORY_FORBIDDEN_MSG)
    const { data: lines, error: lErr } = await db.from('production_recipe_line')
      .select(`id, material_id, qty, sort_order, note, material:Material!production_recipe_line_material_id_fkey(${MAT_COLS})`)
      .eq('recipe_id', r.id).order('sort_order').limit(500)
    if (lErr) return fail(res, lErr)
    return ok(res, { ...r, lines: lines ?? [] })
  } catch (e) { return failAny(res, e) }
}
// PUT /wms/production/recipes/:materialId — lưu định mức (thay trọn danh sách dòng) — quyền manage_recipe
export const zRecipePut = z.object({
  base_qty: z.number().positive().max(10_000_000), note: zText(0, 500).nullable().optional(), is_active: z.boolean().optional(),
  lines: z.array(z.object({ material_id: zText(1, 64), qty: z.number().positive().max(10_000_000), note: zText(0, 200).optional() })).max(300),
})
export async function putRecipe(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zRecipePut>
    const { data: m } = await db.from('Material').select('id, material_code, base_unit, category').eq('id', req.params.materialId).maybeSingle()
    if (!m) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mã bán thành phẩm')
    if (!categoryAllowed(req, m.category)) return fail(res, 403, 'FORBIDDEN', CATEGORY_FORBIDDEN_MSG)
    const unit = String(m.base_unit ?? '').toUpperCase()
    if (unit !== 'L' && unit !== 'KG') return fail(res, 422, 'BTP_UNIT', `Mã ${m.material_code} tính theo "${m.base_unit ?? '—'}" — bán thành phẩm phải có đơn vị gốc L hoặc KG`)
    const { data, error } = await db.rpc('mes_recipe_save', { p: {
      material_id: m.id, base_qty: round3(body.base_qty), note: body.note ?? null, is_active: body.is_active ?? true,
      lines: body.lines.map(l => ({ ...l, qty: round3(l.qty) })), actor_name: actor(req).actor_name,
    } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/batches/:id/(close|reopen|cancel) — CAS theo trạng thái: hai người cùng bấm ⇒ một người thắng
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
export async function closeBatch(req: Request, res: Response) {
  try { const a = actor(req); return await setBatchStatus(req, res, ['OPEN'], 'CLOSED', { closed_at: nowIso(), closed_by: a.actor_id, closed_by_name: a.actor_name }) }
  catch (e) { return failAny(res, e) }
}
export async function reopenBatch(req: Request, res: Response) {
  try { return await setBatchStatus(req, res, ['CLOSED'], 'OPEN', { closed_at: null, closed_by: null, closed_by_name: null }) }
  catch (e) { return failAny(res, e) }
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
    if ((nm ?? 0) > 0) return fail(res, 409, 'BATCH_HAS_TANK', 'Mẻ đã nạp bồn — không huỷ được; xả bỏ phần trong bồn rồi đóng mẻ')
    return await setBatchStatus(req, res, ['OPEN', 'CLOSED'], 'CANCELLED')
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/batches/:id/qa — QA giữ / thả / loại lô bán thành phẩm
export const zBatchQa = z.object({ qa_status: z.enum(['HOLD', 'RELEASED', 'REJECTED']), note: zText(0, 500).optional() })
export async function setBatchQa(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zBatchQa>
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    if (b.status === 'CANCELLED') return fail(res, 409, 'BATCH_CANCELLED', 'Mẻ đã huỷ')
    if (body.qa_status === 'REJECTED' && !body.note?.trim()) return fail(res, 422, 'REASON', 'Loại lô phải ghi lý do')
    const a = actor(req)
    const { data, error } = await db.from('production_batch').update({
      qa_status: body.qa_status, qa_note: body.note || null, qa_at: nowIso(), qa_by: a.actor_id, qa_by_name: a.actor_name, updated_at: nowIso(),
    }).eq('id', b.id).select('*')
    if (error) return fail(res, error)
    return ok(res, data?.[0] ?? null)
  } catch (e) { return failAny(res, e) }
}

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
      .select('id, pallet_code, material_id, cartons_remaining, cartons_imported, cartons_reserved, status, production_date, expiry_date, batch, qa_status_id, qa_status:QAStatus(code, name), location:Location(location_code), material:Material(material_code, short_name, base_unit, entry_unit, units_per_carton)')
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
    return ok(res, rows[0])
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/batches/:id/consume-scan — rút theo TEM (một dòng tồn)
export const zConsumeScan = z.object({ entry_id: zText(1, 100), qty: z.number().positive().max(10_000_000), qty_semantics: z.literal('base') })
export async function consumeScan(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zConsumeScan>
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data: e } = await db.from('InventoryEntry').select('id, material:Material(base_unit, entry_unit, units_per_carton)').eq('id', body.entry_id).maybeSingle()
    if (!e) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy dòng tồn')
    const intErr = qtyIntegerError(body.qty, e.material as unknown as { base_unit: string | null; entry_unit: string | null; units_per_carton: number | null } | null)
    if (intErr) return fail(res, 422, 'QTY_NOT_INTEGER', intErr)
    const { data, error } = await db.rpc('mes_consume_scan', { p: { batch_id: b.id, entry_id: body.entry_id, qty: body.qty, ...actor(req) } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

// POST /wms/production/batches/:id/consume-lot — rút theo LÔ (không có tem): mã + NSX / mã lô + số lượng, FEFO trong lô
export const zConsumeLot = z.object({
  material_id: zText(1, 64), production_date: zDay.nullable(), batch_lot: zText(1, 60).nullable().optional(),
  qty: z.number().positive().max(10_000_000), qty_semantics: z.literal('base'),
})
export async function consumeLot(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zConsumeLot>
    const b = await loadBatch(req.params.id)
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẻ')
    if (!(await inScope(req, b.warehouse_id))) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const { data: m } = await db.from('Material').select('base_unit, entry_unit, units_per_carton').eq('id', body.material_id).maybeSingle()
    if (!m) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mã nguyên liệu')
    const intErr = qtyIntegerError(body.qty, m)
    if (intErr) return fail(res, 422, 'QTY_NOT_INTEGER', intErr)
    const { data, error } = await db.rpc('mes_consume_lot', { p: {
      batch_id: b.id, material_id: body.material_id, production_date: body.production_date, batch_lot: body.batch_lot ?? null,
      qty: body.qty, ...actor(req),
    } })
    if (error) return mesFail(res, error)
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}

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
  batch: { batch_code: string; qa_status: string; material: { material_code: string; short_name: string | null } | null } | null }

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
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await db.from('tank_lot')
        .select('id, tank_id, batch_id, qty_in, qty_remaining, filled_at, expires_at, batch:production_batch!tank_lot_batch_id_fkey(batch_code, qa_status, material:Material!production_batch_material_id_fkey(material_code, short_name))')
        .in('tank_id', ids.slice(i, i + 300)).eq('status', 'ACTIVE').order('filled_at').limit(1000)
      lots.push(...((data ?? []) as unknown as LotView[]))
    }
    const now = Date.now()
    const out = (tanks ?? []).map(t => {
      const ls = lots.filter(l => l.tank_id === t.id)
      const content = ls.reduce((s, l) => s + Number(l.qty_remaining), 0)
      return {
        ...t, content, lots: ls,
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
  types: z.array(z.object({ type_code: zText(1, 64), production_qa_gate: zGate.nullable() })).max(200).optional(),
  hold_hours: z.array(z.object({ material_id: zText(1, 64), tank_hold_hours: z.number().int().min(1).max(8760).nullable() })).max(300).optional(),
})

async function settingsOf(req: Request, whId: string) {
  const scope = scopeCategoriesOf(req)
  let mq = db.from('Material').select('id, material_code, short_name, category, base_unit, tank_hold_hours')
    .not('tank_hold_hours', 'is', null).order('material_code').limit(500)
  if (scope) mq = mq.or(`category.is.null,category.in.(${scope.map(c => `"${c.replace(/"/g, '')}"`).join(',')})`)
  const [{ data: wh }, { data: types }, { data: mats }] = await Promise.all([
    db.from('Warehouse').select('id, code, name, production_qa_gate').eq('id', whId).maybeSingle(),
    db.from('warehouse_type_configs').select('type_code, production_qa_gate, sort_order').eq('warehouse_id', whId)
      .order('sort_order', { ascending: true, nullsFirst: false }).order('type_code').limit(200),
    mq,
  ])
  return {
    warehouse_id: whId,
    production_qa_gate: wh?.production_qa_gate ?? 'WARN',
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
      const { data: mats } = await db.from('Material').select('id, category').in('id', holds.map(h => h.material_id)).limit(300)   // ≤300: zod chặn
      if ((mats ?? []).length !== holds.length) return fail(res, 404, 'NOT_FOUND', 'Có mã hàng không còn trong danh mục')
      if ((mats ?? []).some(m => !categoryAllowed(req, m.category))) return fail(res, 403, 'FORBIDDEN', CATEGORY_FORBIDDEN_MSG)
    }
    if (types.length) {
      const { data: cur } = await db.from('warehouse_type_configs').select('type_code').eq('warehouse_id', body.warehouse_id).limit(500)
      const known = new Set((cur ?? []).map(r => r.type_code))
      const miss = types.find(t => !known.has(t.type_code))
      if (miss) return fail(res, 422, 'UNKNOWN_TYPE', `Kho này chưa có Loại kho "${miss.type_code.slice(0, 30)}"`)
    }

    if (body.production_qa_gate !== undefined) {
      const { data, error } = await db.from('Warehouse').update({ production_qa_gate: body.production_qa_gate, updated_at: now, updated_by: who })
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

