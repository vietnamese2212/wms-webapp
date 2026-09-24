-- 20260817b: slotting_stats trả thêm is_pick_face cho từng vị trí.
--
-- VÌ SAO: engine Slotting coi MỌI ô `slot_no_in` là "kho tạm" và xếp hàng ở đó vào diện KÉO ĐI
-- (P1, chạy mỗi lượt). Nhưng vị trí NHẶT LẺ (`is_pick_face`) là nơi tính năng Fill hàng CHỦ ĐỘNG
-- đổ hàng xuống để công nhân với tay lấy — nếu người dùng đánh dấu ô nhặt lẻ là "không đưa hàng
-- vào" (ý họ: cấm cất PALLET NGUYÊN vào đó) thì hai tính năng ĐÁNH NHAU: Fill đẩy hàng xuống,
-- Slotting lại lên kế hoạch bốc chính số hàng đó đi, người thực hiện xong thì Fill lại báo thiếu.
-- Đo thật trên staging 17/08 (kho Ba Vì, cấu hình do user vừa đặt): 13 ô mang cờ slot_no_in, trong
-- đó 3 ô LÀ vị trí nhặt lẻ (KHO 1 LẺ 86 pallet · KHO 3 LẺ 74 · PIN ROBOT 47) = 207 pallet sẽ bị
-- xếp lịch dọn đi mỗi lần lập kế hoạch.
--
-- Chỉ THÊM một khoá vào jsonb 'locations' — giữ NGUYÊN mọi biểu thức khác (cùng kỷ luật với
-- 20260815h: đổi hàm đang chạy thật thì phải diff nguyên khối trước/sau).
CREATE OR REPLACE FUNCTION public.slotting_stats(p_warehouse_id text, p_categories text[] DEFAULT NULL::text[], p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
WITH classed AS (
  SELECT * FROM public.material_abc(p_warehouse_id, p_categories, p_days)
),
stock_by_zone AS (
  SELECT ie.material_id, l.sub_code,
         count(*)::int                          AS pallets,
         COALESCE(sum(ie.cartons_remaining), 0) AS cartons_base
  FROM "InventoryEntry" ie
  LEFT JOIN "Location" l ON l.id = ie.location_id
  WHERE ie.warehouse_id::text = p_warehouse_id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  GROUP BY ie.material_id, l.sub_code
),
loc_used AS (
  SELECT l.id, l.location_code, l.sub_code, l.max_pallets, l.categories,
         l.slot_no_in, l.slot_no_out, l.is_pick_face,
         count(ie.id)::int AS used_slots
  FROM "Location" l
  LEFT JOIN "InventoryEntry" ie ON ie.location_id = l.id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  WHERE l.warehouse_id = p_warehouse_id AND l.is_active = true
  GROUP BY l.id, l.location_code, l.sub_code, l.max_pallets, l.categories, l.slot_no_in, l.slot_no_out, l.is_pick_face
)
SELECT jsonb_build_object(
  'total_picks', COALESCE((SELECT sum(picks) FROM classed), 0),
  'materials', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'material_id', c.material_id, 'code', c.material_code, 'name', c.short_name,
      'category', c.category,
      'picks', c.picks, 'cartons_out', c.cartons_out,
      'pallets_touched', c.pallets_touched, 'stock_pallets', c.stock_pallets,
      'stock_cartons', c.stock_cartons, 'abc', c.abc,
      'cum_share', CASE WHEN c.total_picks > 0 THEN round(c.cum_picks::numeric / c.total_picks, 4) ELSE 0 END
    ) ORDER BY c.picks DESC, c.material_code) FROM classed c), '[]'::jsonb),
  'placement', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'material_id', s.material_id, 'sub_code', s.sub_code,
      'pallets', s.pallets,
      'cartons', s.cartons_base / (case when m2.entry_unit is not null and coalesce(m2.units_per_carton,0) > 0 then m2.units_per_carton else 1 end)))
    FROM stock_by_zone s JOIN "Material" m2 ON m2.id = s.material_id
    WHERE s.material_id IN (SELECT material_id FROM classed)), '[]'::jsonb),
  'zones', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', z.id, 'code', z.code, 'name', z.name, 'categories', z.categories,
      'pick_rank', z.pick_rank, 'flow_type', z.flow_type,
      'capacity', COALESCE(zc.capacity, 0), 'used_slots', COALESCE(zc.used_slots, 0))
      ORDER BY z.pick_rank NULLS LAST, z.sort_order)
    FROM "WarehouseZone" z
    LEFT JOIN (SELECT sub_code, sum(max_pallets)::int AS capacity, sum(used_slots)::int AS used_slots
               FROM loc_used GROUP BY sub_code) zc ON zc.sub_code = z.code
    WHERE z.warehouse_id = p_warehouse_id AND z.is_active = true), '[]'::jsonb),
  'locations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', lu.id, 'location_code', lu.location_code, 'sub_code', lu.sub_code,
      'max_pallets', lu.max_pallets, 'used_slots', lu.used_slots,
      'slot_no_in', lu.slot_no_in, 'slot_no_out', lu.slot_no_out,
      'is_pick_face', COALESCE(lu.is_pick_face, false))
      ORDER BY lu.location_code)
    FROM loc_used lu), '[]'::jsonb)
);
$function$
;
