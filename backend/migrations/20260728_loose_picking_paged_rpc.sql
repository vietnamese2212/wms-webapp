-- Nhặt lẻ: phân trang SERVER theo CHUYẾN XE + đảo chiều truy vấn.
--
-- HAI VẤN ĐỀ CỦA ĐƯỜNG CŨ:
--  1. Không có trần: controller nạp HẾT GroupDeliveryOrder trong khoảng ngày → HẾT
--     OutboundDelivery → HẾT OutboundItem → HẾT OutboundScanEntry rồi mới lọc `loose_picking > 0`
--     ở tầng thứ ba. Người dùng nới khoảng ngày là fan-out 4 tầng không giới hạn.
--  2. Sai chiều: điều kiện CHỌN LỌC NHẤT (`loose_picking > 0` — rất ít dòng) bị áp CUỐI CÙNG,
--     nên phải kéo về cả nghìn chuyến không liên quan chỉ để bỏ đi.
-- Ở đây lọc item nhặt lẻ TRƯỚC rồi mới join ngược lên chuyến ⇒ tập làm việc nhỏ ngay từ đầu.
--
-- ĐƠN VỊ TRANG = CHUYẾN XE (màn hình gập/mở theo chuyến, không phải theo dòng hàng).
-- Mọi bộ lọc + 4 ô SummaryBand đều ở đây: lọc/đếm ở FE sau khi phân trang = lọc/đếm 1 trang.

-- Quy đổi THÙNG per-mã trước khi cộng cross-mã (luật BASE UNIT: cộng base thô rồi gắn nhãn
-- "thùng" là thổi tổng — mỗi mã một hệ số units_per_carton). Mirror utils/qtyUnits.qtyEntryDecimal.
CREATE OR REPLACE FUNCTION qty_entry_decimal(p_qty numeric, p_entry_unit text, p_upc numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN p_entry_unit IS NULL OR p_entry_unit = '' OR COALESCE(p_upc, 0) <= 0 THEN COALESCE(p_qty, 0)
           ELSE round(COALESCE(p_qty, 0) / p_upc, 3)
         END
$$;

CREATE OR REPLACE FUNCTION loose_picking_page(
  p_wh_scope     text[],   -- kho được giao (null = NATIONAL)
  p_cat_scope    text[],   -- loại hàng được phép (null-inclusive)
  p_warehouse_id text,     -- kho người dùng chọn ở thanh lọc
  p_from         date,
  p_to           date,
  p_wh_types     text[],
  p_export_types text[],
  p_dvvts        text[],
  p_npps         text[],
  p_search       text,
  p_offset       int,
  p_limit        int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb; s text;
BEGIN
  s := CASE WHEN p_search IS NULL OR btrim(p_search) = '' THEN NULL
            ELSE lower(immutable_unaccent(btrim(p_search))) END;

  RETURN (
    WITH it AS (   -- ① lọc chọn-lọc-nhất TRƯỚC: chỉ dòng hàng CÓ nhặt lẻ
      SELECT i.id, i.do_id, i.material_id, i.material_code_raw,
             i.cartons_ordered, i.cartons_scanned, i.loose_picking, i.export_type
      FROM "OutboundItem" i
      WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
    ),
    j AS (         -- ② join ngược lên chuyến, áp scope + khoảng ngày
      SELECT it.*, d.gdo_id, d.distributor_name,
             g.group_code, g.dvvt, g.warehouse_type, g.delivery_date,
             m.entry_unit, m.units_per_carton, m.short_name, m.material_code,
             COALESCE(ls.done, 0) AS loose_scanned
      FROM it
      JOIN "OutboundDelivery"    d ON d.id = it.do_id
      JOIN "GroupDeliveryOrder"  g ON g.id = d.gdo_id AND g.status <> 'CANCELLED'
      LEFT JOIN "Material"       m ON m.id = it.material_id
      LEFT JOIN LATERAL (
        SELECT sum(se.cartons_scanned) AS done
        FROM "OutboundScanEntry" se
        WHERE se.item_id = it.id AND se.is_loose_picking
      ) ls ON TRUE
      WHERE (p_from IS NULL OR g.delivery_date >= p_from)
        AND (p_to   IS NULL OR g.delivery_date <= p_to)
        AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
        AND (p_wh_scope  IS NULL OR g.warehouse_id = ANY (p_wh_scope))
        -- loại hàng NULL-INCLUSIVE (chuyến chưa khai loại vẫn hiện) — quy ước chung toàn app
        AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR g.warehouse_type = ANY (p_cat_scope))
    ),
    st AS (        -- ③ công thức nhặt lẻ per dòng (mirror itemLooseStats ở FE)
      SELECT j.*,
             GREATEST(0, loose_picking
                         - GREATEST(0, (cartons_scanned - loose_scanned)
                                       - (cartons_ordered - loose_picking))) AS effective
      FROM j
    ),
    st2 AS (
      SELECT st.*, LEAST(loose_scanned, effective) AS done FROM st
    ),
    gg AS (        -- ④ gom theo CHUYẾN + cộng THÙNG đã quy đổi per-mã
      SELECT gdo_id,
             max(group_code)     AS group_code,
             max(delivery_date)  AS delivery_date,
             count(*)            AS items_n,
             count(*) FILTER (WHERE effective - done > 0) AS pending_n,
             sum(qty_entry_decimal(effective, entry_unit, units_per_carton)) AS loose_total,
             sum(qty_entry_decimal(done,      entry_unit, units_per_carton)) AS loose_done,
             max(export_type)    AS export_type,
             max(dvvt)           AS dvvt,
             max(warehouse_type) AS warehouse_type,
             array_agg(DISTINCT distributor_name) FILTER (WHERE distributor_name IS NOT NULL) AS npps,
             lower(immutable_unaccent(
               concat_ws(' ', max(group_code), max(export_type), max(dvvt),
                              string_agg(DISTINCT distributor_name, ' '),
                              string_agg(DISTINCT COALESCE(material_code, material_code_raw), ' '),
                              string_agg(DISTINCT short_name, ' ')))) AS hay
      FROM st2 GROUP BY gdo_id
    ),
    f AS (         -- ⑤ bộ lọc người dùng — áp ở mức CHUYẾN (đúng như bảng đang hiển thị)
      SELECT * FROM gg
      WHERE (p_wh_types     IS NULL OR warehouse_type = ANY (p_wh_types))
        AND (p_export_types IS NULL OR export_type    = ANY (p_export_types))
        AND (p_dvvts        IS NULL OR dvvt           = ANY (p_dvvts))
        AND (p_npps         IS NULL OR npps && p_npps)
        -- tìm kiếm: MỌI từ khoá phải khớp (mirror omniMatch ở FE), bỏ dấu 2 phía
        AND (s IS NULL OR NOT EXISTS (
              SELECT 1 FROM unnest(string_to_array(s, ' ')) t
              WHERE t <> '' AND position(t IN hay) = 0))
    ),
    pg AS (
      SELECT gdo_id FROM f ORDER BY delivery_date, group_code, gdo_id OFFSET p_offset LIMIT p_limit
    )
    SELECT jsonb_build_object(
      'gdo_ids',     COALESCE((SELECT jsonb_agg(gdo_id) FROM pg), '[]'::jsonb),
      'total',       (SELECT count(*)                FROM f),   -- số CHUYẾN khớp lọc
      'items_n',     (SELECT COALESCE(sum(items_n), 0)     FROM f),
      'pending_n',   (SELECT COALESCE(sum(pending_n), 0)   FROM f),
      'loose_total', (SELECT COALESCE(sum(loose_total), 0)  FROM f),
      'loose_done',  (SELECT COALESCE(sum(loose_done), 0)   FROM f)
    )
  );
END $$;

-- Ô chọn bộ lọc: lấy trên phạm vi NGÀY + KHO (không phụ thuộc các filter khác) — giống hệt
-- đường cũ dựng option từ tập `grouped` trước khi lọc client.
CREATE OR REPLACE FUNCTION loose_picking_facets(
  p_wh_scope     text[],
  p_cat_scope    text[],
  p_warehouse_id text,
  p_from         date,
  p_to           date
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
BEGIN
  RETURN (
    WITH j AS (
      SELECT DISTINCT g.id, i.export_type, g.dvvt, g.warehouse_type, d.distributor_name
      FROM "OutboundItem" i
      JOIN "OutboundDelivery"   d ON d.id = i.do_id
      JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id AND g.status <> 'CANCELLED'
      WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
        AND (p_from IS NULL OR g.delivery_date >= p_from)
        AND (p_to   IS NULL OR g.delivery_date <= p_to)
        AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
        AND (p_wh_scope  IS NULL OR g.warehouse_id = ANY (p_wh_scope))
        AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR g.warehouse_type = ANY (p_cat_scope))
    )
    SELECT jsonb_build_object(
      'dvvts',        COALESCE((SELECT jsonb_agg(DISTINCT dvvt)             FROM j WHERE dvvt IS NOT NULL), '[]'::jsonb),
      'npps',         COALESCE((SELECT jsonb_agg(DISTINCT distributor_name) FROM j WHERE distributor_name IS NOT NULL), '[]'::jsonb),
      'wh_types',     COALESCE((SELECT jsonb_agg(DISTINCT warehouse_type)   FROM j WHERE warehouse_type IS NOT NULL), '[]'::jsonb),
      'export_types', COALESCE((SELECT jsonb_agg(DISTINCT export_type)      FROM j WHERE export_type IS NOT NULL), '[]'::jsonb)
    )
  );
END $$;

-- Vào bảng theo đúng chiều mới: item nhặt lẻ (rất ít dòng) → chuyến
CREATE INDEX IF NOT EXISTS idx_outbound_item_loose
  ON "OutboundItem" (do_id) WHERE loose_picking > 0 AND status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_scan_entry_loose_item
  ON "OutboundScanEntry" (item_id) WHERE is_loose_picking;
