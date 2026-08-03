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
  // Ngày xuất của chuyến SAP là dữ liệu BỊ ĐỘNG (user chốt 02/08): ô tích "chuyển ngày hàng loạt"
  // trên list Xuất phải loại chuyến SAP NGAY TỪ FE (BE đã chặn 422, nhưng để user tick rồi mới
  // báo lỗi là trải nghiệm sai). Quay lại `gdo.status === 'PENDING'` trần = mở lại cửa đó.
  {
    key: 'outbound_movedate_checkbox_ignores_origin',
    label: 'ô tích Chuyển ngày (list Xuất) bỏ qua origin — phải dùng canMoveDateOf để loại chuyến SAP',
    count: (s) => countMatches(['frontend/src/pages/wms/Outbound.tsx'], ['.tsx'],
      l => /checkable=\{canEditGdo && gdo\.status === 'PENDING'\}/.test(l), s),
  },
  // Kế hoạch xuất bị xóa ⇒ chuyến NGỪNG HOẠT ĐỘNG, KHÔNG xóa (user chốt 03/08: "chuyến hàng đó bên
  // Xuất sẽ không bị xóa mà vào trạng thái không hoạt động, chỉ xem được info — từ đó xem được lịch sử").
  // Nhánh emptyGcs của replanKhvcGroups từng DELETE thẳng GroupDeliveryOrder; quay lại là mất vết vĩnh viễn.
  {
    key: 'replan_hard_deletes_gdo',
    label: 'replan XÓA CỨNG chuyến khi kế hoạch hết dòng — phải đánh dấu plan_dropped (giữ chuyến để tra lịch sử)',
    count: (s) => countMatches(['backend/src/controllers/wms/outboundController.ts'], ['.ts'],
      l => /from\('GroupDeliveryOrder'\)\s*\.delete\(\)\s*\.eq\('id', g\.id\)/.test(l), s),
  },
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
    key: 'gdo_category_exact_match',
    label: 'so khớp NGUYÊN CHUỖI Loại kho của CHUYẾN (GroupDeliveryOrder) trong migration — chuyến chở lẫn ' +
           'lưu "FG01+PM01" nên `g.warehouse_type = ANY(...)` ẨN MẤT chuyến với mọi user có scope loại ' +
           '(bug 30/07: 67/122 chuyến biến mất). RPC mới phải dùng `wt_cats(g.warehouse_type) && mảng`. ' +
           'Baseline = số lần còn trong các migration CŨ (file lịch sử, không sửa) — chỉ cấm TĂNG',
    count: (s) => countMatches(['backend/migrations'], ['.sql'],
      l => /\b(g|gd)\.warehouse_type\s*=\s*any\s*\(/i.test(l), s),
  },
  // Lý do chuyến KHÔNG thao tác được phải hiện trên MỌI cỡ màn. Công nhân dùng điện thoại/PDA là
  // chính; khối `orderInfoJSX` của trang chi tiết Xuất chỉ hiện từ `sm:` trở lên, nên nhét banner
  // giải thích vào đó = trên điện thoại chỉ thấy nút mờ, không biết vì sao (đã sửa 02/08 cho rule
  // cổng/cân, tái phạm 03/08 với banner "chờ dữ liệu SAP" — bắt ở đợt kiểm vòng 2).
  {
    key: 'inert_banner_desktop_only',
    label: 'banner lý do chuyến bất động nằm trong khối chỉ-hiện-desktop (orderInfoJSX) — mobile mất lý do',
    count: (s) => countInertBannerInDesktopOnly(s),
  },
  // Ô TÌM CHẾT: khai state `search` trong store + viết logic lọc nhưng QUÊN render `<SearchInput>`
  // → user không có chỗ gõ, filter vĩnh viễn rỗng, và lỗi này KHÔNG lộ ra ở tsc/build vì mọi biến
  // đều "được dùng". Bắt thật 03/08: tab Chuyển kho có tSearch + lọc mà không có ô input nào.
  {
    key: 'search_state_without_input',
    label: 'trang khai state tìm (const x = <filter>.search) nhiều hơn số ô <SearchInput> render — ô tìm chết, user không có chỗ gõ',
    count: (s) => countDeadSearchState(s),
  },
  // MÃ LOẠI KHO VIẾT CỨNG: taxonomy Loại kho là DỮ LIỆU (LookupValue, mỗi đơn vị mỗi bộ) — luật
  // multi-tenant trong CLAUDE.md: "hành vi mới theo loại = thêm key meta, KHÔNG if tên loại".
  // Viết `=== 'FG01'` vào logic là khoá app vào 1 đơn vị. Bỏ qua dòng comment; baseline hiện tại là
  // dòng VÍ DỤ trong mẫu Excel tải về (dữ liệu mẫu, không phải logic).
  {
    key: 'hardcoded_warehouse_type_code',
    label: 'mã Loại kho viết CỨNG trong code (FG0x/PM0x/RM0x/PK0x) — phải đọc từ danh mục LookupValue, không so tên loại',
    count: (s) => countMatches(['backend/src', 'frontend/src'], ['.ts', '.tsx'],
      (line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && /['"](FG0\d|PM0\d|RM0\d|PK0\d)['"]/.test(line), s),
  },
  {
    key: 'upload_without_preflight',
    label: 'route upload file KHÔNG có "kiểm trước khi ghi" — mọi upload phải chèn `isPreflight(req)` giữa pha kiểm và pha ghi ' +
           '(utils/uploadPreflight; chuẩn user chốt 29/07: xem vấn đề của file + bấm Xác nhận mới ghi)',
    count: (s) => countUploadsMissingPreflight(s),
  },
]

// Đếm số lần `inertReason` xuất hiện BÊN TRONG khai báo `const orderInfoJSX = (…)` của trang chi
// tiết Xuất (khối đó bọc `hidden sm:block` nên mobile không thấy). Banner phải render ngoài khối.
function countInertBannerInDesktopOnly(sampleOut) {
  const f = 'frontend/src/pages/wms/OutboundDetail.tsx'
  let src = ''
  try { src = readFileSync(join(ROOT, f), 'utf8') } catch { return 0 }
  const lines = src.split(/\r?\n/)
  const start = lines.findIndex(l => /const orderInfoJSX\s*=\s*\(/.test(l))
  if (start < 0) return 0
  let n = 0
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s{0,2}\)\s*$/.test(lines[i])) break            // hết khối JSX
    if (lines[i].includes('inertReason')) {
      n++
      if (sampleOut && sampleOut.length < 5) sampleOut.push(`${f}:${i + 1}: ${lines[i].trim().slice(0, 100)}`)
    }
  }
  return n
}

// Mỗi state tìm lấy từ filter store (`const search = tf.search`) phải có 1 ô `<SearchInput` tương
// ứng trong CÙNG file. Thiếu = ô tìm chết (state + logic lọc có, chỗ gõ không có).
function countDeadSearchState(sampleOut) {
  let miss = 0
  for (const f of filesOf('frontend/src/pages', ['.tsx'])) {
    const src = readFileSync(f, 'utf8')
    const declared = [...src.matchAll(/const\s+\w+\s*=\s*\w+\.search\b/g)].length
    if (!declared) continue
    const rendered = [...src.matchAll(/<SearchInput\b/g)].length
    if (rendered < declared) {
      miss += declared - rendered
      if (sampleOut && sampleOut.length < 5)
        sampleOut.push(`${f.slice(ROOT.length + 1)} — khai ${declared} state tìm nhưng chỉ render ${rendered} ô SearchInput`)
    }
  }
  return miss
}

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
