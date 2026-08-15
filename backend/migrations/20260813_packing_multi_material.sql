-- 20260813 — SỔ ĐÓNG GÓI: (1) 1 trang sổ ghi NHIỀU MÃ (user 13/08: "1 số loại hàng có 2,3 mã —
-- SX chung 1 chu kỳ và 1 máy → khi mở sổ cho phép nhiều mã chung 1 sổ"); (2) ĐỐI CHIẾU SX ↔ KHO:
-- quét ghi sổ = xác nhận LẦN 1 (SX đã sinh pallet), quét nhập kho = xác nhận LẦN 2 →
-- tra "pallet SX tạo ra mà kho CHƯA nhận" theo pallet_code (khóa khớp 2 bên, đã normalizeQR cả 2 chiều).

-- 1) Cột mảng mã — material_code giữ = mã ĐẦU (hiển thị cũ + unique index cũ vẫn là lưới phụ)
ALTER TABLE packing_runs ADD COLUMN IF NOT EXISTS material_codes text[];
UPDATE packing_runs SET material_codes = ARRAY[material_code] WHERE material_codes IS NULL;

CREATE INDEX IF NOT EXISTS idx_packing_runs_open_codes
  ON packing_runs USING gin (material_codes) WHERE status = 'OPEN';

-- 2) Tra "kho đã nhận pallet chưa" — InventoryEntry chưa có index pallet_code đứng đầu
--    (uq_inventory_active_wh_pallet là (kho, pallet) partial — không phục vụ lookup theo pallet đơn lẻ)
CREATE INDEX IF NOT EXISTS idx_inventory_pallet_code ON "InventoryEntry" (pallet_code);

-- 3) RPC MỞ TRANG SỔ — chống đua overlap mã bằng advisory xact lock per (kho, máy):
--    unique index cũ chỉ bắt trùng mã ĐẦU; 2 trang mã GIAO NHAU (vd [A,B] vs [B]) phải chặn ở đây.
--    Lỗi nghiệp vụ trả qua RAISE với prefix: PACKDUP: → 409 RUN_DUP · PACKOPEN: → 422 (controller bóc).
CREATE OR REPLACE FUNCTION packing_open_run(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_codes   text[] := ARRAY(SELECT DISTINCT upper(trim(x)) FROM jsonb_array_elements_text(p->'material_codes') x WHERE trim(x) <> '');
  v_wh      text   := trim(coalesce(p->>'warehouse_id', ''));
  v_machine text   := upper(trim(coalesce(p->>'machine_code', '')));
  v_dup     text[];
  v_row     packing_runs;
BEGIN
  IF v_wh = '' THEN RAISE EXCEPTION 'PACKOPEN:Chọn Kho / Nhà máy'; END IF;
  IF coalesce(array_length(v_codes, 1), 0) = 0 THEN RAISE EXCEPTION 'PACKOPEN:Chọn Mã sản phẩm'; END IF;
  IF array_length(v_codes, 1) > 10 THEN RAISE EXCEPTION 'PACKOPEN:Tối đa 10 mã / 1 trang sổ'; END IF;
  IF v_machine = '' THEN RAISE EXCEPTION 'PACKOPEN:Nhập Máy'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('packing_open|' || v_wh || '|' || v_machine));

  SELECT array_agg(DISTINCT c) INTO v_dup
    FROM packing_runs r, unnest(r.material_codes) c
   WHERE r.status = 'OPEN' AND r.warehouse_id = v_wh AND r.machine_code = v_machine
     AND c = ANY(v_codes);
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'PACKDUP:Mã % đang có trang sổ MỞ trên máy này — dùng trang đó hoặc bấm Giờ kết thúc trước', array_to_string(v_dup, ', ');
  END IF;

  INSERT INTO packing_runs (id, warehouse_id, run_date, shift, cycle,
      material_code, material_codes, material_id, machine_code, start_at, status,
      opened_by, opened_by_name, note, created_at, updated_at)
  VALUES (gen_random_uuid(), v_wh,
      coalesce(nullif(p->>'run_date', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
      nullif(left(trim(coalesce(p->>'shift', '')), 40), ''),
      nullif(left(trim(coalesce(p->>'cycle', '')), 40), ''),
      v_codes[1], v_codes,
      CASE WHEN coalesce(p->>'material_id', '') ~ '^[0-9a-fA-F-]{36}$' THEN (p->>'material_id')::uuid END,
      left(v_machine, 10),
      coalesce(nullif(p->>'start_at', '')::timestamptz, now()), 'OPEN',
      CASE WHEN coalesce(p->>'opened_by', '') ~ '^[0-9a-fA-F-]{36}$' THEN (p->>'opened_by')::uuid END,
      nullif(p->>'opened_by_name', ''),
      nullif(left(trim(coalesce(p->>'note', '')), 500), ''),
      now(), now())
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

-- 4) RPC TRANG SỔ PALLET + ĐỐI CHIẾU — rows + total + đếm đã/chưa nhận kho CÙNG MỘT WHERE
--    (received = tồn tại InventoryEntry cùng pallet_code — nhập rồi xuất vẫn tính ĐÃ NHẬN;
--     đếm đã/chưa loại dòng CANCELLED — dòng hủy không phải "SX đã tạo ra").
--    plpgsql + force_custom_plan (bẫy generic plan — memory server-pagination-campaign).
CREATE OR REPLACE FUNCTION packing_logs_recon(
  p_status text DEFAULT NULL, p_wh text DEFAULT NULL, p_scope text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_machine text DEFAULT NULL, p_search text DEFAULT NULL, p_received text DEFAULT NULL,
  p_page int DEFAULT 1, p_size int DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET plan_cache_mode = force_custom_plan AS $$
DECLARE
  v_size int := least(greatest(coalesce(p_size, 200), 1), 500);
  v_off  int := greatest(0, (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_size, 200), 1), 500));
  v_rows jsonb; v_total bigint; v_recv bigint; v_miss bigint;
BEGIN
  WITH base AS (
    SELECT l.*,
           (SELECT min(e.created_at) FROM "InventoryEntry" e WHERE e.pallet_code = l.pallet_code) AS received_at
      FROM packing_logs l
     WHERE (p_status IS NULL OR l.status = p_status)
       AND (p_wh IS NULL OR l.warehouse_id = p_wh)
       AND (p_scope IS NULL OR l.warehouse_id IS NULL OR l.warehouse_id = ANY(p_scope))
       AND (p_from IS NULL OR l.open_scan_at >= p_from)
       AND (p_to IS NULL OR l.open_scan_at < p_to)
       AND (p_machine IS NULL OR l.machine_code = p_machine)
       AND (p_search IS NULL OR l.pallet_code ILIKE '%' || p_search || '%'
            OR l.material_code ILIKE '%' || p_search || '%'
            OR l.packed_by_name ILIKE '%' || p_search || '%')
  ), filt AS (
    SELECT * FROM base
     WHERE p_received IS NULL
        OR (p_received = 'YES' AND received_at IS NOT NULL)
        OR (p_received = 'NO'  AND received_at IS NULL)
  )
  SELECT (SELECT count(*) FROM filt),
         (SELECT count(*) FROM base WHERE received_at IS NOT NULL AND status <> 'CANCELLED'),
         (SELECT count(*) FROM base WHERE received_at IS NULL AND status <> 'CANCELLED'),
         (SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
            FROM (SELECT * FROM filt ORDER BY open_scan_at DESC OFFSET v_off LIMIT v_size) f)
    INTO v_total, v_recv, v_miss, v_rows;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total,
                            'received_count', v_recv, 'missing_count', v_miss);
END $$;
