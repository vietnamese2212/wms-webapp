import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

type Actor = string | null
const actorOf = (req: Request): Actor => (req as { user?: { name?: string } }).user?.name ?? null
const SKILL_SELECT = 'id, job_title_id, name, shift_tag, sort_order, is_active, created_at, updated_at'

// chức danh thuộc 1 phòng ban
async function jobTitleIdsOfDept(department_id: string): Promise<string[]> {
  const { data } = await supabase.from('JobTitle').select('id').eq('department_id', department_id)
  return (data ?? []).map((j: { id: string }) => j.id)
}

// chức danh root + TẤT CẢ chức danh cấp dưới (theo sơ đồ tổ chức parent_id)
// → cấp trên có thể được gán skill của cấp dưới
async function scopeJobTitleIds(rootJtId: string): Promise<string[]> {
  const { data } = await supabase.from('JobTitle').select('id, parent_id')
  const rows = (data ?? []) as { id: string; parent_id: string | null }[]
  const childrenOf = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.parent_id) continue
    const arr = childrenOf.get(r.parent_id) ?? []
    arr.push(r.id); childrenOf.set(r.parent_id, arr)
  }
  const out = new Set<string>([rootJtId])
  const stack = [rootJtId]
  while (stack.length) {
    const cur = stack.pop() as string
    for (const c of childrenOf.get(cur) ?? []) if (!out.has(c)) { out.add(c); stack.push(c) }
  }
  return [...out]
}

// ─── Skill (Vị trí phân công / kỹ năng) — thuộc Chức danh ────────────────────

export async function listSkills(req: Request, res: Response) {
  try {
    const { job_title_id, department_id, include_inactive } = req.query as Record<string, string>
    let jtIds: string[] | null = null
    if (job_title_id)      jtIds = [job_title_id]
    else if (department_id) jtIds = await jobTitleIdsOfDept(department_id)

    let q = supabase.from('Skill').select(SKILL_SELECT).order('sort_order').order('name')
    if (jtIds) q = q.in('job_title_id', jtIds.length ? jtIds : ['__none__'])
    if (include_inactive !== 'true') q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) return fail(res, error.message)

    // gắn tên chức danh (phục vụ nhãn "Vị trí phân công" khi phân công)
    const skills = (data ?? []) as { job_title_id: string | null }[]
    const ids = [...new Set(skills.map(s => s.job_title_id).filter(Boolean))] as string[]
    const { data: jts } = ids.length ? await supabase.from('JobTitle').select('id, name').in('id', ids) : { data: [] }
    const jtMap = new Map((jts ?? []).map((j: { id: string; name: string }) => [j.id, j.name]))
    return ok(res, skills.map(s => ({ ...s, job_title: s.job_title_id ? jtMap.get(s.job_title_id) ?? null : null })))
  } catch (e) { return fail(res, String(e)) }
}

export async function createSkill(req: Request, res: Response) {
  try {
    const { job_title_id, name, shift_tag, sort_order } = req.body as {
      job_title_id?: string; name?: string; shift_tag?: string | null; sort_order?: number
    }
    if (!job_title_id || !name?.trim()) return fail(res, 'job_title_id và name là bắt buộc', 400)
    const now = new Date().toISOString()
    const actor = actorOf(req)
    const { data, error } = await supabase.from('Skill').insert({
      id: randomUUID(), job_title_id, name: name.trim(),
      shift_tag: shift_tag || null, sort_order: sort_order ?? 0, is_active: true,
      created_at: now, updated_at: now, created_by: actor, updated_by: actor,
    }).select(SKILL_SELECT).single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateSkill(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { name, shift_tag, sort_order, is_active } = req.body as {
      name?: string; shift_tag?: string | null; sort_order?: number; is_active?: boolean
    }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actorOf(req) }
    if (name       !== undefined) updates.name       = name.trim()
    if (shift_tag  !== undefined) updates.shift_tag  = shift_tag || null
    if (sort_order !== undefined) updates.sort_order = sort_order
    if (is_active  !== undefined) updates.is_active  = is_active
    const { data, error } = await supabase.from('Skill').update(updates).eq('id', id).select(SKILL_SELECT).single()
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteSkill(req: Request, res: Response) {
  try {
    const { id } = req.params
    const [{ count: esCount }, { count: dmCount }] = await Promise.all([
      supabase.from('EmployeeSkill').select('id', { count: 'exact', head: true }).eq('skill_id', id),
      supabase.from('WorkAssignmentDemand').select('id', { count: 'exact', head: true }).eq('skill_id', id),
    ])
    if ((esCount ?? 0) > 0 || (dmCount ?? 0) > 0) {
      const { error } = await supabase.from('Skill')
        .update({ is_active: false, updated_at: new Date().toISOString(), updated_by: actorOf(req) }).eq('id', id)
      if (error) return fail(res, error.message)
      return ok(res, { deleted: 'soft', message: 'Vị trí đang được sử dụng — đã ẩn' })
    }
    const { error } = await supabase.from('Skill').delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { deleted: 'hard' })
  } catch (e) { return fail(res, String(e)) }
}

// ─── EmployeeSkill (NV pick skill từ chức danh của mình, có ưu tiên) ─────────

// Skill của chức danh NV + ưu tiên hiện có
export async function getEmployeeSkills(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { data: emp } = await supabase.from('Employee').select('id, job_title_id').eq('id', id).maybeSingle()
    if (!emp) return fail(res, 'Không tìm thấy nhân viên', 404)
    const jtId = (emp as { job_title_id: string | null }).job_title_id
    if (!jtId) return ok(res, { job_title_id: null, skills: [] })

    // scope = chức danh NV + chức danh cấp dưới (cấp trên được dùng skill cấp dưới)
    const scopeJts = await scopeJobTitleIds(jtId)
    const { data: skills } = await supabase.from('Skill').select(SKILL_SELECT)
      .in('job_title_id', scopeJts).eq('is_active', true).order('sort_order').order('name')
    const { data: es } = await supabase.from('EmployeeSkill').select('skill_id, priority').eq('employee_id', id)
    const priMap = new Map((es ?? []).map((r: { skill_id: string; priority: number }) => [r.skill_id, r.priority]))
    // tên chức danh để nhóm (skill của mình vs cấp dưới)
    const { data: jts } = await supabase.from('JobTitle').select('id, name').in('id', scopeJts)
    const jtMap = new Map((jts ?? []).map((j: { id: string; name: string }) => [j.id, j.name]))
    return ok(res, {
      job_title_id: jtId,
      skills: (skills ?? []).map((s: { id: string; job_title_id: string | null }) => ({
        ...s, job_title: s.job_title_id ? jtMap.get(s.job_title_id) ?? null : null, priority: priMap.get(s.id) ?? 0,
      })),
    })
  } catch (e) { return fail(res, String(e)) }
}

// Thay toàn bộ skill của NV (scope = skill của chức danh NV)
export async function setEmployeeSkills(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { skills } = req.body as { skills?: { skill_id: string; priority: number }[] }

    const { data: emp } = await supabase.from('Employee').select('job_title_id').eq('id', id).maybeSingle()
    const jtId = (emp as { job_title_id: string | null } | null)?.job_title_id
    if (!jtId) return fail(res, 'Nhân viên chưa có chức danh', 400)

    const scopeJts = await scopeJobTitleIds(jtId)
    const { data: scopeSkills } = await supabase.from('Skill').select('id').in('job_title_id', scopeJts)
    const scopeIds = new Set((scopeSkills ?? []).map((s: { id: string }) => s.id))

    if (scopeIds.size) await supabase.from('EmployeeSkill').delete().eq('employee_id', id).in('skill_id', [...scopeIds])
    const valid = (skills ?? []).filter(s => scopeIds.has(s.skill_id) && s.priority > 0)
    if (valid.length) {
      const now = new Date().toISOString()
      const { error } = await supabase.from('EmployeeSkill').insert(
        valid.map(s => ({ id: randomUUID(), employee_id: id, skill_id: s.skill_id, priority: s.priority, created_at: now, updated_at: now }))
      )
      if (error) return fail(res, error.message)
    }
    return ok(res, { employee_id: id, count: valid.length })
  } catch (e) { return fail(res, String(e)) }
}
