// qtyUnits — formatter số lượng TRUNG TÂM theo Base/Entry Unit (chiến dịch BASE UNIT).
// BE mirror: backend/src/utils/qtyUnits.ts — 2 bản PHẢI KHỚP NHAU (mẫu như shelfLife.ts).
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
  // QUY CÁCH GỢI Ý của mã cân / đong (27/11 — đường trắng 1 bao = 20 kg): CHỈ để in "50 bao", không quy đổi / cộng tổng.
  pack_unit?: string | null
  pack_size?: number | null
  // Định danh mã — FE tra quy cách gợi ý đã nạp lúc khởi động (setPackHints) khi object không mang sẵn pack_unit / pack_size.
  id?: string | null
  material_code?: string | null
}

/** Nhãn tiếng Việt cho mã ĐVT — chỉ là LƯỚI ĐỠ khi chưa nạp được danh mục (xem setUnitLabels). */
const UNIT_LABELS: Record<string, string> = {
  CAR: 'thùng',
  HOP: 'hộp',
  KG: 'kg',
  BAG: 'túi',   // mã SAP — túi nhỏ (bao bì). Bao đường / bột là ĐVT riêng BAO (27/11)
  BAO: 'bao',
  EA: 'cái',
  BT: 'chai',
  SET: 'bộ',
  ROL: 'cuộn',
  M2: 'mét vuông',
  G: 'gram',
  L: 'lít',
}

// Nhãn THẬT lấy từ danh mục Đơn vị tính (LookupValue `unit_of_measure`, tab Đơn vị tính của Cài đặt
// WMS) — nạp một lần khi app khởi động (Shell). Trước 14/08 helper chỉ biết 6 mã cứng nên ĐVT do
// người dùng tự thêm (SET/ROL/M2/G/L…) hiện ra MÃ THÔ: "5 SET" thay vì "5 bộ".
// Vẫn giữ bảng cứng phía trên làm lưới đỡ: helper này chạy cả khi chưa có mạng/chưa nạp xong.
let RUNTIME_UNIT_LABELS: Record<string, string> = {}
export function setUnitLabels(rows: { value: string; label?: string | null }[]): void {
  const next: Record<string, string> = {}
  for (const r of rows) {
    const code = (r.value ?? '').trim().toUpperCase()
    const label = (r.label ?? '').trim()
    if (code && label) next[code] = label.toLowerCase()
  }
  RUNTIME_UNIT_LABELS = next
}

export function unitLabel(code?: string | null): string {
  const c = (code ?? '').trim().toUpperCase()
  if (!c) return 'thùng' // thiếu khai báo → giữ hành vi cũ của app
  return RUNTIME_UNIT_LABELS[c] ?? UNIT_LABELS[c] ?? c
}

/** Mã có Entry Unit + hệ số hợp lệ → hiển thị dạng "N thùng + M hộp". */
export function hasEntry(m?: MatUnits | null): boolean {
  return !!(m?.entry_unit && Number(m?.units_per_carton) > 0)
}

/**
 * ĐƠN VỊ ĐO (cân / đong / đo dài–diện tích–thể tích): số theo đơn vị này tự nhiên có phần lẻ.
 * 27/11: mã kg có đơn vị quy cách (đường trắng: 1 bao = 20 kg) hiện "5 bao + 10,5 kg" — phần kg được lẻ,
 * khác hộp / chai / cái (không có 0,5 hộp). Danh sách cố định ở đây (hai bản BE ⇄ FE phải khớp — mirror test).
 */
export const MEASURE_UNIT_CODES: readonly string[] = ['KG', 'G', 'MG', 'TON', 'L', 'ML', 'M', 'CM', 'MM', 'M2', 'M3']
// DB có bản thứ ba của danh sách này: hàm qty_is_measure_unit (migration 20261127d) — test measureUnitsSql đối chiếu
const MEASURE_UNITS = new Set<string>(MEASURE_UNIT_CODES)
export function isMeasureUnit(code?: string | null): boolean {
  return MEASURE_UNITS.has((code ?? '').trim().toUpperCase())
}

/**
 * Phần theo ĐƠN VỊ GỐC được phép lẻ không — MỘT luật cho mọi cửa nhập số (ô "Thùng + Hộp", upload Excel, điều chỉnh).
 * Mã không quy cách: luôn được (luật cũ). Mã có quy cách thật (thùng + hộp): phải nguyên. Mã đơn vị đo thì DB không cho mang
 * entry unit (material_measure_no_entry_chk) — nhánh isMeasureUnit chỉ là lưới đỡ.
 */
export function baseAllowsDecimal(m?: MatUnits | null): boolean {
  return !hasEntry(m) || isMeasureUnit(m?.base_unit)
}

// Quy cách gợi ý nạp MỘT lần lúc khởi động (Shell — GET /wms/material-pack-hints, chỉ vài mã): object số lượng ở các màn
// (dòng tồn, pallet, dòng hàng xuất) mang id / mã hàng nhưng không mang pack_unit / pack_size — tra ở đây. Thiếu thì chỉ
// mất dòng gợi ý, không sai số (gợi ý là lớp hiển thị).
let RUNTIME_PACK_HINTS = new Map<string, { unit: string; size: number }>()
export function setPackHints(rows: { id?: string | null; material_code?: string | null; pack_unit?: string | null; pack_size?: number | string | null }[]): void {
  const next = new Map<string, { unit: string; size: number }>()
  for (const r of rows) {
    const unit = (r.pack_unit ?? '').trim().toUpperCase()
    const size = Number(r.pack_size)
    if (!unit || !(size > 0)) continue
    if (r.id) next.set(`id:${r.id}`, { unit, size })
    if (r.material_code) next.set(`code:${String(r.material_code).trim()}`, { unit, size })
  }
  RUNTIME_PACK_HINTS = next
}
function packFields(m?: MatUnits | null): { unit: string; size: number } | null {
  const unit = (m?.pack_unit ?? '').trim().toUpperCase()
  if (unit) return { unit, size: Number(m?.pack_size) }
  return (m?.id ? RUNTIME_PACK_HINTS.get(`id:${m.id}`) : undefined)
    ?? (m?.material_code ? RUNTIME_PACK_HINTS.get(`code:${String(m.material_code).trim()}`) : undefined)
    ?? null
}

/**
 * QUY CÁCH GỢI Ý của mã cân / đong — user 27/11: "hàng NVL như đường trắng: key 1000 kg sẽ giữ là 1000 kg, chỉ gợi ý là 50 bao
 * thôi, kg vẫn là đơn vị chính"; còn hàng thành phẩm 1 thùng = 48 hộp thì "60 hộp = 1 thùng + 12 hộp" (thùng là entry unit thật).
 * PHÂN BIỆT bằng ĐƠN VỊ GỐC: đơn vị đo (KG, L…) ⇒ "1 bao = 20 kg" nằm ở pack_unit / pack_size, KHÔNG phải entry unit, nên mọi
 * phép quy đổi, cộng tổng, Excel, số / pallet thấy mã y như chưa khai bao; chỉ dòng gợi ý đọc hai cột này.
 */
export function packOf(m?: MatUnits | null): { unit: string; size: number } | null {
  if (hasEntry(m) || !isMeasureUnit(m?.base_unit)) return null
  const p = packFields(m)
  return p && p.unit && p.size > 0 ? p : null
}
export function isPackHintMaterial(m?: MatUnits | null): boolean {
  return packOf(m) != null
}

/**
 * Bản RÚT GỌN của mã cho ô hẹp: bỏ phần gợi ý (qtyLabel ra "110 kg" thay vì "110 kg (5 bao + 10 kg)") — gợi ý in ở dòng riêng
 * (QtyText / QtyPackHintLine). Mã khác giữ nguyên.
 */
export function qtyMainUnits(m?: MatUnits | null): MatUnits | null | undefined {
  return isPackHintMaterial(m) ? { base_unit: m!.base_unit ?? null } : m
}

/** Gợi ý quy cách cho mã cân / đong: 110 kg ⇒ "5 bao + 10 kg"; dưới 1 bao hoặc mã khác ⇒ null. */
export function qtyPackHint(qty: number, m?: MatUnits | null): string | null {
  const p = packOf(m)
  const q = Math.abs(Number(qty))
  if (!p || !isFinite(q) || q < p.size) return null
  const n = Math.floor(q / p.size)
  const rest = Math.round((q - n * p.size) * 1000) / 1000
  const s = rest > 0 ? `${fmt(n)} ${unitLabel(p.unit)} + ${fmt(rest)} ${unitLabel(m!.base_unit)}` : `${fmt(n)} ${unitLabel(p.unit)}`
  return Number(qty) < 0 ? `-${s}` : s
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
 * MÃ CODE đơn vị chính của mã (Entry nếu có, ngược lại Base) — thay cho trường `unit` (ĐVT) đã bỏ.
 * Trả CODE thô (CAR/HOP/KG/BT…), KHÔNG phải nhãn tiếng Việt. Nơi cần chữ dùng `unitLabel()`.
 */
export function unitCodeOf(m?: MatUnits | null): string {
  return (m?.entry_unit || m?.base_unit || '').trim().toUpperCase()
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
 * LUẬT SỐ NGUYÊN: mã có entry → qty base phải là SỐ NGUYÊN (hộp/chai không có 0,5) —
 * TRỪ khi đơn vị gốc là đơn vị đo (KG / L…: "5 bao + 10,5 kg" hợp lệ — xem baseAllowsDecimal).
 * Trả message lỗi (vi) nếu vi phạm, null nếu hợp lệ. Dùng ở CẢ BE (422) lẫn FE.
 */
export function qtyIntegerError(qty: number, m?: MatUnits | null): string | null {
  const q = Number(qty)
  if (!isFinite(q)) return 'Số lượng không hợp lệ'
  if (!baseAllowsDecimal(m) && !Number.isInteger(q)) {
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
  if (!hasEntry(m)) {
    // mã cân / đong có quy cách gợi ý (27/11): "110 kg (5 bao + 10 kg)" — kg là số chính, bao là gợi ý
    const hint = qtyPackHint(q, m)
    return `${fmt(q)} ${qtyUnitLabel(m)}${hint ? ` (${hint})` : ''}`
  }
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

/** Một ô tổng theo MỘT đơn vị chính: unit = mã ĐVT (CAR / KG / EA…), qty = số theo đơn vị đó. */
export type QtyUnitTotal = { unit: string; qty: number }

/**
 * Cộng nhiều dòng KHÁC MÃ theo TỪNG ĐƠN VỊ CHÍNH — không cộng thùng với kg với cái (user 27/11: chuyến 10 thùng sữa + 1.000 kg
 * đường hiện "10 thùng · 1.000 kg", không phải "60 thùng" hay "1.010 thùng"). Mã có thùng góp số thùng quy đổi (qtyEntryDecimal),
 * mã khác góp số theo đơn vị gốc. Thứ tự đơn vị = thứ tự xuất hiện.
 */
export function qtyTotalsByUnit(lines: readonly { qty: number; mat?: MatUnits | null }[]): QtyUnitTotal[] {
  const acc = new Map<string, number>()
  for (const l of lines) {
    const unit = ((hasEntry(l.mat) ? l.mat!.entry_unit : l.mat?.base_unit) ?? '').trim().toUpperCase()
    const v = qtyEntryDecimal(Number(l.qty) || 0, l.mat)
    acc.set(unit, (acc.get(unit) ?? 0) + (isFinite(v) ? v : 0))
  }
  return [...acc].map(([unit, qty]) => ({ unit, qty: Math.round(qty * 1000) / 1000 }))
}

function fmt1(n: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(n)
}

/** "10 thùng · 1.000 kg" (không dòng nào ⇒ "0"). */
export function qtyTotalsText(t: readonly QtyUnitTotal[]): string {
  if (!t.length) return '0'
  return t.map(x => `${fmt1(x.qty)} ${unitLabel(x.unit)}`).join(' · ')
}

/** "4/10 thùng · 400/1.000 kg" — đã làm / kế hoạch, theo từng đơn vị của kế hoạch. */
export function qtyTotalsPairText(done: readonly QtyUnitTotal[], plan: readonly QtyUnitTotal[]): string {
  if (!plan.length) return '0/0'
  const d = new Map(done.map(x => [x.unit, x.qty]))
  return plan.map(x => `${fmt1(d.get(x.unit) ?? 0)}/${fmt1(x.qty)} ${unitLabel(x.unit)}`).join(' · ')
}

/** Tiến độ 0..1: mỗi đơn vị tính % riêng (tối đa 100%) rồi lấy trung bình — chuyến chỉ một đơn vị thì y như cũ. */
export function qtyTotalsProgress(done: readonly QtyUnitTotal[], plan: readonly QtyUnitTotal[]): number {
  const parts = plan.filter(x => x.qty > 0)
  if (!parts.length) return 0
  const d = new Map(done.map(x => [x.unit, x.qty]))
  return parts.reduce((s, x) => s + Math.min(1, Math.max(0, (d.get(x.unit) ?? 0) / x.qty)), 0) / parts.length
}

/**
 * NHÃN + TOOLTIP cho ô TỔNG cộng CROSS-MÃ (band/tile) — nguồn DUY NHẤT, đừng tự đặt chữ.
 * Tổng cross-mã = qtyEntryDecimal per-mã rồi cộng: mã có thùng về thùng, mã KHÔNG entry
 * (NVL kg / bao bì cái) góp SỐ BASE THÔ — nên gọi cả cụm là "thùng" là SAI ĐƠN VỊ và thổi số
 * (Tồn kho 29/07: 118 triệu "thùng" thực chất 116 triệu là CÁI; TMS 26/07: 12,5 triệu tương tự).
 * Từ vựng chốt 26/07: "SL (quy đổi)".
 */
export const QTY_CONVERTED_LABEL = 'SL (quy đổi)'
export const QTY_CONVERTED_TIP =
  'Số lượng quy đổi: mã có quy cách thùng được quy về THÙNG, mã tính theo KG/cái '
  + '(nguyên liệu, bao bì) cộng theo đơn vị gốc — nên đây KHÔNG phải số thùng hàng thực tế. '
  + 'Xem số đúng đơn vị ở cột số lượng của từng dòng.'
