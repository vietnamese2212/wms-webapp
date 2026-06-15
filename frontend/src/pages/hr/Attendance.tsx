import { useState, useEffect } from 'react'
import { Save, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth } from 'date-fns'
import { vi } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import {
  useWarehouses, useDepartments,
  useAttendance, useUpsertAttendance, useDeleteAttendance, useAttendanceReport, type AttendanceRow,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate } from '@/utils/formatters'

const KINDS: { value: string; label: string }[] = [
  { value: 'CA1', label: 'Ca 1' },
  { value: 'CA2', label: 'Ca 2' },
  { value: 'CA3', label: 'Ca 3' },
  { value: 'HC',  label: 'Hành chính' },
  { value: 'LEAVE', label: 'Nghỉ phép' },
]
const kindLabel = (k: string) => KINDS.find(o => o.value === k)?.label ?? k
const kindVariant = (k: string): 'info' | 'success' | 'warning' | 'slate' =>
  k === 'LEAVE' ? 'slate' : k === 'HC' ? 'success' : 'info'
const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const MONTH_START = () => { const d = TODAY(); return d.slice(0, 8) + '01' }

// màu ô lịch theo loại công
const KIND_CELL: Record<string, string> = {
  CA1:   'bg-sky-100 text-sky-700',
  CA2:   'bg-indigo-100 text-indigo-700',
  CA3:   'bg-violet-100 text-violet-700',
  HC:    'bg-green-100 text-green-700',
  LEAVE: 'bg-slate-200 text-slate-600',
}
const KIND_SHORT: Record<string, string> = { CA1: 'Ca 1', CA2: 'Ca 2', CA3: 'Ca 3', HC: 'HC', LEAVE: 'Nghỉ' }
const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

export default function Attendance() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canSelf = can(perms, 'attendance', 'self_log')
  const canView = can(perms, 'attendance', 'view')
  const canReport = can(perms, 'attendance', 'report')

  const [tab, setTab] = useState<'me' | 'team' | 'report'>(canSelf ? 'me' : canView ? 'team' : 'report')

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b border-slate-200 px-3 py-2.5 sm:rounded-t-xl flex items-center gap-3">
          <h1 className="text-base font-semibold text-slate-800">Chấm công</h1>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
            {canSelf && <button onClick={() => setTab('me')} className={`px-3 py-1.5 ${tab === 'me' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Của tôi</button>}
            {canView && <button onClick={() => setTab('team')} className={`px-3 py-1.5 border-l border-slate-200 ${tab === 'team' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Bảng công</button>}
            {canReport && <button onClick={() => setTab('report')} className={`px-3 py-1.5 border-l border-slate-200 ${tab === 'report' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Báo cáo</button>}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3">
          {tab === 'me' && canSelf ? <MySection />
            : tab === 'report' && canReport ? <ReportSection />
            : canView ? <TeamSection perms={perms} />
            : <p className="text-sm text-slate-400 text-center py-16">Không có quyền.</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Của tôi (lịch tháng) ───────────────────────────────────────────────────
function MySection() {
  const user = useAuthStore(s => s.user)
  const upsert = useUpsertAttendance()
  const del = useDeleteAttendance()

  const [month, setMonth] = useState(() => new Date())
  const monthStart = startOfMonth(month)
  const monthEnd   = endOfMonth(month)
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 })
  const gridEnd    = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days: Date[] = []
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d)

  const { data: rows = [] } = useAttendance(
    { employee_id: user?.id, date_from: format(monthStart, 'yyyy-MM-dd'), date_to: format(monthEnd, 'yyyy-MM-dd') },
    !!user?.id,
  )
  const byDate = new Map(rows.map(r => [r.work_date, r]))

  const today = TODAY()
  const [sel, setSel]     = useState<string | null>(null)
  const [kind, setKind]   = useState('CA1')
  const [ot, setOt]       = useState(0)
  const [early, setEarly] = useState(0)
  const [err, setErr]     = useState<string | null>(null)

  // seed form khi chọn ngày
  useEffect(() => {
    if (!sel) return
    const e = byDate.get(sel)
    setKind(e?.kind ?? 'CA1'); setOt(e?.ot_hours ?? 0); setEarly(e?.early_leave_hours ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  const selEntry = sel ? byDate.get(sel) : undefined
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canEditPast = can(perms, 'attendance', 'edit')
  const isPast = !!sel && sel < today
  const locked = isPast && !canEditPast            // ngày đã qua + không có quyền sửa
  const isLeave = kind === 'LEAVE'
  const totalCong = isLeave ? 0 : Math.round((8 + ot - early) * 10) / 10

  function pickKind(k: string) { setKind(k); if (k === 'LEAVE') { setOt(0); setEarly(0) } }
  function pickOt(v: number) { setOt(v); if (v > 0) setEarly(0) }
  function pickEarly(v: number) { setEarly(v); if (v > 0) setOt(0) }

  async function save() {
    if (!sel || locked) return
    setErr(null)
    try { await upsert.mutateAsync({ employee_id: user?.id, warehouse_id: user?.warehouse_id, work_date: sel, kind, ot_hours: ot, early_leave_hours: early }) }
    catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }
  async function remove() {
    if (!selEntry) return
    setErr(null)
    try { await del.mutateAsync(selEntry.id); setSel(null) } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 max-w-4xl">
      {/* Lịch */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setMonth(m => subMonths(m, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="text-sm font-semibold text-slate-700 w-32 text-center">{format(month, 'MMMM yyyy', { locale: vi })}</div>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setMonth(m => addMonths(m, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setMonth(new Date()); setSel(today) }}>Hôm nay</Button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {DOW.map(d => <div key={d} className="text-center text-[10px] font-medium text-slate-400 py-1">{d}</div>)}
          {days.map(day => {
            const ds = format(day, 'yyyy-MM-dd')
            const e = byDate.get(ds)
            const inMonth = isSameMonth(day, month)
            const isToday = ds === today
            const isFuture = ds > today
            const isSel = ds === sel
            return (
              <button key={ds} type="button" disabled={isFuture}
                onClick={() => setSel(ds)}
                className={`min-h-[52px] rounded-lg border p-1 text-left flex flex-col gap-0.5 transition-colors
                  ${isSel ? 'border-sky-500 ring-1 ring-sky-400' : 'border-slate-200'}
                  ${!inMonth ? 'opacity-40' : ''} ${isFuture ? 'bg-slate-50 cursor-not-allowed' : 'hover:border-sky-300'}
                  ${e ? KIND_CELL[e.kind] : 'bg-white'}`}>
                <span className={`text-[11px] font-semibold leading-none ${isToday ? 'text-sky-600' : ''}`}>{format(day, 'd')}</span>
                {e && <span className="text-[10px] leading-tight font-medium">{KIND_SHORT[e.kind]}</span>}
                {e && (e.ot_hours > 0 || e.early_leave_hours > 0) && (
                  <span className="text-[8px] leading-none text-slate-500">{e.ot_hours > 0 ? `OT${e.ot_hours}` : ''}{e.early_leave_hours > 0 ? ` -${e.early_leave_hours}h` : ''}</span>
                )}
              </button>
            )
          })}
        </div>
        {/* chú thích */}
        <div className="flex flex-wrap gap-2 mt-2">
          {KINDS.map(k => <span key={k.value} className={`text-[10px] px-1.5 py-0.5 rounded ${KIND_CELL[k.value]}`}>{k.label}</span>)}
        </div>
      </div>

      {/* Form ngày đã chọn */}
      <div className="lg:w-64 shrink-0">
        {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-2">{err}</div>}
        {!sel ? (
          <div className="border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-400">Chọn 1 ngày trên lịch để chấm công</div>
        ) : (
          <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50 space-y-2.5">
            <p className="text-sm font-medium text-slate-700">{formatDate(sel)}{isPast && <span className="text-[10px] text-slate-400 ml-1">(ngày đã qua)</span>}</p>
            {locked && <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">Ngày đã qua — cần quyền "Sửa công" mới chỉnh được.</div>}
            <div>
              <label className="text-[11px] text-slate-500">Loại công</label>
              <select value={kind} disabled={locked} onChange={e => pickKind(e.target.value)} className="border border-slate-200 rounded-md px-2 h-8 text-sm bg-white block w-full disabled:bg-slate-100">
                {KINDS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[11px] text-slate-500">Giờ OT</label>
                <Input type="number" min={0} step={0.5} value={ot || ''} disabled={locked || isLeave || early > 0}
                  onChange={e => pickOt(Number(e.target.value) || 0)} className="h-8 text-sm disabled:bg-slate-100" /></div>
              <div><label className="text-[11px] text-slate-500">Giờ về sớm</label>
                <Input type="number" min={0} step={0.5} value={early || ''} disabled={locked || isLeave || ot > 0}
                  onChange={e => pickEarly(Number(e.target.value) || 0)} className="h-8 text-sm disabled:bg-slate-100" /></div>
            </div>
            <div className="text-xs text-slate-600">Tổng công: <b className="text-slate-800">{totalCong}h</b> {!isLeave && <span className="text-[10px] text-slate-400">(8h{ot > 0 ? ` + OT ${ot}` : ''}{early > 0 ? ` − về sớm ${early}` : ''})</span>}</div>
            <div className="flex gap-2 pt-1">
              <Button onClick={save} disabled={upsert.isPending || locked} className="h-8 flex-1"><Save className="h-4 w-4 mr-1" />{selEntry ? 'Cập nhật' : 'Lưu'}</Button>
              {selEntry && <Button variant="outline" onClick={remove} disabled={del.isPending || locked} className="h-8 text-red-600"><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Bảng công (team) ───────────────────────────────────────────────────────
function TeamSection({ perms }: { perms: ModulePermissions | null }) {
  const canEdit = can(perms, 'attendance', 'edit')
  const { data: warehouses = [] } = useWarehouses(true)
  const { data: departments = [] } = useDepartments()
  const del = useDeleteAttendance()

  const [wh, setWh]     = useState('')
  const [dept, setDept] = useState('')
  const [from, setFrom] = useState(MONTH_START())
  const [to, setTo]     = useState(TODAY())

  const { data: rows = [], isLoading } = useAttendance(
    { warehouse_id: wh || undefined, department_id: dept || undefined, date_from: from, date_to: to },
    true,
  )
  const defs: FilterDef[] = [
    { key: 'range', label: 'Khoảng ngày', type: 'daterange', from, to, onChange: (f, t) => { setFrom(f); setTo(t) } },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <WarehouseSingleSelect warehouses={warehouses as { id: string; code?: string; name: string }[]} value={wh} onChange={setWh} allLabel="Tất cả kho" placeholder="Tất cả kho" triggerClassName="w-40" />
        <select value={dept} onChange={e => setDept(e.target.value)} className="border border-slate-200 rounded-md px-2.5 text-xs h-7 bg-white text-slate-700">
          <option value="">Tất cả phòng</option>
          {(departments as { id: string; name: string }[]).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="flex-1" />
        <FilterSheetButton defs={defs} className="sm:hidden" />
        <div className="hidden sm:block"><FilterBar defs={defs} /></div>
      </div>
      {isLoading ? <p className="text-xs text-slate-400 py-8 text-center">Đang tải…</p>
      : <AttTable rows={rows} onDelete={canEdit ? (id => del.mutate(id)) : undefined} showName />}
    </div>
  )
}

// ─── Báo cáo công ───────────────────────────────────────────────────────────
function ReportSection() {
  const { data: warehouses = [] } = useWarehouses(true)
  const { data: departments = [] } = useDepartments()
  const [wh, setWh]     = useState('')
  const [dept, setDept] = useState('')
  const [from, setFrom] = useState(MONTH_START())
  const [to, setTo]     = useState(TODAY())
  const { data: rows = [], isLoading } = useAttendanceReport({ warehouse_id: wh || undefined, department_id: dept || undefined, date_from: from, date_to: to }, true)
  const defs: FilterDef[] = [{ key: 'range', label: 'Khoảng ngày', type: 'daterange', from, to, onChange: (f, t) => { setFrom(f); setTo(t) } }]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <WarehouseSingleSelect warehouses={warehouses as { id: string; code?: string; name: string }[]} value={wh} onChange={setWh} allLabel="Tất cả kho" placeholder="Tất cả kho" triggerClassName="w-40" />
        <select value={dept} onChange={e => setDept(e.target.value)} className="border border-slate-200 rounded-md px-2.5 text-xs h-7 bg-white text-slate-700">
          <option value="">Tất cả phòng</option>
          {(departments as { id: string; name: string }[]).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="flex-1" />
        <FilterSheetButton defs={defs} className="sm:hidden" />
        <div className="hidden sm:block"><FilterBar defs={defs} /></div>
      </div>
      {isLoading ? <p className="text-xs text-slate-400 py-8 text-center">Đang tải…</p>
      : (
        <div className="border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-xs min-w-max">
            <thead className="bg-slate-50 text-[10px] text-slate-500">
              <tr>
                <th className="text-left px-2 py-2 font-medium sticky left-0 bg-slate-50">Nhân viên</th>
                <th className="text-right px-2 py-2 font-medium">Ca 1</th>
                <th className="text-right px-2 py-2 font-medium">Ca 2</th>
                <th className="text-right px-2 py-2 font-medium">Ca 3</th>
                <th className="text-right px-2 py-2 font-medium">HC</th>
                <th className="text-right px-2 py-2 font-medium">Ngày công</th>
                <th className="text-right px-2 py-2 font-medium">Nghỉ phép</th>
                <th className="text-right px-2 py-2 font-medium">Giờ OT</th>
                <th className="text-right px-2 py-2 font-medium">Giờ về sớm</th>
                <th className="text-right px-2 py-2 font-medium">Tổng giờ công</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr><td colSpan={10} className="text-center text-slate-400 py-6">Chưa có dữ liệu</td></tr>
              ) : rows.map(r => (
                <tr key={r.employee_id} className="hover:bg-slate-50/60">
                  <td className="px-2 py-1.5 sticky left-0 bg-white"><span className="font-medium text-slate-700">{r.employee?.name ?? '—'}</span> <span className="text-[10px] text-slate-400">{r.employee?.employee_code}</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.ca1 || '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.ca2 || '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.ca3 || '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.hc || '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.work_days || '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.leave || '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.ot_hours > 0 ? r.ot_hours : '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.early_hours > 0 ? r.early_hours : '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-700">{r.total_hours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AttTable({ rows, onDelete, showName }: { rows: AttendanceRow[]; onDelete?: (id: string) => void; showName: boolean }) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-x-auto">
      <table className="w-full text-xs min-w-max">
        <thead className="bg-slate-50 text-[10px] text-slate-500">
          <tr>
            {showName && <th className="text-left px-2 py-2 font-medium">Nhân viên</th>}
            <th className="text-left px-2 py-2 font-medium">Ngày</th>
            <th className="text-left px-2 py-2 font-medium">Loại</th>
            <th className="text-right px-2 py-2 font-medium">Giờ OT</th>
            <th className="text-right px-2 py-2 font-medium">Về sớm</th>
            {onDelete && <th className="px-2 py-2"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr><td colSpan={showName ? 6 : 5} className="text-center text-slate-400 py-6">Chưa có dữ liệu</td></tr>
          ) : rows.map(r => (
            <tr key={r.id} className="hover:bg-slate-50/60">
              {showName && <td className="px-2 py-1.5"><span className="font-medium text-slate-700">{r.employee?.name ?? '—'}</span> <span className="text-[10px] text-slate-400">{r.employee?.employee_code}</span></td>}
              <td className="px-2 py-1.5 tabular-nums">{formatDate(r.work_date)}</td>
              <td className="px-2 py-1.5"><Badge variant={kindVariant(r.kind)}>{kindLabel(r.kind)}</Badge></td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.ot_hours > 0 ? r.ot_hours : '—'}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.early_leave_hours > 0 ? r.early_leave_hours : '—'}</td>
              {onDelete && <td className="px-2 py-1.5 text-right"><button onClick={() => onDelete(r.id)} className="text-slate-400 hover:text-red-600 hover:bg-red-50 rounded p-1"><Trash2 className="h-3.5 w-3.5" /></button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
