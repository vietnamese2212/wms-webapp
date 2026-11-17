// DẢI "ĐANG LÀM" — tab chuyển nhanh giữa các bản ghi người dùng đã đánh dấu (🔖) để làm nhiều việc một lúc: chuyến xuất
// (OutboundDetail, store activeVehiclesStore) · mẻ chế biến (ProductionBatchDetail, store activeBatchesStore — user 18/11: "giống như
// xuất, cho lựa chọn tab để làm nhiều mẻ 1 lúc"). Một khuôn để hai màn trông và bấm như nhau: tab đang mở nền hổ phách gạch chân,
// chấm màu = tình trạng, cuộn ngang khi nhiều tab.
import type { ReactNode } from 'react'

export function PinnedTabsBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex overflow-x-auto shrink-0 border-b bg-amber-50/60 gap-0 scrollbar-none" data-testid="pinned-tabs">
      <span className="text-[9px] text-amber-600 font-medium px-2 py-1.5 shrink-0 border-r border-amber-200">Đang làm:</span>
      {children}
    </div>
  )
}

/** Một tab: `dot` = class màu chấm tình trạng (vd bg-amber-500) */
export function PinnedTab({ label, dot, current, onClick, title }: {
  label: string; dot: string; current: boolean; onClick: () => void; title?: string
}) {
  return (
    <button type="button" onClick={onClick} title={title} aria-current={current ? 'page' : undefined}
      className={[
        'flex items-center gap-1 px-3 py-1.5 text-[10px] border-b-2 transition-colors shrink-0',
        current
          ? 'border-amber-500 bg-amber-100 text-amber-800 font-semibold cursor-default'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-amber-50 cursor-pointer',
      ].join(' ')}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 mr-0.5 ${dot}`} />
      {label}
    </button>
  )
}
