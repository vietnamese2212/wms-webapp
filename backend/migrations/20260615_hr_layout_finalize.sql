-- ============================================================
-- HR: Hoàn tất chuyển phiếu phân công sang layout-based
-- Apply: Supabase Dashboard → SQL Editor
-- ============================================================
-- assignmentController đã dùng layout_id → bỏ cầu nối department_id,
-- thêm unique (work_date, layout_id).
-- ============================================================

ALTER TABLE "WorkAssignmentSheet" DROP COLUMN IF EXISTS department_id;
DO $$ BEGIN
  ALTER TABLE "WorkAssignmentSheet" ADD CONSTRAINT uq_sheet_date_layout UNIQUE (work_date, layout_id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;
