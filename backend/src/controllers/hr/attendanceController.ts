import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

type ReqUser = { sub?: string; name?: string; module_permissions?: Record<string, string[]> }
const userOf = (req: Request): ReqUser => (req as { user?: ReqUser }).user ?? {}
const now = () => new Date().toISOString()
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const hasAttEdit = (u: ReqUser) => u.name === 'Admin' || !!u.module_permissions?.attendance?.includes('edit')
const SEL = 'id, employee_id, warehouse_id, work_date, kind, ot_hours, early_leave_hours, note, created_at, updated_at'
const KINDS = ['CA1', 'CA2', 'CA3', 'HC', 'LEAVE']

// NV thuộc 1 kho (qua quyền truy cập kho) — dùng để lọc Bảng công/Báo cáo theo kho
async function employeeIdsOfWarehouse(warehouse_id: string): Promise<string[]> {
  const { data } = await supabase.from('UserWarehouseAccess').select('employee_id').eq('warehouse_id', warehouse_id)
  return (data ?? []).map((r: { employee_id: string }) => r.employee_id)
}

async function attachEmp<T extends { employee_id: string }>(rows: T[]) {
  if (!rows.length) return rows.map(r => ({ ...r, employee: null }))
  const ids = [...new Set(rows.map(r => r.employee_id))]
  const { data: emps } = await supabase.from('Employee').select('id, name, employee_code, department_id').in('id', ids)
  const map = new Map((emps ?? []).map((e: { id: string }) => [e.id, e]))
  return rows.map(r => ({ ...r, employee: map.get(r.employee_id) ?? null }))
}

export async function listAttendance(req: Request, res: Response) {
  try {
    const { warehouse_id, department_id, employee_id, date_from, date_to } = req.query as Record<string, string>
    let q = supabase.from('Attendance').select(SEL).order('work_date', { ascending: false })
    if (warehouse_id) {
      const empIds = await employeeIdsOfWarehouse(warehouse_id)
      q = q.in('employee_id', empIds.length ? empIds : ['__none__'])
    }
    if (employee_id)  q = q.eq('employee_id', employee_id)
    if (date_from)    q = q.gte('work_date', date_from)
    if (date_to)      q = q.lte('work_date', date_to)
    const { data, error } = await q
    if (error) return fail(res, error.message)
    let rows = await attachEmp((data ?? []) as { employee_id: string }[])
    if (department_id) rows = rows.filter(r => (r.employee as { department_id?: string } | null)?.department_id === department_id)
    return ok(res, rows)
  } catch (e) { return fail(res, String(e)) }
}

// NV tự khai (hoặc quản lý khai hộ) — upsert theo (employee_id, work_date)
export async function upsertAttendance(req: Request, res: Response) {
  try {
    const u = userOf(req)
    const { employee_id, warehouse_id, work_date, kind, ot_hours, early_leave_hours, note } = req.body as {
      employee_id?: string; warehouse_id?: string; work_date?: string; kind?: string
      ot_hours?: number; early_leave_hours?: number; note?: string
    }
    const empId = employee_id || u.sub
    if (!empId || !work_date || !kind) return fail(res, 'employee_id, work_date, kind là bắt buộc', 400)
    if (!KINDS.includes(kind)) return fail(res, 'kind không hợp lệ', 400)

    // ── Rule ngày ──
    const today = todayVN()
    if (work_date > today) return fail(res, 'Không thể chấm công cho ngày tương lai', 400)
    // chấm công ngày đã qua (hoặc của người khác) cần quyền sửa
    const isSelfToday = empId === u.sub && work_date === today
    if (!isSelfToday && !hasAttEdit(u)) return fail(res, 'Ngày đã qua hoặc của người khác — cần quyền "Sửa công" (attendance.edit)', 403)

    // ── Rule loại công ──
    let ot = Number(ot_hours) || 0
    let early = Number(early_leave_hours) || 0
    if (kind === 'LEAVE') { ot = 0; early = 0 }              // nghỉ phép: không OT/về sớm
    else if (ot > 0 && early > 0) return fail(res, 'Một ngày chỉ có OT hoặc về sớm, không có cả hai', 400)

    const { data: existing } = await supabase.from('Attendance').select('id').eq('employee_id', empId).eq('work_date', work_date).maybeSingle()
    const payload = {
      kind, ot_hours: ot, early_leave_hours: early,
      note: note || null, warehouse_id: warehouse_id || null, updated_at: now(),
    }
    if (existing) {
      const { data, error } = await supabase.from('Attendance').update(payload).eq('id', (existing as { id: string }).id).select(SEL).single()
      if (error) return fail(res, error.message)
      const [r] = await attachEmp([data as { employee_id: string }])
      return ok(res, r)
    }
    const { data, error } = await supabase.from('Attendance').insert({
      id: randomUUID(), employee_id: empId, work_date, ...payload, created_at: now(),
    }).select(SEL).single()
    if (error) return fail(res, error.message)
    const [r] = await attachEmp([data as { employee_id: string }])
    return ok(res, r, 201)
  } catch (e) { return fail(res, String(e)) }
}

// Báo cáo tổng hợp công theo nhân viên trong khoảng ngày
export async function reportAttendance(req: Request, res: Response) {
  try {
    const { warehouse_id, department_id, date_from, date_to } = req.query as Record<string, string>
    if (!date_from || !date_to) return fail(res, 'date_from, date_to là bắt buộc', 400)
    let q = supabase.from('Attendance').select('employee_id, warehouse_id, kind, ot_hours, early_leave_hours')
      .gte('work_date', date_from).lte('work_date', date_to)
    if (warehouse_id) {
      const empIds = await employeeIdsOfWarehouse(warehouse_id)
      q = q.in('employee_id', empIds.length ? empIds : ['__none__'])
    }
    const { data, error } = await q
    if (error) return fail(res, error.message)
    const rows = (data ?? []) as { employee_id: string; kind: string; ot_hours: number; early_leave_hours: number }[]

    type Agg = { employee_id: string; ca1: number; ca2: number; ca3: number; hc: number; leave: number; ot_hours: number; early_hours: number }
    const map = new Map<string, Agg>()
    for (const r of rows) {
      const a = map.get(r.employee_id) ?? { employee_id: r.employee_id, ca1: 0, ca2: 0, ca3: 0, hc: 0, leave: 0, ot_hours: 0, early_hours: 0 }
      if (r.kind === 'CA1') a.ca1++; else if (r.kind === 'CA2') a.ca2++; else if (r.kind === 'CA3') a.ca3++
      else if (r.kind === 'HC') a.hc++; else if (r.kind === 'LEAVE') a.leave++
      a.ot_hours += Number(r.ot_hours) || 0
      a.early_hours += Number(r.early_leave_hours) || 0
      map.set(r.employee_id, a)
    }
    let list = await attachEmp([...map.values()])
    if (department_id) list = list.filter(r => (r.employee as { department_id?: string } | null)?.department_id === department_id)
    // work_days = ca1+ca2+ca3+hc
    const nameOf = (r: { employee: unknown }) => ((r.employee as { name?: string } | null)?.name ?? '')
    // Tổng công (giờ) = 8h × số ngày công + OT − về sớm
    const out = list.map(r => {
      const work_days = r.ca1 + r.ca2 + r.ca3 + r.hc
      return { ...r, work_days, total_hours: Math.round((work_days * 8 + r.ot_hours - r.early_hours) * 10) / 10 }
    }).sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    return ok(res, out)
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteAttendance(req: Request, res: Response) {
  try {
    const u = userOf(req)
    const { data: row } = await supabase.from('Attendance').select('employee_id, work_date').eq('id', req.params.id).maybeSingle()
    if (row) {
      const r = row as { employee_id: string; work_date: string }
      const isSelfToday = r.employee_id === u.sub && r.work_date === todayVN()
      if (!isSelfToday && !hasAttEdit(u)) return fail(res, 'Ngày đã qua hoặc của người khác — cần quyền "Sửa công"', 403)
    }
    const { error } = await supabase.from('Attendance').delete().eq('id', req.params.id)
    if (error) return fail(res, error.message)
    return ok(res, { deleted: true })
  } catch (e) { return fail(res, String(e)) }
}
