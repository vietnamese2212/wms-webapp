-- TRUNG TÂM CẢNH BÁO (Đợt 2 roadmap 06/08) — bảng trạng thái cảnh báo + RPC prefilter cận date.
--
-- Kiến trúc HYBRID: điều kiện cảnh báo TÍNH SỐNG mỗi lượt quét (backend alertScanner — không có
-- bảng rule), bảng `alert_events` CHỈ giữ vòng đời để (a) biết cảnh báo nào MỚI mà bắn Web Push,
-- (b) user Ack (đã biết) — cảnh báo TỰ ĐÓNG (resolved_at) khi điều kiện hết, không bắt ai bấm.
-- dedup_key = khóa nghiệp vụ của cảnh báo (vd EXPIRY|kho|mã) — unique để lượt quét sau UPDATE
-- last_seen thay vì đẻ dòng mới.
CREATE TABLE IF NOT EXISTS alert_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule         text NOT NULL,               -- EXPIRY | GATE_DWELL | TRIP_LATE | WEIGH_DIFF | BE_ERRORS
  dedup_key    text NOT NULL UNIQUE,
  severity     text NOT NULL,               -- CRITICAL | WARNING
  warehouse_id text,                        -- null = cảnh báo toàn hệ thống (vd BE_ERRORS)
  category     text,                        -- Loại kho của đối tượng (null-inclusive khi cắt scope)
  title        text NOT NULL,
  detail       text,
  object_url   text,                        -- đường dẫn trong app khi bấm vào (vd /wms/outbound/<id>)
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  pushed_at    timestamptz,                 -- đã bắn Web Push chưa (null = mới, chưa báo ai)
  ack_by       text,
  ack_at       timestamptz,
  resolved_at  timestamptz,                 -- điều kiện đã hết (tự đóng) — list mặc định ẩn
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alert_events_open ON alert_events (rule, warehouse_id) WHERE resolved_at IS NULL;

ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
-- Realtime cần policy SELECT cho authenticated (bài học RLS-chết-câm 04/08 — bật RLS không policy
-- là client KHÔNG nhận sự kiện). Nội dung cảnh báo không nhạy cảm hơn dữ liệu các bảng nghiệp vụ
-- đã phát realtime; API list vẫn cắt scope kho+loại ở BE.
DROP POLICY IF EXISTS rls_auth_select ON alert_events;
CREATE POLICY rls_auth_select ON alert_events FOR SELECT TO authenticated USING (true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'alert_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE alert_events;
  END IF;
END $$;

-- ── RPC prefilter ứng viên CẬN DATE ──────────────────────────────────────────
-- %Date KHÔNG TÍNH Ở SQL (luật CLAUDE.md: công thức duy nhất = utils/shelfLife.computePctDate,
-- có ngoại lệ shelf-life theo NCC). RPC này chỉ THU HẸP tập ứng viên bằng điều kiện SIÊU TẬP
-- (chặn sót, cho phép thừa): HSD tường minh/suy từ NSX+shelflife trong cửa sổ p_days, HOẶC mã có
-- override NCC (không dựng lại được luật override trong SQL — đưa hết cho Node quyết).
-- Node nhận nhóm thô rồi tính computePctDate CHÍNH XÁC và áp ngưỡng thật.
CREATE OR REPLACE FUNCTION alerts_expiry_candidates(p_days int DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql STABLE SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_j), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'warehouse_id',   g.warehouse_id,
      'warehouse_name', w.name,
      'material_id',    g.material_id,
      'material_code',  m.material_code,
      'short_name',     m.short_name,
      'category',       m.category,
      'production_date', g.production_date,
      'expiry_date',     g.expiry_date,
      'shelf_life_days', g.shelf_life_days,
      'ncc_id',          g.ncc_id,
      'mat_shelf_life_days', m.shelf_life_days,
      'supplier_shelf_life_overrides', m.supplier_shelf_life_overrides,
      'qty_base',        g.qty_base,
      'pallets',         g.pallets
    ) AS row_j
    FROM (
      SELECT e.warehouse_id, e.material_id, e.production_date, e.expiry_date,
             e.shelf_life_days, e.ncc_id,
             SUM(e.cartons_remaining) AS qty_base, COUNT(*) AS pallets
      FROM "InventoryEntry" e
      JOIN "Material" mm ON mm.id = e.material_id
      WHERE e.cartons_remaining > 0
        AND e.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
        AND (
          (e.expiry_date IS NOT NULL AND e.expiry_date <= current_date + p_days)
          OR (e.expiry_date IS NULL AND e.production_date IS NOT NULL
              AND COALESCE(e.shelf_life_days, mm.shelf_life_days, 0) > 0
              AND e.production_date + COALESCE(e.shelf_life_days, mm.shelf_life_days, 0) <= current_date + p_days)
          OR (e.production_date IS NOT NULL
              AND jsonb_typeof(mm.supplier_shelf_life_overrides) = 'array'
              AND jsonb_array_length(mm.supplier_shelf_life_overrides) > 0)
        )
      GROUP BY e.warehouse_id, e.material_id, e.production_date, e.expiry_date, e.shelf_life_days, e.ncc_id
    ) g
    JOIN "Material" m ON m.id = g.material_id
    LEFT JOIN "Warehouse" w ON w.id::text = g.warehouse_id::text
    ORDER BY COALESCE(g.expiry_date, g.production_date) NULLS LAST
    LIMIT 2000   -- cầu chì: quá 2000 nhóm cận date là chuyện bất thường, cắt có chủ đích
  ) t;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION alerts_expiry_candidates(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION alerts_expiry_candidates(int) TO service_role;
