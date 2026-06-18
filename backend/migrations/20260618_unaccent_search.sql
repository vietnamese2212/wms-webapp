-- Omni-search bỏ dấu tiếng Việt cho server-side (Inventory…).
-- ilike của PostgREST không bỏ dấu → dùng RPC gọi unaccent() để resolve ID khớp term.
-- Material/Location là masterdata nhỏ → seq scan chấp nhận được (không cần index unaccent).

CREATE EXTENSION IF NOT EXISTS unaccent;

-- Trả id Material khớp term trên mã / mô tả / tên ngắn / mã cũ (bỏ dấu + không phân biệt hoa thường).
CREATE OR REPLACE FUNCTION omni_material_ids(term text)
RETURNS TABLE(id text)
LANGUAGE sql STABLE AS $$
  SELECT m.id FROM "Material" m
  WHERE unaccent(lower(coalesce(m.material_code, '')))        LIKE unaccent(lower('%' || term || '%'))
     OR unaccent(lower(coalesce(m.material_description, ''))) LIKE unaccent(lower('%' || term || '%'))
     OR unaccent(lower(coalesce(m.short_name, '')))           LIKE unaccent(lower('%' || term || '%'))
     OR unaccent(lower(coalesce(m.old_code, '')))             LIKE unaccent(lower('%' || term || '%'))
  LIMIT 500;
$$;

-- Trả id Location khớp term trên mã vị trí / sub_code / sub_name.
CREATE OR REPLACE FUNCTION omni_location_ids(term text)
RETURNS TABLE(id text)
LANGUAGE sql STABLE AS $$
  SELECT l.id FROM "Location" l
  WHERE unaccent(lower(coalesce(l.location_code, ''))) LIKE unaccent(lower('%' || term || '%'))
     OR unaccent(lower(coalesce(l.sub_code, '')))      LIKE unaccent(lower('%' || term || '%'))
     OR unaccent(lower(coalesce(l.sub_name, '')))      LIKE unaccent(lower('%' || term || '%'))
  LIMIT 500;
$$;
