// KÍCH THƯỚC LÒNG THÙNG XE (mm) — một parser cho CẢ HAI nơi khai (26/08).
//
// Hai bảng cùng mang 3 cột này vì chúng trả lời hai câu hỏi khác nhau:
//   • `VehicleType.box_*_mm` — cỡ tiêu biểu của LOẠI xe (gợi ý khi chưa khai riêng)
//   • `Vehicle.box_*_mm`     — cỡ THẬT của CHIẾC xe mang biển số đó (user chốt 26/08: khai ở biển
//                              số thì chọn xe là có kích thước luôn)
// Trước 26/08 chỗ khai duy nhất (VehicleType) nhận thẳng `Number(v)` — tức `"abc"` thành NaN và
// số 0 lọt xuống DB, rồi thuật toán xếp xe chia cho 0. Gom về một hàm để hai bên không thể lệch.
//
// Trần 30.000mm = 30m: dài hơn mọi xe tải/container thực tế, nhưng vẫn chặn được số nhập nhầm đơn
// vị (khai mét thành mm ra 9.200.000) làm sơ đồ vẽ ra một cái xe dài vô nghĩa.
export const BOX_DIM_MAX_MM = 30_000

export function parseBoxDim(v: unknown, label: string): { value: number | null } | { error: string } {
  if (v === null || v === undefined || v === '') return { value: null }   // chưa khai — hợp lệ
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0)
    return { error: `${label} phải là số lớn hơn 0 (mm) — để trống nếu chưa khai` }
  if (n > BOX_DIM_MAX_MM)
    return { error: `${label} không quá ${BOX_DIM_MAX_MM.toLocaleString('vi-VN')}mm (30m) — kiểm tra lại đơn vị, số phải tính bằng MILIMÉT` }
  return { value: n }
}

/**
 * Đọc cả 3 chiều từ body → patch. Trả mã lỗi đầu tiên gặp phải, hoặc null nếu OK.
 * Chỉ đụng tới chiều nào body CÓ gửi (`undefined` = đừng đổi cột đó).
 */
export function applyBoxDims(
  body: Record<string, unknown>, target: Record<string, unknown>,
): string | null {
  const fields: [key: string, label: string][] = [
    ['box_length_mm', 'Chiều dài lòng thùng'],
    ['box_width_mm',  'Chiều rộng lòng thùng'],
    ['box_height_mm', 'Chiều cao lòng thùng'],
  ]
  for (const [key, label] of fields) {
    if (body[key] === undefined) continue
    const r = parseBoxDim(body[key], label)
    if ('error' in r) return r.error
    target[key] = r.value
  }
  return null
}
