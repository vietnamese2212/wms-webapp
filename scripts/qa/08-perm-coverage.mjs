// GÓI 08 — PHỦ PHÂN QUYỀN (read-only). 2 tầng:
//   1. FE `MODULES` vs BE `ALL_PERMISSIONS` phải KHỚP TUYỆT ĐỐI (luật CLAUDE.md: thiếu bên BE
//      → superadmin MẤT quyền đó; thiếu bên FE → admin không cấp được cho ai). Lệch = FAIL.
//   2. Action đã khai nhưng KHÔNG chức danh non-admin nào được cấp → nút "tàng hình" với toàn
//      bộ nhân viên (nghiệm thu 29/07: 5 quyền export mới, 13 chức danh xem được / 0 xuất được).
//      Mặc định WARN (cấp quyền là quyết định của quản trị); chạy `--strict` thì WARN cũng FAIL.
// Parse 2 file config bằng regex CÓ CHỦ ĐÍCH đơn giản — cấu trúc file là object literal phẳng;
// nếu format đổi tới mức regex hỏng, test sẽ báo 0 module = FAIL (không pass oan).
// usage: node scripts/qa/08-perm-coverage.mjs [--strict]
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { restAll, HAS_DB } from './lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const STRICT = process.argv.includes('--strict')
let pass = 0, fail = 0, warns = 0
const chk = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`) }
}
const warn = (label) => { warns++; console.log(`  ⚠️  ${label}`) }

// ── Action CHỦ ĐÍCH chỉ dành cho superadmin (không cấp cho chức danh nào là ĐÚNG thiết kế).
// Thêm vào đây phải kèm lý do — đây là danh sách ngoại lệ, không phải chỗ giấu cảnh báo.
const ADMIN_ONLY_INTENDED = new Set([
  // 'user_admin.manage_roles',  // ví dụ — hiện chưa chốt ngoại lệ nào
])

console.log(`── GÓI PERM-COVERAGE${STRICT ? ' (strict)' : ''} ──`)

// ── Parse BE ALL_PERMISSIONS ──
function parseBE() {
  const src = readFileSync(join(ROOT, 'backend/src/config/permissions.ts'), 'utf8')
  const body = src.split('ALL_PERMISSIONS')[1] ?? ''
  const out = {}
  for (const m of body.matchAll(/^\s*([a-z_]+):\s*\[([^\]]*)\]/gm)) {
    out[m[1]] = [...m[2].matchAll(/'([a-z_]+)'/g)].map(x => x[1])
  }
  return out
}
// ── Parse FE MODULES (actions: { key: 'label', ... }) ──
function parseFE() {
  const src = readFileSync(join(ROOT, 'frontend/src/config/permissions.ts'), 'utf8')
  const body = src.split(/export const MODULES/)[1]?.split(/\n}\s*(as const)?\s*\n/)[0] ?? ''
  const out = {}
  for (const m of body.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)) {
    const start = m.index
    const rest = body.slice(start)
    const actBlock = rest.match(/actions:\s*\{([\s\S]*?)\n\s{4}\}/)?.[1] ?? ''
    out[m[1]] = [...actBlock.matchAll(/^\s*([a-z_]+):\s*['"]/gm)].map(x => x[1])
  }
  return out
}

const BE = parseBE(), FE = parseFE()
chk(Object.keys(BE).length >= 20, `parse BE ALL_PERMISSIONS: ${Object.keys(BE).length} module`)
chk(Object.keys(FE).length >= 20, `parse FE MODULES: ${Object.keys(FE).length} module`)

// ── Tầng 1: FE ⇄ BE khớp ──
const diffs = []
for (const mod of new Set([...Object.keys(BE), ...Object.keys(FE)])) {
  const be = new Set(BE[mod] ?? []), fe = new Set(FE[mod] ?? [])
  for (const a of fe) if (!be.has(a)) diffs.push(`${mod}.${a} có ở FE, THIẾU ở BE (superadmin mất quyền)`)
  for (const a of be) if (!fe.has(a)) diffs.push(`${mod}.${a} có ở BE, THIẾU ở FE (không cấp được cho ai)`)
}
chk(diffs.length === 0, 'FE MODULES ⇄ BE ALL_PERMISSIONS khớp tuyệt đối',
  diffs.length ? diffs.slice(0, 6).join(' | ') : `${Object.values(BE).flat().length} action`)

// ── Tầng 2: action không ai được cấp (soi DB thật) ──
if (!HAS_DB) {
  warn('bỏ qua tầng 2 (không có key DB trong backend/.env)')
} else {
  const jts = await restAll('JobTitle', 'select=name,module_permissions&name=neq.Admin')
  const granted = new Set()
  for (const jt of jts) {
    const mp = jt.module_permissions ?? {}
    for (const [mod, acts] of Object.entries(mp)) {
      if (Array.isArray(acts)) for (const a of acts) granted.add(`${mod}.${a}`)
    }
  }
  const orphan = []
  for (const [mod, acts] of Object.entries(BE)) {
    for (const a of acts) {
      const key = `${mod}.${a}`
      if (!granted.has(key) && !ADMIN_ONLY_INTENDED.has(key)) orphan.push(key)
    }
  }
  if (orphan.length === 0) chk(true, `mọi action đều có ≥1 chức danh được cấp (soi ${jts.length} chức danh)`)
  else {
    const label = `${orphan.length} action KHÔNG chức danh nào được cấp → nút tàng hình với mọi nhân viên: ${orphan.join(', ')}`
    if (STRICT) chk(false, label)
    else warn(label + '  (cấp trong Quản lý người dùng → chức danh, hoặc khai ADMIN_ONLY_INTENDED kèm lý do)')
  }
}

console.log(`\n[PERM-COVERAGE] ${pass}/${pass + fail} PASS${warns ? ` · ${warns} cảnh báo` : ''}${fail ? ` · ${fail} FAIL` : ''}`)
// KHÔNG process.exit() ở đây: trên Windows, exit cưỡng bức ngay sau fetch HTTPS làm libuv assert
// (exit code 127 bẩn). Đặt exitCode rồi để event-loop tự cạn — socket undici đã unref, thoát sạch.
process.exitCode = fail ? 1 : 0
