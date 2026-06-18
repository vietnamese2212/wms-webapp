import { useEffect, useState } from 'react'
import { Plus, Check, X, Trash2, CalendarOff, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import {
  useWarehouses, useDepartments, useEmployeeRecords, useJobTitles,
  useLeaves, useCreateLeave, useDecideLeave, useDeleteLeave,
  type LeaveRow,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate } from '@/utils/formatters'

const LEAVE_TYPES: { value: string; label: string }[] = [
  { value: 'ANNUAL', label: 'Phép năm' },
  { value: 'SICK',   label: 'Nghỉ ốm' },
  { value: 'UNPAID', label: 'Không lương' },
  { value: 'OTHER',  label: 'Khác' },
]
const typeLabel = (t: string) => LEAVE_TYPES.find(o => o.value === t)?.label ?? t
const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const KIND_LABEL: Record<string, string> = { CA1: 'Ca 1', CA2: 'Ca 2', CA3: 'Ca 3', HC: 'Hành chính', LEAVE: 'Nghỉ phép' }

const STATUS_META: Record<string, { label: string; variant: 'warning' | 'success' | 'slate' }> = {
  PENDING:  { label: 'Chờ duyệt', variant: 'warning' },
  APPROVED: { label: 'Đã duyệt',  variant: 'success' },
  REJECTED: { label: 'Từ chối',   variant: 'slate' },
}
const SCOPE_KEY = 'hr_leave_scope'

// Dùng làm 1 tab trong trang Chấm công (không bọc card riêng)
export function LeaveSection() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canRequest = can(perms, 'leave', 'request')
  const canApprove = can(perms, 'leave', 'approve')
  const canDelete  = can(perms, 'leave', 'delete')

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: departments = [] } = useDepartments()
  const { data: jobTitles = [] } = useJobTitles()

  const saved = (() => { try { return JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}') } catch { return {} } })()
  const [wh, setWh]       = useState<string>(saved.wh ?? '')
  const [dept, setDept]   = useState<string>(saved.dept ?? '')
  const [jt, setJt]       = useState<string>(saved.jt ?? '')   // lọc theo tên chức danh
  const [status, setStatus] = useState<string>('')
  const [from, setFrom]   = useState<string>('')
  const [to, setTo]       = useState<string>('')
  const [mine, setMine]   = useState(false)   // chờ tôi duyệt (toàn bộ cấp dưới)
  const [direct, setDirect] = useState(false) // chỉ cấp dưới trực tiếp
  useEffect(() => { localStorage.setItem(SCOPE_KEY, JSON.stringify({ wh, dept, jt })) }, [wh, dept, jt])

  const { data: leavesRaw = [], isLoading } = useLeaves(
    { warehouse_id: wh || undefined, department_id: dept || undefined, status: status || undefined, date_from: from || undefined, date_to: to || undefined, to_approve: mine || undefined, direct: (mine && direct) || undefined },
    true,
  )
  const leaves = jt ? leavesRaw.filter(l => l.employee?.job_title === jt) : leavesRaw
  const decide = useDecideLeave()
  const del    = useDeleteLeave()
  const [err, setErr] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [openCreate, setOpenCreate] = useState(false)

  const defs: FilterDef[] = [
    { key: 'status', label: 'Trạng thái', type: 'single', value: status, onChange: setStatus,
      options: [{ value: 'PENDING', label: 'Chờ duyệt' }, { value: 'APPROVED', label: 'Đã duyệt' }, { value: 'REJECTED', label: 'Từ chối' }] },
    { key: 'range', label: 'Khoảng ngày', type: 'daterange', from, to, onChange: (f, t) => { setFrom(f); setTo(t) } },
  ]

  async function onDecide(id: string, s: 'APPROVED' | 'REJECTED') {
    setErr(null); setWarn(null)
    try {
      const r = await decide.mutateAsync({ id, status: s })
      if (s === 'APPROVED' && r.conflicts?.length) {
        const days = r.conflicts.map(c => `${formatDate(c.work_date)} (${KIND_LABEL[c.prev_kind] ?? c.prev_kind})`).join(', ')
        setWarn(`Đã duyệt và ghi đè chấm công thành Nghỉ phép. Trước đó các ngày sau đã chấm công khác: ${days}`)
      }
    }
    catch (e) {
      const ax = e as { response?: { data?: { error?: { message?: string } } } }
      setErr(ax.response?.data?.error?.message ?? String((e as { message?: string })?.message ?? e))
    }
  }
  async function onDelete(l: LeaveRow) {
    if (!confirm(`Xóa đơn nghỉ của ${l.employee?.name ?? ''}?`)) return
    setErr(null)
    try { await del.mutateAsync(l.id) } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <WarehouseSingleSelect warehouses={warehouses as { id: string; code?: string; name: string }[]} value={wh} onChange={setWh} allLabel="Tất cả kho" placeholder="Tất cả kho" triggerClassName="w-40" />
        <select value={dept} onChange={e => setDept(e.target.value)} className="border border-slate-200 rounded-md px-2.5 text-xs h-7 bg-white text-slate-700">
          <option value="">Tất cả phòng</option>
          {(departments as { id: string; name: string }[]).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={jt} onChange={e => setJt(e.target.value)} className="border border-slate-200 rounded-md px-2.5 text-xs h-7 bg-white text-slate-700">
          <option value="">Tất cả chức danh</option>
          {jobTitles.map(j => <option key={j.id} value={j.name}>{j.name}</option>)}
        </select>
        {canApprove && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} className="h-3.5 w-3.5 rounded accent-sky-600" />
            Chờ tôi duyệt
          </label>
        )}
        {canApprove && mine && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={direct} onChange={e => setDirect(e.target.checked)} className="h-3.5 w-3.5 rounded accent-sky-600" />
            Chỉ cấp dưới trực tiếp
          </label>
        )}
        <div className="flex-1" />
        <FilterSheetButton defs={defs} className="sm:hidden" />
        {canRequest && <Button size="sm" className="h-7" onClick={() => setOpenCreate(true)}><Plus className="h-4 w-4 mr-1" />Gửi đơn nghỉ</Button>}
      </div>
      <FilterBar defs={defs} className="hidden sm:flex" />

      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
      {warn && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">{warn}</span>
          <button onClick={() => setWarn(null)} className="text-amber-500 hover:text-amber-700"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <div className="border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-xs min-w-max">
          <thead className="bg-slate-50 text-[10px] text-slate-500">
            <tr>
              <th className="text-left px-2 py-2 font-medium">Nhân viên</th>
              <th className="text-left px-2 py-2 font-medium">Mã NV</th>
              <th className="text-left px-2 py-2 font-medium">Chức danh</th>
              <th className="text-left px-2 py-2 font-medium">Từ ngày</th>
              <th className="text-left px-2 py-2 font-medium">Đến ngày</th>
              <th className="text-left px-2 py-2 font-medium">Loại</th>
              <th className="text-left px-2 py-2 font-medium">Lý do</th>
              <th className="text-left px-2 py-2 font-medium">Trạng thái</th>
              <th className="text-left px-2 py-2 font-medium">Người duyệt</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={10} className="text-center text-slate-400 py-6">Đang tải…</td></tr>
            ) : leaves.length === 0 ? (
              <tr><td colSpan={10} className="text-center text-slate-400 py-6">Không có đơn nghỉ</td></tr>
            ) : leaves.map(l => {
              const meta = STATUS_META[l.status]
              return (
                <tr key={l.id} className="hover:bg-slate-50/60">
                  <td className="px-2 py-1.5 font-medium text-slate-700">{l.employee?.name ?? '—'}</td>
                  <td className="px-2 py-1.5 font-mono text-slate-500">{l.employee?.employee_code ?? '—'}</td>
                  <td className="px-2 py-1.5 text-slate-600">{l.employee?.job_title ?? '—'}</td>
                  <td className="px-2 py-1.5 tabular-nums">{formatDate(l.date_from)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{formatDate(l.date_to)}</td>
                  <td className="px-2 py-1.5">{typeLabel(l.leave_type)}</td>
                  <td className="px-2 py-1.5 max-w-[200px] truncate" title={l.reason ?? ''}>{l.reason || '—'}</td>
                  <td className="px-2 py-1.5"><Badge variant={meta.variant}>{meta.label}</Badge></td>
                  <td className="px-2 py-1.5 text-slate-500">{l.approved_by || '—'}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {canApprove && l.status === 'PENDING' && (
                      <>
                        <button onClick={() => onDecide(l.id, 'APPROVED')} disabled={decide.isPending} title="Duyệt" className="text-green-600 hover:bg-green-50 rounded p-1"><Check className="h-4 w-4" /></button>
                        <button onClick={() => onDecide(l.id, 'REJECTED')} disabled={decide.isPending} title="Từ chối" className="text-red-500 hover:bg-red-50 rounded p-1"><X className="h-4 w-4" /></button>
                      </>
                    )}
                    {canDelete && <button onClick={() => onDelete(l)} disabled={del.isPending} title="Xóa" className="text-slate-400 hover:text-red-600 hover:bg-red-50 rounded p-1"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {openCreate && <CreateLeaveDialog wh={wh} dept={dept} onClose={() => setOpenCreate(false)} />}
    </div>
  )
}

// Trang riêng (nếu truy cập trực tiếp /hr/leaves) — bọc card
export default function LeaveManagement() {
  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b border-slate-200 px-3 py-2.5 sm:rounded-t-xl">
          <h1 className="text-base font-semibold text-slate-800 flex items-center gap-1.5"><CalendarOff className="h-4 w-4" /> Nghỉ phép</h1>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3"><LeaveSection /></div>
      </div>
    </div>
  )
}

export function CreateLeaveDialog({ wh, dept, onClose, fixedEmployeeId }: { wh: string; dept: string; onClose: () => void; fixedEmployeeId?: string }) {
  const user = useAuthStore(s => s.user)
  const create = useCreateLeave()
  const { data: emps = [] } = useEmployeeRecords(dept ? { department_id: dept } : undefined)

  const [empId, setEmpId]   = useState<string>(fixedEmployeeId ?? user?.id ?? '')
  const [from, setFrom]     = useState<string>(TODAY())
  const [to, setTo]         = useState<string>(TODAY())
  const [ltype, setLtype]   = useState<string>('ANNUAL')
  const [reason, setReason] = useState<string>('')
  const [err, setErr]       = useState<string | null>(null)

  // Ai đang xin nghỉ cùng Kho + Bộ phận trong khoảng ngày đã chọn (tránh trùng quá nhiều)
  const { data: overlap = [] } = useLeaves(
    { warehouse_id: wh || undefined, department_id: dept || undefined, date_from: from, date_to: to },
    !!(wh && dept && from && to),
  )
  const conflicts = (overlap as LeaveRow[]).filter(l => l.employee_id !== empId && l.status !== 'REJECTED')

  async function submit() {
    setErr(null)
    if (!empId) { setErr('Chọn nhân viên'); return }
    if (to < from) { setErr('Đến ngày phải >= Từ ngày'); return }
    try {
      await create.mutateAsync({
        employee_id: empId, warehouse_id: wh || user?.warehouse_id || undefined,
        date_from: from, date_to: to, leave_type: ltype, reason: reason || undefined,
      })
      onClose()
    } catch (e) {
      const ax = e as { response?: { data?: { error?: { message?: string } } } }
      setErr(ax.response?.data?.error?.message ?? String((e as { message?: string })?.message ?? e))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Gửi đơn nghỉ phép</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
          {!fixedEmployeeId && (
            <div>
              <label className="text-[11px] text-slate-500">Nhân viên</label>
              <select value={empId} onChange={e => setEmpId(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 h-9 text-sm bg-white">
                <option value="">— Chọn nhân viên —</option>
                {(emps as { id: string; name: string; employee_code: string }[]).map(e => (
                  <option key={e.id} value={e.id}>{e.name} ({e.employee_code})</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-500">Từ ngày</label>
              <Input type="date" value={from} min={TODAY()} onChange={e => setFrom(e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Đến ngày</label>
              <Input type="date" value={to} min={TODAY()} onChange={e => setTo(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>

          {/* Cảnh báo trùng nghỉ cùng kho + bộ phận */}
          {conflicts.length > 0 && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-2">
              <div className="flex items-center gap-1 font-medium mb-1"><AlertTriangle className="h-3.5 w-3.5" /> Cùng kho/bộ phận đang nghỉ trùng ngày ({conflicts.length}):</div>
              <ul className="space-y-0.5">
                {conflicts.slice(0, 6).map(c => (
                  <li key={c.id}>• {c.employee?.name} — {formatDate(c.date_from)}–{formatDate(c.date_to)} <span className="text-amber-500">({c.status === 'PENDING' ? 'chờ duyệt' : 'đã duyệt'})</span></li>
                ))}
                {conflicts.length > 6 && <li>… và {conflicts.length - 6} người khác</li>}
              </ul>
            </div>
          )}

          <div>
            <label className="text-[11px] text-slate-500">Loại nghỉ</label>
            <select value={ltype} onChange={e => setLtype(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 h-9 text-sm bg-white">
              {LEAVE_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-slate-500">Lý do</label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="(không bắt buộc)" className="h-9 text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="h-8">Hủy</Button>
            <Button onClick={submit} disabled={create.isPending} className="h-8">{create.isPending ? 'Đang gửi…' : 'Gửi đơn'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
