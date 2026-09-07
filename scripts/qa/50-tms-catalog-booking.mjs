// GÓI 50 — DANH MỤC VẬN TẢI + ĐẶT KHUNG GIỜ + KẾ HOẠCH NHẬP
// (loại xe · ĐVVT/NCC · xe · khung giờ mẫu · sinh khung giờ · lệnh vận chuyển · dòng xe & đặt lịch
//  · kế hoạch nhập chuyển kho · id rác trên route GHI)
//
// VÌ SAO CÓ GÓI NÀY (06–07/09): cả nhóm route trên KHÔNG gói QA nào chạm tới. Đây là phần "hạ tầng
// danh mục" mà mọi màn TMS đứng lên — sai ở đây thì sai lan sang đặt lịch, kế hoạch nhập, cổng, cân.
// Ba lớp lỗi gói này gác:
//   (1) MẤT DỮ LIỆU KHI THAO TÁC THẤT BẠI — xoá ĐVVT xoá cứng xe + tài khoản tài xế TRƯỚC khi
//       kiểm ràng buộc, nên API báo lỗi mà xe đã bay (mục [9]).
//   (2) KHUNG GIỜ KẸT CHỖ — sổ đếm `DeliverySlot.booked_count` là CACHE; mọi phép kiểm ở đây so nó
//       với ĐẾM SỐNG tự tính lại (dòng BOOKED/ARRIVED/DONE không biển + số BIỂN phân biệt), không so
//       hằng số gõ tay. Huỷ dòng kế hoạch cuối cùng làm lệnh thành ĐÃ HUỶ mà không nhả khung (mục [56]).
//   (3) LỖI "Lỗi hệ thống" THAY CHO LỜI TỪ CHỐI RÕ RÀNG — trùng mã, thứ ngoài T2..T7, id rác trên
//       route PATCH/PUT/DELETE (gói 07 mục 6 chỉ quét route GET nên lớp này chưa có lưới).
//
// AN TOÀN: mọi bản ghi gói này tạo ra đều mang tiền tố QA50 (mã loại xe / mã ĐVVT / biển số / mã lệnh).
// Khung giờ test đặt ở NGÀY TƯƠNG LAI và gắn vào LOẠI XE riêng của gói (reapply/generate chỉ đụng
// (kho, loại xe) đó) ⇒ không chạm lịch thật của kho. Dọn theo đúng thứ tự khoá ngoại + recount_slot.
import { api, login, restAll, restWrite, restRpc, check, finish, HAS_DB, FIX } from './lib.mjs'
import { randomUUID } from 'crypto'

if (!HAS_DB) { console.error('Thiếu backend/.env — gói 50 cần soi DB để tự tính lại sổ đếm'); process.exit(1) }
await login()

const T = 'QA50'
const WH = FIX.WH_QTY
const num = v => Number(v ?? 0)
const gio = () => new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })

// Mọi lời gọi API đi qua đây để GHI LẠI ca 500 (phải dọn error_logs sau khi chạy)
const ca500 = []
async function A(path, method = 'GET', body) {
  const r = await api(path, method, body)
  if (r.s >= 500) ca500.push(`${method} /api${path} → ${r.s} lúc ${gio()}`)
  return r
}

// ── Ngày test: tương lai, thứ ∈ T2..T7 (SlotTemplate.day_of_week CHECK 1..6, không có Chủ nhật) ──
let D = null, DOW = 0
for (let k = 10; k < 20; k++) {
  const t = new Date(); t.setUTCDate(t.getUTCDate() + k)
  const ds = t.toISOString().slice(0, 10)
  const [y, m, d] = ds.split('-').map(Number)
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (w >= 1 && w <= 6) { D = ds; DOW = w; break }
}
console.log(`── GÓI 50: DANH MỤC VẬN TẢI + ĐẶT KHUNG GIỜ + KẾ HOẠCH NHẬP (kho ${WH.name}, ngày test ${D}, thứ ${DOW + 1}) ──`)

// ── Oracle sổ đếm: đếm SỐNG đúng công thức RPC book_vehicle_slot/recount_slot ──
//    chỗ chiếm = (số dòng KHÔNG biển) + (số BIỂN phân biệt), chỉ tính BOOKED/ARRIVED/DONE.
async function demSong(slotId) {
  const rows = await restAll('TmsVehicleSlot', `select=license_plate,status&slot_id=eq.${slotId}`)
  const act = rows.filter(r => ['BOOKED', 'ARRIVED', 'DONE'].includes(r.status))
  return act.filter(r => !r.license_plate).length
    + new Set(act.filter(r => r.license_plate).map(r => r.license_plate)).size
}
async function soDem(slotId) {
  const [s] = await restAll('DeliverySlot', `select=booked_count&id=eq.${slotId}`)
  return s ? num(s.booked_count) : -1
}
const daDung = new Set()   // mọi khung giờ gói này từng đụng → kiểm lại ở phép cuối

// ════════════════════════════ DỌN TRƯỚC (tàn dư lần chạy trước) ════════════════════════════
async function wipe() {
  const tcs = await restAll('TransportCompany', `select=id&code=like.${T}*`)
  const vts = await restAll('VehicleType', `select=id&code=like.${T}*`)
  const tcIds = tcs.map(x => x.id), vtIds = vts.map(x => x.id)

  const ors = [`order_code.like.${T}*`]
  if (tcIds.length) ors.push(`ncc_id.in.(${tcIds.join(',')})`)
  const orders = await restAll('TmsOrder', `select=id&or=(${ors.join(',')})`)
  for (const o of orders) {
    for (const vs of await restAll('TmsVehicleSlot', `select=slot_id&order_id=eq.${o.id}`)) if (vs.slot_id) daDung.add(vs.slot_id)
    await restWrite('inbound_plan_lines', 'DELETE', `tms_order_id=eq.${o.id}`).catch(() => {})
    await restWrite('TmsVehicleSlot', 'DELETE', `order_id=eq.${o.id}`).catch(() => {})
    await restWrite('TmsOrder', 'DELETE', `id=eq.${o.id}`).catch(() => {})
  }
  await restWrite('inbound_plan_lines', 'DELETE', `po_number=like.${T}*`).catch(() => {})

  for (const vt of vtIds) {
    for (const s of await restAll('DeliverySlot', `select=id&vehicle_type_id=eq.${vt}`)) {
      await restWrite('TmsVehicleSlot', 'PATCH', `slot_id=eq.${s.id}`, { slot_id: null, status: 'PENDING' }).catch(() => {})
      await restWrite('DeliverySlot', 'DELETE', `id=eq.${s.id}`).catch(() => {})
    }
    await restWrite('SlotTemplate', 'DELETE', `vehicle_type_id=eq.${vt}`).catch(() => {})
    await restWrite('Vehicle', 'DELETE', `vehicle_type_id=eq.${vt}`).catch(() => {})
  }
  if (tcIds.length) await restWrite('Vehicle', 'DELETE', `ncc_id=in.(${tcIds.join(',')})`).catch(() => {})
  for (const s of daDung) await restRpc('recount_slot', { p_slot_id: s }).catch(() => {})
  if (vtIds.length) await restWrite('VehicleType', 'DELETE', `id=in.(${vtIds.join(',')})`).catch(() => {})
  if (tcIds.length) await restWrite('TransportCompany', 'DELETE', `id=in.(${tcIds.join(',')})`).catch(() => {})
}
await wipe()
daDung.clear()

// Mã hàng có ĐƠN VỊ NHẬP (thùng) để đo đúng chỗ quy đổi BASE ↔ thùng
const MATS = await restAll('Material',
  'select=id,material_code,short_name,units_per_carton,entry_unit,base_unit'
  + '&entry_unit=not.is.null&units_per_carton=gt.1&is_active=is.true&order=material_code&limit=4')
if (MATS.length < 4) { console.error('Cần ≥4 mã hàng có đơn vị nhập để dựng fixture'); process.exit(1) }
const UPC = num(MATS[0].units_per_carton)
const quyDoi = (base, mat) => (mat?.entry_unit && num(mat.units_per_carton) > 0
  ? Math.round((num(base) / num(mat.units_per_carton)) * 1000) / 1000 : num(base))

// ═══════════════════ A. LOẠI XE ══════════════════════════════════════════════
let VT1 = null, VT2 = null
{
  let r = await A('/tms/vehicle-types', 'POST', { code: `${T.toLowerCase()}vt1`, name: `${T} Loại xe 1` })
  VT1 = r.j?.data
  check('[1] Thêm loại xe mới → lưu được và mã tự viết HOA',
    (r.s === 201 || r.s === 200) && VT1?.code === `${T}VT1`, `s=${r.s} · mã=${VT1?.code}`)

  r = await A('/tms/vehicle-types', 'POST', { code: `${T}VT1`, name: `${T} trùng mã` })
  check('[2] Thêm loại xe TRÙNG MÃ → báo "mã đã tồn tại" (409), không trả "Lỗi hệ thống"',
    r.s === 409, `s=${r.s} · ${(r.j?.error?.message ?? '').slice(0, 70)}`)

  r = await A('/tms/vehicle-types', 'POST', { code: `${T}VT2`, name: `${T} Loại xe 2` })
  VT2 = r.j?.data

  // Kéo-thả sắp thứ tự: gửi kèm 1 id KHÔNG TỒN TẠI → số báo về phải là số dòng THẬT được sắp
  const idMa = randomUUID()
  r = await A('/tms/vehicle-types/reorder', 'PUT', { ids: [VT2.id, VT1.id, idMa] })
  check('[3] Sắp thứ tự loại xe: số báo "đã sắp N" phải là SỐ DÒNG THẬT (gửi kèm 1 id không tồn tại)',
    r.s === 200 && num(r.j?.data?.reordered) === 2, `báo ${r.j?.data?.reordered} · thực tế sắp được 2/3 id`)

  const [a] = await restAll('VehicleType', `select=sort_order&id=eq.${VT2.id}`)
  const [b] = await restAll('VehicleType', `select=sort_order&id=eq.${VT1.id}`)
  check('[4] Sắp thứ tự loại xe → thứ tự mới ghi xuống DB đúng vị trí kéo thả',
    num(a.sort_order) === 1 && num(b.sort_order) === 2, `${T}VT2=${a.sort_order} · ${T}VT1=${b.sort_order}`)

  r = await A(`/tms/vehicle-types/${randomUUID()}`, 'DELETE')
  check('[5] Xoá loại xe KHÔNG TỒN TẠI → phải báo không tìm thấy (404), không báo "đã xoá" cho việc chưa làm',
    r.s === 404, `s=${r.s} · ${JSON.stringify(r.j?.data ?? r.j?.error?.message ?? '').slice(0, 60)}`)
}

// ═══════════════════ B. ĐVVT / NCC ═══════════════════════════════════════════
let TC1 = null, TC2 = null
{
  let r = await A('/tms/transport-companies', 'POST', { code: `${T}TC1`, name: `${T} ĐVVT chính`, type: 'ĐVVT' })
  TC1 = r.j?.data
  check('[6] Thêm ĐVVT mới → lưu được', (r.s === 201 || r.s === 200) && TC1?.code === `${T}TC1`, `s=${r.s} · mã=${TC1?.code}`)

  r = await A('/tms/transport-companies', 'POST', { code: `${T}TC1`, name: `${T} trùng` })
  check('[7] Thêm ĐVVT TRÙNG MÃ → chặn và nói rõ mã nào đụng', r.s === 409,
    `s=${r.s} · ${(r.j?.error?.message ?? '').slice(0, 70)}`)

  r = await A(`/tms/transport-companies/${TC1.id}`, 'PUT', { name: `${T} ĐVVT chính (đã sửa)`, contact_phone: '0900000000' })
  const [tcDb] = await restAll('TransportCompany', `select=name,contact_phone&id=eq.${TC1.id}`)
  check('[8] Sửa ĐVVT → tên và số điện thoại ghi xuống DB',
    r.s === 200 && tcDb.name === `${T} ĐVVT chính (đã sửa)` && tcDb.contact_phone === '0900000000',
    `s=${r.s} · tên="${tcDb.name}" · sđt=${tcDb.contact_phone}`)

  // ── PHÉP KIỂM ĐẮT GIÁ 1: xoá ĐVVT khi còn lệnh vận chuyển tham chiếu ──
  // Người dùng bấm Xoá, hệ thống báo lỗi ⇒ họ tin "không có gì xảy ra". Phải đúng như vậy.
  r = await A('/tms/transport-companies', 'POST', { code: `${T}TC2`, name: `${T} ĐVVT thử xoá`, type: 'ĐVVT' })
  TC2 = r.j?.data
  const rv = await A('/tms/vehicles', 'POST', { ncc_id: TC2.id, license_plate: '29QA0002', vehicle_type_id: VT1.id })
  const xeTC2 = rv.j?.data
  await A('/tms/orders', 'POST', {
    date: D, warehouse_id: WH.id, direction: 'INBOUND', ncc_id: TC2.id, order_code: `${T}-ORD-TC2`,
  })
  const rDel = await A(`/tms/transport-companies/${TC2.id}`, 'DELETE')
  const conXe = xeTC2?.id ? (await restAll('Vehicle', `select=id&id=eq.${xeTC2.id}`)).length : -1
  const conTc = (await restAll('TransportCompany', `select=id&id=eq.${TC2.id}`)).length
  check('[9] Xoá ĐVVT còn lệnh vận chuyển đang dùng → phải TỪ CHỐI (409) và TUYỆT ĐỐI không xoá mất xe của họ',
    rDel.s === 409 && conXe === 1 && conTc === 1,
    `s=${rDel.s} · xe của ĐVVT còn ${conXe}/1 · ĐVVT còn ${conTc}/1`)

  r = await A(`/tms/transport-companies/${randomUUID()}`, 'DELETE')
  check('[10] Xoá ĐVVT KHÔNG TỒN TẠI → phải báo không tìm thấy (404), không báo "đã xoá"',
    r.s === 404, `s=${r.s} · ${JSON.stringify(r.j?.data ?? '').slice(0, 40)}`)
}

// ═══════════════════ C. XE ═══════════════════════════════════════════════════
let XE1 = null
{
  let r = await A('/tms/vehicles', 'POST', { ncc_id: TC1.id, license_plate: '29qa-0001', vehicle_type_id: VT1.id })
  XE1 = r.j?.data
  check('[11] Thêm xe gõ biển "29qa-0001" → lưu về dạng chuẩn 29QA0001 (chỉ chữ+số, viết HOA)',
    (r.s === 201 || r.s === 200) && XE1?.license_plate === '29QA0001', `s=${r.s} · biển lưu=${XE1?.license_plate}`)

  r = await A('/tms/vehicles', 'POST', { ncc_id: TC1.id, license_plate: '29 QA 0001', vehicle_type_id: VT1.id })
  check('[12] Thêm lại CÙNG biển cho CÙNG ĐVVT → báo trùng rõ ràng (409), không "Lỗi hệ thống"',
    r.s === 409, `s=${r.s} · ${(r.j?.error?.message ?? '').slice(0, 70)}`)

  r = await A('/tms/vehicles', 'POST', { ncc_id: TC2.id, license_plate: '29QA0001', vehicle_type_id: VT1.id })
  check('[13] Cùng biển số nhưng ĐVVT KHÁC → vẫn thêm được (1 xe chạy cho 2 nhà thầu là chuyện thật)',
    r.s === 201 || r.s === 200, `s=${r.s}`)

  // API không cho đổi biển số; điều tối kỵ là TRẢ VỀ biển mới trong khi DB giữ biển cũ.
  r = await A(`/tms/vehicles/${XE1.id}`, 'PUT', { license_plate: '30ZZ9999', is_active: true })
  const [xeDb] = await restAll('Vehicle', `select=license_plate&id=eq.${XE1.id}`)
  check('[14] Sửa xe: dữ liệu trả về phải khớp DB (không báo đã đổi biển trong khi DB giữ nguyên)',
    r.s === 200 && r.j?.data?.license_plate === xeDb.license_plate,
    `trả về=${r.j?.data?.license_plate} · DB=${xeDb.license_plate}`)

  r = await A(`/tms/vehicle-types/${VT1.id}`, 'DELETE')
  const conVt = (await restAll('VehicleType', `select=id&id=eq.${VT1.id}`)).length
  check('[15] Xoá loại xe ĐANG CÓ XE dùng → chặn và nói rõ đang bị dùng bởi mấy xe',
    r.s === 409 && conVt === 1 && /xe/i.test(r.j?.error?.message ?? ''),
    `s=${r.s} · ${(r.j?.error?.message ?? '').slice(0, 90)}`)
}

// ═══════════════════ D. KHUNG GIỜ MẪU (lưới thứ × khung) ═════════════════════
{
  let r = await A('/tms/slot-templates/batch', 'POST', {
    warehouse_id: WH.id, vehicle_type_id: VT1.id, cargo_type: 'ALL', days_of_week: [DOW],
    time_slots: [
      { time_from: '21:00', time_to: '21:30', max_vehicles: 1 },
      { time_from: '22:00', time_to: '22:30', max_vehicles: 5 },
      { time_from: '23:00', time_to: '23:30', max_vehicles: 1 },
    ],
  })
  check('[16] Lưu cả cụm khung giờ mẫu (1 thứ × 3 khung) → tạo đủ 3 khung',
    r.s === 200 && num(r.j?.data?.inserted) === 3, `s=${r.s} · thêm=${r.j?.data?.inserted} sửa=${r.j?.data?.updated} bỏ=${r.j?.data?.removed}`)

  r = await A('/tms/slot-templates/batch', 'POST', {
    warehouse_id: WH.id, vehicle_type_id: VT2.id, cargo_type: 'ALL', days_of_week: [DOW],
    time_slots: [{ time_from: '10:00', time_to: '09:00', max_vehicles: 1 }],
  })
  check('[17] Lưu cụm khung giờ có giờ kết thúc TRƯỚC giờ bắt đầu → chặn kèm lời giải thích',
    r.s === 400, `s=${r.s} · ${(r.j?.error?.message ?? '').slice(0, 70)}`)

  // Cùng một luật, hai cửa vào (lưới vs thêm lẻ) phải cho cùng câu trả lời
  r = await A('/tms/slot-templates', 'POST', {
    warehouse_id: WH.id, vehicle_type_id: VT2.id, cargo_type: 'ALL',
    days_of_week: [DOW], time_from: '20:00', time_to: '19:00', max_vehicles: 1,
  })
  check('[18] Thêm LẺ một khung giờ mẫu có giờ kết thúc TRƯỚC giờ bắt đầu → phải chặn y như lưới',
    r.s === 400, `s=${r.s} · ${(r.j?.error?.message ?? '').slice(0, 70)}`)

  r = await A('/tms/slot-templates', 'POST', {
    warehouse_id: WH.id, vehicle_type_id: VT2.id, cargo_type: 'ALL',
    days_of_week: [0], time_from: '08:00', time_to: '09:00', max_vehicles: 1,
  })
  check('[19] Thêm khung giờ mẫu cho CHỦ NHẬT (thứ 0) → báo rõ "chỉ T2..T7", không "Lỗi hệ thống"',
    r.s >= 400 && r.s < 500, `s=${r.s} · ${(r.j?.error?.message ?? '').slice(0, 70)}`)

  r = await A('/tms/slot-templates/batch', 'POST', {
    warehouse_id: WH.id, vehicle_type_id: VT2.id, cargo_type: 'ALL', days_of_week: [7],
    time_slots: [{ time_from: '08:00', time_to: '09:00', max_vehicles: 1 }],
  })
  check('[20] Lưu cụm khung giờ với thứ ngoài T2..T7 (giá trị 7) → báo rõ, không "Lỗi hệ thống"',
    r.s >= 400 && r.s < 500, `s=${r.s} · ${(r.j?.error?.message ?? '').slice(0, 70)}`)

  r = await A(`/tms/slot-templates?warehouse_id=${WH.id}&vehicle_type_id=${VT1.id}`, 'GET')
  const tpl = r.j?.data ?? []
  check('[21] Danh sách khung giờ mẫu của (kho, loại xe) → thấy đủ 3 khung vừa lưu',
    r.s === 200 && tpl.filter(x => x.is_active).length === 3, `s=${r.s} · ${tpl.length} dòng (${tpl.filter(x => x.is_active).length} đang bật)`)

  r = await A(`/tms/slot-templates/apply-info?warehouse_id=${WH.id}&vehicle_type_id=${VT1.id}`, 'GET')
  check('[22] "Áp dụng từ ngày nào" → trả ngày hôm nay + ngày áp được (chưa ai đặt lịch thì áp ngay)',
    r.s === 200 && /^\d{4}-\d{2}-\d{2}$/.test(r.j?.data?.today ?? '') && !!r.j?.data?.applicable_from,
    `hôm nay=${r.j?.data?.today} · áp từ=${r.j?.data?.applicable_from} · vướng=${JSON.stringify(r.j?.data?.nearest_blocked)}`)

  const t21 = tpl.find(x => String(x.time_from).startsWith('21:'))
  r = await A(`/tms/slot-templates/${t21.id}`, 'PUT', { max_vehicles: 2 })
  const [t21db] = await restAll('SlotTemplate', `select=max_vehicles&id=eq.${t21.id}`)
  check('[23] Sửa 1 khung giờ mẫu (nâng số xe tối đa 1→2) → ghi xuống DB',
    r.s === 200 && num(t21db.max_vehicles) === 2, `s=${r.s} · số xe tối đa=${t21db.max_vehicles}`)
}

// ═══════════════════ E. SINH KHUNG GIỜ THEO NGÀY ═════════════════════════════
let SLOT21 = null, SLOT22 = null, SLOT23 = null
const slotTruoc = new Set()   // khung đã có sẵn của ngày test TRƯỚC khi gói này bấm "Sinh khung giờ"
{
  // "Sinh khung giờ" chạy theo KHO (mọi loại xe), không riêng loại xe của gói ⇒ số kỳ vọng phải
  // đếm theo kho, trừ đi khung đã sinh sẵn.
  const tplNgay = (await restAll('SlotTemplate',
    `select=id&warehouse_id=eq.${WH.id}&is_active=is.true&day_of_week=eq.${DOW}`)).length
  for (const s of await restAll('DeliverySlot', `select=id&warehouse_id=eq.${WH.id}&date=eq.${D}`)) slotTruoc.add(s.id)
  const daCo = (await restAll('DeliverySlot',
    `select=id&warehouse_id=eq.${WH.id}&date=eq.${D}&template_id=not.is.null`)).length

  let r = await A('/tms/slots/generate', 'POST', { warehouse_id: WH.id, dates: [D] })
  check('[24] Sinh khung giờ cho ngày test → sinh đúng số khung mẫu đang bật của ngày đó',
    r.s === 200 && num(r.j?.data?.created) === tplNgay - daCo,
    `sinh=${r.j?.data?.created} · mẫu đang bật của kho trong ngày=${tplNgay} · đã có sẵn=${daCo}`)

  const tplVT1 = (await restAll('SlotTemplate',
    `select=id&warehouse_id=eq.${WH.id}&vehicle_type_id=eq.${VT1.id}&is_active=is.true&day_of_week=eq.${DOW}`)).length
  r = await A('/tms/slots/generate', 'POST', { warehouse_id: WH.id, dates: [D] })
  const soSlot = (await restAll('DeliverySlot', `select=id&vehicle_type_id=eq.${VT1.id}&date=eq.${D}`)).length
  check('[25] Bấm sinh khung giờ LẦN HAI cho cùng ngày → không nhân đôi lịch',
    r.s === 200 && num(r.j?.data?.created) === 0 && soSlot === tplVT1,
    `sinh thêm=${r.j?.data?.created} · khung trong DB=${soSlot} · mẫu đang bật=${tplVT1}`)

  r = await A(`/tms/slots?date=${D}&warehouse_id=${WH.id}`, 'GET')
  const slots = (r.j?.data ?? []).filter(s => s.vehicle_type_id === VT1.id)
  SLOT21 = slots.find(s => String(s.time_from).startsWith('21:'))
  SLOT22 = slots.find(s => String(s.time_from).startsWith('22:'))
  SLOT23 = slots.find(s => String(s.time_from).startsWith('23:'))
  check('[26] Mở lịch khung giờ ngày test → thấy đủ 3 khung, đúng số xe tối đa đã cài',
    r.s === 200 && !!SLOT21 && !!SLOT22 && !!SLOT23
    && num(SLOT21.max_vehicles) === 2 && num(SLOT22.max_vehicles) === 5 && num(SLOT23.max_vehicles) === 1,
    `21h(max ${SLOT21?.max_vehicles}) · 22h(max ${SLOT22?.max_vehicles}) · 23h(max ${SLOT23?.max_vehicles})`)

  r = await A(`/tms/slots?date=${D}&warehouse_id=${WH.id}&direction=OUTBOUND`, 'GET')
  const loc = (r.j?.data ?? []).filter(s => s.vehicle_type_id === VT1.id)
  check('[27] Lọc lịch khung giờ theo CHIỀU (xuất/nhập) → không được trả rỗng oan khi lịch vẫn có khung',
    r.s === 200 && loc.length > 0, `lọc chiều=OUTBOUND trả ${loc.length} khung · không lọc có ${slots.length} khung`)
}

// ═══════════════════ F. LỆNH VẬN CHUYỂN ══════════════════════════════════════
let ORD1 = null, ORD2 = null, ORD3 = null
{
  let r = await A('/tms/orders', 'POST', {
    date: D, warehouse_id: WH.id, direction: 'OUTBOUND', ncc_id: TC1.id, order_code: `${T}-ORD-1`,
    vehicle_type: `${T}XE`, planned_boxes: 100, notes: `${T} lệnh test`,
  })
  ORD1 = r.j?.data
  check('[28] Tạo lệnh vận chuyển → lưu được và TỰ SINH sẵn 1 dòng xe để đặt lịch',
    (r.s === 201 || r.s === 200) && (ORD1?.vehicle_slots ?? []).length === 1 && ORD1.vehicle_slots[0].status === 'PENDING',
    `s=${r.s} · ${(ORD1?.vehicle_slots ?? []).length} dòng xe · mã=${ORD1?.order_code}`)

  r = await A('/tms/orders', 'POST', {
    date: D, warehouse_id: WH.id, direction: 'NGANG', ncc_id: TC1.id, order_code: `${T}-ORD-XX`,
  })
  check('[29] Tạo lệnh với hướng KHÔNG HỢP LỆ (không phải Nhập/Xuất) → báo rõ, không "Lỗi hệ thống"',
    r.s >= 400 && r.s < 500, `s=${r.s} · ${(r.j?.error?.message ?? '').slice(0, 70)}`)

  // [29b] Vòng đời lệnh là danh sách ĐÓNG (user chốt 07/09: Chờ · Xong · Huỷ). Cùng lớp lỗi với
  // trạng thái DÒNG XE ở phép [36]: nhận bừa một giá trị lạ thì bản ghi rơi ra ngoài mọi bộ lọc và
  // báo cáo, mà không màn hình nào nói cho ai biết.
  {
    const truoc = (await restAll('TmsOrder', `select=status&id=eq.${ORD1.id}`))[0]
    const rs = await A(`/tms/orders/${ORD1.id}`, 'PATCH', { status: 'XYZ' })
    const sau = (await restAll('TmsOrder', `select=status&id=eq.${ORD1.id}`))[0]
    check('[29b] Gửi trạng thái lệnh LẠ ("XYZ") → từ chối 4xx và GIỮ nguyên trạng thái cũ',
      rs.s >= 400 && rs.s < 500 && sau?.status === truoc?.status,
      `s=${rs.s} · trạng thái: ${truoc?.status} → ${sau?.status}`)
  }
  {
    const rs = await A(`/tms/orders/${ORD1.id}`, 'PATCH', { status: 'CANCELLED' })
    const sau = (await restAll('TmsOrder', `select=status&id=eq.${ORD1.id}`))[0]
    const back = await A(`/tms/orders/${ORD1.id}`, 'PATCH', { status: 'PENDING' })
    check('[29c] Ba trạng thái hợp lệ vẫn đặt được (Huỷ rồi trả về Chờ) — luật đóng không khoá nhầm việc thật',
      rs.s === 200 && sau?.status === 'CANCELLED' && back.s === 200,
      `huỷ s=${rs.s} · DB=${sau?.status} · trả lại s=${back.s}`)
  }

  r = await A('/tms/orders/bulk', 'POST', {
    orders: [
      { order_code: `${T}-ORD-2`, date: D, warehouse_id: WH.id, direction: 'OUTBOUND', ncc_id: TC1.id },
      { order_code: `${T}-ORD-3`, date: D, warehouse_id: WH.id, direction: 'OUTBOUND', ncc_id: TC1.id },
    ],
  })
  check('[30] Nạp nhiều lệnh cùng lúc (upload) → báo đúng số lệnh đã ghi',
    (r.s === 201 || r.s === 200) && num(r.j?.data?.inserted) === 2, `s=${r.s} · ghi=${r.j?.data?.inserted}`)

  r = await A('/tms/orders/bulk', 'POST', {
    orders: [{ order_code: `${T}-ORD-2`, date: D, warehouse_id: WH.id, direction: 'OUTBOUND', ncc_id: TC1.id }],
  })
  check('[31] Nạp lại file có mã lệnh ĐÃ TỒN TẠI → chặn và nêu đích danh mã trùng',
    r.s === 409 && (r.j?.error?.message ?? '').includes(`${T}-ORD-2`), `s=${r.s} · ${(r.j?.error?.message ?? '').slice(0, 90)}`)

  const dsOrd = await restAll('TmsOrder', `select=id,order_code&order_code=in.("${T}-ORD-2","${T}-ORD-3")`)
  ORD2 = dsOrd.find(o => o.order_code === `${T}-ORD-2`)
  ORD3 = dsOrd.find(o => o.order_code === `${T}-ORD-3`)
  const soDongXe = (await restAll('TmsVehicleSlot', `select=id&order_id=in.(${dsOrd.map(o => o.id).join(',')})`)).length
  check('[32] Lệnh nạp hàng loạt cũng phải có sẵn dòng xe (không thì không ai đặt lịch được)',
    soDongXe === 2, `${soDongXe}/2 dòng xe`)
}

// ═══════════════════ G. DÒNG XE + ĐẶT KHUNG GIỜ (oracle sổ đếm) ══════════════
let VS1 = null, VS2 = null, VS3 = null
{
  VS1 = ORD1.vehicle_slots[0].id
  VS2 = (await restAll('TmsVehicleSlot', `select=id&order_id=eq.${ORD2.id}`))[0].id
  VS3 = (await restAll('TmsVehicleSlot', `select=id&order_id=eq.${ORD3.id}`))[0].id
  daDung.add(SLOT21.id); daDung.add(SLOT22.id); daDung.add(SLOT23.id)

  let r = await A(`/tms/vehicle-slots/${VS1}`, 'PATCH',
    { slot_id: SLOT23.id, license_plate: '29qa-0001', driver_name: `${T} tài xế`, driver_phone: '0900000001' })
  let cache = await soDem(SLOT23.id), song = await demSong(SLOT23.id)
  check('[33] Đặt khung giờ cho xe → xe vào khung, biển số về dạng chuẩn, sổ đếm khớp đếm sống',
    r.s === 200 && r.j?.data?.status === 'BOOKED' && r.j?.data?.license_plate === '29QA0001' && cache === song && cache === 1,
    `s=${r.s} · trạng thái=${r.j?.data?.status} · biển=${r.j?.data?.license_plate} · sổ đếm=${cache} · đếm sống=${song}`)

  r = await A(`/tms/vehicle-slots/${VS2}`, 'PATCH', { slot_id: SLOT23.id, license_plate: '29QA0002' })
  cache = await soDem(SLOT23.id); song = await demSong(SLOT23.id)
  check('[34] Khung chỉ còn 1 chỗ, xe thứ hai BIỂN KHÁC xin vào → từ chối "hết chỗ" và sổ đếm không tăng',
    r.s === 409 && cache === song && cache === 1,
    `s=${r.s} ${(r.j?.error?.message ?? '').slice(0, 40)} · sổ đếm=${cache} · đếm sống=${song}`)

  r = await A(`/tms/vehicle-slots/${VS2}`, 'PATCH', { slot_id: SLOT23.id, license_plate: '29QA0001' })
  cache = await soDem(SLOT23.id); song = await demSong(SLOT23.id)
  const soDong = (await restAll('TmsVehicleSlot', `select=id&slot_id=eq.${SLOT23.id}&status=eq.BOOKED`)).length
  check('[35] Hai lệnh đi CHUNG MỘT XE (cùng biển) → cả hai vào được khung và chỉ chiếm 1 chỗ',
    r.s === 200 && soDong === 2 && cache === song && cache === 1,
    `s=${r.s} · ${soDong} lệnh trong khung · sổ đếm=${cache} · đếm sống=${song} (max ${SLOT23.max_vehicles})`)

  // Trạng thái lạ: nếu API nhận bừa thì dòng đó biến mất khỏi phép đếm sức chứa → khung nhận quá tải
  await A(`/tms/vehicle-slots/${VS3}`, 'PATCH', { slot_id: SLOT22.id, license_plate: '29QA0003' })
  const truoc = await soDem(SLOT22.id)
  r = await A(`/tms/vehicle-slots/${VS3}`, 'PATCH', { status: 'XYZ' })
  const [vs3db] = await restAll('TmsVehicleSlot', `select=status&id=eq.${VS3}`)
  cache = await soDem(SLOT22.id); song = await demSong(SLOT22.id)
  check('[36] Gửi trạng thái xe LẠ ("XYZ") → phải từ chối; nhận bừa thì xe biến mất khỏi phép đếm sức chứa',
    (r.s >= 400 && r.s < 500) || (vs3db.status !== 'XYZ'),
    `s=${r.s} · DB lưu trạng thái="${vs3db.status}" · sổ đếm=${cache} (trước ${truoc}) · đếm sống=${song}`)
  // Trả về trạng thái đúng + đồng bộ lại sổ đếm để các phép sau đo trên nền sạch
  if (vs3db.status === 'XYZ') {
    await restWrite('TmsVehicleSlot', 'PATCH', `id=eq.${VS3}`, { status: 'BOOKED' })
    await restRpc('recount_slot', { p_slot_id: SLOT22.id })
  }

  r = await A(`/tms/vehicle-slots/${VS2}/release`, 'PATCH')
  cache = await soDem(SLOT23.id); song = await demSong(SLOT23.id)
  check('[37] Trả lại khung giờ → xe rời khung, sổ đếm giảm đúng theo đếm sống',
    r.s === 200 && r.j?.data?.slot_id === null && r.j?.data?.status === 'PENDING' && cache === song,
    `s=${r.s} · sổ đếm=${cache} · đếm sống=${song}`)

  r = await A(`/tms/vehicle-slots/${VS3}/revoke`, 'PATCH')
  cache = await soDem(SLOT22.id); song = await demSong(SLOT22.id)
  check('[38] Thu hồi khung giờ của xe khác → nhả chỗ, sổ đếm khớp đếm sống',
    r.s === 200 && r.j?.data?.slot_id === null && cache === song && cache === 0,
    `s=${r.s} · sổ đếm=${cache} · đếm sống=${song}`)

  r = await A(`/tms/orders/${ORD1.id}/vehicle-slots`, 'POST')
  const VS1b = r.j?.data?.id
  check('[39] Thêm dòng xe thứ hai cho 1 lệnh (chia 2 chuyến) → thêm được, trạng thái chờ đặt lịch',
    (r.s === 201 || r.s === 200) && r.j?.data?.status === 'PENDING' && !r.j?.data?.slot_id, `s=${r.s}`)

  await A(`/tms/vehicle-slots/${VS1b}`, 'PATCH', { slot_id: SLOT21.id, license_plate: '29QA0007' })
  daDung.add(SLOT21.id)
  const c21 = await soDem(SLOT21.id), s21 = await demSong(SLOT21.id)
  check('[40] Đặt lịch cho xe thứ hai của cùng lệnh (biển khác) → chiếm thêm 1 chỗ, sổ đếm khớp',
    c21 === s21 && c21 === 1, `sổ đếm=${c21} · đếm sống=${s21}`)

  r = await A(`/tms/vehicle-slots/${VS2}`, 'DELETE')
  check('[41] Xoá dòng xe DUY NHẤT của một lệnh → chặn (lệnh không có xe thì không đặt lịch được nữa)',
    r.s === 400, `s=${r.s} · ${(r.j?.error?.message ?? '').slice(0, 70)}`)

  r = await A(`/tms/vehicle-slots/${VS1b}`, 'DELETE')
  const c21b = await soDem(SLOT21.id), s21b = await demSong(SLOT21.id)
  check('[42] Xoá dòng xe PHỤ đang giữ khung giờ → xoá được và trả chỗ lại cho khung',
    r.s === 200 && c21b === s21b && c21b === 0, `s=${r.s} · sổ đếm=${c21b} · đếm sống=${s21b}`)

  // Khung 21h giờ đã có lịch của ngày D (do khung 23h đang có xe) → xoá khung mẫu chỉ TẮT được
  const t21 = (await restAll('SlotTemplate',
    `select=id&warehouse_id=eq.${WH.id}&vehicle_type_id=eq.${VT1.id}&time_from=eq.21:00:00`))[0]
  r = await A(`/tms/slot-templates/${t21.id}`, 'DELETE')
  const [t21db] = await restAll('SlotTemplate', `select=id,is_active&id=eq.${t21.id}`)
  check('[43] Xoá khung giờ mẫu mà lịch đã sinh còn dùng → không được báo "Đã xóa" khi thực ra chỉ TẮT',
    r.s === 200 && (!t21db || (r.j?.data?.message ?? '') !== 'Đã xóa'),
    `s=${r.s} · thông báo="${r.j?.data?.message}" · DB còn dòng=${!!t21db} (đang bật=${t21db?.is_active})`)

  // ── HỆ QUẢ THẬT CỦA [36] — đo chứ không suy luận ──
  // Xe mang trạng thái lạ VẪN TRỎ vào khung giờ nhưng KHÔNG được tính là "đã đặt". Đến khi có người
  // khác đặt rồi trả cùng khung đó, hệ thống đếm lại và ghi sổ đếm = 0 ⇒ lượt LƯU KHUNG GIỜ MẪU kế
  // tiếp tưởng "ngày này chưa ai đặt" nên xoá sạch lịch ngày đó → vướng dòng xe còn trỏ vào → cả
  // thao tác cài khung giờ của kho gãy, không ai sửa được lịch nữa.
  await A(`/tms/vehicle-slots/${VS1}/revoke`, 'PATCH')
  const rx = await A(`/tms/orders/${ORD3.id}/vehicle-slots`, 'POST')
  const VSX = rx.j?.data?.id
  await A(`/tms/vehicle-slots/${VSX}`, 'PATCH', { slot_id: SLOT22.id, license_plate: '29QA0008' })
  await A(`/tms/vehicle-slots/${VSX}`, 'PATCH', { status: 'XYZ' })
  await A(`/tms/vehicle-slots/${VS2}`, 'PATCH', { slot_id: SLOT22.id, license_plate: '29QA0009' })
  await A(`/tms/vehicle-slots/${VS2}/revoke`, 'PATCH')
  const conTro = (await restAll('TmsVehicleSlot', `select=id&slot_id=eq.${SLOT22.id}`)).length
  const soDemX = await soDem(SLOT22.id)
  const rX = await A('/tms/slot-templates/batch', 'POST', {
    warehouse_id: WH.id, vehicle_type_id: VT1.id, cargo_type: 'ALL', days_of_week: [DOW],
    time_slots: [{ time_from: '22:00', time_to: '22:30', max_vehicles: 5 }],
  })
  check('[43b] Sau khi có 1 xe mang trạng thái lạ → LƯU LẠI khung giờ mẫu của kho vẫn phải chạy được',
    rX.s === 200, `s=${rX.s} · ${conTro} xe còn trỏ vào khung 22h nhưng sổ đếm=${soDemX} → hệ thống tưởng ngày trống`)
  await restWrite('TmsVehicleSlot', 'PATCH', `id=eq.${VSX}`, { status: 'PENDING', slot_id: null }).catch(() => {})
  await restRpc('recount_slot', { p_slot_id: SLOT22.id }).catch(() => {})
  // Lưu lại khung giờ mẫu có thể sinh lại lịch với id MỚI → lấy lại khung 22h cho phần Kế hoạch nhập
  const lai = ((await A(`/tms/slots?date=${D}&warehouse_id=${WH.id}`, 'GET')).j?.data ?? [])
    .find(s => s.vehicle_type_id === VT1.id && String(s.time_from).startsWith('22:'))
  if (lai) { SLOT22 = lai; daDung.add(lai.id) }
}

// ═══════════════════ H. KẾ HOẠCH NHẬP CHUYỂN KHO ═════════════════════════════
let INB_A = null, LINE_A = null, INB_B = null, LINE_B = null
{
  const M0 = MATS[0], M1 = MATS[1], M2 = MATS[2], M3 = MATS[3]

  let r = await A('/wms/inbound-plan', 'POST', {
    date: D, warehouse_id: WH.id, ncc_id: TC1.id, material_id: M0.id,
    planned_boxes: UPC * 2, planned_pallets: 3, po_number: `${T}PO`,
  })
  LINE_A = r.j?.data
  INB_A = LINE_A?.tms_order_id
  const dongXeA = INB_A ? (await restAll('TmsVehicleSlot', `select=id&order_id=eq.${INB_A}`)).length : 0
  check('[44] Khai 1 dòng kế hoạch nhập → tự sinh lệnh vận chuyển hướng NHẬP kèm dòng xe để đặt lịch',
    (r.s === 201 || r.s === 200) && !!INB_A && dongXeA === 1,
    `s=${r.s} · lệnh=${LINE_A?.tms_order?.order_code} · ${dongXeA} dòng xe`)

  r = await A(`/wms/inbound-plan?date_from=${D}&date_to=${D}&warehouse_id=${WH.id}`, 'GET')
  const ds = (r.j?.data ?? []).filter(x => x.po_number === `${T}PO`)
  check('[45] Mở tab Kế hoạch theo ngày + kho → thấy đúng dòng vừa khai',
    r.s === 200 && ds.length === 1 && ds[0].id === LINE_A.id, `s=${r.s} · ${ds.length} dòng`)

  r = await A('/wms/inbound-plan/bulk', 'POST', {
    lines: [{
      date: D, warehouse_id: WH.id, ncc_id: TC1.id, material_id: M2.id,
      planned_boxes: UPC, vehicle_type: `${T}BULK`, po_number: `${T}PO`,
    }],
  })
  check('[46] Nạp kế hoạch nhập hàng loạt (upload Excel) → báo đúng số dòng thêm mới',
    (r.s === 201 || r.s === 200) && num(r.j?.data?.inserted) === 1,
    `s=${r.s} · thêm=${r.j?.data?.inserted} sửa=${r.j?.data?.updated}`)

  r = await A('/wms/inbound-plan/bulk-for-order', 'POST', {
    tms_order_id: INB_A, lines: [{ material_id: M3.id, planned_boxes: UPC * 5, planned_pallets: 1 }],
  })
  check('[47] Thêm mã hàng vào đúng 1 lệnh nhập đang mở → thêm được',
    (r.s === 201 || r.s === 200) && num(r.j?.data?.inserted) === 1, `s=${r.s} · thêm=${r.j?.data?.inserted}`)

  // Tổng của LỆNH phải bằng tổng các dòng (tự cộng lại độc lập, không so hằng số)
  async function tongLenh(orderId) {
    const lines = await restAll('inbound_plan_lines', `select=planned_boxes,material_id,status&tms_order_id=eq.${orderId}`)
    let s = 0
    for (const l of lines.filter(x => x.status !== 'CANCELLED')) s += quyDoi(l.planned_boxes, MATS.find(m => m.id === l.material_id))
    return Math.round(s * 1000) / 1000
  }
  r = await A(`/wms/inbound-plan/${LINE_A.id}`, 'PATCH', { planned_boxes: UPC * 4 })
  const [ordA] = await restAll('TmsOrder', `select=planned_boxes&id=eq.${INB_A}`)
  const mongDoi = await tongLenh(INB_A)
  check('[48] Sửa số lượng 1 dòng kế hoạch → tổng của lệnh vận chuyển cộng lại đúng',
    r.s === 200 && Math.abs(num(ordA.planned_boxes) - mongDoi) < 0.01,
    `tổng lệnh=${ordA.planned_boxes} · tự cộng lại=${mongDoi}`)

  // Hai bảng của CÙNG màn nhận hàng: "hàng kế hoạch" (BASE) vs "kế hoạch/thực nhận" (thùng quy đổi)
  r = await A(`/tms/orders/${INB_A}/transfer-goods`, 'GET')
  const tg = (r.j?.data ?? []).find(x => x.material_code === M0.material_code)
  check('[49] Bảng hàng chuyển kho → số lượng kế hoạch trả theo ĐƠN VỊ GỐC (base) đúng số đã khai',
    r.s === 200 && num(tg?.planned_boxes) === UPC * 4,
    `s=${r.s} · kế hoạch=${tg?.planned_boxes} (đã khai ${UPC * 4} ${M0.base_unit ?? ''})`)

  r = await A(`/tms/orders/${INB_A}/plan-vs-actual`, 'GET')
  const pva = (r.j?.data ?? []).find(x => x.material_code === M0.material_code)
  check('[50] Bảng "kế hoạch vs thực nhận" trả theo THÙNG QUY ĐỔI — lệch đúng hệ số quy đổi của mã',
    r.s === 200 && Math.abs(num(pva?.planned_boxes) - quyDoi(num(tg?.planned_boxes), M0)) < 0.01,
    `thùng=${pva?.planned_boxes} · base=${tg?.planned_boxes} · quy cách ${UPC} ${M0.base_unit ?? ''}/thùng`)

  check('[51] Cột "thực nhận (pallet)" của bảng đối chiếu — chưa nhận gì thì phải là 0',
    num(pva?.actual_pallets) === 0 && num(pva?.planned_pallets) === 3,
    `kế hoạch pallet=${pva?.planned_pallets} · thực nhận pallet=${pva?.actual_pallets}`)

  r = await A('/tms/orders/khong-phai-uuid/plan-vs-actual', 'GET')
  check('[52] Mở bảng đối chiếu với mã lệnh rác trên đường dẫn → báo lỗi sạch, không "Lỗi hệ thống"',
    r.s === 400 && r.j?.error?.code === 'BAD_ID', `s=${r.s} ${r.j?.error?.code ?? ''}`)

  r = await A('/tms/orders/material-summary', 'POST', { order_ids: [INB_A] })
  const ms = (r.j?.data ?? []).find(x => x.material_code === M0.material_code)
  check('[53] Ô tổng hợp theo mã hàng của các lệnh đang chọn → có mã vừa khai, số khớp bảng đối chiếu',
    r.s === 200 && Math.abs(num(ms?.planned_boxes) - num(pva?.planned_boxes)) < 0.01,
    `tổng hợp=${ms?.planned_boxes} · bảng đối chiếu=${pva?.planned_boxes}`)

  // ── PHÉP KIỂM ĐẮT GIÁ 2: huỷ dòng kế hoạch cuối cùng của một lệnh ĐANG GIỮ KHUNG GIỜ ──
  // Khung giờ là tài nguyên khan hiếm giờ cao điểm: lệnh đã huỷ mà vẫn giữ chỗ = xe thật không đặt được.
  r = await A('/wms/inbound-plan', 'POST', {
    date: D, warehouse_id: WH.id, ncc_id: TC1.id, material_id: M1.id,
    planned_boxes: UPC, vehicle_type: `${T}HUY`, po_number: `${T}PO`,
  })
  LINE_B = r.j?.data
  INB_B = LINE_B?.tms_order_id
  const vsB = (await restAll('TmsVehicleSlot', `select=id&order_id=eq.${INB_B}`))[0]
  await A(`/tms/vehicle-slots/${vsB.id}`, 'PATCH', { slot_id: SLOT22.id, license_plate: '29QA0005' })
  daDung.add(SLOT22.id)
  const truocHuy = await soDem(SLOT22.id)

  r = await A(`/wms/inbound-plan/${LINE_B.id}/cancel`, 'PATCH', { cancel_reason: `${T} huỷ thử` })
  const [ordB] = await restAll('TmsOrder', `select=status&id=eq.${INB_B}`)
  const [vsBdb] = await restAll('TmsVehicleSlot', `select=slot_id,status&id=eq.${vsB.id}`)
  const sauHuy = await soDem(SLOT22.id), songHuy = await demSong(SLOT22.id)
  check('[54] Huỷ dòng kế hoạch CUỐI CÙNG (lệnh thành ĐÃ HUỶ) → phải NHẢ khung giờ cho xe khác dùng',
    r.s === 200 && ordB.status === 'CANCELLED' && !vsBdb.slot_id && sauHuy === 0,
    `lệnh=${ordB.status} · xe còn giữ khung=${!!vsBdb.slot_id} (${vsBdb.status}) · sổ đếm ${truocHuy}→${sauHuy} · đếm sống=${songHuy}`)

  check('[55] Sổ đếm khung giờ sau khi huỷ kế hoạch vẫn phải khớp đếm sống (không lệch cache)',
    sauHuy === songHuy, `sổ đếm=${sauHuy} · đếm sống=${songHuy}`)

  r = await A(`/wms/inbound-plan/${LINE_A.id}/cancel`, 'PATCH', { cancel_reason: '   ' })
  check('[56] Huỷ dòng kế hoạch mà không nêu lý do → chặn và đòi lý do',
    r.s === 400, `s=${r.s} · ${(r.j?.error?.message ?? '').slice(0, 60)}`)
}

// ═══════════════════ I. ID RÁC TRÊN ROUTE GHI ════════════════════════════════
// Nút bấm khi màn hình chưa nạp xong dữ liệu sẽ ghép "/undefined" vào đường dẫn. Người dùng phải
// nhận lời từ chối sạch, không phải "Lỗi hệ thống" (500 rác còn làm cảnh báo lỗi BE kêu oan).
{
  const cua = [
    ['Đặt khung giờ cho xe', 'PATCH', '/tms/vehicle-slots/undefined'],
    ['Trả lại khung giờ', 'PATCH', '/tms/vehicle-slots/abc/release'],
    ['Thu hồi khung giờ', 'PATCH', '/tms/vehicle-slots/abc/revoke'],
    ['Xoá dòng xe', 'DELETE', '/tms/vehicle-slots/undefined'],
    ['Sửa loại xe', 'PUT', '/tms/vehicle-types/abc'],
    ['Xoá loại xe', 'DELETE', '/tms/vehicle-types/undefined'],
    ['Sửa ĐVVT', 'PUT', '/tms/transport-companies/undefined'],
    ['Xoá ĐVVT', 'DELETE', '/tms/transport-companies/abc'],
    ['Sửa xe', 'PUT', '/tms/vehicles/undefined'],
    ['Xoá xe', 'DELETE', '/tms/vehicles/abc'],
    ['Sửa dòng kế hoạch nhập', 'PATCH', '/wms/inbound-plan/undefined'],
  ]
  let n = 57
  for (const [nhan, m, p] of cua) {
    const r = await A(p, m, m === 'DELETE' ? undefined : { name: `${T} thử` })
    check(`[${n}] ${nhan} khi màn hình chưa có mã bản ghi (id rác trên đường dẫn) → báo lỗi sạch, không "Lỗi hệ thống"`,
      r.s === 400 || r.s === 404, `s=${r.s} · ${m} ${p}`)
    n++
  }
  const r = await A('/tms/vehicle-types/reorder', 'PUT', { ids: ['abc'] })
  check(`[${n}] Kéo-thả sắp thứ tự loại xe với mã hỏng → báo lỗi sạch, không "Lỗi hệ thống"`,
    r.s === 400 || r.s === 404, `s=${r.s}`)
}

// ═══════════════════ J. DỌN ══════════════════════════════════════════════════
{
  const slotCu = [...daDung]
  await wipe()
  // Khung giờ do lượt "Sinh khung giờ" của gói này đẻ ra cho loại xe KHÁC (nếu kho có mẫu sẵn) —
  // chỉ gỡ khung chưa ai đặt, không đụng khung có người giữ chỗ.
  for (const s of await restAll('DeliverySlot', `select=id,booked_count&warehouse_id=eq.${WH.id}&date=eq.${D}`))
    if (!slotTruoc.has(s.id) && num(s.booked_count) === 0)
      await restWrite('DeliverySlot', 'DELETE', `id=eq.${s.id}`).catch(() => {})
  for (const s of slotCu) await restRpc('recount_slot', { p_slot_id: s }).catch(() => {})

  const tan = (await restAll('TransportCompany', `select=id&code=like.${T}*`)).length
    + (await restAll('VehicleType', `select=id&code=like.${T}*`)).length
    + (await restAll('TmsOrder', `select=id&order_code=like.${T}*`)).length
    + (await restAll('inbound_plan_lines', `select=id&po_number=like.${T}*`)).length
    + (await restAll('Vehicle', `select=id&license_plate=like.29QA*`)).length

  // Sổ đếm của MỌI khung đã đụng phải khớp đếm sống (khung của gói đã xoá thì bỏ qua)
  let lech = 0
  for (const s of slotCu) {
    const c = await soDem(s)
    if (c === -1) continue
    if (c !== await demSong(s)) lech++
  }
  check(`[${69}] Dọn sạch: không còn bản ghi test nào và sổ đếm mọi khung đã đụng về đúng`,
    tan === 0 && lech === 0, `${tan} bản ghi còn lại · ${lech} khung lệch sổ đếm`)
}

if (ca500.length) {
  console.log('\n⚠ CA GÂY 500 (cần dọn error_logs):')
  for (const c of ca500) console.log('   · ' + c)
}
finish('TMS-CATALOG-BOOKING')
