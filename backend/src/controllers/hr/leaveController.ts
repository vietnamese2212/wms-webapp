import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

type ReqUser = { sub?: string; name?: string }
const userOf = (req: Request): ReqUser => (req as { user?: ReqUser }).user ?? {}

const LEAVE_SELECT = 'id, employee_id, warehouse_id, date_from, date_to, leave_type, reason, status, approved_by, approved_at, created_at, updated_at'

// gắn thông tin NV (tên, mã, phòng, chức danh)
async function attachEmployees<T extends { employee_id: string }>(rows: T[]) {
  if (!rows.length) return rows.map(r => ({ ...r, employee: null }))
  const ids = [...new Set(rows.map(r => r.employee_id))]
  const { data: emps } = await supabase.from('Employee')
    .select('id, name, employee_code, department_id, job_title_id, warehouse_scope').in('id', ids)
  const empList = (emps ?? []) as { id: string; job_title_id: string | null }[]
  // join tên chức danh
  const jtIds = [...new Set(empList.map(e => e.job_title_id).filter((x): x is string => !!x))]
  const { data: jts } = jtIds.length
    ? await supabase.from('JobTitle').select('id, name').in('id', jtIds)
    : { data: [] as { id: string; name: string }[] }
  const jtMap = new Map(((jts ?? []) as { id: string; name: string }[]).map(j => [j.id, j.name]))
  const map = new Map(empList.map(e => [e.id, { ...e, job_title: jtMap.get(e.job_title_id ?? '') ?? null }]))
  return rows.map(r => ({ ...r, employee: map.get(r.employee_id) ?? null }))
}

// ── Quyền duyệt: chức danh cấp trên (TRỰC TIẾP hoặc CAO HƠN) của người xin + CHUNG KHO ──
type ApproverCtx = { sub: string | null; job_title_id: string | null; scope: string | null; whs: Set<string> }
async function approverContext(sub?: string): Promise<ApproverCtx> {
  if (!sub) return { sub: null, job_title_id: null, scope: null, whs: new Set() }
  const { data: a } = await supabase.from('Employee').select('job_title_id, warehouse_scope').eq('id', sub).maybeSingle()
  const { data: wa } = await supabase.from('UserWarehouseAccess').select('warehouse_id').eq('employee_id', sub)
  const e = a as { job_title_id: string | null; warehouse_scope: string | null } | null
  return { sub, job_title_id: e?.job_title_id ?? null, scope: e?.warehouse_scope ?? null, whs: new Set((wa ?? []).map((r: { warehouse_id: string }) => r.warehouse_id)) }
}
// map chức danh -> cấp trên trực tiếp (1 query)
async function loadParentMap(): Promise<Map<string, string | null>> {
  const { data } = await supabase.from('JobTitle').select('id, parent_id')
  return new Map(((data ?? []) as { id: string; parent_id: string | null }[]).map(j => [j.id, j.parent_id]))
}
// jt có nằm dưới quyền ancestorJt? directOnly = chỉ cấp dưới trực tiếp
function jtUnder(pm: Map<string, string | null>, ancestorJt: string, jt: string | null, directOnly: boolean): boolean {
  if (!jt) return false
  if (directOnly) return pm.get(jt) === ancestorJt
  let cur = pm.get(jt) ?? null
  const seen = new Set<string>()
  while (cur) { if (cur === ancestorJt) return true; if (seen.has(cur)) break; seen.add(cur); cur = pm.get(cur) ?? null }
  return false
}
// chung kho (NATIONAL = mọi kho)
function sharesKho(ctx: ApproverCtx, empScope: string | null, empWhs: Set<string>): boolean {
  if (ctx.scope === 'NATIONAL' || empScope === 'NATIONAL') return true
  for (const w of ctx.whs) if (empWhs.has(w)) return true
  return false
}
// Đơn nghỉ phép trùng/chồng ngày của CÙNG nhân viên (bỏ qua đơn đã Từ chối). Trả đơn đầu tiên bị trùng.
async function overlappingLeave(employeeId: string, dateFrom: string, dateTo: string, excludeId?: string) {
  let q = supabase.from('LeaveRequest').select('id, date_from, date_to, status')
    .eq('employee_id', employeeId).neq('status', 'REJECTED')
    .lte('date_from', dateTo).gte('date_to', dateFrom)   // overlap: existing.from <= new.to AND existing.to >= new.from
  if (excludeId) q = q.neq('id', excludeId)
  const { data } = await q
  return ((data ?? []) as { id: string; date_from: string; date_to: string }[])[0] ?? null
}

// liệt kê các ngày YYYY-MM-DD trong khoảng [from, to] (bao gồm 2 đầu)
function eachDate(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}

// Khi duyệt: tự ghi chấm công LEAVE cho mọi ngày trong đơn.
// Trả về các ngày đã có chấm công KHÁC LEAVE (bị ghi đè) để cảnh báo.
async function applyLeaveAttendance(leave: {
  employee_id: string; warehouse_id: string | null; date_from: string; date_to: string
}): Promise<{ work_date: string; prev_kind: string }[]> {
  const days = eachDate(leave.date_from, leave.date_to)
  if (!days.length) return []
  const { data: existing } = await supabase.from('Attendance')
    .select('id, work_date, kind').eq('employee_id', leave.employee_id).in('work_date', days)
  const exMap = new Map(((existing ?? []) as { id: string; work_date: string; kind: string }[]).map(r => [r.work_date, r]))
  const ts = new Date().toISOString()
  const conflicts: { work_date: string; prev_kind: string }[] = []
  await Promise.all(days.map(async day => {
    const ex = exMap.get(day)
    if (ex) {
      if (ex.kind !== 'LEAVE') conflicts.push({ work_date: day, prev_kind: ex.kind })
      await supabase.from('Attendance').update({
        kind: 'LEAVE', ot_hours: 0, early_leave_hours: 0,
        warehouse_id: leave.warehouse_id || null, updated_at: ts,
      }).eq('id', ex.id)
    } else {
      await supabase.from('Attendance').insert({
        id: randomUUID(), employee_id: leave.employee_id, warehouse_id: leave.warehouse_id || null,
        work_date: day, kind: 'LEAVE', ot_hours: 0, early_leave_hours: 0,
        note: 'Tự động từ nghỉ phép đã duyệt', created_at: ts, updated_at: ts,
      })
    }
  }))
  return conflicts.sort((a, b) => a.work_date.localeCompare(b.work_date))
}

// 1 nhân viên có dưới quyền duyệt của approver không
async function canApprove(ctx: ApproverCtx, employeeId: string, pm: Map<string, string | null>, directOnly: boolean): Promise<boolean> {
  if (!ctx.job_title_id) return false
  const { data: emp } = await supabase.from('Employee').select('job_title_id, warehouse_scope').eq('id', employeeId).maybeSingle()
  const e = emp as { job_title_id: string | null; warehouse_scope: string | null } | null
  if (!jtUnder(pm, ctx.job_title_id, e?.job_title_id ?? null, directOnly)) return false
  const { data: wa } = await supabase.from('UserWarehouseAccess').select('warehouse_id').eq('employee_id', employeeId)
  return sharesKho(ctx, e?.warehouse_scope ?? null, new Set((wa ?? []).map((r: { warehouse_id: string }) => r.warehouse_id)))
}

export async function listLeaves(req: Request, res: Response) {
  try {
    const { warehouse_id, department_id, employee_id, status, date_from, date_to, to_approve, direct } = req.query as Record<string, string>
    const buildQuery = () => {
      let q = supabase.from('LeaveRequest').select(LEAVE_SELECT).order('date_from', { ascending: false })
      if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)
      if (employee_id)  q = q.eq('employee_id', employee_id)
      if (status)       q = q.eq('status', status)
      // overlap khoảng ngày: date_from <= to AND date_to >= from
      if (date_to)      q = q.lte('date_from', date_to)
      if (date_from)    q = q.gte('date_to', date_from)
      return q
    }
    const PAGE = 1000
    const data: unknown[] = []
    for (let page = 0; ; page++) {
      const { data: batch, error } = await buildQuery().range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) return fail(res, error.message)
      const arr = batch ?? []
      data.push(...arr)
      if (arr.length < PAGE) break
    }

    let rows = (data ?? []) as { employee_id: string; [k: string]: unknown }[]
    let withEmp = await attachEmployees(rows)
    if (department_id) {
      withEmp = withEmp.filter(r => (r.employee as { department_id?: string } | null)?.department_id === department_id)
    }
    // chỉ đơn của người dưới quyền (chức danh dưới + chung kho); direct=chỉ cấp dưới trực tiếp
    if (to_approve === 'true') {
      const ctx = await approverContext(userOf(req).sub)
      const pm = await loadParentMap()
      const flags = await Promise.all(withEmp.map(r => canApprove(ctx, (r as { employee_id: string }).employee_id, pm, direct === 'true')))
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

    const dup = await overlappingLeave(empId, date_from, date_to)
    if (dup) return fail(res, `Nhân viên đã có đơn nghỉ phép trùng/chồng ngày (${dup.date_from} → ${dup.date_to}). Không thể tạo trùng.`, 409)

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
    // nếu đổi ngày → kiểm tra trùng/chồng với đơn khác của cùng NV (trừ chính đơn này)
    if (date_from !== undefined || date_to !== undefined) {
      const { data: cur } = await supabase.from('LeaveRequest').select('employee_id, date_from, date_to').eq('id', id).maybeSingle()
      if (!cur) return fail(res, 'Không tìm thấy đơn', 404)
      const c = cur as { employee_id: string; date_from: string; date_to: string }
      const nf = date_from ?? c.date_from, nt = date_to ?? c.date_to
      if (nt < nf) return fail(res, 'Đến ngày phải >= Từ ngày', 400)
      const dup = await overlappingLeave(c.employee_id, nf, nt, id)
      if (dup) return fail(res, `Trùng/chồng ngày với đơn nghỉ phép khác (${dup.date_from} → ${dup.date_to}).`, 409)
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
      const pm = await loadParentMap()
      if (!(await canApprove(ctx, empId, pm, false))) return fail(res, 'Chỉ cấp trên (cùng kho) của nhân viên này mới được duyệt', 403)
    }

    const { data, error } = await supabase.from('LeaveRequest').update({
      status,
      approved_by: u.name || null,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), updated_by: u.name || null,
    }).eq('id', id).select(LEAVE_SELECT).single()
    if (error) return fail(res, error.message)

    // Duyệt → tự ghi chấm công LEAVE; thu thập ngày bị ghi đè để cảnh báo
    let conflicts: { work_date: string; prev_kind: string }[] = []
    if (status === 'APPROVED') {
      const lv = data as { employee_id: string; warehouse_id: string | null; date_from: string; date_to: string }
      conflicts = await applyLeaveAttendance(lv)
    }

    const [withEmp] = await attachEmployees([data as { employee_id: string }])
    return ok(res, { ...withEmp, conflicts })
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
