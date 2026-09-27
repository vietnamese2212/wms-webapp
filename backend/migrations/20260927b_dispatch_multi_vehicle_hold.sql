-- ============================================================================
-- 20260927b — Điều vận: NHIỀU XE trên một thẻ · HOÃN OD · ghi chú SAP trên OD · quyền sửa dòng xe khách từ bàn ghép xe
-- ============================================================================
-- User chốt 27/09:
--  (5) "10 tấn hàng có thể dùng xe 8 tấn + 2 tấn thay vì 15 tấn" · "luôn so tổ hợp" · bước Xuất kho TẠM CHẤP NHẬN LỆCH
--      (chuyến xuất vẫn một biển) ⇒ thẻ xe (Số xe) mang THÊM dòng xe phụ; Kế hoạch xuất ghi lại để ĐVVT booking đủ xe.
--      Hai cột `extra_vehicle_model_ids` = các dòng xe NGOÀI dòng xe chính (`vehicle_model_id` giữ nguyên nghĩa — mọi chỗ
--      đang đọc nó không đổi). Rỗng = một xe như cũ.
--      `Warehouse.dispatch_max_vehicles_per_trip` = số xe tối đa máy được ghép trên một thẻ (form Kho, nhóm "XUẤT — Điều vận").
--      Mặc định 3 (user: "vận tải có thể book thành 3 xe"); 1 = tắt hẳn (hành vi trước 27/09).
--  (4) "đơn key ra một ngày nhưng có thể điều ngày khác · một số đơn note khác — không tự động được, user review trước khi ghép"
--      ⇒ `dispatch_od_hold`: HOÃN tới ngày (hold_until) hoặc KHÔNG ĐIỀU (hold_until NULL) kèm lý do, GIỮ qua mọi lần
--      "Nạp OD mới" / lập lại — "Bỏ khỏi kế hoạch" cũ chỉ là tạm. Một dòng mỗi (kho, OD).
--      `dispatch_trip_od.note` = ghi chú giao hàng SAP (`erp_outbound_orders.note_delivery`) chụp lúc lập — người review đọc.
--  (3) "điều vận config được dòng xe khách ngay trên bàn — đổi KÊNH thì kho làm sai" ⇒ quyền RIÊNG `dispatch.customer_vehicles`
--      chỉ sửa `Customer.dispatch_vehicles` (không đụng kênh / %Date). Cấp cho mọi chức danh có `dispatch.plan` mà phòng ban
--      KHÔNG phải đơn vị vận tải (cùng luật 20260925). Idempotent.
-- ============================================================================
BEGIN;

ALTER TABLE public.dispatch_trip ADD COLUMN IF NOT EXISTS extra_vehicle_model_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.khvc_lines    ADD COLUMN IF NOT EXISTS extra_vehicle_model_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.dispatch_trip_od ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE public."Warehouse" ADD COLUMN IF NOT EXISTS dispatch_max_vehicles_per_trip integer NOT NULL DEFAULT 3;
ALTER TABLE public."Warehouse" DROP CONSTRAINT IF EXISTS warehouse_dispatch_max_vehicles_chk;
ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_dispatch_max_vehicles_chk CHECK (dispatch_max_vehicles_per_trip BETWEEN 1 AND 5);

CREATE TABLE IF NOT EXISTS public.dispatch_od_hold (
  id           uuid PRIMARY KEY,
  warehouse_id text NOT NULL REFERENCES public."Warehouse"(id) ON DELETE CASCADE,
  od_number    text NOT NULL,
  hold_until   date,                 -- NULL = KHÔNG ĐIỀU (tới khi bỏ hoãn); có ngày = OD quay lại đợt ghép từ ngày đó
  reason       text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispatch_od_hold ON public.dispatch_od_hold (warehouse_id, od_number);
-- mọi bảng public bật RLS, 0 policy (backend đi service_role) — bất biến gói 00 "không bảng nào hở với anon key"
ALTER TABLE public.dispatch_od_hold ENABLE ROW LEVEL SECURITY;

UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(
         j.module_permissions, '{dispatch}',
         (j.module_permissions->'dispatch') || '["customer_vehicles"]'::jsonb, true),
       updated_at = now()
 WHERE (j.module_permissions->'dispatch') ? 'plan'
   AND NOT ((j.module_permissions->'dispatch') ? 'customer_vehicles')
   AND NOT EXISTS (SELECT 1 FROM public."Department" d WHERE d.id = j.department_id AND d.is_carrier);

COMMIT;
