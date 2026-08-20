# KẾ HOẠCH: Loại kho theo TỪNG KHO + chiến thuật xuất/nhập 2 TẦNG (kho → loại kho)

> Lập 20/08/2026 (Fable — chỉ plan). Người thực thi: Opus, phiên sau. Làm trên branch `dev`.
> Yêu cầu gốc của user:
> 1. Mỗi kho có danh sách Loại kho RIÊNG thay vì mặc định dùng cả danh mục FG01/FG02… Kho hiện hành
>    tự có sẵn loại nó đang dùng (không phải khai lại). Tạo kho mới có lựa chọn "Copy format loại kho".
> 2. Mỗi kho có 1 chiến thuật xuất/nhập TỔNG (đã có từ 14–15/08), nhưng dưới đó TỪNG LOẠI KHO có
>    chiến thuật đặc trưng riêng (vd FG01 = FEFO, RM01 = FIFO trong cùng 1 kho).

---
## 0. DIỄN GIẢI + 3 QUYẾT ĐỊNH ĐÃ CHỐT HƯỚNG (user xác nhận lại trước khi code nếu thấy sai)

**⚠️ Chú ý tên gọi dễ lẫn:** cột `Warehouse.warehouse_type` = CENTRAL/NPP (**chức năng kho**), KHÔNG
liên quan. "Loại kho" trong yêu cầu này = taxonomy LookupValue category `warehouse_type`
(FG01/PM01/RM01/PA01/CT01… — mã SAP, có meta flags + sap map). Đặt tên mới phải tránh va: bảng mới
dùng `type_code`.

**Quyết định A — KHÔNG fork danh mục per kho; giữ danh mục TOÀN CỤC + bảng GÁN per kho.**
Mã loại kho là khóa so khớp của cả hệ: `Employee.allowed_categories` (scope), `Material.category`,
`Location.categories`, `GroupDeliveryOrder.warehouse_type` (chuỗi ghép `FG01+PM01`),
`booking_category`, map SAP, meta flags per loại (`warehouseTypeMeta`), RPC `rename_warehouse_type`.
Nếu mỗi kho tự định nghĩa mã riêng thì scope/đối chiếu SAP/multi-tenant vỡ hết. "Riêng" của user
= mỗi kho khai **TẬP loại nó vận hành** (+ chiến thuật riêng per loại), không phải hệ mã riêng.
→ Định nghĩa loại (mã, tên, meta, SAP) vẫn ở tab "Loại kho" WMSSettings như cũ.

**Quyết định B — Backfill kho hiện hành = TỰ ĐỘNG GÁN THEO DỮ LIỆU ĐANG DÙNG ∪ lưới an toàn.**
Backfill trong migration: mỗi kho hiện có nhận các loại xuất hiện trong
`WarehouseZone.categories` ∪ `Location.categories` ∪ DISTINCT `Material.category` của
`InventoryEntry` trong kho đó. Kho không dò ra loại nào (kho mới trống/kho QTY chưa có gì) → gán
**đủ mọi loại đang có** (không để kho 0 loại — sẽ chặn oan mọi form). Đúng ý "kho hiện hành có sẵn
loại kho đó để không mất công thêm". *Phương án thay thế đã cân nhắc: gán TẤT CẢ loại cho mọi kho
(zero-risk tuyệt đối nhưng user phải tự dọn từng kho — trái ý "tách ra"). Nếu user muốn an toàn hơn
thì đổi backfill sang phương án này, code không đổi.*

**Quyết định C — Hiệu lực chia 2 ĐỢT.** Đợt 1 (lõi): bảng gán + form Kho + copy khi tạo kho +
chiến thuật 2 tầng chạy thật trong engine rotation/putaway. Đợt 2 (lan tỏa): các form/option
Loại kho lọc theo kho đã chọn + guard ghi. Đợt 2 có danh sách consumer riêng (mục 6) — làm sau khi
Đợt 1 nghiệm thu, tránh 1 commit chạm 20 trang.

---
## 1. HIỆN TRẠNG (đã soi code 20/08 — file:line chính xác)

**Chiến thuật hiện hành đều ở CẤP KHO (cột trên `Warehouse`):**
- Xuất (rotation): `rotation_principle` (FEFO/FIFO/LIFO) + `rotation_required` — migration
  `20260814c_rotation_strategy.sql`. Nguồn luật duy nhất `backend/src/utils/rotation.ts`
  (`asRotationPrinciple`, `rotationSortKey`, `RotationCheck`…), mirror FE chỉ nhãn.
- Nhập (putaway): 8 cột `putaway_*` (priority CONSOLIDATE/SPREAD/ABC, enforced[], max_materials,
  date_mix, block_pick_face, block_qa_hold, block_full, single_ncc) — `backend/src/utils/putaway.ts`
  (`PUTAWAY_WH_COLS`, `putawayRulesOf`, `applyPutawayBody`, `putawayBlock/Batch`, `putawayScore`…).

**Điểm ĐỌC cấu hình (nơi phải chuyển sang resolve 2 tầng):**
1. `backend/src/services/putawayContext.ts` — `whConfig(warehouseId)` (cache 30s, invalidate qua
   `invalidatePutawayConfig`) cấp cho: `loadPutawayContext` (dòng 281–283), `guardPutaway`,
   `guardPutawayBatch` (dòng 142–144), `putawayTargetZones` (dòng 266). Consumer: listLocations
   picker (`putaway:1`), inbound scanQR/scanManual/setOrderLocation, bulk move, inventory.
2. `backend/src/controllers/wms/outboundController.ts` —
   `rotationConfigOf(warehouseIds)` (dòng 4557–4567, select `rotation_principle, rotation_required`
   per kho) cấp cho `checkScanItem`/`scanItem` (≈4876/4960) qua `rotationCheckOf`;
   `principleByWh` trong gợi ý "Vị trí lấy" FEFO (dòng 4526, entries select ở 4496 đã join
   `material:Material!material_id(shelf_life_days, supplier_shelf_life_overrides)` — CHƯA có
   `category`).
3. `backend/src/controllers/masterdata/warehouseController.ts` — create/update nhận
   `rotation_principle`/`rotation_required` + `applyPutawayBody` (dòng 140–194).

**FE:** form Kho trong `frontend/src/pages/wms/WMSSettings.tsx` (state `rotPrinciple`/`rotRequired`
+ `...putaway` spread, dòng ≈566–640). `RotationGate.tsx`/`PutawayHint` FE CHỈ hiển thị khối BE trả
— không tự tính (luật một nguồn, giữ nguyên nguyên tắc này).

**Taxonomy Loại kho:** LookupValue `warehouse_type` + `backend/src/utils/warehouseTypeMeta.ts` +
RPC `rename_warehouse_type` (đổi tên cascade **11 cột** — memory `warehouse-type-custom-flags`) +
RPC gác coverage cột category (memory `warehouse-type-taxonomy-sap`, QA mục 11 quét 603 cột).
FE options qua `useScopedWhTypes()` (28 file dùng) — scope theo user, KHÔNG theo kho.

`Material.category` = **1 giá trị đơn** per mã → resolve chiến thuật theo loại của MÃ HÀNG là xác
định duy nhất (chuỗi ghép `FG01+PM01` chỉ tồn tại ở cấp CHUYẾN, không dùng để resolve chiến thuật).

---
## 2. THIẾT KẾ

### 2.1 Schema — bảng `warehouse_type_configs` (1 bảng giải cả 2 yêu cầu)
```sql
-- backend/migrations/20260821_warehouse_type_configs.sql
CREATE TABLE warehouse_type_configs (
  id                       uuid PRIMARY KEY,
  warehouse_id             uuid NOT NULL REFERENCES "Warehouse"(id) ON DELETE CASCADE,
  type_code                text NOT NULL,           -- mã LookupValue warehouse_type (FG01…)
  -- Chiến thuật RIÊNG của loại này trong kho này. NULL = kế thừa cấp kho (mặc định).
  rotation_principle       text     NULL CHECK (rotation_principle IN ('FEFO','FIFO','LIFO')),
  rotation_required        boolean  NULL,
  putaway_priority         text     NULL CHECK (putaway_priority IN ('CONSOLIDATE','SPREAD','ABC')),
  putaway_enforced         text[]   NULL,
  putaway_max_materials    integer  NULL CHECK (putaway_max_materials BETWEEN 1 AND 1000),
  putaway_date_mix         text     NULL CHECK (putaway_date_mix IN ('ANY','SAME','NEWER_ONLY','OLDER_ONLY')),
  putaway_block_pick_face  boolean  NULL,
  putaway_block_qa_hold    boolean  NULL,
  putaway_block_full       boolean  NULL,
  putaway_single_ncc       boolean  NULL,
  -- 2 field MỚI của thang ưu tiên tường minh (mục 2.6) — cũng thêm cột tương ứng (NOT NULL kèm
  -- DEFAULT 'NONE'/'BY_CODE') vào bảng "Warehouse" trong CÙNG migration này:
  putaway_same_mat_date_pref text   NULL CHECK (putaway_same_mat_date_pref IN ('NONE','SAME_DATE','OLDER_FIRST','NEWER_FIRST')),
  putaway_fallback         text     NULL CHECK (putaway_fallback IN ('BY_CODE','EMPTY_FIRST','MOST_FREE','LEAST_FILLED')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL,
  updated_by               text NULL,
  UNIQUE (warehouse_id, type_code)
);
CREATE INDEX idx_wtc_warehouse ON warehouse_type_configs(warehouse_id);
```
- **Sự tồn tại của dòng = "kho này CÓ loại này"** (yêu cầu 1). Cột chiến thuật NULL hết = chỉ gán
  loại, dùng mặc định kho (yêu cầu 2 khi cần mới khai).
- Backfill trong CHÍNH migration (Quyết định B) + `DO $$ RAISE` nếu sau backfill còn kho active
  0 dòng (lưới go-live, học migration `20260814_role_flags`).
- KHÔNG cần realtime publication (config đọc qua cache 30s như putaway hiện tại); FE invalidate
  bằng invalidateQueries sau PUT.
- **Cascade đổi tên loại:** thêm `warehouse_type_configs.type_code` vào RPC `rename_warehouse_type`
  (cột thứ 12) — QUÊN là đổi tên loại xong mọi gán/chiến thuật per-loại mồ côi. Đăng ký cột vào
  RPC gác coverage (QA taxonomy mục 11) luôn.

### 2.2 Resolve 2 tầng — MỘT nguồn, thêm vào `utils/putaway.ts` (không mở file luật mới)
```ts
// Dòng override per (kho, loại). Trường NULL/undefined = kế thừa cấp kho.
export interface WhTypeConfigRow { type_code: string; rotation_principle?: ...; ... }

// Ghép: mặc định kho + override của ĐÚNG loại (theo Material.category của pallet/mã đang xét).
// category null / không có dòng / trường NULL → giữ nguyên hành vi cấp kho hiện tại (khớp 100% cũ).
export function resolveRotation(wh, typeRows, category): { principle, required }
export function resolvePutawayRules(wh, typeRows, category): PutawayRules
```
Luật ghép: per-field — trường nào override có giá trị thì thắng, không thì lấy của kho
(`putaway_enforced` cũng nguyên mảng thay thế, KHÔNG merge mảng — merge mảng là bản luật thứ hai).
Validator dùng lại `applyPutawayBody` + `asRotationPrinciple` cho từng dòng override (một nguồn).

**Điểm sửa (đúng 3 cụm, không lan):**
1. `putawayContext.whConfig` → trả `{ wh, typeRows }`: select Warehouse như cũ + select
   `warehouse_type_configs` theo `warehouse_id` (1 câu thêm mỗi 30s/kho — hoặc PostgREST embed
   `Warehouse.select('..., warehouse_type_configs(...)')` nếu FK nhận diện được; đo rồi chọn).
   `loadPutawayContext`/`guardPutaway`/`guardPutawayBatch`/`putawayTargetZones` gọi
   `resolvePutawayRules(wh, typeRows, incomingCategory)`.
   → **cần `category` của mã đang cất**: thêm `category` vào `MAT_SHELF_COLS`
   (`'id, category, shelf_life_days, supplier_shelf_life_overrides'`) + `IncomingInput.category?`
   cho caller nào đã có sẵn (khỏi query lại). Picker listLocations: material_id có sẵn → 1 câu
   Material đã nạp shelf-life dùng chung. guardPutawayBatch: lô nhiều mã có thể NHIỀU loại →
   resolve per pallet, `putawayBlockBatch` tách lô theo loại rồi chấm từng nhóm với rules của nhóm
   (giữ nguyên ngữ nghĩa gộp-tập trong từng nhóm; ràng buộc tập MAX_MATERIALS/NCC_MIX chấm trên
   rules CHẶT NHẤT trong lô — ghi rõ comment vì đây là ca duy nhất 2 loại chung 1 ô).
2. `outboundController.rotationConfigOf` → select thêm typeRows (chunk theo `warehouse_id`), trả
   resolver `(warehouseId, category) => {principle, required}` thay Map thô.
   - `rotationCheckOf` callers (checkScanItem/scanItem ≈4876/4960): material của item đã nạp cho
     shelf-life → thêm `category` vào select đó, resolve trước khi gọi.
   - Gợi ý "Vị trí lấy" (getFefoSuggestions, dòng 4496+4526): thêm `category` vào select
     `material:Material!material_id(...)`; dòng 4526 đổi thành resolver theo
     (warehouse_id, material.category).
   - **Bất biến giữ nguyên:** cùng 1 mã trong 1 kho chỉ có 1 principle (category là của mã) ⇒
     so sánh best-pallet trong `rotationCheckOf` vẫn cùng principle, không có ca trộn.
3. `warehouseController` + route mới quản lý bảng gán (mục 2.3).

**FE không thêm luật:** `RotationCheck`/`PutawayHint` BE trả đã có `principle`/`required` per lượt
— RotationGate/PutawayGate tự hiển thị đúng. Chỉ thêm chú thích nhỏ "(theo Loại kho X)" nếu
principle khác mặc định kho — BE thêm field `source: 'WAREHOUSE' | 'TYPE'` vào RotationCheck.

### 2.3 API (backend/src/routes/masterdata.ts + warehouseController)
- `GET  /masterdata/warehouses/:id/type-configs` — trả list dòng gán (+ echo mặc định cấp kho để FE
  render "— theo kho —"). Quyền: người đăng nhập đọc được (giống đọc Warehouse) hoặc
  `wms_settings.view` — theo route Warehouse hiện có, không siết hơn.
- `PUT  /masterdata/warehouses/:id/type-configs` — body `{ items: [{type_code, ...override?}] }`,
  **thay cả bộ** (diff trong controller: insert/update/delete theo unique key — LÔ, không per-row).
  Validate: type_code ∈ LookupValue `warehouse_type` đang active (400 nếu lạ); override qua
  `applyPutawayBody`/`asRotationPrinciple`; user non-full-scope loại: chỉ được thêm/bớt loại nằm
  trong `allowed_categories` của mình (không đụng dòng loại ngoài scope — giữ nguyên, cùng tinh
  thần khung giờ cargo ALL). Xong `invalidatePutawayConfig(warehouseId)`. INSERT nhớ
  `id: randomUUID()` + `updated_at` (luật 23502).
  Quyền: `requirePerm('wms_settings','manage_warehouse')` — cùng quyền form Kho, KHÔNG đẻ action
  mới (đây là 1 phần cấu hình kho, không phải capability tách rời).
- `createWarehouse` nhận thêm `copy_from_warehouse_id?: string` → sau khi insert kho, clone toàn bộ
  dòng `warehouse_type_configs` của kho nguồn (id mới, updated_at mới). Không copy = kho mới nhận
  **đủ mọi loại đang active, chiến thuật NULL** (mặc định an toàn — kho 0 loại sẽ chặn oan).

### 2.4 FE — form Kho (WMSSettings) + hooks
- `frontend/src/api/hooks.ts`: type `WhTypeConfig` + `useWhTypeConfigs(warehouseId)` +
  `useSaveWhTypeConfigs` (invalidate `['wh-type-configs', id]` + `['warehouses']`).
- Form Kho (FormSheet hiện có) thêm section **"Loại kho & chiến thuật riêng"** dưới khối chiến
  thuật tổng hiện tại:
  - Danh sách checkbox các loại (nguồn: hook loại kho ĐẦY ĐỦ — đây là trang quản trị, cùng ngoại lệ
    UserManagement/WMSSettings đã có; user non-full-scope chỉ tick được loại trong scope, loại
    ngoài scope hiện mờ + giữ nguyên).
  - Mỗi loại đã tick có nút mở rộng "Chiến thuật riêng" → cụm field GIỐNG HỆT khối tổng nhưng mỗi
    field có lựa chọn đầu **"— Theo kho —"** (= NULL). Tái dùng các control sẵn có của khối putaway
    trong form (tách component `StrategyFields` dùng chung 2 tầng để không chép 8 field 2 lần —
    đúng bài học `settings-form-standard`, khai component NGOÀI component cha kẻo mất focus).
  - Khối chiến thuật tổng hiện tại đổi nhãn thành "Chiến thuật mặc định toàn kho".
  - Lưu: PUT type-configs đi CÙNG lượt lưu form Kho (2 request nối tiếp, disable nút khi saving,
    lỗi banner đỏ inline).
- Form TẠO kho: thêm `SingleSelect` "Copy loại kho + chiến thuật từ kho…" (option = kho hiện có,
  serverSearch không cần — danh sách kho ~153 dòng, hook sẵn) → gửi `copy_from_warehouse_id`.

### 2.5 Đợt 2 — lọc option Loại kho theo kho (làm SAU nghiệm thu Đợt 1, commit riêng)
Hook mới `useWhTypesOfWarehouse(warehouseId)` = `useScopedWhTypes()` ∩ tập gán của kho
(warehouseId rỗng/"Tất cả" → như cũ). Consumer áp dần (mỗi chỗ: đổi hook + guard BE 422 khi ghi
category ∉ tập gán của kho — null-inclusive: bản ghi cũ loại lạ vẫn HIỂN THỊ, chỉ chặn GHI MỚI):
1. Tab Khu vực WMSSettings (form khu `categories`) + zoneController create/update.
2. Trang Vị trí kho: form + upload Excel (upload đã chặn theo WarehouseZone → tự hưởng lợi khi (1) xong).
3. Inbound tạo phiếu (CreateOrderDialog) + inboundController createOrder guard.
4. Upload KH xuất cột "Loại kho booking" (khvcController — thêm 1 phép kiểm trong pha preflight:
   booking_category ∉ tập gán kho → lỗi dòng).
5. Form khung giờ TMS (slot templates cargo) + form Sổ đóng gói mở trang (nếu có chọn loại).
6. GlobalScopePicker/FilterBar các trang: **GIỮ NGUYÊN theo scope user** (filter xem dữ liệu nhiều
   kho — lọc theo 1 kho sẽ làm mất chip hợp lệ; chỉ form GHI mới lọc theo kho). Ghi rõ để Opus
   không sweep nhầm 28 file.

### 2.6 SETTING TRÌNH BÀY THEO TÁC VỤ + thang ưu tiên TƯỜNG MINH (user yêu cầu 20/08 chiều)

> User: "các tác vụ Xuất, Nhập, Tối ưu… cần rõ ràng hơn trong setting — vd Nhập: chọn ưu tiên ghép
> cùng loại thì cùng loại date ngắn hay dài hơn, sau đó tới vị trí nào, và vị trí nào?"
> Hiện trạng: thang ưu tiên đang CỨNG trong `putawayScore` — Gom cùng mã: ① ô ★ cùng mã → ② mọi ô
> còn lại theo TÊN vị trí; date KHÔNG tham gia xếp hạng (chỉ ở tầng ràng buộc trộn date).

**2 FIELD MỚI cho tác vụ NHẬP** (trên `Warehouse` + nullable trên `warehouse_type_configs` —
default = đúng hành vi hôm nay, kho chưa chỉnh không đổi gì):
- `putaway_same_mat_date_pref` text CHECK IN ('NONE','SAME_DATE','OLDER_FIRST','NEWER_FIRST'),
  default 'NONE'. = **Bước 2**: trong các ô CÙNG MÃ, ưu tiên ô trùng date / ô chứa hàng phải-lấy-
  trước (date "cũ" hơn theo thứ tự lấy) / ô chứa hàng lấy-sau. Phát biểu theo THỨ TỰ LẤY (dùng
  `rotationSortKey`/`keyMin/keyMax` của SlotFacts so với `incoming.key`) — đúng cho cả FEFO lẫn
  FIFO/LIFO, không viết 3 nhánh (cùng kỷ luật với PUTAWAY_DATE_MIXES). Bật ≠ NONE thì
  `putawayNeedsLots` phải trả true (cần lots để so — sửa hàm này kèm).
- `putaway_fallback` text CHECK IN ('BY_CODE','EMPTY_FIRST','MOST_FREE','LEAST_FILLED'),
  default 'BY_CODE'. = **Bước 3**: hết nhóm ưu tiên thì các ô còn lại xếp theo tên vị trí (cũ) /
  ô trống trước / ô còn nhiều chỗ nhất (free ratio) / ô dở ít hàng nhất.

**Engine:** `putawayScore` trả điểm PHÂN SỐ (điểm nhóm hiện tại + phần thập phân từ Bước 2/Bước 3)
— ô bị chặn vẫn 100, nhóm ★ vẫn thắng tuyệt đối, chỉ tinh chỉnh THỨ TỰ TRONG nhóm ⇒ không phá bất
biến cũ. `putawayReason` không đổi (★ vẫn 3 mã lý do). Sort cuối ở listLocations giữ (score, tên).

**Form Kho (thay spec UI ở 2.4) — chia SECTION THEO TÁC VỤ, mỗi field là "bước" có số:**
- **"NHẬP — Cất hàng"**: Bước 1 = Ưu tiên nhóm ô (priority cũ, relabel) · Bước 2 = dropdown
  same_mat_date_pref (chỉ enable khi Bước 1 = Gom cùng mã; ABC cũng dùng được vì trong band vẫn gom
  cùng mã — enable luôn, ghi chú) · Bước 3 = dropdown fallback · dưới cùng khối **"Ràng buộc vị
  trí"** = 6 luật + Cảnh báo/Chặn cứng (field cũ, gom lại). Cuối section: **CÂU DIỄN GIẢI SỐNG**
  tự sinh từ giá trị đang chọn (vd "Kho sẽ gợi ý: ① ô đang chứa cùng mã (trùng date trước) → ② ô
  trống → ③ theo tên vị trí. Chặn cứng: ô đầy, ô nhặt lẻ.") — helper thuần FE
  `putawayExplain(rules)` đặt cạnh nhãn trong `frontend/src/utils/putaway.ts` (mirror nhãn, không
  luật).
- **"XUẤT — Lấy hàng"**: Nguyên tắc + Bắt buộc (cũ) + dòng diễn giải thang hòa-ngày CỐ ĐỊNH
  ("hòa ngày → khu gần cửa xuất (hạng nhặt Slotting) → ô ít hàng → tên vị trí") để user biết luật
  đang chạy. Knob đảo thứ tự hòa-ngày = **TÙY CHỌN, CHƯA làm** (user chưa chốt — ghi ĐỀ XUẤT cuối
  báo cáo khi giao).
- **Section per Loại kho** (2.4): mỗi loại render ĐÚNG 2 section trên qua component
  `StrategyFields` dùng chung, mọi field thêm lựa chọn đầu "— Theo kho —".
- Ghi chú trong form, cạnh Bước 1 = ABC: "Hạng khu & hạng ABC khai ở Tối ưu vị trí → Cài đặt"
  (Tối ưu là DỮ LIỆU NỀN dùng chung, không lặp setting ở form Kho).

---
## 3. KẾ HOẠCH THỰC THI (checklist — mỗi bước có phép kiểm)

1. **Migration `20260821_warehouse_type_configs.sql`** (bảng + backfill B + RAISE lưới + sửa RPC
   `rename_warehouse_type` thêm cột 12) → apply STAGING qua `scratchpad/apply_migration.mjs` →
   *kiểm:* SQL đếm — mọi kho active ≥1 dòng; kho Ba Vì có đúng các loại đang tồn; rename thử 1 loại
   trong transaction BEGIN…ROLLBACK thấy type_code đổi theo. Cập nhật `SCHEMA_REVIEW.md`.
2. **BE `utils/putaway.ts`**: `WhTypeConfigRow` + `resolveRotation` + `resolvePutawayRules` (+ unit
   logic thuần) → *kiểm:* `npx tsc --noEmit`; property-test nhanh trong scratchpad: mọi input có
   override NULL toàn bộ ⇒ output === cấu hình cấp kho (bất biến "không đổi hành vi cũ").
2b. **Thang ưu tiên tường minh (mục 2.6)**: mở rộng `PutawayRules` + `putawayRulesOf` +
   `applyPutawayBody` với 2 field mới; `putawayScore` điểm phân số Bước 2/Bước 3;
   `putawayNeedsLots` true khi same_mat_date_pref ≠ NONE → *kiểm:* property-test —
   (a) NONE+BY_CODE ⇒ thứ tự y hệt cũ; (b) SAME_DATE: ô cùng mã trùng date luôn đứng trước ô cùng
   mã khác date; (c) ô bị chặn vẫn cuối bảng bất kể Bước 2/3.
3. **`putawayContext.ts`**: whConfig trả kèm typeRows (cache 30s chung, invalidate như cũ);
   `MAT_SHELF_COLS` + `IncomingInput.category`; resolve trong loadPutawayContext / guardPutaway /
   guardPutawayBatch (tách lô theo loại) / putawayTargetZones → *kiểm:* gói QA 26-putaway hiện có
   phải XANH nguyên (hồi quy = 0 khi chưa khai override).
4. **`outboundController.ts`**: rotationConfigOf → resolver theo category; thêm `category` vào 2
   select material (≈4496, ≈4876/4960); RotationCheck thêm `source` → *kiểm:* gói QA 25-rotation
   XANH nguyên; `npx tsc --noEmit`.
5. **API type-configs** (GET/PUT + copy_from trong createWarehouse) + bump rebuild-token →
   *kiểm:* fuzz nhanh: type_code lạ → 400, principle bậy → 400, non-admin thiếu quyền → 403,
   PUT round-trip GET khớp (khuôn gói 23 settings).
6. **FE form Kho + hooks + form tạo kho copy** → *kiểm:* `tsc --noEmit` + `npm run build`;
   Playwright 1280/390: mở form Kho thấy section mới, lưu override, mở lại thấy đúng; tạo kho copy
   → GET type-configs kho mới khớp kho nguồn.
7. **QA mới — LUẬT BUG CHẾT HAI LẦN**: mở rộng gói 25 + 26 (hoặc gói mới `29-wh-type-strategy.mjs`
   đăng ký vào `run-all.mjs`): fixture 1 kho default FEFO+required, override RM01=FIFO không
   required → (a) quét mã FG sai FEFO = 422 ROTATION_VIOLATION; (b) quét mã RM sai FEFO nhưng đúng
   FIFO = 200 (chứng minh override ăn); (c) mã RM sai FIFO = cảnh báo không chặn (required=false
   per loại); (d) putaway date_mix override per loại chặn đúng nhánh; (e) PUT type-configs
   round-trip + xóa dòng → resolve rơi về mặc định kho. Fixture backup/restore cấu hình kho qua
   API (bài học QA 26: đổi cấu hình QUA API vì cache 30s per-instance).
8. **Chạy `node scripts/qa/run-all.mjs` FULL XANH** → push dev → verify Preview sống (khuôn
   verify_move/verify_ct trong scratchpad) → báo user nghiệm thu.
9. **Đợt 2** (mục 2.5) — sau khi user duyệt Đợt 1, commit riêng từng cụm consumer + guard BE,
   mỗi cụm kèm phép kiểm 403/422 + option đúng.

---
## 4. RỦI RO & BẪY (Opus đọc kỹ trước khi code)

- **Không đổi hành vi khi chưa khai override** là tiêu chí số 1: mọi đường resolve phải có
  fallback = đúng giá trị cấp kho hiện tại (test bước 2 + gói 25/26 nguyên trạng gác).
- **Cache 30s per serverless instance** (whConfig): sau PUT type-configs, instance khác có thể giữ
  bản cũ ≤30s — hành vi đã chấp nhận ở putaway, QA phải đổi cấu hình QUA API + chờ/ép như gói 26.
- **Lô nhiều loại trong guardPutawayBatch** là ca duy nhất 2 bộ rules đụng 1 ô — tách nhóm theo
  loại, ràng buộc tập chấm theo rules chặt nhất; ghi comment nêu ví dụ cụ thể.
- **`putaway_enforced` override = THAY THẾ nguyên mảng**, không merge — merge là bản luật thứ 2.
- **RPC `rename_warehouse_type` + RPC gác coverage taxonomy**: quên đăng ký cột mới = đổi tên loại
  xong bảng gán mồ côi ÂM THẦM (đúng lớp lỗi memory `warehouse-type-taxonomy-sap` — bản đồ ghi tay
  từng sót 3 chỗ).
- **INSERT thiếu `id`/`updated_at` = 23502** (bảng mới không default id).
- Ratchet hiện có phải giữ: `rotation_rule_hand_rolled` (không tự so ngày ở FE),
  `unpaginated_in_query` (select typeRows theo warehouse_id phải `.limit`/chunk — 1 kho ~≤20 loại
  nhưng vẫn khai limit cho sạch ratchet), không `as any` mới.
- Sửa `backend/src` → **bump rebuild-token** `api/index.ts`. Migration: STAGING trước, production
  chỉ khi merge main (SCHEMA_REVIEW ghi "⏳ chờ merge").
- `Template upload.xlsx` không đụng, không `git add -A`.

## 5. NGOÀI PHẠM VI (nói rõ để không phình)
- Không đổi taxonomy/meta flags/SAP map (vẫn toàn cục, tab Loại kho như cũ).
- Không đổi scope quyền `allowed_categories` (vẫn theo user, độc lập tập gán của kho).
- Filter/list page KHÔNG lọc option theo kho (chỉ form ghi, Đợt 2).
- Không per-type cho các cờ ngoài chiến thuật (carton_scan_categories, require_gate/weigh… giữ cấp kho).
- Knob đảo thứ tự hòa-ngày của XUẤT (khu gần cửa ↔ ô ít hàng): CHƯA làm, chỉ hiển thị diễn giải
  thang cố định trong form (mục 2.6) — nêu thành ĐỀ XUẤT cho user chốt sau.
