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
import { haversineKm, geoProviderStatus, GeoNotConfigured } from '../../services/geo'
import { distancesFor, unmeasured, measurePairs, whKey, custKey } from '../../services/geoDistance'
import { ok, fail, type PgLikeError } from '../../utils/response'
import { fetchAllByIdChunks, fetchAllRowsParallel } from '../../utils/pagination'
import { z, zId, zDay, zBool, zText } from '../../middlewares/validate'
import { normDvvt } from '../../utils/sapUnits'
import { getDispatchCategoryConfig } from '../../utils/warehouseTypeMeta'
import { makeDvvtResolver } from '../../services/sapFlow'
import { loadOfWithSap } from '../../services/freightEstimate'
import { qtyEntryDecimal } from '../../utils/qtyUnits'
import { effectiveAt } from '../../services/freight'
import {
  runDispatch, buildCtx, priceFor, tripLoad, codePrefixOf, isTransferOd, sharePct, pickBookingCategory, sumLines, servesConditions, catLoadOf, bookingFromCatLoads, suggestVehicle,
  type EngineInput, type EngineOd, type EngineLine, type EngineModel, type EngineCarrier, type EngineTariff, type EngineSurcharge,
  type EngineAllocation, type EngineShareTarget, type ShareActual, type DispatchTrip, type TripFreight, type CarrierShare, type ShareBasis, type TripOd,
  odStopsCap, condsOf, mainCatsOf, lineConditions, resolveAllowedModels, mixBlockReason, priceCombo, comboModel, splitLoad, basisOf,
  type TripVehicle, withLoadBands, type LoadBand, type EngineGeo,
} from '../../services/dispatchEngine'
import { splitPool, redoDispatchedOf, type ExcludedOd, type ExcludedDetail, type PoolCandidateRow } from '../../services/dispatchPool'
import { replanKhvcGroups } from '../wms/outboundController'
import { classifyKhvcDelete } from '../external/khvcController'
import { logOutboundEvents, actorOf } from '../../services/outboundEvents'
import { logAdmin } from '../../services/adminAudit'
import { parseDispatchVehicles } from '../masterdata/customerController'
import type { Database, Json } from '../../types/database'
import type { LoadMat } from '../../utils/loadCalc'

type Tables = Database['public']['Tables']
type PlanRow = Tables['dispatch_plan']['Row']
type TripRow = Tables['dispatch_trip']['Row']
type TripOdRow = Tables['dispatch_trip_od']['Row']
type WhRow = { id: string; code: string; name: string; sap_plant: string | null; sap_storage_locations: string[] | null; dispatch_max_drops: number | null; dispatch_allow_mix_channels: boolean; dispatch_allow_mix_categories: boolean; dispatch_underload_pct: number | string | null; dispatch_max_vehicles_per_trip: number; dispatch_load_bands: unknown; dispatch_detour_pct: number | string | null }

type TripStatus = 'DRAFT' | 'TENDERED' | 'DECLINED' | 'CONFIRMED' | 'DISCARDED'
const EDITABLE_TRIP: TripStatus[] = ['DRAFT', 'DECLINED']
/** Theo kịp SAP (thay OD · cập nhật theo SAP) làm được CẢ trên xe đang CHỜ ĐVVT: ghi "ĐVVT nhận" đòi OD khớp SAP, nên chặn ở
 *  đây là ngõ cụt — lối ra duy nhất từng là ghi "từ chối" dù ĐVVT đã nhận (check-app 27/09 tối). Xe vẫn đứng chờ. */
const SAP_SYNC_TRIP: TripStatus[] = [...EDITABLE_TRIP, 'TENDERED']
const OPEN_PLAN = ['DRAFT', 'TENDERED']

const ENGINE_VERSION = '2026-10-01.1'   // dải tải theo dòng xe cha
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
// DẢI TẢI theo dòng xe CHA (01/10, user: "container SCA 60–100 %, xe pallet 16–17 90–105 %; chỉnh ngay trên bàn lúc Ghép / Lập lại;
// có nút tick bỏ qua %"): khoá = VehicleType.id; min = ngưỡng Non tải, max = trần xếp (≤ 130 — hơn thế là xe không chở nổi, không
// phải dung sai). Tối đa 50 cha. `load_bypass` = bỏ qua dải (min 0 / max 100 cho mọi xe).
const zLoadBand = z.object({ min: z.number().min(0).max(100), max: z.number().min(50).max(130) }).refine(b => b.min <= b.max, 'Tối thiểu phải ≤ tối đa')
export const zLoadBands = z.record(z.string().min(1).max(64), zLoadBand).refine(o => Object.keys(o).length <= 50, 'Tối đa 50 dòng xe cha')
export const zPlanBody = z.object({
  warehouse_id: zId,
  plan_date: zDay,
  max_drops: z.number().int().min(1).max(50).nullable().optional(),   // null = không giới hạn (28/09)
  allow_mix_channels: zBool.optional(),
  allow_mix_categories: zBool.optional(),   // đè "cho ghép nhiều Loại kho" của kho cho lượt lập này
  underload_pct: z.number().min(1).max(100).nullable().optional(),
  load_bands: zLoadBands.optional(),        // thiếu = lần chọn gần nhất của kho (Warehouse.dispatch_load_bands)
  load_bypass: zBool.optional(),
  // Bản PWA cũ còn gửi cờ này (27/09 chiều là công tắc tuỳ chọn). Từ 27/09 tối XEM ĐƠN LÀ BẮT BUỘC — cờ được nhận nhưng bỏ qua.
  review_first: zBool.optional(),
})
// PATCH /dispatch/plans/:id/params — đổi dải tải / bypass trên kế hoạch ĐANG MỞ mà không ghép lại: xe nháp tính lại cờ Non tải / vượt
export const zPlanParams = z.object({ load_bands: zLoadBands.optional(), load_bypass: zBool.optional() }).refine(b => b.load_bands !== undefined || b.load_bypass !== undefined, 'Không có gì để đổi')
export const zListQuery = z.object({
  warehouse_id: zId.optional(), date_from: zDay.optional(), date_to: zDay.optional(),
  status: z.enum(['DRAFT', 'TENDERED', 'CONFIRMED', 'DISCARDED']).optional(),
}).passthrough()
export const zTripPatch = z.object({
  vehicle_model_id: zId.nullable().optional(),          // MỘT xe — bỏ các xe phụ của thẻ
  vehicle_model_ids: z.array(zId).min(1).max(5).optional(),   // thẻ NHIỀU xe (luật 11): [0] = xe chính, còn lại = xe phụ
  transport_company_id: zId.nullable().optional(),
  locked: zBool.optional(),            // khoá xe: "Tối ưu lại phần chưa khoá" không đụng vào
  allow_mix_categories: zBool.nullable().optional(),   // switch trên thẻ xe (27/09): cho thả OD khác Loại kho; null = theo kế hoạch
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
  const { data, error } = await db.from('Warehouse').select('id, code, name, sap_plant, sap_storage_locations, dispatch_max_drops, dispatch_allow_mix_channels, dispatch_allow_mix_categories, dispatch_underload_pct, dispatch_max_vehicles_per_trip, dispatch_load_bands, dispatch_detour_pct').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as WhRow | null) ?? null
}
/** Dải tải đọc từ jsonb (kho nhớ lần chọn gần nhất / params kế hoạch) — chỉ giữ phần tử đúng dạng, phần còn lại coi như không khai. */
function loadBandsOf(raw: unknown): Record<string, LoadBand> {
  const out: Record<string, LoadBand> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const b = v as { min?: unknown; max?: unknown } | null
    const min = Number(b?.min), max = Number(b?.max)
    if (Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max > 0 && min <= max) out[k] = { min, max }
  }
  return out
}
/** Nhớ dải tải vừa chọn làm mặc định cho kho (hộp thoại trên bàn là chỗ khai duy nhất — không có form riêng). */
async function rememberLoadBands(whId: string, bands: Record<string, LoadBand>) {
  const { error } = await db.from('Warehouse').update({ dispatch_load_bands: asJson(bands) }).eq('id', whId)
  if (error) throw error
}

async function loadRefs(whId: string, day: string, wards: string[]): Promise<Refs> {
  const [vmRes, vtRes, tariffs, surcharges, allocRes, shareRes] = await Promise.all([
    db.from('vehicle_model').select('id, sap_code, name, parent_type_id, capacity_mode, max_pallets, max_tons, tariff_unit, underload_pct, max_drops, storage_conditions, is_active').eq('is_active', true).order('sap_code'),
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
  const vtRows = (vtRes.data ?? []) as { id: string; name: string }[]
  const vtName = new Map(vtRows.map(v => [v.id, v.name]))
  const models: EngineModel[] = ((vmRes.data ?? []) as { id: string; sap_code: string; name: string; parent_type_id: string | null; capacity_mode: string | null; max_pallets: number | null; max_tons: number | string | null; tariff_unit: string | null; underload_pct: number | string | null; max_drops: number | null; storage_conditions: string[] | null; is_active: boolean }[]).map(m => ({
    id: m.id, sap_code: m.sap_code, name: m.name,
    parent_type_id: m.parent_type_id ?? null,   // khoá dải tải theo cha (01/10)
    parent_type_name: m.parent_type_id ? (vtName.get(m.parent_type_id) ?? null) : null,
    capacity_mode: m.capacity_mode === 'TON' ? 'TON' : m.capacity_mode === 'PALLET' ? 'PALLET' : null,
    max_pallets: numOrNull(m.max_pallets), max_tons: numOrNull(m.max_tons),
    tariff_unit: m.tariff_unit === 'PER_TRIP' ? 'PER_TRIP' : 'PER_PALLET',
    underload_pct: numOrNull(m.underload_pct), max_drops: numOrNull(m.max_drops), is_active: m.is_active,
    serve_conditions: (m.storage_conditions ?? []).filter(Boolean),   // rỗng = chở được mọi điều kiện
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
type PoolRow = PoolCandidateRow & { od_item: string; material_code: string | null; qty_base: number | string | null; ship_to_code: string | null; ship_to_name: string | null; ward_code: string | null; region_code: string | null; flow: string | null; sap_pallets: number | string | null; gross_weight_kg: number | string | null; storage_location: string | null; note_delivery: string | null }
type MatRow = LoadMat & { material_code: string; category: string | null }
type CustRow = { ship_to_code: string; ward_code: string | null; region_code: string | null; region_name: string | null; channel: string | null; warehouse_id: string | null; is_active: boolean; dispatch_vehicles: Record<string, unknown> | null; dispatch_separate: boolean | null; max_customers_per_trip: number | null }
type CatCfg = Awaited<ReturnType<typeof getDispatchCategoryConfig>>
/** Chỗ khai THIẾU làm máy xếp sai mà không lỗi nào nổ (user 26/09: "nếu không khai báo đúng thì FG02 có thể dùng container
 *  mất") — màn Điều vận hiện băng cảnh báo từ đây. Loại "đi kèm đơn" không cần ĐK bảo quản riêng. */
export type ConfigGaps = { no_condition: { category: string; ods: number }[]; no_category: { ods: number; materials: string[] } }
type OdMeta = { delivery_date: string | null; late_days: number; region_code: string | null; region_name: string | null; note: string | null; sig: string }
/** Chữ ký dòng hàng SAP của một OD (item | mã | SL base) lúc chụp — ZSD02 nạp lại mà chữ ký khác = SAP đã SỬA đơn sau khi người
 *  đã xem (27/09 tối, user: "chú ý việc sửa đơn, điều chỉnh thì xử lý thế nào"). */
type SigRow = { od_item: string; material_code: string | null; qty_base: number | string | null }
const odSig = (rs: SigRow[]) => rs.map(r => `${r.od_item}|${r.material_code ?? ''}|${Number(r.qty_base) || 0}`).sort().join(';')
/** Ghi chú giao hàng SAP gộp của một OD ("GIAO 10/9" · "NPP không nhận CN") — người xem đọc, máy KHÔNG đọc. */
const noteOf = (rs: { note_delivery: string | null }[]) => uniq(rs.map(r => (r.note_delivery ?? '').trim()).filter(n => n && n !== '0')).join(' · ') || null
/** Dòng của kho: kho khai Sloc thì bỏ dòng thuộc Sloc khác (dòng không ghi Sloc vẫn tính) — một luật cho nạp OD lẫn soi đổi. */
const slocsOf = (wh: Pick<WhRow, 'sap_storage_locations'> | null) => (wh?.sap_storage_locations ?? []).map(s => String(s).trim().toUpperCase()).filter(Boolean)
const inSlocs = <R extends { storage_location: string | null }>(rows: R[], slocs: string[]) => (slocs.length ? rows.filter(r => !r.storage_location || slocs.includes(String(r.storage_location).trim().toUpperCase())) : rows)
/** Dòng của MỘT ngày lập: dòng đúng ngày giữ hết; dòng tồn đọng chỉ giữ phân loại lên xe được (chiết khấu / trả về của ngày trước
 *  không phải việc hôm nay). MỘT luật cho cả nạp OD (bản chụp) lẫn soi đổi (/sync) — 29/09 Ba Vì: 17 OD bị cờ "SAP đã sửa" oan vì
 *  bản chụp bỏ dòng chiết khấu mã 9100000xx của đơn 25/09 còn phép so đếm cả, người phải bấm "Cập nhật theo SAP" 17 lần cho không gì. */
const linesOfDay = <R extends { delivery_date: string | null; flow: string | null }>(rows: R[], day: string) => rows.filter(r => r.delivery_date === day || LOADABLE_FLOW.has(String(r.flow)))
/** Mốc "đã xem" của một dòng OD: người xác nhận đơn ở bước Xem đơn (hoặc thao tác chính tay trên OD đó — bỏ hoãn, thay OD, cập nhật theo SAP). */
type Rev = { at: string; by: string | null } | null
const POOL_COLS = 'od_number, od_item, material_code, qty_base, ship_to_code, ship_to_name, ward_code, region_code, flow, sap_pallets, gross_weight_kg, storage_location, delivery_date, sap_dispatch_status, mat_doc, qty_issued_base, dvvt_raw, license_plate, note_delivery'
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

/** OD đang HOÃN / KHÔNG ĐIỀU của kho (27/09) — bảng nhỏ (một dòng mỗi OD người đánh dấu), đọc trọn. */
async function loadHolds(whId: string): Promise<Map<string, { until: string | null; reason: string }>> {
  const rows = (await fetchAllRowsParallel(() => db.from('dispatch_od_hold').select('od_number, hold_until, reason').eq('warehouse_id', whId).order('od_number'))) as { od_number: string; hold_until: string | null; reason: string }[]
  return new Map(rows.map(r => [r.od_number, { until: r.hold_until, reason: r.reason }]))
}
/** Nạp ứng viên + phân loại lũy tiến. `onlyOds` = chỉ những OD này (tối ưu lại / thay OD), bỏ lọc theo ngày. */
async function loadCandidates(wh: WhRow, day: string, cfg: CatCfg, opts: { onlyOds?: string[]; skipPlanId?: string | null; countOnly?: boolean; reportAll?: boolean } = {}): Promise<{ ods: EngineOd[]; meta: Map<string, OdMeta>; excluded: ExcludedOd[]; include: string[]; gaps: ConfigGaps }> {
  const { condByCat } = cfg
  const follow = new Set(cfg.follow)
  const holds = await loadHolds(wh.id)
  const rows = (opts.onlyOds
    ? await fetchAllByIdChunks(opts.onlyOds, c => db.from('erp_outbound_orders').select(POOL_COLS).in('od_number', c).eq('sync_status', 'ACTIVE').order('od_number').order('od_item'))
    : await fetchAllRowsParallel(() => db.from('erp_outbound_orders').select(POOL_COLS)
      .eq('plant', wh.sap_plant ?? '').gte('delivery_date', shiftDay(day, -BACKLOG_DAYS)).lte('delivery_date', day)
      .eq('sync_status', 'ACTIVE').not('od_number', 'is', null).order('od_number').order('od_item'))) as unknown as PoolRow[]
  // OD HOÃN tới hôm nay mà ngày giao đã quá cửa sổ tồn đọng — vẫn phải quay lại đợt ghép (người đã hẹn ngày này).
  // Nhưng ngày hẹn cũng chịu cùng cửa sổ 14 ngày (29/09): hẹn 30/09 mà tới 2027 chưa ai điều thì nó là lịch sử như mọi
  // đơn tồn đọng khác — bản cũ kéo 4 OD hẹn 30/09 vào cả kế hoạch thử nghiệm ngày 16/03/2027 của cùng kho.
  if (!opts.onlyOds) {
    const have = new Set(rows.map(r => r.od_number))
    const floor = shiftDay(day, -BACKLOG_DAYS)
    const due = [...holds.entries()].filter(([od, h]) => h.until != null && h.until <= day && h.until >= floor && !have.has(od)).map(([od]) => od)
    if (due.length) rows.push(...((await fetchAllByIdChunks(due, c => db.from('erp_outbound_orders').select(POOL_COLS).in('od_number', c).eq('plant', wh.sap_plant ?? '').eq('sync_status', 'ACTIVE').order('od_number').order('od_item'))) as unknown as PoolRow[]))
  }
  const mine0 = inSlocs(rows, slocsOf(wh))
  // OD TỒN ĐỌNG chỉ gộp khi LÊN XE được — hàng trả về / chiết khấu của ngày trước không phải việc của hôm nay
  const mine = linesOfDay(mine0, day)
  const odNos = uniq(mine.map(r => r.od_number))
  const [khvc, drafts, olds] = await Promise.all([
    fetchAllByIdChunks(odNos, c => db.from('khvc_lines').select('do_no, group_code').in('do_no', c).neq('sync_status', 'OBSOLETE').order('do_no')) as Promise<{ do_no: string; group_code: string }[]>,
    openDraftOds(wh.id, odNos, opts.skipPlanId ?? null),
    // OD cũ mà SAP đã thay bằng các OD này (sửa SO) — đa số lần nạp không có dòng nào
    fetchAllByIdChunks(odNos, c => db.from('erp_outbound_orders').select('od_number, replaced_by_od').in('replaced_by_od', c).order('od_number')) as Promise<{ od_number: string; replaced_by_od: string }[]>,
  ])
  const inPlan = new Map<string, string>()
  for (const k of khvc) if (!inPlan.has(k.do_no)) inPlan.set(k.do_no, k.group_code)
  // DO tạo lại – đã điều (28/09): OD cũ đã nằm Kế hoạch xuất ⇒ OD mới sang tab Đã điều. Cùng thước "đã có trong KH xuất" như inPlan.
  const oldOds = uniq(olds.map(o => o.od_number))
  const oldKhvc = oldOds.length ? (await fetchAllByIdChunks(oldOds, c => db.from('khvc_lines').select('do_no, group_code').in('do_no', c).neq('sync_status', 'OBSOLETE').order('do_no'))) as { do_no: string; group_code: string }[] : []
  const split = splitPool(mine, day, { inPlan, otherDraft: drafts, held: holds, redo: redoDispatchedOf(olds, oldKhvc), reportAll: opts.reportAll })
  // CHỈ OD lên xe được mới là "OD mới cần xếp" — OD trả về / chiết khấu đúng ngày vẫn qua splitPool (engine xếp vào
  // danh sách "không lên xe"), đếm chúng là báo "12 OD mới" ngay sau khi vừa lập (đo Preview 25/09: đúng 12 OD RETURN)
  const flowOf = new Map(mine.map(r => [r.od_number, String(r.flow)]))
  const include = [...split.include.keys()].filter(od => LOADABLE_FLOW.has(flowOf.get(od) ?? ''))
  const noGaps: ConfigGaps = { no_condition: [], no_category: { ods: 0, materials: [] } }
  if (opts.countOnly) {
    if (!opts.reportAll) return { ods: [], meta: new Map(), excluded: split.excluded, include, gaps: noGaps }
    // cửa "Xem cả đơn tồn đọng đã đi": bảng Xem đơn cần khách · phường · vùng · pallet · ngày của từng OD bị loại
    const allBy0 = new Map<string, PoolRow[]>()
    for (const r of mine) { const l = allBy0.get(r.od_number) ?? []; l.push(r); allBy0.set(r.od_number, l) }
    const custs0 = (await fetchAllByIdChunks(uniq(mine.map(r => r.ship_to_code).filter((x): x is string => !!x)), c => db.from('Customer')
      .select('ship_to_code, ward_code, region_code, region_name, channel, warehouse_id, is_active, dispatch_vehicles, dispatch_separate, max_customers_per_trip').in('ship_to_code', c).order('ship_to_code'))) as CustRow[]
    const custBy0 = new Map(custs0.map(c => [c.ship_to_code, c]))
    return { ods: [], meta: new Map(), excluded: split.excluded.map(x => ({ ...x, d: odDetailOf(allBy0.get(x.od_number) ?? [], custBy0) })), include, gaps: noGaps }
  }
  const kept = mine.filter(r => split.include.has(r.od_number))
  const matCodes = uniq(kept.map(r => r.material_code).filter((x): x is string => !!x))
  const [mats, custs, chRes] = await Promise.all([
    fetchAllByIdChunks(matCodes, c => db.from('Material')
      .select('material_code, category, base_unit, entry_unit, units_per_carton, cartons_per_pallet, warehouse_pallet_overrides, weight_kg, is_pallet_carrier, is_non_stock').in('material_code', c).order('material_code')) as Promise<MatRow[]>,
    // khách của MỌI OD (kể cả OD bị bỏ ra) — bảng Xem đơn in tên vùng cho cả dòng Đã điều / Không điều
    fetchAllByIdChunks(uniq(mine.map(r => r.ship_to_code).filter((x): x is string => !!x)), c => db.from('Customer')
      .select('ship_to_code, ward_code, region_code, region_name, channel, warehouse_id, is_active, dispatch_vehicles, dispatch_separate, max_customers_per_trip').in('ship_to_code', c).order('ship_to_code')) as Promise<CustRow[]>,
    // Luật 10 (27/09): dòng xe được vào mặc định theo KÊNH — danh mục 7 dòng
    db.from('LookupValue').select('value, meta').eq('type', 'customer_channel'),
  ])
  if (chRes.error) throw chRes.error
  const chanRows = (chRes.data ?? []) as { value: string; meta: Record<string, unknown> | null }[]
  const chanVeh = new Map(chanRows.map(r => [r.value, (r.meta?.dispatch_vehicles ?? null) as Record<string, unknown> | null]))
  // 28/09: số khách tối đa cùng xe mặc định của KÊNH (khách khai riêng thì thắng); không khai = không giới hạn
  const chanMax = new Map(chanRows.map(r => [r.value, typeof r.meta?.max_customers_per_trip === 'number' ? r.meta.max_customers_per_trip as number : null]))
  const matBy = new Map(mats.map(m => [m.material_code, m]))
  const custBy = new Map(custs.map(c => [c.ship_to_code, c]))
  const gapCat = new Map<string, Set<string>>()
  const gapNoCat = { ods: new Set<string>(), materials: new Set<string>() }
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
      // Điều kiện bảo quản THEO LOẠI KHO của mã hàng (Cài đặt WMS → Loại kho) — hàng → đơn → xe. ĐK của VỊ TRÍ là việc của
      // WMS, KHÔNG đi vào điều vận (user chốt 27/09: "vị trí lấy ĐK bảo quản là để phục vụ cho WMS"). Loại chưa khai ⇒ rỗng
      // ⇒ không ràng buộc dòng xe (có băng "khai thiếu").
      const catCond = (cat && condByCat.get(cat)) || null
      const conditions = lineConditions(catCond, undefined, !!cat && follow.has(cat))
      if (!cat) { gapNoCat.ods.add(od); if (r.material_code) gapNoCat.materials.add(r.material_code) }
      else if (!catCond && !follow.has(cat)) gapCat.set(cat, (gapCat.get(cat) ?? new Set()).add(od))
      return { material_code: r.material_code ?? '?', qty_base: q, pallets: l.pallets, kg: l.kg, category: cat, condition: catCond, conditions }
    })
    ods.push({
      od_number: od, ship_to_code: first.ship_to_code, ship_to_name: first.ship_to_name,
      ward_code: first.ward_code ?? cust?.ward_code ?? null, region_code: first.region_code ?? cust?.region_code ?? null,
      channel: cust?.is_active === false ? null : (cust?.channel ?? null),
      // 28/09 (user: "không tự ép gì cả, config hết"): đi xe riêng + số khách tối đa cùng xe đều là CẤU HÌNH (khách → kênh);
      // "khách trỏ kho" chỉ quyết việc NHẬN ở Xuất kho, không còn ép xe riêng ở đây
      separate: cust?.is_active !== false && cust?.dispatch_separate === true,
      max_customers: cust?.is_active === false ? null : (cust?.max_customers_per_trip ?? (cust?.channel ? chanMax.get(cust.channel) ?? null : null)),
      flow: first.flow ?? 'UNKNOWN', lines,
      // luật 10 (27/09): dòng xe được vào — Khách × Loại kho → Khách → Kênh × Loại kho → Kênh; không khai = [] = không xe nào (28/09)
      allowed_models: resolveAllowedModels(cust?.dispatch_vehicles, cust?.is_active === false || !cust?.channel ? null : chanVeh.get(cust.channel), mainCatsOf(lines, follow)),
    })
    const inc = split.include.get(od)!
    // ghi chú giao hàng SAP (vd "GIAO 10/9", "NPP không nhận hàng chủ nhật") — người REVIEW đọc, máy KHÔNG đọc (luật 10/09)
    meta.set(od, { delivery_date: inc.delivery_date, late_days: inc.late_days, region_code: first.region_code ?? cust?.region_code ?? null, region_name: cust?.region_name ?? null, note: noteOf(rs), sig: odSig(rs) })
  }
  const gaps: ConfigGaps = {
    no_condition: [...gapCat.entries()].map(([category, s]) => ({ category, ods: s.size })).sort((a, b) => b.ods - a.ods || a.category.localeCompare(b.category)),
    no_category: { ods: gapNoCat.ods.size, materials: [...gapNoCat.materials].sort().slice(0, 50) },
  }
  // OD bị bỏ ra mang theo thông tin để bảng Xem đơn in được dòng của nó (tab Đã điều / Không điều ngày này / Không điều)
  const allBy = new Map<string, PoolRow[]>()
  for (const r of mine) { const l = allBy.get(r.od_number) ?? []; l.push(r); allBy.set(r.od_number, l) }
  const excluded = split.excluded.map(x => ({ ...x, d: odDetailOf(allBy.get(x.od_number) ?? [], custBy) }))
  return { ods, meta, excluded, include, gaps }
}
/** Tóm tắt một OD từ dòng ZSD02 thô (pallet/tấn theo số SAP — OD bị bỏ ra không qua bộ đo tải của máy). */
function odDetailOf(rs: PoolRow[], custBy: Map<string, CustRow>): ExcludedDetail | undefined {
  const first = rs[0]
  if (!first) return undefined
  const cust = first.ship_to_code ? custBy.get(first.ship_to_code) : undefined
  const sum = (k: 'sap_pallets' | 'gross_weight_kg') => rs.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  return { ship_to_code: first.ship_to_code, ship_to_name: first.ship_to_name, ward_code: first.ward_code ?? cust?.ward_code ?? null,
    region_code: first.region_code ?? cust?.region_code ?? null, region_name: cust?.region_name ?? null,
    pallets: sum('sap_pallets') || null, tons: sum('gross_weight_kg') / 1000 || null,
    delivery_date: rs.map(r => r.delivery_date).filter((x): x is string => !!x).sort().pop() ?? null, note: noteOf(rs) }
}
const LOADABLE_FLOW = new Set(['SALE', 'STO', 'INTERNAL', 'PALLET'])

/** Dòng dispatch_trip_od từ một phần OD engine đã xếp (hoặc cả OD nằm khung chờ khi trip = null). */
function odRow(planId: string, tripId: string | null, o: TripOd, m: OdMeta | undefined, t: string, rev: Rev): Tables['dispatch_trip_od']['Insert'] {
  return {
    id: randomUUID(), plan_id: planId, trip_id: tripId, od_number: o.od_number, ship_to_code: o.ship_to_code, ship_to_name: o.ship_to_name, ward_code: o.ward_code,
    pallets: o.pallets, tons: o.tons, lines: o.lines, part_index: o.part?.index ?? null, part_of: o.part?.of ?? null, material_codes: o.material_codes,
    conditions: o.conditions, cat_load: asJson(o.cat_load), region_code: m?.region_code ?? null, region_name: m?.region_name ?? null, delivery_date: m?.delivery_date ?? null, late_days: m?.late_days ?? 0,
    is_transfer: o.transfer, allowed_models: o.allowed_models, note: m?.note ?? null, updated_at: t,
    separate: o.separate, max_customers: o.max_customers,
    sap_sig: m?.sig ?? null, reviewed_at: rev?.at ?? null, reviewed_by: rev?.by ?? null,
  }
}
/** Cả một OD (chưa tách) → TripOd — cho OD vào khung chờ (nạp OD mới / thay OD). */
function wholeOd(od: EngineOd): TripOd {
  const s = sumLines(od.lines)
  return { od_number: od.od_number, ship_to_code: od.ship_to_code, ship_to_name: od.ship_to_name, ward_code: od.ward_code, pallets: s.pallets, tons: s.tons, lines: od.lines.length, part: null,
    material_codes: od.lines.map(l => l.material_code), conditions: condsOf(od.lines), cat_load: catLoadOf(od.lines), transfer: isTransferOd(od), allowed_models: od.allowed_models ?? null,
    separate: od.separate === true, max_customers: od.max_customers ?? null }
}
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
/** Các xe của thẻ để màn hình in (luật 11): dòng xe + phần tải + cước riêng. Một xe ⇒ mảng một phần tử. */
const vehiclesRef = (vs: TripVehicle[]) => vs.map(v => ({ id: v.model.id, sap_code: v.model.sap_code, name: v.model.name, parent_type_name: v.model.parent_type_name, pallets: v.pallets, tons: v.tons, freight: v.freight }))
function tripDetail(t: DispatchTrip) {
  return {
    freight: t.freight, load: t.load, categories: t.categories, conditions: t.conditions, booking_category: t.booking_category, cluster: t.cluster,
    carrier_reasons: t.carrier_reasons, warnings: t.warnings, merge_hint: t.merge_hint,
    vehicle_model: t.vehicle_model ? { id: t.vehicle_model.id, sap_code: t.vehicle_model.sap_code, name: t.vehicle_model.name, parent_type_name: t.vehicle_model.parent_type_name } : null,
    vehicles: vehiclesRef(t.vehicles),
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
    unreviewed_ods: uniq(pool.filter(o => !o.reviewed_at).map(o => o.od_number)).length,   // bước Xem đơn còn bao nhiêu OD chưa xác nhận
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
/** Toạ độ + km cho máy ghép (02/10): ghim kho, ghim khách của các OD, km đã đo (GOONG) hoặc ước lượng cho kho→khách và khách↔khách
 *  gần nhau (≤ 80 km chim bay). Kho chưa ghim ⇒ geo.wh null ⇒ engine không gộp khác tỉnh (không đoán). Chỉ đọc DB, không gọi ngoài. */
async function engineGeo(whId: string, ods: EngineOd[]): Promise<EngineGeo | undefined> {
  const codes = uniq(ods.map(o => o.ship_to_code).filter((x): x is string => !!x))
  if (!codes.length) return undefined
  const [{ data: wh }, custs] = await Promise.all([
    db.from('Warehouse').select('geo_lat, geo_lng').eq('id', whId).maybeSingle(),
    fetchAllByIdChunks(codes, c => db.from('Customer').select('ship_to_code, geo_lat, geo_lng').in('ship_to_code', c).not('geo_lat', 'is', null).order('ship_to_code')) as Promise<{ ship_to_code: string; geo_lat: number; geo_lng: number }[]>,
  ])
  const points: EngineGeo['points'] = {}
  for (const c of custs) points[c.ship_to_code] = { lat: Number(c.geo_lat), lng: Number(c.geo_lng) }
  const whPt = wh?.geo_lat != null && wh.geo_lng != null ? { lat: Number(wh.geo_lat), lng: Number(wh.geo_lng) } : null
  const km: Record<string, number> = {}
  if (whPt && custs.length) {
    const whNode = { key: whKey(whId), pt: whPt }
    const nodes = custs.map(c => ({ key: custKey(c.ship_to_code), pt: points[c.ship_to_code] }))
    const pairs = [...nodes.map(n => ({ from: whNode, to: n })), ...custPairs(nodes)]
    const ds = await distancesFor(pairs)
    const label = (k: string) => (k.startsWith('WH:') ? 'WH' : k.slice(3))
    pairs.forEach((p, i) => { km[`${label(p.from.key)}|${label(p.to.key)}`] = ds[i].km })
  }
  return { wh: whPt, points, km }
}
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

    const [catCfg, condition_labels] = await Promise.all([getDispatchCategoryConfig(), loadConditionLabels()])
    // kế hoạch nháp CŨ của chính kho×ngày này sắp bị thay ⇒ OD của nó không tính là "đang nằm nháp khác"
    const { data: oldDrafts } = await db.from('dispatch_plan').select('id').eq('warehouse_id', wh.id).eq('plan_date', b.plan_date).eq('status', 'DRAFT')
    const { ods, meta, excluded, gaps } = await loadCandidates(wh, b.plan_date, catCfg, { skipPlanId: oldDrafts?.[0]?.id ?? null })
    const in_plan = excluded.filter(x => x.kind === 'IN_PLAN').map(x => ({ od_number: x.od_number, group_code: x.info ?? '' }))
    const wards = uniq(ods.map(o => o.ward_code).filter((x): x is string => !!x))
    const refs = await loadRefs(wh.id, b.plan_date, wards)
    const share_actual = await loadShareActual(wh.id, b.plan_date, refs.carriers)
    const prefix = codePrefixOf(wh.code, b.plan_date)
    const params = {
      day: b.plan_date,
      // 28/09: trần điểm giao của kho cho phép TRỐNG = không giới hạn (từng cứng 3)
      max_drops: b.max_drops !== undefined ? b.max_drops : numOrNull(wh.dispatch_max_drops),
      allow_mix_channels: b.allow_mix_channels ?? wh.dispatch_allow_mix_channels === true,
      underload_pct: b.underload_pct === undefined ? numOrNull(wh.dispatch_underload_pct) : b.underload_pct,
      code_prefix: prefix,
      start_seq: await nextSeq(prefix),
      // luật 9 (26/09): mặc định KHÔNG ghép nhiều Loại kho trên một chuyến; POSM (Loại kho "đi kèm đơn") không tính
      allow_mix_categories: b.allow_mix_categories ?? wh.dispatch_allow_mix_categories === true,
      follow_categories: catCfg.follow,
      // luật 4b: các mức Loại kho CHÍNH có khai — xe chở được ≥ 2 mức này là xe kết hợp, chỉ ưu tiên khi chuyến cần ≥ 2 mức
      combo_conditions: uniq([...catCfg.condByCat.entries()].filter(([c]) => !catCfg.follow.includes(c)).map(([, v]) => v)).sort(),
      // luật 11 (27/09): số dòng xe tối đa trên một thẻ — form Kho, nhóm "XUẤT — Điều vận" (1 = một xe như trước)
      max_vehicles: Math.min(5, Math.max(1, Number(wh.dispatch_max_vehicles_per_trip) || 1)),
      // dải tải theo dòng xe cha (01/10): gửi lên = dùng + nhớ cho kho; không gửi = lần chọn gần nhất của kho
      load_bands: b.load_bands !== undefined ? loadBandsOf(b.load_bands) : loadBandsOf(wh.dispatch_load_bands),
      load_bypass: b.load_bypass === true,
      // 02/10: gộp xe Non tải khác tỉnh theo đường vòng (form Kho, nhóm XUẤT — Điều vận); null = tắt
      detour_pct: numOrNull(wh.dispatch_detour_pct),
    }
    if (b.load_bands !== undefined) await rememberLoadBands(wh.id, params.load_bands)
    // XEM ĐƠN LÀ BƯỚC BẮT BUỘC (user chốt 27/09 tối: "bước đầu tiên trên bàn làm việc là xem tất cả các đơn open chưa có trong
    // ghép xe — xác nhận xong mới tới điều xe"). Máy chạy ở đây CHỈ để biết OD nào không lên xe được (trả về · không đo được tải…);
    // mọi OD còn lại vào khung chờ CHƯA XEM, không xe nào được dựng. Ghép = reoptimize sau khi người xác nhận đơn.
    const result = runDispatch({ ods, ...refs, share_actual, condition_labels, params, geo: await engineGeo(wh.id, ods) })
    // OD thiếu KHAI BÁO dòng xe (khách/kênh chưa khai — 28/09) vẫn vào khung chờ: khai xong bấm Ghép là máy xếp được; để vào
    // "không lên xe" thì OD kẹt ở đó tới khi lập lại cả kế hoạch
    const unplannedReal = result.unplanned.filter(u => !u.code)   // có `code` = OD ở lại khung chờ (chưa khai xe · chỉ POSM chờ đơn chính)
    const unplannedSet = new Set(unplannedReal.map(u => u.od_number))

    // MỘT bản nháp mỗi kho×ngày: nháp cũ (kể cả người đã sửa) bị thay — người bấm "Lập kế hoạch" là chủ ý chạy lại
    const { error: delErr } = await db.from('dispatch_plan').delete().eq('warehouse_id', wh.id).eq('plan_date', b.plan_date).eq('status', 'DRAFT')
    if (delErr) throw delErr
    const t = now()
    const planId = randomUUID()
    const { error: pErr } = await db.from('dispatch_plan').insert({
      id: planId, warehouse_id: wh.id, plan_date: b.plan_date, status: 'DRAFT', engine_version: ENGINE_VERSION,
      params: asJson({
        ...params, pool_ods: ods.length, in_plan: in_plan.length, share_base: share_actual, share_targets: refs.share_targets, carriers: refs.carriers, wh_code: wh.code,
        backlog_days: BACKLOG_DAYS, late_ods: [...meta.values()].filter(m => m.late_days > 0).length, excluded, config_gaps: gaps,
        // mốc "máy lập" để dải chỉ số nói người sửa đã làm tốt hơn hay tệ hơn đề xuất — đặt ở lần ghép đầu (sau bước Xem đơn)
        baseline: null,
      }),
      summary: asJson({}), unplanned: asJson(unplannedReal),
      created_by: req.user?.name ?? null, updated_at: t,
    })
    if (pErr) throw pErr
    await insertOdRows(ods.filter(o => !unplannedSet.has(o.od_number)).map(o => odRow(planId, null, wholeOd(o), meta.get(o.od_number), t, null)))
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
// GET /tms/dispatch/plans/:id/geo — toạ độ khách của kế hoạch cho tab Bản đồ (01/10): CHỈ đọc Customer.geo_* (của mình),
// không gọi dịch vụ ngoài — nhà cung cấp định vị sập giữa ngày thì bàn vẫn vẽ. Khách chưa có toạ độ trả về với lat/lng null
// để màn hình liệt kê "chưa định vị" thay vì im lặng thiếu ghim.
type PlanGeoCust = { ship_to_code: string; name: string; geo_lat: number | null; geo_lng: number | null; geo_source: string | null; geo_accuracy_m: number | null }
async function planGeoInput(planId: string) {
  const full = await readPlan(planId)
  if (!full) return null
  const codes = uniq([...full.trips.flatMap(t => t.ods), ...full.pool].map(o => o.ship_to_code).filter((x): x is string => !!x))
  const customers = codes.length ? (await fetchAllByIdChunks(codes, c => db.from('Customer')
    .select('ship_to_code, name, geo_lat, geo_lng, geo_source, geo_accuracy_m').in('ship_to_code', c).order('ship_to_code'))) as PlanGeoCust[] : []
  const { data: wh } = await db.from('Warehouse').select('id, code, name, geo_lat, geo_lng, geo_source').eq('id', full.warehouse_id).maybeSingle()
  const whNode = wh?.geo_lat != null && wh.geo_lng != null ? { key: whKey(wh.id), pt: { lat: Number(wh.geo_lat), lng: Number(wh.geo_lng) } } : null
  const nodes = customers.filter(c => c.geo_lat != null && c.geo_lng != null).map(c => ({ key: custKey(c.ship_to_code), pt: { lat: Number(c.geo_lat), lng: Number(c.geo_lng) } }))
  return { full, customers, wh, whNode, nodes }
}
// Cặp khách ↔ khách đáng đo: cùng kế hoạch VÀ đường chim bay dưới ngưỡng (hai khách cách nhau 400 km không bao giờ chung xe,
// đo là đốt lượt). Ba Vì 179 khách: đủ cặp là 32.000, dưới 80 km còn vài nghìn.
const PAIR_MAX_KM = 80
function custPairs(nodes: { key: string; pt: { lat: number; lng: number } }[]) {
  const out: { from: typeof nodes[number]; to: typeof nodes[number] }[] = []
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++)
    if (haversineKm(nodes[i].pt, nodes[j].pt) <= PAIR_MAX_KM) out.push({ from: nodes[i], to: nodes[j] })
  return out
}
// GET /tms/dispatch/plans/:id/geo — toạ độ kho + khách của kế hoạch cho tab Bản đồ (01/10; 02/10 thêm kho + km từ kho): CHỈ đọc
// DB của mình, không gọi dịch vụ ngoài lúc xem. Khách chưa có toạ độ trả về với lat/lng null để màn hình liệt kê "chưa định vị".
// km từ kho: số đo GOONG nếu đã đo, chưa thì ước lượng chim bay × 1,3 (nguồn HAVERSINE) — màn hình phải nói "ước lượng".
export async function getPlanGeo(req: Request, res: Response) {
  try {
    const g = await planGeoInput(String(req.params.id))
    if (!g) return fail(res, 'Không tìm thấy kế hoạch', 404)
    if (!whAllowed(req, g.full.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const kmBy = new Map<string, { km: number; minutes: number | null; source: string }>()
    if (g.whNode && g.nodes.length) {
      const ds = await distancesFor(g.nodes.map(n => ({ from: g.whNode!, to: n })))
      g.nodes.forEach((n, i) => kmBy.set(n.key, ds[i]))
    }
    const pairs = g.whNode ? custPairs(g.nodes) : []
    const pending = g.whNode ? (await unmeasured([...g.nodes.map(n => ({ from: g.whNode!, to: n })), ...pairs])).length : 0
    return ok(res, {
      warehouse: g.wh ? { id: g.wh.id, code: g.wh.code, name: g.wh.name, geo_lat: g.wh.geo_lat, geo_lng: g.wh.geo_lng, geo_source: g.wh.geo_source } : null,
      customers: g.customers.map(c => ({ ...c, from_wh: kmBy.get(custKey(c.ship_to_code)) ?? null })),
      measure: { pending, provider: await geoProviderStatus() },
    })
  } catch (e) { return failAny(res, e) }
}
// POST /tms/dispatch/plans/:id/geo/measure — đo km đường bộ (Goong, xe tải) cho kho → khách và khách ↔ khách gần nhau của kế hoạch,
// ghi sổ geo_distance. Mỗi lượt tối đa 200 lời gọi (~45 s, dưới trần hàm) — trả `pending` để bấm tiếp. 422 khi chưa có máy đo.
export async function measurePlanGeo(req: Request, res: Response) {
  try {
    const g = await planGeoInput(String(req.params.id))
    if (!g) return fail(res, 'Không tìm thấy kế hoạch', 404)
    if (!whAllowed(req, g.full.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const st = await geoProviderStatus()
    if (!st.ready) return fail(res, 422, 'GEO_NOT_CONFIGURED', st.reason ?? 'Chưa cấu hình máy định vị')
    if (!g.whNode) return fail(res, 422, 'WAREHOUSE_NOT_LOCATED', `Kho ${g.wh?.name ?? ''} chưa có toạ độ — chấm ghim kho ở Cài đặt WMS → Kho trước.`)
    const todo = await unmeasured([...g.nodes.map(n => ({ from: g.whNode!, to: n })), ...custPairs(g.nodes)])
    const r = await measurePairs(todo, { maxCalls: 200 })
    const pending = (await unmeasured([...g.nodes.map(n => ({ from: g.whNode!, to: n })), ...custPairs(g.nodes)])).length
    return ok(res, { ...r, pending, located: g.nodes.length, unlocated: g.customers.length - g.nodes.length })
  } catch (e) {
    if (e instanceof GeoNotConfigured) return fail(res, 422, 'GEO_NOT_CONFIGURED', e.message)
    return failAny(res, e)
  }
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

/** Cấu hình Loại kho cho một kế hoạch ĐANG MỞ: danh sách "đi kèm đơn" lấy từ BẢN CHỤP của kế hoạch (`params.follow_categories`),
 *  cùng nguồn với máy ghép (`engineParams`). 01/10: Tối ưu lại đọc cờ SỐNG để nạp OD (dòng xe được vào, Loại kho chính) còn máy ghép đọc
 *  bản chụp ⇒ gói QA 61 tạm bật "đi kèm" cho FG01 trên staging 35 s, lượt Tối ưu lại của người dùng rơi đúng cửa sổ đó: Blue Star khai
 *  Xe 4/6 pallet riêng mà OD chụp danh sách của kênh (16/17) — hai cửa cùng một kế hoạch khác luật. Đổi cờ ⇒ "Lập lại" mới áp. */
async function planCatCfg(plan: PlanRow): Promise<CatCfg> {
  const cfg = await getDispatchCategoryConfig()
  return { ...cfg, follow: engineParams(plan).follow_categories ?? cfg.follow }
}
function engineParams(plan: PlanRow): EngineInput['params'] {
  const params = (plan.params ?? {}) as { max_drops?: number; allow_mix_channels?: boolean; underload_pct?: number | null; code_prefix?: string; start_seq?: number; allow_mix_categories?: boolean; follow_categories?: string[]; combo_conditions?: string[]; max_vehicles?: number; load_bands?: unknown; load_bypass?: boolean; detour_pct?: number | null }
  // kế hoạch lập trước 26/09 không có `allow_mix_categories` ⇒ undefined = cho trộn loại như lúc nó được lập;
  // lập trước 27/09 không có `max_vehicles` ⇒ một xe / thẻ như lúc nó được lập; `pallet_max_stops` của kế hoạch cũ bỏ qua (29/09)
  return { day: plan.plan_date, max_drops: params.max_drops ?? null, allow_mix_channels: params.allow_mix_channels ?? false, underload_pct: params.underload_pct ?? null, code_prefix: params.code_prefix ?? '', start_seq: params.start_seq ?? 1,
    allow_mix_categories: params.allow_mix_categories, follow_categories: params.follow_categories ?? [], combo_conditions: params.combo_conditions ?? [], max_vehicles: params.max_vehicles ?? 1,
    load_bands: loadBandsOf(params.load_bands), load_bypass: params.load_bypass === true, detour_pct: numOrNull(params.detour_pct) }
}
/** Tính lại MỘT chuyến theo dòng xe/ĐVVT đang chọn và các OD ĐANG nằm trên xe — KHÔNG ghi (bàn ghép xe dùng để xem trước khi thả). */
function computeTripPatch(plan: PlanRow, trip: TripRow & { ods: TripOdRow[] }, modelId: string | null, carrierId: string | null, refs: Refs, whUnderloadPct: number | null, condLabels: Record<string, string> = {}) {
  const params = engineParams(plan)
  const ctx = buildCtx({ ods: [], ...refs, share_actual: {}, params })
  // dải tải theo cha của KẾ HOẠCH (01/10) đi vào bản sao dòng xe — % tải, Non tải, "vượt" của xe sửa tay đọc cùng dải máy ghép
  const banded = withLoadBands(refs.models, params)
  const model = modelId ? banded.find(m => m.id === modelId) ?? null : null
  const carrier = carrierId ? refs.carriers.find(c => c.id === carrierId) ?? null : null
  const lines = trip.ods.map(o => ({ material_code: '', qty_base: 0, pallets: o.pallets == null ? null : Number(o.pallets), kg: o.tons == null ? null : Number(o.tons) * 1000, category: null, condition: null }))
  const sum = trip.ods.length ? sumLines(lines) : { pallets: 0, tons: 0 }
  const wards = uniq(trip.ods.map(o => o.ward_code).filter((x): x is string => !!x))
  const stops = trip.ods.length ? Math.max(uniq(trip.ods.map(o => o.ship_to_code ?? o.od_number)).length, 1) : 0
  const prev = detailOf(trip)
  // Điều kiện bảo quản + cửa đặt lịch SUY TỪ OD đang trên xe (dòng mới mang sẵn) — chuyển OD mà hai thứ này đứng yên là
  // hàng lạnh lên xe thường không ai báo. Dòng cũ (kế hoạch lập trước 25/09) không có thì giữ bản chụp lúc máy lập.
  const fromOds = trip.ods.length > 0 && trip.ods.every(o => o.cat_load != null)
  const conds = fromOds ? uniq(trip.ods.flatMap(o => o.conditions ?? [])).sort() : (prev.conditions ?? []).filter(Boolean)
  const catLoads = trip.ods.map(o => (o.cat_load ?? {}) as Record<string, number>)
  const categories = fromOds ? uniq(catLoads.flatMap(m => Object.keys(m))).sort() : prev.categories
  const booking = fromOds ? bookingFromCatLoads(catLoads) : prev.booking_category
  const warnings: string[] = []
  // Luật 11: thẻ nhiều xe — dòng xe chính + các xe phụ (`extra_vehicle_model_ids`); dòng xe phụ đã ngừng dùng thì bỏ ra
  const extras = model ? (trip.extra_vehicle_model_ids ?? []).map(id => banded.find(m => m.id === id)).filter((m): m is EngineModel => !!m) : []
  const fleet = model ? [model, ...extras] : []
  const loadModel = fleet.length > 1 ? comboModel(fleet) : model
  let freight: TripFreight
  let vehicles: TripVehicle[] = model ? [{ model, pallets: sum.pallets, tons: sum.tons, freight: null }] : []
  if (!trip.ods.length) freight = { total: null, base: null, billed_pallets: null, unit: null, tariff_id: null, ward: null, surcharges: [], reason: 'Xe trống' }
  else if (!model) freight = { total: null, base: null, billed_pallets: null, unit: null, tariff_id: null, ward: null, surcharges: [], reason: 'Chưa chọn dòng xe con' }
  else if (!carrier) {
    freight = { total: null, base: null, billed_pallets: null, unit: model.tariff_unit, tariff_id: null, ward: null, surcharges: [], reason: 'Chưa chọn ĐVVT' }
    if (fleet.length > 1) { const sh = splitLoad(fleet, sum.pallets, sum.tons); vehicles = fleet.map((m, i) => ({ model: m, pallets: sh?.[i].pallets ?? null, tons: sh?.[i].tons ?? null, freight: null })) }
  } else { const pc = priceCombo(ctx, fleet, carrier.id, wards, stops, sum.pallets, sum.tons); freight = pc.freight; vehicles = pc.parts }
  const load = tripLoad(loadModel, sum.pallets, sum.tons, whUnderloadPct ?? params.underload_pct ?? null)
  const maxPct = load.max_pct ?? 100
  // Vượt tải KHÔNG chặn (user chốt 25/09: "cho thả, đánh dấu đỏ") — xe vượt là việc Cần xử lý + hộp thoại Xác nhận nhắc lại.
  // 01/10: "vượt" = quá TRẦN DẢI TẢI của dòng xe cha (vd 105 %), không phải quá 100 % — trong dải là máy được xếp, người cũng vậy.
  if (model && load.pct != null && load.pct > maxPct) warnings.push(fleet.length > 1 ? `Vượt sức chứa ${fleet.length} xe cộng lại (${load.pct}% > trần ${maxPct}%) — thêm xe hoặc tách OD` : `Vượt sức chứa dòng xe ${model.name} (${load.pct}% > trần ${maxPct}%)`)
  if (fleet.length > 1 && uniq(fleet.map(basisOf)).length > 1)
    warnings.push('Các xe trên thẻ đo sức chứa khác nhau (pallet / tấn) — % tải chỉ tính gần đúng')
  // Xe không có dòng xe mà IM LẶNG là lỗi đã gặp (Ba Vì 25/09: 2 xe kéo tay "chưa chọn dòng xe" không một cảnh báo nào)
  if (!model && trip.ods.length) warnings.push(`Chưa có dòng xe (xe đang chở ${sum.pallets ?? '?'} pallet / ${sum.tons ?? '?'} tấn) — bấm vào xe để chọn dòng xe, hoặc tách bớt OD`)
  // 28/09: trần = nhỏ nhất trong (dòng xe · điểm giao của kho · khách/kênh khắt khe nhất trên xe); mọi tầng trống = không giới hạn
  // (29/09: không còn "kiểu đi" — xe pallet chỉ một khách là `max_drops = 1` khai ở Mã dòng xe)
  const caps = [model?.max_drops ?? null, params.max_drops, odStopsCap(trip.ods)].filter((n): n is number => typeof n === 'number')
  const maxDrops = caps.length ? Math.min(...caps) : null
  if (trip.ods.length && maxDrops != null && stops > maxDrops) warnings.push(`Vượt số khách cùng xe (${stops} > ${maxDrops})`)
  // Thẻ nhiều xe: MỖI xe phải qua đủ luật như xe chính — hỏi từng xe, câu cảnh báo nêu đúng tên xe
  for (const m of uniq(fleet)) {
    // Người tự chọn dòng xe thì KHÔNG chặn (đây là bản nháp, người quyết) — nhưng phải nói ra khi xe không phục vụ đủ
    // điều kiện bảo quản của hàng trên xe, kẻo hàng lạnh lên xe thường mà màn hình im lặng.
    if (conds.length && !servesConditions(m, conds))
      warnings.push(`Dòng xe ${m.name} không phục vụ điều kiện bảo quản ${conds.map(c => condLabels[c] ?? c).join(' + ')}`)
    // Luật 10: khách chỉ được vào danh sách dòng xe đã khai — người tự chọn / kéo OD lên xe khác thì không chặn nhưng nói rõ khách nào
    // (khách chưa khai = danh sách rỗng, câu riêng ở dưới vòng lặp)
    // OD CHỈ hàng đi kèm (POSM) đi xe của đơn chính, không mang danh sách riêng (01/10 — cùng luật `followOnlyOd` của engine)
    const posmOnly = (o: TripOdRow) => params.allow_mix_categories === false && Object.keys((o.cat_load ?? {}) as Record<string, unknown>).length > 0
      && !mainCatsOf(Object.keys((o.cat_load ?? {}) as Record<string, unknown>).map(k => ({ category: k })), params.follow_categories ?? []).length
    const outList = trip.ods.filter(o => o.allowed_models?.length && !o.allowed_models.includes(m.id) && !posmOnly(o))
    if (outList.length) {
      const who = uniq(outList.map(o => o.ship_to_name ?? o.ship_to_code ?? o.od_number))
      warnings.push(`Khách ${who.slice(0, 2).join(', ')}${who.length > 2 ? '…' : ''} không được vào dòng xe ${m.name} (Khách hàng → Dòng xe được vào)`)
    }
  }
  // 28/09 (user: "khách không khai thì không chọn"): người vẫn tự đặt xe cho khách chưa khai được — không chặn, nhưng nói ra
  const undeclared = uniq(trip.ods.filter(o => Array.isArray(o.allowed_models) && !o.allowed_models.length).map(o => o.ship_to_name ?? o.ship_to_code ?? o.od_number))
  if (undeclared.length && trip.ods.length)
    warnings.push(`Khách ${undeclared.slice(0, 2).join(', ')}${undeclared.length > 2 ? '…' : ''} chưa khai Dòng xe được vào (Khách hàng — theo kênh hoặc riêng khách)`)
  // Luật 9: xe chở lẫn nhiều Loại kho chính mà switch của xe (không có thì của kế hoạch) đang TẮT — chỉ còn gặp khi một OD tự chứa
  // hai loại hoặc switch vừa tắt trên xe đang lẫn; cửa thả đã chặn ca kéo thêm (mixBlockReason)
  const mainCats = mainCatsOf(categories.map(c => ({ category: c })), params.follow_categories ?? [])
  if ((trip.allow_mix_categories ?? params.allow_mix_categories) === false && mainCats.length > 1)
    warnings.push(`Xe chở lẫn ${mainCats.join(' + ')} — switch "Ghép Loại kho khác" của xe đang tắt`)
  const detail: Detail = {
    ...prev, freight, load, warnings, merge_hint: null, conditions: conds, categories, booking_category: booking,
    // chỉ chuyển OD (ĐVVT giữ nguyên) thì lý do chọn ĐVVT của máy vẫn đúng; người đổi ĐVVT thì lý do là người
    carrier_reasons: carrier ? (carrier.id === trip.transport_company_id ? prev.carrier_reasons : ['Người điều vận chọn']) : [],
    vehicle_model: model ? { id: model.id, sap_code: model.sap_code, name: model.name, parent_type_name: model.parent_type_name } : null,
    vehicles: vehiclesRef(vehicles),
    carrier: carrier ? carrierRef(carrier) : null,
  }
  // chuyến ĐVVT đã từ chối mà người sửa lại ⇒ về nháp để chốt lại; ghi chú từ chối giữ nguyên trên dòng làm vết
  return {
    vehicle_model_id: model?.id ?? null, extra_vehicle_model_ids: extras.map(m => m.id), transport_company_id: carrier?.id ?? null,
    stops, wards, pallets: sum.pallets, tons: sum.tons, load_pct: load.pct, underload: load.pct != null && load.pct < load.underload_pct,
    oversize: load.pct != null && load.pct > maxPct, freight_estimated: freight.total, detail: asJson(detail), manual_edited: true,
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
      if (b.vehicle_model_id === undefined && b.vehicle_model_ids === undefined && b.transport_company_id === undefined && b.allow_mix_categories === undefined) { await writeSummary(plan); return ok(res, { ...trip, locked: b.locked }) }
    }
    if (b.allow_mix_categories !== undefined) {
      // switch trên thẻ xe — ghi cột rồi tính lại (cảnh báo "xe chở lẫn" đổi theo switch)
      const { error } = await db.from('dispatch_trip').update({ allow_mix_categories: b.allow_mix_categories, updated_at: now() }).eq('id', trip.id)
      if (error) throw error
      trip.allow_mix_categories = b.allow_mix_categories
    }
    const wh = await loadWarehouse(plan.warehouse_id)
    const wards = uniq(trip.ods.map(o => o.ward_code).filter((x): x is string => !!x))
    const [refs, condLabels] = await Promise.all([loadRefs(plan.warehouse_id, plan.plan_date, wards), loadConditionLabels()])
    let modelId = b.vehicle_model_id === undefined ? trip.vehicle_model_id : b.vehicle_model_id
    let carrierId = b.transport_company_id === undefined ? trip.transport_company_id : b.transport_company_id
    // chọn MỘT dòng xe ⇒ thẻ về một xe; chọn danh sách ⇒ thẻ nhiều xe (người quyết tổ hợp, máy chia tải + tính cước từng xe)
    if (b.vehicle_model_ids) {
      const bad = b.vehicle_model_ids.find(id => !refs.models.some(m => m.id === id))
      if (bad) return fail(res, 400, 'VEHICLE_MODEL_INVALID', 'Có dòng xe không tồn tại, đang ngừng dùng hoặc chưa gán dòng xe cha')
      modelId = b.vehicle_model_ids[0]
      trip.extra_vehicle_model_ids = b.vehicle_model_ids.slice(1)
    } else if (b.vehicle_model_id !== undefined) trip.extra_vehicle_model_ids = []
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
    // thẻ nhiều xe ⇒ giá của ĐVVT = Σ cước từng xe (cùng `priceCombo` với cửa PATCH trip — số trên danh sách = số xe nhận)
    const fleet = model ? [model, ...(trip.extra_vehicle_model_ids ?? []).map(id => refs.models.find(m => m.id === id)).filter((m): m is EngineModel => !!m)] : []
    const items = refs.carriers.map(c => {
      const fr = model && trip.ods.length ? priceCombo(ctx, fleet, c.id, wards, stops, sum.pallets, sum.tons).freight : null
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
      const tg = (await db.from('dispatch_trip').select('id, plan_id, status, group_code, allow_mix_categories').eq('id', targetId).maybeSingle()).data
      if (!tg || tg.plan_id !== plan.id) return fail(res, 'Chuyến đích không thuộc cùng kế hoạch', 400)
      if (tg.id === src.id) return fail(res, 'Chuyến đích trùng chuyến nguồn', 400)
      const tgSt = (tg.status as TripStatus) ?? 'DRAFT'
      if (!EDITABLE_TRIP.includes(tgSt)) return fail(res, 409, 'TRIP_NOT_EDITABLE', `Xe đích ${tg.group_code} ${TRIP_STATUS_VI[tgSt]} — không nhận thêm OD ở đây; đổi ở tab Kế hoạch xuất.`)
      const tgOds0 = ((await db.from('dispatch_trip_od').select('cat_load').eq('trip_id', tg.id)).data ?? []) as { cat_load: unknown }[]
      const mix = mixBlockReason(tg.allow_mix_categories ?? engineParams(plan).allow_mix_categories, tgOds0, moving, engineParams(plan).follow_categories)
      if (mix) return fail(res, 409, 'CATEGORY_MIX_BLOCKED', `Xe ${tg.group_code}: ${mix}`)
    } else {
      // tách ra chuyến MỚI: STT kế tiếp trong nháp, kế thừa dòng xe/ĐVVT của chuyến nguồn
      const params = (plan.params ?? {}) as { code_prefix?: string }
      const { data: maxRow } = await db.from('dispatch_trip').select('seq').eq('plan_id', plan.id).order('seq', { ascending: false }).limit(1).maybeSingle()
      const seq = Number(maxRow?.seq ?? 0) + 1
      targetId = randomUUID()
      const { error } = await db.from('dispatch_trip').insert({
        id: targetId, plan_id: plan.id, seq, group_code: `${params.code_prefix ?? ''}${seq}`,
        vehicle_model_id: src.vehicle_model_id, extra_vehicle_model_ids: src.extra_vehicle_model_ids ?? [], transport_company_id: src.transport_company_id,
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
/** THUÊ một kế hoạch cho thao tác DỰNG LẠI / CHÈN dòng OD (ghép · tối ưu lại · nạp OD mới · thay OD · cập nhật theo SAP) — hai
 *  người cùng bấm thì chỉ một người chạy, người sau 409 PLAN_BUSY. Đo 27/09 tối (check-app): hai lượt "Xác nhận & ghép" đồng thời
 *  trên Bàu Bàng 173 OD ⇒ 150 xe, MỌI OD nằm hai xe, cả hai 200. Bản vá đầu (CAS trên updated_at lúc vào) chỉ chặn khi hai người
 *  đọc CÙNG lúc — người tới sau 100 ms đọc mốc mới rồi cũng qua. Thuê có hạn 90 s (tiến trình chết thì tự nhả), nhả ở finally.
 *  KHÔNG thử lại: lượt thua không có gì để làm, chạy lại là vứt kết quả người thắng. */
const LEASE_MS = 90_000
async function leasePlan(planId: string): Promise<string | null> {
  const token = randomUUID()
  const { data, error } = await db.from('dispatch_plan').update({ busy_until: new Date(Date.now() + LEASE_MS).toISOString(), busy_token: token })
    .eq('id', planId).or(`busy_until.is.null,busy_until.lt."${now()}"`).select('id')
  if (error) throw error
  return (data ?? []).length === 1 ? token : null
}
async function releasePlan(planId: string, token: string) {
  const { error } = await db.from('dispatch_plan').update({ busy_until: null, busy_token: null }).eq('id', planId).eq('busy_token', token)
  if (error) console.error('[dispatch] nhả thuê kế hoạch hỏng', planId, error.message)   // hết hạn 90 s thì tự nhả
}
/** Bọc một cửa `/plans/:id/...` bằng thuê kế hoạch. Không thuê được mà kế hoạch không tồn tại ⇒ để cửa tự trả 404 / 403 như cũ. */
const withPlanLease = (h: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id)
    const token = await leasePlan(id)
    if (!token) {
      const { data } = await db.from('dispatch_plan').select('id').eq('id', id).maybeSingle()
      if (data) return fail(res, 409, 'PLAN_BUSY', 'Kế hoạch đang được người khác cập nhật (ghép / nạp OD / thay OD) — đợi vài giây, tải lại trang rồi làm tiếp.')
      return h(req, res)
    }
    // NHẢ TRƯỚC KHI TRẢ LỜI: nhả trong finally là nhả SAU khi phản hồi đã đi — người bấm tiếp ngay (thay OD rồi cập nhật OD khác)
    // gặp 409 PLAN_BUSY oan (bậc full 27/09 bắt ở gói 61 [10o][15e3]). Trên serverless việc chạy sau phản hồi còn có thể bị đóng băng.
    let released = false
    const release = async () => { if (!released) { released = true; await releasePlan(id, token) } }
    const send = res.json.bind(res)
    res.json = ((body: unknown) => { void release().finally(() => send(body)); return res }) as typeof res.json
    try { return await h(req, res) } finally { await release() }
  } catch (e) { return failAny(res, e) }
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
const rowAsEngineOd = (o: TripOdRow): EngineOd => ({ od_number: o.od_number, ship_to_code: o.ship_to_code, ship_to_name: o.ship_to_name, ward_code: o.ward_code, region_code: o.region_code ?? null, channel: null, flow: o.is_transfer ? 'STO' : 'SALE', lines: [], allowed_models: o.allowed_models ?? null, separate: o.separate === true, max_customers: o.max_customers ?? null })
/** Xe còn OD mà CHƯA có dòng xe ⇒ máy chọn (ba bậc, trong danh sách dòng xe khách được vào) trước khi tính lại — sửa trên object, repriceTrip ghi. */
async function fillMissingVehicles(plan: PlanRow, trips: PlanTrip[], all: PlanTrip[]) {
  const need = trips.filter(t => t.ods.length && !t.vehicle_model_id)
  if (!need.length) return
  const wards = uniq(need.flatMap(t => t.ods.map(o => o.ward_code)).filter((x): x is string => !!x))
  const refs = await loadRefs(plan.warehouse_id, plan.plan_date, wards)
  for (const t of need) {
    const sug = suggestVehicle({ ods: [], ...refs, share_actual: {}, params: engineParams(plan) },
      t.ods.map(o => ({ od: rowAsEngineOd(o), pallets: numOrNull(o.pallets), tons: numOrNull(o.tons), conditions: o.conditions ?? [] })), actualNow(plan, all))
    t.vehicle_model_id = sug.model?.id ?? null
    t.extra_vehicle_model_ids = sug.vehicles.slice(1).map(v => v.model.id)
    t.transport_company_id = t.transport_company_id ?? sug.carrier?.id ?? null
  }
}

/** Đặt mốc "đã xem" cho các dòng OD (chỉ dòng chưa có mốc) — trả map OD → mốc để dòng mới dựng lại mang theo. */
async function markReviewed(rows: TripOdRow[], actor: string | null, t: string): Promise<Map<string, Rev>> {
  const ids = rows.filter(o => !o.reviewed_at).map(o => o.id)
  for (let i = 0; i < ids.length; i += 300) {
    const { error } = await db.from('dispatch_trip_od').update({ reviewed_at: t, reviewed_by: actor, updated_at: t }).in('id', ids.slice(i, i + 300)).is('reviewed_at', null)
    if (error) throw error
  }
  return new Map(rows.map(o => [o.od_number, o.reviewed_at ? { at: o.reviewed_at, by: o.reviewed_by } : { at: t, by: actor }] as const))
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
      const mix = mixBlockReason(tg.allow_mix_categories ?? engineParams(plan).allow_mix_categories, tg.ods.filter(o => !ids.includes(o.id)), rows, engineParams(plan).follow_categories)
      if (mix) return fail(res, 409, 'CATEGORY_MIX_BLOCKED', `Xe ${tg.group_code}: ${mix}`)
      targetId = tg.id
    } else if (b.to === 'new') {
      const mix = mixBlockReason(engineParams(plan).allow_mix_categories, [], rows, engineParams(plan).follow_categories)
      if (mix) return fail(res, 409, 'CATEGORY_MIX_BLOCKED', mix)
      // xe mới: máy chọn dòng xe + ĐVVT theo đúng ba bậc của lượt ghép (người vẫn đổi được)
      const wards = uniq(rows.map(o => o.ward_code).filter((x): x is string => !!x))
      const refs = await loadRefs(plan.warehouse_id, plan.plan_date, wards)
      const sug = suggestVehicle({ ods: [], ...refs, share_actual: {}, params: engineParams(plan) },
        rows.map(o => ({ od: rowAsEngineOd(o), pallets: numOrNull(o.pallets), tons: numOrNull(o.tons), conditions: o.conditions ?? [] })), actualNow(plan, full.trips))
      const seq = Math.max(0, ...full.trips.map(x => x.seq)) + 1
      targetId = randomUUID()
      const { error } = await db.from('dispatch_trip').insert({
        id: targetId, plan_id: plan.id, seq, group_code: `${engineParams(plan).code_prefix}${seq}`,
        vehicle_model_id: sug.model?.id ?? null, extra_vehicle_model_ids: sug.vehicles.slice(1).map(v => v.model.id), transport_company_id: sug.carrier?.id ?? null, stops: 0, wards: [],
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
    // switch "Ghép Loại kho khác" của xe đang tắt ⇒ rê qua là thấy NGAY xe không nhận, không phải thả rồi mới biết
    const blocked = mixBlockReason(tg.allow_mix_categories ?? engineParams(plan).allow_mix_categories, tg.ods, moving, engineParams(plan).follow_categories)
    const next = { ...tg, ods: [...tg.ods, ...moving] }
    const wh = await loadWarehouse(plan.warehouse_id)
    const wards = uniq(next.ods.map(o => o.ward_code).filter((x): x is string => !!x))
    const [refs, condLabels] = await Promise.all([loadRefs(plan.warehouse_id, plan.plan_date, wards), loadConditionLabels()])
    const p = computeTripPatch(plan, next, tg.vehicle_model_id, tg.transport_company_id, refs, numOrNull(wh?.dispatch_underload_pct), condLabels)
    const d = p.detail as unknown as Detail
    return ok(res, {
      trip_id: tg.id, pallets: p.pallets, tons: p.tons, stops: p.stops, load_pct: p.load_pct, underload: p.underload, oversize: p.oversize,
      freight_estimated: p.freight_estimated, freight_before: tg.freight_estimated, freight_reason: d.freight.reason, warnings: d.warnings,
      blocked,
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
// `ids` (27/09): chỉ ghép CÁC DÒNG OD ĐÃ CHỌN ở khung chờ thành xe mới; mọi xe đang có giữ nguyên.
// Khung chờ = OD trạng thái ĐIỀU (27/09 tối, user: "dữ liệu mới không có trong Đã điều thì mặc định là Điều") — máy ghép MỌI OD
// ở khung chờ; OD không đi thì người chuyển sang "Không điều ngày này" / "Không điều" ở bảng Xem đơn trước khi bấm.
// `review_all` giữ cho bundle cũ (nay trùng nghĩa mặc định); mốc reviewed_at chỉ còn là VẾT ai bấm ghép lúc nào.
// `load_bands` / `load_bypass` (01/10): dải tải theo dòng xe cha CHO LƯỢT GHÉP NÀY — ghi vào params kế hoạch (và nhớ cho kho) trước khi máy chạy
export const zReoptimize = z.object({ ids: z.array(zId).min(1).max(1000).optional(), review_all: zBool.optional(), load_bands: zLoadBands.optional(), load_bypass: zBool.optional() })
/** Ghi dải tải / bypass vào params của kế hoạch đang mở (+ nhớ dải cho kho). Trả về true khi có gì đổi. */
async function applyLoadBands(plan: PlanRow, b: { load_bands?: Record<string, LoadBand>; load_bypass?: boolean }, t: string): Promise<boolean> {
  if (b.load_bands === undefined && b.load_bypass === undefined) return false
  const pp = (plan.params ?? {}) as Record<string, unknown>
  const next = { ...pp, ...(b.load_bands !== undefined ? { load_bands: loadBandsOf(b.load_bands) } : {}), ...(b.load_bypass !== undefined ? { load_bypass: b.load_bypass === true } : {}) }
  const { error } = await db.from('dispatch_plan').update({ params: asJson(next), updated_at: t }).eq('id', plan.id)
  if (error) throw error
  plan.params = asJson(next)
  if (b.load_bands !== undefined) await rememberLoadBands(plan.warehouse_id, loadBandsOf(b.load_bands))
  return true
}
async function reoptimizePlanInner(req: Request, res: Response) {
  try {
    const b = (req.body ?? {}) as z.infer<typeof zReoptimize>
    const got = await loadOpenPlan(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    const wh = await loadWarehouse(plan.warehouse_id)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    const bandsChanged = await applyLoadBands(plan, b, now())
    const full = (await readPlan(plan.id))!
    let redo = full.trips.filter(t => !t.locked && EDITABLE_TRIP.includes(statusOf(t)))
    let src = full.pool
    if (b.ids) {
      const want = new Set(b.ids)
      src = full.pool.filter(o => want.has(o.id))
      if (src.length !== want.size) return fail(res, 404, 'NOT_IN_POOL', 'Có dòng OD đã chọn không còn ở khung chờ (vừa có người kéo lên xe — tải lại trang)')
      redo = []
    }
    const keep = full.trips.filter(t => !redo.includes(t))
    // dải tải vừa đổi ⇒ xe GIỮ NGUYÊN (khoá / không ghép lại) cũng phải đọc dải mới, kẻo hai xe cạnh nhau hai thước Non tải
    if (bandsChanged) await repriceMany(plan, keep.filter(t => EDITABLE_TRIP.includes(statusOf(t))))
    const odNos = uniq([...redo.flatMap(t => t.ods), ...src].map(o => o.od_number))
    if (!odNos.length) return fail(res, 422, 'NOTHING_TO_OPTIMIZE', 'Không còn OD nào ngoài các xe đã khoá — mở khoá xe hoặc kéo OD về khung chờ trước.')
    const t0 = now()
    const revBy = new Map([...redo.flatMap(x => x.ods).map(o => [o.od_number, { at: o.reviewed_at ?? t0, by: o.reviewed_by }] as const), ...await markReviewed(src, req.user?.name ?? null, t0)])
    const cand = await loadCandidates(wh, plan.plan_date, await planCatCfg(plan), { onlyOds: odNos, skipPlanId: plan.id })
    const wards = uniq(cand.ods.map(o => o.ward_code).filter((x): x is string => !!x))
    const [refs, condition_labels] = await Promise.all([loadRefs(wh.id, plan.plan_date, wards), loadConditionLabels()])
    const startSeq = Math.max(0, ...full.trips.map(x => x.seq)) + 1
    const result = runDispatch({ ods: cand.ods, ...refs, share_actual: actualNow(plan, keep), condition_labels, params: { ...engineParams(plan), start_seq: startSeq }, geo: await engineGeo(wh.id, cand.ods) })
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
      freight_estimated: tr.freight.total, detail: asJson(tripDetail(tr)), manual_edited: false, status: 'DRAFT',
      extra_vehicle_model_ids: tr.vehicles.slice(1).map(v => v.model.id), updated_at: t,
    }))
    for (let i = 0; i < tripRows.length; i += CHUNK) {
      const { error } = await db.from('dispatch_trip').insert(tripRows.slice(i, i + CHUNK))
      if (error) throw error
    }
    await insertOdRows(result.trips.flatMap((tr, i) => tr.ods.map(o => odRow(plan.id, tripRows[i].id, o, cand.meta.get(o.od_number), t, revBy.get(o.od_number) ?? { at: t, by: req.user?.name ?? null }))))
    // kế hoạch chưa có mốc máy lập (bước Xem đơn đi trước) ⇒ lần ghép đầu là mốc để dải chỉ số so người sửa với máy
    const pp = (plan.params ?? {}) as Record<string, unknown>
    if (pp.baseline == null) {
      const params2 = { ...pp, baseline: { trips: result.summary.trips, freight_total: result.summary.freight_total, pallets: result.summary.pallets, underload: result.summary.underload, unpriced: result.summary.unpriced } }
      const { error } = await db.from('dispatch_plan').update({ params: asJson(params2), updated_at: t }).eq('id', plan.id)
      if (error) throw error
      plan.params = asJson(params2)
    }
    await writeSummary(plan)
    return ok(res, { ...(await readPlan(plan.id)), reoptimized: { trips: result.trips.length, kept: keep.length, left_in_pool: odNos.length - placed.length } })
  } catch (e) { return failAny(res, e) }
}

// ── PATCH /tms/dispatch/plans/:id/params — dải tải / bypass đổi NGAY TRÊN BÀN (01/10, user: "config chọn xong hiện lên bàn") ────
// Không ghép lại: mọi xe nháp tính lại % tải · Non tải · vượt theo dải mới (cùng `computeTripPatch` của mọi cửa sửa tay).
export async function updatePlanParams(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zPlanParams>
    const got = await loadOpenPlan(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    await applyLoadBands(plan, b, now())
    const full = (await readPlan(plan.id))!
    await repriceMany(plan, full.trips.filter(t => EDITABLE_TRIP.includes(statusOf(t))))
    await writeSummary(plan)
    return ok(res, await readPlan(plan.id))
  } catch (e) { return failAny(res, e) }
}

/** Tình trạng SỐNG của các OD trong kế hoạch so với ZSD02 hiện tại — cờ "cần xử lý" phát sinh SAU khi lập:
 *  SAP đã thay OD (sửa SO) · SAP đã bỏ OD · đã xuất kho · SAP đã điều cho ĐVVT khác · đã có người đưa vào Kế hoạch xuất. */
type OdFlag = { od_number: string; kind: 'REPLACED' | 'GONE' | 'SHIPPED' | 'SAP_ASSIGNED' | 'IN_PLAN' | 'CHANGED'; info: string | null; replaced_by?: string | null }
/** Bản chụp của OD trên kế hoạch (chữ ký dòng hàng + ghi chú) — để biết SAP đã SỬA cùng OD đó sau khi người xem. */
type OdSnap = { sig: string | null; note: string | null }
const snapsOf = (rows: TripOdRow[]) => new Map(rows.map(o => [o.od_number, { sig: o.sap_sig, note: o.note }] as const))
async function odFlags(odNos: string[], ownGroupCodes: string[], snaps: Map<string, OdSnap> = new Map(), slocs: string[] = [], day: string | null = null): Promise<OdFlag[]> {
  if (!odNos.length) return []
  const [rows, khvc] = await Promise.all([
    fetchAllByIdChunks(odNos, c => db.from('erp_outbound_orders').select('od_number, od_item, material_code, qty_base, note_delivery, storage_location, delivery_date, flow, sync_status, replaced_by_od, sap_dispatch_status, mat_doc, qty_issued_base, dvvt_raw, license_plate').in('od_number', c).order('od_number')) as Promise<(SigRow & { od_number: string; note_delivery: string | null; storage_location: string | null; delivery_date: string | null; flow: string | null; sync_status: string | null; replaced_by_od: string | null; sap_dispatch_status: string | null; mat_doc: string | null; qty_issued_base: number | string | null; dvvt_raw: string | null; license_plate: string | null })[]>,
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
    if (as) { out.push({ od_number: od, kind: 'SAP_ASSIGNED', info: `SAP đã điều: ${[as.dvvt_raw, as.license_plate].filter(Boolean).join(' · ') || 'đã điều phối'}` }); continue }
    // CÙNG OD mà SAP sửa (SL / dòng hàng / ghi chú giao hàng) sau khi chụp — kế hoạch đang tính tải + cước theo bản CŨ
    const snap = snaps.get(od)
    if (snap?.sig) {
      const active = inSlocs(live.filter(r => r.sync_status === 'ACTIVE'), slocs)
      const mine = day ? linesOfDay(active, day) : active   // ĐÚNG tập dòng lúc chụp (loadCandidates): Sloc của kho + luật dòng của ngày lập
      const qty = odSig(mine) !== snap.sig, cur = noteOf(mine), note = (cur ?? '') !== (snap.note ?? '')
      if (qty || note) out.push({ od_number: od, kind: 'CHANGED', info: [qty ? 'SAP đã sửa số lượng / dòng hàng' : null, note ? `ghi chú giao hàng đổi thành «${cur ?? 'trống'}»` : null].filter(Boolean).join(' · ') })
    }
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
    const liveRows = [...live.flatMap(t => t.ods), ...full.pool]
    const odNos = uniq(liveRows.map(o => o.od_number))
    const wh = await loadWarehouse(full.warehouse_id)
    const [flags, cand] = await Promise.all([
      odFlags(odNos, full.trips.filter(t => statusOf(t) === 'CONFIRMED').map(t => t.group_code), snapsOf(liveRows), slocsOf(wh), full.plan_date),
      wh ? loadCandidates(wh, full.plan_date, { condByCat: new Map(), follow: [], all: [] }, { skipPlanId: full.id, countOnly: true }) : Promise.resolve(null),
    ])
    const inPlan = new Set([...full.trips.flatMap(t => t.ods), ...full.pool].map(o => o.od_number))
    for (const u of (full.unplanned ?? []) as { od_number?: string }[]) if (u?.od_number) inPlan.add(u.od_number)   // máy đã thấy, không đo được tải
    const fresh = (cand?.include ?? []).filter(od => !inPlan.has(od))
    return ok(res, { flags, new_ods: fresh.length, new_od_numbers: fresh.slice(0, 50) })
  } catch (e) { return failAny(res, e) }
}

// POST /tms/dispatch/plans/:id/refresh-pool — nạp OD mới (ZSD02 vừa về, lũy tiến) vào KHUNG CHỜ của kế hoạch
async function refreshPoolInner(req: Request, res: Response) {
  try {
    const got = await loadOpenPlan(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    const wh = await loadWarehouse(plan.warehouse_id)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    const full = (await readPlan(plan.id))!
    const inPlan = new Set([...full.trips.flatMap(t => t.ods), ...full.pool].map(o => o.od_number))
    const cand = await loadCandidates(wh, plan.plan_date, await getDispatchCategoryConfig(), { skipPlanId: plan.id })
    const fresh = cand.ods.filter(o => !inPlan.has(o.od_number))
    const loadable = fresh.filter(o => LOADABLE_FLOW.has(o.flow) && o.lines.length)
    const t = now()
    // OD mới về vào khung chờ = tab Điều (user chốt 28/09: tự vào, gắn nhãn "Mới"). `fresh_ods` = OD về SAU khi lập kế hoạch
    // mà còn nằm khung chờ — nhãn tự hết khi OD lên xe; OD đã rời khung chờ thì lần nạp sau bỏ khỏi danh sách.
    await insertOdRows(loadable.map(o => odRow(plan.id, null, wholeOd(o), cand.meta.get(o.od_number), t, null)))
    const prev = (plan.params ?? {}) as Record<string, unknown>
    const inPool = new Set(full.pool.map(o => o.od_number))
    const fresh_ods = uniq([...((prev.fresh_ods ?? []) as string[]).filter(od => inPool.has(od)), ...loadable.map(o => o.od_number)])
    const params = { ...prev, excluded: cand.excluded, config_gaps: cand.gaps, fresh_ods }
    const { error } = await db.from('dispatch_plan').update({ params: asJson(params), updated_at: t }).eq('id', plan.id)
    if (error) throw error
    await writeSummary({ ...plan, params: asJson(params) })
    return ok(res, { ...(await readPlan(plan.id)), refreshed: { added: loadable.length, skipped_not_loadable: fresh.length - loadable.length } })
  } catch (e) { return failAny(res, e) }
}

// POST /tms/dispatch/plans/:id/replace-od — OD cũ bị SAP thay (sửa SO) ⇒ đưa OD MỚI vào đúng chỗ của OD cũ (xe hoặc khung chờ)
async function replaceOdInner(req: Request, res: Response) {
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
    if (tr && !SAP_SYNC_TRIP.includes(statusOf(tr))) return fail(res, 409, 'TRIP_NOT_EDITABLE', `Xe ${tr.group_code} ${TRIP_STATUS_VI[statusOf(tr)]} — không thay OD ở đây.`)
    const { data: repRow } = await db.from('erp_outbound_orders').select('replaced_by_od').eq('od_number', b.od_number).not('replaced_by_od', 'is', null).limit(1).maybeSingle()
    const newOd = repRow?.replaced_by_od ?? null
    if (!newOd) return fail(res, 422, 'NOT_REPLACED', `OD ${b.od_number} chưa được SAP thay bằng OD nào (ZSD02 chưa có OD mới cho dòng SO này).`)
    const elsewhere = all.filter(o => o.od_number === newOd && o.trip_id && o.trip_id !== tripId)
    if (elsewhere.length) return fail(res, 409, 'NEW_OD_ON_OTHER_TRIP', `OD mới ${newOd} đang nằm ở xe ${full.trips.find(x => x.id === elsewhere[0].trip_id)?.group_code ?? '?'} — kéo về một xe trước.`)
    const t = now()
    // người bấm "Thay bằng OD mới" là đã xem OD mới ⇒ đặt mốc đã xem (nó vào thẳng xe của OD cũ)
    const rev: Rev = { at: t, by: req.user?.name ?? null }
    const poolNew = all.filter(o => o.od_number === newOd && !o.trip_id)
    if (poolNew.length) {
      const { error } = await db.from('dispatch_trip_od').update({ trip_id: tripId, updated_at: t, ...(poolNew.some(o => !o.reviewed_at) ? { reviewed_at: rev.at, reviewed_by: rev.by } : {}) }).in('id', poolNew.map(o => o.id).slice(0, 300))
      if (error) throw error
    } else if (!all.some(o => o.od_number === newOd)) {
      const cand = await loadCandidates(wh, plan.plan_date, await planCatCfg(plan), { onlyOds: [newOd], skipPlanId: plan.id })
      const od = cand.ods.find(o => o.od_number === newOd)
      if (!od) {
        const ex = cand.excluded.find(x => x.od_number === newOd)
        return fail(res, 409, 'NEW_OD_NOT_AVAILABLE', `OD mới ${newOd} không đưa vào được${ex ? ` — ${ex.kind === 'SAP_ASSIGNED' ? 'SAP đã điều' : ex.kind === 'SHIPPED' ? 'đã xuất kho' : ex.kind === 'IN_PLAN' ? 'đã có trong Kế hoạch xuất' : 'đang nằm ở nháp khác'}${ex.info ? ` (${ex.info})` : ''}` : ' (chưa có trong ZSD02 hoặc không thuộc kho này)'}.`)
      }
      await insertOdRows([odRow(plan.id, tripId, wholeOd(od), cand.meta.get(newOd), t, rev)])
    }
    const { error } = await db.from('dispatch_trip_od').delete().in('id', olds.map(o => o.id).slice(0, 300))
    if (error) throw error
    const after = (await readPlan(plan.id))!
    await repriceMany(plan, after.trips.filter(x => x.id === tripId))
    await writeSummary(plan)
    return ok(res, { ...(await readPlan(plan.id)), replaced: { from: b.od_number, to: newOd } })
  } catch (e) { return failAny(res, e) }
}

// POST /tms/dispatch/plans/:id/resync-od — CÙNG OD mà SAP sửa (SL / dòng hàng / ghi chú) sau khi chụp ⇒ chụp lại theo ZSD02
// hiện tại, OD ở NGUYÊN chỗ (xe hoặc khung chờ; OD đang bị tách phần thì gom về chỗ của phần đầu), xe tính lại tải + cước.
// Người bấm là đã xem bản mới ⇒ mốc "đã xem" đặt lại. Kiểu đi (Pallet / Xá) người đã đổi trên nháp giữ nguyên.
async function resyncOdInner(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zReplaceOd>
    const got = await loadOpenPlan(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    const wh = await loadWarehouse(plan.warehouse_id)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    const full = (await readPlan(plan.id))!
    const olds = [...full.trips.flatMap(t => t.ods), ...full.pool].filter(o => o.od_number === b.od_number)
    if (!olds.length) return fail(res, 'OD không nằm trong kế hoạch này', 404)
    const tripBy = new Map(full.trips.map(t => [t.id, t]))
    const locked = olds.map(o => (o.trip_id ? tripBy.get(o.trip_id) : null)).find(t => t && !SAP_SYNC_TRIP.includes(statusOf(t)))
    if (locked) return fail(res, 409, 'TRIP_NOT_EDITABLE', `Xe ${locked.group_code} ${TRIP_STATUS_VI[statusOf(locked)]} — không cập nhật OD của xe này ở đây.`)
    const cand = await loadCandidates(wh, plan.plan_date, await planCatCfg(plan), { onlyOds: [b.od_number], skipPlanId: plan.id })
    const od = cand.ods.find(o => o.od_number === b.od_number)
    if (!od || !od.lines.length) {
      const ex = cand.excluded.find(x => x.od_number === b.od_number)
      return fail(res, 409, 'OD_NOT_AVAILABLE', `OD ${b.od_number} không còn đưa vào kế hoạch được${ex ? ` — ${ex.info ?? ex.kind}` : ' (SAP đã bỏ / thay OD này)'} — gỡ OD khỏi kế hoạch.`)
    }
    const t = now()
    const tripId = olds[0].trip_id
    const before = { pallets: olds.reduce((s, o) => s + Number(o.pallets ?? 0), 0), tons: olds.reduce((s, o) => s + Number(o.tons ?? 0), 0) }
    const { error } = await db.from('dispatch_trip_od').delete().in('id', olds.map(o => o.id).slice(0, 300)).eq('plan_id', plan.id)
    if (error) throw error
    const row = odRow(plan.id, tripId, wholeOd(od), cand.meta.get(od.od_number), t, { at: t, by: req.user?.name ?? null })
    await insertOdRows([row])
    const touched = uniq(olds.map(o => o.trip_id).filter((x): x is string => !!x))
    const after = (await readPlan(plan.id))!
    await repriceMany(plan, after.trips.filter(x => touched.includes(x.id) && x.ods.length))
    await writeSummary(plan)
    return ok(res, { ...(await readPlan(plan.id)), resynced: { od_number: od.od_number, pallets_before: Math.round(before.pallets * 1000) / 1000, pallets_after: row.pallets ?? null, tons_before: Math.round(before.tons * 1000) / 1000, tons_after: row.tons ?? null } })
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
  const bad = (await odFlags(subOds, [], snapsOf(subset.flatMap(t => t.ods)), slocsOf(await loadWarehouse(full.warehouse_id)), full.plan_date)).filter(f => f.kind !== 'IN_PLAN')
  if (bad.length) {
    const odOf = new Map(subset.flatMap(t => t.ods.map(o => [o.od_number, t.group_code] as const)))
    return { err: [`${bad.length} OD đổi tình trạng ở SAP từ lúc lập nháp — ${bad.slice(0, 5).map(f => `${f.od_number} (${odOf.get(f.od_number) ?? '?'}): ${f.info}`).join('; ')}${bad.length > 5 ? '…' : ''}. Trên bàn ghép xe: "Cập nhật theo SAP" (OD bị sửa) · "Thay bằng OD mới" (OD bị thay) · gỡ OD đã điều / đã xuất — rồi xác nhận lại.`, 409, 'OD_CHANGED_IN_SAP'] }
  }
  // MÃ HÀNG PHẢI CÓ TRONG DANH MỤC — chặn TẠI ĐÂY thay vì để đường derive từ chối sau khi đã ghi.
  // Vì sao (đo 24/09): 5 % dòng OD của SAP trỏ tới mã chưa đồng bộ sang WMS (4 mã: 810000020 ·
  // 510000442 · 510000444 · 510000440 ⇒ 47 OD Ba Vì + 19 OD Bàu Bàng). Đường `replanKhvcGroups`
  // → derive validate mã hàng và từ chối TRỌN GÓI ("18 chuyến xe lỗi — không upload"), nên xác nhận
  // 50 xe xong ra **0 chuyến** trong khi API vẫn trả 200. Chặn trước khi ghi thì không có trạng thái
  // nửa vời (kế hoạch đã vào sổ mà không chuyến nào), và người dùng biết ĐÍCH DANH mã phải khai.
  // Kiểm TRƯỚC "Loại kho booking": xe toàn mã lạ thì không có Loại kho — nói "khai mã X" mới là việc làm được (01/10).
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
        // luật 11: thẻ nhiều xe ⇒ Kế hoạch xuất ghi cả xe phụ để ĐVVT booking đủ xe (chuyến xuất vẫn MỘT biển — user chấp nhận lệch)
        extra_vehicle_model_ids: tr.vehicle_model_id ? (tr.extra_vehicle_model_ids ?? []) : [],
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

// ══ HOÃN / KHÔNG ĐIỀU (27/09, user: "đơn key một ngày nhưng có thể điều ngày khác · đơn note khác — không tự động được, user
// review đơn trước khi tự ghép") — dấu GIỮ qua mọi lần "Nạp OD mới" / lập lại. Bảng Xem đơn (27/09 tối) chia 4 tab theo dấu này:
// Điều (không dấu) · Không điều ngày này (có ngày) · Không điều (null) · Đã điều — chuyển qua lại được giữa ba tab đầu. ══
export const zHold = z.object({
  ids: z.array(zId).max(300).optional(),                   // dòng OD của kế hoạch (khung chờ hoặc xe còn sửa được) — tab Điều
  od_numbers: z.array(zText(1, 50)).max(300).optional(),   // OD ĐANG hoãn — đổi giữa "Không điều ngày này" ⇄ "Không điều"
  until: zDay.nullable(),                                  // null = KHÔNG ĐIỀU (tới khi chuyển lại Điều)
  reason: zText(1, 500).optional(),                        // tuỳ chọn — chuyển tab là một cú bấm, lý do ghi thêm nếu muốn
}).refine(v => (v.ids?.length ?? 0) + (v.od_numbers?.length ?? 0) > 0, { message: 'Chọn ít nhất một OD', path: ['ids'] })
export const zUnhold = z.object({ od_numbers: z.array(zText(1, 50)).min(1).max(300) })
const holdLabel = (until: string | null) => (until ? 'Không điều ngày này' : 'Không điều')
const heldExcluded = (holds: { od_number: string; hold_until: string | null; reason: string }[], detail: Map<string, ExcludedDetail | undefined>): ExcludedOd[] =>
  holds.map(h => ({ od_number: h.od_number, kind: 'HELD' as const, info: `${h.hold_until ? `hoãn tới ${h.hold_until}` : 'không điều'} — ${h.reason}`, until: h.hold_until, reason: h.reason, d: detail.get(h.od_number) }))
/** Thông tin để bảng in dòng OD vừa rời kế hoạch — lấy từ chính dòng OD trên nháp (đã đo tải bằng máy). */
const rowDetail = (rs: TripOdRow[]): ExcludedDetail | undefined => {
  const f = rs[0]
  if (!f) return undefined
  return { ship_to_code: f.ship_to_code, ship_to_name: f.ship_to_name, ward_code: f.ward_code, region_code: f.region_code, region_name: f.region_name,
    pallets: rs.reduce((x, o) => x + (Number(o.pallets) || 0), 0), tons: rs.reduce((x, o) => x + (Number(o.tons) || 0), 0), delivery_date: f.delivery_date, note: f.note }
}

// POST /tms/dispatch/plans/:id/hold — chuyển OD sang "Không điều ngày này" / "Không điều": OD rời kế hoạch (mọi phần), xe bị đụng tính lại.
// OD đang hoãn (od_numbers) thì chỉ đổi dấu — không nằm trên kế hoạch nên không xe nào phải tính lại.
async function holdOdsInner(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zHold>
    const got = await loadOpenPlan(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    if (b.until && b.until <= plan.plan_date) return fail(res, 400, 'HOLD_DATE_INVALID', `Ngày điều lại phải SAU ngày lập kế hoạch (${plan.plan_date}) — hoặc chọn "Không điều".`)
    const full = (await readPlan(plan.id))!
    const all = [...full.trips.flatMap(t => t.ods), ...full.pool]
    const ids = uniq(b.ids ?? [])
    const picked = all.filter(o => ids.includes(o.id))
    if (picked.length !== ids.length) return fail(res, 'Có dòng OD không thuộc kế hoạch này (tải lại trang)', 404)
    const tripBy = new Map(full.trips.map(t => [t.id, t]))
    const locked = picked.map(o => (o.trip_id ? tripBy.get(o.trip_id) : null)).find(t => t && !EDITABLE_TRIP.includes(statusOf(t)))
    if (locked) return fail(res, 409, 'TRIP_NOT_EDITABLE', `Xe ${locked.group_code} ${TRIP_STATUS_VI[statusOf(locked)]} — không hoãn OD của xe này ở đây.`)
    const planOds = uniq(picked.map(o => o.od_number))
    const heldOds = uniq(b.od_numbers ?? []).filter(od => !planOds.includes(od))
    const ods = [...planOds, ...heldOds]
    const t = now()
    const actor = req.user?.name ?? null
    const prev = (await fetchAllByIdChunks(ods, c => db.from('dispatch_od_hold').select('id, od_number').eq('warehouse_id', plan.warehouse_id).in('od_number', c).order('od_number'))) as { id: string; od_number: string }[]
    const idOf = new Map(prev.map(p => [p.od_number, p.id]))
    const notHeld = heldOds.filter(od => !idOf.has(od))
    if (notHeld.length) return fail(res, 404, 'NOT_HELD', `${notHeld.slice(0, 5).join(', ')} không đang ở "Không điều" của kho này (tải lại trang)`)
    const reason = b.reason?.trim() || holdLabel(b.until)
    const rows = ods.map(od => ({ id: idOf.get(od) ?? randomUUID(), warehouse_id: plan.warehouse_id, od_number: od, hold_until: b.until, reason, created_by: actor, updated_at: t }))
    const { error: hErr } = await db.from('dispatch_od_hold').upsert(rows, { onConflict: 'id' })
    if (hErr) throw hErr
    // MỌI phần của OD rời kế hoạch (OD đã bị máy tách thì các phần nằm ở nhiều xe)
    const leaving = all.filter(o => planOds.includes(o.od_number))
    const rowIds = leaving.map(o => o.id)
    for (let i = 0; i < rowIds.length; i += 300) {
      const { error } = await db.from('dispatch_trip_od').delete().in('id', rowIds.slice(i, i + 300)).eq('plan_id', plan.id)
      if (error) throw error
    }
    const params = (plan.params ?? {}) as { excluded?: ExcludedOd[] }
    const old = new Map((params.excluded ?? []).map(x => [x.od_number, x]))
    const detail = new Map<string, ExcludedDetail | undefined>(ods.map(od => [od, planOds.includes(od) ? rowDetail(leaving.filter(o => o.od_number === od)) : old.get(od)?.d]))
    const excluded = [...(params.excluded ?? []).filter(x => !ods.includes(x.od_number)), ...heldExcluded(rows, detail)]
    const p2 = { ...(plan.params as Record<string, unknown>), excluded }
    const { error: pErr } = await db.from('dispatch_plan').update({ params: asJson(p2), updated_at: t }).eq('id', plan.id)
    if (pErr) throw pErr
    const touched = uniq(leaving.filter(o => o.trip_id).map(o => o.trip_id!))
    const after = (await readPlan(plan.id))!
    await repriceMany(plan, after.trips.filter(x => touched.includes(x.id) && x.ods.length))
    // xe bị rút HẾT đơn ⇒ bỏ luôn (01/10: Ba Vì xe #2 / #10 trống mà vẫn ghi 3,3 pallet · 812 k, đếm vào Non tải) — khác kéo thả,
    // ở đó người có thể cố ý để xe trống làm chỗ thả
    const emptied = after.trips.filter(x => touched.includes(x.id) && !x.ods.length && EDITABLE_TRIP.includes(statusOf(x))).map(x => x.id)
    if (emptied.length) {
      const { error } = await db.from('dispatch_trip').delete().in('id', emptied.slice(0, 300)).eq('plan_id', plan.id)
      if (error) throw error
    }
    await writeSummary({ ...plan, params: asJson(p2) })
    return ok(res, { ...(await readPlan(plan.id)), held: { ods: ods.length, until: b.until, trips_removed: emptied.length } })
  } catch (e) { return failAny(res, e) }
}

// POST /tms/dispatch/plans/:id/unhold — bỏ hoãn: OD quay lại KHUNG CHỜ của kế hoạch này ngay (nếu vẫn chưa được lo ở đâu)
async function unholdOdsInner(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zUnhold>
    const got = await loadOpenPlan(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    const wh = await loadWarehouse(plan.warehouse_id)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    const ods = uniq(b.od_numbers)
    const { data: gone, error } = await db.from('dispatch_od_hold').delete().eq('warehouse_id', plan.warehouse_id).in('od_number', ods.slice(0, 300)).select('od_number')
    if (error) throw error
    if (!gone?.length) return fail(res, 404, 'NOT_HELD', 'Các OD này không đang hoãn ở kho này')
    const full = (await readPlan(plan.id))!
    const inPlan = new Set([...full.trips.flatMap(t => t.ods), ...full.pool].map(o => o.od_number))
    const cand = await loadCandidates(wh, plan.plan_date, await planCatCfg(plan), { onlyOds: ods, skipPlanId: plan.id })
    const back = cand.ods.filter(o => !inPlan.has(o.od_number) && LOADABLE_FLOW.has(o.flow) && o.lines.length)
    const t = now()
    // người bỏ hoãn là đã quyết OD này đi ⇒ về khung chờ với mốc ĐÃ XEM (ghép được ngay)
    await insertOdRows(back.map(o => odRow(plan.id, null, wholeOd(o), cand.meta.get(o.od_number), t, { at: t, by: req.user?.name ?? null })))
    const params = (plan.params ?? {}) as { excluded?: ExcludedOd[] }
    const p2 = { ...(plan.params as Record<string, unknown>), excluded: [...(params.excluded ?? []).filter(x => !(x.kind === 'HELD' && ods.includes(x.od_number))), ...cand.excluded.filter(x => x.kind !== 'HELD')] }
    const { error: pErr } = await db.from('dispatch_plan').update({ params: asJson(p2), updated_at: t }).eq('id', plan.id)
    if (pErr) throw pErr
    await writeSummary({ ...plan, params: asJson(p2) })
    return ok(res, { ...(await readPlan(plan.id)), unheld: { ods: gone.length, back_to_pool: back.length } })
  } catch (e) { return failAny(res, e) }
}

// ══ DÒNG XE ĐƯỢC VÀO CỦA KHÁCH — sửa ngay trên bàn ghép xe (27/09, user: "điều vận config được, nhưng đổi KÊNH thì kho làm sai")
// Cửa này CHỈ ghi `Customer.dispatch_vehicles` — kênh (quyết %Date bên kho) vẫn chỉ đổi ở trang Khách hàng. Lưu xong: OD của khách
// trên kế hoạch ĐANG MỞ này chụp lại danh sách + xe chở chúng tính lại cảnh báo ngay (không phải "Lập lại" mới thấy). ══
export const zShipToParam = z.object({ id: zId, shipTo: zText(1, 20) })
export const zCustVehicles = z.object({ dispatch_vehicles: z.record(z.string(), z.array(zId).max(100)).nullable() })
async function customerVehiclesCtx(shipTo: string) {
  const { data: cust, error } = await db.from('Customer').select('id, ship_to_code, name, channel, is_active, dispatch_vehicles').eq('ship_to_code', shipTo).maybeSingle()
  if (error) throw error
  if (!cust) return null
  const ch = cust.channel ? (await db.from('LookupValue').select('value, meta').eq('type', 'customer_channel').eq('value', cust.channel).maybeSingle()).data : null
  const meta = (ch?.meta ?? null) as { label?: string; dispatch_vehicles?: Record<string, unknown> } | null
  return { cust, channel_label: meta?.label ?? cust.channel ?? null, channel_vehicles: (meta?.dispatch_vehicles ?? null) as Record<string, unknown> | null }
}
export async function getCustomerVehicles(req: Request, res: Response) {
  try {
    const { data: plan } = await db.from('dispatch_plan').select('id, warehouse_id').eq('id', String(req.params.id)).maybeSingle()
    if (!plan) return fail(res, 'Không tìm thấy kế hoạch', 404)
    if (!whAllowed(req, plan.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const c = await customerVehiclesCtx(String(req.params.shipTo))
    if (!c) return fail(res, 404, 'CUSTOMER_NOT_FOUND', `Ship-to ${req.params.shipTo} chưa có trong danh mục Khách hàng — thêm ở trang Khách hàng trước.`)
    return ok(res, { ship_to_code: c.cust.ship_to_code, name: c.cust.name, channel: c.cust.channel, channel_label: c.channel_label, is_active: c.cust.is_active,
      dispatch_vehicles: c.cust.dispatch_vehicles ?? {}, channel_vehicles: c.cust.is_active === false || !c.cust.channel ? null : c.channel_vehicles })
  } catch (e) { return failAny(res, e) }
}
export async function setCustomerVehicles(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zCustVehicles>
    const got = await loadOpenPlan(req, String(req.params.id))
    if ('err' in got) return sendErr(res, got)
    const { plan } = got
    const c = await customerVehiclesCtx(String(req.params.shipTo))
    if (!c) return fail(res, 404, 'CUSTOMER_NOT_FOUND', `Ship-to ${req.params.shipTo} chưa có trong danh mục Khách hàng — thêm ở trang Khách hàng trước.`)
    const parsed = await parseDispatchVehicles(b.dispatch_vehicles)
    if ('err' in parsed) return fail(res, 400, 'VALIDATION', parsed.err)
    const t = now()
    const { error } = await db.from('Customer').update({ dispatch_vehicles: parsed.map, updated_by: req.user?.name ?? null, updated_at: t }).eq('id', c.cust.id)
    if (error) return fail(res, error)
    await logAdmin(req, { action: 'CUSTOMER_UPDATE', target_type: 'Customer', target_id: c.cust.id, target_label: `${c.cust.ship_to_code} — ${c.cust.name} (từ bàn ghép xe)`,
      before: { dispatch_vehicles: c.cust.dispatch_vehicles ?? {} }, after: { dispatch_vehicles: parsed.map } })
    // chụp lại danh sách dòng xe cho OD của khách trên kế hoạch này (theo Loại kho chính của TỪNG OD — cùng resolveAllowedModels)
    const follow = engineParams(plan).follow_categories ?? []
    const full = (await readPlan(plan.id))!
    const tripBy = new Map(full.trips.map(x => [x.id, x]))
    const mine = [...full.trips.flatMap(x => x.ods), ...full.pool].filter(o => o.ship_to_code === c.cust.ship_to_code && (!o.trip_id || EDITABLE_TRIP.includes(statusOf(tripBy.get(o.trip_id)!))))
    const chan = c.cust.is_active === false || !c.cust.channel ? null : c.channel_vehicles
    const byList = new Map<string, string[]>()
    const listOf = new Map<string, string[] | null>()
    for (const o of mine) {
      const l = resolveAllowedModels(parsed.map, chan, mainCatsOf(Object.keys((o.cat_load ?? {}) as Record<string, unknown>).map(k => ({ category: k })), follow))
      const k = JSON.stringify(l)
      listOf.set(k, l)
      byList.set(k, [...(byList.get(k) ?? []), o.id])
    }
    for (const [k, ids] of byList) {
      for (let i = 0; i < ids.length; i += 300) {
        const { error: e2 } = await db.from('dispatch_trip_od').update({ allowed_models: listOf.get(k) ?? null, updated_at: t }).in('id', ids.slice(i, i + 300))
        if (e2) throw e2
      }
    }
    const touched = uniq(mine.map(o => o.trip_id).filter((x): x is string => !!x))
    const after = (await readPlan(plan.id))!
    await repriceMany(plan, after.trips.filter(x => touched.includes(x.id)))
    await writeSummary(plan)
    return ok(res, { ...(await readPlan(plan.id)), customer_vehicles: { ship_to_code: c.cust.ship_to_code, dispatch_vehicles: parsed.map, ods_updated: mine.length, trips_repriced: touched.length } })
  } catch (e) { return failAny(res, e) }
}

export { pickBookingCategory }

export const reoptimizePlan = withPlanLease(reoptimizePlanInner)
export const refreshPool = withPlanLease(refreshPoolInner)
export const replaceOd = withPlanLease(replaceOdInner)
export const resyncOd = withPlanLease(resyncOdInner)
export const holdOds = withPlanLease(holdOdsInner)
export const unholdOds = withPlanLease(unholdOdsInner)

// ══ BẢNG XEM ĐƠN — thông tin SAP của từng OD (27/09 khuya, user: "thiếu nhiều thông tin quá: SO, người tạo, ghi chú đủ chưa,
// thùng, loại kho… và cần xem được detail"). Tách khỏi GET kế hoạch: bàn ghép xe gọi kế hoạch sau MỖI lần thả, còn mấy cột
// này chỉ tab Xem đơn cần — nhồi vào kế hoạch là bắt mọi lần thả kéo thêm vài nghìn dòng ZSD02. ══
type ReviewInfo = {
  so: string[]; so_types: string[]; created_by: string[]; note_delivery: string | null; note_invoice: string | null; customer_ref: string | null
  sold_to: string | null; route_name: string | null; od_created_at: string | null; flow: string | null
  lines: number; materials: number; qty_conv: number; units: string[]; categories: string[]
  replaces: { od: string; group_code: string | null }[]            // SO sửa ⇒ OD này THAY OD cũ (có thể đã điều ở xe khác)
  held_before: { until: string; reason: string; by: string | null } | null   // đã "Không điều ngày này", nay về lại Điều
}
async function planOdSet(planId: string): Promise<{ plan: PlanRow; ods: string[] } | null> {
  const { data: plan, error } = await db.from('dispatch_plan').select('*').eq('id', planId).maybeSingle()
  if (error) throw error
  if (!plan) return null
  const rows = (await fetchAllRowsParallel(() => db.from('dispatch_trip_od').select('od_number').eq('plan_id', planId).order('id'))) as { od_number: string }[]
  const p = (plan.params ?? {}) as { excluded?: ExcludedOd[] }
  const un = ((plan.unplanned ?? []) as { od_number?: string }[]).map(u => u?.od_number).filter((x): x is string => !!x)
  return { plan: plan as PlanRow, ods: uniq([...rows.map(r => r.od_number), ...(p.excluded ?? []).map(x => x.od_number), ...un]) }
}
type RevLine = { od_number: string; material_code: string | null; qty_base: number | string | null; so_number: string | null; so_type: string | null; note_delivery: string | null; note_invoice: string | null; customer_ref: string | null; sold_to_code: string | null; route_name: string | null; od_created_at: string | null; flow: string | null; created_by: string | null }

// GET /tms/dispatch/plans/:id/review — mỗi OD của kế hoạch (trên xe · khung chờ · không điều · đã điều) một khối thông tin SAP
export async function getPlanReview(req: Request, res: Response) {
  try {
    const got = await planOdSet(String(req.params.id))
    if (!got) return fail(res, 'Không tìm thấy kế hoạch', 404)
    const { plan, ods } = got
    if (!whAllowed(req, plan.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const [lines, olds, holds] = await Promise.all([
      fetchAllByIdChunks(ods, c => db.from('erp_outbound_orders')
        .select('od_number, material_code, qty_base, so_number, so_type, note_delivery, note_invoice, customer_ref, sold_to_code, route_name, od_created_at, flow, created_by:raw->>created_by')
        .in('od_number', c).neq('sync_status', 'OBSOLETE').order('od_number').order('od_item')) as Promise<RevLine[]>,
      // OD cũ mà SAP đã thay bằng OD của kế hoạch này (sửa SO)
      fetchAllByIdChunks(ods, c => db.from('erp_outbound_orders').select('od_number, replaced_by_od').in('replaced_by_od', c).order('od_number')) as Promise<{ od_number: string; replaced_by_od: string }[]>,
      fetchAllByIdChunks(ods, c => db.from('dispatch_od_hold').select('od_number, hold_until, reason, created_by').eq('warehouse_id', plan.warehouse_id).in('od_number', c).order('od_number')) as Promise<{ od_number: string; hold_until: string | null; reason: string; created_by: string | null }[]>,
    ])
    const oldOds = uniq(olds.map(o => o.od_number))
    const [mats, khvc] = await Promise.all([
      fetchAllByIdChunks(uniq(lines.map(l => l.material_code).filter((x): x is string => !!x)), c => db.from('Material')
        .select('material_code, category, base_unit, entry_unit, units_per_carton').in('material_code', c).order('material_code')) as Promise<{ material_code: string; category: string | null; base_unit: string | null; entry_unit: string | null; units_per_carton: number | null }[]>,
      oldOds.length ? fetchAllByIdChunks(oldOds, c => db.from('khvc_lines').select('do_no, group_code').in('do_no', c).order('do_no')) as Promise<{ do_no: string; group_code: string }[]> : Promise.resolve([] as { do_no: string; group_code: string }[]),
    ])
    const matBy = new Map(mats.map(m => [m.material_code, m]))
    const gcOf = new Map(khvc.map(k => [k.do_no, k.group_code]))
    const repBy = new Map<string, { od: string; group_code: string | null }[]>()
    for (const o of olds) { const l = repBy.get(o.replaced_by_od) ?? []; if (!l.some(x => x.od === o.od_number)) l.push({ od: o.od_number, group_code: gcOf.get(o.od_number) ?? null }); repBy.set(o.replaced_by_od, l) }
    const holdBy = new Map(holds.map(h => [h.od_number, h]))
    const byOd = new Map<string, RevLine[]>()
    for (const l of lines) { const a = byOd.get(l.od_number) ?? []; a.push(l); byOd.set(l.od_number, a) }
    const out: Record<string, ReviewInfo> = {}
    for (const od of ods) {
      const rs = byOd.get(od) ?? []
      const f = rs[0]
      const h = holdBy.get(od)
      const units = new Set<string>(), cats = new Set<string>()
      let conv = 0
      for (const r of rs) {
        const m = r.material_code ? matBy.get(r.material_code) : undefined
        // tổng CROSS-MÃ = quy về thùng TỪNG mã rồi mới cộng (luật base-unit); mã không có thùng giữ nguyên số base
        conv += qtyEntryDecimal(Number(r.qty_base) || 0, m)
        units.add(m && m.entry_unit && Number(m.units_per_carton) > 0 ? m.entry_unit : (m?.base_unit ?? '?'))
        if (m?.category) cats.add(m.category)
      }
      out[od] = {
        so: uniq(rs.map(r => r.so_number).filter((x): x is string => !!x)), so_types: uniq(rs.map(r => r.so_type).filter((x): x is string => !!x)),
        created_by: uniq(rs.map(r => r.created_by).filter((x): x is string => !!x)),
        note_delivery: noteOf(rs), note_invoice: uniq(rs.map(r => (r.note_invoice ?? '').trim()).filter(Boolean)).join(' · ') || null,
        customer_ref: uniq(rs.map(r => (r.customer_ref ?? '').trim()).filter(Boolean)).join(' · ') || null,
        sold_to: f?.sold_to_code ?? null, route_name: f?.route_name ?? null, od_created_at: f?.od_created_at ?? null, flow: f?.flow ?? null,
        lines: rs.length, materials: new Set(rs.map(r => r.material_code)).size, qty_conv: Math.round(conv * 1000) / 1000, units: [...units], categories: [...cats].sort(),
        replaces: repBy.get(od) ?? [],
        // hoãn có ngày đã tới ⇒ OD về lại Điều — nói ra lần hoãn trước (user chốt 27/09 khuya)
        held_before: h && h.hold_until && h.hold_until <= plan.plan_date ? { until: h.hold_until, reason: h.reason, by: h.created_by } : null,
      }
    }
    return ok(res, { ods: out })
  } catch (e) { return failAny(res, e) }
}

// GET /tms/dispatch/plans/:id/backlog — OD TỒN ĐỌNG (trong cửa sổ 14 ngày) mà máy đã loại vì đã đi / SAP đã điều / đã có trong
// Kế hoạch xuất / DO tạo lại. Không ghi vào params (hơn 2.000 dòng lịch sử ở kho lớn) — tab Đã điều tải theo yêu cầu (user 30/09:
// "170 đơn đi đâu mất, sao không nằm trong Đã điều").
export async function getPlanBacklog(req: Request, res: Response) {
  try {
    const got = await planOdSet(String(req.params.id))
    if (!got) return fail(res, 'Không tìm thấy kế hoạch', 404)
    const { plan } = got
    if (!whAllowed(req, plan.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const wh = await loadWarehouse(plan.warehouse_id)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    const cand = await loadCandidates(wh, plan.plan_date, { condByCat: new Map(), follow: [], all: [] }, { skipPlanId: plan.id, countOnly: true, reportAll: true })
    const kinds = new Set(['SHIPPED', 'SAP_ASSIGNED', 'IN_PLAN', 'REDO_DISPATCHED'])
    const excluded = cand.excluded.filter(x => kinds.has(x.kind) && x.d?.delivery_date !== plan.plan_date)
      .sort((a, b) => (b.d?.delivery_date ?? '').localeCompare(a.d?.delivery_date ?? '') || (a.d?.ship_to_name ?? '').localeCompare(b.d?.ship_to_name ?? '') || a.od_number.localeCompare(b.od_number))
    return ok(res, { excluded, backlog_days: BACKLOG_DAYS })
  } catch (e) { return failAny(res, e) }
}

// GET /tms/dispatch/plans/:id/ods/:od — các dòng ZSD02 của MỘT OD (panel chi tiết); OD phải thuộc kế hoạch này
export const zPlanOdParam = z.object({ id: zId, od: zText(1, 50) })
export async function getPlanOd(req: Request, res: Response) {
  try {
    const got = await planOdSet(String(req.params.id))
    if (!got) return fail(res, 'Không tìm thấy kế hoạch', 404)
    if (!whAllowed(req, got.plan.warehouse_id)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const od = String(req.params.od)
    if (!got.ods.includes(od)) return fail(res, 404, 'OD_NOT_IN_PLAN', `OD ${od} không thuộc kế hoạch này`)
    const { data: rows, error } = await db.from('erp_outbound_orders').select('*').eq('od_number', od).order('od_item').limit(500)
    if (error) throw error
    const codes = uniq((rows ?? []).map(r => r.material_code).filter((x): x is string => !!x))
    const mats = (await fetchAllByIdChunks(codes, c => db.from('Material').select('material_code, short_name, category, base_unit, entry_unit, units_per_carton').in('material_code', c).order('material_code'))) as { material_code: string; short_name: string | null; category: string | null; base_unit: string | null; entry_unit: string | null; units_per_carton: number | null }[]
    return ok(res, { od_number: od, lines: rows ?? [], materials: mats })
  } catch (e) { return failAny(res, e) }
}
