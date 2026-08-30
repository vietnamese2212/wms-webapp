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
