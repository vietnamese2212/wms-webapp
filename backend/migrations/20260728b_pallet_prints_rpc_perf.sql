-- In tem pallet: sửa HIỆU NĂNG 2 RPC phân trang (thay thế bản trong 20260728_pallet_prints_paged_rpc.sql).
-- Giữ NGUYÊN chữ ký + hình dạng trả về — chỉ đổi cách tính.
--
-- ĐO THẬT 28/07 với 250.000 tem (≈3 tháng của kho in ~3.000 tem/ngày):
--   pallet_prints_page   6.674ms  → có lúc 500 "canceling statement due to statement timeout"
--   pallet_prints_facets 9.790ms
--
-- NGUYÊN NHÂN 1 — page: CTE `f` (mọi dòng khớp lọc) bị VẬT HOÁ rồi quét lại 5 lần; EXPLAIN cho
-- `temp read=4700 written=2350` ⇒ ghi ~18MB ra đĩa tạm chỉ để đếm. Sửa: gom thẳng thành cụm
-- phiếu in bằng 1 GROUP BY (kết quả 8.334 dòng, quét lại bao nhiêu lần cũng rẻ), lấy tổng TEM
-- bằng `sum(n)` thay vì đếm lần hai trên `f`, và lấy id của trang qua KHOẢNG created_at của
-- chính trang đó nên dùng được index thay vì quét bảng lần nữa. → 2.823ms, hết ghi temp.
--
-- NGUYÊN NHÂN 2 — facets: 5 lần `jsonb_agg(DISTINCT ...)` = 5 lần SORT toàn bộ dòng khớp lọc
-- (EXPLAIN: `external merge Disk` 2,4MB + 3,4MB + 2MB + 11,5MB + 6MB). Sửa: `GROUP BY GROUPING
-- SETS` — MỘT lượt quét, hash-agg riêng cho từng chiều, trả đúng tập giá trị phân biệt
-- (281kB bộ nhớ, không tràn đĩa). → 668ms, nhanh hơn 14,7 lần.
--
-- Bài học ghi lại: trong RPC phân trang, đừng vật hoá tập dòng thô rồi đếm nhiều lần trên nó —
-- gom về đơn vị hiển thị (cụm/phiếu) TRƯỚC rồi mới đếm. Và cần nhiều tập giá trị phân biệt
-- trong một lượt thì dùng GROUPING SETS, không dùng nhiều agg(DISTINCT).

CREATE OR REPLACE FUNCTION pallet_prints_page(
  p_wh_scope   text[],
  p_cat_scope  text[],
  p_from       timestamptz,
  p_to         timestamptz,
  p_search     text,
  p_modes      text[],
  p_materials  text[],
  p_cycles     text[],
  p_machines   text[],
  p_printers   text[],
  p_offset     int,
  p_limit      int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
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
  -- Khoảng thời gian của ĐÚNG trang này → lấy id tem bằng index, không quét bảng lần hai
  w  AS (SELECT min(at) AS lo, max(at) AS hi FROM pg),
  ids AS (
    SELECT p.id
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
    'ids',        COALESCE((SELECT jsonb_agg(id) FROM ids), '[]'::jsonb),
    'total',      (SELECT count(*) FROM b),                          -- tổng PHIẾU IN khớp lọc
    'total_rows', (SELECT COALESCE(sum(n), 0) FROM b),               -- tổng TEM khớp lọc
    'new_n',      (SELECT count(*) FROM b WHERE md <> 'REPRINT'),
    'reprint_n',  (SELECT count(*) FROM b WHERE md  = 'REPRINT')
  ) INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION pallet_prints_facets(
  p_wh_scope  text[],
  p_cat_scope text[],
  p_from      timestamptz,
  p_to        timestamptz,
  p_search    text
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH g AS (
    -- MỘT lượt quét, 5 hash key — thay 5 lần agg(DISTINCT) (mỗi lần 1 sort tràn đĩa)
    SELECT p.mode, p.material_code, p.cycle, p.machine, p.category, p.printed_by_name,
           grouping(p.mode)            AS g_mode,
           grouping(p.material_code)   AS g_mat,
           grouping(p.cycle)           AS g_cyc,
           grouping(p.machine)         AS g_mac,
           grouping(p.printed_by_name) AS g_prt
    FROM "PalletLabelPrint" p
    WHERE (p_from IS NULL OR p.created_at >= p_from)
      AND (p_to   IS NULL OR p.created_at <= p_to)
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
    GROUP BY GROUPING SETS ((p.mode), (p.material_code), (p.cycle), (p.machine, p.category), (p.printed_by_name))
  )
  SELECT jsonb_build_object(
    'modes',     COALESCE((SELECT jsonb_agg(mode)          FROM g WHERE g_mode = 0 AND mode IS NOT NULL), '[]'::jsonb),
    'materials', COALESCE((SELECT jsonb_agg(material_code) FROM g WHERE g_mat  = 0 AND material_code IS NOT NULL), '[]'::jsonb),
    'cycles',    COALESCE((SELECT jsonb_agg(cycle)         FROM g WHERE g_cyc  = 0 AND cycle IS NOT NULL), '[]'::jsonb),
    -- Máy/NCC: nhãn hiển thị phụ thuộc loại hàng (hàng NCC hiện TÊN NCC) nên trả kèm category
    'machines',  COALESCE((SELECT jsonb_agg(jsonb_build_object('v', machine, 'c', category))
                           FROM g WHERE g_mac = 0 AND machine IS NOT NULL), '[]'::jsonb),
    'printers',  COALESCE((SELECT jsonb_agg(printed_by_name) FROM g WHERE g_prt = 0 AND printed_by_name IS NOT NULL), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;
