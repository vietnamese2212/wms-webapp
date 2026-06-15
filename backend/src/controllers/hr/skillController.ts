import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

type Actor = string | null
const actorOf = (req: Request): Actor => (req as { user?: { name?: string } }).user?.name ?? null

const SKILL_SELECT = 'id, warehouse_id, department_id, name, shift_tag, sort_order, is_active, created_at, updated_at'

// ─── Skill (Vị trí phân công / kỹ năng) ─────────────────────────────────────────

export async function listSkills(req: Request, res: Response) {
  try {
    const { warehouse_id, department_id, include_inactive } = req.query as Record<string, string>
    let q = supabase.from('Skill').select(SKILL_SELECT).order('sort_order').order('name')
    if (warehouse_id)  q = q.eq('warehouse_id', warehouse_id)
    if (department_id) q = q.eq('department_id', department_id)
    if (include_inactive !== 'true') q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function createSkill(req: Request, res: Response) {
  try {
    const { warehouse_id, department_id, name, shift_tag, sort_order } = req.body as {
      warehouse_id?: string; department_id?: string; name?: string; shift_tag?: string | null; sort_order?: number
    }
    if (!warehouse_id || !department_id || !name?.trim())
      return fail(res, 'warehouse_id, department_id và name là bắt buộc', 400)

    const now = new Date().toISOString()
    const actor = actorOf(req)
    const { data, error } = await supabase.from('Skill').insert({
      id: randomUUID(),
      warehouse_id, department_id,
      name: name.trim(),
      shift_tag: shift_tag || null,
      sort_order: sort_order ?? 0,
      is_active: true,
      created_at: now, updated_at: now,
      created_by: actor, updated_by: actor,
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
    // Nếu skill đã dùng trong EmployeeSkill / demand → soft-disable, không hard delete
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

// ─── EmployeeSkill (gán skill cho NV, có ưu tiên) ───────────────────────────────

// Ma trận NV × Skill cho 1 Kho + phòng ban
export async function employeeSkillMatrix(req: Request, res: Response) {
  try {
    const { warehouse_id, department_id } = req.query as Record<string, string>
    if (!warehouse_id || !department_id) return fail(res, 'warehouse_id và department_id là bắt buộc', 400)

    // 1. Skills của kho + phòng
    const { data: skills, error: sErr } = await supabase.from('Skill')
      .select(SKILL_SELECT).eq('warehouse_id', warehouse_id).eq('department_id', department_id)
      .eq('is_active', true).order('sort_order').order('name')
    if (sErr) return fail(res, sErr.message)

    // 2. NV thuộc phòng + có quyền truy cập kho này
    const { data: waRows } = await supabase.from('UserWarehouseAccess')
      .select('employee_id').eq('warehouse_id', warehouse_id)
    const empIdsWithAccess = new Set((waRows ?? []).map((r: { employee_id: string }) => r.employee_id))

    const { data: emps, error: eErr } = await supabase.from('Employee')
      .select('id, name, employee_code, job_title_id')
      .eq('department_id', department_id).eq('is_active', true).is('deleted_at', null).order('name')
    if (eErr) return fail(res, eErr.message)

    const employees = (emps ?? []).filter((e: { id: string }) => empIdsWithAccess.has(e.id))
    const empIds = employees.map((e: { id: string }) => e.id)

    // job titles
    const jtIds = [...new Set(employees.map((e: { job_title_id: string | null }) => e.job_title_id).filter(Boolean))] as string[]
    const { data: jts } = jtIds.length
      ? await supabase.from('JobTitle').select('id, name').in('id', jtIds)
      : { data: [] as { id: string; name: string }[] }
    const jtMap = new Map((jts ?? []).map((j: { id: string; name: string }) => [j.id, j.name]))

    // 3. EmployeeSkill hiện có (chỉ trong skill set này)
    const skillIds = (skills ?? []).map((s: { id: string }) => s.id)
    const { data: esRows } = empIds.length && skillIds.length
      ? await supabase.from('EmployeeSkill').select('employee_id, skill_id, priority')
          .in('employee_id', empIds).in('skill_id', skillIds)
      : { data: [] as { employee_id: string; skill_id: string; priority: number }[] }

    const byEmp = new Map<string, { skill_id: string; priority: number }[]>()
    for (const r of (esRows ?? []) as { employee_id: string; skill_id: string; priority: number }[]) {
      const list = byEmp.get(r.employee_id) ?? []
      list.push({ skill_id: r.skill_id, priority: r.priority })
      byEmp.set(r.employee_id, list)
    }

    return ok(res, {
      skills: skills ?? [],
      employees: employees.map((e: { id: string; name: string; employee_code: string; job_title_id: string | null }) => ({
        id: e.id, name: e.name, employee_code: e.employee_code,
        job_title: e.job_title_id ? jtMap.get(e.job_title_id) ?? null : null,
        skills: byEmp.get(e.id) ?? [],
      })),
    })
  } catch (e) { return fail(res, String(e)) }
}

// Thay toàn bộ skill của 1 NV trong phạm vi 1 Kho + phòng (replace)
export async function setEmployeeSkills(req: Request, res: Response) {
  try {
    const { id } = req.params // employee_id
    const { warehouse_id, department_id, skills } = req.body as {
      warehouse_id?: string; department_id?: string
      skills?: { skill_id: string; priority: number }[]
    }
    if (!warehouse_id || !department_id) return fail(res, 'warehouse_id và department_id là bắt buộc', 400)

    // skill ids hợp lệ trong phạm vi
    const { data: scopeSkills } = await supabase.from('Skill').select('id')
      .eq('warehouse_id', warehouse_id).eq('department_id', department_id)
    const scopeIds = new Set((scopeSkills ?? []).map((s: { id: string }) => s.id))

    // xóa EmployeeSkill cũ của NV trong phạm vi này
    if (scopeIds.size) {
      await supabase.from('EmployeeSkill').delete().eq('employee_id', id).in('skill_id', [...scopeIds])
    }

    const valid = (skills ?? []).filter(s => scopeIds.has(s.skill_id))
    if (valid.length) {
      const now = new Date().toISOString()
      const { error } = await supabase.from('EmployeeSkill').insert(
        valid.map(s => ({
          id: randomUUID(), employee_id: id, skill_id: s.skill_id,
          priority: s.priority ?? 1, created_at: now, updated_at: now,
        }))
      )
      if (error) return fail(res, error.message)
    }
    return ok(res, { employee_id: id, count: valid.length })
  } catch (e) { return fail(res, String(e)) }
}
