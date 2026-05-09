import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import {
  ArrowLeft, QrCode, CheckCircle2, AlertTriangle,
  Truck, Package, ClipboardList, Play,
} from 'lucide-react'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { Label }   from '@/components/ui/label'
import { Card }    from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { QRScanner } from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import {
  useGDO, useScanOutboundItem, useManualCompleteItem,
  useAssignGDO, useStartGDO, useWarehouseEmployees,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { playBeep, unlockAudio } from '@/utils/audio'
import type { OutboundItem, OutboundDelivery, OutboundStatus, GDO } from '@/types'

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
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusCls[s] ?? 'bg-slate-100 text-slate-600'}`}>
      {statusLabel[s] ?? status}
    </span>
  )
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

// ─── Bắt đầu dialog ───────────────────────────────────────────

interface StartDialogProps {
  open: boolean
  gdo: GDO
  onClose: () => void
}

function StartDialog({ open, gdo, onClose }: StartDialogProps) {
  const user = useAuthStore(s => s.user)
  const { data: employees = [] } = useWarehouseEmployees(gdo.warehouse_id)
  const { mutate: startGDO, isPending } = useStartGDO()
  const [err, setErr] = useState<string | null>(null)

  const allItems = (gdo.delivery_orders ?? []).flatMap(d => d.items)
  const isContainer = allItems.some(i => i.export_type?.toLowerCase().includes('cont'))

  const [form, setForm] = useState({
    license_plate:    '',
    container_number: '',
    exporter_name:    user?.name ?? '',
    loader_name:      '',
    forklift_driver_id: '',
  })

  function handleSubmit() {
    if (!form.license_plate.trim()) { setErr('Vui lòng nhập biển số xe'); return }
    setErr(null)
    startGDO(
      { id: gdo.id, ...form, forklift_driver_id: form.forklift_driver_id || undefined },
      {
        onSuccess: onClose,
        onError: (e) => {
          const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setErr(msg)
        },
      }
    )
  }

  function set(field: keyof typeof form, val: string) {
    setForm(f => ({ ...f, [field]: val }))
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Bắt đầu xuất kho</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Biển số xe *</Label>
            <Input
              className="text-lg h-10"
              placeholder="VD: 30A-12345"
              value={form.license_plate}
              onChange={e => set('license_plate', e.target.value.toUpperCase())}
            />
          </div>

          {isContainer && (
            <div className="space-y-1">
              <Label className="text-xs">Số container</Label>
              <Input
                className="text-lg h-10"
                placeholder="VD: ABCD1234567"
                value={form.container_number}
                onChange={e => set('container_number', e.target.value.toUpperCase())}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Người xuất</Label>
            <Input
              className="text-sm h-9"
              value={form.exporter_name}
              onChange={e => set('exporter_name', e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Bốc xếp</Label>
            <Input
              className="text-sm h-9"
              placeholder="Tên bốc xếp"
              value={form.loader_name}
              onChange={e => set('loader_name', e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Lái xe nâng</Label>
            <Select value={form.forklift_driver_id} onValueChange={v => set('forklift_driver_id', v)}>
              <SelectTrigger className="text-sm h-9">
                <SelectValue placeholder="Chọn lái xe nâng…" />
              </SelectTrigger>
              <SelectContent>
                {employees.map(emp => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.name} {emp.employee_code ? `(${emp.employee_code})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {err && (
            <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />{err}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Hủy</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Đang lưu…' : 'Bắt đầu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── QR Scan dialog (keep-alive camera) ───────────────────────

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

  if (!item) return null
  const matName  = item.material?.custom_short_name ?? item.material?.short_name ?? item.material_code_raw ?? '—'
  const remaining = Math.max(0, item.cartons_ordered - item.cartons_scanned)

  return (
    <div className={`fixed inset-0 z-50 flex flex-col ${open ? '' : 'hidden'}`} aria-hidden={!open}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative mt-auto bg-white rounded-t-2xl max-h-[90dvh] overflow-y-auto">
        <div className="p-4 space-y-3">
          <div>
            <p className="font-medium text-lg text-slate-800">{matName}</p>
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
              <Button variant="outline" size="sm" className="w-full" onClick={() => { setFeedback(null); scannerRef.current?.resume() }}>
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

// ─── Items table ───────────────────────────────────────────────

function ItemsTable({ doRecords, gdoId, onScan }: {
  doRecords: OutboundDelivery[]
  gdoId: string
  onScan: (item: OutboundItem) => void
}) {
  const allItems = doRecords.flatMap(d =>
    d.items.map(i => ({ ...i, delivery_code: d.delivery_code, distributor_name: d.distributor_name }))
  )

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead className="text-xs text-slate-500 w-[90px]">DO / Mã hàng</TableHead>
          <TableHead className="text-xs text-slate-500">Tên hàng</TableHead>
          <TableHead className="text-xs text-slate-500 w-[70px]">Loại</TableHead>
          <TableHead className="text-xs text-slate-500 text-right w-[90px]">Thùng</TableHead>
          <TableHead className="text-xs text-slate-500 text-right w-[70px]">Pallet</TableHead>
          <TableHead className="text-xs text-slate-500 w-[70px]">TT</TableHead>
          <TableHead className="text-xs text-slate-500 w-[80px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {allItems.map(item => (
          <ItemRow key={item.id} item={item} gdoId={gdoId} onScan={onScan} />
        ))}
      </TableBody>
    </Table>
  )
}

function ItemRow({ item, gdoId, onScan }: {
  item: OutboundItem & { delivery_code?: string; distributor_name?: string | null }
  gdoId: string
  onScan: (item: OutboundItem) => void
}) {
  const { mutate: manualComplete, isPending: completing } = useManualCompleteItem()
  const matName  = item.material?.custom_short_name ?? item.material?.short_name ?? item.material_code_raw ?? '—'
  const matCode  = item.material?.material_code ?? item.material_code_raw ?? '—'
  const isPOSM   = item.material_type === 'POSM'
  const isLoscam = item.material_type === 'Pallet Loscam' || (item.material_code_raw ?? '').includes('810000')
  const isDone   = item.status === 'COMPLETED'

  return (
    <TableRow className={isDone ? 'opacity-60' : ''}>
      <TableCell className="py-2 align-top">
        <div className="text-[11px] text-slate-400 tabular-nums">{item.delivery_code}</div>
        <div className="text-xs font-mono text-slate-600 mt-0.5">{matCode}</div>
      </TableCell>
      <TableCell className="py-2 align-top">
        <div className="text-lg font-medium text-slate-800 leading-tight">{matName}</div>
        {!isPOSM && (
          <ProgressBar scanned={item.cartons_scanned} ordered={item.cartons_ordered} />
        )}
      </TableCell>
      <TableCell className="py-2 align-top">
        {item.material_type && (
          <span className="text-[10px] bg-slate-100 text-slate-600 rounded px-1 py-0.5">{item.material_type}</span>
        )}
      </TableCell>
      <TableCell className="py-2 align-top text-right">
        <span className="text-lg font-semibold tabular-nums">{item.cartons_ordered}</span>
        {item.boxes_display > 0 && <div className="text-xs text-slate-400">{item.boxes_display} hộp</div>}
      </TableCell>
      <TableCell className="py-2 align-top text-right">
        {item.pallets_estimated > 0 && (
          <span className="text-lg tabular-nums">{item.pallets_estimated}</span>
        )}
      </TableCell>
      <TableCell className="py-2 align-top">
        {isDone ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <Badge status={item.status} />
        )}
      </TableCell>
      <TableCell className="py-2 align-top">
        {!isDone && (
          <>
            {isPOSM ? (
              <span className="text-xs text-slate-400 italic">Tự bypass</span>
            ) : isLoscam ? (
              <Button size="sm" variant="outline" className="h-8 text-sm px-3" disabled={completing}
                onClick={() => manualComplete({ gdoId, itemId: item.id })}>
                {completing ? '…' : 'Lưu'}
              </Button>
            ) : (
              <Button size="sm" className="h-8 text-sm px-3 gap-1" onClick={() => onScan(item)}>
                <QrCode className="h-3.5 w-3.5" />Quét
              </Button>
            )}
          </>
        )}
      </TableCell>
    </TableRow>
  )
}

// ─── Main page ─────────────────────────────────────────────────

export default function OutboundDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)

  const { data: gdo, isLoading } = useGDO(id)
  const { mutate: assignGDO, isPending: assigning } = useAssignGDO()

  const [showStart,      setShowStart]      = useState(false)
  const [hasOpenedScan,  setHasOpenedScan]  = useState(false)
  const [showScan,       setShowScan]       = useState(false)
  const [activeItem,     setActiveItem]     = useState<OutboundItem | null>(null)

  function openScan(item: OutboundItem) {
    unlockAudio()
    setActiveItem(item)
    setHasOpenedScan(true)
    setShowScan(true)
  }

  if (isLoading || !gdo) {
    return (
      <div className="p-4 space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
      </div>
    )
  }

  const allDOs     = gdo.delivery_orders ?? []
  const allItems   = allDOs.flatMap(d => d.items)
  const countable  = allItems.filter(i =>
    i.material_type !== 'POSM' && i.material_type !== 'Pallet Loscam' && !(i.material_code_raw ?? '').includes('810000')
  )
  const totalOrdered = countable.reduce((s, i) => s + i.cartons_ordered, 0)
  const totalScanned = countable.reduce((s, i) => s + i.cartons_scanned, 0)

  const npp = [...new Set(allDOs.map(d => d.distributor_name).filter(Boolean))].join(', ')

  return (
    <>
      {/* Bắt đầu dialog */}
      {showStart && (
        <StartDialog open={showStart} gdo={gdo} onClose={() => setShowStart(false)} />
      )}

      {/* QR Scan (keep-alive) */}
      {hasOpenedScan && (
        <ScanDialog open={showScan} item={activeItem} gdoId={id!} onClose={() => setShowScan(false)} />
      )}

      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="border-b bg-white px-4 pt-3 pb-3 shrink-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={() => navigate('/wms/outbound')} className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="font-mono font-semibold text-lg">{gdo.group_code}</span>
              <Badge status={gdo.status} />
            </div>
            {/* Workflow buttons */}
            <div className="flex items-center gap-2 shrink-0">
              {!gdo.assigned_at && (
                <Button size="sm" variant="outline" className="h-8 text-sm gap-1" disabled={assigning}
                  onClick={() => assignGDO({ id: gdo.id, assigned_by: user?.name ?? undefined })}>
                  <ClipboardList className="h-3.5 w-3.5" />
                  {assigning ? '…' : 'Giao đơn'}
                </Button>
              )}
              {!gdo.started_at && (
                <Button size="sm" className="h-8 text-sm gap-1" onClick={() => setShowStart(true)}>
                  <Play className="h-3.5 w-3.5" />
                  Bắt đầu
                </Button>
              )}
            </div>
          </div>

          {/* GDO info row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            <span className="flex items-center gap-1">
              <Truck className="h-3.5 w-3.5 text-slate-400" />
              <span className="font-medium">
                {format(parseISO(gdo.delivery_date), 'dd/MM/yyyy', { locale: vi })}
              </span>
              {gdo.delivery_date !== gdo.planned_date && (
                <span className="text-amber-600 text-xs ml-1">(KH: {format(parseISO(gdo.planned_date), 'dd/MM')})</span>
              )}
            </span>
            {gdo.dvvt && <span>{gdo.dvvt}</span>}
            {npp && <span className="text-slate-500">{npp}</span>}
            <span className="flex items-center gap-1">
              <Package className="h-3.5 w-3.5 text-slate-400" />
              {totalScanned}/{totalOrdered} thùng
            </span>
          </div>

          {/* Start info (shown after Bắt đầu) */}
          {gdo.started_at && (
            <Card className="px-3 py-2 bg-blue-50 border-blue-200 text-sm">
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-slate-700">
                <span><strong>Biển số:</strong> {gdo.license_plate}</span>
                {gdo.container_number && <span><strong>Cont:</strong> {gdo.container_number}</span>}
                {gdo.exporter_name   && <span><strong>Người xuất:</strong> {gdo.exporter_name}</span>}
                {gdo.loader_name     && <span><strong>Bốc xếp:</strong> {gdo.loader_name}</span>}
                <span className="text-slate-500 text-xs">
                  Bắt đầu: {format(parseISO(gdo.started_at), 'HH:mm dd/MM', { locale: vi })}
                </span>
              </div>
            </Card>
          )}

          {/* Assigned info */}
          {gdo.assigned_at && !gdo.started_at && (
            <div className="text-xs text-slate-400">
              Giao đơn: {gdo.assigned_by ?? '—'} lúc {format(parseISO(gdo.assigned_at), 'HH:mm dd/MM', { locale: vi })}
            </div>
          )}

          {/* Overall progress */}
          <ProgressBar scanned={totalScanned} ordered={totalOrdered} />
        </div>

        {/* Items table */}
        <div className="flex-1 overflow-auto pb-20 lg:pb-4">
          {allDOs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
              <Package className="h-10 w-10 opacity-30" />
              <p className="text-sm">Chưa có DO nào</p>
            </div>
          ) : (
            <ItemsTable doRecords={allDOs} gdoId={id!} onScan={openScan} />
          )}
        </div>
      </div>
    </>
  )
}
