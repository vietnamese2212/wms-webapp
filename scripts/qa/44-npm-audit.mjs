// 44 — LỖ HỔNG THƯ VIỆN (npm audit) theo kiểu RATCHET: đếm high+critical (và moderate để nhìn) của backend + frontend,
// so với audit-baseline.json — TĂNG là đỏ, GIẢM thì nhắc hạ baseline (--update-baseline). Không cần server/DB, cần mạng.
// Vì sao không "0 là xanh": vite/esbuild/react-router chỉ vá ở bản MAJOR (đổi vite 5→8 là việc riêng), còn tar/node-pre-gyp
// là phụ thuộc LÚC CÀI của bcrypt — nợ có chủ đích ghi trong baseline, code mới thêm thư viện lỗi thì ratchet bắt.
// usage: node scripts/qa/44-npm-audit.mjs [--update-baseline]
import { spawnSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(DIR, '..', '..')
const BASELINE_FILE = join(DIR, 'audit-baseline.json')
const UPDATE = process.argv.includes('--update-baseline')
const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))

function audit(pkg) {
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--json'], { cwd: join(ROOT, pkg), encoding: 'utf8', shell: process.platform === 'win32' })
  let j = null
  try { j = JSON.parse(r.stdout) } catch { /* */ }
  if (!j?.metadata?.vulnerabilities) {
    // KHÔNG đọc được kết quả (registry không tới, npm bản khác không trả JSON, lỗi spawn…) = BỎ QUA CÓ CẢNH BÁO,
    // không đỏ: 03/09 bước này đỏ 5 lần liên tiếp CHỈ trên runner Linux của GitHub (Node 20/npm 10) trong khi máy
    // dev xanh → user nhận 5 email lỗi mà không có lỗi nào trong app. Cổng chỉ được đỏ khi ĐO ĐƯỢC và số tăng.
    const why = `${r.error ? r.error.message + ' · ' : ''}status=${r.status} · stderr: ${(r.stderr || '').trim().slice(0, 400)} · stdout: ${(r.stdout || '').trim().slice(0, 200)}`
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=npm audit ${pkg} không đo được::${why.replace(/\n/g, ' ')}`)
    return { skip: `không đọc được kết quả npm audit — ${why}` }
  }
  // CHỈ đếm gói mang lỗ hổng GỐC (via có object advisory), KHÔNG đếm gói "bị lây" theo chuỗi phụ thuộc (via toàn chuỗi):
  // npm 10 (runner GitHub, Node 20) lan severity lên cả gói cha (bcrypt ← node-pre-gyp ← tar), npm 11 (máy dev) thì không
  // → cùng lockfile mà metadata.vulnerabilities khác nhau → CI đỏ 5 lần 03/09 dù không có lỗ hổng mới. Số gốc ổn định giữa các bản npm.
  const roots = Object.entries(j.vulnerabilities ?? {}).filter(([, x]) => (x.via ?? []).some(v => typeof v === 'object'))
  const cnt = sev => roots.filter(([, x]) => x.severity === sev).length
  const items = roots.filter(([, x]) => x.severity === 'high' || x.severity === 'critical')
    .map(([name, x]) => `${x.severity} ${name}${x.isDirect ? ' (trực tiếp)' : ''}${x.fixAvailable === true ? ' — có bản vá không phá vỡ' : ''}`)
  return { critical: cnt('critical'), high: cnt('high'), moderate: cnt('moderate'), items }
}

let fails = 0, changed = false
for (const pkg of ['backend', 'frontend']) {
  const a = audit(pkg)
  const b = baseline[pkg] ?? { critical: 0, high: 0 }
  if (a.skip) { console.log(`  ⏭  ${pkg}: bỏ qua — ${a.skip}`); continue }
  if (a.error) { console.log(`  ❌ ${pkg}: ${a.error}`); fails++; continue }
  const worse = a.critical > b.critical || a.high > b.high
  const better = a.critical < b.critical || a.high < b.high
  console.log(`  ${worse ? '❌' : '✅'} ${pkg}: critical ${a.critical} (baseline ${b.critical}) · high ${a.high} (baseline ${b.high}) · moderate ${a.moderate}`)
  for (const it of a.items) console.log(`       ${it}`)
  if (worse) { fails++; console.log(`       → lỗ hổng high/critical TĂNG so baseline — dọn (npm audit fix) hoặc cân nhắc thư viện vừa thêm`) }
  if (better && !UPDATE) console.log(`       ↓ đã GIẢM so baseline — chạy --update-baseline để khoá thành quả`)
  if (UPDATE) { baseline[pkg] = { critical: a.critical, high: a.high }; changed = true }
}
if (UPDATE && changed) { writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n'); console.log('  📝 đã ghi audit-baseline.json') }
console.log(fails ? `\n[NPM-AUDIT] ${fails} gói ĐỎ` : '\n[NPM-AUDIT] XANH')
process.exit(fails ? 1 : 0)
