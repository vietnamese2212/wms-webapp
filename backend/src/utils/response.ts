import { Response } from 'express'

export const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data })

// Supports two call patterns:
//   fail(res, 'message')            → 500
//   fail(res, 'message', 404)       → 404
//   fail(res, 400, 'CODE', 'msg')   → 400 (legacy controllers)
export function fail(res: Response, arg2: string | number, arg3?: string | number, arg4?: string): Response {
  if (typeof arg2 === 'number') {
    return res.status(arg2).json({ success: false, error: { code: arg3 ?? 'ERROR', message: arg4 ?? '' } })
  }
  const status = typeof arg3 === 'number' ? arg3 : 500
  return res.status(status).json({ success: false, error: { message: arg2 } })
}
