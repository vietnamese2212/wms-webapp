/**
 * SỐ VIẾT KIỂU VIỆT NAM — MIRROR của `backend/src/utils/vnNumber.ts` (sửa luật phải sửa CẢ HAI).
 * Phép kiểm mirror `backend/tests/mirror/vnNumber.mirror.test.ts` so hai bản trên cùng input —
 * lệch là đỏ ngay ở `npm test`, không chờ tới lúc kế toán dán file "45.000.000".
 *
 * Quy tắc quyết định (theo đúng thứ tự):
 *   có CẢ phẩy và chấm  → chấm là nghìn, phẩy là thập phân   `1.234,56` → 1234.56
 *   nhiều phẩy          → phẩy là nghìn (kiểu Mỹ)            `1,234,567` → 1234567
 *   đúng một phẩy       → phẩy là thập phân                  `12,5` → 12.5
 *   nhiều chấm          → chấm là nghìn                      `45.000.000` → 45000000
 *   một chấm, sau nó ĐÚNG 3 chữ số → chấm là nghìn           `1.234` → 1234
 *   một chấm, các dạng khác        → thập phân kiểu Mỹ       `12.5` → 12.5 · `1.2345` → 1.2345
 */
const THOUSAND_DOT = /^-?[1-9]\d{0,2}\.\d{3}$/

export function parseVnNumber(val: unknown): number | null {
  if (val == null) return null
  if (typeof val === 'number') return Number.isFinite(val) ? val : null
  let s = String(val).trim().replace(/\s/g, '').replace(/[₫đ]/gi, '')
  if (!s) return null
  const commas = (s.match(/,/g) ?? []).length
  const dots = (s.match(/\./g) ?? []).length
  if (commas && dots) s = s.replace(/\./g, '').replace(',', '.')
  else if (commas > 1) s = s.replace(/,/g, '')
  else if (commas === 1) s = s.replace(',', '.')
  else if (dots > 1) s = s.replace(/\./g, '')
  else if (dots === 1 && THOUSAND_DOT.test(s)) s = s.replace('.', '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
