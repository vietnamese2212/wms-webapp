# TMS — Loại xe (`tms_vehicle_types`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Cài đặt TMS — Loại xe + Mã dòng xe

**Quyền (BE `ALL_PERMISSIONS`):** view · create · edit · delete

## Giao thoa với
<!-- giao-thoa:start -->
- [`dispatch`](dispatch.md) — Điều vận (được nhắc tới từ đó)
- [`external_khvc`](external_khvc.md) — Dữ liệu bên ngoài → Kế hoạch xuất (file này nhắc tới)
- [`freight`](freight.md) — Cước vận chuyển (hai chiều)
- [`wms_settings`](wms_settings.md) — Cài đặt WMS (hai chiều)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Cài đặt TMS — **DANH MỤC HAI TẦNG (user chốt 23/09):** dòng xe **CHA** = `VehicleType` (7 mã, giữ nguyên — kho booking khung giờ / đăng ký cổng / Kế hoạch xuất theo cha) + dòng xe **CON** = bảng `vehicle_model` mang mã SAP 9100000xx, sức chứa (pallet/tấn/m3/điểm giao), nhiệt (nóng/lạnh/kết hợp/khô), `tariff_unit` PER_PALLET/PER_TRIP, ngưỡng Non tải — CHỈ điều vận dùng (ghép chuyến, cước). Seed 60 dòng theo bảng user gửi (migration `20260923`), `parent_type_id` NULL = chưa gán cha ⇒ engine bỏ qua, UI băng "n chưa gán cha" + tick nhiều → "Gán cha" (`PATCH /tms/vehicle-models/assign-parent`). Khối `components/tms/VehicleModelsPanel.tsx` là **tab riêng "Mã dòng xe"** trong Cài đặt TMS (user chốt 23/09 — bản đầu để dưới bảng cha trong tab Loại xe). Xoá dòng con đang có cước/phụ phí/kế hoạch/chuyến → 409. **Cột `storage_conditions text[]` (24/09) = các ĐIỀU KIỆN BẢO QUẢN xe chở được** (danh mục ở Cài đặt WMS → ĐK bảo quản): RỖNG = mọi điều kiện (cùng quy ước `Location.categories`), khai lẻ ở form hoặc tick nhiều → "Điều kiện bảo quản" (`PATCH /tms/vehicle-models/assign-conditions`, mã ngoài danh mục → 400 `STORAGE_CONDITION_INVALID`); ô band "Chưa khai ĐK bảo quản" đếm dòng đang được coi là chở được mọi mức. Backfill 60 dòng theo TÊN xe: `(lạnh)` → lạnh âm + 2–8 + 15–25 · `kết hợp` → cả 4 · `(nóng)`/`(khô)`/`Xe N Pallet` → Thường. `temp_mode` cũ chỉ còn là đầu vào gợi ý cha của migration, KHÔNG quyết định gì trong engine — **25/09 bỏ khỏi form + bảng** cùng `vehicle_model.allow_mix_channels` (engine không đọc; trộn kênh là tham số KHO `dispatch_allow_mix_channels`), user hỏi "Nhiệt độ khô xong lại chọn điều kiện bảo quản là sao?"; cột DB giữ, form không gửi. Tick nhiều → **"Tạm dừng" / "Hoạt động lại"** hàng loạt (song song qua `PUT` lẻ): engine chỉ nạp dòng `is_active` ⇒ đây là cách khai "đội xe thật sự dùng" — staging giữ 4 dòng xe pallet (4 · 6 · 16 · 17), 18 dòng pallet còn lại tạm dừng; 5 dòng "Xe … Pallet kết hợp" chuyển cha XE SCA 26/09 (họ xá — xe pallet quyết bởi cờ cha `is_pallet_truck`). Danh mục dòng xe dùng CHUNG mọi kho (chưa khai đội xe theo kho). **Ô "Điều vận dùng dòng xe này cho" (`dispatch_use` ALL | TRANSFER) ĐÃ BỎ 28/09** (user: "dòng xe chọn theo khai báo của khách, không khai thì không chọn — bỏ config ở chỗ này để tập trung vào config của Khách hàng"): form + cột bảng gỡ, engine không đọc (luật 8 bỏ); cột DB giữ, zod còn nhận để bundle cũ không 400. Dòng xe nào đi cho khách nào chỉ khai ở **Khách hàng → Dòng xe được vào** (theo kênh, riêng khách khi cần) — xem [`dispatch`](dispatch.md) luật 10. Gói QA 60 + 61 [7] gác

## Actions

view, create, edit (gồm gán cha · sức chứa · điều kiện bảo quản), delete (sửa cha chỉ đổi Tên + trạng thái; Mã khóa cố định) 
