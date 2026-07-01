/**
 * Sinh template cho DỮ LIỆU VẬN HÀNH HÀNG NGÀY (user upload Excel vào app).
 * Run: cd backend && node ../scripts/gen_daily_templates.js  → xuất ra ../templates/
 *
 * KHÁC template masterdata (0–6): các upload này app khớp theo TÊN CỘT (không có dòng key).
 *   → Dòng 1 = TÊN CỘT (đúng y như app đọc — ĐỪNG đổi tên), dòng 2+ = dữ liệu (xoá ví dụ rồi điền thật).
 *
 * 3 template khớp 3 tính năng upload có sẵn trong app:
 *   daily_1_XuatKho.xlsx        → Xuất kho: nút "Upload Excel" (tạo phiếu xuất GDO + delivery + item).  [backend outboundController.uploadExcel]
 *   daily_2_KeHoachVC_Xuat.xlsx → TMS Kế hoạch: nút "Upload kế hoạch từ Excel" (đơn vận chuyển XUẤT).   [TMSBookings ExcelUploadDialog]
 *   daily_3_KeHoachNhap.xlsx    → TMS Kế hoạch (tab Kế hoạch nhập): "Upload kế hoạch nhập".              [TMSBookings InboundPlanBulkUploadDialog]
 */
const path = require('path')
const fs = require('fs')
const BASE = path.join(__dirname, '..', 'backend')
const XLSX = require(path.join(BASE, 'node_modules', 'xlsx'))
const OUT = path.join(__dirname, '..', 'templates')
fs.mkdirSync(OUT, { recursive: true })

// header row + example rows (mảng object theo tên cột) → 1 sheet
function make(file, sheet, headers, examples) {
  const aoa = [headers, ...examples.map(ex => headers.map(h => ex[h] ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = headers.map(h => ({ wch: Math.max(11, h.length + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, path.join(OUT, file))
  console.log('  ✓', file)
}

console.log('Sinh template vận hành hàng ngày →', OUT)

// ── 1) XUẤT KHO (GDO) — gom theo "Số xe", trong 1 xe gom theo "Delivery", mỗi dòng = 1 mã hàng ──
// Format Số xe BẮT BUỘC: Mãkho_X_ddmmyy_stt (vd 20000016_X_100726_01). Ngày không được quá khứ.
const XUAT_HEADERS = [
  'Số xe', 'Ngày xuất', 'Kho xuất', 'Loại kho', 'DVVT', 'Delivery', 'Tên NPP',
  'Material', 'Material_type', 'Thùng', 'Hộp', 'Tải', 'Nhặt lẻ', 'Pallet',
  'Loại xuất', 'HEADER TEXT', 'Batch_Yêu cầu', '%Date_Yêu cầu', 'CS phụ trách',
]
make('daily_1_XuatKho.xlsx', 'XuatKho', XUAT_HEADERS, [
  { 'Số xe': '20000016_X_100726_01', 'Ngày xuất': '10/07/2026', 'Kho xuất': 'Kho Ba Vì', 'Loại kho': 'Thành phẩm', 'DVVT': '3S',
    'Delivery': 'DO-0001', 'Tên NPP': 'NPP Miền Bắc', 'Material': '510000126', 'Material_type': '', 'Thùng': 100, 'Hộp': '', 'Tải': '', 'Nhặt lẻ': 0, 'Pallet': 5,
    'Loại xuất': '', 'HEADER TEXT': '', 'Batch_Yêu cầu': '', '%Date_Yêu cầu': '', 'CS phụ trách': '' },
  { 'Số xe': '20000016_X_100726_01', 'Ngày xuất': '10/07/2026', 'Kho xuất': 'Kho Ba Vì', 'Loại kho': 'Thành phẩm', 'DVVT': '3S',
    'Delivery': 'DO-0001', 'Tên NPP': 'NPP Miền Bắc', 'Material': '510000289', 'Material_type': '', 'Thùng': 50, 'Hộp': '', 'Tải': '', 'Nhặt lẻ': 0, 'Pallet': 3,
    'Loại xuất': '', 'HEADER TEXT': '', 'Batch_Yêu cầu': '', '%Date_Yêu cầu': '', 'CS phụ trách': '' },
])

// ── 2) KẾ HOẠCH VẬN CHUYỂN — XUẤT (TmsOrder) ──
// Format Mã đơn BẮT BUỘC: Mãkho_X_ddmmyy_stt (vd 20000016_X_100726_1). Hướng = Xuất. Ngày không quá khứ.
const VC_HEADERS = ['Mã đơn', 'NPP', 'Kho', 'Ngày', 'Hướng', 'Loại kho', 'Loại xe', 'ĐVVT', 'Thùng', 'Pallet', 'Tấn', 'GDO', 'Ghi chú', 'Ưu tiên']
make('daily_2_KeHoachVC_Xuat.xlsx', 'KeHoachVC', VC_HEADERS, [
  { 'Mã đơn': '20000016_X_100726_1', 'NPP': 'NPP Miền Bắc', 'Kho': 'Kho Ba Vì', 'Ngày': '10/07/2026', 'Hướng': 'Xuất',
    'Loại kho': 'Thành phẩm', 'Loại xe': 'XE 4 PALLET', 'ĐVVT': '3S', 'Thùng': 150, 'Pallet': 8, 'Tấn': 2.5, 'GDO': 'DO-0001', 'Ghi chú': '', 'Ưu tiên': '' },
])

// ── 3) KẾ HOẠCH NHẬP (inbound_plan_lines) — hàng NCC ngoài / chuyển kho ──
// ĐVT phải khớp đơn vị của mã hàng. Loại kho ∈ danh mục; Loại xe ∈ danh mục.
const NHAP_HEADERS = ['Mã kho', 'Mã NCC', 'Loại kho', 'Loại xe', 'Mã hàng', 'ĐVT', 'Số PO', 'Số thùng', 'Số pallet']
make('daily_3_KeHoachNhap.xlsx', 'KeHoachNhap', NHAP_HEADERS, [
  { 'Mã kho': '20000016', 'Mã NCC': '10008728', 'Loại kho': 'Thành phẩm', 'Loại xe': 'XE 4 PALLET', 'Mã hàng': '510000126', 'ĐVT': 'CAR', 'Số PO': 'PO-0001', 'Số thùng': 500, 'Số pallet': 10 },
])

console.log('\nXong. Dòng 1 = TÊN CỘT (đừng đổi). Xoá dòng ví dụ rồi điền dữ liệu thật.')
