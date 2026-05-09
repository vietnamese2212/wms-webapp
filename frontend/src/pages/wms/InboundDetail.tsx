import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate }       from 'react-router-dom'
import type { AxiosError }              from 'axios'
import {
  ArrowLeft, Plus, CheckCircle2, XCircle, Trash2,
  MapPin, Package, AlertTriangle, Pencil, QrCode,
  Clock, Calendar, User,
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
  useInboundOrder, useCompleteInboundOrder, useCancelInboundOrder,
  useScanPallet, useDeletePalletEntry, useUpdatePalletEntry,
  useLocationsReal, useUpdateInboundOrder,
} from '@/api/hooks'
import { inboundOrderStatusLabel } from '@/utils/formatters'
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

// ─── QR parsing ───────────────────────────────────────────────

type ParsedQR =
  | { valid: true; matCode: string; cycle: string; machine: string; seqNo: number | null; manufacturer: string | null; productionDate: Date | null }
  | { valid: false; error: string }

function parseQR(raw: string): ParsedQR {
  const parts = raw.split('_')
  if (parts.length < 5) {
    return { valid: false, error: `Định dạng không đúng (${parts.length} phần, cần ≥5)` }
  }
  const [datePart, matCode, cycle, machine, seqStr, manufacturer] = parts
  let productionDate: Date | null = null
  if (datePart?.length === 6) {
    const d = new Date(`20${datePart.slice(4)}-${datePart.slice(2, 4)}-${datePart.slice(0, 2)}`)
    if (!isNaN(d.getTime())) productionDate = d
  }
  const seqNo = parseInt(seqStr ?? '', 10)
  return {
    valid: true,
    matCode: matCode ?? '',
    cycle: cycle ?? '',
    machine: machine ?? '',
    seqNo: isNaN(seqNo) ? null : seqNo,
    manufacturer: manufacturer ?? null,
    productionDate,
  }
}

// ─── Scan dialog (embedded QR camera + sticky settings) ───────

interface ScanDialogProps {
  order: InboundOrder
  open: boolean
  onClose: () => void
}

function ScanDialog({ order, open, onClose }: ScanDialogProps) {
  const scannerRef = useRef<QRScannerHandle>(null)
  const { mutate: scanPallet, isPending } = useScanPallet()

  const defaultCartons = order.material?.cartons_per_pallet?.toString() ?? '0'
  const [cartons,    setCartons]    = useState(defaultCartons)
  const [stackLayer, setStackLayer] = useState('1')
  const [feedback,   setFeedback]   = useState<FeedbackState | null>(null)
  const [pendingQR,  setPendingQR]  = useState<string | null>(null)
  const [parsedQR,   setParsedQR]   = useState<ParsedQR | null>(null)

  useEffect(() => {
    if (open) {
      setFeedback(null)
      setPendingQR(null)
      setParsedQR(null)
      setCartons(order.material?.cartons_per_pallet?.toString() ?? '0')
      setStackLayer('1')
    }
  }, [open, order.material?.cartons_per_pallet])

  function handleScan(raw: string) {
    playBeep()
    setPendingQR(raw)
    setParsedQR(parseQR(raw))
    setFeedback(null)
  }

  function handleSave() {
    if (!pendingQR || !parsedQR?.valid) return
    const locationId = order.location_id
    if (!locationId) {
      setFeedback({ type: 'error', msg: 'Chưa chọn vị trí. Đóng dialog và chọn vị trí trước.' })
      return
    }

    scanPallet(
      {
        orderId:          order.id,
        qr_code:          pendingQR,
        location_id:      locationId,
        stack_layer:      Number(stackLayer),
        cartons_override: Number(cartons) || undefined,
      },
      {
        onSuccess: (data) => {
          setPendingQR(null)
          setParsedQR(null)
          setFeedback({
            type: 'success',
            msg: `✓ ${data.entry.pallet_code} · ${data.entry.cartons_imported} thùng · ${data.entry.location?.location_code ?? ''}`,
          })
          setTimeout(() => {
            scannerRef.current?.resume()
            setFeedback(null)
          }, 1500)
        },
        onError: (err) => {
          setPendingQR(null)
          setParsedQR(null)
          const msg = (err as AxiosError<{ error: { message: string } }>)
            ?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setFeedback({ type: 'error', msg })
        },
      }
    )
  }

  function handleCancel() {
    if (pendingQR) {
      setPendingQR(null)
      setParsedQR(null)
      setFeedback(null)
      scannerRef.current?.resume()
    } else {
      onClose()
    }
  }

  const canSave = !!pendingQR && parsedQR?.valid === true && !isPending

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md p-4">
        <DialogHeader className="pb-1">
          <DialogTitle className="text-base">Quét QR pallet</DialogTitle>
          <p className="text-xs text-slate-500">
            {order.material?.material_code}
            {order.location && <> · <span className="font-mono">{order.location.location_code}</span></>}
          </p>
        </DialogHeader>

        <div className="space-y-3">
          <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} />

          {/* Immediate QR parse result — shown right after scan */}
          {pendingQR && parsedQR && !feedback && (
            parsedQR.valid ? (
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 space-y-1">
                <p className="font-mono text-xs text-blue-800 break-all">{pendingQR}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-blue-600">
                  {parsedQR.productionDate && <span>NSX: {format(parsedQR.productionDate, 'dd/MM/yy')}</span>}
                  {parsedQR.cycle && <span>CK: {parsedQR.cycle}</span>}
                  {parsedQR.machine && <span>Máy: {parsedQR.machine}</span>}
                  {parsedQR.seqNo != null && <span>STT: {parsedQR.seqNo}</span>}
                  {parsedQR.manufacturer && <span>NMSX: {parsedQR.manufacturer}</span>}
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <p className="text-xs text-red-700 flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {parsedQR.error}
                </p>
                <p className="font-mono text-[10px] text-red-400 break-all mt-1">{pendingQR}</p>
              </div>
            )
          )}

          {feedback && <ScanFeedback state={feedback} />}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Số thùng / pallet</Label>
              <Input
                type="number" min="0"
                value={cartons}
                onChange={(e) => setCartons(e.target.value)}
              />
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

          {/* Save + Cancel — where Upload button was */}
          <div className="flex gap-2">
            <Button className="flex-1" disabled={!canSave} onClick={handleSave}>
              {isPending ? 'Đang lưu...' : 'Lưu pallet'}
            </Button>
            <Button variant="outline" disabled={isPending} onClick={handleCancel}>
              Huỷ
            </Button>
          </div>

          <p className="text-[10px] text-slate-400 text-center">
            Định dạng: <span className="font-mono">ddmmyy_Mã_CK_Máy_STT_NMSX</span>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit order dialog ────────────────────────────────────────

interface EditOrderDialogProps {
  order: InboundOrder
  locations: { id: string; location_code: string }[]
  open: boolean
  onClose: () => void
}

function EditOrderDialog({ order, locations, open, onClose }: EditOrderDialogProps) {
  const [locationId, setLocationId] = useState(order.location_id ?? '')
  const [notes,      setNotes]      = useState(order.notes ?? '')

  const { mutate: updateOrder, isPending, error } = useUpdateInboundOrder()

  function handleSubmit() {
    updateOrder(
      { id: order.id, location_id: locationId || undefined, notes: notes || undefined },
      { onSuccess: onClose },
    )
  }

  const apiError = (error as AxiosError<{ error: { message: string } }>)
    ?.response?.data?.error?.message

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Sửa thông tin phiếu</DialogTitle></DialogHeader>

        <div className="space-y-4 py-2">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {apiError}
            </div>
          )}
          <div className="space-y-2">
            <Label>Vị trí nhập kho</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue placeholder="Chọn vị trí" /></SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.location_code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Ghi chú</Label>
            <Input
              placeholder="Không có ghi chú"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit entry dialog ────────────────────────────────────────

interface EditEntryDialogProps {
  orderId: string
  entry: PalletEntry
  open: boolean
  onClose: () => void
}

function EditEntryDialog({ orderId, entry, open, onClose }: EditEntryDialogProps) {
  const [cartons,    setCartons]    = useState(entry.cartons_imported.toString())
  const [stackLayer, setStackLayer] = useState(entry.stack_layer.toString())

  const { mutate: updateEntry, isPending, error } = useUpdatePalletEntry()

  function handleSubmit() {
    updateEntry(
      { orderId, entryId: entry.id, cartons_imported: Number(cartons), stack_layer: Number(stackLayer) },
      { onSuccess: onClose },
    )
  }

  const apiError = (error as AxiosError<{ error: { message: string } }>)
    ?.response?.data?.error?.message

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Sửa pallet</DialogTitle></DialogHeader>

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 font-mono mb-2">
          {entry.pallet_code}
        </div>

        <div className="space-y-4">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {apiError}
            </div>
          )}
          <div className="space-y-2">
            <Label>Số thùng / pallet</Label>
            <Input type="number" min="0" value={cartons} onChange={(e) => setCartons(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Tầng chồng</Label>
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────

export default function InboundDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: order, isLoading, isPlaceholderData } = useInboundOrder(id)
  const { data: allLocations = [] } = useLocationsReal(
    order?.warehouse_id ? { warehouse_id: order.warehouse_id } : undefined
  )

  const { mutate: completeOrder, isPending: completing } = useCompleteInboundOrder()
  const { mutate: cancelOrder,   isPending: cancelling  } = useCancelInboundOrder()
  const { mutate: deleteEntry                           } = useDeletePalletEntry()
  const { mutate: updateOrder                           } = useUpdateInboundOrder()

  const [showScan,      setShowScan]      = useState(false)
  const [showEditOrder, setShowEditOrder] = useState(false)
  const [editingEntry,  setEditingEntry]  = useState<PalletEntry | null>(null)

  const isOpen  = order?.status === 'OPEN'
  const entries = order?.inventory_entries ?? []

  if (isLoading && !order) {
    return <div className="p-6"><TableSkeleton rows={8} cols={7} /></div>
  }

  if (!order) {
    return (
      <div className="p-6 text-center text-slate-500">
        Không tìm thấy phiếu nhập.{' '}
        <Button variant="link" onClick={() => navigate('/wms/inbound')}>Quay lại</Button>
      </div>
    )
  }

  return (
    <>
      {/* Dialogs */}
      {showEditOrder && (
        <EditOrderDialog
          order={order}
          locations={allLocations}
          open={showEditOrder}
          onClose={() => setShowEditOrder(false)}
        />
      )}
      {editingEntry && (
        <EditEntryDialog
          orderId={order.id}
          entry={editingEntry}
          open={!!editingEntry}
          onClose={() => setEditingEntry(null)}
        />
      )}
      <ScanDialog
        order={order}
        open={showScan}
        onClose={() => setShowScan(false)}
      />

      <div className="flex flex-col h-full min-h-0">

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
              <InboundStatusBadge status={order.status} />
              {isOpen && (
                <button
                  onClick={() => setShowEditOrder(true)}
                  className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors shrink-0"
                  title="Sửa thông tin phiếu"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {isOpen && (
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm" variant="outline"
                  className="text-red-600 hover:bg-red-50 h-7 text-xs px-2"
                  disabled={cancelling}
                  onClick={() => cancelOrder(order.id)}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Hủy
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs px-2"
                  disabled={completing || entries.length === 0}
                  onClick={() => completeOrder(order.id)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  {completing ? 'Đang lưu…' : 'Hoàn thành'}
                </Button>
              </div>
            )}
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
                <span className="font-mono font-medium">{order.location.location_code}</span>
              ) : isOpen ? (
                <span className="text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Chưa chọn vị trí
                  <Select onValueChange={(v) => updateOrder({ id: order.id, location_id: v })}>
                    <SelectTrigger className="h-5 text-[10px] w-auto border-dashed px-1 ml-1">
                      <SelectValue placeholder="Chọn" />
                    </SelectTrigger>
                    <SelectContent>
                      {allLocations.map((l: { id: string; location_code: string }) => (
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
              {format(parseISO(order.import_date ?? order.created_at), 'dd/MM/yyyy', { locale: vi })}
            </span>

            <span className="flex items-center gap-1">
              <User className="h-3 w-3 text-slate-400 shrink-0" />
              {order.imported_by_emp?.name ?? order.created_by_emp?.name ?? '—'}
            </span>

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
              <span className="ml-2 text-xs font-normal text-slate-400">
                {entries.length} pallet
              </span>
            </h2>
            {isOpen && (
              <Button
                size="sm"
                className="h-8 gap-1.5"
                disabled={!order.location_id}
                onClick={() => { unlockAudio(); setShowScan(true) }}
                title={!order.location_id ? 'Chọn vị trí trước' : undefined}
              >
                <Plus className="h-3.5 w-3.5" />
                {order.location_id ? 'Thêm pallet' : 'Chọn vị trí trước'}
              </Button>
            )}
          </div>

          <Card>
            {isPlaceholderData ? (
              <TableSkeleton rows={5} cols={7} />
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                <QrCode className="h-10 w-10 opacity-30" />
                <p className="text-sm">Chưa có pallet nào được quét</p>
                {isOpen && (
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-2 py-1 text-[11px] whitespace-nowrap">NSX</TableHead>
                      <TableHead className="px-2 py-1 text-[11px]">Mã pallet</TableHead>
                      <TableHead className="px-2 py-1 text-[11px] text-right">Thùng</TableHead>
                      <TableHead className="px-2 py-1 text-[11px] hidden md:table-cell">Người quét</TableHead>
                      <TableHead className="px-2 py-1 text-[11px] hidden sm:table-cell whitespace-nowrap">Ngày</TableHead>
                      <TableHead className="px-2 py-1 text-[11px] hidden sm:table-cell whitespace-nowrap">Giờ</TableHead>
                      <TableHead className="px-2 py-1 text-[11px] hidden lg:table-cell">NMSX</TableHead>
                      <TableHead className="px-2 py-1 text-[11px] hidden lg:table-cell">CK</TableHead>
                      <TableHead className="px-2 py-1 text-[11px] hidden lg:table-cell">Máy</TableHead>
                      <TableHead className="px-2 py-1 text-[11px] hidden sm:table-cell text-right">STT</TableHead>
                      {isOpen && <TableHead className="px-1 py-1 w-12" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id} className="text-xs">
                        <TableCell className="px-2 py-1 whitespace-nowrap text-slate-500">
                          {entry.production_date
                            ? format(parseISO(entry.production_date), 'dd/MM/yy', { locale: vi })
                            : '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 font-mono font-medium text-[11px]">
                          {entry.pallet_code}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-right tabular-nums font-medium">
                          {entry.cartons_imported}
                        </TableCell>
                        <TableCell className="px-2 py-1 hidden md:table-cell text-slate-500">
                          {entry.created_by_emp?.name ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 hidden sm:table-cell text-slate-500 whitespace-nowrap">
                          {format(parseISO(entry.created_at), 'dd/MM/yy', { locale: vi })}
                        </TableCell>
                        <TableCell className="px-2 py-1 hidden sm:table-cell text-slate-500 whitespace-nowrap tabular-nums">
                          {format(parseISO(entry.created_at), 'HH:mm', { locale: vi })}
                        </TableCell>
                        <TableCell className="px-2 py-1 hidden lg:table-cell">
                          {entry.manufacturer?.code ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 hidden lg:table-cell">
                          {entry.cycle ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 hidden lg:table-cell">
                          {entry.machine_code ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 hidden sm:table-cell text-right tabular-nums">
                          {entry.pallet_sequence_no ?? '—'}
                        </TableCell>
                        {isOpen && (
                          <TableCell className="px-1 py-1">
                            <div className="flex items-center justify-end gap-0.5">
                              <button
                                className="text-slate-400 hover:text-blue-500 transition-colors p-0.5"
                                onClick={() => setEditingEntry(entry)}
                                title="Sửa"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                className="text-slate-400 hover:text-red-500 transition-colors p-0.5"
                                onClick={() => deleteEntry({ orderId: order.id, entryId: entry.id })}
                                title="Xóa"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </TableCell>
                        )}
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
