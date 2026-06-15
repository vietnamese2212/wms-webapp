import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

type ReqUser = { sub?: string; name?: string }
const userOf = (req: Request): ReqUser => (req as { user?: ReqUser }).user ?? {}

const LEAVE_SELECT = 'id, employee_id, warehouse_id, date_from, date_to, leave_type, reason, status, approved_by, approved_at, created_at, updated_at'

// gắn thông tin NV (tên, mã, phòng)
async function attachEmployees<T extends { employee_id: string }>(rows: T[]) {
  if (!rows.length) return rows.map(r => ({ ...r, employee: null }))
  const ids = [...new Set(rows.map(r => r.employee_id))]
  const { data: emps } = await supabase.from('Employee')
    .select('id, name, employee_code, department_id, job_title_id, warehouse_scope').in('id', ids)
  const map = new Map((emps ?? []).map((e: { id: string }) => [e.id, e]))
  return rows.map(r => ({ ...r, employee: map.get(r.employee_id) ?? null }))
}

// ── Quyền duyệt: chức danh cấp trên trực tiếp của người xin + CHUNG KHO ──
type ApproverCtx = { job_title_id: string | null; scope: string | null; whs: Set<string> }
async function approverContext(sub?: string): Promise<ApproverCtx> {
  if (!sub) return { job_title_id: null, scope: null, whs: new Set() }
  const { data: a } = await supabase.from('Employee').select('job_title_id, warehouse_scope').eq('id', sub).maybeSingle()
  const { data: wa } = await supabase.from('UserWarehouseAccess').select('warehouse_id').eq('employee_id', sub)
  const e = a as { job_title_id: string | null; warehouse_scope: string | null } | null
  return { job_title_id: e?.job_title_id ?? null, scope: e?.warehouse_scope ?? null, whs: new Set((wa ?? []).map((r: { warehouse_id: string }) => r.warehouse_id)) }
}
// employeeId có phải cấp dưới (theo chức danh) + chung kho với approver?
async function isSubordinate(ctx: ApproverCtx, employeeId: string): Promise<boolean> {
  if (!ctx.job_title_id) return false
  const { data: emp } = await supabase.from('Employee').select('job_title_id, warehouse_scope').eq('id', employeeId).maybeSingle()
  const e = emp as { job_title_id: string | null; warehouse_scope: string | null } | null
  if (!e?.job_title_id) return false
  const { data: jt } = await supabase.from('JobTitle').select('parent_id').eq('id', e.job_title_id).maybeSingle()
  if ((jt as { parent_id: string | null } | null)?.parent_id !== ctx.job_title_id) return false
  // chung kho (NATIONAL = mọi kho)
  if (ctx.scope === 'NATIONAL' || e.warehouse_scope === 'NATIONAL') return true
  const { data: wa } = await supabase.from('UserWarehouseAccess').select('warehouse_id').eq('employee_id', employeeId)
  return (wa ?? []).some((r: { warehouse_id: string }) => ctx.whs.has(r.warehouse_id))
}

export async function listLeaves(req: Request, res: Response) {
  try {
    const { warehouse_id, department_id, employee_id, status, date_from, date_to, to_approve } = req.query as Record<string, string>
    let q = supabase.from('LeaveRequest').select(LEAVE_SELECT).order('date_from', { ascending: false })
    if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)
    if (employee_id)  q = q.eq('employee_id', employee_id)
    if (status)       q = q.eq('status', status)
    // overlap khoảng ngày: date_from <= to AND date_to >= from
    if (date_to)      q = q.lte('date_from', date_to)
    if (date_from)    q = q.gte('date_to', date_from)
    const { data, error } = await q
    if (error) return fail(res, error.message)

    let rows = (data ?? []) as { employee_id: string; [k: string]: unknown }[]
    let withEmp = await attachEmployees(rows)
    if (department_id) {
      withEmp = withEmp.filter(r => (r.employee as { department_id?: string } | null)?.department_id === department_id)
    }
    // chỉ đơn của cấp dưới (chức danh con + chung kho) của người đăng nhập
    if (to_approve === 'true') {
      const ctx = await approverContext(userOf(req).sub)
      const flags = await Promise.all(withEmp.map(r => isSubordinate(ctx, (r as { employee_id: string }).employee_id)))
      withEmp = withEmp.filter((_, i) => flags[i])
    }
    return ok(res, withEmp)
  } catch (e) { return fail(res, String(e)) }
}

export async function createLeave(req: Request, res: Response) {
  try {
    const u = userOf(req)
    const { employee_id, warehouse_id, date_from, date_to, leave_type, reason } = req.body as {
      employee_id?: string; warehouse_id?: string; date_from?: string; date_to?: string
      leave_type?: string; reason?: string
    }
    const empId = employee_id || u.sub
    if (!empId || !date_from || !date_to) return fail(res, 'employee_id, date_from, date_to là bắt buộc', 400)
    if (date_to < date_from) return fail(res, 'Đến ngày phải >= Từ ngày', 400)

    const now = new Date().toISOString()
    const { data, error } = await supabase.from('LeaveRequest').insert({
      id: randomUUID(),
      employee_id: empId,
      warehouse_id: warehouse_id || null,
      date_from, date_to,
      leave_type: leave_type || 'ANNUAL',
      reason: reason || null,
      status: 'PENDING',
      created_at: now, updated_at: now,
      created_by: u.name || null, updated_by: u.name || null,
    }).select(LEAVE_SELECT).single()
    if (error) return fail(res, error.message)
    const [withEmp] = await attachEmployees([data as { employee_id: string }])
    return ok(res, withEmp, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateLeave(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { date_from, date_to, leave_type, reason } = req.body as {
      date_from?: string; date_to?: string; leave_type?: string; reason?: string
    }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: userOf(req).name || null }
    if (date_from  !== undefined) updates.date_from  = date_from
    if (date_to    !== undefined) updates.date_to    = date_to
    if (leave_type !== undefined) updates.leave_type = leave_type
    if (reason     !== undefined) updates.reason     = reason || null
    const { data, error } = await supabase.from('LeaveRequest').update(updates).eq('id', id).select(LEAVE_SELECT).single()
    if (error) return fail(res, error.message)
    const [withEmp] = await attachEmployees([data as { employee_id: string }])
    return ok(res, withEmp)
  } catch (e) { return fail(res, String(e)) }
}

// Duyệt / Từ chối
export async function decideLeave(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { status } = req.body as { status?: 'APPROVED' | 'REJECTED' }
    if (status !== 'APPROVED' && status !== 'REJECTED') return fail(res, 'status phải là APPROVED hoặc REJECTED', 400)
    const u = userOf(req)

    // chỉ cấp trên trực tiếp (theo chức danh) + chung kho, hoặc Admin
    if (u.name !== 'Admin') {
      const { data: lv } = await supabase.from('LeaveRequest').select('employee_id').eq('id', id).maybeSingle()
      const empId = (lv as { employee_id: string } | null)?.employee_id
      if (!empId) return fail(res, 'Không tìm thấy đơn', 404)
      const ctx = await approverContext(u.sub)
      if (!(await isSubordinate(ctx, empId))) return fail(res, 'Chỉ cấp trên trực tiếp (cùng kho) của nhân viên này mới được duyệt', 403)
    }

    const { data, error } = await supabase.from('LeaveRequest').update({
      status,
      approved_by: u.name || null,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), updated_by: u.name || null,
    }).eq('id', id).select(LEAVE_SELECT).single()
    if (error) return fail(res, error.message)
    const [withEmp] = await attachEmployees([data as { employee_id: string }])
    return ok(res, withEmp)
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteLeave(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { error } = await supabase.from('LeaveRequest').delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { deleted: true })
  } catch (e) { return fail(res, String(e)) }
}
