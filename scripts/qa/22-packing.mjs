// GÓI 22 — SỔ ĐÓNG GÓI ĐIỆN TỬ (11/08): vòng đời mở→đóng→sửa→hủy + chống đua +
// luật giờ (prod_end ≥ prod_start, nguồn OCR/MANUAL) + unique 1-tem-1-dòng-sống.
// KHÔNG gửi ảnh trong QA (tránh residue storage) — đường ảnh verify tay trên Preview.
import { login, api, restAll, restWrite, check, finish, BASE } from './lib.mjs'

const TAG = 'QAPACK'
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const ddmmyy = today.slice(8, 10) + today.slice(5, 7) + today.slice(2, 4)
const tem = (n) => `${ddmmyy}_${TAG}${n}_C01_M9_00${n}_B`   // V1 hợp lệ ≥6 đoạn
const iso = (h, m = 0) => new Date(`${today}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`).toISOString()

async function cleanup() {
  await restWrite('packing_logs', 'DELETE', `pallet_code=like.*${TAG}*`).catch(() => {})
}

console.log(`── SỔ ĐÓNG GÓI · ${BASE.replace('https://', '')} ──`)

// [0] chưa đăng nhập → 401
{
  const r = await fetch(`${BASE}/api/wms/packing-logs/board`)
  check('Chưa đăng nhập → board 401', r.status === 401, `http=${r.status}`)
}

await login()
await cleanup()

// [1] tem rác → 422; tem hợp lệ → mở sổ OPEN + tự điền từ QR
{
  const bad = await api('/wms/packing-logs/open', 'POST', { qr_code: 'khong-phai-tem' })
  check('Tem sai định dạng → 422', bad.s === 422, `http=${bad.s}`)

  const r = await api('/wms/packing-logs/open', 'POST', {
    qr_code: tem(1), prod_start_at: iso(8, 0), prod_start_src: 'MANUAL', ocr_raw: `${TAG} raw 08:00:00 533`,
  })
  check('Mở sổ tem hợp lệ → 200 OPEN', r.s === 200 && r.j?.data?.status === 'OPEN', `http=${r.s} st=${r.j?.data?.status}`)
  check('Tự điền mã hàng + máy từ tem', r.j?.data?.material_code === `${TAG}1` && r.j?.data?.machine_code === 'M9',
    `mat=${r.j?.data?.material_code} machine=${r.j?.data?.machine_code}`)
  check('Giờ SX thùng đầu + nguồn lưu đúng', r.j?.data?.prod_start_at != null && r.j?.data?.prod_start_src === 'MANUAL',
    `src=${r.j?.data?.prod_start_src}`)
}

// [1b] GHI 1 PHIÊN TRỌN (user chốt 11/08 sau test thật): quét tem → 2 giờ thùng đầu/cuối →
// complete:true = CLOSED luôn; máy trên tem sửa được (tem "AP" = máy A hoặc P)
{
  const r = await api('/wms/packing-logs/open', 'POST', {
    qr_code: tem(4), machine_code: 'A', qty_cartons: 110, complete: true,
    prod_start_at: iso(2, 44), prod_start_src: 'MANUAL', ocr_raw: '02:44 HSD:06/03/27 B/UR55',
    prod_end_at: iso(2, 49), prod_end_src: 'MANUAL', ocr_end_raw: '02:49 HSD:06/03/27 B/UR55',
  })
  check('Ghi 1 phiên (complete) → CLOSED ngay', r.s === 200 && r.j?.data?.status === 'CLOSED', `http=${r.s} st=${r.j?.data?.status}`)
  check('Máy override tem (M9→A) + đủ 2 giờ SX',
    r.j?.data?.machine_code === 'A' && r.j?.data?.prod_start_at != null && r.j?.data?.prod_end_at != null,
    `machine=${r.j?.data?.machine_code}`)
  const bad = await api('/wms/packing-logs/open', 'POST', {
    qr_code: tem(5), complete: true, prod_start_at: iso(3, 0), prod_start_src: 'MANUAL',
    prod_end_at: iso(2, 0), prod_end_src: 'MANUAL',
  })
  check('1 phiên với giờ cuối < giờ đầu → 422 TIME_ORDER', bad.s === 422 && bad.j?.error?.code === 'TIME_ORDER', `http=${bad.s} code=${bad.j?.error?.code}`)
}

// [2] tem đã có sổ SỐNG → 409 (thân thiện, nêu trạng thái)
{
  const r = await api('/wms/packing-logs/open', 'POST', { qr_code: tem(1) })
  check('Quét lại tem đang MỞ → 409 ALREADY_LOGGED', r.s === 409 && r.j?.error?.code === 'ALREADY_LOGGED', `http=${r.s} code=${r.j?.error?.code}`)
}

// [3] ĐUA mở: 2 người cùng quét 1 tem mới → đúng 1 thắng (unique WHERE status<>CANCELLED)
{
  const rs = await Promise.all([1, 2].map(() => api('/wms/packing-logs/open', 'POST', { qr_code: tem(2) })))
  const okN = rs.filter(r => r.s === 200).length
  const dupN = rs.filter(r => r.s === 409).length
  check('Đua 2 quét mở cùng tem → 1 thắng + 1 báo trùng', okN === 1 && dupN === 1, `ok=${okN} dup=${dupN}`)
  const rows = await restAll('packing_logs', `select=id&pallet_code=like.*${TAG}2*&status=neq.CANCELLED`)
  check('DB chỉ 1 dòng sổ sống cho tem đó', rows.length === 1, `rows=${rows.length}`)
}

// [4] luật giờ: đóng với giờ thùng cuối TRƯỚC giờ thùng đầu → 422 TIME_ORDER
{
  const rows = await restAll('packing_logs', `select=id&pallet_code=like.*${TAG}1*&status=eq.OPEN`)
  const id = rows[0]?.id
  const r = await api(`/wms/packing-logs/${id}/close`, 'POST', { prod_end_at: iso(7, 0), prod_end_src: 'MANUAL' })
  check('Giờ cuối < giờ đầu → 422 TIME_ORDER', r.s === 422 && r.j?.error?.code === 'TIME_ORDER', `http=${r.s} code=${r.j?.error?.code}`)

  // [5] đóng hợp lệ → CLOSED + số thùng nhập tay đánh dấu MANUAL
  const ok1 = await api(`/wms/packing-logs/${id}/close`, 'POST', {
    qty_cartons: 54, prod_end_at: iso(9, 3), prod_end_src: 'MANUAL', ocr_raw: `${TAG} raw 09:03:00 587`,
  })
  check('Đóng hợp lệ → CLOSED, qty=54 nguồn MANUAL',
    ok1.s === 200 && ok1.j?.data?.status === 'CLOSED' && Number(ok1.j?.data?.qty_cartons) === 54 && ok1.j?.data?.qty_source === 'MANUAL',
    `http=${ok1.s} st=${ok1.j?.data?.status} qty=${ok1.j?.data?.qty_cartons} src=${ok1.j?.data?.qty_source}`)

  // [6] đóng lại lần 2 → 409 NOT_OPEN (CAS trên status)
  const r2 = await api(`/wms/packing-logs/${id}/close`, 'POST', { qty_cartons: 54 })
  check('Đóng lần 2 → 409 NOT_OPEN', r2.s === 409 && r2.j?.error?.code === 'NOT_OPEN', `http=${r2.s} code=${r2.j?.error?.code}`)
}

// [7] ĐUA đóng: 2 người cùng bấm Đóng 1 pallet → đúng 1 ăn
{
  const rows = await restAll('packing_logs', `select=id&pallet_code=like.*${TAG}2*&status=eq.OPEN`)
  const id = rows[0]?.id
  const rs = await Promise.all([1, 2].map(() => api(`/wms/packing-logs/${id}/close`, 'POST', { qty_cartons: 10 })))
  const okN = rs.filter(r => r.s === 200).length
  check('Đua 2 lần Đóng → 1 ăn + 1 NOT_OPEN', okN === 1 && rs.filter(r => r.s === 409).length === 1,
    rs.map(r => r.s).join(','))
}

// [8] list + board: sổ lọc đúng trạng thái, tìm theo tem
{
  // 3 dòng CLOSED: tem1 (đóng thường) + tem2 (đua đóng) + tem4 (ghi 1 phiên complete)
  const closed = await api(`/wms/packing-logs?status=CLOSED&search=${TAG}&date_from=${today}&date_to=${today}`, 'GET')
  check('Sổ lọc CLOSED thấy đủ 3 dòng vừa đóng', closed.s === 200 && (closed.j?.data?.rows ?? []).length === 3,
    `http=${closed.s} n=${closed.j?.data?.rows?.length}`)
  const board = await api('/wms/packing-logs/board', 'GET')
  const mine = ((board.j?.data ?? [])).filter(r => String(r.pallet_code).includes(TAG))
  check('Board không còn pallet QA nào mở', board.s === 200 && mine.length === 0, `open=${mine.length}`)
}

// [9] sửa sau đóng: giờ hợp lệ → nguồn thành MANUAL; end<start → 422
{
  const rows = await restAll('packing_logs', `select=id&pallet_code=like.*${TAG}1*&status=eq.CLOSED`)
  const id = rows[0]?.id
  const ok1 = await api(`/wms/packing-logs/${id}`, 'PATCH', { prod_start_at: iso(8, 5), note: `${TAG} sửa giờ` })
  check('Sửa giờ đầu → 200 + nguồn MANUAL', ok1.s === 200 && ok1.j?.data?.prod_start_src === 'MANUAL', `http=${ok1.s} src=${ok1.j?.data?.prod_start_src}`)
  const bad = await api(`/wms/packing-logs/${id}`, 'PATCH', { prod_end_at: iso(6, 0) })
  check('Sửa giờ cuối < giờ đầu → 422', bad.s === 422 && bad.j?.error?.code === 'TIME_ORDER', `http=${bad.s} code=${bad.j?.error?.code}`)
}

// [10] hủy giữ vết + tem được GIẢI PHÓNG (unique chỉ áp dòng sống)
{
  const rows = await restAll('packing_logs', `select=id&pallet_code=like.*${TAG}2*`)
  const id = rows[0]?.id
  const c = await api(`/wms/packing-logs/${id}/cancel`, 'POST', { note: `${TAG} ghi nhầm` })
  check('Hủy dòng → 200', c.s === 200, `http=${c.s}`)
  const again = await api('/wms/packing-logs/open', 'POST', { qr_code: tem(2) })
  check('Tem có dòng ĐÃ HỦY → mở sổ lại được (đợt mới)', again.s === 200 && again.j?.data?.status === 'OPEN', `http=${again.s}`)
}

console.log('\n🧹 dọn…')
await cleanup()
const residue = (await restAll('packing_logs', `select=id&pallet_code=like.*${TAG}*`)).length
console.log(`residue=${residue}`)
finish('PACKING')
