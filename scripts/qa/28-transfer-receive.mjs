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
  if (created.item) await restWrite('OutboundItem', 'DELETE', `id=eq.${created.item}`).catch(() => {})
  if (created.do) await restWrite('OutboundDelivery', 'DELETE', `id=eq.${created.do}`).catch(() => {})
  if (created.gdo) await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${created.gdo}`).catch(() => {})
  await restWrite('Material', 'DELETE', `material_code=like.${TAG}*`).catch(() => {})
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
    const r = await api(`/wms/outbound/${created.gdo}`, 'PATCH', { status: 'COMPLETED' })
    const afterRe = await transferOf()
    check('[3] Bỏ hoàn thành: lệnh + booking GIỮ NGUYÊN (phương án A); hoàn thành lại → vẫn đúng 1 lệnh (SYNC, không sinh trùng)',
      u.s === 200 && afterUn.length === 1 && g1?.transfer_status === 'IN_TRANSIT'
      && r.s === 200 && afterRe.length === 1,
      `un=${u.s} giữ=${afterUn.length} re=${r.s} sau=${afterRe.length}`)
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
