# Cảnh báo vận hành (`alerts`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Thông báo + nút chuông

**Quyền (BE `ALL_PERMISSIONS`):** view · ack

## Giao thoa với
<!-- giao-thoa:start -->
- [`dashboard`](dashboard.md) — Dashboard (Tổng quan) (file này nhắc tới)
- [`fill`](fill.md) — Fill hàng (nhặt lẻ) (hai chiều)
- [`packing`](packing.md) — Sổ đóng gói (file này nhắc tới)
- [`wms_settings`](wms_settings.md) — Cài đặt WMS (file này nhắc tới)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

**Thông báo** (menu Tổng quan — route `/wms/alerts` MỞ CHO MỌI USER, 2 tab khớp nút chuông: **Cá nhân** = feed việc đích danh của mình, ai cũng vào; **Thông báo chung** = cảnh báo vận hành, tự ẩn khi thiếu `alerts.view`; API GET /wms/alerts vẫn gate view) + **NÚT CHUÔNG Header = trung tâm thông báo (06/08)**: 3 tab Cá nhân (feed `user_notifications` — việc đích danh như giao lệnh fill, luôn ghi, dọn lười giữ 3 ngày theo LÔ 2.000) · Chung (alert_events, nêu RÕ TÊN KHO, cần alerts.view) · Cài đặt (chuông per trường-hợp `notification_prefs`, sổ khóa PREF_KEYS ở pushService — tắt CHỈ tắt chuông); badge = chưa đọc + cảnh báo mở; trang Cảnh báo có multi-select "Đã biết hàng loạt". Trigger thông báo đích danh MỚI → gọi `notifyEmployees` (feed+push+prefs), ĐỪNG gọi sendPushToEmployees trần — trung tâm cảnh báo quét SỐNG 8 rule (tồn cận %Date · xe trong cổng ≥90p/180p · chuyến trễ ngày/bắt đầu >6h chưa xong · lệch cân >5%/15% · lỗi BE 24h · pallet SX ghi Sổ đóng gói >12h/24h kho chưa nhận — deep-link mở Sổ pallet lọc sẵn · **2 rule BẢO MẬT 03/09, ngưỡng CỐ Ý không cho cấu hình:** `AUTH_LOCKOUT` ≥3 tài khoản KHÁC NHAU bị khoá đăng nhập trong 1h (10 = CRITICAL, nguồn `auth_login_events` reason LOCKED) · `ADMIN_NEW_IP` superadmin đăng nhập OK từ IP chưa thấy trong 30 ngày, per (email, ip), chỉ báo khi email ĐÃ có lịch sử >24h để ngày đầu bật không báo oan; gói QA 45 gác mở→tự đóng), tự đóng khi điều kiện hết, **cảnh báo MỚI bắn Web Push tới người có `alerts.view` theo scope kho** (hạ tầng push = bảng `push_subscriptions` + card "Thông báo đẩy" trang Cài đặt, route `/api/notify` — trigger khác: giao lệnh fill, task Cần xử lý SAP). Quét lười throttle 10p khi có traffic (`services/alertScanner.ts` — %Date qua `computePctDate`, RPC `alerts_expiry_candidates` chỉ prefilter SIÊU TẬP; ngưỡng TÙY BIẾN qua SystemSetting `alert_thresholds` — tab **"Cài đặt ngưỡng"** trang Thông báo, quyền `wms_settings.manage_system`, mặc định = `THRESHOLDS`, cache 30s, validator chặn crit lỏng hơn warn; từ 19/08 thêm cờ boolean `GATE_KEEP_AFTER_EXIT` (xe đã ra khỏi cổng: false = cảnh báo GATE_DWELL tự ẩn — hành vi gốc · true = GIỮ LẠI chờ "Đã biết" để truy cứu; chế độ giữ CHỈ miễn đóng đúng ca xe-đã-ra, dòng rớt khỏi ứng viên vì nới ngưỡng/quá cửa sổ 48h vẫn tự đóng — QA 20 mục [8a-8c] gác)); QA gói 19 (mục 11 ngưỡng)+20

## Actions

view=xem + **nhận push cảnh báo mới theo kho được gán**, **ack**=đánh dấu "đã biết"/bỏ đánh dấu (ẩn khỏi list mặc định — cảnh báo tự đóng, không có nút resolve tay)

## 11/10 — "Tồn cận date" đọc HSD TÍNH SẴN trên pallet (migration 20261011e)

Vòng quét `alerts_expiry_candidates` (alertScanner mỗi 10') trước đọc MỌI pallet sống (19.589, 3.534 block) rồi mới lọc NSX + shelf-life của
mã / NCC ⇒ trung bình 1,6 s, cache nguội quá hạn 29 lần 04–07/10 (`ALERT_RULE_FAILED_OVERLOAD`). Nay cột `InventoryEntry.expiry_calc`
(= `effectiveExpiryMs` của `utils/shelfLife.ts`, so 19.586 pallet: 0 lệch) do trigger giữ — pallet đổi NSX / HSD / shelf-life / mã / NCC
(BEFORE ROW, chỉ gán NEW) và Material đổi shelf-life hoặc ngoại lệ NCC (trigger THEO CÂU tính lại pallet của mã đó) — + chỉ mục một phần
trên pallet còn hàng. Vòng quét lọc `expiry_calc <= hôm nay + 120` (2.053/19.586 pallet) rồi `computePctDate` vẫn tính %Date như cũ.
Cột CHỈ nuôi cửa lọc; %Date hiển thị ở mọi màn vẫn đi `computePctDate`. Bất biến gói 00 mục 14e `inventory_expiry_mismatch()` = 0.
Thêm nguồn shelf-life mới (vd theo kho) ⇒ sửa `inventory_expiry_calc` (SQL) CÙNG `resolveShelfLife` (TS + FE mirror), và chạy lại
`eq_expiry.mjs` (so TS ↔ SQL trên mọi pallet; chú ý so ngày bằng CÙNG đồng hồ với lúc parse — máy VN lệch 7 giờ). 
