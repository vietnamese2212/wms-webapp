// DẢI "ĐANG LÀM" — tab chuyển nhanh giữa các bản ghi người dùng đã đánh dấu (🔖) để làm nhiều việc một lúc: chuyến xuất
// (OutboundDetail, store activeVehiclesStore) · mẻ chế biến (ProductionBatchDetail, store activeBatchesStore — user 18/11: "giống như
// xuất, cho lựa chọn tab để làm nhiều mẻ 1 lúc"). Một khuôn để hai màn trông và bấm như nhau: tab đang mở nền hổ phách gạch chân,
// chấm màu = tình trạng, cuộn ngang khi nhiều tab. Nút ✕ trên tab (user 18/11: "cho nút X ở trên tab để tắt đi khi cần") = bỏ đánh
// dấu bản ghi đó — đang đứng ở tab đó thì vẫn ở lại trang, chỉ tab biến mất.
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export function PinnedTabsBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex overflow-x-auto shrink-0 border-b bg-amber-50/60 gap-0 scrollbar-none" data-testid="pinned-tabs">
      <span className="text-[9px] text-amber-600 font-medium px-2 py-1.5 shrink-0 border-r border-amber-200">Đang làm:</span>
      {children}
    </div>
  )
}

/** Một tab: `dot` = class màu chấm tình trạng (vd bg-amber-500) · `mark` = biểu tượng thay chấm (vd khiên đỏ QA loại) · `onClose` = nút ✕ */
export function PinnedTab({ label, dot, mark, current, onClick, onClose, title }: {
  label: string; dot: string; mark?: ReactNode; current: boolean; onClick: () => void; onClose?: () => void; title?: string
}) {
  return (
    <div data-pinned-tab={label} className={[
      'flex items-center border-b-2 transition-colors shrink-0',
      current ? 'border-amber-500 bg-amber-100' : 'border-transparent hover:bg-amber-50',
    ].join(' ')}>
      <button type="button" onClick={onClick} title={title} aria-current={current ? 'page' : undefined}
        className={[
          'flex items-center gap-1 py-1.5 text-[10px]', onClose ? 'pl-3 pr-1' : 'px-3',
          current ? 'text-amber-800 font-semibold cursor-default' : 'text-slate-500 hover:text-slate-700 cursor-pointer',
        ].join(' ')}>
        {mark ?? <span className={`h-1.5 w-1.5 rounded-full shrink-0 mr-0.5 ${dot}`} />}
        {label}
      </button>
      {onClose && (
        <button type="button" onClick={onClose} aria-label={`Đóng tab ${label}`} title="Bỏ khỏi dải đang làm"
          className="mr-1 rounded p-1 text-slate-400 hover:bg-amber-200/60 hover:text-red-600">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
