-- ĐIỀU KIỆN BẢO QUẢN — danh mục dùng chung cho HÀNG và XE (user chốt 24/09/2026 chiều:
-- "các điều kiện của tôi là lạnh âm, 2-8 độ, 15-25 độ và thường. Hãy tạo 1 điều kiện bảo quản ở wms setting"
-- + "tốt nhất nên config kho đi và config khớp với xe").
--
-- MÔ HÌNH (một nguồn, không đẻ bảng mới):
--   (1) DANH MỤC = `LookupValue` type='storage_condition' — khai ở Cài đặt WMS → Loại kho, quyền `wms_settings.manage_type`.
--       `meta` = {label, temp_min, temp_max, badge_color} cùng khuôn `freight_surcharge_kind`/`warehouse_type` đang dùng.
--   (2) HÀNG thừa kế theo LOẠI KHO: `LookupValue warehouse_type.meta.storage_condition` (một giá trị).
--       CỐ Ý KHÔNG seed — để trống = CHƯA KHAI = không ràng buộc gì, hành vi y hệt trước migration này. Đoán hộ "FG02 là
--       hàng lạnh" rồi ghi vào master là đúng lớp lỗi app này đã cấm; người khai một lần trên màn, có vết.
--   (3) XE khai PHỤC VỤ ĐƯỢC NHỮNG MỨC NÀO: `vehicle_model.storage_conditions text[]` (rỗng = mọi mức, cùng quy ước
--       `Location.categories` / `serve_categories` đang dùng khắp app).
--   (4) Engine ghép chuyến: mọi điều kiện của hàng trên xe phải NẰM TRONG danh sách xe phục vụ.
--       Giản lược đã biết: xe một khoang khai nhiều mức (xe lạnh đặt được cả âm lẫn mát) vẫn được phép chở lẫn hai mức
--       trong một chuyến. Muốn chặt hơn thì phải mô hình hoá KHOANG — chưa có ca thật, chưa làm.
--
-- Backfill xe theo TÊN dòng xe do chính user gửi (đo 24/09: 60 dòng, tên nói rõ nóng/lạnh/khô/kết hợp):
--   (nóng) · (khô) · "Xe N Pallet" không ghi nhiệt → chỉ THƯỜNG       [xe thùng kín không giữ được nhiệt ở VN]
--   (lạnh)                                        → LẠNH ÂM + 2–8 + 15–25   [máy lạnh đặt được nhiều mức]
--   kết hợp nóng/lạnh                             → cả 4 mức                [nhiều khoang]
-- Sai thì sửa ở Cài đặt TMS → Mã dòng xe (chọn nhiều → "Điều kiện bảo quản").

INSERT INTO public."LookupValue" (type, value, sort_order, meta) VALUES
  ('storage_condition', 'FROZEN',  1, '{"label": "Lạnh âm",   "temp_min": -25, "temp_max": -18, "badge_color": "blue"}'::jsonb),
  ('storage_condition', 'CHILL',   2, '{"label": "2 – 8 °C",  "temp_min": 2,   "temp_max": 8,   "badge_color": "sky"}'::jsonb),
  ('storage_condition', 'COOL',    3, '{"label": "15 – 25 °C","temp_min": 15,  "temp_max": 25,  "badge_color": "amber"}'::jsonb),
  ('storage_condition', 'AMBIENT', 4, '{"label": "Thường",    "temp_min": null,"temp_max": null,"badge_color": "slate"}'::jsonb)
ON CONFLICT (type, value) DO NOTHING;

ALTER TABLE public.vehicle_model ADD COLUMN IF NOT EXISTS storage_conditions text[] NOT NULL DEFAULT '{}';

UPDATE public.vehicle_model SET storage_conditions = CASE
    WHEN temp_mode = 'MIXED' THEN ARRAY['FROZEN','CHILL','COOL','AMBIENT']
    WHEN temp_mode = 'COLD'  THEN ARRAY['FROZEN','CHILL','COOL']
    ELSE ARRAY['AMBIENT']                     -- HOT · DRY · xe pallet không ghi nhiệt
  END
 WHERE storage_conditions = '{}';

DO $$
DECLARE n_cat int; n_col int; n_veh int; n_empty int;
BEGIN
  SELECT count(*) INTO n_cat FROM public."LookupValue" WHERE type = 'storage_condition';
  IF n_cat <> 4 THEN RAISE EXCEPTION 'danh mục điều kiện bảo quản phải có 4 mức, đang có %', n_cat; END IF;
  SELECT count(*) INTO n_col FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'vehicle_model' AND column_name = 'storage_conditions';
  IF n_col <> 1 THEN RAISE EXCEPTION 'thiếu vehicle_model.storage_conditions'; END IF;
  SELECT count(*), count(*) FILTER (WHERE storage_conditions = '{}') INTO n_veh, n_empty FROM public.vehicle_model;
  RAISE NOTICE 'điều kiện bảo quản: 4 mức · % dòng xe đã khai, % dòng còn trống', n_veh - n_empty, n_empty;
  -- Loại kho CỐ Ý còn trống: không gán hộ điều kiện cho hàng.
END $$;
