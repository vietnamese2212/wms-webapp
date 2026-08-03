// GÓI 14 — Kế hoạch VC (lệnh booking TMS) là KẾT QUẢ DẪN XUẤT của Kế hoạch xuất (user chốt 03/08).
// Khóa 5 luật:
//   1. Nạp Kế hoạch xuất → lệnh vận chuyển TỰ SINH theo Số xe (1 xe = 1 lệnh, không trùng)
//   2. Sửa DO trong xe → lệnh + KHUNG GIỜ ĐÃ ĐẶT giữ nguyên (chỉ số liệu cập nhật)
//   3. Cả xe bị bỏ → lệnh ngừng hiệu lực + TỰ NHẢ khung giờ (booked_count của khung giờ phải GIẢM)
//   4. Xe có lại → lệnh sống lại NHƯNG KHÔNG kèm khung giờ (phải booking lại)
//   5. Lệnh tự sinh KHÔNG sửa/xóa tay được (422 TMS_PLAN_DERIVED) + Số xe đã có lệnh tay thì NHẬN NUÔI
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
const dvvtName = (await restAll('TransportCompany', 'select=name&type=eq.ĐVVT&order=name&limit=1'))[0]?.name
if (!vehTypeName || !dvvtName) { console.log('❌ thiếu danh mục Loại xe/ĐVVT'); process.exit(1) }

const WH = FIX.WH_QTY
const [y, m, d] = today.split('-')
const GC = n => `${WH.code}_X_${d}${m}${y.slice(2)}_7${n}`
const ALL_GC = [GC(1), GC(2)]
const DO_A = 'QATMSDO01', DO_B = 'QATMSDO02'
const SLOT_TIME = '23:00:00'   // khung giờ test tự tạo (DeliverySlot không có cột ghi chú → nhận diện bằng giờ+ngày+kho)

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
  await restWrite('DeliverySlot', 'DELETE', `date=eq.${today}&time_from=eq.${SLOT_TIME}&warehouse_id=eq.${WH.id}`).catch(() => {})
}
const seedRaw = (doNo, qty) => restWrite('erp_outbound_orders', 'POST', null, {
  id: randomUUID(), od_number: doNo, od_item: '10', material_code: FIX.MAT_POOL, qty_base: qty,
  ship_to_code: 'QATMS', ship_to_name: 'QA TMS NPP', source: 'EXCEL', sync_status: 'ACTIVE',
  last_synced_at: t(), updated_at: t(),
})
const addLine = (gc, doNo) => api('/external/khvc', 'POST', {
  group_code: gc, do_no: doNo, npp: 'QA TMS NPP', export_date: today, veh_type: vehTypeName, dvvt: dvvtName,
})
const orderOf = async gc => (await restAll('TmsOrder',
  `select=id,order_code,origin,plan_dropped,date,vehicle_type,npp_name,planned_pallets&order_code=eq.${gc}`))[0] ?? null
const slotsOf = async orderId => restAll('TmsVehicleSlot', `select=id,slot_id,status&order_id=eq.${orderId}`)

console.log(`── GÓI 14 — Kế hoạch VC dẫn xuất từ Kế hoạch xuất (${BASE.replace('https://', '')}) ──`)
await cleanup()
await seedRaw(DO_A, 100)
await seedRaw(DO_B, 60)

// ── 1. Nạp kế hoạch → lệnh tự sinh ───────────────────────────────────────────
const r1 = await addLine(GC(1), DO_A)
check('1a. Thêm dòng Kế hoạch xuất → OK', r1.s === 201, `http=${r1.s} ${r1.j?.error?.message ?? ''}`)
const o1 = await orderOf(GC(1))
check('1b. Lệnh vận chuyển TỰ SINH theo Số xe', !!o1 && o1.origin === 'KHVC', o1 ? `origin=${o1.origin}` : 'không có lệnh')
check('1c. Lệnh mang đúng ngày + loại xe + NPP của kế hoạch',
  !!o1 && String(o1.date).slice(0, 10) === today && o1.vehicle_type === vehTypeName && o1.npp_name === 'QA TMS NPP',
  `date=${o1?.date} veh=${o1?.vehicle_type} npp=${o1?.npp_name}`)
const s1 = o1 ? await slotsOf(o1.id) : []
check('1d. Lệnh có sẵn 1 dòng xe để đặt khung giờ', s1.length === 1 && s1[0].status === 'PENDING', `slots=${s1.length}`)

// ── 2. Đặt khung giờ rồi SỬA DO → lệnh + khung giờ GIỮ NGUYÊN ────────────────
// Khung giờ test tự tạo (không đụng khung thật), sức chứa 2 xe
const slotId = randomUUID()
const vtId = (await restAll('VehicleType', 'select=id&is_active=eq.true&order=name&limit=1'))[0]?.id
await restWrite('DeliverySlot', 'POST', null, {
  id: slotId, date: today, time_from: SLOT_TIME, time_to: '23:59:00', direction: 'OUTBOUND',
  vehicle_type_id: vtId, cargo_type: 'ALL', warehouse_id: WH.id,
  max_vehicles: 2, booked_count: 0, status: 'OPEN', created_at: t(), updated_at: t(),
})
const bookRes = s1[0] ? await api(`/tms/vehicle-slots/${s1[0].id}`, 'PATCH', { slot_id: slotId, license_plate: 'QATMS111' }) : { s: 0 }
const slotAfterBook = (await restAll('DeliverySlot', `select=booked_count&id=eq.${slotId}`))[0]
check('2a. Đặt được khung giờ cho lệnh tự sinh', bookRes.s === 200 && Number(slotAfterBook?.booked_count) === 1,
  `http=${bookRes.s} booked=${slotAfterBook?.booked_count} ${bookRes.j?.error?.message ?? ''}`)
// thêm DO thứ 2 vào CÙNG xe (sửa kế hoạch, không bỏ xe)
const r2 = await addLine(GC(1), DO_B)
const o1b = await orderOf(GC(1))
const s1b = o1b ? await slotsOf(o1b.id) : []
const slotAfterEdit = (await restAll('DeliverySlot', `select=booked_count&id=eq.${slotId}`))[0]
check('2b. Sửa DO trong xe → lệnh GIỮ NGUYÊN (không tạo trùng, không mất)',
  r2.s === 201 && !!o1b && o1b.id === o1?.id && o1b.plan_dropped === false, `add=${r2.s} same=${o1b?.id === o1?.id}`)
check('2c. KHUNG GIỜ ĐÃ ĐẶT giữ nguyên khi sửa DO',
  s1b.some(s => s.slot_id === slotId) && Number(slotAfterEdit?.booked_count) === 1,
  `slot=${s1b.map(s => s.slot_id).join(',')} booked=${slotAfterEdit?.booked_count}`)

// ── 3. Bỏ CẢ XE khỏi kế hoạch → ngừng hiệu lực + TỰ NHẢ khung giờ ────────────
const lines1 = await restAll('khvc_lines', `select=id&group_code=eq.${GC(1)}`)
const delRes = await api('/external/khvc/bulk-delete', 'POST', { ids: lines1.map(l => l.id) })
const o1c = await orderOf(GC(1))
const s1c = o1c ? await slotsOf(o1c.id) : []
const slotAfterDrop = (await restAll('DeliverySlot', `select=booked_count&id=eq.${slotId}`))[0]
check('3a. Xóa hết dòng kế hoạch của xe → OK', delRes.s === 200 && (delRes.j?.data?.deleted ?? 0) === lines1.length,
  `http=${delRes.s} deleted=${delRes.j?.data?.deleted}/${lines1.length}`)
check('3b. Lệnh vận chuyển KHÔNG bị xóa, chỉ đánh dấu kế hoạch đã bỏ',
  !!o1c && o1c.plan_dropped === true, o1c ? `plan_dropped=${o1c.plan_dropped}` : 'lệnh biến mất')
check('3c. TỰ NHẢ khung giờ (dòng xe hết slot)', s1c.every(s => !s.slot_id), `slots=${JSON.stringify(s1c.map(s => s.slot_id))}`)
check('3d. Bộ đếm chỗ của khung giờ GIẢM (trả chỗ cho xe khác)', Number(slotAfterDrop?.booked_count) === 0,
  `booked=${slotAfterDrop?.booked_count}`)

// ── 4. Xe có LẠI trong kế hoạch → lệnh sống lại, PHẢI booking lại ────────────
const r4 = await addLine(GC(1), DO_A)
const o1d = await orderOf(GC(1))
const s1d = o1d ? await slotsOf(o1d.id) : []
check('4a. Thêm lại dòng kế hoạch → lệnh HOẠT ĐỘNG TRỞ LẠI',
  r4.s === 201 && !!o1d && o1d.plan_dropped === false, `http=${r4.s} plan_dropped=${o1d?.plan_dropped}`)
check('4b. KHÔNG tự đặt lại khung giờ (phải booking lại — user chốt)',
  s1d.every(s => !s.slot_id), `slots=${JSON.stringify(s1d.map(s => s.slot_id))}`)

// ── 5. Lệnh tự sinh không sửa/xóa tay + nhận nuôi lệnh có sẵn ────────────────
if (o1d) {
  const upd = await api(`/tms/orders/${o1d.id}`, 'PATCH', { date: today, vehicle_type: vehTypeName })
  check('5a. Sửa tay trường dẫn xuất → 422 TMS_PLAN_DERIVED',
    upd.s === 422 && upd.j?.error?.code === 'TMS_PLAN_DERIVED', `http=${upd.s} code=${upd.j?.error?.code}`)
  const note = await api(`/tms/orders/${o1d.id}`, 'PATCH', { notes: 'ghi chú điều vận' })
  check('5b. Ghi chú/ưu tiên VẪN sửa được (đồng bộ không đụng tới)', note.s === 200, `http=${note.s}`)
  const del = await api(`/tms/orders/${o1d.id}`, 'DELETE')
  check('5c. Xóa tay lệnh tự sinh → 422 (bỏ ở Kế hoạch xuất mới đúng)',
    del.s === 422 && del.j?.error?.code === 'TMS_PLAN_DERIVED', `http=${del.s} code=${del.j?.error?.code}`)
  // Đường lách user bắt được 03/08: nút "Đổi ngày" HÀNG LOẠT đi endpoint riêng, từng đổi được
  // ngày lệnh dẫn xuất — lượt đồng bộ kế tiếp ghi đè âm thầm. Phải chặn như updateOrder.
  const bd = await api('/tms/orders/bulk-date', 'PATCH', { ids: [o1d.id], date: today })
  check('5e. Đổi ngày HÀNG LOẠT lệnh tự sinh → 422 TMS_PLAN_DERIVED',
    bd.s === 422 && bd.j?.error?.code === 'TMS_PLAN_DERIVED', `http=${bd.s} code=${bd.j?.error?.code}`)
  // Dòng hàng cho điều vận xem khi booking (read-only, từ Kế hoạch xuất + VL06O)
  const goods = await api(`/tms/orders/${o1d.id}/plan-goods`, 'GET')
  check('5f. API dòng hàng lệnh xuất trả 200 + có dòng theo kế hoạch',
    goods.s === 200 && Array.isArray(goods.j?.data?.lines) && goods.j.data.lines.length > 0,
    `http=${goods.s} lines=${goods.j?.data?.lines?.length}`)
  // od_refs trong DB là mảng OBJECT — API phải bóc SỐ DO thành chuỗi, không thì FE in "[object Object]"
  const badRef = (goods.j?.data?.lines ?? []).flatMap(l => l.do_refs ?? []).find(r => typeof r !== 'string')
  check('5g. Cột DO là CHUỖI số DO (không phải object)', badRef === undefined, JSON.stringify(badRef))
}
// Số xe ĐÃ CÓ lệnh tạo tay từ trước → nhận nuôi, KHÔNG tạo trùng
await restWrite('TmsOrder', 'POST', null, {
  id: randomUUID(), order_code: GC(2), date: today, warehouse_id: WH.id, direction: 'OUTBOUND',
  status: 'PENDING', npp_name: 'TAY', created_at: t(), updated_at: t(),
})
const r5 = await addLine(GC(2), DO_B)
const all2 = await restAll('TmsOrder', `select=id,origin,npp_name&order_code=eq.${GC(2)}`)
check('5d. Số xe đã có lệnh tay → NHẬN NUÔI (1 lệnh, đóng dấu KHVC)',
  r5.s === 201 && all2.length === 1 && all2[0].origin === 'KHVC' && all2[0].npp_name === 'QA TMS NPP',
  `http=${r5.s} n=${all2.length} origin=${all2[0]?.origin} npp=${all2[0]?.npp_name}`)

// ── 6. Vết trong sổ lịch sử ──────────────────────────────────────────────────
const evs = await restAll('outbound_events', `select=event_type&group_code=in.(${ALL_GC.join(',')})`)
const types = new Set(evs.map(e => e.event_type))
check('6a. Có vết "tự sinh lệnh"', types.has('TMS_PLAN_CREATED'), [...types].join(','))
check('6b. Có vết "lệnh ngừng hiệu lực + nhả khung giờ"', types.has('TMS_PLAN_DROPPED'), [...types].join(','))
check('6c. Có vết "lệnh sống lại"', types.has('TMS_PLAN_REOPENED'), [...types].join(','))
check('6d. Có vết "nhận nuôi lệnh tạo tay"', types.has('TMS_PLAN_ADOPTED'), [...types].join(','))

await cleanup()
const left = (await restAll('TmsOrder', `select=id&order_code=in.(${ALL_GC.join(',')})`)).length
check('7. Dọn sạch dữ liệu test', left === 0, `còn ${left} lệnh`)

console.log(`\n[14-TMS-PLAN-DERIVED] ${fail === 0 ? `XANH — ${pass} phép kiểm` : `${fail} ĐỎ / ${pass + fail}`}`)
process.exitCode = fail ? 1 : 0
