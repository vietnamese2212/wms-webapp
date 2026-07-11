import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export interface JwtPayload {
  sub:                string
  name:               string
  email:              string | null
  warehouse_scope:    string
  warehouse_id:       string | null
  allowed_categories: string[]
  warehouse_ids:      string[]
  module_permissions: Record<string, string[]>
  ncc_id:             string | null
  is_superadmin?:     boolean   // cùng điều kiện với lúc phát token (employee_code=ADMIN hoặc name=Admin)
}

// Bypass phân quyền phải KHỚP điều kiện nhận diện superadmin lúc phát token (authController):
// trước đây chỉ xét name==='Admin' → superadmin theo employee_code=ADMIN nhưng tên khác sẽ
// phụ thuộc hoàn toàn ALL_PERMISSIONS (thiếu key BE là mất quyền âm thầm). Token cũ (7 ngày)
// chưa có is_superadmin → giữ fallback name==='Admin'.
const isSuperadminReq = (req: Request) => req.user?.is_superadmin === true || req.user?.name === 'Admin'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

// Bắt buộc có JWT_SECRET — không fallback ra chuỗi công khai (tránh giả mạo token).
// Thiếu env → throw, server từ chối phục vụ thay vì ký bằng secret ai cũng biết.
export const JWT_SECRET = () => {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET chưa được cấu hình — từ chối khởi động vì lý do bảo mật')
  return s
}

export function requirePerm(module: string, action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isSuperadminReq(req)) return next()
    const perms = req.user?.module_permissions ?? {}
    if (!perms[module]?.includes(action)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Bạn không có quyền thực hiện thao tác này' },
      })
    }
    next()
  }
}

export function requireAnyPerm(...checks: [string, string][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isSuperadminReq(req)) return next()
    const perms = req.user?.module_permissions ?? {}
    const allowed = checks.some(([module, action]) => perms[module]?.includes(action))
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Bạn không có quyền thực hiện thao tác này' },
      })
    }
    next()
  }
}

export function verifyToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Token không hợp lệ' },
    })
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET()) as JwtPayload
    next()
  } catch {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Token hết hạn hoặc không hợp lệ' },
    })
  }
}
