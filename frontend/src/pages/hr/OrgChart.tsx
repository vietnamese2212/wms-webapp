import { useMemo, useState } from 'react'
import { Network, AlertTriangle, Plus, Users, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import {
  useJobTitles, useDepartments, useWarehouses, useEmployeeRecords,
  useSetJobTitleParent, useCreateJobTitle,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import type { JobTitle, EmployeeRecord } from '@/types'

const ORG_CSS = `
.orgchart { display:inline-block; min-width:100%; padding:14px 16px 28px; }
.orgchart ul { position:relative; padding-top:24px; display:flex; justify-content:center; }
.orgchart li { list-style:none; text-align:center; position:relative; padding:24px 10px 0; }
.orgchart li::before, .orgchart li::after { content:''; position:absolute; top:0; right:50%; border-top:2px solid #cbd5e1; width:50%; height:24px; }
.orgchart li::after { right:auto; left:50%; border-left:2px solid #cbd5e1; }
.orgchart li:only-child::after, .orgchart li:only-child::before { display:none; }
.orgchart li:only-child { padding-top:0; }
.orgchart li:first-child::before, .orgchart li:last-child::after { border:0 none; }
.orgchart li:last-child::before { border-right:2px solid #cbd5e1; border-radius:0 6px 0 0; }
.orgchart li:first-child::after { border-radius:6px 0 0 0; }
.orgchart ul ul::before { content:''; position:absolute; top:0; left:50%; border-left:2px solid #cbd5e1; width:0; height:24px; }
.orgchart .node { display:inline-block; vertical-align:top; }
`

type PickMode = { kind: 'root' } | { kind: 'below'; anchor: JobTitle } | { kind: 'above'; anchor: JobTitle }

export default function OrgChart() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canEdit = can(perms, 'employees', 'edit')

  const { data: jobTitles = [], isLoading } = useJobTitles()
  const { data: departments = [] } = useDepartments()
  const { data: warehouses = [] } = useWarehouses(true)
  const [wh, setWh] = useState('')
  const { data: emps = [] } = useEmployeeRecords()

  const setParent = useSetJobTitleParent()
  const createJt  = useCreateJobTitle()
  const [err, setErr] = useState<string | null>(null)

  const byId = useMemo(() => new Map(jobTitles.map(j => [j.id, j])), [jobTitles])
  const { roots, childrenOf } = useMemo(() => {
    const ids = new Set(jobTitles.map(j => j.id))
    const childrenOf = new Map<string, JobTitle[]>()
    const roots: JobTitle[] = []
    for (const j of jobTitles) {
      const p = j.parent_id && ids.has(j.parent_id) ? j.parent_id : null
      if (p) { const a = childrenOf.get(p) ?? []; a.push(j); childrenOf.set(p, a) }
      else roots.push(j)
    }
    return { roots, childrenOf }
  }, [jobTitles])

  const empsByJt = useMemo(() => {
    const m = new Map<string, EmployeeRecord[]>()
    if (!wh) return m
    for (const e of emps as EmployeeRecord[]) {
      if (!e.job_title_id || !e.warehouse_access?.some(w => w.warehouse_id === wh)) continue
      const a = m.get(e.job_title_id) ?? []; a.push(e); m.set(e.job_title_id, a)
    }
    return m
  }, [emps, wh])

  // tập hậu duệ / tổ tiên (để loại khỏi danh sách chọn, tránh vòng lặp)
  function descendants(id: string): Set<string> {
    const out = new Set<string>()
    const walk = (x: string) => (childrenOf.get(x) ?? []).forEach(c => { if (!out.has(c.id)) { out.add(c.id); walk(c.id) } })
    walk(id); return out
  }
  function ancestors(id: string): Set<string> {
    const out = new Set<string>(); let cur = byId.get(id)?.parent_id ?? null
    while (cur) { if (out.has(cur)) break; out.add(cur); cur = byId.get(cur)?.parent_id ?? null }
    return out
  }

  // ── picker ──
  const [pick, setPick] = useState<PickMode | null>(null)
  const [tab, setTab] = useState<'exist' | 'new'>('exist')
  const [selId, setSelId] = useState('')
  const [newName, setNewName] = useState('')
  const [newDept, setNewDept] = useState('')

  function openPick(mode: PickMode) {
    setPick(mode); setTab('exist'); setSelId(''); setNewName(''); setErr(null)
    setNewDept(mode.kind !== 'root' ? mode.anchor.department_id : (departments[0]?.id ?? ''))
  }

  // danh sách vị trí có sẵn được phép chọn
  const pickable = useMemo(() => {
    if (!pick) return []
    if (pick.kind === 'root') return jobTitles.filter(j => j.parent_id) // đưa 1 vị trí đang là con lên gốc
    const anchor = pick.anchor
    const exclude = new Set<string>([anchor.id])
    if (pick.kind === 'below') ancestors(anchor.id).forEach(x => exclude.add(x))
    else descendants(anchor.id).forEach(x => exclude.add(x))
    return jobTitles.filter(j => !exclude.has(j.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick, jobTitles])

  async function applyExisting() {
    if (!pick || !selId) { setErr('Chọn 1 vị trí'); return }
    setErr(null)
    try {
      if (pick.kind === 'root') {
        await setParent.mutateAsync({ id: selId, parent_id: null })
      } else if (pick.kind === 'below') {
        await setParent.mutateAsync({ id: selId, parent_id: pick.anchor.id })
      } else { // above: chèn selId lên trên anchor
        await setParent.mutateAsync({ id: selId, parent_id: pick.anchor.parent_id ?? null })
        await setParent.mutateAsync({ id: pick.anchor.id, parent_id: selId })
      }
      setPick(null)
    } catch (e) { showErr(e) }
  }
  async function applyNew() {
    if (!pick || !newName.trim() || !newDept) { setErr('Nhập tên + phòng ban'); return }
    setErr(null)
    try {
      if (pick.kind === 'root') {
        await createJt.mutateAsync({ name: newName.trim(), department_id: newDept, parent_id: null })
      } else if (pick.kind === 'below') {
        await createJt.mutateAsync({ name: newName.trim(), department_id: newDept, parent_id: pick.anchor.id })
      } else {
        const created = await createJt.mutateAsync({ name: newName.trim(), department_id: newDept, parent_id: pick.anchor.parent_id ?? null })
        await setParent.mutateAsync({ id: pick.anchor.id, parent_id: (created as { id: string }).id })
      }
      setPick(null)
    } catch (e) { showErr(e) }
  }
  function showErr(e: unknown) {
    const ax = e as { response?: { data?: { error?: { message?: string } } } }
    setErr(ax.response?.data?.error?.message ?? String((e as { message?: string })?.message ?? e))
  }

  async function detach(jt: JobTitle) {
    // gỡ khỏi cây: đưa các con lên thế chỗ (con.parent = jt.parent) rồi jt thành gốc
    setErr(null)
    try {
      for (const c of childrenOf.get(jt.id) ?? []) await setParent.mutateAsync({ id: c.id, parent_id: jt.parent_id ?? null })
      if (jt.parent_id) await setParent.mutateAsync({ id: jt.id, parent_id: null })
    } catch (e) { showErr(e) }
  }

  function NodeBox({ jt }: { jt: JobTitle }) {
    const people = empsByJt.get(jt.id) ?? []
    return (
      <div className="node relative inline-block">
        {canEdit && (
          <button onClick={() => openPick({ kind: 'above', anchor: jt })} title="Thêm cấp trên"
            className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 bg-white border border-slate-300 rounded-full p-0.5 text-slate-400 hover:text-sky-600 hover:border-sky-400 shadow-sm">
            <ChevronUp className="h-3 w-3" />
          </button>
        )}
        <div title={wh && people.length ? people.map(p => p.name).join(', ') : undefined}
          className="rounded-lg border border-slate-300 px-3 py-2 shadow-sm bg-white text-left w-44">
          <div className="text-sm font-semibold text-slate-700 leading-tight truncate">{jt.name}</div>
          <div className="text-[10px] text-slate-400 truncate">{jt.department?.name ?? '—'}</div>
          {wh && <div className="mt-0.5 flex items-center gap-1 text-[10px] text-sky-600"><Users className="h-3 w-3" />{people.length ? `${people.length} người` : '—'}</div>}
          {canEdit && (
            <button onClick={() => detach(jt)} title="Gỡ khỏi sơ đồ"
              className="absolute -top-2 -right-2 bg-white border border-slate-200 rounded-full p-0.5 text-slate-300 hover:text-red-500 hover:border-red-300 shadow-sm">
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
        {canEdit && (
          <button onClick={() => openPick({ kind: 'below', anchor: jt })} title="Thêm cấp dưới"
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 z-10 bg-white border border-slate-300 rounded-full p-0.5 text-slate-400 hover:text-sky-600 hover:border-sky-400 shadow-sm">
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }

  function renderLi(jt: JobTitle) {
    const kids = childrenOf.get(jt.id) ?? []
    return (
      <li key={jt.id}>
        <NodeBox jt={jt} />
        {kids.length > 0 && <ul>{kids.map(renderLi)}</ul>}
      </li>
    )
  }

  const pickTitle = !pick ? '' : pick.kind === 'root' ? 'Chọn vị trí (cấp cao nhất)'
    : pick.kind === 'below' ? `Thêm cấp dưới của "${pick.anchor.name}"` : `Thêm cấp trên của "${pick.anchor.name}"`

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b border-slate-200 px-3 py-2.5 sm:rounded-t-xl flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold text-slate-800 flex items-center gap-1.5"><Network className="h-4 w-4" /> Sơ đồ tổ chức (chức danh)</h1>
          <WarehouseSingleSelect warehouses={warehouses as { id: string; code?: string; name: string }[]} value={wh} onChange={setWh} allLabel="Không hiện người" placeholder="Xem người theo kho…" triggerClassName="w-44" />
          {canEdit && <span className="text-[11px] text-slate-400">Bấm <b>＋</b> phía trên/dưới mỗi hộp để thêm cấp trên/cấp dưới.</span>}
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {err && <div className="m-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />{err}</div>}
          {isLoading ? <p className="text-xs text-slate-400 py-8 text-center">Đang tải…</p>
          : roots.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-16 text-slate-400">
              <Network className="h-8 w-8" />
              <p className="text-sm">Chưa có sơ đồ. Bắt đầu bằng 1 vị trí:</p>
              {canEdit && <Button onClick={() => openPick({ kind: 'root' })}><Plus className="h-4 w-4 mr-1" />Chọn vị trí đầu tiên</Button>}
            </div>
          ) : (
            <>
              <style>{ORG_CSS}</style>
              {canEdit && <div className="px-4 pt-3"><Button size="sm" variant="outline" className="h-7" onClick={() => openPick({ kind: 'root' })}><Plus className="h-3.5 w-3.5 mr-1" />Thêm sơ đồ (vị trí gốc)</Button></div>}
              {/* mỗi vị trí gốc = 1 sơ đồ độc lập */}
              {roots.map((r, i) => (
                <div key={r.id} className={i > 0 ? 'border-t border-dashed border-slate-200 mt-2' : ''}>
                  <div className="orgchart"><ul>{renderLi(r)}</ul></div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {pick && (
        <Dialog open onOpenChange={o => !o && setPick(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{pickTitle}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium w-fit">
                <button onClick={() => setTab('exist')} className={`px-3 py-1.5 ${tab === 'exist' ? 'bg-sky-600 text-white' : 'text-slate-600'}`}>Vị trí có sẵn</button>
                <button onClick={() => setTab('new')} className={`px-3 py-1.5 border-l border-slate-200 ${tab === 'new' ? 'bg-sky-600 text-white' : 'text-slate-600'}`}>Tạo mới</button>
              </div>

              {tab === 'exist' ? (
                <>
                  <select value={selId} onChange={e => setSelId(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 h-9 text-sm bg-white">
                    <option value="">— Chọn vị trí —</option>
                    {pickable.map(j => <option key={j.id} value={j.id}>{j.name}{j.department?.name ? ` · ${j.department.name}` : ''}</option>)}
                  </select>
                  {pickable.length === 0 && <p className="text-[11px] text-slate-400">Không còn vị trí phù hợp — hãy tạo mới.</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" className="h-8" onClick={() => setPick(null)}>Hủy</Button>
                    <Button className="h-8" onClick={applyExisting} disabled={!selId || setParent.isPending}>Đặt vào sơ đồ</Button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-[11px] text-slate-500">Tên chức danh</label>
                    <Input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && applyNew()} placeholder="VD: Giám sát kho TP" className="h-9 text-sm" />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Phòng ban</label>
                    <select value={newDept} onChange={e => setNewDept(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 h-9 text-sm bg-white">
                      <option value="">— Chọn phòng ban —</option>
                      {(departments as { id: string; name: string }[]).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" className="h-8" onClick={() => setPick(null)}>Hủy</Button>
                    <Button className="h-8" onClick={applyNew} disabled={createJt.isPending}>Tạo &amp; đặt</Button>
                  </div>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
