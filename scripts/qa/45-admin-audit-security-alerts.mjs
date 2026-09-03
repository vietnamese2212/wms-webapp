// 45 — NHẬT KÝ QUẢN TRỊ + CẢNH BÁO BẢO MẬT (03/09).
// (a) Thao tác quản trị (đặt mật khẩu · phạm vi kho · đổi quyền chức danh · cờ hệ thống · mở khoá) phải để lại dòng
//     admin_audit_events đúng action/actor/before-after, KHÔNG chứa mật khẩu; GET /masterdata/admin-audit lọc được, user
//     thiếu quyền audit_log → 403.
// (b) Rule AUTH_LOCKOUT: ≥3 tài khoản khác nhau bị khoá trong 1h → alert mở; xoá vết → quét lại → tự đóng.
//     Rule ADMIN_NEW_IP: superadmin đăng nhập ok từ IP lạ → alert per (email, ip); xoá vết → tự đóng.
// Fixture tag QAAUD, tự dọn (kể cả dòng audit sinh ra trong lúc test).
import { randomUUID } from 'crypto'
import { login, api, check, finish, restAll, restWrite, resolveFixtures, FIX, BASE } from './lib.mjs'

const TAG = 'QAAUD'
let bcrypt = null
try { bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(m => m.default ?? m) } catch { /* */ }
if (!bcrypt) { console.log('  ⏭  không load được bcrypt của backend — gói 45 bỏ qua'); process.exit(0) }

const emails = [1, 2, 3].map(i => `${TAG.toLowerCase()}0${i}@test.local`)
const QA_IP = 'QAAUD-IP-198.51.100.7'
const QA_IP_OLD = 'QAAUD-IP-198.51.100.1'
async function clean() {
  for (const e of await restAll('Employee', `select=id&employee_code=like.${TAG}*`)) {
    await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${e.id}`).catch(() => {})
    await restWrite('Employee', 'DELETE', `id=eq.${e.id}`)
  }
  await restWrite('JobTitle', 'DELETE', `name=like.${TAG}*`).catch(() => {})
  for (const em of emails) {
    await restWrite('auth_attempts', 'DELETE', `key=eq.acct:${em}`).catch(() => {})
    await restWrite('auth_login_events', 'DELETE', `email=eq.${em}`).catch(() => {})
  }
  await restWrite('auth_attempts', 'DELETE', 'key=like.ip:*').catch(() => {})
  await restWrite('auth_login_events', 'DELETE', `ip=like.QAAUD-IP-*`).catch(() => {})
  await restWrite('admin_audit_events', 'DELETE', `target_label=like.*${TAG}*`).catch(() => {})
  await restWrite('admin_audit_events', 'DELETE', `target_id=eq.qa_${TAG.toLowerCase()}_setting`).catch(() => {})
  await restWrite('alert_events', 'DELETE', `dedup_key=like.ADMINIP*${QA_IP}`).catch(() => {})
}
const rawLogin = async (email, pw) => {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })
  let j = null; try { j = JSON.parse(await r.text()) } catch { /* */ }
  return { s: r.status, token: j?.data?.token ?? null }
}
const audit = async (q) => (await api(`/masterdata/admin-audit?page=1&page_size=50&${q}`)).j?.data?.rows ?? []

await clean()
await login()
await resolveFixtures()
const WH = FIX.WH_QTY.id
const now = new Date().toISOString()
const pw = 'Qa' + randomUUID().slice(0, 10) + '9x'
const ids = emails.map(() => randomUUID())
await restWrite('Employee', 'POST', '', emails.map((em, i) => ({ id: ids[i], employee_code: `${TAG}0${i + 1}`, name: `${TAG} nv ${i + 1}`, email: em,
  password: bcrypt.hashSync(pw, 10), is_active: true, warehouse_scope: 'NATIONAL', updated_at: now })))
try {
  // ── (a) Nhật ký quản trị ────────────────────────────────────────────────────────────────
  const target = ids[0]
  const setPw = await api(`/masterdata/employees/${target}/set-password`, 'PATCH', { password: 'Kho' + randomUUID().slice(0, 8) + '2026' })
  check('Đặt mật khẩu → 200', setPw.s === 200, `http=${setPw.s}`)
  const pwRows = await audit(`action=PASSWORD_SET&search=${TAG}01`)
  check('Nhật ký có PASSWORD_SET đúng target, có actor, KHÔNG chứa mật khẩu', pwRows.length === 1 && pwRows[0].target_id === target && !!pwRows[0].actor_name
    && !JSON.stringify(pwRows[0].after ?? {}).includes('Kho') && pwRows[0].after == null, JSON.stringify(pwRows[0] ?? null).slice(0, 200))

  const wh = await api(`/masterdata/employees/${target}/warehouses`, 'PUT', { warehouse_ids: [WH] })
  check('Đặt phạm vi kho → 200', wh.s === 200, `http=${wh.s} ${wh.j?.error?.message ?? ''}`)
  const whRows = await audit(`action=WAREHOUSE_ACCESS&search=${TAG}01`)
  check('WAREHOUSE_ACCESS ghi before=[] → after=[kho]', whRows.length === 1 && JSON.stringify(whRows[0].before?.warehouse_ids) === '[]' && JSON.stringify(whRows[0].after?.warehouse_ids) === JSON.stringify([WH]),
    JSON.stringify({ b: whRows[0]?.before, a: whRows[0]?.after }))
  const whAgain = await api(`/masterdata/employees/${target}/warehouses`, 'PUT', { warehouse_ids: [WH] })
  check('Đặt lại Y NHƯ CŨ → không sinh dòng nhật ký thừa', whAgain.s === 200 && (await audit(`action=WAREHOUSE_ACCESS&search=${TAG}01`)).length === 1)

  const dept = (await api('/masterdata/departments')).j?.data?.[0]
  const jt = await api('/masterdata/job-titles', 'POST', { name: `${TAG} chức danh`, department_id: dept.id, module_permissions: { inventory: ['view'] } })
  check('Tạo chức danh → 201 + JOBTITLE_CREATE', jt.s === 201 && (await audit(`action=JOBTITLE_CREATE&search=${TAG}`)).length === 1, `http=${jt.s}`)
  const jtId = jt.j?.data?.id
  const upd = await api(`/masterdata/job-titles/${jtId}`, 'PUT', { module_permissions: { inventory: ['view', 'adjust'], outbound: ['view'] } })
  const jtRows = await audit(`action=JOBTITLE_UPDATE&search=${TAG}`)
  check('ĐỔI QUYỀN chức danh → JOBTITLE_UPDATE với before/after module_permissions', upd.s === 200 && jtRows.length === 1
    && JSON.stringify(jtRows[0].before?.module_permissions) === JSON.stringify({ inventory: ['view'] })
    && JSON.stringify(jtRows[0].after?.module_permissions) === JSON.stringify({ inventory: ['view', 'adjust'], outbound: ['view'] }), JSON.stringify(jtRows[0]?.after ?? null).slice(0, 160))

  // cờ hệ thống: đổi qua PUT rồi trả lại; kiểm dòng SETTING_UPDATE có before/after
  const cur = ((await api('/wms/settings')).j?.data ?? []).find(s => s.key === 'dashboard_cache_seconds')
  const oldVal = cur?.value ?? 300
  const newVal = oldVal === 301 ? 302 : 301
  const put1 = await api('/wms/settings/dashboard_cache_seconds', 'PUT', { value: newVal })
  const put2 = await api('/wms/settings/dashboard_cache_seconds', 'PUT', { value: oldVal })
  const setRows = (await audit('action=SETTING_UPDATE&search=dashboard_cache_seconds')).filter(r => JSON.stringify(r.after?.value) === String(newVal))
  check('PUT cờ hệ thống → SETTING_UPDATE before/after đúng giá trị', put1.s === 200 && put2.s === 200 && setRows.length >= 1 && JSON.stringify(setRows[0].before?.value) === JSON.stringify(oldVal), `http=${put1.s}/${put2.s} rows=${setRows.length}`)
  for (const r of (await audit('action=SETTING_UPDATE&search=dashboard_cache_seconds')).filter(r => [newVal, oldVal].includes(r.after?.value) && Date.now() - new Date(r.created_at).getTime() < 120_000))
    await restWrite('admin_audit_events', 'DELETE', `id=eq.${r.id}`).catch(() => {})

  check('Lọc action không hợp lệ → 400', (await api('/masterdata/admin-audit?action=HACK')).s === 400)
  check('from sai định dạng → 400', (await api('/masterdata/admin-audit?from=03-09-2026')).s === 400)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const byDay = await api(`/masterdata/admin-audit?from=${today}&to=${today}&search=${TAG}&page_size=10`)
  check('Lọc theo ngày VN hôm nay + tìm → có total và rows ≤ page_size', byDay.s === 200 && byDay.j.data.total >= 4 && byDay.j.data.rows.length <= 10, `total=${byDay.j?.data?.total}`)
  // user không có quyền audit_log (không chức danh) → 403
  const tok2 = (await rawLogin(emails[1], pw)).token
  const r403 = await fetch(`${BASE}/api/masterdata/admin-audit?page=1`, { headers: { Authorization: `Bearer ${tok2}` } })
  check('User thiếu user_admin.audit_log → 403', r403.status === 403, `http=${r403.status}`)

  // ── (b) AUTH_LOCKOUT ──────────────────────────────────────────────────────────────────
  for (const em of emails) for (let i = 0; i < 11; i++) await rawLogin(em, 'sai-' + i)
  const scan1 = await api('/wms/alerts/scan', 'POST', {})
  const lock = ((await api('/wms/alerts?status=open&rule=AUTH_LOCKOUT')).j?.data ?? []).filter(a => a.rule === 'AUTH_LOCKOUT')
  check('3 tài khoản bị khoá trong 1h → alert AUTH_LOCKOUT mở (WARNING, nêu số tài khoản)', scan1.s === 200 && lock.length === 1 && lock[0].severity === 'WARNING' && /3 tài khoản/.test(lock[0].title), lock[0]?.title ?? `scan=${scan1.s}`)
  // (a-tiếp) mở khoá qua API → ACCOUNT_UNLOCK
  const unlock = await api(`/masterdata/employees/${ids[2]}/lock`, 'DELETE')
  check('Mở khoá → ACCOUNT_UNLOCK trong nhật ký', unlock.s === 200 && (await audit(`action=ACCOUNT_UNLOCK&search=${emails[2]}`)).length === 1, `http=${unlock.s}`)
  // xoá vết LOCKED → quét lại (chờ 20s throttle FORCE) → tự đóng
  for (const em of emails) await restWrite('auth_login_events', 'DELETE', `email=eq.${em}`)
  await new Promise(r => setTimeout(r, 21_000))
  await api('/wms/alerts/scan', 'POST', {})
  const lockAfter = ((await api('/wms/alerts?status=open&rule=AUTH_LOCKOUT')).j?.data ?? []).filter(a => a.rule === 'AUTH_LOCKOUT')
  const lockResolved = await restAll('alert_events', `select=id,resolved_at&rule=eq.AUTH_LOCKOUT&order=updated_at.desc&limit=1`)
  check('Hết vết khoá → AUTH_LOCKOUT tự đóng (resolved_at)', lockAfter.length === 0 && !!lockResolved[0]?.resolved_at, `open=${lockAfter.length}`)

  // ── (b) ADMIN_NEW_IP — chèn 1 lượt đăng nhập OK của superadmin từ IP lạ ─────────────
  const me = (await api('/auth/me')).j?.data?.user
  // Rule chỉ báo khi email ĐÃ CÓ lịch sử >24h (ngày đầu bật không báo oan) → chèn 1 lượt cũ 3 ngày từ IP khác trước
  await restWrite('auth_login_events', 'POST', '', [
    { email: String(me.email).toLowerCase(), ip: QA_IP_OLD, ok: true, reason: null, employee_id: me.id, created_at: new Date(Date.now() - 3 * 86400_000).toISOString() },
    { email: String(me.email).toLowerCase(), ip: QA_IP, ok: true, reason: null, employee_id: me.id },
  ])
  await new Promise(r => setTimeout(r, 21_000))
  await api('/wms/alerts/scan', 'POST', {})
  const ipAlert = ((await api('/wms/alerts?status=open&rule=ADMIN_NEW_IP')).j?.data ?? []).filter(a => a.rule === 'ADMIN_NEW_IP' && a.title.includes(QA_IP))
  check('Superadmin đăng nhập từ IP lạ → alert ADMIN_NEW_IP nêu email + IP', ipAlert.length === 1 && ipAlert[0].title.includes(String(me.email).toLowerCase()), ipAlert[0]?.title ?? 'không có')
  await restWrite('auth_login_events', 'DELETE', `ip=like.QAAUD-IP-*`)
  await new Promise(r => setTimeout(r, 21_000))
  await api('/wms/alerts/scan', 'POST', {})
  const ipAfter = ((await api('/wms/alerts?status=open&rule=ADMIN_NEW_IP')).j?.data ?? []).filter(a => a.title.includes(QA_IP))
  check('Xoá vết IP lạ → ADMIN_NEW_IP tự đóng', ipAfter.length === 0)
  // dọn chức danh test (xoá cứng qua REST — không có route xoá)
  if (jtId) await restWrite('JobTitle', 'DELETE', `id=eq.${jtId}`).catch(() => {})
} finally { await clean() }
finish('ADMIN-AUDIT-SECURITY-ALERTS')
