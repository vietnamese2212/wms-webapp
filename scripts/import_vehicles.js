/**
 * Import Xe từ templates/4_Xe.xlsx  (chạy SAU khi đã có Loại xe + ĐVVT)
 * Run: cd backend && node ../scripts/import_vehicles.js ../templates/4_Xe.xlsx
 * vehicle_type + ncc khớp theo MÃ (ưu tiên) hoặc TÊN (fallback). Tên trùng → buộc dùng mã.
 * ĐVVT lấy trong TransportCompany type='ĐVVT'.
 * Dedup theo (biển số + ĐVVT) — KHỚP ràng buộc DB Vehicle_plate_ncc_uidx: 1 biển có thể
 * thuộc NHIỀU ĐVVT (xe chạy cho nhiều đơn vị) → vào cả 2; chỉ bỏ khi trùng cả biển lẫn ĐVVT.
 */
const { supabase, S, readRows, codeNameResolver, fetchAll } = require('./_upload_util')
const { randomUUID } = require('crypto')

const KEYS = ['license_plate', 'vehicle_type', 'ncc']

async function main() {
  const rows = readRows(process.argv[2] || '../templates/4_Xe.xlsx', KEYS)
  // fetchAll: né cap ~1000/response (Vehicle đã ~1000 xe — thiếu dòng thì dedup hỏng → chèn trùng)
  const vts = await fetchAll('VehicleType', 'id, code, name')
  const resolveVt = codeNameResolver(vts ?? [])
  const cos = await fetchAll('TransportCompany', 'id, code, name, type, alias_codes')
  const resolveNcc = codeNameResolver((cos ?? []).filter(c => c.type === 'ĐVVT'))
  const ex = await fetchAll('Vehicle', 'license_plate, ncc_id')
  const seen = new Set((ex ?? []).map(v => `${(v.license_plate || '').trim().toLowerCase()}|${v.ncc_id}`))
  const now = new Date().toISOString()
  let ok = 0, skip = 0, err = 0
  for (const r of rows) {
    const plate = S(r.license_plate), vt = S(r.vehicle_type), ncc = S(r.ncc)
    if (!plate || !vt || !ncc) { console.log('  SKIP (thiếu biển/loại/ĐVVT)'); skip++; continue }
    const vtRes = resolveVt(vt)
    if (!vtRes.id) { console.error('  ERR', plate, '— Loại xe ' + (vtRes.error ?? 'không khớp') + ':', vt); err++; continue }
    const nccRes = resolveNcc(ncc)
    if (!nccRes.id) { console.error('  ERR', plate, '— ĐVVT ' + (nccRes.error ?? 'không khớp') + ':', ncc); err++; continue }
    const vtId = vtRes.id, nccId = nccRes.id
    const key = `${plate.toLowerCase()}|${nccId}`
    if (seen.has(key)) { console.log('  SKIP (đã có biển+ĐVVT):', plate, '/', ncc); skip++; continue }
    const rec = { id: randomUUID(), license_plate: plate, vehicle_type_id: vtId, ncc_id: nccId, is_active: true, created_at: now, updated_at: now }
    const { error } = await supabase.from('Vehicle').insert(rec)
    if (error) { console.error('  ERR', plate, '—', error.message); err++ }
    else { console.log('  OK', plate, '—', vt, '/', ncc); seen.add(key); ok++ }
  }
  console.log(`\nXe: ${ok} thêm · ${skip} bỏ qua · ${err} lỗi`)
}
main().catch(e => { console.error(e); process.exit(1) })
