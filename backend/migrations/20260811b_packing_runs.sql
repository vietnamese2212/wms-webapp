-- 20260811b — LỆNH MỞ TRANG SỔ ĐÓNG GÓI (user chốt 11/08 chiều):
-- Trước khi quét tem pallet phải MỞ TRANG SỔ (1 dòng = 1 trang sản phẩm trong sổ viết tay):
-- Kho + Ngày + Ca SX + Chu kỳ + Mã SP + Máy + Giờ bắt đầu; bấm "Giờ kết thúc" khi xong
-- → tính TỔNG SẢN LƯỢNG (Σ thùng các pallet đã ghi vào trang). Quét tem CHỈ được khi có
-- trang sổ đang MỞ khớp mã — pallet gắn run_id để gom/tra cứu.

CREATE TABLE IF NOT EXISTS packing_runs (
  id             uuid PRIMARY KEY,
  warehouse_id   text NOT NULL,
  run_date       date NOT NULL,
  shift          text,
  cycle          text,
  material_code  text NOT NULL,
  material_id    uuid,
  machine_code   text NOT NULL,
  start_at       timestamptz NOT NULL,
  end_at         timestamptz,
  qty_total      numeric,          -- Σ thùng các pallet trong trang — tính khi bấm Giờ kết thúc
  pallet_count   integer,
  status         text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','CANCELLED')),
  opened_by      uuid,
  opened_by_name text,
  closed_by      uuid,
  closed_by_name text,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL
);

-- 1 trang MỞ duy nhất per (kho, mã, máy) — 2 người cùng mở trùng: người sau nhận 23505 → 409
CREATE UNIQUE INDEX IF NOT EXISTS uq_packing_run_open
  ON packing_runs (warehouse_id, material_code, machine_code) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_packing_runs_date ON packing_runs (run_date DESC);
CREATE INDEX IF NOT EXISTS idx_packing_runs_open ON packing_runs (material_code) WHERE status = 'OPEN';

ALTER TABLE packing_logs ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES packing_runs(id);
CREATE INDEX IF NOT EXISTS idx_packing_logs_run ON packing_logs (run_id);

-- Realtime: RLS bật + policy SELECT authenticated (thiếu policy = realtime CHẾT CÂM — memory realtime-rls-silent-death)
ALTER TABLE packing_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS packing_runs_read ON packing_runs;
CREATE POLICY packing_runs_read ON packing_runs FOR SELECT TO authenticated USING (true);
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE packing_runs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
