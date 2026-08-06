// GÓI 20 — TRUNG TÂM CẢNH BÁO (Đợt 2 roadmap 06/08): vòng đời cảnh báo qua ĐÚNG đường người dùng.
// Kịch bản: xe SIMALERT vào cổng 2h trước chưa ra → xuất hiện WARNING · quét lại khi điều kiện
// còn → KHÔNG nhân bản (dedup, last_seen tiến, first_seen giữ) · xe RA → TỰ ĐÓNG · vào lại →
// TÁI MỞ như đợt mới (first_seen mới) · Ack ẩn khỏi list mặc định + hiện ở status=acked · unack.
// Scanner throttle force = 20s → giữa các pha có sleep 21s (đường throttle là hành vi thật).
import { randomUUID } from 'crypto'
import { login, api, restAll, restWrite, check, finish, FIX, BASE } from './lib.mjs'

const t = () => new Date().toISOString()
const TAG = 'SIMALERT'
const PLATE = `${TAG}01`
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function cleanup() {
  for (const g of await restAll('gate_registrations', `select=id&license_plate=eq.${PLATE}`)) {
    await restWrite('alert_events', 'DELETE', `dedup_key=eq.${encodeURIComponent(`GATE|${g.id}`)}`).catch(() => {})
    await restWrite('gate_registrations', 'DELETE', `id=eq.${g.id}`).catch(() => {})
  }
}
const openList = async (status = 'open') => (await api(`/wms/alerts?fresh=1&status=${status}`, 'GET'))
const dbRow = async key => (await restAll('alert_events',
  `select=id,dedup_key,severity,first_seen,last_seen,ack_at,resolved_at&dedup_key=eq.${encodeURIComponent(key)}`))[0]

console.log(`── TRUNG TÂM CẢNH BÁO · ${BASE.replace('https://', '')} ──`)

// [0] chưa đăng nhập → 401
{
  const r = await fetch(`${BASE}/api/wms/alerts`)
  check('Chưa đăng nhập → /wms/alerts 401', r.status === 401, `http=${r.status}`)
}

await login(); await cleanup()

// [1] Dựng xe trong cổng 2h chưa ra (đúng hình dạng gate_registrations thật)
const gid = randomUUID()
const entry2hAgo = new Date(Date.now() - 2 * 3600_000).toISOString()
await restWrite('gate_registrations', 'POST', null, {
  id: gid, date: TODAY, registration_number: 9901, license_plate: PLATE,
  direction: 'OUTBOUND', warehouse_id: FIX.WH_QTY.id, status: 'IN',
  entry_at: entry2hAgo, registered_at: entry2hAgo,
  created_at: t(), updated_at: t(),
})
const KEY = `GATE|${gid}`

const r1 = await openList()
const hit1 = (r1.j?.data?.rows ?? []).find(a => (a.title ?? '').includes(PLATE))
check('Xe 2h chưa ra → cảnh báo GATE_DWELL WARNING xuất hiện', r1.s === 200 && !!hit1 && hit1.severity === 'WARNING',
  `http=${r1.s} hit=${hit1 ? hit1.severity : 'KHÔNG THẤY'}`)
const row1 = await dbRow(KEY)
check('Bảng alert_events có đúng 1 dòng dedup_key GATE|<id>', !!row1, row1?.dedup_key ?? 'null')

// [2] Điều kiện CÒN → quét lại KHÔNG nhân bản; last_seen tiến, first_seen giữ nguyên
await sleep(21_000)
await openList()
const rows2 = await restAll('alert_events', `select=id,first_seen,last_seen&dedup_key=eq.${encodeURIComponent(KEY)}`)
check('Quét lại khi điều kiện còn → vẫn 1 dòng (dedup)', rows2.length === 1, `rows=${rows2.length}`)
check('first_seen GIỮ NGUYÊN, last_seen TIẾN', !!row1 && rows2[0]?.first_seen === row1.first_seen && rows2[0]?.last_seen > row1.last_seen,
  `first ${row1?.first_seen} → ${rows2[0]?.first_seen}`)

// [3] Ack = "tôi biết rồi": biến khỏi list mặc định, hiện ở status=acked; unack trả lại
{
  const rAck = await api(`/wms/alerts/${row1.id}/ack`, 'POST')
  const inOpen = ((await openList()).j?.data?.rows ?? []).some(a => (a.title ?? '').includes(PLATE))
  const inAcked = ((await openList('acked')).j?.data?.rows ?? []).some(a => (a.title ?? '').includes(PLATE))
  check('Ack → 200, ẩn khỏi "Đang mở", hiện ở "Đã biết"', rAck.s === 200 && !inOpen && inAcked,
    `http=${rAck.s} open=${inOpen} acked=${inAcked}`)
  const rUnack = await api(`/wms/alerts/${row1.id}/ack`, 'DELETE')
  const back = ((await openList()).j?.data?.rows ?? []).some(a => (a.title ?? '').includes(PLATE))
  check('Unack → quay lại "Đang mở"', rUnack.s === 200 && back, `http=${rUnack.s} open=${back}`)
}

// [4] Xe RA cổng → cảnh báo TỰ ĐÓNG (không ai phải bấm gì)
await restWrite('gate_registrations', 'PATCH', `id=eq.${gid}`, { exit_at: t(), status: 'COMPLETED', updated_at: t() })
await sleep(21_000)
const r4 = await openList()
const gone = !((r4.j?.data?.rows ?? []).some(a => (a.title ?? '').includes(PLATE)))
const row4 = await dbRow(KEY)
check('Xe đã ra → cảnh báo tự đóng (resolved_at set, rời list mặc định)', gone && !!row4?.resolved_at,
  `open=${!gone} resolved_at=${row4?.resolved_at ?? 'null'}`)

// [5] Xe vào LẠI (điều kiện tái xuất hiện) → TÁI MỞ như đợt mới: first_seen MỚI, resolved_at null
await restWrite('gate_registrations', 'PATCH', `id=eq.${gid}`,
  { exit_at: null, status: 'IN', entry_at: new Date(Date.now() - 3.5 * 3600_000).toISOString(), updated_at: t() })
await sleep(21_000)
const r5 = await openList()
const hit5 = (r5.j?.data?.rows ?? []).find(a => (a.title ?? '').includes(PLATE))
const row5 = await dbRow(KEY)
check('Tái xuất hiện → mở lại (resolved_at null) + first_seen MỚI (đợt mới, push lại)',
  !!hit5 && !!row5 && !row5.resolved_at && row5.first_seen > row1.first_seen,
  `first ${row1?.first_seen} → ${row5?.first_seen}`)
check('3.5h chưa ra → leo thang CRITICAL (≥180p)', hit5?.severity === 'CRITICAL', `sev=${hit5?.severity}`)

// [6] Tham số bậy không 500 (họ bug 07-params-fuzz)
{
  const r = await api(`/wms/alerts?rule=,,&severity=XX&status=&warehouse_id=%00`, 'GET')
  check('Tham số rỗng/bậy → không 500', r.s === 200, `http=${r.s}`)
}

console.log('\n🧹 dọn…')
await cleanup()
const residue = (await restAll('gate_registrations', `select=id&license_plate=eq.${PLATE}`)).length
  + (await restAll('alert_events', `select=id&dedup_key=eq.${encodeURIComponent(KEY)}`)).length
console.log(`residue=${residue}`)
finish('ALERTS')
