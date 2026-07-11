import { create } from 'zustand'
import { CloudOff, RefreshCw, Trash2, CheckCircle2, XCircle, Clock3, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useScanQueue, processScanQueue, removeQueued, retryQueued, clearDoneQueued } from './scanQueue'
import { useOnline } from './useOnline'
import { formatTimestampTime } from '@/utils/formatters'

// Hàng đợi quét offline — nút chỉ báo đặt ở HEADER (cạnh chuông thông báo, theo yêu cầu
// user 12/07) + panel danh sách chờ/đã lên/bị từ chối. Bài học AppSheet: hàng đợi phải
// NHÌN THẤY ĐƯỢC — user luôn biết còn gì chưa lên, dòng nào bị từ chối vì sao.
const useQueuePanelOpen = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

// Nút chỉ báo trên app bar (Header.tsx) — hiện khi có bất kỳ dòng nào trong hàng đợi;
// đếm đỏ = có dòng bị từ chối, amber = đang chờ mạng.
export function OfflineQueueHeaderButton() {
  const items = useScanQueue(s => s.items)
  const replaying = useScanQueue(s => s.replaying)
  const setOpen = useQueuePanelOpen(s => s.setOpen)
  const pending = items.filter(i => i.status === 'pending').length
  const rejected = items.filter(i => i.status === 'rejected').length

  if (!items.length) return null
  return (
    <Button
      variant="ghost" size="icon" title="Hàng đợi quét offline"
      className="relative text-slate-300 hover:bg-white/10 hover:text-white"
      onClick={() => setOpen(true)}
    >
      {replaying
        ? <RefreshCw className="h-5 w-5 animate-spin" />
        : <CloudOff className={`h-5 w-5 ${rejected ? 'text-red-400' : pending ? 'text-amber-400' : 'text-green-400'}`} />}
      {(pending > 0 || rejected > 0) && (
        <span className={`absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 text-[10px] font-semibold flex items-center justify-center rounded-full text-white ${rejected ? 'bg-red-500' : 'bg-amber-500'}`}>
          {pending + rejected}
        </span>
      )}
    </Button>
  )
}

export function OfflineQueuePanel() {
  const items = useScanQueue(s => s.items)
  const replaying = useScanQueue(s => s.replaying)
  const online = useOnline()
  const open = useQueuePanelOpen(s => s.open)
  const setOpen = useQueuePanelOpen(s => s.setOpen)

  const pending = items.filter(i => i.status === 'pending')
  const rejected = items.filter(i => i.status === 'rejected')
  const done = items.filter(i => i.status === 'done')

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3 shrink-0">
          <div>
            <div className="text-sm font-semibold text-slate-800">Hàng đợi quét offline</div>
            <div className="text-[11px] text-slate-500">
              {pending.length} chờ mạng · {rejected.length} bị từ chối · {done.length} đã lên
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="rounded p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        {/* Thân */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {!items.length && (
            <div className="py-8 text-center text-[12px] text-slate-400">Không có lượt quét nào trong hàng đợi.</div>
          )}
          {!online && pending.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
              Đang offline — các lượt quét sẽ tự gửi khi có mạng lại.
            </div>
          )}
          {[...rejected, ...pending, ...[...done].reverse()].map(i => (
            <div key={i.id} className={`rounded border px-2.5 py-2 text-[11px] ${
              i.status === 'rejected' ? 'border-red-200 bg-red-50'
              : i.status === 'pending' ? 'border-amber-200 bg-amber-50'
              : 'border-green-200 bg-green-50'}`}
            >
              <div className="flex items-center gap-1.5">
                {i.status === 'rejected' ? <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                  : i.status === 'pending' ? <Clock3 className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  : <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />}
                <span className="font-mono font-semibold truncate">{i.pallet_code}</span>
                <span className="ml-auto text-slate-400 whitespace-nowrap">{formatTimestampTime(i.createdAt)}</span>
              </div>
              <div className="mt-0.5 text-slate-600 truncate">
                {i.kind === 'inbound' ? 'Nhập' : 'Xuất'} · {i.label}
              </div>
              {i.reason && (
                <div className={`mt-0.5 ${i.status === 'rejected' ? 'text-red-600' : 'text-green-700'}`}>{i.reason}</div>
              )}
              {i.status === 'rejected' && (
                <div className="mt-1.5 flex gap-2">
                  <button onClick={() => retryQueued(i.id)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium hover:bg-slate-50">
                    Gửi lại
                  </button>
                  <button onClick={() => removeQueued(i.id)}
                    className="rounded border border-red-200 bg-white px-2 py-0.5 text-[10px] font-medium text-red-600 hover:bg-red-50">
                    <Trash2 className="mr-0.5 inline h-3 w-3" />Bỏ dòng này
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t px-4 py-3 shrink-0">
          <button
            onClick={() => void processScanQueue()}
            disabled={replaying || !online || pending.length === 0}
            className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50 hover:bg-blue-700"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${replaying ? 'animate-spin' : ''}`} />
            {replaying ? 'Đang gửi…' : 'Gửi ngay'}
          </button>
          {done.length > 0 && (
            <button onClick={clearDoneQueued}
              className="rounded border border-slate-300 px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
              Dọn dòng đã lên
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
