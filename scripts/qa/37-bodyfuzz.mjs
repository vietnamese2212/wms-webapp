// GÓI BODYFUZZ (bug 31/08 — 61 ca 5xx/14 endpoint trong MỘT lượt quét): bắn MỌI route write
// (POST/PUT/PATCH/DELETE, trích TỰ ĐỘNG từ backend/src/routes/*.ts nên route MỚI tự vào lưới)
// với 4 body ác: {} · "null" thô · [] · {"a":1}; mọi :param thay bằng uuid-zero.
// LUẬT: không bao giờ 5xx — id không tồn tại phải 404, body thiếu/sai kiểu phải 400.
// Gốc 61 ca cũ: update().eq(id).select().single() → 0 dòng → "Cannot coerce" 500 (10 controller).
// Cảnh báo phụ (không fail): POST không-:param mà trả 2xx với body {} — nghi tạo bản ghi rỗng.
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { login, rawFetch, check, finish } from './lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'src', 'routes')
const MOUNT = { 'wms.ts': '/wms', 'tms.ts': '/tms', 'masterdata.ts': '/masterdata', 'hr.ts': '/hr', 'external.ts': '/external', 'notify.ts': '/notify' }
const ZERO = '00000000-0000-0000-0000-000000000000'

const routes = []
for (const [file, mount] of Object.entries(MOUNT)) {
  const src = readFileSync(join(ROOT, file), 'utf8')
  for (const m of src.matchAll(/router\.(post|put|patch|delete)\s*\(\s*'([^']+)'/g)) {
    const [, method, path] = m
    if (/upload\.single|upload\.array/.test(src.slice(m.index, m.index + 400))) continue   // multipart: multer tự 400
    routes.push({ method: method.toUpperCase(), path: mount + path })
  }
}
console.log(`── GÓI BODYFUZZ: ${routes.length} route write × 4 body ác ──`)
await login()

const BODIES = [['{}', '{}'], ['null', 'null'], ['[]', '[]'], ['{"a":1}', '{"a":1}']]
const bad = []
const created = []   // POST không-:param trả 2xx với {} — nghi tạo rác
const queue = [...routes]
async function worker() {
  for (;;) {
    const r = queue.shift()
    if (!r) return
    const url = r.path.replace(/:[A-Za-z_]+/g, ZERO)
    for (const [label, body] of BODIES) {
      if (r.method === 'DELETE' && label !== '{}') continue
      try {
        const res = await rawFetch(url, { method: r.method, body })
        if (res.s >= 500) bad.push(`${r.method} ${r.path} · ${label} → ${res.s} · ${res.text.slice(0, 120)}`)
        if (r.method === 'POST' && !r.path.includes(':') && res.s < 300 && label === '{}') created.push(`${r.path} → ${res.s}`)
      } catch (e) { bad.push(`${r.method} ${r.path} · ${label} → NETERR ${String(e).slice(0, 80)}`) }
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker))
check('[1] Không route write nào 5xx với body ác / id không tồn tại', bad.length === 0,
  bad.length ? `${bad.length} ca — ${bad.slice(0, 5).join(' ‖ ')}` : `${routes.length} route sạch`)
if (created.length) console.log(`  ⚠️ POST trả 2xx với body {} (soi xem có tạo bản ghi rỗng): ${created.join(' · ')}`)
finish('BODYFUZZ')
