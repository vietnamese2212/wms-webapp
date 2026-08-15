-- GỘP THÔNG BÁO CÁ NHÂN Ở TẦNG DB (check-app 06/08 đo thật: giao 6 dòng lệnh fill SONG SONG
-- sinh 4 dòng feed thay vì 1).
--
-- Nguyên nhân: dedupe cũ làm bằng ĐỌC-RỒI-GHI trong JS (SELECT xem đã có chưa → INSERT) — 6
-- request đồng thời cùng đọc thấy "chưa có" nên cùng ghi. Đúng lớp lỗi mà CLAUDE.md cấm: mọi
-- chống-trùng phải là RÀNG BUỘC DB, không phải kiểm trong ứng dụng.
--
-- Luật mới (đơn giản hơn cửa sổ-2-phút cũ): MỘT người + MỘT loại việc + MỘT đối tượng (url)
-- = ĐÚNG MỘT dòng feed. Báo lại lần sau thì LÀM MỚI dòng đó (created_at mới, read_at=null →
-- nổi lên đầu, đếm lại là chưa đọc) thay vì đẻ dòng trùng. NULLS NOT DISTINCT để thông báo
-- không kèm link cũng gộp được.
--
-- Dọn trùng di sản TRƯỚC khi tạo index (giữ dòng MỚI NHẤT của mỗi bộ) — production apply nguyên trạng.
DELETE FROM user_notifications a
USING user_notifications b
WHERE a.employee_id = b.employee_id
  AND a.kind = b.kind
  AND a.url IS NOT DISTINCT FROM b.url
  AND (a.created_at, a.id) < (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_notif_target
  ON user_notifications (employee_id, kind, url) NULLS NOT DISTINCT;
