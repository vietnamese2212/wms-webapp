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
// roots = thư mục HOẶC đường dẫn file cụ thể (luật chỉ áp cho vài trang tổng gộp)
function filesOf(root, exts) {
  const p = join(ROOT, root)
  return statSync(p).isFile() ? [p] : [...walk(p, exts)]
}
function countMatches(roots, exts, test, sampleOut) {
  let n = 0
  for (const root of roots) {
    for (const f of filesOf(root, exts)) {
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
  {
    key: 'thung_unit_on_aggregate_pages',
    label: 'nhãn đơn vị "thùng" trên TRANG TỔNG GỘP CROSS-MÃ (Dashboard/Giám sát vận hành/Báo cáo nhập/Slotting) — ' +
           'ô & cột ở đây cộng cả mã KG/cái nên KHÔNG được gọi là "thùng" (bug 29/07: khối "Hàng nhập theo mã" ' +
           'hiện 2.816.800 "thùng" cho 22 pallet — thực chất là CÁI). Dùng QTY_CONVERTED_LABEL / in ĐVT theo dòng',
    count: (s) => countMatches(
      ['frontend/src/pages/Dashboard.tsx', 'frontend/src/pages/wms/ControlTower.tsx',
       'frontend/src/pages/tms/TMSReport.tsx', 'frontend/src/pages/wms/Slotting.tsx'],
      [''],   // đường dẫn FILE (không phải thư mục) — walk() nhận qua exts rỗng khớp mọi tên
      l => /\((thùng|Thùng)\)|>\s*Thùng\s*<|['"]Thùng['"]\s*[,:\]]|\{['"]Thùng['"]\}/.test(l), s),
  },
  {
    key: 'upload_without_preflight',
    label: 'route upload file KHÔNG có "kiểm trước khi ghi" — mọi upload phải chèn `isPreflight(req)` giữa pha kiểm và pha ghi ' +
           '(utils/uploadPreflight; chuẩn user chốt 29/07: xem vấn đề của file + bấm Xác nhận mới ghi)',
    count: (s) => countUploadsMissingPreflight(s),
  },
]

// Soi TỪNG route `upload.single('file'), <ns>.<fn>` → mở controller của <ns> → thân hàm <fn> có
// `isPreflight` không. Bắt được cả upload MỚI thêm sau này (không phải danh sách cứng).
function countUploadsMissingPreflight(sampleOut) {
  let miss = 0
  for (const routeFile of ['backend/src/routes/wms.ts', 'backend/src/routes/masterdata.ts', 'backend/src/routes/tms.ts', 'backend/src/routes/hr.ts']) {
    let src
    try { src = readFileSync(join(ROOT, routeFile), 'utf8') } catch { continue }
    // \s+ chứ không phải 1 space: masterdata.ts canh cột import bằng nhiều space
    const imports = new Map([...src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)'/g)].map(m => [m[1], m[2]]))
    for (const m of src.matchAll(/upload\.single\('file'\),\s*(\w+)\.(\w+)/g)) {
      const [, ns, fn] = m
      const rel = imports.get(ns)
      if (!rel) { miss++; sampleOut?.push(`${routeFile}: không tra được controller của "${ns}"`); continue }
      let ctrl
      try { ctrl = readFileSync(join(ROOT, 'backend/src/routes', rel + '.ts'), 'utf8') } catch { miss++; sampleOut?.push(`${routeFile}: không đọc được ${rel}`); continue }
      // thân hàm = từ "export async function fn(" tới "export " tiếp theo
      const start = ctrl.indexOf(`export async function ${fn}(`)
      if (start < 0) { miss++; sampleOut?.push(`${rel}: không thấy hàm ${fn}`); continue }
      const next = ctrl.indexOf('\nexport ', start + 10)
      const body = ctrl.slice(start, next < 0 ? undefined : next)
      // uploadKhvc gọi processVehicleGroups (hàm dùng chung) — nhánh preflight nằm ở đó, chấp nhận cả 2 dấu hiệu
      if (!/isPreflight\(/.test(body) && !/processVehicleGroups\(/.test(body)) {
        miss++
        if (sampleOut && sampleOut.length < 5) sampleOut.push(`${rel}.${fn} — thiếu isPreflight (route ${routeFile})`)
      }
    }
  }
  return miss
}

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
