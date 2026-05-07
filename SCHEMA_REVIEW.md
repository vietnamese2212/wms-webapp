# Prisma Schema Review – WMS Webapp

> Cập nhật lần cuối: 2026-05-07  
> Database: **MySQL** (lưu ý: CLAUDE.md ghi PostgreSQL — cần thống nhất)

---

## Tổng quan các Model

| Model | Mục đích | Trạng thái |
|---|---|---|
| `Employee` | Nhân viên hệ thống | ✅ Ổn |
| `Location` | Vị trí kho | ⚠️ Cần bổ sung |
| `Vehicle` | Xe vận chuyển + tài xế | ⚠️ Nên tách |
| `InventoryEntry` | Pallet tồn kho | 🔴 Quá nặng, cần refactor |
| `ExportHistory` | Lịch sử xuất kho | ⚠️ Thiếu liên kết |
| `ProductionImport` | Phiếu nhập từ sản xuất | ✅ Ổn |
| `LocationTransfer` | Chuyển vị trí pallet | ✅ Ổn |
| `Menu` | Phân quyền menu | ✅ Ổn |
| `Setting` | Cài đặt hệ thống | ✅ Ổn |

---

## Vấn đề cần xử lý

### 🔴 1. Thiếu bảng Master `Material` (Quan trọng nhất)

Hiện tại thông tin hàng hoá (`material`, `short_name`, `material_description`, `product_type`) đang lưu dạng **string lặp lại** trong `InventoryEntry` và `ExportHistory`.

**Hậu quả:** Không thể tra cứu danh mục hàng, dễ nhập sai tên, không thể filter/report theo loại hàng.

**Đề xuất:** Tạo bảng `Material`:
```prisma
model Material {
  id                  String  @id @default(uuid())
  material_code       String  @unique  // mã hàng
  material_name       String           // tên đầy đủ
  short_name          String?          // tên ngắn
  product_type        String?          // loại sản phẩm
  machine             String?          // máy sản xuất
  unit                String?          // đơn vị (thùng, cái...)
  notes               String?

  inventory_entries   InventoryEntry[]
  export_history      ExportHistory[]
}
```

---

### 🔴 2. `InventoryEntry` quá nặng – trộn lẫn nhiều concern

Model này đang chứa cả:
- Thông tin nhập kho gốc
- Thông tin xuất kho (`exported_quantity`)
- Thông tin chuyển vị trí (`transfer_time`, `new_pallet_code`)
- Các field legacy không rõ (`id2`, `update_field`, `date_field`, `match_date`)

**Đề xuất:** Giữ `InventoryEntry` chỉ lưu **trạng thái hiện tại của pallet**, các action (xuất/chuyển) lưu ở bảng riêng đã có (`ExportHistory`, `LocationTransfer`).

**Fields nên xem xét bỏ khỏi InventoryEntry:**
```
exported_quantity       → tính từ ExportHistory
remaining_quantity      → tính từ cartons_imported - exported_quantity
exported_match_stock    → legacy?
exported_transfer_code  → legacy?
exported_transfer_location → trùng LocationTransfer
new_pallet_code         → trùng LocationTransfer
transfer_time           → trùng LocationTransfer
id2                     → không rõ mục đích
update_field            → đặt tên lại thành updated_at
date_field              → không rõ mục đích
match_date              → không rõ mục đích
```

---

### ⚠️ 3. `ExportHistory` không liên kết với `InventoryEntry`

Hiện tại không biết pallet nào đã được xuất. Cần thêm:
```prisma
inventory_entry_id  String?
inventory_entry     InventoryEntry? @relation(fields: [inventory_entry_id], references: [id])
```

---

### ⚠️ 4. `Vehicle` trộn thông tin xe + tài xế

Nếu 1 xe có nhiều tài xế theo ca, hoặc 1 tài xế lái nhiều xe → cần tách:
```prisma
model Driver {
  id          String  @id @default(uuid())
  name        String?
  phone       String?
  id_card     String?
  vehicles    Vehicle[]
}
```
*(Tuỳ nghiệp vụ thực tế — hỏi lại)*

---

### ⚠️ 5. `Location` thiếu cấu trúc phân cấp

Hiện chỉ có `location_code` (string). Nếu cần filter theo khu/hàng/kệ:
```prisma
warehouse     String?   // Tên kho
zone          String?   // Khu (A, B, C)
aisle         String?   // Dãy (01, 02)
shelf         String?   // Kệ (1, 2, 3)
bin           String?   // Ô (01, 02)
```
*(Nếu `location_code` đã encode đủ thông tin VD: `A-01-1-01` thì có thể parse — hỏi lại)*

---

### ⚠️ 6. `remaining_quantity` và `exported_quantity` là computed fields

Đang lưu trong DB → **nguy cơ mất đồng bộ** nếu có bug. Nên tính động từ transactions thay vì lưu trực tiếp.

---

### ℹ️ 7. Database: MySQL vs PostgreSQL

`CLAUDE.md` ghi PostgreSQL, schema dùng MySQL. Cần thống nhất trước khi setup backend. MySQL hoàn toàn ổn với Prisma.

---

## Câu hỏi cần xác nhận với bạn

- [ ] `material` trong `InventoryEntry` là mã hàng hay tên hàng? Có bảng danh mục riêng chưa?
- [ ] `location_code` format thực tế là gì? (VD: `A-01-1-01`?)
- [ ] 1 xe có nhiều tài xế không, hay 1 tài xế cố định 1 xe?
- [ ] Các field `id2`, `date_field`, `match_date`, `update_field` dùng để làm gì?
- [ ] `nmsx` là viết tắt của gì?
- [ ] `cycle` trong `InventoryEntry` là gì? (chu kỳ sản xuất?)
- [ ] `bypass_location` nghĩa là gì trong nghiệp vụ?
- [ ] Dùng MySQL hay đổi sang PostgreSQL?

---

## Schema đề xuất bổ sung (Draft)

```prisma
// Thêm bảng này
model Material {
  id                String @id @default(uuid())
  material_code     String @unique
  material_name     String
  short_name        String?
  product_type      String?
  unit              String?
  notes             String?
}

// Sửa InventoryEntry: thêm FK material
// Sửa ExportHistory: thêm FK inventory_entry_id
// Xem xét tách Driver khỏi Vehicle
```

---

## Changelog

| Ngày | Thay đổi |
|---|---|
| 2026-05-07 | Review lần đầu, tạo file theo dõi |
