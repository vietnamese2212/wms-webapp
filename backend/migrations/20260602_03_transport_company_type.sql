-- Thêm loại (ĐVVT / NCC) cho TransportCompany
ALTER TABLE "TransportCompany"
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'ĐVVT'
  CHECK (type IN ('ĐVVT', 'NCC'));
