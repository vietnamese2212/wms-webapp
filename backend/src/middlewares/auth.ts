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
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

const JWT_SECRET = () => process.env.JWT_SECRET ?? 'dev-secret-change-in-production'

export function requirePerm(module: string, action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.name === 'Admin') return next()
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
    if (req.user?.name === 'Admin') return next()
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
