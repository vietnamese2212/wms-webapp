import { Request, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import type { JwtPayload } from '../../middlewares/auth'
import { ALL_PERMISSIONS } from '../../config/permissions'

const JWT_SECRET = () => process.env.JWT_SECRET ?? 'dev-secret-change-in-production'
const JWT_EXPIRY = '7d'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getWarehouseIds(employeeId: string): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('UserWarehouseAccess') as any)
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
  }
  return jwt.sign(payload, JWT_SECRET(), { expiresIn: JWT_EXPIRY })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildUserObj(emp: any, warehouseIds: string[], modulePerms: Record<string, string[]>, warehouseName?: string, jobTitleName?: string) {
  return {
    id:                 emp.id,
    name:               emp.name,
    email:              emp.email ?? null,
    warehouse_scope:    emp.warehouse_scope ?? 'ASSIGNED',
    warehouse_id:       emp.warehouse_id ?? null,
    warehouse_name:     warehouseName ?? null,
    job_title_name:     jobTitleName ?? null,
    allowed_categories: emp.allowed_categories ?? [],
    warehouse_ids:      warehouseIds,
    module_permissions: modulePerms,
  }
}

// ─── POST /api/auth/login ──────────────────────────────────────────────────

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body as { email?: string; password?: string }
    if (!email || !password) return fail(res, 'Email và mật khẩu là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: emps } = await (supabase.from('Employee') as any)
      .select('id, name, email, role, warehouse_scope, warehouse_id, allowed_categories, password, is_active, module_permissions, job_title_id')
      .ilike('email', email.trim())
      .limit(1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emp = (emps as any[])?.[0]
    if (!emp)           return fail(res, 'Tên đăng nhập hoặc mật khẩu không đúng', 401)
    if (!emp.is_active) return fail(res, 'Tài khoản đã bị vô hiệu hóa. Liên hệ quản trị viên.', 401)
    if (!emp.password)  return fail(res, 'Tài khoản chưa được đặt mật khẩu. Liên hệ quản trị viên.', 401)

    const valid = await bcrypt.compare(password, emp.password)
    if (!valid) return fail(res, 'Email hoặc mật khẩu không đúng', 401)

    // Run all 3 independent post-auth queries in parallel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [warehouseIds, jtData, whData] = await Promise.all([
      getWarehouseIds(emp.id),
      emp.job_title_id
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (supabase.from('JobTitle') as any).select('module_permissions, name').eq('id', emp.job_title_id).single().then((r: any) => r.data)
        : Promise.resolve(null),
      emp.warehouse_id
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (supabase.from('Warehouse') as any).select('name').eq('id', emp.warehouse_id).single().then((r: any) => r.data)
        : Promise.resolve(null),
    ])

    // Resolve module_permissions: Admin gets all; employee override > job_title
    let modulePerms: Record<string, string[]> = {}
    if (emp.name === 'Admin') {
      modulePerms = ALL_PERMISSIONS as Record<string, string[]>
    } else if (emp.module_permissions && Object.keys(emp.module_permissions).length > 0) {
      modulePerms = emp.module_permissions
    } else if (jtData?.module_permissions && Object.keys(jtData.module_permissions).length > 0) {
      modulePerms = jtData.module_permissions
    }

    const token = buildToken(emp, warehouseIds, modulePerms)
    return ok(res, { token, user: buildUserObj(emp, warehouseIds, modulePerms, whData?.name, jtData?.name) })
  } catch (e) { return fail(res, String(e)) }
}

// ─── GET /api/auth/me ──────────────────────────────────────────────────────

export async function me(req: Request, res: Response) {
  try {
    const userId = req.user?.sub
    if (!userId) return fail(res, 'Unauthorized', 401)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: emps } = await (supabase.from('Employee') as any)
      .select('id, name, email, role, warehouse_scope, warehouse_id, allowed_categories, is_active, module_permissions, job_title_id')
      .eq('id', userId).limit(1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emp = (emps as any[])?.[0]
    if (!emp || !emp.is_active) return fail(res, 'Tài khoản không tồn tại hoặc đã bị vô hiệu hóa', 401)

    const modulePerms: Record<string, string[]> = req.user?.module_permissions ?? {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [warehouseIds, whData, jtData] = await Promise.all([
      getWarehouseIds(emp.id),
      emp.warehouse_id
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (supabase.from('Warehouse') as any).select('name').eq('id', emp.warehouse_id).single().then((r: any) => r.data)
        : Promise.resolve(null),
      emp.job_title_id
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (supabase.from('JobTitle') as any).select('name').eq('id', emp.job_title_id).single().then((r: any) => r.data)
        : Promise.resolve(null),
    ])

    return ok(res, buildUserObj(emp, warehouseIds, modulePerms, whData?.name, jtData?.name))
  } catch (e) { return fail(res, String(e)) }
}

// ─── POST /api/auth/change-password ─────────────────────────────────────────

export async function changePassword(req: Request, res: Response) {
  try {
    const userId = req.user?.sub
    if (!userId) return fail(res, 'Unauthorized', 401)

    const { old_password, new_password } = req.body as { old_password?: string; new_password?: string }
    if (!old_password || !new_password) return fail(res, 'Thiếu thông tin', 400)
    if (new_password.length < 6) return fail(res, 'Mật khẩu mới phải có ít nhất 6 ký tự', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: emps } = await (supabase.from('Employee') as any)
      .select('id, password').eq('id', userId).limit(1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emp = (emps as any[])?.[0]
    if (!emp)          return fail(res, 'Không tìm thấy tài khoản', 404)
    if (!emp.password) return fail(res, 'Tài khoản chưa có mật khẩu. Liên hệ quản trị viên.', 400)

    const valid = await bcrypt.compare(old_password, emp.password)
    if (!valid) return fail(res, 'Mật khẩu hiện tại không đúng', 401)

    const hash = await bcrypt.hash(new_password, 10)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('Employee') as any)
      .update({ password: hash, updated_at: new Date().toISOString() })
      .eq('id', userId)

    return ok(res, { message: 'Đổi mật khẩu thành công' })
  } catch (e) { return fail(res, String(e)) }
}
