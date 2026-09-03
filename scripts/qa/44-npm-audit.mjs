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
    if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|audit endpoint/i.test(r.stderr + r.stdout)) return { skip: `không tới được registry (${(r.stderr || '').trim().slice(0, 80)})` }
    return { error: (r.stderr || r.stdout || 'npm audit không trả JSON').slice(0, 300) }
  }
  const v = j.metadata.vulnerabilities
  const items = Object.entries(j.vulnerabilities ?? {}).filter(([, x]) => x.severity === 'high' || x.severity === 'critical')
    .map(([name, x]) => `${x.severity} ${name}${x.isDirect ? ' (trực tiếp)' : ''}${x.fixAvailable === true ? ' — có bản vá không phá vỡ' : ''}`)
  return { critical: v.critical, high: v.high, moderate: v.moderate, items }
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
