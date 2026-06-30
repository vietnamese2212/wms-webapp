/**
 * Sinh template Mã hàng (Material) → templates/0_MaHang.xlsx (để up khi cần thêm mã mới).
 * Run: node scripts/gen_material_template.js   (KHÔNG đụng các template khác)
 * Import: cd backend && node ../scripts/import_materials.js ../templates/0_MaHang.xlsx
 * Dòng 1 = nhãn, dòng 2 = KEY (ĐỪNG sửa/xoá), dòng 3+ = dữ liệu (xoá dòng ví dụ rồi điền thật).
 *
 * Bắt buộc: Mã hàng, Tên hàng, Loại hàng, ĐVT, Thùng/Pallet, KL (kg).
 * HSD (ngày): bắt buộc nếu Loại hàng KHÔNG phải Thùng/POSM (giống luật trong form). Thùng/POSM để trống được.
 * Pallet/EA: "1 EA = ? pallet" (vd 0.00005) — BẮT BUỘC cho Raw/Thùng/Giấy (kho NVL), dùng quy đổi tồn EA→pallet.
 * Trùng Mã hàng đã có → bỏ qua (không ghi đè). short_name tự sinh = "Tên hàng [3 số cuối mã]".
 */
const path = require('path')
const fs = require('fs')
const XLSX = require(path.join(__dirname, '..', 'backend', 'node_modules', 'xlsx'))

const cols = [
  { label: 'Mã hàng *',         key: 'material_code' },
  { label: 'Tên hàng *',        key: 'material_description' },
  { label: 'Loại hàng *',       key: 'category' },              // Thành phẩm / Thùng / POSM / Raw / Giấy
  { label: 'ĐVT *',             key: 'unit' },                  // CAR / EA / KG
  { label: 'Thùng/Pallet *',    key: 'cartons_per_pallet' },
  { label: 'Đv/Thùng',          key: 'units_per_carton' },
  { label: 'Pallet/EA',         key: 'pallet_per_ea' },          // 1 EA = ? pallet (vd 0.00005) — BẮT BUỘC cho Raw/Thùng/Giấy
  { label: 'KL (kg) *',         key: 'weight_kg' },
  { label: 'HSD (ngày)',        key: 'shelf_life_days' },       // bắt buộc nếu KHÔNG phải Thùng/POSM
  { label: 'Loại SP',           key: 'product_type' },
  { label: 'Tên rút gọn',       key: 'custom_short_name' },
  { label: 'Ghi chú',           key: 'notes' },
]

const example = {
  material_code: '210000262', material_description: 'Sữa tươi tiệt trùng 180ml',
  category: 'Thành phẩm', unit: 'CAR', cartons_per_pallet: 80,
  units_per_carton: 48, pallet_per_ea: '', weight_kg: 9.6, shelf_life_days: 180,
  product_type: 'UHT', custom_short_name: '', notes: '',
}

const aoa = [cols.map(c => c.label), cols.map(c => c.key), cols.map(c => example[c.key] ?? '')]
const ws = XLSX.utils.aoa_to_sheet(aoa)
ws['!cols'] = cols.map(c => ({ wch: Math.max(12, c.label.length + 2) }))
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'MaHang')
const out = path.join(__dirname, '..', 'templates', '0_MaHang.xlsx')
fs.mkdirSync(path.dirname(out), { recursive: true })
XLSX.writeFile(wb, out)
console.log('Đã ghi template Mã hàng →', out, '\n(XOÁ dòng ví dụ rồi điền dữ liệu thật trước khi import.)')
