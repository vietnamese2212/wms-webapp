// GÓI 32 — STT CHUẨN BỊ THEO BOOKING KHUNG GIỜ (24/08). Oracle = TỰ TÍNH LẠI ĐỘC LẬP:
// seed kho + khung giờ + lệnh + booking tag QASEQ, tự sort (time_from, created_at) trong JS
// rồi diff với RPC booking_sequence qua API /wms/outbound/booking-sequence. Gác:
// đánh số 1..n liên tục theo khung giờ · tie-break giờ đặt · xe chưa booking KHÔNG có số ·
// lệnh plan_dropped KHÔNG hiện · hủy booking là số DỒN lại (số dẫn xuất, không lưu) ·
// chiều INBOUND là DÃY RIÊNG · validate ngày (thiếu/bậy/khoảng >190 ngày → 400).
import { login, api, check, finish, restWrite, restAll } from './lib.mjs'
import { randomUUID } from 'crypto'

console.log('── GÓI BOOKING-SEQUENCE (STT chuẩn bị theo khung giờ) ──')
await login()
const now = () => new Date().toISOString()
const DATE = '2027-03-15'   // ngày cố định xa — không đụng booking thật

async function cleanup() {
  const orders = await restAll('TmsOrder', `select=id&order_code=like.QASEQ*`)
  if (orders.length) {
    const ids = orders.map(o => o.id).join(',')
    await restWrite('TmsVehicleSlot', 'DELETE', `order_id=in.(${ids})`)
    await restWrite('TmsOrder', 'DELETE', `order_code=like.QASEQ*`)
  }
  const whs = await restAll('Warehouse', `select=id&code=like.QASEQ*`)
  for (const w of whs) {
    await restWrite('DeliverySlot', 'DELETE', `warehouse_id=eq.${w.id}`)
    await restWrite('Warehouse', 'DELETE', `id=eq.${w.id}`)
  }
}
await cleanup()

const [vt] = await restAll('VehicleType', 'select=id&limit=1')
const wh = (await restWrite('Warehouse', 'POST', null, {
  id: randomUUID(), code: 'QASEQ_WH', name: 'QA booking seq', warehouse_type: 'CENTRAL',
  inventory_mode: 'QTY', is_active: true, updated_at: now(),
}))[0].id

// 3 khung giờ: 07:30 / 08:00 / 09:00 (tạo KHÔNG theo thứ tự thời gian để chắc là sort theo giờ, không theo thứ tự tạo)
const mkSlot = async (from, to) => (await restWrite('DeliverySlot', 'POST', null, {
  id: randomUUID(), warehouse_id: wh, vehicle_type_id: vt.id, date: DATE,
  time_from: from, time_to: to, max_vehicles: 10, booked_count: 0, updated_at: now(),
}))[0].id
const slot9 = await mkSlot('09:00', '10:00')
const slot730 = await mkSlot('07:30', '08:30')
const slot8 = await mkSlot('08:00', '09:00')

const mkOrder = async (code, extra = {}) => (await restWrite('TmsOrder', 'POST', null, {
  id: randomUUID(), order_code: code, date: DATE, warehouse_id: wh,
  direction: 'OUTBOUND', status: 'PENDING', updated_at: now(), ...extra,
}))[0].id
const mkBooking = (orderId, slotId, plate, createdAt) => restWrite('TmsVehicleSlot', 'POST', null, {
  id: randomUUID(), order_id: orderId, slot_id: slotId, license_plate: plate,
  status: 'BOOKED', created_at: createdAt, updated_at: now(),
})

// Kịch bản: A đặt 09:00 · B + C cùng 08:00 (C đặt TRƯỚC B 1 phút → C trước) · D đặt 07:30 ·
// E KHÔNG booking · F booking nhưng plan_dropped · G chiều INBOUND đặt 08:00 (dãy riêng)
const oA = await mkOrder('QASEQ_A'), oB = await mkOrder('QASEQ_B'), oC = await mkOrder('QASEQ_C')
const oD = await mkOrder('QASEQ_D')
await mkOrder('QASEQ_E')
const oF = await mkOrder('QASEQ_F', { plan_dropped: true })
const oG = await mkOrder('QASEQ_G', { direction: 'INBOUND' })
const t0 = Date.parse('2027-03-14T08:00:00Z')
await mkBooking(oA, slot9, 'QASEQA1', new Date(t0).toISOString())
await mkBooking(oB, slot8, 'QASEQB1', new Date(t0 + 120_000).toISOString())   // B đặt SAU C
await mkBooking(oC, slot8, 'QASEQC1', new Date(t0 + 60_000).toISOString())
await mkBooking(oD, slot730, 'QASEQD1', new Date(t0 + 180_000).toISOString())
await mkBooking(oF, slot9, 'QASEQF1', new Date(t0).toISOString())
await mkBooking(oG, slot8, 'QASEQG1', new Date(t0).toISOString())

const fetchSeq = async () => (await api(`/wms/outbound/booking-sequence?warehouse_id=${wh}&date_from=${DATE}&date_to=${DATE}`)).j?.data ?? []

// ORACLE tự tính: OUT kỳ vọng D(07:30) → C(08:00, đặt trước) → B(08:00) → A(09:00); E/F vắng mặt
{
  const rows = await fetchSeq()
  const out = rows.filter(r => r.direction === 'OUTBOUND').sort((a, b) => a.stt - b.stt)
  const expected = ['QASEQ_D', 'QASEQ_C', 'QASEQ_B', 'QASEQ_A']
  check('[1] STT theo (khung giờ, giờ đặt) khớp oracle tự tính', JSON.stringify(out.map(r => r.order_code)) === JSON.stringify(expected),
    `got=${out.map(r => r.order_code).join(',')}`)
  check('[2] Số liên tục 1..n không lủng', out.map(r => r.stt).join(',') === '1,2,3,4', `stt=${out.map(r => r.stt).join(',')}`)
  check('[3] Cùng khung giờ: ai đặt TRƯỚC đứng trước (C trước B)', out.findIndex(r => r.order_code === 'QASEQ_C') < out.findIndex(r => r.order_code === 'QASEQ_B'))
  check('[4] Xe KHÔNG booking không có số (E vắng)', !rows.some(r => r.order_code === 'QASEQ_E'))
  check('[5] Lệnh plan_dropped không hiện (F vắng)', !rows.some(r => r.order_code === 'QASEQ_F'))
  const inb = rows.filter(r => r.direction === 'INBOUND')
  check('[6] Chiều NHẬP là dãy RIÊNG (G = STT 1 độc lập)', inb.length === 1 && inb[0].order_code === 'QASEQ_G' && inb[0].stt === 1,
    `inb=${JSON.stringify(inb.map(r => [r.order_code, r.stt]))}`)
  check('[7] Khung giờ trả đúng HH:MM', out[0]?.time_from === '07:30' && out[0]?.time_to === '08:30', `from=${out[0]?.time_from}`)
}

// [8] Số DẪN XUẤT: hủy booking của C → B/A tự dồn lên, không lủng số
{
  await restWrite('TmsVehicleSlot', 'DELETE', `order_id=eq.${oC}`)
  const out = (await fetchSeq()).filter(r => r.direction === 'OUTBOUND').sort((a, b) => a.stt - b.stt)
  check('[8] Hủy booking → số DỒN lại (D=1, B=2, A=3)',
    JSON.stringify(out.map(r => [r.order_code, r.stt])) === JSON.stringify([['QASEQ_D', 1], ['QASEQ_B', 2], ['QASEQ_A', 3]]),
    JSON.stringify(out.map(r => [r.order_code, r.stt])))
}

// Validate tham số — cùng họ QA 07-params-fuzz
{
  const r1 = await api('/wms/outbound/booking-sequence')
  check('[9] Thiếu ngày → 400', r1.s === 400, `http=${r1.s}`)
  const r2 = await api(`/wms/outbound/booking-sequence?date_from=abc&date_to=${DATE}`)
  check('[10] Ngày bậy → 400', r2.s === 400, `http=${r2.s}`)
  const r3 = await api('/wms/outbound/booking-sequence?date_from=2020-01-01&date_to=2029-01-01')
  check('[11] Khoảng >190 ngày → 400 (chống quét cả bảng)', r3.s === 400, `http=${r3.s}`)
}

await cleanup()
const left = await restAll('TmsOrder', 'select=id&order_code=like.QASEQ*')
check('[12] Dọn sạch 0 sót', left.length === 0, `còn ${left.length}`)
finish('32-booking-sequence')
