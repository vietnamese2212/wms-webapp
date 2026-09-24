-- GỢI Ý GIÁ TRỊ CẦN TÌM cho Truy xuất lô (user chốt 01/09 tối: "phải dạng dropdown search theo
-- chuẩn app, tìm kiểu này k ra đâu"). Ô nhập tự do → SingleSelect tìm-trên-server: mỗi kiểu tìm
-- một câu DISTINCT + LIMIT trong SQL (PostgREST không DISTINCT được — luật "cần TẬP thì hỏi DB").
CREATE OR REPLACE FUNCTION public.trace_suggest(
  p_kind   text,                -- pallet | material | batch | npp | trip | plate
  p_search text DEFAULT NULL,
  p_limit  int  DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  s   text := btrim(coalesce(p_search, ''));
  lim int  := least(greatest(coalesce(p_limit, 50), 1), 100);
  v   jsonb := '[]'::jsonb;
BEGIN
  IF p_kind = 'material' THEN
    -- danh mục nhỏ (~3k) — rỗng vẫn trả 50 mã đầu; nhãn kèm tên hàng
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.c, 'label', x.l)), '[]') INTO v FROM (
      SELECT m.material_code c, m.material_code || ' — ' || coalesce(m.short_name, m.material_description, '') l
        FROM "Material" m
       WHERE m.is_active IS NOT FALSE
         AND (s = '' OR m.material_code ILIKE '%' || s || '%'
              OR m.short_name ILIKE '%' || s || '%' OR m.material_description ILIKE '%' || s || '%')
       ORDER BY m.material_code LIMIT lim) x;
  ELSIF s = '' THEN
    RETURN v;   -- các kiểu còn lại quét bảng GIAO DỊCH lớn — bắt buộc có từ khóa mới tìm
  ELSIF p_kind = 'pallet' THEN
    -- TIỀN TỐ — phải SQL ĐỘNG (%L nhúng literal): plpgsql cache plan generic nên `LIKE s || '%'`
    -- KHÔNG ăn được index text_pattern_ops (đo staging: 3.101ms → 21ms sau khi đổi)
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(jsonb_build_object(''value'', x.pc, ''label'', x.pc)), ''[]'') FROM (
         SELECT DISTINCT ie.pallet_code pc FROM "InventoryEntry" ie
          WHERE ie.pallet_code LIKE %L ORDER BY 1 LIMIT %s) x', s || '%', lim)
      INTO v;
  ELSIF p_kind = 'batch' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.b, 'label', x.b)), '[]') INTO v FROM (
      SELECT DISTINCT ie.batch b FROM "InventoryEntry" ie
       WHERE ie.batch IS NOT NULL AND ie.batch ILIKE '%' || s || '%' ORDER BY 1 LIMIT lim) x;
  ELSIF p_kind = 'npp' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.n, 'label', x.n)), '[]') INTO v FROM (
      SELECT DISTINCT d.distributor_name n FROM "OutboundDelivery" d
       WHERE d.distributor_name IS NOT NULL AND d.distributor_name ILIKE '%' || s || '%'
       ORDER BY 1 LIMIT lim) x;
  ELSIF p_kind = 'trip' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.g, 'label', x.g)), '[]') INTO v FROM (
      SELECT DISTINCT g.group_code g FROM "GroupDeliveryOrder" g
       WHERE g.group_code ILIKE '%' || s || '%' ORDER BY 1 DESC LIMIT lim) x;
  ELSIF p_kind = 'plate' THEN
    -- so trên dạng CHUẨN (chỉ chữ+số, hoa) như chính lot_trace
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.p, 'label', x.p)), '[]') INTO v FROM (
      SELECT DISTINCT g.license_plate p FROM "GroupDeliveryOrder" g
       WHERE g.license_plate IS NOT NULL
         AND upper(regexp_replace(g.license_plate, '[^A-Za-z0-9]', '', 'g'))
             LIKE '%' || upper(regexp_replace(s, '[^A-Za-z0-9]', '', 'g')) || '%'
       ORDER BY 1 LIMIT lim) x;
  END IF;
  RETURN v;
END $fn$;
