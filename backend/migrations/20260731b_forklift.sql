-- ============================================================================
-- MODULE XE NÂNG (31/07/2026) — check list an toàn hàng ngày + đồng hồ giờ vận hành.
-- Nghiệp vụ (user chốt):
--   - Đội xe nâng MỖI NGÀY check list an toàn từng xe + ghi số ĐỒNG HỒ GIỜ (hour meter,
--     số tích lũy trên xe). Giờ chạy của 1 ngày = số lần ghi KẾ TIẾP − số lần ghi hôm đó
--     (vd hôm qua 1480, hôm nay 1500 → hôm qua chạy 20h).
--   - Xe NGHỈ hôm đó = 1 trạng thái của bản ghi ngày (IDLE, không cần số đồng hồ) —
--     vẫn tính là "đã check list".
--   - Kiểm soát xe nào CHƯA check list trong ngày (board = xe active × log ngày).
--   - Check list snapshot label vào jsonb → đổi tên hạng mục sau này KHÔNG phá lịch sử.
-- Bảng MỚI nên có DEFAULT id/updated_at (luật "INSERT tự cấp id" là cho bảng CŨ thiếu default).
-- RLS bật + KHÔNG policy → anon/authenticated không đọc/ghi thẳng; chỉ service role (BE).
-- ============================================================================

-- 1. Danh mục xe nâng
CREATE TABLE IF NOT EXISTS public.forklift_vehicles (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text        NOT NULL,             -- mã xe (vd XN01) — unique không phân biệt hoa/thường
  name         text,                             -- tên/mô tả (hãng, model…) tùy chọn
  warehouse_id text        NOT NULL REFERENCES public."Warehouse"(id),
  is_active    boolean     NOT NULL DEFAULT true,
  created_by   text,
  updated_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_forklift_code ON public.forklift_vehicles (upper(code));
CREATE INDEX IF NOT EXISTS idx_forklift_wh ON public.forklift_vehicles (warehouse_id) WHERE is_active;

-- 2. Danh mục hạng mục check list (dùng CHUNG mọi xe)
CREATE TABLE IF NOT EXISTS public.forklift_checklist_items (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text        NOT NULL,               -- nội dung kiểm tra (phanh, còi, đèn, lốp…)
  sort_order integer     NOT NULL DEFAULT 0,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Bản ghi check list NGÀY — mỗi xe mỗi ngày ĐÚNG 1 dòng (unique = chống đua đa-user,
--    BE bắt 23505 → chuyển thành UPDATE). Ghi lại trong ngày = cập nhật đè.
CREATE TABLE IF NOT EXISTS public.forklift_daily_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  forklift_id   uuid        NOT NULL REFERENCES public.forklift_vehicles(id) ON DELETE CASCADE,
  log_date      date        NOT NULL,            -- ngày VN (business date)
  status        text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'IDLE')),
  hour_meter    numeric(12,1),                   -- số đồng hồ giờ lúc check (bắt buộc khi ACTIVE)
  checklist     jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- [{item_id, label(snapshot), ok, note}]
  issue_count   integer     NOT NULL DEFAULT 0,  -- đếm sẵn số hạng mục KHÔNG đạt (BE tính khi ghi)
  note          text,
  checked_by    text,                            -- tên người check (snapshot)
  checked_by_id uuid,                            -- Employee.id
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_forklift_log_day UNIQUE (forklift_id, log_date),
  CONSTRAINT forklift_log_meter_required CHECK (status <> 'ACTIVE' OR hour_meter IS NOT NULL),
  CONSTRAINT forklift_log_meter_positive CHECK (hour_meter IS NULL OR hour_meter >= 0)
);
CREATE INDEX IF NOT EXISTS idx_fdl_date ON public.forklift_daily_logs (log_date DESC);
-- (forklift_id, log_date) đã có index qua UNIQUE constraint — lateral "số kế tiếp" dùng index này.

ALTER TABLE public.forklift_vehicles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forklift_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forklift_daily_logs      ENABLE ROW LEVEL SECURITY;

-- Realtime CÓ ĐIỀU KIỆN (tránh 42710 nếu đã thêm)
DO $$ DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['forklift_vehicles', 'forklift_checklist_items', 'forklift_daily_logs'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = tbl) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;

-- ─── RPC: forklift_report ────────────────────────────────────────────────────
-- Báo cáo vận hành 1 khoảng ngày: trả DÒNG jsonb (không trả id — luật pool PostgREST),
-- mỗi dòng = 1 log kèm hours_run đã tính sẵn:
--   hours_run = số đồng hồ của LẦN GHI KẾ TIẾP (bỏ qua ngày nghỉ không số) − số hôm đó.
--   Ngày IDLE → 0. Chưa có lần ghi kế tiếp → NULL (FE hiện "chờ số hôm sau").
-- plpgsql + force_custom_plan (bẫy LANGUAGE sql generic plan — memory server-pagination-campaign).
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

-- Seed hạng mục check list mặc định (chỉ khi bảng RỖNG — không đè danh mục user đã sửa)
INSERT INTO public.forklift_checklist_items (label, sort_order)
SELECT * FROM (VALUES
  ('Phanh (thắng) hoạt động tốt', 1),
  ('Còi / đèn cảnh báo hoạt động', 2),
  ('Lốp xe / bánh xe không mòn vẹt, nứt', 3),
  ('Càng nâng không cong vênh, nứt gãy', 4),
  ('Xích / thủy lực không rò rỉ dầu', 5),
  ('Dây an toàn / khung bảo vệ đầy đủ', 6),
  ('Bình điện / nhiên liệu đủ mức', 7),
  ('Gương chiếu hậu / tầm nhìn rõ', 8)
) AS seed(label, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.forklift_checklist_items);
