// 40 — ĐO SỐNG cửa Supabase bằng đúng những gì kẻ dò có: anon key (nằm trong bundle FE), vé realtime
// (JWT role=authenticated mà /login cấp cho MỌI tài khoản), token giả. Gói 00 mục 10b/10c soi CATALOG
// (quyền/policy/publication); gói này soi HÀNH VI THẬT của PostgREST · RPC · GraphQL · OpenAPI · Storage ·
// Auth · Realtime — vì kiểm định 02/09 cho thấy catalog "sạch" mà anon vẫn nghe được postgres_changes.
// Chỉ đọc + 1 PATCH no-op SystemSetting (kích trigger broadcast) + thử signup Auth (tự dọn nếu lọt).
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createHmac } from 'crypto'
import { login, check, finish, pool, restRpc, restAll, restWrite, realtimeTokenValue, readFrontendEnv, HAS_DB } from './lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FE = readFrontendEnv()
const URL_ = FE.VITE_SUPABASE_URL, ANON = FE.VITE_SUPABASE_ANON_KEY
if (!HAS_DB || !URL_ || !ANON) {
  console.log('  ⏭  thiếu SUPABASE_URL/SERVICE_ROLE_KEY (backend/.env) hoặc VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY (frontend/.env hay env) — gói 40 bỏ qua. CI: khai secret VITE_SUPABASE_ANON_KEY để đo sống.')
  process.exit(0)
}
await login()
const TICKET = realtimeTokenValue()
check('Login cấp vé realtime (role=authenticated) để đóng vai người trong công ty', !!TICKET)
if (!TICKET) finish('EXPOSURE-LIVE')

const H = tok => ({ apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' })
async function hit(url, init = {}) {
  const r = await fetch(url, init); const text = await r.text().catch(() => '')
  let json = null; try { json = JSON.parse(text) } catch { /* không phải JSON */ }
  return { s: r.status, text, json, h: r.headers }
}
const ROLES = [['vé realtime', TICKET], ['anon', ANON]]

// ── A. REST đọc MỌI bảng public (danh sách lấy từ catalog, không hard-code) ──
const tables = Object.keys((await restRpc('realtime_readiness')) ?? {})
check('Lấy được danh sách bảng public từ catalog', tables.length > 50, `${tables.length} bảng`)
for (const [label, tok] of ROLES) {
  const res = await pool(tables.map(t => async () => {
    const x = await hit(`${URL_}/rest/v1/${encodeURIComponent(t)}?select=*&limit=1`, { headers: { ...H(tok), Prefer: 'count=exact' } })
    return { t, s: x.s, rows: Array.isArray(x.json) ? x.json.length : -1 }
  }), 8)
  const open = res.filter(x => x.s < 300)
  check(`REST ${label}: 0/${tables.length} bảng trả 2xx (kể cả rỗng)`, open.length === 0, open.length ? `HỞ: ${open.slice(0, 5).map(x => `${x.t}(${x.rows} dòng)`).join(', ')}` : `mã từ chối: ${[...new Set(res.map(x => x.s))].join('/')}`)
}
const hd = await hit(`${URL_}/rest/v1/Employee?select=id`, { method: 'HEAD', headers: { ...H(TICKET), Prefer: 'count=exact' } })
check('HEAD count=exact Employee bằng vé không trả tổng số', hd.s >= 400 || !(hd.h.get('content-range') || '').includes('/'), `http=${hd.s}`)

// ── B. REST ghi bằng vé ──
const writes = [
  ['INSERT SystemSetting', 'SystemSetting', 'POST', { key: 'qa_probe_40', value: {}, updated_at: new Date().toISOString() }],
  ['UPDATE Employee', 'Employee?id=eq.00000000-0000-0000-0000-000000000000', 'PATCH', { password: 'x' }],
  ['UPSERT InventoryEntry', 'InventoryEntry?on_conflict=id', 'POST', { id: '00000000-0000-0000-0000-000000000000', cartons_remaining: 0 }],
]
for (const [name, path, method, body] of writes) {
  const x = await hit(`${URL_}/rest/v1/${path}`, { method, headers: { ...H(TICKET), Prefer: 'return=representation,resolution=merge-duplicates' }, body: JSON.stringify(body) })
  check(`REST ghi bằng vé bị từ chối: ${name}`, x.s >= 400, `http=${x.s} ${x.json?.code ?? ''}`)
}

// ── C. RPC: hàm ĐỌC nặng + hàm GHI nghiệp vụ, gọi đủ tham số null để hàm thực sự chạy nếu được phép ──
const RPCS = {
  lot_trace: ['p_kind', 'p_value', 'p_prod_from', 'p_prod_to', 'p_ship_from', 'p_ship_to', 'p_wh_ids', 'p_categories', 'p_limit', 'p_codes', 'p_cycle', 'p_machine', 'p_nmsx', 'p_pallet', 'p_material', 'p_batch', 'p_npp', 'p_trip', 'p_plate'],
  service_level: ['p_from', 'p_to', 'p_wh_ids', 'p_limit'],
  hr_employees_page: ['p_scope_ids', 'p_dept', 'p_jt_id', 'p_wh', 'p_search', 'p_active', 'p_incl_deleted', 'p_status', 'p_offset', 'p_limit'],
  warehouse_cost_vouchers: ['p_from', 'p_to', 'p_wh_ids', 'p_warehouse_id', 'p_search', 'p_page', 'p_page_size'],
  dashboard_all: ['p_warehouse_ids', 'p_categories', 'p_today'],
  fill_demand: ['p_wh_scope', 'p_cat_scope', 'p_warehouse_id', 'p_date', 'p_max_sugg'],
  try_book_slot: ['p_slot_id', 'p_delta'],
  book_vehicle_slot: ['p_vslot_id', 'p_new_slot_id', 'p_plate', 'p_status', 'p_actor'],
  adjust_inventory_atomic: ['p_entry_id', 'p_delta', 'p_note', 'p_actor_name', 'p_actor_id', 'p_stocktake_by', 'p_now', 'p_vn_date', 'p_updated_by'],
  fill_scan_apply: ['p_task_id', 'p_entry_id', 'p_to_location_id', 'p_actor_id', 'p_actor_name', 'p_take_over', 'p_update_date', 'p_now'],
  scan_insert_pallet: ['p_entry', 'p_location_id', 'p_stack_layer', 'p_max_materials'],
  rest_exposure: [], realtime_readiness: [], secdef_public_grants: [],
}
for (const [label, tok] of ROLES) {
  const res = await pool(Object.entries(RPCS).map(([fn, args]) => async () => {
    const x = await hit(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H(tok), body: JSON.stringify(Object.fromEntries(args.map(a => [a, null]))) })
    return { fn, s: x.s, code: x.json?.code }
  }), 6)
  const ran = res.filter(x => x.s < 300)
  check(`RPC ${label}: 0/${res.length} hàm chạy được (đọc nặng + ghi nghiệp vụ + hàm QA)`, ran.length === 0, ran.length ? `CHẠY ĐƯỢC: ${ran.map(x => x.fn).join(', ')}` : `mã từ chối: ${[...new Set(res.map(x => `${x.s}/${x.code ?? '-'}`))].join(' ')}`)
}

// ── D/E. GraphQL + OpenAPI ──
for (const [label, tok] of ROLES) {
  const q = await hit(`${URL_}/graphql/v1`, { method: 'POST', headers: H(tok), body: JSON.stringify({ query: '{ __schema { queryType { fields { name } } } }' }) })
  const fields = (q.json?.data?.__schema?.queryType?.fields || []).map(f => f.name).filter(f => /Collection$/.test(f))
  check(`GraphQL ${label}: không lộ collection bảng nào`, fields.length === 0, fields.length ? fields.slice(0, 5).join(', ') : `http=${q.s} ${(q.json?.errors?.[0]?.message ?? '').slice(0, 50)}`)
  const o = await hit(`${URL_}/rest/v1/`, { headers: H(tok) })
  const paths = Object.keys(o.json?.paths || {}).filter(p => p !== '/')
  check(`OpenAPI ${label}: không liệt kê bảng`, paths.length === 0, `http=${o.s} paths=${paths.length}`)
}

// ── F. Storage ──
const buckets = await restAll('buckets', 'select=id,public', 50).catch(() => null)   // schema storage không expose qua PostgREST → null là bình thường
for (const [label, tok] of ROLES) {
  const b = await hit(`${URL_}/storage/v1/bucket`, { headers: H(tok) })
  check(`Storage ${label}: không liệt kê được bucket`, !(b.s < 300 && Array.isArray(b.json) && b.json.length), `http=${b.s} ${b.text.slice(0, 40)}`)
  const l = await hit(`${URL_}/storage/v1/object/list/forklift-photos`, { method: 'POST', headers: H(tok), body: JSON.stringify({ prefix: '', limit: 10 }) })
  check(`Storage ${label}: không liệt kê được object`, !(l.s < 300 && Array.isArray(l.json) && l.json.length), `http=${l.s} ${l.text.slice(0, 40)}`)
}
void buckets

// ── G. Auth: người ngoài không tự mint được JWT authenticated ──
{
  const mail = `qa-suite-probe-${Date.now()}@example.invalid`
  const su = await hit(`${URL_}/auth/v1/signup`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail, password: `Qa!${Date.now()}xyzXYZ` }) })
  const id = su.json?.user?.id || su.json?.id
  check('Supabase Auth: đăng ký email bị tắt', !id && !su.json?.access_token, `http=${su.s} ${(su.json?.msg || su.json?.error_description || su.json?.message || '').slice(0, 60)}`)
  const an = await hit(`${URL_}/auth/v1/signup`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: '{}' })
  check('Supabase Auth: đăng nhập ẩn danh bị tắt', !an.json?.user?.id, `http=${an.s} ${(an.json?.msg || an.json?.error_description || an.json?.message || '').slice(0, 60)}`)
  for (const uid of [id, an.json?.user?.id].filter(Boolean)) {
    const { SUPABASE_SERVICE_ROLE_KEY: SVC } = Object.fromEntries((await import('fs')).readFileSync(join(ROOT, 'backend', '.env'), 'utf8').split(/\r?\n/).map(l => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/)).filter(Boolean).map(m => [m[1], m[2]]))
    await hit(`${URL_}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } })
  }
}

// ── H. Token giả ──
{
  const b64 = s => Buffer.from(s).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const pl = b64(JSON.stringify({ role: 'service_role', aud: 'authenticated', iat: now, exp: now + 3600 }))
  const none = `${b64(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${pl}.`
  const hdr = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const wrong = `${hdr}.${pl}.${createHmac('sha256', ANON).update(`${hdr}.${pl}`).digest('base64url')}`
  for (const [name, tok] of [['alg=none', none], ['ký sai khoá (role=service_role)', wrong]]) {
    const x = await hit(`${URL_}/rest/v1/Employee?select=id&limit=1`, { headers: H(tok) })
    check(`Token giả ${name} → 401`, x.s === 401, `http=${x.s}`)
  }
}

// ── I. Realtime (cần @supabase/supabase-js trong frontend/node_modules — thiếu thì báo skip) ──
let createClient = null
try { ({ createClient } = createRequire(join(ROOT, 'frontend', '/'))('@supabase/supabase-js')) } catch { /* chưa npm install frontend */ }
if (!createClient) console.log('  ⏭  frontend/node_modules chưa có @supabase/supabase-js — bỏ qua phần Realtime (npm ci trong frontend để đo)')
else {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const join_ = (client, topic, sink, priv = true) => new Promise(resolve => {
    const t = setTimeout(() => resolve({ status: 'TIMEOUT' }), 12000)
    const ch = client.channel(topic, { config: { private: priv } })
      .on('broadcast', { event: 'db_change' }, ({ payload }) => sink.push(payload))
      .subscribe((s, e) => { if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { clearTimeout(t); resolve({ status: s + (e?.message ? ` (${e.message.slice(0, 60)})` : ''), ch }) } })
  })
  const A = createClient(URL_, ANON); A.realtime.setAuth(TICKET)
  const C = createClient(URL_, ANON); C.realtime.setAuth(TICKET)
  const B = createClient(URL_, ANON)
  const gotA = [], gotC = [], gotB = [], gotPC = []
  const jA = await join_(A, 'wms-db-changes', gotA); check('Realtime: vé vào kênh chung', jA.status.startsWith('SUBSCRIBED'), jA.status)
  await join_(C, 'wms-db-changes', gotC)
  const jO = await join_(A, 'wms-user-00000000-0000-0000-0000-000000000001', []); check('Realtime: kênh cá nhân người khác bị chặn', !jO.status.startsWith('SUBSCRIBED'), jO.status)
  const jB = await join_(B, 'wms-db-changes', gotB); check('Realtime: anon bị chặn khỏi kênh chung', !jB.status.startsWith('SUBSCRIBED'), jB.status)
  await new Promise(resolve => { const t = setTimeout(() => resolve(), 8000); B.channel('qa40-pc').on('postgres_changes', { event: '*', schema: 'public' }, p => gotPC.push(p)).subscribe(s => { if (s !== 'CLOSED') { clearTimeout(t); resolve() } }) })
  // giả mạo tín hiệu từ vé → máy C không được nhận
  if (jA.ch) await jA.ch.send({ type: 'broadcast', event: 'db_change', payload: { table: 'InventoryEntry', op: 'UPDATE', qa_spoof: true } }).catch(() => {})
  // kích trigger thật: PATCH no-op SystemSetting bằng service key (đường backend)
  const cur = await restAll('SystemSetting', 'select=key,value&key=eq.dashboard_cache_seconds', 5)
  if (cur[0]) await restWrite('SystemSetting', 'PATCH', 'key=eq.dashboard_cache_seconds', { value: cur[0].value })
  await sleep(4000)
  check('Realtime: vé KHÔNG giả mạo được tín hiệu (máy khác không nhận tin giả)', !gotC.some(m => m?.qa_spoof) && !gotA.some(m => m?.qa_spoof))
  check('Realtime: tín hiệu thật {table, op} tới kênh chung sau khi DB đổi', gotA.some(m => m?.table === 'SystemSetting' && m?.op === 'UPDATE'), `A nhận ${gotA.length} · C nhận ${gotC.length}`)
  check('Realtime: payload chỉ trường kỹ thuật', [...new Set([...gotA, ...gotC].flatMap(m => Object.keys(m ?? {})))].every(k => ['id', 'table', 'op', 'row_id', 'booked_count', 'qa_spoof'].includes(k)))
  check('Realtime: anon nhận 0 tin, postgres_changes nhận 0 sự kiện', gotB.length === 0 && gotPC.length === 0, `anon=${gotB.length} pc=${gotPC.length}`)
  for (const c of [A, B, C]) c.realtime.disconnect()
}
finish('EXPOSURE-LIVE')
