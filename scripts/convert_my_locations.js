/**
 * Convert dữ liệu vị trí hiện có của user → template 5_ViTriKho.xlsx (để sửa rồi import).
 * Run: node scripts/convert_my_locations.js
 * Cột vào: <Khu vực>\t<Vị trí>\t<Sức chứa>. Map:
 *  - Vị trí dạng "1t1" → Dãy=1, Tầng=T1
 *  - Vị trí dạng tên (Kho 2, NĐ SCA, Pin ROBOT…) → Dãy=<tên viết tắt>, Tầng để trống (vị trí khối/sàn)
 *  - Khu (sub_code) = mã hoá từ tên khu vực (bỏ dấu, viết HOA, bỏ khoảng trắng)
 * ⚠️ Kho mặc định = 20000016 (Kho Ba Vì). ĐỔI cột "Kho" nếu là kho khác.
 */
const path = require('path')
const fs = require('fs')
const XLSX = require(path.join(__dirname, '..', 'backend', 'node_modules', 'xlsx'))

const WAREHOUSE = '20000016' // Kho Ba Vì

const RAW = `Kho 1\t1t1\t43
Kho 1\t1t2\t43
Kho 1\t1t3\t43
Kho 1\t1t4\t43
Kho 1\t2t1\t43
Kho 1\t2t2\t43
Kho 1\t2t3\t43
Kho 1\t2t4\t43
Kho 1\t3t1\t43
Kho 1\t3t2\t43
Kho 1\t3t3\t43
Kho 1\t3t4\t43
Kho 1\t4t1\t43
Kho 1\t4t2\t43
Kho 1\t4t3\t43
Kho 1\t4t4\t43
Kho 1\t5t1\t43
Kho 1\t5t2\t43
Kho 1\t5t3\t43
Kho 1\t5t4\t43
Kho 1\t6t1\t43
Kho 1\t6t2\t43
Kho 1\t6t3\t43
Kho 1\t6t4\t43
Kho 1\t7t1\t43
Kho 1\t7t2\t43
Kho 1\t7t3\t43
Kho 1\t7t4\t43
Kho 1\t7t5\t43
Kho 1\t8t1\t43
Kho 1\t8t2\t43
Kho 1\t8t3\t43
Kho 1\t8t4\t43
Kho 1\t8t5\t43
Kho 1\t9t1\t43
Kho 1\t9t2\t43
Kho 1\t9t3\t43
Kho 1\t9t4\t43
Kho 1\t9t5\t43
Kho 1\t10t1\t43
Kho 1\t10t2\t43
Kho 1\t10t3\t43
Kho 1\t10t4\t43
Kho 1\t10t5\t43
Kho 1\t11t1\t43
Kho 1\t11t2\t43
Kho 1\t11t3\t43
Kho 1\t11t4\t43
Kho 1\t11t5\t43
Kho 1\t12t1\t43
Kho 1\t12t2\t43
Kho 1\t12t3\t43
Kho 1\t12t4\t43
Kho 1\t12t5\t43
Kho 1\t13t1\t43
Kho 1\t13t2\t43
Kho 1\t13t3\t43
Kho 1\t13t4\t43
Kho 1\t13t5\t43
Kho 1\t14t1\t43
Kho 1\t14t2\t43
Kho 1\t14t3\t43
Kho 1\t14t4\t43
Kho 1\t14t5\t43
Kho 1\t15t1\t43
Kho 1\t15t2\t43
Kho 1\t15t3\t43
Kho 1\t15t4\t43
Kho 1\t15t5\t43
Kho 1\t16t1\t43
Kho 1\t16t2\t43
Kho 1\t16t3\t43
Kho 1\t16t4\t43
Kho 1\t16t5\t43
Kho 1\t17t1\t43
Kho 1\t17t2\t43
Kho 1\t17t3\t43
Kho 1\t17t4\t43
Kho 1\t17t5\t43
Kho 1\t18t1\t43
Kho 1\t18t2\t43
Kho 1\t18t3\t43
Kho 1\t18t4\t43
Kho 1\t18t5\t43
Kho 1\t19t1\t43
Kho 1\t19t2\t43
Kho 1\t19t3\t43
Kho 1\t19t4\t43
Kho 1\t19t5\t43
Kho 1\t20t1\t43
Kho 1\t20t2\t43
Kho 1\t20t3\t43
Kho 1\t20t4\t43
Kho 1\t20t5\t43
Kho 1\t21t1\t43
Kho 1\t21t2\t43
Kho 1\t21t3\t43
Kho 1\t21t4\t43
Kho 1\t21t5\t43
Kho 1\t22t1\t43
Kho 1\t22t2\t43
Kho 1\t22t3\t43
Kho 1\t22t4\t43
Kho 1\t22t5\t43
Kho 1\t23t1\t43
Kho 1\t23t2\t43
Kho 1\t23t3\t43
Kho 1\t23t4\t43
Kho 1\t24t1\t43
Kho 1\t24t2\t43
Kho 1\t24t3\t43
Kho 1\t24t4\t43
Kho 1\t25t1\t43
Kho 1\t25t2\t43
Kho 1\t25t3\t43
Kho 1\t25t4\t43
Kho 1\t26t1\t43
Kho 1\t26t2\t43
Kho 1\t26t3\t43
Kho 1\t26t4\t43
Kho 1\t27t1\t43
Kho 1\t27t2\t43
Kho 1\t27t3\t43
Kho 1\t27t4\t43
Kho 1\t28t1\t43
Kho 1\t28t2\t43
Kho 1\t28t3\t43
Kho 1\t28t4\t43
Kho 1\t29t1\t43
Kho 1\t29t2\t43
Kho 1\t29t3\t43
Kho 1\t29t4\t43
Kho 1\t30t1\t43
Kho 1\t30t2\t43
Kho 1\t30t3\t43
Kho 1\t30t4\t43
Kho 3\t31t1\t22
Kho 3\t31t2\t22
Kho 3\t31t3\t22
Kho 3\t32t1\t22
Kho 3\t32t2\t22
Kho 3\t32t3\t22
Kho 3\t33t1\t22
Kho 3\t33t2\t22
Kho 3\t33t3\t22
Kho 3\t34t1\t22
Kho 3\t34t2\t22
Kho 3\t34t3\t22
Kho 3\t35t1\t22
Kho 3\t35t2\t22
Kho 3\t35t3\t22
Kho 3\t36t1\t22
Kho 3\t36t2\t22
Kho 3\t36t3\t22
Kho 3\t37t1\t22
Kho 3\t37t2\t22
Kho 3\t37t3\t22
Kho 3\t38t1\t22
Kho 3\t38t2\t22
Kho 3\t38t3\t22
Kho 3\t39t1\t22
Kho 3\t39t2\t22
Kho 3\t39t3\t22
Kho 3\t40t1\t22
Kho 3\t40t2\t22
Kho 3\t40t3\t22
Kho 3\t41t1\t22
Kho 3\t41t2\t22
Kho 3\t41t3\t22
Kho 3\t42t1\t22
Kho 3\t42t2\t22
Kho 3\t42t3\t22
Kho 3\t43t1\t22
Kho 3\t43t2\t22
Kho 3\t43t3\t22
Kho 2\tKho 2\t200
Kho SX\tKho bao gói\t300
Kho 1\tKho 1 Lẻ\t300
Kho 1\tPin ROBOT\t300
Kho 3\tKho 3 Lẻ\t300
Kho 3\tRack Lẻ\t300
Không rõ\tKhông rõ\t300
Ngoài đường\tNĐ SCA\t300
Ngoài đường\tNĐ CONT\t300
Ngoài đường\tNĐ PALLET 1\t300
Ngoài đường\tNĐ PALLET 2\t300
KPH\tKPH\t300
Kho QA\tKho QA\t300
Kho Lạnh\tKho Lạnh\t500`

const noDiacritics = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
const codeOf = s => noDiacritics(s).toUpperCase().replace(/[^A-Z0-9]/g, '')

const rows = RAW.trim().split('\n').map(line => {
  const [zone, pos, cap] = line.split('\t').map(s => s.trim())
  const sub_code = codeOf(zone)
  let row, shelf = ''
  const m = /^(\d+)t(\d+)$/i.exec(pos)
  if (m) { row = m[1]; shelf = 'T' + m[2] }                 // rack: dãy + tầng
  else   { row = codeOf(pos) === sub_code ? '1' : codeOf(pos) }  // vị trí khối/sàn (không tầng)
  return { warehouse: WAREHOUSE, sub_code, row, shelf, max_pallets: cap, category: '', sub_name: zone, sub_type: '' }
})

const LABELS = ['Kho (mã) *', 'Khu (sub_code) *', 'Dãy (row) *', 'Tầng/Kệ (shelf)', 'Sức chứa pallet', 'Loại hàng (category)', 'Tên khu', 'Mã loại khu']
const KEYS   = ['warehouse', 'sub_code', 'row', 'shelf', 'max_pallets', 'category', 'sub_name', 'sub_type']
const aoa = [LABELS, KEYS, ...rows.map(r => KEYS.map(k => r[k]))]
const ws = XLSX.utils.aoa_to_sheet(aoa)
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'ViTriKho')
const out = path.join(__dirname, '..', 'templates', '5_ViTriKho.xlsx')
fs.mkdirSync(path.dirname(out), { recursive: true })
XLSX.writeFile(wb, out)

// Tóm tắt theo khu
const byZone = {}
for (const r of rows) byZone[r.sub_code] = (byZone[r.sub_code] || 0) + 1
console.log(`Đã ghi ${rows.length} vị trí → ${out}\n`)
console.log('Khu (sub_code) → số vị trí · mã vị trí mẫu (tiền tố B_ tự sinh khi import):')
for (const [z, n] of Object.entries(byZone)) {
  const sample = rows.find(r => r.sub_code === z)
  const code = ['B', sample.sub_code, sample.row, sample.shelf].filter(Boolean).join('_')
  console.log(`  ${z.padEnd(10)} ${String(n).padStart(3)}  vd ${code}`)
}
