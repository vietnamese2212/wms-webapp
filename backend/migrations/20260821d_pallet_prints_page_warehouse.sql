-- 21/08/2026 — Lịch sử in tem trả thêm warehouse_id của TỪNG TEM.
--
-- Vì sao: cờ `is_ncc_goods` (đoạn 4 trên tem = NCC hay Máy) từ 21/08 khai RIÊNG được theo từng kho
-- (bảng warehouse_type_configs). Màn In tem in lại theo LỆNH IN, một lệnh có thể gồm tem của nhiều
-- kho ⇒ không thể hỏi cờ "theo kho đang chọn" (màn Lịch sử in không có filter kho). Muốn in đúng
-- nhãn thì mỗi tem phải mang kho của nó.
--
-- Thay đổi DUY NHẤT so bản 20260728h: CTE `t` select thêm p.warehouse_id (to_jsonb tự mang ra rows).
-- Không đổi mệnh đề WHERE, không đổi khóa gom phiếu, không đổi shape các key khác.
CREATE OR REPLACE FUNCTION public.pallet_prints_page(
  p_wh_scope text[], p_cat_scope text[], p_from timestamptz, p_to timestamptz, p_search text,
  p_modes text[], p_materials text[], p_cycles text[], p_machines text[], p_printers text[],
  p_offset integer, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE r jsonb;
BEGIN
  WITH b AS (
    -- Gom NGAY thành PHIẾU IN (đơn vị trang) — không vật hoá tập tem thô.
    -- Khoá phiếu = batch_id; log cũ chưa có batch_id thì gom theo created_at|mode|người in.
    SELECT COALESCE(p.batch_id::text,
                    p.created_at::text || '|' || p.mode || '|' || COALESCE(p.printed_by_name, '')) AS bkey,
           max(p.created_at) AS at, max(p.mode) AS md, count(*) AS n
    FROM "PalletLabelPrint" p
    WHERE (p_from IS NULL OR p.created_at >= p_from)
      AND (p_to   IS NULL OR p.created_at <= p_to)
      -- scope NULL-INCLUSIVE (dòng cũ chưa gắn kho/loại vẫn hiện) — giữ đúng quy ước toàn app
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
      AND (p_modes     IS NULL OR p.mode            = ANY (p_modes))
      AND (p_materials IS NULL OR p.material_code   = ANY (p_materials))
      AND (p_cycles    IS NULL OR p.cycle           = ANY (p_cycles))
      AND (p_machines  IS NULL OR p.machine         = ANY (p_machines))
      AND (p_printers  IS NULL OR p.printed_by_name = ANY (p_printers))
    GROUP BY 1
  ),
  pg AS (SELECT bkey, at FROM b ORDER BY at DESC, bkey OFFSET p_offset LIMIT p_limit),
  -- Khoảng thời gian của ĐÚNG trang này → lấy tem bằng index, không quét bảng lần hai
  w  AS (SELECT min(at) AS lo, max(at) AS hi FROM pg),
  t AS (
    SELECT p.id, p.batch_id, p.qr_code, p.material_code, p.category, p.cycle, p.machine,
           p.seq, p.nmsx, p.qty, p.mode, p.printed_by_name, p.created_at, p.warehouse_id
    FROM "PalletLabelPrint" p, w
    WHERE p.created_at >= w.lo AND p.created_at <= w.hi
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
      AND (p_modes     IS NULL OR p.mode            = ANY (p_modes))
      AND (p_materials IS NULL OR p.material_code   = ANY (p_materials))
      AND (p_cycles    IS NULL OR p.cycle           = ANY (p_cycles))
      AND (p_machines  IS NULL OR p.machine         = ANY (p_machines))
      AND (p_printers  IS NULL OR p.printed_by_name = ANY (p_printers))
      AND COALESCE(p.batch_id::text,
                   p.created_at::text || '|' || p.mode || '|' || COALESCE(p.printed_by_name, ''))
          IN (SELECT bkey FROM pg)
  )
  SELECT jsonb_build_object(
    -- Sắp xếp NGAY trong SQL (mới nhất trước) — backend không phải ghép chunk rồi sort lại
    'rows',       COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC, x.id) FROM t x), '[]'::jsonb),
    'total',      (SELECT count(*) FROM b),                          -- tổng PHIẾU IN khớp lọc
    'total_rows', (SELECT COALESCE(sum(n), 0) FROM b),               -- tổng TEM khớp lọc
    'new_n',      (SELECT count(*) FROM b WHERE md <> 'REPRINT'),
    'reprint_n',  (SELECT count(*) FROM b WHERE md  = 'REPRINT')
  ) INTO r;
  RETURN r;
END $function$;
