// qtyUnits — formatter số lượng TRUNG TÂM theo Base/Entry Unit (chiến dịch BASE UNIT).
// FE mirror: frontend/src/utils/qtyUnits.ts — 2 bản PHẢI KHỚP NHAU (mẫu như shelfLife.ts).
//
// ĐỢT 2 (SEMANTIC FLIP — hiện hành): `qty` truyền vào là SỐ THEO BASE UNIT
//   (mã có entry: HOP/BT… nguyên; mã không entry: KG decimal / EA…).
//   - Mã có entry_unit: split = divmod(qty, units_per_carton) → "N thùng + M hộp".
//   - Mã không entry: hiển thị nguyên số + nhãn base_unit (KG/EA/BAG…).
// LUẬT SỐ NGUYÊN (user chốt 19/07): mã CÓ entry → mọi nhập liệu = 2 ô Thùng + Hộp
//   SỐ NGUYÊN, quy đổi tại rìa bằng qtyFromEntryBase; mã KHÔNG entry → thập phân tự do.

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

/** Nhãn ĐVT gốc (base) của mã — cho ô Hộp / thông báo lỗi. */
export function qtyBaseLabel(m?: MatUnits | null): string {
  return unitLabel(m?.base_unit)
}

/**
 * Tách số lượng BASE thành phần entry (thùng) + phần base lẻ (hộp) — divmod.
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
  const entry = Math.floor(abs / factor)
  // chống trôi float khi base là số nguyên bản chất (4296/48 → 89 dư 24)
  const base = Math.round((abs - entry * factor) * 1000) / 1000
  return { entry: sign * entry, base: sign * base }
}

/** Gộp nhập liệu 2 ô "Thùng + Hộp" → số BASE để lưu/gửi API (rìa quy đổi duy nhất). */
export function qtyFromEntryBase(entry: number, base: number, m?: MatUnits | null): number {
  const e = Number(entry) || 0
  const b = Number(base) || 0
  if (!hasEntry(m)) return b || e // mã không entry: chỉ dùng 1 ô (ưu tiên base)
  return e * Number(m!.units_per_carton) + b
}

/**
 * LUẬT SỐ NGUYÊN: mã có entry → qty base phải là SỐ NGUYÊN (hộp/chai không có 0,5).
 * Trả message lỗi (vi) nếu vi phạm, null nếu hợp lệ. Dùng ở CẢ BE (422) lẫn FE.
 */
export function qtyIntegerError(qty: number, m?: MatUnits | null): string | null {
  const q = Number(qty)
  if (!isFinite(q)) return 'Số lượng không hợp lệ'
  if (hasEntry(m) && !Number.isInteger(q)) {
    return `Mã có đơn vị ${unitLabel(m!.entry_unit)}/${unitLabel(m!.base_unit)} — số lượng phải là SỐ NGUYÊN theo ${unitLabel(m!.base_unit)} (nhập 2 ô ${unitLabel(m!.entry_unit)} + ${unitLabel(m!.base_unit)})`
  }
  return null
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
 * Một CON SỐ theo entry unit cho cell hẹp / cột số / Excel (89,5).
 * ĐỢT 2: qty là BASE → chia hệ số (làm tròn 3 số lẻ chống trôi float).
 * Mã không entry: trả nguyên (số theo base).
 */
export function qtyEntryDecimal(qty: number, m?: MatUnits | null): number {
  const q = Number(qty)
  if (!isFinite(q)) return 0
  if (!hasEntry(m)) return q
  return Math.round((q / Number(m!.units_per_carton)) * 1000) / 1000
}

/** Format qtyEntryDecimal kèm chuẩn số VN, tối đa 3 số lẻ (tiện cho cell). */
export function qtyEntryText(qty: number, m?: MatUnits | null): string {
  return fmt(qtyEntryDecimal(qty, m))
}
