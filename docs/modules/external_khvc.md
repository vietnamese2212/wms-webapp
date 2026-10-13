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

**13/10 — ĐẠI PHẪU: kho dùng bàn ghép xe thì BÀN là cửa ghi duy nhất của sổ này (user chốt).** Dòng `source='DISPATCH'` (bàn ghi lúc Xác nhận)
**khoá ở tab này cả 5 cửa** — sửa (`PUT`) · đổi ngày hàng loạt · xoá · xoá hàng loạt · thêm DO vào Số xe do bàn ghi — trả 409 `KHVC_LINE_FROM_DISPATCH`
(bulk trả `blocked` per-xe, xe Excel / tay cùng lượt vẫn làm). ĐVVT / dòng xe / xe phụ đổi NGAY TRÊN BÀN kể cả xe đã chốt (`PATCH /tms/dispatch/trips/:id`
ghi xuyên mọi dòng của Số xe rồi `replanKhvcGroups`); thêm bớt DO hay dời ngày thì "Mở lại" xe trên bàn. Dòng EXCEL / MANUAL (kho chưa dùng bàn) sửa
như cũ. KHÔNG cờ cấu hình — khoá theo nguồn từng dòng. FE: chip nguồn "Bàn ghép xe", editor khoá ô + băng "do bàn ghép xe ghi" + nút "Sửa ở bàn ghép xe"
(`GET /external/khvc` enrich `dispatch {trip_id, plan_id, warehouse_id, segment, plan_date}`; gate `useCanSeePath`). Dọn 13/10: 68 dòng MANUAL seed
tháng 9 ⇒ 6 xoá qua `bulk-delete`, 62 bị chặn (chuyến đã hoàn thành / đang xuất) giữ nguyên. Chi tiết + lưới: [`dispatch`](dispatch.md) mục 13/10 tối.
