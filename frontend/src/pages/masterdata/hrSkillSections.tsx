import { useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, Check, X, Save, Award } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useSkills, useCreateSkill, useUpdateSkill, useDeleteSkill,
  useEmployeeSkills, useSetEmployeeSkills, type SkillRow,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'

const SHIFT_OPTS: { value: string; label: string }[] = [
  { value: '',    label: '—' },
  { value: 'CA1', label: 'Ca 1' },
  { value: 'CA2', label: 'Ca 2' },
  { value: 'CA3', label: 'Ca 3' },
  { value: 'HC',  label: 'HC' },
]
const shiftLabel = (t: string | null) => SHIFT_OPTS.find(o => o.value === (t ?? ''))?.label ?? '—'

// ─── Danh mục skill của 1 Chức danh (trong dialog sửa chức danh) ─────────────
export function JobTitleSkillSection({ jobTitleId }: { jobTitleId: string }) {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canManage = can(perms, 'work_skill', 'manage')

  const { data: skills = [], isLoading } = useSkills({ job_title_id: jobTitleId, include_inactive: true })
  const createSkill = useCreateSkill()
  const updateSkill = useUpdateSkill()
  const deleteSkill = useDeleteSkill()
  const [err, setErr] = useState<string | null>(null)

  const [name, setName]   = useState('')
  const [shift, setShift] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [eName, setEName]   = useState('')
  const [eShift, setEShift] = useState('')

  async function add() {
    if (!name.trim()) return
    setErr(null)
    try { await createSkill.mutateAsync({ job_title_id: jobTitleId, name: name.trim(), shift_tag: shift || null, sort_order: skills.length }); setName(''); setShift('') }
    catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
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
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-600 flex items-center gap-1"><Award className="h-3.5 w-3.5" /> Danh mục Vị trí / Skill của chức danh</p>
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</div>}
      {canManage && (
        <div className="flex items-end gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="VD: Pallet, SCA, SX…" className="h-8 text-sm flex-1" />
          <select value={shift} onChange={e => setShift(e.target.value)} className="border border-slate-200 rounded-md px-2 text-sm h-8 bg-white">
            {SHIFT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Button onClick={add} disabled={!name.trim() || createSkill.isPending} className="h-8"><Plus className="h-4 w-4" /></Button>
        </div>
      )}
      <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
        {isLoading ? (
          <p className="text-center text-slate-400 py-3 text-xs">Đang tải…</p>
        ) : skills.length === 0 ? (
          <p className="text-center text-slate-400 py-3 text-xs">Chưa có vị trí nào</p>
        ) : skills.map(s => (
          <div key={s.id} className={`flex items-center gap-2 px-2.5 py-1.5 ${s.is_active ? '' : 'opacity-50'}`}>
            {editId === s.id ? (
              <>
                <Input value={eName} onChange={e => setEName(e.target.value)} className="h-7 text-sm flex-1" />
                <select value={eShift} onChange={e => setEShift(e.target.value)} className="border border-slate-200 rounded px-1.5 text-xs h-7 bg-white">
                  {SHIFT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <button onClick={() => saveEdit(s.id)} className="text-green-600 hover:bg-green-50 rounded p-1"><Check className="h-4 w-4" /></button>
                <button onClick={() => setEditId(null)} className="text-slate-400 hover:bg-slate-100 rounded p-1"><X className="h-4 w-4" /></button>
              </>
            ) : (
              <>
                <span className="text-sm text-slate-700 flex-1">{s.name}{!s.is_active && <span className="ml-1 text-[10px] text-slate-400">(ẩn)</span>}</span>
                <span className="text-[10px] text-slate-400">{shiftLabel(s.shift_tag)}</span>
                {canManage && <button onClick={() => startEdit(s)} className="text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded p-1"><Pencil className="h-3.5 w-3.5" /></button>}
                {canManage && <button onClick={() => remove(s)} className="text-slate-400 hover:text-red-600 hover:bg-red-50 rounded p-1"><Trash2 className="h-3.5 w-3.5" /></button>}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Chọn skill cho 1 Nhân viên (trong dialog sửa NV) ───────────────────────
export function EmployeeSkillSection({ employeeId }: { employeeId: string }) {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canAssign = can(perms, 'work_skill', 'assign')

  const { data, isLoading } = useEmployeeSkills(employeeId)
  const setSkills = useSetEmployeeSkills()
  const [err, setErr] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, number>>({})
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!data) return
    const m: Record<string, number> = {}
    for (const s of data.skills) m[s.id] = s.priority
    setEdits(m); setDirty(false)
  }, [data])

  function setCell(skillId: string, v: number) { setEdits(p => ({ ...p, [skillId]: v })); setDirty(true) }
  async function save() {
    setErr(null)
    try {
      const list = Object.entries(edits).filter(([, p]) => p > 0).map(([skill_id, priority]) => ({ skill_id, priority }))
      await setSkills.mutateAsync({ employee_id: employeeId, skills: list }); setDirty(false)
    } catch (e) { setErr(String((e as { message?: string })?.message ?? e)) }
  }

  if (isLoading) return <p className="text-xs text-slate-400">Đang tải kỹ năng…</p>
  if (!data?.job_title_id) return <p className="text-xs text-slate-400">Chọn chức danh để gán kỹ năng.</p>
  if (!data.skills.length) return <p className="text-xs text-slate-400">Chức danh này chưa có danh mục skill (thêm ở Chức danh).</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600 flex items-center gap-1"><Award className="h-3.5 w-3.5" /> Kỹ năng / Vị trí (ưu tiên 1 = chính)</p>
        {canAssign && <Button size="sm" variant={dirty ? 'default' : 'outline'} disabled={!dirty || setSkills.isPending} onClick={save} className="h-7"><Save className="h-3.5 w-3.5 mr-1" />Lưu</Button>}
      </div>
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</div>}
      <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
        {data.skills.map(s => {
          const v = edits[s.id] ?? 0
          return (
            <div key={s.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="text-sm text-slate-700 flex-1">{s.name}{s.shift_tag && <span className="ml-1 text-[10px] text-slate-400">{shiftLabel(s.shift_tag)}</span>}</span>
              <input type="number" min={0} max={9} value={v || ''} disabled={!canAssign} placeholder="·"
                onChange={e => setCell(s.id, Math.max(0, Math.min(9, Number(e.target.value) || 0)))}
                className={`w-10 h-7 text-center text-xs rounded border outline-none ${v > 0 ? 'border-sky-300 bg-sky-50 text-sky-700 font-semibold' : 'border-slate-200 text-slate-400'} focus:border-sky-500 disabled:bg-slate-50`} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
