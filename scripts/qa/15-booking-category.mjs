// GÓI 15 — CỬA ĐẶT LỊCH ("Loại kho booking", user chốt 03/08 "làm khóa cứng").
// Xe chở LẪN nhiều loại (FG01+PM01+FG02) chỉ đậu MỘT cửa; cửa KHÔNG suy diễn được (có xe giữ nốt
// của loại hạng thấp) ⇒ kế hoạch phải KHAI, và 1 Số xe chỉ được 1 giá trị.
// Khóa 7 luật:
//   1. Thiếu cửa → CHẶN (400) ở cả create tay lẫn upload
//   2. Cửa không có trong danh mục Loại kho → CHẶN
//   3. Thêm DO vào xe đã có cửa → ÉP theo cửa của xe (không cho khai lệch)
//   4. Sửa cửa 1 dòng → ĐỒNG BỘ CẢ XE + dội xuống TmsOrder.booking_category
//   5. Đặt khung giờ của cửa KHÁC → 422 BOOKING_CATEGORY_MISMATCH (gác ở BE, không chỉ ở picker)
//   6. Đặt khung giờ ĐÚNG cửa (và khung 'ALL') → OK
//   7. Đang giữ khung giờ của cửa cũ → đổi cửa bị 422 (bắt nhả khung trước), và TRIGGER DB chặn
//      cả đường ghi KHÔNG qua app (script/API tích hợp)
import { randomUUID } from 'crypto'
import { login, api, restAll, restWrite, resolveFixtures, FIX, BASE } from './lib.mjs'

const t = () => new Date().toISOString()
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
// Fixture đặt ở NGÀY MAI: khung giờ test nằm cuối ngày, chạy gói sau giờ đó thì app chặn
// đúng luật ('khung giờ đã qua') và gói TỰ ĐỎ dù code không sai — cổng gác không được phụ thuộc giờ chạy.
const DAY = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
let pass = 0, fail = 0
const check = (name, ok, note = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${note ? ` — ${note}` : ''}`) }
}

await login()
await resolveFixtures()
const vehTypeName = (await restAll('VehicleType', 'select=name&is_active=eq.true&order=name&limit=1'))[0]?.name
const vtId = (await restAll('VehicleType', 'select=id&is_active=eq.true&order=name&limit=1'))[0]?.id
const dvvtName = (await restAll('TransportCompany', 'select=name&type=eq.ĐVVT&order=name&limit=1'))[0]?.name
const cats = (await restAll('LookupValue', 'select=value&type=eq.warehouse_type&order=sort_order')).map(x => x.value)
if (!vehTypeName || !dvvtName || cats.length < 2) { console.log('❌ thiếu danh mục Loại xe/ĐVVT/Loại kho (cần ≥2 loại)'); process.exit(1) }
const CUA_A = cats[0], CUA_B = cats[1]      // 2 cửa khác nhau lấy TỪ DANH MỤC — không viết cứng mã loại

const WH = FIX.WH_QTY
const [y, m, d] = today.split('-')
const GC = n => `${WH.code}_X_${d}${m}${y.slice(2)}_8${n}`
const ALL_GC = [GC(1), GC(2), GC(3), GC(4), GC(5), GC(6), GC(7)]
const DO_A = 'QABKDO01', DO_B = 'QABKDO02', DO_C = 'QABKDO03'
const DO_D = 'QABKDO04', DO_E = 'QABKDO05', DO_F = 'QABKDO06'
const ALL_DO = [DO_A, DO_B, DO_C, DO_D, DO_E, DO_F]
const TIME_A = '22:00:00', TIME_B = '22:30:00'
const TIME_C = '21:00:00', TIME_D = '21:15:00', TIME_E = '21:30:00'
const ALL_TIME = [TIME_A, TIME_B, TIME_C, TIME_D, TIME_E]
// Ngày thứ 2 cho phép kiểm "đổi Ngày xuất khi đang giữ khung giờ"
const DAY2 = new Date(Date.now() + 2 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

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
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=in.(${ALL_DO.join(',')})`)
  for (const tm of ALL_TIME)
    await restWrite('DeliverySlot', 'DELETE', `date=in.(${DAY},${DAY2})&time_from=eq.${tm}&warehouse_id=eq.${WH.id}`).catch(() => {})
}
const seedRaw = (doNo, qty) => restWrite('erp_outbound_orders', 'POST', null, {
  id: randomUUID(), od_number: doNo, od_item: '10', material_code: FIX.MAT_POOL, qty_base: qty,
  ship_to_code: 'QABK', ship_to_name: 'QA BOOKING NPP', source: 'EXCEL', sync_status: 'ACTIVE',
  last_synced_at: t(), updated_at: t(),
})
const addLine = (gc, doNo, cua) => api('/external/khvc', 'POST', {
  group_code: gc, do_no: doNo, npp: 'QA BOOKING NPP', export_date: DAY,
  veh_type: vehTypeName, dvvt: dvvtName, ...(cua !== undefined ? { booking_category: cua } : {}),
})
const orderOf = async gc => (await restAll('TmsOrder', `select=id,order_code,booking_category&order_code=eq.${gc}`))[0] ?? null
const mkSlot = (time, cargo, date = DAY) => {
  const id = randomUUID()
  return restWrite('DeliverySlot', 'POST', null, {
    id, date, time_from: time, time_to: '23:59:00', direction: 'OUTBOUND',
    vehicle_type_id: vtId, cargo_type: cargo, warehouse_id: WH.id,
    max_vehicles: 2, booked_count: 0, status: 'OPEN', created_at: t(), updated_at: t(),
  }).then(() => id)
}

console.log(`── GÓI 15 — Cửa đặt lịch (Loại kho booking) · ${BASE.replace('https://', '')} ──`)
console.log(`   2 cửa lấy từ danh mục: ${CUA_A} / ${CUA_B}`)
await cleanup()
await seedRaw(DO_A, 100)
await seedRaw(DO_B, 60)
await seedRaw(DO_C, 40)
await seedRaw(DO_D, 30)
await seedRaw(DO_E, 20)
await seedRaw(DO_F, 10)

// ── 1+2. Bắt buộc khai + phải có trong danh mục ───────────────────────────────
const rMissing = await addLine(GC(1), DO_A, undefined)
check('1. Thiếu "Loại kho booking" → CHẶN 400', rMissing.s === 400 && /Loại kho booking/i.test(rMissing.j?.error?.message ?? ''),
  `http=${rMissing.s} ${rMissing.j?.error?.message ?? ''}`)
const rBad = await addLine(GC(1), DO_A, 'KHONGCOTHAT')
check('2. Cửa không có trong danh mục Loại kho → CHẶN 400', rBad.s === 400,
  `http=${rBad.s} ${rBad.j?.error?.message ?? ''}`)

// ── 3. Thêm DO vào xe đã có cửa → ÉP theo cửa của xe ─────────────────────────
const rOk = await addLine(GC(1), DO_A, CUA_A)
check('3a. Khai đúng cửa → tạo được dòng', rOk.s === 201, `http=${rOk.s} ${rOk.j?.error?.message ?? ''}`)
const rForce = await addLine(GC(1), DO_B, CUA_B)      // cố tình khai cửa KHÁC
const linesAfter = await restAll('khvc_lines', `select=do_no,booking_category&group_code=eq.${GC(1)}`)
const distinct = [...new Set(linesAfter.map(l => l.booking_category))]
check('3b. Thêm DO khai cửa KHÁC → bị ÉP về cửa của xe (1 xe 1 cửa)',
  rForce.s === 201 && distinct.length === 1 && distinct[0] === CUA_A && rForce.j?.data?.booking_category_forced_to === CUA_A,
  `http=${rForce.s} cửa=${JSON.stringify(distinct)} forced=${rForce.j?.data?.booking_category_forced_to}`)

// ── 4. Sửa cửa 1 dòng → đồng bộ CẢ XE + dội xuống lệnh VC ───────────────────
const lineIds = await restAll('khvc_lines', `select=id,do_no&group_code=eq.${GC(1)}&order=do_no`)
const rEdit = await api(`/external/khvc/${lineIds[0].id}`, 'PUT', { booking_category: CUA_B })
const afterEdit = await restAll('khvc_lines', `select=booking_category&group_code=eq.${GC(1)}`)
const ord1 = await orderOf(GC(1))
check('4. Sửa cửa 1 dòng → ĐỒNG BỘ cả xe + dội xuống lệnh VC',
  rEdit.s === 200 && afterEdit.every(l => l.booking_category === CUA_B) && ord1?.booking_category === CUA_B,
  `http=${rEdit.s} dòng=${JSON.stringify([...new Set(afterEdit.map(l => l.booking_category))])} lệnh=${ord1?.booking_category}`)

// ── 5+6. Gác đặt lịch ở BE (không chỉ lọc ở picker) ─────────────────────────
const slotWrong = await mkSlot(TIME_A, CUA_A)          // khung của cửa KHÁC (xe đang ở cửa CUA_B)
const slotRight = await mkSlot(TIME_B, CUA_B)          // khung ĐÚNG cửa
const vs = (await restAll('TmsVehicleSlot', `select=id&order_id=eq.${ord1?.id}`))[0]
const rWrong = vs ? await api(`/tms/vehicle-slots/${vs.id}`, 'PATCH', { slot_id: slotWrong, license_plate: 'QABK111' }) : { s: 0 }
check('5. Đặt khung giờ của cửa KHÁC → 422 BOOKING_CATEGORY_MISMATCH',
  rWrong.s === 422 && rWrong.j?.error?.code === 'BOOKING_CATEGORY_MISMATCH',
  `http=${rWrong.s} code=${rWrong.j?.error?.code} ${rWrong.j?.error?.message ?? ''}`)
const rRight = vs ? await api(`/tms/vehicle-slots/${vs.id}`, 'PATCH', { slot_id: slotRight, license_plate: 'QABK111' }) : { s: 0 }
const slotCnt = (await restAll('DeliverySlot', `select=booked_count&id=eq.${slotRight}`))[0]
check('6. Đặt khung giờ ĐÚNG cửa → OK + đếm chỗ tăng 1',
  rRight.s === 200 && Number(slotCnt?.booked_count) === 1,
  `http=${rRight.s} booked=${slotCnt?.booked_count} ${rRight.j?.error?.message ?? ''}`)

// ── 7. Đang giữ khung → không cho đổi cửa; và TRIGGER DB chặn đường ghi thẳng ─
const rSwap = await api(`/external/khvc/${lineIds[0].id}`, 'PUT', { booking_category: CUA_A })
check('7a. Đang giữ khung giờ của cửa cũ → đổi cửa bị 422 (bắt nhả khung trước)',
  rSwap.s === 422 && rSwap.j?.error?.code === 'BOOKING_CATEGORY_SLOT_HELD',
  `http=${rSwap.s} code=${rSwap.j?.error?.code}`)
// Ghi THẲNG DB (mô phỏng script/API tích hợp không qua controller) → trigger phải chặn
let trgBlocked = false
try {
  await restWrite('khvc_lines', 'PATCH', `id=eq.${lineIds[1].id}`, { booking_category: CUA_A })
} catch (e) { trgBlocked = /1 Số xe chỉ được 1 Loại kho booking/.test(String(e.message)) }
const stillUniform = [...new Set((await restAll('khvc_lines', `select=booking_category&group_code=eq.${GC(1)}`)).map(l => l.booking_category))]
check('7b. TRIGGER DB chặn cả đường ghi KHÔNG qua app (script/tích hợp)',
  trgBlocked && stillUniform.length === 1, `blocked=${trgBlocked} cửa=${JSON.stringify(stillUniform)}`)

// ── 8. UPLOAD sai cửa phải ra BẢNG BÁO CÁO (không phải 1 dòng chữ 400) ───────
// User 03/08: "kết quả này nên được đưa về dạng table thì sẽ rõ ràng hơn". Khuôn báo cáo dùng chung
// đã có bảng "Ở đâu · Vấn đề" + chip lọc + tải lỗi Excel; guard trả fail() chuỗi là ĐI TẮT qua nó.
// Quy ước máy đọc được: pha kiểm-trước trả 200 + errors[] dạng "Số xe X — <vấn đề>", 1 dòng 1 vấn đề.
{
  let XLSX = null
  try { XLSX = (await import('../../backend/node_modules/xlsx/xlsx.mjs')).default ?? await import('../../backend/node_modules/xlsx/xlsx.mjs') }
  catch { console.log('  ⚠ bỏ qua mục 8: chưa cài dependency backend (xlsx)') }
  if (XLSX) {
    const tok = await (async () => {
      const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: process.env.QA_ADMIN_EMAIL || 'admin', password: process.env.QA_ADMIN_PASSWORD || 'Bavi1234' }) })
      return (await r.json())?.data?.token
    })()
    const upload = async (rows, preflight) => {
      const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'KHVC')
      const fd = new FormData()
      fd.append('file', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'khvc.xlsx')
      const r = await fetch(`${BASE}/api/wms/outbound/upload-khvc${preflight ? '?preflight=1' : ''}`,
        { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd })
      let j = null; try { j = JSON.parse(await r.text()) } catch { /* */ }
      return { s: r.status, j }
    }
    const base = { 'Tên NPP': 'QA BOOKING NPP', 'Ngày xuất': DAY, 'Loại xe': vehTypeName, 'DVVT': dvvtName }
    const GCU = GC(2)
    // 8a. 1 Số xe khai 2 cửa khác nhau + 1 mã lạ → báo cáo có bảng, KHÔNG ghi gì
    const r8 = await upload([
      { 'Số xe': GCU, 'DO': DO_A, ...base, 'Loại kho booking': CUA_A },
      { 'Số xe': GCU, 'DO': DO_B, ...base, 'Loại kho booking': 'DG01' },
    ], true)
    const errs = r8.j?.data?.errors ?? []
    const dungQuyUoc = errs.length >= 2 && errs.every(e => / — /.test(e) && e.startsWith('Số xe '))
    check('8a. Upload sai cửa → 200 + BÁO CÁO (errors dạng "Số xe X — vấn đề", 1 dòng 1 vấn đề)',
      r8.s === 200 && r8.j?.data?.preflight === true && dungQuyUoc,
      `http=${r8.s} preflight=${r8.j?.data?.preflight} errors=${JSON.stringify(errs).slice(0, 220)}`)
    check('8b. Báo cáo KHÓA nút Xác nhận (will_write=0) + đếm đúng tổng xe',
      r8.j?.data?.will_write === 0 && r8.j?.data?.total === 1,
      `will_write=${r8.j?.data?.will_write} total=${r8.j?.data?.total}`)
    check('8c. Lỗi chỉ rõ TỪNG vấn đề: vừa "nhiều loại" vừa "không có trong danh mục"',
      errs.some(e => /chỉ được 1 loại/.test(e)) && errs.some(e => /không có trong danh mục/.test(e)),
      JSON.stringify(errs).slice(0, 220))
    // 8d. Thiếu HẲN cột → 1 dòng chẩn đoán, không phải N dòng giống nhau
    const r8d = await upload([
      { 'Số xe': GCU, 'DO': DO_A, ...base },
      { 'Số xe': GC(1), 'DO': DO_B, ...base },
    ], true)
    const e8d = r8d.j?.data?.errors ?? []
    check('8d. Thiếu HẲN cột "Loại kho booking" → 1 dòng chẩn đoán + chỉ chỗ tải mẫu',
      r8d.s === 200 && e8d.length === 1 && /không có cột/.test(e8d[0]) && /mẫu/i.test(e8d[0]),
      `errors=${JSON.stringify(e8d).slice(0, 200)}`)
    // 8e. Kiểm-trước KHÔNG được ghi gì — soi ĐÚNG xe của mục 8 (GC(2)); GC(1) có dòng thật từ mục 3b
    const wrote = await restAll('khvc_lines', `select=id,do_no&group_code=eq.${GCU}`)
    check('8e. Pha kiểm-trước KHÔNG ghi dòng nào (xe của mục 8)', wrote.length === 0,
      `còn ${wrote.length} dòng: ${JSON.stringify(wrote.map(x => x.do_no))}`)
  }
}

// ── 9. Chuyến CHỜ dữ liệu SAP: hàng chở CHƯA BIẾT nhưng CỬA phải có ─────────
// Hợp đồng dữ liệu cho giao diện: lưới Kế hoạch VC hiện "cửa X" khi warehouse_type null. Thiếu
// booking_category ở API thì ô Loại kho TRỐNG TRƠN (user báo 03/08 "loại kho lại k hiện lên").
{
  const gcW = GC(1)
  const ord = (await restAll('TmsOrder', `select=order_code,warehouse_type,booking_category&order_code=eq.${gcW}`))[0]
  const g = (await restAll('GroupDeliveryOrder', `select=awaiting_sap,warehouse_type&group_code=eq.${gcW}`))[0]
  const q = `date_from=${DAY}&date_to=${DAY}&warehouse_id=${WH.id}`
  const pg = await api(`/tms/orders?${q}&page=1&page_size=200`)
  const row = (pg.j?.data?.rows ?? []).find(r => r.order_code === gcW)
  check('9. Lệnh của chuyến CHỜ SAP: API trả CỬA dù hàng chở chưa biết (để ô Loại kho không trống)',
    !!row && !!row.booking_category,
    `awaiting=${g?.awaiting_sap} hàng_chở=${ord?.warehouse_type} cửa=${row?.booking_category ?? '(thiếu)'}`)
}

// ── 10. GOM ĐƠN CHẠY CHUNG không được kéo đơn KHÁC CỬA vào khung giờ sai cửa ──
// Nhánh consolidation ghi THẲNG slot_id sang vslot của đơn khác (không qua gác cửa, không qua RPC)
// ⇒ đường lách: đo thật 04/08 trả HTTP 200 và đơn cửa B đậu khung của cửa A, im lặng.
// warehouse_type KHÔNG chặn được: đó là hàng xe CHỞ (chuỗi ghép), cửa là trường RIÊNG.
{
  await addLine(GC(3), DO_C, CUA_A)                       // xe thứ 2, cửa KHÁC xe 1 (đang ở CUA_B)
  const o1 = await orderOf(GC(1)), o3 = await orderOf(GC(3))
  const vs1 = o1 ? (await restAll('TmsVehicleSlot', `select=id,slot_id&order_id=eq.${o1.id}&order=created_at`))[0] : null
  const vs3 = o3 ? (await restAll('TmsVehicleSlot', `select=id,slot_id&order_id=eq.${o3.id}&order=created_at`))[0] : null
  if (o1 && o3 && vs1 && vs3 && o1.booking_category !== o3.booking_category) {
    const r = await api(`/tms/vehicle-slots/${vs1.id}`, 'PATCH', {
      slot_id: slotRight, license_plate: 'QABK111', status: 'BOOKED', consolidation_order_ids: [o3.id],
    })
    const vs3After = (await restAll('TmsVehicleSlot', `select=slot_id&order_id=eq.${o3.id}&order=created_at`))[0]
    check('10. Gom đơn chạy chung KHÁC CỬA → CHẶN (đơn phụ không bị kéo vào khung sai cửa)',
      r.s === 422 && r.j?.error?.code === 'BOOKING_CATEGORY_MISMATCH' && vs3After?.slot_id !== slotRight,
      `http=${r.s} code=${r.j?.error?.code} slot đơn phụ=${vs3After?.slot_id ? 'BỊ GÁN' : 'null'}`)
  } else check('10. Gom đơn chạy chung KHÁC CỬA → CHẶN', false,
    `thiếu fixture: cửa xe1=${o1?.booking_category} cửa xe3=${o3?.booking_category}`)
}

// ── 11. UPLOAD khai cửa khác DÒNG CŨ CÒN LẠI của cùng Số xe → bắt ở KIỂM-TRƯỚC ──
// File chỉ chứa MỘT PHẦN số DO của xe: dòng không có trong file vẫn ở lại với cửa cũ, nên "trong
// file thống nhất" CHƯA đủ — trạng thái SAU KHI GHI mới là thứ phải hợp lệ. Đo thật 04/08 trước khi
// vá: kiểm-trước báo XANH (will_write=2, 0 lỗi) → bấm Xác nhận → HTTP 500 từ trigger DB.
{
  let XLSX = null
  try { XLSX = (await import('../../backend/node_modules/xlsx/xlsx.mjs')).default ?? await import('../../backend/node_modules/xlsx/xlsx.mjs') }
  catch { console.log('  ⚠ bỏ qua mục 11: chưa cài dependency backend (xlsx)') }
  if (XLSX) {
    const tok = await (async () => {
      const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: process.env.QA_ADMIN_EMAIL || 'admin', password: process.env.QA_ADMIN_PASSWORD || 'Bavi1234' }) })
      return (await r.json())?.data?.token
    })()
    // GC(1) đang có 2 DO ở cửa CUA_B; file chỉ đưa 1 DO và khai cửa CUA_A
    const ws = XLSX.utils.json_to_sheet([{ 'Số xe': GC(1), 'DO': DO_A, 'Tên NPP': 'QA BOOKING NPP',
      'Ngày xuất': DAY, 'Loại xe': vehTypeName, 'DVVT': dvvtName, 'Loại kho booking': CUA_A }])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'KHVC')
    const fd = new FormData()
    fd.append('file', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'khvc.xlsx')
    const r = await fetch(`${BASE}/api/wms/outbound/upload-khvc?preflight=1`,
      { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd })
    let j = null; try { j = JSON.parse(await r.text()) } catch { /* */ }
    const errs = j?.data?.errors ?? []
    check('11. Upload khai cửa khác DÒNG CŨ còn lại của xe → báo ở KIỂM-TRƯỚC (không để 500 sau khi Xác nhận)',
      r.status === 200 && j?.data?.will_write === 0 && errs.some(e => e.startsWith(`Số xe ${GC(1)} —`) && /cửa/.test(e)),
      `http=${r.status} will_write=${j?.data?.will_write} errors=${JSON.stringify(errs).slice(0, 240)}`)
  }
}

// ══ VÒNG ĐỜI LỆNH VC × KHUNG GIỜ (probe 04/08) ═══════════════════════════════
// Ba trạng thái CẤM đo được trên staging, cùng một họ: "khung giờ đang giữ mâu thuẫn với kế hoạch
// của chính xe đó". Khung giờ là tài nguyên khan hiếm giờ cao điểm — chỗ bị xe ma giữ là xe thật
// không đặt được, và không có lượt đồng bộ nào tự dọn.

// ── 12. Lệnh ĐÃ NGỪNG HIỆU LỰC (kế hoạch bỏ xe) không được chiếm chỗ ────────
// Hệ thống tự NHẢ khung khi bỏ xe, nhưng trước 04/08 không có gì cấm đặt LẠI (nút đồng hồ vẫn hiện):
// đo thật HTTP 200, booked_count=1 — giữ VĨNH VIỄN vì lệnh đã ở trạng thái dropped.
const slotDead = await mkSlot(TIME_C, CUA_A)
{
  await addLine(GC(4), DO_D, CUA_A)
  const lid = (await restAll('khvc_lines', `select=id&group_code=eq.${GC(4)}&do_no=eq.${DO_D}`))[0]?.id
  await api(`/external/khvc/${lid}`, 'DELETE')                 // bỏ xe khỏi kế hoạch → lệnh NGỪNG
  const o4 = await orderOf(GC(4))
  const drop4 = (await restAll('TmsOrder', `select=plan_dropped&order_code=eq.${GC(4)}`))[0]?.plan_dropped
  const vs4 = o4 ? (await restAll('TmsVehicleSlot', `select=id&order_id=eq.${o4.id}`))[0] : null
  const r = vs4 ? await api(`/tms/vehicle-slots/${vs4.id}`, 'PATCH', { slot_id: slotDead, license_plate: 'QABK444' }) : { s: 0 }
  const cnt = (await restAll('DeliverySlot', `select=booked_count&id=eq.${slotDead}`))[0]?.booked_count
  check('12. Lệnh ĐÃ NGỪNG (KH bỏ xe) → không đặt được khung giờ (422) + không chiếm chỗ',
    drop4 === true && r.s === 422 && r.j?.error?.code === 'TMS_PLAN_DROPPED' && Number(cnt) === 0,
    `dropped=${drop4} http=${r.s} code=${r.j?.error?.code} booked=${cnt}`)
}

// ── 13. Gom đơn chạy chung KHÔNG được kéo lệnh ĐÃ NGỪNG vào khung ───────────
// Nhánh gom ghi THẲNG slot_id sang vslot đơn phụ ⇒ lách gác ở mục 12 nếu không chặn riêng.
{
  await addLine(GC(5), DO_E, CUA_A)                            // xe sống, CÙNG cửa (cô lập đúng biến plan_dropped)
  const o5 = await orderOf(GC(5)), o4 = await orderOf(GC(4))
  const vs5 = o5 ? (await restAll('TmsVehicleSlot', `select=id&order_id=eq.${o5.id}&order=created_at`))[0] : null
  const r = (o4 && vs5) ? await api(`/tms/vehicle-slots/${vs5.id}`, 'PATCH', {
    slot_id: slotDead, license_plate: 'QABK555', status: 'BOOKED', consolidation_order_ids: [o4.id],
  }) : { s: 0 }
  const vs4After = o4 ? (await restAll('TmsVehicleSlot', `select=slot_id&order_id=eq.${o4.id}`))[0] : null
  check('13. Gom chung với lệnh ĐÃ NGỪNG → CHẶN (đơn phụ chết không chiếm chỗ)',
    r.s === 422 && r.j?.error?.code === 'TMS_PLAN_DROPPED' && !vs4After?.slot_id,
    `http=${r.s} code=${r.j?.error?.code} slot đơn phụ=${vs4After?.slot_id ? 'BỊ GÁN' : 'null'}`)
}

// ── 14. "NHẬN NUÔI": lệnh tạo tay ĐANG GIỮ khung cửa A, kế hoạch khai cửa B ──
// Luật 7 chỉ gác ở đường SỬA cửa; đường TẠO dòng đầu tiên cho Số xe đã có lệnh tay thì lọt
// ⇒ lệnh bị đóng dấu cửa B trong khi vẫn đậu khung cửa A (đo thật 04/08: HTTP 201, im lặng).
{
  const ordId = randomUUID(), vsId = randomUUID()
  await restWrite('TmsOrder', 'POST', null, {
    id: ordId, order_code: GC(6), date: DAY, warehouse_id: WH.id, direction: 'OUTBOUND',
    vehicle_type: vehTypeName, origin: 'MANUAL', status: 'PENDING', plan_dropped: false,
    created_at: t(), updated_at: t(),
  })
  await restWrite('TmsVehicleSlot', 'POST', null, { id: vsId, order_id: ordId, status: 'PENDING', created_at: t(), updated_at: t() })
  const slotAdopt = await mkSlot(TIME_D, CUA_A)
  const rBook = await api(`/tms/vehicle-slots/${vsId}`, 'PATCH', { slot_id: slotAdopt, license_plate: 'QABK666' })
  const rAdopt = await addLine(GC(6), DO_F, CUA_B)             // kế hoạch khai cửa KHÁC
  const ordAfter = await orderOf(GC(6))
  const lines6 = await restAll('khvc_lines', `select=id&group_code=eq.${GC(6)}`)
  check('14. Nhận nuôi lệnh tay đang giữ khung cửa khác → CHẶN 422 (không ghi dòng kế hoạch)',
    rBook.s === 200 && rAdopt.s === 422 && rAdopt.j?.error?.code === 'BOOKING_CATEGORY_SLOT_HELD'
      && lines6.length === 0 && (ordAfter?.booking_category ?? null) === null,
    `book=${rBook.s} addLine=${rAdopt.s}/${rAdopt.j?.error?.code} dòng=${lines6.length} cửa lệnh=${ordAfter?.booking_category}`)
}

// ── 15. ĐỔI NGÀY XUẤT khi xe đang GIỮ khung giờ → chặn ở CẢ HAI cửa ─────────
// Dời ngày mà giữ nguyên khung của ngày cũ: ngày cũ mất 1 chỗ oan, ngày mới xe KHÔNG có khung —
// mà lưới vẫn hiện "đã đặt lịch". Luật này vốn CÓ bên TMS nhưng gác soi nhầm trường (TmsOrder.status
// thay vì trạng thái DÒNG XE) nên chưa bao giờ chặn được; lệnh tự sinh lại chỉ đổi ngày được ở cửa KHVC.
{
  await addLine(GC(7), DO_A, CUA_A)                            // DO_A dùng lại: xe khác, dòng khác
  const o7 = await orderOf(GC(7))
  const slotDate = await mkSlot(TIME_E, CUA_A, DAY)
  const vs7 = o7 ? (await restAll('TmsVehicleSlot', `select=id&order_id=eq.${o7.id}&order=created_at`))[0] : null
  const rBook = vs7 ? await api(`/tms/vehicle-slots/${vs7.id}`, 'PATCH', { slot_id: slotDate, license_plate: 'QABK777' }) : { s: 0 }
  const lid7 = (await restAll('khvc_lines', `select=id&group_code=eq.${GC(7)}&do_no=eq.${DO_A}`))[0]?.id
  const rBulk = await api('/external/khvc/bulk-date', 'POST', { ids: [lid7], export_date: DAY2 })
  const rOne = await api(`/external/khvc/${lid7}`, 'PUT', { export_date: DAY2 })
  const line7 = (await restAll('khvc_lines', `select=export_date&id=eq.${lid7}`))[0]
  const vs7After = o7 ? (await restAll('TmsVehicleSlot', `select=slot_id&order_id=eq.${o7.id}`))[0] : null
  check('15a. Đổi ngày HÀNG LOẠT khi đang giữ khung → chặn per-xe, ngày KHÔNG đổi',
    rBook.s === 200 && rBulk.s === 200 && rBulk.j?.data?.updated_groups === 0
      && (rBulk.j?.data?.blocked ?? []).some(b => b.group_code === GC(7) && /khung giờ/i.test(b.reason ?? ''))
      && String(line7?.export_date) === DAY,
    `book=${rBook.s} bulk=${rBulk.s} updated=${rBulk.j?.data?.updated_groups} blocked=${JSON.stringify(rBulk.j?.data?.blocked ?? []).slice(0, 160)} ngày=${line7?.export_date}`)
  check('15b. Đổi ngày SỬA LẺ khi đang giữ khung → 422 BOOKING_SLOT_HELD_DATE + khung giữ nguyên',
    rOne.s === 422 && rOne.j?.error?.code === 'BOOKING_SLOT_HELD_DATE' && vs7After?.slot_id === slotDate,
    `http=${rOne.s} code=${rOne.j?.error?.code} giữ_khung=${vs7After?.slot_id === slotDate}`)
}

// ── DỌN ──
await cleanup()
const leftK = await restAll('khvc_lines', `select=id&group_code=in.(${ALL_GC.join(',')})`)
const leftO = await restAll('TmsOrder', `select=id&order_code=in.(${ALL_GC.join(',')})`)
const leftS = await restAll('DeliverySlot', `select=id&date=in.(${DAY},${DAY2})&time_from=in.(${ALL_TIME.join(',')})&warehouse_id=eq.${WH.id}`)
check('Dọn 0 sót', leftK.length === 0 && leftO.length === 0 && leftS.length === 0,
  `kh=${leftK.length} lệnh=${leftO.length} khung=${leftS.length}`)

console.log(`\n[BOOKING-CATEGORY] ${pass}/${pass + fail} PASS`)
process.exitCode = fail ? 1 : 0
