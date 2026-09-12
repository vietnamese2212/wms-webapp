-- ============================================================================
-- 20260912d — Việc cần làm: CẤP QUYỀN theo chức danh + TRANG MỞ ĐẦU theo chức danh
-- ============================================================================
-- Đo 12/09 (staging): 0/9 chức danh kho có quyền `directed_work` — Lái xe nâng (17 người) và
-- Thủ kho TP (9 người) KHÔNG THẤY mục "Việc cần làm" trên menu; nút "✓ Xong" không ai bấm được.
-- Tính năng ra máy 10/09 mà chưa người dùng thật nào tới được.
--
-- Cấp theo NĂNG LỰC ĐÃ CÓ của chức danh, KHÔNG so TÊN tiếng Việt (ratchet `role_by_vietnamese_name`):
--   • có outbound.prepare / outbound.scan / loosepicking.scan → directed_work.view
--     (ai đang được soạn hàng hay quét xuất thì phải thấy kế hoạch lấy hàng)
--   • có outbound.prepare (vai soạn hàng = xe nâng, thủ kho)  → + confirm (bấm ✓ Xong)
--   • có outbound.assign  (giám sát / quản lý kho)          → + replan (sắp lại kế hoạch)
-- CHỈ điền cho chức danh CHƯA có key `directed_work` — admin đã tự cấp/gỡ thì không đè.
--
-- Trang mở đầu: `JobTitle.landing_page` (NULL = Tổng quan như cũ). Chức danh được ✓ Xong mà KHÔNG
-- quét xuất, KHÔNG giao việc (= lái xe nâng thuần) → mở app rơi thẳng vào Việc cần làm: đăng nhập
-- → Dashboard KPI toàn công ty → menu → Việc cần làm là 3 chạm cho một màn không liên quan tới họ.
-- FE chỉ chuyển hướng khi người đó THỰC SỰ có quyền vào trang đích (không tạo vòng lặp điều hướng).
-- ============================================================================
BEGIN;

ALTER TABLE public."JobTitle" ADD COLUMN IF NOT EXISTS landing_page text;
ALTER TABLE public."JobTitle" DROP CONSTRAINT IF EXISTS "JobTitle_landing_page_check";
ALTER TABLE public."JobTitle"
  ADD CONSTRAINT "JobTitle_landing_page_check"
  CHECK (landing_page IS NULL OR landing_page ~ '^/[a-z0-9/_-]{1,80}$');
COMMENT ON COLUMN public."JobTitle".landing_page IS
  'Trang mở đầu sau đăng nhập cho chức danh này (NULL = Tổng quan). FE chỉ chuyển hướng khi user có quyền vào trang đó.';

-- Cấp quyền directed_work theo năng lực sẵn có
WITH src AS (
  SELECT id, COALESCE(module_permissions, '{}'::jsonb) AS mp FROM public."JobTitle"
), grant_rows AS (
  SELECT id,
         to_jsonb(
           ARRAY['view']
           || CASE WHEN mp->'outbound' ? 'prepare' THEN ARRAY['confirm'] ELSE ARRAY[]::text[] END
           || CASE WHEN mp->'outbound' ? 'assign'  THEN ARRAY['replan']  ELSE ARRAY[]::text[] END
         ) AS dw
    FROM src
   WHERE mp->'directed_work' IS NULL
     AND ((mp->'outbound' ? 'prepare') OR (mp->'outbound' ? 'scan') OR (mp->'loosepicking' ? 'scan'))
)
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(COALESCE(j.module_permissions, '{}'::jsonb), '{directed_work}', g.dw, true),
       updated_at = now()
  FROM grant_rows g
 WHERE g.id = j.id;

-- Trang mở đầu cho lái xe nâng thuần (được ✓ Xong, không quét xuất, không giao việc)
UPDATE public."JobTitle"
   SET landing_page = '/wms/directed', updated_at = now()
 WHERE landing_page IS NULL
   AND COALESCE(module_permissions, '{}'::jsonb)->'directed_work' ? 'confirm'
   AND NOT (COALESCE(module_permissions, '{}'::jsonb)->'outbound' ? 'scan')
   AND NOT (COALESCE(module_permissions, '{}'::jsonb)->'outbound' ? 'assign');

-- Gác: sau backfill, mọi chức danh có quyền quét xuất / soạn hàng đều thấy được Việc cần làm
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public."JobTitle"
   WHERE ((COALESCE(module_permissions,'{}')->'outbound' ? 'prepare')
       OR (COALESCE(module_permissions,'{}')->'outbound' ? 'scan'))
     AND NOT (COALESCE(module_permissions,'{}')->'directed_work' ? 'view');
  IF n > 0 THEN RAISE EXCEPTION 'còn % chức danh soạn/quét xuất mà không thấy Việc cần làm', n; END IF;
END $$;

COMMIT;
