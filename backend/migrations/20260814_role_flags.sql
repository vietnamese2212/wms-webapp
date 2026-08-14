-- Cờ VAI TRÒ thay cho so TÊN TIẾNG VIỆT (audit hardcode 14/08, mục #3)
--
-- Trước migration này app quyết định hành vi bằng cách so chuỗi:
--   UserManagement : Department.name = 'Đơn vị vận tải' AND JobTitle.name = 'Lái xe'  → form gán xe cho tài khoản
--   TMSBookings    : user.job_title_name = 'Lái xe'                                    → luồng UI tài xế
--                    user.department     = 'Đơn vị vận tải'                            → user thuộc nhà xe
-- Đổi tên chức danh/phòng ban trong danh mục (việc hoàn toàn hợp lệ) là luồng hỏng ÂM THẦM:
-- không lỗi, không cảnh báo, chỉ là nút/màn hình biến mất.
--
-- BACKFILL theo đúng tên đang dùng ⇒ sau migration hành vi GIỮ NGUYÊN 100%; từ nay đổi tên thoải mái,
-- chỉ cờ mới quyết định. Tick cờ ở form Chức danh / Phòng ban.

ALTER TABLE "JobTitle"   ADD COLUMN IF NOT EXISTS is_driver  boolean NOT NULL DEFAULT false;
ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS is_carrier boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "JobTitle".is_driver   IS 'Chức danh TÀI XẾ — app mở luồng gán xe / màn hình tài xế theo cờ này, không theo tên';
COMMENT ON COLUMN "Department".is_carrier IS 'Phòng ban là ĐƠN VỊ VẬN TẢI (nhà xe) — dùng cho luồng gán xe & quyền xem của nhà xe';

UPDATE "JobTitle"   SET is_driver  = true WHERE name = 'Lái xe'          AND is_driver  = false;
UPDATE "Department" SET is_carrier = true WHERE name = 'Đơn vị vận tải'  AND is_carrier = false;

-- Gác: dữ liệu hiện tại PHẢI có đúng 1 chức danh tài xế + 1 phòng ban nhà xe, nếu không thì
-- backfill trượt (tên đã bị đổi trước đó) và app sẽ mất luồng tài xế sau khi deploy.
DO $$
DECLARE n_driver int; n_carrier int;
BEGIN
  SELECT count(*) INTO n_driver  FROM "JobTitle"   WHERE is_driver;
  SELECT count(*) INTO n_carrier FROM "Department" WHERE is_carrier;
  IF n_driver = 0 OR n_carrier = 0 THEN
    RAISE EXCEPTION 'Backfill cờ vai trò trượt: is_driver=% , is_carrier=% — kiểm tên chức danh "Lái xe" / phòng ban "Đơn vị vận tải" rồi tick cờ tay trước khi deploy code mới', n_driver, n_carrier;
  END IF;
END $$;
