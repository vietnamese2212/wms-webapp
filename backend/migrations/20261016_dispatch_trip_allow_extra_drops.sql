-- 16/10/2026 — NGOẠI LỆ "CHO VƯỢT SỐ KHÁCH" trên TỪNG xe nháp (user chốt 16/10: "thêm công tắc — switch tiêu chuẩn AppSheet"). Từ 14/10 kéo tay
-- vượt số khách cùng xe bị CHẶN ở mọi cửa (kéo thả · xe mới · chuyển từng OD · đổi dòng xe · Xác nhận). Bật cột này cho MỘT xe ⇒ luật số khách
-- (trần dòng xe `max_drops` + "số khách tối đa cùng xe" của khách / kênh) không chặn xe đó nữa — giống switch "Ghép Loại kho khác". Các luật khác
-- (đi xe riêng · kênh · Loại kho · điều kiện bảo quản · dòng xe được vào · tải) vẫn chặn. Mặc định false = luật 14/10 như cũ.
-- Lên production: áp bất kỳ lúc nào TRƯỚC khi code mới chạy (code mới đọc / ghi cột này).
ALTER TABLE public.dispatch_trip ADD COLUMN IF NOT EXISTS allow_extra_drops boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.dispatch_trip.allow_extra_drops IS 'Người điều vận cho xe này vượt số khách cùng xe (16/10/2026) — cửa làm tay + Xác nhận không chặn luật số khách cho riêng xe';
