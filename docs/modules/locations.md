# Vị trí kho (`locations`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Vị trí kho (+ tab Sơ đồ kho)

**Quyền (BE `ALL_PERMISSIONS`):** view · create · edit · delete · import · export · print_label

## Giao thoa với
<!-- giao-thoa:start -->
- [`dispatch`](dispatch.md) — Điều vận (được nhắc tới từ đó)
- [`fill`](fill.md) — Fill hàng (nhặt lẻ) (được nhắc tới từ đó)
- [`warehouse_map`](warehouse_map.md) — Sơ đồ kho (hai chiều)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Vị trí kho

## Actions

view, create, **edit** (14/09, user "thêm rồi không sửa được khá nhiều — không hợp lý": ô **TRỐNG** đổi được Khu / Dãy / Tầng — `PUT` nhận `sub_code/row/shelf`, mã ghép lại theo tiền tố kho, GIỮ id nên toạ độ Sơ đồ kho + cờ + lịch sử còn nguyên, form nhắc in lại tem; ô có hàng ⇒ 409 `LOCATION_NOT_EMPTY`, còn việc treo trỏ vào ⇒ 409 `LOCATION_HAS_TASKS`, form NÓI lý do thay vì ẩn ô; **Kho không bao giờ đổi** — pallet thuộc kho; gói 57 [26a–26e]), delete, **import**=Upload Excel tạo vị trí hàng loạt (dựng kho mới; Loại hàng + Tên khu lấy từ `WarehouseZone`, khu chưa khai → chặn cả file), **export**=Xuất Excel danh sách, **ĐK bảo quản riêng của ô** (26/09, `Location.storage_condition`, NULL = theo Loại kho; cột + ô form + hàng loạt, gate `edit`; thông tin WMS — **điều vận KHÔNG đọc** từ 27/09, xe chọn theo Loại kho của mã hàng), **print_label**=In tem QR vị trí dán lên kệ (in theo BỘ LỌC đang áp, 8 tem/A4, `components/wms/locationLabel.tsx`) 
