-- 15/08/2026 — ĐỐI CHIẾU SX↔KHO Ở CẤP TRANG SỔ (user: "giao diện quản lý sổ cần thể hiện sổ nào
-- kho đã nhập hết, sổ nào chưa — dạng symbol").
--
-- Cấp PALLET đã có sẵn (getRun.attachReceived + RPC packing_logs_recon cho tab Sổ pallet).
-- Cấp TRANG thì chưa: list/board cố ý KHÔNG trả mảng pallet về client (check-app 13/08 đo 2,2MB
-- @60 pallet/trang — trang thật 100-150 pallet sẽ vượt trần 4,5MB Vercel).
--
-- ⇒ ĐẾM TRONG SQL, đừng kéo tem về đếm ở backend: 50 trang × ~100 pallet = ~5.000 pallet_code,
-- tra InventoryEntry theo chunk 300 = 17 round-trip PostgREST MỖI LẦN MỞ TRANG (pool ~10 khe
-- dùng chung — luật CLAUDE.md "đừng KÉO DÒNG để tính ra một TẬP"). RPC này = 1 round-trip.
--
-- recv_count = pallet kho ĐÃ quét nhập (tồn tại InventoryEntry cùng pallet_code — nhập rồi xuất
--              vẫn tính ĐÃ NHẬN, giống attachReceived); diff_count = đã nhận nhưng SL kho ≠ sổ
--              (chỉ kết luận khi CẢ HAI bên có số). Dòng CANCELLED không tính, khớp aggRuns.
CREATE OR REPLACE FUNCTION packing_runs_received(p_run_ids uuid[])
RETURNS TABLE(run_id uuid, recv_count integer, diff_count integer)
LANGUAGE sql
STABLE
AS $$
  WITH l AS (
    SELECT pl.run_id,
           pl.qty_cartons,
           (SELECT e.cartons_imported
              FROM "InventoryEntry" e
             WHERE e.pallet_code = pl.pallet_code
             ORDER BY e.created_at
             LIMIT 1) AS recv_qty,
           EXISTS (SELECT 1 FROM "InventoryEntry" e WHERE e.pallet_code = pl.pallet_code) AS received
      FROM packing_logs pl
     WHERE pl.run_id = ANY(p_run_ids)
       AND pl.status <> 'CANCELLED'
  )
  SELECT l.run_id,
         COUNT(*) FILTER (WHERE l.received)::int,
         COUNT(*) FILTER (WHERE l.received AND l.qty_cartons IS NOT NULL
                            AND l.recv_qty IS NOT NULL AND l.recv_qty <> l.qty_cartons)::int
    FROM l
   GROUP BY l.run_id;
$$;

-- idx_packing_logs_* (20260813e) phủ lọc theo run_id; idx_inventory_pallet_code (20260813)
-- phủ tra pallet_code — không cần index mới.
