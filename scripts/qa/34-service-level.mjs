// GÓI 34 — CHẤT LƯỢNG PHỤC VỤ (fill rate / OTIF), khoá 2 lỗi tìm được 30/08.
//
// [1] MỨC ĐÃ HẠ KHÔNG ĐƯỢC CỘNG LẶP. Nhu cầu GỐC dựng lại = số hiện tại + mức đã bị hạ. Bản đầu
//     gom vết theo (chuyến, mã hàng) rồi ghép vào TỪNG DÒNG, trong khi "NPP là khóa tách dòng" nên
//     cùng một mã nằm trên nhiều dòng là chuyện thường (đo staging: 218 chuyến). Hậu quả: nhu cầu
//     gốc gấp đôi ⇒ dòng giao ĐỦ bị tính thành GIAO THIẾU — sai theo hướng VU OAN kho.
//     Phép kiểm dựng đúng tình huống đó: một mã, hai DO, thêm MỘT vết hạ trên MỘT DO.
// [2] BA Ô % PHẢI ĐƯỢC LÀM TRÒN. `round(x, 1) / y` làm tròn tử số (vô tác dụng) rồi mới chia ⇒ trả
//     16-18 chữ số thập phân. Giao diện che bằng `.toFixed(1)`, nên phải kiểm ở NGUỒN.
//     ⚠️ Phép kiểm này CHỈ cắn khi dữ liệu cho ra tỷ lệ LẺ. Staging hiện 3.129/3.129 chuyến đúng
//     hạn và giao đủ ⇒ mọi ô đều đúng 100 chẵn, nên nó xanh với CẢ bản lỗi (đã thử 30/08). Chốt
//     chặn thật cho lỗi này là ratchet `sql_round_before_divide` ở gói 09 — đừng tin mỗi mục [2].
// [3] MẪU SỐ CHẤM SAO phải là chuyến THUỘC DIỆN CHẤM, không phải mọi chuyến (luật 28/08).
//
// Chỉ ghi đúng 1 dòng `outbound_events` mang TAG rồi xoá — không đụng chuyến/đơn nào.
import { randomUUID } from 'crypto'
import { restAll, restWrite, restRpc, check, finish, BASE } from './lib.mjs'

const TAG = 'SIMSVC'
const CUT = 50
const cleanup = () => restWrite('outbound_events', 'DELETE', `actor=eq.${TAG}`).catch(() => {})

console.log(`── CHẤT LƯỢNG PHỤC VỤ · ${BASE.replace('https://', '')} ──`)
await cleanup()

// Tìm một chuyến ĐÃ HOÀN THÀNH có cùng MÃ trên 2 DO khác nhau (đúng hình dạng gây lỗi)
const gdos = await restAll('GroupDeliveryOrder',
  'select=id,group_code,warehouse_id,delivery_date,deliveries:OutboundDelivery(delivery_code,items:OutboundItem(material_code_raw))'
  + '&status=eq.COMPLETED&order=delivery_date.desc&limit=400')
let sample = null
for (const g of gdos) {
  const perMat = new Map()
  for (const d of g.deliveries ?? [])
    for (const it of d.items ?? []) {
      const s = perMat.get(it.material_code_raw) ?? new Set()
      s.add(d.delivery_code); perMat.set(it.material_code_raw, s)
    }
  const hit = [...perMat.entries()].find(([, dos]) => dos.size >= 2)
  if (hit) { sample = { g, mc: hit[0], do1: [...hit[1]][0] }; break }
}

if (!sample) {
  check('[1] mức hạ không cộng lặp sang NPP khác', true, 'chưa có chuyến nào cùng mã ở 2 DO để soi')
} else {
  const { g, mc, do1 } = sample
  const args = { p_from: g.delivery_date, p_to: g.delivery_date, p_wh_ids: [g.warehouse_id] }
  const before = (await restRpc('service_level', args))?.summary ?? {}

  await restWrite('outbound_events', 'POST', null, {
    id: randomUUID(), gdo_id: g.id, group_code: g.group_code,
    event_type: 'QTY_REDUCED_TO_ACTUAL', source: 'WMS', actor: TAG,
    do_number: do1, material_code: mc,
    old_value: String(1000 + CUT), new_value: '1000',
    detail: `${TAG} vết kiểm công thức`,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  })
  const after = (await restRpc('service_level', args))?.summary ?? {}
  await cleanup()

  const dDemand = Number(after.demand ?? 0) - Number(before.demand ?? 0)
  const dShort  = Number(after.lines_short ?? 0) - Number(before.lines_short ?? 0)
  check('[1] mức hạ chỉ vào ĐÚNG dòng của DO đó (không cộng lặp sang NPP kia)',
    dDemand === CUT && dShort === 1,
    `chuyến ${g.group_code} mã ${mc}: nhu cầu +${dDemand} (đúng ${CUT}) · dòng thiếu +${dShort} (đúng 1)`)

  const back = (await restRpc('service_level', args))?.summary ?? {}
  check('[1b] xoá vết thì số liệu trở lại như cũ (không để lại dấu)',
    Number(back.demand ?? -1) === Number(before.demand ?? -2), `nhu cầu ${back.demand} vs ${before.demand}`)
}

// [2] ba ô phần trăm phải làm tròn 1 chữ số
{
  const s = (await restRpc('service_level', { p_from: '2026-07-01', p_to: '2026-08-31' }))?.summary ?? {}
  const keys = ['on_time_pct', 'in_full_pct', 'otif_pct', 'fill_rate']
  const bad = keys.filter(k => s[k] != null && /\.\d{2,}/.test(String(s[k])))
  check('[2] các ô % làm tròn 1 chữ số ở NGUỒN (không nhờ giao diện dọn hộ)',
    bad.length === 0, bad.length ? `chưa tròn: ${bad.map(k => `${k}=${s[k]}`).join(' · ')}` : keys.map(k => `${k}=${s[k]}`).join(' · '))

  // [3] mẫu số chấm sao = chuyến THUỘC DIỆN chấm (kho nhận có tích nhận), không phải mọi chuyến
  const trips = Number(s.trips ?? 0), ratable = Number(s.ratable_trips ?? 0), rated = Number(s.rated_trips ?? 0)
  check('[3] mẫu số chấm sao ≤ số chuyến, và số đã chấm ≤ số thuộc diện chấm',
    ratable <= trips && rated <= ratable,
    `chuyến ${trips} · thuộc diện chấm ${ratable} · đã chấm ${rated}`)
}

// Dọn 0 sót
{
  const left = (await restAll('outbound_events', `select=id&actor=eq.${TAG}`)).length
  check('dọn 0 sót (vết kiểm)', left === 0, `còn ${left}`)
}

finish('SERVICE-LEVEL')
