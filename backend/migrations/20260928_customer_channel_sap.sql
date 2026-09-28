-- 20260928 — KÊNH KHÁCH HÀNG theo KÊNH BÁN SAP + kênh riêng của app (user chốt 28/09/2026).
--
-- User: "Kênh của khách là GT, MT… phù hợp với phân chia date trong WMS và gắn xe cơ bản (vẫn modify nhiều trong từng khách)"
-- · chọn "Đổi sang 6 kênh bán SAP + tự điền từ SAP" · GT ≥ 60 % (mức NPP cũ) · MT 70 % · KA 70 % · còn lại trống
-- · "Kênh là nơi khai báo riêng — tôi có thể khai thêm kênh không có trên SAP (vd Bách hoá xanh)".
--
-- ⇒ (1) kênh mang `meta.sap_dist_channel` (mã đầu của cột Distribution Channel ZSD02: 10 / 20 / 30 / 40 / 80 / 99) — khách CHƯA có
--   kênh được cửa nạp ZSD02 tự điền theo mã này (`utils/sapChannel.ts`); kênh không mã (BHX) chỉ gán tay.
--   (2) KHO_TONG + NPP (cả hai là 10-General Trade bên SAP — khác nhau ở CẤP khách, không phải kênh) gộp vào GT; khác biệt khai riêng khách.
--   (3) Thêm GT + XK (Xuất khẩu). BHX giữ làm kênh riêng. (4) Điền kênh cho khách đã có từ dữ liệu ZSD02 đã nạp.
--   (5) Quyền mới `customers.create_channel` (Thêm kênh) cấp cho chức danh đang có `customers.manage_channel` (năng lực sẵn có).
BEGIN;

-- (1) kênh mới
INSERT INTO public."LookupValue" (id, type, value, sort_order, meta, created_at, updated_at)
SELECT gen_random_uuid(), 'customer_channel', v.value, v.sort_order, v.meta, now(), now()
  FROM (VALUES ('GT', 1, '{"label":"General Trade (GT)"}'::jsonb), ('XK', 5, '{"label":"Xuất khẩu"}'::jsonb)) AS v(value, sort_order, meta)
 WHERE NOT EXISTS (SELECT 1 FROM public."LookupValue" l WHERE l.type = 'customer_channel' AND l.value = v.value);

-- mã kênh SAP + thứ tự hiển thị
UPDATE public."LookupValue" l
   SET meta = CASE WHEN m.sap IS NULL THEN l.meta - 'sap_dist_channel' ELSE jsonb_set(l.meta, '{sap_dist_channel}', to_jsonb(m.sap)) END,
       sort_order = m.sort_order, updated_at = now()
  FROM (VALUES ('GT', '10', 1), ('MT', '20', 2), ('BHX', NULL, 3), ('KA', '30', 4), ('XK', '40', 5), ('NOI_BO', '80', 6), ('KHAC', '99', 7))
       AS m(value, sap, sort_order)
 WHERE l.type = 'customer_channel' AND l.value = m.value;

-- (2) mức date GT ≥ 60 % (MT 70 % · KA 70 % · BHX giữ nguyên đã có)
INSERT INTO public.date_rule_master (id, scope, scope_key, category, rule, note, created_at, updated_at)
SELECT gen_random_uuid()::text, 'CHANNEL', 'GT', NULL, '{"kind":"MIN_PCT","value":60}'::jsonb, 'user chốt 28/09 — mức NPP cũ', now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM public.date_rule_master WHERE scope = 'CHANNEL' AND scope_key = 'GT' AND category IS NULL);

-- khách đang ở KHO_TONG / NPP → GT, rồi bỏ hai kênh cũ + mức của chúng
UPDATE public."Customer" SET channel = 'GT', updated_at = now() WHERE channel IN ('KHO_TONG', 'NPP');
DELETE FROM public.date_rule_master WHERE scope = 'CHANNEL' AND scope_key IN ('KHO_TONG', 'NPP');
DELETE FROM public."LookupValue" WHERE type = 'customer_channel' AND value IN ('KHO_TONG', 'NPP');

-- (4) khách CHƯA có kênh ⇒ theo kênh SAP của dòng ZSD02 mới nhất (cùng luật cửa nạp: chỉ điền ô trống, không đè kênh đã gán)
WITH last AS (
  SELECT DISTINCT ON (ship_to_code) ship_to_code, substring(trim(dist_channel) FROM '^(\d+)') AS sap
    FROM public.erp_outbound_orders WHERE dist_channel IS NOT NULL ORDER BY ship_to_code, updated_at DESC
), map AS (
  SELECT meta->>'sap_dist_channel' AS sap, value FROM public."LookupValue" WHERE type = 'customer_channel' AND meta ? 'sap_dist_channel'
)
UPDATE public."Customer" c SET channel = map.value, updated_at = now(), updated_by = 'migration 20260928'
  FROM last JOIN map ON map.sap = last.sap
 WHERE c.ship_to_code = last.ship_to_code AND c.channel IS NULL;

-- (5) quyền Thêm kênh cho chức danh đang quản lý kênh
UPDATE public."JobTitle"
   SET module_permissions = jsonb_set(module_permissions, '{customers}', (module_permissions->'customers') || '["create_channel"]'::jsonb), updated_at = now()
 WHERE module_permissions->'customers' ? 'manage_channel' AND NOT (module_permissions->'customers' ? 'create_channel');

COMMIT;
