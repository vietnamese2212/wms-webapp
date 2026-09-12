# Việc cần làm — rà theo VAI người dùng + kế hoạch cải tiến (đợt 2)

> Lập 12/09/2026 theo yêu cầu user: *"đặt mình vào vai các user liên quan tới Việc cần làm, rà soát,
> đề xuất hướng xử lý, lên kế hoạch cải tiến để nhân sự vận hành tốt, thao tác trên app tối ưu hơn
> (không phải vuốt kéo nhiều). Mục đích: vị trí liên quan nắm được họ cần làm gì thì show lên app ở
> Việc cần làm; cái nào việc chung, cái nào việc riêng làm rõ."*
>
> Trạng thái: **CHỜ USER DUYỆT** — chưa code dòng nào. Số đo lấy trên staging 12/09.

## 0. Hiện trạng đo được (không suy diễn)

| Mục | Số đo | Nguồn |
|---|---|---|
| Kho chạy Hướng dẫn | 1/153 (Ba Vì; 6 cửa xuất · 4 điểm đầu dãy · 3 vị trí nhặt lẻ) | `Warehouse.work_mode` |
| Việc đã sinh | 212, tất cả do seeder 12/09 (1 actor, 26 phút) | `wms_task_events` |
| Việc SKIPPED `OTHER_PALLET` | 115/212 (thủ kho quét pallet khác kế hoạch) | `wms_tasks` |
| Chức danh có quyền `directed_work` | **0/9** chức danh kho | `JobTitle.module_permissions` |
| Lái xe nâng (17 người) | quyền outbound: view + prepare; `fill`: không | như trên |
| Thủ kho TP (9 người) | không có `directed_work.view` | như trên |
| Bề ngang bảng trên PDA 360 px | Cần hạ 874 px · Cần đưa ra 872 px · Sắp quét 836 px (≈ 2,4 màn) | `COLS` trong `DirectedWork.tsx` |
| Cỡ chữ ô dữ liệu | 10 px (chuẩn table-format PC) | như trên |
| Thông báo khi được giao xe nâng lúc Bắt đầu | không có (`notifyEmployees` không được gọi ở `startGDO`) | grep `outboundController.ts` |
| Trang mở đầu sau đăng nhập | `/` = Dashboard KPI toàn công ty | `App.tsx:89` |
| Việc cùng vai nằm rải ở màn khác | Fill lệnh · Slotting 57 dòng mở · Chuyển kho chờ nhận · Chốt %Date · Cần xử lý SAP · Kiểm kê luân phiên | DB + menu |

## 1. Rà theo từng vai — điểm gãy và hướng xử

### 1.1 Lái xe nâng HẠ (bảng "Cần hạ", việc CHUNG toàn kho)
- **Không mở được trang** — chức danh không có `directed_work.view`. Nhìn ở góc người dùng: menu không có mục "Việc cần làm". Tính năng ra máy 10/09 mà chưa ai ngoài Admin thấy được.
- **3 thao tác mới thấy việc đầu tiên**: đăng nhập rơi vào Dashboard KPI (không liên quan) → mở menu → Việc cần làm → chọn Kho (mặc định rỗng "Chọn kho…") dù người này chỉ có 1 kho.
- **Bảng 874 px trên máy 360 px**: cột "Đặt xuống" (nơi phải đặt pallet) và nút ✓ Xong nằm ở màn thứ 3 theo chiều ngang. Chữ 10 px, đeo găng.
- **Việc chung nhưng không có "nhận việc"**: 2 xe hạ cùng ca nhìn cùng dòng số 1, cùng chạy tới cùng ô. Không có cách nói "tôi đang làm dòng này".
- **Việc biến mất không lời giải thích**: thủ kho quét pallet khác ⇒ việc SKIPPED và rơi khỏi bảng (bảng chỉ trả PENDING/DONE). Xe hạ đã hạ pallet đó xuống rồi thì không biết vì sao hàng mình vừa hạ không còn ai nhắc. Đây là lớp việc chiếm 115/212 dòng trên dữ liệu nạp.
- **Băng vàng "n dòng chưa khai quy định date"** hiện trên màn xe nâng — người này không có quyền và không phải việc của họ.

### 1.2 Lái xe nâng CHUYỂN (bảng "Cần đưa ra", việc RIÊNG theo `forklift_driver_ids`)
- **"Riêng" nhưng 3 người thấy hệt nhau**: mọi chuyến seed đều gắn 3 tài xế, bảng "Của tôi" của 3 người là một. Không chia việc trong nhóm, không biết ai cầm dòng nào.
- **Kho không có xe hạ riêng** (ca đêm, kho nhỏ): cùng một người phải sang tab Cần hạ → bấm Xong → quay lại Cần đưa ra → bấm Xong. Hai lần đổi tab + hai lần bấm cho MỘT pallet; dòng ở tab Cần đưa ra khoá "⏳ chờ xe hạ" trong khi chính người đó là xe hạ.
- Cột "Đưa" in mã hàng nhưng xe nâng chỉ cần số pallet + ô nguồn + ô đích; mã hàng là thông tin của thủ kho.

### 1.3 Thủ kho (bảng "Sắp quét", theo chuyến)
- **Bảng chỉ để xem, không quét được**: muốn quét phải đi Xuất kho → mở chuyến → Quét. Hai màn tả cùng một việc, thủ kho phải nhớ thứ tự ở màn này rồi sang màn kia làm.
- Phải chọn Kho rồi chọn Chuyến; không có "chuyến của tôi" (chuyến được `assign` cho thủ kho nào).
- **Pallet lấy MỘT PHẦN không hiện số thùng**: RPC trả `qty_base` và `is_partial` nhưng cột "Lấy" chỉ in "1 pallet · mã". Thủ kho không biết lấy 20 thùng hay cả pallet.
- Việc xong bằng quét tự gạch — đúng thiết kế; nhưng "pallet kế tiếp" không được nổi bật hơn các dòng còn lại.

### 1.4 Nhân viên SAP / CS (chốt quy định date) và Giám sát kho
- Việc "chốt %Date" là điều kiện để có việc, nhưng nó không nằm trong hộp việc của người chốt — nó hiện thành cảnh báo trên màn xe nâng. Trang Quy định date đứng riêng, người chốt phải tự nhớ mở.
- Giám sát không có góc nhìn "ai đang làm gì, chuyến nào đang kẹt chờ hạ" ngoài SummaryBand 5 ô; không thấy tỷ lệ làm đúng kế hoạch (DONE vs SKIPPED) — số này đang có sẵn trong DB.

### 1.5 Việc cùng vai nằm ngoài "Việc cần làm"
Xe nâng còn: lệnh Fill (chuyển pallet về vị trí nhặt lẻ), dòng kế hoạch Slotting (57 dòng đang mở), sau này là cất hàng nhập. Thủ kho còn: chuyến chuyển kho chờ nhận, kiểm kê luân phiên đến hạn. Mỗi thứ một trang, không trang nào nói "hôm nay bạn có N việc".

## 2. Nguyên tắc thiết kế cho đợt 2 (đề xuất chốt trước khi code)

1. **Một hộp việc theo NGƯỜI, không theo module.** Mở app = thấy việc của mình. Nguồn việc (xuất, fill, slotting, chuyển kho, chốt date) là chi tiết kỹ thuật.
2. **Ba vùng rõ ràng trên cùng một màn**: **Của tôi** (giao đích danh: xe chuyển theo chuyến, lệnh fill, chuyến được assign) · **Việc chung của kho** (ai làm cũng được — hạ pallet, slotting; có nút **Nhận** để không trùng nhau) · **Đang chờ người khác** (xám, chỉ xem — pallet chờ xe hạ, dòng chưa chốt date).
3. **PDA = thẻ, không phải bảng.** Dưới `sm`: mỗi việc một thẻ full bề ngang, thẻ đầu to gấp đôi ("VIỆC KẾ TIẾP"), nút ✓ cao ≥ 44 px ngay trên thẻ. Không cuộn ngang. Bảng giữ cho PC/tablet của giám sát.
4. **Không bắt chọn lại thứ máy biết rồi**: 1 kho → tự chọn; vai xe nâng → mở đúng tab; chuyến đang assign → tự chọn.
5. **Việc mất phải nói vì sao** (SKIPPED hiện gạch kèm lý do 1 dòng, tự ẩn sau khi chuyến kết thúc).

## 3. Kế hoạch 3 đợt

### Đợt A — Cấu hình + sửa nhỏ (≈ 1 ngày, không đổi schema)
| # | Việc | Kiểm tra |
|---|---|---|
| A1 | Cấp quyền: `directed_work.view+confirm` cho Lái xe nâng · Trưởng nhóm lái xe nâng; `view` cho Thủ kho TP/NVL; `view+replan` cho Giám sát/Quản lý kho (migration JSONB như `20260819b`) | đăng nhập vai thật thấy menu + bấm được ✓ |
| A2 | Tự chọn kho khi phạm vi chỉ có 1 kho (đọc `useScopedWarehouses`) | mở trang không còn "Chọn kho…" |
| A3 | Landing theo vai: chức danh có `directed_work.view` mà không có `dashboard.view` → `/` chuyển sang `/wms/directed`; bottom-nav mobile đưa "Việc cần làm" lên ô đầu | đăng nhập tài khoản xe nâng rơi thẳng vào việc |
| A4 | Băng "chưa khai quy định date" chỉ hiện với người có `outbound.set_date`; người khác thấy dòng xám "n dòng đang chờ chốt date" trong vùng *Đang chờ người khác* | vai xe nâng không còn băng vàng |
| A5 | Tab Sắp quét: in `qtyLabel(qty_base)` khi `is_partial`; nổi bật dòng kế tiếp | pallet lấy một phần có số thùng |
| A6 | RPC `directed_board` trả thêm SKIPPED của chuyến đang chạy (gạch + lý do "thủ kho đã lấy pallet khác / chuyến khác lấy trước") | seed OTHER_PALLET hiện ra có lời |
| A7 | `startGDO` + đổi xe nâng ở "Sửa thông tin xe" → `notifyEmployees` cho `forklift_driver_ids` (thêm `PREF_KEYS`) | chuông + push tới đúng người |

### Đợt B — Chế độ THẺ trên PDA + việc chung/riêng (≈ 3 ngày)
| # | Việc | Kiểm tra |
|---|---|---|
| B1 | `DirectedWork.tsx` dưới `sm`: danh sách thẻ; thẻ đầu = "Việc kế tiếp": **ĐI TỚI** ô · tầng → **LẤY** n pallet (mã, số thùng nếu lẻ) → **ĐẶT** đầu dãy/cửa/vị trí nhặt lẻ; nút ✓ Xong h-12; các thẻ sau thu gọn | Playwright 360/390: 0 cuộn ngang, thẻ đầu + nút ✓ nằm trong 1 màn |
| B2 | **Nhận việc** cho việc chung: cột `claimed_by/claimed_at` trên `wms_tasks` (khoá mềm 10', tự nhả; CAS `WHERE claimed_by IS NULL`); thẻ của người khác nhận → xám "X đang làm" | 2 tài khoản bấm Nhận cùng dòng → 1 thắng, 1 thấy tên người kia |
| B3 | Cờ kho `separate_lowering_forklift` (mặc định TRUE = hành vi hiện tại). FALSE → tab Cần đưa ra hiện việc kệ cao là "Hạ & đưa ra", một nút ✓ ghi cả `lowered_at` + `moved_at` | kho không xe hạ riêng: 1 pallet = 1 bấm |
| B4 | Tab Sắp quét: nút **Quét** mở thẳng scan sheet của chuyến (tái dùng `OutboundScanSheet`), tự chọn chuyến đang assign cho tôi; ẩn ô chọn Kho/Chuyến khi máy suy được | thủ kho quét từ chính bảng thứ tự |
| B5 | Cột theo vai: xe nâng bỏ cột mã hàng khỏi thẻ chính (chuyển xuống dòng phụ); thủ kho thấy mã + tên + số thùng | thẻ xe nâng ≤ 4 dòng chữ |
| B6 | Gói QA 57 thêm: claim đua · Hạ&đưa ra ghi đủ 2 mốc · board trả SKIPPED có lý do · tự chọn kho | 57 xanh + ratchet `mutation_hook_without_button` không tăng |

### Đợt C — Hộp việc theo vai, gom mọi nguồn (≈ 1 tuần)
| # | Việc | Kiểm tra |
|---|---|---|
| C1 | RPC mới `my_work_inbox(p_employee, p_warehouse)` trả 3 vùng, mỗi dòng `{source, kind, title, where_from, where_to, qty, claim, deep_link}`; nguồn: `wms_tasks` (PICK/LOOSE_FEED) · `FillTask` của tôi · `SlottingPlanLine` chưa xong · `TmsOrder` chuyển kho chờ nhận (thủ kho kho đích) · dòng chưa chốt date (người có `set_date`) · DO "Cần xử lý" (người có `external_do_sap`) | một round-trip, oracle so từng nguồn |
| C2 | Trang Việc cần làm = hộp việc này; tab 3 vai cũ trở thành bộ lọc "Loại việc" | vai xe nâng thấy fill + slotting + hạ/đưa ra ở một chỗ |
| C3 | Ô đếm trên chuông + badge bottom-nav = số việc *Của tôi* chưa xong | mở app biết ngay còn N việc |
| C4 | Màn giám sát (PC): cột "Ai đang làm", thời gian chờ hạ theo chuyến, **% làm đúng kế hoạch** = DONE / (DONE+SKIPPED) theo ngày/người — số đã có sẵn trong `wms_tasks` | KPI mới nuôi tab Năng suất sau |
| C5 | (Đợt sau, ngoài phạm vi này) Directed putaway nhập kho: `kind = PUTAWAY` từ `putawayScore` khi quét nhập ở kho GUIDED | — |

## 4. Rủi ro và điều chưa kiểm
- Chưa chạy Playwright trên PDA thật lượt này; bề ngang bảng tính từ khai báo `COLS`, chưa chụp ảnh. Đợt B phải chụp 360/390 trước/sau.
- Việc SKIPPED nhiều (115/212) là do seeder chọn pallet độc lập với kế hoạch; con số này KHÔNG phản ánh hành vi thủ kho thật. Nhưng nó cho thấy bảng đang mù với lớp việc "mất" — A6 vẫn cần.
- B2 (Nhận việc) thêm cột vào `wms_tasks` → phải đi qua `services/directedTasks.ts` (ratchet `task_status_written_outside_service`).
- C1 gom nhiều nguồn vào một RPC: mỗi nguồn phải cắt scope kho ∩ loại như trang gốc của nó, nếu không hộp việc thành cửa sau đọc chéo kho (luật QA 08/35).
