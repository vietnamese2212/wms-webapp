-- Liên kết nhân viên với đơn vị vận tải (ĐVVT) để scoping kế hoạch vận chuyển
ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS ncc_id UUID REFERENCES "TransportCompany"(id) ON DELETE SET NULL;
