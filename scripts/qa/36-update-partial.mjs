// GÓI UPDATE-PARTIAL (bug 31/08, lộ khi mô phỏng ngày vận hành DAYFLOW):
// PUT /wms/outbound/:id trước đây (a) ghi vô điều kiện `warehouse_id ?? null` + `dvvt` → PUT
// chỉ-sửa-items XOÁ TRẮNG Kho + ĐVVT của chuyến (đo thật: chuyến ĐANG XUẤT, tồn đã trừ, thành
// chuyến "ma" warehouse_id=null — biến mất khỏi mọi màn lọc theo kho); (b) ghi header TRƯỚC khi
// validate items → PUT bị TỪ CHỐI (400 hạ SL dưới mức đã xuất) vẫn đã ghi một nửa.
// Gói này gác cả 2: [1] PUT chỉ-items giữ nguyên header · [2] PUT bị từ chối không ghi gì ·
// [3] field gửi tường minh vẫn ăn như cũ. Fixture kho QTY (không tem — ghi số tay, khỏi cần pallet).
import { login, api, check, finish, restAll, FIX, resolveFixtures, teardownGdo } from './lib.mjs'

console.log('── GÓI UPDATE-PARTIAL (PUT sửa đơn: partial body + validate-trước-ghi) ──')
await login()
await resolveFixtures()

const TAGDC = `QAUPD-${Math.floor(Math.random() * 1e6)}`
let gdoId = null
try {
  // ── Fixture: chuyến tay ở kho QTY, ghi số tay 30/50 (không cần tồn pallet) ──
  const c = await api('/wms/outbound', 'POST', {
    delivery_date: FIX.EXEC_DATE, warehouse_id: FIX.WH_QTY.id, dvvt: FIX.DVVT_TAG,
    customer_name: 'QA-UPD NPP', delivery_code: TAGDC,
    items: [{ material_code: FIX.MAT_POOL, cartons_ordered: 50 }],
  })
  gdoId = c.j?.data?.id
  check('[0] Dựng chuyến tay kho QTY', c.s === 201 || c.s === 200, `s=${c.s}`)
  const st = await api(`/wms/outbound/${gdoId}/start`, 'POST', { license_plate: 'QAUPD01' })
  check('[0] Bắt đầu chuyến', st.s === 200, `s=${st.s} ${JSON.stringify(st.j?.error ?? '')}`)
  const det = await api(`/wms/outbound/${gdoId}`)
  const item = (det.j?.data?.delivery_orders ?? []).flatMap(x => x.items ?? [])[0]
  const mc = await api(`/wms/outbound/${gdoId}/items/${item.id}/manual-complete`, 'POST', { cartons: 30 })
  check('[0] Ghi số tay 30/50', mc.s === 200, `s=${mc.s} ${JSON.stringify(mc.j?.error ?? '')}`)
  await api(`/wms/outbound/${gdoId}`, 'PATCH', { status: 'PAUSED' })   // sửa đơn đòi PENDING/PAUSED

  const header = async () => {
    const [g] = await restAll('GroupDeliveryOrder',
      `select=warehouse_id,dvvt,delivery_date,license_plate&id=eq.${gdoId}`)
    const [d] = await restAll('OutboundDelivery', `select=distributor_name,delivery_code&gdo_id=eq.${gdoId}`)
    return { ...g, npp: d?.distributor_name, dc: d?.delivery_code }
  }
  const h0 = await header()
  check('[0] Header trước khi sửa có đủ Kho + ĐVVT', h0.warehouse_id === FIX.WH_QTY.id && h0.dvvt === FIX.DVVT_TAG,
    JSON.stringify(h0))

  // [2] PUT bị TỪ CHỐI (hạ 20 < đã ghi 30) → 400 và KHÔNG ghi gì (bản lỗi: header đã bị xoá trắng)
  const bad = await api(`/wms/outbound/${gdoId}`, 'PUT', {
    items: [{ db_id: item.id, material_code: FIX.MAT_POOL, cartons_ordered: 20 }],
  })
  const h1 = await header()
  check('[2] Hạ SL dưới mức đã ghi → 400 đúng luật', bad.s === 400, `s=${bad.s}`)
  check('[2] PUT bị từ chối KHÔNG ghi nửa header (Kho/ĐVVT/NPP/ngày giữ nguyên)',
    JSON.stringify(h1) === JSON.stringify(h0), `trước=${JSON.stringify(h0)} sau=${JSON.stringify(h1)}`)

  // [1] PUT chỉ-sửa-items (hạ 50→30 hợp lệ) → 200 và header GIỮ NGUYÊN (bản lỗi: Kho+ĐVVT thành null)
  const good = await api(`/wms/outbound/${gdoId}`, 'PUT', {
    items: [{ db_id: item.id, material_code: FIX.MAT_POOL, cartons_ordered: 30 }],
  })
  const h2 = await header()
  const [itAfter] = await restAll('OutboundItem', `select=cartons_ordered&id=eq.${item.id}`)
  check('[1] PUT chỉ-items thành công + SL ăn', good.s === 200 && Number(itAfter?.cartons_ordered) === 30,
    `s=${good.s} ordered=${itAfter?.cartons_ordered}`)
  check('[1] Kho + ĐVVT + NPP + Số DO không bị xoá trắng',
    h2.warehouse_id === h0.warehouse_id && h2.dvvt === h0.dvvt && h2.npp === h0.npp && h2.dc === h0.dc,
    JSON.stringify(h2))

  // [3] Field gửi TƯỜNG MINH vẫn ghi như cũ (đổi NPP) — chống fix quá tay thành "không ghi gì cả"
  const exp = await api(`/wms/outbound/${gdoId}`, 'PUT', { customer_name: 'QA-UPD NPP 2' })
  const h3 = await header()
  check('[3] Đổi NPP tường minh vẫn ăn', exp.s === 200 && h3.npp === 'QA-UPD NPP 2', `s=${exp.s} npp=${h3.npp}`)

  // Khép vòng đời như user thật: tiếp tục → hoàn thành (30 == 30)
  await api(`/wms/outbound/${gdoId}`, 'PATCH', { status: 'IN_PROGRESS' })
  const fin = await api(`/wms/outbound/${gdoId}`, 'PATCH', { status: 'COMPLETED' })
  check('[4] Hoàn thành sau khi hạ SL = thực xuất', fin.s === 200, `s=${fin.s} ${JSON.stringify(fin.j?.error ?? '')}`)
} finally {
  if (gdoId) {
    const [g] = await restAll('GroupDeliveryOrder', `select=status&id=eq.${gdoId}`)
    const done = await teardownGdo(gdoId, g?.status)
    check('[5] Dọn 0 sót (teardown trả pool)', done === true, String(done))
  }
}
finish('UPDATE-PARTIAL')
