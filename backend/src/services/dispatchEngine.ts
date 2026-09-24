/**
 * ENGINE GHÉP CHUYẾN — thuần TS, không DB (plan TMS_DISPATCH mục 7; đợt 2, 24/09/2026). Máy ĐỀ XUẤT, người xác nhận.
 *
 * Đầu vào: pool OD của MỘT kho × MỘT ngày giao (đã có tải từng dòng hàng, phường, kênh, khách nội bộ), danh mục dòng xe
 * con, bảng cước + phụ phí của kho, phân tuyến ĐVVT (ưu tiên khu vực + tỷ trọng kỳ) và tham số kho.
 * Luật theo THỨ TỰ (mỗi luật một hàm có test — tests/unit/dispatchEngine.test.ts):
 *  1. Nhóm bắt buộc: khách là KHO NỘI BỘ (Customer.warehouse_id) đi riêng theo kho đích; khách xác nhận trong app (SCAN)
 *     không trộn với khách ngoài.
 *  2. Cụm địa lý: cùng PHƯỜNG trước; chuyến Non tải trong cùng VÙNG được gộp với nhau nếu vừa xe, không vượt `max_drops`
 *     điểm giao và KHÔNG ĐẮT HƠN đi hai chuyến (so cước thật). Không trộn kênh khách trừ khi kho cho phép.
 *  3. Chọn dòng xe: xếp lớn-trước (first-fit-decreasing) vào xe LỚN NHẤT để tối thiểu số chuyến, rồi mỗi chuyến HẠ về dòng
 *     xe RẺ NHẤT còn vừa tải (theo cước tuyến thật). OD lớn hơn xe lớn nhất → tách theo DÒNG HÀNG NGUYÊN, phần dư sang xe kế;
 *     một dòng hàng lớn hơn xe lớn nhất → chuyến riêng gắn cờ `oversize`.
 *  4. Dòng xe phải phục vụ ĐỦ loại hàng của chuyến (`serve_categories` rỗng = mọi loại).
 *  5. Chuyến dưới ngưỡng Non tải → cờ `underload` + gợi ý gộp với chuyến cùng vùng.
 *  6. ĐVVT: ưu tiên khu vực của phường xa nhất (WARD trước REGION, theo priority) → ĐVVT đang DƯỚI tỷ trọng kỳ → cước thấp
 *     nhất → mã ĐVVT (ổn định). Tỷ trọng cộng dồn NGAY trong lượt ghép để chuyến sau thấy chuyến trước.
 *  Tie-break chung: cước thấp → ít điểm giao → ổn định (cùng input ra cùng output — mọi tập đều sort trước khi duyệt).
 * Cước dùng chính `computeFreight`/`pickTariff`/`farthestWard` của services/freight.ts — KHÔNG chép luật tính tiền.
 */
import {
  computeFreight, pickTariff, farthestWard, effectiveAt, loadUtilization, billedPallets,
  type TariffLike, type SurchargeLike, type TariffUnit, type SurchargePer, type StopCountMode, type LoadUtil,
} from './freight'

// ── Kiểu đầu vào ──
export interface EngineLine { material_code: string; qty_base: number; pallets: number | null; kg: number | null; category: string | null }
export interface EngineOd {
  od_number: string
  ship_to_code: string | null
  ship_to_name: string | null
  ward_code: string | null
  region_code: string | null
  channel: string | null            // kênh khách (LookupValue customer_channel) — null = chưa phân kênh
  internal_wh: string | null        // Customer.warehouse_id — khách là kho của mình (STO / nội bộ)
  scan_mode: boolean                // Customer.delivery_mode === 'SCAN' (kho nhận xác nhận trong app)
  flow: string
  lines: EngineLine[]
}
export interface EngineModel {
  id: string; sap_code: string; name: string
  parent_type_name: string | null   // VehicleType.name — ghi vào khvc_lines.veh_type; null = chưa gán cha ⇒ engine BỎ QUA
  capacity_mode: 'PALLET' | 'TON' | null
  max_pallets: number | null
  max_tons: number | null
  tariff_unit: TariffUnit
  underload_pct: number | null
  serve_categories: string[] | null // rỗng/null = mọi loại
  max_drops: number | null          // null = theo kho
  is_active: boolean
}
export interface EngineCarrier { id: string; code: string; name: string; tender_required?: boolean }   // tender_required: ĐVVT cần phản hồi khi chào chuyến (controller đọc lúc Xác nhận, engine không dùng)
export type EngineTariff = TariffLike & { transport_company_id: string; vehicle_model_id: string }
export type EngineSurcharge = SurchargeLike & { transport_company_id: string; vehicle_model_id: string | null; per: SurchargePer; count_mode: StopCountMode }
export interface EngineAllocation { area_kind: 'WARD' | 'REGION'; area_code: string; transport_company_id: string; priority: number; effective_from: string; effective_to: string | null; is_active?: boolean }
export type ShareBasis = 'TRIPS' | 'PALLETS' | 'TONS'
export interface EngineShareTarget { transport_company_id: string; share_pct: number; basis: ShareBasis }
export interface ShareActual { trips: number; pallets: number; tons: number }
export interface EngineParams {
  day: string                       // ngày giao 'YYYY-MM-DD' (hiệu lực cước)
  max_drops: number                 // điểm giao tối đa một chuyến (kho)
  allow_mix_channels: boolean
  underload_pct: number | null      // ngưỡng Non tải của kho; null = theo dòng xe
  code_prefix: string               // '<MãKho>_X_<ddmmyy>_' — đúng quy ước group_code hiện tại
  start_seq: number                 // STT bắt đầu (tránh trùng Số xe đã có trong Kế hoạch xuất ngày đó)
}
export interface EngineInput {
  ods: EngineOd[]
  models: EngineModel[]
  carriers: EngineCarrier[]
  tariffs: EngineTariff[]
  surcharges: EngineSurcharge[]
  allocations: EngineAllocation[]
  share_targets: EngineShareTarget[]
  share_actual: Record<string, ShareActual>   // theo transport_company_id — chuyến ĐÃ XÁC NHẬN trong kỳ
  params: EngineParams
}

// ── Kiểu đầu ra ──
export interface TripOd {
  od_number: string; ship_to_code: string | null; ship_to_name: string | null; ward_code: string | null
  pallets: number | null; tons: number | null; lines: number
  part: { index: number; of: number } | null       // OD bị tách theo dòng hàng nguyên
  material_codes: string[]
}
export interface TripFreight {
  total: number | null; base: number | null; billed_pallets: number | null; unit: TariffUnit | null
  tariff_id: string | null; ward: string | null
  surcharges: { kind: string; per: SurchargePer; unit_amount: number; qty: number; total: number }[]
  reason: string | null
}
export interface DispatchTrip {
  seq: number
  group_code: string
  cluster: string                    // khoá cụm (để người đọc hiểu vì sao đi chung)
  vehicle_model: EngineModel | null
  carrier: EngineCarrier | null
  ods: TripOd[]
  wards: string[]
  stops: number
  pallets: number | null
  tons: number | null
  categories: string[]
  booking_category: string | null    // loại hàng chiếm tải lớn nhất — cửa đặt lịch (1 xe = 1 cửa)
  load: LoadUtil
  underload: boolean
  oversize: boolean
  freight: TripFreight
  carrier_reasons: string[]
  warnings: string[]
  merge_hint: string | null          // gợi ý gộp khi Non tải
}
export interface UnplannedOd { od_number: string; ship_to_code: string | null; reason: string }
export interface CarrierShare { transport_company_id: string; code: string; name: string; trips: number; pallets: number; tons: number; pct: number | null; target_pct: number | null; basis: ShareBasis }
export interface DispatchResult {
  trips: DispatchTrip[]
  unplanned: UnplannedOd[]
  summary: {
    trips: number; ods: number; pallets: number; tons: number
    freight_total: number; unpriced: number; underload: number; oversize: number
    shares: CarrierShare[]
  }
}

const r3 = (x: number) => Math.round(x * 1000) / 1000
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const uniq = <T,>(a: T[]) => [...new Set(a)]
const numOr = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d }
const LOADABLE = new Set(['SALE', 'STO', 'INTERNAL', 'PALLET'])

// ── Đơn vị xếp: một OD hoặc một PHẦN OD (tách theo dòng hàng nguyên) ──
interface Unit {
  od: EngineOd
  lines: EngineLine[]
  pallets: number | null
  tons: number | null
  part: { index: number; of: number } | null
  oversize: boolean
}
export function sumLines(lines: EngineLine[]): { pallets: number | null; tons: number | null } {
  let p = 0, k = 0, pn = false, kn = false
  for (const l of lines) { if (l.pallets == null) pn = true; else p += l.pallets; if (l.kg == null) kn = true; else k += l.kg }
  return { pallets: pn ? null : r3(p), tons: kn ? null : r3(k / 1000) }
}
function unitOf(od: EngineOd, lines: EngineLine[], part: Unit['part'], oversize = false): Unit {
  const s = sumLines(lines)
  return { od, lines, pallets: s.pallets, tons: s.tons, part, oversize }
}

// ── Luật 1 + 2: khoá nhóm bắt buộc & khoá cụm ──
export function classKey(od: EngineOd): string {
  if (od.internal_wh) return `INT:${od.internal_wh}`
  return od.scan_mode ? 'SCAN' : 'EXT'
}
/** Khoá gộp (vùng): các chuyến cùng khoá này mới được gộp với nhau khi Non tải. */
export function mergeKey(od: EngineOd, allowMixChannels: boolean): string {
  return `${classKey(od)}|${od.region_code ?? '?'}${allowMixChannels ? '' : `|${od.channel ?? '?'}`}`
}
/** Khoá cụm ban đầu: gộp thêm PHƯỜNG (điểm giao). */
export function clusterKey(od: EngineOd, allowMixChannels: boolean): string {
  return `${mergeKey(od, allowMixChannels)}|${od.ward_code ?? od.ship_to_code ?? '?'}`
}

// ── Sức chứa ──
interface Cap { pallets: number | null; tons: number | null }
function capOf(m: EngineModel): Cap {
  const p = Number(m.max_pallets), t = Number(m.max_tons)
  return { pallets: Number.isFinite(p) && p > 0 ? p : null, tons: Number.isFinite(t) && t > 0 ? t : null }
}
/** Đo theo chế độ của dòng xe: PALLET → pallet (gác thêm tấn nếu khai); TON → tấn. Tải null ở chiều cần đo → false. */
export function fits(m: EngineModel, pallets: number | null, tons: number | null): boolean {
  const c = capOf(m)
  const byTon = m.capacity_mode === 'TON' || c.pallets == null
  if (byTon) return c.tons != null && tons != null && tons <= c.tons + 1e-9
  if (pallets == null || pallets > c.pallets! + 1e-9) return false
  if (c.tons != null && tons != null && tons > c.tons + 1e-9) return false
  return true
}
function servesAll(m: EngineModel, cats: string[]): boolean {
  const sv = (m.serve_categories ?? []).filter(Boolean)
  if (!sv.length) return true
  return cats.every(c => sv.includes(c))
}
const catsOf = (lines: EngineLine[]): string[] => uniq(lines.map(l => l.category).filter((c): c is string => !!c)).sort(cmp)

// ── Thùng xếp (bin) trong lúc ghép ──
interface Bin { key: string; mkey: string; units: Unit[]; pallets: number; tons: number }
const binWards = (b: Bin) => uniq(b.units.map(u => u.od.ward_code ?? u.od.ship_to_code ?? '?')).sort(cmp)
const binStops = (b: Bin) => Math.max(uniq(b.units.map(u => u.od.ship_to_code ?? u.od.od_number)).length, 1)
const withUnits = (b: Bin, units: Unit[]): Bin => {
  const all = [...b.units, ...units]
  return { ...b, units: all, pallets: r3(all.reduce((s, u) => s + (u.pallets ?? 0), 0)), tons: r3(all.reduce((s, u) => s + (u.tons ?? 0), 0)) }
}
const binFits = (big: EngineModel, b: Bin, maxDrops: number) => fits(big, b.pallets, b.tons) && binStops(b) <= maxDrops

/** Luật 3 (tách): OD vượt xe lớn nhất → cắt theo dòng hàng nguyên (lớn trước), mỗi phần ≤ sức chứa; dòng đơn lẻ vượt → phần riêng `oversize`. */
export function splitOversize(od: EngineOd, big: EngineModel): Unit[] {
  const whole = unitOf(od, od.lines, null)
  if (fits(big, whole.pallets, whole.tons)) return [whole]
  const lines = [...od.lines].sort((a, b) => (b.pallets ?? 0) - (a.pallets ?? 0) || (b.kg ?? 0) - (a.kg ?? 0) || cmp(a.material_code, b.material_code))
  const parts: EngineLine[][] = []
  for (const l of lines) {
    let placed = false
    for (const p of parts) {
      const s = sumLines([...p, l])
      if (fits(big, s.pallets, s.tons)) { p.push(l); placed = true; break }
    }
    if (!placed) parts.push([l])
  }
  return parts.map((p, i) => {
    const s = sumLines(p)
    return unitOf(od, p, { index: i + 1, of: parts.length }, !fits(big, s.pallets, s.tons))
  })
}

// ── Bối cảnh chạy: chỉ mục cước theo (ĐVVT, dòng xe) để không lọc lại cả bảng mỗi lần ──
export interface Ctx {
  input: EngineInput
  models: EngineModel[]
  tariffsBy: Map<string, EngineTariff[]>       // `${carrier}|${model}`
  surBy: Map<string, EngineSurcharge[]>        // carrier
  allocs: EngineAllocation[]
}
const tKey = (c: string, m: string) => `${c}|${m}`
/** Dựng bối cảnh từ input — controller dùng lại để tính lại cước khi người đổi dòng xe/ĐVVT/chuyển OD trên bản nháp. */
export function buildCtx(input: EngineInput): Ctx {
  const models = input.models.filter(m => m.is_active && m.parent_type_name && (capOf(m).pallets != null || capOf(m).tons != null)).sort((a, b) => cmp(a.sap_code, b.sap_code))
  const tariffsBy = new Map<string, EngineTariff[]>()
  for (const t of input.tariffs) { const k = tKey(t.transport_company_id, t.vehicle_model_id); const l = tariffsBy.get(k) ?? []; l.push(t); tariffsBy.set(k, l) }
  const surBy = new Map<string, EngineSurcharge[]>()
  for (const s of input.surcharges) { const l = surBy.get(s.transport_company_id) ?? []; l.push(s); surBy.set(s.transport_company_id, l) }
  return { input, models, tariffsBy, surBy, allocs: effectiveAt(input.allocations.map(a => ({ ...a, is_active: a.is_active ?? true })), input.params.day) }
}
/** Tải + Non tải của một chuyến theo dòng xe đã chọn (ngưỡng kho đè ngưỡng dòng xe). */
export function tripLoad(model: EngineModel | null, pallets: number | null, tons: number | null, whUnderloadPct: number | null): LoadUtil {
  return loadUtilization(model ? { capacity_mode: model.capacity_mode, max_pallets: model.max_pallets, max_tons: model.max_tons, underload_pct: whUnderloadPct ?? numOr(model.underload_pct, 70) } : null, pallets, tons)
}

// ── Luật 6: chọn ĐVVT cho (chuyến, dòng xe) ──
interface PriceOpt { carrier: EngineCarrier; freight: TripFreight; reasons: string[] }
export function priceFor(ctx: Ctx, model: EngineModel, carrierId: string, wards: string[], stops: number, pallets: number | null, tons: number | null): TripFreight {
  const day = ctx.input.params.day
  const mine = effectiveAt((ctx.tariffsBy.get(tKey(carrierId, model.id)) ?? []).filter(t => wards.includes(t.ward_code)), day)
  const kmByWard = new Map<string, number | null>()
  for (const t of mine) if (!kmByWard.has(t.ward_code) || (t.distance_km != null && kmByWard.get(t.ward_code) == null)) kmByWard.set(t.ward_code, t.distance_km == null ? null : Number(t.distance_km))
  const ward = farthestWard(mine.map(t => t.ward_code), kmByWard)
  const tariff = ward ? pickTariff(mine.filter(t => t.ward_code === ward).map(t => ({ ...t, price: Number(t.price), distance_km: t.distance_km == null ? null : Number(t.distance_km) })), day) : null
  const unit = model.tariff_unit
  if (!tariff) return { total: null, base: null, billed_pallets: null, unit, tariff_id: null, ward: null, surcharges: [], reason: `Chưa có bảng cước (${model.name} · phường ${wards.join(', ') || '?'})` }
  if (unit === 'PER_PALLET' && pallets == null) return { total: null, base: null, billed_pallets: null, unit, tariff_id: null, ward, surcharges: [], reason: 'Không đo được số pallet' }
  const sur = effectiveAt((ctx.surBy.get(carrierId) ?? []).filter(s => s.vehicle_model_id == null || s.vehicle_model_id === model.id), day)
    .map(s => ({ ...s, amount: Number(s.amount), min_stops: Number(s.min_stops ?? 2) }))
  const r = computeFreight({ unit, tariff, surcharges: sur, pallets: pallets ?? 0, tons: tons ?? 0, stops })
  return { total: r.total, base: r.base, billed_pallets: r.billed_pallets, unit, tariff_id: r.tariff_id, ward, surcharges: r.surcharges, reason: r.reason }
}
export function sharePct(basis: ShareBasis, a: ShareActual, totals: ShareActual): number | null {
  const den = basis === 'TRIPS' ? totals.trips : basis === 'PALLETS' ? totals.pallets : totals.tons
  const num = basis === 'TRIPS' ? a.trips : basis === 'PALLETS' ? a.pallets : a.tons
  return den > 0 ? Math.round((num / den) * 1000) / 10 : null
}
function chooseCarrier(ctx: Ctx, model: EngineModel, wards: string[], region: string | null, stops: number, pallets: number | null, tons: number | null, actual: Record<string, ShareActual>): PriceOpt | null {
  const input = ctx.input
  const carriers = [...input.carriers].sort((a, b) => cmp(a.code, b.code))
  let pool: PriceOpt[] = carriers.map(c => ({ carrier: c, freight: priceFor(ctx, model, c.id, wards, stops, pallets, tons), reasons: [] })).filter(p => p.freight.total != null)
  if (!pool.length) return null
  // (1) ưu tiên khu vực: WARD của phường xa nhất trước, rồi REGION — chỉ giữ nhóm priority NHỎ NHẤT có cước
  const farWard = pool[0].freight.ward ?? wards[0] ?? null
  const pick = (kind: 'WARD' | 'REGION', code: string | null): { ids: string[]; label: string } | null => {
    if (!code) return null
    const rows = ctx.allocs.filter(a => a.area_kind === kind && a.area_code === code && pool.some(p => p.carrier.id === a.transport_company_id))
    if (!rows.length) return null
    const best = Math.min(...rows.map(a => Number(a.priority)))
    return { ids: rows.filter(a => Number(a.priority) === best).map(a => a.transport_company_id), label: `${kind === 'WARD' ? 'phường' : 'vùng'} ${code} (ưu tiên ${best})` }
  }
  const alloc = pick('WARD', farWard) ?? pick('REGION', region)
  if (alloc) { pool = pool.filter(p => alloc.ids.includes(p.carrier.id)); pool.forEach(p => p.reasons.push(`Phân tuyến ${alloc.label}`)) }
  // (2) ĐVVT đang DƯỚI tỷ trọng kỳ lên trước
  const totals: ShareActual = { trips: 0, pallets: 0, tons: 0 }
  for (const a of Object.values(actual)) { totals.trips += a.trips; totals.pallets += a.pallets; totals.tons += a.tons }
  const under = pool.filter(p => {
    const t = input.share_targets.find(s => s.transport_company_id === p.carrier.id)
    if (!t) return false
    const pct = sharePct(t.basis, actual[p.carrier.id] ?? { trips: 0, pallets: 0, tons: 0 }, totals) ?? 0
    if (pct < Number(t.share_pct)) { p.reasons.push(`Dưới tỷ trọng kỳ ${pct}% < ${t.share_pct}% (${t.basis})`); return true }
    return false
  })
  if (under.length) pool = under
  // (3) cước thấp nhất → (4) mã ĐVVT
  pool.sort((a, b) => (a.freight.total! - b.freight.total!) || cmp(a.carrier.code, b.carrier.code))
  const best = pool[0]
  best.reasons.push(pool.length > 1 ? `Cước thấp nhất trong ${pool.length} ĐVVT có cước` : 'ĐVVT duy nhất có cước cho tuyến/dòng xe này')
  return best
}

interface Assigned {
  model: EngineModel | null; carrier: EngineCarrier | null; freight: TripFreight; reasons: string[]; warnings: string[]
  cats: string[]; wards: string[]; stops: number; pallets: number | null; tons: number | null; oversize: boolean
}
/** Luật 3 (hạ xe) + 6: với một bin đã xếp, chọn (dòng xe, ĐVVT) RẺ NHẤT còn vừa; không có cước ⇒ dòng xe nhỏ nhất vừa tải. */
function assignVehicle(ctx: Ctx, b: Bin, actual: Record<string, ShareActual>): Assigned {
  const cats = catsOf(b.units.flatMap(u => u.lines))
  const wards = binWards(b).filter(w => w !== '?')
  const stops = binStops(b)
  const region = b.units[0]?.od.region_code ?? null
  const pAll = b.units.every(u => u.pallets != null) ? r3(b.pallets) : null
  const tAll = b.units.every(u => u.tons != null) ? r3(b.tons) : null
  const oversize = b.units.some(u => u.oversize)
  const cands = ctx.models.filter(m => servesAll(m, cats) && (oversize || fits(m, pAll, tAll)) && (m.max_drops == null || stops <= m.max_drops))
    .sort((a, c) => (numOr(a.max_pallets, 1e9) - numOr(c.max_pallets, 1e9)) || (numOr(a.max_tons, 1e9) - numOr(c.max_tons, 1e9)) || cmp(a.sap_code, c.sap_code))
  const warnings: string[] = []
  let best: { model: EngineModel; opt: PriceOpt } | null = null
  for (const m of cands) {
    const opt = chooseCarrier(ctx, m, wards, region, stops, pAll, tAll, actual)
    if (!opt) continue
    if (!best || opt.freight.total! < best.opt.freight.total! || (opt.freight.total === best.opt.freight.total && numOr(m.max_pallets, 0) < numOr(best.model.max_pallets, 0))) best = { model: m, opt }
  }
  if (best) return { model: best.model, carrier: best.opt.carrier, freight: best.opt.freight, reasons: best.opt.reasons, warnings, cats, wards, stops, pallets: pAll, tons: tAll, oversize }
  const m0 = cands[0] ?? null
  if (!m0) warnings.push(cats.length ? `Không dòng xe nào vừa tải và phục vụ loại ${cats.join('+')}` : 'Không dòng xe nào vừa tải')
  else warnings.push('Chưa có bảng cước cho tuyến/dòng xe này ở mọi ĐVVT — chọn dòng xe nhỏ nhất còn vừa tải')
  const freight: TripFreight = { total: null, base: null, billed_pallets: pAll != null ? billedPallets(pAll) : null, unit: m0?.tariff_unit ?? null, tariff_id: null, ward: wards[0] ?? null, surcharges: [], reason: warnings[warnings.length - 1] }
  return { model: m0, carrier: null, freight, reasons: [], warnings, cats, wards, stops, pallets: pAll, tons: tAll, oversize }
}

export function runDispatch(input: EngineInput): DispatchResult {
  const P = input.params
  const models = buildCtx(input).models
  const ods = [...input.ods].sort((a, b) => cmp(a.od_number, b.od_number))
  const unplanned: UnplannedOd[] = []
  if (!models.length) {
    return { trips: [], unplanned: ods.map(o => ({ od_number: o.od_number, ship_to_code: o.ship_to_code, reason: 'Chưa có dòng xe con nào gán cha + khai sức chứa' })), summary: summarize(input, [], {}) }
  }
  const ctx = buildCtx(input)
  // xe LỚN NHẤT để xếp: theo pallet — không có dòng xe pallet nào thì theo tấn.
  // CHỈ tính dòng xe CÓ BẢNG CƯỚC cho phường của cụm (bất kỳ ĐVVT): xếp vào xe to không ai chào giá là đẻ ra chuyến
  // "không ĐVVT, không cước" trong khi xe nhỏ hơn có cước chở được (gói QA 61 bắt ngay lượt đầu trên danh mục 60 dòng xe
  // thật). Không dòng xe nào có cước cho phường đó ⇒ rơi về xe lớn nhất chung (vẫn xếp, cước null có lý do).
  const bigSort = (a: EngineModel, b: EngineModel) => (numOr(b.max_pallets, 0) - numOr(a.max_pallets, 0)) || (numOr(b.max_tons, 0) - numOr(a.max_tons, 0)) || cmp(a.sap_code, b.sap_code)
  const bigAll = [...models].sort(bigSort)[0]
  const pricedByWard = new Map<string, Set<string>>()
  for (const t of effectiveAt(input.tariffs.map(t => ({ ...t, is_active: t.is_active ?? true })), P.day)) { const s = pricedByWard.get(t.ward_code) ?? new Set<string>(); s.add(t.vehicle_model_id); pricedByWard.set(t.ward_code, s) }
  const bigFor = (wards: (string | null | undefined)[]): EngineModel => {
    const ids = new Set(wards.flatMap(w => (w ? [...(pricedByWard.get(w) ?? [])] : [])))
    const cands = models.filter(m => ids.has(m.id))
    return cands.length ? cands.sort(bigSort)[0] : bigAll
  }
  const underPct = (m: EngineModel | null) => P.underload_pct ?? numOr(m?.underload_pct, 70)

  // ── Lọc + tách đơn vị xếp ──
  const units: Unit[] = []
  for (const od of ods) {
    if (!LOADABLE.has(od.flow)) { unplanned.push({ od_number: od.od_number, ship_to_code: od.ship_to_code, reason: `Phân loại ${od.flow} không lên xe` }); continue }
    if (!od.lines.length) { unplanned.push({ od_number: od.od_number, ship_to_code: od.ship_to_code, reason: 'OD không có dòng hàng' }); continue }
    const s = sumLines(od.lines)
    if (s.pallets == null && s.tons == null) { unplanned.push({ od_number: od.od_number, ship_to_code: od.ship_to_code, reason: `Không đo được tải (${od.lines.filter(l => l.pallets == null && l.kg == null).length} dòng thiếu quy cách thùng/pallet/kg và SAP không có tham chiếu)` }); continue }
    units.push(...splitOversize(od, bigFor([od.ward_code])))
  }

  // ── Luật 1–3: xếp lớn-trước theo cụm phường ──
  const byCluster = new Map<string, Unit[]>()
  for (const u of units) { const k = clusterKey(u.od, P.allow_mix_channels); const l = byCluster.get(k) ?? []; l.push(u); byCluster.set(k, l) }
  const bins: Bin[] = []
  for (const key of [...byCluster.keys()].sort(cmp)) {
    const us = byCluster.get(key)!.sort((a, b) => (b.pallets ?? 0) - (a.pallets ?? 0) || (b.tons ?? 0) - (a.tons ?? 0) || cmp(a.od.od_number, b.od.od_number) || (a.part?.index ?? 0) - (b.part?.index ?? 0))
    const big = bigFor(us.map(u => u.od.ward_code))
    const local: Bin[] = []
    for (const u of us) {
      const mkey = mergeKey(u.od, P.allow_mix_channels)
      if (u.oversize) { local.push({ key, mkey, units: [u], pallets: u.pallets ?? 0, tons: u.tons ?? 0 }); continue }
      const b = local.find(x => !x.units.some(y => y.oversize) && binFits(big, withUnits(x, [u]), P.max_drops))
      if (b) { const nb = withUnits(b, [u]); b.units = nb.units; b.pallets = nb.pallets; b.tons = nb.tons }
      else local.push({ key, mkey, units: [u], pallets: u.pallets ?? 0, tons: u.tons ?? 0 })
    }
    bins.push(...local)
  }

  // ── Luật 5 + 2: gộp chuyến Non tải cùng VÙNG — chỉ khi vừa xe, đủ điểm giao và KHÔNG ĐẮT HƠN đi riêng ──
  const snapshot: Record<string, ShareActual> = {}
  for (const [k, v] of Object.entries(input.share_actual)) snapshot[k] = { ...v }
  const costOf = (b: Bin) => assignVehicle(ctx, b, snapshot)
  const isUnder = (b: Bin) => { const a = costOf(b); if (!a.model) return true; const u = loadUtilization({ capacity_mode: a.model.capacity_mode, max_pallets: a.model.max_pallets, max_tons: a.model.max_tons, underload_pct: underPct(a.model) }, a.pallets, a.tons); return u.pct != null && u.pct < underPct(a.model) }
  let changed = true
  while (changed) {
    changed = false
    const srcs = bins.filter(b => !b.units.some(u => u.oversize) && isUnder(b)).sort((a, b) => (a.pallets - b.pallets) || (a.tons - b.tons) || cmp(a.key, b.key))
    for (const src of srcs) {
      const cSrc = costOf(src).freight.total
      const targets = bins.filter(t => t !== src && t.mkey === src.mkey && !t.units.some(u => u.oversize))
        .map(t => ({ t, merged: withUnits(t, src.units) }))
        .filter(x => binFits(bigFor(x.merged.units.map(u => u.od.ward_code)), x.merged, P.max_drops))
        .map(x => { const cT = costOf(x.t).freight.total, cM = costOf(x.merged).freight.total; return { ...x, cT, cM, ok: cM == null || cT == null || cSrc == null ? true : cM <= cSrc + cT } })
        .filter(x => x.ok)
        .sort((a, b) => ((a.cM ?? Infinity) - (b.cM ?? Infinity)) || (b.t.pallets - a.t.pallets) || cmp(a.t.key, b.t.key))
      const hit = targets[0]
      if (!hit) continue
      const nb = hit.merged
      hit.t.units = nb.units; hit.t.pallets = nb.pallets; hit.t.tons = nb.tons
      hit.t.key = `${hit.t.mkey}|${binWards(hit.t).join('+')}`
      bins.splice(bins.indexOf(src), 1)
      changed = true
      break
    }
  }

  // ── Luật 3 (hạ xe) + 6 (ĐVVT) từng chuyến, thứ tự ổn định: vùng → phường → tải giảm ──
  bins.sort((a, b) => cmp(a.mkey, b.mkey) || cmp(binWards(a).join('+'), binWards(b).join('+')) || (b.pallets - a.pallets) || cmp(a.units[0].od.od_number, b.units[0].od.od_number))
  const actual: Record<string, ShareActual> = {}
  for (const [k, v] of Object.entries(input.share_actual)) actual[k] = { ...v }
  const trips: DispatchTrip[] = []
  let seq = P.start_seq
  for (const b of bins) {
    const a = assignVehicle(ctx, b, actual)
    if (a.carrier) { const cur = actual[a.carrier.id] ?? { trips: 0, pallets: 0, tons: 0 }; cur.trips += 1; cur.pallets += a.pallets ?? 0; cur.tons += a.tons ?? 0; actual[a.carrier.id] = cur }
    const load = loadUtilization(a.model ? { capacity_mode: a.model.capacity_mode, max_pallets: a.model.max_pallets, max_tons: a.model.max_tons, underload_pct: underPct(a.model) } : null, a.pallets, a.tons)
    trips.push({
      seq, group_code: `${P.code_prefix}${seq}`, cluster: b.key,
      vehicle_model: a.model, carrier: a.carrier,
      ods: b.units.map(u => ({ od_number: u.od.od_number, ship_to_code: u.od.ship_to_code, ship_to_name: u.od.ship_to_name, ward_code: u.od.ward_code, pallets: u.pallets, tons: u.tons, lines: u.lines.length, part: u.part, material_codes: u.lines.map(l => l.material_code) })),
      wards: a.wards, stops: a.stops, pallets: a.pallets, tons: a.tons, categories: a.cats, booking_category: pickBookingCategory(b.units.flatMap(u => u.lines)),
      load, underload: load.pct != null && load.pct < load.underload_pct, oversize: a.oversize, freight: a.freight, carrier_reasons: a.reasons,
      warnings: [...a.warnings, ...(a.oversize ? ['Một dòng hàng lớn hơn xe lớn nhất — chuyến vượt tải, cần tách tay hoặc thêm dòng xe lớn hơn'] : [])],
      merge_hint: null,
    })
    seq++
  }
  // Gợi ý gộp cho chuyến Non tải còn lại (máy đã không gộp được vì vượt điểm giao / vượt xe / đắt hơn đi riêng)
  const mkeyOfTrip = (t: DispatchTrip) => t.cluster.split('|').slice(0, -1).join('|')
  for (const t of trips) {
    if (!t.underload) continue
    const others = trips.filter(o => o !== t && mkeyOfTrip(o) === mkeyOfTrip(t))
    t.merge_hint = others.length
      ? `Non tải ${t.load.pct}% — cùng vùng còn ${others.length} chuyến (${others.slice(0, 3).map(o => o.group_code).join(', ')}); máy không gộp vì vượt điểm giao / vượt xe / đắt hơn đi riêng`
      : `Non tải ${t.load.pct}% — không có chuyến cùng vùng để gộp; cân nhắc dời ngày hoặc ghép tay khác vùng`
  }
  return { trips, unplanned, summary: summarize(input, trips, actual) }
}

/** Cửa đặt lịch của xe = loại hàng chiếm nhiều pallet nhất (hoà ⇒ theo mã) — 1 Số xe chỉ 1 booking_category. */
export function pickBookingCategory(lines: EngineLine[]): string | null {
  const by = new Map<string, number>()
  for (const l of lines) if (l.category) by.set(l.category, (by.get(l.category) ?? 0) + (l.pallets ?? 0) + (l.kg ?? 0) / 1e6)
  const e = [...by.entries()].sort((a, b) => (b[1] - a[1]) || cmp(a[0], b[0]))
  return e[0]?.[0] ?? null
}

function sharesOf(input: EngineInput, actual: Record<string, ShareActual>): CarrierShare[] {
  const totals: ShareActual = { trips: 0, pallets: 0, tons: 0 }
  for (const a of Object.values(actual)) { totals.trips += a.trips; totals.pallets += a.pallets; totals.tons += a.tons }
  return [...input.carriers].sort((a, b) => cmp(a.code, b.code)).map(c => {
    const a = actual[c.id] ?? { trips: 0, pallets: 0, tons: 0 }
    const t = input.share_targets.find(s => s.transport_company_id === c.id)
    const basis: ShareBasis = t?.basis ?? 'TRIPS'
    return { transport_company_id: c.id, code: c.code, name: c.name, trips: a.trips, pallets: r3(a.pallets), tons: r3(a.tons), pct: sharePct(basis, a, totals), target_pct: t ? Number(t.share_pct) : null, basis }
  }).filter(s => s.trips > 0 || s.target_pct != null)
}
function summarize(input: EngineInput, trips: DispatchTrip[], actual: Record<string, ShareActual>): DispatchResult['summary'] {
  return {
    trips: trips.length,
    ods: uniq(trips.flatMap(t => t.ods.map(o => o.od_number))).length,
    pallets: r3(trips.reduce((s, t) => s + (t.pallets ?? 0), 0)),
    tons: r3(trips.reduce((s, t) => s + (t.tons ?? 0), 0)),
    freight_total: trips.reduce((s, t) => s + (t.freight.total ?? 0), 0),
    unpriced: trips.filter(t => t.freight.total == null).length,
    underload: trips.filter(t => t.underload).length,
    oversize: trips.filter(t => t.oversize).length,
    shares: sharesOf(input, actual),
  }
}

/** Quy ước Số xe hiện tại `<MãKho>_X_<ddmmyy>_<stt>` — `buildKhvcByVehicle` lấy `split('_')[0]` làm mã kho nên phải giữ đúng. */
export function codePrefixOf(warehouseCode: string, day: string): string {
  const [y, m, d] = day.split('-')
  return `${warehouseCode}_X_${d}${m}${y.slice(2)}_`
}
