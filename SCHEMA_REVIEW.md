# Prisma Schema Review – WMS Webapp

> Cập nhật lần cuối: 2026-05-07 (rev 9)
> Database: **PostgreSQL** (Supabase hoặc PostgreSQL gốc — Prisma provider không đổi)

---

## Tổng quan kiến trúc (đã xác nhận)

### Phân cấp vị trí kho

```
Warehouse (Kho lớn)   → Ba Vì, Bàu Bàng
  └─ Location (Vị trí) → BV_TP1_1_T1, BV_TP2_1_T2...
       (sub_code/sub_name/sub_type embedded trong Location)
```

> ⚠️ **rev 8**: Đã bỏ bảng `SubWarehouse`. Thông tin kho nhỏ (TP1, NL1...) được lưu trực tiếp trong `Location` dưới dạng `sub_code`, `sub_name`, `sub_type`.

**Phân tích location_code `BV_TP1_1_T1`:**

| Segment | Ý nghĩa | Field | Ví dụ |
|---|---|---|---|
| `BV` | Prefix kho lớn | `warehouse.code` | Ba Vì |
| `TP1` | Prefix kho nhỏ | `location.sub_code` | Thành phẩm 1 |
| `1` | Số hàng | `location.row` | Hàng 1 |
| `T1` | Tầng/kệ | `location.shelf` | Tầng 1 |

→ `location_code` = `{warehouse.code}_{sub_code}_{row}_{shelf}` — **tự động sinh** trong backend.

---

### Multi-tenant & Phân quyền

- Mỗi user (Employee) thuộc 1 Warehouse
- Role-based access: Admin toàn hệ thống / Manager theo Warehouse / Staff theo SubWarehouse
- Data của từng Warehouse độc lập với nhau

---

## Trạng thái các Model

| Model | Mục đích | Trạng thái |
|---|---|---|
| `Warehouse` | Kho lớn (Ba Vì, Bàu Bàng...) | ✅ Đã tạo, API + seed ổn |
| ~~`SubWarehouse`~~ | ~~Kho nhỏ~~ | 🗑️ Đã xoá — embed vào Location |
| `Location` | Vị trí kho (có sub_code/sub_name/sub_type) | ✅ Đã refactor, 2-table |
| `Material` | Danh mục hàng hóa | ✅ Đã tạo, đầy đủ field logistics |
| `Manufacturer` | Nhà máy sản xuất (NMSX) | ✅ Đã tạo, API + seed ổn |
| `ImportShift` | Ca nhập (Ca 1, Ca 2, Ca 3, HC) | ✅ rev 10 – bảng mới, seed sẵn |
| `QAStatus` | Tình trạng QA (X, X cảm quan, X 7, OK) | ✅ rev 10 – bảng mới, seed sẵn |
| `Employee` | Nhân viên hệ thống | ✅ Đã tạo, có warehouse_id |
| `Vehicle` | Xe vận chuyển | ✅ Đã tạo, có default_driver_id |
| `Driver` | Tài xế | ✅ Đã tạo (tách từ Vehicle) |
| `InventoryEntry` | Pallet tồn kho | ✅ rev 10 – thêm pallet_sequence_no, qa_status_id |
| `ExportHistory` | Lịch sử xuất kho | ✅ Đã tạo |
| `ProductionImport` | Phiếu nhập kho (bảng cha) | ✅ rev 10 – thêm shift_id |
| `LocationTransfer` | Chuyển vị trí pallet | ✅ Đã tạo |
| `Menu` | Phân quyền menu | ✅ Đã tạo |
| `Setting` | Cài đặt hệ thống | ✅ Đã tạo |

---

## Schema đề xuất đầy đủ

### Warehouse – Kho lớn

```prisma
model Warehouse {
  id         String   @id @default(uuid())
  code       String   @unique  // "BV", "BB"
  name       String            // "Kho Ba Vì", "Kho Bàu Bàng"
  address    String?
  is_active  Boolean  @default(true)
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  locations  Location[]
  employees  Employee[]
}
```

---

### Location – Vị trí kho *(rev 8: 2-table, embed sub info)*

> Không còn bảng `SubWarehouse`. Thông tin kho nhỏ được lưu trực tiếp trong mỗi dòng Location.

```prisma
model Location {
  id            String    @id @default(uuid())
  warehouse_id  String
  warehouse     Warehouse @relation(fields: [warehouse_id], references: [id])
  sub_code      String              // "TP1", "NL1" – prefix kho nhỏ
  sub_name      String?             // "Thành phẩm 1", "Nguyên liệu 1"
  sub_type      String?             // "THANH_PHAM" | "NGUYEN_LIEU" | "BAN_THANH_PHAM"
  location_code String    @unique   // "BV_TP1_1_T1" – tự động sinh
  row           String              // "1", "2", "3"
  shelf         String              // "T1", "T2"
  max_pallets   Int       @default(1)
  is_active     Boolean   @default(true)
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt

  inventory_entries InventoryEntry[]

  @@index([warehouse_id])
  @@index([warehouse_id, sub_code])
}
```

**Logic sinh `location_code` tự động (backend):**
```typescript
const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouse_id } })
location_code = `${warehouse.code}_${sub_code}_${row}_${shelf}`  // "BV_TP1_1_T1"
```

**API thay thế `/sub-warehouses`:**
```
GET /api/masterdata/locations/sub-groups?warehouse_id=xxx
→ [{sub_code, sub_name, sub_type, location_count}, ...]
// Derived từ Location.groupBy — không cần bảng riêng
```

**Trade-off đã cân nhắc:**

| | 3 bảng (cũ) | 2 bảng (hiện tại) |
|---|---|---|
| JOIN để lấy full info | 2 JOIN | 1 JOIN |
| Đổi tên kho nhỏ | 1 UPDATE row | UPDATE nhiều Location |
| Phù hợp quy mô | Over-engineered | ✅ Đủ dùng |

---

### Manufacturer – Nhà máy sản xuất (NMSX)

```prisma
model Manufacturer {
  id         String   @id @default(uuid())
  code       String   @unique   // Ký hiệu chữ/số – VD: "A", "01", "NM3"
  name       String?            // Tên đầy đủ nếu có
  is_active  Boolean  @default(true)

  materials  Material[]
  inventory_entries InventoryEntry[]
}
```

---

### Material – Danh mục hàng hóa

```prisma
model Material {
  id                    String        @id @default(uuid())
  material_code         String        @unique   // "510000127"
  material_description  String                  // "LOF Ba Vì Sữa tươi Có đường 180mlx48"
  short_name            String?                 // Auto: "Ba Vì 180 [127]"
  custom_short_name     String?                 // User override tên (suffix [xxx] giữ nguyên)

  // Phân loại
  category              String?                 // "Thành phẩm" | "NVL" | "POSM" | "Bao bì"...
  product_type          String?                 // Loại pack size: "180", "110", "200"...
  unit                  String?                 // "thùng", "cái", "kg"

  // Thông số logistics – Thành phẩm
  weight_kg             Decimal?               // Trọng lượng 1 thùng (kg)
  cartons_per_pallet    Int?                   // Thùng/Pallet
  cartons_per_pallet_mn Int?                   // Thùng/Pallet khu vực MN
  units_per_carton      Int?                   // Hộp/Thùng

  // Thông số logistics – NVL
  ea_per_pallet         Int?                   // EA/Pallet → số pallet = CEIL(tổng EA / ea_per_pallet)

  // Chất lượng & lưu kho
  shelf_life_days       Int?                   // Hạn sử dụng (ngày)
  storage_category      String?                // Điều kiện lưu kho: "UHT", "Fresh", "Frozen"...

  // Truy xuất & tham chiếu
  old_code              String?                // Mã cũ (legacy / migration)
  image_url             String?                // Ảnh sản phẩm

  manufacturer_id       String?
  manufacturer          Manufacturer? @relation(fields: [manufacturer_id], references: [id])
  notes                 String?
  is_active             Boolean       @default(true)
  created_at            DateTime      @default(now())
  updated_at            DateTime      @updatedAt

  inventory_entries     InventoryEntry[]
  export_history        ExportHistory[]
  production_imports    ProductionImport[]
}
```

**Logic sinh `short_name` tự động (backend):**
```typescript
const suffix = material_code.slice(-3)           // "127"
const base   = custom_short_name ?? material_description
short_name   = `${base} [${suffix}]`             // "Ba Vì 180 [127]"
```

**Mapping từ spreadsheet thực tế:**

| Cột spreadsheet | Field DB | Ghi chú |
|---|---|---|
| Material | `material_code` | Mã SAP |
| Material Description | `material_description` | Tên đầy đủ |
| Tên gọi tắt | `short_name` / `custom_short_name` | Tự sinh hoặc override |
| Loại | `product_type` | Pack size: 180, 110, 200... |
| KG | `weight_kg` | KG/thùng |
| Thùng_Pallet | `cartons_per_pallet` | |
| Thùng_Pallet_MN | `cartons_per_pallet_mn` | Khu vực miền Nam |
| Hộp_Thùng | `units_per_carton` | |
| EA_Pallet (NVL) | `ea_per_pallet` | Chỉ NVL, tính pallet = CEIL(EA/ea_per_pallet) |
| SHELFLIFE | `shelf_life_days` | Ngày |
| KHO | `storage_category` | UHT, Fresh, Frozen... |
| Mã cũ | `old_code` | Legacy code |
| Hình ảnh | `image_url` | URL ảnh |
| Note | `notes` | |

**Filter API hỗ trợ:** `?category=NVL`, `?storage_category=UHT`, `?manufacturer_id=...`, `?search=...` (tìm theo code, description, short_name, old_code)

---

### Employee – Nhân viên (đã refactor)

```prisma
model Employee {
  id           String    @id @default(uuid())
  warehouse_id String?
  warehouse    Warehouse? @relation(fields: [warehouse_id], references: [id])
  name         String
  employee_code String?  @unique
  role         String    // "ADMIN" | "WAREHOUSE_MANAGER" | "WAREHOUSE_STAFF" | "DRIVER" | "HR_MANAGER"
  department   String?
  phone        String?
  email        String?   @unique
  password     String    // bcrypt hash
  is_active    Boolean   @default(true)
  created_at   DateTime  @default(now())
}
```

---

### InventoryEntry – Pallet tồn kho (đã refactor)

Giữ lại chỉ thông tin **trạng thái hiện tại** của pallet, xoá các field computed/legacy.

```prisma
model InventoryEntry {
  id              String        @id @default(uuid())
  pallet_code     String        @unique   // Mã QR của pallet
  location_id     String
  location        Location      @relation(fields: [location_id], references: [id])
  material_id     String
  material        Material      @relation(fields: [material_id], references: [id])
  manufacturer_id String?
  manufacturer    Manufacturer? @relation(fields: [manufacturer_id], references: [id])

  // Chu kỳ sản xuất – bóc tách từ QR hoặc chọn tay
  cycle           String?

  // Pallet stacking – thay thế bypass_location
  stack_layer     Int     @default(1)
  // 1 = nằm dưới sàn (tính vào max_pallets của Location)
  // 2, 3 = chồng lên pallet khác (không tính vào max_pallets)

  cartons_imported Int
  production_date  DateTime?
  status           String   @default("IN_STOCK")
  // "IN_STOCK" | "EXPORTED" | "TRANSFERRED" | "PARTIAL"

  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt

  export_history     ExportHistory[]
  location_transfers LocationTransfer[]

  @@index([location_id, status])
}
```

#### ✅ Cải tiến `bypass_location` → `stack_layer`

**Vấn đề cũ:** `bypass_location = true` là cờ thủ công, không nói lên vị trí chồng hay logic kiểm tra.

**Thiết kế mới:**

| `stack_layer` | Ý nghĩa | Tính vào slot? |
|---|---|---|
| `1` | Pallet đặt trên sàn | ✅ Có |
| `2` | Chồng lên pallet layer 1 | ❌ Không |
| `3` | Chồng lên pallet layer 2 | ❌ Không |

**Logic kiểm tra Location đầy (backend):**
```typescript
// Đếm số slot đang dùng = chỉ đếm pallet layer 1
const usedSlots = await prisma.inventoryEntry.count({
  where: { location_id, stack_layer: 1, status: 'IN_STOCK' }
})
const isFull = usedSlots >= location.max_pallets
// → Pallet layer 2/3 luôn được nhập vào nếu layer bên dưới tồn tại
```

**UI khi nhập kho:**
- Mặc định `stack_layer = 1`
- Nếu location đầy → hệ thống hỏi "Pallet này chồng lên pallet đang có?" → chọn layer 2 hoặc 3
- Hệ thống kiểm tra layer bên dưới phải tồn tại (layer 2 cần có layer 1 cùng location)

---

**Fields đã xoá khỏi InventoryEntry:**
```
exported_quantity          → tính từ SUM(ExportHistory.quantity)
remaining_quantity         → tính từ cartons_imported - exported
exported_match_stock       → legacy, xoá
exported_transfer_code     → legacy, xoá
exported_transfer_location → đã có LocationTransfer
new_pallet_code            → đã có LocationTransfer
transfer_time              → đã có LocationTransfer
id2                        → xoá (confirmed)
update_field               → đổi thành updated_at @updatedAt
date_field                 → xoá (không rõ mục đích, confirmed)
match_date                 → xoá (không rõ mục đích, confirmed)
bypass_location            → thay bằng stack_layer Int
```

---

### Vehicle & Driver – 1 xe, nhiều tài xế

**Thiết kế:**
- `Vehicle` có `default_driver_id` → tài xế mặc định khi tạo trong Masterdata
- Mỗi `DeliveryOrder` có `driver_id` riêng → có thể khác với default (ghi đè lúc tạo lệnh)
- `Driver` là model độc lập, không gắn cứng vào xe

```prisma
model Driver {
  id          String   @id @default(uuid())
  code        String?  @unique
  name        String
  phone       String?
  id_card     String?
  license_no  String?
  is_active   Boolean  @default(true)
  created_at  DateTime @default(now())

  vehicles          Vehicle[]        // các xe mà driver này là default
  delivery_orders   DeliveryOrder[]  // các chuyến thực tế driver đã/đang lái
}

model Vehicle {
  id                String   @id @default(uuid())
  plate_number      String   @unique
  type              String?            // "xe tải", "xe container"
  capacity_tons     Float?
  default_driver_id String?
  default_driver    Driver?  @relation(fields: [default_driver_id], references: [id])
  next_inspection   DateTime?
  is_active         Boolean  @default(true)
  created_at        DateTime @default(now())

  delivery_orders   DeliveryOrder[]
}
```

**UI Masterdata – Xe:**
- Khi tạo xe → dropdown chọn tài xế mặc định (optional)
- Khi tạo lệnh vận chuyển → pre-fill tài xế từ `default_driver`, nhưng có thể đổi

---

### `cycle` – Chu kỳ sản xuất

- **Nguồn**: bóc tách từ QR code của pallet khi scan, hoặc chọn tay
- **Kiểu dữ liệu**: `String` (linh hoạt — có thể là "2025-05", "Đợt 3", "C05", tuỳ QR format)
- **Không cần bảng riêng** tại thời điểm này — lưu trực tiếp trong `InventoryEntry.cycle`
- Khi cần thống kê theo cycle: `GROUP BY cycle`

---

## Tất cả câu hỏi đã xác nhận ✅

- [x] `material` = mã hàng, `material_description` = tên đầy đủ, `short_name` = `{tên} [{3 số cuối}]`
- [x] `location_code` format: `BV_TP1_1_T1` (tự sinh từ warehouse/subwarehouse/row/shelf)
- [x] `nmsx` = Nhà máy sản xuất → Model `Manufacturer` (code = ký hiệu chữ/số)
- [x] Database: **PostgreSQL via Supabase** (hoặc PostgreSQL gốc — cùng Prisma provider)
- [x] Multi-warehouse + kho nhỏ: dữ liệu động, sub_code/sub_name/sub_type embedded trong Location (bỏ bảng SubWarehouse)
- [x] `cycle` = chu kỳ sản xuất, bóc từ QR hoặc chọn tay → `String` trong InventoryEntry
- [x] `bypass_location` → thay bằng `stack_layer Int` (1=sàn, 2/3=chồng, không tính slot)
- [x] Vehicle–Driver: 1 xe nhiều tài xế, Vehicle có `default_driver_id`, DeliveryOrder có `driver_id` riêng
- [x] Legacy fields: `id2` xoá, `date_field` xoá, `match_date` xoá, `update_field` → `updated_at @updatedAt`
- [x] Material logistics fields: `weight_kg`, `cartons_per_pallet`, `cartons_per_pallet_mn`, `units_per_carton`, `shelf_life_days`, `storage_category`, `old_code`, `image_url`
- [x] Material `category`: phân loại "Thành phẩm" / "NVL" / "POSM" / "Bao bì"...
- [x] Material `ea_per_pallet`: số EA/pallet cho NVL → pallet = CEIL(tổng EA ÷ ea_per_pallet)

---

## Masterdata quản lý vị trí kho

Toàn bộ Warehouse / SubWarehouse / Location đều là **dữ liệu động** — người dùng tự tạo/sửa/xoá qua giao diện, không cần đụng code.

### Màn hình Masterdata cần xây dựng

```
Masterdata > Vị trí kho
  ├─ Quản lý Kho lớn (Warehouse)
  │     CRUD: Tên, Mã (prefix), Địa chỉ, Bật/Tắt
  │
  └─ Quản lý Vị trí (Location)
        CRUD: Thuộc kho nào, Sub_code, Sub_name, Hàng, Kệ/Tầng, Số pallet tối đa, Bật/Tắt
        location_code → tự động sinh: "{warehouse.code}_{sub_code}_{row}_{shelf}"
```

### Quy tắc khi tạo Location

1. User chọn Warehouse → nhập sub_code (VD: TP1) + sub_name (VD: Thành phẩm 1) + row + shelf + max_pallets
2. Backend tự sinh `location_code` — user không nhập thủ công
3. `location_code` là unique, không cho trùng
4. Các Location cùng `warehouse_id + sub_code` tạo thành 1 nhóm kho nhỏ (derived, không cần bảng riêng)

### Masterdata khác cũng cần giao diện CRUD

| Màn hình | Model |
|---|---|
| Danh mục hàng hóa | `Material` |
| Nhà máy sản xuất | `Manufacturer` |
| Nhân viên | `Employee` |
| Xe + Tài xế | `Vehicle` / `Driver` |

---

## Ghi chú về PostgreSQL / Supabase

- **Supabase = managed PostgreSQL** – hoàn toàn tương thích với Prisma
- `schema.prisma` chỉ cần `provider = "postgresql"` – **không cần thay đổi** khi switch từ Supabase sang PostgreSQL thuần
- Supabase cung cấp thêm: Auth, Storage, Realtime (có thể thay thế Redis + socket.io về sau)
- Kết nối: dùng Supabase connection string → `DATABASE_URL` trong `.env`

---

## Changelog

| Ngày | Thay đổi |
|---|---|
| 2026-05-07 | Review lần đầu, tạo file theo dõi |
| 2026-05-07 | Xác nhận Material naming convention, thêm `custom_short_name` |
| 2026-05-07 | Xác nhận multi-warehouse, location hierarchy, NMSX=Manufacturer, PostgreSQL/Supabase — thiết kế lại toàn bộ schema |
| 2026-05-07 | Xác nhận cycle/bypass_location/Vehicle-Driver/legacy fields — hoàn tất tất cả câu hỏi, schema sẵn sàng |
| 2026-05-07 | Deploy backend lên Vercel API routes; fix vite-env.d.ts; tất cả model ✅ live trên Supabase |
| 2026-05-07 | Material: thêm 8 field logistics (weight_kg, cartons_per_pallet, cartons_per_pallet_mn, units_per_carton, shelf_life_days, storage_category, old_code, image_url) |
| 2026-05-07 | Material: thêm `category` (Thành phẩm/NVL/POSM/Bao bì) và `ea_per_pallet` (tính pallet cho NVL) |
| 2026-05-07 | **Refactor 2-table**: xoá SubWarehouse, embed sub_code/sub_name/sub_type vào Location; thêm endpoint /locations/sub-groups |
| 2026-05-07 | **rev 9 – Tính năng Nhập kho**: `ProductionImport` refactor thành phiếu nhập đầy đủ (thêm warehouse_id, location_id, status, planned_pallets, created_by, updated_by; xoá quantity); `InventoryEntry` thêm machine_code, import_order_id, created_by, updated_by; WMS API /api/wms/inbound-orders; QRScanner component; trang Inbound list + InboundDetail |
| 2026-05-08 | **rev 10 – Ca nhập & QA**: tạo bảng `ImportShift` (Ca 1, Ca 2, Ca 3, HC) và `QAStatus` (X, X cảm quan, X 7, OK); `InventoryEntry` thêm `pallet_sequence_no` (INT, từ vị trí 5 QR), `qa_status_id` (FK QAStatus); `ProductionImport` thêm `shift_id` (FK ImportShift); cập nhật QR parser; API masterdata /import-shifts, /qa-statuses; Employee Nguyễn Văn Quản Lý → Kho BV |
