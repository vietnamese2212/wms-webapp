// LOẠI NGHỈ PHÉP — sổ chung của BE (đợt 3 vòng 2, 14/08).
// Trước đây danh sách chỉ có ở FE (LeaveManagement), BE nhận `leave_type` là CHUỖI TỰ DO và mặc
// định 'ANNUAL' ⇒ gọi thẳng API ghi được giá trị rác, và bảng/Excel hiện ra mã thô không ai đọc.
// FE mirror: frontend/src/config/leaveTypes.ts — thêm loại mới phải sửa CẢ HAI.
export const LEAVE_TYPES = [
  { value: 'ANNUAL', label: 'Phép năm' },
  { value: 'SICK',   label: 'Nghỉ ốm' },
  { value: 'UNPAID', label: 'Không lương' },
  { value: 'OTHER',  label: 'Khác' },
] as const

export const LEAVE_TYPE_VALUES: string[] = LEAVE_TYPES.map(t => t.value)
export const DEFAULT_LEAVE_TYPE = 'ANNUAL'
export const isLeaveType = (v: unknown): v is string =>
  typeof v === 'string' && LEAVE_TYPE_VALUES.includes(v)
