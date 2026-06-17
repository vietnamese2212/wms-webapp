/**
 * Sinh Employee_Template.xlsx để upload nhân viên.
 * Run: cd backend && NODE_PATH="$(pwd)/node_modules" node ../scripts/gen_employee_template.js
 * (chạy từ backend để đọc .env; NODE_PATH để tìm xlsx/pg trong backend/node_modules)
 */
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')
const { Client } = require('pg')

const env = fs.readFileSync('.env', 'utf8')
const url = (env.match(/DATABASE_URL=(.*)/) || [])[1].trim().replace(/^"|"$/g, '')

const HEADERS = [
  'ma_nhan_vien', 'ho_ten', 'ten_dang_nhap', 'mat_khau',
  'chuc_danh', 'kho', 'pham_vi_kho', 'bo_phan', 'sdt', 'la_tai_xe',
]
const NOTE = [
  '* Bắt buộc: ma_nhan_vien, ho_ten, ten_dang_nhap, mat_khau, chuc_danh, kho',
  'ten_dang_nhap = tên dùng để ĐĂNG NHẬP (duy nhất). chuc_danh & kho phải khớp danh mục (sheet DanhMuc).',
  'kho: nhiều kho cách nhau bằng dấu phẩy. pham_vi_kho: ASSIGNED (mặc định) hoặc NATIONAL. la_tai_xe: ghi x nếu là tài xế.',
]

;(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const jts = (await c.query(`SELECT name FROM "JobTitle" ORDER BY name`)).rows.map(r => r.name)
  const whs = (await c.query(`SELECT name FROM "Warehouse" ORDER BY name`)).rows.map(r => r.name)
  await c.end()

  // Sheet 1: NhanVien — header + 2 dòng ví dụ
  const data = [
    HEADERS,
    ['EMP100', 'Nguyễn Văn A', 'vana', '123456', jts[0] || 'Thủ kho TP', whs[0] || 'Kho Ba Vì', 'ASSIGNED', 'Kho', '0901234567', ''],
    ['EMP101', 'Trần Thị B', 'thib', '123456', 'Lái xe nâng', `${whs[0] || 'Kho Ba Vì'}, ${whs[1] || 'Kho AB'}`, 'ASSIGNED', 'Kho', '', 'x'],
  ]
  const wsData = XLSX.utils.aoa_to_sheet(data)
  wsData['!cols'] = HEADERS.map(h => ({ wch: Math.max(14, h.length + 2) }))

  // Sheet 2: DanhMuc — giá trị hợp lệ
  const maxLen = Math.max(jts.length, whs.length)
  const ref = [['chuc_danh (hợp lệ)', 'kho (hợp lệ)']]
  for (let i = 0; i < maxLen; i++) ref.push([jts[i] || '', whs[i] || ''])
  const wsRef = XLSX.utils.aoa_to_sheet(ref)
  wsRef['!cols'] = [{ wch: 28 }, { wch: 20 }]

  // Sheet 3: HuongDan
  const wsNote = XLSX.utils.aoa_to_sheet(NOTE.map(l => [l]))
  wsNote['!cols'] = [{ wch: 110 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsData, 'NhanVien')
  XLSX.utils.book_append_sheet(wb, wsRef, 'DanhMuc')
  XLSX.utils.book_append_sheet(wb, wsNote, 'HuongDan')

  const out = path.resolve('..', 'Employee_Template.xlsx')
  XLSX.writeFile(wb, out)
  console.log('✓ Đã tạo', out)
  console.log(`  ${jts.length} chức danh, ${whs.length} kho trong sheet DanhMuc`)
})().catch(e => { console.error('Lỗi:', e.message); process.exit(1) })
