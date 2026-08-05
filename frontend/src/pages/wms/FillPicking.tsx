// FILL HÀNG PHỤC VỤ NHẶT LẺ (user chốt 04/08) — 3 tab đúng thứ tự nghiệp vụ:
//   Đề xuất  : cần bao nhiêu (nhặt lẻ còn lại của NGÀY XUẤT) vs đang có ở VỊ TRÍ NHẶT LẺ ⇒ thiếu
//              bao nhiêu, hạ pallet nào (FEFO) → chọn dòng → "Ra lệnh fill" (gán người luôn được).
//   Lệnh fill: danh sách lệnh + gán người / đổi vị trí đích / hủy / QUÉT THỰC HIỆN.
//   Kết quả  : tỷ lệ hoàn thành theo NGƯỜI (số lệnh xong / được giao, SL đã hạ, thời gian TB).
//
// SỐ LƯỢNG: API trả BASE UNIT. Per-mã hiển thị "N thùng + M hộp" (qtyLabel). Tổng CROSS-MÃ phải
// quy đổi per-mã trước khi cộng và mang nhãn QTY_CONVERTED_LABEL — cộng base thô rồi ghi "thùng"
// là thổi tổng (luật BASE UNIT trong CLAUDE.md, cổng tĩnh 09 đang gác nhãn này).
import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownToLine, QrCode, Plus, X, Rows3, AlignJustify, UserPlus, MapPin, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
import { FillScanOverlay } from './FillScanOverlay'
import {
  useWarehouses, useFillDemand, useFillTasks, useFillReport, useFillEmployees,
  usePickFaceLocations, useCreateFillTasks, useUpdateFillTask, useCancelFillTask,
  type FillDemandRow, type FillTaskRow,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { qtyLabel, qtyEntryDecimal, QTY_CONVERTED_LABEL, QTY_CONVERTED_TIP } from '@/utils/qtyUnits'
import { formatDateTime, formatTimestampDate } from '@/utils/formatters'

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const nf = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })

const DEMAND_COLS = [
  { id: 'sel',     label: '',                 w: 36 },
  { id: 'code',    label: 'Mã hàng',          w: 110 },
  { id: 'name',    label: 'Tên hàng',         w: 220 },
  { id: 'demand',  label: 'Cần nhặt lẻ',      w: 150, align: 'right' as const },
  { id: 'onhand',  label: 'Đang có ở dưới',   w: 150, align: 'right' as const },
  { id: 'onway',   label: 'Đang có lệnh',     w: 140, align: 'right' as const },
  { id: 'short',   label: 'Thiếu',            w: 150, align: 'right' as const },
  { id: 'pallets', label: 'Pallet cần hạ',    w: 110, align: 'right' as const },
  { id: 'dest',    label: 'Đề xuất hạ về',    w: 140 },
]
const TASK_COLS = [
  { id: 'date',    label: 'Ngày xuất',   w: 90 },
  { id: 'status',  label: 'Trạng thái',  w: 100 },
  { id: 'code',    label: 'Mã hàng',     w: 110 },
  { id: 'name',    label: 'Tên hàng',    w: 200 },
  { id: 'pallet',  label: 'Tem pallet',  w: 190 },
  { id: 'qty',     label: 'SL trên pallet', w: 140, align: 'right' as const },
  { id: 'from',    label: 'Từ vị trí',   w: 130 },
  { id: 'to',      label: 'Về vị trí',   w: 130 },
  { id: 'cur',     label: 'Đang ở',      w: 130 },
  { id: 'who',     label: 'Giao cho',    w: 140 },
  { id: 'done',    label: 'Hoàn thành',  w: 150 },
  { id: 'actions', label: '',            w: 76 },
]
const REPORT_COLS = [
  { id: 'who',   label: 'Người thực hiện', w: 200 },
  { id: 'total', label: 'Được giao',       w: 100, align: 'right' as const },
  { id: 'done',  label: 'Đã xong',         w: 100, align: 'right' as const },
  { id: 'rate',  label: 'Tỷ lệ hoàn thành', w: 150 },
  { id: 'qty',   label: QTY_CONVERTED_LABEL, w: 130, align: 'right' as const },
  { id: 'avg',   label: 'TG trung bình',   w: 120, align: 'right' as const },
]

const STATUS_LABEL: Record<string, string> = { PENDING: 'Chờ làm', DONE: 'Đã hạ', CANCELLED: 'Đã hủy' }
const STATUS_BADGE: Record<string, string> = {
  PENDING:   'bg-amber-100 text-amber-700',
  DONE:      'bg-blue-100 text-blue-700',
  CANCELLED: 'bg-slate-200 text-slate-500',
}
const taskRowText = (t: FillTaskRow) =>
  t.status === 'DONE' ? 'text-[#4A90D9] line-through' : t.status === 'CANCELLED' ? 'text-slate-400' : ''

export default function FillPicking() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const navigate = useNavigate()
  const f = useWmsFilterStore(s => s.fill)
  const setFill = useWmsFilterStore(s => s.setFill)
  const setFillFilter = (p: Partial<typeof f>) => setFill({ ...p, page: 1 })

  const canPlan    = can(perms, 'fill', 'plan')
  const canAssign  = can(perms, 'fill', 'assign')
  const canExecute = can(perms, 'fill', 'execute')

  const [dense, setDense] = useState(() => localStorage.getItem('fill_density') !== 'comfortable')
  const toggleDensity = () =>
    setDense(d => { localStorage.setItem('fill_density', d ? 'comfortable' : 'compact'); return !d })

  const { data: warehouses = [] } = useWarehouses(true)
  const allowedWh = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids) : null
  const whList = warehouses.filter(w => !allowedWh || allowedWh.has(w.id))
  useEffect(() => {
    if (!f.warehouseId) {
      const def = user?.warehouse_ids?.[0] ?? user?.warehouse_id ?? ''
      if (def) setFill({ warehouseId: def })
    }
  }, [user?.warehouse_id])  // eslint-disable-line

  const whId = f.warehouseId
  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', value: whId, allLabel: 'Chọn kho', pinned: true,
      options: whList.map(w => ({ value: w.id, label: w.name })),
      onChange: v => setFillFilter({ warehouseId: v }) },
    ...(f.tab === 'demand' ? [
      { key: 'short', label: 'Chỉ mã đang thiếu', type: 'multi' as const, searchable: false,
        options: [{ value: 'y', label: 'Chỉ mã đang thiếu' }], selected: f.onlyShort ? ['y'] : [],
        onChange: (v: string[]) => setFillFilter({ onlyShort: v.includes('y') }) },
    ] : []),
    ...(f.tab === 'tasks' ? [
      { key: 'status', label: 'Trạng thái', type: 'multi' as const, searchable: false,
        options: [
          { value: 'PENDING', label: 'Chờ làm' },
          { value: 'DONE', label: 'Đã hạ' },
          { value: 'CANCELLED', label: 'Đã hủy' },
        ], selected: f.status,
        onChange: (v: string[]) => setFillFilter({ status: v }) },
      { key: 'mine', label: 'Việc của tôi', type: 'multi' as const, searchable: false,
        options: [{ value: 'y', label: 'Việc của tôi' }], selected: f.mine ? ['y'] : [],
        onChange: (v: string[]) => setFillFilter({ mine: v.includes('y') }) },
    ] : []),
    ...(f.tab === 'report' ? [
      { key: 'range', label: 'Khoảng ngày', type: 'daterange' as const,
        from: f.reportFrom, to: f.reportTo,
        onChange: (from: string, to: string) => setFillFilter({ reportFrom: from, reportTo: to }) },
    ] : []),
  ]

  const [scanOpen, setScanOpen] = useState(false)
  const [scanMounted, setScanMounted] = useState(false)

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 shrink-0 sm:rounded-t-xl space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 shrink-0">
              <ArrowDownToLine className="h-4 w-4 text-sky-600" /> Fill hàng
            </h1>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-medium shrink-0">
              <button className={`px-2.5 py-1 ${f.tab === 'demand' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                onClick={() => setFill({ tab: 'demand' })}>Đề xuất</button>
              <button className={`px-2.5 py-1 border-l border-slate-200 ${f.tab === 'tasks' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                onClick={() => setFill({ tab: 'tasks' })}>Lệnh fill</button>
              <button className={`px-2.5 py-1 border-l border-slate-200 ${f.tab === 'report' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                onClick={() => setFill({ tab: 'report' })}>Kết quả</button>
            </div>
            {/* NGÀY XUẤT là THAM SỐ của phép tính (RPC nhận đúng 1 ngày), không phải bộ lọc phụ →
                để ngay trên toolbar cho thấy rõ đang tính cho ngày nào, thay vì giấu trong chip lọc */}
            {f.tab === 'demand' && (
              <label className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] text-slate-500 hidden sm:inline">Ngày xuất</span>
                <input type="date" value={f.date} onChange={e => setFillFilter({ date: e.target.value || TODAY })}
                  className="h-9 sm:h-7 rounded border border-slate-200 px-1.5 text-[11px]" />
              </label>
            )}
            {f.tab === 'tasks' && (
              <SearchInput value={f.search} onChange={v => setFillFilter({ search: v })}
                placeholder="Tìm tem pallet, mã hàng, vị trí, người…" className="flex-1 min-w-[140px]" />
            )}
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
              <ActionCluster mobileInline items={[
                ...(canExecute && whId ? [{
                  key: 'scan', icon: QrCode, label: 'Quét thực hiện', primary: true,
                  tip: 'Quét tem pallet đang ở vị trí nguồn → app tự chuyển xuống vị trí nhặt lẻ',
                  onClick: () => { setScanMounted(true); setScanOpen(true) },
                } satisfies ActionItem] : []),
                {
                  key: 'loose', icon: Info, label: 'Nhặt lẻ',
                  tip: 'Mở trang Nhặt lẻ (nguồn của nhu cầu fill)',
                  onClick: () => navigate('/wms/loosepicking'),
                } satisfies ActionItem,
              ]} />
              <button onClick={toggleDensity} title={dense ? 'Dòng thoáng' : 'Dòng dày'}
                className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50">
                {dense ? <Rows3 className="h-3.5 w-3.5" /> : <AlignJustify className="h-3.5 w-3.5" />}
              </button>
              <span className="sm:hidden ml-auto"><FilterSheetButton defs={filterDefs} /></span>
            </div>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
        </div>

        {!whId ? (
          <div className="p-8 text-center text-sm text-slate-400">Chọn kho để xem đề xuất fill hàng</div>
        ) : f.tab === 'demand' ? (
          <DemandTab warehouseId={whId} date={f.date} onlyShort={f.onlyShort} dense={dense} canPlan={canPlan} canAssign={canAssign} />
        ) : f.tab === 'tasks' ? (
          <TasksTab warehouseId={whId} dense={dense} canPlan={canPlan} canAssign={canAssign} />
        ) : (
          <ReportTab warehouseId={whId} from={f.reportFrom} to={f.reportTo} dense={dense} />
        )}
      </div>

      {scanMounted && (
        <FillScanOverlay warehouseId={whId} open={scanOpen} canAssign={canAssign}
          onClose={() => setScanOpen(false)} />
      )}
    </div>
  )
}

// ─── TAB 1 — ĐỀ XUẤT ─────────────────────────────────────────────────────────
function DemandTab({ warehouseId, date, onlyShort, dense, canPlan, canAssign }: {
  warehouseId: string; date: string; onlyShort: boolean; dense: boolean; canPlan: boolean; canAssign: boolean
}) {
  const { widths: colW, startResize, totalWidth } = useColumnResize('fill_demand_col_widths', DEMAND_COLS.map(c => c.w))
  const { data, isLoading } = useFillDemand({ warehouse_id: warehouseId, date })
  const createTasks = useCreateFillTasks()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignee, setAssignee] = useState('')
  const [err, setErr] = useState('')
  const [result, setResult] = useState<{ created: number; skipped: { pallet_code?: string; reason: string }[] } | null>(null)

  useEffect(() => { setSel(new Set()) }, [warehouseId, date])

  const rows = useMemo(() => {
    const all = data?.rows ?? []
    return onlyShort ? all.filter(r => Number(r.short_base) > 0) : all
  }, [data, onlyShort])

  // Tổng CROSS-MÃ: quy đổi per-mã rồi mới cộng (nhãn "SL (quy đổi)")
  const tot = useMemo(() => {
    let demand = 0, short = 0, shortMats = 0, pallets = 0
    for (const r of rows) {
      demand += qtyEntryDecimal(Number(r.demand_base), r)
      if (Number(r.short_base) > 0) {
        shortMats++
        short += qtyEntryDecimal(Number(r.short_base), r)
        pallets += r.suggestions.length
      }
    }
    return { demand, short, shortMats, pallets }
  }, [rows])

  const selectable = rows.filter(r => Number(r.short_base) > 0 && r.suggestions.length > 0)
  const allSel = selectable.length > 0 && selectable.every(r => sel.has(r.material_id))

  async function raLenh() {
    setErr(''); setResult(null)
    const items = rows
      .filter(r => sel.has(r.material_id))
      .flatMap(r => r.suggestions.map(s => ({
        entry_id: s.entry_id,
        to_location_id: r.to_location?.id,
        assignee_id: assignee || undefined,
      })))
    if (!items.length) { setErr('Chưa chọn mã nào có pallet để hạ'); return }
    try {
      const res = await createTasks.mutateAsync({ warehouse_id: warehouseId, target_date: date, items })
      setResult(res)
      setSel(new Set())
      setAssignOpen(false)
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không ra lệnh được')
    }
  }

  return (
    <>
      <SummaryBand tiles={[
        { label: 'Mã có nhặt lẻ', value: nf(rows.length) },
        { label: 'Mã đang thiếu', value: nf(tot.shortMats), danger: tot.shortMats > 0 },
        { label: `CẦN — ${QTY_CONVERTED_LABEL}`, value: nf(tot.demand), tip: QTY_CONVERTED_TIP },
        { label: `THIẾU — ${QTY_CONVERTED_LABEL}`, value: nf(tot.short), tip: QTY_CONVERTED_TIP, danger: tot.short > 0 },
        { label: 'Pallet cần hạ', value: nf(tot.pallets), accent: tot.pallets > 0 },
      ]} />

      {data && data.pick_face_locations === 0 && (
        <div className="mx-3 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Kho này <b>chưa khai vị trí nhặt lẻ nào</b> nên mọi mã đều hiện "thiếu". Vào <b>Vị trí kho</b> → lọc các vị trí
          tầng dưới → nút <b>"Vị trí nhặt lẻ"</b> để khai hàng loạt, rồi quay lại đây.
        </div>
      )}

      {canPlan && (
        <div className="px-3 py-1.5 border-b bg-slate-50 flex items-center gap-2 flex-wrap shrink-0">
          <span className="text-[11px] text-slate-500">
            Đã chọn <b className="text-slate-700">{sel.size}</b> mã ·
            {' '}{nf(rows.filter(r => sel.has(r.material_id)).reduce((s, r) => s + r.suggestions.length, 0))} pallet sẽ ra lệnh
          </span>
          <Button size="sm" className="h-7 text-[11px] ml-auto" disabled={sel.size === 0 || createTasks.isPending}
            onClick={() => { setErr(''); setAssignOpen(true) }}>
            <Plus className="h-3.5 w-3.5 mr-1" />{createTasks.isPending ? 'Đang tạo…' : 'Ra lệnh fill'}
          </Button>
        </div>
      )}
      {err && <p className="mx-3 mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
      {result && (
        <div className="mx-3 mt-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-[11px] text-green-800">
          Đã tạo <b>{result.created}</b> lệnh fill.
          {result.skipped.length > 0 && (
            <div className="mt-1 text-amber-700">
              {result.skipped.length} pallet bị bỏ qua:
              <ul className="list-disc ml-4">
                {result.skipped.slice(0, 6).map((s, i) => <li key={i}>{s.pallet_code ?? s.reason} — {s.reason}</li>)}
                {result.skipped.length > 6 && <li>… và {result.skipped.length - 6} pallet khác</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <Table className={`table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden ${dense ? '' : '[&_td]:py-2.5'}`}
          style={{ width: totalWidth, minWidth: '100%' }}>
          <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <TableHeader>
            <TableRow>
              {DEMAND_COLS.map((c, i) => (
                <TableHead key={c.id}
                  className={`relative text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                  {c.id === 'sel' && canPlan ? (
                    <input type="checkbox" className="h-3 w-3 cursor-pointer" checked={allSel}
                      onChange={e => setSel(e.target.checked ? new Set(selectable.map(r => r.material_id)) : new Set())} />
                  ) : c.label}
                  <span onPointerDown={e => startResize(i, e)}
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={DEMAND_COLS.length} className="text-center py-8 text-xs text-slate-400">Đang tải…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={DEMAND_COLS.length} className="text-center py-8 text-xs text-slate-400">
                {onlyShort ? 'Không mã nào thiếu hàng ở vị trí nhặt lẻ — không cần fill' : 'Ngày này không có nhặt lẻ'}
              </TableCell></TableRow>
            ) : rows.map(r => {
              const short = Number(r.short_base)
              const picked = sel.has(r.material_id)
              return (
                <TableRow key={r.material_id} className={short > 0 ? 'text-[#D8891C]' : ''}>
                  <TableCell className={`px-2 py-1 sticky left-0 z-10 ${picked ? 'bg-sky-50' : 'bg-white'}`}>
                    {canPlan && short > 0 && r.suggestions.length > 0 && (
                      <input type="checkbox" className="h-3 w-3 cursor-pointer" checked={picked}
                        onChange={e => setSel(prev => {
                          const n = new Set(prev)
                          if (e.target.checked) n.add(r.material_id); else n.delete(r.material_id)
                          return n
                        })} />
                    )}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">{r.material_code ?? '—'}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={r.material_name ?? ''}>
                    {r.material_name ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right font-semibold tabular-nums">
                    {qtyLabel(Number(r.demand_base), r)}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">
                    {qtyLabel(Number(r.pick_face_base), r)}
                    <span className="text-slate-400"> · {r.pick_face_pallets} pl</span>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">
                    {Number(r.pending_base) > 0
                      ? <>{qtyLabel(Number(r.pending_base), r)}<span className="text-slate-400"> · {r.pending_n} lệnh</span></>
                      : <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap text-right font-semibold tabular-nums ${short > 0 ? 'text-red-600' : ''}`}>
                    {short > 0 ? qtyLabel(short, r) : <span className="text-slate-300">đủ</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right font-semibold tabular-nums">
                    {short > 0
                      ? (r.suggestions.length || <span className="text-red-600">hết hàng trên</span>)
                      : <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono">
                    {r.to_location?.code ?? (short > 0 ? <span className="text-red-600 font-sans">hết chỗ dưới</span> : <span className="text-slate-300">—</span>)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <div className="border-t px-3 py-1.5 text-[10px] text-slate-500 shrink-0">{rows.length} mã</div>

      {/* Ra lệnh: chọn người nhận (bỏ trống = để đó, ai cũng nhận được khi quét) */}
      <Dialog open={assignOpen} onOpenChange={o => !o && setAssignOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-1.5">
            <UserPlus className="h-4 w-4 text-sky-600" /> Giao lệnh fill cho ai?
          </DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-600">
              Sẽ tạo <b>{rows.filter(r => sel.has(r.material_id)).reduce((s, r) => s + r.suggestions.length, 0)}</b> lệnh
              (mỗi pallet 1 lệnh) cho ngày xuất <b>{date}</b>.
            </p>
            {canAssign ? (
              <AssigneePicker warehouseId={warehouseId} value={assignee} onChange={setAssignee} />
            ) : (
              <p className="text-[11px] text-slate-500">Bạn không có quyền gán người — lệnh sẽ để trống, ai quét thì người đó nhận.</p>
            )}
            {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setAssignOpen(false)} disabled={createTasks.isPending}>Hủy</Button>
            <Button size="sm" onClick={raLenh} disabled={createTasks.isPending}>
              {createTasks.isPending ? 'Đang tạo…' : 'Ra lệnh'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function AssigneePicker({ warehouseId, value, onChange }: {
  warehouseId: string; value: string; onChange: (v: string) => void
}) {
  const { data: emps = [] } = useFillEmployees(warehouseId)
  return (
    <div>
      <label className="text-[11px] text-slate-500">Giao cho</label>
      <SingleSelect
        value={value}
        onChange={onChange}
        options={[
          { value: '', label: '— Chưa giao ai (ai quét thì người đó nhận) —' },
          ...emps.map(e => ({ value: e.id, label: `${e.name}${e.job_title ? ` · ${e.job_title}` : ''}` })),
        ]}
        placeholder="Chọn nhân sự…"
      />
      {/* Kho chưa gán nhân sự nào thì ô chọn chỉ có 1 dòng — nói rõ VÌ SAO, đừng để người dùng
          tưởng tính năng hỏng (staging: 36/36 nhân sự đang ở Kho Ba Vì) */}
      {emps.length === 0 && (
        <p className="text-[10px] text-amber-700 mt-1">
          Kho này chưa có nhân sự nào được gán — lệnh sẽ để trống, ai quét thì người đó nhận.
        </p>
      )}
    </div>
  )
}

// ─── TAB 2 — LỆNH FILL ───────────────────────────────────────────────────────
function TasksTab({ warehouseId, dense, canPlan, canAssign }: {
  warehouseId: string; dense: boolean; canPlan: boolean; canAssign: boolean
}) {
  const f = useWmsFilterStore(s => s.fill)
  const setFill = useWmsFilterStore(s => s.setFill)
  const { widths: colW, startResize, totalWidth } = useColumnResize('fill_task_col_widths', TASK_COLS.map(c => c.w))
  const { data, isLoading } = useFillTasks({
    warehouse_id: warehouseId,
    status: f.status.join(','),
    mine: f.mine ? '1' : undefined,
    search: f.search || undefined,
    page: f.page, page_size: f.pageSize,
  })
  const updateTask = useUpdateFillTask()
  const cancelTask = useCancelFillTask()
  const [editing, setEditing] = useState<FillTaskRow | null>(null)
  const [mode, setMode] = useState<'assign' | 'dest'>('assign')
  const [val, setVal] = useState('')
  const [err, setErr] = useState('')

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / f.pageSize))

  function openEdit(t: FillTaskRow, m: 'assign' | 'dest') {
    setEditing(t); setMode(m); setErr('')
    setVal(m === 'assign' ? (t.assignee_id ?? '') : t.to_location_id)
  }
  async function save() {
    if (!editing) return
    setErr('')
    try {
      await updateTask.mutateAsync(mode === 'assign'
        ? { id: editing.id, assignee_id: val || null }
        : { id: editing.id, to_location_id: val })
      setEditing(null)
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không lưu được')
    }
  }
  async function doCancel(t: FillTaskRow) {
    try { await cancelTask.mutateAsync({ id: t.id }) } catch { /* lỗi hiện ở banner list */ }
  }

  return (
    <>
      <SummaryBand tiles={[
        { label: 'Chờ làm',  value: nf(data?.pending_n ?? 0), accent: (data?.pending_n ?? 0) > 0 },
        { label: 'Đã hạ',    value: nf(data?.done_n ?? 0) },
        { label: 'Đã hủy',   value: nf(data?.cancelled_n ?? 0) },
        { label: `ĐÃ HẠ — ${QTY_CONVERTED_LABEL}`, value: nf(data?.done_qty_entry ?? 0), tip: QTY_CONVERTED_TIP },
      ]} />

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <Table className={`table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden ${dense ? '' : '[&_td]:py-2.5'}`}
          style={{ width: totalWidth, minWidth: '100%' }}>
          <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <TableHeader>
            <TableRow>
              {TASK_COLS.map((c, i) => (
                <TableHead key={c.id}
                  className={`relative text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                  {c.label}
                  <span onPointerDown={e => startResize(i, e)}
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={TASK_COLS.length} className="text-center py-8 text-xs text-slate-400">Đang tải…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={TASK_COLS.length} className="text-center py-8 text-xs text-slate-400">Chưa có lệnh fill nào khớp bộ lọc</TableCell></TableRow>
            ) : rows.map(t => {
              const drift = t.status === 'PENDING' && t.cur_location_code && t.cur_location_code !== t.from_location_code
              return (
                <TableRow key={t.id} className={taskRowText(t)}>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap sticky left-0 z-10 bg-white">{formatTimestampDate(t.target_date, true)}</TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_BADGE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">{t.material_code ?? '—'}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={t.material_name ?? ''}>{t.material_name ?? '—'}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono truncate" title={t.pallet_code}>{t.pallet_code}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold">{qtyLabel(Number(t.qty_base), t)}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono">{t.from_location_code ?? '—'}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">{t.to_location_code ?? '—'}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono">
                    {t.cur_location_code
                      ? <span className={drift ? 'text-red-600 font-semibold' : ''} title={drift ? 'Pallet đã bị chuyển khỏi vị trí nguồn — quét sẽ báo lệch' : ''}>{t.cur_location_code}</span>
                      : <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={t.assignee_name ?? ''}>
                    {t.assignee_name ?? <span className="text-slate-300">chưa giao</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                    {t.done_at
                      ? <div className="leading-tight">
                          <div className="text-slate-600 truncate">{t.done_by_name ?? '—'}</div>
                          <div className="text-[9px] text-slate-400">{formatDateTime(t.done_at)}</div>
                        </div>
                      : <span className="text-slate-300">—</span>}
                  </TableCell>
                  {/* Nút trong CELL = icon nhỏ (table-format 17b) — ActionCluster có sàn touch-target
                      44px nên nhét vào ô sẽ ép DÒNG cao gấp ba, vỡ bảng dày/thoáng */}
                  <TableCell className="px-2 py-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    {t.status === 'PENDING' && (
                      <div className="flex items-center gap-0.5">
                        {canAssign && (
                          <button type="button" title="Giao lệnh này cho người khác" onClick={() => openEdit(t, 'assign')}
                            className="px-1.5 py-1 rounded text-slate-500 hover:bg-slate-100 hover:text-sky-600">
                            <UserPlus className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canPlan && (
                          <button type="button" title="Đổi vị trí nhặt lẻ sẽ hạ về (dùng khi đích đã đầy)" onClick={() => openEdit(t, 'dest')}
                            className="px-1.5 py-1 rounded text-slate-500 hover:bg-slate-100 hover:text-sky-600">
                            <MapPin className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canPlan && (
                          <button type="button" title="Hủy lệnh fill này" onClick={() => doCancel(t)}
                            className="px-1.5 py-1 rounded text-slate-400 hover:bg-red-50 hover:text-red-600">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <PagerNav page={f.page} totalPages={totalPages} onPage={p => setFill({ page: p })} />
      <ListFooter page={f.page} pageSize={f.pageSize} total={total} unit="lệnh"
        onPageSize={n => setFill({ pageSize: n, page: 1 })} />

      <Dialog open={editing !== null} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-1.5">
            {mode === 'assign'
              ? <><UserPlus className="h-4 w-4 text-sky-600" /> Giao lệnh fill</>
              : <><MapPin className="h-4 w-4 text-sky-600" /> Đổi vị trí hạ về</>}
          </DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-600">
              Pallet <span className="font-mono font-semibold">{editing?.pallet_code}</span>
              {' · '}{editing?.material_code}
            </p>
            {mode === 'assign'
              ? <AssigneePicker warehouseId={warehouseId} value={val} onChange={setVal} />
              : <DestPicker warehouseId={warehouseId} materialId={editing?.material_id} value={val} onChange={setVal} />}
            {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(null)} disabled={updateTask.isPending}>Hủy</Button>
            <Button size="sm" onClick={save} disabled={updateTask.isPending || (mode === 'dest' && !val)}>
              {updateTask.isPending ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DestPicker({ warehouseId, materialId, value, onChange }: {
  warehouseId: string; materialId?: string; value: string; onChange: (v: string) => void
}) {
  // materialId → BE chỉ trả vị trí NHẬN Loại kho của mã (đích khác loại lưu sẽ bị 400)
  const { data: locs = [] } = usePickFaceLocations(warehouseId, materialId)
  return (
    <div>
      <label className="text-[11px] text-slate-500">Vị trí nhặt lẻ đích</label>
      <SingleSelect
        value={value}
        onChange={onChange}
        options={locs.map(l => ({ value: l.id, label: `${l.location_code} (${l.max_pallets} pl)` }))}
        placeholder="Chọn vị trí nhặt lẻ…"
      />
    </div>
  )
}

// ─── TAB 3 — KẾT QUẢ ─────────────────────────────────────────────────────────
function ReportTab({ warehouseId, from, to, dense }: {
  warehouseId: string; from: string; to: string; dense: boolean
}) {
  const { widths: colW, startResize, totalWidth } = useColumnResize('fill_report_col_widths', REPORT_COLS.map(c => c.w))
  const { data, isLoading } = useFillReport({ warehouse_id: warehouseId, date_from: from, date_to: to })
  const rows = data?.rows ?? []
  const rate = data && data.total > 0 ? Math.round((data.done / data.total) * 1000) / 10 : 0

  return (
    <>
      <SummaryBand tiles={[
        { label: 'Tổng lệnh', value: nf(data?.total ?? 0) },
        { label: 'Đã xong',   value: nf(data?.done ?? 0) },
        { label: 'Tỷ lệ hoàn thành', value: `${nf(rate)}%`, danger: rate < 80, accent: rate >= 80 },
        { label: 'Chưa giao ai', value: nf(data?.unassigned ?? 0) },
        { label: `ĐÃ HẠ — ${QTY_CONVERTED_LABEL}`, value: nf(data?.qty_entry ?? 0), tip: QTY_CONVERTED_TIP },
      ]} />

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <Table className={`table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden ${dense ? '' : '[&_td]:py-2.5'}`}
          style={{ width: totalWidth, minWidth: '100%' }}>
          <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <TableHeader>
            <TableRow>
              {REPORT_COLS.map((c, i) => (
                <TableHead key={c.id}
                  className={`relative text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}
                  title={c.id === 'qty' ? QTY_CONVERTED_TIP : undefined}>
                  {c.label}
                  <span onPointerDown={e => startResize(i, e)}
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={REPORT_COLS.length} className="text-center py-8 text-xs text-slate-400">Đang tải…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={REPORT_COLS.length} className="text-center py-8 text-xs text-slate-400">Khoảng ngày này chưa có lệnh fill</TableCell></TableRow>
            ) : rows.map(r => (
              <TableRow key={r.assignee_id ?? '__none__'} className={r.rate >= 100 ? 'text-[#4A90D9]' : r.done_n > 0 ? 'text-[#D8891C]' : ''}>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate sticky left-0 z-10 bg-white font-medium" title={r.assignee_name}>
                  {r.assignee_name}
                </TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{nf(r.total_n)}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold">{nf(r.done_n)}</TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 flex-1 min-w-[40px] rounded-full bg-slate-200 overflow-hidden">
                      <div className={`h-full ${r.rate >= 80 ? 'bg-green-500' : r.rate >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, r.rate)}%` }} />
                    </div>
                    <span className="text-[10px] tabular-nums font-semibold shrink-0">{nf(r.rate)}%</span>
                  </div>
                </TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{nf(Number(r.done_qty_entry))}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">
                  {r.avg_minutes == null ? <span className="text-slate-300">—</span> : `${nf(r.avg_minutes)} phút`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="border-t px-3 py-1.5 text-[10px] text-slate-500 shrink-0">{rows.length} người</div>
    </>
  )
}
