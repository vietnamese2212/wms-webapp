import { useState } from 'react'
import { Clock, Save, Trash2, CalendarCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import {
  useWarehouses, useDepartments,
  useAttendance, useUpsertAttendance, useDeleteAttendance, type AttendanceRow,
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

export default function Attendance() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canSelf = can(perms, 'attendance', 'self_log')
  const canView = can(perms, 'attendance', 'view')

  const [tab, setTab] = useState<'me' | 'team'>(canSelf ? 'me' : 'team')

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b border-slate-200 px-3 py-2.5 sm:rounded-t-xl flex items-center gap-3">
          <h1 className="text-base font-semibold text-slate-800">Chấm công</h1>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
            {canSelf && <button onClick={() => setTab('me')} className={`px-3 py-1.5 ${tab === 'me' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Của tôi</button>}
            {canView && <button onClick={() => setTab('team')} className={`px-3 py-1.5 border-l border-slate-200 ${tab === 'team' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Bảng công</button>}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3">
          {tab === 'me' && canSelf ? <MySection /> : canView ? <TeamSection perms={perms} /> : <p className="text-sm text-slate-400 text-center py-16">Không có quyền.</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Của tôi ────────────────────────────────────────────────────────────────
function MySection() {
  const user = useAuthStore(s => s.user)
  const upsert = useUpsertAttendance()
  const del = useDeleteAttendance()
  const { data: rows = [] } = useAttendance({ employee_id: user?.id, date_from: MONTH_START(), date_to: TODAY() }, !!user?.id)

  const [date, setDate]   = useState(TODAY())
  const [kind, setKind]   = useState('CA1')
  const [ot, setOt]       = useState(0)
  const [early, setEarly] = useState(0)
  const [err, setErr]     = useState<string | null>(null)

  async function save() {
    setErr(null)
    try {
      await upsert.mutateAsync({ employee_id: user?.id, warehouse_id: user?.warehouse_id, work_date: date, kind, ot_hours: ot, early_leave_hours: early })
    } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  return (
    <div className="max-w-2xl space-y-3">
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
      <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50 space-y-2">
        <p className="text-xs font-medium text-slate-600 flex items-center gap-1"><CalendarCheck className="h-3.5 w-3.5" /> Chấm công ngày</p>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="text-[11px] text-slate-500">Ngày</label><Input type="date" value={date} max={TODAY()} onChange={e => setDate(e.target.value)} className="h-8 text-sm w-36" /></div>
          <div><label className="text-[11px] text-slate-500">Loại</label>
            <select value={kind} onChange={e => setKind(e.target.value)} className="border border-slate-200 rounded-md px-2 h-8 text-sm bg-white block">
              {KINDS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div><label className="text-[11px] text-slate-500">Giờ OT</label><Input type="number" min={0} step={0.5} value={ot || ''} onChange={e => setOt(Number(e.target.value) || 0)} className="h-8 text-sm w-20" /></div>
          <div><label className="text-[11px] text-slate-500">Giờ về sớm</label><Input type="number" min={0} step={0.5} value={early || ''} onChange={e => setEarly(Number(e.target.value) || 0)} className="h-8 text-sm w-20" /></div>
          <Button onClick={save} disabled={upsert.isPending} className="h-8"><Save className="h-4 w-4 mr-1" />Lưu</Button>
        </div>
      </div>

      <p className="text-[11px] text-slate-500">Chấm công tháng này</p>
      <AttTable rows={rows} onDelete={id => del.mutate(id)} showName={false} />
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
    !!wh,
  )
  const defs: FilterDef[] = [
    { key: 'range', label: 'Khoảng ngày', type: 'daterange', from, to, onChange: (f, t) => { setFrom(f); setTo(t) } },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <WarehouseSingleSelect warehouses={warehouses as { id: string; code?: string; name: string }[]} value={wh} onChange={setWh} placeholder="Chọn kho…" triggerClassName="w-40" />
        <select value={dept} onChange={e => setDept(e.target.value)} className="border border-slate-200 rounded-md px-2.5 text-xs h-7 bg-white text-slate-700">
          <option value="">Tất cả phòng</option>
          {(departments as { id: string; name: string }[]).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="flex-1" />
        <FilterSheetButton defs={defs} className="sm:hidden" />
        <div className="hidden sm:block"><FilterBar defs={defs} /></div>
      </div>
      {!wh ? (
        <div className="flex flex-col items-center justify-center text-slate-400 gap-2 py-16"><Clock className="h-8 w-8" /><p className="text-sm">Chọn <b>Kho</b> để xem bảng công</p></div>
      ) : isLoading ? <p className="text-xs text-slate-400 py-8 text-center">Đang tải…</p>
      : <AttTable rows={rows} onDelete={canEdit ? (id => del.mutate(id)) : undefined} showName />}
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
