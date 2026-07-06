# 6. Troubleshooting — Xử lý sự cố

> Dành cho key-user / IT hỗ trợ cấp 1. Cấu trúc: **Triệu chứng → Nguyên nhân → Cách xử lý**. Các thắc mắc "vì sao hệ thống hoạt động như vậy" xem [05-faq.md](05-faq.md).

## T1. Đăng nhập & phiên

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| "Tên đăng nhập hoặc mật khẩu không đúng" | Sai thông tin (tên đăng nhập không phân biệt hoa thường, mật khẩu CÓ phân biệt) | Thử lại; vẫn lỗi → admin **Đặt mật khẩu** mới |
| "Tài khoản đã bị vô hiệu hóa" | Tài khoản bị ẩn/tắt hoạt động | Admin: Quản lý người dùng → tìm (lọc Tình trạng "Đang ẩn") → **Khôi phục**/bật hoạt động |
| "Tài khoản chưa được đặt mật khẩu" | Tạo tài khoản nhưng chưa cấp mật khẩu | Admin → **Đặt mật khẩu** |
| Đang làm việc bị đá về màn đăng nhập | Phiên quá 7 ngày hết hạn (đúng thiết kế — chỉ khi token thật sự hết hạn) | Đăng nhập lại. Nếu xảy ra liên tục ngay sau đăng nhập → báo IT kiểm tra giờ hệ thống của máy |
| Đăng nhập được nhưng trắng trang / xoay mãi | Mạng chậm hoặc backend đang khởi động nguội (serverless) | Chờ 5–10 giây, F5. Kéo dài → kiểm tra mạng nội bộ, thử 4G |

## T2. Quyền & hiển thị

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Không thấy menu/nút | Chức danh thiếu quyền action tương ứng | Admin cấp quyền đúng **action** (mỗi nút 1 quyền); chờ ≤5 phút hoặc F5 |
| Bấm nút bị báo lỗi 403 / "không có quyền" | Quyền vừa bị gỡ (giao diện chưa kịp ẩn nút) hoặc thao tác chạm module khác | F5 để nhận quyền mới; xác định action đúng qua bảng quyền ở [04-user-guide.md](04-user-guide.md) |
| Thiếu kho trong dropdown, thiếu dữ liệu | Phạm vi kho / loại hàng của tài khoản | Admin sửa hồ sơ nhân viên: Phạm vi kho + Loại hàng được phép |
| Admin cũng mất 1 quyền lạ | (Chỉ sau nâng cấp phần mềm) action mới chưa khai báo phía server | Báo đội phát triển — cần bổ sung action vào cấu hình quyền backend |

## T3. Quét QR / Camera

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Camera không mở / màn đen | Trình duyệt chưa cấp quyền camera, hoặc app khác đang chiếm camera | Cấp quyền camera cho trang trong cài đặt trình duyệt (biểu tượng ổ khóa cạnh URL); đóng app camera khác; F5 |
| Quét không nhận mã | Tem mờ/lóa, thiếu sáng, in sai kích thước | Lau tem, bật đèn, đưa gần 10–20cm; tem hỏng → **In lại từ tồn kho**. Nhập tay mã pallet nếu khẩn |
| "QR sai định dạng" | Mã quét không phải tem pallet hệ thống (đủ 6 đoạn `Ngày_Mã_CK_Máy_STT_NMSX`) | Kiểm tra đang quét đúng tem pallet (không phải QR thùng carton/QR khác) |
| "Pallet không thuộc mã hàng này" | Quét pallet của mã khác trong phiếu/mã đang mở | Kiểm tra đúng dòng mã hàng đang quét; pallet để nhầm chỗ → báo kiểm kho |
| "Pallet đã được quét" khi nhập | Tem đã nhập trước đó (trùng) | Tra **Truy cứu**/Tồn kho theo mã pallet để biết pallet đang ở phiếu/vị trí nào |
| Quét xuất báo hết tồn/không đủ | Pallet đã bị giữ QA, đang giữ chỗ nhặt lẻ, hoặc người khác vừa xuất | Xem panel **Tồn kho** trong màn quét (cột Khả dụng); chọn pallet khác |
| Máy quét chậm/lag khi quét liên tục | Thiết bị yếu + camera phân giải cao | Đóng bớt tab/app; dùng thiết bị khác; báo IT nếu diễn ra diện rộng |

## T4. Nhập kho

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Không tạo được phiếu NCC — báo đã có nhóm | Cùng NCC đã có nhóm phiếu trên lượt xe đó | Dùng **Sửa nhóm** (bút chì trên dòng) để thêm mã/sửa SL |
| Không thấy xe trong "Xe đang vào cổng" | Xe chưa được xác nhận **VÀO**, hoặc đã ra >3 ngày, hoặc khác kho/hướng | Bảo vệ xác nhận Vào trước; xe đã ra ≤3 ngày → tick "Trường hợp đặc biệt" |
| Nút "Thêm pallet" mờ | Phiếu chưa chọn **vị trí**, đã đủ KH, hoặc phiếu đã Hoàn thành | Chọn vị trí / Gỡ hoàn thành / kiểm tra số KH |
| Không sửa/xóa được pallet đã quét | Pallet của người khác hoặc quá 2 ngày (quyền thường); pallet đã xuất | Nhờ giám sát (quyền force); pallet đã xuất thì không sửa được ở phiếu nhập |
| "Lưu thủ công" bị khóa | Mã no-QR đã lưu 1 lần | Sai số → giám sát Gỡ hoàn thành phiếu rồi xóa bản ghi thủ công (quyền force) và lưu lại |
| Tam giác vàng cạnh vị trí phiếu | Pallet trong phiếu đang nằm khác vị trí hiện tại của phiếu | Bình thường nếu chủ động chia vị trí; sai thì đổi vị trí pallet ở Tồn kho |

## T5. Xuất kho / Nhặt lẻ

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Nút Hoàn thành mờ | Còn mã chưa quét đủ KH / no-QR chưa Lưu thủ công / nhặt lẻ chưa Check | Xem thanh tiến độ từng mã; thiếu thật → Sửa đơn hạ KH = thực xuất |
| Không quét được — "chưa bắt đầu"/"tạm dừng" | GDO chưa **Bắt đầu** hoặc đang **Tạm dừng** | Bắt đầu / Tiếp tục (đúng quyền) |
| Gỡ bắt đầu (unstart) bị chặn | Đã có pallet quét/nhặt lẻ đã check | Xóa hết bản ghi quét trước (tồn tự hoàn) rồi mới gỡ |
| Bỏ hoàn thành bị chặn | Chuyến chuyển kho: kho nhận đang/đã nhận | Kho nhận **Hủy nhận** trước (chỉ khi chưa có phiếu nhập hoạt động) |
| Upload KH xuất không ghi đè chuyến | Chuyến đang IN_PROGRESS/COMPLETED | Chỉ chuyến **Tạm dừng** mới nhận ghi đè → Tạm dừng chuyến rồi upload lại |
| Xóa nhầm pallet đã quét | — | Không sao: xóa = hoàn tồn; quét lại là xong |
| 2 người cùng bấm Hoàn thành | Hệ thống chỉ cho 1 người thắng | Người sau thấy trạng thái đã cập nhật — không cần làm gì |

## T6. TMS / Cổng / Chuyển kho

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Đặt giờ báo FULL | Slot vừa hết chỗ (đếm realtime) | Chọn khung khác; cần nới → Cài đặt TMS → Khung giờ → tăng Max xe |
| Không đổi ngày được đơn | Đơn đã BOOKED hoặc là lệnh TRANSFER | Trả lại/Thu hồi suất trước; lệnh TRANSFER không đổi từ TMS |
| Xóa đơn báo lỗi | Đơn có xe đã đặt giờ, hoặc là lệnh chuyển kho | Thu hồi hết booking trước; lệnh chuyển kho chỉ gỡ bằng "Bỏ hoàn thành" ở Xuất kho |
| "Bắt đầu nhận hàng" mờ | Thiếu 1 trong 3: Biển số / SĐT / Giờ dự kiến tới | Điền đủ ở **ĐVVT booking** |
| Hủy nhận bị chặn | Còn phiếu nhập hoạt động (đã quét) | Xóa pallet đã quét trong phiếu (hoặc hủy phiếu 0 pallet) rồi Hủy nhận |
| Cột Giờ vào/ra trống dù xe đã vào | Biển số ở booking khác biển số đăng ký cổng | Sửa biển số cho khớp (Đặt giờ / Đăng ký cổng) — hệ thống nối theo biển số |
| Gate: không gọi được chân Xuất (xe kết hợp) | Chân Nhập chưa "Đã ra" | Hoàn tất chân Nhập trước — chặn theo thiết kế |
| Sửa khung giờ không thấy áp dụng ngay | Ngày gần còn booking → template chỉ áp ngày tương lai chưa booking | Xem dòng "áp dụng được từ ngày…" trong dialog; muốn sớm hơn phải gỡ booking ngày đó |

## T7. Số liệu & realtime

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Màn hình không tự cập nhật khi người khác thao tác | Mất kết nối realtime (mạng chập chờn, máy sleep) | F5 — dữ liệu nạp lại đúng; kết nối realtime tự nối lại |
| Tổng ở dải xanh ≠ tổng tự cộng trong bảng | Dải tổng tính trên **dữ liệu đã lọc**; bảng đang phân trang | Nhớ tổng = toàn bộ kết quả lọc, không phải trang đang xem |
| Tồn kho âm / xuất quá tồn | Không thể xảy ra qua thao tác app (trừ tồn nguyên tử). Nếu thấy → do upload/điều chỉnh tay sai | Tra **Lịch sử điều chỉnh** của pallet; sửa bằng Điều chỉnh tồn kèm lý do |
| Bảng thiếu dòng so với kỳ vọng | Bộ lọc đang áp (kể cả lọc nhớ từ phiên trước) hoặc scope kho/loại hàng | Bấm "Xóa tất cả" trên dải lọc; kiểm tra Phạm vi tài khoản |
| Trang báo "thu hẹp bộ lọc" / chặn tải | Kết quả vượt ngưỡng an toàn (vd Lịch sử quét >200k dòng) | Thu hẹp khoảng ngày/kho/loại hàng |

## T8. Upload Excel (mọi loại)

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Upload xong không có gì thay đổi | File lỗi toàn phần (tồn kho: 1 dòng lỗi = hủy cả file) hoặc sai cột | Đọc danh sách lỗi trong dialog; luôn bắt đầu từ nút **Tải mẫu** |
| Ngày trong file bị lệch 1 ngày | Ô Excel định dạng ngày + múi giờ | Định dạng cột ngày dạng **Text** `yyyy-mm-dd` hoặc `dd/mm/yyyy` theo mẫu |
| Số bị hiểu sai (1.234 vs 1,234) | Quy ước số VN: **phẩy = thập phân** | Nhập số theo mẫu; tránh dấu chấm ngăn nghìn trong ô số |
| Mã NCC không khớp khi upload KH nhập | ERP dùng mã khác | Thêm **Mã phụ (alias)** cho NCC ở Cài đặt TMS → ĐVVT/NCC |
| Trang trắng "An error occurred with your deployment" khi upload file lớn | File quá lớn làm quá thời gian xử lý | Chia nhỏ file (< vài nghìn dòng/lần); nếu tái diễn báo đội phát triển |

## T9. In ấn & xuất file

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Tem in sai kích thước, quét kém | In "Fit to page" | In **100% / Actual size**, khổ A4 dọc |
| Trang in ra trắng | Chưa có tem nào trong preview (chưa đủ trường) | Điền đủ Mã hàng/Chu kỳ/Máy(NCC)/NMSX trước khi In |
| Export Excel không tải về | Trình duyệt chặn download nhiều file | Cho phép download trong thanh địa chỉ; thử lại |
| Ảnh bảng phân công không chia sẻ được | Trình duyệt không hỗ trợ Web Share | Dùng **Tải ảnh** rồi gửi thủ công |

## T10. Hiệu năng & thiết bị

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Trang danh sách tải chậm | Khoảng lọc quá rộng | Thu hẹp ngày; dùng bộ lọc đã lưu cho tổ hợp hay dùng |
| Lần đầu mở trang lâu, lần sau nhanh | Nạp trang theo nhu cầu (code-splitting) + backend khởi động nguội | Bình thường; rê chuột lên menu sẽ nạp trước trang đó |
| Máy tablet cũ đơ khi mở camera lâu | Thiết bị yếu | Đóng camera khi không quét (nút Dừng/thoát màn quét); chia ca thiết bị |

## T11. Khi cần báo lỗi cho đội phát triển

Cung cấp đủ 5 thông tin để xử lý nhanh:
1. **Tài khoản** + chức danh (để dựng lại quyền).
2. **Đường dẫn trang** (URL) + thao tác từng bước trước khi lỗi.
3. **Thông báo lỗi nguyên văn** (chụp màn hình cả banner đỏ).
4. **Thời điểm** (giờ:phút) — đối chiếu log server.
5. Dữ liệu liên quan: mã phiếu / mã chuyến / mã pallet / file Excel đã upload.
