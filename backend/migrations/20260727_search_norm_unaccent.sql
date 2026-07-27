-- TÌM KIẾM BỎ DẤU cho ô chọn Mã hàng / Vị trí.
--
-- Vì sao cần: từ 27/07 mọi ô chọn danh mục lớn đều TÌM TRÊN SERVER (không nạp cả danh mục về
-- trình duyệt nữa) → nhân viên kho BẮT BUỘC phải gõ. `ilike` của PostgREST phân biệt dấu:
-- gõ "nha dam" ra 0 kết quả, phải gõ đúng "Nha Đam" → user tưởng MẤT mã hàng.
--
-- Cách: cột chuẩn-hoá GENERATED (bỏ dấu + thường hoá) + index GIN trgm. Truy vấn vẫn là
-- `ilike` bình thường của PostgREST trên 1 cột → không cần RPC riêng, không đổi hình dạng API.
-- FE/BE chuẩn hoá TỪ KHÓA bằng đúng công thức này (utils/search.ts `normalizeSearchTerm`).

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() là STABLE → KHÔNG dùng trực tiếp trong cột GENERATED được.
-- Bọc IMMUTABLE bằng cách chỉ đích danh từ điển (cách chuẩn của PostgreSQL).
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- ── Material ────────────────────────────────────────────────────────────────
ALTER TABLE "Material" DROP COLUMN IF EXISTS search_norm;
ALTER TABLE "Material" ADD COLUMN search_norm text
  GENERATED ALWAYS AS (
    lower(immutable_unaccent(
      coalesce(material_code, '')        || ' ' ||
      coalesce(material_description, '') || ' ' ||
      coalesce(short_name, '')           || ' ' ||
      coalesce(old_code, '')
    ))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_material_search_norm
  ON "Material" USING gin (search_norm gin_trgm_ops);

-- ── Location ────────────────────────────────────────────────────────────────
ALTER TABLE "Location" DROP COLUMN IF EXISTS search_norm;
ALTER TABLE "Location" ADD COLUMN search_norm text
  GENERATED ALWAYS AS (
    lower(immutable_unaccent(
      coalesce(location_code, '') || ' ' ||
      coalesce(sub_code, '')      || ' ' ||
      coalesce(sub_name, '')
    ))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_location_search_norm
  ON "Location" USING gin (search_norm gin_trgm_ops);

-- Gác: cột phải sinh đúng (bỏ dấu + thường hoá)
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM "Material"
  WHERE search_norm IS NULL OR search_norm <> lower(immutable_unaccent(
    coalesce(material_code,'') || ' ' || coalesce(material_description,'') || ' ' ||
    coalesce(short_name,'')    || ' ' || coalesce(old_code,'')));
  IF bad > 0 THEN RAISE EXCEPTION 'search_norm Material sai ở % dòng', bad; END IF;
END $$;
