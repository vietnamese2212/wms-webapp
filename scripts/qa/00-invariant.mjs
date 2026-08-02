// GÓI INVARIANT — bất biến dữ liệu, READ-ONLY, chạy TRƯỚC & SAU mọi đợt test.
// Soi thẳng DB staging qua PostgREST (service key backend/.env).
import { HAS_DB, restAll, chunk, check, finish } from './lib.mjs'

if (!HAS_DB) {
  console.error('Thiếu backend/.env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) — không soi được DB')
  process.exit(1)
}
console.log('── GÓI INVARIANT (read-only) ──')

// 1. Tồn không âm
const neg = await restAll('InventoryEntry', 'select=id,pallet_code,cartons_remaining&cartons_remaining=lt.0')
check('Tồn kho không âm', neg.length === 0, neg.length ? `${neg.length} dòng ÂM, vd ${neg[0].pallet_code}=${neg[0].cartons_remaining}` : '')

// 2. Không xuất quá kế hoạch (so 2 cột — client-side)
const items = await restAll('OutboundItem', 'select=id,material_code_raw,cartons_ordered,cartons_scanned&cartons_scanned=gt.0')
const over = items.filter(i => Number(i.cartons_scanned) > Number(i.cartons_ordered))
check('Không item nào xuất quá kế hoạch', over.length === 0, over.length ? `${over.length} item, vd ${over[0].material_code_raw}: ${over[0].cartons_scanned}/${over[0].cartons_ordered}` : `soi ${items.length} item`)

// 3. TmsOrder chuyển kho không mồ côi + không TRÙNG theo GDO
const tOrders = await restAll('TmsOrder', 'select=id,order_code,transfer_gdo_id&transfer_gdo_id=not.is.null')
const gdoIds = [...new Set(tOrders.map(o => o.transfer_gdo_id))]
const foundGdo = new Set()
for (const c of chunk(gdoIds))
  for (const g of await restAll('GroupDeliveryOrder', `select=id&id=in.(${c.join(',')})`)) foundGdo.add(g.id)
const orphanOrders = tOrders.filter(o => !foundGdo.has(o.transfer_gdo_id))
check('Không lệnh chuyển kho mồ côi (GDO đã xóa)', orphanOrders.length === 0, orphanOrders.length ? `vd ${orphanOrders[0].order_code}` : `soi ${tOrders.length} lệnh`)
const cnt = new Map()
for (const o of tOrders) cnt.set(o.transfer_gdo_id, (cnt.get(o.transfer_gdo_id) ?? 0) + 1)
const dups = [...cnt.entries()].filter(([, n]) => n > 1)
check('Không GDO nào có 2+ lệnh chuyển kho (TRÙNG)', dups.length === 0, dups.length ? `${dups.length} GDO trùng lệnh` : '')

// 4. inbound_plan_lines không mồ côi (TmsOrder đã xóa)
const lines = await restAll('inbound_plan_lines', 'select=id,tms_order_id&tms_order_id=not.is.null')
const lineOrderIds = [...new Set(lines.map(l => l.tms_order_id))]
const foundOrd = new Set()
for (const c of chunk(lineOrderIds))
  for (const o of await restAll('TmsOrder', `select=id&id=in.(${c.join(',')})`)) foundOrd.add(o.id)
const orphanLines = lines.filter(l => !foundOrd.has(l.tms_order_id))
check('Không dòng kế hoạch nhập mồ côi', orphanLines.length === 0, orphanLines.length ? `${orphanLines.length} dòng` : `soi ${lines.length} dòng`)

// 5. OutboundScanEntry không mồ côi (item đã xóa)
const scans = await restAll('OutboundScanEntry', 'select=id,item_id')
const itemIds = [...new Set(scans.map(s => s.item_id))]
const foundItem = new Set()
for (const c of chunk(itemIds))
  for (const i of await restAll('OutboundItem', `select=id&id=in.(${c.join(',')})`)) foundItem.add(i.id)
const orphanScans = scans.filter(s => !foundItem.has(s.item_id))
check('Không scan entry mồ côi', orphanScans.length === 0, orphanScans.length ? `${orphanScans.length} entry` : `soi ${scans.length} entry`)

// 5b. OutboundDelivery không mồ côi (chuyến đã xóa) — probe 02/08 C5b: 2 lượt replan/upload chạy
// song song trên cùng Số xe (chuyến PENDING = xóa-tạo-lại) sinh DO trỏ chuyến vừa bị xóa. Rác này
// KHÔNG hiện ở màn nào nên chỉ invariant mới thấy; replan nay tự dọn (sweepOrphanDeliveries).
const alldos = await restAll('OutboundDelivery', 'select=id,delivery_code,gdo_id')
const doGdoIds = [...new Set(alldos.map(d => d.gdo_id).filter(Boolean))]
const foundGdo = new Set()
for (const c of chunk(doGdoIds))
  for (const g of await restAll('GroupDeliveryOrder', `select=id&id=in.(${c.join(',')})`)) foundGdo.add(g.id)
const orphanDos = alldos.filter(d => !d.gdo_id || !foundGdo.has(d.gdo_id))
check('Không DO xuất mồ côi (chuyến đã xóa)', orphanDos.length === 0,
  orphanDos.length ? `${orphanDos.length} DO — vd ${orphanDos[0].delivery_code}` : `soi ${alldos.length} DO`)

// 6. GDO COMPLETED nhưng transfer_status IN_TRANSIT phải CÓ lệnh (ngược của mồ côi)
const doneGdos = await restAll('GroupDeliveryOrder', 'select=id,group_code,status,transfer_status&transfer_status=eq.IN_TRANSIT')
const withOrder = new Set(tOrders.map(o => o.transfer_gdo_id))
const missing = doneGdos.filter(g => !withOrder.has(g.id))
check('GDO đang IN_TRANSIT đều có lệnh chuyển kho', missing.length === 0, missing.length ? `vd ${missing[0].group_code}` : `soi ${doneGdos.length} GDO`)

// 7. BIỂN SỐ đúng dạng chuẩn ^[A-Z0-9]+$ (user chốt 31/07) — DB đã có CHECK, đây là lưới thứ hai:
//    CHECK có thể bị DROP nhầm khi sửa bảng, và migration production có thể chưa apply.
//    CỐ Ý bỏ qua WeighTicket.license_plate + erp_outbound_orders.license_plate: 2 cột đó lưu
//    NGUYÊN VĂN chứng từ nguồn (dạng chuẩn của phiếu cân nằm ở license_plate_norm).
const BAD_PLATE = /[^A-Z0-9]/
for (const [table, label] of [
  ['Vehicle', 'danh mục Xe'],
  ['gate_registrations', 'Đăng ký cổng'],
  ['GroupDeliveryOrder', 'chuyến xuất'],
  ['TmsVehicleSlot', 'slot xe TMS'],
]) {
  const rows = await restAll(table, 'select=id,license_plate&license_plate=not.is.null')
  const bad = rows.filter(r => BAD_PLATE.test(r.license_plate))
  check(`Biển số ${label} đúng dạng (chỉ chữ+số, in hoa)`, bad.length === 0,
    bad.length ? `${bad.length} dòng sai, vd "${bad[0].license_plate}"` : `soi ${rows.length} dòng`)
}

finish('INVARIANT')
