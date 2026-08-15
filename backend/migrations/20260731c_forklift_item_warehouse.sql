-- ============================================================================
-- XE NÂNG đợt 2 (31/07/2026) — user chốt sau nghiệm thu đợt 1:
-- 1. HẠNG MỤC CHECK LIST THEO RIÊNG TỪNG KHO: thêm warehouse_id vào
--    forklift_checklist_items. NULL = dùng chung mọi kho (8 dòng seed giữ nguyên
--    là bộ chung); có giá trị = chỉ áp cho xe của kho đó. Check list 1 xe =
--    hạng mục chung + hạng mục riêng kho của xe.
-- 2. LỊCH SỬ PHẢI BIẾT AI CHECK / CHECK LÚC NÀO: RPC forklift_report trả thêm
--    checked_at (= updated_at của log — lần ghi/sửa cuối).
-- ============================================================================

ALTER TABLE public.forklift_checklist_items
  ADD COLUMN IF NOT EXISTS warehouse_id text REFERENCES public."Warehouse"(id);
CREATE INDEX IF NOT EXISTS idx_fci_wh ON public.forklift_checklist_items (warehouse_id);

CREATE OR REPLACE FUNCTION public.forklift_report(
  p_from date, p_to date, p_warehouse_ids text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.log_date DESC, c.code), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT l.id, l.forklift_id, v.code, v.name AS forklift_name, v.warehouse_id,
           l.log_date, l.status, l.hour_meter, l.issue_count, l.checked_by, l.note,
           l.updated_at AS checked_at,
           nxt.hour_meter AS next_meter, nxt.log_date AS next_date,
           CASE WHEN l.status = 'IDLE' THEN 0
                WHEN nxt.hour_meter IS NOT NULL THEN round(nxt.hour_meter - l.hour_meter, 1)
                ELSE NULL END AS hours_run
    FROM public.forklift_daily_logs l
    JOIN public.forklift_vehicles v ON v.id = l.forklift_id
    LEFT JOIN LATERAL (
      SELECT n.hour_meter, n.log_date FROM public.forklift_daily_logs n
      WHERE n.forklift_id = l.forklift_id AND n.log_date > l.log_date AND n.hour_meter IS NOT NULL
      ORDER BY n.log_date LIMIT 1
    ) nxt ON true
    WHERE l.log_date BETWEEN p_from AND p_to
      AND (p_warehouse_ids IS NULL OR v.warehouse_id = ANY(p_warehouse_ids))
  ) c;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.forklift_report(date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forklift_report(date, date, text[]) TO service_role;
