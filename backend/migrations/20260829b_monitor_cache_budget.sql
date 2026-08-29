-- 20260829b — NGÂN SÁCH THỜI GIAN cho lượt TÍNH của cache giám sát.
--
-- VÌ SAO (đo ngay sau khi apply 20260829 — cache có mà KHÔNG ăn):
--   Bọc cache xong, ramp vẫn hỏng y như cũ. Lý do: role PostgREST có `statement_timeout` 8s, mà
--   lượt MISS phải TỰ TÍNH — dưới tải nó vượt 8s nên bị giết TRƯỚC KHI kịp ghi cache. Kết quả là
--   một cái cache **không bao giờ nạp được**: muốn có số trong cache thì phải có một lượt tính
--   chạy xong, mà mọi lượt tính đều chết. Càng đông càng không thoát ra được.
--   Đây là cái bẫy dễ bỏ qua nhất khi thêm cache: người ta chỉ kiểm "lượt 2 có nhanh không" (lúc
--   máy rảnh thì luôn nhanh), chứ không kiểm "lượt 1 có SỐNG SÓT nổi lúc đông người không".
--
-- Sửa: cho riêng 3 hàm _cached một ngân sách 30s. Chỉ áp cho LƯỢT TÍNH (miss) — vốn đã hiếm vì
-- có TTL và advisory lock gộp nhiều người thành một lượt; lượt HIT vẫn trả trong vài chục ms.
-- Không nới trần 8s của cả role: trần đó đang bảo vệ mọi câu khác, nới đại trà là bỏ phanh.
-- 30s chứ không 60s: Vercel cắt hàm ở 60s, để 30 thì còn chỗ cho phần đi/về.

ALTER FUNCTION public.control_tower_stats_cached(text[], text[], date, text[], int)
  SET statement_timeout TO '30s';
ALTER FUNCTION public.control_tower_resources_cached(text[], date, int)
  SET statement_timeout TO '30s';
ALTER FUNCTION public.slotting_stats_cached(text, text[], int, int)
  SET statement_timeout TO '30s';

-- CÙNG HỌ — vá luôn 2 hàm cache có từ 21/08. Chúng dính y hệt cái bẫy trên (lượt tính cũng chịu
-- trần 8s ⇒ đúng lúc đông người thì cache không nạp nổi), chỉ là chưa ai đo tới. Luật của dự án:
-- gặp vấn đề cùng họ scale thì quét hết chỗ cùng dạng ngay trong lượt làm việc, không để lại.
ALTER FUNCTION public.dashboard_all_cached(text[], text[], date, int)
  SET statement_timeout TO '30s';
ALTER FUNCTION public.warehouse_productivity_cached(text[], text[], date, date, numeric, int)
  SET statement_timeout TO '30s';

-- Kiểm sau khi apply:
--   SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname LIKE '%_cached';   -- phải thấy statement_timeout=30s
--   Rồi bắn tải lại: lượt MISS phải CHẠY XONG và ghi được dòng vào dashboard_cache.
