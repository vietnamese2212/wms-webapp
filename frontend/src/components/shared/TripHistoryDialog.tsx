// Nút "Thông tin" của chuyến Xuất (user chốt 03/08): DÒNG THỜI GIAN thay đổi của đơn hàng —
// thay đổi thế nào, bởi ai, lúc nào, từ nguồn nào. Gộp nhật ký kế hoạch (Kế hoạch xuất) + thay đổi
// từ SAP (VL06O) nên tra 1 chỗ là thấy hết, không phải nhảy tab.
import { X, Loader2, FileClock } from 'lucide-react'
import { useOutboundEvents } from '@/api/hooks'
import { ModalOverlay } from './ModalOverlay'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'

const SOURCE_LABEL: Record<string, { text: string; cls: string }> = {
  PLAN:   { text: 'Kế hoạch xuất', cls: 'bg-sky-100 text-sky-700' },
  SAP:    { text: 'SAP / VL06O',   cls: 'bg-violet-100 text-violet-700' },
  USER:   { text: 'Thao tác tay',  cls: 'bg-slate-100 text-slate-700' },
  SYSTEM: { text: 'Hệ thống',      cls: 'bg-slate-100 text-slate-500' },
}
// Sự kiện nào là CẢNH BÁO (đổi số/ngừng hoạt động) thì tô đậm hơn cho dễ lướt
const WARN_EVENTS = new Set(['PLAN_VEHICLE_DROPPED', 'AWAITING_SET', 'SAP_NEEDS_REVIEW', 'SAP_BLOCKED', 'PLAN_DO_REMOVED'])

// `infoContent` (tùy chọn): khối THÔNG TIN ĐƠN hiện phía trên dòng thời gian — user chốt 03/08
// "gom về làm 1": một nút Thông tin duy nhất cho cả thông tin đơn + lịch sử sửa, cả browser lẫn mobile.
export function TripHistoryDialog({ gdoId, groupCode, infoContent, onClose }: {
  gdoId: string; groupCode?: string | null; infoContent?: React.ReactNode; onClose: () => void
}) {
  const { data, isLoading, isError, error } = useOutboundEvents(gdoId)
  const items = data?.items ?? []

  return (
    <ModalOverlay onClose={onClose} className="w-full max-w-2xl max-h-[85vh]">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <FileClock className="h-4 w-4 text-sky-600" />
          Thông tin chuyến {groupCode ?? data?.group_code ?? ''}
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
      </div>

      <div className="p-4 overflow-auto">
        {infoContent && (
          <div className="mb-4">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Thông tin đơn</p>
            {infoContent}
            <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 mt-4 mb-0.5">Lịch sử thay đổi</p>
          </div>
        )}
        {isLoading && <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải lịch sử…</div>}
        {isError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            Không tải được lịch sử: {String((error as Error)?.message ?? '')}
          </div>
        )}
        {!isLoading && !isError && !items.length && (
          <div className="text-xs text-slate-400 py-6 text-center">
            Chưa có thay đổi nào được ghi nhận cho chuyến này.
          </div>
        )}
        {!!items.length && (
          <ol className="space-y-2">
            {items.map(ev => {
              const src = SOURCE_LABEL[ev.source] ?? SOURCE_LABEL.SYSTEM
              return (
                <li key={ev.id} className={`rounded-lg border px-3 py-2 ${WARN_EVENTS.has(ev.event_type) ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${src.cls}`}>{src.text}</span>
                    <span className="text-[10px] text-slate-500 tabular-nums">
                      {formatTimestampDate(ev.created_at)} {formatTimestampTime(ev.created_at)}
                    </span>
                    {ev.actor && <span className="text-[10px] text-slate-600 font-medium">· {ev.actor}</span>}
                    {ev.do_number && <span className="text-[10px] font-mono text-slate-500">· DO {ev.do_number}</span>}
                    {ev.material_code && <span className="text-[10px] font-mono text-slate-500">· {ev.material_code}</span>}
                  </div>
                  <div className="text-xs text-slate-700 mt-1">{ev.detail}</div>
                  {(ev.old_value || ev.new_value) && (
                    <div className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
                      {ev.old_value ?? '—'} <span className="text-slate-400">→</span> {ev.new_value ?? '—'}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </ModalOverlay>
  )
}
