import { Request, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { JWT_SECRET, type JwtPayload } from '../../middlewares/auth'
import { ALL_PERMISSIONS } from '../../config/permissions'

// 24h thay vì 7d: giảm cửa sổ token-bị-trộm-của-tài-khoản-đã-vô-hiệu-hóa gọi API trực tiếp
// (từ ≤7 ngày xuống ≤1 ngày). FE refreshUser (5' + on-load) tái cấp token mới → phiên đang
// dùng KHÔNG hết hạn; chỉ phải đăng nhập lại nếu đóng app >24h. Áp cho cả token app + vé realtime.
const JWT_EXPIRY = '1d'

// Hash giả (cố định lúc load) để bcrypt.compare LUÔN chạy kể cả khi không tìm thấy
// tài khoản → cân bằng thời gian phản hồi, chống timing-attack enumerate email.
const DUMMY_HASH = bcrypt.hashSync('timing-attack-dummy-password', 10)

// Chuẩn hóa email nhập vào để so khớp AN TOÀN: escape ký tự đại diện LIKE (% _ \)
// → dùng với .ilike() giữ so-khớp-không-phân-biệt-hoa-thường nhưng KHÔNG cho input
// chứa `%`/`_` biến thành wildcard (chống LIKE-injection khớp tài khoản bất kỳ).
function escapeLikeEmail(raw: string): string {
  return raw.trim().replace(/[\\%_]/g, m => '\\' + m)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getWarehouseIds(employeeId: string): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await supabase.from('UserWarehouseAccess')
    .select('warehouse_id')
    .eq('employee_id', employeeId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r: { warehouse_id: string }) => r.warehouse_id)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildToken(emp: any, warehouseIds: string[], modulePerms: Record<string, string[]>): string {
  const payload: JwtPayload = {
    sub:                emp.id,
    name:               emp.name,
    email:              emp.email ?? null,
    warehouse_scope:    emp.warehouse_scope ?? 'ASSIGNED',
    warehouse_id:       emp.warehouse_id ?? null,
    allowed_categories: emp.allowed_categories ?? [],
    warehouse_ids:      warehouseIds,
    module_permissions: modulePerms,
    ncc_id:             emp.ncc_id ?? null,
    is_superadmin:      emp.employee_code === 'ADMIN' || emp.name === 'Admin',   // middleware bypass đọc từ token — khớp điều kiện resolve quyền
  }
  return jwt.sign(payload, JWT_SECRET(), { expiresIn: JWT_EXPIRY })
}

// Vé Realtime: JWT ký bằng SUPABASE JWT SECRET, role 'authenticated' → client ĐÃ ĐĂNG
// NHẬP kết nối Supabase Realtime dưới RLS (chỉ authenticated đọc được, anon bị chặn).
// CHƯA cấu hình SUPABASE_JWT_SECRET → trả null → FE giữ hành vi cũ (anon), KHÔNG vỡ gì.
// Chỉ khi (a) set secret + (b) apply migration RLS đóng-hẳn thì cơ chế này mới siết.
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET
function buildRealtimeToken(empId: string): string | null {
  if (!SUPABASE_JWT_SECRET) return null
  return jwt.sign({ role: 'authenticated', aud: 'authenticated', sub: empId }, SUPABASE_JWT_SECRET, { expiresIn: JWT_EXPIRY })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildUserObj(emp: any, warehouseIds: string[], modulePerms: Record<string, string[]>, warehouseName?: string, jobTitleName?: string) {
  return {
    id:                 emp.id,
    name:               emp.name,
    email:              emp.email ?? null,
    employee_code:      emp.employee_code ?? null,
    warehouse_scope:    emp.warehouse_scope ?? 'ASSIGNED',
    warehouse_id:       emp.warehouse_id ?? null,
    warehouse_name:     warehouseName ?? null,
    job_title_id:       emp.job_title_id ?? null,
    job_title_name:     jobTitleName ?? null,
    allowed_categories: emp.allowed_categories ?? [],
    warehouse_ids:      warehouseIds,
    module_permissions: modulePerms,
    ncc_id:             emp.ncc_id ?? null,
  }
}

// ─── POST /api/auth/login ──────────────────────────────────────────────────

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body as { email?: unknown; password?: unknown }
    // Kiểm KIỂU chứ không chỉ truthy: email dạng object/mảng (payload dị dạng) từng lọt xuống
    // .ilike → 500 (digest bắt 29/07). Rác đầu vào = 400, không phải lỗi hệ thống.
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password)
      return fail(res, 'Email và mật khẩu là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: emps, error: lookupErr } = await supabase.from('Employee')
      .select('id, name, employee_code, email, warehouse_scope, warehouse_id, allowed_categories, password, is_active, module_permissions, job_title_id, ncc_id')
      .ilike('email', escapeLikeEmail(email))
      .limit(1)

    // DB KHÔNG TRUY CẬP ĐƯỢC ≠ SAI MẬT KHẨU (phát hiện 28/07: staging trả 522 giữa lúc test tải).
    // Trước đây `error` bị BỎ QUA ⇒ data null ⇒ rơi vào nhánh 401 "Tên đăng nhập hoặc mật khẩu không
    // đúng": trong một sự cố DB thì TOÀN BỘ nhân sự tưởng mật khẩu mình hỏng và đi đổi mật khẩu, còn
    // người trực thì mất thời gian tìm sai chỗ. Nay trả 503 (client thấy message 5xx chung — đủ để
    // hiểu là lỗi hệ thống chứ không phải sai mật khẩu; chi tiết log server-side).
    // KHÔNG làm yếu chống-liệt-kê-tài-khoản: nhánh này không phụ thuộc tài khoản có tồn tại hay không.
    if (lookupErr) return fail(res, `login: Employee lookup failed — ${lookupErr.message}`, 503)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emp = (emps as any[])?.[0]

    // LUÔN chạy bcrypt.compare (dùng hash giả nếu không có tài khoản) → chống timing;
    // KHÔNG tiết lộ tài khoản tồn tại/bị khóa/chưa có mật khẩu TRƯỚC khi xác thực đúng
    // mật khẩu → chống enumeration. Mọi thất bại pre-auth trả cùng 1 message + 401.
    const valid = await bcrypt.compare(password, emp?.password || DUMMY_HASH)
    if (!emp || !emp.password || !valid) {
      return fail(res, 'Tên đăng nhập hoặc mật khẩu không đúng', 401)
    }
    // Đã chứng minh biết đúng mật khẩu → giờ mới báo trạng thái tài khoản (an toàn tiết lộ)
    if (!emp.is_active) return fail(res, 'Tài khoản đã bị vô hiệu hóa. Liên hệ quản trị viên.', 403)

    // Run all 3 independent post-auth queries in parallel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [warehouseIds, jtData, whData] = await Promise.all([
      getWarehouseIds(emp.id),
      emp.job_title_id
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? supabase.from('JobTitle').select('module_permissions, name').eq('id', emp.job_title_id).single().then((r: any) => r.data)
        : Promise.resolve(null),
      emp.warehouse_id
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? supabase.from('Warehouse').select('name').eq('id', emp.warehouse_id).single().then((r: any) => r.data)
        : Promise.resolve(null),
    ])

    // Resolve module_permissions: superadmin (employee_code=ADMIN hoặc name=Admin) gets all; else dùng job_title
    let modulePerms: Record<string, string[]> = {}
    const isSuperAdmin = emp.employee_code === 'ADMIN' || emp.name === 'Admin'
    if (isSuperAdmin) {
      modulePerms = ALL_PERMISSIONS as Record<string, string[]>
    } else if (jtData?.module_permissions && Object.keys(jtData.module_permissions).length > 0) {
      modulePerms = jtData.module_permissions
    }

    const token = buildToken(emp, warehouseIds, modulePerms)
    return ok(res, { token, realtime_token: buildRealtimeToken(emp.id), user: buildUserObj(emp, warehouseIds, modulePerms, whData?.name, jtData?.name) })
  } catch (e) { return fail(res, String(e)) }
}

// ─── GET /api/auth/me ──────────────────────────────────────────────────────

export async function me(req: Request, res: Response) {
  try {
    const userId = req.user?.sub
    if (!userId) return fail(res, 'Unauthorized', 401)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: emps } = await supabase.from('Employee')
      .select('id, name, employee_code, email, warehouse_scope, warehouse_id, allowed_categories, is_active, module_permissions, job_title_id, ncc_id')
      .eq('id', userId).limit(1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emp = (emps as any[])?.[0]
    if (!emp || !emp.is_active) return fail(res, 'Tài khoản không tồn tại hoặc đã bị vô hiệu hóa', 401)

    // Re-resolve permissions fresh from DB (same as login) so permission changes take effect on next refresh
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [warehouseIds, jtData, whData] = await Promise.all([
      getWarehouseIds(emp.id),
      emp.job_title_id
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? supabase.from('JobTitle').select('module_permissions, name').eq('id', emp.job_title_id).single().then((r: any) => r.data)
        : Promise.resolve(null),
      emp.warehouse_id
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? supabase.from('Warehouse').select('name').eq('id', emp.warehouse_id).single().then((r: any) => r.data)
        : Promise.resolve(null),
    ])

    let modulePerms: Record<string, string[]> = {}
    const isSuperAdmin = emp.employee_code === 'ADMIN' || emp.name === 'Admin'
    if (isSuperAdmin) {
      modulePerms = ALL_PERMISSIONS as Record<string, string[]>
    } else if (jtData?.module_permissions && Object.keys(jtData.module_permissions).length > 0) {
      modulePerms = jtData.module_permissions
    }

    const token = buildToken(emp, warehouseIds, modulePerms)
    return ok(res, { user: buildUserObj(emp, warehouseIds, modulePerms, whData?.name, jtData?.name), token, realtime_token: buildRealtimeToken(emp.id) })
  } catch (e) { return fail(res, String(e)) }
}

// ─── POST /api/auth/change-password ─────────────────────────────────────────

export async function changePassword(req: Request, res: Response) {
  try {
    const userId = req.user?.sub
    if (!userId) return fail(res, 'Unauthorized', 401)

    const { old_password, new_password } = req.body as { old_password?: string; new_password?: string }
    if (!old_password || !new_password) return fail(res, 'Thiếu thông tin', 400)
    if (new_password.length < 8) return fail(res, 'Mật khẩu mới phải có ít nhất 8 ký tự', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: emps } = await supabase.from('Employee')
      .select('id, password').eq('id', userId).limit(1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emp = (emps as any[])?.[0]
    if (!emp)          return fail(res, 'Không tìm thấy tài khoản', 404)
    if (!emp.password) return fail(res, 'Tài khoản chưa có mật khẩu. Liên hệ quản trị viên.', 400)

    const valid = await bcrypt.compare(old_password, emp.password)
    if (!valid) return fail(res, 'Mật khẩu hiện tại không đúng', 401)

    const hash = await bcrypt.hash(new_password, 10)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('Employee')
      .update({ password: hash, updated_at: new Date().toISOString() })
      .eq('id', userId)

    return ok(res, { message: 'Đổi mật khẩu thành công' })
  } catch (e) { return fail(res, String(e)) }
}
