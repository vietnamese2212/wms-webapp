// GÓI 35 — KHÔNG ĐƯỢC TỒN TẠI TÀI KHOẢN "PHẠM VI KHO ĐƯỢC GÁN nhưng CHƯA GÁN KHO NÀO" (30/08).
//
// Vì sao: app đọc mảng kho rỗng theo HAI cách trái ngược —
//   · giữ nguyên `[]`            → `.includes(wh)` luôn sai ⇒ chặn sạch (Tồn kho ghi, Nhập, Xuất)
//   · `ids.length ? ids : null`  → null ⇒ KHÔNG giới hạn  (Tổng quan, Truy xuất lô, Chi phí kho,
//                                                          facet Tồn kho, dồn/tách pallet)
// Đo thật 30/08: một tài khoản như vậy nhìn thấy ĐÚNG BẰNG superadmin ở 5 màn, trong khi người
// được gán 1 kho chỉ thấy kho mình. Đường ĐỌC hiểu lỏng, đường GHI hiểu chặt — app tự mâu thuẫn
// về đúng một câu hỏi, và nghiêng về phía lộ dữ liệu.
//
// Vá bằng cách CHẶN Ở CỬA GHI để trạng thái đó không tồn tại (không vá 15 chỗ đọc — lượt quét tay
// đã chứng minh là sót). Gói này canh đủ CẢ BA cửa: tạo · sửa hồ sơ · đặt phạm vi kho. Thiếu một
// cửa là lỗ mở lại.
import { randomUUID } from 'crypto'
import { login, api, restAll, restWrite, check, finish, FIX, BASE } from './lib.mjs'

const TAG = 'SIMSCOPE'
const nowIso = () => new Date().toISOString()

async function purge() {
  for (const e of await restAll('Employee', `select=id&employee_code=like.${TAG}*`))
    await restWrite('Employee', 'DELETE', `id=eq.${e.id}`).catch(() => {})
  for (const j of await restAll('JobTitle', `select=id&name=like.${TAG}*`))
    await restWrite('JobTitle', 'DELETE', `id=eq.${j.id}`).catch(() => {})
}

console.log(`── PHẠM VI KHO RỖNG · ${BASE.replace('https://', '')} ──`)
await login()
await purge()

const [job] = await restWrite('JobTitle', 'POST', null, {
  id: randomUUID(), name: `${TAG} Chức danh`, module_permissions: { inventory: ['view'] },
  created_at: nowIso(), updated_at: nowIso(),
})
const mk = (code, whIds) => api('/masterdata/employees', 'POST', {
  name: `${TAG} ${code}`, employee_code: `${TAG}${code}`, email: `${TAG.toLowerCase()}${code}@sim.local`,
  job_title_id: job.id, warehouse_scope: 'ASSIGNED', warehouse_ids: whIds,
})

try {
  // [1] cửa TẠO
  {
    const r = await mk('A', [])
    check('[1] TẠO tài khoản ASSIGNED mà không gán kho → 422', r.s === 422, `HTTP ${r.s}`)
  }
  // [2] tạo BÌNH THƯỜNG vẫn chạy (chốt chặn không được cản việc thật)
  let empId = null
  {
    const r = await mk('B', [FIX.WH_QR.id])
    empId = r.j?.data?.id ?? null
    check('[2] tạo tài khoản có gán kho → vẫn tạo được (không hồi quy)', r.s === 201 && !!empId, `HTTP ${r.s}`)
  }
  // [2b] ĐƯỜNG LÁCH: chốt chặn chỉ đếm ĐỘ DÀI mảng, nên id kho không có thật vẫn qua cửa — rồi
  // lệnh ghi UserWarehouseAccess hỏng vì khoá ngoại và (trước 30/08) bị NUỐT ⇒ tài khoản tồn tại
  // với 0 kho, đúng trạng thái rò. Đo thật: HTTP 201, 0 kho. Phải chặn bằng kiểm kho CÓ THẬT.
  {
    const r = await mk('D', ['00000000-0000-0000-0000-000000000000'])
    const id = r.j?.data?.id
    const n = id ? (await restAll('UserWarehouseAccess', `select=warehouse_id&employee_id=eq.${id}`)).length : -1
    check('[2b] gán id kho KHÔNG CÓ THẬT → từ chối, không đẻ ra tài khoản 0 kho',
      r.s === 400 && !id, `HTTP ${r.s}${id ? ` · tài khoản được tạo với ${n} kho` : ''}`)
  }
  // [3] cửa SỬA HỒ SƠ — gỡ hết kho của tài khoản đang có kho
  if (empId) {
    const r = await api(`/masterdata/employees/${empId}`, 'PATCH', { warehouse_ids: [] })
    check('[3] SỬA hồ sơ gỡ hết kho → 422', r.s === 422, `HTTP ${r.s}`)
  }
  // [4] cửa ĐẶT PHẠM VI KHO riêng
  if (empId) {
    const r = await api(`/masterdata/employees/${empId}/warehouses`, 'PUT', { warehouse_ids: [] })
    check('[4] ĐẶT phạm vi kho = rỗng → 422', r.s === 422, `HTTP ${r.s}`)
  }
  // [5] tài khoản vẫn còn nguyên kho sau 2 lần bị từ chối (chặn xong không được ghi dở dang)
  if (empId) {
    const rows = await restAll('UserWarehouseAccess', `select=warehouse_id&employee_id=eq.${empId}`)
    check('[5] bị từ chối thì kho cũ GIỮ NGUYÊN (không xoá dở rồi mới báo lỗi)',
      rows.length === 1, `còn ${rows.length} kho`)
  }
  // [4b] TRỤC LOẠI HÀNG y hệt: `scopeCategoriesOf` cũng đọc mảng rỗng là "không giới hạn". Lúc TẠO
  // thì BE tự điền cả danh mục nên rỗng không xuất hiện, nhưng form Sửa cho phép BỎ TICK HẾT.
  // Đo 30/08: tài khoản bỏ tick hết thấy FG01+FG02, người được cấp đúng FG01 chỉ thấy FG01.
  if (empId) {
    const r = await api(`/masterdata/employees/${empId}`, 'PATCH', { allowed_categories: [] })
    check('[4b] SỬA bỏ tick HẾT loại hàng → 422', r.s === 422, `HTTP ${r.s}`)
  }
  // [6] NATIONAL thì không cần gán kho — không được chặn oan
  {
    const r = await api('/masterdata/employees', 'POST', {
      name: `${TAG} C`, employee_code: `${TAG}C`, email: `${TAG.toLowerCase()}c@sim.local`,
      job_title_id: job.id, warehouse_scope: 'NATIONAL', warehouse_ids: [],
    })
    check('[6] phạm vi TOÀN QUỐC không cần gán kho → vẫn tạo được', r.s === 201, `HTTP ${r.s}`)
  }
} finally {
  await purge()
  const left = (await restAll('Employee', `select=id&employee_code=like.${TAG}*`)).length
             + (await restAll('JobTitle', `select=id&name=like.${TAG}*`)).length
  check('dọn 0 sót (nhân sự + chức danh SIM)', left === 0, `còn ${left}`)
}

finish('SCOPE-EMPTY')
