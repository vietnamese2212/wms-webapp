-- In tem pallet · `pallet_prints_page` trả LUÔN CÁC DÒNG (jsonb) thay vì trả danh sách id.
-- Chữ ký (tham số) KHÔNG đổi; chỉ đổi khoá trả về: `ids` → `rows`.
--
-- VÌ SAO (đo thật 28/07, phép đo phân biệt tầng dưới tải 24 luồng ghi):
-- Cái làm trang này gãy KHÔNG phải máy Postgres. Đo song song 3 đường đi cùng một câu CỰC NHẸ:
--     pg trực tiếp (bỏ qua PostgREST)   p50 309ms · p95   338ms   ← máy DB hoàn toàn khoẻ
--     PostgREST trực tiếp               p50 182ms · p95 2.432ms   ← XẾP HÀNG ở đây
--     qua backend                       p50 680ms · p95 5.023ms
-- Đỉnh connection chỉ 24/60, riêng `postgrest` giữ 11 ⇒ nút thắt là **pool ~10 khe NỘI BỘ của
-- PostgREST**, không phải `max_connections`. Mỗi request HTTP tới PostgREST tốn 1 khe và 3 câu SQL
-- (`set_config` + câu thật + `COMMIT`).
--
-- Mà 1 lần mở trang Lịch sử in tem = **11 request PostgREST**: 1 RPC lấy id + **10 lần nạp chunk 300**
-- (100 phiếu × ~30 tem ≈ 3.000 id). Đo: 6.818ms/trang, và dưới tải thì 24.230ms + lỗi 500 thật
-- "canceling statement due to statement timeout".
-- Nay RPC trả thẳng dòng ⇒ **1 request**. Tem đã lọc/gom xong trong DB nên không có gì phải nạp lại.
--
-- Luật rút ra (áp cho mọi RPC phân trang mới): **RPC trả về DÒNG, đừng trả id rồi để backend đi
-- nạp lại** — trả id biến 1 request thành 1 + n/300 request, mỗi request lại chen 1 khe pool.
-- Sắp xếp cũng làm trong SQL luôn (trước đây backend sort lại trong JS sau khi ghép chunk).

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
  -- Khoảng thời gian của ĐÚNG trang này → lấy tem bằng index, không quét bảng lần hai
  w  AS (SELECT min(at) AS lo, max(at) AS hi FROM pg),
  t AS (
    SELECT p.id, p.batch_id, p.qr_code, p.material_code, p.category, p.cycle, p.machine,
           p.seq, p.nmsx, p.qty, p.mode, p.printed_by_name, p.created_at
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
END $$;
