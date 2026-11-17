# In tem pallet (`pallet_print`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** In tem pallet

**Quyền (BE `ALL_PERMISSIONS`):** view · generate · reprint · history · audit

## Giao thoa với
<!-- giao-thoa:start -->
- [`production`](production.md) — Sản xuất (tem pallet CỦA MẺ in bằng cùng khổ tem + `PALLET_PRINT_CSS` + `QRImg` của `components/shared/palletLabel.tsx` — đổi khổ / CSS in ở đây thì xem lại `BatchFlow.tsx`; QR của tem mẻ có tiền tố `MEB;`, không đi qua `parseInboundQR`)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

In tem pallet

- **Hàng NCC** (cờ "Hàng NCC" của Loại kho tại kho giữ pallet, vd RM01): tem in ô lớn **Lot · NCC (tên NCC) · Số pallet** thay "Chu kỳ · Máy" (user 18/11 "Lot/ NCC"); ô nhập khi sinh tem cũng ghi "Lot". Nhãn lấy ở `temSegLabels` (`utils/cargoCategory.ts`), dữ liệu vẫn ở cột `cycle` / đoạn 4 của QR. Cùng luật cho tem in lại sau Dồn / Tách (`components/shared/palletLabel.tsx`).
- **Vùng in** (`.pl-print-area`) luôn vẽ qua `components/shared/PrintArea.tsx` — portal vào `<body>`, giấu ngoài màn bằng `position:fixed`; hộp in mở khi ảnh QR đã vẽ xong (`printWhenReady`, thay canh giờ 150 ms). Ratchet `print_area_outside_portal` (C120).

## Actions

view, **mỗi tab 1 quyền (02/07)**: generate=tab Sinh tem mới, reprint=tab In lại từ tồn kho + nút In lại trong Lịch sử, history=tab Lịch sử in, audit=tab Truy cứu 
