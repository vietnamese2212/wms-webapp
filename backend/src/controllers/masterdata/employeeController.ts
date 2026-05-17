import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import bcrypt from 'bcrypt'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

interface EmpRow {
  id: string; name: string; employee_code: string; email: string | null; phone: string | null
  role: string; department: string | null; department_id: string | null; job_title_id: string | null
  action_level: string | null; allowed_categories: string[] | null; warehouse_scope: string | null
  warehouse_id: string | null; is_active: boolean; created_at: string
}

const EMP_BASE = [
  'id', 'name', 'employee_code', 'email', 'phone', 'role',
  'department', 'department_id', 'job_title_id',
  'action_level', 'allowed_categories', 'warehouse_scope',
  'warehouse_id', 'is_active', 'created_at',
].join(', ')

// Fetch employees và join dept / job_title / warehouse_access thủ công
// (tránh Supabase FK join cho FK mới — PostgREST schema cache có thể chưa reload)
async function fetchFull(opts: {
  ids?: string[]
  department_id?: string
  is_active?: boolean
  search?: string
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('Employee') as any).select(EMP_BASE).order('name')
  if (opts.ids?.length)      q = q.in('id', opts.ids)
  if (opts.department_id)    q = q.eq('department_id', opts.department_id)
  if (opts.is_active !== undefined) q = q.eq('is_active', opts.is_active)
  if (opts.search)           q = q.or(`name.ilike.%${opts.search}%,employee_code.ilike.%${opts.search}%,email.ilike.%${opts.search}%`)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  const emps = (data ?? []) as EmpRow[]
  if (!emps.length) return []

  // ── Departments ────────────────────────────────────────────────────────────
  const deptIds = [...new Set(emps.map(e => e.department_id).filter((x): x is string => !!x))]
  const { data: depts } = deptIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (supabase.from('Department') as any).select('id, name, code').in('id', deptIds)
    : { data: [] as { id: string; name: string; code: string }[] }

  // ── JobTitles ──────────────────────────────────────────────────────────────
  const jtIds = [...new Set(emps.map(e => e.job_title_id).filter((x): x is string => !!x))]
  const { data: jts } = jtIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (supabase.from('JobTitle') as any).select('id, name, action_level, allowed_categories, warehouse_scope').in('id', jtIds)
    : { data: [] as { id: string; name: string; action_level: string; allowed_categories: string[]; warehouse_scope: string }[] }

  // ── Warehouse access ───────────────────────────────────────────────────────
  const empIds = emps.map(e => e.id)
  const { data: waRows } = await (supabase.from('UserWarehouseAccess') as any)
    .select('employee_id, warehouse_id')
    .in('employee_id', empIds)

  const wIds = [...new Set(((waRows ?? []) as { employee_id: string; warehouse_id: string }[]).map(r => r.warehouse_id))]
  const { data: whs } = wIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (supabase.from('Warehouse') as any).select('id, code, name').in('id', wIds)
    : { data: [] as { id: string; code: string; name: string }[] }

  // ── Merge ──────────────────────────────────────────────────────────────────
  const deptMap = new Map(((depts ?? []) as { id: string; name: string; code: string }[]).map(d => [d.id, d]))
  const jtMap   = new Map(((jts   ?? []) as { id: string; name: string; action_level: string; allowed_categories: string[]; warehouse_scope: string }[]).map(j => [j.id, j]))
  const whMap   = new Map(((whs   ?? []) as { id: string; code: string; name: string }[]).map(w => [w.id, w]))

  const waByEmp = new Map<string, { warehouse_id: string; warehouse: { id: string; code: string; name: string } | null }[]>()
  for (const wa of ((waRows ?? []) as { employee_id: string; warehouse_id: string }[])) {
    const list = waByEmp.get(wa.employee_id) ?? []
    list.push({ warehouse_id: wa.warehouse_id, warehouse: whMap.get(wa.warehouse_id) ?? null })
    waByEmp.set(wa.employee_id, list)
  }

  return emps.map(emp => ({
    ...emp,
    dept:             deptMap.get(emp.department_id ?? '') ?? null,
    job_title:        jtMap.get(emp.job_title_id ?? '')   ?? null,
    warehouse_access: waByEmp.get(emp.id)                 ?? [],
  }))
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listEmployees(req: Request, res: Response) {
  try {
    const { department_id, is_active, search } = req.query as Record<string, string>
    const data = await fetchFull({
      department_id: department_id || undefined,
      is_active: is_active !== undefined ? is_active === 'true' : undefined,
      search: search || undefined,
    })
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function getEmployee(req: Request, res: Response) {
  try {
    const rows = await fetchFull({ ids: [req.params.id] })
    if (!rows.length) return fail(res, 'Không tìm thấy nhân viên', 404)
    return ok(res, rows[0])
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

    let finalActionLevel = action_level
    let finalCategories  = allowed_categories
    let finalScope       = warehouse_scope

    if (job_title_id && (!finalActionLevel || !finalCategories)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: jt } = await (supabase.from('JobTitle') as any)
        .select('action_level, allowed_categories, warehouse_scope')
        .eq('id', job_title_id).single()
      if (jt) {
        finalActionLevel = finalActionLevel ?? jt.action_level
        finalCategories  = finalCategories  ?? jt.allowed_categories
        finalScope       = finalScope       ?? jt.warehouse_scope
      }
    }

    const empId = randomUUID()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('Employee') as any).insert({
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
    if (error) return fail(res, error.message)

    if (warehouse_ids.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('UserWarehouseAccess') as any).insert(
        warehouse_ids.map(wid => ({
          id: randomUUID(), employee_id: empId, warehouse_id: wid,
        }))
      )
    }

    const rows = await fetchFull({ ids: [empId] })
    return ok(res, rows[0], 201)
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
      warehouse_ids,
      is_active,
    } = req.body as {
      name?: string; phone?: string; email?: string
      department_id?: string; job_title_id?: string
      action_level?: string; allowed_categories?: string[]; warehouse_scope?: string
      warehouse_ids?: string[]
      is_active?: boolean
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('Employee') as any)
      .update({ name, phone, email, department_id, job_title_id, action_level, allowed_categories, warehouse_scope, is_active, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return fail(res, error.message)

    if (warehouse_ids !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('UserWarehouseAccess') as any).delete().eq('employee_id', id)
      if (warehouse_ids.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('UserWarehouseAccess') as any).insert(
          warehouse_ids.map(wid => ({ id: randomUUID(), employee_id: id, warehouse_id: wid }))
        )
      }
    }

    const rows = await fetchFull({ ids: [id] })
    return ok(res, rows[0])
  } catch (e) { return fail(res, String(e)) }
}

// ─── Set password (admin only) ────────────────────────────────────────────────

export async function setPassword(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { password } = req.body as { password?: string }
    if (!password || password.length < 6) return fail(res, 'Mật khẩu phải có ít nhất 6 ký tự', 400)

    const hash = await bcrypt.hash(password, 10)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('Employee') as any)
      .update({ password_hash: hash, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return fail(res, error.message)

    return ok(res, { message: 'Đặt mật khẩu thành công' })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Warehouse access ─────────────────────────────────────────────────────────

export async function setWarehouseAccess(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { warehouse_ids } = req.body as { warehouse_ids: string[] }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('UserWarehouseAccess') as any).delete().eq('employee_id', id)
    if (warehouse_ids.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('UserWarehouseAccess') as any).insert(
        warehouse_ids.map(wid => ({ id: randomUUID(), employee_id: id, warehouse_id: wid }))
      )
    }

    const rows = await fetchFull({ ids: [id] })
    return ok(res, rows[0])
  } catch (e) { return fail(res, String(e)) }
}
