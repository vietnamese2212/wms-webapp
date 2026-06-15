import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Pencil, Check, X, Save, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import {
  useWarehouses, useDepartments,
  useSkills, useCreateSkill, useUpdateSkill, useDeleteSkill,
  useEmployeeSkillMatrix, useSetEmployeeSkills,
  type SkillRow,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'

const SHIFT_OPTS: { value: string; label: string }[] = [
  { value: '',    label: '— (không gắn ca)' },
  { value: 'CA1', label: 'Ca 1' },
  { value: 'CA2', label: 'Ca 2' },
  { value: 'CA3', label: 'Ca 3' },
  { value: 'HC',  label: 'Hành chính' },
]
const shiftLabel = (t: string | null) => SHIFT_OPTS.find(o => o.value === (t ?? ''))?.label ?? '—'

const SCOPE_KEY = 'hr_skill_scope'

export default function SkillManagement() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canManage = can(perms, 'work_skill', 'manage')
  const canAssign = can(perms, 'work_skill', 'assign')

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: departments = [] } = useDepartments()

  // ─── Scope (Kho + Phòng ban), nhớ lựa chọn ───
  const saved = (() => { try { return JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}') } catch { return {} } })()
  const [wh, setWh]     = useState<string>(saved.wh ?? '')
  const [dept, setDept] = useState<string>(saved.dept ?? '')
  useEffect(() => { localStorage.setItem(SCOPE_KEY, JSON.stringify({ wh, dept })) }, [wh, dept])
  const scopeReady = !!(wh && dept)

  const [tab, setTab] = useState<'skills' | 'assign'>('skills')

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Header */}
        <div className="border-b border-slate-200 px-3 py-2.5 sm:rounded-t-xl space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold text-slate-800 mr-1">Vị trí &amp; Skill</h1>
            <WarehouseSingleSelect
              warehouses={warehouses as { id: string; code?: string; name: string }[]}
              value={wh} onChange={setWh} placeholder="Chọn kho…"
              triggerClassName="w-44"
            />
            <select
              value={dept} onChange={e => setDept(e.target.value)}
              className="border border-slate-200 rounded-md px-2.5 text-xs h-7 bg-white text-slate-700 disabled:opacity-50"
            >
              <option value="">Chọn phòng ban…</option>
              {(departments as { id: string; name: string; requires_scheduling?: boolean }[]).map(d => (
                <option key={d.id} value={d.id}>{d.name}{d.requires_scheduling ? ' ✓' : ''}</option>
              ))}
            </select>
          </div>
          {/* Tabs */}
          <div className="flex rounded-lg border border-slate-200 overflow-x-auto text-xs font-medium w-fit [&>button]:shrink-0 [&>button]:whitespace-nowrap">
            <button onClick={() => setTab('skills')}
              className={`px-3 py-1.5 ${tab === 'skills' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              Danh mục vị trí
            </button>
            <button onClick={() => setTab('assign')}
              className={`px-3 py-1.5 border-l border-slate-200 ${tab === 'assign' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              Gán nhân viên
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto p-3">
          {!scopeReady ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2 py-16">
              <AlertTriangle className="h-8 w-8" />
              <p className="text-sm">Chọn <b>Kho</b> và <b>Phòng ban</b> để bắt đầu</p>
            </div>
          ) : tab === 'skills' ? (
            <SkillCatalog wh={wh} dept={dept} canManage={canManage} />
          ) : (
            <AssignPanel wh={wh} dept={dept} canAssign={canAssign} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tab 1: Danh mục vị trí ─────────────────────────────────────────────────
function SkillCatalog({ wh, dept, canManage }: { wh: string; dept: string; canManage: boolean }) {
  const { data: skills = [], isLoading } = useSkills({ warehouse_id: wh, department_id: dept, include_inactive: true })
  const createSkill = useCreateSkill()
  const updateSkill = useUpdateSkill()
  const deleteSkill = useDeleteSkill()
  const [err, setErr] = useState<string | null>(null)

  // form thêm mới
  const [name, setName]   = useState('')
  const [shift, setShift] = useState('')
  // sửa inline
  const [editId, setEditId]   = useState<string | null>(null)
  const [eName, setEName]     = useState('')
  const [eShift, setEShift]   = useState('')

  async function add() {
    if (!name.trim()) return
    setErr(null)
    try {
      await createSkill.mutateAsync({ warehouse_id: wh, department_id: dept, name: name.trim(), shift_tag: shift || null, sort_order: skills.length })
      setName(''); setShift('')
    } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }
  function startEdit(s: SkillRow) { setEditId(s.id); setEName(s.name); setEShift(s.shift_tag ?? '') }
  async function saveEdit(id: string) {
    setErr(null)
    try { await updateSkill.mutateAsync({ id, name: eName.trim(), shift_tag: eShift || null }); setEditId(null) }
    catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }
  async function remove(s: SkillRow) {
    if (!confirm(`Xóa vị trí "${s.name}"?`)) return
    setErr(null)
    try { await deleteSkill.mutateAsync(s.id) } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  return (
    <div className="max-w-2xl space-y-3">
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

      {/* Thêm mới */}
      {canManage && (
        <div className="flex flex-wrap items-end gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
          <div className="flex-1 min-w-[160px]">
            <label className="text-[11px] text-slate-500">Tên vị trí</label>
            <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
              placeholder="VD: Pallet, SCA, SX, Cont 1…" className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-slate-500">Ca</label>
            <select value={shift} onChange={e => setShift(e.target.value)}
              className="border border-slate-200 rounded-md px-2 text-sm h-8 bg-white block">
              {SHIFT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <Button onClick={add} disabled={!name.trim() || createSkill.isPending} className="h-8">
            <Plus className="h-4 w-4 mr-1" /> Thêm
          </Button>
        </div>
      )}

      {/* Bảng */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Tên vị trí</th>
              <th className="text-left px-3 py-2 font-medium w-28">Ca</th>
              <th className="px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={3} className="text-center text-slate-400 py-6 text-xs">Đang tải…</td></tr>
            ) : skills.length === 0 ? (
              <tr><td colSpan={3} className="text-center text-slate-400 py-6 text-xs">Chưa có vị trí nào</td></tr>
            ) : skills.map(s => (
              <tr key={s.id} className={s.is_active ? '' : 'opacity-50'}>
                {editId === s.id ? (
                  <>
                    <td className="px-3 py-1.5"><Input value={eName} onChange={e => setEName(e.target.value)} className="h-7 text-sm" /></td>
                    <td className="px-3 py-1.5">
                      <select value={eShift} onChange={e => setEShift(e.target.value)} className="border border-slate-200 rounded px-1.5 text-xs h-7 bg-white w-full">
                        {SHIFT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      <button onClick={() => saveEdit(s.id)} className="text-green-600 hover:bg-green-50 rounded p-1"><Check className="h-4 w-4" /></button>
                      <button onClick={() => setEditId(null)} className="text-slate-400 hover:bg-slate-100 rounded p-1"><X className="h-4 w-4" /></button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 font-medium text-slate-700">{s.name}{!s.is_active && <span className="ml-1.5 text-[10px] text-slate-400">(ẩn)</span>}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{shiftLabel(s.shift_tag)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {canManage && <button onClick={() => startEdit(s)} className="text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded p-1"><Pencil className="h-3.5 w-3.5" /></button>}
                      {canManage && <button onClick={() => remove(s)} className="text-slate-400 hover:text-red-600 hover:bg-red-50 rounded p-1"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Tab 2: Gán nhân viên (ma trận NV × Skill, ưu tiên) ─────────────────────
function AssignPanel({ wh, dept, canAssign }: { wh: string; dept: string; canAssign: boolean }) {
  const { data, isLoading } = useEmployeeSkillMatrix(wh, dept)
  const setSkills = useSetEmployeeSkills()
  const [err, setErr] = useState<string | null>(null)

  // local edits: empId -> (skillId -> priority). 0 = không có
  const [edits, setEdits] = useState<Record<string, Record<string, number>>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  // seed local state khi data về
  useEffect(() => {
    if (!data) return
    const next: Record<string, Record<string, number>> = {}
    for (const e of data.employees) {
      next[e.id] = {}
      for (const sk of e.skills) next[e.id][sk.skill_id] = sk.priority
    }
    setEdits(next)
  }, [data])

  const skills = data?.skills ?? []
  const dirty = useMemo(() => {
    if (!data) return new Set<string>()
    const d = new Set<string>()
    for (const e of data.employees) {
      const orig: Record<string, number> = {}
      for (const sk of e.skills) orig[sk.skill_id] = sk.priority
      const cur = edits[e.id] ?? {}
      const keys = new Set([...Object.keys(orig), ...Object.keys(cur)])
      for (const k of keys) if ((orig[k] ?? 0) !== (cur[k] ?? 0)) { d.add(e.id); break }
    }
    return d
  }, [data, edits])

  function setCell(empId: string, skillId: string, val: number) {
    setEdits(prev => ({ ...prev, [empId]: { ...prev[empId], [skillId]: val } }))
  }

  async function saveRow(empId: string) {
    setErr(null); setSavingId(empId)
    try {
      const row = edits[empId] ?? {}
      const list = Object.entries(row).filter(([, p]) => p > 0).map(([skill_id, priority]) => ({ skill_id, priority }))
      await setSkills.mutateAsync({ employee_id: empId, warehouse_id: wh, department_id: dept, skills: list })
    } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
    finally { setSavingId(null) }
  }

  if (isLoading) return <p className="text-xs text-slate-400 py-8 text-center">Đang tải…</p>
  if (!skills.length) return <p className="text-xs text-slate-400 py-8 text-center">Phòng/kho này chưa có vị trí nào — thêm ở tab "Danh mục vị trí" trước.</p>
  if (!data?.employees.length) return <p className="text-xs text-slate-400 py-8 text-center">Không có nhân viên thuộc phòng ban này tại kho đã chọn.</p>

  return (
    <div className="space-y-2">
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
      <p className="text-[11px] text-slate-500">
        Nhập <b>ưu tiên</b> cho mỗi ô (1 = sở trường chính, 2, 3… = phụ). Để trống = không làm được vị trí đó.
      </p>
      <div className="border border-slate-200 rounded-lg overflow-auto">
        <table className="text-xs border-collapse min-w-max">
          <thead className="bg-slate-50 text-[10px] text-slate-500 sticky top-0 z-10">
            <tr>
              <th className="text-left px-2 py-2 font-medium sticky left-0 bg-slate-50 z-20 min-w-[160px] border-r border-slate-200">Nhân viên</th>
              {skills.map(s => (
                <th key={s.id} className="px-1.5 py-2 font-medium border-r border-slate-100 min-w-[52px]">
                  <div className="leading-tight">{s.name}</div>
                  {s.shift_tag && <div className="text-[9px] text-slate-400 font-normal">{shiftLabel(s.shift_tag)}</div>}
                </th>
              ))}
              <th className="px-2 py-2 w-16 sticky right-0 bg-slate-50 border-l border-slate-200"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.employees.map(emp => (
              <tr key={emp.id} className="hover:bg-slate-50/60">
                <td className="px-2 py-1.5 sticky left-0 bg-white z-10 border-r border-slate-100">
                  <div className="font-medium text-slate-700 truncate">{emp.name}</div>
                  <div className="text-[10px] text-slate-400">{emp.employee_code}{emp.job_title ? ` · ${emp.job_title}` : ''}</div>
                </td>
                {skills.map(s => {
                  const v = edits[emp.id]?.[s.id] ?? 0
                  return (
                    <td key={s.id} className="px-1 py-1 text-center border-r border-slate-50">
                      <input
                        type="number" min={0} max={9} inputMode="numeric"
                        value={v || ''} disabled={!canAssign}
                        onChange={e => setCell(emp.id, s.id, Math.max(0, Math.min(9, Number(e.target.value) || 0)))}
                        placeholder="·"
                        className={`w-9 h-7 text-center text-xs rounded border outline-none
                          ${v > 0 ? 'border-sky-300 bg-sky-50 text-sky-700 font-semibold' : 'border-slate-200 text-slate-400'}
                          focus:border-sky-500 disabled:bg-slate-50`}
                      />
                    </td>
                  )
                })}
                <td className="px-2 py-1 text-center sticky right-0 bg-white border-l border-slate-100">
                  {canAssign && (
                    <Button size="sm" variant={dirty.has(emp.id) ? 'default' : 'outline'} disabled={!dirty.has(emp.id) || savingId === emp.id}
                      onClick={() => saveRow(emp.id)} className="h-7 px-2">
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
