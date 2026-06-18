import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

// Chống leo thang: non-superadmin không được cấp cho chức danh quyền mà CHÍNH MÌNH không có.
// Trả message lỗi nếu vi phạm, null nếu hợp lệ.
function escalationError(req: Request, perms?: Record<string, string[]>): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = (req as any).user
  if (u?.name === 'Admin') return null
  const mine: Record<string, string[]> = u?.module_permissions ?? {}
  for (const [mod, actions] of Object.entries(perms ?? {})) {
    for (const a of (actions ?? [])) {
      if (!mine[mod]?.includes(a)) return `Không thể cấp quyền vượt quá quyền của bạn: ${mod}.${a}`
    }
  }
  return null
}

const DEPT_SELECT = 'id, name, code, allowed_modules, requires_scheduling, is_active, created_at, updated_at, created_by, updated_by'
const JT_SELECT   = 'id, name, department_id, parent_id, in_chart, is_active, module_permissions, created_at, updated_at, created_by, updated_by, department:Department(id,name,code)'

// ─── Departments ──────────────────────────────────────────────────────────────

export async function listDepartments(_req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('Department')
      .select(DEPT_SELECT)
      .eq('is_active', true)
      .order('name')
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function createDepartment(req: Request, res: Response) {
  try {
    const { name, code, allowed_modules = [] } = req.body as {
      name: string; code: string; allowed_modules?: string[]
    }
    if (!name || !code) return fail(res, 'name và code là bắt buộc', 400)

    const actor = (req as any).user?.name || null
    const { data, error } = await supabase
      .from('Department')
      .insert({ id: randomUUID(), name, code: code.toUpperCase(), allowed_modules, updated_at: new Date().toISOString(), created_by: actor, updated_by: actor })
      .select(DEPT_SELECT)
      .single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateDepartment(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { name, code, allowed_modules, is_active, requires_scheduling } = req.body as {
      name?: string; code?: string; allowed_modules?: string[]; is_active?: boolean; requires_scheduling?: boolean
    }
    const { data, error } = await supabase
      .from('Department')
      .update({ name, code: code?.toUpperCase(), allowed_modules, is_active, requires_scheduling, updated_at: new Date().toISOString(), updated_by: (req as any).user?.name || null })
      .eq('id', id)
      .select(DEPT_SELECT)
      .single()
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Job Titles ───────────────────────────────────────────────────────────────

export async function listJobTitles(req: Request, res: Response) {
  try {
    const { department_id } = req.query as { department_id?: string }
    let q = supabase.from('JobTitle').select(JT_SELECT).eq('is_active', true).order('name')
    if (department_id) q = q.eq('department_id', department_id)
    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function createJobTitle(req: Request, res: Response) {
  try {
    const { name, department_id, module_permissions, parent_id, in_chart } = req.body as {
      name: string
      department_id: string
      module_permissions?: Record<string, string[]>
      parent_id?: string | null
      in_chart?: boolean
    }
    if (!name || !department_id) return fail(res, 'name và department_id là bắt buộc', 400)
    const escErr = escalationError(req, module_permissions)
    if (escErr) return fail(res, escErr, 403)

    const actor = (req as any).user?.name || null
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('JobTitle')
      .insert({
        id: randomUUID(),
        name, department_id,
        parent_id: parent_id || null,
        in_chart: in_chart ?? false,
        module_permissions: module_permissions ?? {},
        created_at: now, updated_at: now,
        created_by: actor, updated_by: actor,
      })
      .select(JT_SELECT)
      .single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

// Đặt chức danh cấp trên (kéo-thả sơ đồ tổ chức) — chống vòng lặp
export async function setJobTitleParent(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { parent_id, in_chart } = req.body as { parent_id?: string | null; in_chart?: boolean }
    const parent = parent_id || null
    if (parent === id) return fail(res, 'Không thể đặt chính nó làm cấp trên', 400)
    if (parent) {
      let cur: string | null = parent
      const seen = new Set<string>()
      while (cur) {
        if (cur === id) return fail(res, 'Không thể tạo vòng lặp phân cấp', 400)
        if (seen.has(cur)) break
        seen.add(cur)
        const r: { data: { parent_id: string | null } | null } = await supabase.from('JobTitle').select('parent_id').eq('id', cur).maybeSingle()
        cur = r.data?.parent_id ?? null
      }
    }
    const upd: Record<string, unknown> = { parent_id: parent, updated_at: new Date().toISOString(), updated_by: (req as any).user?.name || null }
    if (in_chart !== undefined) upd.in_chart = in_chart
    const { data, error } = await supabase.from('JobTitle')
      .update(upd)
      .eq('id', id).select(JT_SELECT).single()
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateJobTitle(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { name, is_active, module_permissions } = req.body as {
      name?: string; is_active?: boolean
      module_permissions?: Record<string, string[]>
    }
    const escErr = escalationError(req, module_permissions)
    if (escErr) return fail(res, escErr, 403)
    const { data, error } = await supabase
      .from('JobTitle')
      .update({ name, is_active, module_permissions, updated_at: new Date().toISOString(), updated_by: (req as any).user?.name || null })
      .eq('id', id)
      .select(JT_SELECT)
      .single()
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}
