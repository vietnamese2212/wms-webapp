import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import {
  ArrowLeft, QrCode, CheckCircle2, AlertTriangle,
  Truck, Package, ChevronDown, ChevronRight,
} from 'lucide-react'
import { Button }   from '@/components/ui/button'
import { Card }     from '@/components/ui/card'
import { QRScanner } from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import { useGDO, useScanOutboundItem, useManualCompleteItem } from '@/api/hooks'
import { playBeep, unlockAudio } from '@/utils/audio'
import type { OutboundItem, OutboundDelivery, OutboundStatus } from '@/types'

// ─── Status ────────────────────────────────────────────────────

const statusCls: Record<OutboundStatus, string> = {
  PENDING:     'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  COMPLETED:   'bg-green-100 text-green-800',
  CANCELLED:   'bg-red-100 text-red-600',
}
const statusLabel: Record<OutboundStatus, string> = {
  PENDING: 'Chờ', IN_PROGRESS: 'Đang xuất', COMPLETED: 'Xong', CANCELLED: 'Hủy',
}
function Badge({ status }: { status: string }) {
  const s = status as OutboundStatus
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusCls[s] ?? 'bg-slate-100 text-slate-600'}`}>{statusLabel[s] ?? status}</span>
}

// ─── Progress bar ──────────────────────────────────────────────

function ProgressBar({ scanned, ordered }: { scanned: number; ordered: number }) {
  const pct = ordered > 0 ? Math.min(100, (scanned / ordered) * 100) : 0
  const cls = pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-200'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs tabular-nums ${pct >= 100 ? 'text-green-700 font-semibold' : 'text-slate-500'}`}>
        {scanned}/{ordered}
      </span>
    </div>
  )
}

// ─── Scan dialog (keep-alive camera) ──────────────────────────

type FeedbackState = { type: 'success' | 'error'; msg: string } | null

interface ScanDialogProps {
  open: boolean
  item: OutboundItem | null
  gdoId: string
  onClose: () => void
}

function ScanDialog({ open, item, gdoId, onClose }: ScanDialogProps) {
  const scannerRef = useRef<QRScannerHandle>(null)
  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const { mutate: scanItem, isPending } = useScanOutboundItem()

  function handleScan(qr_code: string) {
    if (!item || isPending) return
    playBeep()
    setFeedback(null)
    scanItem(
      { gdoId, itemId: item.id, qr_code },
      {
        onSuccess: (data) => {
          setFeedback({
            type: 'success',
            msg: `✓ ${data.scan_entry.pallet_code} · ${data.scan_entry.cartons_scanned} thùng`,
          })
          setTimeout(() => { scannerRef.current?.resume(); setFeedback(null) }, 1500)
        },
        onError: (err) => {
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setFeedback({ type: 'error', msg })
        },
      }
    )
  }

  if (!item) return null

  const matName = item.material?.custom_short_name ?? item.material?.short_name ?? item.material_code_raw ?? '—'
  const remaining = Math.max(0, item.cartons_ordered - item.cartons_scanned)

  return (
    <div className={`fixed inset-0 z-50 flex flex-col ${open ? '' : 'hidden'}`} aria-hidden={!open}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative mt-auto bg-white rounded-t-2xl max-h-[90dvh] overflow-y-auto">
        <div className="p-4 space-y-3">
          {/* Item info */}
          <div>
            <p className="font-medium text-sm text-slate-800">{matName}</p>
            <p className="text-xs text-slate-500">
              {item.material?.material_code ?? item.material_code_raw}
              {' · '}còn {remaining} thùng cần xuất
            </p>
          </div>

          {/* Camera */}
          <div className="relative">
            <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} />
          </div>

          {/* Feedback */}
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
              <Button
                variant="outline" size="sm" className="w-full"
                onClick={() => { setFeedback(null); scannerRef.current?.resume() }}
              >
                Quét tiếp
              </Button>
            </div>
          )}

          <Button variant="outline" className="w-full" onClick={onClose} disabled={isPending}>
            Đóng
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Item row ──────────────────────────────────────────────────

interface ItemRowProps {
  item: OutboundItem
  gdoId: string
  onScan: (item: OutboundItem) => void
}

function ItemRow({ item, gdoId, onScan }: ItemRowProps) {
  const { mutate: manualComplete, isPending: completing } = useManualCompleteItem()
  const matName = item.material?.custom_short_name ?? item.material?.short_name ?? item.material_code_raw ?? '—'
  const isPOSM  = item.material_type === 'POSM'
  const isLoscam = (item.material_code_raw ?? '').includes('810000') || item.material_type === 'Pallet Loscam'

  return (
    <div className={`flex flex-col gap-1.5 py-2.5 px-3 border-b border-slate-100 last:border-0 ${item.status === 'COMPLETED' ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-xs text-slate-500">{item.material?.material_code ?? item.material_code_raw}</span>
            {item.material_type && item.material_type !== 'Thành phẩm' && (
              <span className="text-[10px] bg-slate-100 text-slate-600 rounded px-1">{item.material_type}</span>
            )}
            <Badge status={item.status} />
          </div>
          <p className="text-sm font-medium text-slate-800 truncate">{matName}</p>
          <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
            <span>{item.cartons_ordered} thùng</span>
            {item.boxes_display > 0 && <span>{item.boxes_display} hộp</span>}
            {item.pallets_estimated > 0 && <span>{item.pallets_estimated} pallet</span>}
            {item.weight && <span>{item.weight} kg</span>}
          </div>
        </div>

        {/* Action */}
        {item.status !== 'COMPLETED' && (
          <>
            {isPOSM ? (
              <span className="text-xs text-slate-400 italic shrink-0">Tự bypass</span>
            ) : isLoscam ? (
              <Button
                size="sm" variant="outline"
                className="h-7 text-xs shrink-0"
                disabled={completing}
                onClick={() => manualComplete({ gdoId, itemId: item.id })}
              >
                {completing ? '…' : 'Xác nhận'}
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 text-xs gap-1 shrink-0"
                onClick={() => onScan(item)}
              >
                <QrCode className="h-3.5 w-3.5" /> Quét
              </Button>
            )}
          </>
        )}
        {item.status === 'COMPLETED' && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-1" />}
      </div>

      {!isPOSM && <ProgressBar scanned={item.cartons_scanned} ordered={item.cartons_ordered} />}
    </div>
  )
}

// ─── DO section ────────────────────────────────────────────────

function DOSection({ doRecord, gdoId, onScan }: {
  doRecord: OutboundDelivery; gdoId: string; onScan: (item: OutboundItem) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const total   = doRecord.items.reduce((s, i) => s + i.cartons_ordered, 0)
  const scanned = doRecord.items.reduce((s, i) => s + i.cartons_scanned, 0)

  return (
    <Card className="rounded-xl border border-slate-200 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
          <span className="font-mono text-sm font-medium">{doRecord.delivery_code}</span>
          {doRecord.distributor_name && <span className="text-xs text-slate-500 truncate">— {doRecord.distributor_name}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-slate-500 tabular-nums">{scanned}/{total} thùng</span>
          <Badge status={doRecord.status} />
        </div>
      </button>

      {expanded && (
        <div>
          {doRecord.items.map(item => (
            <ItemRow key={item.id} item={item} gdoId={gdoId} onScan={onScan} />
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── Main page ─────────────────────────────────────────────────

export default function OutboundDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: gdo, isLoading } = useGDO(id)

  const [hasOpenedScan, setHasOpenedScan] = useState(false)
  const [showScan,      setShowScan]      = useState(false)
  const [activeItem,    setActiveItem]    = useState<OutboundItem | null>(null)

  function openScan(item: OutboundItem) {
    unlockAudio()
    setActiveItem(item)
    setHasOpenedScan(true)
    setShowScan(true)
  }

  if (isLoading || !gdo) {
    return (
      <div className="p-4 space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-slate-100 animate-pulse" />)}
      </div>
    )
  }

  const allDOs = gdo.delivery_orders ?? []
  const totalOrdered = allDOs.flatMap(d => d.items).reduce((s, i) => s + i.cartons_ordered, 0)
  const totalScanned = allDOs.flatMap(d => d.items).reduce((s, i) => s + i.cartons_scanned, 0)

  return (
    <>
      {/* Scan dialog — mount once, CSS hidden */}
      {hasOpenedScan && (
        <ScanDialog
          open={showScan}
          item={activeItem}
          gdoId={id!}
          onClose={() => setShowScan(false)}
        />
      )}

      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="border-b bg-white px-4 pt-3 pb-3 shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/wms/outbound')} className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="font-semibold font-mono text-sm">{gdo.group_code}</span>
            <Badge status={gdo.status} />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
            <span className="flex items-center gap-1">
              <Truck className="h-3 w-3 text-slate-400" />
              {format(parseISO(gdo.delivery_date), 'dd/MM/yyyy', { locale: vi })}
              {gdo.delivery_date !== gdo.planned_date && (
                <span className="text-amber-600 ml-1">(KH: {format(parseISO(gdo.planned_date), 'dd/MM')})</span>
              )}
            </span>
            {gdo.dvvt && <span>{gdo.dvvt}</span>}
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3 text-slate-400" />
              {totalScanned}/{totalOrdered} thùng
            </span>
          </div>

          {/* Overall progress */}
          <ProgressBar scanned={totalScanned} ordered={totalOrdered} />
        </div>

        {/* DO list */}
        <div className="flex-1 overflow-auto p-4 pb-20 lg:pb-4 space-y-3">
          {allDOs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
              <Package className="h-10 w-10 opacity-30" />
              <p className="text-sm">Chưa có DO nào</p>
            </div>
          ) : (
            allDOs.map(doRecord => (
              <DOSection key={doRecord.id} doRecord={doRecord} gdoId={id!} onScan={openScan} />
            ))
          )}
        </div>
      </div>
    </>
  )
}
