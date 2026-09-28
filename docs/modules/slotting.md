# Tối ưu vị trí (Slotting) (`slotting`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Tối ưu vị trí

**Quyền (BE `ALL_PERMISSIONS`):** view · plan · delete · complete · cancel · reopen · configure

## Giao thoa với
<!-- giao-thoa:start -->
- [`directed_work`](directed_work.md) — Việc cần làm (được nhắc tới từ đó)
- [`inventory`](inventory.md) — Tồn kho (hai chiều)
- [`stocktake`](stocktake.md) — Kiểm kho (được nhắc tới từ đó)
- [`warehouse_map`](warehouse_map.md) — Sơ đồ kho (được nhắc tới từ đó)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Tối ưu vị trí (menu Kho WMS) — phân tích ABC theo lượt nhặt + kế hoạch sắp xếp kho (tiến độ suy sống từ vị trí pallet)

## Actions

view, **mỗi nút 1 quyền (tách 05/08)**: **plan**=tạo kế hoạch (preview+create), **delete**=xóa kế hoạch, **complete**=hoàn thành, **cancel**=hủy, **reopen**=mở lại (route PATCH gộp requireAnyPerm 3 quyền, controller kiểm đúng quyền theo status body), **configure**=tab Cài đặt trong trang (Hạng nhặt + Luồng cửa khu — route riêng PATCH /wms/slotting/zone-config/:id, KHÔNG đi ké manage_zone). Khu đặc thù (SCA lạnh…) = LOẠI KHO riêng (taxonomy có sẵn), không trường khớp tay; công nhân thực hiện chuyển pallet dùng `inventory.move_location` (trang Tồn kho) — kế hoạch tự tick; nút **Quét chuyển vị trí** (quét tem pallet đang ở đúng vị trí nguồn → máy chủ TỰ chuyển sang đúng vị trí đích của lệnh qua RPC khoá sức chứa, `POST /wms/slotting/plans/:id/scan-move`; không ai chọn vị trí tay) cũng gate `inventory.move_location` (cross-module). **Nút đứng ở HAI chỗ (16/09, user: "nút quét chuyển vị trí k có ở giao diện tối ưu vị trí à"):** cột *Thực hiện* của tab **Kế hoạch sắp xếp** trên từng dòng kế hoạch ĐANG THỰC HIỆN (mở thẳng màn quét của kế hoạch đó) · nút chính ở **header trang chi tiết** kế hoạch. Trước đó nút CHỈ nằm trong ô "Từ vị trí" của từng dòng còn chờ làm ⇒ kế hoạch mà phần lớn dòng đã xong/đã hết hàng thì gần như không thấy nút nào (đo Ba Vì: 52/54 dòng); bản 19/07 từng bỏ nút khỏi danh sách vì "ở ngoài không có tác dụng gì" — nay nút gắn theo ĐÚNG kế hoạch của dòng nên có tác dụng. Gói QA 52 [17]–[23] gác: chuyển đúng đích · pallet ngoài kế hoạch chặn · quét lại chặn · đích đầy chặn mà pallet giữ chỗ cũ · kế hoạch đã đóng không quét được 
