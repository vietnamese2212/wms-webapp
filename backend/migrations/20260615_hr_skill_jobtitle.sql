-- ============================================================
-- HR: Skill thuộc Chức danh (JobTitle) thay vì Kho+Phòng
-- Apply: Supabase Dashboard → SQL Editor
-- ============================================================
-- Bối cảnh: danh mục skill khai báo theo chức danh; NV pick skill từ
--   chức danh của mình. Phiếu phân công (theo Kho+Phòng+Ngày) lấy vị trí =
--   gộp skill của các chức danh trong phòng (JobTitle.department_id).
--   Bảng Skill còn trống → đổi cột an toàn.
-- ============================================================

-- Bỏ scope Kho+Phòng trên Skill, gắn theo Chức danh
ALTER TABLE "Skill" DROP COLUMN IF EXISTS warehouse_id;
ALTER TABLE "Skill" DROP COLUMN IF EXISTS department_id;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS job_title_id TEXT REFERENCES "JobTitle"(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_skill_jobtitle ON "Skill"(job_title_id);
