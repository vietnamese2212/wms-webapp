/**
 * CƯỚC VẬN CHUYỂN — bảng cước · phụ phí · phân tuyến ĐVVT (đợt 1 TMS điều vận; user chốt 23/09/2026;
 * plan docs/plans/TMS_DISPATCH_PLAN.md mục 6.0–6.4). Luật tính nằm ở services/freight.ts (thuần, có test).
 *
 * Bốn điều user chốt: xe pallet = đơn giá × pallet làm tròn LÊN · rớt điểm theo thực tế chuyến (1 điểm không
 * có, ≥2 điểm mỗi điểm một khoản theo hợp đồng) · bảng cước theo TỪNG (kho xuất × ĐVVT), kể cả rớt điểm và
 * bốc xếp · chọn ĐVVT = tỷ lệ phân tuyến cố định trước rồi mới rẻ nhất (bảng cấu hình riêng).
 *
 * Phạm vi kho: mọi cửa đọc cắt theo `from_warehouse_id` trong phạm vi user; cửa ghi 403 nếu kho ngoài phạm vi.
 * Danh mục kho/ĐVVT/dòng xe tra bằng bản đồ nhỏ (153/117/60 dòng) — không nhồi id lên URL.
 */
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { db } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { isQueryTimeout, QUERY_TIMEOUT_MSG, fetchAllByIdChunks, fetchAllRowsParallel } from '../../utils/pagination'
import { isPreflight, buildPreflight, type PreflightExtra } from '../../utils/uploadPreflight'
import { parseSheetByHeader, readWorkbookSafe, expandMergedCells, BAD_EXCEL_MSG, normHeader, type FieldDef } from '../../utils/excelHeader'
import { parseVnNumber } from '../../utils/vnNumber'
import { normDvvt } from '../../utils/sapUnits'
import { makeDvvtResolver } from '../../services/sapFlow'
import { effectiveAt } from '../../services/freight'
import { z, zText, zId, zDay, zBool, zIntFromQuery } from '../../middlewares/validate'
import { safeSearch } from '../../utils/search'
import type { Database } from '../../types/database'

type Tables = Database['public']['Tables']
type TariffRow = Tables['freight_tariff']['Row']
type TariffInsert = Tables['freight_tariff']['Insert']
type SurchargeRow = Tables['freight_surcharge']['Row']
type SurchargeInsert = Tables['freight_surcharge']['Insert']
type AllocationInsert = Tables['carrier_allocation']['Insert']
type ShareInsert = Tables['carrier_share_target']['Insert']

const now = () => new Date().toISOString()
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const CHUNK = 500

// ── Phạm vi kho ────────────────────────────────────────────────────────────────────────────────────────
function scopeWhIds(req: Request): string[] | null {
  return req.user?.warehouse_scope === 'NATIONAL' ? null : (req.user?.warehouse_ids ?? [])
}
function whAllowed(req: Request, whId: string): boolean {
  const s = scopeWhIds(req)
  return s === null || s.includes(whId)
}
/** Áp bộ lọc kho lên câu list: kho chỉ định phải trong phạm vi; không chỉ định thì cắt theo phạm vi (rỗng = không dòng nào). */
function applyWhFilter<T extends { eq: (c: string, v: string) => T; in: (c: string, v: string[]) => T }>(req: Request, q: T, whId: string | undefined): T | 'FORBIDDEN' | 'EMPTY' {
  if (whId) return whAllowed(req, whId) ? q.eq('from_warehouse_id', whId) : 'FORBIDDEN'
  const s = scopeWhIds(req)
  if (s === null) return q
  if (!s.length) return 'EMPTY'
  // phạm vi user ≤ vài chục kho (không phải danh sách id lớn) — .in trực tiếp, không phân trang
  return q.in('from_warehouse_id', s.slice(0, 300))
}

// ── Bản đồ tên (danh mục nhỏ, một lời gọi mỗi bảng) ─────────────────────────────────────────────────────
type NameMaps = {
  wh: Map<string, { code: string; name: string }>
  co: Map<string, { code: string; name: string }>
  vm: Map<string, { sap_code: string; name: string; tariff_unit: string; parent_type_id: string | null }>
}
async function nameMaps(whIds: string[]): Promise<NameMaps> {
  const [whRows, co, vm] = await Promise.all([
    fetchAllByIdChunks([...new Set(whIds)], c => db.from('Warehouse').select('id, code, name').in('id', c).order('id')) as Promise<{ id: string; code: string; name: string }[]>,
    db.from('TransportCompany').select('id, code, name'),
    db.from('vehicle_model').select('id, sap_code, name, tariff_unit, parent_type_id'),
  ])
  return {
    wh: new Map(whRows.map(w => [w.id, { code: w.code, name: w.name }])),
    co: new Map((co.data ?? []).map(c => [c.id, { code: c.code, name: c.name }])),
    vm: new Map((vm.data ?? []).map(m => [m.id, { sap_code: m.sap_code, name: m.name, tariff_unit: m.tariff_unit, parent_type_id: m.parent_type_id }])),
  }
}
const enrich = <T extends { from_warehouse_id: string; transport_company_id: string; vehicle_model_id?: string | null }>(rows: T[], m: NameMaps) =>
  rows.map(r => ({
    ...r,
    warehouse: m.wh.get(r.from_warehouse_id) ?? null,
    company: m.co.get(r.transport_company_id) ?? null,
    model: r.vehicle_model_id ? m.vm.get(r.vehicle_model_id) ?? null : null,
  }))

// ── Schema chung ───────────────────────────────────────────────────────────────────────────────────────
const zMoney = z.number().finite().min(0)
const zEff = { effective_from: zDay.optional(), effective_to: zDay.nullable().optional(), is_active: zBool.optional(), note: zText(0, 500).nullable().optional() }
const effOk = (from: string, to: string | null | undefined) => !to || to >= from

export const zTariffCreate = z.object({
  from_warehouse_id: zId, transport_company_id: zId, vehicle_model_id: zId,
  ward_code: zText(1, 120), price: zMoney, distance_km: z.number().finite().min(0).nullable().optional(),
  province_new: zText(0, 120).nullable().optional(), ward_raw: zText(0, 120).nullable().optional(), ...zEff,
})
export const zTariffUpdate = z.object({
  ward_code: zText(1, 120).optional(), price: zMoney.optional(), distance_km: z.number().finite().min(0).nullable().optional(),
  province_new: zText(0, 120).nullable().optional(), ...zEff,
})
export const zSurchargeCreate = z.object({
  from_warehouse_id: zId, transport_company_id: zId, vehicle_model_id: zId.nullable().optional(),
  kind: zText(1, 40), amount: zMoney, per: z.enum(['PER_STOP', 'PER_TRIP', 'PER_PALLET', 'PER_TON']),
  count_mode: z.enum(['ALL_STOPS', 'EXTRA_STOPS']).optional(), min_stops: z.number().int().min(1).max(50).optional(), ...zEff,
})
export const zSurchargeUpdate = zSurchargeCreate.omit({ from_warehouse_id: true, transport_company_id: true }).partial()
export const zAllocationCreate = z.object({
  from_warehouse_id: zId, area_kind: z.enum(['WARD', 'REGION']), area_code: zText(1, 120), transport_company_id: zId,
  priority: z.number().int().min(1).max(99).optional(), ...zEff,
})
export const zAllocationUpdate = z.object({ priority: z.number().int().min(1).max(99).optional(), ...zEff })
export const zShareCreate = z.object({
  from_warehouse_id: zId, transport_company_id: zId, share_pct: z.number().finite().gt(0).max(100),
  basis: z.enum(['TRIPS', 'PALLETS', 'TONS']).optional(), ...zEff,
})
export const zShareUpdate = z.object({ share_pct: z.number().finite().gt(0).max(100).optional(), basis: z.enum(['TRIPS', 'PALLETS', 'TONS']).optional(), ...zEff })
export const zListQuery = z.object({
  warehouse_id: zId.optional(), company_id: zId.optional(), model_id: zId.optional(), ward: zText(0, 120).optional(),
  active_on: zDay.optional(), q: zText(0, 120).optional(), page: zIntFromQuery.optional(), pageSize: zIntFromQuery.optional(),
}).passthrough()

/** Kho / ĐVVT / dòng xe phải có thật — id rác là bảng cước trỏ vào hư không, cước im lặng không tính. */
async function refsExist(whId: string, coId: string, vmId: string | null | undefined): Promise<string | null> {
  const [w, c, m] = await Promise.all([
    db.from('Warehouse').select('id').eq('id', whId).maybeSingle(),
    db.from('TransportCompany').select('id').eq('id', coId).maybeSingle(),
    vmId ? db.from('vehicle_model').select('id').eq('id', vmId).maybeSingle() : Promise.resolve({ data: { id: '' } }),
  ])
  if (!w.data) return 'Kho xuất không tồn tại'
  if (!c.data) return 'ĐVVT không tồn tại'
  if (!m.data) return 'Dòng xe không tồn tại'
  return null
}

// ═══ BẢNG CƯỚC ═══════════════════════════════════════════════════════════════════════════════════════
// GET /tms/freight/tariffs — phân trang server (phường × ĐVVT × dòng xe có thể vài nghìn dòng mỗi kho)
export async function listTariffs(req: Request, res: Response) {
  try {
    const qy = req.query as z.infer<typeof zListQuery>
    const page = Math.max(1, Number(qy.page ?? 1)), pageSize = Math.min(500, Math.max(1, Number(qy.pageSize ?? 100)))
    let q = db.from('freight_tariff').select('*', { count: 'exact' })
    const scoped = applyWhFilter(req, q, qy.warehouse_id)
    if (scoped === 'FORBIDDEN') return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    if (scoped === 'EMPTY') return ok(res, { items: [], total: 0, page, pageSize })
    q = scoped
    if (qy.company_id) q = q.eq('transport_company_id', qy.company_id)
    if (qy.model_id) q = q.eq('vehicle_model_id', qy.model_id)
    if (qy.ward) q = q.ilike('ward_code', `%${safeSearch(qy.ward)}%`)
    if (qy.active_on) q = q.lte('effective_from', qy.active_on).or(`effective_to.is.null,effective_to.gte.${qy.active_on}`).eq('is_active', true)
    if (qy.q) { const s = safeSearch(qy.q); if (s) q = q.or(`ward_code.ilike.%${s}%,province_new.ilike.%${s}%,ward_raw.ilike.%${s}%`) }
    const { data, error, count } = await q.order('ward_code').order('effective_from', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1)
    if (error) return fail(res, error)
    const rows = (data ?? []) as TariffRow[]
    const m = await nameMaps(rows.map(r => r.from_warehouse_id))
    return ok(res, { items: enrich(rows, m), total: count ?? rows.length, page, pageSize })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

export async function createTariff(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zTariffCreate>
    if (!whAllowed(req, b.from_warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const bad = await refsExist(b.from_warehouse_id, b.transport_company_id, b.vehicle_model_id)
    if (bad) return fail(res, bad, 400)
    const from = b.effective_from ?? todayVN()
    if (!effOk(from, b.effective_to)) return fail(res, 'Hiệu lực đến phải ≥ hiệu lực từ', 400)
    const actor = req.user?.name || null
    const rec: TariffInsert = {
      id: randomUUID(), from_warehouse_id: b.from_warehouse_id, transport_company_id: b.transport_company_id, vehicle_model_id: b.vehicle_model_id,
      ward_code: b.ward_code, price: b.price, distance_km: b.distance_km ?? null, province_new: b.province_new ?? null, ward_raw: b.ward_raw ?? null,
      effective_from: from, effective_to: b.effective_to ?? null, is_active: b.is_active ?? true, note: b.note ?? null,
      created_by: actor, updated_by: actor, updated_at: now(),
    }
    const { data, error } = await db.from('freight_tariff').insert(rec).select().single()
    if (error) return fail(res, error)   // 23505 → 409: đã có giá cùng khoá + cùng ngày hiệu lực
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateTariff(req: Request, res: Response) {
  try {
    const { id } = req.params
    const b = req.body as z.infer<typeof zTariffUpdate>
    const { data: cur } = await db.from('freight_tariff').select('from_warehouse_id, effective_from, effective_to').eq('id', id).maybeSingle()
    if (!cur) return fail(res, 'Không tìm thấy dòng cước', 404)
    if (!whAllowed(req, cur.from_warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const from = b.effective_from ?? cur.effective_from, to = b.effective_to === undefined ? cur.effective_to : b.effective_to
    if (!effOk(from, to)) return fail(res, 'Hiệu lực đến phải ≥ hiệu lực từ', 400)
    const patch: Partial<TariffRow> = { ...b, updated_at: now(), updated_by: req.user?.name || null }
    const { data, error } = await db.from('freight_tariff').update(patch).eq('id', id).select().maybeSingle()
    if (error) return fail(res, error)
    if (!data) return fail(res, 'Không tìm thấy dòng cước', 404)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteTariff(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { data: cur } = await db.from('freight_tariff').select('from_warehouse_id').eq('id', id).maybeSingle()
    if (!cur) return fail(res, 'Không tìm thấy dòng cước', 404)
    if (!whAllowed(req, cur.from_warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    // Dòng cước đã dùng để tính cước chuyến = chứng từ — không xoá, chỉ kết thúc hiệu lực
    const { count } = await db.from('GroupDeliveryOrder').select('id', { count: 'exact', head: true }).eq('freight_tariff_id', id)
    if (count) return fail(res, `Dòng cước đã dùng cho ${count} chuyến — đặt "Hiệu lực đến" để kết thúc thay vì xoá.`, 409)
    const { data: gone, error } = await db.from('freight_tariff').delete().eq('id', id).select('id')
    if (error) return fail(res, error)
    if (!gone?.length) return fail(res, 'Không tìm thấy dòng cước — có thể đã bị xoá trước đó', 404)
    return ok(res, { deleted: id })
  } catch (e) { return fail(res, String(e)) }
}

// ── UPLOAD BẢNG CƯỚC — đúng cột file thật của user (ảnh 21/09) + 2 cột thêm (Kho xuất · Hiệu lực từ) ──
export const TARIFF_FIELDS: FieldDef[] = [
  { key: 'province_old', label: 'Tỉnh/TP (Cũ)',     aliases: ['Tỉnh/TP(Cũ)', 'Tinh cu'] },
  { key: 'district_old', label: 'Quận/Huyện (Cũ)',  aliases: ['Quận/Huyện(Cũ)', 'Quan cu'] },
  { key: 'province_new', label: 'Tỉnh/TP (Mới)',    aliases: ['Tỉnh/TP(Mới)', 'Tinh moi'] },
  { key: 'ward',         label: 'Phường/Xã (Mới)',  aliases: ['Phường/Xã(Mới)', 'Phuong xa moi', 'Tên Phường', 'Phường'], required: true },
  { key: 'distance_km',  label: 'Cự ly (Km)',       aliases: ['Cự ly(Km)', 'Cu ly', 'Km'] },
  { key: 'dvvt',         label: 'DVVT',             aliases: ['ĐVVT', 'Đơn vị vận tải', 'Nhà xe'], required: true },
  { key: 'model_name',   label: 'Loại xe',          aliases: ['Dòng xe', 'Tên dòng xe'] },
  { key: 'price',        label: 'Cước (VND)',       aliases: ['Cước', 'Cuoc', 'Đơn giá', 'Giá'], required: true },
  { key: 'sap_code',     label: 'Mã xe SAP',        aliases: ['Ma xe SAP', 'Mã hệ thống', 'Mã hệ thống mới'], required: true },
  { key: 'warehouse',    label: 'Kho xuất',         aliases: ['Kho', 'Mã kho', 'Kho đi'] },
  { key: 'effective_from', label: 'Hiệu lực từ',    aliases: ['Hieu luc tu', 'Từ ngày'] },
]
type WardIndex = { full: Map<string, string>; byName: Map<string, Set<string>> }
/** Chỉ mục phường từ khách hàng SAP: "HN-Phúc Lợi" khớp trọn; "Phúc Lợi" khớp phần sau dấu '-' (duy nhất mới nhận). */
async function wardIndex(): Promise<WardIndex> {
  const rows = await fetchAllRowsParallel(() => db.from('Customer').select('ward_code').not('ward_code', 'is', null).order('ship_to_code')) as { ward_code: string }[]
  const full = new Map<string, string>(), byName = new Map<string, Set<string>>()
  for (const r of rows) {
    const w = String(r.ward_code).trim(); if (!w) continue
    full.set(normHeader(w), w)
    const dash = w.indexOf('-')
    const name = normHeader(dash >= 0 ? w.slice(dash + 1) : w)
    if (!byName.has(name)) byName.set(name, new Set())
    byName.get(name)!.add(w)
  }
  return { full, byName }
}
function resolveWard(raw: string, idx: WardIndex): { ward_code: string; matched: 'FULL' | 'NAME' | 'AMBIGUOUS' | 'NONE'; candidates?: string[] } {
  const n = normHeader(raw)
  const f = idx.full.get(n); if (f) return { ward_code: f, matched: 'FULL' }
  const set = idx.byName.get(n)
  if (set?.size === 1) return { ward_code: [...set][0], matched: 'NAME' }
  if (set && set.size > 1) return { ward_code: raw.trim(), matched: 'AMBIGUOUS', candidates: [...set] }
  return { ward_code: raw.trim(), matched: 'NONE' }
}
/** Ngày trong ô Excel: serial hoặc dd/mm/yyyy hoặc yyyy-mm-dd → 'YYYY-MM-DD' | null (không hợp lệ → undefined). */
function cellDay(v: unknown): string | null | undefined {
  if (v == null || String(v).trim() === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = Math.round((v - 25569) * 86_400_000)
    const d = new Date(ms); if (Number.isNaN(d.getTime())) return undefined
    return d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (m1) return s
  const m2 = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`
  return undefined
}

export async function uploadTariffs(req: Request, res: Response) {
  try {
    if (!req.file) return fail(res, 'Không có file (chỉ nhận .xlsx/.xls)', 400)
    const wb = readWorkbookSafe(req.file.buffer)
    if (!wb) return fail(res, BAD_EXCEL_MSG, 400)
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) return fail(res, 'File không có sheet nào', 400)
    expandMergedCells(ws)
    const parsed = parseSheetByHeader(ws, TARIFF_FIELDS)
    if (parsed.missingRequired.length) return fail(res, `File thiếu cột bắt buộc: ${parsed.missingRequired.join(', ')}`, 400)
    if (!parsed.rows.length) return fail(res, 'File trống', 400)

    const body = (req.body ?? {}) as { warehouse_id?: string; effective_from?: string }
    const bodyWh = body.warehouse_id ? String(body.warehouse_id) : null
    const bodyFrom = body.effective_from ? String(body.effective_from) : null
    if (bodyFrom && cellDay(bodyFrom) === undefined) return fail(res, 'Hiệu lực từ không đúng dạng YYYY-MM-DD', 400)

    // Danh mục để khớp: kho (code/name), ĐVVT (code/alias/tên bỏ dấu → code → id), dòng xe (sap_code → id; tên là dự phòng), phường
    const [whRows, coRows, vmRows, dvvtResolve, wards] = await Promise.all([
      db.from('Warehouse').select('id, code, name'), db.from('TransportCompany').select('id, code'),
      db.from('vehicle_model').select('id, sap_code, name, is_active'), makeDvvtResolver(), wardIndex(),
    ])
    const whByKey = new Map<string, { id: string; code: string; name: string }>()
    for (const w of whRows.data ?? []) { whByKey.set(normHeader(w.code), w); whByKey.set(normHeader(w.name), w) }
    const coIdByCode = new Map((coRows.data ?? []).map(c => [c.code, c.id]))
    const vmBySap = new Map((vmRows.data ?? []).map(m => [String(m.sap_code).trim(), m]))
    const vmByName = new Map((vmRows.data ?? []).map(m => [normHeader(m.name), m]))

    const errors: string[] = [], warnings: string[] = []
    type Rec = TariffInsert & { _key: string }
    const recs = new Map<string, Rec>()   // khoá nghiệp vụ → dòng cuối thắng (trùng trong file = cảnh báo)
    const unknownDvvt = new Set<string>(), unknownSap = new Set<string>(), wardNone = new Set<string>(), wardAmb = new Set<string>()
    let dupInFile = 0
    const whUsed = new Set<string>()
    parsed.rows.forEach((r, i) => {
      const line = `dòng ${i + 2}`
      const whRaw = String(r.warehouse ?? '').trim()
      const wh = whRaw ? whByKey.get(normHeader(whRaw)) : (bodyWh ? (whRows.data ?? []).find(w => w.id === bodyWh) : undefined)
      if (!wh) { errors.push(`${line} — ${whRaw ? `Kho xuất "${whRaw}" không có trong danh mục` : 'Thiếu Kho xuất (chọn kho lúc upload hoặc thêm cột "Kho xuất")'}`); return }
      if (!whAllowed(req, wh.id)) { errors.push(`${line} — Kho ${wh.name} ngoài phạm vi được giao`); return }
      const dvRaw = String(r.dvvt ?? '').trim()
      const dvCode = dvRaw ? dvvtResolve(normDvvt(dvRaw) ?? '') : null
      const coId = dvCode ? coIdByCode.get(dvCode) : undefined
      if (!coId) { unknownDvvt.add(dvRaw || '(trống)'); errors.push(`${line} — ĐVVT "${dvRaw}" không khớp danh mục ĐVVT`); return }
      const sapRaw = String(r.sap_code ?? '').replace(/\.0$/, '').trim()
      let vm = sapRaw ? vmBySap.get(sapRaw) : undefined
      if (!vm && r.model_name) vm = vmByName.get(normHeader(r.model_name))
      if (!vm) { unknownSap.add(sapRaw || String(r.model_name ?? '(trống)')); errors.push(`${line} — Mã xe SAP "${sapRaw}" không có trong danh mục dòng xe`); return }
      const price = parseVnNumber(r.price)
      if (price == null || price < 0) { errors.push(`${line} — Cước "${String(r.price ?? '')}" không phải số hợp lệ`); return }
      const wardRaw = String(r.ward ?? '').trim()
      if (!wardRaw) { errors.push(`${line} — Thiếu Phường/Xã (Mới)`); return }
      const w = resolveWard(wardRaw, wards)
      if (w.matched === 'NONE') wardNone.add(wardRaw)
      if (w.matched === 'AMBIGUOUS') wardAmb.add(`${wardRaw} (${(w.candidates ?? []).join(' | ')})`)
      const from = cellDay(r.effective_from)
      if (from === undefined) { errors.push(`${line} — Hiệu lực từ "${String(r.effective_from)}" không đúng dạng ngày`); return }
      const effFrom = from ?? bodyFrom ?? todayVN()
      const km = parseVnNumber(r.distance_km)
      const key = [wh.id, coId, vm.id, w.ward_code, effFrom].join('|')
      if (recs.has(key)) dupInFile++
      whUsed.add(wh.id)
      recs.set(key, {
        _key: key, id: randomUUID(), from_warehouse_id: wh.id, transport_company_id: coId, vehicle_model_id: vm.id, ward_code: w.ward_code, price,
        distance_km: km != null && km >= 0 ? km : null, province_old: String(r.province_old ?? '').trim() || null, district_old: String(r.district_old ?? '').trim() || null,
        province_new: String(r.province_new ?? '').trim() || null, ward_raw: wardRaw, effective_from: effFrom, effective_to: null, is_active: true,
        created_by: req.user?.name || null, updated_by: req.user?.name || null, updated_at: now(),
      })
    })
    if (dupInFile) warnings.push(`${dupInFile} dòng trùng khoá (kho · ĐVVT · dòng xe · phường · hiệu lực) trong file — giữ dòng cuối`)
    if (wardNone.size) warnings.push(`${wardNone.size} phường chưa thấy trong dữ liệu khách hàng SAP (cước lưu theo tên trong file, chỉ khớp khi ZSD02 dùng đúng tên này): ${[...wardNone].slice(0, 15).join(' · ')}${wardNone.size > 15 ? '…' : ''}`)
    if (wardAmb.size) warnings.push(`${wardAmb.size} phường trùng tên ở nhiều tỉnh — ghi đúng mã SAP "Tỉnh-Phường" vào cột Phường/Xã để khớp: ${[...wardAmb].slice(0, 8).join(' · ')}`)

    // So với bảng đang có (cùng kho, cùng ngày hiệu lực) → thêm / đè giá / không đổi — kiểm-trước nói đúng cái sẽ xảy ra
    const list = [...recs.values()]
    const priorRows = await fetchAllByIdChunks([...whUsed], c => db.from('freight_tariff')
      .select('id, from_warehouse_id, transport_company_id, vehicle_model_id, ward_code, effective_from, price, distance_km')
      .in('from_warehouse_id', c).order('id')) as Pick<TariffRow, 'id' | 'from_warehouse_id' | 'transport_company_id' | 'vehicle_model_id' | 'ward_code' | 'effective_from' | 'price' | 'distance_km'>[]
    const priorByKey = new Map(priorRows.map(p => [[p.from_warehouse_id, p.transport_company_id, p.vehicle_model_id, p.ward_code, p.effective_from].join('|'), p]))
    let toInsert = 0, toUpdate = 0, noop = 0
    const write: TariffInsert[] = []
    for (const r of list) {
      const p = priorByKey.get(r._key)
      const { _key, ...rec } = r
      if (!p) { write.push(rec); toInsert++; continue }
      if (Number(p.price) === Number(rec.price) && (p.distance_km == null ? null : Number(p.distance_km)) === (rec.distance_km ?? null)) { noop++; continue }
      write.push({ ...rec, id: p.id }); toUpdate++
    }
    const extra: PreflightExtra[] = [
      { label: 'Kho xuất', value: [...whUsed].map(id => (whRows.data ?? []).find(w => w.id === id)?.name ?? id).join(', ') || '—' },
      { label: 'ĐVVT trong file', value: new Set(list.map(r => r.transport_company_id)).size },
      { label: 'Dòng xe trong file', value: new Set(list.map(r => r.vehicle_model_id)).size },
      { label: 'Phường khớp dữ liệu SAP', value: list.filter(r => !wardNone.has(String(r.ward_raw)) && !wardAmb.has(String(r.ward_raw))).length },
      ...(wardNone.size ? [{ label: 'Phường chưa thấy trong SAP', value: wardNone.size, warn: true }] : []),
      ...(noop ? [{ label: 'Không đổi (giá y hệt)', value: noop }] : []),
      ...(unknownDvvt.size ? [{ label: 'ĐVVT lạ', value: unknownDvvt.size, warn: true }] : []),
      ...(unknownSap.size ? [{ label: 'Mã xe SAP lạ', value: unknownSap.size, warn: true }] : []),
    ]
    if (isPreflight(req)) return ok(res, buildPreflight({ unit: 'dòng', total: parsed.rows.length, toInsert, toUpdate, errors, warnings, extra }))
    if (errors.length) return res.status(400).json({ success: false, error: { code: 'TARIFF_INVALID', message: `${errors.length} dòng lỗi — chưa ghi gì. Sửa file rồi upload lại.` }, errors: errors.slice(0, 200) })

    for (let i = 0; i < write.length; i += CHUNK) {
      const { error } = await db.from('freight_tariff').upsert(write.slice(i, i + CHUNK), { onConflict: 'from_warehouse_id,transport_company_id,vehicle_model_id,ward_code,effective_from' })
      if (error) throw new Error(error.message)
    }
    return ok(res, { rows: parsed.rows.length, inserted: toInsert, updated: toUpdate, noop, warnings: warnings.slice(0, 50), errors: [] })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

// ═══ PHỤ PHÍ ═════════════════════════════════════════════════════════════════════════════════════════
export async function listSurcharges(req: Request, res: Response) {
  try {
    const qy = req.query as z.infer<typeof zListQuery>
    let q = db.from('freight_surcharge').select('*')
    const scoped = applyWhFilter(req, q, qy.warehouse_id)
    if (scoped === 'FORBIDDEN') return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    if (scoped === 'EMPTY') return ok(res, { items: [] })
    q = scoped
    if (qy.company_id) q = q.eq('transport_company_id', qy.company_id)
    const { data, error } = await q.order('kind').order('effective_from', { ascending: false }).limit(1000)
    if (error) return fail(res, error)
    const rows = (data ?? []) as SurchargeRow[]
    const m = await nameMaps(rows.map(r => r.from_warehouse_id))
    const kinds = await db.from('LookupValue').select('value, meta').eq('type', 'freight_surcharge_kind').order('sort_order')
    return ok(res, { items: enrich(rows, m), kinds: (kinds.data ?? []).map(k => ({ value: k.value, label: String((k.meta as { label?: string } | null)?.label ?? k.value), default_per: String((k.meta as { default_per?: string } | null)?.default_per ?? 'PER_TRIP') })) })
  } catch (e) { return fail(res, String(e)) }
}
async function kindExists(kind: string): Promise<boolean> {
  const { data } = await db.from('LookupValue').select('value').eq('type', 'freight_surcharge_kind').eq('value', kind).maybeSingle()
  return !!data
}
export async function createSurcharge(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zSurchargeCreate>
    if (!whAllowed(req, b.from_warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const bad = await refsExist(b.from_warehouse_id, b.transport_company_id, b.vehicle_model_id)
    if (bad) return fail(res, bad, 400)
    if (!(await kindExists(b.kind))) return fail(res, `Loại phụ phí "${b.kind}" chưa có trong danh mục (LookupValue freight_surcharge_kind)`, 400)
    const from = b.effective_from ?? todayVN()
    if (!effOk(from, b.effective_to)) return fail(res, 'Hiệu lực đến phải ≥ hiệu lực từ', 400)
    const actor = req.user?.name || null
    const rec: SurchargeInsert = {
      id: randomUUID(), from_warehouse_id: b.from_warehouse_id, transport_company_id: b.transport_company_id, vehicle_model_id: b.vehicle_model_id ?? null,
      kind: b.kind, amount: b.amount, per: b.per, count_mode: b.count_mode ?? 'ALL_STOPS', min_stops: b.min_stops ?? 2,
      effective_from: from, effective_to: b.effective_to ?? null, is_active: b.is_active ?? true, note: b.note ?? null,
      created_by: actor, updated_by: actor, updated_at: now(),
    }
    const { data, error } = await db.from('freight_surcharge').insert(rec).select().single()
    if (error) return fail(res, error)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}
export async function updateSurcharge(req: Request, res: Response) {
  try {
    const { id } = req.params
    const b = req.body as z.infer<typeof zSurchargeUpdate>
    const { data: cur } = await db.from('freight_surcharge').select('from_warehouse_id, effective_from, effective_to').eq('id', id).maybeSingle()
    if (!cur) return fail(res, 'Không tìm thấy phụ phí', 404)
    if (!whAllowed(req, cur.from_warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    if (b.kind && !(await kindExists(b.kind))) return fail(res, `Loại phụ phí "${b.kind}" chưa có trong danh mục`, 400)
    const from = b.effective_from ?? cur.effective_from, to = b.effective_to === undefined ? cur.effective_to : b.effective_to
    if (!effOk(from, to)) return fail(res, 'Hiệu lực đến phải ≥ hiệu lực từ', 400)
    const patch: Partial<SurchargeRow> = { ...b, updated_at: now(), updated_by: req.user?.name || null }
    const { data, error } = await db.from('freight_surcharge').update(patch).eq('id', id).select().maybeSingle()
    if (error) return fail(res, error)
    if (!data) return fail(res, 'Không tìm thấy phụ phí', 404)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}
export async function deleteSurcharge(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { data: cur } = await db.from('freight_surcharge').select('from_warehouse_id').eq('id', id).maybeSingle()
    if (!cur) return fail(res, 'Không tìm thấy phụ phí', 404)
    if (!whAllowed(req, cur.from_warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const { data: gone, error } = await db.from('freight_surcharge').delete().eq('id', id).select('id')
    if (error) return fail(res, error)
    if (!gone?.length) return fail(res, 'Không tìm thấy phụ phí', 404)
    return ok(res, { deleted: id })
  } catch (e) { return fail(res, String(e)) }
}

// ═══ PHÂN TUYẾN ĐVVT: ưu tiên khu vực + tỷ trọng ═══════════════════════════════════════════════════
export async function listAllocations(req: Request, res: Response) {
  try {
    const qy = req.query as z.infer<typeof zListQuery>
    let qa = db.from('carrier_allocation').select('*')
    let qs = db.from('carrier_share_target').select('*')
    const sa = applyWhFilter(req, qa, qy.warehouse_id), ss = applyWhFilter(req, qs, qy.warehouse_id)
    if (sa === 'FORBIDDEN' || ss === 'FORBIDDEN') return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    if (sa === 'EMPTY' || ss === 'EMPTY') return ok(res, { allocations: [], shares: [] })
    qa = sa; qs = ss
    const [a, s] = await Promise.all([qa.order('area_kind').order('area_code').order('priority').limit(1000), qs.order('transport_company_id').limit(1000)])
    if (a.error) return fail(res, a.error)
    if (s.error) return fail(res, s.error)
    const m = await nameMaps([...(a.data ?? []).map(r => r.from_warehouse_id), ...(s.data ?? []).map(r => r.from_warehouse_id)])
    const day = todayVN()
    return ok(res, {
      allocations: enrich(a.data ?? [], m).map(r => ({ ...r, effective_now: effectiveAt([r], day).length > 0 })),
      shares: enrich(s.data ?? [], m).map(r => ({ ...r, effective_now: effectiveAt([r], day).length > 0 })),
    })
  } catch (e) { return fail(res, String(e)) }
}
export async function createAllocation(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zAllocationCreate>
    if (!whAllowed(req, b.from_warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const bad = await refsExist(b.from_warehouse_id, b.transport_company_id, null)
    if (bad) return fail(res, bad, 400)
    const from = b.effective_from ?? todayVN()
    if (!effOk(from, b.effective_to)) return fail(res, 'Hiệu lực đến phải ≥ hiệu lực từ', 400)
    const actor = req.user?.name || null
    const rec: AllocationInsert = {
      id: randomUUID(), from_warehouse_id: b.from_warehouse_id, area_kind: b.area_kind, area_code: b.area_code.trim(), transport_company_id: b.transport_company_id,
      priority: b.priority ?? 1, effective_from: from, effective_to: b.effective_to ?? null, is_active: b.is_active ?? true, note: b.note ?? null,
      created_by: actor, updated_by: actor, updated_at: now(),
    }
    const { data, error } = await db.from('carrier_allocation').insert(rec).select().single()
    if (error) return fail(res, error)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}
export async function updateAllocation(req: Request, res: Response) {
  try {
    const { id } = req.params
    const b = req.body as z.infer<typeof zAllocationUpdate>
    const { data: cur } = await db.from('carrier_allocation').select('from_warehouse_id, effective_from, effective_to').eq('id', id).maybeSingle()
    if (!cur) return fail(res, 'Không tìm thấy dòng phân tuyến', 404)
    if (!whAllowed(req, cur.from_warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const from = b.effective_from ?? cur.effective_from, to = b.effective_to === undefined ? cur.effective_to : b.effective_to
    if (!effOk(from, to)) return fail(res, 'Hiệu lực đến phải ≥ hiệu lực từ', 400)
    const { data, error } = await db.from('carrier_allocation').update({ ...b, updated_at: now(), updated_by: req.user?.name || null }).eq('id', id).select().maybeSingle()
    if (error) return fail(res, error)
    if (!data) return fail(res, 'Không tìm thấy dòng phân tuyến', 404)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}
export async function deleteAllocation(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { data: cur } = await db.from('carrier_allocation').select('from_warehouse_id').eq('id', id).maybeSingle()
    if (!cur) return fail(res, 'Không tìm thấy dòng phân tuyến', 404)
    if (!whAllowed(req, cur.from_warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const { data: gone, error } = await db.from('carrier_allocation').delete().eq('id', id).select('id')
    if (error) return fail(res, error)
    if (!gone?.length) return fail(res, 'Không tìm thấy dòng phân tuyến', 404)
    return ok(res, { deleted: id })
  } catch (e) { return fail(res, String(e)) }
}
export async function createShare(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zShareCreate>
    if (!whAllowed(req, b.from_warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const bad = await refsExist(b.from_warehouse_id, b.transport_company_id, null)
    if (bad) return fail(res, bad, 400)
    const from = b.effective_from ?? todayVN()
    if (!effOk(from, b.effective_to)) return fail(res, 'Hiệu lực đến phải ≥ hiệu lực từ', 400)
    // Σ tỷ trọng đang hiệu lực của kho ≤ 100 — vượt là bảng tự mâu thuẫn, engine không chia được
    const { data: others } = await db.from('carrier_share_target').select('transport_company_id, share_pct, effective_from, effective_to, is_active').eq('from_warehouse_id', b.from_warehouse_id)
    const sum = effectiveAt((others ?? []).filter(o => o.transport_company_id !== b.transport_company_id), from).reduce((a, o) => a + Number(o.share_pct), 0)
    if (sum + b.share_pct > 100.0001) return fail(res, `Tổng tỷ trọng của kho sẽ là ${(sum + b.share_pct).toFixed(1)} % > 100 % (các ĐVVT khác đang giữ ${sum.toFixed(1)} %)`, 400)
    const actor = req.user?.name || null
    const rec: ShareInsert = {
      id: randomUUID(), from_warehouse_id: b.from_warehouse_id, transport_company_id: b.transport_company_id, share_pct: b.share_pct, basis: b.basis ?? 'TRIPS', period: 'MONTH',
      effective_from: from, effective_to: b.effective_to ?? null, is_active: b.is_active ?? true, note: b.note ?? null, created_by: actor, updated_by: actor, updated_at: now(),
    }
    const { data, error } = await db.from('carrier_share_target').insert(rec).select().single()
    if (error) return fail(res, error)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}
export async function updateShare(req: Request, res: Response) {
  try {
    const { id } = req.params
    const b = req.body as z.infer<typeof zShareUpdate>
    const { data: cur } = await db.from('carrier_share_target').select('from_warehouse_id, transport_company_id, share_pct, effective_from, effective_to').eq('id', id).maybeSingle()
    if (!cur) return fail(res, 'Không tìm thấy tỷ trọng', 404)
    if (!whAllowed(req, cur.from_warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const from = b.effective_from ?? cur.effective_from, to = b.effective_to === undefined ? cur.effective_to : b.effective_to
    if (!effOk(from, to)) return fail(res, 'Hiệu lực đến phải ≥ hiệu lực từ', 400)
    if (b.share_pct != null) {
      const { data: others } = await db.from('carrier_share_target').select('id, share_pct, effective_from, effective_to, is_active').eq('from_warehouse_id', cur.from_warehouse_id).neq('id', id)
      const sum = effectiveAt(others ?? [], from).reduce((a, o) => a + Number(o.share_pct), 0)
      if (sum + b.share_pct > 100.0001) return fail(res, `Tổng tỷ trọng của kho sẽ là ${(sum + b.share_pct).toFixed(1)} % > 100 %`, 400)
    }
    const { data, error } = await db.from('carrier_share_target').update({ ...b, updated_at: now(), updated_by: req.user?.name || null }).eq('id', id).select().maybeSingle()
    if (error) return fail(res, error)
    if (!data) return fail(res, 'Không tìm thấy tỷ trọng', 404)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}
export async function deleteShare(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { data: cur } = await db.from('carrier_share_target').select('from_warehouse_id').eq('id', id).maybeSingle()
    if (!cur) return fail(res, 'Không tìm thấy tỷ trọng', 404)
    if (!whAllowed(req, cur.from_warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const { data: gone, error } = await db.from('carrier_share_target').delete().eq('id', id).select('id')
    if (error) return fail(res, error)
    if (!gone?.length) return fail(res, 'Không tìm thấy tỷ trọng', 404)
    return ok(res, { deleted: id })
  } catch (e) { return fail(res, String(e)) }
}
