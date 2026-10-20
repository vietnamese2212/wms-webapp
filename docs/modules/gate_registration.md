# Đăng ký cổng (`gate_registration`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Đăng ký cổng

**Quyền (BE `ALL_PERMISSIONS`):** view · create · edit · delete · call · entry · exit

## Giao thoa với
<!-- giao-thoa:start -->
- [`dashboard`](dashboard.md) — Dashboard (Tổng quan) (được nhắc tới từ đó)
- [`outbound`](outbound.md) — Xuất kho (được nhắc tới từ đó)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Đăng ký cổng

## Actions

view, create, edit, delete, call, entry, exit 

## 20/10 — xe chở lẫn loại kho nối được lệnh VC

Lệnh VC của xe chở lẫn mang chuỗi GHÉP `FG01+PM01`; ô Loại kho của đăng ký chỉ chọn MỘT loại. Gợi ý booking và phép nối cổng ↔ lệnh
(`relinkAfterDelete`) đọc CÙNG hàm `singleTypeMatches` (utils/categoryScope — test `tests/unit/categoryScope.test.ts`); cửa tạo / sửa đăng
ký gác phạm vi loại bằng `categoryAllowed` (giao ≥1 loại). Trước 20/10 phép nối so nguyên chuỗi ⇒ mọi xe chở lẫn không gắn lệnh (Đặt lịch
không thấy "Đang xuất / Đã xuất"). Chưa gác (đề xuất chờ user): Ra cổng khi xe chưa Vào · Ra cổng khi chuyến bên Xuất chưa hoàn thành ·
Nhân viên bảo vệ không có quyền `call` (Gọi xe) — NV SAP gọi.
