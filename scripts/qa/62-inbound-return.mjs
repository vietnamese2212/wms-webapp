// GÓI 62 — NHẬP HÀNG TRẢ VỀ (26/10, user chốt — memory return-receipt-design-2026-10-26).
// Điều phải giữ:
//   [1] Tìm chuyến xuất GỐC đã hoàn thành; chi tiết chuyến ra đúng số ĐÃ XUẤT theo (DO × mã) + tem đã quét đi
//   [2] Khai trả KHÔNG vượt đã xuất − đã khai trả (422 RETURN_INVALID, không ghi gì); lập tay phải có khách
//   [3] Mỗi mã thành MỘT phiếu nhập nguồn RETURN (không gắn from_gdo_id — cửa nhận chuyển kho đếm theo cột đó)
//   [4] Quét tem đã xuất hết ⇒ dòng tồn mới cùng mã tem; tem còn tồn ⇒ CỘNG DỒN; công tắc QA phiếu bật ⇒ gắn QA "X"
//   [5] Hàng lẻ theo TEM GỐC ⇒ tem con ".N" mang NSX gốc
//   [6] Truy xuất lô trừ phần trả về (qty_returned); sổ pallet có dòng RETURNED; chuỗi tình trạng xe nói "có trả về"
//   [8] (26/10 tối) lý do theo DANH MỤC · ĐỢT THU HỒI (lý do bắt đợt ⇒ phải chọn đợt đang mở) · HÀNG THỪA (vượt số tem đã xuất ⇒ tách
//       tem con, truy xuất lô không trừ) · hàng NPP chuyển về (phiếu TF từ kho loại NPP) gắn lý do / đợt · thống kê + đợt đã thu
// Fixture QA62: chuyến COMPLETED ở kho QR + 2 tem đã quét đi (P1 hết, P2 còn tồn) + chuyến NPP (Bluestar) chuyển về — dọn bằng PostgREST.
import { randomUUID } from 'crypto'
import { login, api, restAll, restWrite, resolveFixtures, FIX, check, finish } from './lib.mjs'

const PACK = '62-inbound-return'
await login(); await resolveFixtures()
const WH = FIX.WH_QR.id, LOC = FIX.LOC_QR_ID
const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const GC = 'QA62_RET_GDO', OD = 'QA62OD1', GC_NPP = 'QA62_NPP_GDO'
const PFX = '011026_510000306_C62_Q6_'
const P1 = `${PFX}001_B`, P2 = `${PFX}002_B`, CHILD = `${PFX}001.1_B`
const mat = (await restAll('Material', `select=id,material_code,units_per_carton&material_code=eq.${FIX.MAT_POOL}`))[0]
const F = Number(mat.units_per_carton) || 1   // hộp / thùng
const qaX = (await restAll('QAStatus', 'select=id&code=eq.X'))[0]?.id

async function cleanup() {
  const rets = await restAll('inbound_return', `select=id&or=(group_code.eq.${GC},ship_to_name.like.QA62*)`)
  const retIds = rets.map(r => r.id)
  const imps = retIds.length ? await restAll('ProductionImport', `select=id&return_id=in.(${retIds.join(',')})`) : []
  const ents = await restAll('InventoryEntry', `select=id&pallet_code=like.${PFX}*`)
  const impEnts = imps.length ? await restAll('InventoryEntry', `select=id&import_order_id=in.(${imps.map(i => i.id).join(',')})`) : []
  const entIds = [...new Set([...ents, ...impEnts].map(e => e.id))]
  if (entIds.length) {
    await restWrite('InventoryAdjustmentLog', 'DELETE', `entry_id=in.(${entIds.join(',')})`).catch(() => {})
    await restWrite('StocktakeLog', 'DELETE', `pallet_code=like.${PFX}*`).catch(() => {})
    await restWrite('InventoryEntry', 'DELETE', `id=in.(${entIds.join(',')})`)
  }
  if (imps.length) await restWrite('ProductionImport', 'DELETE', `id=in.(${imps.map(i => i.id).join(',')})`)
  if (retIds.length) await restWrite('inbound_return', 'DELETE', `id=in.(${retIds.join(',')})`)
  for (const g of await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${GC_NPP}`))
    await restWrite('ProductionImport', 'DELETE', `from_gdo_id=eq.${g.id}`).catch(() => {})
  await restWrite('recall_campaign', 'DELETE', 'code=like.QA62*').catch(() => {})
  for (const g of await restAll('GroupDeliveryOrder', `select=id&group_code=in.(${GC},${GC_NPP})`)) {
    const dos = await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`)
    if (dos.length) {
      const its = await restAll('OutboundItem', `select=id&do_id=in.(${dos.map(d => d.id).join(',')})`)
      if (its.length) await restWrite('OutboundScanEntry', 'DELETE', `item_id=in.(${its.map(i => i.id).join(',')})`).catch(() => {})
      await restWrite('OutboundItem', 'DELETE', `do_id=in.(${dos.map(d => d.id).join(',')})`).catch(() => {})
      await restWrite('OutboundDelivery', 'DELETE', `gdo_id=eq.${g.id}`).catch(() => {})
    }
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${g.id}`)
  }
}

await cleanup()
try {
  // ── Fixture: chuyến đã xuất 10 thùng (P1 6 thùng — hết tem; P2 4 thùng — tem còn 3 thùng trong kho) ──
  const ts = new Date().toISOString()
  const [g] = await restWrite('GroupDeliveryOrder', 'POST', null, { id: randomUUID(), group_code: GC, warehouse_id: WH, delivery_date: todayVN, planned_date: todayVN, status: 'COMPLETED', completed_at: ts, license_plate: 'QA62TEST', created_at: ts, updated_at: ts })
  const [d] = await restWrite('OutboundDelivery', 'POST', null, { id: randomUUID(), gdo_id: g.id, delivery_code: OD, distributor_name: 'QA62 KHÁCH TEST', ship_to_code: 'QA62ST', created_at: ts, updated_at: ts })
  const [it] = await restWrite('OutboundItem', 'POST', null, { id: randomUUID(), do_id: d.id, material_id: mat.id, material_code_raw: mat.material_code, cartons_ordered: 10 * F, cartons_scanned: 10 * F, status: 'COMPLETED', od_refs: [{ od_number: OD, od_item: '10', qty_base: 10 * F }], created_at: ts, updated_at: ts })
  await restWrite('OutboundScanEntry', 'POST', null, [
    { id: randomUUID(), item_id: it.id, pallet_code: P1, cartons_scanned: 6 * F, scanned_at: ts, production_date: '2026-10-01', created_at: ts, updated_at: ts },
    { id: randomUUID(), item_id: it.id, pallet_code: P2, cartons_scanned: 4 * F, scanned_at: ts, production_date: '2026-10-01', created_at: ts, updated_at: ts },
  ])
  const [p2] = await restWrite('InventoryEntry', 'POST', null, { id: randomUUID(), pallet_code: P2, location_id: LOC, warehouse_id: WH, material_id: mat.id, stack_layer: 1,
    cartons_imported: 7 * F, cartons_remaining: 3 * F, production_date: '2026-10-01T00:00:00', status: 'PARTIAL', import_date: todayVN, update_date: todayVN, created_at: ts, updated_at: ts })

  // ── [1] tìm chuyến + chi tiết ──
  const s1 = await api(`/wms/inbound-returns/trips?warehouse_id=${WH}&q=QA62_RET`)
  const hit = (s1.j?.data?.items ?? []).find(t => t.gdo_id === g.id)
  check('1a. Tìm chuyến gốc theo Số xe ⇒ thấy chuyến đã hoàn thành, kèm DO + khách', s1.s === 200 && !!hit && hit.dos.includes(OD) && hit.customers.includes('QA62 KHÁCH TEST'), `http=${s1.s} hit=${JSON.stringify(hit ?? null)?.slice(0, 160)}`)
  const s1b = await api(`/wms/inbound-returns/trips?warehouse_id=${WH}&q=${OD}`)
  check('1b. Tìm theo số DO cũng ra chuyến', (s1b.j?.data?.items ?? []).some(t => t.gdo_id === g.id), `http=${s1b.s}`)
  const t1 = await api(`/wms/inbound-returns/trips/${g.id}`)
  const l1 = (t1.j?.data?.lines ?? []).find(l => l.od_number === OD && l.material_id === mat.id)
  check('1c. Chi tiết chuyến: dòng (DO × mã) đã xuất 10 thùng, chưa trả, 2 tem gốc đúng số', t1.s === 200 && l1?.shipped_base === 10 * F && l1?.returned_base === 0
    && l1?.pallets?.find(p => p.pallet_code === P1)?.qty_base === 6 * F && l1?.pallets?.find(p => p.pallet_code === P2)?.qty_base === 4 * F,
    `http=${t1.s} line=${JSON.stringify(l1 ?? null)?.slice(0, 220)}`)

  // ── [2] khai vượt / lập tay thiếu khách ⇒ 422, không ghi ──
  const over = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, gdo_id: g.id, reason_code: 'TU_CHOI', reason: 'QA62 vượt', qa_hold: false, lines: [{ od_number: OD, material_id: mat.id, qty_base: 11 * F }] })
  const noCust = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, reason_code: 'TU_CHOI', reason: 'QA62 lập tay', qa_hold: false, lines: [{ material_id: mat.id, qty_base: F }] })
  check('2a. Khai trả 11 thùng > đã xuất 10 ⇒ 422 RETURN_INVALID nêu "vượt" · lập tay không ghi khách ⇒ 422 · không phiếu nào được ghi',
    over.s === 422 && over.j?.error?.code === 'RETURN_INVALID' && /vượt/.test(over.j?.error?.message ?? '') && noCust.s === 422
    && (await restAll('inbound_return', `select=id&group_code=eq.${GC}`)).length === 0,
    `over=${over.s}/${over.j?.error?.code} ${(over.j?.error?.message ?? '').slice(0, 100)} noCust=${noCust.s}`)

  // ── [2b] hai người lập CÙNG LÚC trên cùng dòng (còn 10, mỗi người 6) ⇒ đúng một người qua (C104); huỷ ⇒ hoàn lại (C105) ──
  const race = await Promise.all([1, 2].map(() => api('/wms/inbound-returns', 'POST', { warehouse_id: WH, gdo_id: g.id, reason_code: 'TU_CHOI', reason: 'QA62 đua', qa_hold: false, lines: [{ od_number: OD, material_id: mat.id, qty_base: 6 * F }] })))
  const won = race.filter(r => r.s === 201)
  check('2b. Hai người cùng khai 6/10 thùng ⇒ đúng MỘT phiếu được lập, người kia 422 (không khai vượt đã xuất)', won.length === 1 && race.some(r => r.s === 422), `http=${race.map(r => r.s)}`)
  const cancels = []
  for (const r of won) for (const i of r.j?.data?.imports ?? []) cancels.push((await api(`/wms/inbound-orders/${i.id}/cancel`, 'POST', {})).s)
  const tc = await api(`/wms/inbound-returns/trips/${g.id}`)
  check('2c. Huỷ phiếu nhập trả ⇒ số đã khai trả hoàn về 0, đầu phiếu bị bỏ', cancels.length === 1 && cancels.every(s => s === 200)
    && (tc.j?.data?.lines ?? []).find(l => l.od_number === OD)?.returned_base === 0 && (await restAll('inbound_return', `select=id&group_code=eq.${GC}`)).length === 0,
    `cancel=${cancels} returned=${(tc.j?.data?.lines ?? [])[0]?.returned_base}`)

  // ── [3] lập phiếu trả 4 thùng, GIỮ QA ──
  const cr = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, gdo_id: g.id, reason_code: 'TU_CHOI', reason: 'QA62 khách từ chối', qa_hold: true, lines: [{ od_number: OD, material_id: mat.id, qty_base: 4 * F }] })
  const imp = cr.j?.data?.imports?.[0]
  const impRow = imp ? (await restAll('ProductionImport', `select=id,import_code,source_type,status,planned_cartons,from_gdo_id,return_id&id=eq.${imp.id}`))[0] : null
  check('3a. Lập phiếu trả theo chuyến ⇒ 201, số phiếu <kho>_RT_…, MỘT phiếu nhập nguồn RETURN mở, khai 4 thùng, KHÔNG gắn from_gdo_id',
    cr.s === 201 && /_RT_/.test(cr.j?.data?.return_code ?? '') && cr.j?.data?.imports?.length === 1 && impRow?.source_type === 'RETURN' && impRow?.status === 'OPEN'
    && Number(impRow?.planned_cartons) === 4 * F && !impRow?.from_gdo_id && impRow?.return_id === cr.j?.data?.return_id,
    `http=${cr.s} ${cr.j?.error?.message ?? ''} code=${cr.j?.data?.return_code} imp=${JSON.stringify(impRow)}`)
  const t2 = await api(`/wms/inbound-returns/trips/${g.id}`)
  const over2 = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, gdo_id: g.id, reason_code: 'TU_CHOI', reason: 'QA62 lần 2', qa_hold: false, lines: [{ od_number: OD, material_id: mat.id, qty_base: 7 * F }] })
  check('3b. Chuyến ghi đã khai trả 4 thùng · lần trả thứ hai 7 thùng > còn 6 ⇒ 422',
    (t2.j?.data?.lines ?? []).find(l => l.od_number === OD)?.returned_base === 4 * F && over2.s === 422, `ret=${(t2.j?.data?.lines ?? [])[0]?.returned_base} over2=${over2.s}`)
  const sm = await api(`/wms/inbound-orders/summary?warehouse_id=${WH}&search=${encodeURIComponent(impRow?.import_code ?? '-')}`)
  check('3c. Dải tổng Nhập kho đếm phiếu trả ở ô RT, KHÔNG vào SX',
    sm.s === 200 && sm.j?.data?.total_orders === 1 && sm.j?.data?.rt === 1 && sm.j?.data?.sx === 0,
    `http=${sm.s} ${JSON.stringify({ t: sm.j?.data?.total_orders, rt: sm.j?.data?.rt, sx: sm.j?.data?.sx })}`)

  // ── [4] quét nhận: P1 (đã xuất hết) ⇒ dòng tồn mới; P2 (còn tồn) ⇒ cộng dồn; QA giữ ⇒ X ──
  const sc1 = await api(`/wms/inbound-orders/${imp.id}/scan`, 'POST', { qr_code: P1, location_id: LOC, stack_layer: 2, cartons_override: 2 * F })
  const e1 = (await restAll('InventoryEntry', `select=id,pallet_code,cartons_imported,qa_status_id,import_order_id,status&pallet_code=eq.${P1}&import_order_id=eq.${imp.id}`))[0]
  check('4a. Quét tem P1 đã xuất hết ⇒ dòng tồn MỚI cùng mã tem, 2 thùng, gắn QA giữ (X) theo công tắc phiếu',
    sc1.s === 200 && !!e1 && Number(e1.cartons_imported) === 2 * F && e1.qa_status_id === qaX && e1.status === 'IN_STOCK',
    `http=${sc1.s} ${sc1.j?.error?.message ?? ''} entry=${JSON.stringify(e1 ?? null)}`)
  const ck2 = await api(`/wms/inbound-orders/${imp.id}/check-scan`, 'POST', { qr_code: P2, location_id: LOC })
  const sc2 = await api(`/wms/inbound-orders/${imp.id}/scan`, 'POST', { qr_code: P2, location_id: LOC, stack_layer: 3, cartons_override: F })
  const p2after = (await restAll('InventoryEntry', `select=cartons_remaining,status,qa_status_id&id=eq.${p2.id}`))[0]
  const c2 = (await restAll('InventoryEntry', `select=pallet_code,cartons_imported,qa_status_id,import_order_id&pallet_code=eq.${PFX}002.1_B`))[0]
  check('4b. Phiếu GIỮ QA quét tem P2 còn tồn (QA OK) ⇒ KHÔNG cộng dồn: tách tem con ".1" 1 thùng mang QA giữ, pallet P2 giữ nguyên 3 thùng; kiểm trước báo will_split + số gợi ý = 4 thùng tem đã xuất trên chuyến',
    ck2.s === 200 && ck2.j?.data?.will_split === true && ck2.j?.data?.suggested_cartons === 4 * F
    && sc2.s === 200 && sc2.j?.data?.entry?.pallet_code === `${PFX}002.1_B` && Number(c2?.cartons_imported) === F && c2?.qa_status_id === qaX && c2?.import_order_id === imp.id
    && Number(p2after?.cartons_remaining) === 3 * F && p2after?.qa_status_id !== qaX,
    `check=${ck2.s} split=${ck2.j?.data?.will_split} sug=${ck2.j?.data?.suggested_cartons} scan=${sc2.s} ${sc2.j?.error?.message ?? ''} child=${JSON.stringify(c2 ?? null)} p2=${JSON.stringify(p2after)}`)
  // tem LẠ (không đi trên chuyến) ⇒ chặn ở cả kiểm trước, quét, hàng lẻ
  const P9 = `${PFX}009_B`
  const fk = await api(`/wms/inbound-orders/${imp.id}/check-scan`, 'POST', { qr_code: P9, location_id: LOC })
  const fs = await api(`/wms/inbound-orders/${imp.id}/scan`, 'POST', { qr_code: P9, location_id: LOC, cartons_override: F })
  const fl = await api(`/wms/inbound-orders/${imp.id}/return-loose`, 'POST', { source_pallet_code: P9, qty_base: F, location_id: LOC })
  check('4c. Tem không đi trên chuyến gốc ⇒ 422 RETURN_FOREIGN_PALLET ở kiểm trước · quét · hàng lẻ, không tạo tồn',
    [fk, fs, fl].every(r => r.s === 422 && r.j?.error?.code === 'RETURN_FOREIGN_PALLET') && (await restAll('InventoryEntry', `select=id&pallet_code=like.${PFX}009*`)).length === 0,
    `check=${fk.s}/${fk.j?.error?.code} scan=${fs.s}/${fs.j?.error?.code} loose=${fl.s}/${fl.j?.error?.code}`)
  // phiếu KHÔNG giữ QA ⇒ tem còn tồn vẫn cộng dồn như cũ
  const crB = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, gdo_id: g.id, reason_code: 'TU_CHOI', reason: 'QA62 không giữ', qa_hold: false, lines: [{ od_number: OD, material_id: mat.id, qty_base: F }] })
  const scB = await api(`/wms/inbound-orders/${crB.j?.data?.imports?.[0]?.id}/scan`, 'POST', { qr_code: P2, location_id: LOC, cartons_override: F })
  const p2b = (await restAll('InventoryEntry', `select=cartons_remaining&id=eq.${p2.id}`))[0]
  check('4d. Phiếu KHÔNG giữ QA quét tem P2 còn tồn ⇒ CỘNG DỒN (3 → 4 thùng), không tạo dòng mới',
    crB.s === 201 && scB.s === 200 && scB.j?.data?.merged === true && Number(p2b?.cartons_remaining) === 4 * F
    && (await restAll('InventoryEntry', `select=id&pallet_code=eq.${P2}`)).length === 1,
    `lập=${crB.s} scan=${scB.s} ${scB.j?.error?.message ?? ''} rem=${p2b?.cartons_remaining}`)

  // ── [5] hàng lẻ theo tem gốc ⇒ tem con ".1" mang NSX gốc ──
  const lo = await api(`/wms/inbound-orders/${imp.id}/return-loose`, 'POST', { source_pallet_code: P1, qty_base: F, location_id: LOC, stack_layer: 3 })
  const ch = (await restAll('InventoryEntry', `select=pallet_code,cartons_imported,production_date,qa_status_id,import_order_id&pallet_code=eq.${CHILD}`))[0]
  check('5a. Nhận hàng lẻ theo tem P1 ⇒ 201 tem con ".1", 1 thùng, NSX 01/10/2026 như tem gốc, QA giữ, thuộc phiếu trả',
    lo.s === 201 && lo.j?.data?.pallet_code === CHILD && Number(ch?.cartons_imported) === F && String(ch?.production_date ?? '').startsWith('2026-10-01') && ch?.qa_status_id === qaX && ch?.import_order_id === imp.id,
    `http=${lo.s} ${lo.j?.error?.message ?? ''} child=${JSON.stringify(ch ?? null)}`)
  const loBad = await api(`/wms/inbound-orders/${imp.id}/return-loose`, 'POST', { source_pallet_code: '011026_999999999_C62_Q6_001_B', qty_base: F, location_id: LOC })
  check('5b. Tem gốc khác mã hàng của phiếu ⇒ 400 MATERIAL_MISMATCH', loBad.s === 400 && loBad.j?.error?.code === 'MATERIAL_MISMATCH', `http=${loBad.s}/${loBad.j?.error?.code}`)

  // ── [6] sổ nhận trả · truy xuất lô · sổ pallet · chuỗi tình trạng xe ──
  const bo = await api(`/wms/inbound-returns/by-order/${imp.id}`)
  const scans = bo.j?.data?.scans ?? []
  check('6a. Màn chi tiết phiếu trả: 3 lần nhận (P1 mới · P2 tem con · P1 lẻ — không lần nào cộng dồn), tem P1 đã nhận về 3 thùng, P2 tính cả phiếu không giữ = 2 thùng',
    bo.s === 200 && scans.length === 3 && scans.every(s => !s.merged) && scans.some(s => s.source_pallet_code === P2)
    && bo.j?.data?.pallets?.find(p => p.pallet_code === P1)?.returned_base === 3 * F && bo.j?.data?.pallets?.find(p => p.pallet_code === P2)?.returned_base === 2 * F,
    `http=${bo.s} scans=${JSON.stringify(scans.map(s => [s.source_pallet_code?.slice(-6), s.qty_base, s.merged]))}`)
  const lt = await api(`/wms/trace?kind=pallet&value=${encodeURIComponent(P1)}`)
  const sum = lt.j?.data?.summary
  check('6b. Truy xuất lô tem P1: đã xuất 6 thùng, đã trả về 3 thùng (qty_returned)', lt.s === 200 && Number(sum?.qty_shipped) === 6 * F && Number(sum?.qty_returned) === 3 * F,
    `http=${lt.s} ${lt.j?.error?.message ?? ''} summary=${JSON.stringify(sum ?? null)}`)
  const lg = await api(`/wms/inventory/pallet-ledger?pallet_code=${encodeURIComponent(P1)}`)
  const evs = lg.j?.data?.events ?? []
  check('6c. Sổ pallet P1 có dòng "Trả về" (dòng tồn mới, ref chuyến gốc) + dòng "vào tem con" của hàng lẻ',
    lg.s === 200 && evs.some(e => e.kind === 'RETURNED' && (e.ref ?? '').includes(GC)) && evs.some(e => e.kind === 'RETURNED' && (e.note ?? '').includes(CHILD)),
    `http=${lg.s} ${lg.j?.error?.message ?? ''} kinds=${evs.map(e => e.kind).join(',')}`)
  const tf = await api(`/tms/trip-flow?codes=${GC}`)
  const dl = (tf.j?.data?.flows?.[0]?.steps ?? []).find(x => x.key === 'DELIVERED')
  check('6d. Chuỗi tình trạng xe: bước Đã giao nói "có trả về" kèm số phiếu', tf.s === 200 && /có trả về/.test(dl?.label ?? '') && (dl?.note ?? '').includes(cr.j?.data?.return_code ?? '@'),
    `http=${tf.s} step=${JSON.stringify(dl ?? null)?.slice(0, 200)}`)

  // ── [7] lập tay (không chuyến) ──
  const mn = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, ship_to_name: 'QA62 khách lẻ', reason_code: 'TU_CHOI', reason: 'QA62 khách mang trả', qa_hold: false, lines: [{ material_id: mat.id, qty_base: F }] })
  const mnHead = (await restAll('inbound_return', `select=gdo_id,qa_hold,ship_to_name&id=eq.${mn.j?.data?.return_id}`))[0]
  check('7a. Lập tay ⇒ 201, phiếu không chuyến gốc, không giữ QA (mặc định)', mn.s === 201 && mnHead && !mnHead.gdo_id && mnHead.qa_hold === false && mnHead.ship_to_name === 'QA62 khách lẻ',
    `http=${mn.s} ${mn.j?.error?.message ?? ''} head=${JSON.stringify(mnHead ?? null)}`)

  // ── [8a] lý do theo danh mục + đợt thu hồi ──
  const badReason = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, ship_to_name: 'QA62 lý do lạ', reason_code: 'KHONG_CO', qa_hold: false, lines: [{ material_id: mat.id, qty_base: F }] })
  const noRecall = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, ship_to_name: 'QA62 thu hồi', reason_code: 'THU_HOI', qa_hold: false, lines: [{ material_id: mat.id, qty_base: F }] })
  check('8a. Lý do không có trong danh mục ⇒ 422 · lý do "Thu hồi" (bắt đợt) mà không chọn đợt ⇒ 422 RETURN_REASON_INVALID',
    badReason.s === 422 && badReason.j?.error?.code === 'RETURN_REASON_INVALID' && noRecall.s === 422 && /đợt/i.test(noRecall.j?.error?.message ?? ''),
    `bad=${badReason.s}/${badReason.j?.error?.code} noRecall=${noRecall.s} ${(noRecall.j?.error?.message ?? '').slice(0, 80)}`)
  const rc = await api('/wms/recalls', 'POST', { code: 'qa62-rc1', name: 'QA62 thu hồi SP B' })
  const rcDup = await api('/wms/recalls', 'POST', { code: 'QA62-RC1' })
  check('8b. Tạo mã đợt ⇒ 201 (mã tự viết hoa) · trùng mã ⇒ 409', rc.s === 201 && rc.j?.data?.code === 'QA62-RC1' && rc.j?.data?.status === 'OPEN' && rcDup.s === 409,
    `tạo=${rc.s} ${JSON.stringify(rc.j?.data ?? rc.j?.error)?.slice(0, 120)} trùng=${rcDup.s}`)
  const rcId = rc.j?.data?.id
  const withRecall = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, ship_to_name: 'QA62 thu hồi', reason_code: 'THU_HOI', reason: 'SP B hết hạn', recall_id: rcId, qa_hold: true, lines: [{ material_id: mat.id, qty_base: 2 * F }] })
  const wrHead = (await restAll('inbound_return', `select=reason_code,recall_id,reason&id=eq.${withRecall.j?.data?.return_id}`))[0]
  check('8c. Lý do Thu hồi + chọn đợt ⇒ 201, phiếu mang reason_code + recall_id, ghi chú vào reason',
    withRecall.s === 201 && wrHead?.reason_code === 'THU_HOI' && wrHead?.recall_id === rcId && wrHead?.reason === 'SP B hết hạn',
    `http=${withRecall.s} ${withRecall.j?.error?.message ?? ''} head=${JSON.stringify(wrHead ?? null)}`)

  // ── [8d] hàng THỪA: tem P1 xuất 6 thùng, đã nhận về 3 ⇒ nhận lẻ thêm 5 ⇒ 3 trong trần + 2 THỪA (một tem con, sổ ghi hai dòng) ──
  const sur = await api(`/wms/inbound-orders/${imp.id}/return-loose`, 'POST', { source_pallet_code: P1, qty_base: 5 * F, location_id: LOC, stack_layer: 3 })
  const bo2 = await api(`/wms/inbound-returns/by-order/${imp.id}`)
  const p1row = (bo2.j?.data?.pallets ?? []).find(p => p.pallet_code === P1)
  const lt2 = await api(`/wms/trace?kind=pallet&value=${encodeURIComponent(P1)}`)
  check('8d. Nhận lẻ vượt số tem đã xuất ⇒ 201 vẫn nhận (tem con), báo thừa 2 thùng; tem P1: đã nhận về 6 = đã xuất, thừa 2; truy xuất lô trừ 6 (không 8)',
    sur.s === 201 && sur.j?.data?.surplus_base === 2 * F && p1row?.returned_base === 6 * F && p1row?.surplus_base === 2 * F
    && Number(lt2.j?.data?.summary?.qty_returned) === 6 * F,
    `http=${sur.s} ${sur.j?.error?.message ?? ''} surplus=${sur.j?.data?.surplus_base} p1=${JSON.stringify(p1row ?? null)} traceRet=${lt2.j?.data?.summary?.qty_returned}`)
  // quét tem P2 còn tồn trên phiếu KHÔNG giữ (B): xuất 4, đã nhận về 2 ⇒ quét 5 ⇒ cộng dồn 2 + tách 3 thùng thừa thành tem con
  const p2before = Number((await restAll('InventoryEntry', `select=cartons_remaining&id=eq.${p2.id}`))[0]?.cartons_remaining)
  const surScan = await api(`/wms/inbound-orders/${crB.j?.data?.imports?.[0]?.id}/scan`, 'POST', { qr_code: P2, location_id: LOC, stack_layer: 3, cartons_override: 5 * F })
  const p2after2 = Number((await restAll('InventoryEntry', `select=cartons_remaining&id=eq.${p2.id}`))[0]?.cartons_remaining)
  const surChild = surScan.j?.data?.surplus?.pallet_code
  const surEnt = surChild ? (await restAll('InventoryEntry', `select=cartons_imported&pallet_code=eq.${encodeURIComponent(surChild)}`))[0] : null
  check('8e. Quét tem còn tồn vượt số đã xuất ⇒ cộng dồn phần trong trần (2 thùng) + tách 3 thùng THỪA thành tem con',
    surScan.s === 200 && surScan.j?.data?.merged === true && p2after2 - p2before === 2 * F && Number(surEnt?.cartons_imported) === 3 * F,
    `http=${surScan.s} ${surScan.j?.error?.message ?? ''} merged=${surScan.j?.data?.merged} +${(p2after2 - p2before) / F} thùng child=${surChild} ${JSON.stringify(surEnt)}`)

  // ── [8f] hàng NPP chuyển về: chuyến từ kho loại NPP (Bluestar) ⇒ phiếu TF ở kho QR — gắn lý do + đợt ──
  const tsN = new Date().toISOString()
  const [gN] = await restWrite('GroupDeliveryOrder', 'POST', null, { id: randomUUID(), group_code: GC_NPP, warehouse_id: FIX.WH_QTY.id, delivery_date: todayVN, planned_date: todayVN, status: 'COMPLETED', completed_at: tsN, license_plate: 'QA62NPP', created_at: tsN, updated_at: tsN })
  const [impN] = await restWrite('ProductionImport', 'POST', null, { id: randomUUID(), import_code: `QA62NPP_${Date.now()}`, warehouse_id: WH, material_id: mat.id, planned_cartons: 2 * F, status: 'OPEN', source_type: 'TRANSFER', from_gdo_id: gN.id, warehouse_type: FIX.MAT_POOL_CAT ?? null, import_date: todayVN, created_at: tsN, updated_at: tsN })
  const nG = await api(`/wms/inbound-returns/npp/${gN.id}`)
  const nBad = await api(`/wms/inbound-returns/npp/${g.id}`, 'PATCH', { reason_code: 'TU_CHOI' })
  const nEarly = await api(`/wms/inbound-orders/${impN.id}/complete`, 'POST', {})
  check('8f0. Hàng NPP chuyển về CHƯA gắn lý do ⇒ hoàn thành phiếu bị chặn 422 NPP_RETURN_REASON_REQUIRED (user 26/10 "bắt buộc")',
    nEarly.s === 422 && nEarly.j?.error?.code === 'NPP_RETURN_REASON_REQUIRED'
    && (await restAll('ProductionImport', `select=status&id=eq.${impN.id}`))[0]?.status === 'OPEN',
    `http=${nEarly.s}/${nEarly.j?.error?.code}`)
  const nTag = await api(`/wms/inbound-returns/npp/${gN.id}`, 'PATCH', { reason_code: 'THU_HOI', note: 'QA62 NPP gom', recall_id: rcId })
  const nDone = await api(`/wms/inbound-orders/${impN.id}/complete`, 'POST', {})
  check('8f1. Gắn lý do xong ⇒ hoàn thành phiếu NPP chuyển về ⇒ 200', nDone.s === 200, `http=${nDone.s} ${nDone.j?.error?.message ?? ''}`)
  check('8f. Chuyến từ kho NPP ⇒ is_npp; gắn lý do Thu hồi + đợt cho phiếu TF ⇒ 200 (1 phiếu) · chuyến kho chính ⇒ 422 NOT_NPP_TRANSFER',
    nG.s === 200 && nG.j?.data?.is_npp === true && nTag.s === 200 && nTag.j?.data?.updated === 1 && nBad.s === 422 && nBad.j?.error?.code === 'NOT_NPP_TRANSFER',
    `get=${nG.s} npp=${nG.j?.data?.is_npp} tag=${nTag.s} ${nTag.j?.error?.message ?? ''} upd=${nTag.j?.data?.updated} bad=${nBad.s}/${nBad.j?.error?.code}`)

  // ── [8g] thống kê + đợt đã thu ──
  const rep = await api(`/wms/inbound-returns/report?warehouse_id=${WH}&recall_id=${rcId}`)
  const kinds = (rep.j?.data?.rows ?? []).map(r => r.kind).sort().join(',')
  const repAll = await api(`/wms/inbound-returns/report?warehouse_id=${WH}&search=QA62&date_from=${todayVN}&date_to=${todayVN}`)
  const rowB = (repAll.j?.data?.rows ?? []).find(r => r.code === crB.j?.data?.return_code)
  check('8g. Thống kê lọc theo đợt ⇒ đúng 1 phiếu RT + 1 chuyến NPP; dòng phiếu B có thừa 3 thùng; ngày sai lịch ⇒ 400',
    rep.s === 200 && kinds === 'NPP,RT' && rep.j?.data?.summary?.phieu === 2 && rowB && Number(rowB.surplus) === 3 && rowB.first_import
    && (await api(`/wms/inbound-returns/report?date_from=2026-02-31`)).s === 400,
    `http=${rep.s} kinds=${kinds} sum=${JSON.stringify(rep.j?.data?.summary ?? null)?.slice(0, 160)} rowB=${JSON.stringify(rowB ?? null)?.slice(0, 160)}`)
  const bd = await api(`/wms/recalls/${rcId}/breakdown`)
  check('8h. Đợt đã thu: theo mã + theo khách / NPP (phiếu RT lập tay + chuyến NPP)',
    bd.s === 200 && (bd.j?.data?.by_material ?? []).some(m => m.material_id === mat.id) && (bd.j?.data?.by_party ?? []).length === 2,
    `http=${bd.s} ${JSON.stringify(bd.j?.data ?? bd.j?.error)?.slice(0, 200)}`)
  const closeRc = await api(`/wms/recalls/${rcId}`, 'PATCH', { status: 'CLOSED' })
  const afterClose = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, ship_to_name: 'QA62 sau đóng', reason_code: 'THU_HOI', recall_id: rcId, qa_hold: false, lines: [{ material_id: mat.id, qty_base: F }] })
  check('8i. Đóng đợt ⇒ 200 · lập phiếu vào đợt đã đóng ⇒ 422', closeRc.s === 200 && closeRc.j?.data?.status === 'CLOSED' && afterClose.s === 422,
    `close=${closeRc.s} after=${afterClose.s} ${(afterClose.j?.error?.message ?? '').slice(0, 80)}`)
} finally {
  await cleanup()
  check('9. Dọn sạch fixture QA62', (await restAll('inbound_return', `select=id&or=(group_code.eq.${GC},ship_to_name.like.QA62*)`)).length === 0
    && (await restAll('InventoryEntry', `select=id&pallet_code=like.${PFX}*`)).length === 0
    && (await restAll('recall_campaign', 'select=id&code=like.QA62*')).length === 0
    && (await restAll('GroupDeliveryOrder', `select=id&group_code=in.(${GC},${GC_NPP})`)).length === 0)
}
finish(PACK)
