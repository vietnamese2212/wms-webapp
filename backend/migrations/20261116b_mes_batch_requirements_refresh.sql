-- MES 16/11 — SỬA MẺ THÌ BÀN LÀM VIỆC TÍNH LẠI NGUYÊN LIỆU YÊU CẦU (rà module Sản xuất 16/11, lớp C114).
-- Trước đây yêu cầu nguyên liệu (batch_requirement) chỉ chép từ định mức LÚC MỞ MẺ; "Sửa mẻ" đổi kế hoạch hay đổi mã bán thành phẩm
-- thì bàn vẫn giữ số cũ — đổi mã BTP còn để lại nguyên liệu của MÃ CŨ, người cấp theo bàn là cấp sai công thức.
--   • Đổi mã BTP (chỉ được khi mẻ chưa cấp NVL, chưa nạp bồn) ⇒ bỏ hết yêu cầu cũ, chép định mức của mã mới (chưa có định mức ⇒ bàn trống).
--   • Đổi kế hoạch ⇒ mọi dòng yêu cầu nhân theo tỷ lệ kế hoạch mới / cũ (cả dòng người dùng tự thêm — giữ đúng tỷ lệ họ đã khai).
--     Kế hoạch bỏ trống được hiểu là "đúng cỡ mẻ chuẩn của định mức" (như lúc mở mẻ); mã chưa có định mức mà một trong hai số trống ⇒ để nguyên.
--   • Mẻ đã đóng: không tính lại (đóng rồi thì yêu cầu là hồ sơ); riêng đổi mã BTP vẫn bỏ yêu cầu của mã cũ.
BEGIN;

CREATE OR REPLACE FUNCTION public.mes_batch_requirements_refresh(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  b       record;
  v_base  numeric;
  v_old   numeric;
  v_new   numeric;
  v_k     numeric;
  v_n     integer := 0;
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF coalesce((p->>'reset')::boolean, false) THEN
    DELETE FROM batch_requirement WHERE batch_id = b.id;
    IF b.status <> 'OPEN' THEN RETURN jsonb_build_object('mode', 'reset', 'count', 0); END IF;
    RETURN mes_batch_apply_recipe(jsonb_build_object('batch_id', b.id, 'actor_name', p->>'actor_name')) || jsonb_build_object('mode', 'reset');
  END IF;
  IF b.status <> 'OPEN' THEN RETURN jsonb_build_object('mode', 'scale', 'count', 0); END IF;
  SELECT base_qty INTO v_base FROM production_recipe WHERE material_id = b.material_id AND is_active;
  v_old := COALESCE(nullif(p->>'old_planned', '')::numeric, v_base);
  v_new := COALESCE(b.planned_qty, v_base);
  IF v_old IS NULL OR v_new IS NULL OR v_old <= 0 OR v_old = v_new THEN RETURN jsonb_build_object('mode', 'scale', 'count', 0); END IF;
  v_k := v_new / v_old;
  UPDATE batch_requirement SET qty_required = LEAST(GREATEST(round(qty_required * v_k, 3), 0.001), 10000000),
         updated_at = now(), updated_by = p->>'actor_name'
   WHERE batch_id = b.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('mode', 'scale', 'count', v_n, 'factor', v_k);
END $$;

REVOKE ALL ON FUNCTION public.mes_batch_requirements_refresh(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_batch_requirements_refresh(jsonb) TO service_role;

COMMIT;
