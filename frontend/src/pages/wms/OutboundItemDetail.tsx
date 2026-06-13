import { useRef, useState, useEffect, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import {
  ArrowLeft, QrCode, CheckCircle2, AlertTriangle, Package, Trash2, Pause, ChevronDown, ChevronRight,
} from 'lucide-react'
import { Button }  from '@/components/ui/button'
import { Card }    from '@/components/ui/card'
import { Input }   from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { QRScanner } from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import { useGDO, useScanOutboundItem, useManualCompleteItem, useManualItemStock, useDeleteOutboundScanEntry, useItemInventory, useCheckOutboundScan, useConfirmLoosePickingItem, type ItemInventoryEntry, type CheckOutboundScanResult } from '@/api/hooks'
import { PalletDetailDialog } from '@/components/shared/PalletDetailDialog'
import { useAuthStore } from '@/stores/authStore'
import { useActiveVehiclesStore } from '@/stores/activeVehiclesStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { playBeep, unlockAudio } from '@/utils/audio'
import type { OutboundItem, OutboundStatus } from '@/types'

// ─── Status badge ──────────────────────────────────────────────

const statusCls: Record<OutboundStatus, string> = {
  PENDING:     'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  COMPLETED:   'bg-green-100 text-green-800',
  CANCELLED:   'bg-red-100 text-red-600',
  PAUSED:      'bg-red-100 text-red-700',
}
const statusLabel: Record<OutboundStatus, string> = {
  PENDING: 'Chờ xuất', IN_PROGRESS: 'Đang xuất', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy', PAUSED: 'Tạm dừng',
}
function Badge({ status }: { status: string }) {
  const s = status as OutboundStatus
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusCls[s] ?? 'bg-slate-100 text-slate-600'}`}>
      {statusLabel[s] ?? status}
    </span>
  )
}

function ProgressBar({ scanned, ordered, looseUnconfirmed = 0 }: { scanned: number; ordered: number; looseUnconfirmed?: number }) {
  const confirmed     = scanned - looseUnconfirmed
  const confirmedPct  = ordered > 0 ? Math.min(100, (confirmed / ordered) * 100) : 0
  const loosePct      = ordered > 0 ? Math.min(100 - confirmedPct, (looseUnconfirmed / ordered) * 100) : 0
  const totalPct      = confirmedPct + loosePct
  const confirmedCls  = totalPct >= 100 && looseUnconfirmed === 0 ? 'bg-green-500'
    : confirmedPct > 0 ? 'bg-amber-500' : ''
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden flex">
        {confirmedPct > 0 && (
          <div className={`h-full transition-all ${confirmedCls}`} style={{ width: `${confirmedPct}%` }} />
        )}
        {loosePct > 0 && (
          <div className="h-full bg-purple-500 transition-all" style={{ width: `${loosePct}%` }} />
        )}
      </div>
      <span className={`text-sm tabular-nums font-medium ${totalPct >= 100 && looseUnconfirmed === 0 ? 'text-green-700 font-semibold' : 'text-slate-600'}`}>
        {scanned}/{ordered} thùng
      </span>
    </div>
  )
}

type FeedbackState = { type: 'success' | 'error'; msg: string } | null

interface ScanDialogProps {
  item:    OutboundItem
  gdoId:   string
  onClose: () => void
}

function ScanDialog({ item, gdoId, onClose }: ScanDialogProps) {
  const scannerRef = useRef<QRScannerHandle>(null)
  const user = useAuthStore(s => s.user)
  const [feedback,       setFeedback]       = useState<FeedbackState>(null)
  const [checkResult,    setCheckResult]    = useState<CheckOutboundScanResult | null>(null)
  const [pendingCartons, setPendingCartons] = useState('')
  const { mutate: checkScan, isPending: checking } = useCheckOutboundScan()
  const { mutate: scanItem,  isPending: saving    } = useScanOutboundItem()

  const matName   = item.material?.short_name ?? item.material_code_raw ?? '—'
  const remaining = Math.max(0, item.cartons_ordered - item.cartons_scanned)

  function handleScan(qr_code: string) {
    playBeep()
    setCheckResult(null)
    setFeedback(null)
    checkScan(
      { gdoId, itemId: item.id, qr_code },
      {
        onSuccess: (data) => {
          setCheckResult(data)
          setPendingCartons(String(data.suggested_cartons > 0 ? data.suggested_cartons : 1))
        },
        onError: (err) => {
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setFeedback({ type: 'error', msg })
        },
      }
    )
  }

  function handleSave() {
    if (!checkResult || saving) return
    scanItem(
      { gdoId, itemId: item.id, qr_code: checkResult.pallet_code, cartons_override: Math.max(1, parseInt(pendingCartons) || 1), employee_id: user?.id ?? undefined },
      {
        onSuccess: (data) => {
          setCheckResult(null)
          const scannedNow = Number(data.scan_entry.cartons_scanned)
          const isNowComplete = scannedNow >= remaining
          setFeedback({ type: 'success', msg: `✓ ${data.scan_entry.pallet_code} · ${scannedNow} thùng` })
          setTimeout(() => {
            if (isNowComplete) { onClose() }
            else { scannerRef.current?.resume(); setFeedback(null) }
          }, 1500)
        },
        onError: (err) => {
          setCheckResult(null)
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setFeedback({ type: 'error', msg })
        },
      }
    )
  }

  function handleRetry() {
    setFeedback(null)
    setCheckResult(null)
    scannerRef.current?.resume()
  }

  const isSubOptimal = !!(checkResult?.production_date && checkResult?.best_available_date &&
    checkResult.production_date > checkResult.best_available_date)

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col pointer-events-auto">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative mt-auto bg-white rounded-t-2xl max-h-[90dvh] overflow-y-auto">
        <div className="p-4 space-y-3">
          <div>
            <p className="font-semibold text-lg text-slate-800">{matName}</p>
            <p className="text-sm text-slate-500">
              {item.material?.material_code ?? item.material_code_raw}
              {' · '}còn <strong>{remaining}</strong> thùng cần xuất
            </p>
          </div>

          {item.header_text && (
            <p className="text-sm font-semibold text-red-600 leading-snug break-words border border-red-200 bg-red-50 rounded px-2 py-1.5">
              {item.header_text}
            </p>
          )}

          <div className="relative">
            <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} />

            {checking && (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                             bg-white/90 rounded-full px-4 py-2 text-sm text-slate-600 shadow-lg">
                Đang kiểm tra…
              </div>
            )}

            {feedback !== null && (
              <button
                className="absolute left-1/2 top-[8%] -translate-x-1/2 -translate-y-1/2 z-10
                           bg-white/90 hover:bg-white text-slate-700 border border-slate-300
                           rounded-full px-4 py-1.5 text-sm font-medium shadow-lg transition-all"
                onClick={handleRetry}
              >
                Quét tiếp
              </button>
            )}

            {checkResult && !saving && (
              <button
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                           bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white
                           rounded-full px-6 py-2.5 text-sm font-semibold shadow-xl transition-all"
                onClick={handleSave}
              >
                Lưu {Math.max(1, parseInt(pendingCartons) || 1)} thùng
              </button>
            )}
            {saving && (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                             bg-blue-500 text-white rounded-full px-6 py-2.5 text-sm font-semibold shadow-xl opacity-70">
                …
              </div>
            )}
          </div>

          {checkResult && !feedback && (
            <div className="space-y-2">
              <div className={`rounded-lg border px-3 py-2.5 flex items-start gap-2 ${isSubOptimal ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
                <CheckCircle2 className={`h-4 w-4 shrink-0 mt-0.5 ${isSubOptimal ? 'text-orange-500' : 'text-green-600'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold font-mono ${isSubOptimal ? 'text-red-600' : 'text-green-800'}`}>
                    {checkResult.pallet_code}
                  </p>
                  {checkResult.production_date && (
                    <p className="text-[10px] text-slate-500 mt-0.5">NSX: {formatTimestampDate(checkResult.production_date)}</p>
                  )}
                  {isSubOptimal && checkResult.best_available_date && (
                    <p className="text-[10px] text-orange-600 font-medium mt-0.5">
                      ⚠ Trong kho còn NSX {formatTimestampDate(checkResult.best_available_date)} (cũ hơn — nên ưu tiên lấy trước)
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-slate-700 shrink-0">Số thùng xuất:</label>
                <Input
                  type="number"
                  min={1}
                  value={pendingCartons}
                  onChange={e => setPendingCartons(e.target.value)}
                  className="h-11 text-center font-semibold text-lg w-28"
                />
                <span className="text-sm text-slate-400">/ {remaining} cần xuất</span>
              </div>
            </div>
          )}

          {feedback?.type === 'error' && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{feedback.msg}
            </div>
          )}
          {feedback?.type === 'success' && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-2.5 text-sm text-green-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />{feedback.msg}
            </div>
          )}

          <Button variant="outline" className="w-full" onClick={onClose} disabled={saving}>Đóng</Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Confirm dialog ────────────────────────────────────────────

function ConfirmDialog({
  open, title, message, onConfirm, onCancel, loading, error,
}: {
  open: boolean; title: string; message: string
  onConfirm: () => void; onCancel: () => void; loading?: boolean; error?: string | null
}) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-600 py-1">{message}</p>
        {error && (
          <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{error}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={loading}>Không</Button>
          <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={onConfirm} disabled={loading}>
            {loading ? 'Đang xử lý…' : 'Xác nhận'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ─────────────────────────────────────────────────

export default function OutboundItemDetail() {
  const { gdoId, itemId } = useParams<{ gdoId: string; itemId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const autoScan = searchParams.get('scan') === '1'

  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const { data: gdo, isLoading } = useGDO(gdoId)
  const { mutate: manualComplete,      isPending: completing    } = useManualCompleteItem()
  const { mutate: deleteScanEntry,     isPending: deleting      } = useDeleteOutboundScanEntry()
  const { mutate: confirmLoose,        isPending: confirming    } = useConfirmLoosePickingItem()
  const { data: inventoryData = [], isLoading: invLoading } = useItemInventory(gdoId, itemId)
  const { data: stock, isLoading: loadingStock } = useManualItemStock(gdoId, itemId)
  const { vehicles } = useActiveVehiclesStore()

  const [showScan,         setShowScan]         = useState(false)
  const [confirmScanId,    setConfirmScanId]    = useState<string | null>(null)
  const [showInventory,    setShowInventory]    = useState(false)
  const [confirmLooseOpen, setConfirmLooseOpen] = useState(false)
  const [looseError,       setLooseError]       = useState<string | null>(null)
  const [expandedInvKeys,  setExpandedInvKeys]  = useState<Set<string>>(new Set())
  const [detailEntryId,    setDetailEntryId]    = useState<string | null>(null)
  const [showLoscamDialog, setShowLoscamDialog] = useState(false)
  const [loscamCartons,    setLoscamCartons]    = useState('')
  const [loscamError,      setLoscamError]      = useState('')

  // Ref để auto-open scan chỉ chạy 1 lần khi trang load lần đầu (tránh tái kích hoạt sau mỗi lần delete/confirm)
  const hasAutoScanned = useRef(false)

  useEffect(() => {
    if (!autoScan || !gdo || hasAutoScanned.current) return
    const allItems = (gdo.delivery_orders ?? []).flatMap(d => d.items)
    const currentItem = allItems.find(i => i.id === itemId)
    if (!currentItem) return
    const canScanNow = !!gdo.started_at && gdo.status !== 'PAUSED' && gdo.status !== 'COMPLETED'
    if (canScanNow && currentItem.status !== 'COMPLETED') {
      unlockAudio()
      setShowScan(true)
      hasAutoScanned.current = true
    }
  }, [autoScan, gdo]) // eslint-disable-line

  // All useMemo hooks must be above early returns (Rules of Hooks)
  const scans = gdo
    ? (gdo.delivery_orders ?? []).flatMap(d => d.items).find(i => i.id === itemId)?.scan_entries ?? []
    : []

  const looseUnconfirmedCount = scans
    .filter(s => s.is_loose_picking && !s.loose_confirmed)
    .reduce((sum, s) => sum + s.cartons_scanned, 0)

  const sortedInv = useMemo<ItemInventoryEntry[]>(() =>
    [...inventoryData].sort((a, b) => {
      if (a.pct_date === null && b.pct_date === null) return 0
      if (a.pct_date === null) return 1
      if (b.pct_date === null) return -1
      return a.pct_date - b.pct_date
    }),
    [inventoryData]
  )

  type InvAggRow = { key: string; pct_date: number | null; location_code: string | null; is_qa: boolean; cartons: number; entries: ItemInventoryEntry[] }
  const invAggRows = useMemo<InvAggRow[]>(() => {
    const map = new Map<string, InvAggRow>()
    for (const e of sortedInv) {
      const q = !!e.qa_status
      const k = `${e.pct_date ?? 'n'}|${e.location_code ?? ''}|${q}`
      const r = map.get(k)
      if (r) { r.cartons += e.available; r.entries.push(e) }
      else map.set(k, { key: k, pct_date: e.pct_date, location_code: e.location_code, is_qa: q, cartons: e.available, entries: [e] })
    }
    return [...map.values()].sort((a, b) => {
      const pa = a.pct_date ?? Infinity, pb = b.pct_date ?? Infinity
      return pa !== pb ? pa - pb : (a.is_qa ? 1 : -1)
    })
  }, [sortedInv])

  if (isLoading || !gdo) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
      </div>
    )
  }

  const allItems = (gdo.delivery_orders ?? []).flatMap(d => d.items)
  const item     = allItems.find(i => i.id === itemId)

  if (!item) {
    return (
      <div className="p-6 text-center text-slate-500">
        Không tìm thấy mã hàng.{' '}
        <Button variant="link" onClick={() => navigate(`/wms/outbound/${gdoId}`)}>Quay lại</Button>
      </div>
    )
  }

  const matName  = item.material?.short_name ?? item.material_code_raw ?? '—'
  const matCode  = item.material?.material_code ?? item.material_code_raw ?? '—'
  const isNoQr = item.material?.no_qr_tracking === true

  function toggleInv(key: string) {
    setExpandedInvKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  const isDone   = item.status === 'COMPLETED'

  // Workflow: can only scan if GDO has been started and not paused, and user has scan permission
  const isPaused = gdo.status === 'PAUSED'
  const canScan  = !!gdo.started_at && !isPaused && gdo.status !== 'COMPLETED' && can(perms, 'outbound', 'scan')
  const notStartedMsg = !gdo.started_at
    ? (!gdo.assigned_at ? 'Cần Giao đơn → Bắt đầu trước khi quét' : 'Cần Bắt đầu xuất kho trước khi quét')
    : null

  function openScan() {
    unlockAudio()
    setShowScan(true)
  }

  function handleDeleteScan() {
    if (!confirmScanId) return
    deleteScanEntry(
      { gdoId: gdoId!, itemId: item!.id, scanId: confirmScanId },
      { onSettled: () => setConfirmScanId(null) }
    )
  }

  const confirmScan = scans.find(s => s.id === confirmScanId)

  const loscamCartonNum = parseInt(loscamCartons) || 0
  const overStock = stock != null && loscamCartonNum > (stock.cartons_remaining ?? 0)
  const overPlan  = stock != null && loscamCartonNum > (stock.cartons_ordered ?? 0)

  return (
    <>
      {showScan && (
        <ScanDialog item={item} gdoId={gdoId!} onClose={() => setShowScan(false)} />
      )}

      <ConfirmDialog
        open={!!confirmScanId}
        title="Hủy pallet đã quét"
        message={confirmScan
          ? `Xác nhận hủy pallet "${confirmScan.pallet_code}" (${confirmScan.cartons_scanned} thùng)? Tồn kho sẽ được hoàn lại.`
          : ''}
        onConfirm={handleDeleteScan}
        onCancel={() => setConfirmScanId(null)}
        loading={deleting}
      />

      <ConfirmDialog
        open={confirmLooseOpen}
        title="Xác nhận nhặt lẻ"
        message={`Xác nhận đã kiểm tra ${looseUnconfirmedCount} thùng nhặt lẻ cho mã này? Tồn kho sẽ được trừ ngay.`}
        onConfirm={() => {
          setLooseError(null)
          confirmLoose(
            { gdoId: gdoId!, itemId: item.id, employee_id: user?.id ?? undefined },
            {
              onSuccess: () => setConfirmLooseOpen(false),
              onError: (err) => {
                const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi xác nhận nhặt lẻ'
                setLooseError(msg)
              },
            }
          )
        }}
        onCancel={() => { setConfirmLooseOpen(false); setLooseError(null) }}
        loading={confirming}
        error={looseError}
      />

      <Dialog open={showLoscamDialog} onOpenChange={v => { if (!v) { setShowLoscamDialog(false); setLoscamError('') } }}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle className="text-base">Lưu số lượng</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-slate-600 font-medium">{matName}</p>

            {loadingStock ? (
              <p className="text-xs text-slate-400">Đang tải tồn kho…</p>
            ) : (
              <div className="flex gap-3 bg-slate-50 rounded-lg px-3 py-2">
                <div className="flex-1 text-center">
                  <div className="text-[10px] text-slate-500 mb-0.5">Kế hoạch</div>
                  <div className="text-base font-bold tabular-nums text-slate-700">{stock?.cartons_ordered ?? item.cartons_ordered}</div>
                  <div className="text-[9px] text-slate-400">thùng</div>
                </div>
                <div className="w-px bg-slate-200" />
                <div className="flex-1 text-center">
                  <div className="text-[10px] text-slate-500 mb-0.5">Tồn khả dụng</div>
                  <div className={`text-base font-bold tabular-nums ${(stock?.cartons_remaining ?? 0) === 0 ? 'text-red-600' : 'text-green-600'}`}>{stock?.cartons_remaining ?? 0}</div>
                  <div className="text-[9px] text-slate-400">thùng</div>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs text-slate-600">Số thùng xuất</p>
              <Input
                type="number" min={0}
                value={loscamCartons}
                onChange={e => { setLoscamCartons(e.target.value); setLoscamError('') }}
                className={`text-center font-semibold text-lg h-11 ${overPlan ? 'border-red-400 focus-visible:ring-red-400' : overStock ? 'border-amber-400 focus-visible:ring-amber-400' : ''}`}
                autoFocus
              />
              {overPlan && (
                <p className="text-xs text-red-600">Vượt kế hoạch ({stock?.cartons_ordered ?? item.cartons_ordered} thùng)</p>
              )}
              {!overPlan && overStock && (
                <p className="text-xs text-amber-600">Vượt tồn khả dụng ({stock?.cartons_remaining ?? 0} thùng)</p>
              )}
            </div>

            {loscamError && <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{loscamError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowLoscamDialog(false); setLoscamError('') }} disabled={completing}>Hủy</Button>
            <Button size="sm" disabled={completing || isPaused || !gdo.started_at || (stock != null && (stock.cartons_remaining === 0 || overStock || overPlan))}
              onClick={() => {
                const c = Math.max(0, parseInt(loscamCartons) || 0)
                setLoscamError('')
                manualComplete(
                  { gdoId: gdoId!, itemId: item.id, cartons: c },
                  {
                    onSuccess: () => setShowLoscamDialog(false),
                    onError: (err) => {
                      const msg = (err as import('axios').AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message
                      setLoscamError(msg ?? 'Lỗi lưu số lượng')
                    },
                  }
                )
              }}>
              {completing ? '…' : 'Lưu'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col h-full min-h-0">

        {/* ── Header: ~30% ── */}
        <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 overflow-y-auto" style={{ maxHeight: '30vh' }}>

          {/* Row 1: back + code + status + action */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                onClick={() => navigate(`/wms/outbound/${gdoId}`)}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="font-mono font-semibold text-sm truncate">{matCode}</span>
              <Badge status={item.status} />
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setShowInventory(v => !v)}
                className={`flex items-center gap-1 h-7 px-2 rounded border text-xs font-medium transition-colors ${
                  showInventory
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
                title="Xem tồn kho trong kho"
              >
                <Package className="h-3.5 w-3.5" />
                Tồn kho{inventoryData.length > 0 ? ` (${inventoryData.length})` : ''}
              </button>
              {isNoQr ? (
                can(perms, 'outbound', 'complete') && <Button size="sm" variant="outline" className="h-7 text-xs" disabled={isPaused || !gdo.started_at}
                  onClick={() => { setLoscamCartons(String(isDone ? item.cartons_scanned : item.cartons_ordered)); setShowLoscamDialog(true) }}>
                  {isDone ? 'Sửa SL' : 'Lưu thủ công'}
                </Button>
              ) : !isDone && (canScan ? (
                <Button size="sm" className="h-7 text-xs gap-1" onClick={openScan}>
                  <QrCode className="h-3.5 w-3.5" /> Quét pallet
                </Button>
              ) : (
                <span className="text-xs text-slate-400 italic hidden sm:inline">Chưa bắt đầu</span>
              ))}
            </div>
          </div>

          {/* Row 1b: Check nhặt lẻ — hàng riêng để không che code/badge trên mobile */}
          {!!gdo.started_at && item.loose_picking > 0 && looseUnconfirmedCount > 0 && can(perms, 'outbound', 'complete') && (
            <button
              onClick={() => setConfirmLooseOpen(true)}
              disabled={confirming || isPaused}
              className="w-full flex items-center justify-center gap-1.5 h-8 px-3 rounded border text-xs font-medium transition-colors bg-purple-50 border-purple-300 text-purple-700 hover:bg-purple-100 disabled:opacity-50"
            >
              {confirming ? 'Đang xử lý…' : `Check nhặt lẻ (${looseUnconfirmedCount} thùng)`}
            </button>
          )}

          {/* Row 2: material name + progress */}
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-800 leading-tight">{matName}</p>
            <ProgressBar scanned={item.cartons_scanned} ordered={item.cartons_ordered} looseUnconfirmed={looseUnconfirmedCount} />
          </div>

          {/* Row 3: số lượng + meta nhỏ */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-700">{item.cartons_ordered}</span> thùng
              {item.boxes_display > 0 && (
                <span className="ml-1">· <span className="font-medium text-slate-700">{item.boxes_display}</span> hộp</span>
              )}
              {item.loose_picking > 0 && (
                <span className="ml-1">· nhặt lẻ <span className="font-medium text-slate-700">{item.loose_picking}</span></span>
              )}
            </span>
            {item.pallets_estimated > 0 && (
              <span><span className="font-medium text-slate-700">{item.pallets_estimated}</span> pl</span>
            )}
            {item.material_type && (
              <span className="bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{item.material_type}</span>
            )}
            {item.batch_required && (
              <span>Batch: <span className="font-medium text-slate-700">{item.batch_required}</span></span>
            )}
            {item.date_required != null && item.date_required > 0 && (
              <span>%Date: <span className="font-semibold text-amber-700">{item.date_required}%</span></span>
            )}
          </div>

          {/* Header text: hiển thị đầy đủ, cho phép wrap */}
          {item.header_text && (
            <div className="text-xs font-medium text-slate-700 bg-blue-50 border border-blue-100 rounded px-2 py-1 leading-snug">
              {item.header_text}
            </div>
          )}

          {/* PAUSED banner */}
          {isPaused && !isDone && (
            <div className="rounded bg-red-50 border border-red-200 px-2 py-1 text-xs text-red-700 flex items-center gap-1.5">
              <Pause className="h-3.5 w-3.5 shrink-0" />
              Chuyến xe đang tạm dừng — không thể quét hay chỉnh sửa
            </div>
          )}

          {/* Not-started warning */}
          {notStartedMsg && !isDone && !isPaused && (
            <div className="rounded bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {notStartedMsg}
            </div>
          )}
        </div>

        {/* ── Inventory panel (expandable) ── */}
        {showInventory && (
          <div className="border-b bg-slate-50 px-3 py-2 shrink-0 overflow-y-auto" style={{ maxHeight: '42vh' }}>
            {detailEntryId && <PalletDetailDialog entryId={detailEntryId} onClose={() => setDetailEntryId(null)} />}
            <p className="text-[9px] font-medium text-slate-500 mb-1.5">
              Tồn kho theo %Date · lấy thấp trước · {sortedInv.length} pallet
            </p>
            {invLoading ? (
              <div className="space-y-1.5">
                {[1,2,3].map(i => <div key={i} className="h-7 bg-slate-200 rounded animate-pulse" />)}
              </div>
            ) : sortedInv.length === 0 ? (
              <p className="text-xs text-slate-400 py-2 text-center">Không còn tồn kho trong kho này</p>
            ) : (
              <Table className="min-w-[320px]">
                <TableHeader>
                  <TableRow className="bg-slate-100">
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1">%Date</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1">Vị trí</TableHead>
                    <TableHead className="text-[9px] font-medium text-blue-500 px-2 py-1 text-right">Khả dụng</TableHead>
                    <TableHead className="w-5 px-1 py-1" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invAggRows.map(row => {
                    const expanded = expandedInvKeys.has(row.key)
                    return (
                      <Fragment key={row.key}>
                        <TableRow
                          className={`cursor-pointer ${row.is_qa ? 'bg-purple-50 hover:bg-purple-100' : 'hover:bg-slate-50'}`}
                          onClick={() => toggleInv(row.key)}
                        >
                          <TableCell className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              {row.pct_date !== null ? (
                                <span className={`text-xs font-bold tabular-nums ${
                                  row.pct_date <= 30 ? 'text-red-600' : row.pct_date <= 60 ? 'text-amber-600' : 'text-green-700'
                                }`}>{row.pct_date}%</span>
                              ) : <span className="text-[10px] text-slate-400">Chưa có</span>}
                              {row.is_qa && (
                                <span className="text-[9px] font-medium text-purple-700 bg-purple-100 rounded px-1.5 py-0.5">QA giữ</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="px-2 py-1.5">
                            <span className="text-[10px] font-mono text-slate-600">{row.location_code ?? '—'}</span>
                          </TableCell>
                          <TableCell className="px-2 py-1.5 text-right whitespace-nowrap">
                            <span className={`text-[10px] font-semibold tabular-nums ${row.is_qa ? 'text-purple-700' : ''}`}>{row.cartons}</span>
                            <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
                            <div className="text-[9px] text-slate-400">{row.entries.length} pl</div>
                          </TableCell>
                          <TableCell className="px-1 py-1.5 text-slate-400">
                            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          </TableCell>
                        </TableRow>
                        {expanded && row.entries.map(e => (
                          <TableRow key={e.id} className={row.is_qa ? 'bg-purple-50/60' : 'bg-slate-50'}>
                            <TableCell className="px-2 py-1 pl-6" colSpan={2}>
                              <button
                                className="font-mono text-[10px] font-semibold text-blue-600 hover:underline text-left"
                                onClick={ev => { ev.stopPropagation(); setDetailEntryId(e.id) }}
                              >
                                {e.pallet_code}
                              </button>
                            </TableCell>
                            <TableCell className="px-2 py-1 text-right whitespace-nowrap">
                              <span className="text-[10px] font-semibold tabular-nums text-blue-700">{e.available}</span>
                              <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
                            </TableCell>
                            <TableCell className="px-1 py-1" />
                          </TableRow>
                        ))}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        )}

        {/* Quick-switch bar — nằm ngoài header để không gây scroll */}
        {vehicles.length > 0 && (
          <div className="border-b bg-white px-4 py-1.5 shrink-0 flex flex-wrap items-center gap-1">
            <span className="text-[9px] text-slate-400 shrink-0">Đang làm:</span>
            {vehicles.map(v => (
              <button
                key={v.id}
                onClick={() => navigate(`/wms/outbound/${v.id}`)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap border transition-colors ${
                  v.id === gdoId
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  v.status === 'IN_PROGRESS' ? 'bg-amber-500'
                  : v.status === 'COMPLETED'  ? 'bg-green-500'
                  : v.status === 'PAUSED'     ? 'bg-red-500'
                  : 'bg-slate-300'
                }`} />
                {v.group_code}
              </button>
            ))}
          </div>
        )}

        {/* ── Scan list: ~70% ── */}
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <div className="p-3">

          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">
              Pallet đã quét
              <span className="ml-2 text-xs font-normal text-slate-400">{scans.length} pallet</span>
            </h2>
          </div>

          <Card>
            {scans.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                <QrCode className="h-10 w-10 opacity-30" />
                <p className="text-sm">Chưa có pallet nào được quét</p>
                {!isDone && !isNoQr && canScan && (
                  <Button size="sm" variant="outline" onClick={openScan}>
                    <QrCode className="h-4 w-4 mr-1" /> Quét pallet đầu tiên
                  </Button>
                )}
              </div>
            ) : (
              <Table className="min-w-[520px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500">Mã pallet</TableHead>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500 text-right">Thùng</TableHead>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500 whitespace-nowrap">Loại</TableHead>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500 whitespace-nowrap">%Date</TableHead>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500 whitespace-nowrap">Date</TableHead>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500 whitespace-nowrap">Date cũ nhất</TableHead>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500 whitespace-nowrap">Người quét</TableHead>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500 whitespace-nowrap">Thời gian quét</TableHead>
                      <TableHead className="px-1 py-1 w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scans.map(se => {
                    const isSubOptimal = !!(se.best_available_date && se.production_date && se.production_date > se.best_available_date)
                    return (
                      <TableRow key={se.id} className={se.is_loose_picking && !se.loose_confirmed ? 'bg-purple-50' : ''}>
                        <TableCell className="px-2 py-1.5">
                          <div className={`font-mono text-[10px] font-semibold ${isSubOptimal ? 'text-red-600' : 'text-slate-700'}`}>
                            {se.pallet_code}
                          </div>
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-right tabular-nums text-[10px] font-semibold">
                          {se.cartons_scanned}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 whitespace-nowrap">
                          {se.is_loose_picking ? (
                            se.loose_confirmed
                              ? <span className="text-[9px] font-medium text-green-700 bg-green-100 rounded px-1.5 py-0.5">✓ Lẻ</span>
                              : <span className="text-[9px] font-medium text-purple-700 bg-purple-100 rounded px-1.5 py-0.5">Lẻ</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 whitespace-nowrap">
                          {se.pct_date !== null ? (
                            <span className={`text-[10px] font-bold tabular-nums ${
                              se.pct_date <= 30 ? 'text-red-600' : se.pct_date <= 60 ? 'text-amber-600' : 'text-green-700'
                            }`}>{se.pct_date}%</span>
                          ) : <span className="text-[10px] text-slate-300">—</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 whitespace-nowrap">
                          <span className="text-[10px] font-mono tabular-nums text-slate-600">
                            {se.production_date ? format(parseISO(se.production_date), 'dd-MM-yyyy') : '—'}
                          </span>
                        </TableCell>
                        <TableCell className="px-2 py-1.5 whitespace-nowrap">
                          {se.best_available_date ? (
                            <span className={`text-[10px] font-mono tabular-nums ${isSubOptimal ? 'text-orange-600 font-semibold' : 'text-slate-500'}`}>
                              {isSubOptimal ? '⚠ ' : ''}{format(parseISO(se.best_available_date), 'dd-MM-yyyy')}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-2 py-1.5">
                          <span className="text-[10px] text-slate-500">{se.scanned_by_emp?.name ?? se.scanned_by ?? '—'}</span>
                        </TableCell>
                        <TableCell className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                          <div className="text-[10px] text-slate-500">{se.scanned_at ? formatTimestampDate(se.scanned_at, true) : '—'}</div>
                          <div className="text-[9px] text-slate-400">{se.scanned_at ? formatTimestampTime(se.scanned_at) : ''}</div>
                        </TableCell>
                        <TableCell className="px-1 py-2">
                          {can(perms, 'outbound', 'scan') && (
                            <button
                              className={`p-1 rounded transition-colors ${isPaused ? 'text-slate-200 cursor-not-allowed' : 'text-slate-300 hover:text-red-500 hover:bg-red-50'}`}
                              title={isPaused ? 'Chuyến đang tạm dừng' : 'Hủy pallet này'}
                              disabled={isPaused}
                              onClick={() => !isPaused && setConfirmScanId(se.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  </TableBody>
                </Table>
            )}
          </Card>
        </div>
        </div>
      </div>
    </>
  )
}
