/**
 * Chuẩn hóa ĐVT file Mã hàng về CAR/EA/KG → ghi file mới *_chuan.xlsx (giữ bản gốc).
 * Thùng→CAR, Kg→KG, EA giữ. Giữ nguyên MỌI cột khác. Khôi phục dòng key. Không xoá/sửa dòng nào khác.
 * Run: node scripts/fix_material_units.js templates/0_MaHang.xlsx
 */
const path = require('path')
const XLSX = require(path.join(__dirname, '..', 'backend', 'node_modules', 'xlsx'))

const KEYS = ['material_code','material_description','category','unit','cartons_per_pallet',
  'units_per_carton','pallet_per_ea','weight_kg','shelf_life_days','product_type','custom_short_name','notes']

const inFile = process.argv[2] || 'templates/0_MaHang.xlsx'
const outFile = inFile.replace(/\.xlsx$/i, '_chuan.xlsx')

const wb = XLSX.readFile(path.resolve(inFile))
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', header: 1 })
const isKeyRow = r => KEYS.every((k, i) => String((r || [])[i] ?? '').trim() === k)
const start = raw.length > 1 && isKeyRow(raw[1]) ? 2 : 1
const labelRow = raw[0]

function normUnit(u) {
  const s = String(u ?? '').trim()
  const l = s.toLowerCase()
  if (l === 'thùng' || l === 'thung') return 'CAR'
  if (l === 'kg') return 'KG'
  if (l === 'ea')  return 'EA'
  if (l === 'car') return 'CAR'
  return s   // lạ → giữ nguyên để còn thấy
}

let cChanged = 0
const counts = {}
const data = raw.slice(start)
  .filter(r => (r || []).some(v => String(v ?? '').trim()))
  .map(r => {
    const row = KEYS.map((_, i) => (r || [])[i] ?? '')
    const before = String(row[3] ?? '').trim()
    const after = normUnit(before)
    if (after !== before) cChanged++
    counts[after] = (counts[after] || 0) + 1
    row[3] = after
    return row
  })

const ws = XLSX.utils.aoa_to_sheet([labelRow, KEYS, ...data])
const out = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(out, ws, 'MaHang')
XLSX.writeFile(out, path.resolve(outFile))

console.log(`Đã ghi ${data.length} dòng → ${outFile}`)
console.log(`ĐVT đã đổi: ${cChanged} dòng`)
console.log('ĐVT sau chuẩn hóa:', Object.entries(counts).map(([k, n]) => `${k}=${n}`).join('  '))
