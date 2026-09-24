-- Ô tổng của tab "Chưa có OD" (sổ SO) — đếm/cộng TRONG SQL trên toàn bộ bộ lọc (không kéo dòng về Node cộng tay).
-- Cùng mệnh đề WHERE với list ở zsd02Controller.listSoLines. Tải = SAP tham chiếu (sap_pallets, gross_weight_kg)
-- vì sổ SO chỉ để nhìn trước; tải theo master tính ở tầng chuyến.
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
    'sap_pallets', round(coalesce(sum(sap_pallets) FILTER (WHERE status = 'OPEN'), 0), 1),
    'kg',          round(coalesce(sum(gross_weight_kg) FILTER (WHERE status = 'OPEN'), 0), 1)
  ) FROM w;
$$;
