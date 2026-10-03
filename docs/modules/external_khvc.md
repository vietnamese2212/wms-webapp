# Dữ liệu bên ngoài → Kế hoạch xuất (`external_khvc`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Dữ liệu bên ngoài → Kế hoạch xuất

**Quyền (BE `ALL_PERMISSIONS`):** view · create · edit · delete

## Giao thoa với
<!-- giao-thoa:start -->
- [`directed_work`](directed_work.md) — Việc cần làm (được nhắc tới từ đó)
- [`dispatch`](dispatch.md) — Điều vận (hai chiều)
- [`external_do_sap`](external_do_sap.md) — Dữ liệu bên ngoài → DO SAP (được nhắc tới từ đó)
- [`freight`](freight.md) — Cước vận chuyển (được nhắc tới từ đó)
- [`outbound`](outbound.md) — Xuất kho (hai chiều)
- [`tms_plan`](tms_plan.md) — Vận chuyển: Đặt lịch & Chuyển kho (hai chiều)
- [`tms_vehicle_types`](tms_vehicle_types.md) — TMS — Loại xe (được nhắc tới từ đó)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

_Không có dòng riêng trong bảng cũ — luật của Kế hoạch xuất nằm ở [`outbound`](outbound.md) (XUẤT = KẾT QUẢ DẪN XUẤT, KẾ HOẠCH ĐI TRƯỚC SAP), [`dispatch`](dispatch.md) (Xác nhận ghi khvc_lines) và [`tms_plan`](tms_plan.md) (lệnh VC tự sinh)._

**03/10 tối — hai cửa ghi `khvc_lines` MỚI từ bàn Điều vận** (đợt 2 vòng đời OD, chi tiết ở [`dispatch`](dispatch.md)): `POST /tms/dispatch/khvc/remove` (gỡ một DO khỏi một Số xe, lý do + nhật ký) và `POST /tms/dispatch/khvc/renumber` (đổi `do_no` sang DO SAP thay thế, tách 1→N thêm dòng cùng Số xe). Cả hai đi qua **cùng gác `classifyKhvcDelete`** và **cùng `replanKhvcGroups`** như xoá / sửa ở tab Kế hoạch xuất — luật "hai cửa cùng một sổ phải cùng luật"; quyền `dispatch.confirm` HOẶC `external_khvc.delete/edit`. Rào DB `trg_khvc_one_export_day` vẫn kiểm cả UPDATE `do_no`.

## Actions

view, create, edit, delete
