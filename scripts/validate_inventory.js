/**
 * RÀ (dry-run, KHÔNG ghi DB) file Tồn kho đầu kỳ trước khi import.
 * Run: cd backend && node ../scripts/validate_inventory.js ../templates/6_TonKho.xlsx
 * Mirror logic import_inventory.js NHƯNG phân trang đầy đủ (Material 1788 > cap 1000) + gom báo cáo.
 */
const { supabase, S, readRows, codeNameResolver } = require('./_upload_util')

const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isNaN(n) ? null : n }
function toISODate(v) {
  if (v == null || v === '') return null
  const s = String(v).trim()
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400000))
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  return null
}

// Nạp TẤT CẢ dòng 1 bảng — phân trang (PostgREST cap 1000/response).
async function selectAll(table, cols) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

const KEYS = ['pallet_code', 'material_code', 'warehouse', 'location_code', 'cartons', 'production_date', 'ncc', 'qa_status', 'shelf_life_days']

async function main() {
  const rows = readRows(process.argv[2] || '../templates/6_TonKho.xlsx', KEYS)

  const mats = await selectAll('Material', 'id, material_code')
  const matMap = new Map(mats.map(m => [String(m.material_code).trim().toLowerCase(), m.id]))
  const whs = await selectAll('Warehouse', 'id, code, name, nmsx_code')
  const whByCode = new Map(whs.map(w => [String(w.code).trim().toLowerCase(), w]))
  const whByName = new Map(whs.map(w => [String(w.name).trim().toLowerCase(), w]))
  const locs = await selectAll('Location', 'id, location_code')
  const locMap = new Map(locs.map(l => [String(l.location_code).trim().toLowerCase(), l.id]))
  const cos = await selectAll('TransportCompany', 'id, code, name, type, alias_codes')
  const resolveNcc = codeNameResolver(cos.filter(c => c.type === 'NCC'))
  const qas = await selectAll('QAStatus', 'id, name')
  const qaMap = new Map(qas.map(q => [String(q.name).trim().toLowerCase(), q.id]))
  const ex = await selectAll('InventoryEntry', 'pallet_code')
  const seenDb = new Set(ex.map(e => (e.pallet_code || '').trim().toLowerCase()))

  console.log(`DB: Material ${mats.length} · Location ${locs.length} · NCC ${cos.filter(c=>c.type==='NCC').length} · QA ${qas.length} · Tồn hiện có ${ex.length}`)

  const errors = []
  const seenInFile = new Set()
  let lineNo = 0
  // thống kê số thùng
  let nFrac = 0, nZeroNeg = 0, nInt = 0
  let cMin = Infinity, cMax = -Infinity
  const badMatSamples = new Set(), badLocSamples = new Set()
  let okCount = 0

  for (const r of rows) {
    lineNo++
    const pallet = S(r.pallet_code), mcode = S(r.material_code), whRaw = S(r.warehouse)
    const cartons = num(r.cartons)
    const locRaw = S(r.location_code)
    const prodRaw = S(r.production_date)
    const prodIso = toISODate(r.production_date)
    const at = pallet || `(dòng #${lineNo})`

    const missing = []
    if (!pallet) missing.push('mã pallet')
    if (!mcode) missing.push('mã hàng')
    if (!whRaw) missing.push('kho')
    if (cartons == null) missing.push('số thùng')
    if (!locRaw) missing.push('vị trí')
    if (!prodIso) missing.push(prodRaw ? `ngày SX sai "${prodRaw}"` : 'ngày SX')
    if (missing.length) { errors.push(`${at} — thiếu/sai: ${missing.join(', ')}`); continue }

    // thống kê cartons
    if (cartons <= 0) nZeroNeg++
    else if (!Number.isInteger(cartons)) nFrac++
    else nInt++
    if (cartons < cMin) cMin = cartons
    if (cartons > cMax) cMax = cartons

    const palletLc = pallet.toLowerCase()
    if (seenInFile.has(palletLc)) { errors.push(`${at} — trùng mã pallet trong file`); continue }
    if (seenDb.has(palletLc)) { errors.push(`${at} — mã pallet đã có trong kho`); continue }
    if (!matMap.get(mcode.toLowerCase())) { errors.push(`${at} — mã hàng không khớp: ${mcode}`); badMatSamples.add(mcode); continue }
    const wh = whByCode.get(whRaw.toLowerCase()) || whByName.get(whRaw.toLowerCase())
    if (!wh) { errors.push(`${at} — kho không khớp: ${whRaw}`); continue }
    if (!locMap.get(locRaw.toLowerCase())) { errors.push(`${at} — vị trí không khớp: ${locRaw}`); badLocSamples.add(locRaw); continue }
    const nccRaw = S(r.ncc)
    if (nccRaw) { const res = resolveNcc(nccRaw); if (!res.id) { errors.push(`${at} — NCC ${res.error ?? 'không khớp'}: ${nccRaw}`); continue } }
    const qaRaw = S(r.qa_status)
    if (qaRaw && !qaMap.get(qaRaw.toLowerCase())) { errors.push(`${at} — QA không khớp: "${qaRaw}" (hợp lệ: ${qas.map(q => q.name).join(' / ')})`); continue }
    seenInFile.add(palletLc)
    okCount++
  }

  console.log(`\n=== RÀ FILE TỒN KHO ===`)
  console.log(`Tổng dòng dữ liệu: ${rows.length}`)
  console.log(`  • Hợp lệ (sẽ nhập): ${okCount}`)
  console.log(`  • LỖI:              ${errors.length}`)
  console.log(`\nSố thùng — nguyên: ${nInt} · thập phân: ${nFrac} · ≤0: ${nZeroNeg} · min ${cMin} · max ${cMax}`)

  // gom lỗi theo nhóm
  const byType = new Map()
  for (const e of errors) {
    const key = e.replace(/^\S+ — /, '').replace(/: .*$/, '').replace(/"[^"]*"/g, '"…"').replace(/#\d+/g, '#N')
    byType.set(key, (byType.get(key) ?? 0) + 1)
  }
  if (errors.length) {
    console.log(`\nLỖI theo nhóm:`)
    ;[...byType.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ✗ ${String(n).padStart(4)} × ${k}`))
    if (badMatSamples.size) console.log(`\n  Mẫu mã hàng không khớp (tối đa 10): ${[...badMatSamples].slice(0, 10).join(', ')}`)
    if (badLocSamples.size) console.log(`  Mẫu vị trí không khớp (tối đa 10): ${[...badLocSamples].slice(0, 10).join(', ')}`)
  }
  console.log(errors.length ? '\n→ CÒN LỖI: sửa rồi rà lại trước khi import.' : '\n→ SẠCH LỖI: import được.')
}
main().catch(e => { console.error(e); process.exit(1) })
