-- ============================================================================
-- 20261114c — MES: danh sách MẺ phân trang — dòng + tổng + ô SummaryBand trong MỘT lời gọi
-- ============================================================================
-- Luật số request PostgREST (CLAUDE.md): RPC phân trang trả DÒNG (jsonb), ô tổng gom chung một lời gọi.
-- p: {wh_ids text[] (bắt buộc — đã cắt scope ở BE), status?, qa?, date_from?, date_to?, search?, page, page_size}
-- Mỗi dòng kèm: mã BTP · số dòng NVL đã rút (sống) · số mã NVL · Σ đã nạp bồn · Σ còn trong bồn.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.mes_batch_page(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public
SET plan_cache_mode = force_custom_plan AS $$
DECLARE
  v_wh    text[] := ARRAY(SELECT jsonb_array_elements_text(coalesce(p->'wh_ids', '[]'::jsonb)));
  v_st    text := nullif(p->>'status', '');
  v_qa    text := nullif(p->>'qa', '');
  v_from  date := nullif(p->>'date_from', '')::date;
  v_to    date := nullif(p->>'date_to', '')::date;
  v_q     text := nullif(btrim(coalesce(p->>'search', '')), '');
  v_size  int  := least(greatest(coalesce((p->>'page_size')::int, 100), 1), 1000);
  v_page  int  := greatest(coalesce((p->>'page')::int, 1), 1);
  v_like  text;
  v_rows  jsonb;
  v_sum   jsonb;
BEGIN
  v_like := '%' || like_esc(coalesce(v_q, '')) || '%';
  WITH f AS (
    SELECT b.* FROM production_batch b
     WHERE b.warehouse_id = ANY(v_wh)
       AND (v_from IS NULL OR b.prod_date >= v_from) AND (v_to IS NULL OR b.prod_date <= v_to)
       AND (v_q IS NULL OR b.batch_code ILIKE v_like
            OR EXISTS (SELECT 1 FROM "Material" m WHERE m.id = b.material_id AND (m.material_code ILIKE v_like OR m.short_name ILIKE v_like)))
  )
  SELECT jsonb_build_object(
           'total',     count(*) FILTER (WHERE (v_st IS NULL OR status = v_st) AND (v_qa IS NULL OR qa_status = v_qa)),
           'open',      count(*) FILTER (WHERE status = 'OPEN'),
           'closed',    count(*) FILTER (WHERE status = 'CLOSED'),
           'cancelled', count(*) FILTER (WHERE status = 'CANCELLED'),
           'qa_hold',   count(*) FILTER (WHERE qa_status = 'HOLD' AND status <> 'CANCELLED'),
           'qa_released', count(*) FILTER (WHERE qa_status = 'RELEASED' AND status <> 'CANCELLED'),
           'qa_rejected', count(*) FILTER (WHERE qa_status = 'REJECTED' AND status <> 'CANCELLED'))
    INTO v_sum FROM f;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'prod_date') DESC, r->>'batch_code' DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'id', b.id, 'warehouse_id', b.warehouse_id, 'warehouse_name', w.name, 'batch_code', b.batch_code,
             'material_id', b.material_id, 'material_code', m.material_code, 'material_name', m.short_name, 'base_unit', m.base_unit,
             'machine_code', b.machine_code, 'shift', b.shift, 'prod_date', b.prod_date, 'planned_qty', b.planned_qty,
             'status', b.status, 'qa_status', b.qa_status, 'qa_at', b.qa_at, 'qa_by_name', b.qa_by_name,
             'note', b.note, 'opened_by_name', b.opened_by_name, 'created_at', b.created_at, 'closed_at', b.closed_at,
             'rm_lines', (SELECT count(*) FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL),
             'rm_materials', (SELECT count(DISTINCT c.material_id) FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL),
             'filled', (SELECT COALESCE(sum(mv.qty), 0) FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL'),
             'in_tank', (SELECT COALESCE(sum(l.qty_remaining), 0) FROM tank_lot l WHERE l.batch_id = b.id AND l.status = 'ACTIVE')
           ) AS r
      FROM production_batch b
      JOIN "Warehouse" w ON w.id = b.warehouse_id
      JOIN "Material" m ON m.id = b.material_id
     WHERE b.warehouse_id = ANY(v_wh)
       AND (v_st IS NULL OR b.status = v_st) AND (v_qa IS NULL OR b.qa_status = v_qa)
       AND (v_from IS NULL OR b.prod_date >= v_from) AND (v_to IS NULL OR b.prod_date <= v_to)
       AND (v_q IS NULL OR b.batch_code ILIKE v_like OR m.material_code ILIKE v_like OR m.short_name ILIKE v_like)
     ORDER BY b.prod_date DESC, b.batch_code DESC
     OFFSET (v_page - 1) * v_size LIMIT v_size
  ) s;
  RETURN jsonb_build_object('rows', v_rows, 'summary', v_sum, 'page', v_page, 'page_size', v_size);
END $$;
REVOKE ALL ON FUNCTION public.mes_batch_page(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_batch_page(jsonb) TO service_role;

COMMIT;
