import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AxiosError } from 'axios'
import { MapPin, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { QRScanner }           from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import { Button }              from '@/components/ui/button'
import { Input }               from '@/components/ui/input'
import { Label }               from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useScanPallet, useCheckInboundScan, useInboundOrder, useLocationsReal } from '@/api/hooks'
import { playBeep } from '@/utils/audio'
import type { InboundOrder } from '@/types'

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

interface InboundScanSheetProps {
  order: InboundOrder
  onClose: () => void
  employeeId?: string
  allLocations: { id: string; location_code: string; sub_code: string; max_pallets: number; used_slots?: number; category?: string | null }[]
}

export function InboundScanSheet({ order, onClose, employeeId, allLocations }: InboundScanSheetProps) {
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

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col">
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

          {/* Chưa chọn vị trí → KHÔNG bật camera, buộc chọn vị trí trước */}
          {!activeLocationId ? (
            <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 p-6 text-center space-y-2">
              <MapPin className="h-7 w-7 text-amber-500 mx-auto" />
              <p className="text-sm font-medium text-amber-800">Chọn vị trí nhập trước khi quét</p>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md px-3 py-1.5"
                onClick={() => setShowLocPicker(true)}
              >
                <MapPin className="h-3.5 w-3.5" /> Chọn vị trí
              </button>
            </div>
          ) : (
          <>
            {/* Số lượng đặt TRÊN camera — tránh bỏ sót / nhập mặc định sai */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium text-slate-700">Số thùng nhập</Label>
                <Input type="number" min="0" value={cartons} onChange={(e) => setCartons(e.target.value)}
                  className="h-11 text-center text-lg font-semibold" />
                {outboundCartons != null && (
                  <p className="text-[10px] text-slate-500">Phiếu xuất: <span className="font-semibold text-slate-700">{outboundCartons}</span> thùng</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tầng chồng</Label>
                <Select value={stackLayer} onValueChange={setStackLayer}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Tầng 1 (sàn)</SelectItem>
                    <SelectItem value="2">Tầng 2</SelectItem>
                    <SelectItem value="3">Tầng 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

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
                {saving ? '…' : `Lưu ${cartons || 0} thùng`}
              </button>
            )}
          </div>
          </>
          )}

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
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Loader variant: tự fetch phiếu + vị trí theo importId (dùng khi nhúng ngoài Inbound) ──

export function InboundScanSheetById({ importId, employeeId, onClose }: { importId: string; employeeId?: string; onClose: () => void }) {
  const { data: order, isLoading } = useInboundOrder(importId)
  const { data: allLocations = [] } = useLocationsReal(
    order?.warehouse_id
      ? { warehouse_id: order.warehouse_id, ...(order.warehouse_type ? { category: order.warehouse_type } : {}) }
      : undefined
  )

  if (!order) {
    return createPortal(
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <div className="relative bg-white rounded-xl px-6 py-4 text-sm text-slate-600">
          {isLoading ? 'Đang tải phiếu…' : 'Không tìm thấy phiếu nhập'}
        </div>
      </div>,
      document.body
    )
  }

  return (
    <InboundScanSheet
      order={order}
      onClose={onClose}
      employeeId={employeeId}
      allLocations={allLocations as InboundScanSheetProps['allLocations']}
    />
  )
}
