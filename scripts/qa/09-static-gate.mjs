// GÓI 09 — CỔNG TĨNH (không cần server, không dependency — chạy được cả trong CI).
// Nguyên tắc RATCHET (bánh răng một chiều): mỗi luật có BASELINE trong static-baseline.json.
//   - Vi phạm TĂNG so với baseline → ĐỎ (code mới vi phạm luật đã chốt).
//   - Vi phạm GIẢM → nhắc hạ baseline (đã dọn được thì khoá thành quả, không cho phình lại).
// Nợ cũ không chặn (không ép mass-rewrite — CLAUDE.md cấm churn), nhưng KHÔNG được tăng thêm.
// usage: node scripts/qa/09-static-gate.mjs [--update-baseline]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'static-baseline.json')
const UPDATE = process.argv.includes('--update-baseline')

function* walk(dir, exts) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue
    if (statSync(p).isDirectory()) yield* walk(p, exts)
    else if (exts.some(e => name.endsWith(e))) yield p
  }
}
function countMatches(roots, exts, test, sampleOut) {
  let n = 0
  for (const root of roots) {
    for (const f of walk(join(ROOT, root), exts)) {
      const lines = readFileSync(f, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        if (test(line)) { n++; if (sampleOut && sampleOut.length < 5) sampleOut.push(`${f.slice(ROOT.length + 1)}:${i + 1}`) }
      })
    }
  }
  return n
}

// ── Các luật — mỗi luật là 1 phép đếm thuần văn bản, KHÔNG heuristics mờ (mờ = báo oan = bị tắt) ──
const RULES = [
  {
    key: 'as_any',
    label: '`as any` (BE+FE) — nợ cũ dọn dần khi đụng file, code MỚI cấm (CLAUDE.md)',
    count: (s) => countMatches(['backend/src', 'frontend/src'], ['.ts', '.tsx'], l => l.includes('as any'), s),
  },
  {
    key: 'split_comma_controllers',
    label: "tự `.split(',')` trong controller — phải dùng parseListParam (utils/httpQuery); bug 29/07: `?codes=` rỗng dump cả danh mục 2,5MB",
    count: (s) => countMatches(['backend/src/controllers'], ['.ts'], l => l.includes(".split(',')") && !l.includes('parseListParam'), s),
  },
  {
    key: 'tolocaledatestring_no_tz',
    label: 'toLocaleDateString thiếu timeZone — ngày lệch theo giờ MÁY, phải Asia/Ho_Chi_Minh (CLAUDE.md)',
    count: (s) => countMatches(['backend/src', 'frontend/src'], ['.ts', '.tsx'], l => l.includes('toLocaleDateString(') && !l.includes('timeZone'), s),
  },
  {
    key: 'band_label_thung_ton',
    label: `nhãn ô tổng cross-mã ghi "Thùng tồn"/"Tổng thùng" — phải QTY_CONVERTED_LABEL "SL (quy đổi)". Baseline 2 = cột per-MÃ ở OutboundDetail/LoosePickingDetail (tách Thùng/Hộp đúng luật base-unit, KHÔNG phải bug — đừng "dọn")`,
    count: (s) => countMatches(['frontend/src'], ['.tsx'], l => /label:\s*['"](Thùng tồn|Tổng thùng)['"]/.test(l), s),
  },
]

let baseline = {}
try { baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) } catch { /* lần đầu */ }

console.log('── GÓI STATIC-GATE (ratchet) ──')
let fail = 0
const next = {}
for (const r of RULES) {
  const samples = []
  const n = r.count(samples)
  next[r.key] = n
  const base = baseline[r.key]
  if (base === undefined) {
    console.log(`  🆕 ${r.key}: ${n} (chưa có baseline — sẽ ghi)`)
  } else if (n > base) {
    fail++
    console.log(`  ❌ ${r.key}: ${n} > baseline ${base} — CODE MỚI VI PHẠM: ${r.label}`)
    samples.forEach(x => console.log(`       ${x}`))
  } else if (n < base) {
    console.log(`  📉 ${r.key}: ${n} < baseline ${base} — đã dọn bớt, chạy --update-baseline để KHOÁ thành quả`)
  } else {
    console.log(`  ✅ ${r.key}: ${n} (= baseline)`)
  }
}

if (UPDATE || Object.keys(baseline).length === 0) {
  writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + '\n')
  console.log(`  💾 đã ghi baseline: ${JSON.stringify(next)}`)
}

console.log(`\n[STATIC-GATE] ${fail === 0 ? 'XANH' : fail + ' luật ĐỎ'}`)
process.exitCode = fail ? 1 : 0
