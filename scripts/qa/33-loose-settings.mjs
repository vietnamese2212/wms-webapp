// GÓI 33 — SETTING NHẶT LẺ 2 TẦNG (24/08). Trước đó luật tự sinh nhặt lẻ là HARDCODE
// (phần dư dưới 1 pallet); nay per KHO + per LOẠI KHO: REMAINDER / ALL / OFF + trần thùng.
// Oracle = TỰ TÍNH LẠI công thức trong JS rồi diff loose_picking mà createGDO ghi ra DB. Gác:
// mặc định = hành vi cũ (REMAINDER; POSM không entry = 0) · OFF ép 0 · ALL = toàn bộ SL (POSM
// vào luồng nhặt lẻ) · trần thùng: bằng trần giữ, vượt trần = 0 · validator 400 · override
// tầng LOẠI thắng mặc định kho.
import { login, api, check, finish, restWrite, restAll, teardownGdo, FIX } from './lib.mjs'
import { randomUUID } from 'crypto'

console.log('── GÓI LOOSE-SETTINGS (nhặt lẻ theo kho + loại kho) ──')
await login()
const now = () => new Date().toISOString()
const TAG = 'QALOOSE'
const gdoIds = []

async function cleanup() {
  for (const id of gdoIds.splice(0)) await teardownGdo(id, 'PENDING')
  // GDO sót từ lần chạy đứt (tra theo kho tag)
  const whs = await restAll('Warehouse', `select=id&code=like.${TAG}*`)
  for (const w of whs) {
    const gs = await restAll('GroupDeliveryOrder', `select=id&warehouse_id=eq.${w.id}`)
    for (const g of gs) await teardownGdo(g.id, 'PENDING')
    // Pool entries sót từ lần chạy đứt: gỡ scan FK trước rồi mới xóa entry + kho
    const ents = await restAll('InventoryEntry', `select=id&warehouse_id=eq.${w.id}`)
    if (ents.length) {
      await restWrite('OutboundScanEntry', 'DELETE', `inventory_entry_id=in.(${ents.map(e => e.id).join(',')})`)
      await restWrite('InventoryEntry', 'DELETE', `warehouse_id=eq.${w.id}`)
    }
    await restWrite('warehouse_type_configs', 'DELETE', `warehouse_id=eq.${w.id}`)
    await restWrite('Warehouse', 'DELETE', `id=eq.${w.id}`)
  }
  await restWrite('Material', 'DELETE', `material_code=like.${TAG}*`)
}
await cleanup()

// Kho QA tạo qua API (để controller tự gán đủ type-configs như kho thật)
const rWh = await api('/masterdata/warehouses', 'POST', {
  code: `${TAG}_WH`, name: 'QA loose settings', warehouse_type: 'CENTRAL', inventory_mode: 'QTY',
})
const whId = rWh.j?.data?.id
check('[0] Tạo kho QA (API, tự gán type-configs)', (rWh.s === 200 || rWh.s === 201) && !!whId, `http=${rWh.s}`)

// 2 mã: FG có thùng+pallet (10 hộp/thùng × 5 thùng/pallet = palletBase 50) · PM kiểu POSM (CÁI, không thùng)
const MAT_FG = `${TAG}_FG`, MAT_PM = `${TAG}_PM`
await restWrite('Material', 'POST', null, {
  id: randomUUID(), material_code: MAT_FG, short_name: 'QA loose FG', material_description: 'QA loose FG', category: 'FG01',
  base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 10, cartons_per_pallet: 5,
  is_active: true, updated_at: now(),
})
await restWrite('Material', 'POST', null, {
  id: randomUUID(), material_code: MAT_PM, short_name: 'QA loose POSM', material_description: 'QA loose POSM', category: 'PM01',
  base_unit: 'CAI', no_qr_tracking: true, is_active: true, updated_at: now(),
})

let seq = 0
async function looseOf(orderedFg, orderedPm) {
  const r = await api('/wms/outbound', 'POST', {
    delivery_date: FIX.DATE, warehouse_id: whId, delivery_code: `${TAG}-DO-${++seq}`,
    customer_name: 'QA NPP', qty_semantics: 'base',
    items: [
      { material_code: MAT_FG, cartons_ordered: orderedFg },
      { material_code: MAT_PM, cartons_ordered: orderedPm },
    ],
  })
  if (r.s !== 201) return { err: `createGDO http=${r.s} ${JSON.stringify(r.j?.error ?? '').slice(0, 120)}` }
  const gdoId = r.j?.data?.id
  gdoIds.push(gdoId)
  const dos = await restAll('OutboundDelivery', `select=id&gdo_id=eq.${gdoId}`)
  const items = await restAll('OutboundItem', `select=material_code_raw,loose_picking&do_id=eq.${dos[0].id}`)
  const by = new Map(items.map(i => [i.material_code_raw, Number(i.loose_picking)]))
  return { fg: by.get(MAT_FG), pm: by.get(MAT_PM) }
}

// [1] MẶC ĐỊNH = hành vi cũ: FG 127 base % 50 = 27 · PM không entry = 0 (POSM xưa nay)
{
  const r = await looseOf(127, 500)
  check('[1] Mặc định REMAINDER: FG lẻ 27 base, PM (không thùng) = 0', r.fg === 27 && r.pm === 0,
    r.err ?? `fg=${r.fg} pm=${r.pm}`)
}

// [2] TRẦN THÙNG: trần 2 thùng — phần lẻ 27 base = 2,7 thùng VƯỢT → 0; lẻ 20 base = 2 thùng ĐÚNG TRẦN → giữ
{
  const rSet = await api(`/masterdata/warehouses/${whId}`, 'PUT', { loose_max_cartons: 2 })
  check('[2a] PUT trần nhặt lẻ qua API kho', rSet.s === 200, `http=${rSet.s}`)
  const over = await looseOf(127, 1)
  const at = await looseOf(120, 1)
  check('[2b] Lẻ 2,7 thùng > trần 2 → KHÔNG nhặt lẻ (0)', over.fg === 0, over.err ?? `fg=${over.fg}`)
  check('[2c] Lẻ đúng bằng trần 2 thùng → vẫn nhặt lẻ (20)', at.fg === 20, at.err ?? `fg=${at.fg}`)
}

// [3] OFF cấp KHO: ép 0 mọi mã
{
  const rSet = await api(`/masterdata/warehouses/${whId}`, 'PUT', { loose_mode: 'OFF', loose_max_cartons: null })
  check('[3a] PUT loose_mode=OFF', rSet.s === 200, `http=${rSet.s}`)
  const r = await looseOf(127, 500)
  check('[3b] Kho OFF → cả FG lẫn PM = 0', r.fg === 0 && r.pm === 0, r.err ?? `fg=${r.fg} pm=${r.pm}`)
}

// [4] Override tầng LOẠI: kho về REMAINDER, riêng PM01 = ALL → POSM lấy TOÀN BỘ, FG giữ phần lẻ
{
  await api(`/masterdata/warehouses/${whId}`, 'PUT', { loose_mode: 'REMAINDER' })
  await restWrite('warehouse_type_configs', 'PATCH', `warehouse_id=eq.${whId}&type_code=eq.PM01`, { loose_mode: 'ALL', updated_at: now() })
  const r = await looseOf(127, 500)
  check('[4] PM01=ALL: POSM loose = TOÀN BỘ 500, FG vẫn 27', r.pm === 500 && r.fg === 27,
    r.err ?? `fg=${r.fg} pm=${r.pm}`)
  // POSM loose > 0 = tự chảy vào trang Nhặt lẻ (RPC lọc loose>0) — kiểm qua API list
  const lp = await api(`/wms/loosepicking?warehouse_id=${whId}&date_from=${FIX.DATE}&date_to=${FIX.DATE}`)
  const hasPm = JSON.stringify(lp.j?.data ?? '').includes(MAT_PM)
  check('[5] POSM hiện trên trang Nhặt lẻ (loose=full)', lp.s === 200 && hasPm, `http=${lp.s} hasPm=${hasPm}`)
}

// [5d][5e] Filter "Loại kho" trang Nhặt lẻ theo LOẠI CỦA MÃ NHẶT LẺ, không theo hàng xe CHỞ
// (migration 20260824c — bug user bắt 24/08: chuyến chở lẫn FG01+PM01 nhưng FG lẻ=0 do trần
// vẫn hiện dưới filter FG01 vì lọc trên GDO.warehouse_type chuỗi ghép)
{
  await api(`/masterdata/warehouses/${whId}`, 'PUT', { loose_max_cartons: 2 })
  const r = await looseOf(127, 77)   // FG lẻ 2,7 thùng > trần 2 → 0; PM01=ALL → 77
  check('[5d-pre] Chuyến chở lẫn: FG lẻ=0 (trần), POSM=77', r.fg === 0 && r.pm === 77, r.err ?? `fg=${r.fg} pm=${r.pm}`)
  const gdoId = gdoIds.at(-1)
  const qs = `warehouse_id=${whId}&date_from=${FIX.DATE}&date_to=${FIX.DATE}`
  const fg = await api(`/wms/loosepicking?${qs}&wh_types=FG01`)
  const pm = await api(`/wms/loosepicking?${qs}&wh_types=PM01`)
  const inFg = JSON.stringify(fg.j?.data ?? '').includes(gdoId)
  const inPm = JSON.stringify(pm.j?.data ?? '').includes(gdoId)
  check('[5d] Filter FG01 KHÔNG hiện chuyến chỉ còn POSM lẻ', fg.s === 200 && !inFg, `http=${fg.s} inFg=${inFg}`)
  check('[5e] Filter PM01 vẫn hiện chuyến đó', pm.s === 200 && inPm, `http=${pm.s} inPm=${inPm}`)
  await api(`/masterdata/warehouses/${whId}`, 'PUT', { loose_max_cartons: null })
}

// [5b] Soạn/giữ POSM với POOL 2 DÒNG (nhập lại 2 đợt) — fix maybeSingle 24/08: trước đó 2 dòng
// cùng pallet_code(=mã) làm tra pool lỗi → 404 "chưa có tồn" OAN dù tồn dư (họ lỗi ed92e2a)
{
  const pmm = (await restAll('Material', `select=id&material_code=eq.${MAT_PM}`))[0]
  for (const [j, q] of [300, 200].entries()) {
    await restWrite('InventoryEntry', 'POST', null, {
      id: randomUUID(), pallet_code: MAT_PM, material_id: pmm.id, warehouse_id: whId,
      location_id: null, cartons_imported: q, cartons_remaining: q, production_date: j === 0 ? '2026-08-01' : '2026-08-10',
      status: 'IN_STOCK', import_date: FIX.DATE, updated_at: now(),
    })
  }
  const gdoId = gdoIds.at(-1)
  const dos = await restAll('OutboundDelivery', `select=id&gdo_id=eq.${gdoId}`)
  const its = await restAll('OutboundItem', `select=id&do_id=eq.${dos[0].id}&material_code_raw=eq.${MAT_PM}`)
  const rM = await api(`/wms/outbound/${gdoId}/items/${its[0].id}/manual-loose`, 'POST', { cartons: 50, qty_semantics: 'base' })
  check('[5b] Pool no-QR 2 dòng: soạn/giữ vẫn OK (hết 404 oan maybeSingle)', rM.s === 200 || rM.s === 201,
    `http=${rM.s} ${JSON.stringify(rM.j?.error ?? '').slice(0, 100)}`)
  const rsv = await restAll('InventoryEntry', `select=cartons_reserved&pallet_code=eq.${MAT_PM}&warehouse_id=eq.${whId}&order=cartons_reserved.desc`)
  check('[5c] Giữ chỗ đúng 50 trên 1 dòng, không trừ tồn', Number(rsv[0]?.cartons_reserved) === 50, `reserved=${rsv.map(r => r.cartons_reserved).join(',')}`)
  // Gỡ vết soạn TRƯỚC (scan entry FK vào pool) rồi mới xóa pool
  const scs = await restAll('OutboundScanEntry', `select=id&item_id=eq.${its[0].id}`)
  for (const sc of scs) await api(`/wms/outbound/${gdoId}/items/${its[0].id}/scans/${sc.id}`, 'DELETE')
  await restWrite('InventoryEntry', 'DELETE', `pallet_code=eq.${MAT_PM}&warehouse_id=eq.${whId}`)
}

// [8] NÚT "TÍNH LẠI NHẶT LẺ" (24/08 — setting không hồi tố, đây là đường áp lại có kiểm soát)
{
  // Trạng thái vào block: kho REMAINDER không trần, PM01=ALL; đơn cuối = (FG 127 → lẻ 27? không —
  // đơn cuối là (127,77) từ [5d] với trần đã reset null ⇒ FG đang lưu 0 (tạo lúc trần 2)
  const gdoId = gdoIds.at(-1)
  const dos = await restAll('OutboundDelivery', `select=id&gdo_id=eq.${gdoId}`)
  const itemOf = async (code) =>
    (await restAll('OutboundItem', `select=id,loose_picking&do_id=eq.${dos[0].id}&material_code_raw=eq.${code}`))[0]

  // [8a] NỚI rule (đã bỏ trần) + có dòng ĐANG SOẠN DỞ → tính lại: FG 0 → 27 (nới vẫn lên được),
  // PM đang soạn 30/77 giữ nguyên 77 (77 ≥ 30, không đụng phần đã soạn)
  const pmm = (await restAll('Material', `select=id&material_code=eq.${MAT_PM}`))[0]
  await restWrite('InventoryEntry', 'POST', null, {
    id: randomUUID(), pallet_code: MAT_PM, material_id: pmm.id, warehouse_id: whId,
    location_id: null, cartons_imported: 300, cartons_remaining: 300, production_date: '2026-08-05',
    status: 'IN_STOCK', import_date: FIX.DATE, updated_at: now(),
  })
  const pmIt = await itemOf(MAT_PM)
  const rM = await api(`/wms/outbound/${gdoId}/items/${pmIt.id}/manual-loose`, 'POST', { cartons: 30, qty_semantics: 'base' })
  check('[8-pre] Soạn dở 30/77 POSM', rM.s === 200 || rM.s === 201, `http=${rM.s}`)
  const r1 = await api('/wms/loosepicking/recalc', 'POST', { warehouse_id: whId })
  const fgAfter = await itemOf(MAT_FG)
  const pmAfter = await itemOf(MAT_PM)
  check('[8a] Nới rule → tính lại: FG 0→27; dòng POSM đang soạn giữ 77', r1.s === 200 &&
    Number(fgAfter.loose_picking) === 27 && Number(pmAfter.loose_picking) === 77,
    `http=${r1.s} fg=${fgAfter?.loose_picking} pm=${pmAfter?.loose_picking} rs=${JSON.stringify(r1.j?.data ?? '')}`)

  // [8b] SIẾT về OFF → tính lại: FG 27 → 0; dòng POSM đã soạn 30 > 0 mới ⇒ GIỮ 77 + đếm kept_scanned.
  // Phải GỠ override PM01=ALL trước (tầng LOẠI thắng kho — không gỡ thì POSM vẫn ALL, không vào ca OFF)
  await restWrite('warehouse_type_configs', 'PATCH', `warehouse_id=eq.${whId}&type_code=eq.PM01`, { loose_mode: null, updated_at: now() })
  await api(`/masterdata/warehouses/${whId}`, 'PUT', { loose_mode: 'OFF' })
  const r2 = await api('/wms/loosepicking/recalc', 'POST', { warehouse_id: whId })
  const fg2 = await itemOf(MAT_FG)
  const pm2 = await itemOf(MAT_PM)
  check('[8b] OFF → tính lại: FG về 0; dòng đã soạn KHÔNG bị cắt dưới số đã soạn (giữ 77, kept_scanned≥1)',
    r2.s === 200 && Number(fg2.loose_picking) === 0 && Number(pm2.loose_picking) === 77 && Number(r2.j?.data?.kept_scanned) >= 1,
    `http=${r2.s} fg=${fg2?.loose_picking} pm=${pm2?.loose_picking} kept=${r2.j?.data?.kept_scanned}`)

  // [8c] Thiếu warehouse_id → 4xx (setting theo kho, không cho quét mù mọi kho)
  const r3 = await api('/wms/loosepicking/recalc', 'POST', {})
  check('[8c] Recalc thiếu kho → 4xx', r3.s >= 400 && r3.s < 500, `http=${r3.s}`)

  // trả trạng thái: gỡ vết soạn + pool + về REMAINDER + PM01=ALL cho các block sau
  const scs = await restAll('OutboundScanEntry', `select=id&item_id=eq.${pmIt.id}`)
  for (const sc of scs) await api(`/wms/outbound/${gdoId}/items/${pmIt.id}/scans/${sc.id}`, 'DELETE')
  await restWrite('InventoryEntry', 'DELETE', `pallet_code=eq.${MAT_PM}&warehouse_id=eq.${whId}`)
  await api(`/masterdata/warehouses/${whId}`, 'PUT', { loose_mode: 'REMAINDER' })
  await restWrite('warehouse_type_configs', 'PATCH', `warehouse_id=eq.${whId}&type_code=eq.PM01`, { loose_mode: 'ALL', updated_at: now() })
}

// [6] Validator: giá trị bậy → 400/422, không ghi
{
  const r1 = await api(`/masterdata/warehouses/${whId}`, 'PUT', { loose_mode: 'XYZ' })
  const r2 = await api(`/masterdata/warehouses/${whId}`, 'PUT', { loose_max_cartons: -5 })
  check('[6] loose_mode bậy / trần âm → 4xx', r1.s >= 400 && r1.s < 500 && r2.s >= 400 && r2.s < 500, `mode=${r1.s} max=${r2.s}`)
}

await cleanup()
const left = await restAll('Material', `select=id&material_code=like.${TAG}*`)
check('[7] Dọn sạch 0 sót', left.length === 0, `còn ${left.length}`)
finish('33-loose-settings')
