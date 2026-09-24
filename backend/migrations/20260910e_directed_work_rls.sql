-- ============================================================================
-- 20260910e — BẬT RLS CHO 2 BẢNG VIỆC (vá lỗ của 20260910c)
-- ============================================================================
-- Gói QA 00 mục "Mọi bảng public đều bật RLS" bắt được ngay lượt CI đầu tiên sau khi apply
-- 20260910c: `wms_tasks` và `wms_task_events` tạo ra mà QUÊN bật RLS.
--
-- VÌ SAO NGHIÊM TRỌNG dù `authenticated`/`anon` đã bị thu hết quyền bảng (20260902c): hai lớp
-- gác đó ĐỘC LẬP nhau, và bảng mới sinh sau là đúng chỗ default privileges có thể hở lại. Luật
-- dự án từ 03/08: **mọi bảng trong schema public phải bật RLS** — không có ngoại lệ "vì đã đóng
-- ở chỗ khác rồi". Bảng việc chứa lịch trình lấy hàng của cả kho (mã hàng, tem pallet, vị trí,
-- ai làm lúc nào), rò ra là lộ toàn bộ hoạt động kho.
--
-- KHÔNG tạo policy nào: backend đi service_role (bỏ qua RLS), FE không đọc bảng nào qua Supabase
-- (chỉ nhận tín hiệu realtime). RLS bật + 0 policy = đóng hoàn toàn với anon/authenticated.
-- ============================================================================
ALTER TABLE public.wms_tasks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_task_events ENABLE ROW LEVEL SECURITY;
