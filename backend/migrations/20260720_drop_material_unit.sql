-- BỎ HẲN cột ĐVT cũ Material.unit (user chốt 20/07: bỏ ĐVT khỏi toàn app, thay bằng Base Unit + Entry Unit).
-- ⚠️ ÁP SAU KHI đã deploy code KHÔNG còn select/ghi `unit` (BE: materialController/orderController/exportController/
--    outboundController đã bỏ; FE đọc đơn vị qua unitCodeOf = entry_unit || base_unit). Áp trước = endpoint 500.
-- ERP export vẫn TRẢ field `unit` nhưng suy từ base/entry (giữ contract), không đọc cột này nữa.
ALTER TABLE "Material" DROP COLUMN IF EXISTS unit;
