import { useEffect, useMemo, useState } from 'react'
import { Plus, Wand2, Printer, Send, Trash2, AlertTriangle, CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import {
  useWarehouses, useDepartments,
  useSheets, useSheet, useUpsertSheet, useAutoAssign, useAssignOne, usePublishSheet, useDeleteSheet,
  type SheetDetail,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate } from '@/utils/formatters'

const SHIFT_LABEL: Record<string, string> = { CA1: 'Ca 1', CA2: 'Ca 2', CA3: 'Ca 3', HC: 'HC' }
const shiftOf = (t: string | null) => (t ? SHIFT_LABEL[t] ?? t : '')
const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const SCOPE_KEY = 'hr_assign_scope'

// nhãn "Vị trí phân công" kiểu Manhattan: {Phòng}_{Ca}_{Vị trí}
function positionLabel(deptName: string, skillName: string, shiftTag: string | null) {
  const parts = [deptName, shiftOf(shiftTag), skillName].filter(Boolean)
  return parts.join('_')
}

export default function Assignments() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canCreate  = can(perms, 'work_assignment', 'create')
  const canEdit    = can(perms, 'work_assignment', 'edit')
  const canPublish = can(perms, 'work_assignment', 'publish')
  const canDelete  = can(perms, 'work_assignment', 'delete')

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: departments = [] } = useDepartments()

  const saved = (() => { try { return JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}') } catch { return {} } })()
  const [wh, setWh]     = useState<string>(saved.wh ?? '')
  const [dept, setDept] = useState<string>(saved.dept ?? '')
  const [date, setDate] = useState<string>(TODAY())
  useEffect(() => { localStorage.setItem(SCOPE_KEY, JSON.stringify({ wh, dept })) }, [wh, dept])
  const scopeReady = !!(wh && dept && date)

  // tìm phiếu của ngày này
  const { data: sheets = [], isLoading: sheetsLoading } = useSheets(
    { warehouse_id: wh || undefined, department_id: dept || undefined, date_from: date, date_to: date },
    scopeReady,
  )
  const dayRow = sheets[0]
  const { data: sheet } = useSheet(dayRow?.id)

  const upsert = useUpsertSheet()
  const [creating, setCreating] = useState(false)
  async function createSheet() {
    if (!scopeReady) return
    setCreating(true)
    try { await upsert.mutateAsync({ warehouse_id: wh, department_id: dept, work_date: date }) }
    finally { setCreating(false) }
  }

  const deptName = (departments as { id: string; name: string }[]).find(d => d.id === dept)?.name ?? ''

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Header / scope */}
        <div className="border-b border-slate-200 px-3 py-2.5 sm:rounded-t-xl">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold text-slate-800 mr-1">Phân công lịch làm việc</h1>
            <WarehouseSingleSelect warehouses={warehouses as { id: string; code?: string; name: string }[]} value={wh} onChange={setWh} placeholder="Chọn kho…" triggerClassName="w-40" />
            <select value={dept} onChange={e => setDept(e.target.value)} className="border border-slate-200 rounded-md px-2.5 text-xs h-7 bg-white text-slate-700">
              <option value="">Chọn bộ phận…</option>
              {(departments as { id: string; name: string; requires_scheduling?: boolean }[]).map(d => (
                <option key={d.id} value={d.id}>{d.name}{d.requires_scheduling ? ' ✓' : ''}</option>
              ))}
            </select>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-7 w-36 text-xs" />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto p-3">
          {!scopeReady ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2 py-16">
              <CalendarDays className="h-8 w-8" /><p className="text-sm">Chọn <b>Kho</b>, <b>Bộ phận</b> và <b>Ngày</b> để bắt đầu</p>
            </div>
          ) : sheetsLoading ? (
            <p className="text-xs text-slate-400 py-8 text-center">Đang tải…</p>
          ) : !dayRow ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 py-16">
              <p className="text-sm">Chưa có phiếu phân công cho <b>{formatDate(date)}</b></p>
              {canCreate && <Button onClick={createSheet} disabled={creating}><Plus className="h-4 w-4 mr-1" />Tạo phiếu ngày này</Button>}
            </div>
          ) : sheet ? (
            <SheetEditor
              sheet={sheet} deptName={deptName}
              warehouses={warehouses as { id: string; name: string }[]}
              canCreate={canCreate} canEdit={canEdit} canPublish={canPublish} canDelete={canDelete}
              onDeleted={() => { /* list refetch via realtime/invalidate */ }}
            />
          ) : (
            <p className="text-xs text-slate-400 py-8 text-center">Đang tải phiếu…</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Editor 1 phiếu ─────────────────────────────────────────────────────────
function SheetEditor({ sheet, deptName, warehouses, canCreate, canEdit, canPublish, canDelete, onDeleted }: {
  sheet: SheetDetail; deptName: string; warehouses: { id: string; name: string }[]
  canCreate: boolean; canEdit: boolean; canPublish: boolean; canDelete: boolean; onDeleted: () => void
}) {
  const upsert = useUpsertSheet()
  const auto   = useAutoAssign()
  const assignOne = useAssignOne()
  const publish = usePublishSheet()
  const del = useDeleteSheet()
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ assigned: number; on_leave: number; shortfalls: { skill_id: string; required: number; short: number }[] } | null>(null)

  const published = sheet.status === 'PUBLISHED'
  const skillName = (id: string | null) => sheet.skills.find(s => s.id === id)?.name ?? '—'
  const skillShift = (id: string | null) => sheet.skills.find(s => s.id === id)?.shift_tag ?? null
  const whName = warehouses.find(w => w.id === sheet.warehouse_id)?.name ?? ''

  // ── demand editor (local) ──
  const [demands, setDemands] = useState<Record<string, number>>({})
  useEffect(() => {
    const d: Record<string, number> = {}
    for (const dm of sheet.demands) d[dm.skill_id] = dm.required_count
    setDemands(d)
  }, [sheet.id, sheet.demands])

  const totalRequired = useMemo(() => Object.values(demands).reduce((a, b) => a + (b || 0), 0), [demands])

  async function saveDemands() {
    setErr(null)
    const list = Object.entries(demands).filter(([, n]) => n > 0).map(([skill_id, required_count]) => ({ skill_id, required_count }))
    try { await upsert.mutateAsync({ warehouse_id: sheet.warehouse_id, department_id: sheet.department_id, work_date: sheet.work_date, demands: list }) }
    catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }
  async function runAuto() {
    setErr(null); setResult(null)
    try {
      // lưu demand trước rồi tự xếp
      const list = Object.entries(demands).filter(([, n]) => n > 0).map(([skill_id, required_count]) => ({ skill_id, required_count }))
      await upsert.mutateAsync({ warehouse_id: sheet.warehouse_id, department_id: sheet.department_id, work_date: sheet.work_date, demands: list })
      const r = await auto.mutateAsync(sheet.id)
      setResult(r)
    } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }
  async function changePos(employee_id: string, skill_id: string | null) {
    setErr(null)
    try { await assignOne.mutateAsync({ sheet_id: sheet.id, employee_id, skill_id }) }
    catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }
  async function onDelete() {
    if (!confirm('Xóa phiếu phân công này?')) return
    try { await del.mutateAsync(sheet.id); onDeleted() } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  // ── sắp xếp dòng kết quả: theo vị trí (sort_order), rồi nghỉ phép, chưa phân ──
  const sortedAsg = useMemo(() => {
    const order = new Map(sheet.skills.map((s, i) => [s.id, i]))
    const rank = (a: SheetDetail['assignments'][number]) =>
      a.status === 'ASSIGNED' ? (order.get(a.skill_id ?? '') ?? 999)
      : a.status === 'UNASSIGNED' ? 10000 : 20000
    return [...sheet.assignments].sort((x, y) => rank(x) - rank(y) || (x.employee?.name ?? '').localeCompare(y.employee?.name ?? ''))
  }, [sheet.assignments, sheet.skills])

  const hasResult = sheet.assignments.length > 0

  return (
    <div className="space-y-3 max-w-5xl">
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

      {/* Thanh trạng thái + action */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={published ? 'success' : 'warning'}>{published ? 'Đã phát hành' : 'Nháp'}</Badge>
        <span className="text-xs text-slate-500">Yêu cầu: <b className="text-slate-700">{totalRequired}</b> · Đã xếp: <b className="text-slate-700">{sheet.assignments.filter(a => a.status === 'ASSIGNED').length}</b></span>
        <div className="flex-1" />
        {canCreate && <Button size="sm" variant="outline" className="h-7" onClick={saveDemands} disabled={upsert.isPending}>Lưu yêu cầu</Button>}
        {canCreate && <Button size="sm" className="h-7" onClick={runAuto} disabled={auto.isPending || totalRequired === 0}><Wand2 className="h-3.5 w-3.5 mr-1" />{auto.isPending ? 'Đang xếp…' : 'Tự xếp người'}</Button>}
        {hasResult && <Button size="sm" variant="outline" className="h-7" onClick={() => window.print()}><Printer className="h-3.5 w-3.5 mr-1" />In bảng</Button>}
        {canPublish && <Button size="sm" variant={published ? 'outline' : 'default'} className="h-7" onClick={() => publish.mutate({ id: sheet.id, publish: !published })} disabled={publish.isPending}>
          <Send className="h-3.5 w-3.5 mr-1" />{published ? 'Thu hồi' : 'Phát hành'}</Button>}
        {canDelete && <Button size="sm" variant="outline" className="h-7 text-red-600" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>

      {/* Cảnh báo thiếu người */}
      {result && result.shortfalls.length > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>Thiếu người ở: {result.shortfalls.map(s => `${skillName(s.skill_id)} (thiếu ${s.short})`).join(', ')}</div>
        </div>
      )}
      {result && result.on_leave > 0 && <p className="text-[11px] text-slate-500">Đã loại {result.on_leave} người nghỉ phép.</p>}

      {/* Yêu cầu nhân lực (demand) */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-100 border-b border-slate-200 px-3 py-1.5 flex items-center gap-2">
          <span className="w-1 h-3.5 bg-sky-500 rounded-full" />
          <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Yêu cầu nhân lực theo vị trí</span>
        </div>
        {sheet.skills.length === 0 ? (
          <p className="text-xs text-slate-400 p-3">Bộ phận/kho này chưa có vị trí — thêm ở trang "Vị trí &amp; Skill".</p>
        ) : (
          <div className="p-2 flex flex-wrap gap-2">
            {sheet.skills.map(s => (
              <div key={s.id} className="flex items-center gap-1.5 border border-slate-200 rounded-md px-2 py-1 bg-white">
                <span className="text-xs text-slate-600">{s.name}{s.shift_tag && <span className="text-[10px] text-slate-400 ml-1">{shiftOf(s.shift_tag)}</span>}</span>
                <input type="number" min={0} max={99} value={demands[s.id] || ''} placeholder="0"
                  disabled={!canCreate}
                  onChange={e => setDemands(prev => ({ ...prev, [s.id]: Math.max(0, Number(e.target.value) || 0) }))}
                  className="w-12 h-6 text-center text-xs rounded border border-slate-200 focus:border-sky-500 outline-none disabled:bg-slate-50" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Kết quả phân công */}
      {hasResult && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-100 border-b border-slate-200 px-3 py-1.5 flex items-center gap-2">
            <span className="w-1 h-3.5 bg-sky-500 rounded-full" />
            <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Kết quả phân công</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-max">
              <thead className="bg-slate-50 text-[10px] text-slate-500">
                <tr>
                  <th className="text-left px-2 py-2 font-medium w-10">STT</th>
                  <th className="text-left px-2 py-2 font-medium">Họ và tên</th>
                  <th className="text-left px-2 py-2 font-medium">Chức danh</th>
                  <th className="text-left px-2 py-2 font-medium">Vị trí phân công</th>
                  <th className="text-left px-2 py-2 font-medium w-24">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedAsg.map((a, i) => (
                  <tr key={a.id} className={a.status === 'LEAVE' ? 'text-red-600' : a.status === 'UNASSIGNED' ? 'text-slate-400' : ''}>
                    <td className="px-2 py-1.5 tabular-nums">{i + 1}</td>
                    <td className="px-2 py-1.5 font-medium">{a.employee?.name ?? '—'}<span className="text-[10px] text-slate-400 ml-1">{a.employee?.employee_code}</span></td>
                    <td className="px-2 py-1.5">{a.employee?.job_title ?? '—'}</td>
                    <td className="px-2 py-1.5">
                      {a.status === 'LEAVE' ? (
                        <span className="italic">Nghỉ phép</span>
                      ) : canEdit ? (
                        <select value={a.skill_id ?? ''} onChange={e => changePos(a.employee_id, e.target.value || null)}
                          className="border border-slate-200 rounded px-1.5 py-0.5 text-xs bg-white max-w-[220px]">
                          <option value="">— Chưa phân —</option>
                          {sheet.skills.map(s => <option key={s.id} value={s.id}>{positionLabel(deptName, s.name, s.shift_tag)}</option>)}
                        </select>
                      ) : (
                        a.skill_id ? positionLabel(deptName, skillName(a.skill_id), skillShift(a.skill_id)) : '— Chưa phân —'
                      )}
                      {a.is_manual && a.status === 'ASSIGNED' && <span className="text-[9px] text-sky-500 ml-1">(tay)</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {a.status === 'ASSIGNED' ? <Badge variant="info">Đã xếp</Badge>
                        : a.status === 'LEAVE' ? <Badge variant="slate">Nghỉ phép</Badge>
                        : <Badge variant="warning">Chưa phân</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Vùng in (ẩn trên màn hình) */}
      {hasResult && <PrintArea sheet={sheet} deptName={deptName} whName={whName} skillName={skillName} skillShift={skillShift} sortedAsg={sortedAsg} />}
    </div>
  )
}

// ─── Bảng in: BẢNG PHÂN CÔNG LỊCH LÀM VIỆC CHI TIẾT ─────────────────────────
function PrintArea({ sheet, deptName, whName, skillName, skillShift, sortedAsg }: {
  sheet: SheetDetail; deptName: string; whName: string
  skillName: (id: string | null) => string; skillShift: (id: string | null) => string | null
  sortedAsg: SheetDetail['assignments']
}) {
  return (
    <>
      <style>{`
        .hr-print-area { position: absolute; left: -99999px; top: 0; }
        @media print {
          body * { visibility: hidden; }
          .hr-print-area, .hr-print-area * { visibility: visible; }
          .hr-print-area { position: absolute; left: 0 !important; top: 0; width: 100%; padding: 16px; }
          @page { size: A4 portrait; margin: 12mm; }
        }
        .hr-print-area table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .hr-print-area th, .hr-print-area td { border: 1px solid #555; padding: 4px 8px; text-align: left; }
        .hr-print-area thead th { background: #1e293b; color: #fff; }
      `}</style>
      <div className="hr-print-area">
        <h2 style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, margin: 0 }}>BẢNG PHÂN CÔNG LỊCH LÀM VIỆC CHI TIẾT</h2>
        <p style={{ textAlign: 'center', fontSize: 12, margin: '4px 0 2px' }}><b>Ngày: {formatDate(sheet.work_date)}</b> &nbsp;|&nbsp; <b>Bộ phận: {deptName}</b></p>
        <p style={{ textAlign: 'center', fontSize: 12, margin: '0 0 10px' }}>Kho: {whName}</p>
        <table>
          <thead>
            <tr><th style={{ width: 36 }}>STT</th><th>Họ và Tên</th><th>Chức danh</th><th>Vị trí phân công</th><th style={{ width: 120 }}>Note</th></tr>
          </thead>
          <tbody>
            {sortedAsg.map((a, i) => (
              <tr key={a.id}>
                <td>{i + 1}</td>
                <td>{a.employee?.name ?? '—'}</td>
                <td>{a.employee?.job_title ?? '—'}</td>
                <td>{a.status === 'LEAVE' ? 'Nghỉ phép'
                  : a.skill_id ? positionLabel(deptName, skillName(a.skill_id), skillShift(a.skill_id))
                  : 'Chưa phân công'}</td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
