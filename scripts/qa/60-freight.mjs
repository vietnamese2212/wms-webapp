// GÓI 60 — CƯỚC VẬN CHUYỂN + DÒNG XE CHA–CON (đợt 1 TMS điều vận, 23/09; plan docs/plans/TMS_DISPATCH_PLAN.md 5.3 · 6.0–6.4).
// Bốn điều user chốt 23/09 mà gói này khoá lại:
//   [1] Dòng xe CON mang mã SAP nằm dưới CHA (VehicleType); seed 60 dòng, gán cha hàng loạt; cha rác → 400.
//   [2] Bảng cước khoá (kho × ĐVVT × dòng con × phường × hiệu lực); cùng khoá lần hai → 409; upload 2 pha
//       all-or-nothing, kiểm-trước phải nói đúng thêm / đè giá / không đổi.
//   [3] Phụ phí theo kho × ĐVVT, loại phải có trong danh mục; rớt điểm có min_stops + count_mode.
//   [4] Phân tuyến: ưu tiên khu vực + tỷ trọng, Σ tỷ trọng một kho ≤ 100 %.
// Fixture QA60_*: dựng qua API thật, dọn bằng PostgREST.
import { login, api, restAll, restWrite, resolveFixtures, FIX, BASE, authToken, check, finish } from './lib.mjs'

const XLSX = (await import('../../backend/node_modules/xlsx/xlsx.mjs')).default
  ?? await import('../../backend/node_modules/xlsx/xlsx.mjs')
const PACK = '60-freight'
const SAP = 'QA60X01', WARD1 = 'QA60-Test', WARD2 = 'QA60-Test2'

await login(); await resolveFixtures()
const WH = FIX.WH_QR.id
const cos = await restAll('TransportCompany', `select=id,code,name&code=in.(DA,HA)`)
const DA = cos.find(c => c.code === 'DA'), HA = cos.find(c => c.code === 'HA')
if (!DA || !HA) throw new Error('Fixture: cần ĐVVT DA và HA trong danh mục TransportCompany')
const parents = (await api('/tms/vehicle-types')).j?.data ?? []
const XEPALLET = parents.find(p => p.code === 'XEPALLET')

async function upload(path, buf, extra = {}) {
  const fd = new FormData(); fd.append('file', new Blob([buf]), 'cuoc.xlsx')
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  const r = await fetch(`${BASE}/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${authToken()}` }, body: fd })
  let j = null; try { j = JSON.parse(await r.text()) } catch { /* */ }
  return { s: r.status, j }
}
const xlsxOf = (rows) => { const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Cuoc'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) }
const tariffRow = (o) => ({
  'Tỉnh/TP (Cũ)': 'QA', 'Quận/Huyện (Cũ)': 'QA', 'Tỉnh/TP (Mới)': 'QA60 Tỉnh', 'Phường/Xã (Mới)': o.ward, 'Cự ly (Km)': o.km ?? 12,
  'DVVT': o.dvvt ?? 'Đông Á', 'Loại xe': 'QA60 Xe 9 Pallet', 'Cước (VND)': o.price, 'Mã xe SAP': o.sap ?? SAP,
})

async function cleanup() {
  const vm = await restAll('vehicle_model', `select=id&sap_code=like.QA60*`)
  const ids = vm.map(v => v.id)
  if (ids.length) {
    await restWrite('freight_tariff', 'DELETE', `vehicle_model_id=in.(${ids.join(',')})`).catch(() => {})
    await restWrite('freight_surcharge', 'DELETE', `vehicle_model_id=in.(${ids.join(',')})`).catch(() => {})
  }
  await restWrite('freight_tariff', 'DELETE', `ward_code=like.QA60*`).catch(() => {})
  await restWrite('freight_surcharge', 'DELETE', `note=like.QA60*`).catch(() => {})
  await restWrite('carrier_allocation', 'DELETE', `area_code=like.QA60*`).catch(() => {})
  await restWrite('carrier_share_target', 'DELETE', `note=like.QA60*`).catch(() => {})
  if (ids.length) await restWrite('vehicle_model', 'DELETE', `id=in.(${ids.join(',')})`).catch(() => {})
}
await cleanup()

try {
  // ── [1] Dòng xe con ──
  const list = await api('/tms/vehicle-models')
  const seeded = list.j?.data?.items ?? []
  const m30 = seeded.find(m => m.sap_code === '910000030')
  check('1a. GET vehicle-models: seed ≥ 60 dòng, 910000030 = 16 pallet · PER_PALLET · PALLET', list.s === 200 && seeded.length >= 60
    && m30?.max_pallets === 16 && m30?.tariff_unit === 'PER_PALLET' && m30?.capacity_mode === 'PALLET',
    `http=${list.s} n=${seeded.length} m30=${JSON.stringify(m30 ? { p: m30.max_pallets, u: m30.tariff_unit } : null)}`)
  const m05 = seeded.find(m => m.sap_code === '910000005')
  check('1a2. 910000005 "Xe tải 3,5 tấn (nóng)" parse = 3,5 tấn · HOT · PER_TRIP', Number(m05?.max_tons) === 3.5 && m05?.temp_mode === 'HOT' && m05?.tariff_unit === 'PER_TRIP', JSON.stringify(m05 ? { t: m05.max_tons, tm: m05.temp_mode, u: m05.tariff_unit } : null))

  const cr = await api('/tms/vehicle-models', 'POST', { sap_code: SAP, name: 'QA60 Xe 9 Pallet', capacity_mode: 'PALLET', max_pallets: 9, tariff_unit: 'PER_PALLET' })
  const vmId = cr.j?.data?.id
  check('1b. POST vehicle-models → 201 (cha NULL = chưa gán)', cr.s === 201 && !!vmId && cr.j?.data?.parent_type_id === null, `http=${cr.s}`)
  const dup = await api('/tms/vehicle-models', 'POST', { sap_code: SAP, name: 'trùng', capacity_mode: 'PALLET', max_pallets: 9 })
  check('1b2. POST cùng mã SAP lần hai → 409', dup.s === 409, `http=${dup.s}`)
  const badP = await api('/tms/vehicle-models/assign-parent', 'PATCH', { ids: [vmId], parent_type_id: 'khong-co-that' })
  check('1c. Gán cha rác → 400', badP.s === 400, `http=${badP.s}`)
  const asg = await api('/tms/vehicle-models/assign-parent', 'PATCH', { ids: [vmId], parent_type_id: XEPALLET?.id })
  const after = (await api('/tms/vehicle-models?unassigned=1')).j?.data?.items ?? []
  const mine = ((await api('/tms/vehicle-models')).j?.data?.items ?? []).find(m => m.id === vmId)
  check('1c2. Gán cha XEPALLET → updated 1 · dòng mang parent.code XEPALLET · không còn trong ?unassigned=1',
    asg.s === 200 && asg.j?.data?.updated === 1 && mine?.parent?.code === 'XEPALLET' && !after.some(m => m.id === vmId), `http=${asg.s} parent=${mine?.parent?.code}`)
  const badU = await api(`/tms/vehicle-models/${vmId}`, 'PUT', { underload_pct: 150 })
  check('1d. PUT underload_pct 150 → 400 VALIDATION (zod tại biên)', badU.s === 400 && badU.j?.error?.code === 'VALIDATION', `http=${badU.s} code=${badU.j?.error?.code}`)
  const okU = await api(`/tms/vehicle-models/${vmId}`, 'PUT', { underload_pct: 60, max_drops: 3 })
  check('1d2. PUT hợp lệ → 200, giữ giá trị', okU.s === 200 && okU.j?.data?.underload_pct === 60 && okU.j?.data?.max_drops === 3, `http=${okU.s}`)

  // ── [2] Bảng cước ──
  const t1 = await api('/tms/freight/tariffs', 'POST', { from_warehouse_id: WH, transport_company_id: DA.id, vehicle_model_id: vmId, ward_code: WARD1, price: 250000, distance_km: 12 })
  const tId = t1.j?.data?.id
  check('2a. POST tariff → 201', t1.s === 201 && !!tId, `http=${t1.s} ${t1.j?.error?.message ?? ''}`)
  const t1d = await api('/tms/freight/tariffs', 'POST', { from_warehouse_id: WH, transport_company_id: DA.id, vehicle_model_id: vmId, ward_code: WARD1, price: 999 })
  check('2a2. Cùng khoá (kho·ĐVVT·dòng xe·phường·hiệu lực từ) lần hai → 409', t1d.s === 409, `http=${t1d.s}`)
  const tBad = await api('/tms/freight/tariffs', 'POST', { from_warehouse_id: WH, transport_company_id: DA.id, vehicle_model_id: 'khong-co', ward_code: WARD1, price: 1 })
  check('2a3. Dòng xe không tồn tại → 400', tBad.s === 400, `http=${tBad.s}`)
  const tl = await api(`/tms/freight/tariffs?warehouse_id=${WH}&q=QA60`)
  const tRow = tl.j?.data?.items?.find(r => r.id === tId)
  check('2b. GET tariffs lọc kho + q: thấy dòng, kèm tên kho/ĐVVT/dòng xe + tariff_unit', tl.s === 200 && !!tRow && tRow.company?.code === 'DA' && tRow.model?.sap_code === SAP && tRow.model?.tariff_unit === 'PER_PALLET' && !!tRow.warehouse?.name,
    `http=${tl.s} total=${tl.j?.data?.total}`)
  const tu = await api(`/tms/freight/tariffs/${tId}`, 'PUT', { price: 260000, effective_to: '2020-01-01' })
  check('2c. PUT effective_to < effective_from → 400', tu.s === 400, `http=${tu.s}`)
  const tu2 = await api(`/tms/freight/tariffs/${tId}`, 'PUT', { price: 260000 })
  check('2c2. PUT đổi giá → 200', tu2.s === 200 && Number(tu2.j?.data?.price) === 260000, `http=${tu2.s}`)

  // Upload 2 pha: 1 dòng đè giá (khoá đã có) + 1 dòng mới + 1 dòng ĐVVT lạ → kiểm-trước 1 lỗi, ghi thật 400 không ghi gì
  const bad = xlsxOf([tariffRow({ ward: WARD1, price: 270000 }), tariffRow({ ward: WARD2, price: 300000 }), tariffRow({ ward: 'QA60-Test3', price: 1, dvvt: 'DVVT KHONG CO' })])
  const pfBad = await upload('/tms/freight/tariffs/upload?preflight=1', bad, { warehouse_id: WH })
  check('2d. Upload kiểm-trước có ĐVVT lạ: errors_total 1 · will_write 0 · to_update 1 · to_insert 1 (vẫn đếm đúng phần hợp lệ)',
    pfBad.s === 200 && pfBad.j?.data?.errors_total === 1 && pfBad.j?.data?.will_write === 0 && pfBad.j?.data?.to_update === 1 && pfBad.j?.data?.to_insert === 1,
    `http=${pfBad.s} err=${pfBad.j?.data?.errors_total} ins=${pfBad.j?.data?.to_insert} upd=${pfBad.j?.data?.to_update} ww=${pfBad.j?.data?.will_write}`)
  const wrBad = await upload('/tms/freight/tariffs/upload', bad, { warehouse_id: WH })
  const n2 = (await restAll('freight_tariff', `select=id&ward_code=eq.${WARD2}`)).length
  check('2d2. Ghi thật file lỗi → 400 TARIFF_INVALID, KHÔNG ghi gì (all-or-nothing)', wrBad.s === 400 && wrBad.j?.error?.code === 'TARIFF_INVALID' && n2 === 0, `http=${wrBad.s} code=${wrBad.j?.error?.code} n2=${n2}`)
  const good = xlsxOf([tariffRow({ ward: WARD1, price: 270000 }), tariffRow({ ward: WARD2, price: 300000 })])
  const pf = await upload('/tms/freight/tariffs/upload?preflight=1', good, { warehouse_id: WH })
  check('2e. Kiểm-trước file sạch: to_insert 1 · to_update 1 · 0 lỗi · có ô "Phường chưa thấy trong SAP" (phường QA60 không có khách)',
    pf.s === 200 && pf.j?.data?.to_insert === 1 && pf.j?.data?.to_update === 1 && pf.j?.data?.errors_total === 0 && pf.j?.data?.extra?.some(e => /chưa thấy trong SAP/.test(e.label)),
    `http=${pf.s} ins=${pf.j?.data?.to_insert} upd=${pf.j?.data?.to_update}`)
  const wr = await upload('/tms/freight/tariffs/upload', good, { warehouse_id: WH })
  const t1b = (await restAll('freight_tariff', `select=id,price&id=eq.${tId}`))[0]
  check('2e2. Ghi thật: inserted 1 · updated 1 · dòng cũ GIỮ id, giá đè 270.000', wr.s === 200 && wr.j?.data?.inserted === 1 && wr.j?.data?.updated === 1 && Number(t1b?.price) === 270000,
    `http=${wr.s} ins=${wr.j?.data?.inserted} upd=${wr.j?.data?.updated} price=${t1b?.price}`)
  const pf2 = await upload('/tms/freight/tariffs/upload?preflight=1', good, { warehouse_id: WH })
  check('2e3. Kiểm-trước lần hai (file y hệt) = 0 thêm · 0 đè · ô "Không đổi" = 2', pf2.s === 200 && pf2.j?.data?.to_insert === 0 && pf2.j?.data?.to_update === 0
    && Number(pf2.j?.data?.extra?.find(e => /Không đổi/.test(e.label))?.value) === 2, `ins=${pf2.j?.data?.to_insert} upd=${pf2.j?.data?.to_update}`)
  const noWh = xlsxOf([tariffRow({ ward: WARD1, price: 1 })])
  const pfNoWh = await upload('/tms/freight/tariffs/upload?preflight=1', noWh)
  check('2f. Không chọn kho và file không có cột Kho xuất → lỗi nêu rõ ở từng dòng', pfNoWh.s === 200 && pfNoWh.j?.data?.errors_total === 1 && /Kho xuất/.test(pfNoWh.j?.data?.errors?.[0] ?? ''), `http=${pfNoWh.s} err=${pfNoWh.j?.data?.errors?.[0]?.slice(0, 80)}`)

  // ── [3] Phụ phí ──
  const s1 = await api('/tms/freight/surcharges', 'POST', { from_warehouse_id: WH, transport_company_id: DA.id, kind: 'DROP_POINT', amount: 100000, per: 'PER_STOP', count_mode: 'ALL_STOPS', min_stops: 2, note: 'QA60 rớt điểm' })
  const sId = s1.j?.data?.id
  check('3a. POST phụ phí rớt điểm PER_STOP → 201, min_stops 2, ALL_STOPS', s1.s === 201 && !!sId && s1.j?.data?.min_stops === 2 && s1.j?.data?.count_mode === 'ALL_STOPS', `http=${s1.s} ${s1.j?.error?.message ?? ''}`)
  const sBad = await api('/tms/freight/surcharges', 'POST', { from_warehouse_id: WH, transport_company_id: DA.id, kind: 'BOGUS_KIND', amount: 1, per: 'PER_TRIP', note: 'QA60' })
  check('3b. Loại phụ phí không có trong danh mục → 400', sBad.s === 400, `http=${sBad.s}`)
  const s2 = await api('/tms/freight/surcharges', 'POST', { from_warehouse_id: WH, transport_company_id: DA.id, vehicle_model_id: vmId, kind: 'LOADING', amount: 150000, per: 'PER_TRIP', note: 'QA60 bốc xếp' })
  check('3c. Phụ phí bốc xếp theo dòng xe cụ thể → 201', s2.s === 201, `http=${s2.s}`)
  const sl = await api(`/tms/freight/surcharges?warehouse_id=${WH}&company_id=${DA.id}`)
  check('3d. GET surcharges: thấy 2 dòng QA60 + danh mục kinds ≥ 4 (DROP_POINT/LOADING/WAITING/OTHER)',
    sl.s === 200 && (sl.j?.data?.items ?? []).filter(x => /QA60/.test(x.note ?? '')).length === 2 && (sl.j?.data?.kinds ?? []).length >= 4, `http=${sl.s} kinds=${sl.j?.data?.kinds?.length}`)
  const su = await api(`/tms/freight/surcharges/${sId}`, 'PUT', { amount: 120000, count_mode: 'EXTRA_STOPS' })
  check('3e. PUT phụ phí → 200 đổi count_mode EXTRA_STOPS', su.s === 200 && su.j?.data?.count_mode === 'EXTRA_STOPS' && Number(su.j?.data?.amount) === 120000, `http=${su.s}`)

  // ── [4] Phân tuyến ĐVVT ──
  const a1 = await api('/tms/freight/allocations', 'POST', { from_warehouse_id: WH, area_kind: 'WARD', area_code: WARD1, transport_company_id: DA.id, priority: 1 })
  const aId = a1.j?.data?.id
  check('4a. POST ưu tiên khu vực (WARD QA60-Test → DA, ưu tiên 1) → 201', a1.s === 201 && !!aId, `http=${a1.s} ${a1.j?.error?.message ?? ''}`)
  const a1d = await api('/tms/freight/allocations', 'POST', { from_warehouse_id: WH, area_kind: 'WARD', area_code: WARD1, transport_company_id: DA.id, priority: 2 })
  check('4a2. Cùng (kho·cấp·khu vực·ĐVVT·hiệu lực) lần hai → 409', a1d.s === 409, `http=${a1d.s}`)
  const au = await api(`/tms/freight/allocations/${aId}`, 'PUT', { priority: 2 })
  check('4b. PUT priority → 200', au.s === 200 && au.j?.data?.priority === 2, `http=${au.s}`)
  const sh1 = await api('/tms/freight/shares', 'POST', { from_warehouse_id: WH, transport_company_id: DA.id, share_pct: 60, note: 'QA60' })
  const shId = sh1.j?.data?.id
  check('4c. POST tỷ trọng DA 60 % → 201', sh1.s === 201 && !!shId, `http=${sh1.s} ${sh1.j?.error?.message ?? ''}`)
  const sh2bad = await api('/tms/freight/shares', 'POST', { from_warehouse_id: WH, transport_company_id: HA.id, share_pct: 50, note: 'QA60' })
  check('4c2. HA 50 % khi DA đã 60 % → 400 (Σ > 100 %)', sh2bad.s === 400 && /100/.test(sh2bad.j?.error?.message ?? ''), `http=${sh2bad.s} msg=${sh2bad.j?.error?.message?.slice(0, 80)}`)
  const sh2 = await api('/tms/freight/shares', 'POST', { from_warehouse_id: WH, transport_company_id: HA.id, share_pct: 40, note: 'QA60' })
  check('4c3. HA 40 % → 201 (Σ = 100 %)', sh2.s === 201, `http=${sh2.s}`)
  const shUp = await api(`/tms/freight/shares/${shId}`, 'PUT', { share_pct: 70 })
  check('4c4. PUT DA lên 70 % → 400 (Σ 110 %)', shUp.s === 400, `http=${shUp.s}`)
  const al = await api(`/tms/freight/allocations?warehouse_id=${WH}`)
  check('4d. GET allocations: 1 ưu tiên QA60 (effective_now) + 2 tỷ trọng QA60', al.s === 200
    && (al.j?.data?.allocations ?? []).filter(x => x.area_code === WARD1 && x.effective_now).length === 1
    && (al.j?.data?.shares ?? []).filter(x => x.note === 'QA60').length === 2, `http=${al.s}`)

  // ── [5] Xoá có gác ──
  const dm = await api(`/tms/vehicle-models/${vmId}`, 'DELETE')
  check('5a. DELETE dòng xe đang có cước + phụ phí → 409 nêu số dòng', dm.s === 409 && /dòng cước/.test(dm.j?.error?.message ?? ''), `http=${dm.s} msg=${dm.j?.error?.message?.slice(0, 80)}`)
  const dt = await api(`/tms/freight/tariffs/${tId}`, 'DELETE')
  check('5b. DELETE dòng cước chưa dùng cho chuyến → 200', dt.s === 200, `http=${dt.s}`)
  const dt2 = await api(`/tms/freight/tariffs/${tId}`, 'DELETE')
  check('5b2. DELETE lần hai → 404 (không "đã xoá" giả)', dt2.s === 404, `http=${dt2.s}`)
  for (const r of await restAll('freight_tariff', `select=id&ward_code=like.QA60*`)) await api(`/tms/freight/tariffs/${r.id}`, 'DELETE')
  const ds = await api(`/tms/freight/surcharges/${sId}`, 'DELETE'); await api(`/tms/freight/surcharges/${s2.j?.data?.id}`, 'DELETE')
  const da = await api(`/tms/freight/allocations/${aId}`, 'DELETE')
  const dsh = await api(`/tms/freight/shares/${shId}`, 'DELETE'); await api(`/tms/freight/shares/${sh2.j?.data?.id}`, 'DELETE')
  check('5c. DELETE phụ phí / ưu tiên / tỷ trọng → 200', ds.s === 200 && da.s === 200 && dsh.s === 200, `s=${ds.s} a=${da.s} sh=${dsh.s}`)
  const dm2 = await api(`/tms/vehicle-models/${vmId}`, 'DELETE')
  check('5d. DELETE dòng xe sau khi gỡ hết tham chiếu → 200', dm2.s === 200, `http=${dm2.s} ${dm2.j?.error?.message ?? ''}`)
} finally {
  await cleanup()
  const left = (await restAll('vehicle_model', `select=id&sap_code=like.QA60*`)).length + (await restAll('freight_tariff', `select=id&ward_code=like.QA60*`)).length
  check('9. Dọn sạch fixture QA60', left === 0, `còn ${left}`)
}
finish(PACK)
