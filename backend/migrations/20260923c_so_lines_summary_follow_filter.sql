-- Ô tổng tab "Chưa có OD": Pallet SAP + Tấn phải cộng ĐÚNG TẬP ĐANG XEM, không cứng ở status='OPEN'.
--
-- VÌ SAO (đo sống 23/09 trên Preview, kho Ba Vì, Ngày giao 07-09-2026): bản đầu cộng hai ô này với
-- FILTER (WHERE status = 'OPEN') trong khi 5 ô còn lại (rows · so_numbers · ship_tos · unresolved ·
-- not_loadable) đi theo mệnh đề WHERE, tức theo bộ lọc Trạng thái người dùng chọn. Lọc sang "Đã có OD"
-- ⇒ bảng 1.489 dòng, ô "SỐ SO 219 · SHIP-TO 142" đúng, mà "PALLET SAP 0 · TẤN 0" — ĐÈ LÊN chính cột
-- "Pallet SAP" của từng dòng đang in 0,68 · 0,82 · 0,81. Một băng tổng mâu thuẫn với bảng ngay dưới nó
-- thì người đọc kết luận "mất dữ liệu", và chính trạng thái rỗng của tab mời họ đổi bộ lọc sang đó.
-- Tooltip có giải thích, nhưng tooltip là thứ phải rê/chạm mới thấy — không cứu được con số sai ở lớp đầu.
--
-- Ô tổng là BẢN TÓM TẮT CỦA DANH SÁCH BÊN DƯỚI: cùng WHERE thì cùng tập. Màn hình mặc định KHÔNG ĐỔI
-- (bộ lọc mặc định vốn đã là OPEN ⇒ hai ô ra đúng con số cũ); chỉ các bộ lọc khác hết nói dối.
CREATE OR REPLACE FUNCTION public.erp_so_lines_summary(
  p_from date, p_to date, p_plants text[] DEFAULT NULL, p_status text[] DEFAULT NULL, p_flows text[] DEFAULT NULL, p_q text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
  WITH w AS (
    SELECT *
    FROM public.erp_so_lines s
    WHERE s.sync_status = 'ACTIVE'
      AND (p_from IS NULL OR s.delivery_date >= p_from)
      AND (p_to   IS NULL OR s.delivery_date <= p_to)
      AND (p_plants IS NULL OR s.plant IS NULL OR s.plant = ANY(p_plants))
      AND (p_status IS NULL OR s.status = ANY(p_status))
      AND (p_flows  IS NULL OR s.flow = ANY(p_flows))
      AND (p_q IS NULL OR p_q = '' OR s.so_number ILIKE '%' || p_q || '%' OR s.material_code ILIKE '%' || p_q || '%'
           OR s.material_name ILIKE '%' || p_q || '%' OR s.ship_to_name ILIKE '%' || p_q || '%' OR s.ship_to_code ILIKE '%' || p_q || '%')
  )
  SELECT jsonb_build_object(
    'rows',        count(*),
    'open',        count(*) FILTER (WHERE status = 'OPEN'),
    'has_od',      count(*) FILTER (WHERE status = 'HAS_OD'),
    'cancelled',   count(*) FILTER (WHERE status = 'CANCELLED'),
    'unresolved',  count(*) FILTER (WHERE qty_unresolved),
    'not_loadable',count(*) FILTER (WHERE flow NOT IN ('SALE','STO','INTERNAL','PALLET')),
    'so_numbers',  count(DISTINCT so_number),
    'ship_tos',    count(DISTINCT ship_to_code),
    -- theo ĐÚNG tập đang lọc, như mọi ô khác trong băng
    'sap_pallets', round(coalesce(sum(sap_pallets), 0), 1),
    'kg',          round(coalesce(sum(gross_weight_kg), 0), 1)
  ) FROM w;
$$;
