-- Đổi Material.category từ short code sang tên hiển thị
-- TP → Thành phẩm | BAO_BI → Bao bì
-- NVL và POSM giữ nguyên (tên hiển thị = code)

UPDATE "Material"
SET category   = 'Thành phẩm',
    updated_at = NOW()
WHERE category = 'TP';

UPDATE "Material"
SET category   = 'Bao bì',
    updated_at = NOW()
WHERE category = 'BAO_BI';
