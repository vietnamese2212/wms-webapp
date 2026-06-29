# Hướng dẫn upload dữ liệu thật

> Chạy **sau khi** đã apply `backend/migrations/20260628_cleanup_test_data.sql` (dọn dữ liệu test).
> Tất cả script đọc `backend/.env` (SUPABASE_URL + SERVICE_ROLE_KEY) và **bỏ qua bản ghi đã tồn tại** (chạy lại an toàn).

## 0. Sinh template trắng
```bash
cd backend && node ../scripts/gen_upload_templates.js
```
→ tạo thư mục `templates/`. Mở từng file, **XOÁ dòng ví dụ**, điền dữ liệu thật.
Mỗi file: dòng 1 = nhãn tiếng Việt, **dòng 2 = KEY (đừng sửa/đừng xoá)**, dòng 3+ = dữ liệu.

## Thứ tự upload (BẮT BUỘC theo phụ thuộc)

| # | Việc | Lệnh | Phụ thuộc |
|---|------|------|-----------|
| 1 | **Kho** | `node ../scripts/import_warehouses.js ../templates/1_Kho.xlsx` | — |
| 2 | **Loại xe** | làm tay ở **Cài đặt TMS → Loại xe** | — |
| 3 | **NCC / ĐVVT** | `node ../scripts/import_companies.js ../templates/2_NCC_DVVT.xlsx` | — |
| 4 | **Xe** | `node ../scripts/import_vehicles.js ../templates/4_Xe.xlsx` | Loại xe (2) + ĐVVT (3) |
| 5 | **Vị trí kho** | `node ../scripts/import_locations.js ../templates/5_ViTriKho.xlsx` | Kho (1) |
| 6 | **Tồn kho đầu kỳ** | `node ../scripts/import_inventory.js ../templates/6_TonKho.xlsx` | Kho + Vị trí + NCC + Mã hàng |

> Mã hàng & nhân viên đã giữ sẵn — bổ sung (nếu cần) bằng `import_materials.js` / `import_employees.js`.
> Tất cả lệnh chạy **từ thư mục `backend/`**.

## Lưu ý từng bảng
- **Kho:** `warehouse_type` = CENTRAL hoặc NPP · `inventory_mode` = QR / QTY / NONE (mặc định QR).
- **NCC/ĐVVT:** cột `type` phải đúng `NCC` hoặc `ĐVVT`.
- **Xe:** `Loại xe` và `ĐVVT` điền **đúng tên** đã tạo ở bước 2–3.
- **Vị trí kho:** `location_code` tự ghép = `Tiền tố_Khu_Dãy_Tầng`. Tiền tố = `nmsx_code` của kho **nếu có**, không thì **Mã kho** (vd Ba Vì nmsx=`B` → `B_TP1_1_T1`; NPP không có nmsx → `10000329_TP1_1_T1`).
- **Tồn kho:** mỗi dòng = 1 pallet. `Mã hàng` = `material_code` đã có. `Mã vị trí` = location_code ở bước 5. Để trống NCC/QA nếu không có (QA mặc định OK).

## Sau khi upload
Kiểm nhanh số lượng trên app (SummaryBand các trang) hoặc query đếm; chạy lại script nếu thiếu (đã chèn sẽ tự bỏ qua).
