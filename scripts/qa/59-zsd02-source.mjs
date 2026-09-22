// GÓI 59 — ZSD02 THAY VL06O làm nguồn DO (đợt 0 TMS điều vận, 22/09; plan docs/plans/TMS_DISPATCH_PLAN.md).
// Bốn điều phải giữ, mỗi điều là một lớp lỗi đã đo được sẽ xảy ra nếu bỏ:
//   [1] Dòng CHƯA có OD KHÔNG được vào sổ OD (SAP để "OD Qty (Base Unit)" = 0 ở 100 % dòng đó → reconcile hiểu
//       "SAP nói 0" và hạ cartons_ordered). Nó chỉ sống ở sổ SO `erp_so_lines` với base DẪN XUẤT có cờ.
//   [2] Đơn vị bán ghi CHỮ (Thùng/Hộp/Cái) phải quy nhãn trước khi so master; nhãn lạ → 400 UNIT_MISMATCH kèm bảng.
//   [3] Hai nguồn cùng sổ: VL06O nạp SAU không xoá cột ZSD02-only; upload lại cùng file = NO-OP (không đổi id).
//   [4] DO flow RETURN/DISCOUNT không được lên Kế hoạch xuất; công tắc `sap_do_source` đóng đúng cửa.
// Fixture QA59_*: dựng bằng file Excel qua API thật, dọn bằng PostgREST.
import { login, api, restAll, restWrite, resolveFixtures, FIX, BASE, authToken, check, finish } from './lib.mjs'

const XLSX = (await import('../../backend/node_modules/xlsx/xlsx.mjs')).default
  ?? await import('../../backend/node_modules/xlsx/xlsx.mjs')
const PACK = '59-zsd02-source'
const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const dmy = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
const DELIV = new Date(Date.now() + 40 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })   // xa tương lai — không đụng dữ liệu thật
const SO1 = 'QA59SO1', SO2 = 'QA59SO2', SO3 = 'QA59SO3', OD1 = 'QA59OD1', OD3 = 'QA59OD3'
const SHIPTO = 'QA59ST', ROUTE = 'BVQA59', WARD = 'QA59-Test', PLANT = '1102'
const GC = `${FIX.WH_QR.code}_X_${todayVN.slice(8, 10)}${todayVN.slice(5, 7)}${todayVN.slice(2, 4)}_959`

await login(); await resolveFixtures()
const mat = (await restAll('Material', `select=material_code,base_unit,entry_unit,units_per_carton,short_name&material_code=eq.${FIX.MAT_POOL}`))[0]
const upc = Number(mat?.units_per_carton) || 0
const hasEntry = !!(mat?.entry_unit && upc > 0)
const suThung = hasEntry ? 'Thùng' : (mat?.base_unit === 'KG' ? 'kg' : 'Cái')
const factor = hasEntry ? upc : 1
const bu = mat?.base_unit ?? 'EA'
const loscam = (await restAll('Material', `select=material_code&material_code=eq.810000000`))[0]?.material_code ?? FIX.MAT_POOL
const dvvtDa = (await restAll('TransportCompany', `select=code,name&code=eq.DA`))[0]

// ── Dựng file ZSD02 (tiêu đề NGUYÊN VĂN của SAP) ──
const H = {
  so: 'SO/ PO SAP', od: 'Outbound Delivery', st: 'Ship to code', stn: 'Ship to name', mat: 'Material', matn: 'Material Description',
  plate: 'Biển số xe', disp: 'Trạng thái điều phối xe', sotype: 'SO/ PO type', addr: 'Địa chỉ giao hàng', plant: 'Plant', sloc: 'Sloc',
  note: 'Ghi chú giao hàng', dd: 'Delivery date', item: 'Item', ic: 'Item Category', su: 'Sales unit', soq: 'SO Qty/ SL SO', socar: 'SO Qty CAR/ SL SO THÙNG',
  odq: 'OD Qty', odcar: 'OD Qty CAR/ SL THÙNG đã điều phối', gi: 'Số lượng đã xuất / nhập', region: 'Region/ Tỉnh.TP', route: 'Route/ Tuyến giao hàng',
  gw: 'Gross Weight', ward: 'Tên Phường', dvvt: 'Đơn vị vận chuyển', mroute: 'Mã Route', base: 'OD Qty (Base Unit)', bunit: 'Base Unit',
  pal: 'SL SO PALLET', palod: 'SL PALLET đã điều phối', cancel: 'Trạng thái hủy đơn',
}
const row = (o) => ({
  [H.so]: o.so, [H.od]: o.od ?? '', [H.st]: SHIPTO, [H.stn]: 'QA59 KHÁCH TEST', [H.mat]: o.mat, [H.matn]: 'QA59 hàng test',
  [H.plate]: o.plate ?? '', [H.disp]: o.od ? (o.plate ? 'Đã điều phối' : 'Chưa điều phối') : 'Chưa điều phối',
  [H.sotype]: o.sotype ?? 'ZOR1-SO Standard', [H.addr]: 'Địa chỉ QA59', [H.plant]: PLANT, [H.sloc]: 'FG01', [H.note]: '',
  [H.dd]: dmy(DELIV), [H.item]: '10', [H.ic]: o.ic ?? 'ZTA1-IC Sales Standard', [H.su]: o.su, [H.soq]: o.soq, [H.socar]: o.socar ?? o.soq,
  [H.odq]: o.od ? o.soq : 0, [H.odcar]: o.od ? (o.socar ?? o.soq) : 0, [H.gi]: 0,
  [H.region]: '100-Thành phố Hà Nội', [H.route]: `BV-${WARD}`, [H.gw]: o.gw ?? 0, [H.ward]: WARD, [H.dvvt]: o.dvvt ?? 'Đông Á', [H.mroute]: ROUTE,
  [H.base]: o.od ? o.soq * o.factor : 0, [H.bunit]: o.bunit, [H.pal]: 0.1, [H.palod]: o.od ? 0.1 : 0, [H.cancel]: '',
})
const ROWS = [
  row({ so: SO1, od: OD1, mat: FIX.MAT_POOL, su: suThung, soq: 10, factor, bunit: bu, gw: 50_000 }),          // có OD — sổ OD
  row({ so: SO2, od: null, mat: FIX.MAT_POOL, su: suThung, soq: 5, factor, bunit: bu, gw: 25_000 }),         // CHƯA OD — chỉ sổ SO
  row({ so: SO3, od: OD3, mat: loscam, su: 'Cái', soq: 2, factor: 1, bunit: 'EA', sotype: 'ZRE3-SO Return Pallet', ic: 'ZRE3-Pallet Return' }),  // RETURN
]
const xlsxOf = (rows) => { const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Data'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) }
async function upload(path, buf, name = 'zsd02.xlsx') {
  const fd = new FormData(); fd.append('file', new Blob([buf]), name)
  const r = await fetch(`${BASE}/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${authToken()}` }, body: fd })
  let j = null; try { j = JSON.parse(await r.text()) } catch { /* */ }
  return { s: r.status, j }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function cleanup() {
  for (const g of await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${GC}`)) {
    const dos = await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`)
    if (dos.length) { await restWrite('OutboundItem', 'DELETE', `do_id=in.(${dos.map(x => x.id).join(',')})`).catch(() => {}); await restWrite('OutboundDelivery', 'DELETE', `gdo_id=eq.${g.id}`) }
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${g.id}`)
  }
  await restWrite('khvc_lines', 'DELETE', `group_code=eq.${GC}`).catch(() => {})
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=in.(${OD1},${OD3})`)
  await restWrite('erp_so_lines', 'DELETE', `so_number=like.QA59SO*`)
  await restWrite('sap_route', 'DELETE', `route_code=eq.${ROUTE}`).catch(() => {})
  await restWrite('Customer', 'DELETE', `ship_to_code=eq.${SHIPTO}&auto_created=is.true`).catch(() => {})
  await api('/wms/settings/sap_do_source', 'PUT', { value: 'BOTH' })
}
await cleanup()
await api('/wms/settings/sap_do_source', 'PUT', { value: 'BOTH' })

try {
  // ── [1] Kiểm-trước rồi ghi ──
  const pf = await upload('/external/do-sap/upload-zsd02?preflight=1', xlsxOf(ROWS))
  check('1a. Preflight 200, 0 lỗi, có ô "Dòng CHƯA OD → chỉ sổ SO" = 1', pf.s === 200 && pf.j?.data?.errors_total === 0
    && pf.j?.data?.extra?.some(e => /CHƯA OD/.test(e.label) && Number(e.value) === 1), `http=${pf.s} errors=${pf.j?.data?.errors_total} extra=${JSON.stringify(pf.j?.data?.extra ?? []).slice(0, 200)}`)
  check('1b. Preflight KHÔNG ghi gì', (await restAll('erp_so_lines', `select=id&so_number=like.QA59SO*`)).length === 0)
  const up = await upload('/external/do-sap/upload-zsd02', xlsxOf(ROWS))
  const d = up.j?.data
  check('1c. Ghi thật: sổ OD 2 dòng (OD1 + OD3), sổ SO 3 dòng, 1 dòng chưa OD', up.s === 200 && d?.od?.inserted === 2 && d?.so?.inserted === 3 && d?.so?.without_od === 1,
    `http=${up.s} od=${JSON.stringify(d?.od)} so=${JSON.stringify(d?.so)}`)

  // ── [2] Sổ đúng, số đúng, đơn vị đúng ──
  const od1 = (await restAll('erp_outbound_orders', `select=*&od_number=eq.${OD1}`))[0]
  check('2a. Sổ OD: qty_base = SL × hệ số (base SAP), sales_unit quy nhãn CAR/EA, base_unit = master', !!od1
    && Number(od1.qty_base) === 10 * factor && od1.sales_unit === (hasEntry ? 'CAR' : (bu === 'KG' ? 'KG' : 'EA')) && od1.base_unit === bu,
    `qty_base=${od1?.qty_base} (kỳ vọng ${10 * factor}) su=${od1?.sales_unit} bu=${od1?.base_unit}`)
  check('2b. Sổ OD: flow SALE · delivery_date · ward · route · gram→kg (50.000 g = 50 kg) · ĐP xe UNASSIGNED · nguồn ZSD02',
    od1?.flow === 'SALE' && od1?.delivery_date === DELIV && od1?.ward_code === WARD && od1?.route_code === ROUTE
    && Number(od1?.gross_weight_kg) === 50 && od1?.sap_dispatch_status === 'UNASSIGNED' && od1?.source === 'ZSD02',
    `flow=${od1?.flow} dd=${od1?.delivery_date} ward=${od1?.ward_code} route=${od1?.route_code} kg=${od1?.gross_weight_kg} disp=${od1?.sap_dispatch_status} src=${od1?.source}`)
  if (dvvtDa) check('2c. ĐVVT "Đông Á" khớp danh mục → dvvt_code DA (raw giữ nguyên văn)', od1?.dvvt_code === 'DA' && od1?.dvvt_raw === 'Đông Á', `code=${od1?.dvvt_code} raw=${od1?.dvvt_raw}`)
  const so2 = (await restAll('erp_so_lines', `select=*&so_number=eq.${SO2}`))[0]
  check('2d. Sổ SO: dòng chưa OD OPEN · od_number NULL · base DẪN XUẤT = 5 × hệ số · derive_source FILE (hệ số quan sát từ OD1 cùng mã) · cờ derived',
    !!so2 && so2.status === 'OPEN' && so2.od_number === null && Number(so2.qty_so_base) === 5 * factor && so2.qty_base_derived === true
    && (hasEntry ? so2.derive_source === 'FILE' : so2.derive_source === 'SAP') && so2.qty_unresolved === false,
    `status=${so2?.status} od=${so2?.od_number} base=${so2?.qty_so_base} src=${so2?.derive_source} derived=${so2?.qty_base_derived}`)
  check('2e. Dòng chưa OD KHÔNG có mặt trong sổ OD (không có dòng nào mang so_number QA59SO2)',
    (await restAll('erp_outbound_orders', `select=id&so_number=eq.${SO2}`)).length === 0)
  const so1 = (await restAll('erp_so_lines', `select=status,od_number&so_number=eq.${SO1}`))[0]
  check('2f. Dòng có OD trong sổ SO = HAS_OD trỏ đúng OD', so1?.status === 'HAS_OD' && so1?.od_number === OD1, JSON.stringify(so1))
  const od3 = (await restAll('erp_outbound_orders', `select=flow,item_category&od_number=eq.${OD3}`))[0]
  check('2g. Dòng trả pallet (ZRE3) → flow RETURN', od3?.flow === 'RETURN', `flow=${od3?.flow}`)
  check('2h. Tuyến SAP nạp vào sap_route · khách QA59ST tự sinh mang ward_code',
    (await restAll('sap_route', `select=route_code,ward_code&route_code=eq.${ROUTE}`))[0]?.ward_code === WARD
    && (await restAll('Customer', `select=ward_code,region_code&ship_to_code=eq.${SHIPTO}`))[0]?.ward_code === WARD)
  const soList = await api(`/external/so-lines?date_from=${DELIV}&date_to=${DELIV}&status=OPEN&q=QA59`)
  check('2i. GET /external/so-lines liệt kê dòng chưa OD + summary.open ≥ 1 + cờ loadable',
    soList.s === 200 && soList.j?.data?.items?.some(r => r.so_number === SO2 && r.loadable === true) && Number(soList.j?.data?.summary?.open) >= 1,
    `http=${soList.s} n=${soList.j?.data?.items?.length} sum=${JSON.stringify(soList.j?.data?.summary ?? {}).slice(0, 160)}`)
  const doList = await api(`/external/do-sap?flow=RETURN&delivery_from=${DELIV}&delivery_to=${DELIV}&date_from=${todayVN}&date_to=${todayVN}`)
  check('2j. GET /external/do-sap lọc flow=RETURN + khoảng Ngày giao → thấy OD3, không thấy OD1',
    doList.s === 200 && doList.j?.data?.items?.some(r => r.od_number === OD3) && !doList.j?.data?.items?.some(r => r.od_number === OD1), `http=${doList.s} n=${doList.j?.data?.items?.length}`)

  // ── [3] Idempotent + hai nguồn cùng sổ ──
  const again = await upload('/external/do-sap/upload-zsd02', xlsxOf(ROWS))
  const d2 = again.j?.data
  check('3a. Upload lại cùng file = NO-OP toàn bộ (không đổi id/updated_at)', again.s === 200 && d2?.od?.noop === 2 && d2?.so?.noop === 3 && d2?.od?.inserted === 0 && d2?.so?.inserted === 0,
    `od=${JSON.stringify(d2?.od)} so=${JSON.stringify(d2?.so)}`)
  const od1id = od1?.id
  const vl = [{ Delivery: OD1, Item: '10', Material: FIX.MAT_POOL, 'Item Description': 'x', 'Delivery Quantity': 11, 'Sales Unit': hasEntry ? 'CAR' : bu,
    'Actual delivery qty': 11 * factor, 'Base Unit of Measure': bu, 'Ship-to Party': SHIPTO, 'Name ship-to party': 'QA59', Plant: PLANT, 'Storage Location': 'FG01' }]
  const vlUp = await upload('/wms/outbound/upload-vl06o', xlsxOf(vl), 'vl06o.xlsx')
  const od1b = (await restAll('erp_outbound_orders', `select=id,qty_base,route_code,ward_code,dvvt_code,flow,delivery_date,source&od_number=eq.${OD1}`))[0]
  check('3b. VL06O nạp SAU đè số lượng nhưng KHÔNG xoá cột ZSD02-only (route/ward/dvvt/flow/ngày giao), giữ id',
    vlUp.s === 200 && od1b?.id === od1id && Number(od1b?.qty_base) === 11 * factor && od1b?.route_code === ROUTE && od1b?.ward_code === WARD
    && od1b?.flow === 'SALE' && od1b?.delivery_date === DELIV,
    `http=${vlUp.s} qty=${od1b?.qty_base} route=${od1b?.route_code} flow=${od1b?.flow} src=${od1b?.source}`)

  // ── [2'] Nhãn đơn vị lạ → 400 UNIT_MISMATCH kèm bảng, không ghi ──
  const bad = await upload('/external/do-sap/upload-zsd02', xlsxOf([row({ so: 'QA59SO9', od: 'QA59OD9', mat: FIX.MAT_POOL, su: 'Thùng lớn', soq: 1, factor, bunit: bu })]))
  check('4a. Đơn vị bán "Thùng lớn" → 400 UNIT_MISMATCH + bảng unit_errors, không ghi dòng', bad.s === 400 && bad.j?.error?.code === 'UNIT_MISMATCH' && (bad.j?.unit_errors?.length ?? 0) > 0
    && (await restAll('erp_outbound_orders', `select=id&od_number=eq.QA59OD9`)).length === 0, `http=${bad.s} code=${bad.j?.error?.code}`)

  // ── [4] DO RETURN không lên Kế hoạch xuất ──
  const cats = (await restAll('LookupValue', 'select=value&type=eq.warehouse_type&order=sort_order')).map(x => x.value)
  const kh = await api('/external/khvc', 'POST', { group_code: GC, do_no: OD3, npp: 'QA59', export_date: DELIV, veh_type: 'Xe Pallet', dvvt: 'QA-SUITE', booking_category: cats[0] })
  check('4b. Thêm dòng Kế hoạch xuất với DO trả pallet (flow RETURN) → 400 nêu lý do, không ghi',
    kh.s === 400 && /TRẢ VỀ|RETURN/i.test(kh.j?.error?.message ?? '') && (await restAll('khvc_lines', `select=id&group_code=eq.${GC}`)).length === 0,
    `http=${kh.s} msg=${(kh.j?.error?.message ?? '').slice(0, 120)}`)
  const khOk = await api('/external/khvc', 'POST', { group_code: GC, do_no: OD1, npp: 'QA59', export_date: DELIV, veh_type: 'Xe Pallet', dvvt: 'QA-SUITE', booking_category: cats[0] })
  check('4c. Cùng cửa với DO bán hàng (flow SALE) → vẫn nhận (201)', khOk.s === 201, `http=${khOk.s} ${(khOk.j?.error?.message ?? '').slice(0, 100)}`)

  // ── [5] Công tắc nguồn — cache cờ 30s theo instance nên đo lại tới 40s ──
  const waitFor = async (fn) => { for (let i = 0; i < 9; i++) { const r = await fn(); if (r) return r; await sleep(5000) } return null }
  await api('/wms/settings/sap_do_source', 'PUT', { value: 'ZSD02' })
  const vlBlocked = await waitFor(async () => { const r = await upload('/wms/outbound/upload-vl06o', xlsxOf(vl), 'vl06o.xlsx'); return r.s === 409 ? r : null })
  check('5a. sap_do_source=ZSD02 → cửa VL06O trả 409 SOURCE_DISABLED', vlBlocked?.s === 409 && vlBlocked?.j?.error?.code === 'SOURCE_DISABLED', `code=${vlBlocked?.j?.error?.code}`)
  await api('/wms/settings/sap_do_source', 'PUT', { value: 'VL06O' })
  const zsBlocked = await waitFor(async () => { const r = await upload('/external/do-sap/upload-zsd02?preflight=1', xlsxOf(ROWS)); return r.s === 409 ? r : null })
  check('5b. sap_do_source=VL06O → cửa ZSD02 trả 409 SOURCE_DISABLED (kể cả preflight)', zsBlocked?.s === 409 && zsBlocked?.j?.error?.code === 'SOURCE_DISABLED', `code=${zsBlocked?.j?.error?.code}`)
  await api('/wms/settings/sap_do_source', 'PUT', { value: 'BOTH' })
  check('5c. Cờ trả về BOTH', (await api('/wms/settings')).j?.data?.find(s => s.key === 'sap_do_source')?.value === 'BOTH')
} finally {
  await cleanup()
  check('9. Dọn sạch fixture QA59', (await restAll('erp_so_lines', `select=id&so_number=like.QA59SO*`)).length === 0
    && (await restAll('erp_outbound_orders', `select=id&od_number=in.(${OD1},${OD3})`)).length === 0)
}
finish(PACK)
