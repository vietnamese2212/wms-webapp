/**
 * Import Customer (khách hàng / NPP) từ Excel vào Supabase.
 * Usage: cd backend && node ../scripts/import_customers.js ../Customer_Data.xlsx
 *
 * Cột Excel:
 *   customer_code, name, short_name, address, province, region, phone, notes
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

function str(v) {
  const s = String(v ?? '').trim()
  return s || null
}

async function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    console.error('Usage: node import_customers.js <path-to-excel>')
    process.exit(1)
  }

  const wb = XLSX.readFile(path.resolve(filePath))
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  if (!rows.length) { console.error('File trống'); process.exit(1) }

  const { data: existing } = await supabase.from('Customer').select('customer_code')
  const existingSet = new Set((existing ?? []).map(c => c.customer_code))

  const now = new Date().toISOString()
  let inserted = 0, skipped = 0, errors = 0

  for (const row of rows) {
    const customer_code = str(row['customer_code'] ?? row['Mã KH'])
    const name          = str(row['name']          ?? row['Tên KH'] ?? row['Tên khách hàng'])
    if (!customer_code || !name) { console.log('  SKIP: thiếu customer_code hoặc name'); skipped++; continue }

    if (existingSet.has(customer_code)) {
      console.log(`  SKIP: ${customer_code} đã tồn tại`)
      skipped++
      continue
    }

    const record = {
      id:            randomUUID(),
      customer_code,
      name,
      short_name:    str(row['short_name']  ?? row['Tên rút gọn']),
      address:       str(row['address']     ?? row['Địa chỉ']),
      province:      str(row['province']    ?? row['Tỉnh/Thành']),
      region:        str(row['region']      ?? row['Vùng']),
      phone:         str(row['phone']       ?? row['SĐT']),
      notes:         str(row['notes']       ?? row['Ghi chú']),
      is_active:     true,
      updated_at:    now,
    }

    const { error } = await supabase.from('Customer').insert(record)
    if (error) {
      console.error(`  ERR: ${customer_code} — ${error.message}`)
      errors++
    } else {
      console.log(`  OK:  ${customer_code} — ${name}`)
      inserted++
      existingSet.add(customer_code)
    }
  }

  console.log(`\nKết quả: ${inserted} inserted, ${skipped} skipped, ${errors} errors`)
}

main().catch(e => { console.error(e); process.exit(1) })
