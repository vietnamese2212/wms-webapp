-- Hoàn tác thao tác dồn/tách: đánh dấu đã hoàn tác (ai, lúc nào)
ALTER TABLE "PalletOperation" ADD COLUMN IF NOT EXISTS undone_at timestamptz;
ALTER TABLE "PalletOperation" ADD COLUMN IF NOT EXISTS undone_by text;
ALTER TABLE "PalletOperation" ADD COLUMN IF NOT EXISTS undone_by_name text;
