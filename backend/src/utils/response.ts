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

/**
 * Che message cho lỗi 5xx (log chi tiết server-side) — dùng cho các controller có helper `fail`
 * RIÊNG của mình.
 *
 * VÌ SAO CÓ HÀM NÀY (phát hiện 28/07 khi test tải): 7 controller tự khai `fail` cục bộ
 * (`palletPrint`, `palletOps`, `lookup`, `zone`, `slotting`, `weighTicket`, `controlTower`) và các
 * bản đó trả **NGUYÊN VĂN message ở mọi status** — tức đi vòng qua đúng lá chắn mà `fail` dùng chung
 * ở trên được viết ra để giữ. Bằng chứng thật: In tem dưới tải trả
 * `500 {"message":"canceling statement due to statement timeout"}` — client nhận nguyên văn lỗi
 * Postgres. Message của PostgREST hay chứa tên bảng/cột/constraint ⇒ lộ schema nội bộ.
 * Sửa ở helper cục bộ (1 dòng/file) thay vì đổi signature — 200+ chỗ gọi không phải chạm.
 */
export function maskServerMessage(message: string, status: number): string {
  if (status < 500) return message
  console.error('[fail]', message)
  return GENERIC_5XX
}

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
