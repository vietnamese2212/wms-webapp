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

async function cleanup() {
  await restWrite('push_subscriptions', 'DELETE', `endpoint=like.*${TAG.toLowerCase()}*`).catch(() => {})
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

console.log('\n🧹 dọn…')
await cleanup()
const residue = await restAll('push_subscriptions', `select=id&endpoint=like.*${TAG.toLowerCase()}*`)
console.log(`residue=${residue.length}`)
finish('PUSH-NOTIFY')
