-- ============================================================================
-- 20260923b — GÁN CHA TỰ ĐỘNG cho 60 dòng xe con (user 23/09: "Rồi tự gán đi, sai tôi vào sửa")
-- ----------------------------------------------------------------------------
-- Luật suy từ TÊN + sức chứa đã parse (chỉ dòng CHƯA gán cha — không đè lựa chọn người đã sửa):
--   • tên có "cont" + "Lạnh"            → CONTSCA (container lạnh)
--   • tên có "cont"                     → CONT     (CONTXK = cont xuất khẩu — không suy được từ tên, user gán tay nếu cần)
--   • đo tải bằng PALLET, ≤ 6 pallet     → XE4PALLET
--   • đo tải bằng PALLET, > 6 pallet     → XEPALLET (kể cả 22–68 pallet: kho hiện chỉ có một dòng cha xe pallet lớn)
--   • đo tải bằng TẤN, lạnh / kết hợp    → XESCA    (xe có khoang lạnh — khung giờ / cửa SCA)
--   • đo tải bằng TẤN, nóng / khác       → XEXA
-- Khớp cha theo MÃ (code) chứ không theo id — id VehicleType khác nhau giữa staging và production.
-- Sửa lại từng dòng ở Cài đặt TMS → tab "Mã dòng xe" (tick nhiều → Gán cha).
-- ============================================================================

BEGIN;

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c, ',') INTO missing FROM unnest(ARRAY['XE4PALLET','XEPALLET','XEXA','XESCA','CONT','CONTSCA']) c
   WHERE NOT EXISTS (SELECT 1 FROM public."VehicleType" v WHERE v.code = c);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Thiếu dòng xe cha: % — gán tay ở Cài đặt TMS', missing; END IF;
END $$;

UPDATE public.vehicle_model m
   SET parent_type_id = (
         SELECT v.id FROM public."VehicleType" v WHERE v.code = CASE
           WHEN m.name ~* 'cont' AND m.name ~ '[lL]ạnh' THEN 'CONTSCA'
           WHEN m.name ~* 'cont'                        THEN 'CONT'
           WHEN m.capacity_mode = 'PALLET' AND coalesce(m.max_pallets, 99) <= 6 THEN 'XE4PALLET'
           WHEN m.capacity_mode = 'PALLET'              THEN 'XEPALLET'
           WHEN m.temp_mode IN ('COLD', 'MIXED')        THEN 'XESCA'
           ELSE 'XEXA' END),
       updated_at = now(), updated_by = 'migration 20260923b (gợi ý theo tên — sửa ở Mã dòng xe)'
 WHERE m.parent_type_id IS NULL;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_model WHERE parent_type_id IS NULL AND is_active;
  IF n > 0 THEN RAISE EXCEPTION 'Còn % dòng xe con chưa gán cha sau khi suy', n; END IF;
END $$;

COMMIT;

-- KIỂM SAU KHI CHẠY
--   SELECT v.code, count(*) FROM vehicle_model m JOIN "VehicleType" v ON v.id = m.parent_type_id GROUP BY 1 ORDER BY 1;
