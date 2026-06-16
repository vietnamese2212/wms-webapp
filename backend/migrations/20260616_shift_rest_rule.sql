-- Quy tắc nghỉ giữa ca: làm [from_shift] hôm trước → hôm sau KHÔNG được làm [to_shift]
-- (không hardcode — admin sửa được; auto-assign đọc từ bảng này)
CREATE TABLE IF NOT EXISTS "ShiftRestRule" (
  id         TEXT PRIMARY KEY,
  from_shift TEXT NOT NULL,   -- ca làm hôm trước: CA1/CA2/CA3/HC
  to_shift   TEXT NOT NULL,   -- ca KHÔNG được làm hôm sau
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(from_shift, to_shift)
);

-- Seed luật hiện có: Ca 3 hôm trước → hôm sau chỉ Ca 2 hoặc nghỉ (cấm CA1, CA3, HC)
INSERT INTO "ShiftRestRule"(id, from_shift, to_shift) VALUES
  (gen_random_uuid()::text, 'CA3', 'CA1'),
  (gen_random_uuid()::text, 'CA3', 'CA3'),
  (gen_random_uuid()::text, 'CA3', 'HC')
ON CONFLICT (from_shift, to_shift) DO NOTHING;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE "ShiftRestRule";
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
