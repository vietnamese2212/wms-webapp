// GÓI 28 — CHUYỂN KHO END-TO-END (19/08). Lấp lỗ kiểm pre-go-live: luồng chuyển kho đụng TỒN
// Ở HAI KHO (xuất kho nguồn → lệnh TMS tự sinh → kho đích nhận thành tồn mới) mà trước gói này
// chỉ được test tay. Cross-module 2 CHIỀU đúng luật review-module: chiều tạo (GDO hoàn thành →
// TmsOrder TRANSFER + inbound_plan_lines + TmsVehicleSlot) và chiều gỡ (bỏ hoàn thành, các chốt
// an toàn khi kho đích ĐÃ tạo phiếu / ĐÃ nhận xong).
//
// Bất biến cốt tử: KH nhập = Σ SL xuất theo mã (BASE) = planned phiếu nhập = thực nhận kho đích.
//
// 12 phép kiểm: cờ delivery_confirmation TẮT mode → hoàn thành KHÔNG sinh lệnh · bật mode → sinh
// đủ 4 mảnh (lệnh + KH nhập + slot xe + IN_TRANSIT) · bỏ-hoàn-thành GIỮ lệnh (phương án A) + hoàn
// thành lại KHÔNG sinh trùng · nhận hàng thiếu booking (SĐT/ETA) → 400 · đủ booking → tạo phiếu
// nhập OPEN đúng planned · nhận trùng → 409 · bỏ-hoàn-thành khi kho đích đang nhận → 400
// INBOUND_OPEN · lưu thủ công tạo pool đích + lưu lần 2 → 409 ALREADY_SAVED · hoàn thành phiếu
// cuối → lệnh DONE + DELIVERED · bỏ-hoàn-thành sau DELIVERED → 400 TRANSFER_DELIVERED ·
// oracle số liệu 4 tầng khớp nhau.
// usage: node scripts/qa/28-transfer-receive.mjs
import { login, api, check, finish, restAll, restWrite, resolveFixtures, FIX } from './lib.mjs'
import { randomUUID } from 'crypto'

const TAG = 'QATRF'
console.log('── GÓI TRANSFER-RECEIVE (chuyển kho 2 chiều) ──')
await login()
await resolveFixtures()

const nowIso = () => new Date().toISOString()
const vnDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const QTY = 60
const created = { mat: null, gdo: null, do: null, item: null }
let dcBackup = null

async function cleanup() {
  // thứ tự FK: entry đích → phiếu nhập → KH nhập → slot → lệnh → item/DO/GDO → mã hàng
  await restWrite('InventoryEntry', 'DELETE', `pallet_code=like.${TAG}*`).catch(() => {})
  await restWrite('ProductionImport', 'DELETE', created.gdo ? `from_gdo_id=eq.${created.gdo}` : `import_code=like.*${TAG}*`).catch(() => {})
  const orders = await restAll('TmsOrder', `select=id&order_code=like.*${TAG}*`).catch(() => [])
  for (const o of orders) {
    await restWrite('inbound_plan_lines', 'DELETE', `tms_order_id=eq.${o.id}`).catch(() => {})
    await restWrite('TmsVehicleSlot', 'DELETE', `order_id=eq.${o.id}`).catch(() => {})
    await restWrite('TmsOrder', 'DELETE', `id=eq.${o.id}`).catch(() => {})
  }
  await restWrite('outbound_events', 'DELETE', `group_code=like.${TAG}*`).catch(() => {})
  if (created.gdo) await restWrite('receipt_ratings', 'DELETE', `gdo_id=eq.${created.gdo}`).catch(() => {})   // sao chấm ở [8c] (không FK → tự dọn)
  // MỌI chuyến mang tag (GDO1 + GDO2/GDO3 của [12]) — không chỉ created.gdo
  for (const g of await restAll('GroupDeliveryOrder', `select=id&group_code=like.${TAG}*`).catch(() => [])) {
    for (const d of await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`).catch(() => [])) await restWrite('OutboundItem', 'DELETE', `do_id=eq.${d.id}`).catch(() => {})
    await restWrite('OutboundDelivery', 'DELETE', `gdo_id=eq.${g.id}`).catch(() => {})
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${g.id}`).catch(() => {})
  }
  await restWrite('Material', 'DELETE', `material_code=like.${TAG}*`).catch(() => {})
  // 28/09: khách fixture (mối nối ship-to → kho) + trả chính sách kho nguồn về như cũ
  await restWrite('Customer', 'DELETE', `ship_to_code=like.${TAG}*`).catch(() => {})
  await restWrite('Customer', 'DELETE', `ship_to_code=eq.${FIX.WH_QTY.code}&auto_created=is.true&name=like.${TAG}*`).catch(() => {})
  // [12e] chạy trên KHO QA RIÊNG (08/10, C49 lặp) — bản cũ bật/tắt chính sách của Kho Ba Vì THẬT rồi dọn bằng cách đặt cứng 'NONE'
  for (const w of await restAll('Warehouse', `select=id&code=eq.${TAG}WH`).catch(() => [])) await restWrite('Warehouse', 'DELETE', `id=eq.${w.id}`).catch(() => {})
  // TRẢ cờ hệ thống qua API (xóa luôn cache 30s của instance đang chạy)
  if (dcBackup) await api('/wms/settings/delivery_confirmation', 'PUT', { value: dcBackup })
}
// Tàn dư lần chạy hỏng → dọn trước (kèm GDO tag còn sót)
{
  const oldGdos = await restAll('GroupDeliveryOrder', `select=id&group_code=like.${TAG}*`)
  for (const g of oldGdos) {
    const dos = await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`)
    for (const d of dos) await restWrite('OutboundItem', 'DELETE', `do_id=eq.${d.id}`).catch(() => {})
    await restWrite('OutboundDelivery', 'DELETE', `gdo_id=eq.${g.id}`).catch(() => {})
    await restWrite('ProductionImport', 'DELETE', `from_gdo_id=eq.${g.id}`).catch(() => {})
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${g.id}`).catch(() => {})
  }
  await restWrite('InventoryEntry', 'DELETE', `pallet_code=like.${TAG}*`).catch(() => {})
  for (const o of await restAll('TmsOrder', `select=id&order_code=like.*${TAG}*`)) {
    await restWrite('inbound_plan_lines', 'DELETE', `tms_order_id=eq.${o.id}`).catch(() => {})
    await restWrite('TmsVehicleSlot', 'DELETE', `order_id=eq.${o.id}`).catch(() => {})
    await restWrite('TmsOrder', 'DELETE', `id=eq.${o.id}`).catch(() => {})
  }
  await restWrite('Material', 'DELETE', `material_code=like.${TAG}*`).catch(() => {})
}

const waitCache = () => new Promise(r => setTimeout(r, 31_000))   // SystemSetting cache 30s/instance
const transferOf = async () => (await restAll('TmsOrder',
  `select=id,order_code,status,source_type,delivery_mode,destination_warehouse_id,transfer_gdo_id&transfer_gdo_id=eq.${created.gdo}`))
const gdoRow = async () => (await restAll('GroupDeliveryOrder',
  `select=id,status,transfer_status&id=eq.${created.gdo}`))[0]

try {
  // ── Fixture: mã SIM + GDO ĐANG XUẤT ở kho nguồn, shipto = kho đích QTY ──────
  const [dc] = await restAll('SystemSetting', 'select=value&key=eq.delivery_confirmation')
  dcBackup = dc?.value ?? { enabled: true, modes: ['QR', 'QTY'] }

  const [mat] = await restWrite('Material', 'POST', null, {
    id: randomUUID(), material_code: `${TAG}001`, short_name: `${TAG} hàng test chuyển kho`,
    material_description: `${TAG} hàng test chuyển kho`,
    base_unit: 'EA', category: FIX.MAT_POOL_CAT, is_active: true, no_qr_tracking: true,
    created_at: nowIso(), updated_at: nowIso(),
  })
  created.mat = mat.id
  // 28/09 (Kho ↔ Khách: MỘT mối nối): kho đích = khách trỏ kho, KHÔNG còn suy từ `Warehouse.code` = ship-to.
  // Fixture: khách mang mã ship-to = mã kho đích, trỏ kho đích (đúng thứ ZSD02 sẽ tự nối khi sinh khách trùng mã kho).
  const custQty = (await restAll('Customer', `select=id,warehouse_id&ship_to_code=eq.${FIX.WH_QTY.code}`))[0]
  if (!custQty) await restWrite('Customer', 'POST', null, { id: randomUUID(), ship_to_code: FIX.WH_QTY.code, name: `${TAG} kho đích`, warehouse_id: FIX.WH_QTY.id, is_active: true, auto_created: true, updated_at: nowIso() })
  else if (custQty.warehouse_id !== FIX.WH_QTY.id) await restWrite('Customer', 'PATCH', `id=eq.${custQty.id}`, { warehouse_id: FIX.WH_QTY.id })
  const [gdo] = await restWrite('GroupDeliveryOrder', 'POST', null, {
    id: randomUUID(), group_code: `${TAG}-GDO1`, warehouse_id: FIX.WH_QR.id,
    warehouse_type: FIX.MAT_POOL_CAT, delivery_date: vnDate(), planned_date: vnDate(),
    status: 'IN_PROGRESS', license_plate: `${TAG}XE01`, started_at: nowIso(),
    shipto_party: FIX.WH_QTY.code, created_at: nowIso(), updated_at: nowIso(),
  })
  created.gdo = gdo.id
  const [dlv] = await restWrite('OutboundDelivery', 'POST', null, {
    id: randomUUID(), gdo_id: gdo.id, delivery_code: `${TAG}-DO1`, distributor_name: `${TAG} NPP`,
    created_at: nowIso(), updated_at: nowIso(),
  })
  created.do = dlv.id
  const [item] = await restWrite('OutboundItem', 'POST', null, {
    id: randomUUID(), do_id: dlv.id, material_id: mat.id, material_code_raw: `${TAG}001`,
    cartons_ordered: QTY, cartons_scanned: QTY, loose_picking: 0, status: 'PENDING',
    created_at: nowIso(), updated_at: nowIso(),
  })
  created.item = item.id

  // ── [1] Cờ delivery_confirmation KHÔNG có mode QTY → hoàn thành KHÔNG sinh lệnh ──
  {
    await api('/wms/settings/delivery_confirmation', 'PUT', { value: { enabled: true, modes: ['QR'] } })
    await waitCache()
    const r = await api(`/wms/outbound/${created.gdo}`, 'PATCH', { status: 'COMPLETED' })
    const orders = await transferOf()
    check('[1] Kho đích QTY nhưng cờ chỉ bật mode QR → hoàn thành OK mà KHÔNG sinh lệnh chuyển kho',
      r.s === 200 && orders.length === 0, `http=${r.s} orders=${orders.length}`)
    const u = await api(`/wms/outbound/${created.gdo}/uncomplete`, 'POST')
    check('[1b] Bỏ hoàn thành (chưa có lệnh) → về IN_PROGRESS sạch sẽ',
      u.s === 200 && (await gdoRow())?.status === 'IN_PROGRESS', `http=${u.s}`)
  }

  // ── [2] Bật đủ mode → sinh ĐỦ 4 mảnh ──────────────────────────────────────
  {
    await api('/wms/settings/delivery_confirmation', 'PUT', { value: dcBackup })
    await waitCache()
    const r = await api(`/wms/outbound/${created.gdo}`, 'PATCH', { status: 'COMPLETED' })
    const [ord] = await transferOf()
    const lines = ord ? await restAll('inbound_plan_lines', `select=material_id,planned_boxes,warehouse_id,status&tms_order_id=eq.${ord.id}`) : []
    const slots = ord ? await restAll('TmsVehicleSlot', `select=id,license_plate,status,driver_phone&order_id=eq.${ord.id}`) : []
    const g = await gdoRow()
    check('[2] Hoàn thành → lệnh TRANSFER + KH nhập (planned=SL xuất BASE) + slot xe mang biển GDO + IN_TRANSIT',
      r.s === 200 && ord?.source_type === 'TRANSFER' && ord?.status === 'PENDING'
      && ord?.delivery_mode === 'SCAN' && ord?.destination_warehouse_id === FIX.WH_QTY.id
      && lines.length === 1 && Number(lines[0]?.planned_boxes) === QTY
      && lines[0]?.warehouse_id === FIX.WH_QTY.id
      && slots.length === 1 && slots[0]?.license_plate === `${TAG}XE01`
      && g?.transfer_status === 'IN_TRANSIT',
      `http=${r.s} ord=${ord?.order_code} lines=${lines.length}/${lines[0]?.planned_boxes} slot=${slots[0]?.license_plate} ts=${g?.transfer_status}`)
  }

  // ── [3] Bỏ-hoàn-thành GIỮ lệnh + hoàn thành lại KHÔNG trùng ────────────────
  {
    const u = await api(`/wms/outbound/${created.gdo}/uncomplete`, 'POST')
    const afterUn = await transferOf()
    const g1 = await gdoRow()
    // 09/10 (C5 lặp lần 3): kho xuất SỬA SỐ sau khi bỏ hoàn thành rồi hoàn thành lại TRONG NGÀY — bản cũ chèn dòng mới
    // TRƯỚC khi xoá dòng cũ nên đụng khoá (ngày, kho, NCC, mã, lệnh) ⇒ chèn hỏng, kho nhận giữ SỐ CŨ; [3] chỉ đếm lệnh nên
    // xanh suông từ 29/09 (8 dòng error_logs _RACE 07–09/10). Nay đo thẳng DÒNG kế hoạch nhập.
    const QTY2 = QTY + 10
    await restWrite('OutboundItem', 'PATCH', `id=eq.${created.item}`, { cartons_ordered: QTY2, cartons_scanned: QTY2, updated_at: nowIso() })
    const r = await api(`/wms/outbound/${created.gdo}`, 'PATCH', { status: 'COMPLETED' })
    const afterRe = await transferOf()
    const linesOf = async (id) => id ? restAll('inbound_plan_lines', `select=planned_boxes&tms_order_id=eq.${id}&status=neq.CANCELLED`) : []
    const lines2 = await linesOf(afterRe[0]?.id)
    check('[3] Bỏ hoàn thành: lệnh + booking GIỮ NGUYÊN (phương án A); hoàn thành lại → vẫn đúng 1 lệnh (SYNC, không sinh trùng)',
      u.s === 200 && afterUn.length === 1 && g1?.transfer_status === 'IN_TRANSIT'
      && r.s === 200 && afterRe.length === 1,
      `un=${u.s} giữ=${afterUn.length} re=${r.s} sau=${afterRe.length}`)
    check('[3b] Sửa SL rồi hoàn thành lại TRONG NGÀY ⇒ kế hoạch nhập của lệnh THAY bằng số mới (đúng 1 dòng, planned = SL mới) — không đụng khoá, không giữ số cũ',
      lines2.length === 1 && Number(lines2[0]?.planned_boxes) === QTY2,
      `dòng=${lines2.length} planned=${lines2[0]?.planned_boxes ?? '—'} (mong ${QTY2})`)
    // Trả SL gốc (các phép sau giữ oracle QTY) — đồng bộ lần 3 trong ngày cũng phải đúng
    const u2 = await api(`/wms/outbound/${created.gdo}/uncomplete`, 'POST')
    await restWrite('OutboundItem', 'PATCH', `id=eq.${created.item}`, { cartons_ordered: QTY, cartons_scanned: QTY, updated_at: nowIso() })
    const r2 = await api(`/wms/outbound/${created.gdo}`, 'PATCH', { status: 'COMPLETED' })
    const after3 = await transferOf()
    const lines3 = await linesOf(after3[0]?.id)
    check('[3c] Sửa về SL gốc rồi hoàn thành lần 3 ⇒ vẫn 1 lệnh · 1 dòng · planned = SL gốc (đồng bộ lặp trong ngày)',
      u2.s === 200 && r2.s === 200 && after3.length === 1 && lines3.length === 1 && Number(lines3[0]?.planned_boxes) === QTY,
      `un=${u2.s} re=${r2.s} lệnh=${after3.length} dòng=${lines3.length} planned=${lines3[0]?.planned_boxes ?? '—'}`)
  }

  const [ord] = await transferOf()

  // ── [4] Nhận hàng khi THIẾU booking (SĐT lái xe + ETA) → 400 ───────────────
  {
    const r = await api(`/tms/orders/${ord.id}/confirm-receipt`, 'POST', {})
    check('[4] Thiếu ĐVVT booking (SĐT/ETA) → 400 chặn nhận hàng',
      r.s === 400 && /booking/i.test(r.j?.error?.message ?? ''), `http=${r.s} msg=${(r.j?.error?.message ?? '').slice(0, 70)}`)
  }

  // ── [5] Đủ booking → tạo phiếu nhập OPEN đúng planned ──────────────────────
  {
    const [slot] = await restAll('TmsVehicleSlot', `select=id&order_id=eq.${ord.id}`)
    const b = await api(`/tms/vehicle-slots/${slot.id}`, 'PATCH', { driver_phone: '0900000001', driver_name: `${TAG} tài xế` })
    const eta = new Date(Date.now() + 3600e3).toISOString()
    const e = await api(`/tms/orders/${ord.id}`, 'PATCH', { eta })
    const r = await api(`/tms/orders/${ord.id}/confirm-receipt`, 'POST', {})
    const imps = await restAll('ProductionImport', `select=id,import_code,status,planned_cartons,source_type,warehouse_id&from_gdo_id=eq.${created.gdo}&status=neq.CANCELLED`)
    const g = await gdoRow()
    check('[5] Đủ booking → nhận hàng tạo 1 phiếu nhập OPEN tại kho đích, planned = SL xuất + RECEIVING',
      b.s === 200 && e.s === 200 && r.s === 200 && Number(r.j?.data?.created) === 1
      && imps.length === 1 && imps[0]?.status === 'OPEN' && Number(imps[0]?.planned_cartons) === QTY
      && imps[0]?.source_type === 'TRANSFER' && imps[0]?.warehouse_id === FIX.WH_QTY.id
      && g?.transfer_status === 'RECEIVING',
      `book=${b.s} eta=${e.s} rcv=${r.s} imp=${imps[0]?.import_code}/${imps[0]?.planned_cartons} ts=${g?.transfer_status}`)
  }

  // ── [6] Nhận trùng bị chặn (đang RECEIVING → 400 "phải ở Đang giao"; đua sát nút → 409) ──
  {
    const r = await api(`/tms/orders/${ord.id}/confirm-receipt`, 'POST', {})
    const n = (await restAll('ProductionImport', `select=id&from_gdo_id=eq.${created.gdo}&status=neq.CANCELLED`)).length
    check('[6] Bấm Nhận hàng lần 2 → bị chặn (400/409), vẫn đúng 1 phiếu — không phiếu đôi',
      (r.s === 400 || r.s === 409) && n === 1, `http=${r.s} phiếu=${n}`)
  }

  // ── [6b–6d] BA NHÁNH CHẶN của 3 route trước nay KHÔNG phép kiểm nào chạm (đo 07/09 bằng
  // `surface.mjs`: 385/389 route đã phủ, đây là 3 trong 4 route trống — cả ba đều là đường GHI của
  // luồng chuyển kho). Cố ý chỉ lấy nhánh CHẶN: chúng không đổi trạng thái nên chèn được vào giữa
  // luồng mà không phá các phép sau ([7]–[11] phụ thuộc đúng trạng thái hiện tại).
  {
    // Huỷ xác nhận nhận hàng khi kho đích CÒN phiếu nhập đang hoạt động → phải chặn, nếu không
    // lệnh quay về "đang giao" trong khi phiếu nhập vẫn treo ở kho đích = hai bên hiểu khác nhau.
    const r = await api(`/tms/orders/${ord.id}/cancel-receipt`, 'POST', {})
    const g = await gdoRow()
    check('[6b] Huỷ xác nhận nhận hàng khi còn phiếu nhập đang mở → chặn 409 và GIỮ trạng thái Đang nhận',
      r.s === 409 && g?.transfer_status === 'RECEIVING', `http=${r.s} · trạng thái=${g?.transfer_status}`)
  }
  {
    // Thêm dòng nhận cho mã ĐÃ CÓ (không khai NSX) → 409; nếu không chặn thì kho đích nhận đôi
    // cùng một mã và tồn phình lên gấp đôi.
    const r = await api(`/tms/orders/${ord.id}/create-one-inbound`, 'POST', { material_id: created.mat })
    const n = (await restAll('ProductionImport', `select=id&from_gdo_id=eq.${created.gdo}&status=neq.CANCELLED`)).length
    check('[6c] Thêm dòng nhận cho mã ĐÃ có phiếu → chặn 409, không đẻ phiếu thứ hai',
      r.s === 409 && n === 1, `http=${r.s} · số phiếu=${n}`)
  }
  {
    // "Tài xế tự hoàn thành" chỉ dành cho chuyến mà kho nhận KHÔNG tích nhận (delivery_mode='SELF').
    // Chuyến này đi đường nhận-quét, nên phải bị từ chối — nếu lọt thì chuyến đóng lại trong khi
    // phiếu nhập ở kho đích còn dở dang.
    const r = await api(`/tms/orders/${ord.id}/self-complete`, 'POST', {})
    const g = await gdoRow()
    check('[6d] Chuyến đi đường nhận-quét mà bấm "tài xế tự hoàn thành" → chặn 400, không tự đóng chuyến',
      r.s === 400 && g?.transfer_status === 'RECEIVING', `http=${r.s} · trạng thái=${g?.transfer_status}`)
  }

  // ── [7] Kho nguồn bỏ-hoàn-thành khi kho đích ĐANG NHẬN → 400 INBOUND_OPEN ──
  {
    const r = await api(`/wms/outbound/${created.gdo}/uncomplete`, 'POST')
    check('[7] Kho đích đã tạo phiếu nhập → kho nguồn KHÔNG bỏ-hoàn-thành được (400 INBOUND_OPEN)',
      r.s === 400 && r.j?.error?.code === 'INBOUND_OPEN', `http=${r.s} code=${r.j?.error?.code}`)
  }

  // ── [8] Lưu thủ công tạo POOL đích + lưu lần 2 → 409 ALREADY_SAVED ─────────
  const [imp] = await restAll('ProductionImport', `select=id&from_gdo_id=eq.${created.gdo}&status=neq.CANCELLED`)
  {
    const r = await api(`/wms/inbound-orders/${imp.id}/scan-manual`, 'POST', { cartons: QTY })
    const pool = await restAll('InventoryEntry',
      `select=id,pallet_code,cartons_imported,cartons_remaining,warehouse_id&pallet_code=eq.${TAG}001&warehouse_id=eq.${FIX.WH_QTY.id}`)
    check('[8] Lưu thủ công 60 → pool kho đích sinh đúng (pallet_code=mã hàng, imported=remaining=60)',
      r.s === 200 && pool.length === 1
      && Number(pool[0]?.cartons_imported) === QTY && Number(pool[0]?.cartons_remaining) === QTY,
      `http=${r.s} pool=${pool.length} imp=${pool[0]?.cartons_imported}`)
    const r2 = await api(`/wms/inbound-orders/${imp.id}/scan-manual`, 'POST', { cartons: QTY })
    check('[8b] Lưu thủ công LẦN 2 cùng phiếu → 409 ALREADY_SAVED (không cộng đôi tồn)',
      r2.s === 409 && Number((await restAll('InventoryEntry',
        `select=cartons_imported&pallet_code=eq.${TAG}001&warehouse_id=eq.${FIX.WH_QTY.id}`))[0]?.cartons_imported) === QTY,
      `http=${r2.s} code=${r2.j?.error?.code}`)
  }

  // ── [8c] Chấm sao chuyến giao TRƯỚC khi hoàn thành phiếu ───────────────────
  // Cờ receipt_rating (28/08): `required` chặn bước Hoàn thành bằng 422 RATING_REQUIRED khi chưa chấm — staging đang
  // để `required` nên gói này đỏ oan từ 02/09 (tính năng đổi cửa ghi mà QA không cập nhật kèm). Admin (scope null)
  // được chấm — đường sửa khi kho nhận chấm nhầm; cờ `off` → 400 RATING_OFF cũng coi là qua.
  {
    const rt = await api(`/tms/orders/${ord.id}/receipt-rating`, 'POST', { stars: 5 })
    check('[8c] Kho nhận chấm sao chuyến giao trước khi hoàn thành (5★ → 200; cờ off → RATING_OFF)',
      rt.s === 200 || rt.j?.error?.code === 'RATING_OFF', `http=${rt.s} code=${rt.j?.error?.code ?? ''} ${rt.j?.error?.message ?? ''}`)
  }

  // ── [9] Hoàn thành phiếu cuối → lệnh DONE + DELIVERED ──────────────────────
  {
    const r = await api(`/wms/inbound-orders/${imp.id}/complete`, 'POST', {})
    const [o2] = await transferOf()
    const g = await gdoRow()
    check('[9] Hoàn thành phiếu nhập cuối → lệnh chuyển kho DONE + GDO DELIVERED (cascade đúng)',
      r.s === 200 && o2?.status === 'DONE' && g?.transfer_status === 'DELIVERED',
      `http=${r.s} order=${o2?.status} ts=${g?.transfer_status}`)
  }

  // ── [10] Bỏ-hoàn-thành sau khi kho đích nhận XONG → 400 TRANSFER_DELIVERED ─
  {
    const r = await api(`/wms/outbound/${created.gdo}/uncomplete`, 'POST')
    check('[10] Kho đích đã nhận xong → kho nguồn bỏ-hoàn-thành bị khóa (400 TRANSFER_DELIVERED)',
      r.s === 400 && r.j?.error?.code === 'TRANSFER_DELIVERED', `http=${r.s} code=${r.j?.error?.code}`)
  }

  // ── [11] ORACLE 4 tầng: xuất = KH nhập = planned phiếu = thực nhận ─────────
  {
    const [line] = await restAll('inbound_plan_lines', `select=planned_boxes&tms_order_id=eq.${ord.id}`)
    const [impRow] = await restAll('ProductionImport', `select=planned_cartons,posm_cartons&id=eq.${imp.id}`)
    const [pool] = await restAll('InventoryEntry', `select=cartons_imported&pallet_code=eq.${TAG}001&warehouse_id=eq.${FIX.WH_QTY.id}`)
    const vals = [QTY, Number(line?.planned_boxes), Number(impRow?.planned_cartons), Number(impRow?.posm_cartons), Number(pool?.cartons_imported)]
    check('[11] Oracle: SL xuất = KH nhập = planned phiếu = posm đã lưu = tồn pool đích (BASE, 0 lệch)',
      vals.every(v => v === QTY), `[xuất,line,planned,posm,pool]=${JSON.stringify(vals)}`)
  }

  // ── [12] 28/09 — "ĐẨY LẠI CHO KHO NHẬN" + chính sách ship-to chưa trỏ (user: "gắn kho sau thì kho xuất vào đẩy lại một
  // lượt là chủ động nhất; cái nào đã có sẽ không đẩy được" · "không tự ép gì cả, config hết") ────────────────────────
  {
    const p1 = await api(`/wms/outbound/${created.gdo}/push-transfer`, 'POST', {})
    check('[12a] Chuyến đã có kho nhận và ĐÃ nhận xong → đẩy lại 409 TRANSFER_ALREADY_PUSHED',
      p1.s === 409 && p1.j?.error?.code === 'TRANSFER_ALREADY_PUSHED', `http=${p1.s} code=${p1.j?.error?.code}`)
    // Chuyến 2: ship-to LẠ (chưa có khách / chưa trỏ kho) hoàn thành với cờ OTHER bật ⇒ lệnh SELF không kho đích; đẩy ⇒ 422
    await api('/wms/settings/delivery_confirmation', 'PUT', { value: { enabled: true, modes: ['QR', 'QTY', 'NONE', 'OTHER'] } })
    await waitCache()
    const ST2 = `${TAG}ST2`
    const [g2] = await restWrite('GroupDeliveryOrder', 'POST', null, {
      id: randomUUID(), group_code: `${TAG}-GDO2`, warehouse_id: FIX.WH_QR.id, warehouse_type: FIX.MAT_POOL_CAT,
      delivery_date: vnDate(), planned_date: vnDate(), status: 'IN_PROGRESS', license_plate: `${TAG}XE02`, started_at: nowIso(),
      shipto_party: ST2, created_at: nowIso(), updated_at: nowIso(),
    })
    const [d2] = await restWrite('OutboundDelivery', 'POST', null, { id: randomUUID(), gdo_id: g2.id, delivery_code: `${TAG}-DO2`, distributor_name: `${TAG} NPP 2`, created_at: nowIso(), updated_at: nowIso() })
    await restWrite('OutboundItem', 'POST', null, { id: randomUUID(), do_id: d2.id, material_id: created.mat, material_code_raw: `${TAG}001`, cartons_ordered: QTY, cartons_scanned: QTY, loose_picking: 0, status: 'PENDING', created_at: nowIso(), updated_at: nowIso() })
    const c2 = await api(`/wms/outbound/${g2.id}`, 'PATCH', { status: 'COMPLETED' })
    const o2a = (await restAll('TmsOrder', `select=id,order_code,delivery_mode,destination_warehouse_id,warehouse_id,status&transfer_gdo_id=eq.${g2.id}`))[0]
    const p2 = await api(`/wms/outbound/${g2.id}/push-transfer`, 'POST', {})
    check('[12b] Ship-to chưa trỏ kho: hoàn thành ⇒ lệnh OTHER (SELF, không kho đích, nằm dưới KHO XUẤT) · đẩy lại ⇒ 422 SHIPTO_UNLINKED',
      c2.s === 200 && o2a?.delivery_mode === 'SELF' && o2a?.destination_warehouse_id == null && o2a?.warehouse_id === FIX.WH_QR.id
      && p2.s === 422 && p2.j?.error?.code === 'SHIPTO_UNLINKED',
      `complete=${c2.s} ord=${o2a?.order_code}/${o2a?.delivery_mode}/dest=${o2a?.destination_warehouse_id} push=${p2.s} ${p2.j?.error?.code}`)
    // Trỏ kho SAU khi đã xuất ⇒ không nối tự động; kho xuất bấm đẩy ⇒ CHÍNH lệnh cũ đổi đích + hình thức + kế hoạch nhập
    const cu = await api('/masterdata/customers', 'POST', { ship_to_code: ST2, name: `${TAG} NPP 2`, warehouse_id: FIX.WH_QTY.id })
    const o2b = (await restAll('TmsOrder', `select=destination_warehouse_id&transfer_gdo_id=eq.${g2.id}`))[0]
    const p3 = await api(`/wms/outbound/${g2.id}/push-transfer`, 'POST', {})
    const o2c = (await restAll('TmsOrder', `select=id,order_code,delivery_mode,destination_warehouse_id,warehouse_id&transfer_gdo_id=eq.${g2.id}`))[0]
    const lines2 = o2c ? await restAll('inbound_plan_lines', `select=planned_boxes,warehouse_id&tms_order_id=eq.${o2c.id}`) : []
    const ev = await restAll('outbound_events', `select=event_type&gdo_id=eq.${g2.id}&event_type=eq.TRANSFER_PUSHED`)
    check('[12c] Trỏ kho sau khi xuất: KHÔNG tự nối (đích vẫn trống) · bấm đẩy ⇒ 200, cùng lệnh (giữ id) đổi sang SCAN + kho đích + KH nhập planned = SL xuất · có sự kiện TRANSFER_PUSHED',
      cu.s === 201 && o2b?.destination_warehouse_id == null && p3.s === 200 && p3.j?.data?.dest?.id === FIX.WH_QTY.id
      && o2c?.id === o2a?.id && o2c?.delivery_mode === 'SCAN' && o2c?.destination_warehouse_id === FIX.WH_QTY.id && o2c?.warehouse_id === FIX.WH_QTY.id
      && lines2.length === 1 && Number(lines2[0]?.planned_boxes) === QTY && ev.length === 1,
      `cust=${cu.s} ${cu.j?.error?.message ?? ''} before=${o2b?.destination_warehouse_id} push=${p3.s} ${p3.j?.error?.message ?? ''} mode=${o2c?.delivery_mode} lines=${lines2.length} ev=${ev.length}`)
    const p4 = await api(`/wms/outbound/${g2.id}/push-transfer`, 'POST', {})
    check('[12d] Đẩy lần 2 khi lệnh đã có kho nhận ⇒ 409 TRANSFER_ALREADY_PUSHED, không sinh lệnh đôi',
      p4.s === 409 && p4.j?.error?.code === 'TRANSFER_ALREADY_PUSHED' && (await restAll('TmsOrder', `select=id&transfer_gdo_id=eq.${g2.id}`)).length === 1,
      `http=${p4.s} code=${p4.j?.error?.code}`)
    // Chính sách kho xuất với ship-to "trông như kho WMS mà chưa trỏ" (tên khách TRÙNG tên kho đích, chưa trỏ): NONE im · WARN nhắc · BLOCK chặn
    const ST3 = `${TAG}ST3`
    const whQtyName = (await restAll('Warehouse', `select=name&id=eq.${FIX.WH_QTY.id}`))[0]?.name
    await api('/masterdata/customers', 'POST', { ship_to_code: ST3, name: whQtyName })
    // 08/10 (C49 lặp): kho xuất của [12e] là kho QA RIÊNG — bản cũ bật/tắt chính sách "ship-to trông như kho WMS" của Kho Ba Vì thật,
    // dọn bằng cách ĐẶT CỨNG 'NONE' ⇒ kho thật đang WARN / BLOCK mất cấu hình sau mỗi lượt (kể cả lượt chạy trọn)
    const [whQa] = await restWrite('Warehouse', 'POST', null, {
      id: randomUUID(), code: `${TAG}WH`, name: `${TAG} kho xuất [12e] (bộ kiểm tự dùng)`, warehouse_type: 'CENTRAL', inventory_mode: 'QR',
      require_gate_on_start: false, require_weigh_on_start: false, is_active: true, updated_at: nowIso(),
    })
    const [g3] = await restWrite('GroupDeliveryOrder', 'POST', null, {
      id: randomUUID(), group_code: `${TAG}-GDO3`, warehouse_id: whQa.id, warehouse_type: FIX.MAT_POOL_CAT,
      delivery_date: vnDate(), planned_date: vnDate(), status: 'IN_PROGRESS', license_plate: `${TAG}XE03`, started_at: nowIso(),
      shipto_party: ST3, created_at: nowIso(), updated_at: nowIso(),
    })
    const [d3] = await restWrite('OutboundDelivery', 'POST', null, { id: randomUUID(), gdo_id: g3.id, delivery_code: `${TAG}-DO3`, distributor_name: whQtyName, created_at: nowIso(), updated_at: nowIso() })
    await restWrite('OutboundItem', 'POST', null, { id: randomUUID(), do_id: d3.id, material_id: created.mat, material_code_raw: `${TAG}001`, cartons_ordered: QTY, cartons_scanned: QTY, loose_picking: 0, status: 'PENDING', created_at: nowIso(), updated_at: nowIso() })
    const pb = await api(`/masterdata/warehouses/${whQa.id}`, 'PUT', { unlinked_shipto_policy: 'BLOCK' })
    const gB = await api(`/wms/outbound/${g3.id}`)
    const cB = await api(`/wms/outbound/${g3.id}`, 'PATCH', { status: 'COMPLETED' })
    const pw = await api(`/masterdata/warehouses/${whQa.id}`, 'PUT', { unlinked_shipto_policy: 'WARN' })
    const gW = await api(`/wms/outbound/${g3.id}`)
    const cW = await api(`/wms/outbound/${g3.id}`, 'PATCH', { status: 'COMPLETED' })
    const pn = await api(`/masterdata/warehouses/${whQa.id}`, 'PUT', { unlinked_shipto_policy: 'NONE' })
    const gN = await api(`/wms/outbound/${g3.id}`)
    check('[12e] Kho xuất BLOCK: GET chuyến có unlinked_hint (tên kho, policy BLOCK) · Hoàn thành 422 SHIPTO_UNLINKED · WARN: hint policy WARN, hoàn thành 200 · NONE: không hint · policy lạ không lưu',
      pb.s === 200 && gB.j?.data?.unlinked_hint?.policy === 'BLOCK' && gB.j?.data?.unlinked_hint?.warehouse_name === whQtyName && gB.j?.data?.dest_warehouse == null
      && cB.s === 422 && cB.j?.error?.code === 'SHIPTO_UNLINKED'
      && pw.s === 200 && gW.j?.data?.unlinked_hint?.policy === 'WARN' && cW.s === 200
      && pn.s === 200 && pn.j?.data?.unlinked_shipto_policy === 'NONE' && gN.j?.data?.unlinked_hint == null,
      `block=${pb.s} hint=${JSON.stringify(gB.j?.data?.unlinked_hint)} complete=${cB.s}/${cB.j?.error?.code} warn=${pw.s} hintW=${gW.j?.data?.unlinked_hint?.policy} cW=${cW.s} none=${pn.s}/${pn.j?.data?.unlinked_shipto_policy} hintN=${JSON.stringify(gN.j?.data?.unlinked_hint)}`)
  }
} catch (e) {
  check('gói chạy không nổ', false, String(e))
} finally {
  await cleanup()
  const left = [
    ...(await restAll('InventoryEntry', `select=id&pallet_code=like.${TAG}*`)),
    ...(await restAll('TmsOrder', `select=id&order_code=like.*${TAG}*`)),
    ...(await restAll('GroupDeliveryOrder', `select=id&group_code=like.${TAG}*`)),
  ]
  check('[dọn] 0 tàn dư sau cleanup', left.length === 0, `còn ${left.length}`)
}

finish('TRANSFER-RECEIVE')
