/**
 * Import TỒN KHO ĐẦU KỲ từ templates/6_TonKho.xlsx
 * Run: cd backend && node ../scripts/import_inventory.js ../templates/6_TonKho.xlsx
 * Chạy SAU CÙNG (cần Kho + Vị trí + NCC; mã hàng đã có sẵn). status=IN_STOCK, origin=IMPORT.
 * ALL-OR-NOTHING: kiểm TOÀN BỘ file trước; CÓ BẤT KỲ LỖI NÀO → in hết lỗi & KHÔNG nhập gì (sửa rồi up lại).
 *   File sạch 100% mới nhập, và nhập NGUYÊN KHỐI 1 lệnh (lỗi DB → rollback hết).
 * BẮT BUỘC mỗi dòng: pallet, mã hàng, kho, số thùng, VỊ TRÍ, NGÀY SX. Trùng pallet (trong file/đã có) = lỗi.
 * NMSX tự suy từ nmsx_code của kho. shelf_life_days/HSD tùy chọn (không khai → không tính %date).
 */
const { supabase, S, I, readRows, codeNameResolver } = require('./_upload_util')
const { randomUUID } = require('crypto')

const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isNaN(n) ? null : n }

// Ngày SX → yyyy-mm-dd. Chịu được: chuỗi yyyy-mm-dd / dd-mm-yyyy (dùng - hoặc /) · Date · số serial Excel.
function toISODate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s)        // yyyy-mm-dd
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s)            // dd-mm-yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d+(\.\d+)?$/.test(s)) {                               // số serial Excel
    const d = new Date(Math.round((Number(s) - 25569) * 86400000))
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  return null
}

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

  // ── PHA 1: kiểm tra TOÀN BỘ file. Có BẤT KỲ lỗi nào → KHÔNG nhập gì, in hết lỗi để sửa rồi up lại. ──
  const errors = []        // mọi lỗi dữ liệu, gom hết
  const records = []       // bản ghi hợp lệ chờ nhập (chỉ dùng khi 0 lỗi)
  const seenInFile = new Set()
  let lineNo = 0
  for (const r of rows) {
    lineNo++
    const pallet = S(r.pallet_code), mcode = S(r.material_code), whRaw = S(r.warehouse)
    const cartons = num(r.cartons)
    const locRaw = S(r.location_code)
    const prodRaw = S(r.production_date)
    const prodIso = toISODate(r.production_date)
    const at = pallet || `(dòng dữ liệu #${lineNo})`

    const missing = []
    if (!pallet)         missing.push('mã pallet')
    if (!mcode)          missing.push('mã hàng')
    if (!whRaw)          missing.push('kho')
    if (cartons == null) missing.push('số thùng')
    if (!locRaw)         missing.push('vị trí')
    if (!prodIso)        missing.push(prodRaw ? `ngày SX sai định dạng "${prodRaw}"` : 'ngày SX')
    if (missing.length) { errors.push(`${at} — thiếu/sai: ${missing.join(', ')}`); continue }

    const palletLc = pallet.toLowerCase()
    if (seenInFile.has(palletLc)) { errors.push(`${at} — trùng mã pallet trong file`); continue }
    if (seen.has(palletLc))       { errors.push(`${at} — mã pallet đã tồn tại trong kho`); continue }
    const matId = matMap.get(mcode.toLowerCase())
    if (!matId) { errors.push(`${at} — mã hàng không khớp: ${mcode}`); continue }
    const wh = whByCode.get(whRaw.toLowerCase()) || whByName.get(whRaw.toLowerCase())
    if (!wh) { errors.push(`${at} — kho không khớp: ${whRaw}`); continue }
    const locId = locMap.get(locRaw.toLowerCase())
    if (!locId) { errors.push(`${at} — vị trí không khớp: ${locRaw}`); continue }
    const nccRaw = S(r.ncc)
    let nccId = null
    if (nccRaw) { const res = resolveNcc(nccRaw); if (!res.id) { errors.push(`${at} — NCC ${res.error ?? 'không khớp'}: ${nccRaw}`); continue } nccId = res.id }
    const qaRaw = S(r.qa_status) || 'OK'
    const qaId = qaMap.get(qaRaw.toLowerCase()) ?? null
    const nmsx = (wh.nmsx_code && String(wh.nmsx_code).trim()) || null   // NMSX tự suy từ kho (Ba Vì → B), kho không có → trống

    seenInFile.add(palletLc)
    records.push({
      id: randomUUID(), pallet_code: pallet, material_id: matId, warehouse_id: wh.id, location_id: locId,
      cartons_imported: cartons, cartons_remaining: cartons, cartons_reserved: 0, adjustment_qty: 0,
      stack_layer: 1, status: 'IN_STOCK', origin: 'IMPORT',
      production_date: `${prodIso}T00:00:00`,
      shelf_life_days: I(r.shelf_life_days), ncc_id: nccId, qa_status_id: qaId, nmsx,
      import_date: now, created_at: now, updated_at: now,
    })
  }

  if (errors.length) {
    console.error(`\n❌ ${errors.length} dòng lỗi — CHƯA NHẬP GÌ CẢ. Sửa các dòng dưới đây rồi chạy lại:`)
    errors.forEach(e => console.error('  •', e))
    process.exit(1)
  }
  if (!records.length) { console.log('Không có dòng dữ liệu nào để nhập.'); return }

  // ── PHA 2: file sạch 100% → nhập NGUYÊN KHỐI (1 lệnh, atomic — lỗi DB thì rollback hết, không nhập nửa vời). ──
  const { error } = await supabase.from('InventoryEntry').insert(records)
  if (error) {
    console.error(`\n❌ Lỗi khi nhập (đã rollback, KHÔNG nhập gì): ${error.message}`)
    process.exit(1)
  }
  console.log(`\n✅ Đã nhập ${records.length} pallet tồn đầu kỳ (100%, không lỗi).`)
}
main().catch(e => { console.error(e); process.exit(1) })
