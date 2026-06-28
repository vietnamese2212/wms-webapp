/**
 * Import NCC / ĐVVT từ templates/2_NCC_DVVT.xlsx
 * Run: cd backend && node ../scripts/import_companies.js ../templates/2_NCC_DVVT.xlsx
 * type phải là 'NCC' hoặc 'ĐVVT'. Bỏ qua mã đã tồn tại.
 */
const { supabase, S, readRows } = require('./_upload_util')
const { randomUUID } = require('crypto')

async function main() {
  const rows = readRows(process.argv[2] || '../templates/2_NCC_DVVT.xlsx')
  const { data: ex } = await supabase.from('TransportCompany').select('code')
  const seen = new Set((ex ?? []).map(c => (c.code || '').toLowerCase()))
  const now = new Date().toISOString()
  let ok = 0, skip = 0, err = 0
  for (const r of rows) {
    const code = S(r.code), name = S(r.name)
    let type = S(r.type)
    if (!code || !name || !type) { console.log('  SKIP (thiếu mã/tên/loại)'); skip++; continue }
    type = type.toUpperCase() === 'NCC' ? 'NCC' : 'ĐVVT'
    if (seen.has(code.toLowerCase())) { console.log('  SKIP (đã có):', code); skip++; continue }
    const rec = {
      id: randomUUID(), code, name, type,
      contact_name: S(r.contact_name), contact_phone: S(r.contact_phone),
      is_active: true, created_at: now, updated_at: now,
    }
    const { error } = await supabase.from('TransportCompany').insert(rec)
    if (error) { console.error('  ERR', code, '—', error.message); err++ }
    else { console.log('  OK', code, `(${type})`, '—', name); seen.add(code.toLowerCase()); ok++ }
  }
  console.log(`\nNCC/ĐVVT: ${ok} thêm · ${skip} bỏ qua · ${err} lỗi`)
}
main().catch(e => { console.error(e); process.exit(1) })
