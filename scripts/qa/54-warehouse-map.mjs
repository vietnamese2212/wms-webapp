// GÓI 54 — SƠ ĐỒ KHO (08/09/2026): khung lưới theo kho + vị trí/cửa/bãi đặt lên lưới.
//
// Vì sao có gói này: bản vẽ là nền của Directed Work (bảng Cần hạ, đường đi) — sai một luật ở đây thì
// mọi thứ dựng lên trên đều chỉ nhầm chỗ. Ba thứ dễ vỡ nhất, mỗi thứ ≥1 phép kiểm:
//   (a) TẦNG dùng chung ô: hai tầng cùng chân kệ chung ô = ĐÚNG; hai chân kệ khác chung ô = 409 (không 500, không lặng lẽ đè);
//   (b) id rác / kho khác / ngoài khung → 4xx sạch, không "Lỗi hệ thống"; tài khoản kho lẻ không mở được bản vẽ kho khác;
//   (c) cửa/bãi là Location kind ≠ STORAGE — KHÔNG được lọt vào ô chọn vị trí cất hàng (listLocations mặc định).
// An toàn: chỉ đụng dòng tự tạo (tiền tố QA54) + toạ độ của 3 chân kệ Ba Vì (trả về NULL ở cuối);
// khung bản vẽ của kho: có sẵn thì GIỮ NGUYÊN (không sửa), chưa có thì tạo rồi xoá.
import { api, login, restAll, restWrite, check, finish, resolveFixtures, HAS_DB, FIX, BASE } from './lib.mjs'
import { randomUUID } from 'crypto'

if (!HAS_DB) { console.error('Thiếu backend/.env — gói 54 cần soi DB'); process.exit(1) }

const T = 'QA54'
const WH = FIX.WH_QR.id
const now = () => new Date().toISOString()
const err = r => `${r.j?.error?.code ?? ''} ${(r.j?.error?.message ?? '').slice(0, 90)}`.trim()

console.log('── GÓI 54: Sơ đồ kho — khung lưới · tầng chung ô · cửa/bãi · phạm vi kho ──')
await login()
await resolveFixtures()

// ═══ DỌN TRƯỚC ═══
async function wipe() {
  await restWrite('Location', 'DELETE', `location_code=like.*${T}*`).catch(() => {})
  for (const e of await restAll('Employee', `select=id&employee_code=like.${T}*`)) {
    await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${e.id}`).catch(() => {})
    await restWrite('Employee', 'DELETE', `id=eq.${e.id}`).catch(() => {})
  }
  await restWrite('JobTitle', 'DELETE', `name=like.${T}*`).catch(() => {})
  await restWrite('auth_login_events', 'DELETE', `email=like.${T.toLowerCase()}*`).catch(() => {})
}
await wipe()

// Khung có sẵn? (giữ nguyên nếu có — chỉ xoá khung do gói này tạo)
const priorMap = (await restAll('warehouse_maps', `select=warehouse_id&warehouse_id=eq.${WH}`)).length > 0

// 3 chân kệ Ba Vì mỗi chân ≥2 tầng, khác row. Ưu tiên chân CHƯA đặt; bản vẽ đang được người dùng vẽ thật (08/09) có thể
// đã đặt gần hết → lấy cả chân đã đặt, GỠ TẠM rồi TRẢ LẠI đúng toạ độ cũ ở cuối (không xoá công của người vẽ).
const locsAll = await restAll('Location', `select=id,location_code,sub_code,row,shelf,kind,level_no,grid_x,grid_y,grid_w,grid_h&warehouse_id=eq.${WH}&is_active=is.true&kind=eq.STORAGE&order=location_code&limit=1000`)
const byFoot = new Map()
for (const l of locsAll) { const k = `${l.sub_code}|${l.row}`; (byFoot.get(k) ?? byFoot.set(k, []).get(k)).push(l) }
const multi = [...byFoot.values()].filter(a => a.length >= 2)
const feet = [...multi.filter(a => a.every(l => l.grid_x == null)), ...multi.filter(a => a.some(l => l.grid_x != null))].slice(0, 3)
check('[0] Fixture: ≥3 chân kệ Ba Vì có ≥2 tầng (ưu tiên chưa đặt; đã đặt thì gỡ tạm, trả lại ở cuối)', feet.length === 3, `có ${feet.length} · gỡ tạm: ${feet.filter(a => a.some(l => l.grid_x != null)).length}`)
const original = feet.flat().map(l => ({ location_id: l.id, grid_x: l.grid_x, grid_y: l.grid_y, grid_w: l.grid_w ?? 1, grid_h: l.grid_h ?? 1 }))
const touched = original.map(o => o.location_id)
// Vùng TRỐNG để đặt fixture: hàng thấp nhất trong khung có 6 ô liên tiếp chưa ai dùng (chân kệ, cửa, tường). Khung chưa có → 40×30 tạo ở [2c].
const used = new Set()
const mark = l => { for (let dx = 0; dx < (l.grid_w ?? 1); dx++) for (let dy = 0; dy < (l.grid_h ?? 1); dy++) used.add(`${l.grid_x + dx},${l.grid_y + dy}`) }
for (const l of locsAll) if (l.grid_x != null) mark(l)
for (const l of await restAll('Location', `select=grid_x,grid_y,grid_w,grid_h&warehouse_id=eq.${WH}&is_active=is.true&kind=neq.STORAGE&grid_x=not.is.null`)) mark(l)
const mapRow = (await restAll('warehouse_maps', `select=width,height,blocked&warehouse_id=eq.${WH}`))[0]
for (const [x, y] of mapRow?.blocked ?? []) used.add(`${x},${y}`)
const FW = mapRow?.width ?? 40, FH = mapRow?.height ?? 30
let BX = 0, BY = FH - 2
outer: for (let y = FH - 2; y >= 0; y--) for (let x = 0; x + 6 <= FW; x++) {
  let ok = true
  for (let i = 0; i < 6; i++) if (used.has(`${x + i},${y}`)) { ok = false; break }
  if (ok) { BX = x; BY = y; break outer }
}
console.log(`  vùng fixture trống: ô (${BX}..${BX + 5}, ${BY}) trong khung ${FW}×${FH}`)

// Tài khoản PHẠM VI HẸP (kho Bluestar) có quyền warehouse_map.view → không được mở bản vẽ Ba Vì
let scoped = null
{
  let bcrypt = null
  try { bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(m => m.default ?? m) } catch { /* chưa npm i backend */ }
  if (!bcrypt) console.log('  ⏭  không load được bcrypt của backend — bỏ qua phép kiểm PHẠM VI KHO')
  else {
    const jid = randomUUID(), eid = randomUUID(), pw = 'Qa' + randomUUID().slice(0, 10) + '!'
    await restWrite('JobTitle', 'POST', '', [{ id: jid, name: `${T} chuc danh`, updated_at: now(), module_permissions: { warehouse_map: ['view'] } }])
    await restWrite('Employee', 'POST', '', [{ id: eid, employee_code: `${T}01`, name: `${T} nv kho le`, email: `${T.toLowerCase()}01@test.local`,
      password: await bcrypt.hash(pw, 10), is_active: true, job_title_id: jid, warehouse_id: FIX.WH_QTY.id, warehouse_scope: 'ASSIGNED', updated_at: now() }])
    await restWrite('UserWarehouseAccess', 'POST', '', [{ id: randomUUID(), employee_id: eid, warehouse_id: FIX.WH_QTY.id }])
    const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${T.toLowerCase()}01@test.local`, password: pw }) })
    const tk = (await lr.json().catch(() => null))?.data?.token
    check('[0b] Đăng nhập tài khoản ASSIGNED kho Bluestar (chỉ quyền xem sơ đồ)', !!tk, `http=${lr.status}`)
    if (tk) scoped = async (path, method = 'GET', body) => {
      const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: body ? JSON.stringify(body) : undefined })
      let j = null; try { j = JSON.parse(await r.text()) } catch { /* không JSON */ }
      return { s: r.status, j }
    }
  }
}

let createdObj = null
try {
  // Gỡ tạm các chân kệ fixture đang có toạ độ (trả lại ở finally)
  if (original.some(o => o.grid_x != null)) await api(`/wms/warehouse-map/${WH}/cells`, 'PATCH', { items: touched.map(id => ({ location_id: id, grid_x: null, grid_y: null })) })
  // ═══ [1] GET bản vẽ ═══
  let r = await api(`/wms/warehouse-map/${WH}`)
  check('[1a] GET bản vẽ kho Ba Vì → 200 + {warehouse, map, locations[]}', r.s === 200 && r.j?.data?.warehouse?.id === WH && Array.isArray(r.j?.data?.locations), `http=${r.s} n=${r.j?.data?.locations?.length}`)
  const L = r.j?.data?.locations ?? []
  check('[1b] Mọi vị trí có kind + level_no (backfill từ mã ô) — kệ có tầng ≥1', L.length > 200 && L.every(l => l.kind && (l.level_no == null || l.level_no >= 0)) && L.filter(l => l.is_rack).length > 100, `n=${L.length} racks=${L.filter(l => l.is_rack).length}`)
  r = await api('/wms/warehouse-map/khong-ton-tai')
  check('[1c] id kho rác → 404, không 5xx', r.s === 404, `http=${r.s} ${err(r)}`)
  r = await api(`/wms/warehouse-map/${encodeURIComponent("' or 1=1 --")}`)
  check('[1d] id kho trông như injection → 4xx sạch', r.s >= 400 && r.s < 500, `http=${r.s}`)

  // ═══ [2] Khung lưới ═══
  r = await api(`/wms/warehouse-map/${WH}`, 'PUT', { width: 2, height: 30 })
  check('[2a] Khung 2 ô → 400 (tối thiểu 5)', r.s === 400, `http=${r.s} ${err(r)}`)
  r = await api(`/wms/warehouse-map/${WH}`, 'PUT', { width: 40, height: 30, cell_m: 1.2, blocked: [[99, 0]] })
  check('[2b] Tường ngoài lưới → 400 nêu ô', r.s === 400 && /99/.test(r.j?.error?.message ?? ''), `http=${r.s} ${err(r)}`)
  if (!priorMap) {
    r = await api(`/wms/warehouse-map/${WH}`, 'PUT', { width: 40, height: 30, cell_m: 1.2, blocked: [[5, 5], [5, 5], [6, 5]] })
    check('[2c] Dựng khung 40×30, tường trùng được khử → 200, blocked=2', r.s === 200 && r.j?.data?.width === 40 && r.j?.data?.blocked?.length === 2, `http=${r.s} ${err(r)}`)
  } else console.log('  ⏭  [2c] kho đã có khung thật — không ghi đè')

  // ═══ [3] Tầng chung ô · chân kệ khác chung ô = 409 ═══
  const [A, B, C] = feet
  const asg = items => api(`/wms/warehouse-map/${WH}/cells`, 'PATCH', { items })
  r = await asg(A.map(l => ({ location_id: l.id, grid_x: BX, grid_y: BY })))
  check(`[3a] Đặt cả các tầng chân kệ A vào ô (${BX},${BY}) → 200, updated = số tầng`, r.s === 200 && r.j?.data?.updated === A.length, `http=${r.s} ${err(r)} updated=${r.j?.data?.updated}`)
  r = await asg([{ location_id: B[0].id, grid_x: BX, grid_y: BY }])
  check('[3b] Chân kệ B đè ô của A → 409 CELL_CONFLICT nêu 2 mã', r.s === 409 && r.j?.error?.code === 'CELL_CONFLICT' && (r.j?.error?.message ?? '').includes(A[0].location_code), `http=${r.s} ${err(r)}`)
  r = await asg([{ location_id: B[0].id, grid_x: BX + 1, grid_y: BY, grid_w: 2, grid_h: 1 }])
  check(`[3c] Chân kệ B khối 2×1 tại (${BX + 1},${BY}) → 200`, r.s === 200, `http=${r.s} ${err(r)}`)
  r = await asg([{ location_id: C[0].id, grid_x: BX + 2, grid_y: BY }])
  check('[3d] Chân kệ C đặt vào ô thứ 2 của khối B → 409', r.s === 409 && r.j?.error?.code === 'CELL_CONFLICT', `http=${r.s} ${err(r)}`)
  // Thu khung phải kiểm MÉP khối (neo + grid_w), không chỉ ô neo: khối B neo BX+1 rộng 2 → khung rộng BX+2 lọt kiểm neo nhưng B tràn.
  // Chỉ kết luận được khi không có vị trí khác đứng xa hơn mép mới (bản vẽ thật có → bỏ qua có ghi chú).
  {
    const wNew = BX + 2, hNew = FH
    const others = L.filter(l => l.grid_x != null && l.id !== B[0].id && !touched.includes(l.id) && (l.grid_x + (l.grid_w ?? 1) > wNew || l.grid_y + (l.grid_h ?? 1) > hNew))
    if (!others.length && priorMap) {
      r = await api(`/wms/warehouse-map/${WH}`, 'PUT', { width: wNew, height: hNew, cell_m: mapRow?.cell_m ?? 1.2, blocked: (mapRow?.blocked ?? []).filter(([x, y]) => x < wNew && y < hNew) })
      check(`[3d2] Thu khung về rộng ${wNew} (neo B trong, MÉP B tràn) → 409 LOCATIONS_OUTSIDE`, r.s === 409 && r.j?.error?.code === 'LOCATIONS_OUTSIDE', `http=${r.s} ${err(r)}`)
    } else console.log(`  ⏭  [3d2] bỏ qua: ${!priorMap ? 'kho chưa có khung' : `${others.length} vị trí khác cũng vượt mép ${wNew}×${hNew}`} — không tách được luật mép khối`)
  }
  r = await asg([{ location_id: C[0].id, grid_x: 999, grid_y: 999 }])
  check('[3e] Ngoài khung → 400 OUT_OF_BOUNDS (kho đã có khung)', r.s === 400 && (r.j?.error?.code === 'OUT_OF_BOUNDS' || r.j?.error?.code === 'VALIDATION_ERROR'), `http=${r.s} ${err(r)}`)
  r = await asg([{ location_id: C[0].id, grid_x: 4, grid_y: null }])
  check('[3f] Nửa toạ độ → 400', r.s === 400, `http=${r.s} ${err(r)}`)
  // Kho khác BẤT KỲ có vị trí (Bluestar QTY không có ô nào — lấy kho nào có, vd Bàu Bàng)
  const other = await restAll('Location', `select=id&warehouse_id=neq.${WH}&is_active=is.true&kind=eq.STORAGE&limit=1`)
  // restAll tự gắn limit=1000 nên `limit=1` trên filter không cắt — chỉ cần ≥1
  check('[3g0] Fixture: có vị trí của kho khác để thử IDOR cặp id', other.length >= 1)
  if (other.length) {
    r = await asg([{ location_id: other[0].id, grid_x: 4, grid_y: 4 }])
    check('[3g] Vị trí của KHO KHÁC ghép vào URL kho Ba Vì → 400 NOT_IN_WAREHOUSE (chống IDOR cặp id)', r.s === 400 && r.j?.error?.code === 'NOT_IN_WAREHOUSE', `http=${r.s} ${err(r)}`)
  }
  r = await api(`/wms/warehouse-map/${WH}/objects/${encodeURIComponent("' or 1=1 --")}`, 'DELETE')
  check('[3m] id cửa trông như injection trên đường dẫn → 400, không 5xx', r.s === 400, `http=${r.s} ${err(r)}`)
  r = await asg([{ location_id: 'id-rac', grid_x: 4, grid_y: 4 }])
  check('[3h] location_id rác → 400, không 5xx', r.s === 400, `http=${r.s} ${err(r)}`)
  // Đánh Kệ/Sàn cả chân kệ
  r = await api(`/wms/warehouse-map/${WH}/footprint`, 'PATCH', { location_ids: A.map(l => l.id), is_rack: false })
  check('[3i] Đánh chân kệ A là SÀN → 200 updated = số tầng', r.s === 200 && r.j?.data?.updated === A.length, `http=${r.s} ${err(r)}`)
  const aNow = await restAll('Location', `select=is_rack&id=in.(${A.map(l => l.id).join(',')})`)
  check('[3j] DB: mọi tầng của A is_rack=false', aNow.length === A.length && aNow.every(x => x.is_rack === false))
  r = await api(`/wms/warehouse-map/${WH}/footprint`, 'PATCH', { location_ids: A.map(l => l.id), is_rack: true })
  check('[3k] Trả lại KỆ → 200', r.s === 200, `http=${r.s}`)
  r = await api(`/wms/warehouse-map/${WH}/footprint`, 'PATCH', { location_ids: ['khong-co'], is_rack: true })
  check('[3l] id không thuộc kho → 404 (không "đã cập nhật" giả)', r.s === 404, `http=${r.s} ${err(r)}`)
  // Chọn nhiều chân kệ → đánh Kệ/Sàn một lượt: >100 id phải được chia lô, KHÔNG cắt âm thầm 100 dòng đầu
  // (giá trị giữ nguyên is_rack=true nên dữ liệu demo không đổi)
  const rackIds = L.filter(l => l.is_rack && l.kind === 'STORAGE').slice(0, 120).map(l => l.id)
  r = await api(`/wms/warehouse-map/${WH}/footprint`, 'PATCH', { location_ids: rackIds, is_rack: true })
  check('[3n] 120 id (chọn nhiều) → 200, updated = 120 (chia lô 100, không cắt)', r.s === 200 && r.j?.data?.updated === rackIds.length, `http=${r.s} updated=${r.j?.data?.updated} gửi=${rackIds.length}`)

  // ═══ [4] Cửa / bãi / điểm đầu dãy ═══
  r = await api(`/wms/warehouse-map/${WH}/objects`, 'POST', { kind: 'DOCK_OUT', name: `${T} cua xuat`, grid_x: BX + 4, grid_y: BY })
  check('[4a] Tạo cửa xuất tại ô trống → 201, kind=DOCK_OUT, có grid', r.s === 201 && r.j?.data?.kind === 'DOCK_OUT' && r.j?.data?.grid_x === BX + 4, `http=${r.s} ${err(r)}`)
  createdObj = r.j?.data ?? null
  r = await api(`/wms/warehouse-map/${WH}/objects`, 'POST', { kind: 'DROP', name: `${T} dau day`, grid_x: BX, grid_y: BY })
  check('[4b] Điểm đầu dãy đè lên ô kệ A → 409, KHÔNG để lại dòng rác', r.s === 409, `http=${r.s} ${err(r)}`)
  const rac = await restAll('Location', `select=id&location_code=like.*${T}DAUDAY*`)
  check('[4c] DB: không còn dòng điểm đầu dãy thất bại', rac.length === 0, `n=${rac.length}`)
  r = await api(`/wms/warehouse-map/${WH}/objects`, 'POST', { kind: 'STORAGE', name: 'x', grid_x: 12, grid_y: 12 })
  check('[4d] kind STORAGE qua cửa objects → 400', r.s === 400, `http=${r.s}`)
  r = await api(`/wms/warehouse-map/${WH}/objects`, 'POST', { kind: 'DOCK_IN', name: '', grid_x: 12, grid_y: 12 })
  check('[4e] Thiếu tên → 400', r.s === 400, `http=${r.s}`)
  if (createdObj) {
    r = await api(`/wms/warehouse-map/${WH}/objects/${createdObj.id}`, 'PATCH', { name: `${T} cua xuat 2` })
    check('[4f] Đổi tên cửa → 200', r.s === 200 && r.j?.data?.name === `${T} cua xuat 2`, `http=${r.s} ${err(r)}`)
    r = await api(`/wms/warehouse-map/${WH}/objects/${A[0].id}`, 'PATCH', { name: 'x' })
    check('[4g] Đổi tên trên ô CHỨA HÀNG qua cửa objects → 404', r.s === 404, `http=${r.s}`)
    r = await api(`/wms/warehouse-map/${WH}/objects/${A[0].id}`, 'DELETE')
    check('[4h] Gỡ ô chứa hàng qua cửa objects → 400 NOT_OBJECT', r.s === 400 && r.j?.error?.code === 'NOT_OBJECT', `http=${r.s} ${err(r)}`)
  }

  // ═══ [5] Cửa/bãi KHÔNG lọt vào ô chọn vị trí cất hàng ═══
  r = await api(`/masterdata/locations?warehouse_id=${WH}&view=lite&limit=300&search=${encodeURIComponent(T)}`)
  check('[5a] listLocations mặc định (picker) không trả cửa xuất QA54', r.s === 200 && !(r.j?.data ?? []).some(l => String(l.location_code).includes(T)), `http=${r.s} n=${r.j?.data?.length}`)
  r = await api(`/masterdata/locations?warehouse_id=${WH}&view=lite&limit=300&kind=DOCK_OUT`)
  check('[5b] ?kind=DOCK_OUT trả về cửa xuất', r.s === 200 && (r.j?.data ?? []).some(l => String(l.location_code).includes(T)), `http=${r.s} n=${r.j?.data?.length}`)
  r = await api(`/wms/warehouse-map/${WH}`)
  check('[5c] GET bản vẽ có cửa xuất + chân kệ A tại ô fixture', r.s === 200 && (r.j?.data?.locations ?? []).some(l => l.kind === 'DOCK_OUT' && String(l.location_code).includes(T)) && (r.j?.data?.locations ?? []).some(l => l.id === A[0].id && l.grid_x === BX && l.grid_y === BY), `http=${r.s}`)

  // ═══ [6] Tồn theo ô · tìm ═══
  r = await api(`/wms/warehouse-map/${WH}/occupancy`)
  check('[6a] occupancy → 200 mảng {location_id,pallets,materials}', r.s === 200 && Array.isArray(r.j?.data) && (r.j.data.length === 0 || ('pallets' in r.j.data[0] && 'materials' in r.j.data[0])), `http=${r.s} n=${r.j?.data?.length}`)
  r = await api(`/wms/warehouse-map/${WH}/find?q=${encodeURIComponent(FIX.MAT_POOL)}`)
  check('[6b] find theo mã hàng → 200 {hits[]}', r.s === 200 && Array.isArray(r.j?.data?.hits), `http=${r.s} hits=${r.j?.data?.hits?.length}`)
  r = await api(`/wms/warehouse-map/${WH}/find?q=a`)
  check('[6c] q 1 ký tự → 200 rỗng (không quét cả kho)', r.s === 200 && r.j?.data?.hits?.length === 0, `http=${r.s}`)
  r = await api(`/wms/warehouse-map/${WH}/find?q=${encodeURIComponent("x' or 1=1--")}`)
  check('[6d] q trông như injection → 400', r.s === 400, `http=${r.s} ${err(r)}`)

  // ═══ [7] Phạm vi kho + quyền ═══
  if (scoped) {
    r = await scoped(`/wms/warehouse-map/${WH}`)
    check('[7a] Tài khoản kho Bluestar mở bản vẽ Ba Vì → 403', r.s === 403, `http=${r.s} ${err(r)}`)
    r = await scoped(`/wms/warehouse-map/${FIX.WH_QTY.id}`)
    check('[7b] …mở bản vẽ kho mình → 200', r.s === 200, `http=${r.s} ${err(r)}`)
    r = await scoped(`/wms/warehouse-map/${FIX.WH_QTY.id}`, 'PUT', { width: 20, height: 20 })
    check('[7c] Chỉ có view → PUT khung → 403', r.s === 403, `http=${r.s} ${err(r)}`)
    r = await scoped(`/wms/warehouse-map/${WH}/cells`, 'PATCH', { items: [{ location_id: A[0].id, grid_x: 5, grid_y: 5 }] })
    check('[7d] Chỉ có view → PATCH cells kho khác → 403', r.s === 403, `http=${r.s}`)
  }

  // ═══ [8] Gỡ cửa ═══
  if (createdObj) {
    r = await api(`/wms/warehouse-map/${WH}/objects/${createdObj.id}`, 'DELETE')
    check('[8a] Gỡ cửa xuất → 200', r.s === 200, `http=${r.s} ${err(r)}`)
    r = await api(`/wms/warehouse-map/${WH}/objects/${createdObj.id}`, 'DELETE')
    check('[8b] Gỡ lần 2 → 404', r.s === 404, `http=${r.s}`)
    r = await api(`/wms/warehouse-map/${WH}`)
    check('[8c] Bản vẽ không còn cửa đã gỡ (is_active=false)', r.s === 200 && !(r.j?.data?.locations ?? []).some(l => l.id === createdObj.id), `http=${r.s}`)
    // Hoàn tác "gỡ cửa" trên trình vẽ = tạo lại cùng tên → phải HỒI SINH dòng cũ (cùng id), không 409 trùng mã
    r = await api(`/wms/warehouse-map/${WH}/objects`, 'POST', { kind: 'DOCK_OUT', name: `${T} cua xuat`, grid_x: BX + 4, grid_y: BY })
    check('[8d] Tạo lại cửa cùng tên sau khi gỡ → 201, CÙNG id (hồi sinh dòng mềm — nền của Hoàn tác)', r.s === 201 && r.j?.data?.id === createdObj.id && r.j?.data?.grid_x === BX + 4, `http=${r.s} ${err(r)} id=${r.j?.data?.id === createdObj.id ? 'giữ' : 'ĐỔI'}`)
    r = await api(`/wms/warehouse-map/${WH}/objects/${createdObj.id}`, 'DELETE')
    check('[8e] Gỡ lại lần nữa → 200', r.s === 200, `http=${r.s} ${err(r)}`)
  }
} finally {
  // ═══ DỌN: trả 3 chân kệ về ĐÚNG toạ độ cũ (NULL nếu vốn chưa đặt), xoá cửa QA54 TRƯỚC (nhường ô), xoá khung nếu do gói tạo, xoá tài khoản ═══
  await wipe()
  await api(`/wms/warehouse-map/${WH}/cells`, 'PATCH', { items: touched.map(id => ({ location_id: id, grid_x: null, grid_y: null })) }).catch(() => {})
  await api(`/wms/warehouse-map/${WH}/cells`, 'PATCH', { items: original }).catch(() => {})
  if (!priorMap) await restWrite('warehouse_maps', 'DELETE', `warehouse_id=eq.${WH}`).catch(() => {})
  const after = await restAll('Location', `select=id,grid_x,grid_y,grid_w,grid_h&id=in.(${touched.join(',')})`)
  const lech = original.filter(o => { const a = after.find(x => x.id === o.location_id); return !a || a.grid_x !== o.grid_x || a.grid_y !== o.grid_y || (o.grid_x != null && (a.grid_w !== o.grid_w || a.grid_h !== o.grid_h)) })
  check('[9] Dọn: 3 chân kệ về đúng toạ độ cũ, 0 dòng QA54 sót', lech.length === 0 && (await restAll('Location', `select=id&location_code=like.*${T}*`)).length === 0, `lệch ${lech.length}`)
}

finish('54-warehouse-map')
