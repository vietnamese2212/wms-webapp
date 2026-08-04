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
import { restAll, restWrite, restRpc, HAS_DB, FIX } from './lib.mjs'

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

// ── Tầng 3: CHUYẾN CHỞ LẪN nhiều Loại kho phải LỌT scope loại (bug thật 30/07) ──
// GDO của chuyến chở lẫn lưu chuỗi GHÉP 'FG01+PM01'; nếu bộ lọc so khớp NGUYÊN CHUỖI thì
// chuyến biến mất với MỌI user có scope loại — kể cả người có đủ cả hai. Luật user chốt:
// GIAO ≥1 loại là THẤY. Dựng fixture riêng (loại QAX*, không đụng loại thật) rồi dọn.
if (!HAS_DB) {
  warn('bỏ qua tầng 3 (không có key DB trong backend/.env)')
} else {
  const GID = 'qa-multicat-gdo-0001'
  const CODE = 'QA-MULTICAT-0001'
  const DAY = '2026-12-21'          // ngày tương lai xa, không đụng dữ liệu thật
  const cleanup = () => restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${GID}`)
  try {
    await cleanup()                 // tự hồi phục nếu lần chạy trước chết giữa chừng
    await restWrite('GroupDeliveryOrder', 'POST', '', [{
      id: GID, group_code: CODE, planned_date: DAY, delivery_date: DAY, status: 'PENDING',
      warehouse_id: FIX.WH_QR.id, warehouse_type: 'QAX1+QAX2', dvvt: FIX.DVVT_TAG,
      updated_at: new Date().toISOString(),
    }])
    const idsOf = async (scope) => {
      const r = await restRpc('outbound_gdos_page', {
        p_offset: 0, p_limit: 500, p_warehouse_ids: [FIX.WH_QR.id],
        p_scope_categories: scope, p_date_from: DAY, p_date_to: DAY,
      })
      return r?.ids ?? []
    }
    chk((await idsOf(['QAX1'])).includes(GID), 'chuyến chở lẫn: user chỉ có loại thứ NHẤT vẫn thấy')
    chk((await idsOf(['QAX2'])).includes(GID), 'chuyến chở lẫn: user chỉ có loại thứ HAI vẫn thấy')
    chk((await idsOf(['QAX1', 'QAX2'])).includes(GID), 'chuyến chở lẫn: user có ĐỦ cả hai loại vẫn thấy')
    chk(!(await idsOf(['QAX9'])).includes(GID), 'chuyến chở lẫn: user KHÔNG có loại nào của chuyến thì KHÔNG thấy')

    const facets = await restRpc('outbound_gdos_facets', {
      p_warehouse_ids: [FIX.WH_QR.id], p_scope_categories: null, p_date_from: DAY, p_date_to: DAY,
    })
    const wt = facets?.warehouse_types ?? []
    chk(wt.includes('QAX1') && wt.includes('QAX2') && !wt.includes('QAX1+QAX2'),
      'facet Loại kho tách thành từng loại (không đưa chuỗi ghép làm 1 lựa chọn)', JSON.stringify(wt))
  } catch (e) {
    chk(false, 'tầng 3 (chuyến chở lẫn) chạy lỗi', String(e).slice(0, 200))
  } finally {
    await cleanup().catch(() => {})
  }
}

// ── Tầng 4: chuyến chở LẪN — user CHỈ có 1 loại phải XEM ĐƯỢC HẾT (user chốt 03/08) ──
// Tầng 3 chỉ chứng minh chuyến LỌT danh sách ở tầng RPC. Câu hỏi thật của người dùng là "user chỉ
// có quyền FG01 mà đơn ghép FG01+FG02 thì có xem được HẾT không — tôi muốn xem được": tức phải MỞ
// được chi tiết VÀ thấy ĐỦ MỌI DÒNG HÀNG (kể cả dòng thuộc loại ngoài quyền). Xe là 1 phương tiện
// vật lý không tách được — ẩn bớt dòng hàng thì người quét tưởng kế hoạch chỉ có thế và XUẤT THIẾU.
// Dựng user scope THẬT (JWT mang allowed_categories) rồi gọi API thật; so số dòng với admin.
if (!HAS_DB) {
  warn('bỏ qua tầng 4 (không có key DB)')
} else {
  const T4 = 'QAPERM4'
  const DAY4 = '2026-12-23'
  const clean4 = async () => {
    for (const g of await restAll('GroupDeliveryOrder', `select=id&group_code=like.*${T4}*`)) {
      for (const d of await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`)) {
        await restWrite('OutboundItem', 'DELETE', `do_id=eq.${d.id}`).catch(() => {})
        await restWrite('OutboundDelivery', 'DELETE', `id=eq.${d.id}`)
      }
      await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${g.id}`)
    }
    for (const e of await restAll('Employee', `select=id&employee_code=like.*${T4}*`)) {
      await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${e.id}`).catch(() => {})
      await restWrite('Employee', 'DELETE', `id=eq.${e.id}`)
    }
    for (const j of await restAll('JobTitle', `select=id&name=like.*${T4}*`)) await restWrite('JobTitle', 'DELETE', `id=eq.${j.id}`)
    for (const o of await restAll('TmsOrder', `select=id&order_code=like.*${T4}*`)) {
      await restWrite('TmsVehicleSlot', 'DELETE', `order_id=eq.${o.id}`).catch(() => {})
      await restWrite('TmsOrder', 'DELETE', `id=eq.${o.id}`)
    }
  }
  try {
    const bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(m => m.default ?? m).catch(() => null)
    const cats = (await restAll('LookupValue', 'select=value&type=eq.warehouse_type&order=sort_order')).map(x => x.value)
    const mats = []
    for (const c of cats.slice(0, 2)) {
      const m = (await restAll('Material', `select=material_code&category=eq.${c}&limit=1`))[0]
      if (m) mats.push({ code: m.material_code, cat: c })
    }
    if (!bcrypt) warn('bỏ qua tầng 4 (không load được bcrypt của backend — chạy `npm i` trong backend)')
    else if (mats.length < 2) warn('bỏ qua tầng 4 (danh mục không có đủ 2 loại kho kèm mã hàng)')
    else {
      await clean4()
      const { randomUUID } = await import('crypto')
      const now = () => new Date().toISOString()
      const gid = randomUUID(), did = randomUUID(), jid = randomUUID(), eid = randomUUID()
      const pw = 'Qa' + randomUUID().slice(0, 10) + '!'      // dùng 1 lần, không in ra
      await restWrite('GroupDeliveryOrder', 'POST', '', [{
        id: gid, group_code: `${T4}-MIX`, planned_date: DAY4, delivery_date: DAY4, status: 'PENDING',
        warehouse_id: FIX.WH_QR.id, warehouse_type: `${mats[0].cat}+${mats[1].cat}`, dvvt: FIX.DVVT_TAG, updated_at: now(),
      }])
      await restWrite('OutboundDelivery', 'POST', '', [{
        id: did, gdo_id: gid, delivery_code: `${T4}-DO`, distributor_name: `${T4} NPP`, status: 'PENDING', updated_at: now(),
      }])
      await restWrite('OutboundItem', 'POST', '', mats.map(m => ({
        id: randomUUID(), do_id: did, material_code_raw: m.code, cartons_ordered: 10,
        cartons_scanned: 0, loose_picking: 0, status: 'PENDING', updated_at: now(),
      })))
      await restWrite('JobTitle', 'POST', '', [{ id: jid, name: `${T4} chuc danh`, module_permissions: { outbound: ['view'] }, updated_at: now() }])
      await restWrite('Employee', 'POST', '', [{
        id: eid, employee_code: `${T4}01`, name: `${T4} nv`, email: `${T4.toLowerCase()}01@test.local`,
        password: await bcrypt.hash(pw, 10), is_active: true, job_title_id: jid, warehouse_id: FIX.WH_QR.id,
        warehouse_scope: 'ASSIGNED', allowed_categories: [mats[0].cat], updated_at: now(),
      }])
      await restWrite('UserWarehouseAccess', 'POST', '', [{ id: randomUUID(), employee_id: eid, warehouse_id: FIX.WH_QR.id }])

      const { BASE } = await import('./lib.mjs')
      const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `${T4.toLowerCase()}01@test.local`, password: pw }) })
      const lj = await lr.json()
      const tk = lj?.data?.token
      chk(!!tk && JSON.stringify(lj.data.user.allowed_categories) === JSON.stringify([mats[0].cat]),
        `tầng 4: user test chỉ có loại ${mats[0].cat}`, `http=${lr.status}`)
      if (tk) {
        const get = async p => {
          const r = await fetch(`${BASE}/api${p}`, { headers: { Authorization: `Bearer ${tk}` } })
          let j = null; try { j = JSON.parse(await r.text()) } catch { /* */ }
          return { s: r.status, j }
        }
        const list = await get(`/wms/outbound?date_from=${DAY4}&date_to=${DAY4}&page=1&page_size=50`)
        const rows = list.j?.data?.rows ?? list.j?.data?.items ?? []
        chk(rows.some(r => r.id === gid), `chuyến ghép ${mats[0].cat}+${mats[1].cat} LỌT danh sách của user 1 loại`, `http=${list.s}`)
        const det = await get(`/wms/outbound/${gid}`)
        chk(det.s === 200, 'user 1 loại MỞ ĐƯỢC chi tiết chuyến ghép', `http=${det.s}`)
        const items = (det.j?.data?.delivery_orders ?? []).flatMap(d => d.items ?? [])
        chk(items.length === 2 && items.some(i => (i.material_code_raw ?? '') === mats[1].code),
          'user 1 loại thấy ĐỦ dòng hàng — kể cả dòng thuộc loại NGOÀI quyền (ẩn bớt = xuất thiếu)',
          `thấy ${items.length}/2: ${JSON.stringify(items.map(i => i.material_code_raw))}`)

        // LỆNH VẬN CHUYỂN cũng mang Loại kho GHÉP (lệnh tự sinh từ Kế hoạch xuất sao chép của chuyến).
        // Cắt list bằng `warehouse_type.in.(...)` là so khớp NGUYÊN CHUỖI ⇒ lệnh xe chở lẫn BIẾN MẤT
        // với user có scope loại — đo staging 04/08: scope FG01 thấy 50/117, scope PM01 thấy 1/68.
        // Cùng lớp lỗi đã vá cho chuyến ngày 30/07, tái sinh ở TmsOrder ngày 03/08.
        const oid = randomUUID()
        await restWrite('TmsOrder', 'POST', '', [{
          id: oid, order_code: `${T4}-MIXORD`, date: DAY4, warehouse_id: FIX.WH_QR.id,
          warehouse_type: `${mats[0].cat}+${mats[1].cat}`, direction: 'OUTBOUND', status: 'PENDING',
          npp_name: `${T4} NPP`, created_at: now(), updated_at: now(),
        }])
        await restWrite('TmsVehicleSlot', 'POST', '', [{
          id: randomUUID(), order_id: oid, status: 'PENDING', created_at: now(), updated_at: now(),
        }])
        const tms = await get(`/tms/orders?date_from=${DAY4}&date_to=${DAY4}&page=1&page_size=100`)
        const trows = tms.j?.data?.rows ?? tms.j?.data ?? []
        chk(Array.isArray(trows) && trows.some(r => r.order_code === `${T4}-MIXORD`),
          'lệnh VC chở LẪN loại LỌT danh sách Kế hoạch VC của user 1 loại (không ẩn oan)',
          `http=${tms.s} thấy ${Array.isArray(trows) ? trows.length : '?'} lệnh`)
      }
    }
  } catch (e) {
    chk(false, 'tầng 4 (xem hết dòng hàng chuyến ghép) chạy lỗi', String(e).slice(0, 200))
  } finally {
    await clean4().catch(() => {})
  }
}

console.log(`\n[PERM-COVERAGE] ${pass}/${pass + fail} PASS${warns ? ` · ${warns} cảnh báo` : ''}${fail ? ` · ${fail} FAIL` : ''}`)
// KHÔNG process.exit() ở đây: trên Windows, exit cưỡng bức ngay sau fetch HTTPS làm libuv assert
// (exit code 127 bẩn). Đặt exitCode rồi để event-loop tự cạn — socket undici đã unref, thoát sạch.
process.exitCode = fail ? 1 : 0
