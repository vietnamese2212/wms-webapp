-- 2026-07-31 — BIỂN SỐ XE: chỉ CHỮ và SỐ, viết HOA, không ngăn cách
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- User chốt 30-31/07: "biển số xe là các ký tự nối tiếp, in hoa · không có ký tự gì cả,
-- chỉ là số và text". Dạng chuẩn = ^[A-Z0-9]+$  ("29e-09404" · "66H 07144" → "29E09404" · "66H07144").
--
-- VÌ SAO CẦN CẢ CHECK Ở DB, không chỉ sửa code: form FE đã chuẩn hoá biển số từ lâu mà dữ liệu
-- vẫn bẩn — vì còn các đường ghi KHÔNG qua form (API tích hợp, upload, script import), và chính
-- `vehicleController` cũ chỉ bỏ khoảng trắng chứ không bỏ dấu gạch. Luật văn xuôi không tự thi
-- hành; CHECK dưới DB là nơi mọi đường ghi đều phải đi qua.
--
-- PHẠM VI — 4 cột NGHIỆP VỤ (biển số do app quản lý):
--   Vehicle.license_plate · gate_registrations.license_plate
--   GroupDeliveryOrder.license_plate · TmsVehicleSlot.license_plate
-- KHÔNG đụng 2 cột LƯU NGUYÊN VĂN nguồn ngoài (mất bản sao chứng từ gốc là mất khả năng đối chiếu):
--   WeighTicket.license_plate      → dạng chuẩn đã có sẵn ở cột `license_plate_norm`
--   erp_outbound_orders.license_plate → raw SAP
--
-- Đo staging trước khi chạy: Vehicle 11/953 bẩn · gate_registrations 2/3 bẩn · GDO 0 · TmsVehicleSlot 0.

BEGIN;

-- ── 1. BACKUP (giữ lại để đối chiếu/khôi phục; xoá tay khi đã yên tâm) ──
CREATE SCHEMA IF NOT EXISTS bak_20260731;
CREATE TABLE IF NOT EXISTS bak_20260731."Vehicle_plate" AS
  SELECT id, license_plate, ncc_id FROM public."Vehicle" WHERE license_plate ~ '[^A-Z0-9]';
CREATE TABLE IF NOT EXISTS bak_20260731."gate_plate" AS
  SELECT id, license_plate FROM public.gate_registrations WHERE license_plate ~ '[^A-Z0-9]';

-- ── 2. GỘP XE TRÙNG do chuẩn hoá ──
-- Vehicle có UNIQUE (license_plate, ncc_id). "66H 07144" và "66H07144" là CÙNG một xe của CÙNG
-- ĐVVT (Khang Gia Tiến) → chuẩn hoá xong sẽ vi phạm khoá. Xoá bản ghi dạng bẩn, giữ bản sạch.
-- Đã kiểm: KHÔNG bản ghi nào (gate_registrations.vehicle_id) trỏ tới bản sắp xoá.
-- Viết TỔNG QUÁT (không hard-code id) để chạy đúng trên cả production nếu số liệu khác.
WITH norm AS (
  SELECT id, ncc_id, license_plate,
         upper(regexp_replace(license_plate, '[^A-Za-z0-9]', '', 'g')) AS np
  FROM public."Vehicle" WHERE license_plate IS NOT NULL
),
keeper AS (   -- mỗi (np, ncc) giữ 1: ưu tiên bản ĐÃ đúng dạng, sau đó tới bản tạo trước
  SELECT DISTINCT ON (np, ncc_id) id, np, ncc_id
  FROM norm ORDER BY np, ncc_id, (license_plate = np) DESC, id
),
dupe AS (
  SELECT n.id FROM norm n JOIN keeper k ON k.np = n.np AND k.ncc_id IS NOT DISTINCT FROM n.ncc_id
  WHERE n.id <> k.id
)
DELETE FROM public."Vehicle" v USING dupe d WHERE v.id = d.id;

-- ── 3. CHUẨN HOÁ dữ liệu cũ (4 cột nghiệp vụ) ──
UPDATE public."Vehicle"
   SET license_plate = upper(regexp_replace(license_plate, '[^A-Za-z0-9]', '', 'g')),
       updated_at = now()
 WHERE license_plate ~ '[^A-Z0-9]';

UPDATE public.gate_registrations
   SET license_plate = upper(regexp_replace(license_plate, '[^A-Za-z0-9]', '', 'g')),
       updated_at = now()
 WHERE license_plate ~ '[^A-Z0-9]';

UPDATE public."GroupDeliveryOrder"
   SET license_plate = upper(regexp_replace(license_plate, '[^A-Za-z0-9]', '', 'g')),
       updated_at = now()
 WHERE license_plate ~ '[^A-Z0-9]';

UPDATE public."TmsVehicleSlot"
   SET license_plate = upper(regexp_replace(license_plate, '[^A-Za-z0-9]', '', 'g')),
       updated_at = now()
 WHERE license_plate ~ '[^A-Z0-9]';

-- Chuỗi chỉ gồm ký tự ngăn cách ("-", " ") → chuẩn hoá ra rỗng: coi như KHÔNG khai biển số
UPDATE public."Vehicle"            SET license_plate = NULL WHERE license_plate = '';
UPDATE public.gate_registrations   SET license_plate = NULL WHERE license_plate = '';
UPDATE public."GroupDeliveryOrder" SET license_plate = NULL WHERE license_plate = '';
UPDATE public."TmsVehicleSlot"     SET license_plate = NULL WHERE license_plate = '';

-- ── 4. GÁC: còn dòng bẩn thì DỪNG, không tạo ràng buộc nửa vời ──
DO $$
DECLARE n int;
BEGIN
  SELECT (SELECT count(*) FROM public."Vehicle"            WHERE license_plate ~ '[^A-Z0-9]')
       + (SELECT count(*) FROM public.gate_registrations   WHERE license_plate ~ '[^A-Z0-9]')
       + (SELECT count(*) FROM public."GroupDeliveryOrder" WHERE license_plate ~ '[^A-Z0-9]')
       + (SELECT count(*) FROM public."TmsVehicleSlot"     WHERE license_plate ~ '[^A-Z0-9]')
    INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'Còn % biển số sai dạng sau khi chuẩn hoá — dừng, chưa thêm CHECK', n;
  END IF;
END $$;

-- ── 5. CHECK: từ đây MỌI đường ghi (app, API tích hợp, upload, script) đều bị chặn nếu sai dạng ──
-- NOT VALID + VALIDATE tách 2 bước: khoá bảng ngắn hơn, và nếu dữ liệu còn sót thì lỗi rơi vào
-- bước VALIDATE chứ không phải lúc ADD (dễ đọc hơn khi apply production).
ALTER TABLE public."Vehicle"            DROP CONSTRAINT IF EXISTS vehicle_plate_format;
ALTER TABLE public."Vehicle"            ADD  CONSTRAINT vehicle_plate_format
  CHECK (license_plate IS NULL OR license_plate ~ '^[A-Z0-9]+$') NOT VALID;
ALTER TABLE public."Vehicle"            VALIDATE CONSTRAINT vehicle_plate_format;

ALTER TABLE public.gate_registrations   DROP CONSTRAINT IF EXISTS gate_plate_format;
ALTER TABLE public.gate_registrations   ADD  CONSTRAINT gate_plate_format
  CHECK (license_plate IS NULL OR license_plate ~ '^[A-Z0-9]+$') NOT VALID;
ALTER TABLE public.gate_registrations   VALIDATE CONSTRAINT gate_plate_format;

ALTER TABLE public."GroupDeliveryOrder" DROP CONSTRAINT IF EXISTS gdo_plate_format;
ALTER TABLE public."GroupDeliveryOrder" ADD  CONSTRAINT gdo_plate_format
  CHECK (license_plate IS NULL OR license_plate ~ '^[A-Z0-9]+$') NOT VALID;
ALTER TABLE public."GroupDeliveryOrder" VALIDATE CONSTRAINT gdo_plate_format;

ALTER TABLE public."TmsVehicleSlot"     DROP CONSTRAINT IF EXISTS vslot_plate_format;
ALTER TABLE public."TmsVehicleSlot"     ADD  CONSTRAINT vslot_plate_format
  CHECK (license_plate IS NULL OR license_plate ~ '^[A-Z0-9]+$') NOT VALID;
ALTER TABLE public."TmsVehicleSlot"     VALIDATE CONSTRAINT vslot_plate_format;

COMMIT;

-- Kiểm sau khi apply:
--   SELECT 'Vehicle' t, count(*) FROM "Vehicle" WHERE license_plate ~ '[^A-Z0-9]'
--   UNION ALL SELECT 'gate', count(*) FROM gate_registrations WHERE license_plate ~ '[^A-Z0-9]'
--   UNION ALL SELECT 'GDO', count(*) FROM "GroupDeliveryOrder" WHERE license_plate ~ '[^A-Z0-9]'
--   UNION ALL SELECT 'VSlot', count(*) FROM "TmsVehicleSlot" WHERE license_plate ~ '[^A-Z0-9]';
--   → tất cả phải = 0; và INSERT thử biển "29E-1" phải bị 23514.
