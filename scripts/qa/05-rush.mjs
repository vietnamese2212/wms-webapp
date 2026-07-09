// GÓI RUSH — "giờ cao điểm": 4 nhóm thao tác THẬT chạy đồng thời ~2', ~25 in-flight.
// Không nằm trong run-all mặc định (nặng) — chạy tay trước go-live: node scripts/qa/05-rush.mjs
// Trong lúc chạy nên mở app refresh vài lần (không được văng /login). Kết thúc: tự dọn + tự check bất biến.
import { login, api, check, finish, pool, restAll, teardownGdo, cleanupTagged, FIX } from './lib.mjs'

console.log('── GÓI RUSH (giờ cao điểm ~2 phút) ──')
await login()

async function poolRemaining() {
  const rows = await restAll('InventoryEntry',
    `select=cartons_remaining&warehouse_id=eq.${FIX.WH_QTY.id}&pallet_code=eq.${FIX.MAT_POOL}`)
  return rows.reduce((s, r) => s + Number(r.cartons_remaining ?? 0), 0)
}
const pool0 = await poolRemaining()
console.log(`  pool baseline = ${pool0}`)
const errs = []
const t0 = Date.now()

// A. 8 người tạo & xuất luôn (kho NONE — không đụng pool)
const groupA = Array.from({ length: 8 }, (_, k) => async () => {
  const q = await api('/wms/outbound/quick-export', 'POST', {
    delivery_date: FIX.DATE, warehouse_id: FIX.WH_NONE.id, dvvt: FIX.DVVT_TAG,
    delivery_code: `RUSH-A${k}-` + Math.floor(Math.random() * 1e6), license_plate: '88A-' + (100 + k),
    customer_name: 'RUSH KH ' + k, items: [{ material_code: FIX.MAT_POOL, cartons_ordered: 1 + (k % 3) }],
  })
  if (q.s !== 201) errs.push(`A${k}:${q.s}`)
})

// B. 6 người nhập kho (tạo phiếu + nhập tay + hủy) — đụng pool 510000306@Bluestar 2 chiều
const groupB = Array.from({ length: 6 }, (_, k) => async () => {
  const c = await api('/wms/inbound-orders', 'POST', {
    warehouse_id: FIX.WH_QTY.id, material_id: '4a55517f-a069-4f43-a889-376eb285cfce',
    planned_cartons: 3, source_type: 'FACTORY', notes: 'QA-RUSH',
  })
  const ord = c.j?.data?.order ?? c.j?.data
  if (!ord?.id) { errs.push(`B${k}:create:${c.s}`); return }
  const sm = await api(`/wms/inbound-orders/${ord.id}/scan-manual`, 'POST', { cartons: 3 })
  if (sm.s !== 200) errs.push(`B${k}:scan:${sm.s}`)
  const g = await api(`/wms/inbound-orders/${ord.id}`)
  for (const e of (g.j?.data?.inventory_entries ?? []))
    await api(`/wms/inbound-orders/${ord.id}/entries/${e.id}`, 'DELETE', {})
  const cx = await api(`/wms/inbound-orders/${ord.id}/cancel`, 'POST')
  if (cx.s !== 200) errs.push(`B${k}:cancel:${cx.s}`)
})

// C. 4 người xuất kho QTY (tạo PENDING → Xuất luôn → gỡ HT → xuất lại → dọn)
const groupC = Array.from({ length: 4 }, (_, k) => async () => {
  const c = await api('/wms/outbound', 'POST', {
    delivery_date: FIX.DATE, warehouse_id: FIX.WH_QTY.id, dvvt: FIX.DVVT_TAG,
    customer_name: 'An Sơn', shipto_party: FIX.WH_NONE.code,
    delivery_code: `RUSH-C${k}-` + Math.floor(Math.random() * 1e6),
    items: [{ material_code: FIX.MAT_POOL, cartons_ordered: 2 }],
  })
  const gdo = c.j?.data
  if (!gdo?.id) { errs.push(`C${k}:create:${c.s}`); return }
  const q1 = await api(`/wms/outbound/${gdo.id}/quick-export`, 'POST', { license_plate: '88C-' + k })
  if (q1.s !== 200) errs.push(`C${k}:qe1:${q1.s}`)
  await api(`/wms/outbound/${gdo.id}/uncomplete`, 'POST')
  const q2 = await api(`/wms/outbound/${gdo.id}/quick-export`, 'POST', { license_plate: '88C-' + k })
  if (q2.s !== 200) errs.push(`C${k}:qe2:${q2.s}`)
  if (!(await teardownGdo(gdo.id, 'COMPLETED'))) errs.push(`C${k}:teardown`)
})

// D. 3 bảo vệ cổng (đăng ký → gọi → vào → ra → dọn)
const groupD = Array.from({ length: 3 }, (_, k) => async () => {
  const c = await api('/tms/gate-registrations', 'POST', {
    date: FIX.DATE, warehouse_id: FIX.WH_QR.id, direction: 'INBOUND',
    license_plate: '88D-' + (200 + k), vehicle_type: 'TAI', company_name_raw: 'QA RUSH', driver_name: 'QA',
  })
  const g = c.j?.data
  if (!g?.id) { errs.push(`D${k}:create:${c.s}`); return }
  for (const step of ['call', 'entry', 'exit']) {
    const r = await api(`/tms/gate-registrations/${g.id}/${step}`, 'PATCH')
    if (r.s !== 200) errs.push(`D${k}:${step}:${r.s}`)
  }
  for (const step of ['revert-exit', 'revert-entry', 'revert-call']) await api(`/tms/gate-registrations/${g.id}/${step}`, 'PATCH')
  const del = await api(`/tms/gate-registrations/${g.id}`, 'DELETE')
  if (del.s !== 200) errs.push(`D${k}:del:${del.s}`)
})

// E. 6 "người xem" GET dồn dập trong lúc trên chạy
const groupE = Array.from({ length: 6 }, (_, k) => async () => {
  for (let i = 0; i < 5; i++) {
    const paths = ['/wms/outbound?date_from=' + FIX.DATE + '&date_to=' + FIX.DATE, '/wms/inbound-orders?limit=20',
      '/wms/inventory?limit=50', '/tms/orders?source_type=TRANSFER&date_from=2026-12-01', '/tms/gate-registrations']
    const r = await api(paths[(k + i) % paths.length])
    if (r.s !== 200) errs.push(`E${k}.${i}:${r.s}`)
  }
})

await pool([...groupA, ...groupB, ...groupC, ...groupD, ...groupE], 25)
const sec = ((Date.now() - t0) / 1000).toFixed(1)
check(`Rush ${8 + 6 + 4 + 3 + 6} luồng đồng thời không lỗi`, errs.length === 0, `${sec}s${errs.length ? ' · lỗi: ' + errs.slice(0, 8).join(' ') : ''}`)

// Dọn nhóm A còn lại (nhóm B/C/D tự dọn trong luồng)
const cleaned = await cleanupTagged()
check('Dọn đơn rush còn lại', true, `xóa ${cleaned}`)
const p1 = await poolRemaining()
check('Pool về baseline sau rush', p1 === pool0, `${pool0} → ${p1}`)

finish('RUSH')
