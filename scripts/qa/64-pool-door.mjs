// GÓI CỬA TỒN GỘP (rà soát MES 25/11 — docs/plans/MES_REVIEW_2026-11-25.md đợt 5, user chốt "làm như gợi ý"):
// cửa "Lưu thủ công" / "Xuất luôn" của Xuất kho trừ tồn gộp (hàng không tem) phải theo CÙNG luật "dòng lấy được" với cửa quét
// và cửa cấp NVL vào mẻ — trước đây outbound_pool_apply cộng SUM(remaining) mọi dòng ⇒ lấy cả hàng QA giữ + phần đang GIỮ cho
// nhặt lẻ; xác nhận nhặt lẻ sau đó kẹp tồn về 0 ⇒ xuất lố không ai biết (MES_PHASE1_PLAN.md:87 đã hứa gói kiểm "hai cửa").
// [1] dòng đang giữ cho nhặt lẻ chỉ góp phần RẢNH vào số khả dụng; dòng QA giữ góp 0 (oracle: chênh khả dụng trước / sau khi dựng)
// [2] Lưu thủ công vượt khả dụng thật ⇒ 400 INSUFFICIENT_STOCK, không dòng nào bị trừ
// [3] Điều chỉnh tồn xuống dưới phần đang giữ ⇒ 409 RESERVED
// Fixture kho QTY + mã pool của lib (mẫu gói 36); dòng dựng mang tag, dọn 0 sót.
import { login, api, check, finish, restAll, restWrite, FIX, resolveFixtures, teardownGdo } from './lib.mjs'
import { randomUUID } from 'crypto'

console.log('── GÓI CỬA TỒN GỘP (Lưu thủ công theo luật "dòng lấy được": trừ giữ chỗ, bỏ QA giữ) ──')
await login()
await resolveFixtures()

const vnToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const TAG = `QAPOOL-${Math.floor(Math.random() * 1e6)}`
const seeded = []
let gdoId = null
try {
  const [qaHold] = await restAll('QAStatus', 'select=id,code&code=neq.OK&limit=1')
  const gdo = await api('/wms/outbound', 'POST', {
    delivery_date: FIX.EXEC_DATE, warehouse_id: FIX.WH_QTY.id, dvvt: FIX.DVVT_TAG,
    customer_name: 'QA-POOL NPP', delivery_code: TAG,
    items: [{ material_code: FIX.MAT_POOL, cartons_ordered: 900000 }],
  })
  gdoId = gdo.j?.data?.id
  check('[0] Dựng chuyến tay kho QTY', gdo.s === 201 || gdo.s === 200, `s=${gdo.s} ${JSON.stringify(gdo.j?.error ?? '')}`)
  const st = await api(`/wms/outbound/${gdoId}/start`, 'POST', { license_plate: 'QAPOOL01' })
  check('[0] Bắt đầu chuyến', st.s === 200, `s=${st.s} ${JSON.stringify(st.j?.error ?? '')}`)
  const item = ((await api(`/wms/outbound/${gdoId}`)).j?.data?.delivery_orders ?? []).flatMap(x => x.items ?? [])[0]
  const stock = async () => num((await api(`/wms/outbound/${gdoId}/items/${item?.id}/manual-stock`)).j?.data?.cartons_remaining)

  const before = await stock()
  const nowIso = new Date().toISOString()
  const row = (o) => ({ id: randomUUID(), material_id: FIX.MAT_POOL_ID, pallet_code: FIX.MAT_POOL, warehouse_id: FIX.WH_QTY.id, location_id: null,
    stack_layer: 1, import_date: vnToday, notes: TAG, created_at: nowIso, updated_at: nowIso, ...o })
  // dòng A: còn 10, 4 đang giữ cho nhặt lẻ ⇒ góp 6 · dòng B: còn 7 nhưng QA giữ ⇒ góp 0 (không có mã QA ≠ OK thì bỏ phần B)
  const rows = [row({ cartons_imported: 10, cartons_remaining: 10, cartons_reserved: 4, status: 'LOOSE_PICKING' })]
  if (qaHold) rows.push(row({ cartons_imported: 7, cartons_remaining: 7, cartons_reserved: 0, status: 'IN_STOCK', qa_status_id: qaHold.id }))
  const ins = await restWrite('InventoryEntry', 'POST', null, rows)
  for (const r of ins ?? []) seeded.push(r.id)
  const after = await stock()
  check('[1] Khả dụng chỉ tăng phần RẢNH của dòng đang giữ (6); dòng QA giữ không góp', after - before === 6,
    `trước=${before} sau=${after} (cũ: +${qaHold ? 17 : 10})`)

  const want = after + 1
  const mc = await api(`/wms/outbound/${gdoId}/items/${item?.id}/manual-complete`, 'POST', { cartons: want, qty_semantics: 'base' })
  const left = await restAll('InventoryEntry', `select=id,cartons_remaining,cartons_reserved,status&id=in.(${seeded.join(',')})`)
  check('[2] Lưu thủ công vượt khả dụng thật ⇒ 400 INSUFFICIENT_STOCK; dòng đang giữ / QA giữ không bị trừ',
    mc.s === 400 && mc.j?.error?.code === 'INSUFFICIENT_STOCK' && left.every(r => num(r.cartons_remaining) === (num(r.cartons_reserved) === 4 ? 10 : 7)),
    `s=${mc.s} ${mc.j?.error?.code} ${JSON.stringify(left)}`)

  const adj = await api(`/wms/inventory/${seeded[0]}/adjust`, 'PATCH', { adjustment: -8, note: TAG })
  check('[3] Điều chỉnh tồn xuống dưới phần đang giữ (10 − 8 = 2 < 4) ⇒ 409 RESERVED', adj.s === 409 && adj.j?.error?.code === 'RESERVED',
    `s=${adj.s} ${adj.j?.error?.code}`)
} finally {
  if (gdoId) {
    const [g] = await restAll('GroupDeliveryOrder', `select=status&id=eq.${gdoId}`)
    const done = await teardownGdo(gdoId, g?.status)
    check('[9] Dọn chuyến 0 sót', done === true, String(done))
  }
  for (const id of seeded) await restWrite('InventoryAdjustmentLog', 'DELETE', `entry_id=eq.${id}`).catch(() => {})
  for (const id of seeded) await restWrite('InventoryEntry', 'DELETE', `id=eq.${id}`).catch(() => {})
  const rest = seeded.length ? await restAll('InventoryEntry', `select=id&id=in.(${seeded.join(',')})`) : []
  check('[9] Dọn dòng tồn dựng 0 sót', rest.length === 0, `còn ${rest.length}`)
}
function num(v) { return Number(v ?? 0) }
finish('POOL-DOOR')
