/**
 * Import TỒN KHO ĐẦU KỲ từ templates/6_TonKho.xlsx
 * Run: cd backend && node ../scripts/import_inventory.js ../templates/6_TonKho.xlsx
 * Chạy SAU CÙNG (cần Kho + Vị trí + NCC; mã hàng đã có sẵn).
 * Mỗi dòng = 1 pallet tồn. Bỏ qua pallet_code đã tồn tại. status=IN_STOCK, origin=IMPORT.
 */
const { supabase, S, I, readRows, codeNameResolver } = require('./_upload_util')
const { randomUUID } = require('crypto')

const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isNaN(n) ? null : n }

const KEYS = ['pallet_code', 'material_code', 'warehouse', 'location_code', 'cartons', 'production_date', 'ncc', 'qa_status', 'shelf_life_days']

async function main() {
  const rows = readRows(process.argv[2] || '../templates/6_TonKho.xlsx', KEYS)

  const { data: mats } = await supabase.from('Material').select('id, material_code')
  const matMap = new Map((mats ?? []).map(m => [String(m.material_code).trim().toLowerCase(), m.id]))
  const { data: whs } = await supabase.from('Warehouse').select('id, code, name, nmsx_code')
  const whByCode = new Map((whs ?? []).map(w => [String(w.code).trim().toLowerCase(), w]))
  const whByName = new Map((whs ?? []).map(w => [String(w.name).trim().toLowerCase(), w]))
  const { data: locs } = await supabase.from('Location').select('id, location_code')
  const locMap = new Map((locs ?? []).map(l => [String(l.location_code).trim().toLowerCase(), l.id]))
  const { data: cos } = await supabase.from('TransportCompany').select('id, code, name, type, alias_codes')
  const resolveNcc = codeNameResolver((cos ?? []).filter(c => c.type === 'NCC'))
  const { data: qas } = await supabase.from('QAStatus').select('id, name')
  const qaMap = new Map((qas ?? []).map(q => [String(q.name).trim().toLowerCase(), q.id]))
  const { data: ex } = await supabase.from('InventoryEntry').select('pallet_code')
  const seen = new Set((ex ?? []).map(e => (e.pallet_code || '').trim().toLowerCase()))

  const now = new Date().toISOString()
  let ok = 0, skip = 0, err = 0
  for (const r of rows) {
    const pallet = S(r.pallet_code), mcode = S(r.material_code), whRaw = S(r.warehouse)
    const cartons = num(r.cartons)
    if (!pallet || !mcode || !whRaw || cartons == null) { console.log('  SKIP (thiếu pallet/mã hàng/kho/số thùng)'); skip++; continue }
    if (seen.has(pallet.toLowerCase())) { console.log('  SKIP (đã có):', pallet); skip++; continue }
    const matId = matMap.get(mcode.toLowerCase())
    if (!matId) { console.error('  ERR', pallet, '— Mã hàng không khớp:', mcode); err++; continue }
    const wh = whByCode.get(whRaw.toLowerCase()) || whByName.get(whRaw.toLowerCase())
    if (!wh) { console.error('  ERR', pallet, '— Kho không khớp:', whRaw); err++; continue }
    const whId = wh.id
    const nmsx = (wh.nmsx_code && String(wh.nmsx_code).trim()) || null   // NMSX tự suy từ kho (Ba Vì → B), kho không có → trống
    const locRaw = S(r.location_code)
    let locId = null
    if (locRaw) { locId = locMap.get(locRaw.toLowerCase()); if (!locId) { console.error('  ERR', pallet, '— Vị trí không khớp:', locRaw); err++; continue } }
    const nccRaw = S(r.ncc)
    let nccId = null
    if (nccRaw) { const res = resolveNcc(nccRaw); if (!res.id) { console.error('  ERR', pallet, '— NCC ' + (res.error ?? 'không khớp') + ':', nccRaw); err++; continue } nccId = res.id }
    const qaRaw = S(r.qa_status) || 'OK'
    const qaId = qaMap.get(qaRaw.toLowerCase()) ?? null
    const prod = S(r.production_date)

    const rec = {
      id: randomUUID(), pallet_code: pallet, material_id: matId, warehouse_id: whId, location_id: locId,
      cartons_imported: cartons, cartons_remaining: cartons, cartons_reserved: 0, adjustment_qty: 0,
      stack_layer: 1, status: 'IN_STOCK', origin: 'IMPORT',
      production_date: prod ? `${prod}T00:00:00` : null,
      shelf_life_days: I(r.shelf_life_days), ncc_id: nccId, qa_status_id: qaId, nmsx,
      import_date: now, created_at: now, updated_at: now,
    }
    const { error } = await supabase.from('InventoryEntry').insert(rec)
    if (error) { console.error('  ERR', pallet, '—', error.message); err++ }
    else { console.log('  OK', pallet, '—', mcode, `${cartons} thùng`); seen.add(pallet.toLowerCase()); ok++ }
  }
  console.log(`\nTồn kho: ${ok} thêm · ${skip} bỏ qua · ${err} lỗi`)
}
main().catch(e => { console.error(e); process.exit(1) })
