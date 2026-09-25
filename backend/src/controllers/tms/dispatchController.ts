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
import { ok, fail, type PgLikeError } from '../../utils/response'
import { fetchAllByIdChunks, fetchAllRowsParallel } from '../../utils/pagination'
import { z, zId, zDay, zBool, zText } from '../../middlewares/validate'
import { normDvvt } from '../../utils/sapUnits'
import { getStorageConditionByCategory } from '../../utils/warehouseTypeMeta'
import { makeDvvtResolver } from '../../services/sapFlow'
import { loadOfWithSap } from '../../services/freightEstimate'
import { effectiveAt } from '../../services/freight'
import {
  runDispatch, buildCtx, priceFor, tripLoad, codePrefixOf, isTransferOd, useOk, sharePct, pickBookingCategory, sumLines, servesConditions, catLoadOf, bookingFromCatLoads, suggestVehicle,
  type EngineInput, type EngineOd, type EngineLine, type EngineModel, type EngineCarrier, type EngineTariff, type EngineSurcharge,
  type EngineAllocation, type EngineShareTarget, type ShareActual, type DispatchTrip, type TripFreight, type CarrierShare, type ShareBasis, type TripOd, type LoadMode,
  stopsLimit, modeOfModel,
} from '../../services/dispatchEngine'
import { splitPool, type ExcludedOd, type PoolCandidateRow } from '../../services/dispatchPool'
import { replanKhvcGroups } from '../wms/outboundController'
import { classifyKhvcDelete } from '../external/khvcController'
import { logOutboundEvents, actorOf } from '../../services/outboundEvents'
import type { Database, Json } from '../../types/database'
import type { LoadMat } from '../../utils/loadCalc'

type Tables = Database['public']['Tables']
type PlanRow = Tables['dispatch_plan']['Row']
type TripRow = Tables['dispatch_trip']['Row']
type TripOdRow = Tables['dispatch_trip_od']['Row']
type WhRow = { id: string; code: string; name: string; sap_plant: string | null; sap_storage_locations: string[] | null; dispatch_max_drops: number; dispatch_allow_mix_channels: boolean; dispatch_underload_pct: number | string | null; dispatch_pallet_max_stops: number }

type TripStatus = 'DRAFT' | 'TENDERED' | 'DECLINED' | 'CONFIRMED' | 'DISCARDED'
const EDITABLE_TRIP: TripStatus[] = ['DRAFT', 'DECLINED']
const OPEN_PLAN = ['DRAFT', 'TENDERED']

const ENGINE_VERSION = '2026-09-25.1'
/** OD tồn đọng: ngày giao trước ngày lập tối đa bấy nhiêu ngày (user chốt 25/09 gộp tồn đọng; quá xa là lịch sử, không phải việc). */
const BACKLOG_DAYS = 14
const now = () => new Date().toISOString()
const CHUNK = 500
const uniq = <T,>(a: T[]) => [...new Set(a)]
const numOrNull = (v: unknown): number | null => { const n = Number(v); return v == null || !Number.isFinite(n) ? null : n }
const asJson = (v: unknown): Json => JSON.parse(JSON.stringify(v ?? null)) as Json
/** Ném NGUYÊN đối tượng lỗi PostgREST (giữ code 22P02/23505…) để fail() dịch thành 400/409 — bậc fast 24/09 bắt id rác trên :id ra 500 vì bản cũ ném new Error(message). */
const failAny = (res: Response, e: unknown) => (e && typeof e === 'object' ? fail(res, e as PgLikeError) : fail(res, String(e), 500))

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
  pallet_max_stops: z.number().int().min(1).max(20).optional(),   // đè "số khách tối đa / xe pallet" của kho cho lượt lập này
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
  locked: zBool.optional(),            // khoá xe: "Tối ưu lại phần chưa khoá" không đụng vào
  load_mode: z.enum(['PALLET', 'LOOSE']).optional(),   // nút trên thẻ xe: đổi xe pallet ↔ xe xá (máy chọn lại dòng xe đúng họ)
})
// Bàn ghép xe (25/09): một cửa cho mọi lần thả — id là DÒNG OD của kế hoạch (một OD bị tách có nhiều dòng)
export const zMove = z.object({
  ids: z.array(zId).min(1).max(300),
  to: z.enum(['trip', 'new', 'pool', 'remove']),     // xe có sẵn · xe mới (máy chọn dòng xe/ĐVVT) · khung chờ · bỏ khỏi kế hoạch
  to_trip_id: zId.optional(),
})
export const zPreview = z.object({ ids: z.array(zId).min(1).max(300), to_trip_id: zId })
export const zReplaceOd = z.object({ od_number: zText(1, 50) })
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
  const { data, error } = await db.from('Warehouse').select('id, code, name, sap_plant, sap_storage_locations, dispatch_max_drops, dispatch_allow_mix_channels, dispatch_underload_pct, dispatch_pallet_max_stops').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as WhRow | null) ?? null
}

async function loadRefs(whId: string, day: string, wards: string[]): Promise<Refs> {
  const [vmRes, vtRes, tariffs, surcharges, allocRes, shareRes] = await Promise.all([
    db.from('vehicle_model').select('id, sap_code, name, parent_type_id, capacity_mode, max_pallets, max_tons, tariff_unit, underload_pct, max_drops, storage_conditions, is_active, dispatch_use').eq('is_active', true).order('sap_code'),
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
  for (const r of [vmRes, vtRes, allocRes, shareRes]) if (r.error) throw r.error
  const vtName = new Map(((vtRes.data ?? []) as { id: string; name: string }[]).map(v => [v.id, v.name]))
  const models: EngineModel[] = ((vmRes.data ?? []) as { id: string; sap_code: string; name: string; parent_type_id: string | null; capacity_mode: string | null; max_pallets: number | null; max_tons: number | string | null; tariff_unit: string | null; underload_pct: number | string | null; max_drops: number | null; storage_conditions: string[] | null; is_active: boolean; dispatch_use: string | null }[]).map(m => ({
    id: m.id, sap_code: m.sap_code, name: m.name,
    parent_type_name: m.parent_type_id ? (vtName.get(m.parent_type_id) ?? null) : null,
    capacity_mode: m.capacity_mode === 'TON' ? 'TON' : m.capacity_mode === 'PALLET' ? 'PALLET' : null,
    max_pallets: numOrNull(m.max_pallets), max_tons: numOrNull(m.max_tons),
    tariff_unit: m.tariff_unit === 'PER_TRIP' ? 'PER_TRIP' : 'PER_PALLET',
    underload_pct: numOrNull(m.underload_pct), max_drops: numOrNull(m.max_drops), is_active: m.is_active,
    serve_conditions: (m.storage_conditions ?? []).filter(Boolean),   // rỗng = chở được mọi điều kiện
    dispatch_use: m.dispatch_use === 'TRANSFER' ? 'TRANSFER' : 'ALL',   // luật 8: container chỉ trung chuyển giữa kho
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

// ── POOL LŨY TIẾN: OD ZSD02 của kho — ngày giao đó + tồn đọng — chưa được lo ở đâu (luật: services/dispatchPool) ──────
type PoolRow = PoolCandidateRow & { od_item: string; material_code: string | null; qty_base: number | string | null; ship_to_code: string | null; ship_to_name: string | null; ward_code: string | null; region_code: string | null; flow: string | null; sap_pallets: number | string | null; gross_weight_kg: number | string | null; storage_location: string | null }
type MatRow = LoadMat & { material_code: string; category: string | null }
type CustRow = { ship_to_code: string; ward_code: string | null; region_code: string | null; channel: string | null; warehouse_id: string | null; is_active: boolean; load_mode: string | null }
type OdMeta = { delivery_date: string | null; late_days: number; region_code: string | null }
const POOL_COLS = 'od_number, od_item, material_code, qty_base, ship_to_code, ship_to_name, ward_code, region_code, flow, sap_pallets, gross_weight_kg, storage_location, delivery_date, sap_dispatch_status, mat_doc, qty_issued_base, dvvt_raw, license_plate'
const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** OD đang nằm trong bản nháp ĐANG MỞ của kho (trừ `skipPlanId`) — xe chưa bỏ / chưa vào Kế hoạch xuất, hoặc khung chờ. */
async function openDraftOds(whId: string, odNos: string[], skipPlanId: string | null): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!odNos.length) return out
  const rows = (await fetchAllByIdChunks(odNos, c => db.from('dispatch_trip_od').select('od_number, plan_id, trip_id').in('od_number', c).order('id'))) as { od_number: string; plan_id: string; trip_id: string | null }[]
  const planIds = uniq(rows.map(r => r.plan_id).filter(p => p !== skipPlanId))
  if (!planIds.length) return out
  const plans = (await fetchAllByIdChunks(planIds, c => db.from('dispatch_plan').select('id, plan_date, status, warehouse_id').in('id', c).order('id'))) as { id: string; plan_date: string; status: string; warehouse_id: string }[]
  const openBy = new Map(plans.filter(p => OPEN_PLAN.includes(p.status) && p.warehouse_id === whId).map(p => [p.id, p.plan_date]))
  const tripIds = uniq(rows.filter(r => openBy.has(r.plan_id) && r.trip_id).map(r => r.trip_id!))
  const trips = tripIds.length ? (await fetchAllByIdChunks(tripIds, c => db.from('dispatch_trip').select('id, status').in('id', c).order('id'))) as { id: string; status: string }[] : []
  const deadTrip = new Set(trips.filter(t => t.status === 'DISCARDED' || t.status === 'CONFIRMED').map(t => t.id))
  for (const r of rows) {
    const d = openBy.get(r.plan_id)
    if (!d || (r.trip_id && deadTrip.has(r.trip_id))) continue
    if (!out.has(r.od_number)) out.set(r.od_number, `nháp ngày ${d}`)
  }
  return out
}

/** Nạp ứng viên + phân loại lũy tiến. `onlyOds` = chỉ những OD này (tối ưu lại / thay OD), bỏ lọc theo ngày. */
async function loadCandidates(wh: WhRow, day: string, condByCat: Map<string, string>, opts: { onlyOds?: string[]; skipPlanId?: string | null; countOnly?: boolean } = {}): Promise<{ ods: EngineOd[]; meta: Map<string, OdMeta>; excluded: ExcludedOd[]; include: string[] }> {
  const rows = (opts.onlyOds
    ? await fetchAllByIdChunks(opts.onlyOds, c => db.from('erp_outbound_orders').select(POOL_COLS).in('od_number', c).eq('sync_status', 'ACTIVE').order('od_number').order('od_item'))
    : await fetchAllRowsParallel(() => db.from('erp_outbound_orders').select(POOL_COLS)
      .eq('plant', wh.sap_plant ?? '').gte('delivery_date', shiftDay(day, -BACKLOG_DAYS)).lte('delivery_date', day)
      .eq('sync_status', 'ACTIVE').not('od_number', 'is', null).order('od_number').order('od_item'))) as unknown as PoolRow[]
  const slocs = (wh.sap_storage_locations ?? []).map(s => String(s).trim().toUpperCase()).filter(Boolean)
  const mine0 = slocs.length ? rows.filter(r => !r.storage_location || slocs.includes(String(r.storage_location).trim().toUpperCase())) : rows
  // OD TỒN ĐỌNG chỉ gộp khi LÊN XE được — hàng trả về / chiết khấu của ngày trước không phải việc của hôm nay
  const mine = mine0.filter(r => r.delivery_date === day || LOADABLE_FLOW.has(String(r.flow)))
  const odNos = uniq(mine.map(r => r.od_number))
  const [khvc, drafts] = await Promise.all([
    fetchAllByIdChunks(odNos, c => db.from('khvc_lines').select('do_no, group_code').in('do_no', c).neq('sync_status', 'OBSOLETE').order('do_no')) as Promise<{ do_no: string; group_code: string }[]>,
    openDraftOds(wh.id, odNos, opts.skipPlanId ?? null),
  ])
  const inPlan = new Map<string, string>()
  for (const k of khvc) if (!inPlan.has(k.do_no)) inPlan.set(k.do_no, k.group_code)
  const split = splitPool(mine, day, { inPlan, otherDraft: drafts })
  // CHỈ OD lên xe được mới là "OD mới cần xếp" — OD trả về / chiết khấu đúng ngày vẫn qua splitPool (engine xếp vào
  // danh sách "không lên xe"), đếm chúng là báo "12 OD mới" ngay sau khi vừa lập (đo Preview 25/09: đúng 12 OD RETURN)
  const flowOf = new Map(mine.map(r => [r.od_number, String(r.flow)]))
  const include = [...split.include.keys()].filter(od => LOADABLE_FLOW.has(flowOf.get(od) ?? ''))
  if (opts.countOnly) return { ods: [], meta: new Map(), excluded: split.excluded, include }
  const kept = mine.filter(r => split.include.has(r.od_number))
  const [mats, custs] = await Promise.all([
    fetchAllByIdChunks(uniq(kept.map(r => r.material_code).filter((x): x is string => !!x)), c => db.from('Material')
      .select('material_code, category, base_unit, entry_unit, units_per_carton, cartons_per_pallet, warehouse_pallet_overrides, weight_kg, is_pallet_carrier, is_non_stock').in('material_code', c).order('material_code')) as Promise<MatRow[]>,
    fetchAllByIdChunks(uniq(kept.map(r => r.ship_to_code).filter((x): x is string => !!x)), c => db.from('Customer')
      .select('ship_to_code, ward_code, region_code, channel, warehouse_id, is_active, load_mode').in('ship_to_code', c).order('ship_to_code')) as Promise<CustRow[]>,
  ])
  const matBy = new Map(mats.map(m => [m.material_code, m]))
  const custBy = new Map(custs.map(c => [c.ship_to_code, c]))
  const byOd = new Map<string, PoolRow[]>()
  for (const r of kept) { const l = byOd.get(r.od_number) ?? []; l.push(r); byOd.set(r.od_number, l) }
  const meta = new Map<string, OdMeta>()
  const ods: EngineOd[] = []
  for (const [od, rs] of byOd) {
    const first = rs[0]
    const cust = first.ship_to_code ? custBy.get(first.ship_to_code) : undefined
    const lines: EngineLine[] = rs.map(r => {
      const mat = r.material_code ? matBy.get(r.material_code) ?? null : null
      const q = Number(r.qty_base) || 0
      const l = loadOfWithSap(q, mat, wh.id, { sap_pallets: numOrNull(r.sap_pallets), gross_weight_kg: numOrNull(r.gross_weight_kg) })
      const cat = mat?.category ?? null
      // Điều kiện bảo quản THEO LOẠI KHO (Cài đặt WMS → Loại kho). Loại chưa khai ⇒ null ⇒ không ràng buộc dòng xe.
      return { material_code: r.material_code ?? '?', qty_base: q, pallets: l.pallets, kg: l.kg, category: cat, condition: (cat && condByCat.get(cat)) || null }
    })
    ods.push({
      od_number: od, ship_to_code: first.ship_to_code, ship_to_name: first.ship_to_name,
      ward_code: first.ward_code ?? cust?.ward_code ?? null, region_code: first.region_code ?? cust?.region_code ?? null,
      channel: cust?.is_active === false ? null : (cust?.channel ?? null),
      internal_wh: cust?.warehouse_id ?? null, scan_mode: !!cust?.warehouse_id,
      flow: first.flow ?? 'UNKNOWN', lines,
      // Luật 7 (25/09): khách CHƯA khai / chưa có trong danh mục = đi XÁ (user chốt "khách nào là Pallet, còn lại là xá")
      load_mode: cust?.load_mode === 'PALLET' ? 'PALLET' : 'LOOSE',
    })
    const inc = split.include.get(od)!
    meta.set(od, { delivery_date: inc.delivery_date, late_days: inc.late_days, region_code: first.region_code ?? cust?.region_code ?? null })
  }
  return { ods, meta, excluded: split.excluded, include }
}
const LOADABLE_FLOW = new Set(['SALE', 'STO', 'INTERNAL', 'PALLET'])

/** Dòng dispatch_trip_od từ một phần OD engine đã xếp (hoặc cả OD nằm khung chờ khi trip = null). */
function odRow(planId: string, tripId: string | null, o: TripOd, m: OdMeta | undefined, t: string): Tables['dispatch_trip_od']['Insert'] {
  return {
    id: randomUUID(), plan_id: planId, trip_id: tripId, od_number: o.od_number, ship_to_code: o.ship_to_code, ship_to_name: o.ship_to_name, ward_code: o.ward_code,
    pallets: o.pallets, tons: o.tons, lines: o.lines, part_index: o.part?.index ?? null, part_of: o.part?.of ?? null, material_codes: o.material_codes,
    conditions: o.conditions, cat_load: asJson(o.cat_load), region_code: m?.region_code ?? null, delivery_date: m?.delivery_date ?? null, late_days: m?.late_days ?? 0,
    load_mode: o.load_mode, is_transfer: o.transfer, updated_at: t,
  }
}
/** Cả một OD (chưa tách) → TripOd — cho OD vào khung chờ (nạp OD mới / thay OD). */
function wholeOd(od: EngineOd): TripOd {
  const s = sumLines(od.lines)
  return { od_number: od.od_number, ship_to_code: od.ship_to_code, ship_to_name: od.ship_to_name, ward_code: od.ward_code, pallets: s.pallets, tons: s.tons, lines: od.lines.length, part: null,
    material_codes: od.lines.map(l => l.material_code), conditions: uniq(od.lines.map(l => l.condition).filter((c): c is string => !!c)).sort(), cat_load: catLoadOf(od.lines), load_mode: od.load_mode ?? null, transfer: isTransferOd(od) }
}
const asMode = (v: string | null | undefined): LoadMode | null => (v === 'PALLET' || v === 'LOOSE' ? v : null)
async function insertOdRows(rows: Tables['dispatch_trip_od']['Insert'][]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from('dispatch_trip_od').insert(rows.slice(i, i + CHUNK))
    if (error) throw error
  }
}

/** Danh mục điều kiện bảo quản: mã → nhãn tiếng Việt. Engine chỉ dùng để VIẾT CÂU cảnh báo, không dùng để quyết định. */
async function loadConditionLabels(): Promise<Record<string, string>> {
  const { data, error } = await db.from('LookupValue').select('value, meta').eq('type', 'storage_condition').order('sort_order')
  if (error) throw error
  const out: Record<string, string> = {}
  for (const r of (data ?? []) as { value: string; meta: unknown }[]) {
    const label = (r.meta as { label?: unknown } | null)?.label
    out[r.value] = typeof label === 'string' && label.trim() ? label.trim() : r.value
  }
  return out
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
    freight: t.freight, load: t.load, categories: t.categories, conditions: t.conditions, booking_category: t.booking_category, cluster: t.cluster,
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
  if (error) throw error
  if (!plan) return null
  const [trips, ods] = await Promise.all([
    fetchAllRowsParallel(() => db.from('dispatch_trip').select('*').eq('plan_id', planId).order('seq')) as Promise<TripRow[]>,
    fetchAllRowsParallel(() => db.from('dispatch_trip_od').select('*').eq('plan_id', planId).order('od_number').order('id')) as Promise<TripOdRow[]>,
  ])
  const odsBy = new Map<string, TripOdRow[]>()
  const pool: TripOdRow[] = []
  for (const o of ods) { if (!o.trip_id) { pool.push(o); continue } const l = odsBy.get(o.trip_id) ?? []; l.push(o); odsBy.set(o.trip_id, l) }
  return { ...(plan as PlanRow), trips: trips.map(t => ({ ...t, ods: odsBy.get(t.id) ?? [] })), pool }
}

/** Tổng kết lại từ các chuyến đang có trong nháp (sau khi người sửa) — tỷ trọng = nền kỳ (lúc chạy) + chuyến trong nháp.
 *  Chuyến đã bỏ và XE TRỐNG (người kéo hết OD ra, chưa bỏ xe) không tính. Dải chỉ số của bàn ghép xe đọc thẳng từ đây. */
function summarizeRows(plan: PlanRow, allTrips: (TripRow & { ods: TripOdRow[] })[], pool: TripOdRow[] = []) {
  const trips = allTrips.filter(t => statusOf(t) !== 'DISCARDED' && t.ods.length > 0)
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
  // số chuyến theo dòng xe — "bao nhiêu xe 10 pallet, bao nhiêu cont" là câu điều vận hỏi đầu tiên khi gọi nhà xe
  const byModel = new Map<string, { key: string; sap_code: string | null; name: string; parent: string | null; trips: number; pallets: number }>()
  for (const t of trips) {
    const vm = detailOf(t).vehicle_model
    const k = vm?.id ?? '—'
    const a = byModel.get(k) ?? { key: k, sap_code: vm?.sap_code ?? null, name: vm?.name ?? 'Chưa chọn dòng xe', parent: vm?.parent_type_name ?? null, trips: 0, pallets: 0 }
    a.trips += 1; a.pallets += Number(t.pallets ?? 0)
    byModel.set(k, a)
  }
  const loads = trips.map(t => Number(t.load_pct)).filter(n => Number.isFinite(n) && n > 0)
  const pallets = trips.reduce((s, t) => s + Number(t.pallets ?? 0), 0)
  const freightTotal = trips.reduce((s, t) => s + Number(t.freight_estimated ?? 0), 0)
  const pricedPallets = trips.filter(t => t.freight_estimated != null).reduce((s, t) => s + Number(t.pallets ?? 0), 0)
  const allOds = [...trips.flatMap(t => t.ods), ...pool]
  const baseline = (plan.params as { baseline?: unknown } | null)?.baseline ?? null
  return {
    by_model: [...byModel.values()].sort((a, b) => b.trips - a.trips || (a.sap_code ?? '').localeCompare(b.sap_code ?? '')).map(m => ({ ...m, pallets: Math.round(m.pallets * 10) / 10 })),
    avg_load_pct: loads.length ? Math.round((loads.reduce((s, n) => s + n, 0) / loads.length) * 10) / 10 : null,
    freight_per_pallet: pricedPallets > 0 ? Math.round(freightTotal / pricedPallets) : null,
    overload: trips.filter(t => Number(t.load_pct) > 100).length,
    pool_ods: uniq(pool.map(o => o.od_number)).length,
    pool_pallets: Math.round(pool.reduce((s, o) => s + Number(o.pallets ?? 0), 0) * 10) / 10,
    late_ods: uniq(allOds.filter(o => (o.late_days ?? 0) > 0).map(o => o.od_number)).length,
    empty_trips: allTrips.filter(t => statusOf(t) !== 'DISCARDED' && !t.ods.length).length,
    locked: trips.filter(t => t.locked).length,
    baseline,
    trips: trips.length,
    ods: uniq(trips.flatMap(t => t.ods.map(o => o.od_number))).length,
    pallets: Math.round(pallets * 1000) / 1000,
    tons: Math.round(trips.reduce((s, t) => s + Number(t.tons ?? 0), 0) * 1000) / 1000,
    freight_total: freightTotal,
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
    if (error) throw error
  }
  return next
}
async function writeSummary(plan: PlanRow) {
  const full = await readPlan(plan.id)
  if (!full) return
  const { error } = await db.from('dispatch_plan').update({ summary: asJson(summarizeRows(plan, full.trips, full.pool)), updated_at: now() }).eq('id', plan.id)
  if (error) throw error
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

    const [condByCat, condition_labels] = await Promise.all([getStorageConditionByCategory(), loadConditionLabels()])
    // kế hoạch nháp CŨ của chính kho×ngày này sắp bị thay ⇒ OD của nó không tính là "đang nằm nháp khác"
    const { data: oldDrafts } = await db.from('dispatch_plan').select('id').eq('warehouse_id', wh.id).eq('plan_date', b.plan_date).eq('status', 'DRAFT')
    const { ods, meta, excluded } = await loadCandidates(wh, b.plan_date, condByCat, { skipPlanId: oldDrafts?.[0]?.id ?? null })
    const in_plan = excluded.filter(x => x.kind === 'IN_PLAN').map(x => ({ od_number: x.od_number, group_code: x.info ?? '' }))
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
      pallet_max_stops: b.pallet_max_stops ?? Math.max(1, Number(wh.dispatch_pallet_max_stops) || 1),
    }
    const result = runDispatch({ ods, ...refs, share_actual, condition_labels, params })

    // MỘT bản nháp mỗi kho×ngày: nháp cũ (kể cả người đã sửa) bị thay — người bấm "Lập kế hoạch" là chủ ý chạy lại
    const { error: delErr } = await db.from('dispatch_plan').delete().eq('warehouse_id', wh.id).eq('plan_date', b.plan_date).eq('status', 'DRAFT')
    if (delErr) throw delErr
    const t = now()
    const planId = randomUUID()
    const { error: pErr } = await db.from('dispatch_plan').insert({
      id: planId, warehouse_id: wh.id, plan_date: b.plan_date, status: 'DRAFT', engine_version: ENGINE_VERSION,
      params: asJson({
        ...params, pool_ods: ods.length, in_plan: in_plan.length, share_base: share_actual, share_targets: refs.share_targets, carriers: refs.carriers, wh_code: wh.code,
        backlog_days: BACKLOG_DAYS, late_ods: [...meta.values()].filter(m => m.late_days > 0).length, excluded,
        // mốc "máy lập" để dải chỉ số nói người sửa đã làm tốt hơn hay tệ hơn đề xuất
        baseline: { trips: result.summary.trips, freight_total: result.summary.freight_total, pallets: result.summary.pallets, underload: result.summary.underload, unpriced: result.summary.unpriced },
      }),
      summary: asJson(result.summary), unplanned: asJson(result.unplanned),
      created_by: req.user?.name ?? null, updated_at: t,
    })
    if (pErr) throw pErr
    const tripRows = result.trips.map(tr => ({
      id: randomUUID(), plan_id: planId, seq: tr.seq, group_code: tr.group_code,
      vehicle_model_id: tr.vehicle_model?.id ?? null, transport_company_id: tr.carrier?.id ?? null,
      stops: tr.stops, wards: tr.wards, pallets: tr.pallets, tons: tr.tons, load_pct: tr.load.pct, underload: tr.underload, oversize: tr.oversize,
      freight_estimated: tr.freight.total, detail: asJson(tripDetail(tr)), manual_edited: false, status: 'DRAFT', load_mode: tr.load_mode, updated_at: t,
    }))
    for (let i = 0; i < tripRows.length; i += CHUNK) {
      const { error } = await db.from('dispatch_trip').insert(tripRows.slice(i, i + CHUNK))
      if (error) throw error
    }
    await insertOdRows(result.trips.flatMap((tr, i) => tr.ods.map(o => odRow(planId, tripRows[i].id, o, meta.get(o.od_number), t))))
    const full = await readPlan(planId)
    if (full) await writeSummary(full as PlanRow)
    return ok(res, { ...(await readPlan(planId)), in_plan }, 201)
  } catch (e) { return failAny(res, e) }
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
  } catch (e) { return failAny(res, e) }
}
export async function getPlan(req: Request, res: Response) {
  try {
    const full = await readPlan(String(req.params.id))
    if (!full) return fail(res, 'Không tìm thấy kế hoạch', 404)
    if (!whAllowed(req, full.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const wh = (await db.from('Warehouse').select('id, code, name').eq('id', full.warehouse_id).maybeSingle()).data ?? null
    return ok(res, { ...full, warehouse: wh })
  } catch (e) { return failAny(res, e) }
}

// ── Sửa nháp: tính lại MỘT chuyến theo dòng xe/ĐVVT đang chọn (cùng `priceFor` của engine) ────────────
type TripErr = { err: [string, number, string?] }
const sendErr = (res: Response, e: TripErr) => (e.err[2] ? fail(res, e.err[1], e.err[2], e.err[0]) : fail(res, e.err[0], e.err[1]))
const TRIP_STATUS_VI: Record<TripStatus, string> = { DRAFT: 'nháp', TENDERED: 'đang chờ ĐVVT phản hồi', DECLINED: 'ĐVVT đã từ chối', CONFIRMED: 'đã vào Kế hoạch xuất', DISCARDED: 'đã bỏ' }

/** Chuyến + kế hoạch của nó, gác phạm vi kho. `editable` = kế hoạch còn mở (DRAFT/TENDERED) và chuyến DRAFT/DECLINED. */
async function loadTrip(req: Request, tripId: string, opts: { editable?: boolean; allow?: TripStatus[] } = {}): Promise<{ plan: PlanRow; trip: TripRow & { ods: TripOdRow[] } } | TripErr> {
  const { data: trip, error } = await db.from('dispatch_trip').select('*').eq('id', tripId).maybeSingle()
  if (error) throw error
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

function engineParams(plan: PlanRow): EngineInput['params'] {
  const params = (plan.params ?? {}) as { max_drops?: number; allow_mix_channels?: boolean; underload_pct?: number | null; code_prefix?: string; start_seq?: number; pallet_max_stops?: number }
  return { day: plan.plan_date, max_drops: params.max_drops ?? 3, allow_mix_channels: params.allow_mix_channels ?? false, underload_pct: params.underload_pct ?? null, code_prefix: params.code_prefix ?? '', start_seq: params.start_seq ?? 1, pallet_max_stops: params.pallet_max_stops ?? 1 }
}
/** Tính lại MỘT chuyến theo dòng xe/ĐVVT đang chọn và các OD ĐANG nằm trên xe — KHÔNG ghi (bàn ghép xe dùng để xem trước khi thả). */
function computeTripPatch(plan: PlanRow, trip: TripRow & { ods: TripOdRow[] }, modelId: string | null, carrierId: string | null, refs: Refs, whUnderloadPct: number | null, condLabels: Record<string, string> = {}) {
  const params = engineParams(plan)
  const ctx = buildCtx({ ods: [], ...refs, share_actual: {}, params })
  const model = modelId ? refs.models.find(m => m.id === modelId) ?? null : null
  const carrier = carrierId ? refs.carriers.find(c => c.id === carrierId) ?? null : null
  const lines = trip.ods.map(o => ({ material_code: '', qty_base: 0, pallets: o.pallets == null ? null : Number(o.pallets), kg: o.tons == null ? null : Number(o.tons) * 1000, category: null, condition: null }))
  const sum = trip.ods.length ? sumLines(lines) : { pallets: 0, tons: 0 }
  const wards = uniq(trip.ods.map(o => o.ward_code).filter((x): x is string => !!x))
  const stops = trip.ods.length ? Math.max(uniq(trip.ods.map(o => o.ship_to_code ?? o.od_number)).length, 1) : 0
  const prev = detailOf(trip)
  const tripMode = asMode(trip.load_mode)
  // Điều kiện bảo quản + cửa đặt lịch SUY TỪ OD đang trên xe (dòng mới mang sẵn) — chuyển OD mà hai thứ này đứng yên là
  // hàng lạnh lên xe thường không ai báo. Dòng cũ (kế hoạch lập trước 25/09) không có thì giữ bản chụp lúc máy lập.
  const fromOds = trip.ods.length > 0 && trip.ods.every(o => o.cat_load != null)
  const conds = fromOds ? uniq(trip.ods.flatMap(o => o.conditions ?? [])).sort() : (prev.conditions ?? []).filter(Boolean)
  const catLoads = trip.ods.map(o => (o.cat_load ?? {}) as Record<string, number>)
  const categories = fromOds ? uniq(catLoads.flatMap(m => Object.keys(m))).sort() : prev.categories
  const booking = fromOds ? bookingFromCatLoads(catLoads) : prev.booking_category
  const warnings: string[] = []
  let freight: TripFreight
  if (!trip.ods.length) freight = { total: null, base: null, billed_pallets: null, unit: null, tariff_id: null, ward: null, surcharges: [], reason: 'Xe trống' }
  else if (!model) freight = { total: null, base: null, billed_pallets: null, unit: null, tariff_id: null, ward: null, surcharges: [], reason: 'Chưa chọn dòng xe con' }
  else if (!carrier) freight = { total: null, base: null, billed_pallets: null, unit: model.tariff_unit, tariff_id: null, ward: null, surcharges: [], reason: 'Chưa chọn ĐVVT' }
  else freight = priceFor(ctx, model, carrier.id, wards, stops, sum.pallets, sum.tons)
  const load = tripLoad(model, sum.pallets, sum.tons, whUnderloadPct ?? params.underload_pct ?? null)
  // Vượt tải KHÔNG chặn (user chốt 25/09: "cho thả, đánh dấu đỏ") — xe vượt là việc Cần xử lý + hộp thoại Xác nhận nhắc lại
  if (model && load.pct != null && load.pct > 100) warnings.push(`Vượt sức chứa dòng xe ${model.name} (${load.pct}%)`)
  // Xe không có dòng xe mà IM LẶNG là lỗi đã gặp (Ba Vì 25/09: 2 xe kéo tay "chưa chọn dòng xe" không một cảnh báo nào)
  if (!model && trip.ods.length) warnings.push(`Chưa có dòng xe (xe đang chở ${sum.pallets ?? '?'} pallet / ${sum.tons ?? '?'} tấn) — bấm vào xe để chọn dòng xe, hoặc tách bớt OD`)
  // Luật 7: xe pallet đi tối đa `pallet_max_stops` khách (mặc định 1), xe xá theo số điểm giao của kho
  const kindLimit = stopsLimit(params, tripMode)
  const maxDrops = model?.max_drops != null ? Math.min(model.max_drops, kindLimit) : kindLimit
  if (trip.ods.length && stops > maxDrops) warnings.push(tripMode === 'PALLET' ? `Xe pallet đi ${stops} khách (tối đa ${maxDrops}) — tách xe, hoặc đổi xe này sang xe xá` : `Vượt số điểm giao (${stops} > ${maxDrops})`)
  const odOther = tripMode ? trip.ods.filter(o => asMode(o.load_mode) && asMode(o.load_mode) !== tripMode) : []
  if (odOther.length) warnings.push(`${uniq(odOther.map(o => o.od_number)).length} OD khách đi ${tripMode === 'PALLET' ? 'Xá' : 'Pallet'} đang nằm trên xe ${tripMode === 'PALLET' ? 'pallet' : 'xá'}`)
  if (model && tripMode && modeOfModel(model) !== tripMode) warnings.push(`Dòng xe ${model.name} là xe ${modeOfModel(model) === 'PALLET' ? 'pallet' : 'xá'} nhưng xe này đang đặt đi ${tripMode === 'PALLET' ? 'Pallet' : 'Xá'}`)
  // Người tự chọn dòng xe thì KHÔNG chặn (đây là bản nháp, người quyết) — nhưng phải nói ra khi xe không phục vụ đủ
  // điều kiện bảo quản của hàng trên xe, kẻo hàng lạnh lên xe thường mà màn hình im lặng.
  // Luật 8: dòng xe "chỉ trung chuyển" (container) chở OD giao khách ⇒ người tự chọn thì không chặn, nhưng nói ra
  const nonTransfer = trip.ods.filter(o => !o.is_transfer)
  if (model && !useOk(model, !nonTransfer.length) && trip.ods.length)
    warnings.push(`Dòng xe ${model.name} chỉ dùng trung chuyển giữa các kho — xe đang chở ${uniq(nonTransfer.map(o => o.od_number)).length} OD giao khách`)
  if (model && conds.length && !servesConditions(model, conds))
    warnings.push(`Dòng xe ${model.name} không phục vụ điều kiện bảo quản ${conds.map(c => condLabels[c] ?? c).join(' + ')}`)
  const detail: Detail = {
    ...prev, freight, load, warnings, merge_hint: null, conditions: conds, categories, booking_category: booking,
    // chỉ chuyển OD (ĐVVT giữ nguyên) thì lý do chọn ĐVVT của máy vẫn đúng; người đổi ĐVVT thì lý do là người
    carrier_reasons: carrier ? (carrier.id === trip.transport_company_id ? prev.carrier_reasons : ['Người điều vận chọn']) : [],
    vehicle_model: model ? { id: model.id, sap_code: model.sap_code, name: model.name, parent_type_name: model.parent_type_name } : null,
    carrier: carrier ? carrierRef(carrier) : null,
  }
  // chuyến ĐVVT đã từ chối mà người sửa lại ⇒ về nháp để chốt lại; ghi chú từ chối giữ nguyên trên dòng làm vết
  return {
    vehicle_model_id: model?.id ?? null, transport_company_id: carrier?.id ?? null, load_mode: tripMode,
    stops, wards, pallets: sum.pallets, tons: sum.tons, load_pct: load.pct, underload: load.pct != null && load.pct < load.underload_pct,
    oversize: load.pct != null && load.pct > 100, freight_estimated: freight.total, detail: asJson(detail), manual_edited: true,
    status: (statusOf(trip) === 'DECLINED' ? 'DRAFT' : statusOf(trip)) as TripStatus, updated_at: now(),
  }
}
async function repriceTrip(plan: PlanRow, trip: TripRow & { ods: TripOdRow[] }, modelId: string | null, carrierId: string | null, refs: Refs, whUnderloadPct: number | null, condLabels: Record<string, string> = {}) {
  const patch = computeTripPatch(plan, trip, modelId, carrierId, refs, whUnderloadPct, condLabels)
  const { error } = await db.from('dispatch_trip').update(patch).eq('id', trip.id)
  if (error) throw error
  return { ...trip, ...patch }
}

// ── PATCH /tms/dispatch/trips/:id ──────────────────────────────────────────────────────────────────────
export async function updateTrip(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zTripPatch>
    const got = await loadDraftTrip(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan, trip } = got
    if (b.locked !== undefined) {
      const { error } = await db.from('dispatch_trip').update({ locked: b.locked, updated_at: now() }).eq('id', trip.id)
      if (error) throw error
      // chỉ khoá / mở khoá ⇒ không đụng cước (khoá không đổi gì trên xe)
      if (b.vehicle_model_id === undefined && b.transport_company_id === undefined && b.load_mode === undefined) { await writeSummary(plan); return ok(res, { ...trip, locked: b.locked }) }
    }
    const wh = await loadWarehouse(plan.warehouse_id)
    const wards = uniq(trip.ods.map(o => o.ward_code).filter((x): x is string => !!x))
    const [refs, condLabels] = await Promise.all([loadRefs(plan.warehouse_id, plan.plan_date, wards), loadConditionLabels()])
    let modelId = b.vehicle_model_id === undefined ? trip.vehicle_model_id : b.vehicle_model_id
    let carrierId = b.transport_company_id === undefined ? trip.transport_company_id : b.transport_company_id
    if (b.load_mode && b.load_mode !== trip.load_mode) {
      // ĐỔI CẢ XE sang pallet / xá (user chốt 25/09: "bấm nút trên xe là xe đó thành xe xá"): mọi OD trên xe theo kiểu mới,
      // máy chọn lại dòng xe + ĐVVT đúng họ bằng ba bậc của lượt ghép (người vẫn đổi được sau đó)
      trip.load_mode = b.load_mode
      if (trip.ods.length) {
        const { error } = await db.from('dispatch_trip_od').update({ load_mode: b.load_mode, updated_at: now() }).eq('trip_id', trip.id)
        if (error) throw error
        trip.ods = trip.ods.map(o => ({ ...o, load_mode: b.load_mode! }))
      }
      if (b.vehicle_model_id === undefined) {
        const full = (await readPlan(plan.id))!
        const sug = suggestVehicle({ ods: [], ...refs, share_actual: {}, params: engineParams(plan) },
          trip.ods.map(o => ({ od: rowAsEngineOd(o), pallets: numOrNull(o.pallets), tons: numOrNull(o.tons), conditions: o.conditions ?? [] })), actualNow(plan, full.trips.filter(x => x.id !== trip.id)), b.load_mode)
        modelId = sug.model?.id ?? null
        if (b.transport_company_id === undefined) carrierId = sug.carrier?.id ?? null
      }
    }
    if (modelId && !refs.models.some(m => m.id === modelId)) return fail(res, 400, 'VEHICLE_MODEL_INVALID', 'Dòng xe con không tồn tại, đang ngừng dùng hoặc chưa gán dòng xe cha')
    if (carrierId && !refs.carriers.some(c => c.id === carrierId)) {
      // ĐVVT chưa có cước/phân tuyến ở kho này vẫn cho chọn (cước = null có lý do) — nhưng phải là ĐVVT thật
      const co = (await db.from('TransportCompany').select('id, code, name, tender_required').eq('id', carrierId).maybeSingle()).data
      if (!co) return fail(res, 400, 'CARRIER_INVALID', 'ĐVVT không tồn tại')
      refs.carriers.push(co as EngineCarrier)
    }
    const updated = await repriceTrip(plan, trip, modelId, carrierId, refs, numOrNull(wh?.dispatch_underload_pct), condLabels)
    await writeSummary(plan)
    return ok(res, updated)
  } catch (e) { return failAny(res, e) }
}

// ── GET /tms/dispatch/trips/:id/carriers — ĐVVT XẾP HẠNG theo cước cho ĐÚNG xe này ─────────────────────
// User 25/09: "việc đổi ĐVVT có thể đổi theo thẻ, có tiền trong đó (xếp theo rank)". Cùng `priceFor` với engine và với
// cửa PATCH trip ⇒ số tiền trên danh sách = số tiền xe nhận sau khi chọn. Tỷ trọng tính trên các xe KHÁC của kế hoạch
// (+ nền kỳ lúc lập) để người chọn thấy ĐVVT đó đang đứng ở đâu so với mục tiêu nếu KHÔNG tính xe này.
export async function tripCarriers(req: Request, res: Response) {
  try {
    const got = await loadTrip(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan, trip } = got
    const wards = uniq(trip.ods.map(o => o.ward_code).filter((x): x is string => !!x))
    const [refs, full] = await Promise.all([loadRefs(plan.warehouse_id, plan.plan_date, wards), readPlan(plan.id)])
    if (trip.transport_company_id && !refs.carriers.some(c => c.id === trip.transport_company_id)) {
      const co = (await db.from('TransportCompany').select('id, code, name, tender_required').eq('id', trip.transport_company_id).maybeSingle()).data
      if (co) refs.carriers.push(co as EngineCarrier)
    }
    const model = trip.vehicle_model_id ? refs.models.find(m => m.id === trip.vehicle_model_id) ?? null : null
    const ctx = buildCtx({ ods: [], ...refs, share_actual: {}, params: engineParams(plan) })
    const sum = trip.ods.length ? sumLines(trip.ods.map(o => ({ material_code: '', qty_base: 0, pallets: numOrNull(o.pallets), kg: o.tons == null ? null : Number(o.tons) * 1000, category: null, condition: null }))) : { pallets: 0, tons: 0 }
    const stops = trip.ods.length ? Math.max(uniq(trip.ods.map(o => o.ship_to_code ?? o.od_number)).length, 1) : 0
    const others = actualNow(plan, (full?.trips ?? []).filter(t => t.id !== trip.id))
    const totals: ShareActual = { trips: 0, pallets: 0, tons: 0 }
    for (const a of Object.values(others)) { totals.trips += a.trips; totals.pallets += a.pallets; totals.tons += a.tons }
    const region = trip.ods.find(o => o.region_code)?.region_code ?? null
    const allocOf = (cid: string): string | null => {
      const w = ctx.allocs.filter(a => a.transport_company_id === cid && a.area_kind === 'WARD' && wards.includes(a.area_code))
      if (w.length) return `phân tuyến phường (ưu tiên ${Math.min(...w.map(a => Number(a.priority)))})`
      const r = ctx.allocs.filter(a => a.transport_company_id === cid && a.area_kind === 'REGION' && a.area_code === region)
      return r.length ? `phân tuyến vùng ${region} (ưu tiên ${Math.min(...r.map(a => Number(a.priority)))})` : null
    }
    const items = refs.carriers.map(c => {
      const fr = model && trip.ods.length ? priceFor(ctx, model, c.id, wards, stops, sum.pallets, sum.tons) : null
      const t = refs.share_targets.find(s => s.transport_company_id === c.id)
      return {
        id: c.id, code: c.code, name: c.name, tender_required: c.tender_required === true, current: c.id === trip.transport_company_id,
        freight: fr?.total ?? null, reason: fr ? fr.reason : model ? 'Xe trống' : 'Chưa chọn dòng xe',
        share_pct: t ? sharePct(t.basis, others[c.id] ?? { trips: 0, pallets: 0, tons: 0 }, totals) : null,
        target_pct: t ? Number(t.share_pct) : null, alloc: allocOf(c.id),
      }
    }).sort((a, b) => (Number(a.freight == null) - Number(b.freight == null)) || ((a.freight ?? 0) - (b.freight ?? 0)) || a.code.localeCompare(b.code))
    return ok(res, { vehicle_model: model ? { id: model.id, name: model.name } : null, items })
  } catch (e) { return failAny(res, e) }
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
      if (error) throw error
    }
    const { error: mvErr } = await db.from('dispatch_trip_od').update({ trip_id: targetId, updated_at: t }).in('id', moving.map(o => o.id).slice(0, 300))
    if (mvErr) throw mvErr

    const wh = await loadWarehouse(plan.warehouse_id)
    const allWards = uniq([...src.ods.map(o => o.ward_code)].filter((x): x is string => !!x))
    const [refs, condLabels] = await Promise.all([loadRefs(plan.warehouse_id, plan.plan_date, allWards), loadConditionLabels()])
    // nguồn: còn OD thì tính lại, hết OD thì xoá chuyến
    const srcLeft = src.ods.filter(o => o.od_number !== b.od_number)
    if (srcLeft.length) await repriceTrip(plan, { ...src, ods: srcLeft }, src.vehicle_model_id, src.transport_company_id, refs, numOrNull(wh?.dispatch_underload_pct), condLabels)
    else { const { error } = await db.from('dispatch_trip').delete().eq('id', src.id); if (error) throw error }
    // đích
    const tgTrip = (await db.from('dispatch_trip').select('*').eq('id', targetId).maybeSingle()).data as TripRow | null
    if (tgTrip) {
      const tgOds = ((await db.from('dispatch_trip_od').select('*').eq('trip_id', targetId).order('od_number')).data ?? []) as TripOdRow[]
      const tgWards = uniq(tgOds.map(o => o.ward_code).filter((x): x is string => !!x))
      const refs2 = tgWards.every(w => allWards.includes(w)) ? refs : await loadRefs(plan.warehouse_id, plan.plan_date, uniq([...allWards, ...tgWards]))
      await repriceTrip(plan, { ...tgTrip, ods: tgOds }, tgTrip.vehicle_model_id, tgTrip.transport_company_id, refs2, numOrNull(wh?.dispatch_underload_pct), condLabels)
    }
    await writeSummary(plan)
    return ok(res, await readPlan(plan.id))
  } catch (e) { return failAny(res, e) }
}

// ══ BÀN GHÉP XE (25/09) — kéo thả OD giữa khung chờ / các xe / xe mới; tối ưu lại phần chưa khoá; OD mới về; OD bị thay ══
type PlanTrip = TripRow & { ods: TripOdRow[] }
async function loadOpenPlan(req: Request, planId: string): Promise<{ plan: PlanRow } | TripErr> {
  const { data: plan, error } = await db.from('dispatch_plan').select('*').eq('id', planId).maybeSingle()
  if (error) throw error
  if (!plan) return { err: ['Không tìm thấy kế hoạch', 404] }
  if (!whAllowed(req, plan.warehouse_id)) return { err: ['Kho này ngoài phạm vi được giao', 403] }
  if (!OPEN_PLAN.includes(plan.status)) return { err: ['Kế hoạch đã xác nhận / đã bỏ — không sửa được bản nháp', 409, 'PLAN_NOT_DRAFT'] }
  return { plan: plan as PlanRow }
}
/** Tính lại (và ghi) các chuyến bị đụng — MỘT lần nạp bảng cước cho hợp các phường. */
async function repriceMany(plan: PlanRow, trips: PlanTrip[]) {
  if (!trips.length) return
  const wh = await loadWarehouse(plan.warehouse_id)
  const wards = uniq(trips.flatMap(t => t.ods.map(o => o.ward_code)).filter((x): x is string => !!x))
  const [refs, condLabels] = await Promise.all([loadRefs(plan.warehouse_id, plan.plan_date, wards), loadConditionLabels()])
  await Promise.all(trips.map(t => repriceTrip(plan, t, t.vehicle_model_id, t.transport_company_id, refs, numOrNull(wh?.dispatch_underload_pct), condLabels)))
}
/** Tỷ trọng HIỆN TẠI của kế hoạch = nền kỳ lúc lập + các xe đang có (để xe mới do máy chọn ĐVVT vẫn nhìn tỷ trọng). */
function actualNow(plan: PlanRow, trips: PlanTrip[]): Record<string, ShareActual> {
  const base = ((plan.params ?? {}) as { share_base?: Record<string, ShareActual> }).share_base ?? {}
  const out: Record<string, ShareActual> = {}
  for (const [k, v] of Object.entries(base)) out[k] = { ...v }
  for (const t of trips) {
    if (!t.transport_company_id || !t.ods.length || statusOf(t) === 'DISCARDED') continue
    const a = out[t.transport_company_id] ?? { trips: 0, pallets: 0, tons: 0 }
    a.trips += 1; a.pallets += Number(t.pallets ?? 0); a.tons += Number(t.tons ?? 0)
    out[t.transport_company_id] = a
  }
  return out
}
// flow 'STO' khi dòng OD mang cờ trung chuyển — chỉ để `isTransferOd` của luật 8 đọc đúng (dòng không còn phân loại SAP gốc)
const rowAsEngineOd = (o: TripOdRow): EngineOd => ({ od_number: o.od_number, ship_to_code: o.ship_to_code, ship_to_name: o.ship_to_name, ward_code: o.ward_code, region_code: o.region_code ?? null, channel: null, internal_wh: null, scan_mode: false, flow: o.is_transfer ? 'STO' : 'SALE', lines: [], load_mode: asMode(o.load_mode) ?? undefined })
/** Kiểu đi chiếm đa số trong một nhóm dòng OD (hoà ⇒ Xá — kiểu mặc định của khách chưa khai). */
const majorityMode = (rows: TripOdRow[]): LoadMode | null => {
  const p = rows.filter(o => asMode(o.load_mode) === 'PALLET').length, l = rows.filter(o => asMode(o.load_mode) === 'LOOSE').length
  return p + l === 0 ? null : p > l ? 'PALLET' : 'LOOSE'
}
/** Xe còn OD mà CHƯA có dòng xe ⇒ máy chọn (ba bậc, đúng họ pallet/xá) trước khi tính lại — sửa trên object, repriceTrip ghi. */
async function fillMissingVehicles(plan: PlanRow, trips: PlanTrip[], all: PlanTrip[]) {
  const need = trips.filter(t => t.ods.length && !t.vehicle_model_id)
  if (!need.length) return
  const wards = uniq(need.flatMap(t => t.ods.map(o => o.ward_code)).filter((x): x is string => !!x))
  const refs = await loadRefs(plan.warehouse_id, plan.plan_date, wards)
  for (const t of need) {
    const mode = asMode(t.load_mode) ?? majorityMode(t.ods)
    const sug = suggestVehicle({ ods: [], ...refs, share_actual: {}, params: engineParams(plan) },
      t.ods.map(o => ({ od: rowAsEngineOd(o), pallets: numOrNull(o.pallets), tons: numOrNull(o.tons), conditions: o.conditions ?? [] })), actualNow(plan, all), mode)
    t.vehicle_model_id = sug.model?.id ?? null
    t.transport_company_id = t.transport_company_id ?? sug.carrier?.id ?? null
    t.load_mode = mode
  }
}

// POST /tms/dispatch/plans/:id/move — thả OD (một hay nhiều dòng) vào xe · xe mới · khung chờ · bỏ khỏi kế hoạch
export async function moveOds(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zMove>
    const got = await loadOpenPlan(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    const full = (await readPlan(plan.id))!
    const all = [...full.trips.flatMap(t => t.ods), ...full.pool]
    const ids = uniq(b.ids)
    const rows = all.filter(o => ids.includes(o.id))
    if (rows.length !== ids.length) return fail(res, 'Có dòng OD không thuộc kế hoạch này (có thể vừa bị người khác chuyển — tải lại trang)', 404)
    const tripBy = new Map(full.trips.map(t => [t.id, t]))
    for (const o of rows) {
      const src = o.trip_id ? tripBy.get(o.trip_id) : null
      if (src && !EDITABLE_TRIP.includes(statusOf(src))) return fail(res, 409, 'TRIP_NOT_EDITABLE', `Xe ${src.group_code} ${TRIP_STATUS_VI[statusOf(src)]} — không kéo OD ra khỏi xe này ở đây.`)
    }
    const t = now()
    let targetId: string | null = null
    if (b.to === 'trip') {
      const tg = b.to_trip_id ? tripBy.get(b.to_trip_id) : undefined
      if (!tg) return fail(res, 'Xe đích không thuộc kế hoạch này', 400)
      if (!EDITABLE_TRIP.includes(statusOf(tg))) return fail(res, 409, 'TRIP_NOT_EDITABLE', `Xe đích ${tg.group_code} ${TRIP_STATUS_VI[statusOf(tg)]} — không nhận thêm OD ở đây; đổi ở tab Kế hoạch xuất.`)
      targetId = tg.id
    } else if (b.to === 'new') {
      // xe mới: máy chọn dòng xe + ĐVVT theo đúng ba bậc của lượt ghép (người vẫn đổi được)
      const wards = uniq(rows.map(o => o.ward_code).filter((x): x is string => !!x))
      const refs = await loadRefs(plan.warehouse_id, plan.plan_date, wards)
      const mode = majorityMode(rows)
      const sug = suggestVehicle({ ods: [], ...refs, share_actual: {}, params: engineParams(plan) },
        rows.map(o => ({ od: rowAsEngineOd(o), pallets: numOrNull(o.pallets), tons: numOrNull(o.tons), conditions: o.conditions ?? [] })), actualNow(plan, full.trips), mode)
      const seq = Math.max(0, ...full.trips.map(x => x.seq)) + 1
      targetId = randomUUID()
      const { error } = await db.from('dispatch_trip').insert({
        id: targetId, plan_id: plan.id, seq, group_code: `${engineParams(plan).code_prefix}${seq}`, load_mode: mode,
        vehicle_model_id: sug.model?.id ?? null, transport_company_id: sug.carrier?.id ?? null, stops: 0, wards: [],
        detail: asJson({ freight: sug.freight, load: tripLoad(sug.model, 0, 0, null), categories: [], conditions: [], booking_category: null, cluster: 'MANUAL',
          carrier_reasons: sug.reasons, warnings: sug.warnings, merge_hint: null,
          vehicle_model: sug.model ? { id: sug.model.id, sap_code: sug.model.sap_code, name: sug.model.name, parent_type_name: sug.model.parent_type_name } : null,
          carrier: sug.carrier ? carrierRef(sug.carrier) : null }),
        manual_edited: true, status: 'DRAFT', updated_at: t,
      })
      if (error) throw error
    }
    if (b.to === 'remove') {
      const { error } = await db.from('dispatch_trip_od').delete().in('id', ids.slice(0, 300)).eq('plan_id', plan.id)
      if (error) throw error
    } else {
      const { error } = await db.from('dispatch_trip_od').update({ trip_id: targetId, updated_at: t }).in('id', ids.slice(0, 300)).eq('plan_id', plan.id)
      if (error) throw error
    }
    // XE TRỐNG KHÔNG TỰ BIẾN MẤT — để Hoàn tác thả lại được đúng xe cũ; người bỏ bằng nút ✕ trên thẻ xe
    const touched = uniq([...rows.map(o => o.trip_id).filter((x): x is string => !!x), ...(targetId ? [targetId] : [])])
    const after = (await readPlan(plan.id))!
    const hit = after.trips.filter(x => touched.includes(x.id))
    await fillMissingVehicles(plan, hit, after.trips)
    await repriceMany(plan, hit)
    await writeSummary(plan)
    return ok(res, await readPlan(plan.id))
  } catch (e) { return failAny(res, e) }
}

// PATCH /tms/dispatch/plans/:id/ods — đổi kiểu đi (Pallet / Xá) của các dòng OD trên nháp (user chốt 25/09: "switch được trên đơn")
export const zOdMode = z.object({ ids: z.array(zId).min(1).max(300), load_mode: z.enum(['PALLET', 'LOOSE']) })
export async function setOdMode(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zOdMode>
    const got = await loadOpenPlan(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    const full = (await readPlan(plan.id))!
    const ids = uniq(b.ids)
    const rows = [...full.trips.flatMap(t => t.ods), ...full.pool].filter(o => ids.includes(o.id))
    if (rows.length !== ids.length) return fail(res, 'Có dòng OD không thuộc kế hoạch này (tải lại trang)', 404)
    const tripBy = new Map(full.trips.map(t => [t.id, t]))
    const locked = rows.map(o => (o.trip_id ? tripBy.get(o.trip_id) : null)).find(t => t && !EDITABLE_TRIP.includes(statusOf(t)))
    if (locked) return fail(res, 409, 'TRIP_NOT_EDITABLE', `Xe ${locked.group_code} ${TRIP_STATUS_VI[statusOf(locked)]} — không đổi kiểu đi ở đây.`)
    const { error } = await db.from('dispatch_trip_od').update({ load_mode: b.load_mode, updated_at: now() }).in('id', ids.slice(0, 300)).eq('plan_id', plan.id)
    if (error) throw error
    // OD vẫn ở nguyên xe — xe tính lại để cảnh báo "OD khách Xá trên xe pallet" hiện ra; muốn đổi cả xe thì dùng nút trên thẻ xe
    const touched = uniq(rows.map(o => o.trip_id).filter((x): x is string => !!x))
    const after = (await readPlan(plan.id))!
    await repriceMany(plan, after.trips.filter(x => touched.includes(x.id)))
    await writeSummary(plan)
    return ok(res, await readPlan(plan.id))
  } catch (e) { return failAny(res, e) }
}

// POST /tms/dispatch/plans/:id/preview-move — xem trước khi thả: xe đích SAU khi nhận các dòng OD này (không ghi gì)
export async function previewMove(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zPreview>
    const got = await loadOpenPlan(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    const full = (await readPlan(plan.id))!
    const tg = full.trips.find(x => x.id === b.to_trip_id)
    if (!tg) return fail(res, 'Xe đích không thuộc kế hoạch này', 400)
    const moving = [...full.trips.flatMap(x => x.ods), ...full.pool].filter(o => b.ids.includes(o.id) && o.trip_id !== tg.id)
    const next = { ...tg, ods: [...tg.ods, ...moving] }
    const wh = await loadWarehouse(plan.warehouse_id)
    const wards = uniq(next.ods.map(o => o.ward_code).filter((x): x is string => !!x))
    const [refs, condLabels] = await Promise.all([loadRefs(plan.warehouse_id, plan.plan_date, wards), loadConditionLabels()])
    const p = computeTripPatch(plan, next, tg.vehicle_model_id, tg.transport_company_id, refs, numOrNull(wh?.dispatch_underload_pct), condLabels)
    const d = p.detail as unknown as Detail
    return ok(res, {
      trip_id: tg.id, pallets: p.pallets, tons: p.tons, stops: p.stops, load_pct: p.load_pct, underload: p.underload, oversize: p.oversize,
      freight_estimated: p.freight_estimated, freight_before: tg.freight_estimated, freight_reason: d.freight.reason, warnings: d.warnings,
    })
  } catch (e) { return failAny(res, e) }
}

// DELETE /tms/dispatch/trips/:id — bỏ một XE TRỐNG khỏi nháp (xe còn OD thì phải kéo OD ra trước)
export async function deleteTrip(req: Request, res: Response) {
  try {
    const got = await loadDraftTrip(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    if (got.trip.ods.length) return fail(res, 409, 'TRIP_NOT_EMPTY', `Xe ${got.trip.group_code} còn ${uniq(got.trip.ods.map(o => o.od_number)).length} OD — kéo OD sang xe khác hoặc về khung chờ trước khi bỏ xe.`)
    const { error } = await db.from('dispatch_trip').delete().eq('id', got.trip.id)
    if (error) throw error
    await writeSummary(got.plan)
    return ok(res, { id: got.trip.id, deleted: true })
  } catch (e) { return failAny(res, e) }
}

// POST /tms/dispatch/plans/:id/reoptimize — chạy lại máy ghép cho khung chờ + các xe CHƯA KHOÁ (xe khoá / đã chào / đã vào KH xuất giữ nguyên)
export async function reoptimizePlan(req: Request, res: Response) {
  try {
    const got = await loadOpenPlan(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    const wh = await loadWarehouse(plan.warehouse_id)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    const full = (await readPlan(plan.id))!
    const redo = full.trips.filter(t => !t.locked && EDITABLE_TRIP.includes(statusOf(t)))
    const keep = full.trips.filter(t => !redo.includes(t))
    const odNos = uniq([...redo.flatMap(t => t.ods), ...full.pool].map(o => o.od_number))
    if (!odNos.length) return fail(res, 422, 'NOTHING_TO_OPTIMIZE', 'Không còn OD nào ngoài các xe đã khoá — mở khoá xe hoặc kéo OD về khung chờ trước.')
    const condByCat = await getStorageConditionByCategory()
    const cand = await loadCandidates(wh, plan.plan_date, condByCat, { onlyOds: odNos, skipPlanId: plan.id })
    // kiểu đi người ĐÃ ĐỔI trên nháp (OD / cả xe) thắng kiểu theo danh mục khách — tối ưu lại không được xoá lựa chọn đó
    const modeBy = new Map([...redo.flatMap(t => t.ods), ...full.pool].map(o => [o.od_number, asMode(o.load_mode)] as const))
    for (const o of cand.ods) o.load_mode = modeBy.get(o.od_number) ?? o.load_mode
    const wards = uniq(cand.ods.map(o => o.ward_code).filter((x): x is string => !!x))
    const [refs, condition_labels] = await Promise.all([loadRefs(wh.id, plan.plan_date, wards), loadConditionLabels()])
    const startSeq = Math.max(0, ...full.trips.map(x => x.seq)) + 1
    const result = runDispatch({ ods: cand.ods, ...refs, share_actual: actualNow(plan, keep), condition_labels, params: { ...engineParams(plan), start_seq: startSeq } })
    const t = now()
    // OD của xe bị làm lại về khung chờ trước, rồi mới xoá xe — OD máy không xếp được (hoặc đã bị SAP điều/thay) nằm lại khung chờ
    const redoIds = redo.map(x => x.id)
    for (let i = 0; i < redoIds.length; i += 300) {
      const { error } = await db.from('dispatch_trip_od').update({ trip_id: null, updated_at: t }).in('trip_id', redoIds.slice(i, i + 300))
      if (error) throw error
    }
    for (let i = 0; i < redoIds.length; i += 300) {
      const { error } = await db.from('dispatch_trip').delete().in('id', redoIds.slice(i, i + 300))
      if (error) throw error
    }
    const placed = uniq(result.trips.flatMap(tr => tr.ods.map(o => o.od_number)))
    for (let i = 0; i < placed.length; i += 300) {
      const { error } = await db.from('dispatch_trip_od').delete().eq('plan_id', plan.id).is('trip_id', null).in('od_number', placed.slice(i, i + 300))
      if (error) throw error
    }
    const tripRows = result.trips.map(tr => ({
      id: randomUUID(), plan_id: plan.id, seq: tr.seq, group_code: tr.group_code,
      vehicle_model_id: tr.vehicle_model?.id ?? null, transport_company_id: tr.carrier?.id ?? null,
      stops: tr.stops, wards: tr.wards, pallets: tr.pallets, tons: tr.tons, load_pct: tr.load.pct, underload: tr.underload, oversize: tr.oversize,
      freight_estimated: tr.freight.total, detail: asJson(tripDetail(tr)), manual_edited: false, status: 'DRAFT', load_mode: tr.load_mode, updated_at: t,
    }))
    for (let i = 0; i < tripRows.length; i += CHUNK) {
      const { error } = await db.from('dispatch_trip').insert(tripRows.slice(i, i + CHUNK))
      if (error) throw error
    }
    await insertOdRows(result.trips.flatMap((tr, i) => tr.ods.map(o => odRow(plan.id, tripRows[i].id, o, cand.meta.get(o.od_number), t))))
    await writeSummary(plan)
    return ok(res, { ...(await readPlan(plan.id)), reoptimized: { trips: result.trips.length, kept: keep.length, left_in_pool: odNos.length - placed.length } })
  } catch (e) { return failAny(res, e) }
}

/** Tình trạng SỐNG của các OD trong kế hoạch so với ZSD02 hiện tại — cờ "cần xử lý" phát sinh SAU khi lập:
 *  SAP đã thay OD (sửa SO) · SAP đã bỏ OD · đã xuất kho · SAP đã điều cho ĐVVT khác · đã có người đưa vào Kế hoạch xuất. */
type OdFlag = { od_number: string; kind: 'REPLACED' | 'GONE' | 'SHIPPED' | 'SAP_ASSIGNED' | 'IN_PLAN'; info: string | null; replaced_by?: string | null }
async function odFlags(odNos: string[], ownGroupCodes: string[]): Promise<OdFlag[]> {
  if (!odNos.length) return []
  const [rows, khvc] = await Promise.all([
    fetchAllByIdChunks(odNos, c => db.from('erp_outbound_orders').select('od_number, sync_status, replaced_by_od, sap_dispatch_status, mat_doc, qty_issued_base, dvvt_raw, license_plate').in('od_number', c).order('od_number')) as Promise<{ od_number: string; sync_status: string | null; replaced_by_od: string | null; sap_dispatch_status: string | null; mat_doc: string | null; qty_issued_base: number | string | null; dvvt_raw: string | null; license_plate: string | null }[]>,
    fetchAllByIdChunks(odNos, c => db.from('khvc_lines').select('do_no, group_code').in('do_no', c).neq('sync_status', 'OBSOLETE').order('do_no')) as Promise<{ do_no: string; group_code: string }[]>,
  ])
  const by = new Map<string, typeof rows>()
  for (const r of rows) { const l = by.get(r.od_number) ?? []; l.push(r); by.set(r.od_number, l) }
  const out: OdFlag[] = []
  for (const od of odNos) {
    const rs = by.get(od) ?? []
    const live = rs.filter(r => r.sync_status !== 'OBSOLETE')
    if (!live.length) {
      const rep = rs.find(r => r.replaced_by_od)?.replaced_by_od ?? null
      out.push(rep ? { od_number: od, kind: 'REPLACED', info: `SAP thay bằng ${rep}`, replaced_by: rep } : { od_number: od, kind: 'GONE', info: 'SAP đã bỏ OD này' })
      continue
    }
    const k = khvc.find(x => x.do_no === od && !ownGroupCodes.includes(x.group_code))
    if (k) { out.push({ od_number: od, kind: 'IN_PLAN', info: `đã có trong Kế hoạch xuất (${k.group_code})` }); continue }
    const sh = live.find(r => (r.mat_doc && String(r.mat_doc).trim()) || Number(r.qty_issued_base ?? 0) > 0)
    if (sh) { out.push({ od_number: od, kind: 'SHIPPED', info: `đã xuất kho${sh.mat_doc ? ` (${sh.mat_doc})` : ''}` }); continue }
    const as = live.find(r => r.sap_dispatch_status === 'ASSIGNED')
    if (as) out.push({ od_number: od, kind: 'SAP_ASSIGNED', info: `SAP đã điều: ${[as.dvvt_raw, as.license_plate].filter(Boolean).join(' · ') || 'đã điều phối'}` })
  }
  return out
}

// GET /tms/dispatch/plans/:id/sync — cờ sống của OD trong kế hoạch + số OD MỚI (ZSD02 vừa nạp) chưa có trong kế hoạch
export async function planSync(req: Request, res: Response) {
  try {
    const full = await readPlan(String(req.params.id))
    if (!full) return fail(res, 'Không tìm thấy kế hoạch', 404)
    if (!whAllowed(req, full.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    if (!OPEN_PLAN.includes(full.status)) return ok(res, { flags: [], new_ods: 0 })
    const live = full.trips.filter(t => EDITABLE_TRIP.includes(statusOf(t)) || statusOf(t) === 'TENDERED')
    const odNos = uniq([...live.flatMap(t => t.ods), ...full.pool].map(o => o.od_number))
    const wh = await loadWarehouse(full.warehouse_id)
    const [flags, cand] = await Promise.all([
      odFlags(odNos, full.trips.filter(t => statusOf(t) === 'CONFIRMED').map(t => t.group_code)),
      wh ? loadCandidates(wh, full.plan_date, new Map(), { skipPlanId: full.id, countOnly: true }) : Promise.resolve(null),
    ])
    const inPlan = new Set([...full.trips.flatMap(t => t.ods), ...full.pool].map(o => o.od_number))
    for (const u of (full.unplanned ?? []) as { od_number?: string }[]) if (u?.od_number) inPlan.add(u.od_number)   // máy đã thấy, không đo được tải
    const fresh = (cand?.include ?? []).filter(od => !inPlan.has(od))
    return ok(res, { flags, new_ods: fresh.length, new_od_numbers: fresh.slice(0, 50) })
  } catch (e) { return failAny(res, e) }
}

// POST /tms/dispatch/plans/:id/refresh-pool — nạp OD mới (ZSD02 vừa về, lũy tiến) vào KHUNG CHỜ của kế hoạch
export async function refreshPool(req: Request, res: Response) {
  try {
    const got = await loadOpenPlan(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    const wh = await loadWarehouse(plan.warehouse_id)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    const full = (await readPlan(plan.id))!
    const inPlan = new Set([...full.trips.flatMap(t => t.ods), ...full.pool].map(o => o.od_number))
    const cand = await loadCandidates(wh, plan.plan_date, await getStorageConditionByCategory(), { skipPlanId: plan.id })
    const fresh = cand.ods.filter(o => !inPlan.has(o.od_number))
    const loadable = fresh.filter(o => LOADABLE_FLOW.has(o.flow) && o.lines.length)
    const t = now()
    await insertOdRows(loadable.map(o => odRow(plan.id, null, wholeOd(o), cand.meta.get(o.od_number), t)))
    const params = { ...((plan.params ?? {}) as Record<string, unknown>), excluded: cand.excluded }
    const { error } = await db.from('dispatch_plan').update({ params: asJson(params), updated_at: t }).eq('id', plan.id)
    if (error) throw error
    await writeSummary({ ...plan, params: asJson(params) })
    return ok(res, { ...(await readPlan(plan.id)), refreshed: { added: loadable.length, skipped_not_loadable: fresh.length - loadable.length } })
  } catch (e) { return failAny(res, e) }
}

// POST /tms/dispatch/plans/:id/replace-od — OD cũ bị SAP thay (sửa SO) ⇒ đưa OD MỚI vào đúng chỗ của OD cũ (xe hoặc khung chờ)
export async function replaceOd(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zReplaceOd>
    const got = await loadOpenPlan(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    const wh = await loadWarehouse(plan.warehouse_id)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    const full = (await readPlan(plan.id))!
    const all = [...full.trips.flatMap(t => t.ods), ...full.pool]
    const olds = all.filter(o => o.od_number === b.od_number)
    if (!olds.length) return fail(res, 'OD không nằm trong kế hoạch này', 404)
    const tripId = olds[0].trip_id
    const tr = tripId ? full.trips.find(x => x.id === tripId) : null
    if (tr && !EDITABLE_TRIP.includes(statusOf(tr))) return fail(res, 409, 'TRIP_NOT_EDITABLE', `Xe ${tr.group_code} ${TRIP_STATUS_VI[statusOf(tr)]} — không thay OD ở đây.`)
    const { data: repRow } = await db.from('erp_outbound_orders').select('replaced_by_od').eq('od_number', b.od_number).not('replaced_by_od', 'is', null).limit(1).maybeSingle()
    const newOd = repRow?.replaced_by_od ?? null
    if (!newOd) return fail(res, 422, 'NOT_REPLACED', `OD ${b.od_number} chưa được SAP thay bằng OD nào (ZSD02 chưa có OD mới cho dòng SO này).`)
    const elsewhere = all.filter(o => o.od_number === newOd && o.trip_id && o.trip_id !== tripId)
    if (elsewhere.length) return fail(res, 409, 'NEW_OD_ON_OTHER_TRIP', `OD mới ${newOd} đang nằm ở xe ${full.trips.find(x => x.id === elsewhere[0].trip_id)?.group_code ?? '?'} — kéo về một xe trước.`)
    const t = now()
    const poolNew = all.filter(o => o.od_number === newOd && !o.trip_id)
    if (poolNew.length) {
      const { error } = await db.from('dispatch_trip_od').update({ trip_id: tripId, updated_at: t }).in('id', poolNew.map(o => o.id).slice(0, 300))
      if (error) throw error
    } else if (!all.some(o => o.od_number === newOd)) {
      const cand = await loadCandidates(wh, plan.plan_date, await getStorageConditionByCategory(), { onlyOds: [newOd], skipPlanId: plan.id })
      const od = cand.ods.find(o => o.od_number === newOd)
      if (!od) {
        const ex = cand.excluded.find(x => x.od_number === newOd)
        return fail(res, 409, 'NEW_OD_NOT_AVAILABLE', `OD mới ${newOd} không đưa vào được${ex ? ` — ${ex.kind === 'SAP_ASSIGNED' ? 'SAP đã điều' : ex.kind === 'SHIPPED' ? 'đã xuất kho' : ex.kind === 'IN_PLAN' ? 'đã có trong Kế hoạch xuất' : 'đang nằm ở nháp khác'}${ex.info ? ` (${ex.info})` : ''}` : ' (chưa có trong ZSD02 hoặc không thuộc kho này)'}.`)
      }
      await insertOdRows([odRow(plan.id, tripId, wholeOd(od), cand.meta.get(newOd), t)])
    }
    const { error } = await db.from('dispatch_trip_od').delete().in('id', olds.map(o => o.id).slice(0, 300))
    if (error) throw error
    const after = (await readPlan(plan.id))!
    await repriceMany(plan, after.trips.filter(x => x.id === tripId))
    await writeSummary(plan)
    return ok(res, { ...(await readPlan(plan.id)), replaced: { from: b.od_number, to: newOd } })
  } catch (e) { return failAny(res, e) }
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
  // OD đổi tình trạng ở SAP SAU khi lập nháp (25/09 — pool lũy tiến): ghi vào Kế hoạch xuất lúc này là một đơn đi hai lần
  // (SAP đã điều / đã xuất) hoặc một chuyến trỏ tới OD không còn (SAP thay / bỏ). Bàn ghép xe hiện cờ + nút xử lý.
  const bad = (await odFlags(subOds, [])).filter(f => f.kind !== 'IN_PLAN')
  if (bad.length) {
    const odOf = new Map(subset.flatMap(t => t.ods.map(o => [o.od_number, t.group_code] as const)))
    return { err: [`${bad.length} OD đổi tình trạng ở SAP từ lúc lập nháp — ${bad.slice(0, 5).map(f => `${f.od_number} (${odOf.get(f.od_number) ?? '?'}): ${f.info}`).join('; ')}${bad.length > 5 ? '…' : ''}. Thay / gỡ các OD này trên bàn ghép xe rồi xác nhận lại.`, 409, 'OD_CHANGED_IN_SAP'] }
  }
  const noCat = subset.filter(t => !detailOf(t).booking_category)
  if (noCat.length) return { err: [`${noCat.length} xe không xác định được Loại kho booking (mã hàng chưa khai loại): ${noCat.slice(0, 5).map(t => t.group_code).join(', ')}`, 422, 'BOOKING_CATEGORY_REQUIRED'] }
  const taken = (await fetchAllByIdChunks(subOds, c => db.from('khvc_lines').select('do_no, group_code').in('do_no', c).neq('sync_status', 'OBSOLETE').order('do_no'))) as { do_no: string; group_code: string }[]
  if (taken.length) return { err: [`${uniq(taken.map(x => x.do_no)).length} OD đã có trong Kế hoạch xuất từ lúc lập nháp (${taken.slice(0, 5).map(x => `${x.do_no} → ${x.group_code}`).join('; ')}) — lập lại kế hoạch để loại các OD đó.`, 409, 'OD_ALREADY_PLANNED'] }
  const gcs = subset.map(t => t.group_code)
  const usedGc = (await fetchAllByIdChunks(gcs, c => db.from('khvc_lines').select('group_code').in('group_code', c).neq('sync_status', 'OBSOLETE').order('group_code'))) as { group_code: string }[]
  if (usedGc.length) return { err: [`Số xe ${uniq(usedGc.map(x => x.group_code)).slice(0, 5).join(', ')} đã có trong Kế hoạch xuất — lập lại kế hoạch để lấy STT mới.`, 409, 'GROUP_CODE_TAKEN'] }
  // MÃ HÀNG PHẢI CÓ TRONG DANH MỤC — chặn TẠI ĐÂY thay vì để đường derive từ chối sau khi đã ghi.
  // Vì sao (đo 24/09): 5 % dòng OD của SAP trỏ tới mã chưa đồng bộ sang WMS (4 mã: 810000020 ·
  // 510000442 · 510000444 · 510000440 ⇒ 47 OD Ba Vì + 19 OD Bàu Bàng). Đường `replanKhvcGroups`
  // → derive validate mã hàng và từ chối TRỌN GÓI ("18 chuyến xe lỗi — không upload"), nên xác nhận
  // 50 xe xong ra **0 chuyến** trong khi API vẫn trả 200. Chặn trước khi ghi thì không có trạng thái
  // nửa vời (kế hoạch đã vào sổ mà không chuyến nào), và người dùng biết ĐÍCH DANH mã phải khai.
  const odMats = (await fetchAllByIdChunks(subOds, c => db.from('erp_outbound_orders')
    .select('od_number, material_code').in('od_number', c).eq('sync_status', 'ACTIVE').order('od_number'))) as { od_number: string; material_code: string | null }[]
  const wantMats = uniq(odMats.map(r => r.material_code).filter((x): x is string => !!x))
  if (wantMats.length) {
    const haveMats = new Set(((await fetchAllByIdChunks(wantMats, c => db.from('Material')
      .select('material_code').in('material_code', c).order('material_code'))) as { material_code: string }[]).map(m => m.material_code))
    const missing = wantMats.filter(m => !haveMats.has(m))
    if (missing.length) {
      const odOf = new Map(subset.flatMap(t => t.ods.map(o => [o.od_number, t.group_code] as const)))
      const hitGc = uniq(odMats.filter(r => r.material_code && missing.includes(r.material_code)).map(r => odOf.get(r.od_number)).filter((x): x is string => !!x))
      return { err: [`${missing.length} mã hàng chưa có trong danh mục Mã hàng: ${missing.slice(0, 6).join(', ')} — ${hitGc.length} xe vướng (${hitGc.slice(0, 4).join(', ')}). Khai mã ở Cài đặt → Mã hàng rồi xác nhận lại; nếu không, kế hoạch ghi vào sổ mà KHÔNG sinh được chuyến nào.`, 422, 'MATERIAL_UNKNOWN'] }
    }
  }
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
    if (error) throw error
  }
  const gcs = trips.map(x => x.group_code)
  const { error } = await db.from('dispatch_trip').update({ status: 'CONFIRMED', confirmed_at: t, updated_at: t }).in('id', trips.map(x => x.id).slice(0, 300))
  if (error) throw error
  let replan: Record<string, unknown> | null = null, replan_error: string | null = null
  try { replan = await replanKhvcGroups(req, gcs) } catch (e) { replan_error = String(e); console.error('[dispatch confirm] replan:', e) }
  // KHÔNG ĐƯỢC BÁO THÀNH CÔNG KHI CHUYẾN KHÔNG SINH RA. `replanKhvcGroups` không NÉM lỗi khi đường
  // derive từ chối — nó trả về một object lồng `{derive:{success:false,…}}` mà trước nay không ai đọc,
  // nên API trả 200 kèm `replan_error: null` trong khi thực tế 0/50 chuyến được tạo (đo 24/09).
  // Đây là lớp C5 "trả 200 im lặng". Gác `tripGuards` ở trên chặn ca thường gặp (mã hàng lạ);
  // chỗ này bắt MỌI lý do từ chối còn lại để màn hình còn nói được.
  const derive = (replan as { derive?: { success?: boolean; error?: { message?: string } } } | null)?.derive
  const derive_failed = !!derive && derive.success === false
  const derive_message = derive_failed
    ? String(derive.error?.message ?? 'đường sinh chuyến từ chối kế hoạch')
    : null
  if (derive_failed) console.error('[dispatch confirm] derive từ chối:', JSON.stringify(derive).slice(0, 500))
  return { lines: rows.length, group_codes: gcs, replan, replan_error, derive_failed, derive_message }
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
  if (error) throw error
}

// ── POST /tms/dispatch/plans/:id/confirm — xe của ĐVVT không cần phản hồi ghi thẳng; xe còn lại chờ ĐVVT ─────
export async function confirmPlan(req: Request, res: Response) {
  try {
    const full = await readPlan(String(req.params.id))
    if (!full) return fail(res, 'Không tìm thấy kế hoạch', 404)
    if (!whAllowed(req, full.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    // Kế hoạch đang mở một phần (vừa "Mở lại" vài xe, xe khác vẫn trong Kế hoạch xuất / chờ ĐVVT) vẫn xác nhận được các xe NHÁP
    const trips = full.trips.filter(t => t.ods.length && statusOf(t) === 'DRAFT')
    if (full.status !== 'DRAFT' && !(full.status === 'TENDERED' && trips.length)) return fail(res, 409, 'PLAN_NOT_DRAFT', 'Kế hoạch đã xác nhận / đang chờ ĐVVT / đã bỏ — chốt từng xe ở panel chuyến, hoặc "Mở lại" xe cần sửa')
    if (!trips.length) return fail(res, 422, 'PLAN_EMPTY', 'Kế hoạch không có chuyến nào để xác nhận')
    const wh = await loadWarehouse(full.warehouse_id)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    const g = await tripGuards(full, trips)
    if (g) return sendErr(res, g)

    const flags = await tenderFlags(trips)
    const direct = trips.filter(t => !t.transport_company_id || !flags.get(t.transport_company_id))
    const tender = trips.filter(t => t.transport_company_id && flags.get(t.transport_company_id))
    await markTendered(tender)
    const w = direct.length ? await writeTrips(req, full, wh, direct) : { lines: 0, group_codes: [] as string[], replan: null, replan_error: null, derive_failed: false, derive_message: null }
    const status = await syncPlanStatus(full as PlanRow, req.user?.name ?? null)
    await writeSummary(full as PlanRow)
    return ok(res, { plan_id: full.id, status, trips: direct.length, tendered: tender.length, tendered_group_codes: tender.map(t => t.group_code), lines: w.lines, group_codes: w.group_codes, replan: w.replan, replan_error: w.replan_error, derive_failed: w.derive_failed, derive_message: w.derive_message })
  } catch (e) { return failAny(res, e) }
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
    return ok(res, { trip_id: trip.id, group_code: trip.group_code, trip_status: needs ? 'TENDERED' : 'CONFIRMED', plan_status: status, lines: w?.lines ?? 0, replan: w?.replan ?? null, replan_error: w?.replan_error ?? null, derive_failed: w?.derive_failed ?? false, derive_message: w?.derive_message ?? null })
  } catch (e) { return failAny(res, e) }
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
      if (error) throw error
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
    if (error) throw error
    const w = await writeTrips(req, full, wh, [trip])
    const status = await syncPlanStatus(plan, actor)
    await writeSummary(plan)
    return ok(res, { trip_id: trip.id, group_code: trip.group_code, trip_status: 'CONFIRMED', plan_status: status, lines: w.lines, replan: w.replan, replan_error: w.replan_error })
  } catch (e) { return failAny(res, e) }
}

// ── POST /tms/dispatch/plans/:id/reopen — MỞ LẠI xe đã vào Kế hoạch xuất để sửa trên bàn ghép xe (user chốt 25/09) ─────
// Chỉ xe mà chuyến bên Xuất CHƯA bắt đầu: gỡ dòng Kế hoạch xuất của xe (cùng luật xoá tab Kế hoạch xuất — chuyến đang
// xuất / đã hoàn thành / đang giữ hàng nhặt lẻ thì KHÔNG gỡ) ⇒ chuyến NGỪNG HOẠT ĐỘNG + lệnh VC nhả khung giờ (đường
// dội sẵn có, giữ id) ⇒ xe về NHÁP. Xác nhận lại ⇒ cùng Số xe sống lại; khung giờ phải đặt lại.
export const zReopen = z.object({ trip_ids: z.array(zId).min(1).max(300).optional() })
export async function reopenPlan(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zReopen>
    const full = await readPlan(String(req.params.id))
    if (!full) return fail(res, 'Không tìm thấy kế hoạch', 404)
    if (!whAllowed(req, full.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    if (full.status === 'DISCARDED') return fail(res, 409, 'PLAN_NOT_DRAFT', 'Kế hoạch đã bỏ')
    const want = full.trips.filter(t => statusOf(t) === 'CONFIRMED' && (!b.trip_ids || b.trip_ids.includes(t.id)))
    if (!want.length) return fail(res, 422, 'NOTHING_TO_REOPEN', 'Không có xe nào đã vào Kế hoạch xuất để mở lại')
    const gcs = want.map(t => t.group_code)
    const lines = (await fetchAllByIdChunks(gcs, c => db.from('khvc_lines').select('id, group_code, do_no').in('group_code', c).neq('sync_status', 'OBSOLETE').order('id'))) as { id: string; group_code: string; do_no: string }[]
    const { blocked } = await classifyKhvcDelete(lines.map(l => ({ id: l.id, group_code: l.group_code })))
    const blockedGc = new Map(blocked.map(x => [x.group_code, x.reason]))
    const open = want.filter(t => !blockedGc.has(t.group_code))
    const openGc = open.map(t => t.group_code)
    const delRows = lines.filter(l => openGc.includes(l.group_code))
    for (let i = 0; i < delRows.length; i += 300) {
      const { error } = await db.from('khvc_lines').delete().in('id', delRows.slice(i, i + 300).map(l => l.id))
      if (error) throw error
    }
    const actor = actorOf(req)
    await logOutboundEvents(delRows.map(l => ({ group_code: l.group_code, event_type: 'PLAN_DO_REMOVED', source: 'PLAN' as const, actor, do_number: l.do_no,
      detail: `Mở lại kế hoạch điều vận — gỡ DO ${l.do_no} khỏi Số xe ${l.group_code} để sửa trên bàn ghép xe` })))
    let replan_error: string | null = null
    if (openGc.length) { try { await replanKhvcGroups(req, openGc) } catch (e) { replan_error = String(e); console.error('[dispatch reopen] replan:', e) } }
    const t = now()
    for (let i = 0; i < open.length; i += 300) {
      const { error } = await db.from('dispatch_trip').update({ status: 'DRAFT', confirmed_at: null, updated_at: t }).in('id', open.slice(i, i + 300).map(x => x.id))
      if (error) throw error
    }
    const status = await syncPlanStatus(full as PlanRow, req.user?.name ?? null)
    await writeSummary(full as PlanRow)
    return ok(res, { ...(await readPlan(full.id)), reopened: { trips: open.length, group_codes: openGc, blocked: want.filter(t => blockedGc.has(t.group_code)).map(t => ({ group_code: t.group_code, reason: blockedGc.get(t.group_code)! })), plan_status: status, replan_error } })
  } catch (e) { return failAny(res, e) }
}

// ── DELETE /tms/dispatch/plans/:id — bỏ bản nháp; kế hoạch đang chờ ĐVVT ⇒ bỏ các xe CHƯA vào Kế hoạch xuất ─────
export async function discardPlan(req: Request, res: Response) {
  try {
    const { data: plan, error: pErr } = await db.from('dispatch_plan').select('*').eq('id', String(req.params.id)).maybeSingle()
    if (pErr) throw pErr   // id rác (22P02) → 400 qua fail(), không phải "không tìm thấy"
    if (!plan) return fail(res, 'Không tìm thấy kế hoạch', 404)
    if (!whAllowed(req, plan.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    if (!OPEN_PLAN.includes(plan.status)) return fail(res, 409, 'PLAN_NOT_DRAFT', 'Kế hoạch đã xác nhận / đã bỏ')
    const t = now()
    const { data: dropped, error: tErr } = await db.from('dispatch_trip').update({ status: 'DISCARDED', updated_at: t }).eq('plan_id', plan.id).neq('status', 'CONFIRMED').select('id')
    if (tErr) throw tErr
    let status: string
    if (plan.status === 'DRAFT') {
      const { error } = await db.from('dispatch_plan').update({ status: 'DISCARDED', updated_at: t }).eq('id', plan.id)
      if (error) throw error
      status = 'DISCARDED'
    } else {
      status = await syncPlanStatus(plan as PlanRow, req.user?.name ?? null)
      await writeSummary(plan as PlanRow)
    }
    return ok(res, { id: plan.id, status, discarded_trips: dropped?.length ?? 0 })
  } catch (e) { return failAny(res, e) }
}

export { pickBookingCategory }
