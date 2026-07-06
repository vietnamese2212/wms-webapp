import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel, fetchAllByIdChunks } from '../../utils/pagination'

type ReqUser = { sub?: string; name?: string; module_permissions?: Record<string, string[]> }
const userOf = (req: Request): ReqUser => (req as { user?: ReqUser }).user ?? {}
const now = () => new Date().toISOString()
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const hasAttEdit = (u: ReqUser) => u.name === 'Admin' || !!u.module_permissions?.attendance?.includes('edit')
const SEL = 'id, employee_id, warehouse_id, work_date, kind, ot_hours, early_leave_hours, note, created_at, updated_at'
const KINDS = ['CA1', 'CA2', 'CA3', 'HC', 'LEAVE']

// NV thuộc 1 kho (qua quyền truy cập kho) — dùng để lọc Bảng công/Báo cáo theo kho
async function employeeIdsOfWarehouse(warehouse_id: string): Promise<string[]> {
  // Phân trang né cap ~1000 dòng/response của PostgREST
  const data = await fetchAllRowsParallel(() =>
    supabase.from('UserWarehouseAccess').select('employee_id').eq('warehouse_id', warehouse_id).order('id'))
  return (data ?? []).map((r: { employee_id: string }) => r.employee_id)
}

async function attachEmp<T extends { employee_id: string }>(rows: T[]) {
  if (!rows.length) return rows.map(r => ({ ...r, employee: null }))
  const ids = [...new Set(rows.map(r => r.employee_id))]
  // Chunk 300 + phân trang — vài trăm/nghìn NV nhồi 1 .in() = URL quá dài + cap-1000 cắt thiếu tên âm thầm
  const emps = await fetchAllByIdChunks(ids, chunk => supabase.from('Employee')
    .select('id, name, employee_code, department_id, job_title_id').in('id', chunk).order('id'))
  const empList = (emps ?? []) as { id: string; job_title_id: string | null }[]
  // join tên chức danh
  const jtIds = [...new Set(empList.map(e => e.job_title_id).filter((x): x is string => !!x))]
  const jts = await fetchAllByIdChunks(jtIds, chunk => supabase.from('JobTitle')
    .select('id, name').in('id', chunk).order('id'))
  const jtMap = new Map(((jts ?? []) as { id: string; name: string }[]).map(j => [j.id, j.name]))
  const map = new Map(empList.map(e => [e.id, { ...e, job_title: jtMap.get(e.job_title_id ?? '') ?? null }]))
  return rows.map(r => ({ ...r, employee: map.get(r.employee_id) ?? null }))
}

export async function listAttendance(req: Request, res: Response) {
  try {
    const { warehouse_id, department_id, employee_id, date_from, date_to } = req.query as Record<string, string>
    const warehouseEmpIds = warehouse_id ? await employeeIdsOfWarehouse(warehouse_id) : null
    // Phân trang vượt cap ~1000; kho nhiều NV → CHUNK empIds 300/lô (nhồi 1 .in() = URL quá dài)
    const makeBase = () => {
      let q = supabase.from('Attendance').select(SEL)
        .order('work_date', { ascending: false }).order('id')
      if (employee_id)  q = q.eq('employee_id', employee_id)
      if (date_from)    q = q.gte('work_date', date_from)
      if (date_to)      q = q.lte('work_date', date_to)
      return q
    }
    let data: unknown[]
    if (warehouseEmpIds) {
      data = warehouseEmpIds.length
        ? await fetchAllByIdChunks(warehouseEmpIds, chunk => makeBase().in('employee_id', chunk))
        : []
      // gộp nhiều lô → sort lại work_date desc cho ổn định
      ;(data as { work_date: string }[]).sort((a, b) => (a.work_date < b.work_date ? 1 : a.work_date > b.work_date ? -1 : 0))
    } else {
      data = await fetchAllRowsParallel(makeBase)
    }
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
    const ins = await supabase.from('Attendance').insert({
      id: randomUUID(), employee_id: empId, work_date, ...payload, created_at: now(),
    }).select(SEL).single()
    if (ins.error) {
      // Đua: 2 lượt chấm cùng (nhân viên, ngày) cùng lúc → cả hai thấy chưa tồn rồi cùng insert.
      // unique (employee_id, work_date) chặn → lượt sau 23505 → chuyển sang UPDATE (idempotent), hết trùng dòng / lỗi oan.
      if ((ins.error as { code?: string }).code === '23505') {
        const { data: ex2 } = await supabase.from('Attendance').select('id').eq('employee_id', empId).eq('work_date', work_date).maybeSingle()
        if (ex2) {
          const { data, error } = await supabase.from('Attendance').update(payload).eq('id', (ex2 as { id: string }).id).select(SEL).single()
          if (error) return fail(res, error.message)
          const [r] = await attachEmp([data as { employee_id: string }])
          return ok(res, r)
        }
      }
      return fail(res, ins.error.message)
    }
    const [r] = await attachEmp([ins.data as { employee_id: string }])
    return ok(res, r, 201)
  } catch (e) { return fail(res, String(e)) }
}

// Báo cáo tổng hợp công theo nhân viên trong khoảng ngày
export async function reportAttendance(req: Request, res: Response) {
  try {
    const { warehouse_id, department_id, date_from, date_to } = req.query as Record<string, string>
    if (!date_from || !date_to) return fail(res, 'date_from, date_to là bắt buộc', 400)
    const empIds = warehouse_id ? await employeeIdsOfWarehouse(warehouse_id) : null
    // Phân trang né cap ~1000; kho nhiều NV → chunk empIds 300/lô (né URL dài). Tổng hợp không cần thứ tự.
    const makeQ = () => supabase.from('Attendance').select('employee_id, warehouse_id, kind, ot_hours, early_leave_hours')
      .gte('work_date', date_from).lte('work_date', date_to).order('id')
    const data = empIds
      ? (empIds.length ? await fetchAllByIdChunks(empIds, chunk => makeQ().in('employee_id', chunk)) : [])
      : await fetchAllRowsParallel(makeQ)
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
