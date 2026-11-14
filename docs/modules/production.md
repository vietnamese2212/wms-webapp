# Sản xuất — MES giai đoạn 1 (`production`)

> Tạo 14/11/2026 cùng giai đoạn 1 MES (kế hoạch `docs/plans/MES_PHASE1_PLAN.md`, memory `mes-phase1-design-2026-11-14`).
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Mẻ chế biến · Bồn · Cài đặt MES — nhóm menu CẤP 1 "Sản xuất (MES)" đứng TRÊN Kho (WMS) (user chốt 14/11 tối: "cho MES lên phía trên của WMS") (user chốt 14/11 "tách MES riêng": chỉ tách menu, vẫn chung app + chung DB; Sổ đóng gói giữ ở Kho (WMS) → Nhập hàng; đường dẫn `/wms/production…` không đổi)

**Quyền (BE `ALL_PERMISSIONS`):** view · open_batch · consume · reverse · qa_release · manage_tank · tank_ops · export · configure

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

`scripts/qa/63-production.mjs` (73 phép): mẻ ở kho phụ · mã lô gợi ý · tra tem · rút theo tem / theo lô · 5 người cùng rút một tem · bất biến nhập − còn = Σ rút sống · bồn (sức chứa, trộn, cặp id chéo kho, sửa bồn còn hàng) · trang sổ khai rút + công tắc QA · điều chỉnh / chuyển / xả · sửa / khai bù lượng rút của trang đã đóng (tăng · về 0 · trang mở · quá bồn · gia phả) · Cài đặt MES (đọc · ghi một lần · kho không phải chế biến · cửa Loại kho của Cài đặt WMS không đè) · lô QA loại chặn rút + nạp · đúng mã lô · dòng tồn không còn trong kho · gia phả ba chiều · sổ pallet · vòng đời mẻ.

## Ngoài giai đoạn 1

Định mức / BOM · lệnh sản xuất từ SAP · yield & hao hụt · tự trừ bao bì · hạn sau khi mở bao · OEE · check list CCP / CIP.
