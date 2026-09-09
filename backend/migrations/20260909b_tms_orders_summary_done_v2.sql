-- Ô "Hoàn thành" của Kế hoạch VC — BẢN 2 (09/09, sau khi nạp dữ liệu vận hành tháng 9).
--
-- Bản 1 (20260909_tms_orders_summary_done.sql) đã bỏ cách suy từ TmsVehicleSlot.status='DONE'
-- (giá trị KHÔNG đường ghi nào đặt) và đếm TmsOrder.status='DONE'. Đúng cho dữ liệu 07–08/2026
-- nhưng LỘ RA THIẾU ngay khi có dữ liệu đi đúng luồng Kế hoạch xuất: 45/45 xe của 01–09/09 chạy
-- xong, chuyến đã COMPLETED, mà ô vẫn 0/45 — lệnh sinh từ KH xuất giữ nguyên PENDING vì "xong"
-- của nó nằm ở CHUYẾN chứ không ở lệnh.
-- Đo staging 09/09: 3.143 lệnh DONE của 07–08 KHÔNG có chuyến cùng Số xe; 45 lệnh của tháng 9 có
-- chuyến COMPLETED nhưng status PENDING — hai dân số tách bạch, phải cộng cả hai đường.
--
-- ÁP: Supabase Dashboard → SQL Editor, chạy nguyên file. STAGING trước. Chạy lại vô hại.
-- Kiểm sau khi chạy:
--   SELECT (tms_orders_summary('2026-09-01','2026-09-09')->>'done')::int;   -- kỳ vọng 45
--   SELECT (tms_orders_summary('2026-07-01','2026-08-31')->>'done')::int;   -- kỳ vọng 3143

CREATE OR REPLACE FUNCTION public.tms_orders_summary(
  p_date_from date, p_date_to date,
  p_warehouse_id text DEFAULT NULL, p_ncc_user uuid DEFAULT NULL,
  p_categories text[] DEFAULT NULL, p_scope_wh text[] DEFAULT NULL,
  p_directions text[] DEFAULT NULL, p_dvvt uuid[] DEFAULT NULL,
  p_wh_types text[] DEFAULT NULL, p_vehicle_types text[] DEFAULT NULL,
  p_slot_ids uuid[] DEFAULT NULL, p_unbooked boolean DEFAULT false,
  p_search text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result jsonb;
  s text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  WITH base AS (
    SELECT o.id, o.date, o.created_at, o.direction, o.ncc_id, o.warehouse_type, o.vehicle_type,
           o.planned_boxes, o.planned_pallets, o.planned_tons, o.order_code, o.npp_name, o.notes,
           o.status
    FROM "TmsOrder" o
    WHERE o.date >= p_date_from AND o.date <= p_date_to
      AND o.source_type <> 'TRANSFER'
      AND (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
      AND (p_ncc_user     IS NULL OR o.ncc_id       = p_ncc_user)
      AND (p_scope_wh     IS NULL OR o.warehouse_id = ANY (p_scope_wh))
      AND (p_categories   IS NULL OR o.warehouse_type IS NULL OR wt_cats(o.warehouse_type) && p_categories)
  ),
  f AS (
    SELECT b.* FROM base b
    WHERE (p_directions IS NULL OR b.direction      = ANY (p_directions))
      AND (p_dvvt       IS NULL OR b.ncc_id         = ANY (p_dvvt))
      AND (p_wh_types   IS NULL OR wt_cats(b.warehouse_type) && p_wh_types)
      AND (p_vehicle_types IS NULL OR b.vehicle_type = ANY (p_vehicle_types) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s2
            JOIN "TmsVehicleSlot" s3 ON s3.consolidation_group_id = s2.consolidation_group_id
            JOIN base d ON d.id = s3.order_id
            WHERE s2.order_id = b.id AND s2.consolidation_group_id IS NOT NULL
              AND d.vehicle_type = ANY (p_vehicle_types)
              AND (p_directions IS NULL OR d.direction      = ANY (p_directions))
              AND (p_dvvt       IS NULL OR d.ncc_id         = ANY (p_dvvt))
              AND (p_wh_types   IS NULL OR wt_cats(d.warehouse_type) && p_wh_types)))
      AND ((p_slot_ids IS NULL AND NOT p_unbooked) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s2 WHERE s2.order_id = b.id
              AND ((p_unbooked AND s2.slot_id IS NULL)
                OR (p_slot_ids IS NOT NULL AND s2.slot_id = ANY (p_slot_ids)))))
      AND (s IS NULL
           OR unaccent(lower(coalesce(b.order_code, ''))) LIKE unaccent(lower('%' || s || '%'))
           OR unaccent(lower(coalesce(b.npp_name,   ''))) LIKE unaccent(lower('%' || s || '%'))
           OR unaccent(lower(coalesce(b.notes,      ''))) LIKE unaccent(lower('%' || s || '%'))
           OR EXISTS (SELECT 1 FROM "TmsVehicleSlot" s2
                      WHERE s2.order_id = b.id
                        AND unaccent(lower(coalesce(s2.license_plate, ''))) LIKE unaccent(lower('%' || s || '%'))))
  ),
  fslots AS (
    SELECT f.id AS order_id, s2.id AS slot_id, s2.consolidation_group_id, s2.is_consolidation_primary,
           row_number() OVER (PARTITION BY f.id ORDER BY s2.created_at, s2.id) - 1 AS slot_idx,
           (s2.id IS NULL OR s2.consolidation_group_id IS NULL OR s2.is_consolidation_primary) AS numbered
    FROM f LEFT JOIN "TmsVehicleSlot" s2 ON s2.order_id = f.id
  ),
  sec_f AS (
    SELECT DISTINCT s2.order_id
    FROM "TmsVehicleSlot" s2
    JOIN "TmsVehicleSlot" p ON p.consolidation_group_id = s2.consolidation_group_id AND p.is_consolidation_primary
    WHERE s2.consolidation_group_id IS NOT NULL AND NOT s2.is_consolidation_primary AND p.order_id <> s2.order_id
      AND EXISTS (SELECT 1 FROM f x WHERE x.id = s2.order_id)
      AND EXISTS (SELECT 1 FROM f x WHERE x.id = p.order_id)
  ),
  vehicles AS (
    SELECT count(*) AS n FROM (
      SELECT 1 FROM fslots WHERE numbered
      UNION ALL
      SELECT 1 FROM fslots c
      WHERE NOT c.numbered AND c.slot_idx = 0
        AND NOT EXISTS (SELECT 1 FROM fslots c2 WHERE c2.order_id = c.order_id AND c2.numbered)
        AND NOT EXISTS (SELECT 1 FROM sec_f sf WHERE sf.order_id = c.order_id)
    ) x
  ),
  -- "Xong" đến từ HAI ĐƯỜNG KHÁC NHAU trên cùng một trang, phải cộng cả hai:
  --   · lệnh nhập / chuyển kho: kho nhận xác nhận ⇒ chính lệnh mang status='DONE'
  --   · lệnh sinh từ Kế hoạch xuất: việc xong nằm ở CHUYẾN (cùng Số xe) chuyển COMPLETED,
  --     bản thân lệnh vẫn PENDING — không cộng đường này thì mọi xe của luồng KH xuất báo 0.
  done AS (
    SELECT count(*) AS n FROM f
    WHERE f.status = 'DONE'
       OR EXISTS (SELECT 1 FROM "GroupDeliveryOrder" g
                   WHERE g.group_code = f.order_code AND g.status = 'COMPLETED')
  )
  SELECT jsonb_build_object(
    'orders',   (SELECT count(*) FROM f),
    'vehicles', (SELECT n FROM vehicles),
    'boxes',    (SELECT COALESCE(sum(planned_boxes),   0) FROM f),
    'pallets',  (SELECT COALESCE(sum(planned_pallets), 0) FROM f),
    'tons',     (SELECT COALESCE(sum(planned_tons),    0) FROM f),
    'done',     (SELECT n FROM done)
  ) INTO result;
  RETURN result;
END $function$;
