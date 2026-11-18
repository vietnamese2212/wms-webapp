-- 18/11 (e) — FIFO / LIFO SO THEO NGÀY NHẬP KHO (user chốt 18/11: "FIFO theo ngày nhập", kể cả Xuất kho; trước đó FIFO / LIFO
-- so NSX — trùng FEFO khi cùng hạn dùng). Luật nằm ở backend/src/utils/rotation.ts (rotationSortKey đọc InventoryEntry.import_date).
-- Phần CẤT HÀNG dựng "khoảng ngày của ô" từ hàm này ⇒ mỗi nhóm lô trả thêm ngày nhập sớm / muộn nhất (imin / imax), để kho chạy
-- FIFO / LIFO kiểm "trộn date" theo đúng ngày mà luật lấy hàng dùng. Không đổi chữ ký hàm (lots vẫn là jsonb) ⇒ code cũ bỏ qua
-- hai khoá mới. Phần còn lại giữ nguyên bản đang chạy.
BEGIN;

CREATE OR REPLACE FUNCTION public.putaway_slot_facts(p_loc_ids text[], p_material_id text DEFAULT NULL::text, p_with_lots boolean DEFAULT false, p_with_mats boolean DEFAULT false)
 RETURNS TABLE(location_id text, pallets integer, materials integer, same_material boolean, qa_hold boolean, nccs uuid[], mats text[], lots jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  WITH live AS (
    SELECT ie.location_id, ie.material_id, ie.ncc_id, ie.qa_status_id,
           ie.production_date, ie.import_date, ie.expiry_date, ie.shelf_life_days
    FROM public."InventoryEntry" ie
    WHERE ie.location_id = ANY(p_loc_ids)
      AND ie.stack_layer = 1
      AND ie.status IN ('IN_STOCK', 'PARTIAL')
      AND COALESCE(ie.cartons_remaining, 0) > 0
  ),
  grp AS (
    SELECT l.location_id, l.material_id, l.ncc_id, l.shelf_life_days,
           (l.expiry_date IS NULL)  AS no_exp,
           min(l.production_date)   AS pmin,
           max(l.production_date)   AS pmax,
           min(l.expiry_date)       AS emin,
           max(l.expiry_date)       AS emax,
           min(l.import_date)       AS imin,
           max(l.import_date)       AS imax
    FROM live l
    GROUP BY l.location_id, l.material_id, l.ncc_id, l.shelf_life_days, (l.expiry_date IS NULL)
  )
  SELECT l.location_id,
         count(*)::int                                                        AS pallets,
         count(DISTINCT l.material_id)::int                                   AS materials,
         bool_or(p_material_id IS NOT NULL AND l.material_id = p_material_id) AS same_material,
         bool_or(public.qa_is_hold(l.qa_status_id))                                  AS qa_hold,
         -- NULL = pallet chưa khai NCC → không kết luận (quy ước null-inclusive toàn app)
         COALESCE(array_remove(array_agg(DISTINCT l.ncc_id), NULL), '{}'::uuid[]) AS nccs,
         CASE WHEN NOT p_with_mats THEN '{}'::text[]
              ELSE COALESCE(array_remove(array_agg(DISTINCT l.material_id), NULL), '{}'::text[])
         END                                                                  AS mats,
         CASE WHEN NOT p_with_lots THEN '[]'::jsonb ELSE COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'm', g.material_id, 'n', g.ncc_id, 's', g.shelf_life_days,
                    'no_exp', g.no_exp, 'pmin', g.pmin, 'pmax', g.pmax,
                    'emin', g.emin, 'emax', g.emax, 'imin', g.imin, 'imax', g.imax))
           FROM grp g WHERE g.location_id = l.location_id
         ), '[]'::jsonb) END                                                  AS lots
  FROM live l
  GROUP BY l.location_id
$function$;

-- chú thích cột ghi vết luân chuyển của dòng quét xuất: ngày đại diện của FIFO / LIFO nay là NGÀY NHẬP (dòng quét trước 18/11 vẫn mang NSX)
COMMENT ON COLUMN "OutboundScanEntry".rotation_best_date IS
  'Ngày đại diện của pallet đáng lẽ nên lấy: HSD với FEFO · NGÀY NHẬP với FIFO/LIFO (từ 18/11/2026; dòng trước đó với FIFO/LIFO là NSX)';

COMMIT;
