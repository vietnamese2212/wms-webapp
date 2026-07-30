// GÓI 07 — FUZZ THAM SỐ danh sách trên API list (read-only, chạy lúc nào cũng được).
// Sinh từ bug thật 29/07: `?codes=` RỖNG là falsy nên hàng rào không chạy → bỏ lọc → trả CẢ
// danh mục 2.740 mã (~2,5MB). Cùng họ: tham số danh sách rỗng/rác/quá dài trên MỌI API list.
// Kiểm 3 bất biến cho từng (endpoint × biến thể):
//   1. KHÔNG 500 (400/403/422 là hợp lệ — lỗi có chủ đích).
//   2. Tham số tra-cứu RỖNG (`?ids=`/`?codes=`) → 0 dòng, KHÔNG dump cả danh mục.
//   3. Payload < 4MB (trần Vercel 4,5MB — chừa lề an toàn).
// usage: node scripts/qa/07-params-fuzz.mjs
import { BASE, login, api, HAS_DB, restAll } from './lib.mjs'

const MAX_BYTES = 4 * 1024 * 1024
let pass = 0, fail = 0
const bad = []
const chk = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; bad.push(label); console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`) }
}
const rowsOf = (j) => {
  const d = j?.data ?? j
  if (Array.isArray(d)) return d
  for (const k of ['entries', 'items', 'rows', 'orders', 'groups', 'list']) if (Array.isArray(d?.[k])) return d[k]
  return null
}

await login()
console.log(`── GÓI PARAMS-FUZZ · ${BASE.slice(8, 50)}… ──`)

// ── 1) Tham số TRA CỨU rỗng → phải 0 dòng (đây là chỗ bug 29/07 sống) ──
// [path, mô tả] — thêm endpoint mới có ?ids=/?codes= vào đây.
const LOOKUP_EMPTY = [
  ['/masterdata/materials?codes=&view=lite', 'materials ?codes= rỗng'],
  ['/masterdata/materials?ids=&view=lite', 'materials ?ids= rỗng'],
  ['/masterdata/materials?codes=,,%20,&view=lite', 'materials ?codes= toàn rác trim'],
]
for (const [path, label] of LOOKUP_EMPTY) {
  const r = await api(path)
  const rows = rowsOf(r.j)
  chk(r.s === 200 && rows !== null && rows.length === 0, label,
    `HTTP ${r.s} · ${rows === null ? 'không bóc được list' : rows.length + ' dòng'} (kỳ vọng 0)`)
}

// ── 2) Tham số LỌC rỗng/rác trên các API list chính → không 500, không quá 4MB ──
// Lưu ý ngữ nghĩa: filter rỗng = "không lọc" là HỢP LỆ (khác tra cứu) — chỉ cấm 500/quá trần.
const d0 = '2026-07-01', d1 = '2026-07-29'
const LIST_FUZZ = [
  `/wms/inventory?page=1&limit=50&warehouse_ids=&categories=`,
  `/wms/inventory?page=1&limit=50&warehouse_ids=khong-phai-uuid`,
  `/wms/inventory?page=1&limit=50&search=${encodeURIComponent("';--")}`,
  `/wms/inventory?page=0&limit=-5`,
  `/wms/inventory?page=999999&limit=50`,
  `/masterdata/materials?page=1&page_size=50&search=%00`,
  `/masterdata/locations?page=1&page_size=50&warehouse_id=`,
  `/wms/pallet-prints?page=1&page_size=50&date_from=${d0}&date_to=${d1}&qr_codes=`,
  `/wms/outbound?date_from=${d0}&date_to=${d1}&warehouse_ids=`,
  `/tms/orders?date_from=${d0}&date_to=${d1}&warehouse_id=&page=1&page_size=50`,
  `/hr/leaves?date_from=${d0}&date_to=${d1}&page=1&page_size=50`,
  `/wms/weigh-tickets?page=1&page_size=50&warehouse_ids=`,
  `/wms/outbound/scan-log?date_from=${d0}&date_to=${d1}&material=&machines=`,
  `/wms/dashboard`,
]
for (const path of LIST_FUZZ) {
  const r = await api(path)
  // 404 = đường dẫn test SAI (route đổi tên) — phải đỏ để sửa test, đừng pass oan.
  const okStatus = r.s < 500 && r.s !== 404
  const okSize = r.bytes < MAX_BYTES
  chk(okStatus && okSize, `fuzz ${path.slice(0, 72)}`,
    `HTTP ${r.s} · ${(r.bytes / 1024).toFixed(0)}KB${okStatus ? '' : r.s === 404 ? ' → route đổi, sửa test!' : ' → 500!'}${okSize ? '' : ' → QUÁ 4MB!'}`)
}

// ── 3) Danh sách id DÀI (300+) — không đứt kết nối, không 500 (chunk .in() phía BE) ──
const longIds = Array.from({ length: 350 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',')
{
  const r = await api(`/masterdata/materials?ids=${longIds}&view=lite`)
  chk(r.s === 200, 'materials ?ids= 350 uuid (vượt chunk 300)', `HTTP ${r.s} · ${rowsOf(r.j)?.length ?? '?'} dòng`)
}

// ── 4) Ô TỔNG ⇄ DANH SÁCH phải khớp KHI LỌC (bug thật 29/07: `inb_pallets` của RPC
// control_tower_stats thiếu lọc Loại kho → lọc PK01: ô "Pallet nhập" vẫn 2.374 còn danh sách
// chỉ 252 → người xem tưởng mất dữ liệu / đọc sai tiến độ. Cùng họ: MỌI ô tổng phải chịu
// ĐÚNG bộ lọc như danh sách nó đứng cạnh) ──
{
  const all = await api('/wms/control-tower')
  const inList = all.j?.data?.in_by_material
  const cat = (inList?.list ?? []).map(r => r.category).find(c => c && c !== 'Khác')
  if (all.s !== 200) {
    chk(false, 'control-tower đọc được', `HTTP ${all.s}`)
  } else if (!cat) {
    console.log('  ⊘ ô tổng ⇄ danh sách (nhập): hôm nay chưa có hàng nhập — bỏ qua')
  } else {
    const r = await api(`/wms/control-tower?categories=${encodeURIComponent(cat)}`)
    const d = r.j?.data
    const rows = d?.in_by_material?.list ?? []
    const nMats = d?.in_by_material?.n_materials ?? 0
    const sumPallets = rows.reduce((s, x) => s + Number(x.pallets ?? 0), 0)
    const tile = Number(d?.inbound?.pallets ?? -1)
    if (nMats > rows.length) {
      console.log(`  ⊘ ô tổng ⇄ danh sách (nhập): ${nMats} mã > ${rows.length} dòng hiển thị (top-30) — không so được`)
    } else {
      chk(r.s === 200 && tile === sumPallets, `ô "Pallet nhập" khớp danh sách khi lọc Loại kho=${cat}`,
        `ô ${tile} vs Σ danh sách ${sumPallets} (${nMats} mã)`)
    }
  }
}

// ── 4b) DASHBOARD by_unit (migration 20260730): card "Tồn theo đơn vị" ⇄ bảng tồn theo kho
// phải cùng một sự thật — by_unit tách theo ĐVT, inventory tách theo kho×loại, nhưng Σ cả hai
// chiều (qty quy đổi + pallet) phải BẰNG NHAU. Lệch = 2 CTE trong RPC lọc khác nhau (bug âm thầm).
{
  const r = await api('/wms/dashboard')
  const d = r.j?.data
  if (r.s !== 200 || !d) chk(false, 'dashboard đọc được', `HTTP ${r.s}`)
  else if (!Array.isArray(d.by_unit) || d.by_unit.length === 0) {
    console.log('  ⊘ dashboard by_unit: RPC chưa có khóa by_unit (fallback JS?) — bỏ qua')
  } else {
    const sI = (k) => (d.inventory ?? []).reduce((s, x) => s + Number(x[k] ?? 0), 0)
    const sB = (k) => d.by_unit.reduce((s, x) => s + Number(x[k] ?? 0), 0)
    const qOk = Math.abs(sI('cartons') - sB('qty')) < 0.01
    const pOk = sI('pallets') === sB('pallets')
    chk(qOk && pOk, 'dashboard: Σ "Tồn theo đơn vị" khớp Σ bảng tồn (qty + pallet)',
      `qty ${sB('qty').toFixed(0)} vs ${sI('cartons').toFixed(0)} · pallet ${sB('pallets')} vs ${sI('pallets')} · ${d.by_unit.length} đơn vị`)
  }
}

// ── 5) LƯỚI KẾ HOẠCH VC: thứ tự hiển thị + phân trang theo CỤM (migration 20260729d).
// Trang này phân trang SERVER theo cụm (rowspan) nên thứ tự do SQL quyết — sai là sai ÂM THẦM.
// 3 lời hứa với người dùng, kiểm không phụ thuộc collation:
//   a. lật hết trang: KHÔNG trùng, KHÔNG mất đơn (cụm bị xé ngang trang = vỡ rowspan + lặp đơn)
//   b. đơn cùng (ngày·hướng·loại kho·loại xe·ĐVVT) phải LIỀN KHỐI — mất 1 khóa ORDER BY là scatter
//   c. STT xe tăng dần theo chiều đọc (ORDER BY của `stt` phải khớp của `branked`; lệch → màu vằn vón cục)
{
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const from = new Date(Date.now() - 60 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  // API bắt buộc warehouse_id (không truyền = 400) mà danh mục kho có ~150 dòng (gồm kho NPP) →
  // KHÔNG quét mò 12 kho đầu (alphabet, toàn NPP rỗng → check tự skip mà tưởng đã chạy).
  // Chọn kho ĐANG CÓ nhiều lệnh nhất từ DB, rồi mới đi đường API như người dùng.
  let target = null
  if (HAS_DB) {
    const rows = await restAll('TmsOrder',
      `select=warehouse_id&date=gte.${from}&date=lte.${today}&source_type=neq.TRANSFER`, 20_000)
    const cnt = new Map()
    for (const r of rows) if (r.warehouse_id) cnt.set(r.warehouse_id, (cnt.get(r.warehouse_id) ?? 0) + 1)
    const top = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]
    if (top && top[1] > 3) {
      const r = await api(`/tms/orders?date_from=${from}&date_to=${today}&warehouse_id=${top[0]}&page=1&page_size=1`)
      if (r.s === 200 && Number(r.j?.data?.total ?? 0) > 3) target = { w: { id: top[0] }, total: Number(r.j.data.total) }
    }
  }
  if (!target) {
    console.log(`  ⊘ lưới Kế hoạch VC: ${HAS_DB ? 'không kho nào có >3 lệnh trong 60 ngày' : 'thiếu SUPABASE_URL/KEY để chọn kho có dữ liệu'} — bỏ qua`)
  } else {
    const seen = new Map(), order = []
    let pages = 0, dup = 0, httpBad = 0
    for (let page = 1; page <= 40; page++) {
      const r = await api(`/tms/orders?date_from=${from}&date_to=${today}&warehouse_id=${target.w.id}&page=${page}&page_size=10`)
      if (r.s !== 200) { httpBad++; break }
      const rows = r.j?.data?.rows ?? []
      if (!rows.length) break
      pages++
      for (const o of rows) { if (seen.has(o.id)) dup++; seen.set(o.id, o); order.push(o) }
      if (seen.size >= target.total) break
    }
    chk(httpBad === 0 && dup === 0 && seen.size === target.total,
      `lưới KH VC: lật ${pages} trang (10 cụm/trang) không trùng/mất đơn`,
      `${seen.size}/${target.total} đơn · trùng ${dup}${httpBad ? ' · HTTP lỗi' : ''}`)

    // Dòng CON của cụm gom xe (toàn slot phụ) đi theo đơn chủ ⇒ khóa của nó khác đơn chủ là BÌNH THƯỜNG
    const isSecondary = (o) => {
      const s = o.vehicle_slots ?? []
      return s.length > 0 && s.every(x => x.consolidation_group_id && !x.is_consolidation_primary)
    }
    const lead = order.filter(o => !isSecondary(o))
    const keyOf = (o) => [o.date, o.direction === 'OUTBOUND' ? 0 : 1, o.warehouse_type ?? '',
      o.vehicle_type ?? '', o.ncc?.name ?? ''].join('|')
    const firstAt = new Map(), scattered = []
    lead.forEach((o, i) => {
      const k = keyOf(o)
      const prev = firstAt.get(k)
      if (prev === undefined) firstAt.set(k, { start: i, end: i })
      else if (prev.end !== i - 1 && i > prev.end) scattered.push(k)
      if (firstAt.has(k)) firstAt.get(k).end = i
    })
    chk(scattered.length === 0, 'lưới KH VC: đơn cùng ngày·hướng·loại kho·loại xe·ĐVVT nằm LIỀN KHỐI',
      scattered.length ? `bị xé: ${[...new Set(scattered)].slice(0, 2).join(' / ')}` : `${firstAt.size} khối / ${lead.length} đơn`)

    const stts = lead.map(o => (o.vehicle_slots ?? []).map(s => s.stt).find(v => v != null) ?? o.stt_no_slot)
      .filter(v => v != null)
    const mono = stts.every((v, i) => i === 0 || v >= stts[i - 1])
    chk(mono, 'lưới KH VC: STT xe tăng dần theo chiều đọc',
      stts.length ? `${stts[0]} → ${stts[stts.length - 1]} (${stts.length} xe)` : 'không có STT')
  }
}

console.log(`\n[PARAMS-FUZZ] ${pass}/${pass + fail} PASS${fail ? ` · ${fail} FAIL` : ''}`)
if (fail) console.log('  Hỏng: ' + bad.join(' | '))
// KHÔNG process.exit() cưỡng bức sau fetch HTTPS (libuv assert trên Windows) — đặt exitCode, thoát tự nhiên.
process.exitCode = fail ? 1 : 0
