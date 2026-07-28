-- ═══════════════════════════════════════════════════════════════════════════════
-- PHÂN TRANG SERVER cho list Xuất kho (đợt 2, sau Nhập kho 27/07).
-- Khuôn + bài học: memory server-pagination-campaign.
--
-- ⚠️ BẮT BUỘC plpgsql + SET plan_cache_mode = force_custom_plan — bản LANGUAGE sql bị
-- GENERIC PLAN (không biết giá trị tham số → ước lượng sai → nested loop) chậm hàng trăm lần.
--
-- ⚠️ QUY MÔ (CLAUDE.md: hàng nghìn người, hàng trăm kho, vài triệu dòng/năm) — 2 cách viết
-- ĐÃ THỬ RỒI BỎ vì không chịu được tải, đừng làm lại:
--   (a) Tách mệnh đề lọc ra 1 hàm `outbound_gdo_ids()` dùng chung cho page+summary: gọn code
--       nhưng hàm plpgsql RETURN QUERY **materialize TOÀN BỘ tập id** vào tuplestore và
--       planner không đẩy được LIMIT xuống ⇒ lấy 1 trang vẫn phải dựng cả trăm nghìn id.
--       ⇒ Bắt buộc INLINE mệnh đề lọc vào từng hàm. Đổi lại phải GIỮ 3 BẢN KHỚP NHAU:
--       sửa điều kiện ở hàm này thì sửa cả 2 hàm kia (pager và SummaryBand lệch = số sai).
--   (b) Tìm kiếm bằng cách string_agg mã/tên hàng + NPP của từng chuyến rồi so chuỗi:
--       quét toàn bảng, không index nào đỡ được. ⇒ Node resolve từ khoá thành TẬP ID trước
--       (mirror listOrders của Nhập kho), SQL chỉ còn `group_code ILIKE` OR `id = ANY(ids)`.
--
-- Mirror NGUYÊN VĂN logic FE cũ (Outbound.tsx) + BE listGDOs:
--   · Nhãn trạng thái (gdoStatusInfo): COMPLETED→'Hoàn thành' · IN_PROGRESS→'Đang xuất'
--     · PAUSED→'Tạm dừng' · còn lại có assigned_at→'Giao đơn' · else '—'
--   · export_type của chuyến = item ĐẦU TIÊN (theo id) có khai
--   · Thứ tự: ngày giao DESC → nhóm cùng xe (cổng, else biển số) → export_type DESC →
--     naturalSortCode (số ở CUỐI mã, rồi so chuỗi)
--   · Quy đổi thùng = qtyEntryDecimal per-mã: có entry_unit + units_per_carton>0 → ROUND(v/upc,3)
--   · Pallet (palletsOf): mã pallet-mang-hàng → 0; pallets_estimated>0 → dùng; else thùng quy đổi
--     ÷ Thùng/Pallet HIỆU LỰC THEO KHO (warehouse_pallet_overrides đè cartons_per_pallet)
--   · Scope loại kho NULL-INCLUSIVE (chuyến chưa khai loại vẫn hiện) — KHÁC Nhập kho
-- ═══════════════════════════════════════════════════════════════════════════════

-- ⚠️ Thùng/Pallet theo kho — KHÔNG viết thành hàm gọi per-row.
-- Đã thử `eff_cartons_per_pallet(cpp, overrides, wh)` (mirror utils/palletCalc.ts): thân có
-- subquery nên Postgres KHÔNG inline được → mỗi dòng một lần gọi hàm. Đo 28/07 trên 200k dòng:
-- join 3 bảng + quy đổi thùng = 250ms, thêm hàm này 1 lần/dòng = 1.600ms, 2 lần/dòng = 2.500ms.
-- ⇒ Cách đúng: bung `warehouse_pallet_overrides` MỘT LẦN cho bảng Material (vài nghìn dòng)
-- thành CTE `ov(material_id, warehouse_id, cpp)` rồi LEFT JOIN — xem trong outbound_gdos_summary.
DROP FUNCTION IF EXISTS eff_cartons_per_pallet(numeric, jsonb, text);

-- Nhãn trạng thái hiển thị — mirror gdoStatusInfo (FE)
CREATE OR REPLACE FUNCTION gdo_status_label(p_status text, p_assigned_at timestamp)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_status = 'COMPLETED'   THEN 'Hoàn thành'
    WHEN p_status = 'IN_PROGRESS' THEN 'Đang xuất'
    WHEN p_status = 'PAUSED'      THEN 'Tạm dừng'
    WHEN p_assigned_at IS NOT NULL THEN 'Giao đơn'
    ELSE '—' END;
$$;

-- ── 1 trang id (đúng thứ tự hiển thị) + tổng số chuyến ─────────────────────────
CREATE OR REPLACE FUNCTION outbound_gdos_page(
  p_offset            integer,
  p_limit             integer,
  p_warehouse_ids     text[] DEFAULT NULL,
  p_scope_categories  text[] DEFAULT NULL,
  p_warehouse_types   text[] DEFAULT NULL,
  p_status            text   DEFAULT NULL,
  p_transfer_status   text   DEFAULT NULL,
  p_date_from         date   DEFAULT NULL,
  p_date_to           date   DEFAULT NULL,
  p_export_types      text[] DEFAULT NULL,
  p_dvvts             text[] DEFAULT NULL,
  p_npps              text[] DEFAULT NULL,
  p_material_codes    text[] DEFAULT NULL,
  p_status_labels     text[] DEFAULT NULL,
  p_search            text   DEFAULT NULL,
  p_search_gdo_ids    text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE result jsonb;
BEGIN
  WITH f AS (
    SELECT g.id, g.delivery_date, g.group_code, g.gate_registration_id, g.license_plate
    FROM "GroupDeliveryOrder" g
    WHERE (p_warehouse_ids IS NULL OR g.warehouse_id = ANY (p_warehouse_ids))
      AND (p_scope_categories IS NULL OR g.warehouse_type IS NULL
           OR g.warehouse_type = ANY (p_scope_categories))
      AND (p_warehouse_types  IS NULL OR g.warehouse_type = ANY (p_warehouse_types))
      AND (p_status           IS NULL OR g.status = p_status)
      AND (p_transfer_status  IS NULL OR g.transfer_status = p_transfer_status)
      AND (p_date_from        IS NULL OR g.delivery_date >= p_date_from)
      AND (p_date_to          IS NULL OR g.delivery_date <= p_date_to)
      AND (p_dvvts            IS NULL OR g.dvvt = ANY (p_dvvts))
      AND (p_status_labels    IS NULL OR gdo_status_label(g.status, g.assigned_at) = ANY (p_status_labels))
      AND (p_npps IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d
            WHERE d.gdo_id = g.id AND d.distributor_name = ANY (p_npps)))
      AND (p_export_types IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
            WHERE d.gdo_id = g.id AND i.export_type = ANY (p_export_types)))
      AND (p_material_codes IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
            WHERE d.gdo_id = g.id AND i.material_code_raw = ANY (p_material_codes)))
      AND (p_search IS NULL
           OR g.group_code ILIKE '%' || p_search || '%'
           OR g.id = ANY (COALESCE(p_search_gdo_ids, ARRAY[]::text[])))
  ),
  -- export_type (= item ĐẦU TIÊN theo id có khai) chỉ cần cho SẮP XẾP.
  -- Gom MỘT LƯỢT bằng DISTINCT ON, KHÔNG dùng LATERAL per-row: LATERAL chạy 1 truy vấn con cho
  -- MỖI chuyến khớp lọc (đo 28/07: 50k chuyến → ~0,9s chỉ để lấy khoá sắp xếp).
  et AS (
    SELECT DISTINCT ON (d.gdo_id) d.gdo_id, i.export_type
    FROM f
    JOIN "OutboundDelivery" d ON d.gdo_id = f.id
    JOIN "OutboundItem" i     ON i.do_id  = d.id
    WHERE i.export_type IS NOT NULL
    ORDER BY d.gdo_id, i.id
  ),
  s AS (
    SELECT f.id, f.delivery_date, f.group_code,
           CASE WHEN f.gate_registration_id IS NOT NULL THEN 'gate:' || f.gate_registration_id::text
                WHEN NULLIF(btrim(COALESCE(f.license_plate, '')), '') IS NOT NULL
                  THEN 'plate:' || upper(btrim(f.license_plate))
                ELSE NULL END AS grp,
           et.export_type,
           COALESCE(NULLIF(substring(f.group_code from '(\d+)$'), '')::bigint, 0) AS code_num
    FROM f LEFT JOIN et ON et.gdo_id = f.id
  ),
  -- `count(*) OVER ()` lấy TỔNG trong CÙNG lần quét (window tính trước LIMIT) — trước đây
  -- `(SELECT count(*) FROM f)` riêng khiến CTE f bị tham chiếu 2 lần ⇒ vật chất hoá + quét lại.
  pg AS (
    SELECT id, count(*) OVER () AS total, row_number() OVER (
             ORDER BY delivery_date DESC, (grp IS NULL), COALESCE(grp, ''),
                      COALESCE(export_type, '') DESC, code_num, group_code) AS rn
    FROM s
    ORDER BY delivery_date DESC, (grp IS NULL), COALESCE(grp, ''),
             COALESCE(export_type, '') DESC, code_num, group_code
    LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    -- pg rỗng (trang vượt tầm / không kết quả) → phải đếm lại, nhưng đó là trường hợp hiếm
    'total', COALESCE((SELECT max(total) FROM pg), (SELECT count(*) FROM s)),
    'ids',   COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

-- ── Tổng SummaryBand + bảng "Phân bổ theo NPP" trên TOÀN BỘ kết quả lọc ────────
-- ⚠️ Mệnh đề WHERE dưới đây PHẢI KHỚP TỪNG DÒNG với outbound_gdos_page (xem ghi chú đầu file).
-- p_material_codes vừa LỌC chuyến, vừa thu hẹp breakdown NPP về đúng mã đang lọc (mirror FE).
CREATE OR REPLACE FUNCTION outbound_gdos_summary(
  p_warehouse_ids     text[] DEFAULT NULL,
  p_scope_categories  text[] DEFAULT NULL,
  p_warehouse_types   text[] DEFAULT NULL,
  p_status            text   DEFAULT NULL,
  p_transfer_status   text   DEFAULT NULL,
  p_date_from         date   DEFAULT NULL,
  p_date_to           date   DEFAULT NULL,
  p_export_types      text[] DEFAULT NULL,
  p_dvvts             text[] DEFAULT NULL,
  p_npps              text[] DEFAULT NULL,
  p_material_codes    text[] DEFAULT NULL,
  p_status_labels     text[] DEFAULT NULL,
  p_search            text   DEFAULT NULL,
  p_search_gdo_ids    text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result  jsonb;
  n_items bigint;
  -- Trần AN TOÀN cho phép tính tổng. Căn cứ đo 28/07 (50.000 chuyến / 200.000 dòng hàng):
  -- tính tổng ~800ms, ĐẾM dòng chỉ ~160ms; role `authenticator` của PostgREST có
  -- statement_timeout = 8s CỐ ĐỊNH ⇒ 12 người cùng quét toàn bộ kho × 90 ngày thì 10/24
  -- request bị huỷ → 500 trắng màn.
  -- Trần tính theo SỐ DÒNG HÀNG (không phải số chuyến): chi phí tỉ lệ với dòng hàng, mà mỗi
  -- chuyến có thể 2 hay 50 dòng — đặt trần theo chuyến sẽ vừa chặn oan vừa lọt.
  -- Vượt trần: vẫn trả SỐ CHUYẾN (đếm rẻ) + cờ too_wide để FE hiện "—" kèm hướng dẫn thu hẹp;
  -- KHÔNG tính tổng, KHÔNG để user nhận lỗi. Danh sách vẫn lật trang bình thường.
  -- 150k dòng ≈ 0,6s tính tổng. Đo thật: 1 THÁNG toàn bộ 40 kho = 69k dòng (có tổng, ~0,6s);
  -- 3 THÁNG toàn bộ 40 kho = 200k dòng (vượt trần → hiện số chuyến + hướng dẫn thu hẹp).
  -- Lọc 1 kho thì cả năm vẫn dưới trần ⇒ người vận hành bình thường KHÔNG bao giờ chạm.
  MAX_ITEMS_FOR_TOTALS constant bigint := 150000;
BEGIN
  -- Đếm trước SỐ DÒNG HÀNG (join index-only, ~160ms/200k — rẻ hơn 5 lần so với tính tổng).
  -- KHÔNG dùng count(DISTINCT gd.id): distinct trên bảng join là phép SORT/HASH đắt, chính nó
  -- lại thành nút nghẽn (đo 28/07). Số chuyến khi vượt trần lấy từ `total` của endpoint danh
  -- sách (FE đã có sẵn) — không cần đếm ở đây.
  SELECT count(*) INTO n_items
  FROM "GroupDeliveryOrder" gd
  JOIN "OutboundDelivery" d ON d.gdo_id = gd.id
  JOIN "OutboundItem" i     ON i.do_id  = d.id
  WHERE (p_warehouse_ids IS NULL OR gd.warehouse_id = ANY (p_warehouse_ids))
    AND (p_scope_categories IS NULL OR gd.warehouse_type IS NULL
         OR gd.warehouse_type = ANY (p_scope_categories))
    AND (p_warehouse_types  IS NULL OR gd.warehouse_type = ANY (p_warehouse_types))
    AND (p_status           IS NULL OR gd.status = p_status)
    AND (p_transfer_status  IS NULL OR gd.transfer_status = p_transfer_status)
    AND (p_date_from        IS NULL OR gd.delivery_date >= p_date_from)
    AND (p_date_to          IS NULL OR gd.delivery_date <= p_date_to)
    AND (p_dvvts            IS NULL OR gd.dvvt = ANY (p_dvvts))
    AND (p_status_labels    IS NULL OR gdo_status_label(gd.status, gd.assigned_at) = ANY (p_status_labels))
    AND (p_npps IS NULL OR EXISTS (
          SELECT 1 FROM "OutboundDelivery" d
          WHERE d.gdo_id = gd.id AND d.distributor_name = ANY (p_npps)))
    AND (p_export_types IS NULL OR EXISTS (
          SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
          WHERE d.gdo_id = gd.id AND i.export_type = ANY (p_export_types)))
    AND (p_material_codes IS NULL OR EXISTS (
          SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
          WHERE d.gdo_id = gd.id AND i.material_code_raw = ANY (p_material_codes)))
    AND (p_search IS NULL
         OR gd.group_code ILIKE '%' || p_search || '%'
         OR gd.id = ANY (COALESCE(p_search_gdo_ids, ARRAY[]::text[])));

  IF n_items > MAX_ITEMS_FOR_TOTALS THEN
    RETURN jsonb_build_object(
      'count', NULL, 'completed', NULL,
      'cartons', NULL, 'cartons_noqr', NULL, 'cartons_qr', NULL, 'pallets', NULL,
      'npp_breakdown', '[]'::jsonb,
      'too_wide', true, 'items_scanned', n_items, 'max_items_for_totals', MAX_ITEMS_FOR_TOTALS);
  END IF;

  WITH g AS (
    SELECT gd.id, gd.status, gd.warehouse_id
    FROM "GroupDeliveryOrder" gd
    WHERE (p_warehouse_ids IS NULL OR gd.warehouse_id = ANY (p_warehouse_ids))
      AND (p_scope_categories IS NULL OR gd.warehouse_type IS NULL
           OR gd.warehouse_type = ANY (p_scope_categories))
      AND (p_warehouse_types  IS NULL OR gd.warehouse_type = ANY (p_warehouse_types))
      AND (p_status           IS NULL OR gd.status = p_status)
      AND (p_transfer_status  IS NULL OR gd.transfer_status = p_transfer_status)
      AND (p_date_from        IS NULL OR gd.delivery_date >= p_date_from)
      AND (p_date_to          IS NULL OR gd.delivery_date <= p_date_to)
      AND (p_dvvts            IS NULL OR gd.dvvt = ANY (p_dvvts))
      AND (p_status_labels    IS NULL OR gdo_status_label(gd.status, gd.assigned_at) = ANY (p_status_labels))
      AND (p_npps IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d
            WHERE d.gdo_id = gd.id AND d.distributor_name = ANY (p_npps)))
      AND (p_export_types IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
            WHERE d.gdo_id = gd.id AND i.export_type = ANY (p_export_types)))
      AND (p_material_codes IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
            WHERE d.gdo_id = gd.id AND i.material_code_raw = ANY (p_material_codes)))
      AND (p_search IS NULL
           OR gd.group_code ILIKE '%' || p_search || '%'
           OR gd.id = ANY (COALESCE(p_search_gdo_ids, ARRAY[]::text[])))
  ),
  -- Ngoại lệ Thùng/Pallet theo kho: bung jsonb MỘT LẦN cho bảng mã hàng (vài nghìn dòng),
  -- KHÔNG gọi hàm cho từng dòng hàng (xem ghi chú ở đầu file — chênh 1,6s/200k dòng).
  ov AS (
    SELECT m.id AS material_id, o->>'warehouse_id' AS wh,
           GREATEST((o->>'cartons_per_pallet')::numeric, 0) AS cpp
    FROM "Material" m
    CROSS JOIN LATERAL jsonb_array_elements(m.warehouse_pallet_overrides) o
    WHERE jsonb_typeof(m.warehouse_pallet_overrides) = 'array'
  ),
  -- MỘT lần quét dòng hàng, tính sẵn mọi đại lượng (trước đây 4 subquery quét lại CTE 4 lần).
  it AS (
    SELECT COALESCE(d.distributor_name, '(không tên)') AS npp, i.material_code_raw,
           COALESCE(m.no_qr_tracking, false) AS no_qr,
           CASE WHEN m.entry_unit IS NOT NULL AND btrim(m.entry_unit) <> ''
                     AND COALESCE(m.units_per_carton, 0) > 0
                THEN ROUND(COALESCE(i.cartons_ordered, 0) / m.units_per_carton, 3)
                ELSE COALESCE(i.cartons_ordered, 0) END AS c_ord,
           CASE WHEN m.entry_unit IS NOT NULL AND btrim(m.entry_unit) <> ''
                     AND COALESCE(m.units_per_carton, 0) > 0
                THEN ROUND(COALESCE(i.cartons_scanned, 0) / m.units_per_carton, 3)
                ELSE COALESCE(i.cartons_scanned, 0) END AS c_scan,
           -- palletsOf: mã pallet-mang-hàng → 0 · có pallets_estimated → dùng · else thùng ÷ cpp
           CASE WHEN COALESCE(m.is_pallet_carrier, false) THEN 0
                WHEN COALESCE(i.pallets_estimated, 0) > 0 THEN i.pallets_estimated
                ELSE (CASE WHEN COALESCE(NULLIF(ov.cpp, 0), m.cartons_per_pallet, 0) > 0
                           THEN (CASE WHEN m.entry_unit IS NOT NULL AND btrim(m.entry_unit) <> ''
                                           AND COALESCE(m.units_per_carton, 0) > 0
                                      THEN ROUND(COALESCE(i.cartons_ordered, 0) / m.units_per_carton, 3)
                                      ELSE COALESCE(i.cartons_ordered, 0) END)
                                / COALESCE(NULLIF(ov.cpp, 0), m.cartons_per_pallet, 0)
                           ELSE 0 END)
                END AS pallets
    FROM g
    JOIN "OutboundDelivery" d ON d.gdo_id = g.id
    JOIN "OutboundItem" i     ON i.do_id  = d.id
    LEFT JOIN "Material" m    ON m.id     = i.material_id
    LEFT JOIN ov              ON ov.material_id = i.material_id AND ov.wh = g.warehouse_id
  ),
  -- MỘT lần quét cho CẢ tổng lẫn phân bổ NPP (GROUPING SETS).
  -- Tách 2 truy vấn riêng thì CTE `it` bị tham chiếu 2 lần ⇒ Postgres VẬT CHẤT HOÁ 200k dòng
  -- ra tuplestore rồi đọc lại — đo 28/07: chiếm ~2/3 thời gian (900ms), trong khi bản thân
  -- phép cộng chỉ ~230ms. Gộp lại thì `it` được inline, không materialize.
  -- Dòng GROUPING(npp)=1 là TỔNG; các dòng còn lại là từng NPP.
  -- Cột *_mat = phần khớp p_material_codes (FE cũ: đang lọc mã hàng thì breakdown chỉ tính mã đó).
  rollup AS (
    SELECT GROUPING(npp) AS is_total, npp,
           SUM(c_ord)                                   AS c_ord,
           SUM(c_ord) FILTER (WHERE no_qr)              AS c_noqr,
           SUM(pallets)                                 AS pallets,
           SUM(c_ord)  FILTER (WHERE mat_ok)            AS c_ord_mat,
           SUM(c_scan) FILTER (WHERE mat_ok)            AS c_scan_mat,
           count(*)    FILTER (WHERE mat_ok)            AS n_mat
    FROM (SELECT it.*, (p_material_codes IS NULL OR material_code_raw = ANY (p_material_codes)) AS mat_ok
            FROM it) x
    GROUP BY GROUPING SETS ((npp), ())
  ),
  gagg AS (
    SELECT count(*) AS cnt, count(*) FILTER (WHERE status = 'COMPLETED') AS done FROM g
  )
  SELECT jsonb_build_object(
    'count',         (SELECT cnt  FROM gagg),
    'completed',     (SELECT done FROM gagg),
    'cartons',       COALESCE((SELECT c_ord   FROM rollup WHERE is_total = 1), 0),
    'cartons_noqr',  COALESCE((SELECT c_noqr  FROM rollup WHERE is_total = 1), 0),
    'cartons_qr',    COALESCE((SELECT c_ord - COALESCE(c_noqr, 0) FROM rollup WHERE is_total = 1), 0),
    'pallets',       COALESCE((SELECT pallets FROM rollup WHERE is_total = 1), 0),
    'npp_breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'npp', npp, 'planned', c_ord_mat, 'scanned', c_scan_mat)
                        ORDER BY c_ord_mat DESC, npp)
                        FROM rollup WHERE is_total = 0 AND n_mat > 0), '[]'::jsonb),
    'too_wide', false
  ) INTO result;
  RETURN result;
END;
$$;

-- ── Option filter (Loại xe / ĐVVT / NPP / Mã hàng / Loại kho / Tình trạng) ─────
-- Chỉ nhận filter NỀN (kho + ngày) như khuôn Nhập kho — DISTINCT dưới DB.
CREATE OR REPLACE FUNCTION outbound_gdos_facets(
  p_warehouse_ids     text[] DEFAULT NULL,
  p_scope_categories  text[] DEFAULT NULL,
  p_date_from         date   DEFAULT NULL,
  p_date_to           date   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE result jsonb;
BEGIN
  WITH g AS (
    SELECT gd.id, gd.dvvt, gd.warehouse_type, gd.status, gd.assigned_at
    FROM "GroupDeliveryOrder" gd
    WHERE (p_warehouse_ids IS NULL OR gd.warehouse_id = ANY (p_warehouse_ids))
      AND (p_scope_categories IS NULL OR gd.warehouse_type IS NULL
           OR gd.warehouse_type = ANY (p_scope_categories))
      AND (p_date_from IS NULL OR gd.delivery_date >= p_date_from)
      AND (p_date_to   IS NULL OR gd.delivery_date <= p_date_to)
  ),
  it AS (
    SELECT DISTINCT i.export_type, i.material_code_raw, m.short_name, d.distributor_name
    FROM g
    JOIN "OutboundDelivery" d ON d.gdo_id = g.id
    JOIN "OutboundItem" i     ON i.do_id  = d.id
    LEFT JOIN "Material" m    ON m.id     = i.material_id
  )
  SELECT jsonb_build_object(
    'export_types',    COALESCE((SELECT jsonb_agg(DISTINCT export_type) FROM it WHERE export_type IS NOT NULL AND export_type <> ''), '[]'::jsonb),
    'dvvts',           COALESCE((SELECT jsonb_agg(DISTINCT dvvt) FROM g WHERE dvvt IS NOT NULL AND dvvt <> ''), '[]'::jsonb),
    'warehouse_types', COALESCE((SELECT jsonb_agg(DISTINCT warehouse_type) FROM g WHERE warehouse_type IS NOT NULL AND warehouse_type <> ''), '[]'::jsonb),
    'npps',            COALESCE((SELECT jsonb_agg(DISTINCT distributor_name) FROM it WHERE distributor_name IS NOT NULL AND distributor_name <> ''), '[]'::jsonb),
    'status_labels',   COALESCE((SELECT jsonb_agg(DISTINCT lbl) FROM (
                          SELECT gdo_status_label(status, assigned_at) AS lbl FROM g) s
                          WHERE lbl <> '—'), '[]'::jsonb),
    'materials',       COALESCE((SELECT jsonb_agg(jsonb_build_object('value', material_code_raw,
                          'label', CASE WHEN short_name IS NOT NULL AND short_name <> ''
                                        THEN material_code_raw || ' · ' || short_name
                                        ELSE material_code_raw END) ORDER BY material_code_raw)
                          FROM (SELECT DISTINCT ON (material_code_raw) material_code_raw, short_name
                                  FROM it WHERE material_code_raw IS NOT NULL AND material_code_raw <> ''
                                 ORDER BY material_code_raw, short_name NULLS LAST) mm), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

-- ── Chỉ số hỗ trợ (quy mô: hàng trăm kho × vài triệu dòng/năm) ─────────────────
-- Mọi truy vấn list đều bám (kho, ngày giao); các EXISTS bám khoá ngoại con.
CREATE INDEX IF NOT EXISTS idx_gdo_wh_deliverydate
  ON "GroupDeliveryOrder" (warehouse_id, delivery_date DESC);
CREATE INDEX IF NOT EXISTS idx_gdo_deliverydate
  ON "GroupDeliveryOrder" (delivery_date DESC);
-- Index BAO PHỦ cho đường tính tổng (join GDO→DO→Item rồi cộng): tránh phải đọc lại heap
CREATE INDEX IF NOT EXISTS idx_outbound_delivery_gdo ON "OutboundDelivery" (gdo_id) INCLUDE (distributor_name);
CREATE INDEX IF NOT EXISTS idx_outbound_item_do      ON "OutboundItem" (do_id)
  INCLUDE (material_id, cartons_ordered, cartons_scanned, pallets_estimated);
-- EXISTS lọc theo NPP / mã hàng: index trên cột lọc + khoá join
CREATE INDEX IF NOT EXISTS idx_outbound_delivery_npp ON "OutboundDelivery" (distributor_name, gdo_id);
CREATE INDEX IF NOT EXISTS idx_outbound_item_matcode ON "OutboundItem" (material_code_raw, do_id);
CREATE INDEX IF NOT EXISTS idx_outbound_item_exptype ON "OutboundItem" (export_type, do_id)
  WHERE export_type IS NOT NULL;
