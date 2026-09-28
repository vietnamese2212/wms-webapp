# Khách hàng (`customers`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Khách hàng (menu Cấu hình) — kênh · mức date

**Quyền (BE `ALL_PERMISSIONS`):** view · edit · import · manage_channel

## Giao thoa với
<!-- giao-thoa:start -->
- [`dispatch`](dispatch.md) — Điều vận (được nhắc tới từ đó)
- [`outbound`](outbound.md) — Xuất kho (hai chiều)
- [`wms_settings`](wms_settings.md) — Cài đặt WMS (file này nhắc tới)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

**Khách hàng** (menu Cấu hình, 11/09) — danh mục NƠI NHẬN khoá `ship_to_code` của SAP. 2 tab: **Khách hàng** (list chuẩn + chọn nhiều + thao tác hàng loạt) · **Kênh** (Kho tổng · NPP · BHX · KA · MT · Nội bộ · Khác — `LookupValue.type=customer_channel`; CHỈ NPP có sẵn mức ≥ 60 %, kênh khác để trống = chưa khai ⇒ không áp gì). **MỨC KHAI THEO CẶP (khách|kênh) × LOẠI HÀNG** trong bảng `date_rule_master` (đợt 2, 11/09): cùng một khách đòi FG01 ≥ 70 % nhưng FG02 ≥ 35 ngày, và 35 ngày KHÔNG quy được thành một con số % dùng chung (FG02 hạn 45–60 ngày ⇒ 77,8 % ở mã này, 58,3 % ở mã kia). Form khai là BẢNG nhỏ (Loại hàng · Kiểu · Giá trị), dòng "mọi loại hàng" LIỆT KÊ đúng loại chưa khai riêng và trừ dần; loại không có mã nào khai hạn dùng bị làm mờ kèm lý do (PM01: 0/888 mã); gõ mức là hiện QUY ĐỔI SỐNG ("≥ 60 % cho FG02 ≈ còn 27–36 ngày") — chính chỗ mức chung nuốt mất yêu cầu 35 ngày. Nuôi %Date tự động (thang ưu tiên ở RULE 4 hàng `outbound`) và luật Chuyển kho: `warehouse_id` = "nơi nhận này là KHO CỦA MÌNH" ⇒ kho nhận xác nhận trong app (`delivery_mode=SCAN`); để trống = khách ngoài ⇒ tài xế tự xác nhận (SELF). Khách chưa có trong danh mục / chưa phân kênh ⇒ **KHÔNG cấp %Date tự động**

## Actions

view, **edit**=thêm/sửa/ngừng + thao tác hàng loạt (Phân kênh · Đặt quy định date theo loại hàng · Trỏ kho · Ngừng; `PATCH /masterdata/customers/bulk` và `/bulk-rule` đều nhận `ids` HOẶC `filter`; sửa bộ mức = `PUT /masterdata/date-rules/CUSTOMER/:id` — THAY TRỌN, hai route tách theo scope để mỗi cái gate đúng quyền), **import**=Nạp từ dữ liệu SAP (2 pha, RPC `customer_seed_candidates`) — **GỢI Ý SẴN KHO** cho từng mã ship-to (`match_by` CODE mã kho / SHIPTO ship-to phụ / NAME trùng tên và tên đó DUY NHẤT; đo 11/09: **44/102 mã chính là kho đã có trong danh mục Kho** — 20 CODE · 24 NAME), cột "Trỏ về kho" tick sẵn nhưng **bỏ tick được từng dòng** và bước kiểm-trước nói rõ *bao nhiêu khách sẽ trỏ kho* + *bao nhiêu trong đó là kho CÓ QUẢN TỒN* (⇒ chuyến tới đó thành chuyển kho, kho nhận phải xác nhận trong app). Máy GỢI Ý, người tick mới ghi — trỏ nhầm kho là đổi nơi nhận của khách đó. Chiều ngược lại: ô **"Ship-to phụ" ở form Kho GHI THẲNG sang danh mục Khách hàng** (`syncShiptoCustomers`) — thêm mã ⇒ khách đã có thì chỉ trỏ kho, chưa có thì tạo (`auto_created`); **bỏ mã ⇒ GỠ liên kết, KHÔNG xoá khách** (khách có thể đang mang kênh/mức/ghi chú do người khai); mã đang trỏ kho khác trong danh mục ⇒ **409**. Hai cửa cùng một sổ vì `warehouseByShipto` tra danh mục Khách hàng TRƯỚC rồi mới tới `Warehouse.code`/`shipto_codes`; form Kho nay chặn mã sai dạng ngay (`^[A-Z0-9]+$`, cùng CHECK của `Customer`) thay vì để chết 23514 lúc đồng bộ, **manage_channel**=tab Kênh (tên + bộ mức mặc định, `PUT /masterdata/date-rules/CHANNEL/:value`) — quyền RIÊNG, KHÔNG đi ké `wms_settings.manage_type` vì đó là taxonomy Loại kho 
