-- Dọn Employee.allowed_categories về taxonomy chuẩn (LookupValue type='warehouse_type':
-- Thành phẩm, POSM, Raw, Giấy, Thùng). Giá trị cũ còn sót: NVL, Bao bì (default cũ của
-- createEmployee) → map NVL→Raw+Giấy+Thùng, Bao bì→Giấy+Thùng, bỏ mọi giá trị ngoài danh mục.
-- Hiện trạng 02/07/2026: 35 người mang bộ default cũ {Thành phẩm,NVL,POSM,Bao bì} → thành đủ 5;
-- 2 người (Hà Quốc Hưng…) mang {NVL,Bao bì,Raw,Giấy,Thùng} → còn đúng {Raw,Giấy,Thùng}.

UPDATE "Employee" e
SET allowed_categories = sub.new_cats,
    updated_at = now()
FROM (
  SELECT id,
         ARRAY(
           SELECT DISTINCT m
           FROM unnest(allowed_categories) AS c
           CROSS JOIN LATERAL unnest(
             CASE c
               WHEN 'NVL'    THEN ARRAY['Raw', 'Giấy', 'Thùng']
               WHEN 'Bao bì' THEN ARRAY['Giấy', 'Thùng']
               WHEN 'BAO_BI' THEN ARRAY['Giấy', 'Thùng']
               WHEN 'TP'     THEN ARRAY['Thành phẩm']
               ELSE ARRAY[c]
             END
           ) AS m
           WHERE m IN (SELECT value FROM "LookupValue" WHERE type = 'warehouse_type')
         ) AS new_cats
  FROM "Employee"
  WHERE EXISTS (
    SELECT 1 FROM unnest(allowed_categories) AS c
    WHERE c NOT IN (SELECT value FROM "LookupValue" WHERE type = 'warehouse_type')
  )
) sub
WHERE e.id = sub.id;

-- Kiểm tra sau khi chạy: phải trả 0 dòng
-- SELECT name, allowed_categories FROM "Employee"
-- WHERE EXISTS (SELECT 1 FROM unnest(allowed_categories) c
--               WHERE c NOT IN (SELECT value FROM "LookupValue" WHERE type='warehouse_type'));
