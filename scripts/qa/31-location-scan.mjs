// GÓI 31 — QUÉT TEM VỊ TRÍ (user chốt 21/08: "tất cả chức năng liên quan tới chọn vị trí").
//
// Vì sao phải để MÁY canh: sai ở đây KHÔNG có triệu chứng trên màn hình. Cửa tra trả về một vị trí
// "trông rất hợp lệ" — chỉ là không phải cái ô người ta đang đứng trước. Pallet đi sai ô, hệ thống
// ghi đúng theo cái nó nhận, và chỉ vỡ ra lúc ai đó tới ô đó lấy hàng (có thể vài tuần sau).
//
// Phép kiểm (tự dựng fixture, tự dọn — chạy lúc nào cũng được):
//   [1] khớp TRỌN mã: quét `..._5_T1` KHÔNG được nhận `..._5_T10` (bẫy khớp-chứa)
//   [2] sai hoa/thường vẫn ra
//   [3] tem in KHÔNG DẤU vẫn ra đúng ô có dấu tiếng Việt
//   [4] đuôi CR/LF của súng PDA + dấu cách 2 đầu không làm trượt
//   [5] mã không có thật → 404 (không phải 500, không trả ô gần giống)
//   [6] chưa khai kho vẫn ra đúng ô (mã vị trí duy nhất toàn hệ thống)
//   [7] DB chặn 2 kho cùng một mã vị trí (unique) — nền để [6] không phải phép đoán
//   [8] ô NGƯNG sử dụng vẫn trả về kèm is_active=false (báo "ngưng dùng", không báo "không tìm thấy")
//   [9] trả kèm used_slots + khối putaway (màn quét nói cùng nhãn với picker)
//  [10] mã của kho NGOÀI scope → 404 (không rò vị trí kho khác)
//  [11] nguồn: normalizeLocScan BE↔FE khớp nhau từng dòng
//  [12] nguồn: mọi màn dùng hook vị trí đều có nút quét (mirror ratchet static-gate)
//  [13] nguồn: tem vị trí mã hoá NGUYÊN VĂN location_code (thêm ký tự = cửa tra không khớp trọn mã)
//  [14] nguồn: khoá độc quyền phát bắn còn trong useWedgeScanner (2 handler ăn 1 phát = sai âm thầm)
//  [15] nguồn: armWedge không được bật CỐ ĐỊNH (`armWedge` để trần / ={true}) — chặn cò súng của màn
//  [16] nguồn: MỌI nút quét dùng chung 1 symbol ScanIcon (user: "mỗi chỗ 1 icon là k đc")
// usage: node scripts/qa/31-location-scan.mjs
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { login, api, check, finish, restAll, restWrite } from './lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TAG = 'QA-LOCSCAN'
console.log('── GÓI LOCATION-SCAN ──')

const nowIso = () => new Date().toISOString()
const created = { locs: [] }

async function cleanup() {
  for (const id of created.locs) await restWrite('Location', 'DELETE', `id=eq.${id}`)
}
// Tàn dư của lần chạy hỏng giữa chừng
for (const o of await restAll('Location', `select=id&location_code=like.${TAG}*`)) {
  await restWrite('Location', 'DELETE', `id=eq.${o.id}`)
}

const resolve = (code, params = {}) => {
  const qs = new URLSearchParams({ code, ...params }).toString()
  return api(`/masterdata/locations/resolve?${qs}`)
}

await login()
try {
  // ── Fixture: 2 kho, mã trùng nhau + cặp bẫy T1/T10 + ô có dấu + ô ngưng dùng ──
  const whs = await restAll('Warehouse', 'select=id,name&order=name&limit=2')
  if (whs.length < 2) { check('có ≥2 kho để dựng fixture', false, `${whs.length} kho`); finish('LOCATION-SCAN') }
  const [whA, whB] = whs

  const mkLoc = async (code, wh, extra = {}) => {
    const [row] = await restWrite('Location', 'POST', null, {
      id: randomUUID(), location_code: code, warehouse_id: wh.id, max_pallets: 2,
      is_active: true, row: 'QA', shelf: '1', sub_code: `${TAG}-Z`,
      created_at: nowIso(), updated_at: nowIso(), ...extra,
    })
    created.locs.push(row.id)
    return row
  }
  const locT1   = await mkLoc(`${TAG}_5_T1`, whA)
  const locT10  = await mkLoc(`${TAG}_5_T10`, whA)
  const locDau  = await mkLoc(`${TAG}_NGOÀI ĐƯỜNG`, whA)
  const locOff  = await mkLoc(`${TAG}_NGUNG`, whA, { is_active: false })
  const locDupA = await mkLoc(`${TAG}_DUP`, whA)

  // [1] khớp TRỌN mã — cái bẫy chính của cả tính năng
  const r1 = await resolve(locT1.location_code, { warehouse_id: whA.id })
  check('[1] quét _5_T1 ra ĐÚNG _5_T1 (không lấy _5_T10)',
    r1.s === 200 && r1.j?.data?.id === locT1.id,
    `${r1.s} ${r1.j?.data?.location_code ?? r1.j?.error?.code ?? ''}`)
  const r1b = await resolve(locT10.location_code, { warehouse_id: whA.id })
  check('[1b] quét _5_T10 ra ĐÚNG _5_T10',
    r1b.s === 200 && r1b.j?.data?.id === locT10.id, `${r1b.s}`)

  // [2] sai hoa/thường (tem in hoa, DB chữ thường hoặc ngược lại)
  const r2 = await resolve(locT1.location_code.toLowerCase(), { warehouse_id: whA.id })
  check('[2] sai hoa/thường vẫn ra đúng ô', r2.s === 200 && r2.j?.data?.id === locT1.id, `${r2.s}`)

  // [3] tem in KHÔNG DẤU (máy in nhãn thiếu font tiếng Việt)
  const r3 = await resolve(`${TAG}_NGOAI DUONG`, { warehouse_id: whA.id })
  check('[3] tem không dấu ra đúng ô có dấu', r3.s === 200 && r3.j?.data?.id === locDau.id,
    `${r3.s} ${r3.j?.data?.location_code ?? r3.j?.error?.code ?? ''}`)

  // [4] đuôi CR/LF của súng + khoảng trắng 2 đầu
  const r4 = await resolve(`  ${locT1.location_code}\r\n`, { warehouse_id: whA.id })
  check('[4] đuôi CR/LF + space 2 đầu (súng PDA) vẫn ra đúng ô',
    r4.s === 200 && r4.j?.data?.id === locT1.id, `${r4.s}`)

  // [5] không có thật
  const r5 = await resolve(`${TAG}_KHONG_TON_TAI`, { warehouse_id: whA.id })
  check('[5] mã không có thật → 404 LOCATION_NOT_FOUND',
    r5.s === 404 && r5.j?.error?.code === 'LOCATION_NOT_FOUND',
    `${r5.s} ${r5.j?.error?.code ?? ''}`)

  // [6] CHƯA khai kho vẫn ra đúng ô — làm được vì mã vị trí là DUY NHẤT toàn hệ thống (xem [7]).
  // Quan trọng cho các bộ lọc để "tất cả kho": không có nó thì đứng trước kệ bắn tem là bế tắc.
  const r6 = await resolve(`${TAG}_DUP`)
  check('[6] chưa chọn kho vẫn ra đúng ô (mã vị trí duy nhất toàn hệ thống)',
    r6.s === 200 && r6.j?.data?.id === locDupA.id,
    `${r6.s} ${r6.j?.error?.code ?? ''}`)

  // [7] Cái gì bảo đảm [6] không phải phép ĐOÁN: unique index trên location_code. Kiểm bằng cách
  // thử ghi trùng mã sang kho khác — phải bị DB chặn 23505. Mất ràng buộc này thì một phát quét có
  // thể khớp 2 ô ở 2 kho và cửa tra buộc phải 409 (nhánh LOCATION_AMBIGUOUS vẫn để đó làm lưới).
  let dupBlocked = false
  try {
    const [row] = await restWrite('Location', 'POST', null, {
      id: randomUUID(), location_code: `${TAG}_DUP`, warehouse_id: whB.id, max_pallets: 1,
      is_active: true, row: 'QA', shelf: '1', sub_code: `${TAG}-Z`,
      created_at: nowIso(), updated_at: nowIso(),
    })
    if (row?.id) created.locs.push(row.id)     // lọt được thì vẫn phải dọn
  } catch (e) { dupBlocked = /23505|duplicate key/.test(String(e)) }
  check('[7] DB chặn 2 kho cùng MỘT mã vị trí (unique location_code) — nền của [6]', dupBlocked,
    dupBlocked ? '' : 'mất unique ⇒ quét mà chưa chọn kho là đoán')

  // [8] ô ngưng dùng: trả về + cờ, KHÔNG 404 (người quét đứng trước tem thật)
  const r8 = await resolve(locOff.location_code, { warehouse_id: whA.id })
  check('[8] ô NGƯNG sử dụng vẫn trả về kèm is_active=false (không báo "không tìm thấy")',
    r8.s === 200 && r8.j?.data?.id === locOff.id && r8.j?.data?.is_active === false,
    `${r8.s} is_active=${r8.j?.data?.is_active}`)

  // [9] nhãn giống picker: used_slots + putaway
  const mat = (await restAll('Material', 'select=id&is_non_stock=is.false&limit=1'))[0]
  const r9 = await resolve(locT1.location_code, { warehouse_id: whA.id, putaway: '1', ...(mat ? { material_id: mat.id } : {}) })
  check('[9] trả kèm used_slots + khối putaway (cùng nhãn với picker)',
    r9.s === 200 && typeof r9.j?.data?.used_slots === 'number' && !!r9.j?.data?.putaway,
    `used_slots=${r9.j?.data?.used_slots} putaway=${JSON.stringify(r9.j?.data?.putaway ?? null)}`)

  // [10] scope kho — khai kho B nhưng tra mã CỦA KHO A: không được trả ô của kho A
  const r10 = await resolve(locT1.location_code, { warehouse_id: whB.id })
  check('[10] khai kho B mà mã thuộc kho A → 404 (không rò vị trí kho khác)',
    r10.s === 404, `${r10.s} ${r10.j?.data?.location_code ?? ''}`)

  // ── Kiểm NGUỒN (không cần server) ──
  const beNorm = readFileSync(join(ROOT, 'backend/src/utils/locationScan.ts'), 'utf8')
  const feNorm = readFileSync(join(ROOT, 'frontend/src/utils/locationScan.ts'), 'utf8')
  const bodyOf = (s) => s.slice(s.indexOf('const CONTROL_RE')).replace(/\s+/g, ' ').trim()
  check('[11] normalizeLocScan BE ↔ FE KHỚP NHAU (mirror)', bodyOf(beNorm) === bodyOf(feNorm),
    bodyOf(beNorm) === bodyOf(feNorm) ? '' : 'hai bản đã lệch — cùng một tem sẽ ra kết quả khác nhau')

  const tsx = []
  const walk = (d) => { for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.tsx')) tsx.push(p)
  } }
  walk(join(ROOT, 'frontend/src'))
  const LOC_HOOKS = /\b(useLocationsReal|usePickFaceLocations|useLocationsByFlag|useLocationsFull|useLocationsPaged)\s*\(/
  const missing = tsx.filter(f => {
    const s = readFileSync(f, 'utf8')
    return LOC_HOOKS.test(s) && !s.includes('LocationScanButton')
  })
  check('[12] mọi màn dùng hook vị trí đều có nút quét', missing.length === 0,
    missing.map(f => f.slice(ROOT.length + 1)).join(', '))

  // MỘT symbol quét cho toàn app (user chốt 21/08 "mỗi chỗ 1 icon là k đc"). Mirror ratchet
  // `scan_icon_not_unified` — để gói này chạy tay cũng bắt được.
  const iconDiverge = []
  for (const f of tsx) {
    if (f.endsWith('ScanIcon.tsx')) continue
    readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(\/\/|\*|\{\/\*)/.test(line)) return
      if (/\b(ScanLine|ScanBarcode|ScanQrCode)\b/.test(line)
        || (/\bQrCode\b/.test(line) && /Quét|onScan|handleScan/.test(line))) {
        iconDiverge.push(`${f.slice(ROOT.length + 1)}:${i + 1}`)
      }
    })
  }
  check('[16] mọi nút QUÉT dùng chung 1 symbol (ScanIcon)', iconDiverge.length === 0, iconDiverge.slice(0, 5).join(', '))

  const label = readFileSync(join(ROOT, 'frontend/src/components/wms/locationLabel.tsx'), 'utf8')
  check('[13] QR tem vị trí mã hoá NGUYÊN VĂN location_code',
    /toDataURL\(l\.location_code/.test(label),
    'thêm tiền tố/hậu tố vào QR = cửa tra không khớp trọn mã nữa')

  const wedge = readFileSync(join(ROOT, 'frontend/src/hooks/useWedgeScanner.ts'), 'utf8')
  check('[14] useWedgeScanner còn khoá ĐỘC QUYỀN phát bắn',
    /exclusiveCount/.test(wedge) && /!exclusive && exclusiveCount > 0/.test(wedge),
    'mất khoá = 1 phát súng chạy cả tra-pallet lẫn chọn-vị-trí')

  // `armWedge` bật CỐ ĐỊNH (`={true}` hoặc để trần kiểu prop boolean) = giành cò súng VĨNH VIỄN →
  // màn đó hết quét được tem pallet mà không báo gì. Bỏ qua chính file định nghĩa component
  // (khai type + default ở đó là bình thường).
  const armAlways = []
  for (const f of tsx) {
    if (f.endsWith('LocationScanButton.tsx')) continue
    const s = readFileSync(f, 'utf8')
    if (/armWedge\s*=\s*\{\s*true\s*\}/.test(s) || /armWedge\s*(\/>|\n\s*[a-zA-Z]|>)/.test(s)) {
      armAlways.push(f.slice(ROOT.length + 1))
    }
  }
  check('[15] armWedge luôn buộc theo TRẠNG THÁI (không bật cố định)', armAlways.length === 0,
    [...new Set(armAlways)].join(', '))
} finally {
  await cleanup()
  const left = await restAll('Location', `select=id&location_code=like.${TAG}*`)
  check('dọn sạch fixture', left.length === 0, `${left.length} dòng còn lại`)
}
finish('LOCATION-SCAN')
