-- ============================================================================
-- SỔ ĐÓNG GÓI ĐIỆN TỬ (11/08/2026) — số hóa sổ đóng gói viết tay tại xưởng SX.
-- Workflow user chốt: tem pallet in sẵn (PalletLabelPrint) → quét tem lúc BẮT ĐẦU
-- xếp pallet (mở sổ) → pallet đầy đóng sổ (bấm Đóng hoặc quét tem pallet kế tiếp
-- cùng máy = tự đóng). GIỜ SẢN XUẤT THẬT lấy từ CHỮ IN PHUN trên thùng đầu/cuối
-- (chụp ảnh + OCR Tesseract chạy tại máy — bậc 0, đọc trượt thì điền tay); giờ
-- bấm nút chỉ là giờ thao tác (phụ, để đối chiếu — user chốt 11/08 "giờ in 10h10,
-- bốc xếp 10h12 thì ghi lúc bốc là không đúng").
-- 1 pallet = 1 dòng sổ (không ghi per thùng). Ảnh = bằng chứng gốc, lưu bucket
-- riêng tư 'packing-photos' (như forklift-photos), BE phát signed URL 1h.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.packing_logs (
  id             uuid PRIMARY KEY,
  pallet_code    text NOT NULL,              -- nguyên văn tem (normalizeQR — giữ đệm trong)
  material_code  text,
  material_id    uuid,
  machine_code   text,                        -- máy/chuyền (từ tem; V1 = đoạn 4)
  warehouse_id   text,                        -- kho/NMSX gắn tem (PalletLabelPrint.warehouse_id)
  qty_cartons    numeric,                     -- số thùng trên pallet
  qty_source     text NOT NULL DEFAULT 'LABEL',  -- LABEL (số chuẩn tem) | MANUAL (sửa tay lúc đóng)
  status         text NOT NULL DEFAULT 'OPEN',   -- OPEN | CLOSED | CANCELLED
  open_scan_at   timestamptz NOT NULL,        -- giờ THAO TÁC quét mở (máy ghi — phụ)
  close_scan_at  timestamptz,                 -- giờ THAO TÁC đóng (máy ghi — phụ)
  prod_start_at  timestamptz,                 -- giờ SX thùng ĐẦU (từ chữ in phun — CHÍNH)
  prod_end_at    timestamptz,                 -- giờ SX thùng CUỐI
  prod_start_src text,                        -- OCR | MANUAL (null = chưa có)
  prod_end_src   text,
  ocr_start_raw  text,                        -- nguyên văn OCR đọc được (giữ cả 587/B/Ak32 — khai thác sau)
  ocr_end_raw    text,
  photo_start_path text,                      -- object path trong bucket packing-photos
  photo_end_path   text,
  packed_by      uuid,                        -- Employee.id người đóng
  packed_by_name text,
  note           text,
  created_at     timestamptz,
  updated_at     timestamptz NOT NULL
);

-- 1 tem chỉ có 1 dòng sổ SỐNG — chống 2 người cùng quét mở (23505 → BE báo "tem đã có sổ")
CREATE UNIQUE INDEX IF NOT EXISTS uq_packing_pallet_alive
  ON public.packing_logs (pallet_code) WHERE status <> 'CANCELLED';

-- Board: pallet đang mở theo máy · Sổ: duyệt theo thời gian
CREATE INDEX IF NOT EXISTS idx_packing_open_machine
  ON public.packing_logs (machine_code, open_scan_at) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_packing_created ON public.packing_logs (created_at DESC);

-- RLS: đóng anon; authenticated ĐỌC được (bắt buộc cho realtime — bài học
-- realtime-rls-silent-death: RLS bật + 0 policy SELECT = client không nhận sự kiện).
-- Dữ liệu vận hành dùng chung (như FillTask), không phải dữ liệu cá nhân.
ALTER TABLE public.packing_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS packing_logs_read ON public.packing_logs;
CREATE POLICY packing_logs_read ON public.packing_logs FOR SELECT TO authenticated USING (true);

-- Realtime cho board cả tổ cùng thấy
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.packing_logs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bucket ảnh riêng tư (mẫu forklift-photos): không policy storage.objects →
-- chỉ BE (service role) upload + phát signed URL.
INSERT INTO storage.buckets (id, name, public)
VALUES ('packing-photos', 'packing-photos', false)
ON CONFLICT (id) DO NOTHING;
