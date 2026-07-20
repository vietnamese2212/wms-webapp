-- ĐỢT 3 BASE UNIT — "Up raw" SAP: tầng RAW của kế hoạch xuất (2-tier).
-- Tầng 1 (bảng này) = BẢN SAO NGUYÊN VĂN dòng VL06O từ SAP (1 dòng = 1 dòng OD: Delivery+Item).
--   "raw không được biến mất": cột `raw` jsonb giữ TOÀN BỘ dòng gốc (kể cả cột SAP thêm sau này);
--   các cột riêng chỉ để JOIN/truy vấn nhanh. Tên cột SAP giữ nguyên ở lớp parse (map theo header).
-- Tầng 2 (GroupDeliveryOrder/OutboundDelivery/OutboundItem) = derived, sinh khi upload KHVC (join theo DO).
-- Nguồn: EXCEL (upload tay) hoặc SAP (endpoint tương lai — cùng bảng, cột `source`).
CREATE TABLE IF NOT EXISTS public."erp_outbound_orders" (
  id               text PRIMARY KEY,
  od_number        text NOT NULL,            -- Delivery (DO) — khóa JOIN với KHVC.DO
  od_item          text NOT NULL,            -- Item (dòng trong DO)
  material_code    text,                     -- Material
  material_name    text,                     -- Item Description
  qty_sales        numeric,                  -- Delivery Quantity (theo Sales Unit — thùng)
  sales_unit       text,                     -- Sales Unit (CAR…)
  qty_base         numeric,                  -- Actual delivery qty — SỐ THEO BASE UNIT (nguồn thật)
  base_unit        text,                     -- Base Unit of Measure (HOP/KG/BT…)
  ship_to_code     text,                     -- Ship-to Party (mã)
  ship_to_name     text,                     -- Name ship-to party
  plant            text,                     -- Plant
  storage_location text,                     -- Storage Location
  batch            text,                     -- Batch — mã lô (khóa liên kết KẾ TOÁN/ERP)
  batch_so         text,                     -- Batch SO
  date_req         numeric,                  -- Date (Ngày) — giữ nguyên giá trị SAP
  pct_date_req     numeric,                  -- Date (%) — %Date yêu cầu
  note_delivery    text,                     -- Ghi chú giao hàng
  note_invoice     text,                     -- Ghi chú hoá đơn
  shipping_point   text,                     -- Shipping Point/Receiving Pt
  license_plate    text,                     -- Biển số xe
  source           text NOT NULL DEFAULT 'EXCEL',  -- EXCEL | SAP
  raw              jsonb,                    -- TOÀN BỘ dòng gốc (an toàn khi SAP thêm cột)
  uploaded_by      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL,
  UNIQUE (od_number, od_item)
);
CREATE INDEX IF NOT EXISTS idx_erp_ob_od       ON public."erp_outbound_orders" (od_number);
CREATE INDEX IF NOT EXISTS idx_erp_ob_material ON public."erp_outbound_orders" (material_code);
CREATE INDEX IF NOT EXISTS idx_erp_ob_batch    ON public."erp_outbound_orders" (batch);

ALTER TABLE public."erp_outbound_orders" ENABLE ROW LEVEL SECURITY;  -- chặn anon (service role bypass)
