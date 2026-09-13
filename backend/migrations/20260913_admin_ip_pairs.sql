-- ============================================================================
-- 20260913 — Cảnh báo ADMIN_NEW_IP đang MÙ vì trần 1.000 dòng của PostgREST
-- ============================================================================
-- Luật `ruleAdminNewIp` kéo `auth_login_events` về Node rồi tự dựng tập (email|ip) bằng vòng lặp:
--     .select('email, ip, created_at')…gte('created_at', memory).order('created_at').limit(5000)
-- `.limit(5000)` KHÔNG vượt được trần ~1.000 dòng/response của PostgREST (luật cốt tử trong
-- CLAUDE.md) ⇒ chỉ nhận về 1.000 dòng CŨ NHẤT trong cửa sổ 30 ngày.
--
-- Đo thật trên staging 13/09 lúc 02:48: xin 5.000 → trả 1.000, dòng mới nhất trong kết quả là
-- 15:53 hôm trước ⇒ **11 giờ đăng nhập gần nhất VÔ HÌNH với luật**. Mà "IP lạ" hoàn toàn là
-- chuyện của dòng MỚI ⇒ cảnh báo im lặng đúng lúc cần kêu, và càng đông người dùng càng mù thêm.
-- Bằng chứng lặp lại: gói QA 45 XANH ở lượt full đầu (sổ còn <1.000 dòng) rồi ĐỎ ở lượt thứ hai
-- vài giờ sau (sổ vượt 1.000). Dựng lại ngoài gói QA cũng không sinh cảnh báo.
--
-- Gốc rễ theo đúng CLAUDE.md: **đừng KÉO DÒNG để tính ra một TẬP** — cần "khoá nào có mặt" thì
-- hỏi DB trả DISTINCT. Hàm dưới gom theo (email, ip) và trả về đúng thứ luật cần, nên số dòng
-- bị chặn bởi SỐ CẶP chứ không bởi số lượt đăng nhập: vài chục dòng thay vì hàng vạn, đứng xa
-- trần mãi mãi. Chạy mỗi 10 phút nên cũng nhẹ hơn hẳn.
--
-- RPC mới tự đóng (default privileges đã tắt PUBLIC từ 20260902d) — backend đi service_role.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_login_ip_pairs(
  p_emails text[],
  p_memory timestamptz,   -- chỉ xét đăng nhập từ mốc này trở lại đây (cửa sổ ghi nhớ IP)
  p_recent timestamptz    -- ranh giới "cũ" ↔ "mới" (thường = 24h trước)
)
RETURNS TABLE (email text, ip text, has_old boolean, has_new boolean, first_new_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(e.email)                                              AS email,
         e.ip                                                        AS ip,
         bool_or(e.created_at <  p_recent)                           AS has_old,
         bool_or(e.created_at >= p_recent)                           AS has_new,
         min(e.created_at) FILTER (WHERE e.created_at >= p_recent)    AS first_new_at
    FROM public.auth_login_events e
   WHERE e.ok IS TRUE
     AND e.reason IS NULL
     AND e.ip IS NOT NULL
     AND e.created_at >= p_memory
     AND lower(e.email) = ANY (SELECT lower(x) FROM unnest(p_emails) AS x)
   GROUP BY lower(e.email), e.ip
$$;

COMMENT ON FUNCTION public.admin_login_ip_pairs IS
  'Cặp (email quản trị, IP) trong cửa sổ ghi nhớ, kèm cờ đã-thấy-trước-mốc / mới-sau-mốc. '
  'Trả TẬP chứ không trả dòng thô: luật ADMIN_NEW_IP từng mù vì kéo dòng rồi dính trần 1.000 của PostgREST.';

COMMIT;
