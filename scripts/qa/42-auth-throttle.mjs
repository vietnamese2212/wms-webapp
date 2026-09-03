// 42 — CHỐNG DÒ MẬT KHẨU ở DB (migration 20260903): khoá theo TÀI KHOẢN sau 10 lần sai/15' (xuyên instance —
// express-rate-limit MemoryStore mỗi instance đếm riêng), mật khẩu ĐÚNG lúc đang khoá vẫn 429, mở khoá thì vào được,
// mọi lượt đều có dòng trong auth_login_events. Fixture: 1 tài khoản tạm (tag QATHR), tự dọn cả khoá acct + ip.
import { randomUUID } from 'crypto'
import { check, finish, restAll, restWrite, BASE } from './lib.mjs'

const TAG = 'QATHR'
const EMAIL = `${TAG.toLowerCase()}01@test.local`
let bcrypt = null
try { bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(m => m.default ?? m) } catch { /* chưa npm i backend */ }
if (!bcrypt) { console.log('  ⏭  không load được bcrypt của backend (npm i trong backend) — gói 42 bỏ qua'); process.exit(0) }

async function clean() {
  for (const e of await restAll('Employee', `select=id&employee_code=like.${TAG}*`)) {
    await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${e.id}`).catch(() => {})
    await restWrite('Employee', 'DELETE', `id=eq.${e.id}`)
  }
  await restWrite('auth_attempts', 'DELETE', `key=eq.acct:${EMAIL}`).catch(() => {})
  await restWrite('auth_attempts', 'DELETE', 'key=like.ip:*').catch(() => {})       // IP của máy chạy QA cũng bị đếm — trả lại cho lượt sau
  await restWrite('auth_login_events', 'DELETE', `email=eq.${EMAIL}`).catch(() => {})
}
const login = async pw => {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: pw }) })
  let j = null; try { j = JSON.parse(await r.text()) } catch { /* */ }
  return { s: r.status, code: j?.error?.code, msg: j?.error?.message ?? '' }
}

await clean()
const pw = 'Qa' + randomUUID().slice(0, 10) + '!'   // dùng 1 lần, không in
const eid = randomUUID(), now = new Date().toISOString()
await restWrite('Employee', 'POST', '', [{ id: eid, employee_code: `${TAG}01`, name: `${TAG} nv`, email: EMAIL,
  password: await bcrypt.hash(pw, 10), is_active: true, warehouse_scope: 'NATIONAL', updated_at: now }])
try {
  const ok0 = await login(pw)
  check('Đăng nhập đúng ban đầu → 200', ok0.s === 200, `http=${ok0.s}`)
  const wrong = []
  for (let i = 0; i < 10; i++) wrong.push((await login('sai-mat-khau-' + i)).s)
  check('10 lần sai đầu → 401 (chưa khoá, không lộ gì)', wrong.every(s => s === 401), `mã: ${[...new Set(wrong)].join('/')}`)
  const locked = await login('sai-mat-khau-11')
  check('Lần sai thứ 11 → 429 ACCOUNT_LOCKED', locked.s === 429 && locked.code === 'ACCOUNT_LOCKED', `http=${locked.s} code=${locked.code}`)
  const rightButLocked = await login(pw)
  check('Mật khẩu ĐÚNG lúc đang khoá vẫn 429 (khoá theo tài khoản, không theo instance)', rightButLocked.s === 429, `http=${rightButLocked.s}`)
  const att = (await restAll('auth_attempts', `select=fails,locked_until&key=eq.acct:${EMAIL}`))[0]
  check('Bộ đếm ở DB: fails ≥ 10 + locked_until trong tương lai', !!att && att.fails >= 10 && att.locked_until && new Date(att.locked_until) > new Date(), `fails=${att?.fails} locked_until=${att?.locked_until}`)
  const evs = await restAll('auth_login_events', `select=ok,reason&email=eq.${EMAIL}`)
  const nFail = evs.filter(e => !e.ok && e.reason === 'BAD_PASSWORD').length, nLocked = evs.filter(e => e.reason === 'LOCKED').length, nOk = evs.filter(e => e.ok).length
  check('Nhật ký đăng nhập ghi ĐỦ: 1 đúng · 10 sai mật khẩu · ≥1 bị khoá', nOk === 1 && nFail === 10 && nLocked >= 1, `ok=${nOk} bad=${nFail} locked=${nLocked} tổng=${evs.length}`)
  // Mở khoá (quản trị xoá khoá) → vào lại được, khoá acct bị xoá sau khi đúng
  await restWrite('auth_attempts', 'DELETE', `key=eq.acct:${EMAIL}`)
  await restWrite('auth_attempts', 'DELETE', 'key=like.ip:*').catch(() => {})
  const after = await login(pw)
  check('Mở khoá → đăng nhập đúng 200 và khoá acct được xoá', after.s === 200 && (await restAll('auth_attempts', `select=key&key=eq.acct:${EMAIL}`)).length === 0, `http=${after.s}`)
} finally { await clean() }
finish('AUTH-THROTTLE')
