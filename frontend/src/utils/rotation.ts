// NGUYÊN TẮC LUÂN CHUYỂN — bản MIRROR của backend/src/utils/rotation.ts.
// FE KHÔNG tự tính "pallet nào nên lấy trước": kết quả kiểm luôn do BE trả về (khối `rotation`
// trong response check-scan). Trước 14/08 FE tự so production_date ở GdoScanSheet, và đó chính là
// bản luật thứ 2 khiến màn quét nói khác cột "Vị trí lấy". File này CHỈ giữ nhãn + danh sách lý do.
// Sửa luật = sửa file BE; sửa nhãn = sửa cả hai.

export const ROTATION_PRINCIPLES = ['FEFO', 'FIFO', 'LIFO'] as const
export type RotationPrinciple = typeof ROTATION_PRINCIPLES[number]

export const ROTATION_LABEL: Record<RotationPrinciple, string> = {
  FEFO: 'FEFO — hạn dùng ngắn nhất đi trước',
  FIFO: 'FIFO — hàng vào trước đi trước',
  LIFO: 'LIFO — hàng vào sau đi trước',
}

export const ROTATION_SHORT: Record<RotationPrinciple, string> = {
  FEFO: 'FEFO', FIFO: 'FIFO', LIFO: 'LIFO',
}

export const ROTATION_REASONS = [
  { code: 'BLOCKED',  label: 'Pallet nằm dưới chồng / bị chắn' },
  { code: 'DAMAGED',  label: 'Pallet hỏng, không lấy được' },
  { code: 'CUSTOMER', label: 'Khách yêu cầu date khác' },
  { code: 'OTHER',    label: 'Khác (ghi rõ)' },
] as const
export type RotationReasonCode = typeof ROTATION_REASONS[number]['code']

export function rotationReasonLabel(raw?: string | null): string {
  const s = String(raw ?? '').trim()
  if (!s) return '—'
  const [code, ...rest] = s.split(':')
  const found = ROTATION_REASONS.find(r => r.code === code.trim())
  const note = rest.join(':').trim()
  if (!found) return s
  return note ? `${found.label}: ${note}` : found.label
}

// Đọc vết luân chuyển của MỘT DÒNG QUÉT ĐÃ LƯU (bảng lịch sử).
// Dòng từ 14/08 có cột rotation_* (đã tính theo đúng nguyên tắc của kho); dòng CŨ hơn chỉ có
// best_available_date = MIN(NSX) ⇒ suy tạm theo luật cũ để không mất thông tin lịch sử.
export function scanRotationOf(se: {
  rotation_violation?:  boolean | null
  rotation_best_date?:  string | null
  best_available_date?: string | null
  production_date?:     string | null
}): { bad: boolean; bestDate: string | null } {
  if (se.rotation_violation != null || se.rotation_best_date != null) {
    return { bad: se.rotation_violation === true, bestDate: se.rotation_best_date ?? null }
  }
  const bad = !!(se.best_available_date && se.production_date && se.production_date > se.best_available_date)
  return { bad, bestDate: se.best_available_date ?? null }
}

// Kết quả kiểm do BE trả về — shape khớp RotationCheck bên backend.
export interface RotationCheck {
  principle:          RotationPrinciple
  required:           boolean
  violation:          boolean
  date_label:         string           // 'HSD' | 'NSX'
  scanned_date:       string | null
  best_date:          string | null
  best_pallet_code:   string | null
  best_location_code: string | null
}
