-- ══════════════════════════════════════════════════════════════════════════
-- CUTOVER production 15/08/2026 — PART3 (8 migration)
-- Dán TRỌN file này vào Supabase SQL Editor (project production svicyfquresxaigfxsdb) → Run.
-- Bọc trong 1 transaction: lỗi bất kỳ đâu là ROLLBACK toàn bộ part → sửa rồi chạy lại,
-- KHÔNG để schema dở dang. Chạy các part theo ĐÚNG THỨ TỰ part1 → part5.
-- ══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 20260801_weigh_gate.sql
-- ───────────────────────────────────────────────────────────────────────
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

-- ───────────────────────────────────────────────────────────────────────
-- 20260801c_gate_rule_split.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260801c — TÁCH 2 RULE cổng/cân + BỎ giao lẻ tự khai (user chốt lại 01/08).
--
-- User: "Việc bắt đầu và chọn là rủi ro… Chúng ta sẽ có 2 rule: 1 chọn có trong ĐĂNG KÝ,
-- 2 chọn có trong CÂN. Chọn cái nào thì phải chấp hành cái đó. Nếu cả 2 yêu cầu thì phải có cả 2."
-- ⇒ (1) mỗi rule 1 cờ per kho, độc lập; (2) MỌI miễn trừ (xe không đăng ký được / không cân được /
-- giao lẻ xe máy-nhân viên nhận) đều đi 1 đường duy nhất: DUYỆT BÊN NGOÀI trên chuyến bởi người có
-- quyền outbound.weigh_waive (weigh_waived_*) — KHÔNG còn lựa chọn tự khai nào lúc bấm Bắt đầu.

-- 1) Rule ĐĂNG KÝ CỔNG — tách khỏi rule cân (trước 01/08 gói chung trong require_weigh_on_start)
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS require_gate_on_start boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN "Warehouse".require_gate_on_start IS
  'Rule 1: chuyến XUẤT chỉ được Bắt đầu khi gắn Đăng ký cổng hợp lệ (đúng kho, chiều XUẤT, đã VÀO, biển khớp). Độc lập với require_weigh_on_start (rule 2 — cân). Miễn trừ duy nhất = duyệt weigh_waived trên chuyến.';
COMMENT ON COLUMN "Warehouse".require_weigh_on_start IS
  'Rule 2: chuyến XUẤT chỉ được Bắt đầu khi biển số khớp phiếu cân CHƯA hoàn thành của hôm nay. Độc lập với require_gate_on_start (rule 1 — đăng ký cổng). Miễn trừ duy nhất = duyệt weigh_waived trên chuyến.';

-- 2) BỎ giao lẻ TỰ KHAI (20260801b) — thay bằng duyệt có phân quyền. Cột chỉ mới có trên staging,
--    chưa lên production (production chỉ cần apply file này, BỎ QUA 20260801b).
ALTER TABLE "GroupDeliveryOrder" DROP COLUMN IF EXISTS small_delivery_at;
ALTER TABLE "GroupDeliveryOrder" DROP COLUMN IF EXISTS small_delivery_by;

-- ───────────────────────────────────────────────────────────────────────
-- 20260801d_gate_waive_split.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260801d — TÁCH DUYỆT MIỄN TRỪ theo TỪNG RULE (user chốt 01/08: "phải phân thành 2 tình huống
-- và 2 action riêng — có khi đăng ký cổng nhưng không cân hoặc ngược lại").
--
-- Trước: 1 vết weigh_waived_* phủ CẢ 2 rule. Nay mỗi rule 1 vết + 1 quyền riêng:
--   Rule 1 (đăng ký cổng)  → gate_waived_*  (quyền outbound.gate_waive,  route /outbound/:id/gate-waive)
--   Rule 2 (cân)           → weigh_waived_* (quyền outbound.weigh_waive, route /outbound/:id/weigh-waive — giữ tên cũ, thu hẹp nghĩa CHỈ CÂN)
-- Giao lẻ/xe máy/NV nhận không biển số = cần duyệt CẢ 2 (mỗi vết bởi người có quyền tương ứng);
-- duyệt CỔNG thì biển số mới thành tùy chọn.

ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS gate_waived_at timestamptz;
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS gate_waived_by text;
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS gate_waive_reason text;

COMMENT ON COLUMN "GroupDeliveryOrder".gate_waived_at IS
  'Duyệt bỏ qua RULE 1 (đăng ký cổng) cho chuyến — quyền outbound.gate_waive. NULL = phải chấp hành rule 1 nếu kho bật. Độc lập với weigh_waived_at (rule 2 — cân).';
COMMENT ON COLUMN "GroupDeliveryOrder".weigh_waived_at IS
  'Duyệt bỏ qua RULE 2 (cân) cho chuyến — quyền outbound.weigh_waive. NULL = phải chấp hành rule 2 nếu kho bật. Độc lập với gate_waived_at (rule 1 — đăng ký cổng).';

-- ───────────────────────────────────────────────────────────────────────
-- 20260801e_forklift_rls_policy.sql
-- ───────────────────────────────────────────────────────────────────────
-- FIX realtime module Xe nâng (check-app 01/08): 3 bảng forklift_* bật RLS (20260731b) nhưng
-- KHÔNG có policy rls_auth_select → role authenticated không SELECT được → Supabase Realtime
-- không phát event → TABLE_QUERY_MAP vô tác dụng, board 2 người cùng check không thấy nhau.
-- Đúng bài học 20260716_weigh_ticket_rls_policy: bảng mới sau lockdown PHẢI kèm policy này.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['forklift_vehicles','forklift_checklist_items','forklift_daily_logs'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'rls_auth_select'
    ) THEN
      EXECUTE format('CREATE POLICY rls_auth_select ON public.%I FOR SELECT TO authenticated USING (true)', t);
    END IF;
  END LOOP;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260802_employee_categories_default.sql
-- ───────────────────────────────────────────────────────────────────────
-- BỎ giá trị mặc định LỖI THỜI của Employee.allowed_categories (check-app 02/08, user chốt).
-- Cột đang có DEFAULT ARRAY['TP','NVL','POSM','BAO_BI'] = taxonomy CŨ, trong khi Loại kho hiện
-- dùng mã SAP (FG01/PM01/RM01/PK01 — xem memory warehouse-type-taxonomy-sap). Hệ quả: mọi đường
-- ghi thẳng DB không khai loại (script import nhân sự, seed) sẽ đẻ scope RÁC → user đó dính 403
-- "Ngoài phạm vi Loại hàng được phép" ở MỌI thao tác mà không hiểu vì sao.
--
-- Vì sao bỏ hẳn thay vì đổi sang mã mới: NULL/rỗng = KHÔNG giới hạn loại (scopeCategoriesOf trả
-- null) — đúng ý nghĩa "chưa cấu hình", và createEmployee đã tự điền đủ danh mục HIỆN TẠI khi
-- form không gửi (đọc LookupValue warehouse_type). Để DEFAULT ở DB chỉ tạo đường sinh dữ liệu sai.
-- Dữ liệu đang có KHÔNG đổi (39/39 nhân viên staging đã mang mã SAP đúng).
ALTER TABLE "Employee" ALTER COLUMN allowed_categories DROP DEFAULT;

-- Dọn di sản nếu còn dòng mang mã cũ (an toàn: chỉ đụng dòng có TOÀN mã cũ, không đụng mã SAP)
UPDATE "Employee"
   SET allowed_categories = NULL, updated_at = now()
 WHERE allowed_categories IS NOT NULL
   AND allowed_categories <@ ARRAY['TP','NVL','POSM','BAO_BI','Bao bì','Thành phẩm','Raw','Giấy','Thùng']::text[]
   AND NOT (allowed_categories && (SELECT COALESCE(array_agg(value), ARRAY[]::text[]) FROM "LookupValue" WHERE type = 'warehouse_type'));

-- ───────────────────────────────────────────────────────────────────────
-- 20260802b_gdo_origin.sql
-- ───────────────────────────────────────────────────────────────────────
-- NGUỒN GỐC CHUYẾN XUẤT (user chốt 02/08): Xuất/Nhặt lẻ là KẾT QUẢ DẪN XUẤT của
-- VL06O + Kế hoạch xuất — chuyến sinh từ 2 nguồn đó KHÓA sửa phần kế hoạch trên đơn
-- (SL/dòng hàng/ngày/kho/NPP), muốn đổi phải sửa Ở NGUỒN rồi hệ thống tự dội xuống.
-- Chuyến upload kiểu cũ / tạo tay / Xuất luôn GIỮ NGUYÊN sửa được (nhiều kho không làm SAP).
--
-- origin phân theo TỪNG CHUYẾN (không theo kho — cùng 1 kho có thể lẫn 2 loại):
--   'SAP'    = sinh từ uploadKhvc (join VL06O raw, item mang od_refs) → khóa phần kế hoạch
--   'EXCEL'  = upload KH xuất kiểu cũ (không có tầng raw)             → như cũ
--   'MANUAL' = tạo tay / Tạo & Xuất luôn                              → như cũ
--   'LEGACY' = dữ liệu trước migration không suy được nguồn           → như cũ (an toàn: không khóa oan)
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS origin text;

-- Backfill: chuyến có item mang od_refs (chỉ đường uploadKhvc ghi) = SAP; còn lại LEGACY.
UPDATE "GroupDeliveryOrder" g
   SET origin = CASE WHEN EXISTS (
         SELECT 1 FROM "OutboundDelivery" d
         JOIN "OutboundItem" i ON i.do_id = d.id
        WHERE d.gdo_id = g.id
          AND i.od_refs IS NOT NULL AND jsonb_array_length(i.od_refs) > 0
       ) THEN 'SAP' ELSE 'LEGACY' END
 WHERE origin IS NULL;

-- ───────────────────────────────────────────────────────────────────────
-- 20260803_awaiting_sap_and_events.sql
-- ───────────────────────────────────────────────────────────────────────
-- ĐỢT A (user chốt 03/08): "Điều vận up Kế hoạch xuất TRƯỚC khi có VL06O".
-- Trước: DO chưa có trong VL06O → CHẶN cả file (400 MISSING_DO) → điều vận không nạp được kế hoạch.
-- Nay: vẫn sinh chuyến, nhưng chuyến ở dạng CHỜ DỮ LIỆU — bất động cho tới khi VL06O về.
--
-- Vì sao dùng CỜ chứ không thêm trạng thái mới cho chuyến: status hiện len lỏi ~20 chỗ
-- (bộ lọc, facet, màu dòng, SummaryBand, dashboard, control tower, RPC phân trang, QA invariant).
-- Thêm giá trị status mới = phải sửa hết ngần ấy chỗ và chắc chắn sót. Cờ thì mọi chỗ cũ vẫn đúng
-- (chuyến chờ vẫn là PENDING), chỉ nơi nào CẦN mới đọc cờ.
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS awaiting_sap boolean NOT NULL DEFAULT false;
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS awaiting_dos text[];

COMMENT ON COLUMN "GroupDeliveryOrder".awaiting_sap IS
  'true = chuyến còn DO chưa có dữ liệu VL06O → khóa mọi đường xuất (422 AWAITING_SAP), giao diện làm mờ. Tự tắt khi VL06O về.';
COMMENT ON COLUMN "GroupDeliveryOrder".awaiting_dos IS
  'Danh sách DO đang chờ dữ liệu (hiện trong cảnh báo). null khi đã đủ.';

-- Lọc "chuyến đang chờ" trên list Xuất: chỉ index phần true (bảng sẽ có hàng triệu dòng,
-- phần chờ luôn là thiểu số) — index partial nhỏ hơn index đầy đủ hàng chục lần.
CREATE INDEX IF NOT EXISTS idx_gdo_awaiting ON "GroupDeliveryOrder" (awaiting_sap) WHERE awaiting_sap;

-- ─────────────────────────────────────────────────────────────────────────────
-- SỔ SỰ KIỆN CHUYẾN XUẤT (user chốt 03/08): "DO trên chuyến phải tracking được —
-- thay đổi thế nào, bởi ai, lúc nào, nguồn nào".
--
-- Vì sao KHÔNG dùng lại reconcile_tasks (đã cân nhắc): bảng đó là HÀNG CHỜ VIỆC
-- (có người xử lý, có trạng thái OPEN/RESOLVED). Nhét cả nhật ký vận hành vào đó sẽ
-- làm loãng hàng chờ và bóp méo ngữ nghĩa "cần xử lý". Tách 2 bảng: việc thì vẫn ở
-- reconcile_tasks, còn ĐÂY là dòng thời gian chỉ-ghi-thêm cho nút "Lịch sử" của chuyến.
CREATE TABLE IF NOT EXISTS public."outbound_events" (
  id            text PRIMARY KEY,
  gdo_id        text,                        -- chuyến (null khi chuyến chưa/không còn tồn tại)
  group_code    text NOT NULL,               -- Số xe = khóa xuyên suốt Kế hoạch xuất ↔ Xuất ↔ TMS
  event_type    text NOT NULL,               -- PLAN_DO_ADDED|PLAN_DO_REMOVED|PLAN_DATE_CHANGED|PLAN_VEHICLE_DROPPED|
                                             -- PLAN_VEHICLE_REOPENED|AWAITING_SET|AWAITING_CLEARED|SAP_AUTO_APPLIED|
                                             -- SAP_NEEDS_REVIEW|SAP_BLOCKED|TRIP_* (đợt sau)
  source        text NOT NULL,               -- PLAN (Kế hoạch xuất) | SAP (VL06O/API) | USER (thao tác tay) | SYSTEM
  actor         text,                        -- tên người thao tác, hoặc nguồn tự động
  do_number     text,                        -- DO liên quan (nếu có)
  material_code text,
  old_value     text,                        -- giá trị cũ (chuỗi đọc được — sổ để NGƯỜI đọc, không phải để máy tính lại)
  new_value     text,
  detail        text NOT NULL,               -- câu mô tả tiếng Việt hiện thẳng trên dòng thời gian
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL
);
-- Truy vấn chính = "lịch sử của CHUYẾN này, mới nhất trước" → index composite đúng shape đó.
CREATE INDEX IF NOT EXISTS idx_oev_gdo   ON public."outbound_events" (gdo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oev_group ON public."outbound_events" (group_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oev_do    ON public."outbound_events" (do_number) WHERE do_number IS NOT NULL;

ALTER TABLE public."outbound_events" ENABLE ROW LEVEL SECURITY;   -- chặn anon (service role bypass)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='outbound_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."outbound_events";
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260803c_tms_order_from_khvc.sql
-- ───────────────────────────────────────────────────────────────────────
-- ĐỢT B (user chốt 03/08): "khi điều vận upload Kế hoạch xuất, dữ liệu ở module Kế hoạch VC sẽ được
-- TỰ ĐỘNG chuyển lên (dạng bị động, chạy theo Kế hoạch xuất) — để phục vụ booking đối với đơn xuất".
--
-- KHÓA LIÊN KẾT = SỐ XE, xuyên suốt 3 tầng: khvc_lines.group_code = GroupDeliveryOrder.group_code
-- = TmsOrder.order_code (bên TMS cột "Số xe" vốn đã đổ vào order_code — không phải bịa khóa mới).
-- ⇒ Điều vận SỬA DO trong xe thì lệnh + khung giờ ĐÃ ĐẶT giữ nguyên, chỉ số liệu cập nhật.
ALTER TABLE "TmsOrder" ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE "TmsOrder" ADD COLUMN IF NOT EXISTS plan_dropped boolean NOT NULL DEFAULT false;
ALTER TABLE "TmsOrder" ADD COLUMN IF NOT EXISTS plan_dropped_at timestamptz;

COMMENT ON COLUMN "TmsOrder".origin IS
  '''KHVC'' = lệnh TỰ SINH theo Kế hoạch xuất (bị động — sửa ở nguồn, không sửa tay). NULL = up tay/upload TMS như cũ.';
COMMENT ON COLUMN "TmsOrder".plan_dropped IS
  'true = Kế hoạch xuất không còn Số xe này → lệnh ngừng hiệu lực + ĐÃ NHẢ khung giờ. Kế hoạch có lại thì bật lại nhưng PHẢI booking lại.';

-- Lệnh tự sinh của 1 ngày/kho là thiểu số trong bảng → index partial cho rẻ
CREATE INDEX IF NOT EXISTS idx_tms_order_khvc ON "TmsOrder" (origin) WHERE origin = 'KHVC';

COMMIT;