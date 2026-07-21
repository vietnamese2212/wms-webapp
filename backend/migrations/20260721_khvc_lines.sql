-- ĐỢT 1 reconcile SAP↔WMS — TẦNG 2 RAW "Kế hoạch xuất" (KHVC).
-- Trước đây KHVC chỉ tồn tại thoáng qua lúc upload (join VL06O → nặn thành chuyến rồi biến mất).
-- Bảng này GIỮ LẠI từng dòng kế hoạch (Số xe × DO) như tầng raw song song erp_outbound_orders,
-- để: (a) xem lại/sửa/up lại kế hoạch; (b) đối chiếu với DO SAP; (c) biết dòng nào đã sinh chuyến (gdo_id).
-- 1 dòng = 1 (group_code, do_no). Nguồn EXCEL (upload tay) hoặc SAP/plan-app (tương lai, cùng bảng).
CREATE TABLE IF NOT EXISTS public."khvc_lines" (
  id              text PRIMARY KEY,
  group_code      text NOT NULL,                  -- "Số xe" (Mãkho_X_ddmmyy_stt)
  do_no           text NOT NULL,                  -- DO / Delivery — khóa JOIN với erp_outbound_orders.od_number
  warehouse_code  text,                           -- Mã kho = đoạn đầu group_code
  npp             text,                            -- Tên NPP
  veh_type        text,                            -- Loại xe (Loại xuất)
  dvvt            text,                            -- Đơn vị vận tải
  priority        text,                            -- Ưu tiên
  cs              text,                            -- CS phụ trách
  note            text,                            -- Ghi chú điều vận
  export_date     date,                            -- Ngày xuất
  source          text NOT NULL DEFAULT 'EXCEL',   -- EXCEL | SAP | APP
  sync_status     text NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | REMOVED (up lại bỏ dòng → đánh dấu, KHÔNG hard-delete)
  gdo_id          text,                            -- chuyến đã sinh (materialized) — null = chưa/không sinh (vd DO chưa sẵn sàng)
  raw             jsonb,                           -- toàn bộ dòng gốc (an toàn khi thêm cột)
  uploaded_by     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL,
  UNIQUE (group_code, do_no)
);
CREATE INDEX IF NOT EXISTS idx_khvc_group   ON public."khvc_lines" (group_code);
CREATE INDEX IF NOT EXISTS idx_khvc_do       ON public."khvc_lines" (do_no);
CREATE INDEX IF NOT EXISTS idx_khvc_date     ON public."khvc_lines" (export_date);
CREATE INDEX IF NOT EXISTS idx_khvc_created  ON public."khvc_lines" (created_at);

ALTER TABLE public."khvc_lines" ENABLE ROW LEVEL SECURITY;  -- chặn anon (service role bypass)

-- Realtime cho tab "Kế hoạch xuất"
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='khvc_lines') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."khvc_lines";
  END IF;
END $$;
