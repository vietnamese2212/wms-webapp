import { useRef, useState, useEffect, useMemo, Fragment } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import {
  ArrowLeft, QrCode, CheckCircle2, AlertTriangle, Package, Scissors, ChevronDown, ChevronRight, PenSquare,
} from 'lucide-react'
import { Button }  from '@/components/ui/button'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { Card }    from '@/components/ui/card'
import { Input }   from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { QRScanner } from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import { useGDO, useScanLoosePickingItem, useCheckOutboundScan, useConfirmLoosePickingItem, useManualLooseItem, useItemInventory, type CheckOutboundScanResult, type ItemInventoryEntry } from '@/api/hooks'
import { PalletDetailDialog } from '@/components/shared/PalletDetailDialog'
import { useActiveLoosePickingStore } from '@/stores/activeLoosePickingStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { playBeep, unlockAudio } from '@/utils/audio'
import { qtyLabel, qtyEntryText, qtyUnitLabel, qtyBaseLabel, type MatUnits } from '@/utils/qtyUnits'
import type { OutboundItem, OutboundStatus } from '@/types'

// ─── Status badge ──────────────────────────────────────────────

const statusCls: Record<OutboundStatus, string> = {
  PENDING:     'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  COMPLETED:   'bg-green-100 text-green-800',
  CANCELLED:   'bg-red-100 text-red-600',
  PAUSED:      'bg-red-100 text-red-700',
}
const statusLabel: Record<OutboundStatus, string> = {
  PENDING: 'Chờ xuất', IN_PROGRESS: 'Đang xuất', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy', PAUSED: 'Tạm dừng',
}
function Badge({ status }: { status: string }) {
  const s = status as OutboundStatus
  return (
    <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${statusCls[s] ?? 'bg-slate-100 text-slate-600'}`}>
      {statusLabel[s] ?? status}
    </span>
  )
}

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
  onClose: () => void
  pdaMode?: boolean          // mở bằng cò súng → KHÔNG bật camera
  initialScan?: string       // tem đã bắn ngay trước khi mở — xử lý luôn
}

function ScanDialog({ item, gdoId, onClose, pdaMode = false, initialScan }: ScanDialogProps) {
  const scannerRef = useRef<QRScannerHandle>(null)
  const [feedback,       setFeedback]       = useState<FeedbackState>(null)
  const [checkResult,    setCheckResult]    = useState<CheckOutboundScanResult | null>(null)
  const [pendingCartons, setPendingCartons] = useState('')
  const { mutate: checkScan, isPending: checking } = useCheckOutboundScan()
  const { mutate: scanItem,  isPending: saving    } = useScanLoosePickingItem()

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
    checkScan(
      { gdoId, itemId: item.id, qr_code },
      {
        onSuccess: (data) => {
          setCheckResult(data)
          setPendingCartons(String(data.suggested_cartons > 0 ? Math.min(data.suggested_cartons, remaining) : 1))
        },
        onError: (err) => {
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setFeedback({ type: 'error', msg })
        },
      }
    )
  }

  function handleSave() {
    if (!checkResult || saving) return
    scanItem(
      { gdoId, itemId: item.id, qr_code: checkResult.pallet_code, cartons_override: Math.max(1, parseInt(pendingCartons) || 1) },
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
          setCheckResult(null)
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

  // Súng quét PDA (keyboard-wedge) — chạy song song camera, chống double-read trong hook
  useWedgeScanner(code => handleScan(code, 'wedge'), true)

  // Mở bằng cò súng: xử lý ngay tem vừa bắn (1 lần khi mount)
  useEffect(() => {
    if (initialScan) handleScan(initialScan, 'wedge')
  }, []) // eslint-disable-line

  const isSubOptimal = !!(checkResult?.production_date && checkResult?.best_available_date &&
    checkResult.production_date > checkResult.best_available_date)

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
                <QrCode className="h-12 w-12 text-sky-400/70" />
                <p className="text-sm font-medium text-slate-200">Chế độ súng quét — bóp cò để quét tem</p>
                <p className="text-[11px] text-slate-400 text-center">Camera tắt · bắn lại đúng tem đang chờ xác nhận = Lưu</p>
              </div>
            ) : (
              <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} fill />
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

            {checkResult && !saving && (
              <button
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                           bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white
                           rounded-full px-6 py-2.5 text-sm font-semibold shadow-xl transition-all"
                onClick={handleSave}
              >
                Lưu
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
              <div className={`rounded-lg border px-3 py-2.5 flex items-start gap-2 ${isSubOptimal ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
                <CheckCircle2 className={`h-4 w-4 shrink-0 mt-0.5 ${isSubOptimal ? 'text-orange-500' : 'text-green-600'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold font-mono ${isSubOptimal ? 'text-red-600' : 'text-green-800'}`}>
                    {checkResult.pallet_code}
                  </p>
                  {checkResult.production_date && (
                    <p className="text-[10px] text-slate-500 mt-0.5">NSX: {formatTimestampDate(checkResult.production_date)}</p>
                  )}
                  {isSubOptimal && checkResult.best_available_date && (
                    <p className="text-[10px] text-orange-600 font-medium mt-0.5">
                      ⚠ Trong kho còn NSX {formatTimestampDate(checkResult.best_available_date)} (cũ hơn — nên ưu tiên lấy trước)
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-slate-600 shrink-0">Số {qtyBaseLabel(item.material)}:</label>
                <Input
                  type="number"
                  min={1}
                  value={pendingCartons}
                  onChange={e => setPendingCartons(e.target.value)}
                  className="h-9 text-center font-semibold text-base w-24"
                />
                <span className="text-sm text-slate-400">/ {remaining} cần chuẩn bị</span>
              </div>
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

  const { data: gdo, isLoading } = useGDO(gdoId)
  const { data: inventoryData = [], isLoading: invLoading } = useItemInventory(gdoId, itemId)
  const { mutate: confirmLoose, isPending: confirming } = useConfirmLoosePickingItem()
  const { mutateAsync: manualLooseAsync } = useManualLooseItem()
  const [showScan,          setShowScan]          = useState(false)
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
  // rule chặn giữ nguyên (sai mã / vượt số nhặt lẻ như quét thường)
  useWedgeScanner(code => {
    if (!gdo || showScan) return
    if (confirmLooseOpen || showManualLoose) return
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
  }, true)

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
        key: 'scan', icon: QrCode, label: 'Quét pallet', tip: 'Quét QR pallet để chuẩn bị hàng lẻ',
        primary: true, variant: 'default',
        onClick: openScan,
      })
    }
  }

  return (
    <>
      {showScan && (
        <ScanDialog item={item} gdoId={gdoId!} pdaMode={!!pdaScan} initialScan={pdaScan ?? undefined}
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
                <div className="text-base font-bold tabular-nums text-slate-700">{qtyEntryText(effectiveLoose, item.material)}</div>
                <div className="text-[9px] text-slate-400">{qtyUnitLabel(item.material)}</div>
              </div>
              <div className="w-px bg-slate-200" />
              <div className="flex-1 text-center">
                <div className="text-[10px] text-slate-500 mb-0.5">Còn thiếu</div>
                <div className={`text-base font-bold tabular-nums ${looseRemaining === 0 ? 'text-green-600' : 'text-amber-600'}`}>{qtyEntryText(looseRemaining, item.material)}</div>
                <div className="text-[9px] text-slate-400">{qtyUnitLabel(item.material)}</div>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-slate-600">Số {qtyBaseLabel(item.material)} lẻ đã chuẩn bị</p>
              <Input
                type="number" min={0}
                value={manualLooseCartons}
                onChange={e => { setManualLooseCartons(e.target.value); setManualLooseError('') }}
                className={`text-center font-semibold text-lg h-11 ${overLooseMax ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
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

      <div className="flex flex-col h-full min-h-0">

        {/* ── Header ── */}
        <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 overflow-y-auto" style={{ maxHeight: '30vh' }}>

          {/* Row 1: back + code + status + cụm action — flex-wrap để cụm xuống dòng thay vì bị cắt trên màn hẹp */}
          <div className="flex items-center justify-between gap-x-2 gap-y-1.5 flex-wrap">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                onClick={() => navigate(`/wms/loosepicking/${gdoId}`)}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="font-mono font-semibold text-sm truncate">{matCode}</span>
              <Badge status={item.status} />
            </div>

            <div className="flex items-center gap-1.5 max-sm:w-full">
              <ActionCluster items={actionItems} />
            </div>
          </div>

          {/* Row 2: name + progress */}
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-800 leading-tight">{matName}</p>
            <ProgressBar scanned={looseDone} target={effectiveLoose} mat={item.material} />
          </div>

          {/* Row 3: metadata */}
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
          </div>

          {/* Row 3b: DO (đầy đủ) + NPP tham khảo + điều kiện xuất Batch/%Date highlight ĐỎ (đồng bộ Xuất) */}
          {(doNpp || doCode || item.batch_required || (item.date_required != null && item.date_required > 0)) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              {doNpp && <span className="text-slate-600"><span className="text-slate-400">NPP:</span> <span className="font-medium">{doNpp}</span></span>}
              {doCode && <span className="text-slate-500"><span className="text-slate-400">DO:</span> <span className="font-mono break-all">{doCode}</span></span>}
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
                          <TableCell className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              {row.pct_date !== null ? (
                                <span className={`text-xs font-bold tabular-nums ${
                                  row.pct_date <= 30 ? 'text-red-600' : row.pct_date <= 60 ? 'text-amber-600' : 'text-green-700'
                                }`}>{row.pct_date}%</span>
                              ) : <span className="text-[10px] text-slate-400">Chưa có</span>}
                              {row.is_qa && (
                                <span className="text-[9px] font-medium text-purple-700 bg-purple-100 rounded px-1.5 py-0.5">QA giữ</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="px-2 py-1.5">
                            <span className="text-[10px] font-mono text-slate-600">{row.location_code ?? '—'}</span>
                          </TableCell>
                          <TableCell className="px-2 py-1.5 text-right whitespace-nowrap">
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

        {/* ── Scan list ── */}
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <div className="p-3">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700">
                Pallet đã quét (nhặt lẻ)
                <span className="ml-2 text-xs font-normal text-slate-400">{scans.length} pallet</span>
              </h2>
            </div>

            <Card>
              {scans.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                  <QrCode className="h-10 w-10 opacity-30" />
                  <p className="text-sm">Chưa có pallet nào được quét</p>
                  {!isDone && can(perms, 'loosepicking', 'scan') && (
                    isNoQr ? (
                      <Button size="sm" variant="outline" onClick={openManualLoose}>
                        Lưu thủ công
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={openScan}>
                        <QrCode className="h-4 w-4 mr-1" /> Quét pallet đầu tiên
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
                      const isSubOptimal = !!(se.best_available_date && se.production_date && se.production_date > se.best_available_date)
                      return (
                        <TableRow key={se.id}>
                          <TableCell className="px-2 py-1.5">
                            <div className={`font-mono text-[10px] font-semibold ${isSubOptimal ? 'text-red-600' : 'text-slate-700'}`}>
                              {se.pallet_code}
                            </div>
                          </TableCell>
                          <TableCell className="px-2 py-1.5 text-right tabular-nums text-[10px] font-semibold">
                            {qtyEntryText(se.cartons_scanned, item.material)}
                          </TableCell>
                          <TableCell className="px-2 py-1.5 whitespace-nowrap">
                            {se.pct_date !== null ? (
                              <span className={`text-[10px] font-bold tabular-nums ${
                                se.pct_date <= 30 ? 'text-red-600' : se.pct_date <= 60 ? 'text-amber-600' : 'text-green-700'
                              }`}>{se.pct_date}%</span>
                            ) : <span className="text-[10px] text-slate-300">—</span>}
                          </TableCell>
                          <TableCell className="px-2 py-1.5 whitespace-nowrap">
                            <span className="text-[10px] font-mono tabular-nums text-slate-600">
                              {se.production_date ? format(parseISO(se.production_date), 'dd-MM-yyyy') : '—'}
                            </span>
                          </TableCell>
                          <TableCell className="px-2 py-1.5 whitespace-nowrap">
                            {se.best_available_date ? (
                              <span className={`text-[10px] font-mono tabular-nums ${isSubOptimal ? 'text-orange-600 font-semibold' : 'text-slate-500'}`}>
                                {isSubOptimal ? '⚠ ' : ''}{format(parseISO(se.best_available_date), 'dd-MM-yyyy')}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-300">—</span>
                            )}
                          </TableCell>
                          <TableCell className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                            <div className="text-[10px] text-slate-500">{se.scanned_at ? formatTimestampDate(se.scanned_at, true) : '—'}</div>
                            <div className="text-[9px] text-slate-400">{se.scanned_at ? formatTimestampTime(se.scanned_at) : ''}</div>
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
    </>
  )
}
