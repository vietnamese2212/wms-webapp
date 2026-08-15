-- ============================================================================
-- GỘP Loại kho "Thùng" → "PK01"  (27/07/2026) — user chốt
-- ----------------------------------------------------------------------------
-- Bối cảnh: taxonomy Loại kho đã đổi sang mã SAP (Thành phẩm→FG01, SCA→FG02,
-- Raw→RM01, Giấy→PK01). "Thùng" là tên tiếng Việt sót lại; trong mô hình cũ
-- Giấy + Thùng đều là BAO BÌ nên chỗ đúng của nó là PK01.
--
-- Hàm `rename_warehouse_type` KHÔNG dùng được: nó từ chối khi tên đích đã tồn tại
-- (chỉ hỗ trợ ĐỔI TÊN, không hỗ trợ GỘP). Nên gộp bằng script này.
--
-- Đã kiểm trước khi chạy (staging 27/07):
--   • 2 WarehouseZone (K2THUNG, K4THUNG — Kho Ba Vì, 0 vị trí)   → đổi sang PK01
--   • 39/39 Employee có 'Thùng' trong allowed_categories          → gỡ (cả 39 ĐÃ có PK01)
--   • 174 SlotTemplate + 90 DeliverySlot cargo_type='Thùng'       → XOÁ: trùng KHÍT PK01
--     (cùng kho/thứ/giờ/loại xe/hướng — 174/174 và 90/90 khớp) và 0 lượt đặt
--   • Mọi bảng còn lại (Material/Location/TmsOrder/GDO/gate/inbound_plan/
--     ProductionImport/PalletLabelPrint/StocktakeLog/carton_scan_categories) = 0 dòng
-- CÁCH CHẠY: Supabase Dashboard (staging) → SQL Editor → dán → Run.
-- ============================================================================

BEGIN;

-- 1) SAO LƯU phần bị đụng
DROP SCHEMA IF EXISTS bak_20260727c CASCADE;
CREATE SCHEMA bak_20260727c;
CREATE TABLE bak_20260727c."LookupValue"    AS SELECT * FROM public."LookupValue"    WHERE type='warehouse_type' AND value='Thùng';
CREATE TABLE bak_20260727c."WarehouseZone"  AS SELECT * FROM public."WarehouseZone"  WHERE category='Thùng';
CREATE TABLE bak_20260727c."Employee"       AS SELECT * FROM public."Employee"       WHERE 'Thùng' = ANY(COALESCE(allowed_categories,'{}'));
CREATE TABLE bak_20260727c."SlotTemplate"   AS SELECT * FROM public."SlotTemplate"   WHERE cargo_type='Thùng';
CREATE TABLE bak_20260727c."DeliverySlot"   AS SELECT * FROM public."DeliverySlot"   WHERE cargo_type='Thùng';

-- 2) GÁC AN TOÀN: chỉ xoá khung giờ/slot khi CHẮC CHẮN trùng khít PK01 và chưa ai đặt
DO $$
DECLARE n_tpl bigint; n_dup bigint; n_slot bigint; n_sdup bigint; n_booked bigint;
BEGIN
  SELECT count(*) INTO n_tpl  FROM "SlotTemplate" WHERE cargo_type='Thùng';
  SELECT count(*) INTO n_dup  FROM "SlotTemplate" a JOIN "SlotTemplate" b
     ON a.warehouse_id=b.warehouse_id AND a.day_of_week=b.day_of_week
    AND a.time_from=b.time_from AND a.time_to=b.time_to
    AND a.vehicle_type_id IS NOT DISTINCT FROM b.vehicle_type_id
    AND a.direction      IS NOT DISTINCT FROM b.direction
   WHERE a.cargo_type='Thùng' AND b.cargo_type='PK01';
  IF n_tpl <> n_dup THEN
    RAISE EXCEPTION 'Có % khung giờ "Thùng" KHÔNG trùng PK01 — dừng, xử tay để không mất cấu hình', n_tpl - n_dup;
  END IF;

  SELECT count(*) INTO n_slot FROM "DeliverySlot" WHERE cargo_type='Thùng';
  SELECT count(*) INTO n_sdup FROM "DeliverySlot" a JOIN "DeliverySlot" b
     ON a.warehouse_id=b.warehouse_id AND a.date=b.date AND a.time_from=b.time_from AND a.time_to=b.time_to
    AND a.vehicle_type_id IS NOT DISTINCT FROM b.vehicle_type_id
   WHERE a.cargo_type='Thùng' AND b.cargo_type='PK01';
  IF n_slot <> n_sdup THEN
    RAISE EXCEPTION 'Có % slot ngày "Thùng" KHÔNG trùng PK01 — dừng', n_slot - n_sdup;
  END IF;

  SELECT COALESCE(sum(booked_count),0) INTO n_booked FROM "DeliverySlot" WHERE cargo_type='Thùng';
  IF n_booked > 0 THEN
    RAISE EXCEPTION 'Slot "Thùng" đang có % lượt đặt — dừng, chuyển lượt đặt sang PK01 trước', n_booked;
  END IF;
END $$;

-- 3) CHUYỂN sang PK01 (các bảng dùng 1 giá trị)
UPDATE "WarehouseZone"      SET category='PK01',       updated_at=now() WHERE category='Thùng';
UPDATE "Material"           SET category='PK01',       updated_at=now() WHERE category='Thùng';
UPDATE "Location"           SET category='PK01',       updated_at=now() WHERE category='Thùng';
UPDATE "TmsOrder"           SET warehouse_type='PK01', updated_at=now() WHERE warehouse_type='Thùng';
UPDATE "GroupDeliveryOrder" SET warehouse_type='PK01', updated_at=now() WHERE warehouse_type='Thùng';
UPDATE "ProductionImport"   SET warehouse_type='PK01', updated_at=now() WHERE warehouse_type='Thùng';
UPDATE gate_registrations   SET warehouse_type='PK01', updated_at=now() WHERE warehouse_type='Thùng';
UPDATE inbound_plan_lines   SET warehouse_type='PK01', updated_at=now() WHERE warehouse_type='Thùng';
UPDATE "PalletLabelPrint"   SET category='PK01'                          WHERE category='Thùng';
UPDATE "StocktakeLog"       SET category='PK01',       updated_at=now() WHERE category='Thùng';

-- 4) Cột MẢNG: gỡ 'Thùng', thêm 'PK01' nếu chưa có (không nhân đôi phần tử).
--    ⚠ Phải nối bằng ARRAY['PK01']::text[] — viết `|| 'PK01'` thì Postgres chọn toán tử
--    array||array rồi cố ép chuỗi thành mảng → lỗi 'malformed array literal'.
UPDATE "Employee" SET
  allowed_categories = CASE WHEN 'PK01' = ANY(array_remove(allowed_categories,'Thùng'))
                            THEN array_remove(allowed_categories,'Thùng')
                            ELSE array_remove(allowed_categories,'Thùng') || ARRAY['PK01']::text[] END,
  updated_at = now()
WHERE 'Thùng' = ANY(COALESCE(allowed_categories,'{}'));

UPDATE "Warehouse" SET
  carton_scan_categories = CASE WHEN 'PK01' = ANY(array_remove(carton_scan_categories,'Thùng'))
                                THEN array_remove(carton_scan_categories,'Thùng')
                                ELSE array_remove(carton_scan_categories,'Thùng') || ARRAY['PK01']::text[] END,
  updated_at = now()
WHERE 'Thùng' = ANY(COALESCE(carton_scan_categories,'{}'));

-- 5) Khung giờ / slot: XOÁ (trùng khít PK01 — gác ở bước 2 đã chứng minh), không đổi sang PK01
--    vì đổi sẽ tạo 174 + 90 dòng trùng lặp trong lưới đặt lịch.
DELETE FROM "DeliverySlot" WHERE cargo_type='Thùng';
DELETE FROM "SlotTemplate" WHERE cargo_type='Thùng';

-- 6) Bỏ "Thùng" khỏi danh mục Loại kho
DELETE FROM "LookupValue" WHERE type='warehouse_type' AND value='Thùng';

COMMIT;

-- ============================================================================
-- KIỂM TRA SAU KHI CHẠY — mọi số phải = 0
-- ============================================================================
-- SELECT
--   (SELECT count(*) FROM "LookupValue" WHERE type='warehouse_type' AND value='Thùng') danh_muc,
--   (SELECT count(*) FROM "WarehouseZone" WHERE category='Thùng')                      khu_vuc,
--   (SELECT count(*) FROM "Employee" WHERE 'Thùng'=ANY(COALESCE(allowed_categories,'{}'))) nhan_su,
--   (SELECT count(*) FROM "SlotTemplate" WHERE cargo_type='Thùng')                     khung_gio,
--   (SELECT count(*) FROM "DeliverySlot" WHERE cargo_type='Thùng')                     slot_ngay;
-- Khôi phục: INSERT ngược từ schema bak_20260727c. Dọn: DROP SCHEMA bak_20260727c CASCADE;
