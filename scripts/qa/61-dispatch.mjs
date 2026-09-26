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
// Khách fixture đi PALLET (xe QA là xe pallet) và cho tới 3 khách / xe pallet — để các kịch bản ghép OD1+OD2 cùng xe giữ nguyên;
// luật mặc định 1 khách / xe pallet được kiểm riêng ở [11] (user chốt 25/09).

await login(); await resolveFixtures()
const WH = FIX.WH_QR.id
const PREFIX = `${FIX.WH_QR.code}_X_160327_`
const PLAN_BODY = { warehouse_id: WH, plan_date: DAY, pallet_max_stops: 3 }
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
// [7] Điều kiện bảo quản (24/09): mã QA riêng nên KHÔNG dòng xe thật nào phục vụ ⇒ đo được cả hai chiều
// (khai cho xe QA ⇒ chọn được; gỡ ⇒ không xe nào phục vụ). Loại kho của mã fixture là DỮ LIỆU DÙNG CHUNG
// trên staging nên meta gốc phải được ghi nhớ và trả lại trong cleanup — cleanup chạy cả ở ĐẦU gói.
const COND = 'QA61C'
const MAT_CAT = FIX.MAT_POOL_CAT
let catRow = null, CAT_META0 = null
if (MAT_CAT) {
  catRow = (await restAll('LookupValue', `select=id,value,meta&type=eq.warehouse_type&value=eq.${encodeURIComponent(MAT_CAT)}`))[0] ?? null
  CAT_META0 = catRow ? { ...(catRow.meta ?? {}) } : null
}

// [12] (26/09) Luật 9 + kiểu đi theo Loại kho + ĐK theo vị trí: cần một mã hàng thứ HAI thuộc Loại kho KHÁC (có quy cách
// pallet), một pallet tồn thật ở kho fixture (ô sẽ khai ĐK riêng) — meta Loại kho 2, cờ kho và ĐK của ô đều là dữ liệu dùng
// chung nên ghi nhớ gốc và trả lại trong cleanup (chạy cả ở ĐẦU gói).
const COND_LOC = 'QA61L'
const mat2 = (await restAll('Material', `select=material_code,category,units_per_carton,cartons_per_pallet&category=neq.${encodeURIComponent(MAT_CAT ?? '')}&category=not.is.null&units_per_carton=gt.0&cartons_per_pallet=gt.0&order=material_code&limit=1`))[0] ?? null
const CAT2 = mat2?.category ?? null
const cat2Row = CAT2 ? (await restAll('LookupValue', `select=id,value,meta&type=eq.warehouse_type&value=eq.${encodeURIComponent(CAT2)}`))[0] ?? null : null
const CAT2_META0 = cat2Row ? { ...(cat2Row.meta ?? {}) } : null
const WH_MIX0 = (await restAll('Warehouse', `select=dispatch_allow_mix_categories&id=eq.${WH}`))[0]?.dispatch_allow_mix_categories === true
const ieLoc = (await restAll('InventoryEntry', `select=location_id,material_id,material:Material(category),loc:Location(categories)&warehouse_id=eq.${WH}&cartons_remaining=gt.0&location_id=not.is.null&status=in.(IN_STOCK,PARTIAL)&limit=200`))
  .find(x => !(x.loc?.categories ?? []).length || (x.loc.categories).includes(x.material?.category)) ?? null   // ô lạnh chỉ áp cho hàng THUỘC Loại kho của ô (20260926c)
const locRow = ieLoc ? (await restAll('Location', `select=id,storage_condition&id=eq.${ieLoc.location_id}`))[0] ?? null : null
const LOC_COND0 = locRow?.storage_condition ?? null
const ieStray = (await restAll('InventoryEntry', `select=location_id,material_id,material:Material(material_code,category,units_per_carton),loc:Location(categories)&warehouse_id=eq.${WH}&cartons_remaining=gt.0&location_id=not.is.null&status=in.(IN_STOCK,PARTIAL)&limit=500`))
  .find(x => (x.loc?.categories ?? []).length && x.material?.category && !x.loc.categories.includes(x.material.category) && x.location_id !== ieLoc?.location_id) ?? null
const STRAY_COND0 = ieStray ? ((await restAll('Location', `select=storage_condition&id=eq.${ieStray.location_id}`))[0]?.storage_condition ?? null) : null

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
  // Trả Loại kho về meta GỐC trước tiên: để sót `storage_condition` của QA thì mọi kế hoạch điều vận sau đó
  // không tìm được dòng xe nào phục vụ — hỏng cho cả phiên khác đang dùng staging.
  if (catRow && CAT_META0) await restWrite('LookupValue', 'PATCH', `id=eq.${catRow.id}`, { meta: CAT_META0 }).catch(() => {})
  if (cat2Row && CAT2_META0) await restWrite('LookupValue', 'PATCH', `id=eq.${cat2Row.id}`, { meta: CAT2_META0 }).catch(() => {})
  await restWrite('Warehouse', 'PATCH', `id=eq.${WH}`, { dispatch_allow_mix_categories: WH_MIX0 }).catch(() => {})
  if (locRow) await restWrite('Location', 'PATCH', `id=eq.${locRow.id}`, { storage_condition: LOC_COND0 }).catch(() => {})
  if (ieStray) await restWrite('Location', 'PATCH', `id=eq.${ieStray.location_id}`, { storage_condition: STRAY_COND0 }).catch(() => {})
  await restWrite('LookupValue', 'DELETE', `type=eq.storage_condition&value=eq.${COND}`).catch(() => {})
  await restWrite('LookupValue', 'DELETE', `type=eq.storage_condition&value=eq.${COND_LOC}`).catch(() => {})
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
    await restWrite('Customer', 'POST', null, { id: crypto.randomUUID(), ship_to_code: SHIP[i], name: `QA61 NPP ${i + 1}`, ward_code: ward, region_code: REGION, is_active: true, auto_created: true, load_mode: 'PALLET', updated_at: nowIso() })
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
  const p1 = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
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
  const p1b = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
  const lst2 = await api(`/tms/dispatch/plans?warehouse_id=${WH}&date_from=${DAY}&date_to=${DAY}&status=DRAFT`)
  check('1i. Lập lại → nháp cũ bị THAY (vẫn đúng 1 DRAFT, id mới)', p1b.s === 201 && p1b.j?.data?.id !== plan?.id && (lst2.j?.data?.items ?? []).length === 1 && lst2.j?.data?.items?.[0]?.id === p1b.j?.data?.id, `http=${p1b.s} n=${lst2.j?.data?.items?.length}`)
  let P = p1b.j?.data
  let T1 = tripOfOd(P, OD[0]), T2 = tripOfOd(P, OD[2])

  // [1r] Đổi ĐVVT ngay trên thẻ xe (user 25/09 "có tiền trong đó, xếp theo rank"): số tiền trong danh sách = số xe nhận.
  // ⚠ Hỏi xe của nháp HIỆN HÀNH (T1) — nháp của `x1` đã bị "Lập lại" ở 1i thay mất (lượt đầu viết nhầm x1 ⇒ 404 đúng luật)
  const rk = await api(`/tms/dispatch/trips/${T1?.id}/carriers`)
  const its = rk.j?.data?.items ?? []
  const rk0 = await api('/tms/dispatch/trips/undefined/carriers')
  check('1r. GET trips/:id/carriers → DA đứng ĐẦU (có cước W1), cước = đúng cước xe đang mang, cờ current; HA không có cước W1 xếp sau có lý do; id rác → 400',
    rk.s === 200 && its[0]?.code === 'DA' && its[0]?.current === true && Number(its[0]?.freight) === Number(T1?.freight_estimated)
    && its.some(i => i.code === 'HA' && i.freight == null && !!i.reason) && its.findIndex(i => i.code === 'HA') > 0 && rk0.s === 400,
    `http=${rk.s} ${rk.j?.error?.message ?? ''} items=${its.map(i => `${i.code}:${i.freight ?? '∅'}${i.current ? '*' : ''}`).join(' ')} xe=${T1?.freight_estimated} rác=${rk0.s}`)

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
  const again = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
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
  const p3 = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
  check('4a. Lập lại sau khi kế hoạch CONFIRMED → 201, pool trống (in_plan = 3 OD), 0 xe', p3.s === 201 && (p3.j?.data?.trips ?? []).length === 0 && (p3.j?.data?.in_plan ?? []).length === 3, `http=${p3.s} trips=${p3.j?.data?.trips?.length} in_plan=${p3.j?.data?.in_plan?.length}`)
  const dc = await api(`/tms/dispatch/plans/${p3.j?.data?.id}`, 'DELETE')
  check('4b. Bỏ nháp → DISCARDED', dc.s === 200 && dc.j?.data?.status === 'DISCARDED', `http=${dc.s}`)
  const dc2 = await api(`/tms/dispatch/plans/${p3.j?.data?.id}`, 'DELETE')
  check('4c. Bỏ lần hai → 409', dc2.s === 409, `http=${dc2.s}`)

  // ── [7] ĐIỀU KIỆN BẢO QUẢN (user chốt 24/09: lạnh âm · 2–8 · 15–25 · thường) ──
  // Hàng lấy điều kiện theo LOẠI KHO (Cài đặt WMS), xe khai chở được mức nào (Cài đặt TMS) → engine khớp hai bên.
  {
    const mk = await api('/wms/lookup', 'POST', { type: 'storage_condition', value: COND, meta: { label: 'QA61 2 – 8 °C', temp_min: 2, temp_max: 8, badge_color: 'sky' } })
    const saved = (await restAll('LookupValue', `select=meta&type=eq.storage_condition&value=eq.${COND}`))[0]
    check('7a. Thêm điều kiện bảo quản → 200 và meta GIỮ NGUYÊN nhãn + dải nhiệt (bộ lọc meta của LookupValue vứt khoá lạ nếu quên khai)',
      mk.s === 200 && saved?.meta?.label === 'QA61 2 – 8 °C' && Number(saved?.meta?.temp_min) === 2 && Number(saved?.meta?.temp_max) === 8,
      `http=${mk.s} meta=${JSON.stringify(saved?.meta ?? null)}`)

    const badC = await api('/tms/vehicle-models/assign-conditions', 'PATCH', { ids: [vmId], storage_conditions: ['KHONG_CO_THAT'] })
    check('7b. Khai điều kiện KHÔNG có trong danh mục → 400 STORAGE_CONDITION_INVALID (không để mã mồ côi làm engine loại xe âm thầm)',
      badC.s === 400 && badC.j?.error?.code === 'STORAGE_CONDITION_INVALID', `http=${badC.s} code=${badC.j?.error?.code}`)

    const before = (await api('/tms/vehicle-models')).j?.data?.unconditioned
    const okC = await api('/tms/vehicle-models/assign-conditions', 'PATCH', { ids: [vmId], storage_conditions: [COND] })
    const listVm = await api('/tms/vehicle-models')
    const mine = (listVm.j?.data?.items ?? []).find(m => m.id === vmId)
    check('7c. Khai hàng loạt → updated 1 · dòng xe mang đúng mã · ô đếm "chưa khai" giảm 1',
      okC.s === 200 && okC.j?.data?.updated === 1 && JSON.stringify(mine?.storage_conditions) === JSON.stringify([COND]) && listVm.j?.data?.unconditioned === before - 1,
      `http=${okC.s} conds=${JSON.stringify(mine?.storage_conditions)} unconditioned ${before}→${listVm.j?.data?.unconditioned}`)

    if (catRow) {
      // Loại kho của mã fixture khai điều kiện ⇒ hàng "đòi" mức đó; chỉ dòng xe QA phục vụ nên nó phải được chọn
      const setCat = await api(`/wms/lookup/${catRow.id}`, 'PUT', { value: catRow.value, meta: { ...CAT_META0, storage_condition: COND } })
      const catNow = (await restAll('LookupValue', `select=meta&id=eq.${catRow.id}`))[0]
      check('7d. Loại kho khai điều kiện bảo quản → 200 và meta giữ CẢ cờ cũ lẫn khoá mới (không đè mất cấu hình đang chạy)',
        setCat.s === 200 && catNow?.meta?.storage_condition === COND && catNow?.meta?.badge_color === CAT_META0.badge_color,
        `http=${setCat.s} meta=${JSON.stringify(catNow?.meta ?? null)}`)

      await cleanupTrips()
      const pc = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
      const tr = (pc.j?.data?.trips ?? [])
      check('7e. Lập kế hoạch: mọi xe đều là dòng xe PHỤC VỤ được mức đó, và chuyến mang điều kiện của hàng',
        pc.s === 201 && tr.length > 0 && tr.every(t => t.vehicle_model_id === vmId) && tr.every(t => JSON.stringify(t.detail?.conditions) === JSON.stringify([COND])),
        `http=${pc.s} trips=${tr.length} vm=${[...new Set(tr.map(t => t.detail?.vehicle_model?.sap_code))].join(',')} conds=${JSON.stringify(tr[0]?.detail?.conditions)}`)

      // Gỡ khai khỏi dòng xe QA ⇒ KHÔNG dòng xe nào phục vụ mức QA ⇒ phải nói thẳng thiếu mức nào, không im lặng
      await api('/tms/vehicle-models/assign-conditions', 'PATCH', { ids: [vmId], storage_conditions: ['AMBIENT'] })
      await cleanupTrips()
      const pn = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
      const tn = (pn.j?.data?.trips ?? [])
      check('7f. Không dòng xe nào phục vụ mức hàng đòi → chuyến KHÔNG có dòng xe, cảnh báo gọi đúng TÊN mức + chỉ chỗ khai',
        pn.s === 201 && tn.length > 0 && tn.every(t => !t.vehicle_model_id) && /QA61 2 – 8 °C/.test(tn[0]?.detail?.warnings?.join(' ') ?? '') && /Mã dòng xe/.test(tn[0]?.detail?.warnings?.join(' ') ?? ''),
        `http=${pn.s} trips=${tn.length} vm=${tn[0]?.vehicle_model_id} warn=${(tn[0]?.detail?.warnings ?? []).join(' | ').slice(0, 120)}`)
      await cleanupTrips()

      const condRow = (await restAll('LookupValue', `select=id&type=eq.storage_condition&value=eq.${COND}`))[0]
      const delUsed = await api(`/wms/lookup/${condRow.id}`, 'DELETE')
      check('7g. Xoá điều kiện đang được Loại kho dùng → 409 nêu rõ nơi đang dùng (không để lại mã mồ côi)',
        delUsed.s === 409 && /Loại kho/.test(delUsed.j?.error?.message ?? ''), `http=${delUsed.s} msg=${delUsed.j?.error?.message?.slice(0, 90)}`)
      await api(`/wms/lookup/${catRow.id}`, 'PUT', { value: catRow.value, meta: { ...CAT_META0, storage_condition: null } })
      await api('/tms/vehicle-models/assign-conditions', 'PATCH', { ids: [vmId], storage_conditions: [] })
      const delFree = await api(`/wms/lookup/${condRow.id}`, 'DELETE')
      check('7h. Gỡ khai hai bên rồi xoá → 200', delFree.s === 200, `http=${delFree.s} ${delFree.j?.error?.message ?? ''}`)
    }
  }

  // ── [5] Tắt cờ HA → Xác nhận là vào thẳng (hành vi mặc định — không phản hồi, muốn đổi thì sửa tay) ──
  await cleanupTrips()
  await api(`/tms/transport-companies/${HA.id}`, 'PUT', { tender_required: false })
  const p5 = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
  const cf5 = await api(`/tms/dispatch/plans/${p5.j?.data?.id}/confirm`, 'POST', {})
  const P5 = await planOf(p5.j?.data?.id)
  check('5a. Cờ HA tắt: Confirm → 2 xe vào Kế hoạch xuất ngay, 0 xe chờ, kế hoạch CONFIRMED (điều vận muốn đổi thì sửa tay ở Kế hoạch xuất)',
    cf5.s === 200 && cf5.j?.data?.trips === 2 && cf5.j?.data?.tendered === 0 && cf5.j?.data?.status === 'CONFIRMED' && P5?.status === 'CONFIRMED' && (P5?.trips ?? []).every(t => t.status === 'CONFIRMED'),
    `http=${cf5.s} ${JSON.stringify(cf5.j?.data ?? cf5.j?.error)}`)
  const kh5 = await restAll('khvc_lines', `select=do_no&group_code=like.${PREFIX}*`)
  check('5b. Kế hoạch xuất có đủ 3 dòng OD của hai xe', kh5.length === 3, `n=${kh5.length}`)

  // ── [8] MÃ HÀNG LẠ: chặn TRƯỚC khi ghi, không "thành công" rồi 0 chuyến (kiểm app 24/09) ──────────
  // VÌ SAO: 5 % dòng OD của SAP trỏ mã chưa đồng bộ sang WMS (đo staging: 4 mã ⇒ 47 OD Ba Vì + 19 OD
  // Bàu Bàng). Đường `replanKhvcGroups` → derive validate mã hàng rồi từ chối TRỌN GÓI, nhưng nó
  // KHÔNG ném lỗi — nó trả `{derive:{success:false}}` mà trước 24/09 không ai đọc ⇒ API trả 200,
  // màn hình in "Chuyến bên Xuất kho + lệnh VC đã sinh", thực tế 0/50 chuyến. Lớp C5 "trả 200 im lặng".
  await cleanupTrips()
  await restWrite('khvc_lines', 'DELETE', `group_code=like.${PREFIX}*`).catch(() => {})
  const OD4 = 'QA61OD4', MAT_LA = 'QA61MAKHONGCO'
  await restWrite('Customer', 'POST', null, { id: crypto.randomUUID(), ship_to_code: 'QA61SHIP4', name: 'QA61 NPP 4', ward_code: W1, region_code: REGION, is_active: true, auto_created: true, load_mode: 'PALLET', updated_at: nowIso() })
  await restWrite('erp_outbound_orders', 'POST', null, {
    id: crypto.randomUUID(), od_number: OD4, od_item: '10', material_code: MAT_LA, qty_base: 2 * perPallet,
    ship_to_code: 'QA61SHIP4', ship_to_name: 'QA61 NPP 4', ward_code: W1, region_code: REGION, plant: wh?.sap_plant ?? null,
    delivery_date: DAY, flow: 'SALE', sap_pallets: 2, source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
  })
  const matGone = (await restAll('Material', `select=material_code&material_code=eq.${MAT_LA}`)).length === 0
  check('8a. Fixture: mã hàng của OD4 KHÔNG có trong danh mục Mã hàng', matGone, matGone ? MAT_LA : 'mã lại có thật — đổi tên fixture')
  const p8 = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
  const cf8 = await api(`/tms/dispatch/plans/${p8.j?.data?.id}/confirm`, 'POST', {})
  check('8b. Xác nhận kế hoạch có mã hàng LẠ → 422 MATERIAL_UNKNOWN, KHÔNG phải 200 im lặng',
    cf8.s === 422 && cf8.j?.error?.code === 'MATERIAL_UNKNOWN',
    `http=${cf8.s} code=${cf8.j?.error?.code ?? '-'} ${String(cf8.j?.error?.message ?? '').slice(0, 120)}`)
  check('8c. Thông điệp nêu ĐÍCH DANH mã phải khai (người dùng biết làm gì tiếp)',
    String(cf8.j?.error?.message ?? '').includes(MAT_LA), String(cf8.j?.error?.message ?? '').slice(0, 140))
  const kh8 = await restAll('khvc_lines', `select=do_no&group_code=like.${PREFIX}*`)
  check('8d. Bị chặn thì KHÔNG ghi dòng Kế hoạch xuất nào (không có trạng thái nửa vời)', kh8.length === 0, `n=${kh8.length}`)
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=eq.${OD4}`).catch(() => {})
  await restWrite('Customer', 'DELETE', `ship_to_code=eq.QA61SHIP4`).catch(() => {})

  // ── [10] BÀN GHÉP XE + POOL LŨY TIẾN (user chốt 25/09) ──────────────────────────────────────────────
  // Kéo thả = MỘT cửa `POST /plans/:id/move` (xe · xe mới · khung chờ · bỏ); vượt tải CHO THẢ đánh dấu đỏ; xe trống KHÔNG tự
  // biến mất (Hoàn tác phải thả lại được đúng xe); khoá xe + "Tối ưu lại phần chưa khoá"; OD đã điều / đã đi / bị SAP thay
  // phải tự rời đợt ghép và chặn Xác nhận; OD tồn đọng (ngày giao trước) gộp vào kèm số ngày trễ.
  await cleanupTrips()
  const rowOf = (pl, od) => [...(pl?.trips ?? []).flatMap(t => t.ods), ...(pl?.pool ?? [])].find(o => o.od_number === od)
  const mvB = (pl, body) => api(`/tms/dispatch/plans/${pl.id}/move`, 'POST', body)
  const pb = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
  let B = pb.j?.data
  const r1 = rowOf(B, OD[0])
  check('10a. Kế hoạch mới: khung chờ rỗng · summary có mốc máy lập + số chuyến theo dòng xe · dòng OD mang plan_id + điều kiện + tải theo loại',
    pb.s === 201 && Array.isArray(B?.pool) && B.pool.length === 0 && B?.summary?.baseline?.trips === 2 && (B?.summary?.by_model ?? []).some(m => m.sap_code === SAP && m.trips === 2)
    && r1?.plan_id === B?.id && Array.isArray(r1?.conditions) && r1?.cat_load && typeof r1.cat_load === 'object',
    `http=${pb.s} pool=${B?.pool?.length} base=${JSON.stringify(B?.summary?.baseline)} row=${JSON.stringify({ p: r1?.plan_id === B?.id, c: r1?.conditions, l: r1?.cat_load })}`)
  const mp = await mvB(B, { ids: [rowOf(B, OD[1]).id], to: 'pool' })
  B = mp.j?.data
  check('10b. Kéo OD2 về KHUNG CHỜ → OD2 trip_id null · xe OD1 còn 4 pallet cước 200.000 × 4 · summary pool_ods 1',
    mp.s === 200 && rowOf(B, OD[1])?.trip_id === null && Number(tripOfOd(B, OD[0])?.pallets) === 4 && Number(tripOfOd(B, OD[0])?.detail?.freight?.base) === PRICE_DA * 4 && B?.summary?.pool_ods === 1,
    `http=${mp.s} ${mp.j?.error?.message ?? ''} pool=${B?.summary?.pool_ods} x1=${tripOfOd(B, OD[0])?.pallets}`)
  const X3 = tripOfOd(B, OD[2])
  const pv = await api(`/tms/dispatch/plans/${B.id}/preview-move`, 'POST', { ids: [rowOf(B, OD[1]).id], to_trip_id: X3.id })
  const Bpv = await planOf(B.id)
  check('10c. Xem trước OD2 → xe OD3: 6 pallet · 2 điểm · 66,7 % · có cước — và KHÔNG ghi gì (xe OD3 vẫn 3 pallet)',
    pv.s === 200 && Number(pv.j?.data?.pallets) === 6 && pv.j?.data?.stops === 2 && Number(pv.j?.data?.load_pct) === 66.7 && pv.j?.data?.freight_estimated != null && Number(tripOfOd(Bpv, OD[2])?.pallets) === 3,
    `http=${pv.s} ${JSON.stringify(pv.j?.data ?? pv.j?.error)}`)
  const mn = await mvB(B, { ids: [rowOf(B, OD[1]).id], to: 'new' })
  B = mn.j?.data
  const TN = tripOfOd(B, OD[1])
  check('10d. Thả OD2 vào "Xe mới" → xe STT kế tiếp, MÁY chọn dòng xe QA61 + ĐVVT DA (chỉ DA có cước W1) · cước 200.000 × 3',
    mn.s === 200 && (B?.trips ?? []).length === 3 && TN?.detail?.vehicle_model?.sap_code === SAP && TN?.detail?.carrier?.code === 'DA' && Number(TN?.detail?.freight?.base) === PRICE_DA * 3,
    `http=${mn.s} ${mn.j?.error?.message ?? ''} vm=${TN?.detail?.vehicle_model?.sap_code} co=${TN?.detail?.carrier?.code} base=${TN?.detail?.freight?.base}`)
  const mt = await mvB(B, { ids: [rowOf(B, OD[1]).id], to: 'trip', to_trip_id: tripOfOd(B, OD[0]).id })
  B = mt.j?.data
  const emptyTrip = (B?.trips ?? []).find(t => t.id === TN?.id)
  check('10e. Thả OD2 về xe OD1 → 7 pallet; xe mới còn TRỐNG (không tự xoá — Hoàn tác thả lại đúng xe) và KHÔNG tính vào số chuyến',
    mt.s === 200 && Number(tripOfOd(B, OD[0])?.pallets) === 7 && !!emptyTrip && emptyTrip.ods.length === 0 && B?.summary?.trips === 2 && B?.summary?.empty_trips === 1,
    `http=${mt.s} x1=${tripOfOd(B, OD[0])?.pallets} empty=${emptyTrip?.ods?.length} trips=${B?.summary?.trips} empty_n=${B?.summary?.empty_trips}`)
  const dne = await api(`/tms/dispatch/trips/${tripOfOd(B, OD[0]).id}`, 'DELETE')
  const de = await api(`/tms/dispatch/trips/${TN.id}`, 'DELETE')
  check('10f. Bỏ xe còn OD → 409 TRIP_NOT_EMPTY · bỏ xe trống → 200', dne.s === 409 && dne.j?.error?.code === 'TRIP_NOT_EMPTY' && de.s === 200, `nonempty=${dne.s}/${dne.j?.error?.code} empty=${de.s}`)
  B = await planOf(B.id)
  const mo = await mvB(B, { ids: [rowOf(B, OD[2]).id], to: 'trip', to_trip_id: tripOfOd(B, OD[0]).id })
  B = mo.j?.data
  const TO = tripOfOd(B, OD[0])
  check('10g. Thả làm xe VƯỢT TẢI → CHO THẢ (user chốt): 10/9 pallet 111,1 % · oversize · cảnh báo "Vượt sức chứa" · summary overload 1',
    mo.s === 200 && Number(TO?.pallets) === 10 && Number(TO?.load_pct) === 111.1 && TO?.oversize === true && /Vượt sức chứa/.test((TO?.detail?.warnings ?? []).join(' ')) && B?.summary?.overload === 1,
    `http=${mo.s} pal=${TO?.pallets} load=${TO?.load_pct} over=${TO?.oversize} warn=${(TO?.detail?.warnings ?? []).join('|').slice(0, 80)}`)
  // xe OD3 cũ giờ trống — bỏ đi để "Tối ưu lại" chỉ còn đúng một xe khoá
  for (const t of (B?.trips ?? []).filter(x => !x.ods.length)) await api(`/tms/dispatch/trips/${t.id}`, 'DELETE')
  const lk = await api(`/tms/dispatch/trips/${TO.id}`, 'PATCH', { locked: true })
  const ro = await api(`/tms/dispatch/plans/${B.id}/reoptimize`, 'POST', {})
  check('10h. Khoá xe → "Tối ưu lại" khi mọi OD đều trên xe khoá → 422 NOTHING_TO_OPTIMIZE (xe khoá không bị đụng)',
    lk.s === 200 && lk.j?.data?.locked === true && ro.s === 422 && ro.j?.error?.code === 'NOTHING_TO_OPTIMIZE', `lock=${lk.s} reopt=${ro.s}/${ro.j?.error?.code}`)
  await api(`/tms/dispatch/trips/${TO.id}`, 'PATCH', { locked: false })
  const ro2 = await api(`/tms/dispatch/plans/${B.id}/reoptimize`, 'POST', {})
  B = ro2.j?.data
  check('10i. Mở khoá → Tối ưu lại → máy ghép lại như lần đầu: OD1+OD2 một xe · OD3 xe khác · khung chờ rỗng',
    ro2.s === 200 && (B?.trips ?? []).length === 2 && tripOfOd(B, OD[0])?.id === tripOfOd(B, OD[1])?.id && tripOfOd(B, OD[2])?.id !== tripOfOd(B, OD[0])?.id && (B?.pool ?? []).length === 0,
    `http=${ro2.s} ${ro2.j?.error?.message ?? ''} trips=${B?.trips?.length} pool=${B?.pool?.length}`)
  const rr = await mvB(B, { ids: [rowOf(B, OD[2]).id], to: 'remove' })
  const sy = await api(`/tms/dispatch/plans/${B.id}/sync`)
  check('10j. Bỏ OD3 khỏi kế hoạch → không còn ở xe/khung chờ; /sync báo OD3 là OD MỚI chưa có trong kế hoạch (vẫn chưa điều)',
    rr.s === 200 && !rowOf(rr.j?.data, OD[2]) && sy.s === 200 && (sy.j?.data?.new_od_numbers ?? []).includes(OD[2]),
    `rm=${rr.s} sync=${sy.s} new=${JSON.stringify(sy.j?.data?.new_od_numbers ?? sy.j?.error)}`)
  const rf = await api(`/tms/dispatch/plans/${B.id}/refresh-pool`, 'POST', {})
  B = rf.j?.data
  check('10k. "Nạp OD mới" → OD3 vào KHUNG CHỜ (trip_id null) với 3 pallet', rf.s === 200 && rf.j?.data?.refreshed?.added >= 1 && rowOf(B, OD[2])?.trip_id === null && Number(rowOf(B, OD[2])?.pallets) === 3,
    `http=${rf.s} ${JSON.stringify(rf.j?.data?.refreshed ?? rf.j?.error)}`)
  B = (await mvB(B, { ids: [rowOf(B, OD[2]).id], to: 'new' })).j?.data
  await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[2]}`, { sap_dispatch_status: 'ASSIGNED', dvvt_raw: 'QA61 NHA XE', license_plate: '29C99999', updated_at: nowIso() })
  const sy2 = await api(`/tms/dispatch/plans/${B.id}/sync`)
  const fl3 = (sy2.j?.data?.flags ?? []).find(x => x.od_number === OD[2])
  check('10l. SAP ghi "Đã điều" cho OD3 SAU khi lập → /sync gắn cờ SAP_ASSIGNED nêu ĐVVT + biển số', fl3?.kind === 'SAP_ASSIGNED' && /QA61 NHA XE/.test(fl3?.info ?? '') && /29C99999/.test(fl3?.info ?? ''), `flag=${JSON.stringify(fl3 ?? null)}`)
  const cfb = await api(`/tms/dispatch/plans/${B.id}/confirm`, 'POST', {})
  const khb = await restAll('khvc_lines', `select=id&group_code=like.${PREFIX}*`)
  check('10m. Xác nhận khi còn OD đổi ở SAP → 409 OD_CHANGED_IN_SAP nêu OD, KHÔNG ghi dòng Kế hoạch xuất nào',
    cfb.s === 409 && cfb.j?.error?.code === 'OD_CHANGED_IN_SAP' && String(cfb.j?.error?.message ?? '').includes(OD[2]) && khb.length === 0, `http=${cfb.s} code=${cfb.j?.error?.code} kh=${khb.length}`)
  // SO sửa ⇒ SAP thay OD3 bằng OD5 (cửa nạp ZSD02 ghi OBSOLETE + replaced_by_od — luật thuần có test đơn vị riêng)
  const OD5 = 'QA61OD5'
  await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[2]}`, { sap_dispatch_status: 'UNASSIGNED', sync_status: 'OBSOLETE', replaced_by_od: OD5, replaced_at: nowIso(), updated_at: nowIso() })
  await restWrite('erp_outbound_orders', 'POST', null, {
    id: crypto.randomUUID(), od_number: OD5, od_item: '10', material_code: FIX.MAT_POOL, qty_base: 2 * perPallet,
    ship_to_code: SHIP[2], ship_to_name: 'QA61 NPP 3', ward_code: W2, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY, flow: 'SALE',
    source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
  })
  const sy3 = await api(`/tms/dispatch/plans/${B.id}/sync`)
  const fl3b = (sy3.j?.data?.flags ?? []).find(x => x.od_number === OD[2])
  const tripOf3 = tripOfOd(B, OD[2])?.id
  const rp = await api(`/tms/dispatch/plans/${B.id}/replace-od`, 'POST', { od_number: OD[2] })
  B = rp.j?.data
  check('10n. OD bị SAP thay → cờ REPLACED chỉ OD mới; "Thay bằng OD mới" → OD5 nằm ĐÚNG xe của OD3 với 2 pallet, OD3 rời kế hoạch',
    fl3b?.kind === 'REPLACED' && fl3b?.replaced_by === OD5 && rp.s === 200 && tripOfOd(B, OD5)?.id === tripOf3 && Number(rowOf(B, OD5)?.pallets) === 2 && !rowOf(B, OD[2]),
    `flag=${JSON.stringify(fl3b ?? null)} http=${rp.s} ${rp.j?.error?.message ?? ''} same_trip=${tripOfOd(B, OD5)?.id === tripOf3}`)
  const rpAgain = await api(`/tms/dispatch/plans/${B.id}/replace-od`, 'POST', { od_number: OD[0] })
  const mBad = await mvB(B, { ids: [], to: 'pool' })
  const mBad2 = await api('/tms/dispatch/plans/undefined/move', 'POST', { ids: [crypto.randomUUID()], to: 'pool' })
  const mBad3 = await mvB(B, { ids: [crypto.randomUUID()], to: 'pool' })
  check('10o. Đầu vào sai: thay OD chưa bị thay → 422 NOT_REPLACED · ids rỗng → 400 · id kế hoạch rác → 400 · dòng không thuộc kế hoạch → 404',
    rpAgain.s === 422 && rpAgain.j?.error?.code === 'NOT_REPLACED' && mBad.s === 400 && mBad2.s === 400 && mBad3.s === 404,
    `rp=${rpAgain.s}/${rpAgain.j?.error?.code} empty=${mBad.s} junkplan=${mBad2.s} foreign=${mBad3.s}`)
  // LŨY TIẾN lúc LẬP: OD đã xuất kho tự rời đợt ghép + OD tồn đọng ngày trước gộp vào kèm số ngày trễ
  await cleanupTrips()
  await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[0]}`, { mat_doc: 'QA61MATDOC', updated_at: nowIso() })
  const OD6 = 'QA61OD6', LATE = '2027-03-14'
  await restWrite('erp_outbound_orders', 'POST', null, {
    id: crypto.randomUUID(), od_number: OD6, od_item: '10', material_code: FIX.MAT_POOL, qty_base: perPallet,
    ship_to_code: SHIP[1], ship_to_name: 'QA61 NPP 2', ward_code: W1, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: LATE, flow: 'SALE',
    source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
  })
  // OD TRẢ VỀ đúng ngày: máy đưa vào "không lên xe" — /sync KHÔNG được đếm nó là "OD mới" (Preview 25/09: báo "12 OD mới"
  // ngay sau khi vừa lập, đúng 12 OD RETURN của Ba Vì)
  const OD7 = 'QA61OD7'
  await restWrite('erp_outbound_orders', 'POST', null, {
    id: crypto.randomUUID(), od_number: OD7, od_item: '10', material_code: FIX.MAT_POOL, qty_base: perPallet,
    ship_to_code: SHIP[0], ship_to_name: 'QA61 NPP 1', ward_code: W1, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY, flow: 'RETURN',
    source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
  })
  const pl2 = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
  const P2 = pl2.j?.data
  const sy4 = await api(`/tms/dispatch/plans/${P2?.id}/sync`)
  check('10q. OD trả về (RETURN) nằm ở "không lên xe" và /sync KHÔNG báo nó là OD mới (0 OD mới ngay sau khi lập)',
    (P2?.unplanned ?? []).some(u => u.od_number === OD7) && sy4.s === 200 && !(sy4.j?.data?.new_od_numbers ?? []).includes(OD7) && sy4.j?.data?.new_ods === 0,
    `unplanned=${(P2?.unplanned ?? []).map(u => u.od_number).join(',')} sync=${sy4.s} new=${JSON.stringify(sy4.j?.data?.new_od_numbers ?? sy4.j?.error)}`)
  const ex1 = (P2?.params?.excluded ?? []).find(x => x.od_number === OD[0])
  const r6 = rowOf(P2, OD6)
  check('10p. Lập kế hoạch: OD đã xuất kho KHÔNG lên xe và nằm trong danh sách "đã bỏ ra" (SHIPPED) · OD tồn đọng 14/03 lên xe kèm trễ 2 ngày',
    pl2.s === 201 && !rowOf(P2, OD[0]) && ex1?.kind === 'SHIPPED' && !!r6?.trip_id && r6?.late_days === 2 && r6?.delivery_date === LATE && P2?.summary?.late_ods === 1,
    `http=${pl2.s} ${pl2.j?.error?.message ?? ''} ex=${JSON.stringify(ex1 ?? null)} late=${JSON.stringify({ t: r6?.trip_id != null, d: r6?.late_days, dd: r6?.delivery_date, n: P2?.summary?.late_ods })}`)

  // ── [11] KHÁCH PALLET / XÁ + MỞ LẠI (user chốt 25/09 vòng 2) ─────────────────────────────────────────
  // "Xe pallet bản chất có 1 khách, xá ghép nhiều khách; config số khách · bấm nút trên xe là xe thành xe xá · lưu rồi sửa lại được"
  await cleanupTrips()
  await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[0]}`, { mat_doc: null, updated_at: nowIso() })
  const cust1 = (await restAll('Customer', `select=id&ship_to_code=eq.${SHIP[0]}`))[0]
  const cBad = await api(`/masterdata/customers/${cust1.id}`, 'PUT', { load_mode: 'KHONG' })
  const cOk = await api(`/masterdata/customers/${cust1.id}`, 'PUT', { load_mode: 'PALLET' })
  check('11a. Danh mục Khách hàng: kiểu đi sai → 400 · PALLET → 200 và cột lưu đúng', cBad.s === 400 && cOk.s === 200 && cOk.j?.data?.load_mode === 'PALLET',
    `bad=${cBad.s} ok=${cOk.s} mode=${cOk.j?.data?.load_mode}`)
  const p11 = await api('/tms/dispatch/plan', 'POST', { warehouse_id: WH, plan_date: DAY })   // KHÔNG đè ⇒ luật kho mặc định 1 khách / xe pallet
  const P11 = p11.j?.data
  const palTrips = (P11?.trips ?? []).filter(t => t.load_mode === 'PALLET')
  check('11b. Khách PALLET, kho mặc định 1 khách / xe pallet ⇒ OD1 và OD2 (cùng phường, khác khách) đi HAI xe; mọi xe pallet chỉ một khách',
    p11.s === 201 && tripOfOd(P11, OD[0])?.id !== tripOfOd(P11, OD[1])?.id && palTrips.length >= 2 && palTrips.every(t => new Set(t.ods.map(o => o.ship_to_code)).size === 1),
    `http=${p11.s} ${p11.j?.error?.message ?? ''} trips=${(P11?.trips ?? []).map(t => `${t.load_mode}:${[...new Set(t.ods.map(o => o.ship_to_code))].join('+')}`).join(' ')}`)
  const X11 = tripOfOd(P11, OD[0])
  const odm = await api(`/tms/dispatch/plans/${P11.id}/ods`, 'PATCH', { ids: [rowOf(P11, OD[0]).id], load_mode: 'LOOSE' })
  const X11b = tripOfOd(odm.j?.data, OD[0])
  check('11c. Đổi kiểu đi của MỘT OD sang Xá → OD ở nguyên xe, dòng OD mang LOOSE, xe cảnh báo "OD khách đi Xá đang nằm trên xe pallet"',
    odm.s === 200 && X11b?.id === X11?.id && rowOf(odm.j?.data, OD[0])?.load_mode === 'LOOSE' && /khách đi Xá đang nằm trên xe pallet/.test((X11b?.detail?.warnings ?? []).join(' ')),
    `http=${odm.s} ${odm.j?.error?.message ?? ''} warn=${(X11b?.detail?.warnings ?? []).join(' | ').slice(0, 120)}`)
  const odmBad = await api(`/tms/dispatch/plans/${P11.id}/ods`, 'PATCH', { ids: [rowOf(P11, OD[0]).id], load_mode: 'XA' })
  check('11d. Kiểu đi rác → 400 (zod tại biên)', odmBad.s === 400, `http=${odmBad.s}`)
  const flip = await api(`/tms/dispatch/trips/${X11.id}`, 'PATCH', { load_mode: 'LOOSE' })
  const P11c = await planOf(P11.id)
  const X11c = P11c?.trips?.find(t => t.id === X11.id)
  check('11e. Nút trên thẻ xe: đổi CẢ XE sang xá → xe LOOSE, mọi OD trên xe LOOSE, máy chọn lại dòng xe KHÁC xe pallet QA (xe tải theo tấn)',
    flip.s === 200 && X11c?.load_mode === 'LOOSE' && (X11c?.ods ?? []).every(o => o.load_mode === 'LOOSE') && !!X11c?.vehicle_model_id && X11c?.detail?.vehicle_model?.sap_code !== SAP,
    `http=${flip.s} ${flip.j?.error?.message ?? ''} mode=${X11c?.load_mode} vm=${X11c?.detail?.vehicle_model?.name} ods=${(X11c?.ods ?? []).map(o => o.load_mode).join(',')}`)
  const ro11 = await api(`/tms/dispatch/plans/${P11.id}/reopen`, 'POST', {})
  check('11f. Mở lại khi chưa xe nào vào Kế hoạch xuất → 422 NOTHING_TO_REOPEN', ro11.s === 422 && ro11.j?.error?.code === 'NOTHING_TO_REOPEN', `http=${ro11.s} code=${ro11.j?.error?.code}`)

  // Mở lại: xác nhận ⇒ mở lại ⇒ dòng Kế hoạch xuất gỡ, xe về nháp, chuyến bên Xuất GIỮ id ⇒ xác nhận lại ⇒ cùng Số xe sống lại
  await cleanupTrips()
  await api(`/tms/transport-companies/${HA.id}`, 'PUT', { tender_required: false })
  const pR = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
  const cR = await api(`/tms/dispatch/plans/${pR.j?.data?.id}/confirm`, 'POST', {})
  let PR = await planOf(pR.j?.data?.id)
  const gcR = (PR?.trips ?? []).map(t => t.group_code)
  const gdoBefore = await restAll('GroupDeliveryOrder', `select=id,group_code&group_code=like.${PREFIX}*`)
  // chuyến của xe đầu ĐANG XUẤT ⇒ không được mở lại (chứng từ đã chạy), xe còn lại mở được
  const busyGc = gcR[0]
  await restWrite('GroupDeliveryOrder', 'PATCH', `group_code=eq.${busyGc}`, { status: 'IN_PROGRESS', updated_at: nowIso() })
  const rop = await api(`/tms/dispatch/plans/${PR.id}/reopen`, 'POST', {})
  PR = await planOf(PR.id)
  const khAfter = await restAll('khvc_lines', `select=group_code&group_code=like.${PREFIX}*`)
  check('11g. Mở lại kế hoạch đã xác nhận: xe có chuyến ĐANG XUẤT giữ nguyên (nêu lý do), xe còn lại về NHÁP và dòng Kế hoạch xuất của nó được gỡ',
    cR.s === 200 && rop.s === 200 && rop.j?.data?.reopened?.blocked?.some(b => b.group_code === busyGc) && rop.j?.data?.reopened?.trips === gcR.length - 1
    && PR?.trips?.find(t => t.group_code === busyGc)?.status === 'CONFIRMED' && PR?.trips?.filter(t => t.group_code !== busyGc).every(t => t.status === 'DRAFT')
    && khAfter.every(k => k.group_code === busyGc) && khAfter.length > 0,
    `cf=${cR.s} reopen=${rop.s} ${JSON.stringify(rop.j?.data?.reopened ?? rop.j?.error)} kh=${khAfter.map(k => k.group_code).join(',')}`)
  const cR2 = await api(`/tms/dispatch/plans/${PR.id}/confirm`, 'POST', {})
  PR = await planOf(PR.id)
  const gdoAfter = await restAll('GroupDeliveryOrder', `select=id,group_code&group_code=like.${PREFIX}*`)
  const sameIds = gdoBefore.every(g => gdoAfter.some(a => a.id === g.id && a.group_code === g.group_code))
  check('11h. Xác nhận lại sau khi mở lại (kế hoạch mở một phần) → 200, mọi xe CONFIRMED, chuyến bên Xuất GIỮ NGUYÊN id (không đẻ chuyến mới)',
    cR2.s === 200 && PR?.status === 'CONFIRMED' && (PR?.trips ?? []).every(t => t.status === 'CONFIRMED') && sameIds && gdoAfter.length === gdoBefore.length,
    `http=${cR2.s} ${cR2.j?.error?.message ?? ''} plan=${PR?.status} gdo ${gdoBefore.length}→${gdoAfter.length} same=${sameIds}`)

  // ── [12] KHÔNG TRỘN LOẠI KHO · KIỂU ĐI THEO LOẠI KHO · ĐK BẢO QUẢN THEO VỊ TRÍ (user chốt 26/09) ────────────────
  // "FG01 đi FG01, FG02 đi FG02, muốn đi chung phải bật công tắc" · "POSM đi theo đơn" · "khách A FG01 đi pallet, FG02 đi xe thường"
  // · "điều kiện bảo quản khai theo cả vị trí — mặc định theo loại kho"
  await cleanupTrips()
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=in.(QA61OD6,QA61OD7)`).catch(() => {})
  const whFlag = await api(`/masterdata/warehouses/${WH}`, 'PUT', { dispatch_allow_mix_categories: true })
  const whNow = (await restAll('Warehouse', `select=dispatch_allow_mix_categories&id=eq.${WH}`))[0]
  check('12a. Form Kho: "Cho ghép nhiều Loại kho trên một chuyến" lưu được qua cửa app (PUT 200, cột đổi)', whFlag.s === 200 && whNow?.dispatch_allow_mix_categories === true,
    `http=${whFlag.s} ${whFlag.j?.error?.message ?? ''} col=${whNow?.dispatch_allow_mix_categories}`)
  await api(`/masterdata/warehouses/${WH}`, 'PUT', { dispatch_allow_mix_categories: false })
  if (!mat2 || !cat2Row) check('12b. Fixture: cần một mã hàng thuộc Loại kho KHÁC có quy cách pallet', false, `MAT_CAT=${MAT_CAT} mat2=${JSON.stringify(mat2)}`)
  else {
    const OD8 = 'QA61OD8'
    await restWrite('erp_outbound_orders', 'POST', null, {
      id: crypto.randomUUID(), od_number: OD8, od_item: '10', material_code: mat2.material_code, qty_base: Number(mat2.units_per_carton) * Number(mat2.cartons_per_pallet),
      ship_to_code: SHIP[0], ship_to_name: 'QA61 NPP 1', ward_code: W1, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY, flow: 'SALE',
      source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
    })
    const rowOfP = (pl, od) => [...(pl?.trips ?? []).flatMap(t => t.ods), ...(pl?.pool ?? [])].find(o => o.od_number === od)
    const pOff = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
    const POff = pOff.j?.data
    check(`12b. Kho KHÔNG cho trộn (mặc định): OD ${MAT_CAT} và OD ${CAT2} cùng khách cùng phường đi HAI chuyến · tham số kế hoạch ghi allow_mix_categories=false`,
      pOff.s === 201 && POff?.params?.allow_mix_categories === false && !!tripOfOd(POff, OD[0]) && !!tripOfOd(POff, OD8) && tripOfOd(POff, OD[0])?.id !== tripOfOd(POff, OD8)?.id,
      `http=${pOff.s} ${pOff.j?.error?.message ?? ''} mix=${POff?.params?.allow_mix_categories} trips=${(POff?.trips ?? []).map(t => `${t.group_code}:${t.ods.map(o => o.od_number).join('+')}`).join(' ')}`)
    const gaps = POff?.params?.config_gaps
    const cat2Cond = CAT2_META0?.storage_condition || null
    check('12b2. Kế hoạch mang danh sách KHAI THIẾU: Loại kho không có ĐK bảo quản (và không đi kèm) được liệt kê, loại đã khai thì không',
      !!gaps && Array.isArray(gaps.no_condition) && (cat2Cond ? !gaps.no_condition.some(x => x.category === CAT2) : gaps.no_condition.some(x => x.category === CAT2)),
      `cat2=${CAT2} cond=${cat2Cond} gaps=${JSON.stringify(gaps ?? null).slice(0, 160)}`)
    await cleanupTrips()
    const pOn = await api('/tms/dispatch/plan', 'POST', { ...PLAN_BODY, allow_mix_categories: true })
    check('12c. Lượt lập BẬT cho trộn ⇒ OD hai Loại kho gom MỘT chuyến (xe QA phục vụ mọi điều kiện, còn chỗ)',
      pOn.s === 201 && tripOfOd(pOn.j?.data, OD[0])?.id === tripOfOd(pOn.j?.data, OD8)?.id,
      `http=${pOn.s} trips=${(pOn.j?.data?.trips ?? []).map(t => t.ods.map(o => o.od_number).join('+')).join(' | ')}`)
    // Kiểu đi theo KHÁCH × LOẠI KHO
    await cleanupTrips()
    const c1 = (await restAll('Customer', `select=id&ship_to_code=eq.${SHIP[0]}`))[0]
    const kBad = await api(`/masterdata/customers/${c1.id}`, 'PUT', { load_mode_by_category: { KHONGCOLOAI: 'PALLET' } })
    const vBad = await api(`/masterdata/customers/${c1.id}`, 'PUT', { load_mode_by_category: { [CAT2]: 'XA' } })
    const kOk = await api(`/masterdata/customers/${c1.id}`, 'PUT', { load_mode_by_category: { [CAT2]: 'LOOSE' } })
    check('12f. Khách hàng: kiểu đi theo Loại kho — Loại kho lạ 400 · giá trị lạ 400 · hợp lệ 200 và lưu đúng',
      kBad.s === 400 && vBad.s === 400 && kOk.s === 200 && kOk.j?.data?.load_mode_by_category?.[CAT2] === 'LOOSE',
      `bad=${kBad.s} val=${vBad.s} ok=${kOk.s} map=${JSON.stringify(kOk.j?.data?.load_mode_by_category ?? kOk.j?.error)}`)
    const pM = await api('/tms/dispatch/plan', 'POST', { ...PLAN_BODY, allow_mix_categories: true })
    const r1 = rowOfP(pM.j?.data, OD[0]), r8 = rowOfP(pM.j?.data, OD8)
    check(`12g. Khách PALLET nhưng khai ${CAT2} = Xá ⇒ OD ${CAT2} đi Xá, OD ${MAT_CAT} vẫn Pallet, KHÔNG chung xe (kể cả khi kho cho trộn loại)`,
      pM.s === 201 && r1?.load_mode === 'PALLET' && r8?.load_mode === 'LOOSE' && r1?.trip_id !== r8?.trip_id,
      `http=${pM.s} od1=${r1?.load_mode} od8=${r8?.load_mode} sameTrip=${r1?.trip_id === r8?.trip_id}`)
    const bMerge = await api('/masterdata/customers/bulk', 'PATCH', { ids: [c1.id], patch: { load_mode_by_category: { category: MAT_CAT, mode: 'PALLET' } } })
    const m1 = (await restAll('Customer', `select=load_mode_by_category&id=eq.${c1.id}`))[0]?.load_mode_by_category ?? {}
    const bDel = await api('/masterdata/customers/bulk', 'PATCH', { ids: [c1.id], patch: { load_mode_by_category: { category: CAT2, mode: null } } })
    const m2 = (await restAll('Customer', `select=load_mode_by_category&id=eq.${c1.id}`))[0]?.load_mode_by_category ?? {}
    const bMix = await api('/masterdata/customers/bulk', 'PATCH', { ids: [c1.id], patch: { load_mode_by_category: { category: CAT2, mode: 'LOOSE' }, is_active: true } })
    check('12h. Hàng loạt: kiểu đi cho MỘT Loại kho GỘP vào bảng từng khách (không đè loại khác) · mode trống = gỡ · đi chung thao tác khác → 400',
      bMerge.s === 200 && m1[MAT_CAT] === 'PALLET' && m1[CAT2] === 'LOOSE' && bDel.s === 200 && m2[MAT_CAT] === 'PALLET' && !(CAT2 in m2) && bMix.s === 400,
      `merge=${bMerge.s} ${JSON.stringify(m1)} del=${bDel.s} ${JSON.stringify(m2)} mix=${bMix.s}`)
    await restWrite('Customer', 'PATCH', `id=eq.${c1.id}`, { load_mode_by_category: {} })

    // ⚠ Đặt SAU phần kiểu đi: meta Loại kho được nhớ 30 s mỗi instance (getWhTypeMetaMap) — bật "đi kèm" cho loại 2 trước
    // thì các lượt lập kế hoạch ngay sau đó vẫn coi loại 2 là đi kèm (đo 26/09: 12g đỏ oan vì thế).

    // POSM "đi theo đơn": bật cờ đi kèm cho Loại kho 2 qua CỬA APP (bộ lọc meta phải giữ khoá mới) ⇒ kho không cho trộn vẫn đi chung
    await cleanupTrips()
    const fl = await api(`/wms/lookup/${cat2Row.id}`, 'PUT', { value: cat2Row.value, meta: { ...CAT2_META0, dispatch_follow: true } })
    const cat2Now = (await restAll('LookupValue', `select=meta&id=eq.${cat2Row.id}`))[0]
    check('12d. Loại kho "Đi kèm đơn khi điều vận" → 200 và meta GIỮ khoá mới + cờ cũ (bộ lọc meta vứt khoá lạ nếu quên khai)',
      fl.s === 200 && cat2Now?.meta?.dispatch_follow === true && cat2Now?.meta?.badge_color === CAT2_META0?.badge_color,
      `http=${fl.s} meta=${JSON.stringify(cat2Now?.meta ?? null)}`)
    const pF = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
    check('12e. Loại kho đi kèm ⇒ kho KHÔNG cho trộn mà OD loại đó vẫn ké vào chuyến của chính khách (không đẻ chuyến riêng)',
      pF.s === 201 && pF.j?.data?.params?.allow_mix_categories === false && tripOfOd(pF.j?.data, OD[0])?.id === tripOfOd(pF.j?.data, OD8)?.id,
      `http=${pF.s} trips=${(pF.j?.data?.trips ?? []).map(t => t.ods.map(o => o.od_number).join('+')).join(' | ')}`)
    await api(`/wms/lookup/${cat2Row.id}`, 'PUT', { value: cat2Row.value, meta: CAT2_META0 })
  }

  // ĐK bảo quản theo VỊ TRÍ: ô đang chứa một mã THẬT của kho khai mức riêng ⇒ OD của mã đó mang mức của ô
  await cleanupTrips()
  if (!ieLoc || !locRow) check('12i. Fixture: cần một pallet tồn có vị trí ở kho fixture', false, `wh=${WH}`)
  else {
    const m9 = (await restAll('Material', `select=material_code,category,units_per_carton,cartons_per_pallet&id=eq.${ieLoc.material_id}`))[0]
    const mkL = await api('/wms/lookup', 'POST', { type: 'storage_condition', value: COND_LOC, meta: { label: 'QA61 kho lạnh ô', badge_color: 'sky' } })
    const lBad = await api(`/masterdata/locations/${locRow.id}`, 'PUT', { storage_condition: 'KHONG_CO_THAT' })
    const lOk = await api(`/masterdata/locations/${locRow.id}`, 'PUT', { storage_condition: COND_LOC })
    check('12i. Vị trí: ĐK bảo quản ngoài danh mục → 400 · mức có thật → 200 và cột lưu đúng',
      mkL.s === 200 && lBad.s === 400 && lOk.s === 200 && lOk.j?.data?.storage_condition === COND_LOC,
      `mk=${mkL.s} bad=${lBad.s} ok=${lOk.s} col=${lOk.j?.data?.storage_condition}`)
    // oracle: ĐK của ô cho MỌI chỗ chứa mã này trong kho — ô khai riêng ⇒ COND_LOC, ô khác ⇒ ĐK của Loại kho
    const ies = await restAll('InventoryEntry', `select=location_id&warehouse_id=eq.${WH}&material_id=eq.${ieLoc.material_id}&cartons_remaining=gt.0&status=in.(IN_STOCK,PARTIAL,QUARANTINE,LOOSE_PICKING)`)
    const catMeta = m9?.category ? (await restAll('LookupValue', `select=meta&type=eq.warehouse_type&value=eq.${encodeURIComponent(m9.category)}`))[0]?.meta : null
    const locIds = [...new Set(ies.map(x => x.location_id))]
    const locConds = locIds.length ? await restAll('Location', `select=id,storage_condition,categories&id=in.(${locIds.filter(Boolean).join(',')})`) : []
    const byId = new Map(locConds.map(l => [l.id, l.storage_condition && (!(l.categories ?? []).length || l.categories.includes(m9?.category)) ? l.storage_condition : null]))
    const expected = [...new Set(ies.map(x => (x.location_id ? byId.get(x.location_id) : null) ?? catMeta?.storage_condition ?? null).filter(Boolean))].sort()
    const OD9 = 'QA61OD9'
    await restWrite('erp_outbound_orders', 'POST', null, {
      id: crypto.randomUUID(), od_number: OD9, od_item: '10', material_code: m9.material_code, qty_base: Math.max(1, Number(m9.units_per_carton) || 1),
      ship_to_code: SHIP[2], ship_to_name: 'QA61 NPP 3', ward_code: W2, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY, flow: 'SALE', sap_pallets: 1,
      source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
    })
    const pL = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
    const r9 = [...(pL.j?.data?.trips ?? []).flatMap(t => t.ods), ...(pL.j?.data?.pool ?? [])].find(o => o.od_number === OD9)
    check('12j. OD của mã đang nằm ở ô khai riêng mang ĐÚNG các mức theo chỗ tồn thật (oracle tự tính từ tồn + ô + Loại kho)',
      pL.s === 201 && !!r9 && JSON.stringify([...(r9.conditions ?? [])].sort()) === JSON.stringify(expected) && expected.includes(COND_LOC),
      `http=${pL.s} ${pL.j?.error?.message ?? ''} got=${JSON.stringify(r9?.conditions)} expected=${JSON.stringify(expected)} (${ies.length} pallet ở ${locIds.length} ô)`)
    // Hàng ĐỂ NHỜ ô lạnh của Loại kho khác (vd FG01 trong Kho Lạnh NVL của RM01) KHÔNG thành hàng lạnh (20260926c — đo Bàu Bàng: 94/97 chuyến bị ép xe kết hợp)
    if (ieStray) {
      await cleanupTrips()
      await restWrite('erp_outbound_orders', 'DELETE', `od_number=eq.${OD9}`).catch(() => {})
      await api(`/masterdata/locations/${ieStray.location_id}`, 'PUT', { storage_condition: COND_LOC })
      await restWrite('erp_outbound_orders', 'POST', null, {
        id: crypto.randomUUID(), od_number: 'QA61OD10', od_item: '10', material_code: ieStray.material.material_code, qty_base: Math.max(1, Number(ieStray.material.units_per_carton) || 1),
        ship_to_code: SHIP[2], ship_to_name: 'QA61 NPP 3', ward_code: W2, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY, flow: 'SALE', sap_pallets: 1,
        source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
      })
      const pS = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
      const rS = [...(pS.j?.data?.trips ?? []).flatMap(t => t.ods), ...(pS.j?.data?.pool ?? [])].find(o => o.od_number === 'QA61OD10')
      check(`12j2. Mã ${ieStray.material.category} để nhờ ô Loại kho ${ieStray.loc.categories.join('+')} khai lạnh ⇒ OD KHÔNG mang mức của ô (ô lạnh chỉ nói về hàng thuộc ô)`,
        pS.s === 201 && !!rS && !(rS.conditions ?? []).includes(COND_LOC), `http=${pS.s} got=${JSON.stringify(rS?.conditions)}`)
      await api(`/masterdata/locations/${ieStray.location_id}`, 'PUT', { storage_condition: STRAY_COND0 })
    } else check('12j2. Fixture: cần một pallet để nhờ ô của Loại kho khác', false)
    const condL = (await restAll('LookupValue', `select=id&type=eq.storage_condition&value=eq.${COND_LOC}`))[0]
    const delL = await api(`/wms/lookup/${condL.id}`, 'DELETE')
    check('12k. Xoá mức đang được VỊ TRÍ dùng → 409 nêu "vị trí" (không để mã mồ côi trên ô)', delL.s === 409 && /vị trí/.test(delL.j?.error?.message ?? ''),
      `http=${delL.s} msg=${String(delL.j?.error?.message ?? '').slice(0, 100)}`)
    const lBack = await api(`/masterdata/locations/${locRow.id}`, 'PUT', { storage_condition: null })
    check('12l. Gửi null → ô về "theo Loại kho"', lBack.s === 200 && lBack.j?.data?.storage_condition === LOC_COND0, `http=${lBack.s} col=${lBack.j?.data?.storage_condition}`)
  }

  // ── [13] KHÁCH CHỈ NHẬN XE TẢI TRỌNG NHỎ (user 26/09: "một số NPP chỉ đi được xe tải trọng nhỏ") ─────────────────────
  await cleanupTrips()
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=in.(QA61OD8,QA61OD9)`).catch(() => {})
  {
    const c1 = (await restAll('Customer', `select=id&ship_to_code=eq.${SHIP[0]}`))[0]
    const tBad = await Promise.all([0, 150, 'abc'].map(v => api(`/masterdata/customers/${c1.id}`, 'PUT', { max_vehicle_tons: v })))
    const tOk = await api(`/masterdata/customers/${c1.id}`, 'PUT', { max_vehicle_tons: 3 })
    check('13a. Khách hàng: tải trọng xe tối đa 0 / 150 / chữ → 400 · 3 tấn → 200 và lưu đúng', tBad.every(r => r.s === 400) && tOk.s === 200 && Number(tOk.j?.data?.max_vehicle_tons) === 3,
      `bad=${tBad.map(r => r.s).join(',')} ok=${tOk.s} v=${tOk.j?.data?.max_vehicle_tons}`)
    // Kho QA không có dòng xe pallet nào ≤ 3 tấn (xe pallet nhỏ nhất đang hoạt động là 4 pallet / 4 tấn giả định) ⇒ OD1 không xếp được, nói đúng lý do
    const vms = (await api('/tms/vehicle-models')).j?.data?.items ?? []
    const palParents = new Set((await restAll('VehicleType', 'select=id&is_pallet_truck=eq.true')).map(v => v.id))
    const pal3 = vms.filter(m => m.is_active && palParents.has(m.parent_type_id) && Number(m.max_tons) > 0 && Number(m.max_tons) <= 3)
    const p3 = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
    const un1 = (p3.j?.data?.unplanned ?? []).find(u => u.od_number === OD[0])
    check('13b. Khách ≤ 3 tấn mà không xe pallet nào ≤ 3 tấn ⇒ OD không lên xe to hơn: vào "không xếp được" kèm lý do nêu MỨC',
      p3.s === 201 && (pal3.length ? true : (!!un1 && /chỉ nhận xe ≤ 3 tấn/.test(un1.reason) && !tripOfOd(p3.j?.data, OD[0]))),
      `http=${p3.s} pallet≤3t=${pal3.length} un=${JSON.stringify(un1 ?? null)} trip=${tripOfOd(p3.j?.data, OD[0])?.detail?.vehicle_model?.name ?? '—'}`)
    await cleanupTrips()
    await api(`/masterdata/customers/${c1.id}`, 'PUT', { max_vehicle_tons: 6 })
    const p6 = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
    const P6 = p6.j?.data
    const t6 = tripOfOd(P6, OD[0])
    const vmOf = id => vms.find(m => m.id === id)
    check('13c. Khách ≤ 6 tấn ⇒ OD lên dòng xe khai tải trọng ≤ 6 tấn (oracle đọc tấn của dòng xe từ danh mục), không lên xe QA 9 pallet chưa khai tấn',
      p6.s === 201 && !!t6 && Number(vmOf(t6.vehicle_model_id)?.max_tons) > 0 && Number(vmOf(t6.vehicle_model_id)?.max_tons) <= 6 && t6.detail?.vehicle_model?.sap_code !== SAP
      && rowOf(P6, OD[0])?.max_vehicle_tons != null && Number(rowOf(P6, OD[0]).max_vehicle_tons) === 6,
      `http=${p6.s} ${p6.j?.error?.message ?? ''} vm=${t6?.detail?.vehicle_model?.name} tấn=${vmOf(t6?.vehicle_model_id)?.max_tons} snap=${rowOf(P6, OD[0])?.max_vehicle_tons}`)
    // Người kéo OD của khách giới hạn lên xe to hơn ⇒ không chặn (nháp) nhưng cảnh báo nêu khách + mức
    const big = (P6?.trips ?? []).find(t => t.id !== t6?.id && t.detail?.vehicle_model?.sap_code === SAP)
    if (big && t6) {
      const mv = await api(`/tms/dispatch/plans/${P6.id}/move`, 'POST', { ids: [rowOf(P6, OD[0]).id], to: 'trip', to_trip_id: big.id })
      const bigNow = (await planOf(P6.id))?.trips?.find(t => t.id === big.id)
      check('13d. Kéo OD của khách ≤ 6 tấn lên xe QA (chưa khai tấn) ⇒ cho thả, xe cảnh báo "chỉ nhận xe ≤ 6 tấn"',
        mv.s === 200 && (bigNow?.ods ?? []).some(o => o.od_number === OD[0]) && /chỉ nhận xe ≤ 6 tấn/.test((bigNow?.detail?.warnings ?? []).join(' ')),
        `http=${mv.s} ${mv.j?.error?.message ?? ''} warn=${(bigNow?.detail?.warnings ?? []).join(' | ').slice(0, 160)}`)
    } else check('13d. Fixture: cần một xe QA khác để kéo OD sang', false, `trips=${(P6?.trips ?? []).map(t => t.detail?.vehicle_model?.sap_code).join(',')}`)
    const bT = await api('/masterdata/customers/bulk', 'PATCH', { ids: [c1.id], patch: { max_vehicle_tons: null } })
    const cNow = (await restAll('Customer', `select=max_vehicle_tons&id=eq.${c1.id}`))[0]
    check('13e. Hàng loạt "Tải trọng xe tối đa" để trống → bỏ giới hạn', bT.s === 200 && cNow?.max_vehicle_tons == null, `http=${bT.s} v=${cNow?.max_vehicle_tons}`)
  }
} finally {
  await cleanup()
  const left = (await restAll('dispatch_plan', `select=id&warehouse_id=eq.${WH}&plan_date=eq.${DAY}`)).length
    + (await restAll('khvc_lines', `select=id&group_code=like.${PREFIX}*`)).length
    + (await restAll('erp_outbound_orders', `select=id&od_number=like.QA61*`)).length
    + (await restAll('vehicle_model', `select=id&sap_code=like.QA61*`)).length
  const ha = (await restAll('TransportCompany', `select=tender_required&id=eq.${HA.id}`))[0]
  const catBack = catRow ? (await restAll('LookupValue', `select=meta&id=eq.${catRow.id}`))[0] : null
  const condLeft = (await restAll('LookupValue', `select=id&type=eq.storage_condition&value=eq.${COND}`)).length
  check('9. Dọn sạch fixture QA61 + trả cờ HA và meta Loại kho về như cũ', left === 0 && ha?.tender_required === HA_FLAG0 && condLeft === 0
    && (!catRow || JSON.stringify(catBack?.meta ?? {}) === JSON.stringify(CAT_META0 ?? {})),
    `còn ${left} · HA=${ha?.tender_required} (gốc ${HA_FLAG0}) · danh mục QA còn ${condLeft} · loại kho ${JSON.stringify(catBack?.meta ?? null)}`)
}
finish(PACK)
