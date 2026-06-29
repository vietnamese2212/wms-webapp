/**
 * Import Vị trí kho từ templates/5_ViTriKho.xlsx  (chạy SAU khi đã có Kho)
 * Run: cd backend && node ../scripts/import_locations.js ../templates/5_ViTriKho.xlsx
 * location_code tự ghép = TIỀN TỐ_Khu_Dãy_Tầng. Tiền tố = nmsx_code nếu có, không thì Mã kho
 *   (vd Ba Vì nmsx=B → B_TP1_1_T1; NPP không có nmsx → 10000329_TP1_1_T1). Bỏ qua location_code đã tồn tại.
 * ĐỒNG BỘ Khu vực: mỗi (kho, sub_code) tự tạo 1 WarehouseZone cùng MÃ (code=sub_code) → dashboard
 * theo khu khớp 100% với Location.sub_code. Zone đã có (theo kho+code) thì bỏ qua.
 */
const { supabase, S, I, readRows } = require('./_upload_util')
const { randomUUID } = require('crypto')

const KEYS = ['warehouse', 'sub_code', 'row', 'shelf', 'max_pallets', 'category', 'sub_name', 'sub_type']

async function main() {
  const rows = readRows(process.argv[2] || '../templates/5_ViTriKho.xlsx', KEYS)
  const { data: whs } = await supabase.from('Warehouse').select('id, code, name, nmsx_code')
  const whByCode = new Map((whs ?? []).map(w => [String(w.code).trim().toLowerCase(), w]))
  const whByName = new Map((whs ?? []).map(w => [String(w.name).trim().toLowerCase(), w]))
  const { data: ex } = await supabase.from('Location').select('location_code')
  const seen = new Set((ex ?? []).map(l => (l.location_code || '').trim().toLowerCase()))
  const now = new Date().toISOString()

  // ── Đồng bộ Khu vực (WarehouseZone) từ sub_code: mỗi (kho, sub_code) → 1 zone cùng mã ──
  const { data: exZones } = await supabase.from('WarehouseZone').select('warehouse_id, code, sort_order')
  const zoneSeen = new Set((exZones ?? []).map(z => `${z.warehouse_id}|${(z.code || '').trim().toLowerCase()}`))
  const nextSort = {}   // warehouse_id -> sort_order lớn nhất hiện có
  ;(exZones ?? []).forEach(z => { const m = Number(z.sort_order ?? 0); if (m > (nextSort[z.warehouse_id] || 0)) nextSort[z.warehouse_id] = m })
  const zonesToAdd = new Map()   // key = wh.id|sub(lower) → {warehouse_id, code, name, category}
  for (const r of rows) {
    const whRaw = S(r.warehouse), sub = S(r.sub_code)
    if (!whRaw || !sub) continue
    const wh = whByCode.get(whRaw.toLowerCase()) || whByName.get(whRaw.toLowerCase())
    if (!wh) continue
    const key = `${wh.id}|${sub.toLowerCase()}`
    if (zoneSeen.has(key) || zonesToAdd.has(key)) continue
    zonesToAdd.set(key, { warehouse_id: wh.id, code: sub, name: S(r.sub_name) || sub, category: S(r.category) })
  }
  let zoneOk = 0
  if (zonesToAdd.size) {
    const zrows = [...zonesToAdd.values()].map(z => {
      nextSort[z.warehouse_id] = (nextSort[z.warehouse_id] || 0) + 1
      return { id: randomUUID(), warehouse_id: z.warehouse_id, code: z.code, name: z.name, category: z.category, sort_order: nextSort[z.warehouse_id], is_active: true, created_at: now, updated_at: now }
    })
    const { error: zErr } = await supabase.from('WarehouseZone').insert(zrows)
    if (zErr) console.error('  KHU VỰC ERR:', zErr.message)
    else zoneOk = zrows.length
  }
  console.log(`Khu vực (đồng bộ từ sub_code): ${zoneOk} thêm · ${zoneSeen.size} đã có\n`)

  let ok = 0, skip = 0, err = 0
  for (const r of rows) {
    const whRaw = S(r.warehouse), sub = S(r.sub_code), row = S(r.row), shelf = S(r.shelf)
    if (!whRaw || !sub || !row || !shelf) { console.log('  SKIP (thiếu kho/khu/dãy/tầng)'); skip++; continue }
    const wh = whByCode.get(whRaw.toLowerCase()) || whByName.get(whRaw.toLowerCase())
    if (!wh) { console.error('  ERR — Kho không khớp:', whRaw); err++; continue }
    const prefix = (wh.nmsx_code && String(wh.nmsx_code).trim()) || wh.code
    const code = `${prefix}_${sub}_${row}_${shelf}`
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
