import { useMemo, useState } from 'react'
import { Network, GripVertical, AlertTriangle } from 'lucide-react'
import { useDepartments, useEmployeeRecords, useSetManager } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import type { EmployeeRecord } from '@/types'

export default function OrgChart() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canEdit = can(perms, 'employees', 'edit')

  const { data: departments = [] } = useDepartments()
  const [dept, setDept] = useState('')
  const { data: emps = [], isLoading } = useEmployeeRecords(dept ? { department_id: dept } : undefined)
  const setManager = useSetManager()

  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // cây theo manager_id (trong phạm vi đang lọc)
  const { roots, childrenOf } = useMemo(() => {
    const ids = new Set(emps.map(e => e.id))
    const childrenOf = new Map<string, EmployeeRecord[]>()
    const roots: EmployeeRecord[] = []
    for (const e of emps) {
      const mgr = e.manager_id && ids.has(e.manager_id) ? e.manager_id : null
      if (mgr) { const a = childrenOf.get(mgr) ?? []; a.push(e); childrenOf.set(mgr, a) }
      else roots.push(e)
    }
    return { roots, childrenOf }
  }, [emps])

  async function drop(targetId: string | null) {
    const src = dragId
    setDragId(null); setOverId(null)
    if (!src || src === targetId) return
    setErr(null)
    try { await setManager.mutateAsync({ id: src, manager_id: targetId }) }
    catch (e) {
      const ax = e as { response?: { data?: { error?: { message?: string } } } }
      setErr(ax.response?.data?.error?.message ?? String((e as { message?: string })?.message ?? e))
    }
  }

  function Node({ emp, depth }: { emp: EmployeeRecord; depth: number }) {
    const kids = childrenOf.get(emp.id) ?? []
    const isOver = overId === emp.id
    return (
      <div style={{ marginLeft: depth * 18 }}>
        <div
          draggable={canEdit}
          onDragStart={() => setDragId(emp.id)}
          onDragEnd={() => { setDragId(null); setOverId(null) }}
          onDragOver={e => { if (canEdit && dragId && dragId !== emp.id) { e.preventDefault(); setOverId(emp.id) } }}
          onDragLeave={() => setOverId(o => (o === emp.id ? null : o))}
          onDrop={e => { e.preventDefault(); drop(emp.id) }}
          className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 mb-1 bg-white transition-colors
            ${isOver ? 'border-sky-500 ring-1 ring-sky-400 bg-sky-50' : 'border-slate-200'}
            ${dragId === emp.id ? 'opacity-40' : ''} ${canEdit ? 'cursor-grab' : ''}`}>
          {canEdit && <GripVertical className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-400 shrink-0" />}
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-700 truncate">{emp.name} <span className="text-[10px] text-slate-400 font-normal">{emp.employee_code}</span></div>
            <div className="text-[10px] text-slate-400 truncate">{emp.job_title?.name ?? '—'}{emp.dept?.name ? ` · ${emp.dept.name}` : ''}{kids.length ? ` · ${kids.length} cấp dưới` : ''}</div>
          </div>
        </div>
        {kids.map(k => <Node key={k.id} emp={k} depth={depth + 1} />)}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b border-slate-200 px-3 py-2.5 sm:rounded-t-xl flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold text-slate-800 flex items-center gap-1.5"><Network className="h-4 w-4" /> Sơ đồ tổ chức</h1>
          <select value={dept} onChange={e => setDept(e.target.value)} className="border border-slate-200 rounded-md px-2.5 text-xs h-7 bg-white text-slate-700">
            <option value="">Tất cả phòng ban</option>
            {(departments as { id: string; name: string }[]).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {canEdit && <span className="text-[11px] text-slate-400">Kéo 1 người thả lên người khác để đặt <b>quản lý trực tiếp</b>; thả ra "Cấp cao nhất" để bỏ.</span>}
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-3">
          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-2 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />{err}</div>}

          {/* vùng thả gốc */}
          {canEdit && (
            <div
              onDragOver={e => { if (dragId) { e.preventDefault(); setOverId('__root__') } }}
              onDragLeave={() => setOverId(o => (o === '__root__' ? null : o))}
              onDrop={e => { e.preventDefault(); drop(null) }}
              className={`mb-3 rounded-lg border border-dashed px-3 py-2 text-xs text-center transition-colors
                ${overId === '__root__' ? 'border-sky-500 bg-sky-50 text-sky-600' : 'border-slate-300 text-slate-400'}`}>
              ⬑ Thả vào đây = Cấp cao nhất (không có quản lý)
            </div>
          )}

          {isLoading ? <p className="text-xs text-slate-400 py-8 text-center">Đang tải…</p>
          : roots.length === 0 ? <p className="text-xs text-slate-400 py-8 text-center">Không có nhân viên.</p>
          : <div className="max-w-3xl">{roots.map(r => <Node key={r.id} emp={r} depth={0} />)}</div>}
        </div>
      </div>
    </div>
  )
}
