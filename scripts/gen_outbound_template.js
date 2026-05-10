// Run: node scripts/gen_outbound_template.js
const XLSX = require('xlsx')
const path = require('path')

const headers = [
  'Kho xuất', 'Loại kho', 'Số xe', 'Ngày xuất', 'DVVT',
  'Delivery', 'Tên NPP', 'Material', 'Material_type',
  'Thùng', 'Hộp', 'Tải', 'Nhặt lẻ', 'Pallet',
  'Loại xuất', 'HEADER TEXT', 'Batch_Yêu cầu', '%Date_Yêu cầu', 'CS phụ trách',
]

const sample = [
  'Kho Ba Vì', 'Kho TP', '100526_BV01', '10/05/2026', 'Dịch vụ',
  '80012345', 'NPP Miền Bắc', '10010001', 'Thành phẩm',
  10, 0, 5.2, 0, 2.5,
  'Nội địa', '', '', '', 'CS01',
]

const ws = XLSX.utils.aoa_to_sheet([headers, sample])

// Column widths
ws['!cols'] = headers.map((h, i) => {
  if (i === 2) return { wch: 18 } // Số xe
  if (i === 6) return { wch: 20 } // Tên NPP
  if (i === 15) return { wch: 20 } // HEADER TEXT
  return { wch: Math.max(h.length + 2, 12) }
})

const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Outbound')

const outPath = path.join(__dirname, '..', 'Outbound_Template.xlsx')
XLSX.writeFile(wb, outPath)
console.log('Template written to', outPath)
