-- Gom các tem in cùng 1 lệnh (1 lần bấm In) vào 1 batch_id → tab "Lịch sử in" liệt kê theo lệnh.
ALTER TABLE "PalletLabelPrint" ADD COLUMN IF NOT EXISTS batch_id uuid;
CREATE INDEX IF NOT EXISTS idx_pallet_print_batch ON "PalletLabelPrint"(batch_id);
