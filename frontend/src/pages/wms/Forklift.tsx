import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Forklift as ForkliftIcon, ClipboardCheck, BarChart2, Settings2, Plus, Pencil, Trash2, CheckCircle2, XCircle, MoonStar, Eye, Camera, Maximize2, X } from 'lucide-react'
import type { AxiosError } from 'axios'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { SummaryBand, type BandTile } from '@/components/shared/SummaryBand'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { rowText, type RowStatusKey } from '@/lib/rowStatus'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import {
  useForklifts, useCreateForklift, useUpdateForklift, useDeleteForklift,
  useForkliftItems, useCreateForkliftItem, useUpdateForkliftItem, useDeleteForkliftItem,
  useForkliftBoard, useSaveForkliftLog, useDeleteForkliftLog, useForkliftLog, useForkliftLogs, useForkliftReport,
  type ForkliftVehicle, type ForkliftItem, type ForkliftBoardVehicle, type ForkliftChecklistResult,
  type ForkliftReportRow,
} from '@/api/hooks'

const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

// Nén ảnh chụp xe trước khi gửi (camera điện thoại 2-5MB → mục tiêu ≤ ~180KB):
// cạnh dài ≤1024px, JPEG hạ chất lượng DẦN 0.7→0.5 tới khi đạt mục tiêu; ảnh
// chi tiết quá thì hạ tiếp về 800px. Ảnh bằng chứng check xe không cần nét cao —
// 1024px xem trên điện thoại/PC vẫn rõ tình trạng xe.
const PHOTO_TARGET_BYTES = 180 * 1024
async function compressPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Không đọc được ảnh'))
      i.src = url
    })
    const draw = (maxEdge: number) => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      return canvas
    }
    const bytesOf = (dataUrl: string) => Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4)
    const canvas = draw(1024)
    let out = canvas.toDataURL('image/jpeg', 0.7)
    for (const q of [0.6, 0.5]) {
      if (bytesOf(out) <= PHOTO_TARGET_BYTES) break
      out = canvas.toDataURL('image/jpeg', q)
    }
    if (bytesOf(out) > PHOTO_TARGET_BYTES) out = draw(800).toDataURL('image/jpeg', 0.55)
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}
const fmtH = (n: number | null | undefined) =>
  n === null || n === undefined ? null : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 1 })

// Xem ảnh FULL MÀN HÌNH — portal ra body (thoát overflow/transform của Sheet/Dialog);
// pointer-events-auto BẮT BUỘC (Radix modal set pointer-events:none lên body);
// Escape bắt ở capture-phase + stopPropagation để KHÔNG đóng luôn Sheet/Dialog phía dưới.
function PhotoLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center pointer-events-auto"
      onClick={onClose} onPointerDown={e => e.stopPropagation()}>
      <img src={url} alt="Ảnh xe nâng" className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
      <button type="button" onClick={onClose} aria-label="Đóng"
        className="absolute top-3 right-3 rounded-full bg-white/10 hover:bg-white/25 text-white p-2.5 transition-colors">
        <X className="h-6 w-6" />
      </button>
      <p className="absolute bottom-3 left-0 right-0 text-center text-[11px] text-white/60">Bấm ra ngoài hoặc ✕ để đóng</p>
    </div>,
    document.body,
  )
}

function errMsg(e: unknown): string {
  const ax = e as AxiosError<{ error?: { message?: string } }>
  return ax.response?.data?.error?.message ?? ax.message ?? 'Lỗi không xác định'
}

// Màu row board theo trạng thái check trong ngày
function boardKey(v: ForkliftBoardVehicle): RowStatusKey {
  if (!v.log) return 'inProgress'                    // CHƯA check — cam (cần chú ý)
  if (v.log.status === 'IDLE') return 'pending'      // xe nghỉ — xám
  if (v.log.issue_count > 0) return 'paused'         // có hạng mục lỗi — đỏ
  return 'full'                                      // đã check, đạt — xanh
}
const BOARD_BADGE: Record<string, { cls: string; label: string }> = {
  none:  { cls: 'bg-amber-100 text-amber-700',   label: 'Chưa check' },
  idle:  { cls: 'bg-slate-200 text-slate-600',   label: 'Xe nghỉ' },
  issue: { cls: 'bg-red-100 text-red-700',       label: 'Có lỗi' },
  ok:    { cls: 'bg-green-100 text-green-700',   label: 'Đã check' },
}
const boardBadge = (v: ForkliftBoardVehicle) =>
  !v.log ? BOARD_BADGE.none : v.log.status === 'IDLE' ? BOARD_BADGE.idle : v.log.issue_count > 0 ? BOARD_BADGE.issue : BOARD_BADGE.ok

export default function Forklift() {
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canCheck = can(perms, 'forklift', 'check')
  const canVehicle = can(perms, 'forklift', 'manage_vehicle')
  const canItem = can(perms, 'forklift', 'manage_item')
  const showSettings = canVehicle || canItem

  const f = useWmsFilterStore(s => s.forklift)
  const setF = useWmsFilterStore(s => s.setForklift)
  const { data: warehouses = [] } = useScopedWarehouses(true)
  const whOpts = (warehouses as { id: string; name?: string; code?: string }[])
    .map(w => ({ value: w.id, label: w.name ?? w.id, sub: w.code }))

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <Tabs value={f.tab} onValueChange={v => setF({ tab: v as typeof f.tab })} className="flex flex-col flex-1 min-h-0">
          <div className="border-b bg-white px-3 py-2 shrink-0 flex items-center gap-2 flex-wrap sm:rounded-t-xl">
            <span className="text-sm font-semibold text-slate-700 shrink-0 flex items-center gap-1.5">
              <ForkliftIcon className="h-4 w-4 text-slate-500" /> Xe nâng
            </span>
            <TabsList className="h-8 max-w-full overflow-x-auto">
              <TabsTrigger value="board" className="gap-1.5 text-xs"><ClipboardCheck className="h-3.5 w-3.5" /> Check list ngày</TabsTrigger>
              <TabsTrigger value="report" className="gap-1.5 text-xs"><BarChart2 className="h-3.5 w-3.5" /> Báo cáo vận hành</TabsTrigger>
              {showSettings && <TabsTrigger value="settings" className="gap-1.5 text-xs"><Settings2 className="h-3.5 w-3.5" /> Cài đặt</TabsTrigger>}
            </TabsList>
          </div>

          <TabsContent value="board" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
            <BoardTab canCheck={canCheck} whOpts={whOpts} />
          </TabsContent>
          <TabsContent value="report" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
            <ReportTab canCheck={canCheck} whOpts={whOpts} active={f.tab === 'report'} />
          </TabsContent>
          {showSettings && (
            <TabsContent value="settings" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
              <SettingsTab canVehicle={canVehicle} canItem={canItem} whOpts={whOpts} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  )
}

// ─── Tab 1: Board check list ngày — kiểm soát xe nào CHƯA check ───────────────

function BoardTab({ canCheck, whOpts }: { canCheck: boolean; whOpts: { value: string; label: string; sub?: string }[] }) {
  const f = useWmsFilterStore(s => s.forklift)
  const setF = useWmsFilterStore(s => s.setForklift)
  const { data: board, isLoading } = useForkliftBoard(f.date)
  const [checking, setChecking] = useState<ForkliftBoardVehicle | null>(null)
  const [viewLogId, setViewLogId] = useState<string | null>(null)   // bấm dòng = XEM; Sửa là nút riêng (user chốt)

  // Xe CHƯA check nổi lên đầu (rồi tới có lỗi, nghỉ, đã check) — người giám sát nhìn phát thấy ngay
  const STATUS_RANK: Record<string, number> = { none: 0, issue: 1, idle: 2, ok: 3 }
  const vehicles = useMemo(
    () => (board?.vehicles ?? [])
      .filter(v => !f.warehouseId || v.warehouse_id === f.warehouseId)
      .sort((a, b) => {
        const ra = STATUS_RANK[!a.log ? 'none' : a.log.status === 'IDLE' ? 'idle' : a.log.issue_count > 0 ? 'issue' : 'ok']
        const rb = STATUS_RANK[!b.log ? 'none' : b.log.status === 'IDLE' ? 'idle' : b.log.issue_count > 0 ? 'issue' : 'ok']
        return ra !== rb ? ra - rb : a.code.localeCompare(b.code)
      }),
    [board, f.warehouseId],  // eslint-disable-line react-hooks/exhaustive-deps
  )
  const checked = vehicles.filter(v => v.log)
  const idle = checked.filter(v => v.log!.status === 'IDLE')
  const issues = vehicles.reduce((s, v) => s + (v.log?.issue_count ?? 0), 0)
  const tiles: BandTile[] = [
    { label: 'Tổng xe', value: vehicles.length },
    { label: 'Đã check', value: checked.length },
    { label: 'Chưa check', value: vehicles.length - checked.length, danger: vehicles.length - checked.length > 0 },
    { label: 'Xe nghỉ', value: idle.length },
    { label: 'Hạng mục lỗi', value: issues, danger: issues > 0 },
  ]

  const filterDefs: FilterDef[] = [
    { key: 'date', label: 'Ngày', type: 'date', value: f.date, onChange: v => setF({ date: v || todayVN() }), pinned: true },
    { key: 'wh', label: 'Kho', type: 'single', options: whOpts, value: f.warehouseId, onChange: v => setF({ warehouseId: v }), pinned: true },
  ]

  return (
    <>
      <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
        <FilterBar defs={filterDefs} />
        <FilterSheetButton defs={filterDefs} className="sm:hidden" />
        <p className="text-xs text-slate-500 ml-auto hidden sm:block">Bấm dòng xe để check list · xe nghỉ cũng ghi nhận vào đây</p>
      </div>
      <SummaryBand tiles={tiles} />
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
          vehicles.length === 0 ? (
            <div className="p-12 text-center text-slate-400 space-y-2">
              <ForkliftIcon className="h-10 w-10 mx-auto opacity-30" />
              <p className="text-sm">Chưa có xe nâng nào{f.warehouseId ? ' trong kho đã lọc' : ''}</p>
              <p className="text-xs">Khai báo xe ở tab Cài đặt (quyền Quản lý danh mục Xe nâng)</p>
            </div>
          ) : (
            <Table className="min-w-max [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap sticky left-0 z-20 bg-slate-50">Mã xe</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Kho</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên xe</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Số đồng hồ (h)</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Lần ghi trước</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Hạng mục lỗi</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Người check</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Lúc</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Ghi chú</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map(v => {
                  const badge = boardBadge(v)
                  return (
                    <TableRow key={v.id} className={`${v.log || canCheck ? 'cursor-pointer' : ''} ${rowText(boardKey(v))}`}
                      onClick={() => { if (v.log) setViewLogId(v.log.id); else if (canCheck) setChecking(v) }}>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold sticky left-0 z-10 bg-white">{v.code}</TableCell>
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{v.warehouse?.name ?? <span className="text-slate-300">—</span>}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap max-w-[180px] truncate" title={v.name ?? ''}>{v.name || <span className="text-slate-300">—</span>}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right font-semibold tabular-nums">
                        {v.log?.hour_meter != null ? fmtH(v.log.hour_meter) : <span className="text-slate-300">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">
                        {v.prev ? <>{fmtH(v.prev.hour_meter)} <span className="text-slate-400">({formatDate(v.prev.log_date)})</span></> : <span className="text-slate-300">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">
                        {v.log ? (v.log.issue_count > 0 ? <span className="text-red-600 font-semibold">{v.log.issue_count}</span> : 0) : <span className="text-slate-300">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{v.log?.checked_by || <span className="text-slate-300">—</span>}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">{v.log ? formatTimestampTime(v.log.updated_at) : <span className="text-slate-300">—</span>}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap max-w-[220px] truncate" title={v.log?.note ?? ''}>{v.log?.note || <span className="text-slate-300">—</span>}</TableCell>
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        <div className="flex items-center gap-0.5">
                          {v.log && (
                            <button className="text-slate-400 hover:text-sky-600 px-1.5 py-1 rounded" title="Xem chi tiết check list + ảnh"
                              onClick={e => { e.stopPropagation(); setViewLogId(v.log!.id) }}>
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canCheck && (
                            <button className="text-sky-600 hover:text-sky-800 px-1.5 py-1 rounded text-[10px] font-medium inline-flex items-center gap-1"
                              title={v.log ? 'Sửa check list hôm nay' : 'Check list xe này'}
                              onClick={e => { e.stopPropagation(); setChecking(v) }}>
                              {v.log ? <><Pencil className="h-3.5 w-3.5" /> Sửa</> : <><ClipboardCheck className="h-3.5 w-3.5" /> Check</>}
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
      </div>
      <div className="border-t px-3 py-1 text-[10px] text-slate-400 shrink-0">{vehicles.length} xe · ngày {formatDate(f.date)} · bấm dòng để XEM, nút Sửa để ghi lại</div>
      {checking && <CheckSheet vehicle={checking} date={f.date} onClose={() => setChecking(null)} />}
      {viewLogId && <LogDetailDialog id={viewLogId} onClose={() => setViewLogId(null)} />}
    </>
  )
}

// ─── FormSheet check list 1 xe / 1 ngày ───────────────────────────────────────

function CheckSheet({ vehicle, date, onClose }: { vehicle: ForkliftBoardVehicle; date: string; onClose: () => void }) {
  // Hạng mục = bộ DÙNG CHUNG + bộ RIÊNG của kho xe này (user chốt 31/07: cài đặt theo kho)
  const { data: items = [] } = useForkliftItems({ warehouseId: vehicle.warehouse_id })
  const save = useSaveForkliftLog()
  const [idle, setIdle] = useState(vehicle.log?.status === 'IDLE')
  const [meter, setMeter] = useState(vehicle.log?.hour_meter != null ? String(vehicle.log.hour_meter) : '')
  const [note, setNote] = useState(vehicle.log?.note ?? '')
  const [results, setResults] = useState<ForkliftChecklistResult[]>([])
  const [error, setError] = useState('')
  // Ảnh chụp xe: ảnh MỚI (data URL đã nén) hoặc ảnh ĐÃ CÓ của log cũ (signed URL — sửa lại không bắt chụp lại)
  const [photoData, setPhotoData] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoFull, setPhotoFull] = useState(false)
  const existingPhotoUrl = vehicle.log?.photo_url ?? null

  async function handlePickPhoto(file: File | undefined) {
    if (!file) return
    setPhotoBusy(true)
    setError('')
    try { setPhotoData(await compressPhoto(file)) }
    catch { setError('Không đọc được ảnh — chụp lại giúp') }
    finally { setPhotoBusy(false) }
  }

  // Khởi tạo check list: hạng mục active hiện hành, prefill từ log đã có (khớp item_id);
  // hạng mục đã bị xóa khỏi danh mục nhưng có trong log cũ → vẫn giữ (label snapshot).
  useEffect(() => {
    const prev = new Map((vehicle.log?.checklist ?? []).map(c => [c.item_id, c]))
    const fromItems: ForkliftChecklistResult[] = items.map(it => {
      const p = prev.get(it.id)
      return { item_id: it.id, label: it.label, ok: p ? p.ok : true, note: p?.note ?? null }
    })
    const itemIds = new Set(items.map(i => i.id))
    const orphans = (vehicle.log?.checklist ?? []).filter(c => !itemIds.has(c.item_id))
    setResults([...fromItems, ...orphans])
  }, [items, vehicle])

  function toggle(idx: number) {
    setResults(rs => rs.map((r, i) => i === idx ? { ...r, ok: !r.ok } : r))
  }
  function setItemNote(idx: number, v: string) {
    setResults(rs => rs.map((r, i) => i === idx ? { ...r, note: v } : r))
  }

  function handleSave() {
    setError('')
    if (!idle) {
      const m = Number(meter.replace(',', '.'))
      if (!meter.trim() || !Number.isFinite(m) || m < 0) { setError('Nhập số đồng hồ giờ (số ≥ 0) — xe nghỉ thì tick "Xe nghỉ hôm nay"'); return }
      if (!photoData && !existingPhotoUrl) { setError('Xe hoạt động phải CHỤP ẢNH XE mới được lưu'); return }
    }
    save.mutate({
      forklift_id: vehicle.id,
      log_date: date,
      status: idle ? 'IDLE' : 'ACTIVE',
      hour_meter: idle ? null : Number(meter.replace(',', '.')),
      checklist: idle ? [] : results,   // xe nghỉ không cần check an toàn
      note: note.trim() || null,
      photo_data: idle ? null : photoData,
    }, {
      onSuccess: () => { toast({ title: `Đã ghi check list ${vehicle.code} — ${formatDate(date)}` }); onClose() },
      onError: e => setError(errMsg(e)),
    })
  }

  const failCount = results.filter(r => !r.ok).length
  return (
    <FormSheet open onClose={onClose}
      title={<span className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-sky-600" /> Check list {vehicle.code} · {formatDate(date)}</span>}
      description={vehicle.name || vehicle.warehouse?.name}
      footer={<>
        <Button variant="outline" onClick={onClose}>Hủy</Button>
        <Button onClick={handleSave} disabled={save.isPending} className="bg-blue-600 hover:bg-blue-700">
          {save.isPending ? 'Đang lưu…' : vehicle.log ? 'Cập nhật' : 'Lưu check list'}
        </Button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

        {/* 2 checkbox loại trừ nhau (user chốt 31/07): Hoạt động = check an toàn + chụp ảnh · Nghỉ = khỏi check */}
        <div className="grid grid-cols-2 gap-2">
          <label className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-colors ${!idle ? 'border-green-400 bg-green-50 text-green-800 font-medium' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            <input type="checkbox" checked={!idle} onChange={() => setIdle(false)} className="h-4 w-4 accent-green-600" />
            <span className="flex items-center gap-1.5"><ClipboardCheck className="h-4 w-4" /> Xe hoạt động</span>
          </label>
          <label className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-colors ${idle ? 'border-slate-400 bg-slate-100 text-slate-700 font-medium' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            <input type="checkbox" checked={idle} onChange={() => setIdle(true)} className="h-4 w-4 accent-slate-600" />
            <span className="flex items-center gap-1.5"><MoonStar className="h-4 w-4" /> Xe nghỉ hôm nay</span>
          </label>
        </div>

        {idle && (
          <p className="text-xs text-slate-500 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            Xe nghỉ — không cần check an toàn, không cần số đồng hồ. Bấm Lưu để ghi nhận.
          </p>
        )}

        {!idle && (
          <div className="space-y-1">
            <Label className="text-xs">Số đồng hồ giờ hiện tại (h) <span className="text-red-500">*</span></Label>
            <Input inputMode="decimal" value={meter} onChange={e => setMeter(e.target.value)} placeholder="vd 1500" className="h-9 tabular-nums" />
            <p className="text-[10px] text-slate-400">
              {vehicle.prev
                ? <>Lần ghi trước: <b>{fmtH(vehicle.prev.hour_meter)}</b> ({formatDate(vehicle.prev.log_date)}) — giờ chạy = số lần sau − số lần trước</>
                : 'Chưa có lần ghi trước — đây là mốc đầu tiên'}
            </p>
          </div>
        )}

        {/* Ảnh chụp xe — BẮT BUỘC khi hoạt động */}
        {!idle && (
          <div className="space-y-1.5">
            <Label className="text-xs">Ảnh chụp xe <span className="text-red-500">*</span></Label>
            {(photoData || existingPhotoUrl) && (
              <div className="relative">
                <img src={photoData ?? existingPhotoUrl ?? undefined} alt="Ảnh xe nâng"
                  className="w-full max-h-52 object-contain rounded-lg border border-slate-200 bg-slate-50 cursor-zoom-in"
                  onClick={() => setPhotoFull(true)} />
                <button type="button" title="Xem full màn hình" onClick={() => setPhotoFull(true)}
                  className="absolute top-1.5 right-1.5 rounded-md bg-slate-900/60 hover:bg-slate-900/80 text-white p-1.5 transition-colors">
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            )}
            {photoFull && (photoData || existingPhotoUrl) && (
              <PhotoLightbox url={(photoData ?? existingPhotoUrl)!} onClose={() => setPhotoFull(false)} />
            )}
            <label className={`flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm cursor-pointer transition-colors ${photoData || existingPhotoUrl ? 'border-slate-200 text-slate-500 hover:bg-slate-50' : 'border-sky-400 bg-sky-50 text-sky-700 font-medium'}`}>
              <Camera className="h-4 w-4" />
              {photoBusy ? 'Đang xử lý ảnh…' : photoData ? 'Chụp lại ảnh khác' : existingPhotoUrl ? 'Chụp lại (đã có ảnh lần trước)' : 'Chụp ảnh xe'}
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { void handlePickPhoto(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            <p className="text-[10px] text-slate-400">Ảnh tự nén trước khi gửi · chưa có ảnh thì KHÔNG lưu được</p>
          </div>
        )}

        {!idle && (<div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Hạng mục kiểm tra an toàn</Label>
            {failCount > 0 && <span className="text-[10px] text-red-600 font-medium">{failCount} hạng mục KHÔNG đạt</span>}
          </div>
          {results.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">Chưa khai báo hạng mục check list (tab Cài đặt)</p>
          ) : (
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              {results.map((r, i) => (
                <div key={r.item_id || `orphan-${i}`} className="px-2.5 py-1.5">
                  <button type="button" onClick={() => toggle(i)} className="w-full flex items-center gap-2 text-left">
                    {r.ok
                      ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      : <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
                    <span className={`text-xs flex-1 ${r.ok ? 'text-slate-700' : 'text-red-600 font-medium'}`}>{r.label}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${r.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{r.ok ? 'Đạt' : 'Lỗi'}</span>
                  </button>
                  {!r.ok && (
                    <Input value={r.note ?? ''} onChange={e => setItemNote(i, e.target.value)}
                      placeholder="Mô tả lỗi / hướng xử lý…" className="h-7 mt-1 text-xs border-red-200" />
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-slate-400">Bấm vào hạng mục để chuyển Đạt ↔ Lỗi (mặc định Đạt)</p>
        </div>)}

        <div className="space-y-1">
          <Label className="text-xs">Ghi chú chung</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Ghi chú thêm (nếu có)…" className="h-9" />
        </div>
      </div>
    </FormSheet>
  )
}

// ─── Tab 2: Báo cáo vận hành ──────────────────────────────────────────────────

// Khối dashboard (card trắng + tiêu đề accent) — cùng ngôn ngữ với Giám sát vận hành
function DashBlock({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className="bg-slate-100 border-b border-l-2 border-l-sky-500 px-2.5 py-1 flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase text-slate-600">{title}</span>
        {sub && <span className="text-[9px] text-slate-400">{sub}</span>}
      </div>
      <div className="p-2.5">{children}</div>
    </div>
  )
}

function ReportTab({ canCheck, whOpts, active }: { canCheck: boolean; whOpts: { value: string; label: string; sub?: string }[]; active: boolean }) {
  const f = useWmsFilterStore(s => s.forklift)
  const setF = useWmsFilterStore(s => s.setForklift)
  const { data, isLoading, error } = useForkliftReport({ from: f.from, to: f.to, warehouse_id: f.warehouseId || undefined }, active)
  const { data: allVehicles = [] } = useForklifts()   // xe active — mẫu số tuân thủ (kể cả xe 0 lần check)
  const del = useDeleteForkliftLog()
  const [viewLogId, setViewLogId] = useState<string | null>(null)

  const rows = data?.rows ?? []
  const summary = data?.summary ?? []
  const issueItems = data?.issue_items ?? []
  const vehicles = f.warehouseId ? allVehicles.filter(v => v.warehouse_id === f.warehouseId) : allVehicles

  // Trục ngày: từ from → min(to, hôm nay) — ngày tương lai không tính vào tuân thủ
  const today = todayVN()
  const endDate = f.to < today ? f.to : today
  const days = useMemo(() => {
    const out: string[] = []
    if (!f.from || f.from > endDate) return out
    const d = new Date(`${f.from}T00:00:00Z`)
    for (let i = 0; i < 93 && out[out.length - 1] !== endDate; i++) {
      out.push(d.toISOString().slice(0, 10))
      d.setUTCDate(d.getUTCDate() + 1)
    }
    return out
  }, [f.from, endDate])

  const totalHours = Math.round(summary.reduce((s, r) => s + r.total_hours, 0) * 10) / 10
  const closedActiveDays = summary.reduce((s, r) => s + r.active_days - r.open_days, 0)
  const avgHours = closedActiveDays > 0 ? Math.round((totalHours / closedActiveDays) * 10) / 10 : null
  const expectedChecks = vehicles.length * days.length
  const compliance = expectedChecks > 0 ? Math.round((rows.length / expectedChecks) * 100) : null
  const totalIssues = summary.reduce((s, r) => s + r.issue_count, 0)

  const tiles: BandTile[] = [
    { label: 'Tổng giờ chạy', value: fmtH(totalHours) ?? 0, accent: true, tip: 'Tổng giờ đã chốt (hiệu số đồng hồ giữa 2 lần ghi liên tiếp)' },
    { label: 'Giờ TB / ngày chạy', value: avgHours ?? '—', tip: 'Tổng giờ chạy ÷ số ngày chạy đã chốt' },
    { label: 'Tuân thủ check', value: compliance !== null ? `${compliance}%` : '—', danger: compliance !== null && compliance < 80, tip: `Số lượt đã check ÷ (${vehicles.length} xe × ${days.length} ngày)` },
    { label: 'Hạng mục lỗi', value: totalIssues, danger: totalIssues > 0 },
    { label: 'Ngày nghỉ', value: summary.reduce((s, r) => s + r.idle_days, 0) },
    { label: 'Chờ chốt', value: summary.reduce((s, r) => s + r.open_days, 0), tip: 'Lần ghi chưa có số kế tiếp — giờ chạy chốt khi có lần ghi sau' },
  ]

  // Dữ liệu chart
  const byDate = useMemo(() => {
    const m = new Map<string, { hours: number; checked: number; issues: number }>()
    for (const r of rows) {
      const e = m.get(r.log_date) ?? { hours: 0, checked: 0, issues: 0 }
      e.hours = Math.round((e.hours + (r.hours_run ?? 0)) * 10) / 10
      e.checked++
      e.issues += r.issue_count
      m.set(r.log_date, e)
    }
    return m
  }, [rows])
  const maxDayHours = Math.max(1, ...days.map(d => byDate.get(d)?.hours ?? 0))

  const byHours = [...summary].sort((a, b) => b.total_hours - a.total_hours)
  const maxVehHours = Math.max(1, ...byHours.map(s => s.total_hours))

  const checkedDaysByFk = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.forklift_id, (m.get(r.forklift_id) ?? 0) + 1)
    return m
  }, [rows])
  const complianceRows = vehicles
    .map(v => ({ code: v.code, checked: checkedDaysByFk.get(v.id) ?? 0, pct: days.length ? Math.round(((checkedDaysByFk.get(v.id) ?? 0) / days.length) * 100) : 0 }))
    .sort((a, b) => a.pct - b.pct || a.code.localeCompare(b.code))

  const issueByVehicle = summary.filter(s => s.issue_count > 0).sort((a, b) => b.issue_count - a.issue_count).slice(0, 5)
  const maxIssueCnt = Math.max(1, ...issueItems.map(i => i.cnt))

  const filterDefs: FilterDef[] = [
    { key: 'range', label: 'Khoảng ngày', type: 'daterange', from: f.from, to: f.to, onChange: (from, to) => setF({ from: from || todayVN(), to: to || from || todayVN() }), pinned: true },
    { key: 'wh', label: 'Kho', type: 'single', options: whOpts, value: f.warehouseId, onChange: v => setF({ warehouseId: v }), pinned: true },
  ]

  function handleDelete(r: ForkliftReportRow) {
    if (!confirm(`Xóa bản ghi ${r.code} ngày ${formatDate(r.log_date)}? (ghi nhầm xe/ngày)`)) return
    del.mutate(r.id, { onError: e => toast({ variant: 'destructive', title: 'Không xóa được', description: errMsg(e) }) })
  }

  return (
    <>
      <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
        <FilterBar defs={filterDefs} />
        <FilterSheetButton defs={filterDefs} className="sm:hidden" />
      </div>
      <SummaryBand tiles={tiles} />
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {error ? (
          <div className="m-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{errMsg(error)}</div>
        ) : isLoading ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
        rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <BarChart2 className="h-10 w-10 mx-auto opacity-30" />
            <p className="text-sm">Không có dữ liệu check list trong khoảng ngày này</p>
          </div>
        ) : (
          <div className="space-y-3 p-3">
            {/* ── DASHBOARD ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* 1. Giờ chạy theo ngày */}
              <DashBlock title="Giờ chạy theo ngày" sub="cột = tổng giờ đã chốt của mọi xe">
                <div className="overflow-x-auto">
                  <div className="flex items-end gap-px h-28 min-w-[240px]">
                    {days.map(d => {
                      const e = byDate.get(d)
                      const h = e ? Math.round((e.hours / maxDayHours) * 100) : 0
                      return (
                        <div key={d} className="flex-1 min-w-[5px] flex items-end justify-center h-full"
                          title={`${formatDate(d)} — ${fmtH(e?.hours ?? 0)}h · ${e?.checked ?? 0} xe check${e?.issues ? ` · ${e.issues} lỗi` : ''}`}>
                          <div className={`w-full max-w-[22px] rounded-t ${e?.issues ? 'bg-amber-500' : 'bg-sky-500'}`}
                            style={{ height: `${h}%`, minHeight: e?.hours ? 2 : 0 }} />
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex gap-px mt-0.5 min-w-[240px]">
                    {days.map((d, i) => (
                      <div key={d} className="flex-1 min-w-[5px] text-center text-[8px] text-slate-400">
                        {(days.length <= 14 || i % Math.ceil(days.length / 14) === 0) ? d.slice(8) : ''}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[9px] text-slate-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-sky-500 inline-block" /> Giờ chạy</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500 inline-block" /> Ngày có hạng mục lỗi</span>
                </div>
              </DashBlock>

              {/* 2. Giờ chạy theo xe */}
              <DashBlock title="Giờ chạy theo xe" sub="xếp từ nhiều → ít (giờ đã chốt)">
                {byHours.length === 0 ? <p className="text-xs text-slate-400 py-4 text-center">Chưa có dữ liệu</p> : (
                  <div className="space-y-1">
                    {byHours.slice(0, 12).map(s => (
                      <div key={s.forklift_id} className="flex items-center gap-2" title={`${s.code} — ${fmtH(s.total_hours)}h / ${s.active_days} ngày chạy${s.open_days ? ` · ${s.open_days} chờ chốt` : ''}`}>
                        <span className="w-16 shrink-0 text-[10px] font-mono font-semibold text-slate-700 truncate">{s.code}</span>
                        <div className="flex-1 h-3.5 bg-slate-100 rounded overflow-hidden">
                          <div className="h-full bg-sky-500 rounded" style={{ width: `${Math.max(1, Math.round((s.total_hours / maxVehHours) * 100))}%` }} />
                        </div>
                        <span className="w-14 shrink-0 text-right text-[10px] font-semibold tabular-nums">{fmtH(s.total_hours)}h</span>
                      </div>
                    ))}
                    {byHours.length > 12 && <p className="text-[9px] text-slate-400">+{byHours.length - 12} xe khác (xem bảng dưới)</p>}
                  </div>
                )}
              </DashBlock>

              {/* 3. Tuân thủ check list theo xe */}
              <DashBlock title="Tuân thủ check list theo xe" sub={`% ngày đã check / ${days.length} ngày · xe kém nhất lên đầu`}>
                {complianceRows.length === 0 ? <p className="text-xs text-slate-400 py-4 text-center">Chưa có xe nào</p> : (
                  <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                    {complianceRows.map(c => (
                      <div key={c.code} className="flex items-center gap-2" title={`${c.code} — đã check ${c.checked}/${days.length} ngày`}>
                        <span className="w-16 shrink-0 text-[10px] font-mono font-semibold text-slate-700 truncate">{c.code}</span>
                        <div className="flex-1 h-3.5 bg-slate-100 rounded overflow-hidden">
                          <div className={`h-full rounded ${c.pct >= 90 ? 'bg-green-500' : c.pct >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${Math.max(2, c.pct)}%` }} />
                        </div>
                        <span className={`w-20 shrink-0 text-right text-[10px] font-semibold tabular-nums ${c.pct < 60 ? 'text-red-600' : ''}`}>{c.pct}% ({c.checked}/{days.length})</span>
                      </div>
                    ))}
                  </div>
                )}
              </DashBlock>

              {/* 4. Lỗi an toàn */}
              <DashBlock title="Lỗi an toàn" sub="hạng mục bị đánh LỖI nhiều nhất trong khoảng ngày">
                {issueItems.length === 0 ? (
                  <p className="text-xs text-green-600 py-4 text-center flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" /> Không có hạng mục lỗi nào — đội xe an toàn
                  </p>
                ) : (
                  <div className="space-y-1">
                    {issueItems.map(it => (
                      <div key={it.label} className="flex items-center gap-2" title={`${it.label} — ${it.cnt} lượt lỗi`}>
                        <span className="flex-1 min-w-0 text-[10px] text-slate-700 truncate">{it.label}</span>
                        <div className="w-28 shrink-0 h-3.5 bg-slate-100 rounded overflow-hidden">
                          <div className="h-full bg-red-500 rounded" style={{ width: `${Math.max(4, Math.round((it.cnt / maxIssueCnt) * 100))}%` }} />
                        </div>
                        <span className="w-7 shrink-0 text-right text-[10px] font-semibold tabular-nums text-red-600">{it.cnt}</span>
                      </div>
                    ))}
                    {issueByVehicle.length > 0 && (
                      <p className="text-[9px] text-slate-500 pt-1.5 border-t border-slate-100 mt-2">
                        Xe lỗi nhiều: {issueByVehicle.map(s => `${s.code} (${s.issue_count})`).join(' · ')}
                      </p>
                    )}
                  </div>
                )}
              </DashBlock>
            </div>

            {/* ── MA TRẬN CHECK LIST: ngày × hạng mục, filter theo XE (user chốt 31/07) ── */}
            <ChecklistMatrix vehicles={vehicles} days={days} from={f.from} to={f.to} />

            {/* ── BẢNG TRA CỨU ── */}
            {/* Tổng hợp theo xe */}
            <div>
              <div className="bg-slate-100 border-b border-l-2 border-l-sky-500 px-2 py-1 text-[10px] font-semibold uppercase text-slate-600">Tổng hợp theo xe</div>
              <Table className="min-w-max [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mã xe</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên xe</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Giờ chạy</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Ngày chạy</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Ngày nghỉ</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Chờ chốt</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Hạng mục lỗi</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Đồng hồ mới nhất</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map(s => (
                    <TableRow key={s.forklift_id}>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">{s.code}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap max-w-[180px] truncate" title={s.forklift_name ?? ''}>{s.forklift_name || <span className="text-slate-300">—</span>}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right font-semibold tabular-nums">{fmtH(s.total_hours)}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{s.active_days}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{s.idle_days}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{s.open_days > 0 ? s.open_days : <span className="text-slate-300">0</span>}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{s.issue_count > 0 ? <span className="text-red-600 font-semibold">{s.issue_count}</span> : 0}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">
                        {s.last_meter != null ? <>{fmtH(s.last_meter)} <span className="text-slate-400">({formatDate(s.last_date!)})</span></> : <span className="text-slate-300">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Chi tiết từng ngày */}
            <div>
              <div className="bg-slate-100 border-b border-l-2 border-l-sky-500 px-2 py-1 text-[10px] font-semibold uppercase text-slate-600">Chi tiết theo ngày ({rows.length} dòng)</div>
              <Table className="min-w-max [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Ngày</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mã xe</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Số đồng hồ</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Giờ chạy</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Lỗi</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Người check</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Lúc check</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Ghi chú</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setViewLogId(r.id)}>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">{formatDate(r.log_date)}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">{r.code}</TableCell>
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        {r.status === 'IDLE'
                          ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">Nghỉ</span>
                          : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Chạy</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{r.hour_meter != null ? fmtH(r.hour_meter) : <span className="text-slate-300">—</span>}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right font-semibold tabular-nums">
                        {r.hours_run != null ? fmtH(r.hours_run) : r.status === 'IDLE' ? 0 : <span className="text-slate-400 font-normal" title="Chưa có lần ghi kế tiếp">chờ chốt</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{r.issue_count > 0 ? <span className="text-red-600 font-semibold">{r.issue_count}</span> : 0}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{r.checked_by || <span className="text-slate-300">—</span>}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">
                        {r.checked_at ? <>{formatTimestampDate(r.checked_at, true)} <span className="text-slate-400">{formatTimestampTime(r.checked_at)}</span></> : <span className="text-slate-300">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap max-w-[200px] truncate" title={r.note ?? ''}>{r.note || <span className="text-slate-300">—</span>}</TableCell>
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        <div className="flex items-center gap-0.5">
                          <button className="text-slate-400 hover:text-sky-600 p-1" title="Xem chi tiết check list"
                            onClick={e => { e.stopPropagation(); setViewLogId(r.id) }}>
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {canCheck && (
                            <button className="text-slate-400 hover:text-red-500 p-1" title="Xóa bản ghi (ghi nhầm)" disabled={del.isPending}
                              onClick={e => { e.stopPropagation(); handleDelete(r) }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
      {viewLogId && <LogDetailDialog id={viewLogId} onClose={() => setViewLogId(null)} />}
    </>
  )
}

// ─── Ma trận check list: DÒNG = ngày · CỘT = hạng mục · filter = XE ──────────
function ChecklistMatrix({ vehicles, days, from, to }: {
  vehicles: { id: string; code: string; name: string | null }[]
  days: string[]   // trục ngày (asc, đã cắt tới hôm nay)
  from: string; to: string
}) {
  const f = useWmsFilterStore(s => s.forklift)
  const setF = useWmsFilterStore(s => s.setForklift)
  const sorted = useMemo(() => [...vehicles].sort((a, b) => a.code.localeCompare(b.code)), [vehicles])
  // xe đã chọn không còn trong danh sách (đổi filter kho / xe ngừng dùng) → tự về xe đầu
  const effectiveFk = sorted.some(v => v.id === f.matrixFk) ? f.matrixFk : (sorted[0]?.id ?? '')
  const { data: logs = [], isLoading } = useForkliftLogs({ forklift_id: effectiveFk, from, to }, !!effectiveFk)
  const [viewLogId, setViewLogId] = useState<string | null>(null)

  // Cột = hạng mục theo thứ tự xuất hiện ở log MỚI NHẤT trước (phản ánh cấu hình hiện tại),
  // hạng mục cũ đã gỡ vẫn thành cột riêng (label snapshot) — lịch sử không mất
  const labels = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const log of logs) for (const c of log.checklist ?? []) if (!seen.has(c.label)) { seen.add(c.label); out.push(c.label) }
    return out
  }, [logs])
  const byDate = useMemo(() => new Map(logs.map(l => [l.log_date, l])), [logs])
  const daysDesc = useMemo(() => [...days].reverse(), [days])
  const vehicle = sorted.find(v => v.id === effectiveFk)

  return (
    <DashBlock title="Ma trận check list theo ngày" sub="dòng = ngày · cột = hạng mục · bấm dòng xem chi tiết + ảnh">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-[10px] text-slate-500 shrink-0">Xe nâng:</span>
        <SingleSelect
          options={sorted.map(v => ({ value: v.id, label: v.code, sub: v.name ?? undefined }))}
          value={effectiveFk} onChange={v => setF({ matrixFk: v })}
          placeholder="Chọn xe…" triggerClassName="w-44" />
        <div className="flex items-center gap-3 text-[9px] text-slate-500 ml-auto">
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" /> Đạt</span>
          <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-red-500" /> Lỗi (rê chuột xem ghi chú)</span>
          <span className="flex items-center gap-1"><span className="text-[9px] px-1 rounded-full bg-slate-200 text-slate-600">Nghỉ</span></span>
          <span className="flex items-center gap-1"><span className="text-[9px] px-1 rounded-full bg-amber-100 text-amber-700">Chưa check</span></span>
        </div>
      </div>
      {!effectiveFk ? <p className="text-xs text-slate-400 py-4 text-center">Chưa có xe nâng nào trong phạm vi lọc</p> :
       isLoading ? <p className="text-xs text-slate-400 py-4 text-center">Đang tải…</p> : (
        <div className="overflow-auto max-h-[420px] border border-slate-200 rounded">
          <Table className="min-w-max [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap sticky left-0 z-20 bg-slate-50">Ngày</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
                {labels.map(lb => (
                  <TableHead key={lb} className="px-1.5 py-1.5 text-[9px] whitespace-nowrap text-center">
                    <div className="max-w-[110px] truncate" title={lb}>{lb}</div>
                  </TableHead>
                ))}
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Số đồng hồ</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Người check</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Lúc</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {daysDesc.map(d => {
                const log = byDate.get(d)
                const cells = new Map((log?.checklist ?? []).map(c => [c.label, c]))
                return (
                  <TableRow key={d} className={log ? 'cursor-pointer' : ''}
                    onClick={() => { if (log) setViewLogId(log.id) }}>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums sticky left-0 z-10 bg-white">{formatDate(d)}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {!log ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Chưa check</span>
                        : log.status === 'IDLE' ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">Nghỉ</span>
                        : log.issue_count > 0 ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">Có lỗi</span>
                        : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Chạy</span>}
                    </TableCell>
                    {labels.map(lb => {
                      const c = cells.get(lb)
                      return (
                        <TableCell key={lb} className="px-1.5 py-1 whitespace-nowrap text-center"
                          title={log && c && !c.ok ? `${lb}: LỖI${c.note ? ` — ${c.note}` : ''}` : undefined}>
                          {!log || log.status === 'IDLE' || !c
                            ? <span className="text-slate-300">—</span>
                            : c.ok
                              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 inline" />
                              : <XCircle className="h-3.5 w-3.5 text-red-500 inline" />}
                        </TableCell>
                      )
                    })}
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right font-semibold tabular-nums">
                      {log?.hour_meter != null ? fmtH(log.hour_meter) : <span className="text-slate-300 font-normal">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{log?.checked_by || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">{log ? formatTimestampTime(log.updated_at) : <span className="text-slate-300">—</span>}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {effectiveFk && vehicle && (
        <p className="text-[9px] text-slate-400 mt-1">{vehicle.code}{vehicle.name ? ` · ${vehicle.name}` : ''} — {daysDesc.length} ngày · {logs.length} ngày đã check</p>
      )}
      {viewLogId && <LogDetailDialog id={viewLogId} onClose={() => setViewLogId(null)} />}
    </DashBlock>
  )
}

function LogDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: log, isLoading } = useForkliftLog(id)
  const [photoFull, setPhotoFull] = useState(false)
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Check list {log?.forklift?.code ?? ''}{log?.log_date ? ` · ${formatDate(log.log_date)}` : ''}
          </DialogTitle>
        </DialogHeader>
        {isLoading || !log ? <div className="py-6 text-center text-sm text-slate-400">Đang tải…</div> : (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600">
              <span>Trạng thái: <b>{log.status === 'IDLE' ? 'Xe nghỉ' : 'Chạy'}</b></span>
              {log.hour_meter != null && <span>Số đồng hồ: <b className="tabular-nums">{fmtH(log.hour_meter)}</b></span>}
              {log.checked_by && <span>Người check: <b>{log.checked_by}</b></span>}
              {log.updated_at && <span>Lúc: <b className="tabular-nums">{formatTimestampDate(log.updated_at, true)} {formatTimestampTime(log.updated_at)}</b></span>}
            </div>
            {(log.checklist ?? []).length === 0 ? (
              <p className="text-slate-400">Không có hạng mục nào được ghi</p>
            ) : (
              <div className="rounded border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {log.checklist.map((c, i) => (
                  <div key={i} className="px-2.5 py-1.5 flex items-start gap-2">
                    {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" /> : <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />}
                    <div className="min-w-0">
                      <p className={c.ok ? 'text-slate-700' : 'text-red-600 font-medium'}>{c.label}</p>
                      {c.note && <p className="text-[10px] text-slate-500">{c.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {log.note && <p className="text-slate-600">Ghi chú: {log.note}</p>}
            {log.photo_url && (
              <div className="relative">
                <img src={log.photo_url} alt="Ảnh xe lúc check" onClick={() => setPhotoFull(true)}
                  className="w-full max-h-56 object-contain rounded border border-slate-200 bg-slate-50 cursor-zoom-in" />
                <button type="button" title="Xem full màn hình" onClick={() => setPhotoFull(true)}
                  className="absolute top-1.5 right-1.5 rounded-md bg-slate-900/60 hover:bg-slate-900/80 text-white p-1.5 transition-colors">
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            )}
            {photoFull && log.photo_url && <PhotoLightbox url={log.photo_url} onClose={() => setPhotoFull(false)} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Tab 3: Cài đặt (danh mục Xe nâng + Hạng mục check list) ─────────────────

function SettingsTab({ canVehicle, canItem, whOpts }: { canVehicle: boolean; canItem: boolean; whOpts: { value: string; label: string; sub?: string }[] }) {
  const f = useWmsFilterStore(s => s.forklift)
  const setF = useWmsFilterStore(s => s.setForklift)
  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', options: whOpts, value: f.warehouseId, onChange: v => setF({ warehouseId: v }), pinned: true },
  ]
  return (
    <>
      <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
        <FilterBar defs={filterDefs} />
        <FilterSheetButton defs={filterDefs} className="sm:hidden" />
        <p className="text-xs text-slate-500 ml-auto hidden sm:block">Hạng mục "Dùng chung" áp mọi kho · hạng mục gắn kho chỉ áp xe kho đó</p>
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <div className="space-y-4 p-3">
          {canVehicle && <VehicleSection whOpts={whOpts} warehouseId={f.warehouseId} />}
          {canItem && <ItemSection whOpts={whOpts} warehouseId={f.warehouseId} />}
        </div>
      </div>
    </>
  )
}

function VehicleSection({ whOpts, warehouseId }: { whOpts: { value: string; label: string; sub?: string }[]; warehouseId: string }) {
  const { data: allVehicles = [], isLoading } = useForklifts(true)
  const vehicles = warehouseId ? allVehicles.filter(v => v.warehouse_id === warehouseId) : allVehicles
  const del = useDeleteForklift()
  const [editing, setEditing] = useState<ForkliftVehicle | null>(null)
  const [showForm, setShowForm] = useState(false)

  function handleDelete(v: ForkliftVehicle) {
    if (!confirm(`Xóa xe nâng "${v.code}"? (xe đã có check list sẽ bị chặn — dùng Ngừng dùng)`)) return
    del.mutate(v.id, { onError: e => toast({ variant: 'destructive', title: 'Không xóa được', description: errMsg(e) }) })
  }

  return (
    <div>
      <div className="bg-slate-100 border-b border-l-2 border-l-sky-500 px-2 py-1 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase text-slate-600 flex-1">Danh mục xe nâng ({vehicles.length})</span>
        <ActionCluster items={[{
          key: 'add', icon: Plus, label: 'Thêm xe', tip: 'Khai báo xe nâng mới',
          primary: true, variant: 'default', onClick: () => { setEditing(null); setShowForm(true) },
        } satisfies ActionItem]} />
      </div>
      {isLoading ? <div className="p-6 text-center text-sm text-slate-400">Đang tải…</div> : (
        <Table className="min-w-max [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
          <TableHeader>
            <TableRow>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mã xe</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên xe</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Kho</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tạo</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.map(v => (
              <TableRow key={v.id} className={!v.is_active ? 'opacity-50' : ''}>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">{v.code}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap max-w-[200px] truncate" title={v.name ?? ''}>{v.name || <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{v.warehouse?.name ?? v.warehouse_id}</TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <Badge variant="outline" className={`text-[10px] ${v.is_active ? 'border-green-200 text-green-700' : 'border-slate-200 text-slate-400'}`}>
                    {v.is_active ? 'Đang dùng' : 'Ngừng dùng'}
                  </Badge>
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <div className="leading-tight">
                    <div className="text-[10px] text-slate-600">{v.created_by ?? <span className="text-slate-300">—</span>}</div>
                    <div className="text-[9px] text-slate-400">{formatDate(v.created_at.slice(0, 10))}</div>
                  </div>
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <div className="flex items-center gap-0.5">
                    <button className="text-slate-400 hover:text-blue-500 p-1" onClick={() => { setEditing(v); setShowForm(true) }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button className="text-slate-400 hover:text-red-500 p-1" disabled={del.isPending} onClick={() => handleDelete(v)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {showForm && <VehicleSheet vehicle={editing} whOpts={whOpts} onClose={() => setShowForm(false)} />}
    </div>
  )
}

function VehicleSheet({ vehicle, whOpts, onClose }: { vehicle: ForkliftVehicle | null; whOpts: { value: string; label: string; sub?: string }[]; onClose: () => void }) {
  const create = useCreateForklift()
  const update = useUpdateForklift()
  const [code, setCode] = useState(vehicle?.code ?? '')
  const [name, setName] = useState(vehicle?.name ?? '')
  const [whId, setWhId] = useState(vehicle?.warehouse_id ?? (whOpts.length === 1 ? whOpts[0].value : ''))
  const [active, setActive] = useState(vehicle?.is_active ?? true)
  const [error, setError] = useState('')
  const saving = create.isPending || update.isPending

  function handleSave() {
    setError('')
    if (!code.trim()) { setError('Mã xe bắt buộc'); return }
    if (!whId) { setError('Chưa chọn kho'); return }
    const opts = {
      onSuccess: () => { toast({ title: vehicle ? 'Đã cập nhật xe nâng' : 'Đã thêm xe nâng' }); onClose() },
      onError: (e: unknown) => setError(errMsg(e)),
    }
    if (vehicle) update.mutate({ id: vehicle.id, code: code.trim(), name: name.trim() || null, warehouse_id: whId, is_active: active }, opts)
    else create.mutate({ code: code.trim(), name: name.trim() || null, warehouse_id: whId }, opts)
  }

  return (
    <FormSheet open onClose={onClose}
      title={vehicle ? `Sửa xe nâng ${vehicle.code}` : 'Thêm xe nâng'}
      footer={<>
        <Button variant="outline" onClick={onClose}>Hủy</Button>
        <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">{saving ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <div className="space-y-1">
          <Label className="text-xs">Mã xe <span className="text-red-500">*</span></Label>
          <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="vd XN01" className="h-9 font-mono" maxLength={30} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tên / mô tả</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="vd Toyota 2.5T điện" className="h-9" maxLength={120} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Kho <span className="text-red-500">*</span></Label>
          <SingleSelect options={whOpts} value={whId} onChange={setWhId} placeholder="Chọn kho…" triggerClassName="w-full" />
        </div>
        {vehicle && (
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="h-3.5 w-3.5" />
            Đang dùng (bỏ tick = ngừng dùng, ẩn khỏi board — giữ lịch sử)
          </label>
        )}
      </div>
    </FormSheet>
  )
}

function ItemSection({ whOpts, warehouseId }: { whOpts: { value: string; label: string; sub?: string }[]; warehouseId: string }) {
  const { data: allItems = [], isLoading } = useForkliftItems({ includeInactive: true })
  // Lọc theo kho: hạng mục DÙNG CHUNG (null) luôn hiện vì áp cả kho đang lọc
  const items = warehouseId ? allItems.filter(it => !it.warehouse_id || it.warehouse_id === warehouseId) : allItems
  const del = useDeleteForkliftItem()
  const [editing, setEditing] = useState<ForkliftItem | null>(null)
  const [showForm, setShowForm] = useState(false)

  function handleDelete(it: ForkliftItem) {
    if (!confirm(`Xóa hạng mục "${it.label}"? (lịch sử đã check vẫn giữ nguyên nội dung)`)) return
    del.mutate(it.id, { onError: e => toast({ variant: 'destructive', title: 'Không xóa được', description: errMsg(e) }) })
  }

  return (
    <div>
      <div className="bg-slate-100 border-b border-l-2 border-l-sky-500 px-2 py-1 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase text-slate-600 flex-1">Hạng mục check list ({items.length}) — theo kho hoặc dùng chung</span>
        <ActionCluster items={[{
          key: 'add', icon: Plus, label: 'Thêm hạng mục', tip: 'Thêm nội dung kiểm tra mới',
          primary: true, variant: 'default', onClick: () => { setEditing(null); setShowForm(true) },
        } satisfies ActionItem]} />
      </div>
      {isLoading ? <div className="p-6 text-center text-sm text-slate-400">Đang tải…</div> : (
        <Table className="min-w-max [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
          <TableHeader>
            <TableRow>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap w-14 text-right">Thứ tự</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Nội dung kiểm tra</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Kho áp dụng</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(it => (
              <TableRow key={it.id} className={!it.is_active ? 'opacity-50' : ''}>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums text-slate-500">{it.sort_order}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap max-w-[420px] truncate" title={it.label}>{it.label}</TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  {it.warehouse_id
                    ? <span className="text-[10px] font-medium text-slate-700">{it.warehouse?.name ?? it.warehouse_id}</span>
                    : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">Dùng chung</span>}
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <Badge variant="outline" className={`text-[10px] ${it.is_active ? 'border-green-200 text-green-700' : 'border-slate-200 text-slate-400'}`}>
                    {it.is_active ? 'Đang dùng' : 'Tắt'}
                  </Badge>
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <div className="flex items-center gap-0.5">
                    <button className="text-slate-400 hover:text-blue-500 p-1" onClick={() => { setEditing(it); setShowForm(true) }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button className="text-slate-400 hover:text-red-500 p-1" disabled={del.isPending} onClick={() => handleDelete(it)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {showForm && <ItemSheet item={editing} whOpts={whOpts} defaultWarehouseId={warehouseId} onClose={() => setShowForm(false)} />}
    </div>
  )
}

const ITEM_SHARED = '__shared__'   // sentinel "Dùng chung mọi kho" (SingleSelect không hiện nhãn cho value '')

function ItemSheet({ item, whOpts, defaultWarehouseId, onClose }: {
  item: ForkliftItem | null
  whOpts: { value: string; label: string; sub?: string }[]
  defaultWarehouseId: string
  onClose: () => void
}) {
  const create = useCreateForkliftItem()
  const update = useUpdateForkliftItem()
  const [label, setLabel] = useState(item?.label ?? '')
  const [sortOrder, setSortOrder] = useState(String(item?.sort_order ?? 0))
  const [active, setActive] = useState(item?.is_active ?? true)
  // Thêm mới khi đang lọc 1 kho → mặc định gắn kho đó (đúng ngữ cảnh "cài đặt riêng kho")
  const [whId, setWhId] = useState(item ? (item.warehouse_id ?? ITEM_SHARED) : (defaultWarehouseId || ITEM_SHARED))
  const [error, setError] = useState('')
  const saving = create.isPending || update.isPending
  const whSelectOpts = [{ value: ITEM_SHARED, label: 'Dùng chung mọi kho' }, ...whOpts]

  function handleSave() {
    setError('')
    if (!label.trim()) { setError('Nội dung hạng mục bắt buộc'); return }
    const so = Number(sortOrder)
    const warehouse_id = whId === ITEM_SHARED ? null : whId
    const opts = {
      onSuccess: () => { toast({ title: item ? 'Đã cập nhật hạng mục' : 'Đã thêm hạng mục' }); onClose() },
      onError: (e: unknown) => setError(errMsg(e)),
    }
    if (item) update.mutate({ id: item.id, label: label.trim(), sort_order: Number.isFinite(so) ? so : 0, is_active: active, warehouse_id }, opts)
    else create.mutate({ label: label.trim(), sort_order: Number.isFinite(so) ? so : 0, warehouse_id }, opts)
  }

  return (
    <FormSheet open onClose={onClose}
      title={item ? 'Sửa hạng mục check list' : 'Thêm hạng mục check list'}
      footer={<>
        <Button variant="outline" onClick={onClose}>Hủy</Button>
        <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">{saving ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}>
      <div className="space-y-4">
        {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <div className="space-y-1">
          <Label className="text-xs">Nội dung kiểm tra <span className="text-red-500">*</span></Label>
          <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="vd Phanh (thắng) hoạt động tốt" className="h-9" maxLength={200} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Kho áp dụng</Label>
          <SingleSelect options={whSelectOpts} value={whId} onChange={setWhId} placeholder="Chọn kho…" triggerClassName="w-full" />
          <p className="text-[10px] text-slate-400">"Dùng chung mọi kho" = xe kho nào cũng check mục này; chọn 1 kho = chỉ xe kho đó</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Thứ tự hiển thị</Label>
          <Input inputMode="numeric" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="h-9 w-28 tabular-nums" />
        </div>
        {item && (
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="h-3.5 w-3.5" />
            Đang dùng (bỏ tick = không hiện trong check list mới — lịch sử giữ nguyên)
          </label>
        )}
      </div>
    </FormSheet>
  )
}
