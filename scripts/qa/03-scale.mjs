// GÓI SCALE — seed N đơn xuất + lệnh chuyển kho, đo latency/payload các list, rồi DỌN SẠCH.
// node 03-scale.mjs [N]  (mặc định 300; seed vào kho NONE An Sơn — không đụng tồn thật)
import { login, api, check, finish, pool, cleanupTagged, FIX } from './lib.mjs'

const N = Number(process.argv[2] ?? 300)
const LIST_MS_LIMIT = 3000      // ngưỡng chấp nhận cho list
const PAYLOAD_LIMIT = 5 * 1024 * 1024

console.log(`── GÓI SCALE (N=${N}) ──`)
await login()

// Seed
const t0 = Date.now()
const rs = await pool(Array.from({ length: N }, (_, k) => () =>
  api('/wms/outbound/quick-export', 'POST', {
    delivery_date: FIX.DATE, warehouse_id: FIX.WH_NONE.id, dvvt: FIX.DVVT_TAG,
    delivery_code: `SC-${k}-` + Math.floor(Math.random() * 1e6), license_plate: '88S-' + (1000 + k),
    customer_name: 'QA SCALE ' + k,
    items: [{ material_code: FIX.MAT_POOL, cartons_ordered: 1 + (k % 5) }],
  })), 20)
const seeded = rs.filter(r => r.s === 201).length
const seedSec = (Date.now() - t0) / 1000
check(`Seed ${N} đơn (20 in-flight)`, seeded >= N * 0.95,
  `OK=${seeded}/${N} · ${seedSec.toFixed(1)}s · ${(seeded / seedSec).toFixed(1)} đơn/s`)

// Đo các list nóng
async function measure(name, path) {
  const times = []
  let bytes = 0, rows = -1
  for (let i = 0; i < 3; i++) {
    const s = Date.now()
    const r = await api(path)
    times.push(Date.now() - s)
    bytes = r.bytes
    rows = Array.isArray(r.j?.data) ? r.j.data.length : (r.j?.data?.items?.length ?? -1)
  }
  const best = Math.min(...times)
  check(`${name} < ${LIST_MS_LIMIT / 1000}s & < 5MB`, best < LIST_MS_LIMIT && bytes < PAYLOAD_LIMIT,
    `${times.join('/')}ms · rows=${rows} · ${(bytes / 1024).toFixed(0)}KB`)
}
await measure('TMS transfer list (cửa sổ ngày)', `/tms/orders?source_type=TRANSFER&date_from=2026-01-01`)
await measure('Outbound list (ngày test)', `/wms/outbound?date_from=${FIX.DATE}&date_to=${FIX.DATE}`)
await measure('Inventory list', '/wms/inventory?limit=100')
await measure('Inventory facets', '/wms/inventory/facets')

// Dọn sạch
const t1 = Date.now()
const cleaned = await cleanupTagged()
check('Dọn sạch toàn bộ đơn seed', cleaned >= seeded,
  `xóa ${cleaned} · ${((Date.now() - t1) / 1000).toFixed(1)}s`)

finish('SCALE')
