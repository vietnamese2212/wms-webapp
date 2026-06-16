-- Layout gắn với các Chức danh (để gọi đúng nhóm người khi tự xếp)
CREATE TABLE IF NOT EXISTS "WorkLayoutJobTitle" (
  id           TEXT PRIMARY KEY,
  layout_id    TEXT NOT NULL REFERENCES "WorkLayout"(id)  ON DELETE CASCADE,
  job_title_id TEXT NOT NULL REFERENCES "JobTitle"(id)    ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(layout_id, job_title_id)
);
CREATE INDEX IF NOT EXISTS idx_layout_jobtitle_layout ON "WorkLayoutJobTitle"(layout_id);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE "WorkLayoutJobTitle";
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
