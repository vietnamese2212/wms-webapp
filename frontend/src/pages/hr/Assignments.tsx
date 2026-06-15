import { useEffect, useMemo, useState } from 'react'
import { Plus, Wand2, Printer, Send, Trash2, AlertTriangle, CalendarDays, Pencil, Save, X, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import {
  useWarehouses,
  useSheets, useSheet, useUpsertSheet, useAutoAssign, useAssignOne, usePublishSheet, useDeleteSheet,
  useLayouts, useLayout, useCreateLayout, useUpdateLayout, useDeleteLayout, useSetLayoutSkills, useSkills,
  type SheetDetail, type LayoutRow,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate } from '@/utils/formatters'

const SHIFT_LABEL: Record<string, string> = { CA1: 'Ca 1', CA2: 'Ca 2', CA3: 'Ca 3', HC: 'HC' }
const shiftOf = (t: string | null) => (t ? SHIFT_LABEL[t] ?? t : '')
const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const SCOPE_KEY = 'hr_assign_scope'

// nhãn "Vị trí phân công": {Chức danh}_{Ca}_{Vị trí}  →  "Lái xe nâng_HC_Pallet"
function positionLabel(jobTitle: string | null, skillName: string, shiftTag: string | null) {
  return [jobTitle, shiftOf(shiftTag), skillName].filter(Boolean).join('_')
}

export default function Assignments() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canCreate = can(perms, 'work_assignment', 'create')

  const [tab, setTab] = useState<'daily' | 'layout'>('daily')

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b border-slate-200 px-3 py-2.5 sm:rounded-t-xl flex items-center gap-3">
          <h1 className="text-base font-semibold text-slate-800">Phân công lịch làm việc</h1>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
            <button onClick={() => setTab('daily')} className={`px-3 py-1.5 ${tab === 'daily' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Phân công</button>
            <button onClick={() => setTab('layout')} className={`px-3 py-1.5 border-l border-slate-200 ${tab === 'layout' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Layout</button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {tab === 'daily' ? <DailyTab canCreate={canCreate} perms={perms} /> : <LayoutTab canCreate={canCreate} />}
        </div>
      </div>
    </div>
  )
}

// ════════ TAB PHÂN CÔNG (theo Kho + Layout + Ngày) ════════
function DailyTab({ canCreate, perms }: { canCreate: boolean; perms: ModulePermissions | null }) {
  const { data: warehouses = [] } = useWarehouses(true)
  const saved = (() => { try { return JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}') } catch { return {} } })()
  const [wh, setWh]         = useState<string>(saved.wh ?? '')
  const [layoutId, setLayoutId] = useState<string>(saved.layout ?? '')
  const [date, setDate]     = useState<string>(TODAY())
  useEffect(() => { localStorage.setItem(SCOPE_KEY, JSON.stringify({ wh, layout: layoutId })) }, [wh, layoutId])

  const { data: layouts = [] } = useLayouts(wh || undefined)
  // reset layout nếu đổi kho mà layout không thuộc kho
  useEffect(() => { if (layoutId && !layouts.some(l => l.id === layoutId)) setLayoutId('') }, [layouts, layoutId])

  const scopeReady = !!(wh && layoutId && date)
  const { data: sheets = [], isLoading: sheetsLoading } = useSheets({ layout_id: layoutId || undefined, date_from: date, date_to: date }, scopeReady)
  const dayRow = sheets[0]
  const { data: sheet } = useSheet(dayRow?.id)
  const upsert = useUpsertSheet()
  const [creating, setCreating] = useState(false)

  async function createSheet() {
    if (!scopeReady) return
    setCreating(true)
    try { await upsert.mutateAsync({ layout_id: layoutId, work_date: date }) } finally { setCreating(false) }
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <WarehouseSingleSelect warehouses={warehouses as { id: string; code?: string; name: string }[]} value={wh} onChange={setWh} placeholder="Chọn kho…" triggerClassName="w-40" />
        <select value={layoutId} onChange={e => setLayoutId(e.target.value)} disabled={!wh} className="border border-slate-200 rounded-md px-2.5 text-xs h-7 bg-white text-slate-700 disabled:opacity-50">
          <option value="">{wh ? 'Chọn layout…' : 'Chọn kho trước'}</option>
          {layouts.map(l => <option key={l.id} value={l.id}>{l.name} ({l.people} người)</option>)}
        </select>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-7 w-36 text-xs" />
      </div>

      {!scopeReady ? (
        <div className="flex flex-col items-center justify-center text-slate-400 gap-2 py-16">
          <CalendarDays className="h-8 w-8" /><p className="text-sm">Chọn <b>Kho</b>, <b>Layout</b> và <b>Ngày</b> để bắt đầu</p>
          {wh && layouts.length === 0 && <p className="text-xs">Kho này chưa có layout — tạo ở tab <b>Layout</b>.</p>}
        </div>
      ) : sheetsLoading ? (
        <p className="text-xs text-slate-400 py-8 text-center">Đang tải…</p>
      ) : !dayRow ? (
        <div className="flex flex-col items-center justify-center text-slate-400 gap-3 py-16">
          <p className="text-sm">Chưa có phiếu cho <b>{formatDate(date)}</b></p>
          {canCreate && <Button onClick={createSheet} disabled={creating}><Plus className="h-4 w-4 mr-1" />Tạo phiếu (đổ vị trí từ layout)</Button>}
        </div>
      ) : sheet ? (
        <SheetEditor sheet={sheet} warehouses={warehouses as { id: string; name: string }[]} perms={perms} />
      ) : <p className="text-xs text-slate-400 py-8 text-center">Đang tải phiếu…</p>}
    </div>
  )
}

// ─── Editor 1 phiếu ─────────────────────────────────────────────────────────
function SheetEditor({ sheet, warehouses, perms }: { sheet: SheetDetail; warehouses: { id: string; name: string }[]; perms: ModulePermissions | null }) {
  const canCreate  = can(perms, 'work_assignment', 'create')
  const canEdit    = can(perms, 'work_assignment', 'edit')
  const canPublish = can(perms, 'work_assignment', 'publish')
  const canDelete  = can(perms, 'work_assignment', 'delete')

  const upsert = useUpsertSheet()
  const auto   = useAutoAssign()
  const assignOne = useAssignOne()
  const publish = usePublishSheet()
  const del = useDeleteSheet()
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ assigned: number; on_leave: number; shortfalls: { skill_id: string; required: number; short: number }[] } | null>(null)

  const published = sheet.status === 'PUBLISHED'
  const skillById = useMemo(() => new Map(sheet.skills.map(s => [s.id, s])), [sheet.skills])
  const skillName  = (id: string | null) => (id ? skillById.get(id)?.name ?? '—' : '—')
  const labelOf = (id: string | null) => { const s = id ? skillById.get(id) : null; return s ? positionLabel(s.job_title, s.name, s.shift_tag) : '— Chưa phân —' }
  const whName = warehouses.find(w => w.id === sheet.warehouse_id)?.name ?? ''

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
    try { await upsert.mutateAsync({ layout_id: sheet.layout_id!, work_date: sheet.work_date, demands: list }) }
    catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }
  async function runAuto() {
    setErr(null); setResult(null)
    try {
      const list = Object.entries(demands).filter(([, n]) => n > 0).map(([skill_id, required_count]) => ({ skill_id, required_count }))
      await upsert.mutateAsync({ layout_id: sheet.layout_id!, work_date: sheet.work_date, demands: list })
      setResult(await auto.mutateAsync(sheet.id))
    } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }
  async function changePos(employee_id: string, skill_id: string | null) {
    setErr(null)
    try { await assignOne.mutateAsync({ sheet_id: sheet.id, employee_id, skill_id }) } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }
  async function onDelete() {
    if (!confirm('Xóa phiếu phân công này?')) return
    try { await del.mutateAsync(sheet.id) } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  const sortedAsg = useMemo(() => {
    const order = new Map(sheet.skills.map((s, i) => [s.id, i]))
    const rank = (a: SheetDetail['assignments'][number]) =>
      a.status === 'ASSIGNED' ? (order.get(a.skill_id ?? '') ?? 999) : a.status === 'UNASSIGNED' ? 10000 : 20000
    return [...sheet.assignments].sort((x, y) => rank(x) - rank(y) || (x.employee?.name ?? '').localeCompare(y.employee?.name ?? ''))
  }, [sheet.assignments, sheet.skills])
  const hasResult = sheet.assignments.length > 0

  return (
    <div className="space-y-3 max-w-5xl">
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={published ? 'success' : 'warning'}>{published ? 'Đã phát hành' : 'Nháp'}</Badge>
        <span className="text-sm font-medium text-slate-700">{sheet.layout_name}</span>
        <span className="text-xs text-slate-500">· Yêu cầu <b className="text-slate-700">{totalRequired}</b> · Đã xếp <b className="text-slate-700">{sheet.assignments.filter(a => a.status === 'ASSIGNED').length}</b></span>
        <div className="flex-1" />
        {canCreate && <Button size="sm" variant="outline" className="h-7" onClick={saveDemands} disabled={upsert.isPending}>Lưu yêu cầu</Button>}
        {canCreate && <Button size="sm" className="h-7" onClick={runAuto} disabled={auto.isPending || totalRequired === 0}><Wand2 className="h-3.5 w-3.5 mr-1" />{auto.isPending ? 'Đang xếp…' : 'Tự xếp người'}</Button>}
        {hasResult && <Button size="sm" variant="outline" className="h-7" onClick={() => window.print()}><Printer className="h-3.5 w-3.5 mr-1" />In</Button>}
        {canPublish && <Button size="sm" variant={published ? 'outline' : 'default'} className="h-7" onClick={() => publish.mutate({ id: sheet.id, publish: !published })} disabled={publish.isPending}><Send className="h-3.5 w-3.5 mr-1" />{published ? 'Thu hồi' : 'Phát hành'}</Button>}
        {canDelete && <Button size="sm" variant="outline" className="h-7 text-red-600" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>

      {result && result.shortfalls.length > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>Thiếu người ở: {result.shortfalls.map(s => `${skillName(s.skill_id)} (thiếu ${s.short})`).join(', ')}</div>
        </div>
      )}
      {result && result.on_leave > 0 && <p className="text-[11px] text-slate-500">Đã loại {result.on_leave} người nghỉ phép.</p>}

      {/* Yêu cầu nhân lực */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-100 border-b border-slate-200 px-3 py-1.5 flex items-center gap-2">
          <span className="w-1 h-3.5 bg-sky-500 rounded-full" /><span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Yêu cầu nhân lực</span>
        </div>
        {sheet.skills.length === 0 ? (
          <p className="text-xs text-slate-400 p-3">Layout chưa có vị trí nào.</p>
        ) : (
          <div className="p-2 flex flex-wrap gap-2">
            {sheet.skills.map(s => (
              <div key={s.id} className="flex items-center gap-1.5 border border-slate-200 rounded-md px-2 py-1 bg-white">
                <span className="text-xs text-slate-600">{s.name}{s.shift_tag && <span className="text-[10px] text-slate-400 ml-1">{shiftOf(s.shift_tag)}</span>}{s.job_title && <span className="text-[9px] text-slate-300 ml-1">{s.job_title}</span>}</span>
                <input type="number" min={0} max={99} value={demands[s.id] || ''} placeholder="0" disabled={!canCreate}
                  onChange={e => setDemands(prev => ({ ...prev, [s.id]: Math.max(0, Number(e.target.value) || 0) }))}
                  className="w-12 h-6 text-center text-xs rounded border border-slate-200 focus:border-sky-500 outline-none disabled:bg-slate-50" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Kết quả */}
      {hasResult && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-100 border-b border-slate-200 px-3 py-1.5 flex items-center gap-2">
            <span className="w-1 h-3.5 bg-sky-500 rounded-full" /><span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Kết quả phân công</span>
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
                      {a.status === 'LEAVE' ? <span className="italic">Nghỉ phép</span>
                        : canEdit ? (
                        <select value={a.skill_id ?? ''} onChange={e => changePos(a.employee_id, e.target.value || null)} className="border border-slate-200 rounded px-1.5 py-0.5 text-xs bg-white max-w-[240px]">
                          <option value="">— Chưa phân —</option>
                          {sheet.skills.map(s => <option key={s.id} value={s.id}>{positionLabel(s.job_title, s.name, s.shift_tag)}</option>)}
                        </select>
                      ) : labelOf(a.skill_id)}
                      {a.is_manual && a.status === 'ASSIGNED' && <span className="text-[9px] text-sky-500 ml-1">(tay)</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {a.status === 'ASSIGNED' ? <Badge variant="info">Đã xếp</Badge> : a.status === 'LEAVE' ? <Badge variant="slate">Nghỉ phép</Badge> : <Badge variant="warning">Chưa phân</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasResult && <PrintArea sheet={sheet} whName={whName} labelOf={labelOf} sortedAsg={sortedAsg} />}
    </div>
  )
}

// ─── Bảng in ────────────────────────────────────────────────────────────────
function PrintArea({ sheet, whName, labelOf, sortedAsg }: {
  sheet: SheetDetail; whName: string; labelOf: (id: string | null) => string; sortedAsg: SheetDetail['assignments']
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
        <p style={{ textAlign: 'center', fontSize: 12, margin: '4px 0 2px' }}><b>Ngày: {formatDate(sheet.work_date)}</b> &nbsp;|&nbsp; <b>Bộ phận: {sheet.layout_name}</b></p>
        <p style={{ textAlign: 'center', fontSize: 12, margin: '0 0 10px' }}>Kho: {whName}</p>
        <table>
          <thead><tr><th style={{ width: 36 }}>STT</th><th>Họ và Tên</th><th>Chức danh</th><th>Vị trí phân công</th><th style={{ width: 120 }}>Note</th></tr></thead>
          <tbody>
            {sortedAsg.map((a, i) => (
              <tr key={a.id}>
                <td>{i + 1}</td><td>{a.employee?.name ?? '—'}</td><td>{a.employee?.job_title ?? '—'}</td>
                <td>{a.status === 'LEAVE' ? 'Nghỉ phép' : a.skill_id ? labelOf(a.skill_id) : 'Chưa phân công'}</td><td></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
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

// Sửa vị trí + số người của 1 layout (chọn skill từ tất cả chức danh)
function LayoutEditor({ layoutId }: { layoutId: string }) {
  const { data: layout } = useLayout(layoutId)
  const { data: allSkills = [] } = useSkills({ all: true })
  const setSkills = useSetLayoutSkills()
  const update = useUpdateLayout()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!layout) return
    const m: Record<string, number> = {}
    for (const s of layout.skills) m[s.skill_id] = s.required_count
    setCounts(m); setNote(layout.note ?? ''); setDirty(false)
  }, [layout])

  // gom skill theo chức danh
  const grouped = useMemo(() => {
    const g = new Map<string, typeof allSkills>()
    for (const s of allSkills) { const k = s.job_title ?? '(Không chức danh)'; const arr = g.get(k) ?? []; arr.push(s); g.set(k, arr) }
    return [...g.entries()]
  }, [allSkills])

  function setCount(skillId: string, v: number) { setCounts(p => ({ ...p, [skillId]: v })); setDirty(true) }
  async function save() {
    setErr(null)
    try {
      const skills = Object.entries(counts).filter(([, c]) => c > 0).map(([skill_id, required_count], i) => ({ skill_id, required_count, sort_order: i }))
      await setSkills.mutateAsync({ layout_id: layoutId, skills })
      if (layout && note !== (layout.note ?? '')) await update.mutateAsync({ id: layoutId, note })
      setDirty(false)
    } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  if (!layout) return <p className="text-xs text-slate-400 px-3 pb-3">Đang tải…</p>
  return (
    <div className="border-t border-slate-200 p-3 space-y-2 bg-slate-50/50">
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</div>}
      <div className="flex items-center gap-2">
        <Input value={note} onChange={e => { setNote(e.target.value); setDirty(true) }} placeholder="Ghi chú layout (không bắt buộc)" className="h-7 text-xs flex-1" />
        <Button size="sm" variant={dirty ? 'default' : 'outline'} className="h-7" disabled={!dirty || setSkills.isPending} onClick={save}><Save className="h-3.5 w-3.5 mr-1" />Lưu</Button>
      </div>
      <p className="text-[11px] text-slate-500">Nhập số người cần cho mỗi vị trí (để trống = không thuộc layout). Vị trí gom theo chức danh.</p>
      {grouped.length === 0 ? <p className="text-xs text-slate-400">Chưa có skill nào — khai báo trong Chức danh (Quản lý người dùng).</p>
      : grouped.map(([jt, skills]) => (
        <div key={jt} className="border border-slate-200 rounded-md bg-white">
          <div className="px-2 py-1 text-[11px] font-semibold text-slate-500 border-b border-slate-100">{jt}</div>
          <div className="p-2 flex flex-wrap gap-2">
            {skills.map(s => {
              const v = counts[s.id] ?? 0
              return (
                <div key={s.id} className="flex items-center gap-1.5 border border-slate-200 rounded px-2 py-1">
                  <span className="text-xs text-slate-600">{s.name}{s.shift_tag && <span className="text-[10px] text-slate-400 ml-1">{shiftOf(s.shift_tag)}</span>}</span>
                  <input type="number" min={0} max={99} value={v || ''} placeholder="0"
                    onChange={e => setCount(s.id, Math.max(0, Number(e.target.value) || 0))}
                    className="w-11 h-6 text-center text-xs rounded border border-slate-200 focus:border-sky-500 outline-none" />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
