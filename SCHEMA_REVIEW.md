# Schema Review – WMS Webapp

> Cập nhật lần cuối: 2026-05-09 (rev 10)
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
| `Employee` | Nhân viên hệ thống | ✅ API cơ bản |
| `ImportShift` | Ca nhập (Ca 1/2/3, HC) | ✅ seed sẵn |
| `QAStatus` | Tình trạng QA (X, X CQ, X7, OK) | ✅ seed sẵn |
| `ProductionImport` | Phiếu nhập kho (bảng cha) | ✅ API đầy đủ |
| `InventoryEntry` | Pallet tồn kho | ✅ API đầy đủ |
| `ExportHistory` | Lịch sử xuất kho | ✅ bảng tạo sẵn |
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
