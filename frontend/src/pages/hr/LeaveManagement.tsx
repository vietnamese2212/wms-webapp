import { useEffect, useState } from 'react'
import { Plus, Check, X, Trash2, CalendarOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import {
  useWarehouses, useDepartments, useEmployeeRecords,
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

const STATUS_META: Record<string, { label: string; variant: 'warning' | 'success' | 'slate' }> = {
  PENDING:  { label: 'Chờ duyệt', variant: 'warning' },
  APPROVED: { label: 'Đã duyệt',  variant: 'success' },
  REJECTED: { label: 'Từ chối',   variant: 'slate' },
}

const SCOPE_KEY = 'hr_leave_scope'

export default function LeaveManagement() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canRequest = can(perms, 'leave', 'request')
  const canApprove = can(perms, 'leave', 'approve')
  const canDelete  = can(perms, 'leave', 'delete')

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: departments = [] } = useDepartments()

  const saved = (() => { try { return JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}') } catch { return {} } })()
  const [wh, setWh]       = useState<string>(saved.wh ?? '')
  const [dept, setDept]   = useState<string>(saved.dept ?? '')
  const [status, setStatus] = useState<string>('')
  const [from, setFrom]   = useState<string>('')
  const [to, setTo]       = useState<string>('')
  useEffect(() => { localStorage.setItem(SCOPE_KEY, JSON.stringify({ wh, dept })) }, [wh, dept])

  const { data: leaves = [], isLoading } = useLeaves(
    { warehouse_id: wh || undefined, department_id: dept || undefined, status: status || undefined, date_from: from || undefined, date_to: to || undefined },
    !!wh,
  )
  const decide = useDecideLeave()
  const del    = useDeleteLeave()
  const [err, setErr] = useState<string | null>(null)
  const [openCreate, setOpenCreate] = useState(false)

  const defs: FilterDef[] = [
    { key: 'status', label: 'Trạng thái', type: 'single', value: status, onChange: setStatus,
      options: [{ value: 'PENDING', label: 'Chờ duyệt' }, { value: 'APPROVED', label: 'Đã duyệt' }, { value: 'REJECTED', label: 'Từ chối' }] },
    { key: 'range', label: 'Khoảng ngày', type: 'daterange', from, to, onChange: (f, t) => { setFrom(f); setTo(t) } },
  ]

  async function onDecide(id: string, s: 'APPROVED' | 'REJECTED') {
    setErr(null)
    try { await decide.mutateAsync({ id, status: s }) } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }
  async function onDelete(l: LeaveRow) {
    if (!confirm(`Xóa đơn nghỉ của ${l.employee?.name ?? ''}?`)) return
    setErr(null)
    try { await del.mutateAsync(l.id) } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Header */}
        <div className="border-b border-slate-200 px-3 py-2.5 sm:rounded-t-xl space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold text-slate-800 mr-1">Nghỉ phép</h1>
            <WarehouseSingleSelect warehouses={warehouses as { id: string; code?: string; name: string }[]} value={wh} onChange={setWh} placeholder="Chọn kho…" triggerClassName="w-40" />
            <select value={dept} onChange={e => setDept(e.target.value)} className="border border-slate-200 rounded-md px-2.5 text-xs h-7 bg-white text-slate-700">
              <option value="">Tất cả phòng</option>
              {(departments as { id: string; name: string }[]).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <div className="flex-1" />
            <FilterSheetButton defs={defs} className="sm:hidden" />
            {canRequest && <Button size="sm" className="h-7" onClick={() => setOpenCreate(true)}><Plus className="h-4 w-4 mr-1" />Gửi đơn nghỉ</Button>}
          </div>
          <FilterBar defs={defs} className="hidden sm:flex" />
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto p-3">
          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-2">{err}</div>}
          {!wh ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2 py-16">
              <CalendarOff className="h-8 w-8" /><p className="text-sm">Chọn <b>Kho</b> để xem đơn nghỉ phép</p>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-xs min-w-max">
                <thead className="bg-slate-50 text-[10px] text-slate-500">
                  <tr>
                    <th className="text-left px-2 py-2 font-medium">Nhân viên</th>
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
                    <tr><td colSpan={8} className="text-center text-slate-400 py-6">Đang tải…</td></tr>
                  ) : leaves.length === 0 ? (
                    <tr><td colSpan={8} className="text-center text-slate-400 py-6">Không có đơn nghỉ</td></tr>
                  ) : leaves.map(l => {
                    const meta = STATUS_META[l.status]
                    return (
                      <tr key={l.id} className="hover:bg-slate-50/60">
                        <td className="px-2 py-1.5">
                          <div className="font-medium text-slate-700">{l.employee?.name ?? '—'}</div>
                          <div className="text-[10px] text-slate-400">{l.employee?.employee_code}</div>
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">{formatDate(l.date_from)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{formatDate(l.date_to)}</td>
                        <td className="px-2 py-1.5">{typeLabel(l.leave_type)}</td>
                        <td className="px-2 py-1.5 max-w-[200px] truncate" title={l.reason ?? ''}>{l.reason || '—'}</td>
                        <td className="px-2 py-1.5"><Badge variant={meta.variant}>{meta.label}</Badge></td>
                        <td className="px-2 py-1.5 text-slate-500">{l.approved_by || '—'}</td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          {canApprove && l.status === 'PENDING' && (
                            <>
                              <button onClick={() => onDecide(l.id, 'APPROVED')} disabled={decide.isPending} title="Duyệt"
                                className="text-green-600 hover:bg-green-50 rounded p-1"><Check className="h-4 w-4" /></button>
                              <button onClick={() => onDecide(l.id, 'REJECTED')} disabled={decide.isPending} title="Từ chối"
                                className="text-red-500 hover:bg-red-50 rounded p-1"><X className="h-4 w-4" /></button>
                            </>
                          )}
                          {canDelete && (
                            <button onClick={() => onDelete(l)} disabled={del.isPending} title="Xóa"
                              className="text-slate-400 hover:text-red-600 hover:bg-red-50 rounded p-1"><Trash2 className="h-3.5 w-3.5" /></button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {openCreate && (
        <CreateLeaveDialog
          wh={wh} dept={dept}
          onClose={() => setOpenCreate(false)}
        />
      )}
    </div>
  )
}

function CreateLeaveDialog({ wh, dept, onClose }: { wh: string; dept: string; onClose: () => void }) {
  const user = useAuthStore(s => s.user)
  const create = useCreateLeave()
  const { data: emps = [] } = useEmployeeRecords(dept ? { department_id: dept } : undefined)

  const [empId, setEmpId]   = useState<string>(user?.id ?? '')
  const [from, setFrom]     = useState<string>(TODAY())
  const [to, setTo]         = useState<string>(TODAY())
  const [ltype, setLtype]   = useState<string>('ANNUAL')
  const [reason, setReason] = useState<string>('')
  const [err, setErr]       = useState<string | null>(null)

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
    } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Gửi đơn nghỉ phép</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
          <div>
            <label className="text-[11px] text-slate-500">Nhân viên</label>
            <select value={empId} onChange={e => setEmpId(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 h-9 text-sm bg-white">
              <option value="">— Chọn nhân viên —</option>
              {(emps as { id: string; name: string; employee_code: string }[]).map(e => (
                <option key={e.id} value={e.id}>{e.name} ({e.employee_code})</option>
              ))}
            </select>
          </div>
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
