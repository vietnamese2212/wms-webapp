-- ============================================================================
-- 20261114b — MES: tra tồn ở KHO CHẾ BIẾN cho đường rút "Không có tem" (chọn mã → chọn lô → nhập số)
-- ============================================================================
-- Hỏi DB trả TẬP (DISTINCT / tổng) thay vì kéo dòng tồn về đếm (luật CLAUDE.md "đừng KÉO DÒNG để tính ra một TẬP").
--   p_material NULL  ⇒ danh sách MÃ đang có tồn rút được ở kho (tìm theo mã / tên, ≤ p_limit)
--   p_material có    ⇒ danh sách LÔ của mã đó: (NSX, mã lô tem) · tồn rút được · HSD sớm nhất · số pallet — FEFO trước
-- "Rút được" = cùng luật hàm mes_consume_lot: IN_STOCK/PARTIAL, không QA giữ (qa_is_hold), còn > 0 sau giữ chỗ.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.mes_stock(p_wh text, p_material text DEFAULT NULL, p_search text DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_lim  int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_like text := '%' || like_esc(btrim(coalesce(p_search, ''))) || '%';
  v_out  jsonb;
BEGIN
  IF p_material IS NULL THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'material_code'), '[]'::jsonb) INTO v_out FROM (
      SELECT jsonb_build_object('material_id', m.id, 'material_code', m.material_code, 'material_name', m.short_name,
               'base_unit', m.base_unit, 'entry_unit', m.entry_unit, 'units_per_carton', m.units_per_carton,
               'available', sum(COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0)),
               'lots', count(DISTINCT (e.production_date::date, e.batch))) AS x
        FROM "InventoryEntry" e JOIN "Material" m ON m.id = e.material_id
       WHERE e.warehouse_id = p_wh AND e.status IN ('IN_STOCK', 'PARTIAL') AND NOT qa_is_hold(e.qa_status_id)
         AND COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0) > 0
         AND (btrim(coalesce(p_search, '')) = '' OR m.material_code ILIKE v_like OR m.short_name ILIKE v_like OR m.material_description ILIKE v_like)
       GROUP BY m.id
       ORDER BY m.material_code
       LIMIT v_lim) s;
    RETURN jsonb_build_object('materials', v_out);
  END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'expiry_date') NULLS LAST, (x->>'production_date') NULLS LAST), '[]'::jsonb) INTO v_out FROM (
    SELECT jsonb_build_object('production_date', e.production_date::date, 'batch_lot', e.batch,
             'expiry_date', min(e.expiry_date),
             'available', sum(COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0)),
             'pallets', count(*)) AS x
      FROM "InventoryEntry" e
     WHERE e.warehouse_id = p_wh AND e.material_id = p_material AND e.status IN ('IN_STOCK', 'PARTIAL') AND NOT qa_is_hold(e.qa_status_id)
       AND COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0) > 0
     GROUP BY e.production_date::date, e.batch
     LIMIT 500) s;
  RETURN jsonb_build_object('lots', v_out);
END $$;
REVOKE ALL ON FUNCTION public.mes_stock(text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_stock(text, text, text, integer) TO service_role;

COMMIT;
