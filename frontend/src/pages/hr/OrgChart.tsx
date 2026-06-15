import { useMemo, useState } from 'react'
import { Network, GripVertical, AlertTriangle, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import {
  useJobTitles, useDepartments, useWarehouses, useEmployeeRecords,
  useSetJobTitleParent, useCreateJobTitle,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import type { JobTitle, EmployeeRecord } from '@/types'

export default function OrgChart() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canEdit = can(perms, 'employees', 'edit')

  const { data: jobTitles = [], isLoading } = useJobTitles()
  const { data: departments = [] } = useDepartments()
  const { data: warehouses = [] } = useWarehouses(true)
  const [wh, setWh] = useState('')   // xem người theo kho (tùy chọn)
  const { data: emps = [] } = useEmployeeRecords()

  const setParent = useSetJobTitleParent()
  const createJt = useCreateJobTitle()
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [addUnder, setAddUnder] = useState<string | null>(null)   // job title id | '__root__'
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

  // người theo chức danh tại kho đã chọn
  const empsByJt = useMemo(() => {
    const m = new Map<string, EmployeeRecord[]>()
    if (!wh) return m
    for (const e of emps as EmployeeRecord[]) {
      if (!e.job_title_id) continue
      if (!e.warehouse_access?.some(w => w.warehouse_id === wh)) continue
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
  async function addChild(parentId: string | null) {
    if (!newName.trim() || !newDept) { setErr('Nhập tên chức danh + chọn phòng ban'); return }
    setErr(null)
    try {
      await createJt.mutateAsync({ name: newName.trim(), department_id: newDept, parent_id: parentId })
      setAddUnder(null); setNewName(''); setNewDept('')
    } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  function AddForm({ parentId }: { parentId: string | null }) {
    return (
      <div className="flex items-center gap-1.5 my-1">
        <Input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addChild(parentId)} placeholder="Tên chức danh…" className="h-7 text-xs w-44" />
        <select value={newDept} onChange={e => setNewDept(e.target.value)} className="border border-slate-200 rounded-md px-2 text-xs h-7 bg-white">
          <option value="">Phòng ban…</option>
          {(departments as { id: string; name: string }[]).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <Button size="sm" className="h-7" onClick={() => addChild(parentId)} disabled={createJt.isPending}><Plus className="h-3.5 w-3.5" /></Button>
        <button onClick={() => { setAddUnder(null); setNewName('') }} className="text-slate-400 hover:bg-slate-100 rounded p-1"><X className="h-4 w-4" /></button>
      </div>
    )
  }

  function Node({ jt, depth }: { jt: JobTitle; depth: number }) {
    const kids = childrenOf.get(jt.id) ?? []
    const people = empsByJt.get(jt.id) ?? []
    const isOver = overId === jt.id
    return (
      <div style={{ marginLeft: depth * 20 }}>
        <div
          draggable={canEdit}
          onDragStart={() => setDragId(jt.id)}
          onDragEnd={() => { setDragId(null); setOverId(null) }}
          onDragOver={e => { if (canEdit && dragId && dragId !== jt.id) { e.preventDefault(); setOverId(jt.id) } }}
          onDragLeave={() => setOverId(o => (o === jt.id ? null : o))}
          onDrop={e => { e.preventDefault(); reparent(dragId!, jt.id) }}
          className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 mb-1 bg-white transition-colors
            ${isOver ? 'border-sky-500 ring-1 ring-sky-400 bg-sky-50' : 'border-slate-200'}
            ${dragId === jt.id ? 'opacity-40' : ''} ${canEdit ? 'cursor-grab' : ''}`}>
          {canEdit && <GripVertical className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-400 shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-700 truncate">
              {jt.name}
              <span className="text-[10px] text-slate-400 font-normal ml-1.5">{jt.department?.name ?? ''}</span>
              {kids.length > 0 && <span className="text-[10px] text-sky-500 ml-1.5">{kids.length} cấp dưới</span>}
            </div>
            {wh && (
              <div className="text-[10px] text-slate-400 truncate">
                {people.length ? people.map(p => p.name).join(', ') : 'chưa có người tại kho này'}
              </div>
            )}
          </div>
          {canEdit && <button onClick={() => { setAddUnder(jt.id); setNewDept(jt.department_id) }} title="Thêm chức danh cấp dưới"
            className="text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded p-1 shrink-0"><Plus className="h-4 w-4" /></button>}
        </div>
        {addUnder === jt.id && <div style={{ marginLeft: 20 }}><AddForm parentId={jt.id} /></div>}
        {kids.map(k => <Node key={k.id} jt={k} depth={depth + 1} />)}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b border-slate-200 px-3 py-2.5 sm:rounded-t-xl flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold text-slate-800 flex items-center gap-1.5"><Network className="h-4 w-4" /> Sơ đồ tổ chức (chức danh)</h1>
          <WarehouseSingleSelect warehouses={warehouses as { id: string; code?: string; name: string }[]} value={wh} onChange={setWh} allLabel="Không hiện người" placeholder="Xem người theo kho…" triggerClassName="w-44" />
          {canEdit && <span className="text-[11px] text-slate-400">Kéo chức danh thả lên chức danh khác để đổi cấp trên; bấm <b>+</b> để thêm cấp dưới.</span>}
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-3">
          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-2 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />{err}</div>}

          {canEdit && (
            <div
              onDragOver={e => { if (dragId) { e.preventDefault(); setOverId('__root__') } }}
              onDragLeave={() => setOverId(o => (o === '__root__' ? null : o))}
              onDrop={e => { e.preventDefault(); reparent(dragId!, null) }}
              className={`mb-2 rounded-lg border border-dashed px-3 py-2 text-xs text-center transition-colors
                ${overId === '__root__' ? 'border-sky-500 bg-sky-50 text-sky-600' : 'border-slate-300 text-slate-400'}`}>
              ⬑ Thả vào đây = Cấp cao nhất (không có cấp trên)
            </div>
          )}
          {canEdit && (addUnder === '__root__'
            ? <AddForm parentId={null} />
            : <Button size="sm" variant="outline" className="h-7 mb-2" onClick={() => { setAddUnder('__root__'); setNewDept('') }}><Plus className="h-3.5 w-3.5 mr-1" />Thêm chức danh gốc</Button>)}

          {isLoading ? <p className="text-xs text-slate-400 py-8 text-center">Đang tải…</p>
          : roots.length === 0 ? <p className="text-xs text-slate-400 py-8 text-center">Chưa có chức danh nào.</p>
          : <div className="max-w-3xl">{roots.map(r => <Node key={r.id} jt={r} depth={0} />)}</div>}
        </div>
      </div>
    </div>
  )
}
