# Quản lý người dùng (`user_admin`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Quản lý người dùng (+ Nhật ký)

**Quyền (BE `ALL_PERMISSIONS`):** view · create · edit · set_password · unlock · delete · manage_roles · audit_log

## Giao thoa với
<!-- giao-thoa:start -->
- [`employees`](employees.md) — Sơ đồ tổ chức (xem) (hai chiều)
- [`work_skill`](work_skill.md) — Vị trí & Skill (hai chiều)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Quản lý người dùng

## Actions

view, create, edit, set_password, **unlock**=Mở khoá đăng nhập (tài khoản bị khoá 10 lần sai/15' — badge đỏ "Khoá tới hh:mm" trên list + nút ổ khoá; `DELETE /employees/:id/lock` xoá khoá acct + khoá ip vừa sai trong 15', ghi vết `UNLOCKED_BY:<id>` vào `auth_login_events`; 03/09), delete, manage_roles, **audit_log**=tab **Nhật ký** (03/09 — bảng `admin_audit_events`, `services/adminAudit.ts`: ai đổi quyền chức danh / phạm vi kho / hồ sơ / mật khẩu (chỉ sự kiện) / mở khoá / cờ hệ thống / AI Vision / API key (không ghi key), before→after chỉ TRƯỜNG ĐỔI; `GET /masterdata/admin-audit` phân trang + lọc action/ngày/tìm. **Thêm điểm ghi quản trị mới → gọi `logAdmin()` ngay tại controller**, thêm action vào `ADMIN_AUDIT_ACTIONS` + nhãn `AUDIT_ACTION_LABEL` FE; gói QA 45 gác)

## Chức danh — đổi phòng ban (19/11)

- Form Sửa chức danh (chỉ superadmin) đổi được Phòng ban: `PUT /masterdata/job-titles/:id` đọc `department_id` (trước 19/11 server bỏ qua trường này — trả 200 mà phòng ban giữ nguyên; lớp C5). Gửi trống ⇒ 400 "Phòng ban là bắt buộc"; phòng ban không có ⇒ 400.
- Đổi phòng ban đi MỘT giao dịch `jobtitle_set_department(id, dept, actor)`: chức danh sang phòng mới + **nhân viên mang chức danh này đang ở phòng ban CŨ chuyển theo** (form Nhân viên lọc chức danh theo phòng ban — để họ ở lại thì ô Chức danh của họ không còn trong danh sách). Nhân viên ở phòng khác / chưa có phòng ban: giữ nguyên. Phản hồi trả `employees_moved`; nhật ký quản trị ghi `department_id` before→after + `employees_moved`. Form hiện dòng nhắc khi đổi phòng ban.
- Lưới: gói 49 [77b][77c].

## Đổi mật khẩu ⇒ phiên cũ hết hiệu lực (19/11)

- User: "đổi pass Hà Thị Thu Hương nhưng mà đăng nhập cũ vẫn được". Gốc: token JWT không trạng thái và `/auth/me` cấp token mới cho mọi token còn hạn ⇒ phiên mở trước lần đổi sống mãi (lớp C122).
- `Employee.password_changed_at` do trigger `trg_employee_password_changed` đặt khi cột `password` đổi giá trị (migration `20261119c`) ⇒ admin đặt mật khẩu · người dùng tự đổi · mọi cửa sau này cùng một luật.
- `/auth/me` từ chối token có `iat` (giây) trước mốc đó: 401 `PASSWORD_CHANGED` ⇒ FE đưa về `/login?reason=password_changed`, trang đăng nhập hiện "Mật khẩu tài khoản đã được đổi — đăng nhập lại bằng mật khẩu mới". Máy đang mở bị đăng xuất ở lần làm mới kế tiếp (Shell gọi `/me` lúc tải trang và mỗi 5 phút) — cùng nhịp với đổi quyền / vô hiệu hoá tài khoản. Các API khác vẫn chỉ kiểm chữ ký token (không thêm một lượt đọc DB mỗi request); token tự hết hạn sau 24 giờ.
- **Đá NGAY (19/11 d — user: "đổi pass thì đá các đăng nhập ra và bắt đăng nhập lại")**: trigger còn phát `{table:'session', op:'REVOKE'}` lên kênh Broadcast CÁ NHÂN `wms-user-<id>` (migration `20261119d`) ⇒ mọi máy đang mở tài khoản đó kiểm lại phiên sau ~2,5 giây (`Shell` → `setSessionRevokedHandler`) ⇒ bị đưa về trang đăng nhập, không cần tải lại. Máy ngủ / mất mạng đúng lúc đó (Broadcast không phát lại): mở lại app sau ≥ 1 phút thì kiểm lại phiên ngay (`visibilitychange`). Máy đang TỰ đổi chờ lưu xong token mới rồi mới kiểm (`lib/selfPasswordChange.ts`) ⇒ không tự đá mình; tab khác cùng trình duyệt đọc chung token nên cũng ở lại.
- Tự đổi mật khẩu (`POST /auth/change-password`) trả kèm token mới ⇒ phiên đang dùng không bị đăng xuất (`authStore.applySession`). Gõ sai mật khẩu hiện tại ⇒ **400 `WRONG_PASSWORD`** (trước đây 401 làm app đăng xuất người đang gõ). Lỗi ghi mật khẩu không còn bị bỏ qua.
- Phát phiên (đăng nhập · `/me` · tự đổi) qua MỘT hàm `issueSession` ở `authController` (trước đây chép hai bản).
- Lưới: test `backend/tests/unit/sessionAge.test.ts` · gói 43 mục [4].
