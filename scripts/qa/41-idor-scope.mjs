// 41 — CHỐNG IDOR THEO CẶP ID + PHẠM VI KHO Ở CỬA GHI (kiểm định trước chào bán 02/09).
// (1) 8 route /outbound/:gdoId/items/:itemId/*: dòng hàng KHÔNG thuộc chuyến trên URL → 404 như không tồn tại
//     (trước: item kho B ghép với gdo hợp lệ của kho A = ghi số / hoàn tồn vào kho B). Cặp khớp vẫn chạy bình thường.
// (2) Tài khoản ASSIGNED (kho Ba Vì) có ĐỦ quyền nhưng ngoài phạm vi: sửa kho khác 403 · DO SAP plant ngoài phạm vi
//     403 (thêm tay phải khai plant thuộc phạm vi) · hoàn tác Dồn/Tách của kho khác 403 và KHÔNG bị đánh dấu.
// Fixture tự dựng (tag QAIDOR + dvvt QA-SUITE), tự dọn ở finally.
import { randomUUID } from 'crypto'
import { login, api, check, finish, FIX, BASE, restAll, restWrite, teardownGdo } from './lib.mjs'

const TAG = 'QAIDOR'
await login()

async function cleanExtra() {
  for (const e of await restAll('Employee', `select=id&employee_code=like.${TAG}*`)) {
    await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${e.id}`).catch(() => {})
    await restWrite('Employee', 'DELETE', `id=eq.${e.id}`)
  }
  for (const j of await restAll('JobTitle', `select=id&name=like.${TAG}*`)) await restWrite('JobTitle', 'DELETE', `id=eq.${j.id}`)
  await restWrite('PalletOperation', 'DELETE', `operated_by_name=eq.${TAG}`).catch(() => {})
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=like.${TAG}*`).catch(() => {})
}
await cleanExtra()

// ── Tầng 1: cặp (chuyến, dòng hàng) LỆCH nhau trên 8 route ──
const mk = async (wh, date) => {
  const r = await api('/wms/outbound', 'POST', {
    delivery_date: date, warehouse_id: wh.id, dvvt: FIX.DVVT_TAG, customer_name: `${TAG} NPP`,
    delivery_code: `${TAG}-${wh.code}-${Math.floor(Math.random() * 1e9)}`,
    items: [{ material_code: FIX.MAT_POOL, cartons_ordered: 1 }],
  })
  return r.j?.data
}
const A = await mk(FIX.WH_QTY, FIX.EXEC_DATE)     // kho QTY hôm nay → Bắt đầu được (Bluestar không có rule cổng/cân)
const B = await mk(FIX.WH_NONE, FIX.DATE)          // kho khác, nằm im
const itemA = A?.delivery_orders?.[0]?.items?.[0]?.id, itemB = B?.delivery_orders?.[0]?.items?.[0]?.id
check('Dựng 2 chuyến ở 2 kho khác nhau', !!(A?.id && B?.id && itemA && itemB), `A=${A?.id?.slice(0, 8)} B=${B?.id?.slice(0, 8)}`)
if (A?.id && B?.id && itemA && itemB) {
  try {
    await api(`/wms/outbound/${A.id}/assign`, 'POST', {})
    const st = await api(`/wms/outbound/${A.id}/start`, 'POST', { license_plate: `${TAG}XE1` })
    check('Chuyến A Bắt đầu được (để route đòi started_at đi tới bước kiểm dòng hàng)', st.s === 200, `http=${st.s} ${st.j?.error?.message ?? ''}`)

    // Cặp KHỚP vẫn chạy — cửa ghi không bị siết oan
    const okInv = await api(`/wms/outbound/${A.id}/items/${itemA}/inventory`)
    check('Cặp khớp: GET inventory → 200', okInv.s === 200, `http=${okInv.s}`)
    const okStock = await api(`/wms/outbound/${A.id}/items/${itemA}/manual-stock`)
    check('Cặp khớp: GET manual-stock → 200', okStock.s === 200, `http=${okStock.s}`)
    const okMc = await api(`/wms/outbound/${A.id}/items/${itemA}/manual-complete`, 'POST', { cartons: 0 })
    check('Cặp khớp: POST manual-complete (0 thùng) → 200', okMc.s === 200, `http=${okMc.s} ${okMc.j?.error?.message ?? ''}`)

    // Cặp LỆCH: chuyến A (đã start, trong phạm vi) + dòng hàng của chuyến B (kho khác) → 404 ở MỌI route
    const X = `/wms/outbound/${A.id}/items/${itemB}`
    const cases = [
      ['GET inventory',        () => api(`${X}/inventory`)],
      ['GET manual-stock',     () => api(`${X}/manual-stock`)],
      ['POST check-scan',      () => api(`${X}/check-scan`, 'POST', { qr_code: `${TAG}-NOQR` })],
      ['POST scan',            () => api(`${X}/scan`, 'POST', { qr_code: `${TAG}-NOQR`, leftover_ui: true, leftover_location_id: 'KEEP' })],
      ['POST manual-complete', () => api(`${X}/manual-complete`, 'POST', { cartons: 1 })],
      ['POST manual-loose',    () => api(`${X}/manual-loose`, 'POST', { cartons: 1 })],
      ['POST confirm-loose',   () => api(`${X}/confirm-loose`, 'POST', {})],
      ['DELETE scans/:scanId', () => api(`${X}/scans/${randomUUID()}`, 'DELETE')],
    ]
    for (const [name, fn] of cases) {
      const r = await fn()
      check(`Cặp lệch chuyến↔dòng hàng: ${name} → 404`, r.s === 404, `http=${r.s} ${r.j?.error?.message ?? ''}`)
    }
    const rev = await api(`/wms/outbound/${B.id}/items/${itemA}/inventory`)
    check('Cặp lệch chiều ngược (chuyến B + dòng hàng A): GET inventory → 404', rev.s === 404, `http=${rev.s}`)
    const bAfter = await api(`/wms/outbound/${B.id}`)
    const itB = (bAfter.j?.data?.delivery_orders ?? []).flatMap(d => d.items ?? []).find(i => i.id === itemB)
    check('Dòng hàng kho B KHÔNG bị ghi số qua chuyến A', Number(itB?.cartons_scanned ?? -1) === 0 && itB?.status === 'PENDING', `scanned=${itB?.cartons_scanned} status=${itB?.status}`)
  } finally {
    await teardownGdo(A.id, 'IN_PROGRESS').catch(() => {})
    await teardownGdo(B.id, 'PENDING').catch(() => {})
  }
}

// ── Tầng 2: tài khoản ASSIGNED (kho Ba Vì) có quyền nhưng NGOÀI PHẠM VI ──
let bcrypt = null
try { bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(m => m.default ?? m) } catch { /* chưa npm i backend */ }
if (!bcrypt) console.log('  ⏭  không load được bcrypt của backend (npm i trong backend) — bỏ qua tầng 2')
else {
  const now = () => new Date().toISOString()
  const jid = randomUUID(), eid = randomUUID(), pw = 'Qa' + randomUUID().slice(0, 10) + '!'   // dùng 1 lần, không in
  try {
    await restWrite('JobTitle', 'POST', '', [{ id: jid, name: `${TAG} chuc danh`, updated_at: now(),
      module_permissions: { wms_settings: ['view', 'manage_warehouse'], external_do_sap: ['view', 'create', 'edit', 'delete'], pallet_ops: ['view', 'merge', 'ungroup', 'split'] } }])
    await restWrite('Employee', 'POST', '', [{ id: eid, employee_code: `${TAG}01`, name: `${TAG} nv`, email: `${TAG.toLowerCase()}01@test.local`,
      password: await bcrypt.hash(pw, 10), is_active: true, job_title_id: jid, warehouse_id: FIX.WH_QR.id, warehouse_scope: 'ASSIGNED', updated_at: now() }])
    await restWrite('UserWarehouseAccess', 'POST', '', [{ id: randomUUID(), employee_id: eid, warehouse_id: FIX.WH_QR.id }])
    const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${TAG.toLowerCase()}01@test.local`, password: pw }) })
    const tk = (await lr.json().catch(() => null))?.data?.token
    check('Đăng nhập tài khoản ASSIGNED kho Ba Vì', !!tk, `http=${lr.status}`)
    if (tk) {
      const call = async (path, method = 'GET', body) => {
        const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
          body: body ? JSON.stringify({ qty_semantics: 'base', ...body }) : undefined })
        let j = null; try { j = JSON.parse(await r.text()) } catch { /* không phải JSON */ }
        return { s: r.status, j }
      }
      let r = await call(`/masterdata/warehouses/${FIX.WH_QTY.id}`, 'PUT', {})
      check('Sửa kho NGOÀI phạm vi (Bluestar) → 403', r.s === 403, `http=${r.s}`)
      r = await call(`/masterdata/warehouses/${FIX.WH_QR.id}`, 'PUT', {})
      check('Sửa kho TRONG phạm vi (Ba Vì) → 200', r.s === 200, `http=${r.s} ${r.j?.error?.message ?? ''}`)
      r = await call('/external/do-sap', 'POST', { od_number: `${TAG}1`, od_item: '10', plant: '9999' })
      check('Thêm DO SAP plant ngoài phạm vi → 403', r.s === 403, `http=${r.s}`)
      r = await call('/external/do-sap', 'POST', { od_number: `${TAG}2`, od_item: '10' })
      check('Thêm DO SAP KHÔNG khai plant (tài khoản kho lẻ) → 403', r.s === 403, `http=${r.s}`)
      const plant = (await restAll('Warehouse', `select=sap_plant&id=eq.${FIX.WH_QR.id}`))[0]?.sap_plant
      if (plant) {
        r = await call('/external/do-sap', 'POST', { od_number: `${TAG}3`, od_item: '10', plant })
        check(`Thêm DO SAP plant ${plant} (kho mình) → 201`, r.s === 201, `http=${r.s} ${r.j?.error?.message ?? ''}`)
        if (r.j?.data?.id) { const d = await call(`/external/do-sap/${r.j.data.id}`, 'DELETE'); check('Xoá dòng DO SAP kho mình → 200', d.s === 200, `http=${d.s}`) }
        const list = await call('/external/do-sap?page=1&page_size=200')
        const bad = (list.j?.data?.items ?? []).filter(i => i.plant && String(i.plant).trim().toUpperCase() !== String(plant).trim().toUpperCase())
        check('Danh sách DO SAP chỉ còn plant của kho mình (hoặc trống plant)', list.s === 200 && bad.length === 0, `http=${list.s} · ${list.j?.data?.items?.length ?? 0} dòng · lệch=${bad.length}`)
      } else console.log(`  ⏭  kho ${FIX.WH_QR.name} chưa khai sap_plant — bỏ qua 3 phép DO SAP chiều dương`)
      const opId = randomUUID()
      await restWrite('PalletOperation', 'POST', '', [{ id: opId, type: 'MERGE', source_codes: [], target_codes: [], detail: { prev: [] },
        warehouse_id: FIX.WH_QTY.id, operated_by_name: TAG, created_at: now(), updated_at: now() }])
      r = await call(`/wms/pallet-ops/${opId}/undo`, 'POST', {})
      check('Hoàn tác Dồn/Tách của kho NGOÀI phạm vi → 403', r.s === 403, `http=${r.s} ${r.j?.error?.message ?? ''}`)
      const opRow = (await restAll('PalletOperation', `select=undone_at&id=eq.${opId}`))[0]
      check('Thao tác kho khác KHÔNG bị đánh dấu hoàn tác', !!opRow && opRow.undone_at == null, `undone_at=${opRow?.undone_at}`)
    }
  } finally { await cleanExtra() }
}
finish('IDOR-SCOPE')
