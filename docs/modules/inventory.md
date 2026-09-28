# Tồn kho (`inventory`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Tồn kho (+ Sổ pallet)

**Quyền (BE `ALL_PERMISSIONS`):** view · adjust · move_location · recode · qa_update · update_ncc · update_prod_date · export · import

## Giao thoa với
<!-- giao-thoa:start -->
- [`directed_work`](directed_work.md) — Việc cần làm (hai chiều)
- [`fill`](fill.md) — Fill hàng (nhặt lẻ) (hai chiều)
- [`inbound`](inbound.md) — Nhập kho (hai chiều)
- [`loosepicking`](loosepicking.md) — Nhặt lẻ (hai chiều)
- [`outbound`](outbound.md) — Xuất kho (hai chiều)
- [`packing`](packing.md) — Sổ đóng gói (được nhắc tới từ đó)
- [`pallet_ops`](pallet_ops.md) — Dồn / Tách pallet (hai chiều)
- [`slotting`](slotting.md) — Tối ưu vị trí (Slotting) (hai chiều)
- [`stocktake`](stocktake.md) — Kiểm kho (hai chiều)
- [`traceability`](traceability.md) — Truy xuất lô (được nhắc tới từ đó)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Tồn kho. **SỔ PALLET (17/09, user hỏi "có giống sổ cái MB51 của SAP cho pallet ID không?"):** app KHÔNG có sổ hợp nhất — mỗi nghiệp vụ một bảng (đo 17/09: `packing_logs` 1.055 · `OutboundScanEntry` 288 · `InventoryAdjustmentLog` 181 · `PalletOperation` 27 · `StocktakeLog` 7 · `FillTaskScan` 1 · `wms_task_events` 1.248), muốn biết một pallet đi qua những gì phải ghép tay 7 nguồn ⇒ thực tế không ai tra. Nay **RPC `pallet_ledger`** (migration `20260917b`) hợp nhất ở tầng ĐỌC về một hình dạng chung (thời điểm · loại tác động · ai · từ ô → tới ô · số lượng · chứng từ); route `GET /wms/inventory/pallet-ledger?pallet_code=` (`requireAnyPerm` inventory.view · directed_work.view · stocktake.view, cắt phạm vi kho + loại như mọi đường đọc), UI = `components/wms/PalletLedgerDialog.tsx` mở từ pane chi tiết Tồn kho và từ chính tem trong panel chi tiết việc. **KHÔNG dựng bảng sổ cái riêng** — thêm nơi ghi là thêm nguồn sự thật phải giữ đồng bộ (lớp lỗi đắt nhất của dự án); thêm đường ghi mới thì thêm một nhánh UNION vào RPC. **HAI NHÓM KHÔNG TRỘN** (`grp`): `STOCK` = hàng thật sự bị động vào · `TASK` = nhật ký việc; đo thật một pallet Ba Vì có **105 dòng việc / 2 dòng hàng** nên trộn chung là chôn mất thứ cần đọc — trần `p_limit` cũng áp theo TỪNG nhóm, cắt phẳng theo thời gian sẽ hất văng đúng mấy dòng hàng. Khác MB51 ở hai chỗ phải nói rõ với người dùng: đây là sổ **hiện vật** (không có giá trị tiền, không sinh chứng từ kế toán) và khoá theo **TEM PALLET** (mịn hơn MB51 một bậc — SAP chỉ xuống tới pallet khi dùng Handling Unit). ⚠️ **ĐƠN VỊ ĐỌC Ở CHỖ GHI, KHÔNG ĐỌC Ở TÊN CỘT** (vấp ngay bản đầu 17/09, lớp C2 tái phát): `packing_logs.qty_cartons` tên là "cartons" nhưng giá trị là **BASE** ⇒ in "6.720 thùng" cho pallet 140 thùng. Gói 47 [12b–12g] + gói 22 [7b] gác. **AI QUÉT XUẤT:** `OutboundScanEntry.scanned_by` lấy từ `employee_id` do CLIENT gửi nên rỗng 288/288 dòng (script/bundle cũ không gửi) — nay thiếu thì rơi về người đang đăng nhập (`actorUuid(req)`), và cửa ghi số TAY (hàng không tem) trước nay không ghi ai cả thì nay có; gói 10 `[ai-quét]` gác

## Actions

view, adjust, move_location, recode, qa_update, **update_ncc**=Sửa NCC hàng loạt (gán NCC cho pallet → áp HSD ngoại lệ theo NCC), update_prod_date, export 
