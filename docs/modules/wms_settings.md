# Cài đặt WMS (`wms_settings`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Cài đặt WMS (kho, loại kho, ĐK bảo quản, khu, ca, QA, máy, hệ thống)

**Quyền (BE `ALL_PERMISSIONS`):** view · manage_warehouse · manage_type · manage_unit · manage_zone · manage_shift · manage_qa · manage_machine · manage_system

## Giao thoa với
<!-- giao-thoa:start -->
- [`alerts`](alerts.md) — Cảnh báo vận hành (được nhắc tới từ đó)
- [`customers`](customers.md) — Khách hàng (được nhắc tới từ đó)
- [`directed_work`](directed_work.md) — Việc cần làm (được nhắc tới từ đó)
- [`dispatch`](dispatch.md) — Điều vận (hai chiều)
- [`external_do_sap`](external_do_sap.md) — Dữ liệu bên ngoài → DO SAP (được nhắc tới từ đó)
- [`fill`](fill.md) — Fill hàng (nhặt lẻ) (được nhắc tới từ đó)
- [`outbound`](outbound.md) — Xuất kho (hai chiều)
- [`packing`](packing.md) — Sổ đóng gói (file này nhắc tới)
- [`tms_plan`](tms_plan.md) — Vận chuyển: Đặt lịch & Chuyển kho (file này nhắc tới)
- [`tms_vehicle_types`](tms_vehicle_types.md) — TMS — Loại xe (hai chiều)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Cài đặt WMS (kho, loại kho, **ĐK bảo quản**, khu vực, ca nhập, QA, **Máy**, **Hệ thống**)

## Actions

view, manage_warehouse, **manage_type**=tab Loại kho **+ tab "ĐK bảo quản"** (24/09 — danh mục `LookupValue type='storage_condition'`, user chốt 4 mức *Lạnh âm · 2–8 °C · 15–25 °C · Thường*, `meta` = {label, temp_min, temp_max, badge_color}; dùng CHUNG cho HÀNG và XE: Loại kho khai `meta.storage_condition` ở form Loại kho ⇒ mã hàng thừa kế theo loại, dòng xe khai `vehicle_model.storage_conditions` ở Cài đặt TMS ⇒ engine điều vận khớp hai bên. **Để trống ở bên nào = bên đó KHÔNG ràng buộc** (mặc định = hành vi cũ; cố ý KHÔNG seed cho 5 Loại kho — đoán hộ "FG02 là hàng lạnh" rồi ghi vào master là lớp lỗi đã cấm). Xoá một mức đang được Loại kho / dòng xe dùng → 409 nêu nơi dùng. ⚠️ `sanitizeMeta` của `lookupController` **whitelist khoá meta theo TỪNG type** — thêm danh mục mới có meta mà quên khai khoá thì giá trị bị vứt ÂM THẦM, không lỗi không cảnh báo, đúng lớp C36), manage_zone, manage_shift, manage_qa, **manage_machine**=tab Máy (danh mục máy THEO KHO, bảng `warehouse_machines` — user 13/08: kho có setup máy thì Sổ đóng gói mở/sửa trang 422 `MACHINE_INVALID` nếu máy ngoài danh mục + form thành dropdown; In tem Sinh tem V1 dropdown máy theo kho NMSX; kho chưa setup → điền tự do; GET /masterdata/machines hở đọc user đăng nhập), **manage_system**=tab Hệ thống (cờ `label_format` định dạng tem in — multi-tenant; từ 13/08 thêm THAM SỐ VẬN HÀNH: `cycle_count` chu kỳ kiểm ABC + `retention_days` ảnh/feed/log + `inbound_edit_window_days` + `packing_max_materials_per_run` — default+validator MỘT nguồn `utils/settings.ts`, consumer đọc getter cache 30s, QA gói 23 round-trip; **14/08 thêm `standard_work_hours`** (giờ công chuẩn 1 ngày công, mặc định 8, nhận nửa giờ — BE `getStandardWorkHours` và FE `useStandardWorkHours` phải đọc CÙNG cờ, đừng nhân 8 tại chỗ) **+ `vn_holidays`** (lịch nghỉ lễ khai theo NĂM — năm khai thì bảng công dùng đúng danh sách khai, năm không khai vẫn tự tính lịch âm như cũ; UI = mỗi ngày 1 dòng có Ô CHỌN NGÀY + nút "Nạp lịch tự tính", KHÔNG gõ văn bản tự do) **+ `org_profile`** (nhận diện & tham số RIÊNG đơn vị: email kỹ thuật Web Push · ánh xạ mã nhà máy cũ→mới · cỡ thùng giả định sơ đồ xếp xe — gỡ hằng số của LOF nằm rải trong code, **mặc định = đúng giá trị đang chạy**; CORS domain đọc ENV `CORS_ORIGINS`; đổi email là ghi luôn `push_config.subject`, không để thành ô ma) **+ `dashboard_cache_seconds`** (21/08 — TUỔI tối đa của số liệu trang chủ, mặc định **300s = 5 phút**, 0 = tắt cache; số liệu Dashboard là tổng hợp TOÀN CÔNG TY nên dưới tải ghi đồng thời đo p50 **28,3s** max **36,0s** kèm 500 — đã loại trừ query (ấm 64ms, index giả định không nhanh hơn), nút thắt là XẾP HÀNG pool PostgREST ⇒ cách duy nhất có tác dụng là đừng chạy tổng hợp nặng trong mọi request; cache đặt Ở DB không phải RAM lambda vì tải cao Vercel bung thêm instance = đúng lúc cache RAM vô dụng nhất) **+ `receipt_rating`** (28/08 — `{ mode: 'off' | 'optional' | 'required' }`, mặc định `optional`: kho NHẬN chấm sao chuyến giao; `required` chặn ở bước HOÀN THÀNH phiếu nhận (không phải bước xác nhận — lúc xác nhận chưa mở hàng ra xem, chấm lúc đó là chấm mò), chỉ áp phiếu `source_type='TRANSFER'`. **FE (02/09, user chốt "hoàn thành đơn thì phải đánh sao luôn"): tab Chuyển kho gác MỌI đường hoàn thành phiếu nhận bằng `withRating()` — chưa chấm thì bấm Hoàn thành / "Nhận & hoàn thành" là MỞ NGAY ô chấm sao, lưu xong mới chạy hoàn thành; `optional` có nút "Bỏ qua, hoàn thành", `required` không; đã chấm hoặc chuyến không thuộc diện (`can_rate=false`) thì chạy thẳng. Đừng quay lại kiểu nút "Đánh giá" đứng riêng — ai nhớ mới bấm thì không ai bấm. **AI ĐƯỢC CHẤM — user chốt 28/08 "NPP xác nhận sao thôi":** CHỈ kho NHẬN (403 `RATER_NOT_RECEIVER` nếu scope user không chứa kho nhận; superadmin/NATIONAL vẫn được để sửa khi chấm nhầm). Kho nhận KHÔNG tích nhận (`TmsOrder.delivery_mode='SELF'` — tài xế tự bấm hoàn thành) và chuyến giao khách ngoài ⇒ **KHÔNG chấm** (422 `NOT_RATABLE`) vì không ai mở hàng ra xem trong app; đo staging 28/08 có **30 chuyến SELF** mà bản đầu cho chấm hết. FE ẩn/hiện nút theo cờ `can_rate` do BE trả (MỘT nguồn, đừng suy luận lại). Báo cáo dùng mẫu số `ratable_trips` = chuyến THUỘC DIỆN CHẤM, không phải mọi chuyến — lấy mọi chuyến làm mẫu số là vu oan kho lười chấm (kỳ 07→08: 3.129 chuyến nhưng chỉ 1 chuyến chấm được))) 

## Form Kho 28/09 — ship-to nhận, kho nhận chưa trỏ, điểm giao không giới hạn

Ô "Mã ship-to phụ" (gõ tay) ⇒ **"Ship-to nhận vào kho này"**: `MultiSelectFilter` tìm khách trên server (`useCustomers search`), nhãn mã đã chọn ghim vào options; giá trị ban đầu = `shiptos` (list API `/masterdata/warehouses` trả từ `Customer.warehouse_id`); lưu vẫn gửi `shipto_codes` (danh sách mã) nhưng BE chỉ đồng bộ vào Customer, **không ghi cột `Warehouse.shipto_codes`** nữa (cột chết, DROP đợt sau). Khu XUẤT thêm nhóm **"Kho nhận (chuyển kho)"** → `unlinked_shipto_policy` Không / Nhắc / Chặn hoàn thành (mặc định Không = hành vi cũ; khuyên bật Nhắc ở kho xuất thật). "Điểm giao tối đa một chuyến" cho phép **trống = không giới hạn** (1–50; DB CHECK đổi theo). Tạo kho ⇒ khách đã có cùng mã tự trỏ kho.

**02/10 — Ghim kho trên bản đồ (điều vận trên bản đồ, đợt 2):** form Kho có ô "Vị trí kho trên bản đồ" (`GeoPicker`: chấm/kéo ghim, GPS điện thoại, nút Lưu vị trí RIÊNG — cửa `PATCH /masterdata/warehouses/:id/location`, quyền `manage_warehouse`, không nới `updateWarehouse`). Kho chưa ghim ⇒ Điều vận không đo được km (tab Bản đồ báo vàng). Cột `Warehouse.geo_*` (migration `20261002`). Chi tiết: [dispatch.md](dispatch.md) mục 02/10.
