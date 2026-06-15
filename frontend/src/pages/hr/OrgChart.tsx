import { useMemo, useState } from 'react'
import { Network, AlertTriangle, Plus, Users, ChevronUp, ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import {
  useJobTitles, useWarehouses, useEmployeeRecords, useSetJobTitleParent,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import type { JobTitle, EmployeeRecord } from '@/types'

const ORG_CSS = `
.orgchart { display:inline-block; min-width:100%; padding:18px 24px 32px; }
.orgchart ul { position:relative; padding-top:26px; display:flex; justify-content:center; }
.orgchart li { list-style:none; text-align:center; position:relative; padding:26px 12px 0; }
/* đường ngang nối các anh em + nhánh dọc xuống mỗi node */
.orgchart li::before, .orgchart li::after { content:''; position:absolute; top:0; right:50%; border-top:2px solid #94a3b8; width:50%; height:26px; }
.orgchart li::after { right:auto; left:50%; border-left:2px solid #94a3b8; }
.orgchart li:only-child::after, .orgchart li:only-child::before { display:none; }
.orgchart li:only-child { padding-top:0; }
.orgchart li:first-child::before, .orgchart li:last-child::after { border:0 none; }
.orgchart li:last-child::before { border-right:2px solid #94a3b8; border-radius:0 8px 0 0; }
.orgchart li:first-child::after { border-radius:8px 0 0 0; }
/* nhánh dọc từ node cha xuống thanh ngang */
.orgchart ul ul::before { content:''; position:absolute; top:0; left:50%; border-left:2px solid #94a3b8; width:0; height:26px; }
.orgchart .node { display:inline-block; vertical-align:top; }
`

type PickMode = { kind: 'root' } | { kind: 'below'; anchor: JobTitle } | { kind: 'above'; anchor: JobTitle }

export default function OrgChart() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canEdit = can(perms, 'employees', 'edit')

  const { data: jobTitles = [], isLoading } = useJobTitles()
  const { data: warehouses = [] } = useWarehouses(true)
  const [wh, setWh] = useState('')
  const { data: emps = [] } = useEmployeeRecords()
  const setParent = useSetJobTitleParent()
  const [err, setErr] = useState<string | null>(null)

  const placed = useMemo(() => jobTitles.filter(j => j.in_chart), [jobTitles])
  const { roots, childrenOf } = useMemo(() => {
    const ids = new Set(placed.map(j => j.id))
    const childrenOf = new Map<string, JobTitle[]>()
    const roots: JobTitle[] = []
    for (const j of placed) {
      const p = j.parent_id && ids.has(j.parent_id) ? j.parent_id : null
      if (p) { const a = childrenOf.get(p) ?? []; a.push(j); childrenOf.set(p, a) }
      else roots.push(j)
    }
    return { roots, childrenOf }
  }, [placed])

  const empsByJt = useMemo(() => {
    const m = new Map<string, EmployeeRecord[]>()
    if (!wh) return m
    for (const e of emps as EmployeeRecord[]) {
      if (!e.job_title_id || !e.warehouse_access?.some(w => w.warehouse_id === wh)) continue
      const a = m.get(e.job_title_id) ?? []; a.push(e); m.set(e.job_title_id, a)
    }
    return m
  }, [emps, wh])

  // ── picker (chỉ chọn chức danh CÓ SẴN, chưa ở trong sơ đồ) ──
  const [pick, setPick] = useState<PickMode | null>(null)
  const [selId, setSelId] = useState('')
  const [multi, setMulti] = useState<Set<string>>(new Set())
  const pickable = useMemo(() => jobTitles.filter(j => !j.in_chart), [jobTitles])

  function openPick(mode: PickMode) { setPick(mode); setSelId(''); setMulti(new Set()); setErr(null) }
  function showErr(e: unknown) {
    const ax = e as { response?: { data?: { error?: { message?: string } } } }
    setErr(ax.response?.data?.error?.message ?? String((e as { message?: string })?.message ?? e))
  }
  async function apply() {
    if (!pick) return
    setErr(null)
    try {
      if (pick.kind === 'root') {
        if (!selId) { setErr('Chọn 1 vị trí'); return }
        await setParent.mutateAsync({ id: selId, parent_id: null, in_chart: true })
      } else if (pick.kind === 'below') {
        if (!multi.size) { setErr('Chọn ít nhất 1 vị trí'); return }
        for (const id of multi) await setParent.mutateAsync({ id, parent_id: pick.anchor.id, in_chart: true })
      } else {
        if (!selId) { setErr('Chọn 1 vị trí'); return }
        await setParent.mutateAsync({ id: selId, parent_id: pick.anchor.parent_id ?? null, in_chart: true })
        await setParent.mutateAsync({ id: pick.anchor.id, parent_id: selId })
      }
      setPick(null)
    } catch (e) { showErr(e) }
  }
  async function detach(jt: JobTitle) {
    if (!confirm(`Bỏ "${jt.name}" khỏi sơ đồ? (chức danh vẫn còn)`)) return
    setErr(null)
    try {
      for (const c of childrenOf.get(jt.id) ?? []) await setParent.mutateAsync({ id: c.id, parent_id: jt.parent_id ?? null })
      await setParent.mutateAsync({ id: jt.id, parent_id: null, in_chart: false })
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
            <button onClick={() => detach(jt)} title="Bỏ khỏi sơ đồ"
              className="absolute -top-2 -right-2 bg-white border border-slate-200 rounded-full p-0.5 text-slate-300 hover:text-red-500 hover:border-red-300 shadow-sm">
              <X className="h-3 w-3" />
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
          {canEdit && <span className="text-[11px] text-slate-400">Bấm <b>＋</b> trên/dưới mỗi hộp để thêm cấp trên/cấp dưới (chọn từ chức danh có sẵn).</span>}
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
              {pickable.length === 0 ? (
                <p className="text-xs text-slate-500">Mọi chức danh đã ở trong sơ đồ. Tạo chức danh mới ở <b>Quản lý người dùng → Chức danh</b> rồi quay lại thêm.</p>
              ) : pick.kind === 'below' ? (
                <div className="border border-slate-200 rounded-lg max-h-60 overflow-y-auto divide-y divide-slate-100">
                  {pickable.map(j => (
                    <label key={j.id} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={multi.has(j.id)} className="h-3.5 w-3.5 rounded accent-sky-600"
                        onChange={e => setMulti(prev => { const n = new Set(prev); if (e.target.checked) n.add(j.id); else n.delete(j.id); return n })} />
                      <span className="text-sm text-slate-700 flex-1 truncate">{j.name}</span>
                      <span className="text-[10px] text-slate-400">{j.department?.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <select value={selId} onChange={e => setSelId(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 h-9 text-sm bg-white">
                  <option value="">— Chọn vị trí —</option>
                  {pickable.map(j => <option key={j.id} value={j.id}>{j.name}{j.department?.name ? ` · ${j.department.name}` : ''}</option>)}
                </select>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="h-8" onClick={() => setPick(null)}>Hủy</Button>
                {pickable.length > 0 && (
                  <Button className="h-8" onClick={apply} disabled={setParent.isPending || (pick.kind === 'below' ? multi.size === 0 : !selId)}>
                    Đặt vào sơ đồ{pick.kind === 'below' && multi.size > 0 ? ` (${multi.size})` : ''}
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
