// GÓI TRACE-INVESTIGATE (tính năng 01/09, v2 cùng ngày — TRUY XUẤT THEO THÙNG):
// bắt buộc Ngày·Giờ·MÁY·CHU KỲ (mã hàng tùy chọn); tem pallet lệch được ±1–3 ngày so chữ in phun
// → GỢI Ý SỔ ĐÓNG GÓI theo Máy+Chu kỳ cửa sổ ±3 ngày, user BUỘC CHỌN 1 sổ → hành trình TOÀN
// CÔNG TY (lot_trace kind='codes' + lịch sử nhập mọi kho) → HỒ SƠ lưu vết.
// Gói tự dựng trang sổ + dòng sổ riêng (tag SIMTRC) nên không phụ thuộc dữ liệu nền, tự dọn 0 sót.
import { login, api, check, finish, restWrite, FIX } from './lib.mjs'
import { randomUUID } from 'crypto'

console.log('── GÓI TRACE-INVESTIGATE (truy xuất theo thùng · chọn sổ · hành trình) ──')
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

  // [1] Gợi ý sổ: đúng ngày + chu kỳ dạng chuẩn ("07" ≡ "7") → thấy sổ, kèm tên kho SX
  const r1 = await api(`/wms/trace/runs?machine=QA1&cycle=07&date=${WIN.date}`)
  const hit1 = (r1.j?.data ?? []).find(r => r.id === RUN_ID)
  check('[1] Tìm sổ theo Máy+Chu kỳ ("07"≡"7") đúng ngày → thấy sổ + tên kho SX',
    r1.s === 200 && !!hit1 && !!hit1.warehouse_name, `s=${r1.s} wh=${hit1?.warehouse_name ?? ''}`)

  // [1b] Ngày in phun LỆCH +2 ngày so ngày sổ (tem lệch 1-3 ngày) → sổ VẪN được gợi ý (cửa sổ ±3)
  const r1b = await api(`/wms/trace/runs?machine=QA1&cycle=7&date=2026-01-17`)
  check('[1b] Ngày lệch +2 vẫn gợi ý được sổ (cửa sổ ±3 ngày)',
    r1b.s === 200 && (r1b.j?.data ?? []).some(r => r.id === RUN_ID), `s=${r1b.s}`)

  // [1c] Ngày lệch +4 → NGOÀI cửa sổ, không gợi ý
  const r1c = await api(`/wms/trace/runs?machine=QA1&cycle=7&date=2026-01-19`)
  check('[1c] Ngày lệch +4 → ngoài cửa sổ ±3, không gợi ý',
    r1c.s === 200 && !(r1c.j?.data ?? []).some(r => r.id === RUN_ID), `s=${r1c.s}`)

  // [1d] Kho SX theo KÝ HIỆU NMSX (user bổ sung 01/09): B = Kho Ba Vì (WH_QR) thấy · D không thấy
  const r1d = await api(`/wms/trace/runs?machine=QA1&cycle=7&date=${WIN.date}&nmsx=b`)
  const r1e = await api(`/wms/trace/runs?machine=QA1&cycle=7&date=${WIN.date}&nmsx=D`)
  check('[1d] Ký hiệu kho SX "b" (Ba Vì, so không phân hoa-thường) → thấy · "D" → không',
    r1d.s === 200 && (r1d.j?.data ?? []).some(r => r.id === RUN_ID)
    && r1e.s === 200 && !(r1e.j?.data ?? []).some(r => r.id === RUN_ID),
    `s=${r1d.s}/${r1e.s}`)

  // [2] Xem sổ trước khi chọn: pallet + giờ từng pallet
  const r2 = await api(`/wms/trace/runs/${RUN_ID}`)
  check('[2] Xem sổ → có pallet + giờ thùng đầu/cuối',
    r2.s === 200 && (r2.j?.data?.pallets ?? []).some(p => p.pallet_code === PAL), `s=${r2.s}`)

  // [3] Truy theo sổ ĐÃ CHỌN: giờ trong cửa sổ → pallet gắn ★ time_hit; giờ ngoài → hit=false nhưng
  //     sổ vẫn truy được (kết quả theo SỔ user chọn, giờ chỉ để đánh dấu thùng nghi vấn)
  const GOOD = { run_id: RUN_ID, carton_date: WIN.date, carton_time: '08:10', machine_code: 'QA1', cycle: '07' }
  const p1 = await api('/wms/trace/investigations/preview', 'POST', GOOD)
  const m1 = (p1.j?.data?.matched ?? []).find(m => m.pallet_code === PAL)
  check('[3] Giờ 08:10 ∈ [08:00, 08:30] → pallet time_hit=★', p1.s === 200 && m1?.time_hit === true,
    `s=${p1.s} hit=${m1?.time_hit}`)
  const p2 = await api('/wms/trace/investigations/preview', 'POST', { ...GOOD, carton_time: '09:45' })
  const m2 = (p2.j?.data?.matched ?? []).find(m => m.pallet_code === PAL)
  check('[3b] Giờ 09:45 ngoài cửa sổ → pallet vẫn thuộc sổ nhưng time_hit=false',
    p2.s === 200 && m2?.time_hit === false, `s=${p2.s} hit=${m2?.time_hit}`)
  // [3c] NGÀY nhập lệch +2 so sổ (tem lệch ngày) nhưng giờ đúng → vẫn ★ (đo thật 01/09: ±1 trượt)
  const p3 = await api('/wms/trace/investigations/preview', 'POST', { ...GOOD, carton_date: '2026-01-17' })
  const m3 = (p3.j?.data?.matched ?? []).find(m => m.pallet_code === PAL)
  check('[3c] Ngày lệch +2, giờ đúng → time_hit vẫn ★ (dò ±3 ngày)',
    p3.s === 200 && m3?.time_hit === true, `s=${p3.s} hit=${m3?.time_hit}`)

  // [4] Input rác = 400 sạch: thiếu run_id / run_id rác / giờ rác / thiếu máy-chu kỳ / runs thiếu tham số
  const b1 = await api('/wms/trace/investigations/preview', 'POST', { carton_date: WIN.date, carton_time: '08:10', machine_code: 'QA1', cycle: '7' })
  const b2 = await api('/wms/trace/investigations/preview', 'POST', { ...GOOD, run_id: 'undefined' })
  const b3 = await api('/wms/trace/investigations/preview', 'POST', { ...GOOD, carton_time: '99:99' })
  const b4 = await api('/wms/trace/investigations/preview', 'POST', { ...GOOD, machine_code: '', cycle: '' })
  const b5 = await api('/wms/trace/runs?machine=QA1')
  check('[4] Thiếu/rác run_id · giờ rác · thiếu máy/chu kỳ · runs thiếu tham số → 400 (không 500)',
    b1.s === 400 && b2.s === 400 && b3.s === 400 && b4.s === 400 && b5.s === 400,
    `s=${b1.s}/${b2.s}/${b3.s}/${b4.s}/${b5.s}`)
  // [4b] run_id uuid ma → 404
  const b6 = await api('/wms/trace/investigations/preview', 'POST', { ...GOOD, run_id: '11111111-1111-1111-1111-111111111111' })
  check('[4b] Sổ uuid ma → 404', b6.s === 404, `s=${b6.s}`)

  // [5] Tạo hồ sơ (mã hàng BỎ TRỐNG — tùy chọn) kèm 1 ảnh PNG → 201; list + detail thấy; có run info
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const cr = await api('/wms/trace/investigations', 'POST', { ...GOOD, note: `${PAL} hồ sơ QA — tự dọn`, photos: [PNG] })
  invId = cr.j?.data?.id
  check('[5] Tạo hồ sơ 201 (mã hàng trống OK) + performed_by_name',
    cr.s === 201 && !!invId && !!cr.j?.data?.performed_by_name, `s=${cr.s} by=${cr.j?.data?.performed_by_name ?? ''}`)
  const ls = await api(`/wms/trace/investigations?search=${PAL}`)
  const row = (ls.j?.data?.rows ?? []).find(r => r.id === invId)
  check('[5b] List thấy hồ sơ + mang thông tin SỔ (trace->run)',
    ls.s === 200 && !!row && row.run?.id === RUN_ID, `s=${ls.s} run=${row?.run?.id === RUN_ID}`)
  const dt = await api(`/wms/trace/investigations/${invId}`)
  check('[5c] Detail có signed URL ảnh + lịch sử nhập (trace.inbound là mảng)',
    dt.s === 200 && (dt.j?.data?.photo_urls ?? []).length === 1 && Array.isArray(dt.j?.data?.trace?.inbound),
    `s=${dt.s} urls=${dt.j?.data?.photo_urls?.length} inbound=${Array.isArray(dt.j?.data?.trace?.inbound)}`)

  // [6] Ảnh rác → 422, không tạo hồ sơ mồ côi
  const badImg = await api('/wms/trace/investigations', 'POST', { ...GOOD, note: `${PAL} rác`, photos: ['data:text/html;base64,PGI+'] })
  check('[6] Ảnh rác → 422 BAD_PHOTO', badImg.s === 422, `s=${badImg.s} code=${badImg.j?.error?.code ?? ''}`)

  // [8] Gợi ý "giá trị cần tìm" (dropdown tìm-trên-server, user chốt 01/09 tối): tem theo TIỀN TỐ
  //     thấy pallet seed; kind rác → 400; kiểu quét bảng lớn mà không có từ khóa → mảng rỗng
  const sg1 = await api(`/wms/trace/suggest?kind=pallet&search=SIMTRC`)
  const sg2 = await api(`/wms/trace/suggest?kind=xxx&search=a`)
  const sg3 = await api(`/wms/trace/suggest?kind=npp`)
  check('[8] Suggest: tiền tố tem thấy pallet · kind rác 400 · npp không từ khóa → rỗng',
    sg1.s === 200 && (sg1.j?.data ?? []).some(o => o.value === PAL)
    && sg2.s === 400 && sg3.s === 200 && (sg3.j?.data ?? []).length === 0,
    `s=${sg1.s}/${sg2.s}/${sg3.s} n=${sg1.j?.data?.length}`)

  // [7] :id rác → 400 · uuid ma → 404 (luật route :param, gói 07)
  const g1 = await api('/wms/trace/investigations/undefined')
  const g2 = await api('/wms/trace/investigations/11111111-1111-1111-1111-111111111111')
  const g3 = await api('/wms/trace/runs/undefined')
  check('[7] :id rác 400 · uuid ma 404 (cả hồ sơ lẫn sổ)', g1.s === 400 && g2.s === 404 && g3.s === 400,
    `s=${g1.s}/${g2.s}/${g3.s}`)
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
