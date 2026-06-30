/**
 * Sinh bộ template Excel để upload dữ liệu thật.
 * Run: cd backend && node ../scripts/gen_upload_templates.js
 * Xuất ra thư mục ../templates/:
 *   1_Kho.xlsx · 2_NCC_DVVT.xlsx · 3_LoaiXe_huongdan.txt · 4_Xe.xlsx · 5_ViTriKho.xlsx · 6_TonKho.xlsx
 *
 * Mỗi file: dòng 1 = nhãn tiếng Việt, dòng 2 = KEY (đừng sửa), dòng 3+ = dữ liệu (dòng ví dụ — xoá đi rồi điền thật).
 * Thứ tự upload (phụ thuộc): Kho → Loại xe(TMS) → NCC/ĐVVT → Xe · Vị trí → Tồn kho.
 */
const path = require('path')
const fs = require('fs')
const BASE = path.join(__dirname, '..', 'backend')
const XLSX = require(path.join(BASE, 'node_modules', 'xlsx'))

const OUT = path.join(__dirname, '..', 'templates')
fs.mkdirSync(OUT, { recursive: true })

// label row + key row + example rows → 1 sheet
function make(file, sheet, cols, examples) {
  const aoa = [cols.map(c => c.label), cols.map(c => c.key), ...examples.map(ex => cols.map(c => ex[c.key] ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = cols.map(c => ({ wch: Math.max(12, c.label.length + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, path.join(OUT, file))
  console.log('  ✓', file)
}

console.log('Sinh template →', OUT)

// 1) KHO
make('1_Kho.xlsx', 'Kho', [
  { label: 'Mã kho *',                 key: 'code' },
  { label: 'Tên kho *',                key: 'name' },
  { label: 'Loại kho (CENTRAL/NPP)',   key: 'warehouse_type' },
  { label: 'Chế độ tồn (QR/QTY/NONE)', key: 'inventory_mode' },
  { label: 'Mã NMSX',                  key: 'nmsx_code' },
  { label: 'Địa chỉ',                  key: 'address' },
  { label: 'Ship-to phụ (phẩy)',       key: 'shipto_codes' },
], [
  { code: '20000016', name: 'Kho Ba Vì', warehouse_type: 'CENTRAL', inventory_mode: 'QR', nmsx_code: 'B', address: 'Ba Vì, Hà Nội', shipto_codes: '20000018, 20000019' },
])

// 2) NCC / ĐVVT
make('2_NCC_DVVT.xlsx', 'NCC_DVVT', [
  { label: 'Mã *',               key: 'code' },
  { label: 'Tên *',              key: 'name' },
  { label: 'Loại (NCC/ĐVVT) *',  key: 'type' },
  { label: 'Người liên hệ',      key: 'contact_name' },
  { label: 'SĐT',                key: 'contact_phone' },
  { label: 'Mã phụ (phẩy)',      key: 'alias_codes' },
], [
  { code: 'DTV',  name: 'Đại Tân Việt', type: 'NCC',  contact_name: '', contact_phone: '', alias_codes: '' },
  { code: 'ALCA', name: 'ALCA',         type: 'ĐVVT', contact_name: '', contact_phone: '', alias_codes: '' },
])

// 3) LOẠI XE — làm tay nhanh ở Cài đặt TMS; hướng dẫn dạng text
fs.writeFileSync(path.join(OUT, '3_LoaiXe_huongdan.txt'),
  'LOẠI XE (VehicleType) — tạo ở giao diện: Cài đặt TMS → Loại xe.\n' +
  'Tạo trước khi upload Xe (4) và Khung giờ. Ví dụ: Xe Pallet, Xe 4 Pallet, Xe Container, Xe Xá, Xe SCA.\n', 'utf8')
console.log('  ✓ 3_LoaiXe_huongdan.txt')

// 4) XE
make('4_Xe.xlsx', 'Xe', [
  { label: 'Biển số *',           key: 'license_plate' },
  { label: 'Loại xe (mã/tên) *',  key: 'vehicle_type' },
  { label: 'ĐVVT (mã/tên) *',     key: 'ncc' },
], [
  { license_plate: '29H-12345', vehicle_type: 'PALLET', ncc: 'ALCA' },
])

// 5) VỊ TRÍ KHO  (location_code tự ghép = Tiền tố_Khu_Dãy_Tầng; tiền tố = nmsx_code nếu có, không thì Mã kho)
make('5_ViTriKho.xlsx', 'ViTriKho', [
  { label: 'Kho (mã) *',          key: 'warehouse' },
  { label: 'Khu (sub_code) *',    key: 'sub_code' },
  { label: 'Dãy (row) *',         key: 'row' },
  { label: 'Tầng/Kệ (shelf) *',   key: 'shelf' },
  { label: 'Sức chứa pallet',     key: 'max_pallets' },
  { label: 'Loại hàng (category)',key: 'category' },
  { label: 'Tên khu',             key: 'sub_name' },
  { label: 'Mã loại khu',         key: 'sub_type' },
], [
  { warehouse: 'BV', sub_code: 'TP1', row: '1', shelf: 'T1', max_pallets: 2, category: 'Thành phẩm', sub_name: 'Thành phẩm 1', sub_type: 'THANH_PHAM' },
])

// 6) TỒN KHO (opening balance)
make('6_TonKho.xlsx', 'TonKho', [
  { label: 'Mã pallet *',            key: 'pallet_code' },
  { label: 'Mã hàng *',              key: 'material_code' },
  { label: 'Kho (mã) *',             key: 'warehouse' },
  { label: 'Mã vị trí *',            key: 'location_code' },
  { label: 'Số thùng *',             key: 'cartons' },
  { label: 'Ngày SX * (yyyy-mm-dd)', key: 'production_date' },
  { label: 'NCC (mã/tên, tùy)',      key: 'ncc' },
  { label: 'QA (mặc định OK)',       key: 'qa_status' },
  { label: 'HSD (ngày, tùy)',        key: 'shelf_life_days' },
], [
  { pallet_code: 'BV-OPEN-0001', material_code: '210000262', warehouse: 'BV', location_code: 'BV_NVL1_1_T1', cartons: 100, production_date: '2026-06-01', ncc: 'DTV', qa_status: 'OK', shelf_life_days: '' },
])

console.log('\nXong. Mở thư mục templates/ — XOÁ dòng ví dụ rồi điền dữ liệu thật.')
