-- 20260801 — GATE CÂN XE khi Bắt đầu chuyến xuất + đối chiếu KL hàng ↔ KL cân (user chốt 01/08).
--
-- Nghiệp vụ: kho có trạm cân → xe phải cân bì (phiếu cân CHƯA hoàn thành trong ngày, biển số khớp)
-- mới được "Bắt đầu" chuyến xuất — chống quên cân trước khi làm hàng, và link phiếu cân ↔ chuyến
-- ngay từ lúc bắt đầu để so sánh KL hàng (tính từ Material.weight_kg) với KL cân thực (net_kg).
-- Không phải kho nào cũng có cân → cờ per kho (mặc định TẮT, hành vi cũ không đổi).
-- Xe không cân được (hỏng cân…) → người có quyền outbound.weigh_waive DUYỆT BỎ QUA trên chuyến.

-- 1) Cờ per kho — bật ở WMS Settings (form Kho)
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS require_weigh_on_start boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN "Warehouse".require_weigh_on_start IS
  'Bật = chuyến XUẤT ở kho này chỉ được Bắt đầu khi biển số xe khớp 1 phiếu cân CHƯA hoàn thành của hôm nay (giờ VN). Duyệt bỏ qua = quyền outbound.weigh_waive.';

-- 2) Duyệt bỏ qua cân trên chuyến (trường hợp đặc biệt: hỏng cân…)
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS weigh_waived_at timestamptz;
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS weigh_waived_by text;
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS weigh_waive_reason text;

-- 3) Tra phiếu cân lúc Bắt đầu: (ngày, biển chuẩn hóa) — bảng 1 trạm cân, index đơn giản là đủ
CREATE INDEX IF NOT EXISTS idx_weigh_ticket_date_plate ON "WeighTicket" (weigh_date, license_plate_norm);

-- 4) RPC ước tính KL hàng của chuyến (kg) — dùng ở detail chuyến + trang Phiếu cân.
--    KL per item = (SL base ÷ units_per_carton) × Material.weight_kg (kg/THÙNG — nhãn form Mã hàng).
--    Mã thiếu weight_kg hoặc không có entry unit → đếm vào items_missing (FE ghi chú "thiếu KL n mã").
--    kg_planned = theo SL kế hoạch (cartons_ordered) · kg_actual = theo thực xuất (cartons_scanned).
--    plpgsql + force_custom_plan: tránh bẫy generic plan của LANGUAGE sql (memory server-pagination-campaign).
CREATE OR REPLACE FUNCTION gdo_weight_estimates(p_gdo_ids text[])
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE v_out jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'gdo_id',        s.gdo_id,
      'kg_planned',    s.kg_planned,
      'kg_actual',     s.kg_actual,
      'items_total',   s.items_total,
      'items_missing', s.items_missing
    )), '[]'::jsonb) INTO v_out
  FROM (
    SELECT d.gdo_id,
      ROUND(SUM(CASE WHEN m.weight_kg IS NOT NULL AND COALESCE(m.units_per_carton, 0) > 0
        THEN oi.cartons_ordered / m.units_per_carton * m.weight_kg END)::numeric, 1) AS kg_planned,
      ROUND(SUM(CASE WHEN m.weight_kg IS NOT NULL AND COALESCE(m.units_per_carton, 0) > 0
        THEN COALESCE(oi.cartons_scanned, 0) / m.units_per_carton * m.weight_kg END)::numeric, 1) AS kg_actual,
      COUNT(*)::int AS items_total,
      COUNT(*) FILTER (WHERE m.weight_kg IS NULL OR COALESCE(m.units_per_carton, 0) = 0)::int AS items_missing
    FROM "OutboundDelivery" d
    JOIN "OutboundItem" oi ON oi.do_id = d.id
    LEFT JOIN "Material" m ON m.id = oi.material_id
    WHERE d.gdo_id = ANY(p_gdo_ids)
    GROUP BY d.gdo_id
  ) s;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION gdo_weight_estimates(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION gdo_weight_estimates(text[]) TO service_role;
