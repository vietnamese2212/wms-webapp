// GÓI SMOKE — mỗi module chính 1 GET + chu trình CRUD Outbound (tạo → sửa → xóa, tự dọn).
import { login, api, check, finish, FIX } from './lib.mjs'

console.log('── GÓI SMOKE ──')
await login()
check('Login admin', true)

// GET các list chính (đủ 200 + shape data)
const GETS = [
  ['Outbound list',        `/wms/outbound?date_from=${FIX.DATE}&date_to=${FIX.DATE}`],
  // Đi MODE PHÂN TRANG (?page=) như FE thật: staging dữ liệu lớn ~900 phiếu/ngày → mode mảng cũ
  // không kèm đủ lọc bị guard RANGE_TOO_WIDE 400 CHỦ ĐÍCH (chặn-có-hướng-dẫn, không cắt âm thầm).
  ['Inbound list',         `/wms/inbound-orders?page=1&limit=20&date_from=${new Date(Date.now() - 7 * 86400e3).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })}&date_to=${FIX.EXEC_DATE}`],
  ['Inventory list',       '/wms/inventory?limit=20'],
  ['Inventory facets',     '/wms/inventory/facets'],
  ['TMS transfer list',    `/tms/orders?source_type=TRANSFER&date_from=${FIX.DATE}`],
  ['TMS vehicle types',    '/tms/vehicle-types'],
  ['TMS transport cty',    '/tms/transport-companies'],
  // Phải kèm ngày: không param = cả bảng → khi staging tích ≥3.352 bản ghi thì guard
  // RANGE_TOO_WIDE trả 400 CHỦ ĐÍCH (đúng luật chặn-có-hướng-dẫn) — smoke đỏ oan (đo 10/08)
  ['Gate registrations',   `/tms/gate-registrations?date=${FIX.EXEC_DATE}`],
  ['Materials',            '/masterdata/materials'],
  ['Warehouses',           '/masterdata/warehouses'],
  ['System settings',      '/wms/settings'],
  // Lịch sử quét KHOẢNG RỘNG 90 ngày — bug 10/08: RPC get_outbound_scan_log (LANGUAGE sql,
  // lọc ngày non-sargable, COUNT(*) OVER()) chết 500/8s khi bảng đạt 150k dòng; fix = plpgsql
  // + cận ngày sargable (migration 20260810_scanlog_rpc_perf). Check này gác hồi quy 500;
  // gác HIỆU NĂNG ở quy mô lớn = mục 'Lịch sử quét 90n' trong 06-readload (chạy tay/pre-go-live).
  ['Scan-log 90 ngày',     `/wms/outbound/scan-log?from_date=${new Date(Date.now() - 90 * 86400e3).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })}&to_date=${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })}&page=1&limit=100`],
]
for (const [name, path] of GETS) {
  const r = await api(path)
  check(`GET ${name}`, r.s === 200 && r.j?.success !== false, `http=${r.s}`)
}

// CRUD Outbound: tạo PENDING → sửa số lượng → xóa (không đụng tồn)
const c = await api('/wms/outbound', 'POST', {
  delivery_date: FIX.DATE, warehouse_id: FIX.WH_NONE.id, dvvt: FIX.DVVT_TAG,
  customer_name: 'QA SMOKE', delivery_code: 'SMOKE-' + Math.floor(Math.random() * 1e9),
  items: [{ material_code: FIX.MAT_POOL, cartons_ordered: 1 }],
})
const gdo = c.j?.data
check('Tạo đơn xuất PENDING', c.s === 201 && gdo?.status === 'PENDING', `http=${c.s}`)

if (gdo?.id) {
  const item = gdo.delivery_orders?.[0]?.items?.[0]
  const u = await api(`/wms/outbound/${gdo.id}`, 'PUT', {
    delivery_date: FIX.DATE, warehouse_id: FIX.WH_NONE.id, dvvt: FIX.DVVT_TAG,
    customer_name: 'QA SMOKE',
    items: [{ db_id: item?.id, material_code: FIX.MAT_POOL, cartons_ordered: 3, npp: 'QA SMOKE' }],
  })
  const after = u.j?.data?.delivery_orders?.[0]?.items?.[0]
  check('Sửa đơn 1→3 thùng', u.s === 200 && Number(after?.cartons_ordered) === 3, `http=${u.s} cartons=${after?.cartons_ordered}`)
  const del = await api(`/wms/outbound/${gdo.id}`, 'DELETE')
  check('Xóa đơn PENDING', del.s === 200, `http=${del.s}`)
  const gone = await api(`/wms/outbound/${gdo.id}`, 'GET')
  check('Đơn đã biến mất sau xóa', gone.s === 404 || gone.j?.success === false, `http=${gone.s}`)
}

finish('SMOKE')
