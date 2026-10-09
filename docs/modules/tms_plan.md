# Vận chuyển: Đặt lịch & Chuyển kho (`tms_plan`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** TMS Bookings (Đặt lịch · Chuyển kho)

**Quyền (BE `ALL_PERMISSIONS`):** view · create · edit · delete · add_vehicle · release · change_date · book · revoke · upload_outbound · upload_inbound · confirm_receipt · export

## Giao thoa với
<!-- giao-thoa:start -->
- [`dispatch`](dispatch.md) — Điều vận (được nhắc tới từ đó)
- [`external_khvc`](external_khvc.md) — Dữ liệu bên ngoài → Kế hoạch xuất (hai chiều)
- [`inbound_plan`](inbound_plan.md) — Kế hoạch nhập chuyển kho (được nhắc tới từ đó)
- [`outbound`](outbound.md) — Xuất kho (được nhắc tới từ đó)
- [`wms_settings`](wms_settings.md) — Cài đặt WMS (được nhắc tới từ đó)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

TMS Bookings (tab Đặt lịch + Chuyển kho). **HAI TRẠNG THÁI KHÁC NHAU, đừng suy cái này từ cái kia (lỗi 09/09):** `TmsOrder.status` (PENDING·DONE·CANCELLED) = LỆNH đã xong chưa, do kho nhận xác nhận; `TmsVehicleSlot.status` (PENDING·BOOKED·ARRIVED·DONE) = DÒNG XE, nhưng app **chỉ ghi tới `BOOKED`** — ARRIVED/DONE mới chỉ được ĐỌC trong các gác an toàn. Ô "Hoàn thành" của SummaryBand từng suy từ trạng thái dòng xe nên đứng yên **0/N** vĩnh viễn; nay đếm HỢP hai đường — lệnh tự mang `status='DONE'` (nhập/chuyển kho đã nhận) **HOẶC** có CHUYẾN cùng Số xe đã COMPLETED (lệnh sinh từ Kế hoạch xuất giữ PENDING, việc xong nằm ở chuyến) — `20260909_…` + `20260909b_…`, gói QA 14 mục 9. Thêm báo cáo mới đếm "đã xong" → hỏi "cột này có đường ghi nào đặt giá trị đó không?" trước khi tin.

## Actions

view, create, edit, delete, add_vehicle, release, change_date, book, revoke, upload_outbound, upload_inbound, **confirm_receipt**=nhận hàng chuyển kho (xác nhận/quét/hoàn thành), **export**=Xuất Excel Báo cáo nhập (menu Báo cáo TMS) 

## 28/09 — lệnh chuyển kho và kho đích

Kho đích của lệnh chuyển kho sinh lúc Hoàn thành = khách trỏ kho (`services/transferDest`), không còn dò theo mã kho / tên. Ship-to chưa trỏ ⇒ lệnh OTHER nằm dưới **kho xuất** (`warehouse_id` = kho xuất, `destination_warehouse_id` null) — migration 20260929 đưa 62 lệnh PENDING/SELF của các kho NPP vừa ngừng về đúng chỗ này. Trỏ kho sau khi chuyến đã hoàn thành ⇒ kho xuất bấm "Đẩy lại cho kho nhận" (module `outbound`), lệnh cũ được đồng bộ tại chỗ (giữ id, kế hoạch nhập sinh lại). Upload Kế hoạch VC tra kho theo mã/tên kho + `shiptos` (khách trỏ kho), không còn `shipto_codes`.
**29/09:** khoá duy nhất dòng Kế hoạch nhập nay theo LỆNH (`20260929b`: `(date, warehouse_id, ncc_id, material_id, tms_order_id)`) — hai lệnh chuyển kho cùng ngày/kho/mã từng đụng khoá và mất dòng âm thầm (gói 28 [12c]). Ghi dòng thất bại ⇒ `error_logs` `TRANSFER_PLAN_LINES_FAILED`; nút Đẩy lại trả 409 `PLAN_LINES_FAILED`. **09/10:** dòng Kế hoạch nhập của lệnh được THAY TRỌN trong MỘT giao dịch (RPC `transfer_plan_lines_replace`, 20261009a) — bản "chèn mới rồi xoá cũ" bằng hai request đụng chính khoá trên khi Bỏ hoàn thành → sửa SL → Hoàn thành lại TRONG NGÀY, kho nhận giữ số cũ (gói 28 [3b]/[3c] đo dòng).
