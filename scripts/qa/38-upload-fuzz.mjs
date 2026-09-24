// GÓI UPLOAD-FUZZ (bug 31/08): file ÁC vào MỌI route nhận file — trước đó PNG đội lốt .xlsx
// làm 6/7 cửa upload nổ 500 thô (XLSX.read throw không ai đỡ). Nay mọi cửa đọc workbook qua
// readWorkbookSafe (utils/excelHeader) → hỏng là 400 BAD_EXCEL_MSG.
// Kỳ vọng: KHÔNG 5xx với: thiếu file · file rỗng · text rác · PNG đội lốt · excel 0 dòng ·
// sheet trống · sai cột + ô 32KB + số âm. Và KHÔNG ghi rác vào DB (soi tag SIMUPX).
import { login, BASE, restAll, restWrite, check, finish } from './lib.mjs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
const require2 = createRequire(new URL('../../backend/package.json', import.meta.url))
const XLSX = require2('xlsx')

const ROUTES = [
  '/masterdata/locations/upload', '/masterdata/materials/upload',
  '/wms/warehouse-costs/upload', '/wms/inventory/upload',
  '/wms/outbound/upload', '/wms/outbound/upload-vl06o', '/wms/outbound/upload-khvc',
]
const xbuf = (rows) => {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}
const BIG = 'X'.repeat(32_000)
const FILES = [
  ['rỗng 0 byte', Buffer.alloc(0)],
  ['text rác', Buffer.from('đây không phải excel '.repeat(80))],
  ['PNG đội lốt .xlsx', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4096, 7)])],
  ['0 dòng (header lạ)', xbuf([['cột lạ 1', 'cột lạ 2']])],
  ['sheet trống', xbuf([[]])],
  ['sai cột + ô 32KB + số âm', xbuf([['không phải cột thật', 'cột rác'], [BIG, -999999], ['SIMUPX' + Date.now(), 'NaN']])],
]

console.log(`── GÓI UPLOAD-FUZZ: ${ROUTES.length} route × ${FILES.length + 1} file ác ──`)
await login()
const r0 = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.QA_ADMIN_EMAIL || 'admin', password: process.env.QA_ADMIN_PASSWORD || 'Bavi1234' }) })
const TOKEN = (await r0.json())?.data?.token

const bad = []
for (const route of ROUTES) {
  {
    const fd = new FormData()
    fd.append('note', 'thiếu file')
    const r = await fetch(`${BASE}/api${route}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd })
    await r.text()
    if (r.status >= 500) bad.push(`${route} · THIẾU FILE → ${r.status}`)
  }
  for (const [label, buf] of FILES) {
    const fd = new FormData()
    fd.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'simup.xlsx')
    const r = await fetch(`${BASE}/api${route}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd })
    const t = await r.text()
    if (r.status >= 500) bad.push(`${route} · ${label} → ${r.status} · ${t.slice(0, 100)}`)
  }
}
check('[1] Không cửa upload nào 5xx với file ác', bad.length === 0,
  bad.length ? bad.slice(0, 4).join(' ‖ ') : `${ROUTES.length * (FILES.length + 1)} lượt sạch`)

const junk = []
for (const [t, f] of [
  ['Material', 'select=id&material_code=like.SIMUPX*'],
  ['Location', 'select=id&location_code=like.*SIMUPX*'],
  ['warehouse_costs', 'select=id&note=like.*SIMUPX*'],
]) { const rows = await restAll(t, f); if (rows.length) { junk.push(`${t}=${rows.length}`); await restWrite(t, 'DELETE', f.split('&')[1]).catch(() => {}) } }
check('[2] File ác không ghi được bản ghi rác nào', junk.length === 0, junk.join(' · ') || 'sạch')
finish('UPLOAD-FUZZ')
