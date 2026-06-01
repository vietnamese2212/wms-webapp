-- TmsOrder: bổ sung fields cho kế hoạch nhập ngoài (INBOUND direction)
-- material_id : mã hàng SAP plan (nullable — outbound không dùng)
-- po_number   : số PO mua hàng (chỉ dùng cho INBOUND)
-- is_unplanned: đánh dấu xe phát sinh, không có trong kế hoạch SAP

ALTER TABLE "TmsOrder"
  ADD COLUMN IF NOT EXISTS material_id  UUID REFERENCES "Material"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS po_number    TEXT,
  ADD COLUMN IF NOT EXISTS is_unplanned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_tms_order_material ON "TmsOrder"(material_id);

NOTIFY pgrst, 'reload schema';
