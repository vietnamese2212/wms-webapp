import { Response } from 'express'
import { supabase } from '../lib/supabase'
import { getRetentionDays } from './settings'

export const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data })

/**
 * ĐƯỜNG DẪN của request đang lỗi, để `error_logs` nói được LỖI Ở ĐÂU.
 *
 * VÌ SAO CÓ HÀM NÀY (đo 21/08 trên dữ liệu lớn): tai mắt ghi 40 dòng
 * `canceling statement due to statement timeout` với `url = NULL` — biết app hỏng mà KHÔNG biết
 * hỏng ở endpoint nào, tức digest dựng được cờ đỏ nhưng không ai lần ra chỗ sửa. Lấy từ `res.req`
 * (Express gắn sẵn) nên KHÔNG phải đổi signature ở 200+ chỗ gọi `fail`.
 *
 * Ghi TEMPLATE route (`GET /api/wms/forklift-logs/:id`) chứ không phải path có id thật: gom nhóm
 * được theo endpoint, và không lôi giá trị người dùng vào bảng log. Lỗi xảy ra TRƯỚC khi khớp
 * route (middleware) thì `req.route` rỗng → rơi về path thật (đã bỏ query string).
 */
function routeOf(res: Response | undefined): string {
  const req = res?.req as undefined | {
    method?: string; baseUrl?: string; originalUrl?: string; route?: { path?: string }
  }
  if (!req) return '(no-req)'
  const tail = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : (req.originalUrl ?? '').split('?')[0]
  if (!tail) return '(no-route)'
  return `${req.method ?? '?'} ${tail}`.slice(0, 200)
}

/**
 * TAI MẮT PRODUCTION (29/07): mọi 5xx đi qua fail/maskServerMessage được ghi vào bảng
 * `error_logs` (fire-and-forget — KHÔNG await, KHÔNG bao giờ làm hỏng response đang trả).
 * Workflow keepalive đọc GET /api/telemetry/digest hằng ngày: đếm BE 24h > 0 → job đỏ → email.
 * Trước đây lỗi chỉ được thấy KHI CÓ NGƯỜI NGỒI KIỂM — giờ app tự khai trong vòng 1 ngày.
 */
// LUẬT (21/08) — lỗi BE ghi vào `error_logs` BẮT BUỘC kèm CHỖ XẢY RA. Ràng buộc bằng KIỂU (overload
// dưới) để quên là **lỗi biên dịch**, không phải nhắc nhau bằng văn xuôi: bằng chứng thật là 40 dòng
// `statement timeout` với `url = NULL` — cờ đỏ dựng lên mà không ai lần ra endpoint nào phải sửa.
export function recordServerError(source: 'be', message: string, status: number | undefined, code: string | undefined, url: string): void
export function recordServerError(source: 'fe', message: string, status?: number, code?: string, url?: string, ua?: string): void
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
 * 503 = QUÁ TẢI / CHƯA SẴN SÀNG — tình huống **đã lường trước**, KHÔNG phải lỗi app
 * (`QUERY_TIMEOUT` khi đông người cùng truy vấn · `NOT_READY` khi migration chưa apply ·
 * `PUSH_UNAVAILABLE`). Mọi chỗ trả 503 đều tự soạn câu tiếng Việt cho người dùng — không có
 * chỗ nào ném nguyên văn lỗi Supabase vào đây (ratchet `raw_error_in_soft_5xx` gác).
 *
 * VÌ SAO PHẢI TÁCH RA (đo 06/09): đợt 29/08 đổi 500 → 503 với HAI mục đích — (a) người dùng đọc
 * được câu LÀM ĐƯỢC gì đó ("thu hẹp KHOẢNG NGÀY / chọn 1 Kho"), (b) cảnh báo "lỗi BE 24h" thôi
 * kêu oan. **Cả hai đều KHÔNG đạt**: `fail`/`maskServerMessage` che mọi status ≥ 500 nên câu
 * hướng dẫn chỉ nằm lại trong `error_logs`, người dùng vẫn thấy "Lỗi hệ thống"; và 503 vẫn được
 * đếm vào digest (bằng chứng: 43 dòng 503 trong `error_logs` — Giám sát vận hành 20, Slotting 18,
 * Vị trí 5 — mỗi dòng đủ để dựng cờ đỏ + email).
 *
 * Nay: 503 GIỮ NGUYÊN message của app, VẪN ghi `error_logs` để truy vết, nhưng digest và rule
 * `BE_ERRORS` bỏ qua status 503 (xem `app.ts` /telemetry/digest và `alertScanner.ruleBeErrors`).
 */
export const isSoftStatus = (status: number): boolean => status === 503

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
export function maskServerMessage(message: string, status: number, res?: Response): string {
  if (status < 500) return message
  console.error('[fail]', message)
  recordServerError('be', message, status, undefined, routeOf(res))
  return isSoftStatus(status) ? message : GENERIC_5XX
}

export function fail(res: Response, arg2: string | number, arg3?: string | number, arg4?: string): Response {
  if (typeof arg2 === 'number') {
    if (arg2 >= 500) {
      if (arg4) console.error('[fail]', arg3 ?? 'ERROR', arg4)
      recordServerError('be', arg4 ?? String(arg3 ?? 'ERROR'), arg2, typeof arg3 === 'string' ? arg3 : undefined, routeOf(res))
      return res.status(arg2).json({ success: false, error: { code: arg3 ?? 'ERROR', message: isSoftStatus(arg2) && arg4 ? arg4 : GENERIC_5XX } })
    }
    return res.status(arg2).json({ success: false, error: { code: arg3 ?? 'ERROR', message: arg4 ?? '' } })
  }
  const status = typeof arg3 === 'number' ? arg3 : 500
  if (status >= 500) {
    console.error('[fail]', arg2)   // log chi tiết server-side
    recordServerError('be', arg2, status, undefined, routeOf(res))
    return res.status(status).json({ success: false, error: { message: isSoftStatus(status) ? arg2 : GENERIC_5XX } })
  }
  return res.status(status).json({ success: false, error: { message: arg2 } })
}
