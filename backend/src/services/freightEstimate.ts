/**
 * CƯỚC DỰ TÍNH + TẢI của CHUYẾN — ghi lên GroupDeliveryOrder (plan TMS_DISPATCH mục 6.3 · đợt 1 mục 15, 23/09/2026).
 *
 * Nguồn: dòng hàng của chuyến (OutboundItem × Material master → `loadOf` = pallet/kg), phường của điểm giao
 * (erp_outbound_orders.ward_code theo OD, rơi về Customer.ward_code theo ship-to), dòng xe CON đã chọn ở Kế hoạch
 * xuất (`GroupDeliveryOrder.vehicle_model_id`), ĐVVT của chuyến (`dvvt` → TransportCompany qua resolver alias),
 * bảng cước `freight_tariff` (kho xuất × ĐVVT × dòng con × phường XA NHẤT, hiệu lực tại ngày giao) và phụ phí
 * `freight_surcharge`. Luật tính = `services/freight.ts` (thuần, có test) — file này CHỈ nạp dữ liệu và ghi kết quả.
 *
 * Gọi ở: (1) sau khi dội Kế hoạch xuất → chuyến (processVehicleGroups) — cước THEO KẾ HOẠCH; (2) khi Hoàn thành
 * chuyến — tính lại theo THỰC XUẤT (cartons_scanned); (3) `POST /tms/freight/recompute` — bảng cước nạp sau khi
 * kế hoạch đã có (đúng tình huống 23/09: 5.526 dòng cước sơ bộ nạp lên khi chuyến đã nằm sẵn).
 * Không có cước ⇒ total null + lý do, KHÔNG chặn nghiệp vụ nào (bảng rỗng = chuyến không có cước).
 */
import { db } from '../lib/supabase'
import { fetchAllByIdChunks, fetchAllRowsParallel } from '../utils/pagination'
import { loadOf, sumLoads, type LoadMat, type LoadRef } from '../utils/loadCalc'
import { normDvvt } from '../utils/sapUnits'
import { makeDvvtResolver } from './sapFlow'
import {
  computeFreight, pickTariff, farthestWard, effectiveAt, loadUtilization,
  type TariffLike, type SurchargeLike, type TariffUnit, type SurchargePer, type StopCountMode, type LoadUtil,
} from './freight'

export type FreightBasis = 'PLAN' | 'ACTUAL' | 'AUTO'

export interface FreightDetail {
  computed_at: string
  basis: 'PLAN' | 'ACTUAL'
  unit: TariffUnit | null
  total: number | null
  base: number | null
  billed_pallets: number | null
  surcharges: { kind: string; per: SurchargePer; unit_amount: number; qty: number; total: number }[]
  ward: string | null            // phường tính cước (xa nhất)
  wards: string[]                // mọi phường điểm giao của chuyến
  stops: number                  // số ship-to phân biệt
  pallets: number | null         // tải thật (thập phân)
  tons: number | null
  incomplete: number             // số dòng hàng không đo được tải (thiếu master)
  load: LoadUtil
  vehicle_model: { id: string; sap_code: string; name: string } | null
  transport_company_id: string | null
  reason: string | null          // vì sao không có cước
}

type GdoRow = { id: string; group_code: string; warehouse_id: string | null; dvvt: string | null; vehicle_model_id: string | null; delivery_date: string | null; status: string; shipto_party: string | null }
type VmRow = { id: string; sap_code: string; name: string; tariff_unit: string | null; capacity_mode: string | null; max_pallets: number | null; max_tons: number | string | null; underload_pct: number | null }
type ItemRow = { do_id: string; material_code_raw: string | null; cartons_ordered: number | string | null; cartons_scanned: number | string | null; material: LoadMat | null }

/**
 * Số THAM CHIẾU của SAP theo (OD, mã hàng): Σ sap_pallets · Σ gross_weight_kg của các dòng OD còn sống. `loadOf` chỉ dùng khi
 * master thiếu quy cách (cartons_per_pallet / weight_kg) — đo 23/09 trên lát ZSD02 07/09: 4/5 chuyến demo có ≥1 mã thiếu
 * cartons_per_pallet, không rơi về SAP thì cả chuyến "không đo được tải" dù SAP đã ghi pallet từng dòng.
 */
export async function sapLoadRefs(odNos: string[]): Promise<Map<string, LoadRef>> {
  const out = new Map<string, LoadRef>()
  const ods = uniq(odNos.filter(Boolean))
  if (!ods.length) return out
  const rows = await fetchAllByIdChunks(ods, c => db.from('erp_outbound_orders')
    .select('od_number, material_code, sap_pallets, gross_weight_kg, sync_status').in('od_number', c).neq('sync_status', 'OBSOLETE').order('od_number')) as { od_number: string; material_code: string | null; sap_pallets: number | string | null; gross_weight_kg: number | string | null }[]
  for (const r of rows) {
    const k = `${r.od_number}|${String(r.material_code ?? '').trim()}`
    const cur = out.get(k) ?? { sap_pallets: null, gross_weight_kg: null }
    const p = Number(r.sap_pallets), w = Number(r.gross_weight_kg)
    // SAP ghi 0 pallet là MỘT CÂU TRẢ LỜI (POSM/vật phẩm đi kèm không chiếm pallet riêng), khác với null = không biết
    if (r.sap_pallets != null && Number.isFinite(p) && p >= 0) cur.sap_pallets = (cur.sap_pallets ?? 0) + p
    if (Number.isFinite(w) && w > 0) cur.gross_weight_kg = (cur.gross_weight_kg ?? 0) + w
    out.set(k, cur)
  }
  return out
}
export const sapRefKey = (od: string | null | undefined, materialCode: string | null | undefined) => `${od ?? ''}|${String(materialCode ?? '').trim()}`
/**
 * `loadOf` + một nấc cuối: master thiếu quy cách mà SAP nói RÕ "0 pallet" (POSM đi kèm, đo 07/09: 720000116/123 = 0 pallet, 120 kg)
 * thì nhận 0 với nguồn SAP thay vì "không đo được" — không nhận thì cả chuyến mất cột tải/cước vì một hộp kệ trưng bày.
 */
export function loadOfWithSap(qtyBase: number, mat: LoadMat | null | undefined, warehouseId: string | null | undefined, ref: LoadRef | null | undefined) {
  const r = loadOf(qtyBase, mat, warehouseId, ref ?? null)
  if (r.pallets == null && ref?.sap_pallets === 0) return { ...r, pallets: 0, pallets_source: 'SAP' as const }
  return r
}
type TariffRow = TariffLike & { from_warehouse_id: string; transport_company_id: string; vehicle_model_id: string }
type SurRow = SurchargeLike & { from_warehouse_id: string; transport_company_id: string; vehicle_model_id: string | null; per: SurchargePer; count_mode: StopCountMode }

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const uniq = <T,>(a: T[]) => [...new Set(a)]

export async function estimateFreightForGdos(gdoIds: string[], opts: { basis?: FreightBasis } = {}): Promise<{ updated: number; priced: number; unpriced: number; details: Record<string, FreightDetail> }> {
  const ids = uniq(gdoIds.filter(Boolean))
  const out = { updated: 0, priced: 0, unpriced: 0, details: {} as Record<string, FreightDetail> }
  if (!ids.length) return out
  const gdos = await fetchAllByIdChunks(ids, c => db.from('GroupDeliveryOrder')
    .select('id, group_code, warehouse_id, dvvt, vehicle_model_id, delivery_date, status, shipto_party').in('id', c).order('id')) as GdoRow[]
  if (!gdos.length) return out

  // ── Danh mục dùng chung ──
  const vmIds = uniq(gdos.map(g => g.vehicle_model_id).filter((x): x is string => !!x))
  const [vmRows, dvvtResolve, coRows] = await Promise.all([
    vmIds.length ? fetchAllByIdChunks(vmIds, c => db.from('vehicle_model').select('id, sap_code, name, tariff_unit, capacity_mode, max_pallets, max_tons, underload_pct').in('id', c).order('id')) as Promise<VmRow[]> : Promise.resolve([] as VmRow[]),
    makeDvvtResolver(),
    db.from('TransportCompany').select('id, code'),
  ])
  const vmById = new Map(vmRows.map(v => [v.id, v]))
  const coIdByCode = new Map(((coRows.data ?? []) as { id: string; code: string }[]).map(c => [c.code, c.id]))
  const coIdOf = (dvvt: string | null): string | null => {
    const code = dvvtResolve(normDvvt(dvvt) ?? '')
    return code ? (coIdByCode.get(code) ?? null) : null
  }

  // ── Dòng hàng → tải ──
  const dos = await fetchAllByIdChunks(ids, c => db.from('OutboundDelivery').select('id, gdo_id, delivery_code').in('gdo_id', c).order('id')) as { id: string; gdo_id: string; delivery_code: string | null }[]
  const doIds = dos.map(d => d.id)
  const items = doIds.length ? await fetchAllByIdChunks(doIds, c => db.from('OutboundItem')
    .select('do_id, material_code_raw, cartons_ordered, cartons_scanned, material:Material!material_id(base_unit, entry_unit, units_per_carton, cartons_per_pallet, warehouse_pallet_overrides, weight_kg, is_pallet_carrier, is_non_stock)')
    .in('do_id', c).order('id')) as unknown as ItemRow[] : []
  const dosByGdo = new Map<string, typeof dos>()
  for (const d of dos) { const l = dosByGdo.get(d.gdo_id) ?? []; l.push(d); dosByGdo.set(d.gdo_id, l) }
  const itemsByDo = new Map<string, ItemRow[]>()
  for (const i of items) { const l = itemsByDo.get(i.do_id) ?? []; l.push(i); itemsByDo.set(i.do_id, l) }

  // ── Phường + ship-to theo OD (ZSD02 điền ward_code; VL06O không có → tra Customer theo ship-to) ──
  const odNos = uniq(dos.map(d => d.delivery_code).filter((x): x is string => !!x))
  const [odRows, refs] = await Promise.all([
    odNos.length ? fetchAllByIdChunks(odNos, c => db.from('erp_outbound_orders')
      .select('od_number, ward_code, ship_to_code, sync_status').in('od_number', c).neq('sync_status', 'OBSOLETE').order('od_number')) as Promise<{ od_number: string; ward_code: string | null; ship_to_code: string | null }[]> : Promise.resolve([]),
    sapLoadRefs(odNos),
  ])
  const wardByOd = new Map<string, string>(), shiptoByOd = new Map<string, string>()
  for (const r of odRows) {
    if (r.ward_code && !wardByOd.has(r.od_number)) wardByOd.set(r.od_number, r.ward_code)
    if (r.ship_to_code && !shiptoByOd.has(r.od_number)) shiptoByOd.set(r.od_number, r.ship_to_code)
  }
  const shiptosNeedWard = uniq([...odNos.filter(o => !wardByOd.has(o)).map(o => shiptoByOd.get(o)), ...gdos.map(g => g.shipto_party)].filter((x): x is string => !!x))
  const wardByShipto = new Map<string, string>()
  if (shiptosNeedWard.length) {
    const cs = await fetchAllByIdChunks(shiptosNeedWard, c => db.from('Customer').select('ship_to_code, ward_code').in('ship_to_code', c).order('ship_to_code')) as { ship_to_code: string; ward_code: string | null }[]
    for (const c of cs) if (c.ward_code) wardByShipto.set(c.ship_to_code, c.ward_code)
  }

  // ── Tính tải + phường + stops từng chuyến (chưa cần bảng cước) ──
  type Pre = { g: GdoRow; basis: 'PLAN' | 'ACTUAL'; pallets: number | null; tons: number | null; incomplete: number; wards: string[]; stops: number; coId: string | null; vm: VmRow | null }
  const pres: Pre[] = gdos.map(g => {
    const basis: 'PLAN' | 'ACTUAL' = opts.basis === 'ACTUAL' || (opts.basis !== 'PLAN' && g.status === 'COMPLETED') ? 'ACTUAL' : 'PLAN'
    const gDos = dosByGdo.get(g.id) ?? []
    const loads = gDos.flatMap(d => (itemsByDo.get(d.id) ?? []).map(i => {
      const scanned = num(i.cartons_scanned)
      const qty = basis === 'ACTUAL' && scanned > 0 ? scanned : num(i.cartons_ordered)
      // master thiếu quy cách → rơi về số SAP của đúng (OD, mã) — kèm nguồn 'SAP' trong loadOf
      return loadOfWithSap(qty, i.material, g.warehouse_id, refs.get(sapRefKey(d.delivery_code, i.material_code_raw)))
    }))
    const sum = sumLoads(loads)
    const wards: string[] = [], shiptos: string[] = []
    for (const d of gDos) {
      const od = d.delivery_code ?? ''
      const st = shiptoByOd.get(od) ?? null
      if (st) shiptos.push(st)
      const w = wardByOd.get(od) ?? (st ? wardByShipto.get(st) : undefined) ?? null
      if (w) wards.push(w)
    }
    if (!wards.length && g.shipto_party) { const w = wardByShipto.get(g.shipto_party); if (w) wards.push(w) }
    if (!shiptos.length && g.shipto_party) shiptos.push(g.shipto_party)
    const stops = Math.max(uniq(shiptos).length, uniq(wards).length, gDos.length ? 1 : 0)
    return { g, basis, pallets: sum.pallets, tons: sum.kg == null ? null : Math.round(sum.kg) / 1000, incomplete: sum.incomplete, wards: uniq(wards), stops, coId: coIdOf(g.dvvt), vm: g.vehicle_model_id ? vmById.get(g.vehicle_model_id) ?? null : null }
  })

  // ── Bảng cước + phụ phí cho đúng các bộ (kho, ĐVVT, dòng con) có mặt ──
  const whIds = uniq(pres.map(p => p.g.warehouse_id).filter((x): x is string => !!x))
  const coIds = uniq(pres.map(p => p.coId).filter((x): x is string => !!x))
  const allWards = uniq(pres.flatMap(p => p.wards))
  const tariffs = (whIds.length && coIds.length && vmIds.length && allWards.length)
    ? await fetchAllByIdChunks(allWards, c => db.from('freight_tariff')
        .select('id, from_warehouse_id, transport_company_id, vehicle_model_id, ward_code, price, distance_km, effective_from, effective_to, is_active')
        .in('from_warehouse_id', whIds.slice(0, 300)).in('transport_company_id', coIds.slice(0, 300)).in('vehicle_model_id', vmIds.slice(0, 300)).in('ward_code', c).order('id')) as TariffRow[]
    : []
  const surcharges = whIds.length
    ? await fetchAllRowsParallel(() => db.from('freight_surcharge')
        .select('id, from_warehouse_id, transport_company_id, vehicle_model_id, kind, amount, per, count_mode, min_stops, effective_from, effective_to, is_active')
        .in('from_warehouse_id', whIds.slice(0, 300)).eq('is_active', true).order('id')) as SurRow[]
    : []

  const computedAt = new Date().toISOString()
  const updates: { id: string; freight_estimated: number | null; freight_tariff_id: string | null; freight_detail: FreightDetail }[] = []
  for (const p of pres) {
    const day = String(p.g.delivery_date ?? '').slice(0, 10) || computedAt.slice(0, 10)
    const unit: TariffUnit | null = p.vm ? (p.vm.tariff_unit === 'PER_TRIP' ? 'PER_TRIP' : 'PER_PALLET') : null
    const load = loadUtilization(p.vm, p.pallets, p.tons)
    let reason: string | null = null
    if (!p.vm) reason = 'Chưa chọn dòng xe con (mã SAP) cho chuyến — chọn ở tab Kế hoạch xuất'
    else if (!p.coId) reason = p.g.dvvt ? `ĐVVT "${p.g.dvvt}" không khớp danh mục ĐVVT` : 'Chuyến chưa có ĐVVT'
    else if (!p.g.warehouse_id) reason = 'Chuyến chưa có kho xuất'
    else if (!p.wards.length) reason = 'Không xác định được phường điểm giao (DO chưa có ward_code từ ZSD02 và khách hàng chưa khai phường)'

    let result = { total: null as number | null, base: null as number | null, billed_pallets: null as number | null, tariff_id: null as string | null, surcharges: [] as FreightDetail['surcharges'], ward: null as string | null }
    if (!reason && p.vm && p.coId && p.g.warehouse_id && unit) {
      const mine = tariffs.filter(t => t.from_warehouse_id === p.g.warehouse_id && t.transport_company_id === p.coId && t.vehicle_model_id === p.vm!.id && p.wards.includes(t.ward_code))
      const eff = effectiveAt(mine, day)
      const kmByWard = new Map<string, number | null>()
      for (const t of eff) if (!kmByWard.has(t.ward_code) || (t.distance_km != null && kmByWard.get(t.ward_code) == null)) kmByWard.set(t.ward_code, t.distance_km == null ? null : Number(t.distance_km))
      const ward = farthestWard(eff.map(t => t.ward_code), kmByWard)
      const tariff = ward ? pickTariff(eff.filter(t => t.ward_code === ward).map(t => ({ ...t, price: Number(t.price), distance_km: t.distance_km == null ? null : Number(t.distance_km) })), day) : null
      const sur = effectiveAt(surcharges.filter(s => s.from_warehouse_id === p.g.warehouse_id && s.transport_company_id === p.coId && (s.vehicle_model_id == null || s.vehicle_model_id === p.vm!.id)), day)
        .map(s => ({ ...s, amount: Number(s.amount), min_stops: Number(s.min_stops ?? 2) }))
      if (!tariff) reason = `Chưa có bảng cước cho (${p.vm.name} · phường ${p.wards.join(', ')}) của ĐVVT này tại kho xuất`
      else if (unit === 'PER_PALLET' && p.pallets == null) reason = `Không đo được số pallet của chuyến (${p.incomplete} dòng hàng thiếu quy cách thùng/pallet trong master)`
      else {
        const r = computeFreight({ unit, tariff, surcharges: sur, pallets: p.pallets ?? 0, tons: p.tons ?? 0, stops: p.stops })
        result = { total: r.total, base: r.base, billed_pallets: r.billed_pallets, tariff_id: r.tariff_id, surcharges: r.surcharges, ward }
        reason = r.reason
      }
    }
    const detail: FreightDetail = {
      computed_at: computedAt, basis: p.basis, unit, total: result.total, base: result.base, billed_pallets: result.billed_pallets, surcharges: result.surcharges,
      ward: result.ward, wards: p.wards, stops: p.stops, pallets: p.pallets, tons: p.tons, incomplete: p.incomplete, load,
      vehicle_model: p.vm ? { id: p.vm.id, sap_code: p.vm.sap_code, name: p.vm.name } : null, transport_company_id: p.coId, reason,
    }
    out.details[p.g.id] = detail
    if (result.total != null) out.priced++; else out.unpriced++
    updates.push({ id: p.g.id, freight_estimated: result.total, freight_tariff_id: result.tariff_id, freight_detail: detail })
  }

  // Ghi từng chuyến (mỗi chuyến một bộ giá trị) — song song có trần 8 (pool PostgREST ~10 khe)
  const tasks = updates.map(u => async () => {
    const { error } = await db.from('GroupDeliveryOrder')
      // jsonb: đi qua JSON round-trip để khớp kiểu Json của schema thay vì ép kiểu
      .update({ freight_estimated: u.freight_estimated, freight_tariff_id: u.freight_tariff_id, freight_detail: JSON.parse(JSON.stringify(u.freight_detail)), updated_at: computedAt })
      .eq('id', u.id)
    if (error) throw new Error(error.message)
    out.updated++
  })
  for (let i = 0; i < tasks.length; i += 8) await Promise.all(tasks.slice(i, i + 8).map(f => f()))
  return out
}

/** Gọi kiểu AUGMENT ở đường nghiệp vụ (dội kế hoạch · hoàn thành): hỏng tính cước không được làm hỏng thao tác gốc. */
export async function estimateFreightSafely(gdoIds: string[], basis: FreightBasis = 'AUTO'): Promise<void> {
  try { await estimateFreightForGdos(gdoIds, { basis }) }
  catch (e) { console.error('[freightEstimate]', e) }
}
