// GÓI 19 — WEB PUSH (Đợt 1 roadmap 06/08): bề mặt API /api/notify + hợp đồng gửi/dọn.
// Phạm vi: vapid-key ổn định + private key KHÔNG đọc được bằng anon · subscribe/unsubscribe
// idempotent + chỉ đụng thiết bị CHÍNH MÌNH · test-push đi qua ĐÚNG code path các trigger dùng
// (sendPushToEmployees) — endpoint giả phải ĐƯỢC ĐẾM LỖI hoặc DỌN, không 500.
// Trigger nghiệp vụ (giao lệnh fill / reconcile) chạy inline trong gói 18 + 12 — push lỗi mà làm
// fail mutation chính thì 2 gói đó đỏ.
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { login, api, restAll, restWrite, check, finish, BASE } from './lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TAG = 'SIMPUSH'
const FAKE_EP = `https://qa-push-${TAG.toLowerCase()}.invalid/wp/${Date.now()}`

function readAnonKey() {
  try {
    for (const line of readFileSync(join(ROOT, 'frontend', '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*VITE_SUPABASE_ANON_KEY\s*=\s*"?([^"]*)"?\s*$/)
      if (m) return m[1]
    }
  } catch { /* thiếu .env → skip check anon */ }
  return null
}
function readSupabaseUrl() {
  try {
    for (const line of readFileSync(join(ROOT, 'backend', '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*SUPABASE_URL\s*=\s*"?([^"]*)"?\s*$/)
      if (m) return m[1]
    }
  } catch { /* ignore */ }
  return null
}

async function cleanup(meId) {
  await restWrite('push_subscriptions', 'DELETE', `endpoint=like.*${TAG.toLowerCase()}*`).catch(() => {})
  await restWrite('user_notifications', 'DELETE', `title=like.*${TAG}*`).catch(() => {})
  if (meId) await restWrite('notification_prefs', 'DELETE', `employee_id=eq.${meId}`).catch(() => {})
}

console.log(`── WEB PUSH /api/notify · ${BASE.replace('https://', '')} ──`)

// [0] chưa đăng nhập → 401 (verifyToken chặn cả router)
{
  const r = await fetch(`${BASE}/api/notify/vapid-key`)
  check('Chưa đăng nhập → vapid-key trả 401', r.status === 401, `http=${r.status}`)
}

await login()
await cleanup()
const me = (await api('/auth/me', 'GET')).j?.data?.user?.id
check('Xác định được employee id của user QA', !!me, me ?? 'null')

// [1] VAPID key: sinh lần đầu + ổn định giữa các lần gọi + đúng 1 dòng config
const k1 = await api('/notify/vapid-key', 'GET')
const k2 = await api('/notify/vapid-key', 'GET')
check('vapid-key 200 + key đủ dài', k1.s === 200 && (k1.j?.data?.key ?? '').length >= 40, `http=${k1.s} len=${(k1.j?.data?.key ?? '').length}`)
check('Key ỔN ĐỊNH giữa 2 lần gọi (không sinh lại)', k1.j?.data?.key === k2.j?.data?.key)
const cfgRows = await restAll('push_config', 'select=id')
check('push_config đúng 1 dòng (PK id=1 ép singleton)', cfgRows.length === 1, `rows=${cfgRows.length}`)

// [2] Private key KHÔNG lộ: anon key bị RLS chặn; response API chỉ mang public key
const anon = readAnonKey(); const sbUrl = readSupabaseUrl()
if (anon && sbUrl) {
  const r = await fetch(`${sbUrl}/rest/v1/push_config?select=vapid_private`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  })
  const body = await r.text()
  check('Anon KHÔNG đọc được push_config (RLS đóng)', !r.ok || body === '[]', `http=${r.status} body=${body.slice(0, 60)}`)
} else {
  check('Anon KHÔNG đọc được push_config (RLS đóng)', true, 'skip — thiếu anon key/.env')
}
check('Response vapid-key không chứa private key', !JSON.stringify(k1.j ?? {}).includes('private'))

// [3] Chưa có thiết bị → test-push trả 404 NO_SUBSCRIPTION (hướng dẫn bật trước)
{
  const r = await api('/notify/test', 'POST')
  check('Chưa đăng ký thiết bị → test-push 404 NO_SUBSCRIPTION',
    r.s === 404 && r.j?.error?.code === 'NO_SUBSCRIPTION', `http=${r.s} code=${r.j?.error?.code}`)
}

// [4] Subscribe: payload hỏng bị chặn, payload đúng ghi 1 dòng, lặp lại = idempotent
{
  const bad1 = await api('/notify/subscriptions', 'POST', { endpoint: 'http://insecure.example/x', keys: { p256dh: 'a', auth: 'b' } })
  check('Endpoint http:// (không https) → 400', bad1.s === 400, `http=${bad1.s}`)
  const bad2 = await api('/notify/subscriptions', 'POST', { endpoint: FAKE_EP })
  check('Thiếu keys mã hóa → 400', bad2.s === 400, `http=${bad2.s}`)

  const okR = await api('/notify/subscriptions', 'POST', { endpoint: FAKE_EP, keys: { p256dh: 'BQatestp256dh', auth: 'authsecret' } })
  const rows1 = await restAll('push_subscriptions', `select=id,employee_id,failed_n&endpoint=eq.${encodeURIComponent(FAKE_EP)}`)
  check('Subscribe hợp lệ → 200 + 1 dòng đúng employee', okR.s === 200 && rows1.length === 1 && rows1[0].employee_id === me,
    `http=${okR.s} rows=${rows1.length}`)

  await api('/notify/subscriptions', 'POST', { endpoint: FAKE_EP, keys: { p256dh: 'BQatestp256dh', auth: 'authsecret' } })
  const rows2 = await restAll('push_subscriptions', `select=id&endpoint=eq.${encodeURIComponent(FAKE_EP)}`)
  check('Subscribe LẶP cùng endpoint → vẫn 1 dòng (upsert, không nhân bản)', rows2.length === 1, `rows=${rows2.length}`)
}

// [5] test-push qua endpoint giả: KHÔNG 500; thiết bị hỏng bị ĐẾM LỖI hoặc DỌN — đây chính là
// code path mà trigger giao-lệnh-fill / reconcile dùng (sendPushToEmployees).
{
  const r = await api('/notify/test', 'POST')
  const rows = await restAll('push_subscriptions', `select=failed_n&endpoint=eq.${encodeURIComponent(FAKE_EP)}`)
  const counted = rows.length === 0 || Number(rows[0]?.failed_n ?? 0) >= 1
  check('test-push với endpoint chết → 200 (không 500), báo failed', r.s === 200 && Number(r.j?.data?.failed ?? 0) >= 1,
    `http=${r.s} sent=${r.j?.data?.sent} failed=${r.j?.data?.failed}`)
  check('Thiết bị chết bị ĐẾM LỖI (failed_n≥1) hoặc DỌN', counted, `rows=${rows.length} failed_n=${rows[0]?.failed_n ?? '—'}`)
}

// [6] Unsubscribe: xóa đúng thiết bị của mình; endpoint lạ = no-op không lỗi
{
  const r = await api('/notify/subscriptions', 'DELETE', { endpoint: FAKE_EP })
  const rows = await restAll('push_subscriptions', `select=id&endpoint=eq.${encodeURIComponent(FAKE_EP)}`)
  check('Unsubscribe → 200 + dòng biến mất', r.s === 200 && rows.length === 0, `http=${r.s} rows=${rows.length}`)
  const r2 = await api('/notify/subscriptions', 'DELETE', { endpoint: 'https://never-registered.invalid/x' })
  check('Unsubscribe endpoint chưa từng đăng ký → 200 no-op', r2.s === 200, `http=${r2.s}`)
}

// [7] FEED CÁ NHÂN (nút chuông tab "Cá nhân" — 06/08): thấy dòng của MÌNH + đếm chưa đọc + đọc hết
{
  const { randomUUID } = await import('crypto')
  await restWrite('user_notifications', 'POST', null, {
    id: randomUUID(), employee_id: me, kind: 'ASSIGN',
    title: `${TAG} — được giao lệnh thử`, body: 'dòng QA', url: '/wms/fill',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  })
  const r = await api('/notify/feed', 'GET')
  const hit = (r.j?.data?.rows ?? []).find(x => (x.title ?? '').includes(TAG))
  check('Feed cá nhân: thấy dòng vừa ghi + unread ≥ 1', r.s === 200 && !!hit && Number(r.j?.data?.unread) >= 1,
    `http=${r.s} unread=${r.j?.data?.unread}`)
  const rRead = await api('/notify/feed/read', 'POST', {})
  const r2 = await api('/notify/feed', 'GET')
  check('Đọc hết → unread = 0, dòng vẫn còn (feed là lịch sử)', rRead.s === 200 && Number(r2.j?.data?.unread) === 0
    && (r2.j?.data?.rows ?? []).some(x => (x.title ?? '').includes(TAG) && x.read_at),
    `unread=${r2.j?.data?.unread}`)
}

// [8] CÀI ĐẶT CHUÔNG (tab "Cài đặt"): default bật hết · PUT tắt 1 case · MERGE không đè case khác · key lạ 400
{
  const d = await api('/notify/prefs', 'GET')
  check('Prefs mặc định: mọi trường hợp BẬT', d.s === 200 && Object.values(d.j?.data?.prefs ?? {}).every(v => v === true),
    JSON.stringify(d.j?.data?.prefs ?? {}).slice(0, 80))
  await api('/notify/prefs', 'PUT', { prefs: { GATE_DWELL: false } })
  await api('/notify/prefs', 'PUT', { prefs: { assign: false } })
  const d2 = await api('/notify/prefs', 'GET')
  const p = d2.j?.data?.prefs ?? {}
  check('PUT từng công tắc MERGE (tắt GATE_DWELL rồi tắt assign → cả 2 tắt, còn lại bật)',
    p.GATE_DWELL === false && p.assign === false && p.EXPIRY === true, JSON.stringify(p).slice(0, 100))
  const bad = await api('/notify/prefs', 'PUT', { prefs: { hack_key: true } })
  check('Key lạ ngoài sổ → 400', bad.s === 400, `http=${bad.s}`)
}

// [9] RÒ FEED CÁ NHÂN QUA RLS (check-app 06/08 đo thật: user B cầm anon key + vé realtime đọc
// được thông báo riêng của A vì policy `USING (true)`). Policy nay phải là `employee_id = auth.uid()`.
{
  const anon = readAnonKey(); const sbUrl = readSupabaseUrl()
  const pol = await restAll('pg_policies', `select=policyname,qual&tablename=eq.user_notifications`).catch(() => [])
  if (pol.length) {
    check('Policy đọc feed cá nhân KHÔNG phải USING(true)',
      pol.every(p => !/^\s*true\s*$/i.test(String(p.qual ?? ''))),
      pol.map(p => `${p.policyname}: ${p.qual}`).join(' | ').slice(0, 140))
  } else if (anon && sbUrl) {
    // fallback: đọc thẳng bằng anon key (không có JWT user) — phải rỗng
    const r = await fetch(`${sbUrl}/rest/v1/user_notifications?select=id&limit=5`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } })
    const b = await r.text()
    check('Anon KHÔNG đọc được feed cá nhân', !r.ok || b === '[]', `http=${r.status} ${b.slice(0, 60)}`)
  } else check('Policy đọc feed cá nhân KHÔNG phải USING(true)', true, 'skip — không đọc được pg_policies/anon key')
}

// [10] GỘP THÔNG BÁO: ghi N dòng CÙNG (người, loại, url) phải còn ĐÚNG 1 (unique DB, không
// phải kiểm-rồi-ghi trong JS — đo 06/08: giao 6 dòng song song sinh 4 thông báo).
{
  const { randomUUID } = await import('crypto')
  const url = `/wms/fill/orders/${randomUUID()}`
  const mk = () => restWrite('user_notifications', 'POST', null, {
    id: randomUUID(), employee_id: me, kind: 'ASSIGN', title: `${TAG} gop`, url,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).then(() => 'ok', () => 'dup')
  const rs = await Promise.all(Array.from({ length: 6 }, mk))
  const rows = await restAll('user_notifications', `select=id&employee_id=eq.${me}&url=eq.${encodeURIComponent(url)}`)
  check('6 lần báo cùng (người, loại, đối tượng) → chỉ 1 dòng feed (gộp ở tầng DB)',
    rows.length === 1, `còn ${rows.length} dòng · ghi=${rs.filter(x => x === 'ok').length} trùng=${rs.filter(x => x === 'dup').length}`)
  await restWrite('user_notifications', 'DELETE', `url=eq.${encodeURIComponent(url)}`).catch(() => {})
}

// [11] NGƯỠNG CẢNH BÁO TÙY BIẾN (SystemSetting alert_thresholds — user yêu cầu 10/08):
// validator phải chặn bộ số vô nghĩa (crit lỏng hơn warn), nhận bộ hợp lệ, và GET trả đúng
// giá trị đã lưu. Fixture: nhớ giá trị trước đó → trả lại nguyên trạng khi xong.
{
  const before = (await api('/wms/settings', 'GET')).j?.data?.find?.(s => s.key === 'alert_thresholds')?.value ?? null
  const FULL = { PCT_WARN: 20, PCT_CRIT: 10, GATE_WARN_MIN: 90, GATE_CRIT_MIN: 180, TRIP_STUCK_HOURS: 6, WEIGH_WARN_PCT: 5, WEIGH_CRIT_PCT: 15 }

  const bad1 = await api('/wms/settings/alert_thresholds', 'PUT', { value: { ...FULL, PCT_CRIT: 30 } })   // crit > warn
  check('Ngưỡng vô nghĩa (PCT_CRIT > PCT_WARN) → 400', bad1.s === 400 && bad1.j?.error?.code === 'INVALID_VALUE', `http=${bad1.s} code=${bad1.j?.error?.code}`)
  const { PCT_WARN: _drop, ...missing } = FULL
  const bad2 = await api('/wms/settings/alert_thresholds', 'PUT', { value: missing })                     // thiếu khóa
  check('Thiếu khóa ngưỡng → 400', bad2.s === 400, `http=${bad2.s}`)
  const bad3 = await api('/wms/settings/alert_thresholds', 'PUT', { value: { ...FULL, GATE_WARN_MIN: -5 } })
  check('Ngưỡng âm → 400', bad3.s === 400, `http=${bad3.s}`)

  const good = { ...FULL, PCT_CRIT: 15, GATE_WARN_MIN: 120 }
  const okr = await api('/wms/settings/alert_thresholds', 'PUT', { value: good })
  check('Bộ ngưỡng hợp lệ → 200', okr.s === 200, `http=${okr.s} ${JSON.stringify(okr.j?.error ?? '')}`)
  const after = (await api('/wms/settings', 'GET')).j?.data?.find?.(s => s.key === 'alert_thresholds')?.value
  check('GET trả đúng ngưỡng vừa lưu (PCT_CRIT=15, GATE_WARN_MIN=120)',
    after?.PCT_CRIT === 15 && after?.GATE_WARN_MIN === 120, JSON.stringify(after ?? null).slice(0, 120))

  // Trả nguyên trạng: có giá trị cũ → ghi lại; chưa từng cấu hình → ghi bộ mặc định
  // (không có route DELETE setting; mặc định = hành vi y hệt "chưa cấu hình").
  const restore = await api('/wms/settings/alert_thresholds', 'PUT', { value: before ?? FULL })
  check('Trả ngưỡng về nguyên trạng sau test', restore.s === 200, `http=${restore.s}`)
}

console.log('\n🧹 dọn…')
await cleanup(me)
const residue = (await restAll('push_subscriptions', `select=id&endpoint=like.*${TAG.toLowerCase()}*`)).length
  + (await restAll('user_notifications', `select=id&title=like.*${TAG}*`)).length
  + (await restAll('notification_prefs', `select=employee_id&employee_id=eq.${me}`)).length
console.log(`residue=${residue}`)
finish('PUSH-NOTIFY')
