-- MES 14/11 (đêm) — PHIẾU THEO DÕI của mẻ (thay hai biểu mẫu giấy: "Phiếu theo dõi quá trình phối trộn" và "Phiếu theo dõi bán thành
-- phẩm dịch thạch" trong file NB-QA-BM-CB.01 — user: "làm cả ba biểu mẫu một lượt").
-- Mỗi mẻ có tối đa MỘT phiếu mỗi loại. Nội dung phiếu là các ô thông số (nước cấp · nhiệt độ · giờ đổ · pH · Brix …) lưu dạng
-- jsonb { mã_ô: giá_trị } — danh sách ô khai ở FE (config/processForms.ts) nên thêm / bớt ô KHÔNG cần đổi bảng.
-- QA xác nhận phiếu ⇒ khoá sửa (bỏ xác nhận mới sửa lại được). Thuộc chuỗi hồ sơ lô ⇒ không lưu trữ / xoá theo hạn.
BEGIN;

CREATE TABLE IF NOT EXISTS public.batch_process_log (
  id                 text PRIMARY KEY,
  batch_id           text NOT NULL REFERENCES public.production_batch(id),
  form               text NOT NULL CHECK (form IN ('MIX', 'JELLY')),
  data               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_by_name    text,
  updated_by_name    text,
  confirmed_at       timestamptz,
  confirmed_by       text,
  confirmed_by_name  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL,
  UNIQUE (batch_id, form)
);
ALTER TABLE public.batch_process_log ENABLE ROW LEVEL SECURITY;

-- Quyền production.process_log (ghi phiếu theo dõi) — theo năng lực: người cấp nguyên liệu cho mẻ hoặc QA lô; đã có thì không đè.
-- Xác nhận phiếu dùng quyền qa_release sẵn có.
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(j.module_permissions, '{production}', (j.module_permissions->'production') || '["process_log"]'::jsonb, true),
       updated_at = now()
 WHERE (j.module_permissions->'production' ? 'consume' OR j.module_permissions->'production' ? 'qa_release')
   AND NOT (j.module_permissions->'production' ? 'process_log');

COMMIT;
