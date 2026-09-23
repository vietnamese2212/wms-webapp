/**
 * TÍNH CƯỚC MỘT CHUYẾN — thuần TS, không DB (plan TMS_DISPATCH mục 6.3; user chốt 23/09/2026).
 *
 * Luật:
 *  - Cước tuyến = bảng cước của (kho xuất × ĐVVT × dòng xe CON × phường điểm đến XA NHẤT) hiệu lực tại ngày giao.
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
 * Phường tính cước = điểm đến XA NHẤT theo `distance_km` của bảng cước; phường không có km (null) xếp sau
 * phường có km; hoà ⇒ theo mã phường để cùng input ra cùng output.
 */
export function farthestWard(wards: string[], kmByWard: Map<string, number | null>): string | null {
  const uniq = [...new Set(wards.filter(Boolean))]
  if (!uniq.length) return null
  return uniq.sort((a, b) => {
    const ka = kmByWard.get(a), kb = kmByWard.get(b)
    if (ka != null && kb != null && ka !== kb) return kb - ka
    if (ka != null && kb == null) return -1
    if (ka == null && kb != null) return 1
    return a < b ? -1 : a > b ? 1 : 0
  })[0]
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
