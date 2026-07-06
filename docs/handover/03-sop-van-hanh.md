# 3. SOP vận hành theo vai trò

> Quy trình chuẩn (Standard Operating Procedure) cho 8 vai trò mẫu. Tên nút/màn hình in **đậm**; điều kiện bắt buộc in *nghiêng*. Chi tiết từng màn hình: xem [04-user-guide.md](04-user-guide.md).

---

## R1 — Quản trị viên (Admin / IT)

### SOP R1.1 — Thiết lập hệ thống lần đầu (thứ tự bắt buộc)
1. **Cài đặt WMS → tab Kho**: tạo các kho (mã, tên, Chức năng Kho tổng/NPP, **Chế độ quản tồn** QR/QTY/NONE, mã **NMSX** cho kho tổng, **Ship-to phụ** nếu ERP dùng nhiều mã cho 1 kho).
2. **Cài đặt WMS → Loại kho**: tạo taxonomy loại hàng (Thành phẩm, POSM, Raw, Giấy, Thùng…). Kéo-thả thứ tự (thứ tự này áp cho cây Đăng ký cổng).
3. **Cài đặt WMS → Khu vực**: mỗi kho tạo khu vực (mã Z01… hoặc tự đặt) theo loại kho.
4. **Vị trí kho**: tạo vị trí theo Khu vực + Hàng + Tầng, khai **sức chứa pallet tối đa**; tick "Cần kiểm kê hàng ngày" cho vị trí trọng yếu.
5. **Cài đặt WMS → Ca nhập, QA**: khai ca sản xuất và trạng thái QA.
6. **Cài đặt TMS**: Loại xe → ĐVVT/NCC (kèm **Mã phụ** alias ERP) → Xe (biển số gắn ĐVVT) → **Khung giờ** (từng kho: cụm Loại xe × Loại kho × Thứ × Giờ × Max xe).
7. **Mã hàng**: upload Excel danh mục (nút **Tải mẫu** trước) — kiểm tra các mã bị báo **Thiếu DL** (đỏ): thiếu HSD, Pallet/EA, quy cách.
8. Tồn đầu kỳ: **Tồn kho → Upload** (file có lỗi bất kỳ = không ghi gì; sửa hết lỗi rồi up lại).

### SOP R1.2 — Tạo chức danh & phân quyền
1. **Quản lý người dùng → tab Chức danh → Thêm chức danh**.
2. Nhập Tên + Phòng ban → phần **Phân quyền**: mỗi Trang là 1 thẻ, tích từng action (nút **Tất cả** để cấp cả trang). *Nhớ: mỗi nút trên app = 1 action riêng.*
3. Lưu. Quyền có hiệu lực với người đang đăng nhập sau ≤ 5 phút.
4. Nguyên tắc cấp quyền gợi ý: cấp `view` trước, action ghi (create/edit/delete/scan/complete) chỉ cấp cho đúng người làm; các action "force_*", "uncomplete", "revoke", "delete" chỉ cấp cho giám sát.

### SOP R1.3 — Tạo tài khoản nhân viên
1. **Quản lý người dùng → tab Nhân viên → Thêm nhân viên**.
2. Chọn **Phòng ban → Chức danh** trước (form mở phần còn lại).
3. Nhập Họ tên, Mã NV, Tên đăng nhập, SĐT; chọn **Loại hàng được phép** + **Phạm vi kho** (Toàn quốc / chọn từng kho). *Lái xe thuộc ĐVVT: chọn Công ty vận tải + Biển số xe (biển số = mã đăng nhập).*
4. Lưu → màn hình hiện **tên đăng nhập + mật khẩu tạm** → copy gửi nhân viên.
5. Nghỉ việc: **Xóa** (hệ thống tự ẩn nếu có lịch sử — không mất dữ liệu); quay lại → **Khôi phục**.

### SOP R1.4 — Việc định kỳ
- Đặt lại mật khẩu khi nhân viên quên (**Đặt mật khẩu**).
- Rà **Sơ đồ tổ chức** (`/hr/org`) khi thay đổi cơ cấu — cây này quyết định *ai duyệt nghỉ phép của ai* và *ai thấy nhân sự nào*.
- Rà mã hàng Thiếu DL / Trùng tên (filter **Dữ liệu** ở trang Mã hàng).

---

## R2 — Trưởng kho / Giám sát

### SOP R2.1 — Đầu ngày
1. **Dashboard**: xem tồn theo kho, số phiếu nhập/chuyến xuất hôm nay.
2. **Xuất kho**: lọc ngày hôm nay → xem chuyến chưa giao đơn → **Giao đơn** cho từng chuyến (nút ngay trên dòng hoặc trong chi tiết).
3. **Kế hoạch VC → Xem booking**: kiểm tra độ lấp đầy khung giờ trong ngày.
4. **Nhập kho**: kiểm tra khối "Vị trí hàng nhập" để biết hàng đang dồn vào vị trí nào.

### SOP R2.2 — Hoàn thành / mở lại phiếu
- **Hoàn thành phiếu nhập**: mở phiếu → **Hoàn thành** → đối chiếu bảng KH vs thực (Đúng/Thiếu/Thừa) → xác nhận. Sai sót sau đó → **Gỡ hoàn thành** để sửa rồi hoàn thành lại.
- **Hoàn thành chuyến xuất**: chỉ bấm được khi *mọi mã đã quét đủ kế hoạch*. Xe về thiếu → **Sửa** đơn, hạ số kế hoạch = thực xuất, rồi Hoàn thành.
- **Bỏ hoàn thành chuyến chuyển kho**: bị chặn nếu kho nhận đã bắt đầu nhận — yêu cầu kho nhận **Hủy nhận** trước.

### SOP R2.3 — Xử lý chênh lệch kiểm kho
1. **Tổng hợp KK**: chọn Kho + Vị trí → bấm thẻ **Chênh lệch**.
2. Đối chiếu từng pallet (tồn app vs thực tế, người kiểm, giờ kiểm).
3. Sai thật → **Tồn kho**: chọn pallet → **Điều chỉnh tồn** (nhập ± + lý do — có lịch sử điều chỉnh).
4. Quay lại Tổng hợp KK → **Bỏ cờ** để đóng chênh lệch.

### SOP R2.4 — Điều chỉnh tồn kho (các thao tác hàng loạt)
Ở **Tồn kho**, tick các pallet → thanh thao tác nổi:
- **QA Status**: giữ/thả chất lượng (pallet bị giữ không xuất được).
- **NCC**: gán NCC + HSD ngoại lệ theo lô.
- **Vị trí**: dời pallet hàng loạt.
- **Mã hàng** (recode): đổi mã (chỉ mã cùng loại kho, có bước xác nhận).
- **Ngày SX**: sửa ngày sản xuất (ảnh hưởng %Date).
- **Tách/Dồn**: điều hướng sang trang Dồn/Tách.

---

## R3 — Nhân viên kho: NHẬP HÀNG

### SOP R3.1 — Nhập hàng NCC (xe qua cổng)
*Điều kiện: xe đã được Bảo vệ xác nhận **VÀO** cổng (hướng Nhập).*
1. **Nhập kho → Tạo phiếu → tab Nhập NCC**.
2. Chọn Kho, Loại kho → **Xe đang vào cổng** (danh sách xe đang trong cổng; xe đã ra trong 3 ngày → tick "Trường hợp đặc biệt") → chọn **NCC**.
3. Danh sách hàng: bấm **Nạp từ kế hoạch** (nếu có KH nhập) hoặc nhập tay/paste từ Excel từng mã + SL dự kiến.
4. **Tạo N phiếu nhập** → hệ thống tạo mỗi mã 1 phiếu, nhóm theo chuyến xe.
5. Mở phiếu (các phiếu cùng chuyến có tab chuyển nhanh) → **Chọn vị trí** (ưu tiên vị trí có ★).
6. **Thêm pallet** → quét QR từng pallet: máy bíp + hiện số thùng → **Lưu N thùng** → quét tiếp. Lỗi (sai mã hàng, pallet đã nhập, sai định dạng) → đọc banner đỏ → **Quét tiếp**.
7. Đủ số → báo Trưởng kho **Hoàn thành** (hoặc tự hoàn thành nếu được cấp quyền).
- *Xe ghép nhiều NCC:* lặp bước 1–4 cho từng NCC trên cùng lượt xe. *Bổ sung mã cho NCC đã tạo nhóm:* dùng nút **Sửa nhóm** (bút chì trên dòng) — không tạo nhóm mới.

### SOP R3.2 — Nhập hàng sản xuất
1. **Tạo phiếu → tab Nhập SX**: Kho, Loại kho, Mã hàng, **Vị trí**, Ca, Ngày.
2. Vào chi tiết → quét QR từng pallet (số thùng tự điền theo quy cách) → Hoàn thành.
3. *Mã không QR / kho quản theo số lượng:* không cần vị trí — vào chi tiết → **Lưu thủ công** → nhập tổng số thùng (chỉ 1 lần).

### SOP R3.3 — Đổi vị trí phiếu đang nhập
- Đang nhập mà đổi chỗ để hàng: mở phiếu → bấm pill **Đổi vị trí** cạnh vị trí hiện tại → chọn vị trí mới (pallet quét sau đó vào vị trí mới; nút **Lịch sử** xem các lần đổi).
- Sửa/xóa 1 pallet đã quét: chỉ sửa/xóa được pallet **mình quét trong 2 ngày** (quyền thường) — quá hạn/của người khác → nhờ giám sát (quyền force).

### SOP R3.4 — In tem pallet
1. **In tem pallet → Sinh tem mới**: chọn Loại hàng, Ngày SX, Mã hàng, Chu kỳ, Máy (thành phẩm) hoặc NCC (hàng NCC), NMSX, Seq bắt đầu, Số pallet.
2. Nếu cảnh báo vàng "trùng tồn kho" → đổi **Seq bắt đầu**.
3. **In (N)** → hộp thoại in của trình duyệt: chọn đúng khổ A4, in **100% (Actual size)**.
4. Tem rách/mất → tab **In lại từ tồn kho**: quét mã pallet hoặc lọc chọn → **In lại**. Tem in nhiều lần sẽ có cảnh báo — kiểm tra lý do ở tab **Truy cứu**.

---

## R4 — Nhân viên kho: XUẤT HÀNG / NHẶT LẺ

### SOP R4.1 — Chuẩn bị hàng (trước khi xe tới)
1. **Xuất kho → Chuẩn bị hàng**: chọn ngày + kho → **Thêm xe** (các chuyến chưa quét xong).
2. Board hiện từng mã hàng: **Vị trí gợi ý (FEFO)** — soạn pallet ở vị trí gợi ý trước; cột **Khả dụng** đỏ = thiếu tồn (badge vàng "Chờ về" = có kế hoạch nhập bù; đỏ "Thiếu" = báo điều phối).
3. Board tự giảm số khi đồng nghiệp quét — không cần refresh.

### SOP R4.2 — Xuất 1 chuyến
*Điều kiện: chuyến đã **Giao đơn** và xe đã đăng ký cổng hướng Xuất.*
1. Mở chuyến → **Bắt đầu**: chọn **Chuyến xe/Biển số** từ cổng (1 chuyến cổng = 1 phiếu xuất; trường hợp đặc biệt tick riêng), nhập Người xuất / Lái xe nâng / Bốc xếp (+ số container nếu xe cont).
2. Ở bảng hàng, bấm **Quét** trên từng mã → camera: quét QR pallet → máy đề xuất số thùng (**FEFO**: nếu cảnh báo "còn pallet cũ hơn" — ưu tiên lấy pallet cũ) → **Lưu N thùng**.
3. Mã yêu cầu **Batch/%Date** (chữ đỏ trên màn quét): chỉ quét pallet đạt điều kiện.
4. Hàng không QR: nút **Lưu thủ công** → nhập số thùng xuất (không vượt kế hoạch/tồn).
5. Quét nhầm → mở danh sách pallet đã quét → **xóa** dòng đó (tồn tự hoàn lại).
6. Đủ hết các mã → giao ca cho người có quyền **Hoàn thành**.
7. Cần nghỉ giữa chừng → **Tạm dừng** (khóa quét) → **Tiếp tục**.

### SOP R4.3 — Nhặt lẻ
1. **Nhặt lẻ**: danh sách chuyến còn phần lẻ (badge "N chưa xong").
2. Mở chuyến → từng mã → **Quét**: quét pallet nguồn lấy lẻ / mã no-QR nhập tay số thùng lẻ.
3. Soạn xong → **Check nhặt lẻ (N thùng)** — bước này mới trừ tồn. *Ai có quyền complete mới check được.*

---

## R5 — Điều vận TMS

### SOP R5.1 — Nạp kế hoạch hằng ngày
1. **Kế hoạch VC → Upload xuất** (Excel KH xuất — tải mẫu trong dialog) và/hoặc **Upload KH nhập** (KH nhập theo NCC/PO).
2. Đơn lẻ → **Thêm đơn** (đơn Nhập khai thêm bảng danh sách hàng; hỗ trợ paste Excel).
3. Kiểm tra lỗi ở preview (chỉ dòng lỗi hiển thị) — sửa file rồi up lại.

### SOP R5.2 — Đặt khung giờ & điều phối xe
1. Trên lưới Kế hoạch, bấm **Đặt giờ** (icon xe) trên đơn → chọn khung giờ còn chỗ → nhập Biển số + SĐT lái xe.
2. Xe chở ghép nhiều đơn → mục "**Xe này chở thêm đơn?**" tick các đơn cùng ĐVVT/ngày/hướng.
3. 1 đơn cần thêm xe (tách chuyến) → **Thêm xe** (chỉ khi xe chính đã đặt giờ).
4. Hủy suất: **Trả lại** (trước giờ) / **Thu hồi** (đã quá giờ — quyền riêng).
5. Đổi ngày nhiều đơn: tick chọn → **Đổi ngày** (*chỉ đơn chưa đặt giờ; đơn đã đặt phải Thu hồi trước*).
6. Theo dõi cột Tình trạng XH / Giờ vào / Giờ ra (đồng bộ từ Đăng ký cổng).

### SOP R5.3 — Bảo trì cài đặt TMS
- **Khung giờ**: sửa theo **cụm** (Loại xe × Loại kho): dialog tick Thứ + bảng khung giờ + Max xe (0 = khóa khung). Thay đổi áp cho **ngày tương lai chưa có booking**; ngày đã có booking giữ nguyên (hệ thống hiện "áp dụng từ ngày…").
- **ĐVVT/NCC**: thêm **Mã phụ** (alias) khi ERP dùng mã khác — upload KH nhập nhận cả mã phụ.
- **Xe**: biển số gắn đúng ĐVVT (dropdown Đặt giờ lọc theo ĐVVT).

---

## R6 — Bảo vệ cổng

### SOP R6.1 — Trực cổng
1. **Đăng ký cổng** — bảng cây Kho → Loại kho → Loại xe, lọc mặc định hôm nay. Dải tổng: Đang chờ / Đang trong / Đã ra.
2. Xe tới cổng: tìm dòng (đã được đăng ký sẵn) → **Vào** → chọn giờ → xác nhận. *Xe chưa đăng ký:* bấm **Thêm** điền 2 bước (tiêu chí + biển số/lái xe) rồi xác nhận Vào.
3. Xe rời: **Ra** → nhập **tải trọng (tấn)** nếu yêu cầu → xác nhận.
4. Bấm nhầm → nút hoàn tác (↺) cạnh mỗi trạng thái.
5. **Xe kết hợp Nhập+Xuất**: hoàn tất chân Nhập (Đã ra) thì chân Xuất mới Gọi/Vào được — hệ thống tự chặn, không cần nhớ.
6. Icon cột Booking: **?** đỏ = trong khung giờ chưa vào; **X** đỏ = quá khung giờ chưa vào → báo điều vận.

---

## R7 — Nhân sự / Chấm công

### SOP R7.1 — Dựng khung phân công (làm 1 lần / khi thay đổi)
1. **Phân công → tab Layout**: chọn kho → **Tạo layout** → đặt tên → chọn **Chức danh** tham gia → tick các **Vị trí** (skill) + số người mặc định.
2. **Tab Quy tắc ca**: khai luật nghỉ giữa ca (mặc định: làm CA3 hôm trước → cấm CA1 hôm sau).

### SOP R7.2 — Phân công hằng ngày
1. **Tab Phân công → Tạo phiếu**: Kho + Layout + Ngày (mỗi layout 1 phiếu/ngày).
2. Bước 1: chỉnh **Số lượng** yêu cầu từng vị trí → **Tự xếp người** (tự né người nghỉ phép, tôn trọng quy tắc ca, cân bằng công tháng).
3. Bước 2: tinh chỉnh tay (chips thêm/bớt vị trí từng người; 1 người có thể nhiều vị trí).
4. **Phát hành & Xem lịch** → tải/chia sẻ ảnh bảng phân công (Zalo). Cần sửa sau phát hành → **Hoàn tác** → sửa → phát hành lại.

### SOP R7.3 — Nghỉ phép & bảng công
- Duyệt nghỉ: **Chấm công → tab Nghỉ phép** → tick "**Chờ tôi duyệt**" → ✓ Duyệt / ✗ Từ chối. *Duyệt xong hệ thống tự ghi công "Nghỉ phép" cho các ngày trong đơn; nếu ghi đè công đã chấm sẽ có cảnh báo liệt kê ngày.*
- Cuối kỳ: **tab Bảng công → Ma trận** — ô **đỏ** = ngày làm việc chưa chấm → nhắc nhân viên (NV chỉ tự chấm được *hôm nay*; sửa ngày quá khứ cần quyền sửa công). Xuất **Excel** bảng công (chế độ Raw).

### SOP R7.4 — Nhân viên tự chấm công (mọi người)
1. **Chấm công → Của tôi**: bấm ô ngày hôm nay → chọn **Loại công** (Ca 1/2/3/HC) + Giờ OT *hoặc* Giờ về sớm → **Lưu**.
2. Xin nghỉ: **Xin nghỉ phép** → Từ/Đến ngày + Loại + Lý do → chờ duyệt (đơn duyệt rồi ngày đó tự thành Nghỉ phép, không cần chấm).

---

## R8 — Kho nhận (NPP) — nhận hàng chuyển kho

### SOP R8.1 — Nhận 1 lệnh chuyển kho
*Bối cảnh: kho tổng xuất chuyển kho xong → lệnh tự xuất hiện ở **Kế hoạch VC → tab Chuyển kho** của kho nhận (trạng thái "Đang vận chuyển").*
1. Mở lệnh → **ĐVVT booking**: điền **Biển số + SĐT lái xe + Giờ dự kiến tới** (*bắt buộc đủ 3 — nút nhận mới sáng*).
2. Xe tới → **Bắt đầu nhận hàng** → hệ thống tự tạo phiếu nhập cho từng mã (lệnh → "Đang nhận").
3. **Quét** QR từng pallet (NCC kế thừa theo tem gốc) / mã không QR → nhập số thùng + **Lưu**.
4. Mã nào thiếu phiếu → **Tạo phiếu lại**.
5. Xong từng mã → **Hoàn thành** phiếu (đối chiếu KH vs thực nhận; nhận **vượt** kế hoạch chỉ cảnh báo, không chặn) → tồn ghi vào kho mình.
6. Đủ hết phiếu → lệnh thành "**Đã giao**". Nhận nhầm → **Hủy nhận** (chỉ khi chưa có phiếu hoạt động).
7. Theo dõi chênh lệch: cột Thùng KH / Thực nhận / Chênh lệch + bảng chi tiết theo pallet (đối chiếu pallet xuất ↔ pallet nhận).

### SOP R8.2 — Sau nhận
- Tồn kho NPP xem ở **Tồn kho** (lọc kho mình). Xuất bán tại NPP dùng luồng Xuất kho bình thường.
