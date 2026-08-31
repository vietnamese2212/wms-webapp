import { useRef, useState, useEffect, useMemo, Fragment } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { ArrowLeft, CheckCircle2, AlertTriangle, Package, Scissors, ChevronDown, ChevronRight, PenSquare, Info } from 'lucide-react'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { Button }  from '@/components/ui/button'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { PdaGunHint } from '@/components/shared/PdaGunHint'
import { Card }    from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { QRScanner } from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import { useGDO, useScanLoosePickingItem, useCheckOutboundScan, useConfirmLoosePickingItem, useManualLooseItem, useItemInventory, usePctBands, type CheckOutboundScanResult, type ItemInventoryEntry } from '@/api/hooks'
import { pctDateCls } from '@/utils/pctDateBands'
import { PalletDetailDialog } from '@/components/shared/PalletDetailDialog'
import { useActiveLoosePickingStore } from '@/stores/activeLoosePickingStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { playBeep, unlockAudio } from '@/utils/audio'
import { qtyLabel, qtyEntryText, qtyUnitLabel, qtyBaseLabel, hasEntry, type MatUnits } from '@/utils/qtyUnits'
import { QtyInput } from '@/components/shared/QtyInput'
import { LeftoverLocationPicker, KEEP_LOCATION, isLeftoverLocError } from '@/components/wms/LeftoverLocationPicker'
import { usePutawayGate } from '@/components/wms/PutawayGate'
import type { PutawayHint } from '@/utils/putaway'
import { useRotationGate } from '@/components/wms/RotationGate'
import { scanRotationOf } from '@/utils/rotation'
import type { OutboundItem } from '@/types'
import { useScanCodeTypes } from '@/hooks/useScanCodeTypes'
import { OutboundStatusBadge } from '@/lib/statusMaps'

function ProgressBar({ scanned, target, mat }: { scanned: number; target: number; mat?: MatUnits | null }) {
  const pct = target > 0 ? Math.min(100, (scanned / target) * 100) : 0
  const cls = pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-200'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm tabular-nums font-medium ${pct >= 100 ? 'text-green-700 font-semibold' : 'text-slate-600'}`}>
        {qtyEntryText(scanned, mat)}/{qtyEntryText(target, mat)} {qtyUnitLabel(mat)}
      </span>
    </div>
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

type FeedbackState = { type: 'success' | 'error'; msg: string } | null

// ─── Scan dialog ───────────────────────────────────────────────

interface ScanDialogProps {
  item:    OutboundItem
  gdoId:   string
  warehouseId: string | null       // kho CỦA CHUYẾN → quyết loại mã camera giải
  onClose: () => void
  pdaMode?: boolean          // mở bằng cò súng → KHÔNG bật camera
  initialScan?: string       // tem đã bắn ngay trước khi mở — xử lý luôn
}

function ScanDialog({ item, gdoId, warehouseId, onClose, pdaMode = false, initialScan }: ScanDialogProps) {
  const codeTypes = useScanCodeTypes(warehouseId)
  const scannerRef = useRef<QRScannerHandle>(null)
  const [feedback,       setFeedback]       = useState<FeedbackState>(null)
  const [checkResult,    setCheckResult]    = useState<CheckOutboundScanResult | null>(null)
  const [pendingCartons, setPendingCartons] = useState('')
  // Nhặt lẻ chỉ GIỮ hàng (không trừ remaining) → pallet luôn còn hàng ⇒ luôn phải khai chỗ đặt lại
  const [leftoverLoc,    setLeftoverLoc]    = useState<string | null>(null)
  const [leftoverHint,   setLeftoverHint]   = useState<PutawayHint | null>(null)   // quy tắc CẤT của ô vừa chọn (BE chấm)
  // Lỗi VỊ TRÍ → báo trong panel, giữ tem để chọn lại rồi Lưu (không bắt quét lại)
  const [locError,       setLocError]       = useState('')
  const { mutate: checkScan, isPending: checking } = useCheckOutboundScan()
  const { mutate: scanItem,  isPending: saving    } = useScanLoosePickingItem()
  // Luân chuyển: kết quả do BE tính (xem components/wms/RotationGate.tsx)
  const rotGate = useRotationGate(checkResult?.rotation)
  const putGate = usePutawayGate(leftoverHint)   // ô đặt lại pallet lệch luật + kho bắt buộc → khoá Lưu tới khi có lý do

  const matName      = item.material?.short_name ?? item.material_code_raw ?? '—'
  const looseScanned = (item.scan_entries ?? []).filter(s => s.is_loose_picking).reduce((sum, s) => sum + Number(s.cartons_scanned), 0)
  const ov           = Math.max(0, (item.cartons_scanned - looseScanned) - (item.cartons_ordered - item.loose_picking))
  const effectiveLoose = Math.max(0, item.loose_picking - ov)
  const looseDone    = Math.min(looseScanned, effectiveLoose)
  const remaining    = Math.max(0, effectiveLoose - looseDone)

  function handleScan(qr_code: string, src: 'camera' | 'wedge' = 'camera') {
    // Guard chung camera + súng quét: đang check/lưu → bỏ qua lượt mới
    if (checking || saving) return
    if (checkResult) {
      // PDA: bắn lại đúng tem đang chờ xác nhận = bấm Lưu (chỉ súng — camera không tự lưu)
      if (src === 'wedge' && checkResult.pallet_code === (qr_code ?? '').trim()) { playBeep(); handleSave() }
      return
    }
    playBeep()
    setCheckResult(null)
    setFeedback(null)
    rotGate.reset(); putGate.reset()   // tem mới = câu hỏi lý do mới
    checkScan(
      // loose_picking_mode: chặn trùng CHỈ so với các lượt NHẶT LẺ — pallet đã quét ở giao diện Xuất
      // (hoặc ngược lại) vẫn quét được (user 22/07: 2 người 2 việc trên cùng 1 pallet là bình thường)
      { gdoId, itemId: item.id, qr_code, loose_picking_mode: true },
      {
        onSuccess: (data) => {
          setCheckResult(data)
          setPendingCartons(String(data.suggested_cartons > 0 ? Math.min(data.suggested_cartons, remaining) : 1))
          setLeftoverLoc(null); setLeftoverHint(null); putGate.reset(); setLocError('')   // pallet mới → chọn lại chỗ đặt sau khi nhặt
        },
        onError: (err) => {
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setFeedback({ type: 'error', msg })
        },
      }
    )
  }

  const qtyToTake   = Math.max(1, parseInt(pendingCartons) || 1)
  const leftoverQty = checkResult?.pallet_remaining ?? 0
  const needLeftoverLoc = !!checkResult && leftoverQty > 0
  const canSave = !!checkResult && (!needLeftoverLoc || !!leftoverLoc) && rotGate.ok && putGate.ok

  function handleSave() {
    if (!checkResult || saving || !canSave) return
    scanItem(
      { gdoId, itemId: item.id, qr_code: checkResult.pallet_code, cartons_override: qtyToTake,
        leftover_ui: true, ...(needLeftoverLoc ? { leftover_location_id: leftoverLoc ?? KEEP_LOCATION } : {}), ...rotGate.arg, ...putGate.arg },
      {
        onSuccess: (data: any) => {
          setCheckResult(null)
          const scannedNow = Number(data.scan_entry.cartons_scanned)
          const isNowComplete = scannedNow >= remaining
          setFeedback({ type: 'success', msg: `✓ ${data.scan_entry.pallet_code} · ${qtyLabel(scannedNow, item.material)}` })
          setTimeout(() => {
            if (isNowComplete) { onClose() }
            else { scannerRef.current?.resume(); setFeedback(null) }
          }, 1500)
        },
        onError: (err) => {
          const eobj = (err as AxiosError<{ error: { message: string; code?: string } }>)?.response?.data?.error
          const msg = eobj?.message ?? 'Lỗi không xác định'
          // Lỗi VỊ TRÍ → giữ tem đang chờ, chọn lại rồi Lưu tiếp (không bắt quét lại pallet)
          if (isLeftoverLocError(msg, eobj?.code)) { setLocError(msg); setLeftoverLoc(null); setLeftoverHint(null); return }
          setCheckResult(null)
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

  // Súng quét PDA (keyboard-wedge) — chạy song song camera, chống double-read trong hook
  useWedgeScanner(code => handleScan(code, 'wedge'), true)

  // Mở bằng cò súng: xử lý ngay tem vừa bắn (1 lần khi mount)
  useEffect(() => {
    if (initialScan) handleScan(initialScan, 'wedge')
  }, []) // eslint-disable-line

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative mt-auto bg-white rounded-t-2xl h-[92dvh] flex flex-col overflow-hidden">
        <div className="p-4 flex-1 flex flex-col gap-3 min-h-0">
          <div>
            <p className="font-semibold text-lg text-slate-800">{matName}</p>
            <p className="text-sm text-slate-500">
              {item.material?.material_code ?? item.material_code_raw}
              {' · '}còn <strong>{qtyLabel(remaining, item.material)}</strong> nhặt lẻ cần chuẩn bị
            </p>
          </div>

          {item.header_text && (
            <p className="text-sm font-semibold text-red-600 leading-snug break-words border border-red-200 bg-red-50 rounded px-2 py-1.5">
              {item.header_text}
            </p>
          )}

          {/* Điều kiện xuất Batch / %Date — highlight ĐỎ (đồng bộ Xuất) */}
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
            {pdaMode ? (
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

            {/* Chưa chọn vị trí đặt lại → KHÔNG hiện pill giữa vùng quét (bấm không được mà lại
                đè mất dòng hướng dẫn phía sau trên màn 360px) — việc cần làm ở khối vàng bên dưới */}
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

          {checkResult && !feedback && (
            <div className="space-y-2">
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
              {/* BASE GỐC (user 22/07): nhập 2 ô Thùng + Hộp (mã có entry) — số base read-only TỰ TÍNH
                  từ 2 ô, khỏi mất công quy đổi tay. Mã không entry = 1 ô base như cũ. Đồng bộ Xuất. */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-slate-700 shrink-0">Số lượng lẻ:</label>
                <QtyInput compact className="w-44"
                  value={Math.max(0, parseInt(pendingCartons) || 0)}
                  mat={item.material}
                  onChange={b => setPendingCartons(String(b))}
                />
                <span className="text-sm text-slate-400 whitespace-nowrap">/ còn {qtyEntryText(remaining, item.material)} {qtyUnitLabel(item.material)}</span>
              </div>
              {hasEntry(item.material) && (
                <p className="text-xs text-slate-500 tabular-nums">
                  = <b>{new Intl.NumberFormat('vi-VN').format(Math.max(0, parseInt(pendingCartons) || 0))}</b> {qtyBaseLabel(item.material)} <span className="text-slate-400">(base — app tự tính)</span>
                </p>
              )}
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
                  {locError && <p className="mt-1.5 text-xs font-medium text-red-600">⚠ {locError}</p>}
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

          <Button variant="outline" className="w-full" onClick={onClose} disabled={saving}>Đóng</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────

export default function LoosePickingItemDetail() {
  const { gdoId, itemId } = useParams<{ gdoId: string; itemId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const autoScan = searchParams.get('scan') === '1'
  const { vehicles } = useActiveLoosePickingStore()
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const pctBands = usePctBands()

  const { data: gdo, isLoading, isError } = useGDO(gdoId)
  const { data: inventoryData = [], isLoading: invLoading } = useItemInventory(gdoId, itemId)
  const { mutate: confirmLoose, isPending: confirming } = useConfirmLoosePickingItem()
  const { mutateAsync: manualLooseAsync } = useManualLooseItem()
  const [showScan,          setShowScan]          = useState(false)
  const [hdrOpen,           setHdrOpen]           = useState(false)   // mobile: popup thông tin tham khảo (Nhặt lẻ/Tổng)
  const [pdaScan,           setPdaScan]           = useState<string | null>(null)   // tem bắn bằng cò súng tại trang → mở màn quét chế độ súng
  const [showInventory,     setShowInventory]     = useState(false)
  const [confirmLooseOpen,  setConfirmLooseOpen]  = useState(false)
  const [looseError,        setLooseError]        = useState<string | null>(null)
  const [expandedInvKeys,   setExpandedInvKeys]   = useState<Set<string>>(new Set())
  const [detailEntryId,     setDetailEntryId]     = useState<string | null>(null)
  // Lưu thủ công (hàng no-QR: POSM/Loscam) — nhập số lượng lẻ tay, không quét camera
  const [showManualLoose,   setShowManualLoose]   = useState(false)
  const [manualLooseCartons, setManualLooseCartons] = useState('')
  const [manualLooseError,  setManualLooseError]  = useState('')
  const [manualLooseSaving, setManualLooseSaving] = useState(false)

  const hasAutoScanned = useRef(false)

  // PDA (user 19/07): bóp cò NGAY TẠI TRANG MÃ → tự mở màn quét chế độ SÚNG (không camera),
  // rule chặn giữ nguyên (sai mã / vượt số nhặt lẻ như quét thường).
  // Form đang mở → TẮT HẲN máy đọc (enabled=false) — máy đọc bắt chuỗi phím nhanh/IME ở mọi
  // ô nhập rồi trả lại giá trị cũ (bug xe vãng lai 25/08).
  const wedgeFormOpen = confirmLooseOpen || showManualLoose
  useWedgeScanner(code => {
    if (!gdo || showScan) return
    const it = (gdo.delivery_orders ?? []).flatMap(d => d.items).find(i => i.id === itemId)
    if (!it || it.material?.no_qr_tracking === true || it.loose_picking <= 0) return
    const ls = (it.scan_entries ?? []).filter(s => s.is_loose_picking).reduce((sum, s) => sum + Number(s.cartons_scanned), 0)
    const ovr = Math.max(0, (it.cartons_scanned - ls) - (it.cartons_ordered - it.loose_picking))
    if (ls >= Math.max(0, it.loose_picking - ovr)) return   // đã đủ số lẻ
    if (gdo.status === 'COMPLETED' || gdo.status === 'CANCELLED') return
    if (!can(perms, 'loosepicking', 'scan')) return
    unlockAudio()
    setPdaScan(code)
    setShowScan(true)
  }, !wedgeFormOpen)

  useEffect(() => {
    if (!autoScan || !gdo || hasAutoScanned.current) return
    if (!can(perms, 'loosepicking', 'scan')) return
    const allItems = (gdo.delivery_orders ?? []).flatMap(d => d.items)
    const current  = allItems.find(i => i.id === itemId)
    if (!current) return
    const ls = (current.scan_entries ?? []).filter((s: any) => s.is_loose_picking).reduce((sum: number, s: any) => sum + Number(s.cartons_scanned), 0)
    const ov = Math.max(0, (current.cartons_scanned - ls) - (current.cartons_ordered - current.loose_picking))
    const el = Math.max(0, current.loose_picking - ov)
    if (ls < el) {
      // Hàng no-QR → mở dialog nhập tay; hàng QR → mở camera quét
      if ((current.material as any)?.no_qr_tracking === true) {
        setManualLooseCartons(String(el - ls))
        setManualLooseError('')
        setShowManualLoose(true)
      } else {
        unlockAudio()
        setShowScan(true)
      }
      hasAutoScanned.current = true
    }
  }, [autoScan, gdo]) // eslint-disable-line

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

  function toggleInv(key: string) {
    setExpandedInvKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  // Deep-link cũ / chuyến đã xóa: 404 → gdo mãi undefined → trước đây SKELETON VĨNH VIỄN (31/08)
  if (isError || (!isLoading && !gdo)) {
    return (
      <div className="p-6 text-center space-y-2">
        <p className="text-sm text-red-600">Không tìm thấy chuyến — có thể đã bị xóa hoặc đường link đã cũ</p>
        <Link to="/wms/loosepicking" className="text-xs text-sky-600 underline">← Về Nhặt lẻ</Link>
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
        <Button variant="link" onClick={() => navigate(`/wms/loosepicking/${gdoId}`)}>Quay lại</Button>
      </div>
    )
  }

  const matName      = item.material?.short_name ?? item.material_code_raw ?? '—'
  const matCode      = item.material?.material_code ?? item.material_code_raw ?? '—'
  // DO/NPP của dòng này (đơn cha) — DO chỉ tham khảo, hiển thị đầy đủ trong header (đồng bộ Xuất)
  const parentDO     = (gdo.delivery_orders ?? []).find(d => d.items.some(i => i.id === itemId))
  const doCode       = parentDO?.delivery_code ?? ''
  const doNpp        = (parentDO?.distributor_name ?? '').trim()
  const looseScanned = (item.scan_entries ?? []).filter(s => s.is_loose_picking).reduce((sum, s) => sum + Number(s.cartons_scanned), 0)
  const ov           = Math.max(0, (item.cartons_scanned - looseScanned) - (item.cartons_ordered - item.loose_picking))
  const effectiveLoose = Math.max(0, item.loose_picking - ov)
  const looseDone    = Math.min(looseScanned, effectiveLoose)
  const isDone       = looseDone >= effectiveLoose
  const scans        = (item.scan_entries ?? []).filter(s => s.is_loose_picking)
  const looseUnconfirmedCount = scans
    .filter(s => !s.loose_confirmed)
    .reduce((sum, s) => sum + Number(s.cartons_scanned), 0)

  // Hàng no-QR (POSM/Loscam) → nhập tay số lượng lẻ thay vì quét camera
  const isNoQr        = item.material?.no_qr_tracking === true
  const looseRemaining = Math.max(0, effectiveLoose - looseDone)
  // Bản ghi lẻ thủ công hiện có (pallet_code = mã hàng, chưa xác nhận) — để sửa (xóa rồi ghi lại)
  const existingManualLoose = scans.find(s => !s.loose_confirmed && s.pallet_code === matCode)
  const otherLoose    = looseScanned - Number(existingManualLoose?.cartons_scanned ?? 0)
  const manualLooseMax = Math.max(0, effectiveLoose - otherLoose)
  const manualLooseNum = Math.max(0, parseInt(manualLooseCartons) || 0)
  const overLooseMax   = manualLooseNum > manualLooseMax

  function openScan() {
    unlockAudio()
    setShowScan(true)
  }

  function openManualLoose() {
    setManualLooseCartons(String(existingManualLoose?.cartons_scanned ?? looseRemaining))
    setManualLooseError('')
    setShowManualLoose(true)
  }

  async function saveManualLoose() {
    const qty = Math.max(0, parseInt(manualLooseCartons) || 0)
    if (qty > manualLooseMax) { setManualLooseError(`Vượt số cần nhặt lẻ (tối đa ${qtyLabel(manualLooseMax, item?.material)})`); return }
    setManualLooseSaving(true); setManualLooseError('')
    try {
      // BE upsert: ghi/sửa/xóa bản ghi lẻ thủ công + reserve tồn theo delta (trừ khi "Check nhặt lẻ")
      await manualLooseAsync({ gdoId: gdoId!, itemId: item!.id, cartons: qty })
      setShowManualLoose(false)
    } catch (e) {
      const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi lưu số lượng'
      setManualLooseError(msg)
    } finally {
      setManualLooseSaving(false)
    }
  }

  // ── Cụm action header (ActionCluster) — ĐỒNG BỘ layout với OutboundItemDetail ──
  const actionItems: ActionItem[] = []
  // Tồn kho: bật/tắt panel tồn của mã hàng (giữ màu active khi đang mở)
  actionItems.push({
    key: 'inventory', icon: Package, label: 'Tồn kho',
    tip: `Xem tồn kho trong kho${inventoryData.length > 0 ? ` (${inventoryData.length} pallet)` : ''}`,
    className: showInventory ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' : 'text-slate-500',
    onClick: () => setShowInventory(v => !v),
  })
  // Check nhặt lẻ — xác nhận trừ tồn số thùng lẻ đã chuẩn bị (chỉ khi xe đã bắt đầu)
  if (!!gdo.started_at && item.loose_picking > 0 && looseUnconfirmedCount > 0 && can(perms, 'loosepicking', 'complete'))
    actionItems.push({
      key: 'confirm-loose', icon: CheckCircle2, label: `Check nhặt lẻ (${looseUnconfirmedCount})`,
      tip: `Xác nhận đã kiểm ${qtyLabel(looseUnconfirmedCount, item.material)} nhặt lẻ — tồn kho sẽ trừ ngay`,
      primary: true, busy: confirming,
      className: 'border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100',
      onClick: () => setConfirmLooseOpen(true),
    })
  if (can(perms, 'loosepicking', 'scan')) {
    if (isNoQr) {
      // Hàng no-QR (POSM/Loscam) → nhập tay số lượng lẻ thay vì quét camera
      if (!isDone || existingManualLoose)
        actionItems.push({
          key: 'manual', icon: PenSquare, label: existingManualLoose ? 'Sửa SL lẻ' : 'Lưu thủ công',
          tip: 'Nhập tay số thùng lẻ đã chuẩn bị (hàng không tem)',
          primary: true,
          onClick: openManualLoose,
        })
    } else if (!isDone) {
      actionItems.push({
        key: 'scan', icon: ScanIcon, label: 'Quét pallet', tip: 'Quét QR pallet để chuẩn bị hàng lẻ',
        primary: true, variant: 'default',
        onClick: openScan,
      })
    }
  }

  // Thông tin THAM KHẢO (Nhặt lẻ/Tổng) — desktop inline; mobile mở popup Info.
  // (Điều kiện quét sống còn: tên+tiến độ+Batch/%Date+ghi chú đỏ vẫn LUÔN hiện, không vào popup.)
  const refInfoJSX = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
      <span className="flex items-center gap-1">
        <Scissors className="h-3 w-3 text-slate-400 shrink-0" />
        Nhặt lẻ: <span className="font-medium text-slate-700 ml-0.5">{qtyLabel(effectiveLoose, item.material)}</span>
        {effectiveLoose < item.loose_picking && <span className="text-slate-400 ml-0.5">(gốc {qtyEntryText(item.loose_picking, item.material)})</span>}
      </span>
      <span className="flex items-center gap-1">
        <Package className="h-3 w-3 text-slate-400 shrink-0" />
        Tổng: <span className="font-medium text-slate-700 ml-0.5">{qtyEntryText(item.cartons_ordered, item.material)}</span> {qtyUnitLabel(item.material)}
      </span>
      {doCode && (
        <span><span className="text-slate-400">DO:</span> <span className="font-mono break-all text-slate-600">{doCode}</span></span>
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
        <ScanDialog item={item} gdoId={gdoId!} warehouseId={gdo.warehouse_id} pdaMode={!!pdaScan} initialScan={pdaScan ?? undefined}
          onClose={() => { setShowScan(false); setPdaScan(null) }} />
      )}

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

      {/* Lưu thủ công (hàng no-QR) — nhập số thùng lẻ, upsert bản ghi lẻ (trừ tồn khi "Check nhặt lẻ") */}
      <Dialog open={showManualLoose} onOpenChange={v => { if (!v) { setShowManualLoose(false); setManualLooseError('') } }}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle className="text-base">Lưu số lượng nhặt lẻ</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-slate-600 font-medium">{matName}</p>
            <div className="flex gap-3 bg-slate-50 rounded-lg px-3 py-2">
              <div className="flex-1 text-center">
                <div className="text-[10px] text-slate-500 mb-0.5">Cần nhặt lẻ</div>
                <div className="text-base font-bold tabular-nums text-slate-700">{qtyLabel(effectiveLoose, item.material)}</div>
              </div>
              <div className="w-px bg-slate-200" />
              <div className="flex-1 text-center">
                <div className="text-[10px] text-slate-500 mb-0.5">Còn thiếu</div>
                <div className={`text-base font-bold tabular-nums ${looseRemaining === 0 ? 'text-green-600' : 'text-amber-600'}`}>{qtyLabel(looseRemaining, item.material)}</div>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-slate-600">Số lượng lẻ đã chuẩn bị</p>
              <QtyInput
                value={manualLooseNum}
                mat={item.material}
                onChange={b => { setManualLooseCartons(String(b)); setManualLooseError('') }}
                autoFocus
              />
              {overLooseMax && <p className="text-xs text-red-600">Vượt số cần nhặt lẻ (tối đa {qtyLabel(manualLooseMax, item.material)})</p>}
            </div>
            {manualLooseError && <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{manualLooseError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowManualLoose(false); setManualLooseError('') }} disabled={manualLooseSaving}>Hủy</Button>
            <Button size="sm" disabled={manualLooseSaving || overLooseMax} onClick={saveManualLoose}>
              {manualLooseSaving ? '…' : 'Lưu'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Khung card chuẩn như OutboundDetail (user 19/08 "fit màn hình đồng nhất") */}
      <div className="flex flex-col h-full min-h-0 sm:p-3">
       <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">

        {/* ── Header ── */}
        <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 overflow-y-auto" style={{ maxHeight: '30vh' }}>

          {/* Row 1: back + code + status + ⓘ + cụm action (1 dòng, không chen — NPP xuống Row3b) */}
          <div className="flex items-center gap-x-2 gap-y-1.5">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <button
                onClick={() => navigate(`/wms/loosepicking/${gdoId}`)}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="font-mono font-semibold text-xs sm:text-sm leading-tight break-all whitespace-normal sm:truncate min-w-0">{matCode}</span>
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
              {can(perms, 'loosepicking', 'scan') && !isNoQr && !isDone && <PdaGunHint />}
              <ActionCluster items={actionItems} />
            </div>
          </div>

          {/* Row 2: name — tiến độ gộp xuống dòng heading "Pallet đã quét" */}
          <p className="text-sm font-medium text-slate-800 leading-tight">{matName}</p>

          {/* Row 3: metadata THAM KHẢO — desktop inline; mobile xem qua popup Info (điều kiện đỏ vẫn hiện dưới) */}
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

          {/* Header text: highlight ĐỎ nổi bật (đồng bộ Xuất) */}
          {item.header_text && (
            <div className="text-xs font-semibold text-red-600 bg-red-50 border border-red-300 rounded px-2 py-1 leading-snug break-words">
              {item.header_text}
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

        {/* ── Quick-switch bar ── */}
        {vehicles.length > 0 && (
          <div className="border-b bg-white px-4 py-1.5 shrink-0 flex flex-wrap items-center gap-1">
            <span className="text-[9px] text-slate-400 shrink-0">Đang làm:</span>
            {vehicles.map(v => (
              <button
                key={v.id}
                onClick={() => navigate(`/wms/loosepicking/${v.id}`)}
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
            Pallet đã quét (nhặt lẻ)
            <span className="ml-1 text-xs font-normal text-slate-400">{scans.length} pallet</span>
          </h2>
          <div className="flex-1 min-w-0">
            <ProgressBar scanned={looseDone} target={effectiveLoose} mat={item.material} />
          </div>
        </div>

        {/* ── Scan list ── */}
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <div className="p-3">
            {/* min-w-max: Card nở đúng bằng bảng để nền+viền phủ trọn, không lộ vạch xám giữa bảng khi cuộn ngang */}
            <Card className="min-w-max">
              {scans.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                  <ScanIcon className="h-10 w-10 opacity-30" />
                  <p className="text-sm">Chưa có pallet nào được quét</p>
                  {!isDone && can(perms, 'loosepicking', 'scan') && (
                    isNoQr ? (
                      <Button size="sm" variant="outline" onClick={openManualLoose}>
                        Lưu thủ công
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={openScan}>
                        <ScanIcon className="h-4 w-4 mr-1" /> Quét pallet đầu tiên
                      </Button>
                    )
                  )}
                </div>
              ) : (
                <Table className="min-w-[520px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500">Mã pallet</TableHead>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500 text-right">Thùng</TableHead>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500 whitespace-nowrap">%Date</TableHead>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500 whitespace-nowrap">NSX</TableHead>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500 whitespace-nowrap">Date cũ nhất</TableHead>
                      <TableHead className="px-2 py-1 text-[9px] font-medium text-slate-500 whitespace-nowrap">Thời gian quét</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scans.map(se => {
                      const { bad: isSubOptimal, bestDate: rotBest } = scanRotationOf(se)
                      return (
                        <TableRow key={se.id}>
                          <TableCell className="px-2 py-1">
                            <div className={`font-mono text-[10px] font-semibold ${isSubOptimal ? 'text-red-600' : 'text-slate-700'}`}>
                              {se.pallet_code}
                            </div>
                          </TableCell>
                          <TableCell className="px-2 py-1 text-right tabular-nums text-[10px] font-semibold">
                            {qtyEntryText(se.cartons_scanned, item.material)}
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
                          <TableCell className="px-2 py-1 whitespace-nowrap tabular-nums">
                            <div className="text-[10px] leading-tight text-slate-500">{se.scanned_at ? formatTimestampDate(se.scanned_at, true) : '—'}</div>
                            <div className="text-[9px] leading-tight text-slate-400">{se.scanned_at ? formatTimestampTime(se.scanned_at) : ''}</div>
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
