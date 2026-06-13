-- Bảng log in tem pallet — truy vết: tem in mấy lần, ai in, khi nào (generate vs reprint).
-- Mỗi tem in trong 1 lần bấm In = 1 dòng. Số lần in 1 pallet = COUNT(*) theo qr_code.
-- id/updated_at KHÔNG có DEFAULT ở app khác → ở đây set DEFAULT để insert gọn; app vẫn nên truyền id.
-- Chạy qua Supabase Dashboard → SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS "PalletLabelPrint" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_code          text NOT NULL,
  material_code    text,
  material_id      uuid,
  category         text,
  cycle            text,
  machine          text,
  seq              text,
  nmsx             text,
  qty              integer,
  mode             text NOT NULL DEFAULT 'GENERATE',  -- 'GENERATE' | 'REPRINT'
  printed_by       text,        -- employee id (JWT sub)
  printed_by_name  text,
  warehouse_id     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pallet_print_qr      ON "PalletLabelPrint" (qr_code);
CREATE INDEX IF NOT EXISTS idx_pallet_print_created ON "PalletLabelPrint" (created_at DESC);

-- Bật realtime (đồng bộ các bảng public khác) — guard để chạy lại không lỗi 42710.
-- Lưu ý: project có event trigger tự add bảng public mới vào publication, nên thường đã là member.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'PalletLabelPrint'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "PalletLabelPrint";
  END IF;
END $$;
