import { Response } from 'express'
import { supabase } from '../lib/supabase'
import { getRetentionDays } from './settings'
import { isQueryTimeout, QUERY_TIMEOUT_MSG } from './pagination'

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

/**
 * LỖI CỦA POSTGRES LÀ LỖI ĐẦU VÀO, KHÔNG PHẢI "LỖI HỆ THỐNG" (chốt 07/09).
 *
 * Gõ trùng mã, xoá thứ đang được nơi khác dùng, mở màn hình khi chưa có mã bản ghi — đó là việc
 * NGƯỜI DÙNG làm sai hoặc màn hình chưa sẵn sàng, và app phải nói ra được điều đó. Bản cũ ném
 * `error.message` của PostgREST vào `fail` ⇒ status mặc định 500 ⇒ người dùng đọc "Lỗi hệ thống,
 * vui lòng thử lại" (thử lại bao nhiêu lần cũng vẫn thế), CÒN cảnh báo "lỗi BE 24h" thì kêu oan
 * vì mỗi lượt lại ghi thêm một dòng vào `error_logs`.
 *
 * Đo thật 07/09 (gói QA 49·50·51): **34 ca** cùng khuôn này — 12 ca id rác trên đường dẫn của các
 * bảng khoá UUID (22P02), 8 ca trùng mã (23505), phần còn lại là khoá ngoại/ràng buộc.
 *
 * VÌ SAO KHÔNG CHẶN Ở MIDDLEWARE THEO HÌNH DẠNG UUID (đã cân nhắc rồi bỏ): 48/82 bảng có cột `id`
 * kiểu TEXT, và `JobTitle` có **14/19 id thật** dạng `jt-admin`, `jt-tk-tp`. Một lưới "id phải là
 * UUID" đặt ở `/api` sẽ khoá đúng những chức danh đang chạy — chữa lỗi báo sai bằng một sự cố
 * vận hành nặng hơn. Dịch mã lỗi ở đây thì không phải đoán bảng nào khoá kiểu gì.
 */
export type PgLikeError = { code?: string | null; message?: string; details?: string | null }

const PG_MAP: Record<string, { status: number; message: string }> = {
  // id/khoá sai định dạng — hay gặp nhất khi màn hình ghép `/${id}` lúc state chưa có
  '22P02': { status: 400, message: 'Mã bản ghi không hợp lệ — màn hình có thể chưa tải xong, thử tải lại trang' },
  '23505': { status: 409, message: 'Giá trị này đã tồn tại — kiểm tra lại mã/tên đang nhập' },
  // 23503 đi HAI CHIỀU nên câu trả lời phải chọn theo `details` (xem pgUserError)
  '23503': { status: 409, message: 'Liên kết dữ liệu không hợp lệ — bản ghi liên quan không tồn tại, hoặc đang được nơi khác sử dụng' },
  '23514': { status: 400, message: 'Giá trị không hợp lệ theo ràng buộc của hệ thống' },
  '23502': { status: 400, message: 'Thiếu thông tin bắt buộc' },
  '22003': { status: 400, message: 'Số vượt quá giới hạn cho phép' },
  '22007': { status: 400, message: 'Ngày/giờ không hợp lệ' },
  '22008': { status: 400, message: 'Ngày/giờ nằm ngoài khoảng cho phép' },
  'PGRST116': { status: 404, message: 'Không tìm thấy bản ghi — có thể đã bị xoá, hãy tải lại trang' },
}

/** Lỗi Postgres có nghĩa với người dùng không? Trả null nếu không (⇒ giữ nguyên đường 5xx cũ). */
export function pgUserError(err: unknown): { status: number; message: string } | null {
  const e = err as PgLikeError | null
  const code = e?.code
  if (typeof code !== 'string' || !PG_MAP[code]) return null
  // Khoá ngoại vỡ theo hai chiều rất khác nhau với người dùng: "thứ tôi trỏ tới không có" (chọn
  // cấp trên là chức danh đã bị xoá) ≠ "thứ tôi xoá đang bị người khác dùng". Postgres nói rõ chiều
  // nào trong `details`, nên chọn đúng câu thay vì bắt người đọc tự đoán.
  // PGRST116 = `.single()` không nhận đúng MỘT dòng. Hai nguyên nhân rất khác nhau:
  //   0 dòng  → bản ghi không tồn tại (đã bị xoá, id sai) ⇒ 404, là chuyện bình thường của app;
  //   >1 dòng → truy vấn thiếu điều kiện ⇒ lỗi THẬT của lập trình, giữ nguyên 500 để còn thấy mà sửa.
  // Bản cũ nhập hai ca làm một và cùng ra "Lỗi hệ thống" (memory `checkapp-run-2026-08-31-fullsweep`
  // đếm 61 ca cùng khuôn), nên duyệt một đơn nghỉ đã bị xoá cũng báo như app hỏng.
  if (code === 'PGRST116') {
    const d = `${e?.details ?? ''} ${e?.message ?? ''}`
    return /\b0 rows?\b|contains 0 /i.test(d)
      ? { status: 404, message: 'Không tìm thấy bản ghi — có thể đã bị xoá, hãy tải lại trang' }
      : null
  }
  if (code === '23503') {
    const d = String(e?.details ?? '')
    if (/is not present in table/i.test(d))
      return { status: 400, message: 'Giá trị tham chiếu không tồn tại — bản ghi được chọn có thể đã bị xoá, hãy tải lại trang' }
    if (/is still referenced from/i.test(d))
      return { status: 409, message: 'Bản ghi đang được nơi khác sử dụng — gỡ các liên kết rồi thử lại' }
  }
  return PG_MAP[code]
}

export function fail(res: Response, error: PgLikeError, status?: number): Response
export function fail(res: Response, message: string, status?: number, code?: string): Response
export function fail(res: Response, status: number, code: string, message: string): Response
export function fail(res: Response, arg2: string | number | PgLikeError, arg3?: string | number, arg4?: string): Response {
  // Đối tượng lỗi Supabase/PostgREST: dịch mã lỗi thành câu người dùng hiểu; không dịch được thì
  // rơi về đúng đường cũ (5xx có che message).
  if (arg2 !== null && typeof arg2 === 'object') {
    // Quá hạn truy vấn (57014) = QUÁ TẢI, không phải lỗi hệ thống: 503 + câu hướng dẫn thu hẹp bộ lọc,
    // digest đếm vào overload_24h thay vì dựng cờ đỏ. Đo 07/09 (gói 06 readload): `fail(res, pageErr)` ở
    // Nhặt lẻ trả 500 "canceling statement due to statement timeout" ×7 dưới 8 luồng ghi — dịch ở đây
    // thì 150+ chỗ `fail(res, error)` cùng được, không phải vá từng controller.
    if (isQueryTimeout(arg2)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    const mapped = pgUserError(arg2)
    if (mapped) {
      return res.status(mapped.status).json({ success: false, error: { code: arg2.code ?? 'ERROR', message: mapped.message } })
    }
    return fail(res, arg2.message ?? 'ERROR', typeof arg3 === 'number' ? arg3 : 500)
  }
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
  // `fail(res, 'câu tiếng Việt', 400, 'MÃ_LỖI')` — mã lỗi được KHAI thì phải ĐI RA cùng response;
  // bản cũ nuốt tham số thứ tư nên hơn 40 chỗ gọi tưởng mình đang trả mã mà client không hề nhận.
  return res.status(status).json({ success: false, error: arg4 ? { code: arg4, message: arg2 } : { message: arg2 } })
}
