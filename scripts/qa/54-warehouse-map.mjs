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

// 3 chân kệ Ba Vì CHƯA đặt (grid_x null), mỗi chân ≥2 tầng, khác row nhau
const locs = await restAll('Location', `select=id,location_code,sub_code,row,shelf,kind,level_no,grid_x&warehouse_id=eq.${WH}&is_active=is.true&kind=eq.STORAGE&grid_x=is.null&order=location_code&limit=400`)
const byFoot = new Map()
for (const l of locs) { const k = `${l.sub_code}|${l.row}`; (byFoot.get(k) ?? byFoot.set(k, []).get(k)).push(l) }
const feet = [...byFoot.values()].filter(a => a.length >= 2).slice(0, 3)
check('[0] Fixture: ≥3 chân kệ Ba Vì có ≥2 tầng chưa đặt lên bản vẽ', feet.length === 3, `có ${feet.length}`)
const touched = feet.flat().map(l => l.id)

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
  r = await asg(A.map(l => ({ location_id: l.id, grid_x: 1, grid_y: 1 })))
  check('[3a] Đặt cả các tầng chân kệ A vào ô (1,1) → 200, updated = số tầng', r.s === 200 && r.j?.data?.updated === A.length, `http=${r.s} ${err(r)} updated=${r.j?.data?.updated}`)
  r = await asg([{ location_id: B[0].id, grid_x: 1, grid_y: 1 }])
  check('[3b] Chân kệ B đè ô (1,1) → 409 CELL_CONFLICT nêu 2 mã', r.s === 409 && r.j?.error?.code === 'CELL_CONFLICT' && (r.j?.error?.message ?? '').includes(A[0].location_code), `http=${r.s} ${err(r)}`)
  r = await asg([{ location_id: B[0].id, grid_x: 2, grid_y: 1, grid_w: 2, grid_h: 1 }])
  check('[3c] Chân kệ B khối 2×1 tại (2,1) → 200', r.s === 200, `http=${r.s} ${err(r)}`)
  r = await asg([{ location_id: C[0].id, grid_x: 3, grid_y: 1 }])
  check('[3d] Chân kệ C tại (3,1) giao với khối B (2..3,1) → 409', r.s === 409 && r.j?.error?.code === 'CELL_CONFLICT', `http=${r.s} ${err(r)}`)
  r = await asg([{ location_id: C[0].id, grid_x: 999, grid_y: 999 }])
  check('[3e] Ngoài khung → 400 OUT_OF_BOUNDS (kho đã có khung)', r.s === 400 && (r.j?.error?.code === 'OUT_OF_BOUNDS' || r.j?.error?.code === 'VALIDATION_ERROR'), `http=${r.s} ${err(r)}`)
  r = await asg([{ location_id: C[0].id, grid_x: 4, grid_y: null }])
  check('[3f] Nửa toạ độ → 400', r.s === 400, `http=${r.s} ${err(r)}`)
  // Kho khác BẤT KỲ có vị trí (Bluestar QTY không có ô nào — lấy kho nào có, vd Bàu Bàng)
  const other = await restAll('Location', `select=id&warehouse_id=neq.${WH}&is_active=is.true&kind=eq.STORAGE&limit=1`)
  check('[3g0] Fixture: có vị trí của kho khác để thử IDOR cặp id', other.length === 1)
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

  // ═══ [4] Cửa / bãi / điểm đầu dãy ═══
  r = await api(`/wms/warehouse-map/${WH}/objects`, 'POST', { kind: 'DOCK_OUT', name: `${T} cua xuat`, grid_x: 10, grid_y: 10 })
  check('[4a] Tạo cửa xuất tại ô trống → 201, kind=DOCK_OUT, có grid', r.s === 201 && r.j?.data?.kind === 'DOCK_OUT' && r.j?.data?.grid_x === 10, `http=${r.s} ${err(r)}`)
  createdObj = r.j?.data ?? null
  r = await api(`/wms/warehouse-map/${WH}/objects`, 'POST', { kind: 'DROP', name: `${T} dau day`, grid_x: 1, grid_y: 1 })
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
  check('[5c] GET bản vẽ có cửa xuất + chân kệ A tại (1,1)', r.s === 200 && (r.j?.data?.locations ?? []).some(l => l.kind === 'DOCK_OUT' && String(l.location_code).includes(T)) && (r.j?.data?.locations ?? []).some(l => l.id === A[0].id && l.grid_x === 1 && l.grid_y === 1), `http=${r.s}`)

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
  }
} finally {
  // ═══ DỌN: trả toạ độ 3 chân kệ về NULL, xoá cửa QA54, xoá khung nếu do gói tạo, xoá tài khoản ═══
  await api(`/wms/warehouse-map/${WH}/cells`, 'PATCH', { items: touched.map(id => ({ location_id: id, grid_x: null, grid_y: null })) }).catch(() => {})
  await wipe()
  if (!priorMap) await restWrite('warehouse_maps', 'DELETE', `warehouse_id=eq.${WH}`).catch(() => {})
  const left = await restAll('Location', `select=id&warehouse_id=eq.${WH}&grid_x=not.is.null&id=in.(${touched.join(',')})`)
  check('[9] Dọn: 3 chân kệ về NULL toạ độ, 0 dòng QA54 sót', left.length === 0 && (await restAll('Location', `select=id&location_code=like.*${T}*`)).length === 0, `còn ${left.length}`)
}

finish('54-warehouse-map')
