// Chuẩn hoá Ô Excel dùng chung cho các cửa nạp raw SAP (VL06O · ZSD02 · KHVC).
// Tách khỏi outboundController (22/09) để bộ parse ZSD02 là hàm THUẦN test được không cần DB.
import * as XLSX from 'xlsx'

/** Chuỗi trim; rỗng → null. */
export const cellStr = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null }

/** Số; rỗng / NaN → null. Chuỗi có dấu phẩy nghìn "1,234" → 1234 (SAP xuất Excel kiểu Anh). */
export const cellNum = (v: unknown): number | null => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Ngày Excel → 'YYYY-MM-DD'. Nhận serial Excel (không qua Date local — bẫy lệch −1 ngày), dd/mm/yyyy, yyyy-mm-dd.
 *  Ngày không có trên lịch (32/13/2026) → null để controller báo "ngày không hợp lệ" thay vì ghi ngày tràn. */
export function parseExcelDate(val: unknown): string | null {
  if (!val) return null
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val)
    if (!d) return null
    const date = new Date(Date.UTC(d.y, d.m - 1, d.d))
    return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }
  const s = String(val).trim()
  if (!s) return null
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) {
    const [dd, mm, yy] = [parseInt(dmy[1]), parseInt(dmy[2]), parseInt(dmy[3])]
    const date = new Date(Date.UTC(yy, mm - 1, dd))
    if (isNaN(date.getTime())) return null
    if (date.getUTCFullYear() !== yy || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null
    return date.toISOString().slice(0, 10)
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
