# Nhặt lẻ (`loosepicking`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Nhặt lẻ (+ Tối ưu tuyến)

**Quyền (BE `ALL_PERMISSIONS`):** view · scan · complete · recalc

## Giao thoa với
<!-- giao-thoa:start -->
- [`directed_work`](directed_work.md) — Việc cần làm (hai chiều)
- [`dispatch`](dispatch.md) — Điều vận (được nhắc tới từ đó)
- [`fill`](fill.md) — Fill hàng (nhặt lẻ) (hai chiều)
- [`inventory`](inventory.md) — Tồn kho (hai chiều)
- [`outbound`](outbound.md) — Xuất kho (được nhắc tới từ đó)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Nhặt lẻ. **"TỐI ƯU TUYẾN" (tên cũ "Theo vị trí", user đổi 15/09 — tên phải nói việc màn làm: sắp THỨ TỰ ĐI ngắn nhất, không phải chỉ CHỖ; user chốt 14/09, hai vòng: "mở 1 nút và hiện lên con đường đi lấy, quét được luôn ở đó" → rồi chỉnh "giao diện dạng TABLE, mỗi vị trí × mã hàng là 1 dòng, tối ưu từ trên xuống, có nút quét QR như trang chi tiết Nhặt lẻ, link với Nhặt lẻ/Xuất để có gì đổi là cập nhật"):** nút chính trên trang chuyến Nhặt lẻ mở `components/wms/LooseRouteSheet.tsx` toàn màn hình = **BẢNG lộ trình** (`ResizableTable`, sticky cột Vị trí): thứ tự = BFS từ cửa của chuyến (`GET /wms/directed/loose-route`), dòng cùng ô đứng liền nhau và ô in MỘT lần (`↳ cùng ô`, `×n`), dòng KẾ TIẾP tô sky + chip "kế tiếp", cột Còn lấy · Đã/cần (thùng + lẻ) · %Date pallet gợi ý · Tồn ở ô (⚠ hổ phách khi ô không đủ); **quãng đường nằm ở DÒNG PHỤ trong chính cột Vị trí, KHÔNG tách cột riêng** và **cột Thao tác chỉ ghim mép phải từ `sm`** — đo 14/09 ở 360 px: cột Quãng chen giữa đẩy Mã hàng khỏi tầm nhìn, và hai cột ghim hai đầu ăn 272/360 px nên cột phải ĐÈ lên Mã hàng (nút "Quét QR" to ở header vẫn là đường quét luôn thấy); **dòng đã lấy đủ GẠCH NGANG, tụt cuối, vẫn ở lại** (luật Việc cần làm) kèm ô đã lấy; SummaryBand Điểm ghé · Mã còn lấy · Còn/Đã lấy (quy đổi thùng per mã, trộn đơn vị ⇒ "SL quy đổi"). Quét = **CÙNG `GdoScanSheet` mode `loose`** của nút "Quét QR" trang chuyến (nút header + nút Quét từng dòng; hàng không tem → "Lưu SL" sang trang mã hàng `?scan=1`; bóp cò súng ngay trên bảng cũng mở màn quét chế độ súng) — KHÔNG viết luồng quét thứ hai. **Bản đầu cùng ngày dựng thẻ-điểm-hiện-tại + quét nhúng (`GdoScanPanel`) đã BỎ** theo ý user — đừng dựng lại. Bám realtime nhờ khoá `['gdo','loose-route',id]` nằm dưới `['gdo']` (mutation quét + `TABLE_QUERY_MAP` đều invalidate). Link "Tối ưu tuyến ›" ở tab Sắp quét của Việc cần làm mở `?route=1` (áp MỘT lần mỗi đường dẫn). BE `loose-route` trả per mã `remaining_base/effective_base/scanned_base` (cùng công thức `itemLooseProgress`; dòng lấy đủ phần lẻ chuyển sang `done[]` kèm ô của pallet đã quét, dù pallet chẵn chưa quét) · `material_name` · `units`; per điểm `dist_from_prev_cells`; gốc `cell_m`. ⚠️ **Nhánh `unlocated[]` (mã chưa có tồn để chỉ chỗ) PHẢI mang `units` + `material_id` y như nhánh chính** — thiếu quy cách thì FE coi là mã không entry: dòng 60 hộp in "60 thùng" và ô tổng cộng BASE THÔ (đo 14/09: 203,8 thay vì 146,3 "SL quy đổi"), đúng lớp lỗi base-unit; gói 57 [25e] gác. Thêm nhánh trả về mới ở endpoint này → hỏi "nhánh này có đủ quy cách để in số lượng không?"; `orderByNearest` nhận `legsOut` (BE+FE mirror, phép kiểm đi lại từng chặng). Gói 57 [25d1–25d2]. **15/09 — bảng nói luôn "cần fill xuống kho lẻ"**: ô lấy ưu tiên VỊ TRÍ NHẶT LẺ giữ đúng lô; chưa có ⇒ dòng phụ "⚠ nên fill xuống ô lẻ" + băng đầu bảng "n mã … — Fill hàng ›" (đỏ nếu kho tích bắt buộc, khi đó dòng không còn điểm ghé và ghi "phải fill xuống kho lẻ (từ ô X)"). Luật + hai mức ở hàng `directed_work` / `services/loosePickFace.ts`. **16/09 — "nên fill" ≠ "chưa ai lo"**: mã đã có dòng `FillTask` PENDING cùng ngày thì lộ trình trả `fill_order_code`/`fill_pending_base` và màn ghi **"⏳ đã có lệnh fill … chờ hạ"** + băng riêng "Xem lệnh ›" (mở thẳng lệnh đó), KHÔNG giục ra lệnh lần nữa — vì Fill hàng đã trừ phần đang treo khỏi "thiếu" nên bấm "Fill hàng ›" sang tab Đề xuất là gặp trang im lặng về chính mã đó (lớp C24 lặp; gói 57 [25i2][25i3])

## Actions

view (mở Theo vị trí), scan (nút quét trong đó; thiếu quyền ⇒ chỉ xem bảng), complete (create/start/cancel ĐÃ BỎ 27/06 — nhặt lẻ tạo/bắt đầu/hủy đều qua Outbound, không route riêng) 
