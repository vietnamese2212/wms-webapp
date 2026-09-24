// GÓI 56 — CỬA XUẤT CÓ SỨC CHỨA XE (Directed Work đợt 1a, 09/09/2026)
//
// Luật user chốt: kho CÓ cửa xuất trên Sơ đồ kho ⇒ chuyến Bắt đầu phải ghi cửa; cửa có số xe tối đa; xe hoàn thành
// đơn thì xe sau mới chọn được; cặp kho nội bộ miễn; đếm theo XE (cùng biển bốc thêm đơn không tốn suất).
// Vì sao phải gác bằng máy: suất cửa là BỘ ĐẾM DÙNG CHUNG — sai một trong ba chỗ (đếm sai chuyến, không nhả khi
// Hoàn thành, hai người cùng lấy suất cuối) thì xe đứng chờ oan hoặc hai xe chen một cửa, và KHÔNG có lỗi nào nổ.
// Fixture tự chứa: kho QA56 (QTY, không rule cổng/cân) + khung bản vẽ + 2 cửa xuất (sức chứa 1 và 2) + chuyến PENDING.
import { login, api, check, finish, restWrite, restAll, FIX, BASE } from './lib.mjs'
import { randomUUID } from 'crypto'

const T = 'QA56'
console.log('── GÓI 56: Cửa xuất có sức chứa xe — bắt buộc theo bản vẽ · đếm theo xe · nhả khi hoàn thành · đua ──')
await login()
const now = () => new Date().toISOString()
const err = r => `${r.j?.error?.code ?? ''} ${(r.j?.error?.message ?? '').slice(0, 100)}`.trim()

async function cleanup() {
  const gdos = await restAll('GroupDeliveryOrder', `select=id&group_code=like.${T}*`)
  if (gdos.length) await restWrite('GroupDeliveryOrder', 'DELETE', `id=in.(${gdos.map(g => g.id).join(',')})`)
  const whs = await restAll('Warehouse', `select=id&code=like.${T}*`)
  for (const w of whs) {
    await restWrite('warehouse_maps', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('Location', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
  }
  if (whs.length) await restWrite('Warehouse', 'DELETE', `code=like.${T}*`)
}
await cleanup()

const mkWh = async (code) => (await restWrite('Warehouse', 'POST', null, {
  id: randomUUID(), code, name: `QA dock ${code}`, warehouse_type: 'CENTRAL', inventory_mode: 'QTY',
  require_gate_on_start: false, require_weigh_on_start: false, is_active: true, updated_at: now(),
}))[0].id
const mkGdo = async (suffix, wh) => (await restWrite('GroupDeliveryOrder', 'POST', null, {
  id: randomUUID(), group_code: `${T}_${suffix}`, planned_date: FIX.EXEC_DATE, delivery_date: FIX.EXEC_DATE,
  warehouse_id: wh, status: 'PENDING', created_at: now(), updated_at: now(),
}))[0].id
const start = (g, body) => api(`/wms/outbound/${g}/start`, 'POST', body)
const dockRow = async id => (await restAll('GroupDeliveryOrder', `select=dock_location_id,dock_assigned_at,status&id=eq.${id}`))[0]

const whDock = await mkWh(`${T}_D`)   // kho CÓ cửa
const whNone = await mkWh(`${T}_N`)   // kho KHÔNG cửa — hành vi cũ

let dock1 = null, dock2 = null
try {
  // ═══ [0] Dựng bản vẽ + 2 cửa xuất ═══
  let r = await api(`/wms/warehouse-map/${whDock}`, 'PUT', { width: 20, height: 20, cell_m: 1.2, blocked: [] })
  check('[0a] Dựng khung 20×20 cho kho QA', r.s === 200, `http=${r.s} ${err(r)}`)
  r = await api(`/wms/warehouse-map/${whDock}/objects`, 'POST', { kind: 'DOCK_OUT', name: 'Cua 1', grid_x: 2, grid_y: 18, grid_w: 3, grid_h: 1 })
  check('[0b] Tạo Cửa 1 → 201, dock_capacity mặc định 1', r.s === 201 && r.j?.data?.dock_capacity === 1, `http=${r.s} cap=${r.j?.data?.dock_capacity} ${err(r)}`)
  dock1 = r.j?.data?.id
  r = await api(`/wms/warehouse-map/${whDock}/objects`, 'POST', { kind: 'DOCK_OUT', name: 'Cua 2', grid_x: 8, grid_y: 18, grid_w: 3, grid_h: 1 })
  dock2 = r.j?.data?.id
  r = await api(`/wms/warehouse-map/${whDock}/objects/${dock2}`, 'PATCH', { dock_capacity: 2 })
  check('[0c] Đặt Cửa 2 = 2 xe → 200', r.s === 200 && r.j?.data?.dock_capacity === 2, `http=${r.s} ${err(r)}`)
  r = await api(`/wms/warehouse-map/${whDock}/objects/${dock2}`, 'PATCH', { dock_capacity: 0 })
  check('[0d] Sức chứa 0 → 400 (1–50 hoặc trống)', r.s === 400, `http=${r.s} ${err(r)}`)
  r = await api(`/wms/warehouse-map/${whDock}/objects/${dock2}`, 'PATCH', { dock_capacity: 1.5 })
  check('[0e] Sức chứa thập phân → 400', r.s === 400, `http=${r.s}`)
  r = await api(`/wms/warehouse-map/${whDock}/objects`, 'POST', { kind: 'DROP', name: 'Dau day', grid_x: 14, grid_y: 18 })
  check('[0f] Điểm đầu dãy KHÔNG có dock_capacity (null) — pallet chờ theo max_pallets=0 = không giới hạn', r.s === 201 && r.j?.data?.dock_capacity === null && r.j?.data?.max_pallets === 0, `http=${r.s} cap=${r.j?.data?.dock_capacity} mp=${r.j?.data?.max_pallets}`)
  const dropId = r.j?.data?.id
  r = await api(`/wms/warehouse-map/${whDock}/objects/${dropId}`, 'PATCH', { max_pallets: 4 })
  check('[0g] Khai pallet chờ điểm đầu dãy = 4 → 200', r.s === 200 && r.j?.data?.max_pallets === 4, `http=${r.s} ${err(r)}`)

  // ═══ [1] Tình trạng cửa ═══
  r = await api(`/wms/outbound/docks?warehouse_id=${whDock}`)
  const docks = r.j?.data ?? []
  check('[1a] GET /outbound/docks → 200, 2 cửa xuất, occupied=0, có capacity', r.s === 200 && docks.length === 2 && docks.every(d => d.occupied === 0 && d.kind === 'DOCK_OUT'), `http=${r.s} n=${docks.length} ${err(r)}`)
  r = await api(`/wms/outbound/docks?warehouse_id=${encodeURIComponent("' or 1=1 --")}`)
  check('[1b] warehouse_id trông như injection → 400', r.s === 400, `http=${r.s}`)
  r = await api(`/wms/outbound/docks`)
  check('[1c] Thiếu warehouse_id → 400', r.s === 400, `http=${r.s}`)

  // ═══ [2] Bắt buộc theo bản vẽ ═══
  const gA = await mkGdo('A', whDock)
  r = await start(gA, { license_plate: 'QA56XE1' })
  check('[2a] Kho có cửa, Bắt đầu KHÔNG chọn cửa → 422 DOCK_REQUIRED nêu cửa còn trống', r.s === 422 && r.j?.error?.code === 'DOCK_REQUIRED' && /Cua 1|Cua 2/.test(r.j?.error?.message ?? ''), `http=${r.s} ${err(r)}`)
  check('[2b] …chuyến vẫn PENDING, chưa started', (await dockRow(gA)).status === 'PENDING')
  r = await start(gA, { license_plate: 'QA56XE1', dock_location_id: "' or 1=1 --" })
  check('[2c] dock_location_id trông như injection → 400', r.s === 400, `http=${r.s} ${err(r)}`)
  r = await start(gA, { license_plate: 'QA56XE1', dock_location_id: 'khong-co' })
  check('[2d] Cửa không tồn tại → 404', r.s === 404, `http=${r.s} ${err(r)}`)
  r = await start(gA, { license_plate: 'QA56XE1', dock_location_id: dropId })
  check('[2e] Chọn ĐIỂM ĐẦU DÃY làm cửa → 400 NOT_DOCK', r.s === 400 && r.j?.error?.code === 'NOT_DOCK', `http=${r.s} ${err(r)}`)
  r = await start(gA, { license_plate: 'QA56XE1', dock_location_id: dock1 })
  check('[2f] Chọn Cửa 1 (1 xe) → 200, chuyến ghi cửa + giờ vào cửa', r.s === 200 && r.j?.data?.dock_location_id === dock1 && !!r.j?.data?.dock_assigned_at && r.j?.data?.dock?.row === 'Cua 1', `http=${r.s} dock=${r.j?.data?.dock?.row} ${err(r)}`)
  r = await api(`/wms/outbound/docks?warehouse_id=${whDock}`)
  const d1 = (r.j?.data ?? []).find(d => d.id === dock1)
  check('[2g] Tình trạng: Cửa 1 occupied=1, có biển QA56XE1', d1?.occupied === 1 && d1?.vehicles?.[0]?.license_plate === 'QA56XE1', `occ=${d1?.occupied} plates=${JSON.stringify(d1?.vehicles?.map(v => v.license_plate))}`)

  // ═══ [3] Đếm theo XE ═══
  const gB = await mkGdo('B', whDock)
  r = await start(gB, { license_plate: 'QA56XE1', dock_location_id: dock1 })
  check('[3a] CÙNG biển QA56XE1 bốc thêm đơn ở Cửa 1 (đã 1/1) → 200, không tốn suất', r.s === 200 && r.j?.data?.dock_location_id === dock1, `http=${r.s} ${err(r)}`)
  r = await api(`/wms/outbound/docks?warehouse_id=${whDock}`)
  check('[3b] Cửa 1 vẫn occupied=1 (2 chuyến, 1 xe)', (r.j?.data ?? []).find(d => d.id === dock1)?.occupied === 1, `occ=${(r.j?.data ?? []).find(d => d.id === dock1)?.occupied}`)
  const gC = await mkGdo('C', whDock)
  r = await start(gC, { license_plate: 'QA56XE2', dock_location_id: dock1 })
  check('[3c] Biển KHÁC vào Cửa 1 đang đủ → 422 DOCK_FULL nêu biển đang chiếm + cửa còn trống', r.s === 422 && r.j?.error?.code === 'DOCK_FULL' && /QA56XE1/.test(r.j?.error?.message ?? '') && /Cua 2/.test(r.j?.error?.message ?? ''), `http=${r.s} ${err(r)}`)
  check('[3d] …chuyến C vẫn PENDING, không dính cửa', (await dockRow(gC)).status === 'PENDING' && (await dockRow(gC)).dock_location_id === null)
  r = await start(gC, { license_plate: 'QA56XE2', dock_location_id: dock2 })
  check('[3e] Biển khác vào Cửa 2 (2 xe) → 200', r.s === 200, `http=${r.s} ${err(r)}`)

  // ═══ [4] Nhả suất khi Hoàn thành / bỏ Bắt đầu ═══
  r = await api(`/wms/outbound/${gA}`, 'PATCH', { status: 'COMPLETED' })
  check('[4a] Hoàn thành chuyến A (không dòng hàng) → 200', r.s === 200, `http=${r.s} ${err(r)}`)
  r = await api(`/wms/outbound/docks?warehouse_id=${whDock}`)
  check('[4b] A xong nhưng B (cùng xe) còn ở Cửa 1 → occupied vẫn 1', (r.j?.data ?? []).find(d => d.id === dock1)?.occupied === 1)
  check('[4c] Chuyến A GIỮ dock_location_id sau Hoàn thành (báo cáo cửa nào bốc chuyến nào)', (await dockRow(gA)).dock_location_id === dock1)
  r = await api(`/wms/outbound/${gB}/unstart`, 'POST', {})
  check('[4d] Bỏ Bắt đầu chuyến B → 200, dock_location_id về NULL', r.s === 200 && (await dockRow(gB)).dock_location_id === null, `http=${r.s} ${err(r)}`)
  r = await api(`/wms/outbound/docks?warehouse_id=${whDock}`)
  check('[4e] Cửa 1 trống (occupied=0) sau khi cả A xong + B gỡ', (r.j?.data ?? []).find(d => d.id === dock1)?.occupied === 0)
  const gD = await mkGdo('D', whDock)
  r = await start(gD, { license_plate: 'QA56XE3', dock_location_id: dock1 })
  check('[4f] Xe tiếp theo vào Cửa 1 → 200 (xe trước hoàn thành thì xe sau mới chọn được)', r.s === 200, `http=${r.s} ${err(r)}`)

  // ═══ [5] Đổi cửa giữa chuyến ═══
  r = await api(`/wms/outbound/${gD}/dock`, 'PATCH', { dock_location_id: dock2 })
  check('[5a] Đổi D sang Cửa 2 (1/2 đang có C) → 200, dock=Cửa 2', r.s === 200 && r.j?.data?.dock_location_id === dock2, `http=${r.s} ${err(r)}`)
  const gE = await mkGdo('E', whDock)
  r = await start(gE, { license_plate: 'QA56XE4', dock_location_id: dock2 })
  check('[5b] Cửa 2 giờ 2/2 → xe thứ 3 → 422 DOCK_FULL', r.s === 422 && r.j?.error?.code === 'DOCK_FULL', `http=${r.s} ${err(r)}`)
  r = await api(`/wms/outbound/${gE}/dock`, 'PATCH', { dock_location_id: dock1 })
  check('[5c] Đổi cửa cho chuyến CHƯA Bắt đầu → 400', r.s === 400, `http=${r.s} ${err(r)}`)
  r = await api(`/wms/outbound/${gD}/dock`, 'PATCH', { dock_location_id: 'id-rac' })
  check('[5d] Đổi sang cửa rác → 404', r.s === 404, `http=${r.s} ${err(r)}`)
  r = await api(`/wms/outbound/${gD}/dock`, 'PATCH', {})
  check('[5e] Thiếu dock_location_id → 400', r.s === 400, `http=${r.s}`)

  // ═══ [6] Đua 5 người lấy 1 suất còn lại ═══
  r = await api(`/wms/outbound/${gD}/dock`, 'PATCH', { dock_location_id: dock1 })   // trả D về Cửa 1 → Cửa 2 còn 1/2
  const racers = []
  for (let i = 0; i < 5; i++) racers.push(await mkGdo(`R${i}`, whDock))
  const rs = await Promise.all(racers.map((g, i) => start(g, { license_plate: `QA56R${i}`, dock_location_id: dock2 })))
  const okN = rs.filter(x => x.s === 200).length, fullN = rs.filter(x => x.s === 422 && x.j?.error?.code === 'DOCK_FULL').length
  check('[6a] 5 xe khác biển cùng bấm vào Cửa 2 (còn 1 suất) → đúng 1×200 + 4×422 DOCK_FULL, 0×5xx', okN === 1 && fullN === 4 && rs.every(x => x.s < 500), `codes=${rs.map(x => x.s).join(',')}`)
  r = await api(`/wms/outbound/docks?warehouse_id=${whDock}`)
  check('[6b] Cửa 2 occupied = 2 = sức chứa (không vượt)', (r.j?.data ?? []).find(d => d.id === dock2)?.occupied === 2, `occ=${(r.j?.data ?? []).find(d => d.id === dock2)?.occupied}`)

  // ═══ [7] Kho KHÔNG có cửa → hành vi cũ ═══
  const gN = await mkGdo('N', whNone)
  r = await start(gN, { license_plate: 'QA56XE9' })
  check('[7a] Kho không vẽ cửa: Bắt đầu không cần cửa → 200, dock null', r.s === 200 && r.j?.data?.dock_location_id == null, `http=${r.s} ${err(r)}`)
  r = await api(`/wms/outbound/docks?warehouse_id=${whNone}`)
  check('[7b] GET docks kho không cửa → 200 []', r.s === 200 && Array.isArray(r.j?.data) && r.j.data.length === 0, `http=${r.s}`)

  // ═══ [8] Phạm vi kho — tài khoản kho lẻ không xem xe ở cửa kho khác ═══
  {
    let bcrypt = null
    try { bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(m => m.default ?? m) } catch { /* chưa npm i backend */ }
    if (!bcrypt) console.log('  ⏭  không load được bcrypt của backend — bỏ qua phép kiểm PHẠM VI KHO')
    else {
      const jid = randomUUID(), eid = randomUUID(), pw = 'Qa' + randomUUID().slice(0, 10) + '!'
      await restWrite('JobTitle', 'POST', '', [{ id: jid, name: `${T} chuc danh`, updated_at: now(), module_permissions: { outbound: ['view', 'start'] } }])
      await restWrite('Employee', 'POST', '', [{ id: eid, employee_code: `${T}01`, name: `${T} nv kho le`, email: `${T.toLowerCase()}01@test.local`,
        password: await bcrypt.hash(pw, 10), is_active: true, job_title_id: jid, warehouse_id: FIX.WH_QTY.id, warehouse_scope: 'ASSIGNED', updated_at: now() }])
      await restWrite('UserWarehouseAccess', 'POST', '', [{ id: randomUUID(), employee_id: eid, warehouse_id: FIX.WH_QTY.id }])
      const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${T.toLowerCase()}01@test.local`, password: pw }) })
      const tk = (await lr.json().catch(() => null))?.data?.token
      if (tk) {
        const sr = await fetch(`${BASE}/api/wms/outbound/docks?warehouse_id=${whDock}`, { headers: { Authorization: `Bearer ${tk}` } })
        check('[8a] Tài khoản ASSIGNED kho Bluestar hỏi cửa kho QA → 403', sr.status === 403, `http=${sr.status}`)
      } else console.log('  ⏭  [8a] không đăng nhập được tài khoản QA56 (throttle?) — bỏ qua')
      await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${eid}`).catch(() => {})
      await restWrite('Employee', 'DELETE', `id=eq.${eid}`).catch(() => {})
      await restWrite('JobTitle', 'DELETE', `id=eq.${jid}`).catch(() => {})
      await restWrite('auth_login_events', 'DELETE', `email=like.${T.toLowerCase()}*`).catch(() => {})
    }
  }

  // ═══ [9] Gỡ cửa đang có xe → 409? (cửa không chứa pallet nên gỡ được; chuyến giữ dock id mềm) — chỉ kiểm không 5xx ═══
  r = await api(`/wms/warehouse-map/${whDock}/objects/${dock2}`, 'DELETE')
  check('[9a] Gỡ cửa đang có xe → không 5xx (mềm, FK SET NULL không kích vì is_active=false)', r.s < 500, `http=${r.s} ${err(r)}`)
} finally {
  await cleanup()
  const left = await restAll('GroupDeliveryOrder', `select=id&group_code=like.${T}*`)
  const leftWh = await restAll('Warehouse', `select=id&code=like.${T}*`)
  check('[10] Dọn: 0 chuyến, 0 kho QA56 sót', left.length === 0 && leftWh.length === 0, `gdo=${left.length} wh=${leftWh.length}`)
}

finish('56-dock-capacity')
