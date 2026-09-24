-- 20260827f — CHI PHÍ KHO NHÌN THEO "PHIẾU" (user chốt 27/08 vòng 2):
--   "tháng 8 sẽ có 1 kỳ, mở nó ra thì có thể add/edit các khoản chi phí … 1 kho sẽ có chi phí của
--    1 Phiếu … nhưng khi cần xem 1 loại chi phí thì có thể xem được hết tất cả các tháng với filter"
--
-- PHIẾU = (Kho × Kỳ tháng) — KHÔNG thêm bảng: phiếu là NHÓM dẫn xuất của các dòng đã có, và trạng
-- thái chốt vốn đã nằm ở `warehouse_cost_locks` đúng cặp (kho, kỳ). Đẻ thêm bảng "phiếu" chỉ tạo
-- đường cho hai nguồn sự thật lệch nhau (phiếu tồn tại mà không dòng nào, hoặc ngược lại).
--
-- Vì sao RPC chứ không gom nhóm ở backend: danh sách phiếu cần COUNT + SUM + phân trang + tổng
-- trên TOÀN bộ tập lọc. Kéo dòng thô về Node để tự cộng là đúng cái CLAUDE.md cấm ("đừng KÉO DÒNG
-- để tính ra một TẬP"): 153 kho × 9 khoản mục × 12 tháng ≈ 16.5k dòng qua PostgREST cho một bảng
-- 50 dòng. Đếm trong SQL = 1 round-trip, số dòng về bị chặn bởi SỐ PHIẾU của trang.
CREATE OR REPLACE FUNCTION public.warehouse_cost_vouchers(
  p_from         date,
  p_to           date,
  p_wh_ids       text[] DEFAULT NULL,   -- scope kho của user; NULL = không giới hạn (thấy cả chi phí CHUNG)
  p_warehouse_id text   DEFAULT NULL,   -- bộ lọc trên màn: id kho | '__shared__' | NULL = tất cả
  p_search       text   DEFAULT NULL,
  p_page         int    DEFAULT 1,
  p_page_size    int    DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_lim int  := least(200, greatest(10, coalesce(p_page_size, 50)));
  v_off int  := greatest(0, (greatest(1, coalesce(p_page, 1)) - 1) * v_lim);
  v_kw  text := nullif(btrim(coalesce(p_search, '')), '');
BEGIN
  RETURN (
    WITH lab AS (
      SELECT value AS code, coalesce((meta->>'is_labor')::boolean, false) AS is_labor
      FROM public."LookupValue" WHERE type = 'cost_item'
    ),
    src AS (
      SELECT c.warehouse_id, c.period, c.cost_item, c.amount, c.updated_at, c.updated_by
      FROM public.warehouse_costs c
      WHERE c.period BETWEEN p_from AND p_to
        -- Scope kho: người bị giới hạn kho KHÔNG thấy dòng chi phí CHUNG (cùng luật với sổ dòng)
        AND (p_wh_ids IS NULL OR c.warehouse_id = ANY(p_wh_ids))
        AND (p_warehouse_id IS NULL
             OR (p_warehouse_id = '__shared__' AND c.warehouse_id IS NULL)
             OR c.warehouse_id = p_warehouse_id)
    ),
    agg AS (
      SELECT s.warehouse_id, s.period,
             count(*)::int                                          AS lines,
             sum(s.amount)                                          AS amount,
             sum(CASE WHEN l.is_labor THEN s.amount ELSE 0 END)     AS labor,
             max(s.updated_at)                                      AS updated_at
      FROM src s LEFT JOIN lab l ON l.code = s.cost_item
      GROUP BY s.warehouse_id, s.period
    ),
    named AS (
      SELECT a.warehouse_id, a.period, a.lines, a.amount, a.labor, a.updated_at,
             coalesce(w.name, CASE WHEN a.warehouse_id IS NULL
                                   THEN 'Chi phí chung (toàn công ty)' ELSE '(kho đã xoá)' END) AS warehouse_name,
             (SELECT s2.updated_by FROM src s2
               WHERE s2.warehouse_id IS NOT DISTINCT FROM a.warehouse_id AND s2.period = a.period
               ORDER BY s2.updated_at DESC NULLS LAST LIMIT 1)                                  AS updated_by,
             EXISTS (SELECT 1 FROM public.warehouse_cost_locks k
                      WHERE k.period = a.period
                        AND coalesce(k.warehouse_id, '*') = coalesce(a.warehouse_id, '*'))      AS locked
      FROM agg a LEFT JOIN public."Warehouse" w ON w.id = a.warehouse_id
    ),
    filt AS (
      SELECT * FROM named WHERE v_kw IS NULL OR warehouse_name ILIKE '%' || v_kw || '%'
    ),
    page AS (
      SELECT * FROM filt ORDER BY period DESC, warehouse_name LIMIT v_lim OFFSET v_off
    )
    SELECT jsonb_build_object(
      'rows',   coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.period DESC, p.warehouse_name) FROM page p), '[]'::jsonb),
      'total',  (SELECT count(*) FROM filt),
      'totals', (SELECT jsonb_build_object(
                   'amount',   coalesce(sum(amount), 0),
                   'labor',    coalesce(sum(labor), 0),
                   'lines',    coalesce(sum(lines), 0),
                   'vouchers', count(*)
                 ) FROM filt)
    )
  );
END;
$$;

-- Danh sách phiếu lọc theo khoảng kỳ + kho ⇒ index đúng shape của WHERE/GROUP BY
CREATE INDEX IF NOT EXISTS idx_warehouse_costs_period_wh
  ON public.warehouse_costs (period, warehouse_id);
