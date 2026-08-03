// GÓI 13 — "Kế hoạch xuất đi TRƯỚC dữ liệu SAP" (user chốt 03/08).
// Khóa 4 luật bằng phép kiểm để không ai lỡ tay mở lại (luật BUG CHẾT HAI LẦN):
//   1. Up Kế hoạch xuất khi CHƯA có VL06O → KHÔNG chặn, sinh chuyến ở dạng CHỜ
//   2. Chuyến chờ = BẤT ĐỘNG (mọi cửa xuất trả 422 TRIP_INERT)
//   3. VL06O về → chuyến TỰ kích hoạt (đủ dòng hàng, cờ tắt) — không bấm gì
//   4. Kế hoạch hết dòng → chuyến NGỪNG HOẠT ĐỘNG (không xóa) · có lại → sống lại
//      · CẤM xóa kế hoạch của chuyến ĐANG XUẤT / ĐÃ HOÀN THÀNH
// Dữ liệu test tự seed theo tag, tự dọn. usage: node scripts/qa/13-awaiting-sap.mjs
import { randomUUID } from 'crypto'
import { login, api, restAll, restWrite, resolveFixtures, FIX, BASE } from './lib.mjs'

const t = () => new Date().toISOString()
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
let pass = 0, fail = 0
const check = (name, ok, note = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${note ? ` — ${note}` : ''}`) }
}

await login()
await resolveFixtures()
// Loại xe + ĐVVT phải LẤY TỪ DANH MỤC THẬT (validate của derive khớp danh mục, không nhận nhãn tự chế)
const vehTypeName = (await restAll('VehicleType', 'select=name&is_active=eq.true&order=name&limit=1'))[0]?.name
const dvvtName = (await restAll('TransportCompany', 'select=name&type=eq.ĐVVT&order=name&limit=1'))[0]?.name
if (!vehTypeName || !dvvtName) { console.log('❌ thiếu danh mục Loại xe/ĐVVT trên môi trường test'); process.exit(1) }

const WH = FIX.WH_QTY                       // kho QTY: xuất được bằng "Lưu thủ công", không cần tem
const [y, m, d] = today.split('-')
const GC = n => `${WH.code}_X_${d}${m}${y.slice(2)}_9${n}`   // đuôi PHẢI là số (validateGroupCode)
const DO_A = 'QAAWDO001', DO_B = 'QAAWDO002'
const ALL_GC = [GC(1), GC(2), GC(3), GC(4)]

async function cleanup() {
  const gs = await restAll('GroupDeliveryOrder', `select=id&group_code=in.(${ALL_GC.join(',')})`)
  for (const g of gs) {
    const dos = await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`)
    if (dos.length) {
      const its = await restAll('OutboundItem', `select=id&do_id=in.(${dos.map(x => x.id).join(',')})`)
      if (its.length) await restWrite('OutboundScanEntry', 'DELETE', `item_id=in.(${its.map(i => i.id).join(',')})`).catch(() => {})
      await restWrite('OutboundItem', 'DELETE', `do_id=in.(${dos.map(x => x.id).join(',')})`)
      await restWrite('OutboundDelivery', 'DELETE', `gdo_id=eq.${g.id}`)
    }
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${g.id}`)
  }
  // Lệnh vận chuyển TỰ SINH theo Số xe (03/08) — dọn kẻo để lại rác giữa các lượt chạy
  for (const o of await restAll('TmsOrder', `select=id&order_code=in.(${ALL_GC.join(',')})`)) {
    await restWrite('TmsVehicleSlot', 'DELETE', `order_id=eq.${o.id}`).catch(() => {})
    await restWrite('TmsOrder', 'DELETE', `id=eq.${o.id}`)
  }
  await restWrite('outbound_events', 'DELETE', `group_code=in.(${ALL_GC.join(',')})`).catch(() => {})
  await restWrite('reconcile_tasks', 'DELETE', `group_code=in.(${ALL_GC.join(',')})`).catch(() => {})
  await restWrite('khvc_lines', 'DELETE', `group_code=in.(${ALL_GC.join(',')})`)
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=in.(${DO_A},${DO_B})`)
}
const gdoOf = async gc => (await restAll('GroupDeliveryOrder',
  `select=id,status,awaiting_sap,awaiting_dos,plan_dropped&group_code=eq.${gc}`))[0] ?? null
const itemsOf = async gdoId => {
  const dos = await restAll('OutboundDelivery', `select=id&gdo_id=eq.${gdoId}`)
  if (!dos.length) return []
  return restAll('OutboundItem', `select=id,cartons_ordered,cartons_scanned&do_id=in.(${dos.map(x => x.id).join(',')})`)
}
const addLine = (gc, doNo) => api('/external/khvc', 'POST', {
  group_code: gc, do_no: doNo, npp: 'QA AWAIT NPP', export_date: today, veh_type: vehTypeName, dvvt: dvvtName,
})
const seedRaw = (doNo, qty) => restWrite('erp_outbound_orders', 'POST', null, {
  id: randomUUID(), od_number: doNo, od_item: '10', material_code: FIX.MAT_POOL, qty_base: qty,
  ship_to_code: 'QAAWSHIP', ship_to_name: 'QA AWAIT NPP', source: 'EXCEL', sync_status: 'ACTIVE',
  last_synced_at: t(), updated_at: t(),
})

console.log(`── GÓI 13 — Kế hoạch xuất đi trước dữ liệu SAP (${BASE.replace('https://', '')}) ──`)
await cleanup()

// ── 1. Thêm dòng kế hoạch khi CHƯA có VL06O ──────────────────────────────────
const r1 = await addLine(GC(1), DO_A)
check('1a. Thêm dòng kế hoạch với DO chưa có VL06O → KHÔNG chặn', r1.s === 201, `http=${r1.s} ${r1.j?.error?.message ?? ''}`)
const g1 = await gdoOf(GC(1))
check('1b. Sinh chuyến ở dạng CHỜ dữ liệu', !!g1 && g1.awaiting_sap === true, g1 ? `awaiting=${g1.awaiting_sap}` : 'không có chuyến')
check('1c. Chuyến chờ ghi rõ DO nào đang thiếu', !!g1 && (g1.awaiting_dos ?? []).includes(DO_A), JSON.stringify(g1?.awaiting_dos))
check('1d. Chuyến chờ CHƯA có dòng hàng nào', g1 ? (await itemsOf(g1.id)).length === 0 : false)

// ── 2. Chuyến chờ là BẤT ĐỘNG ────────────────────────────────────────────────
if (g1) {
  const start = await api(`/wms/outbound/${g1.id}/start`, 'POST', { license_plate: 'QAAW1111' })
  check('2a. Bắt đầu chuyến chờ → 422 TRIP_INERT', start.s === 422 && start.j?.error?.code === 'TRIP_INERT',
    `http=${start.s} code=${start.j?.error?.code}`)
  const quick = await api(`/wms/outbound/${g1.id}/quick-export`, 'POST', { license_plate: 'QAAW1111' })
  check('2b. "Xuất luôn" trên chuyến chờ → 422 TRIP_INERT', quick.s === 422 && quick.j?.error?.code === 'TRIP_INERT',
    `http=${quick.s} code=${quick.j?.error?.code}`)
  const done = await api(`/wms/outbound/${g1.id}`, 'PATCH', { status: 'COMPLETED' })
  check('2c. Hoàn thành chuyến chờ → 422 TRIP_INERT', done.s === 422 && done.j?.error?.code === 'TRIP_INERT',
    `http=${done.s} code=${done.j?.error?.code}`)
}

// ── 3. VL06O về → chuyến TỰ kích hoạt ────────────────────────────────────────
await seedRaw(DO_A, 120)
const rep = await api('/external/khvc/bulk-date', 'POST', { ids: (await restAll('khvc_lines', `select=id&group_code=eq.${GC(1)}`)).map(r => r.id), export_date: today })
check('3a. Dội lại kế hoạch sau khi có dữ liệu → OK', rep.s === 200, `http=${rep.s}`)
const g1b = await gdoOf(GC(1))
check('3b. Cờ chờ đã tắt', !!g1b && g1b.awaiting_sap === false, `awaiting=${g1b?.awaiting_sap}`)
// Bản ghi chuyến phải GIỮ NGUYÊN id: người dùng đang mở trang chuyến CHỜ, dữ liệu về mà đổi id
// thì trang của họ 404 và vết sổ lịch sử trỏ vào bản ghi đã chết (bắt được ở đợt kiểm vòng 2, 03/08).
check('3b2. Kích hoạt GIỮ NGUYÊN bản ghi chuyến (không xóa+tạo lại)', !!g1b && !!g1 && g1b.id === g1.id,
  `trước=${g1?.id} sau=${g1b?.id}`)
const its = g1b ? await itemsOf(g1b.id) : []
check('3c. Chuyến đã có dòng hàng đúng số kế hoạch', its.length === 1 && Number(its[0].cartons_ordered) === 120,
  `items=${its.length} qty=${its[0]?.cartons_ordered}`)
if (g1b) {
  const start2 = await api(`/wms/outbound/${g1b.id}/start`, 'POST', { license_plate: 'QAAW1111' })
  check('3d. Chuyến hoạt động trở lại (Bắt đầu được)', start2.s === 200 || start2.s === 201, `http=${start2.s} ${start2.j?.error?.message ?? ''}`)
}

// ── 4. Kế hoạch hết dòng → NGỪNG HOẠT ĐỘNG (không xóa) ───────────────────────
await seedRaw(DO_B, 50)
const r4 = await addLine(GC(2), DO_B)
check('4a. Tạo chuyến đủ dữ liệu để test xóa kế hoạch', r4.s === 201, `http=${r4.s}`)
const g2 = await gdoOf(GC(2))
const line2 = (await restAll('khvc_lines', `select=id&group_code=eq.${GC(2)}`))[0]
const del = line2 ? await api(`/external/khvc/${line2.id}`, 'DELETE') : { s: 0 }
check('4b. Xóa dòng kế hoạch cuối cùng của xe → OK', del.s === 200, `http=${del.s} ${del.j?.error?.message ?? ''}`)
const g2b = await gdoOf(GC(2))
check('4c. Chuyến KHÔNG bị xóa', !!g2b, 'chuyến biến mất — trái luật 03/08')
check('4d. Chuyến chuyển sang NGỪNG HOẠT ĐỘNG', !!g2b && g2b.plan_dropped === true, `plan_dropped=${g2b?.plan_dropped}`)
if (g2b) {
  const st = await api(`/wms/outbound/${g2b.id}/start`, 'POST', { license_plate: 'QAAW2222' })
  check('4e. Chuyến ngừng hoạt động không Bắt đầu được', st.s === 422 && st.j?.error?.code === 'TRIP_INERT',
    `http=${st.s} code=${st.j?.error?.code}`)
}
// Kế hoạch có LẠI → chuyến sống lại
const r4f = await addLine(GC(2), DO_B)
check('4f. Thêm lại dòng kế hoạch → OK', r4f.s === 201, `http=${r4f.s} ${r4f.j?.error?.message ?? ''}`)
const g2c = await gdoOf(GC(2))
check('4g. Chuyến HOẠT ĐỘNG TRỞ LẠI', !!g2c && g2c.plan_dropped === false && g2c.awaiting_sap === false,
  `plan_dropped=${g2c?.plan_dropped} awaiting=${g2c?.awaiting_sap}`)
// "Chuyến không bị xóa… kế hoạch có lại thì hoạt động trở lại VỚI LỊCH SỬ ĐƯỢC BỔ SUNG" (user chốt
// 03/08) — mở lại mà đẻ bản ghi mới là mất chính cái lịch sử đó.
check('4g2. Mở lại DÙNG LẠI đúng bản ghi cũ (giữ lịch sử)', !!g2c && !!g2 && g2c.id === g2.id,
  `trước=${g2?.id} sau=${g2c?.id}`)

// ── 5. CẤM xóa kế hoạch của chuyến đã xuất ───────────────────────────────────
if (g2c) {
  // ĐANG XUẤT: chặn xóa kế hoạch (xe đang bốc hàng — sửa nguồn giữa chừng là sai)
  await api(`/wms/outbound/${g2c.id}/start`, 'POST', { license_plate: 'QAAW2222' })
  const line2b = (await restAll('khvc_lines', `select=id&group_code=eq.${GC(2)}`))[0]
  const delRun = line2b ? await api(`/external/khvc/${line2b.id}`, 'DELETE') : { s: 0 }
  check('5a. Chuyến ĐANG XUẤT → CẤM xóa dòng kế hoạch', delRun.s === 409, `http=${delRun.s}`)

  // ĐÃ HOÀN THÀNH: đặt thẳng trạng thái dưới DB (chốt chuyến qua API cần đủ tồn — không phải phần
  // đang kiểm ở gói này) rồi thử xóa: đây là luật user chốt 03/08 "việc này là không được phép".
  await restWrite('GroupDeliveryOrder', 'PATCH', `id=eq.${g2c.id}`, { status: 'COMPLETED', updated_at: t() })
  const gFin = await gdoOf(GC(2))
  const delDone = line2b ? await api(`/external/khvc/${line2b.id}`, 'DELETE') : { s: 0 }
  check('5b. Chuyến ĐÃ HOÀN THÀNH → CẤM xóa dòng kế hoạch',
    gFin?.status === 'COMPLETED' && delDone.s === 409 && /HOÀN THÀNH/.test(delDone.j?.error?.message ?? ''),
    `status=${gFin?.status} http=${delDone.s} msg=${delDone.j?.error?.message ?? ''}`)
  const still = (await restAll('khvc_lines', `select=id&group_code=eq.${GC(2)}`)).length
  check('5c. Dòng kế hoạch vẫn còn nguyên', still === 1, `còn ${still} dòng`)
  // Xóa hàng loạt cũng phải chặn (đường thứ 2 vào cùng nghiệp vụ)
  const bulk = line2b ? await api('/external/khvc/bulk-delete', 'POST', { ids: [line2b.id] }) : { s: 0 }
  const blockedN = (bulk.j?.data?.blocked ?? []).length
  check('5d. Xóa hàng loạt cũng bị chặn', bulk.s === 200 && (bulk.j?.data?.deleted ?? 0) === 0 && blockedN === 1,
    `http=${bulk.s} deleted=${bulk.j?.data?.deleted} blocked=${blockedN}`)
  await restWrite('GroupDeliveryOrder', 'PATCH', `id=eq.${g2c.id}`, { status: 'PENDING', started_at: null, updated_at: t() })
}

// ── 7. ĐƯỜNG UPLOAD phải cho ra CÙNG trạng thái đường sửa kế hoạch (đợt kiểm 03/08) ──
// Bug thật: uploadKhvc từng dựng dòng hàng cho PHẦN ĐÃ BIẾT của xe còn thiếu DO ⇒ cùng một file
// upload lại cho ra kết quả KHÁC, chuyến chờ hiện kế hoạch một nửa như thật.
{
  let XLSX = null
  try { XLSX = (await import('../../backend/node_modules/xlsx/xlsx.mjs')).default ?? await import('../../backend/node_modules/xlsx/xlsx.mjs') }
  catch { console.log('  ⚠ bỏ qua 7a/7b: chưa cài dependency backend (xlsx) — chạy `npm i` trong backend') }
  if (XLSX) {
    const GC7 = GC(3)
    const rows = [
      { 'Số xe': GC7, 'DO': DO_B, 'Tên NPP': 'QA AWAIT NPP', 'Ngày xuất': today, 'Loại xe': vehTypeName, 'DVVT': dvvtName },
      { 'Số xe': GC7, 'DO': 'QAAWDO404', 'Tên NPP': 'QA AWAIT NPP', 'Ngày xuất': today, 'Loại xe': vehTypeName, 'DVVT': dvvtName },
    ]
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'KHVC')
    const fd = new FormData()
    fd.append('file', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'khvc.xlsx')
    const tok = await (async () => {
      const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: process.env.QA_ADMIN_EMAIL || 'admin', password: process.env.QA_ADMIN_PASSWORD || 'Bavi1234' }) })
      return (await r.json())?.data?.token
    })()
    const up = await fetch(`${BASE}/api/wms/outbound/upload-khvc`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd })
    const g7 = await gdoOf(GC7)
    const its7 = g7 ? await itemsOf(g7.id) : []
    check('7a. Upload file có xe thiếu 1 DO → vẫn nhận file', up.status === 200 || up.status === 201, `http=${up.status}`)
    check('7b. Xe thiếu DO qua đường UPLOAD cũng là chuyến VỎ (0 dòng hàng) — khớp đường sửa kế hoạch',
      !!g7 && g7.awaiting_sap === true && its7.length === 0, `awaiting=${g7?.awaiting_sap} items=${its7.length}`)
  }
}

// ── 8. ĐUA: 2 người cùng thêm DO vào MỘT xe → kế hoạch và chuyến phải khớp ───
// Bug thật (đo 03/08): lượt đọc trước-ghi sau dựng chuyến theo bản kế hoạch CŨ rồi đứng im.
// Dùng xe SẠCH (chưa Bắt đầu): chuyến ĐANG XUẤT vốn KHÔNG bị kế hoạch tự đụng — đó là luật khác.
{
  const GC8 = GC(4)
  await seedRaw('QAAWDO901', 120)
  await seedRaw('QAAWDO902', 77)
  const rSeed = await addLine(GC8, 'QAAWDO901')
  const ids8 = (await restAll('khvc_lines', `select=id&group_code=eq.${GC8}`)).map(r => r.id)
  const [r1, r2] = await Promise.all([
    addLine(GC8, 'QAAWDO902'),
    api('/external/khvc/bulk-date', 'POST', { ids: ids8, export_date: today }),
  ])
  const g8 = await gdoOf(GC8)
  const its8 = g8 ? await itemsOf(g8.id) : []
  const lines8 = await restAll('khvc_lines', `select=do_no&group_code=eq.${GC8}`)
  const gotQty = its8.reduce((s, i) => s + Number(i.cartons_ordered ?? 0), 0)
  check('8a. Đua sửa kế hoạch: không 500', rSeed.s === 201 && r1.s < 500 && r2.s < 500, `${rSeed.s}/${r1.s}/${r2.s}`)
  check('8b. Chuyến KHỚP kế hoạch sau đua (tự chữa khi kế hoạch đổi giữa chừng)',
    lines8.length === 2 && gotQty === 197, `dòng KH=${lines8.length} SL chuyến=${gotQty} kỳ vọng=197`)
  await restWrite('erp_outbound_orders', 'DELETE', 'od_number=in.(QAAWDO901,QAAWDO902)')
}

// ── 6. Sổ lịch sử ghi đủ vết ─────────────────────────────────────────────────
const evs = await restAll('outbound_events', `select=event_type,source,actor&group_code=in.(${ALL_GC.join(',')})`)
const types = new Set(evs.map(e => e.event_type))
check('6a. Có vết "chờ dữ liệu"', types.has('AWAITING_SET'), [...types].join(','))
check('6b. Có vết "đã kích hoạt"', types.has('AWAITING_CLEARED'), [...types].join(','))
check('6c. Có vết "kế hoạch bỏ xe"', types.has('PLAN_VEHICLE_DROPPED'), [...types].join(','))
check('6d. Có vết "mở lại"', types.has('PLAN_VEHICLE_REOPENED'), [...types].join(','))
check('6e. Mọi vết đều ghi người thao tác', evs.length > 0 && evs.every(e => !!e.actor))
const g1f = await gdoOf(GC(1))
if (g1f) {
  const hist = await api(`/wms/outbound/${g1f.id}/events`)
  check('6f. API lịch sử của chuyến trả về dòng thời gian', hist.s === 200 && (hist.j?.data?.items ?? []).length > 0,
    `http=${hist.s} n=${(hist.j?.data?.items ?? []).length}`)
}

await cleanup()
const left = (await restAll('GroupDeliveryOrder', `select=id&group_code=in.(${ALL_GC.join(',')})`)).length
check('7. Dọn sạch dữ liệu test', left === 0, `còn ${left} chuyến`)

console.log(`\n[13-AWAITING-SAP] ${fail === 0 ? `XANH — ${pass} phép kiểm` : `${fail} ĐỎ / ${pass + fail}`}`)
process.exitCode = fail ? 1 : 0
