// GÓI 62 — NHẬP HÀNG TRẢ VỀ (26/10, user chốt — memory return-receipt-design-2026-10-26).
// Điều phải giữ:
//   [1] Tìm chuyến xuất GỐC đã hoàn thành; chi tiết chuyến ra đúng số ĐÃ XUẤT theo (DO × mã) + tem đã quét đi
//   [2] Khai trả KHÔNG vượt đã xuất − đã khai trả (422 RETURN_INVALID, không ghi gì); lập tay phải có khách
//   [3] Mỗi mã thành MỘT phiếu nhập nguồn RETURN (không gắn from_gdo_id — cửa nhận chuyển kho đếm theo cột đó)
//   [4] Quét tem đã xuất hết ⇒ dòng tồn mới cùng mã tem; tem còn tồn ⇒ CỘNG DỒN; công tắc QA phiếu bật ⇒ gắn QA "X"
//   [5] Hàng lẻ theo TEM GỐC ⇒ tem con ".N" mang NSX gốc
//   [6] Truy xuất lô trừ phần trả về (qty_returned); sổ pallet có dòng RETURNED; chuỗi tình trạng xe nói "có trả về"
// Fixture QA62: chuyến COMPLETED ở kho QR + 2 tem đã quét đi (P1 hết, P2 còn tồn) — dọn bằng PostgREST.
import { randomUUID } from 'crypto'
import { login, api, restAll, restWrite, resolveFixtures, FIX, check, finish } from './lib.mjs'

const PACK = '62-inbound-return'
await login(); await resolveFixtures()
const WH = FIX.WH_QR.id, LOC = FIX.LOC_QR_ID
const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const GC = 'QA62_RET_GDO', OD = 'QA62OD1'
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
  for (const g of await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${GC}`)) {
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
  const over = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, gdo_id: g.id, reason: 'QA62 vượt', qa_hold: false, lines: [{ od_number: OD, material_id: mat.id, qty_base: 11 * F }] })
  const noCust = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, reason: 'QA62 lập tay', qa_hold: false, lines: [{ material_id: mat.id, qty_base: F }] })
  check('2a. Khai trả 11 thùng > đã xuất 10 ⇒ 422 RETURN_INVALID nêu "vượt" · lập tay không ghi khách ⇒ 422 · không phiếu nào được ghi',
    over.s === 422 && over.j?.error?.code === 'RETURN_INVALID' && /vượt/.test(over.j?.error?.message ?? '') && noCust.s === 422
    && (await restAll('inbound_return', `select=id&group_code=eq.${GC}`)).length === 0,
    `over=${over.s}/${over.j?.error?.code} ${(over.j?.error?.message ?? '').slice(0, 100)} noCust=${noCust.s}`)

  // ── [2b] hai người lập CÙNG LÚC trên cùng dòng (còn 10, mỗi người 6) ⇒ đúng một người qua (C104); huỷ ⇒ hoàn lại (C105) ──
  const race = await Promise.all([1, 2].map(() => api('/wms/inbound-returns', 'POST', { warehouse_id: WH, gdo_id: g.id, reason: 'QA62 đua', qa_hold: false, lines: [{ od_number: OD, material_id: mat.id, qty_base: 6 * F }] })))
  const won = race.filter(r => r.s === 201)
  check('2b. Hai người cùng khai 6/10 thùng ⇒ đúng MỘT phiếu được lập, người kia 422 (không khai vượt đã xuất)', won.length === 1 && race.some(r => r.s === 422), `http=${race.map(r => r.s)}`)
  const cancels = []
  for (const r of won) for (const i of r.j?.data?.imports ?? []) cancels.push((await api(`/wms/inbound-orders/${i.id}/cancel`, 'POST', {})).s)
  const tc = await api(`/wms/inbound-returns/trips/${g.id}`)
  check('2c. Huỷ phiếu nhập trả ⇒ số đã khai trả hoàn về 0, đầu phiếu bị bỏ', cancels.length === 1 && cancels.every(s => s === 200)
    && (tc.j?.data?.lines ?? []).find(l => l.od_number === OD)?.returned_base === 0 && (await restAll('inbound_return', `select=id&group_code=eq.${GC}`)).length === 0,
    `cancel=${cancels} returned=${(tc.j?.data?.lines ?? [])[0]?.returned_base}`)

  // ── [3] lập phiếu trả 4 thùng, GIỮ QA ──
  const cr = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, gdo_id: g.id, reason: 'QA62 khách từ chối', qa_hold: true, lines: [{ od_number: OD, material_id: mat.id, qty_base: 4 * F }] })
  const imp = cr.j?.data?.imports?.[0]
  const impRow = imp ? (await restAll('ProductionImport', `select=id,import_code,source_type,status,planned_cartons,from_gdo_id,return_id&id=eq.${imp.id}`))[0] : null
  check('3a. Lập phiếu trả theo chuyến ⇒ 201, số phiếu <kho>_RT_…, MỘT phiếu nhập nguồn RETURN mở, khai 4 thùng, KHÔNG gắn from_gdo_id',
    cr.s === 201 && /_RT_/.test(cr.j?.data?.return_code ?? '') && cr.j?.data?.imports?.length === 1 && impRow?.source_type === 'RETURN' && impRow?.status === 'OPEN'
    && Number(impRow?.planned_cartons) === 4 * F && !impRow?.from_gdo_id && impRow?.return_id === cr.j?.data?.return_id,
    `http=${cr.s} ${cr.j?.error?.message ?? ''} code=${cr.j?.data?.return_code} imp=${JSON.stringify(impRow)}`)
  const t2 = await api(`/wms/inbound-returns/trips/${g.id}`)
  const over2 = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, gdo_id: g.id, reason: 'QA62 lần 2', qa_hold: false, lines: [{ od_number: OD, material_id: mat.id, qty_base: 7 * F }] })
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
  const crB = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, gdo_id: g.id, reason: 'QA62 không giữ', qa_hold: false, lines: [{ od_number: OD, material_id: mat.id, qty_base: F }] })
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
  const mn = await api('/wms/inbound-returns', 'POST', { warehouse_id: WH, ship_to_name: 'QA62 khách lẻ', reason: 'QA62 khách mang trả', qa_hold: false, lines: [{ material_id: mat.id, qty_base: F }] })
  const mnHead = (await restAll('inbound_return', `select=gdo_id,qa_hold,ship_to_name&id=eq.${mn.j?.data?.return_id}`))[0]
  check('7a. Lập tay ⇒ 201, phiếu không chuyến gốc, không giữ QA (mặc định)', mn.s === 201 && mnHead && !mnHead.gdo_id && mnHead.qa_hold === false && mnHead.ship_to_name === 'QA62 khách lẻ',
    `http=${mn.s} ${mn.j?.error?.message ?? ''} head=${JSON.stringify(mnHead ?? null)}`)
} finally {
  await cleanup()
  check('9. Dọn sạch fixture QA62', (await restAll('inbound_return', `select=id&or=(group_code.eq.${GC},ship_to_name.like.QA62*)`)).length === 0
    && (await restAll('InventoryEntry', `select=id&pallet_code=like.${PFX}*`)).length === 0
    && (await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${GC}`)).length === 0)
}
finish(PACK)
