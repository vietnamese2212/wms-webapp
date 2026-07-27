// GÓI QR-FORMAT — quét V1 (`_`) / V2 (`;`) qua API theo cờ label_format, không cần camera.
// Mặc định: test Ở TRẠNG THÁI CỜ HIỆN TẠI (format đúng phải NHẬN + lưu nguyên văn, format kia phải 422).
// `--flip`: lật cờ test cả 2 chiều rồi TRẢ VỀ như cũ — ⚠ trong ~1 phút lật, user thật đang quét sẽ bị 422.
//   CHỈ chạy --flip ngoài giờ vận hành.
import { login, api, check, finish, restAll, resolveFixtures, HAS_DB, FIX } from './lib.mjs'

const FLIP = process.argv.includes('--flip')
// Vị trí + mã hàng RESOLVE theo dữ liệu thật (id cứng chết sau mỗi lần reset dữ liệu)
let LOC = ''
// Chuỗi QR hợp lệ 2 format cho mã pool test (V2 GIỮ đệm space như tem nhà máy)
const V2 = `${FIX.MAT_POOL};      1;QA260709A099;09/07/2026;09/01/2027;      1;00:00`
const V1 = `090726_${FIX.MAT_POOL}_C01_M1_001_B`

console.log(`── GÓI QR-FORMAT${FLIP ? ' (--flip: test cả 2 cờ)' : ' (cờ hiện tại)'} ──`)
await login()
await resolveFixtures()
LOC = FIX.LOC_QR_ID

const st = await api('/wms/settings')
const flag = (st.j?.data ?? []).find(s => s.key === 'label_format')?.value ?? 'underscore'
console.log(`  cờ label_format hiện tại = ${flag}`)

// Phiếu nhập tại kho QR Ba Vì để có chỗ quét
async function createOrder() {
  const c = await api('/wms/inbound-orders', 'POST', {
    warehouse_id: FIX.WH_QR.id, material_id: FIX.MAT_POOL_ID,
    planned_cartons: 10, source_type: 'FACTORY', notes: 'QA-QRFORMAT',
  })
  return c.j?.data?.order ?? c.j?.data
}
async function cancelOrder(id) {
  const g = await api(`/wms/inbound-orders/${id}`)
  const entries = g.j?.data?.inventory_entries ?? []
  for (const e of entries) await api(`/wms/inbound-orders/${id}/entries/${e.id}`, 'DELETE', {})
  return (await api(`/wms/inbound-orders/${id}/cancel`, 'POST')).s === 200
}
// Cặp check theo cờ đang bật: goodQR phải qua, badQR phải 422
async function checkPair(orderId, label, goodQR, badQR) {
  const okR = await api(`/wms/inbound-orders/${orderId}/check-scan`, 'POST', { qr_code: goodQR, location_id: LOC })
  check(`${label}: format ĐÚNG được nhận`, okR.s === 200, `http=${okR.s} ${JSON.stringify(okR.j?.error ?? '').slice(0, 100)}`)
  const badR = await api(`/wms/inbound-orders/${orderId}/check-scan`, 'POST', { qr_code: badQR, location_id: LOC })
  check(`${label}: format SAI bị chặn 422`, badR.s === 422 && badR.j?.error?.code === 'QR_FORMAT_MISMATCH', `http=${badR.s} code=${badR.j?.error?.code}`)
}

const ord = await createOrder()
check('Tạo phiếu nhập tại kho QR', !!ord?.id, ord?.import_code ?? '')
if (!ord?.id) finish('QR-FORMAT')

const [goodQR, badQR] = flag === 'semicolon' ? [V2, V1] : [V1, V2]
await checkPair(ord.id, `Cờ ${flag}`, goodQR, badQR)

// Quét THẬT format đúng → verify DB lưu nguyên văn + field bóc tách
const sc = await api(`/wms/inbound-orders/${ord.id}/scan`, 'POST', { qr_code: goodQR, location_id: LOC })
check('Quét thật format đúng → tạo pallet', sc.s === 200, `http=${sc.s} ${JSON.stringify(sc.j?.error ?? '').slice(0, 120)}`)
const dup = await api(`/wms/inbound-orders/${ord.id}/scan`, 'POST', { qr_code: goodQR, location_id: LOC })
check('Quét TRÙNG bị chặn', dup.s !== 200, `http=${dup.s}`)
if (HAS_DB) {
  const rows = await restAll('InventoryEntry', `select=pallet_code,batch,expiry_date&import_order_id=eq.${ord.id}`)
  const e = rows[0]
  check('pallet_code lưu NGUYÊN VĂN (giữ đệm space)', e?.pallet_code === goodQR.trim(),
    e ? `"${(e.pallet_code ?? '').slice(0, 40)}…"` : 'không thấy entry')
  if (flag === 'semicolon')
    check('V2 bóc batch + HSD đúng', e?.batch === 'QA260709A099' && e?.expiry_date === '2027-01-09',
      `batch=${e?.batch} hsd=${e?.expiry_date}`)
}
check('Dọn phiếu + pallet quét', await cancelOrder(ord.id))

// --flip: lật cờ test chiều ngược rồi TRẢ LẠI
if (FLIP) {
  const other = flag === 'semicolon' ? 'underscore' : 'semicolon'
  console.log(`  ⚠ lật cờ → ${other} (chờ 35s cache)…`)
  await api('/wms/settings/label_format', 'PUT', { value: other })
  await new Promise(r => setTimeout(r, 35_000))
  const ord2 = await createOrder()
  const [good2, bad2] = other === 'semicolon' ? [V2, V1] : [V1, V2]
  await checkPair(ord2.id, `Cờ ${other}`, good2, bad2)
  check('Dọn phiếu (flip)', await cancelOrder(ord2.id))
  await api('/wms/settings/label_format', 'PUT', { value: flag })
  await new Promise(r => setTimeout(r, 35_000))
  const st2 = await api('/wms/settings')
  const restored = (st2.j?.data ?? []).find(s => s.key === 'label_format')?.value
  check(`TRẢ CỜ về ${flag}`, restored === flag, `hiện = ${restored}`)
  // xác nhận chiều quét đã hồi
  const ord3 = await createOrder()
  const okBack = await api(`/wms/inbound-orders/${ord3.id}/check-scan`, 'POST', { qr_code: goodQR, location_id: LOC })
  check('Sau trả cờ: format cũ nhận lại bình thường', okBack.s === 200, `http=${okBack.s}`)
  check('Dọn phiếu (restore)', await cancelOrder(ord3.id))
}

finish('QR-FORMAT')
