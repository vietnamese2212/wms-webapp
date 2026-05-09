import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

const EMP_SELECT = `
  id, name, employee_code, email, phone, role,
  department, department_id, job_title_id,
  action_level, allowed_categories, warehouse_scope,
  warehouse_id, is_active, created_at,
  dept:Department(id, name, code),
  job_title:JobTitle(id, name, action_level, allowed_categories, warehouse_scope),
  warehouse_access:UserWarehouseAccess(warehouse_id, warehouse:Warehouse(id,code,name))
`.trim()

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listEmployees(req: Request, res: Response) {
  try {
    const { department_id, is_active, search } = req.query as Record<string, string>

    let q = supabase.from('Employee').select(EMP_SELECT).order('name')

    if (department_id) q = q.eq('department_id', department_id)
    if (is_active !== undefined) q = q.eq('is_active', is_active === 'true')
    if (search) q = q.or(`name.ilike.%${search}%,employee_code.ilike.%${search}%,email.ilike.%${search}%`)

    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function getEmployee(req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('Employee').select(EMP_SELECT).eq('id', req.params.id).maybeSingle()
    if (error) return fail(res, error.message)
    if (!data) return fail(res, 'Không tìm thấy nhân viên', 404)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createEmployee(req: Request, res: Response) {
  try {
    const {
      name, employee_code, email, phone,
      department_id, job_title_id,
      action_level, allowed_categories, warehouse_scope,
      warehouse_ids = [],
    } = req.body as {
      name: string; employee_code: string; email?: string; phone?: string
      department_id?: string; job_title_id?: string
      action_level?: string; allowed_categories?: string[]; warehouse_scope?: string
      warehouse_ids?: string[]
    }

    if (!name || !employee_code) return fail(res, 'name và employee_code là bắt buộc', 400)

    // Nếu chọn JobTitle mà không override, lấy default từ template
    let finalActionLevel = action_level
    let finalCategories  = allowed_categories
    let finalScope       = warehouse_scope

    if (job_title_id && (!finalActionLevel || !finalCategories)) {
      const { data: jt } = await supabase
        .from('JobTitle')
        .select('action_level, allowed_categories, warehouse_scope')
        .eq('id', job_title_id).single()
      if (jt) {
        finalActionLevel = finalActionLevel ?? jt.action_level
        finalCategories  = finalCategories  ?? jt.allowed_categories
        finalScope       = finalScope       ?? jt.warehouse_scope
      }
    }

    const empId = randomUUID()
    const { data: emp, error } = await supabase
      .from('Employee')
      .insert({
        id: empId, name, employee_code,
        email: email || null, phone: phone || null,
        department_id: department_id || null,
        job_title_id:  job_title_id  || null,
        action_level:  finalActionLevel  || 'VIEWER',
        allowed_categories: finalCategories ?? [],
        warehouse_scope: finalScope ?? 'ASSIGNED',
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error) return fail(res, error.message)

    // Gán warehouse access
    if (warehouse_ids.length > 0) {
      await supabase.from('UserWarehouseAccess').insert(
        warehouse_ids.map(wid => ({
          id: randomUUID(), employee_id: empId, warehouse_id: wid,
        }))
      )
    }

    const { data: full } = await supabase.from('Employee').select(EMP_SELECT).eq('id', emp.id).single()
    return ok(res, full, 201)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateEmployee(req: Request, res: Response) {
  try {
    const { id } = req.params
    const {
      name, phone, email,
      department_id, job_title_id,
      action_level, allowed_categories, warehouse_scope,
      is_active,
    } = req.body as {
      name?: string; phone?: string; email?: string
      department_id?: string; job_title_id?: string
      action_level?: string; allowed_categories?: string[]; warehouse_scope?: string
      is_active?: boolean
    }

    const { error } = await supabase
      .from('Employee')
      .update({
        name, phone, email,
        department_id, job_title_id,
        action_level, allowed_categories, warehouse_scope,
        is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) return fail(res, error.message)

    const { data: full } = await supabase.from('Employee').select(EMP_SELECT).eq('id', id).single()
    return ok(res, full)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Warehouse access ─────────────────────────────────────────────────────────

export async function setWarehouseAccess(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { warehouse_ids } = req.body as { warehouse_ids: string[] }

    // Xóa cũ, thêm mới
    await supabase.from('UserWarehouseAccess').delete().eq('employee_id', id)

    if (warehouse_ids.length > 0) {
      await supabase.from('UserWarehouseAccess').insert(
        warehouse_ids.map(wid => ({
          id: randomUUID(), employee_id: id, warehouse_id: wid,
        }))
      )
    }

    const { data } = await supabase
      .from('UserWarehouseAccess')
      .select('warehouse_id, warehouse:Warehouse(id,code,name)')
      .eq('employee_id', id)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}
