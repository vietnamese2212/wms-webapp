/**
 * Import Vị trí kho từ templates/5_ViTriKho.xlsx  (chạy SAU khi đã có Kho)
 * Run: cd backend && node ../scripts/import_locations.js ../templates/5_ViTriKho.xlsx
 * location_code tự ghép = MãKho_Khu_Dãy_Tầng (vd BV_TP1_1_T1). Bỏ qua location_code đã tồn tại.
 */
const { supabase, S, I, readRows } = require('./_upload_util')
const { randomUUID } = require('crypto')

const KEYS = ['warehouse', 'sub_code', 'row', 'shelf', 'max_pallets', 'category', 'sub_name', 'sub_type']

async function main() {
  const rows = readRows(process.argv[2] || '../templates/5_ViTriKho.xlsx', KEYS)
  const { data: whs } = await supabase.from('Warehouse').select('id, code, name')
  const whByCode = new Map((whs ?? []).map(w => [String(w.code).trim().toLowerCase(), w]))
  const whByName = new Map((whs ?? []).map(w => [String(w.name).trim().toLowerCase(), w]))
  const { data: ex } = await supabase.from('Location').select('location_code')
  const seen = new Set((ex ?? []).map(l => (l.location_code || '').trim().toLowerCase()))
  const now = new Date().toISOString()
  let ok = 0, skip = 0, err = 0
  for (const r of rows) {
    const whRaw = S(r.warehouse), sub = S(r.sub_code), row = S(r.row), shelf = S(r.shelf)
    if (!whRaw || !sub || !row || !shelf) { console.log('  SKIP (thiếu kho/khu/dãy/tầng)'); skip++; continue }
    const wh = whByCode.get(whRaw.toLowerCase()) || whByName.get(whRaw.toLowerCase())
    if (!wh) { console.error('  ERR — Kho không khớp:', whRaw); err++; continue }
    const code = `${wh.code}_${sub}_${row}_${shelf}`
    if (seen.has(code.toLowerCase())) { console.log('  SKIP (đã có):', code); skip++; continue }
    const rec = {
      id: randomUUID(), location_code: code, warehouse_id: wh.id,
      sub_code: sub, row, shelf,
      max_pallets: I(r.max_pallets) ?? 1,
      category: S(r.category), sub_name: S(r.sub_name), sub_type: S(r.sub_type),
      is_active: true, created_at: now, updated_at: now,
    }
    const { error } = await supabase.from('Location').insert(rec)
    if (error) { console.error('  ERR', code, '—', error.message); err++ }
    else { console.log('  OK', code); seen.add(code.toLowerCase()); ok++ }
  }
  console.log(`\nVị trí: ${ok} thêm · ${skip} bỏ qua · ${err} lỗi`)
}
main().catch(e => { console.error(e); process.exit(1) })
