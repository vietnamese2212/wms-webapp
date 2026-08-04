// GÓI 17 — TOÀN VẸN SỐ CHỖ CỦA KHUNG GIỜ (sinh từ đợt kiểm 04/08).
// `booked_count` chỉ là CACHE và DB **không có trigger nào** trên TmsVehicleSlot/DeliverySlot:
// `recount_slot` chỉ chạy khi code GỌI TAY, mà FK `order_id` là ON DELETE CASCADE. Nên MỌI đường
// xoá dòng xe/lệnh mà quên đếm lại đều làm khung giờ **kẹt số cũ** — và hậu quả nặng nằm ở GIAO
// DIỆN: picker khoá nút, ghi "Đầy" theo cache ⇒ không ai đặt được vào chỗ trống đó nữa, cũng không
// lượt nào tự sửa (cache chỉ khớp lại khi có người đặt THÀNH CÔNG — mà họ bị chính cái khoá đó chặn).
// Phép kiểm đi qua ĐÚNG endpoint người dùng bấm: xoá dòng Kế hoạch nhập CUỐI CÙNG của một lệnh mà
// xe của lệnh đó ĐANG GIỮ khung giờ. (Lưới rộng hơn: bất biến "cache khớp đếm sống" ở gói 00.)
import { randomUUID } from 'crypto'
import { login, api, restAll, restWrite, resolveFixtures, FIX, BASE } from './lib.mjs'

const t = () => new Date().toISOString()
const DAY = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const WH = FIX.WH_QTY
const TIME = '12:35:00'
let pass = 0, fail = 0
const check = (n, ok, note = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${n}${note ? ` — ${note}` : ''}`) }

await login(); await resolveFixtures()
const vtId = (await restAll('VehicleType', 'select=id&is_active=eq.true&order=name&limit=1'))[0]?.id
const CUA = (await restAll('LookupValue', 'select=value&type=eq.warehouse_type&order=sort_order&limit=1'))[0]?.value

const cache = async id => Number((await restAll('DeliverySlot', `select=booked_count&id=eq.${id}`))[0]?.booked_count)
const occupancy = async id => {
  const rows = await restAll('TmsVehicleSlot', `select=license_plate,status&slot_id=eq.${id}`)
  const held = rows.filter(r => ['BOOKED', 'ARRIVED', 'DONE'].includes(r.status))
  return held.filter(r => !r.license_plate).length + new Set(held.filter(r => r.license_plate).map(r => r.license_plate)).size
}
async function cleanup(slotId) {
  for (const l of await restAll('inbound_plan_lines', `select=id,tms_order_id&po_number=eq.GHOSTFIX`))
    await restWrite('inbound_plan_lines', 'DELETE', `id=eq.${l.id}`).catch(() => {})
  for (const o of await restAll('TmsOrder', `select=id&order_code=like.GHOSTFIX*`)) {
    await restWrite('TmsVehicleSlot', 'DELETE', `order_id=eq.${o.id}`)
    await restWrite('TmsOrder', 'DELETE', `id=eq.${o.id}`)
  }
  if (slotId) await restWrite('DeliverySlot', 'DELETE', `id=eq.${slotId}`).catch(() => {})
  await restWrite('DeliverySlot', 'DELETE', `date=eq.${DAY}&time_from=eq.${TIME}&warehouse_id=eq.${WH.id}`).catch(() => {})
}

console.log(`── KIỂM CHỨNG bản vá khung giờ "ma" (đường API thật) · ${BASE.replace('https://', '')} ──`)
await cleanup()
const slotId = randomUUID()
await restWrite('DeliverySlot', 'POST', null, {
  id: slotId, date: DAY, time_from: TIME, time_to: '23:59:00', direction: 'INBOUND', vehicle_type_id: vtId,
  cargo_type: CUA, warehouse_id: WH.id, max_vehicles: 1, booked_count: 0, status: 'OPEN',
  created_at: t(), updated_at: t(),
})
// Lệnh NHẬP + 1 dòng kế hoạch + dòng xe (đúng hình dạng luồng Kế hoạch nhập)
const oid = randomUUID(), vid = randomUUID(), lid = randomUUID()
await restWrite('TmsOrder', 'POST', null, {
  id: oid, order_code: `GHOSTFIX-${oid.slice(0, 6)}`, date: DAY, warehouse_id: WH.id, direction: 'INBOUND',
  warehouse_type: CUA, origin: 'MANUAL', status: 'PENDING', plan_dropped: false, created_at: t(), updated_at: t(),
})
await restWrite('TmsVehicleSlot', 'POST', null, { id: vid, order_id: oid, status: 'PENDING', created_at: t(), updated_at: t() })
await restWrite('inbound_plan_lines', 'POST', null, {
  id: lid, tms_order_id: oid, date: DAY, warehouse_id: WH.id, warehouse_type: CUA,
  material_id: FIX.MAT_POOL_ID, planned_boxes: 10, planned_pallets: 1, status: 'ACTIVE', po_number: 'GHOSTFIX',
  created_at: t(), updated_at: t(),
})
const rBook = await api(`/tms/vehicle-slots/${vid}`, 'PATCH', { slot_id: slotId, license_plate: '29GF0001' })
console.log(`\n[1] Đặt lịch xe của lệnh nhập: http=${rBook.s} · cache=${await cache(slotId)}/1 · đếm sống=${await occupancy(slotId)}`)

// XOÁ dòng kế hoạch CUỐI qua ĐÚNG endpoint user bấm
const rDel = await api(`/wms/inbound-plan/${lid}`, 'DELETE')
const c1 = await cache(slotId), o1 = await occupancy(slotId)
console.log(`\n[2] Xoá dòng KH cuối qua API: http=${rDel.s}`)
check('Sau khi xoá, chỗ đã đặt của khung khớp đếm sống (không kẹt "Đầy")',
  rDel.s === 200 && c1 === o1, `cache=${c1} đếm sống=${o1}`)
check('Khung giờ trở lại CÒN CHỖ (0/1) để xe khác đặt được', c1 === 0, `cache=${c1}/1`)

console.log('\n🧹 dọn…')
await cleanup(slotId)
console.log(`residue=${(await restAll('TmsOrder', 'select=id&order_code=like.GHOSTFIX*')).length}`)
console.log(`\n[GHOST-FIX] ${pass}/${pass + fail} PASS`)
process.exitCode = fail ? 1 : 0
