// SỔ CA LÀM VIỆC — MỘT NGUỒN cho nhãn / thứ tự / màu của ca (audit hardcode 14/08).
//
// Trước đây mã ca CA1/CA2/CA3/HC nằm rải 7 file (Attendance · Assignments · hooks · hrSkillSections
// FE + attendanceController · assignmentController BE), mỗi nơi khai lại nhãn và màu riêng ⇒ thêm
// hoặc đổi tên ca phải nhớ sửa đủ 7 chỗ, sót một chỗ là bảng công/phân công hiển thị lệch.
//
// ⚠️ ĐÂY CHƯA PHẢI DANH MỤC ĐỘNG. Thuật toán phân ca (tầng CA1+CA2 → CA3 → HC, luật "trực CA3 hôm
// qua") gắn chặt vào ĐÚNG 4 mã này; biến ca thành danh mục người dùng tự thêm là phải viết lại
// thuật toán — việc riêng, cần đo lại kỹ với HR. Ở đây chỉ gom về một chỗ để sửa 1 lần thay vì 7,
// hành vi giữ nguyên 100%.
export const SHIFT_CODES = ['CA1', 'CA2', 'CA3', 'HC'] as const
export type ShiftCode = typeof SHIFT_CODES[number]

/** Mã dùng khi CHẤM CÔNG = ca làm việc + nghỉ phép */
export const ATTENDANCE_KINDS = [...SHIFT_CODES, 'LEAVE'] as const
export type AttendanceKind = typeof ATTENDANCE_KINDS[number]

export interface ShiftMeta {
  label: string        // nhãn đầy đủ (ô chọn ca ở form)
  short: string        // nhãn ngắn (ô ma trận bảng công)
  rank: number         // thứ tự hiển thị: ca 1 → ca 2 → ca 3 → hành chính → nghỉ
  cell: string         // class màu ô lịch/ma trận
  printBg?: string     // nền dòng khi IN bảng phân công (chỉ ca cần nổi bật)
}

// Giá trị GIỮ NGUYÊN như trước khi gom (Attendance.KIND_CELL/KIND_SHORT/KINDS ·
// Assignments.SHIFT_LABEL/RULE_SHIFTS/SHIFT_RANK/PRINT_ROW_BG) — gom nguồn, KHÔNG đổi giao diện.
export const SHIFT_META: Record<AttendanceKind, ShiftMeta> = {
  CA1:   { label: 'Ca 1',       short: 'Ca 1', rank: 0, cell: 'bg-sky-100 text-sky-700' },
  CA2:   { label: 'Ca 2',       short: 'Ca 2', rank: 1, cell: 'bg-indigo-100 text-indigo-700', printBg: '#fef3c7' },
  CA3:   { label: 'Ca 3',       short: 'Ca 3', rank: 2, cell: 'bg-violet-100 text-violet-700', printBg: '#fee2e2' },
  HC:    { label: 'Hành chính', short: 'HC',   rank: 3, cell: 'bg-green-100 text-green-700' },
  LEAVE: { label: 'Nghỉ phép',  short: 'Nghỉ', rank: 4, cell: 'bg-slate-200 text-slate-600' },
}

export const shiftLabel = (k: string) => SHIFT_META[k as AttendanceKind]?.label ?? k
export const shiftShort = (k: string) => SHIFT_META[k as AttendanceKind]?.short ?? k
export const shiftRank  = (k: string) => SHIFT_META[k as AttendanceKind]?.rank ?? 99
export const shiftCell  = (k: string) => SHIFT_META[k as AttendanceKind]?.cell ?? ''
export const shiftPrintBg = (k: string) => SHIFT_META[k as AttendanceKind]?.printBg

/** Option cho ô chọn ca (form chấm công / quy tắc ca) — thứ tự theo rank */
export const shiftOptions = (kinds: readonly string[] = SHIFT_CODES) =>
  [...kinds].sort((a, b) => shiftRank(a) - shiftRank(b)).map(v => ({ value: v, label: shiftLabel(v) }))
