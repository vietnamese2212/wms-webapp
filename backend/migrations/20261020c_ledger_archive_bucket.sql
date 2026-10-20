-- 20/10/2026 — LƯU TRỮ SỔ VẾT outbound_events (user: "dữ liệu vài năm, 1–2 GB là quá lớn — xử lý luôn"):
-- (1) bucket riêng tư `ledger-archive`: tệp CSV nén gzip theo tháng `outbound_events/<YYYY-MM>.csv.gz` do backend (service role) ghi
--     rồi xoá dòng khỏi DB theo cờ `retention_days.ledger` (0 = giữ mãi, mặc định). anon/authenticated KHÔNG có policy storage (luật 0 quyền);
--     tải về qua vé ký 1 giờ ở tab Lịch sử.
-- (2) bỏ `idx_oev_do` (do_number WHERE NOT NULL): không câu nào trong app lọc outbound_events theo do_number một mình (tra theo
--     group_code / gdo_id), đo 20/10 ~30 B/dòng chỉ mục thừa.
-- Idempotent. Lên production: áp bất kỳ lúc nào.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ledger-archive', 'ledger-archive', false, 104857600, ARRAY['application/gzip', 'text/csv', 'application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP INDEX IF EXISTS public.idx_oev_do;

COMMIT;
