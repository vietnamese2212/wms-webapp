-- 20260813e — CHECK-APP dữ liệu lớn 13/08 (seed 72.000 dòng sổ đo thật): 2 index thiếu.
-- (1) recon/list lọc (warehouse_id, open_scan_at) đang SEQ SCAN toàn bảng (EXPLAIN: 1,1s/72k dòng,
--     tăng tuyến tính theo năm — bảng sổ vài trăm nghìn dòng/năm).
CREATE INDEX IF NOT EXISTS idx_packing_logs_wh_scan ON packing_logs (warehouse_id, open_scan_at DESC);
-- (2) quét tem tra dòng sống theo pallet_code (gate 1-tem-1-dòng + đối chiếu) cũng seq scan
--     → mỗi lượt quét chậm dần theo size bảng (đo: ghi p95 ~20s khi 25 đọc nặng cùng lúc).
CREATE INDEX IF NOT EXISTS idx_packing_logs_pallet ON packing_logs (pallet_code);
