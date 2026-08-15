-- QUY TẮC CẤT HÀNG — đợt D: bịt cửa "Chuyển vị trí hàng loạt" (trang Tồn kho).
--
-- LỖ HỔNG THẬT: đợt A+B gác luật cất hàng ở luồng NHẬP (tạo phiếu / đổi vị trí / quét / preview),
-- nhưng `PATCH /wms/inventory/bulk-location` — cửa mà công nhân kho dùng nhiều thứ hai — đi thẳng
-- xuống RPC move mà KHÔNG hỏi luật một câu nào. Kho bật "bắt buộc cất đúng quy tắc" xong vẫn dồn
-- được pallet vào ô đánh dấu CẤM ĐƯA HÀNG VÀO, vào vị trí nhặt lẻ, vượt số mã tối đa. Công tắc
-- người dùng yêu cầu hoá ra chỉ gác được một nửa số cửa.
--
-- Hai việc ở tầng SQL (phần luật vẫn nằm nguyên ở utils/putaway.ts — KHÔNG chép luật xuống đây):
--   1. `putaway_slot_facts` trả thêm `mats` = TẬP mã đang có trong ô. Cất một LÔ thì ràng buộc
--      "tối đa N mã/ô" phải tính trên HỢP của (mã đang có ∪ mã cả lô) — chỉ có số ĐẾM thì không
--      biết mã nào của lô đã có sẵn. Trả theo cờ (như `p_with_lots`) để đường chạy thường không
--      gánh thêm byte: ô nặng nhất staging 69 mã × 50 ô = ~128KB mỗi lần gõ phím ở ô tìm vị trí.
--   2. `move_pallets_to_location` nhận `p_max_materials` + 3 cột vết, đối xứng với
--      `scan_insert_pallet` (20260815g). Vì sao phải DƯỚI LOCK: hai người cùng dồn hàng vào một ô
--      thì mỗi bên đọc "ô đang có 2 mã" rồi cùng ghi — đúng lỗi đua đã đo ở màn quét 15/08.

BEGIN;

-- ─── 1. Tập mã đang có trong ô ───────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.putaway_slot_facts(text[], text, boolean);
CREATE OR REPLACE FUNCTION public.putaway_slot_facts(
  p_loc_ids     text[],
  p_material_id text    DEFAULT NULL,
  p_with_lots   boolean DEFAULT false,
  p_with_mats   boolean DEFAULT false
)
RETURNS TABLE (
  location_id   text,
  pallets       int,
  materials     int,
  same_material boolean,
  qa_hold       boolean,
  nccs          uuid[],
  mats          text[],
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
         CASE WHEN NOT p_with_mats THEN '{}'::text[]
              ELSE COALESCE(array_remove(array_agg(DISTINCT l.material_id), NULL), '{}'::text[])
         END                                                                  AS mats,
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

REVOKE ALL ON FUNCTION public.putaway_slot_facts(text[], text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.putaway_slot_facts(text[], text, boolean, boolean) TO service_role;

-- ─── 2. Chuyển vị trí: chốt số mã dưới lock + ghi vết ────────────────────────
-- Bỏ bản 5 tham số: thêm tham số CÓ DEFAULT mà giữ bản cũ thì lời gọi 5 đối số thành NHẬP NHẰNG
-- (hai ứng viên cùng khớp) → Postgres báo lỗi thay vì chọn. Các caller khác (quét xuất phần dư,
-- Slotting, Fill) vẫn gọi đúng 5 tham số cũ và rơi vào default = hành vi KHÔNG ĐỔI.
DROP FUNCTION IF EXISTS public.move_pallets_to_location(text[], text, text, text, text);
CREATE OR REPLACE FUNCTION public.move_pallets_to_location(
  p_ids           text[],
  p_location_id   text,
  p_updated_by    text,
  p_update_date   text,
  p_now           text,
  p_max_materials integer DEFAULT NULL,   -- NULL = không ràng buộc (luật tắt / đã duyệt vượt rào)
  p_putaway_checked         boolean DEFAULT NULL,  -- NULL = không đụng 3 cột vết
  p_putaway_violation       text    DEFAULT NULL,
  p_putaway_override_reason text    DEFAULT NULL
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_max    int;
  v_active boolean;
  v_code   text;
  v_used   int;
  v_need   int;
  v_mats   int;
BEGIN
  v_need := COALESCE(array_length(p_ids, 1), 0);
  IF v_need = 0 THEN RETURN 'NO_IDS'; END IF;

  -- Khóa dòng Location → serialize mọi lượt dồn vào CÙNG vị trí
  SELECT max_pallets, is_active, location_code
    INTO v_max, v_active, v_code
  FROM "Location" WHERE id = p_location_id FOR UPDATE;
  IF NOT FOUND   THEN RETURN 'NOT_FOUND'; END IF;
  IF NOT v_active THEN RETURN 'INACTIVE'; END IF;

  -- Kiểm sức chứa DƯỚI LOCK (đếm sống; loại pallet đang được dời vào + pallet tồn=0)
  IF v_max > 0 THEN
    SELECT COUNT(*) INTO v_used
    FROM "InventoryEntry"
    WHERE location_id = p_location_id
      AND status IN ('IN_STOCK','PARTIAL','QUARANTINE')
      AND cartons_remaining > 0
      AND NOT (id = ANY(p_ids));
    IF (v_max - v_used) < v_need THEN
      RETURN 'FULL|' || GREATEST(0, v_max - v_used)::text || '|' || COALESCE(v_code, '');
    END IF;
  END IF;

  -- Số mã SAU KHI DỜI = mã đang ở lại trong ô ∪ mã của lô sắp vào. Bộ lọc dòng phải KHỚP
  -- `putaway_slot_facts` (stack_layer=1, IN_STOCK/PARTIAL, còn tồn) — lệch bộ lọc là backend
  -- chấm một đằng, RPC chốt một nẻo, và người dùng thấy "lúc chặn lúc không".
  IF p_max_materials IS NOT NULL THEN
    SELECT count(DISTINCT material_id) INTO v_mats
    FROM "InventoryEntry"
    WHERE stack_layer = 1
      AND status IN ('IN_STOCK','PARTIAL')
      AND COALESCE(cartons_remaining, 0) > 0
      AND ((location_id = p_location_id AND NOT (id = ANY(p_ids))) OR id = ANY(p_ids));
    IF COALESCE(v_mats, 0) > p_max_materials THEN
      RETURN 'MAXMAT|' || COALESCE(v_mats, 0)::text || '|' || p_max_materials::text;
    END IF;
  END IF;

  IF p_putaway_checked IS NULL THEN
    UPDATE "InventoryEntry"
       SET location_id = p_location_id,
           updated_at  = p_now::timestamp,
           update_date = p_update_date::timestamp,
           updated_by  = COALESCE(p_updated_by, updated_by)
     WHERE id = ANY(p_ids);
  ELSE
    -- Vết đi theo LẦN CẤT gần nhất: pallet được dời chỗ thì lý do "vì sao nó nằm đây" là của lần
    -- dời này, không phải của lần nhập kho đầu tiên. Gán thẳng (kể cả NULL) để lần cất ĐÚNG luật
    -- xoá được vết vi phạm cũ.
    UPDATE "InventoryEntry"
       SET location_id = p_location_id,
           updated_at  = p_now::timestamp,
           update_date = p_update_date::timestamp,
           updated_by  = COALESCE(p_updated_by, updated_by),
           putaway_checked         = p_putaway_checked,
           putaway_violation       = p_putaway_violation,
           putaway_override_reason = p_putaway_override_reason
     WHERE id = ANY(p_ids);
  END IF;

  RETURN 'OK|' || COALESCE(v_code, '');
END $$;

REVOKE ALL ON FUNCTION public.move_pallets_to_location(text[], text, text, text, text, integer, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_pallets_to_location(text[], text, text, text, text, integer, boolean, text, text)
  TO service_role;

COMMIT;
