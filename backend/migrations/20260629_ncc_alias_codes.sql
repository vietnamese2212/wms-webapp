-- Mã PHỤ cho NCC/ĐVVT: 1 nhà cung cấp có thể có nhiều mã ERP (cùng tên, khác mã) → gộp về 1 record.
-- Upload (kế hoạch xuất/nhập, tồn, xe) khớp code chính HOẶC phần tử trong alias_codes → cùng 1 id.
-- HSD ngoại lệ theo NCC + báo cáo gộp chung (vì cùng 1 ncc_id).
ALTER TABLE "TransportCompany" ADD COLUMN IF NOT EXISTS alias_codes text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN "TransportCompany".alias_codes IS 'Mã ERP phụ (ngoài code chính). Upload khớp code HOẶC phần tử trong mảng này → cùng 1 NCC/ĐVVT.';

-- Gộp các bản TRÙNG (type, tên chuẩn hoá): giữ 1 primary (code nhỏ nhất), gom code còn lại vào alias_codes,
-- xóa bản phụ. An toàn vì các bản trùng tên hiện CHƯA bị tham chiếu (FK sẽ chặn nếu lỡ còn ref).
WITH grp AS (
  SELECT id, code, type, lower(btrim(name)) AS nm,
         row_number() OVER (PARTITION BY type, lower(btrim(name)) ORDER BY code) AS rn,
         count(*)     OVER (PARTITION BY type, lower(btrim(name)))                AS cnt
  FROM "TransportCompany"
),
alias_agg AS (
  SELECT p.id AS primary_id, array_agg(s.code ORDER BY s.code) AS extra
  FROM (SELECT id, type, nm FROM grp WHERE rn = 1 AND cnt > 1) p
  JOIN  (SELECT code, type, nm FROM grp WHERE rn > 1)          s ON s.type = p.type AND s.nm = p.nm
  GROUP BY p.id
)
UPDATE "TransportCompany" t
SET alias_codes = a.extra, updated_at = now()
FROM alias_agg a
WHERE t.id = a.primary_id;

-- CTE chỉ scope 1 câu lệnh → DELETE cần grp RIÊNG của nó.
WITH grp AS (
  SELECT id,
         row_number() OVER (PARTITION BY type, lower(btrim(name)) ORDER BY code) AS rn,
         count(*)     OVER (PARTITION BY type, lower(btrim(name)))                AS cnt
  FROM "TransportCompany"
)
DELETE FROM "TransportCompany" t
USING grp g
WHERE t.id = g.id AND g.rn > 1 AND g.cnt > 1;
