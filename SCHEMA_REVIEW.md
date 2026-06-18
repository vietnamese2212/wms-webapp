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
weight_kg DECIMAL, cartons_per_pallet INT, cartons_per_pallet_mn INT,
units_per_carton INT, ea_per_pallet INT,
shelf_life_days INT, storage_category TEXT,  -- "UHT" | "Fresh" | "Frozen"
old_code TEXT, image_url TEXT,
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
notes TEXT, created_at, updated_at
```

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
| 2026-06-16 | — | HR: `ShiftRestRule` (from_shift→to_shift bị cấm) — luật nghỉ giữa ca, KHÔNG hardcode; auto-assign đọc phân công ngày D-1 + bảng này để loại ca vi phạm. Seed: CA3→{CA1,CA3,HC}. Migration `20260616_shift_rest_rule.sql`. |
| 2026-06-17 | — | HR Phân công: UNIQUE index `(work_date, layout_id)` — mỗi layout chỉ 1 phiếu/ngày. Migration `20260617_uniq_assignment_sheet_per_day.sql`. |
| 2026-06-18 | — | Omni-search bỏ dấu server-side: `CREATE EXTENSION unaccent` + RPC `omni_material_ids(term)` / `omni_location_ids(term)` (unaccent ilike, trả id). Migration `20260618_unaccent_search.sql`. Phục vụ ô tìm kiếm Inventory 1-ô (pallet/mã+tên hàng/vị trí, gõ không dấu vẫn ra). Controller fallback ilike nếu chưa apply. |
