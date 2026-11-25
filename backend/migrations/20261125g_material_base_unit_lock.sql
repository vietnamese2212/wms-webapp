-- Rà soát MES 25/11 (X9, user chốt câu 7): KHOÁ đổi đơn vị gốc (Material.base_unit) khi mã ĐANG được dùng — đổi lúc đó làm mọi số đã ghi
-- theo đơn vị cũ bị đọc theo đơn vị mới (vd bồn đang chứa 500 L thành 500 KG; mẻ đang mở nạp bồn thì vấp MES_UNIT). Áp cho toàn app.
-- "Đang được dùng" = còn tồn kho > 0 · có mẻ đang mở chưa nạp (mã BTP) · nằm trong phiếu của mẻ đang mở chưa nạp (mã NVL) · bồn còn hàng.
-- MỘT hàm cho cả form sửa mã lẫn nạp Excel (materialController). Mã đã hết dùng thì vẫn đổi được (khai nhầm lúc tạo).
BEGIN;

CREATE OR REPLACE FUNCTION public.material_base_unit_in_use(p_ids text[])
RETURNS TABLE(material_id text, reason text)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT DISTINCT ON (x.mid) x.mid, x.reason FROM (
    SELECT e.material_id AS mid, 'còn tồn kho'::text AS reason, 1 AS pri
      FROM "InventoryEntry" e WHERE e.material_id = ANY(p_ids) AND COALESCE(e.cartons_remaining, 0) > 0
    UNION ALL
    SELECT b.material_id, 'có mẻ đang mở chưa nạp bồn', 2
      FROM production_batch b WHERE b.material_id = ANY(p_ids) AND b.status = 'OPEN' AND b.first_filled_at IS NULL
    UNION ALL
    SELECT r.material_id, 'nằm trong phiếu của mẻ đang mở', 3
      FROM batch_requirement r JOIN production_batch b ON b.id = r.batch_id
     WHERE r.material_id = ANY(p_ids) AND r.removed_at IS NULL AND b.status = 'OPEN' AND b.first_filled_at IS NULL
    UNION ALL
    SELECT b.material_id, 'bồn còn hàng của mã này', 4
      FROM tank_lot l JOIN production_batch b ON b.id = l.batch_id
     WHERE b.material_id = ANY(p_ids) AND l.status = 'ACTIVE' AND l.qty_remaining > 0
  ) x ORDER BY x.mid, x.pri
$$;
REVOKE ALL ON FUNCTION public.material_base_unit_in_use(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.material_base_unit_in_use(text[]) TO service_role;

-- tự kiểm: mã còn tồn ⇒ có dòng; mã giả không có gì ⇒ không dòng
DO $$
DECLARE v_mat text; v_n int;
BEGIN
  SELECT material_id INTO v_mat FROM "InventoryEntry" WHERE COALESCE(cartons_remaining, 0) > 0 LIMIT 1;
  IF v_mat IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM material_base_unit_in_use(ARRAY[v_mat]);
    IF v_n <> 1 THEN RAISE EXCEPTION 'material_base_unit_in_use: mã còn tồn phải ra 1 dòng, nhận %', v_n; END IF;
  END IF;
  SELECT count(*) INTO v_n FROM material_base_unit_in_use(ARRAY['__KHONG_CO__']);
  IF v_n <> 0 THEN RAISE EXCEPTION 'material_base_unit_in_use: mã không có phải ra 0 dòng'; END IF;
  RAISE NOTICE 'tự kiểm khoá đổi đơn vị gốc: OK';
END $$;

COMMIT;
