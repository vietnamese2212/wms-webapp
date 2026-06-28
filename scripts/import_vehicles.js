/**
 * Import Xe từ templates/4_Xe.xlsx  (chạy SAU khi đã có Loại xe + ĐVVT)
 * Run: cd backend && node ../scripts/import_vehicles.js ../templates/4_Xe.xlsx
 * vehicle_type khớp tên Loại xe; ncc khớp tên ĐVVT (type='ĐVVT'). Bỏ qua biển số đã tồn tại.
 */
const { supabase, S, readRows } = require('./_upload_util')
const { randomUUID } = require('crypto')

async function main() {
  const rows = readRows(process.argv[2] || '../templates/4_Xe.xlsx')
  const { data: vts } = await supabase.from('VehicleType').select('id, name')
  const vtMap = new Map((vts ?? []).map(v => [String(v.name).trim().toLowerCase(), v.id]))
  const { data: cos } = await supabase.from('TransportCompany').select('id, name, type')
  const coMap = new Map((cos ?? []).filter(c => c.type === 'ĐVVT').map(c => [String(c.name).trim().toLowerCase(), c.id]))
  const { data: ex } = await supabase.from('Vehicle').select('license_plate')
  const seen = new Set((ex ?? []).map(v => (v.license_plate || '').trim().toLowerCase()))
  const now = new Date().toISOString()
  let ok = 0, skip = 0, err = 0
  for (const r of rows) {
    const plate = S(r.license_plate), vt = S(r.vehicle_type), ncc = S(r.ncc)
    if (!plate || !vt || !ncc) { console.log('  SKIP (thiếu biển/loại/ĐVVT)'); skip++; continue }
    if (seen.has(plate.toLowerCase())) { console.log('  SKIP (đã có):', plate); skip++; continue }
    const vtId = vtMap.get(vt.toLowerCase())
    if (!vtId) { console.error('  ERR', plate, '— Loại xe không khớp:', vt); err++; continue }
    const nccId = coMap.get(ncc.toLowerCase())
    if (!nccId) { console.error('  ERR', plate, '— ĐVVT không khớp:', ncc); err++; continue }
    const rec = { id: randomUUID(), license_plate: plate, vehicle_type_id: vtId, ncc_id: nccId, is_active: true, created_at: now, updated_at: now }
    const { error } = await supabase.from('Vehicle').insert(rec)
    if (error) { console.error('  ERR', plate, '—', error.message); err++ }
    else { console.log('  OK', plate, '—', vt, '/', ncc); seen.add(plate.toLowerCase()); ok++ }
  }
  console.log(`\nXe: ${ok} thêm · ${skip} bỏ qua · ${err} lỗi`)
}
main().catch(e => { console.error(e); process.exit(1) })
