/**
 * NGÀY NGHIỆP VỤ 'YYYY-MM-DD' — MỘT nguồn kiểm duy nhất.
 *
 * Vì sao có file này: kiểm bằng regex `^\d{4}-\d{2}-\d{2}$` là kiểm DẠNG, không kiểm LỊCH.
 * `2026-13-45`, `2026-02-31`, `0000-00-00` đều khớp regex, đi thẳng xuống Postgres và nổ **22008
 * "date/time field value out of range" ⇒ 500**. Đo thật 30/08 bằng fuzz: **5 màn chính** cùng vỡ —
 * Xuất kho · Nhập kho · Nghỉ phép · Kế hoạch xuất (KHVC) · Nhặt lẻ. Người dùng bình thường khó gõ
 * ra ngày như vậy, nhưng 500 rác làm rule cảnh báo "lỗi BE 24h" kêu oan, che mất lỗi thật (luật
 * CLAUDE.md 21/08).
 *
 * Bài học đã được ghi 2 lần trước (gói fill 05/08, chi phí kho 27/08) nhưng mỗi lần chỉ vá TẠI CHỖ
 * bằng một hàm cục bộ, nên chỗ viết sau vẫn vấp lại. Nay để một chỗ + ratchet
 * `date_regex_without_calendar_check` gác.
 */
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Có phải NGÀY CÓ THẬT theo lịch không (không chỉ đúng dạng). */
export function isDay(v: unknown): boolean {
  const m = DAY_RE.exec(String(v ?? '').trim())
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1900 || y > 2200) return false
  // Dựng theo UTC rồi soi có bị CUỘN sang ngày khác không: 2026-02-31 → 03/03, 2026-13-45 → NaN.
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/** Ngày hợp lệ → chính nó; rỗng/không hợp lệ → null (dùng cho tham số lọc bỏ trống được). */
export const dayOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return s && isDay(s) ? s : null
}

/**
 * MỐC THỜI GIAN TỪ DB → SỐ MILI-GIÂY UTC.
 *
 * Schema TRỘN HAI KIỂU: `Employee.created_at` · `GroupDeliveryOrder.started_at` ·
 * `InventoryEntry.import_date/created_at` là **`timestamp WITHOUT time zone`** nên PostgREST trả
 * chuỗi KHÔNG có offset (`"2026-09-27T03:29:51.654"`), trong khi `gate_registrations.entry_at` ·
 * `wms_tasks.claimed_at` là `timestamptz` (có `+00:00`). `new Date()` hiểu chuỗi KHÔNG offset là
 * **giờ của máy đang chạy** — đúng trên Vercel/runner (UTC), lệch **7 giờ** khi chạy tại máy ở VN.
 *
 * Đo thật 27/09/2026: đúng lớp lỗi này giết CI suốt hai ngày. `scripts/qa/ci-account.mjs` đọc tuổi
 * tài khoản QA bằng `new Date(created_at)`; chạy từ máy UTC+7 thì tài khoản vừa cấp **0,6 giây** bị
 * tính thành **7,00 giờ** ⇒ vượt ngưỡng 2 giờ ⇒ bị dọn — và nó dọn cả tài khoản của lượt CI ĐANG
 * CHẠY trên GitHub ⇒ `07-params-fuzz` nhận 401 ⇒ job đỏ ⇒ email. 7/12 lượt 25–26/09.
 *
 * App LUÔN ghi mốc hệ thống bằng `toISOString()` (UTC) nên đọc chuỗi thiếu offset THÀNH UTC là đúng
 * ý nghĩa đã ghi. Ratchet `naive_db_timestamp_parse` (baseline 0) gác không cho quay lại `new Date()`.
 */
export const utcMs = (v: unknown): number => {
  const s = typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : ''
  if (!s) return NaN
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`).getTime()
}

/**
 * MỐC THỜI GIAN → NGÀY NGHIỆP VỤ THEO GIỜ VN ('YYYY-MM-DD').
 *
 * Dùng khi phải SO một mốc (ISO/timestamptz) với một ngày nghiệp vụ như `todayVN()`.
 * ĐỪNG cắt `String(mốc).slice(0, 10)`: đó là ngày theo ĐỒNG HỒ UTC, còn `todayVN()` là ngày theo
 * ĐỒNG HỒ VN — từ 00:00 đến 07:00 giờ VN hai đồng hồ lệch nhau MỘT NGÀY.
 *
 * Đo 27/09/2026: `PATCH /tms/orders/:id` chặn `eta` bằng `String(eta).slice(0,10) < todayVN()` ⇒ bậc
 * full chạy đêm (04:48 giờ VN = 21:48 UTC hôm trước) đỏ hai đêm liền, và điều vận ca đêm đặt ETA vài
 * giờ tới cũng bị báo "ngày quá khứ". Ratchet `utc_slice_as_vn_day` (baseline 0) gác.
 */
export const vnDayOf = (v: unknown): string | null => {
  const ms = utcMs(v)
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) : null
}
