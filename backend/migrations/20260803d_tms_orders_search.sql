-- Ô TÌM NHANH cho lưới "Kế hoạch vận chuyển" (user chốt 03/08) — thêm `p_search` vào CẢ HAI RPC
-- page + summary. Lưới này phân trang SERVER nên KHÔNG được lọc ở client: lọc client chỉ soi 200 dòng
-- của trang đang xem ⇒ gõ mã đơn nằm ở trang 3 sẽ ra "không có dòng nào" (đúng họ bẫy cắt-âm-thầm mà
-- CLAUDE.md cấm). Và search phải vào ĐÚNG tầng `f` (bộ lọc người dùng) của cả 2 hàm, không thì
-- pager và ô tổng SummaryBand đá nhau.
--
-- Phạm vi tìm (những gì user nhìn thấy trên lưới): Mã đơn / Số xe · Tên NPP · Biển số xe · Ghi chú.
-- Bỏ dấu + không phân biệt hoa thường (unaccent — đã có từ migration 20260618).
-- KHÔNG đưa search vào facets: facet là DANH SÁCH LỰA CHỌN của tập nền (giống các filter khác),
-- narrow theo search sẽ làm option nhảy loạn khi đang gõ.

DROP FUNCTION IF EXISTS tms_orders_page(int, int, date, date, text, uuid, text[], text[], text[], uuid[], text[], text[], uuid[], boolean, boolean);
CREATE FUNCTION tms_orders_page(
  p_offset        int,
  p_limit         int,
  p_date_from     date,
  p_date_to       date,
  p_warehouse_id  text    DEFAULT NULL,
  p_ncc_user      uuid    DEFAULT NULL,
  p_categories    text[]  DEFAULT NULL,
  p_scope_wh      text[]  DEFAULT NULL,
  p_directions    text[]  DEFAULT NULL,
  p_dvvt          uuid[]  DEFAULT NULL,
  p_wh_types      text[]  DEFAULT NULL,
  p_vehicle_types text[]  DEFAULT NULL,
  p_slot_ids      uuid[]  DEFAULT NULL,
  p_unbooked      boolean DEFAULT false,
  p_with_stt      boolean DEFAULT true,
  p_search        text    DEFAULT NULL       -- ô tìm nhanh: mã đơn / NPP / biển số / ghi chú
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
  s text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  WITH base AS (
    SELECT o.id, o.date, o.created_at, o.direction, o.ncc_id, o.warehouse_type, o.vehicle_type,
           o.priority, o.order_code, o.npp_name, o.notes
    FROM "TmsOrder" o
    WHERE o.date >= p_date_from AND o.date <= p_date_to
      AND o.source_type <> 'TRANSFER'
      AND (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
      AND (p_ncc_user     IS NULL OR o.ncc_id       = p_ncc_user)
      AND (p_scope_wh     IS NULL OR o.warehouse_id = ANY (p_scope_wh))
      AND (p_categories   IS NULL OR o.warehouse_type IS NULL OR o.warehouse_type = ANY (p_categories))
  ),
  skey AS (
    SELECT b.id, b.date, b.created_at,
           COALESCE(b.priority, false)                             AS pri,
           (CASE WHEN b.direction = 'OUTBOUND' THEN 0 ELSE 1 END)   AS dir_rank,
           b.warehouse_type, b.vehicle_type, nc.name AS dvvt_name, b.order_code
    FROM base b LEFT JOIN "TransportCompany" nc ON nc.id = b.ncc_id
  ),
  bslots AS (
    SELECT b.id AS order_id, s2.id AS slot_id, s2.consolidation_group_id, s2.is_consolidation_primary,
           b.date, b.created_at,
           row_number() OVER (PARTITION BY b.id ORDER BY s2.created_at, s2.id) - 1 AS slot_idx,
           (s2.id IS NULL OR s2.consolidation_group_id IS NULL OR s2.is_consolidation_primary) AS numbered
    FROM base b LEFT JOIN "TmsVehicleSlot" s2 ON s2.order_id = b.id
  ),
  sec_base AS (
    SELECT DISTINCT s2.order_id
    FROM "TmsVehicleSlot" s2
    JOIN "TmsVehicleSlot" p ON p.consolidation_group_id = s2.consolidation_group_id AND p.is_consolidation_primary
    WHERE s2.consolidation_group_id IS NOT NULL AND NOT s2.is_consolidation_primary AND p.order_id <> s2.order_id
      AND EXISTS (SELECT 1 FROM base b WHERE b.id = s2.order_id)
      AND EXISTS (SELECT 1 FROM base b WHERE b.id = p.order_id)
  ),
  pick AS (
    SELECT * FROM bslots WHERE numbered
    UNION ALL
    SELECT c.* FROM bslots c
    WHERE NOT c.numbered AND c.slot_idx = 0
      AND NOT EXISTS (SELECT 1 FROM bslots c2 WHERE c2.order_id = c.order_id AND c2.numbered)
      AND NOT EXISTS (SELECT 1 FROM sec_base sb WHERE sb.order_id = c.order_id)
  ),
  stt AS (
    SELECT p.order_id, p.slot_id,
           row_number() OVER (ORDER BY k.date DESC, k.pri DESC, k.dir_rank,
                                       k.warehouse_type NULLS LAST, k.vehicle_type NULLS LAST,
                                       k.dvvt_name NULLS LAST, k.order_code NULLS LAST,
                                       k.created_at, p.order_id, p.slot_idx) AS n
    FROM pick p JOIN skey k ON k.id = p.order_id
  ),
  f AS (
    SELECT b.* FROM base b
    WHERE (p_directions IS NULL OR b.direction      = ANY (p_directions))
      AND (p_dvvt       IS NULL OR b.ncc_id         = ANY (p_dvvt))
      AND (p_wh_types   IS NULL OR b.warehouse_type = ANY (p_wh_types))
      AND (p_vehicle_types IS NULL OR b.vehicle_type = ANY (p_vehicle_types) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s2
            JOIN "TmsVehicleSlot" s3 ON s3.consolidation_group_id = s2.consolidation_group_id
            JOIN base d ON d.id = s3.order_id
            WHERE s2.order_id = b.id AND s2.consolidation_group_id IS NOT NULL
              AND d.vehicle_type = ANY (p_vehicle_types)
              AND (p_directions IS NULL OR d.direction      = ANY (p_directions))
              AND (p_dvvt       IS NULL OR d.ncc_id         = ANY (p_dvvt))
              AND (p_wh_types   IS NULL OR d.warehouse_type = ANY (p_wh_types))))
      AND ((p_slot_ids IS NULL AND NOT p_unbooked) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s2 WHERE s2.order_id = b.id
              AND ((p_unbooked AND s2.slot_id IS NULL)
                OR (p_slot_ids IS NOT NULL AND s2.slot_id = ANY (p_slot_ids)))))
      -- Ô tìm nhanh (bỏ dấu): mã đơn/Số xe · NPP · ghi chú · biển số của xe thuộc đơn
      AND (s IS NULL
           OR unaccent(lower(coalesce(b.order_code, ''))) LIKE unaccent(lower('%' || s || '%'))
           OR unaccent(lower(coalesce(b.npp_name,   ''))) LIKE unaccent(lower('%' || s || '%'))
           OR unaccent(lower(coalesce(b.notes,      ''))) LIKE unaccent(lower('%' || s || '%'))
           OR EXISTS (SELECT 1 FROM "TmsVehicleSlot" s2
                      WHERE s2.order_id = b.id
                        AND unaccent(lower(coalesce(s2.license_plate, ''))) LIKE unaccent(lower('%' || s || '%'))))
  ),
  sec AS (
    SELECT DISTINCT ON (s2.order_id) s2.order_id, p.order_id AS leader_id
    FROM "TmsVehicleSlot" s2
    JOIN "TmsVehicleSlot" p ON p.consolidation_group_id = s2.consolidation_group_id AND p.is_consolidation_primary
    WHERE s2.consolidation_group_id IS NOT NULL AND NOT s2.is_consolidation_primary
      AND p.order_id <> s2.order_id
      AND EXISTS (SELECT 1 FROM f fs WHERE fs.id = s2.order_id)
      AND EXISTS (SELECT 1 FROM f fp WHERE fp.id = p.order_id)
    ORDER BY s2.order_id, s2.created_at, s2.id
  ),
  blk AS (
    SELECT f.id, f.date, f.created_at, f.order_code, COALESCE(f.priority, false) AS pri,
           COALESCE(sec.leader_id, f.id) AS leader_id
    FROM f LEFT JOIN sec ON sec.order_id = f.id
  ),
  branked AS (
    SELECT b.leader_id, count(*) AS n_orders,
           row_number() OVER (ORDER BY k.date DESC, bool_or(b.pri) DESC, k.dir_rank,
                                       k.warehouse_type NULLS LAST, k.vehicle_type NULLS LAST,
                                       k.dvvt_name NULLS LAST, k.order_code NULLS LAST,
                                       k.created_at, b.leader_id) AS brank
    FROM blk b JOIN skey k ON k.id = b.leader_id
    GROUP BY b.leader_id, k.date, k.dir_rank, k.warehouse_type, k.vehicle_type, k.dvvt_name,
             k.order_code, k.created_at
  ),
  win AS (
    SELECT * FROM branked WHERE brank > GREATEST(p_offset, 0) AND brank <= GREATEST(p_offset, 0) + GREATEST(p_limit, 0)
  ),
  page_ids AS (
    SELECT b.id, w.brank, (CASE WHEN b.id = b.leader_id THEN 0 ELSE 1 END) AS inblk,
           b.order_code, b.created_at
    FROM blk b JOIN win w ON w.leader_id = b.leader_id
  )
  SELECT jsonb_build_object(
    'ids',           COALESCE((SELECT jsonb_agg(id ORDER BY brank, inblk, order_code NULLS LAST, created_at, id) FROM page_ids), '[]'::jsonb),
    'total_orders',  (SELECT count(*) FROM f),
    'total_blocks',  (SELECT count(*) FROM branked),
    'page_from',     1 + COALESCE((SELECT sum(n_orders) FROM branked WHERE brank <= GREATEST(p_offset, 0)), 0),
    'page_orders',   (SELECT count(*) FROM page_ids),
    'stt',           CASE WHEN p_with_stt THEN
                       COALESCE((SELECT jsonb_object_agg(order_id::text || '/' || COALESCE(slot_id::text, ''), n)
                                 FROM stt WHERE order_id IN (SELECT id FROM page_ids)), '{}'::jsonb)
                     ELSE '{}'::jsonb END
  ) INTO result;
  RETURN result;
END $$;

DROP FUNCTION IF EXISTS tms_orders_summary(date, date, text, uuid, text[], text[], text[], uuid[], text[], text[], uuid[], boolean);
CREATE FUNCTION tms_orders_summary(
  p_date_from     date,
  p_date_to       date,
  p_warehouse_id  text    DEFAULT NULL,
  p_ncc_user      uuid    DEFAULT NULL,
  p_categories    text[]  DEFAULT NULL,
  p_scope_wh      text[]  DEFAULT NULL,
  p_directions    text[]  DEFAULT NULL,
  p_dvvt          uuid[]  DEFAULT NULL,
  p_wh_types      text[]  DEFAULT NULL,
  p_vehicle_types text[]  DEFAULT NULL,
  p_slot_ids      uuid[]  DEFAULT NULL,
  p_unbooked      boolean DEFAULT false,
  p_search        text    DEFAULT NULL       -- PHẢI khớp p_search của tms_orders_page, không thì tổng ≠ lưới
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
  s text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  WITH base AS (
    SELECT o.id, o.date, o.created_at, o.direction, o.ncc_id, o.warehouse_type, o.vehicle_type,
           o.planned_boxes, o.planned_pallets, o.planned_tons, o.order_code, o.npp_name, o.notes
    FROM "TmsOrder" o
    WHERE o.date >= p_date_from AND o.date <= p_date_to
      AND o.source_type <> 'TRANSFER'
      AND (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
      AND (p_ncc_user     IS NULL OR o.ncc_id       = p_ncc_user)
      AND (p_scope_wh     IS NULL OR o.warehouse_id = ANY (p_scope_wh))
      AND (p_categories   IS NULL OR o.warehouse_type IS NULL OR o.warehouse_type = ANY (p_categories))
  ),
  f AS (
    SELECT b.* FROM base b
    WHERE (p_directions IS NULL OR b.direction      = ANY (p_directions))
      AND (p_dvvt       IS NULL OR b.ncc_id         = ANY (p_dvvt))
      AND (p_wh_types   IS NULL OR b.warehouse_type = ANY (p_wh_types))
      AND (p_vehicle_types IS NULL OR b.vehicle_type = ANY (p_vehicle_types) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s2
            JOIN "TmsVehicleSlot" s3 ON s3.consolidation_group_id = s2.consolidation_group_id
            JOIN base d ON d.id = s3.order_id
            WHERE s2.order_id = b.id AND s2.consolidation_group_id IS NOT NULL
              AND d.vehicle_type = ANY (p_vehicle_types)
              AND (p_directions IS NULL OR d.direction      = ANY (p_directions))
              AND (p_dvvt       IS NULL OR d.ncc_id         = ANY (p_dvvt))
              AND (p_wh_types   IS NULL OR d.warehouse_type = ANY (p_wh_types))))
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
  done AS (
    SELECT count(*) AS n FROM f
    WHERE EXISTS (SELECT 1 FROM "TmsVehicleSlot" s2 WHERE s2.order_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM "TmsVehicleSlot" s2 WHERE s2.order_id = f.id AND s2.status <> 'DONE')
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
END $$;
