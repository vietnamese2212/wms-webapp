import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { AxiosError }              from 'axios'
import {
  ArrowLeft, Plus, CheckCircle2, XCircle, Trash2, Pencil,
  MapPin, Package, AlertTriangle, QrCode,
  Clock, Calendar, User, Bookmark,
} from 'lucide-react'
import { format, parseISO }    from 'date-fns'
import { vi }                  from 'date-fns/locale'
import { TableSkeleton }       from '@/components/shared/TableSkeleton'
import { QRScanner }           from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import { Button }              from '@/components/ui/button'
import { Input }               from '@/components/ui/input'
import { Label }               from '@/components/ui/label'
import { Card }                from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  useInboundOrder, useInboundOrders, useCancelInboundOrder,
  useScanPallet, useDeletePalletEntry, useDeletePalletEntries,
  useLocationsReal, useUpdateInboundOrder, useUpdatePalletEntry,
  useCheckInboundScan,
} from '@/api/hooks'
import { useAuthStore }            from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useActiveInboundStore }  from '@/stores/activeInboundStore'
import { inboundOrderStatusLabel, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { playBeep, unlockAudio }   from '@/utils/audio'
import type { InboundOrder, InboundOrderStatus, PalletEntry } from '@/types'

// ─── Status badge ─────────────────────────────────────────────

const statusVariant: Record<InboundOrderStatus, string> = {
  OPEN:      'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-slate-100 text-slate-600',
}
function InboundStatusBadge({ status }: { status: string }) {
  const cls = statusVariant[status as InboundOrderStatus] ?? 'bg-slate-100 text-slate-600'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {inboundOrderStatusLabel[status] ?? status}
    </span>
  )
}

// ─── Scan feedback banner ─────────────────────────────────────

type FeedbackState = { type: 'success' | 'error'; msg: string }

function ScanFeedback({ state }: { state: FeedbackState }) {
  if (state.type === 'success') {
    return (
      <div className="rounded-lg bg-green-50 border border-green-200 p-2.5 text-sm text-green-800 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>{state.msg}</span>
      </div>
    )
  }
  return (
    <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <span>{state.msg}</span>
    </div>
  )
}

// ─── QR validation ────────────────────────────────────────────

type ValidationResult =
  | { ok: true; msg: string }
  | { ok: false; msg: string }

function validateQR(raw: string, order: InboundOrder): ValidationResult {
  const parts = raw.split('_')
  if (parts.length < 6) {
    return { ok: false, msg: `Định dạng QR không hợp lệ (${parts.length} phần, cần ≥6: ddmmyy_Hàng_CK_Máy_STT_NMSX)` }
  }
  // Validate date field ddmmyy
  const datePart = parts[0] ?? ''
  if (datePart.length === 6) {
    const dd = parseInt(datePart.slice(0, 2), 10)
    const mm = parseInt(datePart.slice(2, 4), 10)
    const yy = 2000 + parseInt(datePart.slice(4, 6), 10)
    if (mm < 1 || mm > 12) {
      return { ok: false, msg: `Ngày QR không hợp lệ: tháng ${mm} không tồn tại (${datePart})` }
    }
    const d = new Date(Date.UTC(yy, mm - 1, dd))
    if (d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) {
      return { ok: false, msg: `Ngày QR không hợp lệ: ${dd}/${mm}/${datePart.slice(4)} không tồn tại` }
    }
  }
  const qrMat   = (parts[1] ?? '').trim().toUpperCase()
  const orderMat = (order.material?.material_code ?? '').trim().toUpperCase()
  if (orderMat && qrMat !== orderMat) {
    return { ok: false, msg: `Sai mã hàng — QR: "${parts[1]}", phiếu: "${order.material?.material_code}"` }
  }
  const alreadyIn = order.inventory_entries?.some(e => e.pallet_code === raw)
  if (alreadyIn) {
    return { ok: false, msg: 'Pallet này đã được nhập trong phiếu' }
  }
  return { ok: true, msg: `Hợp lệ · ${order.material?.material_code}` }
}

// ─── Scan overlay (camera stays mounted to avoid repeated permission prompts) ──

interface ScanDialogProps {
  order: InboundOrder
  onClose: () => void
  employeeId?: string
  allLocations: { id: string; location_code: string; sub_code: string; max_pallets: number; used_slots?: number; category?: string | null }[]
}

function ScanDialog({ order, onClose, employeeId, allLocations }: ScanDialogProps) {
  const scannerRef = useRef<QRScannerHandle>(null)
  const { mutate: scanPallet,  isPending: saving        } = useScanPallet()
  const { mutate: checkScan,   isPending: serverChecking } = useCheckInboundScan()

  const defaultCartons = order.material?.cartons_per_pallet?.toString() ?? '0'
  const [cartons,          setCartons]          = useState(defaultCartons)
  const [stackLayer,       setStackLayer]       = useState('1')
  const [feedback,         setFeedback]         = useState<FeedbackState | null>(null)
  const [pendingQR,        setPendingQR]        = useState<string | null>(null)
  const [validation,       setValidation]       = useState<ValidationResult | null>(null)
  const [serverCheckOk,    setServerCheckOk]    = useState(false)
  const [mergeWarning,     setMergeWarning]     = useState<string | null>(null)
  const [outboundCartons,  setOutboundCartons]  = useState<number | null>(null)

  // Đổi vị trí: activeLocationId có thể khác order.location_id khi overflow
  const [activeLocationId, setActiveLocationId] = useState<string>(order.location_id ?? '')
  const [showLocPicker,    setShowLocPicker]    = useState(!order.location_id) // NCC: mở picker ngay

  const activeLoc = allLocations.find(l => l.id === activeLocationId)

  function handleScan(raw: string) {
    if (!activeLocationId) {
      setShowLocPicker(true)
      return
    }
    playBeep()
    setPendingQR(raw)
    setFeedback(null)
    setServerCheckOk(false)

    const val = validateQR(raw, order)
    setValidation(val)
    if (!val.ok) return

    checkScan(
      { orderId: order.id, qr_code: raw, location_id: activeLocationId, stack_layer: Number(stackLayer) },
      {
        onSuccess: (data) => {
          setServerCheckOk(true)
          setCartons(String(data.suggested_cartons))
          setOutboundCartons(data.outbound_cartons ?? null)
          setMergeWarning(data.will_merge ? (data.merge_warning ?? null) : null)
        },
        onError: (err) => {
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setValidation({ ok: false, msg })
        },
      }
    )
  }

  function handleSave() {
    if (!pendingQR || !serverCheckOk || saving) return
    if (!activeLocationId) {
      setShowLocPicker(true)
      return
    }
    scanPallet(
      { orderId: order.id, qr_code: pendingQR, location_id: activeLocationId, stack_layer: Number(stackLayer), cartons_override: Number(cartons) || undefined, employee_id: employeeId },
      {
        onSuccess: (data) => {
          setPendingQR(null)
          setValidation(null)
          setServerCheckOk(false)
          setMergeWarning(null)
          setOutboundCartons(null)
          setCartons(defaultCartons)
          const successMsg = data.merged
            ? `✓ Đã cộng ${data.added_cartons} thùng · Tồn mới: ${data.new_remaining} thùng`
            : `✓ ${data.entry.pallet_code} · ${data.entry.cartons_imported} thùng · ${data.entry.location?.location_code ?? ''}`
          setFeedback({ type: 'success', msg: successMsg })
          setTimeout(() => { scannerRef.current?.resume(); setFeedback(null) }, 1500)
        },
        onError: (err) => {
          setPendingQR(null)
          setValidation(null)
          setServerCheckOk(false)
          setMergeWarning(null)
          setOutboundCartons(null)
          setCartons(defaultCartons)
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setFeedback({ type: 'error', msg })
        },
      }
    )
  }

  function dismissPending() {
    setPendingQR(null)
    setValidation(null)
    setFeedback(null)
    setServerCheckOk(false)
    setMergeWarning(null)
    setOutboundCartons(null)
    setCartons(defaultCartons)
    scannerRef.current?.resume()
  }

  const canSave = !!pendingQR && serverCheckOk && !saving && !serverChecking

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Bottom sheet */}
      <div className="relative mt-auto bg-white rounded-t-2xl max-h-[90dvh] overflow-y-auto">
        <div className="p-4 space-y-3">

          {/* Subtitle: material + active location + "Đổi vị trí" button */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500 min-w-0">
              <span className="font-medium text-slate-700">{order.material?.material_code}</span>
              {order.material?.short_name && <span className="text-slate-500"> · {order.material.short_name}</span>}
              {activeLoc && <span className="font-mono"> · {activeLoc.location_code}</span>}
              {!activeLocationId && <span className="text-amber-500"> · Chưa chọn vị trí</span>}
            </p>
            <button
              type="button"
              className="shrink-0 flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 border border-blue-200 rounded px-2 py-1"
              onClick={() => setShowLocPicker(true)}
            >
              <MapPin className="h-3 w-3" />
              {activeLocationId ? 'Đổi vị trí' : 'Chọn vị trí'}
            </button>
          </div>

          {/* Location picker dialog */}
          {showLocPicker && (
            <div className="border rounded-lg bg-slate-50 p-3 space-y-2">
              <p className="text-xs font-medium text-slate-600">Chọn vị trí{activeLocationId ? ' mới' : ''}:</p>
              <div className="max-h-36 overflow-y-auto space-y-1">
                {allLocations.map(l => {
                    const isFull    = l.max_pallets > 0 && (l.used_slots ?? 0) >= l.max_pallets
                    const isPartial = (l.used_slots ?? 0) > 0 && !isFull
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => { setActiveLocationId(l.id); setShowLocPicker(false) }}
                        className={[
                          'w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between',
                          l.id === activeLocationId
                            ? 'bg-blue-100 text-blue-700 font-medium'
                            : isFull
                            ? 'text-blue-600 hover:bg-blue-50'
                            : isPartial
                            ? 'text-amber-600 hover:bg-amber-50'
                            : 'text-slate-700 hover:bg-white',
                        ].join(' ')}
                      >
                        <span className="font-mono">{l.location_code}</span>
                        <span className="text-[10px] text-slate-400">{l.used_slots ?? 0}/{l.max_pallets}</span>
                      </button>
                    )
                  })}
              </div>
              {activeLocationId && (
                <button type="button" className="text-xs text-slate-400 hover:text-slate-600" onClick={() => setShowLocPicker(false)}>
                  Huỷ
                </button>
              )}
            </div>
          )}

          {/* Camera with floating buttons */}
          <div className="relative">
            <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} />

            {/* "Quét tiếp": shown on error */}
            {pendingQR && validation?.ok === false && (
              <button
                className="absolute left-1/2 top-[8%] -translate-x-1/2 -translate-y-1/2 z-10
                           bg-white/90 hover:bg-white text-slate-700 border border-slate-300
                           rounded-full px-4 py-1.5 text-sm font-medium shadow-lg transition-all"
                onClick={dismissPending}
              >
                Quét tiếp
              </button>
            )}

            {/* "Đang xác thực": server check in progress */}
            {serverChecking && (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                             bg-white/90 rounded-full px-4 py-2 text-sm text-slate-600 shadow-lg">
                Đang xác thực…
              </div>
            )}

            {/* "Lưu": shown when server check passed */}
            {canSave && (
              <button
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                           bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white
                           rounded-full px-6 py-2.5 text-sm font-semibold shadow-xl transition-all"
                onClick={handleSave}
              >
                {saving ? '…' : 'Lưu'}
              </button>
            )}
          </div>

          {/* Merge warning banner */}
          {mergeWarning && serverCheckOk && !feedback && (
            <div className="rounded-lg bg-amber-50 border border-amber-300 px-3 py-2.5 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-800">Cảnh báo: Pallet đang tồn kho</p>
                <p className="text-xs text-amber-700 mt-0.5">{mergeWarning}</p>
              </div>
            </div>
          )}

          {/* Validation result */}
          {pendingQR && validation && !feedback && (
            validation.ok ? (
              <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-green-800">
                    {serverChecking ? 'Đang kiểm tra vị trí…' : validation.msg}
                  </p>
                  <p className="font-mono text-[10px] text-green-500 truncate">{pendingQR}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-red-700">{validation.msg}</p>
                  <p className="font-mono text-[10px] text-red-400 truncate">{pendingQR}</p>
                </div>
              </div>
            )
          )}

          {feedback && <ScanFeedback state={feedback} />}

          {/* Close dialog */}
          <Button variant="outline" className="w-full" disabled={saving} onClick={onClose}>
            Huỷ
          </Button>

          {/* Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Số thùng / pallet</Label>
              <Input type="number" min="0" value={cartons} onChange={(e) => setCartons(e.target.value)} />
              {outboundCartons != null && (
                <p className="text-[10px] text-slate-500">Phiếu xuất: <span className="font-semibold text-slate-700">{outboundCartons}</span> thùng</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tầng chồng</Label>
              <Select value={stackLayer} onValueChange={setStackLayer}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Tầng 1 (sàn)</SelectItem>
                  <SelectItem value="2">Tầng 2</SelectItem>
                  <SelectItem value="3">Tầng 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────

export default function InboundDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const autoScan = searchParams.get('scan') === '1'

  const { data: order, isLoading, isPlaceholderData } = useInboundOrder(id)
  const { data: allLocations = [] } = useLocationsReal(
    order?.warehouse_id
      ? { warehouse_id: order.warehouse_id, ...(order.warehouse_type ? { category: order.warehouse_type } : {}) }
      : undefined
  )

  // Tab bar: tất cả phiếu OPEN của kho + ngày này (để lái xe nâng nhảy qua lại)
  const { data: openOrders = [] } = useInboundOrders(
    order?.warehouse_id && order?.import_date
      ? { warehouse_id: order.warehouse_id, date: order.import_date }
      : undefined
  )

  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null

  const { orders: pinnedOrders, pin, unpin, isPinned, update } = useActiveInboundStore()
  useEffect(() => {
    if (order) update(order.id, order.status)
  }, [order?.id, order?.status]) // eslint-disable-line

  const { mutate: cancelOrder, isPending: cancelling } = useCancelInboundOrder()
  const { mutate: deleteEntry                           } = useDeletePalletEntry()
  const { mutate: deleteEntries                         } = useDeletePalletEntries()
  const { mutate: updateOrder                           } = useUpdateInboundOrder()
  const { mutate: updateEntry, isPending: saving        } = useUpdatePalletEntry()

  const [showScan,    setShowScan]    = useState(false)
  const [editState, setEditState] = useState<{ entry: PalletEntry; cartons: number; stack: number } | null>(null)
  const [editingPlannedCartons, setEditingPlannedCartons] = useState(false)
  const [plannedCartonsInput,   setPlannedCartonsInput]   = useState('')

  // Auto-open scan khi navigate từ list với ?scan=1
  useEffect(() => {
    if (autoScan && order && order.status === 'OPEN' && order.location_id) {
      const total = (order.inventory_entries ?? []).reduce((s, e) => s + e.cartons_imported, 0)
      if (order.source_type === 'NCC' && (order.planned_cartons ?? 0) > 0 && total >= (order.planned_cartons ?? 0)) return
      unlockAudio()
      setShowScan(true)
    }
  }, [autoScan, order]) // eslint-disable-line
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<{ title: string; msg: string; onOk: () => void } | null>(null)

  function openConfirm(title: string, msg: string, onOk: () => void) {
    setConfirm({ title, msg, onOk })
  }

  const isOpen      = order?.status === 'OPEN'
  const entries     = order?.inventory_entries ?? []
  const totalScanned = entries.reduce((sum, e) => sum + e.cartons_imported, 0)
  const isNccFull   = order?.source_type === 'NCC' && (order?.planned_cartons ?? 0) > 0 && totalScanned >= (order?.planned_cartons ?? 0)

  function canDeleteEntry(entry: PalletEntry): boolean {
    if (!isOpen) return false
    if (entry.status !== 'IN_STOCK') return false
    if (can(perms, 'inbound', 'force_delete_pallet')) return true
    if (!can(perms, 'inbound', 'delete_pallet')) return false
    if (!user?.id || entry.created_by_emp?.id !== user.id) return false
    const importDate = new Date(entry.import_date ?? entry.created_at)
    return (Date.now() - importDate.getTime()) / 86_400_000 <= 2
  }

  function canEditEntry(entry: PalletEntry): boolean {
    if (!isOpen) return false
    if (entry.status !== 'IN_STOCK') return false
    if (can(perms, 'inbound', 'force_edit_pallet')) return true
    if (!can(perms, 'inbound', 'edit_pallet')) return false
    if (!user?.id || entry.created_by_emp?.id !== user.id) return false
    const importDate = new Date(entry.import_date ?? entry.created_at)
    return (Date.now() - importDate.getTime()) / 86_400_000 <= 2
  }

  function toggleAll() {
    if (entries.length > 0 && entries.every(e => selectedIds.has(e.id)))
      setSelectedIds(new Set())
    else
      setSelectedIds(new Set(entries.filter(canDeleteEntry).map(e => e.id)))
  }

  function toggleEntry(id: string) {
    setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  const allDeletableSelected = entries.filter(canDeleteEntry).length > 0 &&
    entries.filter(canDeleteEntry).every(e => selectedIds.has(e.id))

  // Auto-redirect khi phiếu không còn tồn tại (bị xóa/hủy, ghost từ cache)
  useEffect(() => {
    if (!isLoading && !isPlaceholderData && !order) {
      if (id) unpin(id)
      navigate('/wms/inbound', { replace: true })
    }
  }, [isLoading, isPlaceholderData, order, navigate, id, unpin])

  if (isLoading && !order) {
    return <div className="p-6"><TableSkeleton rows={8} cols={7} /></div>
  }

  if (!order) {
    return <div className="p-6"><TableSkeleton rows={8} cols={7} /></div>
  }

  return (
    <>
      {showScan && (
        <ScanDialog
          order={order}
          onClose={() => setShowScan(false)}
          employeeId={user?.id}
          allLocations={allLocations as any}
        />
      )}

      {/* ── Edit pallet dialog ── */}
      {editState && (
        <Dialog open onOpenChange={(v) => { if (!v) setEditState(null) }}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader>
              <DialogTitle className="text-sm">Sửa pallet <span className="font-mono">{editState.entry.pallet_code}</span></DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="space-y-1">
                <Label className="text-xs">Số thùng</Label>
                <Input
                  type="number" min={1}
                  className="h-8 text-sm"
                  value={editState.cartons}
                  onChange={(e) => setEditState(s => s && ({ ...s, cartons: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tầng chồng</Label>
                <Input
                  type="number" min={1}
                  className="h-8 text-sm"
                  value={editState.stack}
                  onChange={(e) => setEditState(s => s && ({ ...s, stack: Number(e.target.value) }))}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditState(null)}>Hủy</Button>
              <Button
                size="sm"
                disabled={saving}
                onClick={() => {
                  if (!editState) return
                  updateEntry(
                    {
                      orderId: order!.id,
                      entryId: editState.entry.id,
                      cartons_imported: editState.cartons,
                      stack_layer: editState.stack,
                      employee_id: user?.id,
                    },
                    { onSuccess: () => setEditState(null) }
                  )
                }}
              >
                {saving ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Confirm dialog ── */}
      {confirm && (
        <Dialog open onOpenChange={(v) => { if (!v) setConfirm(null) }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>{confirm.title}</DialogTitle></DialogHeader>
            <p className="text-sm text-slate-600 py-1">{confirm.msg}</p>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setConfirm(null)}>Không</Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => { confirm.onOk(); setConfirm(null) }}
              >
                Xác nhận
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <div className="flex flex-col h-full min-h-0">

        {/* ── "Đang làm" quick-switch bar ── */}
        {pinnedOrders.length > 0 && (
          <div className="shrink-0 border-b bg-amber-50/60 px-2 py-1">
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-[9px] text-amber-600 font-medium shrink-0">Đang làm:</span>
              {pinnedOrders.map(o => {
                const isCurrent = o.id === id
                const barLabel = (o.location_code || o.mat_code)
                  ? `${o.location_code ?? '—'}_${o.mat_code?.slice(-3) ?? '—'}`
                  : o.import_code
                return (
                  <button key={o.id}
                    onClick={() => !isCurrent && navigate(`/wms/inbound/${o.id}`)}
                    className={[
                      'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors',
                      isCurrent
                        ? 'bg-amber-100 text-amber-800 border-amber-300 font-semibold cursor-default'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-amber-50 cursor-pointer',
                    ].join(' ')}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      o.status === 'OPEN'        ? 'bg-amber-500'
                      : o.status === 'COMPLETED' ? 'bg-blue-500'
                      : 'bg-slate-400'
                    }`} />
                    {barLabel}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Tab bar (nhảy qua lại giữa các phiếu đang mở) ── */}
        {openOrders.length > 1 && (
          <div className="flex flex-wrap shrink-0 border-b bg-slate-50 gap-0">
            {openOrders.map((o: InboundOrder) => {
              const isActive = o.id === id
              const isNCC    = (o as any).source_type === 'NCC'
              const pallets  = (o as any)._count?.inventory_entries ?? 0
              const loc       = (o as any).location?.location_code ?? '—'
              const matCode3  = o.material?.material_code?.slice(-3) ?? '—'
              const label     = `${loc}_${matCode3}`
              return (
                <button
                  key={o.id}
                  onClick={() => navigate(`/wms/inbound/${o.id}`)}
                  className={[
                    'flex items-center gap-1 px-2 py-1.5 text-[10px] border-b-2 transition-colors text-left',
                    isActive
                      ? 'border-blue-600 text-blue-700 font-semibold bg-white'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100',
                  ].join(' ')}
                >
                  {isNCC && (
                    <span className="rounded px-1 py-0.5 text-[8px] font-bold bg-green-100 text-green-700 shrink-0">NCC</span>
                  )}
                  <span>{label}</span>
                  <span className="ml-1 rounded-full bg-slate-200 text-slate-600 px-1.5 py-0.5 text-[8px] font-mono shrink-0">{pallets}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* ── Compact header (~20%) ── */}
        <div className="border-b bg-white px-4 pt-3 pb-3 shrink-0 space-y-2">

          {/* Row 1: navigation + code + status + actions */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => navigate('/wms/inbound')}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="font-semibold font-mono text-sm truncate">
                {order.import_code ?? order.id.slice(0, 8)}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => isPinned(order.id)
                  ? unpin(order.id)
                  : pin({ id: order.id, import_code: order.import_code ?? order.id.slice(0, 8), status: order.status, location_code: order.location?.location_code, mat_code: order.material?.material_code })
                }
                title={isPinned(order.id) ? 'Bỏ đánh dấu đang làm' : 'Đánh dấu đang làm'}
                className="p-1 rounded hover:bg-slate-100 transition-colors"
              >
                <Bookmark className={`h-4 w-4 transition-colors ${isPinned(order.id) ? 'fill-amber-400 text-amber-500' : 'text-slate-300 hover:text-slate-500'}`} />
              </button>
              {isOpen && can(perms, 'inbound', 'cancel') && (
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs px-2 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                  disabled={cancelling || entries.length > 0}
                  title={entries.length > 0 ? 'Xóa hết pallet trước khi hủy phiếu' : undefined}
                  onClick={() => openConfirm(
                    'Hủy phiếu nhập',
                    `Xác nhận hủy phiếu "${order.import_code ?? order.id.slice(0, 8)}"? Thao tác này không thể hoàn tác.`,
                    () => cancelOrder(order.id)
                  )}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  {cancelling ? 'Đang hủy…' : 'Hủy phiếu'}
                </Button>
              )}
            </div>
          </div>

          {/* Row 2: info chips */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="font-medium">{order.material?.material_code}</span>
              {order.material?.short_name && (
                <span className="text-slate-500 hidden sm:inline">– {order.material.short_name}</span>
              )}
            </span>

            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
              {order.location ? (
                <span className="flex items-center gap-1">
                  <span className="font-mono font-medium">{order.location.location_code}</span>
                  {isOpen && can(perms, 'inbound', 'edit') && (
                    <Select onValueChange={(v) => updateOrder({ id: order.id, location_id: v })}>
                      <SelectTrigger className="h-5 w-6 border-dashed px-1 text-slate-300 hover:text-slate-500">
                        <Pencil className="h-2.5 w-2.5" />
                      </SelectTrigger>
                      <SelectContent>
                        {(allLocations as { id: string; location_code: string }[]).map(l => (
                          <SelectItem key={l.id} value={l.id}>{l.location_code}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </span>
              ) : isOpen ? (
                <span className="text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Chưa chọn vị trí
                  <Select onValueChange={(v) => updateOrder({ id: order.id, location_id: v })}>
                    <SelectTrigger className="h-5 text-[10px] w-auto border-dashed px-1 ml-1">
                      <SelectValue placeholder="Chọn" />
                    </SelectTrigger>
                    <SelectContent>
                      {(allLocations as { id: string; location_code: string }[]).map(l => (
                        <SelectItem key={l.id} value={l.id}>{l.location_code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </span>
              ) : (
                <span className="text-slate-400">Chưa chọn</span>
              )}
            </span>

            {order.shift && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-slate-400 shrink-0" />
                {order.shift.name}
              </span>
            )}

            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3 text-slate-400 shrink-0" />
              {format(parseISO(order.import_date ?? order.created_at), 'dd-MM-yyyy', { locale: vi })}
            </span>

            <span className="flex items-center gap-1">
              <User className="h-3 w-3 text-slate-400 shrink-0" />
              {order.imported_by_emp?.name ?? order.created_by_emp?.name ?? '—'}
            </span>

            {order.gate_registration?.license_plate && (
              <span className="flex items-center gap-1">
                <span className="text-slate-400 text-[10px]">Xe:</span>
                <span className="font-mono font-semibold text-xs">{order.gate_registration.license_plate}</span>
              </span>
            )}

            {(order as any).source_type === 'TRANSFER' && (order as any).from_gdo && (() => {
              const gdo = (order as any).from_gdo
              const tms = (order as any).tms_order
              return (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 w-full mt-0.5 px-2 py-1 rounded bg-purple-50 border border-purple-100 text-[10px]">
                  <span className="font-semibold text-purple-700">Chuyển kho</span>
                  {gdo.warehouse?.name && <span className="text-slate-500">Từ: <span className="font-medium text-slate-700">{gdo.warehouse.name}</span></span>}
                  {tms?.order_code && <span className="text-slate-500">Lệnh: <span className="font-mono font-semibold text-purple-700">{tms.order_code}</span></span>}
                  {gdo.license_plate && <span className="text-slate-500">Xe: <span className="font-mono font-semibold">{gdo.license_plate}</span></span>}
                  {(gdo.delivery_codes?.length ?? 0) > 0 && <span className="text-slate-500">DO: <span className="font-mono">{gdo.delivery_codes.join(' · ')}</span></span>}
                </span>
              )
            })()}

            {(order.source_type === 'NCC' || order.source_type === 'TRANSFER') && (
              <span className="flex items-center gap-1">
                <span className="text-slate-400 text-[10px]">Thực:</span>
                <span className="font-semibold font-mono tabular-nums">{totalScanned} thùng</span>
              </span>
            )}

            {(order.source_type === 'NCC' || order.source_type === 'TRANSFER') && (
              <span className="flex items-center gap-1">
                <span className="text-slate-400 text-[10px]">KH:</span>
                {order.source_type === 'TRANSFER' ? (
                  <span className="font-semibold font-mono">
                    {order.planned_cartons != null ? `${order.planned_cartons} thùng` : <span className="text-slate-400 font-normal">—</span>}
                  </span>
                ) : editingPlannedCartons ? (
                  <span className="flex items-center gap-1">
                    <input
                      type="number" min={0}
                      value={plannedCartonsInput}
                      onChange={e => setPlannedCartonsInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          updateOrder({ id: order.id, planned_cartons: plannedCartonsInput === '' ? null : Number(plannedCartonsInput) })
                          setEditingPlannedCartons(false)
                        }
                        if (e.key === 'Escape') setEditingPlannedCartons(false)
                      }}
                      className="h-5 w-16 text-xs border border-slate-300 rounded px-1 font-mono"
                      autoFocus
                    />
                    <button
                      className="text-[10px] text-green-600 hover:text-green-700"
                      onClick={() => {
                        updateOrder({ id: order.id, planned_cartons: plannedCartonsInput === '' ? null : Number(plannedCartonsInput) })
                        setEditingPlannedCartons(false)
                      }}
                    >✓</button>
                    <button className="text-[10px] text-slate-400" onClick={() => setEditingPlannedCartons(false)}>✕</button>
                  </span>
                ) : (
                  <span
                    className={`font-semibold font-mono ${isOpen ? 'cursor-pointer hover:text-blue-600' : ''}`}
                    onClick={() => {
                      if (!isOpen) return
                      setPlannedCartonsInput(order.planned_cartons != null ? String(order.planned_cartons) : '')
                      setEditingPlannedCartons(true)
                    }}
                    title={isOpen ? 'Click để sửa SL dự kiến' : undefined}
                  >
                    {order.planned_cartons != null ? `${order.planned_cartons} thùng` : <span className="text-slate-400 font-normal">—</span>}
                    {isOpen && <Pencil className="inline h-2.5 w-2.5 ml-1 text-slate-400" />}
                  </span>
                )}
              </span>
            )}

            {order.notes && (
              <span className="text-slate-400 italic truncate max-w-[240px]">{order.notes}</span>
            )}
          </div>
        </div>

        {/* ── Pallet table (~80%) ── */}
        <div className="flex-1 p-4 overflow-auto pb-20 lg:pb-4">

          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">
              Danh sách pallet đã quét
              <span className="ml-2 text-xs font-normal text-slate-400">{entries.length} pallet</span>
              {selectedIds.size > 0 && (
                <span className="ml-1.5 text-xs text-blue-600">· {selectedIds.size} đã chọn</span>
              )}
            </h2>
            <div className="flex items-center gap-2">
              {isOpen && selectedIds.size > 0 && (
                <Button
                  size="sm" variant="outline"
                  className="h-8 gap-1.5 text-red-600 hover:bg-red-50 border-red-200"
                  onClick={() => openConfirm(
                    'Xóa pallet đã chọn',
                    `Xác nhận xóa ${selectedIds.size} pallet? Thao tác này không thể hoàn tác.`,
                    () => deleteEntries(
                      { orderId: order.id, entryIds: [...selectedIds], employeeId: user?.id },
                      { onSuccess: () => setSelectedIds(new Set()) }
                    )
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Xóa ({selectedIds.size})
                </Button>
              )}
              {isOpen && can(perms, 'inbound', 'scan') && (
                <Button
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={!order.location_id || isNccFull}
                  onClick={() => { unlockAudio(); setShowScan(true) }}
                  title={isNccFull ? `Đã nhập đủ ${order.planned_cartons} thùng theo kế hoạch` : !order.location_id ? 'Chọn vị trí trước' : undefined}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {isNccFull ? 'Đủ kế hoạch' : order.location_id ? 'Thêm pallet' : 'Chọn vị trí trước'}
                </Button>
              )}
            </div>
          </div>

          <Card>
            {isPlaceholderData ? (
              <TableSkeleton rows={5} cols={7} />
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                <QrCode className="h-10 w-10 opacity-30" />
                <p className="text-sm">Chưa có pallet nào được quét</p>
                {isOpen && can(perms, 'inbound', 'scan') && !isNccFull && (
                  <Button
                    size="sm" variant="outline"
                    disabled={!order.location_id}
                    onClick={() => { unlockAudio(); setShowScan(true) }}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Thêm pallet đầu tiên
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      {isOpen && (
                        <TableHead className="px-2 py-1.5 w-8">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-slate-300 cursor-pointer accent-blue-600"
                            checked={allDeletableSelected}
                            onChange={toggleAll}
                          />
                        </TableHead>
                      )}
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap">NSX</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Mã pallet</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-right">Thùng</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Vị trí</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Người quét</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap">Ngày</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap">Giờ</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">NMSX</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">CK</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Máy</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-right">STT</TableHead>
                      {isOpen && <TableHead className="px-1 py-1.5 w-12" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id} className={selectedIds.has(entry.id) ? 'bg-blue-50' : 'hover:bg-slate-50'}>
                        {isOpen && (
                          <TableCell className="px-2 py-1">
                            {canDeleteEntry(entry) ? (
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 rounded border-slate-300 cursor-pointer accent-blue-600"
                                checked={selectedIds.has(entry.id)}
                                onChange={() => toggleEntry(entry.id)}
                              />
                            ) : (
                              <span className="block h-3.5 w-3.5" />
                            )}
                          </TableCell>
                        )}
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500">
                          {entry.production_date
                            ? format(parseISO(entry.production_date), 'dd-MM-yy', { locale: vi })
                            : '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 font-mono font-semibold text-[10px]">
                          {entry.pallet_code}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums font-semibold">
                          {entry.cartons_imported}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] font-mono text-slate-600">
                          {entry.location?.location_code ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">
                          {entry.created_by_emp?.name ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">
                          {formatTimestampDate(entry.created_at, true)}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap tabular-nums">
                          {formatTimestampTime(entry.created_at)}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500">
                          {entry.manufacturer?.code ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500">
                          {entry.cycle ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500">
                          {entry.machine_code ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums text-slate-500">
                          {entry.pallet_sequence_no ?? '—'}
                        </TableCell>
                        {isOpen && (
                          <TableCell className="px-1 py-1">
                            <div className="flex items-center gap-0.5">
                              {canEditEntry(entry) && (
                                <button
                                  className="text-slate-400 hover:text-blue-500 transition-colors p-0.5"
                                  onClick={() => setEditState({ entry, cartons: entry.cartons_imported, stack: entry.stack_layer })}
                                  title="Sửa"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                              {canDeleteEntry(entry) && (
                                <button
                                  className="text-slate-400 hover:text-red-500 transition-colors p-0.5"
                                  onClick={() => openConfirm(
                                    'Xóa pallet',
                                    `Xác nhận xóa pallet "${entry.pallet_code}"?`,
                                    () => deleteEntry({ orderId: order.id, entryId: entry.id, employeeId: user?.id })
                                  )}
                                  title="Xóa"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
