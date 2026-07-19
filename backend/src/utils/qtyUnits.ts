// qtyUnits — formatter số lượng TRUNG TÂM theo Base/Entry Unit (chiến dịch BASE UNIT, đợt 1).
// FE mirror: frontend/src/utils/qtyUnits.ts — 2 bản PHẢI KHỚP NHAU (mẫu như shelfLife.ts).
//
// ĐỢT 1 (hiện tại): `qty` truyền vào là SỐ THÙNG THẬP PHÂN (nghĩa cũ của cartons_*).
//   - Mã có entry_unit: split = floor(qty) thùng + round(phần_lẻ × units_per_carton) hộp.
//   - Mã không entry: hiển thị nguyên số + nhãn base_unit (KG/EA/BAG…).
// ĐỢT 2 (semantic flip): `qty` sẽ là BASE UNIT → CHỈ đổi ruột các hàm này (divmod theo hệ số),
//   chữ ký GIỮ NGUYÊN — mọi điểm hiển thị đã gom về đây không phải sửa lại.

export type MatUnits = {
  base_unit?: string | null
  entry_unit?: string | null
  units_per_carton?: number | null
}

/** Nhãn tiếng Việt cho mã ĐVT — code lạ hiển thị NGUYÊN VĂN (ĐVT tùy biến). */
const UNIT_LABELS: Record<string, string> = {
  CAR: 'thùng',
  HOP: 'hộp',
  KG: 'kg',
  BAG: 'bao',
  EA: 'cái',
  BT: 'chai',
}

export function unitLabel(code?: string | null): string {
  const c = (code ?? '').trim().toUpperCase()
  if (!c) return 'thùng' // thiếu khai báo → giữ hành vi cũ của app
  return UNIT_LABELS[c] ?? c
}

/** Mã có Entry Unit + hệ số hợp lệ → hiển thị dạng "N thùng + M hộp". */
export function hasEntry(m?: MatUnits | null): boolean {
  return !!(m?.entry_unit && Number(m?.units_per_carton) > 0)
}

/** Nhãn ĐVT hiển thị chính của mã (cho header cột / đơn vị kèm số). */
export function qtyUnitLabel(m?: MatUnits | null): string {
  if (!m) return 'thùng'
  if (hasEntry(m)) return unitLabel(m.entry_unit)
  return unitLabel(m.base_unit)
}

/**
 * Tách số lượng thành phần entry (thùng) + phần base lẻ (hộp).
 * Mã không entry: { entry: 0, base: qty }.
 * Số âm: cả 2 phần mang dấu âm.
 */
export function qtySplit(qty: number, m?: MatUnits | null): { entry: number; base: number } {
  const q = Number(qty)
  if (!isFinite(q)) return { entry: 0, base: 0 }
  if (!hasEntry(m)) return { entry: 0, base: q }
  const factor = Number(m!.units_per_carton)
  const sign = q < 0 ? -1 : 1
  const abs = Math.abs(q)
  // ĐỢT 1: abs = thùng thập phân → floor + round(phần lẻ × hệ số)
  let entry = Math.floor(abs)
  let base = Math.round((abs - entry) * factor)
  if (base >= factor) { entry += 1; base = 0 } // chống trôi float (0.99999 × 48 → 48)
  return { entry: sign * entry, base: sign * base }
}

function fmt(n: number): string {
  // vi-VN: nghìn = dấu chấm, thập phân = dấu phẩy (khớp chuẩn số VN toàn app)
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(n)
}

/**
 * Chuỗi hiển thị đầy đủ: "89 thùng + 24 hộp" | "89 thùng" | "24 hộp" | "7.004,875 kg".
 * `m` thiếu/null → "N thùng" (hành vi cũ).
 */
export function qtyLabel(qty: number, m?: MatUnits | null): string {
  const q = Number(qty)
  if (!isFinite(q)) return '—'
  if (!hasEntry(m)) return `${fmt(q)} ${qtyUnitLabel(m)}`
  const neg = q < 0
  const { entry, base } = qtySplit(Math.abs(q), m)
  const eLbl = unitLabel(m!.entry_unit)
  const bLbl = unitLabel(m!.base_unit)
  let s: string
  if (entry > 0 && base > 0) s = `${fmt(entry)} ${eLbl} + ${fmt(base)} ${bLbl}`
  else if (entry === 0 && base > 0) s = `${fmt(base)} ${bLbl}`
  else s = `${fmt(entry)} ${eLbl}`
  return neg ? `-${s}` : s
}

/**
 * Một CON SỐ theo entry unit cho cell hẹp / cột số (89.5).
 * ĐỢT 1: qty đã là thùng thập phân → trả nguyên. ĐỢT 2: qty base → chia hệ số.
 * Mã không entry: trả nguyên (số theo base).
 */
export function qtyEntryDecimal(qty: number, _m?: MatUnits | null): number {
  const q = Number(qty)
  if (!isFinite(q)) return 0
  return q
}

/** Format qtyEntryDecimal kèm chuẩn số VN, tối đa 3 số lẻ (tiện cho cell). */
export function qtyEntryText(qty: number, m?: MatUnits | null): string {
  return fmt(qtyEntryDecimal(qty, m))
}
