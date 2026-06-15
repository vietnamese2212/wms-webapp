-- Dồn / Tách pallet
-- parent_pallet_code: tem con (đã dồn) trỏ về mã tem đích; tem đích/độc lập = NULL
-- origin: nguồn gốc entry — 'IMPORT' (nhập kho) | 'SPLIT' (tách ra) → báo cáo nhập lọc IMPORT
ALTER TABLE "InventoryEntry" ADD COLUMN IF NOT EXISTS parent_pallet_code text;
ALTER TABLE "InventoryEntry" ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'IMPORT';
CREATE INDEX IF NOT EXISTS idx_inv_parent_pallet ON "InventoryEntry"(parent_pallet_code);

-- Truy vết thao tác dồn/tách + hoàn tác
CREATE TABLE IF NOT EXISTS "PalletOperation" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             text NOT NULL,                      -- MERGE | UNGROUP | SPLIT
  source_codes     text[] NOT NULL DEFAULT '{}',
  target_codes     text[] NOT NULL DEFAULT '{}',
  detail           jsonb,                              -- { children: [{code, qty}], ... }
  operated_by      text,
  operated_by_name text,
  warehouse_id     uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pallet_op_created ON "PalletOperation"(created_at DESC);
