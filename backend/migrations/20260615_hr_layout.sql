-- ============================================================
-- HR: Layout phân công (mẫu gom skill theo Kho) — phiếu chọn layout
-- Apply: Supabase Dashboard → SQL Editor
-- ============================================================
-- Bối cảnh: 1 Kho có nhiều Layout (VD "Ca ngày SX": xe nâng A,B,C + thủ kho E,G).
--   Mỗi layout = tập skill + số người cần. Tạo lịch = chọn Kho + Layout + Ngày →
--   demand tự đổ từ layout. Phiếu phân công đổi từ department_id → layout_id.
--   Bảng phiếu còn trống → đổi cột an toàn.
-- ============================================================

-- Layout (mẫu) theo Kho
CREATE TABLE IF NOT EXISTS "WorkLayout" (
  id           TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES "Warehouse"(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  note         TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT,
  updated_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_layout_wh ON "WorkLayout"(warehouse_id);

-- Skill trong layout + số người mặc định
CREATE TABLE IF NOT EXISTS "WorkLayoutSkill" (
  id             TEXT PRIMARY KEY,
  layout_id      TEXT NOT NULL REFERENCES "WorkLayout"(id) ON DELETE CASCADE,
  skill_id       TEXT NOT NULL REFERENCES "Skill"(id) ON DELETE CASCADE,
  required_count INT  NOT NULL DEFAULT 1,
  sort_order     INT  NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(layout_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_layoutskill_layout ON "WorkLayoutSkill"(layout_id);

-- Phiếu phân công: thêm layout_id (ADDITIVE — giữ department_id cho tới khi backend
-- chuyển hẳn sang layout-based ở migration kế tiếp; tránh phá code đang deploy).
ALTER TABLE "WorkAssignmentSheet" ADD COLUMN IF NOT EXISTS layout_id TEXT REFERENCES "WorkLayout"(id);
-- TODO (lần sau): khi assignmentController dùng layout_id → bỏ department_id +
--   đổi unique sang (work_date, layout_id).

-- RLS + anon SELECT (cho Realtime)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['WorkLayout','WorkLayoutSkill'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    BEGIN EXECUTE format('CREATE POLICY "anon_select" ON %I FOR SELECT TO anon USING (true)', t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;
