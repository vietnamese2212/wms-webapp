// Chip lọc bảng preview upload: Tất cả / ✓ Hợp lệ / Lỗi — chuẩn dùng chung MỌI dialog upload
// (skill upload-download-standard mục D). File có lỗi → parent nên mở sẵn tab 'err'.
export type RowFilterVal = 'all' | 'ok' | 'err'

export function RowFilterChips({ total, okCount, errCount, value, onChange }: {
  total: number; okCount: number; errCount: number; value: RowFilterVal; onChange: (v: RowFilterVal) => void
}) {
  const chip = (v: RowFilterVal, label: string, idleCls: string, activeCls: string) => (
    <button key={v} type="button" onClick={() => onChange(v)}
      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${value === v ? activeCls : `bg-white border-slate-200 hover:bg-slate-50 ${idleCls}`}`}>
      {label}
    </button>
  )
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {chip('all', `Tất cả (${total})`, 'text-slate-600', 'bg-slate-800 text-white border-slate-800')}
      {chip('ok',  `✓ Hợp lệ (${okCount})`, 'text-green-600', 'bg-green-600 text-white border-green-600')}
      {chip('err', `Lỗi (${errCount})`, 'text-red-500', 'bg-red-600 text-white border-red-600')}
    </div>
  )
}

export const rowFilterPass = (v: RowFilterVal, valid: boolean) => v === 'all' || (v === 'ok' ? valid : !valid)
