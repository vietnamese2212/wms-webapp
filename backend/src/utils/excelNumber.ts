// Ô SỐ của file Excel nạp vào (Tồn kho, Xuất kho, Mã hàng…) — MỘT cách đọc (20/11).
// Trước đây mỗi cửa tự chép `parseFloat(String(v).replace(',', '.'))` / `parseInt(v)`: ô CHỮ "1.000" (một nghìn kiểu VN)
// đọc ra 1, "1.234" ra 1,234 — ghi êm vào sổ (lớp lỗi vnNumber, xem docs/qa/BUG_CLASSES.md). Nay đọc qua parseVnNumber.
// Giữ một nét lỏng của bản cũ: ô có ĐƠN VỊ viết kèm ("12 thùng", "45kg") vẫn lấy phần số đứng đầu — cũng theo luật VN.
// Chuỗi kiểu "1e999" / "abc" vẫn là null (không đoán).
import { parseVnNumber } from './vnNumber'

const LEADING_NUMBER_WITH_UNIT = /^\s*(-?[\d.,]+)\s*[^\d\s.,eE+-]/

/** Số trong ô Excel (number hoặc chuỗi kiểu VN). Trống / không đọc được ⇒ null. */
export function excelNumber(v: unknown): number | null {
  const n = parseVnNumber(v)
  if (n != null || typeof v !== 'string') return n
  const lead = LEADING_NUMBER_WITH_UNIT.exec(v)?.[1]
  return lead ? parseVnNumber(lead) : null
}
