/**
 * Import Material master data từ Excel vào Supabase.
 * Usage: cd backend && node ../scripts/import_materials.js ../Material_Template.xlsx
 *
 * Cột Excel (row 1 = label, row 2 = key, row 3+ = data):
 *   material_code, material_description, category, product_type, unit,
 *   weight_kg, cartons_per_pallet, cartons_per_pallet_mn, units_per_carton,
 *   ea_per_pallet, shelf_life_days, custom_short_name, notes
 *
 * Lưu ý: manufacturer_id lấy từ ký tự thứ 6 của QR code khi nhập kho
 *   B = NM Ba Vì · D = NM Bình Dương · O = NM Gia công
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

  const { data: existing } = await supabase.from('Material').select('material_code')
  const existingSet = new Set((existing ?? []).map(m => m.material_code))

  const now = new Date().toISOString()
  let inserted = 0, skipped = 0, errors = 0

  for (const row of rows) {
    const material_code = str(row['material_code'] ?? row['Mã hàng'])
    if (!material_code) { skipped++; continue }

    if (existingSet.has(material_code)) {
      console.log(`  SKIP: ${material_code} đã tồn tại`)
      skipped++
      continue
    }

    const material_description = str(row['material_description'] ?? row['Tên hàng'])
    const suffix    = material_code.slice(-3)
    const short_name = material_description ? `${material_description} [${suffix}]` : material_code

    const record = {
      id:                   randomUUID(),
      material_code,
      material_description,
      short_name,
      custom_short_name:    str(row['custom_short_name']    ?? row['Tên rút gọn']) || null,
      category:             str(row['category']             ?? row['Loại']),
      product_type:         str(row['product_type']         ?? row['Product Type']),
      unit:                 str(row['unit']                 ?? row['Đơn vị']),
      weight_kg:            num(row['weight_kg']            ?? row['KL (kg)']),
      cartons_per_pallet:   int(row['cartons_per_pallet']   ?? row['Thùng/Pallet']),
      cartons_per_pallet_mn:int(row['cartons_per_pallet_mn']?? row['Thùng/Pallet MN']),
      units_per_carton:     int(row['units_per_carton']     ?? row['Đv/Thùng']),
      ea_per_pallet:        int(row['ea_per_pallet']        ?? row['EA/Pallet']),
      shelf_life_days:      int(row['shelf_life_days']      ?? row['HSD (ngày)']),
      notes:                str(row['notes']                ?? row['Ghi chú']),
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
  console.log(`\nKết quả: ${inserted} inserted · ${skipped} skipped · ${errors} errors`)
}

main().catch(e => { console.error(e); process.exit(1) })
