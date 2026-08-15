-- Nhật ký kiểm kê (append-only): 1 dòng MỖI LẦN kiểm, KHÔNG ghi đè.
-- Cho phép xem lại kết quả kiểm của bất kỳ ngày/đợt nào, vô thời hạn — kể cả pallet
-- sau đó đã xuất đi hoặc đã kiểm lại nhiều lần. Snapshot đủ trường hiển thị để KHÔNG
-- phụ thuộc dòng tồn sống (entry/location/material có thể đổi/mất về sau).
-- LƯU Ý: mọi cột id là TEXT (khớp kiểu id toàn app — lưu chuỗi UUID trong TEXT).
CREATE TABLE IF NOT EXISTS "StocktakeLog" (
  id                  TEXT PRIMARY KEY,
  entry_id            TEXT REFERENCES "InventoryEntry"(id) ON DELETE SET NULL,
  pallet_code         TEXT NOT NULL,
  location_id         TEXT REFERENCES "Location"(id) ON DELETE SET NULL,
  location_code       TEXT,
  warehouse_id        TEXT,
  category            TEXT,                 -- loại kho của vị trí (để cắt scope loại như báo cáo)
  material_id         TEXT,
  material_code       TEXT,
  short_name          TEXT,
  base_unit           TEXT,
  entry_unit          TEXT,
  units_per_carton    NUMERIC,
  app_qty             NUMERIC,              -- tồn app (BASE) tại thời điểm kiểm
  physical_qty        NUMERIC,              -- SL thực đếm (BASE); NULL nếu chỉ đánh dấu đã kiểm
  diff                NUMERIC,              -- physical - app (NULL nếu physical NULL)
  is_flagged          BOOLEAN DEFAULT false,
  note                TEXT,
  location_changed_to TEXT,                 -- vị trí mới nếu lần kiểm này đổi vị trí
  counted_by          TEXT REFERENCES "Employee"(id) ON DELETE SET NULL,
  counted_by_name     TEXT,
  counted_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stocktakelog_wh_at   ON "StocktakeLog" (warehouse_id, counted_at DESC);
CREATE INDEX IF NOT EXISTS idx_stocktakelog_loc_at  ON "StocktakeLog" (location_id, counted_at DESC);
CREATE INDEX IF NOT EXISTS idx_stocktakelog_at      ON "StocktakeLog" (counted_at DESC);

-- ── Bổ sung 05/08 (cảnh báo Supabase rls_disabled_in_public) ─────────────────
-- Bảng này từng được tạo KHÔNG bật RLS → hở với anon key suốt từ 24/07. Đóng ngay trong
-- migration TẠO BẢNG (idempotent) để production apply lúc merge là kín luôn, không phụ thuộc
-- thứ tự với 20260805c. Realtime màn Kiểm kê cần policy đọc cho authenticated + publication
-- (bật RLS mà thiếu policy = realtime chết CÂM — bài học weigh_ticket/forklift).
ALTER TABLE "StocktakeLog" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'StocktakeLog'
                   AND policyname = 'rls_auth_select') THEN
    CREATE POLICY rls_auth_select ON public."StocktakeLog"
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'StocktakeLog') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "StocktakeLog";
  END IF;
END $$;
