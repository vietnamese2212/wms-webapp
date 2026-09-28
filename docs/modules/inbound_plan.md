# Kế hoạch nhập chuyển kho (`inbound_plan`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** trong TMS Bookings (tab Kế hoạch)

**Quyền (BE `ALL_PERMISSIONS`):** view · edit

## Giao thoa với
<!-- giao-thoa:start -->
- [`tms_plan`](tms_plan.md) — Vận chuyển: Đặt lịch & Chuyển kho (file này nhắc tới)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

trong TMS Bookings (tab Kế hoạch) — KH nhập kho đích của chuyển kho, auto-tạo từ Outbound + upload. **KHÔNG còn khái niệm "KH nhập từ ngoài" / trang KH nhập đứng riêng**

## Actions

view, edit (create/delete/cancel ĐÃ BỎ 02/07 — mồ côi; tạo/sửa/xóa dòng KH đi theo `tms_plan.upload_inbound` hoặc `tms_plan.edit`) 
