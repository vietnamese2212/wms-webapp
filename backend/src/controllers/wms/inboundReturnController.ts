// NHẬP HÀNG TRẢ VỀ (26/10, user chốt — memory return-receipt-design-2026-10-26). Thủ kho lập phiếu ở Nhập kho:
//   • chọn CHUYẾN XUẤT GỐC (đã hoàn thành) ⇒ app điền DO · mã · số đã xuất; số trả ≤ đã xuất − đã khai trả trước đó
//   • không tìm được chuyến ⇒ LẬP TAY (khách + mã + số + lý do)
//   • công tắc QA THEO PHIẾU, mặc định KHÔNG giữ (giữ = quét nhận gắn QAStatus 'X')
// Mỗi mã thành MỘT phiếu nhập (ProductionImport source_type 'RETURN', `return_id`) ⇒ quét / lưu thủ công / hoàn thành dùng
// lại nguyên màn chi tiết phiếu nhập. Hàng lẻ (không tem riêng) nhận theo TEM GỐC ⇒ tem con ".N" mang lô / NSX / HSD gốc.
// Mọi lần nhận ghi `inbound_return_scan` (tem gốc nào, bao nhiêu) ⇒ truy xuất lô trừ phần trả về khỏi "đã giao khách",
// sổ pallet hiện "trả về từ chuyến X" trên chính tem gốc. Giao lại = ĐƠN RIÊNG (SAP tạo DO mới) — phiếu trả không mang.
// KHÔNG gắn ProductionImport.from_gdo_id (cửa nhận chuyển kho đếm phiếu theo cột đó).
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { db } from '../../lib/supabase'
import { z, zText } from '../../middlewares/validate'
import { ok, fail, failAny } from '../../utils/response'
import { fetchAllByIdChunks, fetchAllRowsParallel } from '../../utils/pagination'
import { safeFilterValue } from '../../utils/search'
import { categoryAllowed, scopeCategoriesOf, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'
import { qtyIntegerError, qtyLabel, type MatUnits } from '../../utils/qtyUnits'
import { requireBaseQty } from '../../utils/qtySemantics'
import { resolveActorId, resolveActorName } from '../../utils/actor'
import { normalizeQR, parseInboundQR } from '../../utils/qrParser'
import { childBaseOf, childLikePattern, childIndexOf, childCodeOf } from '../../utils/palletChild'
import { effectiveNoQr } from '../../lib/inventoryMode'
import { isDay } from '../../utils/dates'
import { emitInboundChanged } from '../../lib/events'
import { guardPutaway, type PutawayLocRow } from '../../services/putawayContext'
import { putawayEnforces } from '../../utils/putaway'
import type { MaterialShelfInfo } from '../../utils/shelfLife'

const vnDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const ddmmyyOf = (d: string) => `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(2, 4)}`
const nowIso = () => new Date().toISOString()
const uniq = <T,>(a: T[]) => [...new Set(a)]
const scopeOf = (req: Request): string[] | null => (req.user?.warehouse_scope === 'NATIONAL' ? null : (req.user?.warehouse_ids ?? []))
const inScope = (req: Request, wh: string | null | undefined) => { const s = scopeOf(req); return s === null || (!!wh && s.includes(wh)) }
const SCOPE_MSG = 'Ngoài phạm vi kho được giao — không thể thao tác nhập trả của kho này'
const jitter = (n: number) => new Promise(r => setTimeout(r, 15 + Math.floor(Math.random() * (40 + n * 25))))
/** Mã số kế tiếp theo tiền tố (`${prefix}NN`) — đua nhau thì người sau dính unique ⇒ caller thử lại. */
const maxSeq = (codes: (string | null)[], prefix: string) => codes.reduce((max: number, c) => {
  const n = parseInt(String(c ?? '').slice(prefix.length), 10)
  return isNaN(n) ? max : Math.max(max, n)
}, 0)
const nextReturnSeq = async (prefix: string) =>
  maxSeq(((await db.from('inbound_return').select('return_code').ilike('return_code', `${prefix}%`)).data ?? []).map(r => r.return_code), prefix)
const nextImportSeq = async (prefix: string) =>
  maxSeq(((await db.from('ProductionImport').select('import_code').ilike('import_code', `${prefix}%`)).data ?? []).map(r => r.import_code), prefix)

type Mat = { id: string; material_code: string; short_name: string | null; base_unit: string | null; entry_unit: string | null; units_per_carton: number | null; category: string | null; no_qr_tracking: boolean | null }
export type TripLine = {
  od_number: string; ship_to_code: string | null; customer: string | null; material_id: string
  material: Mat | null; shipped_base: number; returned_base: number
  pallets: { pallet_code: string; qty_base: number; production_date: string | null }[]
}
type Trip = { id: string; group_code: string | null; license_plate: string | null; delivery_date: string | null; warehouse_id: string | null; status: string | null }

/** Chuyến gốc + từng dòng (DO × mã): số ĐÃ XUẤT (đã quét) · số đã KHAI trả ở phiếu chưa huỷ · tem đã quét đi. */
async function loadTrip(gdoId: string): Promise<{ trip: Trip | null; lines: TripLine[] }> {
  const { data: g } = await db.from('GroupDeliveryOrder').select('id, group_code, license_plate, delivery_date, warehouse_id, status').eq('id', gdoId).maybeSingle()
  if (!g) return { trip: null, lines: [] }
  const { data: dos } = await db.from('OutboundDelivery').select('id, delivery_code, distributor_name, ship_to_code').eq('gdo_id', gdoId).order('id')
  const doRows = (dos ?? []) as { id: string; delivery_code: string | null; distributor_name: string | null; ship_to_code: string | null }[]
  const items = (await fetchAllByIdChunks(doRows.map(d => d.id), c => db.from('OutboundItem')
    .select('id, do_id, material_id, cartons_scanned').in('do_id', c).order('id'))) as { id: string; do_id: string; material_id: string | null; cartons_scanned: number | null }[]
  const scans = (await fetchAllByIdChunks(items.map(i => i.id), c => db.from('OutboundScanEntry')
    .select('item_id, pallet_code, cartons_scanned, production_date').in('item_id', c).order('id'))) as { item_id: string; pallet_code: string | null; cartons_scanned: number | null; production_date: string | null }[]
  const matIds = uniq(items.map(i => i.material_id).filter((x): x is string => !!x))
  const mats = (await fetchAllByIdChunks(matIds, c => db.from('Material')
    .select('id, material_code, short_name, base_unit, entry_unit, units_per_carton, category, no_qr_tracking').in('id', c).order('id'))) as Mat[]
  const matOf = new Map(mats.map(m => [m.id, m]))
  // đã khai trả trước đó (phiếu nhập chưa huỷ)
  const { data: rets } = await db.from('inbound_return').select('id').eq('gdo_id', gdoId)
  const retIds = ((rets ?? []) as { id: string }[]).map(r => r.id)
  const prior = retIds.length ? (await fetchAllByIdChunks(retIds, c => db.from('inbound_return_line')
    .select('od_number, material_id, qty_base, import_order_id').in('return_id', c).order('id'))) as { od_number: string | null; material_id: string; qty_base: number; import_order_id: string | null }[] : []
  // chỉ đếm dòng khai CÒN phiếu nhập chưa huỷ (huỷ phiếu = xoá dòng ProductionImport — C105); cùng luật RPC inbound_return_create
  const impIds = uniq(prior.map(p => p.import_order_id).filter((x): x is string => !!x))
  const live = new Set(impIds.length ? ((await fetchAllByIdChunks(impIds, c => db.from('ProductionImport')
    .select('id, status').in('id', c).order('id'))) as { id: string; status: string }[]).filter(i => i.status !== 'CANCELLED').map(i => i.id) : [])
  const key = (od: string, mid: string) => `${od}||${mid}`
  const returned = new Map<string, number>()
  for (const p of prior) if (p.import_order_id && live.has(p.import_order_id)) {
    const k = key(p.od_number ?? '', p.material_id); returned.set(k, (returned.get(k) ?? 0) + Number(p.qty_base))
  }
  const doOf = new Map(doRows.map(d => [d.id, d]))
  const scansOf = new Map<string, typeof scans>()
  for (const s of scans) { const l = scansOf.get(s.item_id) ?? []; l.push(s); scansOf.set(s.item_id, l) }
  const lines = new Map<string, TripLine>()
  for (const it of items) {
    const d = doOf.get(it.do_id); if (!d || !it.material_id) continue
    const od = d.delivery_code ?? ''
    const k = key(od, it.material_id)
    const m = matOf.get(it.material_id) ?? null
    const l = lines.get(k) ?? { od_number: od, ship_to_code: d.ship_to_code, customer: d.distributor_name, material_id: it.material_id, material: m, shipped_base: 0, returned_base: returned.get(k) ?? 0, pallets: [] }
    l.shipped_base += Number(it.cartons_scanned ?? 0)
    for (const s of scansOf.get(it.id) ?? []) {
      // mã không theo QR: "tem" = mã hàng (pool chung) — không phải tem thật, không đưa vào danh sách tem gốc
      if (!s.pallet_code || (m && s.pallet_code === m.material_code)) continue
      const p = l.pallets.find(x => x.pallet_code === s.pallet_code)
      if (p) p.qty_base += Number(s.cartons_scanned ?? 0)
      else l.pallets.push({ pallet_code: s.pallet_code, qty_base: Number(s.cartons_scanned ?? 0), production_date: s.production_date ? String(s.production_date).slice(0, 10) : null })
    }
    lines.set(k, l)
  }
  return { trip: g as Trip, lines: [...lines.values()].filter(l => l.shipped_base > 0).sort((a, b) => a.od_number.localeCompare(b.od_number) || (a.material?.material_code ?? '').localeCompare(b.material?.material_code ?? '')) }
}

// GET /wms/inbound-returns/trips?warehouse_id=&q=&days= — TÌM CHUYẾN GỐC (đã hoàn thành) theo Số xe · DO · khách · biển số
export const zReturnTripsQuery = z.object({ warehouse_id: zText(1, 64), q: zText(0, 80).optional(), days: z.coerce.number().int().min(1).max(365).optional() })
export async function searchReturnTrips(req: Request, res: Response) {
  try {
    const { warehouse_id, q, days } = req.query as unknown as z.infer<typeof zReturnTripsQuery>
    if (!inScope(req, warehouse_id)) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const since = new Date(Date.parse(`${vnDate()}T00:00:00Z`) - (days ?? 90) * 86_400_000).toISOString().slice(0, 10)
    const term = q?.trim() ? safeFilterValue(q.trim()) : ''
    let gq = db.from('GroupDeliveryOrder').select('id, group_code, license_plate, delivery_date, completed_at')
      .eq('warehouse_id', warehouse_id).eq('status', 'COMPLETED').gte('delivery_date', since)
    if (term) {
      // DO / khách khớp ⇒ chuyến chứa nó (≤100 chuyến — URL `.in()` an toàn dưới trần ~300 id)
      const { data: dd } = await db.from('OutboundDelivery').select('gdo_id')
        .or(`delivery_code.ilike.%${term}%,distributor_name.ilike.%${term}%,ship_to_code.ilike.%${term}%`).limit(100)
      const ids = uniq(((dd ?? []) as { gdo_id: string | null }[]).map(d => d.gdo_id).filter((x): x is string => !!x))
      gq = gq.or([`group_code.ilike.%${term}%`, `license_plate.ilike.%${term}%`, ...(ids.length ? [`id.in.(${ids.join(',')})`] : [])].join(','))
    }
    const { data: gs, error } = await gq.order('delivery_date', { ascending: false }).order('group_code').limit(50)
    if (error) throw error
    const trips = (gs ?? []) as { id: string; group_code: string | null; license_plate: string | null; delivery_date: string | null; completed_at: string | null }[]
    const ids = trips.map(t => t.id)
    const [dos, rets] = ids.length ? await Promise.all([
      fetchAllByIdChunks(ids, c => db.from('OutboundDelivery').select('gdo_id, delivery_code, distributor_name').in('gdo_id', c).order('id')),
      fetchAllByIdChunks(ids, c => db.from('inbound_return').select('gdo_id, return_code').in('gdo_id', c).order('return_code')),
    ]) : [[], []]
    const byGdo = (rows: { gdo_id: string | null }[]) => { const m = new Map<string, typeof rows>(); for (const r of rows) if (r.gdo_id) { const l = m.get(r.gdo_id) ?? []; l.push(r); m.set(r.gdo_id, l) } return m }
    const dosBy = byGdo((dos ?? []) as { gdo_id: string | null; delivery_code: string | null; distributor_name: string | null }[]) as Map<string, { gdo_id: string | null; delivery_code: string | null; distributor_name: string | null }[]>
    const retBy = byGdo((rets ?? []) as { gdo_id: string | null; return_code: string }[]) as Map<string, { gdo_id: string | null; return_code: string }[]>
    return ok(res, { items: trips.map(t => ({
      gdo_id: t.id, group_code: t.group_code, license_plate: t.license_plate, delivery_date: t.delivery_date, completed_at: t.completed_at,
      dos: uniq((dosBy.get(t.id) ?? []).map(d => d.delivery_code).filter((x): x is string => !!x)),
      customers: uniq((dosBy.get(t.id) ?? []).map(d => d.distributor_name).filter((x): x is string => !!x)),
      returns: (retBy.get(t.id) ?? []).map(r => r.return_code),
    })) })
  } catch (e) { return failAny(res, e) }
}

// GET /wms/inbound-returns/trips/:gdoId — dòng của chuyến gốc để điền form
export async function getReturnTrip(req: Request, res: Response) {
  try {
    const { trip, lines } = await loadTrip(req.params.gdoId)
    if (!trip) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy chuyến xuất')
    if (!inScope(req, trip.warehouse_id)) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    if (trip.status !== 'COMPLETED') return fail(res, 409, 'TRIP_NOT_COMPLETED', `Chuyến ${trip.group_code ?? ''} chưa hoàn thành — chỉ nhập trả cho chuyến đã xuất xong`)
    return ok(res, { trip, lines })
  } catch (e) { return failAny(res, e) }
}

// POST /wms/inbound-returns — LẬP PHIẾU NHẬP TRẢ (theo chuyến gốc hoặc lập tay)
export const zCreateReturn = z.object({
  qty_semantics: z.literal('base'),
  warehouse_id: zText(1, 64),
  gdo_id: zText(1, 64).optional(),
  ship_to_code: zText(0, 64).optional(),
  ship_to_name: zText(0, 200).optional(),
  reason_code: zText(1, 40),                 // danh mục LookupValue 'return_reason' (user 26/10)
  reason: zText(0, 500).optional(),          // ghi chú
  recall_id: zText(1, 64).optional(),        // đợt thu hồi — bắt buộc khi lý do khai requires_recall
  qa_hold: z.boolean().optional(),
  lines: z.array(z.object({ od_number: zText(0, 200).nullish(), material_id: zText(1, 64), qty_base: z.number().positive() })).min(1).max(300),
})
/** Lý do trả (danh mục) + đợt thu hồi: lý do phải có trong danh mục; lý do khai `requires_recall` ⇒ bắt chọn đợt;
 *  đợt (nếu chọn) phải đang MỞ. Dùng chung cho phiếu RT và gắn lý do phiếu NPP chuyển về. */
export async function checkReasonRecall(reasonCode: string, recallId: string | null | undefined): Promise<{ error: string | null; label: string }> {
  const { data: rr } = await db.from('LookupValue').select('value, meta').eq('type', 'return_reason').eq('value', reasonCode).maybeSingle()
  if (!rr) return { error: `Lý do "${reasonCode}" không có trong danh mục lý do trả hàng`, label: reasonCode }
  const meta = (rr.meta ?? null) as { requires_recall?: boolean; label?: string } | null
  const label = meta?.label?.trim() || reasonCode
  if (meta?.requires_recall === true && !recallId) return { error: `Lý do "${label}" phải chọn MÃ ĐỢT thu hồi`, label }
  if (recallId) {
    const { data: rc } = await db.from('recall_campaign').select('code, status').eq('id', recallId).maybeSingle()
    if (!rc) return { error: 'Không tìm thấy đợt thu hồi', label }
    if (rc.status !== 'OPEN') return { error: `Đợt ${rc.code} đã đóng — không gắn thêm phiếu`, label }
  }
  return { error: null, label }
}

export async function createReturn(req: Request, res: Response) {
  try {
    if (!requireBaseQty(req, res)) return
    const body = req.body as z.infer<typeof zCreateReturn>
    const b = { ...body, lines: body.lines.map(l => ({ ...l, od_number: l.od_number?.trim() || null })) }
    if (!inScope(req, b.warehouse_id)) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const rc = await checkReasonRecall(b.reason_code, b.recall_id)
    if (rc.error) return fail(res, 422, 'RETURN_REASON_INVALID', rc.error)
    const note = b.reason?.trim() || null
    const reasonText = `${rc.label}${note ? `: ${note}` : ''}`
    const { data: wh } = await db.from('Warehouse').select('id, code').eq('id', b.warehouse_id).maybeSingle()
    if (!wh) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')

    let trip: Trip | null = null
    let shipTo = { code: b.ship_to_code?.trim() || null, name: b.ship_to_name?.trim() || null }
    const matIds = uniq(b.lines.map(l => l.material_id))
    const mats = (await fetchAllByIdChunks(matIds, c => db.from('Material')
      .select('id, material_code, short_name, base_unit, entry_unit, units_per_carton, category, no_qr_tracking').in('id', c).order('id'))) as Mat[]
    const matOf = new Map(mats.map(m => [m.id, m]))
    const errors: string[] = []
    for (const id of matIds) {
      const m = matOf.get(id)
      if (!m) errors.push(`Không tìm thấy mã hàng ${id}`)
      else if (!categoryAllowed(req, m.category)) return fail(res, 403, 'FORBIDDEN', `${CATEGORY_FORBIDDEN_MSG} (${m.material_code} · ${m.category})`)
    }
    for (const l of b.lines) { const m = matOf.get(l.material_id); const ie = m ? qtyIntegerError(l.qty_base, m as MatUnits) : null; if (ie) errors.push(`${m?.material_code}: ${ie}`) }

    // trả ≤ đã xuất − đã khai trả trước (gộp các dòng cùng DO × mã trong chính phiếu này). Kiểm ở đây để báo lỗi
    // đủ mọi dòng; RPC inbound_return_create kiểm LẠI dưới khoá theo chuyến lúc ghi (hai người lập cùng lúc — C104).
    const want = new Map<string, number>()
    for (const l of b.lines) { const k = `${l.od_number ?? ''}||${l.material_id}`; want.set(k, (want.get(k) ?? 0) + l.qty_base) }
    let tripLines: TripLine[] = []
    if (b.gdo_id) {
      const t = await loadTrip(b.gdo_id)
      trip = t.trip
      tripLines = t.lines
      if (!trip) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy chuyến xuất gốc')
      if (trip.warehouse_id !== b.warehouse_id) return fail(res, 422, 'WAREHOUSE_MISMATCH', 'Chuyến gốc thuộc kho khác kho nhập trả')
      if (trip.status !== 'COMPLETED') return fail(res, 409, 'TRIP_NOT_COMPLETED', `Chuyến ${trip.group_code ?? ''} chưa hoàn thành — chỉ nhập trả cho chuyến đã xuất xong`)
      for (const [k, q] of want) {
        const [od, mid] = k.split('||')
        const tl = t.lines.find(x => x.od_number === od && x.material_id === mid)
        const m = matOf.get(mid) as MatUnits | undefined
        if (!tl) { errors.push(`DO ${od || '—'} · ${matOf.get(mid)?.material_code ?? mid}: không có trên chuyến ${trip.group_code ?? ''}`); continue }
        const room = tl.shipped_base - tl.returned_base
        if (q > room + 1e-9) errors.push(`DO ${od} · ${tl.material?.material_code}: trả ${qtyLabel(q, m)} vượt phần còn trả được ${qtyLabel(Math.max(0, room), m)} (đã xuất ${qtyLabel(tl.shipped_base, m)}${tl.returned_base ? `, đã khai trả ${qtyLabel(tl.returned_base, m)}` : ''})`)
      }
      const custs = uniq(t.lines.filter(x => want.has(`${x.od_number}||${x.material_id}`)).map(x => x.customer).filter((x): x is string => !!x))
      const codes = uniq(t.lines.filter(x => want.has(`${x.od_number}||${x.material_id}`)).map(x => x.ship_to_code).filter((x): x is string => !!x))
      shipTo = { code: codes.length === 1 ? codes[0] : null, name: custs.join(', ').slice(0, 200) || null }
    } else if (!shipTo.name) {
      errors.push('Lập tay — phải ghi khách trả hàng')
    }
    if (errors.length) return fail(res, 422, 'RETURN_INVALID', errors.join('\n'))

    const t0 = nowIso(), today = vnDate(), ddmmyy = ddmmyyOf(today)
    const actor = resolveActorId(req)
    // Số phiếu `<kho>_RT_ddmmyy_NN`; MỖI MÃ MỘT PHIẾU NHẬP (dùng lại màn quét / lưu thủ công / hoàn thành của Nhập kho).
    // Đầu phiếu + phiếu nhập + dòng khai ghi trong MỘT giao dịch (RPC) — trùng số phiếu ⇒ 23505 ⇒ đặt số mới, thử lại.
    const rPrefix = `${wh.code}_RT_${ddmmyy}_`, iPrefix = `${wh.code}_N_${ddmmyy}_`
    const returnId = randomUUID()
    const perMat = new Map<string, number>()
    for (const l of b.lines) perMat.set(l.material_id, (perMat.get(l.material_id) ?? 0) + l.qty_base)
    const impIdOf = new Map([...perMat.keys()].map(mid => [mid, randomUUID()]))
    const shipped = new Map(tripLines.map(tl => [`${tl.od_number}||${tl.material_id}`, tl.shipped_base]))
    const lineRows = b.lines.map(l => ({
      id: randomUUID(), return_id: returnId, od_number: l.od_number, material_id: l.material_id, qty_base: l.qty_base,
      shipped_base: trip ? (shipped.get(`${l.od_number ?? ''}||${l.material_id}`) ?? null) : null, import_order_id: impIdOf.get(l.material_id) ?? null, created_at: t0, updated_at: t0,
    }))
    let returnCode = ''
    let imports: { id: string; import_code: string; material_id: string }[] = []
    for (let attempt = 0; attempt < 8 && !returnCode; attempt++) {
      const [rSeq, iSeq] = await Promise.all([nextReturnSeq(rPrefix), nextImportSeq(iPrefix)])
      const code = `${rPrefix}${String(rSeq + 1).padStart(2, '0')}`
      const rows = [...perMat].map(([mid, qty], i) => ({
        id: impIdOf.get(mid) ?? randomUUID(), import_code: `${iPrefix}${String(iSeq + i + 1).padStart(2, '0')}`, warehouse_id: b.warehouse_id, material_id: mid,
        planned_cartons: qty, status: 'OPEN', source_type: 'RETURN', warehouse_type: matOf.get(mid)?.category ?? null, import_date: today,
        return_id: returnId, notes: `Trả về${trip?.group_code ? ` từ chuyến ${trip.group_code}` : ' (lập tay)'} — ${reasonText}`.slice(0, 500),
        created_by: actor, updated_by: actor, created_at: t0, updated_at: t0,
      }))
      const { data: r, error } = await db.rpc('inbound_return_create', {
        p_head: {
          id: returnId, return_code: code, warehouse_id: b.warehouse_id, gdo_id: trip?.id ?? null, group_code: trip?.group_code ?? null,
          ship_to_code: shipTo.code, ship_to_name: shipTo.name, reason: note, reason_code: b.reason_code, recall_id: b.recall_id ?? null, qa_hold: b.qa_hold === true,
          created_by: actor, created_by_name: resolveActorName(req), created_at: t0, updated_at: t0,
        },
        p_imports: rows, p_lines: lineRows,
        p_gdo_id: trip?.id, p_limits: trip ? Object.fromEntries([...want.keys()].map(k => [k, shipped.get(k) ?? 0])) : undefined,
      })
      if (error) { if (error.code !== '23505') throw error; await jitter(attempt); continue }
      const out = String(r ?? '')
      if (out.startsWith('OVER|')) {
        // người khác vừa khai trả cùng dòng — đếm dưới khoá thấy vượt
        const rest = out.slice(5), cut = rest.lastIndexOf('|'), [od, mid] = rest.slice(0, cut).split('||')
        const m = matOf.get(mid) as MatUnits | undefined
        return fail(res, 422, 'RETURN_INVALID', `DO ${od || '—'} · ${matOf.get(mid)?.material_code ?? mid}: vừa có phiếu trả khác khai cùng dòng — chỉ còn trả được ${qtyLabel(Number(rest.slice(cut + 1)), m)}. Mở lại chuyến để xem số mới.`)
      }
      returnCode = code
      imports = rows.map(x => ({ id: x.id, import_code: x.import_code, material_id: x.material_id }))
    }
    if (!returnCode) return fail(res, 409, 'BUSY', 'Nhiều người cùng lập phiếu trả — thử lại')
    emitInboundChanged()
    return ok(res, { return_id: returnId, return_code: returnCode, imports }, 201)
  } catch (e) { return failAny(res, e) }
}

export type ReturnHead = { id: string; qa_hold: boolean; group_code: string | null; gdo_id: string | null; return_code: string }
/** Đầu phiếu trả theo id (null nếu không có). */
export async function returnHead(returnId: string | null | undefined): Promise<ReturnHead | null> {
  if (!returnId) return null
  const { data } = await db.from('inbound_return').select('id, qa_hold, group_code, gdo_id, return_code').eq('id', returnId).maybeSingle()
  return (data as ReturnHead | null) ?? null
}
/** Id trạng thái QA "giữ" dùng cho công tắc Hold của phiếu trả (mã 'X' — services/qaStatus: mọi mã khác 'OK' là giữ). */
export async function returnHoldQaId(): Promise<string | null> {
  const { data } = await db.from('QAStatus').select('id').eq('code', 'X').maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}
/** Ghi SỔ NHẬN TRẢ (lỗi ghi sổ không làm hỏng lượt nhận đã ghi tồn — nhưng nói ra). `room` = phần còn "trả về" được
 *  (null = không trần — phiếu lập tay): lượt nhận vượt `room` ghi thành HAI dòng — phần trong trần + phần THỪA. */
export async function logReturnScan(r: { return_id: string; import_order_id: string; entry_id: string | null; source_pallet_code: string | null; merged: boolean; qty_base: number; actor: string | null; room?: number | null }): Promise<string | null> {
  if (!(r.qty_base > 0)) return null
  const t = nowIso()
  const { actor, room, qty_base, ...cols } = r
  const inCap = room == null ? qty_base : Math.min(qty_base, Math.max(0, room))
  const rows = [
    ...(inCap > 0 ? [{ id: randomUUID(), ...cols, qty_base: inCap, surplus: false, created_by: actor, created_at: t, updated_at: t }] : []),
    ...(qty_base - inCap > 0 ? [{ id: randomUUID(), ...cols, qty_base: qty_base - inCap, surplus: true, created_by: actor, created_at: t, updated_at: t }] : []),
  ]
  const { error } = await db.from('inbound_return_scan').insert(rows)
  if (error) { console.error('[inboundReturn] ghi sổ nhận trả:', error); return `Chưa ghi được sổ nhận trả: ${error.message}` }
  return null
}

// GET /wms/inbound-returns/by-order/:id — đầu phiếu + dòng khai + TEM GỐC của mã (để nhận hàng lẻ) cho màn chi tiết phiếu nhập
export async function getReturnByOrder(req: Request, res: Response) {
  try {
    const { data: imp } = await db.from('ProductionImport').select('id, warehouse_id, material_id, return_id, source_type').eq('id', req.params.id).maybeSingle()
    if (!imp) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (!inScope(req, imp.warehouse_id)) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    if (!imp.return_id) return fail(res, 404, 'NOT_RETURN', 'Phiếu nhập này không phải phiếu trả về')
    const { data: head } = await db.from('inbound_return')
      .select('id, return_code, gdo_id, group_code, ship_to_code, ship_to_name, reason, reason_code, recall_id, qa_hold, created_by_name, created_at, recall:recall_campaign!recall_id(code, name)')
      .eq('id', imp.return_id).maybeSingle()
    if (!head) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu trả')
    const [{ data: lines }, { data: scans }] = await Promise.all([
      db.from('inbound_return_line').select('od_number, qty_base, shipped_base').eq('import_order_id', imp.id).order('od_number'),
      db.from('inbound_return_scan').select('source_pallet_code, qty_base, merged, surplus, entry_id, created_at').eq('import_order_id', imp.id).order('created_at'),
    ])
    let pallets: TripLine['pallets'] = []
    let license_plate: string | null = null
    if (head.gdo_id && imp.material_id) {
      const t = await loadTrip(head.gdo_id)
      license_plate = t.trip?.license_plate ?? null
      for (const l of t.lines.filter(x => x.material_id === imp.material_id))
        for (const p of l.pallets) { const e = pallets.find(x => x.pallet_code === p.pallet_code); if (e) e.qty_base += p.qty_base; else pallets.push({ ...p }) }
    }
    // đã nhận về theo từng tem gốc (mọi phiếu trả của chuyến) — để người nhận biết tem nào còn trả được
    const recvBy = new Map<string, number>(), surBy = new Map<string, number>()
    if (head.gdo_id && pallets.length) {
      const { data: rs } = await db.from('inbound_return').select('id').eq('gdo_id', head.gdo_id)
      const rids = ((rs ?? []) as { id: string }[]).map(r => r.id)
      const all = rids.length ? ((await fetchAllByIdChunks(rids, c => db.from('inbound_return_scan').select('source_pallet_code, qty_base, surplus').in('return_id', c).order('id'))) as { source_pallet_code: string | null; qty_base: number; surplus: boolean }[]) : []
      for (const s of all) if (s.source_pallet_code) { const m = s.surplus ? surBy : recvBy; m.set(s.source_pallet_code, (m.get(s.source_pallet_code) ?? 0) + Number(s.qty_base)) }
    }
    const { data: rl } = head.reason_code ? await db.from('LookupValue').select('meta').eq('type', 'return_reason').eq('value', head.reason_code).maybeSingle() : { data: null }
    return ok(res, { ...head, reason_label: (rl?.meta as { label?: string } | null)?.label ?? head.reason_code, license_plate, lines: lines ?? [], scans: scans ?? [],
      pallets: pallets.map(p => ({ ...p, returned_base: recvBy.get(p.pallet_code) ?? 0, surplus_base: surBy.get(p.pallet_code) ?? 0 })).sort((a, b) => a.pallet_code.localeCompare(b.pallet_code)) })
  } catch (e) { return failAny(res, e) }
}

/** Số tem này ĐÃ XUẤT trên chuyến gốc (0 = tem không đi trên chuyến đó). Phiếu trả theo chuyến chỉ nhận tem của chuyến (user 26/10). */
export async function tripPalletShipped(gdoId: string, materialId: string, palletCode: string): Promise<number> {
  const { data: dos } = await db.from('OutboundDelivery').select('id').eq('gdo_id', gdoId).order('id')
  const doIds = ((dos ?? []) as { id: string }[]).map(d => d.id)
  if (!doIds.length) return 0
  const items = (await fetchAllByIdChunks(doIds, c => db.from('OutboundItem').select('id').in('do_id', c).eq('material_id', materialId).order('id'))) as { id: string }[]
  if (!items.length) return 0
  const scans = (await fetchAllByIdChunks(items.map(i => i.id), c => db.from('OutboundScanEntry')
    .select('cartons_scanned').in('item_id', c).eq('pallet_code', palletCode).order('id'))) as { cartons_scanned: number | null }[]
  return scans.reduce((s, x) => s + Number(x.cartons_scanned ?? 0), 0)
}
/** Đã NHẬN VỀ (không tính phần thừa) của tem này qua mọi phiếu trả của chuyến gốc. */
export async function tripPalletReturned(gdoId: string, palletCode: string): Promise<number> {
  const { data: rets } = await db.from('inbound_return').select('id').eq('gdo_id', gdoId)
  const ids = ((rets ?? []) as { id: string }[]).map(r => r.id)
  if (!ids.length) return 0
  const rows = (await fetchAllByIdChunks(ids, c => db.from('inbound_return_scan').select('qty_base')
    .in('return_id', c).eq('source_pallet_code', palletCode).eq('surplus', false).order('id'))) as { qty_base: number }[]
  return rows.reduce((s, r) => s + Number(r.qty_base), 0)
}
/** Còn "trả về" được bao nhiêu cho MÃ (không theo tem — mã không theo QR) trên chuyến: đã xuất − đã nhận về (không tính thừa). */
export async function tripMaterialRoom(gdoId: string, materialId: string): Promise<number> {
  const { data: dos } = await db.from('OutboundDelivery').select('id').eq('gdo_id', gdoId).order('id')
  const doIds = ((dos ?? []) as { id: string }[]).map(d => d.id)
  const items = doIds.length ? (await fetchAllByIdChunks(doIds, c => db.from('OutboundItem').select('cartons_scanned')
    .in('do_id', c).eq('material_id', materialId).order('id'))) as { cartons_scanned: number | null }[] : []
  const shipped = items.reduce((s, i) => s + Number(i.cartons_scanned ?? 0), 0)
  const { data: rets } = await db.from('inbound_return').select('id').eq('gdo_id', gdoId)
  const rIds = ((rets ?? []) as { id: string }[]).map(r => r.id)
  const imps = rIds.length ? (await fetchAllByIdChunks(rIds, c => db.from('ProductionImport').select('id')
    .in('return_id', c).eq('material_id', materialId).order('id'))) as { id: string }[] : []
  const got = imps.length ? (await fetchAllByIdChunks(imps.map(i => i.id), c => db.from('inbound_return_scan').select('qty_base')
    .in('import_order_id', c).eq('surplus', false).order('id'))) as { qty_base: number }[] : []
  return Math.max(0, shipped - got.reduce((s, r) => s + Number(r.qty_base), 0))
}
export const foreignPalletMsg = (palletCode: string, groupCode: string | null) =>
  `Tem ${palletCode} không đi trên chuyến ${groupCode ?? 'gốc'} của phiếu trả này. Hàng của chuyến khác ⇒ lập phiếu trả theo đúng chuyến đó; không rõ chuyến ⇒ lập phiếu trả lập tay.`

// POST /wms/inbound-orders/:id/return-loose — NHẬN HÀNG LẺ trả về theo TEM GỐC: sinh tem con ".N" mang lô / NSX / HSD gốc
export const zReturnLoose = z.object({
  qty_semantics: z.literal('base'),
  source_pallet_code: zText(1, 200),
  qty_base: z.number().positive(),
  location_id: zText(1, 64),
  stack_layer: z.number().int().min(1).max(5).optional(),
  putaway_override_reason: zText(0, 200).optional(),
  production_date: z.string().refine(isDay, 'NSX không phải ngày có thật').optional(),   // NSX gõ tay (mặc định theo tem gốc) — user 26/10 "cả 2 cách"
})
type ChildIn = { orderId: string; source_pallet_code: string; qty_base: number; location_id: string; stack_layer?: number; putaway_override_reason?: string; note?: string; production_date?: string }
type ChildOut = { ok: true; entryId: string; childCode: string; surplusQty: number; warnings: string[] } | { ok: false; status: number; code: string; message: string } | { ok: false; pg: unknown }
const no = (status: number, code: string, message: string): ChildOut => ({ ok: false, status, code, message })
/** Nhận hàng trả về thành TEM CON ".N" của tem gốc (mang lô / NSX / HSD gốc). Dùng cho: hàng lẻ (nút "Nhận hàng lẻ") và
 *  phiếu GIỮ QA quét tem còn tồn (không cộng dồn vào pallet đang OK — user 26/10 "tách pallet con"). */
export async function createReturnChild(req: Request, b: ChildIn): Promise<ChildOut> {
    const { data: imp } = await db.from('ProductionImport')
      .select('id, import_code, status, source_type, return_id, material_id, warehouse_id, warehouse:Warehouse(inventory_mode)').eq('id', b.orderId).maybeSingle()
    if (!imp) return no(404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (!inScope(req, imp.warehouse_id)) return no(403, 'FORBIDDEN', SCOPE_MSG)
    if (imp.source_type !== 'RETURN' || !imp.return_id) return no(422, 'NOT_RETURN', 'Chỉ phiếu nhập trả về mới nhận hàng lẻ theo tem gốc')
    if (imp.status !== 'OPEN') return no(400, 'ORDER_CLOSED', 'Phiếu nhập không còn ở trạng thái mở')
    const { data: mat } = await db.from('Material').select('*').eq('id', imp.material_id ?? '').maybeSingle()
    if (!mat) return no(400, 'NO_MATERIAL', 'Phiếu nhập chưa có hàng hóa')
    const invMode = (imp.warehouse as { inventory_mode?: string | null } | null)?.inventory_mode ?? null
    if (effectiveNoQr(mat.no_qr_tracking, invMode)) return no(422, 'NO_QR_MATERIAL', 'Mã không theo dõi QR — dùng "Lưu thủ công" để nhận')
    const ie = qtyIntegerError(b.qty_base, mat as MatUnits)
    if (ie) return no(422, 'VALIDATION_ERROR', ie)

    const src = normalizeQR(b.source_pallet_code)
    const parsed = parseInboundQR(src)
    if (!parsed.is_valid) return no(400, 'INVALID_QR', parsed.error ?? 'Tem gốc không hợp lệ')
    if (parsed.material_code !== mat.material_code) return no(400, 'MATERIAL_MISMATCH', `Tem gốc là mã "${parsed.material_code}" nhưng phiếu nhập là "${mat.material_code}"`)
    const ret = await returnHead(imp.return_id)
    // phiếu theo chuyến: tem phải đi trên chuyến; phần vượt "đã xuất − đã nhận về" của tem = HÀNG THỪA (vẫn nhận, ghi riêng)
    let room: number | null = null
    if (ret?.gdo_id) {
      const shipped = await tripPalletShipped(ret.gdo_id, mat.id, src)
      if (!shipped) return no(422, 'RETURN_FOREIGN_PALLET', foreignPalletMsg(src, ret.group_code))
      room = Math.max(0, shipped - await tripPalletReturned(ret.gdo_id, src))
    }
    const surplusQty = room == null ? 0 : Math.max(0, b.qty_base - room)
    const { base: cb, error: cbErr } = childBaseOf(src)
    if (!cb) return no(400, 'INVALID_QR', cbErr ?? 'Tem gốc không đúng định dạng')
    // thuộc tính lô của tem gốc (dòng tồn gần nhất cùng mã tem — kể cả đã xuất hết); không có thì đọc từ chính QR
    const { data: srcRow } = await db.from('InventoryEntry')
      .select('manufacturer_id, nmsx, cycle, machine_code, pallet_sequence_no, production_date, batch, expiry_date, ncc_id, shelf_life_days')
      .eq('pallet_code', src).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const s = srcRow as { manufacturer_id: string | null; nmsx: string | null; cycle: string | null; machine_code: string | null; pallet_sequence_no: string | null; production_date: string | null; batch: string | null; expiry_date: string | null; ncc_id: string | null; shelf_life_days: number | null } | null

    const { data: loc } = await db.from('Location').select('*').eq('id', b.location_id).maybeSingle()
    if (!loc) return no(404, 'NOT_FOUND', 'Không tìm thấy vị trí kho')
    if (!loc.is_active) return no(400, 'LOCATION_INACTIVE', 'Vị trí kho không hoạt động')
    if (loc.warehouse_id !== imp.warehouse_id) return no(422, 'LOCATION_WAREHOUSE_MISMATCH', `Vị trí ${loc.location_code} thuộc kho khác`)
    const cats = (loc.categories ?? null) as string[] | null
    if (cats?.length && mat.category && !cats.includes(mat.category))
      return no(422, 'LOCATION_CATEGORY_MISMATCH', `Vị trí ${loc.location_code} thuộc loại "${cats.join(', ')}" — không khớp loại hàng "${mat.category}"`)
    // NSX gõ tay thắng NSX tem gốc; khi đó HSD tem gốc không còn đúng ⇒ bỏ, %Date tính lại từ NSX + hạn dùng
    const prodDate = b.production_date ? `${b.production_date}T00:00:00` : (s?.production_date ?? (parsed.production_date ? parsed.production_date.toISOString() : null))
    const expiry = b.production_date ? null : (s?.expiry_date ?? (parsed.expiry_date ? parsed.expiry_date.toISOString().slice(0, 10) : null))
    const canOverride = req.user?.is_superadmin === true || (req.user?.module_permissions ?? {})['inbound']?.includes('putaway_override') === true
    const put = await guardPutaway({
      warehouseId: imp.warehouse_id, locationId: b.location_id,
      incoming: { material_id: mat.id, ncc_id: s?.ncc_id ?? null, production_date: prodDate, expiry_date: expiry, shelf_life_days: s?.shelf_life_days ?? null },
      overrideReason: b.putaway_override_reason, canOverride, loc: loc as unknown as PutawayLocRow, material: mat as unknown as MaterialShelfInfo,
    })
    if (put.error) return no(put.error.code === 'FORBIDDEN' ? 403 : 422, put.error.code, put.error.message)

    const qaId = ret?.qa_hold ? await returnHoldQaId() : null
    const actor = resolveActorId(req)
    const stack = b.stack_layer ?? 1
    let entryId: string | null = null, childCode = ''
    for (let attempt = 0; attempt < 5 && !entryId; attempt++) {
      // N kế tiếp — xét mọi dòng tồn cùng mã hàng mang tiền tố con (kể cả đã xuất hết: tên con không dùng lại)
      const cands = await fetchAllRowsParallel(() => db.from('InventoryEntry').select('pallet_code').eq('material_id', mat.id).ilike('pallet_code', childLikePattern(cb)).order('id'))
      const maxN = ((cands ?? []) as { pallet_code: string }[]).reduce((m, r) => Math.max(m, childIndexOf(cb, r.pallet_code) ?? 0), 0)
      childCode = childCodeOf(cb, maxN + 1 + attempt)
      const t = nowIso()
      const entry = {
        id: randomUUID(), pallet_code: childCode, ...put.trace, location_id: b.location_id, warehouse_id: imp.warehouse_id, material_id: mat.id,
        manufacturer_id: s?.manufacturer_id ?? null, nmsx: s?.nmsx ?? (parsed.manufacturer_code || null), cycle: s?.cycle ?? (parsed.cycle || null),
        machine_code: s?.machine_code ?? null, pallet_sequence_no: s?.pallet_sequence_no ?? parsed.pallet_sequence_no ?? null, stack_layer: stack,
        cartons_imported: b.qty_base, cartons_remaining: b.qty_base, production_date: prodDate, expiry_date: expiry, batch: s?.batch ?? parsed.batch ?? null,
        qa_status_id: qaId, ncc_id: s?.ncc_id ?? null, shelf_life_days: s?.shelf_life_days ?? null, import_order_id: imp.id,
        created_by: actor, updated_by: actor, status: 'IN_STOCK', import_date: vnDate(), update_date: vnDate(), created_at: t, updated_at: t,
        notes: b.note ?? (surplusQty > 0 && surplusQty === b.qty_base ? `Hàng THỪA trả về theo tem gốc ${src}` : `Hàng lẻ trả về theo tem gốc ${src}`),
      }
      // NGUYÊN TỬ: khoá dòng Location → đếm sức chứa / tầng dưới / số mã DƯỚI LOCK → insert (cùng RPC với quét nhập)
      const { data: r, error } = await db.rpc('scan_insert_pallet', {
        p_entry: entry, p_location_id: b.location_id, p_stack_layer: stack,
        p_max_materials: (putawayEnforces(put.rules, 'MAX_MATERIALS') && !put.trace.putaway_override_reason) ? put.max_materials : null,
      })
      if (error) return { ok: false, pg: error }
      const parts = String(r ?? '').split('|')
      switch (parts[0]) {
        case 'NOLOC':   return no(404, 'NOT_FOUND', 'Không tìm thấy vị trí')
        case 'MAXMAT':  return no(422, 'PUTAWAY_VIOLATION', `Vị trí ${loc.location_code} đang có ${parts[1]} mã, kho giới hạn ${parts[2]} mã cho một vị trí.`)
        case 'FULL':    return no(422, 'LOCATION_FULL', `Vị trí ${loc.location_code} đã đầy (${parts[1]}/${parts[2]} pallet). Chọn tầng chồng hoặc vị trí khác.`)
        case 'NO_BASE': return no(422, 'NO_BASE_LAYER', `Không có pallet tầng ${stack - 1} tại vị trí này để chồng lên`)
        case 'DUP':     await jitter(attempt); continue   // người khác vừa lấy đúng tên con này ⇒ đặt tên kế tiếp
      }
      entryId = parts[1] ?? null
    }
    if (!entryId) return no(409, 'BUSY', 'Nhiều người cùng nhận hàng lẻ của tem này — thử lại')
    const warn = await logReturnScan({ return_id: imp.return_id, import_order_id: imp.id, entry_id: entryId, source_pallet_code: src, merged: false, qty_base: b.qty_base, actor, room })
    emitInboundChanged()
    const surplusMsg = surplusQty > 0 ? [`${qtyLabel(surplusQty, mat as MatUnits)} vượt số tem ${src} đã xuất trên chuyến — ghi là hàng THỪA (chuyến chỉ tính trả về tới số đã xuất).`] : []
    return { ok: true, entryId, childCode, surplusQty, warnings: [...surplusMsg, ...(put.warning ? [put.warning] : []), ...(warn ? [warn] : [])] }
}
/** Trả lỗi của createReturnChild ra response. */
export function failChild(res: Response, r: Exclude<ChildOut, { ok: true }>) {
  return 'pg' in r ? failAny(res, r.pg) : fail(res, r.status, r.code, r.message)
}
export async function receiveReturnLoose(req: Request, res: Response) {
  try {
    if (!requireBaseQty(req, res)) return
    const b = req.body as z.infer<typeof zReturnLoose>
    const r = await createReturnChild(req, { orderId: req.params.id, ...b })
    if (!r.ok) return failChild(res, r)
    return ok(res, { entry_id: r.entryId, pallet_code: r.childCode, surplus_base: r.surplusQty, warnings: r.warnings }, 201)
  } catch (e) { return failAny(res, e) }
}

// ─── ĐỢT THU HỒI (user 26/10: duyệt NGOÀI app; người có quyền tạo MÃ ĐỢT dạng chữ; lý do "Thu hồi" bắt chọn đợt) ───
// GET /wms/recalls?status=OPEN — danh sách đợt (ô chọn trên form + quản lý đợt)
export async function listRecalls(req: Request, res: Response) {
  try {
    const status = String(req.query.status ?? '')
    let q = db.from('recall_campaign').select('id, code, name, note, status, created_by_name, created_at, closed_at')
    if (status === 'OPEN' || status === 'CLOSED') q = q.eq('status', status)
    // danh mục đợt nhỏ (vài đợt / năm) — vẫn chặn trần + nói ra khi chạm
    const { data, error } = await q.order('status', { ascending: false }).order('created_at', { ascending: false }).limit(500)
    if (error) throw error
    return ok(res, { items: data ?? [], truncated: (data ?? []).length >= 500 })
  } catch (e) { return failAny(res, e) }
}
// POST /wms/recalls — tạo mã đợt (quyền inbound.recall_manage)
export const zRecallCreate = z.object({ code: zText(1, 60), name: zText(0, 200).optional(), note: zText(0, 500).optional() })
export async function createRecall(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zRecallCreate>
    const t = nowIso(), code = b.code.trim().toUpperCase()
    const { data, error } = await db.from('recall_campaign').insert({
      id: randomUUID(), code, name: b.name?.trim() || null, note: b.note?.trim() || null, status: 'OPEN',
      created_by: resolveActorId(req), created_by_name: resolveActorName(req), created_at: t, updated_at: t,
    }).select('id, code, name, note, status, created_by_name, created_at, closed_at').single()
    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', `Mã đợt "${code}" đã có`)
      return fail(res, error)
    }
    return ok(res, data, 201)
  } catch (e) { return failAny(res, e) }
}
// PATCH /wms/recalls/:id — sửa tên / ghi chú, đóng / mở lại đợt (quyền inbound.recall_manage). Mã đợt không đổi (phiếu đã gắn).
export const zRecallUpdate = z.object({ name: zText(0, 200).optional(), note: zText(0, 500).optional(), status: z.enum(['OPEN', 'CLOSED']).optional() })
export async function updateRecall(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zRecallUpdate>
    const patch: { updated_at: string; name?: string | null; note?: string | null; status?: string; closed_at?: string | null } = { updated_at: nowIso() }
    if (b.name !== undefined) patch.name = b.name.trim() || null
    if (b.note !== undefined) patch.note = b.note.trim() || null
    if (b.status) { patch.status = b.status; patch.closed_at = b.status === 'CLOSED' ? nowIso() : null }
    const { data, error } = await db.from('recall_campaign').update(patch).eq('id', req.params.id)
      .select('id, code, name, note, status, created_by_name, created_at, closed_at')
    if (error) return fail(res, error)
    if (!data?.length) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy đợt thu hồi')
    return ok(res, data[0])
  } catch (e) { return failAny(res, e) }
}
// GET /wms/recalls/:id/breakdown — đợt đã thu được gì: theo mã · theo khách / NPP (trong phạm vi kho của người xem)
export async function recallBreakdown(req: Request, res: Response) {
  try {
    const { data: rc } = await db.from('recall_campaign').select('id, code, name, note, status, created_at, closed_at').eq('id', req.params.id).maybeSingle()
    if (!rc) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy đợt thu hồi')
    const { data, error } = await db.rpc('recall_breakdown', { p_recall_id: rc.id, p_wh_ids: scopeOf(req) ?? undefined })
    if (error) throw error
    return ok(res, { recall: rc, ...((data ?? {}) as object) })
  } catch (e) { return failAny(res, e) }
}

// ─── HÀNG NPP CHUYỂN VỀ (user 26/10: NPP dùng app tạo đơn xuất về kho chính ⇒ phiếu nhận TF ở kho chính = hàng trả về) ───
type NppImp = { id: string; warehouse_id: string | null; status: string; return_reason_code: string | null; return_note: string | null; recall_id: string | null }
/** Chuyến nguồn của phiếu TF có phải từ kho loại NPP không + các phiếu nhập của chuyến đó. */
async function nppTrip(gdoId: string) {
  const { data: g } = await db.from('GroupDeliveryOrder').select('id, group_code, warehouse_id').eq('id', gdoId).maybeSingle()
  if (!g) return null
  const { data: wh } = g.warehouse_id ? await db.from('Warehouse').select('name, warehouse_type').eq('id', g.warehouse_id).maybeSingle() : { data: null }
  const { data: imps } = await db.from('ProductionImport').select('id, warehouse_id, status, return_reason_code, return_note, recall_id')
    .eq('from_gdo_id', gdoId).eq('source_type', 'TRANSFER').neq('status', 'CANCELLED').order('id')
  return { gdo: g, isNpp: wh?.warehouse_type === 'NPP', nppName: wh?.name ?? null, imports: (imps ?? []) as NppImp[] }
}
// GET /wms/inbound-returns/npp/:gdoId — lý do / đợt đang gắn cho chuyến NPP chuyển về
export async function getNppReturn(req: Request, res: Response) {
  try {
    const t = await nppTrip(req.params.gdoId)
    if (!t) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy chuyến')
    const mine = t.imports.filter(i => inScope(req, i.warehouse_id))
    if (!mine.length) return fail(res, 404, 'NOT_FOUND', 'Không có phiếu nhập của chuyến này trong phạm vi kho')
    // lý do lấy từ phiếu ĐÃ gắn + đếm phiếu còn thiếu (C107): phiếu sinh thêm sau khi gắn (thêm dòng NSX…) chưa mang lý do — bản cũ
    // đọc phiếu đầu theo id ⇒ có lúc báo "đã gắn", nút Lưu khoá mà Hoàn thành vẫn 422
    const tagged = mine.find(i => i.return_reason_code) ?? mine[0]
    return ok(res, { gdo_id: t.gdo.id, group_code: t.gdo.group_code, is_npp: t.isNpp, npp_name: t.nppName, imports: mine.length,
      missing: mine.filter(i => !i.return_reason_code).length,
      reason_code: tagged.return_reason_code, note: tagged.return_note, recall_id: tagged.recall_id })
  } catch (e) { return failAny(res, e) }
}
// PATCH /wms/inbound-returns/npp/:gdoId — gắn lý do / ghi chú / đợt cho MỌI phiếu nhập của chuyến NPP (quyền inbound.create)
export const zNppTag = z.object({ reason_code: zText(1, 40), note: zText(0, 500).optional(), recall_id: zText(1, 64).nullish() })
export async function tagNppReturn(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zNppTag>
    const t = await nppTrip(req.params.gdoId)
    if (!t) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy chuyến')
    if (!t.isNpp) return fail(res, 422, 'NOT_NPP_TRANSFER', 'Chỉ gắn lý do trả cho hàng chuyển về TỪ KHO NPP')
    const mine = t.imports.filter(i => inScope(req, i.warehouse_id))
    if (!mine.length) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    const rc = await checkReasonRecall(b.reason_code, b.recall_id)
    if (rc.error) return fail(res, 422, 'RETURN_REASON_INVALID', rc.error)
    const ids = mine.map(i => i.id), patch = {
      return_reason_code: b.reason_code, return_note: b.note?.trim() || null, recall_id: b.recall_id ?? null,
      updated_by: resolveActorId(req), updated_at: nowIso(),
    }
    let updated = 0
    for (let i = 0; i < ids.length; i += 300) {   // chia lô 300 (trần URL của .in)
      const chunk = ids.slice(i, i + 300)
      const { data, error } = await db.from('ProductionImport').update(patch).in('id', chunk).select('id')
      if (error) return fail(res, error)
      updated += data?.length ?? 0
    }
    emitInboundChanged()
    return ok(res, { updated })
  } catch (e) { return failAny(res, e) }
}

// ─── THỐNG KÊ HÀNG TRẢ VỀ — GET /wms/inbound-returns/report (mỗi dòng một phiếu: RT hoặc một chuyến NPP chuyển về) ───
export const zReturnReportQuery = z.object({
  warehouse_id: zText(1, 64).optional(),
  date_from: z.string().refine(isDay, 'Ngày không hợp lệ').optional(), date_to: z.string().refine(isDay, 'Ngày không hợp lệ').optional(),
  kind: z.enum(['RT', 'NPP']).optional(), reason: zText(1, 40).optional(), recall_id: zText(1, 64).optional(), search: zText(1, 80).optional(),
})
export async function returnReport(req: Request, res: Response) {
  try {
    const q = req.query as unknown as z.infer<typeof zReturnReportQuery>
    const scope = scopeOf(req)
    let whIds: string[] | null = scope
    if (q.warehouse_id) {
      if (scope && !scope.includes(q.warehouse_id)) return ok(res, { rows: [], total: 0, summary: null })
      whIds = [q.warehouse_id]
    }
    const { data, error } = await db.rpc('inbound_return_report', {
      p_wh_ids: whIds ?? undefined, p_cats: scopeCategoriesOf(req) ?? undefined, p_from: q.date_from, p_to: q.date_to,
      p_kind: q.kind, p_reason: q.reason, p_recall_id: q.recall_id, p_search: q.search ? safeFilterValue(q.search) : undefined, p_limit: 1000,
    })
    if (error) throw error
    return ok(res, data)
  } catch (e) { return failAny(res, e) }
}
