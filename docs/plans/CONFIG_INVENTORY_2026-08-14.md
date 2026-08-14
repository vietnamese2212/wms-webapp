# Kiểm kê CẤU HÌNH — 14/08/2026

> Câu hỏi: "các setting/configuration đang có, cái nào CHƯA tập trung".
> Đo lại từ code hôm nay (không chép audit 13/08). Bổ sung cho `HARDCODE_AUDIT_2026-08-13.md`
> (file đó xếp theo rủi ro; file này xếp theo **NƠI CHỈNH** — người vận hành đổi ở đâu).

## PHẦN 1 — ĐÃ TẬP TRUNG (đổi được trong app, không cần lập trình viên)

| Nơi chỉnh | Chứa gì | Ghi chú |
|---|---|---|
| **Cài đặt WMS ▸ Hệ thống** | 9 khóa `SystemSetting`: `label_format` · `decimal_separator` · `delivery_confirmation` · `retention_days` · `cycle_count` · `inbound_edit_window_days` · `packing_max_materials_per_run` · (+`pct_date_bands`, `truck_models` chưa có ô UI riêng) | mặc định + validator MỘT nguồn `backend/src/utils/settings.ts` |
| **Thông báo ▸ Cài đặt ngưỡng** | `alert_thresholds` — 10 ngưỡng cảnh báo | cùng khuôn `SettingsForm` với tab Hệ thống (13/08) |
| **Cài đặt WMS** 7 tab còn lại | Kho · Loại kho · Đơn vị tính · Khu vực · Ca nhập · QA · Máy | danh mục CRUD |
| **Cài đặt TMS** 4 tab | Loại xe · Khung giờ · ĐVVT/NCC · Xe | |
| **Cấu hình per-ĐỐI TƯỢNG** (form của chính đối tượng) | `Warehouse`: chế độ tồn, 2 rule cổng/cân, quét tem thùng, SAP plant/sloc, kho cha · `Material` · `WarehouseZone` (hạng nhặt, luồng cửa, loại kho) · `Location.is_pick_face` · `LookupValue.meta` (cờ theo loại kho) | đúng chỗ — không nên gom về trung tâm |
| **Phân quyền** | `JobTitle.module_permissions` + scope kho/loại hàng của nhân sự | trang Quản lý người dùng |
| **Cá nhân** | `/settings`: giao diện, đổi mật khẩu, thông báo đẩy · `notification_prefs` (chuông per trường hợp) | per user, không phải cấu hình hệ thống |
| **Tích hợp** | `/masterdata/integration-keys`: API key ERP + khóa AI Vision (`vision_api`, mã hóa, lọc khỏi GET hở đọc) | superadmin |
| **ENV (Vercel)** | 9 biến: SUPABASE_URL/SERVICE_ROLE_KEY/JWT_SECRET, FRONTEND_URL, PGRST_MAX_ROWS… | hạ tầng, đúng chỗ |

## PHẦN 2 — CHƯA TẬP TRUNG (muốn đổi phải sửa code + deploy)

| # | Cái gì | Ở đâu (đo 14/08) | Vì sao đáng gom |
|---|---|---|---|
| 1 | **Lịch nghỉ lễ + Tết** | `frontend/src/utils/vnHolidays.ts` — Tết cứng 5 ngày, 4 lễ dương; **BE không có bảng lễ**, tin `work_dates` client gửi | Chính phủ công bố lại HÀNG NĂM. Sai lễ = sai bảng công. Đề xuất `SystemSetting.vn_holidays` per năm, BE+FE cùng đọc |
| 2 | **Ca làm việc CA1/CA2/CA3/HC** | 7 file: `hooks.ts`, `Assignments`, `Attendance`, `LeaveManagement`, `hrSkillSections` (FE) + `assignmentController`, `attendanceController` (BE) | nhà máy thêm/đổi ca = sửa 7 chỗ. Đề xuất danh mục ca (mã · tên · giờ · rank) |
| 3 | **Hành vi quyết định bằng TÊN tiếng Việt** | `'Lái xe'` (UserManagement:220, TMSBookings:248) · `'Đơn vị vận tải'` (UserManagement:220-221, TMSBookings:3856) · `SPECIAL_VTYPES ['Chỉ trả pallet','Khác']` (GateRegistration:94,487,1057) | đổi TÊN chức danh/loại xe trong danh mục = luồng hỏng **âm thầm**, không lỗi. Đề xuất cờ meta: `JobTitle.is_driver`, `vehicle_type.meta.no_booking` |
| 4 | **Hardcode riêng LOF** (chặn mở đơn vị 2) | `pushService.ts:34,43` `mailto:wms@lof.vn` · `weighTicketController.ts:60` trạm cân `'KB01'` · `inventoryController.ts:1450` `NMSX_ALIAS {A:'O'}` · `app.ts:34` CORS `wms-webapp.vercel.app` · `loadPlan.ts` `ASSUMED_CARTON` 422×233×100mm | kiến trúc multi-tenant silo yêu cầu khác biệt đi qua CỜ, không qua tên đơn vị. Deploy đơn vị 2 mà quên = mang danh tính/tham số của LOF |
| 5 | **Giờ công chuẩn 8h/ngày** | `attendanceController.ts:261` (`work_days * 8`) + `Attendance.tsx` | khác ca/khác đơn vị là khác. Đề xuất `standard_work_hours` |
| 6 | **Ngưỡng màu KPI — mỗi trang một thang** | Dashboard 100/80 · FillPicking 80/50 · Forklift 90/60 · StocktakeDashboard 90/50 và 98/90 · **ControlTower dwell 90/45 phút — lệch ngưỡng cảnh báo đã cấu hình (90/180)** | cùng một chỉ số mà 2 màn tô màu khác nhau ⇒ người đọc mất tin. Hợp nhất 1 thang + dwell đọc `alert_thresholds` |
| 7 | **`ACTIVE_STATUSES` 2 định nghĩa LỆCH trong cùng file** | `inventoryController.ts:792` `[IN_STOCK, PARTIAL, EXPORTED]` vs `:1559` `[IN_STOCK, PARTIAL, QUARANTINE, LOOSE_PICKING]` | không phải cấu hình, nhưng là 2 "luật" cùng tên khác nghĩa — người sửa sau dễ dùng nhầm. Đặt tên riêng + comment, hoặc hợp nhất |
| 8 | **Danh mục nhỏ cứng trong code** | `LEAVE_TYPES` (LeaveManagement:28) · Mẻ 1..10 (PalletLabels:1010) · nhãn ĐVT (`qtyUnits.ts` — đã có LookupValue `unit_of_measure` mà formatter không đọc) | ít đổi, gom khi tiện |
| 9 | **`const TODAY` tính 1 lần lúc mở app** | 10 trang: Assignments, Attendance, LeaveManagement, FillPicking, Inbound, LoosePicking, Outbound, OutboundPrepare, OutboundScanLog, PalletLabels | PDA/màn kho mở qua đêm → `min={TODAY}` chặn sai ngày. Đổi thành hàm `TODAY()` (HR/Packing/Forklift đã đúng) |

## PHẦN 3 — CỐ Ý KHÔNG CONFIG HÓA (đừng gom)

Luật an toàn/bất biến: chặn xuất sớm `FUTURE_DATE` · 1 xe 1 ngày · 1 xe 1 cửa · Z1–Z4 reconcile · KH khớp thực quét mới Hoàn thành · giao ≥1 loại · base-unit số nguyên · biển số `[A-Z0-9]` (có CHECK ở DB) · cấu trúc QR V1/V2.
Biên kỹ thuật lượt quét cảnh báo: cửa sổ gate 48h · BE_ERRORS 24h · packing 7 ngày · `EXPIRY_WINDOW_DAYS` (tự suy 6×PCT_WARN) — đã ghi chú tại `alertScanner.ts`.
Trần chống nhầm (thùng >100k, sản lượng >10tr) và format mã tự sinh (đổi = phá parser ngược).

## ĐÃ LÀM — 14/08 (user duyệt "ok làm đi")

| # | Trạng thái | Cách xử |
|---|---|---|
| 4 hardcode LOF | ✅ XONG | gom vào `org_profile` (email liên hệ · mã trạm cân · ánh xạ mã nhà máy cũ→mới · cỡ thùng giả định) + CORS đọc ENV `CORS_ORIGINS`. **Mặc định = đúng giá trị đang chạy** nên đơn vị 1 không đổi hành vi |
| 1 lễ/Tết | ✅ XONG | `vn_holidays` khai theo năm ("YYYY-MM-DD Tên", mỗi dòng một ngày). Năm KHÔNG khai vẫn tự tính bằng lịch âm như cũ |
| 2 ca làm việc | ⚠️ LÀM MỘT NỬA | gom 7 chỗ khai ca → `frontend/src/config/shifts.ts`, giữ nguyên 100% nhãn/màu/thứ tự. **Chưa** thành danh mục động: thuật toán phân ca (tầng CA1+CA2→CA3→HC, luật "CA3 hôm qua") gắn chặt đúng 4 mã — cần việc riêng, đo lại với HR |
| 3 tên tiếng Việt | ✅ XONG | cờ `JobTitle.is_driver` + `Department.is_carrier` (migration `20260814_role_flags`, backfill theo tên đang dùng + DO-block gác) · ô tick trong form Chức danh/Phòng ban · ratchet `role_by_vietnamese_name` baseline 0 |
| 6 thang màu | ✅ phần MÂU THUẪN | dwell Giám sát vận hành đọc `GATE_WARN_MIN`/`GATE_CRIT_MIN` (90 vàng · 180 đỏ) thay 90/45 tự đặt. Các thang còn lại đo chỉ số KHÁC NHAU (sức chứa · tỷ lệ fill · tuân thủ · bao phủ · chính xác) → mỗi cái một ngưỡng là đúng, **không gộp** |
| 5 giờ công 8h · 7 `ACTIVE_STATUSES` · 8 danh mục nhỏ · 9 `const TODAY` | ⏳ còn | gom khi đụng vào từng file (giá trị thấp, churn cao nếu sweep ngay) |

**Ghi chú `SPECIAL_VTYPES`**: đo lại thì `'Chỉ trả pallet'` / `'Khác'` KHÔNG phải tên trong danh mục Loại xe (bảng `VehicleType` chỉ có XE 4 PALLET · XE CONTAINER · …) — đây là 2 lựa chọn ảo của riêng màn Đăng ký cổng, không ai đổi tên được ⇒ không thuộc lớp lỗi "so tên danh mục", giữ nguyên.

## Thứ tự đề xuất (bản gốc)
1. **#4 hardcode LOF** — bắt buộc trước khi dựng đơn vị 2.
2. **#1 lễ/Tết + #2 ca làm việc** — chu kỳ đổi hàng năm, đang phải nhờ lập trình viên.
3. **#3 tên tiếng Việt → cờ danh mục** — lớp lỗi âm thầm.
4. **#6 hợp nhất thang màu** (kèm dwell đọc ngưỡng đã cấu hình).
5. #5, #7, #8, #9 — gom khi đụng vào từng file.
