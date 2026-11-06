# Giám sát vận hành (`control_tower`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Giám sát vận hành

**Quyền (BE `ALL_PERMISSIONS`):** view

## Giao thoa với
<!-- giao-thoa:start -->
- [`dashboard`](dashboard.md) — Dashboard (Tổng quan) (file này nhắc tới)
- [`warehouse_map`](warehouse_map.md) — Sơ đồ kho (được nhắc tới từ đó)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Giám sát vận hành (menu Tổng quan) — dashboard realtime + chế độ TV

## Actions

view

## 06/11/2026 — đồng bộ phong cách "trung tâm điều hành" với Dashboard

Dùng cùng khung với module Dashboard (`.kpi-console`, `StatCard`, `KpiPanel`, `RingMeter`) — chi tiết ở [dashboard.md](dashboard.md). Giao diện đổi, số không đổi, vẫn một lời gọi `/wms/control-tower`.

- **Màn TV vẫn tối:** bộ màu tối ăn theo selector `.dark .kpi-console`, mà overlay TV mang `dark` ở chính nó, nên `ConsoleBody` tự đặt lại `kpi-console`; bỏ lớp đó là thẻ trong TV ra màu sáng.
- **Nhịp theo giờ tách hai dải, mỗi dải một thang:** SL xuất quy đổi và pallet nhập khác đơn vị, chung một trục thì pallet bị đè bẹp, đọc thành "gần như không nhập".
- **Hàng xuất theo mã:** % trên dòng là con số có màu, không thanh bar (luật 19/10).
- **Xe trong cổng:** thời gian ở lại + giờ vào đứng ngay sau biển số, cột sau dài không đẩy chúng ra ngoài khung.
- **Chuyến đang soạn:** cố định 2 dòng ở mọi cỡ màn; một hàng làm mất tên NPP ở 1280, tự xuống dòng thì mỗi cỡ màn một chiều cao (C81).
- **Chưa làm vì payload chưa có số:** trạng thái cửa dock, nhật ký hoạt động gần đây của mẫu.
