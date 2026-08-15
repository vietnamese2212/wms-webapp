-- 20260805e — fill_orders_page trả thêm VỊ TRÍ LẤY / VỊ TRÍ VỀ gộp per lệnh (user chốt 05/08:
-- "user dùng điện thoại cần thông tin và thao tác Ở VỊ TRÍ NÀO ngay ở view đầu tiên").
-- Card mobile của tab Lệnh fill phải nói được "lấy tại đâu → hạ về đâu" mà không bắt mở chi tiết.
-- Chỉ gộp từ dòng CÒN TREO (việc còn phải làm); jsonb output nên chữ ký KHÔNG đổi → OR REPLACE.

CREATE OR REPLACE FUNCTION fill_orders_page(
  p_wh_scope     text[],
  p_warehouse_id text,
  p_from         date,
  p_to           date,
  p_status       text[],
  p_assignee     text,
  p_search       text,
  p_offset       int,
  p_limit        int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE s text;
BEGIN
  IF p_wh_scope IS NOT NULL AND p_warehouse_id IS NOT NULL
     AND NOT (p_warehouse_id = ANY (p_wh_scope)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0,
                              'pending_n', 0, 'done_n', 0, 'cancelled_n', 0, 'done_qty_entry', 0);
  END IF;
  s := CASE WHEN p_search IS NULL OR btrim(p_search) = '' THEN NULL
            ELSE lower(immutable_unaccent(btrim(p_search))) END;

  RETURN (
    WITH base AS (
      SELECT o.*,
             a.lines_n, a.pending_lines, a.done_lines, a.cancelled_lines,
             a.pallets_req, a.pallets_done, a.qty_req_entry, a.qty_done_entry,
             a.assignees, a.mat_codes, a.mat_names, a.src_hints, a.dest_codes
      FROM "FillOrder" o
      LEFT JOIN LATERAL (
        SELECT count(*)                                        AS lines_n,
               count(*) FILTER (WHERE t.status = 'PENDING')    AS pending_lines,
               count(*) FILTER (WHERE t.status = 'DONE')       AS done_lines,
               count(*) FILTER (WHERE t.status = 'CANCELLED')  AS cancelled_lines,
               COALESCE(sum(t.required_pallets) FILTER (WHERE t.status <> 'CANCELLED'), 0) AS pallets_req,
               COALESCE(sum(t.scanned_pallets), 0)             AS pallets_done,
               COALESCE(sum(qty_entry_decimal(t.qty_base, m.entry_unit, m.units_per_carton))
                          FILTER (WHERE t.status <> 'CANCELLED'), 0) AS qty_req_entry,
               COALESCE(sum(qty_entry_decimal(t.qty_done_base, m.entry_unit, m.units_per_carton)), 0) AS qty_done_entry,
               string_agg(DISTINCT t.assignee_name, ', ')      AS assignees,
               string_agg(DISTINCT t.material_code, ' ')       AS mat_codes,
               string_agg(DISTINCT t.material_name, ' ')       AS mat_names,
               -- việc CÒN PHẢI LÀM đang nằm ở đâu / hạ về đâu (card mobile hiện ngay view đầu)
               string_agg(DISTINCT t.from_location_code, ', ') FILTER (WHERE t.status = 'PENDING') AS src_hints,
               string_agg(DISTINCT t.to_location_code, ', ')   FILTER (WHERE t.status = 'PENDING') AS dest_codes
        FROM "FillTask" t
        LEFT JOIN "Material" m ON m.id = t.material_id
        WHERE t.fill_order_id = o.id
      ) a ON TRUE
      WHERE (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
        AND (p_wh_scope     IS NULL OR o.warehouse_id = ANY (p_wh_scope))
        AND (p_from IS NULL OR o.target_date >= p_from)
        AND (p_to   IS NULL OR o.target_date <= p_to)
        AND (p_assignee IS NULL OR EXISTS (
              SELECT 1 FROM "FillTask" t WHERE t.fill_order_id = o.id AND t.assignee_id = p_assignee))
        AND (s IS NULL OR NOT EXISTS (
              SELECT 1 FROM unnest(string_to_array(s, ' ')) tok
              WHERE tok <> '' AND position(tok IN lower(immutable_unaccent(
                concat_ws(' ', o.order_code, a.mat_codes, a.mat_names, a.assignees)))) = 0))
    ),
    f AS (SELECT * FROM base WHERE (p_status IS NULL OR status = ANY (p_status)))
    SELECT jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY
                 CASE x.status WHEN 'PENDING' THEN 0 WHEN 'DONE' THEN 1 ELSE 2 END,
                 x.target_date DESC, x.created_at DESC)
        FROM (SELECT * FROM f
              ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'DONE' THEN 1 ELSE 2 END,
                       target_date DESC, created_at DESC
              OFFSET GREATEST(p_offset, 0) LIMIT GREATEST(p_limit, 0)) x), '[]'::jsonb),
      'total',          (SELECT count(*) FROM f),
      'pending_n',      (SELECT count(*) FROM base WHERE status = 'PENDING'),
      'done_n',         (SELECT count(*) FROM base WHERE status = 'DONE'),
      'cancelled_n',    (SELECT count(*) FROM base WHERE status = 'CANCELLED'),
      'done_qty_entry', (SELECT COALESCE(sum(qty_done_entry), 0) FROM base)
    )
  );
END $$;
