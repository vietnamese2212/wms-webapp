# Sản xuất — MES giai đoạn 1 (`production`)

> Tạo 14/11/2026 cùng giai đoạn 1 MES (kế hoạch `docs/plans/MES_PHASE1_PLAN.md`, memory `mes-phase1-design-2026-11-14`).
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Mẻ chế biến (bàn làm việc của mẻ) · Bồn · Báo cáo NVL · Định mức · Cài đặt MES — nhóm menu CẤP 1 "Sản xuất (MES)" đứng TRÊN Kho (WMS) (user chốt 14/11 tối: "cho MES lên phía trên của WMS") (user chốt 14/11 "tách MES riêng": chỉ tách menu, vẫn chung app + chung DB; Sổ đóng gói giữ ở Kho (WMS) → Nhập hàng; đường dẫn `/wms/production…` không đổi)

**Quyền (BE `ALL_PERMISSIONS`):** view · open_batch · consume · reverse · qa_release · manage_tank · tank_ops · export · configure · manage_recipe · shift_report · process_log

## Giao thoa với
<!-- giao-thoa:start -->
- [`inventory`](inventory.md) — Tồn kho (rút NVL vào mẻ TRỪ tồn kho chế biến; sổ pallet có nguồn 10 "Rút vào mẻ")
- [`packing`](packing.md) — Sổ đóng gói (trang sổ gắn bồn, đóng trang khai lượng rút — một giao dịch)
- [`traceability`](traceability.md) — Truy xuất lô (gia phả sản xuất: NVL → mẻ → bồn → trang sổ → pallet TP)
- [`outbound`](outbound.md) — Xuất kho ("xuất tiêu hao" ở kho phụ cũng trừ tồn kho chế biến — hai cửa cùng một sổ)
- [`wms_settings`](wms_settings.md) — Cài đặt WMS (kho chế biến = kho phụ nội bộ; cột `production_qa_gate` nằm ở Kho / Loại kho nhưng CỬA GHI là Cài đặt MES — cửa Loại kho của Cài đặt WMS không được đè)
- [`materials`](materials.md) — Mã hàng (`tank_hold_hours` hạn lưu bồn — sửa ở Cài đặt MES, form Mã hàng chỉ hiển thị; `batch_prefix` làm tiền tố mã lô gợi ý)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Nhà máy sữa: NVL → **mẻ chế biến** → bán thành phẩm (BTP) trong **bồn** → **Sổ đóng gói** → pallet thành phẩm. User chốt 14/11: thiết kế trước khi có kết quả phiếu khảo sát; giai đoạn 1 = nối lô + tồn theo bồn; rút NVL = quét tem HOẶC chọn lô + số lượng; mẻ tạo tay trong app; mã lô app gợi ý, sửa được; bồn chưa QA thả = cho rót, chỉ cảnh báo (công tắc); quá hạn lưu bồn = chỉ cảnh báo; lượng rút khai khi đóng trang sổ.

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
- **Lô QA loại ⇒ muốn dùng lại (kể cả hạ cấp) thì QA đổi kết luận ở trang mẻ** — không có đường vòng nào khác (user xác nhận 14/11 tối). Hạ cấp (KPH) KHÔNG có trạng thái riêng — user chốt 14/11: "không cần, bấm Thả là được"; đừng đề xuất lại.
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
  - Thêm `production_batch.cycle` (Chu kỳ — biểu mẫu ghi BTP / chu kỳ / mẻ).
- **BÁO CÁO SỬ DỤNG NVL THEO CA** (trang Báo cáo NVL, thay tờ "Báo cáo sử dụng nguyên vật liệu"). Một báo cáo = một ca của một kho chế biến (`production_shift_report` + `production_shift_count`), mỗi kho MỘT ca đang mở. Khoảng thời gian của ca = từ lúc chốt ca trước tới lúc chốt ca này (các ca nối nhau, không hở không trùng; kho chưa từng chốt ⇒ từ đầu ngày giờ VN).
  - Cột đúng thứ tự tờ giấy: **Tồn đầu thực tế** (số đếm lúc chốt ca trước; ca đầu chưa có số đếm ⇒ dựng từ sổ, in kèm "(sổ)") · **Nhập** (dòng tồn tạo mới ở kho chế biến trong ca) · **dùng theo TỪNG MẺ** (`batch_consumption` sống ghi trong ca) · **Tổng sử dụng** · **Tồn cuối thực tế** (người nhập) · **Tồn cuối sổ sách** (tồn kho chế biến trên app) · **Chênh lệch** = thực tế − sổ.
  - Lưu nháp số đếm lúc nào cũng được; **Chốt ca** (`mes_shift_save` close) chụp mọi con số vào `production_shift_count` ⇒ báo cáo đã chốt không đổi khi tồn về sau đổi, không sửa lại được. Quyền `shift_report`.
  - **Báo cáo KHÔNG tự sửa tồn** — chênh lệch chỉ để thấy; muốn khớp sổ thì kiểm kê / điều chỉnh tồn như mọi kho.
  - Xuất Excel theo bố cục biểu mẫu (BTP / Chu kỳ / Mẻ ba dòng tiêu đề) — quyền `export`.
- **PHIẾU THEO DÕI của mẻ** (khối "Phiếu theo dõi" trên bàn làm việc; thay "Phiếu theo dõi quá trình phối trộn" và "Phiếu theo dõi bán thành phẩm dịch thạch"). `batch_process_log` (mỗi mẻ tối đa một phiếu mỗi loại MIX / JELLY), nội dung `data` jsonb `{ mã_ô: giá_trị }`. **Danh sách ô khai ở FE `config/processForms.ts`** — thêm / bớt / đổi nhãn ô chỉ sửa file đó, không đổi bảng (đừng đổi `key` của ô đã dùng). Ô giờ có nút "Bây giờ"; ô số vượt tiêu chuẩn (pH nước trộn ≤ 7,20) tô đỏ nhưng vẫn lưu được — phiếu ghi đúng thực tế. Ghi = quyền `process_log`; **QA xác nhận** (quyền `qa_release`) ⇒ phiếu khoá, bỏ xác nhận mới sửa được. Xuất Excel từng phiếu.
- **CHƯA làm trong đợt này:** mix VTM theo chu kỳ (bảng nhỏ cuối sheet VTM) · cột "Lô – HSD" in sẵn trên báo cáo ca (lô đã nằm ở Nhật ký cấp nguyên liệu và Truy xuất lô) · mở lại ca đã chốt · các ô "CBNL đến / đã có phiếu đến" của phần giao ca (hiện gộp vào một ô Ghi chú giao ca).

## Màn hình (14/11)
- **Mẻ chế biến** `/wms/production` (`ProductionBatches.tsx`): phân trang server, lọc ngày SX · kho · trạng thái · QA; lọc theo kho NHÀ MÁY gồm các kho chế biến trực thuộc. Nút chính "Mở mẻ" (`BatchFormSheet`: mã lô gợi ý tự điền, sửa được).
- **Chi tiết mẻ** `/wms/production/:id`: nút chính "Rút NVL" (`ConsumeSheet`: Quét tem — súng PDA chỉ nghe khi đang chờ quét / camera / gõ; Không có tem — chọn mã đang có tồn → bảng lô HSD sớm lên đầu); Nạp bồn · QA thả / giữ / loại · Sửa · Đóng / Mở lại / Huỷ mẻ; bảng NVL đã rút (huỷ dòng có lý do), Ra bồn, Sổ nạp / rút.
- **Bồn** `/wms/production/tanks`: mỗi dòng một bồn (% đầy là con số có màu, mẻ trong bồn bấm mở mẻ, hạn lưu, QA); thao tác gom một nút ⋮ (Nạp · Chuyển · Điều chỉnh · Xả · Sổ bồn · Sửa).
- **Sổ đóng gói:** form Mở trang sổ có ô "Rút bán thành phẩm từ bồn" (chỉ hiện khi kho có bồn); Giờ kết thúc có ô "Lượng đã rút từ bồn"; chi tiết trang hiện bồn + lượng rút theo mẻ.
- **Truy xuất lô:** nút "Sản xuất" → `GenealogySheet` (tem thành phẩm / tem NVL / mã lô BTP); bấm tem thành phẩm ⇒ điền bộ lọc Xuôi để truy tiếp tới khách / xe.
- **Cài đặt MES** `/wms/production/settings` (`ProductionSettings.tsx`, 14/11 tối — user: "setting nào liên quan thì chuyển sang Cài đặt MES"): chọn kho chế biến, MỘT nút Lưu cho cả trang. Nhóm "Đóng gói rút bán thành phẩm khỏi bồn" = công tắc lô CHỜ QA tầng Kho + khai riêng từng Loại kho (nhãn "Theo kho (giá trị đang áp)") + dòng nói rõ lô QA LOẠI luôn chặn. Nhóm "Hạn lưu bồn theo mã bán thành phẩm" = bảng mã đã khai giờ + ô thêm mã (tìm trên server, chỉ mã L / KG), để trống = gỡ hạn; áp cho mọi kho. Cửa `GET / PUT /wms/production/settings` (PUT quyền `configure`, kiểm hết rồi mới ghi). Cột vẫn nằm ở `Warehouse` / `warehouse_type_configs` / `Material` — hai cửa cũ đã thôi ghi: `applyPutawayBody` bỏ nhận `production_qa_gate`, `putWarehouseTypeConfigs` không đụng cột này (trước đó mỗi lần lưu Loại kho ở Cài đặt WMS sẽ ghi NULL đè — gói 63 [6w]), form Mã hàng bỏ ô nhập (pane chi tiết vẫn hiện). Danh mục bồn vẫn ở trang Bồn. **Thêm cấu hình MES mới ⇒ đặt ở trang này, không quay lại Cài đặt WMS.** **Sổ pallet:** nhãn "Rút vào mẻ chế biến" / "Huỷ rút vào mẻ".
- **Phạm vi module:** kho được giao HOẶC kho cha của nó được giao (kho chế biến là tổ nội bộ của nhà máy) — `inScope` async trong controller, FE `useProductionWarehouses` cùng luật.
- **Thao tác nhanh (rà 14/11):** mở mẻ xong vào thẳng form Rút NVL · form Rút NVL nhớ cách rút lần trước (máy này) + nút "Rút hết" · Nạp bồn là nút có chữ, chọn sẵn bồn đang chứa mẻ / bồn duy nhất, điền sẵn lượng = kế hoạch − đã nạp, chỉ hiện bồn nhận được (cùng đơn vị, trống hoặc cùng mã) · thao tác bồn báo vượt chỗ / vượt lượng ngay tại ô nhập, nút "Hết bồn", Enter = xác nhận · "Mở mẻ giống" (cùng kho · mã · máy · ca · kế hoạch) · sửa mẻ xoá được máy / ca / ghi chú · ô nhập điền sẵn số qua `vnNumberInput` (C112).
- Đã đo 1280 / 390 / 360: console 0 lỗi, `<main>` không tràn ngang (chi tiết mẻ từng tràn 4 px do ⓘ ở ô cuối dải tổng — vá ở `SummaryBand`, C4 LẶP 14/11).

## Actions

view · **configure** = sửa Cài đặt MES (cấp theo năng lực: `wms_settings.manage_warehouse` + `production.view`, migration `20261114e`) · **open_batch** = mở / sửa / đóng / mở lại / huỷ mẻ · **consume** = rút NVL vào mẻ · **reverse** = huỷ dòng rút · **qa_release** = QA giữ / thả / loại lô BTP · **manage_tank** = danh mục bồn · **tank_ops** = nạp / chuyển / điều chỉnh / xả bồn · **export** = Xuất Excel danh sách mẻ (FE). Cấp quyền theo năng lực (migration `20261114`): `packing.open_run` ⇒ view/open_batch/consume/tank_ops · `packing.record` ⇒ view/consume · `inventory.qa_update` ⇒ view/qa_release · `wms_settings.manage_machine` ⇒ view/manage_tank.

## Gói QA

`scripts/qa/63-production.mjs` (91 phép — thêm [10] bàn làm việc của mẻ / định mức / có tem phải quét · [11] báo cáo ca · [12] phiếu theo dõi): mẻ ở kho phụ · mã lô gợi ý · tra tem · rút theo tem / theo lô · 5 người cùng rút một tem · bất biến nhập − còn = Σ rút sống · bồn (sức chứa, trộn, cặp id chéo kho, sửa bồn còn hàng) · trang sổ khai rút + công tắc QA · điều chỉnh / chuyển / xả · sửa / khai bù lượng rút của trang đã đóng (tăng · về 0 · trang mở · quá bồn · gia phả) · Cài đặt MES (đọc · ghi một lần · kho không phải chế biến · cửa Loại kho của Cài đặt WMS không đè) · lô QA loại chặn rút + nạp · đúng mã lô · dòng tồn không còn trong kho · gia phả ba chiều · sổ pallet · vòng đời mẻ.

## Ngoài giai đoạn 1

Định mức nhiều phiên bản / theo kho · lệnh sản xuất từ SAP · yield & hao hụt · tự trừ bao bì · hạn sau khi mở bao · OEE · check list CCP / CIP.
