// GÓI 46 — ĐƯỜNG QUÉT XUẤT: khoá dòng (migration 20260906) + 2 thông báo phải nói đúng việc.
//
// Gác 3 thứ vừa sửa 06/09 (luật "bug chết hai lần"):
//   (a) Đặt gạch hạn mức + trừ tồn phải NGUYÊN TỬ dưới khoá dòng — nhiều người quét cùng một
//       dòng hàng / cùng một pallet thì tổng KHÔNG được vượt kế hoạch, tồn KHÔNG được âm.
//       Trước 06/09 hai chỗ này là vòng CAS lạc quan trong JS: đúng về số nhưng mỗi vòng tốn
//       2 lượt gọi và thử lại tới 15 lần ⇒ đông người là tự nhân số lượt, làm nghẽn cả app.
//   (b) Quét nhầm mã phải báo MÃ HÀNG, không in id nội bộ (uuid) — công nhân đọc uuid thì chịu.
//   (c) Không hoàn thành được vì giao thiếu thì hướng dẫn phải nói ĐỦ BƯỚC "Tạm dừng",
//       vì đơn ĐANG XUẤT không sửa được — thiếu bước đó là đẩy người dùng vào ngõ cụt.
//   (d) Giám sát vận hành quá tải thì ĐƯA SỐ CŨ (kèm giờ chốt) chứ không báo lỗi — hàm đọc số cũ
//       phải dựng ĐÚNG khoá cache mà hàm tính đã ghi, lệch khoá là hỏng âm thầm (luôn trả rỗng).
// usage: node scripts/qa/46-scan-rowlock.mjs
import { login, api, check, finish, pool, restAll, restWrite, restRpc, resolveFixtures, FIX } from './lib.mjs'
import { randomUUID } from 'crypto'

const TAG = 'QARL'
console.log('── GÓI SCAN-ROWLOCK ──')
await login()
await resolveFixtures()

const nowIso = () => new Date().toISOString()
const TODAY = FIX.EXEC_DATE
const DMY = TODAY.slice(8, 10) + TODAY.slice(5, 7) + TODAY.slice(2, 4)
const WH = FIX.WH_QR
const created = { locId: null, inbound: null, gdos: [], gates: [], weighs: [] }

async function wipe() {
  // Quét CẢ 2 đường: group_code (đã gắn tag) và SỐ DO (bảng con) — chuyến hỏng giữa chừng chưa kịp
  // gắn tag vào group_code thì chỉ còn nhận ra được qua delivery_code, bỏ sót là lần sau 409 trùng DO.
  const ids = new Set(created.gdos)
  for (const g of await restAll('GroupDeliveryOrder', `select=id&group_code=like.*${TAG}*`)) ids.add(g.id)
  for (const d of await restAll('OutboundDelivery', `select=gdo_id&delivery_code=like.${TAG}-*`)) if (d.gdo_id) ids.add(d.gdo_id)
  for (const g of [...ids].map(id => ({ id }))) {
    for (const o of await restAll('TmsOrder', `select=id&transfer_gdo_id=eq.${g.id}`)) {
      await restWrite('inbound_plan_lines', 'DELETE', `tms_order_id=eq.${o.id}`).catch(() => {})
      await restWrite('TmsVehicleSlot', 'DELETE', `order_id=eq.${o.id}`).catch(() => {})
      await restWrite('TmsOrder', 'DELETE', `id=eq.${o.id}`).catch(() => {})
    }
    await restWrite('outbound_events', 'DELETE', `gdo_id=eq.${g.id}`).catch(() => {})
    for (const d of await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`)) {
      for (const it of await restAll('OutboundItem', `select=id&do_id=eq.${d.id}`))
        await restWrite('OutboundScanEntry', 'DELETE', `item_id=eq.${it.id}`).catch(() => {})
      await restWrite('OutboundItem', 'DELETE', `do_id=eq.${d.id}`).catch(() => {})
    }
    await restWrite('OutboundDelivery', 'DELETE', `gdo_id=eq.${g.id}`).catch(() => {})
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${g.id}`).catch(() => {})
  }
  await restWrite('InventoryEntry', 'DELETE', `pallet_code=like.*_${TAG}_*`).catch(() => {})
  await restWrite('ProductionImport', 'DELETE', `notes=like.*${TAG}*`).catch(() => {})
  await restWrite('WeighTicket', 'DELETE', `station_code=eq.${TAG}`).catch(() => {})
  await restWrite('gate_registrations', 'DELETE', `license_plate=like.${TAG}*`).catch(() => {})
  for (const l of await restAll('Location', `select=id&location_code=like.${TAG}-*`))
    await restWrite('Location', 'DELETE', `id=eq.${l.id}`).catch(() => {})
}
await wipe()

try {
  // ── [0] RPC khoá dòng đã có trong DB chưa ────────────────────────────────
  {
    let has = true
    try { await restRpc('outbound_claim_quota', { p_item_id: '00000000-0000-0000-0000-000000000000', p_want: 1, p_ceiling: 1, p_complete_when_full: false, p_now: nowIso() }) }
    catch { has = false }
    check('[0] RPC khoá dòng outbound_claim_quota đã apply (chưa apply thì controller vẫn chạy đường CAS cũ)',
      has, has ? '' : 'THIẾU — apply backend/migrations/20260906_outbound_scan_rowlock.sql')
  }

  // ── Fixture: 1 vị trí + 9 pallet tem thật ở kho QR ───────────────────────
  const [mat] = await restAll('Material',
    `select=id,material_code,category,units_per_carton,cartons_per_pallet&id=eq.${FIX.MAT_POOL_ID}`)
  const UPC = Number(mat.units_per_carton ?? 1) || 1
  const PB = 10 * UPC                       // 1 "pallet test" = 10 thùng quy đổi ra base
  const [loc] = await restWrite('Location', 'POST', null, {
    id: randomUUID(), location_code: `${TAG}-01`, warehouse_id: WH.id, row: 'QA', shelf: '1',
    sub_code: `${TAG}-01`, max_pallets: 60, is_active: true, created_at: nowIso(), updated_at: nowIso(),
  })
  created.locId = loc.id
  const inb = await api('/wms/inbound-orders', 'POST', {
    warehouse_id: WH.id, material_id: mat.id, location_id: loc.id, import_date: TODAY,
    source_type: 'FACTORY', warehouse_type: mat.category, notes: `${TAG} rowlock`,
  })
  const order = inb.j?.data?.order ?? inb.j?.data
  created.inbound = order?.id
  // 11 pallet: 0–7 cho bài đua hạn mức · 8 cho bài đua cùng pallet · 9 cho bài quét nhầm mã ·
  // 10 cho bài giao thiếu. Chia CỐ ĐỊNH: bài đua tiêu ngẫu nhiên 3/8 nên không được dùng chung.
  const pallets = []
  for (let i = 1; i <= 11; i++) {
    const code = `${DMY}_${mat.material_code}_${TAG}_101_${String(i).padStart(3, '0')}_B`
    const r = await api(`/wms/inbound-orders/${order.id}/scan`, 'POST',
      { qr_code: code, location_id: loc.id, cartons_override: PB })
    if (r.s === 200) pallets.push(code)
  }
  check('[1] Dựng nền: 11 pallet tem thật vào kho QR', pallets.length === 11, `${pallets.length}/11 pallet`)

  // Mở 1 chuyến ĐANG XUẤT (qua rule cổng + cân của kho)
  let plateSeq = 0
  async function openTrip(orderedBase, label) {
    const seq = ++plateSeq
    const plate = `${TAG}XE${seq}`
    const c = await api('/wms/outbound', 'POST', {
      delivery_date: TODAY, warehouse_id: WH.id, dvvt: FIX.DVVT_TAG,
      customer_name: `${TAG} NPP ${label}`, delivery_code: `${TAG}-${label}-${seq}`,
      items: [{ material_code: mat.material_code, cartons_ordered: orderedBase, npp: `${TAG} NPP ${label}` }],
    })
    const gdo = c.j?.data
    if (!gdo?.id) { console.log(`  ⚠ không mở được chuyến ${label}: http=${c.s} ${(c.j?.error?.message ?? '').slice(0, 120)}`); return null }
    created.gdos.push(gdo.id)
    // group_code do BE sinh → gắn tag vào ĐUÔI để bộ dọn nhận ra (đuôi, không đầu: giữ nguyên
    // 4 đoạn đầu cho mọi chỗ đang bóc ngày từ group_code; kèm số thứ tự cho khỏi trùng khoá)
    await restWrite('GroupDeliveryOrder', 'PATCH', `id=eq.${gdo.id}`, { group_code: `${gdo.group_code}_${TAG}${seq}` })
    const g = await api('/tms/gate-registrations', 'POST', {
      date: TODAY, warehouse_id: WH.id, license_plate: plate, direction: 'OUTBOUND',
      driver_name: `${TAG} tài xế`, vehicle_type: 'XEPALLET',
    })
    const gateId = g.j?.data?.id
    if (gateId) { created.gates.push(gateId); await api(`/tms/gate-registrations/${gateId}/entry`, 'PATCH', {}) }
    const [wt] = await restWrite('WeighTicket', 'POST', null, {
      id: randomUUID(), station_code: TAG, source_id: 500000 + seq, ticket_no: `${TAG}-${seq}`,
      weigh_date: TODAY, license_plate: plate, license_plate_norm: plate, direction: 'OUT',
      warehouse_id: WH.id, tare_kg: 8000, tare_at: nowIso(), is_complete: false,
      created_at: nowIso(), updated_at: nowIso(),
    })
    created.weighs.push(wt.id)
    const st = await api(`/wms/outbound/${gdo.id}/start`, 'POST', { license_plate: plate, gate_registration_id: gateId })
    return { gdo, item: gdo.delivery_orders?.[0]?.items?.[0], started: st.s, plate }
  }

  // ── [2] 8 người quét 8 pallet KHÁC NHAU vào dòng hàng chỉ đặt 3 pallet ───
  {
    const t = await openTrip(PB * 3, 'quota')
    check('[2a] Chuyến mở được (qua rule cổng + cân)', t?.started === 200, `http=${t?.started}`)
    const use = pallets.slice(0, 8)
    const rs = await pool(use.map(code => () =>
      api(`/wms/outbound/${t.gdo.id}/items/${t.item.id}/scan`, 'POST', { qr_code: code, cartons_override: PB })), 8)
    const okN = rs.filter(r => r.s === 200).length
    const [it] = await restAll('OutboundItem', `select=cartons_scanned,cartons_ordered&id=eq.${t.item.id}`)
    check('[2] 8 người quét cùng lúc vào dòng đặt 3 pallet → ĐÚNG 3 lượt ăn, tổng KHÔNG vượt kế hoạch',
      okN === 3 && Number(it?.cartons_scanned) === PB * 3 && Number(it?.cartons_scanned) <= Number(it?.cartons_ordered),
      `ăn=${okN}/8 · scanned=${it?.cartons_scanned}/${it?.cartons_ordered} · mã trả về ${[...new Set(rs.map(r => r.s))].join(',')}`)
    const ents = await restAll('InventoryEntry',
      `select=pallet_code,cartons_remaining,cartons_imported&pallet_code=in.(${use.map(c => `"${c}"`).join(',')})`)
    const consumed = ents.filter(e => Number(e.cartons_remaining) === 0).length
    const untouched = ents.filter(e => Number(e.cartons_remaining) === Number(e.cartons_imported)).length
    check('[2b] Tồn trừ ĐÚNG 3 pallet, 5 pallet còn lại nguyên vẹn (không trừ oan)',
      consumed === 3 && untouched === 5, `hết=${consumed} nguyên=${untouched}`)
    check('[2c] Không pallet nào âm tồn', ents.every(e => Number(e.cartons_remaining) >= 0))
  }

  // ── [3] 5 người quét CÙNG MỘT pallet ─────────────────────────────────────
  {
    const t = await openTrip(PB, 'dua')
    const code = pallets[8]
    const rs = await pool(Array.from({ length: 5 }, () => () =>
      api(`/wms/outbound/${t.gdo.id}/items/${t.item.id}/scan`, 'POST', { qr_code: code, cartons_override: PB })), 5)
    const okN = rs.filter(r => r.s === 200).length
    const [e] = await restAll('InventoryEntry', `select=cartons_remaining,cartons_imported&pallet_code=eq.${code}`)
    const scans = await restAll('OutboundScanEntry', `select=id&item_id=eq.${t.item.id}`)
    check('[3] 5 người quét CÙNG 1 pallet → đúng 1 lượt ăn, 1 vết quét, tồn về 0 (không trừ hai lần)',
      okN === 1 && scans.length === 1 && Number(e?.cartons_remaining) === 0,
      `ăn=${okN}/5 vết=${scans.length} tồn=${e?.cartons_remaining}`)
  }

  // ── [4] Thông báo quét nhầm mã: nói MÃ HÀNG, không in uuid ───────────────
  {
    const [other] = await restAll('Material',
      `select=id,material_code&id=neq.${mat.id}&is_active=is.true&material_code=like.5*&limit=1`)
    const t = await openTrip(PB, 'nham')
    // dòng hàng của mã KHÁC → quét tem mã gốc vào là nhầm mã
    await restWrite('OutboundItem', 'PATCH', `id=eq.${t.item.id}`,
      { material_id: other.id, material_code_raw: other.material_code })
    const r = await api(`/wms/outbound/${t.gdo.id}/items/${t.item.id}/scan`, 'POST',
      { qr_code: pallets[9], cartons_override: PB })
    const msg = String(r.j?.error?.message ?? '')
    const hasUuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(msg)
    check('[4] Quét nhầm mã: thông báo nói MÃ HÀNG của tem và của dòng hàng, KHÔNG in id nội bộ',
      r.s === 400 && !hasUuid && msg.includes(mat.material_code) && msg.includes(other.material_code),
      `msg="${msg.slice(0, 120)}"`)
    // pallet 9 vẫn nguyên (lượt quét trên bị chặn vì nhầm mã, không trừ tồn)
    const r2 = await api(`/wms/outbound/${t.gdo.id}/items/${t.item.id}/check-scan`, 'POST', { qr_code: pallets[9] })
    const msg2 = String(r2.j?.error?.message ?? '')
    check('[4b] Bước kiểm-trước-khi-quét cũng nói rõ mã hàng (trước đây câm)',
      msg2.includes(mat.material_code) && msg2.includes(other.material_code),
      `msg="${msg2.slice(0, 120)}"`)
  }

  // ── [5][6] Giao thiếu: hướng dẫn phải nói "Tạm dừng" và đường đó chạy được ─
  {
    const t = await openTrip(PB * 2, 'thieu')
    await api(`/wms/outbound/${t.gdo.id}/items/${t.item.id}/scan`, 'POST',
      { qr_code: pallets[10], cartons_override: PB })
    const early = await api(`/wms/outbound/${t.gdo.id}`, 'PATCH', { status: 'COMPLETED' })
    const msg = String(early.j?.error?.message ?? '')
    check('[5] Xuất thiếu → chặn hoàn thành, hướng dẫn nói ĐỦ bước "Tạm dừng" (đơn ĐANG XUẤT không sửa được)',
      early.s === 400 && /tạm dừng/i.test(msg), `msg="${msg.slice(-110)}"`)
    const pause = await api(`/wms/outbound/${t.gdo.id}`, 'PATCH', { status: 'PAUSED' })
    const fix = await api(`/wms/outbound/${t.gdo.id}`, 'PUT', {
      delivery_date: TODAY, warehouse_id: WH.id, dvvt: FIX.DVVT_TAG, customer_name: `${TAG} NPP thieu`,
      items: [{ db_id: t.item.id, material_code: mat.material_code, cartons_ordered: PB, npp: `${TAG} NPP thieu` }],
    })
    const resume = await api(`/wms/outbound/${t.gdo.id}`, 'PATCH', { status: 'IN_PROGRESS' })
    const done = await api(`/wms/outbound/${t.gdo.id}`, 'PATCH', { status: 'COMPLETED' })
    check('[6] Làm ĐÚNG hướng dẫn: Tạm dừng → hạ SL → Tiếp tục → Hoàn thành, cả 4 bước chạy được',
      pause.s === 200 && fix.s === 200 && resume.s === 200 && done.s === 200,
      `dừng=${pause.s} sửa=${fix.s} tiếp=${resume.s} xong=${done.s}`)
    const ev = await restAll('outbound_events', `select=event_type&gdo_id=eq.${t.gdo.id}`)
    check('[6b] Việc hạ SL để lại VẾT giao thiếu (không xoá dấu để đo mức phục vụ)',
      ev.some(e => String(e.event_type).startsWith('QTY_REDUCED')),
      `loại sự kiện: ${[...new Set(ev.map(e => e.event_type))].join(',') || '—'}`)
  }
  // ── [7] Giám sát vận hành: đường "đưa số cũ khi nghẽn" phải dùng ĐÚNG khoá cache ─────────
  {
    const r = await api('/wms/control-tower')
    check('[7a] Màn Giám sát vận hành trả số bình thường', r.s === 200, `http=${r.s}`)
    let stale = null, err = ''
    try {
      stale = await restRpc('control_tower_stats_stale', {
        p_warehouse_ids: null, p_categories: null, p_today: TODAY, p_material_codes: null,
      })
    } catch (e) { err = String(e).slice(0, 120) }
    check('[7] Hàm đọc SỐ CŨ dựng đúng khoá cache của hàm tính (lệch khoá = luôn rỗng = mất đường lui)',
      stale != null && stale.stale === true && !!stale.computed_at,
      err || `stale=${stale ? `có · chốt lúc ${String(stale.computed_at).slice(11, 19)}` : 'RỖNG'}`)
  }
} catch (e) {
  check('gói chạy không nổ', false, String(e))
} finally {
  await wipe()
  const left = [
    ...(await restAll('InventoryEntry', `select=id&pallet_code=like.*_${TAG}_*`)),
    ...(await restAll('GroupDeliveryOrder', `select=id&group_code=like.*${TAG}*`)),
    ...(await restAll('OutboundDelivery', `select=id&delivery_code=like.${TAG}-*`)),
    ...(await restAll('Location', `select=id&location_code=like.${TAG}-*`)),
    ...(await restAll('WeighTicket', `select=id&station_code=eq.${TAG}`)),
  ]
  check('[dọn] 0 tàn dư sau cleanup', left.length === 0, `còn ${left.length}`)
}

finish('SCAN-ROWLOCK')
