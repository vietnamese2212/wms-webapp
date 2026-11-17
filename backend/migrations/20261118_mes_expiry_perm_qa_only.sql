-- MES 18/11 — QUYỀN DUYỆT NVL HẾT HẠN CHỈ Ở CHỨC DANH QA (user chốt 18/11: "Bỏ").
-- 20261117e cấp production.approve_expired cho mọi chức danh có approve_qa ⇒ lọt sang ba chức danh quản lý kho
-- (Quản lý kho NPP · Quản lý kho site · Quản lý kho toàn quốc). Gỡ ở ba chức danh đó; các quyền khác giữ nguyên.
-- Khớp theo id (staging) HOẶC tên (DB khác có thể sinh id khác) — chỉ đụng dòng đang có approve_expired.
BEGIN;

UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(j.module_permissions, '{production}',
         COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(j.module_permissions->'production') x
                    WHERE x <> '"approve_expired"'::jsonb), '[]'::jsonb), true),
       updated_at = now()
 WHERE jsonb_typeof(j.module_permissions->'production') = 'array'
   AND j.module_permissions->'production' ? 'approve_expired'
   AND (j.id IN ('jt-ql-site', 'jt-ql-tq', '5d7e4421-3f7a-4280-893d-0c709a2451cb')
        OR j.name IN ('Quản lý kho NPP', 'Quản lý kho site', 'Quản lý kho toàn quốc'));

-- Lưới: sau migration không còn chức danh quản lý kho nào giữ approve_expired
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public."JobTitle" j
   WHERE j.module_permissions->'production' ? 'approve_expired'
     AND (j.id IN ('jt-ql-site', 'jt-ql-tq', '5d7e4421-3f7a-4280-893d-0c709a2451cb')
          OR j.name IN ('Quản lý kho NPP', 'Quản lý kho site', 'Quản lý kho toàn quốc'));
  IF n > 0 THEN RAISE EXCEPTION 'còn % chức danh quản lý kho giữ approve_expired', n; END IF;
END $$;

COMMIT;
