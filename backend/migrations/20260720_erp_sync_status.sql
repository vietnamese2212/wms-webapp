-- ĐỢT 3 (Dữ liệu bên ngoài): chuẩn bị cho SAP live-pull.
-- sync_status: ACTIVE (mặc định) / OBSOLETE (DO không còn trong SAP khi kéo lại — KHÔNG xóa, chỉ đánh dấu).
-- last_synced_at: mốc lần cuối SAP xác nhận dòng này còn tồn tại.
ALTER TABLE public."erp_outbound_orders" ADD COLUMN IF NOT EXISTS sync_status   text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE public."erp_outbound_orders" ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
