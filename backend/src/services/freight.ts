/**
 * TÍNH CƯỚC MỘT CHUYẾN — thuần TS, không DB (plan TMS_DISPATCH mục 6.3; user chốt 23/09/2026).
 *
 * Luật:
 *  - Cước tuyến = bảng cước của (kho xuất × ĐVVT × dòng xe CON × phường điểm đến GIÁ CAO NHẤT) hiệu lực tại ngày giao
 *    (08/10 — trước đó là phường XA NHẤT theo km; xem `routeTariff`).
 *  - Xe pallet (`tariff_unit = PER_PALLET`): đơn giá × số pallet LÀM TRÒN LÊN — không có pallet tối thiểu.
 *  - Xe trọn chuyến (`PER_TRIP`): giá chuyến.
 *  - Rớt điểm tính theo THỰC TẾ chuyến: số ship-to phân biệt < `min_stops` (2) ⇒ 0;
 *      ALL_STOPS   ⇒ amount × stops              (mỗi điểm một khoản — mặc định theo lời user)
 *      EXTRA_STOPS ⇒ amount × (stops − min_stops + 1)   (chỉ điểm thứ min_stops trở đi)
 *  - Phụ phí khác theo `per`: PER_TRIP một lần · PER_PALLET × pallet đã làm tròn · PER_TON × tấn.
 *  - Thiếu bảng cước ⇒ total null + lý do; KHÔNG đoán.
 * Tiền là VND nguyên — làm tròn về đồng ở từng khoản, tổng = Σ khoản (không cộng số lẻ rồi làm tròn một lần).
 */

export type TariffUnit = 'PER_PALLET' | 'PER_TRIP'
export type SurchargePer = 'PER_STOP' | 'PER_TRIP' | 'PER_PALLET' | 'PER_TON'
export type StopCountMode = 'ALL_STOPS' | 'EXTRA_STOPS'

export interface TariffLike {
  id: string
  price: number
  ward_code: string
  distance_km: number | null
  effective_from: string       // 'YYYY-MM-DD'
  effective_to: string | null
  is_active?: boolean
}
export interface SurchargeLike {
  id: string
  kind: string
  amount: number
  per: SurchargePer
  count_mode: StopCountMode
  min_stops: number
  effective_from: string
  effective_to: string | null
  is_active?: boolean
}
export interface FreightInput {
  unit: TariffUnit
  tariff: TariffLike | null
  surcharges: SurchargeLike[]
  pallets: number            // Σ pallet của chuyến (có thể lẻ — sẽ ceil)
  tons: number               // Σ tấn
  stops: number              // số ship-to phân biệt
}
export interface FreightLine { kind: string; per: SurchargePer; unit_amount: number; qty: number; total: number }
export interface FreightResult {
  total: number | null
  base: number | null
  billed_pallets: number | null
  unit: TariffUnit
  tariff_id: string | null
  surcharges: FreightLine[]
  reason: string | null        // vì sao null (thiếu cước / dữ liệu thiếu)
}

const round0 = (x: number) => Math.round(x)

// ── TẢI / NON TẢI (đợt 1 mục 15): so tải thật của chuyến với sức chứa dòng xe CON ──
export interface CapacityLike {
  capacity_mode: string | null      // 'PALLET' | 'TON'
  max_pallets: number | null
  max_tons: number | string | null
  underload_pct: number | null      // ngưỡng Non tải (%), mặc định 70
}
export interface LoadUtil {
  basis: 'PALLET' | 'TON' | null    // đo theo pallet hay tấn — theo capacity_mode của dòng xe, thiếu sức chứa → null
  used: number | null               // pallet (thập phân) hoặc tấn
  cap: number | null
  pct: number | null                // % tải, làm tròn 1 chữ số
  underload: boolean | null         // pct < underload_pct; null khi không đo được
  underload_pct: number
  max_pct?: number                  // 01/10 — trần xếp theo dải tải (105 = cho vượt 5 %); thiếu = 100. Chỉ `tripLoad` điền.
}
const DEFAULT_UNDERLOAD_PCT = 70
/** % tải = tải thật ÷ sức chứa dòng xe. Không đo được (thiếu sức chứa hay thiếu tải) ⇒ null, KHÔNG đoán. */
export function loadUtilization(model: CapacityLike | null | undefined, pallets: number | null, tons: number | null): LoadUtil {
  const up = Number(model?.underload_pct)
  const underload_pct = Number.isFinite(up) && up > 0 ? up : DEFAULT_UNDERLOAD_PCT
  const empty: LoadUtil = { basis: null, used: null, cap: null, pct: null, underload: null, underload_pct }
  if (!model) return empty
  const maxP = Number(model.max_pallets), maxT = Number(model.max_tons)
  const byTon = model.capacity_mode === 'TON' || !(Number.isFinite(maxP) && maxP > 0)
  const cap = byTon ? maxT : maxP
  const used = byTon ? tons : pallets
  if (!Number.isFinite(cap) || cap <= 0 || used == null || !Number.isFinite(used)) return { ...empty, basis: byTon ? 'TON' : 'PALLET', used: used ?? null, cap: Number.isFinite(cap) && cap > 0 ? cap : null }
  const pct = Math.round((used / cap) * 1000) / 10
  return { basis: byTon ? 'TON' : 'PALLET', used, cap, pct, underload: pct < underload_pct, underload_pct }
}

/** Hàng có hiệu lực tại ngày `day` (YYYY-MM-DD so chuỗi được vì cùng dạng ISO). */
export function effectiveAt<T extends { effective_from: string; effective_to: string | null; is_active?: boolean }>(rows: T[], day: string): T[] {
  return rows.filter(r => (r.is_active ?? true) && r.effective_from <= day && (r.effective_to == null || r.effective_to >= day))
}

/** Trong các dòng cước cùng khoá còn hiệu lực, lấy dòng mới nhất (effective_from lớn nhất). */
export function pickTariff<T extends TariffLike>(rows: T[], day: string): T | null {
  const eff = effectiveAt(rows, day)
  if (!eff.length) return null
  return eff.reduce((a, b) => (b.effective_from > a.effective_from ? b : a))
}

/**
 * Dòng cước của MỘT xe đi nhiều phường = phường GIÁ CAO NHẤT (user chốt 08/10, xe tuyến liên tỉnh: "cước của tuyến cao nhất").
 * Mỗi phường lấy dòng hiệu lực mới nhất (`pickTariff`); hoà giá ⇒ phường xa hơn (`distance_km`) ⇒ theo mã phường (cùng input ra cùng
 * output). Trước 08/10 lấy phường XA NHẤT theo km — tuyến núi ngắn mà đắt bị tính theo giá thấp hơn. Máy ghép (Điều vận) và ước tính
 * cước chuyến Xuất kho cùng đi qua hàm này. `missing` = phường của xe KHÔNG có dòng cước hiệu lực nào: số đang tính có thể THẤP hơn
 * thật (điểm thiếu cước có thể là điểm đắt nhất) — nơi gọi phải nói ra, không im lặng.
 */
export function routeTariff<T extends TariffLike>(rows: T[], wards: string[], day: string): { tariff: T | null; missing: string[] } {
  const ws = [...new Set(wards.filter(Boolean))].sort()
  const byWard = new Map<string, T>()
  for (const w of ws) { const t = pickTariff(rows.filter(r => r.ward_code === w), day); if (t) byWard.set(w, t) }
  const best = [...byWard.values()].sort((a, b) =>
    (Number(b.price) - Number(a.price)) || (Number(b.distance_km ?? -1) - Number(a.distance_km ?? -1)) || (a.ward_code < b.ward_code ? -1 : a.ward_code > b.ward_code ? 1 : 0))[0] ?? null
  return { tariff: best, missing: ws.filter(w => !byWard.has(w)) }
}

/** Số lần tính phí rớt điểm theo thực tế chuyến. */
export function stopFeeQty(stops: number, mode: StopCountMode, minStops: number): number {
  const s = Math.max(0, Math.floor(stops))
  const m = Math.max(1, Math.floor(minStops))
  if (s < m) return 0
  return mode === 'ALL_STOPS' ? s : s - m + 1
}

export function billedPallets(pallets: number): number {
  if (!Number.isFinite(pallets) || pallets <= 0) return 0
  // ceil có đệm sai số nhị phân: 15.999999999 là 16 pallet, không phải 17
  return Math.ceil(pallets - 1e-9)
}

export function computeFreight(input: FreightInput): FreightResult {
  const unit = input.unit
  const billed = billedPallets(input.pallets)
  const empty = (reason: string): FreightResult =>
    ({ total: null, base: null, billed_pallets: unit === 'PER_PALLET' ? billed : null, unit, tariff_id: null, surcharges: [], reason })
  if (!input.tariff) return empty('Chưa có bảng cước cho (kho xuất, ĐVVT, dòng xe, phường) này')
  if (!Number.isFinite(input.tariff.price) || input.tariff.price < 0) return empty('Đơn giá cước không hợp lệ')
  if (unit === 'PER_PALLET' && billed === 0) return empty('Chuyến không có pallet để tính cước theo pallet')

  const base = unit === 'PER_PALLET' ? round0(input.tariff.price * billed) : round0(input.tariff.price)
  const lines: FreightLine[] = []
  for (const s of input.surcharges) {
    if (!Number.isFinite(s.amount) || s.amount <= 0) continue
    let qty = 0
    switch (s.per) {
      case 'PER_STOP':   qty = stopFeeQty(input.stops, s.count_mode, s.min_stops); break
      case 'PER_TRIP':   qty = 1; break
      case 'PER_PALLET': qty = billed; break
      case 'PER_TON':    qty = Number.isFinite(input.tons) && input.tons > 0 ? input.tons : 0; break
    }
    if (qty <= 0) continue
    lines.push({ kind: s.kind, per: s.per, unit_amount: s.amount, qty, total: round0(s.amount * qty) })
  }
  const total = base + lines.reduce((a, l) => a + l.total, 0)
  return { total, base, billed_pallets: unit === 'PER_PALLET' ? billed : null, unit, tariff_id: input.tariff.id, surcharges: lines, reason: null }
}
