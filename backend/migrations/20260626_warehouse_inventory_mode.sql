-- ============================================================================
-- Warehouse: thêm CHẾ ĐỘ QUẢN TỒN (inventory_mode) — độc lập với warehouse_type.
--   warehouse_type (CENTRAL/NPP) = danh tính nghiệp vụ (kho của ai).
--   inventory_mode               = kho này quản tồn THẾ NÀO (lái hành vi app).
-- 3 mức (bậc thang, không phải 2 cờ độc lập — "không theo dõi" thì không có QR):
--   'QR'   = theo dõi tồn ĐẦY ĐỦ qua QR (pallet/vị trí/quét) — mọi kho hiện tại.
--   'QTY'  = theo dõi tồn dạng SỐ LƯỢNG thuần, không pallet/QR.
--   'NONE' = KHÔNG theo dõi tồn (điểm trung chuyển / giao nhận).
-- Mọi kho hiện tại đều là kho WMS QR → DEFAULT 'QR' đúng thực trạng, không phải backfill.
-- Idempotent.
-- ============================================================================
ALTER TABLE "Warehouse"
  ADD COLUMN IF NOT EXISTS inventory_mode text NOT NULL DEFAULT 'QR';

ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS warehouse_inventory_mode_check;
ALTER TABLE "Warehouse"
  ADD CONSTRAINT warehouse_inventory_mode_check
  CHECK (inventory_mode IN ('QR', 'QTY', 'NONE'));
