import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, QrCode, CheckCircle2, XCircle, Trash2,
  MapPin, Package, AlertTriangle, Layers,
} from 'lucide-react'
import { format, parseISO }    from 'date-fns'
import { vi }                  from 'date-fns/locale'
import { PageHeader }          from '@/components/shared/PageHeader'
import { TableSkeleton }       from '@/components/shared/TableSkeleton'
import { QRScanner }           from '@/components/shared/QRScanner'
import { Button }              from '@/components/ui/button'
import { Badge }               from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useInboundOrder,
  useCompleteInboundOrder,
  useCancelInboundOrder,
  useScanPallet,
  useDeletePalletEntry,
  useLocationsReal,
  useUpdateInboundOrder,
} from '@/api/hooks'
import { inboundOrderStatusLabel } from '@/utils/formatters'
import { playBeep, unlockAudio }   from '@/utils/audio'
import type { InboundOrderStatus } from '@/types'

// ─── Status badge ────────────────────────────────────────────

const statusVariant: Record<InboundOrderStatus, string> = {
  OPEN:      'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-slate-100 text-slate-600',
}
function InboundStatusBadge({ status }: { status: string }) {
  const cls = statusVariant[status as InboundOrderStatus] ?? 'bg-slate-100 text-slate-600'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      {inboundOrderStatusLabel[status] ?? status}
    </span>
  )
}

// ─── Scan result banner ───────────────────────────────────────

type FeedbackState =
  | { type: 'pending' }
  | { type: 'success'; msg: string }
  | { type: 'error';   msg: string }

function ScanFeedback({ state }: { state: FeedbackState }) {
  if (state.type === 'pending') {
    return (
      <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700 animate-pulse flex items-center gap-2">
        <QrCode className="h-4 w-4 shrink-0" /> Đang lưu pallet...
      </div>
    )
  }
  if (state.type === 'success') {
    return (
      <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>{state.msg}</span>
      </div>
    )
  }
  return (
    <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <span>{state.msg}</span>
    </div>
  )
}

// ─── Full-screen camera overlay ───────────────────────────────

interface CameraOverlayProps {
  materialCode: string
  locationCode: string
  onScan: (raw: string) => void
  onClose: () => void
}

function CameraOverlay({ materialCode, locationCode, onScan, onClose }: CameraOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 pt-safe-top py-3 bg-black/80 shrink-0">
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-white" />
        </button>
        <div className="min-w-0">
          <p className="text-white text-sm font-medium leading-tight">Quét QR pallet</p>
          <p className="text-slate-400 text-xs truncate">
            {materialCode} · {locationCode}
          </p>
        </div>
      </div>

      {/* Camera area – fills remaining screen */}
      <div className="flex-1 overflow-hidden">
        <QRScanner onScan={onScan} onClose={onClose} />
      </div>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────

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
  const { mutate: scanPallet,    isPending: scanning    } = useScanPallet()
  const { mutate: updateOrder                           } = useUpdateInboundOrder()

  const [showCamera, setShowCamera] = useState(false)
  const [feedback,   setFeedback]   = useState<FeedbackState | null>(null)

  const isOpen  = order?.status === 'OPEN'
  const entries = order?.inventory_entries ?? []
  const hasLoc  = !!order?.location_id

  function openCamera() {
    unlockAudio()   // unlock AudioContext trong user-gesture (click) này
    setFeedback(null)
    setShowCamera(true)
  }

  // Bắt được QR: beep → đóng overlay → feedback ngay → gọi API background
  function handleScan(raw: string) {
    playBeep()
    setShowCamera(false)

    if (!order?.location_id) {
      setFeedback({ type: 'error', msg: 'Chưa chọn vị trí. Chọn vị trí rồi quét lại.' })
      return
    }

    // Hiện kết quả ngay lập tức (optimistic) — không đợi API
    const materialCode = raw.split('_')[1] ?? raw
    setFeedback({ type: 'success', msg: `Đã quét: ${materialCode}` })

    scanPallet(
      { orderId: order.id, qr_code: raw, location_id: order.location_id },
      {
        onSuccess: (data) => {
          // Cập nhật với thông tin đầy đủ từ server
          setFeedback({
            type: 'success',
            msg: `Đã nhập: ${data.entry.pallet_code} · ${data.entry.cartons_imported} thùng · ${data.entry.location?.location_code ?? ''}`,
          })
        },
        onError: (err) => {
          // Rollback: báo lỗi, optimistic entry đã được xóa trong hook
          const msg = (err as any)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setFeedback({ type: 'error', msg })
        },
      }
    )
  }

  // Full skeleton only on very first load (no cache at all)
  if (isLoading && !order) {
    return <div className="p-6"><TableSkeleton rows={6} cols={4} /></div>
  }

  if (!order) {
    return (
      <div className="p-6 text-center text-slate-500">
        Không tìm thấy phiếu nhập.
        <Button variant="link" onClick={() => navigate('/wms/inbound')}>Quay lại</Button>
      </div>
    )
  }

  return (
    <>
      {/* Full-screen camera overlay */}
      {showCamera && (
        <CameraOverlay
          materialCode={order.material?.material_code ?? ''}
          locationCode={order.location?.location_code ?? ''}
          onScan={handleScan}
          onClose={() => setShowCamera(false)}
        />
      )}

      <div className="space-y-0">
        <PageHeader
          title={order.import_code ?? 'Phiếu nhập kho'}
          description={`${order.warehouse?.name ?? ''} – ${order.material?.material_code ?? ''} ${order.material?.short_name ?? ''}`}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigate('/wms/inbound')}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Quay lại
              </Button>
              {isOpen && (
                <>
                  <Button
                    size="sm" variant="outline"
                    className="text-red-600 hover:bg-red-50"
                    disabled={cancelling}
                    onClick={() => cancelOrder(order.id)}
                  >
                    <XCircle className="h-4 w-4 mr-1" /> Hủy phiếu
                  </Button>
                  <Button
                    size="sm"
                    disabled={completing || entries.length === 0}
                    onClick={() => completeOrder(order.id)}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    {completing ? 'Đang lưu...' : 'Hoàn thành'}
                  </Button>
                </>
              )}
            </div>
          }
        />

        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Left: Order info + scan button ── */}
          <div className="space-y-4 lg:col-span-1">

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  Thông tin phiếu
                  <InboundStatusBadge status={order.status} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-slate-400" />
                  <span className="font-medium">{order.material?.material_code}</span>
                  <span className="text-slate-500">–</span>
                  <span className="text-slate-600 truncate">
                    {order.material?.short_name ?? order.material?.material_description}
                  </span>
                </div>

                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-slate-400 mt-0.5" />
                  <div className="flex-1">
                    {order.location ? (
                      <Badge variant="outline" className="font-mono text-xs">
                        {order.location.location_code}
                      </Badge>
                    ) : isOpen ? (
                      <div className="space-y-1">
                        <p className="text-xs text-amber-700 font-medium flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Chưa chọn vị trí
                        </p>
                        <Select onValueChange={(v) => updateOrder({ id: order.id, location_id: v })}>
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="Chọn vị trí nhập" />
                          </SelectTrigger>
                          <SelectContent>
                            {allLocations.map((l: any) => (
                              <SelectItem key={l.id} value={l.id}>{l.location_code}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <span className="text-slate-400 text-xs">Chưa chọn vị trí</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-slate-400" />
                  <span>
                    <span className="font-semibold text-blue-600">{entries.length}</span>
                    {order.planned_pallets ? (
                      <span className="text-slate-500"> / {order.planned_pallets} pallet dự kiến</span>
                    ) : (
                      <span className="text-slate-500"> pallet đã quét</span>
                    )}
                  </span>
                </div>

                {order.notes && (
                  <p className="text-xs text-slate-500 italic border-t pt-2">{order.notes}</p>
                )}
                <div className="text-xs text-slate-400 border-t pt-2 space-y-0.5">
                  <p>Tạo bởi: {order.imported_by_emp?.name ?? order.created_by_emp?.name ?? '—'}</p>
                  <p>Ngày tạo: {format(parseISO(order.created_at), 'dd/MM/yyyy HH:mm', { locale: vi })}</p>
                </div>
              </CardContent>
            </Card>

            {/* Scan action card */}
            {isOpen && (
              <Card>
                <CardContent className="pt-4 space-y-3">
                  {feedback && <ScanFeedback state={feedback} />}

                  <Button
                    className="w-full h-14 gap-2 text-base font-semibold"
                    disabled={!hasLoc || scanning}
                    onClick={openCamera}
                  >
                    <QrCode className="h-5 w-5" />
                    {scanning
                      ? 'Đang lưu...'
                      : !hasLoc
                        ? 'Chọn vị trí trước'
                        : feedback?.type === 'success'
                          ? 'Quét pallet tiếp ▸'
                          : 'Mở camera quét QR'}
                  </Button>

                  <p className="text-[10px] text-slate-400 text-center">
                    Định dạng: <span className="font-mono">ddmmyy_Mã_CK_Máy_STT_NMSX</span>
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Right: Pallet list ── */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Danh sách pallet đã quét
                  <Badge variant="secondary" className="ml-2">{entries.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isPlaceholderData ? (
                  <TableSkeleton rows={3} cols={8} />
                ) : entries.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                    <QrCode className="h-10 w-10 opacity-30" />
                    <p className="text-sm">Chưa có pallet nào được quét</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Mã pallet (QR)</TableHead>
                          <TableHead className="text-xs">NSX</TableHead>
                          <TableHead className="text-xs">CK</TableHead>
                          <TableHead className="text-xs">Máy</TableHead>
                          <TableHead className="text-xs">NMSX</TableHead>
                          <TableHead className="text-xs text-right">Thùng</TableHead>
                          <TableHead className="text-xs">Vị trí</TableHead>
                          <TableHead className="text-xs">T</TableHead>
                          {isOpen && <TableHead className="text-xs w-8" />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entries.map((entry) => (
                          <TableRow key={entry.id} className="text-xs">
                            <TableCell className="font-mono">{entry.pallet_code}</TableCell>
                            <TableCell>
                              {entry.production_date
                                ? format(parseISO(entry.production_date), 'dd/MM/yy', { locale: vi })
                                : '—'}
                            </TableCell>
                            <TableCell>{entry.cycle ?? '—'}</TableCell>
                            <TableCell>{entry.machine_code ?? '—'}</TableCell>
                            <TableCell>{entry.manufacturer?.code ?? '—'}</TableCell>
                            <TableCell className="text-right tabular-nums">{entry.cartons_imported}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-[10px]">
                                {entry.location.location_code}
                              </Badge>
                            </TableCell>
                            <TableCell>{entry.stack_layer}</TableCell>
                            {isOpen && (
                              <TableCell>
                                <button
                                  className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                  onClick={() => deleteEntry({ orderId: order.id, entryId: entry.id })}
                                  title="Xóa pallet"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
