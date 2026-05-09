import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import {
  ArrowLeft, QrCode, CheckCircle2, AlertTriangle, Package, Trash2,
} from 'lucide-react'
import { Button }  from '@/components/ui/button'
import { Card }    from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { QRScanner } from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import { useGDO, useScanOutboundItem, useManualCompleteItem, useDeleteOutboundScanEntry } from '@/api/hooks'
import { playBeep, unlockAudio } from '@/utils/audio'
import type { OutboundItem, OutboundStatus } from '@/types'

// ─── Status badge ──────────────────────────────────────────────

const statusCls: Record<OutboundStatus, string> = {
  PENDING:     'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  COMPLETED:   'bg-green-100 text-green-800',
  CANCELLED:   'bg-red-100 text-red-600',
}
const statusLabel: Record<OutboundStatus, string> = {
  PENDING: 'Chờ xuất', IN_PROGRESS: 'Đang xuất', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy',
}
function Badge({ status }: { status: string }) {
  const s = status as OutboundStatus
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusCls[s] ?? 'bg-slate-100 text-slate-600'}`}>
      {statusLabel[s] ?? status}
    </span>
  )
}

function ProgressBar({ scanned, ordered }: { scanned: number; ordered: number }) {
  const pct = ordered > 0 ? Math.min(100, (scanned / ordered) * 100) : 0
  const cls = pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-200'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm tabular-nums font-medium ${pct >= 100 ? 'text-green-700 font-semibold' : 'text-slate-600'}`}>
        {scanned}/{ordered} thùng
      </span>
    </div>
  )
}

// ─── ScanDialog (keep-alive camera) ──────────────────────────

type FeedbackState = { type: 'success' | 'error'; msg: string } | null

interface ScanDialogProps {
  open:    boolean
  item:    OutboundItem
  gdoId:   string
  onClose: () => void
}

function ScanDialog({ open, item, gdoId, onClose }: ScanDialogProps) {
  const scannerRef = useRef<QRScannerHandle>(null)
  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const { mutate: scanItem, isPending } = useScanOutboundItem()

  const matName   = item.material?.custom_short_name ?? item.material?.short_name ?? item.material_code_raw ?? '—'
  const remaining = Math.max(0, item.cartons_ordered - item.cartons_scanned)

  function handleScan(qr_code: string) {
    if (isPending) return
    playBeep()
    setFeedback(null)
    scanItem(
      { gdoId, itemId: item.id, qr_code },
      {
        onSuccess: (data) => {
          setFeedback({ type: 'success', msg: `✓ ${data.scan_entry.pallet_code} · ${data.scan_entry.cartons_scanned} thùng` })
          setTimeout(() => { scannerRef.current?.resume(); setFeedback(null) }, 1500)
        },
        onError: (err) => {
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setFeedback({ type: 'error', msg })
        },
      }
    )
  }

  return (
    <div className={`fixed inset-0 z-50 flex flex-col ${open ? '' : 'hidden'}`} aria-hidden={!open}>
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
          <div className="relative">
            <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} />
          </div>
          {feedback?.type === 'success' && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-2.5 text-sm text-green-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />{feedback.msg}
            </div>
          )}
          {feedback?.type === 'error' && (
            <div className="space-y-2">
              <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700 flex items-start gap-2">
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

// ─── Confirm dialog ────────────────────────────────────────────

function ConfirmDialog({
  open, title, message, onConfirm, onCancel, loading,
}: {
  open: boolean; title: string; message: string
  onConfirm: () => void; onCancel: () => void; loading?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-600 py-1">{message}</p>
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

  const { data: gdo, isLoading } = useGDO(gdoId)
  const { mutate: manualComplete,  isPending: completing  } = useManualCompleteItem()
  const { mutate: deleteScanEntry, isPending: deleting    } = useDeleteOutboundScanEntry()

  const [hasOpenedScan, setHasOpenedScan] = useState(false)
  const [showScan,      setShowScan]      = useState(false)
  const [confirmScanId, setConfirmScanId] = useState<string | null>(null)

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

  const matName  = item.material?.custom_short_name ?? item.material?.short_name ?? item.material_code_raw ?? '—'
  const matCode  = item.material?.material_code ?? item.material_code_raw ?? '—'
  const isPOSM   = item.material_type === 'POSM'
  const isLoscam = item.material_type === 'Pallet Loscam' || (item.material_code_raw ?? '').includes('810000')
  const isDone   = item.status === 'COMPLETED'
  const scans    = item.scan_entries ?? []

  // Workflow: can only scan if GDO has been started
  const canScan  = !!gdo.started_at
  const notStartedMsg = !gdo.started_at
    ? (!gdo.assigned_at ? 'Cần Giao đơn → Bắt đầu trước khi quét' : 'Cần Bắt đầu xuất kho trước khi quét')
    : null

  function openScan() {
    unlockAudio()
    setHasOpenedScan(true)
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

  return (
    <>
      {hasOpenedScan && (
        <ScanDialog open={showScan} item={item} gdoId={gdoId!} onClose={() => setShowScan(false)} />
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

      <div className="flex flex-col h-full min-h-0">

        {/* ── Header ── */}
        <div className="border-b bg-white px-4 pt-3 pb-3 shrink-0 space-y-2">

          {/* Row 1: back + code + status + action */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => navigate(`/wms/outbound/${gdoId}`)}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="font-mono font-semibold text-lg truncate">{matCode}</span>
              <Badge status={item.status} />
            </div>

            {!isDone && (
              <div className="shrink-0">
                {isPOSM ? (
                  <span className="text-sm text-slate-400 italic">Tự bypass</span>
                ) : isLoscam ? (
                  <Button size="sm" variant="outline" className="h-8 text-sm" disabled={completing}
                    onClick={() => manualComplete({ gdoId: gdoId!, itemId: item.id })}>
                    {completing ? '…' : 'Lưu thủ công'}
                  </Button>
                ) : canScan ? (
                  <Button size="sm" className="h-8 gap-1.5" onClick={openScan}>
                    <QrCode className="h-3.5 w-3.5" /> Quét pallet
                  </Button>
                ) : (
                  <span className="text-xs text-slate-400 italic hidden sm:inline">Chưa bắt đầu</span>
                )}
              </div>
            )}
          </div>

          {/* Row 2: material name + progress */}
          <div className="space-y-1.5">
            <p className="text-lg font-medium text-slate-800 leading-tight">{matName}</p>
            {!isPOSM && <ProgressBar scanned={item.cartons_scanned} ordered={item.cartons_ordered} />}
          </div>

          {/* Row 3: meta */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
            <span className="flex items-center gap-1">
              <Package className="h-3.5 w-3.5 text-slate-400" />
              <span className="font-medium text-slate-700">{item.cartons_ordered}</span> thùng
              {item.boxes_display > 0 && (
                <span className="ml-1">· <span className="font-medium text-slate-700">{item.boxes_display}</span> hộp</span>
              )}
            </span>
            {item.pallets_estimated > 0 && (
              <span><span className="font-medium text-slate-700">{item.pallets_estimated}</span> pallet ước tính</span>
            )}
            {item.material_type && (
              <span className="text-[11px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{item.material_type}</span>
            )}
            {item.header_text && (
              <span className="text-xs text-slate-500">Header: <span className="text-slate-700">{item.header_text}</span></span>
            )}
            {item.batch_required && (
              <span className="text-xs text-slate-500">Batch: <span className="text-slate-700">{item.batch_required}</span></span>
            )}
            {item.date_required && (
              <span className="text-xs text-slate-500">Date req: <span className="text-slate-700">{format(parseISO(item.date_required), 'dd/MM/yyyy', { locale: vi })}</span></span>
            )}
          </div>

          {/* Not-started warning */}
          {notStartedMsg && !isDone && !isPOSM && (
            <div className="rounded bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {notStartedMsg}
            </div>
          )}
        </div>

        {/* ── Scan list ── */}
        <div className="flex-1 p-4 overflow-auto pb-20 lg:pb-4">

          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">
              Pallet đã quét
              <span className="ml-2 text-xs font-normal text-slate-400">{scans.length} pallet</span>
            </h2>
            {!isDone && !isPOSM && !isLoscam && canScan && (
              <Button size="sm" className="h-8 gap-1.5" onClick={openScan}>
                <QrCode className="h-3.5 w-3.5" /> Quét pallet
              </Button>
            )}
          </div>

          <Card>
            {scans.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                <QrCode className="h-10 w-10 opacity-30" />
                <p className="text-sm">Chưa có pallet nào được quét</p>
                {!isDone && !isPOSM && !isLoscam && canScan && (
                  <Button size="sm" variant="outline" onClick={openScan}>
                    <QrCode className="h-4 w-4 mr-1" /> Quét pallet đầu tiên
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3 py-1 text-[11px]">Mã pallet</TableHead>
                      <TableHead className="px-3 py-1 text-[11px] text-right">Thùng</TableHead>
                      <TableHead className="px-3 py-1 text-[11px] hidden sm:table-cell whitespace-nowrap">Ngày</TableHead>
                      <TableHead className="px-3 py-1 text-[11px] hidden sm:table-cell whitespace-nowrap">Giờ</TableHead>
                      <TableHead className="px-1 py-1 w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scans.map(se => (
                      <TableRow key={se.id}>
                        <TableCell className="px-3 py-2 font-mono text-lg font-medium">
                          {se.pallet_code}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums text-lg font-semibold">
                          {se.cartons_scanned}
                        </TableCell>
                        <TableCell className="px-3 py-2 hidden sm:table-cell text-lg text-slate-500 whitespace-nowrap">
                          {se.scanned_at ? format(parseISO(se.scanned_at), 'dd/MM/yy', { locale: vi }) : '—'}
                        </TableCell>
                        <TableCell className="px-3 py-2 hidden sm:table-cell text-lg text-slate-500 tabular-nums">
                          {se.scanned_at ? format(parseISO(se.scanned_at), 'HH:mm', { locale: vi }) : '—'}
                        </TableCell>
                        <TableCell className="px-1 py-2">
                          <button
                            className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Hủy pallet này"
                            onClick={() => setConfirmScanId(se.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
