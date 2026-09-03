---
name: security-hardening
description: BẮT BUỘC mở khi thêm/sửa route, bảng, RPC, form đăng nhập/mật khẩu, upload, hoặc khi user hỏi "bảo mật / rủi ro / pentest / IT chủ đầu tư hỏi". Checklist các cửa đã đóng trong đợt kiểm định 02–03/09/2026 và LƯỚI MÁY gác từng cửa (gói QA 40–44, ratchet 09) — để tính năng mới KHÔNG mở lại cửa cũ, và để trả lời IT bằng bằng chứng đo được thay vì lời hứa.
---

# Security Hardening — cửa đã đóng, lưới đang gác, việc còn mở

> Bài học gốc (02/09): app từng chạy 2 tháng với vé realtime mở đọc **58/73 bảng** cho MỌI tài khoản đăng nhập, không ai thấy vì không có gì "hỏng". Bảo mật không có triệu chứng ⇒ chỉ tin **phép đo sống** (gói QA), không tin "đã cẩn thận". Mọi cửa dưới đây đều có 1 gói QA hoặc 1 ratchet gác — thêm cửa mới thì thêm lưới, không có lưới = chưa xong (luật "bug chết hai lần").

## 1. Checklist khi THÊM/SỬA code (soi trước khi báo xong)

| Đụng vào… | Phải hỏi | Lưới gác |
|---|---|---|
| **Bảng mới** | KHÔNG `CREATE POLICY … TO authenticated/anon`. Realtime = chỉ thêm dòng `TABLE_QUERY_MAP` (trigger tự gắn). Bảng nội bộ (log/đếm) → `DROP TRIGGER trg_wms_notify` để khỏi bắn tín hiệu vô nghĩa | QA 00 mục 10b/10c · QA 40 (đo sống bằng anon key + vé realtime) |
| **RPC mới** | Không GRANT gì (default đã đóng PUBLIC, backend đi service_role). Tham số người dùng ghép vào LIKE → `like_esc()` | QA 00 10c · ratchet `sql_like_unescaped` |
| **Route write có id trên URL** | id này thuộc kho/cha nào? 2 id (`/:gdoId/items/:itemId`) → ràng con THUỘC cha ngay trong SELECT (`itemOfGdo`, embed `!inner()`), lệch = 404. 1 id → guard scope (`inScope`/`guardEntryWh`/`guardWarehouseScope`/`blockIfOutOfScope`). Id rác → 400, không 500 | QA 41 (IDOR cặp id + tài khoản kho lẻ) · QA 07 mục 6 · QA 37 bodyfuzz |
| **Route mới bất kỳ** | `requirePerm` đúng action riêng (skill `add-permission`, 4 nơi). Cắt LIST theo kho ∩ loại (null-inclusive). Phạm vi RỖNG ≠ không giới hạn | QA 08 perm-coverage · QA 35 scope-empty · ratchet `route_without_permission` |
| **Mật khẩu** (đặt/đổi/seed/tạo tài khoản) | CHỈ gọi `passwordError()` của `utils/passwordPolicy` (BE + mirror FE). Không tự `length <`. Mật khẩu tạm dùng `randomInt`, ≥12. Không in mật khẩu ra log/console/repo | QA 43 · ratchet `password_rule_hand_rolled` |
| **Đăng nhập / phiên** | Bộ đếm ở DB (RPC `auth_throttle`), không ở RAM lambda. Thông báo lỗi KHÔNG tiết lộ tài khoản có tồn tại. Khoá phải có đường MỞ trong app (`DELETE /employees/:id/lock`, quyền `user_admin.unlock`) — siết mà không có van = ngõ cụt | QA 42 · QA 43 mục [3] |
| **Upload file** | Kiểm chữ ký file thật (PNG đội lốt .xlsx), preflight 2 pha, 400 sạch, 0 rác DB | QA 38 · ratchet `upload_without_preflight` |
| **Thư viện mới** (`npm i`) | `node scripts/qa/44-npm-audit.mjs` — high/critical không được tăng so `audit-baseline.json`. Vá được thì `npm audit fix` rồi `--update-baseline` | QA 44 (CI job static) |
| **Lỗi 5xx** | `fail()`/`recordServerError('be', …, url)` có url — digest phải lần ra endpoint | kiểu (overload) · digest hằng ngày |
| **Header / CORS** | Header tĩnh ở `vercel.json` (HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy). API có helmet. CORS đọc ENV `CORS_ORIGINS`. CSP đầy đủ CHƯA bật (worker OCR/blob/ws) — bật phải qua Report-Only trước | đo bằng curl -I trên Preview |

## 2. Trạng thái đã đo (03/09/2026, staging, run-all 43 gói XANH)
- PostgREST/GraphQL/Storage/Auth/Realtime với anon key + vé realtime + token giả: **0 bảng đọc được, 0 RPC gọi được, publication rỗng** (QA 40: 29 phép).
- IDOR cặp id 8 route Xuất kho + undo Dồn/Tách + sửa Kho + DO SAP theo plant: **đóng** (QA 41: 25 phép).
- Dò mật khẩu: khoá tài khoản 10 sai/15', IP 30 sai/15', nhật ký `auth_login_events` (QA 42: 7 phép).
- Chính sách mật khẩu ≥10, chữ+số, không phổ biến/lặp/chứa tên đăng nhập; mở khoá trong app có vết (QA 43: 14 phép).
- Thư viện: backend còn `tar` critical qua `@mapbox/node-pre-gyp` của bcrypt 5 (chỉ lúc CÀI, không chạy runtime — vá = lên bcrypt 6, việc riêng); frontend còn vite/esbuild/react-router chỉ vá ở MAJOR (dev-server + SSR, không chạm production bundle). Ghi trong baseline, không được tăng.

## 3. Còn MỞ — nói thẳng với IT, đừng giấu
1. **Tài khoản quản trị hạ tầng** (GitHub/Vercel/Supabase) — 2FA + rà thành viên là việc của chủ dự án, không có code nào bù.
2. **Token 24h không thu hồi được sớm** khi vô hiệu tài khoản (trong app bị đá ≤5' qua `/me`; gọi API thẳng vẫn được tới hết hạn). User chốt 03/09: KHÔNG làm (mỗi cách tốn 1 lượt DB/request, đụng nút thắt pool).
3. **CSP đầy đủ** chưa bật. **Nhật ký quản trị** (đổi quyền/scope/API key) chưa rà đủ. **Cảnh báo bảo mật** (nhiều tài khoản bị khoá, admin login IP lạ) chưa có rule. **Pentest độc lập** chưa có.
4. Backup/PITR phụ thuộc gói Supabase (free = backup ngày).

## 4. Khi user hỏi "còn rủi ro gì / cần làm gì thêm"
Trả lời theo 2 nhóm: việc CHỈ user làm được (tài khoản hạ tầng, đổi mật khẩu admin + cập nhật `QA_ADMIN_PASSWORD`, xoá khoá cũ trong `.env` cục bộ, gói Supabase) và việc code được (mục 3). Kèm **giá phải trả** (hiệu năng đo được, UX, ràng buộc khi phát triển) — user 03/09 hỏi đúng câu này. Cập nhật mục 2–3 của skill này + CLAUDE.md sau mỗi đợt vá (user yêu cầu 03/09: "đã xử lý thì cập nhật vào skill/CLAUDE.md để lần sau nhớ").
