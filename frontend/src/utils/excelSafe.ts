// Chống FORMULA/CSV injection khi export Excel: ô bắt đầu bằng = + - @ (hoặc tab/CR)
// khi mở trong Excel/Google Sheets sẽ bị hiểu là CÔNG THỨC → có thể chạy HYPERLINK/
// lệnh độc hại nếu dữ liệu chứa vd `=cmd|'/c calc'!A1`. Prefix dấu nháy đơn để buộc
// Excel coi là văn bản. Áp cho MỌI dữ liệu do người dùng nhập trước khi ghi sheet.
function sanitizeCell<T>(v: T): T {
  if (typeof v !== 'string') return v
  return (/^[=+\-@\t\r]/.test(v) ? "'" + v : v) as unknown as T
}

// Làm sạch 1 mảng object (json_to_sheet) — sao chép nông, chỉ đụng giá trị chuỗi nguy hiểm
export function sanitizeRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map(row => {
    const out: Record<string, unknown> = {}
    for (const k in row) out[k] = sanitizeCell(row[k])
    return out as T
  })
}

// Làm sạch mảng-của-mảng (aoa_to_sheet)
export function sanitizeAoa(rows: unknown[][]): unknown[][] {
  return rows.map(r => r.map(sanitizeCell))
}
