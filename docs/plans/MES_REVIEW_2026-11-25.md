# Rà soát MES + các module chạm MES — 25/11/2026

> **Cách làm.** Gemini 4 Hydrogen (qua Antigravity CLI, chế độ chỉ đọc, chạy trên bản sao repo không có `.env`) soi ba vùng: backend MES (B), giao diện MES (F), chỗ MES chạm module khác (X).
>
> Claude kiểm từng mục bằng code ở HEAD `3b3809d4` và thân hàm đang chạy trên DB staging (`pg_get_functiondef`), rồi gửi phán quyết lại cho Gemini phản biện một vòng. Bảng dưới là kết luận **sau khi bàn**.
>
> Staging chỉ có 2 mẻ, nên các mục hiệu năng mới xác nhận bằng đọc code và EXPLAIN, chưa đo được thời gian.
>
> **Chưa sửa gì.** Đây là danh sách việc cho các đợt sửa.

## Kết luận

- **Gemini nêu 42 mục.** Sau khi kiểm:
  - 37 đúng hoặc đúng một phần. Nhiều mục bị thổi mức, và nhiều ý con sai.
  - 3 sai hẳn.
  - 1 là luật nghiệp vụ cần người dùng chốt.
  - 1 chưa đo được.
- **Lỗi thêm.** Claude tìm thêm 7 lỗi; Gemini tìm thêm 4 lỗi cùng lớp ở vòng 2.
- **Nặng nhất là sai số liệu tồn và bồn.** Không có lỗi nào lọt quyền giữa các kho theo kiểu đọc hay ghi được dữ liệu kho khác. B11 chỉ lộ mã bồn, và phải biết trước UUID.

## Tiến độ

User chốt 25/11:
- Câu 4: ghi "Hoàn từ ca trước", kèm công tắc chặn khi cần (vì lúc đó NVL thường đã mất), và rà phần NVL đã mất.
- Câu 5: không mở Sổ pallet cho kho cha.
- Các câu còn lại: theo khuyến nghị.

| Đợt | Trạng thái |
|---|---|
| 1 | ✅ 25/11 — migration `20261125_mes_review_packing_tank` (áp staging), gói 63 [6s2], C132 |
| 2 | ✅ 25/11 — migration `20261125b_mes_review_batch_atomic` (áp staging): B2 B3 B4 B6 B8 B12 F9 G2 G3 + B11 (`nextCode` / `pourScan` kiểm bồn thuộc kho); gói 63 [1i] [10j2]; C60 lặp |
| 3 | ✅ 25/11 — migration `20261125c_mes_review_flow_gate_db` (áp staging): N1 luồng chặt trong DB · G1 `qaGateOfTank` ném lỗi · B9 `loadBatch` / `loadTank` / `inScope` / `productionWhError` / `getBatch` ném lỗi (503 thay vì 404 / 403 / 200-rỗng) · B10 quét cấp kiểm kho / trạng thái tem trước luân chuyển; C104 lặp |
| 4 | ✅ 25/11 — migration `20261125d_mes_review_tank_dash` (áp staging): B1 (`first_filled_at` + `mes_tank_incoming` dùng chung 4 chỗ, `listTanks` hết cắt 1.000) · B5 · B7 (`mes_dev_line_keep`); gói 63 [19c2] |
| 5 | ✅ 25/11 — migration `20261125e_inventory_status_pool` (áp staging): X1 luật 1–4 (cửa tồn gộp: QA giữ · trừ giữ chỗ · thứ tự luân chuyển · kho bắt buộc chặn NSX chọn sai) · mới 1 (xuất lố + `clamped` ghi vết) · mới 2 (một hàm trạng thái + cổng tĩnh) · X2 vế 2 · X5 · mới 4 · X8 · X-N3a; gói 64 MỚI; C133 |
| 6 | ✅ 25/11 — giao diện MES: F1b–d + F11 (khoá realtime; Cài đặt MES đổi công tắc theo Loại kho chạm Kho) · F2 (`QtyInput` ô thập phân = `parseVnNumber`, 15 màn) · F3 · F4 (+ Cài đặt MES) · F5 (sổ bồn phân trang + băng lỗi) · F6 · F7 · F8 · F9b · F10 · cải tiến khoá sẵn Mã BTP / kế hoạch; C134. Gỡ trigger realtime của bảng fact: KHÔNG làm (gói QA 00 gác luật "bảng có trigger") |
| 7 | ✅ 25/11 — migration `20261125f_mes_shift_returns` + `20261125g_material_base_unit_lock` (áp staging): N4 (cột Hoàn từ ca trước + công tắc chặn, user chốt) · B15 (khoá chia sẻ / độc quyền + clock_timestamp) · báo cáo đã chốt không đổi khi huỷ về sau · X9 (khoá đổi đơn vị gốc) · X6 · X10; C135. **Chưa làm:** B13 / B14 (hiệu năng — staging chưa đủ dữ liệu đo), X-N1 (Excel / KHVC thiếu luật quỹ đạo kho phụ — để đợt soát Xuất kho toàn app) |

## Kế hoạch sửa theo đợt (thứ tự nên làm)

| Đợt | Chủ đề | Mục | Sửa ở một chỗ | Lưới máy | Công sức |
|---|---|---|---|---|---|
| 1 | Sổ đóng gói ↔ sổ bồn | X3, X4, lọc trang huỷ ở gia phả | `cancelRun` chặn khi lượng rút thuần của trang ≠ 0 · `mes_run_redraw` đưa khối kiểm trộn mã lên trước chỗ rẽ nhánh tăng / giảm · `mes_genealogy` thêm `r.status <> 'CANCELLED'` | 22-packing: huỷ trang đã rút ⇒ 409 · 63: rút thêm khi bồn đã đổi mã ⇒ `MIX_MATERIAL` | S |
| 2 | Sửa mẻ / bồn nguyên tử | B4, F9a, B3, B6 (phần trộn mã), B2, B8, B12, sửa định mức khi QA đã duyệt, bỏ duyệt QA | RPC `mes_batch_update` (khoá mẻ + bồn cũ / mới, gọi `mes_batch_identity`, `mes_batch_requirements_refresh`, `mes_batch_set_forms` trong một giao dịch, nhận `extra_forms`) · `mes_batch_create` gọi áp công thức + gắn phiếu bên trong · hàm chung `mes_next_batch_no` (nhảy qua mã đã dùng trên bồn, KHÔNG lấp số mẻ huỷ) · `mes_tank_transfer` chặn bồn đích đã đặt cho mẻ mã khác · `mes_batch_set_requirements` / `apply_recipe` / `requirements_refresh` chặn `qa_ok_at` sau `FOR UPDATE` · RPC duyệt / bỏ duyệt khoá mẻ | 63: sửa mẻ đổi bồn vượt sức chứa ⇒ không ghi gì · huỷ mẻ 2 rồi mở lại cùng bồn ⇒ số 3 · chuyển bồn vào bồn đã đặt mã khác ⇒ 409 | M |
| 3 | Luật đặt trong DB; lỗi DB không "mở cửa" | N1, qaGateOfTank, B9 (+ `inScope`), B10, B11 | `mes_open_batch_wh(p_batch, p_require_approved boolean DEFAULT false)` — chỉ `mes_consume_scan` / `mes_consume_lot` truyền `true` (huỷ cấp và xin / duyệt hết hạn dùng chung hàm này, KHÔNG được chặn) · mức QA khi rút bồn tính trong `mes_tank_take` sau khoá bồn · `loadBatch` / `loadTank` / `inScope` / `productionWhError` / `nextCode` / `shiftWh` / `tankForRunError` ném lỗi để `failAny` dịch 57014 → 503 | luật cổng tĩnh: `db.from(...)` trong `productionController` / `productionGate` phải đọc `error` · 63: kho bật luồng chặt, cấp khi chưa duyệt ⇒ chặn ở DB | M |
| 4 | Sơ đồ bồn + dashboard | B1, B5, B7 | hàm `mes_tank_incoming(tank_ids)` dùng chung cho `mes_tank_room_check` và `listTanks` (bỏ hai vòng `.limit`) · `mes_dash_batches` / `mes_dash_lines` dùng `pb.prod_date BETWEEN` · `production_batch_dev_line` ghi cả dòng `ok` có `sheet<>std OR iss<>sheet` (nới CHECK; sửa khối DO 20261122 dòng 460; mọi chỗ đọc như độ lệch — `dev_lines`, pareto, exc, thẻ — thêm `state IN ('over','under','extra')`), dựng lại fact | khối DO: tổng `edit_kg` / `exec_kg` = tổng dòng của ô chi tiết · 63: sửa phiếu trong dung sai ⇒ thẻ và bảng chi tiết khớp | M |
| 5 | Một luật "tồn lấy được" + một hàm trạng thái cho `InventoryEntry` | X1 (luật 1–4), phát hiện mới 1 + 2, X2 vế 2, X5, phát hiện mới 4, X-N3a | hàm SQL `inventory_entry_status(status, remaining, imported, reserved)` cho `mes_entry_status`, `outbound_consume_exact`, `outbound_adjust_entry`, `outbound_pool_apply`, `adjust_inventory_atomic`, nhánh tồn gộp của Nhập kho · điều kiện "dòng lấy được" (trạng thái, QA giữ, trừ giữ chỗ) dùng chung cho `outbound_pool_apply`, `mes_consume_lot`, `mes_stock`, hai bước kiểm trước · `outbound_consume_exact` kiểm lại giữ chỗ dưới khoá | khối DO bảng ca trạng thái · test vitest bảng ca · luật cổng tĩnh cấm tự viết `CASE … 'EXPORTED'` · 63 / gói Xuất: nhặt lẻ giữ 20/100 rồi "Lưu thủ công" 100 ⇒ chặn | L (đụng đường nóng Xuất kho; rà staging xem có dòng `remaining < reserved` trước khi áp) |
| 6 | Giao diện MES nhỏ | F1b–d, F11, F3, F4 (+ trang Cài đặt MES), F5, F6, F7, F8, F9b, F10, trigger fact thừa | xem bảng F | ui-mobile-sweep (sơ đồ bồn 360 px) | S–M |
| 7 | Báo cáo ca + hiệu năng dài hạn | B15, N4, B13, B14, X6, X8, X10, X-N1, X9 | khoá advisory theo kho (cấp lấy khoá chia sẻ, chốt ca lấy khoá độc quyền) · keyset cho dữ liệu thô · `updateGDO` dùng `gdoCur.warehouse_id` khi body vắng · DELETE trả `fail(res, error)` (23503 → 409) · xoá kho gặp 23503 ⇒ vô hiệu hoá | 63: chốt ca trong lúc cấp · huỷ cấp xuyên ca | M |

F2 (ô số nhận dấu phẩy) sửa ở `QtyInput` dùng chung, chạm 15 màn ngoài MES, nên chờ người dùng đồng ý (câu 6).

## Câu hỏi cần người dùng chốt

1. **Cửa "Lưu thủ công / Xuất luôn" (tồn không tem) có theo luật của cửa cấp NVL vào mẻ không** (X1)? Đổi ở đây áp cho toàn app.
   - (a) Chặn hàng QA giữ.
   - (b) Trừ phần đang giữ chỗ cho nhặt lẻ. Phần này là sai số liệu, nên sửa dù chọn gì.
   - (c) Theo nguyên tắc luân chuyển của kho: kho bắt buộc thì chặn, không bắt buộc thì nhắc.
   - Khuyến nghị: cả a, b, c. Không chặn hàng hết hạn, vì luật 20/09 cho xuất huỷ.
2. **Huỷ trang Sổ đóng gói đã đóng** (X3).
   - Khuyến nghị: cho huỷ khi 0 pallet và lượng rút bồn thuần bằng 0. Còn rút bồn thì báo "sửa lượng rút về 0 trước". Gemini đồng ý.
3. **Nạp / chuyển bồn có trừ phần đã đặt cho mẻ khác không** (B6). Lúc mở mẻ thì `mes_tank_room_check` có trừ; còn `mes_tank_fill` / `mes_tank_transfer` thì chỉ trừ lượng đang chứa.
   - Khuyến nghị: chỉ chặn trộn mã BTP, phần đủ chỗ giữ theo lượng thực chứa. Lý do: dồn bồn khẩn cấp không bị kẹt bởi mẻ mới chỉ mở kế hoạch. Gemini đồng ý.
4. **Huỷ cấp NVL thuộc ca đã chốt** (N4). Hiện tồn tăng lại nhưng sổ ca đang mở lệch đúng bằng lượng hoàn.
   - Hai luồng của Gemini khuyến nghị khác nhau: một bên muốn chặn, một bên muốn ghi vào ca đang mở.
   - Khuyến nghị của Claude: vẫn cho huỷ, ghi thành dòng "Hoàn từ ca trước" của ca đang mở để sổ cân. Chặn thì cân nhầm phát hiện muộn không sửa được.
5. **Sổ pallet: người được giao kho cha có thấy phần kho chế biến không** (X7). MES đã mở kho cha xuống kho phụ (chốt 14/11); Sổ pallet và Tồn kho thì chưa.
   - Khuyến nghị: chỉ mở dòng sự kiện "Rút vào mẻ / Huỷ rút", không mở dòng tồn.
6. **Ô nhập số thập phân dùng chung (`QtyInput`)** (F2). Máy để tiếng Anh gõ "12,5" sẽ hỏng.
   - Khuyến nghị: sửa ở ô dùng chung cho cả 15 màn (Nhập, Xuất, Kiểm kê, Đóng gói…), không vá riêng màn cấp NVL.
7. **Khoá đổi đơn vị gốc của mã hàng** (X9).
   - Khuyến nghị: chặn khi mã còn tồn > 0, có mẻ mở hoặc bồn còn hàng. Áp cho toàn app.

## Bảng chi tiết sau khi bàn

Mức: NT nghiêm trọng · C cao · TB trung bình · T thấp.

### Backend MES

| Mã | Kết luận | Mức | Một dòng |
|---|---|---|---|
| B1 | Đúng | C | `listTanks` lấy mẻ OPEN `.order('created_at').limit(1000)` tăng dần, và FILL `.limit(5000)` bị PostgREST cắt ~1.000. Mẻ đã nạp vẫn OPEN mãi, nên sau ~1.000 mẻ sơ đồ bồn mất mẻ mới. Kiểm chỗ ở DB vẫn đúng. |
| B2 | Đúng một phần | T | Số gợi ý va mã mẻ huỷ cùng bồn ⇒ 409. Không kẹt: gõ số khác là qua. Luật "số mẻ huỷ dùng lại được" giữ nguyên. |
| B3 | Đúng | TB | `createBatch` nuốt lỗi áp công thức / gắn phiếu, vẫn trả 201. `updateBatch` cũng nuốt lỗi gắn phiếu. |
| B4 | Đúng | C | `updateBatch` ghi `patch` rồi mới `mes_batch_identity`. Lỗi sau đó ⇒ mẻ giữ kế hoạch / mã mới chưa kiểm. Lưu lại lần sau thì `planChanged` / `matChanged` ra false ⇒ bàn NVL không bao giờ tính lại. |
| B5 | Đúng | TB | `COALESCE(pb.prod_date, …)` trên cột NOT NULL ⇒ PG17 không dùng phần ngày của chỉ mục, quét mọi mẻ của kho ×3 mỗi lần mở dashboard. |
| B6 | Đúng | TB | `mes_tank_transfer` không xét mẻ OPEN đã đặt bồn đích (trái production.md:33). |
| B7 | Đúng | TB | Thẻ Sửa phiếu / Cấp lệch tính cả dòng `ok`; bảng chi tiết chỉ có over / under / extra ⇒ thiếu dòng. |
| B8 | Đúng | T | Sửa bồn (đơn vị, sức chứa, ngừng) không khoá, không xét mẻ đã đặt. |
| B9 | Đúng | TB / T | `getBatch` bỏ qua lỗi ⇒ 200 với `board: []`; `loadBatch` / `loadTank` ⇒ 404 oan; `inScope` ⇒ 403 oan. |
| B10 | Đúng | T | `consumeScan` kiểm luân chuyển trước kiểm kho / trạng thái ⇒ sai mã lỗi (DB vẫn chặn). |
| B11 | Đúng | T | `nextCode` / `pourScan` không kiểm bồn thuộc kho cha ⇒ lộ mã bồn (cần biết UUID). |
| B12 | Đúng | T | `confirmProcessLog` xác nhận được phiếu của mẻ đã huỷ. Sửa: chặn CANCELLED + CAS `.is('blocks', null)`. |
| B13 | Đúng một phần | T | `mes_batch_page` không lọc ngày thì tính cổng cho mọi mẻ; FE mặc định 14 ngày. Chưa đo. |
| B14 | Đúng (thiết kế) | T–TB | Dữ liệu thô dựng lại cả tập + OFFSET mỗi trang. Chưa đo. |
| B15 | Đúng (lý thuyết) | T | Chốt ca lúc đang cấp: lần cấp commit sau thời điểm chụp không vào ca nào. |
| B16 | **Sai** | — | Đã có `idx_ie_wh_mat_rem (warehouse_id, material_id)`. |
| N1 (Claude) | Đúng | TB | Luồng chặt chỉ kiểm ở `consumeGateError`. Đọc Warehouse lỗi ⇒ cho cấp; QA bỏ duyệt đúng lúc ⇒ lọt. Hai hàm cấp trong DB không kiểm. |
| N4 (Claude) | Đúng | cần chốt | Huỷ cấp thuộc ca đã chốt ⇒ sổ ca đang mở lệch (câu 4). |
| G1 (Gemini vòng 2) | Đúng | T–TB | `qaGateOfTank` nuốt lỗi ⇒ trả `'WARN'` ⇒ lọt rút bồn chưa QA thả dù cấu hình BLOCK; tính trước khoá bồn. |
| G2 (Gemini vòng 2) | Đúng | T | `mes_batch_set_requirements` / `apply_recipe` / `requirements_refresh` không kiểm `qa_ok_at` trong giao dịch (đua với QA duyệt). |
| G3 (Gemini vòng 2) | Đúng | T | `approveStep` bỏ duyệt QA: đếm `tank_movement` bỏ qua `error` ⇒ lỗi = cho bỏ duyệt dù đã nạp. |
| Cải tiến | | | Trigger mức câu lệnh: ít giá trị (bỏ). `round3` + Zod chặn số về 0: nhỏ, nên làm. `first_filled_at` + chỉ mục một phần: cách bền cho B1. `.limit(10)` phiếu theo dõi: nâng. Keyset dữ liệu thô: cùng B14. |

### Giao diện MES

| Mã | Kết luận | Mức | Một dòng |
|---|---|---|---|
| F1a | **Sai** | — | Mọi hàm ghi phiếu đều chạm `production_batch.updated_at`. |
| F1b | Đúng | T–TB | `batch_process_log` thiếu `['prod-batches']` ⇒ cột Tình trạng ở máy khác đứng im. Sửa một dòng trong map. |
| F1c | Đúng | T | Đổi mẫu phiếu không làm mới mẻ / bồn. |
| F1d | Đúng một phần | T | Map `Warehouse` + hook cài đặt thiếu `prod-batches`, `prod-cycle`, `prod-dash`… (`prod-dash-detail` không cần). |
| F1e | Sai (lõi) | — | Bảng nguồn đã map đủ. Gemini giữ ý "thêm key ở `onSettled` để phòng khi realtime rớt": rẻ, làm cũng được. |
| F2 | Đúng một phần | TB | `QtyInput` nhánh không đơn vị nhập dùng `type="number"` + `parseFloat`; máy để ngôn ngữ không nhận dấu phẩy thì hỏng. Sửa ở `QtyInput` chung (câu 6). |
| F3 | Đúng | T | Ô giờ chạm đúp ⇒ băng đỏ giả (thêm khoá `isPending`). Quét: dùng bộ đếm để lần mới nhất thắng, KHÔNG chặn súng (luật "bắn tem khác là thay"). |
| F4 | Đúng | T–TB | Tab Đếm tồn theo ca và trang Cài đặt MES giữ kho bằng state riêng. |
| F5 | Đúng | TB | Sổ bồn chỉ xem 200 dòng mới nhất, không sang trang; lỗi hiện "Chưa có thao tác nào". |
| F6 | Đúng | T | Đi sâu từ kỳ Tự chọn ⇒ nút "Quay lại " mất nhãn (`kind` → `baseKind`). |
| F7 | Đúng | T | Lỗi tải danh sách ca / công thức không hiện băng đỏ. |
| F8 | Đúng | T | Cài đặt MES mất bản nháp khi realtime làm mới. |
| F9 | Đúng | T | Lưu mẻ hai API nối nhau (gộp vào Đợt 2) · Enter ở ô Lượng nạp bỏ qua điều kiện chặn. |
| F10 | Đúng | T | 360 px: bật cả bản đồ thu nhỏ và chú giải thì đè nhau. |
| F11 | Đúng một phần | T | Chỉ `warehouse_type_configs` thiếu trigger realtime. |
| F12 | Chưa đo | T | Ước ~250 dòng / chu kỳ tuần, ổn. |
| F13 | **Sai** | — | SQL và TS cùng ngưỡng; đã có test `mesLineStateCases.json`. |
| Cải tiến 4 | **Sai** | — | Sheet đổ bồn chứa cả nút Nạp cho `tank_ops` — cố ý. |
| Mới (Claude) | Đúng | T | `production_batch_fact` / `dev_line` có trigger realtime nhưng không map ⇒ tín hiệu thừa. |

### Chỗ MES chạm module khác

Bối cảnh staging: CBBV đang chế độ QR, NVL đều có tem, 0 dòng tồn gộp ⇒ cửa Xuất kho trừ NVL thực tế là cửa quét tem, đã khớp MES ở QA và luân chuyển. Nếu kho chế biến chạy QTY / QTY_DATE thì X1 lên Cao.

| Mã | Kết luận | Mức | Một dòng |
|---|---|---|---|
| X1 luật 1 | Đúng ở cửa tồn gộp | TB | `outbound_pool_apply` không lọc QA giữ (cửa quét đã chặn). |
| X1 luật 2 | Đúng | C | Không trừ giữ chỗ — xem mới 1. |
| X1 luật 3 | Đúng một phần | T | Thực tế chỉ khác `LOOSE_PICKING`; `pool_apply` ghi đè trạng thái đó. |
| X1 luật 4 | Đúng ở cửa tồn gộp | TB | Xếp cố định theo NSX / còn nhiều nhất; `manualCompleteItem` không có `rotationGate`. |
| X1 luật 5 | **Sai** | — | Luật đã chốt (production.md:201): Xuất kho được xuất hàng hết hạn. |
| X2 vế 1 | Đúng | T | Lọc theo kho của ô (chặt hơn, staging 0 dòng lệch). |
| X2 vế 2 | Đúng | T–TB | `outbound_consume_exact` không kiểm giữ chỗ dưới khoá. Gemini xếp TB–C; Claude xếp T–TB vì `scanItem` đã trừ giữ chỗ ở bước kiểm trước, chỉ lọt khi đua. Sửa chung Đợt 5. |
| X3 | Đúng | C | Huỷ trang sổ đã đóng có rút bồn ⇒ bồn hụt vĩnh viễn, gia phả còn trang đã huỷ. |
| X4 | Đúng | TB | Sửa tăng lượng rút không chặn trộn mã khi bồn đã đổi BTP (lệch production.md:235). |
| X5 | Đúng | TB | Sửa / xoá phiếu nhập trỏ dòng tồn gộp không tính lại trạng thái ⇒ hàng bổ sung "tàng hình" với MES. Khi sửa coi chừng `uq_inventory_active_wh_pallet` (23505). |
| X6 | Đúng | T–TB | `updateGDO` truyền `warehouse_id ?? null` ⇒ lọt quỹ đạo kho phụ qua API, và chặn oan chiều kho cha → kho phụ. |
| X7 | Luật | cần chốt | Sổ pallet cắt theo kho được giao (câu 5). |
| X8 | Đúng | T | Xoá dòng nhập từng cấp vào mẻ ⇒ 500 thay vì 409. |
| X9 | Đúng một phần | T | Đổi đơn vị gốc mã BTP đang dùng: có hại (câu 7). Tắt cờ BTP không làm kẹt nạp bồn (sai). |
| X10 | Đúng | T | Xoá kho chỉ đếm Location / ProductionImport, có 29 FK ⇒ 500. |
| X-N1 | Đúng một phần | T | Excel / KHVC không gọi `internalOrbitError`. |
| X-N2 | **Sai** | — | Đổi cấu hình kho ⇒ lỗi nổ rõ, mã lô cũ đã lưu. |
| X-N3 | a đúng (ngoài MES) · b đúng · c **sai** | T | a: `adjust_inventory_atomic` không so giữ chỗ · b: dữ liệu thô NSX bản chụp đi với HSD mới · c: không ai đọc `parent_pallet_code`. |
| Mới 1 (Claude) | Đúng | C | **Xuất lố không ai biết**: nhặt lẻ giữ 20/100 → chuyến khác "Lưu thủ công" 100 (không trừ giữ chỗ) → xác nhận nhặt lẻ, `outbound_adjust_entry` kẹp `GREATEST(0, …)` ⇒ tồn 0, thực tế đã ra 120. POSM đi đường này hằng ngày. |
| Mới 2 (Claude + Gemini) | Đúng | TB | 6 chỗ tự tính `InventoryEntry.status` khác nhau. |
| Mới 3 (Claude) | Đúng | — | Gói 63 thiếu phép kiểm so hai cửa (MES_PHASE1_PLAN.md:87 đã hứa). |
| Mới 4 (Claude) | Đúng | TB | `removeEntry` nhánh tồn gộp xoá dòng khi `newImported <= 0` dù còn dư ⇒ mất tồn + `InventoryAdjustmentLog` (CASCADE). Gemini thêm: `updateEntry` không chặn `imported + delta < 0`. |

## Gemini sai hoặc thổi mức ở đâu

- **Sai hẳn:** B16, F1a, F13, X1 luật 5, ý "tắt cờ BTP làm kẹt nạp bồn", X-N2, X-N3c, cải tiến "trigger mức câu lệnh", cải tiến "tách quyền đổ bồn".
- **Ở vòng 2:**
  - Kế hoạch backend gắn nhầm vài mã (B5, B10, B11, B12 ghi thành việc khác); bảng trên đã sửa lại.
  - Nói "MES ghi đè trạng thái nhặt lẻ". Sai: `mes_consume_scan` / `mes_consume_lot` chỉ lấy dòng `IN_STOCK` / `PARTIAL`.
  - Nói "kiểm chỗ ở DB chỉ trừ lượng đang chứa". Đúng với nạp / chuyển bồn, sai với lúc mở mẻ.
- **Thổi mức:**
  - B1: Nghiêm trọng → Cao.
  - B2: "kẹt vĩnh viễn" → Thấp.
  - F2: Cao → TB.
  - F11: Cao → Thấp.
  - X1: Nghiêm trọng → TB (theo cấu hình CBBV hiện tại).
