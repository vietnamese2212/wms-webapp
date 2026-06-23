-- ============================================================================
-- Đặt lịch TMS — kế toán slot NGUYÊN TỬ (chống overbooking + drift khi hàng trăm
-- user đặt cùng lúc lúc 17-18h). Thay cơ chế cũ "đọc countSameBooking rồi ±1
-- booked_count" (không nguyên tử → race) bằng:
--   • Capacity kiểm bằng ĐẾM SỐNG biển-số-distinct trong slot DƯỚI ROW-LOCK
--     (không tin booked_count) → không thể vượt max_vehicles dù đua thế nào.
--   • booked_count chỉ còn là CACHE hiển thị, tính lại bằng recount_slot() trong
--     cùng transaction giữ lock → không bao giờ lệch gây hậu quả.
-- Idempotent: CREATE OR REPLACE + ADD CONSTRAINT IF NOT EXISTS pattern.
-- ============================================================================

-- Quy ước "occupancy" (số xe chiếm chỗ) của 1 slot:
--   = (số dòng BOOKED/ARRIVED/DONE chưa có biển số, mỗi dòng = 1 chỗ)
--   + (số BIỂN SỐ distinct của các dòng đã có biển số)
-- → 1 xe vật lý (1 biển) gánh nhiều đơn trong cùng slot chỉ tính 1 chỗ (gom chuyến).

-- 1) recount_slot: khóa slot, tính lại booked_count từ dữ liệu THỰC.
CREATE OR REPLACE FUNCTION recount_slot(p_slot_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  IF p_slot_id IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM "DeliverySlot" WHERE id = p_slot_id FOR UPDATE;
  SELECT COUNT(*) FILTER (WHERE license_plate IS NULL)
       + COUNT(DISTINCT license_plate) FILTER (WHERE license_plate IS NOT NULL)
    INTO v_n
  FROM "TmsVehicleSlot"
  WHERE slot_id = p_slot_id AND status IN ('BOOKED','ARRIVED','DONE');
  UPDATE "DeliverySlot" SET booked_count = v_n, updated_at = NOW() WHERE id = p_slot_id;
END $$;

-- 2) book_vehicle_slot: gán/đổi/nhả slot cho 1 TmsVehicleSlot — NGUYÊN TỬ.
--    Trả: 'OK' | 'FULL' | 'NOT_FOUND' | 'SLOT_NOT_FOUND'.
--    p_new_slot_id = NULL  → nhả slot (release/revoke), set status PENDING.
CREATE OR REPLACE FUNCTION book_vehicle_slot(
  p_vslot_id     uuid,
  p_new_slot_id  uuid,
  p_plate        text,
  p_status       text,
  p_actor        text
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_old_slot      uuid;
  v_max           int;
  v_occ           int;
  v_plate_present boolean;
  v_new_status    text;
BEGIN
  -- Khóa dòng vehicle slot
  SELECT slot_id INTO v_old_slot FROM "TmsVehicleSlot" WHERE id = p_vslot_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;

  -- Khóa các DeliverySlot bị ảnh hưởng theo THỨ TỰ id tăng dần → tránh deadlock
  PERFORM id FROM "DeliverySlot"
   WHERE id = ANY (ARRAY[v_old_slot, p_new_slot_id]::uuid[])
   ORDER BY id
   FOR UPDATE;

  v_new_status := COALESCE(p_status,
    CASE WHEN p_new_slot_id IS NOT NULL THEN 'BOOKED' ELSE 'PENDING' END);

  -- Kiểm sức chứa chỉ khi GÁN vào slot (đếm SỐNG, không tin booked_count)
  IF p_new_slot_id IS NOT NULL THEN
    SELECT max_vehicles INTO v_max FROM "DeliverySlot" WHERE id = p_new_slot_id;
    IF v_max IS NULL THEN RETURN 'SLOT_NOT_FOUND'; END IF;

    -- Biển số này đã chiếm chỗ trong slot chưa (gom chuyến)? (loại trừ chính dòng này)
    v_plate_present := (p_plate IS NOT NULL) AND EXISTS (
      SELECT 1 FROM "TmsVehicleSlot"
       WHERE slot_id = p_new_slot_id AND id <> p_vslot_id
         AND license_plate = p_plate AND status IN ('BOOKED','ARRIVED','DONE'));

    IF NOT v_plate_present THEN
      SELECT COUNT(*) FILTER (WHERE license_plate IS NULL)
           + COUNT(DISTINCT license_plate) FILTER (WHERE license_plate IS NOT NULL)
        INTO v_occ
      FROM "TmsVehicleSlot"
       WHERE slot_id = p_new_slot_id AND id <> p_vslot_id
         AND status IN ('BOOKED','ARRIVED','DONE');
      IF v_occ + 1 > v_max THEN RETURN 'FULL'; END IF;
    END IF;
  END IF;

  -- Áp thay đổi (các trường kế toán)
  UPDATE "TmsVehicleSlot"
     SET slot_id       = p_new_slot_id,
         license_plate = p_plate,
         status        = v_new_status,
         booked_by     = p_actor,
         updated_at    = NOW()
   WHERE id = p_vslot_id;

  -- Tính lại cache booked_count cho slot cũ + mới (đã giữ lock)
  IF v_old_slot IS DISTINCT FROM p_new_slot_id THEN
    PERFORM recount_slot(v_old_slot);
  END IF;
  PERFORM recount_slot(p_new_slot_id);

  RETURN 'OK';
END $$;

-- 3) Backfill: chuẩn hóa booked_count tất cả slot theo dữ liệu thực.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM "DeliverySlot" LOOP
    PERFORM recount_slot(r.id);
  END LOOP;
END $$;

-- 4) Lưới an toàn DB: 0 <= booked_count <= max_vehicles (chống overbooking tận tầng DB).
ALTER TABLE "DeliverySlot" DROP CONSTRAINT IF EXISTS delivery_slot_booked_count_nonneg;
ALTER TABLE "DeliverySlot" ADD  CONSTRAINT delivery_slot_booked_count_nonneg CHECK (booked_count >= 0);
ALTER TABLE "DeliverySlot" DROP CONSTRAINT IF EXISTS delivery_slot_booked_count_max;
ALTER TABLE "DeliverySlot" ADD  CONSTRAINT delivery_slot_booked_count_max CHECK (booked_count <= max_vehicles);
