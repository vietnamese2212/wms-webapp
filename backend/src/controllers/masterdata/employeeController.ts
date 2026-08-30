import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import bcrypt from 'bcrypt'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel, fetchAllByIdChunks } from '../../utils/pagination'
import { safeSearch } from '../../utils/search'

// ─── Phân quyền: bảo vệ tài khoản Admin + giới hạn phạm vi thấy nhân sự ─────────
function isSuperadmin(req: Request): boolean {
  // Cờ is_superadmin trong token = cột Employee.is_superadmin (migration 20260813f) — không so tên
  return req.user?.is_superadmin === true
}

// Chống leo thang: non-superadmin không được gán cho tài khoản/chức danh quyền mà CHÍNH
// MÌNH không có. Trả message lỗi nếu vi phạm, null nếu hợp lệ. (Cùng logic departmentController.)
function escalationError(req: Request, perms?: Record<string, string[]>): string | null {
  if (isSuperadmin(req)) return null
  const mine: Record<string, string[]> = req.user?.module_permissions ?? {}
  for (const [mod, actions] of Object.entries(perms ?? {})) {
    for (const a of (actions ?? [])) {
      if (!mine[mod]?.includes(a)) return `Không thể cấp quyền vượt quá quyền của bạn: ${mod}.${a}`
    }
  }
  return null
}

// Chặn non-superadmin thao tác trên tài khoản superadmin (Admin). true = đã chặn (đã trả lỗi).
async function blockIfTargetSuperadmin(req: Request, res: Response): Promise<boolean> {
  if (isSuperadmin(req)) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await supabase.from('Employee')
    .select('is_superadmin').eq('id', req.params.id).maybeSingle()
  if (data?.is_superadmin === true) {
    fail(res, 'Chỉ Admin mới được thao tác trên tài khoản Admin', 403)
    return true
  }
  return false
}

// Chặn thao tác GHI (đặt MK / xóa / đổi sơ đồ / khôi phục) trên nhân viên NGOÀI phạm vi
// quản lý của người gọi. true = đã chặn (đã trả 403). Superadmin (visibleEmployeeIds=null) đi qua.
// Vá lỗ account-takeover: trước đây các hàm này chỉ chặn target-là-superadmin, KHÔNG kiểm scope
// → người có quyền set_password có thể đặt lại MK của BẤT KỲ ai rồi chiếm tài khoản.
async function blockIfOutOfScope(req: Request, res: Response, targetId: string): Promise<boolean> {
  const scope = await visibleEmployeeIds(req)
  if (scope === null) return false            // superadmin — toàn quyền
  if (!scope.has(targetId)) {
    fail(res, 'Không có quyền thao tác trên nhân viên ngoài phạm vi quản lý', 403)
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
  if (u.is_superadmin === true) return null

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
      // Phân trang (>1000 nhân sự cấp dưới thì list bị cắt → nhân viên biến mất khỏi scope)
      const subs = await fetchAllRowsParallel(() => supabase.from('Employee')
        .select('id').in('job_title_id', [...descJt]).order('id'))
      for (const s of ((subs ?? []) as { id: string }[])) allowed.add(s.id)
    }
  }

  // 2. Giao với phạm vi kho (nếu ASSIGNED — NATIONAL thì không giới hạn kho)
  if (u.warehouse_scope === 'ASSIGNED') {
    const whIds: string[] = u.warehouse_ids ?? []
    if (!whIds.length) return new Set<string>([self])
    // Phân trang (nhân sự × kho >1000 thì inWh thiếu → cắt oan khỏi scope)
    const wa = await fetchAllRowsParallel(() => supabase.from('UserWarehouseAccess')
      .select('employee_id').in('warehouse_id', whIds).order('employee_id').order('warehouse_id'))
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

// `view=lite`: chỉ các cột đủ để DỰNG SƠ ĐỒ / ĐỔ DROPDOWN, không phải hồ sơ đầy đủ.
// Đo 28/07: dòng nhân sự đầy đủ ≈ 830 B ⇒ 1.539 người = 1.230KB và ~5.400 người là vượt trần
// 4,5MB của Vercel. Sơ đồ tổ chức chỉ cần tên + chức danh + kho; ô chọn chỉ cần tên + mã.
const EMP_LITE = ['id', 'name', 'employee_code', 'job_title_id', 'department_id', 'is_active'].join(', ')

// Fetch employees và join dept / job_title / warehouse_access thủ công
// (tránh Supabase FK join cho FK mới — PostgREST schema cache có thể chưa reload)
async function fetchFull(opts: {
  ids?: string[]
  department_id?: string
  is_active?: boolean
  search?: string
  include_deleted?: boolean
  lite?: boolean          // chỉ cột dựng sơ đồ / đổ dropdown (xem EMP_LITE)
}) {
  // Phân trang (cap ~1000 dòng/response) — Employee sẽ vượt 1000 khi thêm tài khoản lái xe;
  // scope lọc SAU fetch (listEmployees) nên bị cắt là mất người khỏi DS âm thầm.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyF = (q: any): any => {
    if (!opts.include_deleted) q = q.is('deleted_at', null)
    if (opts.department_id)    q = q.eq('department_id', opts.department_id)
    if (opts.is_active !== undefined) q = q.eq('is_active', opts.is_active)
    if (opts.search) { const s = safeSearch(opts.search); q = q.or(`name.ilike.%${s}%,employee_code.ilike.%${s}%,email.ilike.%${s}%`) }
    return q
  }
  // Có danh sách id (nạp đúng 1 trang) → CHUNK 300: trang 500 dòng nhồi 1 `.in()` là vỡ URL
  // PostgREST (trần ~300 uuid — xem [[id-list-url-limits]]). Không có id → phân trang cả bảng.
  const SEL = opts.lite ? EMP_LITE : EMP_BASE
  const emps = (opts.ids?.length
    ? await fetchAllByIdChunks(opts.ids, chunk => applyF(
        supabase.from('Employee').select(SEL).in('id', chunk)).order('name').order('id'))
    : await fetchAllRowsParallel(() => applyF(
        supabase.from('Employee').select(SEL)).order('name').order('id'))) as unknown as EmpRow[]
  if (!emps.length) return []

  // LITE: chỉ kèm danh sách id kho được gán (sơ đồ tổ chức lọc theo kho) — KHÔNG tra tên
  // phòng ban / chức danh / quản lý / tên kho. Bên gọi đã có sẵn danh mục đó (useJobTitles,
  // useDepartments, useScopedWarehouses) nên nhúng lại vào TỪNG dòng chỉ làm phình payload.
  if (opts.lite) {
    const waLite = await fetchAllByIdChunks(emps.map(e => e.id), chunk =>
      supabase.from('UserWarehouseAccess').select('employee_id, warehouse_id')
        .in('employee_id', chunk).order('employee_id')) as { employee_id: string; warehouse_id: string }[]
    const byEmp = new Map<string, { warehouse_id: string }[]>()
    for (const wa of waLite) {
      const l = byEmp.get(wa.employee_id) ?? []
      l.push({ warehouse_id: wa.warehouse_id })
      byEmp.set(wa.employee_id, l)
    }
    return emps.map(emp => ({ ...emp, warehouse_access: byEmp.get(emp.id) ?? [] }))
  }

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
  // CHUNK 300 id/lô: nhồi cả danh sách nhân sự vào 1 `.in()` là vỡ URL PostgREST — đo thật
  // 28/07 trên staging: 385 nhân sự còn chạy, **395 là đứt kết nối → HTTP 500 sau 8,5s**
  // (trang Quản lý người dùng + Bảng công trắng màn). Xem [[id-list-url-limits]]: trần ~300
  // uuid/11KB URL. fetchAllByIdChunks lo cả chunk id lẫn phân trang cap ~1000 trong mỗi lô.
  const empIds = emps.map(e => e.id)
  const waRows = await fetchAllByIdChunks(empIds, chunk => supabase.from('UserWarehouseAccess')
    .select('employee_id, warehouse_id')
    .in('employee_id', chunk)
    .order('employee_id').order('warehouse_id')) as { employee_id: string; warehouse_id: string }[]

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
  // cũng chunk 300 — số quản lý ít hơn nhân sự nhưng vẫn tăng theo quy mô, đừng để vỡ URL
  const mgrs = mgrIds.length
    ? await fetchAllByIdChunks(mgrIds, chunk => supabase.from('Employee')
        .select('id, name, employee_code').in('id', chunk).order('id'))
    : ([] as { id: string; name: string; employee_code: string }[])
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

// Trang Quản lý người dùng — phân trang SERVER (RPC `hr_employees_page`).
// Đo thật 28/07: trả cả bảng thì 3.000 nhân sự = 2.495KB (trần 4,5MB response của Vercel ở
// ~5.400 NV) và mọi bộ lọc/tìm kiếm chạy ở trình duyệt trên tập đã tải. Scope nhân sự vẫn
// resolve ở đây (kho ∩ cấp dưới theo JobTitle) rồi truyền xuống RPC bằng THAM SỐ MẢNG —
// POST body nên không dính trần ~300 id trên URL.
export async function listEmployeesPaged(req: Request, res: Response) {
  const q = req.query as Record<string, string | undefined>
  const pageNum  = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1)
  const pageSize = Math.min(500, Math.max(1, parseInt(String(q.page_size ?? '100'), 10) || 100))
  const scope = await visibleEmployeeIds(req)

  const { data, error } = await supabase.rpc('hr_employees_page', {
    p_scope_ids:    scope === null ? null : [...scope],
    p_dept:         q.department_id || null,
    p_jt_id:        q.job_title_id || null,
    p_wh:           q.warehouse_id || null,
    p_search:       q.search || null,
    p_active:       q.is_active === undefined || q.is_active === '' ? null : String(q.is_active),
    p_incl_deleted: q.include_deleted === 'true',
    p_status:       q.status || null,
    p_offset:       (pageNum - 1) * pageSize,
    p_limit:        pageSize,
  })
  if (error) return fail(res, error.message)
  const pd = (data ?? {}) as { ids?: string[]; total?: number; active?: number; paused?: number; hidden?: number }
  const ids = pd.ids ?? []
  // fetchFull chỉ nạp ĐÚNG nhân sự của trang này (đã chunk 300 bên trong)
  const rows = ids.length ? await fetchFull({ ids, include_deleted: true }) : []
  const byId = new Map(rows.map(r => [r.id, r]))
  return ok(res, {
    rows: ids.map(id => byId.get(id)).filter(Boolean),
    total: pd.total ?? 0, active: pd.active ?? 0, paused: pd.paused ?? 0, hidden: pd.hidden ?? 0,
    page: pageNum, page_size: pageSize,
  })
}

export async function listEmployees(req: Request, res: Response) {
  try {
    // Chế độ MẢNG giữ nguyên cho các consumer cần roster đầy đủ (Sơ đồ tổ chức, chọn người
    // trong Nhập kho, map tên ở Nghỉ phép) — chỉ trang Quản lý người dùng truyền ?page=.
    if (req.query.page) return await listEmployeesPaged(req, res)
    const { department_id, is_active, search, include_deleted, view } = req.query as Record<string, string>
    const scope = await visibleEmployeeIds(req)
    const data = await fetchFull({
      department_id: department_id || undefined,
      is_active: is_active !== undefined ? is_active === 'true' : undefined,
      search: search || undefined,
      include_deleted: include_deleted === 'true',
      // ?view=lite — chỉ cột dựng sơ đồ / đổ dropdown (Sơ đồ tổ chức, ô chọn NV ở Nghỉ phép).
      // Hồ sơ đầy đủ ≈ 830 B/dòng ⇒ vượt trần 4,5MB từ ~5.400 người.
      lite: view === 'lite',
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
    // Tài khoản mới cũng phải có kho ngay từ đầu — xem emptyScopeError. `warehouse_ids` mặc định `[]`
    // nên nếu không chặn ở đây thì "tạo tài khoản rồi gán kho sau" chính là đường sinh ra kẽ hở.
    if (await emptyScopeError(res, '', warehouse_scope ?? 'ASSIGNED', warehouse_ids)) return
    if (await badWarehouseError(res, warehouse_ids)) return

    // ── ỦY QUYỀN CÓ RÀO CHẮN (delegation, không leo thang) ──────────────────────
    // Quản lý đơn vị (có user_admin.create) TẠO ĐƯỢC tài khoản, nhưng KHÔNG được vượt
    // quyền/kho/loại của chính mình → tránh tự nâng cấp qua việc tạo tài khoản khác.
    const callerSuper = isSuperadmin(req)
    if (!callerSuper) {
      // 1. Không tạo tài khoản superadmin
      if (name === 'Admin' || employee_code === 'ADMIN')
        return fail(res, 'Không thể tạo tài khoản Admin', 403)
      // 2. Không đặt phạm vi toàn hệ thống (NATIONAL) — chỉ Admin
      if (warehouse_scope && warehouse_scope !== 'ASSIGNED')
        return fail(res, 'Chỉ Admin được đặt phạm vi kho toàn hệ thống', 403)
      // 3. Kho gán cho tài khoản mới ⊆ kho của người tạo
      const myWhs = new Set(req.user?.warehouse_ids ?? [])
      if (warehouse_ids.some(w => !myWhs.has(w)))
        return fail(res, 'Không thể gán kho ngoài phạm vi của bạn', 403)
      // 4. Loại hàng gán ⊆ loại của người tạo (nếu người tạo bị giới hạn loại)
      const myCats = req.user?.allowed_categories ?? []
      if (myCats.length && Array.isArray(allowed_categories) && allowed_categories.some(c => !myCats.includes(c)))
        return fail(res, 'Không thể gán loại hàng ngoài phạm vi của bạn', 403)
      // 5. Chống leo thang: quyền của CHỨC DANH gán cho tài khoản mới ⊆ quyền người tạo
      if (job_title_id) {
        const { data: jt } = await supabase.from('JobTitle').select('module_permissions').eq('id', job_title_id).maybeSingle()
        const escErr = escalationError(req, (jt as { module_permissions?: Record<string, string[]> } | null)?.module_permissions)
        if (escErr) return fail(res, escErr, 403)
      }
    }

    const empId = randomUUID()
    const tempPassword = generateTempPassword()
    const hashedPw = await bcrypt.hash(tempPassword, 10)

    // Default loại hàng: người tạo là Admin → toàn bộ danh mục; non-admin → GIỚI HẠN theo
    // loại của người tạo (không để tài khoản mới mặc định rộng hơn người tạo).
    let defaultCategories = allowed_categories
    if (defaultCategories === undefined) {
      if (!callerSuper && (req.user?.allowed_categories?.length ?? 0) > 0) {
        defaultCategories = req.user!.allowed_categories
      } else {
        const { data: whTypes } = await supabase.from('LookupValue')
          .select('value').eq('type', 'warehouse_type').order('sort_order')
        defaultCategories = ((whTypes ?? []) as { value: string }[]).map(t => t.value)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const now = new Date().toISOString()
    const actor = req.user?.name || null
    const { error } = await supabase.from('Employee').insert({
      id: empId, name, employee_code,
      email: email || null, phone: phone || null,
      department_id: department_id || null,
      job_title_id:  job_title_id  || null,
      allowed_categories: defaultCategories,
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
      // KHÔNG nuốt lỗi: ghi kho hỏng mà vẫn trả 201 là đẻ ra tài khoản 0 kho — trạng thái mà
      // emptyScopeError vừa cấm ở ngay đầu hàm này.
      const { error: waErr } = await supabase.from('UserWarehouseAccess').insert(
        warehouse_ids.map(wid => ({
          id: randomUUID(), employee_id: empId, warehouse_id: wid,
        }))
      )
      if (waErr) return fail(res, `Tạo tài khoản xong nhưng KHÔNG gán được kho: ${waErr.message}`, 500)
    }

    const rows = await fetchFull({ ids: [empId] })
    return ok(res, { ...rows[0], temp_password: tempPassword }, 201)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * CHẶN trạng thái "phạm vi ASSIGNED nhưng KHÔNG kho nào" — trạng thái này VÔ NGHĨA về nghiệp vụ
 * (người đó không làm được gì) và NGUY HIỂM về kỹ thuật: app đọc mảng kho rỗng theo HAI cách trái
 * ngược nhau — `[]` giữ nguyên ⇒ chặn sạch (Tồn kho ghi, Nhập, Xuất), nhưng `ids.length ? ids : null`
 * ⇒ null ⇒ **KHÔNG giới hạn** (Tổng quan, Truy xuất lô, Chi phí kho, facet Tồn kho, dồn/tách pallet).
 * Đo thật 30/08 trên staging: tài khoản chưa gán kho nào nhìn thấy ĐÚNG BẰNG superadmin ở 5 màn.
 *
 * Vá 15 chỗ đọc thì chắc chắn sót (chính lượt quét tay này đã sót 2 chỗ so với đo thực tế) — nên
 * chặn ở CỬA GHI để trạng thái đó không tồn tại; khi ấy hai cách đọc cho cùng một đáp án.
 * Cùng triết lý với loại hàng: `allowed_categories` bỏ trống thì tự điền CẢ danh mục (dòng ~378),
 * cũng là để mảng rỗng không bao giờ xuất hiện.
 *
 * Trả true nghĩa là ĐÃ gửi lỗi cho client, caller phải dừng.
 * @param nextScope   phạm vi SAU khi ghi; undefined = không đổi (đọc lại từ DB)
 * @param nextWhIds   danh sách kho SAU khi ghi; undefined = không đổi (đếm lại từ DB)
 */
/**
 * Kho gán phải CÓ THẬT. Không kiểm thì `emptyScopeError` bị vô hiệu hoàn toàn: nó đếm ĐỘ DÀI mảng,
 * nên gửi một id kho không tồn tại là qua cửa — rồi lệnh ghi `UserWarehouseAccess` hỏng vì khoá
 * ngoại và (trước bản vá này) bị NUỐT, để lại đúng tài khoản 0 kho mà chốt chặn sinh ra để ngăn.
 * Đo thật 30/08: gửi id toàn số 0 → HTTP 201, tài khoản có 0 kho.
 * Kiểm TRƯỚC khi ghi để không tạo ra bản ghi dở dang.
 */
async function badWarehouseError(res: Response, ids: string[] | undefined): Promise<boolean> {
  if (!ids?.length) return false
  const uniq = [...new Set(ids)]
  const { data, error } = await supabase.from('Warehouse').select('id').in('id', uniq)
  if (error) { fail(res, error.message); return true }
  const found = new Set(((data ?? []) as { id: string }[]).map(w => w.id))
  const missing = uniq.filter(id => !found.has(id))
  if (missing.length === 0) return false
  fail(res, `Kho không tồn tại: ${missing.join(', ')}`, 400)
  return true
}

async function emptyScopeError(
  res: Response, empId: string, nextScope: string | undefined, nextWhIds: string[] | undefined,
): Promise<boolean> {
  if (nextScope === undefined && nextWhIds === undefined) return false
  let scope = nextScope
  if (scope === undefined) {
    const { data } = await supabase.from('Employee').select('warehouse_scope').eq('id', empId).maybeSingle()
    scope = (data as { warehouse_scope: string | null } | null)?.warehouse_scope ?? 'ASSIGNED'
  }
  if (scope === 'NATIONAL') return false          // toàn quốc thì không cần gán kho
  let count = nextWhIds?.length
  if (count === undefined) {
    const { data } = await supabase.from('UserWarehouseAccess').select('warehouse_id').eq('employee_id', empId)
    count = (data ?? []).length
  }
  if (count > 0) return false
  fail(res, 'Tài khoản theo phạm vi kho được gán thì phải gán ÍT NHẤT 1 kho — '
    + 'để trống là tài khoản vừa không thao tác được, vừa đọc được dữ liệu của mọi kho', 422)
  return true
}

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

    if (await emptyScopeError(res, id, warehouse_scope, warehouse_ids)) return
    if (await badWarehouseError(res, warehouse_ids)) return

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
        // Xoá xong mà ghi lại hỏng = tài khoản mất sạch kho ÂM THẦM → phải báo, không nuốt.
        const { error: waErr } = await supabase.from('UserWarehouseAccess').insert(
          warehouse_ids.map(wid => ({ id: randomUUID(), employee_id: id, warehouse_id: wid }))
        )
        if (waErr) return fail(res, `Không gán lại được kho cho tài khoản: ${waErr.message}`, 500)
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
    if (await blockIfOutOfScope(req, res, req.params.id)) return
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
    if (await blockIfOutOfScope(req, res, req.params.id)) return
    const { id } = req.params
    const { password } = req.body as { password?: string }
    if (!password || password.length < 8) return fail(res, 'Mật khẩu phải có ít nhất 8 ký tự', 400)

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
    if (await blockIfOutOfScope(req, res, req.params.id)) return
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
    if (await blockIfOutOfScope(req, res, req.params.id)) return
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
    if (await emptyScopeError(res, id, undefined, warehouse_ids)) return
    if (await badWarehouseError(res, warehouse_ids)) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('UserWarehouseAccess').delete().eq('employee_id', id)
    if (warehouse_ids.length > 0) {
      // Như updateEmployee: đã xoá phạm vi cũ, ghi lại hỏng mà im lặng = mất sạch kho âm thầm.
      const { error: waErr } = await supabase.from('UserWarehouseAccess').insert(
        warehouse_ids.map(wid => ({ id: randomUUID(), employee_id: id, warehouse_id: wid }))
      )
      if (waErr) return fail(res, `Không đặt được phạm vi kho: ${waErr.message}`, 500)
    }

    const rows = await fetchFull({ ids: [id] })
    return ok(res, rows[0])
  } catch (e) { return fail(res, String(e)) }
}
