// GÓI 22 — SỔ ĐÓNG GÓI ĐIỆN TỬ (11/08; v2 = TRANG SỔ cùng ngày): vòng đời TRANG SỔ
// (mở → quét pallet → Giờ kết thúc tính tổng → sửa/hủy) + gate "mở sổ trước mới quét"
// + chống đua (unique 1-trang-mở per kho+mã+máy; 1-tem-1-dòng-sống) + luật giờ.
// KHÔNG gửi ảnh trong QA (tránh residue storage) — đường ảnh/OCR verify tay trên Preview.
import { login, api, restAll, restWrite, check, finish, resolveFixtures, BASE, FIX } from './lib.mjs'

const TAG = 'QAPACK'
const WH = 'QAPACKWH'   // kho tổng hợp giả có TAG — packing_runs.warehouse_id là text, dọn theo TAG
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const ddmmyy = today.slice(8, 10) + today.slice(5, 7) + today.slice(2, 4)
const tem = (n, mat = `${TAG}${n}`) => `${ddmmyy}_${mat}_C01_M9_00${n}_B`   // V1 hợp lệ ≥6 đoạn
const iso = (h, m = 0) => new Date(`${today}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`).toISOString()

async function cleanup() {
  await restWrite('packing_logs', 'DELETE', `pallet_code=like.*${TAG}*`).catch(() => {})
  await restWrite('packing_logs', 'DELETE', `warehouse_id=eq.${WH}`).catch(() => {})         // [17] tem mã THẬT (không mang TAG)
  await restWrite('packing_runs', 'DELETE', `warehouse_id=eq.${WH}`).catch(() => {})
  await restWrite('InventoryEntry', 'DELETE', `pallet_code=like.*${TAG}*`).catch(() => {})   // [16] giả lập kho nhận
}
const openRun = (mat, machine, extra = {}) =>
  api('/wms/packing-runs', 'POST', { warehouse_id: WH, material_code: mat, machine_code: machine, run_date: today, start_at: iso(7, 0), shift: 'Ca 1', cycle: '55', ...extra })

console.log(`── SỔ ĐÓNG GÓI (trang sổ) · ${BASE.replace('https://', '')} ──`)

// [0] chưa đăng nhập → 401
{
  const r = await fetch(`${BASE}/api/wms/packing-runs/board`)
  check('Chưa đăng nhập → board trang sổ 401', r.status === 401, `http=${r.status}`)
}

await login()
await cleanup()

// [1] GATE: chưa mở trang sổ → quét tem bị chặn 422 RUN_REQUIRED (user chốt 11/08 chiều)
{
  const r = await api('/wms/packing-logs/open', 'POST', { qr_code: tem(1) })
  check('Quét khi CHƯA mở trang sổ → 422 RUN_REQUIRED', r.s === 422 && r.j?.error?.code === 'RUN_REQUIRED', `http=${r.s} code=${r.j?.error?.code}`)
  const bad = await api('/wms/packing-logs/open', 'POST', { qr_code: 'khong-phai-tem' })
  check('Tem sai định dạng → 422', bad.s === 422, `http=${bad.s}`)
}

// [2] MỞ TRANG SỔ: thiếu field → 422; mở OK → OPEN; mở trùng (kho+mã+máy) → 409; đua 2 mở → 1 thắng
let runA = null
{
  const miss = await api('/wms/packing-runs', 'POST', { warehouse_id: WH, material_code: `${TAG}1` })
  check('Mở trang thiếu Máy → 422', miss.s === 422, `http=${miss.s}`)
  const r = await openRun(`${TAG}1`, 'A')
  runA = r.j?.data
  check('Mở trang sổ hợp lệ → 200 OPEN', r.s === 200 && runA?.status === 'OPEN', `http=${r.s} st=${runA?.status}`)
  const dup = await openRun(`${TAG}1`, 'A')
  check('Mở trùng kho+mã+máy đang MỞ → 409 RUN_DUP', dup.s === 409 && dup.j?.error?.code === 'RUN_DUP', `http=${dup.s} code=${dup.j?.error?.code}`)
  const rs = await Promise.all([1, 2].map(() => openRun(`${TAG}2`, 'M9')))
  const okN = rs.filter(x => x.s === 200).length
  check('Đua 2 người cùng mở 1 trang → 1 thắng + 1 RUN_DUP', okN === 1 && rs.filter(x => x.s === 409).length === 1, rs.map(x => x.s).join(','))
}

// [3] QUÉT VÀO TRANG: tự khớp trang theo MÃ, pallet KẾ THỪA Máy + Kho của trang (tem in M9 → máy A)
{
  const r = await api('/wms/packing-logs/open', 'POST', {
    qr_code: tem(1), prod_start_at: iso(8, 0), prod_start_src: 'MANUAL', ocr_raw: `${TAG} raw 08:00 533`,
  })
  check('Quét tem khi trang mở → 200 OPEN + gắn run_id', r.s === 200 && r.j?.data?.status === 'OPEN' && r.j?.data?.run_id === runA?.id,
    `http=${r.s} run=${r.j?.data?.run_id === runA?.id}`)
  check('Pallet kế thừa Máy A + Kho của trang (tem in M9)',
    r.j?.data?.machine_code === 'A' && r.j?.data?.warehouse_id === WH,
    `machine=${r.j?.data?.machine_code} wh=${r.j?.data?.warehouse_id}`)
  const again = await api('/wms/packing-logs/open', 'POST', { qr_code: tem(1) })
  check('Quét lại tem đang MỞ → 409 ALREADY_LOGGED', again.s === 409 && again.j?.error?.code === 'ALREADY_LOGGED', `http=${again.s} code=${again.j?.error?.code}`)
}

// [4] NHIỀU TRANG cùng mã (khác máy) → quét không chỉ định = 409 RUN_AMBIGUOUS; chỉ định run_id = OK
let runB = null
{
  const rB = await openRun(`${TAG}1`, 'B')
  runB = rB.j?.data
  check('Mở trang 2 cùng mã khác máy → 200', rB.s === 200, `http=${rB.s}`)
  const amb = await api('/wms/packing-logs/open', 'POST', { qr_code: tem(6, `${TAG}1`) })
  check('Quét khi mã mở 2 trang, không chỉ định → 409 RUN_AMBIGUOUS', amb.s === 409 && amb.j?.error?.code === 'RUN_AMBIGUOUS', `http=${amb.s} code=${amb.j?.error?.code}`)
  const pick = await api('/wms/packing-logs/open', 'POST', { qr_code: tem(6, `${TAG}1`), run_id: runB?.id, complete: true, qty_cartons: 20 })
  check('Chỉ định run_id → 200, máy theo trang B', pick.s === 200 && pick.j?.data?.machine_code === 'B' && pick.j?.data?.status === 'CLOSED',
    `http=${pick.s} machine=${pick.j?.data?.machine_code}`)
  const wrong = await api('/wms/packing-logs/open', 'POST', { qr_code: tem(3), run_id: runB?.id })
  check('Tem mã khác trang chỉ định → 422 RUN_MATERIAL_MISMATCH', wrong.s === 422 && wrong.j?.error?.code === 'RUN_MATERIAL_MISMATCH', `http=${wrong.s} code=${wrong.j?.error?.code}`)
}

// [5] GHI 1 PHIÊN TRỌN (complete:true) + luật giờ TIME_ORDER
{
  await openRun(`${TAG}4`, 'M9')
  const r = await api('/wms/packing-logs/open', 'POST', {
    qr_code: tem(4), qty_cartons: 110, complete: true,
    prod_start_at: iso(2, 44), prod_start_src: 'MANUAL', ocr_raw: '02:44 HSD:06/03/27 B/UR55',
    prod_end_at: iso(2, 49), prod_end_src: 'MANUAL', ocr_end_raw: '02:49 HSD:06/03/27 B/UR55',
  })
  check('Ghi 1 phiên (complete) → CLOSED ngay, đủ 2 giờ SX', r.s === 200 && r.j?.data?.status === 'CLOSED' && r.j?.data?.prod_end_at != null,
    `http=${r.s} st=${r.j?.data?.status}`)
  const bad = await api('/wms/packing-logs/open', 'POST', {
    qr_code: tem(5, `${TAG}4`), complete: true,
    prod_start_at: iso(3, 0), prod_start_src: 'MANUAL', prod_end_at: iso(2, 0), prod_end_src: 'MANUAL',
  })
  check('1 phiên giờ cuối < giờ đầu → 422 TIME_ORDER', bad.s === 422 && bad.j?.error?.code === 'TIME_ORDER', `http=${bad.s} code=${bad.j?.error?.code}`)
}

// [6] ĐUA quét mở cùng 1 tem mới → đúng 1 thắng (unique 1-tem-1-dòng-sống)
{
  const rs = await Promise.all([1, 2].map(() => api('/wms/packing-logs/open', 'POST', { qr_code: tem(2) })))
  const okN = rs.filter(r => r.s === 200).length
  check('Đua 2 quét mở cùng tem → 1 thắng + 1 báo trùng', okN === 1 && rs.filter(r => r.s === 409).length === 1, rs.map(r => r.s).join(','))
  const rows = await restAll('packing_logs', `select=id&pallet_code=like.*${TAG}2*&status=neq.CANCELLED`)
  check('DB chỉ 1 dòng sổ sống cho tem đó', rows.length === 1, `rows=${rows.length}`)
}

// [7] ĐÓNG PALLET: giờ cuối < giờ đầu → 422; đóng OK → CLOSED qty MANUAL; đóng lần 2 → 409 (CAS)
{
  const rows = await restAll('packing_logs', `select=id&pallet_code=like.*${TAG}1_*&status=eq.OPEN`)
  const id = rows[0]?.id
  const bad = await api(`/wms/packing-logs/${id}/close`, 'POST', { prod_end_at: iso(7, 0), prod_end_src: 'MANUAL' })
  check('Đóng pallet giờ cuối < giờ đầu → 422 TIME_ORDER', bad.s === 422 && bad.j?.error?.code === 'TIME_ORDER', `http=${bad.s} code=${bad.j?.error?.code}`)
  const ok1 = await api(`/wms/packing-logs/${id}/close`, 'POST', { qty_cartons: 54, prod_end_at: iso(9, 3), prod_end_src: 'MANUAL' })
  check('Đóng pallet hợp lệ → CLOSED qty=54 MANUAL',
    ok1.s === 200 && ok1.j?.data?.status === 'CLOSED' && Number(ok1.j?.data?.qty_cartons) === 54 && ok1.j?.data?.qty_source === 'MANUAL',
    `http=${ok1.s} qty=${ok1.j?.data?.qty_cartons}`)
  const r2 = await api(`/wms/packing-logs/${id}/close`, 'POST', { qty_cartons: 54 })
  check('Đóng pallet lần 2 → 409 NOT_OPEN', r2.s === 409 && r2.j?.error?.code === 'NOT_OPEN', `http=${r2.s} code=${r2.j?.error?.code}`)
}

// [8] HỦY TRANG có pallet → 409 RUN_HAS_PALLETS (bảo toàn sổ)
{
  const r = await api(`/wms/packing-runs/${runA?.id}/cancel`, 'POST', {})
  check('Hủy trang đã có pallet → 409 RUN_HAS_PALLETS', r.s === 409 && r.j?.error?.code === 'RUN_HAS_PALLETS', `http=${r.s} code=${r.j?.error?.code}`)
}

// [9] GIỜ KẾT THÚC: end<start → 422; đóng OK → CLOSED + TỔNG SẢN LƯỢNG = Σ pallet; đua 2 đóng → 1 ăn
{
  const bad = await api(`/wms/packing-runs/${runA?.id}/close`, 'POST', { end_at: iso(6, 0) })
  check('Giờ kết thúc < giờ bắt đầu → 422 TIME_ORDER', bad.s === 422 && bad.j?.error?.code === 'TIME_ORDER', `http=${bad.s} code=${bad.j?.error?.code}`)
  const rs = await Promise.all([1, 2].map(() => api(`/wms/packing-runs/${runA?.id}/close`, 'POST', { end_at: iso(16, 30) })))
  const okR = rs.find(r => r.s === 200)
  check('Đua 2 lần Giờ kết thúc → 1 ăn + 1 RUN_NOT_OPEN', !!okR && rs.filter(r => r.s === 409).length === 1, rs.map(r => r.s).join(','))
  // trang A có đúng 1 pallet sống (tem1, qty 54) → tổng chốt phải = 54, đếm = 1
  check('Tổng sản lượng chốt = Σ thùng pallet (54) + đếm pallet = 1',
    Number(okR?.j?.data?.qty_total) === 54 && Number(okR?.j?.data?.pallet_count) === 1,
    `qty_total=${okR?.j?.data?.qty_total} pallets=${okR?.j?.data?.pallet_count}`)
}

// [10] Trang ĐÃ ĐÓNG không nhận quét nữa: đóng nốt trang B + trang M9 → quét mã đó lại bị RUN_REQUIRED
{
  await api(`/wms/packing-runs/${runB?.id}/close`, 'POST', {})
  const r = await api('/wms/packing-logs/open', 'POST', { qr_code: tem(7, `${TAG}1`) })
  check('Mọi trang của mã đã đóng → quét lại 422 RUN_REQUIRED', r.s === 422 && r.j?.error?.code === 'RUN_REQUIRED', `http=${r.s} code=${r.j?.error?.code}`)
}

// [11] SỬA TRANG (PATCH): đổi ca/máy OK; end<start → 422; sửa dòng pallet sau đóng → nguồn MANUAL
{
  const upd = await api(`/wms/packing-runs/${runA?.id}`, 'PATCH', { shift: 'Ca 2', machine_code: 'A2', note: `${TAG} sửa` })
  check('Sửa trang (ca/máy) → 200', upd.s === 200 && upd.j?.data?.shift === 'Ca 2' && upd.j?.data?.machine_code === 'A2', `http=${upd.s}`)
  const bad = await api(`/wms/packing-runs/${runA?.id}`, 'PATCH', { end_at: iso(5, 0) })
  check('Sửa giờ kết thúc < bắt đầu → 422', bad.s === 422 && bad.j?.error?.code === 'TIME_ORDER', `http=${bad.s}`)
  const rows = await restAll('packing_logs', `select=id&pallet_code=like.*${TAG}1_*&status=eq.CLOSED`)
  const pe = await api(`/wms/packing-logs/${rows[0]?.id}`, 'PATCH', { prod_start_at: iso(8, 5) })
  check('Sửa giờ pallet sau đóng → nguồn MANUAL', pe.s === 200 && pe.j?.data?.prod_start_src === 'MANUAL', `http=${pe.s} src=${pe.j?.data?.prod_start_src}`)
}

// [12] HỦY TRANG RỖNG được + tem/khóa unique được GIẢI PHÓNG
{
  const r9 = await openRun(`${TAG}9`, 'M9')
  const c = await api(`/wms/packing-runs/${r9.j?.data?.id}/cancel`, 'POST', { note: `${TAG} mở nhầm` })
  check('Hủy trang chưa có pallet → 200', c.s === 200, `http=${c.s}`)
  const re = await openRun(`${TAG}9`, 'M9')
  check('Khóa unique giải phóng sau hủy → mở lại được', re.s === 200, `http=${re.s}`)
  await api(`/wms/packing-runs/${re.j?.data?.id}/cancel`, 'POST', {})
}

// [13] LIST + BOARD: lọc trạng thái đúng; board chỉ còn trang MỞ
{
  const closed = await api(`/wms/packing-runs?status=CLOSED&search=${TAG}&date_from=${today}&date_to=${today}`, 'GET')
  const n = (closed.j?.data?.rows ?? []).filter(r => r.warehouse_id === WH).length
  check('Tra cứu trang CLOSED thấy đủ 2 trang (A + B)', closed.s === 200 && n === 2, `http=${closed.s} n=${n}`)
  const board = await api('/wms/packing-runs/board', 'GET')
  const mine = (board.j?.data ?? []).filter(r => r.warehouse_id === WH)
  // còn mở: trang QAPACK2 (đua mở) + QAPACK4 — board phải thấy đúng 2, kèm Σ sống
  const r4 = mine.find(r => r.material_code === `${TAG}4`)
  check('Board còn đúng 2 trang mở + Σ sống trang QAPACK4 = 110/1 pallet',
    board.s === 200 && mine.length === 2 && Number(r4?.qty_total) === 110 && Number(r4?.pallet_count) === 1,
    `n=${mine.length} qty4=${r4?.qty_total}`)
}

// [13b] NGUỒN GIỜ 'AI' (12/08 — nhãn nguồn AI/OCR/người): BE phải nhận src='AI' và lưu đúng
{
  await openRun(`${TAG}9`, 'M9')
  const r = await api('/wms/packing-logs/open', 'POST', {
    qr_code: tem(9), qty_cartons: 10, prod_start_at: iso(8, 0), prod_start_src: 'AI', complete: true,
    prod_end_at: iso(9, 0), prod_end_src: 'MANUAL',
  })
  check('Nguồn giờ AI được nhận + lưu đúng (start=AI, end=MANUAL)',
    r.s === 200 && r.j?.data?.prod_start_src === 'AI' && r.j?.data?.prod_end_src === 'MANUAL',
    `http=${r.s} start=${r.j?.data?.prod_start_src} end=${r.j?.data?.prod_end_src}`)
  // tem KHÁC tem(9) — tem(9) đã ghi ở trên, nếu dùng lại sẽ 409 ALREADY_LOGGED trước khi tới validation nguồn
  const bad = await api('/wms/packing-logs/open', 'POST', { qr_code: tem(8, `${TAG}9`), prod_start_at: iso(8, 0), prod_start_src: 'ROBOT' })
  check('Nguồn giờ lạ (ROBOT) → 422', bad.s === 422, `http=${bad.s}`)
}

// [14] AI VISION (12/08): key KHÔNG rò qua settings hở đọc; lỗi vision = 422 SẠCH (FE rơi về OCR, không 500)
{
  // 14a. PUT /wms/settings/vision_api phải bị chặn (cửa ghi duy nhất = /wms/vision-config)
  const viaSettings = await api('/wms/settings/vision_api', 'PUT', { value: { key_enc: 'x' } })
  check('Ghi vision_api qua /wms/settings bị chặn 400 UNKNOWN_SETTING',
    viaSettings.s === 400 && viaSettings.j?.error?.code === 'UNKNOWN_SETTING', `http=${viaSettings.s}`)

  // 14b. Trước khi cấu hình: vision-ocr trả 422 VISION_NOT_CONFIGURED (không 500) — nhớ trạng thái để khôi phục
  const pre = await api('/wms/vision-config', 'GET')
  const hadKey = pre.j?.data?.configured === true
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  if (!hadKey) {
    const r = await api('/wms/packing/vision-ocr', 'POST', { photo_data: tinyPng })
    check('Chưa cấu hình → vision-ocr 422 VISION_NOT_CONFIGURED (FE rơi về OCR)',
      r.s === 422 && r.j?.error?.code === 'VISION_NOT_CONFIGURED', `http=${r.s} code=${r.j?.error?.code}`)
  }

  // 14c. Key giả CHỈ lưu khi môi trường CHƯA cấu hình (không đè key thật của đơn vị)
  if (!hadKey) {
    const saved = await api('/wms/vision-config', 'PUT', { api_key: `${TAG}-dummy-key-0123456789abcdef` })
    check('Lưu key AI Vision qua /wms/vision-config OK', saved.s === 200 && saved.j?.data?.configured === true, `http=${saved.s}`)

    // 14d. Key giả gọi Google bị từ chối → 422 VISION_FAILED (không 500, không đổ error_logs)
    const bad = await api('/wms/packing/vision-ocr', 'POST', { photo_data: tinyPng })
    check('Key hỏng → vision-ocr 422 VISION_FAILED (không 500 — FE tự rơi về OCR)',
      bad.s === 422 && bad.j?.error?.code === 'VISION_FAILED', `http=${bad.s} code=${bad.j?.error?.code} msg=${bad.j?.error?.message}`)
  } else {
    console.log('ℹ️  vision-config đã có key thật — bỏ qua kịch bản key giả (không đè key của đơn vị)')
  }

  // 14e. Key (thật hay giả) KHÔNG rò: settings hở đọc không thấy vision_api; GET config chỉ trả đuôi che
  const settings = await api('/wms/settings', 'GET')
  const leaked = (settings.j?.data ?? []).some(r => r.key === 'vision_api')
  check('GET /wms/settings KHÔNG lộ vision_api (key mã hóa không rò cho user thường)', settings.s === 200 && !leaked, `leaked=${leaked}`)
  const cfg = await api('/wms/vision-config', 'GET')
  const body = JSON.stringify(cfg.j?.data ?? {})
  check('GET /wms/vision-config chỉ trả đuôi che, không chứa key thô',
    cfg.s === 200 && cfg.j?.data?.configured === true && !body.includes(`${TAG}-dummy-key`) && !/AIza[\w-]{20}/.test(body),
    `body=${body.slice(0, 120)}`)
  const badImg = await api('/wms/packing/vision-ocr', 'POST', { photo_data: 'khong-phai-anh' })
  check('photo_data rác → 400 BAD_IMAGE', badImg.s === 400 && badImg.j?.error?.code === 'BAD_IMAGE', `http=${badImg.s}`)

  // 14f. Khôi phục: gỡ key giả (chỉ khi chính test này lưu)
  if (!hadKey) {
    const off = await api('/wms/vision-config', 'PUT', { api_key: null })
    check('Gỡ key → configured=false', off.s === 200 && off.j?.data?.configured === false, `http=${off.s}`)
  }
}

// [16] NHIỀU MÃ / 1 TRANG SỔ + SEARCH TEM + ĐỐI CHIẾU SX↔KHO (user 13/08):
// 1 số hàng có 2-3 mã SX chung 1 chu kỳ + 1 máy → 1 trang nhiều mã; search tem ra trang chứa nó;
// quét sổ = xác nhận LẦN 1, kho quét nhập = LẦN 2 → lọc "SX tạo mà kho CHƯA nhận".
{
  const temX2 = tem(5, `${TAG}X2`)
  const multi = await api('/wms/packing-runs', 'POST', {
    warehouse_id: WH, material_codes: [`${TAG}X1`, `${TAG}X2`], machine_code: 'MX', run_date: today, start_at: iso(7, 0),
  })
  const mrun = multi.j?.data
  check('[16] Mở trang 2 mã → 200 + material_codes đủ 2 (primary = mã đầu)',
    multi.s === 200 && (mrun?.material_codes ?? []).length === 2 && mrun?.material_code === `${TAG}X1`,
    `http=${multi.s} codes=${JSON.stringify(mrun?.material_codes)}`)

  const p2 = await api('/wms/packing-logs/open', 'POST', { qr_code: temX2, qty_cartons: 7, complete: true })
  check('[16] Quét tem mã THỨ HAI → tự khớp trang nhiều mã + kế thừa máy',
    p2.s === 200 && p2.j?.data?.run_id === mrun?.id && p2.j?.data?.machine_code === 'MX', `http=${p2.s} machine=${p2.j?.data?.machine_code}`)

  const ovl = await api('/wms/packing-runs', 'POST', { warehouse_id: WH, material_codes: [`${TAG}X2`, `${TAG}X3`], machine_code: 'MX' })
  check('[16] Mở trang có mã GIAO NHAU cùng kho+máy → 409 RUN_DUP',
    ovl.s === 409 && ovl.j?.error?.code === 'RUN_DUP', `http=${ovl.s} code=${ovl.j?.error?.code}`)

  // đua 2 mở giao nhau nhưng KHÁC mã đầu — unique index cũ không bắt được, phải nhờ advisory lock trong RPC
  const rs = await Promise.all([
    api('/wms/packing-runs', 'POST', { warehouse_id: WH, material_codes: [`${TAG}Y1`, `${TAG}Y9`], machine_code: 'MY' }),
    api('/wms/packing-runs', 'POST', { warehouse_id: WH, material_codes: [`${TAG}Y9`], machine_code: 'MY' }),
  ])
  check('[16] Đua 2 mở trang mã giao nhau (khác mã đầu) → 1 thắng + 1 RUN_DUP',
    rs.filter(r => r.s === 200).length === 1 && rs.filter(r => r.s === 409).length === 1, rs.map(r => r.s).join(','))
  const yWin = rs.find(r => r.s === 200)?.j?.data

  const sr = await api(`/wms/packing-runs?search=${encodeURIComponent(temX2)}`, 'GET')
  check('[16] Search theo TEM PALLET → ra trang sổ chứa tem đó',
    sr.s === 200 && (sr.j?.data?.rows ?? []).some(r => r.id === mrun?.id), `http=${sr.s} n=${(sr.j?.data?.rows ?? []).length}`)

  const q0 = await api(`/wms/packing-logs?search=${TAG}X2&received=NO`, 'GET')
  check('[16] Pallet SX ghi sổ, kho chưa quét → nằm danh sách CHƯA NHẬN + missing_count đếm đúng',
    q0.s === 200 && (q0.j?.data?.rows ?? []).some(r => r.pallet_code === temX2) && Number(q0.j?.data?.missing_count) >= 1,
    `http=${q0.s} missing=${q0.j?.data?.missing_count}`)

  const { randomUUID } = await import('crypto')
  const invId = randomUUID()
  const matPool = (await restAll('Material', `select=id&material_code=eq.${FIX.MAT_POOL}&limit=1`))[0]
  // kho nhập 5 thùng trong khi sổ ghi 7 → phải nổi LỆCH SL (user duyệt 13/08: "số lượng chưa khớp
  // của pallet đó thì cũng đưa vào theo dõi ở sổ")
  await restWrite('InventoryEntry', 'POST', null, {
    id: invId, material_id: matPool?.id ?? null, pallet_code: temX2, warehouse_id: FIX.WH_QR.id, location_id: null,
    cartons_imported: 5, cartons_remaining: 5, cartons_reserved: 0, status: 'IN_STOCK', stack_layer: 1,
    import_date: today, notes: `${TAG} recon`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  })
  const q1 = await api(`/wms/packing-logs?search=${TAG}X2&received=YES`, 'GET')
  const hit = (q1.j?.data?.rows ?? []).find(r => r.pallet_code === temX2)
  check('[16] Kho quét nhập xong → pallet sang ĐÃ NHẬN kèm giờ kho nhận',
    q1.s === 200 && !!hit && !!hit.received_at, `http=${q1.s} received_at=${hit?.received_at ?? 'null'}`)
  const qd = await api(`/wms/packing-logs?search=${TAG}X2&received=DIFF`, 'GET')
  const dHit = (qd.j?.data?.rows ?? []).find(r => r.pallet_code === temX2)
  check('[16] Sổ ghi 7 / kho nhập 5 → nổi LỆCH SL (filter DIFF + diff_count + received_qty)',
    qd.s === 200 && !!dHit && dHit.is_qty_diff === true && Number(dHit.received_qty) === 5 && Number(qd.j?.data?.diff_count) >= 1,
    `http=${qd.s} diff_count=${qd.j?.data?.diff_count} received_qty=${dHit?.received_qty}`)
  await restWrite('InventoryEntry', 'DELETE', `id=eq.${invId}`)

  await api(`/wms/packing-runs/${mrun?.id}/close`, 'POST', {})
  if (yWin?.id) await api(`/wms/packing-runs/${yWin.id}/cancel`, 'POST', {})
}

// [17] SỐ THÙNG TỰ ĐIỀN THEO QUY CÁCH khi tem KHÔNG có lịch sử in (user 13/08 "số thùng phải
// tự nhảy theo quy cách") — nguồn SPEC (không phải MANUAL); dùng mã THẬT có khai quy cách.
{
  const mp = (await restAll('Material', `select=material_code,cartons_per_pallet&material_code=eq.${FIX.MAT_POOL}&limit=1`))[0]
  if (!mp?.cartons_per_pallet) console.log('ℹ️  bỏ qua [17] — mã fixture chưa khai quy cách thùng/pallet')
  else {
    await api('/wms/packing-runs', 'POST', { warehouse_id: WH, material_codes: [FIX.MAT_POOL], machine_code: 'MQ' })
    const r = await api('/wms/packing-logs/open', 'POST', { qr_code: tem(1, FIX.MAT_POOL) })
    check('[17] Tem không có lịch sử in → Số thùng TỰ ĐIỀN theo quy cách (nguồn SPEC)',
      r.s === 200 && Number(r.j?.data?.qty_cartons) === Number(mp.cartons_per_pallet) && r.j?.data?.qty_source === 'SPEC',
      `http=${r.s} qty=${r.j?.data?.qty_cartons} src=${r.j?.data?.qty_source} spec=${mp.cartons_per_pallet}`)
    if (r.j?.data?.id) await api(`/wms/packing-logs/${r.j.data.id}/cancel`, 'POST', {})
    const mq = await restAll('packing_runs', `select=id&warehouse_id=eq.${WH}&machine_code=eq.MQ&status=eq.OPEN`)
    for (const rr of mq) await api(`/wms/packing-runs/${rr.id}/cancel`, 'POST', {})
  }
}

// [15] IDOR CROSS-KHO (12/08 — bug thật: write theo id từng KHÔNG kiểm scope kho): user có đủ
// quyền packing nhưng scope kho KHÁC → đóng/sửa/hủy pallet + trang sổ của kho khác phải 403.
{
  const T5 = `${TAG}SCP`
  const cleanUser = async () => {
    for (const e of await restAll('Employee', `select=id&employee_code=like.*${T5}*`)) {
      await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${e.id}`).catch(() => {})
      await restWrite('Employee', 'DELETE', `id=eq.${e.id}`)
    }
    for (const j of await restAll('JobTitle', `select=id&name=like.*${T5}*`)) await restWrite('JobTitle', 'DELETE', `id=eq.${j.id}`)
  }
  const bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(m => m.default ?? m).catch(() => null)
  if (!bcrypt) console.log('ℹ️  bỏ qua [15] IDOR scope (không load được bcrypt của backend — chạy `npm i` trong backend)')
  else {
    await cleanUser()
    const { randomUUID } = await import('crypto')
    const now = () => new Date().toISOString()
    const jid = randomUUID(), eid = randomUUID()
    const pw = 'Qa' + randomUUID().slice(0, 10) + '!'   // dùng 1 lần, không in ra
    await restWrite('JobTitle', 'POST', '', [{
      id: jid, name: `${T5} chuc danh`,
      module_permissions: { packing: ['view', 'record', 'edit', 'cancel', 'open_run'] }, updated_at: now(),
    }])
    // user gán kho THẬT (WH_QR) — mục tiêu nằm ở kho QAPACKWH ⇒ ngoài scope
    await restWrite('Employee', 'POST', '', [{
      id: eid, employee_code: `${T5}01`, name: `${T5} nv`, email: `${T5.toLowerCase()}01@test.local`,
      password: await bcrypt.hash(pw, 10), is_active: true, job_title_id: jid, warehouse_id: FIX.WH_QR.id,
      warehouse_scope: 'ASSIGNED', updated_at: now(),
    }])
    await restWrite('UserWarehouseAccess', 'POST', '', [{ id: randomUUID(), employee_id: eid, warehouse_id: FIX.WH_QR.id }])
    const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${T5.toLowerCase()}01@test.local`, password: pw }) })
    const tk = (await lr.json())?.data?.token
    check('[15] login user scope hẹp (đủ quyền packing, kho khác)', !!tk, `http=${lr.status}`)
    if (tk) {
      // mục tiêu: 1 trang MỞ + 1 pallet MỞ ở kho QAPACKWH (admin tạo)
      const r7 = await openRun(`${TAG}7`, 'M9')
      const rid = r7.j?.data?.id
      const p7 = await api('/wms/packing-logs/open', 'POST', { qr_code: tem(3, `${TAG}7`) })
      const lid = p7.j?.data?.id
      const as5 = async (p, method, body) => {
        const r = await fetch(`${BASE}/api${p}`, {
          method, headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        })
        return r.status
      }
      const hits = [
        ['PATCH trang sổ', await as5(`/wms/packing-runs/${rid}`, 'PATCH', { shift: 'Ca 3' })],
        ['Giờ kết thúc trang', await as5(`/wms/packing-runs/${rid}/close`, 'POST', {})],
        ['Hủy trang', await as5(`/wms/packing-runs/${rid}/cancel`, 'POST', {})],
        ['PATCH pallet', await as5(`/wms/packing-logs/${lid}`, 'PATCH', { qty_cartons: 1 })],
        ['Đóng pallet', await as5(`/wms/packing-logs/${lid}/close`, 'POST', {})],
        ['Hủy pallet', await as5(`/wms/packing-logs/${lid}/cancel`, 'POST', {})],
      ]
      check('[15] cả 6 cửa write theo id kho ngoài scope → 403 (chống IDOR cross-kho)',
        hits.every(([, s]) => s === 403), hits.map(([n, s]) => `${n}=${s}`).join(' · '))
      // dọn mục tiêu: hủy pallet rồi đóng trang bằng ADMIN (cleanup() cuối cùng vẫn quét lại theo TAG)
      await api(`/wms/packing-logs/${lid}/cancel`, 'POST', {})
      await api(`/wms/packing-runs/${rid}/cancel`, 'POST', {})
    }
    await cleanUser()
  }
}

// [18] RULE ĐỐI CHIẾU user chốt 13/08 vòng 3: "CÓ trong sổ mà chưa nhập tồn → cảnh báo Ở SỔ ĐÓNG GÓI
// (rule PACKING_UNRECEIVED); KHÔNG có trong sổ thì KHÔNG SAO" ⇒ nhập kho quét pallet NGOÀI sổ (kể cả
// mã đang ghi sổ — ca dễ báo oan nhất: NCC/trung chuyển/return cùng mã) KHÔNG được kèm cảnh báo sổ.
{
  await resolveFixtures()
  const stF = await api('/wms/settings')
  const lblFlag = (stF.j?.data ?? []).find(s => s.key === 'label_format')?.value ?? 'underscore'
  if (!FIX.MAT_POOL_ID || !FIX.LOC_QR_ID || lblFlag !== 'underscore')
    console.log(`ℹ️  bỏ qua [18] (fixture mat=${!!FIX.MAT_POOL_ID} loc=${!!FIX.LOC_QR_ID} flag=${lblFlag} — cần tem V1)`)
  else {
    const temIn = tem(31, FIX.MAT_POOL), temOut = tem(32, FIX.MAT_POOL)
    // sổ đang ghi mã pool: mở trang QAPACKWH + ghi 1 pallet (temIn) — temOut là pallet NGOÀI sổ
    const r18 = await openRun(FIX.MAT_POOL, 'MW')
    const rid18 = r18.j?.data?.id
    const l18 = await api('/wms/packing-logs/open', 'POST', { qr_code: temIn, complete: true, qty_cartons: 5 })
    const lid18 = l18.j?.data?.id
    const c18 = await api('/wms/inbound-orders', 'POST', {
      warehouse_id: FIX.WH_QR.id, material_id: FIX.MAT_POOL_ID, planned_cartons: 20,
      source_type: 'FACTORY', notes: `${TAG} warn`,
    })
    const oF = c18.j?.data?.order ?? c18.j?.data
    check('[18] tạo phiếu FACTORY tại kho QR', !!oF?.id, `http=${c18.s}`)
    if (oF?.id) {
      const r = await api(`/wms/inbound-orders/${oF.id}/scan`, 'POST', { qr_code: temOut, location_id: FIX.LOC_QR_ID, cartons_override: 5 })
      const warn = (r.j?.data?.warnings ?? []).some(w => String(w).includes('Sổ đóng gói'))
      check('[18] quét nhập pallet NGOÀI sổ (mã đang ghi sổ) → KHÔNG cảnh báo (rule: không có trong sổ thì không sao)',
        r.s === 200 && !warn, `http=${r.s} warn=${warn}`)
      // dọn phiếu + pallet quét
      const g = await api(`/wms/inbound-orders/${oF.id}`)
      for (const e of (g.j?.data?.inventory_entries ?? [])) await api(`/wms/inbound-orders/${oF.id}/entries/${e.id}`, 'DELETE', {})
      await api(`/wms/inbound-orders/${oF.id}/cancel`, 'POST')
    }
    // filter Chu kỳ mới của tab Trang sổ (user 13/08): khớp partial + không khớp thì rỗng
    const fcHit = await api(`/wms/packing-runs?cycle=55&warehouse_id=${WH}`)
    const fcMiss = await api(`/wms/packing-runs?cycle=zz9x&warehouse_id=${WH}`)
    check('[18] filter Chu kỳ: khớp thấy trang, không khớp rỗng',
      fcHit.s === 200 && (fcHit.j?.data?.rows ?? []).some(r => r.id === rid18)
        && fcMiss.s === 200 && !(fcMiss.j?.data?.rows ?? []).some(r => r.id === rid18),
      `hit=${(fcHit.j?.data?.rows ?? []).length} miss=${(fcMiss.j?.data?.rows ?? []).length}`)
    // tab Sổ pallet cũng lọc được Chu kỳ (recon v3 join trang — user 13/08 "bộ filter đầy đủ")
    const flHit = await api(`/wms/packing-logs?cycle=55&warehouse_id=${WH}`)
    const flMiss = await api(`/wms/packing-logs?cycle=zz9x&warehouse_id=${WH}`)
    check('[18] filter Chu kỳ tab Sổ pallet: khớp thấy pallet, không khớp rỗng',
      flHit.s === 200 && (flHit.j?.data?.rows ?? []).some(r => r.id === lid18)
        && flMiss.s === 200 && !(flMiss.j?.data?.rows ?? []).some(r => r.id === lid18),
      `hit=${(flHit.j?.data?.rows ?? []).length} miss=${(flMiss.j?.data?.rows ?? []).length}`)
    if (lid18) await api(`/wms/packing-logs/${lid18}/cancel`, 'POST')
    if (rid18) await api(`/wms/packing-runs/${rid18}/cancel`, 'POST')
    // các tem [18] mang mã THẬT (không TAG trong pallet_code) — quét phòng thủ residue theo đúng tem
    for (const t of [temIn, temOut])
      await restWrite('InventoryEntry', 'DELETE', `pallet_code=eq.${encodeURIComponent(t)}`).catch(() => {})
  }
}

console.log('\n🧹 dọn…')
await cleanup()
const residueL = (await restAll('packing_logs', `select=id&pallet_code=like.*${TAG}*`)).length
const residueR = (await restAll('packing_runs', `select=id&warehouse_id=eq.${WH}`)).length
console.log(`residue logs=${residueL} runs=${residueR}`)
finish('PACKING')
