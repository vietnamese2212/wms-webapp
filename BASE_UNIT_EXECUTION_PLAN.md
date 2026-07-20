# KẾ HOẠCH THI CÔNG — Chiến dịch BASE UNIT (lõi số lượng theo đơn vị gốc)

> **Dành cho agent thực hiện (Opus).** Tài liệu này TỰ CHỨA: đọc xong là đủ ngữ cảnh để làm.
> Bối cảnh thiết kế đầy đủ (10 vòng brainstorm với user, 19/07/2026): `SAP_INTEGRATION_PLAN.md` mục 7–8. Memory liên quan: `base-unit-campaign`.
> **Luật làm việc:** tuân thủ `CLAUDE.md` + gọi đúng skill (`brainstorm-plan`/`mutation-realtime`/`table-format`/`add-permission`/`verify-feature`) như quy định. Làm trên branch `dev`, push sau mỗi bước, KHÔNG merge `main` khi user chưa nghiệm thu. Các điểm ghi **⛔ STOP** = bắt buộc dừng hỏi user trước khi đi tiếp.

---

## 0. Quyết định kiến trúc (user đã chốt — KHÔNG mở lại)

WMS chuyển lõi số lượng sang mô hình SAP S/4HANA:
- Mỗi **Mã hàng** khai: **Base Unit** (đơn vị gốc — HOP/KG/BAG/EA/…, **tùy biến**, là DATA không hardcode) + **Entry Unit** tùy chọn (CAR/Thùng…) + hệ số **1 Entry = N Base** (dùng lại cột `Material.units_per_carton` làm hệ số — KHÔNG tạo cột hệ số mới trùng nghĩa).
- **MỌI lưu trữ + tính toán = BASE UNIT. Entry Unit CHỈ để hiển thị.**
  - Tồn 89 thùng + 24 hộp (hệ số 48) → **lưu `4296`** (HOP), hiển thị "89,5 thùng" / "89 thùng + 24 hộp".
  - Đơn 17 thùng + 24 hộp → **lưu `840`** (HOP), hiển thị "17 thùng + 24 hộp".
- Đơn vị ĐẾM (HOP/EA/CHAI…) → số base là **SỐ NGUYÊN**. Đơn vị ĐO (KG/BAG…) → decimal hợp lệ (bản chất NVL).
- **Biên giới WMS↔SAP chỉ trao đổi SỐ NGUYÊN** theo đơn vị SAP key (CAR/HOP).
- **Tem pallet KHÔNG đổi** — tem vẫn in số THÙNG (người đọc); quy đổi làm ở tầng ghi dữ liệu.
- Kiểu cột DB giữ `numeric` — chỉ đổi **NGHĨA** của con số.
- Thứ tự: **Base Unit core xong TRƯỚC → mới xây "Up raw" SAP (đợt 3)**.

Quy mô đo thực tế: ~358 điểm backend (nặng nhất `outboundController` 181, `inboundController` 67) + ~155 điểm frontend (22 file) tham chiếu 4 cột `cartons_*`.

---

## ĐỢT 0 — Khai báo ĐVT trên Mã hàng (nhỏ, an toàn, không đổi hành vi)

1. **Migration** `backend/migrations/YYYYMMDD_material_base_unit.sql`:
   ```sql
   ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS base_unit text;
   ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS entry_unit text;
   -- hệ số dùng lại units_per_carton (1 entry = N base)
   UPDATE "Material" SET base_unit = 'HOP', entry_unit = 'CAR'
     WHERE units_per_carton IS NOT NULL AND units_per_carton > 0 AND base_unit IS NULL;
   UPDATE "Material" SET base_unit = COALESCE(NULLIF(trim(unit), ''), 'EA')
     WHERE base_unit IS NULL;
   ```
   Apply STAGING trước (quy trình chuẩn); cập nhật `SCHEMA_REVIEW.md`.
2. **Form Mã hàng + upload Excel Mã hàng**: thêm ô "Đơn vị gốc (base)" + "Đơn vị nhập liệu (entry)" + nhãn hệ số đổi thành "1 Entry = N Base" (chính là ô 'Hộp/thùng' cũ). Validate: có entry_unit thì hệ số bắt buộc > 0. Theo mẫu field mới đã có tiền lệ (`batch_prefix`, dims mm — cột CUỐI template, giữ vị trí M_KEYS).
3. **Nhãn hiển thị đơn vị**: bảng map code→nhãn vi đặt trong helper đợt 1 (`CAR`→"thùng", `HOP`→"hộp", `KG`→"kg", `BAG`→"bao", `EA`→"cái"; code lạ → hiển thị nguyên văn). KHÔNG hardcode nhãn rải rác.
4. **Verify**: tsc/build; DB soi backfill đúng (mã có upc → HOP/CAR; NVL → KG/BAG/EA theo `unit`); form + upload lưu được; KHÔNG hành vi nào khác đổi.

## ĐỢT 1 — Formatter số lượng TRUNG TÂM (gom hiển thị về 1 hàm) — ✅ XONG 19/07 (commit `3292285`)

> Đã ship: helper mirror `qtyUnits.ts` BE+FE (thêm `qtyEntryText`/`qtyUnitLabel`/`unitLabel` ngoài 3 hàm thiết kế); 16 Material embed BE + type FE mang `base_unit/entry_unit/units_per_carton`; sweep 15 file WMS core. Verify sống Preview: 0,67 thùng ×48 → "32 hộp" (row + detail pane, desktop + mobile 390), mã KG → "1.000 kg".
> **Chủ đích ĐỂ LẠI cho Đợt 2** (ghi rõ để không tưởng sót): tổng CROSS-MÃ (SummaryBand, GDO totals, NPP group header — thuộc 2.2); form key tay + số thùng vật lý nhập khi quét pallet (write-side, tem giữ thùng); ScanLog/TMS/Slotting/PalletLabels-audit (RPC + select chưa mang units — thay khi làm 2.2/2.3); parseDiff note kiểm kê (text lịch sử); LoadPlan3D (thùng vật lý → 2.3 phải chia hệ số khi qty thành base).

> Mục tiêu: đưa ~155 điểm hiển thị FE (+ chỗ BE xuất chuỗi) về **1 hàm duy nhất**, để đợt 2 flip chỉ đổi RUỘT hàm + tầng ghi.

1. Helper **BE + FE KHỚP NHAU** (mẫu noi theo: `shelfLife.ts`/`computePctDate` — 2 bản mirror):
   - `backend/src/utils/qtyUnits.ts` + `frontend/src/utils/qtyUnits.ts`.
   - API đề xuất (thiết kế để đợt 2 KHÔNG phải đổi chữ ký):
     ```ts
     type MatUnits = { base_unit?: string|null; entry_unit?: string|null; units_per_carton?: number|null }
     qtySplit(qty: number, m: MatUnits): { entry: number; base: number }   // 89.5 thùng (nay) → {89, 24}
     qtyLabel(qty: number, m: MatUnits): string                            // "89 thùng + 24 hộp" | "7.004,875 kg"
     qtyEntryDecimal(qty: number, m: MatUnits): number                     // 89.5 (cho cột số cần 1 con số)
     ```
   - **Đợt 1 (ruột hàm):** tham số `qty` đang là THÙNG thập phân → split = `floor(qty)` + `round(frac×hệ_số)`. **Đợt 2 đổi ruột:** `qty` là BASE → split = `divmod(qty, hệ_số)`. Chữ ký giữ nguyên.
2. **Sweep FE**: mọi chỗ render số thùng/tồn/số lượng đơn → qua `qtyLabel`/`qtySplit` (22 file đã liệt kê bằng grep `cartons_` — Inventory, Outbound*, LoosePicking*, Inbound*, Stocktake*, PalletOps, Prepare, ScanLog, Dashboard, PalletDetailDialog, GdoScanSheet, printDeliveryNote…). Cell hẹp dùng `qtyEntryDecimal`. KHÔNG đổi logic, chỉ đổi cách render.
3. **Verify**: Playwright desktop+mobile các trang chính — số hiển thị "89 thùng + 24 hộp" đúng với 35 dòng tồn lẻ thật trên staging (query: `cartons_remaining % 1 <> 0`); tổng/summary không đổi giá trị.

## ĐỢT 2 — SEMANTIC FLIP — ✅ STAGING ĐÃ FLIP 20/07 (commit `f12a437`)

> STOP 1 đã duyệt 20/07 ("flip ngay, cả main/dev đều test"). **STAGING đã chạy `run-flip.mjs`: verify per-row 0 lệch, báo cáo round 67 giá trị (tổng lệch <5 hộp) trong bảng `base_unit_flip_round_report`; backup `x_flip_bak_*` GIỮ tới khi user cho xóa.** PRODUCTION: khi merge main phải chạy `node scripts/base-unit-flip/run-flip.mjs` (đọc .mcp.json — trỏ production cần connection string riêng) CÙNG CỬA SỔ deploy. Quy ước đã chốt khi thi công: **mọi trường số lượng qua API = BASE** (kể cả `cartons_override` — pallet chuyển kho lẻ hộp cần vậy); cờ `qty_semantics:'base'` gắn tự động (interceptor axios + QA lib) — BE `requireBaseQty` chặn 409 bundle/queue cũ (upload multipart không cần cờ — validate bằng nội dung file). Lưu ý vận hành: hàng đợi quét offline enqueue TRƯỚC flip nếu có `cartons_override` sẽ sai đơn vị khi replay — dặn kho xóa queue cũ (test env, rủi ro ~0).

### 2.1. Migration dữ liệu ×hệ_số (CHỈ mã có `entry_unit` — mã không entry giữ nguyên)
Cột đã xác minh trên DB staging (19/07) — nhân với `Material.units_per_carton` qua JOIN material:
| Bảng | Cột | Ghi chú |
|---|---|---|
| `InventoryEntry` | `cartons_imported`, `cartons_remaining`, `cartons_reserved`, `adjustment_qty` | lõi tồn |
| `OutboundItem` | `cartons_ordered`, `cartons_scanned`, `loose_picking` | `boxes_display` → sau flip TRÙNG nghĩa phần lẻ, đánh dấu deprecated (giữ cột, ngừng ghi) |
| `OutboundScanEntry` | `cartons_scanned` | lịch sử quét — nhân để báo cáo nhất quán |
| `InventoryAdjustmentLog` | `delta`, `cartons_before`, `cartons_after` | audit nhất quán |
| `ProductionImport` | `planned_cartons`, `posm_cartons` | INTEGER — base hộp nguyên vẫn integer, OK |
| `inbound_plan_lines` | `planned_boxes` | kế hoạch VC per mã (join material_id) |

**Kết quả XÁC MINH 19/07 (grep sweep + information_schema staging) — chốt sau trinh sát:**
- ✅ Danh sách trên là ĐỦ các cột phải nhân. Stocktake KHÔNG có bảng/cột số riêng (số thực tế chỉ nằm trong text `stocktake_flag_note` — GIỮ nguyên text lịch sử, note mới sau flip ghi số base; `parseDiff` FE hiển thị nguyên văn).
- ❌ **KHÔNG nhân** (đã rà từng cột số còn lại toàn DB): `TmsOrder.planned_boxes/planned_pallets/planned_tons` (material_id = NULL toàn bộ 8004 dòng — là CACHE tổng cross-mã cấp lệnh, xử như aggregate 2.2, chỉ dòng `inbound_plan_lines` per-mã mới nhân) · `PalletLabelPrint.qty` (số thùng in trên TEM = vật lý, tem giữ thùng) · `OutboundItem.pallets_estimated/weight` · `ProductionImport.planned_pallets` · `Material.cartons_per_pallet(_mn)/units_per_carton/carton_*_mm` · `Location/zone.max_pallets` · `DeliverySlot.booked_count` · `carton_scans` jsonb (đếm tem thùng vật lý) · bảng HR/weigh/gate (không có cột lượng hàng).
- RPC trên DB sống đụng số lượng (phải REPLACE cùng cửa sổ deploy): `dashboard_stats` · `control_tower_stats` · `outbound_shortage_stats` · `slotting_stats` · `get_outbound_scan_log` (2 overload) + `search_outbound_scan_log` + facets · `move_pallets_to_location` (chỉ đọc `>0` — flip-safe, rà lại khi làm) · `scan_insert_pallet` (ghi giá trị được truyền — convert ở BE trước khi gọi).
- Quy mô dữ liệu staging (mã có entry): InventoryEntry 35.835 · InventoryAdjustmentLog 2.012 · OutboundItem 682 (0 dòng material_id null) · OutboundScanEntry 8 · ProductionImport 17 · inbound_plan_lines 4. **37 dòng tồn đang thùng lẻ → sẽ round + vào báo cáo.** 0 mã entry thiếu hệ số; 6 mã TP/SCA không entry (5 thiếu upc + Loscam) → theo luật 2.3 tạm được thập phân.
- `Material.cartons_per_pallet` **KHÔNG nhân** — vẫn là "thùng vật lý/pallet" (tem in thùng); pallet ước tính = `qty_base / hệ_số / cartons_per_pallet`.

### 2.2. Aggregate CROSS-MATERIAL phải chia hệ số (SUM base nhiều mã ≠ nghĩa)
Mọi chỗ đang `SUM(cartons_*)` qua nhiều mã → đổi thành `SUM(qty / COALESCE(hệ_số,1))` (ra "thùng quy đổi") hoặc đổi nhãn cột sang đơn vị base khi cùng mã. Danh sách RPC/điểm phải REPLACE:
`dashboard_stats` · `control_tower_stats` (v5) · `outbound_shortage_stats` · `slotting_stats` · inventory list/facets/summary (PostgREST aggregate `.sum()` → phải chuyển RPC hoặc tính JS chia hệ số) · cổng integration `/v1/inventory` + `scan-entries` (**thêm trường `qty_base` + `base_unit` + giữ trường thùng quy đổi** — ERP cần cả hai) · dashboard "Tồn (thùng)" / SummaryBand các trang.

### 2.3. Code sweep (BE ~358 + FE ~155 điểm — theo module)
- **LUẬT SỐ NGUYÊN (user chốt 19/07): mã CÓ `entry_unit` → cấm thập phân ở MỌI nhập liệu số lượng (form key tay, upload, nhập kho, điều chỉnh, kiểm kê, tách pallet, lưu thủ công) — nhập bằng 2 ô "Thùng + Hộp" SỐ NGUYÊN (cả 2 ô đều nguyên); mã KHÔNG entry → 1 ô, thập phân tự do (KG/EA/BAG…).** Điều kiện = `hasEntry(m)` sẵn có trong `qtyUnits.ts` — thêm helper validate/parse input TẬP TRUNG tại đây (BE+FE mirror), KHÔNG rải điều kiện ở từng form. FE: component `QtyInput` dùng chung cho mọi điểm nhập. BE: guard 422 "Mã X — nhập số nguyên (Thùng + Hộp)" là hàng rào thật. **Upload áp CÙNG luật, KHÔNG đường chuyển tiếp**: cột thùng thập phân với mã có entry → lỗi THEO DÒNG kèm gợi ý quy đổi tính sẵn ("0,33 thùng ≈ 16 hộp — ghi vào cột Hộp"); template upload KH xuất + Tồn đầu kỳ thêm cột Hộp. Lưu ý: mã thiếu units_per_carton (entry null) tạm thoát luật — thúc user khai đủ hệ số.
- **Ghi (convert tại rìa):** inbound scan/manual (tem N thùng → `N×hệ_số`); outbound `scanItem`/`checkScanItem`/quick-export; **nhặt lẻ = đếm HỘP nguyên trực tiếp** (bỏ quy đổi thùng thập phân — luồng tự nhiên hơn); upload KH xuất cũ (thùng thập phân → `round(x×hệ_số)`); upload Tồn kho (cột thùng → ×hệ_số khi mã có entry, template ghi chú rõ); điều chỉnh tồn; dồn/tách pallet; chuyển kho/nhận hàng; RPC `consumeInventoryExact`/`adjustInventoryAtomic`/`addItemScanned` (chữ ký giữ, số truyền vào đã là base).
- **So sánh/gác:** mọi `>=`/khớp KH giữ nguyên phép toán (2 vế cùng base); gác "KH khớp thực quét mới Hoàn thành" giữ nguyên.
- **Hiển thị:** chỉ đổi RUỘT `qtyUnits` (đợt 1 đã gom) + các chỗ BE trả chuỗi.
- **QA suite** `scripts/qa/*`: invariant/race đọc-ghi số lượng → cập nhật theo base; chạy XANH là điều kiện đóng đợt.
- **Offline queue (PWA):** payload quét offline mang số thùng → **yêu cầu các kho đồng bộ hết hàng đợi TRƯỚC giờ freeze** (ghi vào kịch bản vận hành); replay sau flip bị BE từ chối theo version flag (thêm `qty_semantics: 'base'` vào payload mới, thiếu flag → 409 bắt cập nhật app).

### 2.4. Kịch bản vận hành flip (staging trước, production sau khi user nghiệm thu)
1. Chọn giờ trống + báo user; kho đồng bộ offline queue.
2. Backup: `CREATE TABLE x_backup_YYYYMMDD AS SELECT ...` cho mọi bảng ở 2.1.
3. Chạy migration ×hệ_số (1 transaction/bảng, JOIN Material, WHERE entry_unit IS NOT NULL).
4. **Verify số học:** per bảng per mã: `SUM(new) = SUM(old)×hệ_số` (script so backup) — lệch NGOÀI danh sách round = dừng, rollback. Dòng tồn lịch sử đang thùng lẻ phải `round(x×hệ_số)` (vd 0,674×6 → 4 hộp, lệch 0,044) → **xuất BÁO CÁO danh sách dòng bị round kèm chênh lệch** (một lần duy nhất lúc flip; từ đó về sau số nguyên tuyệt đối theo luật 2.3).
5. Deploy code base-semantics CÙNG cửa sổ (merge dev đã chứa code, bump rebuild-token).
6. QA suite full + smoke tay (nhập → tồn → xuất → nhặt lẻ → kiểm kho → dashboard) + Playwright.
7. Ngâm staging ≥ vài ngày vận hành thử → user gật → lặp kịch bản trên production.
8. Rollback path: restore backup + revert deploy (giữ backup tới khi user xác nhận xóa).

## ĐỢT 3 — "Up raw" SAP ✅ ĐÃ BUILD + VERIFY SỐNG STAGING (20/07, dev `020447ea`, CHỜ user nghiệm thu Preview)

**Đã làm:** bảng `erp_outbound_orders` (raw verbatim + `raw` jsonb, RLS) migration `20260720_erp_outbound_orders.sql` · `uploadVl06o` (giữ NGUYÊN tên cột SAP, map theo header, upsert chunk 500, cross-check base_unit + Sales×hệ_số cảnh báo) · `uploadKhvc` (join raw theo DO → reshape → `processVehicleGroups` tách từ `uploadExcel` tái dùng logic re-upload) · route `/outbound/upload-vl06o` + `/upload-khvc` (quyền `outbound.import`) · FE nút "Up kế hoạch VC" + dialog 2 bước + 2 template rút gọn (VL06O giữ tên SAP; KHVC 8 cột: Ngày xuất·Số xe·DO·Tên NPP·Loại xe·DVVT·Ưu tiên·CS phụ trách).
**Bổ sung theo user 20/07:** (a) **DO LUÔN bắt buộc** — DO trong KHVC thiếu trong VL06O = CHẶN TOÀN BỘ `MISSING_DO` 400, bắt sửa (user chốt BỎ switch "bỏ qua DO"; **xuất tay/không-DO dùng nút "Tạo đơn" thủ công**, không up qua KHVC); (b) **Ưu tiên** → `GroupDeliveryOrder.priority` (migration `20260720_gdo_priority.sql`) + **CS phụ trách** → `OutboundItem.cs_responsible`; (c) Kho xuất TẠM = Ba Vì (suy từ đoạn đầu Số xe `20000016`, chưa thêm cột Kho xuất riêng — chỉ cần khi đa kho); (d) Loại xe/DVVT (TMS setting) + Kho/Loại kho (WMS setting) đã validate chặn-toàn-bộ sẵn.
**Verify sống PASS:** raw ingest 274 dòng verbatim + jsonb · base math chính xác (merge 2 DO, loose=base%upc, no-entry pass-through) · warehouse_type suy từ category · guard chặn-toàn-bộ (mã thiếu/loại xe/DO thiếu) · re-upload idempotent · switch require_do (chặn/lenient) · dọn sạch 0 sót. Playwright dialog desktop+mobile OK.
**CÒN (chờ yêu cầu user):** cột Kho xuất riêng khi đa kho · SAP live-pull reconciliation (DO biến mất khỏi SAP → policy đánh dấu obsolete, raw giữ nguyên). "Xuất hàng KHÔNG DO" = user tự "Tạo đơn" thủ công (đã chốt, không làm trong luồng KHVC).

<details><summary>Kế hoạch gốc (giữ tham chiếu)</summary>

Thiết kế nghiệp vụ đầy đủ ở `SAP_INTEGRATION_PLAN.md` mục 7 (đọc TRƯỚC). Tóm tắt phần thi công:
1. Bảng `erp_outbound_orders` (raw OD, unique `(od_number, od_item)`, source `EXCEL`/`SAP`) — cột theo mục 7; file mẫu thật: `Du lieu mau/vl06o.XLSX` + `Ke hoach dieu van.xlsm` (CHỈ ĐỌC).
2. Nút **"Up kế hoạch VC"** (toolbar trang Xuất kho, SONG SONG nút upload cũ) → mở dialog 2 nút **"Up VL06O"** + **"Up KHVC"** + link tải template mẫu mỗi loại. Khu 1 nạp VL06O → raw; khu 2 nạp KHVC (`Ngày xuất·Số xe·SO·DO·Ship-to·Tên NPP·Loại xe·DVVT·Ưu tiên·Note`) → nhóm theo `Số xe` (group_code NGUYÊN VĂN) → sinh GDO/DO/items. **LẤY SHEET ĐẦU TIÊN của mọi file** (không dò tên sheet). **convert: qty base = Σ Actual(base) các dòng OD cùng (DO, mã)**.
3. Mọi chi tiết lấy từ RAW; NPP cascade 4 bậc (danh mục ship-to code → tên VL06O → search term → lỗi); header_text = gộp 2 cột ghi chú; batch/%Date từ cột raw; STO (ship-to = kho nội bộ) chảy vào luồng chuyển kho có sẵn; chạy SONG SONG upload cũ; quyền `outbound.import`.
4. ~~STOP 2~~ **ĐÃ GIẢI — user chốt 20/07 (override vòng 11): 1 DÒNG BASE mỗi (DO, mã)** — KHÔNG tách 2 dòng CAR/HOP (đồng nhất mô hình Đợt 2 đã build). `cartons_ordered = qty_base` (tổng Actual); `loose_picking = qtySplit(qty_base, material).base` (phần hộp lẻ = base % units_per_carton, tự chảy vào Nhặt lẻ). **TÙY BIẾN đơn vị — KHÔNG hardcode "HOP":** base_unit lấy từ `Material.base_unit` (HOP/BAG/BT/KG/EA… là DATA), thùng=entry_unit, quy đổi qua helper `qtyUnits` (`qtySplit`/`qtyFromEntryBase`/`unitLabel` — unitLabel fallback nguyên văn code lạ). Mã không entry → 1 dòng base, loose=0. Sales Unit × units_per_carton = kiểm chéo (lệch → cảnh báo); VL06O Base Unit lệch `Material.base_unit` → cảnh báo.
5. Test bằng chính 2 file mẫu (LẤY SHEET ĐẦU): kỳ vọng ~973 dòng raw VL06O · KHVC 42 dòng → chuyến/DO theo `Số xe`; hệ số suy từ Actual/Qty (48…) khớp `units_per_carton`; ship-to lệch giữa 2 file lấy theo VL06O (raw). Ghi staging phải DỌN SẠCH.

</details>

---

## Quyết định đã chốt phải tôn trọng (tra nhanh — chi tiết trong SAP_INTEGRATION_PLAN.md)
1. **Không được xuất thiếu**: OD ↔ app khớp 100% trước hoàn thành/chuyển giao (chi tiết bàn sau với user — đừng tự thiết kế phân bổ thiếu).
2. Ma trận OD sửa/hủy theo trạng thái (mục 7) — 3 nguyên tắc: không tự xóa dữ liệu quét · auto chỉ khi chưa ai đụng · tăng dễ hơn giảm.
3. Mã hàng field-ownership: SAP đè định danh; WMS sở hữu tham số vận hành (seed-once + cảnh báo lệch).
4. Batch khớp mềm: chu kỳ CỨNG + date ±3 ngày; hòa → chọn tay TRÊN SAP.
5. Form key đơn tay: 2 ô "Thùng + Hộp" SỐ NGUYÊN (hàng chẵn chỉ điền Thùng).
6. Tồn kho: kiểu numeric giữ nguyên; sau flip nghĩa = base.

## Bẫy đã biết của codebase (đọc memory tương ứng trước khi đụng)
- PostgREST cap 1000 dòng (`fetchAllRowsParallel`, chunk `.in()` 300–500) — memory `cap-1000-campaign`.
- INSERT phải có `id: randomUUID()` + `updated_at` (lỗi 23502).
- Cột giờ nghiệp vụ = naive-UTC → RPC giờ VN phải `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh'` — memory `naive-utc-timestamp-rpc-trap`.
- Đếm/CAS đồng thời: RPC row-lock hoặc optimistic-CAS + jitter — memory `concurrency-hardening`.
- Realtime: key mới vào `TABLE_QUERY_MAP`; bảng mới vào publication.
- Sửa `backend/src` → bump `// rebuild-token` trong `api/index.ts`.
- Excel date lệch -1 ngày (memory `excel-date-tz-trap`); số VN parse qua `parseVnNumber`.
- `Template upload.xlsx` + 2 file trong `Du lieu mau/` = CHỈ ĐỌC, không commit (git add từng file, cấm `git add -A`).

## Điều kiện đóng chiến dịch
- [ ] Đợt 0–2: QA suite xanh + verify-feature từng đợt + staging ngâm vận hành thử, user nghiệm thu từng đợt
- [ ] Đợt 2 production: chạy đúng kịch bản 2.4 (freeze → backup → ×hệ_số → verify → deploy → QA)
- [x] Đợt 3: BUILD + verify sống staging XONG (dev `020447ea`) — CHỜ user nghiệm thu trên Preview
- [ ] Cập nhật memory `base-unit-campaign` + `SCHEMA_REVIEW.md` sau mỗi đợt
