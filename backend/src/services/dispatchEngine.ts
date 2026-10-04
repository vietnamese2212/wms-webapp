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
 *  4. ĐIỀU KIỆN BẢO QUẢN (24/09): mọi điều kiện của hàng trên chuyến phải nằm trong danh sách dòng xe phục vụ
 *     (`serve_conditions` rỗng = mọi điều kiện). Điều kiện của hàng lấy theo LOẠI KHO (Cài đặt WMS), của xe khai ở
 *     danh mục Mã dòng xe — cả hai đều là DỮ LIỆU, engine không biết "lạnh" hay "thường" nghĩa là gì.
 *  5. Chuyến dưới ngưỡng Non tải → cờ `underload` + gợi ý gộp với chuyến cùng vùng.
 *  6. ĐVVT: ưu tiên khu vực của phường xa nhất (WARD trước REGION, theo priority) → ĐVVT đang DƯỚI tỷ trọng kỳ → cước thấp
 *     nhất → mã ĐVVT (ổn định). Tỷ trọng cộng dồn NGAY trong lượt ghép để chuyến sau thấy chuyến trước.
 *  7. ~~PALLET / XÁ (25/09)~~ — BỎ 29/09 (user: "dòng xe là đơn vị thấp hơn của loại xe — bỏ loại xe, chọn dòng xe luôn"):
 *     không còn kiểu đi của khách / của xe; họ xe = ĐÚNG danh sách "Dòng xe được vào" (luật 10). Số khách tối đa trên một xe
 *     = nhỏ nhất trong (`max_drops` của DÒNG XE · "số khách tối đa cùng xe" của khách → kênh). 02/10 (user: "bỏ cài đặt WMS đi,
 *     các khách và dòng xe muốn được ghép chuyến phải khai — không khai thì có cảnh báo"): KHÔNG còn số của kho; khách / kênh
 *     CHƯA KHAI = 1 (một khách một xe), controller đưa vào `config_gaps.no_drops` để chip "Khai thiếu" nêu tên. Khách phải đi một
 *     mình = tick "Đi xe riêng" hoặc "Số khách tối đa cùng xe" = 1. 04/10: DÒNG XE chưa khai = KHÔNG giới hạn (`modelDrops`) —
 *     điểm giao là chuyện của khách; dòng xe chỉ khai khi muốn siết.
 *     03/10 — DÒNG XE THEO KHO: `models` controller truyền vào đã là bản HIỆU LỰC tại kho (services/vehicleModelScope: kho có cấu
 *     hình riêng thì dùng/không + sức chứa + điểm giao theo kho, không thì theo Chung). Engine không biết kho, chỉ thấy danh sách.
 *  8. ~~DÒNG XE DÙNG CHO VIỆC GÌ (25/09, `dispatch_use` TRANSFER)~~ — BỎ 28/09 (user: "dòng xe chọn theo khai báo của khách,
 *     khách không khai thì không chọn — bỏ config ở Mã dòng xe"). Container chỉ đi khi khách / kênh tick nó (luật 10).
 *  9. KHÔNG TRỘN LOẠI KHO (26/09, user: "FG01 đi với FG01, FG02 đi FG02, muốn đi chung phải bật công tắc"): khoá cụm mang
 *     Loại kho CHÍNH của OD (`mainCatsOf` — bỏ Loại kho "đi kèm đơn" như POSM) trừ khi kho bật `allow_mix_categories`.
 *     OD chỉ có hàng đi kèm (POSM riêng) được xếp ké vào chuyến cùng cụm, ưu tiên chuyến của CHÍNH khách đó.
 *     OD tự chứa hai Loại kho chính không tách được ⇒ đi một chuyến kèm cảnh báo.
 *  4b. XE KẾT HỢP CHỈ KHI GHÉP (26/09): xe chở được ≥ 2 mức mà Loại kho có khai chỉ ưu tiên cho chuyến cần ≥ 2 mức; chuyến một mức
 *     đi xe đúng mức, rơi về xe kết hợp khi không xe đúng mức nào vừa + có cước (ghi lý do).
 * 10. DÒNG XE ĐƯỢC VÀO (27/09 — thay "tải trọng xe tối đa" tự suy theo tấn của 26/09; user: "tôi không muốn tự động, tôi muốn
 *     config được"): OD mang `allowed_models` (khai theo Kênh → Khách × Loại kho, controller resolve) ⇒ mọi chuyến chở OD đó chỉ
 *     dùng dòng xe TRONG danh sách (giao của mọi OD trên chuyến), và thắng họ xe của luật 7 khi danh sách không có xe nào đúng
 *     họ. 28/09: khách + kênh đều KHÔNG khai ⇒ danh sách RỖNG ⇒ máy không chọn xe (OD nằm khung chờ, cảnh báo khai thiếu).
 *     `allowed_models` null chỉ còn ở dòng chụp trước 28/09 / test = không giới hạn.
 * 11. NHIỀU XE TRÊN MỘT THẺ (27/09, user: "10 tấn có thể dùng xe 8 tấn + 2 tấn thay vì 15 tấn — tốn tiền hơn" · "luôn so tổ hợp"):
 *     `max_vehicles` > 1 ⇒ mỗi chuyến so thêm các TỔ HỢP 2..N dòng xe (cùng cách đo sức chứa, cùng một ĐVVT, mọi dòng xe đều qua
 *     luật 4/7/8/10) — tổ hợp RẺ HƠN một xe thì chọn tổ hợp. OD lớn hơn mọi xe được vào mà N xe chở vừa ⇒ KHÔNG tách OD, đi một
 *     thẻ nhiều xe (một Số xe). Tổ hợp chỉ tính ở bước chọn xe cuối, không trong vòng gộp Non tải (chi phí tính toán).
 *  Tie-break chung: cước thấp → ít điểm giao → ổn định (cùng input ra cùng output — mọi tập đều sort trước khi duyệt).
 * Cước dùng chính `computeFreight`/`pickTariff`/`farthestWard` của services/freight.ts — KHÔNG chép luật tính tiền.
 */
import {
  computeFreight, pickTariff, farthestWard, effectiveAt, loadUtilization, billedPallets,
  type TariffLike, type SurchargeLike, type TariffUnit, type SurchargePer, type StopCountMode, type LoadUtil,
} from './freight'
import { estimateRoadKm, kmLookup, routeKm, detourOk } from '../utils/geoMath'

// ── Kiểu đầu vào ──
export interface EngineLine {
  material_code: string; qty_base: number; pallets: number | null; kg: number | null
  category: string | null      // Loại kho của mã hàng — quyết cửa đặt lịch (booking_category) + nhãn "chở lẫn"
  condition: string | null     // điều kiện bảo quản suy từ Loại kho; null = chưa khai = không ràng buộc
  /** 26/09: ĐK bảo quản theo CHỖ TỒN THẬT (ô khai riêng ĐK — `lineConditions`). Có giá trị thì THAY `condition`. */
  conditions?: string[]
}
export interface EngineOd {
  od_number: string
  ship_to_code: string | null
  ship_to_name: string | null
  ward_code: string | null
  region_code: string | null
  channel: string | null            // kênh khách (LookupValue customer_channel) — null = chưa phân kênh
  /** 28/09 (user: "không tự ép gì cả, config hết"): `Customer.dispatch_separate` — khách đi xe riêng, không ghép khách khác.
   *  Thay cho luật ngầm cũ "khách trỏ kho (internal_wh) / khách SCAN đi riêng". undefined = ghép bình thường. */
  separate?: boolean
  /** 28/09: số khách tối đa cùng xe của OD này (khách → kênh); null/undefined = không giới hạn. Chuyến = nhỏ nhất trong các OD. */
  max_customers?: number | null
  flow: string
  lines: EngineLine[]
  /** Luật 10 (27/09): dòng xe (id) khách được vào; null/undefined = không giới hạn. */
  allowed_models?: string[] | null
}
export interface EngineModel {
  id: string; sap_code: string; name: string
  parent_type_name: string | null   // VehicleType.name — ghi vào khvc_lines.veh_type; null = chưa gán cha ⇒ engine BỎ QUA
  capacity_mode: 'PALLET' | 'TON' | null
  max_pallets: number | null
  max_tons: number | null
  tariff_unit: TariffUnit
  // 02/10: KHÔNG còn `underload_pct` của dòng xe — ngưỡng Non tải = dải tải theo cha (`load_min_pct`) → ngưỡng kho → 70
  serve_conditions: string[] | null // điều kiện bảo quản xe phục vụ được; rỗng/null = mọi điều kiện
  max_drops: number | null          // điểm giao tối đa; null = CHƯA KHAI = 1 khách (02/10 — muốn ghép phải khai, thiếu thì chip Khai thiếu)
  is_active: boolean
  /** 01/10 — DẢI TẢI theo dòng xe CHA (`params.load_bands[parent_type_id]`), `withLoadBands` điền vào bản sao dòng xe cho lượt ghép:
   *  `load_min_pct` = ngưỡng Non tải (thay kho/dòng xe khi có), `load_max_pct` = trần xếp (105 = cho vượt 5 % sức chứa danh định).
   *  null/undefined = như trước (Non tải theo kho → dòng xe → 70; trần 100). */
  parent_type_id?: string | null
  load_min_pct?: number | null
  load_max_pct?: number | null
}
/** Dải % tải một dòng xe cha: `min` = dưới mức này là Non tải · `max` = máy được xếp tới mức này (> 100 = dung sai vượt). */
export interface LoadBand { min: number; max: number }
export interface EngineCarrier { id: string; code: string; name: string; tender_required?: boolean }   // tender_required: ĐVVT cần phản hồi khi chào chuyến (controller đọc lúc Xác nhận, engine không dùng)
export type EngineTariff = TariffLike & { transport_company_id: string; vehicle_model_id: string }
export type EngineSurcharge = SurchargeLike & { transport_company_id: string; vehicle_model_id: string | null; per: SurchargePer; count_mode: StopCountMode }
export interface EngineAllocation { area_kind: 'WARD' | 'REGION'; area_code: string; transport_company_id: string; priority: number; effective_from: string; effective_to: string | null; is_active?: boolean }
export type ShareBasis = 'TRIPS' | 'PALLETS' | 'TONS'
export interface EngineShareTarget { transport_company_id: string; share_pct: number; basis: ShareBasis }
export interface ShareActual { trips: number; pallets: number; tons: number }
export interface EngineParams {
  day: string                       // ngày giao 'YYYY-MM-DD' (hiệu lực cước)
  allow_mix_channels: boolean
  underload_pct: number | null      // ngưỡng Non tải của kho; null = theo dòng xe
  code_prefix: string               // '<MãKho>_X_<ddmmyy>_' — đúng quy ước group_code hiện tại
  start_seq: number                 // STT bắt đầu (tránh trùng Số xe đã có trong Kế hoạch xuất ngày đó)
  /** Luật 9 (26/09): cho ghép nhiều Loại kho trên một chuyến. undefined = cho (hành vi trước 26/09 — dữ liệu/test cũ);
   *  controller luôn truyền giá trị của kho (mặc định false). */
  allow_mix_categories?: boolean
  follow_categories?: string[]      // Loại kho "đi kèm đơn" (POSM) — không tính khi tách chuyến theo loại
  /** Luật 4b (26/09): các mức bảo quản mà Loại kho CHÍNH có khai (vd Thường + 2–8 °C). Xe chở được ≥ 2 mức trong số này =
   *  xe kết hợp ⇒ chỉ ưu tiên cho chuyến cần ≥ 2 mức. undefined/rỗng = không phân biệt (hành vi cũ). */
  combo_conditions?: string[]
  /** Luật 11 (27/09): số dòng xe tối đa trên MỘT thẻ (một Số xe). undefined/1 = một xe (hành vi trước 27/09). */
  max_vehicles?: number
  /** 01/10 — dải % tải theo dòng xe CHA (VehicleType.id → {min,max}); cha không có trong bảng = như trước. `load_bypass` = bỏ qua
   *  dải: xếp theo sức chứa danh định (100 %), không báo Non tải (min 0) — người bật là người chịu. */
  load_bands?: Record<string, LoadBand>
  load_bypass?: boolean
  /** 02/10 — điều vận trên bản đồ: gộp xe Non tải KHÁC TỈNH khi đường vòng ≤ N % (`Warehouse.dispatch_detour_pct`). null/undefined =
   *  tắt = chỉ gộp cùng tỉnh như trước. Cần `input.geo` có ghim kho + mọi điểm giao của hai xe. */
  detour_pct?: number | null
}
/** Toạ độ + km cho máy ghép (02/10). `points` theo ship_to_code; `km` khoá `A|B` (A, B = 'WH' hoặc ship_to) — số đo Goong hay ước
 *  lượng chim bay × 1,3 do controller điền (engine không phân biệt, màn hình mới nói "ước lượng"). Thiếu km ⇒ engine tự ước lượng. */
export interface EngineGeo {
  wh: { lat: number; lng: number } | null
  points: Record<string, { lat: number; lng: number }>
  km: Record<string, number>
}
export interface EngineInput {
  geo?: EngineGeo
  ods: EngineOd[]
  models: EngineModel[]
  carriers: EngineCarrier[]
  tariffs: EngineTariff[]
  surcharges: EngineSurcharge[]
  allocations: EngineAllocation[]
  share_targets: EngineShareTarget[]
  share_actual: Record<string, ShareActual>   // theo transport_company_id — chuyến ĐÃ XÁC NHẬN trong kỳ
  condition_labels?: Record<string, string>   // mã điều kiện bảo quản → nhãn tiếng Việt, CHỈ để viết câu cảnh báo
  params: EngineParams
}

// ── Kiểu đầu ra ──
export interface TripOd {
  od_number: string; ship_to_code: string | null; ship_to_name: string | null; ward_code: string | null
  pallets: number | null; tons: number | null; lines: number
  part: { index: number; of: number } | null       // OD bị tách theo dòng hàng nguyên
  material_codes: string[]
  conditions: string[]                              // điều kiện bảo quản của phần OD này — chuyển OD thì chuyến đích tính lại từ đây
  cat_load: Record<string, number>                  // tải theo Loại kho (pallet + kg/1e6) — nguồn cửa đặt lịch khi OD di chuyển
  transfer: boolean                                 // trung chuyển theo cờ dòng chảy SAP (STO / nội bộ) — cờ thông tin
  allowed_models: string[] | null                   // luật 10 — dòng xe khách được vào (chụp lúc lập); null = không giới hạn
  separate: boolean                                 // 28/09 — khách đi xe riêng (cấu hình trên Khách)
  max_customers: number | null                      // 28/09 — số khách tối đa cùng xe của OD (khách → kênh); null = CHƯA KHAI = 1 (02/10)
}
export interface TripFreight {
  total: number | null; base: number | null; billed_pallets: number | null; unit: TariffUnit | null
  tariff_id: string | null; ward: string | null
  surcharges: { kind: string; per: SurchargePer; unit_amount: number; qty: number; total: number }[]
  reason: string | null
}
/** Một xe của thẻ (luật 11): dòng xe + phần tải máy chia cho nó + cước riêng của xe đó. */
export interface TripVehicle { model: EngineModel; pallets: number | null; tons: number | null; freight: number | null }
export interface DispatchTrip {
  seq: number
  group_code: string
  cluster: string                    // khoá cụm (để người đọc hiểu vì sao đi chung)
  vehicle_model: EngineModel | null  // dòng xe CHÍNH (lớn nhất) = vehicles[0].model
  vehicles: TripVehicle[]            // ≥ 2 = thẻ nhiều xe; [] = chưa có dòng xe
  carrier: EngineCarrier | null
  ods: TripOd[]
  wards: string[]
  stops: number
  pallets: number | null
  tons: number | null
  categories: string[]
  conditions: string[]               // điều kiện bảo quản của hàng trên xe (suy từ Loại kho); rỗng = chưa khai
  booking_category: string | null    // loại hàng chiếm tải lớn nhất — cửa đặt lịch (1 xe = 1 cửa)
  load: LoadUtil
  underload: boolean
  oversize: boolean
  freight: TripFreight
  carrier_reasons: string[]
  warnings: string[]
  merge_hint: string | null          // gợi ý gộp khi Non tải
}
/** `code` = OD vẫn NẰM KHUNG CHỜ (không vào "không lên xe"): NO_VEHICLE = thiếu KHAI BÁO dòng xe (khách/kênh) — khai xong ghép được;
 *  FOLLOW_ONLY = chỉ có hàng đi kèm đơn (POSM) chưa có chuyến chính cùng cụm — đơn chính về là ké theo (30/09). */
export interface UnplannedOd { od_number: string; ship_to_code: string | null; reason: string; code?: 'NO_VEHICLE' | 'FOLLOW_ONLY' }
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

const vnNum = (n: number) => Number(n.toFixed(3)).toLocaleString('vi-VN')
/** "30 pallet / 15 tấn" — sức chứa LỚN NHẤT trong một nhóm dòng xe. Câu cảnh báo phải nói ra SỐ, không nói suông. */
const capText = (ms: EngineModel[]) => {
  const p = Math.max(0, ...ms.map(m => numOr(m.max_pallets, 0)))
  const t = Math.max(0, ...ms.map(m => numOr(m.max_tons, 0)))
  return [p > 0 ? `${vnNum(p)} pallet` : '', t > 0 ? `${vnNum(t)} tấn` : ''].filter(Boolean).join(' / ') || 'chưa khai sức chứa'
}
const loadText = (p: number | null, t: number | null) =>
  [p != null ? `${vnNum(p)} pallet` : '', t != null ? `${vnNum(t)} tấn` : ''].filter(Boolean).join(' / ') || 'không đo được tải'

// ── Đơn vị xếp: một OD hoặc một PHẦN OD (tách theo dòng hàng nguyên) ──
interface Unit {
  od: EngineOd
  lines: EngineLine[]
  pallets: number | null
  tons: number | null
  part: { index: number; of: number } | null
  oversize: boolean
  multi?: boolean   // luật 11: OD lớn hơn mọi xe được vào nhưng N xe chở vừa ⇒ đi NGUYÊN trên một thẻ nhiều xe (không tách)
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
/** Luật 1 (28/09): khách bật "Đi xe riêng" ⇒ khoá riêng theo ship-to (không ghép khách khác); còn lại một lớp chung.
 *  Trước 28/09 máy TỰ tách khách trỏ kho (INT:<kho>) và khách SCAN — user: "không tự ép gì cả, config hết". */
export function classKey(od: EngineOd): string {
  return od.separate ? `SEP:${od.ship_to_code ?? od.od_number}` : 'ALL'
}
/** Khoá gộp (vùng): các chuyến cùng khoá này mới được gộp với nhau khi Non tải. */
export function mergeKey(od: EngineOd, allowMixChannels: boolean, catPart = ''): string {
  // Luật 9: `catPart` = Loại kho chính của OD ('*' = chỉ hàng đi kèm) khi kho KHÔNG cho trộn loại; '' = cho trộn
  // (29/09: khoá không còn mang kiểu đi Pallet/Xá — hai khách chung xe hay không do danh sách dòng xe GIAO nhau quyết)
  return `${classKey(od)}|${od.region_code ?? '?'}${allowMixChannels ? '' : `|${od.channel ?? '?'}`}${catPart ? `|C:${catPart}` : ''}`
}
/** Khoá cụm ban đầu: gộp thêm PHƯỜNG (điểm giao). */
export function clusterKey(od: EngineOd, allowMixChannels: boolean, catPart = ''): string {
  return `${mergeKey(od, allowMixChannels, catPart)}|${od.ward_code ?? od.ship_to_code ?? '?'}`
}
/** Khoá bỏ phần Loại kho — để hàng đi kèm (POSM) ké được vào chuyến của Loại kho chính cùng cụm. */
const baseKey = (k: string) => k.replace(/\|C:[^|]*/, '')
const catPartOf = (k: string) => /\|C:([^|]*)/.exec(k)?.[1] ?? ''
/** Luật 9: Loại kho CHÍNH của một tập dòng hàng — bỏ loại "đi kèm đơn" (POSM) và dòng chưa khai loại. */
export function mainCatsOf(lines: Pick<EngineLine, 'category'>[], follow: ReadonlySet<string> | string[] = []): string[] {
  const f = follow instanceof Set ? follow : new Set(follow)
  return uniq(lines.map(l => l.category).filter((c): c is string => !!c && !f.has(c))).sort(cmp)
}
/** Luật 10 (27/09): dòng xe OD được vào. Map {"*": [...], "<Loại kho>": [...]} của KHÁCH rồi của KÊNH; với mỗi Loại kho chính:
 *  khách×loại → khách×* → kênh×loại → kênh×*. OD nhiều Loại kho chính ⇒ GIAO các danh sách có khai (loại không khai không siết
 *  thêm). OD chỉ có hàng đi kèm (POSM) ⇒ khoá "*". 28/09 (user chốt "khách không khai thì không chọn"): Loại kho chính nào
 *  không bậc nào khai ⇒ loại đó không xe nào ⇒ OD không xe nào (mảng rỗng) — không còn "null = không giới hạn". */
export function resolveAllowedModels(cust: Record<string, unknown> | null | undefined, chan: Record<string, unknown> | null | undefined, mainCats: string[]): string[] {
  const list = (m: Record<string, unknown> | null | undefined, k: string): string[] | null => {
    const v = m?.[k]
    return Array.isArray(v) ? uniq(v.filter((x): x is string => typeof x === 'string' && !!x)).sort(cmp) : null
  }
  const forCat = (c: string | null) => (c ? list(cust, c) : null) ?? list(cust, '*') ?? (c ? list(chan, c) : null) ?? list(chan, '*') ?? []
  const lists = mainCats.length ? mainCats.map(forCat) : [forCat(null)]
  return lists.reduce((a, l) => a.filter(x => l.includes(x)))
}
/** Một bậc khai "số khách tối đa cùng xe": số CHUNG (`Customer.max_customers_per_trip` / `meta.max_customers_per_trip`) + bảng theo
 *  Loại kho (`max_customers_by_category` {FG01: 1, FG02: 4}). */
export type MaxCustomersCfg = { max?: number | null; by_category?: Record<string, unknown> | null } | null | undefined
/** 04/10 (user: "khách Trung chuyển mà đi FG01 thì đi một mình, còn FG02 thì ghép 3–4 điểm"): số khách tối đa cùng xe của OD theo
 *  Loại kho CHÍNH, cùng thứ tự với `resolveAllowedModels`: khách×loại → khách chung → kênh×loại → kênh chung. OD nhiều Loại kho chính
 *  ⇒ số KHẮT KHE nhất; một loại không bậc nào khai ⇒ cả OD = null (= CHƯA KHAI = 1 ở `odStopsCap`, chip Khai thiếu nêu kênh).
 *  OD không Loại kho chính (chỉ hàng đi kèm / chưa khai loại) ⇒ khách chung → kênh chung. */
export function resolveMaxCustomers(cust: MaxCustomersCfg, chan: MaxCustomersCfg, mainCats: string[]): number | null {
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null)
  const forCat = (c: string | null): number | null =>
    (c ? num(cust?.by_category?.[c]) : null) ?? num(cust?.max) ?? (c ? num(chan?.by_category?.[c]) : null) ?? num(chan?.max)
  const vals = mainCats.length ? mainCats.map(forCat) : [forCat(null)]
  return vals.some(v => v == null) ? null : Math.min(...(vals as number[]))
}
/** Switch "Ghép Loại kho khác" trên thẻ xe (27/09, user: "TẮT = chặn thả"): trả câu lý do nếu xe (sau khi nhận `moving`) chở hơn
 *  MỘT bộ Loại kho chính; null = cho thả. `allow` = switch của xe, không khai thì của kế hoạch (undefined = cho — kế hoạch cũ).
 *  Một OD tự chứa hai loại chính không tách được vẫn thả được (chỉ MỘT bộ). Dòng không có tải theo loại (kế hoạch cũ) không tính. */
export function mixBlockReason(allow: boolean | null | undefined, staying: { cat_load?: unknown }[], moving: { cat_load?: unknown }[], follow: string[] = []): string | null {
  if (allow !== false) return null
  const keyOf = (o: { cat_load?: unknown }) => mainCatsOf(Object.keys((o.cat_load ?? {}) as Record<string, unknown>).map(c => ({ category: c })), follow).join('+')
  const keys = (rs: { cat_load?: unknown }[]) => uniq(rs.map(keyOf).filter(Boolean)).sort(cmp)
  const all = keys([...staying, ...moving])
  if (all.length <= 1) return null
  const on = keys(staying), mv = keys(moving)
  return on.length
    ? `Xe đang chở ${on.join(', ')} — OD thả vào là ${mv.filter(k => !on.includes(k)).join(', ') || mv.join(', ')}. Bật "Ghép Loại kho khác" trên thẻ xe để cho ghép.`
    : `Các OD đang chọn gồm nhiều Loại kho (${mv.join(', ')}) — bật "Ghép Loại kho khác" trên thẻ xe, hoặc thả từng loại vào một xe.`
}
/** ĐK bảo quản của MỘT dòng hàng (26/09): hàng nằm ở ô KHAI RIÊNG ĐK thì mang ĐK của ô đó; ô không khai (null) và mã không
 *  có tồn ở ô khai riêng ⇒ theo Loại kho. `stock` = các ĐK của những ô đang chứa mã này (null = ô theo loại kho). */
export function lineConditions(catCond: string | null, stock: (string | null)[] | undefined, follow = false): string[] {
  // Hàng "đi kèm đơn" (POSM) đi theo xe của đơn — KHÔNG áp ĐK bảo quản của nó lên xe; không thì POSM khai "Thường" kèm đơn
  // FG02 (2–8 °C) sẽ đòi xe chở được cả hai mức ⇒ chỉ còn xe kết hợp nhận, sai hẳn ý "POSM đi theo đơn" (đo staging 26/09).
  if (follow) return []
  if (!stock || !stock.length) return catCond ? [catCond] : []
  return uniq(stock.map(c => c ?? catCond).filter((c): c is string => !!c)).sort(cmp)
}

// ── Sức chứa ──
interface Cap { pallets: number | null; tons: number | null }
function capOf(m: EngineModel): Cap {
  const p = Number(m.max_pallets), t = Number(m.max_tons)
  return { pallets: Number.isFinite(p) && p > 0 ? p : null, tons: Number.isFinite(t) && t > 0 ? t : null }
}
/** Sức chứa ĐỂ XẾP = sức chứa danh định × trần dải tải (`load_max_pct`, mặc định 100). Hiển thị % tải vẫn so với danh định
 *  (`capOf`), chỉ phép "vừa xe" mới nới — 17,4 pallet lên xe 17 với dải 90–105 % là 102,4 %, không phải 97 %. */
const maxPctOf = (m: Pick<EngineModel, 'load_max_pct'>) => { const x = Number(m.load_max_pct); return Number.isFinite(x) && x > 0 ? x : 100 }
function capFit(m: EngineModel): Cap {
  const c = capOf(m), k = maxPctOf(m) / 100
  return { pallets: c.pallets == null ? null : c.pallets * k, tons: c.tons == null ? null : c.tons * k }
}
/** Dải tải áp cho dòng xe theo cha (01/10): bản sao dòng xe mang `load_min_pct`/`load_max_pct`; bypass ⇒ 0 / 100 cho mọi xe. */
export function withLoadBands(models: EngineModel[], P: Pick<EngineParams, 'load_bands' | 'load_bypass'>): EngineModel[] {
  if (P.load_bypass) return models.map(m => ({ ...m, load_min_pct: 0, load_max_pct: 100 }))
  const bands = P.load_bands ?? {}
  if (!Object.keys(bands).length) return models
  return models.map(m => { const b = m.parent_type_id ? bands[m.parent_type_id] : undefined; return b ? { ...m, load_min_pct: b.min, load_max_pct: b.max } : m })
}
/** Đo theo chế độ của dòng xe — MỘT thước đo (02/10, user: "đo tải bằng gì kê khai bằng đó, không ảnh hưởng tới điều kiện khác"):
 *  PALLET → chỉ pallet (tấn khai thêm chỉ là ghi chú, trước 02/10 còn gác thêm tấn); TON → chỉ tấn. Tải null ở chiều cần đo → false. */
export function fits(m: EngineModel, pallets: number | null, tons: number | null): boolean {
  const c = capFit(m)
  const byTon = m.capacity_mode === 'TON' || c.pallets == null
  if (byTon) return c.tons != null && tons != null && tons <= c.tons + 1e-9
  return pallets != null && pallets <= c.pallets! + 1e-9
}
/** Dòng xe đo sức chứa bằng gì — tổ hợp nhiều xe (luật 11) chỉ ghép các xe CÙNG cách đo để % tải cộng được. */
export const basisOf = (m: EngineModel): 'PALLET' | 'TON' => (m.capacity_mode === 'TON' || capOf(m).pallets == null ? 'TON' : 'PALLET')
/** Luật 11: CHIA tải của một thẻ cho các xe — xe lớn trước chở đầy tới sức chứa, phần còn lại sang xe kế (chia theo tỷ lệ
 *  cả pallet lẫn tấn: hàng trên xe là một lát cắt của cả chuyến). null = N xe không chở hết, HOẶC có xe thừa (không nhận phần
 *  nào) — tổ hợp có xe thừa luôn đắt hơn tổ hợp bỏ xe đó nên không cần xét. `models` phải xếp lớn → nhỏ. */
export function splitLoad(models: EngineModel[], pallets: number | null, tons: number | null): { pallets: number | null; tons: number | null }[] | null {
  // Dải tải (01/10): chia theo sức chứa DANH ĐỊNH trước; chỉ khi N xe không chở hết ở 100 % mới dùng tới trần dải. Không thì
  // xe đầu bị nhồi 105 % trong khi xe sau còn chỗ (14 pallet trên 2 × 9: 9,45 + 4,55 thay vì 9 + 5 — gói 61 [15g] bắt ra lượt đầu).
  return splitWith(models, pallets, tons, capOf) ?? (models.some(m => maxPctOf(m) !== 100) ? splitWith(models, pallets, tons, capFit) : null)
}
function splitWith(models: EngineModel[], pallets: number | null, tons: number | null, cap: (m: EngineModel) => Cap): { pallets: number | null; tons: number | null }[] | null {
  if (!models.length) return null
  const fmax = (m: EngineModel) => {
    const c = cap(m)
    if (basisOf(m) === 'TON') return tons == null || c.tons == null ? 0 : tons <= 0 ? Infinity : c.tons / tons
    if (pallets == null) return 0
    return pallets <= 0 ? Infinity : c.pallets! / pallets   // một thước đo (02/10): xe pallet chia theo pallet, không gác tấn
  }
  let left = 1
  const out: { pallets: number | null; tons: number | null }[] = []
  for (const m of models) {
    const f = Math.min(left, fmax(m))
    if (!(f > 1e-9)) return null
    out.push({ pallets: pallets == null ? null : r3(pallets * f), tons: tons == null ? null : r3(tons * f) })
    left -= f
  }
  return left > 1e-9 ? null : out
}
/** Tối đa `n` xe dòng `m` có chở hết tải không — thử 2..n xe (splitLoad coi xe không nhận phần nào là xe THỪA ⇒ null, nên
 *  hỏi thẳng "đúng n xe" sẽ trả sai khi chỉ cần ít xe hơn: kho cho 3 xe, OD cần 2 — gói 61 [15g] bắt ra 27/09). */
export const fitsOnN = (m: EngineModel, n: number, pallets: number | null, tons: number | null) =>
  Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 2).some(k => !!splitLoad(Array(k).fill(m), pallets, tons))
/** Sức chứa CỘNG của một tổ hợp (cùng cách đo) — dựng thành một "dòng xe ảo" để đo % tải của cả thẻ bằng đúng `tripLoad`. */
export function comboModel(models: EngineModel[]): EngineModel {
  const [m0] = models
  if (models.length === 1) return m0
  const sum = (k: 'max_pallets' | 'max_tons') => (models.every(m => numOr(m[k], 0) > 0) ? r3(models.reduce((s, m) => s + numOr(m[k], 0), 0)) : null)
  return { ...m0, capacity_mode: basisOf(m0), max_pallets: basisOf(m0) === 'PALLET' ? sum('max_pallets') : null, max_tons: sum('max_tons') }
}
/** OD trung chuyển = SAP phân loại STO / INTERNAL (28/09: KHÔNG còn suy từ "khách trỏ kho" — trỏ kho chỉ quyết việc NHẬN) — chỉ còn là cờ trên dòng
 *  OD (`dispatch_trip_od.is_transfer`), không quyết dòng xe nữa (luật 8 bỏ 28/09). */
export const isTransferOd = (od: Pick<EngineOd, 'flow'>) => od.flow === 'STO' || od.flow === 'INTERNAL'
type FleetOd = Pick<EngineOd, 'flow' | 'allowed_models'>
/** Luật 10: OD cho phép dòng xe này không — CHỈ danh sách đã resolve (rỗng = không xe nào); null (dòng cũ / test) = không giới hạn. */
export const odAllows = (m: Pick<EngineModel, 'id'>, o: FleetOd) => (o.allowed_models ? o.allowed_models.includes(m.id) : true)
/** Có OD nào trên nhóm khai danh sách dòng xe riêng không (để câu cảnh báo nói đúng nguyên nhân). */
export const hasAllowList = (ods: Pick<EngineOd, 'allowed_models'>[]) => ods.some(o => !!o.allowed_models)
/** Họ dòng xe dùng được cho một nhóm OD = dòng xe MỌI OD đều cho phép (luật 10). 29/09: không còn lọc theo kiểu đi
 *  Pallet/Xá — người khai đã chọn dòng xe cụ thể cho khách/kênh, máy chỉ đi trong danh sách đó. */
export const fleetFor = (models: EngineModel[], ods: FleetOd[], opts: { ignoreAllowList?: boolean } = {}) => {
  const eff = opts.ignoreAllowList ? ods.map(o => ({ ...o, allowed_models: null })) : ods
  return models.filter(m => eff.every(o => odAllows(m, o)))
}
/** Luật 4b (26/09, user: "được ghép thì mới lôi vào"): dòng xe chở được ≥ 2 mức mà Loại kho có khai (xe kết hợp nóng / lạnh)
 *  chỉ dành cho chuyến CẦN ≥ 2 mức; chuyến một mức ưu tiên xe đúng mức, chỉ rơi về xe kết hợp khi không xe đúng mức nào có cước. */
export const isComboFor = (m: EngineModel, combo: string[]) => combo.filter(c => servesConditions(m, [c])).length >= 2
/** 28/09: trần số khách cùng xe do CHÍNH các OD trên xe mang (khách → kênh); OD nào khắt khe nhất áp cho cả xe.
 *  02/10 (user: "khách muốn được ghép phải khai, không khai thì cảnh báo"): OD chưa khai = 1 ⇒ xe chở OD đó chỉ một khách. Bin rỗng = ∞. */
export const odStopsCap = (ods: Pick<EngineOd, 'max_customers'>[]): number => {
  const caps = ods.map(o => (typeof o.max_customers === 'number' && o.max_customers >= 1 ? o.max_customers : 1))
  return caps.length ? Math.min(...caps) : Infinity
}
export const minCap = (...caps: (number | null | undefined)[]): number | null => { const xs = caps.filter((x): x is number => typeof x === 'number'); return xs.length ? Math.min(...xs) : null }
/** Luật 4: xe khai rỗng = chở được mọi điều kiện (cùng quy ước `Location.categories` của app). */
export function servesConditions(m: EngineModel, conds: string[]): boolean {
  const sv = (m.serve_conditions ?? []).filter(Boolean)
  if (!sv.length) return true
  return conds.every(c => sv.includes(c))
}
const catsOf = (lines: EngineLine[]): string[] => uniq(lines.map(l => l.category).filter((c): c is string => !!c)).sort(cmp)
export const condsOf = (lines: EngineLine[]): string[] => uniq(lines.flatMap(l => l.conditions ?? (l.condition ? [l.condition] : [])).filter(Boolean)).sort(cmp)

// ── Thùng xếp (bin) trong lúc ghép ──
interface Bin { key: string; mkey: string; units: Unit[]; pallets: number; tons: number }
const binWards = (b: Bin) => uniq(b.units.map(u => u.od.ward_code ?? u.od.ship_to_code ?? '?')).sort(cmp)
const binStops = (b: Bin) => Math.max(uniq(b.units.map(u => u.od.ship_to_code ?? u.od.od_number)).length, 1)
/** Bin không nhận thêm / không gộp: có phần vượt xe lớn nhất, hoặc OD nguyên đang cần thẻ nhiều xe. */
const solo = (b: Bin) => b.units.some(u => u.oversize || u.multi)
const withUnits = (b: Bin, units: Unit[]): Bin => {
  const all = [...b.units, ...units]
  return { ...b, units: all, pallets: r3(all.reduce((s, u) => s + (u.pallets ?? 0), 0)), tons: r3(all.reduce((s, u) => s + (u.tons ?? 0), 0)) }
}
/** Bin xếp được không: không vượt điểm giao · VÀ có ít nhất MỘT dòng xe vừa phục vụ đủ điều kiện bảo quản của cả bin
 *  VỪA chở được tải của bin. Vế sau làm hàng lạnh tự tách khỏi hàng thường khi đội xe không có xe kết hợp đủ lớn.
 *  ⚠ Hai vế phải hỏi CÙNG một dòng xe (vá 25/09): bản cũ kiểm "vừa xe lớn nhất" (xe thường 68 pallet) và "có xe nào
 *  phục vụ lạnh" (xe kết hợp 30 pallet) trên HAI xe khác nhau ⇒ gom 54 pallet có hàng lạnh vào một bin mà không xe
 *  nào nhận — đo Ba Vì 25/09: 3 chuyến "chưa chọn dòng xe". `cands` = họ dòng xe của bin (ưu tiên xe có cước). */
const binFits = (cands: EngineModel[], b: Bin) => {
  const stops = binStops(b)
  // 02/10 (user: "bỏ cài đặt WMS; khách và dòng xe muốn được ghép phải KHAI, không khai thì cảnh báo"): hai trần, cả hai mặc định 1 —
  // (a) khách/kênh "số khách tối đa cùng xe" (`odStopsCap`, OD khắt khe nhất áp cho cả xe); (b) dòng xe `max_drops` hỏi ở vế dưới
  // cùng với tải + điều kiện bảo quản. Không còn số của kho.
  if (stops > odStopsCap(b.units.map(u => u.od))) return false
  const conds = condsOf(b.units.flatMap(u => u.lines))
  return cands.some(m => servesConditions(m, conds) && fits(m, b.pallets, b.tons) && stops <= modelDrops(m))
}
/** Điểm giao tối đa của một dòng xe: khai ở Mã dòng xe; KHÔNG khai = 1 (một khách) — muốn ghép phải khai (02/10). */
// 04/10 (user: "điểm giao theo khách hàng mà, không nhớ gì tới dòng xe"): dòng xe CHƯA KHAI = KHÔNG giới hạn — số khách trên xe do
// khách / kênh quyết (chưa khai ở đó mới = 1); dòng xe chỉ khai khi muốn SIẾT (xe pallet một khách). Trước 04/10 chưa khai = 1 làm
// mọi xe xá / lạnh / cont bóp trần của kênh về 1 (đo Ba Vì 05/10: 431/431 xe một khách dù kênh khai 3–5).
export const modelDrops = (m: Pick<EngineModel, 'max_drops'>) => m.max_drops ?? Infinity

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
  pricedByWard: Map<string, Set<string>>       // phường → dòng xe có cước (bất kỳ ĐVVT) — lọc ứng viên tổ hợp (luật 11)
}
const tKey = (c: string, m: string) => `${c}|${m}`
/** Dựng bối cảnh từ input — controller dùng lại để tính lại cước khi người đổi dòng xe/ĐVVT/chuyển OD trên bản nháp. */
export function buildCtx(input: EngineInput): Ctx {
  // dải tải theo cha (01/10) đi vào bản sao dòng xe ngay từ đây — mọi chỗ hỏi "vừa xe" / "đủ tải" của engine đều đọc ctx.models
  const models = withLoadBands(input.models, input.params).filter(m => m.is_active && m.parent_type_name && (capOf(m).pallets != null || capOf(m).tons != null)).sort((a, b) => cmp(a.sap_code, b.sap_code))
  const tariffsBy = new Map<string, EngineTariff[]>()
  for (const t of input.tariffs) { const k = tKey(t.transport_company_id, t.vehicle_model_id); const l = tariffsBy.get(k) ?? []; l.push(t); tariffsBy.set(k, l) }
  const surBy = new Map<string, EngineSurcharge[]>()
  for (const s of input.surcharges) { const l = surBy.get(s.transport_company_id) ?? []; l.push(s); surBy.set(s.transport_company_id, l) }
  const pricedByWard = new Map<string, Set<string>>()
  for (const t of effectiveAt(input.tariffs.map(t => ({ ...t, is_active: t.is_active ?? true })), input.params.day)) { const s = pricedByWard.get(t.ward_code) ?? new Set<string>(); s.add(t.vehicle_model_id); pricedByWard.set(t.ward_code, s) }
  return { input, models, tariffsBy, surBy, allocs: effectiveAt(input.allocations.map(a => ({ ...a, is_active: a.is_active ?? true })), input.params.day), pricedByWard }
}
/** Ngưỡng Non tải của một dòng xe: dải theo cha (01/10) → ngưỡng kho → 70. `load_min_pct = 0` (bypass) là hợp lệ.
 *  02/10: ô "Non tải dưới %" của dòng xe BỎ (bàn điều vận là chỗ khai duy nhất, kho là mặc định khi mở bàn). */
export const underPctOf = (m: EngineModel | null | undefined, whUnderloadPct: number | null | undefined): number =>
  (m?.load_min_pct != null && Number.isFinite(Number(m.load_min_pct)) ? Number(m.load_min_pct) : null) ?? (whUnderloadPct != null && whUnderloadPct > 0 ? whUnderloadPct : 70)
/** Tải + Non tải của một chuyến theo dòng xe đã chọn (dải theo cha đè ngưỡng kho); `max_pct` = trần xếp để màn in "vượt" đúng mốc. */
export function tripLoad(model: EngineModel | null, pallets: number | null, tons: number | null, whUnderloadPct: number | null): LoadUtil {
  const u = loadUtilization(model ? { capacity_mode: model.capacity_mode, max_pallets: model.max_pallets, max_tons: model.max_tons, underload_pct: underPctOf(model, whUnderloadPct) } : null, pallets, tons)
  // loadUtilization coi underload_pct ≤ 0 là "không khai" ⇒ 70; bypass (0) phải là 0 thật
  const up = underPctOf(model, whUnderloadPct)
  return { ...u, underload_pct: up, underload: u.pct == null ? null : u.pct < up, max_pct: model ? maxPctOf(model) : 100 }
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
/** Luật 11: cước của một THẺ nhiều xe với MỘT ĐVVT = Σ cước từng xe theo phần tải của xe đó (cùng `priceFor`). Một xe thiếu
 *  cước ⇒ cả thẻ không có cước (kèm lý do của xe đó). Một xe ⇒ đúng `priceFor`. Tổ hợp không chở hết ⇒ chia theo tỷ lệ sức
 *  chứa (người ép tổ hợp nhỏ hơn tải — thẻ vượt tải, vẫn có số để đọc). */
export function priceCombo(ctx: Ctx, models: EngineModel[], carrierId: string, wards: string[], stops: number, pallets: number | null, tons: number | null): { freight: TripFreight; parts: TripVehicle[] } {
  if (models.length === 1) { const f = priceFor(ctx, models[0], carrierId, wards, stops, pallets, tons); return { freight: f, parts: [{ model: models[0], pallets, tons, freight: f.total }] } }
  const ms = [...models].sort(bigFirst)
  const cm = comboModel(ms)
  const share = splitLoad(ms, pallets, tons) ?? ms.map(m => {
    const k = basisOf(m) === 'TON' ? numOr(m.max_tons, 0) / numOr(cm.max_tons, 1) : numOr(m.max_pallets, 0) / numOr(cm.max_pallets, 1)
    return { pallets: pallets == null ? null : r3(pallets * k), tons: tons == null ? null : r3(tons * k) }
  })
  const fs = ms.map((m, i) => priceFor(ctx, m, carrierId, wards, stops, share[i].pallets, share[i].tons))
  const parts = ms.map((m, i) => ({ model: m, pallets: share[i].pallets, tons: share[i].tons, freight: fs[i].total }))
  const miss = fs.find(f => f.total == null)
  if (miss) return { freight: { ...miss, total: null, base: null, surcharges: [] }, parts }
  const billed = fs.every(f => f.billed_pallets != null) ? fs.reduce((s, f) => s + f.billed_pallets!, 0) : null
  return { freight: { total: fs.reduce((s, f) => s + f.total!, 0), base: fs.reduce((s, f) => s + (f.base ?? 0), 0), billed_pallets: billed, unit: fs[0].unit, tariff_id: fs[0].tariff_id, ward: fs[0].ward, surcharges: fs.flatMap(f => f.surcharges), reason: null }, parts }
}
/** Tên một tổ hợp để viết câu lý do: "Xe 8T + Xe 2T". */
const comboText = (ms: EngineModel[]) => ms.map(m => m.name).join(' + ')
export function sharePct(basis: ShareBasis, a: ShareActual, totals: ShareActual): number | null {
  const den = basis === 'TRIPS' ? totals.trips : basis === 'PALLETS' ? totals.pallets : totals.tons
  const num = basis === 'TRIPS' ? a.trips : basis === 'PALLETS' ? a.pallets : a.tons
  return den > 0 ? Math.round((num / den) * 1000) / 10 : null
}
function chooseCarrier(ctx: Ctx, model: EngineModel, wards: string[], region: string | null, stops: number, pallets: number | null, tons: number | null, actual: Record<string, ShareActual>): PriceOpt | null {
  return chooseCarrierBy(ctx, cid => priceFor(ctx, model, cid, wards, stops, pallets, tons), wards, region, actual)
}
/** Luật 6 với cách tính giá bất kỳ (một xe · thẻ nhiều xe) — cùng các bậc phân tuyến → tỷ trọng → rẻ nhất. */
function chooseCarrierBy(ctx: Ctx, price: (carrierId: string) => TripFreight, wards: string[], region: string | null, actual: Record<string, ShareActual>): PriceOpt | null {
  const input = ctx.input
  const carriers = [...input.carriers].sort((a, b) => cmp(a.code, b.code))
  let pool: PriceOpt[] = carriers.map(c => ({ carrier: c, freight: price(c.id), reasons: [] as string[] })).filter(p => p.freight.total != null)
  if (!pool.length) return null
  const pricedN = pool.length   // bao nhiêu ĐVVT CÓ CƯỚC cho tuyến này — giữ lại để câu lý do cuối nói đúng
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
  // Câu này là LỜI GIẢI THÍCH cho điều vận, nên phải nêu ĐÚNG bước nào đã thu hẹp lựa chọn.
  // Bản cũ luôn nói "ĐVVT duy nhất có cước" khi pool còn 1 — nhưng pool đã qua hai bộ lọc ở trên.
  // Đo Ba Vì 07/09 sau khi khai tỷ trọng: **22/22 chuyến** mang câu đó trong khi cả 3 ĐVVT đều có
  // cước cho MỌI cặp (phường × dòng xe) — điều vận đọc xong sẽ đi xin báo giá thứ vốn đã có sẵn.
  if (pool.length > 1) best.reasons.push(`Cước thấp nhất trong ${pool.length} ĐVVT${pool.length < pricedN ? ' còn lại sau lọc' : ' có cước'}`)
  else if (pricedN === 1) best.reasons.push('ĐVVT duy nhất có cước cho tuyến/dòng xe này')
  else if (under.length === 1) best.reasons.push(`ĐVVT duy nhất đang dưới tỷ trọng kỳ (${pricedN} ĐVVT có cước cho tuyến này)`)
  else best.reasons.push(`ĐVVT duy nhất của phân tuyến ${alloc?.label ?? ''} (${pricedN} ĐVVT có cước cho tuyến này)`)
  return best
}

/** Xe lớn trước — so TẤN trước rồi mới tới PALLET: họ xá từ 26/09 trộn xe kết hợp đo bằng pallet (17 pallet / 16 tấn) với xe
 *  tải đo bằng tấn (30 tấn, không khai pallet). So pallet trước thì xe 17 pallet "lớn hơn" xe 30 tấn ⇒ dòng hàng 27 tấn bị coi
 *  là vượt xe lớn nhất (đo Bàu Bàng 26/09: 6 chuyến). Họ thuần pallet không khai tấn thì tấn = 0 cho mọi xe ⇒ vẫn so pallet. */
export const bigFirst = (a: EngineModel, b: EngineModel) => (numOr(b.max_tons, 0) - numOr(a.max_tons, 0)) || (numOr(b.max_pallets, 0) - numOr(a.max_pallets, 0)) || cmp(a.sap_code, b.sap_code)
const sizeKey = (m: EngineModel) => `${numOr(m.max_tons, 0)}|${numOr(m.max_pallets, 0)}`

interface Assigned {
  model: EngineModel | null; carrier: EngineCarrier | null; freight: TripFreight; reasons: string[]; warnings: string[]
  cats: string[]; conds: string[]; wards: string[]; stops: number; pallets: number | null; tons: number | null; oversize: boolean
  vehicles: TripVehicle[]          // luật 11: các xe của thẻ (một xe ⇒ một phần tử)
  loadModel: EngineModel | null    // "dòng xe" để đo % tải cả thẻ — tổ hợp ⇒ sức chứa cộng (`comboModel`)
}
/** Luật 11 — chọn (dòng xe, ĐVVT) cho một bin: một xe theo ba bậc (`assignSingle`), rồi nếu kho cho ghép nhiều xe thì so với
 *  tổ hợp rẻ nhất. `withCombos` = false trong vòng gộp Non tải (chỉ cần so tương đối, tổ hợp tốn thời gian tính); bin có OD cần
 *  thẻ nhiều xe thì luôn tính tổ hợp. Tổ hợp chỉ thắng khi RẺ HƠN hẳn một xe (≥ 1 ₫) — hoà thì một xe (ít xe dễ điều hơn). */
function assignVehicle(ctx: Ctx, b: Bin, actual: Record<string, ShareActual>, underPct: (m: EngineModel) => number, withCombos = false): Assigned {
  const single = assignSingle(ctx, b, actual, underPct)
  const K = Math.max(1, Math.min(5, Math.trunc(Number(ctx.input.params.max_vehicles) || 1)))
  const needMulti = b.units.some(u => u.multi)
  if (K < 2 || (!withCombos && !needMulti)) return single
  const combo = bestCombo(ctx, b, actual, K)
  if (!combo) return single
  const txt = comboText(combo.vehicles.map(v => v.model))
  if (needMulti) {
    combo.reasons.unshift(`OD lớn hơn mọi dòng xe được vào — đi NGUYÊN trên ${combo.vehicles.length} xe (${txt}), không tách OD`)
    return combo
  }
  if (combo.freight.total == null) return single
  if (single.freight.total != null && combo.freight.total > single.freight.total - 1) return single
  combo.reasons.unshift(single.freight.total != null
    ? `Ghép ${combo.vehicles.length} xe (${txt}) ${vnNum(combo.freight.total)} ₫ — rẻ hơn một xe ${single.model?.name ?? ''} ${vnNum(single.freight.total)} ₫`
    : `Ghép ${combo.vehicles.length} xe (${txt}) — một xe không có cước`)
  return combo
}
/** Tổ hợp 2..K dòng xe (cho phép lặp — 2 × xe 17 tấn) rẻ nhất chở được bin. Chỉ xét dòng xe qua đủ luật 4/7/8/10 của bin, CÙNG
 *  cách đo sức chứa, tối đa 10 dòng xe lớn nhất có cước cho phường của bin (chặn số tổ hợp); tổ hợp phải chở hết và không có
 *  xe thừa (`splitLoad`). Không tổ hợp nào có cước ⇒ tổ hợp ít xe nhất vừa tải, ĐVVT trống (cảnh báo nêu lý do). */
function bestCombo(ctx: Ctx, b: Bin, actual: Record<string, ShareActual>, K: number): Assigned | null {
  const lines = b.units.flatMap(u => u.lines)
  const cats = catsOf(lines), conds = condsOf(lines)
  const wards = binWards(b).filter(w => w !== '?')
  const stops = binStops(b)
  const region = b.units[0]?.od.region_code ?? null
  const pAll = b.units.every(u => u.pallets != null) ? r3(b.pallets) : null
  const tAll = b.units.every(u => u.tons != null) ? r3(b.tons) : null
  const all = fleetFor(ctx.models, b.units.map(u => u.od)).filter(m => servesConditions(m, conds) && stops <= modelDrops(m))
  const combo = ctx.input.params.combo_conditions ?? []
  const needCombo = combo.filter(c => conds.includes(c)).length >= 2
  const single = combo.length >= 2 && !needCombo ? all.filter(m => !isComboFor(m, combo)) : all
  const tiers = single.length && single.length < all.length ? [single, all] : [all]
  const priced = (m: EngineModel) => wards.some(w => ctx.pricedByWard.get(w)?.has(m.id))
  for (const list0 of tiers) {
    const list = (list0.some(priced) ? list0.filter(priced) : list0).sort(bigFirst).slice(0, 10)
    // không dòng xe nào qua luật của bin (vd không xe phục vụ mức bảo quản) ⇒ không có tổ hợp — vòng liệt kê bên dưới
    // với danh sách rỗng sẽ đọc list[0] = undefined (gói 61 [7f] bắt ra 500 ngay lượt đầu trên Preview 27/09)
    if (!list.length) continue
    let best: { ms: EngineModel[]; opt: PriceOpt | null } | null = null
    const tryCombo = (ms: EngineModel[]) => {
      if (!ms.every(m => basisOf(m) === basisOf(ms[0])) || !splitLoad(ms, pAll, tAll)) return
      const opt = chooseCarrierBy(ctx, cid => priceCombo(ctx, ms, cid, wards, stops, pAll, tAll).freight, wards, region, actual)
      if (!best) { best = { ms, opt }; return }
      const a = opt?.freight.total ?? null, c = best.opt?.freight.total ?? null
      if (a != null && (c == null || a < c - 1e-6 || (Math.abs(a - c) <= 1e-6 && ms.length < best.ms.length))) best = { ms, opt }
    }
    for (let k = 2; k <= K; k++) {
      const idx = Array(k).fill(0)
      for (;;) {
        tryCombo(idx.map(i => list[i]))
        let p = k - 1
        while (p >= 0 && idx[p] === list.length - 1) p--
        if (p < 0) break
        idx[p]++
        for (let q = p + 1; q < k; q++) idx[q] = idx[p]
      }
    }
    const got = best as { ms: EngineModel[]; opt: PriceOpt | null } | null
    if (!got) continue
    const cm = comboModel(got.ms)
    const reasons = got.opt ? [...got.opt.reasons] : []
    const warnings = got.opt ? [] : [`Chưa có bảng cước đủ cho ${comboText(got.ms)} ở mọi ĐVVT — chọn tổ hợp ít xe nhất còn vừa tải`]
    const priceNow = got.opt ? priceCombo(ctx, got.ms, got.opt.carrier.id, wards, stops, pAll, tAll) : null
    const parts = priceNow?.parts ?? got.ms.map((m, i) => ({ model: m, ...(splitLoad(got.ms, pAll, tAll)![i]), freight: null }))
    const freight: TripFreight = got.opt ? got.opt.freight
      : { total: null, base: null, billed_pallets: pAll != null ? billedPallets(pAll) : null, unit: cm.tariff_unit, tariff_id: null, ward: wards[0] ?? null, surcharges: [], reason: warnings[0] }
    return { model: got.ms[0], carrier: got.opt?.carrier ?? null, freight, reasons, warnings, cats, conds, wards, stops, pallets: pAll, tons: tAll, oversize: false, vehicles: parts, loadModel: cm }
  }
  return null
}
/** Luật 3 (hạ xe) + 6: với một bin đã xếp, chọn (dòng xe, ĐVVT) theo ba bậc:
 *  (1) trong các dòng xe CHỞ ĐỦ TẢI (không Non tải) có cước ⇒ rẻ nhất; (2) không dòng xe nào đủ tải ⇒ dòng xe NHỎ NHẤT còn vừa
 *  mà có cước; (3) không có cước ⇒ dòng xe nhỏ nhất vừa tải, ĐVVT trống. Vì sao không "rẻ nhất tuyệt đối": cước theo pallet của
 *  xe to thường rẻ hơn/pallet nên "rẻ nhất" đưa 0,5 pallet lên xe 34 pallet (đo Ba Vì 07/09: 77/77 xe đều là Xe 34 Pallet,
 *  73 Non tải) — không ĐVVT nào nhận giá đó cho chuyến như vậy, và điều vận không bao giờ xếp thế. */
function assignSingle(ctx: Ctx, b: Bin, actual: Record<string, ShareActual>, underPct: (m: EngineModel) => number): Assigned {
  const cats = catsOf(b.units.flatMap(u => u.lines))
  const conds = condsOf(b.units.flatMap(u => u.lines))
  const condLabel = (c: string) => ctx.input.condition_labels?.[c] ?? c
  const wards = binWards(b).filter(w => w !== '?')
  const stops = binStops(b)
  const region = b.units[0]?.od.region_code ?? null
  const pAll = b.units.every(u => u.pallets != null) ? r3(b.pallets) : null
  const tAll = b.units.every(u => u.tons != null) ? r3(b.tons) : null
  const oversize = b.units.some(u => u.oversize)
  const family = fleetFor(ctx.models, b.units.map(u => u.od))
  const cands0 = family.filter(m => servesConditions(m, conds) && (oversize || fits(m, pAll, tAll)) && stops <= modelDrops(m))
    .sort((a, c) => (numOr(a.max_pallets, 1e9) - numOr(c.max_pallets, 1e9)) || (numOr(a.max_tons, 1e9) - numOr(c.max_tons, 1e9)) || cmp(a.sap_code, c.sap_code))
  // Chuyến VƯỢT TẢI (một dòng hàng lớn hơn mọi xe): không xe nào "vừa" nên ba bậc bên dưới sẽ chọn xe RẺ NHẤT — đo Bàu Bàng 26/09
  // ra xe 1 tấn cho dòng 27 tấn (tải 2.737 %). Chỉ giữ các dòng xe CỠ LỚN NHẤT, trong đó mới chọn theo cước.
  const top = oversize ? [...cands0].sort(bigFirst)[0] : null
  const cands = top ? cands0.filter(m => sizeKey(m) === sizeKey(top)) : cands0
  const warnings: string[] = []
  const pickPriced = (list: EngineModel[]): { model: EngineModel; opt: PriceOpt } | null => {
    const priced: { model: EngineModel; opt: PriceOpt; full: boolean }[] = []
    for (const m of list) {
      const opt = chooseCarrier(ctx, m, wards, region, stops, pAll, tAll, actual)
      if (!opt) continue
      const u = loadUtilization({ capacity_mode: m.capacity_mode, max_pallets: m.max_pallets, max_tons: m.max_tons, underload_pct: underPct(m) }, pAll, tAll)
      priced.push({ model: m, opt, full: u.pct != null && u.pct >= underPct(m) })
    }
    const pool = priced.some(p => p.full) ? priced.filter(p => p.full) : priced   // (1) đủ tải trước; (2) không ai đủ tải ⇒ giữ cả
    let best: { model: EngineModel; opt: PriceOpt } | null = null
    for (const p of pool) {
      if (!best) { best = p; continue }
      if (pool === priced) {   // bậc (2): nhỏ nhất trước, rồi mới rẻ — cands đã sắp nhỏ→lớn nên chỉ cần giữ phần tử đầu
        break
      }
      if (p.opt.freight.total! < best.opt.freight.total! || (p.opt.freight.total === best.opt.freight.total && numOr(p.model.max_pallets, 0) < numOr(best.model.max_pallets, 0))) best = p
    }
    if (best && pool === priced && priced.length) best.opt.reasons.push(`Không dòng xe nào chở đủ tải (dưới ${underPct(best.model)}%) — chọn dòng xe nhỏ nhất còn vừa có cước`)
    return best
  }
  // Luật 4b: chuyến chỉ cần MỘT trong các mức Loại kho có khai ⇒ thử xe đúng mức trước, xe kết hợp là đường lui
  const combo = ctx.input.params.combo_conditions ?? []
  const needCombo = combo.filter(c => conds.includes(c)).length >= 2
  const single = combo.length >= 2 && !needCombo ? cands.filter(m => !isComboFor(m, combo)) : cands
  const tiers = single.length && single.length < cands.length ? [single, cands.filter(m => !single.includes(m))] : [cands]
  for (const [ti, list] of tiers.entries()) {
    const best = pickPriced(list)
    if (!best) continue
    if (ti === 1) best.opt.reasons.push('Không xe đúng mức bảo quản nào vừa tải + có cước — dùng xe chở được nhiều mức (xe kết hợp)')
    return { model: best.model, carrier: best.opt.carrier, freight: best.opt.freight, reasons: best.opt.reasons, warnings, cats, conds, wards, stops, pallets: pAll, tons: tAll, oversize,
      vehicles: [{ model: best.model, pallets: pAll, tons: tAll, freight: best.opt.freight.total }], loadModel: best.model }
  }
  const m0 = single[0] ?? cands[0] ?? null
  if (!m0) {
    // Nói THẲNG cái gì chặn, vì BA nguyên nhân dưới đây đòi BA việc khác hẳn nhau. Quan trọng nhất: đừng
    // giục "khai ở Cài đặt TMS" khi đội xe phục vụ mức đó ĐÃ khai mà chỉ là không đủ lớn — người làm theo
    // lời giục sẽ tick bừa xe thường thành xe lạnh, tức đẩy hàng lạnh lên xe không có lạnh. Đo Ba Vì 07/09
    // sau khi khai FG02 = 2–8 °C: đúng 1 chuyến rơi vào ca này (31,564 pallet, xe lạnh lớn nhất 30 pallet).
    const serving = conds.length ? family.filter(m => servesConditions(m, conds)) : family
    const fitIgnoringConds = family.some(m => (oversize || fits(m, pAll, tAll)) && stops <= modelDrops(m))
    const condText = conds.map(condLabel).join(' + ')
    const famText = 'dòng xe'
    const listed = hasAllowList(b.units.map(u => u.od))
    if (listed && !family.length)
      warnings.push('Các khách trên chuyến không có dòng xe CHUNG nào được vào (Khách hàng → Dòng xe được vào) — tách chuyến hoặc sửa danh sách')
    else if (listed && !family.some(m => oversize || fits(m, pAll, tAll)))
      warnings.push(`Dòng xe khách được vào lớn nhất chỉ ${capText(family)} — chuyến này ${loadText(pAll, tAll)}: tách chuyến hoặc thêm dòng xe lớn hơn cho khách (Khách hàng → Dòng xe được vào)`)
    else if (!family.length) warnings.push(`Chưa có ${famText} nào khai sức chứa — khai ở Cài đặt TMS → Mã dòng xe`)
    else if (!conds.length || !fitIgnoringConds) warnings.push(`Không ${famText} nào vừa tải ${loadText(pAll, tAll)} (lớn nhất ${capText(family)}) — tách chuyến`)
    else if (!serving.length) warnings.push(`Không dòng xe nào phục vụ điều kiện bảo quản ${condText} — khai ở Cài đặt TMS → Mã dòng xe`)
    else if (serving.some(m => oversize || fits(m, pAll, tAll)))
      warnings.push(`Dòng xe phục vụ điều kiện bảo quản ${condText} chở được tải này nhưng không dòng nào đi được ${stops} điểm giao — tách chuyến`)
    else warnings.push(`Dòng xe phục vụ điều kiện bảo quản ${condText} lớn nhất chỉ ${capText(serving)} — chuyến này ${loadText(pAll, tAll)}, phải tách chuyến`)
  } else warnings.push('Chưa có bảng cước cho tuyến/dòng xe này ở mọi ĐVVT — chọn dòng xe nhỏ nhất còn vừa tải')
  const freight: TripFreight = { total: null, base: null, billed_pallets: pAll != null ? billedPallets(pAll) : null, unit: m0?.tariff_unit ?? null, tariff_id: null, ward: wards[0] ?? null, surcharges: [], reason: warnings[warnings.length - 1] }
  return { model: m0, carrier: null, freight, reasons: [], warnings, cats, conds, wards, stops, pallets: pAll, tons: tAll, oversize,
    vehicles: m0 ? [{ model: m0, pallets: pAll, tons: tAll, freight: null }] : [], loadModel: m0 }
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
  const bigSort = bigFirst
  const pricedByWard = ctx.pricedByWard
  const maxVeh = Math.max(1, Math.min(5, Math.trunc(Number(P.max_vehicles) || 1)))
  /** Họ dòng xe để xếp một cụm: dòng xe khách được vào, ưu tiên dòng xe CÓ CƯỚC cho phường của cụm. */
  const candsFor = (group: EngineOd[]): EngineModel[] => {
    const fam = fleetFor(models, group)
    const ids = new Set(group.flatMap(o => (o.ward_code ? [...(pricedByWard.get(o.ward_code) ?? [])] : [])))
    const priced = fam.filter(m => ids.has(m.id))
    return priced.length ? priced : fam
  }
  /** Xe lớn nhất để TÁCH một OD: trong họ + phục vụ đủ điều kiện bảo quản của OD (không có thì xe lớn nhất của họ). */
  const bigForOd = (od: EngineOd): EngineModel | null => {
    const cs = candsFor([od])
    const conds = condsOf(od.lines)
    const serving = cs.filter(m => servesConditions(m, conds))
    return [...(serving.length ? serving : cs)].sort(bigSort)[0] ?? null
  }
  const underPct = (m: EngineModel | null) => underPctOf(m, P.underload_pct)

  // ── Lọc + tách đơn vị xếp ──
  const mixCats = P.allow_mix_categories !== false
  const follow = new Set(P.follow_categories ?? [])
  // OD CHỈ có hàng đi kèm (POSM) không bao giờ có xe riêng khi kho không trộn loại — nó đi xe của ĐƠN CHÍNH nên KHÔNG mang danh sách dòng
  // xe riêng (01/10: Blue Star khai FG01 = Xe 4/6 pallet, OD POSM của khách lấy "*" của kênh GT = Xe 16/17 ⇒ hai danh sách giao nhau
  // rỗng ⇒ POSM không ké được xe nào của chính khách, kẹt khung chờ mãi với lý do "chờ đơn chính")
  const followOnlyOd = (o: EngineOd) => !mixCats && o.lines.length > 0 && o.lines.every(l => !!l.category) && !mainCatsOf(o.lines, follow).length
  const units: Unit[] = []
  for (const od0 of ods) {
    const od = followOnlyOd(od0) ? { ...od0, allowed_models: null } : od0
    if (!LOADABLE.has(od.flow)) { unplanned.push({ od_number: od.od_number, ship_to_code: od.ship_to_code, reason: `Phân loại ${od.flow} không lên xe` }); continue }
    if (!od.lines.length) { unplanned.push({ od_number: od.od_number, ship_to_code: od.ship_to_code, reason: 'OD không có dòng hàng' }); continue }
    const s = sumLines(od.lines)
    if (s.pallets == null && s.tons == null) { unplanned.push({ od_number: od.od_number, ship_to_code: od.ship_to_code, reason: `Không đo được tải (${od.lines.filter(l => l.pallets == null && l.kg == null).length} dòng thiếu quy cách thùng/pallet/kg và SAP không có tham chiếu)` }); continue }
    const big = bigForOd(od)
    if (!big && od.allowed_models) {
      unplanned.push({ od_number: od.od_number, ship_to_code: od.ship_to_code, code: 'NO_VEHICLE', reason: od.allowed_models.length
        ? `Khách chỉ được vào ${od.allowed_models.length} dòng xe đã khai — không dòng nào đang dùng ở kho này + khai sức chứa (Khách hàng → Dòng xe được vào · Cài đặt TMS → Mã dòng xe → chọn kho)`
        : 'Khách chưa có dòng xe nào được vào — khai ở Khách hàng → Dòng xe được vào (theo kênh, hoặc riêng khách)' })
      continue
    }
    if (!big) { unplanned.push({ od_number: od.od_number, ship_to_code: od.ship_to_code, reason: 'Chưa có dòng xe nào khai sức chứa' }); continue }
    // Luật 11: OD lớn hơn xe lớn nhất được vào mà N xe (lặp lại xe đó) chở vừa ⇒ giữ NGUYÊN OD, đi thẻ nhiều xe — tách OD ra
    // hai Số xe là ca Xác nhận chặn (OD_SPLIT_ACROSS_TRIPS) và app không tách DO được
    if (maxVeh > 1 && !fits(big, s.pallets, s.tons) && fitsOnN(big, maxVeh, s.pallets, s.tons)) { units.push({ ...unitOf(od, od.lines, null), multi: true }); continue }
    units.push(...splitOversize(od, big))
  }

  // ── Luật 1–3 (+9): xếp lớn-trước theo cụm phường — không cho trộn loại thì cụm còn tách theo Loại kho chính ──
  // '*' = OD CHỈ có hàng đi kèm (POSM) ⇒ ké chuyến chính, không xe riêng. OD mà mã hàng CHƯA KHAI Loại kho (01/10: 5 mã SAP
  // chưa có trong Mã hàng — 17 OD Ba Vì kẹt khung chờ với lý do "chỉ POSM") KHÔNG phải POSM: cụm riêng '?' như hàng thường, kèm
  // băng "Khai thiếu" đã có.
  const catPart = (u: Unit) => {
    if (mixCats) return ''
    const main = mainCatsOf(u.od.lines, follow)
    if (main.length) return main.join('+')
    return u.od.lines.some(l => !l.category) ? '?' : '*'
  }
  const byCluster = new Map<string, Unit[]>()
  for (const u of units) { const k = clusterKey(u.od, P.allow_mix_channels, catPart(u)); const l = byCluster.get(k) ?? []; l.push(u); byCluster.set(k, l) }
  const bins: Bin[] = []
  const unitSort = (a: Unit, b: Unit) => (b.pallets ?? 0) - (a.pallets ?? 0) || (b.tons ?? 0) - (a.tons ?? 0) || cmp(a.od.od_number, b.od.od_number) || (a.part?.index ?? 0) - (b.part?.index ?? 0)
  const followOnly: Unit[] = []   // OD chỉ có hàng đi kèm (POSM riêng) — xếp SAU, ké vào chuyến cùng cụm
  const custOf = (u: Unit) => u.od.ship_to_code ?? u.od.od_number
  // THẺ NHIỀU XE của CÙNG KHÁCH nhận thêm OD nhỏ / hàng đi kèm khi tổ hợp N xe còn chở vừa (user 30/09: Ba Vì #68 Xe 16 pallet
  // chở 0,7 pallet POSM của Dũng Tiến đứng cạnh #70 Dũng Tiến 17,3 pallet đi 2 × 17 — xe thứ hai còn 16 pallet trống)
  // CHỈ lấp chỗ trống của các xe đang có — thêm OD mà thẻ phải thêm xe thì thôi (gói 61 [15g]: 14 pallet đi 9 + 5, thêm 5 pallet
  // nữa thành 3 xe là một thẻ khó điều, không hơn gì xe riêng)
  const vehiclesNeeded = (big: EngineModel, pallets: number, tons: number) => {
    for (let k = 1; k <= maxVeh; k++) if (k === 1 ? fits(big, pallets, tons) : !!splitLoad(Array(k).fill(big), pallets, tons)) return k
    return Infinity
  }
  const multiTakes = (b: Bin, u: Unit) => {
    if (maxVeh < 2 || !b.units.some(y => y.multi) || !b.units.some(y => custOf(y) === custOf(u))) return false
    const big = bigForOd(b.units[0].od)
    if (!big) return false
    const nb = withUnits(b, [u])
    const after = vehiclesNeeded(big, nb.pallets, nb.tons)
    return Number.isFinite(after) && after === vehiclesNeeded(big, b.pallets, b.tons)
  }
  // OD toàn mã CHƯA KHAI Loại kho ('?') là TRUNG TÍNH (01/10 chiều, user: "#1–#4 ghép sai" — An Sơn 0,057 pallet mẫu "không tăng tồn
  // NPP" đi Xe 16 pallet riêng cạnh #3 An Sơn 13,3 pallet cùng phường): không tách cụm riêng theo loại, xếp SAU như POSM — ké vào
  // chuyến cùng cụm (ưu tiên cùng khách); khác POSM ở chỗ không ai nhận thì vẫn ĐƯỢC xe riêng (hàng thường, không phải đi kèm).
  const neutral: Unit[] = []
  const mainKeys: string[] = []
  for (const key of [...byCluster.keys()].sort(cmp)) {
    if (!mixCats && catPartOf(key) === '*') followOnly.push(...byCluster.get(key)!)
    else if (!mixCats && catPartOf(key) === '?') neutral.push(...byCluster.get(key)!)
    else mainKeys.push(key)
  }
  // POSM của khách đi THEO đơn chính của khách NGAY LÚC XẾP (01/10 chiều): dải tải cho xếp tới 105 % nên xe đầy sát trần ngay ở
  // vòng xếp chính, POSM xếp sau không còn chỗ mà lại không được xe riêng ⇒ rơi lại khung chờ (Mỹ Phát Hưng Yên: 12,4 + 5,2 lên một
  // xe 17 pallet 103,5 %, ba OD POSM 0,6 pallet kẹt). Nay đơn chính LỚN NHẤT của khách mang theo cả POSM khi hỏi "vừa bin": vừa cả
  // cụm ⇒ vào cùng, không vừa ⇒ chỉ đơn chính vào, POSM chờ ké sau như thường.
  const tailOf = (u: Unit) => followOnly.filter(f => custOf(f) === custOf(u))
  const dropTail = (t: Unit[]) => { for (const f of t) followOnly.splice(followOnly.indexOf(f), 1) }
  for (const key of mainKeys) {
    const us = byCluster.get(key)!.sort(unitSort)
    const cands = candsFor(us.map(u => u.od))
    const local: Bin[] = []
    for (const u of us) {
      const mkey = mergeKey(u.od, P.allow_mix_channels, catPart(u))
      if (u.oversize || u.multi) { local.push({ key, mkey, units: [u], pallets: u.pallets ?? 0, tons: u.tons ?? 0 }); continue }
      // họ xe hỏi theo CHÍNH bin sau khi thêm (luật 10: mỗi khách một danh sách dòng xe — hỏi cả cụm là khách khó tính nhất
      // áp lên mọi khách cùng phường); danh sách giao nhau rỗng ⇒ không vào chung bin
      const fitsBin = (x: Bin, add: Unit[]) => { const nb = withUnits(x, add); return !solo(x) && binFits(hasAllowList(nb.units.map(y => y.od)) ? candsFor(nb.units.map(y => y.od)) : cands, nb) }
      const tail = tailOf(u)
      let add = tail.length ? [u, ...tail] : [u]
      let b = tail.length ? local.find(x => fitsBin(x, add)) : undefined
      if (!b) { add = [u]; b = local.find(x => fitsBin(x, [u]) || multiTakes(x, u)) }
      if (b) { const nb = withUnits(b, add); b.units = nb.units; b.pallets = nb.pallets; b.tons = nb.tons }
      else {
        const fresh: Bin = { key, mkey, units: [u], pallets: u.pallets ?? 0, tons: u.tons ?? 0 }
        add = tail.length && binFits(candsFor([u.od, ...tail.map(y => y.od)]), withUnits(fresh, tail)) ? [u, ...tail] : [u]
        local.push(add.length > 1 ? withUnits(fresh, tail) : fresh)
      }
      if (add.length > 1) dropTail(tail)
    }
    bins.push(...local)
  }
  // Mã chưa khai Loại kho: ké chuyến cùng cụm (cùng khách trước), không ai nhận ⇒ xe riêng cụm '?' (như hàng thường).
  // Xếp TRƯỚC POSM: POSM của khách đó còn ké được vào xe này (đo bàn 29/09: để sau là 7 OD POSM rơi lại khung chờ).
  for (const u of neutral.sort(unitSort)) {
    const key = clusterKey(u.od, P.allow_mix_channels, '?')
    const mkey = mergeKey(u.od, P.allow_mix_channels, '?')
    if (u.oversize || u.multi) { bins.push({ key, mkey, units: [u], pallets: u.pallets ?? 0, tons: u.tons ?? 0 }); continue }
    const fitsWith = (b: Bin, us: Unit[]) => !solo(b) && baseKey(b.key) === baseKey(key)
      && binFits(candsFor([...b.units.map(y => y.od), ...us.map(y => y.od)]), withUnits(b, us))
    const same = (b: Bin) => b.units.some(y => custOf(y) === custOf(u))
    // POSM của CHÍNH khách này chưa xếp: ké xe khách KHÁC thì phải kéo theo cả POSM (không thì POSM mất chỗ ké, rơi lại khung chờ —
    // đo bàn 29/09: 22 → 25 OD "chờ đơn chính" khi chưa có vế này); không vừa cả cụm ⇒ xe riêng, POSM ké sau như thường
    const tail = followOnly.filter(f => custOf(f) === custOf(u))
    const own = bins.find(b => same(b) && (fitsWith(b, [u]) || multiTakes(b, u)))
    const other = own ? null : bins.find(b => catPartOf(b.key) !== '*' && fitsWith(b, [u, ...tail]))
    const hit = own ?? other
    if (hit) {
      const add = own ? [u] : [u, ...tail]
      if (!own) for (const f of tail) followOnly.splice(followOnly.indexOf(f), 1)
      const nb = withUnits(hit, add); hit.units = nb.units; hit.pallets = nb.pallets; hit.tons = nb.tons
    } else bins.push({ key, mkey, units: [u], pallets: u.pallets ?? 0, tons: u.tons ?? 0 })
  }
  // Hàng đi kèm (POSM) "đi theo đơn": vào chuyến CÙNG CỤM (cùng nhóm khách · vùng · kênh · phường) còn chỗ — ưu tiên chuyến chở
  // chính khách đó (kể cả thẻ nhiều xe). Không chuyến nào nhận ⇒ Ở LẠI KHUNG CHỜ, KHÔNG đi xe riêng (user 30/09: "POSM thì đi
  // chung hàng, setting của nó là vậy — không được tự ghép POSM đi một xe riêng"; bản cũ đẻ Xe 4 pallet chở 0,3 pallet POSM).
  for (const u of followOnly.sort(unitSort)) {
    const key = clusterKey(u.od, P.allow_mix_channels, '*')
    const fitsIn = (b: Bin) => !solo(b) && baseKey(b.key) === baseKey(key)
      && binFits(candsFor([...b.units.map(y => y.od), u.od]), withUnits(b, [u]))
    const same = (b: Bin) => b.units.some(y => custOf(y) === custOf(u))
    const hit = bins.find(b => same(b) && (fitsIn(b) || multiTakes(b, u))) ?? bins.find(b => catPartOf(b.key) !== '*' && fitsIn(b)) ?? bins.find(b => fitsIn(b))
    if (hit) { const nb = withUnits(hit, [u]); hit.units = nb.units; hit.pallets = nb.pallets; hit.tons = nb.tons }
    else unplanned.push({ od_number: u.od.od_number, ship_to_code: u.od.ship_to_code, code: 'FOLLOW_ONLY', reason: 'Chỉ có hàng đi kèm đơn (POSM) — không đi xe riêng, chờ đơn hàng chính cùng cụm' })
  }

  // ── Luật 5 + 2: gộp chuyến Non tải cùng VÙNG — chỉ khi vừa xe, đủ điểm giao và KHÔNG ĐẮT HƠN đi riêng ──
  const snapshot: Record<string, ShareActual> = {}
  for (const [k, v] of Object.entries(input.share_actual)) snapshot[k] = { ...v }
  const costOf = (b: Bin) => assignVehicle(ctx, b, snapshot, underPct)
  const isUnder = (b: Bin) => { const a = costOf(b); if (!a.model) return true; const u = loadUtilization({ capacity_mode: a.model.capacity_mode, max_pallets: a.model.max_pallets, max_tons: a.model.max_tons, underload_pct: underPct(a.model) }, a.pallets, a.tons); return u.pct != null && u.pct < underPct(a.model) }
  // 02/10 — ĐƯỜNG VÒNG (điều vận trên bản đồ): kho bật `detour_pct` ⇒ hai xe KHÁC TỈNH cũng gộp được khi quãng kho → các điểm giao
  // (gần trước) không dài hơn đường thẳng tới điểm xa nhất quá N %. Km lấy từ `input.geo.km` (số đo Goong / ước lượng controller
  // điền), thiếu thì ước lượng chim bay × 1,3 từ toạ độ; thiếu toạ độ của kho hay một điểm ⇒ KHÔNG gộp (không đoán). Mọi luật khác
  // (lớp, kênh, Loại kho, dòng xe chung, điểm giao, không đắt hơn đi riêng) giữ nguyên — chỉ phần TỈNH của khoá được nới.
  const geo = input.geo
  const detourPct = P.detour_pct != null && Number.isFinite(Number(P.detour_pct)) && Number(P.detour_pct) > 0 && geo?.wh ? Number(P.detour_pct) : null
  const geoDist = (a: string, b: string): number | undefined => {
    if (!geo) return undefined
    const hit = kmLookup(geo.km, a, b)
    if (hit != null) return hit
    const pa = a === 'WH' ? geo.wh : geo.points[a], pb = b === 'WH' ? geo.wh : geo.points[b]
    return pa && pb ? estimateRoadKm(pa, pb) : undefined
  }
  const stopsOf = (b: Bin) => uniq(b.units.map(u => u.od.ship_to_code).filter((x): x is string => !!x))
  const regionless = (k: string) => k.split('|').filter((_, i) => i !== 1).join('|')
  const detourMergeOk = (merged: Bin) => detourPct != null && detourOk(routeKm(stopsOf(merged), geoDist), detourPct)
  let changed = true
  while (changed) {
    changed = false
    const srcs = bins.filter(b => !solo(b) && isUnder(b)).sort((a, b) => (a.pallets - b.pallets) || (a.tons - b.tons) || cmp(a.key, b.key))
    for (const src of srcs) {
      const cSrc = costOf(src).freight.total
      // chuyến chỉ có hàng đi kèm (POSM) gộp được vào chuyến của Loại kho chính cùng vùng (luật 9)
      // chuyến chỉ POSM ('*') hay chỉ mã chưa khai loại ('?') gộp được vào chuyến bất kỳ loại nào cùng vùng; chuyến '?' cũng nhận
      const sameGroup = (t: Bin) => t.mkey === src.mkey || (!mixCats && baseKey(t.mkey) === baseKey(src.mkey) && (['*', '?'].includes(catPartOf(src.mkey)) || catPartOf(t.mkey) === '?'))
      // khác tỉnh nhưng cùng lớp · kênh · Loại kho ⇒ ứng viên đường vòng (kiểm km sau khi ghép thử)
      const crossRegion = (t: Bin) => detourPct != null && t.mkey !== src.mkey && regionless(t.mkey) === regionless(src.mkey)
      const targets = bins.filter(t => t !== src && (sameGroup(t) || crossRegion(t)) && !solo(t))
        .map(t => ({ t, merged: withUnits(t, src.units), cross: !sameGroup(t) }))
        .filter(x => binFits(candsFor(x.merged.units.map(u => u.od)), x.merged))
        .filter(x => !x.cross || detourMergeOk(x.merged))
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
    const a = assignVehicle(ctx, b, actual, underPct, true)
    if (a.carrier) { const cur = actual[a.carrier.id] ?? { trips: 0, pallets: 0, tons: 0 }; cur.trips += 1; cur.pallets += a.pallets ?? 0; cur.tons += a.tons ?? 0; actual[a.carrier.id] = cur }
    const lm = a.loadModel
    const load = tripLoad(lm, a.pallets, a.tons, P.underload_pct)
    trips.push({
      seq, group_code: `${P.code_prefix}${seq}`, cluster: b.key,
      vehicle_model: a.model, vehicles: a.vehicles, carrier: a.carrier,
      ods: b.units.map(u => ({ od_number: u.od.od_number, ship_to_code: u.od.ship_to_code, ship_to_name: u.od.ship_to_name, ward_code: u.od.ward_code, pallets: u.pallets, tons: u.tons, lines: u.lines.length, part: u.part, material_codes: u.lines.map(l => l.material_code), conditions: condsOf(u.lines), cat_load: catLoadOf(u.lines), transfer: isTransferOd(u.od), allowed_models: u.od.allowed_models ?? null, separate: u.od.separate === true, max_customers: u.od.max_customers ?? null })),
      wards: a.wards, stops: a.stops, pallets: a.pallets, tons: a.tons, categories: a.cats, conditions: a.conds, booking_category: pickBookingCategory(b.units.flatMap(u => u.lines)),
      load, underload: load.pct != null && load.pct < load.underload_pct, oversize: a.oversize, freight: a.freight, carrier_reasons: a.reasons,
      warnings: [...a.warnings, ...(a.oversize ? ['Một dòng hàng lớn hơn xe lớn nhất — chuyến vượt tải, cần tách tay hoặc thêm dòng xe lớn hơn'] : []),
        ...(() => { const mx = mixCats ? [] : uniq(b.units.filter(u => mainCatsOf(u.od.lines, follow).length > 1).map(u => u.od.od_number)); return mx.length
          ? [`${mx.length} OD chứa nhiều Loại kho (${mainCatsOf(b.units.filter(u => mx.includes(u.od.od_number)).flatMap(u => u.lines), follow).join(' + ')}) — không tách được OD nên đi chung một chuyến dù kho không cho ghép loại · OD:${mx.slice(0, 3).join(', ')}${mx.length > 3 ? '…' : ''}`]
          : [] })()],
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
  return bookingFromCatLoads([catLoadOf(lines)])
}
/** Tải theo Loại kho của một tập dòng hàng — cùng thước với cửa đặt lịch (pallet + kg/1e6 để hoà mà vẫn phân được). */
export function catLoadOf(lines: EngineLine[]): Record<string, number> {
  const by: Record<string, number> = {}
  for (const l of lines) if (l.category) by[l.category] = (by[l.category] ?? 0) + (l.pallets ?? 0) + (l.kg ?? 0) / 1e6
  return by
}
/** Cửa đặt lịch của một xe khi chỉ còn tải theo loại của TỪNG OD (bàn ghép xe chuyển OD qua lại, không nạp lại dòng hàng). */
export function bookingFromCatLoads(loads: (Record<string, number> | null | undefined)[]): string | null {
  const by = new Map<string, number>()
  for (const m of loads) for (const [k, v] of Object.entries(m ?? {})) by.set(k, (by.get(k) ?? 0) + (Number(v) || 0))
  const e = [...by.entries()].sort((a, b) => (b[1] - a[1]) || cmp(a[0], b[0]))
  return e[0]?.[0] ?? null
}
/** Chọn (dòng xe, ĐVVT) cho một NHÓM OD đã có tải tổng — dùng khi người kéo OD ra "xe mới": máy chọn xe theo đúng ba bậc
 *  của lượt ghép thay vì để xe mới trống dòng xe/ĐVVT. Mỗi OD dựng thành dòng giả mang tải tổng + điều kiện của nó. */
export function suggestVehicle(input: EngineInput, ods: { od: EngineOd; pallets: number | null; tons: number | null; conditions: string[] }[], actual: Record<string, ShareActual>) {
  const ctx = buildCtx(input)
  const underPct = (m: EngineModel | null) => underPctOf(m, input.params.underload_pct)
  const units: Unit[] = ods.map(x => {
    const lines: EngineLine[] = [{ material_code: '', qty_base: 0, pallets: x.pallets, kg: x.tons == null ? null : x.tons * 1000, category: null, condition: null },
      ...x.conditions.map(c => ({ material_code: '', qty_base: 0, pallets: 0, kg: 0, category: null, condition: c }))]
    return { od: x.od, lines, pallets: x.pallets, tons: x.tons, part: null, oversize: false }
  })
  const b: Bin = { key: '', mkey: '', units, pallets: r3(units.reduce((s, u) => s + (u.pallets ?? 0), 0)), tons: r3(units.reduce((s, u) => s + (u.tons ?? 0), 0)) }
  // luật 11: nhóm OD lớn hơn mọi xe mà N xe chở vừa ⇒ máy đề xuất thẻ nhiều xe (cùng đường so tổ hợp của lượt ghép)
  const a = assignVehicle(ctx, b, actual, underPct, true)
  return { model: a.model, vehicles: a.vehicles, carrier: a.carrier, freight: a.freight, reasons: a.reasons, warnings: a.warnings }
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
