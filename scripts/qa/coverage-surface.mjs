/**
 * BỀ MẶT APP ĐỌC TỪ CODE → đối chiếu với bộ QA → route/quyền nào CHƯA phép kiểm nào chạm.
 *
 * VÌ SAO CÓ FILE NÀY (07/09): bộ QA lớn lên theo TỪNG BUG ĐÃ GẶP, không theo bề mặt thật của app —
 * nên 47 gói xanh tuyệt đối mà vẫn để lọt 146/389 route. Không có thước đo thì không ai biết mình
 * đang không kiểm cái gì; "cảm giác đã phủ đủ" luôn lạc quan hơn sự thật.
 *
 * Không dựa trí nhớ: route đọc từ `backend/src/routes/*.ts` (quét ngoặc cân bằng), quyền đọc từ
 * `frontend/src/config/permissions.ts`, lời gọi đọc từ `scripts/qa/*.mjs`.
 *
 * ⚠️ Thước này có xu hướng BÁO THIẾU, và đã tự chứng minh điều đó: bản đầu chỉ nhận lời gọi dạng
 * `api(...)` nên bỏ qua toàn bộ gói 50 (gọi qua helper `A(...)`) và báo oan 26 route TMS. Đọc số ở
 * đây xong PHẢI kiểm chéo bằng `grep` tên route trong `scripts/qa/` trước khi kết luận là trống.
 *
 * usage: node scripts/qa/coverage-surface.mjs            (thêm QA_SIM_DIR=<đường dẫn> nếu muốn tính
 *                                                         cả script mô phỏng nằm ngoài repo)
 */
import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '')
const SP = process.env.QA_SIM_DIR ?? ''   // thư mục mô phỏng ngoài repo (tuỳ chọn)
const MOUNT = { auth: '/auth', masterdata: '/masterdata', wms: '/wms', tms: '/tms', hr: '/hr', external: '/external', notify: '/notify', integration: '/integration' }

// ── 1. ROUTES ──────────────────────────────────────────────────────────────────
function parseRoutes(file, prefix) {
  const src = readFileSync(file, 'utf8')
  const out = []
  const re = /\brouter\.(get|post|put|patch|delete)\s*\(/g
  let m
  while ((m = re.exec(src))) {
    // quét tới dấu ) cân bằng
    let i = m.index + m[0].length, depth = 1, inStr = null
    for (; i < src.length && depth > 0; i++) {
      const c = src[i]
      if (inStr) { if (c === '\\') { i++; continue } if (c === inStr) inStr = null; continue }
      if (c === "'" || c === '"' || c === '`') { inStr = c; continue }
      if (c === '(') depth++
      else if (c === ')') depth--
    }
    const call = src.slice(m.index + m[0].length, i - 1)
    const pathM = call.match(/^\s*['"`]([^'"`]+)['"`]/)
    if (!pathM) continue
    const perms = []
    for (const p of call.matchAll(/requirePerm\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)) perms.push(`${p[1]}.${p[2]}`)
    for (const any of call.matchAll(/requireAnyPerm\(([\s\S]*?)\)\s*,/g)) {
      for (const p of any[1].matchAll(/\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g)) perms.push(`${p[1]}.${p[2]}`)
    }
    const handlerM = call.match(/([A-Za-z_]\w*\.[A-Za-z_]\w*)\s*$/)
    const line = src.slice(0, m.index).split('\n').length
    out.push({ method: m[1].toUpperCase(), path: prefix + pathM[1], perms, handler: handlerM ? handlerM[1] : '(inline)', file: file.split('/').pop(), line })
  }
  return out
}
const routes = []
for (const [name, prefix] of Object.entries(MOUNT)) routes.push(...parseRoutes(`${REPO}/backend/src/routes/${name}.ts`, prefix))

// ── 2. LỜI GỌI TRONG TEST ──────────────────────────────────────────────────────
function listFiles(dir, pred) { try { return readdirSync(dir).filter(pred).map(f => join(dir, f)) } catch { return [] } }
const testFiles = [
  ...listFiles(`${REPO}/scripts/qa`, f => f.endsWith('.mjs') && f !== 'lib.mjs' && f !== 'run-all.mjs'),
  ...listFiles(`${SP}/simday`, f => f.endsWith('.mjs')),
]
const PREFIX_RE = '(?:/api)?(/(?:wms|masterdata|tms|hr|auth|external|notify|integration)/[^\'"`\\s?]*)'
const calls = [] // {method, path, file}
for (const f of testFiles) {
  const src = readFileSync(f, 'utf8')
  const short = f.split(/[\\/]/).pop()
  // <hàm bất kỳ>('/path', 'METHOD') — KHÔNG chỉ `api(`: gói 50 gọi qua helper `A(path,'POST')` nên
  // bản đầu bỏ qua toàn bộ lời gọi GHI của nó và báo 26 route TMS "chưa chạm" dù chúng có test.
  // Không có method chữ hoa ngay sau path: helper tên `upload*` gửi multipart = POST; còn lại mặc định GET
  // (`api(path)` không method = GET). Trước 07/09 mọi lời gọi thiếu method đều ghi GET nên 6 cửa upload đã
  // có gói 38/49/52 phủ vẫn bị báo "chưa chạm" — thước báo THIẾU thì còn đỡ, nhưng thiếu oan 6/389 là 1,5%.
  for (const m of src.matchAll(new RegExp("\\b([A-Za-z_$][\\w$]*)\\(\\s*['\"`]" + PREFIX_RE + "[^'\"`]*['\"`]\\s*(?:,\\s*'([A-Z]+)')?", 'g'))) {
    calls.push({ method: m[3] || (/upload/i.test(m[1]) ? 'POST' : 'GET'), path: m[2], file: short })
  }
  // rawFetch('/path', { method: 'X' })  /  fetch(`${BASE}/api/path`, { method: 'X' })
  for (const m of src.matchAll(new RegExp("(?:rawFetch|fetch)\\(\\s*['\"`](?:\\$\\{BASE\\})?" + PREFIX_RE + "[^'\"`]*['\"`]\\s*,\\s*\\{[^}]*?method:\\s*'([A-Z]+)'", 'g'))) {
    calls.push({ method: m[2] || 'GET', path: m[1], file: short })
  }
  // mọi literal còn lại (fallback, method không rõ → GET)
  for (const m of src.matchAll(new RegExp("['\"`]" + PREFIX_RE, 'g'))) {
    calls.push({ method: '?', path: m[1], file: short })
  }
}
const normSeg = s => s.replace(/\$\{[^}]*\}/g, '*').replace(/\?.*$/, '')
function matches(route, call) {
  if (call.method !== '?' && call.method !== route.method) return false
  // literal trần không rõ method chỉ khớp GET — trừ route `…/upload*` (bản chất là POST multipart; gói 38 giữ
  // danh sách cửa upload trong một mảng literal rồi bắn POST từng cái)
  if (call.method === '?' && route.method !== 'GET' && !(route.method === 'POST' && /\/upload/.test(route.path))) return false
  const rs = route.path.split('/').filter(Boolean), cs = normSeg(call.path).split('/').filter(Boolean)
  if (rs.length !== cs.length) return false
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i], c = cs[i]
    if (r.startsWith(':')) continue
    if (c === '*' || c.includes('*')) continue
    if (r !== c) return false
  }
  return true
}
for (const r of routes) {
  const hits = calls.filter(c => matches(r, c))
  r.hitBy = [...new Set(hits.map(h => h.file))]
}

// ── 3. ACTIONS (FE MODULES) ────────────────────────────────────────────────────
const permSrc = readFileSync(`${REPO}/frontend/src/config/permissions.ts`, 'utf8')
const modBlock = permSrc.slice(permSrc.indexOf('export const MODULES'), permSrc.indexOf('} as const'))
const actions = []
let curMod = null
for (const line of modBlock.split('\n')) {
  const mm = line.match(/^\s{2}(\w+):\s*\{/)
  if (mm) { curMod = mm[1]; continue }
  const am = line.match(/^\s{6}(\w+):\s*'/)
  if (am && curMod) actions.push({ key: `${curMod}.${am[1]}`, module: curMod, action: am[1] })
}
for (const a of actions) {
  a.routes = routes.filter(r => r.perms.includes(a.key))
  a.covered = a.routes.some(r => r.hitBy.length)
  a.noRoute = a.routes.length === 0
}

// ── 4. FE ROUTES ───────────────────────────────────────────────────────────────
const appSrc = readFileSync(`${REPO}/frontend/src/App.tsx`, 'utf8')
const feRoutes = [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1])

// ── 5. BÁO CÁO ─────────────────────────────────────────────────────────────────
const uncovered = routes.filter(r => !r.hitBy.length)
const byFile = {}
for (const r of uncovered) (byFile[r.file] ??= []).push(r)
console.log(`ROUTES BE: ${routes.length} · đã có test chạm: ${routes.length - uncovered.length} · CHƯA: ${uncovered.length}`)
for (const [f, rs] of Object.entries(byFile)) {
  console.log(`\n── ${f} (${rs.length} route chưa chạm) ──`)
  for (const r of rs) console.log(`  ${r.method.padEnd(6)} ${r.path.padEnd(58)} ${r.perms.join('|').padEnd(46)} ${r.handler}`)
}
const actUncov = actions.filter(a => !a.covered)
console.log(`\nACTIONS: ${actions.length} · phủ: ${actions.length - actUncov.length} · CHƯA phủ: ${actUncov.length} (trong đó không có route BE nào gate: ${actUncov.filter(a => a.noRoute).length})`)
for (const a of actUncov) console.log(`  ${a.key.padEnd(36)} ${a.noRoute ? '(FE-only / không route gate)' : a.routes.map(r => `${r.method} ${r.path}`).join(' · ')}`)
console.log(`\nFE ROUTES: ${feRoutes.length}`)
// Chỉ đổ JSON khi có chỗ để đổ — không có QA_SIM_DIR thì đừng ghi bừa ra gốc ổ đĩa.
if (SP) writeFileSync(`${SP}/surface.json`, JSON.stringify({ routes, actions, feRoutes }, null, 1))

// ── 6. RATCHET ĐỘ PHỦ (11/09) — bộ QA lớn theo BỀ MẶT, không theo bug đã gặp ──────────────────────
// `--ratchet`: số route/quyền CHƯA phép kiểm nào chạm không được TĂNG so coverage-baseline.json.
// Thêm route mới mà không có gói QA gọi tới = đỏ ngay ở CI static (không cần server). Giảm được thì
// `--update-baseline` khoá lại. Thước này BÁO THIẾU (xem đầu file) nên đỏ = kiểm chéo bằng grep trước khi kết luận.
if (process.argv.includes('--ratchet') || process.argv.includes('--update-baseline')) {
  const BASE = `${REPO}/scripts/qa/coverage-baseline.json`
  const cur = { routes_uncovered: uncovered.length, actions_uncovered_with_route: actUncov.filter(a => !a.noRoute).length }
  let base = {}
  try { base = JSON.parse(readFileSync(BASE, 'utf8')) } catch { /* lần đầu */ }
  const GH = process.env.GITHUB_ACTIONS === 'true'
  let fail = 0
  console.log('\n── RATCHET ĐỘ PHỦ ──')
  for (const k of Object.keys(cur)) {
    if (base[k] === undefined) console.log(`  🆕 ${k}: ${cur[k]}`)
    else if (cur[k] > base[k]) {
      fail++
      const sample = k === 'routes_uncovered' ? uncovered.slice(0, 5).map(r => `${r.method} ${r.path}`) : actUncov.filter(a => !a.noRoute).slice(0, 5).map(a => a.key)
      console.log(`  ❌ ${k}: ${cur[k]} > baseline ${base[k]} — bề mặt MỚI chưa gói QA nào chạm: ${sample.join(' · ')}`)
      if (GH) console.log(`::error title=Độ phủ QA: ${k}::${cur[k]} > baseline ${base[k]} — ${sample.join(' ; ')}`)
    } else if (cur[k] < base[k]) console.log(`  📉 ${k}: ${cur[k]} < baseline ${base[k]} — chạy --update-baseline để khoá`)
    else console.log(`  ✅ ${k}: ${cur[k]} (= baseline)`)
  }
  if (process.argv.includes('--update-baseline') || Object.keys(base).length === 0) {
    writeFileSync(BASE, JSON.stringify(cur, null, 2) + '\n')
    console.log(`  💾 đã ghi baseline ${JSON.stringify(cur)}`)
  }
  console.log(`\n[COVERAGE-RATCHET] ${fail ? fail + ' ĐỎ' : 'XANH'}`)
  process.exitCode = fail ? 1 : 0
}
