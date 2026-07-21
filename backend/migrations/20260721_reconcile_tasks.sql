-- ĐỢT 2 reconcile SAP↔WMS — bảng AUDIT + HÀNG CHỜ "Cần xử lý".
-- Engine reconcileFromSap ghi 1 dòng/thay-đổi-ảnh-hưởng-item:
--   action AUTO_APPLIED (đã tự áp, chưa quét — informational)  → status RESOLVED
--   action RECONCILE_ONLY (chuyến đã đóng — chỉ đối soát)       → status RESOLVED
--   action NEEDS_REVIEW / BLOCKED (dòng đã quét — cần người)     → status OPEN (hiện ở tab "Cần xử lý")
-- Người xử lý (quyền outbound.reconcile): apply (áp SAP, chỉ khi new>=scanned) / keep (giữ WMS, báo SAP) / manual_done.
CREATE TABLE IF NOT EXISTS public."reconcile_tasks" (
  id            text PRIMARY KEY,
  item_id       text,                       -- OutboundItem bị ảnh hưởng (null nếu chỉ ở pool)
  gdo_id        text,                       -- chuyến (để lọc/hiển thị)
  group_code    text,                       -- mã chuyến (denorm hiển thị)
  material_code text,
  material_name text,
  od_number     text,                       -- dòng OD của SAP gây thay đổi
  od_item       text,
  change_type   text NOT NULL,              -- QTY_INCREASE|QTY_DECREASE|LINE_REMOVED|MATERIAL_CHANGED|SHIPTO_CHANGED|ATTR_CHANGED
  zone          text NOT NULL,              -- Z1|Z2|Z3|Z4
  action        text NOT NULL,              -- AUTO_APPLIED|NEEDS_REVIEW|BLOCKED|RECONCILE_ONLY
  status        text NOT NULL DEFAULT 'OPEN',-- OPEN | RESOLVED
  old_ordered   numeric,
  new_ordered   numeric,
  scanned       numeric,
  detail        text,                       -- mô tả người đọc ("SAP giảm 2400→1920 hộp; đã quét 500 → trả 500")
  actor         text,                       -- người/nguồn kích hoạt (tên user | SAP-API)
  resolution    text,                       -- apply | keep | manual_done
  resolved_by   text,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rct_status  ON public."reconcile_tasks" (status);
CREATE INDEX IF NOT EXISTS idx_rct_gdo     ON public."reconcile_tasks" (gdo_id);
CREATE INDEX IF NOT EXISTS idx_rct_created ON public."reconcile_tasks" (created_at);

ALTER TABLE public."reconcile_tasks" ENABLE ROW LEVEL SECURITY;  -- chặn anon (service role bypass)

-- Realtime cho tab "Cần xử lý" (bảng nhỏ — hàng chờ ngoại lệ)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='reconcile_tasks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."reconcile_tasks";
  END IF;
END $$;
