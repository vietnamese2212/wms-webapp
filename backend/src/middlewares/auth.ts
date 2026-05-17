import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export interface JwtPayload {
  sub:                string
  name:               string
  email:              string | null
  role:               string
  action_level:       string
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
