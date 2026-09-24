-- 20260911h — "Nạp từ dữ liệu SAP" GỢI Ý SẴN kho cho từng mã ship-to (đợt 2, §8 của plan)
--
-- Vì sao: đo staging 11/09 — 44/102 mã ship-to chờ nạp CHÍNH LÀ kho đã có trong danh mục Kho
-- (20 khớp mã kho · 24 khớp tên duy nhất · 0 khớp ship-to phụ vì 0/153 kho khai cột đó). Người nạp
-- phải tự nhận ra rồi đi trỏ kho bằng tay 44 lần, mà không trỏ thì `warehouseByShipto` trả null ⇒
-- chuyến tới kho NHÀ bị coi là khách ngoài. Nay RPC trả luôn kho khớp + KHỚP BẰNG GÌ để màn Nạp
-- hiện ra cho người xác nhận — GỢI Ý, không tự áp: cột `match_by` để người đọc còn cân được độ tin.
--
-- Khớp TÊN chỉ nhận khi tên đó là DUY NHẤT trong danh mục Kho (trùng tên nhiều kho ⇒ bỏ, không đoán)
-- — cùng luật với fallback dò tên của `maybeAutoCreateTransferOrder` (chỉ nhận khi đúng 1 kho).
-- Thứ tự ưu tiên: mã kho → ship-to phụ → tên.
--
-- Chữ ký giữ nguyên (p_days int) nên CREATE OR REPLACE chạy được, không phải DROP.

CREATE OR REPLACE FUNCTION public.customer_seed_candidates(p_days int DEFAULT 730)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  WITH erp AS (
    SELECT upper(btrim(e.ship_to_code)) AS ship_to_code,
           (array_agg(e.ship_to_name ORDER BY e.created_at DESC)
              FILTER (WHERE coalesce(btrim(e.ship_to_name), '') <> ''))[1] AS name,
           count(*)                     AS erp_lines,
           max(e.created_at)            AS last_at
      FROM public.erp_outbound_orders e
     WHERE coalesce(btrim(e.ship_to_code), '') <> ''
       AND e.created_at >= now() - make_interval(days => greatest(1, coalesce(p_days, 730)))
     GROUP BY 1
  ),
  trips AS (
    SELECT upper(btrim(g.shipto_party)) AS ship_to_code,
           (array_agg(d.distributor_name ORDER BY g.delivery_date DESC NULLS LAST)
              FILTER (WHERE coalesce(btrim(d.distributor_name), '') <> ''))[1] AS name,
           count(DISTINCT g.id)         AS trips,
           max(g.delivery_date)         AS last_date
      FROM public."GroupDeliveryOrder" g
      LEFT JOIN LATERAL (
        SELECT dd.distributor_name FROM public."OutboundDelivery" dd
         WHERE dd.gdo_id = g.id ORDER BY dd.id LIMIT 1
      ) d ON true
     WHERE coalesce(btrim(g.shipto_party), '') <> ''
       AND g.delivery_date >= (now() - make_interval(days => greatest(1, coalesce(p_days, 730))))::date
     GROUP BY 1
  ),
  merged AS (
    SELECT coalesce(e.ship_to_code, t.ship_to_code) AS ship_to_code,
           coalesce(e.name, t.name, coalesce(e.ship_to_code, t.ship_to_code)) AS name,
           coalesce(e.erp_lines, 0) AS erp_lines,
           coalesce(t.trips, 0)     AS trips,
           greatest(e.last_at::date, t.last_date)   AS last_date
      FROM erp e FULL OUTER JOIN trips t ON t.ship_to_code = e.ship_to_code
  ),
  -- Kho đang hoạt động + khoá so tên đã chuẩn hoá (gộp khoảng trắng, bỏ phân biệt hoa/thường)
  wh AS (
    SELECT w.id, upper(btrim(w.code)) AS code, w.name, w.inventory_mode,
           lower(btrim(regexp_replace(w.name, '\s+', ' ', 'g'))) AS name_key,
           ARRAY(SELECT upper(btrim(s)) FROM unnest(coalesce(w.shipto_codes, '{}'::text[])) s
                  WHERE btrim(s) <> '') AS sc
      FROM public."Warehouse" w
     WHERE coalesce(w.is_active, true)
  ),
  wh_name_uniq AS (SELECT name_key FROM wh GROUP BY name_key HAVING count(*) = 1)
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.trips DESC, x.erp_lines DESC, x.ship_to_code), '[]'::jsonb)
    FROM (
      SELECT m.ship_to_code, m.name, m.erp_lines, m.trips, m.last_date,
             (c.id IS NOT NULL)  AS exists_already,
             c.name              AS current_name,
             c.channel           AS current_channel,
             c.warehouse_id      AS current_warehouse_id,
             s.wh_id, s.wh_code, s.wh_name, s.wh_mode, s.match_by
        FROM merged m
        LEFT JOIN public."Customer" c ON c.ship_to_code = m.ship_to_code
        LEFT JOIN LATERAL (
          SELECT w.id AS wh_id, w.code AS wh_code, w.name AS wh_name,
                 w.inventory_mode AS wh_mode,
                 CASE WHEN w.code = m.ship_to_code     THEN 'CODE'
                      WHEN m.ship_to_code = ANY(w.sc)  THEN 'SHIPTO'
                      ELSE 'NAME' END AS match_by
            FROM wh w
           WHERE w.code = m.ship_to_code
              OR m.ship_to_code = ANY(w.sc)
              OR (w.name_key = lower(btrim(regexp_replace(m.name, '\s+', ' ', 'g')))
                  AND w.name_key IN (SELECT name_key FROM wh_name_uniq))
           ORDER BY CASE WHEN w.code = m.ship_to_code    THEN 1
                         WHEN m.ship_to_code = ANY(w.sc) THEN 2
                         ELSE 3 END
           LIMIT 1
        ) s ON true
       WHERE m.ship_to_code ~ '^[A-Z0-9]+$'
    ) x;
$$;

REVOKE ALL ON FUNCTION public.customer_seed_candidates(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_seed_candidates(int) TO service_role;

COMMENT ON FUNCTION public.customer_seed_candidates(int) IS
  'Ứng viên nạp danh mục Khách hàng (DISTINCT ship-to trong SQL) + GỢI Ý kho khớp (match_by CODE|SHIPTO|NAME, tên phải duy nhất). Gợi ý — màn Nạp cho người xác nhận từng dòng.';
