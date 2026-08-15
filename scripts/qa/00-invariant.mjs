// GÓI INVARIANT — bất biến dữ liệu, READ-ONLY, chạy TRƯỚC & SAU mọi đợt test.
// Soi thẳng DB staging qua PostgREST (service key backend/.env).
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { HAS_DB, restAll, restRpc, chunk, check, finish } from './lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

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
const aliveGdoForDos = new Set()
for (const c of chunk(doGdoIds))
  for (const g of await restAll('GroupDeliveryOrder', `select=id&id=in.(${c.join(',')})`)) aliveGdoForDos.add(g.id)
const orphanDos = alldos.filter(d => !d.gdo_id || !aliveGdoForDos.has(d.gdo_id))
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

// 8. CHỖ ĐÃ ĐẶT của khung giờ: cache `booked_count` phải KHỚP đếm sống.
//    `booked_count` chỉ là CACHE; DB KHÔNG có trigger nào trên TmsVehicleSlot/DeliverySlot nên
//    `recount_slot` chỉ chạy khi code GỌI TAY, mà FK order_id là ON DELETE CASCADE ⇒ bất kỳ đường
//    xoá nào quên đếm lại là khung giờ kẹt số cũ. Hậu quả đo thật 04/08: cache 2/2 trong khi chỉ
//    còn 1 xe ⇒ giao diện khoá nút "Đầy" ⇒ KHÔNG AI đặt được vào chỗ trống đó nữa, và không lượt
//    nào tự sửa. Bất biến này bắt lệch từ MỌI nguyên nhân, không riêng đường vừa vá.
//    Quy ước đếm phải khớp RPC: dòng không biển = 1 chỗ; dòng có biển = số biển DISTINCT.
{
  const slots = await restAll('DeliverySlot', 'select=id,date,time_from,booked_count,max_vehicles')
  const vslots = await restAll('TmsVehicleSlot', 'select=slot_id,license_plate,status&slot_id=not.is.null')
  const bySlot = new Map()
  for (const v of vslots) {
    if (!['BOOKED', 'ARRIVED', 'DONE'].includes(v.status)) continue
    const g = bySlot.get(v.slot_id) ?? { noPlate: 0, plates: new Set() }
    if (v.license_plate) g.plates.add(v.license_plate); else g.noPlate++
    bySlot.set(v.slot_id, g)
  }
  const lech = slots.filter(s => {
    const g = bySlot.get(s.id)
    return Number(s.booked_count) !== ((g?.noPlate ?? 0) + (g?.plates.size ?? 0))
  })
  check('Chỗ đã đặt của khung giờ khớp đếm sống (không có khung "kẹt Đầy")', lech.length === 0,
    lech.length ? `${lech.length} khung lệch, vd ${lech[0].date} ${lech[0].time_from} cache=${lech[0].booked_count}` : `soi ${slots.length} khung`)
  const vuot = slots.filter(s => Number(s.booked_count) > Number(s.max_vehicles))
  check('Không khung giờ nào vượt sức chứa', vuot.length === 0,
    vuot.length ? `vd ${vuot[0].date} ${vuot[0].time_from} ${vuot[0].booked_count}/${vuot[0].max_vehicles}` : `soi ${slots.length} khung`)
}

// 9. LỆNH FILL (hạ hàng xuống vị trí nhặt lẻ) — 3 bất biến cấu trúc (v3 05/08: lệnh theo DATE,
//    KHÔNG ghim tem — bất biến (a) đổi khóa theo mô hình mới).
//    (a) MỘT (kho, ngày xuất, mã, date) chỉ được có MỘT dòng đang treo: hai dòng trùng khóa
//        nghĩa là hai người cùng ra lệnh một việc — "đang về" bị đếm đôi, phần "thiếu" tụt oan.
//        DB có unique index `uq_filltask_pending_matdate` gác; bất biến bắt cả trường hợp index
//        bị DROP nhầm khi sửa bảng.
//    (b) Dòng ĐÃ HẠ phải có mốc thời gian — thiếu thì báo cáo tỷ lệ/thời gian trung bình sai câm.
//    (c) Vị trí ĐÍCH phải đang là vị trí nhặt lẻ: khai nhầm cờ rồi bỏ khai sẽ biến lệnh thành
//        "hạ hàng lên tầng trên" mà không ai thấy.
{
  const tasks = await restAll('FillTask',
    'select=id,warehouse_id,target_date,material_id,required_date,status,done_at,to_location_id')
  const pend = tasks.filter(t => t.status === 'PENDING')
  const seen = new Map()
  for (const t of pend) {
    const k = `${t.warehouse_id}|${t.target_date}|${t.material_id}|${t.required_date ?? ''}`
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  const dup = [...seen.entries()].filter(([, n]) => n > 1)
  check('Mỗi (kho, ngày xuất, mã, date) chỉ có 1 dòng lệnh fill đang treo', dup.length === 0,
    dup.length ? `${dup.length} khóa có >1 dòng, vd ${dup[0][0]}` : `soi ${pend.length} dòng treo`)

  const doneNoStamp = tasks.filter(t => t.status === 'DONE' && !t.done_at)
  check('Lệnh fill đã hạ đều có mốc hoàn thành', doneNoStamp.length === 0,
    doneNoStamp.length ? `${doneNoStamp.length} lệnh thiếu done_at` : `soi ${tasks.filter(t => t.status === 'DONE').length} lệnh đã hạ`)

  if (pend.length) {
    const locIds = [...new Set(pend.map(t => t.to_location_id).filter(Boolean))]
    const pf = new Set()
    for (let i = 0; i < locIds.length; i += 200) {
      const rows = await restAll('Location',
        `select=id&is_pick_face=is.true&id=in.(${locIds.slice(i, i + 200).join(',')})`)
      for (const r of rows) pf.add(r.id)
    }
    const bad = pend.filter(t => !pf.has(t.to_location_id))
    check('Đích của lệnh fill đang treo vẫn là VỊ TRÍ NHẶT LẺ', bad.length === 0,
      bad.length ? `${bad.length} lệnh trỏ vào vị trí không còn là nhặt lẻ` : `soi ${pend.length} lệnh treo`)
  } else {
    check('Đích của lệnh fill đang treo vẫn là VỊ TRÍ NHẶT LẺ', true, 'chưa có lệnh treo')
  }
}

// 10. REALTIME KHAI RỒI THÌ PHẢI NHẬN ĐƯỢC (chốt 04/08).
//     Lỗi này ÂM THẦM tuyệt đối: bảng ghi đúng, API trả đúng, chỉ MÀN HÌNH ĐANG MỞ là đứng im.
//     Hai cách chết: (a) bảng không nằm trong publication `supabase_realtime`; (b) bật RLS mà
//     KHÔNG có policy SELECT cho `authenticated` — Realtime phát sự kiện dưới quyền đó nên client
//     không nhận gì. Đo thật 04/08: FillTask (mới) và outbound_events (sổ lịch sử chuyến, phát
//     hiện 03/08) đều dính (b); `Employee` dính (a) và đã gỡ khỏi bản đồ vì HR cố ý đóng.
//     Nguồn sự thật = TABLE_QUERY_MAP của FE: đó là chỗ app TỰ KHAI "tôi cần realtime bảng này".
{
  const src = readFileSync(join(ROOT, 'frontend', 'src', 'api', 'realtimeEvents.ts'), 'utf8')
  const body = src.slice(src.indexOf('TABLE_QUERY_MAP'))
  const declared = [...body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*\[/gm)].map(m => m[1])
  const ready = await restRpc('realtime_readiness')
  const broken = declared.filter(t => {
    const r = ready?.[t]
    return !r || !r.in_pub || (r.rls && Number(r.sel_pol) === 0)
  })
  check('Bảng khai realtime trong code đều NHẬN được sự kiện (publication + policy đọc)',
    broken.length === 0,
    broken.length
      ? `${broken.length} bảng câm: ${broken.slice(0, 4).map(t => `${t}(${!ready?.[t]?.in_pub ? 'ngoài publication' : 'thiếu policy đọc'})`).join(', ')}`
      : `soi ${declared.length} bảng`)

  // MỌI bảng public phải BẬT RLS (cảnh báo Supabase 03/08: StocktakeLog + 10 bảng backup hở —
  // ai có anon key đọc/sửa được). RPC rls_gap_tables (migration 20260805c) liệt kê bảng tắt;
  // bảng MỚI quên bật là đỏ trong ngày thay vì chờ email cảnh báo.
  const rlsGaps = await restRpc('rls_gap_tables')
  check('Mọi bảng public đều bật RLS (không bảng nào hở với anon key)',
    Array.isArray(rlsGaps) && rlsGaps.length === 0,
    Array.isArray(rlsGaps)
      ? (rlsGaps.length ? `HỞ: ${rlsGaps.slice(0, 5).join(', ')}${rlsGaps.length > 5 ? '…' : ''}` : 'soi toàn schema public')
      : 'RPC rls_gap_tables chưa apply (migration 20260805c)')
}

finish('INVARIANT')
