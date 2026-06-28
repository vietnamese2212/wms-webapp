/**
 * Import Kho từ templates/1_Kho.xlsx
 * Run: cd backend && node ../scripts/import_warehouses.js ../templates/1_Kho.xlsx
 * Bỏ qua mã kho đã tồn tại. Mặc định warehouse_type=CENTRAL, inventory_mode=QR.
 */
const { supabase, S, readRows } = require('./_upload_util')
const { randomUUID } = require('crypto')

async function main() {
  const rows = readRows(process.argv[2] || '../templates/1_Kho.xlsx')
  const { data: ex } = await supabase.from('Warehouse').select('code')
  const seen = new Set((ex ?? []).map(w => (w.code || '').toLowerCase()))
  const now = new Date().toISOString()
  let ok = 0, skip = 0, err = 0
  for (const r of rows) {
    const code = S(r.code), name = S(r.name)
    if (!code || !name) { console.log('  SKIP (thiếu mã/tên)'); skip++; continue }
    if (seen.has(code.toLowerCase())) { console.log('  SKIP (đã có):', code); skip++; continue }
    const rec = {
      id: randomUUID(), code, name,
      warehouse_type: (S(r.warehouse_type) || 'CENTRAL').toUpperCase(),
      inventory_mode: (S(r.inventory_mode) || 'QR').toUpperCase(),
      nmsx_code: S(r.nmsx_code), address: S(r.address),
      is_active: true, created_at: now, updated_at: now,
    }
    const { error } = await supabase.from('Warehouse').insert(rec)
    if (error) { console.error('  ERR', code, '—', error.message); err++ }
    else { console.log('  OK', code, '—', name); seen.add(code.toLowerCase()); ok++ }
  }
  console.log(`\nKho: ${ok} thêm · ${skip} bỏ qua · ${err} lỗi`)
}
main().catch(e => { console.error(e); process.exit(1) })
