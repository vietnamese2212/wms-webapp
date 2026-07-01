# Hướng dẫn UPLOAD dữ liệu VẬN HÀNH HÀNG NGÀY

> Đây là dữ liệu user làm việc mỗi ngày (khác template masterdata 0–6 chỉ cài đặt 1 lần).
> Sinh template: `cd backend && node ../scripts/gen_daily_templates.js` → `templates/daily_*.xlsx`.
> **Dòng 1 = TÊN CỘT (app khớp theo tên — ĐỪNG đổi/xoá).** Dòng 2+ = dữ liệu; xoá dòng ví dụ rồi điền thật.
> App đọc **sheet đầu tiên**. Ngày dạng `dd/mm/yyyy`. **Không upload ngày quá khứ.**

---

## 1. `daily_1_XuatKho.xlsx` — Xuất kho (phiếu GDO)
**Up ở:** trang **Xuất kho** → nút **Upload Excel**. Gom theo `Số xe` (1 xe = 1 chuyến/GDO), trong xe gom theo `Delivery`, mỗi dòng = 1 mã hàng.

| Cột | Bắt buộc | Ghi chú |
|---|---|---|
| **Số xe** | ✅ | Mã chuyến, format `Mãkho_X_ddmmyy_stt` — vd `20000016_X_100726_01`. Các dòng cùng xe lặp lại y hệt. |
| **Ngày xuất** | ✅ | `dd/mm/yyyy`, không quá khứ |
| **Kho xuất** | ✅ | Mã hoặc tên kho (vd `20000016` / `Kho Ba Vì`) |
| **Loại kho** | ✅ | Thuộc danh mục: `Thành phẩm / POSM / Raw / Thùng / Giấy` |
| **DVVT** | — | Mã/alias/tên ĐVVT (vd `3S`) |
| **Delivery** | — | Mã đơn giao (gom item trong 1 xe) |
| **Tên NPP** | — | Tên nhà phân phối của Delivery |
| **Material** | ✅ | Mã hàng đã có trong hệ thống (mỗi dòng 1 mã, không để trống) |
| Material_type · Thùng · Hộp · Tải · Nhặt lẻ · Pallet | — | Số lượng kế hoạch |
| Loại xuất · HEADER TEXT · Batch_Yêu cầu · %Date_Yêu cầu · CS phụ trách | — | Thông tin bổ sung |

> Upload lại cùng `Số xe`: PENDING → ghi đè; PAUSED → gộp (item đã quét phải còn trong file); Đang xuất/Hoàn thành → bỏ qua.

---

## 2. `daily_2_KeHoachVC_Xuat.xlsx` — Kế hoạch vận chuyển (đơn XUẤT)
**Up ở:** trang **Kế hoạch (TMS)** → **Upload kế hoạch từ Excel** (có sẵn nút *Tải mẫu*). Mỗi dòng = 1 đơn vận chuyển.

| Cột | Bắt buộc | Ghi chú |
|---|---|---|
| **Mã đơn** | ✅ | format `Mãkho_X_ddmmyy_stt` — vd `20000016_X_100726_1`. Không trùng trong file/DB. |
| **Kho** | ✅ | Tên kho (vd `Kho Ba Vì`) |
| **Ngày** | ✅ | `dd/mm/yyyy`, không quá khứ |
| **Hướng** | ✅ | `Xuất` (chỉ nhận đơn Xuất ở đây; hàng Nhập dùng template 3) |
| NPP · Loại kho · Loại xe · ĐVVT | — | Loại kho/Loại xe/ĐVVT phải thuộc danh mục nếu điền |
| Thùng · Pallet · Tấn | — | Tổng kế hoạch |
| GDO | — | Mã GDO liên kết (vd `DO-0001`) |
| Ghi chú | — | |
| **Ưu tiên** | — | Điền `x` nếu ưu tiên |

---

## 3. `daily_3_KeHoachNhap.xlsx` — Kế hoạch nhập (hàng NCC ngoài / chuyển kho)
**Up ở:** trang **Kế hoạch (TMS)** → tab **Kế hoạch nhập** → **Upload kế hoạch nhập** (có sẵn nút *Tải template*). Mỗi dòng = 1 dòng kế hoạch nhập.

| Cột | Bắt buộc | Ghi chú |
|---|---|---|
| **Mã NCC** | ✅ | Mã/alias NCC (vd `10008728`) |
| **Mã hàng** | ✅ | Mã hàng đã có |
| **ĐVT** | — | Nếu điền phải **khớp đơn vị của mã hàng** (vd `CAR`) |
| Mã kho | — | Mã kho (trống → dùng kho đang chọn trên trang) |
| Loại kho · Loại xe | — | Phải thuộc danh mục nếu điền |
| Số PO | — | |
| Số thùng · Số pallet | — | Số lượng kế hoạch |

---

### Danh mục tham chiếu (điền đúng, không app sẽ báo lỗi)
- **Loại kho** (warehouse_type): `Thành phẩm · POSM · Raw · Thùng · Giấy`
- **Loại xe**: xem Cài đặt TMS → Loại xe (vd `XE 4 PALLET`, `XE CONTAINER`, `XE PALLET (16-17 PALLET)`…)
- **ĐVVT / NCC**: xem danh mục ĐVVT / NCC (khớp mã, alias, hoặc tên)

> Các upload này **kiểm toàn bộ file trước** — có dòng lỗi thì **không nhập gì**, sửa rồi up lại.
