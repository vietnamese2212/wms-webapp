/**
 * Import Vị trí kho từ templates/5_ViTriKho.xlsx  (chạy SAU khi đã tạo Kho + KHU VỰC)
 * Run: cd backend && node ../scripts/import_locations.js ../templates/5_ViTriKho.xlsx
 * location_code = TIỀN TỐ_Khu_Dãy_Tầng. Tiền tố = nmsx_code nếu có, không thì Mã kho
 *   (vd Ba Vì nmsx=B → B_TP1_1_T1). Tầng tùy chọn (vị trí khối/sàn không có tầng).
 * KHU VỰC (WarehouseZone) là CHUẨN: chỉ up vị trí khi sub_code đã có trong Khu vực của kho đó;
 *   sub_name + category LẤY TỪ ZONE (theo sub_code), KHÔNG lấy từ file.
 *   sub_code chưa có zone → BỎ QUA + báo rõ (không tự tạo zone).
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

  // KHU VỰC là CHUẨN: map (warehouse_id|sub_code-lower) → zone {name, category}
  const { data: zones } = await supabase.from('WarehouseZone').select('warehouse_id, code, name, category')
  const zoneMap = new Map((zones ?? []).map(z => [`${z.warehouse_id}|${String(z.code).trim().toLowerCase()}`, z]))

  const now = new Date().toISOString()
  let ok = 0, skip = 0, err = 0
  const missingZones = new Set()
  for (const r of rows) {
    const whRaw = S(r.warehouse), sub = S(r.sub_code), row = S(r.row), shelf = S(r.shelf)
    // Tầng (shelf) TÙY CHỌN: vị trí khối/sàn không có tầng.
    if (!whRaw || !sub || !row) { console.log('  SKIP (thiếu kho/khu/dãy)'); skip++; continue }
    const wh = whByCode.get(whRaw.toLowerCase()) || whByName.get(whRaw.toLowerCase())
    if (!wh) { console.error('  ERR — Kho không khớp:', whRaw); err++; continue }

    // Chỉ up khi sub_code đã có trong Khu vực kho của kho đó.
    const zone = zoneMap.get(`${wh.id}|${sub.toLowerCase()}`)
    if (!zone) { missingZones.add(sub); skip++; continue }

    const prefix = (wh.nmsx_code && String(wh.nmsx_code).trim()) || wh.code
    const code = [prefix, sub, row, shelf].filter(Boolean).join('_')
    if (seen.has(code.toLowerCase())) { console.log('  SKIP (đã có):', code); skip++; continue }
    const rec = {
      id: randomUUID(), location_code: code, warehouse_id: wh.id,
      sub_code: sub, row, shelf: shelf ?? '',   // cột shelf NOT NULL → vị trí khối dùng '' (rỗng)
      max_pallets: I(r.max_pallets) ?? 1,
      category: zone.category ?? null,   // ← lấy từ ZONE
      sub_name: zone.name ?? null,       // ← lấy từ ZONE (theo sub_code)
      sub_type: S(r.sub_type),
      is_active: true, created_at: now, updated_at: now,
    }
    const { error } = await supabase.from('Location').insert(rec)
    if (error) { console.error('  ERR', code, '—', error.message); err++ }
    else { console.log('  OK', code); seen.add(code.toLowerCase()); ok++ }
  }
  if (missingZones.size) console.log(`\n⚠️ Khu chưa có trong Khu vực kho → vị trí bị BỎ QUA: ${[...missingZones].join(', ')}`)
  console.log(`\nVị trí: ${ok} thêm · ${skip} bỏ qua · ${err} lỗi`)
}
main().catch(e => { console.error(e); process.exit(1) })
