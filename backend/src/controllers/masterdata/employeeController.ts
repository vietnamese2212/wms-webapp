import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import bcrypt from 'bcrypt'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel } from '../../utils/pagination'

// ─── Phân quyền: bảo vệ tài khoản Admin + giới hạn phạm vi thấy nhân sự ─────────
function isSuperadmin(req: Request): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return req.user?.name === 'Admin'
}

// Chặn non-superadmin thao tác trên tài khoản superadmin (Admin). true = đã chặn (đã trả lỗi).
async function blockIfTargetSuperadmin(req: Request, res: Response): Promise<boolean> {
  if (isSuperadmin(req)) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await supabase.from('Employee')
    .select('name, employee_code').eq('id', req.params.id).maybeSingle()
  if (data?.name === 'Admin' || data?.employee_code === 'ADMIN') {
    fail(res, 'Chỉ Admin mới được thao tác trên tài khoản Admin', 403)
    return true
  }
  return false
}

// Tập employee id được phép thấy: (cùng kho được gán) ∩ (cấp dưới theo sơ đồ chức danh + chính mình).
// Sơ đồ tổ chức nằm ở JobTitle.parent_id (KHÔNG phải Employee.manager_id). null = thấy tất cả (superadmin).
async function visibleEmployeeIds(req: Request): Promise<Set<string> | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = req.user
  if (!u) return new Set<string>()
  if (u.name === 'Admin') return null

  const self: string = u.sub
  const allowed = new Set<string>([self]) // luôn thấy chính mình

  // 1. Chức danh của người dùng (JWT không có job_title_id → đọc từ DB)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: me } = await supabase.from('Employee')
    .select('job_title_id').eq('id', self).maybeSingle()
  const myJt: string | null = me?.job_title_id ?? null

  if (myJt) {
    // Tập chức danh cấp dưới (đệ quy) của chức danh mình — không gồm chính chức danh mình (chỉ cấp dưới)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: jts } = await supabase.from('JobTitle').select('id, parent_id')
    const childrenOf = new Map<string, string[]>()
    for (const r of ((jts ?? []) as { id: string; parent_id: string | null }[])) {
      if (!r.parent_id) continue
      const arr = childrenOf.get(r.parent_id) ?? []
      arr.push(r.id); childrenOf.set(r.parent_id, arr)
    }
    const descJt = new Set<string>()
    const stack: string[] = [...(childrenOf.get(myJt) ?? [])]
    while (stack.length) {
      const cur = stack.pop() as string
      if (descJt.has(cur)) continue
      descJt.add(cur)
      for (const c of (childrenOf.get(cur) ?? [])) stack.push(c)
    }
    if (descJt.size) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: subs } = await supabase.from('Employee')
        .select('id').in('job_title_id', [...descJt])
      for (const s of ((subs ?? []) as { id: string }[])) allowed.add(s.id)
    }
  }

  // 2. Giao với phạm vi kho (nếu ASSIGNED — NATIONAL thì không giới hạn kho)
  if (u.warehouse_scope === 'ASSIGNED') {
    const whIds: string[] = u.warehouse_ids ?? []
    if (!whIds.length) return new Set<string>([self])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: wa } = await supabase.from('UserWarehouseAccess')
      .select('employee_id').in('warehouse_id', whIds)
    const inWh = new Set(((wa ?? []) as { employee_id: string }[]).map(r => r.employee_id))
    return new Set<string>([...allowed].filter(id => id === self || inWh.has(id)))
  }
  return allowed
}

function generateTempPassword(): string {
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower  = 'abcdefghjkmnpqrstuvwxyz'
  const digits = '23456789'
  const pool   = upper + lower + digits
  const chars  = [
    upper[Math.floor(Math.random() * upper.length)],
    digits[Math.floor(Math.random() * digits.length)],
    ...Array.from({ length: 6 }, () => pool[Math.floor(Math.random() * pool.length)]),
  ]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

interface EmpRow {
  id: string; name: string; employee_code: string; email: string | null; phone: string | null
  department_id: string | null; job_title_id: string | null
  allowed_categories: string[] | null; warehouse_scope: string | null
  warehouse_id: string | null; is_active: boolean; created_at: string; deleted_at: string | null
  ncc_id: string | null; is_driver: boolean; manager_id: string | null
}

const EMP_BASE = [
  'id', 'name', 'employee_code', 'email', 'phone',
  'department_id', 'job_title_id',
  'allowed_categories', 'warehouse_scope',
  'warehouse_id', 'is_active', 'created_at', 'updated_at', 'deleted_at',
  'created_by', 'updated_by',
  'ncc_id', 'is_driver', 'manager_id',
].join(', ')

// Fetch employees và join dept / job_title / warehouse_access thủ công
// (tránh Supabase FK join cho FK mới — PostgREST schema cache có thể chưa reload)
async function fetchFull(opts: {
  ids?: string[]
  department_id?: string
  is_active?: boolean
  search?: string
  include_deleted?: boolean
}) {
  // Phân trang (cap ~1000 dòng/response) — Employee sẽ vượt 1000 khi thêm tài khoản lái xe;
  // scope lọc SAU fetch (listEmployees) nên bị cắt là mất người khỏi DS âm thầm.
  const buildQ = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = supabase.from('Employee').select(EMP_BASE).order('name').order('id')
    if (!opts.include_deleted) q = q.is('deleted_at', null)
    if (opts.ids?.length)      q = q.in('id', opts.ids)
    if (opts.department_id)    q = q.eq('department_id', opts.department_id)
    if (opts.is_active !== undefined) q = q.eq('is_active', opts.is_active)
    if (opts.search)           q = q.or(`name.ilike.%${opts.search}%,employee_code.ilike.%${opts.search}%,email.ilike.%${opts.search}%`)
    return q
  }
  const emps = await fetchAllRowsParallel(buildQ) as unknown as EmpRow[]
  if (!emps.length) return []

  // ── Departments ────────────────────────────────────────────────────────────
  const deptIds = [...new Set(emps.map(e => e.department_id).filter((x): x is string => !!x))]
  const { data: depts } = deptIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await supabase.from('Department').select('id, name, code').in('id', deptIds)
    : { data: [] as { id: string; name: string; code: string }[] }

  // ── JobTitles ──────────────────────────────────────────────────────────────
  const jtIds = [...new Set(emps.map(e => e.job_title_id).filter((x): x is string => !!x))]
  const { data: jts } = jtIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await supabase.from('JobTitle').select('id, name').in('id', jtIds)
    : { data: [] as { id: string; name: string }[] }

  // ── Warehouse access ───────────────────────────────────────────────────────
  const empIds = emps.map(e => e.id)
  const { data: waRows } = await supabase.from('UserWarehouseAccess')
    .select('employee_id, warehouse_id')
    .in('employee_id', empIds)

  const wIds = [...new Set(((waRows ?? []) as { employee_id: string; warehouse_id: string }[]).map(r => r.warehouse_id))]
  const { data: whs } = wIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await supabase.from('Warehouse').select('id, code, name').in('id', wIds)
    : { data: [] as { id: string; code: string; name: string }[] }

  // ── Merge ──────────────────────────────────────────────────────────────────
  const deptMap = new Map(((depts ?? []) as { id: string; name: string; code: string }[]).map(d => [d.id, d]))
  const jtMap   = new Map(((jts   ?? []) as { id: string; name: string }[]).map(j => [j.id, j]))
  const whMap   = new Map(((whs   ?? []) as { id: string; code: string; name: string }[]).map(w => [w.id, w]))

  const waByEmp = new Map<string, { warehouse_id: string; warehouse: { id: string; code: string; name: string } | null }[]>()
  for (const wa of ((waRows ?? []) as { employee_id: string; warehouse_id: string }[])) {
    const list = waByEmp.get(wa.employee_id) ?? []
    list.push({ warehouse_id: wa.warehouse_id, warehouse: whMap.get(wa.warehouse_id) ?? null })
    waByEmp.set(wa.employee_id, list)
  }

  // ── Quản lý trực tiếp ────────────────────────────────────────────────────
  const mgrIds = [...new Set(emps.map(e => e.manager_id).filter((x): x is string => !!x))]
  const { data: mgrs } = mgrIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await supabase.from('Employee').select('id, name, employee_code').in('id', mgrIds)
    : { data: [] as { id: string; name: string; employee_code: string }[] }
  const mgrMap = new Map(((mgrs ?? []) as { id: string; name: string; employee_code: string }[]).map(m => [m.id, m]))

  return emps.map(emp => ({
    ...emp,
    dept:             deptMap.get(emp.department_id ?? '') ?? null,
    job_title:        jtMap.get(emp.job_title_id ?? '')   ?? null,
    warehouse_access: waByEmp.get(emp.id)                 ?? [],
    manager:          mgrMap.get(emp.manager_id ?? '')    ?? null,
  }))
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listEmployees(req: Request, res: Response) {
  try {
    const { department_id, is_active, search, include_deleted } = req.query as Record<string, string>
    const scope = await visibleEmployeeIds(req)
    const data = await fetchFull({
      department_id: department_id || undefined,
      is_active: is_active !== undefined ? is_active === 'true' : undefined,
      search: search || undefined,
      include_deleted: include_deleted === 'true',
    })
    return ok(res, scope === null ? data : data.filter(e => scope.has(e.id)))
  } catch (e) { return fail(res, String(e)) }
}

export async function getEmployee(req: Request, res: Response) {
  try {
    const scope = await visibleEmployeeIds(req)
    if (scope !== null && !scope.has(req.params.id)) return fail(res, 'Không có quyền xem nhân viên này', 403)
    const rows = await fetchFull({ ids: [req.params.id], include_deleted: true })
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
      allowed_categories, warehouse_scope,
      warehouse_ids = [],
      ncc_id, is_driver = false, manager_id,
    } = req.body as {
      name: string; employee_code: string; email?: string; phone?: string
      department_id?: string | null; job_title_id?: string | null
      allowed_categories?: string[]; warehouse_scope?: string
      warehouse_ids?: string[]
      ncc_id?: string | null; is_driver?: boolean; manager_id?: string | null
    }

    if (!name || !employee_code) return fail(res, 'name và employee_code là bắt buộc', 400)

    const empId = randomUUID()
    const tempPassword = generateTempPassword()
    const hashedPw = await bcrypt.hash(tempPassword, 10)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const now = new Date().toISOString()
    const actor = req.user?.name || null
    const { error } = await supabase.from('Employee').insert({
      id: empId, name, employee_code,
      email: email || null, phone: phone || null,
      department_id: department_id || null,
      job_title_id:  job_title_id  || null,
      allowed_categories: allowed_categories ?? ['Thành phẩm', 'NVL', 'POSM', 'Bao bì'],
      warehouse_scope: warehouse_scope ?? 'ASSIGNED',
      ncc_id: ncc_id || null,
      is_driver: is_driver ?? false,
      manager_id: manager_id || null,
      password: hashedPw,
      is_active: true,
      created_at: now,
      updated_at: now,
      created_by: actor,
      updated_by: actor,
    })
    if (error) return fail(res, error.message)

    if (warehouse_ids.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('UserWarehouseAccess').insert(
        warehouse_ids.map(wid => ({
          id: randomUUID(), employee_id: empId, warehouse_id: wid,
        }))
      )
    }

    const rows = await fetchFull({ ids: [empId] })
    return ok(res, { ...rows[0], temp_password: tempPassword }, 201)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateEmployee(req: Request, res: Response) {
  try {
    if (!isSuperadmin(req)) return fail(res, 'Chỉ Admin được sửa hồ sơ nhân viên', 403)
    const { id } = req.params
    const {
      name, phone, email, employee_code,
      department_id, job_title_id,
      allowed_categories, warehouse_scope,
      warehouse_ids,
      is_active,
      ncc_id, is_driver, manager_id,
    } = req.body as {
      name?: string; phone?: string; email?: string; employee_code?: string
      department_id?: string | null; job_title_id?: string | null
      allowed_categories?: string[]; warehouse_scope?: string
      warehouse_ids?: string[]
      is_active?: boolean
      ncc_id?: string | null; is_driver?: boolean; manager_id?: string | null
    }

    // Build update object explicitly — exclude undefined fields so Supabase doesn't overwrite them with null
    // (quyền nằm trên JobTitle, không phải Employee — không đụng module_permissions ở đây)
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    if (name              !== undefined) updates.name              = name
    if (phone             !== undefined) updates.phone             = phone
    if (email             !== undefined) updates.email             = email
    if (employee_code     !== undefined) updates.employee_code     = employee_code
    if (department_id     !== undefined) updates.department_id     = department_id
    if (job_title_id      !== undefined) updates.job_title_id      = job_title_id
    if (allowed_categories !== undefined) updates.allowed_categories = allowed_categories
    if (warehouse_scope   !== undefined) updates.warehouse_scope   = warehouse_scope
    if (is_active         !== undefined) updates.is_active         = is_active
    if (ncc_id            !== undefined) updates.ncc_id            = ncc_id
    if (is_driver         !== undefined) updates.is_driver         = is_driver
    if (manager_id        !== undefined) updates.manager_id        = manager_id || null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('Employee')
      .update(updates)
      .eq('id', id)
    if (error) return fail(res, error.message)

    if (warehouse_ids !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('UserWarehouseAccess').delete().eq('employee_id', id)
      if (warehouse_ids.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('UserWarehouseAccess').insert(
          warehouse_ids.map(wid => ({ id: randomUUID(), employee_id: id, warehouse_id: wid }))
        )
      }
    }

    const rows = await fetchFull({ ids: [id] })
    return ok(res, rows[0])
  } catch (e) { return fail(res, String(e)) }
}

// ─── Set quản lý trực tiếp (kéo-thả sơ đồ tổ chức) ─────────────────────────────

export async function setManager(req: Request, res: Response) {
  try {
    if (await blockIfTargetSuperadmin(req, res)) return
    const { id } = req.params
    const { manager_id } = req.body as { manager_id?: string | null }
    const mgr = manager_id || null
    if (mgr === id) return fail(res, 'Không thể đặt chính mình làm quản lý', 400)

    // chống vòng lặp: mgr không được là cấp dưới (hậu duệ) của id
    if (mgr) {
      let cur: string | null = mgr
      const seen = new Set<string>()
      while (cur) {
        if (cur === id) return fail(res, 'Không thể tạo vòng lặp quản lý', 400)
        if (seen.has(cur)) break
        seen.add(cur)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: { data: { manager_id: string | null } | null } = await supabase.from('Employee').select('manager_id').eq('id', cur).maybeSingle()
        cur = r.data?.manager_id ?? null
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('Employee')
      .update({ manager_id: mgr, updated_at: new Date().toISOString(), updated_by: req.user?.name || null })
      .eq('id', id)
    if (error) return fail(res, error.message)
    const rows = await fetchFull({ ids: [id] })
    return ok(res, rows[0])
  } catch (e) { return fail(res, String(e)) }
}

// ─── Set password (admin only) ────────────────────────────────────────────────

export async function setPassword(req: Request, res: Response) {
  try {
    if (await blockIfTargetSuperadmin(req, res)) return
    const { id } = req.params
    const { password } = req.body as { password?: string }
    if (!password || password.length < 6) return fail(res, 'Mật khẩu phải có ít nhất 6 ký tự', 400)

    const hash = await bcrypt.hash(password, 10)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('Employee')
      .update({ password: hash, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return fail(res, error.message)

    return ok(res, { message: 'Đặt mật khẩu thành công' })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function employeeHasHistory(id: string): Promise<boolean> {
  // Các bảng dùng TEXT column (không phải FK constraint) — phải check thủ công
  const checks = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.from('ProductionImport')
      .select('id', { count: 'exact', head: true })
      .or(`imported_by.eq.${id},created_by.eq.${id}`),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.from('InventoryEntry')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.from('OutboundScanEntry')
      .select('id', { count: 'exact', head: true })
      .eq('scanned_by', id),
  ])
  return checks.some(r => (r.count ?? 0) > 0)
}

export async function deleteEmployee(req: Request, res: Response) {
  try {
    if (await blockIfTargetSuperadmin(req, res)) return
    const { id } = req.params

    const hasHistory = await employeeHasHistory(id)
    if (hasHistory) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: softErr } = await supabase.from('Employee')
        .update({ deleted_at: new Date().toISOString(), is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (softErr) return fail(res, softErr.message)
      return ok(res, { message: 'Nhân viên có lịch sử hoạt động — đã ẩn khỏi danh sách', deleted: 'soft' })
    }

    // Không có lịch sử → hard delete (FK constraint thực như UserWarehouseAccess sẽ cascade)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: hardErr } = await supabase.from('Employee').delete().eq('id', id)
    if (!hardErr) return ok(res, { message: 'Đã xóa nhân viên', deleted: 'hard' })

    // Vẫn còn FK constraint DB-level khác (23503) → soft delete
    if (hardErr.code === '23503') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: softErr } = await supabase.from('Employee')
        .update({ deleted_at: new Date().toISOString(), is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (softErr) return fail(res, softErr.message)
      return ok(res, { message: 'Nhân viên có lịch sử hoạt động — đã ẩn khỏi danh sách', deleted: 'soft' })
    }

    return fail(res, hardErr.message)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Restore (undo soft delete) ───────────────────────────────────────────────

export async function restoreEmployee(req: Request, res: Response) {
  try {
    if (await blockIfTargetSuperadmin(req, res)) return
    const { id } = req.params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('Employee')
      .update({ deleted_at: null, is_active: true, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return fail(res, error.message)
    const rows = await fetchFull({ ids: [id], include_deleted: true })
    return ok(res, rows[0])
  } catch (e) { return fail(res, String(e)) }
}

// ─── Warehouse access ─────────────────────────────────────────────────────────

export async function setWarehouseAccess(req: Request, res: Response) {
  try {
    if (!isSuperadmin(req)) return fail(res, 'Chỉ Admin được sửa phạm vi kho', 403)
    const { id } = req.params
    const { warehouse_ids } = req.body as { warehouse_ids: string[] }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('UserWarehouseAccess').delete().eq('employee_id', id)
    if (warehouse_ids.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('UserWarehouseAccess').insert(
        warehouse_ids.map(wid => ({ id: randomUUID(), employee_id: id, warehouse_id: wid }))
      )
    }

    const rows = await fetchFull({ ids: [id] })
    return ok(res, rows[0])
  } catch (e) { return fail(res, String(e)) }
}
