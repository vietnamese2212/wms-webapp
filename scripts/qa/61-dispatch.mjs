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
// 29/09 (user: "bỏ loại xe, chọn dòng xe luôn"): KHÔNG còn kiểu đi Pallet / Xá của khách hay của xe. Dòng xe QA không khai
// `max_drops` ⇒ OD1+OD2 cùng xe như các kịch bản cũ; "xe pallet chỉ một khách" = `max_drops = 1` trên dòng xe, kiểm ở [11].

await login(); await resolveFixtures()
const WH = FIX.WH_QR.id
const PREFIX = `${FIX.WH_QR.code}_X_160327_`
const PLAN_BODY = { warehouse_id: WH, plan_date: DAY }
const DAY2 = '2027-03-17'   // [17] (03/10 tối) kế hoạch ngày THỨ HAI cùng kho — rào "một đơn một ngày", khung chờ tự do, Kéo về đây
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
// Loại kho THỨ HAI là của RIÊNG gói (01/10). Bản cũ lấy Loại kho THẬT khác MAT_CAT (= FG01, loại của 346 mã bán) rồi bật/tắt cờ
// "Đi kèm đơn" của nó ~35 s mỗi lượt CI: lượt Tối ưu lại của người dùng trên bàn Ba Vì 29/09 rơi đúng cửa sổ đó (07:37:03, cờ trả
// lại 07:37:05) ⇒ mọi OD FG01 chụp danh sách dòng xe của KÊNH, Blue Star mất Xe 4/6 pallet đã khai riêng. Dữ liệu dùng chung không
// được là fixture — mã + Loại kho QA tạo ở đầu [12], xoá trong cleanup (chạy cả ở ĐẦU gói).
const CAT2 = 'QA61F'
const MAT2 = 'QA61MAT2'
const CAT2_META0 = { label: 'QA61 Loại kho 2', badge_color: 'blue', storage_condition: 'AMBIENT' }
let cat2Row = null, mat2 = null
const WH_MIX0 = (await restAll('Warehouse', `select=dispatch_allow_mix_categories&id=eq.${WH}`))[0]?.dispatch_allow_mix_categories === true
// [16] (01/10) dải tải theo dòng xe cha: lượt ghép có gửi dải thì kho NHỚ (Warehouse.dispatch_load_bands) — kho fixture là kho THẬT, trả lại gốc
const WH_BANDS0 = (await restAll('Warehouse', `select=dispatch_load_bands&id=eq.${WH}`))[0]?.dispatch_load_bands ?? null
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
  await restWrite('dispatch_plan', 'DELETE', `warehouse_id=eq.${WH}&plan_date=eq.${DAY2}`).catch(() => {})  // [17] nháp ngày thứ hai
  await restWrite('dispatch_od_hold', 'DELETE', `warehouse_id=eq.${WH}&od_number=like.QA61*`).catch(() => {})
  await restWrite('dispatch_od_outside', 'DELETE', `warehouse_id=eq.${WH}&od_number=like.QA61*`).catch(() => {})
  await restWrite('od_lineage', 'DELETE', `old_od=like.QA61*`).catch(() => {})
  await restWrite('khvc_lines', 'DELETE', `group_code=like.QA61RAIL*`).catch(() => {})
  await restWrite('dispatch_od_segment', 'DELETE', `warehouse_id=eq.${WH}&od_number=like.QA61*`).catch(() => {})   // [19] dấu lấy sang mảng
}
async function cleanup() {
  await cleanupTrips()
  // Trả Loại kho về meta GỐC trước tiên: để sót `storage_condition` của QA thì mọi kế hoạch điều vận sau đó
  // không tìm được dòng xe nào phục vụ — hỏng cho cả phiên khác đang dùng staging.
  if (catRow && CAT_META0) await restWrite('LookupValue', 'PATCH', `id=eq.${catRow.id}`, { meta: CAT_META0 }).catch(() => {})
  // Loại kho + mã hàng RIÊNG của gói ([12]): mã trước, loại sau (cửa xoá Loại kho đếm mã hàng đang dùng; qua cửa app để dọn cả dòng gán kho)
  await restWrite('erp_outbound_orders', 'DELETE', `material_code=eq.${MAT2}`).catch(() => {})
  await restWrite('Material', 'DELETE', `material_code=eq.${MAT2}`).catch(() => {})
  for (const lk of await restAll('LookupValue', `select=id&type=eq.warehouse_type&value=eq.${CAT2}`)) {
    const d = await api(`/wms/lookup/${lk.id}`, 'DELETE').catch(() => ({ s: 0 }))
    if (d.s !== 200) { await restWrite('warehouse_type_configs', 'DELETE', `type_code=eq.${CAT2}`).catch(() => {}); await restWrite('LookupValue', 'DELETE', `id=eq.${lk.id}`).catch(() => {}) }
  }
  await restWrite('Warehouse', 'PATCH', `id=eq.${WH}`, { dispatch_allow_mix_categories: WH_MIX0, dispatch_load_bands: WH_BANDS0 }).catch(() => {})
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
// Kho fixture là Ba Vì THẬT: người dùng chọn dải trên bàn (vd XE PALLET 90–105) là mọi kịch bản cũ của gói đổi kết quả (7/9 thành
// Non tải, 14 pallet chia 9,45 + 4,55 — lượt 01/10). Gói chạy với kho KHÔNG có dải mặc định; cleanup trả lại WH_BANDS0.
await restWrite('Warehouse', 'PATCH', `id=eq.${WH}`, { dispatch_load_bands: null })

const planOf = async (id) => (await api(`/tms/dispatch/plans/${id}`)).j?.data
// XEM ĐƠN LÀ BƯỚC BẮT BUỘC (27/09 tối): lập = mọi OD vào khung chờ CHƯA XEM, 0 xe. Các kịch bản đo MÁY GHÉP ⇒ lập rồi
// "Xác nhận … đơn & ghép xe" (review_all). Giữ hình dạng { s, j } của lần lập (s = 201) nhưng data là kế hoạch SAU khi ghép.
// Khung chờ rỗng (mọi OD "không lên xe") ⇒ không có gì để ghép ⇒ trả nguyên kế hoạch vừa lập (0 xe) như máy cũ.
const mkPlan = async (body) => {
  const c = await api('/tms/dispatch/plan', 'POST', body)
  if (c.s !== 201) return c
  const r = await api(`/tms/dispatch/plans/${c.j.data.id}/reoptimize`, 'POST', { review_all: true })
  if (r.s === 422 && r.j?.error?.code === 'NOTHING_TO_OPTIMIZE') return c
  if (r.s !== 200) return { s: r.s, j: r.j }
  return { s: 201, j: { ...r.j, data: { ...r.j.data, in_plan: c.j.data.in_plan } } }
}
const tripOfOd = (plan, od) => plan?.trips?.find(t => t.ods.some(o => o.od_number === od))
const sur = (t) => (t?.detail?.freight?.surcharges ?? []).reduce((s, x) => s + Number(x.total ?? 0), 0)

try {
  // ── Fixture: dòng xe con 9 pallet (gán cha) · cước DA@W1 · cước HA@W2 · 3 OD ZSD02 + khách (phường/vùng) ──
  // 02/10: dòng xe / khách CHƯA KHAI số điểm giao = 1 ⇒ fixture khai 3 để các kịch bản ghép (OD1+OD2) vẫn đúng; ca "chưa khai" kiểm ở [11e]/[13i]
  // 02/10: tạo dòng con BẮT BUỘC cha + điều kiện bảo quản + sức chứa theo thước đo. Xe QA khai MỌI mức trong danh mục = đúng nghĩa
  // "chở được mọi điều kiện" của fixture cũ (khai rỗng) — mã fixture là hàng THẬT có tồn ở ô khai ĐK riêng của Ba Vì, khai một mức
  // thì [12c] đỏ oan (hàng đòi mức khác, OD CAT2 không ghép được vì không xe nào chở cả hai mức)
  const ALL_CONDS = (await restAll('LookupValue', 'select=value&type=eq.storage_condition')).map(r => r.value)
  const cr = await api('/tms/vehicle-models', 'POST', { sap_code: SAP, name: 'QA61 Xe 9 Pallet', parent_type_id: XEPALLET?.id, storage_conditions: ALL_CONDS, capacity_mode: 'PALLET', max_pallets: 9, tariff_unit: 'PER_PALLET', max_drops: 3 })
  const vmId = cr.j?.data?.id
  const t1 = await api('/tms/freight/tariffs', 'POST', { from_warehouse_id: WH, transport_company_id: DA.id, vehicle_model_id: vmId, ward_code: W1, price: PRICE_DA, distance_km: 15 })
  const t2 = await api('/tms/freight/tariffs', 'POST', { from_warehouse_id: WH, transport_company_id: HA.id, vehicle_model_id: vmId, ward_code: W2, price: PRICE_HA, distance_km: 30 })
  check('0. Fixture: dòng xe con QA61 + cước DA@W1 + HA@W2 → 201', cr.s === 201 && !!vmId && t1.s === 201 && t2.s === 201, `vm=${cr.s} t1=${t1.s} t2=${t2.s} ${t1.j?.error?.message ?? ''}`)
  // 28/09 (user: "dòng xe chọn theo khai báo của khách, không khai thì không chọn") — khách fixture khai MỌI dòng xe đang hoạt
  // động để các kịch bản cũ (viết khi "không khai = mọi xe") giữ nguyên ý; luật "không khai ⇒ không chọn" kiểm riêng ở [13f]
  const ALLV = { '*': (await restAll('vehicle_model', 'select=id&is_active=eq.true')).map(v => v.id) }
  for (let i = 0; i < 3; i++) {
    const ward = i < 2 ? W1 : W2
    await restWrite('Customer', 'POST', null, { id: crypto.randomUUID(), ship_to_code: SHIP[i], name: `QA61 NPP ${i + 1}`, ward_code: ward, region_code: REGION, is_active: true, auto_created: true, dispatch_vehicles: ALLV, max_customers_per_trip: 3, updated_at: nowIso() })
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
  const p1 = await mkPlan(PLAN_BODY)
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
  const p1b = await mkPlan(PLAN_BODY)
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
  const again = await mkPlan(PLAN_BODY)
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
  const p3 = await mkPlan(PLAN_BODY)
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
    check('7c. Khai hàng loạt → updated 1 · dòng xe mang đúng mã · ô đếm "chưa khai" không đổi (fixture đã có ĐK từ lúc tạo — 02/10 bắt buộc)',
      okC.s === 200 && okC.j?.data?.updated === 1 && JSON.stringify(mine?.storage_conditions) === JSON.stringify([COND]) && listVm.j?.data?.unconditioned === before,
      `http=${okC.s} conds=${JSON.stringify(mine?.storage_conditions)} unconditioned ${before}→${listVm.j?.data?.unconditioned}`)

    if (catRow) {
      // Loại kho của mã fixture khai điều kiện ⇒ hàng "đòi" mức đó; chỉ dòng xe QA phục vụ nên nó phải được chọn
      const setCat = await api(`/wms/lookup/${catRow.id}`, 'PUT', { value: catRow.value, meta: { ...CAT_META0, storage_condition: COND } })
      const catNow = (await restAll('LookupValue', `select=meta&id=eq.${catRow.id}`))[0]
      check('7d. Loại kho khai điều kiện bảo quản → 200 và meta giữ CẢ cờ cũ lẫn khoá mới (không đè mất cấu hình đang chạy)',
        setCat.s === 200 && catNow?.meta?.storage_condition === COND && catNow?.meta?.badge_color === CAT_META0.badge_color,
        `http=${setCat.s} meta=${JSON.stringify(catNow?.meta ?? null)}`)

      await cleanupTrips()
      const pc = await mkPlan(PLAN_BODY)
      const tr = (pc.j?.data?.trips ?? [])
      check('7e. Lập kế hoạch: mọi xe đều là dòng xe PHỤC VỤ được mức đó, và chuyến mang điều kiện của hàng',
        pc.s === 201 && tr.length > 0 && tr.every(t => t.vehicle_model_id === vmId) && tr.every(t => JSON.stringify(t.detail?.conditions) === JSON.stringify([COND])),
        `http=${pc.s} trips=${tr.length} vm=${[...new Set(tr.map(t => t.detail?.vehicle_model?.sap_code))].join(',')} conds=${JSON.stringify(tr[0]?.detail?.conditions)}`)

      // Gỡ khai khỏi dòng xe QA ⇒ KHÔNG dòng xe nào phục vụ mức QA ⇒ phải nói thẳng thiếu mức nào, không im lặng
      await api('/tms/vehicle-models/assign-conditions', 'PATCH', { ids: [vmId], storage_conditions: ['AMBIENT'] })
      await cleanupTrips()
      const pn = await mkPlan(PLAN_BODY)
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
      // 02/10: không còn khai RỖNG (ĐK bắt buộc) — gỡ mức QA khỏi xe = khai lại mọi mức của danh mục (như fixture)
      const emptyC = await api('/tms/vehicle-models/assign-conditions', 'PATCH', { ids: [vmId], storage_conditions: [] })
      await api('/tms/vehicle-models/assign-conditions', 'PATCH', { ids: [vmId], storage_conditions: ALL_CONDS })
      const delFree = await api(`/wms/lookup/${condRow.id}`, 'DELETE')
      check('7h. Khai rỗng → 400 (ĐK bắt buộc) · gỡ mức QA khỏi hai bên rồi xoá → 200', emptyC.s === 400 && delFree.s === 200, `empty=${emptyC.s} http=${delFree.s} ${delFree.j?.error?.message ?? ''}`)
    }
  }

  // ── [5] Tắt cờ HA → Xác nhận là vào thẳng (hành vi mặc định — không phản hồi, muốn đổi thì sửa tay) ──
  await cleanupTrips()
  await api(`/tms/transport-companies/${HA.id}`, 'PUT', { tender_required: false })
  const p5 = await mkPlan(PLAN_BODY)
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
  await restWrite('Customer', 'POST', null, { id: crypto.randomUUID(), ship_to_code: 'QA61SHIP4', name: 'QA61 NPP 4', ward_code: W1, region_code: REGION, is_active: true, auto_created: true, dispatch_vehicles: ALLV, max_customers_per_trip: 3, updated_at: nowIso() })
  await restWrite('erp_outbound_orders', 'POST', null, {
    id: crypto.randomUUID(), od_number: OD4, od_item: '10', material_code: MAT_LA, qty_base: 2 * perPallet,
    ship_to_code: 'QA61SHIP4', ship_to_name: 'QA61 NPP 4', ward_code: W1, region_code: REGION, plant: wh?.sap_plant ?? null,
    delivery_date: DAY, flow: 'SALE', sap_pallets: 2, source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
  })
  const matGone = (await restAll('Material', `select=material_code&material_code=eq.${MAT_LA}`)).length === 0
  check('8a. Fixture: mã hàng của OD4 KHÔNG có trong danh mục Mã hàng', matGone, matGone ? MAT_LA : 'mã lại có thật — đổi tên fixture')
  // 03/10 (user: "mã chưa có thì phải xử lý TRƯỚC khi ghép đơn"): OD mã lạ bị loại NGAY lúc nạp (excluded NO_MATERIAL, nêu đích danh mã),
  // không vào khung chờ / xe nào; chip Khai thiếu đếm; khai mã xong ⇒ cửa sync thấy OD "mới" ⇒ nạp vào khung chờ. Bản cũ chỉ chặn ở Xác nhận
  // (422 MATERIAL_UNKNOWN — vẫn giữ làm lưới thứ hai) nên người ghép xong 50 xe mới biết.
  const p8 = await mkPlan(PLAN_BODY)
  const d8 = p8.j?.data
  const ex8 = (d8?.params?.excluded ?? []).find(x => x.od_number === OD4)
  const onBoard8 = [...(d8?.pool ?? []), ...(d8?.trips ?? []).flatMap(t => t.ods)].some(o => o.od_number === OD4)
  check('8b. Lập kế hoạch: OD mã lạ bị LOẠI (excluded NO_MATERIAL), KHÔNG vào khung chờ / xe; ô Khai thiếu đếm 1 OD + nêu mã',
    p8.s === 201 && ex8?.kind === 'NO_MATERIAL' && !onBoard8 && d8?.params?.config_gaps?.no_material?.ods === 1 && (d8?.params?.config_gaps?.no_material?.materials ?? []).includes(MAT_LA),
    `http=${p8.s} kind=${ex8?.kind ?? '-'} onBoard=${onBoard8} gaps=${JSON.stringify(d8?.params?.config_gaps?.no_material ?? null)}`)
  check('8c. Lý do loại nêu ĐÍCH DANH mã phải khai (người dùng biết làm gì tiếp)', String(ex8?.info ?? '').includes(MAT_LA), String(ex8?.info ?? '').slice(0, 140))
  const sy8 = await api(`/tms/dispatch/plans/${d8?.id}/sync`)
  check('8c2. Cửa sync KHÔNG đếm OD mã lạ là "OD mới" (không thì bàn tự nạp mãi)', sy8.s === 200 && !(sy8.j?.data?.new_od_numbers ?? []).includes(OD4), `http=${sy8.s} new=${sy8.j?.data?.new_ods}`)
  const kh8 = await restAll('khvc_lines', `select=do_no&group_code=like.${PREFIX}*`)
  check('8d. Không ghi dòng Kế hoạch xuất nào cho OD mã lạ (không có trạng thái nửa vời)', kh8.length === 0, `n=${kh8.length}`)
  // khai mã qua cửa app ⇒ sync thấy OD4 là "mới" ⇒ refresh-pool đưa vào khung chờ (đúng đường bàn làm việc tự chạy)
  const mk8 = await api('/masterdata/materials', 'POST', { material_code: MAT_LA, material_description: 'QA61 mã khai sau', category: mat2?.category ?? 'FG01', base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 12, cartons_per_pallet: 40, weight_kg: 5 })
  const sy8b = await api(`/tms/dispatch/plans/${d8?.id}/sync`)
  const rf8 = await api(`/tms/dispatch/plans/${d8?.id}/refresh-pool`, 'POST', {})
  const inPool8 = (rf8.j?.data?.pool ?? []).some(o => o.od_number === OD4)
  const ex8b = (rf8.j?.data?.params?.excluded ?? []).find(x => x.od_number === OD4)
  check('8e. Khai mã xong → sync báo OD4 là OD mới → nạp OD mới đưa OD4 vào khung chờ, hết dấu NO_MATERIAL',
    [200, 201].includes(mk8.s) && sy8b.s === 200 && (sy8b.j?.data?.new_od_numbers ?? []).includes(OD4) && rf8.s === 200 && inPool8 && !ex8b,
    `mat=${mk8.s} ${mk8.j?.error?.message ?? ''} sync=${sy8b.j?.data?.new_ods} refresh=${rf8.s} inPool=${inPool8} ex=${ex8b?.kind ?? '-'}`)
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=eq.${OD4}`).catch(() => {})
  await restWrite('Material', 'DELETE', `material_code=eq.${MAT_LA}`).catch(() => {})
  await restWrite('Customer', 'DELETE', `ship_to_code=eq.QA61SHIP4`).catch(() => {})

  // ── [10] BÀN GHÉP XE + POOL LŨY TIẾN (user chốt 25/09) ──────────────────────────────────────────────
  // Kéo thả = MỘT cửa `POST /plans/:id/move` (xe · xe mới · khung chờ · bỏ); vượt tải CHO THẢ đánh dấu đỏ; xe trống KHÔNG tự
  // biến mất (Hoàn tác phải thả lại được đúng xe); khoá xe + "Tối ưu lại phần chưa khoá"; OD đã điều / đã đi / bị SAP thay
  // phải tự rời đợt ghép và chặn Xác nhận; OD tồn đọng (ngày giao trước) gộp vào kèm số ngày trễ.
  await cleanupTrips()
  const rowOf = (pl, od) => [...(pl?.trips ?? []).flatMap(t => t.ods), ...(pl?.pool ?? [])].find(o => o.od_number === od)
  const mvB = (pl, body) => api(`/tms/dispatch/plans/${pl.id}/move`, 'POST', body)
  const pb = await mkPlan(PLAN_BODY)
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
  // 28/09: trang tự gọi cửa này khi /sync báo OD mới; OD vừa nạp nằm trong params.fresh_ods ⇒ nhãn "Mới" ở Xem đơn + khung chờ
  check('10k. Nạp OD mới → OD3 vào KHUNG CHỜ (trip_id null) với 3 pallet + đứng trong fresh_ods (nhãn "Mới")', rf.s === 200 && rf.j?.data?.refreshed?.added >= 1 && rowOf(B, OD[2])?.trip_id === null && Number(rowOf(B, OD[2])?.pallets) === 3
    && (B?.params?.fresh_ods ?? []).includes(OD[2]),
    `http=${rf.s} ${JSON.stringify(rf.j?.data?.refreshed ?? rf.j?.error)} fresh=${JSON.stringify(B?.params?.fresh_ods ?? null)}`)
  const mNr = await mvB(B, { ids: [rowOf(B, OD[2]).id], to: 'new' })
  // 27/09 tối (user: "dữ liệu mới không có trong Đã điều thì mặc định là Điều") — OD mới về kéo thẳng lên xe được
  check('10k2. OD mới về (Nạp OD mới) mặc định ĐIỀU: kéo thẳng vào "Xe mới" → 200, OD3 lên xe mới, xe cũ giữ nguyên',
    mNr.s === 200 && !!tripOfOd(mNr.j?.data, OD[2]) && tripOfOd(mNr.j?.data, OD[0])?.id === tripOfOd(B, OD[0])?.id,
    `move=${mNr.s} ${mNr.j?.error?.code ?? ''} ${mNr.j?.error?.message ?? ''}`)
  B = mNr.j?.data
  await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[2]}`, { sap_dispatch_status: 'ASSIGNED', dvvt_raw: 'QA61 NHA XE', license_plate: '29C99999', updated_at: nowIso() })
  const sy2 = await api(`/tms/dispatch/plans/${B.id}/sync`)
  const fl3 = (sy2.j?.data?.flags ?? []).find(x => x.od_number === OD[2])
  check('10l. SAP ghi "Đã điều" cho OD3 SAU khi lập → /sync gắn cờ SAP_ASSIGNED nêu ĐVVT + biển số', fl3?.kind === 'SAP_ASSIGNED' && /QA61 NHA XE/.test(fl3?.info ?? '') && /29C99999/.test(fl3?.info ?? ''), `flag=${JSON.stringify(fl3 ?? null)}`)
  // 03/10 tối: cờ "SAP đã gắn xe" chỉ THAM CHIẾU — KHÔNG chặn Xác nhận nữa (người quyết bằng dấu Ngoài app); chặn chỉ với SAP SỬA / THAY / BỎ.
  // Giả lập SAP SỬA số lượng OD3 (khác bản chụp lúc lập) ⇒ cờ CHANGED ⇒ 409; rồi trả lại số cũ.
  await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[2]}`, { qty_base: PAL[2] * perPallet + 1, updated_at: nowIso() })
  const cfb = await api(`/tms/dispatch/plans/${B.id}/confirm`, 'POST', {})
  const khb = await restAll('khvc_lines', `select=id&group_code=like.${PREFIX}*`)
  check('10m. Xác nhận khi còn OD SAP ĐÃ SỬA (cờ CHANGED) → 409 OD_CHANGED_IN_SAP nêu OD, KHÔNG ghi dòng Kế hoạch xuất nào (cờ SAP gắn xe một mình không chặn — 03/10 tối)',
    cfb.s === 409 && cfb.j?.error?.code === 'OD_CHANGED_IN_SAP' && String(cfb.j?.error?.message ?? '').includes(OD[2]) && khb.length === 0, `http=${cfb.s} code=${cfb.j?.error?.code} kh=${khb.length}`)
  await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[2]}`, { qty_base: PAL[2] * perPallet, updated_at: nowIso() })
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
  B = rp.j?.data ?? B // thất bại thì giữ kế hoạch cũ — đừng để một phép đỏ giết cả gói (02/10: "reading 'id'")
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
  const pl2 = await mkPlan(PLAN_BODY)
  const P2 = pl2.j?.data
  const sy4 = await api(`/tms/dispatch/plans/${P2?.id}/sync`)
  check('10q. OD trả về (RETURN) nằm ở "không lên xe" và /sync KHÔNG báo nó là OD mới (0 OD mới ngay sau khi lập)',
    (P2?.unplanned ?? []).some(u => u.od_number === OD7) && sy4.s === 200 && !(sy4.j?.data?.new_od_numbers ?? []).includes(OD7) && sy4.j?.data?.new_ods === 0,
    `unplanned=${(P2?.unplanned ?? []).map(u => u.od_number).join(',')} sync=${sy4.s} new=${JSON.stringify(sy4.j?.data?.new_od_numbers ?? sy4.j?.error)}`)
  const ex1 = (P2?.params?.excluded ?? []).find(x => x.od_number === OD[0])
  const r6 = rowOf(P2, OD6)
  const fl1 = (sy4.j?.data?.flags ?? []).find(f => f.od_number === OD[0])
  // 03/10 tối (user: "dựa theo SAP sẽ rối loạn — lấy theo lịch sử của app và dấu tay"): OD đã post ở SAP KHÔNG bị loại nữa — vào đợt
  // ghép như thường, /sync cắm cờ SHIPPED làm THAM CHIẾU; người quyết bằng dấu Ngoài app. Bản 25/09 loại nó sang "đã bỏ ra".
  check('10p. Lập kế hoạch: OD đã post ở SAP VẪN vào (không nằm "đã bỏ ra"), /sync cắm cờ SHIPPED tham chiếu · OD tồn đọng 14/03 lên xe kèm trễ 2 ngày',
    pl2.s === 201 && !!rowOf(P2, OD[0]) && !ex1 && fl1?.kind === 'SHIPPED' && !!r6?.trip_id && r6?.late_days === 2 && r6?.delivery_date === LATE && P2?.summary?.late_ods === 1,
    `http=${pl2.s} ${pl2.j?.error?.message ?? ''} od1=${!!rowOf(P2, OD[0])} ex=${JSON.stringify(ex1 ?? null)} flag=${fl1?.kind} late=${JSON.stringify({ t: r6?.trip_id != null, d: r6?.late_days, dd: r6?.delivery_date, n: P2?.summary?.late_ods })}`)
  // 29/09 (Ba Vì thật: 17 OD "SAP đã sửa" oan): dòng CHIẾT KHẤU (mã 9100000xx) của OD TỒN ĐỌNG không vào bản chụp (không lên xe
  // được) ⇒ /sync cũng phải bỏ nó khi so — dòng đó có sẵn trong ZSD02 từ trước, SAP không sửa gì
  await restWrite('erp_outbound_orders', 'POST', null, {
    id: crypto.randomUUID(), od_number: OD6, od_item: '20', material_code: '910000060', qty_base: 1,
    ship_to_code: SHIP[1], ship_to_name: 'QA61 NPP 2', ward_code: W1, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: LATE, flow: 'DISCOUNT',
    source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
  })
  const sy5 = await api(`/tms/dispatch/plans/${P2?.id}/sync`)
  const fl6 = (sy5.j?.data?.flags ?? []).find(f => f.od_number === OD6)
  check('10p2. OD tồn đọng có thêm dòng CHIẾT KHẤU (không lên xe) trong ZSD02 → /sync KHÔNG gắn cờ "SAP đã sửa" (bản chụp và phép so cùng một luật dòng)',
    sy5.s === 200 && !fl6, `sync=${sy5.s} flag=${JSON.stringify(fl6 ?? null)}`)
  // 30/09 (user: "170 đơn đi đâu mất, sao không nằm trong Đã điều"): OD TỒN ĐỌNG đã đi không nằm trong params.excluded (2.000 dòng
  // lịch sử) nhưng phải xem được qua GET /backlog — kèm ngày giao + khách; OD tồn đọng ĐANG trên xe (OD6) thì không nằm đó
  const OD9 = 'QA61OD9'
  await restWrite('erp_outbound_orders', 'POST', null, {
    id: crypto.randomUUID(), od_number: OD9, od_item: '10', material_code: FIX.MAT_POOL, qty_base: perPallet,
    ship_to_code: SHIP[0], ship_to_name: 'QA61 NPP 1', ward_code: W1, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: LATE, flow: 'SALE', mat_doc: 'QA61MD9',
    source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
  })
  // 03/10 tối: OD9 đã post KHÔNG còn là "tồn đọng đã đi" — nó là đơn mới của khung chờ (cờ SHIPPED tham chiếu); /backlog chỉ còn đơn
  // đã ở Kế hoạch xuất / DO tạo lại — kiểm bằng một dòng Kế hoạch xuất thật cho OD9
  const rf9 = await api(`/tms/dispatch/plans/${P2?.id}/refresh-pool`, 'POST', {})
  const sy9 = await api(`/tms/dispatch/plans/${P2?.id}/sync`)
  const fl9 = (sy9.j?.data?.flags ?? []).find(f => f.od_number === OD9)
  check('10p4. OD tồn đọng ĐÃ POST ở SAP → nạp OD mới đưa vào khung chờ (không loại), /sync cờ SHIPPED tham chiếu · id rác /backlog → 400',
    rf9.s === 200 && !!rowOf(rf9.j?.data, OD9) && fl9?.kind === 'SHIPPED' && (await api('/tms/dispatch/plans/xx/backlog')).s === 400,
    `refresh=${rf9.s} ${rf9.j?.error?.message ?? ''} od9=${!!rowOf(rf9.j?.data, OD9)} flag=${fl9?.kind}`)
  await restWrite('dispatch_trip_od', 'DELETE', `plan_id=eq.${P2?.id}&od_number=eq.${OD9}`).catch(() => {})
  await restWrite('khvc_lines', 'POST', null, { id: crypto.randomUUID(), group_code: `${PREFIX}99`, do_no: OD9, warehouse_code: FIX.WH_QR.code, export_date: LATE, source: 'EXCEL', sync_status: 'ACTIVE', updated_at: nowIso() })
  const bl = await api(`/tms/dispatch/plans/${P2?.id}/backlog`)
  const bl9 = (bl.j?.data?.excluded ?? []).find(x => x.od_number === OD9)
  check('10p5. GET /backlog: OD tồn đọng ĐÃ Ở Kế hoạch xuất (không trong kế hoạch này) hiện với kind IN_PLAN + ngày giao + khách · OD trên xe (OD6) và OD đúng ngày (OD1) KHÔNG nằm trong đó',
    bl.s === 200 && bl9?.kind === 'IN_PLAN' && bl9?.d?.delivery_date === LATE && bl9?.d?.ship_to_name === 'QA61 NPP 1'
    && !(bl.j?.data?.excluded ?? []).some(x => x.od_number === OD6 || x.od_number === OD[0]),
    `http=${bl.s} ${bl.j?.error?.message ?? ''} od9=${JSON.stringify(bl9 ?? null)?.slice(0, 200)} n=${(bl.j?.data?.excluded ?? []).length}`)
  await restWrite('khvc_lines', 'DELETE', `group_code=eq.${PREFIX}99`).catch(() => {})
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=eq.${OD9}`).catch(() => {})
  // 29/09: OD HOÃN tới một ngày cũng chịu cửa sổ tồn đọng 14 ngày — hẹn ngày đã qua > 14 ngày là lịch sử (bản cũ kéo 4 OD
  // hẹn 30/09/2026 của Ba Vì vào cả kế hoạch thử nghiệm 16/03/2027 này). Hẹn trong cửa sổ thì vẫn quay lại đợt ghép.
  const OLD_DD = '2027-02-01', OD_H1 = 'QA61ODH1', OD_H2 = 'QA61ODH2'
  for (const [od, ship] of [[OD_H1, SHIP[0]], [OD_H2, SHIP[1]]]) await restWrite('erp_outbound_orders', 'POST', null, {
    id: crypto.randomUUID(), od_number: od, od_item: '10', material_code: FIX.MAT_POOL, qty_base: perPallet,
    ship_to_code: ship, ship_to_name: 'QA61 NPP', ward_code: W1, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: OLD_DD, flow: 'SALE',
    source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
  })
  await cleanupTrips()   // bỏ kế hoạch P2 (OD6/OD7 về sổ) — dấu hoãn QA ghi SAU vì cleanupTrips xoá dấu QA61*
  await restWrite('dispatch_od_hold', 'POST', null, { id: crypto.randomUUID(), warehouse_id: WH, od_number: OD_H1, hold_until: '2027-02-20', reason: 'QA61 hẹn quá 14 ngày', created_by: 'QA61', updated_at: nowIso() })
  await restWrite('dispatch_od_hold', 'POST', null, { id: crypto.randomUUID(), warehouse_id: WH, od_number: OD_H2, hold_until: '2027-03-10', reason: 'QA61 hẹn trong cửa sổ', created_by: 'QA61', updated_at: nowIso() })
  const pl3 = await mkPlan(PLAN_BODY)
  const P3 = pl3.j?.data
  check('10p3. OD ngày giao ngoài cửa sổ: hẹn 20/02 (quá 14 ngày trước ngày lập) ⇒ KHÔNG vào kế hoạch · hẹn 10/03 (trong cửa sổ) ⇒ quay lại đợt ghép (lên xe / khung chờ)',
    pl3.s === 201 && !rowOf(P3, OD_H1) && !!rowOf(P3, OD_H2),
    `http=${pl3.s} ${pl3.j?.error?.message ?? ''} h1=${!!rowOf(P3, OD_H1)} h2=${!!rowOf(P3, OD_H2)}`)
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=in.(${OD_H1},${OD_H2})`).catch(() => {})

  // ── [11] SỐ KHÁCH TRÊN MỘT XE THEO DÒNG XE + MỞ LẠI (29/09 — user: "bỏ loại xe, chọn dòng xe luôn") ────────────
  // Không còn kiểu đi Pallet / Xá. "Xe pallet chỉ một khách" = `max_drops = 1` khai ở CHÍNH dòng xe (Cài đặt TMS → Mã dòng xe);
  // hai khách cùng phường được vào cùng một dòng xe thì ghép hay không do trần đó quyết.
  await cleanupTrips()
  await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[0]}`, { mat_doc: null, updated_at: nowIso() })
  const cust1 = (await restAll('Customer', `select=id,dispatch_separate&ship_to_code=eq.${SHIP[0]}`))[0]
  const cOld = await api(`/masterdata/customers/${cust1.id}`, 'PUT', { load_mode: 'PALLET', load_mode_by_category: { [MAT_CAT]: 'PALLET' } })
  const cOldRow = (await restAll('Customer', `select=load_mode,load_mode_by_category&id=eq.${cust1.id}`))[0]
  const bOld = await api('/masterdata/customers/bulk', 'PATCH', { ids: [cust1.id], patch: { load_mode: 'PALLET' } })
  check('11a. Kiểu đi Pallet / Xá KHÔNG còn là cấu hình: form gửi load_mode bị bỏ qua (200, cột giữ mặc định) · hàng loạt → 400 nêu tên trường',
    cOld.s === 200 && cOldRow?.load_mode === 'LOOSE' && !Object.keys(cOldRow?.load_mode_by_category ?? {}).length && bOld.s === 400 && /load_mode/.test(bOld.j?.error?.message ?? ''),
    `put=${cOld.s} row=${JSON.stringify(cOldRow)} bulk=${bOld.s} ${bOld.j?.error?.message ?? ''}`)
  const d1 = await api(`/tms/vehicle-models/${vmId}`, 'PUT', { max_drops: 1 })
  const p11 = await mkPlan(PLAN_BODY)
  const P11 = p11.j?.data
  check('11b. Dòng xe QA khai max_drops = 1 ⇒ OD1 và OD2 (cùng phường, khác khách, cùng dòng xe) đi HAI xe, mỗi xe một khách',
    d1.s === 200 && p11.s === 201 && !!tripOfOd(P11, OD[0]) && !!tripOfOd(P11, OD[1]) && tripOfOd(P11, OD[0])?.id !== tripOfOd(P11, OD[1])?.id
    && (P11?.trips ?? []).every(t => new Set(t.ods.map(o => o.ship_to_code)).size <= 1),
    `drops=${d1.s} http=${p11.s} ${p11.j?.error?.message ?? ''} trips=${(P11?.trips ?? []).map(t => [...new Set(t.ods.map(o => o.ship_to_code))].join('+')).join(' ')}`)
  const X11 = tripOfOd(P11, OD[0])
  const mv11 = await api(`/tms/dispatch/plans/${P11.id}/move`, 'POST', { ids: [rowOf(P11, OD[1]).id], to: 'trip', to_trip_id: X11.id })
  const X11b = mv11.j?.data?.trips?.find(t => t.id === X11.id)
  check('11c. Người kéo khách thứ hai lên xe có dòng xe max_drops = 1 ⇒ cho thả nhưng xe cảnh báo "Vượt số khách cùng xe (2 > 1)"',
    mv11.s === 200 && X11b?.ods?.length === 2 && /Vượt số khách cùng xe \(2 > 1\)/.test((X11b?.detail?.warnings ?? []).join(' ')),
    `http=${mv11.s} ${mv11.j?.error?.message ?? ''} warn=${(X11b?.detail?.warnings ?? []).join(' | ').slice(0, 140)}`)
  const oldMode = await api(`/tms/dispatch/plans/${P11.id}/ods`, 'PATCH', { ids: [rowOf(P11, OD[0]).id], load_mode: 'LOOSE' })
  const oldFlip = await api(`/tms/dispatch/trips/${X11.id}`, 'PATCH', { load_mode: 'LOOSE' })
  check('11d. Cửa đổi kiểu đi cũ: route /ods không còn (404) · PATCH xe với load_mode không đổi gì (200, không 5xx)',
    oldMode.s === 404 && oldFlip.s === 200 && !oldFlip.j?.data?.load_mode, `ods=${oldMode.s} trip=${oldFlip.s} mode=${oldFlip.j?.data?.load_mode ?? 'null'}`)
  await cleanupTrips()
  // 02/10 (user: "dòng xe muốn được ghép phải khai, không khai thì cảnh báo"): gỡ max_drops ⇒ dòng xe CHƯA KHAI = 1 ⇒ vẫn hai xe, và
  // config_gaps.no_drops nêu tên dòng xe; khai lại 3 ⇒ chung xe
  const dNull = await api(`/tms/vehicle-models/${vmId}`, 'PUT', { max_drops: null })
  const p11e = await mkPlan(PLAN_BODY)
  const gaps11 = p11e.j?.data?.params?.config_gaps?.no_drops
  await cleanupTrips()
  const d3 = await api(`/tms/vehicle-models/${vmId}`, 'PUT', { max_drops: 3 })
  const p11e2 = await mkPlan(PLAN_BODY)
  check('11e. Gỡ max_drops của dòng xe ⇒ CHƯA KHAI = 1: OD1 và OD2 vẫn HAI xe + Khai thiếu nêu tên dòng xe · khai lại 3 ⇒ chung MỘT xe (7/9 pallet)',
    dNull.s === 200 && p11e.s === 201 && tripOfOd(p11e.j?.data, OD[0])?.id !== tripOfOd(p11e.j?.data, OD[1])?.id && (gaps11?.models ?? []).includes('QA61 Xe 9 Pallet')
    && d3.s === 200 && p11e2.s === 201 && tripOfOd(p11e2.j?.data, OD[0])?.id === tripOfOd(p11e2.j?.data, OD[1])?.id && !(p11e2.j?.data?.params?.config_gaps?.no_drops?.models ?? []).includes('QA61 Xe 9 Pallet'),
    `drops=${dNull.s} http=${p11e.s} trips=${(p11e.j?.data?.trips ?? []).map(t => t.ods.map(o => o.od_number).join('+')).join(' | ')} gaps=${JSON.stringify(gaps11)} re=${d3.s}/${p11e2.s} same=${tripOfOd(p11e2.j?.data, OD[0])?.id === tripOfOd(p11e2.j?.data, OD[1])?.id}`)
  const ro11 = await api(`/tms/dispatch/plans/${p11e2.j?.data?.id}/reopen`, 'POST', {})   // p11e đã bị cleanupTrips dọn ở [11e]
  check('11f. Mở lại khi chưa xe nào vào Kế hoạch xuất → 422 NOTHING_TO_REOPEN', ro11.s === 422 && ro11.j?.error?.code === 'NOTHING_TO_REOPEN', `http=${ro11.s} code=${ro11.j?.error?.code}`)

  // Mở lại: xác nhận ⇒ mở lại ⇒ dòng Kế hoạch xuất gỡ, xe về nháp, chuyến bên Xuất GIỮ id ⇒ xác nhận lại ⇒ cùng Số xe sống lại
  await cleanupTrips()
  await api(`/tms/transport-companies/${HA.id}`, 'PUT', { tender_required: false })
  const pR = await mkPlan(PLAN_BODY)
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
  // DO TẠO LẠI – ĐÃ ĐIỀU (user chốt 28/09): SO sửa ⇒ OD mới thay OD đã nằm Kế hoạch xuất ⇒ OD mới KHÔNG vào đợt ghép, sang tab Đã điều
  const khR = (await restAll('khvc_lines', `select=do_no,group_code&group_code=like.${PREFIX}*&order=do_no`))[0]
  const ODR = 'QA61ODR1'
  if (khR) {
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${khR.do_no}`, { sync_status: 'OBSOLETE', replaced_by_od: ODR, replaced_at: nowIso(), updated_at: nowIso() })
    await restWrite('erp_outbound_orders', 'POST', null, {
      id: crypto.randomUUID(), od_number: ODR, od_item: '10', material_code: FIX.MAT_POOL, qty_base: 2 * perPallet,
      ship_to_code: SHIP[2], ship_to_name: 'QA61 NPP 3', ward_code: W2, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY, flow: 'SALE',
      source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
    })
  }
  const pRd = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
  const exR = (pRd.j?.data?.params?.excluded ?? []).find(x => x.od_number === ODR)
  check('11i. OD mới thay OD ĐÃ lên xe → không vào khung chờ, params.excluded kind REDO_DISPATCHED nêu OD cũ + Số xe (tab Đã điều "DO tạo lại – đã điều")',
    !!khR && pRd.s === 201 && exR?.kind === 'REDO_DISPATCHED' && (exR?.info ?? '').includes(khR.do_no) && (exR?.info ?? '').includes(khR.group_code) && !rowOf(pRd.j?.data, ODR),
    `kh=${JSON.stringify(khR ?? null)} http=${pRd.s} ${pRd.j?.error?.message ?? ''} ex=${JSON.stringify(exR ?? null)} inPool=${!!rowOf(pRd.j?.data, ODR)}`)
  if (khR) await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${khR.do_no}`, { sync_status: 'ACTIVE', replaced_by_od: null, replaced_at: null, updated_at: nowIso() })
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=eq.${ODR}`).catch(() => {})

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
  // Loại kho + mã hàng RIÊNG của gói (01/10 — xem chú thích ở CAT2): qua cửa app để Loại kho có dòng gán kho như loại thật
  const mkCat2 = await api('/wms/lookup', 'POST', { type: 'warehouse_type', value: CAT2, meta: CAT2_META0 })
  cat2Row = (await restAll('LookupValue', `select=id,value,meta&type=eq.warehouse_type&value=eq.${CAT2}`))[0] ?? null
  const mkMat2 = await api('/masterdata/materials', 'POST', { material_code: MAT2, material_description: 'QA61 hàng Loại kho 2', category: CAT2, base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 12, cartons_per_pallet: 40 })
  mat2 = (await restAll('Material', `select=material_code,category,units_per_carton,cartons_per_pallet&material_code=eq.${MAT2}`))[0] ?? null
  // meta Loại kho (ĐK bảo quản) nhớ 30 s mỗi instance — loại vừa tạo mà lập ngay thì instance khác coi là "chưa khai ĐK" ([12b2] đỏ oan 01/10)
  await new Promise(r => setTimeout(r, 31_000))
  if (!mat2 || !cat2Row || mat2.category !== CAT2) check('12b. Fixture: Loại kho + mã hàng riêng của gói dựng được qua cửa app', false, `cat=${mkCat2.s} ${mkCat2.j?.error?.message ?? ''} mat=${mkMat2.s} ${mkMat2.j?.error?.message ?? ''} mat2=${JSON.stringify(mat2)}`)
  else {
    const OD8 = 'QA61OD8'
    await restWrite('erp_outbound_orders', 'POST', null, {
      id: crypto.randomUUID(), od_number: OD8, od_item: '10', material_code: mat2.material_code, qty_base: Number(mat2.units_per_carton) * Number(mat2.cartons_per_pallet),
      ship_to_code: SHIP[0], ship_to_name: 'QA61 NPP 1', ward_code: W1, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY, flow: 'SALE',
      source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
    })
    const rowOfP = (pl, od) => [...(pl?.trips ?? []).flatMap(t => t.ods), ...(pl?.pool ?? [])].find(o => o.od_number === od)
    const pOff = await mkPlan(PLAN_BODY)
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
    const pOn = await mkPlan({ ...PLAN_BODY, allow_mix_categories: true })
    check('12c. Lượt lập BẬT cho trộn ⇒ OD hai Loại kho gom MỘT chuyến (xe QA phục vụ mọi điều kiện, còn chỗ)',
      pOn.s === 201 && tripOfOd(pOn.j?.data, OD[0])?.id === tripOfOd(pOn.j?.data, OD8)?.id,
      `http=${pOn.s} trips=${(pOn.j?.data?.trips ?? []).map(t => t.ods.map(o => o.od_number).join('+')).join(' | ')}`)
    // (29/09: [12f–12h] "kiểu đi theo Khách × Loại kho" bỏ theo luật 7 — kiểm ở [11a]; kho cho trộn ⇒ hai loại chung xe là [12c])

    // [14] SWITCH "Ghép Loại kho khác" trên TỪNG thẻ xe (user 27/09: "TẮT = chặn thả")
    await cleanupTrips()
    const pX = await mkPlan(PLAN_BODY)
    const PX = pX.j?.data
    const tA = tripOfOd(PX, OD[0]), tB = tripOfOd(PX, OD8)
    const r8x = rowOfP(PX, OD8)
    if (pX.s !== 201 || !tA || !tB || tA.id === tB.id || !r8x) check('14. Fixture: kế hoạch kho không cho trộn phải có hai xe riêng cho hai Loại kho', false, `http=${pX.s} trips=${(PX?.trips ?? []).map(t => t.ods.map(o => o.od_number).join('+')).join(' | ')}`)
    else {
      const pv = await api(`/tms/dispatch/plans/${PX.id}/preview-move`, 'POST', { ids: [r8x.id], to_trip_id: tA.id })
      const mvNo = await api(`/tms/dispatch/plans/${PX.id}/move`, 'POST', { ids: [r8x.id], to: 'trip', to_trip_id: tA.id })
      const still = tripOfOd(await planOf(PX.id), OD8)
      check(`14a. Switch xe ${MAT_CAT} TẮT (theo kho) ⇒ rê OD ${CAT2} qua: xem trước báo "không nhận" · thả → 409 CATEGORY_MIX_BLOCKED nêu cách bật · OD ở nguyên xe cũ`,
        pv.s === 200 && !!pv.j?.data?.blocked && mvNo.s === 409 && mvNo.j?.error?.code === 'CATEGORY_MIX_BLOCKED' && /Ghép Loại kho khác/.test(mvNo.j?.error?.message ?? '') && still?.id === tB.id,
        `pv=${pv.s} blocked=${String(pv.j?.data?.blocked ?? '').slice(0, 60)} mv=${mvNo.s} ${mvNo.j?.error?.code} still=${still?.group_code}`)
      const on = await api(`/tms/dispatch/trips/${tA.id}`, 'PATCH', { allow_mix_categories: true })
      const mvOk = await api(`/tms/dispatch/plans/${PX.id}/move`, 'POST', { ids: [r8x.id], to: 'trip', to_trip_id: tA.id })
      const tAnow = (await planOf(PX.id))?.trips?.find(t => t.id === tA.id)
      check('14b. Bật switch trên thẻ xe → 200 · thả lại → 200, xe chở cả hai loại, KHÔNG cảnh báo chở lẫn',
        on.s === 200 && tAnow?.allow_mix_categories === true && mvOk.s === 200 && (tAnow?.ods ?? []).some(o => o.od_number === OD8) && !/chở lẫn/.test((tAnow?.detail?.warnings ?? []).join(' ')),
        `on=${on.s} col=${tAnow?.allow_mix_categories} mv=${mvOk.s} ${mvOk.j?.error?.message ?? ''} warn=${(tAnow?.detail?.warnings ?? []).join(' | ').slice(0, 120)}`)
      const off = await api(`/tms/dispatch/trips/${tA.id}`, 'PATCH', { allow_mix_categories: false })
      const tOff = (await planOf(PX.id))?.trips?.find(t => t.id === tA.id)
      const bad = await api(`/tms/dispatch/trips/${tA.id}`, 'PATCH', { allow_mix_categories: 'yes' })
      check('14c. Tắt lại khi xe ĐANG chở lẫn ⇒ không đẩy OD ra, xe cảnh báo "switch … đang tắt" · giá trị không phải boolean → 400',
        off.s === 200 && tOff?.allow_mix_categories === false && (tOff?.ods ?? []).some(o => o.od_number === OD8) && /đang tắt/.test((tOff?.detail?.warnings ?? []).join(' ')) && bad.s === 400,
        `off=${off.s} warn=${(tOff?.detail?.warnings ?? []).join(' | ').slice(0, 120)} bad=${bad.s}`)
    }

    // ⚠ Đặt SAU phần kiểu đi: meta Loại kho được nhớ 30 s mỗi instance (getWhTypeMetaMap) — bật "đi kèm" cho loại 2 trước
    // thì các lượt lập kế hoạch ngay sau đó vẫn coi loại 2 là đi kèm (đo 26/09: 12g đỏ oan vì thế).

    // POSM "đi theo đơn": bật cờ đi kèm cho Loại kho 2 qua CỬA APP (bộ lọc meta phải giữ khoá mới) ⇒ kho không cho trộn vẫn đi chung
    await cleanupTrips()
    const fl = await api(`/wms/lookup/${cat2Row.id}`, 'PUT', { value: cat2Row.value, meta: { ...CAT2_META0, dispatch_follow: true } })
    const cat2Now = (await restAll('LookupValue', `select=meta&id=eq.${cat2Row.id}`))[0]
    check('12d. Loại kho "Đi kèm đơn khi điều vận" → 200 và meta GIỮ khoá mới + cờ cũ (bộ lọc meta vứt khoá lạ nếu quên khai)',
      fl.s === 200 && cat2Now?.meta?.dispatch_follow === true && cat2Now?.meta?.badge_color === CAT2_META0?.badge_color,
      `http=${fl.s} meta=${JSON.stringify(cat2Now?.meta ?? null)}`)
    // cấu hình Loại kho nhớ 30 s / instance (warehouseTypeMeta) — lời gọi lập rơi vào instance KHÁC thì còn đọc cờ cũ ⇒ đỏ oan
    // (check-app 27/09: lượt thứ hai liền nhau đỏ [12e], lượt đầu xanh). Chờ hết hạn nhớ rồi mới đo.
    await new Promise(r => setTimeout(r, 31_000))
    const pF = await mkPlan(PLAN_BODY)
    check('12e. Loại kho đi kèm ⇒ kho KHÔNG cho trộn mà OD loại đó vẫn ké vào chuyến của chính khách (không đẻ chuyến riêng)',
      pF.s === 201 && pF.j?.data?.params?.allow_mix_categories === false && tripOfOd(pF.j?.data, OD[0])?.id === tripOfOd(pF.j?.data, OD8)?.id,
      `http=${pF.s} trips=${(pF.j?.data?.trips ?? []).map(t => t.ods.map(o => o.od_number).join('+')).join(' | ')}`)
    await api(`/wms/lookup/${cat2Row.id}`, 'PUT', { value: cat2Row.value, meta: CAT2_META0 })
    // [12f] (01/10) Cờ "đi kèm" đã TẮT ngoài danh mục nhưng kế hoạch ĐANG MỞ giữ bản chụp: Tối ưu lại phải nạp OD theo bản chụp
    // (cùng nguồn với máy ghép) — bản lỗi nạp theo cờ SỐNG ⇒ OD loại 2 thành loại chính, kho không trộn ⇒ tách xe, và danh sách
    // dòng xe của OD chụp lại theo Loại kho chính thay vì "*" (chính ca Blue Star mất Xe 4/6 pallet). Chờ hết 30 s nhớ meta.
    if (pF.s === 201 && pF.j?.data?.id) {
      await new Promise(r => setTimeout(r, 31_000))
      const a8 = JSON.stringify(rowOfP(pF.j.data, OD8)?.allowed_models ?? null)
      const re = await api(`/tms/dispatch/plans/${pF.j.data.id}/reoptimize`, 'POST', { review_all: true })
      const PR = re.j?.data
      check('12f. Tắt cờ đi kèm rồi Tối ưu lại kế hoạch đang mở ⇒ vẫn theo BẢN CHỤP của kế hoạch: OD loại 2 vẫn ké xe khách, danh sách dòng xe của OD không đổi',
        re.s === 200 && PR?.params?.follow_categories?.includes(CAT2) && tripOfOd(PR, OD[0])?.id === tripOfOd(PR, OD8)?.id && JSON.stringify(rowOfP(PR, OD8)?.allowed_models ?? null) === a8,
        `http=${re.s} ${re.j?.error?.message ?? ''} follow=${JSON.stringify(PR?.params?.follow_categories ?? null)} trips=${(PR?.trips ?? []).map(t => t.ods.map(o => o.od_number).join('+')).join(' | ')} allowed ${a8} → ${JSON.stringify(rowOfP(PR, OD8)?.allowed_models ?? null)}`)
      // [12g] (01/10) Tab Bản đồ: toạ độ khách của kế hoạch — chỉ đọc Customer.geo_*, khách chưa định vị vẫn có mặt (lat null)
      const geo = await api(`/tms/dispatch/plans/${pF.j.data.id}/geo`)
      const gc = geo.j?.data?.customers ?? []
      check('12g. GET /plans/:id/geo → 200, có đủ khách của kế hoạch kể cả khách chưa định vị (lat null) · có khối kho + measure · id rác → 400',
        geo.s === 200 && gc.some(c => c.ship_to_code === SHIP[0]) && gc.every(c => 'geo_lat' in c) && 'warehouse' in (geo.j?.data ?? {}) && typeof geo.j?.data?.measure?.pending === 'number'
          && (await api('/tms/dispatch/plans/undefined/geo')).s === 400,
        `http=${geo.s} n=${gc.length} ships=${gc.map(c => c.ship_to_code).join(',')} wh=${JSON.stringify(geo.j?.data?.warehouse ?? null).slice(0, 80)}`)
      // [12i] (02/10) Bản đồ theo KHÁCH HÀNG: hạng pallet SAP trong kênh của kho × N ngày — RPC trả dòng; days lạ → 400; kho rác → 400
      {
        // RPC gom cả plant thật (Ba Vì ~16k dòng ZSD02) — staging NANO lúc bận trả 503 QUERY_TIMEOUT (quá tải, không phải hỏng): thử lại MỘT lần sau 4 s (như [17h])
        let cm = await api(`/tms/dispatch/customers-map?warehouse_id=${WH}&days=30`)
        if (cm.s === 503) { await new Promise(r => setTimeout(r, 4000)); cm = await api(`/tms/dispatch/customers-map?warehouse_id=${WH}&days=30`) }
        const rows = cm.j?.data?.rows ?? []
        const okRank = rows.every(r => typeof r.ship_to_code === 'string' && typeof r.pallets === 'number' && Number.isInteger(r.rank_in_channel) && r.rank_in_channel >= 1 && 'geo_lat' in r)
        // hạng 1 của mỗi kênh có pallet ≥ mọi khách khác cùng kênh
        const byCh = new Map()
        for (const r of rows) { const k = r.channel ?? '—'; const l = byCh.get(k) ?? []; l.push(r); byCh.set(k, l) }
        const okTop = [...byCh.values()].every(l => { const top = l.find(r => r.rank_in_channel === 1); return top && l.every(r => r.pallets <= top.pallets) })
        // id kho đi trên QUERY (không phải :param) nên lưới id-rác của app.ts không chạm; zId nhận text (48/82 bảng khoá TEXT) ⇒ kho lạ = 404
        const d5 = await api(`/tms/dispatch/customers-map?warehouse_id=${WH}&days=5`)
        const whBad = await api('/tms/dispatch/customers-map?warehouse_id=undefined&days=30')
        check('12i. GET /dispatch/customers-map → 200 có warehouse/from/to/rows, mỗi dòng có hạng trong kênh ≥ 1 + toạ độ, hạng 1 là pallet lớn nhất của kênh · days=5 → 400 · kho lạ → 404',
          cm.s === 200 && typeof cm.j?.data?.from === 'string' && Array.isArray(rows) && okRank && okTop && d5.s === 400 && whBad.s === 404,
          `http=${cm.s} n=${rows.length} from=${cm.j?.data?.from} kênh=${[...byCh.keys()].join(',')} okRank=${okRank} okTop=${okTop} days5=${d5.s} whBad=${whBad.s}`)
      }
      // [12h] (02/10) Ghim KHO + đo km: kho fixture là Ba Vì THẬT ⇒ đọc ghim gốc, chấm thử, trả lại. Đo km: chưa có khoá Goong trên
      // staging ⇒ 422 GEO_NOT_CONFIGURED (có khoá ⇒ 200 với counts) — kho chưa ghim ⇒ 422 WAREHOUSE_NOT_LOCATED.
      const wh0 = (await restAll('Warehouse', `select=geo_lat,geo_lng,geo_source,geo_accuracy_m&id=eq.${WH}`))[0] ?? {}
      try {
        const clr = await api(`/masterdata/warehouses/${WH}/location`, 'PATCH', { lat: null, lng: null })
        const mNoWh = await api(`/tms/dispatch/plans/${pF.j.data.id}/geo/measure`, 'POST', {})
        // (02/10) máy định vị kho từ địa chỉ: ghim trống ⇒ 200 nguồn GOONG/OSM, hoặc 422 (máy tắt / không thấy) — không 5xx
        const gw = await api(`/masterdata/warehouses/${WH}/geocode`, 'POST', {})
        const setWh = await api(`/masterdata/warehouses/${WH}/location`, 'PATCH', { lat: 21.1958, lng: 105.3936, source: 'MANUAL' })
        const whNow = (await restAll('Warehouse', `select=geo_lat,geo_lng,geo_source&id=eq.${WH}`))[0]
        const gw2 = await api(`/masterdata/warehouses/${WH}/geocode`, 'POST', {})   // đã có ghim NGƯỜI ⇒ máy không đè: 409
        const geo2 = await api(`/tms/dispatch/plans/${pF.j.data.id}/geo`)
        // max_calls 1: ghim kho ở đây là toạ độ GIẢ ⇒ mọi cặp đo ra không bao giờ dùng; không giới hạn thì mỗi lượt CI đốt ~30 lượt Goong (user hỏi phí 02/10)
        const m = await api(`/tms/dispatch/plans/${pF.j.data.id}/geo/measure`, 'POST', { max_calls: 1 })
        const bad = await api(`/masterdata/warehouses/${WH}/location`, 'PATCH', { lat: 91, lng: 0, source: 'MANUAL' })
        check('12h. Ghim kho: xoá → đo km 422 WAREHOUSE_NOT_LOCATED · máy định vị kho 200 (GOONG/OSM) hoặc 422 · chấm MANUAL → 200, cột lưu, /geo trả toạ độ kho · máy không đè ghim người 409 · đo km → 422 chưa cấu hình hoặc 200 · lat 91 → 400',
          clr.s === 200 && mNoWh.s === 422 && mNoWh.j?.error?.code === 'WAREHOUSE_NOT_LOCATED'
            && ((gw.s === 200 && ['GOONG', 'OSM'].includes(gw.j?.data?.geo_source)) || gw.s === 422)
            && setWh.s === 200 && Number(whNow?.geo_lat) === 21.1958 && whNow?.geo_source === 'MANUAL' && Number(geo2.j?.data?.warehouse?.geo_lat) === 21.1958
            && gw2.s === 409 && gw2.j?.error?.code === 'HUMAN_PIN'
            && ((m.s === 422 && m.j?.error?.code === 'GEO_NOT_CONFIGURED') || (m.s === 200 && typeof m.j?.data?.measured === 'number')) && bad.s === 400,
          `clr=${clr.s} noWh=${mNoWh.s}/${mNoWh.j?.error?.code} gw=${gw.s}/${gw.j?.data?.geo_source ?? gw.j?.error?.code} set=${setWh.s} col=${JSON.stringify(whNow)} gw2=${gw2.s}/${gw2.j?.error?.code} geoWh=${geo2.j?.data?.warehouse?.geo_lat} measure=${m.s}/${m.j?.error?.code ?? 'ok'} bad=${bad.s}`)
      } finally {
        await restWrite('Warehouse', 'PATCH', `id=eq.${WH}`, { geo_lat: wh0.geo_lat ?? null, geo_lng: wh0.geo_lng ?? null, geo_source: wh0.geo_source ?? null, geo_accuracy_m: wh0.geo_accuracy_m ?? null }).catch(() => {})
      }
    }
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
    // oracle (ĐẢO 27/09, user: "vị trí lấy ĐK bảo quản là để phục vụ cho WMS"): OD chỉ mang ĐK của LOẠI KHO của mã, ô khai
    // riêng không đi vào điều vận — kể cả ô đang chứa đúng mã đó
    const catMeta = m9?.category ? (await restAll('LookupValue', `select=meta&type=eq.warehouse_type&value=eq.${encodeURIComponent(m9.category)}`))[0]?.meta : null
    const expected = catMeta?.storage_condition && !catMeta?.dispatch_follow ? [catMeta.storage_condition] : []
    const OD9 = 'QA61OD9'
    await restWrite('erp_outbound_orders', 'POST', null, {
      id: crypto.randomUUID(), od_number: OD9, od_item: '10', material_code: m9.material_code, qty_base: Math.max(1, Number(m9.units_per_carton) || 1),
      ship_to_code: SHIP[2], ship_to_name: 'QA61 NPP 3', ward_code: W2, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY, flow: 'SALE', sap_pallets: 1,
      source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
    })
    const pL = await mkPlan(PLAN_BODY)
    const r9 = [...(pL.j?.data?.trips ?? []).flatMap(t => t.ods), ...(pL.j?.data?.pool ?? [])].find(o => o.od_number === OD9)
    check('12j. OD của mã đang nằm ở ô khai ĐK riêng chỉ mang ĐK của LOẠI KHO (ĐK vị trí là của WMS, không đi vào điều vận)',
      pL.s === 201 && !!r9 && JSON.stringify([...(r9.conditions ?? [])].sort()) === JSON.stringify(expected) && !(r9.conditions ?? []).includes(COND_LOC),
      `http=${pL.s} ${pL.j?.error?.message ?? ''} got=${JSON.stringify(r9?.conditions)} expected=${JSON.stringify(expected)}`)
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
      const pS = await mkPlan(PLAN_BODY)
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

  // ── [13] DÒNG XE ĐƯỢC VÀO theo Kênh → Khách × Loại kho (user 27/09: "khách hàng nào vào được dòng xe nào — multi check box";
  // thay "tải trọng xe tối đa" tự suy theo tấn của 26/09) ──────────────────────────────────────────────────────────────
  await cleanupTrips()
  // QA61OD10 (mã loại khác của [12j2]) cũng phải đi — sót nó thì xe QA chở hai Loại kho và [13c] vướng switch ghép loại
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=in.(QA61OD8,QA61OD9,QA61OD10)`).catch(() => {})
  {
    const c1 = (await restAll('Customer', `select=id&ship_to_code=eq.${SHIP[0]}`))[0]
    const vms = (await api('/tms/vehicle-models')).j?.data?.items ?? []
    const palParents = new Set((await restAll('VehicleType', 'select=id&is_pallet_truck=eq.true')).map(v => v.id))
    // dòng xe thật đúng họ pallet, đủ chở OD1 (4 pallet) — KHÁC xe QA (xe QA có cước rẻ nên không khai thì máy chọn xe QA)
    const pick = vms.filter(m => m.is_active && palParents.has(m.parent_type_id) && m.sap_code !== SAP && Number(m.max_pallets) >= 7).sort((x, y) => Number(x.max_pallets) - Number(y.max_pallets))[0]
    const other = vms.find(m => m.is_active && m.id !== pick?.id && m.sap_code !== SAP)
    const bad1 = await api(`/masterdata/customers/${c1.id}`, 'PUT', { dispatch_vehicles: { KHONGCOLOAI: [pick?.id] } })
    const bad2 = await api(`/masterdata/customers/${c1.id}`, 'PUT', { dispatch_vehicles: { '*': ['khong-co-that'] } })
    const bad3 = await api(`/masterdata/customers/${c1.id}`, 'PUT', { dispatch_vehicles: { '*': 'abc' } })
    const okV = await api(`/masterdata/customers/${c1.id}`, 'PUT', { dispatch_vehicles: { '*': [pick?.id] } })
    check('13a. Khách hàng: dòng xe được vào — Loại kho lạ / dòng xe không có thật / không phải mảng → 400 · hợp lệ → 200 và lưu đúng',
      !!pick && bad1.s === 400 && bad2.s === 400 && bad3.s === 400 && okV.s === 200 && JSON.stringify(okV.j?.data?.dispatch_vehicles) === JSON.stringify({ '*': [pick.id] }),
      `pick=${pick?.name} bad=${bad1.s},${bad2.s},${bad3.s} ok=${okV.s} map=${JSON.stringify(okV.j?.data?.dispatch_vehicles ?? okV.j?.error)}`)
    const pV = await mkPlan(PLAN_BODY)
    const PV = pV.j?.data
    const tV = tripOfOd(PV, OD[0])
    check('13b. Khách chỉ được vào MỘT dòng xe ⇒ OD lên đúng dòng xe đó (không lên xe QA rẻ hơn) · dòng OD chụp danh sách',
      pV.s === 201 && tV?.vehicle_model_id === pick?.id && JSON.stringify(rowOf(PV, OD[0])?.allowed_models) === JSON.stringify([pick?.id]),
      `http=${pV.s} ${pV.j?.error?.message ?? ''} vm=${tV?.detail?.vehicle_model?.name} snap=${JSON.stringify(rowOf(PV, OD[0])?.allowed_models)}`)
    // Người tự đổi xe của khách sang dòng xe không được vào (xe QA) ⇒ không chặn (nháp) nhưng xe cảnh báo nêu khách
    if (tV) {
      const ch = await api(`/tms/dispatch/trips/${tV.id}`, 'PATCH', { vehicle_model_id: vmId })
      const qNow = (await planOf(PV.id))?.trips?.find(t => t.id === tV.id)
      check('13c. Người đổi xe của khách sang dòng xe không được vào ⇒ cho đổi, xe cảnh báo "không được vào dòng xe"',
        ch.s === 200 && qNow?.vehicle_model_id === vmId && /không được vào dòng xe/.test((qNow?.detail?.warnings ?? []).join(' ')),
        `http=${ch.s} ${ch.j?.error?.message ?? ''} warn=${(qNow?.detail?.warnings ?? []).join(' | ').slice(0, 160)}`)
    } else check('13c. Fixture: OD1 phải có xe ở [13b]', false)
    // Hàng loạt: Thêm / Bớt / Về theo kênh gộp vào map từng khách, không đè khoá khác
    const bAdd = await api('/masterdata/customers/bulk', 'PATCH', { ids: [c1.id], patch: { dispatch_vehicles: { category: null, mode: 'ADD', vehicle_model_ids: [other?.id] } } })
    const m1 = (await restAll('Customer', `select=dispatch_vehicles&id=eq.${c1.id}`))[0]?.dispatch_vehicles ?? {}
    const bRm = await api('/masterdata/customers/bulk', 'PATCH', { ids: [c1.id], patch: { dispatch_vehicles: { category: null, mode: 'REMOVE', vehicle_model_ids: [pick?.id] } } })
    const m2 = (await restAll('Customer', `select=dispatch_vehicles&id=eq.${c1.id}`))[0]?.dispatch_vehicles ?? {}
    const bCat = await api('/masterdata/customers/bulk', 'PATCH', { ids: [c1.id], patch: { dispatch_vehicles: { category: MAT_CAT, mode: 'SET', vehicle_model_ids: [pick?.id] } } })
    const bClr = await api('/masterdata/customers/bulk', 'PATCH', { ids: [c1.id], patch: { dispatch_vehicles: { category: null, mode: 'CLEAR', vehicle_model_ids: [] } } })
    const m3 = (await restAll('Customer', `select=dispatch_vehicles&id=eq.${c1.id}`))[0]?.dispatch_vehicles ?? {}
    const bMix = await api('/masterdata/customers/bulk', 'PATCH', { ids: [c1.id], patch: { dispatch_vehicles: { category: null, mode: 'ADD', vehicle_model_ids: [other?.id] }, is_active: true } })
    const bEmpty = await api('/masterdata/customers/bulk', 'PATCH', { ids: [c1.id], patch: { dispatch_vehicles: { category: null, mode: 'ADD', vehicle_model_ids: [] } } })
    const setEq = (x, y) => JSON.stringify([...(x ?? [])].sort()) === JSON.stringify([...y].sort())
    check('13d. Hàng loạt dòng xe: Thêm → cả hai · Bớt → còn một · SET theo Loại kho không đụng "mọi loại" · Về theo kênh gỡ đúng khoá · đi chung thao tác khác / Thêm rỗng → 400',
      bAdd.s === 200 && setEq(m1['*'], [pick?.id, other?.id]) && bRm.s === 200 && setEq(m2['*'], [other?.id]) && bCat.s === 200 && bClr.s === 200
      && !('*' in m3) && setEq(m3[MAT_CAT], [pick?.id]) && bMix.s === 400 && bEmpty.s === 400,
      `add=${bAdd.s} ${JSON.stringify(m1)} rm=${bRm.s} ${JSON.stringify(m2)} cat=${bCat.s} clr=${bClr.s} ${JSON.stringify(m3)} mix=${bMix.s} empty=${bEmpty.s}`)
    // Kênh: mặc định theo kênh — chỉ đo cửa ghi + đọc lại rồi TRẢ NGAY (kênh là dữ liệu dùng chung của staging); thứ tự áp đo ở test engine
    const chs = (await api('/masterdata/customer-channels')).j?.data ?? []
    const ch = chs[0]
    if (ch) {
      const before = ch.dispatch_vehicles ?? {}
      const cBad = await api(`/masterdata/customer-channels/${ch.id}`, 'PUT', { dispatch_vehicles: { '*': ['khong-co-that'] } })
      const cOk = await api(`/masterdata/customer-channels/${ch.id}`, 'PUT', { dispatch_vehicles: { ...before, [MAT_CAT]: [pick?.id] } })
      const chNow = ((await api('/masterdata/customer-channels')).j?.data ?? []).find(x => x.id === ch.id)
      const cBack = await api(`/masterdata/customer-channels/${ch.id}`, 'PUT', { dispatch_vehicles: before })
      const chBack = ((await api('/masterdata/customer-channels')).j?.data ?? []).find(x => x.id === ch.id)
      check(`13e. Kênh ${ch.value}: dòng xe mặc định — id lạ → 400 · lưu → danh sách kênh trả lại đúng · trả về như cũ`,
        cBad.s === 400 && cOk.s === 200 && setEq(chNow?.dispatch_vehicles?.[MAT_CAT], [pick?.id]) && cBack.s === 200 && JSON.stringify(chBack?.dispatch_vehicles ?? {}) === JSON.stringify(before),
        `bad=${cBad.s} ok=${cOk.s} now=${JSON.stringify(chNow?.dispatch_vehicles)} back=${cBack.s}`)
    } else check('13e. Fixture: cần ít nhất một Kênh khách hàng', false)
    // [13f] 28/09 (user: "dòng xe chọn theo khai báo của khách, khách không khai thì không chọn"): khách + kênh chưa khai ⇒ máy
    // KHÔNG chọn xe, OD nằm KHUNG CHỜ (không vào "không lên xe" — kẹt tới khi lập lại); khai xong ghép phần đã chọn ⇒ lên xe
    await cleanupTrips()
    await restWrite('Customer', 'PATCH', `id=eq.${c1.id}`, { dispatch_vehicles: {}, channel: null })
    const pN = await mkPlan(PLAN_BODY)
    const PN = pN.j?.data
    const rN = rowOf(PN, OD[0])
    check('13f. Khách + kênh CHƯA khai dòng xe ⇒ OD1 ở KHUNG CHỜ (không xe, không "không lên xe"), dòng OD chụp danh sách RỖNG · khách khác vẫn lên xe',
      pN.s === 201 && rN?.trip_id === null && JSON.stringify(rN?.allowed_models) === '[]' && !(PN?.unplanned ?? []).some(u => u.od_number === OD[0]) && !!tripOfOd(PN, OD[1]),
      `http=${pN.s} ${pN.j?.error?.message ?? ''} trip=${rN?.trip_id} snap=${JSON.stringify(rN?.allowed_models)} unpl=${JSON.stringify(PN?.unplanned ?? [])}`)
    const kv = await api(`/masterdata/customers/${c1.id}`, 'PUT', { dispatch_vehicles: { '*': [vmId] } })
    const gN = rN ? await api(`/tms/dispatch/plans/${PN.id}/reoptimize`, 'POST', { ids: [rN.id] }) : null
    const tN = tripOfOd(gN?.j?.data, OD[0])
    check('13g. Khai dòng xe cho khách rồi "Ghép phần đã chọn" ⇒ OD1 lên đúng dòng xe đã khai (không phải lập lại kế hoạch)',
      kv.s === 200 && gN?.s === 200 && tN?.vehicle_model_id === vmId,
      `put=${kv.s} reopt=${gN?.s} ${gN?.j?.error?.message ?? ''} vm=${tN?.vehicle_model_id}`)
    // [13h][13i] 28/09 (user: "không tự ép gì cả, config hết"): ĐI XE RIÊNG và SỐ KHÁCH TỐI ĐA CÙNG XE là cấu hình trên Khách / Kênh —
    // OD1 + OD2 cùng phường W1 (4 + 3 pallet ≤ 9) vốn đi CHUNG một xe ([1b]); bật ô nào là tách ra, tắt lại là chung
    await restWrite('Customer', 'PATCH', `id=eq.${c1.id}`, { dispatch_vehicles: ALLV, channel: null })
    const c2 = (await restAll('Customer', `select=id&ship_to_code=eq.${SHIP[1]}`))[0]
    const sepOn = await api(`/masterdata/customers/${c2.id}`, 'PUT', { dispatch_separate: true })
    await cleanupTrips()
    const pS = await mkPlan(PLAN_BODY); const PS = pS.j?.data
    const sepOff = await api(`/masterdata/customers/${c2.id}`, 'PUT', { dispatch_separate: false })
    await cleanupTrips()
    const pS2 = await mkPlan(PLAN_BODY); const PS2 = pS2.j?.data
    check('13h. "Đi xe riêng" bật cho khách 2 ⇒ OD1 và OD2 KHÔNG chung xe, dòng OD chụp separate=true · tắt lại ⇒ chung xe như [1b]',
      sepOn.s === 200 && sepOn.j?.data?.dispatch_separate === true && pS.s === 201 && !!tripOfOd(PS, OD[0]) && !!tripOfOd(PS, OD[1]) && tripOfOd(PS, OD[0]) !== tripOfOd(PS, OD[1])
      && rowOf(PS, OD[1])?.separate === true && rowOf(PS, OD[0])?.separate === false
      && sepOff.s === 200 && pS2.s === 201 && !!tripOfOd(PS2, OD[0]) && tripOfOd(PS2, OD[0]) === tripOfOd(PS2, OD[1]),
      `on=${sepOn.s} plan=${pS.s} ${pS.j?.error?.message ?? ''} t1=${tripOfOd(PS, OD[0])?.id?.slice(0, 6)} t2=${tripOfOd(PS, OD[1])?.id?.slice(0, 6)} sep=${rowOf(PS, OD[1])?.separate} off=${sepOff.s} plan2=${pS2.s} same=${tripOfOd(PS2, OD[0]) === tripOfOd(PS2, OD[1])}`)
    const mxBad1 = await api(`/masterdata/customers/${c2.id}`, 'PUT', { max_customers_per_trip: 'abc' })
    const mxBad2 = await api(`/masterdata/customers/${c2.id}`, 'PUT', { max_customers_per_trip: 99 })
    const mx1 = await api(`/masterdata/customers/${c2.id}`, 'PUT', { max_customers_per_trip: 1 })
    await cleanupTrips()
    const pM = await mkPlan(PLAN_BODY); const PM = pM.j?.data
    const tM2 = tripOfOd(PM, OD[1])
    // 02/10: hàng loạt về null = CHƯA KHAI = 1 (không còn "không giới hạn") ⇒ vẫn xe riêng + Khai thiếu đếm OD của khách không kênh; khai lại 3 ⇒ chung xe
    const mxClr = await api('/masterdata/customers/bulk', 'PATCH', { ids: [c2.id], patch: { max_customers_per_trip: null } })
    const c2Now = (await restAll('Customer', `select=max_customers_per_trip,dispatch_separate&id=eq.${c2.id}`))[0]
    await cleanupTrips()
    const pM2 = await mkPlan(PLAN_BODY); const PM2 = pM2.j?.data
    const mx3 = await api(`/masterdata/customers/${c2.id}`, 'PUT', { max_customers_per_trip: 3 })
    await cleanupTrips()
    const pM3 = await mkPlan(PLAN_BODY); const PM3 = pM3.j?.data
    check('13i. "Số khách tối đa cùng xe" = 1 cho khách 2 ⇒ OD2 đi xe một mình (chụp max_customers=1) · về null = CHƯA KHAI ⇒ vẫn xe riêng + Khai thiếu đếm OD không kênh · khai 3 ⇒ chung xe · "abc"/99 → 400',
      mxBad1.s === 400 && mxBad2.s === 400 && mx1.s === 200 && mx1.j?.data?.max_customers_per_trip === 1
      && pM.s === 201 && !!tM2 && tM2.ods.length === 1 && rowOf(PM, OD[1])?.max_customers === 1 && tripOfOd(PM, OD[0]) !== tM2
      && mxClr.s === 200 && c2Now?.max_customers_per_trip === null && pM2.s === 201 && tripOfOd(PM2, OD[0]) !== tripOfOd(PM2, OD[1]) && (PM2?.params?.config_gaps?.no_drops?.no_channel_ods ?? 0) >= 1
      && mx3.s === 200 && pM3.s === 201 && tripOfOd(PM3, OD[0]) === tripOfOd(PM3, OD[1]),
      `bad=${mxBad1.s},${mxBad2.s} set=${mx1.s}/${mx1.j?.data?.max_customers_per_trip} plan=${pM.s} ${pM.j?.error?.message ?? ''} t2ods=${tM2?.ods?.length} snap=${rowOf(PM, OD[1])?.max_customers} clr=${mxClr.s} now=${JSON.stringify(c2Now)} plan2=${pM2.s} sep=${tripOfOd(PM2, OD[0]) !== tripOfOd(PM2, OD[1])} gaps=${JSON.stringify(PM2?.params?.config_gaps?.no_drops)} re=${mx3.s}/${pM3.s} same=${tripOfOd(PM3, OD[0]) === tripOfOd(PM3, OD[1])}`)
  }

  // ── [13j] DÒNG XE THEO KHO (03/10 — user: "mỗi kho sẽ có setting khác nhau"; "config riêng rồi thì không lấy theo chung nữa") ──
  // Máy của kho đọc bản HIỆU LỰC tại kho: tắt ở kho ⇒ không xếp lên dòng xe QA dù Chung vẫn hoạt động; sức chứa 5 tại kho ⇒ OD1 (4) + OD2 (3)
  // không chung xe nữa; "Về theo chung" ⇒ 9 ⇒ chung xe như [1b].
  {
    await cleanupTrips()
    const off = await api(`/tms/vehicle-models/${vmId}/warehouses/${WH}`, 'PUT', { is_active: false })
    const pOff = await mkPlan(PLAN_BODY); const POff = pOff.j?.data
    const usedOff = (POff?.trips ?? []).some(t => t.vehicle_model_id === vmId)
    const sharedStill = ((await api('/tms/vehicle-models')).j?.data?.items ?? []).find(m => m.id === vmId)
    await cleanupTrips()
    const cap5 = await api(`/tms/vehicle-models/${vmId}/warehouses/${WH}`, 'PUT', { is_active: true, max_pallets: 5 })
    const p5 = await mkPlan(PLAN_BODY); const P5 = p5.j?.data
    const t1 = tripOfOd(P5, OD[0]), t2 = tripOfOd(P5, OD[1])
    await cleanupTrips()
    const back = await api(`/tms/vehicle-models/${vmId}/warehouses/${WH}`, 'DELETE')
    const pBack = await mkPlan(PLAN_BODY); const PBack = pBack.j?.data
    check('13j. Tắt dòng xe QA TẠI KHO ⇒ kế hoạch không xe nào dùng nó (Chung vẫn hoạt động) · bật lại với 5 pallet tại kho ⇒ OD1 (4) và OD2 (3) HAI xe, đều dòng xe QA · Về theo chung ⇒ 9 ⇒ chung MỘT xe',
      off.s === 201 && pOff.s === 201 && !usedOff && sharedStill?.is_active === true && sharedStill?.max_pallets === 9
      && cap5.s === 200 && p5.s === 201 && !!t1 && !!t2 && t1.id !== t2.id && t1.vehicle_model_id === vmId && t2.vehicle_model_id === vmId
      && back.s === 200 && pBack.s === 201 && !!tripOfOd(PBack, OD[0]) && tripOfOd(PBack, OD[0]) === tripOfOd(PBack, OD[1]),
      `off=${off.s}/${pOff.s} used=${usedOff} shared=${sharedStill?.is_active}/${sharedStill?.max_pallets} cap5=${cap5.s}/${p5.s} t1=${t1?.vehicle_model_id === vmId}/${t1?.pallets} t2=${t2?.vehicle_model_id === vmId}/${t2?.pallets} same5=${t1?.id === t2?.id} back=${back.s}/${pBack.s} same=${tripOfOd(PBack, OD[0]) === tripOfOd(PBack, OD[1])} ${pOff.j?.error?.message ?? p5.j?.error?.message ?? ''}`)
  }

  // ── [15] (27/09) XEM ĐƠN TRƯỚC KHI GHÉP · HOÃN / KHÔNG ĐIỀU · SỬA DÒNG XE KHÁCH TỪ BÀN · THẺ NHIỀU XE ─────────────────────────
  // user: "đơn key một ngày nhưng điều ngày khác — không tự động được, user review trước khi tự ghép" · "config dòng xe ngay trên bàn,
  // đổi KÊNH thì kho làm sai" · "10 tấn có thể 8 + 2 tấn, luôn so tổ hợp" (Xuất kho vẫn một biển — chấp nhận lệch)
  await cleanupTrips()
  {
    // Fixture SẠCH cho [15]: các mục trước đã đánh dấu OD1 đã xuất ([10p]), đổi / xoá OD3, đổi kiểu đi khách ⇒ dựng lại
    // đúng 3 OD như lúc đầu gói (lượt đầu 27/09 dùng lại trạng thái cũ nên pool ra OD5 thay OD3 và cả dây 15b–15f đổ theo)
    await restWrite('erp_outbound_orders', 'DELETE', `od_number=like.QA61OD*`).catch(() => {})
    for (let i = 0; i < 3; i++) {
      const ward = i < 2 ? W1 : W2
      await restWrite('Customer', 'PATCH', `ship_to_code=eq.${SHIP[i]}`, { dispatch_vehicles: ALLV, ward_code: ward, is_active: true })
      await restWrite('erp_outbound_orders', 'POST', null, {
        id: crypto.randomUUID(), od_number: OD[i], od_item: '10', material_code: FIX.MAT_POOL, qty_base: PAL[i] * perPallet,
        ship_to_code: SHIP[i], ship_to_name: `QA61 NPP ${i + 1}`, ward_code: ward, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY, flow: 'SALE',
        source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
      })
    }
    const c1 = (await restAll('Customer', `select=id&ship_to_code=eq.${SHIP[0]}`))[0]
    const next = (() => { const d = new Date(`${DAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()
    const pR0 = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
    let PR = pR0.j?.data
    const poolOds = (p) => [...new Set((p?.pool ?? []).map(o => o.od_number))].sort()
    const pid = (p) => p && p.id   // KHÔNG viết ${PR?.id} trong đường dẫn: thước độ phủ đọc đường dẫn tới dấu '?' đầu tiên
    check('15a. Lập (bước 1 = bảng XEM ĐƠN) → 201, máy CHƯA ghép (0 xe), cả 3 OD nằm khung chờ (tab Điều) nguyên OD, chưa có mốc máy lập',
      pR0.s === 201 && (PR?.trips ?? []).length === 0 && JSON.stringify(poolOds(PR)) === JSON.stringify([...OD].sort()) && (PR?.pool ?? []).every(o => !o.part_of)
      && PR?.params?.baseline == null,
      `http=${pR0.s} ${pR0.j?.error?.message ?? ''} trips=${(PR?.trips ?? []).length} pool=${poolOds(PR).join(',')} baseline=${JSON.stringify(PR?.params?.baseline)}`)
    const r1u = (PR?.pool ?? []).find(o => o.od_number === OD[0])
    const mvU = await api(`/tms/dispatch/plans/${pid(PR)}/move`, 'POST', { ids: [r1u?.id], to: 'new' })
    const roU = await api(`/tms/dispatch/plans/${pid(PR)}/reoptimize`, 'POST', {})
    const legacy = await api('/tms/dispatch/plan', 'POST', { ...PLAN_BODY, review_first: false })
    PR = legacy.j?.data
    check('15a2. Đơn mặc định ĐIỀU: kéo OD1 vào "Xe mới" → 200 · "Tối ưu lại" không cờ → 200 ghép CẢ khung chờ · lập lại (bản cũ gửi review_first=false) → 201 vẫn 0 xe (bước 1 luôn là Xem đơn)',
      mvU.s === 200 && roU.s === 200 && (roU.j?.data?.pool ?? []).length === 0 && (roU.j?.data?.trips ?? []).length >= 1 && legacy.s === 201 && (PR?.trips ?? []).length === 0,
      `move=${mvU.s}/${mvU.j?.error?.code ?? ''} reopt=${roU.s} ${(roU.j?.error?.message ?? '').slice(0, 60)} pool=${(roU.j?.data?.pool ?? []).length} legacy=${legacy.s} trips=${(PR?.trips ?? []).length}`)
    const r3 = (PR?.pool ?? []).find(o => o.od_number === OD[2])
    const hBad = await api(`/tms/dispatch/plans/${pid(PR)}/hold`, 'POST', { ids: [r3?.id], until: DAY, reason: 'QA hẹn' })
    // Bảng Xem đơn (27/09 tối): Điều → "Không điều" (lý do TUỲ CHỌN) → đổi sang "Không điều ngày này" theo SỐ OD (OD đã rời kế hoạch)
    const hNever = await api(`/tms/dispatch/plans/${pid(PR)}/hold`, 'POST', { ids: [r3?.id], until: null })
    const exN = (hNever.j?.data?.params?.excluded ?? []).find(x => x.od_number === OD[2])
    // 03/10 tối: hoãn theo SỐ OD nay nhận cả OD CHƯA hoãn miễn thuộc plant (đơn quá cửa sổ 14 ngày không có `ids`) → 200, rồi bỏ hoãn
    // ngay để các phép sau giữ nguyên trạng thái; OD không có trong ZSD02 của kho → 404 OD_NOT_FOUND
    const hNotHeld = await api(`/tms/dispatch/plans/${pid(PR)}/hold`, 'POST', { od_numbers: ['QA61KHONGCO'], until: next })
    const hFree = await api(`/tms/dispatch/plans/${pid(PR)}/hold`, 'POST', { od_numbers: [OD[1]], until: next, reason: 'QA hoãn theo số OD' })
    const hFreeRow = (await restAll('dispatch_od_hold', `select=hold_until&warehouse_id=eq.${WH}&od_number=eq.${OD[1]}`))[0]
    await api(`/tms/dispatch/plans/${pid(PR)}/unhold`, 'POST', { od_numbers: [OD[1]] })
    const hOk = await api(`/tms/dispatch/plans/${pid(PR)}/hold`, 'POST', { od_numbers: [OD[2]], until: next, reason: 'QA NPP hẹn ngày sau' })
    PR = hOk.j?.data
    const holdRow = (await restAll('dispatch_od_hold', `select=od_number,hold_until,reason&warehouse_id=eq.${WH}&od_number=eq.${OD[2]}`))
    const exH = (PR?.params?.excluded ?? []).find(x => x.od_number === OD[2])
    check('15b. Chuyển trạng thái: ngày ≤ ngày lập → 400 · Điều→Không điều KHÔNG cần lý do → 200 (until null, kèm tên khách + pallet để bảng in dòng) · hoãn theo số OD không có trong ZSD02 kho → 404 OD_NOT_FOUND · OD CHƯA hoãn theo số OD → 200 ghi sổ (03/10: đơn quá 14 ngày) · Không điều→Không điều ngày này theo số OD → 200, sổ hoãn MỘT dòng mang ngày mới + lý do',
      hBad.s === 400 && hNever.s === 200 && exN?.kind === 'HELD' && exN?.until === null && exN?.reason === 'Không điều' && exN?.d?.ship_to_name === 'QA61 NPP 3' && Number(exN?.d?.pallets) > 0
      && hNotHeld.s === 404 && hNotHeld.j?.error?.code === 'OD_NOT_FOUND' && hFree.s === 200 && hFreeRow?.hold_until === next
      && hOk.s === 200 && !poolOds(PR).includes(OD[2]) && holdRow.length === 1 && holdRow[0]?.hold_until === next && exH?.kind === 'HELD' && exH?.until === next && /hoãn tới .*QA NPP hẹn/.test(exH?.info ?? '') && exH?.d?.ship_to_name === 'QA61 NPP 3',
      `bad=${hBad.s} never=${hNever.s} ${hNever.j?.error?.message ?? ''} exN=${JSON.stringify(exN)} notFound=${hNotHeld.s}/${hNotHeld.j?.error?.code} free=${hFree.s}/${hFreeRow?.hold_until} ok=${hOk.s} ${hOk.j?.error?.message ?? ''} pool=${poolOds(PR).join(',')} row=${JSON.stringify(holdRow)} ex=${JSON.stringify(exH)}`)
    const syncH = await api(`/tms/dispatch/plans/${pid(PR)}/sync`)
    const pAgain = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
    PR = pAgain.j?.data
    check('15c. Dấu hoãn GIỮ qua lần nạp / lập lại: "OD mới" không đếm OD3 · lập lại không đưa OD3 vào · vẫn liệt kê HELD',
      syncH.s === 200 && !(syncH.j?.data?.new_od_numbers ?? []).includes(OD[2]) && pAgain.s === 201 && !poolOds(PR).includes(OD[2])
      && (PR?.params?.excluded ?? []).some(x => x.od_number === OD[2] && x.kind === 'HELD'),
      `sync=${syncH.s} new=${JSON.stringify(syncH.j?.data?.new_od_numbers)} again=${pAgain.s} pool=${poolOds(PR).join(',')}`)
    const r1 = (PR?.pool ?? []).find(o => o.od_number === OD[0])
    const rs = await api(`/tms/dispatch/plans/${pid(PR)}/reoptimize`, 'POST', { ids: [r1?.id] })
    PR = rs.j?.data
    const rowNow = (p, od) => [...(p?.trips ?? []).flatMap(t => t.ods), ...(p?.pool ?? [])].find(o => o.od_number === od)
    check('15d. "Ghép phần đã chọn": chỉ OD1 lên xe (vết người ghép) · OD2 vẫn ở khung chờ · lần ghép đầu thành mốc máy lập',
      rs.s === 200 && (PR?.trips ?? []).length === 1 && !!tripOfOd(PR, OD[0]) && poolOds(PR).join(',') === OD[1] && PR?.params?.baseline?.trips === 1
      && !!rowNow(PR, OD[0])?.reviewed_at && !!rowNow(PR, OD[0])?.reviewed_by,
      `http=${rs.s} ${rs.j?.error?.message ?? ''} trips=${(PR?.trips ?? []).length} pool=${poolOds(PR).join(',')} base=${JSON.stringify(PR?.params?.baseline)}`)
    // 01/10 (Ba Vì: xe #2/#10 trống mà vẫn 3,3 pallet · 812 k, đếm Non tải): Không điều rút HẾT đơn của xe ⇒ xe bị bỏ, không để xe trống số cũ
    const r1t = rowNow(PR, OD[0])
    const hT = await api(`/tms/dispatch/plans/${pid(PR)}/hold`, 'POST', { ids: [r1t?.id], until: next, reason: 'QA rút hết xe' })
    const PH = hT.j?.data
    check('15d2. Không điều OD duy nhất của một xe → xe đó bị BỎ (held.trips_removed = 1, 0 xe, summary.empty_trips = 0), OD về HELD',
      hT.s === 200 && hT.j?.data?.held?.trips_removed === 1 && (PH?.trips ?? []).length === 0 && (PH?.summary?.empty_trips ?? 0) === 0 && (PH?.params?.excluded ?? []).some(x => x.od_number === OD[0] && x.kind === 'HELD'),
      `http=${hT.s} ${hT.j?.error?.message ?? ''} removed=${hT.j?.data?.held?.trips_removed} trips=${(PH?.trips ?? []).length} empty=${PH?.summary?.empty_trips}`)
    // trả về trạng thái sau 15d cho các phép sau: bỏ hoãn OD1 → về khung chờ → ghép riêng OD1 lên xe
    await api(`/tms/dispatch/plans/${pid(PR)}/unhold`, 'POST', { od_numbers: [OD[0]] })
    const prBack = await api(`/tms/dispatch/plans/${pid(PR)}`)
    const r1b = (prBack.j?.data?.pool ?? []).find(o => o.od_number === OD[0])
    PR = (await api(`/tms/dispatch/plans/${pid(PR)}/reoptimize`, 'POST', { ids: [r1b?.id] })).j?.data ?? PR
    const uOk = await api(`/tms/dispatch/plans/${pid(PR)}/unhold`, 'POST', { od_numbers: [OD[2]] })
    PR = uOk.j?.data
    const uAgain = await api(`/tms/dispatch/plans/${pid(PR)}/unhold`, 'POST', { od_numbers: [OD[2]] })
    const holdLeft = (await restAll('dispatch_od_hold', `select=id&warehouse_id=eq.${WH}&od_number=eq.${OD[2]}`)).length
    check('15e. Bỏ hoãn → OD3 về NGAY khung chờ với mốc ĐÃ XEM (người bỏ hoãn đã quyết), sổ hoãn trống, hết dòng HELD · bỏ hoãn lần hai → 404',
      uOk.s === 200 && uOk.j?.data?.unheld?.back_to_pool === 1 && poolOds(PR).includes(OD[2]) && !!rowNow(PR, OD[2])?.reviewed_at && holdLeft === 0 && !(PR?.params?.excluded ?? []).some(x => x.kind === 'HELD') && uAgain.s === 404,
      `ok=${uOk.s} ${uOk.j?.error?.message ?? ''} back=${uOk.j?.data?.unheld?.back_to_pool} pool=${poolOds(PR).join(',')} rev=${rowNow(PR, OD[2])?.reviewed_at} left=${holdLeft} again=${uAgain.s}`)
    // BẢNG XEM ĐƠN (27/09 khuya, user: "thiếu SO, người tạo, ghi chú, thùng, loại kho… cần xem được detail"): thông tin SAP
    // từng OD gọi riêng; "Không điều ngày này" đã tới ngày ⇒ OD về Điều kèm ghi chú lần hoãn trước (giả lập dấu hôm qua hẹn tới hôm nay)
    const hPrev = await restWrite('dispatch_od_hold', 'POST', null, { id: crypto.randomUUID(), warehouse_id: WH, od_number: OD[1], hold_until: DAY, reason: 'QA61 hẹn hôm nay', created_by: 'QA61', updated_at: nowIso() })
    const rv = await api(`/tms/dispatch/plans/${pid(PR)}/review`)
    const i1 = rv.j?.data?.ods?.[OD[0]], i2 = rv.j?.data?.ods?.[OD[1]]
    await restWrite('dispatch_od_hold', 'DELETE', `warehouse_id=eq.${WH}&od_number=eq.${OD[1]}`)
    const dOd = await api(`/tms/dispatch/plans/${pid(PR)}/ods/${OD[0]}`)
    const dFor = await api(`/tms/dispatch/plans/${pid(PR)}/ods/QA61KHONGCO`)
    check('15m. Xem đơn: /review có đủ 3 OD kèm SL quy đổi > 0 + số dòng · OD2 hết "Không điều ngày này" mang ghi chú lần hoãn trước · chi tiết OD1 → dòng ZSD02 + quy cách mã · OD không thuộc kế hoạch → 404',
      hPrev.ok !== false && rv.s === 200 && OD.every(o => !!rv.j?.data?.ods?.[o]) && Number(i1?.qty_conv) > 0 && i1?.lines >= 1
      && i2?.held_before?.until === DAY && i2?.held_before?.reason === 'QA61 hẹn hôm nay'
      && dOd.s === 200 && (dOd.j?.data?.lines ?? []).length >= 1 && (dOd.j?.data?.materials ?? []).length >= 1 && dFor.s === 404 && dFor.j?.error?.code === 'OD_NOT_IN_PLAN',
      `review=${rv.s} ${rv.j?.error?.message ?? ''} i1=${JSON.stringify(i1)?.slice(0, 160)} held=${JSON.stringify(i2?.held_before)} od=${dOd.s}/${(dOd.j?.data?.lines ?? []).length} foreign=${dFor.s}/${dFor.j?.error?.code}`)
    // SAP SỬA ĐƠN sau khi đã xem: cùng OD, SL đổi (OD1 đang trên xe 4 → 5 pallet) · ghi chú đổi (OD3 ở khung chờ)
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[0]}`, { qty_base: 5 * perPallet, updated_at: nowIso() })
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[2]}`, { note_delivery: 'QA61 NPP hẹn giao sáng', updated_at: nowIso() })
    const syC = await api(`/tms/dispatch/plans/${pid(PR)}/sync`)
    const fC1 = (syC.j?.data?.flags ?? []).find(x => x.od_number === OD[0]), fC3 = (syC.j?.data?.flags ?? []).find(x => x.od_number === OD[2]), fC2 = (syC.j?.data?.flags ?? []).find(x => x.od_number === OD[1])
    const cfC = await api(`/tms/dispatch/plans/${pid(PR)}/confirm`, 'POST', {})
    check('15e2. SAP SỬA đơn sau khi xem → /sync cờ CHANGED: OD1 "sửa số lượng", OD3 "ghi chú đổi" kèm câu mới · OD2 không đổi thì không cờ · Xác nhận → 409 OD_CHANGED_IN_SAP nêu "Cập nhật theo SAP"',
      fC1?.kind === 'CHANGED' && /số lượng/.test(fC1?.info ?? '') && fC3?.kind === 'CHANGED' && /QA61 NPP hẹn giao sáng/.test(fC3?.info ?? '') && !fC2
      && cfC.s === 409 && cfC.j?.error?.code === 'OD_CHANGED_IN_SAP' && /Cập nhật theo SAP/.test(cfC.j?.error?.message ?? ''),
      `f1=${JSON.stringify(fC1)} f3=${JSON.stringify(fC3)} f2=${JSON.stringify(fC2)} confirm=${cfC.s}/${cfC.j?.error?.code}`)
    const tBefore = tripOfOd(PR, OD[0])
    const rsy = await api(`/tms/dispatch/plans/${pid(PR)}/resync-od`, 'POST', { od_number: OD[0] })
    const rsy3 = await api(`/tms/dispatch/plans/${pid(PR)}/resync-od`, 'POST', { od_number: OD[2] })
    const rsyNo = await api(`/tms/dispatch/plans/${pid(PR)}/resync-od`, 'POST', { od_number: 'QA61KHONGCO' })
    PR = rsy3.j?.data
    const syC2 = await api(`/tms/dispatch/plans/${pid(PR)}/sync`)
    const tAfter = tripOfOd(PR, OD[0])
    check('15e3. "Cập nhật theo SAP": OD1 ở NGUYÊN xe, 4 → 5 pallet, xe tính lại 5 pallet (cước 200.000 × 5) · OD3 ở khung chờ mang ghi chú mới · hết cờ CHANGED · OD không có → 404',
      rsy.s === 200 && rsy.j?.data?.resynced?.pallets_before === 4 && Number(rsy.j?.data?.resynced?.pallets_after) === 5 && tAfter?.id === tBefore?.id && Number(tAfter?.pallets) === 5 && Number(tAfter?.detail?.freight?.base) === PRICE_DA * 5
      && rsy3.s === 200 && rowNow(PR, OD[2])?.trip_id == null && rowNow(PR, OD[2])?.note === 'QA61 NPP hẹn giao sáng' && !(syC2.j?.data?.flags ?? []).some(x => x.kind === 'CHANGED') && rsyNo.s === 404,
      `r1=${rsy.s} ${rsy.j?.error?.message ?? ''} ${JSON.stringify(rsy.j?.data?.resynced)} same=${tAfter?.id === tBefore?.id} pal=${tAfter?.pallets} base=${tAfter?.detail?.freight?.base} r3=${rsy3.s} note=${rowNow(PR, OD[2])?.note} flags=${JSON.stringify(syC2.j?.data?.flags)} no=${rsyNo.s}`)
    // Dòng xe được vào của KHÁCH sửa từ bàn — chỉ cột dòng xe; OD của khách trên nháp chụp lại danh sách ngay
    const vms = (await api('/tms/vehicle-models')).j?.data?.items ?? []
    const pick = vms.find(m => m.is_active && m.id !== vmId && m.sap_code !== SAP)
    const gV = await api(`/tms/dispatch/plans/${pid(PR)}/customers/${SHIP[0]}/vehicles`)
    const gNo = await api(`/tms/dispatch/plans/${pid(PR)}/customers/QA61KHONGCO/vehicles`)
    const pBad = await api(`/tms/dispatch/plans/${pid(PR)}/customers/${SHIP[0]}/vehicles`, 'PUT', { dispatch_vehicles: { '*': ['khong-co-that'] } })
    const pOk = await api(`/tms/dispatch/plans/${pid(PR)}/customers/${SHIP[0]}/vehicles`, 'PUT', { dispatch_vehicles: { '*': [pick?.id] } })
    const cNow = (await restAll('Customer', `select=dispatch_vehicles,channel&id=eq.${c1.id}`))[0]
    const snap = [...(pOk.j?.data?.trips ?? []).flatMap(t => t.ods), ...(pOk.j?.data?.pool ?? [])].find(o => o.od_number === OD[0])
    const tW = tripOfOd(pOk.j?.data, OD[0])
    check('15f. Bàn ghép xe: xem dòng xe khách → 200 (kèm kênh) · ship-to lạ → 404 · id lạ → 400 · lưu → Customer đổi, OD1 chụp danh sách mới, xe OD1 cảnh báo khách không được vào xe QA',
      gV.s === 200 && gV.j?.data?.ship_to_code === SHIP[0] && gNo.s === 404 && pBad.s === 400 && pOk.s === 200 && JSON.stringify(cNow?.dispatch_vehicles) === JSON.stringify({ '*': [pick?.id] })
      && JSON.stringify(snap?.allowed_models) === JSON.stringify([pick?.id]) && pOk.j?.data?.customer_vehicles?.ods_updated >= 1 && /không được vào dòng xe/.test((tW?.detail?.warnings ?? []).join(' ')),
      `get=${gV.s} no=${gNo.s} bad=${pBad.s} ok=${pOk.s} ${pOk.j?.error?.message ?? ''} cust=${JSON.stringify(cNow?.dispatch_vehicles)} snap=${JSON.stringify(snap?.allowed_models)} warn=${(tW?.detail?.warnings ?? []).join(' | ').slice(0, 120)}`)

    // THẺ NHIỀU XE: OD 14 pallet, khách chỉ được vào xe QA 9 pallet ⇒ KHÔNG tách OD, một thẻ 2 × xe QA (9 + 5), cước = Σ từng xe
    await cleanupTrips()
    await restWrite('Customer', 'PATCH', `id=eq.${c1.id}`, { dispatch_vehicles: { '*': [vmId] } })
    const OD11 = 'QA61OD11'
    await restWrite('erp_outbound_orders', 'POST', null, {
      id: crypto.randomUUID(), od_number: OD11, od_item: '10', material_code: FIX.MAT_POOL, qty_base: 14 * perPallet,
      ship_to_code: SHIP[0], ship_to_name: 'QA61 NPP 1', ward_code: W1, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY, flow: 'SALE',
      source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
    })
    const pMV = await mkPlan(PLAN_BODY)
    const PM = pMV.j?.data
    const tM = tripOfOd(PM, OD11)
    const parts = (PM?.trips ?? []).flatMap(t => t.ods).filter(o => o.od_number === OD11)
    check('15g. OD 14 pallet > xe 9 pallet được vào ⇒ MỘT thẻ, OD nguyên (không phần), 2 xe QA chia 9 + 5, cước = 200.000 × 14 (+ phụ phí), tải 77,8 %',
      pMV.s === 201 && parts.length === 1 && !parts[0].part_of && JSON.stringify(tM?.extra_vehicle_model_ids) === JSON.stringify([vmId])
      && (tM?.detail?.vehicles ?? []).map(v => Number(v.pallets)).join('+') === '9+5' && Number(tM?.detail?.freight?.base) === PRICE_DA * 14 && Number(tM?.load_pct) === 77.8,
      `http=${pMV.s} ${pMV.j?.error?.message ?? ''} parts=${parts.length} extra=${JSON.stringify(tM?.extra_vehicle_model_ids)} veh=${(tM?.detail?.vehicles ?? []).map(v => `${v.name}:${v.pallets}`).join(' + ')} base=${tM?.detail?.freight?.base} load=${tM?.load_pct}`)
    if (tM) {
      const one = await api(`/tms/dispatch/trips/${tM.id}`, 'PATCH', { vehicle_model_id: vmId })
      const two = await api(`/tms/dispatch/trips/${tM.id}`, 'PATCH', { vehicle_model_ids: [vmId, vmId] })
      const badIds = await api(`/tms/dispatch/trips/${tM.id}`, 'PATCH', { vehicle_model_ids: [vmId, 'd4c5d4c5-0000-4000-8000-000000000000'] })
      check('15h. Người chọn MỘT xe → thẻ về một xe, cảnh báo vượt sức chứa · chọn 2 xe → lại chia 9 + 5 · dòng xe không có thật → 400',
        one.s === 200 && (one.j?.data?.extra_vehicle_model_ids ?? []).length === 0 && /Vượt sức chứa/.test((one.j?.data?.detail?.warnings ?? []).join(' '))
        && two.s === 200 && JSON.stringify(two.j?.data?.extra_vehicle_model_ids) === JSON.stringify([vmId]) && Number(two.j?.data?.load_pct) === 77.8 && badIds.s === 400,
        `one=${one.s} extra=${JSON.stringify(one.j?.data?.extra_vehicle_model_ids)} two=${two.s} load=${two.j?.data?.load_pct} bad=${badIds.s}`)
      const cf = await api(`/tms/dispatch/plans/${PM.id}/confirm`, 'POST', {})
      const kl = await restAll('khvc_lines', `select=do_no,vehicle_model_id,extra_vehicle_model_ids&group_code=eq.${tM.group_code}`)
      const klist = await api(`/external/khvc?do_no=${OD11}`)
      const kRow = (klist.j?.data?.items ?? []).find(i => i.do_no === OD11)
      check('15i. Xác nhận → Kế hoạch xuất ghi dòng xe chính + xe PHỤ (ĐVVT booking đủ xe); danh sách Kế hoạch xuất trả tên xe phụ',
        cf.s === 200 && kl.length === 1 && kl[0].vehicle_model_id === vmId && JSON.stringify(kl[0].extra_vehicle_model_ids) === JSON.stringify([vmId]) && (kRow?.extra_vehicle_models ?? []).length === 1,
        `confirm=${cf.s} ${cf.j?.error?.message ?? ''} kl=${JSON.stringify(kl)} list=${klist.s} extra=${JSON.stringify(kRow?.extra_vehicle_models)}`)
      // "gom là để TÍNH CƯỚC" (user 27/09 tối): cước dự tính trên CHUYẾN XUẤT KHO phải là Σ các xe của thẻ — bản trước chỉ tính
      // xe chính ⇒ 14 pallet trên một xe 9 pallet: tải 155,6 %, không có danh sách xe
      const gM = (await restAll('GroupDeliveryOrder', `select=freight_estimated,freight_detail&group_code=eq.${tM.group_code}`))[0]
      const gv = gM?.freight_detail?.vehicles ?? []
      check('15j. Chuyến Xuất kho của thẻ 2 xe: cước dự tính = Σ 2 xe (9 + 5 pallet), % tải theo sức chứa cộng 18 pallet = 77,8 %, cùng số với thẻ điều vận',
        !!gM && gv.length === 2 && gv.map(v => Number(v.pallets)).join('+') === '9+5' && Number(gM?.freight_detail?.load?.pct) === 77.8 && Number(gM?.freight_estimated) === Number(tM?.freight_estimated ?? two.j?.data?.freight_estimated),
        `gdo=${JSON.stringify({ f: gM?.freight_estimated, veh: gv.map(v => v.pallets), load: gM?.freight_detail?.load?.pct, reason: gM?.freight_detail?.reason })} thẻ=${two.j?.data?.freight_estimated}`)
    } else check('15h. Fixture: OD11 phải có xe ở [15g]', false)

    // HAI NGƯỜI CÙNG BẤM "Xác nhận … đơn & ghép xe" (check-app 27/09 tối: Bàu Bàng 173 OD ⇒ 150 xe, MỌI OD nằm hai xe, cả hai
    // lượt 200). Bước này nay bắt buộc nên ai mở bàn cũng bấm nó ⇒ chỉ MỘT lượt được chạy, lượt kia 409, mỗi OD đúng một chỗ.
    //
    // ⚠ TÁCH LÀM HAI PHÉP (28/09) — đòi "đúng một lượt 409" từ một cuộc ĐUA là đòi thứ không nắm được:
    // hai lời gọi song song chỉ CHỒNG NHAU khi lượt sau tới lúc lượt đầu còn đang chạy. Fixture này có 4 OD nên máy ghép
    // xong trong khoảng một giây, còn lượt thứ hai trên Vercel có thể phải chờ dựng một instance mới ⇒ đêm 28/09 hai lượt
    // đi NỐI ĐUÔI: cả hai 200, dữ liệu vẫn đúng (4 OD · 4 dòng · 0 trùng) mà cổng vẫn đỏ, email gửi về người dùng.
    //   [15k]  cuộc đua đo ĐÚNG THỨ ĐÃ HỎNG 27/09: mỗi OD nằm đúng MỘT dòng, MỘT chỗ — ghép hai lần là lòi ra ngay.
    //   [15k2] cửa "thuê kế hoạch" đo TẤT ĐỊNH: tự giữ chỗ (busy_until tương lai) rồi gọi ⇒ phải 409 PLAN_BUSY; thả ra
    //          thì lại chạy được (không kẹt vĩnh viễn). Đo trên Preview 28/09 cả hai nhánh: không giữ chỗ → cửa cho
    //          vào tận handler, giữ chỗ → PLAN_BUSY ⇒ phép kiểm phân biệt được thật, không phải câu luôn đúng.
    await cleanupTrips()
    const pK = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
    const kId = pK.j?.data?.id
    const kRes = await Promise.all([0, 1].map(() => api(`/tms/dispatch/plans/${kId}/reoptimize`, 'POST', { review_all: true })))
    const kRows = await restAll('dispatch_trip_od', `select=od_number,trip_id,part_of&plan_id=eq.${kId}`)
    const kPlaces = new Map()
    for (const r of kRows) { const s = kPlaces.get(r.od_number) ?? new Set(); s.add(r.part_of ? `part:${r.trip_id}` : (r.trip_id ?? 'pool')); kPlaces.set(r.od_number, s) }
    const kDup = [...kPlaces].filter(([od, s]) => s.size > 1 || kRows.filter(r => r.od_number === od && !r.part_of).length > 1)
    check('15k. Hai người cùng "Xác nhận & ghép": mỗi OD đúng MỘT dòng, MỘT chỗ — máy KHÔNG ghép hai lần (lượt kia 409 hay nối đuôi 200 đều được)',
      kRes.some(r => r.s === 200) && kRes.every(r => r.s === 200 || (r.s === 409 && r.j?.error?.code === 'PLAN_BUSY')) && kDup.length === 0 && kPlaces.size > 0,
      `codes=${kRes.map(r => `${r.s}/${r.j?.error?.code ?? ''}`).join(' ')} OD=${kPlaces.size} dòng=${kRows.length} trùng=${kDup.map(([od]) => od).join(',')}`)

    // Cửa thuê kế hoạch, đo không qua đua: giữ chỗ 2 phút rồi gọi → phải bị chặn; thả ra → phải chạy lại được.
    await restWrite('dispatch_plan', 'PATCH', `id=eq.${kId}`, { busy_until: new Date(Date.now() + 120_000).toISOString(), busy_token: 'qa61-probe' })
    const kBusy = await api(`/tms/dispatch/plans/${kId}/reoptimize`, 'POST', { review_all: true })
    await restWrite('dispatch_plan', 'PATCH', `id=eq.${kId}`, { busy_until: new Date(Date.now() - 1000).toISOString(), busy_token: null })
    const kFree = await api(`/tms/dispatch/plans/${kId}/reoptimize`, 'POST', { review_all: true })
    check('15k2. Kế hoạch đang có người thuê → lượt sau 409 PLAN_BUSY; thuê hết hạn → lại làm được (không kẹt vĩnh viễn)',
      kBusy.s === 409 && kBusy.j?.error?.code === 'PLAN_BUSY' && kFree.s === 200,
      `đang thuê=${kBusy.s}/${kBusy.j?.error?.code ?? ''} hết hạn=${kFree.s}/${kFree.j?.error?.code ?? ''} ${kFree.j?.error?.message ?? ''}`)

    // XE ĐANG CHỜ ĐVVT mà SAP sửa OD: ghi "ĐVVT nhận" bị chặn (đúng — tải cũ) nhưng "Cập nhật theo SAP" từng từ chối xe CHỜ ⇒
    // ngõ cụt, lối ra duy nhất là ghi "từ chối" dù ĐVVT đã nhận (check-app 27/09 tối). HA cần phản hồi (0b) ⇒ xe OD3 đứng CHỜ.
    await api(`/tms/transport-companies/${HA.id}`, 'PUT', { tender_required: true })   // cờ đọc LÚC CHỐT (các mục trước đã tắt)
    const cfK = await api(`/tms/dispatch/plans/${kId}/confirm`, 'POST', {})
    const PK = await planOf(kId)
    const tK3 = tripOfOd(PK, OD[2])
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[2]}`, { qty_base: 2 * perPallet, updated_at: nowIso() })
    const acc1 = await api(`/tms/dispatch/trips/${tK3?.id}/respond`, 'POST', { accept: true })
    const rsK = await api(`/tms/dispatch/plans/${kId}/resync-od`, 'POST', { od_number: OD[2] })
    const acc2 = await api(`/tms/dispatch/trips/${tK3?.id}/respond`, 'POST', { accept: true })
    const khK = await restAll('khvc_lines', `select=do_no&group_code=eq.${tK3?.group_code}`)
    check('15l. Xe CHỜ ĐVVT có OD bị SAP sửa: ghi nhận → 409 OD_CHANGED_IN_SAP · "Cập nhật theo SAP" làm được trên xe chờ (xe vẫn chờ, 3 → 2 pallet) · ghi nhận lại → 200, xe vào Kế hoạch xuất',
      cfK.s === 200 && tK3?.status === 'TENDERED' && acc1.s === 409 && acc1.j?.error?.code === 'OD_CHANGED_IN_SAP'
      && rsK.s === 200 && Number(rsK.j?.data?.resynced?.pallets_after) === 2 && tripOfOd(rsK.j?.data, OD[2])?.status === 'TENDERED' && acc2.s === 200 && khK.length === 1,
      `confirm=${cfK.s} xe=${tK3?.status} acc1=${acc1.s}/${acc1.j?.error?.code} resync=${rsK.s}/${rsK.j?.error?.code ?? ''} after=${rsK.j?.data?.resynced?.pallets_after} acc2=${acc2.s}/${acc2.j?.error?.code ?? ''} kh=${khK.length}`)
  }

  // [16] DẢI TẢI THEO DÒNG XE CHA (01/10, user: "rank theo %, chỉnh ngay trên bàn lúc Ghép / Lập lại, hiện lên bàn, có nút bỏ qua %").
  // Fixture 4 + 3 + 3 pallet trên xe 9: mặc định = 2 xe (7/9 · 3/9). Dải XEPALLET 80–115 % ⇒ trần xếp 10,35 pallet ⇒ máy GỘP cả ba
  // thành MỘT xe 10/9 = 111,1 % (không vượt — trong dải), và kho nhớ dải. Bypass ⇒ xếp theo 100 %: xe đó thành VƯỢT. Dải 200 % ⇒ 400.
  if (XEPALLET?.id) {
    await api(`/tms/transport-companies/${HA.id}`, 'PUT', { tender_required: false })
    await cleanupTrips()
    // Các mục trước đã sửa SL / thay OD / thêm OD11 14 pallet… nên tập OD lúc này không còn là 4 + 3 + 3 (lượt đầu 01/10: 9,5 + 3 + 2).
    // Dựng ĐÚNG fixture cho mục này: ẩn mọi OD QA61 cũ (OBSOLETE) rồi tạo 3 OD mới 4 / 3 / 3 pallet — cleanup xoá cả QA61* nên không rác.
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=like.QA61*`, { sync_status: 'OBSOLETE', updated_at: nowIso() })
    const OD16 = ['QA61OD16A', 'QA61OD16B', 'QA61OD16C']
    for (let i = 0; i < 3; i++) await restWrite('erp_outbound_orders', 'POST', null, {
      id: crypto.randomUUID(), od_number: OD16[i], od_item: '10', material_code: FIX.MAT_POOL, qty_base: PAL[i] * perPallet,
      ship_to_code: SHIP[i], ship_to_name: `QA61 NPP ${i + 1}`, ward_code: i < 2 ? W1 : W2, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY, flow: 'SALE',
      source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
    })
    const BAND = { [XEPALLET.id]: { min: 80, max: 115 } }
    // jsonb trả khoá theo thứ tự chữ cái ({max,min}) — so theo GIÁ TRỊ, đừng so chuỗi JSON
    const bandEq = (o, min, max) => Number(o?.[XEPALLET.id]?.min) === min && Number(o?.[XEPALLET.id]?.max) === max && Object.keys(o ?? {}).length === 1
    const p16 = await mkPlan({ ...PLAN_BODY, load_bands: BAND })
    const P16 = p16.j?.data
    let p16Id = P16?.id ?? ''   // máy quét độ phủ (coverage-surface) không đọc được `${P16?.id}` trong đường dẫn — dấu ? cắt chuỗi; [17] dọn rồi dựng lại ⇒ let
    const t16 = (P16?.trips ?? []).filter(t => t.ods?.length)
    const whB = (await restAll('Warehouse', `select=dispatch_load_bands&id=eq.${WH}`))[0]?.dispatch_load_bands
    check('16a. Lập + ghép với dải XEPALLET 80–115 %: params.load_bands ghi đúng · 3 OD gộp MỘT xe 10/9 = 111,1 % không vượt · kho nhớ dải',
      p16.s === 201 && bandEq(P16?.params?.load_bands, 80, 115) && t16.length === 1 && Number(t16[0].load_pct) === 111.1
      && t16[0].oversize === false && t16[0].underload === false && Number(t16[0].detail?.load?.max_pct) === 115 && bandEq(whB, 80, 115),
      `s=${p16.s} bands=${JSON.stringify(P16?.params?.load_bands)} xe=${t16.length} tải=${t16.map(t => `${t.load_pct}%/over=${t.oversize}/under=${t.underload}/max=${t.detail?.load?.max_pct}`).join(' ')} kho=${JSON.stringify(whB)}`)
    const by1 = await api(`/tms/dispatch/plans/${p16Id}/params`, 'PATCH', { load_bypass: true })
    const tb = (by1.j?.data?.trips ?? []).filter(t => t.ods?.length)
    const by0 = await api(`/tms/dispatch/plans/${p16Id}/params`, 'PATCH', { load_bypass: false })
    const tb0 = (by0.j?.data?.trips ?? []).filter(t => t.ods?.length)
    check('16b. PATCH params bỏ qua dải: xe 111 % thành VƯỢT (trần 100), không ghép lại; bỏ bypass ⇒ lại trong dải (dải cũ còn giữ)',
      by1.s === 200 && by1.j?.data?.params?.load_bypass === true && tb.length === 1 && tb[0].oversize === true && Number(by1.j?.data?.summary?.oversize) === 1
      && by0.s === 200 && tb0.length === 1 && tb0[0].oversize === false && bandEq(by0.j?.data?.params?.load_bands, 80, 115),
      `bypass=${by1.s} over=${tb[0]?.oversize} sum=${by1.j?.data?.summary?.oversize} · bỏ bypass=${by0.s} over=${tb0[0]?.oversize} bands=${JSON.stringify(by0.j?.data?.params?.load_bands)}`)

  // ── [17] (03/10 tối — user: "double 2 lần cho kế hoạch đi hàng các ngày khác nhau ⇒ hậu quả nghiêm trọng"; "283 đơn bị nháp 30/09 giữ
  // dù chưa lên xe"; "lấy theo lịch sử app + dấu tay"; "sai lệch đơn hàng chưa sửa thì ngăn ở xuất hàng") ──
  // RÀO DB một đơn một ngày xuất (kể cả họ hàng) · khung chờ TỰ DO, xe thì khoá · Kéo về đây · dấu Ngoài app · đơn quá hạn · cổng SAP ở kho.
  {
    await cleanupTrips()
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=in.(${OD.join(',')})`, { mat_doc: null, qty_issued_base: null, sync_status: 'ACTIVE', replaced_by_od: null, updated_at: nowIso() })
    // [18] hàng chờ "Cần xử lý" của điều vận (đợt 2) — tính theo KHO; chỉ soi dòng của fixture QA61 (kho Ba Vì thật có thể có việc thật)
    const decUrl = `/tms/dispatch/decisions?warehouse_id=${WH}`
    const qa61 = d => (d.j?.data?.rows ?? []).filter(r => String(r.od_number).startsWith('QA61') || String(r.group_code ?? '').startsWith(PREFIX))
    const pA = await mkPlan(PLAN_BODY)           // DAY: OD1+OD2 xe 1 (DA) · OD3 xe 2 (HA chờ)
    const A = pA.j?.data
    const cfA = await api(`/tms/dispatch/plans/${A?.id}/confirm`, 'POST', {})
    const khA = await restAll('khvc_lines', `select=do_no,group_code,export_date,gdo_id&group_code=like.${PREFIX}*`)
    const railErr = async (table, body) => { try { await restWrite(table, 'POST', null, body); return null } catch (e) { return String(e.message) } }
    const khRow = (od, gc, d) => ({ id: crypto.randomUUID(), group_code: gc, do_no: od, warehouse_code: FIX.WH_QR.code, export_date: d, source: 'EXCEL', sync_status: 'ACTIVE', updated_at: nowIso() })
    const e1 = await railErr('khvc_lines', khRow(OD[0], 'QA61RAIL_X1', DAY2))
    const e2 = await railErr('khvc_lines', khRow(OD[0], 'QA61RAIL_X2', DAY))
    check('17a. RÀO DB: DO đã ở Kế hoạch xuất 16/03 mà ghi vào Kế hoạch xuất 17/03 (ghi thẳng PostgREST = cửa Excel / thêm tay) → 23505 OD_ALREADY_PLANNED · cùng ngày khác Số xe → cho',
      cfA.s === 200 && khA.some(k => k.do_no === OD[0]) && /OD_ALREADY_PLANNED/.test(e1 ?? '') && e2 === null,
      `confirm=${cfA.s} ${cfA.j?.error?.message ?? ''} e1=${(e1 ?? 'KHÔNG CHẶN').slice(0, 140)} e2=${e2 ? e2.slice(0, 80) : 'ok'}`)
    await restWrite('od_lineage', 'POST', null, { id: crypto.randomUUID(), old_od: OD[0], new_od: 'QA61ODNEW', kind: 'REPLACE', so_number: 'QA61SO', so_item: '10', updated_at: nowIso() })
    const e3 = await railErr('khvc_lines', khRow('QA61ODNEW', 'QA61RAIL_X3', DAY2))
    await restWrite('od_lineage', 'PATCH', `new_od=eq.QA61ODNEW`, { resolved_at: nowIso(), resolved_by: 'QA61', resolution: 'TEST', updated_at: nowIso() })
    const e4 = await railErr('khvc_lines', khRow('QA61ODNEW', 'QA61RAIL_X4', DAY2))
    check('17b. RÀO theo HỌ: DO mới thay cho DO đang ở KH xuất ngày khác → chặn, câu nêu "cùng họ" · quan hệ đã giải quyết → cho',
      /OD_ALREADY_PLANNED.*cùng họ/.test(e3 ?? '') && e4 === null, `e3=${(e3 ?? 'KHÔNG CHẶN').slice(0, 160)} e4=${e4 ? e4.slice(0, 80) : 'ok'}`)
    // cổng SAP ở KHO: chuyến Xuất kho của xe DA; DO1 bị SAP bỏ (mọi dòng OBSOLETE) ⇒ Bắt đầu chuyến 409 SAP_ISSUE_OPEN
    const gcA = khA.find(k => k.do_no === OD[0])?.group_code
    const gdoA = khA.find(k => k.do_no === OD[0])?.gdo_id ?? (gcA ? (await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${gcA}`))[0]?.id : null)
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[0]}`, { sync_status: 'OBSOLETE', updated_at: nowIso() })
    const st17 = gdoA ? await api(`/wms/outbound/${gdoA}/start`, 'POST', { license_plate: '29C12345' }) : { s: 0, j: null }
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[0]}`, { sync_status: 'ACTIVE', updated_at: nowIso() })
    check('17c. CỔNG SAP Ở KHO: chuyến có DO bị SAP bỏ (mọi dòng ZSD02 OBSOLETE) → Bắt đầu chuyến 409 SAP_ISSUE_OPEN nêu DO + đường gỡ (huỷ chuyến rồi điều lại)',
      st17.s === 409 && st17.j?.error?.code === 'SAP_ISSUE_OPEN' && (st17.j?.error?.message ?? '').includes(OD[0]) && /Bỏ bắt đầu/.test(st17.j?.error?.message ?? ''),
      `gdo=${gdoA ? 'có' : 'KHÔNG'} http=${st17.s} code=${st17.j?.error?.code} ${(st17.j?.error?.message ?? '').slice(0, 120)}`)
    // [17c2] (03/10, user chốt (b)) HỌ HÀNG ĐÃ ĐI: OD1 đã ở Kế hoạch xuất DAY (17a); SAP sinh ODSUP cùng dòng SO (cạnh AFTER_POST) giao DAY2
    // ⇒ nháp DAY2 thấy ODSUP ở khung chờ mang cờ KIN_SHIPPED (cứng — Xác nhận 409), rào DB chặn ODSUP vào Kế hoạch xuất DAY2;
    // "Xác nhận đơn bổ sung" ⇒ cạnh resolved (ai · SUPPLEMENT), cờ tắt, rào cho qua; OD lạ → 404; không có cạnh → 422 NOT_KIN
    const ODSUP = 'QA61ODSUP'
    await restWrite('erp_outbound_orders', 'POST', null, {
      id: crypto.randomUUID(), od_number: ODSUP, od_item: '10', material_code: FIX.MAT_POOL, qty_base: perPallet, so_number: 'QA61SOSUP', so_item: '10',
      ship_to_code: SHIP[0], ship_to_name: 'QA61 NPP 1', ward_code: W1, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY2, flow: 'SALE',
      source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso(),
    })
    await restWrite('od_lineage', 'POST', null, { id: crypto.randomUUID(), old_od: OD[0], new_od: ODSUP, kind: 'AFTER_POST', so_number: 'QA61SOSUP', so_item: '10', updated_at: nowIso() })
    const pS = await api('/tms/dispatch/plan', 'POST', { warehouse_id: WH, plan_date: DAY2 })
    const SID = pS.j?.data?.id ?? ''
    const decK = await api(decUrl)   // [17c3] hàng chờ Cần xử lý phải thấy họ hàng đã đi TRƯỚC khi người quyết
    const syS = await api(`/tms/dispatch/plans/${SID}/sync`)
    const flS = (syS.j?.data?.flags ?? []).find(x => x.od_number === ODSUP)
    const rS = rowOf(pS.j?.data, ODSUP)
    const mvS = rS ? await api(`/tms/dispatch/plans/${SID}/reoptimize`, 'POST', { review_all: true }) : { s: 0, j: null }   // máy ghép ODSUP lên xe (có dòng xe/ĐVVT) rồi mới thử Xác nhận
    const cfS = await api(`/tms/dispatch/plans/${SID}/confirm`, 'POST', {})
    const eS1 = await railErr('khvc_lines', khRow(ODSUP, 'QA61RAIL_S1', DAY2))
    const sup404 = await api(`/tms/dispatch/plans/${SID}/confirm-supplement`, 'POST', { od_numbers: ['QA61KHONGCO'] })
    const sup422 = await api(`/tms/dispatch/plans/${SID}/confirm-supplement`, 'POST', { od_numbers: [OD[1]] })
    const supOk = await api(`/tms/dispatch/plans/${SID}/confirm-supplement`, 'POST', { od_numbers: [ODSUP] })
    const edge = (await restAll('od_lineage', `select=resolved_at,resolved_by,resolution&new_od=eq.${ODSUP}`))[0]
    const syS2 = await api(`/tms/dispatch/plans/${SID}/sync`)
    const decK2 = await api(decUrl)
    const eS2 = await railErr('khvc_lines', khRow(ODSUP, 'QA61RAIL_S2', DAY2))
    const kinRow = qa61(decK).find(r => r.kind === 'KIN' && r.od_number === OD[0])
    check('17c3. Hàng chờ Cần xử lý (đợt 2): họ hàng đã đi ra dòng KIN (DO cũ · Số xe · DO mới cùng dòng SO) trước khi quyết · sau "Xác nhận đơn bổ sung" dòng hết',
      decK.s === 200 && !!kinRow && kinRow.group_code === gcA && (kinRow.new_ods ?? []).some(n => n.od === ODSUP) && decK2.s === 200 && !qa61(decK2).some(r => r.kind === 'KIN' && r.od_number === OD[0]),
      `dec=${decK.s} row=${JSON.stringify(kinRow ?? null)?.slice(0, 200)} after=${qa61(decK2).filter(r => r.kind === 'KIN').length}`)
    check('17c2. HỌ HÀNG ĐÃ ĐI: OD mới cùng dòng SO với OD đã đi → khung chờ nháp ngày khác, cờ KIN_SHIPPED nêu DO cũ + xe · Xác nhận 409 OD_CHANGED_IN_SAP · rào DB chặn vào KH xuất ngày khác · OD lạ 404 · không cạnh 422 NOT_KIN · "Xác nhận đơn bổ sung" → cạnh resolved SUPPLEMENT có người, cờ tắt, rào cho qua',
      pS.s === 201 && !!rS && flS?.kind === 'KIN_SHIPPED' && (flS?.info ?? '').includes(OD[0]) && mvS.s === 200
      && cfS.s === 409 && cfS.j?.error?.code === 'OD_CHANGED_IN_SAP' && /OD_ALREADY_PLANNED/.test(eS1 ?? '')
      && sup404.s === 404 && sup422.s === 422 && sup422.j?.error?.code === 'NOT_KIN'
      && supOk.s === 200 && supOk.j?.data?.supplement?.edges === 1 && !!edge?.resolved_at && edge?.resolution === 'SUPPLEMENT' && !!edge?.resolved_by
      && !(syS2.j?.data?.flags ?? []).some(x => x.od_number === ODSUP) && eS2 === null,
      `plan=${pS.s} inPool=${!!rS} flag=${JSON.stringify(flS ?? null)?.slice(0, 160)} move=${mvS.s} confirm=${cfS.s}/${cfS.j?.error?.code} rail1=${(eS1 ?? 'KHÔNG CHẶN').slice(0, 60)} 404=${sup404.s} 422=${sup422.s}/${sup422.j?.error?.code} ok=${supOk.s} ${supOk.j?.error?.message ?? ''} edge=${JSON.stringify(edge ?? null)} flagAfter=${(syS2.j?.data?.flags ?? []).some(x => x.od_number === ODSUP)} rail2=${eS2 ? eS2.slice(0, 60) : 'ok'}`)
    await restWrite('erp_outbound_orders', 'DELETE', `od_number=eq.${ODSUP}`).catch(() => {})
    await cleanupTrips()
    // khung chờ TỰ DO, xe thì khoá: nháp 16/03 và nháp 17/03 cùng kho đều thấy OD1 ở khung chờ; ghép ở A ⇒ OD rời khung chờ B
    const pA2 = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)
    const pB = await api('/tms/dispatch/plan', 'POST', { warehouse_id: WH, plan_date: DAY2 })
    const A2 = pA2.j?.data, B = pB.j?.data
    const BID = B?.id ?? ''   // máy quét độ phủ không đọc được `${B?.id}` trong đường dẫn
    check('17d. Khung chờ TỰ DO: nháp 16/03 và nháp 17/03 cùng kho đều thấy OD1 ở khung chờ, không "nằm ở nháp ngày khác" (bản cũ giữ cả khung chờ)',
      pA2.s === 201 && pB.s === 201 && !!rowOf(A2, OD[0]) && !rowOf(A2, OD[0])?.trip_id && !!rowOf(B, OD[0]) && !rowOf(B, OD[0])?.trip_id && !(B?.params?.excluded ?? []).some(x => x.kind === 'OTHER_DRAFT'),
      `A=${pA2.s} B=${pB.s} ${pB.j?.error?.message ?? ''} inA=${!!rowOf(A2, OD[0])} inB=${!!rowOf(B, OD[0])} exB=${JSON.stringify((B?.params?.excluded ?? []).map(x => x.kind))}`)
    const rA = await api(`/tms/dispatch/plans/${A2?.id}/reoptimize`, 'POST', { review_all: true })
    const B2 = await planOf(B?.id)
    const rfB = await api(`/tms/dispatch/plans/${BID}/refresh-pool`, 'POST', {})
    const exB = (rfB.j?.data?.params?.excluded ?? []).find(x => x.od_number === OD[0])
    check('17e. OD lên xe ở nháp 16/03 ⇒ rời khung chờ nháp 17/03 ngay (trigger) · nạp lại thấy OTHER_DRAFT kèm ref (nháp A, xe #, người lập)',
      rA.s === 200 && !rowOf(B2, OD[0]) && exB?.kind === 'OTHER_DRAFT' && exB?.ref?.plan_id === A2?.id && Number(exB?.ref?.seq) >= 1 && /xe #/.test(exB?.info ?? ''),
      `reopt=${rA.s} ${rA.j?.error?.message ?? ''} inB=${!!rowOf(B2, OD[0])} ex=${JSON.stringify(exB ?? null)?.slice(0, 220)}`)
    const tB = crypto.randomUUID()
    await restWrite('dispatch_trip', 'POST', null, { id: tB, plan_id: B?.id, seq: 1, group_code: 'QA61RAIL_GB', status: 'DRAFT', created_at: nowIso(), updated_at: nowIso() })
    const e5 = await railErr('dispatch_trip_od', { id: crypto.randomUUID(), plan_id: B?.id, trip_id: tB, od_number: OD[0], lines: 1, updated_at: nowIso() })
    await restWrite('dispatch_trip', 'DELETE', `id=eq.${tB}`).catch(() => {})
    check('17f. RÀO DB: OD đang trên xe nháp 16/03 mà lên xe nháp 17/03 → 23505 OD_ON_OTHER_PLAN (nêu nháp, xe, người)', /OD_ON_OTHER_PLAN/.test(e5 ?? ''), (e5 ?? 'KHÔNG CHẶN').slice(0, 160))
    // Kéo về đây: B kéo OD3 từ xe A ⇒ A mất OD3 (xe rỗng tự bỏ), B có OD3 ở khung chờ, vết ở cả hai
    const pull = await api(`/tms/dispatch/plans/${BID}/pull-od`, 'POST', { od_number: OD[2] })
    const A3 = await planOf(A2?.id)
    const pull404 = await api(`/tms/dispatch/plans/${BID}/pull-od`, 'POST', { od_number: 'QA61KHONGCO' })
    check('17g. Kéo về đây: OD3 rời xe nháp 16/03 (xe rỗng tự bỏ) → khung chờ nháp 17/03 · vết pull_log / pulled_away ở hai kế hoạch · OD không ở nháp khác → 404',
      pull.s === 200 && !!rowOf(pull.j?.data, OD[2]) && !rowOf(A3, OD[2]) && (pull.j?.data?.params?.pull_log ?? []).some(x => x.od_number === OD[2]) && (A3?.params?.pulled_away ?? []).some(x => x.od_number === OD[2]) && pull404.s === 404,
      `pull=${pull.s} ${pull.j?.error?.message ?? ''} inB=${!!rowOf(pull.j?.data, OD[2])} inA=${!!rowOf(A3, OD[2])} logB=${(pull.j?.data?.params?.pull_log ?? []).length} awayA=${(A3?.params?.pulled_away ?? []).length} 404=${pull404.s}`)
    // Ngoài app: dấu tay theo số OD · bảng dấu · GET coverage · bỏ dấu ⇒ về khung chờ · theo id dòng · lý do rỗng 400
    const outR = await api(`/tms/dispatch/plans/${BID}/outside`, 'POST', { od_numbers: [OD[2]], reason: 'QA61 đã điều tay ngoài app' })
    const outRow = (await restAll('dispatch_od_outside', `select=od_number,reason&warehouse_id=eq.${WH}&od_number=eq.${OD[2]}`))[0]
    // coverage đếm cả plant thật (Ba Vì ~16k dòng ZSD02) — staging NANO lúc bận trả 503 QUERY_TIMEOUT (quá tải, không phải hỏng): thử lại MỘT lần sau 4 s
    let covB = wh?.sap_plant ? await api(`/external/do-sap/coverage?plant=${wh.sap_plant}`) : { s: 0, j: null }
    if (covB.s === 503 && wh?.sap_plant) { await new Promise(r => setTimeout(r, 4000)); covB = await api(`/external/do-sap/coverage?plant=${wh.sap_plant}`) }
    const unR = await api(`/tms/dispatch/plans/${BID}/unoutside`, 'POST', { od_numbers: [OD[2]] })
    check('17h. Ngoài app: đánh dấu → OD rời khung chờ, excluded OUTSIDE_APP kèm lý do, bảng dấu có dòng · GET /do-sap/coverage 200 · bỏ dấu → về khung chờ',
      outR.s === 200 && !rowOf(outR.j?.data, OD[2]) && (outR.j?.data?.params?.excluded ?? []).some(x => x.od_number === OD[2] && x.kind === 'OUTSIDE_APP') && outRow?.reason === 'QA61 đã điều tay ngoài app'
      && covB.s === 200 && Array.isArray(covB.j?.data?.by_od_created) && unR.s === 200 && !!rowOf(unR.j?.data, OD[2]),
      `out=${outR.s} ${outR.j?.error?.message ?? ''} row=${!!outRow} cov=${covB.s} pending=${covB.j?.data?.pending_ods} un=${unR.s} back=${!!rowOf(unR.j?.data, OD[2])}`)
    const idB = rowOf(unR.j?.data, OD[2])?.id
    const outR2 = idB ? await api(`/tms/dispatch/plans/${BID}/outside`, 'POST', { ids: [idB], reason: 'QA61 SAP đã post' }) : { s: 0, j: null }
    const outBad = await api(`/tms/dispatch/plans/${BID}/outside`, 'POST', { od_numbers: [OD[1]], reason: '' })
    check('17h2. Ngoài app theo dòng kế hoạch (ids) → 200, OD rời khung chờ · lý do rỗng → 400', outR2.s === 200 && !rowOf(outR2.j?.data, OD[2]) && outBad.s === 400, `ids=${outR2.s} ${outR2.j?.error?.message ?? ''} bad=${outBad.s}`)
    // Đơn QUÁ cửa sổ chưa quyết: /stale liệt kê · Không điều theo số OD (không có dòng kế hoạch) → rời danh sách.
    // Ngày giao đặt RẤT cũ (2020) vì /stale trả 500 dòng cũ nhất — kho Ba Vì thật có ~3.600 đơn quá hạn, ngày 2027 sẽ bị cắt khỏi trang đầu
    const ODST = 'QA61ODSTALE'
    await restWrite('erp_outbound_orders', 'POST', null, { id: crypto.randomUUID(), od_number: ODST, od_item: '10', material_code: FIX.MAT_POOL, qty_base: perPallet, ship_to_code: SHIP[0], ship_to_name: 'QA61 NPP 1', ward_code: W1, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: '2020-01-01', flow: 'SALE', source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso() })
    const stl = await api(`/tms/dispatch/plans/${BID}/stale`)
    const hs = await api(`/tms/dispatch/plans/${BID}/hold`, 'POST', { od_numbers: [ODST], until: null, reason: 'QA61 quá hạn — không điều' })
    const stl2 = await api(`/tms/dispatch/plans/${BID}/stale`)
    check('17i. Đơn QUÁ cửa sổ chưa quyết: GET /stale liệt kê · Không điều theo số OD (không có dòng trên kế hoạch) → 200 · rời danh sách quá hạn',
      stl.s === 200 && (stl.j?.data?.rows ?? []).some(r => r.od_number === ODST) && hs.s === 200 && stl2.s === 200 && !(stl2.j?.data?.rows ?? []).some(r => r.od_number === ODST),
      `stale=${stl.s} n=${stl.j?.data?.count} có=${(stl.j?.data?.rows ?? []).some(r => r.od_number === ODST)} hold=${hs.s} ${hs.j?.error?.message ?? ''} sau=${(stl2.j?.data?.rows ?? []).some(r => r.od_number === ODST)}`)
    await restWrite('erp_outbound_orders', 'DELETE', `od_number=eq.${ODST}`).catch(() => {})

    // ── [18] ĐỢT 2 VÒNG ĐỜI OD (03/10): hàng chờ "Cần xử lý" của điều vận (RPC dispatch_decisions) + gỡ / đổi số DO bậc Đã xác nhận
    // (POST /dispatch/khvc/remove · /renumber) + tiến độ kho ở /review + "Lập lại" đè nháp người khác (409 PLAN_RECENTLY_EDITED) ──
    await cleanupTrips()
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=in.(${OD.join(',')})`, { sync_status: 'ACTIVE', replaced_by_od: null, updated_at: nowIso() })
    const p18 = await mkPlan(PLAN_BODY)            // DAY: OD1+OD2 xe 1 · OD3 xe 2 (HA không cần phản hồi từ [16])
    const P18 = p18.j?.data
    const cf18 = await api(`/tms/dispatch/plans/${P18?.id}/confirm`, 'POST', {})
    // khvc_lines.gdo_id KHÔNG được cửa nào ghi (0/63 dòng staging) — chuyến bên Xuất tra theo Số xe (lượt đầu 18a–18e đỏ vì tin cột đó)
    const kh18 = await restAll('khvc_lines', `select=do_no,group_code,export_date&group_code=like.${PREFIX}*`)
    const gc3 = kh18.find(k => k.do_no === OD[2])?.group_code ?? '', gc1 = kh18.find(k => k.do_no === OD[0])?.group_code ?? ''
    const gdo1 = gc1 ? (await restAll('GroupDeliveryOrder', `select=id,status&group_code=eq.${gc1}&order=created_at.desc`))[0]?.id ?? null : null
    const d0 = await api(decUrl)
    const rv18 = await api(`/tms/dispatch/plans/${P18?.id}/review`)
    const k1 = rv18.j?.data?.ods?.[OD[0]]?.khvc
    check('18a. Hàng chờ Cần xử lý: kế hoạch vừa xác nhận khớp ZSD02 → 0 việc QA61 · /review trả TIẾN ĐỘ KHO của OD đã vào KH xuất (Số xe · chuyến Chờ xuất, tra theo Số xe)',
      cf18.s === 200 && !!gdo1 && d0.s === 200 && qa61(d0).length === 0 && k1?.group_code === gc1 && k1?.gdo_status === 'PENDING' && k1?.gdo_id === gdo1,
      `confirm=${cf18.s} ${cf18.j?.error?.message ?? ''} replan_err=${cf18.j?.data?.confirmed?.replan_error ?? cf18.j?.data?.replan_error ?? ''} gdo1=${gdo1 ? 'có' : 'KHÔNG'} dec=${d0.s} n=${qa61(d0).length} khvc=${JSON.stringify(k1 ?? null)}`)
    // 18b — SAP THAY OD3 bằng QA61ODR3 (cùng khách, cùng SL): dòng REPLACED, chuyến Chờ xuất, DO mới trống ⇒ "Đổi số DO"
    const ODR3 = 'QA61ODR3'
    // DO mới chép ĐÚNG khách + tổng SL hiện tại của OD3 (các mục trước có thể đã sửa SL của OD3) ⇒ `same_content` phải true
    const od3Rows = await restAll('erp_outbound_orders', `select=qty_base,ship_to_code&od_number=eq.${OD[2]}&sync_status=eq.ACTIVE`)
    const od3Qty = od3Rows.reduce((s, r) => s + Number(r.qty_base ?? 0), 0) || PAL[2] * perPallet
    await restWrite('erp_outbound_orders', 'POST', null, { id: crypto.randomUUID(), od_number: ODR3, od_item: '10', material_code: FIX.MAT_POOL, qty_base: od3Qty, so_number: 'QA61SO3', so_item: '10',
      ship_to_code: od3Rows[0]?.ship_to_code ?? SHIP[2], ship_to_name: 'QA61 NPP 3', ward_code: W2, region_code: REGION, plant: wh?.sap_plant ?? null, delivery_date: DAY, flow: 'SALE', source: 'EXCEL', sync_status: 'ACTIVE', last_synced_at: nowIso(), updated_at: nowIso() })
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[2]}`, { sync_status: 'OBSOLETE', replaced_by_od: ODR3, replaced_at: nowIso(), updated_at: nowIso() })
    await restWrite('od_lineage', 'POST', null, { id: crypto.randomUUID(), old_od: OD[2], new_od: ODR3, kind: 'REPLACE', so_number: 'QA61SO3', so_item: '10', updated_at: nowIso() })
    const d1 = await api(decUrl)
    const r1 = qa61(d1).find(r => r.od_number === OD[2])
    const rn = await api('/tms/dispatch/khvc/renumber', 'POST', { warehouse_id: WH, od_number: OD[2], group_code: gc3 })
    const kh2 = await restAll('khvc_lines', `select=do_no,group_code,export_date&group_code=eq.${gc3}`)
    const edgeR = (await restAll('od_lineage', `select=resolved_at,resolution,resolved_by&old_od=eq.${OD[2]}&new_od=eq.${ODR3}`))[0]
    const tripOd = await restAll('dispatch_trip_od', `select=od_number&plan_id=eq.${P18?.id}&od_number=eq.${ODR3}`)
    const d2 = await api(decUrl)
    check('18b. SAP thay OD3 → QA61ODR3: hàng chờ ra dòng REPLACED (Chờ xuất · DO mới trống · cùng khách cùng SL) · "Đổi số DO" → KH xuất mang số mới cùng Số xe/ngày · cạnh phả hệ resolved RENUMBER có người · dòng OD trên xe đổi theo · hàng chờ hết dòng',
      r1?.kind === 'REPLACED' && r1?.gdo_status === 'PENDING' && r1?.all_free === true && r1?.same_content === true && (r1?.new_ods ?? [])[0]?.od === ODR3
      && rn.s === 200 && rn.j?.data?.to?.[0] === ODR3 && kh2.some(k => k.do_no === ODR3 && k.export_date === DAY) && !kh2.some(k => k.do_no === OD[2])
      && edgeR?.resolution === 'RENUMBER' && !!edgeR?.resolved_by && tripOd.length === 1 && !qa61(d2).some(r => r.od_number === OD[2]),
      `row=${r1?.kind}/${r1?.gdo_status}/free=${r1?.all_free}/same=${r1?.same_content}/new=${(r1?.new_ods ?? []).map(n => n.od).join(',')} rn=${rn.s} ${rn.j?.error?.message ?? ''} to=${JSON.stringify(rn.j?.data?.to)} kh=${kh2.map(k => k.do_no).join(',')} edge=${JSON.stringify(edgeR ?? null)} tripOd=${tripOd.length} after=${qa61(d2).length}`)
    // 18c — SAP BỎ OD1 (xe 1 còn OD khác — OD16A–C vẫn ACTIVE từ [16] nên xe 1 không chắc là OD1+OD2): dòng GONE chưa bắt đầu →
    // "Gỡ khỏi kế hoạch" có lý do → KH xuất của xe còn dòng, chuyến còn sống, nhật ký có lý do
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${OD[0]}`, { sync_status: 'OBSOLETE', updated_at: nowIso() })
    const d3 = await api(decUrl)
    const r3 = qa61(d3).find(r => r.od_number === OD[0])
    const rm = await api('/tms/dispatch/khvc/remove', 'POST', { warehouse_id: WH, od_number: OD[0], group_code: gc1, reason: 'QA61 SAP bỏ DO — điều lại' })
    const kh3 = await restAll('khvc_lines', `select=do_no&group_code=eq.${gc1}`)
    // replan dựng lại chuyến PENDING như re-upload ⇒ id chuyến có thể ĐỔI — tra lại theo Số xe (lượt 2 bắt: id cũ không còn)
    const g1 = (await restAll('GroupDeliveryOrder', `select=id,status,plan_dropped&group_code=eq.${gc1}&order=created_at.desc`))[0] ?? null
    const gdo1b = g1?.id ?? null
    const ev = await restAll('outbound_events', `select=event_type,detail,do_number&group_code=eq.${gc1}&event_type=eq.PLAN_DO_REMOVED&do_number=eq.${OD[0]}`)
    const rm404 = await api('/tms/dispatch/khvc/remove', 'POST', { warehouse_id: WH, od_number: OD[0], group_code: gc1 })
    const d4 = await api(decUrl)
    check('18c. SAP bỏ OD1: hàng chờ ra dòng GONE (chuyến Chờ xuất) · "Gỡ khỏi kế hoạch" (lý do) → KH xuất của xe còn dòng khác, chuyến bên Xuất còn sống, nhật ký PLAN_DO_REMOVED có lý do · gỡ lần nữa → 404 · hàng chờ hết dòng',
      r3?.kind === 'GONE' && r3?.gdo_status === 'PENDING' && r3?.gdo_id === gdo1 && rm.s === 200 && rm.j?.data?.removed === 1 && !kh3.some(k => k.do_no === OD[0]) && kh3.length >= 1
      && g1?.status === 'PENDING' && g1?.plan_dropped !== true && ev.some(e => /QA61 SAP bỏ DO/.test(e.detail ?? '')) && rm404.s === 404 && !qa61(d4).some(r => r.od_number === OD[0]),
      `row=${r3?.kind}/${r3?.gdo_status}/${r3?.gdo_id === gdo1} rm=${rm.s} ${rm.j?.error?.message ?? ''} kh=${kh3.map(k => k.do_no).join(',')} gdo=${JSON.stringify(g1)} ev=${ev.length} 404=${rm404.s} after=${qa61(d4).some(r => r.od_number === OD[0])}`)
    // 18d — KHO ĐANG XUẤT (cột C): chuyến xe 1 IN_PROGRESS, SAP bỏ một DO còn lại của xe ⇒ dòng ghi "đang xuất"; gỡ / đổi số → 409 (đường (c): huỷ rồi điều lại)
    const ODC = kh3[0]?.do_no ?? OD[1]
    if (gdo1b) await restWrite('GroupDeliveryOrder', 'PATCH', `id=eq.${gdo1b}`, { status: 'IN_PROGRESS', started_at: nowIso(), updated_at: nowIso() })
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${ODC}`, { sync_status: 'OBSOLETE', updated_at: nowIso() })
    const d5 = await api(decUrl)
    const r5 = qa61(d5).find(r => r.od_number === ODC)
    const rmC = await api('/tms/dispatch/khvc/remove', 'POST', { warehouse_id: WH, od_number: ODC, group_code: gc1, reason: 'QA61' })
    const rnC = await api('/tms/dispatch/khvc/renumber', 'POST', { warehouse_id: WH, od_number: ODC, group_code: gc1, new_ods: [ODR3] })
    if (gdo1b) await restWrite('GroupDeliveryOrder', 'PATCH', `id=eq.${gdo1b}`, { status: 'PENDING', started_at: null, updated_at: nowIso() })
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=eq.${ODC}`, { sync_status: 'ACTIVE', updated_at: nowIso() })
    check('18d. Kho ĐANG XUẤT chuyến có DO bị SAP bỏ: hàng chờ ghi trạng thái đang xuất · gỡ → 409 KHVC_LINE_LOCKED nêu đường (c) "Bỏ bắt đầu" · đổi số → 409',
      !!gdo1b && r5?.kind === 'GONE' && r5?.gdo_status === 'IN_PROGRESS' && rmC.s === 409 && rmC.j?.error?.code === 'KHVC_LINE_LOCKED' && /Bỏ bắt đầu/.test(rmC.j?.error?.message ?? '') && rnC.s === 409,
      `od=${ODC} gdo=${gdo1b ? 'có' : 'KHÔNG'} row=${r5?.kind}/${r5?.gdo_status} rm=${rmC.s}/${rmC.j?.error?.code} ${(rmC.j?.error?.message ?? '').slice(0, 100)} rn=${rnC.s}/${rnC.j?.error?.code}`)
    // 18e — SAP đổi SL sau khi kho quét = việc reconcile OPEN ⇒ hàng chờ liệt kê kind QTY kèm task (chỉ dẫn link, không nhân đôi nút)
    const tkId = crypto.randomUUID()
    await restWrite('reconcile_tasks', 'POST', null, { id: tkId, gdo_id: gdo1b, group_code: gc1, od_number: ODC, od_item: '10', change_type: 'QTY_DECREASE', zone: 'Z3', action: 'NEEDS_REVIEW', status: 'OPEN', old_ordered: 100, new_ordered: 80, scanned: 90, detail: 'QA61 SAP giảm còn 80 đã quét 90', created_at: nowIso(), updated_at: nowIso() })
    const d6 = await api(decUrl)
    const r6 = qa61(d6).find(r => r.kind === 'QTY' && r.task_id === tkId)
    await restWrite('reconcile_tasks', 'DELETE', `id=eq.${tkId}`).catch(() => {})
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=in.(${OD.join(',')})`, { sync_status: 'ACTIVE', replaced_by_od: null, updated_at: nowIso() })
    check('18e. SAP đổi SL sau khi kho quét (việc reconcile OPEN) → hàng chờ ra dòng QTY nêu task + chi tiết', !!r6 && r6.gdo_status === 'PENDING' && /QA61 SAP giảm/.test(r6.detail ?? ''), `row=${JSON.stringify(r6 ?? null)?.slice(0, 160)}`)
    // 18f — LẬP LẠI đè nháp NGƯỜI KHÁC vừa cập nhật → 409 PLAN_RECENTLY_EDITED nêu tên; force → 201 (một nháp mỗi kho × ngày — lưới cho nhiều điều vận)
    const pB2 = await api('/tms/dispatch/plan', 'POST', { warehouse_id: WH, plan_date: DAY2 })
    await restWrite('dispatch_plan', 'PATCH', `id=eq.${pB2.j?.data?.id}`, { created_by: 'QA61 Người khác', updated_at: nowIso() })
    const again = await api('/tms/dispatch/plan', 'POST', { warehouse_id: WH, plan_date: DAY2 })
    const forced = await api('/tms/dispatch/plan', 'POST', { warehouse_id: WH, plan_date: DAY2, force: true })
    check('18f. Lập lại đè nháp của NGƯỜI KHÁC vừa cập nhật → 409 PLAN_RECENTLY_EDITED nêu tên · force → 201',
      pB2.s === 201 && again.s === 409 && again.j?.error?.code === 'PLAN_RECENTLY_EDITED' && /QA61 Người khác/.test(again.j?.error?.message ?? '') && forced.s === 201,
      `first=${pB2.s} again=${again.s}/${again.j?.error?.code} forced=${forced.s} ${forced.j?.error?.message ?? ''}`)
    await restWrite('erp_outbound_orders', 'DELETE', `od_number=eq.${ODR3}`).catch(() => {})

    // ── [19] MẢNG Trung chuyển / Bán hàng (03/10 tối — user: "một kế hoạch tổng, mỗi người lo một mảng; khách setting Trung chuyển tự vào
    // Trung chuyển, còn lại Bán hàng; user lấy được DO của bên kia; lên kế hoạch riêng cho hai mảng") + "Không liên quan" theo từng người ──
    await cleanupTrips()
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=in.(${OD.join(',')})`, { sync_status: 'ACTIVE', replaced_by_od: null, updated_at: nowIso() })
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=like.QA61OD16*`, { sync_status: 'OBSOLETE', updated_at: nowIso() })   // chỉ còn OD1–3 cho dễ đếm
    const c3_19 = (await restAll('Customer', `select=id&ship_to_code=eq.${SHIP[2]}`))[0]
    const tk3_19 = await api(`/masterdata/customers/${c3_19?.id}`, 'PUT', { dispatch_transfer: true })
    const pS19 = await api('/tms/dispatch/plan', 'POST', PLAN_BODY)                                   // Bán hàng (mặc định)
    const pT19 = await api('/tms/dispatch/plan', 'POST', { ...PLAN_BODY, segment: 'TRANSFER' })      // Trung chuyển — kế hoạch RIÊNG cùng kho × ngày
    const S = pS19.j?.data, T = pT19.j?.data
    const SID19 = S?.id ?? '', TID19 = T?.id ?? ''
    check('19a. Khách tick "Trung chuyển" → kế hoạch Bán hàng có OD1, OD2, KHÔNG có OD3 · kế hoạch Trung chuyển (riêng, cùng kho × ngày, cùng mở) chỉ có OD3 · cột segment ghi đúng',
      tk3_19.s === 200 && pS19.s === 201 && pT19.s === 201 && S?.segment === 'SALES' && T?.segment === 'TRANSFER' && !!rowOf(S, OD[0]) && !!rowOf(S, OD[1]) && !rowOf(S, OD[2]) && !!rowOf(T, OD[2]) && !rowOf(T, OD[0]) && !rowOf(T, OD[1]),
      `tick=${tk3_19.s} S=${pS19.s}/${S?.segment} ${pS19.j?.error?.message ?? ''} T=${pT19.s}/${T?.segment} ${pT19.j?.error?.message ?? ''} S:[${[0, 1, 2].map(i => !!rowOf(S, OD[i])).join(',')}] T:[${[0, 1, 2].map(i => !!rowOf(T, OD[i])).join(',')}]`)
    // 19b — sync Bán hàng không coi OD3 là "OD mới" · lấy OD1 sang Trung chuyển (dấu kho × OD) · nạp OD mới bên Bán hàng không kéo OD1 về
    const sy19 = await api(`/tms/dispatch/plans/${SID19}/sync`)
    const take1 = await api('/tms/dispatch/segment/take', 'POST', { warehouse_id: WH, od_numbers: [OD[0]], segment: 'TRANSFER', ...(TID19 ? { plan_id: TID19 } : {}) })
    const S19b = await planOf(SID19), T19b = await planOf(TID19)
    const segRow = (await restAll('dispatch_od_segment', `select=segment,created_by&warehouse_id=eq.${WH}&od_number=eq.${OD[0]}`))[0]
    const rf19 = await api(`/tms/dispatch/plans/${SID19}/refresh-pool`, 'POST', {})
    const syT = await api(`/tms/dispatch/plans/${TID19}/sync`)
    check('19b. /sync Bán hàng không đếm OD3 là OD mới · "Lấy sang Trung chuyển" OD1 → rời khung chờ Bán hàng, vào khung chờ Trung chuyển, dấu (kho, OD)=TRANSFER có người · nạp OD mới bên Bán hàng KHÔNG kéo OD1 về · /sync Trung chuyển không báo OD1/OD2 mới',
      sy19.s === 200 && !(sy19.j?.data?.new_od_numbers ?? []).includes(OD[2]) && take1.s === 200 && take1.j?.data?.added_to_plan === 1 && !rowOf(S19b, OD[0]) && !!rowOf(T19b, OD[0])
      && segRow?.segment === 'TRANSFER' && !!segRow?.created_by && rf19.s === 200 && !rowOf(rf19.j?.data, OD[0]) && syT.s === 200 && Number(syT.j?.data?.new_ods) === 0,
      `syncS=${sy19.s} new=${JSON.stringify(sy19.j?.data?.new_od_numbers)} take=${take1.s} ${take1.j?.error?.message ?? ''} added=${take1.j?.data?.added_to_plan} inS=${!!rowOf(S19b, OD[0])} inT=${!!rowOf(T19b, OD[0])} seg=${JSON.stringify(segRow ?? null)} refresh=${rf19.s} back=${!!rowOf(rf19.j?.data, OD[0])} syncT=${syT.s}/${syT.j?.data?.new_ods}`)
    // 19c — "Không liên quan" theo NGƯỜI trên kế hoạch Bán hàng: GET kế hoạch trả `hidden` của chính người xem; bỏ dấu → hết
    const hd19 = await api(`/tms/dispatch/plans/${SID19}/hide`, 'POST', { od_numbers: [OD[1]] })
    const gS19 = await api(`/tms/dispatch/plans/${SID19}`)
    const hdRow19 = (await restAll('dispatch_od_hidden', `select=user_id&plan_id=eq.${SID19}&od_number=eq.${OD[1]}`))[0]
    const unhd19 = await api(`/tms/dispatch/plans/${SID19}/unhide`, 'POST', { od_numbers: [OD[1]] })
    const gS19b = await api(`/tms/dispatch/plans/${SID19}`)
    check('19c. "Không liên quan" theo người: đánh dấu → GET kế hoạch trả hidden=[OD2] cho chính người đó (dòng có user_id), OD2 VẪN ở khung chờ kế hoạch (người khác thấy) · bỏ dấu → hidden rỗng',
      hd19.s === 200 && (hd19.j?.data?.hidden ?? []).includes(OD[1]) && (gS19.j?.data?.hidden ?? []).includes(OD[1]) && !!rowOf(gS19.j?.data, OD[1]) && !!hdRow19?.user_id && unhd19.s === 200 && (gS19b.j?.data?.hidden ?? []).length === 0,
      `hide=${hd19.s} ${hd19.j?.error?.message ?? ''} hidden=${JSON.stringify(gS19.j?.data?.hidden)} inPool=${!!rowOf(gS19.j?.data, OD[1])} user=${hdRow19?.user_id ? 'có' : 'KHÔNG'} unhide=${unhd19.s} after=${JSON.stringify(gS19b.j?.data?.hidden)}`)
    // 19d — hai mảng ghép xe RIÊNG → Số xe KHÔNG trùng giữa hai kế hoạch cùng kho × ngày (nextSeq đếm cả kế hoạch mảng kia)
    const gpS19 = await api(`/tms/dispatch/plans/${SID19}/reoptimize`, 'POST', { review_all: true })
    const gpT19 = await api(`/tms/dispatch/plans/${TID19}/reoptimize`, 'POST', { review_all: true })
    const gcS19 = (gpS19.j?.data?.trips ?? []).filter(t => t.ods?.length).map(t => t.group_code), gcT19 = (gpT19.j?.data?.trips ?? []).filter(t => t.ods?.length).map(t => t.group_code)
    const dup19 = gcS19.filter(g => gcT19.includes(g))
    // lấy OD2 đang trên XE NHÁP bên Bán hàng sang Trung chuyển → xe bên đó rỗng tự bỏ, OD2 vào khung chờ Trung chuyển
    const take2 = await api('/tms/dispatch/segment/take', 'POST', { warehouse_id: WH, od_numbers: [OD[1]], segment: 'TRANSFER', ...(TID19 ? { plan_id: TID19 } : {}) })
    const S19c = await planOf(SID19), T19c = await planOf(TID19)
    check('19d. Hai mảng ghép riêng → Số xe không trùng giữa hai kế hoạch cùng kho × ngày · lấy OD2 đang trên xe NHÁP Bán hàng sang Trung chuyển → xe rỗng bên Bán hàng tự bỏ, OD2 vào khung chờ Trung chuyển, vết taken_away',
      gpS19.s === 200 && gpT19.s === 200 && gcS19.length >= 1 && gcT19.length >= 1 && dup19.length === 0 && take2.s === 200 && (take2.j?.data?.moved_from ?? [])[0]?.rows === 1 && (take2.j?.data?.moved_from ?? [])[0]?.trips_removed === 1
      && !(S19c?.trips ?? []).some(t => t.ods?.some(o => o.od_number === OD[1])) && !!rowOf(T19c, OD[1]) && !rowOf(T19c, OD[1])?.trip_id && (S19c?.params?.taken_away ?? []).some(x => x.od_number === OD[1]),
      `gS19=${gpS19.s} ${gcS19.join(',')} gT=${gpT19.s} ${gcT19.join(',')} dup19=${dup19.join(',')} take2=${take2.s} ${take2.j?.error?.message ?? ''} moved=${JSON.stringify(take2.j?.data?.moved_from)} inT=${!!rowOf(T19c, OD[1])} away=${(S19c?.params?.taken_away ?? []).length}`)
    // 19e — xe đã CHỐT bên kia thì không lấy đơn được (409) — Trung chuyển ghép lại + xác nhận (3 OD), rồi Bán hàng đòi OD3
    const gpT19b = await api(`/tms/dispatch/plans/${TID19}/reoptimize`, 'POST', { review_all: true })
    const cfT19 = await api(`/tms/dispatch/plans/${TID19}/confirm`, 'POST', {})
    const kh19 = await restAll('khvc_lines', `select=do_no,group_code&group_code=like.${PREFIX}*`)
    const take3 = await api('/tms/dispatch/segment/take', 'POST', { warehouse_id: WH, od_numbers: [OD[2]], segment: 'SALES' })
    check('19e. Trung chuyển ghép lại + xác nhận → 3 OD vào Kế hoạch xuất · lấy đơn đang ở kế hoạch ĐÃ CHỐT (không còn mở) → chỉ ghi dấu, không đụng Kế hoạch xuất (200, moved_from rỗng)',
      gpT19b.s === 200 && cfT19.s === 200 && [0, 1, 2].every(i => kh19.some(k => k.do_no === OD[i])) && take3.s === 200 && (take3.j?.data?.moved_from ?? []).length === 0 && kh19.some(k => k.do_no === OD[2]),
      `gT2=${gpT19b.s} cf=${cfT19.s} ${cfT19.j?.error?.message ?? ''} kh=${kh19.map(k => k.do_no).join(',')} take3=${take3.s} moved=${JSON.stringify(take3.j?.data?.moved_from)}`)
    await restWrite('Customer', 'PATCH', `id=eq.${c3_19?.id}`, { dispatch_transfer: false }).catch(() => {})
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=like.QA61OD16*`, { sync_status: 'ACTIVE', updated_at: nowIso() })
    await cleanupTrips()
    // trả OD1–3 về OBSOLETE như [16] đã đặt — không thì [16d] ghép 4+3+3 của OD1–3 lẫn 4+3+3 của OD16A–C thành 9+6+5
    await restWrite('erp_outbound_orders', 'PATCH', `od_number=in.(${OD.join(',')})`, { sync_status: 'OBSOLETE', updated_at: nowIso() })
  }
  // [16c–16d] tiếp — cần kế hoạch p16 còn nguyên: dựng lại nếu [17] đã dọn (cleanupTrips xoá mọi kế hoạch của kho × DAY)
  {
    const again16 = await api('/tms/dispatch/plan', 'POST', { ...PLAN_BODY, load_bands: { [XEPALLET.id]: { min: 80, max: 115 } } })
    if (again16.s === 201) { p16Id = again16.j?.data?.id; await api(`/tms/dispatch/plans/${p16Id}/reoptimize`, 'POST', { review_all: true }) }
  }
    const bad = await api(`/tms/dispatch/plans/${p16Id}/params`, 'PATCH', { load_bands: { [XEPALLET.id]: { min: 50, max: 200 } } })
    const bad2 = await api(`/tms/dispatch/plans/${p16Id}/params`, 'PATCH', { load_bands: { [XEPALLET.id]: { min: 90, max: 80 } } })
    check('16c. Dải sai (trần 200 % · tối thiểu > tối đa) → 400, không ghi', bad.s === 400 && bad2.s === 400, `max200=${bad.s} min>max=${bad2.s}`)
    const back = await api(`/tms/dispatch/plans/${p16Id}/reoptimize`, 'POST', { review_all: true, load_bands: { [XEPALLET.id]: { min: 70, max: 100 } } })
    const tBack = (back.j?.data?.trips ?? []).filter(t => t.ods?.length).map(t => Number(t.pallets)).sort((a, b) => b - a)
    check('16d. Tối ưu lại với dải 70–100 % gửi kèm: máy xếp lại thành 2 xe (7 + 3) — dải của lượt ghép thắng dải cũ của kế hoạch',
      back.s === 200 && tBack.join('+') === '7+3' && bandEq(back.j?.data?.params?.load_bands, 70, 100),
      `s=${back.s} xe=${tBack.join('+')} bands=${JSON.stringify(back.j?.data?.params?.load_bands)}`)
  } else check('16a. Fixture: cần Loại xe cha XEPALLET', false)
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
