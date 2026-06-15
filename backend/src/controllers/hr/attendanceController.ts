import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

type ReqUser = { sub?: string; name?: string }
const userOf = (req: Request): ReqUser => (req as { user?: ReqUser }).user ?? {}
const now = () => new Date().toISOString()
const SEL = 'id, employee_id, warehouse_id, work_date, kind, ot_hours, early_leave_hours, note, created_at, updated_at'
const KINDS = ['CA1', 'CA2', 'CA3', 'HC', 'LEAVE']

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
    if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)
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

    const { data: existing } = await supabase.from('Attendance').select('id').eq('employee_id', empId).eq('work_date', work_date).maybeSingle()
    const payload = {
      kind, ot_hours: ot_hours ?? 0, early_leave_hours: early_leave_hours ?? 0,
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

export async function deleteAttendance(req: Request, res: Response) {
  try {
    const { error } = await supabase.from('Attendance').delete().eq('id', req.params.id)
    if (error) return fail(res, error.message)
    return ok(res, { deleted: true })
  } catch (e) { return fail(res, String(e)) }
}
