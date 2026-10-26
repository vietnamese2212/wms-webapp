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
import { categoryAllowed, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'
import { qtyIntegerError, qtyLabel, type MatUnits } from '../../utils/qtyUnits'
import { requireBaseQty } from '../../utils/qtySemantics'
import { resolveActorId, resolveActorName } from '../../utils/actor'
import { normalizeQR, parseInboundQR } from '../../utils/qrParser'
import { childBaseOf, childLikePattern, childIndexOf, childCodeOf } from '../../utils/palletChild'
import { effectiveNoQr } from '../../lib/inventoryMode'
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
  const impIds = uniq(prior.map(p => p.import_order_id).filter((x): x is string => !!x))
  const cancelled = new Set(impIds.length ? ((await fetchAllByIdChunks(impIds, c => db.from('ProductionImport')
    .select('id, status').in('id', c).order('id'))) as { id: string; status: string }[]).filter(i => i.status === 'CANCELLED').map(i => i.id) : [])
  const key = (od: string, mid: string) => `${od}||${mid}`
  const returned = new Map<string, number>()
  for (const p of prior) if (!p.import_order_id || !cancelled.has(p.import_order_id)) {
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
  reason: zText(1, 500),
  qa_hold: z.boolean().optional(),
  lines: z.array(z.object({ od_number: zText(0, 200).nullish(), material_id: zText(1, 64), qty_base: z.number().positive() })).min(1).max(300),
})
export async function createReturn(req: Request, res: Response) {
  try {
    if (!requireBaseQty(req, res)) return
    const b = req.body as z.infer<typeof zCreateReturn>
    if (!inScope(req, b.warehouse_id)) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
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

    if (b.gdo_id) {
      const t = await loadTrip(b.gdo_id)
      trip = t.trip
      if (!trip) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy chuyến xuất gốc')
      if (trip.warehouse_id !== b.warehouse_id) return fail(res, 422, 'WAREHOUSE_MISMATCH', 'Chuyến gốc thuộc kho khác kho nhập trả')
      if (trip.status !== 'COMPLETED') return fail(res, 409, 'TRIP_NOT_COMPLETED', `Chuyến ${trip.group_code ?? ''} chưa hoàn thành — chỉ nhập trả cho chuyến đã xuất xong`)
      // trả ≤ đã xuất − đã khai trả trước (gộp các dòng cùng DO × mã trong chính phiếu này)
      const want = new Map<string, number>()
      for (const l of b.lines) { const k = `${l.od_number ?? ''}||${l.material_id}`; want.set(k, (want.get(k) ?? 0) + l.qty_base) }
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
    // ĐẦU PHIẾU — số phiếu `<kho>_RT_ddmmyy_NN`
    const returnId = randomUUID()
    const rPrefix = `${wh.code}_RT_${ddmmyy}_`
    let returnCode = ''
    for (let attempt = 0; attempt < 8 && !returnCode; attempt++) {
      const code = `${rPrefix}${String((await nextReturnSeq(rPrefix)) + 1).padStart(2, '0')}`
      const { error } = await db.from('inbound_return').insert({
        id: returnId, return_code: code, warehouse_id: b.warehouse_id, gdo_id: trip?.id ?? null, group_code: trip?.group_code ?? null,
        ship_to_code: shipTo.code, ship_to_name: shipTo.name, reason: b.reason.trim(), qa_hold: b.qa_hold === true,
        created_by: actor, created_by_name: resolveActorName(req), created_at: t0, updated_at: t0,
      })
      if (!error) { returnCode = code; break }
      if (error.code !== '23505') throw error
      await jitter(attempt)
    }
    if (!returnCode) return fail(res, 409, 'BUSY', 'Nhiều người cùng lập phiếu trả — thử lại')

    // MỖI MÃ MỘT PHIẾU NHẬP (dùng lại màn quét / lưu thủ công / hoàn thành của Nhập kho)
    const perMat = new Map<string, number>()
    for (const l of b.lines) perMat.set(l.material_id, (perMat.get(l.material_id) ?? 0) + l.qty_base)
    const iPrefix = `${wh.code}_N_${ddmmyy}_`
    let imports: { id: string; import_code: string; material_id: string }[] = []
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 8 && !imports.length; attempt++) {
      const base = await nextImportSeq(iPrefix)
      const rows = [...perMat].map(([mid, qty], i) => ({
        id: randomUUID(), import_code: `${iPrefix}${String(base + i + 1).padStart(2, '0')}`, warehouse_id: b.warehouse_id, material_id: mid,
        planned_cartons: qty, status: 'OPEN', source_type: 'RETURN', warehouse_type: matOf.get(mid)?.category ?? null, import_date: today,
        return_id: returnId, notes: `Trả về${trip?.group_code ? ` từ chuyến ${trip.group_code}` : ' (lập tay)'} — ${b.reason.trim()}`.slice(0, 500),
        created_by: actor, updated_by: actor, created_at: t0, updated_at: t0,
      }))
      const { error } = await db.from('ProductionImport').insert(rows)
      if (!error) { imports = rows.map(r => ({ id: r.id, import_code: r.import_code, material_id: r.material_id })); break }
      lastErr = error
      if (error.code !== '23505') break
      await jitter(attempt)
    }
    if (!imports.length) { await db.from('inbound_return').delete().eq('id', returnId); throw lastErr ?? new Error('Không tạo được phiếu nhập') }
    const impOf = new Map(imports.map(i => [i.material_id, i.id]))
    const shipped = new Map<string, number>()
    if (trip) for (const tl of (await loadTrip(trip.id)).lines) shipped.set(`${tl.od_number}||${tl.material_id}`, tl.shipped_base)
    const { error: lErr } = await db.from('inbound_return_line').insert(b.lines.map(l => ({
      id: randomUUID(), return_id: returnId, od_number: l.od_number?.trim() || null, material_id: l.material_id, qty_base: l.qty_base,
      shipped_base: shipped.get(`${l.od_number ?? ''}||${l.material_id}`) ?? null, import_order_id: impOf.get(l.material_id) ?? null, created_at: t0, updated_at: t0,
    })))
    if (lErr) throw lErr
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
/** Ghi SỔ NHẬN TRẢ (lỗi ghi sổ không làm hỏng lượt nhận đã ghi tồn — nhưng nói ra). */
export async function logReturnScan(r: { return_id: string; import_order_id: string; entry_id: string | null; source_pallet_code: string | null; merged: boolean; qty_base: number; actor: string | null }): Promise<string | null> {
  if (!(r.qty_base > 0)) return null
  const t = nowIso()
  const { actor, ...cols } = r
  const { error } = await db.from('inbound_return_scan').insert({ id: randomUUID(), ...cols, created_by: actor, created_at: t, updated_at: t })
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
    const { data: head } = await db.from('inbound_return').select('id, return_code, gdo_id, group_code, ship_to_code, ship_to_name, reason, qa_hold, created_by_name, created_at').eq('id', imp.return_id).maybeSingle()
    if (!head) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu trả')
    const [{ data: lines }, { data: scans }] = await Promise.all([
      db.from('inbound_return_line').select('od_number, qty_base, shipped_base').eq('import_order_id', imp.id).order('od_number'),
      db.from('inbound_return_scan').select('source_pallet_code, qty_base, merged, entry_id, created_at').eq('import_order_id', imp.id).order('created_at'),
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
    const recvBy = new Map<string, number>()
    if (head.gdo_id && pallets.length) {
      const { data: rs } = await db.from('inbound_return').select('id').eq('gdo_id', head.gdo_id)
      const rids = ((rs ?? []) as { id: string }[]).map(r => r.id)
      const all = rids.length ? ((await fetchAllByIdChunks(rids, c => db.from('inbound_return_scan').select('source_pallet_code, qty_base').in('return_id', c).order('id'))) as { source_pallet_code: string | null; qty_base: number }[]) : []
      for (const s of all) if (s.source_pallet_code) recvBy.set(s.source_pallet_code, (recvBy.get(s.source_pallet_code) ?? 0) + Number(s.qty_base))
    }
    return ok(res, { ...head, license_plate, lines: lines ?? [], scans: scans ?? [],
      pallets: pallets.map(p => ({ ...p, returned_base: recvBy.get(p.pallet_code) ?? 0 })).sort((a, b) => a.pallet_code.localeCompare(b.pallet_code)) })
  } catch (e) { return failAny(res, e) }
}

// POST /wms/inbound-orders/:id/return-loose — NHẬN HÀNG LẺ trả về theo TEM GỐC: sinh tem con ".N" mang lô / NSX / HSD gốc
export const zReturnLoose = z.object({
  qty_semantics: z.literal('base'),
  source_pallet_code: zText(1, 200),
  qty_base: z.number().positive(),
  location_id: zText(1, 64),
  stack_layer: z.number().int().min(1).max(5).optional(),
  putaway_override_reason: zText(0, 200).optional(),
})
export async function receiveReturnLoose(req: Request, res: Response) {
  try {
    if (!requireBaseQty(req, res)) return
    const b = req.body as z.infer<typeof zReturnLoose>
    const { data: imp } = await db.from('ProductionImport')
      .select('id, import_code, status, source_type, return_id, material_id, warehouse_id, warehouse:Warehouse(inventory_mode)').eq('id', req.params.id).maybeSingle()
    if (!imp) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (!inScope(req, imp.warehouse_id)) return fail(res, 403, 'FORBIDDEN', SCOPE_MSG)
    if (imp.source_type !== 'RETURN' || !imp.return_id) return fail(res, 422, 'NOT_RETURN', 'Chỉ phiếu nhập trả về mới nhận hàng lẻ theo tem gốc')
    if (imp.status !== 'OPEN') return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập không còn ở trạng thái mở')
    const { data: mat } = await db.from('Material').select('*').eq('id', imp.material_id ?? '').maybeSingle()
    if (!mat) return fail(res, 400, 'NO_MATERIAL', 'Phiếu nhập chưa có hàng hóa')
    const invMode = (imp.warehouse as { inventory_mode?: string | null } | null)?.inventory_mode ?? null
    if (effectiveNoQr(mat.no_qr_tracking, invMode)) return fail(res, 422, 'NO_QR_MATERIAL', 'Mã không theo dõi QR — dùng "Lưu thủ công" để nhận')
    const ie = qtyIntegerError(b.qty_base, mat as MatUnits)
    if (ie) return fail(res, 422, 'VALIDATION_ERROR', ie)

    const src = normalizeQR(b.source_pallet_code)
    const parsed = parseInboundQR(src)
    if (!parsed.is_valid) return fail(res, 400, 'INVALID_QR', parsed.error ?? 'Tem gốc không hợp lệ')
    if (parsed.material_code !== mat.material_code) return fail(res, 400, 'MATERIAL_MISMATCH', `Tem gốc là mã "${parsed.material_code}" nhưng phiếu nhập là "${mat.material_code}"`)
    const { base: cb, error: cbErr } = childBaseOf(src)
    if (!cb) return fail(res, 400, 'INVALID_QR', cbErr ?? 'Tem gốc không đúng định dạng')
    // thuộc tính lô của tem gốc (dòng tồn gần nhất cùng mã tem — kể cả đã xuất hết); không có thì đọc từ chính QR
    const { data: srcRow } = await db.from('InventoryEntry')
      .select('manufacturer_id, nmsx, cycle, machine_code, pallet_sequence_no, production_date, batch, expiry_date, ncc_id, shelf_life_days')
      .eq('pallet_code', src).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const s = srcRow as { manufacturer_id: string | null; nmsx: string | null; cycle: string | null; machine_code: string | null; pallet_sequence_no: string | null; production_date: string | null; batch: string | null; expiry_date: string | null; ncc_id: string | null; shelf_life_days: number | null } | null

    const { data: loc } = await db.from('Location').select('*').eq('id', b.location_id).maybeSingle()
    if (!loc) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí kho')
    if (!loc.is_active) return fail(res, 400, 'LOCATION_INACTIVE', 'Vị trí kho không hoạt động')
    if (loc.warehouse_id !== imp.warehouse_id) return fail(res, 422, 'LOCATION_WAREHOUSE_MISMATCH', `Vị trí ${loc.location_code} thuộc kho khác`)
    const cats = (loc.categories ?? null) as string[] | null
    if (cats?.length && mat.category && !cats.includes(mat.category))
      return fail(res, 422, 'LOCATION_CATEGORY_MISMATCH', `Vị trí ${loc.location_code} thuộc loại "${cats.join(', ')}" — không khớp loại hàng "${mat.category}"`)
    const prodDate = s?.production_date ?? (parsed.production_date ? parsed.production_date.toISOString() : null)
    const expiry = s?.expiry_date ?? (parsed.expiry_date ? parsed.expiry_date.toISOString().slice(0, 10) : null)
    const canOverride = req.user?.is_superadmin === true || (req.user?.module_permissions ?? {})['inbound']?.includes('putaway_override') === true
    const put = await guardPutaway({
      warehouseId: imp.warehouse_id, locationId: b.location_id,
      incoming: { material_id: mat.id, ncc_id: s?.ncc_id ?? null, production_date: prodDate, expiry_date: expiry, shelf_life_days: s?.shelf_life_days ?? null },
      overrideReason: b.putaway_override_reason, canOverride, loc: loc as unknown as PutawayLocRow, material: mat as unknown as MaterialShelfInfo,
    })
    if (put.error) return fail(res, put.error.code === 'FORBIDDEN' ? 403 : 422, put.error.code, put.error.message)

    const ret = await returnHead(imp.return_id)
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
        notes: `Hàng lẻ trả về theo tem gốc ${src}`,
      }
      // NGUYÊN TỬ: khoá dòng Location → đếm sức chứa / tầng dưới / số mã DƯỚI LOCK → insert (cùng RPC với quét nhập)
      const { data: r, error } = await db.rpc('scan_insert_pallet', {
        p_entry: entry, p_location_id: b.location_id, p_stack_layer: stack,
        p_max_materials: (putawayEnforces(put.rules, 'MAX_MATERIALS') && !put.trace.putaway_override_reason) ? put.max_materials : null,
      })
      if (error) return fail(res, error)
      const parts = String(r ?? '').split('|')
      switch (parts[0]) {
        case 'NOLOC':   return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
        case 'MAXMAT':  return fail(res, 422, 'PUTAWAY_VIOLATION', `Vị trí ${loc.location_code} đang có ${parts[1]} mã, kho giới hạn ${parts[2]} mã cho một vị trí.`)
        case 'FULL':    return fail(res, 422, 'LOCATION_FULL', `Vị trí ${loc.location_code} đã đầy (${parts[1]}/${parts[2]} pallet). Chọn tầng chồng hoặc vị trí khác.`)
        case 'NO_BASE': return fail(res, 422, 'NO_BASE_LAYER', `Không có pallet tầng ${stack - 1} tại vị trí này để chồng lên`)
        case 'DUP':     await jitter(attempt); continue   // người khác vừa lấy đúng tên con này ⇒ đặt tên kế tiếp
      }
      entryId = parts[1] ?? null
    }
    if (!entryId) return fail(res, 409, 'BUSY', 'Nhiều người cùng nhận hàng lẻ của tem này — thử lại')
    const warn = await logReturnScan({ return_id: imp.return_id, import_order_id: imp.id, entry_id: entryId, source_pallet_code: src, merged: false, qty_base: b.qty_base, actor })
    emitInboundChanged()
    return ok(res, { entry_id: entryId, pallet_code: childCode, warnings: [...(put.warning ? [put.warning] : []), ...(warn ? [warn] : [])] }, 201)
  } catch (e) { return failAny(res, e) }
}
