-- QUY TẮC CẤT HÀNG (putaway) THEO KHO — đợt A: nền dữ liệu + RPC gom "sự thật của ô".
-- Đối xứng với đợt 1 luân chuyển (20260814c): LẤY hàng và CẤT hàng là hai nửa của cùng một
-- nguyên tắc vận hành kho, nên cùng khai ở form Kho.
--
-- MẶC ĐỊNH = ĐÚNG HÀNH VI HÔM NAY ⇒ apply migration KHÔNG kho nào đổi cách chạy:
--   priority='CONSOLIDATE' (gom cùng mã — chính là ★ đang có), date_mix='ANY',
--   mọi cờ chặn = false, max_materials = NULL (không giới hạn).
-- Bật từng luật là quyết định vận hành của từng kho.

BEGIN;

ALTER TABLE public."Warehouse"
  ADD COLUMN IF NOT EXISTS putaway_priority        text    NOT NULL DEFAULT 'CONSOLIDATE',
  -- đợt B mới nối vào cửa ghi; khai sẵn ở đây để không phải migration lần hai
  ADD COLUMN IF NOT EXISTS putaway_required        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS putaway_max_materials   integer,          -- NULL = không giới hạn số mã/ô
  ADD COLUMN IF NOT EXISTS putaway_date_mix        text    NOT NULL DEFAULT 'ANY',
  ADD COLUMN IF NOT EXISTS putaway_block_pick_face boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS putaway_block_qa_hold   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS putaway_block_full      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS putaway_single_ncc      boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_putaway_priority_chk') THEN
    ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_putaway_priority_chk
      CHECK (putaway_priority IN ('CONSOLIDATE', 'SPREAD', 'ABC'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_putaway_date_mix_chk') THEN
    ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_putaway_date_mix_chk
      CHECK (putaway_date_mix IN ('ANY', 'SAME', 'NEWER_ONLY', 'OLDER_ONLY'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_putaway_max_materials_chk') THEN
    ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_putaway_max_materials_chk
      CHECK (putaway_max_materials IS NULL OR putaway_max_materials >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public."Warehouse".putaway_priority IS
  'Ưu tiên gợi ý chỗ cất: CONSOLIDATE gom cùng mã | SPREAD rải vào ô còn nhiều chỗ | ABC theo hạng nhặt khu';
COMMENT ON COLUMN public."Warehouse".putaway_date_mix IS
  'Trộn date trong 1 ô: ANY tự do | SAME chỉ cùng date | NEWER_ONLY pallet mới phải có date >= mọi pallet đang có | OLDER_ONLY <=. "Date" = HSD nếu kho FEFO, NSX nếu FIFO/LIFO (utils/rotation.ts)';

-- ─────────────────────────────────────────────────────────────────────────────
-- SỰ THẬT CỦA Ô (slot facts) — gom trong SQL, MỘT round-trip cho cả danh sách.
--
-- Vì sao không kéo dòng tồn về backend rồi tự đếm: 50 ô nặng nhất của staging = 2.951 pallet
-- (1 ô cá biệt 115 pallet, 69 mã). Kéo đủ cột date/NCC/QA về là ~740KB MỖI LẦN GÕ PHÍM ở ô
-- tìm vị trí. Ở đây trả về mỗi ô một dòng.
--
-- `lots` KHÔNG phải danh sách pallet mà là danh sách NHÓM (mã, NCC, shelf-life khai theo lô,
-- có-HSD-tường-minh-hay-không) kèm min/max ngày trong nhóm. Trong một nhóm, shelf-life là HẰNG
-- SỐ nên thứ tự theo NSX trùng thứ tự theo HSD suy ra ⇒ min/max của nhóm ĐỦ để backend tính
-- đúng ngày sớm nhất / muộn nhất của cả ô, mà không cần kéo từng pallet. Tách nhóm theo
-- (expiry_date IS NULL) vì pallet có HSD tường minh (tem V2) và pallet suy từ NSX (tem V1)
-- không so sánh chung công thức được.
--
-- CHỦ ĐÍCH: hàm KHÔNG tự tính shelf-life. Luật shelf-life theo NCC nằm ở utils/shelfLife.ts;
-- chép nó xuống SQL là đẻ bản thứ hai — đúng thứ đợt luân chuyển 14/08 vừa dọn.
-- `lots` chỉ cần khi kho BẬT luật trộn date (mặc định 'ANY' = tắt) ⇒ mặc định KHÔNG trả, để
-- đường chạy thường nhẹ nhất có thể. Đo 50 ô nặng nhất staging: 2.951 pallet gom còn 578 nhóm
-- = 100KB nếu bật; tắt thì 0.
DROP FUNCTION IF EXISTS public.putaway_slot_facts(text[], text);
CREATE OR REPLACE FUNCTION public.putaway_slot_facts(
  p_loc_ids     text[],
  p_material_id text DEFAULT NULL,
  p_with_lots   boolean DEFAULT false
)
RETURNS TABLE (
  location_id   text,
  pallets       int,
  materials     int,
  same_material boolean,
  qa_hold       boolean,
  nccs          uuid[],
  lots          jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH live AS (
    SELECT ie.location_id, ie.material_id, ie.ncc_id, ie.qa_status_id,
           ie.production_date, ie.expiry_date, ie.shelf_life_days
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
           max(l.expiry_date)       AS emax
    FROM live l
    GROUP BY l.location_id, l.material_id, l.ncc_id, l.shelf_life_days, (l.expiry_date IS NULL)
  )
  SELECT l.location_id,
         count(*)::int                                                        AS pallets,
         count(DISTINCT l.material_id)::int                                   AS materials,
         bool_or(p_material_id IS NOT NULL AND l.material_id = p_material_id) AS same_material,
         bool_or(l.qa_status_id IS NOT NULL)                                  AS qa_hold,
         -- NULL = pallet chưa khai NCC → không kết luận (quy ước null-inclusive toàn app)
         COALESCE(array_remove(array_agg(DISTINCT l.ncc_id), NULL), '{}'::uuid[]) AS nccs,
         CASE WHEN NOT p_with_lots THEN '[]'::jsonb ELSE COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'm', g.material_id, 'n', g.ncc_id, 's', g.shelf_life_days,
                    'no_exp', g.no_exp, 'pmin', g.pmin, 'pmax', g.pmax,
                    'emin', g.emin, 'emax', g.emax))
           FROM grp g WHERE g.location_id = l.location_id
         ), '[]'::jsonb) END                                                  AS lots
  FROM live l
  GROUP BY l.location_id
$$;

GRANT EXECUTE ON FUNCTION public.putaway_slot_facts(text[], text, boolean) TO service_role;

COMMIT;
