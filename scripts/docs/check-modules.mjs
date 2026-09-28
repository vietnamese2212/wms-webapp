// Kiểm bản đồ module (docs/modules/<key>.md, tách khỏi CLAUDE.md 28/09/2026). Không cần DB, chạy trong cổng tĩnh offline.
// Vì sao: chi tiết module rời khỏi CLAUDE.md thì chỗ GIAO THOA là chỗ dễ sót nhất — sửa module A mà không biết B đang đọc
// cùng dữ liệu. Mục "Giao thoa với" chỉ có ích khi nó ĐÚNG HAI CHIỀU và PHỦ ĐỦ mọi module có quyền:
//   (1) mọi module trong backend/src/config/permissions.ts có file docs/modules/<key>.md + một dòng ở bảng CLAUDE.md
//   (2) mọi file có khối <!-- giao-thoa:start/end -->
//   (3) A liệt kê B ⇒ B liệt kê A; liên kết trỏ tới file có thật
import { readFileSync, readdirSync, existsSync } from 'fs'

const perm = readFileSync('backend/src/config/permissions.ts', 'utf8')
const keys = [...perm.matchAll(/^\s+([a-z_]+):\s*\[/gm)].map(m => m[1])
const claude = readFileSync('CLAUDE.md', 'utf8')
const bad = []
const files = readdirSync('docs/modules').filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))

for (const k of keys) {
  if (!files.includes(k)) bad.push(`thiếu docs/modules/${k}.md (module có trong ALL_PERMISSIONS)`)
  if (!claude.includes(`| \`${k}\` |`)) bad.push(`CLAUDE.md thiếu dòng bảng cho \`${k}\``)
}
const rel = new Map()
for (const f of files) {
  const t = readFileSync(`docs/modules/${f}.md`, 'utf8')
  const m = t.match(/<!-- giao-thoa:start -->([\s\S]*?)<!-- giao-thoa:end -->/)
  if (!m) { bad.push(`${f}.md thiếu khối <!-- giao-thoa:start/end -->`); continue }
  const ks = [...m[1].matchAll(/\]\(([a-z_]+)\.md\)/g)].map(x => x[1])
  for (const k of ks) if (!existsSync(`docs/modules/${k}.md`)) bad.push(`${f}.md trỏ tới ${k}.md không tồn tại`)
  rel.set(f, new Set(ks))
}
for (const [a, set] of rel) for (const b of set) if (rel.has(b) && !rel.get(b).has(a)) bad.push(`giao thoa MỘT CHIỀU: ${a} → ${b} nhưng ${b}.md không liệt kê ${a}`)

if (bad.length) {
  for (const b of bad) console.log(`  ❌ ${b}`)
  if (process.env.GITHUB_ACTIONS === 'true') for (const b of bad) console.log(`::error::docs/modules: ${b}`)
  console.log(`\n[DOCS-MODULES] ĐỎ — ${bad.length} lỗi`)
  process.exitCode = 1
} else console.log(`[DOCS-MODULES] XANH — ${files.length} file module, ${keys.length} module có quyền, giao thoa hai chiều đủ`)
