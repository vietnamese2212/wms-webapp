# Cước vận chuyển (`freight`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Cước vận chuyển (menu TMS)

**Quyền (BE `ALL_PERMISSIONS`):** view · manage · export

## Giao thoa với
<!-- giao-thoa:start -->
- [`dispatch`](dispatch.md) — Điều vận (hai chiều)
- [`external_do_sap`](external_do_sap.md) — Dữ liệu bên ngoài → DO SAP (file này nhắc tới)
- [`external_khvc`](external_khvc.md) — Dữ liệu bên ngoài → Kế hoạch xuất (file này nhắc tới)
- [`outbound`](outbound.md) — Xuất kho (file này nhắc tới)
- [`tms_companies`](tms_companies.md) — TMS — ĐVVT / NCC (hai chiều)
- [`tms_vehicle_types`](tms_vehicle_types.md) — TMS — Loại xe (hai chiều)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

**Cước vận chuyển** (menu TMS, 23/09; plan `docs/plans/TMS_DISPATCH_PLAN.md` 6.0–6.4) — 3 tab cùng bộ lọc kho xuất · ĐVVT · dòng xe: **Bảng cước** `freight_tariff` khoá (kho xuất × ĐVVT × dòng xe CON × phường "Tên Phường" SAP × hiệu lực từ) — xe pallet = đơn giá × pallet **làm tròn LÊN** (không pallet tối thiểu), xe khác trọn chuyến; upload 2 pha đúng cột file thật (`Tỉnh/TP (Cũ)` · `Quận/Huyện (Cũ)` · `Tỉnh/TP (Mới)` · `Phường/Xã (Mới)` · `Cự ly (Km)` · `DVVT` · `Loại xe` · `Cước (VND)` · `Mã xe SAP` + `Kho xuất` · `Hiệu lực từ`), all-or-nothing, kiểm-trước so với sổ (thêm/đè giá/không đổi), phường khớp khách SAP trọn mã hoặc theo tên duy nhất, chưa khớp → cảnh báo; dòng cước đã dùng cho chuyến không xoá, kết thúc bằng `effective_to`. **Phụ phí** `freight_surcharge` theo kho × ĐVVT [× dòng con], loại = LookupValue `freight_surcharge_kind` (DROP_POINT · LOADING · WAITING · OTHER, thêm loại không cần code), `per` PER_STOP/TRIP/PALLET/TON; **rớt điểm theo THỰC TẾ chuyến**: dưới `min_stops` (2) = 0, `ALL_STOPS` mỗi điểm một khoản (mặc định theo lời user) · `EXTRA_STOPS` chỉ điểm thêm. **Phân tuyến ĐVVT** `carrier_allocation` (ưu tiên theo WARD/REGION) + `carrier_share_target` (tỷ trọng %/tháng theo TRIPS/PALLETS/TONS, Σ một kho ≤ 100 → 400 — **cửa POST đếm CẢ dòng của chính ĐVVT đang thêm**, vì unique key là (kho, ĐVVT, hiệu lực TỪ) nên dòng thứ hai khác ngày là hợp lệ và bỏ nó ra khỏi Σ là mở đường cho >100 âm thầm + hai mục tiêu cho một ĐVVT; cửa PUT loại theo ID — lớp C38. Đổi mức sang kỳ mới thì đặt `effective_to` cho dòng cũ trước). **Đã khai 24/09 trên staging** (user duyệt): Ba Vì HA 34 · ALCA 28 · DA 23 (Σ 85) · Bàu Bàng HN 47 · PAQ 25 · BMT 12 (Σ 84), cơ sở TRIPS, số lấy từ đo tỷ lệ OD trên ZSD02 — **chừa headroom có chủ đích**, phần OD chưa gắn ĐVVT không đoán hộ. Đo A/B Ba Vì 07/09: **tắt tỷ trọng ⇒ 49/49 chuyến có cước đổ hết vào MỘT ĐVVT (Hải An); bật ⇒ HA 23 · ALCA 14 · DA 12, Σ cước +2,71 %** — đó là giá của việc không phụ thuộc một nhà xe: engine chọn ĐVVT = ưu tiên khu vực → ĐVVT dưới tỷ trọng → rẻ nhất. Luật tính = `services/freight.ts` thuần (test `tests/unit/freight.test.ts`): `computeFreight` · `stopFeeQty` · `billedPallets` (ceil có đệm sai số) · `pickTariff` (hiệu lực mới nhất) · `farthestWard` (phường xa nhất theo km). Mọi cửa đọc cắt theo kho xuất trong phạm vi, cửa ghi 403 ngoài phạm vi. Bảng rỗng = chuyến không có cước, không chặn gì. **Cước/tải LÊN CHUYẾN (23/09 chiều, mục 15):** điều vận chọn **Dòng xe con (mã SAP)** = ô CẤP XE trong editor Kế hoạch xuất (cùng khuôn cửa booking — 1 ô cả xe, BE đồng bộ mọi dòng, sự kiện `PLAN_VEHICLE_MODEL_CHANGED`; upload KH nhận cột tuỳ chọn "Mã xe SAP", sai → 400 `VEHICLE_MODEL_INVALID`, không có cột → GIỮ lựa chọn tay) → dội xuống `GroupDeliveryOrder.vehicle_model_id` → `services/freightEstimate.ts` ghi `freight_estimated/freight_tariff_id/freight_detail` (phường xa nhất theo `erp_outbound_orders.ward_code` → `Customer.ward_code`; ĐVVT qua resolver alias) ngay sau derive (PLAN), khi Hoàn thành (ACTUAL) và qua `POST /tms/freight/recompute` (bảng cước nạp SAU kế hoạch). List Xuất kho: cột **Dòng xe con · Tải n/cap % (Non tải đỏ dưới `underload_pct`) · Cước dự tính**; % tải tính SỐNG (`loadOf` + `loadUtilization`), cước đọc cột đã ghi — thiếu cước thì tooltip nói lý do. Gói QA 60 [6] gác (oracle giá × ceil(pallet từ master))

## Actions

view, **manage**=thêm/sửa/kết thúc hiệu lực · upload cước · phụ phí · phân tuyến, **export**=Xuất Excel bảng cước / cước tháng (đợt 3). **Đã cấp cho chức danh 24/09** (`20260924d`, 7 chức danh / 7 người xem được, 2 chức danh sửa được): cước là dữ liệu TIỀN theo hợp đồng nên hẹp hơn Điều vận — `view` ← quản danh mục vận tải hoặc đã được xem tiền, `manage` ← đang khai chi phí kho hoặc làm chủ danh mục dòng xe 
