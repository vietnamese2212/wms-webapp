# Schema Review – WMS Webapp

> Cập nhật lần cuối: 2026-05-10 (rev 13 — Customer table removed, not needed)
> Database: PostgreSQL via Supabase · client: `@supabase/supabase-js` (service role)

---

## Kiến trúc vị trí kho

```
Warehouse  →  Location (embed sub_code / sub_name / sub_type)
BV_TP1_1_T1 = {warehouse.code}_{sub_code}_{row}_{shelf}
```

`location_code` tự sinh trong backend, user không nhập. Sub-group lấy qua `GET /masterdata/locations/sub-groups?warehouse_id=`.

---

## Trạng thái Model

| Model | Mục đích | Trạng thái |
|---|---|---|
| `Warehouse` | Kho lớn (Ba Vì, Bàu Bàng) | ✅ API + seed |
| `Location` | Vị trí kho (embed sub info) | ✅ API + seed |
| `Material` | Danh mục hàng hóa | ✅ API + seed |
| `Manufacturer` | Nhà máy sản xuất (NMSX) | ✅ API + seed |
| `Department` | Phòng ban + module access | ✅ API + seed (rev 11) |
| `JobTitle` | Chức danh — permission template | ✅ API + seed (rev 11) |
| `Employee` | Nhân viên — action_level, categories, scope | ✅ API đầy đủ (rev 11) |
| `UserWarehouseAccess` | Kho được phép của từng nhân viên | ✅ API + migrate (rev 11) |
| `ImportShift` | Ca nhập (Ca 1/2/3, HC) | ✅ seed sẵn |
| `QAStatus` | Tình trạng QA (X, X CQ, X7, OK) | ✅ seed sẵn |
| `ProductionImport` | Phiếu nhập kho (bảng cha) | ✅ API đầy đủ |
| `InventoryEntry` | Pallet tồn kho | ✅ API đầy đủ |
| `ExportHistory` | Lịch sử xuất kho | ⏳ bảng cũ, thay bằng `OutboundScanEntry` |
| `GroupDeliveryOrder` | Chuyến xe (Số xe) — nhóm các DO | ✅ API + UI (rev 12) |
| `DeliveryOrder` | Phiếu giao hàng SAP (Delivery) | ✅ API + UI (rev 12) |
| `DeliveryOrderItem` | Dòng mặt hàng trong DO | ✅ API + UI (rev 12) |
| `OutboundScanEntry` | Log QR scan xuất kho | ✅ API (rev 12) |
| `LocationTransfer` | Chuyển vị trí pallet | ✅ bảng tạo sẵn |
| `Vehicle` / `Driver` | TMS — xe + tài xế | ⏳ bảng tạo, chưa có API |
| `Menu` / `Setting` | Phân quyền menu, cài đặt | ⏳ bảng tạo, chưa dùng |

---

## Schema các bảng chính

### Warehouse
```sql
id TEXT PK, code TEXT UNIQUE, name TEXT, address TEXT,
warehouse_type TEXT, inventory_mode TEXT, nmsx_code TEXT,
shipto_codes TEXT[] DEFAULT '{}',  -- mã ship-to phụ; auto-detect chuyển kho khớp code HOẶC phần tử mảng này
is_active BOOL DEFAULT true, created_at, updated_at
```

### Location
```sql
id TEXT PK, warehouse_id TEXT FK,
sub_code TEXT,        -- "TP1", "NL1"
sub_name TEXT,        -- "Thành phẩm 1"
sub_type TEXT,        -- "THANH_PHAM" | "NGUYEN_LIEU" | "BAN_THANH_PHAM"
location_code TEXT UNIQUE,  -- "BV_TP1_1_T1" (auto-generated)
row TEXT, shelf TEXT, max_pallets INT DEFAULT 1,
is_active BOOL DEFAULT true, created_at, updated_at
```

### Manufacturer
```sql
id TEXT PK, code TEXT UNIQUE, name TEXT,
is_active BOOL DEFAULT true, updated_at
```

### Material
```sql
id TEXT PK, material_code TEXT UNIQUE, material_description TEXT,
short_name TEXT,          -- auto: "{desc} [{3 số cuối code}]"
custom_short_name TEXT,   -- user override (suffix giữ nguyên)
category TEXT,            -- "Thành phẩm" | "NVL" | "POSM" | "Bao bì"
product_type TEXT, unit TEXT,
weight_kg DECIMAL, cartons_per_pallet INT, cartons_per_pallet_mn INT,  -- _mn DEPRECATED (thay bằng warehouse_pallet_overrides)
units_per_carton INT, pallet_per_ea NUMERIC,  -- pallet_per_ea: 1 EA = ? pallet (NVL), quy đổi tồn EA→pallet
shelf_life_days INT, storage_category TEXT,  -- "UHT" | "Fresh" | "Frozen"
old_code TEXT, image_url TEXT,
batch_prefix TEXT,        -- ĐV2 tem `;`: 2 ký tự tắt hàng để sinh mã lô V2 (TA260705A018); null ĐV1
manufacturer_id TEXT FK, notes TEXT,
is_active BOOL DEFAULT true, created_at, updated_at
```
Filter API: `?category=`, `?storage_category=`, `?manufacturer_id=`, `?search=` (code/description/short_name/old_code)

### Employee
```sql
id TEXT PK, warehouse_id TEXT FK,
name TEXT, employee_code TEXT UNIQUE,
role TEXT,   -- "OWN" | "ADMIN" | "WAREHOUSE_MANAGER" | "WAREHOUSE_STAFF" | "DRIVER" | "HR_MANAGER"
department TEXT, phone TEXT, email TEXT UNIQUE, password TEXT (bcrypt),
is_active BOOL DEFAULT true, created_at
```

### ImportShift
```sql
id TEXT PK, code TEXT UNIQUE, name TEXT  -- Ca 1, Ca 2, Ca 3, HC
```

### QAStatus
```sql
id TEXT PK, code TEXT UNIQUE, label TEXT  -- X, X cảm quan, X 7, OK
```

### ProductionImport (phiếu nhập)
```sql
id TEXT PK, import_code TEXT UNIQUE,
warehouse_id TEXT FK, location_id TEXT FK, material_id TEXT FK,
shift_id TEXT FK,        -- Ca nhập
planned_pallets INT, status TEXT,  -- "OPEN" | "COMPLETED" | "CANCELLED"
imported_by TEXT FK(Employee), created_by TEXT FK(Employee), updated_by TEXT FK(Employee),
location_history JSONB DEFAULT '[]',  -- lịch sử đổi vị trí: [{location_code, by_id, by_name, at, source:'scan'|'detail'}] (migration 20260619)
ncc_id UUID FK(TransportCompany),  -- NCC của phiếu (cho HSD ngoại lệ theo NCC); nullable: SX/chuyển kho = HSD mặc định (migration 20260628)
notes TEXT, created_at, updated_at
```
> Mô hình **"1 phiếu = 1 vị trí" = vị trí CHỌN CUỐI CÙNG**: quét/đổi vị trí → persist `location_id` (vị trí hiện tại) + append `location_history`. KHÔNG giới hạn số vị trí (không có "tràn"). UI hiện 1 vị trí (order.location) + **cảnh báo ⚠** nếu có pallet nằm ở vị trí khác (không tự dời dữ liệu).

### InventoryEntry (pallet tồn kho)
```sql
id TEXT PK, pallet_code TEXT UNIQUE,
location_id TEXT FK, material_id TEXT FK, manufacturer_id TEXT FK,
cycle TEXT,              -- chu kỳ sản xuất (bóc từ QR)
machine_code TEXT,       -- mã máy (bóc từ QR)
pallet_sequence_no INT,  -- vị trí 5 trong QR
stack_layer INT DEFAULT 1,  -- 1=sàn (tính slot), 2/3=chồng (không tính slot)
cartons_imported INT, production_date TIMESTAMP,
qa_status_id TEXT FK,
status TEXT DEFAULT "IN_STOCK",  -- "IN_STOCK" | "EXPORTED" | "TRANSFERRED" | "PARTIAL"
import_order_id TEXT FK(ProductionImport),
ncc_id UUID FK(TransportCompany),  -- denormalize từ phiếu khi quét; cho HSD ngoại lệ theo NCC (migration 20260628)
shelf_life_days INT,  -- shelflife chọn theo LÔ khi nhận (1 mã+1 NCC có thể nhiều shelflife); ưu tiên hơn override-theo-NCC (migration 20260628_02)
batch TEXT,          -- tem V2 (`;` ĐV2): mã lô nguyên văn (TA+yymmdd+Máy+SEQ); NULL với tem `_` (migration 20260707)
expiry_date DATE,    -- tem V2: HSD tường minh từ tem; NULL → %Date fallback shelf-life như cũ (migration 20260707)
created_by TEXT FK(Employee), updated_by TEXT FK(Employee),
created_at, updated_at
```

**Logic `stack_layer`:** chỉ đếm `stack_layer = 1` vào `used_slots`. Layer 2/3 chồng lên, không tính capacity.

---

## Lưu ý INSERT bắt buộc

- `id TEXT NOT NULL` — không có `DEFAULT` → phải truyền `id: randomUUID()`
- `created_at TIMESTAMP NOT NULL` — phải truyền `created_at: new Date().toISOString()` để đảm bảo suffix `Z` (UTC rõ ràng)
- `updated_at TIMESTAMP NOT NULL` — không có `DEFAULT` → phải truyền `updated_at: new Date().toISOString()`

---

## Changelog

| Ngày | Rev | Thay đổi |
|---|---|---|
| 2026-05-07 | 1–8 | Setup, Material fields, Location 2-table (bỏ SubWarehouse), Employee |
| 2026-05-07 | 9 | ProductionImport + InventoryEntry refactor đầy đủ, WMS Inbound API |
| 2026-05-08 | 10 | ImportShift, QAStatus, `pallet_sequence_no`, `qa_status_id`, `shift_id` |
| 2026-05-08 | — | Supabase Realtime bật tất cả bảng `public` + event trigger auto-add bảng mới |
| 2026-05-09 | — | Chuẩn INSERT `randomUUID()` + `updated_at` bắt buộc |
| 2026-05-09 | 11 | Permission system: `Department`, `JobTitle`, `UserWarehouseAccess`, mở rộng `Employee` (action_level, allowed_categories, warehouse_scope). Backend `permissions.ts` với `can()` + `loadActor()`. API + UI User Management |
| 2026-05-09 | 12 | Outbound module: `GroupDeliveryOrder`, `DeliveryOrder`, `DeliveryOrderItem`, `OutboundScanEntry`. `InventoryEntry.cartons_imported` → DECIMAL, thêm `cartons_remaining`. Excel upload, QR scan với QA block + tịnh tiến logic. |
| 2026-05-10 | 13 | `GroupDeliveryOrder` thêm `warehouse_type TEXT`. Excel template thêm cột "Kho xuất" (match Warehouse by name/code) và "Loại kho" (lưu vào warehouse_type). |
| 2026-06-13 | — | `PalletLabelPrint` — log truy vết in tem pallet (qr_code, material_code, cycle/machine/seq/nmsx, qty, mode GENERATE/REPRINT, printed_by/printed_by_name, created_at). Migration `20260613_pallet_label_print_log.sql`. Phục vụ module In tem pallet (tra cứu in mấy lần, ai in). |
| 2026-06-14 | — | `PalletLabelPrint.batch_id` (uuid) — gom các tem in cùng 1 lệnh. Migration `20260614_pallet_print_batch_id.sql`. Phục vụ tab Lịch sử in. |
| 2026-06-15 | — | Dồn/Tách pallet: `InventoryEntry.parent_pallet_code` (tem con đã dồn → mã tem đích) + `InventoryEntry.origin` ('IMPORT'/'SPLIT'). Bảng `PalletOperation` (type MERGE/UNGROUP/SPLIT, source_codes[], target_codes[], detail jsonb, operated_by). Migration `20260615_pallet_merge_split.sql`. Tách giữ `cartons_imported` gốc bất biến + con `import_order_id=NULL` → báo cáo nhập không đổi. |
| 2026-06-15 | — | HR Lịch làm việc & Chấm công (nền tảng): `Skill`, `EmployeeSkill` (priority 1=chính), `LeaveRequest`, `WorkAssignmentSheet`/`Demand`/`WorkAssignment`, `Attendance` (kind CA1/CA2/CA3/HC/LEAVE + ot_hours + early_leave_hours). `Department.requires_scheduling`. Migration `20260615_hr_schedule_attendance.sql`. RLS + anon SELECT cho Realtime. |
| 2026-06-15 | — | HR: `Skill` chuyển sang thuộc **Chức danh** (`job_title_id`, bỏ warehouse/department). Migration `20260615_hr_skill_jobtitle.sql`. |
| 2026-06-15 | — | HR Layout: `WorkLayout` (mẫu theo `warehouse_id`, name) + `WorkLayoutSkill` (skill + required_count). `WorkAssignmentSheet` đổi `department_id`→`layout_id`, unique (work_date, layout_id). Migrations `20260615_hr_layout.sql` + `_finalize.sql`. Tạo lịch = chọn Kho+Layout+Ngày → demand tự đổ; auto-assign lấy NV có quyền kho + có skill trong layout. |
| 2026-06-16 | — | HR: `JobTitle.parent_id` + `in_chart` (sơ đồ tổ chức). Skill `EmployeeSkill` scope mở rộng: cấp trên gán được skill của chức danh cấp dưới (walk parent_id). Migrations `_jobtitle_hierarchy.sql`, `_jobtitle_in_chart.sql`. |
| 2026-06-16 | — | HR Layout: `WorkLayoutJobTitle` (layout ↔ chức danh, để gọi đúng pool người). `WorkLayoutSkill.note` + `WorkAssignmentDemand.note` (ghi chú vị trí). Migrations `20260616_layout_jobtitle.sql`, `20260616_layout_demand_note.sql`. |
| 2026-06-28 | — | Ngoại lệ HSD theo NCC: `ProductionImport.ncc_id` + `InventoryEntry.ncc_id` (UUID FK `TransportCompany`, nullable). Lấy NCC ở phiếu nhập (NCC bắt buộc; SX/chuyển kho tùy chọn) → denormalize xuống pallet khi quét → `effShelfLife(material, ncc_id)` áp `supplier_shelf_life_overrides` cho %Date. Migration `20260628_add_ncc_id_for_shelflife.sql`. |
| 2026-07-08 | — | Multi-tenant ĐV2 tem `;`: `Material.batch_prefix` (TEXT nullable) = 2 ký tự tắt hàng để SINH mã lô V2 từ app (tab Sinh tem). Mã lô = `batch_prefix + yymmdd + Máy + SEQ` (TA260705A018), khớp mã lô kế toán. Ô "Mã tắt (mã lô)" hiện trong form Mã hàng chỉ khi cờ `label_format='semicolon'`. Migration `20260707_material_batch_prefix.sql`. |
| 2026-06-28 | — | Shelflife theo LÔ: `InventoryEntry.shelf_life_days` (INT nullable). 1 mã + 1 NCC khai được nhiều shelflife (100/200 ngày); chọn lúc quét (selector NCC-biến-thể trong InboundScanSheet) → lưu thẳng trên pallet. %Date ưu tiên `shelf_life_days → override-NCC(khi 1 giá trị) → Material.shelf_life_days`. Chuyển kho kế thừa shelf_life_days + ncc_id từ pallet gốc cùng pallet_code. Migration `20260628_02_inventory_shelf_life_days.sql`. |
| 2026-06-16 | — | HR: `ShiftRestRule` (from_shift→to_shift bị cấm) — luật nghỉ giữa ca, KHÔNG hardcode; auto-assign đọc phân công ngày D-1 + bảng này để loại ca vi phạm. Seed: CA3→{CA1,CA3,HC}. Migration `20260616_shift_rest_rule.sql`. |
| 2026-06-17 | — | HR Phân công: UNIQUE index `(work_date, layout_id)` — mỗi layout chỉ 1 phiếu/ngày. Migration `20260617_uniq_assignment_sheet_per_day.sql`. |
| 2026-06-18 | — | Omni-search bỏ dấu server-side: `CREATE EXTENSION unaccent` + RPC `omni_material_ids(term)` / `omni_location_ids(term)` (unaccent ilike, trả id). Migration `20260618_unaccent_search.sql`. Phục vụ ô tìm kiếm Inventory 1-ô (pallet/mã+tên hàng/vị trí, gõ không dấu vẫn ra). Controller fallback ilike nếu chưa apply. |
| 2026-06-23 | — | Đặt lịch TMS — kế toán slot NGUYÊN TỬ chống overbooking/drift khi hàng trăm user đặt cùng lúc. RPC `book_vehicle_slot(vslot,new_slot,plate,status,actor)` (kiểm sức chứa bằng ĐẾM SỐNG biển-distinct dưới row-lock, KHÔNG tin `booked_count`) + `recount_slot(slot)`. `DeliverySlot.booked_count` thành CACHE hiển thị. CHECK `booked_count BETWEEN 0 AND max_vehicles`. Migration `20260623_atomic_slot_booking.sql` (ĐÃ apply). `try_book_slot` cũ còn trong DB nhưng KHÔNG còn code gọi (dead). Verify: 1800 request đồng thời → 0 overbooking, 0 drift. |
| 2026-06-29 | — | `Warehouse.shipto_codes text[]` — 1 kho nhiều mã ship-to. Auto-detect chuyển kho (`maybeAutoCreateTransferOrder`) khớp `shipto_party = code` HOẶC phần tử trong `shipto_codes`. Migration `20260629_warehouse_shipto_codes.sql` (CHỜ apply). Quản ở form Kho + upload cột shipto_codes; chặn 1 ship-to thuộc >1 kho. |
| 2026-06-29 | — | `TransportCompany.alias_codes text[]` — 1 NCC/ĐVVT nhiều mã ERP. Upload (kế hoạch xuất/nhập, tồn, xe) khớp `code` HOẶC `alias_codes` → cùng 1 id; HSD ngoại lệ + báo cáo gộp. Migration `20260629_ncc_alias_codes.sql` (CHỜ apply) — đồng thời GỘP các bản trùng (type, tên): giữ 1 primary, gom code còn lại vào alias_codes, xóa bản phụ. Quản ở form ĐVVT + upload cột alias_codes; chặn trùng mã giữa các NCC. |
| 2026-06-24 | — | Đăng ký cổng — xe "kết hợp" (vừa Nhập vừa Xuất cùng Loại kho): `gate_registrations.visit_group_id uuid` (+ index `idx_gate_reg_visit_group`). 1 lần đăng ký Hướng="Nhập + Xuất" tách thành **2 record 1 chiều** (INBOUND+OUTBOUND) chung `visit_group_id`. KHÔNG lưu record nào là "BOTH" → cỗ máy match/relink booking giữ NGUYÊN, mỗi chân match như đăng ký 1 chiều → không lỗi TMS booking. Migration `20260624_gate_visit_group.sql` (CHỜ apply). |
| 2026-07-01 | — | `InventoryEntry` — partial UNIQUE index `uq_inventory_active_wh_pallet (warehouse_id, pallet_code) NULLS NOT DISTINCT WHERE status active`. Chống tạo pallet TRÙNG khi quét ĐỒNG THỜI (race read-then-insert scanQR/scanManual). Composite THEO KHO (KHÔNG global) vì hàng no-QR (Loscam/POSM) dùng `pallet_code=mã hàng`, cùng mã ở NHIỀU kho là hợp lệ → global sẽ chặn oan kho thứ 2. scanQR nay set `warehouse_id`; NULLS NOT DISTINCT để entry QR cũ (wh null) vẫn dedup theo pallet_code. Handler đã bắt 23505→409. Migration `20260701_inventory_active_pallet_unique.sql` (apply qua pg CONCURRENTLY). Verify: 6-8 quét cùng mã đồng thời → 1 OK + còn lại 409 (trước fix: N pallet ảo). Phát hiện Mốc 3; sửa phạm vi theo góp ý no-QR. |
| 2026-07-01 | — | `InventoryAdjustmentLog` — đổi `delta`/`cartons_before`/`cartons_after` INTEGER → **numeric**. Trước: cột integer nhưng `cartons_remaining` là numeric (thập phân, vd 7004.875) → INSERT log thất bại, `adjustInventory` nuốt lỗi (console.error) → audit log điều chỉnh tồn KHÔNG BAO GIỜ ghi (0 dòng toàn hệ thống). Không đổi code. Migration `20260701_adjustment_log_numeric.sql` (apply qua pg). Verify: adjust +1 pallet thập phân → log ghi đúng before=7004.875/after=7005.875. Phát hiện Mốc 5 test vận hành. |
| 2026-07-02 | — | Kế hoạch VC cho SỐ LẺ Thùng/Pallet: `TmsOrder.planned_boxes/planned_pallets` + `inbound_plan_lines.planned_boxes/planned_pallets` INTEGER → **numeric** (file KH thật có 515.5 → integer chết "invalid input syntax"). Chỉ bảng KẾ HOẠCH — thực xuất/tồn thật vẫn nguyên. Migration `20260702_planned_qty_numeric.sql` (CHỜ apply). |
| 2026-07-01 | — | **PostgREST aggregate** bật lại: `ALTER ROLE authenticator SET pgrst.db_aggregates_enabled='true'` + `NOTIFY pgrst,'reload config'` (mặc định PostgREST v12 = TẮT). Cho phép `.select('col.sum()')` gom phía DB. `listInventory` tổng thùng tồn = 1 query SUM (tái dùng NGUYÊN `applyInventoryFilters` → tổng khớp tuyệt đối list) thay vì kéo ~4000 dòng về Node (**5.2s→~0.3s**). `listFacets` phân trang SONG SONG (trang 1 lấy count exact + bắn các trang còn lại đồng thời) thay tuần tự (**4.9s→~1.3s**). An toàn dữ liệu: RLS đã có policy `anon_select` (qual=true) trên InventoryEntry/Material/Location → anon vốn đọc hết, aggregate KHÔNG mở thêm dữ liệu. Migration `20260701_enable_pgrst_aggregates.sql` (apply qua pg + DIRECT_URL). |
| 2026-07-05 | — | RPC `move_pallets_to_location` — đếm sức chứa LOẠI pallet tồn=0 (`AND cartons_remaining > 0`). Upload tồn nay nhận tồn=0 (~31k bản ghi IN_STOCK remaining=0 còn gắn location) → pallet hết hàng bị đếm chiếm slot → 134 vị trí báo "đầy" oan. Các count JS cùng họ đã sửa cùng commit (inbound suggest/scan LOCATION_FULL, listLocations `used_slots`/`has_same_material`, getLocation, move fallback) + search tồn khả dụng (fetchMaterialInventory, prepare FEFO) bỏ tồn=0. Migration `20260705_move_pallets_exclude_zero.sql` (CHỜ apply — RPC đang deployed nên tới khi apply, riêng luồng DỒN VỊ TRÍ vẫn đếm cả tồn=0; các luồng JS đã đúng ngay). |
| 2026-07-05 | — | Dashboard tổng quan DATA THẬT: RPC `dashboard_stats(p_warehouse_ids text[], p_categories text[], p_today date)` trả jsonb `{inventory: [kho×loại: pallets/cartons/materials], today: {inbound_orders/inbound_cartons/outbound_gdos/outbound_planned/outbound_scanned}}` — aggregate phía DB (InventoryEntry sẽ hàng triệu dòng). Kiểu cột đã verify: `Warehouse.id`/`Material.id` TEXT, `InventoryEntry.warehouse_id` uuid (join cast `::text`), `ProductionImport`/`GDO.warehouse_id` text. BE `GET /wms/dashboard` (auth-only, cắt scope kho+loại JWT) có FALLBACK JS phân trang khi RPC chưa apply → app chạy được ngay, apply xong tự nhanh. Migration `20260704_dashboard_stats.sql` (CHỜ apply; SELECT tương đương đã test khớp 4001 pallet/454256.213 thùng). |
| 2026-07-05 | — | RPC `outbound_shortage_stats(p_warehouse_id text, p_date date)` — cảnh báo thiếu tồn Xuất/Nhặt lẻ theo (kho, ngày giao): demand = còn phải xuất (đặt−quét) MỌI đơn chưa hủy trong ngày theo mã; available = tồn LOẠI QA giữ (`qa_status_id IS NULL`) + LOẠI QUARANTINE (kể entry location NULL qua `ie.warehouse_id::text`); planned = KH nhập (`inbound_plan_lines` ACTIVE, ngày hôm-nay-VN→ngày giao) TRỪ thực đã nhập từng chuyến (`InventoryEntry.cartons_imported` qua ProductionImport→`tms_order_id` hoặc gate→order). BE `GET /wms/outbound/shortages` (level 1 = tồn+KH đủ / 2 = vẫn thiếu) trả rỗng nếu RPC chưa apply. Migration `20260705_outbound_shortage_stats.sql` (CHỜ apply; SELECT tương đương verify Ba Vì 04/07: mã 157 demand 699/avail 420.283). |
| 2026-07-07 | — | **Multi-tenant cờ hệ thống + QR v2 (tem `;` ĐV2)**: bảng `SystemSetting` (key TEXT PK, value jsonb, updated_by, updated_at — realtime; cờ đầu tiên `label_format` 'underscore'/'semicolon' chỉ chiều IN tem) + `InventoryEntry.batch` TEXT (mã lô nguyên văn) + `InventoryEntry.expiry_date` DATE (HSD tường minh từ tem) + partial index `idx_inventory_entry_batch`. Parser `qrParser.ts` 2 nhánh theo delimiter (v2: 7 đoạn trim space, QA 1=OK/khác=X, Máy+SEQ trích từ mã lô, NSX/HSD dd/mm/yyyy parse thành phần); `normalizeQR` áp mọi điểm quét (inbound/outbound/stocktake/pallet-ops). Migration `20260707_systemsetting_qr_v2.sql` (ĐÃ apply STAGING 07/07; production LOF apply khi merge main). |
| 2026-07-10 | — | **Loại kho TÙY BIẾN (multi-tenant)**: `LookupValue.meta` jsonb NOT NULL DEFAULT '{}' — cờ hành vi per-loại (`is_ncc_goods` thay NCC_CATEGORIES hardcode, `requires_shelf_life`/`requires_pallet_per_ea` thay luật form Mã hàng, `batch_char` = ký tự thế chỗ Máy trong mã lô khi Sinh tem V2 (ĐV2: Nguyên liệu='N'), `badge_color`). Seed cờ 5 loại hiện có = đúng hành vi cũ. RPC `rename_warehouse_type(old,new)` SECURITY DEFINER — đổi tên loại kho CASCADE 1 giao dịch 11 cột text: LookupValue + Material/Location/WarehouseZone.category + Employee.allowed_categories[] + SlotTemplate/DeliverySlot.cargo_type + TmsOrder/GDO/gate_registrations/inbound_plan_lines/ProductionImport.warehouse_type (REVOKE anon/authenticated — chỉ service role gọi qua PUT /wms/lookup/:id). Migration `20260710_warehouse_type_options.sql` (CHỜ apply staging → production khi merge; BE listLookup select('*') nên chưa apply vẫn chạy, chỉ lưu cờ/đổi tên cần migration). |
| 2026-07-10 | — | **Chế độ quản tồn thứ 4 QTY_DATE (tồn số lượng theo NSX)**: nới CHECK `warehouse_inventory_mode_check` thêm 'QTY_DATE' + đổi unique index `uq_inventory_active_wh_pallet` từ (warehouse_id, pallet_code) → (warehouse_id, pallet_code, COALESCE(production_date,'1900-01-01')) NULLS NOT DISTINCT (partial active) — kho QTY_DATE có NHIỀU dòng pool active cùng mã khác NSX; QR/QTY giữ nguyên tính chống trùng (QR: trùng code ⇒ trùng NSX; QTY: NSX null ⇒ vẫn 1 dòng). BE: `isQtyLike` (inventoryMode.ts) — QTY_DATE hành xử như QTY mọi nhánh; scanManual bắt `production_date` (422 NSX_REQUIRED) + pool key theo NSX; `applySharedPoolDelta` FEFO (NSX cũ trước) + tham số chọn NSX; `getManualItemStock` trả `date_pools`. Migration `20260710_inventory_mode_qty_date.sql` (CHỜ apply staging → production khi merge; chưa apply thì chọn QTY_DATE khi lưu kho sẽ vướng CHECK cũ). |
| 2026-07-10 | — | **Kho phụ nội bộ (tổ sản xuất tại site)**: `Warehouse.parent_warehouse_id` TEXT FK → Warehouse (Warehouse.id là TEXT — bản uuid đầu bị 42804; NULL = kho thường; BE validate không lồng 2 cấp/không tự trỏ). Kho phụ chỉ giao dịch với kho parent: guard outbound 2 chiều (`internalOrbitError` — đích kho phụ chỉ parent xuất tới; nguồn kho phụ chỉ shipto=parent hoặc tiêu hao không shipto), chặn inbound `createOrder` NCC/FACTORY (chỉ nhận qua chuyển kho từ parent), `maybeAutoCreateTransferOrder` hạ về OTHER khi tên/shipto trùng kho phụ site khác. Cặp parent↔con được nới: biển số TÙY CHỌN (`isInternalPair` — startGDO/quickExport/quickExportExisting) + `confirmTransferReceipt` MIỄN gác booking ĐVVT. Migration `20260710_warehouse_parent.sql` (ĐÃ apply STAGING 10/07; production khi merge). |
| 2026-07-11 | — | **Nhận chuyển kho vào kho QTY_DATE — NSX kế thừa từ tem quét xuất**: `ProductionImport.transfer_production_date date` (NULL = phiếu không gắn NSX). `confirmTransferReceipt`/`createOneInbound`: kho nhận QTY_DATE → tách 1 phiếu / (mã × NSX) từ `OutboundScanEntry.production_date` của GDO nguồn (Σ thùng THỰC QUÉT per NSX, planned_pallets = số pallet để đối chiếu tem; hàng no-QR/GDO không tem → 1 phiếu NSX null, gõ tay lúc nhận). `scanManual`: phiếu có NSX → dùng NSX PHIẾU làm production_date pool (body chỉ là fallback). FE panel Nhận (TMSBookings): dòng NSX per phiếu + nút **"Nhận đủ theo xuất"** 1 chạm (lưu + hoàn thành mọi phiếu OPEN theo đúng số xuất, 409 lành tính bỏ qua); InboundDetail dialog lưu thủ công hiện NSX cố định. Migration `20260711_transfer_nsx_per_import.sql` — ⚠ ORDER_SELECT inbound đã select cột này: PHẢI apply STAGING ngay khi deploy (chưa apply → list/chi tiết phiếu nhập lỗi 400); production khi merge. |
| 2026-07-12 | — | **Sơ đồ xếp xe 3D (Xuất kho)**: `Material.carton_length_cm/carton_width_cm/carton_height_cm` numeric (kích thước thùng carton, cm) + `VehicleType.box_length_cm/box_width_cm/box_height_cm` numeric (lòng thùng xe, cm). Nhập ở form Mã hàng ("Thùng D×R×C") + upload Excel Mã hàng (3 cột CUỐI sau batch_prefix — template luôn xuất đủ cột giữ vị trí M_KEYS) + form Loại xe TMS. Thuật toán xếp `frontend/utils/loadPlan.ts` (cột chồng cùng mã + shelf packing, chạy thuần FE) + viewer Three.js lazy `LoadPlan3DDialog` (nút "Xếp xe 3D" trang chi tiết chuyến xuất, đọc-only). Mã thiếu kích thước → cỡ giả định 40×30×25 + cảnh báo. Migration `20260712_load_plan_dims.sql` — ⚠ getGDO đã select 3 cột Material: PHẢI apply STAGING ngay khi deploy (chưa apply → chi tiết chuyến xuất 404 + tạo/sửa Mã hàng lỗi); production khi merge. |
| 2026-07-12 | — | **Xếp xe 3D đợt 2 — luật xếp chồng (user chốt)**: `Material.max_stack_layers` integer (số lớp tối đa 1 chân, null = theo trần xe) + `Material.stack_on_top` boolean NOT NULL DEFAULT false (hàng nhẹ được xếp TRÊN mã khác, ưu tiên lên nóc). Thuật toán loadPlan.ts viết lại: theo ĐƠN (hết DO1 mới DO2) → chân cùng loại cao đều (chênh ≤1 lớp, thùng dư tự nằm nóc) → 1 dãy chỉ 1 (đơn×kích thước) → hàng nhẹ lên nóc chân đã xếp (cùng đơn trước) → hạ lớp đều để trải HẾT chiều dài xe khi hàng ít. Migration `20260712_load_plan_stack.sql` (ĐÃ apply STAGING qua pg; production khi merge — getGDO select 2 cột này). |
| 2026-07-12 | — | **Xếp xe 3D — đổi đơn vị cm → mm**: RENAME `Material.carton_*_cm`→`carton_*_mm` + `VehicleType.box_*_cm`→`box_*_mm`, dữ liệu đã nhập ×10. Toàn tuyến (BE/FE/form/template/3D) dùng mm. Migration `20260712_load_plan_mm.sql` (ĐÃ apply STAGING; production chạy SAU 2 migration load_plan kia khi merge). |
| 2026-07-16 | — | **Control Tower (Giám sát vận hành)**: RPC `control_tower_stats(p_warehouse_ids text[], p_categories text[], p_today date)` trả jsonb {gate: đếm theo status + inside_list top 40 kèm entry_at (dwell tính FE), outbound: đếm GDO theo status + planned/scanned + active top 40 kèm tiến độ, inbound: orders/pallets/cartons hôm nay, weigh: tickets/pending2/net_kg, hourly: thùng xuất + pallet nhập theo giờ VN} — aggregate phía DB, mọi cắt scope null-inclusive. Kèm 2 index MỚI `idx_ose_scanned_at` (OutboundScanEntry.scanned_at) + `idx_ie_created_at` (InventoryEntry.created_at) cho truy vấn theo-ngày. BE `GET /wms/control-tower` (permission MỚI control_tower.view) trả 503 NOT_READY khi RPC chưa apply. Migration `20260716_control_tower_stats.sql` (CHỜ apply staging → production khi merge). |
| 2026-07-16 | — | **Control Tower v2 — chiều hàng hóa (user chốt sau bản 1)**: RPC `control_tower_stats` REPLACE thêm: `outbound.loose_planned/loose_scanned` (nhặt lẻ KH + đã quét lẻ), `out_by_material` + `in_by_material` (top 15 mã theo KH/thùng + n_materials), `out_active[].npp` (string_agg distinct NPP) + `n_materials`. FE: progress strip KH/đã xuất/còn/% + 2 khối hàng theo mã + tile Mã hàng xuất/Nhặt lẻ/Tỷ lệ lẻ. Migration `20260716_control_tower_stats_v2.sql` (chạy đè bản v1 — CHỜ apply staging; production khi merge chỉ cần chạy v2 + 2 index từ file v1). |
| 2026-07-17 | — | **Control Tower v3 — nghìn mã/ngày + filter Loại kho (user 17/07)**: RPC `control_tower_stats` REPLACE — `out_by_material` sort **(ordered−scanned) DESC** (mã còn thiếu nổi lên, mã đủ chìm) top 30 + `n_done`/`n_short`; `in_by_material` top 30 + cắt p_categories theo Material.category (null-inclusive). Controller nhận `?categories=` ∩ scope JWT (403 nếu chọn ngoài scope). FE: filter Loại kho (useScopedWhTypes) + chips "đủ/còn thiếu" trên header khối + footer ghi chú top-30. Migration `20260717_control_tower_stats_v3.sql` (đè v2 — CHỜ apply staging; production khi merge chạy index v1 → v3). |
| 2026-07-17 | — | **FIX lệch giờ Nhịp độ theo giờ (control_tower_stats)**: `OutboundScanEntry.scanned_at` + `InventoryEntry.created_at` = timestamp NAIVE chứa UTC → biểu thức `col AT TIME ZONE VN` hiểu nhầm naive là giờ VN (quét 10:32 VN hiện cột 20h). Chuẩn naive-UTC: `col AT TIME ZONE UTC AT TIME ZONE VN` + biên ngày t0/t1 naive-UTC (không phụ thuộc session TZ). Migration `20260717_control_tower_hourly_tz_fix.sql` (đè v3, cùng chữ ký). BÀI HỌC: cột giờ bảng nghiệp vụ là naive-UTC — RPC mới đụng giờ VN phải dùng chuỗi 2 bước AT TIME ZONE. |
| 2026-07-17 | — | **Control Tower v5 — cột hiển thị (user)**: gate_inside thêm `warehouse_type` + `vehicle_type` (Xe trong cổng hiện Loại kho/Loại xe/Hướng); out_active thêm `warehouse_type` (GDO) + `export_type` (string_agg distinct từ OutboundItem — Loại xe của chuyến). Migration `20260717_control_tower_stats_v5.sql` (đè tz_fix, cùng chữ ký). Production khi merge: index v1 → chạy thẳng v5 (bỏ qua v2/v3/tz_fix). |
| 2026-07-17 | — | **Slotting (Tối ưu vị trí — mục 6 roadmap)**: `WarehouseZone.pick_rank` integer (hạng nhặt khu, 1 = gần cửa xuất nhất, NULL = không tham gia gợi ý — sửa trong tab Khu vực). Bảng MỚI `SlottingPlan` (id/warehouse_id/name/status ACTIVE-COMPLETED-CANCELLED/note/window_days/n_lines/created_by/completed_at-by/updated_at-by) + `SlottingPlanLine` (plan_id FK ON DELETE CASCADE, inventory_entry_id, pallet_code, material_code/name, abc, reason, from/to_location_id+code snapshot) — trạng thái dòng KHÔNG lưu, SUY SỐNG từ InventoryEntry.location_id hiện tại (DONE/PENDING/MOVED_OTHER/GONE). RLS enable + realtime publication 2 bảng. RPC `slotting_stats(p_warehouse_id text, p_categories text[], p_days int)` trả jsonb {materials: ABC theo LƯỢT NHẶT lũy-kế-trước-mã 80/95 + tồn theo khu, placement, zones (capacity/used), locations (used_slots)} — cửa sổ ngày so naive-UTC 2 bước. Migration `20260717_slotting.sql` (CHỜ apply staging → production khi merge; chưa apply: trang Slotting 503 NOT_READY + tab Khu vực lỗi select pick_rank). |
| 2026-07-18 | — | **Slotting v2 (bản CUỐI — user chỉnh 2 vòng)**: `WarehouseZone.flow_type` (SAME_END/FLOW_THROUGH — luồng cửa) + `SlottingPlan.level/principle`. Khu đặc thù (SCA lạnh…) KHÔNG thêm trường — dùng LOẠI KHO có sẵn (user bác slot_group vì khớp chuỗi tay): engine siết khu-có-Loại chỉ nhận mã đúng Loại + cảnh báo WRONG_CATEGORY + checkbox pull_wrong_zone lúc tạo KH; file có DROP COLUMN IF EXISTS slot_group (dọn nếu lỡ apply bản giữa). **DROP + tạo lại `SlottingPlanLine`**: dòng GOM (mã + date_key) — material_id, n_pallets, entry_ids jsonb (tiến độ x/N sống), flow_note. RPC REPLACE cùng chữ ký (+ zones.flow_type). Mức độ Easy/Normal/Hard + FIFO/FEFO/LIFO = FILTER trên trang. Cấu hình khu (pick_rank/flow_type) qua route riêng PATCH /wms/slotting/zone-config/:id (permission MỚI slotting.configure — tab Cài đặt trong trang, gỡ khỏi Cài đặt WMS). Migration `20260718_slotting_v2.sql` — chạy SAU 20260717_slotting.sql (CHỜ apply staging; production khi merge 2 file tuần tự). |
| 2026-07-18 | — | **Slotting — 2 cờ per VỊ TRÍ (user bổ sung)**: `Location.slot_no_in` boolean NOT NULL DEFAULT false (vị trí KHÔNG đưa hàng vào — kho tạm: không làm đích, hàng nằm đó LUÔN sinh lệnh kéo đi ưu tiên P1 sau kéo-sai-loại, kể cả khi không tick pull_wrong_zone) + `Location.slot_no_out` boolean NOT NULL DEFAULT false (vị trí KHÔNG lấy hàng đi — hàng kẹt: loại hoàn toàn khỏi nguồn, vẫn tính chiếm sức chứa). Chỉnh trong tab Cài đặt trang Tối ưu vị trí (2 multi-select + nút Lưu, replace-all per kho qua PUT /wms/slotting/location-config — permission slotting.configure). RPC `slotting_stats` REPLACE cùng chữ ký (+ locations.slot_no_in/slot_no_out). Migration `20260718_slotting_locations.sql` — chạy SAU 2 file slotting trước (CHỜ apply staging; production khi merge chạy 3 file tuần tự). |
| 2026-07-19 | — | **Sức chứa khu vực kho (Dashboard)**: `WarehouseZone.max_pallets` integer — pallet tối đa KHAI TAY tại khu (user chốt 19/07: không cộng tự động từ Σ Location.max_pallets; NULL = chưa khai). Khai ở form Khu vực (Cài đặt WMS, quyền manage_zone). Card "Sức chứa khu vực kho" trên Dashboard so pallet tồn vs số này; pallet tồn quy đổi: mã có `Material.pallet_per_ea` → Σ tồn × pallet_per_ea, mã không có → đếm entry active gắn vị trí. Migration `20260719_zone_max_pallets.sql` (ĐÃ apply STAGING qua pg 19/07; PRODUCTION: cột đã TỒN TẠI SẴN trên DB LOF — verify sau merge 19/07 select/ghi/hoàn tác OK, KHÔNG phải chạy gì thêm). |
| 2026-07-18 | — | **Slotting — fix lệch sức chứa (test hội tụ của user)**: `slotting_stats.loc_used` đếm chỗ đã dùng CHỈ `stack_layer=1` trong khi RPC `move_pallets_to_location` (gác cổng chuyển vị trí) đếm MỌI tầng → engine tưởng đích còn chỗ, thực hiện dính 400 LOCATION_FULL oan. RPC REPLACE cùng chữ ký, thay đổi DUY NHẤT: bỏ `AND ie.stack_layer = 1` trong loc_used (used_slots = đúng thước đo move RPC). Migration `20260718_slotting_capacity_fix.sql` — chạy SAU 3 file slotting trước (production khi merge: 4 file tuần tự). |
