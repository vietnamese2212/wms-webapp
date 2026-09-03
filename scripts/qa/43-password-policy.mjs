// 43 — CHÍNH SÁCH MẬT KHẨU + MỞ KHOÁ ĐĂNG NHẬP (03/09). Trước đó chỉ `length < 8` ở BE, `< 6` ở FE ⇒ "12345678" đặt được;
// mở khoá tài khoản bị khoá phải xoá tay dòng auth_attempts trong DB. Nay: utils/passwordPolicy MỘT nguồn (admin đặt lẫn
// người dùng tự đổi), route DELETE /masterdata/employees/:id/lock (quyền user_admin.unlock), list phân trang trả locked_until.
// Fixture: 1 tài khoản tạm (tag QAPWD), tự dọn.
import { randomUUID } from 'crypto'
import { login, api, check, finish, restAll, restWrite, BASE } from './lib.mjs'

const TAG = 'QAPWD'
const CODE = `${TAG}01`
const EMAIL = `${TAG.toLowerCase()}01@test.local`
let bcrypt = null
try { bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(m => m.default ?? m) } catch { /* chưa npm i backend */ }
if (!bcrypt) { console.log('  ⏭  không load được bcrypt của backend (npm i trong backend) — gói 43 bỏ qua'); process.exit(0) }

async function clean() {
  for (const e of await restAll('Employee', `select=id&employee_code=like.${TAG}*`)) {
    await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${e.id}`).catch(() => {})
    await restWrite('Employee', 'DELETE', `id=eq.${e.id}`)
  }
  await restWrite('auth_attempts', 'DELETE', `key=eq.acct:${EMAIL}`).catch(() => {})
  await restWrite('auth_attempts', 'DELETE', 'key=like.ip:*').catch(() => {})
  await restWrite('auth_login_events', 'DELETE', `email=eq.${EMAIL}`).catch(() => {})
}
const rawLogin = async (email, pw) => {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })
  let j = null; try { j = JSON.parse(await r.text()) } catch { /* */ }
  return { s: r.status, token: j?.data?.token ?? null, code: j?.error?.code }
}
const userApi = async (token, path, method, body) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = JSON.parse(await r.text()) } catch { /* */ }
  return { s: r.status, msg: j?.error?.message ?? '' }
}

await clean()
await login()
const pw0 = 'Qa' + randomUUID().slice(0, 10) + '9x'   // 14 ký tự, có chữ+số — dùng 1 lần, không in
const eid = randomUUID(), now = new Date().toISOString()
await restWrite('Employee', 'POST', '', [{ id: eid, employee_code: CODE, name: `${TAG} nv`, email: EMAIL,
  password: await bcrypt.hash(pw0, 10), is_active: true, warehouse_scope: 'NATIONAL', updated_at: now }])
try {
  // ── [1] Admin đặt mật khẩu: mọi mẫu yếu bị 400 với lý do rõ, mẫu mạnh 200 ─────────────────────────
  const weak = [
    ['ngắn <10', 'Abc12345'],
    ['toàn số', '1234567890'],
    ['toàn chữ', 'matkhaukhotong'],
    ['chuỗi liên tiếp', 'abcdefghij1'],   // vẫn còn chữ+số nhưng gốc lặp
    ['lặp 1 ký tự', 'aaaaaaaaa1'],
    ['phổ biến', 'password2026'],
    ['chứa tên đăng nhập', `x${TAG.toLowerCase()}01-2026`],
    ['chứa mã NV', `${CODE}abc123`],
  ]
  const weakRes = []
  for (const [label, pw] of weak) { const r = await api(`/masterdata/employees/${eid}/set-password`, 'PATCH', { password: pw }); weakRes.push([label, r.s, r.j?.error?.message ?? '']) }
  check('Đặt mật khẩu (admin): 8 mẫu yếu đều 400 kèm lý do', weakRes.every(x => x[1] === 400 && x[2]), weakRes.map(x => `${x[0]}→${x[1]}`).join(' · '))
  check('Lý do KHÁC NHAU theo lỗi (không phải 1 câu chung)', new Set(weakRes.map(x => x[2])).size >= 4, `${new Set(weakRes.map(x => x[2])).size} câu`)
  const pw1 = 'Kho' + randomUUID().slice(0, 8) + '2026'
  const okSet = await api(`/masterdata/employees/${eid}/set-password`, 'PATCH', { password: pw1 })
  check('Đặt mật khẩu mạnh → 200 và đăng nhập được bằng mật khẩu mới', okSet.s === 200 && (await rawLogin(EMAIL, pw1)).s === 200, `http=${okSet.s}`)
  check('Body password không phải chuỗi (số/null) → 400, không 500', (await api(`/masterdata/employees/${eid}/set-password`, 'PATCH', { password: 1234567890 })).s === 400
    && (await api(`/masterdata/employees/${eid}/set-password`, 'PATCH', { password: null })).s === 400)

  // ── [2] Người dùng tự đổi: cùng luật ────────────────────────────────────────────────────────────
  const tok = (await rawLogin(EMAIL, pw1)).token
  const selfWeak = await userApi(tok, '/auth/change-password', 'POST', { old_password: pw1, new_password: 'qwerty1234' })
  check('Tự đổi mật khẩu yếu → 400 (cùng chính sách với admin)', selfWeak.s === 400, `http=${selfWeak.s} ${selfWeak.msg}`)
  const pw2 = 'Vn' + randomUUID().slice(0, 9) + '77'
  const selfOk = await userApi(tok, '/auth/change-password', 'POST', { old_password: pw1, new_password: pw2 })
  check('Tự đổi mật khẩu mạnh → 200 · mật khẩu cũ hết dùng · mới vào được', selfOk.s === 200 && (await rawLogin(EMAIL, pw1)).s === 401 && (await rawLogin(EMAIL, pw2)).s === 200, `http=${selfOk.s}`)

  // ── [3] Khoá do gõ sai → list hiện locked_until → admin mở khoá qua API → vào lại ─────────────
  for (let i = 0; i < 11; i++) await rawLogin(EMAIL, 'sai-' + i)
  check('Bị khoá sau 10 lần sai (429)', (await rawLogin(EMAIL, pw2)).s === 429)
  const page = await api(`/masterdata/employees?page=1&page_size=20&search=${encodeURIComponent(CODE)}`)
  const row = (page.j?.data?.rows ?? []).find(r => r.id === eid)
  check('Danh sách Quản lý người dùng trả locked_until (tương lai) cho tài khoản đang khoá', !!row?.locked_until && new Date(row.locked_until) > new Date(), `locked_until=${row?.locked_until}`)
  const unlock = await api(`/masterdata/employees/${eid}/lock`, 'DELETE')
  check('DELETE /employees/:id/lock → 200 (quyền user_admin.unlock)', unlock.s === 200, `http=${unlock.s} ${unlock.j?.error?.message ?? ''}`)
  check('Sau mở khoá: đăng nhập đúng → 200 ngay, không chờ 15 phút', (await rawLogin(EMAIL, pw2)).s === 200)
  const page2 = await api(`/masterdata/employees?page=1&page_size=20&search=${encodeURIComponent(CODE)}`)
  check('Danh sách sau mở khoá: locked_until = null', ((page2.j?.data?.rows ?? []).find(r => r.id === eid) ?? {}).locked_until == null)
  const evs = await restAll('auth_login_events', `select=reason&email=eq.${EMAIL}&reason=like.UNLOCKED_BY*`)
  check('Nhật ký ghi vết ai mở khoá (UNLOCKED_BY:<id>)', evs.length === 1 && /^UNLOCKED_BY:.+/.test(evs[0].reason), evs.map(e => e.reason).join(','))
  check('Mở khoá id ma → 404 sạch', (await api(`/masterdata/employees/${randomUUID()}/lock`, 'DELETE')).s === 404)
} finally { await clean() }
finish('PASSWORD-POLICY')
