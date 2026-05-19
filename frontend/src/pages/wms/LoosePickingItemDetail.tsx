import { useRef, useState, useEffect, useMemo, Fragment } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import {
  ArrowLeft, QrCode, CheckCircle2, AlertTriangle, Package, Scissors, ChevronDown, ChevronRight,
} from 'lucide-react'
import { Button }  from '@/components/ui/button'
import { Card }    from '@/components/ui/card'
import { Input }   from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { QRScanner } from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import { useGDO, useScanLoosePickingItem, useCheckOutboundScan, useItemInventory, type CheckOutboundScanResult, type ItemInventoryEntry } from '@/api/hooks'
import { PalletDetailDialog } from '@/components/shared/PalletDetailDialog'
import { useActiveLoosePickingStore } from '@/stores/activeLoosePickingStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { playBeep, unlockAudio } from '@/utils/audio'
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
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusCls[s] ?? 'bg-slate-100 text-slate-600'}`}>
      {statusLabel[s] ?? status}
    </span>
  )
}

function ProgressBar({ scanned, target }: { scanned: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (scanned / target) * 100) : 0
  const cls = pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-200'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm tabular-nums font-medium ${pct >= 100 ? 'text-green-700 font-semibold' : 'text-slate-600'}`}>
        {scanned}/{target} thùng
      </span>
    </div>
  )
}

type FeedbackState = { type: 'success' | 'error'; msg: string } | null

// ─── Scan dialog ───────────────────────────────────────────────

interface ScanDialogProps {
  item:    OutboundItem
  gdoId:   string
  onClose: () => void
}

function ScanDialog({ item, gdoId, onClose }: ScanDialogProps) {
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

  function handleScan(qr_code: string) {
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
          setFeedback({ type: 'success', msg: `✓ ${data.scan_entry.pallet_code} · ${scannedNow} thùng` })
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

  const isSubOptimal = !!(checkResult?.production_date && checkResult?.best_available_date &&
    checkResult.production_date > checkResult.best_available_date)

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative mt-auto bg-white rounded-t-2xl max-h-[90dvh] overflow-y-auto">
        <div className="p-4 space-y-3">
          <div>
            <p className="font-semibold text-lg text-slate-800">{matName}</p>
            <p className="text-sm text-slate-500">
              {item.material?.material_code ?? item.material_code_raw}
              {' · '}còn <strong>{remaining}</strong> thùng nhặt lẻ cần chuẩn bị
            </p>
          </div>

          {item.header_text && (
            <p className="text-sm font-semibold text-red-600 leading-snug break-words border border-red-200 bg-red-50 rounded px-2 py-1.5">
              {item.header_text}
            </p>
          )}

          <div className="relative">
            <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} />

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
                <label className="text-sm text-slate-600 shrink-0">Số thùng:</label>
                <Input
                  type="number"
                  min={1}
                  value={pendingCartons}
                  onChange={e => setPendingCartons(e.target.value)}
                  className="h-9 text-center font-semibold text-base w-24"
                />
                <span className="text-sm text-slate-400">/ {remaining} cần chuẩn bị</span>
              </div>
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
  const [showScan,          setShowScan]          = useState(false)
  const [showInventory,     setShowInventory]     = useState(false)
  const [expandedInvKeys,   setExpandedInvKeys]   = useState<Set<string>>(new Set())
  const [detailEntryId,     setDetailEntryId]     = useState<string | null>(null)

  const hasAutoScanned = useRef(false)

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
      unlockAudio()
      setShowScan(true)
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
    return [...map.values()].sort((a, b) => {
      const pa = a.pct_date ?? Infinity, pb = b.pct_date ?? Infinity
      return pa !== pb ? pa - pb : (a.is_qa ? 1 : -1)
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
  const looseScanned = (item.scan_entries ?? []).filter(s => s.is_loose_picking).reduce((sum, s) => sum + Number(s.cartons_scanned), 0)
  const ov           = Math.max(0, (item.cartons_scanned - looseScanned) - (item.cartons_ordered - item.loose_picking))
  const effectiveLoose = Math.max(0, item.loose_picking - ov)
  const looseDone    = Math.min(looseScanned, effectiveLoose)
  const isDone       = looseDone >= effectiveLoose
  const scans        = (item.scan_entries ?? []).filter(s => s.is_loose_picking)

  function openScan() {
    unlockAudio()
    setShowScan(true)
  }

  return (
    <>
      {showScan && (
        <ScanDialog item={item} gdoId={gdoId!} onClose={() => setShowScan(false)} />
      )}

      <div className="flex flex-col h-full min-h-0">

        {/* ── Header ── */}
        <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 overflow-y-auto" style={{ maxHeight: '30vh' }}>

          {/* Row 1: back + code + status + scan button */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                onClick={() => navigate(`/wms/loosepicking/${gdoId}`)}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="font-mono font-semibold text-sm">{matCode}</span>
              <Badge status={item.status} />
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setShowInventory(v => !v)}
                className={`flex items-center gap-1 h-7 px-2 rounded border text-xs font-medium transition-colors ${
                  showInventory
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
                title="Xem tồn kho trong kho"
              >
                <Package className="h-3.5 w-3.5" />
                Tồn kho{inventoryData.length > 0 ? ` (${inventoryData.length})` : ''}
              </button>
              {!isDone && can(perms, 'loosepicking', 'scan') && (
                <Button size="sm" className="h-7 text-xs gap-1" onClick={openScan}>
                  <QrCode className="h-3.5 w-3.5" /> Quét pallet
                </Button>
              )}
            </div>
          </div>

          {/* Row 2: name + progress */}
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-800 leading-tight">{matName}</p>
            <ProgressBar scanned={looseDone} target={effectiveLoose} />
          </div>

          {/* Row 3: metadata */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Scissors className="h-3 w-3 text-slate-400 shrink-0" />
              Nhặt lẻ: <span className="font-medium text-slate-700 ml-0.5">{effectiveLoose}</span>
              {effectiveLoose < item.loose_picking && <span className="text-slate-400 ml-0.5">(gốc {item.loose_picking})</span>}
            </span>
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3 text-slate-400 shrink-0" />
              Tổng: <span className="font-medium text-slate-700 ml-0.5">{item.cartons_ordered}</span> thùng
            </span>
            {item.batch_required && (
              <span>Batch: <span className="font-medium text-slate-700">{item.batch_required}</span></span>
            )}
            {item.date_required != null && item.date_required > 0 && (
              <span>%Date: <span className="font-semibold text-amber-700">{item.date_required}%</span></span>
            )}
          </div>

          {item.header_text && (
            <div className="text-xs font-medium text-slate-700 bg-blue-50 border border-blue-100 rounded px-2 py-1 leading-snug">
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
                            <span className={`text-[10px] font-semibold tabular-nums ${row.is_qa ? 'text-purple-700' : ''}`}>{row.cartons}</span>
                            <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
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
                              <span className="text-[10px] font-semibold tabular-nums text-blue-700">{e.available}</span>
                              <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
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
                  {!isDone && (
                    <Button size="sm" variant="outline" onClick={openScan}>
                      <QrCode className="h-4 w-4 mr-1" /> Quét pallet đầu tiên
                    </Button>
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
                            {se.cartons_scanned}
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
