-- Rev 13: add warehouse_type column to GroupDeliveryOrder
-- Apply via Supabase Dashboard → SQL Editor

ALTER TABLE "GroupDeliveryOrder"
  ADD COLUMN IF NOT EXISTS warehouse_type TEXT;
