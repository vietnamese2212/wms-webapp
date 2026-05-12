-- Add category to Location table
-- Values should mirror Material.category (e.g., 'Thành phẩm', 'NVL', 'Bao bì')
-- Null = uncategorized location, accepts any pallet category (backwards compatible)
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS category text;
