import { useRef, useState, useMemo, useEffect } from 'react'
import { QrCode, CheckCircle2, AlertTriangle, Package, Scissors } from 'lucide-react'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { QRScanner } from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import { useLoosePickingItems, useScanLoosePickingItem, useWarehouses, type LoosePickingItem } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { playBeep, unlockAudio } from '@/utils/audio'
import { formatDate } from '@/utils/formatters'

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

type FeedbackState = { type: 'success' | 'error'; msg: string } | null

// ─── Scan dialog ──────────────────────────────────────────────

interface ScanDialogProps {
  item: LoosePickingItem
  onClose: () => void
}

function ScanDialog({ item, onClose }: ScanDialogProps) {
  const scannerRef = useRef<QRScannerHandle>(null)
  const [feedback,       setFeedback]       = useState<FeedbackState>(null)
  const [pendingQR,      setPendingQR]      = useState<string | null>(null)
  const [pendingCartons, setPendingCartons] = useState(1)
  const { mutate: scan, isPending } = useScanLoosePickingItem()

  const matName   = item.material?.short_name ?? item.material_code_raw ?? '—'
  const looseDone = Math.min(item.cartons_scanned, item.loose_picking)
  const remaining = Math.max(0, item.loose_picking - looseDone)

  function handleScan(qr_code: string) {
    playBeep()
    setPendingQR(qr_code)
    setPendingCartons(remaining > 0 ? remaining : 1)
    setFeedback(null)
  }

  function handleSave() {
    if (!pendingQR || isPending || !item.gdo) return
    scan(
      { gdoId: item.gdo.id, itemId: item.id, qr_code: pendingQR, cartons_override: pendingCartons },
      {
        onSuccess: (data: any) => {
          setPendingQR(null)
          setFeedback({ type: 'success', msg: `✓ ${data.scan_entry.pallet_code} · ${data.scan_entry.cartons_scanned} thùng` })
          setTimeout(() => { scannerRef.current?.resume(); setFeedback(null) }, 1500)
        },
        onError: (err) => {
          setPendingQR(null)
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setFeedback({ type: 'error', msg })
        },
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative mt-auto bg-white rounded-t-2xl max-h-[90dvh] overflow-y-auto">
        <div className="p-4 space-y-3">
          <div>
            <p className="font-semibold text-lg text-slate-800">{matName}</p>
            <p className="text-base text-slate-500">
              {item.material?.material_code ?? item.material_code_raw}
              {' · '}còn <strong>{remaining}</strong> thùng nhặt lẻ cần chuẩn bị
            </p>
          </div>

          {item.header_text && (
            <p className="text-sm font-semibold text-red-600 leading-snug break-words border border-red-200 bg-red-50 rounded px-2 py-1.5">
              {item.header_text}
            </p>
          )}

          <div className="relative">
            <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} />

            {feedback !== null && (
              <button
                className="absolute left-1/2 top-[8%] -translate-x-1/2 -translate-y-1/2 z-10
                           bg-white/90 hover:bg-white text-slate-700 border border-slate-300
                           rounded-full px-4 py-1.5 text-sm font-medium shadow-lg transition-all"
                onClick={() => { setFeedback(null); scannerRef.current?.resume() }}
              >
                Quét tiếp
              </button>
            )}

            {pendingQR && (
              <button
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                           bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white
                           rounded-full px-6 py-2.5 text-sm font-semibold shadow-xl transition-all
                           disabled:opacity-60"
                onClick={handleSave}
                disabled={isPending}
              >
                {isPending ? '…' : 'Lưu'}
              </button>
            )}
          </div>

          {pendingQR && !feedback && (
            <div className="space-y-2">
              <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-base font-medium text-green-800">Sẵn sàng lưu</p>
                  <p className="font-mono text-[10px] text-green-500 truncate">{pendingQR}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-slate-600 shrink-0">Số thùng:</label>
                <Input
                  type="number"
                  min={1}
                  value={pendingCartons}
                  onChange={e => setPendingCartons(Math.max(1, parseInt(e.target.value) || 1))}
                  className="h-9 text-center font-semibold text-base w-24"
                />
                <span className="text-sm text-slate-400">/ {remaining} cần chuẩn bị</span>
              </div>
            </div>
          )}

          {feedback?.type === 'success' && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-2.5 text-base text-green-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />{feedback.msg}
            </div>
          )}
          {feedback?.type === 'error' && (
            <div className="space-y-2">
              <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-base text-red-700 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{feedback.msg}
              </div>
              <Button variant="outline" size="sm" className="w-full"
                onClick={() => { setFeedback(null); scannerRef.current?.resume() }}>
                Quét tiếp
              </Button>
            </div>
          )}

          <Button variant="outline" className="w-full" onClick={onClose} disabled={isPending}>Đóng</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────

export default function LoosePicking() {
  const user = useAuthStore(s => s.user)
  const [warehouseId,   setWarehouseId]   = useState<string>('')
  const [date,          setDate]          = useState<string>(TODAY)
  const [showAllDates,  setShowAllDates]  = useState(false)
  const [scanningItem,  setScanningItem]  = useState<LoosePickingItem | null>(null)

  const { data: warehouses = [] } = useWarehouses(true)

  useEffect(() => {
    if (!warehouseId && user?.warehouse_id) setWarehouseId(user.warehouse_id)
  }, [user?.warehouse_id]) // eslint-disable-line

  const { data: items = [], isLoading } = useLoosePickingItems({
    warehouse_id: warehouseId || undefined,
    date: showAllDates ? undefined : (date || undefined),
  })

  // Group by GDO, sort by delivery_date asc
  const grouped = useMemo(() => {
    const map = new Map<string, { gdo: LoosePickingItem['gdo']; items: LoosePickingItem[] }>()
    for (const item of items) {
      const key = item.gdo?.id ?? '__unknown__'
      if (!map.has(key)) map.set(key, { gdo: item.gdo, items: [] })
      map.get(key)!.items.push(item)
    }
    return [...map.values()].sort((a, b) => {
      const da = a.gdo?.delivery_date ?? ''
      const db = b.gdo?.delivery_date ?? ''
      return da.localeCompare(db)
    })
  }, [items])

  const pendingCount = items.filter(it => Math.min(it.cartons_scanned, it.loose_picking) < it.loose_picking).length

  function openScan(item: LoosePickingItem) {
    unlockAudio()
    setScanningItem(item)
  }

  return (
    <>
      {scanningItem && (
        <ScanDialog item={scanningItem} onClose={() => setScanningItem(null)} />
      )}

      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <Scissors className="h-4 w-4 text-slate-500" />
            <h1 className="text-base font-semibold text-slate-800">Nhặt lẻ</h1>
            {pendingCount > 0 && (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                {pendingCount} chưa xong
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue placeholder="Chọn kho" />
              </SelectTrigger>
              <SelectContent>
                {(warehouses as any[]).map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {!showAllDates && (
              <Input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="h-8 text-xs w-36"
              />
            )}

            <button
              onClick={() => setShowAllDates(v => !v)}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                showAllDates
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {showAllDates ? 'Tất cả ngày' : 'Theo ngày'}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto pb-20 lg:pb-4">
          {!warehouseId ? (
            <div className="flex items-center justify-center h-40 text-sm text-slate-400">
              Chọn kho để xem nhặt lẻ
            </div>
          ) : isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />)}
            </div>
          ) : grouped.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-400">
              <Scissors className="h-8 w-8 opacity-30" />
              <p className="text-sm">Không có nhặt lẻ</p>
            </div>
          ) : (
            <div className="p-3 space-y-4">
              {grouped.map(({ gdo, items: gdoItems }) => (
                <div key={gdo?.id ?? '__unknown__'}>
                  {/* GDO label */}
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="text-[10px] font-mono font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                      {gdo?.group_code ?? '—'}
                    </span>
                    {gdo?.delivery_date && (
                      <span className="text-[10px] text-slate-400">{formatDate(gdo.delivery_date)}</span>
                    )}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                      gdo?.status === 'COMPLETED'   ? 'bg-blue-100 text-blue-700'  :
                      gdo?.status === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-700' :
                      gdo?.started_at               ? 'bg-amber-100 text-amber-700' :
                                                      'bg-slate-100 text-slate-500'
                    }`}>
                      {gdo?.status === 'COMPLETED'   ? 'Hoàn thành' :
                       gdo?.status === 'IN_PROGRESS' ? 'Đang xuất'  :
                       gdo?.started_at               ? 'Đang xuất'  : 'Chờ xe'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {gdoItems.map(item => {
                      const looseDone = Math.min(item.cartons_scanned, item.loose_picking)
                      const pct       = item.loose_picking > 0
                        ? Math.min(100, (looseDone / item.loose_picking) * 100)
                        : 0
                      const isDone    = looseDone >= item.loose_picking
                      const matName   = item.material?.short_name ?? item.material_code_raw ?? '—'
                      const matCode   = item.material?.material_code ?? item.material_code_raw ?? '—'

                      return (
                        <div
                          key={item.id}
                          className={`rounded-xl border p-3 space-y-2 ${
                            isDone ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-800 leading-tight">{matName}</p>
                              <p className="text-[10px] font-mono text-slate-400 mt-0.5">{matCode}</p>
                            </div>
                            {isDone ? (
                              <span className="shrink-0 flex items-center gap-1 text-[10px] text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full font-medium">
                                <CheckCircle2 className="h-3 w-3" /> Xong
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                className="h-7 text-xs gap-1 shrink-0"
                                onClick={() => openScan(item)}
                              >
                                <QrCode className="h-3.5 w-3.5" /> Quét
                              </Button>
                            )}
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="flex items-center gap-1 text-slate-500">
                                <Package className="h-3 w-3 text-slate-400" />
                                Nhặt lẻ{' '}
                                <span className="font-semibold text-slate-700 tabular-nums">
                                  {looseDone}/{item.loose_picking}
                                </span>{' '}
                                thùng
                              </span>
                              {item.header_text && (
                                <span className="text-red-500 text-[9px] truncate max-w-[130px]">
                                  {item.header_text}
                                </span>
                              )}
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  isDone ? 'bg-blue-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-200'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
