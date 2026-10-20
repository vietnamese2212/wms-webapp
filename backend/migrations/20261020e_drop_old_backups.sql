-- 20/10/2026 — XOÁ BẢNG SAO LƯU CŨ (user 20/10 "ok làm đi"): bản chép tạm trước các đợt đổi dữ liệu 07–09/2026 (đổi base unit, gộp loại
-- kho, chuẩn biển số, sửa trạng thái TmsOrder…), các đợt đó đã nghiệm thu từ lâu; đo staging 20/10 ~23 MB (schema bak_2026072x / bak_20260731
-- 18,9 MB + bảng x_bak_* / x_flip_bak_* 3,8 MB). KHÔNG xoá `x_seed_manifest` — danh sách dòng dữ liệu mẫu, còn dùng để dọn seed.
-- Không phụ thuộc (đo pg_depend 20/10: 0 view / hàm / khoá ngoại trỏ vào). prod-parity bỏ qua bảng x_* nên không lệch schema.
-- Lên production: tuỳ chọn (IF EXISTS — bảng nào không có thì bỏ qua).
BEGIN;

DROP TABLE IF EXISTS
  public.x_bak_20260826_max_materials, public.x_bak_jobtitle_perms_20260912i, public.x_bak_order_dup_20260725,
  public.x_bak_plan_dup_20260725, public.x_bak_tmsorder_decimalfix_20260729, public.x_bak_tmsorder_status_20260907,
  public.x_flip_bak_adjustment_log, public.x_flip_bak_inbound_plan_lines, public.x_flip_bak_inventory_entry,
  public.x_flip_bak_outbound_item, public.x_flip_bak_outbound_scan_entry, public.x_flip_bak_production_import;

DROP SCHEMA IF EXISTS bak_20260727 CASCADE;
DROP SCHEMA IF EXISTS bak_20260727b CASCADE;
DROP SCHEMA IF EXISTS bak_20260727c CASCADE;
DROP SCHEMA IF EXISTS bak_20260731 CASCADE;

COMMIT;
