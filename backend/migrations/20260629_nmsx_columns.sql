-- NMSX (đoạn thứ 6 của QR pallet: B=Ba Vì, D=Bàu Bàng, O=gia công ngoài…) lưu THẲNG thành cột
-- để query/filter/dashboard sạch, không phải parse chuỗi pallet_code mỗi lần.
ALTER TABLE "InventoryEntry"    ADD COLUMN IF NOT EXISTS "nmsx" text;
ALTER TABLE "OutboundScanEntry" ADD COLUMN IF NOT EXISTS "nmsx" text;

-- Backfill InventoryEntry: lấy đoạn 6 của pallet_code (chỉ khi chuỗi đủ ≥6 đoạn ngăn bởi '_').
UPDATE "InventoryEntry"
SET nmsx = NULLIF(split_part(pallet_code, '_', 6), '')
WHERE nmsx IS NULL
  AND array_length(string_to_array(pallet_code, '_'), 1) >= 6;

-- Backfill OutboundScanEntry: ưu tiên kế thừa nmsx từ InventoryEntry đã quét, fallback parse pallet_code.
UPDATE "OutboundScanEntry" ose
SET nmsx = COALESCE(
  (SELECT ie.nmsx FROM "InventoryEntry" ie WHERE ie.id = ose.inventory_entry_id),
  NULLIF(split_part(ose.pallet_code, '_', 6), '')
)
WHERE ose.nmsx IS NULL;
