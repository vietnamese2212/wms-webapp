-- BỎ giá trị mặc định LỖI THỜI của Employee.allowed_categories (check-app 02/08, user chốt).
-- Cột đang có DEFAULT ARRAY['TP','NVL','POSM','BAO_BI'] = taxonomy CŨ, trong khi Loại kho hiện
-- dùng mã SAP (FG01/PM01/RM01/PK01 — xem memory warehouse-type-taxonomy-sap). Hệ quả: mọi đường
-- ghi thẳng DB không khai loại (script import nhân sự, seed) sẽ đẻ scope RÁC → user đó dính 403
-- "Ngoài phạm vi Loại hàng được phép" ở MỌI thao tác mà không hiểu vì sao.
--
-- Vì sao bỏ hẳn thay vì đổi sang mã mới: NULL/rỗng = KHÔNG giới hạn loại (scopeCategoriesOf trả
-- null) — đúng ý nghĩa "chưa cấu hình", và createEmployee đã tự điền đủ danh mục HIỆN TẠI khi
-- form không gửi (đọc LookupValue warehouse_type). Để DEFAULT ở DB chỉ tạo đường sinh dữ liệu sai.
-- Dữ liệu đang có KHÔNG đổi (39/39 nhân viên staging đã mang mã SAP đúng).
ALTER TABLE "Employee" ALTER COLUMN allowed_categories DROP DEFAULT;

-- Dọn di sản nếu còn dòng mang mã cũ (an toàn: chỉ đụng dòng có TOÀN mã cũ, không đụng mã SAP)
UPDATE "Employee"
   SET allowed_categories = NULL, updated_at = now()
 WHERE allowed_categories IS NOT NULL
   AND allowed_categories <@ ARRAY['TP','NVL','POSM','BAO_BI','Bao bì','Thành phẩm','Raw','Giấy','Thùng']::text[]
   AND NOT (allowed_categories && (SELECT COALESCE(array_agg(value), ARRAY[]::text[]) FROM "LookupValue" WHERE type = 'warehouse_type'));
