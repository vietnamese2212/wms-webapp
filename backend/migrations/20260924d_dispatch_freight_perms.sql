-- ============================================================================
-- 20260924d — Điều vận + Cước: CẤP QUYỀN theo chức danh
-- ============================================================================
-- Đo 24/09 (staging): 0/19 chức danh có key `dispatch` hoặc `freight`. Trang Cước lên máy 23/09,
-- trang Điều vận 24/09 — CHỈ superadmin mở được, 41 nhân sự đang làm việc không ai thấy mục menu.
-- Cùng lớp lỗi với 20260912d (Việc cần làm ra máy 10/09 mà 0/9 chức danh kho có quyền): tính năng
-- xong ở tầng code KHÔNG có nghĩa là tới được tay người dùng.
--
-- Cấp theo NĂNG LỰC ĐÃ CÓ, KHÔNG so TÊN tiếng Việt (ratchet `role_by_vietnamese_name`).
--
-- ĐIỀU VẬN — "ai đang lập kế hoạch xe BẰNG TAY thì được dùng máy lập hộ":
--   • view    ← external_khvc.view  ∨ tms_plan.create ∨ tms_plan.edit
--   • plan    ← external_khvc.create ∨ external_khvc.edit ∨ tms_plan.create ∨ tms_plan.edit
--   • confirm ← external_khvc.create ∨ external_khvc.edit   ← CỐ Ý HẸP HƠN plan
--       Xác nhận kế hoạch GHI THẲNG vào `khvc_lines` (Kế hoạch xuất). Ai không được sửa Kế hoạch
--       xuất bằng tay thì cũng không được ghi vào đó qua cửa mới — đúng luật "nút ở trang A nhưng
--       chạm module B thì phải có quyền B". Hệ quả đã biết: chức danh Nhân viên/Quản lý điều vận
--       (external_khvc rỗng) LẬP được nháp nhưng chưa XÁC NHẬN được; muốn cho thì tick thêm
--       external_khvc.edit hoặc dispatch.confirm trong trình phân quyền — một nhát, có chủ đích.
--   • export  ← có view VÀ đã có tms_plan.export (mang dữ liệu ra khỏi app là quyền RIÊNG,
--       không đi ké view — luật export của CLAUDE.md). external_khvc không có action export.
--
-- CƯỚC — dữ liệu TIỀN theo hợp đồng ĐVVT, hẹp hơn Điều vận:
--   • view   ← tms_companies.edit ∨ tms_vehicle_types.edit ∨ warehouse_cost.view
--              (ai quản danh mục vận tải, hoặc đã được tin cho xem tiền)
--   • manage ← warehouse_cost.edit ∨ tms_vehicle_types.edit   (ai đang khai tiền / làm chủ danh
--              mục dòng xe — nạp bảng cước là ghi lại giá hợp đồng, không phải việc hằng ngày)
--   • export ← có view VÀ đã có tms_plan.export
--
-- CHỈ điền cho chức danh CHƯA có key tương ứng — admin đã tự cấp/gỡ thì KHÔNG đè.
-- ============================================================================
BEGIN;

-- ── ĐIỀU VẬN ──
WITH src AS (
  SELECT id, COALESCE(module_permissions, '{}'::jsonb) AS mp FROM public."JobTitle"
), capab AS (
  SELECT id,
         (mp->'external_khvc' ? 'create') OR (mp->'external_khvc' ? 'edit')            AS khvc_write,
         (mp->'tms_plan' ? 'create')      OR (mp->'tms_plan' ? 'edit')                 AS plan_write,
         (mp->'external_khvc' ? 'view')                                                AS khvc_read,
         (mp->'tms_plan' ? 'export')                                                   AS can_export
    FROM src
   WHERE mp->'dispatch' IS NULL
), grant_rows AS (
  -- ai nhận BẤT KỲ quyền con nào cũng phải có `view`, kẻo cấp quyền cho một trang họ không mở được
  SELECT id, khvc_write, plan_write, can_export FROM capab
   WHERE khvc_read OR plan_write OR khvc_write
)
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(
         COALESCE(j.module_permissions, '{}'::jsonb), '{dispatch}',
         to_jsonb(
           ARRAY['view']
           || CASE WHEN g.khvc_write OR g.plan_write THEN ARRAY['plan']    ELSE ARRAY[]::text[] END
           || CASE WHEN g.khvc_write                 THEN ARRAY['confirm'] ELSE ARRAY[]::text[] END
           || CASE WHEN g.can_export                 THEN ARRAY['export']  ELSE ARRAY[]::text[] END
         ), true),
       updated_at = now()
  FROM grant_rows g
 WHERE g.id = j.id;

-- ── CƯỚC ──
WITH src AS (
  SELECT id, COALESCE(module_permissions, '{}'::jsonb) AS mp FROM public."JobTitle"
), capab AS (
  SELECT id,
         (mp->'tms_companies' ? 'edit') OR (mp->'tms_vehicle_types' ? 'edit')
           OR (mp->'warehouse_cost' ? 'view')                                          AS can_view,
         (mp->'warehouse_cost' ? 'edit') OR (mp->'tms_vehicle_types' ? 'edit')         AS can_manage,
         (mp->'tms_plan' ? 'export')                                                   AS can_export
    FROM src
   WHERE mp->'freight' IS NULL
), grant_rows AS (
  SELECT * FROM capab WHERE can_view
)
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(
         COALESCE(j.module_permissions, '{}'::jsonb), '{freight}',
         to_jsonb(
           ARRAY['view']
           || CASE WHEN g.can_manage THEN ARRAY['manage'] ELSE ARRAY[]::text[] END
           || CASE WHEN g.can_export THEN ARRAY['export'] ELSE ARRAY[]::text[] END
         ), true),
       updated_at = now()
  FROM grant_rows g
 WHERE g.id = j.id;

-- ── Gác: không để lại trạng thái vô nghĩa ──
DO $$
DECLARE n int;
BEGIN
  -- ai ghi được Kế hoạch xuất thì phải mở được Điều vận (nếu không, máy lập hộ mà người không thấy)
  SELECT count(*) INTO n FROM public."JobTitle"
   WHERE ((COALESCE(module_permissions,'{}')->'external_khvc' ? 'create')
       OR (COALESCE(module_permissions,'{}')->'external_khvc' ? 'edit'))
     AND NOT (COALESCE(module_permissions,'{}')->'dispatch' ? 'view');
  IF n > 0 THEN RAISE EXCEPTION 'còn % chức danh ghi được Kế hoạch xuất mà không mở được Điều vận', n; END IF;

  -- không ai được quyền con mà thiếu quyền xem trang chứa nó
  SELECT count(*) INTO n FROM public."JobTitle"
   WHERE ((COALESCE(module_permissions,'{}')->'dispatch' ? 'plan')
       OR (COALESCE(module_permissions,'{}')->'dispatch' ? 'confirm')
       OR (COALESCE(module_permissions,'{}')->'dispatch' ? 'export'))
     AND NOT (COALESCE(module_permissions,'{}')->'dispatch' ? 'view');
  IF n > 0 THEN RAISE EXCEPTION 'còn % chức danh có quyền con dispatch mà không có dispatch.view', n; END IF;

  SELECT count(*) INTO n FROM public."JobTitle"
   WHERE ((COALESCE(module_permissions,'{}')->'freight' ? 'manage')
       OR (COALESCE(module_permissions,'{}')->'freight' ? 'export'))
     AND NOT (COALESCE(module_permissions,'{}')->'freight' ? 'view');
  IF n > 0 THEN RAISE EXCEPTION 'còn % chức danh có quyền con freight mà không có freight.view', n; END IF;
END $$;

COMMIT;
