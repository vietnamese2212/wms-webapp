-- ============================================================================
-- 20261026 — NHẬP HÀNG TRẢ VỀ (user chốt 25–26/10, memory return-receipt-design-2026-10-26)
-- ============================================================================
-- Thủ kho lập phiếu "Nhập hàng trả về" ở Nhập kho: chọn CHUYẾN XUẤT GỐC (đã hoàn thành) ⇒ app điền DO · mã · số đã xuất,
-- người nhập số trả (≤ đã xuất − đã trả trước); không tìm được chuyến ⇒ LẬP TAY (khách + mã + số + lý do). Công tắc QA
-- THEO PHIẾU, mặc định KHÔNG giữ (Hold = gắn QAStatus 'X' khi quét). Giao lại = ĐƠN RIÊNG (SAP tạo DO mới), phiếu trả không
-- mang lựa chọn giao lại.
--   • inbound_return       — đầu phiếu (một lần trả: chuyến gốc / khách · lý do · công tắc QA)
--   • inbound_return_line  — số KHAI trả theo (DO, mã); mỗi mã một ProductionImport source_type 'RETURN'
--   • inbound_return_scan  — SỔ NHẬN TRẢ: mỗi lần quét / lưu nhận về tem gốc nào, bao nhiêu — nguồn của truy xuất lô
--     (phần trả về không còn tính là "đã giao khách") và sổ pallet ("trả về từ chuyến X" trên chính tem gốc)
-- KHÔNG gắn ProductionImport.from_gdo_id cho phiếu trả: cửa nhận chuyển kho đếm phiếu theo cột đó (409 "đã tạo phiếu").
-- Chuỗi truy xuất lô ⇒ KHÔNG đăng ký lưu trữ / xoá theo hạn (luật CLAUDE.md).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inbound_return (
  id              text PRIMARY KEY,
  return_code     text NOT NULL UNIQUE,
  warehouse_id    text NOT NULL REFERENCES public."Warehouse"(id),
  gdo_id          text REFERENCES public."GroupDeliveryOrder"(id) ON DELETE SET NULL,
  group_code      text,
  ship_to_code    text,
  ship_to_name    text,
  reason          text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  qa_hold         boolean NOT NULL DEFAULT false,
  created_by      text REFERENCES public."Employee"(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbound_return_wh_at ON public.inbound_return (warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_return_gdo   ON public.inbound_return (gdo_id) WHERE gdo_id IS NOT NULL;
ALTER TABLE public.inbound_return ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.inbound_return_line (
  id              text PRIMARY KEY,
  return_id       text NOT NULL REFERENCES public.inbound_return(id) ON DELETE CASCADE,
  od_number       text,
  material_id     text NOT NULL REFERENCES public."Material"(id),
  qty_base        numeric NOT NULL CHECK (qty_base > 0),
  shipped_base    numeric,
  import_order_id text REFERENCES public."ProductionImport"(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbound_return_line_ret ON public.inbound_return_line (return_id);
CREATE INDEX IF NOT EXISTS idx_inbound_return_line_imp ON public.inbound_return_line (import_order_id) WHERE import_order_id IS NOT NULL;
ALTER TABLE public.inbound_return_line ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.inbound_return_scan (
  id                 text PRIMARY KEY,
  return_id          text NOT NULL REFERENCES public.inbound_return(id) ON DELETE CASCADE,
  import_order_id    text NOT NULL REFERENCES public."ProductionImport"(id) ON DELETE CASCADE,
  -- dòng tồn nhận hàng; xoá pallet đã quét (gỡ nhầm) ⇒ vết nhận biến theo, truy xuất lô không đếm phần đã gỡ
  entry_id           text REFERENCES public."InventoryEntry"(id) ON DELETE CASCADE,
  source_pallet_code text,                       -- tem GỐC hàng đi ra (null = mã không theo QR)
  merged             boolean NOT NULL DEFAULT false,   -- cộng vào pallet còn trong kho (không tạo dòng tồn mới)
  qty_base           numeric NOT NULL CHECK (qty_base > 0),
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbound_return_scan_src ON public.inbound_return_scan (source_pallet_code) WHERE source_pallet_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbound_return_scan_ret ON public.inbound_return_scan (return_id);
CREATE INDEX IF NOT EXISTS idx_inbound_return_scan_imp ON public.inbound_return_scan (import_order_id);
ALTER TABLE public.inbound_return_scan ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."ProductionImport" ADD COLUMN IF NOT EXISTS return_id text REFERENCES public.inbound_return(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_import_return ON public."ProductionImport" (return_id) WHERE return_id IS NOT NULL;
ALTER TABLE public."ProductionImport" DROP CONSTRAINT IF EXISTS check_production_import_source_type;
ALTER TABLE public."ProductionImport" ADD CONSTRAINT check_production_import_source_type
  CHECK (source_type = ANY (ARRAY['FACTORY'::text, 'NCC'::text, 'TRANSFER'::text, 'RETURN'::text]));
