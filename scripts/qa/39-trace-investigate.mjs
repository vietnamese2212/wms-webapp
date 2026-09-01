// GÓI TRACE-INVESTIGATE (tính năng 01/09 — điều tra truy vết theo THÙNG):
// khiếu nại đến từ một thùng khách đang cầm (chỉ có chữ in phun) → nhập giờ + mã hàng (+ máy,
// chu kỳ) → đối chiếu SỔ ĐÓNG GÓI (khoảng giờ thùng đầu→cuối của từng pallet) → pallet nghi vấn
// → lot_trace(kind='codes') → HỒ SƠ lưu vết. User chốt: khớp ĐÚNG khoảng giờ, KHÔNG nới ±.
// Gói tự dựng trang sổ + dòng sổ riêng (tag SIMTRC) nên không phụ thuộc dữ liệu nền, tự dọn 0 sót.
import { login, api, check, finish, restWrite, FIX } from './lib.mjs'
import { randomUUID } from 'crypto'

console.log('── GÓI TRACE-INVESTIGATE (điều tra theo thùng · hồ sơ truy vết) ──')
await login()

const PAL = `SIMTRC_${Math.floor(Math.random() * 1e6)}`
const RUN_ID = randomUUID()
const NOW = new Date().toISOString()
// Cửa sổ giờ SX cố định: 01:00→01:30 UTC = 08:00→08:30 giờ VN ngày 15-01-2026 (quá khứ xa, không đụng data thật)
const WIN = { date: '2026-01-15', from: '2026-01-15T01:00:00+00:00', to: '2026-01-15T01:30:00+00:00' }

let invId = null
try {
  await restWrite('packing_runs', 'POST', null, {
    id: RUN_ID, warehouse_id: FIX.WH_QR.id, run_date: WIN.date, shift: 'CA1', cycle: '7',
    material_code: FIX.MAT_POOL, machine_code: 'QA1', start_at: WIN.from, status: 'CLOSED',
    created_at: NOW, updated_at: NOW,
  })
  await restWrite('packing_logs', 'POST', null, {
    id: randomUUID(), pallet_code: PAL, material_code: FIX.MAT_POOL, machine_code: 'QA1',
    warehouse_id: FIX.WH_QR.id, qty_cartons: 10, status: 'CLOSED', run_id: RUN_ID,
    open_scan_at: WIN.from, prod_start_at: WIN.from, prod_end_at: WIN.to,
    created_at: NOW, updated_at: NOW,
  })

  const GOOD = { carton_date: WIN.date, carton_time: '08:10', material_code: FIX.MAT_POOL, machine_code: 'QA1', cycle: '07' }

  // [1] Giờ trong cửa sổ + chu kỳ so DẠNG CHUẨN ("07" ≡ "7") → khớp đúng pallet của sổ
  const p1 = await api('/wms/trace/investigations/preview', 'POST', GOOD)
  check('[1] Giờ 08:10 ∈ [08:00, 08:30] + chu kỳ "07"≡"7" → khớp pallet',
    p1.s === 200 && (p1.j?.data?.matched ?? []).some(m => m.pallet_code === PAL),
    `s=${p1.s} matched=${(p1.j?.data?.matched ?? []).map(m => m.pallet_code).join(',')}`)

  // [2] Ngoài cửa sổ → 0 khớp (user chốt: khớp ĐÚNG khoảng, không nới ±)
  const p2 = await api('/wms/trace/investigations/preview', 'POST', { ...GOOD, carton_time: '08:45' })
  check('[2] Giờ 08:45 ngoài cửa sổ → 0 pallet (không nới ±)',
    p2.s === 200 && !(p2.j?.data?.matched ?? []).some(m => m.pallet_code === PAL), `s=${p2.s}`)

  // [3] Máy sai → 0 khớp
  const p3 = await api('/wms/trace/investigations/preview', 'POST', { ...GOOD, machine_code: 'ZZZ9' })
  check('[3] Máy không đúng → 0 pallet',
    p3.s === 200 && !(p3.j?.data?.matched ?? []).some(m => m.pallet_code === PAL), `s=${p3.s}`)

  // [4] Input rác = 400 sạch (ngày sai lịch / giờ rác / body rỗng — không 500)
  const b1 = await api('/wms/trace/investigations/preview', 'POST', { carton_date: '2026-13-45', carton_time: '08:10', material_code: 'X' })
  const b2 = await api('/wms/trace/investigations/preview', 'POST', { carton_date: WIN.date, carton_time: '99:99', material_code: 'X' })
  const b3 = await api('/wms/trace/investigations/preview', 'POST', {})
  check('[4] Ngày rác / giờ rác / body rỗng → 400 (không 500)',
    b1.s === 400 && b2.s === 400 && b3.s === 400, `s=${b1.s}/${b2.s}/${b3.s}`)

  // [5] Tạo hồ sơ (kèm 1 ảnh PNG hợp lệ) → 201, đứng tên người thực hiện; list + detail thấy
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const cr = await api('/wms/trace/investigations', 'POST', { ...GOOD, note: `${PAL} hồ sơ QA — tự dọn`, photos: [PNG] })
  invId = cr.j?.data?.id
  check('[5] Tạo hồ sơ 201 + performed_by_name', cr.s === 201 && !!invId && !!cr.j?.data?.performed_by_name,
    `s=${cr.s} by=${cr.j?.data?.performed_by_name ?? ''}`)
  const ls = await api(`/wms/trace/investigations?search=${PAL}`)
  check('[5b] List tìm theo tag thấy hồ sơ', ls.s === 200 && (ls.j?.data?.rows ?? []).some(r => r.id === invId), `s=${ls.s}`)
  const dt = await api(`/wms/trace/investigations/${invId}`)
  check('[5c] Detail có signed URL ảnh (bucket riêng tư)',
    dt.s === 200 && (dt.j?.data?.photo_urls ?? []).length === 1, `s=${dt.s} urls=${dt.j?.data?.photo_urls?.length}`)

  // [6] Ảnh rác (không phải data URL ảnh) → 422, KHÔNG tạo hồ sơ mồ côi
  const badImg = await api('/wms/trace/investigations', 'POST', { ...GOOD, note: `${PAL} rác`, photos: ['data:text/html;base64,PGI+'] })
  check('[6] Ảnh rác → 422 BAD_PHOTO', badImg.s === 422, `s=${badImg.s} code=${badImg.j?.error?.code ?? ''}`)

  // [7] :id rác → 400 · uuid ma → 404 (luật route :param, gói 07)
  const g1 = await api('/wms/trace/investigations/undefined')
  const g2 = await api('/wms/trace/investigations/11111111-1111-1111-1111-111111111111')
  check('[7] :id rác 400 · uuid ma 404 (không 500)', g1.s === 400 && g2.s === 404, `s=${g1.s}/${g2.s}`)
} finally {
  // Dọn 0 sót: ảnh storage → hồ sơ → dòng sổ → trang sổ (ảnh trước, kẻo orphan trong bucket)
  if (invId) {
    try {
      const { readFileSync } = await import('fs')
      const env = Object.fromEntries(readFileSync(new URL('../../backend/.env', import.meta.url), 'utf8')
        .split(/\r?\n/).map(l => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/)).filter(Boolean).map(m => [m[1], m[2]]))
      if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
        await fetch(`${env.SUPABASE_URL}/storage/v1/object/trace-photos/${invId}/1.png`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } })
    } catch { /* thiếu .env → ảnh 70 byte nằm lại, không chặn gói */ }
  }
  await restWrite('trace_investigations', 'DELETE', `note=like.*SIMTRC*`).catch(() => {})
  await restWrite('packing_logs', 'DELETE', `pallet_code=eq.${PAL}`).catch(() => {})
  await restWrite('packing_runs', 'DELETE', `id=eq.${RUN_ID}`).catch(() => {})
}
finish('TRACE-INVESTIGATE')
