// GÓI 51 — NHÂN SỰ (HR): Vị trí/Skill · Nghỉ phép · Layout · Phiếu phân công · Quy tắc nghỉ giữa ca · Chấm công
//
// VÌ SAO CÓ GÓI NÀY: 27 route dưới `/api/hr/*` CHƯA gói QA nào chạm tới, trong khi đây là nhóm
// đụng DỮ LIỆU NGƯỜI THẬT (công, đơn nghỉ, phân công) — sai một con số là sai lương, sai ca trực.
// Ba lớp lỗi mà nhóm này dễ mắc nhất và mắt thường KHÔNG thấy:
//   (a) side effect chéo bảng: DUYỆT 1 đơn nghỉ tự ghi N dòng chấm công, TỪ CHỐI phải gỡ đúng các
//       ngày không còn đơn nào phủ — lệch 1 ngày là lệch 1 công;
//   (b) thuật toán xếp người: kết quả "trông hợp lý" nhưng vi phạm bất biến (xếp quá số cần, xếp
//       người đang nghỉ, 1 người 2 dòng mâu thuẫn) — phải TỰ TÍNH LẠI từ dữ liệu thô mới bắt được;
//   (c) phạm vi kho: các trang nhân sự không đi qua util scope nào — kho A đọc/ghi được kho B.
//
// LUẬT VIẾT: mọi con số so sánh đều TỰ TÍNH LẠI từ bảng thô (`restAll`) hoặc từ tham số hệ thống
// (`GET /wms/settings`), KHÔNG so với hằng số gõ tay — phép kiểm gõ hằng số sẽ KHOÁ chính cái lỗi lại.
//
// AN TOÀN: chỉ thao tác trên phòng ban / chức danh / nhân viên do CHÍNH gói này tạo (tiền tố `QA51`).
// Không đụng 1 dòng nào của nhân sự thật. `ShiftRestRule` là bảng TOÀN CỤC nên chỉ tạo cặp mã giả
// `QA51A→QA51B` và xoá ngay, tuyệt đối không đụng các dòng seed CA3→…
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID, randomBytes } from 'crypto'
import { api, login, restAll, restWrite, check, finish, HAS_DB, FIX, BASE } from './lib.mjs'

if (!HAS_DB) { console.error('Thiếu backend/.env — gói 51 cần soi DB để tự tính lại số liệu'); process.exit(1) }
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const P = 'QA51'
const WH_A = FIX.WH_QR      // kho chính của fixture (layout + phiếu + nhân sự QA)
const WH_B = FIX.WH_QTY     // kho KHÁC — dùng dựng vai "người chỉ có kho B" để soi rò phạm vi
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const eachDate = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out }
const num = v => Number(v ?? 0)
const r1 = n => Math.round(n * 10) / 10
const now = () => new Date().toISOString()
// Ngày phân công/nghỉ phép đặt XA (tháng 12) để không đụng dữ liệu thật; chấm công thì BẮT BUỘC
// dùng ngày hôm nay/quá khứ vì app chặn chấm công ngày tương lai.
const D_PREV = '2026-12-18', D_MAIN = '2026-12-19', D_X = '2026-12-22'
const LV_FROM = '2026-12-10', LV_TO = '2026-12-12'
const ATT_FROM = addDays(TODAY, -2), ATT_TO = TODAY
const ATT_DAYS = eachDate(ATT_FROM, ATT_TO)

const errs500 = []            // ca gây 500 (url + giờ) để dọn error_logs
const seen500 = (url, r) => { if (r.s >= 500) errs500.push(`${url} · ${new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} · ${r.s}`); return r }
const msg = r => String(r.j?.error?.message ?? '').slice(0, 70)

console.log('── GÓI 51: NHÂN SỰ (Vị trí/Skill · Nghỉ phép · Layout · Phân công · Quy tắc ca · Chấm công) ──')
await login()

// Gọi API bằng vé của MỘT tài khoản khác (vai kho B) — lib.mjs chỉ giữ 1 token toàn cục.
async function apiAs(tok, path, method = 'GET', body) {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  let j = null; try { j = JSON.parse(await r.text()) } catch { /* không phải JSON */ }
  return { s: r.status, j }
}

// ═══ DỌN SẠCH (chạy cả đầu lẫn cuối) — đúng thứ tự khoá ngoại ═══════════════
async function wipe() {
  const dept = (await restAll('Department', `select=id&code=eq.${P}`))[0]
  const jts = [
    ...(dept ? await restAll('JobTitle', `select=id,parent_id&department_id=eq.${dept.id}`) : []),
    ...await restAll('JobTitle', `select=id,parent_id&name=like.${P}*`),
  ]
  const jtIds = [...new Set(jts.map(j => j.id))]
  const emps = [
    ...(dept ? await restAll('Employee', `select=id&department_id=eq.${dept.id}`) : []),
    ...await restAll('Employee', `select=id&employee_code=like.${P}*`),
  ]
  const empIds = [...new Set(emps.map(e => e.id))]
  const skills = [
    ...(jtIds.length ? await restAll('Skill', `select=id&job_title_id=in.(${jtIds.join(',')})`) : []),
    ...await restAll('Skill', `select=id&name=like.${P}*`),
  ]
  const skIds = [...new Set(skills.map(s => s.id))]
  const layouts = await restAll('WorkLayout', `select=id&name=like.${P}*`)
  const layoutIds = layouts.map(l => l.id)

  const del = (t, f) => restWrite(t, 'DELETE', f).catch(() => {})
  if (layoutIds.length) {
    for (const s of await restAll('WorkAssignmentSheet', `select=id&layout_id=in.(${layoutIds.join(',')})`))
      await del('WorkAssignmentSheet', `id=eq.${s.id}`)          // cascade Demand + Assignment
  }
  if (empIds.length)  await del('WorkAssignment', `employee_id=in.(${empIds.join(',')})`)
  if (skIds.length) { await del('WorkAssignment', `skill_id=in.(${skIds.join(',')})`); await del('WorkAssignmentDemand', `skill_id=in.(${skIds.join(',')})`) }
  for (const l of layoutIds) await del('WorkLayout', `id=eq.${l}`)  // cascade LayoutSkill / LayoutJobTitle
  if (empIds.length) {
    await del('LeaveRequest', `employee_id=in.(${empIds.join(',')})`)
    await del('Attendance', `employee_id=in.(${empIds.join(',')})`)
    await del('EmployeeSkill', `employee_id=in.(${empIds.join(',')})`)
  }
  if (skIds.length) await del('EmployeeSkill', `skill_id=in.(${skIds.join(',')})`)
  for (const s of skIds) await del('Skill', `id=eq.${s}`)
  await del('ShiftRestRule', `from_shift=like.${P}*`)
  if (empIds.length) { await del('UserWarehouseAccess', `employee_id=in.(${empIds.join(',')})`); await del('Employee', `id=in.(${empIds.join(',')})`) }
  for (const j of jts.filter(x => x.parent_id)) await del('JobTitle', `id=eq.${j.id}`)   // con trước
  for (const j of jts.filter(x => !x.parent_id)) await del('JobTitle', `id=eq.${j.id}`)  // rồi mới cha
  if (dept) await del('Department', `id=eq.${dept.id}`)
  await del('auth_login_events', `email=like.qa51*`)
  await del('admin_audit_events', `target_label=like.*${P}*`)
}
await wipe()

// ═══ DỰNG FIXTURE (đi đúng đường nghiệp vụ qua API) ═════════════════════════
const me = await api('/auth/me', 'GET')
const IS_SUPER = me.j?.data?.user?.is_superadmin === true || me.j?.data?.is_superadmin === true

const dep = await api('/masterdata/departments', 'POST', { name: `${P} Phòng thử`, code: P })
const DEPT_ID = dep.j?.data?.id
if (!DEPT_ID) { console.error(`Không tạo được phòng ban fixture (s=${dep.s} ${msg(dep)}) — tài khoản QA có phải superadmin không? is_superadmin=${IS_SUPER}`); process.exit(1) }

const jtP = await api('/masterdata/job-titles', 'POST', { name: `${P} Chức danh cha`, department_id: DEPT_ID })
const JT_P = jtP.j?.data?.id
const jtC = await api('/masterdata/job-titles', 'POST', { name: `${P} Chức danh con`, department_id: DEPT_ID, parent_id: JT_P })
const JT_C = jtC.j?.data?.id
// Chức danh cho VAI "chỉ có kho B": đủ quyền HR để chứng minh rò phạm vi là do THIẾU GUARD, không phải thiếu quyền
const jtS = await api('/masterdata/job-titles', 'POST', {
  name: `${P} Chức danh kho B`, department_id: DEPT_ID,
  module_permissions: {
    work_assignment: ['view', 'create', 'edit', 'publish', 'delete', 'manage_layout'],
    attendance: ['view', 'self_log', 'edit', 'report'],
    leave: ['view', 'request'], work_skill: ['view'],
  },
})
const JT_S = jtS.j?.data?.id
if (!JT_P || !JT_C || !JT_S) { console.error('Không tạo được chức danh fixture'); process.exit(1) }

async function mkEmp(codeSuffix, jobTitleId, whId) {
  const code = `${P}${codeSuffix}`
  const r = await api('/masterdata/employees', 'POST', {
    name: `${P} ${codeSuffix}`, employee_code: code, email: `qa51${codeSuffix.toLowerCase()}@qa51.local`,
    department_id: DEPT_ID, job_title_id: jobTitleId, warehouse_scope: 'ASSIGNED', warehouse_ids: [whId],
  })
  if (!r.j?.data?.id) throw new Error(`Không tạo được nhân viên ${code}: s=${r.s} ${msg(r)}`)
  return r.j.data.id
}
const E1 = await mkEmp('E1', JT_C, WH_A.id)
const E2 = await mkEmp('E2', JT_C, WH_A.id)
const E3 = await mkEmp('E3', JT_C, WH_A.id)
const E4 = await mkEmp('E4', JT_C, WH_A.id)
const E5 = await mkEmp('E5', JT_C, WH_A.id)
const U1 = await mkEmp('U1', JT_S, WH_B.id)
const QA_EMPS = [E1, E2, E3, E4, E5, U1]

// Vé của vai "chỉ có kho B" (mật khẩu ngẫu nhiên, KHÔNG in ra, KHÔNG ghi file)
let TOK_B = null
{
  const pw = `Zq${randomBytes(4).toString('hex')}Mt5`
  const sp = await api(`/masterdata/employees/${U1}/set-password`, 'PATCH', { password: pw })
  if (sp.s === 200 || sp.s === 201) {
    const lg = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `qa51u1@qa51.local`, password: pw }),
    })
    const lj = await lg.json().catch(() => null)
    TOK_B = lj?.data?.token ?? null
  }
  if (!TOK_B) console.warn(`  ⚠ Không đăng nhập được vai "chỉ có kho B" (set-password s=${sp.s}) — các phép kiểm phạm vi SỐNG sẽ bỏ qua, chỉ còn phép kiểm đọc-mã-nguồn`)
}

// Vị trí (Skill) của chức danh con
async function mkSkill(name, tag, order) {
  const r = await api('/hr/skills', 'POST', { job_title_id: JT_C, name: `${P} ${name}`, shift_tag: tag, sort_order: order })
  if (!r.j?.data?.id) throw new Error(`Không tạo được vị trí ${name}: s=${r.s} ${msg(r)}`)
  return r.j.data.id
}
const SK_CA1 = await mkSkill('CA1', 'CA1', 1)
const SK_CA2 = await mkSkill('CA2', 'CA2', 2)
const SK_CA3 = await mkSkill('CA3', 'CA3', 3)
const SK_NULL = await mkSkill('KHONGCA', null, 4)     // vị trí KHÔNG khai ca — cố ý, để soi luật xếp

const setSkills = (empId, list) => api(`/hr/employees/${empId}/skills`, 'PUT', { skills: list })
await setSkills(E1, [{ skill_id: SK_CA1, priority: 1 }, { skill_id: SK_CA2, priority: 2 }])
await setSkills(E2, [{ skill_id: SK_CA1, priority: 1 }, { skill_id: SK_CA3, priority: 1 }, { skill_id: SK_NULL, priority: 2 }])
await setSkills(E3, [{ skill_id: SK_CA2, priority: 1 }, { skill_id: SK_NULL, priority: 2 }])
await setSkills(E4, [{ skill_id: SK_CA1, priority: 1 }])

// ═══ A. VỊ TRÍ / SKILL ══════════════════════════════════════════════════════
{
  let r = await api(`/hr/skills?job_title_id=${JT_C}`, 'GET')
  const list = r.j?.data ?? []
  check('[1] Tạo vị trí mới cho chức danh → danh sách hiện đủ, đúng ca',
    r.s === 200 && list.filter(s => [SK_CA1, SK_CA2, SK_CA3, SK_NULL].includes(s.id)).length === 4
      && list.find(s => s.id === SK_CA1)?.shift_tag === 'CA1',
    `s=${r.s} · ${list.length} vị trí của chức danh`)

  r = await api(`/hr/skills/${SK_CA1}`, 'PUT', { name: `${P} CA1 đổi tên` })
  const nameDb = (await restAll('Skill', `select=name&id=eq.${SK_CA1}`))[0]?.name
  check('[2] Sửa tên vị trí → lưu đúng', r.s === 200 && nameDb === `${P} CA1 đổi tên`, `s=${r.s} · DB="${nameDb}"`)
  await api(`/hr/skills/${SK_CA1}`, 'PUT', { name: `${P} CA1` })

  // Xoá vị trí ĐANG được nhân viên chọn → phải ẩn (mềm), không được cắt mất lựa chọn của người ta
  const SK_TMP = await mkSkill('TAM', 'HC', 5)
  await setSkills(E5, [{ skill_id: SK_TMP, priority: 1 }])
  r = await api(`/hr/skills/${SK_TMP}`, 'DELETE')
  const tmpRow = (await restAll('Skill', `select=is_active&id=eq.${SK_TMP}`))[0]
  const esLeft = (await restAll('EmployeeSkill', `select=id&skill_id=eq.${SK_TMP}`)).length
  check('[3] Xoá vị trí ĐANG được nhân viên chọn → chỉ ẩn đi, không xoá mất lựa chọn đã gán',
    r.s === 200 && r.j?.data?.deleted === 'soft' && tmpRow?.is_active === false && esLeft === 1,
    `s=${r.s} · kiểu=${r.j?.data?.deleted} · còn hoạt động=${tmpRow?.is_active} · dòng đã gán còn=${esLeft}`)

  // Vị trí ĐÃ ẨN: màn hình chọn không còn hiện — thì đường ghi cũng không được nhận
  const g = await api(`/hr/employees/${E5}/skills`, 'GET')
  const hienThi = (g.j?.data?.skills ?? []).some(s => s.id === SK_TMP)
  await restWrite('EmployeeSkill', 'DELETE', `skill_id=eq.${SK_TMP}`).catch(() => {})
  r = await setSkills(E5, [{ skill_id: SK_TMP, priority: 1 }])
  const ghiLai = (await restAll('EmployeeSkill', `select=id&skill_id=eq.${SK_TMP}`)).length
  check('[4] Vị trí đã ẨN thì không gán được nữa (màn hình chọn và đường ghi cùng một luật)',
    hienThi === false && ghiLai === 0,
    `màn hình còn hiện=${hienThi} · gán lại s=${r.s} count=${r.j?.data?.count} · DB ghi được ${ghiLai} dòng`)
  await restWrite('EmployeeSkill', 'DELETE', `skill_id=eq.${SK_TMP}`).catch(() => {})
  await restWrite('Skill', 'DELETE', `id=eq.${SK_TMP}`).catch(() => {})

  // Vị trí của chức danh KHÁC (không thuộc chức danh NV và cấp dưới) → không được ghi, và số trả về phải nói thật
  const SK_OUT = (await api('/hr/skills', 'POST', { job_title_id: JT_S, name: `${P} NGOAI`, shift_tag: 'HC' })).j?.data?.id
  r = await setSkills(E5, [{ skill_id: SK_OUT, priority: 1 }])
  const outRows = (await restAll('EmployeeSkill', `select=id&skill_id=eq.${SK_OUT}`)).length
  check('[5] Gán vị trí NGOÀI phạm vi chức danh → không ghi và số trả về nói đúng sự thật (0)',
    outRows === 0 && num(r.j?.data?.count) === 0, `s=${r.s} · count=${r.j?.data?.count} · DB=${outRows} dòng`)

  r = await setSkills(E5, [{ skill_id: SK_CA1, priority: 1 }, { skill_id: SK_CA1, priority: 2 }])
  check('[6] Gửi trùng cùng một vị trí 2 lần → báo lỗi sạch, không "Lỗi hệ thống"', r.s < 500, `s=${r.s} ${msg(r)}`)
  seen500(`PUT /hr/employees/:id/skills (trùng skill_id)`, r)
  await restWrite('EmployeeSkill', 'DELETE', `employee_id=eq.${E5}`).catch(() => {})

  r = await api(`/hr/employees/${randomUUID()}/skills`, 'PUT', { skills: [] })
  check('[7] Gán vị trí cho nhân viên KHÔNG TỒN TẠI → báo "không tìm thấy nhân viên"',
    r.s === 404 || /không tìm thấy/i.test(msg(r)), `s=${r.s} · "${msg(r)}"`)
  await restWrite('Skill', 'DELETE', `id=eq.${SK_OUT}`).catch(() => {})
}

// ═══ B. NGHỈ PHÉP ═══════════════════════════════════════════════════════════
const LV_DAYS = eachDate(LV_FROM, LV_TO)
let LV1 = null
{
  let r = await api('/hr/leaves', 'POST', { employee_id: E5, warehouse_id: WH_A.id, date_from: LV_FROM, date_to: LV_TO, leave_type: 'ANNUAL', reason: `${P} thử` })
  LV1 = r.j?.data?.id
  check('[8] Tạo đơn nghỉ nhiều ngày → đơn ở trạng thái Chờ duyệt',
    (r.s === 200 || r.s === 201) && r.j?.data?.status === 'PENDING', `s=${r.s} · ${r.j?.data?.status}`)

  r = await api('/hr/leaves', 'POST', { employee_id: E5, date_from: LV_DAYS[1], date_to: addDays(LV_TO, 3) })
  check('[9] Tạo đơn nghỉ CHỒNG NGÀY với đơn đang có → chặn 409', r.s === 409, `s=${r.s} · "${msg(r)}"`)

  r = await api('/hr/leaves', 'POST', { employee_id: E5, date_from: LV_TO, date_to: LV_FROM })
  check('[10] "Đến ngày" trước "Từ ngày" → chặn 400', r.s === 400, `s=${r.s}`)

  // Người Việt gõ ngày kiểu dd-mm-yyyy: app KHÔNG kiểm định dạng, đẩy thẳng xuống DB — Postgres
  // đọc theo kiểu Mỹ (MDY) nên "10-12-2026" (10/12) thành 12/10. Sai âm thầm, không ai thấy.
  r = await api('/hr/leaves', 'POST', { employee_id: E5, date_from: '10-12-2026', date_to: '10-12-2026' })
  seen500('POST /hr/leaves (ngày sai định dạng)', r)
  const luuNgay = r.j?.data?.id ? (await restAll('LeaveRequest', `select=date_from,date_to&id=eq.${r.j.data.id}`))[0] : null
  check('[11] Ngày gõ kiểu Việt Nam "10-12-2026" → phải báo lỗi nhập liệu, KHÔNG âm thầm lưu thành ngày khác',
    r.s >= 400 && r.s < 500,
    `s=${r.s} ${msg(r)} · app đã lưu thành ${luuNgay ? `${luuNgay.date_from} → ${luuNgay.date_to}` : '(không lưu)'} trong khi người dùng gõ 10-12-2026`)
  if (r.j?.data?.id) await restWrite('LeaveRequest', 'DELETE', `id=eq.${r.j.data.id}`).catch(() => {})

  // Loại nghỉ ngoài sổ: SỬA thì app chặn 400 → TẠO cũng phải chặn, không được âm thầm đổi sang ANNUAL
  r = await api('/hr/leaves', 'POST', { employee_id: E5, date_from: D_X, date_to: D_X, leave_type: 'NGHI_BUA' })
  const loai = r.j?.data?.leave_type
  check('[12] Tạo đơn với LOẠI NGHỈ ngoài danh sách → chặn như khi sửa (không âm thầm đổi thành ANNUAL)',
    r.s >= 400, `s=${r.s} · loại đã lưu=${loai}`)
  if (r.j?.data?.id) {
    const rr = await api(`/hr/leaves/${r.j.data.id}`, 'PUT', { leave_type: 'NGHI_BUA' })
    check('[13] Sửa đơn sang loại nghỉ ngoài danh sách → chặn 400 (đường sửa gác đúng)', rr.s === 400, `s=${rr.s}`)
    await api(`/hr/leaves/${r.j.data.id}`, 'DELETE')
  } else check('[13] Sửa đơn sang loại nghỉ ngoài danh sách → chặn 400 (đường sửa gác đúng)', true, 'đường tạo đã chặn nên không dựng được ca sửa')

  // Ngày giữa đơn đã có công CA1 sẵn (mô phỏng người đã đi làm rồi mới xin nghỉ bù)
  await restWrite('Attendance', 'POST', null, {
    id: randomUUID(), employee_id: E5, warehouse_id: WH_A.id, work_date: LV_DAYS[1],
    kind: 'CA1', ot_hours: 0, early_leave_hours: 0, created_at: now(), updated_at: now(),
  })

  r = await api(`/hr/leaves/${LV1}/decide`, 'PATCH', { status: 'APPROVED' })
  const attSau = await restAll('Attendance', `select=work_date,kind&employee_id=eq.${E5}&kind=eq.LEAVE`)
  const ngaySinh = new Set(attSau.map(a => a.work_date))
  check('[14] DUYỆT đơn nghỉ N ngày → sinh ĐÚNG N ngày công loại "nghỉ phép"',
    r.s === 200 && attSau.length === LV_DAYS.length && LV_DAYS.every(d => ngaySinh.has(d)),
    `${attSau.length} dòng / cần ${LV_DAYS.length} (${LV_DAYS.join(', ')})`)

  const cf = r.j?.data?.conflicts ?? []
  check('[15] Ngày đã chấm công loại khác bị đơn nghỉ ghi đè → app nêu rõ ngày nào bị đè',
    cf.length === 1 && cf[0].work_date === LV_DAYS[1] && cf[0].prev_kind === 'CA1',
    `cảnh báo=${JSON.stringify(cf)}`)

  // Sửa NGÀY của đơn ĐÃ DUYỆT: người chỉ có quyền "xin nghỉ" tự nới ngày nghỉ của mình
  const banDau = (await restAll('LeaveRequest', `select=status&id=eq.${LV1}`))[0]?.status
  const NEW_TO = addDays(LV_TO, 2)
  r = await api(`/hr/leaves/${LV1}`, 'PUT', { date_to: NEW_TO })
  const sauSua = (await restAll('LeaveRequest', `select=status,date_to&id=eq.${LV1}`))[0]
  const attMoi = await restAll('Attendance', `select=work_date&employee_id=eq.${E5}&kind=eq.LEAVE`)
  check('[16] NỚI NGÀY một đơn ĐÃ DUYỆT → đơn phải quay về "chờ duyệt" (không tự cho thêm ngày nghỉ)',
    sauSua?.status !== 'APPROVED',
    `trước=${banDau} → sau=${sauSua?.status} · ngày đến ${LV_TO}→${sauSua?.date_to} · công nghỉ ${attSau.length}→${attMoi.length} dòng`)

  // Ai làm được việc [16]? Người CHỈ có quyền "xin nghỉ" (không có quyền duyệt) trên đơn CỦA CHÍNH MÌNH
  if (TOK_B) {
    const own = await apiAs(TOK_B, '/hr/leaves', 'POST', { employee_id: U1, warehouse_id: WH_B.id, date_from: D_X, date_to: D_X })
    const OWN = own.j?.data?.id
    await api(`/hr/leaves/${OWN}/decide`, 'PATCH', { status: 'APPROVED' })     // sếp duyệt 1 ngày
    const congTruoc = (await restAll('Attendance', `select=id&employee_id=eq.${U1}&kind=eq.LEAVE`)).length
    const noi = await apiAs(TOK_B, `/hr/leaves/${OWN}`, 'PUT', { date_to: addDays(D_X, 6) })   // tự nới thành 7 ngày
    const sau = (await restAll('LeaveRequest', `select=status,date_to&id=eq.${OWN}`))[0]
    const congSau = (await restAll('Attendance', `select=id&employee_id=eq.${U1}&kind=eq.LEAVE`)).length
    check('[16b] Nhân viên chỉ có quyền "xin nghỉ" KHÔNG tự nới được ngày trên đơn của mình đã được duyệt',
      noi.s >= 400 || sau?.status !== 'APPROVED',
      `tự sửa s=${noi.s} · đơn vẫn ${sau?.status} · nghỉ 1 ngày (${D_X}) → ${sau?.date_to} · công nghỉ ${congTruoc} → ${congSau} dòng, không ai duyệt lại`)
    await api(`/hr/leaves/${OWN}`, 'DELETE')
    await restWrite('Attendance', 'DELETE', `employee_id=eq.${U1}`).catch(() => {})
  }

  // Từ chối phải gỡ ĐÚNG các ngày không còn đơn nào phủ (dựng 1 đơn khác phủ 1 ngày ở giữa)
  const LV_KHAC = randomUUID()
  await restWrite('LeaveRequest', 'POST', null, {
    id: LV_KHAC, employee_id: E5, warehouse_id: WH_A.id, date_from: LV_DAYS[1], date_to: LV_DAYS[1],
    leave_type: 'SICK', status: 'APPROVED', created_at: now(), updated_at: now(),
  })
  await api(`/hr/leaves/${LV1}/decide`, 'PATCH', { status: 'APPROVED' })
  const phuTruoc = new Set((await restAll('Attendance', `select=work_date&employee_id=eq.${E5}&kind=eq.LEAVE`)).map(a => a.work_date))
  r = await api(`/hr/leaves/${LV1}/decide`, 'PATCH', { status: 'REJECTED' })
  const conLai = new Set((await restAll('Attendance', `select=work_date&employee_id=eq.${E5}&kind=eq.LEAVE`)).map(a => a.work_date))
  // oracle: chỉ giữ ngày vẫn còn đơn APPROVED khác phủ
  const conDon = await restAll('LeaveRequest', `select=date_from,date_to&employee_id=eq.${E5}&status=eq.APPROVED`)
  const phaiCon = new Set(conDon.flatMap(l => eachDate(l.date_from, l.date_to)))
  check('[17] TỪ CHỐI đơn đã duyệt → gỡ đúng những ngày không còn đơn nào phủ, giữ ngày đơn khác vẫn phủ',
    r.s === 200 && conLai.size === phaiCon.size && [...phaiCon].every(d => conLai.has(d)),
    `trước ${phuTruoc.size} ngày → còn ${[...conLai].join(',') || '—'} · phải còn ${[...phaiCon].join(',') || '—'}`)
  await restWrite('LeaveRequest', 'DELETE', `id=eq.${LV_KHAC}`).catch(() => {})
  await restWrite('Attendance', 'DELETE', `employee_id=eq.${E5}`).catch(() => {})

  r = await api(`/hr/leaves/${LV1}/decide`, 'PATCH', { status: 'CO_LE' })
  check('[18] Duyệt với trạng thái lạ → chặn 400', r.s === 400, `s=${r.s}`)

  r = await api(`/hr/leaves/${randomUUID()}/decide`, 'PATCH', { status: 'APPROVED' })
  seen500('PATCH /hr/leaves/:id/decide (đơn không tồn tại)', r)
  check('[19] Duyệt một đơn KHÔNG TỒN TẠI → báo 404, không "Lỗi hệ thống"', r.s === 404, `s=${r.s} ${msg(r)}`)

  // Danh sách phân trang: 4 ô đếm phải khớp bảng thô
  r = await api(`/hr/leaves?page=1&page_size=50&employee_id=${E5}`, 'GET')
  const d = r.j?.data ?? {}
  const dbLv = await restAll('LeaveRequest', `select=status&employee_id=eq.${E5}`)
  const dem = k => dbLv.filter(x => x.status === k).length
  check('[20] Danh sách nghỉ phép (phân trang): tổng + 3 ô Chờ/Duyệt/Từ chối khớp bảng thô',
    r.s === 200 && num(d.total) === dbLv.length && num(d.pending) === dem('PENDING')
      && num(d.approved) === dem('APPROVED') && num(d.rejected) === dem('REJECTED'),
    `app total/pending/approved/rejected = ${d.total}/${d.pending}/${d.approved}/${d.rejected} · DB = ${dbLv.length}/${dem('PENDING')}/${dem('APPROVED')}/${dem('REJECTED')}`)

  r = await api(`/hr/leaves?employee_id=${E5}&date_from=${LV_FROM}&date_to=${addDays(LV_TO, 5)}`, 'GET')
  check('[21] Danh sách nghỉ phép (không phân trang) trả đủ đơn trong khoảng ngày',
    r.s === 200 && Array.isArray(r.j?.data) && r.j.data.some(x => x.id === LV1), `s=${r.s} · ${(r.j?.data ?? []).length} đơn`)

  await api(`/hr/leaves/${LV1}/decide`, 'PATCH', { status: 'APPROVED' })
  r = await api(`/hr/leaves/${LV1}`, 'DELETE')
  const conDonSau = (await restAll('LeaveRequest', `select=id&id=eq.${LV1}`)).length
  const conCong = (await restAll('Attendance', `select=id&employee_id=eq.${E5}&kind=eq.LEAVE`)).length
  check('[22] Xoá đơn ĐÃ DUYỆT → gỡ luôn ngày công nghỉ đã sinh, không để công "ma"',
    r.s === 200 && conDonSau === 0 && conCong === 0, `s=${r.s} · đơn còn=${conDonSau} · công nghỉ còn=${conCong}`)
  LV1 = null
}

// ═══ C. LAYOUT (mẫu vị trí theo kho) ════════════════════════════════════════
let LAY = null
{
  let r = await api('/hr/layouts', 'POST', { warehouse_id: WH_A.id, name: `${P} Layout kho A`, note: `${P}` })
  LAY = r.j?.data?.id
  check('[23] Tạo mẫu phân công (layout) cho kho → lưu đúng kho', (r.s === 200 || r.s === 201) && r.j?.data?.warehouse_id === WH_A.id, `s=${r.s}`)

  r = await api(`/hr/layouts/${LAY}/skills`, 'PUT', {
    skills: [
      { skill_id: SK_CA1, required_count: 1, sort_order: 1 },
      { skill_id: SK_CA2, required_count: 1, sort_order: 2 },
      { skill_id: SK_NULL, required_count: 1, sort_order: 3 },
    ],
  })
  const got = await api(`/hr/layouts/${LAY}`, 'GET')
  const lskills = got.j?.data?.skills ?? []
  check('[24] Khai 3 vị trí cho mẫu → mở lại thấy đủ 3, đúng số người cần',
    r.s === 200 && num(r.j?.data?.count) === 3 && lskills.length === 3 && lskills.every(s => num(s.required_count) === 1),
    `count=${r.j?.data?.count} · mở lại ${lskills.length} vị trí`)

  r = await api(`/hr/layouts/${LAY}/job-titles`, 'PUT', { job_title_ids: [JT_C] })
  const jt2 = (await api(`/hr/layouts/${LAY}`, 'GET')).j?.data?.job_title_ids ?? []
  check('[25] Gắn chức danh cho mẫu → chỉ gọi đúng nhóm người đó', r.s === 200 && jt2.length === 1 && jt2[0] === JT_C, `s=${r.s} · ${jt2.length} chức danh`)

  r = await api('/hr/layouts', 'POST', { warehouse_id: WH_A.id, name: `${P} Layout xoá thử` })
  const LAY2 = r.j?.data?.id
  r = await api(`/hr/layouts/${LAY2}`, 'DELETE')
  check('[26] Xoá mẫu CHƯA dùng ở phiếu nào → xoá hẳn', r.s === 200 && r.j?.data?.deleted === 'hard'
    && (await restAll('WorkLayout', `select=id&id=eq.${LAY2}`)).length === 0, `s=${r.s} · ${r.j?.data?.deleted}`)

  r = await api(`/hr/layouts/${randomUUID()}/skills`, 'PUT', { skills: [{ skill_id: SK_CA1, required_count: 1 }] })
  seen500('PUT /hr/layouts/:id/skills (mẫu không tồn tại)', r)
  check('[27] Sửa vị trí của một mẫu KHÔNG TỒN TẠI → báo 404, không "Lỗi hệ thống"', r.s === 404, `s=${r.s} ${msg(r)}`)
}

// ═══ D. PHIẾU PHÂN CÔNG ═════════════════════════════════════════════════════
const sheetOf = async id => (await api(`/hr/sheets/${id}`, 'GET')).j?.data ?? {}
let SH_MAIN = null
{
  // Phiếu ngày HÔM TRƯỚC: xếp tay E2 vào CA3 để thử luật nghỉ giữa ca
  const p0 = await api('/hr/sheets', 'POST', { layout_id: LAY, work_date: D_PREV })
  const SH_PREV = p0.j?.data?.id
  await api(`/hr/sheets/${SH_PREV}/assign-one`, 'POST', { employee_id: E2, skill_id: SK_CA3 })

  // Người nghỉ phép đã duyệt đúng ngày phiếu chính
  const lvE4 = await api('/hr/leaves', 'POST', { employee_id: E4, warehouse_id: WH_A.id, date_from: D_MAIN, date_to: D_MAIN })
  await api(`/hr/leaves/${lvE4.j?.data?.id}/decide`, 'PATCH', { status: 'APPROVED' })

  let r = await api('/hr/sheets', 'POST', { layout_id: LAY, work_date: D_MAIN, create_only: true })
  SH_MAIN = r.j?.data?.id
  check('[28] Tạo phiếu phân công cho một ngày → tự đổ sẵn yêu cầu vị trí từ mẫu',
    r.s === 201 && !!SH_MAIN && (await sheetOf(SH_MAIN)).demands?.length === 3,
    `s=${r.s} · ${(await sheetOf(SH_MAIN)).demands?.length} yêu cầu`)

  r = await api('/hr/sheets', 'POST', { layout_id: LAY, work_date: D_MAIN, create_only: true })
  check('[29] Tạo lại phiếu TRÙNG (cùng ngày + cùng mẫu) → chặn 409', r.s === 409, `s=${r.s}`)

  // ── XẾP TỰ ĐỘNG: oracle tự tính lại từ bảng thô ──
  const auto = await api(`/hr/sheets/${SH_MAIN}/auto-assign`, 'POST', {})
  const sh = await sheetOf(SH_MAIN)
  const asg = sh.assignments ?? []
  const demands = sh.demands ?? []
  const tagOf = new Map((sh.skills ?? []).map(s => [s.id, s.shift_tag]))
  const canFor = sid => num(demands.find(d => d.skill_id === sid)?.required_count)
  const assigned = asg.filter(a => a.status === 'ASSIGNED')
  const leaveRows = asg.filter(a => a.status === 'LEAVE')

  const viPham1 = demands.filter(d => assigned.filter(a => a.skill_id === d.skill_id).length > num(d.required_count))
  check('[30] Xếp tự động: mỗi vị trí không xếp quá số người cần (I1)',
    auto.s === 200 && viPham1.length === 0,
    demands.map(d => `${tagOf.get(d.skill_id) ?? 'không-ca'}:${assigned.filter(a => a.skill_id === d.skill_id).length}/${d.required_count}`).join(' · '))

  const dbNghi = await restAll('LeaveRequest',
    `select=employee_id&status=eq.APPROVED&date_from=lte.${D_MAIN}&date_to=gte.${D_MAIN}&employee_id=in.(${QA_EMPS.join(',')})`)
  const nghiSet = new Set(dbNghi.map(l => l.employee_id))
  const nghiBiXep = assigned.filter(a => nghiSet.has(a.employee_id))
  check('[31] Xếp tự động: người đang NGHỈ PHÉP đã duyệt không bị xếp việc, và có đúng 1 dòng "nghỉ" (I2)',
    nghiBiXep.length === 0 && leaveRows.length === nghiSet.size && leaveRows.filter(a => a.employee_id === E4).length === 1,
    `nghỉ theo DB=${nghiSet.size} người · dòng nghỉ trên phiếu=${leaveRows.length} · bị xếp nhầm=${nghiBiXep.length}`)

  const trungCa = []
  for (const eid of new Set(assigned.map(a => a.employee_id))) {
    const tags = assigned.filter(a => a.employee_id === eid).map(a => tagOf.get(a.skill_id) ?? null)
    for (const t of new Set(tags)) if (tags.filter(x => x === t).length > 1) trungCa.push(`${eid.slice(0, 8)}:${t}`)
  }
  check('[32] Xếp tự động: mỗi người tối đa 1 dòng cho mỗi ca (I3)', trungCa.length === 0, trungCa.join(',') || 'không ai bị xếp 2 lần cùng ca')

  const demandIds = new Set(demands.map(d => d.skill_id))
  const laVi = assigned.filter(a => !demandIds.has(a.skill_id))
  check('[33] Xếp tự động: mọi dòng đã xếp đều thuộc danh sách vị trí phiếu yêu cầu (I6)',
    laVi.length === 0, `${laVi.length} dòng nằm ngoài yêu cầu / ${assigned.length} dòng`)

  const nguoiDaXep = new Set(assigned.map(a => a.employee_id)).size
  check('[34] Xếp tự động: số báo cáo trên màn hình khớp số dòng thật trong phiếu (I7)',
    num(auto.j?.data?.assigned) === nguoiDaXep && num(auto.j?.data?.on_leave) === leaveRows.length,
    `app báo xếp ${auto.j?.data?.assigned} / nghỉ ${auto.j?.data?.on_leave} · thật ${nguoiDaXep} / ${leaveRows.length}`)

  // Nghỉ giữa ca — lấy luật SỐNG từ API, không gõ cứng
  const rules = (await api('/hr/shift-rules', 'GET')).j?.data ?? []
  const camSauCA3 = new Set(rules.filter(x => x.from_shift === 'CA3').map(x => x.to_shift))
  const e2Tags = assigned.filter(a => a.employee_id === E2).map(a => tagOf.get(a.skill_id))
  check('[35] Người trực CA3 hôm trước không bị xếp vào ca bị cấm hôm sau (I5)',
    camSauCA3.size === 0 || e2Tags.every(t => !camSauCA3.has(t)),
    `luật cấm sau CA3: ${[...camSauCA3].join(',') || '(chưa khai)'} · E2 hôm nay: ${e2Tags.join(',') || 'không xếp'}`)

  // Vị trí KHÔNG khai ca: có người rảnh đủ kỹ năng mà vẫn báo thiếu vĩnh viễn
  const rTrong = assigned.filter(a => a.skill_id === SK_NULL).length
  const raNhoi = (await restAll('EmployeeSkill', `select=employee_id&skill_id=eq.${SK_NULL}`)).map(x => x.employee_id)
  const raNhoiRanh = raNhoi.filter(e => !nghiSet.has(e) && !assigned.some(a => a.employee_id === e))
  check('[36] Vị trí không khai CA vẫn được xếp khi còn người rảnh đủ kỹ năng (không báo thiếu oan)',
    canFor(SK_NULL) === 0 || raNhoiRanh.length === 0 || rTrong > 0,
    `cần ${canFor(SK_NULL)} · xếp được ${rTrong} · người rảnh có kỹ năng này: ${raNhoiRanh.length}`)

  // Ô tổng trang danh sách phiếu
  const ls = await api(`/hr/sheets?warehouse_id=${WH_A.id}&date_from=${D_MAIN}&date_to=${D_MAIN}`, 'GET')
  const row = (ls.j?.data ?? []).find(x => x.id === SH_MAIN) ?? {}
  const tongCan = demands.reduce((s, d) => s + num(d.required_count), 0)
  check('[37] Ô tổng ở danh sách phiếu (cần / đã xếp / nghỉ) khớp chi tiết phiếu',
    num(row.total_required) === tongCan && num(row.total_assigned) === assigned.length && num(row.total_on_leave) === leaveRows.length,
    `list ${row.total_required}/${row.total_assigned}/${row.total_on_leave} · chi tiết ${tongCan}/${assigned.length}/${leaveRows.length}`)

  // Xếp tay phải được GIỮ NGUYÊN khi xếp lại tự động (I8)
  await api(`/hr/sheets/${SH_MAIN}/assign-one`, 'POST', { employee_id: E2, skill_id: SK_CA2 })
  const idTay = (await restAll('WorkAssignment', `select=id&sheet_id=eq.${SH_MAIN}&employee_id=eq.${E2}&is_manual=is.true`))[0]?.id
  await api(`/hr/sheets/${SH_MAIN}/auto-assign`, 'POST', {})
  const tayCon = (await restAll('WorkAssignment', `select=id,status,skill_id&sheet_id=eq.${SH_MAIN}&employee_id=eq.${E2}`))
  check('[38] Dòng xếp TAY được giữ nguyên qua lần xếp tự động sau (I8)',
    tayCon.length === 1 && tayCon[0].id === idTay && tayCon[0].status === 'ASSIGNED' && tayCon[0].skill_id === SK_CA2,
    `${tayCon.length} dòng · trạng thái=${tayCon[0]?.status} · giữ id=${tayCon[0]?.id === idTay}`)

  // "Bỏ người này" rồi xếp tự động → không được đẻ ra 2 dòng mâu thuẫn cho cùng 1 người
  await api(`/hr/sheets/${SH_MAIN}/assign-one`, 'POST', { employee_id: E1, skill_id: null })
  await api(`/hr/sheets/${SH_MAIN}/auto-assign`, 'POST', {})
  const eE1 = await restAll('WorkAssignment', `select=status,is_manual&sheet_id=eq.${SH_MAIN}&employee_id=eq.${E1}`)
  const coCa2 = eE1.some(a => a.status === 'ASSIGNED') && eE1.some(a => a.status === 'UNASSIGNED')
  check('[39] Đánh dấu "bỏ người này" rồi xếp tự động → người đó KHÔNG bị xếp lại thành 2 dòng mâu thuẫn',
    !coCa2, `E1 có ${eE1.length} dòng: ${eE1.map(a => `${a.status}${a.is_manual ? '(tay)' : ''}`).join(' + ')}`)

  // Đặt nhiều vị trí cho 1 người rồi bấm gán 1 vị trí → không được đẻ thêm dòng
  await api(`/hr/sheets/${SH_MAIN}/assign-positions`, 'POST', { employee_id: E3, skill_ids: [SK_CA2, SK_NULL] })
  const truoc = (await restAll('WorkAssignment', `select=id&sheet_id=eq.${SH_MAIN}&employee_id=eq.${E3}`)).length
  await api(`/hr/sheets/${SH_MAIN}/assign-one`, 'POST', { employee_id: E3, skill_id: SK_CA1 })
  const sau = await restAll('WorkAssignment', `select=id,skill_id&sheet_id=eq.${SH_MAIN}&employee_id=eq.${E3}`)
  check('[40] Người đang giữ NHIỀU vị trí, bấm gán 1 vị trí → sửa dòng đang có, không đẻ thêm dòng',
    sau.length <= truoc, `trước ${truoc} dòng → sau ${sau.length} dòng`)

  const shMa = randomUUID()
  r = await api(`/hr/sheets/${shMa}/assign-one`, 'POST', { employee_id: E1, skill_id: SK_CA1 })
  seen500('POST /hr/sheets/:id/assign-one (phiếu không tồn tại)', r)
  const ghiMa = (await restAll('WorkAssignment', `select=id&sheet_id=eq.${shMa}`)).length
  check('[41] Xếp người vào phiếu KHÔNG TỒN TẠI → báo 404, KHÔNG được báo thành công rồi chẳng ghi gì',
    r.s === 404, `s=${r.s} ${msg(r)} · app trả ${JSON.stringify(r.j?.data ?? {}).slice(0, 40)} nhưng DB ghi được ${ghiMa} dòng`)

  r = await api(`/hr/sheets/${randomUUID()}/publish`, 'POST', { publish: true })
  check('[42] Phát hành một phiếu KHÔNG TỒN TẠI → báo 404, không báo thành công', r.s === 404, `s=${r.s} · app trả ${JSON.stringify(r.j?.data ?? {}).slice(0, 40)}`)

  // ── PHÁT HÀNH rồi thì mọi đường sửa phải khoá như nhau ──
  await api(`/hr/sheets/${SH_MAIN}/publish`, 'POST', { publish: true })
  const a1 = await api(`/hr/sheets/${SH_MAIN}/auto-assign`, 'POST', {})
  const a2 = await api(`/hr/sheets/${SH_MAIN}/assign-one`, 'POST', { employee_id: E1, skill_id: SK_CA1 })
  const a3 = await api(`/hr/sheets/${SH_MAIN}/assign-positions`, 'POST', { employee_id: E1, skill_ids: [SK_CA1] })
  check('[43] Phiếu ĐÃ PHÁT HÀNH → xếp tự động / xếp tay / đặt vị trí đều bị khoá 409',
    a1.s === 409 && a2.s === 409 && a3.s === 409, `auto=${a1.s} · gán 1=${a2.s} · đặt vị trí=${a3.s}`)

  const dmTruoc = (await sheetOf(SH_MAIN)).demands?.length ?? 0
  const up = await api('/hr/sheets', 'POST', { layout_id: LAY, work_date: D_MAIN, note: `${P} sửa sau phát hành`, demands: [] })
  const shSau = await sheetOf(SH_MAIN)
  check('[44] Phiếu ĐÃ PHÁT HÀNH → sửa ghi chú/yêu cầu vị trí cũng phải bị khoá (khoá đồng nhất mọi đường)',
    up.s === 409, `s=${up.s} · yêu cầu vị trí ${dmTruoc} → ${shSau.demands?.length} · ghi chú="${String(shSau.note ?? '').slice(0, 30)}"`)

  await api(`/hr/sheets/${SH_MAIN}/publish`, 'POST', { publish: false })
  await api(`/hr/sheets/${SH_PREV}`, 'DELETE')
  await api(`/hr/leaves/${lvE4.j?.data?.id}`, 'DELETE')
  await restWrite('Attendance', 'DELETE', `employee_id=eq.${E4}`).catch(() => {})
}

// Xoá VỊ TRÍ còn được dòng phân công tham chiếu (yêu cầu vị trí đã bị thay) — không được vỡ khoá ngoại
{
  const SK_DEL = await mkSkill('XOA', 'HC', 9)
  const s2 = await api('/hr/sheets', 'POST', { layout_id: LAY, work_date: D_X, demands: [{ skill_id: SK_DEL, required_count: 1 }] })
  const SH2 = s2.j?.data?.id
  await api(`/hr/sheets/${SH2}/assign-one`, 'POST', { employee_id: E1, skill_id: SK_DEL })
  await api('/hr/sheets', 'POST', { layout_id: LAY, work_date: D_X, demands: [{ skill_id: SK_CA1, required_count: 1 }] })
  const conAsg = (await restAll('WorkAssignment', `select=id&skill_id=eq.${SK_DEL}`)).length
  const r = await api(`/hr/skills/${SK_DEL}`, 'DELETE')
  seen500('DELETE /hr/skills/:id (còn dòng phân công tham chiếu)', r)
  check('[45] Xoá vị trí vẫn còn người được xếp vào đó → không "Lỗi hệ thống" (ẩn đi hoặc chặn có lý do)',
    r.s < 500, `s=${r.s} ${msg(r)} · còn ${conAsg} dòng phân công dùng vị trí này`)
  await api(`/hr/sheets/${SH2}`, 'DELETE')
  await restWrite('WorkAssignment', 'DELETE', `skill_id=eq.${SK_DEL}`).catch(() => {})
  await restWrite('Skill', 'DELETE', `id=eq.${SK_DEL}`).catch(() => {})
}

// ═══ E. QUY TẮC NGHỈ GIỮA CA (bảng TOÀN CỤC — chỉ đụng cặp mã giả) ══════════
{
  const seedTruoc = (await restAll('ShiftRestRule', 'select=id')).length
  let r = await api('/hr/shift-rules', 'POST', { from_shift: `${P}A`, to_shift: `${P}B` })
  const RULE = r.j?.data?.id
  check('[46] Thêm quy tắc nghỉ giữa ca → lưu và hiện ở danh sách',
    (r.s === 200 || r.s === 201) && (await api('/hr/shift-rules', 'GET')).j?.data?.some(x => x.id === RULE), `s=${r.s}`)

  r = await api('/hr/shift-rules', 'POST', { from_shift: `${P}A`, to_shift: `${P}B` })
  seen500('POST /hr/shift-rules (trùng cặp ca)', r)
  check('[47] Thêm TRÙNG cặp ca đã có → báo "đã có rồi", không "Lỗi hệ thống"', r.s >= 400 && r.s < 500, `s=${r.s} ${msg(r)}`)
  if (r.j?.data?.id) await restWrite('ShiftRestRule', 'DELETE', `id=eq.${r.j.data.id}`).catch(() => {})

  r = await api('/hr/shift-rules', 'POST', { from_shift: `${P}A`, to_shift: `${P}A` })
  check('[48] Ca trước và ca sau trùng nhau → chặn 400', r.s === 400, `s=${r.s}`)

  r = await api(`/hr/shift-rules/${RULE}`, 'DELETE')
  const seedSau = (await restAll('ShiftRestRule', 'select=id')).length
  check('[49] Xoá quy tắc vừa thêm → biến mất, các quy tắc có sẵn KHÔNG bị đụng',
    r.s === 200 && (await restAll('ShiftRestRule', `select=id&id=eq.${RULE}`)).length === 0 && seedSau === seedTruoc,
    `trước khi thêm ${seedTruoc} quy tắc → sau khi xoá còn ${seedSau} (phải bằng nhau)`)
}

// ═══ F. CHẤM CÔNG ═══════════════════════════════════════════════════════════
const setRes = await api('/wms/settings', 'GET')
const STD_HOURS = num((setRes.j?.data ?? []).find(x => x.key === 'standard_work_hours')?.value) || 8
{
  const post = (emp, date, kind, extra = {}) => api('/hr/attendance', 'POST', { employee_id: emp, warehouse_id: WH_A.id, work_date: date, kind, ...extra })
  let r = await post(E1, ATT_DAYS[0], 'CA1', { ot_hours: 2 })
  const ok1 = r.s === 200 || r.s === 201
  await post(E1, ATT_DAYS[1], 'CA2', { early_leave_hours: 1 })
  await post(E1, ATT_DAYS[2], 'HC')
  await post(E2, ATT_DAYS[1], 'CA3', { ot_hours: 1.5 })
  await post(E3, ATT_DAYS[1], 'LEAVE')
  const dbAtt = await restAll('Attendance', `select=id,employee_id,work_date,kind,ot_hours,early_leave_hours&employee_id=in.(${QA_EMPS.join(',')})&work_date=gte.${ATT_FROM}&work_date=lte.${ATT_TO}`)
  check('[50] Chấm công cho nhiều người/nhiều ngày → ghi đủ dòng vào bảng công',
    ok1 && dbAtt.length === 5, `s=${r.s} · DB có ${dbAtt.length}/5 dòng`)

  // ── Oracle BÁO CÁO CÔNG: tự tính lại từ bảng thô + giờ chuẩn đọc từ cấu hình hệ thống ──
  r = await api(`/hr/attendance/report?date_from=${ATT_FROM}&date_to=${ATT_TO}&department_id=${DEPT_ID}`, 'GET')
  const rep = (r.j?.data ?? []).filter(x => QA_EMPS.includes(x.employee_id))
  const lech = []
  for (const row of rep) {
    const mine = dbAtt.filter(a => a.employee_id === row.employee_id)
    const c = k => mine.filter(a => a.kind === k).length
    const ot = r1(mine.reduce((s, a) => s + num(a.ot_hours), 0))
    const er = r1(mine.reduce((s, a) => s + num(a.early_leave_hours), 0))
    const wd = c('CA1') + c('CA2') + c('CA3') + c('HC')
    const th = r1(wd * STD_HOURS + ot - er)
    if (num(row.ca1) !== c('CA1') || num(row.ca2) !== c('CA2') || num(row.ca3) !== c('CA3') || num(row.hc) !== c('HC')
      || num(row.leave) !== c('LEAVE') || r1(num(row.ot_hours)) !== ot || r1(num(row.early_hours)) !== er
      || num(row.work_days) !== wd || r1(num(row.total_hours)) !== th)
      lech.push(`${row.employee_id.slice(0, 8)} app ngày=${row.work_days} giờ=${row.total_hours} ≠ tính lại ngày=${wd} giờ=${th}`)
  }
  const nvCoCong = new Set(dbAtt.map(a => a.employee_id))
  check('[51] Báo cáo công: số ngày công + tổng giờ tự tính lại (ngày×giờ chuẩn + tăng ca − về sớm) khớp app',
    r.s === 200 && rep.length === nvCoCong.size && lech.length === 0,
    `giờ chuẩn=${STD_HOURS} · ${rep.length}/${nvCoCong.size} người · lệch: ${lech.join(' | ') || 'không'}`)

  // ── Oracle BẢNG CÔNG (ma trận) ──
  r = await api(`/hr/attendance/matrix?page=1&page_size=100&date_from=${ATT_FROM}&date_to=${ATT_TO}&department_id=${DEPT_ID}&work_dates=${ATT_DAYS.join(',')}`, 'GET')
  const m = r.j?.data ?? {}
  const roster = await restAll('Employee', `select=id&department_id=eq.${DEPT_ID}&is_active=is.true&deleted_at=is.null`)
  const rosterIds = roster.map(e => e.id)
  const attRoster = dbAtt.filter(a => rosterIds.includes(a.employee_id))
  const oWork = attRoster.filter(a => a.kind !== 'LEAVE').length
  const oLeave = attRoster.filter(a => a.kind === 'LEAVE').length
  const oOt = r1(attRoster.filter(a => a.kind !== 'LEAVE').reduce((s, a) => s + num(a.ot_hours), 0))
  const oEarly = r1(attRoster.filter(a => a.kind !== 'LEAVE').reduce((s, a) => s + num(a.early_leave_hours), 0))
  const oMissing = rosterIds.reduce((s, e) => s + Math.max(0, ATT_DAYS.length - attRoster.filter(a => a.employee_id === e && ATT_DAYS.includes(a.work_date)).length), 0)
  check('[52] Bảng công: số người trong danh sách · ngày công · ngày nghỉ · số ô còn thiếu tự tính lại đều khớp app',
    r.s === 200 && num(m.roster_total) === rosterIds.length && num(m.total) === rosterIds.length
      && num(m.work_days) === oWork && num(m.leave_days) === oLeave
      && r1(num(m.ot)) === oOt && r1(num(m.early)) === oEarly && num(m.missing_total) === oMissing,
    `app roster/ngày công/nghỉ/OT/về sớm/thiếu = ${m.roster_total}/${m.work_days}/${m.leave_days}/${m.ot}/${m.early}/${m.missing_total} · tính lại = ${rosterIds.length}/${oWork}/${oLeave}/${oOt}/${oEarly}/${oMissing}`)

  r = await api(`/hr/attendance/matrix?page=1&date_from=${ATT_FROM}&date_to=${ATT_TO}&department_id=${DEPT_ID}&work_dates=${ATT_DAYS.join(',')}&status=missing`, 'GET')
  const conThieu = rosterIds.filter(e => attRoster.filter(a => a.employee_id === e && ATT_DAYS.includes(a.work_date)).length < ATT_DAYS.length).length
  check('[53] Bảng công lọc "còn thiếu công" → đúng số người thật sự còn thiếu',
    r.s === 200 && num(r.j?.data?.total) === conThieu, `app=${r.j?.data?.total} · tính lại=${conThieu}`)

  // ── Ràng buộc nhập liệu ──
  r = await post(E1, addDays(TODAY, 1), 'CA1')
  check('[54] Chấm công cho ngày TƯƠNG LAI → chặn 400', r.s === 400, `s=${r.s} ${msg(r)}`)

  r = await post(E1, TODAY, 'CA1', { ot_hours: 2, early_leave_hours: 2 })
  check('[55] Vừa khai tăng ca vừa khai về sớm trong 1 ngày → chặn 400', r.s === 400, `s=${r.s}`)

  r = await post(E1, TODAY, 'CA1', { ot_hours: -3, early_leave_hours: 4 })
  const amDb = (await restAll('Attendance', `select=ot_hours,early_leave_hours&employee_id=eq.${E1}&work_date=eq.${TODAY}`))[0]
  check('[56] Số giờ tăng ca ÂM → chặn 400 (nếu không, luật "chỉ OT hoặc về sớm" bị lách và tổng giờ sai)',
    r.s === 400 || num(amDb?.ot_hours) >= 0,
    `s=${r.s} · DB lưu tăng ca=${amDb?.ot_hours} về sớm=${amDb?.early_leave_hours}`)
  if (num(amDb?.ot_hours) < 0) {
    const rp = await api(`/hr/attendance/report?date_from=${TODAY}&date_to=${TODAY}&department_id=${DEPT_ID}`, 'GET')
    const row = (rp.j?.data ?? []).find(x => x.employee_id === E1)
    console.log(`     ↳ hệ quả: báo cáo công của E1 ngày ${TODAY} = ${row?.total_hours} giờ (${row?.work_days} ngày × ${STD_HOURS} + ${row?.ot_hours} − ${row?.early_hours})`)
  }
  await restWrite('Attendance', 'DELETE', `employee_id=eq.${E1}&work_date=eq.${TODAY}`).catch(() => {})

  r = await post(E1, TODAY, 'CA1', { ot_hours: 1000 })
  seen500('POST /hr/attendance (tăng ca 1000 giờ)', r)
  check('[57] Khai tăng ca 1000 giờ (quá sức chứa của cột) → báo lỗi nhập liệu, không "Lỗi hệ thống"',
    r.s >= 400 && r.s < 500, `s=${r.s} ${msg(r)}`)
  await restWrite('Attendance', 'DELETE', `employee_id=eq.${E1}&work_date=eq.${TODAY}`).catch(() => {})

  r = await post(E1, '07-09-2026', 'CA1')
  seen500('POST /hr/attendance (ngày sai định dạng)', r)
  check('[58] Chấm công với ngày gõ kiểu Việt Nam "07-09-2026" → phải báo lỗi, KHÔNG âm thầm ghi công vào ngày khác',
    r.s >= 400 && r.s < 500, `s=${r.s} ${msg(r)} · app ghi công vào ngày ${r.j?.data?.work_date ?? '(không ghi)'} trong khi người dùng gõ 07-09-2026`)
  if (r.j?.data?.id) await restWrite('Attendance', 'DELETE', `id=eq.${r.j.data.id}`).catch(() => {})

  r = await api('/hr/attendance?date_from=hom-qua', 'GET')
  seen500('GET /hr/attendance?date_from=hom-qua', r)
  check('[59] Lọc bảng công bằng ngày viết sai → báo lỗi nhập liệu, không "Lỗi hệ thống"', r.s >= 400 && r.s < 500, `s=${r.s} ${msg(r)}`)

  const idXoa = dbAtt.find(a => a.employee_id === E2)?.id
  r = await api(`/hr/attendance/${idXoa}`, 'DELETE')
  check('[60] Xoá 1 dòng công → biến mất khỏi bảng công',
    r.s === 200 && (await restAll('Attendance', `select=id&id=eq.${idXoa}`)).length === 0, `s=${r.s}`)
}

// ═══ G. PHẠM VI KHO — nhóm nhân sự có được cắt theo kho như phần còn lại của app? ═══
{
  const src = f => readFileSync(join(ROOT, 'backend', 'src', 'controllers', 'hr', f), 'utf8')
  const layoutSrc = src('layoutController.ts'), asgSrc = src('assignmentController.ts')
  const coGuard = s => /warehouse_ids|scopedEmployeeIds|categoryScope|guardWarehouseScope|leaveScopeEmpIds/.test(s)
  check('[61] Mã nguồn trang Mẫu phân công (layout) có lớp cắt phạm vi kho',
    coGuard(layoutSrc), `layoutController.ts: ${coGuard(layoutSrc) ? 'có' : 'KHÔNG có bất kỳ tham chiếu phạm vi kho nào'}`)
  check('[62] Mã nguồn trang Phiếu phân công có lớp cắt phạm vi kho',
    coGuard(asgSrc), `assignmentController.ts: ${coGuard(asgSrc) ? 'có' : 'KHÔNG có bất kỳ tham chiếu phạm vi kho nào'}`)

  if (!TOK_B) {
    console.log('  ⚠ Bỏ qua [63]–[66]: không dựng được vai "chỉ có kho B" (chưa chạy được vai thật)')
  } else {
    let r = await apiAs(TOK_B, `/hr/layouts?warehouse_id=${WH_A.id}`, 'GET')
    const thay = (r.j?.data ?? []).filter(x => x.warehouse_id === WH_A.id)
    check('[63] Tài khoản CHỈ được giao kho B không đọc được mẫu phân công của kho A',
      r.s === 403 || thay.length === 0, `s=${r.s} · đọc được ${thay.length} mẫu của kho ${WH_A.name}`)

    r = await apiAs(TOK_B, '/hr/layouts', 'POST', { warehouse_id: WH_A.id, name: `${P} Layout lậu kho A` })
    const lauId = r.j?.data?.id
    check('[64] Tài khoản CHỈ được giao kho B không tạo được mẫu phân công CHO kho A',
      r.s === 403, `s=${r.s} · ${lauId ? 'đã tạo được mẫu ở kho ' + WH_A.name : 'bị chặn'}`)
    if (lauId) await restWrite('WorkLayout', 'DELETE', `id=eq.${lauId}`).catch(() => {})

    r = await apiAs(TOK_B, `/hr/sheets/${SH_MAIN}`, 'GET')
    const ten = (r.j?.data?.assignments ?? []).map(a => a.employee?.name).filter(Boolean)
    check('[65] Tài khoản CHỈ được giao kho B không xem được phiếu phân công + tên nhân sự của kho A',
      r.s === 403 || r.s === 404, `s=${r.s} · đọc được ${ten.length} tên nhân sự kho ${WH_A.name}`)

    r = await apiAs(TOK_B, '/hr/attendance', 'POST', { employee_id: E1, work_date: TODAY, kind: 'CA1', ot_hours: 3 })
    const ghiDuoc = (await restAll('Attendance', `select=id,kind,ot_hours&employee_id=eq.${E1}&work_date=eq.${TODAY}`))[0]
    const doc = await apiAs(TOK_B, `/hr/attendance?employee_id=${E1}&date_from=${TODAY}&date_to=${TODAY}`, 'GET')
    check('[66] Tài khoản CHỈ được giao kho B không CHẤM CÔNG được cho nhân sự kho A',
      r.s === 403 || !ghiDuoc,
      `ghi s=${r.s} · DB ${ghiDuoc ? `đã ghi ${ghiDuoc.kind} tăng ca ${ghiDuoc.ot_hours}` : 'không ghi'} · nhưng ĐỌC lại chỉ thấy ${(doc.j?.data ?? []).length} dòng (đọc bị cắt, ghi thì không)`)
    await restWrite('Attendance', 'DELETE', `employee_id=eq.${E1}&work_date=eq.${TODAY}`).catch(() => {})
  }
}

// ═══ DỌN + XÁC NHẬN 0 TÀN DƯ ════════════════════════════════════════════════
await wipe()
{
  const dept = await restAll('Department', `select=id&code=eq.${P}`)
  const con =
    dept.length
    + (await restAll('JobTitle', `select=id&name=like.${P}*`)).length
    + (await restAll('Employee', `select=id&employee_code=like.${P}*`)).length
    + (await restAll('Skill', `select=id&name=like.${P}*`)).length
    + (await restAll('WorkLayout', `select=id&name=like.${P}*`)).length
    + (await restAll('ShiftRestRule', `select=id&from_shift=like.${P}*`)).length
    + (QA_EMPS.length ? (await restAll('LeaveRequest', `select=id&employee_id=in.(${QA_EMPS.join(',')})`)).length : 0)
    + (QA_EMPS.length ? (await restAll('Attendance', `select=id&employee_id=in.(${QA_EMPS.join(',')})`)).length : 0)
    + (QA_EMPS.length ? (await restAll('WorkAssignment', `select=id&employee_id=in.(${QA_EMPS.join(',')})`)).length : 0)
    + (QA_EMPS.length ? (await restAll('EmployeeSkill', `select=id&employee_id=in.(${QA_EMPS.join(',')})`)).length : 0)
    + (QA_EMPS.length ? (await restAll('UserWarehouseAccess', `select=id&employee_id=in.(${QA_EMPS.join(',')})`)).length : 0)
  check('[67] Dọn 0 tàn dư (kể cả ngày công tự sinh từ đơn nghỉ đã duyệt)', con === 0, `${con} bản ghi còn lại`)
}

if (errs500.length) console.log(`\n  ⚠ Ca gây 500 (dọn error_logs): \n   - ${errs500.join('\n   - ')}`)
finish('HR')
