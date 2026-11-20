// Chống FORMULA/CSV injection khi export Excel: ô bắt đầu bằng = + - @ (hoặc tab/CR)
// khi mở trong Excel/Google Sheets sẽ bị hiểu là CÔNG THỨC → có thể chạy HYPERLINK/
// lệnh độc hại nếu dữ liệu chứa vd `=cmd|'/c calc'!A1`. Prefix dấu nháy đơn để buộc
// Excel coi là văn bản. Áp cho MỌI dữ liệu do người dùng nhập trước khi ghi sheet.
// Số âm dạng chữ ("-5", "-1,5") và gạch trống ("-") KHÔNG phải công thức: thêm nháy thì ô hiện "'-5" (trong file .xlsx dấu
// nháy là ký tự thật, không ẩn như khi gõ tay) — số đo phiếu công đoạn âm bị in kèm nháy (20/11). Chỉ prefix khi '-' theo sau
// là thứ khác chữ số.
export function sanitizeCell<T>(v: T): T {
  if (typeof v !== 'string') return v
  const risky = /^[=+@\t\r]/.test(v) || (v.startsWith('-') && !/^-[\d\s.,]*$/.test(v))
  return (risky ? "'" + v : v) as unknown as T
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
