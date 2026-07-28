-- Phân trang SERVER cho lưới "Kế hoạch vận chuyển" (TMS Bookings, tab Kế hoạch).
-- Cùng khuôn với Nhập kho (20260727) và Xuất kho (20260728_outbound): 3 hàm dùng CHUNG một mệnh đề lọc
--   tms_orders_page    → ids của trang (+ tổng, + STT xe) — FE dựng lưới rowspan từ đúng các đơn này
--   tms_orders_summary → tổng SummaryBand trên TOÀN BỘ bộ lọc (không phải trang)
--   tms_orders_facets  → option filter (ĐVVT / Loại kho / Loại xe / gợi ý NPP) lấy DISTINCT dưới DB
--
-- ⚠️ BẮT BUỘC plpgsql + plan_cache_mode = force_custom_plan (bài học 27/07): hàm `LANGUAGE sql`
-- bị GENERIC PLAN → ước lượng dòng sai trên CTE → nested loop → chậm hàng trăm lần.
--
-- ĐƠN VỊ PHÂN TRANG = "CỤM" (block), KHÔNG phải dòng:
--   1 cụm = đơn CHỦ + mọi đơn GOM CHUNG XE với nó (consolidation). Lưới merge ô theo cụm (rowspan),
--   nên cụm bị cắt ngang trang là VỠ layout. Trang lấy p_limit CỤM → số đơn/trang xê dịch vài đơn.
--   Footer vẫn đếm theo ĐƠN (page_from/page_to trả về từ đây, FE không tự tính bằng page*pageSize).
--
-- STT xe = số thứ tự xe trong TOÀN phạm vi nền (ngày+kho), KHÔNG đổi khi lọc — nên phải đánh số ở
-- tập BASE (chưa áp filter người dùng) rồi mới cắt về trang. Trước đây FE tính trên toàn bộ đơn đã tải.

-- ── Index cho bộ lọc nền (kho = bằng, ngày = khoảng, sắp xếp theo ngày) ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_tms_order_wh_date_created
  ON "TmsOrder" (warehouse_id, date DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_tms_order_ncc_date
  ON "TmsOrder" (ncc_id, date DESC) WHERE ncc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tms_vslot_order_created
  ON "TmsVehicleSlot" (order_id, created_at, id);

-- ── PAGE ─────────────────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS tms_orders_page(int, int, date, date, text, uuid, text[], text[], text[], uuid[], text[], text[], uuid[], boolean);
DROP FUNCTION IF EXISTS tms_orders_page(int, int, date, date, text, uuid, text[], text[], text[], uuid[], text[], text[], uuid[], boolean, boolean);
CREATE FUNCTION tms_orders_page(
  p_offset        int,                        -- bỏ qua bao nhiêu CỤM
  p_limit         int,                        -- lấy bao nhiêu CỤM
  p_date_from     date,
  p_date_to       date,
  p_warehouse_id  text    DEFAULT NULL,
  p_ncc_user      uuid    DEFAULT NULL,       -- user ĐVVT: chỉ thấy lệnh của công ty mình
  p_categories    text[]  DEFAULT NULL,       -- scope Loại kho (NULL = đủ quyền)
  p_scope_wh      text[]  DEFAULT NULL,       -- scope Kho    (NULL = đủ quyền)
  p_directions    text[]  DEFAULT NULL,       -- lọc Hướng
  p_dvvt          uuid[]  DEFAULT NULL,       -- lọc ĐVVT
  p_wh_types      text[]  DEFAULT NULL,       -- lọc Loại kho
  p_vehicle_types text[]  DEFAULT NULL,       -- lọc Loại xe
  p_slot_ids      uuid[]  DEFAULT NULL,       -- lọc Khung giờ
  p_unbooked      boolean DEFAULT false,      -- lọc Khung giờ = "Chưa đặt"
  p_with_stt      boolean DEFAULT true        -- false + p_limit lớn = chỉ lấy TẬP ID của bộ lọc
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH base AS (   -- PHẠM VI NỀN: ngày + kho + scope. CHƯA áp filter người dùng (STT/facet đọc ở đây).
    SELECT o.id, o.date, o.created_at, o.direction, o.ncc_id, o.warehouse_type, o.vehicle_type
    FROM "TmsOrder" o
    WHERE o.date >= p_date_from AND o.date <= p_date_to
      AND o.source_type <> 'TRANSFER'
      AND (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
      AND (p_ncc_user     IS NULL OR o.ncc_id       = p_ncc_user)
      AND (p_scope_wh     IS NULL OR o.warehouse_id = ANY (p_scope_wh))
      AND (p_categories   IS NULL OR o.warehouse_type IS NULL OR o.warehouse_type = ANY (p_categories))
  ),
  bslots AS (      -- mọi slot của tập nền; đơn CHƯA có xe → 1 dòng ảo (slot_id NULL) để vẫn có STT
    SELECT b.id AS order_id, s.id AS slot_id, s.consolidation_group_id, s.is_consolidation_primary,
           b.date, b.created_at,
           row_number() OVER (PARTITION BY b.id ORDER BY s.created_at, s.id) - 1 AS slot_idx,
           (s.id IS NULL OR s.consolidation_group_id IS NULL OR s.is_consolidation_primary) AS numbered
    FROM base b LEFT JOIN "TmsVehicleSlot" s ON s.order_id = b.id
  ),
  sec_base AS (    -- đơn thứ cấp ĐÃ BỊ KÉO vào cụm của đơn chủ → KHÔNG có dòng xe riêng, KHÔNG có STT
    SELECT DISTINCT s.order_id
    FROM "TmsVehicleSlot" s
    JOIN "TmsVehicleSlot" p ON p.consolidation_group_id = s.consolidation_group_id AND p.is_consolidation_primary
    WHERE s.consolidation_group_id IS NOT NULL AND NOT s.is_consolidation_primary AND p.order_id <> s.order_id
      AND EXISTS (SELECT 1 FROM base b WHERE b.id = s.order_id)
      AND EXISTS (SELECT 1 FROM base b WHERE b.id = p.order_id)
  ),
  pick AS (        -- dòng được đánh STT: xe chính/độc lập; đơn TOÀN xe phụ mà đơn chủ KHÔNG có
                   -- trong tập (mồ côi) → vẫn 1 dòng riêng. Còn nếu đơn chủ có mặt thì đơn này là
                   -- DÒNG CON trong cụm ⇒ không đánh STT (đếm ở đây = đếm thừa xe).
    SELECT * FROM bslots WHERE numbered
    UNION ALL
    SELECT c.* FROM bslots c
    WHERE NOT c.numbered AND c.slot_idx = 0
      AND NOT EXISTS (SELECT 1 FROM bslots c2 WHERE c2.order_id = c.order_id AND c2.numbered)
      AND NOT EXISTS (SELECT 1 FROM sec_base sb WHERE sb.order_id = c.order_id)
  ),
  stt AS (
    SELECT order_id, slot_id,
           row_number() OVER (ORDER BY date DESC, created_at, order_id, slot_idx) AS n
    FROM pick
  ),
  f AS (           -- ÁP FILTER NGƯỜI DÙNG (thứ tự khớp FE: hướng/ĐVVT/loại kho → loại xe → khung giờ)
    SELECT b.* FROM base b
    WHERE (p_directions IS NULL OR b.direction      = ANY (p_directions))
      AND (p_dvvt       IS NULL OR b.ncc_id         = ANY (p_dvvt))
      AND (p_wh_types   IS NULL OR b.warehouse_type = ANY (p_wh_types))
      -- Loại xe: khớp trực tiếp HOẶC đi GOM CHUNG XE với một đơn khớp (giữ nguyên cụm, không xé lẻ)
      AND (p_vehicle_types IS NULL OR b.vehicle_type = ANY (p_vehicle_types) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s
            JOIN "TmsVehicleSlot" s2 ON s2.consolidation_group_id = s.consolidation_group_id
            JOIN base d ON d.id = s2.order_id
            WHERE s.order_id = b.id AND s.consolidation_group_id IS NOT NULL
              AND d.vehicle_type = ANY (p_vehicle_types)
              AND (p_directions IS NULL OR d.direction      = ANY (p_directions))
              AND (p_dvvt       IS NULL OR d.ncc_id         = ANY (p_dvvt))
              AND (p_wh_types   IS NULL OR d.warehouse_type = ANY (p_wh_types))))
      AND ((p_slot_ids IS NULL AND NOT p_unbooked) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s WHERE s.order_id = b.id
              AND ((p_unbooked AND s.slot_id IS NULL)
                OR (p_slot_ids IS NOT NULL AND s.slot_id = ANY (p_slot_ids)))))
  ),
  sec AS (         -- đơn thứ cấp → đơn CHỦ (chỉ khi đơn chủ cũng còn trong tập lọc)
    SELECT DISTINCT ON (s.order_id) s.order_id, p.order_id AS leader_id
    FROM "TmsVehicleSlot" s
    JOIN "TmsVehicleSlot" p ON p.consolidation_group_id = s.consolidation_group_id AND p.is_consolidation_primary
    WHERE s.consolidation_group_id IS NOT NULL AND NOT s.is_consolidation_primary
      AND p.order_id <> s.order_id
      AND EXISTS (SELECT 1 FROM f fs WHERE fs.id = s.order_id)
      AND EXISTS (SELECT 1 FROM f fp WHERE fp.id = p.order_id)
    ORDER BY s.order_id, s.created_at, s.id
  ),
  blk AS (         -- mỗi đơn thuộc ĐÚNG 1 cụm → cụm phân hoạch tập lọc, không đơn nào lọt 2 trang
    SELECT f.id, f.date, f.created_at, COALESCE(sec.leader_id, f.id) AS leader_id
    FROM f LEFT JOIN sec ON sec.order_id = f.id
  ),
  branked AS (
    SELECT b.leader_id, count(*) AS n_orders,
           row_number() OVER (ORDER BY ld.date DESC, ld.created_at, b.leader_id) AS brank
    FROM blk b JOIN f ld ON ld.id = b.leader_id
    GROUP BY b.leader_id, ld.date, ld.created_at
  ),
  win AS (
    SELECT * FROM branked WHERE brank > GREATEST(p_offset, 0) AND brank <= GREATEST(p_offset, 0) + GREATEST(p_limit, 0)
  ),
  page_ids AS (    -- thứ tự hiển thị: cụm theo brank; trong cụm: đơn chủ trước, rồi đơn gom theo thứ tự tự nhiên
    SELECT b.id, w.brank, (CASE WHEN b.id = b.leader_id THEN 0 ELSE 1 END) AS inblk, b.date, b.created_at
    FROM blk b JOIN win w ON w.leader_id = b.leader_id
  )
  SELECT jsonb_build_object(
    'ids',           COALESCE((SELECT jsonb_agg(id ORDER BY brank, inblk, date DESC, created_at, id) FROM page_ids), '[]'::jsonb),
    'total_orders',  (SELECT count(*) FROM f),
    'total_blocks',  (SELECT count(*) FROM branked),
    'page_from',     1 + COALESCE((SELECT sum(n_orders) FROM branked WHERE brank <= GREATEST(p_offset, 0)), 0),
    'page_orders',   (SELECT count(*) FROM page_ids),
    -- STT xe của riêng các đơn trong trang; khoá = "<order_id>/<slot_id>" (slot_id rỗng = đơn chưa có xe)
    'stt',           CASE WHEN p_with_stt THEN
                       COALESCE((SELECT jsonb_object_agg(order_id::text || '/' || COALESCE(slot_id::text, ''), n)
                                 FROM stt WHERE order_id IN (SELECT id FROM page_ids)), '{}'::jsonb)
                     ELSE '{}'::jsonb END
  ) INTO result;
  RETURN result;
END $$;

-- ── SUMMARY ──────────────────────────────────────────────────────────────────────────────────────
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
  p_unbooked      boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH base AS (
    SELECT o.id, o.date, o.created_at, o.direction, o.ncc_id, o.warehouse_type, o.vehicle_type,
           o.planned_boxes, o.planned_pallets, o.planned_tons
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
            SELECT 1 FROM "TmsVehicleSlot" s
            JOIN "TmsVehicleSlot" s2 ON s2.consolidation_group_id = s.consolidation_group_id
            JOIN base d ON d.id = s2.order_id
            WHERE s.order_id = b.id AND s.consolidation_group_id IS NOT NULL
              AND d.vehicle_type = ANY (p_vehicle_types)
              AND (p_directions IS NULL OR d.direction      = ANY (p_directions))
              AND (p_dvvt       IS NULL OR d.ncc_id         = ANY (p_dvvt))
              AND (p_wh_types   IS NULL OR d.warehouse_type = ANY (p_wh_types))))
      AND ((p_slot_ids IS NULL AND NOT p_unbooked) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s WHERE s.order_id = b.id
              AND ((p_unbooked AND s.slot_id IS NULL)
                OR (p_slot_ids IS NOT NULL AND s.slot_id = ANY (p_slot_ids)))))
  ),
  fslots AS (      -- "Xe" = số DÒNG xe chính/độc lập trong tập ĐÃ LỌC (đơn chưa có xe vẫn tính 1 dòng)
    SELECT f.id AS order_id, s.id AS slot_id, s.consolidation_group_id, s.is_consolidation_primary,
           row_number() OVER (PARTITION BY f.id ORDER BY s.created_at, s.id) - 1 AS slot_idx,
           (s.id IS NULL OR s.consolidation_group_id IS NULL OR s.is_consolidation_primary) AS numbered
    FROM f LEFT JOIN "TmsVehicleSlot" s ON s.order_id = f.id
  ),
  sec_f AS (       -- đơn thứ cấp bị kéo vào cụm → là DÒNG CON, không phải 1 xe (xem tms_orders_page)
    SELECT DISTINCT s.order_id
    FROM "TmsVehicleSlot" s
    JOIN "TmsVehicleSlot" p ON p.consolidation_group_id = s.consolidation_group_id AND p.is_consolidation_primary
    WHERE s.consolidation_group_id IS NOT NULL AND NOT s.is_consolidation_primary AND p.order_id <> s.order_id
      AND EXISTS (SELECT 1 FROM f x WHERE x.id = s.order_id)
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
  done AS (        -- đơn hoàn thành = có xe VÀ mọi xe đều DONE
    SELECT count(*) AS n FROM f
    WHERE EXISTS (SELECT 1 FROM "TmsVehicleSlot" s WHERE s.order_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM "TmsVehicleSlot" s WHERE s.order_id = f.id AND s.status <> 'DONE')
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

-- ── FACETS ───────────────────────────────────────────────────────────────────────────────────────
-- Option filter lấy trên PHẠM VI NỀN (ngày+kho+scope) — KHÔNG theo filter đang chọn, để người dùng
-- còn thấy giá trị khác mà đổi (giống Nhập/Xuất kho).
DROP FUNCTION IF EXISTS tms_orders_facets(date, date, text, uuid, text[], text[]);
CREATE FUNCTION tms_orders_facets(
  p_date_from    date,
  p_date_to      date,
  p_warehouse_id text   DEFAULT NULL,
  p_ncc_user     uuid   DEFAULT NULL,
  p_categories   text[] DEFAULT NULL,
  p_scope_wh     text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH base AS (
    SELECT o.ncc_id, o.warehouse_type, o.vehicle_type, o.npp_name
    FROM "TmsOrder" o
    WHERE o.date >= p_date_from AND o.date <= p_date_to
      AND o.source_type <> 'TRANSFER'
      AND (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
      AND (p_ncc_user     IS NULL OR o.ncc_id       = p_ncc_user)
      AND (p_scope_wh     IS NULL OR o.warehouse_id = ANY (p_scope_wh))
      AND (p_categories   IS NULL OR o.warehouse_type IS NULL OR o.warehouse_type = ANY (p_categories))
  )
  SELECT jsonb_build_object(
    'dvvt', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.ncc_id, 'name', x.name) ORDER BY x.name)
                      FROM (SELECT DISTINCT b.ncc_id, tc.name
                            FROM base b JOIN "TransportCompany" tc ON tc.id = b.ncc_id
                            WHERE b.ncc_id IS NOT NULL) x), '[]'::jsonb),
    'wh_types', COALESCE((SELECT jsonb_agg(DISTINCT warehouse_type) FROM base WHERE warehouse_type IS NOT NULL), '[]'::jsonb),
    'vehicle_types', COALESCE((SELECT jsonb_agg(DISTINCT vehicle_type) FROM base WHERE vehicle_type IS NOT NULL), '[]'::jsonb),
    -- gợi ý NPP cho form Thêm/Sửa đơn (trước đây suy từ toàn bộ đơn đã tải về máy) — chặn trần 1.000
    'npp_names', COALESCE((SELECT jsonb_agg(v ORDER BY v) FROM (
                             SELECT DISTINCT npp_name AS v FROM base WHERE npp_name IS NOT NULL AND npp_name <> ''
                             ORDER BY 1 LIMIT 1000) y), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
