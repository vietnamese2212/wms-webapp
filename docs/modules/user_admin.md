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
