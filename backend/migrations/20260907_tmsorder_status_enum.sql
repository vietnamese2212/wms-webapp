-- TmsOrder.status — CHUẨN HOÁ TÊN + KHOÁ DANH SÁCH ĐÓNG (user chốt 07/09: "Chờ · Xong · Huỷ")
--
-- VÌ SAO:
--   (1) BẪY DI SẢN — 3.173 lệnh của 17/07–17/08 mang 'COMPLETED' trong khi code hiện tại ghi 'DONE'.
--       Hai cái tên cho CÙNG MỘT VIỆC. Chưa gây lỗi vì chưa chỗ nào lọc theo chúng, nhưng báo cáo
--       "lệnh đã hoàn thành" đầu tiên sẽ mất một nửa số liệu — và mất IM LẶNG, không lỗi, không cảnh báo.
--   (2) Ô này chưa có danh sách đóng: `PATCH /tms/orders/:id` nhận `status` thô từ body nên gọi thẳng
--       API là ghi được giá trị bất kỳ. Cùng lớp lỗi với trạng thái DÒNG XE đã vá cùng ngày, ở đó một
--       giá trị lạ làm xe rơi khỏi phép đếm sức chứa và hỏng cả trang cài khung giờ của kho.
--   Backend đã chặn ở `orderController` (ORDER_STATUSES); CHECK dưới đây là lớp cuối, chặn CẢ đường
--   ghi không qua app (script, sửa tay, tích hợp sau này).
--
-- ÁP: Supabase Dashboard → SQL Editor, chạy nguyên file. STAGING trước, kiểm, rồi mới tới DB thật.
-- Chạy lại nhiều lần vô hại (idempotent).

BEGIN;

-- 1) Backup trước khi đổi nghĩa dữ liệu — giữ đúng những dòng sắp bị đụng.
CREATE TABLE IF NOT EXISTS x_bak_tmsorder_status_20260907 AS
SELECT id, status, completed_at, updated_at
FROM "TmsOrder"
WHERE status NOT IN ('PENDING', 'DONE', 'CANCELLED');
-- Bảng public nào cũng bật RLS (gói QA 00 bất biến gác; anon/authenticated vốn không có GRANT nên đây là lớp
-- thứ hai) — bản staging 07/09 quên dòng này, gói 00 đỏ ngay lượt chạy kế.
ALTER TABLE x_bak_tmsorder_status_20260907 ENABLE ROW LEVEL SECURITY;

-- 2) 'COMPLETED' (tên cũ) → 'DONE' (tên code đang dùng).
UPDATE "TmsOrder" SET status = 'DONE'
WHERE status = 'COMPLETED';

-- 3) Giá trị lạ khác (nếu có) → PENDING, tức "chưa xong": an toàn hơn tự nhận là đã xong.
--    Bản backup ở bước 1 giữ nguyên giá trị gốc để còn lần lại.
UPDATE "TmsOrder" SET status = 'PENDING'
WHERE status NOT IN ('PENDING', 'DONE', 'CANCELLED');

-- 4) Còn giá trị ngoài danh sách thì DỪNG — không thêm ràng buộc lên dữ liệu chưa sạch.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "TmsOrder" WHERE status NOT IN ('PENDING', 'DONE', 'CANCELLED');
  IF n > 0 THEN
    RAISE EXCEPTION 'Còn % lệnh mang trạng thái ngoài danh sách — dọn trước khi thêm CHECK', n;
  END IF;
END $$;

-- 5) Khoá danh sách đóng ở tầng DB.
ALTER TABLE "TmsOrder" DROP CONSTRAINT IF EXISTS tmsorder_status_check;
ALTER TABLE "TmsOrder" ADD CONSTRAINT tmsorder_status_check
  CHECK (status IN ('PENDING', 'DONE', 'CANCELLED'));

COMMIT;

-- Kiểm sau khi chạy (phải ra đúng 2–3 dòng, không dòng nào ngoài danh sách):
--   SELECT status, count(*) FROM "TmsOrder" GROUP BY 1 ORDER BY 2 DESC;
-- Đường lui:
--   ALTER TABLE "TmsOrder" DROP CONSTRAINT tmsorder_status_check;
--   UPDATE "TmsOrder" o SET status = b.status
--     FROM x_bak_tmsorder_status_20260907 b WHERE b.id = o.id;
