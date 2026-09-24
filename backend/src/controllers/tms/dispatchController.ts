/**
 * ĐIỀU VẬN — kế hoạch ghép chuyến NHÁP (đợt 2 TMS điều vận; plan docs/plans/TMS_DISPATCH_PLAN.md mục 7; user chốt 24/09/2026).
 *
 * Luồng: POST /tms/dispatch/plan (kho × ngày giao) → nạp POOL = OD ZSD02 của plant kho, ngày giao đó, còn ACTIVE, CHƯA nằm
 * trong Kế hoạch xuất → tải từng dòng (Material master, rơi về tham chiếu SAP) → phường/vùng/kênh/khách nội bộ từ Customer →
 * dòng xe con (đã gán cha) · bảng cước · phụ phí · phân tuyến · tỷ trọng kỳ (chuyến đã có trong tháng) → `runDispatch`
 * (services/dispatchEngine.ts, thuần, có test) → ghi dispatch_plan/trip/trip_od (MỘT bản nháp mỗi kho×ngày).
 * Người sửa nháp: đổi dòng xe/ĐVVT (PATCH trip — cước tính lại bằng đúng `priceFor` của engine) · chuyển OD giữa chuyến.
 * Xác nhận = ghi `khvc_lines` đúng cột upload Kế hoạch xuất tay đang dùng → `replanKhvcGroups` → GDO + TmsOrder tự sinh như
 * hôm nay. MÁY ĐỀ XUẤT, NGƯỜI XÁC NHẬN — sau xác nhận mọi thứ đi đường cũ, bảng nháp chỉ còn là vết.
 *
 * VÒNG ĐỜI CHUYẾN (24/09 chiều, user chốt "config: vận tải cần phản hồi hoặc không cần phản hồi"):
 *   `TransportCompany.tender_required` FALSE (mặc định) ⇒ Xác nhận ghi THẲNG xe vào Kế hoạch xuất (trip CONFIRMED); muốn đổi
 *   ĐVVT sau đó thì điều vận sửa tay ở tab Kế hoạch xuất. TRUE ⇒ xe đứng TENDERED chờ ĐVVT nhận/từ chối — đợt A điều vận
 *   ghi lại câu trả lời (`POST /trips/:id/respond`), đợt B ĐVVT tự trả lời trên link chào chuyến. Từ chối ⇒ DECLINED: sửa
 *   ĐVVT/dòng xe (về DRAFT) rồi `POST /trips/:id/settle` chốt lại xe đó. Kế hoạch: DRAFT → TENDERED (còn xe chờ) → CONFIRMED.
 *   Chỉ chuyến DRAFT/DECLINED của kế hoạch DRAFT/TENDERED mới sửa được; chuyến đã vào Kế hoạch xuất không đụng ở đây nữa.
 * Phạm vi kho: mọi cửa đọc/ghi gác theo `warehouse_ids` của user (kho ngoài phạm vi → 403).
 */
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { db } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllByIdChunks, fetchAllRowsParallel } from '../../utils/pagination'
import { z, zId, zDay, zBool, zText } from '../../middlewares/validate'
import { normDvvt } from '../../utils/sapUnits'
import { makeDvvtResolver } from '../../services/sapFlow'
import { loadOfWithSap } from '../../services/freightEstimate'
import { effectiveAt } from '../../services/freight'
import {
  runDispatch, buildCtx, priceFor, tripLoad, codePrefixOf, pickBookingCategory, sumLines,
  type EngineInput, type EngineOd, type EngineLine, type EngineModel, type EngineCarrier, type EngineTariff, type EngineSurcharge,
  type EngineAllocation, type EngineShareTarget, type ShareActual, type DispatchTrip, type TripFreight, type CarrierShare, type ShareBasis,
} from '../../services/dispatchEngine'
import { replanKhvcGroups } from '../wms/outboundController'
import type { Database, Json } from '../../types/database'
import type { LoadMat } from '../../utils/loadCalc'

type Tables = Database['public']['Tables']
type PlanRow = Tables['dispatch_plan']['Row']
type TripRow = Tables['dispatch_trip']['Row']
type TripOdRow = Tables['dispatch_trip_od']['Row']
type WhRow = { id: string; code: string; name: string; sap_plant: string | null; sap_storage_locations: string[] | null; dispatch_max_drops: number; dispatch_allow_mix_channels: boolean; dispatch_underload_pct: number | string | null }

type TripStatus = 'DRAFT' | 'TENDERED' | 'DECLINED' | 'CONFIRMED' | 'DISCARDED'
const EDITABLE_TRIP: TripStatus[] = ['DRAFT', 'DECLINED']
const OPEN_PLAN = ['DRAFT', 'TENDERED']

const ENGINE_VERSION = '2026-09-24.2'
const now = () => new Date().toISOString()
const CHUNK = 500
const uniq = <T,>(a: T[]) => [...new Set(a)]
const numOrNull = (v: unknown): number | null => { const n = Number(v); return v == null || !Number.isFinite(n) ? null : n }
const asJson = (v: unknown): Json => JSON.parse(JSON.stringify(v ?? null)) as Json

// ── Phạm vi kho ────────────────────────────────────────────────────────────────────────────────────────
function scopeWhIds(req: Request): string[] | null {
  return req.user?.is_superadmin === true || req.user?.warehouse_scope === 'NATIONAL' ? null : (req.user?.warehouse_ids ?? [])
}
function whAllowed(req: Request, whId: string): boolean {
  const s = scopeWhIds(req)
  return s === null || s.includes(whId)
}

// ── Zod ────────────────────────────────────────────────────────────────────────────────────────────────
export const zPlanBody = z.object({
  warehouse_id: zId,
  plan_date: zDay,
  max_drops: z.number().int().min(1).max(20).optional(),
  allow_mix_channels: zBool.optional(),
  underload_pct: z.number().min(1).max(100).nullable().optional(),
})
export const zListQuery = z.object({
  warehouse_id: zId.optional(), date_from: zDay.optional(), date_to: zDay.optional(),
  status: z.enum(['DRAFT', 'TENDERED', 'CONFIRMED', 'DISCARDED']).optional(),
}).passthrough()
export const zTripPatch = z.object({
  vehicle_model_id: zId.nullable().optional(),
  transport_company_id: zId.nullable().optional(),
})
export const zMoveOd = z.object({
  od_number: zText(1, 50),
  to_trip_id: zId.optional(),          // bỏ trống = tách ra chuyến MỚI
})
export const zRespond = z.object({
  accept: zBool,
  note: zText(0, 500).optional(),      // lý do từ chối / ghi chú ĐVVT — điều vận ghi lại (đợt A)
})

// ── Danh mục / tham chiếu dùng chung cho engine và cho các cửa sửa nháp ───────────────────────────────
type Refs = Pick<EngineInput, 'models' | 'carriers' | 'tariffs' | 'surcharges' | 'allocations' | 'share_targets'>

async function loadWarehouse(id: string): Promise<WhRow | null> {
  const { data, error } = await db.from('Warehouse').select('id, code, name, sap_plant, sap_storage_locations, dispatch_max_drops, dispatch_allow_mix_channels, dispatch_underload_pct').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as WhRow | null) ?? null
}

async function loadRefs(whId: string, day: string, wards: string[]): Promise<Refs> {
  const [vmRes, vtRes, tariffs, surcharges, allocRes, shareRes] = await Promise.all([
    db.from('vehicle_model').select('id, sap_code, name, parent_type_id, capacity_mode, max_pallets, max_tons, tariff_unit, underload_pct, max_drops, is_active').eq('is_active', true).order('sap_code'),
    db.from('VehicleType').select('id, name'),
    wards.length ? fetchAllByIdChunks(wards, c => db.from('freight_tariff')
      .select('id, transport_company_id, vehicle_model_id, ward_code, price, distance_km, effective_from, effective_to, is_active')
      .eq('from_warehouse_id', whId).eq('is_active', true).in('ward_code', c).order('id')) as Promise<EngineTariff[]> : Promise.resolve([] as EngineTariff[]),
    fetchAllRowsParallel(() => db.from('freight_surcharge')
      .select('id, transport_company_id, vehicle_model_id, kind, amount, per, count_mode, min_stops, effective_from, effective_to, is_active')
      .eq('from_warehouse_id', whId).eq('is_active', true).order('id')) as Promise<EngineSurcharge[]>,
    db.from('carrier_allocation').select('area_kind, area_code, transport_company_id, priority, effective_from, effective_to, is_active').eq('from_warehouse_id', whId).eq('is_active', true),
    db.from('carrier_share_target').select('transport_company_id, share_pct, basis, effective_from, effective_to, is_active').eq('from_warehouse_id', whId).eq('is_active', true),
  ])
  for (const r of [vmRes, vtRes, allocRes, shareRes]) if (r.error) throw new Error(r.error.message)
  const vtName = new Map(((vtRes.data ?? []) as { id: string; name: string }[]).map(v => [v.id, v.name]))
  const models: EngineModel[] = ((vmRes.data ?? []) as { id: string; sap_code: string; name: string; parent_type_id: string | null; capacity_mode: string | null; max_pallets: number | null; max_tons: number | string | null; tariff_unit: string | null; underload_pct: number | string | null; max_drops: number | null; is_active: boolean }[]).map(m => ({
    id: m.id, sap_code: m.sap_code, name: m.name,
    parent_type_name: m.parent_type_id ? (vtName.get(m.parent_type_id) ?? null) : null,
    capacity_mode: m.capacity_mode === 'TON' ? 'TON' : m.capacity_mode === 'PALLET' ? 'PALLET' : null,
    max_pallets: numOrNull(m.max_pallets), max_tons: numOrNull(m.max_tons),
    tariff_unit: m.tariff_unit === 'PER_TRIP' ? 'PER_TRIP' : 'PER_PALLET',
    underload_pct: numOrNull(m.underload_pct), serve_categories: null, max_drops: numOrNull(m.max_drops), is_active: m.is_active,
  }))
  const allocations = ((allocRes.data ?? []) as EngineAllocation[]).map(a => ({ ...a, priority: Number(a.priority) }))
  const shareRows = effectiveAt(((shareRes.data ?? []) as (EngineShareTarget & { effective_from: string; effective_to: string | null; is_active: boolean })[]), day)
  const share_targets: EngineShareTarget[] = shareRows.map(s => ({ transport_company_id: s.transport_company_id, share_pct: Number(s.share_pct), basis: (['TRIPS', 'PALLETS', 'TONS'].includes(String(s.basis)) ? s.basis : 'TRIPS') as ShareBasis }))
  const coIds = uniq([...tariffs.map(t => t.transport_company_id), ...allocations.map(a => a.transport_company_id), ...share_targets.map(s => s.transport_company_id)])
  const carriers = coIds.length
    ? (await fetchAllByIdChunks(coIds, c => db.from('TransportCompany').select('id, code, name, tender_required').in('id', c).order('id'))) as EngineCarrier[]
    : []
  return { models, carriers, tariffs, surcharges, allocations, share_targets }
}

/** Tỷ trọng kỳ ĐANG CÓ: chuyến của kho trong THÁNG của ngày giao (chưa huỷ), gom theo ĐVVT (dvvt → mã qua resolver alias). */
async function loadShareActual(whId: string, day: string, carriers: EngineCarrier[]): Promise<Record<string, ShareActual>> {
  const [y, m] = day.split('-').map(Number)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const [rows, resolve] = await Promise.all([
    fetchAllRowsParallel(() => db.from('GroupDeliveryOrder').select('id, dvvt, freight_detail').eq('warehouse_id', whId).gte('delivery_date', from).lte('delivery_date', to).neq('status', 'CANCELLED').order('id')) as Promise<{ dvvt: string | null; freight_detail: { pallets?: number | null; tons?: number | null } | null }[]>,
    makeDvvtResolver(),
  ])
  const byCode = new Map(carriers.map(c => [c.code, c.id]))
  const out: Record<string, ShareActual> = {}
  for (const r of rows) {
    const code = resolve(normDvvt(r.dvvt) ?? '')
    const id = code ? byCode.get(code) : null
    if (!id) continue
    const a = out[id] ?? { trips: 0, pallets: 0, tons: 0 }
    a.trips += 1; a.pallets += Number(r.freight_detail?.pallets ?? 0) || 0; a.tons += Number(r.freight_detail?.tons ?? 0) || 0
    out[id] = a
  }
  return out
}

// ── POOL: OD ZSD02 của kho × ngày giao chưa vào Kế hoạch xuất ─────────────────────────────────────────
type PoolRow = { od_number: string; od_item: string; material_code: string | null; qty_base: number | string | null; ship_to_code: string | null; ship_to_name: string | null; ward_code: string | null; region_code: string | null; flow: string | null; sap_pallets: number | string | null; gross_weight_kg: number | string | null; storage_location: string | null }
type MatRow = LoadMat & { material_code: string; category: string | null }
type CustRow = { ship_to_code: string; ward_code: string | null; region_code: string | null; channel: string | null; warehouse_id: string | null; is_active: boolean }

async function loadPool(wh: WhRow, day: string): Promise<{ ods: EngineOd[]; in_plan: { od_number: string; group_code: string }[] }> {
  const rows = (await fetchAllRowsParallel(() => db.from('erp_outbound_orders')
    .select('od_number, od_item, material_code, qty_base, ship_to_code, ship_to_name, ward_code, region_code, flow, sap_pallets, gross_weight_kg, storage_location')
    .eq('plant', wh.sap_plant ?? '').eq('delivery_date', day).eq('sync_status', 'ACTIVE').not('od_number', 'is', null).order('od_number').order('od_item'))) as PoolRow[]
  const slocs = (wh.sap_storage_locations ?? []).map(s => String(s).trim().toUpperCase()).filter(Boolean)
  const mine = slocs.length ? rows.filter(r => !r.storage_location || slocs.includes(String(r.storage_location).trim().toUpperCase())) : rows
  const odNos = uniq(mine.map(r => r.od_number))
  const [khvc, mats, custs] = await Promise.all([
    fetchAllByIdChunks(odNos, c => db.from('khvc_lines').select('do_no, group_code').in('do_no', c).neq('sync_status', 'OBSOLETE').order('do_no')) as Promise<{ do_no: string; group_code: string }[]>,
    fetchAllByIdChunks(uniq(mine.map(r => r.material_code).filter((x): x is string => !!x)), c => db.from('Material')
      .select('material_code, category, base_unit, entry_unit, units_per_carton, cartons_per_pallet, warehouse_pallet_overrides, weight_kg, is_pallet_carrier, is_non_stock').in('material_code', c).order('material_code')) as Promise<MatRow[]>,
    fetchAllByIdChunks(uniq(mine.map(r => r.ship_to_code).filter((x): x is string => !!x)), c => db.from('Customer')
      .select('ship_to_code, ward_code, region_code, channel, warehouse_id, is_active').in('ship_to_code', c).order('ship_to_code')) as Promise<CustRow[]>,
  ])
  const inPlan = new Map<string, string>()
  for (const k of khvc) if (!inPlan.has(k.do_no)) inPlan.set(k.do_no, k.group_code)
  const matBy = new Map(mats.map(m => [m.material_code, m]))
  const custBy = new Map(custs.map(c => [c.ship_to_code, c]))
  const byOd = new Map<string, PoolRow[]>()
  for (const r of mine) { if (inPlan.has(r.od_number)) continue; const l = byOd.get(r.od_number) ?? []; l.push(r); byOd.set(r.od_number, l) }
  const ods: EngineOd[] = []
  for (const [od, rs] of byOd) {
    const first = rs[0]
    const cust = first.ship_to_code ? custBy.get(first.ship_to_code) : undefined
    const lines: EngineLine[] = rs.map(r => {
      const mat = r.material_code ? matBy.get(r.material_code) ?? null : null
      const q = Number(r.qty_base) || 0
      const l = loadOfWithSap(q, mat, wh.id, { sap_pallets: numOrNull(r.sap_pallets), gross_weight_kg: numOrNull(r.gross_weight_kg) })
      return { material_code: r.material_code ?? '?', qty_base: q, pallets: l.pallets, kg: l.kg, category: mat?.category ?? null }
    })
    ods.push({
      od_number: od, ship_to_code: first.ship_to_code, ship_to_name: first.ship_to_name,
      ward_code: first.ward_code ?? cust?.ward_code ?? null, region_code: first.region_code ?? cust?.region_code ?? null,
      channel: cust?.is_active === false ? null : (cust?.channel ?? null),
      internal_wh: cust?.warehouse_id ?? null, scan_mode: !!cust?.warehouse_id,
      flow: first.flow ?? 'UNKNOWN', lines,
    })
  }
  return { ods, in_plan: [...inPlan].map(([od_number, group_code]) => ({ od_number, group_code })) }
}

/** STT bắt đầu = max STT đã có trong Kế hoạch xuất của kho×ngày + 1 (Số xe không được trùng xe thật). */
async function nextSeq(prefix: string): Promise<number> {
  const rows = (await fetchAllRowsParallel(() => db.from('khvc_lines').select('group_code').like('group_code', `${prefix}%`).order('group_code'))) as { group_code: string }[]
  let max = 0
  for (const r of rows) { const n = Number(r.group_code.slice(prefix.length)); if (Number.isFinite(n) && n > max) max = n }
  return max + 1
}

// ── Ghi / đọc bản nháp ─────────────────────────────────────────────────────────────────────────────────
function tripDetail(t: DispatchTrip) {
  return {
    freight: t.freight, load: t.load, categories: t.categories, booking_category: t.booking_category, cluster: t.cluster,
    carrier_reasons: t.carrier_reasons, warnings: t.warnings, merge_hint: t.merge_hint,
    vehicle_model: t.vehicle_model ? { id: t.vehicle_model.id, sap_code: t.vehicle_model.sap_code, name: t.vehicle_model.name, parent_type_name: t.vehicle_model.parent_type_name } : null,
    carrier: t.carrier ? { id: t.carrier.id, code: t.carrier.code, name: t.carrier.name, tender_required: t.carrier.tender_required === true } : null,
  }
}
type Detail = ReturnType<typeof tripDetail>
const detailOf = (t: TripRow): Detail => (t.detail ?? {}) as unknown as Detail
const statusOf = (t: TripRow): TripStatus => (t.status as TripStatus) ?? 'DRAFT'
const carrierRef = (c: EngineCarrier) => ({ id: c.id, code: c.code, name: c.name, tender_required: c.tender_required === true })

async function readPlan(planId: string) {
  const { data: plan, error } = await db.from('dispatch_plan').select('*').eq('id', planId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!plan) return null
  const trips = (await fetchAllRowsParallel(() => db.from('dispatch_trip').select('*').eq('plan_id', planId).order('seq'))) as TripRow[]
  const ods = trips.length ? (await fetchAllByIdChunks(trips.map(t => t.id), c => db.from('dispatch_trip_od').select('*').in('trip_id', c).order('od_number'))) as TripOdRow[] : []
  const odsBy = new Map<string, TripOdRow[]>()
  for (const o of ods) { const l = odsBy.get(o.trip_id) ?? []; l.push(o); odsBy.set(o.trip_id, l) }
  return { ...(plan as PlanRow), trips: trips.map(t => ({ ...t, ods: odsBy.get(t.id) ?? [] })) }
}

/** Tổng kết lại từ các chuyến đang có trong nháp (sau khi người sửa) — tỷ trọng = nền kỳ (lúc chạy) + chuyến trong nháp. Chuyến đã bỏ không tính. */
function summarizeRows(plan: PlanRow, allTrips: (TripRow & { ods: TripOdRow[] })[]) {
  const trips = allTrips.filter(t => statusOf(t) !== 'DISCARDED')
  const params = (plan.params ?? {}) as { share_base?: Record<string, ShareActual>; share_targets?: EngineShareTarget[]; carriers?: EngineCarrier[] }
  const actual: Record<string, ShareActual> = {}
  for (const [k, v] of Object.entries(params.share_base ?? {})) actual[k] = { ...v }
  for (const t of trips) {
    if (!t.transport_company_id) continue
    const a = actual[t.transport_company_id] ?? { trips: 0, pallets: 0, tons: 0 }
    a.trips += 1; a.pallets += Number(t.pallets ?? 0); a.tons += Number(t.tons ?? 0)
    actual[t.transport_company_id] = a
  }
  const totals: ShareActual = { trips: 0, pallets: 0, tons: 0 }
  for (const a of Object.values(actual)) { totals.trips += a.trips; totals.pallets += a.pallets; totals.tons += a.tons }
  const shares: CarrierShare[] = (params.carriers ?? []).map(c => {
    const a = actual[c.id] ?? { trips: 0, pallets: 0, tons: 0 }
    const tg = (params.share_targets ?? []).find(s => s.transport_company_id === c.id)
    const basis: ShareBasis = tg?.basis ?? 'TRIPS'
    const den = basis === 'TRIPS' ? totals.trips : basis === 'PALLETS' ? totals.pallets : totals.tons
    const num = basis === 'TRIPS' ? a.trips : basis === 'PALLETS' ? a.pallets : a.tons
    return { transport_company_id: c.id, code: c.code, name: c.name, trips: a.trips, pallets: Math.round(a.pallets * 1000) / 1000, tons: Math.round(a.tons * 1000) / 1000, pct: den > 0 ? Math.round((num / den) * 1000) / 10 : null, target_pct: tg ? Number(tg.share_pct) : null, basis }
  }).filter(s => s.trips > 0 || s.target_pct != null)
  return {
    trips: trips.length,
    ods: uniq(trips.flatMap(t => t.ods.map(o => o.od_number))).length,
    pallets: Math.round(trips.reduce((s, t) => s + Number(t.pallets ?? 0), 0) * 1000) / 1000,
    tons: Math.round(trips.reduce((s, t) => s + Number(t.tons ?? 0), 0) * 1000) / 1000,
    freight_total: trips.reduce((s, t) => s + Number(t.freight_estimated ?? 0), 0),
    unpriced: trips.filter(t => t.freight_estimated == null).length,
    underload: trips.filter(t => t.underload).length,
    oversize: trips.filter(t => t.oversize).length,
    tendered: trips.filter(t => statusOf(t) === 'TENDERED').length,
    declined: trips.filter(t => statusOf(t) === 'DECLINED').length,
    confirmed: trips.filter(t => statusOf(t) === 'CONFIRMED').length,
    shares,
  }
}
/** Trạng thái kế hoạch SUY từ trạng thái các chuyến: mọi chuyến (chưa bỏ) đã vào Kế hoạch xuất ⇒ CONFIRMED · còn chuyến đã
 *  chào/đã chốt một phần ⇒ TENDERED · chưa chốt gì ⇒ DRAFT. Kế hoạch đã DISCARDED giữ nguyên. */
async function syncPlanStatus(plan: PlanRow, actor: string | null): Promise<string> {
  if (plan.status === 'DISCARDED') return plan.status
  const trips = (await fetchAllRowsParallel(() => db.from('dispatch_trip').select('id, status').eq('plan_id', plan.id).order('seq'))) as { id: string; status: string }[]
  const live = trips.filter(t => t.status !== 'DISCARDED')
  const next = live.length && live.every(t => t.status === 'CONFIRMED') ? 'CONFIRMED'
    : live.some(t => t.status !== 'DRAFT') || trips.some(t => t.status === 'DISCARDED') ? 'TENDERED' : 'DRAFT'
  if (next !== plan.status) {
    const t = now()
    const patch: Tables['dispatch_plan']['Update'] = { status: next, updated_at: t }
    if (next === 'CONFIRMED') { patch.confirmed_by = actor; patch.confirmed_at = t }
    const { error } = await db.from('dispatch_plan').update(patch).eq('id', plan.id)
    if (error) throw new Error(error.message)
  }
  return next
}
async function writeSummary(plan: PlanRow) {
  const full = await readPlan(plan.id)
  if (!full) return
  const { error } = await db.from('dispatch_plan').update({ summary: asJson(summarizeRows(plan, full.trips)), updated_at: now() }).eq('id', plan.id)
  if (error) throw new Error(error.message)
}

// ── POST /tms/dispatch/plan ────────────────────────────────────────────────────────────────────────────
export async function createPlan(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zPlanBody>
    if (!whAllowed(req, b.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const wh = await loadWarehouse(b.warehouse_id)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    if (!wh.sap_plant) return fail(res, 422, 'PLANT_REQUIRED', `Kho ${wh.name} chưa khai "Plant SAP" (Cài đặt WMS → Kho) — không xác định được pool OD ZSD02 của kho.`)
    // kế hoạch đang CHỜ ĐVVT phản hồi: OD của các xe chờ chưa nằm trong Kế hoạch xuất nên lập lại sẽ xếp trùng — xử lý xong (nhận / từ chối / bỏ xe chờ) rồi mới lập lại
    const { data: open } = await db.from('dispatch_plan').select('id, status').eq('warehouse_id', wh.id).eq('plan_date', b.plan_date).eq('status', 'TENDERED').maybeSingle()
    if (open) return fail(res, 409, 'PLAN_TENDERED_EXISTS', 'Kho × ngày này đang có kế hoạch chờ ĐVVT phản hồi — ghi phản hồi (nhận / từ chối) hoặc bỏ các xe chờ trước khi lập lại.')

    const { ods, in_plan } = await loadPool(wh, b.plan_date)
    const wards = uniq(ods.map(o => o.ward_code).filter((x): x is string => !!x))
    const refs = await loadRefs(wh.id, b.plan_date, wards)
    const share_actual = await loadShareActual(wh.id, b.plan_date, refs.carriers)
    const prefix = codePrefixOf(wh.code, b.plan_date)
    const params = {
      day: b.plan_date,
      max_drops: b.max_drops ?? (Number(wh.dispatch_max_drops) || 3),
      allow_mix_channels: b.allow_mix_channels ?? wh.dispatch_allow_mix_channels === true,
      underload_pct: b.underload_pct === undefined ? numOrNull(wh.dispatch_underload_pct) : b.underload_pct,
      code_prefix: prefix,
      start_seq: await nextSeq(prefix),
    }
    const result = runDispatch({ ods, ...refs, share_actual, params })

    // MỘT bản nháp mỗi kho×ngày: nháp cũ (kể cả người đã sửa) bị thay — người bấm "Lập kế hoạch" là chủ ý chạy lại
    const { error: delErr } = await db.from('dispatch_plan').delete().eq('warehouse_id', wh.id).eq('plan_date', b.plan_date).eq('status', 'DRAFT')
    if (delErr) throw new Error(delErr.message)
    const t = now()
    const planId = randomUUID()
    const { error: pErr } = await db.from('dispatch_plan').insert({
      id: planId, warehouse_id: wh.id, plan_date: b.plan_date, status: 'DRAFT', engine_version: ENGINE_VERSION,
      params: asJson({ ...params, pool_ods: ods.length, in_plan: in_plan.length, share_base: share_actual, share_targets: refs.share_targets, carriers: refs.carriers, wh_code: wh.code }),
      summary: asJson(result.summary), unplanned: asJson(result.unplanned),
      created_by: req.user?.name ?? null, updated_at: t,
    })
    if (pErr) throw new Error(pErr.message)
    const tripRows = result.trips.map(tr => ({
      id: randomUUID(), plan_id: planId, seq: tr.seq, group_code: tr.group_code,
      vehicle_model_id: tr.vehicle_model?.id ?? null, transport_company_id: tr.carrier?.id ?? null,
      stops: tr.stops, wards: tr.wards, pallets: tr.pallets, tons: tr.tons, load_pct: tr.load.pct, underload: tr.underload, oversize: tr.oversize,
      freight_estimated: tr.freight.total, detail: asJson(tripDetail(tr)), manual_edited: false, status: 'DRAFT', updated_at: t,
    }))
    for (let i = 0; i < tripRows.length; i += CHUNK) {
      const { error } = await db.from('dispatch_trip').insert(tripRows.slice(i, i + CHUNK))
      if (error) throw new Error(error.message)
    }
    const odRows = result.trips.flatMap((tr, i) => tr.ods.map(o => ({
      id: randomUUID(), trip_id: tripRows[i].id, od_number: o.od_number, ship_to_code: o.ship_to_code, ship_to_name: o.ship_to_name, ward_code: o.ward_code,
      pallets: o.pallets, tons: o.tons, lines: o.lines, part_index: o.part?.index ?? null, part_of: o.part?.of ?? null, material_codes: o.material_codes, updated_at: t,
    })))
    for (let i = 0; i < odRows.length; i += CHUNK) {
      const { error } = await db.from('dispatch_trip_od').insert(odRows.slice(i, i + CHUNK))
      if (error) throw new Error(error.message)
    }
    const full = await readPlan(planId)
    return ok(res, { ...full, in_plan }, 201)
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}

// ── GET /tms/dispatch/plans · GET /tms/dispatch/plans/:id ──────────────────────────────────────────────
export async function listPlans(req: Request, res: Response) {
  try {
    const q = req.query as z.infer<typeof zListQuery>
    let query = db.from('dispatch_plan').select('id, warehouse_id, plan_date, status, summary, engine_version, created_by, confirmed_by, confirmed_at, created_at, updated_at').order('plan_date', { ascending: false }).order('created_at', { ascending: false }).limit(200)
    if (q.warehouse_id) {
      if (!whAllowed(req, q.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
      query = query.eq('warehouse_id', q.warehouse_id)
    } else {
      const s = scopeWhIds(req)
      if (s !== null) { if (!s.length) return ok(res, { items: [] }); query = query.in('warehouse_id', s.slice(0, 300)) }
    }
    if (q.date_from) query = query.gte('plan_date', q.date_from)
    if (q.date_to) query = query.lte('plan_date', q.date_to)
    if (q.status) query = query.eq('status', q.status)
    const { data, error } = await query
    if (error) return fail(res, error)
    const whIds = uniq((data ?? []).map(p => p.warehouse_id))
    const whs = whIds.length ? (await db.from('Warehouse').select('id, code, name').in('id', whIds.slice(0, 300))).data ?? [] : []
    const whBy = new Map(whs.map(w => [w.id, w]))
    return ok(res, { items: (data ?? []).map(p => ({ ...p, warehouse: whBy.get(p.warehouse_id) ?? null })) })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}
export async function getPlan(req: Request, res: Response) {
  try {
    const full = await readPlan(String(req.params.id))
    if (!full) return fail(res, 'Không tìm thấy kế hoạch', 404)
    if (!whAllowed(req, full.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const wh = (await db.from('Warehouse').select('id, code, name').eq('id', full.warehouse_id).maybeSingle()).data ?? null
    return ok(res, { ...full, warehouse: wh })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}

// ── Sửa nháp: tính lại MỘT chuyến theo dòng xe/ĐVVT đang chọn (cùng `priceFor` của engine) ────────────
type TripErr = { err: [string, number, string?] }
const sendErr = (res: Response, e: TripErr) => (e.err[2] ? fail(res, e.err[1], e.err[2], e.err[0]) : fail(res, e.err[0], e.err[1]))
const TRIP_STATUS_VI: Record<TripStatus, string> = { DRAFT: 'nháp', TENDERED: 'đang chờ ĐVVT phản hồi', DECLINED: 'ĐVVT đã từ chối', CONFIRMED: 'đã vào Kế hoạch xuất', DISCARDED: 'đã bỏ' }

/** Chuyến + kế hoạch của nó, gác phạm vi kho. `editable` = kế hoạch còn mở (DRAFT/TENDERED) và chuyến DRAFT/DECLINED. */
async function loadTrip(req: Request, tripId: string, opts: { editable?: boolean; allow?: TripStatus[] } = {}): Promise<{ plan: PlanRow; trip: TripRow & { ods: TripOdRow[] } } | TripErr> {
  const { data: trip, error } = await db.from('dispatch_trip').select('*').eq('id', tripId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!trip) return { err: ['Không tìm thấy chuyến nháp', 404] }
  const { data: plan } = await db.from('dispatch_plan').select('*').eq('id', trip.plan_id).maybeSingle()
  if (!plan) return { err: ['Không tìm thấy kế hoạch', 404] }
  if (!whAllowed(req, plan.warehouse_id)) return { err: ['Kho này ngoài phạm vi được giao', 403] }
  if (!OPEN_PLAN.includes(plan.status)) return { err: ['Kế hoạch đã xác nhận / đã bỏ — không sửa được bản nháp', 409, 'PLAN_NOT_DRAFT'] }
  const st = statusOf(trip as TripRow)
  const allow = opts.allow ?? (opts.editable ? EDITABLE_TRIP : null)
  if (allow && !allow.includes(st)) return { err: [`Xe ${trip.group_code} ${TRIP_STATUS_VI[st]} — không sửa được ở bước này`, 409, 'TRIP_NOT_EDITABLE'] }
  const ods = (await db.from('dispatch_trip_od').select('*').eq('trip_id', trip.id).order('od_number')).data ?? []
  return { plan: plan as PlanRow, trip: { ...(trip as TripRow), ods: ods as TripOdRow[] } }
}
const loadDraftTrip = (req: Request, tripId: string) => loadTrip(req, tripId, { editable: true })

async function repriceTrip(plan: PlanRow, trip: TripRow & { ods: TripOdRow[] }, modelId: string | null, carrierId: string | null, refs: Refs, whUnderloadPct: number | null) {
  const params = (plan.params ?? {}) as { day?: string; max_drops?: number; allow_mix_channels?: boolean; underload_pct?: number | null; code_prefix?: string; start_seq?: number }
  const ctx = buildCtx({ ods: [], ...refs, share_actual: {}, params: { day: plan.plan_date, max_drops: params.max_drops ?? 3, allow_mix_channels: params.allow_mix_channels ?? false, underload_pct: params.underload_pct ?? null, code_prefix: params.code_prefix ?? '', start_seq: params.start_seq ?? 1 } })
  const model = modelId ? refs.models.find(m => m.id === modelId) ?? null : null
  const carrier = carrierId ? refs.carriers.find(c => c.id === carrierId) ?? null : null
  const lines = trip.ods.map(o => ({ material_code: '', qty_base: 0, pallets: o.pallets == null ? null : Number(o.pallets), kg: o.tons == null ? null : Number(o.tons) * 1000, category: null }))
  const sum = sumLines(lines)
  const wards = uniq(trip.ods.map(o => o.ward_code).filter((x): x is string => !!x))
  const stops = Math.max(uniq(trip.ods.map(o => o.ship_to_code ?? o.od_number)).length, 1)
  const warnings: string[] = []
  let freight: TripFreight
  if (!model) freight = { total: null, base: null, billed_pallets: null, unit: null, tariff_id: null, ward: null, surcharges: [], reason: 'Chưa chọn dòng xe con' }
  else if (!carrier) freight = { total: null, base: null, billed_pallets: null, unit: model.tariff_unit, tariff_id: null, ward: null, surcharges: [], reason: 'Chưa chọn ĐVVT' }
  else freight = priceFor(ctx, model, carrier.id, wards, stops, sum.pallets, sum.tons)
  const load = tripLoad(model, sum.pallets, sum.tons, whUnderloadPct ?? params.underload_pct ?? null)
  if (model && load.pct != null && load.pct > 100) warnings.push(`Vượt sức chứa dòng xe ${model.name} (${load.pct}%)`)
  if (model && model.max_drops != null && stops > model.max_drops) warnings.push(`Vượt số điểm giao của dòng xe (${stops} > ${model.max_drops})`)
  const prev = detailOf(trip)
  const detail: Detail = {
    ...prev, freight, load, warnings, merge_hint: null,
    carrier_reasons: carrier ? ['Người điều vận chọn'] : [],
    vehicle_model: model ? { id: model.id, sap_code: model.sap_code, name: model.name, parent_type_name: model.parent_type_name } : null,
    carrier: carrier ? carrierRef(carrier) : null,
  }
  // chuyến ĐVVT đã từ chối mà người sửa lại ⇒ về nháp để chốt lại; ghi chú từ chối giữ nguyên trên dòng làm vết
  const patch = {
    vehicle_model_id: model?.id ?? null, transport_company_id: carrier?.id ?? null,
    stops, wards, pallets: sum.pallets, tons: sum.tons, load_pct: load.pct, underload: load.pct != null && load.pct < load.underload_pct,
    oversize: load.pct != null && load.pct > 100, freight_estimated: freight.total, detail: asJson(detail), manual_edited: true,
    status: (statusOf(trip) === 'DECLINED' ? 'DRAFT' : statusOf(trip)) as TripStatus, updated_at: now(),
  }
  const { error } = await db.from('dispatch_trip').update(patch).eq('id', trip.id)
  if (error) throw new Error(error.message)
  return { ...trip, ...patch }
}

// ── PATCH /tms/dispatch/trips/:id ──────────────────────────────────────────────────────────────────────
export async function updateTrip(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zTripPatch>
    const got = await loadDraftTrip(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan, trip } = got
    const wh = await loadWarehouse(plan.warehouse_id)
    const wards = uniq(trip.ods.map(o => o.ward_code).filter((x): x is string => !!x))
    const refs = await loadRefs(plan.warehouse_id, plan.plan_date, wards)
    const modelId = b.vehicle_model_id === undefined ? trip.vehicle_model_id : b.vehicle_model_id
    const carrierId = b.transport_company_id === undefined ? trip.transport_company_id : b.transport_company_id
    if (modelId && !refs.models.some(m => m.id === modelId)) return fail(res, 400, 'VEHICLE_MODEL_INVALID', 'Dòng xe con không tồn tại, đang ngừng dùng hoặc chưa gán dòng xe cha')
    if (carrierId && !refs.carriers.some(c => c.id === carrierId)) {
      // ĐVVT chưa có cước/phân tuyến ở kho này vẫn cho chọn (cước = null có lý do) — nhưng phải là ĐVVT thật
      const co = (await db.from('TransportCompany').select('id, code, name, tender_required').eq('id', carrierId).maybeSingle()).data
      if (!co) return fail(res, 400, 'CARRIER_INVALID', 'ĐVVT không tồn tại')
      refs.carriers.push(co as EngineCarrier)
    }
    const updated = await repriceTrip(plan, trip, modelId, carrierId, refs, numOrNull(wh?.dispatch_underload_pct))
    await writeSummary(plan)
    return ok(res, updated)
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}

// ── POST /tms/dispatch/trips/:id/move-od ───────────────────────────────────────────────────────────────
export async function moveOd(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zMoveOd>
    const got = await loadDraftTrip(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan, trip: src } = got
    const moving = src.ods.filter(o => o.od_number === b.od_number)
    if (!moving.length) return fail(res, 'OD không nằm trong chuyến này', 404)
    const t = now()
    let targetId = b.to_trip_id ?? null
    if (targetId) {
      const tg = (await db.from('dispatch_trip').select('id, plan_id, status, group_code').eq('id', targetId).maybeSingle()).data
      if (!tg || tg.plan_id !== plan.id) return fail(res, 'Chuyến đích không thuộc cùng kế hoạch', 400)
      if (tg.id === src.id) return fail(res, 'Chuyến đích trùng chuyến nguồn', 400)
      const tgSt = (tg.status as TripStatus) ?? 'DRAFT'
      if (!EDITABLE_TRIP.includes(tgSt)) return fail(res, 409, 'TRIP_NOT_EDITABLE', `Xe đích ${tg.group_code} ${TRIP_STATUS_VI[tgSt]} — không nhận thêm OD ở đây; đổi ở tab Kế hoạch xuất.`)
    } else {
      // tách ra chuyến MỚI: STT kế tiếp trong nháp, kế thừa dòng xe/ĐVVT của chuyến nguồn
      const params = (plan.params ?? {}) as { code_prefix?: string }
      const { data: maxRow } = await db.from('dispatch_trip').select('seq').eq('plan_id', plan.id).order('seq', { ascending: false }).limit(1).maybeSingle()
      const seq = Number(maxRow?.seq ?? 0) + 1
      targetId = randomUUID()
      const { error } = await db.from('dispatch_trip').insert({
        id: targetId, plan_id: plan.id, seq, group_code: `${params.code_prefix ?? ''}${seq}`,
        vehicle_model_id: src.vehicle_model_id, transport_company_id: src.transport_company_id,
        stops: 1, wards: [], detail: asJson({ ...detailOf(src), warnings: [], merge_hint: null }), manual_edited: true, status: 'DRAFT', updated_at: t,
      })
      if (error) throw new Error(error.message)
    }
    const { error: mvErr } = await db.from('dispatch_trip_od').update({ trip_id: targetId, updated_at: t }).in('id', moving.map(o => o.id).slice(0, 300))
    if (mvErr) throw new Error(mvErr.message)

    const wh = await loadWarehouse(plan.warehouse_id)
    const allWards = uniq([...src.ods.map(o => o.ward_code)].filter((x): x is string => !!x))
    const refs = await loadRefs(plan.warehouse_id, plan.plan_date, allWards)
    // nguồn: còn OD thì tính lại, hết OD thì xoá chuyến
    const srcLeft = src.ods.filter(o => o.od_number !== b.od_number)
    if (srcLeft.length) await repriceTrip(plan, { ...src, ods: srcLeft }, src.vehicle_model_id, src.transport_company_id, refs, numOrNull(wh?.dispatch_underload_pct))
    else { const { error } = await db.from('dispatch_trip').delete().eq('id', src.id); if (error) throw new Error(error.message) }
    // đích
    const tgTrip = (await db.from('dispatch_trip').select('*').eq('id', targetId).maybeSingle()).data as TripRow | null
    if (tgTrip) {
      const tgOds = ((await db.from('dispatch_trip_od').select('*').eq('trip_id', targetId).order('od_number')).data ?? []) as TripOdRow[]
      const tgWards = uniq(tgOds.map(o => o.ward_code).filter((x): x is string => !!x))
      const refs2 = tgWards.every(w => allWards.includes(w)) ? refs : await loadRefs(plan.warehouse_id, plan.plan_date, uniq([...allWards, ...tgWards]))
      await repriceTrip(plan, { ...tgTrip, ods: tgOds }, tgTrip.vehicle_model_id, tgTrip.transport_company_id, refs2, numOrNull(wh?.dispatch_underload_pct))
    }
    await writeSummary(plan)
    return ok(res, await readPlan(plan.id))
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}

// ── Ghi các chuyến vào Kế hoạch xuất — dùng chung cho Xác nhận cả kế hoạch · chốt một xe · ĐVVT nhận ─────
type FullPlan = NonNullable<Awaited<ReturnType<typeof readPlan>>>
type FullTrip = FullPlan['trips'][number]

/** Gác trước khi ghi: (a) một OD một xe (soi trên CẢ kế hoạch, kể cả xe chưa chốt) · (b) có cửa đặt lịch · (c) OD chưa bị ai
 *  đưa vào Kế hoạch xuất trong lúc nháp nằm chờ · (d) Số xe chưa bị dùng. Trả lỗi hoặc null. */
async function tripGuards(full: FullPlan, subset: FullTrip[]): Promise<TripErr | null> {
  const live = full.trips.filter(t => statusOf(t) !== 'DISCARDED' && t.ods.length)
  const tripsByOd = new Map<string, string[]>()
  for (const t of live) for (const od of uniq(t.ods.map(o => o.od_number))) { const l = tripsByOd.get(od) ?? []; l.push(t.group_code); tripsByOd.set(od, l) }
  const subOds = uniq(subset.flatMap(t => t.ods.map(o => o.od_number)))
  const splitOds = subOds.filter(od => (tripsByOd.get(od) ?? []).length > 1)
  if (splitOds.length) return { err: [`${splitOds.length} OD đang nằm ở nhiều xe (${splitOds.slice(0, 5).map(od => `${od}: ${tripsByOd.get(od)!.join(' + ')}`).join('; ')}) — app chưa tách một DO ra hai xe, gom OD về một xe trước khi xác nhận.`, 422, 'OD_SPLIT_ACROSS_TRIPS'] }
  const noCat = subset.filter(t => !detailOf(t).booking_category)
  if (noCat.length) return { err: [`${noCat.length} xe không xác định được Loại kho booking (mã hàng chưa khai loại): ${noCat.slice(0, 5).map(t => t.group_code).join(', ')}`, 422, 'BOOKING_CATEGORY_REQUIRED'] }
  const taken = (await fetchAllByIdChunks(subOds, c => db.from('khvc_lines').select('do_no, group_code').in('do_no', c).neq('sync_status', 'OBSOLETE').order('do_no'))) as { do_no: string; group_code: string }[]
  if (taken.length) return { err: [`${uniq(taken.map(x => x.do_no)).length} OD đã có trong Kế hoạch xuất từ lúc lập nháp (${taken.slice(0, 5).map(x => `${x.do_no} → ${x.group_code}`).join('; ')}) — lập lại kế hoạch để loại các OD đó.`, 409, 'OD_ALREADY_PLANNED'] }
  const gcs = subset.map(t => t.group_code)
  const usedGc = (await fetchAllByIdChunks(gcs, c => db.from('khvc_lines').select('group_code').in('group_code', c).neq('sync_status', 'OBSOLETE').order('group_code'))) as { group_code: string }[]
  if (usedGc.length) return { err: [`Số xe ${uniq(usedGc.map(x => x.group_code)).slice(0, 5).join(', ')} đã có trong Kế hoạch xuất — lập lại kế hoạch để lấy STT mới.`, 409, 'GROUP_CODE_TAKEN'] }
  return null
}

/** Ghi khvc_lines cho các chuyến đã qua gác → trip CONFIRMED → dội xuống chuyến/lệnh VC như upload tay. */
async function writeTrips(req: Request, full: FullPlan, wh: WhRow, trips: FullTrip[]) {
  const t = now()
  const rows = trips.flatMap(tr => {
    const d = detailOf(tr)
    return uniq(tr.ods.map(o => o.od_number)).map(od => {
      const o = tr.ods.find(x => x.od_number === od)!
      return {
        id: randomUUID(), group_code: tr.group_code, do_no: od, warehouse_code: wh.code,
        npp: o.ship_to_name ?? o.ship_to_code ?? null, veh_type: d.vehicle_model?.parent_type_name ?? null, dvvt: d.carrier?.name ?? null,
        export_date: full.plan_date, booking_category: d.booking_category, vehicle_model_id: tr.vehicle_model_id,
        source: 'DISPATCH', sync_status: 'ACTIVE', uploaded_by: req.user?.name ?? null, updated_at: t,
      }
    })
  })
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from('khvc_lines').insert(rows.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
  }
  const gcs = trips.map(x => x.group_code)
  const { error } = await db.from('dispatch_trip').update({ status: 'CONFIRMED', confirmed_at: t, updated_at: t }).in('id', trips.map(x => x.id).slice(0, 300))
  if (error) throw new Error(error.message)
  let replan: Record<string, unknown> | null = null, replan_error: string | null = null
  try { replan = await replanKhvcGroups(req, gcs) } catch (e) { replan_error = String(e); console.error('[dispatch confirm] replan:', e) }
  return { lines: rows.length, group_codes: gcs, replan, replan_error }
}

/** ĐVVT của chuyến có cần phản hồi không — đọc CỜ HIỆN TẠI của danh mục, không tin bản chụp trong detail lúc lập. */
async function tenderFlags(trips: FullTrip[]): Promise<Map<string, boolean>> {
  const ids = uniq(trips.map(t => t.transport_company_id).filter((x): x is string => !!x))
  if (!ids.length) return new Map()
  const rows = (await fetchAllByIdChunks(ids, c => db.from('TransportCompany').select('id, tender_required').in('id', c).order('id'))) as { id: string; tender_required: boolean }[]
  return new Map(rows.map(r => [r.id, r.tender_required === true]))
}
async function markTendered(trips: FullTrip[]) {
  if (!trips.length) return
  const t = now()
  const { error } = await db.from('dispatch_trip').update({ status: 'TENDERED', tendered_at: t, responded_at: null, response_by: null, response_note: null, updated_at: t }).in('id', trips.map(x => x.id).slice(0, 300))
  if (error) throw new Error(error.message)
}

// ── POST /tms/dispatch/plans/:id/confirm — xe của ĐVVT không cần phản hồi ghi thẳng; xe còn lại chờ ĐVVT ─────
export async function confirmPlan(req: Request, res: Response) {
  try {
    const full = await readPlan(String(req.params.id))
    if (!full) return fail(res, 'Không tìm thấy kế hoạch', 404)
    if (!whAllowed(req, full.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    if (full.status !== 'DRAFT') return fail(res, 409, 'PLAN_NOT_DRAFT', 'Kế hoạch đã xác nhận / đang chờ ĐVVT / đã bỏ — chốt từng xe ở panel chuyến')
    const trips = full.trips.filter(t => t.ods.length && statusOf(t) === 'DRAFT')
    if (!trips.length) return fail(res, 422, 'PLAN_EMPTY', 'Kế hoạch không có chuyến nào để xác nhận')
    const wh = await loadWarehouse(full.warehouse_id)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    const g = await tripGuards(full, trips)
    if (g) return sendErr(res, g)

    const flags = await tenderFlags(trips)
    const direct = trips.filter(t => !t.transport_company_id || !flags.get(t.transport_company_id))
    const tender = trips.filter(t => t.transport_company_id && flags.get(t.transport_company_id))
    await markTendered(tender)
    const w = direct.length ? await writeTrips(req, full, wh, direct) : { lines: 0, group_codes: [] as string[], replan: null, replan_error: null }
    const status = await syncPlanStatus(full as PlanRow, req.user?.name ?? null)
    await writeSummary(full as PlanRow)
    return ok(res, { plan_id: full.id, status, trips: direct.length, tendered: tender.length, tendered_group_codes: tender.map(t => t.group_code), lines: w.lines, group_codes: w.group_codes, replan: w.replan, replan_error: w.replan_error })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}

// ── POST /tms/dispatch/trips/:id/settle — chốt MỘT xe (kế hoạch đang chờ ĐVVT: xe nháp / xe bị từ chối đã sửa ĐVVT) ─
export async function settleTrip(req: Request, res: Response) {
  try {
    const got = await loadTrip(req, String(req.params.id), { editable: true })
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    const full = (await readPlan(plan.id))!
    const trip = full.trips.find(t => t.id === got.trip.id)!
    if (!trip.ods.length) return fail(res, 422, 'TRIP_EMPTY', 'Xe không còn OD nào')
    const wh = await loadWarehouse(plan.warehouse_id)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    const g = await tripGuards(full, [trip])
    if (g) return sendErr(res, g)
    const flags = await tenderFlags([trip])
    const needs = !!trip.transport_company_id && flags.get(trip.transport_company_id) === true
    let w: Awaited<ReturnType<typeof writeTrips>> | null = null
    if (needs) await markTendered([trip]); else w = await writeTrips(req, full, wh, [trip])
    const status = await syncPlanStatus(plan, req.user?.name ?? null)
    await writeSummary(plan)
    return ok(res, { trip_id: trip.id, group_code: trip.group_code, trip_status: needs ? 'TENDERED' : 'CONFIRMED', plan_status: status, lines: w?.lines ?? 0, replan: w?.replan ?? null, replan_error: w?.replan_error ?? null })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}

// ── POST /tms/dispatch/trips/:id/respond — ghi câu trả lời của ĐVVT cho xe đang chờ (đợt A: điều vận ghi thay) ───
export async function respondTrip(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zRespond>
    const got = await loadTrip(req, String(req.params.id), { allow: ['TENDERED'] })
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    const t = now()
    const actor = req.user?.name ?? null
    if (!b.accept) {
      const { error } = await db.from('dispatch_trip').update({ status: 'DECLINED', responded_at: t, response_by: actor, response_note: b.note?.trim() || null, updated_at: t }).eq('id', got.trip.id)
      if (error) throw new Error(error.message)
      const status = await syncPlanStatus(plan, actor)
      await writeSummary(plan)
      return ok(res, { trip_id: got.trip.id, group_code: got.trip.group_code, trip_status: 'DECLINED', plan_status: status })
    }
    const full = (await readPlan(plan.id))!
    const trip = full.trips.find(x => x.id === got.trip.id)!
    const wh = await loadWarehouse(plan.warehouse_id)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    const g = await tripGuards(full, [trip])
    if (g) return sendErr(res, g)
    const { error } = await db.from('dispatch_trip').update({ responded_at: t, response_by: actor, response_note: b.note?.trim() || null, updated_at: t }).eq('id', trip.id)
    if (error) throw new Error(error.message)
    const w = await writeTrips(req, full, wh, [trip])
    const status = await syncPlanStatus(plan, actor)
    await writeSummary(plan)
    return ok(res, { trip_id: trip.id, group_code: trip.group_code, trip_status: 'CONFIRMED', plan_status: status, lines: w.lines, replan: w.replan, replan_error: w.replan_error })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}

// ── DELETE /tms/dispatch/plans/:id — bỏ bản nháp; kế hoạch đang chờ ĐVVT ⇒ bỏ các xe CHƯA vào Kế hoạch xuất ─────
export async function discardPlan(req: Request, res: Response) {
  try {
    const { data: plan } = await db.from('dispatch_plan').select('*').eq('id', String(req.params.id)).maybeSingle()
    if (!plan) return fail(res, 'Không tìm thấy kế hoạch', 404)
    if (!whAllowed(req, plan.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    if (!OPEN_PLAN.includes(plan.status)) return fail(res, 409, 'PLAN_NOT_DRAFT', 'Kế hoạch đã xác nhận / đã bỏ')
    const t = now()
    const { data: dropped, error: tErr } = await db.from('dispatch_trip').update({ status: 'DISCARDED', updated_at: t }).eq('plan_id', plan.id).neq('status', 'CONFIRMED').select('id')
    if (tErr) throw new Error(tErr.message)
    let status: string
    if (plan.status === 'DRAFT') {
      const { error } = await db.from('dispatch_plan').update({ status: 'DISCARDED', updated_at: t }).eq('id', plan.id)
      if (error) throw new Error(error.message)
      status = 'DISCARDED'
    } else {
      status = await syncPlanStatus(plan as PlanRow, req.user?.name ?? null)
      await writeSummary(plan as PlanRow)
    }
    return ok(res, { id: plan.id, status, discarded_trips: dropped?.length ?? 0 })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}

export { pickBookingCategory }
