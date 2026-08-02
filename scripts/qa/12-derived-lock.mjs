// GÓI DERIVED-LOCK (user chốt 02/08): Xuất/Nhặt lẻ = KẾT QUẢ DẪN XUẤT của VL06O + Kế hoạch xuất.
// Gác: (1) chuyến origin='SAP' khóa sửa phần KẾ HOẠCH trên đơn (422 chỉ đường về nguồn), chuyến tay
// sửa như cũ; (2) CRUD tab Kế hoạch xuất TỰ DỘI xuống chuyến (thêm dòng → sinh chuyến · sửa → cập
// nhật · xóa hết → xóa chuyến PENDING · chuyến đang chạy → reconcile_task, không tự đụng);
// (3) xuất thiếu trên chuyến SAP: message Hoàn thành chỉ đường sửa DO SAP (không bảo sửa đơn).
// Tự seed tag QADRV, tự dọn 0 sót.
import { login, api, check, finish, restWrite, restAll, FIX, resolveFixtures } from './lib.mjs'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
// bcrypt của backend — seed tài khoản vai giới hạn cho case scope (mật khẩu ngẫu nhiên, xóa sau)
const bcrypt = createRequire(new URL('../../backend/package.json', import.meta.url))('bcrypt')

console.log('── GÓI DERIVED-LOCK (Xuất = dẫn xuất của VL06O + Kế hoạch xuất) ──')
await login()
await resolveFixtures()
const now = () => new Date().toISOString()
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

const WH_CODE = 'QADRV1'
// Số xe phải đúng định dạng Mãkho_X_ddmmyy_stt (replan chạy NGUYÊN validation của upload)
const [qy, qm, qd] = today.split('-')
const GC = (n) => `${WH_CODE}_X_${qd}${qm}${qy.slice(2)}_${n}`
// ĐVVT + Loại xuất phải KHỚP DANH MỤC thật (validation upload) — neo từ DB, không bịa
const vehTypeName = (await restAll('VehicleType', 'select=name&is_active=eq.true&order=name&limit=1'))[0]?.name
const dvvtName = (await restAll('TransportCompany', 'select=name&type=eq.ĐVVT&order=name&limit=1'))[0]?.name
if (!vehTypeName || !dvvtName) { console.log('❌ thiếu danh mục Loại xe/ĐVVT trên môi trường test'); process.exit(1) }

async function cleanup() {
  const gdos = await restAll('GroupDeliveryOrder', `select=id&group_code=like.${WH_CODE}*`)
  const gids = gdos.map(g => g.id)
  if (gids.length) {
    const csv = `(${gids.join(',')})`
    const dos = await restAll('OutboundDelivery', `select=id&gdo_id=in.${csv}`)
    if (dos.length) {
      const doCsv = `(${dos.map(d => d.id).join(',')})`
      const items = await restAll('OutboundItem', `select=id&do_id=in.${doCsv}`)
      if (items.length) await restWrite('OutboundScanEntry', 'DELETE', `item_id=in.(${items.map(i => i.id).join(',')})`).catch(() => {})
      await restWrite('OutboundItem', 'DELETE', `do_id=in.${doCsv}`)
      await restWrite('OutboundDelivery', 'DELETE', `gdo_id=in.${csv}`)
    }
    await restWrite('reconcile_tasks', 'DELETE', `group_code=like.${WH_CODE}*`)
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=in.${csv}`)
  }
  await restWrite('reconcile_tasks', 'DELETE', `group_code=like.${WH_CODE}*`).catch(() => {})
  await restWrite('khvc_lines', 'DELETE', `group_code=like.${WH_CODE}*`)
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=like.QADRVDO*`)
  await restWrite('Warehouse', 'DELETE', `code=eq.${WH_CODE}`)
}
await cleanup()

// ── Seed nền: kho QTY + 2 DO raw (VL06O) dùng mã fixture (có thật trong Material) ──
const whId = (await restWrite('Warehouse', 'POST', null, {
  id: randomUUID(), code: WH_CODE, name: 'QA derived-lock', warehouse_type: 'CENTRAL', inventory_mode: 'QTY',
  is_active: true, updated_at: now(),
}))[0].id
const mkRaw = async (doNo, item, qty) => (await restWrite('erp_outbound_orders', 'POST', null, {
  id: randomUUID(), od_number: doNo, od_item: item, material_code: FIX.MAT_POOL, qty_base: qty,
  ship_to_code: 'QADRVSHIP', ship_to_name: 'QADRV NPP', source: 'EXCEL', sync_status: 'ACTIVE',
  last_synced_at: now(), updated_at: now(),
}))[0]
await mkRaw('QADRVDO1', '10', 100)
await mkRaw('QADRVDO2', '10', 40)

// ── 1. Thêm dòng Kế hoạch xuất → replan SINH CHUYẾN origin='SAP' + item đúng SL raw ──
let r = await api('/external/khvc', 'POST', { group_code: GC('01'), do_no: 'QADRVDO1', npp: 'QADRV NPP', export_date: today, veh_type: vehTypeName, dvvt: dvvtName })
let gdo1 = (await restAll('GroupDeliveryOrder', `select=id,origin,status,dvvt,delivery_date&group_code=eq.${GC('01')}`))[0]
let it1 = gdo1 ? (await restAll('OutboundItem', `select=id,cartons_ordered,cartons_scanned,od_refs&do_id=in.(${(await restAll('OutboundDelivery', `select=id&gdo_id=eq.${gdo1.id}`)).map(d => d.id).join(',')})`))[0] : null
check('thêm dòng KH xuất → tự sinh chuyến SAP + SL = raw', r.s === 201 && gdo1?.origin === 'SAP' && Number(it1?.cartons_ordered) === 100 && (it1?.od_refs?.length ?? 0) > 0,
  `${r.s} origin=${gdo1?.origin} ordered=${it1?.cartons_ordered} refs=${it1?.od_refs?.length}`)

// ── 2. Chuyến SAP: khóa sửa phần kế hoạch trên đơn (mỗi field 1 phát 422), field kho vẫn sửa được ──
{
  const base = { delivery_date: gdo1.delivery_date, dvvt: gdo1.dvvt ?? '', customer_name: 'QADRV NPP', delivery_code: 'QADRVDO1' }
  const tryPatch = (body) => api(`/wms/outbound/${gdo1.id}`, 'PUT', { ...base, ...body })
  const rDate = await tryPatch({ delivery_date: '2026-12-25' })
  const rAdd  = await tryPatch({ items: [{ material_code: FIX.MAT_POOL, cartons_ordered: 5 }] })
  const rQty  = await tryPatch({ items: [{ db_id: it1.id, material_code: FIX.MAT_POOL, cartons_ordered: 999 }] })
  const rNpp  = await tryPatch({ customer_name: 'NPP KHÁC' })
  const rAttr = await tryPatch({ items: [{ db_id: it1.id, material_code: FIX.MAT_POOL, cartons_ordered: 100, batch_required: 'B123' }] })
  const itAfter = (await restAll('OutboundItem', `select=batch_required,cartons_ordered&id=eq.${it1.id}`))[0]
  check('chuyến SAP: 422 đổi ngày / thêm dòng tay / sửa SL / đổi NPP — Batch vẫn sửa được',
    rDate.s === 422 && rAdd.s === 422 && rQty.s === 422 && rNpp.s === 422 && rAttr.s === 200
    && itAfter?.batch_required === 'B123' && Number(itAfter?.cartons_ordered) === 100,
    `date=${rDate.s} add=${rAdd.s} qty=${rQty.s} npp=${rNpp.s} attr=${rAttr.s} batch=${itAfter?.batch_required}`)
  check('message 422 chỉ đường về tab nguồn', /Kế hoạch xuất|DO SAP/.test(rDate.j?.error?.message ?? ''), rDate.j?.error?.message?.slice(0, 80))
}

// ── 3. Chuyến TẠO TAY (origin='MANUAL') vẫn sửa tự do như cũ ──
{
  r = await api('/wms/outbound', 'POST', { delivery_date: today, warehouse_id: whId, dvvt: '', customer_name: 'QADRV TAY', delivery_code: 'QADRVTAY1', items: [{ material_code: FIX.MAT_POOL, cartons_ordered: 10 }] })
  const g = (await restAll('GroupDeliveryOrder', `select=id,origin,delivery_date&group_code=like.${WH_CODE}*&origin=eq.MANUAL`))[0]
  const r2 = g ? await api(`/wms/outbound/${g.id}`, 'PUT', { delivery_date: '2026-12-26', dvvt: '', customer_name: 'QADRV TAY SỬA', delivery_code: 'QADRVTAY1' }) : { s: 0 }
  const gAfter = g ? (await restAll('GroupDeliveryOrder', `select=delivery_date&id=eq.${g.id}`))[0] : null
  check('chuyến tay: origin=MANUAL + sửa ngày/NPP 200 như cũ', (r.s === 200 || r.s === 201) && g?.origin === 'MANUAL' && r2.s === 200 && gAfter?.delivery_date === '2026-12-26',
    `create=${r.s} origin=${g?.origin} edit=${r2.s} date=${gAfter?.delivery_date}`)
}

// ── 4. Sửa dòng Kế hoạch xuất → chuyến PENDING tự cập nhật (Ngày xuất + thêm DO thứ 2 vào cùng xe) ──
{
  const line1 = (await restAll('khvc_lines', `select=id&group_code=eq.${GC('01')}`))[0]
  const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  r = await api(`/external/khvc/${line1.id}`, 'PUT', { export_date: tomorrow })
  const r2 = await api('/external/khvc', 'POST', { group_code: GC('01'), do_no: 'QADRVDO2', npp: 'QADRV NPP', export_date: tomorrow, veh_type: vehTypeName, dvvt: dvvtName })
  // Replan chuyến PENDING chưa gán = XÓA-TẠO-LẠI (đúng ngữ nghĩa re-upload) → id ĐỔI, phải fetch lại SAU add
  const g = (await restAll('GroupDeliveryOrder', `select=id,delivery_date,origin&group_code=eq.${GC('01')}`))[0]
  const dosOf = await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`)
  const items = await restAll('OutboundItem', `select=cartons_ordered&do_id=in.(${dosOf.map(d => d.id).join(',')})`)
  const total = items.reduce((s, i) => s + Number(i.cartons_ordered), 0)
  check('sửa Ngày xuất dòng KH → chuyến nhận ngày mới; thêm DO 2 → chuyến gộp SL 100+40',
    r.s === 200 && g?.delivery_date === tomorrow && r2.s === 201 && total === 140,
    `edit=${r.s} date=${g?.delivery_date} add2=${r2.s} total=${total}`)
}

// ── 5. DO chưa có trong VL06O → chặn 400 ngay lúc thêm dòng ──
r = await api('/external/khvc', 'POST', { group_code: GC('02'), do_no: 'QADRVDO_MISSING', npp: 'X', export_date: today })
check('thêm dòng KH với DO chưa có raw → 400', r.s === 400 && /VL06O/.test(r.j?.error?.message ?? ''), `${r.s}`)

// ── 6. Chuyến ĐANG XUẤT: sửa KH không tự đụng chuyến — sinh reconcile_task ──
{
  const g = (await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${GC('01')}`))[0]
  await restWrite('GroupDeliveryOrder', 'PATCH', `id=eq.${g.id}`, { status: 'IN_PROGRESS', started_at: now(), license_plate: 'QADRV9999', updated_at: now() })
  const line2 = (await restAll('khvc_lines', `select=id&group_code=eq.${GC('01')}&do_no=eq.QADRVDO2`))[0]
  r = await api(`/external/khvc/${line2.id}`, 'PUT', { note: 'đổi khi đang xuất' })
  const tasks = await restAll('reconcile_tasks', `select=id,change_type,status&group_code=eq.${GC('01')}&change_type=eq.KHVC_CHANGED`)
  const gAfter = (await restAll('GroupDeliveryOrder', `select=status&id=eq.${g.id}`))[0]
  check('chuyến ĐANG XUẤT: replan bỏ qua + tạo task KHVC_CHANGED, chuyến không bị đụng',
    r.s === 200 && tasks.length >= 1 && gAfter?.status === 'IN_PROGRESS',
    `edit=${r.s} tasks=${tasks.length} status=${gAfter?.status}`)
}

// ── 7. Xuất thiếu trên chuyến SAP: message Hoàn thành chỉ đường về DO SAP ──
{
  const g = (await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${GC('01')}`))[0]
  r = await api(`/wms/outbound/${g.id}`, 'PATCH', { status: 'COMPLETED' })
  check('hoàn thành thiếu trên chuyến SAP → 400 chỉ đường "DO SAP" (không bảo sửa đơn)',
    r.s === 400 && /DO SAP/.test(r.j?.error?.message ?? '') && !/Sửa số lượng đơn xuống/.test(r.j?.error?.message ?? ''),
    `${r.s} ${r.j?.error?.message?.slice(0, 90)}`)
}

// ── 8. Xóa dòng của chuyến ĐÃ QUÉT bị chặn; xóa hết dòng chuyến PENDING chưa quét → chuyến tự xóa ──
{
  // 8a — chuyến GC01 đang IN_PROGRESS + có scanned (giả lập scanned trên item)
  const g1 = (await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${GC('01')}`))[0]
  const dosOf = await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g1.id}`)
  const it = (await restAll('OutboundItem', `select=id&do_id=in.(${dosOf.map(d => d.id).join(',')})`))[0]
  await restWrite('OutboundItem', 'PATCH', `id=eq.${it.id}`, { cartons_scanned: 5, updated_at: now() })
  const line1 = (await restAll('khvc_lines', `select=id&group_code=eq.${GC('01')}&do_no=eq.QADRVDO1`))[0]
  const rDel = await api(`/external/khvc/${line1.id}`, 'DELETE')
  // 8b — chuyến PENDING sạch: tạo group mới rồi xóa dòng duy nhất → chuyến biến mất
  await api('/external/khvc', 'POST', { group_code: GC('03'), do_no: 'QADRVDO2', npp: 'QADRV NPP', export_date: today, veh_type: vehTypeName, dvvt: dvvtName })
  const g3 = (await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${GC('03')}`))[0]
  const line3 = (await restAll('khvc_lines', `select=id&group_code=eq.${GC('03')}`))[0]
  const rDel3 = await api(`/external/khvc/${line3.id}`, 'DELETE')
  const g3After = await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${GC('03')}`)
  check('xóa dòng chuyến ĐÃ QUÉT → 409; xóa hết dòng chuyến PENDING sạch → chuyến tự xóa',
    rDel.s === 409 && !!g3 && rDel3.s === 200 && g3After.length === 0,
    `delScanned=${rDel.s} g3=${!!g3} del3=${rDel3.s} left=${g3After.length}`)
}

// ── 9. Chuyến mà KH toàn OBSOLETE (kế hoạch đã bỏ) → PHẢI xóa được, không kẹt vĩnh viễn (fix 02/08) ──
{
  await api('/external/khvc', 'POST', { group_code: GC('04'), do_no: 'QADRVDO2', npp: 'QADRV NPP', export_date: today, veh_type: vehTypeName, dvvt: dvvtName })
  const g = (await restAll('GroupDeliveryOrder', `select=id&group_code=eq.${GC('04')}`))[0]
  await restWrite('khvc_lines', 'PATCH', `group_code=eq.${GC('04')}`, { sync_status: 'OBSOLETE', updated_at: now() })
  const rDel = await api(`/wms/outbound/${g.id}`, 'DELETE')
  check('KH toàn OBSOLETE → chuyến xóa được 200 (không kẹt)', rDel.s === 200, `${rDel.s}`)
  await restWrite('khvc_lines', 'DELETE', `group_code=eq.${GC('04')}`)
}

// ── 10. SCOPE KHO cho CRUD Kế hoạch xuất (fix 02/08 — lỗ cũ, nặng lên khi CRUD sinh chuyến) ──
{
  const PWD = 'Qa' + randomUUID().slice(0, 10) + '!'
  const jobId = randomUUID(), empId = randomUUID()
  const whOther = (await restWrite('Warehouse', 'POST', null, {
    id: randomUUID(), code: 'QADRV2', name: 'QA drv kho khác', warehouse_type: 'CENTRAL', inventory_mode: 'QTY', is_active: true, updated_at: now(),
  }))[0].id
  await restWrite('JobTitle', 'POST', null, { id: jobId, name: 'QADRV Điều vận', module_permissions: { external_khvc: ['view', 'create', 'edit', 'delete'] }, updated_at: now() })
  await restWrite('Employee', 'POST', null, {
    id: empId, employee_code: 'QADRVU1', name: 'QADRV user', email: 'qadrvu1@qa.local',
    password: bcrypt.hashSync(PWD, 10), job_title_id: jobId, is_active: true,
    warehouse_scope: 'ASSIGNED', warehouse_id: whOther, created_at: now(), updated_at: now(),
  })
  await restWrite('UserWarehouseAccess', 'POST', null, { id: randomUUID(), employee_id: empId, warehouse_id: whOther })
  // login vai giới hạn (scope = QADRV2, KHÔNG có QADRV1)
  const BASE2 = process.env.QA_BASE_URL || 'https://wms-webapp-git-dev-vietnamese2212s-projects.vercel.app'
  const lr = await fetch(`${BASE2}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'qadrvu1@qa.local', password: PWD }) })
  const tok = (await lr.json().catch(() => null))?.data?.token
  const rOut = await fetch(`${BASE2}/api/external/khvc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ group_code: GC('05'), do_no: 'QADRVDO2', npp: 'X', export_date: today }),
  })
  check('vai scope kho KHÁC tạo dòng KH kho QADRV1 → 403', !!tok && rOut.status === 403, `tok=${!!tok} s=${rOut.status}`)
  await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${empId}`)
  await restWrite('Employee', 'DELETE', `id=eq.${empId}`)
  await restWrite('JobTitle', 'DELETE', `id=eq.${jobId}`)
  await restWrite('Warehouse', 'DELETE', `code=eq.QADRV2`)
}

// ── Dọn 0 sót ──
await cleanup()
{
  const [w, g, k, e, t] = await Promise.all([
    restAll('Warehouse', `select=id&code=eq.${WH_CODE}`),
    restAll('GroupDeliveryOrder', `select=id&group_code=like.${WH_CODE}*`),
    restAll('khvc_lines', `select=id&group_code=like.${WH_CODE}*`),
    restAll('erp_outbound_orders', `select=id&od_number=like.QADRVDO*`),
    restAll('reconcile_tasks', `select=id&group_code=like.${WH_CODE}*`),
  ])
  check('dọn sạch 0 sót', [w, g, k, e, t].every(x => x.length === 0), `wh=${w.length} gdo=${g.length} khvc=${k.length} erp=${e.length} task=${t.length}`)
}

finish('DERIVED-LOCK')
