# MES giai đoạn 1 — Nối lô + tồn theo bồn (KẾ HOẠCH, chờ duyệt)

> Lập 14/11/2026 theo skill `brainstorm-plan`. Nhà máy sữa (FMCG): NVL → **mẻ chế biến** → bán thành phẩm (BTP) trong **bồn** → **Sổ đóng gói** → pallet thành phẩm.
> User chốt 14/11: thiết kế trước (phiếu khảo sát chưa có kết quả) · giai đoạn 1 = **nối lô + tồn theo bồn** · rút NVL = **quét tem, hoặc khi không có tem thì chọn lô + nhập số lượng** · mẻ **tạo tay trong app**.

## 1. Hiện trạng đo trên staging (14/11)
| Thứ cần | Đã có | Ghi chú |
|---|---|---|
| Kho chế biến có tồn riêng | **Kho phụ nội bộ** (`Warehouse.parent_warehouse_id`, 10/07): chỉ giao dịch với kho cha, nhận chuyển kho không cần biển số/booking, xuất tiêu hao. Mẫu: **CBBV "Chế biến Ba Vì"** (cha = Kho Ba Vì, `QTY_DATE`, tồn 0) | KHÔNG thêm loại kho mới |
| Rút khi "không có tem, chỉ số lượng + lô" | Chế độ tồn **`QTY_DATE`**: tồn gom theo (mã × NSX), trừ FEFO hoặc chọn đúng NSX (`applySharedPoolDelta`) | "Lô" = NSX của pool; kho `QR` thì lô = pallet |
| Trừ tồn nguyên tử | RPC `outbound_consume_exact` (khoá dòng) | Dùng lại trong RPC mới |
| Số lẻ KG | RM01: **360 mã base KG, không đơn vị nhập** ⇒ 12,5 KG hợp lệ | Mã có đơn vị nhập vẫn theo `qtyIntegerError` |
| Đóng gói | `packing_runs` (422 trang sổ) · `packing_logs` (1.132 pallet) | Trang sổ ở kho cha (Ba Vì / Bàu Bàng) |
| Máy | `warehouse_machines` | Máy trộn / máy rót |
| Truy xuất | RPC `lot_trace` (xuôi + ngược), `pallet_ledger`, `recall_campaign` | Thêm nhánh, không dựng sổ mới |

## 2. Dòng chảy giai đoạn 1
```
Kho NVL (cha) ──chuyển kho / Xuất luôn (có sẵn)──► KHO CHẾ BIẾN (kho phụ, QR hoặc QTY_DATE)
   ──[RÚT VÀO MẺ: quét tem | chọn mã + NSX + số lượng]──► MẺ (lô BTP)
   ──[NẠP VÀO BỒN]──► BỒN (nhiều mẻ chung được, sức chứa, hạn lưu, QA)
   ──[TRANG SỔ ĐÓNG GÓI rút từ bồn]──► PALLET THÀNH PHẨM (tem, Sổ đóng gói như cũ) ──► kho TP / Điều vận
Truy xuất: NCC → pallet/lô NVL → mẻ → bồn → trang sổ → pallet TP → NPP / xe   (cả hai chiều)
```

## 3. Dữ liệu (migration `backend/migrations/20261114_mes_phase1.sql` — apply staging trước)
Mọi bảng có `id` text + `created_at`/`updated_at` (timestamptz) + `*_by`; không policy / GRANT cho anon/authenticated; realtime qua `TABLE_QUERY_MAP`.
| Bảng / cột | Nội dung |
|---|---|
| `production_tank` | kho (kho phụ) · mã bồn · tên · sức chứa · đơn vị (L/KG = base của mã BTP) · hoạt động · ghi chú. UNIQUE (kho, mã) |
| `production_batch` | kho · **mã lô BTP** (UNIQUE theo kho) · mã BTP (`material_id`) · máy · ca · ngày SX (ngày VN) · lượng kế hoạch · trạng thái `OPEN → CLOSED` / `CANCELLED` · QA `HOLD / RELEASED / REJECTED` (+ ai, lúc, lý do) |
| `batch_consumption` | mẻ · `InventoryEntry` bị trừ · pallet_code + NSX + NCC (bản chụp) · lượng (BASE) · cách ghi `SCAN` / `LOT` · ai, lúc · huỷ (ai, lúc, lý do — huỷ = hoàn tồn, giữ vết) |
| `tank_lot` | bồn · mẻ · lượng vào · **lượng còn** · lúc nạp · **hạn lưu** (= lúc nạp + `Material.tank_hold_hours`) · trạng thái |
| `tank_movement` | sổ bồn: `FILL` · `DRAW` (gắn `packing_run_id`) · `TRANSFER_OUT/IN` · `ADJUST` · `DISCARD`, theo từng `tank_lot` |
| `Material.tank_hold_hours` | hạn lưu bồn (giờ) của mã BTP; null = không giới hạn |
| `packing_runs.tank_id` | trang sổ rút từ bồn nào (tuỳ chọn) |

**RPC (mỗi lệnh ghi ≥ 2 bảng = MỘT giao dịch, khoá dòng):**
- `mes_consume_scan(batch, entry, qty)` — kiểm entry thuộc đúng kho của mẻ, không bị QA giữ (luật `isQaHeld` chung), đủ tồn ⇒ trừ + ghi `batch_consumption`.
- `mes_consume_lot(batch, material, lot_date, qty)` — kho `QTY_DATE` / mã không theo dõi QR: trừ FEFO trong đúng NSX đã chọn, mỗi dòng tồn bị trừ = một dòng `batch_consumption`.
- `mes_consume_reverse(consumption_id, reason)` — hoàn tồn đúng dòng, giữ vết.
- `mes_tank_fill(batch, tank, qty)` — chặn vượt sức chứa (khoá dòng bồn), chặn trộn khác mã BTP trong một bồn.
- `mes_tank_draw(tank, packing_run, qty)` — bồn chứa nhiều mẻ ⇒ **chia theo tỷ lệ lượng còn** của từng mẻ (hàng đã trộn); chặn lô quá hạn lưu / QA theo cờ (mục 6).
- `mes_tank_transfer` · `mes_tank_adjust` (khớp đồng hồ mức bồn, bắt buộc lý do) · `mes_tank_discard` (xả bỏ).
- `lot_trace` thêm nhánh sản xuất (xuôi từ pallet/lô NVL hoặc mẻ; ngược từ pallet TP) · `pallet_ledger` thêm dòng "Rút vào mẻ X".

## 4. Màn hình (chuẩn `table-format`, giống app)
| Màn | Nội dung |
|---|---|
| **Mẻ chế biến** (list) | Lọc kho phụ · ngày · trạng thái · QA · mã BTP; SummaryBand: số mẻ, đang mở, chờ QA, lượng ra |
| **Chi tiết mẻ** | Header (mã lô, BTP, máy, ca, QA). Khối "NGUYÊN LIỆU ĐÃ RÚT" (bảng + nút chính **Rút NVL**). Khối "RA BỒN" (nạp bồn nào, bao nhiêu). Khối lịch sử |
| **Rút NVL** (điện thoại / PDA) | Nút quét (`ScanIcon`, khuôn `qr-scan-flow` confirm): quét tem → hiện mã, NSX, tồn còn → nhập KG → Xác nhận. Nút **"Không có tem"**: chọn mã (tìm trên server, chỉ mã đang có tồn ở kho chế biến) → chọn NSX (từng lô kèm tồn) → nhập lượng. Cảnh báo FEFO theo cờ luân chuyển sẵn có của kho |
| **Bồn** | Bảng mỗi dòng một bồn: sức chứa · đang chứa · % (con số có màu) · các mẻ trong bồn · hạn lưu còn · QA · thao tác Chuyển bồn / Điều chỉnh / Xả bỏ. Danh mục bồn sửa trong `FormSheet` |
| **Sổ đóng gói** (sửa) | Form mở trang sổ thêm ô "Rút từ bồn" (bồn của các kho phụ thuộc kho này) + khai lượng rút (cách khai: câu hỏi 1) |
| **Truy xuất lô** (sửa) | Thêm cách tìm theo mẻ / lô BTP; hồ sơ hiện thêm đoạn sản xuất |
| **Mã hàng** (sửa) | Ô "Hạn lưu bồn (giờ)" |
Menu: nhóm chức năng mới **"Sản xuất"** (Mẻ chế biến · Bồn) trong nhóm Kho; Sổ đóng gói giữ chỗ cũ.

## 5. Quyền — module mới `production` ("Sản xuất")
`view` · `open_batch` (mở / sửa / đóng / huỷ mẻ) · `consume` (rút NVL vào mẻ) · `reverse` (huỷ dòng rút) · `qa_release` (giữ / thả / loại lô BTP) · `manage_tank` (danh mục bồn) · `tank_ops` (nạp / chuyển / điều chỉnh / xả bồn) · `export`.
Đủ 5 việc: FE `MODULES` · BE `ALL_PERMISSIONS` · gate nút · `requirePerm` · **migration cấp theo năng lực**: chức danh có `packing.open_run` ⇒ view/open_batch/consume/tank_ops; có `packing.record` ⇒ view/consume; có `inventory.qa_update` ⇒ view/qa_release; có `wms_settings.manage_machine` ⇒ manage_tank. Gắn bồn vào trang sổ = `packing.open_run` (có sẵn). Scope: mọi đường đọc + ghi cắt theo kho; bồn của trang sổ phải thuộc kho phụ của kho trang sổ.

## 6. BẢNG CÔNG TẮC
| Cờ / cột | Ô UI ở đâu | Quyền sửa | Mặc định |
|---|---|---|---|
| Kho chế biến = kho phụ nội bộ | Cài đặt WMS → Kho → "Trực thuộc kho" (đã có) | `wms_settings.manage_warehouse` | không đổi gì kho cũ |
| QR / QTY_DATE của kho chế biến | Cài đặt WMS → Kho → "Chế độ quản tồn" (đã có) | như trên | — |
| Danh mục bồn | trang Bồn → FormSheet | `production.manage_tank` | trống |
| `Material.tank_hold_hours` | Mã hàng → form Sửa | `materials.edit` | null = không giới hạn |
| BTP chưa QA thả có cho rót không (câu hỏi 3) | Cài đặt WMS → Kho (+ Loại kho) → nhóm "SẢN XUẤT", `SettingRow` Switch — **2 tầng Kho + Loại kho** | `wms_settings.manage_warehouse` | theo câu trả lời |
| FEFO khi rút NVL cảnh báo / chặn | dùng cờ luân chuyển SẴN CÓ của kho (`rotation_principle` / `rotation_required`, 2 tầng) | đã có | theo kho |
| Loại hàng BTP (vd `SF01`) | Cài đặt WMS → Loại kho (đã có) | `wms_settings.manage_type` | dữ liệu, không code; nhớ cấp `allowed_categories` cho nhân sự |

## 7. Kế hoạch làm (mỗi bước có phép kiểm)
1. Migration bảng + cột + RPC + realtime + cấp quyền → kiểm: apply staging; `npm run db:types`; gói 00 (0 quyền anon/authenticated, trigger realtime đủ).
2. BE routes `/wms/production/*` (`validate` zod mọi route ghi, `requirePerm`, cắt scope, `fail(res, err)`), nối Sổ đóng gói + `lot_trace` + `pallet_ledger` → kiểm: tsc · `npm test` · cổng tĩnh 09 · bump rebuild-token.
3. Helper thuần (sinh mã lô BTP, tính hạn lưu bồn) + test `backend/tests/unit` → kiểm: test ĐỎ trên bản sai trước khi tin.
4. FE: permissions + navigation + 2 trang mới + màn Rút NVL + sửa Sổ đóng gói / Truy xuất / Mã hàng / Cài đặt → kiểm: tsc · build · ảnh 1280 / 390 / 360 cạnh màn chuẩn · `ui-mobile-sweep` · `ui-layout-sync`.
5. Gói QA mới **`63-production.mjs`** (tự seed kho phụ + NVL có TAG, dọn 0 sót): rút quét / rút theo lô FEFO / huỷ hoàn tồn · hai người rút cùng bao (không vượt tồn) · QA giữ không rút được · vượt sức chứa bồn bị chặn · bồn hai mẻ chia rút đúng tỷ lệ · quá hạn lưu · trang sổ chỉ chọn bồn của kho phụ mình · truy xuất xuôi + ngược ra đúng chuỗi (oracle tự tính) · IDOR cặp id · quyền 403 vai thật · xuất tiêu hao cũ vẫn chạy → kiểm: XANH + ước lượng/đo egress.
6. `run-all --tier fast` + gói 22 (Sổ đóng gói) + gói Truy xuất → XANH.
7. Tài liệu: `docs/modules/production.md` + "Giao thoa với" hai phía (inventory · packing · traceability · outbound · wms_settings · materials) + dòng bảng CLAUDE.md + `SCHEMA_REVIEW.md`.

## 8. Ngoài giai đoạn 1
Công thức / định mức · lệnh sản xuất từ SAP · yield & hao hụt so định mức · tự trừ bao bì theo định mức · hạn sau khi mở bao · OEE / dừng máy · check list CCP / CIP. Chỉnh lại khi có kết quả phiếu khảo sát (các câu B5, D2, D6, E5–E9, F1, G2).

## 9. Rủi ro đã thấy
- **Hai cửa trừ cùng một sổ:** "xuất tiêu hao" (đã có) và "rút vào mẻ" (mới) cùng trừ tồn kho chế biến ⇒ phải dùng CÙNG luật QA giữ / FEFO; gói 63 gọi cả hai.
- **Kho `QTY_DATE` gộp pallet theo (mã × NSX)** ⇒ truy xuất ở mức lô NSX, không tới từng pallet NCC: hồ sơ phải nói thẳng "lô gộp", liệt kê mọi pallet nguồn đã vào lô đó.
- Bồn chứa nhiều mẻ ⇒ một pallet TP nối tới nhiều mẻ (đúng thực tế trộn); thu hồi sẽ rộng hơn — đó là cái giá của việc trộn bồn, màn hình ghi rõ.
- Chuỗi truy xuất lô **không được lưu trữ / xoá theo hạn giữ** (luật dataArchive).
