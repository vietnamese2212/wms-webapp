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

## ĐỢT 1 — Formatter số lượng TRUNG TÂM (gom hiển thị về 1 hàm)

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

## ĐỢT 2 — SEMANTIC FLIP (LỚN — cần user duyệt kịch bản trước khi chạy)

> ⛔ **STOP 1:** trước khi code đợt 2, trình user danh sách cột + kịch bản migration (mục 2.1–2.4) để duyệt.

### 2.1. Migration dữ liệu ×hệ_số (CHỈ mã có `entry_unit` — mã không entry giữ nguyên)
Cột đã xác minh trên DB staging (19/07) — nhân với `Material.units_per_carton` qua JOIN material:
| Bảng | Cột | Ghi chú |
|---|---|---|
| `InventoryEntry` | `cartons_imported`, `cartons_remaining`, `cartons_reserved`, `adjustment_qty` | lõi tồn |
| `OutboundItem` | `cartons_ordered`, `cartons_scanned`, `loose_picking` | `boxes_display` → sau flip TRÙNG nghĩa phần lẻ, đánh dấu deprecated (giữ cột, ngừng ghi) |
| `OutboundScanEntry` | `cartons_scanned` | lịch sử quét — nhân để báo cáo nhất quán |
| `InventoryAdjustmentLog` | `delta`, `cartons_before`, `cartons_after` | audit nhất quán |
| `ProductionImport` | `planned_cartons`, `posm_cartons` | INTEGER — base hộp nguyên vẫn integer, OK |
| `TmsOrder` / `inbound_plan_lines` | `planned_boxes` | kế hoạch VC |
| Stocktake (bảng đếm kiểm kho) | cột số lượng | ⚠️ grep xác minh tên bảng/cột khi làm |
- **Bắt buộc grep sweep bổ sung** trước khi chốt danh sách: `rg "cartons|boxes|loose_picking|planned_" backend/migrations backend/src` — bảng nào lưu số thùng mà bảng trên chưa liệt kê (vd bảng in tem, weigh, gate) phải rà từng cái: chỉ nhân cột mang nghĩa "số lượng hàng", KHÔNG nhân cột đếm vật lý pallet/tem.
- `Material.cartons_per_pallet` **KHÔNG nhân** — vẫn là "thùng vật lý/pallet" (tem in thùng); pallet ước tính = `qty_base / hệ_số / cartons_per_pallet`.

### 2.2. Aggregate CROSS-MATERIAL phải chia hệ số (SUM base nhiều mã ≠ nghĩa)
Mọi chỗ đang `SUM(cartons_*)` qua nhiều mã → đổi thành `SUM(qty / COALESCE(hệ_số,1))` (ra "thùng quy đổi") hoặc đổi nhãn cột sang đơn vị base khi cùng mã. Danh sách RPC/điểm phải REPLACE:
`dashboard_stats` · `control_tower_stats` (v5) · `outbound_shortage_stats` · `slotting_stats` · inventory list/facets/summary (PostgREST aggregate `.sum()` → phải chuyển RPC hoặc tính JS chia hệ số) · cổng integration `/v1/inventory` + `scan-entries` (**thêm trường `qty_base` + `base_unit` + giữ trường thùng quy đổi** — ERP cần cả hai) · dashboard "Tồn (thùng)" / SummaryBand các trang.

### 2.3. Code sweep (BE ~358 + FE ~155 điểm — theo module)
- **Ghi (convert tại rìa):** inbound scan/manual (tem N thùng → `N×hệ_số`); outbound `scanItem`/`checkScanItem`/quick-export; **nhặt lẻ = đếm HỘP nguyên trực tiếp** (bỏ quy đổi thùng thập phân — luồng tự nhiên hơn); upload KH xuất cũ (thùng thập phân → `round(x×hệ_số)`); upload Tồn kho (cột thùng → ×hệ_số khi mã có entry, template ghi chú rõ); điều chỉnh tồn; dồn/tách pallet; chuyển kho/nhận hàng; RPC `consumeInventoryExact`/`adjustInventoryAtomic`/`addItemScanned` (chữ ký giữ, số truyền vào đã là base).
- **So sánh/gác:** mọi `>=`/khớp KH giữ nguyên phép toán (2 vế cùng base); gác "KH khớp thực quét mới Hoàn thành" giữ nguyên.
- **Hiển thị:** chỉ đổi RUỘT `qtyUnits` (đợt 1 đã gom) + các chỗ BE trả chuỗi.
- **QA suite** `scripts/qa/*`: invariant/race đọc-ghi số lượng → cập nhật theo base; chạy XANH là điều kiện đóng đợt.
- **Offline queue (PWA):** payload quét offline mang số thùng → **yêu cầu các kho đồng bộ hết hàng đợi TRƯỚC giờ freeze** (ghi vào kịch bản vận hành); replay sau flip bị BE từ chối theo version flag (thêm `qty_semantics: 'base'` vào payload mới, thiếu flag → 409 bắt cập nhật app).

### 2.4. Kịch bản vận hành flip (staging trước, production sau khi user nghiệm thu)
1. Chọn giờ trống + báo user; kho đồng bộ offline queue.
2. Backup: `CREATE TABLE x_backup_YYYYMMDD AS SELECT ...` cho mọi bảng ở 2.1.
3. Chạy migration ×hệ_số (1 transaction/bảng, JOIN Material, WHERE entry_unit IS NOT NULL).
4. **Verify số học:** per bảng per mã: `SUM(new) = SUM(old)×hệ_số` (script so backup) — lệch 1 dòng = dừng, rollback.
5. Deploy code base-semantics CÙNG cửa sổ (merge dev đã chứa code, bump rebuild-token).
6. QA suite full + smoke tay (nhập → tồn → xuất → nhặt lẻ → kiểm kho → dashboard) + Playwright.
7. Ngâm staging ≥ vài ngày vận hành thử → user gật → lặp kịch bản trên production.
8. Rollback path: restore backup + revert deploy (giữ backup tới khi user xác nhận xóa).

## ĐỢT 3 — "Up raw" SAP (xây TRÊN nền base)

Thiết kế nghiệp vụ đầy đủ ở `SAP_INTEGRATION_PLAN.md` mục 7 (đọc TRƯỚC). Tóm tắt phần thi công:
1. Bảng `erp_outbound_orders` (raw OD, unique `(od_number, od_item)`, source `EXCEL`/`SAP`) — cột theo mục 7; file mẫu thật: `Du lieu mau/vl06o.XLSX` + `Ke hoach dieu van.xlsm` (CHỈ ĐỌC).
2. Nút **"Up raw"** (1 nút, panel 2 khu vực): khu 1 nạp VL06O → raw; khu 2 nạp KH điều vận (`Ngày xuất·Số xe·SO·DO·Ship-to·Tên NPP·Loại xe·DVVT·Ưu tiên·Note`) → nhóm theo `Số xe` (group_code NGUYÊN VĂN) → sinh GDO/DO/items; **convert giờ RẤT đơn giản: qty base = Σ base các dòng OD** (CAR×hệ_số + HOP).
3. Mọi chi tiết lấy từ RAW; NPP cascade 4 bậc (danh mục ship-to code → tên VL06O → search term → lỗi); header_text = gộp 2 cột ghi chú; batch/%Date từ cột raw; STO (ship-to = kho nội bộ) chảy vào luồng chuyển kho có sẵn; chạy SONG SONG upload cũ; quyền `outbound.import`.
4. ⛔ **STOP 2:** mô hình dòng đơn — lõi base làm "1 dòng/mã (qty base, thùng/lẻ = DIV/MOD)" hợp lý trở lại, NHƯNG user từng chọn "2 dòng theo ĐVT" (vòng 9, trước khi chốt base). **Hỏi user chọn lại trước khi code phần sinh items.**
5. Test bằng chính 2 file mẫu: kỳ vọng 274 dòng raw · 13 chuyến/41 DO · 4 ca ship-to lệch phải lấy theo raw · hệ số suy từ Actual/Qty (48/24/20) khớp `units_per_carton`. Ghi staging phải DỌN SẠCH.

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
- [ ] Đợt 3: test 2 file mẫu đạt kỳ vọng, dọn sạch, user nghiệm thu trên Preview
- [ ] Cập nhật memory `base-unit-campaign` + `SCHEMA_REVIEW.md` sau mỗi đợt
