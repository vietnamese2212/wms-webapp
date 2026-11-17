# Sản xuất — MES giai đoạn 1 (`production`)

> Tạo 14/11/2026 cùng giai đoạn 1 MES (kế hoạch `docs/plans/MES_PHASE1_PLAN.md`, memory `mes-phase1-design-2026-11-14`).
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Mẻ chế biến (bàn làm việc của mẻ) · Bồn · Báo cáo NVL · Định mức · Cài đặt MES — nhóm menu CẤP 1 "Sản xuất (MES)" đứng TRÊN Kho (WMS) (user chốt 14/11 tối: "cho MES lên phía trên của WMS") (user chốt 14/11 "tách MES riêng": chỉ tách menu, vẫn chung app + chung DB; Sổ đóng gói giữ ở Kho (WMS) → Nhập hàng; đường dẫn `/wms/production…` không đổi)

**Quyền (BE `ALL_PERMISSIONS`):** view · open_batch · consume · reverse · qa_release · manage_tank · tank_ops · export · configure · manage_recipe · shift_report · process_log · edit_requirement · approve_lead · approve_qa · print_label · pour · approve_expired

## Giao thoa với
<!-- giao-thoa:start -->
- [`inventory`](inventory.md) — Tồn kho (rút NVL vào mẻ TRỪ tồn kho chế biến; sổ pallet có nguồn 10 "Rút vào mẻ")
- [`packing`](packing.md) — Sổ đóng gói (trang sổ gắn bồn, đóng trang khai lượng rút — một giao dịch)
- [`traceability`](traceability.md) — Truy xuất lô (gia phả sản xuất: NVL → mẻ → bồn → trang sổ → pallet TP)
- [`outbound`](outbound.md) — Xuất kho ("xuất tiêu hao" ở kho phụ cũng trừ tồn kho chế biến — hai cửa cùng một sổ)
- [`wms_settings`](wms_settings.md) — Cài đặt WMS (chữ nhà máy trong mã lô = "Mã NMSX" của kho chế biến, trống thì của kho cha; kho chế biến = kho phụ nội bộ; cột `production_qa_gate` nằm ở Kho / Loại kho nhưng CỬA GHI là Cài đặt MES — cửa Loại kho của Cài đặt WMS không được đè)
- [`pallet_print`](pallet_print.md) — In tem pallet (tem pallet CỦA MẺ dùng chung khổ tem 1/4 A4 + CSS in `PALLET_PRINT_CSS` + `QRImg` của `components/shared/palletLabel.tsx`; QR tiền tố `MEB;` để không lẫn tem pallet nhập kho)
- [`materials`](materials.md) — Mã hàng (`tank_hold_hours` hạn lưu bồn — sửa ở Cài đặt MES, form Mã hàng chỉ hiển thị; `batch_prefix` làm tiền tố mã lô gợi ý)
<!-- giao-thoa:end -->

## LUỒNG LÀM VIỆC CỦA MẺ (17/11 đêm — user chốt 10 điểm; migration `20261117b_mes_workflow`)

**Đọc mục này trước — nó THAY các luật cũ: "mã lô app gợi ý, sửa được" và "QA thả / giữ / loại ở trang mẻ".**

Luồng: **trưởng ca** tạo mẻ + duyệt → **QA** duyệt → **công nhân trộn** quét tem QR nguyên liệu để cấp → **QA** bấm các mốc trên phiếu → **QA** in tem pallet của mẻ → **công nhân đổ bồn** khai chu kỳ · số mẻ · bồn đang đứng, quét tem khớp mới đổ → **Nạp bồn** → **QA đạt / không đạt ở BỒN**.

| Tình huống | Kết quả |
|---|---|
| Tạo mẻ thiếu chu kỳ / bồn | 400 — chu kỳ (1–6 chữ số), bồn bắt buộc; số mẻ trống ⇒ số kế tiếp của chu kỳ (1–9999) |
| Mã lô | Không gõ tay. `<chữ nhà máy><chu kỳ><số mẻ 4 số><mã bồn>` (vd `B300001BD62`) — hàm `mes_batch_code`; chữ nhà máy = `Warehouse.nmsx_code` của kho chế biến, trống thì của kho cha; cả hai trống ⇒ 422 `MES_NO_PLANT` |
| Hai mẻ cùng chu kỳ cùng số | 409 `BATCH_NO_DUP` (chỉ mục duy nhất `(warehouse_id, cycle, batch_no)` trừ mẻ đã huỷ); mã lô trùng mẻ ĐÃ HUỶ ⇒ 409 `MES_CODE_USED` |
| Bồn đang chứa / đã đặt cho mã BTP khác | 409 `MES_MIX_MATERIAL` ngay lúc tạo mẻ / đổi bồn |
| Kế hoạch > chỗ trống của bồn | 409 `MES_OVER_CAPACITY`. Chỗ trống = sức chứa − đang chứa − Σ (kế hoạch − đã nạp) của các mẻ ĐANG MỞ khác đã đặt bồn đó (`mes_tank_room_check`, gọi sau khi khoá dòng bồn). Sửa kế hoạch cũng kiểm lại |
| Đổi chu kỳ / số mẻ / bồn TRƯỚC khi nạp | Được (`mes_batch_identity`): mã lô ghép lại; tem đã in mất hiệu lực (`label_ver` +1, `label_at` = null), PATCH trả `relabel: true`, trang mẻ hiện băng "in lại tem" |
| Đổi bồn SAU khi nạp | 409 `MES_FILLED` — mã lô đứng yên; đưa sang bồn khác = Chuyển bồn ở trang Bồn |
| Nạp mẻ vào bồn khác bồn đã đặt | 409 `MES_WRONG_TANK` (luôn áp, không cần cờ) |
| QA đạt / không đạt | Bấm ở BỒN: `POST /tanks/:id/qa` (`mes_tank_qa`, quyền `qa_release`) ghi `production_batch.qa_status` của MỌI mẻ đang có lô trong bồn. Mẻ mới nạp thêm mang HOLD ⇒ bồn về "chờ QA". Bồn trống ⇒ 409 `MES_TANK_EMPTY`; không đạt thiếu lý do ⇒ 422. Cửa `POST /batches/:id/qa` ĐÃ GỠ. Luật "lô QA loại luôn chặn rút đóng gói" + công tắc lô chờ QA giữ nguyên |
| Hai bước duyệt | `approve-lead` (quyền `approve_lead`) rồi `approve-qa` (`approve_qa`). QA duyệt cần trưởng ca đã duyệt; trưởng ca bỏ duyệt cần QA chưa duyệt; QA bỏ duyệt chỉ khi mẻ chưa nạp bồn. Trưởng ca duyệt cần phiếu có ít nhất một nguyên liệu |
| QA đã duyệt mà sửa định mức / kế hoạch / mã / đổi công thức | 409 `MES_APPROVED` — bỏ duyệt rồi mới sửa (áp cho mọi kho, vì chỉ xảy ra khi đã có người duyệt) |
| Tem pallet của mẻ | `POST /batches/:id/labels {count}` (quyền `print_label`): QR `MEB;<mã lô>;<i>;<n>;<bản tem>` (`utils/batchLabel.ts`, có test). Cùng số pallet + tem còn hiệu lực = in lại; đổi số pallet = bản tem mới, tem cũ bị từ chối. Đã nạp bồn thì không đổi số pallet. App KHÔNG ghi nguyên liệu nào nằm trên pallet nào |
| Đổ bồn | `GET /pour-status?warehouse_id&tank_id&cycle&batch_no`: khai sai bồn ⇒ 409 `MES_WRONG_TANK` nói đúng bồn phải đổ. `POST /pour-scan` (quyền `pour`, `mes_pour_scan`, bảng `batch_pour_scan`): tem nguyên liệu ⇒ 422 `NOT_BATCH_LABEL`; tem mẻ khác ⇒ `MES_WRONG_LABEL`; tem bản cũ ⇒ `MES_LABEL_VOID`; quét lại ⇒ `MES_ALREADY` |
| Phiếu: bấm mốc giờ | `POST …/process-log/:form/stamp {key}` (`mes_log_stamp`): ghi HH:MM giờ VN của MÁY CHỦ + người bấm vào `batch_process_log.stamps`; bấm lần hai ⇒ 409 `MES_ALREADY`; sửa giờ tại phiếu (PUT) giữ vết `edited_by` / `edited_at` |
| Ô "bắt buộc" của mẫu phiếu | Cờ `required` trên ô (Cài đặt MES → Mẫu phiếu → ⋯ "Bắt buộc ghi trước khi nạp bồn"). Kiểm trên các phiếu mẻ ĐÃ MỞ; mẻ chưa mở phiếu nào mà có mẫu đang dùng mang ô bắt buộc ⇒ "Chưa ghi phiếu theo dõi" |

**Cờ `Warehouse.mes_flow_gate`** (Cài đặt MES → "Luồng làm việc của mẻ" → "Chặn theo từng bước"; mặc định TẮT = như trước; staging bật cho Chế biến Ba Vì). Chỉ cờ này gác HAI chỗ chặn:
- **cấp nguyên liệu** khi chưa đủ hai duyệt ⇒ 409 `MES_NOT_APPROVED` — `consumeGateError` dùng ở CẢ HAI cửa cấp (quét tem · chọn lô);
- **nạp bồn** ⇒ 409 `MES_NOT_READY` kèm danh sách còn thiếu: hai duyệt · nguyên liệu dưới cận dưới mức lệch (cấp vượt vẫn chỉ tô đỏ) · ô bắt buộc · chưa in tem · chưa quét đủ n/n tem tại đúng bồn.
Một hàm `mes_batch_gate(batch_id)` cho cả màn hình (`getBatch` trả `gate`) lẫn hàm nạp bồn — đừng tự tính điều kiện ở chỗ khác. Mã lô mới, chu kỳ / số mẻ / bồn bắt buộc, QA ở bồn, đúng bồn mới nạp: áp cho MỌI kho, không cần cờ.

**Màn hình:**
- Form Mở / Sửa mẻ (`BatchFormSheet`): Chu kỳ · Số mẻ (gợi ý) · Bồn (in chỗ trống từng bồn) · ô Mã lô chỉ đọc; kế hoạch vượt chỗ ⇒ đỏ tại ô.
- Trang mẻ: dải 8 bước `FlowStrip` (chỉ hiện khi kho bật cờ); **nút chính = đúng bước đang tới** (bước trước xong mới tới bước sau), các việc khác vào ⋮. **Dải chỉ để XEM, ai cũng thấy đủ 8 bước** (18/11 — user hỏi "có nên cho họ thấy không": thấy để biết mẻ đang ở đâu, đang chờ ai); mọi thao tác ở nút đầu trang, nút chỉ hiện cho chức danh có quyền của bước đó. Bước đang tới KHÔNG phải việc của người xem (thiếu quyền: duyệt trưởng ca `approve_lead` · QA duyệt `approve_qa` · cấp `consume` · ghi phiếu `process_log` · in tem `print_label` · đổ bồn `pour`/`tank_ops` · nạp `tank_ops` · QA bồn `qa_release`) ⇒ chip nền nhạt + đồng hồ cát + **"Chờ …"** đứng đầu nhãn (điện thoại cắt đuôi nhãn). "Tới bồn" chỉ hiện cho người có `qa_release`; "Nạp bồn" KHOÁ kèm lý do (`gate.fill_blockers`) khi cổng của mẻ chưa cho nạp — trước đây mở được form rồi mới thấy bị chặn. Bồn trên header bấm được để đổi. Nhãn QA chỉ hiện. Thẻ phiếu: dấu hiệu Chưa ghi / Đang ghi / Đã ghi đủ / QA đã xác nhận (màu viền), MỘT nút mốc kế tiếp (`formProgress` ở `config/processForms.ts`: mốc = các ô kiểu Giờ của nhóm ô, theo thứ tự mẫu), nút "Mở phiếu" để xem / sửa.
- `components/wms/production/BatchFlow.tsx`: `BatchLabelSheet` (in tem 1/4 A4: QR + mã lô + ô lớn Chu kỳ / Mẻ / Bồn / Pallet i/n; vùng in vẽ qua `PrintArea` vào `<body>` và mở hộp in khi ảnh QR vẽ xong — 18/11 bản in từng lệch phải, cắt cột tem, mất trang 2 vì vùng in nằm trong khung trượt, C120) · `PourSheet` (khai bồn · chu kỳ · số mẻ → quét bằng súng / camera / gõ; sai thì băng đỏ; đủ thì Nạp bồn) · `TankQaSheet`.
- Trang Bồn: mặc định **SƠ ĐỒ BỒN 2D** (`TankMimic`, nút đổi sang Bảng; nhớ ở `useWmsFilterStore.productionTanks.view`). Theo lối màn hình điều khiển nhà máy: thân bồn trung tính, mực tỷ lệ đúng sức chứa, thang chia 25 / 50 / 75 / 100 %, mỗi mẻ một lớp, màu chỉ nói tình trạng (QA đạt xanh · chờ QA vàng · không đạt / quá hạn lưu đỏ), phần gạch chéo = mẻ đã đặt bồn mà chưa nạp. Realtime qua `production_tank` / `production_batch` (mọi hàm ghi đều chạm `production_tank.updated_at`). `GET /tanks` trả thêm `incoming` · `reserved` · `qa_state`.

**Staging (17/11):** dữ liệu cũ của Chế biến Ba Vì đã xoá theo lệnh user; kho chuyển sang chế độ QR + bật cờ; 20 pallet tồn thử đều có tem (dạng `ddmmyy_mãhàng_1_N_stt_B`, ghi chú "Demo MES — tồn thử có tem QR (17/11)"); bốn chức danh thử `jt-mes-lead` · `jt-mes-qa` · `jt-mes-mixer` · `jt-mes-pour`.

## PHIẾU BỔ SUNG theo mã bán thành phẩm (17/11 — migration `20261117c_mes_extra_forms`)

User: *"BTP dịch thạch chính là 1 phiếu bổ sung thêm của các BTP có tính chất liên quan tới thạch, nếu không có thì bỏ đi. Khi tạo mẻ cũng có thể chỉnh … có thể thêm vào bởi trưởng ca, QA trong chức năng sửa."*

- `production_process_form.optional` = phiếu **bổ sung** (chỉ có ở mẻ được chọn); tắt = phiếu thường, mẻ nào cũng có (MIX). JELLY bật sẵn.
- `production_process_form.material_ids` = mã BTP **mặc định** có phiếu bổ sung đó (Cài đặt MES → Mẫu phiếu → công tắc "Phiếu bổ sung" + chọn mã; chỉ nhận mã có cờ Bán thành phẩm).
- `production_batch.extra_forms` = phiếu bổ sung của MẺ. Một hàm đặt: `mes_batch_set_forms` (mở mẻ · đổi mã BTP · thêm / bớt). Một hàm cho mọi cửa ghi phiếu: `mes_batch_form_error` (PUT phiếu + bấm giờ `mes_log_stamp`). Cổng nạp bồn chỉ đòi phiếu CỦA MẺ. FE: `formsOfBatch` / `defaultExtraForms` (`config/processForms.ts`, cùng luật với `mes_default_forms`).

| Tình huống | Kết quả |
|---|---|
| Mở mẻ mã BTP có trong danh sách mặc định của phiếu bổ sung | Phiếu tick sẵn ở form; mẻ có phiếu đó |
| Mở mẻ mã BTP KHÔNG có trong danh sách | Phiếu không tick; trang mẻ không hiện thẻ phiếu đó |
| Người mở tick / bỏ tick ở form | Theo lựa chọn (gửi `extra_forms`; vắng = mặc định theo mã) |
| Trưởng ca / QA thêm phiếu trên trang mẻ | Nút "Thêm phiếu …" dưới các thẻ phiếu — `PUT /batches/:id/forms` (quyền `open_batch` hoặc `approve_lead` hoặc `approve_qa`); trưởng ca còn chỉnh được trong form Sửa mẻ |
| Bỏ phiếu bổ sung chưa ghi | Được (nút "Bỏ" trên thẻ, hỏi xác nhận) |
| Bỏ phiếu bổ sung ĐÃ ghi | 409 `MES_FORM_HAS_LOG` — dữ liệu của lô; ô tick trong form Sửa mẻ khoá |
| Ghi / bấm giờ phiếu bổ sung mà mẻ chưa có | 409 `MES_FORM_NOT_ON_BATCH` |
| Thêm phiếu thường (MIX) hoặc phiếu lạ vào danh sách bổ sung | 422 `MES_FORM_INVALID` |
| Đổi mã BTP của mẻ | Phiếu bổ sung về mặc định của mã mới; phiếu đã ghi giữ nguyên |
| Mẻ không còn mở | 409 `MES_BATCH_STATUS` — không đổi phiếu |

Gói QA 63 mục [13x1–13x3]. Mẻ cũ có phiếu bổ sung đã ghi được migration giữ phiếu đó trên mẻ.

## CẤP NVL = MỘT LOẠI XUẤT (17/11 — migration `20261117d_mes_consume_rotation`)

User: *"Khi quét tem trong Mẻ thì cũng phải có các chức năng như bên xuất hàng — xem được tồn kho hàng đang ở đâu, date là gì, tình hình FIFO đã phù hợp chưa. Bản chất nó cũng là 1 loại xuất hàng thôi mà?"*

**Một luật với quét xuất:** nguyên tắc FEFO / FIFO / LIFO + "bắt buộc" lấy theo cấu hình 2 tầng Kho → Loại kho (`rotationConfigOf`), khoá xếp `rotationSortKey`, vi phạm `isRotationViolation`, pallet so được `isPickEligible`, lý do vượt rào `ROTATION_REASONS`, quyền `outbound.rotation_override` (một năng lực "được lấy khác thứ tự"). Khác duy nhất: **tập so sánh** = tồn của KHO CHẾ BIẾN theo cột `warehouse_id`, trạng thái IN_STOCK / PARTIAL (đúng tập `mes_consume_scan` cho rút) — pallet kho chế biến thường chưa xếp ô. Code: `mesPickContext` · `mesRotationCheck` (`productionController.ts`). Bản nhắc FEFO tự tính ở màn hình (chỉ biết HSD ghi trên tem) đã gỡ.

| Tình huống | Kết quả |
|---|---|
| Mở cấp một nguyên liệu (nút "Cấp …" trên bàn của mẻ) | Bảng **Lấy ở đâu** (`GET /batches/:id/pick-list?material_id=`) **GOM THEO DATE** như "Tồn kho theo %Date" của Xuất kho (sửa 17/11 khuya — user: "1 mã có 200 pallet thì có 200 dòng ư?"): mỗi dòng một nhóm = ngày luân chuyển · vị trí · tình trạng; cột # · {HSD / NSX} (hạng gộp vào ô ngày) · %Date · Vị trí · Còn (ĐVT in một lần ở nhãn cột) · ▸; bấm ▸ thấy từng tem, bấm mã tem mở chi tiết pallet. Hạng 1★ = lấy trước, tính CHUNG cả có tem lẫn không tem; nhóm hết hạn chưa duyệt và nhóm QA giữ xuống cuối, không xếp hạng |
| Kính lúp cột Tồn kho trên bàn của mẻ | Hộp "Tồn kho chế biến theo %Date" — cùng bảng nhóm, hai phần Có tem / Không có tem (như kính lúp cột Kho của Xuất kho) |
| Dòng của bàn đã có lần cấp (18/11 — user: "expand sau khi quét xong tương tự bên xuất") | Dưới tên nguyên liệu: **▸ n tem · m lô** (đếm tem / lô khác nhau); bấm mở **từng tem / lô đã cấp** — cùng khuôn "pallet đã quét" của Xuất kho: Tem / lô · Lượng (ĐVT ở nhãn cột) · **%Date lúc cấp** · NSX · HSD · **Date cũ nhất** (hàng nên lấy trước lúc cấp). Tem sai thứ tự: mã đỏ + "⚠ Date cũ nhất"; hàng hết hạn đã duyệt: HSD đỏ "QA duyệt". %Date và HSD do server tính ở `GET /batches/:id` (`consumption[].pct_date` theo giờ ghi dòng, cùng `computePctDate` của "Lấy ở đâu"; `expiry_date` = `expiry_calc`). Điện thoại: mỗi tem hai dòng. Component `ConsumedTems` |
| Quét tem | Dòng tem thêm %Date; băng **Đúng thứ tự** (xanh) hoặc **Sai thứ tự** chỉ đúng tem phải dùng trước + ô của nó |
| Sai thứ tự, kho / loại kho KHÔNG bắt buộc (Chế biến Ba Vì hôm nay: FEFO, không bắt buộc) | Băng vàng, vẫn cấp được — đúng quyết định 14/11 "nhắc thôi"; dòng cấp ghi `rotation_violation = true`, nhật ký cấp NVL hiện nhãn "Sai thứ tự" |
| Sai thứ tự, kho BẮT BUỘC, người có quyền `outbound.rotation_override` | Chọn lý do trong danh sách (pallet bị chắn / hỏng / …) rồi mới cấp; lý do lưu ở `rotation_override_reason` |
| Sai thứ tự, kho BẮT BUỘC, người KHÔNG có quyền | Băng đỏ "Cần người có quyền duyệt lấy khác thứ tự", nút Xác nhận khoá; gọi thẳng API ⇒ 422 `ROTATION_VIOLATION` |
| Thiếu lý do khi kho bắt buộc | 422 `ROTATION_REASON_REQUIRED` |
| Hàng hết hạn | **CHẶN, cho qua khi QA duyệt** (user chốt 17/11) — xem mục dưới |
| "Không có tem" (chọn lô) | **CÙNG khuôn và CÙNG luật** với quét tem (17/11 — user: "đồng bộ luôn phần không có tem"): bảng lô gom theo LÔ (NSX + mã lô) có hạng · HSD · %Date · Vị trí · Còn · ▸ (mở thấy từng dòng tồn: vị trí · ngày nhập); chọn sẵn lô hạng nhỏ nhất; chọn lô sai thứ tự ⇒ băng vàng / đỏ như quét tem; kho bắt buộc ⇒ lý do + quyền, dòng cấp LOT ghi đủ vết luân chuyển. Trước đó cửa này chỉ có câu nhắc tự so ở màn hình — hai cửa cùng một sổ khác luật (C20 LẶP) |

Sổ cấp: `batch_consumption` + `rotation_violation` · `rotation_principle` · `rotation_best_date` · `rotation_override_reason` (cùng bộ cột `OutboundScanEntry`) — CẢ hai cửa `mes_consume_scan` / `mes_consume_lot`. Chặn "bắt buộc" một hàm `rotationGate` cho cả hai cửa. Hàng nên lấy trước là hàng KHÔNG tem ⇒ form quét tem nhắc "cấp ở 'Không có tem'". Gói QA 63 mục [2r1–2r4] · [2g1–2g2] · [2l1].

## NVL HẾT HẠN — CHẶN, CHO QUA KHI QA DUYỆT (17/11 khuya — migration `20261117e_mes_expiry_qa`)

User chốt: *"Chặn và cho qua khi QA duyệt"*. Chỉ áp ở HAI cửa cấp NVL vào mẻ. **Xuất kho không đổi** (user chốt 20/09 cho xuất hàng hết hạn — xuất huỷ), kể cả "xuất tiêu hao" ở kho chế biến.

- **Hết hạn** = HSD hiệu lực `InventoryEntry.expiry_calc` (trigger `inventory_expiry_calc`: HSD trên tem → NSX + hạn dùng của lô / NCC / mã) **< hôm nay giờ VN** (`mes_vn_today()`). Ngày HSD còn dùng được. Không biết HSD ⇒ không chặn.
- **Duyệt theo TỪNG MẺ, TỪNG TEM (entry) hoặc TỪNG LÔ không tem** — sổ `mes_expiry_approval`, một dòng / (mẻ, đối tượng) — khoá `E:<entry>` hoặc `L:<mã>|<NSX>|<mã lô>` (`mes_lot_subject`).
- Cửa ghi `mes_consume_scan` / `mes_consume_lot` tự kiểm trong CÙNG giao dịch trừ tồn, ghi id dòng duyệt lên `batch_consumption.expiry_approval_id`.
- Quyền `production.approve_expired` — CHỈ chức danh QA: Nhân viên QA NVL · Nhân viên QA TP · QA Manager · QA chế biến (user 18/11 "Bỏ" ở Quản lý kho NPP / site / toàn quốc — migration `20261118_mes_expiry_perm_qa_only`; gói 63 [2e7] gác). Duyệt vẫn theo TỪNG MẺ (user 18/11: "duyệt từng mẻ đi, tính sau"); không thêm thông báo chuông cho QA (user 18/11: "ko cần").

| Tình huống | Kết quả |
|---|---|
| Quét tem / chọn lô HẾT HẠN, chưa có QA duyệt cho mẻ này | Băng đỏ "Tem / Lô này đã hết hạn (HSD …, quá N ngày) — chỉ cấp vào mẻ khi QA duyệt" + nút **Gửi QA duyệt**; nút Xác nhận cấp khoá; gọi thẳng API ⇒ 422 `MES_EXPIRED` |
| Bấm "Gửi QA duyệt" (`POST /batches/:id/expiry-approvals`, quyền consume) | Dòng duyệt CHỜ; băng đổi "Đã gửi QA duyệt — chờ QA"; vẫn 422 `MES_EXPIRED` tới khi duyệt |
| QA mở trang mẻ | Mục **"NVL hết hạn — QA duyệt cho mẻ này · n chờ duyệt"** dưới tiêu đề Nguyên liệu: tem / lô · HSD · người gửi · lúc gửi; ô căn cứ + **Duyệt cho dùng** / **Từ chối** (`POST /batches/:id/expiry-approvals/decide`, quyền `approve_expired`, căn cứ BẮT BUỘC) |
| QA duyệt | Form của người cấp (đang mở) tự mở khoá (realtime `mes_expiry_approval`) — băng xanh "QA … đã duyệt cho mẻ này: <căn cứ>"; hàng đó vào lại thứ tự (FEFO ⇒ thường hạng 1); dòng cấp mang nhãn **"Hết hạn · QA duyệt"** trong nhật ký |
| QA từ chối | Cấp ⇒ 422 `MES_EXPIRED_REJECTED`; người cấp gửi lại được (về CHỜ) |
| QA đứng tại bàn (người có cả consume lẫn approve_expired) | Ô căn cứ + nút "QA duyệt cho dùng" / "Từ chối" ngay trong form cấp — chưa có yêu cầu vẫn duyệt thẳng được |
| Người không có quyền gọi API duyệt | 403 |
| Gửi / duyệt hàng CÒN hạn | 422 `MES_NOT_EXPIRED` |
| "Lấy ở đâu" | Nhóm hết hạn chưa duyệt nhãn đỏ "Hết hạn", KHÔNG xếp hạng (FEFO không bắt lấy hàng hết hạn trước); đã duyệt ⇒ vào lại thứ tự, ghi "hết hạn · QA đã duyệt" |

Code: migration `20261117e` (`mes_expiry_subject` · `mes_expiry_request` · `mes_expiry_decide` · cổng trong `mes_consume_scan` / `mes_consume_lot`); `productionController.ts` (`mesPickContext` đọc sổ duyệt của mẻ · `expiryView` · `expiryRequest` / `expiryDecide`); FE `ConsumeSheet` (`ExpiryLine`) · `ProductionBatchDetail` (`ExpiryApprovalsBlock`) · `MesStockGroups`. Gói QA 63 [2e1–2e6] · [14c]. Chưa có: thông báo đẩy cho QA khi có yêu cầu mới (QA thấy ở trang mẻ).

## Trang / nghiệp vụ

Nhà máy sữa: NVL → **mẻ chế biến** → bán thành phẩm (BTP) trong **bồn** → **Sổ đóng gói** → pallet thành phẩm. User chốt 14/11: thiết kế trước khi có kết quả phiếu khảo sát; giai đoạn 1 = nối lô + tồn theo bồn; rút NVL = quét tem HOẶC chọn lô + số lượng; mẻ tạo tay trong app; mã lô tự ghép từ chu kỳ + số mẻ + bồn (17/11 — xem mục Luồng làm việc của mẻ); bồn chưa QA thả = cho rót, chỉ cảnh báo (công tắc); quá hạn lưu bồn = chỉ cảnh báo; lượng rút khai khi đóng trang sổ.

- **Kho chế biến = KHO PHỤ NỘI BỘ** (`Warehouse.parent_warehouse_id`, có từ 10/07) — mẻ và bồn chỉ mở / khai ở kho phụ (422 `NOT_PRODUCTION_WAREHOUSE`). KHÔNG thêm loại kho mới (32 chỗ so `CENTRAL`/`NPP`). NVL sang kho chế biến bằng chuyển kho / Xuất luôn có sẵn, pallet giữ tem gốc.
- **Rút NVL vào mẻ** — hai đường, cùng sổ `batch_consumption`, cùng luật trừ tồn (kho của mẻ · không QA giữ qua `qa_is_hold` · còn > 0 sau giữ chỗ · mã có đơn vị nhập phải số nguyên base):
  - quét tem ⇒ `scan-check` (tem ở kho khác nói tên kho; mã tồn gộp nhiều lô ⇒ 409 `POOLED_CODE`) ⇒ `consume-scan` (hàm `mes_consume_scan`, khoá dòng);
  - "Không có tem" ⇒ chọn mã + lô (NSX / mã lô tem, hàm `mes_stock`) ⇒ `consume-lot` (hàm `mes_consume_lot`, FEFO trong lô, thiếu thì KHÔNG trừ dở).
  - Hai đường CÙNG luật trạng thái (chỉ IN_STOCK / PARTIAL); đường lô khớp ĐÚNG (NSX, mã lô) đã chọn — lô không mã lô không ăn sang lô có mã lô cùng NSX (14/11, `20261114d`, C110).
  - Huỷ dòng rút = hoàn đúng dòng tồn + giữ vết (quyền `reverse` riêng — chưa tự cấp cho chức danh nào).
  - Dòng tồn đã vào mẻ không xoá được (FK RESTRICT — chuỗi truy xuất).
- **Bồn** (`production_tank` + `tank_lot` + `tank_movement`): một bồn một mã BTP (chặn trộn mã), đơn vị bồn = base của mã BTP (L/KG), chặn vượt sức chứa (khoá dòng bồn). Nhiều mẻ chung một bồn được ⇒ mọi lần lấy ra (`mes_tank_take`: rút cho trang sổ · xả · điều chỉnh giảm · chuyển đi) **chia theo tỷ lệ lượng còn của từng mẻ**, làm tròn 3 số lẻ, phần dư vào lô lớn nhất. Chuyển bồn giữ lúc nạp + hạn lưu gốc (trộn thì hạn theo phần cũ nhất). Điều chỉnh mức bắt buộc lý do.
- **Sổ đóng gói rút từ bồn:** trang sổ chọn bồn của chính kho hoặc kho phụ trực thuộc (`tanks-for-run`); đóng trang khai lượng rút ⇒ hàm `mes_close_run` đóng trang + rút bồn trong MỘT giao dịch. Rút gặp lô chưa QA thả ⇒ công tắc 2 tầng Kho + Loại kho `production_qa_gate` (OFF / WARN mặc định / BLOCK — `services/productionGate.ts`); quá hạn lưu ⇒ chỉ cảnh báo; cảnh báo lưu vào `tank_movement.warning`. **Lô QA LOẠI (REJECTED) khác lô CHỜ QA (14/11, C111):** không nạp vào bồn, bồn đang chứa nó không rút cho đóng gói được BẤT KỂ công tắc (409 `MES_QA_REJECTED`) — công tắc chỉ nói về lô HOLD; xả bỏ / chuyển / điều chỉnh vẫn làm được. Lượng bồn giữ tối đa 3 số lẻ (`round3` ở controller + lưới tổng phần chia trong `mes_tank_take`). Form Giờ kết thúc của trang GẮN BỒN bắt khai lượng rút (0 = không rút) — để trống từng đóng trang âm thầm, mất đường truy xuất.
- **Sửa / khai bù lượng rút SAU khi trang đã đóng (14/11 tối, user chốt "Sửa được"):** `POST /wms/packing-runs/:id/tank-draw` `{ tank_qty (TỔNG mới, 0 = không rút), reason }` — quyền `packing.edit`, hàm `mes_run_redraw`. Sổ bồn CHỈ GHI THÊM: tăng ⇒ rút thêm phần chênh qua `mes_tank_take` (cùng luật QA, chia theo tỷ lệ các mẻ ĐANG trong bồn); giảm ⇒ trả phần chênh về bồn chia theo tỷ lệ lượng thuần trang đã rút của từng mẻ (dòng DRAW dấu +, kèm lý do; lô đã cạn thì mở lại, giữ lúc nạp + hạn lưu gốc). Chặn: trang đang mở (409 `MES_RUN_NOT_CLOSED`) · chưa gắn bồn · bồn nay đã chứa mã khác · vượt sức chứa · rút thêm quá lượng bồn có. Mọi chỗ đọc "trang rút bao nhiêu từ mẻ nào" phải cộng ĐẠI SỐ các dòng DRAW (`mes_genealogy` chỉ nối cặp có lượng thuần > 0; FE `runDrawn`).
- **Lô QA loại ⇒ muốn dùng lại (kể cả hạ cấp) thì QA đổi kết luận ở trang Bồn (17/11; trước đó ở trang mẻ)** — không có đường vòng nào khác (user xác nhận 14/11 tối). Hạ cấp (KPH) KHÔNG có trạng thái riêng — user chốt 14/11: "không cần, bấm Thả là được"; đừng đề xuất lại.
- **Truy xuất sản xuất:** `GET /wms/production/genealogy?kind=BATCH|FG_PALLET|RM_PALLET` (hàm `mes_genealogy`) — phạm vi = kho được giao + kho phụ trực thuộc (chỉ đọc). Đi tiếp từ pallet TP tới NPP / xe = `lot_trace` sẵn có.
- **Danh sách mẻ:** hàm `mes_batch_page` trả dòng + tổng + ô band trong MỘT lời gọi.
- Lỗi nghiệp vụ từ hàm DB: `MESERR:<MÃ>|<câu>` ⇒ controller dịch 404 / 422 / 409 `MES_<MÃ>`.
- Chuỗi truy xuất lô ⇒ KHÔNG đăng ký lưu trữ / xoá theo hạn.

## Bỏ giấy ở xưởng (14/11 đêm — user: "khi cho NVL vào mẻ, user viết tay vào giấy rồi lại nhập vào Excel. Mục tiêu của tôi là bỏ các tờ giấy này đi")

Ba biểu mẫu giấy trong `Du lieu mau/NB-QA-BM-CB.01 BÁO CÁO SỬ DỤNG NGUYÊN VẬT LIỆU.xlsx` được thay bằng ba thứ dưới đây. User chốt: ghi trên CẢ điện thoại lẫn máy tính; làm cả ba một lượt.

- **BÀN LÀM VIỆC CỦA MẺ** (user: "hình dung có 1 bàn làm việc của mẻ đó — mẻ yêu cầu NVL như thế nào, số lượng bao nhiêu thì user thao tác với bàn làm việc đó phải input thông tin vào đầy đủ"). Trang chi tiết mẻ mở đầu bằng khối "Nguyên liệu của mẻ": mỗi nguyên liệu một dòng — yêu cầu · đã cấp · còn thiếu · tồn kho chế biến · cách cấp · tình trạng · nút **Cấp** (điện thoại: danh sách gọn, không cuộn ngang). Một lời gọi `mes_batch_board`.
  - **Định mức** (`production_recipe` + `_line`, trang Định mức, quyền `manage_recipe`): mỗi mã BTP MỘT định mức cho một cỡ mẻ chuẩn. Mở mẻ ⇒ `mes_batch_apply_recipe` chép định mức × (kế hoạch / cỡ chuẩn) thành `batch_requirement`; mã chưa khai định mức ⇒ bàn trống, người mở tự thêm.
  - **Yêu cầu sửa được theo mẻ** ("Sửa yêu cầu", quyền `open_batch`, mẻ đang mở): `PUT …/requirements` thay trọn danh sách; bỏ một dòng KHÔNG đụng phần đã cấp (dòng đó hiện "Ngoài yêu cầu"); "Chép lại theo định mức" = `POST …/apply-recipe`.
  - **CÓ TEM QR THÌ PHẢI QUÉT** (user: "nếu có QR code thì phải quét QR code và điền số lượng"): "có tem" = mã tem khác mã hàng (tồn gộp của kho theo NSX lưu `pallet_code` = mã hàng, mỗi NSX một dòng). `mes_consume_lot` chỉ trừ dòng KHÔNG tem; lô còn hàng trên tem ⇒ 409 `MES_MUST_SCAN`. `mes_stock` trả thêm `available_no_tem` / `tem_pallets` để màn hình biết dòng nào phải quét. Kho chế biến chế độ QR ⇒ mọi nguyên liệu đều phải quét.
  - **Form Cấp** (`ConsumeSheet`, mở từ một dòng của bàn với `focusId`): tem khác mã đang cấp bị từ chối; lượng điền sẵn = phần còn thiếu (không vượt lượng trên tem / lô); nút "Quét cấp NVL" ở đầu trang = quét tự do, app tự khớp tem vào dòng của bàn; mã không có trong yêu cầu vẫn cấp được (báo trước, hiện "Ngoài yêu cầu").
  - **Sửa mẻ thì bàn tính lại** (16/11, C114 — `mes_batch_requirements_refresh`): đổi kế hoạch ⇒ mọi dòng yêu cầu nhân theo tỷ lệ kế hoạch mới / cũ (kế hoạch trống = cỡ mẻ chuẩn của định mức); đổi mã BTP ⇒ bỏ yêu cầu cũ, chép định mức mã mới (chưa có ⇒ bàn trống). Mẻ đã đóng không tính lại.
  - Thêm `production_batch.cycle` (Chu kỳ — biểu mẫu ghi BTP / chu kỳ / mẻ).
- **BÁO CÁO SỬ DỤNG NVL THEO CA** (trang Báo cáo NVL, thay tờ "Báo cáo sử dụng nguyên vật liệu"). Một báo cáo = một ca của một kho chế biến (`production_shift_report` + `production_shift_count`), mỗi kho MỘT ca đang mở. Khoảng thời gian của ca = từ lúc chốt ca trước tới lúc chốt ca này (các ca nối nhau, không hở không trùng; kho chưa từng chốt ⇒ từ đầu ngày giờ VN).
  - Cột đúng thứ tự tờ giấy: **Tồn đầu thực tế** (số đếm lúc chốt ca trước; mã ca trước không đếm ⇒ tồn sổ chụp lúc chốt ca trước, in kèm "(sổ)"; riêng ca ĐẦU TIÊN của kho mới dựng ngược tồn nay + dùng − nhập) · **Nhập** (chênh bộ đếm nhập cộng dồn của kho — Σ `cartons_imported` mọi dòng trừ dòng tách pallet — giữa lúc chốt ca trước và bây giờ; bắt cả hàng nhận GỘP vào dòng tồn đã có của kho QTY_DATE (16/11, C113). Ca đầu tiên chưa có bộ đếm ⇒ dòng tồn tạo mới trong ca) · **dùng theo TỪNG MẺ** (`batch_consumption` sống ghi trong ca) · **Tổng sử dụng** · **Tồn cuối thực tế** (người nhập) · **Tồn cuối sổ sách** (tồn kho chế biến trên app) · **Chênh lệch** = thực tế − sổ.
  - Lưu nháp số đếm lúc nào cũng được; **Chốt ca** (`mes_shift_save` close) chụp mọi con số vào `production_shift_count` ⇒ báo cáo đã chốt không đổi khi tồn về sau đổi, không sửa lại được. Quyền `shift_report`.
  - **Báo cáo KHÔNG tự sửa tồn** — chênh lệch chỉ để thấy; muốn khớp sổ thì kiểm kê / điều chỉnh tồn như mọi kho.
  - Xuất Excel theo bố cục biểu mẫu (BTP / Chu kỳ / Mẻ ba dòng tiêu đề) — quyền `export`.
- **PHIẾU THEO DÕI của mẻ** (khối "Phiếu theo dõi" trên bàn làm việc; thay "Phiếu theo dõi quá trình phối trộn" và "Phiếu theo dõi bán thành phẩm dịch thạch"). `batch_process_log` (mỗi mẻ tối đa một phiếu mỗi mẫu phiếu), nội dung `data` jsonb `{ mã_ô: giá_trị }`. **Danh sách ô là CẤU HÌNH** (xem mục dưới). Ô giờ có nút điền giờ hiện tại; ô số vượt ngưỡng tiêu chuẩn tô đỏ nhưng vẫn lưu được — phiếu ghi đúng thực tế. Ghi = quyền `process_log`; **QA xác nhận** (quyền `qa_release`) ⇒ phiếu khoá, bỏ xác nhận mới sửa được. Xuất Excel từng phiếu.
- **MẪU PHIẾU = CẤU HÌNH + SỬA RIÊNG TỪNG LẦN TẠI BÀN** (14/11 khuya — user: "các nội dung trong phiếu đó được in sẵn mã, nhưng khi lên app không có mã. Mẻ trộn cái gì thì mã đó mới vào bàn làm việc, theo định lượng quy định trước đó. Những cái khác bạn cho nó là số liệu config được đi" + "cài đặt và cho phép sửa theo từng lần nếu muốn tại bàn. UI UX phải thuận tiện là ưu tiên"):
  - Danh sách NVL in sẵn trên giấy KHÔNG đưa lên app — bàn của mẻ chỉ có mã theo Định mức của BTP đang trộn (đã vậy từ đợt bàn làm việc); báo cáo ca chỉ có mã có tồn / có cấp.
  - Mẫu phiếu ở bảng `production_process_form` (code · title · short · blocks · is_active), sửa ở **Cài đặt MES → tab "Mẫu phiếu theo dõi"** (quyền `configure`, MỘT nút "Lưu mẫu" của tab): danh sách mẫu bên trái + "Thêm mẫu phiếu"; mỗi khối là "Nhóm ô" (mỗi ô: tên · Số / Giờ / Chữ · đơn vị · ngưỡng ≥ / ≤ · ⋯ ô rộng / điền sẵn từ mẻ) hoặc "Bảng theo dõi" (số lần ± · cột · ô mỗi cột); "Xem thử" vẽ đúng form người ghi sẽ thấy. Ngưng mẫu = tắt "Đang dùng" (không xoá — phiếu đã ghi khoá ngoại tới mẫu).
  - **Mã ô** sinh từ tên khi ô còn mới, ô đã lưu giữ nguyên mã (phiếu bám vào mã); ô bảng = `<bảng>_<lần>_<cột>_<ô>` (bảng rửa thạch `wash_…` giữ như cũ). Ô bị gỡ khỏi mẫu: giá trị cũ vẫn trong phiếu, form hiện ở khối "Ô không còn trong mẫu" (và ra Excel).
  - **Tại bàn** (form phiếu của mẻ): "+ Thêm lần N" dưới bảng, "+ Thêm ô cho mẻ này" trong nhóm (gõ tên, Enter) — bấm là có; "Sửa cấu trúc" mở cùng trình sửa của Cài đặt; "Về theo mẫu chung" bỏ bản riêng. Bản riêng lưu ở `batch_process_log.blocks` (PUT phiếu: `blocks` mảng = lưu riêng · `null` = về mẫu chung · bỏ trống = giữ), mẫu chung không đổi.
  - QA xác nhận ⇒ chụp mẫu đang áp vào `blocks` (hồ sơ lô không đổi khi mẫu chung sửa sau); bỏ xác nhận mà bản chụp y hệt mẫu ⇒ gỡ lại thành "theo mẫu chung". Phiếu MỚI chỉ mở theo mẫu đang dùng (409 `PROCESS_FORM_INACTIVE`), phiếu đã có vẫn sửa được.
  - Luật hình dạng chung BE `processBlocksError` ⇄ FE `blocksError` (trùng mã ô · ngưỡng trên ô không phải số · ngưỡng ngược · tối đa 300 ô / phiếu) — sửa một bên thì sửa cả hai.
- **CHƯA làm trong đợt này:** mix VTM theo chu kỳ (bảng nhỏ cuối sheet VTM) · cột "Lô – HSD" in sẵn trên báo cáo ca (lô đã nằm ở Nhật ký cấp nguyên liệu và Truy xuất lô) · mở lại ca đã chốt · các ô "CBNL đến / đã có phiếu đến" của phần giao ca (hiện gộp vào một ô Ghi chú giao ca).

## Công thức nhiều bản + phiếu của mẻ giữ định mức gốc (17/11 — theo phiếu chế biến giấy HN-…-QT-01-BM-01 "SC CĐ Long Thành")
User 16–17/11: "mẻ chọn SC CĐ Long Thành ⇒ ra NVL và định mức theo công thức lên trước ⇒ tạo phiếu của mẻ là tạo yêu cầu cho nhân viên hoàn thành" · "ở nhiều thời điểm công thức khác nhau ⇒ tạo được nhiều để chọn, thay đổi được trên giao diện mẻ: thêm, xoá, sửa, đổi" · cấp vượt mức lệch: **chỉ tô đỏ** · ai sửa định mức của mẻ: **người được phân quyền (trưởng ca)** · công thức / định mức **dạng bảng, đồng bộ UI/UX của app**. Migration `20261117_mes_recipe_versions`.
- **Nhiều công thức / mã BTP:** `production_recipe.name` (duy nhất trong mã, không phân biệt hoa thường) + `is_default` (mã có công thức đang dùng thì đúng MỘT mặc định; ngừng công thức mặc định ⇒ công thức đang dùng sửa gần nhất thành mặc định). API: `GET /recipes[?material_id=&active=1]` · `GET /recipes/:id` · `POST /recipes` (tạo) · `PUT /recipes/:id` (quyền `manage_recipe`). Trang Định mức: mỗi dòng một công thức, form có bảng nguyên liệu + cột "± %" + nút "Chép thành công thức mới".
- **Mở mẻ chọn công thức** (`recipe_id`, mặc định = công thức mặc định; Mở mẻ giống = công thức của mẻ gốc) — kiểm công thức thuộc đúng mã + đang dùng TRƯỚC khi tạo mẻ (422 `MES_RECIPE_MISMATCH` / `MES_RECIPE_INACTIVE`). `production_batch.recipe_id` ghi công thức đã dùng; header trang mẻ in tên công thức.
- **Phiếu của mẻ giữ ĐỊNH MỨC GỐC:** `batch_requirement.qty_standard` = công thức × kế hoạch (sửa kế hoạch ⇒ nhân cả số gốc). Sửa trên mẻ (quyền RIÊNG `edit_requirement` "Sửa định mức của mẻ" — chưa cấp cho chức danh nào vì staging chưa có chức danh trưởng ca; open_batch không còn sửa được): có thay đổi ⇒ BẮT BUỘC lý do (`MESERR:REASON`), ghi `change_reason` / `changed_by_name` / `changed_at`; về đúng gốc ⇒ thôi dấu sửa. Bỏ dòng của công thức = **bỏ mềm** (`removed_at`, bàn hiện "Đã bỏ" + gốc); dòng tự thêm thì xoá hẳn; thêm lại mã đã bỏ ⇒ dòng cũ sống lại, gốc giữ nguyên. **Đổi mã** = dòng mới `replaces_material_id` ("thay cho …"), dòng cũ bỏ mềm ("Đã bỏ → mã mới"). **Đổi công thức** trên mẻ = `apply-recipe {recipe_id, replace:true}`.
- **Mức lệch cho phép** `tol_pct` từng dòng công thức (chép sang phiếu). Trạng thái dòng: một hàm FE `utils/reqTolerance.ts` (`reqLineState`, test `backend/tests/unit/reqTolerance.test.ts`) cho bảng máy tính, danh sách điện thoại, ô "NVL đã đủ" / "Lệch mức": cấp trong [yêu cầu × (1 ± t)] = Đủ; vượt ⇒ đỏ "Lệch +x%" (vẫn cho cấp); mẻ đã đóng mà dưới cận dưới ⇒ đỏ "Thiếu". Dòng không khai mức lệch giữ luật cũ (vượt = "Vượt yêu cầu").
- Bảng nguyên liệu dùng chung `MatLinesEditor` (công thức + phiếu của mẻ) = `ResizableTable` (STT · Mã · Nguyên liệu · Gốc · Số lượng · ĐVT · ± % · ⇄ / ✕), khung cuộn ngang trên điện thoại.
- **Ít chữ, ĐVT bằng mã của app (user 17/11 tối, ảnh màn mẻ trên điện thoại: "hạn chế dùng văn viết, và dùng đơn vị tính của app").** Mọi màn MES in ĐVT bằng MÃ trong danh mục Đơn vị tính (KG · L · BAG — như cột Base Unit ở Mã hàng, SAP, màn Bồn), không in nhãn dài ("kilogram") sau mỗi con số. Helper FE `utils/unitCode.ts` (test `backend/tests/unit/unitCode.test.ts`): ô bảng = con số trần `qtyNum` + ĐVT một lần (cột ĐVT `matUnitCode`, nhãn ô tổng "Kế hoạch (KG)" `unitCode`); câu báo / gợi ý ô chọn = `qtyCode` ("50 KG"); mã có quy cách thùng vẫn "N thùng + M hộp". Danh sách ĐIỆN THOẠI không còn dạng câu ("Cần … · đã cấp … · kho còn …"): `components/wms/production/MobileNumGrid.tsx` — hàng nhãn cột in MỘT lần (dính đầu khi cuộn), mỗi dòng mã · tên · ĐVT rồi chỉ con số thẳng cột; trạng thái bằng màu số (thiếu cam · đủ ✓ xanh · ngoài mức lệch đỏ "+x%"). Áp ở bàn của mẻ (Cần · Đã cấp · Thiếu · Tồn kho), Báo cáo NVL theo ca (Đầu · Nhập · Dùng · Sổ còn · Lệch · Thực tế) và khối đầu form Cấp (ba ô số). Form Cấp tính "Thiếu" bằng cùng `reqLineState` với bàn (trong mức lệch = đủ ✓). Các module khác vẫn in nhãn danh mục qua `unitLabel` — đổi app-wide là việc riêng.
- **Demo staging 17/11** (phiếu SC CĐ Long Thành, mẻ 2 ngày 16/11): mã dịch `BTP-SCCDLT` (SC CĐ Long Thành) + `BTP-SUANEN` (BTP sữa nền), 2 công thức "Chuẩn (SMP-MH)" (mặc định) / "Dùng SMP-LH" cỡ 6.000 kg, 18 dòng tồn ở Chế biến Ba Vì (ghi chú "Demo phiếu chế biến SC CĐ Long Thành (17/11)"; lô dầu cọ NSX 30/10/2025 QA giữ), bồn đệm BD62 / BD65. Chưa có: dòng Nước 4.591 kg (nguyên liệu không trừ tồn), rút BTP sữa nền từ BỒN vào mẻ (demo tạm để BTP sữa nền trong tồn kho chế biến).

## Rà 16/11 (C113 · C114 + 17 lỗi màn hình)
- **Mã bán thành phẩm = mã có cờ "Bán thành phẩm" ở Mã hàng (C117, user chốt 16/11).** BTP là dịch trộn từ nhiều NVL theo định mức, vào bồn chờ chiết rót (vd Dịch sữa chua uống dâu) — mỗi loại dịch một mã riêng (lấy từ SAP nếu có, không thì nhà máy tự tạo), đơn vị gốc L / KG. Trước đây "mọi mã L / KG" ⇒ ô chọn chỉ toàn NVL. Nay: ô chọn Mở mẻ · Định mức · Hạn lưu bồn gọi `useSemiFinishedSearch` (`semi_finished=1`, form Mở mẻ chỉ mã đang dùng); danh mục chưa có BTP ⇒ dòng nhắc lối sang Mã hàng (`NoSemiFinishedHint`). BE: `btpUseError` ở `createBatch` · `updateBatch` (đổi mã) · `putRecipe` · `putSettings` (KHAI hạn; GỠ hạn thì mã nào cũng được) — lỗi 422 `NOT_SEMI_FINISHED` / `BTP_UNIT` / `MATERIAL_INACTIVE`. Danh sách NVL của mẻ / định mức vẫn nhận mọi mã (chưa chốt: BTP có làm nguyên liệu cho mẻ khác không, vd dịch thạch).
- Báo cáo NVL: chỉ hiện số của ĐÚNG báo cáo đang chọn (đổi kho mà bảng cũ còn hiện thì "Chốt ca" chốt nhầm ca của kho kia) · tên kho trong hộp xác nhận chốt · tải lại (người khác lưu) không xoá ô số đếm đang gõ.
- Ca của mẻ / báo cáo ca lấy từ danh mục ca dùng chung (`useShiftNames` ← Cài đặt WMS → Ca, cùng nguồn Sổ đóng gói); giá trị cũ không có trong danh mục vẫn giữ.
- "Mở mẻ giống" dựng lại trang (key theo id) ⇒ form Cấp tự mở cho mẻ mới. Form Định mức: đổi mã thì bỏ định mức đã nạp của mã cũ (trước đây lưu được định mức mã A dưới mã B).
- Mẫu phiếu: "Thêm bảng theo dõi" lần 3 sinh trùng mã `bang2` ⇒ kẹt — nay `gridKeyFor`; luật hình dạng BE ⇄ FE gom về `backend/src/utils/processBlocks.ts` + test mirror `processBlocks.mirror.test.ts`. Phiếu đang gõ dở mà người khác lưu ⇒ nạp ô họ đổi, giữ ô mình gõ, báo một dòng.
- Form Nạp / Chuyển bồn chỉ tải danh sách khi mở (trước đây trang Bồn và mỗi trang mẻ ngầm tải mọi mẻ / mọi bồn trong phạm vi). Form thao tác bồn đọc bồn từ danh sách đang sống.
- Bàn của mẻ KHÔNG nghe sổ tồn của cả app (mỗi lần quét toàn hệ thống sẽ kéo lại bàn) — dòng "kho hết" vẫn bấm Cấp được: tải lại bàn rồi mở form (form tra tồn sống). `InventoryEntry` → `prod-stock` (chỉ khi form Cấp mở).
- Danh sách mẻ: mốc "đến ngày" mặc định để trống (= tới nay); mốc đã qua nhớ từ hôm trước tự bỏ khi mở lại. Bộ lọc kho chỉ liệt kê kho nhà máy người dùng được giao.
- Đóng trang sổ có khai lượng rút ⇒ tải lại bồn / mẻ ngay (như Sửa lượng rút).

## Màn hình (14/11)
- **Mẻ chế biến** `/wms/production` (`ProductionBatches.tsx`): phân trang server, lọc ngày SX · kho · trạng thái · QA; lọc theo kho NHÀ MÁY gồm các kho chế biến trực thuộc. Nút chính "Mở mẻ" (`BatchFormSheet`: chu kỳ · số mẻ · bồn bắt buộc, mã lô tự ghép — 17/11).
- **Chi tiết mẻ** `/wms/production/:id`: nút chính "Rút NVL" (`ConsumeSheet`: Quét tem — súng PDA chỉ nghe khi đang chờ quét / camera / gõ; Không có tem — chọn mã đang có tồn → bảng lô HSD sớm lên đầu); Nạp bồn · Sửa (QA đạt / không đạt: ở trang Bồn từ 17/11) · Đóng / Mở lại / Huỷ mẻ; bảng NVL đã rút (huỷ dòng có lý do), Ra bồn, Sổ nạp / rút.
- **Bồn** `/wms/production/tanks`: mỗi dòng một bồn (% đầy là con số có màu, mẻ trong bồn bấm mở mẻ, hạn lưu, QA); thao tác gom một nút ⋮ (Nạp · Chuyển · Điều chỉnh · Xả · Sổ bồn · Sửa).
- **Sổ đóng gói:** form Mở trang sổ có ô "Rút bán thành phẩm từ bồn" (chỉ hiện khi kho có bồn); Giờ kết thúc có ô "Lượng đã rút từ bồn"; chi tiết trang hiện bồn + lượng rút theo mẻ.
- **Truy xuất lô:** nút "Sản xuất" → `GenealogySheet` (tem thành phẩm / tem NVL / mã lô BTP); bấm tem thành phẩm ⇒ điền bộ lọc Xuôi để truy tiếp tới khách / xe.
- **Cài đặt MES** `/wms/production/settings` (`ProductionSettings.tsx`, 14/11 tối — user: "setting nào liên quan thì chuyển sang Cài đặt MES"): chọn kho chế biến, MỘT nút Lưu cho cả trang. Nhóm "Đóng gói rút bán thành phẩm khỏi bồn" = công tắc lô CHỜ QA tầng Kho + khai riêng từng Loại kho (nhãn "Theo kho (giá trị đang áp)") + dòng nói rõ lô QA LOẠI luôn chặn. Nhóm "Hạn lưu bồn theo mã bán thành phẩm" = bảng mã đã khai giờ + ô thêm mã (tìm trên server, chỉ mã L / KG), để trống = gỡ hạn; áp cho mọi kho. Cửa `GET / PUT /wms/production/settings` (PUT quyền `configure`, kiểm hết rồi mới ghi). Cột vẫn nằm ở `Warehouse` / `warehouse_type_configs` / `Material` — hai cửa cũ đã thôi ghi: `applyPutawayBody` bỏ nhận `production_qa_gate`, `putWarehouseTypeConfigs` không đụng cột này (trước đó mỗi lần lưu Loại kho ở Cài đặt WMS sẽ ghi NULL đè — gói 63 [6w]), form Mã hàng bỏ ô nhập (pane chi tiết vẫn hiện). Danh mục bồn vẫn ở trang Bồn. **Thêm cấu hình MES mới ⇒ đặt ở trang này, không quay lại Cài đặt WMS.** **Sổ pallet:** nhãn "Rút vào mẻ chế biến" / "Huỷ rút vào mẻ".
- **Phạm vi module:** kho được giao HOẶC kho cha của nó được giao (kho chế biến là tổ nội bộ của nhà máy) — `inScope` async trong controller, FE `useProductionWarehouses` cùng luật.
- **Thao tác nhanh (rà 14/11):** mở mẻ xong vào thẳng form Rút NVL · form Cấp: dòng chỉ có hàng không tem thì vào thẳng "Không có tem", còn lại bắt đầu bằng quét; nút "Lấy hết"; Enter ở ô lượng = Xác nhận cấp; súng PDA nghe cả khi đang hiện một tem (bắn tem khác là thay); lượng điền sẵn của mã tính theo bao / thùng làm tròn lên số nguyên; tem QA giữ hiện lý do và không cho xác nhận (16/11) · Nạp bồn là nút có chữ, chọn sẵn bồn đang chứa mẻ / bồn duy nhất, điền sẵn lượng = kế hoạch − đã nạp, chỉ hiện bồn nhận được (cùng đơn vị, trống hoặc cùng mã) · thao tác bồn báo vượt chỗ / vượt lượng ngay tại ô nhập, nút "Hết bồn", Enter = xác nhận · "Mở mẻ giống" (cùng kho · mã · máy · ca · kế hoạch) · sửa mẻ xoá được máy / ca / ghi chú · ô nhập điền sẵn số qua `vnNumberInput` (C112).
- Đã đo 1280 / 390 / 360: console 0 lỗi, `<main>` không tràn ngang (chi tiết mẻ từng tràn 4 px do ⓘ ở ô cuối dải tổng — vá ở `SummaryBand`, C4 LẶP 14/11).

## Actions

**approve_expired** = QA duyệt / từ chối cấp NVL HẾT HẠN vào mẻ (từng tem / lô, kèm căn cứ — chỉ chức danh QA: migration `20261117e` cấp theo approve_qa, `20261118` gỡ ở ba chức danh quản lý kho) · **approve_lead** = trưởng ca duyệt / bỏ duyệt phiếu · **approve_qa** = QA duyệt / bỏ duyệt phiếu · **print_label** = in tem pallet của mẻ · **pour** = quét tem đổ bồn (cấp theo năng lực, migration `20261117b`: open_batch ⇒ approve_lead · qa_release ⇒ approve_qa + print_label · tank_ops ⇒ pour) · **qa_release** nay = QA đạt / không đạt ở BỒN + xác nhận phiếu.

view · **configure** = sửa Cài đặt MES (cấp theo năng lực: `wms_settings.manage_warehouse` + `production.view`, migration `20261114e`) · **open_batch** = mở / sửa / đóng / mở lại / huỷ mẻ · **consume** = rút NVL vào mẻ · **reverse** = huỷ dòng rút · **qa_release** = QA giữ / thả / loại lô BTP · **manage_tank** = danh mục bồn · **tank_ops** = nạp / chuyển / điều chỉnh / xả bồn · **export** = Xuất Excel danh sách mẻ (FE) · **edit_requirement** = sửa định mức trên phiếu của mẻ (thêm / bỏ / sửa / đổi mã / đổi công thức, bắt buộc lý do) — vd trưởng ca; không tự cấp cho chức danh nào. Cấp quyền theo năng lực (migration `20261114`): `packing.open_run` ⇒ view/open_batch/consume/tank_ops · `packing.record` ⇒ view/consume · `inventory.qa_update` ⇒ view/qa_release · `wms_settings.manage_machine` ⇒ view/manage_tank.

## Gói QA

`scripts/qa/63-production.mjs` (148 phép — thêm [2g] gom theo date · [2e] NVL hết hạn chờ QA duyệt · [2l] cửa Không có tem cùng luật luân chuyển · [14c] quyền duyệt hàng hết hạn (17/11 khuya); thêm [16] luồng của mẻ 17/11: mã lô tự ghép · bồn thiếu chỗ / khác mã · nạp sai bồn · hai duyệt chặn cả hai cửa cấp · tem pallet · đổ bồn sai bồn / sai tem / tem cũ · đổi bồn đổi mã lô · ô bắt buộc · bấm mốc giờ · QA ở bồn; thêm [10] bàn làm việc của mẻ / định mức / có tem phải quét · [11] báo cáo ca · [12] phiếu theo dõi · [13] mẫu phiếu cấu hình + sửa riêng tại bàn): mẻ ở kho phụ · mã lô gợi ý · tra tem · rút theo tem / theo lô · 5 người cùng rút một tem · bất biến nhập − còn = Σ rút sống · bồn (sức chứa, trộn, cặp id chéo kho, sửa bồn còn hàng) · trang sổ khai rút + công tắc QA · điều chỉnh / chuyển / xả · sửa / khai bù lượng rút của trang đã đóng (tăng · về 0 · trang mở · quá bồn · gia phả) · Cài đặt MES (đọc · ghi một lần · kho không phải chế biến · cửa Loại kho của Cài đặt WMS không đè) · lô QA loại chặn rút + nạp · đúng mã lô · dòng tồn không còn trong kho · gia phả ba chiều · sổ pallet · vòng đời mẻ.

## Ngoài giai đoạn 1

Định mức nhiều phiên bản / theo kho · lệnh sản xuất từ SAP · yield & hao hụt · tự trừ bao bì · hạn sau khi mở bao · OEE · check list CCP / CIP.
