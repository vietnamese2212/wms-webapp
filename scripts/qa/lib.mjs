// Hạ tầng chung bộ QA regression — KHÔNG dependency ngoài (Node 18+, fetch native).
// API app qua Preview (dev) · soi DB staging qua PostgREST (key đọc từ backend/.env).
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// `||` chứ không `??`: trong CI, secret chưa khai đi vào env là CHUỖI RỖNG (không phải undefined)
// — `??` sẽ giữ chuỗi rỗng và login bằng tài khoản rỗng.
export const BASE = process.env.QA_BASE_URL
  || 'https://wms-webapp-git-dev-vietnamese2212s-projects.vercel.app'
const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL || 'admin'
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD || 'Bavi1234'   // tài khoản test STAGING

// ── Dữ liệu nền cố định của staging dùng cho test (đổi ở đây nếu staging thay data nền) ──
export const FIX = {
  WH_QTY:  { id: 'c36008f3-4f01-41a8-9538-3cce289837b0', code: '10010499', name: 'Bluestar' }, // kho QTY
  WH_NONE: { id: 'b9ef99ad-473d-4538-9e0a-95955a08b37e', code: '10000274', name: 'An Sơn' },   // kho NONE
  WH_QR:   { id: '56cf7a64-d3aa-4fd2-948d-490ec487acb9', code: '20000016', name: 'Kho Ba Vì' },// kho QR
  MAT_POOL: '510000306',   // mã có dòng tồn pool tại WH_QTY
  DVVT_TAG: 'QA-SUITE',    // mọi GDO test gắn dvvt này để nhận diện + dọn
  DATE: '2026-12-20',      // delivery_date test (tương lai xa, không đụng data thật) — CHỈ cho đơn nằm im (create/sửa/xóa PENDING)
  // Chuyến sẽ THỰC THI (start / quick-export / manual-complete) phải dùng NGÀY HÔM NAY —
  // luật 02/08: đơn Ngày xuất tương lai bị chặn 422 FUTURE_DATE ở mọi đường xuất.
  EXEC_DATE: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }),
}

// ── App API ──
let token = ''
export async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const j = await r.json()
  if (!j?.data?.token) throw new Error(`Login fail: ${r.status} ${JSON.stringify(j).slice(0, 200)}`)
  token = j.data.token
}
export async function api(path, method = 'GET', body) {
  // BASE UNIT (đợt 2): mọi body write gắn cờ qty_semantics='base' (BE chặn 409 payload thiếu cờ);
  // số lượng trong test = BASE (mã test QA không có entry unit → giá trị như cũ).
  const payload = body && typeof body === 'object' && !Array.isArray(body)
    ? { qty_semantics: 'base', ...body }
    : body
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: payload ? JSON.stringify(payload) : undefined,
  })
  let j = null, text = ''
  try { text = await r.text(); j = JSON.parse(text) } catch { /* body không phải JSON */ }
  return { s: r.status, j, bytes: text.length }
}

// ── PostgREST staging (read-only cho invariant) — key service role từ backend/.env ──
function readBackendEnv() {
  const out = {}
  try {
    for (const line of readFileSync(join(ROOT, 'backend', '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/)
      if (m) out[m[1]] = m[2]
    }
  } catch { /* thiếu .env → gói invariant sẽ tự báo */ }
  return out
}
const ENV = readBackendEnv()
export const HAS_DB = !!(ENV.SUPABASE_URL && ENV.SUPABASE_SERVICE_ROLE_KEY)

// Thử lại khi ĐỨT MẠNG (DNS/timeout/reset) — KHÔNG thử lại khi server trả lỗi HTTP.
// Lý do: lỗi mạng thoáng qua làm cổng QA ĐỎ OAN, mà đỏ oan thì cổng sẽ bị bỏ qua — nguy hiểm hơn
// là không có cổng. Ngược lại, 4xx/5xx của app là TÍN HIỆU THẬT, thử lại sẽ che mất.
async function fetchNetRetry(url, init, tries = 3) {
  for (let i = 0; ; i++) {
    try { return await fetch(url, init) }
    catch (e) {
      if (i >= tries - 1) throw e
      await new Promise(r => setTimeout(r, 400 * (i + 1) + Math.random() * 300))
    }
  }
}

// GET 1 trang PostgREST (limit/offset). filter = chuỗi query PostgREST.
async function restPage(table, filter, offset, limit) {
  const r = await fetchNetRetry(`${ENV.SUPABASE_URL}/rest/v1/${table}?${filter}&limit=${limit}&offset=${offset}`, {
    headers: { apikey: ENV.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}` },
  })
  if (!r.ok) throw new Error(`PostgREST ${table}: ${r.status} ${await r.text()}`)
  return r.json()
}
// Kéo ĐỦ mọi dòng (né cap-1000). maxRows = cầu chì an toàn cho staging.
export async function restAll(table, filter, maxRows = 50_000) {
  const out = []
  for (let off = 0; off < maxRows; off += 1000) {
    const page = await restPage(table, filter, off, 1000)
    out.push(...page)
    if (page.length < 1000) return out
  }
  console.warn(`  ⚠ ${table}: chạm cầu chì ${maxRows} dòng — kiểm tra có thể THIẾU (cần chuyển check này sang RPC)`)
  return out
}
// Ghi thẳng PostgREST (chỉ dùng để DỰNG/DỌN fixture test, không dùng cho logic nghiệp vụ)
export async function restWrite(table, method, filter, body) {
  const r = await fetchNetRetry(`${ENV.SUPABASE_URL}/rest/v1/${table}${filter ? "?" + filter : ""}`, {
    method,
    headers: {
      apikey: ENV.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`PostgREST ${method} ${table}: ${r.status} ${t}`)
  try { return JSON.parse(t) } catch { return [] }
}

/**
 * RESOLVE fixture theo MÃ/TÊN thay vì UUID cứng.
 *
 * Bài học 27/07: reset dữ liệu demo TRUNCATE Material + Location rồi upload lại → UUID mới,
 * mọi id hard-code trong QA chết ⇒ cổng QA đỏ vì FIXTURE, không phải vì code. Cổng gác mà tự
 * hỏng thì hoặc bị bỏ qua, hoặc chặn oan — cả hai đều nguy hiểm hơn là không có cổng.
 * ⇒ Fixture phải tự tìm lại theo khoá NGHIỆP VỤ (mã hàng, mã kho), không phải id.
 */
export async function resolveFixtures() {
  const mats = await restAll('Material', `select=id,material_code,category&material_code=eq.${FIX.MAT_POOL}`)
  if (!mats.length) throw new Error(`Fixture: không tìm thấy mã hàng ${FIX.MAT_POOL} — cập nhật FIX.MAT_POOL`)
  FIX.MAT_POOL_ID = mats[0].id
  FIX.MAT_POOL_CAT = mats[0].category

  // 1 vị trí ĐANG HOẠT ĐỘNG ở kho QR, nhận đúng loại hàng của mã test (hoặc chưa gán loại)
  const cat = FIX.MAT_POOL_CAT
  const locs = await restAll('Location',
    `select=id,location_code,categories&warehouse_id=eq.${FIX.WH_QR.id}&is_active=is.true&order=location_code&limit=200`)
  const hit = locs.find(l => !l.categories?.length || (cat && l.categories.includes(cat))) ?? locs[0]
  if (!hit) throw new Error(`Fixture: kho QR ${FIX.WH_QR.name} không có vị trí nào`)
  FIX.LOC_QR_ID = hit.id
  FIX.LOC_QR_CODE = hit.location_code
}

// Gọi thẳng 1 RPC (Postgres function) — dùng để kiểm ĐÚNG câu lọc dưới DB, không qua controller
export async function restRpc(fn, args = {}) {
  const r = await fetch(`${ENV.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ENV.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`RPC ${fn}: ${r.status} ${t}`)
  try { return JSON.parse(t) } catch { return null }
}

export function chunk(arr, n = 300) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// ── Khung report PASS/FAIL ──
const results = []
export function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}
export function finish(pack) {
  const fail = results.filter(r => !r.ok)
  console.log(`\n[${pack}] ${results.length - fail.length}/${results.length} PASS${fail.length ? ` — ${fail.length} FAIL` : ''}`)
  process.exit(fail.length ? 1 : 0)
}

// Chạy song song có giới hạn in-flight (mặc định 20 — an toàn max_connections=60)
export async function pool(tasks, limit = 20) {
  const out = []; let i = 0
  async function worker() { while (i < tasks.length) { const k = i++; out[k] = await tasks[k]() } }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return out
}

// Gỡ dây chuyền 1 GDO test về 0 rồi xóa (kèm lệnh chuyển kho cascade). Trả true nếu xóa được.
export async function teardownGdo(id, status) {
  if (status === 'COMPLETED') await api(`/wms/outbound/${id}/uncomplete`, 'POST')
  const d = await api(`/wms/outbound/${id}`, 'GET')
  const cur = d.j?.data
  if (!cur) return false
  if (cur.status !== 'PENDING') {
    for (const it of (cur.delivery_orders ?? []).flatMap(x => x.items))
      await api(`/wms/outbound/${id}/items/${it.id}/manual-complete`, 'POST', { cartons: 0 })
    const us = await api(`/wms/outbound/${id}/unstart`, 'POST')
    if (us.s !== 200) return false
  }
  return (await api(`/wms/outbound/${id}`, 'DELETE')).s === 200
}

// Dọn MỌI GDO gắn tag QA (an toàn: chỉ đụng dvvt = FIX.DVVT_TAG) — quét CẢ 2 cửa sổ ngày
// (DATE tương lai cho đơn nằm im + EXEC_DATE hôm nay cho chuyến đã thực thi)
export async function cleanupTagged() {
  let total = 0
  for (const d of [...new Set([FIX.DATE, FIX.EXEC_DATE])]) {
    const list = await api(`/wms/outbound?date_from=${d}&date_to=${d}`, 'GET')
    const gdos = (list.j?.data?.items ?? list.j?.data ?? []).filter(g => g.dvvt === FIX.DVVT_TAG)
    if (!gdos.length) continue
    const rs = await pool(gdos.map(g => () => teardownGdo(g.id, g.status)), 15)
    total += rs.filter(Boolean).length
  }
  return total
}
