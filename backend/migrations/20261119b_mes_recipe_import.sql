-- 19/11 (b) — NẠP ĐỊNH MỨC TỪ EXCEL (user: "cho tôi việc thêm định mức từ excel").
-- Một file = nhiều công thức; ghi TẤT CẢ hoặc KHÔNG GÌ trong MỘT giao dịch (danh mục: file nửa vời thì phải dọn tay).
-- Mỗi công thức đi qua CHÍNH hàm `mes_recipe_save` của form Định mức ⇒ cùng một luật (tên trùng, mã tự chứa,
-- nguyên liệu khai hai lần, đúng một mặc định / mã…). Controller sắp theo material_id ⇒ hai lượt nạp cùng lúc khoá
-- theo cùng thứ tự (không kẹt chéo); trùng tên do đua ⇒ chỉ mục production_recipe_mat_name_uq chặn, cả lượt huỷ.
-- p: { recipes: [ {id?, material_id, name, base_qty, note, is_active, is_default, lines:[{material_id, qty, tol_pct}]} ], actor_name }
-- Chạy lại được (CREATE OR REPLACE).
BEGIN;

CREATE OR REPLACE FUNCTION public.mes_recipe_import(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r       jsonb;
  v_res   jsonb;
  v_new   integer := 0;
  v_upd   integer := 0;
  v_lines integer := 0;
BEGIN
  IF jsonb_typeof(p->'recipes') <> 'array' OR jsonb_array_length(p->'recipes') = 0 THEN
    RAISE EXCEPTION 'MESERR:QTY|File không có công thức nào';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p->'recipes') LOOP
    v_res := public.mes_recipe_save(r || jsonb_build_object('actor_name', p->>'actor_name'));
    IF nullif(r->>'id', '') IS NULL THEN v_new := v_new + 1; ELSE v_upd := v_upd + 1; END IF;
    v_lines := v_lines + coalesce((v_res->>'lines')::integer, 0);
  END LOOP;
  RETURN jsonb_build_object('created', v_new, 'updated', v_upd, 'lines', v_lines);
END $$;

REVOKE ALL ON FUNCTION public.mes_recipe_import(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_recipe_import(jsonb) TO service_role;

COMMIT;
