// CHẠY CẢ BỘ: invariant → smoke → race → invariant (đối chiếu) → [scale nếu --scale] → invariant.
// Exit 0 = XANH (được phép merge main). Exit 1 = có FAIL.
// usage: node scripts/qa/run-all.mjs [--scale [N]]
import { spawnSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const DIR = dirname(fileURLToPath(import.meta.url))
const withScale = process.argv.includes('--scale')
const scaleN = process.argv[process.argv.indexOf('--scale') + 1]
const steps = [
  ['09-static-gate.mjs'],         // cổng tĩnh ratchet (không cần server) — rẻ nhất, fail nhanh nhất
  ['00-invariant.mjs'],
  ['01-smoke.mjs'],
  ['02-race.mjs'],
  ['04-qrformat.mjs'],            // test theo cờ HIỆN TẠI (không lật cờ — --flip chạy tay ngoài giờ)
  ['07-params-fuzz.mjs'],         // fuzz tham số rỗng/lạ mọi API list (read-only) — bắt 500/dump danh mục/quá 4MB
  ['08-perm-coverage.mjs'],       // FE⇄BE config khớp + action không ai được cấp (WARN; --strict mới FAIL)
  ['00-invariant.mjs'],           // sau race + qrformat phải vẫn sạch
  ...(withScale ? [['03-scale.mjs', ...(scaleN && !scaleN.startsWith('-') ? [scaleN] : [])], ['00-invariant.mjs']] : []),
]

const summary = []
for (const [file, ...args] of steps) {
  console.log(`\n════════ ${file} ${args.join(' ')} ════════`)
  const r = spawnSync(process.execPath, [join(DIR, file), ...args], { stdio: 'inherit' })
  summary.push({ file, ok: r.status === 0 })
  if (r.status !== 0 && file === '00-invariant.mjs' && summary.length === 1) {
    console.error('\n⛔ Invariant ĐỎ ngay từ đầu — DB staging đang bẩn, xử lý trước rồi hãy test tiếp.')
    process.exit(1)
  }
}

console.log('\n══════════ TỔNG KẾT ══════════')
for (const s of summary) console.log(`  ${s.ok ? '✅' : '❌'} ${s.file}`)
const fails = summary.filter(s => !s.ok).length
console.log(fails ? `\n⛔ ${fails} gói FAIL — KHÔNG merge main.` : '\n🟢 XANH toàn bộ — đủ điều kiện merge main.')
process.exit(fails ? 1 : 0)
