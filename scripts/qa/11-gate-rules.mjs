// GÓI GATE-RULES — 2 rule cổng/cân khi Bắt đầu chuyến xuất + các đường lách đã vá 01/08
// (luật "bug chết hai lần": mỗi bug ở đây từng CÓ THẬT, gói này gác không cho tái sinh).
// Bug gốc: (1) unstart không gỡ phiếu cân auto-start → xe bị chặn OAN chuyến sau;
// (2) PATCH status tự do → PENDING thành "Đang xuất" không qua rule; (3) chuyến giao lẻ
// (duyệt cổng, không biển) không sửa được thông tin xe; (4) Sửa xe đổi biển = né rule cổng;
// (5) quét/check-scan khi CHƯA Bắt đầu vẫn chạy. Tự seed tag QAGRUL/QAGR, tự dọn.
import { login, api, check, finish, restWrite, restAll } from './lib.mjs'
import { randomUUID } from 'crypto'

console.log('── GÓI GATE-RULES ──')
await login()
const now = () => new Date().toISOString()
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

async function cleanup() {
  const gdos = await restAll('GroupDeliveryOrder', `select=id&group_code=like.QAGRUL*`)
  const gids = gdos.map(g => g.id)
  if (gids.length) {
    const idsCsv = `(${gids.join(',')})`
    const dos = await restAll('OutboundDelivery', `select=id&gdo_id=in.${idsCsv}`)
    if (dos.length) await restWrite('OutboundItem', 'DELETE', `do_id=in.(${dos.map(d => d.id).join(',')})`)
    await restWrite('OutboundDelivery', 'DELETE', `gdo_id=in.${idsCsv}`)
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=in.${idsCsv}`)
  }
  await restWrite('WeighTicket', 'DELETE', `station_code=eq.QAGR`)
  const whs = await restAll('Warehouse', `select=id&code=like.QAGRUL*`)
  if (whs.length) {
    await restWrite('gate_registrations', 'DELETE', `warehouse_id=in.(${whs.map(w => w.id).join(',')})`)
    await restWrite('Warehouse', 'DELETE', `code=like.QAGRUL*`)
  }
}
await cleanup()

const mkWh = async (code, gate, weigh) => (await restWrite('Warehouse', 'POST', null, {
  id: randomUUID(), code, name: `QA gate-rules ${code}`, warehouse_type: 'CENTRAL', inventory_mode: 'QTY',
  require_gate_on_start: gate, require_weigh_on_start: weigh, is_active: true, updated_at: now(),
}))[0].id
const mkGdo = async (suffix, wh) => (await restWrite('GroupDeliveryOrder', 'POST', null, {
  id: randomUUID(), group_code: `QAGRUL_${suffix}`, planned_date: today, delivery_date: today,
  warehouse_id: wh, status: 'PENDING', created_at: now(), updated_at: now(),
}))[0].id
let regNo = 975001, srcNo = 885001
const mkGateReg = async (wh, plate) => (await restWrite('gate_registrations', 'POST', null, {
  id: randomUUID(), date: today, registration_number: regNo++, license_plate: plate, warehouse_id: wh,
  direction: 'OUTBOUND', status: 'IN', entry_at: now(), registered_at: now(), updated_at: now(),
}))[0].id
const mkTicket = async (wh, plateNorm) => {
  const src = srcNo++
  return (await restWrite('WeighTicket', 'POST', null, {
    id: randomUUID(), station_code: 'QAGR', source_id: src, ticket_no: `QAGR-${src}`,
    weigh_date: today, license_plate: plateNorm, license_plate_norm: plateNorm,
    direction: 'Cân Xuất', tare_kg: 12000, tare_at: now(), in_time: now(),
    is_complete: false, warehouse_id: wh, updated_at: now(),
  }))[0].id
}
const ticketOf = async id => (await restAll('WeighTicket', `select=gdo_id,matched_by&id=eq.${id}`))[0]

const whGate  = await mkWh('QAGRUL_G', true, false)
const whWeigh = await mkWh('QAGRUL_W', false, true)
const whBoth  = await mkWh('QAGRUL_B', true, true)

// ── 1. Ma trận rule cơ bản + cờ bypass cũ vô hiệu ──
{
  const g = await mkGdo('M1', whWeigh)
  let r = await api(`/wms/outbound/${g}/start`, 'POST', { license_plate: 'QAGR-1111', weigh_waive: true })
  check('rule cân chặn + cờ bypass body vô hiệu', r.s === 422 && r.j?.error?.code === 'WEIGH_REQUIRED', `${r.s} ${r.j?.error?.code}`)
  const tk = await mkTicket(whWeigh, 'QAGR1111')
  r = await api(`/wms/outbound/${g}/start`, 'POST', { license_plate: 'QAGR-1111' })
  check('có phiếu cân → start 200 + auto-link', r.s === 200 && (await ticketOf(tk))?.gdo_id === g)

  // ── 2. unstart PHẢI gỡ phiếu cân auto-start (bug: xe bị chặn OAN chuyến sau) ──
  r = await api(`/wms/outbound/${g}/unstart`, 'POST')
  const tkAfter = await ticketOf(tk)
  check('unstart gỡ phiếu cân auto-start', r.s === 200 && tkAfter?.gdo_id === null, JSON.stringify(tkAfter))
  const g2 = await mkGdo('M2', whWeigh)
  r = await api(`/wms/outbound/${g2}/start`, 'POST', { license_plate: 'QAGR-1111' })
  check('cùng xe start chuyến khác sau unstart → 200', r.s === 200, `${r.s} ${r.j?.error?.code}`)
}

// ── 3. PATCH status không được lách startGDO ──
{
  const g = await mkGdo('P1', whBoth)
  const r1 = await api(`/wms/outbound/${g}`, 'PATCH', { status: 'IN_PROGRESS' })
  const r2 = await api(`/wms/outbound/${g}`, 'PATCH', { status: 'PAUSED' })
  const cur = (await restAll('GroupDeliveryOrder', `select=status&id=eq.${g}`))[0]
  check('PATCH PENDING→IN_PROGRESS/PAUSED bị chặn', r1.s === 400 && r2.s === 400 && cur?.status === 'PENDING',
    `${r1.s}/${r2.s} status=${cur?.status}`)
}

// ── 4. Giao lẻ (duyệt cổng, không biển): start + sửa thông tin xe đều phải chạy ──
{
  const g = await mkGdo('S1', whGate)
  let r = await api(`/wms/outbound/${g}/gate-waive`, 'POST', { reason: 'QA giao lẻ' })
  check('duyệt bỏ qua cổng → 200', r.s === 200, `${r.s}`)
  r = await api(`/wms/outbound/${g}/start`, 'POST', {})
  check('start KHÔNG biển sau duyệt cổng → 200', r.s === 200, `${r.s} ${r.j?.error?.code}`)
  r = await api(`/wms/outbound/${g}/transport`, 'PATCH', { exporter_name: 'QA NX', loader_name: 'QA BX' })
  check('giao lẻ sửa người xuất/bốc xếp không cần biển → 200', r.s === 200, `${r.s} ${JSON.stringify(r.j?.error)}`)
}

// ── 5. Sửa xe KHÔNG được né rule cổng (đổi biển tự do sau khi start hợp lệ) ──
{
  const g = await mkGdo('T1', whGate)
  const gate = await mkGateReg(whGate, 'QAGR3333')
  let r = await api(`/wms/outbound/${g}/start`, 'POST', { license_plate: 'QAGR-3333', gate_registration_id: gate })
  check('start với cổng hợp lệ → 200', r.s === 200, `${r.s} ${r.j?.error?.code}`)
  r = await api(`/wms/outbound/${g}/transport`, 'PATCH', { license_plate: 'QAGR-9999', gate_registration_id: null })
  const cur = (await restAll('GroupDeliveryOrder', `select=license_plate&id=eq.${g}`))[0]
  check('sửa xe sang biển không đăng ký bị chặn 422', r.s === 422 && cur?.license_plate === 'QAGR3333',
    `${r.s} plate=${cur?.license_plate}`)
}

// ── 5b. "Xuất luôn" cũng chấp hành rule CỔNG (user chốt 01/08 vòng 2) ──
{
  const g = await mkGdo('X1', whGate)
  const doId = randomUUID(), itemId = randomUUID()
  await restWrite('OutboundDelivery', 'POST', null, { id: doId, gdo_id: g, delivery_code: 'QAGRUL_DOX', distributor_name: 'QAGRUL NPP', status: 'PENDING', updated_at: now() })
  await restWrite('OutboundItem', 'POST', null, { id: itemId, do_id: doId, material_code_raw: 'QAGRUL_MATX', material_type: 'Thành phẩm', cartons_ordered: 2, cartons_scanned: 0, status: 'PENDING', updated_at: now() })
  let r = await api(`/wms/outbound/${g}/quick-export`, 'POST', { license_plate: 'QAGR-7777' })
  check('"Xuất luôn" thiếu đăng ký cổng → 422 GATE_REQUIRED', r.s === 422 && r.j?.error?.code === 'GATE_REQUIRED', `${r.s} ${r.j?.error?.code}`)
  // Bug check-app 01/08: chuyến PENDING không có đường nào gắn cổng (Sửa thông tin xe đòi đã Bắt đầu)
  // ⇒ dialog "Xuất luôn" gửi kèm gate_registration_id; thiếu đường này là user KẸT ở kho bật rule cổng.
  const gateX = await mkGateReg(whGate, 'QAGR7777')
  r = await api(`/wms/outbound/${g}/quick-export`, 'POST', { license_plate: 'QAGR-7777', gate_registration_id: gateX })
  const savedGate = (await restAll('GroupDeliveryOrder', `select=gate_registration_id&id=eq.${g}`))[0]?.gate_registration_id
  check('"Xuất luôn" CHỌN chuyến xe ở cổng → 200 + lưu vết cổng vào chuyến',
    r.s === 200 && savedGate === gateX, `${r.s} gate=${savedGate}`)

  const g2 = await mkGdo('X2', whGate)
  const doId2 = randomUUID(), itemId2 = randomUUID()
  await restWrite('OutboundDelivery', 'POST', null, { id: doId2, gdo_id: g2, delivery_code: 'QAGRUL_DOX2', distributor_name: 'QAGRUL NPP', status: 'PENDING', updated_at: now() })
  await restWrite('OutboundItem', 'POST', null, { id: itemId2, do_id: doId2, material_code_raw: 'QAGRUL_MATX', material_type: 'Thành phẩm', cartons_ordered: 2, cartons_scanned: 0, status: 'PENDING', updated_at: now() })
  await api(`/wms/outbound/${g2}/gate-waive`, 'POST', { reason: 'QA' })
  r = await api(`/wms/outbound/${g2}/quick-export`, 'POST', { license_plate: 'QAGR-7778' })
  check('duyệt bỏ qua cổng → "Xuất luôn" chạy không cần cổng', r.s === 200, `${r.s} ${JSON.stringify(r.j?.error)}`)
}

// ── 5c. Đăng ký cổng đang gắn chuyến: KHÔNG xóa / KHÔNG đổi định danh (user chốt 01/08) ──
{
  const g = await mkGdo('GK1', whGate)
  const gate = await mkGateReg(whGate, 'QAGR5555')
  await api(`/wms/outbound/${g}/start`, 'POST', { license_plate: 'QAGR-5555', gate_registration_id: gate })
  const rDel = await api(`/tms/gate-registrations/${gate}`, 'DELETE')
  const rPlate = await api(`/tms/gate-registrations/${gate}`, 'PATCH', { license_plate: 'QAGR-8888' })
  const rNote = await api(`/tms/gate-registrations/${gate}`, 'PATCH', { notes: 'QA ghi chú' })
  check('gate đang gắn chuyến: chặn xóa + chặn đổi biển, vẫn sửa được ghi chú',
    rDel.s === 422 && rPlate.s === 422 && rNote.s === 200, `del=${rDel.s} plate=${rPlate.s} note=${rNote.s}`)
}

// ── 6. Quét khi CHƯA Bắt đầu phải bị chặn (không lật IN_PROGRESS, không trừ tồn) ──
{
  const g = await mkGdo('Q1', whBoth)
  const doId = randomUUID(), itemId = randomUUID()
  await restWrite('OutboundDelivery', 'POST', null, { id: doId, gdo_id: g, delivery_code: 'QAGRUL_DO', distributor_name: 'QAGRUL NPP', status: 'PENDING', updated_at: now() })
  await restWrite('OutboundItem', 'POST', null, { id: itemId, do_id: doId, material_code_raw: 'QAGRUL_MAT', material_type: 'Thành phẩm', cartons_ordered: 5, cartons_scanned: 0, status: 'PENDING', updated_at: now() })
  const r1 = await api(`/wms/outbound/${g}/items/${itemId}/check-scan`, 'POST', { qr_code: 'QAGRUL_FAKE' })
  const r2 = await api(`/wms/outbound/${g}/items/${itemId}/manual-complete`, 'POST', { cartons: 5 })
  const cur = (await restAll('GroupDeliveryOrder', `select=status&id=eq.${g}`))[0]
  check('check-scan + Lưu thủ công khi chưa Bắt đầu → 400, GDO vẫn PENDING',
    r1.s === 400 && r2.s === 400 && cur?.status === 'PENDING', `${r1.s}/${r2.s} status=${cur?.status}`)
}

await cleanup()
{
  const [w, t, g] = await Promise.all([
    restAll('Warehouse', `select=id&code=like.QAGRUL*`),
    restAll('WeighTicket', `select=id&station_code=eq.QAGR`),
    restAll('GroupDeliveryOrder', `select=id&group_code=like.QAGRUL*`),
  ])
  check('dọn sạch 0 sót', w.length === 0 && t.length === 0 && g.length === 0, `wh=${w.length} tk=${t.length} gdo=${g.length}`)
}

finish('GATE-RULES')
