import { useMemo, useState } from 'react'
import { Network, AlertTriangle, Plus, Users } from 'lucide-react'
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
.orgchart { display:inline-block; min-width:100%; padding:8px 16px 24px; }
.orgchart ul { position:relative; padding-top:22px; display:flex; justify-content:center; }
.orgchart li { list-style:none; text-align:center; position:relative; padding:22px 8px 0; }
.orgchart li::before, .orgchart li::after { content:''; position:absolute; top:0; right:50%; border-top:2px solid #cbd5e1; width:50%; height:22px; }
.orgchart li::after { right:auto; left:50%; border-left:2px solid #cbd5e1; }
.orgchart li:only-child::after, .orgchart li:only-child::before { display:none; }
.orgchart li:only-child { padding-top:0; }
.orgchart li:first-child::before, .orgchart li:last-child::after { border:0 none; }
.orgchart li:last-child::before { border-right:2px solid #cbd5e1; border-radius:0 6px 0 0; }
.orgchart li:first-child::after { border-radius:6px 0 0 0; }
.orgchart ul ul::before { content:''; position:absolute; top:0; left:50%; border-left:2px solid #cbd5e1; width:0; height:22px; }
.orgchart .node { display:inline-block; vertical-align:top; }
`

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
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)   // job title id | '__root__'
  const [err, setErr] = useState<string | null>(null)

  // dialog thêm chức danh con
  const [addParent, setAddParent] = useState<string | null | undefined>(undefined) // undefined=đóng, null=gốc
  const [newName, setNewName] = useState('')
  const [newDept, setNewDept] = useState('')

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

  async function reparent(childId: string, parentId: string | null) {
    setDragId(null); setOverId(null)
    if (!childId || childId === parentId) return
    setErr(null)
    try { await setParent.mutateAsync({ id: childId, parent_id: parentId }) }
    catch (e) {
      const ax = e as { response?: { data?: { error?: { message?: string } } } }
      setErr(ax.response?.data?.error?.message ?? String((e as { message?: string })?.message ?? e))
    }
  }
  function openAdd(parentId: string | null) {
    setAddParent(parentId)
    setNewName('')
    setNewDept(parentId ? (jobTitles.find(j => j.id === parentId)?.department_id ?? '') : '')
  }
  async function submitAdd() {
    if (!newName.trim() || !newDept) { setErr('Nhập tên chức danh + chọn phòng ban'); return }
    setErr(null)
    try {
      await createJt.mutateAsync({ name: newName.trim(), department_id: newDept, parent_id: addParent ?? null })
      setAddParent(undefined)
    } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  // hộp 1 chức danh
  function NodeBox({ jt }: { jt: JobTitle }) {
    const people = empsByJt.get(jt.id) ?? []
    const isOver = overId === jt.id
    return (
      <div
        draggable={canEdit}
        onDragStart={e => { setDragId(jt.id); e.stopPropagation() }}
        onDragEnd={() => { setDragId(null); setOverId(null) }}
        onDragOver={e => { if (canEdit && dragId && dragId !== jt.id) { e.preventDefault(); setOverId(jt.id) } }}
        onDragLeave={() => setOverId(o => (o === jt.id ? null : o))}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); reparent(dragId!, jt.id) }}
        title={wh && people.length ? people.map(p => p.name).join(', ') : undefined}
        className={`node relative rounded-lg border px-3 py-2 shadow-sm bg-white text-left w-44 transition-colors
          ${isOver ? 'border-sky-500 ring-2 ring-sky-300 bg-sky-50' : 'border-slate-300'}
          ${dragId === jt.id ? 'opacity-40' : ''} ${canEdit ? 'cursor-grab' : ''}`}>
        <div className="text-sm font-semibold text-slate-700 leading-tight truncate">{jt.name}</div>
        <div className="text-[10px] text-slate-400 truncate">{jt.department?.name ?? '—'}</div>
        {wh && (
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-sky-600">
            <Users className="h-3 w-3" />{people.length ? `${people.length} người` : '—'}
          </div>
        )}
        {canEdit && (
          <button onClick={() => openAdd(jt.id)} title="Thêm chức danh cấp dưới"
            className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-white border border-slate-300 rounded-full p-0.5 text-slate-400 hover:text-sky-600 hover:border-sky-400 shadow-sm">
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }

  // đệ quy <li>
  function renderLi(jt: JobTitle) {
    const kids = childrenOf.get(jt.id) ?? []
    return (
      <li key={jt.id}>
        <NodeBox jt={jt} />
        {kids.length > 0 && <ul>{kids.map(renderLi)}</ul>}
      </li>
    )
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b border-slate-200 px-3 py-2.5 sm:rounded-t-xl flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold text-slate-800 flex items-center gap-1.5"><Network className="h-4 w-4" /> Sơ đồ tổ chức (chức danh)</h1>
          <WarehouseSingleSelect warehouses={warehouses as { id: string; code?: string; name: string }[]} value={wh} onChange={setWh} allLabel="Không hiện người" placeholder="Xem người theo kho…" triggerClassName="w-44" />
          {canEdit && <span className="text-[11px] text-slate-400">Kéo 1 hộp thả lên hộp khác để đổi cấp trên · bấm <b>+</b> dưới hộp để thêm cấp dưới · kéo thả lên "Tổ chức" = cấp cao nhất.</span>}
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {err && <div className="m-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />{err}</div>}
          {isLoading ? <p className="text-xs text-slate-400 py-8 text-center">Đang tải…</p>
          : jobTitles.length === 0 ? <p className="text-xs text-slate-400 py-8 text-center">Chưa có chức danh nào.</p>
          : (
            <>
              <style>{ORG_CSS}</style>
              <div className="orgchart">
                <ul>
                  <li>
                    {/* nút gốc = vùng thả "cấp cao nhất" */}
                    <div
                      onDragOver={e => { if (dragId) { e.preventDefault(); setOverId('__root__') } }}
                      onDragLeave={() => setOverId(o => (o === '__root__' ? null : o))}
                      onDrop={e => { e.preventDefault(); reparent(dragId!, null) }}
                      className={`node inline-flex items-center gap-1.5 rounded-lg border-2 px-3 py-2 font-semibold text-sm
                        ${overId === '__root__' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-dashed border-slate-300 text-slate-500'}`}>
                      <Network className="h-4 w-4" /> Tổ chức
                      {canEdit && <button onClick={() => openAdd(null)} title="Thêm chức danh gốc" className="ml-1 text-slate-400 hover:text-sky-600"><Plus className="h-3.5 w-3.5" /></button>}
                    </div>
                    {roots.length > 0 && <ul>{roots.map(renderLi)}</ul>}
                  </li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Dialog thêm chức danh */}
      {addParent !== undefined && (
        <Dialog open onOpenChange={o => !o && setAddParent(undefined)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{addParent ? `Thêm cấp dưới của "${jobTitles.find(j => j.id === addParent)?.name ?? ''}"` : 'Thêm chức danh cấp cao nhất'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
              <div>
                <label className="text-[11px] text-slate-500">Tên chức danh</label>
                <Input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitAdd()} placeholder="VD: Giám sát kho TP" className="h-9 text-sm" />
              </div>
              <div>
                <label className="text-[11px] text-slate-500">Phòng ban</label>
                <select value={newDept} onChange={e => setNewDept(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 h-9 text-sm bg-white">
                  <option value="">— Chọn phòng ban —</option>
                  {(departments as { id: string; name: string }[]).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="h-8" onClick={() => setAddParent(undefined)}>Hủy</Button>
                <Button className="h-8" onClick={submitAdd} disabled={createJt.isPending}>{createJt.isPending ? 'Đang thêm…' : 'Thêm'}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
