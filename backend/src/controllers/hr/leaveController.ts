import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllByIdChunks, fetchAllRowsParallel, fetchUpTo, LIST_TOO_LARGE_MSG } from '../../utils/pagination'

// Trần dòng cho list mà FE render TOÀN BỘ ở client (bảng + tổng client-side).
// Bảng nghiệp vụ sẽ có hàng triệu dòng/năm; filter ngày mặc định = hôm nay nên bình thường
// chỉ vài trăm dòng — trần này chặn trường hợp kéo rộng khoảng ngày.
const LIST_ROW_CAP = 5000

type ReqUser = { sub?: string; name?: string; warehouse_scope?: string; warehouse_ids?: string[] }
const userOf = (req: Request): ReqUser => (req as { user?: ReqUser }).user ?? {}

const LEAVE_SELECT = 'id, employee_id, warehouse_id, date_from, date_to, leave_type, reason, status, approved_by, approved_at, created_at, updated_at'

// gắn thông tin NV (tên, mã, phòng, chức danh)
async function attachEmployees<T extends { employee_id: string }>(rows: T[]) {
  if (!rows.length) return rows.map(r => ({ ...r, employee: null }))
  const ids = [...new Set(rows.map(r => r.employee_id))]
  // Chunk 300 + phân trang — vài trăm/nghìn NV nhồi 1 .in() = URL quá dài + cap-1000 cắt thiếu tên âm thầm
  const emps = await fetchAllByIdChunks(ids, chunk => supabase.from('Employee')
    .select('id, name, employee_code, department_id, job_title_id, warehouse_scope').in('id', chunk).order('id'))
  const empList = (emps ?? []) as { id: string; job_title_id: string | null }[]
  // join tên chức danh
  const jtIds = [...new Set(empList.map(e => e.job_title_id).filter((x): x is string => !!x))]
  const jts = await fetchAllByIdChunks(jtIds, chunk => supabase.from('JobTitle')
    .select('id, name').in('id', chunk).order('id'))
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

// Khi gỡ duyệt / xóa / đổi ngày đơn ĐÃ DUYỆT: gỡ chấm công LEAVE đã tự tạo cho các ngày
// KHÔNG còn đơn APPROVED nào khác phủ (tránh xóa nhầm chấm công của đơn chồng ngày khác).
async function clearLeaveAttendance(leave: {
  id: string; employee_id: string; date_from: string; date_to: string
}): Promise<void> {
  const days = eachDate(leave.date_from, leave.date_to)
  if (!days.length) return
  const { data: others } = await supabase.from('LeaveRequest')
    .select('date_from, date_to')
    .eq('employee_id', leave.employee_id).eq('status', 'APPROVED').neq('id', leave.id)
  const covered = new Set<string>()
  for (const o of (others ?? []) as { date_from: string; date_to: string }[])
    for (const d of eachDate(o.date_from, o.date_to)) covered.add(d)
  const toClear = days.filter(d => !covered.has(d))
  if (!toClear.length) return
  await supabase.from('Attendance').delete()
    .eq('employee_id', leave.employee_id).in('work_date', toClear).eq('kind', 'LEAVE')
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

// Non-admin chỉ được thao tác đơn của CHÍNH MÌNH hoặc cấp dưới (chức danh dưới + chung kho).
async function guardLeaveTarget(req: Request, res: Response, empId?: string | null): Promise<boolean> {
  const u = userOf(req)
  if (u.name === 'Admin') return true
  if (!empId) { fail(res, 'Thiếu nhân viên', 400); return false }
  if (empId === u.sub) return true
  const ctx = await approverContext(u.sub)
  const pm  = await loadParentMap()
  if (await canApprove(ctx, empId, pm, false)) return true
  fail(res, 'Bạn chỉ được tạo/sửa đơn nghỉ cho chính mình hoặc cấp dưới', 403)
  return false
}
// SỬA/XÓA: lấy employee_id của đơn rồi áp guardLeaveTarget.
async function guardLeaveScope(req: Request, res: Response, leaveId: string): Promise<boolean> {
  if (userOf(req).name === 'Admin') return true
  const { data: lv } = await supabase.from('LeaveRequest').select('employee_id').eq('id', leaveId).maybeSingle()
  const empId = (lv as { employee_id: string } | null)?.employee_id
  if (!empId) { fail(res, 'Không tìm thấy đơn', 404); return false }
  return guardLeaveTarget(req, res, empId)
}

export async function listLeaves(req: Request, res: Response) {
  try {
    const { warehouse_id, department_id, employee_id, status, date_from, date_to, to_approve, direct } = req.query as Record<string, string>
    // SCOPE KHO (RULE user): chỉ thấy đơn của NV thuộc kho được giao + đơn của chính mình.
    // Thiếu lớp này thì ai có `leave.view` (10/19 chức danh) đọc được đơn nghỉ + LÝ DO của toàn công ty
    // (verify runtime 26/07 đã rò thật). Superadmin / NATIONAL → không giới hạn.
    const uL = userOf(req)
    let scopeEmpIds: string[] | null = null
    if (uL.name !== 'Admin' && uL.warehouse_scope !== 'NATIONAL') {
      const myWhs = (uL.warehouse_ids ?? []) as string[]
      if (warehouse_id && !myWhs.includes(warehouse_id)) return fail(res, 'Ngoài phạm vi kho được giao', 403)
      const whIds = warehouse_id ? [warehouse_id] : myWhs
      const access = whIds.length
        ? await fetchAllRowsParallel(() => supabase.from('UserWarehouseAccess').select('employee_id').in('warehouse_id', whIds).order('id'))
        : []
      scopeEmpIds = [...new Set([...((access ?? []) as { employee_id: string }[]).map(a => a.employee_id), ...(uL.sub ? [uL.sub] : [])])]
    }
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
    // Trần dòng: FE render toàn bộ đơn nghỉ ở client → vượt trần thì BÁO RÕ để user thu hẹp,
    // KHÔNG cắt âm thầm (luật CLAUDE.md).
    const { rows: data, truncated } = await fetchUpTo(buildQuery, LIST_ROW_CAP)
    if (truncated) return fail(res, 400, 'RANGE_TOO_WIDE', LIST_TOO_LARGE_MSG(LIST_ROW_CAP))

    let rows = (data ?? []) as { employee_id: string; [k: string]: unknown }[]
    if (scopeEmpIds !== null) {
      const allow = new Set(scopeEmpIds)
      rows = rows.filter(r => allow.has(r.employee_id))
    }
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
    if (!(await guardLeaveTarget(req, res, empId))) return
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
    if (!(await guardLeaveScope(req, res, id))) return
    const { date_from, date_to, leave_type, reason } = req.body as {
      date_from?: string; date_to?: string; leave_type?: string; reason?: string
    }
    const datesChanged = date_from !== undefined || date_to !== undefined
    // old = trạng thái trước khi sửa (để đồng bộ lại chấm công nếu đơn đã DUYỆT đổi ngày)
    let old: { id: string; employee_id: string; date_from: string; date_to: string; status: string } | null = null
    if (datesChanged) {
      const { data: cur } = await supabase.from('LeaveRequest')
        .select('id, employee_id, date_from, date_to, status').eq('id', id).maybeSingle()
      if (!cur) return fail(res, 'Không tìm thấy đơn', 404)
      old = cur as { id: string; employee_id: string; date_from: string; date_to: string; status: string }
      const nf = date_from ?? old.date_from, nt = date_to ?? old.date_to
      if (nt < nf) return fail(res, 'Đến ngày phải >= Từ ngày', 400)
      const dup = await overlappingLeave(old.employee_id, nf, nt, id)
      if (dup) return fail(res, `Trùng/chồng ngày với đơn nghỉ phép khác (${dup.date_from} → ${dup.date_to}).`, 409)
    }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: userOf(req).name || null }
    if (date_from  !== undefined) updates.date_from  = date_from
    if (date_to    !== undefined) updates.date_to    = date_to
    if (leave_type !== undefined) updates.leave_type = leave_type
    if (reason     !== undefined) updates.reason     = reason || null
    const { data, error } = await supabase.from('LeaveRequest').update(updates).eq('id', id).select(LEAVE_SELECT).single()
    if (error) return fail(res, error.message)

    // Đơn đã DUYỆT mà đổi ngày → gỡ chấm công LEAVE ngày cũ rồi ghi lại ngày mới
    if (datesChanged && old?.status === 'APPROVED') {
      await clearLeaveAttendance(old)
      await applyLeaveAttendance(data as { id: string; employee_id: string; warehouse_id: string | null; date_from: string; date_to: string })
    }
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

    // Duyệt → tự ghi chấm công LEAVE; thu thập ngày bị ghi đè để cảnh báo.
    // Từ chối (kể cả gỡ duyệt một đơn từng APPROVED) → gỡ chấm công LEAVE đã tạo.
    let conflicts: { work_date: string; prev_kind: string }[] = []
    const lv = data as { id: string; employee_id: string; warehouse_id: string | null; date_from: string; date_to: string }
    if (status === 'APPROVED') {
      conflicts = await applyLeaveAttendance(lv)
    } else {
      await clearLeaveAttendance(lv)
    }

    const [withEmp] = await attachEmployees([data as { employee_id: string }])
    return ok(res, { ...withEmp, conflicts })
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteLeave(req: Request, res: Response) {
  try {
    const { id } = req.params
    if (!(await guardLeaveScope(req, res, id))) return
    // Lấy trước khi xóa: nếu đơn đã DUYỆT thì gỡ luôn chấm công LEAVE đã tự tạo
    const { data: cur } = await supabase.from('LeaveRequest')
      .select('id, employee_id, date_from, date_to, status').eq('id', id).maybeSingle()
    const { error } = await supabase.from('LeaveRequest').delete().eq('id', id)
    if (error) return fail(res, error.message)
    const c = cur as { id: string; employee_id: string; date_from: string; date_to: string; status: string } | null
    if (c && c.status === 'APPROVED') await clearLeaveAttendance(c)
    return ok(res, { deleted: true })
  } catch (e) { return fail(res, String(e)) }
}
