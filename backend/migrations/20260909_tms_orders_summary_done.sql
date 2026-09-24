-- Ô "Hoàn thành" của Kế hoạch VC đếm NHẦM NGUỒN — luôn ra 0 (phát hiện 09/09 khi rà từng báo cáo).
--
-- TRIỆU CHỨNG: SummaryBand trang Kế hoạch VC hiện `Hoàn thành 0/3.458` trong khi 3.143 lệnh của
-- khoảng đó đang mang `TmsOrder.status='DONE'`. Không lỗi, không cảnh báo — chỉ là số 0 vĩnh viễn.
--
-- NGUYÊN NHÂN: `tms_orders_summary` suy "đã xong" từ TRẠNG THÁI DÒNG XE:
--     done = lệnh có dòng xe VÀ không dòng nào status <> 'DONE'
--   Nhưng KHÔNG đường ghi nào trong app đặt `TmsVehicleSlot.status='DONE'` — đặt lịch chỉ ghi
--   'BOOKED' (vehicleSlotController / outboundController), còn 'ARRIVED'/'DONE' chỉ được ĐỌC trong
--   các gác an toàn. Đo staging 09/09: TmsVehicleSlot chỉ có BOOKED (3.264) và PENDING (230).
--   ⇒ điều kiện "mọi dòng xe = DONE" không bao giờ đúng ⇒ done ≡ 0.
--   Đây đúng lớp lỗi mà `20260907_tmsorder_status_enum.sql` đã cảnh báo trước: "báo cáo lệnh đã
--   hoàn thành đầu tiên sẽ mất số liệu — và mất IM LẶNG".
--
-- SỬA: "Hoàn thành" của Kế hoạch VC = LỆNH đã xong (`TmsOrder.status='DONE'`, do kho nhận xác nhận
--   qua inboundController/completeTransfer) — cùng đơn vị với mẫu số `orders`, đúng nhãn trên màn.
--   Trạng thái DÒNG XE là chuyện đặt lịch, không phải chuyện lệnh xong.
--
-- ÁP: Supabase Dashboard → SQL Editor, chạy nguyên file. STAGING trước, kiểm, rồi mới tới DB thật.
-- Chạy lại nhiều lần vô hại. Chỉ đổi MỘT biểu thức, phần còn lại giữ nguyên bản 20260728.
--
-- Kiểm sau khi chạy (phải khớp nhau):
--   SELECT (tms_orders_summary('2026-07-01','2026-08-31')->>'done')::int AS rpc_done,
--          (SELECT count(*) FROM "TmsOrder"
--            WHERE date BETWEEN '2026-07-01' AND '2026-08-31'
--              AND source_type <> 'TRANSFER' AND status = 'DONE') AS oracle_done;

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
  -- ĐÃ SỬA 09/09: "xong" = trạng thái LỆNH, không suy từ trạng thái dòng xe (không đường ghi nào
  -- đặt TmsVehicleSlot.status='DONE' nên điều kiện cũ luôn sai ⇒ ô này đứng yên ở 0).
  done AS (
    SELECT count(*) AS n FROM f WHERE f.status = 'DONE'
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
