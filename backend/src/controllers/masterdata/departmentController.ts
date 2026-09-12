import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { logAdmin, diffFields } from '../../services/adminAudit'

function isSuperadmin(req: Request): boolean {
  // Cờ is_superadmin trong token = cột Employee.is_superadmin (migration 20260813f) — không so tên
  const u = (req as { user?: { is_superadmin?: boolean } }).user
  return u?.is_superadmin === true
}
const ADMIN_ONLY_MSG = 'Chỉ Admin được sửa cấu trúc phòng ban / chức danh & phân quyền'

// Chống leo thang: non-superadmin không được cấp cho chức danh quyền mà CHÍNH MÌNH không có.
// Trả message lỗi nếu vi phạm, null nếu hợp lệ.
function escalationError(req: Request, perms?: Record<string, string[]>): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = req.user
  if (u?.is_superadmin === true) return null
  const mine: Record<string, string[]> = u?.module_permissions ?? {}
  for (const [mod, actions] of Object.entries(perms ?? {})) {
    for (const a of (actions ?? [])) {
      if (!mine[mod]?.includes(a)) return `Không thể cấp quyền vượt quá quyền của bạn: ${mod}.${a}`
    }
  }
  return null
}

const DEPT_SELECT = 'id, name, code, allowed_modules, requires_scheduling, is_carrier, is_active, created_at, updated_at, created_by, updated_by'
const JT_SELECT   = 'id, name, department_id, parent_id, in_chart, is_driver, landing_page, is_active, module_permissions, created_at, updated_at, created_by, updated_by, department:Department(id,name,code)'

// Trang mở đầu sau đăng nhập (12/09) — CHECK ở DB là regex đường dẫn; ở đây chặn sớm để trả 400 tiếng Việt.
// undefined = không đụng (giữ giá trị cũ) · null/'' = về Tổng quan · chuỗi = đường dẫn nội bộ.
function landingPageOf(v: unknown): { value: string | null } | { skip: true } | { error: string } {
  if (v === undefined) return { skip: true }
  if (v === null || v === '') return { value: null }
  if (typeof v !== 'string' || !/^\/[a-z0-9/_-]{1,80}$/.test(v)) return { error: 'Trang mở đầu không hợp lệ — chọn trong danh sách' }
  return { value: v }
}

// ─── Departments ──────────────────────────────────────────────────────────────

export async function listDepartments(_req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('Department')
      .select(DEPT_SELECT)
      .eq('is_active', true)
      .order('name')
    if (error) return fail(res, error)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function createDepartment(req: Request, res: Response) {
  try {
    if (!isSuperadmin(req)) return fail(res, ADMIN_ONLY_MSG, 403)
    const { name, code, allowed_modules = [], is_carrier } = req.body as {
      name: string; code: string; allowed_modules?: string[]; is_carrier?: boolean
    }
    if (!name || !code) return fail(res, 'name và code là bắt buộc', 400)

    const actor = req.user?.name || null
    const { data, error } = await supabase
      .from('Department')
      .insert({ id: randomUUID(), name, code: code.toUpperCase(), allowed_modules, is_carrier: is_carrier === true, updated_at: new Date().toISOString(), created_by: actor, updated_by: actor })
      .select(DEPT_SELECT)
      .single()
    if (error) return fail(res, error)
    const created = data as unknown as { id: string }
    await logAdmin(req, { action: 'DEPARTMENT_CREATE', target_type: 'Department', target_id: created.id, target_label: `${code.toUpperCase()} · ${name}`, after: { name, code: code.toUpperCase(), allowed_modules, is_carrier: is_carrier === true } })
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateDepartment(req: Request, res: Response) {
  try {
    if (!isSuperadmin(req)) return fail(res, ADMIN_ONLY_MSG, 403)
    const { id } = req.params
    const { name, code, allowed_modules, is_active, requires_scheduling, is_carrier } = req.body as {
      name?: string; code?: string; allowed_modules?: string[]; is_active?: boolean; requires_scheduling?: boolean; is_carrier?: boolean
    }
    const { data: before } = await supabase.from('Department').select(DEPT_SELECT).eq('id', id).maybeSingle()
    const { data, error } = await supabase
      .from('Department')
      .update({ name, code: code?.toUpperCase(), allowed_modules, is_active, requires_scheduling, is_carrier, updated_at: new Date().toISOString(), updated_by: req.user?.name || null })
      .eq('id', id)
      .select(DEPT_SELECT)
      .maybeSingle()
    if (error) return fail(res, error)
    if (!data) return fail(res, 'Không tìm thấy phòng ban', 404)
    const d = diffFields(before as Record<string, unknown> | null, { name, code: code?.toUpperCase(), allowed_modules, is_active, requires_scheduling, is_carrier })
    if (Object.keys(d.after).length) {
      const row = data as unknown as { code: string; name: string }
      await logAdmin(req, { action: 'DEPARTMENT_UPDATE', target_type: 'Department', target_id: id, target_label: `${row.code} · ${row.name}`, ...d })
    }
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
    if (error) return fail(res, error)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function createJobTitle(req: Request, res: Response) {
  try {
    if (!isSuperadmin(req)) return fail(res, ADMIN_ONLY_MSG, 403)
    const { name, department_id, module_permissions, parent_id, in_chart, landing_page } = req.body as {
      name: string
      department_id: string
      module_permissions?: Record<string, string[]>
      parent_id?: string | null
      in_chart?: boolean
      landing_page?: string | null
    }
    if (!name || !department_id) return fail(res, 'name và department_id là bắt buộc', 400)
    const escErr = escalationError(req, module_permissions)
    if (escErr) return fail(res, escErr, 403)
    const lp = landingPageOf(landing_page)
    if ('error' in lp) return fail(res, lp.error, 400)

    const actor = req.user?.name || null
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('JobTitle')
      .insert({
        id: randomUUID(),
        name, department_id,
        parent_id: parent_id || null,
        in_chart: in_chart ?? false,
        module_permissions: module_permissions ?? {},
        landing_page: 'skip' in lp ? null : lp.value,
        created_at: now, updated_at: now,
        created_by: actor, updated_by: actor,
      })
      .select(JT_SELECT)
      .single()
    if (error) return fail(res, error)
    const created = data as unknown as { id: string }
    await logAdmin(req, { action: 'JOBTITLE_CREATE', target_type: 'JobTitle', target_id: created.id, target_label: name,
      after: { name, department_id, parent_id: parent_id || null, module_permissions: module_permissions ?? {} } })
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

// Đặt chức danh cấp trên (kéo-thả sơ đồ tổ chức) — chống vòng lặp
export async function setJobTitleParent(req: Request, res: Response) {
  try {
    if (!isSuperadmin(req)) return fail(res, ADMIN_ONLY_MSG, 403)
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
    const upd: Record<string, unknown> = { parent_id: parent, updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    if (in_chart !== undefined) upd.in_chart = in_chart
    const { data: before } = await supabase.from('JobTitle').select('name, parent_id, in_chart').eq('id', id).maybeSingle()
    const { data, error } = await supabase.from('JobTitle')
      .update(upd)
      .eq('id', id).select(JT_SELECT).maybeSingle()
    if (error) return fail(res, error)
    if (!data) return fail(res, 'Không tìm thấy chức danh', 404)
    const d = diffFields(before as Record<string, unknown> | null, { parent_id: parent, in_chart })
    if (Object.keys(d.after).length)
      await logAdmin(req, { action: 'JOBTITLE_PARENT', target_type: 'JobTitle', target_id: id, target_label: (before as { name?: string } | null)?.name ?? id, ...d })
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateJobTitle(req: Request, res: Response) {
  try {
    if (!isSuperadmin(req)) return fail(res, ADMIN_ONLY_MSG, 403)
    const { id } = req.params
    const { name, is_active, module_permissions, is_driver, landing_page } = req.body as {
      name?: string; is_active?: boolean; is_driver?: boolean; landing_page?: string | null
      module_permissions?: Record<string, string[]>
    }
    const escErr = escalationError(req, module_permissions)
    if (escErr) return fail(res, escErr, 403)
    const lp = landingPageOf(landing_page)
    if ('error' in lp) return fail(res, lp.error, 400)
    const { data: before } = await supabase.from('JobTitle').select('name, is_active, module_permissions, is_driver, landing_page').eq('id', id).maybeSingle()
    const { data, error } = await supabase
      .from('JobTitle')
      .update({
        name, is_active, module_permissions, is_driver,
        ...('skip' in lp ? {} : { landing_page: lp.value }),
        updated_at: new Date().toISOString(), updated_by: req.user?.name || null,
      })
      .eq('id', id)
      .select(JT_SELECT)
      .maybeSingle()
    if (error) return fail(res, error)
    if (!data) return fail(res, 'Không tìm thấy chức danh', 404)
    // Sổ quản trị: ĐỔI QUYỀN chức danh là thao tác IT hỏi đầu tiên ("ai cấp quyền này, khi nào?")
    const d = diffFields(before as Record<string, unknown> | null, {
      name, is_active, module_permissions, is_driver, ...('skip' in lp ? {} : { landing_page: lp.value }),
    })
    if (Object.keys(d.after).length)
      await logAdmin(req, { action: 'JOBTITLE_UPDATE', target_type: 'JobTitle', target_id: id, target_label: (before as { name?: string } | null)?.name ?? name ?? id, ...d })
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}
