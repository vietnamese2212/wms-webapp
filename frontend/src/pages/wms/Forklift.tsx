import { useEffect, useMemo, useState } from 'react'
import { Forklift as ForkliftIcon, ClipboardCheck, BarChart2, Settings2, Plus, Pencil, Trash2, CheckCircle2, XCircle, MoonStar, Eye } from 'lucide-react'
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
import { formatDate, formatTimestampTime } from '@/utils/formatters'
import {
  useForklifts, useCreateForklift, useUpdateForklift, useDeleteForklift,
  useForkliftItems, useCreateForkliftItem, useUpdateForkliftItem, useDeleteForkliftItem,
  useForkliftBoard, useSaveForkliftLog, useDeleteForkliftLog, useForkliftLog, useForkliftReport,
  type ForkliftVehicle, type ForkliftItem, type ForkliftBoardVehicle, type ForkliftChecklistResult,
  type ForkliftReportRow,
} from '@/api/hooks'

const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const fmtH = (n: number | null | undefined) =>
  n === null || n === undefined ? null : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 1 })

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

  const vehicles = useMemo(
    () => (board?.vehicles ?? []).filter(v => !f.warehouseId || v.warehouse_id === f.warehouseId),
    [board, f.warehouseId],
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
                  {canCheck && <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap w-20" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map(v => {
                  const badge = boardBadge(v)
                  return (
                    <TableRow key={v.id} className={`${canCheck ? 'cursor-pointer' : ''} ${rowText(boardKey(v))}`}
                      onClick={() => { if (canCheck) setChecking(v) }}>
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
                      {canCheck && (
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          <button className="text-sky-600 hover:text-sky-800 px-1.5 py-1 rounded text-[10px] font-medium inline-flex items-center gap-1"
                            onClick={e => { e.stopPropagation(); setChecking(v) }}>
                            <ClipboardCheck className="h-3.5 w-3.5" /> {v.log ? 'Sửa' : 'Check'}
                          </button>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
      </div>
      <div className="border-t px-3 py-1 text-[10px] text-slate-400 shrink-0">{vehicles.length} xe · ngày {formatDate(f.date)}</div>
      {checking && <CheckSheet vehicle={checking} date={f.date} onClose={() => setChecking(null)} />}
    </>
  )
}

// ─── FormSheet check list 1 xe / 1 ngày ───────────────────────────────────────

function CheckSheet({ vehicle, date, onClose }: { vehicle: ForkliftBoardVehicle; date: string; onClose: () => void }) {
  const { data: items = [] } = useForkliftItems()
  const save = useSaveForkliftLog()
  const [idle, setIdle] = useState(vehicle.log?.status === 'IDLE')
  const [meter, setMeter] = useState(vehicle.log?.hour_meter != null ? String(vehicle.log.hour_meter) : '')
  const [note, setNote] = useState(vehicle.log?.note ?? '')
  const [results, setResults] = useState<ForkliftChecklistResult[]>([])
  const [error, setError] = useState('')

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
      if (!meter.trim() || !Number.isFinite(m) || m < 0) { setError('Nhập số đồng hồ giờ (số ≥ 0) — xe nghỉ thì gạt "Xe nghỉ hôm nay"'); return }
    }
    save.mutate({
      forklift_id: vehicle.id,
      log_date: date,
      status: idle ? 'IDLE' : 'ACTIVE',
      hour_meter: idle ? null : Number(meter.replace(',', '.')),
      checklist: results,
      note: note.trim() || null,
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

        {/* Xe nghỉ hôm nay */}
        <button type="button" onClick={() => setIdle(v => !v)}
          className={`w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${idle ? 'border-slate-400 bg-slate-100 text-slate-700 font-medium' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
          <MoonStar className="h-4 w-4" />
          Xe nghỉ hôm nay (không vận hành)
          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${idle ? 'bg-slate-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{idle ? 'NGHỈ' : 'Chạy'}</span>
        </button>

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

        <div className="space-y-1">
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
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Ghi chú chung</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Ghi chú thêm (nếu có)…" className="h-9" />
        </div>
      </div>
    </FormSheet>
  )
}

// ─── Tab 2: Báo cáo vận hành ──────────────────────────────────────────────────

function ReportTab({ canCheck, whOpts, active }: { canCheck: boolean; whOpts: { value: string; label: string; sub?: string }[]; active: boolean }) {
  const f = useWmsFilterStore(s => s.forklift)
  const setF = useWmsFilterStore(s => s.setForklift)
  const { data, isLoading, error } = useForkliftReport({ from: f.from, to: f.to, warehouse_id: f.warehouseId || undefined }, active)
  const del = useDeleteForkliftLog()
  const [viewLogId, setViewLogId] = useState<string | null>(null)

  const rows = data?.rows ?? []
  const summary = data?.summary ?? []
  const totalHours = Math.round(summary.reduce((s, r) => s + r.total_hours, 0) * 10) / 10
  const tiles: BandTile[] = [
    { label: 'Xe có dữ liệu', value: summary.length },
    { label: 'Tổng giờ chạy', value: fmtH(totalHours) ?? 0, accent: true, tip: 'Tổng giờ đã chốt (hiệu số đồng hồ giữa 2 lần ghi liên tiếp)' },
    { label: 'Ngày chạy', value: summary.reduce((s, r) => s + r.active_days, 0) },
    { label: 'Ngày nghỉ', value: summary.reduce((s, r) => s + r.idle_days, 0) },
    { label: 'Chờ chốt', value: summary.reduce((s, r) => s + r.open_days, 0), tip: 'Lần ghi chưa có số kế tiếp — giờ chạy chốt khi có lần ghi sau' },
    { label: 'Hạng mục lỗi', value: summary.reduce((s, r) => s + r.issue_count, 0), danger: summary.some(r => r.issue_count > 0) },
  ]

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
          <div className="space-y-4 p-3">
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

function LogDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: log, isLoading } = useForkliftLog(id)
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Tab 3: Cài đặt (danh mục Xe nâng + Hạng mục check list) ─────────────────

function SettingsTab({ canVehicle, canItem, whOpts }: { canVehicle: boolean; canItem: boolean; whOpts: { value: string; label: string; sub?: string }[] }) {
  return (
    <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
      <div className="space-y-4 p-3">
        {canVehicle && <VehicleSection whOpts={whOpts} />}
        {canItem && <ItemSection />}
      </div>
    </div>
  )
}

function VehicleSection({ whOpts }: { whOpts: { value: string; label: string; sub?: string }[] }) {
  const { data: vehicles = [], isLoading } = useForklifts(true)
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

function ItemSection() {
  const { data: items = [], isLoading } = useForkliftItems(true)
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
        <span className="text-[10px] font-semibold uppercase text-slate-600 flex-1">Hạng mục check list ({items.length}) — áp chung mọi xe</span>
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
      {showForm && <ItemSheet item={editing} onClose={() => setShowForm(false)} />}
    </div>
  )
}

function ItemSheet({ item, onClose }: { item: ForkliftItem | null; onClose: () => void }) {
  const create = useCreateForkliftItem()
  const update = useUpdateForkliftItem()
  const [label, setLabel] = useState(item?.label ?? '')
  const [sortOrder, setSortOrder] = useState(String(item?.sort_order ?? 0))
  const [active, setActive] = useState(item?.is_active ?? true)
  const [error, setError] = useState('')
  const saving = create.isPending || update.isPending

  function handleSave() {
    setError('')
    if (!label.trim()) { setError('Nội dung hạng mục bắt buộc'); return }
    const so = Number(sortOrder)
    const opts = {
      onSuccess: () => { toast({ title: item ? 'Đã cập nhật hạng mục' : 'Đã thêm hạng mục' }); onClose() },
      onError: (e: unknown) => setError(errMsg(e)),
    }
    if (item) update.mutate({ id: item.id, label: label.trim(), sort_order: Number.isFinite(so) ? so : 0, is_active: active }, opts)
    else create.mutate({ label: label.trim(), sort_order: Number.isFinite(so) ? so : 0 }, opts)
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
