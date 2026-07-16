# Khảo sát máy trạm cân (bước 0 của tích hợp WMS ↔ phần mềm cân Kinh Bắc)

Mục tiêu: tìm xem phần mềm cân lưu phiếu cân ở đâu (SQL Server hay file Access)
để viết agent đồng bộ đẩy phiếu cân lên WMS.

## Cách chạy (người vận hành không cần biết kỹ thuật)
1. Copy **cả thư mục này** (2 file `CHAY-KHAO-SAT.bat` + `khao-sat-tram-can.ps1`) vào USB → cắm sang **máy tính trạm cân**.
2. **MỞ phần mềm cân lên trước** (đang chạy như lúc cân xe bình thường).
3. Nháy đúp `CHAY-KHAO-SAT.bat` → chờ vài phút (nó quét ổ đĩa) → xong hiện chữ xanh.
4. Lấy file **`khao-sat-tram-can.txt`** trên Desktop gửi lại cho đội WMS (Zalo/email).

Script CHỈ ĐỌC — không sửa, không xóa, không gửi gì lên mạng (chỉ ping thử 1 lần).

## Đọc kết quả (đội WMS)
- Mục 2: tên/tiến trình/thư mục phần mềm cân.
- Mục 3: có SQL Server → agent nối `mssql`. Mục 5: file `.mdb/.accdb` sửa gần nhất → agent đọc Access qua ODBC.
- Mục 6: file cấu hình cạnh exe — thường lộ connection string / đường dẫn DB chính xác.
- Lưu ý: file kết quả có thể chứa mật khẩu DB trong connection string — không gửi ra ngoài công ty.

Bước tiếp theo (sau khi có kết quả): viết agent `scripts/weigh-station/agent/` đọc DB cân → POST `/api/integration/v1/weigh/tickets` (thiết kế đã chốt 16/07 — xem memory `weigh-station-integration`).
