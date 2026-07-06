# 5. FAQ — Câu hỏi thường gặp

> Gom theo chủ đề. Nếu vấn đề là **lỗi/sự cố** (có thông báo đỏ, số liệu sai…) xem thêm [06-troubleshooting.md](06-troubleshooting.md).

## 5.1. Tài khoản & quyền

**Q1. Tôi không thấy menu X / nút Y mà đồng nghiệp có?**
Menu và nút hiển thị theo **quyền của chức danh**. Không thấy = chức danh của bạn chưa được cấp action đó. Liên hệ admin cấp quyền — sau khi cấp, chờ tối đa **5 phút** (hoặc tải lại trang) là quyền có hiệu lực, không cần đăng nhập lại.

**Q2. Quên mật khẩu thì làm sao?**
Không có chức năng tự khôi phục. Nhờ admin vào **Quản lý người dùng → dòng của bạn → Đặt mật khẩu**.

**Q3. Vì sao tôi chỉ thấy dữ liệu của 1–2 kho?**
Tài khoản có **Phạm vi kho** (Toàn quốc hoặc danh sách kho) và **Loại hàng được phép**. Bạn chỉ thấy dữ liệu của kho + loại hàng được gán — kể cả bộ lọc cũng chỉ hiện kho trong phạm vi. Cần thêm kho → nhờ admin sửa hồ sơ.

**Q4. Admin cấp quyền rồi mà tôi vẫn chưa thấy nút?**
Đợi tối đa 5 phút hoặc bấm tải lại trang (F5). Nếu vẫn không có: kiểm tra admin cấp đúng **action** chưa — mỗi nút 1 quyền riêng (ví dụ thấy trang Xuất kho nhưng không quét được = có `view` nhưng thiếu `scan`).

**Q5. Vì sao tôi không sửa được hồ sơ nhân viên dù có quyền Sửa?**
Sửa **hồ sơ** (tên, kho, loại hàng, chức danh) chỉ Admin làm được; quyền Sửa của quản lý cấp trung chỉ chỉnh phần **Kỹ năng/Vị trí**. Riêng tài khoản Admin thì không ai ngoài Admin đụng được.

**Q6. Bộ lọc tôi chỉnh có bị người khác thấy không?**
Không. Bộ lọc, bộ lọc đã lưu (SavedViews), mật độ dòng… lưu **riêng theo từng tài khoản** trên máy đó.

## 5.2. Nhập kho & tem pallet

**Q7. Quét tem báo "Pallet đã được quét/nhập" nghĩa là gì?**
Tem đó đã nằm trong hệ thống (đã nhập ở phiếu khác hoặc chính phiếu này). Mỗi tem QR chỉ nhập được **1 lần**. Kiểm tra ở **In tem pallet → Truy cứu** hoặc **Tồn kho** (dán mã vào ô tìm kiếm) xem pallet đang ở đâu.

**Q8. Vì sao tạo phiếu NCC bắt buộc phải chọn "Xe đang vào cổng"?**
Luồng chuẩn: xe phải được đăng ký cổng và xác nhận **VÀO** trước, phiếu nhập gắn với lượt xe đó (truy vết biển số, lần vào, tải trọng). Xe đã ra trong 3 ngày vẫn chọn được bằng cách tick "Trường hợp đặc biệt".

**Q9. Xe chở nhiều NCC / nhiều mã hàng thì tạo phiếu thế nào?**
1 lượt xe = 1 **nhóm phiếu cho mỗi NCC** (mỗi mã hàng 1 phiếu, tự nhóm theo chuyến). NCC thứ hai trên cùng xe → tạo phiếu mới chọn NCC đó. Muốn thêm mã cho NCC **đã tạo nhóm** → dùng nút **Sửa nhóm** (hệ thống chặn tạo trùng nhóm cùng NCC).

**Q10. Hàng không có tem QR (POSM, Loscam…) nhập thế nào?**
Mã khai "Không quản QR" (hoặc kho ở chế độ QTY): tạo phiếu bình thường (không cần vị trí) → vào chi tiết → **Lưu thủ công** nhập tổng số thùng — chỉ nhập 1 lần, sau đó bị khóa.

**Q11. Tôi quét nhầm số thùng / nhầm pallet, sửa được không?**
Được, trong giới hạn: sửa/xóa pallet **mình quét trong vòng 2 ngày** (quyền thường). Quá 2 ngày hoặc pallet người khác quét → cần giám sát có quyền "Sửa/Xóa pallet (bất kỳ)". Phiếu đã Hoàn thành phải **Gỡ hoàn thành** trước.

**Q12. In tem bị cảnh báo vàng "trùng tồn kho"?**
Chuỗi QR sắp in trùng với pallet **đang tồn** (cùng ngày SX + mã + chu kỳ + máy/NCC + seq + NMSX). Đổi **Seq bắt đầu** sang dải khác. Cảnh báo này chặn việc 2 pallet khác nhau mang cùng 1 mã QR.

**Q13. Tem in ra quét không ăn?**
In đúng **100% / Actual size** (không "Fit to page"), giấy không bóng lóa. Tem cũ mờ/rách → **In tem pallet → In lại từ tồn kho**.

## 5.3. Xuất kho & nhặt lẻ

**Q14. Vì sao chưa bấm được "Bắt đầu" chuyến xuất?**
Chuyến phải được **Giao đơn** trước, và khi Bắt đầu phải chọn **chuyến xe từ Đăng ký cổng** hướng Xuất (xe đã vào cổng). Xe vãng lai/đặc biệt → tick "Trường hợp đặc biệt" trong hộp thoại chọn xe.

**Q15. Vì sao nút "Hoàn thành" chuyến bị mờ dù đã quét gần đủ?**
Quy tắc cứng: **thực xuất phải bằng kế hoạch từng mã**. Xe về thiếu → **Sửa** đơn, hạ số kế hoạch của mã thiếu xuống đúng bằng thực xuất, rồi Hoàn thành. Hàng không QR phải đã "Lưu thủ công"; hàng nhặt lẻ phải đã "Check nhặt lẻ".

**Q16. Quét xuất báo cảnh báo "còn pallet cũ hơn trong kho" — có bị chặn không?**
Không chặn, chỉ **cảnh báo FEFO** (nên xuất pallet %Date thấp/cũ trước). Chủ động lấy đúng pallet gợi ý ở board **Chuẩn bị hàng**.

**Q17. Điều kiện Batch/%Date màu đỏ trên màn quét nghĩa là gì?**
Đơn hàng (từ file upload) yêu cầu lô/batch cụ thể hoặc %Date tối thiểu — chỉ quét pallet đạt điều kiện, pallet không đạt sẽ bị từ chối.

**Q18. Nhặt lẻ đã quét mà tồn chưa trừ?**
Đúng thiết kế: quét nhặt lẻ chỉ **giữ chỗ**; tồn trừ thật khi bấm **Check nhặt lẻ (N thùng)** (người có quyền xác nhận). Nhìn segment tím trên thanh tiến độ = phần lẻ chưa check.

**Q19. Badge vàng "Chờ về" / đỏ "Thiếu" cạnh mã hàng nghĩa là gì?**
Cảnh báo thiếu tồn theo (kho, ngày giao): **vàng** = tồn hiện không đủ nhưng kế hoạch nhập trong ngày sẽ bù đủ (chờ hàng về); **đỏ** = cả tồn + kế hoạch nhập vẫn thiếu → báo điều phối xử lý.

**Q20. Upload KH xuất báo "Bỏ qua" nhiều dòng?**
Xem lý do từng nhóm trong kết quả: sai định dạng Số xe (thiếu tiền tố ngày `ddmmyy_`), mã hàng chưa có trong danh mục, kho không khớp, chuyến **đã hoàn thành/đang xuất** (không ghi đè — chỉ chuyến Tạm dừng mới cập nhật được), hoặc số thùng mới nhỏ hơn số đã xuất.

**Q21. Vì sao không "Bỏ hoàn thành" được chuyến chuyển kho?**
Kho nhận đã **Bắt đầu nhận / đã nhận xong** thì kho xuất không mở lại được (bảo toàn số liệu 2 đầu). Cần sửa → kho nhận **Hủy nhận** trước (chỉ được khi chưa có phiếu nhập hoạt động).

## 5.4. Tồn kho, kiểm kho, dồn/tách

**Q22. Tồn "Khả dụng" khác "Tồn" chỗ nào?**
Khả dụng = Tồn − phần **giữ chỗ nhặt lẻ** − pallet bị **giữ QA**. Xuất kho chỉ tính trên khả dụng.

**Q23. %Date tính thế nào? Sao 2 pallet cùng ngày SX lại khác %Date?**
%Date = phần HSD còn lại, tính từ Ngày SX + HSD của mã hàng. Nếu pallet gán **NCC có HSD ngoại lệ** thì dùng HSD của NCC đó → khác nhau là do khác NCC/shelf-life.

**Q24. Upload tồn kho có ghi đè tồn cũ không?**
Khóa là **(kho, mã pallet)**: trùng khóa → **cập nhật** (số thùng, vị trí, ngày SX, NCC, QA — có ghi log điều chỉnh); chưa có → tạo mới. Lưu ý: file có **1 dòng lỗi thì cả file không ghi gì** — sửa hết lỗi rồi up lại.

**Q25. Dồn pallet có làm mất tem/số lượng từng pallet không?**
Không. Dồn chỉ **gom nhóm** (các pallet con gắn về pallet đích, dời vị trí theo đích) — tem gốc và số thùng từng pallet giữ nguyên, truy vết riêng. Muốn tách ra lại dùng **Gỡ nhóm**.

**Q26. Tách pallet xong pallet con có vào báo cáo nhập không?**
Không — pallet con (STT dạng `001.1`) không gắn phiếu nhập, để **không đội số liệu nhập**. Tồn kho thì tính đầy đủ. Nhớ in tem cho pallet con (ngay sau tách hoặc từ tab Lịch sử).

**Q27. Kiểm kho phát hiện lệch thì hệ thống tự sửa tồn không?**
Không tự sửa. Quét lệch → pallet bị **gắn cờ chênh lệch** (ghi số đếm thật vào ghi chú). Trưởng kho đối chiếu ở **Tổng hợp KK**, nếu lệch thật thì **Điều chỉnh tồn** ở trang Tồn kho (có lịch sử), rồi **Bỏ cờ**.

## 5.5. TMS & cổng

**Q28. Đặt khung giờ báo "hết chỗ" dù nhìn thấy còn slot?**
Sức chứa slot được đếm **thời gian thực** — người khác vừa đặt trước bạn vài giây. Hệ thống bảo đảm không bao giờ vượt số xe tối đa; chọn khung khác hoặc nhờ điều vận nới Max xe (Cài đặt TMS → Khung giờ).

**Q29. Muốn đổi ngày đơn đã đặt giờ?**
Phải **Trả lại/Thu hồi** suất trước (số đếm slot phải nhả ra), rồi mới Đổi ngày. Đơn chuyển kho (TRANSFER) không đổi ngày/xóa được từ TMS.

**Q30. Sửa khung giờ ở Cài đặt TMS có ảnh hưởng booking đã đặt không?**
Không. Thay đổi template chỉ áp cho **ngày tương lai chưa có booking**; ngày đã có booking giữ nguyên (dialog hiện "áp dụng được từ ngày…"). Muốn áp sớm hơn phải gỡ booking của ngày đó trước.

**Q31. Xe "Nhập + Xuất kết hợp" bị chặn không cho gọi chân Xuất?**
Đúng thiết kế: chân **Nhập phải "Đã ra"** thì chân Xuất mới Gọi/Vào được (xe phải trả hàng xong mới lấy hàng). Ngược lại, muốn hoàn tác "Đã ra" của chân Nhập phải hoàn tác chân Xuất trước.

**Q32. NCC tự chở hàng — chọn ĐVVT thế nào ở phiếu xuất?**
Ô ĐVVT chấp nhận cả danh mục **NCC** (có badge phân biệt ĐVVT/NCC) — chọn thẳng NCC đó, không cần tạo ĐVVT trùng tên.

**Q33. Báo cáo nhập có dòng "Phát sinh" màu cam?**
Là phiếu nhập **ngoài kế hoạch** (không khớp dòng KH nào theo ngày/kho/NCC/mã). Kiểm tra lại KH nhập hoặc chấp nhận là hàng phát sinh.

## 5.6. HR

**Q34. Vì sao "Tự xếp người" không xếp anh A vào vị trí X?**
Thuật toán chỉ xếp người thỏa **đủ**: có quyền kho đó + có skill/vị trí X + đúng chức danh layout + không nghỉ phép (đã duyệt) + không vi phạm **Quy tắc ca** (vd hôm trước CA3). Kiểm tra hồ sơ skill của anh A (Quản lý người dùng) và tab Quy tắc ca.

**Q35. Duyệt nghỉ phép báo "sẽ ghi đè chấm công"?**
Ngày trong đơn đã có công loại khác → duyệt sẽ **ghi đè thành Nghỉ phép** (hệ thống liệt kê ngày bị ghi đè). Từ chối/xóa đơn thì công Nghỉ phép tự gỡ.

**Q36. Nhân viên chấm bù ngày hôm qua được không?**
Không — tự chấm chỉ được **hôm nay**. Ngày quá khứ do người có quyền **Sửa công** (`attendance.edit`) chấm/hộ. Ngày tương lai không chấm được.

**Q37. Ô đỏ trong Bảng công ma trận là gì?**
Ngày làm việc (không phải Chủ nhật/ngày lễ) mà nhân viên **chưa chấm công** — dùng để rà thiếu công cuối kỳ.

## 5.7. Chung

**Q38. Số liệu trên màn hình có tự cập nhật không hay phải F5?**
Tự cập nhật (realtime). Nếu nghi ngờ màn hình đứng — xem mục Troubleshooting T7.

**Q39. Xuất Excel bị chặn "quá 50.000 dòng"?**
Giới hạn an toàn mỗi lần xuất. Thu hẹp khoảng ngày/bộ lọc rồi xuất thành nhiều file.

**Q40. Dùng trên điện thoại có đủ chức năng không?**
Đủ — giao diện tự co (menu thành drawer, bộ lọc thành sheet, bảng cuộn ngang). Thao tác quét QR khuyến nghị dùng điện thoại/tablet có camera sau tốt.
