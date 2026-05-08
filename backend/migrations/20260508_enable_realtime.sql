-- Enable Supabase Realtime for WMS tables
-- Run this once in Supabase Dashboard > SQL Editor
ALTER PUBLICATION supabase_realtime
  ADD TABLE "ProductionImport", "InventoryEntry", "Location", "Material", "Manufacturer", "Warehouse";
