// GÓI 61 — ĐIỀU VẬN: kế hoạch ghép chuyến nháp + vòng đời xe chờ ĐVVT (đợt 2 TMS điều vận, 24/09;
// plan docs/plans/TMS_DISPATCH_PLAN.md mục 7 · đề xuất benchmark A3). Điều user chốt 24/09 mà gói này khoá lại:
//   [1] Máy ĐỀ XUẤT: pool = OD ZSD02 của kho × ngày giao chưa vào Kế hoạch xuất → chuyến nháp; OD cùng phường ghép một xe,
//       dòng xe rẻ nhất còn vừa, ĐVVT theo bảng cước; oracle độc lập = giá bảng cước × ceil(pallet từ master).
//   [2] Người SỬA nháp: đổi ĐVVT (cước tính lại, thiếu cước nói lý do), chuyển OD sang xe mới / xe khác, nháp cũ bị thay.
//   [3] Config "ĐVVT cần phản hồi" (TransportCompany.tender_required): Xác nhận ⇒ xe của ĐVVT KHÔNG cần phản hồi vào
//       Kế hoạch xuất ngay (khvc_lines + chuyến sinh), xe của ĐVVT CẦN phản hồi đứng CHỜ; xe chờ/đã chốt không sửa được;
//       từ chối ⇒ đổi ĐVVT ⇒ chốt lẻ xe ⇒ kế hoạch CONFIRMED. Kế hoạch đang chờ không cho lập lại.
// Fixture QA61_*: dựng qua API thật + PostgREST, ngày giao 2027-03-16 (xa để không đụng OD thật), dọn hết ở finally.
import { login, api, restAll, restWrite, resolveFixtures, FIX, check, finish } from './lib.mjs'

const PACK = '61-dispatch'
const DAY = '2027-03-16'
const SAP = 'QA61X09', W1 = 'QA61-W1', W2 = 'QA61-W2', REGION = 'QA61R'
const OD = ['QA61OD1', 'QA61OD2', 'QA61OD3'], SHIP = ['QA61SHIP1', 'QA61SHIP2', 'QA61SHIP3']
const nowIso = () => new Date().toISOString()

await login(); await resolveFixtures()
const WH = FIX.WH_QR.id
const PREFIX = `${FIX.WH_QR.code}_X_160327_`
const cos = await restAll('TransportCompany', `select=id,code,name,tender_required&code=in.(DA,HA)`)
const DA = cos.find(c => c.code === 'DA'), HA = cos.find(c => c.code === 'HA')
if (!DA || !HA) throw new Error('Fixture: cần ĐVVT DA và HA trong danh mục TransportCompany')
const HA_FLAG0 = HA.tender_required === true
const XEPALLET = ((await api('/tms/vehicle-types')).j?.data ?? []).find(p => p.code === 'XEPALLET')
const wh = (await restAll('Warehouse', `select=sap_plant&id=eq.${WH}`))[0]
const mat = (await restAll('Material', `select=units_per_carton,cartons_per_pallet&material_code=eq.${FIX.MAT_POOL}`))[0]
const perPallet = Number(mat.units_per_carton) * Number(mat.cartons_per_pallet)
const PAL = [4, 3, 3]           // OD1 4 pallet W1 · OD2 3 pallet W1 · OD3 3 pallet W2 ⇒ xe 1 = OD1+OD2 (7/9) · xe 2 = OD3 (3/9 Non tải, gộp vào xe 1 thì 10 > 9)
const PRICE_DA = 200_000, PRICE_HA = 250_000

async function cleanupTrips() {
  const gdos = await restAll('GroupDeliveryOrder', `select=id&group_code=like.${PREFIX}*`)
  const gids = gdos.map(g => g.id)
  if (gids.length) {
    const csv = `(${gids.join(',')})`
    const dos = await restAll('OutboundDelivery', `select=id&gdo_id=in.${csv}`)
    if (dos.length) {
      const doCsv = `(${dos.map(d => d.id).join(',')})`
      const items = await restAll('OutboundItem', `select=id&do_id=in.${doCsv}`)
      if (items.length) await restWrite('OutboundScanEntry', 'DELETE', `item_id=in.(${items.map(i => i.id).join(',')})`).catch(() => {})
      await restWrite('OutboundItem', 'DELETE', `do_id=in.${doCsv}`).catch(() => {})
      await restWrite('OutboundDelivery', 'DELETE', `gdo_id=in.${csv}`).catch(() => {})
    }
    await restWrite('wms_tasks', 'DELETE', `gdo_id=in.${csv}`).catch(() => {})
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=in.${csv}`).catch(() => {})
  }
  await restWrite('reconcile_tasks', 'DELETE', `group_code=like.${PREFIX}*`).catch(() => {})
  await restWrite('outbound_events', 'DELETE', `group_code=like.${PREFIX}*`).catch(() => {})
  for (const o of await restAll('TmsOrder', `select=id&order_code=like.${PREFIX}*`)) {
    await restWrite('TmsVehicleSlot', 'DELETE', `order_id=eq.${o.id}`).catch(() => {})
    await restWrite('TmsOrder', 'DELETE', `id=eq.${o.id}`).catch(() => {})
  }
  await restWrite('khvc_lines', 'DELETE', `group_code=like.${PREFIX}*`).catch(() => {})
  await restWrite('dispatch_plan', 'DELETE', `warehouse_id=eq.${WH}&plan_date=eq.${DAY}`).catch(() => {})   // cascade trip + trip_od
}
async function cleanup() {
  await cleanupTrips()
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=like.QA61*`).catch(() => {})
  await restWrite('Customer', 'DELETE', `ship_to_code=like.QA61*`).catch(() => {})
  await restWrite('freight_tariff', 'DELETE', `ward_code=like.QA61*`).catch(() => {})
  const vm = await restAll('vehicle_model', `select=id&sap_code=like.QA61*`)
  if (vm.length) {
    await restWrite('freight_tariff', 'DELETE', `vehicle_model_id=in.(${vm.map(v => v.id).join(',')})`).catch(() => {})
    await restWrite('vehicle_model', 'DELETE', `id=in.(${vm.map(v => v.id).join(',')})`).catch(() => {})
  }
  await restWrite('TransportCompany', 'PATCH', `id=eq.${HA.id}`, { tender_required: HA_FLAG0 }).catch(() => {})
}
await cleanup()

const planOf = async (id) => (await api(`/tms/dispatch/plans/${id}`)).j?.data
const tripOfOd = (plan, od) => plan?.trips?.find(t => t.ods.some(o => o.od_number === od))
const sur = (t) => (t?.detail?.freight?.surcharges ?? []).reduce((s, x) => s + Number(x.total ?? 0), 0)

try {
  // ── Fixture: dòng xe con 9 pallet (gán cha) · cước DA@W1 · cước HA@W2 · 3 OD ZSD02 + khách (phường/vùng) ──
  const cr = await api('/tms/vehicle-models', 'POST', { sap_code: SAP, name: 'QA61 Xe 9 Pallet', capacity_mode: 'PALLET', max_pallets: 9, tariff_unit: 'PER_PALLET' })
  const vmId = cr.j?.data?.id
  await api('/tms/vehicle-models/assign-parent', 'PATCH', { ids: [vmId], parent_type_id: XEPALLET?.id })
  const t1 = await api('/tms/freight/tariffs', 'POST', { from_warehouse_id: WH, transport_company_id: DA.id, vehicle_model_id: vmId, ward_code: W1, price: PRICE_DA, distance_km: 15 })
  const t2 = await api('/tms/freight/tariffs', 'POST', { from_warehouse_id: WH, transport_company_id: HA.id, vehicle_model_id: vmId, ward_code: W2, price: PRICE_HA, distance_km: 30 })
  check('0. Fixture: dòng xe con QA61 + cước DA@W1 + HA@W2 → 201', cr.s === 201 && !!vmId && t1.s === 201 && t2.s === 201, `vm=${cr.s} t1=${t1.s} t2=${t2.s} ${t1.j?.error?.message ?? ''}`)
  for (let i = 0; i < 3; i++) {
    const ward = i < 2 ? W1 : W2
    await restWrite('Customer', 'POST', null, { id: crypto.randomUUID(), ship_to_code: SHIP[i], name: `QA61 NPP ${i + 1}`, ward_code: ward, region_code: REGION, is_active: true, auto_created: true, updated_at: nowIso() })
    await restWrite('erp_outbound_orders', 'POST', null, {
      id: crypto.randomUUID(), od_number: OD[i], od_item: '10', material_code: FIX.MAT_POOL, qty_base: PAL[i] * perPallet,
      ship_to_code: SHIP[i], ship_to_name: `QA61 NPP ${i + 1}`, ward_code: ward, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY, flow: 'SALE',
      source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
    })
  }
  const hf = await api(`/tms/transport-companies/${HA.id}`, 'PUT', { tender_required: true })
  check('0b. PUT ĐVVT HA tender_required=true → 200 và cột đổi; DA giữ false', hf.s === 200 && hf.j?.data?.tender_required === true, `http=${hf.s} ${hf.j?.error?.message ?? ''}`)
  const hfBad = await api(`/tms/transport-companies/${HA.id}`, 'PUT', { tender_required: 'yes' })
  check('0c. tender_required không phải boolean → 400', hfBad.s === 400, `http=${hfBad.s}`)

  // ── [1] Lập kế hoạch ──
  const bad = await api('/tms/dispatch/plan', 'POST', { warehouse_id: WH, plan_date: '2027-13-40' })
  check('1a. plan_date không có thật → 400 (zod tại biên)', bad.s === 400, `http=${bad.s}`)
  // id rác trên :id (FE ghép /${id} khi state chưa có) → 400, KHÔNG 500: bậc fast 24/09 bắt GET plans/undefined + PATCH trips/undefined ra 500 vì controller ném new Error(message) làm mất mã 22P02
  const g0 = await api('/tms/dispatch/plans/undefined'), p0 = await api('/tms/dispatch/trips/undefined', 'PATCH', { transport_company_id: null }), s0 = await api('/tms/dispatch/trips/undefined/settle', 'POST', {}), r0x = await api('/tms/dispatch/trips/undefined/respond', 'POST', { accept: true }), d0 = await api('/tms/dispatch/plans/undefined', 'DELETE')
  check('1a2. id rác "undefined" trên 5 route :id → 400 (lỗi Postgres = lỗi đầu vào), không 5xx', [g0, p0, s0, r0x, d0].every(r => r.s === 400), `get=${g0.s} patch=${p0.s} settle=${s0.s} respond=${r0x.s} del=${d0.s}`)
  const p1 = await api('/tms/dispatch/plan', 'POST', { warehouse_id: WH, plan_date: DAY })
  const plan = p1.j?.data
  const trips = plan?.trips ?? []
  const x1 = tripOfOd(plan, OD[0]), x2 = tripOfOd(plan, OD[2])
  check('1b. POST /dispatch/plan → 201, DRAFT, 2 xe: OD1+OD2 (cùng phường W1) một xe · OD3 (W2) xe khác — gộp vào xe 1 thì 10 > 9 pallet',
    p1.s === 201 && plan?.status === 'DRAFT' && trips.length === 2 && !!x1 && x1 === tripOfOd(plan, OD[1]) && !!x2 && x2 !== x1,
    `http=${p1.s} trips=${trips.length} ${p1.j?.error?.message ?? ''} unplanned=${JSON.stringify(plan?.unplanned ?? [])}`)
  check('1c. Xe 1: dòng xe QA61 · ĐVVT DA (chỉ DA có cước W1) · 7 pallet · 2 điểm giao · tải 77,8 % không Non tải',
    x1?.detail?.vehicle_model?.sap_code === SAP && x1?.detail?.carrier?.code === 'DA' && Number(x1?.pallets) === 7 && x1?.stops === 2 && Number(x1?.load_pct) === 77.8 && x1?.underload === false,
    `vm=${x1?.detail?.vehicle_model?.sap_code} co=${x1?.detail?.carrier?.code} pal=${x1?.pallets} stops=${x1?.stops} load=${x1?.load_pct}`)
  check(`1d. Oracle cước xe 1 = ${PRICE_DA.toLocaleString('vi-VN')} × ceil(7) + phụ phí đang có của DA (nếu có)`,
    Number(x1?.detail?.freight?.base) === PRICE_DA * 7 && Number(x1?.freight_estimated) === PRICE_DA * 7 + sur(x1) && x1?.detail?.freight?.ward === W1,
    `base=${x1?.detail?.freight?.base} total=${x1?.freight_estimated} sur=${sur(x1)} ward=${x1?.detail?.freight?.ward}`)
  check('1e. Xe 2: ĐVVT HA · 3 pallet · Non tải 33,3 % · merge_hint nói máy không gộp được; cước HA = 250.000 × 3',
    x2?.detail?.carrier?.code === 'HA' && Number(x2?.pallets) === 3 && x2?.underload === true && /Non tải/.test(x2?.detail?.merge_hint ?? '') && Number(x2?.detail?.freight?.base) === PRICE_HA * 3,
    `co=${x2?.detail?.carrier?.code} pal=${x2?.pallets} under=${x2?.underload} hint=${x2?.detail?.merge_hint?.slice(0, 60)} base=${x2?.detail?.freight?.base}`)
  check(`1f. Số xe theo quy ước ${PREFIX}<stt>, hai xe STT liền nhau, mọi xe status DRAFT`,
    trips.every(t => t.group_code.startsWith(PREFIX) && t.status === 'DRAFT') && Math.abs(Number(trips[0].group_code.slice(PREFIX.length)) - Number(trips[1].group_code.slice(PREFIX.length))) === 1,
    trips.map(t => `${t.group_code}:${t.status}`).join(' '))
  check('1g. summary: 2 chuyến · 3 OD · 10 pallet · Σ cước = cước xe 1 + xe 2 · shares có DA và HA mỗi bên 1 chuyến',
    plan?.summary?.trips === 2 && plan?.summary?.ods === 3 && Number(plan?.summary?.pallets) === 10 && Number(plan?.summary?.freight_total) === Number(x1?.freight_estimated) + Number(x2?.freight_estimated)
    && (plan?.summary?.shares ?? []).filter(s => ['DA', 'HA'].includes(s.code) && s.trips >= 1).length === 2,
    `sum=${JSON.stringify({ t: plan?.summary?.trips, o: plan?.summary?.ods, p: plan?.summary?.pallets, f: plan?.summary?.freight_total })}`)
  const lst = await api(`/tms/dispatch/plans?warehouse_id=${WH}&date_from=${DAY}&date_to=${DAY}`)
  check('1h. GET /dispatch/plans lọc kho + ngày: đúng 1 kế hoạch DRAFT kèm tên kho', lst.s === 200 && (lst.j?.data?.items ?? []).filter(p => p.status === 'DRAFT').length === 1 && !!lst.j?.data?.items?.[0]?.warehouse?.name, `http=${lst.s} n=${lst.j?.data?.items?.length}`)
  const p1b = await api('/tms/dispatch/plan', 'POST', { warehouse_id: WH, plan_date: DAY })
  const lst2 = await api(`/tms/dispatch/plans?warehouse_id=${WH}&date_from=${DAY}&date_to=${DAY}&status=DRAFT`)
  check('1i. Lập lại → nháp cũ bị THAY (vẫn đúng 1 DRAFT, id mới)', p1b.s === 201 && p1b.j?.data?.id !== plan?.id && (lst2.j?.data?.items ?? []).length === 1 && lst2.j?.data?.items?.[0]?.id === p1b.j?.data?.id, `http=${p1b.s} n=${lst2.j?.data?.items?.length}`)
  let P = p1b.j?.data
  let T1 = tripOfOd(P, OD[0]), T2 = tripOfOd(P, OD[2])

  // ── [2] Người sửa nháp ──
  const sw = await api(`/tms/dispatch/trips/${T1.id}`, 'PATCH', { transport_company_id: HA.id })
  check('2a. PATCH xe 1 sang HA (không có cước W1) → 200, cước NULL kèm lý do "Chưa có bảng cước", manual_edited', sw.s === 200 && sw.j?.data?.freight_estimated === null && /Chưa có bảng cước/.test(sw.j?.data?.detail?.freight?.reason ?? '') && sw.j?.data?.manual_edited === true,
    `http=${sw.s} f=${sw.j?.data?.freight_estimated} reason=${sw.j?.data?.detail?.freight?.reason?.slice(0, 50)}`)
  const sw2 = await api(`/tms/dispatch/trips/${T1.id}`, 'PATCH', { transport_company_id: DA.id })
  check('2b. PATCH về DA → cước quay lại đúng oracle', sw2.s === 200 && Number(sw2.j?.data?.detail?.freight?.base) === PRICE_DA * 7, `http=${sw2.s} base=${sw2.j?.data?.detail?.freight?.base}`)
  const swBad = await api(`/tms/dispatch/trips/${T1.id}`, 'PATCH', { vehicle_model_id: 'khong-co-that' })
  check('2c. PATCH dòng xe rác → 400 VEHICLE_MODEL_INVALID', swBad.s === 400 && swBad.j?.error?.code === 'VEHICLE_MODEL_INVALID', `http=${swBad.s} code=${swBad.j?.error?.code}`)
  const mv = await api(`/tms/dispatch/trips/${T1.id}/move-od`, 'POST', { od_number: OD[1] })
  P = mv.j?.data
  const T1b = tripOfOd(P, OD[0]), Tnew = tripOfOd(P, OD[1])
  check('2d. Tách OD2 ra xe MỚI → 3 xe; xe 1 còn 4 pallet cước 200.000 × 4; xe mới kế thừa DA, 3 pallet, STT kế tiếp',
    mv.s === 200 && (P?.trips ?? []).length === 3 && Number(T1b?.pallets) === 4 && Number(T1b?.detail?.freight?.base) === PRICE_DA * 4 && Tnew && Tnew.id !== T1b.id && Tnew.detail?.carrier?.code === 'DA' && Number(Tnew.pallets) === 3 && Tnew.status === 'DRAFT',
    `http=${mv.s} trips=${P?.trips?.length} x1=${T1b?.pallets}/${T1b?.detail?.freight?.base} new=${Tnew?.pallets}/${Tnew?.detail?.carrier?.code}`)
  const mvBack = await api(`/tms/dispatch/trips/${Tnew.id}/move-od`, 'POST', { od_number: OD[1], to_trip_id: T1b.id })
  P = mvBack.j?.data
  check('2e. Chuyển OD2 về xe 1 → xe mới (hết OD) tự xoá, còn 2 xe, xe 1 lại 7 pallet', mvBack.s === 200 && (P?.trips ?? []).length === 2 && Number(tripOfOd(P, OD[0])?.pallets) === 7, `http=${mvBack.s} trips=${P?.trips?.length}`)
  const mv404 = await api(`/tms/dispatch/trips/${T1b.id}/move-od`, 'POST', { od_number: 'KHONGCO' })
  check('2f. move-od OD không nằm trong xe → 404', mv404.s === 404, `http=${mv404.s}`)
  T1 = tripOfOd(P, OD[0]); T2 = tripOfOd(P, OD[2])

  // ── [3] Xác nhận: DA không cần phản hồi ⇒ vào Kế hoạch xuất ngay · HA cần ⇒ CHỜ ──
  const cf = await api(`/tms/dispatch/plans/${P.id}/confirm`, 'POST', {})
  const kh1 = await restAll('khvc_lines', `select=do_no,dvvt,veh_type,vehicle_model_id,source,booking_category&group_code=eq.${T1.group_code}`)
  const kh2 = await restAll('khvc_lines', `select=do_no&group_code=eq.${T2.group_code}`)
  const gdo1 = (await restAll('GroupDeliveryOrder', `select=id,status,vehicle_model_id,dvvt,delivery_date&group_code=eq.${T1.group_code}`))[0]
  check('3a. Confirm → 200: 1 xe vào Kế hoạch xuất (DA) · 1 xe chờ (HA) · kế hoạch TENDERED · tendered_group_codes nêu Số xe HA',
    cf.s === 200 && cf.j?.data?.trips === 1 && cf.j?.data?.tendered === 1 && cf.j?.data?.status === 'TENDERED' && cf.j?.data?.tendered_group_codes?.[0] === T2.group_code,
    `http=${cf.s} ${JSON.stringify(cf.j?.data ?? cf.j?.error)}`)
  check('3b. khvc_lines xe 1: 2 dòng (OD1, OD2) · dvvt "Đông Á" · veh_type = tên cha · vehicle_model_id · source DISPATCH · booking_category; xe 2 KHÔNG có dòng nào',
    kh1.length === 2 && kh1.every(k => k.dvvt === DA.name && k.veh_type === XEPALLET?.name && k.vehicle_model_id === vmId && k.source === 'DISPATCH' && !!k.booking_category) && kh2.length === 0,
    `kh1=${kh1.length} kh2=${kh2.length} ${JSON.stringify(kh1[0] ?? null)}`)
  check('3c. Chuyến bên Xuất kho sinh cho xe 1 (dội từ Kế hoạch xuất) mang vehicle_model_id + ĐVVT + ngày giao', !!gdo1 && gdo1.vehicle_model_id === vmId && gdo1.dvvt === DA.name && gdo1.delivery_date === DAY, `gdo=${JSON.stringify(gdo1 ?? null)} replan_err=${cf.j?.data?.replan_error ?? ''}`)
  P = await planOf(P.id); T1 = tripOfOd(P, OD[0]); T2 = tripOfOd(P, OD[2])
  check('3d. GET plan: xe 1 CONFIRMED có confirmed_at · xe 2 TENDERED có tendered_at · summary tendered 1 / confirmed 1',
    P?.status === 'TENDERED' && T1?.status === 'CONFIRMED' && !!T1?.confirmed_at && T2?.status === 'TENDERED' && !!T2?.tendered_at && P?.summary?.tendered === 1 && P?.summary?.confirmed === 1,
    `plan=${P?.status} t1=${T1?.status} t2=${T2?.status} sum=${JSON.stringify({ te: P?.summary?.tendered, co: P?.summary?.confirmed })}`)
  const cf2 = await api(`/tms/dispatch/plans/${P.id}/confirm`, 'POST', {})
  check('3e. Confirm lần hai → 409 PLAN_NOT_DRAFT', cf2.s === 409 && cf2.j?.error?.code === 'PLAN_NOT_DRAFT', `http=${cf2.s} code=${cf2.j?.error?.code}`)
  const e1 = await api(`/tms/dispatch/trips/${T2.id}`, 'PATCH', { transport_company_id: DA.id })
  const e2 = await api(`/tms/dispatch/trips/${T1.id}`, 'PATCH', { transport_company_id: HA.id })
  const e3 = await api(`/tms/dispatch/trips/${T2.id}/move-od`, 'POST', { od_number: OD[2], to_trip_id: T1.id })
  check('3f. Xe CHỜ và xe ĐÃ VÀO KH xuất không sửa được: PATCH → 409 TRIP_NOT_EDITABLE ×2, move-od vào xe đã chốt → 409',
    e1.s === 409 && e1.j?.error?.code === 'TRIP_NOT_EDITABLE' && e2.s === 409 && e2.j?.error?.code === 'TRIP_NOT_EDITABLE' && e3.s === 409,
    `e1=${e1.s}/${e1.j?.error?.code} e2=${e2.s}/${e2.j?.error?.code} e3=${e3.s}/${e3.j?.error?.code}`)
  const again = await api('/tms/dispatch/plan', 'POST', { warehouse_id: WH, plan_date: DAY })
  check('3g. Lập lại khi kế hoạch đang chờ ĐVVT → 409 PLAN_TENDERED_EXISTS (OD xe chờ chưa vào KH xuất, lập lại là xếp trùng)', again.s === 409 && again.j?.error?.code === 'PLAN_TENDERED_EXISTS', `http=${again.s} code=${again.j?.error?.code}`)
  const r0 = await api(`/tms/dispatch/trips/${T1.id}/respond`, 'POST', { accept: true })
  check('3h. respond cho xe KHÔNG chờ → 409 TRIP_NOT_EDITABLE', r0.s === 409 && r0.j?.error?.code === 'TRIP_NOT_EDITABLE', `http=${r0.s} code=${r0.j?.error?.code}`)
  const rBad = await api(`/tms/dispatch/trips/${T2.id}/respond`, 'POST', { accept: 'maybe' })
  check('3i. respond accept không phải boolean → 400', rBad.s === 400, `http=${rBad.s}`)

  // ── ĐVVT từ chối → đổi ĐVVT → chốt lẻ ──
  const dec = await api(`/tms/dispatch/trips/${T2.id}/respond`, 'POST', { accept: false, note: 'QA61 hết xe ngày đó' })
  P = await planOf(P.id); T2 = tripOfOd(P, OD[2])
  check('3j. ĐVVT từ chối (ghi lý do) → xe DECLINED có response_note/response_by/responded_at · kế hoạch vẫn TENDERED · summary declined 1',
    dec.s === 200 && dec.j?.data?.trip_status === 'DECLINED' && T2?.status === 'DECLINED' && T2?.response_note === 'QA61 hết xe ngày đó' && !!T2?.response_by && !!T2?.responded_at && P?.status === 'TENDERED' && P?.summary?.declined === 1,
    `http=${dec.s} st=${T2?.status} note=${T2?.response_note} plan=${P?.status}`)
  const kh2b = await restAll('khvc_lines', `select=do_no&group_code=eq.${T2.group_code}`)
  check('3k. Xe bị từ chối KHÔNG có dòng nào trong Kế hoạch xuất', kh2b.length === 0, `n=${kh2b.length}`)
  const sw3 = await api(`/tms/dispatch/trips/${T2.id}`, 'PATCH', { transport_company_id: DA.id })
  check('3l. Đổi ĐVVT của xe bị từ chối → 200, xe về DRAFT (ghi chú từ chối giữ làm vết), cước null có lý do (DA không có cước W2)',
    sw3.s === 200 && sw3.j?.data?.status === 'DRAFT' && sw3.j?.data?.response_note === 'QA61 hết xe ngày đó' && sw3.j?.data?.freight_estimated === null,
    `http=${sw3.s} st=${sw3.j?.data?.status} f=${sw3.j?.data?.freight_estimated}`)
  const st = await api(`/tms/dispatch/trips/${T2.id}/settle`, 'POST', {})
  const kh2c = await restAll('khvc_lines', `select=do_no,dvvt&group_code=eq.${T2.group_code}`)
  P = await planOf(P.id); T2 = tripOfOd(P, OD[2])
  check('3m. Chốt lẻ xe 2 (DA không cần phản hồi) → CONFIRMED · khvc_lines có OD3 dvvt Đông Á · kế hoạch CONFIRMED có confirmed_at',
    st.s === 200 && st.j?.data?.trip_status === 'CONFIRMED' && st.j?.data?.plan_status === 'CONFIRMED' && kh2c.length === 1 && kh2c[0].dvvt === DA.name && P?.status === 'CONFIRMED' && !!P?.confirmed_at && T2?.status === 'CONFIRMED',
    `http=${st.s} ${JSON.stringify(st.j?.data ?? st.j?.error)} kh=${kh2c.length} plan=${P?.status}`)
  const st2 = await api(`/tms/dispatch/trips/${T2.id}/settle`, 'POST', {})
  check('3n. Chốt lại xe đã chốt → 409 (kế hoạch đã xác nhận)', st2.s === 409, `http=${st2.s} code=${st2.j?.error?.code}`)

  // ── [4] Pool sau khi mọi OD đã vào Kế hoạch xuất ──
  const p3 = await api('/tms/dispatch/plan', 'POST', { warehouse_id: WH, plan_date: DAY })
  check('4a. Lập lại sau khi kế hoạch CONFIRMED → 201, pool trống (in_plan = 3 OD), 0 xe', p3.s === 201 && (p3.j?.data?.trips ?? []).length === 0 && (p3.j?.data?.in_plan ?? []).length === 3, `http=${p3.s} trips=${p3.j?.data?.trips?.length} in_plan=${p3.j?.data?.in_plan?.length}`)
  const dc = await api(`/tms/dispatch/plans/${p3.j?.data?.id}`, 'DELETE')
  check('4b. Bỏ nháp → DISCARDED', dc.s === 200 && dc.j?.data?.status === 'DISCARDED', `http=${dc.s}`)
  const dc2 = await api(`/tms/dispatch/plans/${p3.j?.data?.id}`, 'DELETE')
  check('4c. Bỏ lần hai → 409', dc2.s === 409, `http=${dc2.s}`)

  // ── [5] Tắt cờ HA → Xác nhận là vào thẳng (hành vi mặc định — không phản hồi, muốn đổi thì sửa tay) ──
  await cleanupTrips()
  await api(`/tms/transport-companies/${HA.id}`, 'PUT', { tender_required: false })
  const p5 = await api('/tms/dispatch/plan', 'POST', { warehouse_id: WH, plan_date: DAY })
  const cf5 = await api(`/tms/dispatch/plans/${p5.j?.data?.id}/confirm`, 'POST', {})
  const P5 = await planOf(p5.j?.data?.id)
  check('5a. Cờ HA tắt: Confirm → 2 xe vào Kế hoạch xuất ngay, 0 xe chờ, kế hoạch CONFIRMED (điều vận muốn đổi thì sửa tay ở Kế hoạch xuất)',
    cf5.s === 200 && cf5.j?.data?.trips === 2 && cf5.j?.data?.tendered === 0 && cf5.j?.data?.status === 'CONFIRMED' && P5?.status === 'CONFIRMED' && (P5?.trips ?? []).every(t => t.status === 'CONFIRMED'),
    `http=${cf5.s} ${JSON.stringify(cf5.j?.data ?? cf5.j?.error)}`)
  const kh5 = await restAll('khvc_lines', `select=do_no&group_code=like.${PREFIX}*`)
  check('5b. Kế hoạch xuất có đủ 3 dòng OD của hai xe', kh5.length === 3, `n=${kh5.length}`)
} finally {
  await cleanup()
  const left = (await restAll('dispatch_plan', `select=id&warehouse_id=eq.${WH}&plan_date=eq.${DAY}`)).length
    + (await restAll('khvc_lines', `select=id&group_code=like.${PREFIX}*`)).length
    + (await restAll('erp_outbound_orders', `select=id&od_number=like.QA61*`)).length
    + (await restAll('vehicle_model', `select=id&sap_code=like.QA61*`)).length
  const ha = (await restAll('TransportCompany', `select=tender_required&id=eq.${HA.id}`))[0]
  check('9. Dọn sạch fixture QA61 + trả cờ HA về giá trị ban đầu', left === 0 && ha?.tender_required === HA_FLAG0, `còn ${left} · HA=${ha?.tender_required} (gốc ${HA_FLAG0})`)
}
finish(PACK)
