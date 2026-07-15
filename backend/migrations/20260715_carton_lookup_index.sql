-- Tra cứu NGƯỢC tem thùng (user chốt 15/07): cầm 1 mã tem → tìm dòng scan pallet chứa tem đó.
-- Query dùng jsonb containment: carton_scans @> '[{"code":"<tem>"}]'
-- GIN jsonb_path_ops index để không seq-scan khi OutboundScanEntry lên hàng triệu dòng.
CREATE INDEX IF NOT EXISTS idx_outbound_scan_carton_scans
  ON public."OutboundScanEntry" USING gin (carton_scans jsonb_path_ops);
