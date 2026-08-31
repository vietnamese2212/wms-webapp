import { useRef, useState, useEffect, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { ArrowLeft, CheckCircle2, AlertTriangle, Package, Trash2, Pause, ChevronDown, ChevronRight, PenSquare, Info } from 'lucide-react'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { Button }  from '@/components/ui/button'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { PdaGunHint } from '@/components/shared/PdaGunHint'
import { Card }    from '@/components/ui/card'
import { Input }   from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { QRScanner } from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import { toast } from '@/components/ui/use-toast'
import { useGDO, useScanOutboundItem, useManualCompleteItem, useManualItemStock, useDeleteOutboundScanEntry, useItemInventory, useCheckOutboundScan, useConfirmLoosePickingItem, useAttachCartonScans, usePctBands, type ItemInventoryEntry, type CheckOutboundScanResult } from '@/api/hooks'
import { pctDateCls } from '@/utils/pctDateBands'
import { CartonScanSheet, type CartonScan } from '@/components/wms/CartonScanSheet'
import { materialCodeOf } from '@/utils/qr'
import { PalletDetailDialog } from '@/components/shared/PalletDetailDialog'
import { itemStatusText } from './Outbound'
import { useAuthStore } from '@/stores/authStore'
import { useActiveVehiclesStore } from '@/stores/activeVehiclesStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { playBeep, unlockAudio } from '@/utils/audio'
import { qtyLabel, qtyEntryText, qtyUnitLabel, type MatUnits } from '@/utils/qtyUnits'
import { QtyInput } from '@/components/shared/QtyInput'
import { isQtyLike } from '@/utils/inventoryMode'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { enqueueScan, isConnectivityError, useScanQueue } from '@/offline/scanQueue'
import { isOffline } from '@/offline/useOnline'
import { OfflineError } from '@/api/client'
import { normalizeQR } from '@/utils/qr'
import { LeftoverLocationPicker, KEEP_LOCATION, isLeftoverLocError } from '@/components/wms/LeftoverLocationPicker'
import { usePutawayGate } from '@/components/wms/PutawayGate'
import type { PutawayHint } from '@/utils/putaway'
import { useRotationGate } from '@/components/wms/RotationGate'
import { scanRotationOf } from '@/utils/rotation'
import type { OutboundItem } from '@/types'
import { useScanCodeTypes } from '@/hooks/useScanCodeTypes'
import { OutboundStatusBadge } from '@/lib/statusMaps'

function ProgressBar({ scanned, ordered, looseUnconfirmed = 0, mat }: { scanned: number; ordered: number; looseUnconfirmed?: number; mat?: MatUnits | null }) {
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
        {qtyEntryText(scanned, mat)}/{qtyEntryText(ordered, mat)} {qtyUnitLabel(mat)}
      </span>
    </div>
  )
}

type FeedbackState = { type: 'success' | 'error' | 'queued'; msg: string } | null

interface ScanDialogProps {
  item:    OutboundItem
  gdoId:   string
  warehouseId: string | null       // kho CỦA CHUYẾN → quyết loại mã camera giải (QR / mã vạch / cả hai)
  cartonScanEnabled?: boolean
  onClose: () => void
  pdaMode?: boolean          // mở bằng cò súng → KHÔNG bật camera
  initialScan?: string       // tem đã bắn ngay trước khi mở — xử lý luôn
}

function ScanDialog({ item, gdoId, warehouseId, cartonScanEnabled, onClose, pdaMode = false, initialScan }: ScanDialogProps) {
  const codeTypes = useScanCodeTypes(warehouseId)
  const scannerRef = useRef<QRScannerHandle>(null)
  // Súng quét: bắn 1 phát = chuyển hẳn chế độ súng (tắt camera cả phiên) → sau khi Lưu KHÔNG bật lại camera.
  const [gunMode, setGunMode] = useState(pdaMode)
  const user = useAuthStore(s => s.user)
  // Số lượt quét của MÃ này đang chờ mạng (hàng đợi offline)
  const queuedThisItem = useScanQueue(s =>
    s.items.filter(i => i.status === 'pending' && i.itemId === item.id).length)
  const [feedback,       setFeedback]       = useState<FeedbackState>(null)
  const [checkResult,    setCheckResult]    = useState<CheckOutboundScanResult | null>(null)
  const [pendingCartons, setPendingCartons] = useState('')
  // Pallet đi không hết → chỗ đặt phần dư: null = CHƯA chọn (khóa nút Lưu)
  const [leftoverLoc,    setLeftoverLoc]    = useState<string | null>(null)
  const [leftoverHint,   setLeftoverHint]   = useState<PutawayHint | null>(null)   // quy tắc CẤT của ô vừa chọn (BE chấm)
  // Lỗi VỊ TRÍ (thiếu / vị trí vừa đầy): hiện NGAY TRONG panel và GIỮ tem đang chờ — user chọn lại
  // rồi bấm Lưu, KHÔNG phải quét lại pallet (user 30/07: "muốn chọn lại phải quét tiếp, mất thao tác")
  const [locError,       setLocError]       = useState('')
  const { mutate: checkScan, isPending: checking } = useCheckOutboundScan()
  // Luân chuyển: kết quả do BE tính (xem components/wms/RotationGate.tsx)
  const rotGate = useRotationGate(checkResult?.rotation)
  const putGate = usePutawayGate(leftoverHint)   // ô đặt phần dư lệch luật + kho bắt buộc → khoá Lưu tới khi có lý do
  const { mutate: scanItem,  isPending: saving    } = useScanOutboundItem()
  const { mutate: attachCartons, isPending: attaching } = useAttachCartonScans()
  // Panel multiscan tem THÙNG neo vào pallet vừa quét (chỉ khi Kho/Loại kho bật cờ)
  const [cartonFor, setCartonFor] = useState<{ scanId: string; palletCode: string; wasComplete: boolean } | null>(null)
  const expectedMaterialCode = item.material?.material_code ?? materialCodeOf(item.material_code_raw) ?? ''

  const matName   = item.material?.short_name ?? item.material_code_raw ?? '—'
  const remaining = Math.max(0, item.cartons_ordered - item.cartons_scanned)

  // Offline: không check được với server → xếp thẳng vào hàng đợi; SL do server chốt
  // lúc sync (cap = min(tồn pallet, còn cần xuất) — không bao giờ vượt kế hoạch).
  // cartons_override chỉ gửi khi user đã kịp xác nhận số (đường handleSave).
  function queueScan(qr_code: string, cartonsOverride: number | undefined, uncertain: boolean, leftoverLocation?: string | null) {
    const norm = normalizeQR(qr_code)
    const { queued, duplicate } = enqueueScan({
      kind: 'outbound',
      url: `/wms/outbound/${gdoId}/items/${item.id}/scan`,
      // Offline chưa biết pallet có dư hay không (không hỏi được server) → mặc định GIỮ CHỖ CŨ,
      // đúng bằng hành vi cũ; nếu user đã kịp chọn chỗ thì gửi đúng chỗ đó.
      body: { qr_code, employee_id: user?.id ?? undefined, cartons_override: cartonsOverride,
              leftover_ui: true, leftover_location_id: leftoverLocation ?? KEEP_LOCATION },
      pallet_code: norm,
      label: `${item.material?.material_code ?? item.material_code_raw ?? ''} · ${matName}`,
      orderId: gdoId,
      itemId: item.id,
      uncertain,
    })
    setFeedback({
      type: 'queued',
      msg: duplicate
        ? `⏸ Pallet này ĐÃ trong hàng đợi chờ mạng (${queued} chờ)`
        : `⏸ Mất mạng — đã xếp hàng chờ (${queued} chờ) · ${norm}${cartonsOverride ? ` · ${cartonsOverride} thùng` : ' · SL chốt khi có mạng'}`,
    })
    setTimeout(() => { scannerRef.current?.resume(); setFeedback(null) }, 2000)
  }

  function handleScan(qr_code: string, src: 'camera' | 'wedge' = 'camera') {
    // Bắn bằng súng → khóa hẳn chế độ súng (tắt camera cả phiên, không tự bật lại sau khi Lưu)
    if (src === 'wedge' && !gunMode) setGunMode(true)
    // Guard chung camera + súng quét: đang check/lưu/quét thùng → bỏ qua lượt mới
    if (checking || saving || cartonFor) return
    if (checkResult) {
      // PDA: bắn lại đúng tem đang chờ xác nhận = bấm Lưu (chỉ súng — camera không tự lưu)
      if (src === 'wedge' && normalizeQR(qr_code) === checkResult.pallet_code) { playBeep(); handleSave() }
      return
    }
    playBeep()
    setCheckResult(null)
    setFeedback(null)
    rotGate.reset(); putGate.reset()   // tem mới = câu hỏi lý do mới
    if (isOffline()) {   // trình duyệt biết chắc offline → khỏi bắn check chết
      queueScan(qr_code, undefined, false)
      return
    }
    checkScan(
      { gdoId, itemId: item.id, qr_code },
      {
        onSuccess: (data) => {
          setCheckResult(data)
          setPendingCartons(String(data.suggested_cartons > 0 ? data.suggested_cartons : 1))
          setLeftoverLoc(null); setLeftoverHint(null); putGate.reset(); setLocError('')   // pallet mới → chọn lại chỗ đặt phần dư
        },
        onError: (err) => {
          // Wifi dính AP nhưng không có internet: check fail vì MẠNG → vẫn xếp hàng được
          if (isConnectivityError(err)) {
            queueScan(qr_code, undefined, false)   // check là GET-nghĩa, chưa ghi gì → không uncertain
            return
          }
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setFeedback({ type: 'error', msg })
        },
      }
    )
  }

  // Số BASE còn lại trên pallet sau lượt này — >0 thì BẮT BUỘC khai chỗ đặt trước khi Lưu
  const qtyToTake  = Math.max(1, parseInt(pendingCartons) || 1)
  const leftoverQty = Math.max(0, (checkResult?.pallet_remaining ?? 0) - qtyToTake)
  const needLeftoverLoc = !!checkResult && leftoverQty > 0
  const canSave = !!checkResult && (!needLeftoverLoc || !!leftoverLoc) && rotGate.ok && putGate.ok

  function handleSave() {
    if (!checkResult || saving || !canSave) return
    scanItem(
      { gdoId, itemId: item.id, qr_code: checkResult.pallet_code, cartons_override: qtyToTake, employee_id: user?.id ?? undefined,
        leftover_ui: true, ...(needLeftoverLoc ? { leftover_location_id: leftoverLoc ?? KEEP_LOCATION } : {}), ...rotGate.arg, ...putGate.arg },
      {
        onSuccess: (data) => {
          setCheckResult(null)
          const scannedNow = Number(data.scan_entry.cartons_scanned)
          const isNowComplete = scannedNow >= remaining
          // Kho/Loại kho bật quét-thùng → mở panel multiscan thùng neo vào pallet vừa quét
          // (chưa resume/đóng tới khi lưu/bỏ qua tem thùng)
          if (cartonScanEnabled) {
            setFeedback(null)
            setCartonFor({ scanId: data.scan_entry.id, palletCode: data.scan_entry.pallet_code, wasComplete: isNowComplete })
            return
          }
          setFeedback({ type: 'success', msg: `✓ ${data.scan_entry.pallet_code} · ${qtyLabel(scannedNow, item.material)}` })
          setTimeout(() => {
            if (isNowComplete) { onClose() }
            else { scannerRef.current?.resume(); setFeedback(null) }
          }, 1500)
        },
        onError: (err) => {
          const qr = checkResult.pallet_code
          const cartons = qtyToTake
          // Lỗi VỊ TRÍ → giữ nguyên tem đang chờ + báo trong panel để chọn lại rồi Lưu tiếp
          const eobj = (err as AxiosError<{ error: { message: string; code?: string } }>)?.response?.data?.error
          const emsg = eobj?.message ?? ''
          if (isLeftoverLocError(emsg, eobj?.code)) { setLocError(emsg); setLeftoverLoc(null); setLeftoverHint(null); return }
          setCheckResult(null)
          // Mạng rớt đúng lúc bấm Lưu → xếp hàng với SL user đã xác nhận; lỗi SAU khi
          // gửi (không rõ kết quả) → uncertain, replay gặp "đã quét" sẽ coi là thành công
          if (isConnectivityError(err)) {
            queueScan(qr, cartons, !(err instanceof OfflineError), leftoverLoc)
            return
          }
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

  // Đóng panel thùng rồi tiếp tục luồng pallet (đóng hẳn nếu item vừa đủ, không thì quét tiếp)
  function finishCarton() {
    const wasComplete = cartonFor?.wasComplete
    setCartonFor(null)
    if (wasComplete) onClose()
    else { scannerRef.current?.resume(); setFeedback(null) }
  }
  function saveCarton(list: CartonScan[]) {
    if (!cartonFor) return
    attachCartons({ gdoId, scanId: cartonFor.scanId, cartons: list }, {
      onSuccess: finishCarton,
      onError: (err) => toast({
        title: 'Lưu mã thùng lỗi',
        description: (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Thử lại',
        variant: 'destructive',
      }),
    })
  }

  // Súng quét PDA (keyboard-wedge) — chạy song song camera, chống double-read trong hook
  useWedgeScanner(code => handleScan(code, 'wedge'), true)

  // Mở bằng cò súng: xử lý ngay tem vừa bắn (1 lần khi mount)
  useEffect(() => {
    if (initialScan) handleScan(initialScan, 'wedge')
  }, []) // eslint-disable-line


  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col pointer-events-auto">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative mt-auto bg-white rounded-t-2xl h-[92dvh] flex flex-col overflow-hidden">
        <div className="p-4 flex-1 flex flex-col gap-3 min-h-0">
          <div>
            <p className="font-semibold text-lg text-slate-800">{matName}</p>
            <p className="text-sm text-slate-500">
              {item.material?.material_code ?? item.material_code_raw}
              {' · '}còn <strong>{qtyLabel(remaining, item.material)}</strong> cần xuất
            </p>
          </div>

          {item.header_text && (
            <p className="text-sm font-semibold text-red-600 leading-snug break-words border border-red-200 bg-red-50 rounded px-2 py-1.5">
              {item.header_text}
            </p>
          )}

          {/* Điều kiện xuất Batch / %Date — highlight ĐỎ (nếu có) */}
          {(item.batch_required || (item.date_required != null && item.date_required > 0)) && (
            <div className="flex flex-wrap gap-1.5">
              {item.batch_required && (
                <span className="text-sm font-semibold text-red-600 border border-red-200 bg-red-50 rounded px-2 py-1">Batch: {item.batch_required}</span>
              )}
              {item.date_required != null && item.date_required > 0 && (
                <span className="text-sm font-semibold text-red-600 border border-red-200 bg-red-50 rounded px-2 py-1">%Date ≥ {item.date_required}%</span>
              )}
            </div>
          )}

          <div className="relative flex-1 min-h-0">
            {gunMode ? (
              <div className="h-full w-full rounded-lg bg-slate-900 flex flex-col items-center justify-center gap-2 px-4">
                {/* Hướng dẫn CHỈ hiện lúc đang chờ bắn tem — nút nổi đứng absolute GIỮA vùng này,
                    để chữ lại là đè mất chữ trên màn nhỏ (user báo 2 lần, 30/07). */}
                {!checkResult && !checking && (
                  <>
                    <ScanIcon className="h-12 w-12 text-sky-400/70" />
                    <p className="text-sm font-medium text-slate-200 text-center">Chế độ súng quét — bóp cò để quét tem</p>
                    <p className="text-[11px] text-slate-400 text-center">Camera tắt · bắn lại đúng tem đang chờ xác nhận = Lưu</p>
                  </>
                )}
              </div>
            ) : (
              <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} fill codeTypes={codeTypes} />
            )}

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

            {/* Chưa chọn vị trí hàng dư → KHÔNG hiện pill giữa vùng quét: pill đó bấm không được mà
                lại ĐÈ MẤT dòng hướng dẫn phía sau (màn 360px). Việc cần làm nằm ở khối vàng bên dưới;
                chọn xong thì nút Lưu hiện ra. */}
            {checkResult && !saving && canSave && (
              <button
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                           bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white
                           rounded-full px-6 py-2.5 text-sm font-semibold shadow-xl transition-all"
                onClick={handleSave}
              >
                Lưu {qtyLabel(qtyToTake, item.material)}
              </button>
            )}
            {saving && (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                             bg-blue-500 text-white rounded-full px-6 py-2.5 text-sm font-semibold shadow-xl opacity-70">
                …
              </div>
            )}
          </div>

          {/* Panel TỰ CUỘN: mở bàn phím để sửa số lượng làm màn co lại, trước đây ô chọn vị trí bị
              đẩy khuất dưới bàn phím mà không cuộn tới được ("không thấy nút chọn vị trí đâu"). */}
          {checkResult && !feedback && (
            <div className="space-y-2 overflow-y-auto max-h-[52dvh] shrink-0">
              <div className={`rounded-lg border px-3 py-2.5 flex items-start gap-2 ${rotGate.blocked ? 'bg-red-50 border-red-200' : rotGate.warn ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
                <CheckCircle2 className={`h-4 w-4 shrink-0 mt-0.5 ${rotGate.blocked ? 'text-red-500' : rotGate.warn ? 'text-orange-500' : 'text-green-600'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold font-mono ${rotGate.blocked || rotGate.warn ? 'text-red-600' : 'text-green-800'}`}>
                    {checkResult.pallet_code}
                  </p>
                  {checkResult.production_date && (
                    <p className="text-[10px] text-slate-500 mt-0.5">NSX: {formatTimestampDate(checkResult.production_date)}</p>
                  )}
                  {rotGate.banner}
                </div>
              </div>
              {rotGate.reasonBox}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-slate-700 shrink-0">Số lượng xuất:</label>
                <QtyInput compact className="w-44"
                  value={Math.max(0, parseInt(pendingCartons) || 0)}
                  mat={item.material}
                  onChange={b => setPendingCartons(String(b))}
                />
                <span className="text-sm text-slate-400">/ {remaining} cần xuất</span>
              </div>
              {needLeftoverLoc && (
                <div ref={el => el?.scrollIntoView({ block: 'nearest' })}>
                  <LeftoverLocationPicker
                    leftoverQty={leftoverQty}
                    mat={item.material}
                    currentLocationCode={checkResult.location_code ?? null}
                    warehouseId={checkResult.warehouse_id ?? null}
                    materialId={item.material_id ?? undefined}
                    value={leftoverLoc}
                    onChange={v => { setLeftoverLoc(v); setLocError('') }}
                    onHintChange={h => { setLeftoverHint(h); putGate.reset() }}
                  />
                  {putGate.box && <div className="mt-1.5">{putGate.box}</div>}
                  {locError && (
                    <p className="mt-1.5 text-xs font-medium text-red-600 flex items-start gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{locError}
                    </p>
                  )}
                </div>
              )}
              <p className="text-[10px] text-slate-400">Súng quét: bắn lại đúng tem này = Lưu</p>
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
          {feedback?.type === 'queued' && (
            <div className="rounded-lg bg-amber-50 border border-amber-300 p-2.5 text-sm text-amber-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />{feedback.msg}
            </div>
          )}
          {/* Số quét đang chờ mạng của MÃ này — tách bạch khỏi số đã xác nhận */}
          {queuedThisItem > 0 && !feedback && (
            <div className="rounded-lg bg-amber-50 border border-amber-300 px-2.5 py-1.5 text-[11px] font-medium text-amber-700">
              ⏸ {queuedThisItem} lượt quét đang chờ mạng (chưa tính vào số đã xuất)
            </div>
          )}

          <Button variant="outline" className="w-full" onClick={onClose} disabled={saving}>Đóng</Button>
        </div>
      </div>

      {cartonFor && (
        <CartonScanSheet
          open
          palletCode={cartonFor.palletCode}
          codeTypes={codeTypes}
          expectedMaterialCode={expectedMaterialCode}
          saving={attaching}
          onSave={saveCarton}
          onSkip={finishCarton}
        />
      )}
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
  const pctBands = usePctBands()
  const { data: gdo, isLoading, isError } = useGDO(gdoId)
  const pageCodeTypes = useScanCodeTypes(gdo?.warehouse_id)   // quét lại tem thùng của pallet đã lưu
  const { mutate: manualComplete,      isPending: completing    } = useManualCompleteItem()
  const { mutate: deleteScanEntry,     isPending: deleting      } = useDeleteOutboundScanEntry()
  const { mutate: confirmLoose,        isPending: confirming    } = useConfirmLoosePickingItem()
  const { mutate: attachCartonsRow,    isPending: attachingRow  } = useAttachCartonScans()
  const { data: inventoryData = [], isLoading: invLoading } = useItemInventory(gdoId, itemId)
  const { data: stock, isLoading: loadingStock } = useManualItemStock(gdoId, itemId)
  const { vehicles } = useActiveVehiclesStore()

  const [showScan,         setShowScan]         = useState(false)
  const [hdrOpen,          setHdrOpen]          = useState(false)   // mobile: popup thông tin tham khảo (SL/hộp/pallet/DO-NPP)
  const [pdaScan,          setPdaScan]          = useState<string | null>(null)   // tem bắn bằng cò súng tại trang → mở màn quét chế độ súng
  const [confirmScanId,    setConfirmScanId]    = useState<string | null>(null)
  const [showInventory,    setShowInventory]    = useState(false)
  const [confirmLooseOpen, setConfirmLooseOpen] = useState(false)
  const [looseError,       setLooseError]       = useState<string | null>(null)
  const [expandedInvKeys,  setExpandedInvKeys]  = useState<Set<string>>(new Set())
  const [detailEntryId,    setDetailEntryId]    = useState<string | null>(null)
  const [showLoscamDialog, setShowLoscamDialog] = useState(false)
  const [loscamCartons,    setLoscamCartons]    = useState('')
  const [loscamError,      setLoscamError]      = useState('')
  // Mở panel quét tem THÙNG từ 1 dòng pallet đã quét (nút inline cột Mã pallet) — lưu id, derive entry từ scans để luôn fresh
  const [cartonRowId,      setCartonRowId]      = useState<string | null>(null)
  // Dialog DANH SÁCH tem thùng của 1 pallet (bấm badge 🧰) — có ô tìm, thay tooltip
  const [cartonListId,     setCartonListId]     = useState<string | null>(null)
  const [cartonListQ,      setCartonListQ]      = useState('')

  // Ref để auto-open scan chỉ chạy 1 lần khi trang load lần đầu (tránh tái kích hoạt sau mỗi lần delete/confirm)
  const hasAutoScanned = useRef(false)

  // PDA (user 19/07): bóp cò NGAY TẠI TRANG MÃ → tự mở màn quét chế độ SÚNG (không camera),
  // validate mã giữ nguyên (BE chặn tem sai mã của item này như quét thường).
  // Dialog/panel đang mở → TẮT HẲN máy đọc (enabled=false), không chỉ bỏ qua mã — máy đọc bắt
  // chuỗi phím nhanh/IME ở mọi ô nhập rồi trả lại giá trị cũ (bug xe vãng lai 25/08).
  const wedgeFormOpen = !!confirmScanId || confirmLooseOpen || showLoscamDialog || !!cartonRowId || !!cartonListId
  useWedgeScanner(code => {
    if (!gdo || showScan) return
    const it = (gdo.delivery_orders ?? []).flatMap(d => d.items).find(i => i.id === itemId)
    if (!it || it.material?.no_qr_tracking === true || it.status === 'COMPLETED') return
    if (!gdo.started_at || gdo.status === 'PAUSED' || gdo.status === 'COMPLETED') return
    if (!can(perms, 'outbound', 'scan')) return
    unlockAudio()
    setPdaScan(code)
    setShowScan(true)
  }, !wedgeFormOpen)

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
    // Hòa %Date → hàng thường trước QA giữ → vị trí ÍT hàng nhất trước (dọn hàng lẻ) → tên vị trí
    return [...map.values()].sort((a, b) => {
      const pa = a.pct_date ?? Infinity, pb = b.pct_date ?? Infinity
      if (pa !== pb) return pa - pb
      if (a.is_qa !== b.is_qa) return a.is_qa ? 1 : -1
      if (a.cartons !== b.cartons) return a.cartons - b.cartons
      return (a.location_code ?? '').localeCompare(b.location_code ?? '')
    })
  }, [sortedInv])

  // Deep-link cũ / chuyến đã xóa: 404 → gdo mãi undefined → trước đây SKELETON VĨNH VIỄN
  // (trang "trắng" không thông báo, không lối về — đo 31/08). Báo tử tế + link quay lại.
  if (isError || (!isLoading && !gdo)) {
    return (
      <div className="p-6 text-center space-y-2">
        <p className="text-sm text-red-600">Không tìm thấy chuyến — có thể đã bị xóa hoặc đường link đã cũ</p>
        <Link to="/wms/outbound" className="text-xs text-sky-600 underline">← Về Xuất kho</Link>
      </div>
    )
  }
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

  // DO/NPP của dòng này (lấy từ đơn cha) — DO chỉ tham khảo, hiển thị đầy đủ trong header
  const parentDO = (gdo.delivery_orders ?? []).find(d => d.items.some(i => i.id === itemId))
  const doCode   = parentDO?.delivery_code ?? ''
  const doNpp    = (parentDO?.distributor_name ?? '').trim()

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
      {
        onError: (err) => {
          const msg = (err as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi xóa pallet đã quét'
          toast({ variant: 'destructive', title: 'Không xóa được pallet', description: msg })
        },
        onSettled: () => setConfirmScanId(null),
      }
    )
  }

  const confirmScan = scans.find(s => s.id === confirmScanId)

  const loscamCartonNum = parseInt(loscamCartons) || 0
  // Khả dụng CO GIÃN theo chính đơn này = tồn pool + số item này đã lấy (giảm/gỡ luôn được kể cả pool đang 0).
  // Kho NONE / mã không theo dõi pool → không có trần tồn, chỉ chặn theo kế hoạch.
  // (Kho QTY_DATE: lưu ở đây trừ FEFO tự động; muốn chọn đúng NSX → dùng dialog Lưu số lượng ở trang chuyến.)
  const stockCeiling = stock != null && (stock.has_pool || isQtyLike(stock.inventory_mode))
  const elasticAvail = (stock?.cartons_remaining ?? 0) + (stock?.cartons_scanned ?? 0)
  const overStock = stockCeiling && loscamCartonNum > elasticAvail
  const overPlan  = stock != null && loscamCartonNum > (stock.cartons_ordered ?? 0)

  // ── Cụm action header (ActionCluster) — desktop inline, mobile nút chính + menu ⋮ ──
  const actionItems: ActionItem[] = []
  // Tồn kho: bật/tắt panel tồn của mã hàng (giữ màu active khi đang mở)
  actionItems.push({
    key: 'inventory', icon: Package, label: 'Tồn kho',
    tip: `Xem tồn kho trong kho${inventoryData.length > 0 ? ` (${inventoryData.length} pallet)` : ''}`,
    className: showInventory ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' : 'text-slate-500',
    onClick: () => setShowInventory(v => !v),
  })
  // Check nhặt lẻ — xác nhận trừ tồn số thùng lẻ đã chuẩn bị (capability complete, khớp BE)
  if (!!gdo.started_at && item.loose_picking > 0 && looseUnconfirmedCount > 0 && can(perms, 'outbound', 'complete'))
    actionItems.push({
      key: 'confirm-loose', icon: CheckCircle2, label: `Check nhặt lẻ (${looseUnconfirmedCount})`,
      tip: isPaused
        ? 'Chuyến đang tạm dừng — không thể xác nhận'
        : `Xác nhận đã kiểm ${qtyLabel(looseUnconfirmedCount, item.material)} nhặt lẻ — tồn kho sẽ trừ ngay`,
      primary: true, busy: confirming, disabled: isPaused,
      className: 'border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100',
      onClick: () => setConfirmLooseOpen(true),
    })
  if (isNoQr) {
    // "Lưu thủ công" = ghi nhận xuất no-QR — capability QUÉT (khớp BE requirePerm outbound.scan)
    if (can(perms, 'outbound', 'scan'))
      actionItems.push({
        key: 'manual', icon: PenSquare, label: isDone ? 'Sửa SL' : 'Lưu thủ công',
        tip: isPaused ? 'Chuyến đang tạm dừng'
          : !gdo.started_at ? (notStartedMsg ?? 'Cần Bắt đầu trước khi ghi nhận')
          : 'Ghi nhận số thùng xuất thủ công (hàng không tem)',
        primary: true, disabled: isPaused || !gdo.started_at,
        onClick: () => { setLoscamCartons(String(isDone ? item.cartons_scanned : item.cartons_ordered)); setShowLoscamDialog(true) },
      })
  } else if (!isDone && canScan) {
    actionItems.push({
      key: 'scan', icon: ScanIcon, label: 'Quét pallet', tip: 'Quét QR pallet để xuất hàng',
      primary: true, variant: 'default',
      onClick: openScan,
    })
  }

  // Quét tem thùng từ nút inline trên dòng pallet — nạp list đã lưu (replace khi Lưu)
  const cartonRow = cartonRowId ? scans.find(s => s.id === cartonRowId) ?? null : null
  // Danh sách tem thùng (badge 🧰) — lọc theo ô tìm, giới hạn render 500 dòng
  const cartonList = cartonListId ? scans.find(s => s.id === cartonListId) ?? null : null
  const cartonListAll = cartonList?.carton_scans ?? []
  const cartonListFiltered = cartonListQ.trim()
    ? cartonListAll.filter(c => c.code.toLowerCase().includes(cartonListQ.trim().toLowerCase()))
    : cartonListAll

  // Thông tin THAM KHẢO (SL/hộp/nhặt lẻ/pallet/loại) — desktop inline; mobile mở popup Info.
  // (Điều kiện quét sống còn: tên+tiến độ+Batch/%Date+ghi chú đỏ vẫn LUÔN hiện, không vào popup.)
  const refInfoJSX = (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs ${itemStatusText(item.status)}`}>
      <span className="flex items-center gap-1">
        <Package className="h-3 w-3 text-slate-400 shrink-0" />
        <span className="font-medium">{qtyEntryText(item.cartons_ordered, item.material)}</span> {qtyUnitLabel(item.material)}
        {item.boxes_display > 0 && (
          <span className="ml-1">· <span className="font-medium">{item.boxes_display}</span> hộp</span>
        )}
        {item.loose_picking > 0 && (
          <span className="ml-1">· nhặt lẻ <span className="font-medium">{qtyLabel(item.loose_picking, item.material)}</span></span>
        )}
      </span>
      {item.pallets_estimated > 0 && (
        <span><span className="font-medium">{item.pallets_estimated}</span> pl</span>
      )}
      {item.material_type && (
        <span className="bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{item.material_type}</span>
      )}
      {doCode && (
        <span><span className="text-slate-400">DO:</span> <span className="font-mono break-all">{doCode}</span></span>
      )}
    </div>
  )

  return (
    <>
      {/* Mobile: popup thông tin tham khảo mã hàng (desktop hiện inline) */}
      <Dialog open={hdrOpen} onOpenChange={setHdrOpen}>
        <DialogContent className="max-w-[94vw] sm:max-w-md p-3 gap-2">
          <DialogHeader><DialogTitle className="text-sm font-semibold">Thông tin mã · {matCode}</DialogTitle></DialogHeader>
          {doNpp && <p className="text-xs text-slate-600"><span className="text-slate-400">NPP:</span> <span className="font-medium">{doNpp}</span></p>}
          {refInfoJSX}
        </DialogContent>
      </Dialog>
      {showScan && (
        <ScanDialog item={item} gdoId={gdoId!} warehouseId={gdo.warehouse_id} cartonScanEnabled={!!gdo.carton_scan_enabled}
          pdaMode={!!pdaScan} initialScan={pdaScan ?? undefined}
          onClose={() => { setShowScan(false); setPdaScan(null) }} />
      )}

      {cartonRow && (
        <CartonScanSheet
          open
          palletCode={cartonRow.pallet_code}
          codeTypes={pageCodeTypes}
          expectedMaterialCode={item.material?.material_code ?? materialCodeOf(item.material_code_raw) ?? ''}
          initial={(cartonRow.carton_scans ?? []).map(c => ({ code: c.code, match: c.match, at: c.at ? new Date(c.at).getTime() : Date.now() }))}
          saving={attachingRow}
          onSave={list => attachCartonsRow({ gdoId: gdoId!, scanId: cartonRow.id, cartons: list }, {
            onSuccess: () => setCartonRowId(null),
            onError: (err) => toast({
              variant: 'destructive', title: 'Lưu mã thùng lỗi',
              description: (err as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không lưu được danh sách thùng',
            }),
          })}
          onSkip={() => setCartonRowId(null)}
        />
      )}

      {/* Dialog danh sách tem thùng của 1 pallet (badge 🧰) — ô tìm thay tooltip */}
      <Dialog open={!!cartonList} onOpenChange={o => { if (!o) { setCartonListId(null); setCartonListQ('') } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              🧰 Tem thùng — pallet <span className="font-mono">{cartonList?.pallet_code}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span><b className="text-green-700">{cartonListAll.filter(c => c.match !== false).length}</b> khớp mã</span>
            {cartonListAll.some(c => c.match === false) && (
              <span><b className="text-amber-600">{cartonListAll.filter(c => c.match === false).length}</b> lạ mã hàng</span>
            )}
            <span className="ml-auto">{cartonListAll.length} tem</span>
          </div>
          <Input value={cartonListQ} onChange={e => setCartonListQ(e.target.value)}
            placeholder="Tìm mã tem…" className="h-8 text-xs font-mono" />
          <div className="max-h-[50vh] overflow-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {cartonListFiltered.length === 0 ? (
              <p className="text-xs text-slate-400 p-4 text-center">Không có tem khớp từ khóa</p>
            ) : cartonListFiltered.slice(0, 500).map(c => (
              <div key={c.code} className="flex items-center gap-2 px-2 py-1">
                <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${c.match !== false ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {c.match !== false ? '✓' : 'lạ'}
                </span>
                <span className="font-mono text-[10px] font-semibold text-slate-700 truncate">{c.code}</span>
                {c.at && <span className="ml-auto shrink-0 text-[9px] text-slate-400 tabular-nums">{formatTimestampTime(c.at)}</span>}
              </div>
            ))}
            {cartonListFiltered.length > 500 && (
              <p className="text-[10px] text-slate-400 p-2 text-center">Hiện 500/{cartonListFiltered.length} — gõ từ khóa để thu hẹp</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmScanId}
        title="Hủy pallet đã quét"
        message={confirmScan
          ? `Xác nhận hủy pallet "${confirmScan.pallet_code}" (${qtyLabel(confirmScan.cartons_scanned, item.material)})? Tồn kho sẽ được hoàn lại.`
          : ''}
        onConfirm={handleDeleteScan}
        onCancel={() => setConfirmScanId(null)}
        loading={deleting}
      />

      <ConfirmDialog
        open={confirmLooseOpen}
        title="Xác nhận nhặt lẻ"
        message={`Xác nhận đã kiểm tra ${qtyLabel(looseUnconfirmedCount, item.material)} nhặt lẻ cho mã này? Tồn kho sẽ được trừ ngay.`}
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
                  <div className="text-base font-bold tabular-nums text-slate-700">{qtyEntryText(stock?.cartons_ordered ?? item.cartons_ordered, item.material)}</div>
                  <div className="text-[9px] text-slate-400">{qtyUnitLabel(item.material)}</div>
                </div>
                <div className="w-px bg-slate-200" />
                <div className="flex-1 text-center">
                  <div className="text-[10px] text-slate-500 mb-0.5">Tồn khả dụng</div>
                  <div className={`text-base font-bold tabular-nums ${stockCeiling && elasticAvail === 0 ? 'text-red-600' : 'text-green-600'}`}>{stockCeiling ? qtyEntryText(elasticAvail, item.material) : '—'}</div>
                  <div className="text-[9px] text-slate-400">{qtyUnitLabel(item.material)}</div>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs text-slate-600">Số lượng xuất</p>
              <QtyInput autoFocus
                className={`${overPlan ? '[&_input]:border-red-400' : overStock ? '[&_input]:border-amber-400' : ''}`}
                value={Math.max(0, parseInt(loscamCartons) || 0)}
                mat={item.material}
                onChange={b => { setLoscamCartons(String(b)); setLoscamError('') }}
              />
              {overPlan && (
                <p className="text-xs text-red-600">Vượt kế hoạch ({qtyLabel(stock?.cartons_ordered ?? item.cartons_ordered, item.material)})</p>
              )}
              {!overPlan && overStock && (
                <p className="text-xs text-amber-600">Vượt tồn khả dụng ({qtyLabel(elasticAvail, item.material)})</p>
              )}
            </div>

            {loscamError && <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{loscamError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowLoscamDialog(false); setLoscamError('') }} disabled={completing}>Hủy</Button>
            <Button size="sm" disabled={completing || isPaused || !gdo.started_at || overStock || overPlan}
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

      {/* Khung card chuẩn như OutboundDetail (user 19/08 "fit màn hình đồng nhất") */}
      <div className="flex flex-col h-full min-h-0 sm:p-3">
       <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">

        {/* ── Header: ~30% ── */}
        <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 overflow-y-auto" style={{ maxHeight: '30vh' }}>

          {/* Row 1: back + code + status + cụm action — flex-wrap để cụm xuống dòng thay vì bị cắt trên màn hẹp */}
          <div className="flex items-center gap-x-2 gap-y-1.5">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <button
                onClick={() => navigate(`/wms/outbound/${gdoId}`)}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className={`font-mono font-semibold text-xs sm:text-sm leading-tight break-all whitespace-normal sm:truncate min-w-0 ${itemStatusText(item.status)}`}>{matCode}</span>
              <OutboundStatusBadge status={item.status} />
              <button
                onClick={() => setHdrOpen(true)}
                className="sm:hidden p-1 rounded hover:bg-slate-100 text-slate-400 shrink-0"
                title="Thông tin mã · NPP · DO"
              >
                <Info className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {!isNoQr && !isDone && !canScan && (
                <span className="text-xs text-slate-400 italic hidden sm:inline">Chưa bắt đầu</span>
              )}
              {!isNoQr && !isDone && canScan && <PdaGunHint />}
              <ActionCluster items={actionItems} />
            </div>
          </div>

          {/* Row 2: material name — tiến độ gộp xuống dòng heading "Pallet đã quét" */}
          <p className={`text-sm font-medium leading-tight ${itemStatusText(item.status)}`}>{matName}</p>

          {/* Row 3: SL/meta THAM KHẢO — desktop inline; mobile xem qua popup Info (điều kiện đỏ vẫn hiện dưới) */}
          <div className="hidden sm:block">{refInfoJSX}</div>

          {/* Row 3b: NPP (dòng riêng, wrap an toàn — không chèn dòng 1 để khỏi bị che) + điều kiện xuất Batch/%Date ĐỎ. DO nằm trong nút Info */}
          {(doNpp || item.batch_required || (item.date_required != null && item.date_required > 0)) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] min-w-0">
              {doNpp && <span className="text-slate-600 truncate max-w-full"><span className="text-slate-400">NPP:</span> <span className="font-medium">{doNpp}</span></span>}
              {item.batch_required && (
                <span className="font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">Batch: {item.batch_required}</span>
              )}
              {item.date_required != null && item.date_required > 0 && (
                <span className="font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">%Date ≥ {item.date_required}%</span>
              )}
            </div>
          )}

          {/* Header text: highlight ĐỎ nổi bật (ghi chú/điều kiện xuất quan trọng) */}
          {item.header_text && (
            <div className="text-xs font-semibold text-red-600 bg-red-50 border border-red-300 rounded px-2 py-1 leading-snug break-words">
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
                          <TableCell className="px-2 py-1">
                            <div className="flex items-center gap-1.5">
                              {row.pct_date !== null ? (
                                <span className={`text-xs font-bold tabular-nums ${pctDateCls(row.pct_date, pctBands)}`}>{row.pct_date}%</span>
                              ) : <span className="text-[10px] text-slate-400">Chưa có</span>}
                              {row.is_qa && (
                                <span className="text-[9px] font-medium text-purple-700 bg-purple-100 rounded px-1.5 py-0.5">QA giữ</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="px-2 py-1">
                            <span className="text-[10px] font-mono text-slate-600">{row.location_code ?? '—'}</span>
                          </TableCell>
                          <TableCell className="px-2 py-1 text-right whitespace-nowrap">
                            <span className={`text-[10px] font-semibold tabular-nums ${row.is_qa ? 'text-purple-700' : ''}`}>{qtyEntryText(row.cartons, item.material)}</span>
                            <span className="text-[9px] text-slate-400 ml-0.5">{qtyUnitLabel(item.material)}</span>
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
                              <span className="text-[10px] font-semibold tabular-nums text-blue-700">{qtyEntryText(e.available, item.material)}</span>
                              <span className="text-[9px] text-slate-400 ml-0.5">{qtyUnitLabel(item.material)}</span>
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

        {/* Heading + tiến độ — thanh CỐ ĐỊNH (ngoài vùng cuộn ngang) nên không bị trôi/cắt khi kéo bảng */}
        <div className="border-b bg-white px-3 py-1.5 shrink-0 flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-700 shrink-0 whitespace-nowrap">
            Pallet đã quét
            <span className="ml-1 text-xs font-normal text-slate-400">{scans.length} pallet</span>
          </h2>
          <div className="flex-1 min-w-0">
            <ProgressBar scanned={item.cartons_scanned} ordered={item.cartons_ordered} looseUnconfirmed={looseUnconfirmedCount} mat={item.material} />
          </div>
        </div>

        {/* ── Scan list: ~70% ── */}
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <div className="p-3">

          {/* min-w-max: Card nở đúng bằng bảng (min-w-[520]) để nền+viền phủ trọn, không để lộ vạch xám giữa bảng khi cuộn ngang */}
          <Card className="min-w-max">
            {scans.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                <ScanIcon className="h-10 w-10 opacity-30" />
                <p className="text-sm">Chưa có pallet nào được quét</p>
                {!isDone && !isNoQr && canScan && (
                  <Button size="sm" variant="outline" onClick={openScan}>
                    <ScanIcon className="h-4 w-4 mr-1" /> Quét pallet đầu tiên
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
                    const { bad: isSubOptimal, bestDate: rotBest } = scanRotationOf(se)
                    return (
                      <TableRow key={se.id} className={se.is_loose_picking && !se.loose_confirmed ? 'bg-purple-50' : ''}>
                        <TableCell className="px-2 py-1">
                          <div className="flex items-center gap-1.5">
                            <div className={`font-mono text-[10px] font-semibold ${isSubOptimal ? 'text-red-600' : 'text-slate-700'}`}>
                              {se.pallet_code}
                            </div>
                            {/* Quét tem thùng cho pallet này — quyền đi chung Quét pallet (BE PATCH cartons cũng gate outbound.scan) */}
                            {!!gdo.carton_scan_enabled && can(perms, 'outbound', 'scan') && (
                              <button
                                className={`ml-auto shrink-0 !min-h-0 !min-w-0 p-1 rounded transition-colors ${isPaused ? 'text-slate-200 cursor-not-allowed' : 'text-sky-500 hover:text-sky-700 hover:bg-sky-50'}`}
                                title={isPaused ? 'Chuyến đang tạm dừng' : `Quét tem thùng của pallet này${Array.isArray(se.carton_scans) && se.carton_scans.length > 0 ? ' (đã có ' + se.carton_scans.length + ' thùng — quét thêm/sửa)' : ''}`}
                                disabled={isPaused}
                                onClick={() => !isPaused && setCartonRowId(se.id)}
                              >
                                <ScanIcon className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          {Array.isArray(se.carton_scans) && se.carton_scans.length > 0 && (() => {
                            const cs = se.carton_scans!
                            const odd = cs.filter(c => c.match === false).length
                            return (
                              <button
                                className="inline-flex items-center gap-1 mt-0.5 text-[9px] text-slate-500 bg-slate-100 hover:bg-sky-100 hover:text-sky-700 rounded px-1.5 py-0.5 !min-h-0 !min-w-0 transition-colors"
                                title="Xem danh sách tem thùng đã quét"
                                onClick={e => { e.stopPropagation(); setCartonListId(se.id) }}>
                                🧰 {cs.length} thùng{odd > 0 && <span className="text-amber-600 font-semibold">· {odd} lạ</span>}
                              </button>
                            )
                          })()}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-right tabular-nums text-[10px] font-semibold">
                          {qtyEntryText(se.cartons_scanned, item.material)}
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          {se.is_loose_picking ? (
                            se.loose_confirmed
                              ? <span className="text-[9px] font-medium text-green-700 bg-green-100 rounded px-1.5 py-0.5">✓ Lẻ</span>
                              : <span className="text-[9px] font-medium text-purple-700 bg-purple-100 rounded px-1.5 py-0.5">Lẻ</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          {se.pct_date !== null ? (
                            <span className={`text-[10px] font-bold tabular-nums ${pctDateCls(se.pct_date, pctBands)}`}>{se.pct_date}%</span>
                          ) : <span className="text-[10px] text-slate-300">—</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          <span className="text-[10px] font-mono tabular-nums text-slate-600">
                            {se.production_date ? format(parseISO(se.production_date), 'dd-MM-yyyy') : '—'}
                          </span>
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          {rotBest ? (
                            <span className={`text-[10px] font-mono tabular-nums ${isSubOptimal ? 'text-orange-600 font-semibold' : 'text-slate-500'}`}>
                              {isSubOptimal ? '⚠ ' : ''}{format(parseISO(rotBest), 'dd-MM-yyyy')}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-2 py-1">
                          <span className="text-[10px] text-slate-500">{se.scanned_by_emp?.name ?? se.scanned_by ?? '—'}</span>
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap tabular-nums">
                          <div className="text-[10px] leading-tight text-slate-500">{se.scanned_at ? formatTimestampDate(se.scanned_at, true) : '—'}</div>
                          <div className="text-[9px] leading-tight text-slate-400">{se.scanned_at ? formatTimestampTime(se.scanned_at) : ''}</div>
                        </TableCell>
                        <TableCell className="px-1 py-1">
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
      </div>
    </>
  )
}
