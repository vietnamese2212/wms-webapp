// LOẠI NGHỈ PHÉP — sổ chung của FE. BE mirror: backend/src/config/leaveTypes.ts (BE chặn giá trị
// ngoài sổ bằng 400). Thêm loại mới phải sửa CẢ HAI, nếu không đơn tạo từ FE sẽ bị BE từ chối.
export const LEAVE_TYPES: { value: string; label: string }[] = [
  { value: 'ANNUAL', label: 'Phép năm' },
  { value: 'SICK',   label: 'Nghỉ ốm' },
  { value: 'UNPAID', label: 'Không lương' },
  { value: 'OTHER',  label: 'Khác' },
]

/** Nhãn tiếng Việt của loại nghỉ; giá trị lạ (dữ liệu cũ) hiện nguyên văn. */
export const leaveTypeLabel = (t: string): string =>
  LEAVE_TYPES.find(o => o.value === t)?.label ?? t
