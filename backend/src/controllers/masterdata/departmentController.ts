import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

const DEPT_SELECT = 'id, name, code, allowed_modules, is_active, created_at, updated_at'
const JT_SELECT   = 'id, name, department_id, is_active, module_permissions, department:Department(id,name,code)'

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

    const { data, error } = await supabase
      .from('Department')
      .insert({ id: randomUUID(), name, code: code.toUpperCase(), allowed_modules, updated_at: new Date().toISOString() })
      .select(DEPT_SELECT)
      .single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateDepartment(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { name, code, allowed_modules, is_active } = req.body as {
      name?: string; code?: string; allowed_modules?: string[]; is_active?: boolean
    }
    const { data, error } = await supabase
      .from('Department')
      .update({ name, code: code?.toUpperCase(), allowed_modules, is_active, updated_at: new Date().toISOString() })
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
    const { name, department_id, module_permissions } = req.body as {
      name: string
      department_id: string
      module_permissions?: Record<string, string[]>
    }
    if (!name || !department_id) return fail(res, 'name và department_id là bắt buộc', 400)

    const { data, error } = await supabase
      .from('JobTitle')
      .insert({
        id: randomUUID(),
        name, department_id,
        module_permissions: module_permissions ?? {},
        updated_at: new Date().toISOString(),
      })
      .select(JT_SELECT)
      .single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateJobTitle(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { name, is_active, module_permissions } = req.body as {
      name?: string; is_active?: boolean
      module_permissions?: Record<string, string[]>
    }
    const { data, error } = await supabase
      .from('JobTitle')
      .update({ name, is_active, module_permissions, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(JT_SELECT)
      .single()
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}
