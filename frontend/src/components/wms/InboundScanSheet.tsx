import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AxiosError } from 'axios'
import { MapPin, AlertTriangle, CheckCircle2, QrCode } from 'lucide-react'
import { QRScanner }           from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { Button }              from '@/components/ui/button'
import { Label }               from '@/components/ui/label'
import { useScanPallet, useCheckInboundScan, useInboundOrder, useLocationsReal, useTransportCompanies } from '@/api/hooks'
import { enqueueScan, isConnectivityError, useScanQueue } from '@/offline/scanQueue'
import { OfflineError } from '@/api/client'
import { playBeep } from '@/utils/audio'
import { qtyLabel, hasEntry } from '@/utils/qtyUnits'
import { QtyInput } from '@/components/shared/QtyInput'
import { normalizeQR, isValidDMY } from '@/utils/qr'
import { effCartonsPerPallet } from '@/utils/palletCalc'
import { requiresNcc, isNccCategory } from '@/utils/cargoCategory'
import { useWhTypeMetaMapFor } from '@/hooks/useWhTypeMeta'
import { PutawayOption } from '@/components/wms/PutawayOption'
import { LocationContents } from '@/components/wms/LocationContents'
import { PUTAWAY_OVERRIDE_REASONS, type PutawayHint } from '@/utils/putaway'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import type { InboundOrder } from '@/types'
import { useScanCodeTypes } from '@/hooks/useScanCodeTypes'

// ─── Scan feedback banner ─────────────────────────────────────

type FeedbackState = { type: 'success' | 'error' | 'queued'; msg: string }

function ScanFeedback({ state }: { state: FeedbackState }) {
  if (state.type === 'success') {
    return (
      <div className="rounded-lg bg-green-50 border border-green-200 p-2.5 text-sm text-green-800 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>{state.msg}</span>
      </div>
    )
  }
  if (state.type === 'queued') {
    // Offline: lượt quét đã vào hàng đợi — SỐ TẠM, chưa được server xác nhận
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-300 p-2.5 text-sm text-amber-800 flex items-center gap-2">
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

// Tem V2 (`;` — đơn vị 2): Mã hàng;QA;Mã lô;NSX;HSD;Mẻ;Giờ:Phút — khớp backend parseInboundQR nhánh v2
function validateQRv2(raw: string, order: InboundOrder): ValidationResult {
  const parts = raw.trim().split(';').map(p => p.trim())
  if (parts.length < 5) {
    return { ok: false, msg: `Định dạng QR không hợp lệ (${parts.length} phần, cần ≥5: Mã hàng;QA;Mã lô;NSX;HSD)` }
  }
  const [qrMatRaw, qaStr, batch, nsx, hsd] = parts
  if (!batch) return { ok: false, msg: 'QR thiếu mã lô (phần 3)' }
  if (!isValidDMY(nsx ?? '')) return { ok: false, msg: `NSX không hợp lệ — cần dd/mm/yyyy (nhận được: "${nsx ?? ''}")` }
  if (!isValidDMY(hsd ?? '')) return { ok: false, msg: `HSD không hợp lệ — cần dd/mm/yyyy (nhận được: "${hsd ?? ''}")` }
  const qrMat    = (qrMatRaw ?? '').toUpperCase()
  const orderMat = (order.material?.material_code ?? '').trim().toUpperCase()
  if (orderMat && qrMat !== orderMat) {
    return { ok: false, msg: `Sai mã hàng — QR: "${qrMatRaw}", phiếu: "${order.material?.material_code}"` }
  }
  const norm = normalizeQR(raw)
  const alreadyIn = order.inventory_entries?.some(e => e.pallet_code === norm)
  if (alreadyIn) return { ok: false, msg: 'Pallet này đã được nhập trong phiếu' }
  return { ok: true, msg: `Hợp lệ · ${order.material?.material_code} · QA ${qaStr === '1' ? 'OK' : 'X'} · HSD ${hsd}` }
}

function validateQR(raw: string, order: InboundOrder): ValidationResult {
  if (raw.includes(';')) return validateQRv2(raw, order)
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
  // 50 dòng khớp từ khoá HIỆN TẠI (cha query với search+limit) — KHÔNG còn là cả kho.
  allLocations: { id: string; location_code: string; sub_code: string; max_pallets: number; used_slots?: number; categories?: string[] | null; putaway?: PutawayHint | null }[]
  onLocSearch?: (term: string) => void   // gõ trong picker → cha đổi từ khoá query (tìm trên server)
  pdaMode?: boolean          // mở bằng cò súng cấp trang → mở thẳng chế độ súng (không bật camera)
  initialScan?: string       // tem đã bắn ở trang phiếu → xử lý ngay khi mở
}

export function InboundScanSheet({ order, onClose, employeeId, allLocations, onLocSearch, pdaMode = false, initialScan }: InboundScanSheetProps) {
  const scannerRef = useRef<QRScannerHandle>(null)
  const codeTypes = useScanCodeTypes(order.warehouse_id)   // loại mã camera giải = theo KHO CỦA PHIẾU
  const { mutate: scanPallet,  isPending: saving        } = useScanPallet()
  const { mutate: checkScan,   isPending: serverChecking } = useCheckInboundScan()

  // BASE UNIT: định mức cartons_per_pallet = THÙNG VẬT LÝ → nhân units_per_carton ra BASE (hộp)
  // để gửi cartons_override đúng base (mã có entry). Mã không entry: hệ số 1.
  const qtyFactor = hasEntry(order.material) ? Number(order.material?.units_per_carton) : 1
  const defaultCartons = (effCartonsPerPallet(order.material, order.warehouse_id) * qtyFactor).toString()
  // NCC + shelflife theo lô. 1 mã + 1 NCC có thể nhiều shelflife (100/200) → chọn NCC = chọn luôn shelflife.
  const isTransfer = (order as { source_type?: string }).source_type === 'TRANSFER'
  const { data: allCompanies = [] } = useTransportCompanies(true)
  const allNcc = (allCompanies as { id: string; name: string; type?: string }[]).filter(c => c.type === 'NCC')
  const nccName = (id: string) => allNcc.find(n => n.id === id)?.name ?? '(NCC?)'
  const shelfOv = order.material?.supplier_shelf_life_overrides ?? []
  // Biến thể đã khai cho mã hàng này (ưu tiên hiện): mỗi dòng = 1 (NCC, shelflife)
  const variants: { key: string; ncc_id: string; shelf: number | null; label: string }[] = shelfOv
    .filter(o => allNcc.some(n => n.id === o.transport_company_id))
    .map(o => ({ key: `${o.transport_company_id}|${o.shelf_life_days}`, ncc_id: o.transport_company_id, shelf: o.shelf_life_days, label: `${nccName(o.transport_company_id)} (${o.shelf_life_days} ngày)` }))
  // Ưu tiên hiện: biến thể của mã + NCC của phiếu (nếu chưa khai biến thể) → tránh chọn nhầm NCC
  const baseOpts = [...variants]
  if (order.ncc_id && !variants.some(v => v.ncc_id === order.ncc_id)) {
    baseOpts.push({ key: `${order.ncc_id}|`, ncc_id: order.ncc_id, shelf: null, label: nccName(order.ncc_id) })
  }
  // Cờ requires_ncc của Loại kho: pallet mới phải có NCC (chuyển kho kế thừa — không chặn)
  // Cờ hiệu lực TẠI KHO của phiếu (kho khai riêng được — 21/08)
  const whTypeMeta = useWhTypeMetaMapFor(order.warehouse_id)
  const matCategory = (order.material as { category?: string | null } | undefined)?.category ?? ''
  const nccRequired = !isTransfer && requiresNcc(matCategory, whTypeMeta)
  const nccRelevant = isTransfer || !!order.ncc_id || variants.length > 0 || nccRequired
  // Mặc định: kế thừa (transfer) hoặc NCC của phiếu; nếu NCC đó chỉ 1 shelflife thì set luôn shelflife
  const ordVarsForNcc = order.ncc_id ? variants.filter(v => v.ncc_id === order.ncc_id) : []
  const initNcc   = isTransfer ? '' : (order.ncc_id ?? '')
  const initShelf = (!isTransfer && ordVarsForNcc.length === 1) ? ordVarsForNcc[0].shelf : null
  const [nccId,            setNccId]            = useState(initNcc)        // '' = tự kế thừa (transfer)
  const [shelfDays,        setShelfDays]        = useState<number | null>(initShelf)
  const [nccExpanded,      setNccExpanded]      = useState(false)          // mở rộng = hiện tất cả NCC
  const [cartons,          setCartons]          = useState(defaultCartons)
  const [stackLayer,       setStackLayer]       = useState('1')
  const [feedback,         setFeedback]         = useState<FeedbackState | null>(null)
  const [pendingQR,        setPendingQR]        = useState<string | null>(null)
  const [validation,       setValidation]       = useState<ValidationResult | null>(null)
  const [serverCheckOk,    setServerCheckOk]    = useState(false)
  const [mergeWarning,     setMergeWarning]     = useState<string | null>(null)
  const [outboundCartons,  setOutboundCartons]  = useState<number | null>(null)
  // Kho bật "bắt buộc cất đúng quy tắc" mà vị trí đang chọn vi phạm (BE trả 422 PUTAWAY_VIOLATION)
  const [putawayBlock,     setPutawayBlock]     = useState<string | null>(null)
  const [putawayReason,    setPutawayReason]    = useState('')
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const canPutawayOverride = can(perms, 'inbound', 'putaway_override')

  // Đổi vị trí: activeLocationId có thể khác order.location_id khi overflow
  const [activeLocationId, setActiveLocationId] = useState<string>(order.location_id ?? '')
  const [showLocPicker,    setShowLocPicker]    = useState(!order.location_id) // NCC: mở picker ngay
  // Súng PDA: 1 phát bắn 'wedge' → khóa chế độ súng (tắt camera cả phiên, đỡ pin/nóng máy).
  // pdaMode = mở bằng cò súng cấp trang → vào thẳng chế độ súng ngay.
  const [gunMode,          setGunMode]          = useState(pdaMode)

  const activeLoc = allLocations.find(l => l.id === activeLocationId)

  function handleScan(raw: string, src: 'camera' | 'wedge' = 'camera') {
    // Bắn bằng súng → khóa chế độ súng (camera không tự bật lại sau khi Lưu)
    if (src === 'wedge' && !gunMode) setGunMode(true)
    // Đang xử lý / lưu → bỏ qua lượt bắn mới (camera tự pause; súng bắn bất kỳ lúc nào nên cần guard)
    if (saving || serverChecking) return
    if (!activeLocationId) {
      setShowLocPicker(true)
      return
    }
    // Đang chờ xác nhận Lưu: bắn LẠI đúng tem đó = bấm Lưu (giống Xuất; camera đứng yên KHÔNG tự lưu).
    // Tem khác trong lúc đang chờ → bỏ qua (buộc "Quét tiếp"/Lưu trước).
    if (pendingQR) {
      const savable = serverCheckOk && !serverChecking && !nccMissing
      if (src === 'wedge' && savable && normalizeQR(raw) === normalizeQR(pendingQR)) { playBeep(); handleSave() }
      return
    }
    playBeep()
    setPendingQR(raw)
    setFeedback(null)
    setServerCheckOk(false)
    // Tem MỚI = trạng thái chặn/lý do của tem cũ hết hiệu lực (phòng thủ: hiện tại lượt mới chỉ vào
    // được sau "Quét tiếp" hoặc lưu xong, cả hai đều đã xoá — nhưng đừng để phụ thuộc vào điều đó)
    setPutawayBlock(null)
    setPutawayReason('')

    const val = validateQR(raw, order)
    setValidation(val)
    if (!val.ok) return

    // Tối ưu: mã thường (không phải chuyển kho) — số thùng đã biết tại client (cartons_per_pallet),
    // bỏ qua round-trip "xác thực", để bước Lưu tự validate. Chuyển kho cần check để lấy số đã
    // xuất (suggested) + cảnh báo gộp tồn.
    if ((order as any).source_type !== 'TRANSFER') {
      setCartons(defaultCartons)
      setServerCheckOk(true)
      return
    }

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
          // Chuyển kho BẮT BUỘC online (cần đối chiếu số đã xuất từ server) — không vào queue
          const msg = isConnectivityError(err)
            ? 'Mất kết nối mạng — phiếu CHUYỂN KHO cần mạng để đối chiếu số xuất. Quét lại khi có mạng.'
            : (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setValidation({ ok: false, msg })
        },
      }
    )
  }

  // reason truyền THẲNG (không đọc state): bấm nút lý do rồi lưu ngay trong cùng lượt render,
  // state chưa kịp cập nhật nên đọc `putawayReason` ở đây sẽ gửi lên giá trị RỖNG.
  function handleSave(reason?: string) {
    if (!pendingQR || !serverCheckOk || saving) return
    if (!activeLocationId) {
      setShowLocPicker(true)
      return
    }
    scanPallet(
      { orderId: order.id, qr_code: pendingQR, location_id: activeLocationId, stack_layer: Number(stackLayer), cartons_override: Number(cartons) || undefined, employee_id: employeeId, ncc_id: nccId || undefined, shelf_life_days: shelfDays ?? undefined, putaway_override_reason: reason || putawayReason || undefined },
      {
        onSuccess: (data) => {
          setPendingQR(null)
          setValidation(null)
          setServerCheckOk(false)
          setMergeWarning(null)
          setOutboundCartons(null)
          setCartons(defaultCartons)
          setPutawayBlock(null)
          setPutawayReason('')
          const successMsg = data.merged
            ? `✓ Đã cộng ${qtyLabel(data.added_cartons, order.material)} · Tồn mới: ${qtyLabel(data.new_remaining, order.material)}`
            : `✓ ${data.entry.pallet_code} · ${qtyLabel(data.entry.cartons_imported, order.material)} · ${data.entry.location?.location_code ?? ''}`
          const warns: string[] = data.warnings ?? []
          // Có cảnh báo (vd chưa xác định NCC) → giữ lâu hơn để đọc
          setFeedback(warns.length ? { type: 'error', msg: `${successMsg} · ⚠ ${warns.join(' · ')}` } : { type: 'success', msg: successMsg })
          setTimeout(() => { scannerRef.current?.resume(); setFeedback(null) }, warns.length ? 4000 : 1500)
        },
        onError: (err) => {
          const ax = err as AxiosError<{ error: { code?: string; message: string } }>
          // Kho BẮT BUỘC cất đúng quy tắc và vị trí này vi phạm → GIỮ NGUYÊN lượt quét để người
          // quét đổi vị trí hoặc (nếu có quyền) chọn lý do rồi Lưu lại. Không xoá pendingQR, không
          // xếp hàng đợi offline: đây là từ chối có chủ đích của server, không phải lỗi mạng.
          // (Cố ý KHÔNG gọi check-scan trước mỗi lượt để đỡ 1 round-trip trên PDA — ô bị chặn đã
          //  bị gạch sẵn trong picker, nên rơi vào đây là ca hiếm.)
          if (ax?.response?.data?.error?.code === 'PUTAWAY_VIOLATION') {
            setPutawayBlock(ax.response!.data.error.message)
            setFeedback(null)
            return
          }
          const qrToQueue = pendingQR
          setPendingQR(null)
          setValidation(null)
          setServerCheckOk(false)
          setMergeWarning(null)
          setOutboundCartons(null)
          setCartons(defaultCartons)
          // Lỗi KẾT NỐI (offline / mạng rớt giữa chừng) → xếp hàng đợi, server phân
          // xử lúc sync (unique (kho,pallet) chống trùng tuyệt đối). Chỉ quét QR mới
          // được vào queue — xem offline/scanQueue.ts.
          if (isConnectivityError(err) && qrToQueue) {
            const norm = normalizeQR(qrToQueue)
            const { queued, duplicate } = enqueueScan({
              kind: 'inbound',
              url: `/wms/inbound-orders/${order.id}/scan`,
              body: {
                qr_code: qrToQueue, location_id: activeLocationId, stack_layer: Number(stackLayer),
                cartons_override: Number(cartons) || undefined, employee_id: employeeId,
                ncc_id: nccId || undefined, shelf_life_days: shelfDays ?? undefined,
              },
              pallet_code: norm,
              label: `Phiếu nhập ${order.material?.material_code ?? ''} · ${activeLoc?.location_code ?? ''}`,
              orderId: order.id,
              // Lỗi mạng SAU khi gửi (không phải chặn offline tức thì) → kết quả không
              // rõ, replay gặp "trùng" sẽ coi là đã lên từ lần này
              uncertain: !(err instanceof OfflineError),
            })
            setFeedback({
              type: 'queued',
              msg: duplicate
                ? `⏸ Pallet này ĐÃ trong hàng đợi chờ mạng (${queued} chờ)`
                : `⏸ Mất mạng — đã xếp hàng chờ (${queued} chờ) · ${norm}`,
            })
            setTimeout(() => { scannerRef.current?.resume(); setFeedback(null) }, 2000)
            return
          }
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
    // Bỏ lượt quét thì phải bỏ luôn trạng thái chặn CỦA CHÍNH lượt đó. Không xoá `putawayReason`
    // thì lượt quét SAU bị chặn sẽ tự động dùng lại lý do cũ mà người quét không hề chọn —
    // vết vượt rào gán sai pallet, đúng thứ mà danh sách lý do cố định sinh ra để tránh.
    setPutawayBlock(null)
    setPutawayReason('')
    scannerRef.current?.resume()
  }

  // Súng PDA: chỉ bật khi đã vào giao diện vị trí/mã hàng (đã chọn vị trí) — như yêu cầu vận hành.
  // handleScan tự chặn khi chưa chọn vị trí / đang lưu nên an toàn kể cả khi enabled đổi.
  useWedgeScanner(code => handleScan(code, 'wedge'), !!activeLocationId)

  // Cò súng cấp trang: mở sheet kèm tem đầu → xử lý NGAY 1 lần (activeLocationId đã có vì trang gate theo vị trí).
  const initialDone = useRef(false)
  useEffect(() => {
    if (initialScan && !initialDone.current) { initialDone.current = true; handleScan(initialScan, 'wedge') }
  }, [initialScan]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tem V1 hàng NCC: đoạn 4 QR = mã NCC, BE tự resolve → không chặn ở FE (BE 422 nếu resolve thất bại)
  const v1AutoNcc = !!pendingQR && !pendingQR.includes(';') && isNccCategory(matCategory, whTypeMeta)
  const nccMissing = nccRequired && !nccId && !v1AutoNcc
  const canSave = !!pendingQR && serverCheckOk && !saving && !serverChecking && !nccMissing
  // Số lượt quét của PHIẾU NÀY đang chờ mạng (hàng đợi offline)
  const queuedThisOrder = useScanQueue(s =>
    s.items.filter(i => i.status === 'pending' && i.orderId === order.id).length)

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col pointer-events-auto">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Bottom sheet — 1 màn không cuộn: chiều cao cố định, camera flex-1 lấp đầy phần còn lại */}
      <div className="relative mt-auto bg-white rounded-t-2xl h-[92dvh] flex flex-col overflow-hidden">
        <div className="p-4 flex-1 flex flex-col gap-3 min-h-0">

          {/* Subtitle: material + active location + "Đổi vị trí" button */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500 min-w-0">
              <span className="font-medium text-slate-700">{order.material?.material_code}</span>
              {order.material?.short_name && <span className="text-slate-500"> · {order.material.short_name}</span>}
              {activeLoc && <span className="font-mono"> · {activeLoc.location_code}</span>}
              {!activeLocationId && <span className="text-amber-500"> · Chưa chọn vị trí</span>}
              {/* Số quét đang chờ mạng của phiếu này — TÁCH BẠCH khỏi số đã xác nhận */}
              {queuedThisOrder > 0 && (
                <span className="ml-1 rounded-full bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 whitespace-nowrap">
                  ⏸ {queuedThisOrder} chờ mạng
                </span>
              )}
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

          {/* NCC + shelflife: ưu tiên NCC của mã hàng; "Mở rộng" mới hiện tất cả NCC (tránh chọn nhầm) */}
          {nccRelevant && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-slate-500 shrink-0">NCC</Label>
                <select
                  value={nccId ? `${nccId}|${shelfDays ?? ''}` : ''}
                  onChange={e => {
                    const [id, sh] = e.target.value.split('|')
                    setNccId(id || '')
                    setShelfDays(sh ? Number(sh) : null)
                  }}
                  className="h-8 flex-1 rounded-md border border-input bg-white px-2 text-xs"
                >
                  <option value="">{isTransfer ? '— Tự kế thừa từ pallet gốc —' : nccRequired ? '— Chọn NCC (bắt buộc) —' : '— Không NCC —'}</option>
                  {baseOpts.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                  {nccExpanded && allNcc.filter(n => !baseOpts.some(v => v.ncc_id === n.id)).map(n => (
                    <option key={n.id} value={`${n.id}|`}>{n.name}</option>
                  ))}
                </select>
              </div>
              <button type="button" onClick={() => setNccExpanded(x => !x)} className="ml-[2.75rem] text-[10px] text-sky-600 hover:underline">
                {nccExpanded ? 'Thu gọn' : 'Mở rộng: tất cả NCC'}
              </button>
              {nccMissing && (
                <p className="ml-[2.75rem] text-[10px] text-red-600">
                  Loại kho “{matCategory}” bắt buộc chọn NCC — chọn NCC rồi mới lưu được.
                </p>
              )}
            </div>
          )}

          {/* Location picker dialog */}
          {showLocPicker && (
            <div className="border rounded-lg bg-slate-50 p-3 space-y-2">
              <p className="text-xs font-medium text-slate-600">Chọn vị trí{activeLocationId ? ' mới' : ''}:</p>
              {/* Tìm TRÊN SERVER: danh sách chỉ 50 vị trí đầu (trước đây nạp cả kho — Bàu Bàng
                  1.517 vị trí = 616KB mỗi lần mở màn quét, nặng nhất trên PDA/wifi xưởng) */}
              {onLocSearch && (
                <input type="text" placeholder="Tìm vị trí…" onChange={e => onLocSearch(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400" />
              )}
              <div className="max-h-36 overflow-y-auto space-y-1">
                {allLocations.map(l => (
                    <button
                      key={l.id}
                      type="button"
                      // đổi vị trí = xoá cảnh báo chặn của vị trí cũ (lượt quét vẫn giữ để Lưu lại)
                      onClick={() => { setActiveLocationId(l.id); setShowLocPicker(false); setPutawayBlock(null); setPutawayReason('') }}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center ${
                        l.id === activeLocationId ? 'bg-blue-100 font-medium' : 'hover:bg-white'
                      }`}
                    >
                      {/* ★ / lý do chặn do BE chấm — trước đây màn này KHÔNG hiện gì, người quét
                          chỉ thấy danh sách phẳng và không biết vì sao dòng đầu lại là dòng đầu */}
                      <PutawayOption loc={l} />
                    </button>
                  ))}
              </div>
              {/* Ô đang chọn CHỨA GÌ (user 17/08) — người đứng cất nhìn ra ngay là cùng mã hay
                  khác mã, date nào, có pallet QA giữ không; khỏi phải tin mỗi dấu ★ */}
              <LocationContents locationId={activeLocationId} highlightMaterialId={order.material_id} />
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
                <Label className="text-xs font-medium text-slate-700">Số lượng nhập</Label>
                {/* BASE UNIT: 2 ô Thùng + Hộp — value/onChange = BASE (hộp), quy đổi tại rìa như mọi sheet quét */}
                <QtyInput value={Math.max(0, parseInt(cartons) || 0)} mat={order.material}
                  onChange={b => setCartons(String(b))} />
                {outboundCartons != null && (
                  <p className="text-[10px] text-slate-500">Phiếu xuất: <span className="font-semibold text-slate-700">{qtyLabel(outboundCartons ?? 0, order.material)}</span></p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tầng chồng</Label>
                {/* native select: dropdown trình duyệt (không qua portal) → bấm được khi scanner đè dialog */}
                <select
                  value={stackLayer}
                  onChange={e => setStackLayer(e.target.value)}
                  className="h-11 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="1">Tầng 1 (sàn)</option>
                  <option value="2">Tầng 2</option>
                  <option value="3">Tầng 3</option>
                </select>
              </div>
            </div>

          {/* Camera with floating buttons — flex-1 lấp đầy phần còn lại của sheet (không cuộn) */}
          <div className="relative flex-1 min-h-0">
            {gunMode ? (
              <div className="h-full w-full rounded-lg bg-slate-900 flex flex-col items-center justify-center gap-2 px-4">
                {/* Hướng dẫn CHỈ hiện lúc đang chờ bắn tem. Có tem chờ / đang xác thực thì bỏ hẳn:
                    nút nổi ("Lưu…"/"Đang xác thực…") đứng absolute GIỮA vùng này, để chữ lại là đè
                    mất chữ — màn 360x640 vùng quét chỉ còn ~120px, canh kiểu gì cũng đụng (30/07). */}
                {!pendingQR && !serverChecking && (
                  <>
                    <QrCode className="h-12 w-12 text-sky-400/70" />
                    <p className="text-sm font-medium text-slate-200 text-center">Chế độ súng quét — bóp cò để quét tem</p>
                    <p className="text-[11px] text-slate-400 text-center">Camera tắt · bắn lại đúng tem đang chờ = Lưu</p>
                  </>
                )}
              </div>
            ) : (
              <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} fill codeTypes={codeTypes} />
            )}

            {/* "Quét tiếp": hiện ở MỌI lỗi — cả lỗi validate client lẫn lỗi API khi Lưu
                (vd "Pallet đã được quét") — để quét pallet khác ngay, không phải Huỷ ra vào lại */}
            {((pendingQR && validation?.ok === false) || feedback?.type === 'error') && (
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
                onClick={() => handleSave()}
              >
                {saving ? '…' : `Lưu ${qtyLabel(Number(cartons) || 0, order.material)}`}
              </button>
            )}
          </div>
          </>
          )}

          {/* Kho BẮT BUỘC cất đúng quy tắc — vị trí đang chọn vi phạm.
              Hai lối thoát: đổi vị trí (ai cũng làm được) hoặc chọn lý do (cần quyền duyệt).
              KHÔNG có lối "cứ Lưu đại" — nếu không thì công tắc bắt buộc thành trang trí. */}
          {putawayBlock && (
            <div className="rounded-lg bg-red-50 border border-red-300 px-3 py-2.5 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-red-800">Không cất được vào vị trí này</p>
                  <p className="text-xs text-red-700 mt-0.5">{putawayBlock}</p>
                </div>
              </div>
              <button type="button" onClick={() => { setPutawayBlock(null); setShowLocPicker(true) }}
                className="w-full h-9 rounded-md border border-red-300 bg-white text-xs font-medium text-red-700">
                Chọn vị trí khác
              </button>
              {canPutawayOverride && (
                <div className="pt-1 border-t border-red-200">
                  <p className="text-[11px] text-red-700 mb-1">Hoặc duyệt cất khác quy tắc — chọn lý do:</p>
                  <div className="grid grid-cols-2 gap-1">
                    {PUTAWAY_OVERRIDE_REASONS.map(r => (
                      <button key={r.code} type="button"
                        onClick={() => { setPutawayReason(r.code); handleSave(r.code) }}
                        className="h-9 px-2 rounded-md border border-red-300 bg-white text-[11px] text-red-700 text-left">
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
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

          {/* Chỉ báo khi LỖI — hợp lệ thì để nút "Lưu N thùng" tự nói (tránh user tưởng đã lưu xong) */}
          {pendingQR && validation && !validation.ok && !feedback && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-red-700">{validation.msg}</p>
                <p className="font-mono text-[10px] text-red-400 truncate">{pendingQR}</p>
              </div>
            </div>
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
  // TÌM TRÊN SERVER (luật danh mục lớn) — xem ghi chú ở picker vị trí bên trên
  const [locTerm, setLocTerm] = useState('')
  const locTermDeb = useDebouncedValue(locTerm, 250)
  const { data: allLocations = [] } = useLocationsReal(
    order?.warehouse_id
      ? {
          warehouse_id: order.warehouse_id,
          ...(order.warehouse_type ? { category: order.warehouse_type } : {}),
          ...(order.material_id ? { material_id: order.material_id } : {}),
          // 300 (17/08): kho cỡ thường thấy TRỌN danh sách — ★ trên đầu, ô chặn cuối (BE sort)
          search: locTermDeb || undefined, limit: 300,
        }
      : undefined
  )

  if (!order) {
    return createPortal(
      <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-auto">
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
      onLocSearch={setLocTerm}
    />
  )
}
