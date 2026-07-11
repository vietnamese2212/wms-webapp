import { Response } from 'express'

export const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data })

// Supports two call patterns:
//   fail(res, 'message')            → 500
//   fail(res, 'message', 404)       → 404
//   fail(res, 400, 'CODE', 'msg')   → 400 (legacy controllers)
// Message chung cho lỗi 5xx — KHÔNG trả nguyên văn lỗi Supabase/JS ra client
// (message PostgREST hay chứa tên bảng/cột/constraint → lộ schema nội bộ). Chi tiết
// chỉ log server-side.
const GENERIC_5XX = 'Lỗi hệ thống, vui lòng thử lại'

export function fail(res: Response, arg2: string | number, arg3?: string | number, arg4?: string): Response {
  if (typeof arg2 === 'number') {
    if (arg2 >= 500) {
      if (arg4) console.error('[fail]', arg3 ?? 'ERROR', arg4)
      return res.status(arg2).json({ success: false, error: { code: arg3 ?? 'ERROR', message: GENERIC_5XX } })
    }
    return res.status(arg2).json({ success: false, error: { code: arg3 ?? 'ERROR', message: arg4 ?? '' } })
  }
  const status = typeof arg3 === 'number' ? arg3 : 500
  if (status >= 500) {
    console.error('[fail]', arg2)   // log chi tiết server-side
    return res.status(status).json({ success: false, error: { message: GENERIC_5XX } })
  }
  return res.status(status).json({ success: false, error: { message: arg2 } })
}
