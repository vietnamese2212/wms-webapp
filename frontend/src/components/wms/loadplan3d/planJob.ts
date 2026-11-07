// Phần TÍNH của màn Xếp xe 3D: hàm thuần, không đụng React — chạy trong Web Worker (`plan.worker.ts`), kết quả chỉ phụ thuộc đầu vào.
// Dự toán KHÔNG nhận số đã quét (`withoutScan`): tin quét chỉ đổi phần mờ / số đếm (`withProgress`, chạy trên màn hình), không tính lại sơ đồ.
// Tiến độ xếp lại theo trình tự quét thật nên có nhận, quét thêm thì phải tính lại.
import {
  computeLoadPlan, palletizeGroups, spreadOnTopOfPallets, cartonsPerPalletEstimate, packPallet, placePallets, spreadToDoor,
  type LoadGroup, type LoadPlan, type PalletSpec, type PalletizeInput, type PalletCarton, type TruckDims,
} from '../../../utils/loadPlan'
import type { LoadPlacement } from '../../../stores/loadPlanPrefsStore'

// done = thùng ĐÃ XUẤT thật (nhặt lẻ chưa xác nhận KHÔNG tính).
// cpp/isPallet đi kèm để chế độ XE PALLET gom được hàng lên pallet mà không phải duyệt lại gdo.
// category = Loại hàng của mã — quyết định CÁCH LÊN XE (gộp chung / pallet riêng / lên nóc);
// topCarton = khối này là THÙNG rời nằm nóc ở chế độ xe pallet (không đếm vào số pallet).
export type PlanGroup = LoadGroup & {
  done: number; cpp: number | null; isPallet: boolean
  category: string | null; topCarton?: boolean
  // Số lượng NGHIỆP VỤ + đơn vị tính của MÃ (user chốt 26/08: danh sách hiện "290 thùng" /
  // "200 cái" theo danh mục ĐVT, không hiện "2 pallet"). Không có (pallet gộp/Loscam) → đếm pallet.
  qty?: number; qtyDone?: number; qtyUnit?: string
  // mã KHÔNG có đơn vị "thùng" (base cái/kg) — pallet hoá phải tính theo tỷ lệ pallet, xem
  // `PalletizeInput.unitless` trong loadPlan.ts
  unitless?: boolean
  // Mốc quét ĐẦU TIÊN của mã (scanned_at) — tab Tiến độ xếp lại sơ đồ theo TRÌNH TỰ QUÉT THẬT
  // (user chốt 26/08: "dự toán là dự kiến, tiến độ là lên thực tế — có thể khác nhau")
  firstScanAt?: string | null
  // Số lớp khi xếp XÁ (Material.loose_stack_layers) — xe thường chồng theo số này, trống = như maxLayers
  looseLayers?: number | null
  // Khối PALLET: từng thùng đã xếp trên mặt pallet (`packPallet`) + chỗ tấm gỗ trong khối — vẽ từng thùng
  cartons?: PalletCarton[]
  deck?: { x: number; y: number; l: number; w: number }
}

/** Cách lên xe của từng Loại hàng trong chuyến (chỉ loại có trong chuyến — chọn cho kho khác không làm tính lại). */
export type Placements = Record<string, LoadPlacement>

export interface PlanInput {
  groups: PlanGroup[]         // nguyên liệu: (đơn × mã) của chuyến
  pallet: boolean             // xe pallet
  spec: PalletSpec | null     // xe pallet: quy cách pallet
  place: Placements
  lightOwnLoose: boolean      // xe xá: hàng gửi đứng khối riêng dưới sàn
  truck: TruckDims | null     // null = chưa khai lòng thùng / pallet không vừa xe ⇒ không có sơ đồ
  payloadKg: number | null    // tải trọng dòng xe
}
export interface PlanOut {
  pallet: boolean
  groups: PlanGroup[]         // nhóm đã đưa vào thuật toán; `plan.placed[].group` trỏ theo mảng này
  plan: LoadPlan | null
  palletized: { palletCount: number; warnings: string[] } | null
}
export interface ProgressOut { plan: LoadPlan; groups: PlanGroup[] }

// Thùng/pallet: mã chưa khai mà có cỡ thùng THẬT ⇒ ƯỚC theo cỡ thùng (`palletizeGroups` coi thiếu quy cách là
// "1 mã = 1 pallet" bất kể số thùng). Cỡ giả định / mã tính theo cái / pallet Loscam ⇒ giữ cách cũ.
export const perPalletOf = (g: PlanGroup, spec: PalletSpec) =>
  g.cpp ?? (g.isPallet || g.assumed || g.unitless ? null : cartonsPerPalletEstimate(spec, g, g.maxLayers))

// Khối pallet có ruột ⇒ xếp từng thùng theo lớp phẳng phủ kín; khối cao đúng đỉnh thùng thật đã xếp
function withCartons<T extends LoadGroup>(blocks: T[], src: PlanGroup[], spec: PalletSpec): T[] {
  const light = new Set(src.filter(g => g.onTop).map(g => g.key))
  const cap = new Map(src.filter(g => g.maxLayers).map(g => [g.key, g.maxLayers!]))
  return blocks.map(g => {
    if (!g.contents) return g
    const { cartons, deck } = packPallet(spec, g.contents, light, cap)
    return cartons.length ? { ...g, cartons, deck, h: spec.baseH + Math.max(...cartons.map(c => c.z + c.h)) } : g
  })
}

const placeOf = (place: Placements, cat: string | null): LoadPlacement => (cat ? place[cat] ?? 'MIX' : 'MIX')
// "Lên nóc" chỉ có nghĩa khi CÓ hàng khác làm nền. Chuyến toàn hàng khai "Lên nóc" mà vẫn ép
// lên nóc thì không có mặt nào để đặt → sơ đồ TRỐNG TRƠN, ô "Xếp được" hiện 0/0 mà không một
// dòng cảnh báo (bắt được trên đơn THẬT 15/08: 4 chuyến toàn FG02). Không có nền thì hàng đó
// phải tự đứng pallet của nó — đúng thực tế xe chở toàn POSM.
export const hasBaseIn = (list: PlanGroup[], place: Placements) =>
  list.some(g => !g.isPallet && g.count > 0 && placeOf(place, g.category) !== 'ON_TOP')
const onTopActive = (g: PlanGroup, list: PlanGroup[], place: Placements) =>
  !g.isPallet && placeOf(place, g.category) === 'ON_TOP' && hasBaseIn(list, place)

// Xe thường: chồng theo "Chồng khi xếp xá" của mã (sữa 110ml: pallet 14 lớp, xá 28) — chưa khai thì như pallet
function looseOf(g: PlanGroup, lightOwnLoose: boolean): PlanGroup {
  const c = g.looseLayers ? { ...g, maxLayers: g.looseLayers } : g
  return lightOwnLoose ? { ...c, onTop: false } : c
}

// Gom hàng lên pallet. Loại "Lên nóc" KHÔNG palletize — đi thẳng làm thùng rời nằm nóc (`topOf`),
// trừ khi chuyến KHÔNG có hàng nền: lúc đó chính nó phải lên pallet (xem `hasBaseIn`).
function palletsOf(list: PlanGroup[], spec: PalletSpec, place: Placements) {
  const items: PalletizeInput[] = list
    .filter(g => !onTopActive(g, list, place))
    .map(g => ({
      key: g.key, label: g.label, doKey: g.doKey, doLabel: g.doLabel,
      cartons: g.count, cartonsPerPallet: perPalletOf(g, spec), isPalletCarrier: g.isPallet,
      weightKg: g.weightKg,
      // Cao pallet tính từ thùng × quy cách — mã chưa khai thì dùng CỠ GIẢ ĐỊNH kèm nhãn
      // (user chốt vòng 7: quy cách 140 vs 216 thùng/pallet phải ra chiều cao KHÁC NHAU,
      // đồng cao 1650 hết là sai; nhãn "cỡ giả định" vẫn giữ để biết số là ước lượng).
      carton: { l: g.l, w: g.w, h: g.h },
      assumed: g.assumed, unitless: g.unitless,
      // Số lớp thật ⇒ thùng/lớp = quy cách ÷ số lớp (user 28/10: "110 thùng – 11 lớp ⇒ 1 lớp 10 thùng");
      // hàng gửi (stack_on_top) nằm TRÊN CÙNG pallet gộp
      layers: g.maxLayers, onTop: g.onTop,
      // "Pallet riêng": phần dư của loại này gom bể riêng, không trộn pallet lẻ chung
      remPool: !g.isPallet && g.category && placeOf(place, g.category) === 'OWN_PALLET'
        ? { key: g.category, label: g.category } : undefined,
    }))
  const res = palletizeGroups(items, spec)
  const srcByKey = new Map(list.map(g => [g.key, g]))
  const groups: PlanGroup[] = withCartons(res.groups, list, spec).map(g => {
    const src = srcByKey.get(palletSource(g.key))
    // Dòng pallet NGUYÊN của 1 mã: danh sách hiện SL + ĐVT của mã đó (pallet gộp không quy
    // được về 1 mã → để trống, hiện số pallet)
    return { ...g, done: 0, cpp: null, isPallet: false, category: null, qty: src?.qty, qtyDone: src?.qtyDone, qtyUnit: src?.qtyUnit }
  })
  return { res, groups }
}
const topOf = (list: PlanGroup[], place: Placements): PlanGroup[] =>
  list.filter(g => onTopActive(g, list, place)).map(g => ({ ...g, onTop: true, topCarton: true }))
// Khoá khối pallet nguyên của một mã ⇒ khoá của mã đó
const palletSource = (key: string) => key.replace(/\|(full|plt)$/, '')

/** DỰ TOÁN. Xe pallet: khối pallet + thùng rời "Lên nóc" (thuật toán tự đặt lên nóc các khối, không chiếm chỗ pallet trên sàn). */
export function planDraft(inp: PlanInput): PlanOut {
  const { groups: src, pallet, spec, place, lightOwnLoose, truck, payloadKg } = inp
  let groups: PlanGroup[]
  let palletized: PlanOut['palletized'] = null
  if (pallet) {
    const pal = spec ? palletsOf(src, spec, place) : null
    if (pal) palletized = { palletCount: pal.res.palletCount, warnings: pal.res.warnings }
    groups = [...(pal?.groups ?? []), ...topOf(src, place)]
  } else {
    groups = src.filter(g => !g.isPallet).map(g => looseOf(g, lightOwnLoose))
  }
  if (!truck || !groups.length) return { pallet, groups, plan: null, palletized }
  // Thùng "Lên nóc" (topCarton) KHÔNG đi qua thuật toán thùng-sàn (nó dựng tháp lẻ loi khi
  // trộn với pallet): xếp pallet trước (count 0 giữ nguyên CHỈ SỐ nhóm cho nhãn/màu), rồi
  // rải thùng lên MẶT các pallet bằng spreadOnTopOfPallets.
  // Xe pallet: khoảng cách giữa các pallet (luật 14 lõi — `placePallets`). Xe thường: trải sàn theo % TẢI của dòng xe (luật
  // 11 lõi — gần đủ tải thì tới sát cửa); chưa biết tải (chuyến chưa gắn dòng xe / mã thiếu kg) ⇒ hàng đã phủ ≥ 75% sàn thì tới cửa.
  const topIdx = groups.map((g, i) => (g.topCarton ? i : -1)).filter(i => i >= 0)
  let plan: LoadPlan
  if (topIdx.length) {
    plan = spreadOnTopOfPallets(placePallets(truck, groups.map(g => (g.topCarton ? { ...g, count: 0 } : g))), topIdx, groups)
  } else if (pallet) {
    plan = placePallets(truck, groups)
  } else {
    // Tải hàng chỉ tính khi MỌI mã đã khai kg (thiếu ⇒ chưa biết tải)
    const cargoKg = groups.some(g => g.count > 0 && !(Number(g.weightKg) > 0)) ? null : groups.reduce((s, g) => s + g.count * (Number(g.weightKg) || 0), 0)
    plan = spreadToDoor(truck, groups, computeLoadPlan(truck, groups), payloadKg && cargoKg != null ? (cargoKg / payloadKg) * 100 : null)
  }
  return { pallet, groups, plan, palletized }
}

/** TIẾN ĐỘ = xếp lại theo TRÌNH TỰ QUÉT THẬT (user chốt 26/08): mã quét trước nằm sâu phía cabin; số lượng = phần ĐÃ quét.
 *  Khác hẳn Dự toán — không tô lại vị trí dự kiến. */
export function progressDraft(inp: PlanInput): ProgressOut | null {
  const { groups: src, pallet, spec, place, lightOwnLoose, truck } = inp
  if (!truck) return null
  const scanned: PlanGroup[] = src
    .filter(g => !g.isPallet && g.done > 0)
    .map(g => ({ ...g, count: g.done }))
    .sort((a, b) => ((a.firstScanAt ?? '9999') < (b.firstScanAt ?? '9999') ? -1 : 1))
  if (!scanned.length) return null
  let effGroups: PlanGroup[] = pallet ? scanned : scanned.map(g => looseOf(g, lightOwnLoose))
  if (pallet && spec) {
    const pal = palletsOf(scanned, spec, place).groups.map(g => ({ ...g, done: g.count }))
    effGroups = [...pal, ...topOf(scanned, place)]
  }
  // computeLoadPlan sắp lại nhóm theo (đơn → diện tích → cỡ) — sẽ ĐẢO mất trình tự quét.
  // Gắn doKey TUẦN TỰ theo thứ tự quét để trình xếp tôn trọng đúng thứ tự đó (doLabel giữ
  // nguyên cho nhãn; pooling pallet lẻ đã chạy TRƯỚC bằng doKey thật nên không ảnh hưởng).
  effGroups = effGroups.map((g, i) => ({ ...g, doKey: `${String(i).padStart(3, '0')}|${g.doKey}` }))
  const topIdx = effGroups.map((g, i) => (g.topCarton ? i : -1)).filter(i => i >= 0)
  const baseGroups = topIdx.length ? effGroups.map(g => (g.topCarton ? { ...g, count: 0 } : g)) : effGroups
  const base = pallet ? placePallets(truck, baseGroups) : computeLoadPlan(truck, baseGroups)
  return { plan: topIdx.length ? spreadOnTopOfPallets(base, topIdx, effGroups) : base, groups: effGroups }
}

export type JobKind = 'plan' | 'progress'
export interface JobOuts { plan: PlanOut; progress: ProgressOut | null }
export const runJob = <K extends JobKind>(kind: K, inp: PlanInput) =>
  (kind === 'plan' ? planDraft(inp) : progressDraft(inp)) as JobOuts[K]

/** Bỏ số đã quét khỏi đầu vào Dự toán: quét thêm không đổi đầu vào ⇒ không tính lại. */
export const withoutScan = ({ firstScanAt: _f, qtyDone: _q, ...g }: PlanGroup): PlanGroup => ({ ...g, done: 0 })

/** Gắn tiến độ quét mới nhất vào nhóm của Dự toán. Pallet theo TỶ LỆ đã xuất của chính mã đó (pallet gộp không quy được về 1 mã → 0). */
export function withProgress(out: PlanOut, src: PlanGroup[]): PlanGroup[] {
  const byKey = new Map(src.map(g => [g.key, g]))
  return out.groups.map(g => {
    if (out.pallet && !g.topCarton) {
      const s = byKey.get(palletSource(g.key))
      return { ...g, done: s && s.count > 0 ? Math.floor(g.count * (s.done / s.count)) : 0, qtyDone: s?.qtyDone }
    }
    const s = byKey.get(g.key)
    return s ? { ...g, done: s.done, qtyDone: s.qtyDone } : g
  })
}
