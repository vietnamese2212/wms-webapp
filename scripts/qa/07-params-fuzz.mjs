// GÓI 07 — FUZZ THAM SỐ danh sách trên API list (read-only, chạy lúc nào cũng được).
// Sinh từ bug thật 29/07: `?codes=` RỖNG là falsy nên hàng rào không chạy → bỏ lọc → trả CẢ
// danh mục 2.740 mã (~2,5MB). Cùng họ: tham số danh sách rỗng/rác/quá dài trên MỌI API list.
// Kiểm 3 bất biến cho từng (endpoint × biến thể):
//   1. KHÔNG 500 (400/403/422 là hợp lệ — lỗi có chủ đích).
//   2. Tham số tra-cứu RỖNG (`?ids=`/`?codes=`) → 0 dòng, KHÔNG dump cả danh mục.
//   3. Payload < 4MB (trần Vercel 4,5MB — chừa lề an toàn).
// usage: node scripts/qa/07-params-fuzz.mjs
import { readFileSync, readdirSync } from 'fs'
import { BASE, login, api, HAS_DB, restAll, FIX } from './lib.mjs'

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
  // ── Ô TỔNG / FACET đi CHUNG bộ tham số với list ──────────────────────────
  // Bài học 04/08: thêm 1 tham số lọc vào helper dùng chung (`locRpcParams`) làm
  // `/locations/summary` gọi RPC SAI CHỮ KÝ → PGRST202 → **500**, mà bộ QA lúc đó chỉ soi
  // `/locations` nên vẫn xanh; lỗi chỉ lộ khi tôi tình cờ mở trang. Ô tổng và facet luôn là
  // "endpoint anh em" của list — thêm bộ lọc cho list thì phải fuzz cả hai.
  `/masterdata/locations?page=1&page_size=50&warehouse_id=&pick_face=1`,
  `/masterdata/locations?page=1&page_size=50&warehouse_id=&zones=`,
  `/masterdata/locations?page=1&page_size=50&warehouse_id=&zones=${encodeURIComponent("';--")}`,
  `/masterdata/locations/summary?warehouse_id=`,
  `/masterdata/locations/summary?warehouse_id=&pick_face=1`,
  `/masterdata/locations/summary?warehouse_id=&flag=1`,
  `/masterdata/locations/summary?warehouse_id=&zones=`,
  `/wms/fill/candidates?warehouse_id=&material_id=`,
  `/wms/fill/candidates?warehouse_id=x&material_id=khong-phai-uuid`,
  `/masterdata/materials/summary?search=`,
  `/wms/inventory/summary?warehouse_ids=&categories=`,
  `/wms/inventory/facets?warehouse_ids=`,
  `/wms/outbound/summary?date_from=${d0}&date_to=${d1}&warehouse_ids=`,
  `/wms/outbound/facets?date_from=${d0}&date_to=${d1}`,
  `/wms/inbound-orders/summary?date_from=${d0}&date_to=${d1}`,
  `/wms/loosepicking/facets?date_from=${d0}&date_to=${d1}`,
  `/wms/fill/demand?warehouse_id=`,
  `/wms/fill/orders?warehouse_id=&status=`,
  `/wms/fill/report?warehouse_id=`,
  // Ngày KHỚP ĐỊNH DẠNG nhưng không phải ngày thật — regex ^\d{4}-\d{2}-\d{2}$ cho qua rồi
  // Postgres nổ 22008 thành 500 (check-app bắt 05/08; fix = isDay có Date.parse)
  `/wms/fill/demand?warehouse_id=x&date=2026-13-99`,
  `/wms/fill/orders?warehouse_id=x&date_from=2026-13-99`,
  `/wms/fill/report?warehouse_id=x&date_to=0000-00-00`,
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
    // Cap trang ĐỘNG theo total (staging dữ liệu lớn: Ba Vì 1.832 lệnh/60 ngày cần ~184 trang —
    // cap cứng 40 làm check "mất đơn" đỏ oan dù không trùng/không mất, chỉ chưa đọc hết)
    const maxPages = Math.min(220, Math.ceil(target.total / 10) + 5)
    for (let page = 1; page <= maxPages; page++) {
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

// ── 6) ID RÁC trên MỌI route có :param → 4xx sạch, KHÔNG 5xx (bug thật 21/08) ──
// Gốc: `forklift_daily_logs.id` / `TmsOrder.id` là cột UUID; FE ghép `/${id}` khi state chưa có →
// gửi nguyên chuỗi "undefined" → Postgres 22P02 → controller nuốt thành **500** (đúng 3 dòng
// `invalid input syntax for type uuid: "undefined"` nằm trong error_logs). Id sai là lỗi ĐẦU VÀO.
// Quét TỰ ĐỘNG từ file routes để route :param THÊM SAU cũng bị soi — không chép tay danh sách.
{
  const PREFIX = { wms: '/wms', masterdata: '/masterdata', tms: '/tms', hr: '/hr', external: '/external', notify: '/notify' }
  const RD = new URL('../../backend/src/routes/', import.meta.url)
  const found = []
  for (const f of readdirSync(RD)) {
    const pre = PREFIX[f.replace('.ts', '')]
    if (!pre || !f.endsWith('.ts')) continue
    const src = readFileSync(new URL(f, RD), 'utf8')
    for (const m of src.matchAll(/router\.get\(\s*'([^']*:[A-Za-z_]+[^']*)'/g)) found.push(pre + m[1])
  }
  const routes = [...new Set(found)]
  const offenders = []
  for (const r of routes) {
    for (const b of ['undefined', 'null', 'NaN', 'abc-not-uuid']) {
      const res = await api(r.replace(/:[A-Za-z_]+/g, b))
      if (res.s >= 500) { offenders.push(`${r} (${b})`); break }
    }
  }
  chk(offenders.length === 0, `id rác trên ${routes.length} route :param → không 5xx`,
    offenders.length ? offenders.slice(0, 4).join(' | ') : 'tất cả 4xx sạch')
}

// ── 7) Giá trị tham số kiểu SQL-injection → 400, KHÔNG 5xx (bug thật 21/08) ──
// Gốc: WAF đứng trước Supabase chặn Ở TẦNG HẠ TẦNG và trả HTML → supabase-js lỗi lạ → 500 "Lỗi hệ
// thống" ở 7 endpoint. Không phải lỗ bảo mật, nhưng đổ rác vào error_logs làm rule cảnh báo
// "lỗi BE 24h" kêu OAN — tức tự làm hỏng tai mắt. Lưới chặn = middleware /api trong app.ts.
{
  const HOST = [
    '/wms/outbound', '/wms/inbound-orders', '/wms/inventory', '/wms/alerts', '/wms/packing-runs',
    '/masterdata/locations', '/masterdata/materials', '/hr/attendance',
    '/tms/orders?date_from=2026-08-18&date_to=2026-08-18',
  ]
  const PAYLOAD = ["' or 1=1--", '1 UNION ALL SELECT 1', "x'; DROP TABLE a", 'a/*c*/b']
  const bad5xx = [], notBlocked = []
  for (const h of HOST) {
    for (const p of PAYLOAD) {
      const r = await api(`${h}${h.includes('?') ? '&' : '?'}warehouse_id=${encodeURIComponent(p)}`)
      if (r.s >= 500) bad5xx.push(`${h} <= ${p}`)
      else if (r.s !== 400) notBlocked.push(`${h} <= ${p} = ${r.s}`)
    }
  }
  chk(bad5xx.length === 0, `giá trị tham số kiểu injection → không 5xx (${HOST.length}x${PAYLOAD.length} lượt)`,
    bad5xx.length ? bad5xx.slice(0, 3).join(' | ') : 'sạch')
  chk(notBlocked.length === 0, 'giá trị tham số kiểu injection → chặn bằng 400 BAD_PARAM',
    notBlocked.length ? notBlocked.slice(0, 3).join(' | ') : `${HOST.length * PAYLOAD.length} lượt đều 400`)
}

// ── 8) Ô TỔNG TỒN KHO: phần TÁCH ĐƠN VỊ phải cộng lại ĐÚNG BẰNG tổng (21/08) ──
// Ô "SL (quy đổi)" gộp nhiều đơn vị vật lý (đo Bàu Bàng 132.762.662 mà 131,2 triệu là EA) nên từ
// 21/08 tile hiện thêm dòng "gồm những gì". Nếu phần tách LỆCH tổng thì user thấy 2 con số đá nhau
// ngay trên CÙNG một ô — tệ hơn cả lúc chưa tách. Kiểm CẢ 2 chế độ xem: chi tiết pallet dùng RPC
// inventory_band_totals, tổng hợp dùng inventory_summary_page — 2 RPC khác nhau, sửa 1 bên là lệch.
{
  const WH = [null, FIX.WH_QR.id]
  for (const wh of WH) {
    for (const [mode, path] of [
      ['chi tiết',  `/wms/inventory?limit=1${wh ? '&warehouse_ids=' + wh : ''}`],
      ['tổng hợp',  `/wms/inventory/summary?limit=1${wh ? '&warehouse_ids=' + wh : ''}`],
    ]) {
      const r = await api(path)
      const d = r.j?.data ?? {}
      const tot = Number(d.total_cartons_remaining ?? 0)
      const bu = Array.isArray(d.by_unit) ? d.by_unit : null
      if (bu === null) { chk(false, `by_unit của ô tổng — ${mode}${wh ? ' (1 kho)' : ' (toàn scope)'}`, 'API KHÔNG trả khoá by_unit (migration 20260821g/i chưa apply?)'); continue }
      const sum = bu.reduce((a, u) => a + Number(u.qty), 0)
      // sai số làm tròn: numeric chia per-mã rồi cộng — nới 0,05 trên tổng cỡ trăm triệu
      chk(Math.abs(sum - tot) <= 0.05, `by_unit của ô tổng cộng lại = tổng — ${mode}${wh ? ' (1 kho)' : ' (toàn scope)'}`,
        `tổng ${tot.toLocaleString('vi-VN')} vs Σ ${sum.toLocaleString('vi-VN')} · ${bu.length} đơn vị`)
    }
  }
}

console.log(`\n[PARAMS-FUZZ] ${pass}/${pass + fail} PASS${fail ? ` · ${fail} FAIL` : ''}`)
if (fail) console.log('  Hỏng: ' + bad.join(' | '))
// KHÔNG process.exit() cưỡng bức sau fetch HTTPS (libuv assert trên Windows) — đặt exitCode, thoát tự nhiên.
process.exitCode = fail ? 1 : 0
