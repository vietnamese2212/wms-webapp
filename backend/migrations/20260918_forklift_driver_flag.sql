-- Cờ VAI TRÒ "lái xe nâng" — tiếp nối 20260814_role_flags (is_driver / is_carrier)
--
-- VÌ SAO (user hỏi 18/09 "gác người lái xe nâng là gì?"):
-- Lúc Bắt đầu chuyến ở kho Hướng dẫn, danh sách người lái xe nâng ghi vào
-- `GroupDeliveryOrder.forklift_driver_ids` — chính nó quyết định bảng "Cần đưa ra" hiện việc cho AI.
-- Máy chủ (`validForkliftIds`) đang gác 2 điều: người còn làm việc + thuộc kho của chuyến. KHÔNG gác
-- VAI TRÒ. Ô chọn trên màn hình có lọc, nhưng lọc bằng cách **so tên chức danh chứa "lái xe nâng"**
-- (OutboundDetail.tsx) — vừa là luật chép ở FE, vừa vi phạm luật "vai trò đọc theo CỜ, không so tên
-- tiếng Việt": đổi tên chức danh trong danh mục là ô chọn rỗng mà không lỗi nào nổ.
--
-- Hậu quả ĐO ĐƯỢC trên staging 18/09: 3 chuyến ĐANG XUẤT của Ba Vì (…_120926_84/85/86) có **Admin**
-- và **SIMDAY Bot** đứng tên lái xe nâng — cả hai đều lọt vì "có thật" + "đúng kho", và cả hai đều
-- KHÔNG có chức danh. Hệ quả: bảng việc của Admin hiện việc không phải của mình, và khối Giám sát
-- → "theo người" đếm sai công của cả kho.
--
-- BACKFILL theo đúng tên đang dùng ⇒ sau migration hành vi GIỮ NGUYÊN 100%:
--   "Lái xe nâng" (17 người) · "Trường nhóm Lái xe nâng" (1) — đúng tập mà bộ lọc chuỗi đang bắt.

ALTER TABLE "JobTitle" ADD COLUMN IF NOT EXISTS is_forklift_driver boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "JobTitle".is_forklift_driver IS
  'Chức danh LÁI XE NÂNG — ô chọn "Lái xe nâng" lúc Bắt đầu chuyến và cửa gác của máy chủ đọc cờ này, KHÔNG so tên';

UPDATE "JobTitle" SET is_forklift_driver = true
 WHERE lower(name) LIKE '%lái xe nâng%' AND is_forklift_driver = false;

-- Gác: backfill trượt (tên đã bị đổi trước đó) ⇒ deploy xong là KHÔNG ai chọn được lái xe nâng, và
-- kho Hướng dẫn không Bắt đầu nổi chuyến nào (422 FORKLIFT_REQUIRED). Thà dừng ở đây còn hơn.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "JobTitle" WHERE is_forklift_driver;
  IF n = 0 THEN
    RAISE EXCEPTION 'Backfill cờ lái xe nâng trượt: 0 chức danh được tick — kiểm tên chức danh trong danh mục rồi tick tay TRƯỚC khi deploy code mới';
  END IF;
END $$;
