/**
 * MỐC THỜI GIAN TỪ DB → SỐ MILI-GIÂY UTC. Không phụ thuộc gì, không tác dụng phụ lúc import —
 * cố ý, để `ci-account.mjs` (chạy TRƯỚC mọi thứ khác trong CI, và phải để workflow bắt được lỗi
 * bằng `||`) dùng chung mà không phải kéo theo `lib.mjs` (file đó gắn bộ bắt lỗi toàn cục và
 * `process.exit` ở cuối).
 *
 * VÌ SAO: schema TRỘN HAI KIỂU cột. `Employee.created_at` · `GroupDeliveryOrder.started_at` ·
 * `InventoryEntry.import_date` là `timestamp WITHOUT time zone` ⇒ PostgREST trả chuỗi KHÔNG có
 * offset (`"2026-09-27T03:29:51.654"`); `gate_registrations.entry_at` · `wms_tasks.claimed_at` là
 * `timestamptz` ⇒ có `+00:00`. `new Date()` hiểu chuỗi KHÔNG offset là **giờ của máy đang chạy**:
 * đúng trên runner GitHub và Vercel (UTC), LỆCH 7 GIỜ trên máy ở Việt Nam.
 *
 * Đo thật 27/09/2026 — đây chính là thứ làm CI đỏ suốt hai ngày: `ci-account.mjs` tính tuổi tài
 * khoản QA bằng `new Date(created_at)`; chạy từ máy UTC+7 thì tài khoản vừa cấp **0,6 giây** bị đọc
 * thành **7,00 giờ** ⇒ vượt ngưỡng dọn rác 2 giờ ⇒ bị xoá. Và nó xoá cả tài khoản của lượt CI ĐANG
 * CHẠY trên GitHub, nên gói đầu tiên có đăng nhập nhận 401 ⇒ job đỏ ⇒ email về hộp thư.
 *
 * App luôn ghi mốc hệ thống bằng `toISOString()` (UTC) nên hiểu chuỗi thiếu offset là UTC mới đúng
 * với ý nghĩa đã ghi. Chuỗi đã có offset thì giữ nguyên ⇒ hàm này đúng cho CẢ HAI kiểu cột.
 * Bản song sinh phía backend: `utcMs` trong `backend/src/utils/dates.ts`.
 * Ratchet `naive_db_timestamp_parse` (baseline 0) chặn quay lại `new Date(<cột thời gian>)`.
 */
export const utcMs = (v) => {
  const s = typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : ''
  if (!s) return NaN
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`).getTime()
}
