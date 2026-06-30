/**
 * Import / cập nhật Material master data từ Excel vào Supabase (UPSERT).
 * Template: node scripts/gen_material_template.js  → templates/0_MaHang.xlsx
 * Usage: cd backend && node ../scripts/import_materials.js ../templates/0_MaHang.xlsx
 *
 * UPSERT theo material_code: mã MỚI → thêm (Tên hàng bắt buộc); mã ĐÃ CÓ → CẬP NHẬT.
 *   Khi cập nhật: chỉ ghi đè ô CÓ GIÁ TRỊ trong file; ô để trống = giữ nguyên (muốn xoá 1 trường → sửa trong form).
 *   short_name tự sinh lại = "Tên hàng [3 số cuối mã]" khi đổi Tên hàng. KHÔNG đụng overrides/NCC/QR/trạng thái.
 *
 * Cột Excel (row 1 = label, row 2 = key, row 3+ = data):
 *   material_code, material_description, category, product_type, unit,
 *   weight_kg, cartons_per_pallet, cartons_per_pallet_mn, units_per_carton,
 *   ea_per_pallet, shelf_life_days, custom_short_name, notes
 */

const path = require('path')
const BASE = path.join(__dirname, '..', 'backend')
const dotenv = require(path.join(BASE, 'node_modules', 'dotenv'))
dotenv.config({ path: path.join(BASE, '.env') })

const { createClient } = require(path.join(BASE, 'node_modules', '@supabase', 'supabase-js'))
const XLSX = require(path.join(BASE, 'node_modules', 'xlsx'))
const { randomUUID } = require('crypto')

const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^<|>$/g, '')
const supabase = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false } })

function num(v) {
  if (!v && v !== 0) return null
  const n = parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}
function int(v) {
  if (!v && v !== 0) return null
  const n = parseInt(String(v))
  return isNaN(n) ? null : n
}
function str(v) {
  const s = String(v ?? '').trim()
  return s || null
}

async function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    console.error('Usage: node import_materials.js <path-to-excel>')
    process.exit(1)
  }

  const wb = XLSX.readFile(path.resolve(filePath))
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 })

  // Row 0 = display labels, Row 1 = field keys, Row 2+ = data
  // Support both: template format (key row) or plain format (just headers)
  let rows
  if (raw.length >= 2 && String(raw[1][0]).includes('material_code')) {
    // Template format: row 1 is field keys
    const keys = raw[1]
    rows = raw.slice(2).map(r => Object.fromEntries(keys.map((k, i) => [k, r[i]])))
  } else {
    rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  }

  if (!rows.length) { console.error('Không có dữ liệu'); process.exit(1) }

  // UPSERT: mã mới → thêm; mã đã có → CẬP NHẬT (chỉ field có giá trị trong file; ô trống = giữ nguyên, không xoá).
  const { data: existing } = await supabase.from('Material').select('id, material_code')
  const existingMap = new Map((existing ?? []).map(m => [m.material_code, m.id]))

  const now = new Date().toISOString()
  let inserted = 0, updated = 0, skipped = 0, errors = 0

  for (const row of rows) {
    const material_code = str(row['material_code'] ?? row['Mã hàng'])
    if (!material_code) { skipped++; continue }

    const description  = str(row['material_description'] ?? row['Tên hàng'])
    const customShort  = str(row['custom_short_name']     ?? row['Tên rút gọn'])
    const category     = str(row['category']              ?? row['Loại'])
    const product_type = str(row['product_type']          ?? row['Product Type'])
    const unit         = str(row['unit']                  ?? row['Đơn vị'])
    const weight_kg    = num(row['weight_kg']             ?? row['KL (kg)'])
    const cpp          = int(row['cartons_per_pallet']    ?? row['Thùng/Pallet'])
    const cppMn        = int(row['cartons_per_pallet_mn'] ?? row['Thùng/Pallet MN'])
    const upc          = int(row['units_per_carton']      ?? row['Đv/Thùng'])
    const epp          = int(row['ea_per_pallet']         ?? row['EA/Pallet'])
    const sld          = int(row['shelf_life_days']       ?? row['HSD (ngày)'])
    const notes        = str(row['notes']                 ?? row['Ghi chú'])
    const shortOf = d => `${d} [${material_code.slice(-3)}]`

    const existingId = existingMap.get(material_code)
    if (existingId) {
      // CẬP NHẬT mã đã có — chỉ ghi đè ô có giá trị (muốn XOÁ 1 trường thì sửa trong form).
      const patch = { updated_at: now }
      if (description  != null) { patch.material_description = description; patch.short_name = shortOf(description) }
      if (customShort  != null) patch.custom_short_name = customShort
      if (category     != null) patch.category = category
      if (product_type != null) patch.product_type = product_type
      if (unit         != null) patch.unit = unit
      if (weight_kg    != null) patch.weight_kg = weight_kg
      if (cpp          != null) patch.cartons_per_pallet = cpp
      if (cppMn        != null) patch.cartons_per_pallet_mn = cppMn
      if (upc          != null) patch.units_per_carton = upc
      if (epp          != null) patch.ea_per_pallet = epp
      if (sld          != null) patch.shelf_life_days = sld
      if (notes        != null) patch.notes = notes
      const { error } = await supabase.from('Material').update(patch).eq('id', existingId)
      if (error) { console.error(`  ERR cập nhật ${material_code} — ${error.message}`); errors++ }
      else { console.log(`  UPD: ${material_code}`); updated++ }
    } else {
      // THÊM mã mới — Tên hàng bắt buộc (cột NOT NULL).
      if (!description) { console.error(`  ERR ${material_code} — thiếu Tên hàng (mã mới)`); errors++; continue }
      const record = {
        id: randomUUID(), material_code, material_description: description, short_name: shortOf(description),
        custom_short_name: customShort, category, product_type, unit, weight_kg,
        cartons_per_pallet: cpp, cartons_per_pallet_mn: cppMn, units_per_carton: upc,
        ea_per_pallet: epp, shelf_life_days: sld, notes,
        is_active: true, created_at: now, updated_at: now,
      }
      const { error } = await supabase.from('Material').insert(record)
      if (error) { console.error(`  ERR thêm ${material_code} — ${error.message}`); errors++ }
      else { console.log(`  NEW: ${material_code} — ${description}`); existingMap.set(material_code, record.id); inserted++ }
    }
  }
  console.log(`\nKết quả: ${inserted} thêm · ${updated} cập nhật · ${skipped} bỏ qua · ${errors} lỗi`)
}

main().catch(e => { console.error(e); process.exit(1) })
