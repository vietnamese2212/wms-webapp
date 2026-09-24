-- ============================================================================
-- 20260912i — CẤP THỬ (Ba Vì): 73 action chưa chức danh nào được cấp
-- ============================================================================
-- Đo 12/09 (staging, gói QA 08 perm-coverage): 73 action đã khai trong mã nhưng KHÔNG chức danh
-- nào có ⇒ nút/trang đó TÀNG HÌNH với toàn bộ 38 nhân viên đang hoạt động, chỉ superadmin thấy.
-- Nặng nhất:
--   • Lái xe nâng (17 người) không mở được trang Xe nâng — check list an toàn HẰNG NGÀY của họ.
--   • NV SAP TP (3 người) không mở được Quy định date — mà kho chạy chế độ Hướng dẫn thì dòng
--     chưa khai mức date là KHÔNG AI lấy hàng được. Người có nhiệm vụ khai lại không vào nổi.
--
-- PHẠM VI = BA VÌ. Quyền trong app gắn vào CHỨC DANH chứ không gắn theo kho, nhưng đo thấy 9/10
-- chức danh đang dùng CHỈ do người Ba Vì giữ (chức danh thứ 10 — "Quản lý kho NPP" — không có ai
-- ở Ba Vì nên KHÔNG khớp luật nào dưới đây). Dữ liệu mỗi người thấy vẫn bị cắt theo phạm vi kho
-- của chính họ như cũ, migration này không đụng tới phạm vi.
--
-- CẤP THEO NĂNG LỰC SẴN CÓ, KHÔNG SO TÊN tiếng Việt (ratchet `role_by_vietnamese_name`):
--   van_hanh      = đang được ✓ Xong / quét xuất / quét nhập / chuyển vị trí  → việc tay chân tại kho
--   quet_xuat     = đang được quét xuất hoặc quét nhặt lẻ                     → người đứng cửa xuất
--   chung_tu      = đang được nạp hoặc tạo đơn xuất                           → vai SAP / chứng từ
--   giam_sat      = đang được sửa pallet của NGƯỜI KHÁC (force_edit_pallet)   → vai giám sát
--   quan_ly       = đang được sửa cấu hình Kho (manage_warehouse)             → vai quản lý
--   sua_vi_tri    = đang được sửa Vị trí kho
--   quan_nhan_su  = đang được sửa hồ sơ người dùng
--   danh_muc_hang = đang được tạo Mã hàng
--   phan_cong     = đang được phát hành lịch phân công
--
-- CHỈ THÊM, KHÔNG GỠ: action đang có được giữ nguyên, chạy lại nhiều lần cũng ra một kết quả.
-- Bản sao trước khi đổi nằm ở x_bak_jobtitle_perms_20260912i (đường lui: file *_ROLLBACK.sql).
-- ============================================================================
BEGIN;

-- Bản sao để quay lui — giữ NGUYÊN VĂN module_permissions trước khi cấp
DROP TABLE IF EXISTS public.x_bak_jobtitle_perms_20260912i;
CREATE TABLE public.x_bak_jobtitle_perms_20260912i AS
  SELECT id, name, module_permissions, now() AS backed_up_at FROM public."JobTitle";
-- BẮT BUỘC với MỌI bảng public mới, kể cả bảng sao lưu dùng một lần: gói QA 00 có bất biến "không
-- bảng public nào hở với anon key" và nó đã bắt đúng chỗ này khi bản đầu quên (mọi x_bak_* khác
-- trong DB đều đã bật). Không khai policy nào ⇒ không ai đọc được qua PostgREST; backend đi
-- service_role nên vẫn quay lui được.
ALTER TABLE public.x_bak_jobtitle_perms_20260912i ENABLE ROW LEVEL SECURITY;

-- PHẠM VI: chỉ chức danh đang có NGƯỜI THẬT làm ở Ba Vì (hoặc người phạm vi toàn quốc — họ phụ
-- trách cả Ba Vì). Diễn tập lần 1 không có mệnh đề này nên chạm luôn "Quản lý kho site" và
-- "Quản lý kho NPP" — hai chức danh không có ai ở Ba Vì; cấp thử mà lan sang kho khác thì không
-- còn là cấp thử nữa.
WITH bavi AS (
  SELECT id FROM public."Warehouse" WHERE code IN ('20000016', 'CBBV')
), src AS (
  SELECT jt.id, COALESCE(jt.module_permissions, '{}'::jsonb) AS mp
    FROM public."JobTitle" jt
   WHERE EXISTS (
     SELECT 1 FROM public."Employee" e
      WHERE e.job_title_id = jt.id AND e.is_active
        AND (e.warehouse_scope = 'NATIONAL'
             OR EXISTS (SELECT 1 FROM public."UserWarehouseAccess" a, bavi b
                         WHERE a.employee_id = e.id AND a.warehouse_id = b.id))
   )
), cap AS (
  SELECT id, mp,
         (mp->'directed_work' ? 'confirm') OR (mp->'outbound' ? 'scan')
           OR (mp->'inbound' ? 'scan') OR (mp->'inventory' ? 'move_location')      AS van_hanh,
         (mp->'outbound' ? 'scan') OR (mp->'loosepicking' ? 'scan')                AS quet_xuat,
         (mp->'outbound' ? 'import') OR (mp->'outbound' ? 'create')                AS chung_tu,
         (mp->'inbound' ? 'force_edit_pallet')                                     AS giam_sat,
         (mp->'wms_settings' ? 'manage_warehouse')                                 AS quan_ly,
         (mp->'locations' ? 'edit')                                                AS sua_vi_tri,
         (mp->'user_admin' ? 'edit')                                               AS quan_nhan_su,
         (mp->'materials' ? 'create')                                              AS danh_muc_hang,
         (mp->'work_assignment' ? 'publish')                                       AS phan_cong
    FROM src
), rules(rule, module, action) AS (VALUES
  -- người làm việc tay chân tại kho: thấy bản vẽ kho, làm check list xe nâng, quét thực hiện lệnh fill
  ('van_hanh','warehouse_map','view'),
  ('van_hanh','fill','view'), ('van_hanh','fill','execute'),
  ('van_hanh','forklift','view'), ('van_hanh','forklift','check'),
  -- người đứng cửa xuất: cảnh báo vận hành, phiếu cân (chỉ xem), ra lệnh fill, đối chiếu sổ đóng gói
  ('quet_xuat','alerts','view'), ('quet_xuat','alerts','ack'),
  ('quet_xuat','weigh_station','view'),
  ('quet_xuat','fill','plan'), ('quet_xuat','fill','change_dest'),
  ('quet_xuat','packing','view'),
  -- vai SAP / chứng từ: KHAI MỨC DATE, đối soát SAP, danh mục khách, dữ liệu ngoài, truy xuất lô
  ('chung_tu','outbound','set_date'), ('chung_tu','outbound','reconcile'),
  ('chung_tu','customers','view'), ('chung_tu','customers','edit'), ('chung_tu','customers','import'),
  ('chung_tu','external_do_sap','view'), ('chung_tu','external_do_sap','create'),
  ('chung_tu','external_do_sap','edit'), ('chung_tu','external_do_sap','delete'),
  ('chung_tu','external_do_sap','export'),
  ('chung_tu','external_khvc','view'), ('chung_tu','external_khvc','create'),
  ('chung_tu','external_khvc','edit'), ('chung_tu','external_khvc','delete'),
  ('chung_tu','weigh_station','view'), ('chung_tu','weigh_station','match'),
  ('chung_tu','traceability','view'), ('chung_tu','traceability','export'),
  ('chung_tu','alerts','view'), ('chung_tu','alerts','ack'),
  ('chung_tu','warehouse_map','view'), ('chung_tu','tms_plan','export'),
  -- CHỈ XEM hộp việc, không ✓ Xong, không sắp lại kế hoạch: hộp việc có đúng hai dòng dành cho vai
  -- này — "khai quy định date" và "DO SAP cần xử lý". Kiểm bằng tài khoản vai thật 12/09 thấy NV SAP
  -- bị 403 ở Việc cần làm, tức việc gọi tên họ mà họ không mở nổi cái hộp chứa nó.
  ('chung_tu','directed_work','view'),
  -- vai giám sát: 2 nút DUYỆT miễn trừ, van xả luân chuyển, Tối ưu vị trí, sổ đóng gói, các nút xuất
  ('giam_sat','outbound','gate_waive'), ('giam_sat','outbound','weigh_waive'),
  ('giam_sat','outbound','rotation_override'),
  ('giam_sat','control_tower','view'),
  ('giam_sat','slotting','view'), ('giam_sat','slotting','plan'), ('giam_sat','slotting','delete'),
  ('giam_sat','slotting','complete'), ('giam_sat','slotting','cancel'),
  ('giam_sat','slotting','reopen'), ('giam_sat','slotting','configure'),
  ('giam_sat','fill','assign'), ('giam_sat','fill','cancel'),
  ('giam_sat','forklift','delete_check'), ('giam_sat','forklift','manage_vehicle'),
  ('giam_sat','forklift','manage_item'),
  ('giam_sat','packing','record'), ('giam_sat','packing','open_run'), ('giam_sat','packing','edit'),
  ('giam_sat','packing','cancel'), ('giam_sat','packing','export'),
  ('giam_sat','loosepicking','recalc'),
  ('giam_sat','stocktake','export'), ('giam_sat','scanlog','export'), ('giam_sat','leave','export'),
  ('giam_sat','traceability','view'), ('giam_sat','traceability','export'),
  ('giam_sat','traceability','investigate'),
  ('giam_sat','dashboard','kpi_target'),
  ('giam_sat','inbound','putaway_override'),
  ('giam_sat','wms_settings','manage_machine'),
  -- vai quản lý: tham số hệ thống, TIỀN, diễn giải KPI, kênh khách hàng, nhật ký quản trị
  ('quan_ly','wms_settings','manage_unit'), ('quan_ly','wms_settings','manage_machine'),
  ('quan_ly','wms_settings','manage_system'),
  ('quan_ly','warehouse_cost','view'), ('quan_ly','warehouse_cost','edit'),
  ('quan_ly','warehouse_cost','lock'), ('quan_ly','warehouse_cost','manage_item'),
  ('quan_ly','dashboard','kpi_note'),
  ('quan_ly','customers','manage_channel'),
  ('quan_ly','user_admin','audit_log'),
  -- ai sửa được Vị trí kho thì nạp/xuất/in tem vị trí và dựng được bản vẽ
  ('sua_vi_tri','locations','import'), ('sua_vi_tri','locations','export'),
  ('sua_vi_tri','locations','print_label'), ('sua_vi_tri','warehouse_map','edit'),
  -- ai sửa được hồ sơ người dùng thì mở được khoá đăng nhập (ca đêm gõ sai 10 lần là tắc việc)
  ('quan_nhan_su','user_admin','unlock'),
  -- ai tạo được Mã hàng thì nạp được Excel mã hàng
  ('danh_muc_hang','materials','import'),
  -- ai phát hành được lịch phân công thì giao được lệnh fill cho người khác
  ('phan_cong','fill','assign')
), grants AS (
  SELECT c.id, r.module, r.action
    FROM cap c JOIN rules r ON
         (r.rule = 'van_hanh'      AND c.van_hanh)
      OR (r.rule = 'quet_xuat'     AND c.quet_xuat)
      OR (r.rule = 'chung_tu'      AND c.chung_tu)
      OR (r.rule = 'giam_sat'      AND c.giam_sat)
      OR (r.rule = 'quan_ly'       AND c.quan_ly)
      OR (r.rule = 'sua_vi_tri'    AND c.sua_vi_tri)
      OR (r.rule = 'quan_nhan_su'  AND c.quan_nhan_su)
      OR (r.rule = 'danh_muc_hang' AND c.danh_muc_hang)
      OR (r.rule = 'phan_cong'     AND c.phan_cong)
), merged AS (
  SELECT gm.id, gm.module,
         to_jsonb(ARRAY(
           SELECT DISTINCT v FROM (
             SELECT jsonb_array_elements_text(COALESCE(s.mp -> gm.module, '[]'::jsonb)) AS v
             UNION ALL
             SELECT g2.action FROM grants g2 WHERE g2.id = gm.id AND g2.module = gm.module
           ) u ORDER BY v
         )) AS arr
    FROM (SELECT DISTINCT id, module FROM grants) gm
    JOIN src s ON s.id = gm.id
), patched AS (
  SELECT id, jsonb_object_agg(module, arr) AS patch FROM merged GROUP BY id
)
UPDATE public."JobTitle" j
   SET module_permissions = COALESCE(j.module_permissions, '{}'::jsonb) || p.patch,
       updated_at = now()
  FROM patched p
 WHERE p.id = j.id;

COMMIT;
