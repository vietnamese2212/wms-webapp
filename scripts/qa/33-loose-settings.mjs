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
