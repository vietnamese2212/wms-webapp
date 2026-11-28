# Đăng ký cổng (`gate_registration`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Đăng ký cổng

**Quyền (BE `ALL_PERMISSIONS`):** view · create · edit · delete · call · entry · exit

## Giao thoa với
<!-- giao-thoa:start -->
- [`dashboard`](dashboard.md) — Dashboard (Tổng quan) (được nhắc tới từ đó)
- [`outbound`](outbound.md) — Xuất kho (được nhắc tới từ đó)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Đăng ký cổng

## Actions

view, create, edit, delete, call, entry, exit 

## 20/10 — xe chở lẫn loại kho nối được lệnh VC

Lệnh VC của xe chở lẫn mang chuỗi GHÉP `FG01+PM01`; ô Loại kho của đăng ký chỉ chọn MỘT loại. Gợi ý booking và phép nối cổng ↔ lệnh
(`relinkAfterDelete`) đọc CÙNG hàm `singleTypeMatches` (utils/categoryScope — test `tests/unit/categoryScope.test.ts`); cửa tạo / sửa đăng
ký gác phạm vi loại bằng `categoryAllowed` (giao ≥1 loại). Trước 20/10 phép nối so nguyên chuỗi ⇒ mọi xe chở lẫn không gắn lệnh (Đặt lịch
không thấy "Đang xuất / Đã xuất"). Nhân viên bảo vệ KHÔNG có quyền `call` (Gọi xe) — đúng quy trình (user xác nhận 20/10: NV SAP gọi xe).

## 20/10 tối — Ra cổng (user chốt "sửa lại cả 2")

- **Chưa Vào thì không Ra:** cửa `PATCH …/:id/exit` gác đúng luật của nút Ra (chỉ hiện khi `status = IN`) — lượt xe chưa vào ⇒ 409
  `GATE_NOT_ENTERED` ("bấm Vào trước, sửa giờ vào nếu xe đã vào từ trước"); đã ra ⇒ 409 `ALREADY_EXITED` (muốn sửa giờ ra / tải trọng thì
  Huỷ ra). Ghi CAS theo `status = IN` — hai bảo vệ cùng bấm, người sau 409, không đè giờ ra.
- **Chuyến Xuất kho chưa hoàn thành thì HỎI LẠI:** chuyến của lượt xe = gắn thẳng lúc Bắt đầu (`GroupDeliveryOrder.gate_registration_id`)
  HOẶC qua lệnh VC đã nối (`TmsOrder.order_code` = Số xe). Còn chuyến chưa xong (chưa bắt đầu · đang xuất · tạm dừng · điều vận đã rút) ⇒
  409 `TRIP_NOT_COMPLETED` nêu Số xe + trạng thái; FE hỏi "Cho xe ra khi chuyến chưa xuất xong?", đồng ý ⇒ gửi lại `confirm: true` ⇒ ra +
  vết `GATE_EXIT_TRIP_OPEN` (ai · lúc nào) vào sổ chuyến (hiện ở "Lịch sử thao tác" của popup tình trạng xe). Lượt xe chiều NHẬP không hỏi.
  Gói 11 [7a]–[7d].

## 28/11 — ô Biển số tìm trên server (đo hạn mức)

Trước đây mở trang là tải cả đội xe (~950 xe ≈ 330 KB, kể cả khi không mở form) chỉ để dựng ô chọn Biển số. Nay ô Biển số chỉ tải
khi form đã hiện bước 2 (đủ 6 tiêu chí hoặc đang sửa): 50 xe khớp chữ đang gõ qua `GET /tms/vehicles?page=…&ncc_ids=…&search=…`
(RPC `tms_vehicles_page`, trả sẵn loại xe); đã chọn ĐVVT thì chỉ xe của ĐVVT đó, gom mọi chi nhánh CÙNG TÊN như cũ. Biển gõ có
gạch / dấu cách vẫn khớp (chuẩn hoá bằng `normalizeLicensePlate` trước khi tìm). `ComboField` có `onSearchChange` = chế độ tìm
trên server (không lọc lại tại máy). Danh mục ĐVVT dùng `useTransportCompanies()` chung (có realtime; khoá riêng `tms-companies`
cũ không có trong `TABLE_QUERY_MAP`). Lưới: ratchet `catalogue_full_load` nay soi cả `useTmsVehicles` không lọc ĐVVT và
`apiClient.get('<danh mục>')` gọi thẳng không tham số (đỏ đúng dòng trên bản cũ).
