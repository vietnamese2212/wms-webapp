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
const ALL_GC = [GC(1), GC(2)]
const DO_A = 'QABKDO01', DO_B = 'QABKDO02'
const TIME_A = '22:00:00', TIME_B = '22:30:00'

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
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=in.(${DO_A},${DO_B})`)
  for (const tm of [TIME_A, TIME_B])
    await restWrite('DeliverySlot', 'DELETE', `date=eq.${today}&time_from=eq.${tm}&warehouse_id=eq.${WH.id}`).catch(() => {})
}
const seedRaw = (doNo, qty) => restWrite('erp_outbound_orders', 'POST', null, {
  id: randomUUID(), od_number: doNo, od_item: '10', material_code: FIX.MAT_POOL, qty_base: qty,
  ship_to_code: 'QABK', ship_to_name: 'QA BOOKING NPP', source: 'EXCEL', sync_status: 'ACTIVE',
  last_synced_at: t(), updated_at: t(),
})
const addLine = (gc, doNo, cua) => api('/external/khvc', 'POST', {
  group_code: gc, do_no: doNo, npp: 'QA BOOKING NPP', export_date: today,
  veh_type: vehTypeName, dvvt: dvvtName, ...(cua !== undefined ? { booking_category: cua } : {}),
})
const orderOf = async gc => (await restAll('TmsOrder', `select=id,order_code,booking_category&order_code=eq.${gc}`))[0] ?? null
const mkSlot = (time, cargo) => {
  const id = randomUUID()
  return restWrite('DeliverySlot', 'POST', null, {
    id, date: today, time_from: time, time_to: '23:59:00', direction: 'OUTBOUND',
    vehicle_type_id: vtId, cargo_type: cargo, warehouse_id: WH.id,
    max_vehicles: 2, booked_count: 0, status: 'OPEN', created_at: t(), updated_at: t(),
  }).then(() => id)
}

console.log(`── GÓI 15 — Cửa đặt lịch (Loại kho booking) · ${BASE.replace('https://', '')} ──`)
console.log(`   2 cửa lấy từ danh mục: ${CUA_A} / ${CUA_B}`)
await cleanup()
await seedRaw(DO_A, 100)
await seedRaw(DO_B, 60)

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
    const base = { 'Tên NPP': 'QA BOOKING NPP', 'Ngày xuất': today, 'Loại xe': vehTypeName, 'DVVT': dvvtName }
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
    // 8e. Kiểm-trước KHÔNG được ghi gì
    const wrote = await restAll('khvc_lines', `select=id&group_code=in.(${ALL_GC.join(',')})&do_no=eq.${DO_B}`)
    check('8e. Pha kiểm-trước KHÔNG ghi dòng nào', wrote.length === 0, `còn ${wrote.length} dòng`)
  }
}

// ── DỌN ──
await cleanup()
const leftK = await restAll('khvc_lines', `select=id&group_code=in.(${ALL_GC.join(',')})`)
const leftO = await restAll('TmsOrder', `select=id&order_code=in.(${ALL_GC.join(',')})`)
const leftS = await restAll('DeliverySlot', `select=id&date=eq.${today}&time_from=in.(${TIME_A},${TIME_B})&warehouse_id=eq.${WH.id}`)
check('Dọn 0 sót', leftK.length === 0 && leftO.length === 0 && leftS.length === 0,
  `kh=${leftK.length} lệnh=${leftO.length} khung=${leftS.length}`)

console.log(`\n[BOOKING-CATEGORY] ${pass}/${pass + fail} PASS`)
process.exitCode = fail ? 1 : 0
