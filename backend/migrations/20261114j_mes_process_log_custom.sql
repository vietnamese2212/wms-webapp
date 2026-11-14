-- MES 14/11 (khuya) — PHIẾU THEO DÕI SỬA RIÊNG THEO TỪNG LẦN tại bàn của mẻ (user: "cài đặt và cho phép sửa theo từng lần nếu muốn
-- tại bàn"). Mẫu chung ở production_process_form (Cài đặt MES); một phiếu của mẻ có thể mang bản sửa riêng của nó (thêm lần đổ,
-- thêm ô, đổi bảng…) trong cột blocks — cùng hình dạng với production_process_form.blocks. NULL = theo mẫu chung (mặc định).
-- QA xác nhận phiếu ⇒ chụp lại mẫu đang áp vào blocks (nếu còn NULL) để hồ sơ lô không đổi khi mẫu chung sửa về sau.
BEGIN;

ALTER TABLE public.batch_process_log ADD COLUMN IF NOT EXISTS blocks jsonb CHECK (blocks IS NULL OR jsonb_typeof(blocks) = 'array');

COMMIT;
