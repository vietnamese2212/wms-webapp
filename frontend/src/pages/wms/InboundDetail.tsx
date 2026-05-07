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
import { Input }               from '@/components/ui/input'
import { Label }               from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  useInboundOrder,
  useInboundLocationSuggestions,
  useCompleteInboundOrder,
  useCancelInboundOrder,
  useScanPallet,
  useDeletePalletEntry,
  useLocationsReal,
} from '@/api/hooks'
import { inboundOrderStatusLabel } from '@/utils/formatters'
import type { InboundOrderStatus, LocationSuggestion } from '@/types'

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

// ─── Scan confirmation dialog ────────────────────────────────

interface ParsedQRPreview {
  raw:              string
  material_code:    string
  cycle:            string
  machine_code:     string
  manufacturer_code: string
  production_date:  string // ddmmyy
  pallet_seq:       string
}

function parsedFromRaw(raw: string): ParsedQRPreview | null {
  const parts = raw.trim().split('_')
  if (parts.length < 6) return null
  const [dateStr, material_code, cycle, machine_code, pallet_seq, manufacturer_code] = parts
  return { raw, material_code, cycle, machine_code, manufacturer_code, production_date: dateStr, pallet_seq }
}

interface ScanDialogProps {
  orderId:    string
  materialCode: string | undefined
  open:       boolean
  scannedRaw: string
  suggestions: LocationSuggestion[]
  defaultLocationId: string | null
  allLocations: any[]
  onClose:    () => void
  onSuccess:  (warnings: string[]) => void
}

function ScanConfirmDialog({
  orderId, materialCode, open, scannedRaw,
  suggestions, defaultLocationId, allLocations,
  onClose, onSuccess,
}: ScanDialogProps) {
  const parsed = parsedFromRaw(scannedRaw)
  const [locationId,   setLocationId]   = useState(defaultLocationId ?? '')
  const [stackLayer,   setStackLayer]   = useState('1')
  const [cartonOverride, setCartonOverride] = useState('')

  const { mutate: scanPallet, isPending, error } = useScanPallet()
  const apiError = (error as any)?.response?.data?.error?.message

  function handleConfirm() {
    if (!locationId) return
    scanPallet(
      {
        orderId,
        qr_code:         scannedRaw,
        location_id:     locationId,
        stack_layer:     Number(stackLayer),
        cartons_override: cartonOverride ? Number(cartonOverride) : undefined,
      },
      {
        onSuccess: (data) => {
          onSuccess(data.warnings ?? [])
          onClose()
        },
      }
    )
  }

  if (!parsed) return null

  const isMaterialMismatch = materialCode && parsed.material_code !== materialCode

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Xác nhận pallet</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Parsed QR info */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1.5 text-sm">
            <div className="grid grid-cols-2 gap-1">
              <span className="text-slate-500">Mã hàng (QR):</span>
              <span className={`font-mono font-semibold ${isMaterialMismatch ? 'text-red-600' : 'text-slate-900'}`}>
                {parsed.material_code}
              </span>
              <span className="text-slate-500">Ngày SX:</span>
              <span className="font-medium">{parsed.production_date}</span>
              <span className="text-slate-500">Chu kỳ:</span>
              <span className="font-medium">{parsed.cycle}</span>
              <span className="text-slate-500">Máy:</span>
              <span className="font-medium">{parsed.machine_code}</span>
              <span className="text-slate-500">Số TT pallet:</span>
              <span className="font-mono font-medium">{parsed.pallet_seq}</span>
              <span className="text-slate-500">NMSX:</span>
              <span className="font-medium">{parsed.manufacturer_code}</span>
            </div>
          </div>

          {/* Material mismatch warning */}
          {isMaterialMismatch && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">
                <strong>Sai hàng hóa!</strong> QR có mã <strong>{parsed.material_code}</strong> nhưng phiếu yêu cầu <strong>{materialCode}</strong>.
              </p>
            </div>
          )}

          {/* API error */}
          {apiError && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{apiError}</p>
            </div>
          )}

          {/* Location selector */}
          <div className="space-y-1.5">
            <Label>Vị trí <span className="text-red-500">*</span></Label>
            {suggestions.length > 0 && (
              <p className="text-xs text-slate-500">Gợi ý (còn chỗ):</p>
            )}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setLocationId(s.id)}
                  className={`
                    inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-mono transition-colors
                    ${locationId === s.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50'}
                    ${s.has_same_material ? 'border-green-300' : ''}
                  `}
                >
                  {s.location_code}
                  <span className={`text-[10px] ${s.available_slots <= 1 ? 'text-amber-600' : 'text-slate-400'}`}>
                    {s.available_slots}/{s.max_pallets}
                  </span>
                  {s.has_same_material && <span className="text-green-600">●</span>}
                </button>
              ))}
            </div>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue placeholder="Hoặc chọn vị trí bất kỳ" /></SelectTrigger>
              <SelectContent>
                {allLocations.map((l: any) => (
                  <SelectItem key={l.id} value={l.id}>{l.location_code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Stack layer */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tầng pallet</Label>
              <Select value={stackLayer} onValueChange={setStackLayer}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Tầng 1 (sàn)</SelectItem>
                  <SelectItem value="2">Tầng 2 (chồng lên T1)</SelectItem>
                  <SelectItem value="3">Tầng 3 (chồng lên T2)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Thùng/pallet <span className="text-slate-400 text-xs">(tự điền từ DM)</span></Label>
              <Input
                type="number" min="0" placeholder="Tự động"
                value={cartonOverride}
                onChange={(e) => setCartonOverride(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button
            onClick={handleConfirm}
            disabled={!locationId || isMaterialMismatch || isPending}
          >
            {isPending ? 'Đang lưu...' : 'Xác nhận nhập'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ───────────────────────────────────────────────

export default function InboundDetail() {
  const { id }     = useParams<{ id: string }>()
  const navigate   = useNavigate()

  const { data: order, isLoading } = useInboundOrder(id)
  const { data: suggestions = [] } = useInboundLocationSuggestions(id)
  const { data: allLocations = [] } = useLocationsReal(
    order?.warehouse_id ? { warehouse_id: order.warehouse_id } : undefined
  )

  const { mutate: completeOrder, isPending: completing } = useCompleteInboundOrder()
  const { mutate: cancelOrder,   isPending: cancelling  } = useCancelInboundOrder()
  const { mutate: deleteEntry,   isPending: deletingId  } = useDeletePalletEntry()

  const [showScanner, setShowScanner] = useState(false)
  const [scannedRaw,  setScannedRaw]  = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [toastMsgs,   setToastMsgs]   = useState<string[]>([])

  const isOpen = order?.status === 'OPEN'

  function handleScanResult(raw: string) {
    setShowScanner(false)
    setScannedRaw(raw)
    setShowConfirm(true)
  }

  function handleScanSuccess(warnings: string[]) {
    setShowConfirm(false)
    setScannedRaw('')
    if (warnings.length) setToastMsgs(warnings)
    setTimeout(() => setToastMsgs([]), 4000)
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <TableSkeleton rows={6} cols={4} />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="p-6 text-center text-slate-500">
        Không tìm thấy phiếu nhập.
        <Button variant="link" onClick={() => navigate('/wms/inbound')}>Quay lại</Button>
      </div>
    )
  }

  const entries = order.inventory_entries ?? []

  return (
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
                  size="sm"
                  variant="outline"
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

      {/* Toast messages */}
      {toastMsgs.length > 0 && (
        <div className="mx-6 mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-1">
          {toastMsgs.map((m, i) => (
            <p key={i} className="text-sm text-amber-800 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {m}
            </p>
          ))}
        </div>
      )}

      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left: Order info + QR scanner ── */}
        <div className="space-y-4 lg:col-span-1">

          {/* Order header card */}
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
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-slate-400" />
                {order.location ? (
                  <Badge variant="outline" className="font-mono text-xs">
                    {order.location.location_code}
                  </Badge>
                ) : (
                  <span className="text-slate-400 text-xs">Chưa chọn vị trí</span>
                )}
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

          {/* QR Scanner (only when OPEN) */}
          {isOpen && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Quét QR pallet</CardTitle>
              </CardHeader>
              <CardContent>
                {showScanner ? (
                  <QRScanner
                    onScan={handleScanResult}
                    onClose={() => setShowScanner(false)}
                  />
                ) : (
                  <Button
                    className="w-full gap-2"
                    onClick={() => setShowScanner(true)}
                  >
                    <QrCode className="h-4 w-4" /> Mở camera quét QR
                  </Button>
                )}

                <p className="mt-3 text-xs text-slate-400 text-center">
                  Định dạng QR: <span className="font-mono">ddmmyy_Mã_ChuKy_Máy_STT_NMSX</span>
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
              {entries.length === 0 ? (
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
                          <TableCell className="font-mono">
                            {entry.pallet_code}
                          </TableCell>
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

      {/* Scan confirmation dialog */}
      {showConfirm && (
        <ScanConfirmDialog
          orderId={order.id}
          materialCode={order.material?.material_code}
          open={showConfirm}
          scannedRaw={scannedRaw}
          suggestions={suggestions}
          defaultLocationId={order.location_id}
          allLocations={allLocations}
          onClose={() => { setShowConfirm(false); setScannedRaw('') }}
          onSuccess={handleScanSuccess}
        />
      )}
    </div>
  )
}
