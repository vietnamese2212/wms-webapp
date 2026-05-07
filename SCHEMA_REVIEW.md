# Prisma Schema Review – WMS Webapp

> Cập nhật lần cuối: 2026-05-07 (rev 4)
> Database: **PostgreSQL** (Supabase hoặc PostgreSQL gốc — Prisma provider không đổi)

---

## Tổng quan kiến trúc (đã xác nhận)

### Phân cấp vị trí kho

```
Warehouse (Kho lớn)          → Ba Vì, Bàu Bàng
  └─ SubWarehouse (Kho nhỏ)  → Ba Vì_Thành phẩm 1, Ba Vì_Thành phẩm 2
       └─ Location (Vị trí)  → BV_TP1_1_T1, BV_TP2_1_T2...
```

**Phân tích location_code `BV_TP1_1_T1`:**

| Segment | Ý nghĩa | Ví dụ |
|---|---|---|
| `BV` | Prefix của Warehouse | Ba Vì |
| `TP1` | Prefix của SubWarehouse | Thành phẩm 1 |
| `1` | Số hàng (row) | Hàng 1 |
| `T1` | Số kệ/tầng (shelf/tier) | Tầng 1 |

→ `location_code` = `{warehouse_prefix}_{subwarehouse_prefix}_{row}_{shelf}` — **tự động sinh** từ các field riêng.

---

### Multi-tenant & Phân quyền

- Mỗi user (Employee) thuộc 1 Warehouse
- Role-based access: Admin toàn hệ thống / Manager theo Warehouse / Staff theo SubWarehouse
- Data của từng Warehouse độc lập với nhau

---

## Trạng thái các Model

| Model | Mục đích | Trạng thái |
|---|---|---|
| `Warehouse` | Kho lớn (Ba Vì, Bàu Bàng...) | 🆕 Cần tạo mới |
| `SubWarehouse` | Kho nhỏ (TP1, TP2...) | 🆕 Cần tạo mới |
| `Location` | Vị trí trong kho nhỏ | 🔄 Refactor (thêm FK) |
| `Material` | Danh mục hàng hóa | 🆕 Cần tạo mới |
| `Manufacturer` | Nhà máy sản xuất (NMSX) | 🆕 Cần tạo mới |
| `Employee` | Nhân viên hệ thống | 🔄 Refactor (thêm warehouse_id) |
| `Vehicle` | Xe vận chuyển | 🔄 Tách Driver |
| `Driver` | Tài xế | 🆕 Cần tạo mới (tách từ Vehicle) |
| `InventoryEntry` | Pallet tồn kho | 🔄 Refactor nặng |
| `ExportHistory` | Lịch sử xuất kho | 🔄 Thêm FK |
| `ProductionImport` | Phiếu nhập từ sản xuất | ✅ Ổn |
| `LocationTransfer` | Chuyển vị trí pallet | ✅ Ổn |
| `Menu` | Phân quyền menu | ✅ Ổn |
| `Setting` | Cài đặt hệ thống | ✅ Ổn |

---

## Schema đề xuất đầy đủ

### Warehouse – Kho lớn

```prisma
model Warehouse {
  id          String   @id @default(uuid())
  code        String   @unique   // "BV", "BB"
  name        String             // "Kho Ba Vì", "Kho Bàu Bàng"
  address     String?
  is_active   Boolean  @default(true)
  created_at  DateTime @default(now())

  sub_warehouses SubWarehouse[]
  employees      Employee[]
}
```

---

### SubWarehouse – Kho nhỏ

```prisma
model SubWarehouse {
  id           String    @id @default(uuid())
  warehouse_id String
  warehouse    Warehouse @relation(fields: [warehouse_id], references: [id])
  code         String              // "TP1", "TP2", "NL1"
  name         String              // "Thành phẩm 1", "Nguyên liệu 1"
  type         String?             // "THANH_PHAM", "NGUYEN_LIEU", "BAN_THANH_PHAM"
  is_active    Boolean  @default(true)

  locations    Location[]

  @@unique([warehouse_id, code])
}
```

---

### Location – Vị trí kho (đã refactor)

```prisma
model Location {
  id               String       @id @default(uuid())
  sub_warehouse_id String
  sub_warehouse    SubWarehouse @relation(fields: [sub_warehouse_id], references: [id])
  location_code    String       @unique   // "BV_TP1_1_T1" – tự động sinh
  row              String?               // "1", "2"
  shelf            String?               // "T1", "T2"
  max_pallets      Int          @default(1)
  is_active        Boolean      @default(true)

  inventory_entries InventoryEntry[]

  @@index([sub_warehouse_id])
}
```

**Logic sinh `location_code` tự động (backend):**
```typescript
const wh = warehouse.code           // "BV"
const swh = subWarehouse.code       // "TP1"
location_code = `${wh}_${swh}_${row}_${shelf}`  // "BV_TP1_1_T1"
```

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
  id                   String        @id @default(uuid())
  material_code        String        @unique   // "1234567890"
  material_description String                  // "Thùng carton 3 lớp 40x30x30"
  short_name           String?                 // Auto: "Thùng carton [890]"
  custom_short_name    String?                 // User override phần tên (suffix [890] giữ nguyên)
  product_type         String?
  unit                 String?                 // "thùng", "cái", "kg"
  manufacturer_id      String?
  manufacturer         Manufacturer? @relation(fields: [manufacturer_id], references: [id])
  notes                String?
  is_active            Boolean       @default(true)
  created_at           DateTime      @default(now())
  updated_at           DateTime      @updatedAt

  inventory_entries    InventoryEntry[]
  export_history       ExportHistory[]
}
```

**Logic sinh `short_name` tự động (backend):**
```typescript
const suffix = material_code.slice(-3)           // "890"
const base   = custom_short_name ?? material_description
short_name   = `${base} [${suffix}]`             // "Thùng carton [890]"
```

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
- [x] Multi-warehouse + SubWarehouse: dữ liệu động, quản lý qua Masterdata UI
- [x] `cycle` = chu kỳ sản xuất, bóc từ QR hoặc chọn tay → `String` trong InventoryEntry
- [x] `bypass_location` → thay bằng `stack_layer Int` (1=sàn, 2/3=chồng, không tính slot)
- [x] Vehicle–Driver: 1 xe nhiều tài xế, Vehicle có `default_driver_id`, DeliveryOrder có `driver_id` riêng
- [x] Legacy fields: `id2` xoá, `date_field` xoá, `match_date` xoá, `update_field` → `updated_at @updatedAt`

---

## Masterdata quản lý vị trí kho

Toàn bộ Warehouse / SubWarehouse / Location đều là **dữ liệu động** — người dùng tự tạo/sửa/xoá qua giao diện, không cần đụng code.

### Màn hình Masterdata cần xây dựng

```
Masterdata > Vị trí kho
  ├─ Quản lý Kho lớn (Warehouse)
  │     CRUD: Tên, Mã (prefix), Địa chỉ, Bật/Tắt
  │
  ├─ Quản lý Kho nhỏ (SubWarehouse)
  │     CRUD: Thuộc kho lớn nào, Tên, Mã (prefix), Loại, Bật/Tắt
  │
  └─ Quản lý Vị trí (Location)
        CRUD: Thuộc kho nhỏ nào, Hàng, Kệ/Tầng, Số pallet tối đa, Bật/Tắt
        location_code → tự động sinh: "{warehouse.code}_{subwarehouse.code}_{row}_{shelf}"
```

### Quy tắc khi tạo Location

1. User chọn Warehouse → chọn SubWarehouse → nhập row + shelf + max_pallets
2. Backend tự sinh `location_code` — user không nhập thủ công
3. `location_code` là unique, không cho trùng

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
