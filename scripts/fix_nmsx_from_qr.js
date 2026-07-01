/**
 * Sửa NMSX tồn đầu kỳ: lấy lại từ ĐOẠN 6 của mã pallet (QR: ddmmyy_Mã_ChuKy_May_Seq_NMSX).
 * Lúc import suy nhầm từ kho (Ba Vì → B hết); NMSX thật = nhà máy sản xuất theo từng pallet (B/O/D/A).
 * Đoạn 6 nếu là đuôi hash 8 ký tự (uniquifier) hoặc mã <6 đoạn → không có NMSX → fallback nmsx_code của kho.
 * Run 1 lần: cd backend && node ../scripts/fix_nmsx_from_qr.js
 */
const { supabase } = require('./_upload_util')

const HASH = /^[0-9a-f]{8}$/i
const NMSX_ALIAS = { A: 'O' }   // "A" là mã cũ của nhà máy O → gộp về O
function nmsxFromCode(code, fallback) {
  const parts = String(code || '').split('_')
  const raw = (parts.length >= 6 && parts[5] && !HASH.test(parts[5])) ? parts[5] : fallback
  return raw ? (NMSX_ALIAS[raw] ?? raw) : raw
}

async function selectAll(table, cols) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999)
    if (error) { console.error(`Lỗi nạp ${table}: ${error.message}`); process.exit(1) }
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

async function main() {
  const whs = await selectAll('Warehouse', 'id, nmsx_code')
  const whNmsx = new Map(whs.map(w => [w.id, (w.nmsx_code && String(w.nmsx_code).trim()) || null]))
  const rows = await selectAll('InventoryEntry', 'id, pallet_code, warehouse_id, location_id, nmsx')

  // location_id → warehouse_id (pallet QR có location, warehouse_id thường null) để lấy fallback đúng kho.
  const locs = await selectAll('Location', 'id, warehouse_id')
  const locWh = new Map(locs.map(l => [l.id, l.warehouse_id]))

  // Gom id theo NMSX đích, chỉ đổi dòng khác giá trị hiện tại.
  const byTarget = new Map()
  for (const r of rows) {
    const whId = r.warehouse_id || locWh.get(r.location_id) || null
    const fallback = whId ? whNmsx.get(whId) ?? null : null
    const target = nmsxFromCode(r.pallet_code, fallback)
    if ((r.nmsx ?? null) === (target ?? null)) continue
    if (!byTarget.has(target)) byTarget.set(target, [])
    byTarget.get(target).push(r.id)
  }

  const now = new Date().toISOString()
  let totalChanged = 0
  for (const [target, ids] of byTarget) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      const { error } = await supabase.from('InventoryEntry').update({ nmsx: target, updated_at: now }).in('id', chunk)
      if (error) { console.error(`Lỗi gán NMSX=${target}: ${error.message}`); process.exit(1) }
      totalChanged += chunk.length
    }
    console.log(`  NMSX="${target ?? '(null)'}" ← ${ids.length} pallet`)
  }
  console.log(`\n✅ Cập nhật NMSX theo đoạn 6 cho ${totalChanged} pallet (còn lại đã đúng, bỏ qua).`)
}
main().catch(e => { console.error(e); process.exit(1) })
