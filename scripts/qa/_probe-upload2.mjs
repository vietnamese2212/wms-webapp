// PROBE 04/08 đợt 2 — biên dạng FILE THẬT + gác upload + thứ tự gác/RPC.
//  U1 ô GỘP cột "Số xe" (Excel merge) — trước đây mất DO âm thầm
//  U2 dòng TRÙNG (Số xe, DO) trong cùng file — trước đây kiểm-trước XANH rồi ghi thật 500
//  U3 upload đổi CỬA / đổi NGÀY khi xe đang GIỮ khung giờ — cửa ghi thứ 6
//  U4 gom chung sai cửa → 422 mà xe CHÍNH có bị chiếm chỗ oan không (gác chạy trước RPC chưa)
import { randomUUID } from 'crypto'
import { login, api, restAll, restWrite, resolveFixtures, FIX, BASE } from './lib.mjs'

const XLSX = (await import('../../backend/node_modules/xlsx/xlsx.mjs')).default
  ?? await import('../../backend/node_modules/xlsx/xlsx.mjs')
const t = () => new Date().toISOString()
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const DAY  = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const DAY2 = new Date(Date.now() + 2 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
let pass = 0, fail = 0
const check = (n, ok, note = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${n}${note ? ` — ${note}` : ''}`) }

await login(); await resolveFixtures()
const vehTypeName = (await restAll('VehicleType', 'select=name&is_active=eq.true&order=name&limit=1'))[0]?.name
const vtId = (await restAll('VehicleType', 'select=id&is_active=eq.true&order=name&limit=1'))[0]?.id
const dvvtName = (await restAll('TransportCompany', 'select=name&type=eq.ĐVVT&order=name&limit=1'))[0]?.name
const cats = (await restAll('LookupValue', 'select=value&type=eq.warehouse_type&order=sort_order')).map(x => x.value)
const CUA_A = cats[0], CUA_B = cats[1]
const WH = FIX.WH_QTY
const [y, m, d] = today.split('-')
const GC = n => `${WH.code}_X_${d}${m}${y.slice(2)}_9${n}`
const ALL_GC = [GC(1), GC(2), GC(3), GC(4)]
const DOs = ['QAUP01', 'QAUP02', 'QAUP03', 'QAUP04', 'QAUP05']
const TIMES = ['18:00:00', '18:30:00']

async function cleanup() {
  for (const gc of ALL_GC) {
    for (const g of await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${gc}`)) {
      const dos = await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`)
      if (dos.length) {
        await restWrite('OutboundItem', 'DELETE', `do_id=in.(${dos.map(x => x.id).join(',')})`).catch(() => {})
        await restWrite('OutboundDelivery', 'DELETE', `gdo_id=eq.${g.id}`)
      }
      await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${g.id}`)
    }
    for (const o of await restAll('TmsOrder', `select=id&order_code=eq.${gc}`)) {
      await restWrite('TmsVehicleSlot', 'DELETE', `order_id=eq.${o.id}`)
      await restWrite('TmsOrder', 'DELETE', `id=eq.${o.id}`)
    }
    await restWrite('outbound_events', 'DELETE', `group_code=eq.${gc}`).catch(() => {})
    await restWrite('khvc_lines', 'DELETE', `group_code=eq.${gc}`)
  }
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=in.(${DOs.join(',')})`)
  for (const tm of TIMES)
    await restWrite('DeliverySlot', 'DELETE', `time_from=eq.${tm}&warehouse_id=eq.${WH.id}&date=in.(${DAY},${DAY2})`).catch(() => {})
}
const seedRaw = (doNo, qty) => restWrite('erp_outbound_orders', 'POST', null, {
  id: randomUUID(), od_number: doNo, od_item: '10', material_code: FIX.MAT_POOL, qty_base: qty,
  ship_to_code: 'QAUP', ship_to_name: 'QA UPLOAD NPP', source: 'EXCEL', sync_status: 'ACTIVE',
  last_synced_at: t(), updated_at: t(),
})
const tok = await (async () => {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.QA_ADMIN_EMAIL || 'admin', password: process.env.QA_ADMIN_PASSWORD || 'Bavi1234' }) })
  return (await r.json())?.data?.token
})()
// upload nhận SHEET đã dựng sẵn (để cài được ô GỘP), không chỉ mảng object
const uploadWs = async (ws, preflight) => {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'KHVC')
  const fd = new FormData()
  fd.append('file', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'khvc.xlsx')
  const r = await fetch(`${BASE}/api/wms/outbound/upload-khvc${preflight ? '?preflight=1' : ''}`,
    { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd })
  let j = null; try { j = JSON.parse(await r.text()) } catch { /* */ }
  return { s: r.status, j }
}
const sheetOf = rows => XLSX.utils.json_to_sheet(rows)
const base = { 'Tên NPP': 'QA UPLOAD NPP', 'Ngày xuất': DAY, 'Loại xe': vehTypeName, 'DVVT': dvvtName }
const mkSlot = (time, cargo, date = DAY) => {
  const id = randomUUID()
  return restWrite('DeliverySlot', 'POST', null, {
    id, date, time_from: time, time_to: '23:59:00', direction: 'OUTBOUND', vehicle_type_id: vtId,
    cargo_type: cargo, warehouse_id: WH.id, max_vehicles: 5, booked_count: 0, status: 'OPEN',
    created_at: t(), updated_at: t(),
  }).then(() => id)
}

console.log(`── PROBE upload đợt 2 · ${BASE.replace('https://', '')} · cửa ${CUA_A}/${CUA_B} ──`)
await cleanup()
for (const [i, x] of DOs.entries()) await seedRaw(x, 60 + i * 10)

// ═══ U1 — Ô GỘP cột "Số xe" (1 xe, 3 DO, chỉ dòng đầu có Số xe) ═══
{
  const ws = sheetOf([
    { 'Số xe': GC(1), 'DO': DOs[0], ...base, 'Loại kho booking': CUA_A },
    { 'Số xe': '',    'DO': DOs[1], ...base, 'Loại kho booking': CUA_A },
    { 'Số xe': '',    'DO': DOs[2], ...base, 'Loại kho booking': CUA_A },
  ])
  ws['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }]   // gộp ô "Số xe" 3 dòng dữ liệu
  const pre = await uploadWs(ws, true)
  const ok = await uploadWs(ws, false)
  const lines = await restAll('khvc_lines', `select=do_no&group_code=eq.${GC(1)}&order=do_no`)
  const gdoDos = (await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${GC(1)}`))[0]
  console.log(`\n[U1] Ô GỘP cột "Số xe": preflight=${pre.s} ghi=${ok.s}`)
  console.log(`  ô kiểm-trước: ${JSON.stringify((pre.j?.data?.extra ?? []).map(e => `${e.label}=${e.value}`))}`)
  check('U1. Ô gộp được trải → giữ ĐỦ 3 DO (trước đây mất 2 DO âm thầm)',
    lines.length === 3 && !!gdoDos, `số dòng=${lines.length} (${lines.map(l => l.do_no).join(',')}) chuyến=${gdoDos ? 'có' : 'KHÔNG'}`)
}

// ═══ U2 — dòng TRÙNG (Số xe, DO) trong cùng file ═══
{
  const ws = sheetOf([
    { 'Số xe': GC(2), 'DO': DOs[3], ...base, 'Loại kho booking': CUA_A },
    { 'Số xe': GC(2), 'DO': DOs[3], ...base, 'Loại kho booking': CUA_A },   // TRÙNG
    { 'Số xe': GC(2), 'DO': DOs[4], ...base, 'Loại kho booking': CUA_A },
  ])
  const pre = await uploadWs(ws, true)
  const ok = await uploadWs(ws, false)
  const lines = await restAll('khvc_lines', `select=do_no&group_code=eq.${GC(2)}`)
  const dupWarn = (pre.j?.data?.extra ?? []).find(e => /TRÙNG/i.test(e.label))
  console.log(`\n[U2] Dòng TRÙNG: preflight=${pre.s} ghi=${ok.s}`)
  check('U2a. Kiểm-trước BÁO dòng trùng đã gộp (không im lặng)', !!dupWarn, `ô=${dupWarn ? dupWarn.value : '(không có)'}`)
  check('U2b. Ghi thật KHÔNG còn 500, dòng trùng gộp thành 1 (2 DO)',
    [200, 201].includes(ok.s) && lines.length === 2, `http=${ok.s} dòng=${lines.length}`)
  // Oracle số lượng: DO4=90, DO5=100 → chuyến phải = 190 base (không nhân đôi DO4)
  const g = (await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${GC(2)}`))[0]
  const dos = g ? await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`) : []
  const items = dos.length ? await restAll('OutboundItem', `select=cartons_ordered&do_id=in.(${dos.map(x => x.id).join(',')})`) : []
  const tong = items.reduce((a, b) => a + Number(b.cartons_ordered ?? 0), 0)
  check('U2c. Số lượng chuyến KHÔNG bị cộng hai lần (oracle 90+100=190 base)', tong === 190, `tổng=${tong}`)
}

// ═══ U3 — upload đổi CỬA / NGÀY khi xe đang GIỮ khung giờ ═══
{
  const ws = sheetOf([{ 'Số xe': GC(3), 'DO': DOs[0], ...base, 'Loại kho booking': CUA_A }])
  await uploadWs(ws, false)
  const ord = (await restAll('TmsOrder', `select=id&order_code=eq.${GC(3)}`))[0]
  const vs = ord ? (await restAll('TmsVehicleSlot', `select=id&order_id=eq.${ord.id}`))[0] : null
  const slot = await mkSlot(TIMES[0], CUA_A, DAY)
  const rBook = vs ? await api(`/tms/vehicle-slots/${vs.id}`, 'PATCH', { slot_id: slot, license_plate: 'QAUP933' }) : { s: 0 }
  // (a) file khai cửa KHÁC
  const wsCat = sheetOf([{ 'Số xe': GC(3), 'DO': DOs[0], ...base, 'Loại kho booking': CUA_B }])
  const preCat = await uploadWs(wsCat, true)
  // (b) file khai NGÀY khác
  const wsDate = sheetOf([{ 'Số xe': GC(3), 'DO': DOs[0], ...base, 'Ngày xuất': DAY2, 'Loại kho booking': CUA_A }])
  const preDate = await uploadWs(wsDate, true)
  const eCat = preCat.j?.data?.errors ?? [], eDate = preDate.j?.data?.errors ?? []
  console.log(`\n[U3] Upload khi xe đang giữ khung: book=${rBook.s}`)
  check('U3a. File đổi CỬA khi đang giữ khung → báo ở kiểm-trước, khóa ghi',
    preCat.j?.data?.will_write === 0 && eCat.some(e => e.startsWith(`Số xe ${GC(3)} —`) && /khung giờ/i.test(e)),
    `will_write=${preCat.j?.data?.will_write} err=${JSON.stringify(eCat).slice(0, 180)}`)
  check('U3b. File đổi NGÀY khi đang giữ khung → báo ở kiểm-trước, khóa ghi',
    preDate.j?.data?.will_write === 0 && eDate.some(e => /khung giờ/i.test(e)),
    `will_write=${preDate.j?.data?.will_write} err=${JSON.stringify(eDate).slice(0, 180)}`)
}

// ═══ U4 — gom chung sai cửa: 422 thì xe CHÍNH có bị chiếm chỗ oan không? ═══
{
  const ws = sheetOf([{ 'Số xe': GC(4), 'DO': DOs[1], ...base, 'Loại kho booking': CUA_B }])
  await uploadWs(ws, false)
  const oMain = (await restAll('TmsOrder', `select=id&order_code=eq.${GC(3)}`))[0]   // cửa A
  const oSec  = (await restAll('TmsOrder', `select=id&order_code=eq.${GC(4)}`))[0]   // cửa B
  const vsMain = oMain ? (await restAll('TmsVehicleSlot', `select=id,slot_id&order_id=eq.${oMain.id}`))[0] : null
  const slotNew = await mkSlot(TIMES[1], CUA_A, DAY)
  const before = Number((await restAll('DeliverySlot', `select=booked_count&id=eq.${slotNew}`))[0]?.booked_count)
  const r = (vsMain && oSec) ? await api(`/tms/vehicle-slots/${vsMain.id}`, 'PATCH', {
    slot_id: slotNew, license_plate: 'QAUP944', status: 'BOOKED', consolidation_order_ids: [oSec.id],
  }) : { s: 0 }
  const after = Number((await restAll('DeliverySlot', `select=booked_count&id=eq.${slotNew}`))[0]?.booked_count)
  const vsMainAfter = oMain ? (await restAll('TmsVehicleSlot', `select=slot_id&order_id=eq.${oMain.id}`))[0] : null
  console.log(`\n[U4] Gom chung KHÁC CỬA → 422, xe chính có bị chiếm chỗ oan?`)
  check('U4. Bị 422 thì khung MỚI không bị chiếm (gác chạy TRƯỚC RPC)',
    r.s === 422 && r.j?.error?.code === 'BOOKING_CATEGORY_MISMATCH' && before === 0 && after === 0
      && vsMainAfter?.slot_id !== slotNew,
    `http=${r.s}/${r.j?.error?.code} booked ${before}→${after} xe chính đổi khung=${vsMainAfter?.slot_id === slotNew}`)
}

console.log('\n🧹 dọn…')
await cleanup()
let residue = 0
for (const gc of ALL_GC) {
  residue += (await restAll('khvc_lines', `select=id&group_code=eq.${gc}`)).length
  residue += (await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${gc}`)).length
  residue += (await restAll('TmsOrder', `select=id&order_code=eq.${gc}`)).length
}
residue += (await restAll('DeliverySlot', `select=id&warehouse_id=eq.${WH.id}&date=in.(${DAY},${DAY2})&time_from=in.(${TIMES.join(',')})`)).length
check('Dọn 0 sót', residue === 0, `residue=${residue}`)
console.log(`\n[UPLOAD-2] ${pass}/${pass + fail} PASS`)
process.exitCode = fail ? 1 : 0
