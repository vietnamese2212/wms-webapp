-- Atomic slot booking function — giải quyết race condition khi nhiều người
-- cùng đặt 1 slot một lúc.
--
-- Cách hoạt động:
--   UPDATE ... WHERE booked_count + p_delta <= max_vehicles
--   PostgreSQL lock row trước khi update → chỉ 1 request thắng mỗi lần.
--   Nếu slot đã đầy → 0 row updated → trả về FALSE.
--
-- p_delta = +1 khi đặt slot, -1 khi nhả slot

CREATE OR REPLACE FUNCTION try_book_slot(p_slot_id UUID, p_delta INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  rows_updated INTEGER;
BEGIN
  UPDATE "DeliverySlot"
  SET booked_count = booked_count + p_delta,
      updated_at   = NOW()
  WHERE id = p_slot_id
    AND (
      (p_delta > 0 AND booked_count + p_delta <= max_vehicles)
      OR
      (p_delta < 0 AND booked_count > 0)
    );

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;
