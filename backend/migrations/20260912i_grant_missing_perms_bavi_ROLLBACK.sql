-- Đường lui cho 20260912i — trả module_permissions về ĐÚNG NGUYÊN VĂN trước khi cấp.
-- Dùng bản sao đã chụp trong chính migration đó, nên không phải đoán action nào là mới.
-- ⚠ Nếu sau khi cấp có người đã tự sửa quyền trong Quản lý người dùng thì lệnh này ĐÈ MẤT
--   sửa đó — kiểm x_bak_jobtitle_perms_20260912i.backed_up_at trước khi chạy.
BEGIN;

UPDATE public."JobTitle" j
   SET module_permissions = b.module_permissions,
       updated_at = now()
  FROM public.x_bak_jobtitle_perms_20260912i b
 WHERE b.id = j.id
   AND j.module_permissions IS DISTINCT FROM b.module_permissions;

-- Bỏ ghi chú dòng dưới nếu muốn dọn luôn bản sao
-- DROP TABLE IF EXISTS public.x_bak_jobtitle_perms_20260912i;

COMMIT;
