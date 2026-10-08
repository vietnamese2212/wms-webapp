# Ghép xe LIÊN TỈNH (xe tuyến) — nghiên cứu 08/10/2026

> User 30/09: "cần tuyến liên tỉnh (Hòa Bình – Sơn La – Điện Biên)". 01/10: "đừng khai bảng hành lang bằng tay — công nghệ cũ, làm trên bản đồ".
> 08/10: "Tôi rất cần tính năng này — nghiên cứu chủ động và cẩn thận".
> Trạng thái: **ĐÃ LÀM 08/10** theo các điểm user chốt:
> - (a) lô nhỏ ghép, được ké xe;
> - (b) số khách / điểm giao theo ĐÚNG cấu hình đang khai, không thêm ô riêng. Mô phỏng thêm S6: với cấu hình hiện tại thì kẹt 1.568. S7: nâng GT lên 3 khách/xe và xe pallet lên 3 điểm thì kẹt 566;
> - (c) cước = phường giá cao nhất;
> - (e) in thứ tự giao lên Kế hoạch xuất và chuyến Xuất kho;
> - (d) km tối đa: chưa làm;
> - (f) ĐVVT theo tỉnh xa nhất: chưa làm, đang theo luật chọn ĐVVT sẵn có.
>
> Chi tiết luật + số đo: `docs/modules/dispatch.md` mục 08/10.

## 1. Hiện trạng (đọc từ code)

- Máy ghép chỉ gom đơn **cùng tỉnh**: khoá `mergeKey` = lớp · `region_code` · kênh · Loại kho (`dispatchEngine.ts`).
- **Đã có sẵn** công tắc "Gộp xe Non tải khác tỉnh — đường vòng tối đa %" (`Warehouse.dispatch_detour_pct`, 02/10). Công tắc nằm ở form Kho, đang **tắt** ở cả hai kho. Khi bật, nó chỉ chạy ở luật 5 (gộp xe Non tải) và vẫn phải qua ba khoá dưới đây, nên gần như không có tác dụng (xem đo S1).
- **Ba khoá** đang giữ đơn nhỏ ở lại khung chờ:
  1. Kênh GT, hàng FG01: tối đa 1 khách/xe. Xe 16/17 pallet: `max_drops = 1`. Dòng xe được vào của GT FG01 chỉ có Xe 16/17 pallet.
  2. Luật 5 chỉ gộp khi "cước sau gộp ≤ cước đi riêng". Cước tính theo pallet và không có giá sàn, nên gộp hai phường khác nhau **luôn đắt hơn trên giấy**. Từ 07/10, lô dưới tối thiểu **không thành xe**, tức vế "đi riêng" không còn tồn tại, nhưng phép so vẫn chặn.
  3. Cận dưới 70 % bắt buộc: lô không đủ 70 % thì về khung chờ (`UNDER_MIN`).
- **Những gì chưa có:**
  - Thứ tự điểm giao: không lưu ở đâu cả. `routeKm` có tính nhưng bỏ đi.
  - Đường đi trên bản đồ.
  - Chọn ĐVVT cho xe nhiều tỉnh: hiện lấy theo vùng của OD đầu tiên.
  - Cước xe nhiều phường: lấy giá theo pallet của phường xa nhất × mọi pallet, cộng phí rớt điểm 150 k/điểm. Nếu phường xa nhất thiếu cước thì **lặng lẽ** lấy phường gần hơn.
- **Dữ liệu địa lý:**
  - Ghim khách: Ba Vì 169/172, Bàu Bàng 159/160.
  - Km đã đo bằng Goong: 720 cặp, đều của Ba Vì. Bàu Bàng chưa đo cặp nào.
  - Thiếu km thì máy ước lượng: chim bay × 1,3.

## 2. Đo: chạy lại máy ghép trên dữ liệu thật

- **Nguồn:** 3.526 đơn của kế hoạch Ba Vì Bán hàng 04/10 (`6a1fda52`), chia theo ngày giao, lấy 21 ngày có ≥ 40 đơn (07/09 → 01/10). Mỗi ngày chạy máy ghép một lần rồi cộng lại.
- **Cấu hình:** giữ nguyên cấu hình thật (dải 70–100 %, kênh, dòng xe, bảng cước).
- **Công cụ:** bản sao tạm của máy ghép có luật "5b", không commit. Bản sao nằm ở scratchpad phiên 08/10: `dispatchEngine.simcorr.ts` + `tmp_corr_sim.test.ts`.

| Kịch bản | Xe | Pallet đi | Kẹt dưới tối thiểu | Xe liên tỉnh | Cước/pallet* |
|---|---|---|---|---|---|
| S0 hiện trạng | 771 | 9.064 | **1.677 OD / 4.047 pl** | 1 | 338 k |
| S1 bật "đường vòng 20 %" có sẵn | 786 | 9.191 | 1.578 / 3.921 | 97 (toàn xe lạnh tấn) | 364 k |
| S2 lô dưới tối thiểu ghép **với nhau**, ≤ 3 điểm, vòng 20 % | 1.005 | 12.010 | 724 / 1.102 | 269 | 386 k |
| **S3** như S2, **được ké xe còn chỗ** | 982 | 12.101 | **497 / 1.011** | 333 | 399 k |
| S4 như S3, ≤ 4 điểm, vòng 35 % | 997 | 12.195 | 423 / 917 | 349 | 404 k |
| S5 như S3 nhưng **chỉ trong cùng tỉnh** | 887 | 10.692 | 1.029 / 2.419 | 98 | 370 k |

\* Bảng cước staging toàn là số tạm ("GIẢ ĐỊNH 25/09" / "SƠ BỘ 04/10"), nên cột cước chỉ để so tương đối.

**Đọc bảng:**
- Theo ngày, khoảng **30 % pallet** (1.677 đơn) không đi được trong ngày vì dưới tối thiểu. Chúng chờ tới khi khách đặt thêm. Nhìn kế hoạch gom cả tháng thì không thấy chuyện này, vì đơn đã cộng dồn.
- Chỉ bật công tắc có sẵn (S1) thì gần như không đổi gì.
- Ghép tuyến cho lô dưới tối thiểu (S3) cắt số kẹt còn khoảng 8 % pallet:
  - Đi thêm 3.037 pallet với 211 xe, trung bình 14,4 pallet/xe; tải trung bình toàn kế hoạch vẫn 89 %.
  - Khoảng một nửa lợi ích đến từ việc cho khách nhỏ chung xe **trong tỉnh** (S5), nửa còn lại từ việc **liên tỉnh**.
- Cước/pallet tăng (338 k → 399 k) vì phần đi thêm là đơn nhỏ ở vùng xa, và vì cách tính cước hiện tại lấy giá phường xa nhất cho cả xe. Cước thật phụ thuộc cách nhà xe tính tuyến nhiều điểm (câu 5c).

**Ví dụ xe tuyến máy tạo ra (S3/S4):**
- Xe 17 Pallet 95 %: Sơn La → Lai Châu, 2 điểm, 394 km (đường thẳng tới điểm xa nhất 341 km).
- Xe 17 Pallet 99 %: Thái Nguyên → Lào Cai, 2 điểm, 257 km.
- Xe 8 tấn lạnh 74 %: Phú Thọ → Lào Cai → Lai Châu, 4 điểm, 393 km.
- Xe 16 Pallet 92 %: Hà Tĩnh → Nghệ An, 499 km.
- Xe 5 tấn lạnh 73 %: Thanh Hóa → Ninh Bình → Nghệ An, 3 điểm.

**Giới hạn của phép đo:**
- Ngày giao lấy theo ZSD02, mà ngày này không đáng tin. Ở đây chỉ dùng nó để gần đúng khối lượng một ngày.
- Thứ tự điểm và km dùng thuật toán láng giềng gần nhất trên ghim khách, chưa phải đường đi thật.
- Bàu Bàng chưa đo, vì chưa có kế hoạch và chưa đo km.

## 3. Thiết kế đề xuất (làm trên bản đồ, KHÔNG có bảng hành lang khai tay — theo quyết định 01/10)

**Luật 5b — ghép tuyến cho lô dưới tối thiểu.** Chạy sau luật 5, trước bước dựng xe.

- **Ai được ghép:** chỉ lô **sẽ bị loại vì dưới tối thiểu**.
  - Khách đủ xe vẫn đi riêng như cấu hình hiện tại. Luật "GT FG01 1 khách/xe" giữ nguyên cho xe thường.
  - Chế độ "được ké xe còn chỗ" (S3) là tuỳ chọn.
- **Ghép với ai:** cùng lớp, cùng kênh, cùng Loại kho; dòng xe được vào phải giao nhau; điều kiện bảo quản phải được phục vụ.
- **Giới hạn:**
  - Số điểm giao của xe tuyến tối đa N. Riêng xe tuyến, N thay cho trần khách/xe và `max_drops`.
  - Đường vòng ≤ X %, tính trên bản đồ: quãng kho → các điểm (gần trước) không dài hơn đường thẳng tới điểm xa nhất quá X %.
  - Có thể thêm km tối đa của một chuyến.
- **Chọn ghép:** ưu tiên lô sau ghép **đạt tối thiểu**, rồi tới cước tăng thêm ít nhất. Không so với "đi riêng", vì đi riêng không được phép.
- **Xe tuyến** được đánh dấu `corridor`, lưu **thứ tự điểm giao** + km + % đường vòng vào chi tiết xe. Cước tính như hiện tại: phường xa nhất + phí rớt điểm.
- **Cấu hình:** ở form Kho, nhóm "Điều vận — ghép chuyến", ngay cạnh ô đường vòng đã có. Các ô: bật xe tuyến · số điểm tối đa · đường vòng % · ké xe còn chỗ. Giá trị được chụp vào `plan.params` lúc ghép, giống dải tải.

**Giao diện:**
- Bàn ghép xe: chip "Tuyến" trên dòng xe; cột Vùng in tỉnh theo **thứ tự giao**; nhóm thẻ theo tỉnh xa nhất.
- Bản đồ: vẽ đường của xe đang chọn.

**Chứng từ:** thứ tự giao sang Kế hoạch xuất và chuyến Xuất kho; ĐVVT của xe tuyến theo tỉnh **xa nhất**.

**Kiểm:**
- Test đơn vị engine:
  - Lô dưới tối thiểu hai tỉnh trên cùng hướng ⇒ một xe tuyến.
  - Hai hướng ngược nhau ⇒ không ghép.
  - Khách đủ xe không bị nhét thêm điểm (chế độ "chỉ với nhau").
  - Trần điểm, ĐK bảo quản và dòng xe được vào đều được giữ.
- Gói 61 thêm kịch bản hai tỉnh trên kho QA61.
- Chạy lại bộ mô phỏng này trên bàn thật trước khi báo xong.

## 4. Rủi ro đã thấy

- Thời gian chạy: luật 5b quét lại sau mỗi lần ghép. Bàn 3.500 đơn hôm nay đã mất 10–18 s, trần Vercel là 60 s. Phải đo trên bàn Bán hàng Ba Vì đầy đủ.
- Ô Vùng: mã vùng SAP lệch tên tỉnh (110 = 5 tỉnh). Xe tuyến nên dựa vào **ghim + km**, không dựa vào mã vùng.
- Phường xa nhất thiếu cước ⇒ cước lặng lẽ lấy phường gần hơn. Với xe tuyến điều này sai nặng hơn, phải báo rõ.

## 5. Câu hỏi user phải chốt

a. Ai được lên xe tuyến: chỉ lô **dưới tối thiểu ghép với nhau**, hay được **ké xe khác còn chỗ**? Ké xe thì bớt 23 xe và bớt 227 đơn kẹt, nhưng xe của khách lớn có thêm điểm giao.
b. Số điểm giao tối đa của xe tuyến (3 hay 4) và đường vòng cho phép (20 % hay 35 %).
c. Nhà xe tính cước xe nhiều tỉnh thế nào: giá phường xa nhất + phí rớt điểm như hiện tại, giá chuyến theo km, hay giá từng điểm? Có giá sàn/chuyến không?
d. Có cần km tối đa / giờ chạy tối đa của một chuyến tuyến không?
e. Thứ tự giao có cần in lên Kế hoạch xuất / phiếu xuất (để xếp hàng ngược: điểm cuối lên xe trước) không?
f. ĐVVT của xe tuyến chọn theo tỉnh xa nhất — đồng ý không?
