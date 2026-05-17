-- Đồng bộ allowed_categories trong Employee và JobTitle
-- Khớp với Material.category đã đổi (20260512_normalize_material_category_display.sql):
--   TP     → Thành phẩm
--   BAO_BI → Bao bì
--   NVL, POSM giữ nguyên

UPDATE "Employee"
SET allowed_categories = array_replace(
      array_replace(allowed_categories, 'TP', 'Thành phẩm'),
      'BAO_BI', 'Bao bì'
    ),
    updated_at = NOW()
WHERE allowed_categories && ARRAY['TP', 'BAO_BI'];

UPDATE "JobTitle"
SET allowed_categories = array_replace(
      array_replace(allowed_categories, 'TP', 'Thành phẩm'),
      'BAO_BI', 'Bao bì'
    ),
    updated_at = NOW()
WHERE allowed_categories && ARRAY['TP', 'BAO_BI'];
