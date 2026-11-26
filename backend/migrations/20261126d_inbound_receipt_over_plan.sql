-- 26/11/2026 — PHIẾU NHẬP CHUNG nhiều mã + CÔNG TẮC NHẬP VƯỢT KẾ HOẠCH (user chốt 26/11)
--
-- (1) Phiếu nhập chung (như chuyến Xuất kho: một phiếu, nhiều mã, một nút Quét): áp cho "Nhập nhiều mã" + nhóm NCC.
--     Bên trong vẫn MỖI MÃ MỘT DÒNG `ProductionImport` (tồn, truy xuất lô, lịch sử quét, báo cáo, file SAP đọc theo dòng);
--     bảng mới `inbound_receipts` là ĐẦU PHIẾU: số phiếu app sinh (<KHO>_PN_<ddmmyy>_<seq>) + "Số chứng từ" tuỳ chọn
--     (số trên giấy / phiếu nội bộ). Khoá = `ProductionImport.receipt_group` (đã có từ 20261126b) ⇒ thêm FK.
--     Nhóm đã có trước migration được dựng đầu phiếu (số sinh theo ngày tạo).
-- (2) Nhập vượt số kê khai: cờ 2 tầng Kho + Loại kho `inbound_over_plan` — NULL = như cũ (máy chủ không chặn; màn hình
--     phiếu NCC dừng nút quét khi đủ kế hoạch) · 'ALLOW' = cho vượt, báo Thừa · 'BLOCK' = chặn ở máy chủ.
--     Tầng Loại kho NULL = theo kho. Kho chế biến đặt 'ALLOW' (user chốt) — đặt bằng màn Cài đặt WMS, không đặt ở đây.
BEGIN;

CREATE TABLE IF NOT EXISTS public.inbound_receipts (
  id            text PRIMARY KEY,                                         -- = ProductionImport.receipt_group
  receipt_code  text NOT NULL,                                            -- số phiếu app sinh
  doc_no        text,                                                     -- Số chứng từ (tuỳ chọn)
  warehouse_id  text NOT NULL REFERENCES public."Warehouse"(id),
  source_type   text NOT NULL DEFAULT 'FACTORY' CHECK (source_type IN ('FACTORY', 'NCC')),
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_receipts_code ON public.inbound_receipts (receipt_code);
CREATE INDEX IF NOT EXISTS idx_inbound_receipts_doc_no ON public.inbound_receipts (doc_no) WHERE doc_no IS NOT NULL;
ALTER TABLE public.inbound_receipts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_wms_notify' AND tgrelid = 'public.inbound_receipts'::regclass) THEN
    CREATE TRIGGER trg_wms_notify AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.inbound_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.wms_notify_change();
  END IF;
END $$;

-- Đầu phiếu cho nhóm đã có (số theo ngày tạo nhóm, giờ VN; thứ tự trong ngày theo giờ tạo)
INSERT INTO public.inbound_receipts (id, receipt_code, warehouse_id, source_type, created_by, created_at, updated_at)
SELECT g.receipt_group,
       COALESCE(w.code, 'XX') || '_PN_' || to_char(g.first_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DDMMYY') || '_'
         || lpad(row_number() OVER (PARTITION BY g.warehouse_id, (g.first_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date ORDER BY g.first_at, g.receipt_group)::text, 3, '0'),
       g.warehouse_id,
       CASE WHEN g.src = 'NCC' THEN 'NCC' ELSE 'FACTORY' END,
       g.created_by, g.first_at, now()
FROM (
  SELECT receipt_group, min(warehouse_id) AS warehouse_id, min(created_at) AS first_at,
         min(source_type) AS src, min(created_by) AS created_by
  FROM public."ProductionImport" WHERE receipt_group IS NOT NULL GROUP BY receipt_group
) g
JOIN public."Warehouse" w ON w.id = g.warehouse_id
WHERE NOT EXISTS (SELECT 1 FROM public.inbound_receipts r WHERE r.id = g.receipt_group);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_production_import_receipt') THEN
    ALTER TABLE public."ProductionImport" ADD CONSTRAINT fk_production_import_receipt
      FOREIGN KEY (receipt_group) REFERENCES public.inbound_receipts(id);
  END IF;
END $$;

-- (2) công tắc nhập vượt kế hoạch — 2 tầng
ALTER TABLE public."Warehouse"              ADD COLUMN IF NOT EXISTS inbound_over_plan text;
ALTER TABLE public."warehouse_type_configs" ADD COLUMN IF NOT EXISTS inbound_over_plan text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_inbound_over_plan_ck') THEN
    ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_inbound_over_plan_ck CHECK (inbound_over_plan IN ('ALLOW', 'BLOCK'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wh_type_cfg_inbound_over_plan_ck') THEN
    ALTER TABLE public."warehouse_type_configs" ADD CONSTRAINT wh_type_cfg_inbound_over_plan_ck CHECK (inbound_over_plan IN ('ALLOW', 'BLOCK'));
  END IF;
END $$;
COMMENT ON COLUMN public."Warehouse".inbound_over_plan IS
  'Nhập vượt số kế hoạch của phiếu nhập: NULL = như cũ (máy chủ không chặn, phiếu NCC dừng nút quét khi đủ) · ALLOW = cho vượt, báo Thừa · BLOCK = chặn. 26/11.';
COMMENT ON COLUMN public."warehouse_type_configs".inbound_over_plan IS
  'Khai riêng cho loại kho của Warehouse.inbound_over_plan — NULL = theo kho. 26/11.';

-- tự kiểm
DO $$
DECLARE n_orphan int;
BEGIN
  SELECT count(*) INTO n_orphan FROM public."ProductionImport" p
   WHERE p.receipt_group IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inbound_receipts r WHERE r.id = p.receipt_group);
  IF n_orphan > 0 THEN RAISE EXCEPTION 'còn % dòng phiếu nhập thiếu đầu phiếu', n_orphan; END IF;
END $$;

COMMIT;
