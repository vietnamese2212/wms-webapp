import { useEffect, useState, useRef, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toBlob } from 'html-to-image'
import { Plus, Wand2, Send, Trash2, CalendarDays, Pencil, Save, Layers, X, Loader2, Image as ImageIcon, Share2, Rows3, AlignJustify } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SavedViews } from '@/components/shared/SavedViews'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { EmptyState } from '@/components/shared/EmptyState'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { rowText, type RowStatusKey } from '@/lib/rowStatus'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import {
  useWarehouses,
  useSheets, useSheet, useUpsertSheet, useAutoAssign, useSetPositions, usePublishSheet, useDeleteSheet,
  useLayouts, useLayout, useCreateLayout, useUpdateLayout, useDeleteLayout, useSetLayoutSkills, useSetLayoutJobTitles, useSkills, useJobTitles,
  useShiftRules, useCreateShiftRule, useDeleteShiftRule,
  type SheetDetail, type LayoutRow,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate, formatDateTime, formatTimestampDate } from '@/utils/formatters'

const SHIFT_LABEL: Record<string, string> = { CA1: 'Ca 1', CA2: 'Ca 2', CA3: 'Ca 3', HC: 'HC' }
const shiftOf = (t: string | null) => (t ? SHIFT_LABEL[t] ?? t : '')
const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
// ngày VN + n ngày (mặc định filter "đến ngày")
const DATE_PLUS = (days: number) => { const d = new Date(`${TODAY()}T00:00:00+07:00`); d.setDate(d.getDate() + days); return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) }
const SCOPE_KEY = 'hr_assign_scope'

// nhãn "Vị trí phân công": {Chức danh}_{Ca}_{Vị trí}  →  "Lái xe nâng_HC_Pallet"
function positionLabel(jobTitle: string | null, skillName: string, shiftTag: string | null) {
  return [jobTitle, shiftOf(shiftTag), skillName].filter(Boolean).join('_')
}

// Ô số lượng: gõ tay được + nút tăng/giảm
function QtyCell({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const set = (v: number) => onChange(Math.max(0, Math.min(99, v)))
  return (
    <div className="inline-flex items-center gap-1">
      <button type="button" disabled={disabled || value <= 0} onClick={() => set(value - 1)} className="h-6 w-6 rounded border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-40 leading-none">−</button>
      <input type="number" min={0} max={99} value={value || ''} placeholder="0" disabled={disabled}
        onChange={e => set(Number(e.target.value) || 0)}
        className="w-12 h-6 text-center text-xs rounded border border-slate-200 focus:border-sky-500 outline-none disabled:bg-slate-50" />
      <button type="button" disabled={disabled} onClick={() => set(value + 1)} className="h-6 w-6 rounded border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-40 leading-none">+</button>
    </div>
  )
}

export default function Assignments() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canCreate = can(perms, 'work_assignment', 'create')

  const [tab, setTab] = useState<'daily' | 'layout' | 'rules'>('daily')

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b border-slate-200 px-3 py-2.5 sm:rounded-t-xl flex items-center gap-3">
          <h1 className="text-base font-semibold text-slate-800">Phân công lịch làm việc</h1>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
            <button onClick={() => setTab('daily')} className={`px-3 py-1.5 ${tab === 'daily' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Phân công</button>
            <button onClick={() => setTab('layout')} className={`px-3 py-1.5 border-l border-slate-200 ${tab === 'layout' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Layout</button>
            <button onClick={() => setTab('rules')} className={`px-3 py-1.5 border-l border-slate-200 ${tab === 'rules' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Quy tắc ca</button>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          {tab === 'daily' ? <DailyTab canCreate={canCreate} perms={perms} />
            : <div className="flex-1 min-h-0 overflow-auto">{tab === 'layout' ? <LayoutTab canCreate={canCreate} /> : <ShiftRulesTab canManage={canCreate} />}</div>}
        </div>
      </div>
    </div>
  )
}

// ════════ TAB QUY TẮC CA (nghỉ giữa ca — không hardcode) ════════
const RULE_SHIFTS = [{ v: 'CA1', l: 'Ca 1' }, { v: 'CA2', l: 'Ca 2' }, { v: 'CA3', l: 'Ca 3' }, { v: 'HC', l: 'Hành chính' }]
const ruleLabel = (v: string) => RULE_SHIFTS.find(s => s.v === v)?.l ?? v
function ShiftRulesTab({ canManage }: { canManage: boolean }) {
  const { data: rules = [], isLoading } = useShiftRules()
  const create = useCreateShiftRule()
  const del = useDeleteShiftRule()
  const [from, setFrom] = useState('CA3')
  const [to, setTo] = useState('CA1')
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    setErr(null)
    try { await create.mutateAsync({ from_shift: from, to_shift: to }) }
    catch (e) { setErr(String((e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? (e as { message?: string })?.message ?? e)) }
  }

  // gom theo from_shift để hiển thị "làm X → cấm Y, Z"
  const byFrom = new Map<string, typeof rules>()
  for (const r of rules) { const a = byFrom.get(r.from_shift) ?? []; a.push(r); byFrom.set(r.from_shift, a) }

  return (
    <div className="p-3 space-y-3 max-w-3xl">
      <p className="text-xs text-slate-500">Luật nghỉ giữa ca: làm <b>ca hôm trước</b> thì hôm sau <b>KHÔNG được</b> làm ca đã cấm (auto-xếp sẽ tránh). Sửa ở đây, không cần đụng code.</p>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 border border-slate-200 rounded-lg p-2 bg-slate-50/50">
          <span className="text-xs font-medium text-slate-600">Thêm luật: làm</span>
          <select value={from} onChange={e => setFrom(e.target.value)} className="border border-slate-200 rounded-md px-2 text-xs h-7 bg-white">{RULE_SHIFTS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
          <span className="text-xs text-slate-600">hôm trước → hôm sau KHÔNG được</span>
          <select value={to} onChange={e => setTo(e.target.value)} className="border border-slate-200 rounded-md px-2 text-xs h-7 bg-white">{RULE_SHIFTS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
          <Button size="sm" className="h-7" onClick={add} disabled={from === to || create.isPending}><Plus className="h-4 w-4 mr-1" />Thêm</Button>
        </div>
      )}
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
      {isLoading ? <p className="text-xs text-slate-400 py-6 text-center">Đang tải…</p>
      : rules.length === 0 ? <p className="text-xs text-slate-400 py-6 text-center">Chưa có luật nào — auto-xếp không ràng buộc ca.</p>
      : (
        <div className="space-y-2">
          {[...byFrom.entries()].map(([f, rs]) => (
            <div key={f} className="border border-slate-200 rounded-lg p-2">
              <div className="text-xs"><span className="text-slate-500">Làm</span> <b className="text-slate-700">{ruleLabel(f)}</b> <span className="text-slate-500">hôm trước → hôm sau không được:</span></div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {rs.map(r => (
                  <span key={r.id} className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded px-2 py-0.5">
                    {ruleLabel(r.to_shift)}
                    {canManage && <button onClick={() => del.mutate(r.id)} className="text-red-400 hover:text-red-700"><X className="h-3 w-3" /></button>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ════════ TAB PHÂN CÔNG (danh sách phiếu → chi tiết) ════════
const SHEET_COLS: { id: string; label: string; w: number; align?: 'right' }[] = [
  { id: 'date',    label: 'Ngày',       w: 116 },
  { id: 'wh',      label: 'Kho',        w: 130 },
  { id: 'layout',  label: 'Layout',     w: 180 },
  { id: 'leave',   label: 'Nghỉ phép',  w: 78, align: 'right' },
  { id: 'req',     label: 'Yêu cầu',    w: 78, align: 'right' },
  { id: 'got',     label: 'Đáp ứng',    w: 78, align: 'right' },
  { id: 'diff',    label: 'Chênh lệch', w: 90, align: 'right' },
  { id: 'status',  label: 'Trạng thái', w: 104 },
  { id: 'created', label: 'Tạo',        w: 116 },
  { id: 'updated', label: 'Sửa',        w: 116 },
]
const SHEET_COL_DEFAULTS = SHEET_COLS.map(c => c.w)
const sheetKey = (status: 'DRAFT' | 'PUBLISHED'): RowStatusKey => status === 'PUBLISHED' ? 'full' : 'pending'

function DailyTab({ canCreate, perms }: { canCreate: boolean; perms: ModulePermissions | null }) {
  const { data: warehouses = [] } = useWarehouses(true)
  const { assignment: af, setAssignment } = useWmsFilterStore()
  const { search, warehouseId, layoutId, dateFrom } = af
  const [dateTo, setDateTo] = useState<string>(DATE_PLUS(15))   // luôn mặc định +15, không nhớ giá trị cũ
  const [sel, setSel] = useState<string | null>(null)
  const [openCreate, setOpenCreate] = useState(false)
  const { widths: colW, startResize, totalWidth } = useColumnResize('assignment_col_widths', SHEET_COL_DEFAULTS)
  const [dense, setDense] = useState(() => localStorage.getItem('assignment_density') !== 'comfortable')
  const toggleDensity = () => setDense(d => { localStorage.setItem('assignment_density', d ? 'comfortable' : 'compact'); return !d })

  const { data: layouts = [] } = useLayouts(warehouseId || undefined)
  useEffect(() => { if (layoutId && !layouts.some(l => l.id === layoutId)) setAssignment({ layoutId: '' }) }, [layouts, layoutId, setAssignment])

  const { data: sheets = [], isLoading } = useSheets({ warehouse_id: warehouseId || undefined, layout_id: layoutId || undefined, date_from: dateFrom, date_to: dateTo }, true)

  const filtered = sheets.filter(s => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (s.layout_name ?? '').toLowerCase().includes(q) || (s.warehouse_name ?? '').toLowerCase().includes(q)
  })
  const published = filtered.filter(s => s.status === 'PUBLISHED').length
  const totalLeave = filtered.reduce((n, s) => n + (s.total_on_leave || 0), 0)

  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', allLabel: 'Tất cả kho',
      options: (warehouses as { id: string; name: string }[]).map(w => ({ value: w.id, label: w.name })),
      value: warehouseId, onChange: v => setAssignment({ warehouseId: v, layoutId: '' }) },
    { key: 'layout', label: 'Layout', type: 'single', allLabel: 'Tất cả layout',
      options: layouts.map(l => ({ value: l.id, label: l.name })),
      value: layoutId, onChange: v => setAssignment({ layoutId: v }) },
    { key: 'date', label: 'Ngày', type: 'daterange', from: dateFrom, to: dateTo,
      onChange: (f, t) => { setAssignment({ dateFrom: f }); setDateTo(t) } },
  ]

  const viewSnapshot = { search, warehouseId, layoutId, dateFrom }
  const savedViews = useSavedViewsStore(s => s.views['assignment'] ?? [])
  const activeViewId = useMemo(() => {
    const cur = JSON.stringify(viewSnapshot)
    return savedViews.find(v => JSON.stringify(v.filters) === cur)?.id ?? null
  }, [savedViews, viewSnapshot])

  if (sel) return <div className="flex-1 min-h-0 overflow-auto"><SheetPanel sheetId={sel} warehouses={warehouses as { id: string; name: string }[]} perms={perms} onBack={() => setSel(null)} /></div>

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <SearchInput value={search} onChange={v => setAssignment({ search: v })} placeholder="Tìm kho, layout..." className="flex-1 min-w-[140px]" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          <SavedViews module="assignment" currentFilters={viewSnapshot} activeId={activeViewId} onApply={f => setAssignment(f as Partial<typeof af>)} />
          <button type="button" onClick={toggleDensity}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
          {canCreate && <Button size="sm" className="h-7" onClick={() => setOpenCreate(true)}><Plus className="h-4 w-4 mr-1" />Tạo phiếu</Button>}
        </div>
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap"><FilterBar defs={filterDefs} /></div>
      </div>

      <SummaryBand tiles={[
        { label: 'Tổng phiếu', value: filtered.length },
        { label: 'Đã phát hành', value: published },
        { label: 'Nháp', value: filtered.length - published },
        { label: 'Tổng nghỉ phép', value: totalLeave, accent: totalLeave > 0 },
      ]} />

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? <div className="p-4"><TableSkeleton rows={6} cols={6} /></div>
        : filtered.length === 0 ? <EmptyState icon={CalendarDays} title="Chưa có phiếu nào — bấm 'Tạo phiếu'" />
        : (
          <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {SHEET_COLS.map((c, i) => (
                  <TableHead key={c.id} className={`relative px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${c.id === 'date' ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    {c.label}
                    {i > 0 && <span onPointerDown={e => startResize(i, e)} onClick={e => e.stopPropagation()} className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" title="Kéo để chỉnh độ rộng cột" />}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(s => {
                const diff = s.total_assigned - s.total_required
                return (
                  <TableRow key={s.id} onClick={() => setSel(s.id)} className={`cursor-pointer ${rowText(sheetKey(s.status))} ${dense ? '' : '[&_td]:py-2.5'}`}>
                    <TableCell className="px-2 py-1 text-[10px] font-semibold tabular-nums whitespace-nowrap sticky left-0 z-10 bg-white">{formatDate(s.work_date)}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate">{s.warehouse_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate">{s.layout_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums whitespace-nowrap">{s.total_on_leave || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums whitespace-nowrap">{s.total_required}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums whitespace-nowrap">{s.total_assigned}</TableCell>
                    <TableCell className={`px-2 py-1 text-[10px] text-right tabular-nums font-semibold whitespace-nowrap ${diff < 0 ? 'text-red-600' : ''}`}>{diff > 0 ? `+${diff}` : diff}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap"><span className={`text-[9px] px-1.5 py-0.5 rounded-full ${s.status === 'PUBLISHED' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>{s.status === 'PUBLISHED' ? 'Đã phát hành' : 'Nháp'}</span></TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">{s.created_at ? <div className="leading-tight"><div className="text-[10px]">{s.created_by ?? <span className="text-slate-300">—</span>}</div><div className="text-[9px] text-slate-400">{formatTimestampDate(s.created_at, true)}</div></div> : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">{s.updated_at ? <div className="leading-tight"><div className="text-[10px]">{s.updated_by ?? <span className="text-slate-300">—</span>}</div><div className="text-[9px] text-slate-400">{formatTimestampDate(s.updated_at, true)}</div></div> : <span className="text-slate-300">—</span>}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500">
        {filtered.length > 0 ? `1–${filtered.length} / ${filtered.length} phiếu` : '0 phiếu'}
      </div>

      {openCreate && <CreateSheetDialog warehouses={warehouses as { id: string; name: string; code?: string }[]} defaultWh={warehouseId} onClose={() => setOpenCreate(false)} onCreated={id => { setOpenCreate(false); setSel(id) }} />}
    </div>
  )
}

// ─── Dialog tạo phiếu mới (Kho → Layout → Ngày); trùng ngày+layout → chặn + cảnh báo ───
function CreateSheetDialog({ warehouses, defaultWh, onClose, onCreated }: {
  warehouses: { id: string; name: string; code?: string }[]; defaultWh: string; onClose: () => void; onCreated: (id: string) => void
}) {
  const [wh, setWh] = useState(defaultWh)
  const [layoutId, setLayoutId] = useState('')
  const [date, setDate] = useState(TODAY())
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { data: layouts = [] } = useLayouts(wh || undefined)
  const upsert = useUpsertSheet()
  useEffect(() => { if (layoutId && !layouts.some(l => l.id === layoutId)) setLayoutId('') }, [layouts, layoutId])

  async function submit() {
    if (!wh || !layoutId || !date) { setErr('Chọn đủ Kho, Layout và Ngày'); return }
    setErr(null); setSaving(true)
    try {
      const r = await upsert.mutateAsync({ layout_id: layoutId, work_date: date, create_only: true })
      onCreated(r.id)
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? (e as { message?: string })?.message ?? String(e)
      setErr(msg)
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Tạo phiếu phân công</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Kho</label>
            <WarehouseSingleSelect warehouses={warehouses} value={wh} onChange={v => { setWh(v); setLayoutId('') }} allLabel="Chọn kho" placeholder="Chọn kho" triggerClassName="w-full" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Layout</label>
            <select value={layoutId} onChange={e => setLayoutId(e.target.value)} disabled={!wh} className="w-full border border-slate-200 rounded-md px-2.5 text-xs h-9 bg-white text-slate-700 disabled:opacity-50">
              <option value="">{wh ? 'Chọn layout…' : 'Chọn kho trước'}</option>
              {layouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Ngày</label>
            <Input type="date" min={TODAY()} value={date} onChange={e => setDate(e.target.value)} className="h-9 text-xs" />
          </div>
          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">⚠ {err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" className="h-8" onClick={onClose}>Hủy</Button>
            <Button size="sm" className="h-8" onClick={submit} disabled={!wh || !layoutId || saving}>{saving ? 'Đang tạo…' : 'Tạo phiếu'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Chi tiết 1 phiếu: bước Yêu cầu nhân lực → Kết quả phân công ─────────────
function SheetPanel({ sheetId, warehouses, perms, onBack }: { sheetId: string; warehouses: { id: string; name: string }[]; perms: ModulePermissions | null; onBack: () => void }) {
  const { data: sheet, refetch } = useSheet(sheetId)
  const qc = useQueryClient()
  const canCreate  = can(perms, 'work_assignment', 'create')
  const canEdit    = can(perms, 'work_assignment', 'edit')
  const canPublish = can(perms, 'work_assignment', 'publish')
  const canDelete  = can(perms, 'work_assignment', 'delete')

  const upsert = useUpsertSheet()
  const setLayoutSkills = useSetLayoutSkills()
  const auto   = useAutoAssign()
  const setPositions = useSetPositions()
  const publish = usePublishSheet()
  const del = useDeleteSheet()
  const [err, setErr] = useState<string | null>(null)
  const [step, setStep] = useState<'demand' | 'result'>('demand')
  const [assigning, setAssigning] = useState(false)
  const [showImg, setShowImg] = useState(false)   // xem lịch (ảnh) để chụp/tải gửi
  const currentUserId = useAuthStore(s => s.user?.id ?? null)   // để gạch chân tên người đang đăng nhập
  const [demands, setDemands] = useState<Record<string, number>>({})
  const [demandNotes, setDemandNotes] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!sheet) return
    const d: Record<string, number> = {}, n: Record<string, string> = {}
    for (const dm of sheet.demands) { d[dm.skill_id] = dm.required_count; if (dm.note) n[dm.skill_id] = dm.note }
    setDemands(d); setDemandNotes(n)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet?.id, sheet?.demands])

  if (!sheet) return <div className="p-3 space-y-2"><Button size="sm" variant="ghost" className="h-7" onClick={onBack}>← Danh sách</Button><p className="text-xs text-slate-400 py-8 text-center">Đang tải phiếu…</p></div>

  const published = sheet.status === 'PUBLISHED'
  const locked = published   // đã phát hành → khóa sửa/tự xếp; phải Hoàn tác mới sửa
  const skillById = new Map(sheet.skills.map(s => [s.id, s]))
  const labelOf = (id: string | null) => { const s = id ? skillById.get(id) : null; return s ? positionLabel(s.job_title, s.name, s.shift_tag) : '— Chưa phân —' }
  const whName = warehouses.find(w => w.id === sheet.warehouse_id)?.name ?? ''
  const noteBySkill = new Map(sheet.demands.map(d => [d.skill_id, d.note]))
  const shiftBySkill = new Map(sheet.skills.map(s => [s.id, s.shift_tag]))
  const assignedBySkill = new Map<string, number>()
  for (const a of sheet.assignments) if (a.status === 'ASSIGNED' && a.skill_id) assignedBySkill.set(a.skill_id, (assignedBySkill.get(a.skill_id) ?? 0) + 1)
  const totalRequired = Object.values(demands).reduce((a, b) => a + (b || 0), 0)
  const totalAssigned = sheet.assignments.filter(a => a.status === 'ASSIGNED').length
  const hasResult = sheet.assignments.length > 0
  const demandList = () => Object.entries(demands).filter(([, n]) => n > 0).map(([skill_id, required_count]) => ({ skill_id, required_count, note: demandNotes[skill_id] || undefined }))

  async function saveLayout() {
    setErr(null)
    try {
      const list = demandList()
      // 2 thao tác độc lập → chạy song song cho nhanh
      await Promise.all([
        upsert.mutateAsync({ layout_id: sheet!.layout_id!, work_date: sheet!.work_date, demands: list }),
        setLayoutSkills.mutateAsync({ layout_id: sheet!.layout_id!, skills: list.map((d, i) => ({ skill_id: d.skill_id, required_count: d.required_count, sort_order: i, note: d.note })) }),
      ])
    } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }
  async function runAuto() {
    if (locked) return   // đã phát hành → không cho tự xếp (phải Hoàn tác)
    setErr(null); setAssigning(true)
    try {
      // gộp lưu yêu cầu + tự xếp trong 1 request
      await auto.mutateAsync({ sheetId: sheet!.id, demands: demandList() })
      await refetch()   // chờ tải lại kết quả trước khi chuyển bước (tránh hiện "chưa có kết quả")
      setStep('result')
    } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
    finally { setAssigning(false) }
  }
  async function changePositions(employee_id: string, skill_ids: string[]) {
    if (locked) return
    setErr(null)
    // Cập nhật cache NGAY (optimistic) → chips đổi tức thì, không chờ mạng
    const emp = sheet!.assignments.find(a => a.employee_id === employee_id)?.employee ?? null
    qc.setQueryData<SheetDetail>(['hr-sheet', sheetId], old => {
      if (!old) return old
      const others = old.assignments.filter(a => a.employee_id !== employee_id)
      const rows = skill_ids.length
        ? skill_ids.map(sk => ({ id: `tmp-${employee_id}-${sk}`, employee_id, skill_id: sk, status: 'ASSIGNED' as const, is_manual: true, note: null, employee: emp }))
        : [{ id: `tmp-un-${employee_id}`, employee_id, skill_id: null, status: 'UNASSIGNED' as const, is_manual: true, note: null, employee: emp }]
      return { ...old, assignments: [...others, ...rows] }
    })
    try { await setPositions.mutateAsync({ sheet_id: sheet!.id, employee_id, skill_ids }) }
    catch (e) { setErr(String((e as { message?: string })?.message ?? e)); refetch() }
  }
  async function onDelete() {
    if (!confirm('Xóa phiếu phân công này?')) return
    try { await del.mutateAsync(sheet!.id); onBack() } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }
  // Phát hành (nếu chưa) rồi mở lịch — không cho xem lịch khi chưa phát hành
  async function publishAndView() {
    setErr(null)
    try { if (!published) await publish.mutateAsync({ id: sheet!.id, publish: true }); setShowImg(true) }
    catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  // thứ tự vị trí: ca (CA1<CA2<CA3) trên cùng, rồi HC, rồi khác — trong cùng nhóm theo sort_order
  const SHIFT_RANK: Record<string, number> = { CA1: 0, CA2: 1, CA3: 2, HC: 3 }
  const order = new Map(sheet.skills.map((s, i) => [s.id, (SHIFT_RANK[s.shift_tag ?? ''] ?? 4) * 1000 + i]))
  // cho LỊCH (Xem lịch): mỗi vị trí = 1 dòng (người 2 vị trí → 2 dòng)
  const rank = (a: SheetDetail['assignments'][number]) => a.status === 'ASSIGNED' ? (order.get(a.skill_id ?? '') ?? 99999) : a.status === 'UNASSIGNED' ? 100000 : 200000
  const sortedAsg = [...sheet.assignments].sort((x, y) => rank(x) - rank(y) || (x.employee?.name ?? '').localeCompare(y.employee?.name ?? ''))
  const posCount = new Map<string, number>()   // số vị trí ASSIGNED của mỗi người → ★ nếu ≥2
  for (const a of sheet.assignments) if (a.status === 'ASSIGNED' && a.skill_id) posCount.set(a.employee_id, (posCount.get(a.employee_id) ?? 0) + 1)

  // gom theo NGƯỜI (1 người có thể nhiều vị trí) — dùng cho bảng Kết quả (sửa tay)
  const empMap = new Map<string, EmpRow>()
  for (const a of sheet.assignments) {
    let g = empMap.get(a.employee_id)
    if (!g) { g = { eid: a.employee_id, employee: a.employee, positions: [], leave: false, manual: false }; empMap.set(a.employee_id, g) }
    if (a.status === 'LEAVE') g.leave = true
    else if (a.status === 'ASSIGNED' && a.skill_id) { g.positions.push(a.skill_id); if (a.is_manual) g.manual = true }
  }
  for (const g of empMap.values()) g.positions.sort((x, y) => (order.get(x) ?? 99999) - (order.get(y) ?? 99999))
  const empFirst = (g: EmpRow) => g.leave ? 300000 : g.positions.length ? Math.min(...g.positions.map(s => order.get(s) ?? 99999)) : 200000
  const empRows = [...empMap.values()].sort((a, b) => empFirst(a) - empFirst(b) || (a.employee?.name ?? '').localeCompare(b.employee?.name ?? ''))

  return (
    <div className="p-3 space-y-3 max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" className="h-7" onClick={onBack}>← Danh sách</Button>
        <Badge variant={published ? 'success' : 'warning'}>{published ? 'Đã phát hành' : 'Nháp'}</Badge>
        <span className="text-sm font-medium text-slate-700">{sheet.layout_name}</span>
        <span className="text-xs text-slate-500">· {formatDate(sheet.work_date)} · {whName} · Yêu cầu <b className="text-slate-700">{totalRequired}</b> · Đã xếp <b className="text-slate-700">{totalAssigned}</b></span>
        <div className="flex-1" />
        {canDelete && <Button size="sm" variant="outline" className="h-7 text-red-600" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
      {assigning && <div className="text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded px-3 py-2 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Đang tự xếp người… có thể mất vài giây, vui lòng đợi.</div>}
      {locked && <div className="text-xs text-slate-600 bg-slate-100 border border-slate-200 rounded px-3 py-2">🔒 Phiếu đã phát hành — đã khóa. Bấm <b>Hoàn tác</b> ở "Kết quả phân công" để chỉnh sửa / xếp lại.</div>}
      {(sheet.created_by || sheet.updated_by) && (
        <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-3">
          {sheet.created_by && <span>Tạo: <b className="text-slate-500">{sheet.created_by}</b>{sheet.created_at && ` · ${formatDateTime(sheet.created_at)}`}</span>}
          {sheet.updated_by && <span>Sửa: <b className="text-slate-500">{sheet.updated_by}</b>{sheet.updated_at && ` · ${formatDateTime(sheet.updated_at)}`}</span>}
        </div>
      )}

      {/* Điều hướng bước */}
      <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium w-fit">
        <button onClick={() => setStep('demand')} className={`px-3 py-1.5 ${step === 'demand' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>1. Yêu cầu nhân lực</button>
        <button onClick={() => hasResult && setStep('result')} disabled={!hasResult} className={`px-3 py-1.5 border-l border-slate-200 ${step === 'result' ? 'bg-sky-600 text-white' : hasResult ? 'text-slate-600 hover:bg-slate-50' : 'text-slate-300'}`}>2. Kết quả phân công</button>
      </div>

      {step === 'demand' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1" />
            {canCreate && <Button size="sm" variant="outline" className="h-7" onClick={saveLayout} disabled={locked || upsert.isPending || setLayoutSkills.isPending}><Save className="h-3.5 w-3.5 mr-1" />Lưu layout</Button>}
            {canCreate && <Button size="sm" className="h-7" onClick={runAuto} disabled={locked || assigning || totalRequired === 0}>{assigning ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}{assigning ? 'Đang xếp…' : 'Tự xếp người'}</Button>}
            {hasResult && <Button size="sm" variant="outline" className="h-7" onClick={() => setStep('result')}>Kết quả →</Button>}
          </div>
          {/* Dải tổng hợp */}
          <div className="flex flex-wrap gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"><span className="text-slate-500">Tổng yêu cầu</span> <b className="text-slate-700 tabular-nums">{totalRequired}</b></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"><span className="text-slate-500">Tổng đáp ứng</span> <b className="text-slate-700 tabular-nums">{hasResult ? totalAssigned : '—'}</b></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"><span className="text-slate-500">Tổng chênh lệch</span> <b className={`tabular-nums ${hasResult ? (totalAssigned - totalRequired < 0 ? 'text-red-600' : 'text-green-600') : 'text-slate-400'}`}>{hasResult ? (totalAssigned - totalRequired > 0 ? `+${totalAssigned - totalRequired}` : totalAssigned - totalRequired) : '—'}</b></div>
          </div>
          {sheet.skills.length === 0 ? (
            <p className="text-xs text-slate-400 p-3 border border-slate-200 rounded-lg">Layout chưa có vị trí nào.</p>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-xs min-w-max">
                <thead className="bg-slate-50 text-[10px] text-slate-500">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium">Vị trí</th>
                    <th className="text-left px-2 py-1.5 font-medium">Chức danh</th>
                    <th className="text-left px-2 py-1.5 font-medium w-36">Số lượng</th>
                    <th className="text-right px-2 py-1.5 font-medium">Đáp ứng</th>
                    <th className="text-right px-2 py-1.5 font-medium">Thiếu</th>
                    <th className="text-left px-2 py-1.5 font-medium">Ghi chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sheet.skills.map(s => {
                    const req = demands[s.id] ?? 0
                    const got = assignedBySkill.get(s.id) ?? 0
                    const short = Math.max(0, req - got)
                    return (
                      <tr key={s.id} className="hover:bg-slate-50/60">
                        <td className="px-2 py-1 text-slate-700">{s.name}{s.shift_tag && <span className="text-[10px] text-slate-400 ml-1">{shiftOf(s.shift_tag)}</span>}</td>
                        <td className="px-2 py-1 text-slate-500">{s.job_title ?? '—'}</td>
                        <td className="px-2 py-1"><QtyCell value={req} disabled={!canCreate || locked} onChange={v => setDemands(prev => ({ ...prev, [s.id]: v }))} /></td>
                        <td className="px-2 py-1 text-right tabular-nums">{hasResult ? got : '—'}</td>
                        <td className={`px-2 py-1 text-right tabular-nums font-semibold ${hasResult && short > 0 ? 'text-red-600' : 'text-slate-400'}`}>{hasResult ? (short || '—') : '—'}</td>
                        <td className="px-2 py-1"><Input value={demandNotes[s.id] ?? ''} disabled={!canCreate || locked} onChange={e => setDemandNotes(prev => ({ ...prev, [s.id]: e.target.value }))} placeholder="—" className="h-6 text-xs" /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setStep('demand')}>← Yêu cầu nhân lực</Button>
            <div className="flex-1" />
            {canPublish && !published && hasResult && <Button size="sm" className="h-7" onClick={publishAndView} disabled={publish.isPending}><Send className="h-3.5 w-3.5 mr-1" />Phát hành & Xem lịch</Button>}
            {published && hasResult && <Button size="sm" variant="outline" className="h-7" onClick={() => setShowImg(true)}><ImageIcon className="h-3.5 w-3.5 mr-1" />Xem lịch</Button>}
            {canPublish && published && <Button size="sm" variant="outline" className="h-7" onClick={() => publish.mutate({ id: sheet.id, publish: false })} disabled={publish.isPending}>↩ Hoàn tác (sửa lại)</Button>}
          </div>
          {!hasResult ? (
            <p className="text-xs text-slate-400 p-3 border border-slate-200 rounded-lg">Chưa có kết quả — quay lại bước 1 và bấm "Tự xếp người".</p>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-xs min-w-max">
                <thead className="bg-slate-50 text-[10px] text-slate-500">
                  <tr>
                    <th className="text-left px-2 py-2 font-medium w-10">STT</th>
                    <th className="text-left px-2 py-2 font-medium">Họ và tên</th>
                    <th className="text-left px-2 py-2 font-medium">Chức danh</th>
                    <th className="text-left px-2 py-2 font-medium">Vị trí phân công</th>
                    <th className="text-left px-2 py-2 font-medium">Ghi chú</th>
                    <th className="text-left px-2 py-2 font-medium w-24">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {empRows.map((g, i) => (
                    <tr key={g.eid} className={g.leave ? 'text-red-600' : !g.positions.length ? 'text-slate-400' : ''}>
                      <td className="px-2 py-1.5 tabular-nums align-top">{i + 1}</td>
                      <td className="px-2 py-1.5 font-medium align-top">{g.employee?.name ?? '—'}<span className="text-[10px] text-slate-400 ml-1">{g.employee?.employee_code}</span></td>
                      <td className="px-2 py-1.5 align-top">{g.employee?.job_title ?? '—'}</td>
                      <td className="px-2 py-1.5 align-top">
                        {g.leave ? <span className="italic">Nghỉ phép</span>
                          : canEdit && !locked ? (
                            <div className="flex flex-wrap items-center gap-1">
                              {g.positions.map(s => (
                                <span key={s} className="inline-flex items-center gap-1 text-[11px] bg-sky-50 text-sky-700 border border-sky-200 rounded px-1.5 py-0.5">
                                  {labelOf(s)}
                                  <button onClick={() => changePositions(g.eid, g.positions.filter(x => x !== s))} className="text-sky-400 hover:text-sky-700"><X className="h-3 w-3" /></button>
                                </span>
                              ))}
                              <select value="" onChange={e => { if (e.target.value) changePositions(g.eid, [...g.positions, e.target.value]) }}
                                className="border border-slate-200 rounded px-1 h-6 text-[11px] bg-white text-slate-500">
                                <option value="">+ Thêm vị trí…</option>
                                {sheet.skills.filter(s => !g.positions.includes(s.id)).map(s => <option key={s.id} value={s.id}>{positionLabel(s.job_title, s.name, s.shift_tag)}</option>)}
                              </select>
                              {!g.positions.length && <span className="text-[11px] text-slate-400">Chưa phân</span>}
                            </div>
                          ) : (
                            g.positions.length ? <div className="flex flex-wrap gap-1">{g.positions.map(s => <span key={s} className="text-[11px] bg-sky-50 text-sky-700 border border-sky-200 rounded px-1.5 py-0.5">{labelOf(s)}</span>)}</div> : <span>— Chưa phân —</span>
                          )}
                        {g.manual && g.positions.length > 0 && <span className="text-[9px] text-sky-500 ml-1">(tay)</span>}
                      </td>
                      <td className="px-2 py-1.5 text-slate-500 align-top">{g.positions.map(s => noteBySkill.get(s)).filter(Boolean).join('; ') || '—'}</td>
                      <td className="px-2 py-1.5 align-top">
                        {g.leave ? <Badge variant="slate">Nghỉ phép</Badge> : g.positions.length ? <Badge variant="info">Đã xếp{g.positions.length > 1 ? ` (${g.positions.length})` : ''}</Badge> : <Badge variant="warning">Chưa phân</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showImg && <ImagePreview onClose={() => setShowImg(false)} sheet={sheet} whName={whName} labelOf={labelOf} sortedAsg={sortedAsg} posCount={posCount} noteBySkill={noteBySkill} shiftBySkill={shiftBySkill} currentUserId={currentUserId} />}
        </div>
      )}
    </div>
  )
}

// ─── Nội dung phiếu (giống mẫu Lịch làm việc) — mỗi VỊ TRÍ 1 dòng ───
// nền dòng theo ca: Ca 2 = vàng nhạt, Ca 3 = đỏ nhạt; còn lại trắng/zebra
const PRINT_ROW_BG: Record<string, string> = { CA2: '#fef3c7', CA3: '#fee2e2' }
type EmpRow = { eid: string; employee: SheetDetail['assignments'][number]['employee']; positions: string[]; leave: boolean; manual: boolean }
type DocProps = {
  sheet: SheetDetail; whName: string; labelOf: (id: string | null) => string
  sortedAsg: SheetDetail['assignments']; posCount: Map<string, number>
  noteBySkill: Map<string, string | null>; shiftBySkill: Map<string, string | null>
  currentUserId: string | null
}
function ScheduleDoc({ sheet, whName, labelOf, sortedAsg, posCount, noteBySkill, shiftBySkill, currentUserId }: DocProps) {
  return (
    <div className="sheet-doc">
      <style>{`
        .sheet-doc, .sheet-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .sheet-doc table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .sheet-doc th, .sheet-doc td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; }
        .sheet-doc thead th { background: #1e293b; color: #fff; font-weight: 600; }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{ width: 56, height: 40, background: '#e11d48', color: '#fff', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontStyle: 'italic', fontSize: 18 }}>lof</div>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>BẢNG PHÂN CÔNG LỊCH LÀM VIỆC CHI TIẾT</div>
          <div style={{ fontSize: 12, marginTop: 2 }}><b>Ngày: {formatDate(sheet.work_date)}</b> &nbsp;|&nbsp; <b>Bộ phận: {sheet.layout_name}</b></div>
          <div style={{ fontSize: 12 }}>Kho: {whName}</div>
        </div>
        <div style={{ width: 56 }} />
      </div>
      <table>
        <thead><tr><th style={{ width: 36 }}>STT</th><th>Họ và Tên</th><th>Chức danh</th><th>Vị trí phân công</th><th style={{ width: 120 }}>Note</th></tr></thead>
        <tbody>
          {sortedAsg.map((a, i) => {
            const tag = a.skill_id ? shiftBySkill.get(a.skill_id) : null
            const bg = (a.status === 'ASSIGNED' && tag && PRINT_ROW_BG[tag]) ? PRINT_ROW_BG[tag] : (i % 2 ? '#f8fafc' : '#fff')
            const isMe = !!currentUserId && a.employee_id === currentUserId
            const multi = a.status === 'ASSIGNED' && (posCount.get(a.employee_id) ?? 0) >= 2
            return (
              <tr key={a.id} style={{ background: bg }}>
                <td>{i + 1}</td>
                <td>
                  <span style={isMe ? { textDecoration: 'underline' } : undefined}>{a.employee?.name ?? '—'}</span>
                  {multi && <span style={{ color: '#e11d48', marginLeft: 4 }}>★</span>}
                </td>
                <td>{a.employee?.job_title ?? '—'}</td>
                <td>{a.status === 'LEAVE' ? 'Nghỉ phép' : a.skill_id ? labelOf(a.skill_id) : 'Chưa phân công'}</td>
                <td>{a.skill_id ? (noteBySkill.get(a.skill_id) ?? '') : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Xem LỊCH toàn màn hình → CHIA SẺ thẳng (Zalo…) hoặc tải ảnh (không cần in)
function ImagePreview({ onClose, ...props }: DocProps & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [saving, setSaving] = useState(false)
  const fileName = `PhanCong_${(props.sheet.layout_name || 'lich').replace(/\s+/g, '_')}_${props.sheet.work_date}.png`
  const canShare = typeof navigator !== 'undefined' && !!navigator.canShare   // mobile mới có
  const renderBlob = async () => ref.current ? await toBlob(ref.current, { pixelRatio: 2, backgroundColor: '#ffffff' }) : null
  const saveFile = (blob: Blob) => {
    const urlObj = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = urlObj; a.download = fileName
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(urlObj), 1500)
  }
  async function share() {
    setSaving(true)
    try {
      const blob = await renderBlob(); if (!blob) return
      const file = new File([blob], fileName, { type: 'image/png' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Lịch phân công' })   // mở khung chia sẻ → Zalo…
      } else { saveFile(blob) }
    } catch { /* user huỷ chia sẻ → bỏ qua */ } finally { setSaving(false) }
  }
  async function download() {
    setSaving(true)
    try { const blob = await renderBlob(); if (blob) saveFile(blob) } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 overflow-auto" onClick={onClose}>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-slate-900 text-white px-3 py-2 text-xs">
        <span className="truncate">{canShare ? '📤 Bấm Chia sẻ để gửi thẳng (Zalo…)' : '📸 Chụp màn hình hoặc Tải ảnh để gửi'}</span>
        <div className="flex items-center gap-2 shrink-0">
          {canShare && <button onClick={share} disabled={saving} className="inline-flex items-center gap-1 bg-green-600 hover:bg-green-500 disabled:opacity-60 rounded px-2 py-1"><Share2 className="h-3.5 w-3.5" />{saving ? 'Đang tạo…' : 'Chia sẻ'}</button>}
          <button onClick={download} disabled={saving} className="inline-flex items-center gap-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 rounded px-2 py-1"><ImageIcon className="h-3.5 w-3.5" />Tải ảnh</button>
          <button onClick={onClose} className="inline-flex items-center gap-1 bg-white/15 hover:bg-white/25 rounded px-2 py-1"><X className="h-3.5 w-3.5" />Đóng</button>
        </div>
      </div>
      <div className="p-2 sm:p-4">
        <div ref={ref} className="bg-white mx-auto max-w-2xl p-3 rounded-lg shadow-lg" onClick={e => e.stopPropagation()}>
          <ScheduleDoc {...props} />
        </div>
      </div>
    </div>
  )
}

// ════════ TAB LAYOUT (quản lý mẫu theo Kho) ════════
function LayoutTab({ canCreate }: { canCreate: boolean }) {
  const { data: warehouses = [] } = useWarehouses(true)
  const saved = (() => { try { return JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}') } catch { return {} } })()
  const [wh, setWh] = useState<string>(saved.wh ?? '')
  const { data: layouts = [], isLoading } = useLayouts(wh || undefined)
  const create = useCreateLayout()
  const del = useDeleteLayout()
  const [editId, setEditId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  async function addLayout() {
    if (!newName.trim() || !wh) return
    setErr(null)
    try { const l = await create.mutateAsync({ warehouse_id: wh, name: newName.trim() }); setNewName(''); setEditId(l.id) }
    catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }
  async function removeLayout(l: LayoutRow) {
    if (!confirm(`Xóa layout "${l.name}"?`)) return
    setErr(null)
    try { await del.mutateAsync(l.id); if (editId === l.id) setEditId(null) } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <WarehouseSingleSelect warehouses={warehouses as { id: string; code?: string; name: string }[]} value={wh} onChange={setWh} placeholder="Chọn kho…" triggerClassName="w-40" />
        {canCreate && wh && (
          <div className="flex items-center gap-1.5">
            <Input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addLayout()} placeholder="Tên layout mới (VD: Ca ngày SX)…" className="h-7 text-xs w-56" />
            <Button size="sm" className="h-7" onClick={addLayout} disabled={!newName.trim() || create.isPending}><Plus className="h-4 w-4" /></Button>
          </div>
        )}
      </div>
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

      {!wh ? (
        <div className="flex flex-col items-center justify-center text-slate-400 gap-2 py-16"><Layers className="h-8 w-8" /><p className="text-sm">Chọn <b>Kho</b> để quản lý layout</p></div>
      ) : isLoading ? <p className="text-xs text-slate-400 py-8 text-center">Đang tải…</p>
      : layouts.length === 0 ? <p className="text-xs text-slate-400 py-8 text-center">Kho này chưa có layout nào.</p>
      : (
        <div className="space-y-2 max-w-3xl">
          {layouts.map(l => (
            <div key={l.id} className="border border-slate-200 rounded-lg">
              <div className="flex items-center gap-2 px-3 py-2">
                <Layers className="h-4 w-4 text-sky-500 shrink-0" />
                <span className="font-medium text-slate-700 text-sm">{l.name}</span>
                <span className="text-[11px] text-slate-400">{l.positions} vị trí · {l.people} người</span>
                <div className="flex-1" />
                {canCreate && <Button size="sm" variant="outline" className="h-7" onClick={() => setEditId(editId === l.id ? null : l.id)}><Pencil className="h-3.5 w-3.5 mr-1" />{editId === l.id ? 'Đóng' : 'Sửa vị trí'}</Button>}
                {canCreate && <Button size="sm" variant="outline" className="h-7 text-red-600" onClick={() => removeLayout(l)}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
              {editId === l.id && <LayoutEditor layoutId={l.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Sửa 1 layout: (1) chọn Chức danh → (2) gom skill các chức danh đó (kèm kế thừa cấp dưới) → nhập số người
function LayoutEditor({ layoutId }: { layoutId: string }) {
  const { data: layout } = useLayout(layoutId)
  const { data: jobTitles = [] } = useJobTitles()
  const setSkills = useSetLayoutSkills()
  const setJts = useSetLayoutJobTitles()
  const update = useUpdateLayout()
  const [jts, setJtSel] = useState<string[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!layout) return
    const m: Record<string, number> = {}, n: Record<string, string> = {}
    for (const s of layout.skills) { m[s.skill_id] = s.required_count; if (s.note) n[s.skill_id] = s.note }
    setCounts(m); setNotes(n); setNote(layout.note ?? ''); setJtSel(layout.job_title_ids ?? []); setDirty(false)
  }, [layout])

  // danh mục skill của các chức danh đã chọn (gồm cả skill kế thừa từ cấp dưới, gộp theo skill_id)
  const { data: catalog = [] } = useSkills({ job_title_ids: jts.join(','), with_descendants: true }, jts.length > 0)

  function setCount(skillId: string, v: number) { setCounts(p => ({ ...p, [skillId]: v })); setDirty(true) }
  function setSkillNote(skillId: string, v: string) { setNotes(p => ({ ...p, [skillId]: v })); setDirty(true) }
  async function save() {
    setErr(null)
    try {
      await setJts.mutateAsync({ layout_id: layoutId, job_title_ids: jts })
      const catalogIds = new Set(catalog.map(s => s.id))
      const skills = Object.entries(counts).filter(([id, c]) => c > 0 && catalogIds.has(id))
        .map(([skill_id, required_count], i) => ({ skill_id, required_count, sort_order: i, note: notes[skill_id] || undefined }))
      await setSkills.mutateAsync({ layout_id: layoutId, skills })
      if (layout && note !== (layout.note ?? '')) await update.mutateAsync({ id: layoutId, note })
      setDirty(false)
    } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  if (!layout) return <p className="text-xs text-slate-400 px-3 pb-3">Đang tải…</p>
  return (
    <div className="border-t border-slate-200 p-3 space-y-3 bg-slate-50/50">
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</div>}
      <div className="flex items-center gap-2">
        <Input value={note} onChange={e => { setNote(e.target.value); setDirty(true) }} placeholder="Ghi chú layout (không bắt buộc)" className="h-7 text-xs flex-1" />
        <Button size="sm" variant={dirty ? 'default' : 'outline'} className="h-7" disabled={!dirty || setSkills.isPending || setJts.isPending} onClick={save}><Save className="h-3.5 w-3.5 mr-1" />Lưu</Button>
      </div>

      {/* Bước 1: chọn chức danh (dropdown multi-select) */}
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-slate-600">1. Chọn chức danh (gọi nhóm người cho layout)</p>
        <MultiSelectFilter label="Chức danh" width="w-64"
          options={jobTitles.map(j => ({ value: j.id, label: j.name }))}
          selected={jts} onChange={v => { setJtSel(v); setDirty(true) }} />
      </div>

      {/* Bước 2: bảng vị trí — số lượng — ghi chú */}
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-slate-600">2. Vị trí & số người mặc định (để trống = không dùng)</p>
        {jts.length === 0 ? <p className="text-xs text-slate-400">Chọn chức danh ở bước 1 để hiện danh mục vị trí.</p>
        : catalog.length === 0 ? <p className="text-xs text-slate-400">Chức danh đã chọn chưa có vị trí/skill nào.</p>
        : (
          <div className="border border-slate-200 rounded-lg overflow-x-auto bg-white">
            <table className="w-full text-xs min-w-max">
              <thead className="bg-slate-50 text-[10px] text-slate-500">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium">Vị trí</th>
                  <th className="text-left px-2 py-1.5 font-medium">Chức danh</th>
                  <th className="text-left px-2 py-1.5 font-medium w-36">Số lượng</th>
                  <th className="text-left px-2 py-1.5 font-medium">Ghi chú</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {catalog.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50/60">
                    <td className="px-2 py-1 text-slate-700">{s.name}{s.shift_tag && <span className="text-[10px] text-slate-400 ml-1">{shiftOf(s.shift_tag)}</span>}</td>
                    <td className="px-2 py-1 text-slate-500">{s.job_title ?? '—'}</td>
                    <td className="px-2 py-1"><QtyCell value={counts[s.id] ?? 0} onChange={v => setCount(s.id, v)} /></td>
                    <td className="px-2 py-1"><Input value={notes[s.id] ?? ''} onChange={e => setSkillNote(s.id, e.target.value)} placeholder="—" className="h-6 text-xs" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
