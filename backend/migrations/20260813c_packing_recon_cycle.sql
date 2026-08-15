-- 20260813c — tab Sổ pallet cần BỘ LỌC ĐẦY ĐỦ như tab Đóng gói (user 13/08 tối): thêm filter CHU KỲ.
-- Chu kỳ nằm ở TRANG SỔ (packing_runs.cycle) → recon v3 JOIN run của dòng, thêm p_cycle (ilike partial);
-- rows trả kèm run_cycle để FE hiển thị được giá trị đang lọc.
-- ⚠️ Đổi CHỮ KÝ (thêm tham số giữa) ⇒ DROP bản 10 tham số trước — để 2 overload sống chung là
-- PostgREST rpc gọi theo tên sẽ ambiguous / gọi nhầm bản cũ.
DROP FUNCTION IF EXISTS packing_logs_recon(text, text, text[], timestamptz, timestamptz, text, text, text, int, int);

CREATE OR REPLACE FUNCTION packing_logs_recon(
  p_status text DEFAULT NULL, p_wh text DEFAULT NULL, p_scope text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_machine text DEFAULT NULL, p_cycle text DEFAULT NULL,
  p_search text DEFAULT NULL, p_received text DEFAULT NULL,
  p_page int DEFAULT 1, p_size int DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET plan_cache_mode = force_custom_plan AS $$
DECLARE
  v_size int := least(greatest(coalesce(p_size, 200), 1), 500);
  v_off  int := greatest(0, (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_size, 200), 1), 500));
  v_rows jsonb; v_total bigint; v_recv bigint; v_miss bigint; v_diff bigint;
BEGIN
  WITH base AS (
    SELECT l.*, r.cycle AS run_cycle,
           re.created_at AS received_at, re.cartons_imported AS received_qty,
           -- lệch = kho đã nhận + CẢ 2 BÊN có số + khác nhau (sổ chưa khai số thùng thì chưa kết luận)
           (re.created_at IS NOT NULL AND l.qty_cartons IS NOT NULL AND re.cartons_imported IS DISTINCT FROM l.qty_cartons) AS is_qty_diff
      FROM packing_logs l
      LEFT JOIN packing_runs r ON r.id = l.run_id
      LEFT JOIN LATERAL (
        SELECT e.created_at, e.cartons_imported
          FROM "InventoryEntry" e WHERE e.pallet_code = l.pallet_code
         ORDER BY e.created_at LIMIT 1
      ) re ON true
     WHERE (p_status IS NULL OR l.status = p_status)
       AND (p_wh IS NULL OR l.warehouse_id = p_wh)
       AND (p_scope IS NULL OR l.warehouse_id IS NULL OR l.warehouse_id = ANY(p_scope))
       AND (p_from IS NULL OR l.open_scan_at >= p_from)
       AND (p_to IS NULL OR l.open_scan_at < p_to)
       AND (p_machine IS NULL OR l.machine_code = p_machine)
       AND (p_cycle IS NULL OR r.cycle ILIKE '%' || p_cycle || '%')   -- dòng không gắn trang → loại khi lọc chu kỳ
       AND (p_search IS NULL OR l.pallet_code ILIKE '%' || p_search || '%'
            OR l.material_code ILIKE '%' || p_search || '%'
            OR l.packed_by_name ILIKE '%' || p_search || '%')
  ), filt AS (
    SELECT * FROM base
     WHERE p_received IS NULL
        OR (p_received = 'YES'  AND received_at IS NOT NULL)
        OR (p_received = 'NO'   AND received_at IS NULL)
        OR (p_received = 'DIFF' AND is_qty_diff)
  )
  SELECT (SELECT count(*) FROM filt),
         (SELECT count(*) FROM base WHERE received_at IS NOT NULL AND status <> 'CANCELLED'),
         (SELECT count(*) FROM base WHERE received_at IS NULL AND status <> 'CANCELLED'),
         (SELECT count(*) FROM base WHERE is_qty_diff AND status <> 'CANCELLED'),
         (SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
            FROM (SELECT * FROM filt ORDER BY open_scan_at DESC OFFSET v_off LIMIT v_size) f)
    INTO v_total, v_recv, v_miss, v_diff, v_rows;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total,
                            'received_count', v_recv, 'missing_count', v_miss, 'diff_count', v_diff);
END $$;
