-- Track pallet chung POSM/Loscam per inbound order
-- posm_entry_id: UUID của InventoryEntry chung — set sau khi lưu thủ công
-- NULL = chưa lưu, NOT NULL = đã lưu (enforce 1 lần mỗi phiếu)
ALTER TABLE "ProductionImport" ADD COLUMN IF NOT EXISTS posm_entry_id UUID;
