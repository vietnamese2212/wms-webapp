-- Mỗi layout chỉ 1 phiếu phân công / ngày. Chặn trùng ở DB (upsert đã dùng lại phiếu cũ theo ngày+layout).
CREATE UNIQUE INDEX IF NOT EXISTS "WorkAssignmentSheet_workdate_layout_uniq"
  ON "WorkAssignmentSheet" (work_date, layout_id);
