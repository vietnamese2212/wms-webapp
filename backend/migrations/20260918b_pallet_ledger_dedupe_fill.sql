-- ============================================================================
-- SỔ PALLET — bỏ dòng TRÙNG khi hạ hàng xuống kho lẻ (18/09/2026)
--
-- 18/09 vá lớp lỗi 'hai cửa cùng một sổ mà khác luật': 5 cửa chuyển ô pallet nhưng chỉ 3 cửa ghi
-- sổ Chuyển vị trí. Nối nốt 2 cửa còn lại (quét lệnh fill · đặt phần dư khi quét xuất) thì sinh
-- hệ quả: nguồn 3 (StocktakeLog → MOVED) và nguồn 6 (FillTaskScan → FILLED) cùng kể MỘT lần hạ,
-- cùng rơi vào nhóm STOCK.
--
-- Cửa 'đặt phần dư khi xuất' KHÔNG trùng: PICKED (hàng đi ra) và MOVED (phần dư đổi chỗ) là hai
-- việc khác nhau, kể cả hai là đúng. Chỉ fill mới trùng.
--
-- Giữ FILLED, bỏ MOVED tương ứng — vì FILLED giàu hơn (có số lượng + mã lệnh). Dòng MOVED vẫn
-- nằm trong DB và vẫn hiện ở tab Lịch sử của màn Chuyển vị trí (nơi câu hỏi là 'pallet đổi ô mấy
-- lần'), chỉ không hiện lần thứ hai trong Sổ pallet.
-- ============================================================================

DROP FUNCTION IF EXISTS public.pallet_ledger(text, text[], integer);
CREATE OR REPLACE FUNCTION public.pallet_ledger(
  p_pallet_code  text,
  p_warehouse_ids text[] DEFAULT NULL,   -- NULL = không giới hạn (user phạm vi toàn quốc)
  p_limit        integer DEFAULT 400
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_events jsonb;
  v_pallet jsonb;
BEGIN
  WITH ev AS (
    -- 1. SX GHI SỔ ĐÓNG GÓI — pallet ra đời
    SELECT COALESCE(pl.close_scan_at, pl.open_scan_at, pl.created_at) AS at,
           'PACKED'::text            AS kind,
           pl.packed_by_name         AS actor,
           NULL::text                AS from_code,
           NULL::text                AS to_code,
           pl.qty_cartons            AS qty_base,   -- cột tên "cartons" nhưng GIÁ TRỊ là base (xem đầu file)
           NULL::numeric             AS qty_cartons, -- giữ ô này rỗng: không nguồn nào ghi theo thùng
           pl.warehouse_id           AS warehouse_id,
           NULLIF(pl.machine_code,'') AS ref,
           pl.note                   AS note
      FROM public.packing_logs pl
     WHERE pl.pallet_code = p_pallet_code AND pl.status <> 'CANCELLED'

    UNION ALL
    -- 2. VÀO SỔ TỒN (nhập kho / tách ra pallet con) — dòng InventoryEntry được tạo
    SELECT ie.created_at, 'RECEIVED', emp.name,
           NULL, loc.location_code, ie.cartons_imported, NULL,
           ie.warehouse_id,
           CASE WHEN ie.parent_pallet_code IS NOT NULL THEN 'tách từ ' || ie.parent_pallet_code END,
           NULL
      FROM public."InventoryEntry" ie
      LEFT JOIN public."Location" loc ON loc.id = ie.location_id
      LEFT JOIN public."Employee" emp ON emp.id = ie.created_by
     WHERE ie.pallet_code = p_pallet_code

    UNION ALL
    -- 3. CHUYỂN VỊ TRÍ / KIỂM KÊ — một sổ, phân biệt bằng location_changed_to
    SELECT sl.counted_at,
           CASE WHEN sl.location_changed_to IS NOT NULL THEN 'MOVED' ELSE 'COUNTED' END,
           sl.counted_by_name, sl.location_from_code, sl.location_code,
           sl.physical_qty, NULL, sl.warehouse_id, NULL, sl.note
      FROM public."StocktakeLog" sl
     WHERE sl.pallet_code = p_pallet_code
       -- KHÔNG KỂ HAI LẦN MỘT VIỆC (18/09): từ hôm nay cửa quét lệnh fill cũng ghi vào sổ chuyển
       -- vị trí (trước đó nó chuyển chỗ pallet mà KHÔNG để lại vết nào — tab Lịch sử của màn
       -- Chuyển vị trí im lặng về đúng việc mà lệnh fill sinh ra). Nhưng nguồn 6 dưới đây ĐÃ kể
       -- lần hạ đó rồi, lại kể giàu hơn (có số lượng + mã lệnh), nên nếu để nguyên thì một lần hạ
       -- hiện THÀNH HAI DÒNG trong cùng nhóm STOCK — đúng thứ mà cả hàm này cố tránh ('thứ cần
       -- đọc chìm nghỉm'). Bỏ dòng MOVED nào đã có vết quét fill khớp (cùng pallet, cùng ô đến,
       -- lệch giờ dưới 2 phút). So theo DỮ LIỆU, KHÔNG so theo câu chữ của ghi chú.
       -- Vết fill bị xoá sau này (xoá lệnh ⇒ CASCADE) thì dòng MOVED tự hiện lại: nó là bản ghi
       -- BỀN (FK entry_id chỉ SET NULL), nên sổ không bao giờ mất trắng lần hạ đó.
       AND NOT (
         sl.location_changed_to IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public."FillTaskScan" fs
            WHERE fs.pallet_code     = sl.pallet_code
              AND fs.to_location_id  = sl.location_changed_to
              AND fs.created_at BETWEEN sl.counted_at - interval '2 minutes'
                                    AND sl.counted_at + interval '2 minutes'
         )
       )

    UNION ALL
    -- 4. ĐIỀU CHỈNH TỒN (+/-)
    SELECT al.adjusted_at, 'ADJUSTED', al.actor_name, NULL, NULL,
           al.delta, NULL, ie.warehouse_id,
           ie.cartons_remaining::text, al.note
      FROM public."InventoryAdjustmentLog" al
      JOIN public."InventoryEntry" ie ON ie.id = al.entry_id
     WHERE ie.pallet_code = p_pallet_code

    UNION ALL
    -- 5. DỒN / TÁCH PALLET — tem có thể là NGUỒN hoặc ĐÍCH của thao tác
    SELECT po.created_at,
           CASE WHEN po.type = 'MERGE' THEN 'MERGED'
                WHEN po.type = 'SPLIT' THEN 'SPLIT'
                ELSE 'UNGROUPED' END,
           po.operated_by_name, NULL, NULL, NULL, NULL, po.warehouse_id,
           NULL,
           CASE WHEN p_pallet_code = ANY(po.source_codes) THEN 'tem này là NGUỒN'
                ELSE 'tem này là KẾT QUẢ' END
      FROM public."PalletOperation" po
     WHERE (po.source_codes @> ARRAY[p_pallet_code] OR po.target_codes @> ARRAY[p_pallet_code])
       AND po.undone_at IS NULL

    UNION ALL
    -- 5b. …và lần HOÀN TÁC thao tác đó (nếu có) là một tác động riêng
    SELECT po.undone_at, 'UNDONE', po.undone_by_name, NULL, NULL, NULL, NULL, po.warehouse_id,
           NULL, 'hoàn tác ' || po.type
      FROM public."PalletOperation" po
     WHERE (po.source_codes @> ARRAY[p_pallet_code] OR po.target_codes @> ARRAY[p_pallet_code])
       AND po.undone_at IS NOT NULL

    UNION ALL
    -- 6. HẠ XUỐNG KHO LẺ (quét lệnh fill)
    SELECT fs.created_at, 'FILLED', fs.scanned_by_name,
           fs.from_location_code, fs.to_location_code, fs.qty_base, NULL,
           loc.warehouse_id, fo.order_code, NULL
      FROM public."FillTaskScan" fs
      LEFT JOIN public."Location"  loc ON loc.id = fs.to_location_id
      LEFT JOIN public."FillOrder" fo  ON fo.id  = fs.fill_order_id
     WHERE fs.pallet_code = p_pallet_code

    UNION ALL
    -- 7. XUẤT HÀNG (quét tem ở cửa) — chứng từ = Số xe của chuyến
    SELECT ose.scanned_at AT TIME ZONE 'UTC', 'PICKED', emp.name, NULL, NULL,
           ose.cartons_scanned, NULL, g.warehouse_id,
           COALESCE(g.group_code, g.license_plate),
           CASE WHEN ose.is_loose_picking THEN 'nhặt lẻ' END
      FROM public."OutboundScanEntry" ose
      LEFT JOIN public."Employee"          emp ON emp.id = ose.scanned_by
      LEFT JOIN public."OutboundItem"      oi  ON oi.id  = ose.item_id
      LEFT JOIN public."OutboundDelivery"  od  ON od.id  = oi.do_id
      LEFT JOIN public."GroupDeliveryOrder" g  ON g.id   = od.gdo_id
     WHERE ose.pallet_code = p_pallet_code

    UNION ALL
    -- 8. NHẬT KÝ VIỆC (Việc cần làm) — giao việc, nhận, hạ, đưa ra, hệ thống huỷ.
    -- CHỈ việc có ghim tem mới vào đây: lệnh fill chỉ định theo mã + date nên không gắn pallet nào
    -- cho tới lúc quét (lúc đó đã nằm ở nguồn 6).
    SELECT e.at, 'TASK_' || e.event, e.actor,
           t.from_location_code, COALESCE(dl.location_code, tl.location_code),
           NULL, NULL, t.warehouse_id,
           COALESCE(g.group_code, g.license_plate), e.note
      FROM public.wms_task_events e
      JOIN public.wms_tasks t ON t.id = e.task_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
     WHERE t.pallet_code = p_pallet_code
  )
  -- HAI NHÓM, KHÔNG TRỘN (đo ngay lượt chạy đầu 17/09): một pallet ở Ba Vì có **105 dòng nhật ký
  -- việc** (máy lập kế hoạch rồi huỷ qua nhiều chuyến) trong khi tác động THẬT lên hàng chỉ có 2
  -- (nhập kho · xuất). Đổ chung một danh sách thì thứ cần đọc chìm nghỉm. `grp='STOCK'` = hàng thật
  -- sự bị động vào; `grp='TASK'` = việc được giao/nhận/huỷ. Cũng đúng cách SAP chia: MB51 là chứng
  -- từ vật tư, còn lệnh kho nằm ở LT23/LT24 riêng.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'grp', CASE WHEN x.kind LIKE 'TASK\_%' THEN 'TASK' ELSE 'STOCK' END,
           'at', x.at, 'kind', x.kind, 'actor', x.actor,
           'from_code', x.from_code, 'to_code', x.to_code,
           'qty_base', x.qty_base, 'qty_cartons', x.qty_cartons,
           'warehouse_id', x.warehouse_id, 'ref', x.ref, 'note', x.note
         ) ORDER BY x.at), '[]'::jsonb)
    INTO v_events
    FROM (
      -- Trần áp cho TỪNG NHÓM, không áp cho cả danh sách: pallet bị lập kế hoạch đi lập kế hoạch lại
      -- có hàng trăm dòng việc, cắt phẳng theo thời gian sẽ hất văng chính mấy dòng "hàng đã bị động
      -- vào" — thứ duy nhất người tra cần. Mỗi nhóm giữ bản GẦN ĐÂY NHẤT rồi sắp lại theo thời gian.
      SELECT * FROM (
        SELECT ev.*,
               row_number() OVER (
                 PARTITION BY (CASE WHEN ev.kind LIKE 'TASK\_%' THEN 'TASK' ELSE 'STOCK' END)
                 ORDER BY ev.at DESC
               ) AS rn
          FROM ev
         WHERE ev.at IS NOT NULL
           -- Cắt phạm vi kho, null-inclusive như mọi chỗ khác trong app (bản ghi không khai kho vẫn hiện)
           AND (p_warehouse_ids IS NULL OR ev.warehouse_id IS NULL OR ev.warehouse_id = ANY(p_warehouse_ids))
      ) z
      WHERE z.rn <= GREATEST(1, LEAST(p_limit, 2000))
    ) x;

  -- Ảnh hiện tại của tem (có thể nhiều dòng nếu tem từng được dùng lại sau khi xuất hết)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'entry_id', ie.id, 'status', ie.status, 'warehouse_id', ie.warehouse_id,
           'warehouse_name', w.name, 'location_code', loc.location_code,
           'material_code', m.material_code, 'material_name', m.short_name, 'category', m.category,
           'entry_unit', m.entry_unit, 'base_unit', m.base_unit, 'units_per_carton', m.units_per_carton,
           'cartons_imported', ie.cartons_imported, 'cartons_remaining', ie.cartons_remaining,
           'production_date', ie.production_date, 'expiry_date', ie.expiry_date, 'batch', ie.batch,
           'import_date', ie.import_date
         ) ORDER BY ie.created_at), '[]'::jsonb)
    INTO v_pallet
    FROM public."InventoryEntry" ie
    LEFT JOIN public."Location"  loc ON loc.id = ie.location_id
    LEFT JOIN public."Warehouse" w   ON w.id   = ie.warehouse_id
    LEFT JOIN public."Material"  m   ON m.id   = ie.material_id
   WHERE ie.pallet_code = p_pallet_code
     AND (p_warehouse_ids IS NULL OR ie.warehouse_id IS NULL OR ie.warehouse_id = ANY(p_warehouse_ids));

  RETURN jsonb_build_object('pallet_code', p_pallet_code, 'entries', v_pallet, 'events', v_events);
END $$;

REVOKE ALL ON FUNCTION public.pallet_ledger(text, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pallet_ledger(text, text[], integer) TO service_role;

COMMIT;
