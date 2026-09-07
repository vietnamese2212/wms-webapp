/**
 * SỐ VIẾT KIỂU VIỆT NAM — MỘT nguồn kiểm duy nhất cho backend.
 *
 * Người Việt viết `1.234.567` (chấm phân cách nghìn) và `12,5` (phẩy thập phân); Excel xuất ra
 * chuỗi kiểu Mỹ `1,234,567` cũng thường gặp. Đọc sai ở đây KHÔNG báo lỗi — nó chỉ ghi một con số
 * khác vào sổ.
 *
 * Vì sao có file này (đo 06/09, gói QA 52 phép [2b][2c] trên Chi phí kho):
 *   - `"45.000.000"` → bản chép tay cho ra NaN ⇒ app báo "Số tiền không đọc được" và **từ chối cả
 *     file** kê khai của kế toán.
 *   - `"1.234"` → cho ra **1,234 đồng** thay vì 1.234 đồng — sai gấp 1.000 lần, ghi êm vào sổ.
 * Luật đúng vốn ĐÃ CÓ ở `frontend/src/pages/tms/TMSBookings.tsx` (`parseVnNumber`, dùng cho upload
 * Kế hoạch xuất) nhưng nơi khác chép lại thiếu đúng nhánh "nhiều dấu chấm = phân cách nghìn".
 * Bài học lặp: luật chép tay thì bản chép sau luôn thiếu một nhánh — xem memory
 * `vn-number-and-vehicle-type-rules`.
 *
 * Quy tắc quyết định (theo đúng thứ tự):
 *   có CẢ phẩy và chấm  → chấm là nghìn, phẩy là thập phân   `1.234,56` → 1234.56
 *   nhiều phẩy          → phẩy là nghìn (kiểu Mỹ)            `1,234,567` → 1234567
 *   đúng một phẩy       → phẩy là thập phân                  `12,5` → 12.5
 *   nhiều chấm          → chấm là nghìn                      `45.000.000` → 45000000
 *   đúng một chấm       → giữ nguyên (thập phân kiểu Mỹ)     `12.5` → 12.5
 */
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
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
