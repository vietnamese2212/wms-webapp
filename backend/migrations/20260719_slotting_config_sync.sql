-- ĐỒNG BỘ CẤU HÌNH slotting từ STAGING → PRODUCTION (user 19/07: "dev và main giống hệt nhau").
-- Chạy SAU 4 migration slotting (20260717_slotting → 20260718_slotting_v2 → 20260718_slotting_locations
-- → 20260718_slotting_capacity_fix) — cần cột pick_rank/flow_type/slot_no_in/slot_no_out đã tồn tại.
-- Khớp theo TÊN kho + MÃ khu/vị trí (không dựa id — id khu/vị trí có thể khác giữa 2 DB).
-- Idempotent: chạy lại không sao.

-- 1) Hạng nhặt + luồng cửa các khu Kho Ba Vì (tab Cài đặt trang Tối ưu vị trí)
WITH cfg(code, pick_rank, flow_type) AS (VALUES
  ('K4GIAY', 1, 'SAME_END'), ('SCA', 1, 'SAME_END'), ('K4RAW', 1, 'SAME_END'),
  ('K2THUNG', 1, 'SAME_END'), ('K4POSM', 1, 'SAME_END'), ('NVLMAT', 1, 'SAME_END'),
  ('TP1', 1, 'SAME_END'), ('K4THUNG', 2, 'SAME_END'), ('TP2', 2, 'SAME_END'), ('TP3', 3, 'SAME_END')
)
UPDATE "WarehouseZone" z
SET pick_rank = cfg.pick_rank, flow_type = cfg.flow_type, updated_at = now()
FROM cfg, "Warehouse" w
WHERE w.name = 'Kho Ba Vì' AND z.warehouse_id = w.id AND z.code = cfg.code;

-- 2) Vị trí đặc biệt Kho Ba Vì (no_in = không đưa hàng vào; B_TP2_Mặt đất thêm no_out)
UPDATE "Location" l
SET slot_no_in = true,
    slot_no_out = (l.location_code = 'B_TP2_Mặt đất'),
    updated_at = now()
FROM "Warehouse" w
WHERE w.name = 'Kho Ba Vì' AND l.warehouse_id = w.id
  AND l.location_code IN (
    'B_TP1_Kho 1 lẻ','B_TP1_Kho QA','B_TP1_Kho SX','B_TP1_Không rõ','B_TP1_KPH',
    'B_TP1_Ngoài đường Cont','B_TP1_Ngoài đường PL1','B_TP1_Ngoài đường PL2',
    'B_TP1_Ngoài đường SCA','B_TP1_Pin robot','B_TP2_Mặt đất','B_TP3_Kho 3 lẻ','B_TP3_Rack lẻ'
  );

-- 3) Quét tem thùng khi xuất — Kho Ba Vì bật, loại [Thành phẩm] (khớp staging; bỏ khối này nếu
--    production muốn cấu hình khác)
UPDATE "Warehouse" SET carton_scan_override = true, carton_scan_categories = ARRAY['Thành phẩm'],
  carton_scan_require_full = false, updated_at = now()
WHERE name = 'Kho Ba Vì';

-- Kiểm sau khi chạy:
--   SELECT code, pick_rank, flow_type FROM "WarehouseZone" z JOIN "Warehouse" w ON w.id=z.warehouse_id
--   WHERE w.name='Kho Ba Vì' AND pick_rank IS NOT NULL;  -- kỳ vọng 10 dòng
--   SELECT count(*) FROM "Location" l JOIN "Warehouse" w ON w.id=l.warehouse_id
--   WHERE w.name='Kho Ba Vì' AND l.slot_no_in;           -- kỳ vọng 13
