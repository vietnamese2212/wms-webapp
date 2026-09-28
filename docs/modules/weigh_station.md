# Phiếu cân (trạm cân) (`weigh_station`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Phiếu cân

**Quyền (BE `ALL_PERMISSIONS`):** view · match

## Giao thoa với
<!-- giao-thoa:start -->
- [`dispatch`](dispatch.md) — Điều vận (file này nhắc tới)
- [`outbound`](outbound.md) — Xuất kho (file này nhắc tới)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Phiếu cân (menu Điều vận)

## Actions

view, match=gắn/gỡ phiếu cân với chuyến. **MÃ TRẠM CÂN KHÔNG PHẢI CẤU HÌNH CHUNG (chốt 14/08):** đơn vị có nhiều trạm ở nhiều kho; `source_id` phần mềm cân là autonumber đếm từ 1 ở MỖI trạm ⇒ 2 trạm cùng mã sẽ **đè phiếu của nhau** qua khóa upsert `(station_code, source_id)`. Agent từng trạm PHẢI khai `station_code` riêng (thiếu → 400; mã đang dùng cho kho khác → 409 `STATION_CODE_CONFLICT`) — **không có mã mặc định** ở BE. Gói QA 24 gác. Trang có 2 cột đối chiếu KL (01/08): "KL tính" = KL hàng chuyến gắn (RPC `gdo_weight_estimates`: Σ SL÷đv/thùng×`Material.weight_kg`, ưu tiên thực xuất, `*` = có mã thiếu KL) + "Lệch cân−tính" (đỏ khi |lệch|>5%); detail chuyến có khối "Cân xe" tương ứng. 2 rule cổng/cân khi Bắt đầu = 2 checkbox per kho trong form Kho (WMS Settings) + 2 quyền duyệt riêng `outbound.gate_waive`/`outbound.weigh_waive` (xem hàng outbound) 
