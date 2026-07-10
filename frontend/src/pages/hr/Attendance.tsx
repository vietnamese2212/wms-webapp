import { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { Save, Trash2, ChevronLeft, ChevronRight, Plus, CheckCircle2, Clock, Flag, Download, Rows3, AlignJustify } from 'lucide-react'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth } from 'date-fns'
import { vi } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SavedViews } from '@/components/shared/SavedViews'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { SummaryBand } from '@/components/shared/SummaryBand'
import {
  useDepartments, useJobTitles, useEmployeeRecords,
  useAttendance, useUpsertAttendance, useDeleteAttendance, type AttendanceRow,
  useLeaves,
} from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate } from '@/utils/formatters'
import { getHoliday } from '@/utils/vnHolidays'
import { LeaveSection, CreateLeaveDialog } from './LeaveManagement'

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

// tổng công 1 ngày (giờ): nghỉ phép = 0; còn lại = 8h + OT − về sớm
const rowTotal = (r: { kind: string; ot_hours: number; early_leave_hours: number }) =>
  r.kind === 'LEAVE' ? 0 : Math.round((8 + (r.ot_hours || 0) - (r.early_leave_hours || 0)) * 10) / 10
// đơn vị công = giờ ÷ 8 (decimal, làm tròn 2 chữ số)
const toCong = (hours: number) => Math.round((hours / 8) * 100) / 100
// liệt kê ngày YYYY-MM-DD trong [from, to]
function eachDate(from: string, to: string): string[] {
  const out: string[] = []
  let d = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  while (d <= end) { out.push(format(d, 'yyyy-MM-dd')); d = addDays(d, 1) }
  return out
}

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
const dowOf = (ds: string) => DOW[(new Date(`${ds}T00:00:00`).getDay() + 6) % 7]

export default function Attendance() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canSelf = can(perms, 'attendance', 'self_log')
  const canView = can(perms, 'attendance', 'view')
  const canReport = can(perms, 'attendance', 'report')
  const canLeave = can(perms, 'leave', 'view') || can(perms, 'leave', 'request')

  const canSheet = canView || canReport
  const [tab, setTab] = useState<'me' | 'leave' | 'team'>(canSelf ? 'me' : canLeave ? 'leave' : 'team')

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b border-slate-200 px-3 py-2.5 sm:rounded-t-xl flex items-center gap-3">
          <h1 className="text-base font-semibold text-slate-800">Chấm công</h1>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
            {canSelf && <button onClick={() => setTab('me')} className={`px-3 py-1.5 ${tab === 'me' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Của tôi</button>}
            {canLeave && <button onClick={() => setTab('leave')} className={`px-3 py-1.5 border-l border-slate-200 ${tab === 'leave' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Nghỉ phép</button>}
            {canSheet && <button onClick={() => setTab('team')} className={`px-3 py-1.5 border-l border-slate-200 ${tab === 'team' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Bảng công</button>}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3">
          {tab === 'me' && canSelf ? <MySection />
            : tab === 'leave' && canLeave ? <LeaveSection />
            : canSheet ? <TeamSection perms={perms} />
            : <p className="text-sm text-slate-400 text-center py-16">Không có quyền.</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Của tôi (lịch tháng để chấm công + bảng công theo khoảng ngày) ──────────
const MY_FROM_KEY = 'hr_my_att_from'

function MySection() {
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canEditPast = can(perms, 'attendance', 'edit')
  const canRequestLeave = can(perms, 'leave', 'request')
  const upsert = useUpsertAttendance()
  const del = useDeleteAttendance()

  const [month, setMonth] = useState(() => new Date())
  const monthStart = startOfMonth(month)
  const monthEnd   = endOfMonth(month)
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 })
  const gridEnd    = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const fromStr = format(monthStart, 'yyyy-MM-dd')
  const toStr   = format(monthEnd, 'yyyy-MM-dd')
  const days: Date[] = []
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d)

  const { data: rows = [] } = useAttendance({ employee_id: user?.id, date_from: fromStr, date_to: toStr }, !!user?.id)
  const byDate = new Map(rows.map(r => [r.work_date, r]))

  // đơn xin nghỉ của bản thân trong tháng → map ngày -> trạng thái (ưu tiên APPROVED)
  const { data: myLeaves = [] } = useLeaves({ employee_id: user?.id, date_from: fromStr, date_to: toStr }, !!user?.id)
  const leaveByDate = useMemo(() => {
    const m = new Map<string, 'APPROVED' | 'PENDING'>()
    for (const l of myLeaves) {
      if (l.status === 'REJECTED') continue
      for (const d of eachDate(l.date_from, l.date_to)) {
        if (l.status === 'APPROVED' || m.get(d) !== 'APPROVED') m.set(d, l.status as 'APPROVED' | 'PENDING')
      }
    }
    return m
  }, [myLeaves])

  const today = TODAY()
  const [sel, setSel]     = useState<string | null>(null)
  const [kind, setKind]   = useState('CA1')
  const [ot, setOt]       = useState(0)
  const [early, setEarly] = useState(0)
  const [err, setErr]     = useState<string | null>(null)
  const [openLeave, setOpenLeave] = useState(false)

  // seed form khi chọn ngày
  useEffect(() => {
    if (!sel) return
    const e = byDate.get(sel)
    setKind(e?.kind ?? 'CA1'); setOt(e?.ot_hours ?? 0); setEarly(e?.early_leave_hours ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  const selEntry = sel ? byDate.get(sel) : undefined
  const selLeave = sel ? leaveByDate.get(sel) : undefined
  const selHoliday = sel ? getHoliday(sel) : null
  const isPast = !!sel && sel < today
  const approvedLeave = selLeave === 'APPROVED'                 // đã duyệt nghỉ → khỏi chấm công
  const locked = (isPast && !canEditPast) || approvedLeave
  const isLeave = kind === 'LEAVE'
  const totalCong = isLeave ? 0 : Math.round((8 + ot - early) * 10) / 10
  // Chỉ cho chọn "Nghỉ phép" khi ngày đó đã có đơn nghỉ (chờ/đã duyệt) hoặc bản ghi sẵn là LEAVE
  const canPickLeave = !!selLeave || selEntry?.kind === 'LEAVE'
  const kindOptions = canPickLeave ? KINDS : KINDS.filter(k => k.value !== 'LEAVE')

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
    <div className="space-y-4">
      {/* Khối 1: Lịch tháng + form chấm công */}
      <div className="flex flex-col lg:flex-row gap-4 max-w-4xl">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setMonth(m => subMonths(m, 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="text-sm font-semibold text-slate-700 w-28 sm:w-32 text-center">{format(month, 'MMMM yyyy', { locale: vi })}</div>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setMonth(m => addMonths(m, 1))}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setMonth(new Date()); setSel(today) }}>Hôm nay</Button>
            <div className="flex-1" />
            {canRequestLeave && (
              <ActionCluster className="shrink-0" items={[{
                key: 'leave-request', icon: Plus, label: 'Xin nghỉ phép', tip: 'Gửi đơn xin nghỉ phép cho chính mình',
                primary: true, variant: 'default',
                onClick: () => setOpenLeave(true),
              } satisfies ActionItem]} />
            )}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {DOW.map(d => <div key={d} className="text-center text-[10px] font-medium text-slate-400 py-1">{d}</div>)}
            {days.map(day => {
              const ds = format(day, 'yyyy-MM-dd')
              const e = byDate.get(ds)
              const lv = leaveByDate.get(ds)
              const inMonth = isSameMonth(day, month)
              const isToday = ds === today
              const isFuture = ds > today
              const isSel = ds === sel
              const cong = e ? toCong(rowTotal(e)) : 0
              const hol = getHoliday(ds)
              return (
                <button key={ds} type="button" disabled={isFuture}
                  onClick={() => setSel(ds)}
                  className={`relative min-h-[58px] rounded-lg border p-1 text-left flex flex-col transition-colors
                    ${isSel ? 'border-sky-500 ring-1 ring-sky-400' : 'border-slate-200'}
                    ${!inMonth ? 'opacity-40' : ''} ${isFuture ? 'bg-slate-50 cursor-not-allowed' : 'hover:border-sky-300'}
                    ${e ? KIND_CELL[e.kind] : 'bg-white'}`}>
                  <div className="flex items-center justify-between gap-0.5">
                    <span className={`text-[11px] font-semibold leading-none ${hol ? 'text-red-600' : isToday ? 'text-sky-600' : ''}`}>{format(day, 'd')}</span>
                    <span className="flex items-center gap-0.5">
                      {hol && <Flag className="h-2.5 w-2.5 text-red-500" aria-label={hol} />}
                      {lv === 'APPROVED' && <CheckCircle2 className="h-3 w-3 text-slate-500" aria-label="Đã duyệt nghỉ" />}
                      {lv === 'PENDING' && <Clock className="h-3 w-3 text-amber-500" aria-label="Chờ duyệt nghỉ" />}
                    </span>
                  </div>
                  {e && (
                    <div className="mt-auto flex items-end justify-between gap-0.5 leading-none">
                      <span className="text-[10px] font-medium">{KIND_SHORT[e.kind]}{(e.ot_hours > 0 || e.early_leave_hours > 0) && <span className="text-[8px] text-slate-500 ml-0.5">{e.ot_hours > 0 ? `+${e.ot_hours}` : `−${e.early_leave_hours}`}</span>}</span>
                      {e.kind !== 'LEAVE' && <span className="text-xs font-bold tabular-nums">{cong}</span>}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-2 mt-2 items-center">
            {KINDS.map(k => <span key={k.value} className={`text-[10px] px-1.5 py-0.5 rounded ${KIND_CELL[k.value]}`}>{k.label}</span>)}
            <span className="text-[10px] text-slate-500 flex items-center gap-0.5"><CheckCircle2 className="h-3 w-3 text-slate-500" /> Nghỉ đã duyệt</span>
            <span className="text-[10px] text-slate-500 flex items-center gap-0.5"><Clock className="h-3 w-3 text-amber-500" /> Chờ duyệt</span>
          </div>
        </div>

        {/* Form ngày đã chọn */}
        <div className="lg:w-64 shrink-0">
          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-2">{err}</div>}
          {!sel ? (
            <div className="border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-400">Chọn 1 ngày trên lịch để chấm công</div>
          ) : (
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50 space-y-2.5">
              <p className="text-sm font-medium text-slate-700">{formatDate(sel)} <span className="text-[11px] text-slate-400">({dowOf(sel)})</span>{isPast && <span className="text-[10px] text-slate-400 ml-1">(ngày đã qua)</span>}</p>
              {selHoliday && <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5 flex items-center gap-1.5"><Flag className="h-3.5 w-3.5 shrink-0" /> {selHoliday}</div>}
              {approvedLeave ? (
                <div className="text-[11px] text-slate-700 bg-slate-100 border border-slate-200 rounded px-2 py-1.5 flex items-start gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-slate-500 shrink-0" /> Đơn nghỉ phép đã được duyệt — ngày này tự tính là Nghỉ phép, không cần chấm công.</div>
              ) : (
                <>
                  {selLeave === 'PENDING' && <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-start gap-1.5"><Clock className="h-3.5 w-3.5 mt-0.5 shrink-0" /> Đơn nghỉ đang chờ duyệt — bạn vẫn có thể chấm công cho tới khi được duyệt.</div>}
                  {locked && <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">Ngày đã qua — cần quyền "Sửa công" mới chỉnh được.</div>}
                  <div>
                    <label className="text-[11px] text-slate-500">Loại công</label>
                    <select value={kind} disabled={locked} onChange={e => pickKind(e.target.value)} className="border border-slate-200 rounded-md px-2 h-8 text-sm bg-white block w-full disabled:bg-slate-100">
                      {kindOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {!canPickLeave && <p className="text-[10px] text-slate-400 mt-0.5">Muốn chấm Nghỉ phép? Hãy gửi đơn xin nghỉ trước.</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="text-[11px] text-slate-500">Giờ OT</label>
                      <Input type="number" min={0} step={0.5} value={ot || ''} disabled={locked || isLeave || early > 0}
                        onChange={e => pickOt(Number(e.target.value) || 0)} className="h-8 text-sm disabled:bg-slate-100" /></div>
                    <div><label className="text-[11px] text-slate-500">Giờ về sớm</label>
                      <Input type="number" min={0} step={0.5} value={early || ''} disabled={locked || isLeave || ot > 0}
                        onChange={e => pickEarly(Number(e.target.value) || 0)} className="h-8 text-sm disabled:bg-slate-100" /></div>
                  </div>
                  <div className="text-xs text-slate-600">Tổng công: <b className="text-slate-800">{toCong(totalCong)} công</b> <span className="text-[10px] text-slate-400">({totalCong}h{!isLeave && ot > 0 ? ` · OT ${ot}` : ''}{!isLeave && early > 0 ? ` · về sớm ${early}` : ''})</span></div>
                  <div className="flex gap-2 pt-1">
                    <Button onClick={save} disabled={upsert.isPending || locked} className="h-8 flex-1"><Save className="h-4 w-4 mr-1" />{selEntry ? 'Cập nhật' : 'Lưu'}</Button>
                    {selEntry && <Button variant="outline" onClick={remove} disabled={del.isPending || locked} className="h-8 text-red-600"><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Khối 2: Bảng công của tôi theo khoảng ngày (độc lập với lịch) */}
      <MyRangeSheet employeeId={user?.id} />

      {openLeave && <CreateLeaveDialog wh={user?.warehouse_id ?? ''} dept="" fixedEmployeeId={user?.id} onClose={() => setOpenLeave(false)} />}
    </div>
  )
}

// Bảng công của bản thân theo khoảng ngày tùy chọn (chu kỳ công không tròn tháng)
function MyRangeSheet({ employeeId }: { employeeId?: string }) {
  const from = useWmsFilterStore(s => s.attendanceMy.from)
  const setFrom = (v: string) => useWmsFilterStore.getState().setAttendanceMy({ from: v })
  const [to, setTo]     = useState<string>(TODAY())

  const { data: rows = [], isLoading } = useAttendance(
    { employee_id: employeeId, date_from: from, date_to: to }, !!employeeId,
  )
  const sorted = [...rows].sort((a, b) => a.work_date.localeCompare(b.work_date))
  const sum = useMemo(() => {
    let workDays = 0, ot = 0, early = 0, leave = 0
    for (const r of rows) {
      if (r.kind === 'LEAVE') { leave++; continue }
      workDays++; ot += r.ot_hours || 0; early += r.early_leave_hours || 0
    }
    const hours = workDays * 8 + ot - early
    return { workDays, ot, early, leave, cong: toCong(hours) }
  }, [rows])

  return (
    <div className="border-t border-slate-200 pt-3 space-y-2 max-w-4xl">
      <div className="flex flex-wrap items-end gap-2">
        <h2 className="text-base font-medium text-slate-700 mr-2">Bảng công của tôi</h2>
        <div>
          <label className="text-[11px] text-slate-500 block">Từ ngày</label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-7 text-xs w-36" />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 block">Tới ngày</label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-7 text-xs w-36" />
        </div>
      </div>
      <SummaryBand className="rounded-lg" tiles={[
        { label: 'Tổng công', value: sum.cong, accent: true },
        { label: 'Ngày công', value: sum.workDays },
        { label: 'Giờ OT', value: sum.ot || '—' },
        { label: 'Giờ về sớm', value: sum.early || '—' },
        { label: 'Nghỉ phép', value: sum.leave || '—' },
      ]} />
      {isLoading ? <p className="text-xs text-slate-400 py-6 text-center">Đang tải…</p>
        : <AttTable rows={sorted} showName={false} />}
    </div>
  )
}

// ─── Bảng công chung (ma trận người × ngày + raw data) ───────────────────────
type MatrixRow = { id: string; name: string; code: string; job: string | null; byDate: Map<string, AttendanceRow>; hours: number; missingDays: string[] }

function TeamSection({ perms }: { perms: ModulePermissions | null }) {
  const canEdit = can(perms, 'attendance', 'edit')
  const { data: warehouses = [] } = useScopedWarehouses(true)
  const { data: departments = [] } = useDepartments()
  const { data: jobTitles = [] } = useJobTitles()
  const { data: employees = [] } = useEmployeeRecords()
  const del = useDeleteAttendance()
  const today = TODAY()

  // Filter trong store (persist theo user qua scopedPersist)
  const f = useWmsFilterStore(s => s.attendanceTeam)
  const setAtt = useWmsFilterStore(s => s.setAttendanceTeam)
  const { view, warehouseId: wh, deptId: dept, jt, q, status, from, to } = f
  const [dense, setDense] = useState(() => localStorage.getItem('attendance_density') === '1')
  const toggleDense = () => setDense(d => { localStorage.setItem('attendance_density', d ? '0' : '1'); return !d })

  const { data: rows = [], isLoading } = useAttendance(
    { warehouse_id: wh || undefined, department_id: dept || undefined, date_from: from, date_to: to }, true,
  )
  const ql = q.trim().toLowerCase()
  const filtered = rows.filter(r =>
    (!jt || r.employee?.job_title === jt) &&
    (!ql || (r.employee?.name ?? '').toLowerCase().includes(ql) || (r.employee?.employee_code ?? '').toLowerCase().includes(ql)),
  )

  const dates = useMemo(() => eachDate(from, to), [from, to])
  // ngày cần chấm công = trong khoảng, đã qua (≤ hôm nay), không phải Chủ nhật, không phải ngày lễ
  const isWorkDay = (ds: string) => ds <= today && dowOf(ds) !== 'CN' && !getHoliday(ds)

  // roster nhân viên thuộc phạm vi lọc (kho/phòng/chức danh/tìm) — để biết ai CHƯA chấm
  const recByKey = useMemo(() => {
    const m = new Map<string, AttendanceRow>()
    for (const r of rows) m.set(`${r.employee_id}|${r.work_date}`, r)
    return m
  }, [rows])
  const matrixAll = useMemo(() => {
    return employees
      .filter(e =>
        e.is_active && !e.deleted_at &&
        (!wh || e.warehouse_access?.some(w => w.warehouse_id === wh)) &&
        (!dept || e.department_id === dept) &&
        (!jt || e.job_title?.name === jt) &&
        (!ql || e.name.toLowerCase().includes(ql) || e.employee_code.toLowerCase().includes(ql)),
      )
      .map<MatrixRow>(e => {
        const byDate = new Map<string, AttendanceRow>()
        let hours = 0
        for (const d of dates) {
          const r = recByKey.get(`${e.id}|${d}`)
          if (r) { byDate.set(d, r); hours += rowTotal(r) }
        }
        const missingDays = dates.filter(d => isWorkDay(d) && !byDate.has(d))
        return { id: e.id, name: e.name, code: e.employee_code, job: e.job_title?.name ?? null, byDate, hours, missingDays }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, wh, dept, jt, ql, dates, recByKey, today])
  const matrixEmps = matrixAll.filter(g => status === 'all' || (status === 'done' ? g.missingDays.length === 0 : g.missingDays.length > 0))
  const totalMissing = matrixAll.reduce((s, g) => s + g.missingDays.length, 0)

  const sum = useMemo(() => {
    let workDays = 0, ot = 0, early = 0, leave = 0
    for (const r of filtered) {
      if (r.kind === 'LEAVE') { leave++; continue }
      workDays++; ot += r.ot_hours || 0; early += r.early_leave_hours || 0
    }
    const hours = workDays * 8 + ot - early
    return { workDays, ot, early, leave, cong: toCong(hours) }
  }, [filtered])

  const defs: FilterDef[] = [
    { key: 'warehouse', label: 'Kho', type: 'single', value: wh, onChange: v => setAtt({ warehouseId: v }), allLabel: 'Tất cả kho',
      options: (warehouses as { id: string; name: string }[]).map(w => ({ value: w.id, label: w.name })) },
    { key: 'dept', label: 'Phòng ban', type: 'single', value: dept, onChange: v => setAtt({ deptId: v }), allLabel: 'Tất cả phòng',
      options: (departments as { id: string; name: string }[]).map(d => ({ value: d.id, label: d.name })) },
    { key: 'jt', label: 'Chức danh', type: 'single', value: jt, onChange: v => setAtt({ jt: v }), allLabel: 'Tất cả chức danh',
      options: jobTitles.map(j => ({ value: j.name, label: j.name })) },
    ...(view === 'matrix' ? [{ key: 'status', label: 'Tình trạng', type: 'single' as const,
      value: status === 'all' ? '' : status, onChange: (v: string) => setAtt({ status: (v || 'all') as 'all' | 'done' | 'missing' }),
      allLabel: 'Tất cả tình trạng',
      options: [{ value: 'done', label: 'Đã chấm đủ' }, { value: 'missing', label: 'Còn thiếu' }] }] : []),
    { key: 'range', label: 'Khoảng ngày', type: 'daterange', from, to, onChange: (ff, tt) => setAtt({ from: ff, to: tt }) },
  ]
  const viewSnapshot = { warehouseId: wh, deptId: dept, jt, q, status, from, to }
  const savedViews = useSavedViewsStore(s => s.views['attendance'] ?? [])
  const activeViewId = savedViews.find(v => JSON.stringify(v.filters) === JSON.stringify(viewSnapshot))?.id ?? null

  function exportExcel() {
    const sheet = filtered.map(r => ({
      'Ngày': formatDate(r.work_date), 'Nhân viên': r.employee?.name ?? '', 'Mã NV': r.employee?.employee_code ?? '',
      'Chức danh': r.employee?.job_title ?? '', 'Loại': KIND_SHORT[r.kind] ?? r.kind,
      'OT (giờ)': r.ot_hours || '', 'Về sớm (giờ)': r.early_leave_hours || '',
    }))
    const ws = XLSX.utils.json_to_sheet(sheet)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Bảng công')
    XLSX.writeFile(wb, `bang_cong_${from}_${to}.xlsx`)
  }

  return (
    <div className="flex flex-col h-full min-h-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <div className="flex rounded-md border border-slate-200 overflow-hidden text-xs font-medium">
          <button onClick={() => setAtt({ view: 'matrix' })} className={`px-2.5 py-1 ${view === 'matrix' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Ma trận</button>
          <button onClick={() => setAtt({ view: 'raw' })} className={`px-2.5 py-1 border-l border-slate-200 ${view === 'raw' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Raw data</button>
        </div>
        <Input value={q} onChange={e => setAtt({ q: e.target.value })} placeholder="Tìm tên / mã NV…" className="h-7 text-xs w-44" />
        <div className="flex-1" />
        <SavedViews module="attendance" currentFilters={viewSnapshot} activeId={activeViewId}
          onApply={(fl) => setAtt(fl as Partial<typeof f>)} />
        <button type="button" onClick={toggleDense}
          className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0"
          title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
          {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
        </button>
        <ActionCluster className="shrink-0" items={[{
          key: 'export', icon: Download, label: 'Xuất Excel', tip: 'Xuất Excel bảng công (raw data)',
          mobileHidden: true, // xuất báo cáo chỉ dùng trên PC
          disabled: !filtered.length,
          onClick: exportExcel,
        } satisfies ActionItem]} />
        <FilterSheetButton defs={defs} className="sm:hidden" />
        <div className="hidden sm:block"><FilterBar defs={defs} /></div>
      </div>

      <SummaryBand className="rounded-lg shrink-0" tiles={[
        { label: 'Số người', value: matrixAll.length },
        { label: 'Tổng công', value: sum.cong, accent: true },
        { label: 'Ngày công', value: sum.workDays },
        { label: 'Giờ OT', value: sum.ot || '—' },
        { label: 'Giờ về sớm', value: sum.early || '—' },
        { label: 'Nghỉ phép', value: sum.leave || '—' },
        { label: 'Lượt thiếu', value: totalMissing || '—', accent: totalMissing > 0 },
      ]} />

      {isLoading ? <p className="text-xs text-slate-400 py-8 text-center">Đang tải…</p>
        : view === 'matrix'
          ? <MatrixTable emps={matrixEmps} dates={dates} isWorkDay={isWorkDay} dense={dense} />
          : <AttTable rows={filtered} onDelete={canEdit ? (id => del.mutate(id)) : undefined} showName dense={dense} />}
    </div>
  )
}

// Ma trận: dòng = người (roster), cột = từng ngày; ô có ca = đã chấm, ô trống ngày làm việc = chưa chấm (đỏ)
function MatrixTable({ emps, dates, isWorkDay, dense }: { emps: MatrixRow[]; dates: string[]; isWorkDay: (ds: string) => boolean; dense: boolean }) {
  const pad = dense ? 'py-0.5' : 'py-1'
  return (
    <div className="flex-1 min-h-0 overflow-auto border border-slate-200 rounded-lg">
      <table className="text-xs min-w-max border-collapse">
        <thead className="bg-slate-50 text-[10px] text-slate-500">
          <tr>
            <th className="text-left px-2 py-1.5 font-medium sticky left-0 top-0 z-30 bg-slate-50 border-r border-slate-200 min-w-[120px]">Nhân viên</th>
            <th className="text-left px-2 py-1.5 font-medium sticky top-0 z-10 bg-slate-50 border-r border-slate-100 min-w-[70px]">Mã NV</th>
            <th className="text-left px-2 py-1.5 font-medium sticky top-0 z-10 bg-slate-50 border-r border-slate-200 min-w-[100px]">Chức danh</th>
            {dates.map(d => (
              <th key={d} className="px-1 py-1 font-medium text-center sticky top-0 z-10 bg-slate-50 border-r border-slate-100 min-w-[42px]">
                <div className="text-[9px] text-slate-400">{dowOf(d)}</div>
                <div className="tabular-nums">{format(new Date(`${d}T00:00:00`), 'dd/MM')}</div>
              </th>
            ))}
            <th className="text-right px-2 py-1.5 font-medium sticky top-0 z-10 bg-slate-50 border-l border-slate-200 min-w-[44px]">Thiếu</th>
            <th className="text-right px-2 py-1.5 font-medium sticky right-0 top-0 z-30 bg-slate-50 border-l border-slate-200">Tổng công</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {emps.length === 0 ? (
            <tr><td colSpan={dates.length + 5} className="text-center text-slate-400 py-6">Không có nhân viên phù hợp</td></tr>
          ) : emps.map(g => (
            <tr key={g.id} className="hover:bg-slate-50/60">
              <td className={`px-2 ${pad} sticky left-0 z-10 bg-white border-r border-slate-200 font-medium text-slate-700 whitespace-nowrap max-w-[160px] truncate`} title={g.name}>{g.name}</td>
              <td className={`px-2 ${pad} font-mono text-slate-500 border-r border-slate-100 whitespace-nowrap`}>{g.code}</td>
              <td className={`px-2 ${pad} text-slate-600 border-r border-slate-200 whitespace-nowrap max-w-[140px] truncate`} title={g.job ?? ''}>{g.job ?? '—'}</td>
              {dates.map(d => {
                const e = g.byDate.get(d)
                if (e) {
                  return (
                    <td key={d} className={`px-1 ${pad} text-center border-r border-slate-100 ${KIND_CELL[e.kind]}`}>
                      <div className="leading-none">
                        <div className="text-[10px] font-medium">{KIND_SHORT[e.kind]}</div>
                        {(e.ot_hours > 0 || e.early_leave_hours > 0) && <div className="text-[8px] text-slate-500">{e.ot_hours > 0 ? `+${e.ot_hours}` : `−${e.early_leave_hours}`}</div>}
                      </div>
                    </td>
                  )
                }
                const missing = isWorkDay(d)
                return (
                  <td key={d} className={`px-1 ${pad} text-center border-r border-slate-100 ${missing ? 'bg-red-50' : ''}`} title={missing ? 'Chưa chấm công' : ''}>
                    <span className={missing ? 'text-red-400' : 'text-slate-300'}>{missing ? '–' : '·'}</span>
                  </td>
                )
              })}
              <td className={`px-2 ${pad} text-right border-l border-slate-200 tabular-nums font-semibold ${g.missingDays.length ? 'text-red-600' : 'text-slate-400'}`}>{g.missingDays.length || '—'}</td>
              <td className={`px-2 ${pad} text-right sticky right-0 z-10 bg-white border-l border-slate-200 font-semibold text-slate-700 tabular-nums`}>{toCong(g.hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AttTable({ rows, onDelete, showName, dense }: { rows: AttendanceRow[]; onDelete?: (id: string) => void; showName: boolean; dense?: boolean }) {
  const pad = dense ? 'py-1' : 'py-1.5'
  return (
    <div className="flex-1 min-h-0 overflow-auto border border-slate-200 rounded-lg">
      <table className="w-full text-xs min-w-max [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <thead className="bg-slate-50 text-[10px] text-slate-500">
          <tr>
            {showName && <th className="text-left px-2 py-2 font-medium sticky left-0 top-0 z-30 bg-slate-50">Nhân viên</th>}
            {showName && <th className="text-left px-2 py-2 font-medium sticky top-0 z-10 bg-slate-50">Mã NV</th>}
            {showName && <th className="text-left px-2 py-2 font-medium sticky top-0 z-10 bg-slate-50">Chức danh</th>}
            <th className="text-left px-2 py-2 font-medium sticky top-0 z-10 bg-slate-50">Ngày</th>
            <th className="text-left px-2 py-2 font-medium sticky top-0 z-10 bg-slate-50">Thứ</th>
            <th className="text-left px-2 py-2 font-medium sticky top-0 z-10 bg-slate-50">Loại</th>
            <th className="text-right px-2 py-2 font-medium sticky top-0 z-10 bg-slate-50">Giờ OT</th>
            <th className="text-right px-2 py-2 font-medium sticky top-0 z-10 bg-slate-50">Về sớm</th>
            <th className="text-right px-2 py-2 font-medium sticky top-0 z-10 bg-slate-50">Tổng giờ</th>
            <th className="text-right px-2 py-2 font-medium sticky top-0 z-10 bg-slate-50">Tổng công</th>
            {onDelete && <th className="px-2 py-2 sticky top-0 z-10 bg-slate-50"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr><td colSpan={showName ? 11 : 8} className="text-center text-slate-400 py-6">Chưa có dữ liệu</td></tr>
          ) : rows.map(r => (
            <tr key={r.id} className="hover:bg-slate-50/60">
              {showName && <td className={`px-2 ${pad} font-medium text-slate-700 sticky left-0 z-10 bg-white max-w-[160px] truncate`} title={r.employee?.name ?? ''}>{r.employee?.name ?? '—'}</td>}
              {showName && <td className={`px-2 ${pad} font-mono text-slate-500`}>{r.employee?.employee_code ?? '—'}</td>}
              {showName && <td className={`px-2 ${pad} text-slate-600 max-w-[140px] truncate`} title={r.employee?.job_title ?? ''}>{r.employee?.job_title ?? '—'}</td>}
              <td className={`px-2 ${pad} tabular-nums`}>{formatDate(r.work_date)}</td>
              <td className={`px-2 ${pad} text-slate-500`}>{dowOf(r.work_date)}</td>
              <td className={`px-2 ${pad}`}><Badge variant={kindVariant(r.kind)}>{kindLabel(r.kind)}</Badge></td>
              <td className={`px-2 ${pad} text-right tabular-nums`}>{r.ot_hours > 0 ? r.ot_hours : '—'}</td>
              <td className={`px-2 ${pad} text-right tabular-nums`}>{r.early_leave_hours > 0 ? r.early_leave_hours : '—'}</td>
              <td className={`px-2 ${pad} text-right tabular-nums text-slate-500`}>{rowTotal(r)}h</td>
              <td className={`px-2 ${pad} text-right tabular-nums font-semibold text-slate-700`}>{toCong(rowTotal(r))}</td>
              {onDelete && <td className={`px-2 ${pad} text-right`}><button onClick={() => onDelete(r.id)} className="text-slate-400 hover:text-red-600 hover:bg-red-50 rounded p-1"><Trash2 className="h-3.5 w-3.5" /></button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
