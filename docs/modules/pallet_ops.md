# Dồn / Tách pallet (`pallet_ops`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Dồn / Tách pallet

**Quyền (BE `ALL_PERMISSIONS`):** view · merge · ungroup · split

## Giao thoa với
<!-- giao-thoa:start -->
- [`inventory`](inventory.md) — Tồn kho (hai chiều)
- [`help`](help.md) — Hỗ trợ (bài hướng dẫn `frontend/src/help/guides/donTach.ts` + ảnh `public/guide/don-tach/` — đổi giao diện / tên nút thì chụp lại ảnh + sửa chữ bài)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Dồn / Tách pallet

- In tem pallet con (sau Tách / từ Lịch sử): hàng NCC (cờ Loại kho tại kho đang thao tác) in ô **Lot · NCC (tên NCC)** như trang In tem pallet (18/11); hộp in mở khi ảnh QR vẽ xong (`printWhenReady`).

**Tách — pallet con kế thừa lý lịch lô (19/11, C123):** mã hàng · NCC · NMSX · lô / chu kỳ · máy · NSX · HSD · HSD theo NCC · QA chép nguyên từ tem gốc qua MỘT danh sách `CHILD_INHERITED_COLS` (`utils/palletChild.ts`); số lượng = số tách, ngày nhập = ngày nhập của gốc. Trước 19/11 con mất NCC / NMSX / HSD theo NCC (gói 27 [4c] gác). Ô số lượng tách giữ phần lẻ (hàng tính KG).

**Hoàn tác hỏi lại (19/11, C128):** nút "Hoàn tác" ở tab Lịch sử mở hộp xác nhận nêu rõ hệ quả (xoá pallet con + cộng lại gốc / trả pallet về như trước dồn). In tem con đi chung luật ghi Lịch sử in của In tem pallet (C127).

## Actions

view, merge, ungroup, split 
