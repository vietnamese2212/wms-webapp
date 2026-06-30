/**
 * RÀ (dry-run, KHÔNG ghi) file Mã hàng trước khi import.
 * Run: node scripts/validate_materials.js [../templates/0_MaHang.xlsx]
 * Đọc theo VỊ TRÍ cột (chịu được cả khi mất dòng key). Báo lỗi + tân/cập nhật, không đụng DB.
 */
const { supabase, S, readRows } = require('./_upload_util')

const KEYS = ['material_code','material_description','category','unit','cartons_per_pallet',
  'units_per_carton','pallet_per_ea','weight_kg','shelf_life_days','product_type','custom_short_name','notes']
const VALID_CATS = ['Giấy','POSM','Raw','Thành phẩm','Thùng']
const VALID_UNITS = ['CAR','EA','KG']
const NO_SHELF = ['Thùng','POSM']                 // các loại KHÔNG cần HSD
const NEED_PPE = ['Raw','Thùng','Giấy']           // các loại BẮT BUỘC Pallet/EA
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isNaN(n) ? null : n }

async function main() {
  const rows = readRows(process.argv[2] || '../templates/0_MaHang.xlsx', KEYS)
  // Nạp TẤT CẢ mã đã có — phân trang (PostgREST cap 1000 dòng/response).
  const existing = new Set()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('Material').select('material_code').range(from, from + 999)
    for (const m of data ?? []) existing.add(String(m.material_code).trim())
    if (!data || data.length < 1000) break
  }

  const errors = [], warns = []
  const seen = new Map()
  let nNew = 0, nUpd = 0
  rows.forEach((r, i) => {
    const ln = i + 1
    const code = S(r.material_code), desc = S(r.material_description)
    const cat = S(r.category), unit = S(r.unit), cpp = S(r.cartons_per_pallet)
    const ppe = S(r.pallet_per_ea), hsd = S(r.shelf_life_days)
    const at = code || `(dòng dữ liệu #${ln})`

    if (code === '210000262') warns.push(`${at} — còn DÒNG VÍ DỤ mẫu, nên xoá`)
    const miss = []
    if (!code) miss.push('mã hàng'); if (!desc) miss.push('tên hàng')
    if (!cat) miss.push('loại hàng'); if (!unit) miss.push('ĐVT'); if (!cpp) miss.push('thùng/pallet')
    if (miss.length) { errors.push(`${at} — thiếu: ${miss.join(', ')}`); return }

    if (!VALID_CATS.includes(cat)) errors.push(`${at} — loại hàng lạ: "${cat}" (hợp lệ: ${VALID_CATS.join('/')})`)
    if (!VALID_UNITS.includes(unit)) errors.push(`${at} — ĐVT lạ: "${unit}" (hợp lệ: ${VALID_UNITS.join('/')})`)
    if (!NO_SHELF.includes(cat) && !hsd) errors.push(`${at} — thiếu HSD (bắt buộc cho ${cat})`)
    if (NEED_PPE.includes(cat) && !ppe) errors.push(`${at} — thiếu Pallet/EA (bắt buộc cho ${cat})`)
    if (num(r.cartons_per_pallet) != null && num(r.cartons_per_pallet) <= 0) warns.push(`${at} — Thùng/pallet ≤ 0`)

    if (code) {
      if (seen.has(code.toLowerCase())) errors.push(`${at} — TRÙNG mã trong file (đã có ở dòng #${seen.get(code.toLowerCase())})`)
      else seen.set(code.toLowerCase(), ln)
      existing.has(code) ? nUpd++ : nNew++
    }
  })

  console.log(`\n=== RÀ FILE MÃ HÀNG ===`)
  console.log(`Tổng dòng dữ liệu: ${rows.length}`)
  console.log(`  • Mã MỚI (sẽ thêm):      ${nNew}`)
  console.log(`  • Mã ĐÃ CÓ (sẽ cập nhật): ${nUpd}`)
  // Gom lỗi theo NHÓM (bỏ phần mã/dòng) để dễ nhìn
  const byType = new Map()
  for (const e of errors) {
    const key = e.replace(/^\S+ — /, '').replace(/"[^"]*"/g, '"…"').replace(/#\d+/g, '#N')
    byType.set(key, (byType.get(key) ?? 0) + 1)
  }
  console.log(`\nLỖI: ${errors.length}  — theo nhóm:`)
  ;[...byType.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,n]) => console.log(`  ✗ ${n.toString().padStart(4)} × ${k}`))
  console.log(`\nCẢNH BÁO: ${warns.length}`)
  warns.slice(0, 20).forEach(w => console.log('  ⚠', w))
  if (warns.length > 20) console.log(`  … và ${warns.length - 20} cảnh báo nữa`)
  console.log(errors.length ? '\n→ CÒN LỖI: sửa rồi rà lại trước khi import.' : '\n→ SẠCH LỖI: import được.')
}
main().catch(e => { console.error(e); process.exit(1) })
