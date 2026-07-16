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

---

# Agent đồng bộ (đã build — `agent-tram-can.ps1` + `CHAY-AGENT.bat`)

Agent = **2 file, KHÔNG phải cài đặt**: không installer, không service, không sửa gì của
Windows hay phần mềm cân — chỉ ĐỌC `TVTDB.mdb` (SELECT) rồi gọi HTTPS lên WMS. Xóa 2 file là hết.

## Triển khai KHUYẾN NGHỊ: chạy ngay trên máy trạm cân (máy có Internet)
1. Copy 2 file `agent-tram-can.ps1` + `CHAY-AGENT.bat` vào 1 thư mục trên máy cân (vd `C:\WMS-Agent\`).
2. Mở `agent-tram-can.ps1` bằng Notepad, sửa khối CONFIG đầu file:
   - `$MdbPath` = đường dẫn thật tới `TVTDB.mdb` (cùng thư mục phần mềm cân)
   - `$ApiKey`  = API key scope `weigh:write` — admin WMS tạo trong Quản lý API key,
     **quy ước tên: `Kho <Tên kho>_Agent trạm cân`** (vd `Kho Ba Vì_Agent trạm cân`) — mỗi kho/trạm 1 key riêng để thu hồi độc lập
   - `$WmsUrl`  = URL WMS (production: `https://wms-webapp.vercel.app`)
   - `$WarehouseId` = **id Kho** của trạm cân trong WMS (mỗi phiếu đẩy lên tự gắn kho này → trang Phiếu cân filter theo Kho).
     Phiếu cũ đẩy trước khi khai kho = chưa gắn kho; gán lại 1 lần bằng SQL:
     `UPDATE "WeighTicket" SET warehouse_id = '<id kho>' WHERE station_code = 'KB01' AND warehouse_id IS NULL;`
3. Nháy đúp `CHAY-AGENT.bat` → thấy dòng "Day N phieu..." là chạy. Máy chỉ có driver Access
   cũ 32-bit (Jet 4.0 — chính là driver phần mềm cân đang dùng) → bat TỰ chuyển PowerShell 32-bit.
4. **Chạy NGẦM + tự khởi động cùng máy (không phải mở cửa sổ mãi):**
   - **Không có quyền admin (mặc định)**: copy kèm file thứ 3 `CHAY-NGAM.vbs` (cùng thư mục 2 file kia).
     Nháy đúp `CHAY-NGAM.vbs` = agent chạy ẨN ngay (không cửa sổ). Tự chạy khi bật máy: chuột phải
     `CHAY-NGAM.vbs` → Create shortcut → Win+R gõ `shell:startup` → Enter → kéo shortcut vào.
     Dừng agent: Task Manager → tab Details → tìm `powershell.exe` → End task.
   - **Có quyền admin** (chạy cả khi chưa đăng nhập): PowerShell Run as Administrator, dán:
     `schtasks /Create /TN "WMS Agent Tram Can" /TR "C:\WMS-Agent\CHAY-AGENT.bat" /SC ONSTART /RU SYSTEM /RL HIGHEST /F`
     (chạy ngay: `schtasks /Run /TN "WMS Agent Tram Can"`; gỡ: `schtasks /Delete /TN "WMS Agent Tram Can" /F`).
   - Nháy đúp `CHAY-AGENT.bat` (có cửa sổ) chỉ dành cho lúc cài lần đầu / cần nhìn log trực tiếp để debug.
5. Theo dõi: file `agent-tram-can.log` cùng thư mục (chạy ngầm vẫn ghi log này). Mất mạng → agent tự thử lại
   mỗi vòng, không mất phiếu (mỗi vòng lấy 100 phiếu mới nhất, server tự khử trùng).

## Phương án dự phòng (nếu tuyệt đối không được đụng máy cân)
Nhờ IT share thư mục phần mềm cân qua LAN (chỉ-đọc) → chạy agent trên 1 máy khác luôn bật,
`$MdbPath = '\\ten-may-can\ten-share\TVTDB.mdb'`. Nhược: thêm 1 điểm hỏng + đọc Access qua
mạng kém bền hơn đọc tại chỗ.
