// GÓI 20 — TRUNG TÂM CẢNH BÁO (Đợt 2 roadmap 06/08): vòng đời cảnh báo qua ĐÚNG đường người dùng.
// Kịch bản: xe SIMALERT vào cổng 2h trước chưa ra → xuất hiện WARNING · quét lại khi điều kiện
// còn → KHÔNG nhân bản (dedup, last_seen tiến, first_seen giữ) · xe RA → TỰ ĐÓNG · vào lại →
// TÁI MỞ như đợt mới (first_seen mới) · Ack ẩn khỏi list mặc định + hiện ở status=acked · unack.
// Scanner throttle force = 20s → giữa các pha có sleep 21s (đường throttle là hành vi thật).
import { randomUUID } from 'crypto'
import { login, api, restAll, restWrite, restRpc, check, finish, FIX, BASE } from './lib.mjs'

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

// `fresh=1` XIN quét ngay, nhưng scanner vẫn chặn spam: đã quét cách đây <20s (FORCE_INTERVAL_MS,
// đếm RIÊNG từng instance serverless) thì lượt xin này trả về mà KHÔNG quét ⇒ fixture vừa gieo chưa
// được nhìn thấy. Chạy gói một mình thì hiếm khi dính; chạy trong `run-all` thì gói ngay trước đó
// vừa sinh traffic nên dính thường xuyên — và một cổng merge "đỏ lúc được lúc không" sẽ bị người ta
// tập bỏ qua. Thử lại quá cửa sổ 20s thay vì nới lỏng phép kiểm.
let r1, hit1
for (let i = 0; i < 3 && !hit1; i++) {
  if (i > 0) await sleep(21_000)
  r1 = await openList()
  hit1 = (r1.j?.data?.rows ?? []).find(a => (a.title ?? '').includes(PLATE))
}
check('Xe 2h chưa ra → cảnh báo GATE_DWELL WARNING xuất hiện', r1.s === 200 && !!hit1 && hit1.severity === 'WARNING',
  `http=${r1.s} hit=${hit1 ? hit1.severity : 'KHÔNG THẤY'}`)
check('Cảnh báo nêu RÕ TÊN KHO (user góp ý 06/08)', hit1?.warehouse_name === FIX.WH_QTY.name,
  `warehouse_name=${hit1?.warehouse_name ?? 'null'}`)
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

// [7] MỌI RULE PHẢI CHẠY ĐƯỢC — chống lớp lỗi "rule chết CÂM" (check-app 06/08: RPC
// alerts_expiry_candidates nổ 42883 `timestamp + integer` suốt từ lúc ship mà không ai biết,
// vì scanner bọc try/catch per-rule; hậu quả: 120 nhóm tồn cận date KHÔNG hề được cảnh báo).
// Hai lưới: (a) RPC nền phải chạy; (b) sau lượt quét, error_logs KHÔNG được có ALERT_RULE_FAILED.
{
  let rpcErr = null
  try { await restRpc('alerts_expiry_candidates', { p_days: 120 }) } catch (e) { rpcErr = String(e).slice(0, 160) }
  check('RPC nền của rule "tồn cận date" chạy được (không chết câm)', !rpcErr, rpcErr ?? 'ok')

  const since = new Date(Date.now() - 5 * 60_000).toISOString()
  await api('/wms/alerts?fresh=1&status=open', 'GET')   // ép 1 lượt quét
  const failed = await restAll('error_logs', `select=message&code=eq.ALERT_RULE_FAILED&created_at=gte.${since}`)
  check('Không rule nào lỗi trong lượt quét vừa rồi (scanner tự tố nếu có)',
    failed.length === 0, failed.length ? failed[0].message?.slice(0, 120) : '0 lỗi rule')
}

// [8] Chế độ GIỮ LẠI sau khi xe ra (user chốt 19/08 — cờ GATE_KEEP_AFTER_EXIT trong Cài đặt ngưỡng):
// bật cờ → xe RA nhưng cảnh báo VẪN MỞ (chờ "Đã biết") · tắt cờ → lượt quét sau tự đóng như gốc.
// Đổi cờ qua API (xoá cache instance nhận request) + chờ 31s cho cache 30s của MỌI instance hết hạn.
{
  const thBackup = (await api('/wms/settings', 'GET')).j?.data?.find?.(s => s.key === 'alert_thresholds')?.value ?? null
  const baseTh = { PCT_WARN: 20, PCT_CRIT: 10, GATE_WARN_MIN: 90, GATE_CRIT_MIN: 180,
    TRIP_STUCK_HOURS: 6, TRIP_LATE_DAYS: 14, WEIGH_WARN_PCT: 5, WEIGH_CRIT_PCT: 15,
    PACKING_UNRECV_WARN_H: 12, PACKING_UNRECV_CRIT_H: 24, ...(thBackup ?? {}) }
  const setKeep = keep => api('/wms/settings/alert_thresholds', 'PUT', { value: { ...baseTh, GATE_KEEP_AFTER_EXIT: keep } })

  const rOn = await setKeep(true)
  check('[8a] Lưu cờ GATE_KEEP_AFTER_EXIT=true qua API (validator nhận boolean tùy chọn)', rOn.s === 200, `http=${rOn.s}`)
  // xe đang IN (từ mục [5]) → cho RA trong lúc cờ GIỮ LẠI đang bật
  await sleep(31_000)
  await restWrite('gate_registrations', 'PATCH', `id=eq.${gid}`, { exit_at: t(), status: 'COMPLETED', updated_at: t() })
  await sleep(21_000)
  await openList()
  const rowKeep = await dbRow(KEY)
  check('[8b] Cờ GIỮ LẠI bật → xe đã ra mà cảnh báo KHÔNG tự đóng (chờ "Đã biết")',
    !!rowKeep && !rowKeep.resolved_at, `resolved_at=${rowKeep?.resolved_at ?? 'null'}`)

  const rOff = await setKeep(false)
  await sleep(31_000)
  await openList()
  const rowOff = await dbRow(KEY)
  check('[8c] Tắt cờ → lượt quét sau tự đóng lại như hành vi gốc',
    rOff.s === 200 && !!rowOff?.resolved_at, `http=${rOff.s} resolved_at=${rowOff?.resolved_at ?? 'null'}`)

  // trả cấu hình về đúng trạng thái trước khi chạy gói (không để cờ test dính lại hệ thống)
  if (thBackup) await api('/wms/settings/alert_thresholds', 'PUT', { value: thBackup })
  else await api('/wms/settings/alert_thresholds', 'PUT', { value: baseTh })
}

console.log('\n🧹 dọn…')
await cleanup()
const residue = (await restAll('gate_registrations', `select=id&license_plate=eq.${PLATE}`)).length
  + (await restAll('alert_events', `select=id&dedup_key=eq.${encodeURIComponent(KEY)}`)).length
console.log(`residue=${residue}`)
finish('ALERTS')
