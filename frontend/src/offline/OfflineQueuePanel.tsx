import { useState } from 'react'
import { CloudOff, RefreshCw, Trash2, CheckCircle2, XCircle, Clock3, X } from 'lucide-react'
import { useScanQueue, processScanQueue, removeQueued, retryQueued, clearDoneQueued } from './scanQueue'
import { useOnline } from './useOnline'
import { formatTimestampTime } from '@/utils/formatters'

// Badge nổi (mọi trang) + panel hàng đợi quét offline: chờ / đã lên / bị từ chối.
// Bài học AppSheet: hàng đợi phải NHÌN THẤY ĐƯỢC — user luôn biết còn gì chưa lên,
// dòng nào bị từ chối vì sao, không có sync âm thầm.
export function OfflineQueuePanel() {
  const items = useScanQueue(s => s.items)
  const replaying = useScanQueue(s => s.replaying)
  const online = useOnline()
  const [open, setOpen] = useState(false)

  const pending = items.filter(i => i.status === 'pending')
  const rejected = items.filter(i => i.status === 'rejected')
  const done = items.filter(i => i.status === 'done')

  if (!items.length) return null

  return (
    <>
      {/* Badge nổi — trên BottomNav mobile, góc phải */}
      <button
        onClick={() => setOpen(true)}
        className={`fixed right-3 bottom-20 lg:bottom-4 z-[55] flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-semibold text-white shadow-lg
          ${rejected.length ? 'bg-red-600' : pending.length ? 'bg-amber-500' : 'bg-green-600'}`}
      >
        <CloudOff className="h-3.5 w-3.5" />
        {pending.length > 0 && <span>{pending.length} chờ</span>}
        {rejected.length > 0 && <span>· {rejected.length} lỗi</span>}
        {pending.length === 0 && rejected.length === 0 && <span>Đã đồng bộ</span>}
        {replaying && <RefreshCw className="h-3 w-3 animate-spin" />}
      </button>

      {open && (
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
      )}
    </>
  )
}
