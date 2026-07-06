# 1. Tổng quan hệ thống — MAL SC (WMS · TMS · HR)

> Tài liệu bàn giao · Phiên bản 1.0 · 06/07/2026

## 1.1. Hệ thống là gì

**MAL SC — Supply Chain Management** là webapp quản lý chuỗi cung ứng nội bộ, phục vụ vận hành giữa **Kho tổng** và các **Kho NPP (nhà phân phối)**, gồm 3 phân hệ:

| Phân hệ | Phạm vi |
|---|---|
| **WMS** (Warehouse) | Nhập kho, Xuất kho, Nhặt lẻ, Tồn kho, Kiểm kho, In tem pallet QR, Dồn/Tách pallet, Vị trí kho, Mã hàng |
| **TMS** (Transport) | Kế hoạch vận chuyển, Đặt lịch khung giờ xe, Chuyển kho giữa các kho, Đăng ký cổng, Báo cáo nhập |
| **HR** (Nhân sự) | Phân công lịch làm việc, Chấm công, Nghỉ phép, Sơ đồ tổ chức |

Nguyên lý cốt lõi: **mỗi pallet có 1 tem QR duy nhất** — hàng đi từ in tem → nhập kho (quét QR) → tồn kho theo vị trí → xuất kho (quét QR) → (nếu là chuyển kho) tự sinh lệnh vận chuyển và kho nhận lại quét QR để nhập. Toàn bộ số liệu **realtime** — nhiều người cùng thao tác, màn hình tự cập nhật không cần bấm làm mới.

## 1.2. Kiến trúc kỹ thuật

```
Người dùng (PC / Tablet / Điện thoại — trình duyệt)
        │  HTTPS
        ▼
Vercel (hosting, auto-deploy từ GitHub nhánh main)
 ├── Frontend: React 18 + TypeScript + Vite · TailwindCSS + shadcn/ui
 │     TanStack Query (cache dữ liệu) · html5-qrcode (quét QR bằng camera)
 └── Backend: Node.js + Express (serverless function /api)
       JWT auth (hạn 7 ngày) · phân quyền requirePerm từng route
        │
        ▼
Supabase (PostgreSQL + Realtime)
 — bảng nghiệp vụ thiết kế cho hàng triệu dòng/năm, mọi truy vấn phân trang
```

- **Định dạng API:** `{ "success": true, "data": ... }` hoặc `{ "success": false, "error": { "code", "message" } }`.
- **Múi giờ:** toàn bộ ngày nghiệp vụ (ngày nhập, ngày xuất, ngày công…) theo **giờ Việt Nam (UTC+7)**; hiển thị không phụ thuộc múi giờ máy người dùng.
- **Realtime:** thay đổi dữ liệu (quét pallet, đặt lịch, xe vào cổng…) phát sự kiện qua Supabase Realtime → mọi màn hình liên quan tự làm mới.
- **Đồng thời:** các bộ đếm dùng chung (sức chứa khung giờ, tồn kho, số thứ tự) đều cập nhật **nguyên tử** (row-lock/CAS) — hàng trăm người cùng đặt lịch/quét xuất không gây trùng slot hay tồn âm.

## 1.3. Bản đồ module — trang — menu

Menu trái gom theo nhóm; mỗi mục chỉ hiện khi tài khoản có quyền `view` module tương ứng.

| Nhóm menu | Trang (route) | Module quyền | Mô tả ngắn |
|---|---|---|---|
| Tổng quan | Dashboard `/` | — (mọi người) | KPI tồn kho + hoạt động hôm nay + tồn theo kho |
| Kho (WMS) | Nhập kho `/wms/inbound` | `inbound` | Phiếu nhập SX / NCC / chuyển kho, quét QR pallet vào vị trí |
| | Xuất kho `/wms/outbound` | `outbound` | Chuyến xuất (GDO), quét QR pallet ra khỏi kho |
| | Nhặt lẻ `/wms/loosepicking` | `loosepicking` | Soạn phần hàng lẻ (không nguyên pallet) của các chuyến xuất |
| | Dồn / Tách pallet `/wms/pallet-ops` | `pallet_ops` | Gom nhiều pallet thành nhóm / tách 1 pallet thành nhiều |
| | In tem pallet `/wms/pallet-labels` | `pallet_print` | Sinh tem QR mới, in lại, lịch sử in, truy cứu |
| | Check vị trí `/wms/stocktake` | `stocktake` | Kiểm kho: quét từng pallet tại vị trí, ghi chênh lệch |
| | Quét loạt (test) `/wms/multi-scan` | chỉ Admin | Trang thử nghiệm quét nhiều QR cùng lúc (không ghi dữ liệu) |
| Điều vận (TMS) | Kế hoạch VC `/tms/bookings` | `tms_plan` | Lệnh vận chuyển, đặt khung giờ, chuyển kho, KH nhập |
| | Đăng ký cổng `/tms/gate` | `gate_registration` | Xe vào/ra cổng: đăng ký → gọi → vào → ra |
| Nhân sự (HR) | Phân công `/hr/assignments` | `work_assignment` | Phiếu phân công theo layout vị trí, tự xếp người, phát hành |
| | Chấm công `/hr/attendance` | `attendance` (+`leave`) | Tự chấm công, bảng công ma trận, nghỉ phép |
| Báo cáo | Tồn kho `/wms/inventory` | `inventory` | Tồn theo pallet/tổng hợp, điều chỉnh, QA, đổi vị trí, export |
| | Lịch sử quét `/wms/outbound/scan-log` | `scanlog` | Nhật ký mọi lần quét xuất (32 cột, export Excel) |
| | Tổng hợp KK `/wms/stocktake/summary` | `stocktake` | Kết quả kiểm kho theo vị trí, xử lý chênh lệch |
| | Báo cáo nhập `/tms/reports` | `tms_plan` | Kế hoạch nhập vs thực nhập theo PO/NCC/mã hàng |
| Cấu hình | Mã hàng `/masterdata/materials` | `materials` | Danh mục mã hàng + quy cách + HSD (kèm Nhà sản xuất) |
| | Vị trí kho `/wms/locations` | `locations` | Danh mục vị trí (khu vực/hàng/tầng, sức chứa pallet) |
| | Sơ đồ tổ chức `/hr/org` | `employees` | Cây chức danh (dùng cho duyệt nghỉ phép, scope nhân sự) |
| | Cài đặt WMS `/wms/settings` | `wms_settings` | Kho, Loại kho, Khu vực, Ca nhập, Trạng thái QA |
| | Cài đặt TMS `/tms/settings` | `tms_vehicle_types` `tms_slots` `tms_companies` `tms_vehicles` | Loại xe, Khung giờ, ĐVVT/NCC, Xe |
| Quản trị | Quản lý người dùng `/masterdata/users` | `user_admin` (+`work_skill`) | Nhân viên, phòng ban, chức danh + trình phân quyền |

## 1.4. Mô hình phân quyền (RBAC)

**Nguyên tắc: quyền gắn với CHỨC DANH, không gắn với từng người.**

- Mỗi nhân viên thuộc 1 **Chức danh** (Job Title); chức danh giữ bảng quyền `module → [action]`. Ví dụ chức danh "Thủ kho" có `inbound: view, create, scan, complete…`.
- Mỗi nút bấm/thao tác = **1 quyền riêng** (không có quyền "quản lý chung"). Nút không có quyền sẽ **ẩn hẳn** trên giao diện, và API phía server cũng từ chối (403) — chặn 2 lớp.
- **Superadmin** = tài khoản tên `Admin` (mã `ADMIN`): có mọi quyền, được bảo vệ (chỉ Admin sửa được tài khoản Admin). Người thường **không thể cấp cho chức danh khác quyền mà chính mình không có** (chống leo thang).
- **Hiệu lực đổi quyền:** quyền nằm trong phiên đăng nhập (JWT 7 ngày) nhưng app tự làm mới mỗi **5 phút** — admin cấp/gỡ quyền có hiệu lực chậm nhất 5 phút, không cần đăng nhập lại.

**Phạm vi dữ liệu (scope) — lớp cắt thứ hai, độc lập với quyền:**

- **Phạm vi kho:** mỗi tài khoản là `Toàn quốc` hoặc `Kho được chỉ định` (danh sách kho). Mọi danh sách/bộ lọc/form chỉ hiện kho trong phạm vi.
- **Loại hàng được phép** (Thành phẩm / POSM / Raw / Giấy / Thùng): dữ liệu và thao tác bị cắt theo loại hàng được gán. Quy tắc chốt: *"đã phân quyền Kho + Loại hàng nào thì chỉ thấy dữ liệu của Kho + Loại đó"*.
- **Phạm vi nhân sự:** người quản lý chỉ thấy nhân viên thuộc (kho được gán) ∩ (chức danh **cấp dưới** trên sơ đồ tổ chức + chính mình). Việc duyệt nghỉ phép cũng theo cây cấp trên–cấp dưới này.

## 1.5. Vai trò vận hành đề xuất (dùng trong SOP)

Hệ thống không ép tên vai trò — mỗi đơn vị tự tạo chức danh và tích quyền. Bộ tài liệu này dùng 8 vai trò mẫu:

| # | Vai trò | Module chính | Tóm tắt nhiệm vụ |
|---|---|---|---|
| R1 | **Quản trị viên (Admin/IT)** | user_admin, mọi cài đặt | Tạo tài khoản, phân quyền, danh mục nền |
| R2 | **Trưởng kho / Giám sát** | inbound, outbound, inventory, stocktake, báo cáo | Duyệt-hoàn thành phiếu, xử lý chênh lệch, điều phối |
| R3 | **NV kho — Nhập hàng** | inbound (scan), gate (call), pallet_print | Tạo phiếu, quét QR pallet nhập, xếp vị trí |
| R4 | **NV kho — Xuất hàng / Nhặt lẻ** | outbound (scan), loosepicking, prepare | Soạn hàng, quét QR pallet xuất, nhặt lẻ |
| R5 | **Điều vận TMS** | tms_plan, tms settings | Upload kế hoạch, tạo lệnh, đặt/điều chỉnh khung giờ |
| R6 | **Bảo vệ cổng** | gate_registration (entry/exit) | Xác nhận xe vào/ra, ghi tải trọng |
| R7 | **Nhân sự / Chấm công** | work_assignment, attendance, leave | Layout, phân công, duyệt nghỉ, bảng công |
| R8 | **Kho nhận (NPP)** | tms_plan.confirm_receipt, inventory | Nhận hàng chuyển kho: quét nhập, hoàn thành |

Chi tiết quy trình từng vai trò: xem [03-sop-van-hanh.md](03-sop-van-hanh.md).

## 1.6. Quy ước giao diện chung (đọc 1 lần, áp dụng mọi trang)

Mọi trang danh sách theo cùng một chuẩn (phong cách Manhattan Active WMS):

- **Thanh công cụ**: ô tìm kiếm (gõ không dấu vẫn khớp, nhiều từ khóa = VÀ) · nút **Lọc** (điện thoại) · **Bộ lọc đã lưu** (SavedViews — lưu tổ hợp lọc hay dùng, riêng từng người) · nút mật độ dòng (dày/thoáng) · các nút hành động.
- **Dải lọc (FilterBar)**: chip lọc trên desktop, gom thành sheet trên điện thoại. Lọc ngày luôn là **khoảng Từ–Đến**. **Bộ lọc được nhớ riêng theo từng tài khoản** — đăng nhập máy khác vẫn giữ.
- **Dải tổng (SummaryBand)**: nền xanh đậm ngay trên bảng, số liệu tính trên dữ liệu đã lọc.
- **Bảng**: kéo giãn cột (kéo mép phải tiêu đề), tiêu đề và cột đầu ghim khi cuộn; cuộn ngang trên màn hình hẹp (không ẩn cột).
- **Màu dòng = màu CHỮ theo trạng thái** (không tô nền): xanh dương + gạch ngang = hoàn thành · hồng = quét xong · cam = đang làm · xanh lá = đã giao đơn · đỏ = tạm dừng/lỗi · xám = chờ. Cột Trạng thái có badge chữ riêng.
- **Chọn dòng**: trên PC **1 click = xem nhanh** (panel bên phải), **double-click = mở trang chi tiết**; trên điện thoại 1 chạm = mở chi tiết.
- **Form Thêm/Sửa** trượt từ **mép phải** màn hình: đầu cố định, thân cuộn, nút Lưu/Hủy luôn dính đáy.
- **Quét QR**: bíp khi đọc được mã; thành công tự quét tiếp sau 1,5 giây; lỗi hiện banner đỏ + nút "Quét tiếp". Camera giữ mở suốt phiên (không hỏi lại quyền).
- Nút nào gọi ghi dữ liệu đều tự khóa + đổi chữ khi đang lưu; lỗi hiện **banner đỏ ngay trong trang**.

## 1.7. Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| **Pallet / Tem pallet** | Đơn vị tồn kho nhỏ nhất; mỗi pallet 1 tem QR duy nhất. Chuỗi QR: `NgàySX_Mãhàng_Chukỳ_Máy(hoặc mã NCC)_STT_NMSX` |
| **Thùng (carton)** | Đơn vị đếm số lượng trên pallet; quy cách Thùng/pallet khai ở Mã hàng (có ngoại lệ theo kho) |
| **GDO** | Group Delivery Order — 1 **chuyến xe xuất** (có thể chở nhiều DO/NPP) |
| **DO / Delivery** | Đơn giao hàng trong chuyến; **NPP** = nhà phân phối nhận hàng |
| **Ship-to** | Mã điểm nhận trên đơn xuất; nếu trùng mã của 1 kho có quản tồn → chuyến là **chuyển kho** |
| **Lệnh chuyển kho (TRANSFER)** | Lệnh TMS tự sinh khi chuyến xuất chuyển kho hoàn thành; kho nhận quét nhập theo lệnh này |
| **KH nhập / inbound plan** | Kế hoạch nhập (theo PO/NCC/mã hàng) — đối chiếu với thực nhập ở Báo cáo nhập |
| **NCC** | Nhà cung cấp. **ĐVVT** = đơn vị vận tải. Một NCC có thể tự chở hàng (đóng cả 2 vai) |
| **NMSX** | Nơi/nhà máy sản xuất — đoạn thứ 6 của QR, đồng thời là tiền tố mã vị trí kho tổng |
| **Khung giờ / Slot** | Suất giờ xe vào kho theo (kho × loại kho × loại xe × thứ); có sức chứa tối đa, đặt nguyên tử chống trùng |
| **Gate / Đăng ký cổng** | Lượt xe qua cổng: Đã đăng ký → Đã gọi → Đang trong → Đã ra |
| **%Date** | % hạn dùng còn lại của pallet (theo ngày SX + HSD, có ngoại lệ HSD theo NCC) |
| **FEFO** | First-Expired-First-Out — hệ thống gợi ý/ cảnh báo lấy pallet %Date thấp trước (cảnh báo, không chặn) |
| **QA Status** | Cờ chất lượng pallet; pallet bị giữ QA (≠ OK) không được tính khả dụng để xuất |
| **Nhặt lẻ (loose picking)** | Phần hàng lẻ (< nguyên pallet) trong đơn xuất — quét/soạn riêng, trừ tồn khi "Check nhặt lẻ" |
| **Dồn / Tách pallet** | Dồn: gom nhiều pallet về 1 pallet đại diện (giữ tem gốc). Tách: chia bớt thùng ra pallet con (tem mới, STT dạng `001.1`) |
| **Chế độ quản tồn kho (QR/QTY/NONE)** | QR = quét từng pallet · QTY = quản theo số lượng (nhập tay) · NONE = không quản tồn |
| **Kiểm kho / Check vị trí** | Quét từng pallet tại vị trí để xác nhận đúng chỗ + đúng số; lệch → gắn cờ chênh lệch |
| **Ca nhập** | Ca sản xuất/nhập hàng (danh mục ở Cài đặt WMS) |
| **Superadmin** | Tài khoản `Admin` — toàn quyền, được hệ thống bảo vệ riêng |

## 1.8. Đăng nhập & tài khoản

- Đăng nhập tại `/login` bằng **tên đăng nhập (email/username) + mật khẩu** do quản trị viên cấp. Phiên giữ 7 ngày.
- Tự đổi mật khẩu: menu góc phải trên → **Cài đặt tài khoản** → Đổi mật khẩu (≥ 6 ký tự). Quên mật khẩu → nhờ admin **Đặt mật khẩu** trong Quản lý người dùng.
- Tài khoản bị vô hiệu hóa/ẩn sẽ không đăng nhập được (dữ liệu lịch sử vẫn giữ nguyên).

## 1.9. Giới hạn đã biết (đúng hiện trạng bàn giao)

- Chuông thông báo trên thanh tiêu đề và các công tắc "Thông báo" trong Cài đặt tài khoản là **giao diện chờ** — chưa nối hệ thống thông báo.
- Nút "Lưu thay đổi" hồ sơ trong Cài đặt tài khoản chỉ đổi hiển thị cục bộ; đổi hồ sơ thật do admin thực hiện.
- Trang **Quét loạt (test)** là trang thử nghiệm của Admin, không ghi dữ liệu — sẽ gỡ/thay khi tính năng quét loạt tích hợp chính thức vào Xuất kho.
- Nhà sản xuất chưa có màn hình quản lý riêng (xem read-only trong chi tiết Mã hàng).
