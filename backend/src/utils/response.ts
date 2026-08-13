import { Response } from 'express'
import { supabase } from '../lib/supabase'
import { getRetentionDays } from './settings'

export const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data })

/**
 * TAI MẮT PRODUCTION (29/07): mọi 5xx đi qua fail/maskServerMessage được ghi vào bảng
 * `error_logs` (fire-and-forget — KHÔNG await, KHÔNG bao giờ làm hỏng response đang trả).
 * Workflow keepalive đọc GET /api/telemetry/digest hằng ngày: đếm BE 24h > 0 → job đỏ → email.
 * Trước đây lỗi chỉ được thấy KHI CÓ NGƯỜI NGỒI KIỂM — giờ app tự khai trong vòng 1 ngày.
 */
export function recordServerError(source: 'be' | 'fe', message: string, status?: number, code?: string, url?: string, ua?: string) {
  try {
    void supabase.from('error_logs')
      .insert({ source, status: status ?? null, code: code ?? null, message: String(message).slice(0, 500), url: url ?? null, ua: ua ?? null })
      .then(() => {
        // dọn lười: ~1% lượt ghi xoá log quá hạn — số ngày giữ = cờ `retention_days.error_logs`
        // (mặc định 30; Cài đặt WMS › Hệ thống). Bảng chỉ để digest — không cần giữ lâu.
        if (Math.random() < 0.01) {
          void getRetentionDays().then(r => supabase.from('error_logs')
            .delete().lt('created_at', new Date(Date.now() - r.error_logs * 86400_000).toISOString())
            .then(() => {}, () => {})).catch(() => {})
        }
      }, () => { /* bảng chưa có (chưa apply migration) / DB sập — nuốt im, đừng đổ thêm dầu */ })
  } catch { /* không bao giờ để telemetry phá request thật */ }
}

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
  recordServerError('be', message, status)
  return GENERIC_5XX
}

export function fail(res: Response, arg2: string | number, arg3?: string | number, arg4?: string): Response {
  if (typeof arg2 === 'number') {
    if (arg2 >= 500) {
      if (arg4) console.error('[fail]', arg3 ?? 'ERROR', arg4)
      recordServerError('be', arg4 ?? String(arg3 ?? 'ERROR'), arg2, typeof arg3 === 'string' ? arg3 : undefined)
      return res.status(arg2).json({ success: false, error: { code: arg3 ?? 'ERROR', message: GENERIC_5XX } })
    }
    return res.status(arg2).json({ success: false, error: { code: arg3 ?? 'ERROR', message: arg4 ?? '' } })
  }
  const status = typeof arg3 === 'number' ? arg3 : 500
  if (status >= 500) {
    console.error('[fail]', arg2)   // log chi tiết server-side
    recordServerError('be', arg2, status)
    return res.status(status).json({ success: false, error: { message: GENERIC_5XX } })
  }
  return res.status(status).json({ success: false, error: { message: arg2 } })
}
