-- 20260929_customer_wh_link — Kho ↔ Khách: MỘT mối nối, không tự ép (plan docs/plans/KHO_KHACH_LINK_2026-09-28.md, user chốt 28/09).
--   Kho WMS = plant. Ship-to trỏ kho (`Customer.warehouse_id`) ⇒ chuyến Hoàn thành chạy tiếp (kế hoạch nhập, hình thức nhận
--   theo chế độ tồn của kho); không trỏ ⇒ dừng (OTHER). Không company code. Mọi thứ khác là CẤU HÌNH, mặc định = hành vi cũ.
-- Áp STAGING trước (scratchpad apply_mig.mjs, DIRECT_URL) → npm run db:types → test → production cùng lượt merge.

BEGIN;

-- ── 1. Cấu hình mới ──────────────────────────────────────────────────────────────────────────────
-- Khách: đi xe riêng khi điều vận (thay luật ngầm "khách trỏ kho / SCAN đi riêng"); số khách tối đa cùng xe (NULL = không giới hạn)
ALTER TABLE public."Customer"
  ADD COLUMN IF NOT EXISTS dispatch_separate       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_customers_per_trip  integer NULL;
ALTER TABLE public."Customer" DROP CONSTRAINT IF EXISTS customer_max_customers_chk;
ALTER TABLE public."Customer" ADD CONSTRAINT customer_max_customers_chk CHECK (max_customers_per_trip IS NULL OR max_customers_per_trip BETWEEN 1 AND 50);

-- Kho xuất: ship-to "trông như kho WMS mà chưa trỏ" (tên khách trùng đúng một kho đang hoạt động) — NONE im · WARN nhắc · BLOCK chặn Hoàn thành
ALTER TABLE public."Warehouse"
  ADD COLUMN IF NOT EXISTS unlinked_shipto_policy  text NOT NULL DEFAULT 'NONE';
ALTER TABLE public."Warehouse" DROP CONSTRAINT IF EXISTS warehouse_unlinked_shipto_policy_chk;
ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_unlinked_shipto_policy_chk CHECK (unlinked_shipto_policy IN ('NONE', 'WARN', 'BLOCK'));

-- Kho: số điểm giao tối đa cho phép TRỐNG = không giới hạn (user: "mặc định là không giới hạn"); trần 50
ALTER TABLE public."Warehouse" ALTER COLUMN dispatch_max_drops DROP NOT NULL;
ALTER TABLE public."Warehouse" ALTER COLUMN dispatch_max_drops DROP DEFAULT;
ALTER TABLE public."Warehouse" DROP CONSTRAINT IF EXISTS warehouse_dispatch_max_drops_chk;
ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_dispatch_max_drops_chk CHECK (dispatch_max_drops IS NULL OR dispatch_max_drops BETWEEN 1 AND 50);

-- Dòng OD trên kế hoạch điều vận: chụp hai cấu hình lúc lập (reoptimize / cảnh báo đọc từ đây, không tra lại khách)
ALTER TABLE public.dispatch_trip_od
  ADD COLUMN IF NOT EXISTS separate      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_customers integer NULL;

-- ── 2. Quyền mới `outbound.push_transfer` — cấp theo NĂNG LỰC sẵn có (chức danh đang có outbound.complete), lớp C37 ──
UPDATE public."JobTitle"
SET module_permissions = jsonb_set(
      module_permissions,
      '{outbound}',
      (COALESCE(module_permissions->'outbound', '[]'::jsonb) || '["push_transfer"]'::jsonb)
    )
WHERE module_permissions ? 'outbound'
  AND module_permissions->'outbound' ? 'complete'
  AND NOT (module_permissions->'outbound' ? 'push_transfer');

-- ── 3. Dữ liệu: hai kho NPP có vận hành thật → khách trỏ kho; 147 kho NPP chỉ-là-tên → ngừng hoạt động ──
-- (a) khách mà ship_to_code = mã kho đang hoạt động và CÓ vận hành (vị trí / tồn / người dùng / chuyến nguồn) ⇒ trỏ kho
WITH live AS (
  SELECT w.id, w.code FROM public."Warehouse" w
  WHERE w.is_active
    AND (EXISTS (SELECT 1 FROM public."Location" l WHERE l.warehouse_id = w.id)
      OR EXISTS (SELECT 1 FROM public."InventoryEntry" e WHERE e.warehouse_id = w.id)
      OR EXISTS (SELECT 1 FROM public."UserWarehouseAccess" u WHERE u.warehouse_id = w.id)
      OR EXISTS (SELECT 1 FROM public."GroupDeliveryOrder" g WHERE g.warehouse_id = w.id))
)
UPDATE public."Customer" c
SET warehouse_id = live.id, updated_at = now(), updated_by = 'MIGRATION 20260929'
FROM live
WHERE c.ship_to_code = live.code AND c.warehouse_id IS NULL;

-- (b) kho NPP không vận hành (không vị trí · tồn · người · chuyến nguồn) ⇒ ngừng, KHÔNG xoá (lịch sử lệnh chuyển kho còn tra được)
UPDATE public."Warehouse" w
SET is_active = false, updated_at = now(), updated_by = 'MIGRATION 20260929'
WHERE w.warehouse_type = 'NPP' AND w.is_active
  AND NOT EXISTS (SELECT 1 FROM public."Location" l WHERE l.warehouse_id = w.id)
  AND NOT EXISTS (SELECT 1 FROM public."InventoryEntry" e WHERE e.warehouse_id = w.id)
  AND NOT EXISTS (SELECT 1 FROM public."UserWarehouseAccess" u WHERE u.warehouse_id = w.id)
  AND NOT EXISTS (SELECT 1 FROM public."GroupDeliveryOrder" g WHERE g.warehouse_id = w.id);

-- (c) lệnh chuyển kho ĐANG CHỜ dạng tự xác nhận (SELF) nằm dưới kho vừa ngừng ⇒ về kho xuất của chuyến, bỏ kho đích (đúng nghĩa OTHER)
UPDATE public."TmsOrder" t
SET warehouse_id = g.warehouse_id, destination_warehouse_id = NULL, updated_at = now()
FROM public."GroupDeliveryOrder" g, public."Warehouse" w
WHERE t.transfer_gdo_id = g.id AND t.destination_warehouse_id = w.id
  AND w.is_active = false AND t.status = 'PENDING' AND t.delivery_mode = 'SELF';

COMMIT;
