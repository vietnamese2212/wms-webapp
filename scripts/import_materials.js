/**
 * Import Material master data từ Excel vào Supabase.
 * Usage: cd backend && node ../scripts/import_materials.js ../Material_Data.xlsx
 *
 * Cột Excel (theo thứ tự hoặc theo tên):
 *   material_code, material_description, category, product_type, unit,
 *   weight_kg, cartons_per_pallet, cartons_per_pallet_mn, units_per_carton,
 *   ea_per_pallet, shelf_life_days, storage_category, old_code,
 *   manufacturer_code, custom_short_name, notes
 */

const path = require('path')
process.chdir(path.join(__dirname, '..', 'backend'))
require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const { randomUUID } = require('crypto')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

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
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  if (!rows.length) { console.error('File trống'); process.exit(1) }

  // Pre-load manufacturers for code → id lookup
  const { data: mfrs } = await supabase.from('Manufacturer').select('id, code')
  const mfrMap = new Map((mfrs ?? []).map(m => [m.code.trim(), m.id]))

  // Pre-load existing material codes to detect duplicates
  const { data: existing } = await supabase.from('Material').select('material_code')
  const existingSet = new Set((existing ?? []).map(m => m.material_code))

  const now = new Date().toISOString()
  let inserted = 0, skipped = 0, errors = 0

  for (const row of rows) {
    const material_code = str(row['material_code'] ?? row['Mã hàng'] ?? row['Material Code'])
    if (!material_code) { console.log('  SKIP: thiếu material_code'); skipped++; continue }

    if (existingSet.has(material_code)) {
      console.log(`  SKIP: ${material_code} đã tồn tại`)
      skipped++
      continue
    }

    const mfr_code = str(row['manufacturer_code'] ?? row['Mã NMSX'])
    const manufacturer_id = mfr_code ? (mfrMap.get(mfr_code) ?? null) : null
    if (mfr_code && !manufacturer_id) {
      console.warn(`  WARN: manufacturer_code "${mfr_code}" không tìm thấy — để null`)
    }

    const material_description = str(row['material_description'] ?? row['Tên hàng'] ?? row['Description'])
    // auto short_name: "{desc} [{3 số cuối code}]"
    const suffix = material_code.slice(-3)
    const short_name = material_description ? `${material_description} [${suffix}]` : material_code

    const record = {
      id:                   randomUUID(),
      material_code,
      material_description,
      short_name,
      custom_short_name:    str(row['custom_short_name'] ?? row['Tên rút gọn']),
      category:             str(row['category']           ?? row['Loại']),
      product_type:         str(row['product_type']       ?? row['Product Type']),
      unit:                 str(row['unit']               ?? row['Đơn vị']),
      weight_kg:            num(row['weight_kg']          ?? row['KL (kg)']),
      cartons_per_pallet:   int(row['cartons_per_pallet'] ?? row['Thùng/Pallet']),
      cartons_per_pallet_mn:int(row['cartons_per_pallet_mn'] ?? row['Thùng/Pallet MN']),
      units_per_carton:     int(row['units_per_carton']   ?? row['Đv/Thùng']),
      ea_per_pallet:        int(row['ea_per_pallet']      ?? row['EA/Pallet']),
      shelf_life_days:      int(row['shelf_life_days']    ?? row['HSD (ngày)']),
      storage_category:     str(row['storage_category']  ?? row['Loại bảo quản']),
      old_code:             str(row['old_code']           ?? row['Mã cũ']),
      manufacturer_id,
      notes:                str(row['notes']              ?? row['Ghi chú']),
      is_active:            true,
      created_at:           now,
      updated_at:           now,
    }

    const { error } = await supabase.from('Material').insert(record)
    if (error) {
      console.error(`  ERR: ${material_code} — ${error.message}`)
      errors++
    } else {
      console.log(`  OK:  ${material_code} — ${material_description}`)
      inserted++
      existingSet.add(material_code)
    }
  }

  console.log(`\nKết quả: ${inserted} inserted, ${skipped} skipped, ${errors} errors`)
}

main().catch(e => { console.error(e); process.exit(1) })
