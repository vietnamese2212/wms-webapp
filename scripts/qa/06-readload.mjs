// GÓI READLOAD — ĐỌC dưới TẢI GHI: các trang đã phân trang server có trụ được khi hàng trăm
// người vừa ghi vừa xem không? Không nằm trong run-all (nặng): node scripts/qa/06-readload.mjs
//
// VÌ SAO CÓ GÓI NÀY (chỗ trống của Cổng 5, phát hiện 28/07): gói RUSH chỉ đo phía GHI. Nhưng
// rủi ro thật của các trang list nằm ở phía ĐỌC — mấy câu ĐẾM TỔNG / GOM NHÓM (Tồn kho, Dashboard,
// In tem) phải quét cả tập khớp lọc, nên dưới tải ghi đồng thời chúng dễ chạm
// **statement_timeout 8s CỐ ĐỊNH của role PostgREST** rồi biến thành 500 — user thấy "Lỗi hệ thống"
// đúng lúc kho đang cao điểm. Đã gặp thật 1 lần khi chạy 48 endpoint liên tiếp.
//
// Ngưỡng đánh giá: KHÔNG có 500/401, và max mỗi đường < 8.000ms (trần PostgREST).
import { login, api, check, finish, pool, teardownGdo, cleanupTagged, resolveFixtures, FIX } from './lib.mjs'

console.log('── GÓI READLOAD: ghi nhiều module + 6 người ĐỌC, đồng thời ──')
await login()
await resolveFixtures()   // tra MAT_POOL_ID lúc chạy (đừng hardcode id — id cũ đã chết)

const T  = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const M0 = T.slice(0, 8) + '01'
const Y0 = T.slice(0, 4) + '-01-01'
// work_dates: FE tự tính ngày cần chấm công (giữ luật lễ VN ở FE) rồi gửi xuống
const DATES = Array.from({ length: 26 }, (_, i) => `${T.slice(0, 8)}${String(i + 1).padStart(2, '0')}`).join(',')

// ── Các đường ĐỌC: đúng như app gọi, ưu tiên đường có đếm tổng nặng ─────────────
const READS = [
  ['Dashboard',            `/wms/dashboard`],
  ['Tồn kho · pallet',     `/wms/inventory?page=1&limit=100`],
  ['Tồn kho · TỔNG HỢP',   `/wms/inventory/summary?page=1&limit=200`],
  ['In tem · lịch sử',     `/wms/pallet-prints?page=1&page_size=50&date_from=${T}&date_to=${T}`],
  ['Kiểm kê · lịch sử',    `/wms/inventory/stocktake-log?page=1&page_size=200`],
  ['Nghỉ phép',            `/hr/leaves?date_from=${Y0}&date_to=${T}&page=1&page_size=100`],
  ['Bảng công',            `/hr/attendance/matrix?date_from=${M0}&date_to=${T}&work_dates=${DATES}&page=1&page_size=100`],
  ['Xuất kho',             `/wms/outbound?page=1&limit=100`],
  ['TMS Xe',               `/tms/vehicles?page=1&page_size=200`],
  ['Nhặt lẻ',              `/wms/loosepicking?page=1&page_size=100`],
]
const lat = new Map(READS.map(([n]) => [n, []]))
const readErrs = []
let stop = false

const reader = async (id) => {
  let k = id
  while (!stop) {
    const [name, path] = READS[k++ % READS.length]
    const t = Date.now()
    const r = await api(path)
    lat.get(name).push(Date.now() - t)
    if (r.s !== 200) readErrs.push(`${name}:${r.s}`)
    await new Promise(res => setTimeout(res, 50))
  }
}

// ── Các nhóm GHI (khuôn gói RUSH — payload đã kiểm chứng) ──────────────────────
const errs = []   // 5xx = LỖI APP
const biz  = []   // 4xx = nghiệp vụ chặn đúng (hết tồn, đua nhau…) — KHÔNG phải lỗi
// A. tạo & xuất luôn ở kho NONE (không đụng pool)
const groupA = Array.from({ length: 20 }, (_, k) => async () => {
  const q = await api('/wms/outbound/quick-export', 'POST', {
    delivery_date: FIX.EXEC_DATE, warehouse_id: FIX.WH_NONE.id, dvvt: FIX.DVVT_TAG,   // xuất luôn = ngày hôm nay (luật FUTURE_DATE 02/08)
    delivery_code: `RL-A${k}-` + Math.floor(Math.random() * 1e6), license_plate: '88A-' + (100 + k % 90),
    customer_name: 'RL KH ' + k, items: [{ material_code: FIX.MAT_POOL, cartons_ordered: 1 + (k % 3) }],
  })
  if (q.s !== 201) errs.push(`A${k}:${q.s}`)
})
// B. nhập kho: tạo phiếu → nhập tay → xoá dòng → huỷ (đụng pool 2 chiều)
const groupB = Array.from({ length: 12 }, (_, k) => async () => {
  const c = await api('/wms/inbound-orders', 'POST', {
    warehouse_id: FIX.WH_QTY.id, material_id: FIX.MAT_POOL_ID,
    planned_cartons: 3, source_type: 'FACTORY', notes: 'QA-READLOAD',
  })
  const ord = c.j?.data?.order ?? c.j?.data
  if (!ord?.id) { errs.push(`B${k}:create:${c.s}`); return }
  const sm = await api(`/wms/inbound-orders/${ord.id}/scan-manual`, 'POST', { cartons: 3 })
  // Phân biệt rõ: 5xx = LỖI APP · 4xx = nghiệp vụ chặn đúng (hết tồn, hai người cùng sửa…).
  // Gộp chung là báo động giả, mà bỏ qua hết thì mất tín hiệu — nên tách 2 sổ.
  if (sm.s >= 500) errs.push(`B${k}:scan:${sm.s}`)
  else if (sm.s !== 200) biz.push(`B:scan:${sm.s}:${sm.j?.error?.code ?? ''}`)
  const g = await api(`/wms/inbound-orders/${ord.id}`)
  for (const e of (g.j?.data?.inventory_entries ?? []))
    await api(`/wms/inbound-orders/${ord.id}/entries/${e.id}`, 'DELETE', {})
  const cx = await api(`/wms/inbound-orders/${ord.id}/cancel`, 'POST')
  if (cx.s >= 500) errs.push(`B${k}:cancel:${cx.s}`)
  else if (cx.s !== 200) biz.push(`B:cancel:${cx.s}:${cx.j?.error?.code ?? ''}`)
})
// C. TRANH CHẤP: nhiều người cùng xuất/gỡ/xuất lại trên pool của ĐÚNG 1 mã ở kho QTY
const groupC = Array.from({ length: 10 }, (_, k) => async () => {
  const c = await api('/wms/outbound', 'POST', {
    delivery_date: FIX.EXEC_DATE, warehouse_id: FIX.WH_QTY.id, dvvt: FIX.DVVT_TAG,   // sẽ Xuất luôn → ngày hôm nay
    customer_name: 'An Sơn', shipto_party: FIX.WH_NONE.code,
    delivery_code: `RL-C${k}-` + Math.floor(Math.random() * 1e6),
    items: [{ material_code: FIX.MAT_POOL, cartons_ordered: 2 }],
  })
  const gdo = c.j?.data
  if (!gdo?.id) { errs.push(`C${k}:create:${c.s}`); return }
  const q1 = await api(`/wms/outbound/${gdo.id}/quick-export`, 'POST', { license_plate: '88C-' + k })
  if (q1.s >= 500) errs.push(`C${k}:qe1:${q1.s}`)
  else if (q1.s !== 200) biz.push(`C:qe1:${q1.s}:${q1.j?.error?.code ?? ''}`)
  await api(`/wms/outbound/${gdo.id}/uncomplete`, 'POST')
  const q2 = await api(`/wms/outbound/${gdo.id}/quick-export`, 'POST', { license_plate: '88C-' + k })
  if (q2.s >= 500) errs.push(`C${k}:qe2:${q2.s}`)
  else if (q2.s !== 200) biz.push(`C:qe2:${q2.s}:${q2.j?.error?.code ?? ''}`)
  if (!(await teardownGdo(gdo.id, 'COMPLETED'))) errs.push(`C${k}:teardown`)
})
// D. bảo vệ cổng: đăng ký → gọi → vào → ra
const groupD = Array.from({ length: 8 }, (_, k) => async () => {
  const c = await api('/tms/gate-registrations', 'POST', {
    date: FIX.DATE, warehouse_id: FIX.WH_QR.id, direction: 'INBOUND',
    license_plate: '88D-' + (200 + k), vehicle_type: 'TAI', company_name_raw: 'QA READLOAD', driver_name: 'QA',
  })
  const g = c.j?.data
  if (!g?.id) { errs.push(`D${k}:create:${c.s}`); return }
  for (const step of ['call', 'entry', 'exit']) {
    const r = await api(`/tms/gate-registrations/${g.id}/${step}`, 'POST', {})
    if (r.s >= 500) errs.push(`D${k}:${step}:${r.s}`)
  }
  await api(`/tms/gate-registrations/${g.id}`, 'DELETE')
})

// Số luồng GHI đồng thời — đặt qua tham số: node scripts/qa/06-readload.mjs [số]
// Mặc định 8. LƯU Ý: mỗi luồng ở đây là một CHUỖI NHIỀU BƯỚC (tạo→quét→xoá→huỷ) chạy liên tục
// KHÔNG có think-time, nên 8 luồng kiểu này nặng hơn nhiều so với 8 người dùng thật. Chạy 24 để
// tìm điểm gãy, chạy 6–8 để kiểm "giờ cao điểm bình thường".
const WRITERS = Math.max(1, parseInt(process.argv[2] ?? '8', 10) || 8)
console.log(`   luồng GHI đồng thời = ${WRITERS} · người ĐỌC = 6`)
const t0 = Date.now()
const readers = Array.from({ length: 6 }, (_, i) => reader(i))
await pool([...groupA, ...groupB, ...groupC, ...groupD], WRITERS)
stop = true
await Promise.all(readers)
const dur = ((Date.now() - t0) / 1000).toFixed(0)

// ── Kết quả ────────────────────────────────────────────────────────────────────
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0
console.log(`\n  ĐỌC dưới tải ghi (${dur}s) — n · p50 / p95 / max (ms), trần PostgREST = 8.000ms`)
let overCap = []
for (const [name] of READS) {
  const a = lat.get(name)
  if (!a.length) { console.log(`    ${name.padEnd(22)} (không lấy được mẫu)`); continue }
  const mx = Math.max(...a)
  if (mx > 8000) overCap.push(`${name}=${mx}ms`)
  console.log(`    ${name.padEnd(22)} n=${String(a.length).padStart(3)}  ${String(pct(a, 0.5)).padStart(5)} / ${String(pct(a, 0.95)).padStart(5)} / ${String(mx).padStart(5)}${mx > 8000 ? '  ❌ VƯỢT TRẦN' : mx > 3000 ? '  ⚠️' : ''}`)
}

check('ĐỌC: không có request lỗi', readErrs.length === 0, readErrs.length ? [...new Set(readErrs)].join(' ') : '')
check('ĐỌC: không đường nào vượt trần 8s', overCap.length === 0, overCap.join(' '))
check('ĐỌC: không bị đá ra login (401)', !readErrs.some(e => e.endsWith(':401')))
if (biz.length) console.log(`\n  GHI: 4xx nghiệp vụ (chặn ĐÚNG, không tính lỗi): ${[...new Set(biz)].join(' ')}`)
check('GHI: không lỗi 5xx', errs.length === 0, errs.length ? [...new Set(errs)].slice(0, 8).join(' ') : '')

await cleanupTagged()
finish('READLOAD')
