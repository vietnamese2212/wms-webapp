import { useState } from 'react'
import * as XLSX from 'xlsx'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeRows } from '@/utils/excelSafe'
import { Plus, Check, X, Trash2, CalendarOff, AlertTriangle, Download, Rows3, AlignJustify } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { FormSheet } from '@/components/shared/FormSheet'
import { Badge } from '@/components/ui/badge'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { ListErrorBanner } from '@/components/shared/ListErrorBanner'
import { SavedViews } from '@/components/shared/SavedViews'
import {
  useDepartments, useEmployeeRecords, useJobTitles,
  useLeaves, useCreateLeave, useDecideLeave, useDeleteLeave,
  type LeaveRow,
} from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate, formatTimestampDate } from '@/utils/formatters'

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
// Dùng làm 1 tab trong trang Chấm công (không bọc card riêng)
export function LeaveSection() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canRequest = can(perms, 'leave', 'request')
  const canApprove = can(perms, 'leave', 'approve')
  const canDelete  = can(perms, 'leave', 'delete')

  const { data: warehouses = [] } = useScopedWarehouses(true)
  const { data: departments = [] } = useDepartments()
  const { data: jobTitles = [] } = useJobTitles()

  // Filter trong store (persist theo user qua scopedPersist)
  const f = useWmsFilterStore(s => s.leave)
  const setLeave = useWmsFilterStore(s => s.setLeave)
  const { warehouseId: wh, deptId: dept, jt, status, from, to } = f
  const [mine, setMine]   = useState(false)   // chờ tôi duyệt (toàn bộ cấp dưới)
  const [direct, setDirect] = useState(false) // chỉ cấp dưới trực tiếp
  const [dense, setDense] = useState(() => localStorage.getItem('leave_density') === '1')
  const toggleDense = () => setDense(d => { localStorage.setItem('leave_density', d ? '0' : '1'); return !d })

  // "Chờ tôi duyệt" BỎ QUA khoảng ngày mặc định: đơn chờ duyệt từ năm trước vẫn phải hiện ra,
  // không được để mặc định "từ đầu năm" giấu mất việc cần làm (tập chờ duyệt vốn nhỏ).
  const { data: leavesRaw = [], isLoading, error: listErr } = useLeaves(
    { warehouse_id: wh || undefined, department_id: dept || undefined, status: status || undefined,
      date_from: mine ? undefined : (from || undefined), date_to: mine ? undefined : (to || undefined),
      to_approve: mine || undefined, direct: (mine && direct) || undefined },
    true,
  )
  const leaves = jt ? leavesRaw.filter(l => l.employee?.job_title === jt) : leavesRaw
  const decide = useDecideLeave()
  const del    = useDeleteLeave()
  const [err, setErr] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [openCreate, setOpenCreate] = useState(false)

  const counts = {
    total: leaves.length,
    pending: leaves.filter(l => l.status === 'PENDING').length,
    approved: leaves.filter(l => l.status === 'APPROVED').length,
    rejected: leaves.filter(l => l.status === 'REJECTED').length,
  }

  const defs: FilterDef[] = [
    { key: 'warehouse', label: 'Kho', type: 'single', value: wh, onChange: v => setLeave({ warehouseId: v }), allLabel: 'Tất cả kho',
      options: (warehouses as { id: string; name: string }[]).map(w => ({ value: w.id, label: w.name })) },
    { key: 'dept', label: 'Phòng ban', type: 'single', value: dept, onChange: v => setLeave({ deptId: v }), allLabel: 'Tất cả phòng',
      options: (departments as { id: string; name: string }[]).map(d => ({ value: d.id, label: d.name })) },
    { key: 'jt', label: 'Chức danh', type: 'single', value: jt, onChange: v => setLeave({ jt: v }), allLabel: 'Tất cả chức danh',
      options: jobTitles.map(j => ({ value: j.name, label: j.name })) },
    { key: 'status', label: 'Trạng thái', type: 'single', value: status, onChange: v => setLeave({ status: v }),
      options: [{ value: 'PENDING', label: 'Chờ duyệt' }, { value: 'APPROVED', label: 'Đã duyệt' }, { value: 'REJECTED', label: 'Từ chối' }] },
    { key: 'range', label: 'Khoảng ngày', type: 'daterange', from, to, onChange: (f2, t2) => setLeave({ from: f2, to: t2 }) },
  ]
  const viewSnapshot = { warehouseId: wh, deptId: dept, jt, status, from, to }
  const savedViews = useSavedViewsStore(s => s.views['leave'] ?? [])
  const activeViewId = savedViews.find(v => JSON.stringify(v.filters) === JSON.stringify(viewSnapshot))?.id ?? null

  function exportExcel() {
    const sheet = leaves.map(l => ({
      'Nhân viên': l.employee?.name ?? '', 'Mã NV': l.employee?.employee_code ?? '',
      'Chức danh': l.employee?.job_title ?? '', 'Từ ngày': formatDate(l.date_from), 'Đến ngày': formatDate(l.date_to),
      'Loại': typeLabel(l.leave_type), 'Lý do': l.reason ?? '',
      'Trạng thái': STATUS_META[l.status]?.label ?? l.status, 'Người duyệt': l.approved_by ?? '',
      'Tạo lúc': l.created_at ? formatTimestampDate(l.created_at, true) : '',
    }))
    const ws = XLSX.utils.json_to_sheet(sanitizeRows(sheet))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Nghỉ phép')
    saveWorkbook(wb, `nghi_phep_${TODAY()}.xlsx`)
  }

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
    <div className="flex flex-col h-full min-h-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2 shrink-0">
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
        {/* Mobile: SavedViews + action GOM 1 hàng (PDA); desktop sm:contents → như cũ */}
        <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
        <SavedViews module="leave" currentFilters={viewSnapshot} activeId={activeViewId}
          onApply={(fl) => setLeave(fl as Partial<typeof f>)} />
        <button type="button" onClick={toggleDense}
          className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0"
          title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
          {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
        </button>
        <FilterSheetButton defs={defs} className="sm:hidden" />
        <ActionCluster className="shrink-0" mobileInline items={[
          // Xuất file chứa LÝ DO nghỉ (dữ liệu cá nhân) → quyền RIÊNG leave.export, không đi ké 'view'
          ...(can(perms, 'leave', 'export') ? [{
            key: 'export', icon: Download, label: 'Xuất Excel', tip: 'Xuất Excel danh sách đơn nghỉ phép',
            mobileHidden: true, // xuất báo cáo chỉ dùng trên PC
            disabled: !leaves.length,
            onClick: exportExcel,
          } satisfies ActionItem] : []),
          ...(canRequest ? [{
            key: 'create', icon: Plus, label: 'Gửi đơn nghỉ', tip: 'Tạo đơn xin nghỉ phép mới',
            primary: true, variant: 'default',
            onClick: () => setOpenCreate(true),
          } satisfies ActionItem] : []),
        ]} />
        </div>
      </div>
      <FilterBar defs={defs} className="hidden sm:flex shrink-0" />

      <ListErrorBanner error={listErr} />
      <SummaryBand className="rounded-lg shrink-0" tiles={[
        { label: 'Tổng đơn', value: counts.total },
        { label: 'Chờ duyệt', value: counts.pending, accent: counts.pending > 0 },
        { label: 'Đã duyệt', value: counts.approved },
        { label: 'Từ chối', value: counts.rejected },
      ]} />

      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 shrink-0">{err}</div>}
      {warn && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-1.5 shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">{warn}</span>
          <button onClick={() => setWarn(null)} className="text-amber-500 hover:text-amber-700"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto border border-slate-200 rounded-lg">
        <table className="w-full text-xs min-w-max [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead className="bg-slate-50 text-[10px] text-slate-500 sticky top-0 z-20">
            <tr>
              <th className="text-left px-2 py-2 font-medium sticky left-0 z-30 bg-slate-50">Nhân viên</th>
              <th className="text-left px-2 py-2 font-medium">Mã NV</th>
              <th className="text-left px-2 py-2 font-medium">Chức danh</th>
              <th className="text-left px-2 py-2 font-medium">Từ ngày</th>
              <th className="text-left px-2 py-2 font-medium">Đến ngày</th>
              <th className="text-left px-2 py-2 font-medium">Loại</th>
              <th className="text-left px-2 py-2 font-medium">Lý do</th>
              <th className="text-left px-2 py-2 font-medium">Trạng thái</th>
              <th className="text-left px-2 py-2 font-medium">Người duyệt</th>
              <th className="text-left px-2 py-2 font-medium">Tạo lúc</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className={`divide-y divide-slate-100 ${dense ? '[&_td]:py-1' : '[&_td]:py-2'}`}>
            {isLoading ? (
              <tr><td colSpan={11} className="text-center text-slate-400 py-6">Đang tải…</td></tr>
            ) : leaves.length === 0 ? (
              <tr><td colSpan={11} className="text-center text-slate-400 py-6">Không có đơn nghỉ</td></tr>
            ) : leaves.map(l => {
              const meta = STATUS_META[l.status]
              return (
                <tr key={l.id} className="hover:bg-slate-50/60">
                  <td className="px-2 font-medium text-slate-700 sticky left-0 z-10 bg-white">{l.employee?.name ?? '—'}</td>
                  <td className="px-2 font-mono text-slate-500">{l.employee?.employee_code ?? '—'}</td>
                  <td className="px-2 text-slate-600">{l.employee?.job_title ?? '—'}</td>
                  <td className="px-2 tabular-nums">{formatDate(l.date_from)}</td>
                  <td className="px-2 tabular-nums">{formatDate(l.date_to)}</td>
                  <td className="px-2">{typeLabel(l.leave_type)}</td>
                  <td className="px-2 max-w-[200px] truncate" title={l.reason ?? ''}>{l.reason || '—'}</td>
                  <td className="px-2"><Badge variant={meta.variant}>{meta.label}</Badge></td>
                  <td className="px-2 text-slate-500">{l.approved_by || '—'}</td>
                  <td className="px-2 text-slate-400 tabular-nums">{l.created_at ? formatTimestampDate(l.created_at, true) : '—'}</td>
                  <td className="px-2 text-right">
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
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  // Chỉ người có quyền DUYỆT (quản lý/HR) mới được nộp hộ cấp dưới → mới hiện ô chọn nhân viên.
  // User thường chỉ nộp cho chính mình.
  const canPickOther = can(perms, 'leave', 'approve')
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
  const selfDup = !!empId && (overlap as LeaveRow[]).some(l => l.employee_id === empId && l.status !== 'REJECTED')   // chính NV đã có đơn trùng → chặn

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
    <FormSheet open onClose={onClose} title="Gửi đơn nghỉ phép" widthClass="sm:max-w-lg" footer={
      <>
        <Button variant="outline" onClick={onClose} className="h-8">Hủy</Button>
        <Button onClick={submit} disabled={create.isPending || selfDup} className="h-8">{create.isPending ? 'Đang gửi…' : 'Gửi đơn'}</Button>
      </>
    }>
      <div className="space-y-3">
          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
          {!fixedEmployeeId && canPickOther && (
            <div>
              <label className="text-[11px] text-slate-500">Nhân viên (cấp dưới)</label>
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

          {/* Chính nhân viên đã có đơn trùng ngày → chặn */}
          {selfDup && (
            <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2.5 py-2 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Nhân viên này đã có đơn nghỉ trùng/chồng ngày — không thể tạo trùng.
            </div>
          )}

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
      </div>
    </FormSheet>
  )
}
