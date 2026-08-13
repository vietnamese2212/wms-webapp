# Kiểm kê luật nghiệp vụ HARDCODE — 13/08/2026

> Quét toàn bộ backend/src + frontend/src (3 mũi song song). Mục tiêu: user muốn HẠN CHẾ hardcode.
> Đã loại trừ hằng hạ tầng (chunk 300/500, cap 1000, debounce, retry, timeout HTTP).
> Bug thật phát hiện tiện thể ĐÃ VÁ: `alertController.RULES` thiếu `PACKING_UNRECEIVED` → dồn về 1 nguồn `ALERT_RULES` (commit `ed4e8469`).

## NHÓM A — RỦI RO THẬT, SỬA CODE (không phải chuyện config)

### A1. Superadmin nhận diện theo TÊN `'Admin'` / mã `'ADMIN'` (nợ đã biết — nay đo đủ chỗ)
- BE: `authController.ts:47,134,177` · `middlewares/auth.ts:21` · `employeeController.ts` (nhiều hàm "chỉ Admin") · `attendanceController.ts:12` · `leaveController.ts:163,346` · `skillController.ts` · `categoryScope.ts:9` · `pushService.ts:143` · `orderController.ts:540` (back-date) · `palletPrintController.ts:38` · `palletOpsController.ts:358` · `fillController.ts:69` · `visionController.ts` (4 chỗ)
- FE: `config/permissions.ts:409` (`isAdmin`) dùng ở ≥6 trang.
- Rủi ro: đổi tên hiển thị tài khoản → mất quyền âm thầm. Cách sửa triệt để: cột `Employee.is_superadmin` + nhét vào JWT, mọi chỗ so `is_superadmin === true`; migration set cho tài khoản Admin hiện tại. (Một số chỗ đã đọc `req.user.is_superadmin ||` — chuẩn hóa nốt.)
- `seed-admin.ts:25-28`: mật khẩu mặc định `Admin@123` nằm trong repo.

### A2. %Date — BA thang màu mâu thuẫn + 1 chỗ tự tính lại sai nguồn
- FE 12 chỗ hardcode 2 thang: `70/40` (Inventory.tsx:47, OutboundScanLog.tsx:98) vs `60/30` (OutboundPrepare, LoosePicking*, OutboundDetail, OutboundItemDetail — 9 chỗ). Alert dùng `20/10` (config được).
- BE band filter `inventoryController.ts:200-206`: `80/60/30`.
- **`OutboundScanLog.tsx:80-95` `calcPctAtScan` TỰ TÍNH %Date** — không dùng `computePctDate`, bỏ nhánh `expiry_date` tem V2 + bỏ override NCC ⇒ **ra số KHÁC trang Tồn kho** (đây là bug tính đúng, không chỉ style).
- Sửa: 1 helper `pctDateCls()` đọc ngưỡng từ SystemSetting (xem B1), thay 12 chỗ; xóa `calcPctAtScan` → dùng `computePctDate` chung.

### A3. Ngưỡng lệch cân FE cứng 5% ≠ ngưỡng đã cấu hình được
- `OutboundDetail.tsx:1879` + `WeighTickets.tsx:193` tô đỏ theo `5%` chết, trong khi `WEIGH_WARN_PCT/CRIT` đã tùy biến qua `alert_thresholds`. Admin đổi ngưỡng → 2 màn này không theo. Sửa: FE đọc `useSystemSettings('alert_thresholds')`.

### A4. Hai định nghĩa `ACTIVE_STATUSES` lệch nhau trong CÙNG file
- `inventoryController.ts:792` (điều chỉnh): `['IN_STOCK','PARTIAL','EXPORTED']` vs `:1559` (upload): `['IN_STOCK','PARTIAL','QUARANTINE','LOOSE_PICKING']`. Cần soi từng chỗ có chủ đích không, đặt tên khác nhau + comment, hoặc hợp nhất.

### A5. So CHUỖI TIẾNG VIỆT quyết định hành vi (đổi tên danh mục = chết âm thầm)
- `UserManagement.tsx:220`: `'Đơn vị vận tải'` + `'Lái xe'` → quyết định gán xe.
- `TMSBookings.tsx:248`: `job_title_name === 'Lái xe'` → đổi luồng UI tài xế.
- `GateRegistration.tsx:94` `SPECIAL_VTYPES = ['Chỉ trả pallet','Khác']` → không gắn booking. BE `gateRegistrationController.ts:68` loại kho `'Khác'` bỏ qua kiểm scope.
- `SlottingPlanDetail.tsx:83-88`: phân loại ưu tiên P0..P4 bằng REGEX trên chuỗi lý do tiếng Việt do BE sinh (`/tạm/i`, `/sai loại khu/i`…) — BE đổi câu chữ là thống kê sai. Sửa: BE trả `reason_code` enum, FE map theo code.
- Hướng: thêm cờ meta vào danh mục (như đã làm `LookupValue.meta` cho warehouse_type): `JobTitle.is_driver`, `vehicle_type.meta.no_booking`…

### A6. `const TODAY` tính 1 LẦN lúc import module (đóng băng qua nửa đêm)
- 8 trang: Inbound, Outbound, OutboundPrepare, OutboundScanLog, LoosePicking, FillPicking, PalletLabels, GateRegistration. PWA mở qua đêm (PDA kho để màn hình cả ca đêm!) → `min={TODAY}` chặn sai ngày. Sửa: đổi thành hàm `TODAY()` như các trang HR/Packing/Forklift đã đúng.

### A7. Hardcode ĐƠN-VỊ-CỤ-THỂ — vi phạm kiến trúc multi-tenant silo
- `pushService.ts:34,43`: VAPID subject `'mailto:wms@lof.vn'` → env/SystemSetting.
- `weighTicketController.ts:60`: trạm cân mặc định `'KB01'` (Cân Kinh Bắc) → SystemSetting.
- `inventoryController.ts:1450`: `NMSX_ALIAS = { A: 'O' }` — mã nhà máy cũ của riêng LOF → SystemSetting/danh mục.
- `app.ts:33-35`: CORS hardcode `wms-webapp.vercel.app` → env.
- `loadPlan.ts:66`: `ASSUMED_CARTON {422×233×100mm}` — cỡ thùng của 1 khách.
- Deploy đơn vị 2 mà quên các chỗ này = nhận nhầm dữ liệu/danh tính đơn vị 1.

### A8. Bảng lễ VN + Tết nằm ở FE, BE tin `work_dates` client gửi
- `vnHolidays.ts:109-131`: Tết cứng 5 ngày (Chính phủ công bố hàng năm, thay đổi liên tục); 4 lễ dương. BE chấm công không có danh sách lễ riêng → lệch client là lệch công. Sửa: chuyển thành SystemSetting `vn_holidays` per năm (admin dán lịch nghỉ), BE + FE cùng đọc.

## NHÓM B — ĐÁNG ĐƯA VÀO CẤU HÌNH (SystemSetting / per-kho / danh mục)

### B1. Vào `SystemSetting` — tab Hệ thống (Cài đặt WMS) [ưu tiên cao]
| Key đề xuất | Hiện tại | Vị trí code |
|---|---|---|
| `pct_date_bands` (thang màu %Date toàn app) | 70/40 vs 60/30 vs 80/60/30 loạn | A2 — 12 chỗ FE + inventoryController:200 |
| `photo_retention_days` | 60 ngày (2 chỗ) | packingController:23, forkliftController:47 |
| `feed_retention_days` | 3 ngày | notifyController:62 |
| `error_log_retention_days` | 30 ngày | utils/response.ts:21 |
| `cycle_count_days` {A,B,C} + `abc_window_days` | 7/30/90 + 30 | cycleCountController:24-25 (code tự ghi "sửa ở đây") |
| `inbound_edit_window_days` (cửa sổ người tạo được sửa/xóa pallet) | 2 ngày | inboundController:1727 + FE InboundDetail:313 |
| `packing_max_materials_per_run` | 10 mã | packingController:549 + Packing.tsx:993 |
| `vn_holidays` (lịch nghỉ lễ per năm) | Tết cứng 5 ngày | vnHolidays.ts (A8) |

### B2. Nhét thêm vào `alert_thresholds` (đã có UI tab "Cài đặt ngưỡng")
- `TRIP_LATE_DAYS` (14 ngày) · cửa sổ gate 48h · cửa sổ BE_ERRORS 24h · `p_window_days` packing 7 ngày · `EXPIRY_WINDOW_DAYS` 120. Chỉ cần thêm key vào `ALERT_TH_CONFIG_KEYS` + validator + UI — hạ tầng có sẵn.

### B3. Danh mục hóa (LookupValue / bảng riêng) [khi có nhu cầu thật]
- **Ca làm việc** `CA1/CA2/CA3/HC`: cứng ở 6 file FE + `attendanceController:14` + thuật toán phân ca (tầng ưu tiên CA1+CA2→CA3→HC, luật CA3-hôm-qua). Nhà máy thêm ca = sửa 8 chỗ. Danh mục ca + rank + giờ chuẩn.
- **Giờ công chuẩn 8h/ngày**: `attendanceController:261` + `Attendance.tsx` 4 chỗ → key `standard_work_hours`.
- **Mẻ 1..10** (PalletLabels:1014), **loại nghỉ phép** (LeaveManagement:28), **nhãn ĐVT** (`qtyUnits.ts:18` — đã có LookupValue unit_of_measure mà formatter BE không đọc).
- Map loại kho legacy `TP→Thành phẩm, NVL→…` (categoryScope:14, useUserScope:16, warehouseTypeMeta:19) — fallback có chủ đích, dọn được khi chắc meta đã seed đủ 2 DB.

### B4. Ngưỡng màu dashboard FE (mỗi trang một thang: 90/60, 80/50, 90/50, 70/40…)
- ControlTower dwell 90/45 phút (lệch alert 90/180!), Dashboard sức chứa 100/80, Forklift 90/60, Fill 80/50, StocktakeDashboard 90/50, TMSBookings lấp đầy 1.0/0.7. Không cần config từng cái — cần HỢP NHẤT 1 thang chuẩn (tốt/khá/kém) + riêng dwell đọc từ alert_thresholds.

## NHÓM C — GIỮ HARDCODE CÓ CHỦ ĐÍCH (đừng config hóa)
- Luật an toàn/bất biến: FUTURE_DATE chặn xuất sớm · 1 xe 1 ngày · 1 xe 1 cửa (booking_category) · Z1–Z4 reconcile · KH khớp thực quét mới Hoàn thành · luật giao ≥1 loại · base-unit số nguyên · biển số `[A-Z0-9]` (có CHECK DB) · cấu trúc QR V1/V2 (khác biệt đơn vị đã có cờ `label_format`) · điều kiện hoàn tác SPLIT nguyên vẹn 100%. Config hóa luật an toàn = tự tạo đường lách, ai đó tắt là mất bất biến.
- Trần chống nhầm (thùng >100k, sản lượng >10tr, kẹp ngày 7..365): ngưỡng vệ sinh, không ai cần chỉnh.
- Format mã tự sinh (`KHO_X_ddmmyy_NN`, `F+yymmdd-NN`, `Z+NN`): đổi format là phá parse ngược (khvcController suy kho từ đoạn đầu Số xe) — nếu có đơn vị cần format khác thì mới nâng thành cờ, kèm sửa cả parser.
- Thuật toán phân ca HR: rất đặc thù, config hóa khi có yêu cầu thật từ HR, không làm trước.

## Trạng thái
- [x] A-bug filter rule PACKING_UNRECEIVED — vá `ed4e8469`
- [x] **ĐỢT 1 XONG 13/08 đêm (user duyệt "bắt đầu theo đề xuất"):**
  - A1 — superadmin theo CỘT `is_superadmin` (migration `20260813f`, ~18 chỗ BE + FE isAdmin, ratchet `superadmin_by_name` baseline 0)
  - A2 — %Date MỘT nguồn: helper `pctDateCls` + hook `usePctBands` (SystemSetting `pct_date_bands`, mặc định 60/30 — Tồn kho/Nhật ký quét/Kiểm kho đổi từ thang 70/40 sang 60/30 thống nhất); Nhật ký quét bỏ `calcPctAtScan` tự chế → `computePctDate` chung với nowMs = lúc quét (RPC `20260813g` trả expiry_date/entry_shelf/ncc/overrides)
  - A3 — 2 màn lệch cân (Phiếu cân + detail chuyến) đọc `WEIGH_WARN_PCT` từ alert_thresholds qua `useWeighWarnPct`
- [ ] Đợt 2: B1+B2 (config hóa retention/cycle-count/ngưỡng alert sót — hạ tầng SystemSetting có sẵn)
- [ ] Đợt 3: A5 (cờ danh mục thay so chuỗi tiếng Việt) + A7 (gỡ hardcode LOF — bắt buộc trước deploy đơn vị 2) + A6 (TODAY đóng băng) + A8 (lễ VN)
