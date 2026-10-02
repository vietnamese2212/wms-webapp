-- 03/10/2026 — BỎ hai ô khỏi dòng xe con (user 02/10): "Non tải dưới (%)" — bàn điều vận đã có dải tải theo dòng xe cha của từng
-- kho, ngưỡng của kho là mặc định khi mở bàn, ô này không còn ai đọc; "m³ tối đa" — chưa luật nào đọc (hàng không có m³).
-- MIGRATION PHÁ (lớp C52): chỉ áp SAU khi Preview đã chạy bản code không còn đọc hai cột này.
ALTER TABLE vehicle_model DROP COLUMN IF EXISTS underload_pct;
ALTER TABLE vehicle_model DROP COLUMN IF EXISTS max_m3;
