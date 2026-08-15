-- ============================================================================
-- XE NÂNG đợt 4 (31/07/2026) — user chốt: "Báo cáo vận hành nhìn vào là raw data,
-- đánh giá rất kém" → tab báo cáo thành DASHBOARD. RPC forklift_report đổi shape:
--   cũ: jsonb ARRAY các dòng log
--   mới: jsonb OBJECT { rows: [...], issue_items: [{label, cnt}] }
-- issue_items = TOP 10 hạng mục check bị đánh LỖI nhiều nhất trong khoảng ngày
-- (bóc từ jsonb checklist — cột label đã snapshot nên gom theo label là đúng
-- lịch sử, không lệ thuộc danh mục hiện tại). BE bump cùng commit nên không có
-- cửa sổ lệch shape (staging-only, production nhận cả cụm khi merge).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.forklift_report(
  p_from date, p_to date, p_warehouse_ids text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE v_rows jsonb; v_issues jsonb;
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

  SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.cnt DESC), '[]'::jsonb)
  INTO v_issues
  FROM (
    SELECT c->>'label' AS label, count(*) AS cnt
    FROM public.forklift_daily_logs l
    JOIN public.forklift_vehicles v ON v.id = l.forklift_id,
    LATERAL jsonb_array_elements(l.checklist) c
    WHERE l.log_date BETWEEN p_from AND p_to
      AND (p_warehouse_ids IS NULL OR v.warehouse_id = ANY(p_warehouse_ids))
      AND (c->>'ok') = 'false'
    GROUP BY c->>'label'
    ORDER BY count(*) DESC
    LIMIT 10
  ) i;

  RETURN jsonb_build_object('rows', v_rows, 'issue_items', v_issues);
END $$;

REVOKE ALL ON FUNCTION public.forklift_report(date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forklift_report(date, date, text[]) TO service_role;
