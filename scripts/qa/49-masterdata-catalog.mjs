// GÓI 49 — DANH MỤC & TỔ CHỨC (nhóm route CHƯA gói QA nào chạm, 07/09)
//
// VÌ SAO CÓ GÓI NÀY
// Bộ QA 00–48 phủ rất kỹ luồng NGHIỆP VỤ (nhập/xuất/tồn/quét/booking) nhưng bỏ trống toàn bộ
// phần "khai báo nền": đổi mật khẩu, nhà máy, mã hàng, ca nhập, tình trạng QA, đơn vị tính,
// danh mục chung, khu vực kho, upload vị trí, xoá kho, nhân sự, phòng ban & chức danh.
// Đây đúng là chỗ NGUY HIỂM NHẤT khi hỏng mà không ai thấy:
//   · danh mục sai thì MỌI module đọc theo đều sai (loại hàng mồ côi, ĐVT mất nhãn, sức chứa âm);
//   · các cửa này ít người bấm nên lỗi sống rất lâu — không có exception, không có dòng error_logs;
//   · một số cửa là CỬA QUYỀN (restore nhân sự, sửa danh mục qua quyền khác) — hỏng ở đây là
//     LEO THANG QUYỀN chứ không chỉ là hiển thị xấu.
//
// LUẬT VIẾT PHÉP KIỂM Ở GÓI NÀY
//   (a) Oracle TỰ TÍNH LẠI từ dữ liệu đầu vào rồi so với DB — KHÔNG so với hằng số gõ tay
//       (hằng số gõ tay khoá chính cái lỗi lại: cả app lẫn test cùng sai một kiểu thì vẫn XANH).
//   (b) Nhãn viết theo HÀNH VI NGƯỜI DÙNG THẤY, không theo tên hàm.
//   (c) Điều kiện check = HÀNH VI ĐÚNG. Đỏ = app sai, không phải "test kỳ vọng lạ".
//
// CA 500 CỐ Ý: 5 phép kiểm dưới đây cố tình đẩy app vào nhánh 500 để ĐO (đó chính là lỗi cần
// sửa). Cuối gói tự DỌN đúng những dòng `error_logs` do mình sinh ra (theo url + cửa sổ thời
// gian của lượt chạy) để digest hằng ngày không kêu oan.
//
// AN TOÀN: mọi bản ghi do gói này tạo đều mang tiền tố QA49; TUYỆT ĐỐI không đụng danh mục thật
// (không đổi tên Loại kho thật — cascade toàn DB; không sửa kho/mã hàng/ĐVT/nhân sự thật).
import { api, login, restAll, restWrite, check, finish, HAS_DB, BASE } from './lib.mjs'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
const require2 = createRequire(new URL('../../backend/package.json', import.meta.url))
const XLSX = require2('xlsx')

if (!HAS_DB) { console.error('Thiếu backend/.env — gói 49 cần soi DB'); process.exit(1) }

const P = 'QA49'
const now = () => new Date().toISOString()
const T0 = now()                       // mốc thời gian để dọn error_logs do chính gói này sinh ra
const CRED = {
  email: process.env.QA_ADMIN_EMAIL || 'admin',
  password: process.env.QA_ADMIN_PASSWORD || 'Bavi1234',
}
console.log('── GÓI 49: DANH MỤC & TỔ CHỨC ──')

// ── tiện ích ────────────────────────────────────────────────────────────────
let TOKEN = ''                                     // token thô cho multipart (api() chỉ gửi JSON)
async function grabToken(email = CRED.email, password = CRED.password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await r.json().catch(() => null)
  return { s: r.status, token: j?.data?.token ?? null }
}
// Gọi API bằng token KHÁC (đóng vai tài khoản quyền thấp)
async function apiAs(token, path, method = 'GET', body) {
  const r = await fetch(`${BASE}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  let j = null; try { j = JSON.parse(await r.text()) } catch { /* không JSON */ }
  return { s: r.status, j }
}
// Dựng file .xlsx trong bộ nhớ: hàng đầu = NHÃN cột (BE dò tiêu đề trong 8 dòng đầu)
const xbuf = (rows) => {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}
async function upload(route, rows, { preflight = false } = {}) {
  const fd = new FormData()
  fd.append('file', new Blob([xbuf(rows)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'qa49.xlsx')
  const r = await fetch(`${BASE}/api${route}${preflight ? '?preflight=1' : ''}`,
    { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd })
  let j = null; try { j = JSON.parse(await r.text()) } catch { /* không JSON */ }
  return { s: r.status, j }
}
const one = async (table, filter) => (await restAll(table, filter))[0] ?? null
const cnt = async (table, filter) => (await restAll(table, `select=id&${filter}`)).length

// Ca 500 CỐ Ý — ghi lại để dọn error_logs cuối gói + báo cáo
const FIVE_HUNDRED = []
const note500 = (url, what) => FIVE_HUNDRED.push({ url, what, at: now() })

// ── DỌN sạch tàn dư (chạy đầu + cuối) — đúng thứ tự khoá ngoại ──────────────
const EXTRA_MFR = []      // nhà máy tạo bằng mã RỖNG (không bắt được bằng like 'QA49*')
async function wipe() {
  // 1) Nhân sự: gỡ liên kết quản lý trước rồi mới xoá (Employee.manager_id là FK tự trỏ)
  const emps = await restAll('Employee', `select=id&employee_code=like.${P}*`)
  if (emps.length) {
    await restWrite('Employee', 'PATCH', `employee_code=like.${P}*`, { manager_id: null }).catch(() => {})
    for (const e of emps) {
      await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${e.id}`).catch(() => {})
      await restWrite('admin_audit_events', 'DELETE', `target_id=eq.${e.id}`).catch(() => {})
      await restWrite('auth_login_events', 'DELETE', `employee_id=eq.${e.id}`).catch(() => {})
      await restWrite('Employee', 'DELETE', `id=eq.${e.id}`).catch(() => {})
    }
  }
  await restWrite('admin_audit_events', 'DELETE', `target_id=eq.${P}-KHONG-CO-THAT`).catch(() => {})
  // 2) Phiếu nhập seed (dựng "nhân viên có lịch sử")
  await restWrite('ProductionImport', 'DELETE', `notes=like.*${P}*`).catch(() => {})
  // 3) Chức danh (parent tự trỏ) rồi phòng ban
  const jts = await restAll('JobTitle', `select=id&name=like.${P}*`)
  if (jts.length) {
    await restWrite('JobTitle', 'PATCH', `name=like.${P}*`, { parent_id: null }).catch(() => {})
    for (const j of jts) {
      await restWrite('admin_audit_events', 'DELETE', `target_id=eq.${j.id}`).catch(() => {})
      await restWrite('JobTitle', 'DELETE', `id=eq.${j.id}`).catch(() => {})
    }
  }
  for (const d of await restAll('Department', `select=id&code=like.${P}*`)) {
    await restWrite('admin_audit_events', 'DELETE', `target_id=eq.${d.id}`).catch(() => {})
    await restWrite('Department', 'DELETE', `id=eq.${d.id}`).catch(() => {})
  }
  // 4) Mã hàng + nhà máy
  await restWrite('Material', 'DELETE', `material_code=like.${P}*`).catch(() => {})
  await restWrite('Manufacturer', 'DELETE', `code=like.${P}*`).catch(() => {})
  await restWrite('Manufacturer', 'DELETE', `name=like.${P}*`).catch(() => {})
  for (const id of EXTRA_MFR) await restWrite('Manufacturer', 'DELETE', `id=eq.${id}`).catch(() => {})
  // 5) Ca nhập / trạng thái QA
  await restWrite('ImportShift', 'DELETE', `code=like.${P}*`).catch(() => {})
  await restWrite('QAStatus', 'DELETE', `code=like.${P}*`).catch(() => {})
  // 6) Danh mục: ĐVT QA49 + type thử riêng (KHÔNG đụng warehouse_type thật)
  await restWrite('LookupValue', 'DELETE', `type=eq.unit_of_measure&value=like.${P}*`).catch(() => {})
  await restWrite('LookupValue', 'DELETE', `type=eq.qa49_probe`).catch(() => {})
  // 7) Kho QA (vị trí → khu → cấu hình loại → quyền kho → kho)
  for (const w of await restAll('Warehouse', `select=id&code=like.${P}*`)) {
    await restWrite('Location', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('WarehouseZone', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('warehouse_type_configs', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('UserWarehouseAccess', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('Warehouse', 'DELETE', `id=eq.${w.id}`).catch(() => {})
  }
}

await login()
await wipe()

// Loại kho THẬT dùng làm dữ liệu nền (chỉ ĐỌC — không bao giờ sửa/xoá)
const CATS = (await restAll('LookupValue', 'select=value&type=eq.warehouse_type&order=sort_order')).map(r => r.value)
if (!CATS.length) { console.error('Staging chưa khai Loại kho nào — không dựng được fixture'); process.exit(1) }
const CAT = CATS[0]

// ════════════════════════════════════════════════════════════════════════════
// A. ĐỔI MẬT KHẨU CỦA CHÍNH MÌNH  (đổi → đăng nhập lại → ĐỔI TRẢ NGAY)
// ════════════════════════════════════════════════════════════════════════════
{
  const me = (await api('/auth/me', 'GET')).j?.data?.user ?? {}
  const HASH0 = (await one('Employee', `select=password&id=eq.${me.id}`))?.password ?? null
  const local = String(me.email ?? '').split('@')[0].toLowerCase()
  const code = String(me.employee_code ?? '').toLowerCase()
  // Mật khẩu tạm hợp lệ theo utils/passwordPolicy (≥10, chữ+số, không lặp/liên tiếp,
  // không chứa tên đăng nhập / mã NV). Sinh rồi tự kiểm 2 điều kiện "chứa" đó.
  let NEWPW = ''
  for (let i = 0; i < 20 && !NEWPW; i++) {
    const c = `Kx7mZ${Math.floor(Math.random() * 90000 + 10000)}tq`
    const l = c.toLowerCase()
    if ((local.length < 4 || !l.includes(local)) && (code.length < 4 || !l.includes(code))) NEWPW = c
  }

  let r = await api('/auth/change-password', 'POST', { old_password: CRED.password, new_password: 'abc' })
  check('[1] Đặt mật khẩu quá yếu ("abc") → bị chặn kèm LÝ DO đọc được',
    r.s === 400 && /ký tự|chữ và số|dễ đoán|phổ biến/i.test(r.j?.error?.message ?? ''),
    `s=${r.s} · "${(r.j?.error?.message ?? '').slice(0, 70)}"`)

  r = await api('/auth/change-password', 'POST', { old_password: `${P}saiMatKhau789`, new_password: NEWPW })
  check('[2] Gõ SAI mật khẩu hiện tại → từ chối, không đổi gì',
    r.s === 401, `s=${r.s} · "${(r.j?.error?.message ?? '').slice(0, 60)}"`)

  r = await api('/auth/change-password', 'POST', { old_password: CRED.password, new_password: NEWPW })
  const doiOk = r.s === 200
  check('[3] Đổi mật khẩu với mật khẩu hiện tại ĐÚNG → thành công', doiOk, `s=${r.s}`)

  if (doiOk) {
    const moi = await grabToken(CRED.email, NEWPW)
    const cu = await grabToken(CRED.email, CRED.password)
    check('[4] Sau khi đổi: đăng nhập bằng mật khẩu MỚI vào được, mật khẩu CŨ bị từ chối',
      moi.s === 200 && !!moi.token && cu.s === 401, `mới s=${moi.s} · cũ s=${cu.s}`)

    const back = await api('/auth/change-password', 'POST', { old_password: NEWPW, new_password: CRED.password })
    const lai = await grabToken(CRED.email, CRED.password)
    check('[5] Đổi TRẢ LẠI mật khẩu cũ → thành công và đăng nhập lại được ngay',
      back.s === 200 && lai.s === 200 && !!lai.token, `đổi lại s=${back.s} · đăng nhập s=${lai.s}`)
    // Lưới an toàn: dù đường API có hỏng thì tài khoản QA vẫn phải về đúng mật khẩu ban đầu
    if (lai.s !== 200 && HASH0) {
      await restWrite('Employee', 'PATCH', `id=eq.${me.id}`, { password: HASH0, updated_at: now() }).catch(() => {})
      const cuu = await grabToken(CRED.email, CRED.password)
      check('[5b] Lưới an toàn: khôi phục mật khẩu gốc thẳng từ DB', cuu.s === 200, `s=${cuu.s}`)
    }
  }
  const t = await grabToken()
  TOKEN = t.token ?? ''
  if (!TOKEN) { console.error('Không lấy được token sau mục A — dừng để không làm hỏng thêm'); process.exit(1) }
}

// ════════════════════════════════════════════════════════════════════════════
// B. NHÀ MÁY (Manufacturer)
// ════════════════════════════════════════════════════════════════════════════
let MFR = null
{
  let r = await api('/masterdata/manufacturers', 'POST', { code: `${P}NM`, name: `${P} Nhà máy` })
  MFR = r.j?.data
  const db = await one('Manufacturer', `select=id,code,name,is_active&code=eq.${P}NM`)
  check('[6] Thêm nhà máy mới → lưu đúng mã/tên và đang hoạt động',
    r.s === 200 && db?.code === `${P}NM` && db?.name === `${P} Nhà máy` && db?.is_active === true,
    `s=${r.s} · DB ${db?.code}/${db?.name}/hoạt động=${db?.is_active}`)

  r = await api('/masterdata/manufacturers', 'POST', { code: `${P}NM`, name: 'trùng mã' })
  check('[7] Thêm nhà máy TRÙNG MÃ → chặn 409 nói rõ đã tồn tại',
    r.s === 409, `s=${r.s} ${r.j?.error?.code ?? ''}`)

  r = await api(`/masterdata/manufacturers/${MFR.id}`, 'GET')
  check('[8] Mở 1 nhà máy → xem được thông tin + danh sách mã hàng của nhà máy đó',
    r.s === 200 && r.j?.data?.id === MFR.id && Array.isArray(r.j?.data?.materials),
    `s=${r.s} · ${Array.isArray(r.j?.data?.materials) ? r.j.data.materials.length : '—'} mã`)

  // Xoá trắng ô Tên trên form = FE gửi null. Tên phải thành RỖNG, không được thành chữ "null".
  r = await api(`/masterdata/manufacturers/${MFR.id}`, 'PUT', { name: null })
  const sau = await one('Manufacturer', `select=name&id=eq.${MFR.id}`)
  check('[9] Xoá trắng ô Tên nhà máy → tên trống, KHÔNG được biến thành chữ "null"',
    r.s >= 400 || sau?.name !== 'null', `s=${r.s} · DB tên = ${JSON.stringify(sau?.name)}`)
  await api(`/masterdata/manufacturers/${MFR.id}`, 'PUT', { name: `${P} Nhà máy` })

  // Mã toàn khoảng trắng: app chỉ kiểm "có nhập gì không" TRƯỚC khi cắt khoảng trắng
  r = await api('/masterdata/manufacturers', 'POST', { code: '   ', name: `${P} Mã rỗng` })
  const rong = r.j?.data
  if (rong?.id) EXTRA_MFR.push(rong.id)
  check('[10] Gõ mã nhà máy toàn KHOẢNG TRẮNG → phải báo thiếu mã, không được tạo nhà máy MÃ RỖNG',
    r.s >= 400, `s=${r.s} · mã đã lưu = ${JSON.stringify(rong?.code)}`)

  r = await api(`/masterdata/manufacturers/${MFR.id}`, 'DELETE')
  const conLai = await one('Manufacturer', `select=is_active&id=eq.${MFR.id}`)
  check('[11] Xoá nhà máy → chỉ ẩn đi (giữ lịch sử), không xoá mất bản ghi',
    r.s === 200 && conLai?.is_active === false, `s=${r.s} · còn bản ghi=${!!conLai} · hoạt động=${conLai?.is_active}`)
  await api(`/masterdata/manufacturers/${MFR.id}`, 'PUT', { is_active: true })
}

// ════════════════════════════════════════════════════════════════════════════
// C. MÃ HÀNG — tạo/sửa/ẩn + danh sách Loại hàng + UPLOAD EXCEL
// ════════════════════════════════════════════════════════════════════════════
const M1 = `${P}M1`, M2 = `${P}M2`, M3 = `${P}M3`
{
  let r = await api('/masterdata/materials/categories', 'GET')
  const dbCats = new Set((await restAll('Material', 'select=category&category=not.is.null&order=category', 20000)).map(x => x.category))
  check('[12] Ô lọc "Loại hàng" trang Mã hàng có dữ liệu và là loại CÓ THẬT trong mã hàng',
    r.s === 200 && Array.isArray(r.j?.data) && r.j.data.length > 0 && r.j.data.every(c => dbCats.has(c)),
    `s=${r.s} · app ${(r.j?.data ?? []).length} loại`)

  r = await api('/masterdata/materials', 'POST', {
    material_code: M1, material_description: `${P} Hàng A`, category: CAT,
    base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 12, cartons_per_pallet: 40,
    manufacturer_id: MFR.id, notes: `${P} ghi chú A`,
  })
  const a = await one('Material', `select=id,material_code,short_name,units_per_carton,entry_unit&material_code=eq.${M1}`)
  check('[13] Thêm mã hàng mới → lưu đủ quy cách, tên rút gọn tự sinh theo 3 ký tự cuối mã',
    r.s === 200 && a?.short_name === `${P} Hàng A [${M1.slice(-3)}]` && Number(a?.units_per_carton) === 12,
    `s=${r.s} · rút gọn="${a?.short_name}" (phải "${P} Hàng A [${M1.slice(-3)}]")`)

  r = await api('/masterdata/materials', 'POST', { material_code: M1, material_description: 'trùng' })
  check('[14] Thêm mã hàng TRÙNG MÃ → chặn 409', r.s === 409, `s=${r.s} ${r.j?.error?.code ?? ''}`)

  // Cùng ô "Thùng/Pallet", cùng giá trị -5: file tải lên coi như ô trống (xem [22]) — form phải
  // xử như nhau, chứ không được ghi thẳng số âm vào quy cách.
  r = await api('/masterdata/materials', 'POST', {
    material_code: M2, material_description: `${P} Hàng B`, category: CAT,
    base_unit: 'HOP', entry_unit: 'BT', units_per_carton: 6, cartons_per_pallet: -5,
  })
  const b = await one('Material', `select=id,cartons_per_pallet&material_code=eq.${M2}`)
  check('[15] Khai quy cách "Thùng/Pallet" là SỐ ÂM (-5) trên form → phải bị chặn, không được lưu số âm',
    r.s >= 400 || Number(b?.cartons_per_pallet ?? 0) >= 0,
    `s=${r.s} · DB Thùng/Pallet = ${b?.cartons_per_pallet}`)

  const LOAI_MA = `${P}-LOAI-MA`
  r = await api('/masterdata/materials', 'POST', {
    material_code: M3, material_description: `${P} Hàng C`, category: LOAI_MA,
  })
  const c = await one('Material', `select=id,category&material_code=eq.${M3}`)
  const catHopLe = new Set(CATS)
  check('[16] Form Mã hàng khai "Loại hàng" KHÔNG có trong danh mục Loại kho → phải chặn (nếu không sẽ đẻ loại MỒ CÔI)',
    r.s >= 400 || !c || catHopLe.has(c.category),
    `s=${r.s} · DB loại = "${c?.category}" · danh mục hợp lệ = ${CATS.join(', ')}`)

  // ── UPLOAD EXCEL ──────────────────────────────────────────────────────────
  const H = ['Mã hàng', 'Tên hàng', 'Loại hàng', 'Entry Unit', 'Base Unit', 'Đv/Thùng', 'Thùng/Pallet', 'Ghi chú']
  const MNEW = `${P}MUP`

  // [17] File sai mẫu (thiếu hẳn cột "Mã hàng") — phải nói RÕ thiếu cột nào, không nuốt im
  let u = await upload('/masterdata/materials/upload', [
    ['Tên hàng', 'Ghi chú'], [`${P} Hàng lạ`, 'x'],
  ])
  check('[17] Tải nhầm file không có cột "Mã hàng" → báo rõ thiếu cột bắt buộc, không ghi gì',
    u.s === 400 && /thiếu cột bắt buộc/i.test(u.j?.error?.message ?? ''),
    `s=${u.s} · "${(u.j?.error?.message ?? '').slice(0, 70)}"`)

  // [18] KIỂM TRƯỚC: đếm phải khớp file, và tuyệt đối KHÔNG ghi gì
  const truoc17 = await one('Material', `select=notes,material_description&material_code=eq.${M1}`)
  u = await upload('/masterdata/materials/upload', [
    H,
    [M1, '', '', '', '', '', '', `${P} ghi chú ĐÃ ĐỔI`],
    [MNEW, `${P} Hàng mới`, '', '', '', '', '', ''],
  ], { preflight: true })
  const sau17 = await one('Material', `select=notes&material_code=eq.${M1}`)
  const daTao17 = await cnt('Material', `material_code=eq.${MNEW}`)
  const pf = u.j?.data ?? {}
  check('[18] Bấm "Kiểm trước" khi tải mã hàng → báo đúng 1 mã sẽ THÊM / 1 mã sẽ SỬA và CHƯA ghi gì',
    u.s === 200 && pf.preflight === true && Number(pf.to_insert) === 1 && Number(pf.to_update) === 1
      && daTao17 === 0 && sau17?.notes === truoc17?.notes,
    `s=${u.s} · sẽ thêm=${pf.to_insert} sẽ sửa=${pf.to_update} · mã mới đã tạo=${daTao17} · ghi chú giữ nguyên=${sau17?.notes === truoc17?.notes}`)

  // [19] Mã MỚI mà bỏ trống Tên hàng
  u = await upload('/masterdata/materials/upload', [H, [MNEW, '', '', '', '', '', '', '']])
  check('[19] Tải mã hàng: mã MỚI mà bỏ trống Tên hàng → báo lỗi đúng dòng đó, không tạo mã cụt',
    u.s === 200 && (u.j?.data?.errors ?? []).some(e => e.includes(MNEW) && /Tên hàng/i.test(e))
      && Number(u.j?.data?.inserted ?? 0) === 0 && (await cnt('Material', `material_code=eq.${MNEW}`)) === 0,
    `s=${u.s} · lỗi="${(u.j?.data?.errors ?? [])[0] ?? '—'}"`)

  // [20] BẪY "upsert ghi NULL đè": cột Entry Unit chỉ điền ở DÒNG 1, dòng 2 để trống
  //      ⇒ mã ở dòng 2 PHẢI GIỮ NGUYÊN đơn vị nhập liệu cũ. Oracle = giá trị đọc trước khi tải.
  const tA = await one('Material', `select=entry_unit,units_per_carton,material_description&material_code=eq.${M1}`)
  const tB = await one('Material', `select=entry_unit,units_per_carton,material_description&material_code=eq.${M2}`)
  const tenMoiA = `${P} Hàng A đổi tên`
  u = await upload('/masterdata/materials/upload', [
    H,
    [M1, tenMoiA, '', tA.entry_unit, 'HOP', tA.units_per_carton, '', `${P} A mới`],
    [M2, '', '', '', '', '', '', `${P} B mới`],
  ])
  const sA = await one('Material', `select=entry_unit,units_per_carton,material_description,short_name,notes&material_code=eq.${M1}`)
  const sB = await one('Material', `select=entry_unit,units_per_carton,material_description,notes&material_code=eq.${M2}`)
  check('[20] Tải file chỉ điền Đơn vị nhập liệu ở MỘT dòng → dòng để TRỐNG phải GIỮ nguyên đơn vị cũ (không bị xoá trắng)',
    u.s === 200 && sB?.entry_unit === tB.entry_unit && Number(sB?.units_per_carton) === Number(tB.units_per_carton)
      && sB?.material_description === tB.material_description && sB?.notes === `${P} B mới`,
    `${M2}: đơn vị trước="${tB.entry_unit}" sau="${sB?.entry_unit}" · hệ số ${tB.units_per_carton}→${sB?.units_per_carton} · tên giữ=${sB?.material_description === tB.material_description}`)
  check('[21] Đổi Tên hàng bằng file tải lên → tên rút gọn tự sinh lại theo tên mới',
    sA?.material_description === tenMoiA && sA?.short_name === `${tenMoiA} [${M1.slice(-3)}]`,
    `tên="${sA?.material_description}" · rút gọn="${sA?.short_name}"`)

  // [22] Số âm trong file
  const cppTruoc = (await one('Material', `select=cartons_per_pallet&material_code=eq.${M1}`))?.cartons_per_pallet
  u = await upload('/masterdata/materials/upload', [H, [M1, '', '', '', '', '', -5, '']])
  const cppSau = (await one('Material', `select=cartons_per_pallet&material_code=eq.${M1}`))?.cartons_per_pallet
  check('[22] Tải file có "Thùng/Pallet" = -5 → KHÔNG ghi số âm, giữ nguyên quy cách đang có',
    Number(cppSau) === Number(cppTruoc) && Number(cppSau) > 0,
    `trước=${cppTruoc} · sau=${cppSau}`)

  // [23] Loại hàng lạ trong file — đối chứng trực tiếp với [16] (cùng dữ liệu, hai cửa vào)
  const catTruoc = (await one('Material', `select=category&material_code=eq.${M1}`))?.category
  u = await upload('/masterdata/materials/upload', [H, [M1, '', LOAI_MA, '', '', '', '', '']])
  const catSau = (await one('Material', `select=category&material_code=eq.${M1}`))?.category
  check('[23] Tải file khai "Loại hàng" ngoài danh mục → chặn CẢ FILE, không đổi loại của mã nào',
    u.s === 200 && (u.j?.data?.errors ?? []).some(e => /không có trong danh mục/i.test(e))
      && Number(u.j?.data?.updated ?? 0) === 0 && catSau === catTruoc,
    `s=${u.s} · lỗi="${((u.j?.data?.errors ?? [])[0] ?? '—').slice(0, 90)}" · loại giữ nguyên=${catSau === catTruoc}`)

  // [24] Hai cửa vào cùng dữ liệu phải cho CÙNG một kết luận
  const formNhan = catHopLe.has(c?.category ?? '') === false && !!c    // form đã ghi được loại lạ?
  const fileChan = (u.j?.data?.errors ?? []).some(e => /không có trong danh mục/i.test(e))
  check('[24] Cùng một "Loại hàng" sai: form Thêm mã hàng và file tải lên phải xử như nhau',
    !(formNhan && fileChan),
    formNhan && fileChan ? `FORM ghi thẳng "${c.category}" vào DB · FILE chặn cả file` : 'hai cửa cùng kết luận')

  // [25] sửa + ẩn mã hàng
  r = await api(`/masterdata/materials/${a.id}`, 'PUT', { notes: `${P} sửa tay`, weight_kg: 3.5 })
  const sua = await one('Material', `select=notes,weight_kg&id=eq.${a.id}`)
  check('[25] Sửa mã hàng trên form → ghi đúng ghi chú và khối lượng',
    r.s === 200 && sua?.notes === `${P} sửa tay` && Number(sua?.weight_kg) === 3.5,
    `s=${r.s} · ghi chú="${sua?.notes}" · KL=${sua?.weight_kg}`)

  r = await api(`/masterdata/materials/${b.id}`, 'DELETE')
  const an = await one('Material', `select=is_active&id=eq.${b.id}`)
  check('[26] Xoá mã hàng → chỉ ẩn khỏi danh sách (giữ lịch sử), không xoá mất',
    r.s === 200 && an?.is_active === false, `s=${r.s} · hoạt động=${an?.is_active}`)
}

// ════════════════════════════════════════════════════════════════════════════
// D. CA NHẬP + TÌNH TRẠNG QA
// ════════════════════════════════════════════════════════════════════════════
{
  let r = await api('/masterdata/import-shifts', 'POST', { code: `${P}S1`, name: `${P} Ca sáng`, display_order: 91 })
  const s1 = r.j?.data
  const dbS1 = await one('ImportShift', `select=code,name,is_active&code=eq.${P}S1`)
  check('[27] Thêm ca nhập mới → hiện trong danh sách và đang bật',
    r.s === 200 && dbS1?.name === `${P} Ca sáng` && dbS1?.is_active === true, `s=${r.s} · DB ${dbS1?.code}/${dbS1?.is_active}`)

  r = await api('/masterdata/import-shifts', 'POST', { code: `${P}S1`, name: 'trùng' })
  check('[28] Thêm ca nhập TRÙNG MÃ → chặn 409 nói rõ', r.s === 409, `s=${r.s} ${r.j?.error?.code ?? ''}`)

  const s2 = (await api('/masterdata/import-shifts', 'POST', { code: `${P}S2`, name: `${P} Ca chiều`, display_order: 92 })).j?.data
  r = await api(`/masterdata/import-shifts/${s2.id}`, 'PUT', { code: `${P}S1` })
  if (r.s >= 500) note500('PUT /api/masterdata/import-shifts/:id', 'SỬA ca nhập sang mã đã tồn tại')
  check('[29] SỬA ca nhập sang mã ĐÃ CÓ → phải báo "mã đã tồn tại" (409) như lúc thêm, không được lỗi hệ thống',
    r.s === 409, `s=${r.s} · "${(r.j?.error?.message ?? '').slice(0, 50)}"`)

  r = await api(`/masterdata/import-shifts/${s2.id}`, 'PUT', { name: '' })
  const rong = await one('ImportShift', `select=name&id=eq.${s2.id}`)
  check('[30] Sửa ca nhập thành TÊN RỖNG → phải chặn (ca không tên thì người dùng không chọn được)',
    r.s >= 400 || (rong?.name ?? '') !== '', `s=${r.s} · DB tên=${JSON.stringify(rong?.name)}`)

  r = await api('/masterdata/qa-statuses', 'POST', { code: `${P}Q1`, name: `${P} QA giữ`, display_order: 91 })
  const q1 = r.j?.data
  check('[31] Thêm tình trạng QA mới → lưu được', r.s === 200 && !!q1?.id, `s=${r.s}`)
  r = await api('/masterdata/qa-statuses', 'POST', { code: `${P}Q1`, name: 'trùng' })
  check('[32] Thêm tình trạng QA TRÙNG MÃ → chặn 409', r.s === 409, `s=${r.s} ${r.j?.error?.code ?? ''}`)

  const q2 = (await api('/masterdata/qa-statuses', 'POST', { code: `${P}Q2`, name: `${P} QA thả`, display_order: 92 })).j?.data
  r = await api(`/masterdata/qa-statuses/${q2.id}`, 'PUT', { code: `${P}Q1` })
  if (r.s >= 500) note500('PUT /api/masterdata/qa-statuses/:id', 'SỬA tình trạng QA sang mã đã tồn tại')
  check('[33] SỬA tình trạng QA sang mã ĐÃ CÓ → phải báo 409 như lúc thêm, không được lỗi hệ thống',
    r.s === 409, `s=${r.s} · "${(r.j?.error?.message ?? '').slice(0, 50)}"`)
}

// ════════════════════════════════════════════════════════════════════════════
// E. ĐƠN VỊ TÍNH  (tab riêng, quyền wms_settings.manage_unit)
// ════════════════════════════════════════════════════════════════════════════
let UNIT = null
{
  let r = await api('/wms/lookup-unit', 'POST', { value: `${P.toLowerCase()}u`, meta: { role: 'entry', label: `${P} Thùng lớn` } })
  UNIT = r.j?.data
  check('[34] Thêm đơn vị tính mới (gõ thường) → mã tự viết HOA, giữ đúng vai trò và tên tiếng Việt',
    r.s === 200 && UNIT?.value === `${P}U` && UNIT?.meta?.role === 'entry' && UNIT?.meta?.label === `${P} Thùng lớn`,
    `s=${r.s} · mã=${UNIT?.value} · vai trò=${UNIT?.meta?.role} · nhãn="${UNIT?.meta?.label}"`)

  r = await api('/wms/lookup-unit', 'POST', { value: `${P}U` })
  check('[35] Thêm đơn vị tính TRÙNG MÃ → chặn', r.s >= 400, `s=${r.s} · "${(r.j?.error?.message ?? '').slice(0, 40)}"`)

  // Form sửa chỉ đổi MÃ (không đụng vai trò/nhãn) — hai ô kia không được tự mất
  r = await api(`/wms/lookup-unit/${UNIT.id}`, 'PUT', { value: `${P}U` })
  const m = await one('LookupValue', `select=meta&id=eq.${UNIT.id}`)
  check('[36] Sửa đơn vị tính mà KHÔNG đụng ô "vai trò"/"tên tiếng Việt" → hai ô đó phải giữ nguyên',
    r.s === 200 && m?.meta?.role === 'entry' && m?.meta?.label === `${P} Thùng lớn`,
    `vai trò=${m?.meta?.role} (phải entry) · nhãn=${JSON.stringify(m?.meta?.label)} (phải "${P} Thùng lớn")`)
  await api(`/wms/lookup-unit/${UNIT.id}`, 'PUT', { value: `${P}U`, meta: { role: 'entry', label: `${P} Thùng lớn` } })

  // Gắn ĐVT vào 1 mã hàng rồi thử xoá / đổi tên
  const mid = (await one('Material', `select=id&material_code=eq.${P}M1`))?.id
  await api(`/masterdata/materials/${mid}`, 'PUT', { base_unit: `${P}U`, entry_unit: 'CAR', units_per_carton: 12 })

  r = await api(`/wms/lookup-unit/${UNIT.id}`, 'DELETE')
  const dungBoiN = await cnt('Material', `or=(base_unit.eq.${P}U,entry_unit.eq.${P}U)`)
  check('[37] Xoá đơn vị tính ĐANG ĐƯỢC MÃ HÀNG DÙNG → chặn 409 và nói rõ đang có bao nhiêu mã dùng',
    r.s === 409 && new RegExp(`${dungBoiN}\\s*mã hàng`).test(r.j?.error?.message ?? ''),
    `s=${r.s} · "${(r.j?.error?.message ?? '').slice(0, 70)}" · DB đang dùng=${dungBoiN}`)

  r = await api(`/wms/lookup-unit/${UNIT.id}`, 'PUT', { value: `${P}V`, meta: { role: 'entry', label: `${P} Thùng lớn` } })
  const matNhan = await cnt('Material', `base_unit=eq.${P}U`)
  check('[38] ĐỔI TÊN đơn vị tính đang được mã hàng dùng → mã hàng không được MẤT ĐƠN VỊ (xoá thì chặn, đổi tên cũng phải xử lý)',
    r.s >= 400 || matNhan === 0,
    `s=${r.s} · sau khi đổi ${P}U→${P}V còn ${matNhan} mã hàng trỏ vào mã ĐVT đã biến mất`)
  await api(`/wms/lookup-unit/${UNIT.id}`, 'PUT', { value: `${P}U`, meta: { role: 'entry', label: `${P} Thùng lớn` } })

  const sortTruoc = (await one('LookupValue', `select=sort_order&id=eq.${UNIT.id}`))?.sort_order
  r = await api('/wms/lookup-unit/reorder', 'PUT', { ids: [UNIT.id] })
  const sortSau = (await one('LookupValue', `select=sort_order&id=eq.${UNIT.id}`))?.sort_order
  check('[39] Kéo-thả sắp xếp đơn vị tính → thứ tự lưu đúng vị trí mới',
    r.s === 200 && Number(sortSau) === 1, `s=${r.s} · thứ tự ${sortTruoc}→${sortSau} (gửi ở vị trí 1)`)
}

// ════════════════════════════════════════════════════════════════════════════
// F. DANH MỤC CHUNG /wms/lookup — và CỬA "Loại kho" có với sang được ĐVT không
//    (KHÔNG đụng Loại kho THẬT: chỉ tạo type thử riêng `qa49_probe`)
// ════════════════════════════════════════════════════════════════════════════
{
  const v1 = (await api('/wms/lookup', 'POST', { type: 'qa49_probe', value: `${P} Giá trị 1` })).j?.data
  const v2 = (await api('/wms/lookup', 'POST', { type: 'qa49_probe', value: `${P} Giá trị 2` })).j?.data
  check('[40] Thêm giá trị vào một danh mục → lưu được và có thứ tự hiển thị',
    !!v1?.id && !!v2?.id && Number(v2?.sort_order) > Number(v1?.sort_order),
    `thứ tự ${v1?.sort_order} → ${v2?.sort_order}`)

  let r = await api(`/wms/lookup/${v1.id}`, 'PUT', { value: `${P} Giá trị 1 ĐÃ SỬA` })
  const db1 = await one('LookupValue', `select=value&id=eq.${v1.id}`)
  check('[41] Sửa tên một giá trị danh mục → tên mới hiện đúng',
    r.s === 200 && db1?.value === `${P} Giá trị 1 ĐÃ SỬA`, `s=${r.s} · "${db1?.value}"`)

  r = await api(`/wms/lookup/${v1.id}`, 'PUT', { value: '' })
  check('[42] Sửa giá trị danh mục thành RỖNG → chặn', r.s === 400, `s=${r.s}`)

  // Oracle thứ tự: gửi ĐẢO NGƯỢC thì sort_order phải bằng đúng vị trí trong mảng gửi lên
  const ids = [v2.id, v1.id]
  r = await api('/wms/lookup/reorder', 'PUT', { type: 'qa49_probe', ids })
  const sorts = await restAll('LookupValue', `select=id,sort_order&type=eq.qa49_probe`)
  const dungThuTu = ids.every((id, i) => Number(sorts.find(s => s.id === id)?.sort_order) === i + 1)
  check('[43] Kéo-thả sắp xếp danh mục → thứ tự lưu ĐÚNG vị trí đã kéo',
    r.s === 200 && dungThuTu,
    `s=${r.s} · ${ids.map((id, i) => `#${i + 1}:${sorts.find(s => s.id === id)?.sort_order}`).join(' ')}`)

  // ── CỬA QUYỀN: tài khoản CHỈ có "Quản lý Loại kho" có sửa/xoá được ĐƠN VỊ TÍNH không? ──
  const dept = (await api('/masterdata/departments', 'POST', { name: `${P} Phòng thử quyền`, code: `${P}DP` })).j?.data
  const jt = (await api('/masterdata/job-titles', 'POST', {
    name: `${P} Chức danh chỉ Loại kho`, department_id: dept.id,
    module_permissions: { wms_settings: ['view', 'manage_type'] },
  })).j?.data
  const wh0 = (await restAll('Warehouse', 'select=id&is_active=is.true&order=code&limit=1'))[0]
  const low = (await api('/masterdata/employees', 'POST', {
    name: `${P} Nhân viên loại kho`, employee_code: `${P}E9`, email: `qa49.type@qa49.local`,
    department_id: dept.id, job_title_id: jt.id, warehouse_scope: 'ASSIGNED',
    warehouse_ids: [wh0.id], allowed_categories: [CAT],
  })).j?.data
  const LOWPW = 'Kx7mBqz2947t'
  await api(`/masterdata/employees/${low.id}/set-password`, 'PATCH', { password: LOWPW })
  const lowTok = (await grabToken('qa49.type@qa49.local', LOWPW)).token

  if (!lowTok) {
    check('[44] Dựng tài khoản chỉ có quyền "Quản lý Loại kho" để đo cửa quyền', false, 'không đăng nhập được')
    check('[45] (bỏ qua vì [44] hỏng)', false, '—')
  } else {
    // (a) sửa được ĐVT? — và có tự viết HOA như tab ĐVT không?
    let rr = await apiAs(lowTok, `/wms/lookup/${UNIT.id}`, 'PUT', { value: `${P.toLowerCase()}z` })
    const sau = await one('LookupValue', `select=value&id=eq.${UNIT.id}`)
    check('[44] Người CHỈ có quyền "Quản lý Loại kho" KHÔNG được sửa Đơn vị tính (đó là quyền khác)',
      rr.s === 403, `s=${rr.s} · mã ĐVT sau khi bấm = "${sau?.value}" (tab ĐVT luôn viết HOA)`)
    if (sau?.value !== `${P}U`) await restWrite('LookupValue', 'PATCH', `id=eq.${UNIT.id}`, { value: `${P}U` })

    // (b) xoá được ĐVT ĐANG DÙNG? — tab ĐVT đã chặn 409 ở [37]
    const dungTruoc = await cnt('Material', `or=(base_unit.eq.${P}U,entry_unit.eq.${P}U)`)
    rr = await apiAs(lowTok, `/wms/lookup/${UNIT.id}`, 'DELETE')
    const conDVT = await cnt('LookupValue', `id=eq.${UNIT.id}`)
    check('[45] Đơn vị tính đang được mã hàng dùng phải được bảo vệ ở MỌI cửa — không có đường vòng nào xoá được',
      conDVT === 1, `s=${rr.s} · ${dungTruoc} mã đang dùng · ĐVT còn trong danh mục=${conDVT === 1}`)
    if (conDVT === 0) {
      await restWrite('LookupValue', 'POST', null, {
        id: UNIT.id, type: 'unit_of_measure', value: `${P}U`, sort_order: 999,
        meta: { role: 'entry', label: `${P} Thùng lớn` }, created_at: now(), updated_at: now(),
      }).catch(() => {})
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// G. KHO QA + KHU VỰC KHO
// ════════════════════════════════════════════════════════════════════════════
let WH1 = null, ZONE = null
{
  WH1 = (await api('/masterdata/warehouses', 'POST', {
    code: `${P}WH1`, name: `${P} Kho thử 1`, warehouse_type: 'CENTRAL', inventory_mode: 'QR',
  })).j?.data
  check('[46] Tạo kho mới để thử nghiệm', !!WH1?.id, `mã=${WH1?.code}`)

  let r = await api('/wms/zones', 'POST', { warehouse_id: WH1.id, name: `${P} Khu thiếu loại`, categories: [] })
  check('[47] Tạo khu vực mà chưa chọn Loại kho nào → chặn kèm hướng dẫn',
    r.s === 400 && /ít nhất 1 Loại kho/i.test(r.j?.error?.message ?? ''), `s=${r.s} · "${(r.j?.error?.message ?? '').slice(0, 50)}"`)

  r = await api('/wms/zones', 'POST', { warehouse_id: WH1.id, name: `${P} Khu loại lạ`, categories: [`${P}-LOAI-MA`] })
  check('[48] Tạo khu vực với Loại kho ngoài danh mục → chặn và liệt kê loại sai',
    r.s === 400 && /không có trong danh mục/i.test(r.j?.error?.message ?? ''), `s=${r.s}`)

  r = await api('/wms/zones', 'POST', { warehouse_id: WH1.id, code: ` qa49z `, name: `${P} Khu A`, categories: [CAT], max_pallets: 100 })
  ZONE = r.j?.data
  check('[49] Tạo khu vực → mã khu tự viết HOA, bỏ khoảng trắng, nhận đúng Loại kho',
    r.s === 200 && ZONE?.code === `${P}Z` && (ZONE?.categories ?? []).includes(CAT),
    `s=${r.s} · mã="${ZONE?.code}" · loại=${(ZONE?.categories ?? []).join(',')}`)

  r = await api('/wms/zones', 'POST', { warehouse_id: WH1.id, code: `${P}Z`, name: 'trùng', categories: [CAT] })
  check('[50] Tạo khu vực TRÙNG MÃ trong cùng kho → chặn 409', r.s === 409, `s=${r.s}`)

  // Vị trí trong khu → dùng cho cascade loại + chặn xoá khu
  const loc = (await api('/masterdata/locations', 'POST',
    { warehouse_id: WH1.id, sub_code: `${P}Z`, row: 'R9', shelf: 'T1', max_pallets: 2 })).j?.data
  const cat2 = CATS[1] ?? CAT
  r = await api(`/wms/zones/${ZONE.id}`, 'PUT', { categories: [cat2] })
  const locSau = await one('Location', `select=categories,sub_name&id=eq.${loc.id}`)
  check('[51] Đổi Loại kho của KHU → mọi VỊ TRÍ trong khu đổi theo (khu là chuẩn, không để vị trí giữ loại cũ)',
    r.s === 200 && (locSau?.categories ?? []).join(',') === cat2,
    `s=${r.s} · khu=${cat2} · vị trí=${(locSau?.categories ?? []).join(',')}`)
  await api(`/wms/zones/${ZONE.id}`, 'PUT', { categories: [CAT] })

  const soVT = await cnt('Location', `warehouse_id=eq.${WH1.id}&sub_code=eq.${P}Z`)
  r = await api(`/wms/zones/${ZONE.id}`, 'DELETE')
  check('[52] Xoá khu vực ĐANG CÒN VỊ TRÍ → chặn và nói ĐÚNG số vị trí đang có',
    r.s >= 400 && new RegExp(`có ${soVT} vị trí`).test(r.j?.error?.message ?? ''),
    `s=${r.s} · "${(r.j?.error?.message ?? '').slice(0, 60)}" · DB đếm=${soVT}`)

  r = await api(`/wms/zones/${randomUUID()}`, 'DELETE')
  check('[53] Xoá khu vực KHÔNG CÓ THẬT → phải báo "không tìm thấy", không được báo XOÁ THÀNH CÔNG',
    r.s === 404, `s=${r.s} · body=${JSON.stringify(r.j).slice(0, 60)}`)

  r = await api('/wms/zones/khong-phai-uuid', 'DELETE')
  if (r.s >= 500) note500('DELETE /api/wms/zones/:id', 'xoá khu vực bằng id rác')
  check('[54] Xoá khu vực bằng đường dẫn có id RÁC → trả lỗi sạch 4xx, không "Lỗi hệ thống"',
    r.s >= 400 && r.s < 500, `s=${r.s}`)
}

// ════════════════════════════════════════════════════════════════════════════
// H. TẢI EXCEL VỊ TRÍ KHO
// ════════════════════════════════════════════════════════════════════════════
{
  const HL = ['Kho', 'Khu', 'Dãy', 'Tầng', 'Sức chứa', 'Số mã tối đa', 'Kiểu']
  const maVT = (row, shelf) => [WH1.code, `${P}Z`, row, shelf].filter(Boolean).join('_')
  const dem = () => cnt('Location', `warehouse_id=eq.${WH1.id}`)

  const truoc = await dem()
  let u = await upload('/masterdata/locations/upload', [
    HL, [WH1.code, `${P}Z`, 'A1', 'T1', 5, '', ''], [WH1.code, `${P}Z`, 'A2', 'T1', 3, '', ''],
  ], { preflight: true })
  check('[55] Bấm "Kiểm trước" khi tải Vị trí kho → báo đúng 2 ô sẽ thêm và CHƯA ghi gì',
    u.s === 200 && u.j?.data?.preflight === true && Number(u.j?.data?.to_insert) === 2 && (await dem()) === truoc,
    `s=${u.s} · sẽ thêm=${u.j?.data?.to_insert} · số ô trong kho ${truoc}→${await dem()}`)

  u = await upload('/masterdata/locations/upload', [
    HL, [WH1.code, `${P}Z`, 'A1', 'T1', 5, '', ''], [WH1.code, `${P}Z`, 'A2', 'T1', 3, '', ''],
  ])
  const co1 = await one('Location', `select=location_code,max_pallets,categories,sub_name&location_code=eq.${maVT('A1', 'T1')}`)
  const co2 = await one('Location', `select=location_code,max_pallets&location_code=eq.${maVT('A2', 'T1')}`)
  check('[56] Tải Vị trí kho → sinh đúng MÃ Ô theo công thức kho_khu_dãy_tầng, đúng sức chứa, Loại hàng lấy từ KHU',
    u.s === 200 && Number(u.j?.data?.inserted) === 2 && !!co1 && !!co2
      && Number(co1.max_pallets) === 5 && Number(co2.max_pallets) === 3
      && (co1.categories ?? []).join(',') === CAT && co1.sub_name === `${P} Khu A`,
    `thêm=${u.j?.data?.inserted} · ${co1?.location_code}(sức chứa ${co1?.max_pallets}) · ${co2?.location_code}(${co2?.max_pallets}) · loại=${(co1?.categories ?? []).join(',')}`)

  const sau56 = await dem()
  u = await upload('/masterdata/locations/upload', [
    HL, [WH1.code, `${P}ZX`, 'B1', 'T1', 2, '', ''], [WH1.code, `${P}Z`, 'B2', 'T1', 2, '', ''],
  ])
  const errs = u.j?.data?.errors ?? []
  check('[57] Tải Vị trí kho có KHU CHƯA KHAI → chặn CẢ FILE (dòng khu đúng cũng không được ghi), hướng dẫn tạo khu trước',
    u.s === 200 && errs.some(e => /chưa có trong Khu vực/i.test(e)) && Number(u.j?.data?.inserted ?? 0) === 0
      && (await dem()) === sau56,
    `lỗi="${(errs[0] ?? '—').slice(0, 80)}" · thêm=${u.j?.data?.inserted} · số ô giữ nguyên=${(await dem()) === sau56}`)

  u = await upload('/masterdata/locations/upload', [
    HL, [WH1.code, `${P}Z`, 'C1', 'T1', 0, '', ''], [WH1.code, `${P}Z`, 'C2', 'T1', -3, '', ''],
  ])
  const e2 = u.j?.data?.errors ?? []
  check('[58] Tải Vị trí kho khai sức chứa 0 hoặc ÂM → báo lỗi ĐÚNG 2 dòng và không ghi ô nào',
    u.s === 200 && e2.filter(e => /sức chứa/i.test(e)).length === 2 && (await dem()) === sau56,
    `${e2.length} lỗi · "${(e2[0] ?? '—').slice(0, 70)}"`)

  // File bị TỪ CHỐI vẫn trả HTTP 200 (chuẩn upload 2 pha của app: lỗi nằm trong `errors[]`).
  // Màn hình đọc đúng mảng đó và in "CHƯA NHẬP GÌ, sửa rồi upload lại" nên NGƯỜI DÙNG không bị
  // hiểu nhầm — nhưng chỉ đúng KHI kết quả tự nói rõ là chưa ghi. Đó chính là thứ phải khoá lại:
  // 0 thêm · 0 sửa · có ít nhất 1 dòng lỗi. (Chương trình ngoài chỉ nhìn mã HTTP 200 thì vẫn tưởng
  // đã ghi — ghi chú kiến trúc, xem báo cáo.)
  check('[59] File tải lên bị TỪ CHỐI → kết quả phải tự nói rõ "chưa ghi gì" (0 thêm, 0 sửa, có danh sách lỗi)',
    Number(u.j?.data?.inserted ?? -1) === 0 && Number(u.j?.data?.updated ?? -1) === 0 && e2.length > 0,
    `HTTP ${u.s} · thêm=${u.j?.data?.inserted} sửa=${u.j?.data?.updated} lỗi=${e2.length}`)
}

// ════════════════════════════════════════════════════════════════════════════
// I. XOÁ KHO
// ════════════════════════════════════════════════════════════════════════════
{
  const wh2 = (await api('/masterdata/warehouses', 'POST',
    { code: `${P}WH2`, name: `${P} Kho rỗng`, warehouse_type: 'NPP', inventory_mode: 'QTY' })).j?.data
  let r = await api(`/masterdata/warehouses/${wh2.id}`, 'DELETE')
  check('[60] Xoá kho CHƯA có ô/phiếu nào → xoá hẳn khỏi danh sách',
    r.s === 200 && r.j?.data?.deleted === true && (await cnt('Warehouse', `id=eq.${wh2.id}`)) === 0,
    `s=${r.s} · deleted=${r.j?.data?.deleted}`)

  const wh3 = (await api('/masterdata/warehouses', 'POST',
    { code: `${P}WH3`, name: `${P} Kho có ô`, warehouse_type: 'NPP', inventory_mode: 'QR' })).j?.data
  await api('/wms/zones', 'POST', { warehouse_id: wh3.id, code: `${P}Z`, name: `${P} Khu B`, categories: [CAT] })
  await api('/masterdata/locations', 'POST', { warehouse_id: wh3.id, sub_code: `${P}Z`, row: 'D1', shelf: 'T1', max_pallets: 1 })
  r = await api(`/masterdata/warehouses/${wh3.id}`, 'DELETE')
  const w3 = await one('Warehouse', `select=is_active&id=eq.${wh3.id}`)
  check('[61] Xoá kho ĐANG CÓ ô chứa hàng → chỉ ngừng hoạt động, giữ lại để tra cứu',
    r.s === 200 && r.j?.data?.deleted === false && w3?.is_active === false,
    `s=${r.s} · deleted=${r.j?.data?.deleted} · còn bản ghi=${!!w3} · hoạt động=${w3?.is_active}`)

  r = await api(`/masterdata/warehouses/${P}-KHONG-CO-THAT`, 'DELETE')
  check('[62] Xoá một kho KHÔNG CÓ THẬT → phải báo "không tìm thấy", không được báo "đã xoá"',
    r.s === 404, `s=${r.s} · body=${JSON.stringify(r.j?.data ?? r.j).slice(0, 60)}`)
}

// ════════════════════════════════════════════════════════════════════════════
// J. NHÂN SỰ — cấp trên · xoá · khôi phục
// ════════════════════════════════════════════════════════════════════════════
{
  const dept = (await api('/masterdata/departments', 'POST', { name: `${P} Phòng nhân sự`, code: `${P}DN` })).j?.data
  const mkEmp = async (n) => (await api('/masterdata/employees', 'POST', {
    name: `${P} Nhân viên ${n}`, employee_code: `${P}E${n}`, email: `qa49.e${n}@qa49.local`,
    department_id: dept.id, warehouse_scope: 'ASSIGNED', warehouse_ids: [WH1.id], allowed_categories: [CAT],
  })).j?.data
  const A = await mkEmp(1), B = await mkEmp(2), C = await mkEmp(3), D = await mkEmp(4)

  let r = await api(`/masterdata/employees/${A.id}/manager`, 'PATCH', { manager_id: A.id })
  check('[63] Đặt một người làm QUẢN LÝ CỦA CHÍNH MÌNH → chặn',
    r.s === 400 && /chính mình/i.test(r.j?.error?.message ?? ''), `s=${r.s}`)

  r = await api(`/masterdata/employees/${A.id}/manager`, 'PATCH', { manager_id: B.id })
  const dbA = await one('Employee', `select=manager_id&id=eq.${A.id}`)
  check('[64] Kéo-thả đặt cấp trên trong sơ đồ tổ chức → lưu đúng người',
    r.s === 200 && dbA?.manager_id === B.id, `s=${r.s} · quản lý của A = ${dbA?.manager_id === B.id ? 'B' : dbA?.manager_id}`)

  r = await api(`/masterdata/employees/${B.id}/manager`, 'PATCH', { manager_id: A.id })
  check('[65] Tạo VÒNG LẶP quản lý (A dưới B rồi lại đặt B dưới A) → chặn',
    r.s === 400 && /vòng lặp/i.test(r.j?.error?.message ?? ''), `s=${r.s}`)

  await api(`/masterdata/employees/${A.id}/manager`, 'PATCH', { manager_id: null })
  r = await api(`/masterdata/employees/${B.id}`, 'DELETE')
  check('[66] Xoá nhân sự CHƯA có lịch sử làm việc → xoá hẳn',
    r.s === 200 && r.j?.data?.deleted === 'hard' && (await cnt('Employee', `id=eq.${B.id}`)) === 0,
    `s=${r.s} · ${r.j?.data?.deleted}`)

  // C có lịch sử: 1 phiếu nhập ghi tên người tạo
  await restWrite('ProductionImport', 'POST', null, {
    id: randomUUID(), warehouse_id: WH1.id, created_by: C.id, notes: `${P} phiếu lịch sử`,
    import_date: now(), status: 'OPEN', source_type: 'FACTORY', updated_at: now(),
  })
  r = await api(`/masterdata/employees/${C.id}`, 'DELETE')
  const cSau = await one('Employee', `select=is_active,deleted_at&id=eq.${C.id}`)
  check('[67] Xoá nhân sự ĐÃ CÓ lịch sử làm việc → chỉ ẩn khỏi danh sách, giữ lại để truy vết',
    r.s === 200 && r.j?.data?.deleted === 'soft' && cSau?.is_active === false && !!cSau?.deleted_at,
    `s=${r.s} · ${r.j?.data?.deleted} · hoạt động=${cSau?.is_active} · ngày ẩn=${cSau?.deleted_at ? 'có' : 'không'}`)

  r = await api(`/masterdata/employees/${C.id}/restore`, 'POST', {})
  const cLai = await one('Employee', `select=is_active,deleted_at&id=eq.${C.id}`)
  check('[68] Khôi phục nhân sự vừa bị ẩn nhầm → hiện lại trong danh sách và dùng được',
    r.s === 200 && cLai?.is_active === true && cLai?.deleted_at === null,
    `s=${r.s} · hoạt động=${cLai?.is_active} · ngày ẩn=${cLai?.deleted_at}`)

  // ── PHÉP KIỂM ĐẮT NHẤT: "Khôi phục" có mở lại tài khoản bị VÔ HIỆU HOÁ không? ──
  // Vô hiệu hoá (khoá tài khoản) là quyền user_admin.edit; Khôi phục là quyền user_admin.delete.
  // Hai việc KHÁC NHAU: bị xoá nhầm ≠ bị khoá vì lý do kỷ luật/nghỉ việc.
  await api(`/masterdata/employees/${D.id}`, 'PATCH', { is_active: false })
  const dTruoc = await one('Employee', `select=is_active,deleted_at&id=eq.${D.id}`)
  r = await api(`/masterdata/employees/${D.id}/restore`, 'POST', {})
  const dSau = await one('Employee', `select=is_active,deleted_at&id=eq.${D.id}`)
  check('[69] Tài khoản bị VÔ HIỆU HOÁ (chưa từng bị xoá) KHÔNG được bật lại bằng nút "Khôi phục" — đó là hai việc khác nhau',
    dSau?.is_active === false,
    `trước: hoạt động=${dTruoc?.is_active} ngày-ẩn=${dTruoc?.deleted_at} → bấm Khôi phục (s=${r.s}) → hoạt động=${dSau?.is_active}`)

  const maId = `${P}-KHONG-CO-THAT`
  r = await api(`/masterdata/employees/${maId}`, 'DELETE')
  const vetMa = await cnt('admin_audit_events', `target_id=eq.${maId}`)
  check('[70] Xoá một nhân sự KHÔNG CÓ THẬT → phải báo "không tìm thấy", không được báo "đã xoá" và ghi vào nhật ký quản trị',
    r.s === 404 && vetMa === 0,
    `s=${r.s} · app trả deleted="${r.j?.data?.deleted}" · số dòng nhật ký ghi cho id ma = ${vetMa}`)
}

// ════════════════════════════════════════════════════════════════════════════
// K. PHÒNG BAN + CHỨC DANH
// ════════════════════════════════════════════════════════════════════════════
{
  let r = await api('/masterdata/departments', 'POST', { name: `${P} Phòng K`, code: `${P}DK` })
  const dept = r.j?.data
  const dbD = await one('Department', `select=code,name,is_active&code=eq.${P}DK`)
  check('[71] Thêm phòng ban mới → mã tự viết HOA và hiện trong danh sách',
    (r.s === 200 || r.s === 201) && dbD?.code === `${P}DK` && dbD?.is_active === true,
    `s=${r.s} · DB ${dbD?.code}/${dbD?.name}`)

  r = await api('/masterdata/departments', 'POST', { name: 'trùng', code: `${P}DK` })
  if (r.s >= 500) note500('POST /api/masterdata/departments', 'thêm phòng ban trùng mã')
  check('[72] Thêm phòng ban TRÙNG MÃ → phải báo "mã đã tồn tại", không được lỗi hệ thống',
    r.s === 409 || (r.s === 400 && /tồn tại|trùng/i.test(r.j?.error?.message ?? '')),
    `s=${r.s} · "${(r.j?.error?.message ?? '').slice(0, 50)}"`)

  r = await api(`/masterdata/departments/${dept.id}`, 'PUT', { name: `${P} Phòng K đã sửa`, is_carrier: true })
  const dbD2 = await one('Department', `select=name,is_carrier&id=eq.${dept.id}`)
  check('[73] Sửa phòng ban (tên + cờ "là đơn vị vận tải") → lưu đúng',
    r.s === 200 && dbD2?.name === `${P} Phòng K đã sửa` && dbD2?.is_carrier === true,
    `s=${r.s} · "${dbD2?.name}" · vận tải=${dbD2?.is_carrier}`)

  const j1 = (await api('/masterdata/job-titles', 'POST', { name: `${P} Chức danh 1`, department_id: dept.id })).j?.data
  const j2 = (await api('/masterdata/job-titles', 'POST', { name: `${P} Chức danh 2`, department_id: dept.id })).j?.data

  r = await api(`/masterdata/job-titles/${j1.id}/parent`, 'PATCH', { parent_id: j1.id })
  check('[74] Đặt chức danh làm CẤP TRÊN CỦA CHÍNH NÓ → chặn',
    r.s === 400 && /chính nó/i.test(r.j?.error?.message ?? ''), `s=${r.s}`)

  r = await api(`/masterdata/job-titles/${j1.id}/parent`, 'PATCH', { parent_id: j2.id })
  const dbJ = await one('JobTitle', `select=parent_id&id=eq.${j1.id}`)
  check('[75] Kéo-thả đặt chức danh cấp trên → lưu đúng (ảnh hưởng trực tiếp "ai thấy được ai")',
    r.s === 200 && dbJ?.parent_id === j2.id, `s=${r.s}`)

  r = await api(`/masterdata/job-titles/${j2.id}/parent`, 'PATCH', { parent_id: j1.id })
  check('[76] Tạo VÒNG LẶP chức danh → chặn',
    r.s === 400 && /vòng lặp/i.test(r.j?.error?.message ?? ''), `s=${r.s}`)

  r = await api(`/masterdata/job-titles/${j1.id}/parent`, 'PATCH', { parent_id: `${P}-KHONG-CO-THAT` })
  if (r.s >= 500) note500('PATCH /api/masterdata/job-titles/:id/parent', 'đặt cấp trên là chức danh không tồn tại')
  check('[77] Đặt cấp trên là chức danh KHÔNG CÓ THẬT → báo lỗi sạch 4xx, không "Lỗi hệ thống"',
    r.s >= 400 && r.s < 500, `s=${r.s} · "${(r.j?.error?.message ?? '').slice(0, 50)}"`)
  await api(`/masterdata/job-titles/${j1.id}/parent`, 'PATCH', { parent_id: null })
}

// ════════════════════════════════════════════════════════════════════════════
// L. DỌN SẠCH
// ════════════════════════════════════════════════════════════════════════════
await wipe()
{
  const con =
    (await cnt('Warehouse', `code=like.${P}*`))
    + (await cnt('WarehouseZone', `code=like.${P}*`))
    + (await cnt('Location', `location_code=like.${P}*`))
    + (await cnt('Material', `material_code=like.${P}*`))
    + (await cnt('Manufacturer', `code=like.${P}*`))
    + (await cnt('Manufacturer', `name=like.${P}*`))
    + (await cnt('ImportShift', `code=like.${P}*`))
    + (await cnt('QAStatus', `code=like.${P}*`))
    + (await cnt('LookupValue', `type=eq.qa49_probe`))
    + (await cnt('LookupValue', `type=eq.unit_of_measure&value=like.${P}*`))
    + (await cnt('Employee', `employee_code=like.${P}*`))
    + (await cnt('JobTitle', `name=like.${P}*`))
    + (await cnt('Department', `code=like.${P}*`))
    + (await cnt('ProductionImport', `notes=like.*${P}*`))
    + (await cnt('admin_audit_events', `target_id=eq.${P}-KHONG-CO-THAT`))
  check('[78] Dọn 0 tàn dư — không để lại bản ghi thử nghiệm nào trong danh mục', con === 0, `${con} bản ghi còn lại`)

  // Dọn dấu vết 500 CỐ Ý khỏi error_logs để cảnh báo "lỗi BE 24h" không kêu oan
  let xoa = 0
  for (const u of [...new Set(FIVE_HUNDRED.map(x => x.url))]) {
    const rows = await restAll('error_logs', `select=id&source=eq.be&created_at=gte.${T0}&url=eq.${encodeURIComponent(u)}`)
    for (const row of rows) { await restWrite('error_logs', 'DELETE', `id=eq.${row.id}`).catch(() => {}); xoa++ }
  }
  check('[79] Dọn sạch dấu vết lỗi hệ thống do phép kiểm cố ý gây ra (để cảnh báo không kêu oan)',
    true, `${FIVE_HUNDRED.length} ca 500 cố ý · đã xoá ${xoa} dòng error_logs${FIVE_HUNDRED.length ? ' · ' + [...new Set(FIVE_HUNDRED.map(x => x.url))].join(' | ') : ''}`)
}

finish('MASTERDATA-CATALOG')
