// GÓI 58 — %DATE THEO KHÁCH HÀNG / KÊNH (user chốt 11/09/2026)
//
// Đo staging 11/09: cột %Date của VL06O TRỐNG 100 % (0/26.675 dòng 60 ngày) ⇒ nguồn %Date duy nhất
// là tay người, mà production ~1.000 dòng/ngày. Nay máy áp theo danh mục Khách hàng / Kênh.
//
// VÌ SAO PHẢI GÁC BẰNG MÁY: áp SAI %Date không báo lỗi gì cả — nó chỉ khiến kho lấy nhầm lô, hoặc
// (tệ hơn) khiến dòng đáng lẽ người phải tự quyết lại bị máy quyết hộ. Ba ranh giới dễ mất nhất:
//   (a) CHỐT TAY là bất khả xâm phạm — upload đè, áp lại theo master đều không được đụng;
//   (b) khách CHƯA CÓ trong danh mục / CHƯA PHÂN KÊNH ⇒ KHÔNG cấp %Date tự động (máy không đoán);
//   (c) đổi master KHÔNG lan ngược cho đơn đang mở — chỉ đổi khi có người bấm "Áp lại theo master".
//
// Fixture tự chứa: 2 kho QA58 (xuất + đích chuyển kho) · 1 mã · tồn %Date ≈ 95 % · 4 khách
// (kênh NPP · rule riêng ≥ 99 · chưa kênh · trỏ kho) · các chuyến sinh từ Kế hoạch xuất. Dọn sạch cuối gói.
import { login, api, check, finish, restWrite, restAll } from './lib.mjs'
import { randomUUID } from 'crypto'

const T = 'QA58'
console.log('── GÓI 58: %Date theo Khách hàng / Kênh — thang ưu tiên · không lan ngược · áp lại theo master ──')
await login()
const nowIso = () => new Date().toISOString()
const vnDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const dPlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const err = r => `${r.j?.error?.code ?? ''} ${(r.j?.error?.message ?? '').slice(0, 110)}`.trim()

// Số xe PHẢI theo khuôn `<MÃ KHO>_X_<ddmmyy>_<n>` — derive tra kho từ tiền tố trước gạch dưới đầu.
const dNow = new Date()
const STAMP = `${String(dNow.getDate()).padStart(2, '0')}${String(dNow.getMonth() + 1).padStart(2, '0')}${String(dNow.getFullYear()).slice(2)}`
const GC = n => `${T}_X_${STAMP}_${n}`
const SHIP = { A: `${T}A`, B: `${T}B`, C: `${T}C`, D: `${T}D`, NEW: `${T}NEW` }

async function cleanup() {
  for (const g of await restAll('GroupDeliveryOrder', `select=id&group_code=like.${T}*`)) {
    for (const o of await restAll('TmsOrder', `select=id&transfer_gdo_id=eq.${g.id}`)) {
      await restWrite('TmsVehicleSlot', 'DELETE', `order_id=eq.${o.id}`).catch(() => {})
      await restWrite('inbound_plan_lines', 'DELETE', `tms_order_id=eq.${o.id}`).catch(() => {})
      await restWrite('TmsOrder', 'DELETE', `id=eq.${o.id}`).catch(() => {})
    }
    await restWrite('wms_tasks', 'DELETE', `gdo_id=eq.${g.id}`).catch(() => {})
    for (const d of await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`)) {
      for (const it of await restAll('OutboundItem', `select=id&do_id=eq.${d.id}`))
        await restWrite('OutboundScanEntry', 'DELETE', `item_id=eq.${it.id}`).catch(() => {})
      await restWrite('OutboundItem', 'DELETE', `do_id=eq.${d.id}`).catch(() => {})
    }
    await restWrite('OutboundDelivery', 'DELETE', `gdo_id=eq.${g.id}`).catch(() => {})
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${g.id}`).catch(() => {})
  }
  await restWrite('outbound_events', 'DELETE', `group_code=like.${T}*`).catch(() => {})
  await restWrite('reconcile_tasks', 'DELETE', `group_code=like.${T}*`).catch(() => {})
  await restWrite('khvc_lines', 'DELETE', `group_code=like.${T}*`).catch(() => {})
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=like.${T}DO*`).catch(() => {})
  for (const o of await restAll('TmsOrder', `select=id&order_code=like.${T}*`)) {
    await restWrite('TmsVehicleSlot', 'DELETE', `order_id=eq.${o.id}`).catch(() => {})
    await restWrite('inbound_plan_lines', 'DELETE', `tms_order_id=eq.${o.id}`).catch(() => {})
    await restWrite('TmsOrder', 'DELETE', `id=eq.${o.id}`).catch(() => {})
  }
  for (const w of await restAll('Warehouse', `select=id&code=like.${T}*`)) {
    await restWrite('inbound_plan_lines', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('InventoryEntry', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('Location', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('Customer', 'PATCH', `warehouse_id=eq.${w.id}`, { warehouse_id: null }).catch(() => {})
    await restWrite('Warehouse', 'DELETE', `id=eq.${w.id}`).catch(() => {})
  }
  await restWrite('Customer', 'DELETE', `ship_to_code=like.${T}*`).catch(() => {})
  for (const m of await restAll('Material', `select=id&material_code=like.${T}*`))
    await restWrite('Material', 'DELETE', `id=eq.${m.id}`).catch(() => {})
}
await cleanup()

try {
  // ═══ [0] FIXTURE ══════════════════════════════════════════════════════════════════════════════
  const cats = await restAll('LookupValue', 'select=value&type=eq.warehouse_type&limit=1')
  const CAT = cats[0]?.value ?? 'FG01'
  const vt = (await restAll('VehicleType', 'select=name&is_active=eq.true&limit=1'))[0]?.name ?? 'XE TẢI'
  const dvvt = (await restAll('TransportCompany', 'select=name&limit=1'))[0]?.name ?? 'QA DVVT'

  const [wh] = await restWrite('Warehouse', 'POST', null, {
    id: randomUUID(), code: T, name: 'QA khách hàng %Date', warehouse_type: CAT,
    inventory_mode: 'QTY', require_gate_on_start: false, require_weigh_on_start: false,
    is_active: true, date_rule_policy: 'OFF', updated_at: nowIso(),
  })
  const [whDest] = await restWrite('Warehouse', 'POST', null, {
    id: randomUUID(), code: `${T}D`, name: 'QA kho nhận', warehouse_type: CAT,
    inventory_mode: 'QTY', is_active: true, updated_at: nowIso(),
  })
  const [mat] = await restWrite('Material', 'POST', null, {
    id: randomUUID(), material_code: `${T}-M1`, material_description: 'QA customer date', short_name: 'QA CD',
    category: CAT, base_unit: 'CS', cartons_per_pallet: 100, shelf_life_days: 100, no_qr_tracking: true,
    is_active: true, created_at: nowIso(), updated_at: nowIso(),
  })
  // Tồn %Date ≈ 95 % (SX 5 ngày trước / hạn dùng 100 ngày) — đủ cho mức ≥ 60, KHÔNG đủ mức ≥ 99.
  // Kho QTY: dòng "pool" mang `pallet_code` = CHÍNH MÃ HÀNG (cửa Xuất luôn tra tồn theo khoá đó).
  await restWrite('InventoryEntry', 'POST', null, {
    id: randomUUID(), pallet_code: mat.material_code, material_id: mat.id, warehouse_id: wh.id,
    cartons_imported: 5000, cartons_remaining: 5000, cartons_reserved: 0,
    status: 'IN_STOCK', production_date: dPlus(-5), import_date: vnDate(),
    created_at: nowIso(), updated_at: nowIso(),
  })

  // Kênh NPP có sẵn mức ≥ 60 do migration seed — đọc lại để phép kiểm không phụ thuộc giả định.
  const chNpp = (await restAll('LookupValue', "select=id,value,meta&type=eq.customer_channel&value=eq.NPP"))[0]
  const chNppPct = Number(chNpp?.meta?.date_rule?.value ?? 0)
  check('[0a] Kênh NPP có sẵn mức mặc định ≥ 60 % (migration seed)', chNppPct === 60, `mức=${chNppPct}`)

  const mkCust = (code, patch) => restWrite('Customer', 'POST', null, {
    id: randomUUID(), ship_to_code: code, name: `KH ${code}`, is_active: true, auto_created: false,
    created_at: nowIso(), updated_at: nowIso(), ...patch,
  })
  await mkCust(SHIP.A, { channel: 'NPP' })
  await mkCust(SHIP.B, { channel: 'NPP', date_rule: { kind: 'MIN_PCT', value: 99 } })
  await mkCust(SHIP.C, {})                                   // chưa phân kênh
  await mkCust(SHIP.D, { channel: 'NPP', warehouse_id: whDest.id })

  // Dòng raw VL06O — mỗi chuyến MỘT ship-to (ship-to là thuộc tính của CHUYẾN, không phải của dòng)
  const mkRaw = (doNo, ship, note) => restWrite('erp_outbound_orders', 'POST', null, {
    id: randomUUID(), od_number: doNo, od_item: '10', material_code: mat.material_code, qty_base: 60,
    ship_to_code: ship ?? null, ship_to_name: ship ? `KH ${ship}` : null,
    note_delivery: note ?? null, source: 'EXCEL', sync_status: 'ACTIVE',
    last_synced_at: nowIso(), updated_at: nowIso(),
  })
  await mkRaw(`${T}DO_A1`, SHIP.A, null)
  await mkRaw(`${T}DO_A2`, SHIP.A, 'XX GIAO DATE 50%-70%')   // ghi chú CS — chỗ NGƯỜI phải đọc
  await mkRaw(`${T}DO_A3`, SHIP.A, null)
  await mkRaw(`${T}DO_B`,  SHIP.B, null)
  await mkRaw(`${T}DO_C`,  SHIP.C, null)
  await mkRaw(`${T}DO_NS`, null,   null)                     // chuyến KHÔNG có ship-to
  await mkRaw(`${T}DO_NEW`, SHIP.NEW, null)                  // ship-to LẠ (chưa có trong danh mục)
  await mkRaw(`${T}DO_ALL`, SHIP.A, 'TRẢ PALLET')
  await mkRaw(`${T}DO_OFF`, SHIP.A, null)
  await mkRaw(`${T}DO_D`,  SHIP.D, null)

  const today = vnDate()
  // "Loại kho booking" bắt buộc (luật 03/08: 1 Số xe = 1 cửa đặt lịch) — thiếu là 400 ngay từ đây.
  const plan = async (gc, doNo, npp) => {
    const r = await api('/external/khvc', 'POST',
      { group_code: gc, do_no: doNo, npp, export_date: today, veh_type: vt, dvvt, booking_category: CAT })
    if (r.s !== 201 && r.s !== 200) throw new Error(`Dựng kế hoạch ${gc}/${doNo} hỏng: ${r.s} ${err(r)}`)
    return r
  }

  const itemsOf = async gc => {
    const g = (await restAll('GroupDeliveryOrder', `select=id,status,shipto_party&group_code=eq.${gc}`))[0]
    if (!g) return { gdo: null, items: [] }
    const dos = await restAll('OutboundDelivery', `select=id,distributor_name&gdo_id=eq.${g.id}`)
    if (!dos.length) return { gdo: g, items: [] }
    const items = await restAll('OutboundItem',
      `select=id,date_rule,date_required,header_text,do_id&do_id=in.(${dos.map(d => d.id).join(',')})`)
    const nppOf = new Map(dos.map(d => [d.id, d.distributor_name]))
    return { gdo: g, items: items.map(i => ({ ...i, npp: nppOf.get(i.do_id) })) }
  }
  const ruleOf = it => it?.date_rule ?? null
  const srcOf = it => it?.date_rule?.source ?? null

  // ═══ [1] POLICY NO_NOTE — thang ưu tiên đầy đủ ════════════════════════════════════════════════
  await restWrite('Warehouse', 'PATCH', `id=eq.${wh.id}`, { date_rule_policy: 'NO_NOTE', updated_at: nowIso() })

  await plan(GC('01'), `${T}DO_A1`, `${T} NPP1`)
  await plan(GC('01'), `${T}DO_A2`, `${T} NPP2`)
  await plan(GC('01'), `${T}DO_A3`, `${T} NPP3`)
  await plan(GC('02'), `${T}DO_B`,  `${T} NPPB`)
  await plan(GC('03'), `${T}DO_C`,  `${T} NPPC`)
  await plan(GC('04'), `${T}DO_NS`, `${T} NPPNS`)
  await plan(GC('05'), `${T}DO_NEW`, `${T} NPPNEW`)

  const g01 = await itemsOf(GC('01'))
  const a1 = g01.items.find(i => i.npp === `${T} NPP1`)
  const a2 = g01.items.find(i => i.npp === `${T} NPP2`)
  const a3 = g01.items.find(i => i.npp === `${T} NPP3`)
  check('[1a] Khách có KÊNH, dòng KHÔNG ghi chú → máy áp mức của kênh (nguồn = CHANNEL)',
    ruleOf(a1)?.kind === 'MIN_PCT' && Number(ruleOf(a1)?.value) === 60 && srcOf(a1) === 'CHANNEL',
    `rule=${JSON.stringify(ruleOf(a1))}`)
  check('[1b] Dòng CÓ ghi chú CS (kho NO_NOTE) → KHÔNG áp, để người đọc rồi chốt',
    ruleOf(a2) === null && !!a2?.header_text, `rule=${JSON.stringify(ruleOf(a2))} note=${a2?.header_text?.slice(0, 30)}`)

  const b = (await itemsOf(GC('02'))).items[0]
  check('[1c] Khách có %DATE RIÊNG → mức riêng thắng mức kênh (nguồn = CUSTOMER)',
    ruleOf(b)?.kind === 'MIN_PCT' && Number(ruleOf(b)?.value) === 99 && srcOf(b) === 'CUSTOMER',
    `rule=${JSON.stringify(ruleOf(b))}`)

  const c = (await itemsOf(GC('03'))).items[0]
  check('[1d] Khách CHƯA PHÂN KÊNH → KHÔNG cấp %Date tự động (máy không đoán)',
    ruleOf(c) === null, `rule=${JSON.stringify(ruleOf(c))}`)

  const ns = (await itemsOf(GC('04'))).items[0]
  check('[1e] Chuyến KHÔNG có ship-to → KHÔNG cấp %Date tự động',
    ruleOf(ns) === null, `rule=${JSON.stringify(ruleOf(ns))}`)

  // ĐÂY LÀ CÂU USER HỎI THẲNG 11/09: khách chưa có trong danh sách thì không được cấp %Date.
  const newIt = (await itemsOf(GC('05'))).items[0]
  const newCust = (await restAll('Customer', `select=id,channel,auto_created&ship_to_code=eq.${SHIP.NEW}`))[0]
  check('[1f] Ship-to LẠ (chưa có trong danh mục) → dòng KHÔNG được cấp %Date tự động',
    ruleOf(newIt) === null, `rule=${JSON.stringify(ruleOf(newIt))}`)
  check('[1g] …và khách lạ được TỰ TẠO vào danh mục với kênh TRỐNG (danh mục tự nuôi, vẫn không đoán %Date)',
    !!newCust && newCust.auto_created === true && newCust.channel === null,
    `auto=${newCust?.auto_created} channel=${newCust?.channel}`)

  // ═══ [2] POLICY ALL / OFF ═════════════════════════════════════════════════════════════════════
  await restWrite('Warehouse', 'PATCH', `id=eq.${wh.id}`, { date_rule_policy: 'ALL', updated_at: nowIso() })
  await plan(GC('06'), `${T}DO_ALL`, `${T} NPPALL`)
  const allIt = (await itemsOf(GC('06'))).items[0]
  check('[2a] Kho ÁP TOÀN BỘ → dòng CÓ ghi chú CS cũng được áp',
    ruleOf(allIt)?.kind === 'MIN_PCT' && srcOf(allIt) === 'CHANNEL' && !!allIt?.header_text,
    `rule=${JSON.stringify(ruleOf(allIt))} note=${allIt?.header_text?.slice(0, 20)}`)

  await restWrite('Warehouse', 'PATCH', `id=eq.${wh.id}`, { date_rule_policy: 'OFF', updated_at: nowIso() })
  await plan(GC('07'), `${T}DO_OFF`, `${T} NPPOFF`)
  const offIt = (await itemsOf(GC('07'))).items[0]
  check('[2b] Kho TẮT → không áp gì, kể cả khách có kênh (mặc định của mọi kho đang chạy)',
    ruleOf(offIt) === null, `rule=${JSON.stringify(ruleOf(offIt))}`)
  await restWrite('Warehouse', 'PATCH', `id=eq.${wh.id}`, { date_rule_policy: 'NO_NOTE', updated_at: nowIso() })

  // ═══ [3] CHỐT TAY BẤT KHẢ XÂM PHẠM · KHÔNG LAN NGƯỢC · ÁP LẠI THEO MASTER ═════════════════════
  let r = await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [a3.id], rule: { kind: 'MIN_PCT', value: 70 } })
  const a3Set = (await restAll('OutboundItem', `select=date_rule&id=eq.${a3.id}`))[0]
  check('[3a] Chốt tay ghi nguồn MANUAL', r.s === 200 && a3Set?.date_rule?.source === 'MANUAL' && Number(a3Set?.date_rule?.value) === 70,
    `${r.s} ${JSON.stringify(a3Set?.date_rule)}`)

  // Dội lại dữ liệu ngoài (sửa ghi chú điều vận của MỘT dòng kế hoạch) → chuyến dựng lại dòng hàng
  const line = (await restAll('khvc_lines', `select=id&group_code=eq.${GC('01')}&do_no=eq.${T}DO_A3`))[0]
  await api(`/external/khvc/${line.id}`, 'PUT', { note: 'điều vận sửa ghi chú' })
  const g01b = await itemsOf(GC('01'))
  const a3b = g01b.items.find(i => i.npp === `${T} NPP3`)
  const a1b = g01b.items.find(i => i.npp === `${T} NPP1`)
  check('[3b] Dữ liệu ngoài dội xuống KHÔNG xoá chốt tay (mang theo cả NGUỒN)',
    Number(ruleOf(a3b)?.value) === 70 && srcOf(a3b) === 'MANUAL', `rule=${JSON.stringify(ruleOf(a3b))}`)

  // Đổi mức mặc định của kênh — KHÔNG được lan ngược cho đơn đang mở
  await api(`/masterdata/customer-channels/${chNpp.id}`, 'PUT', { date_rule: { kind: 'MIN_PCT', value: 65 } })
  const a1c = (await restAll('OutboundItem', `select=date_rule&id=eq.${a1b.id}`))[0]
  check('[3c] Đổi mức của KÊNH KHÔNG lan ngược — dòng đang mở giữ nguyên mức cũ',
    Number(a1c?.date_rule?.value) === 60, `rule=${JSON.stringify(a1c?.date_rule)}`)

  const rPre = await api('/wms/outbound/items/date-rule/apply-master?preflight=1', 'POST',
    { from: today, to: today, warehouse_id: wh.id })
  check('[3d] "Áp lại theo master" KIỂM TRƯỚC: trả báo cáo, chưa ghi gì',
    rPre.s === 200 && rPre.j?.data?.preflight === true, `${rPre.s} ${JSON.stringify(rPre.j?.data?.extra ?? '').slice(0, 120)}`)

  const rApply = await api('/wms/outbound/items/date-rule/apply-master', 'POST',
    { from: today, to: today, warehouse_id: wh.id })
  const a1d = (await restAll('OutboundItem', `select=date_rule&id=eq.${a1b.id}`))[0]
  const a3d = (await restAll('OutboundItem', `select=date_rule&id=eq.${a3b.id}`))[0]
  check('[3e] Áp lại theo master → dòng MÁY áp cập nhật mức mới (65 %)',
    rApply.s === 200 && Number(a1d?.date_rule?.value) === 65 && a1d?.date_rule?.source === 'CHANNEL',
    `${rApply.s} rule=${JSON.stringify(a1d?.date_rule)}`)
  check('[3f] …và dòng CHỐT TAY vẫn nguyên 70 % (kept_manual đếm được)',
    Number(a3d?.date_rule?.value) === 70 && a3d?.date_rule?.source === 'MANUAL' && Number(rApply.j?.data?.kept_manual ?? 0) >= 1,
    `rule=${JSON.stringify(a3d?.date_rule)} kept=${rApply.j?.data?.kept_manual}`)

  const ev = await restAll('outbound_events', `select=event_type,source&group_code=eq.${GC('01')}&event_type=eq.DATE_RULE_SET`)
  check('[3g] Mỗi lần áp lại đều có VẾT trong sổ chuyến (nguồn SYSTEM)',
    ev.some(e => e.source === 'SYSTEM'), `n=${ev.length} sources=${[...new Set(ev.map(e => e.source))].join(',')}`)

  // Trả kênh về 60 để không ảnh hưởng phép kiểm khác / lượt chạy sau
  await api(`/masterdata/customer-channels/${chNpp.id}`, 'PUT', { date_rule: { kind: 'MIN_PCT', value: 60 } })

  // ═══ [4] CẦN XEM — máy áp mà kho không còn pallet nào đạt ═════════════════════════════════════
  const bNow = (await restAll('OutboundItem', `select=date_rule&id=eq.${b.id}`))[0]
  check('[4a] Mức ≥ 99 % mà tồn cao nhất ≈ 95 % → vẫn áp nhưng gắn cờ CẦN XEM (review=NO_STOCK)',
    bNow?.date_rule?.review === 'NO_STOCK', `rule=${JSON.stringify(bNow?.date_rule)}`)
  check('[4b] …và KHÔNG chặn upload (đó là chuyện tồn kho, không phải lỗi file)',
    !!bNow?.date_rule, `rule=${JSON.stringify(bNow?.date_rule)}`)
  const a1e = (await restAll('OutboundItem', `select=date_rule&id=eq.${a1b.id}`))[0]
  check('[4c] Mức có hàng đạt thì KHÔNG gắn cờ (cờ chỉ nổi đúng chỗ cần nhìn)',
    a1e?.date_rule?.review == null, `rule=${JSON.stringify(a1e?.date_rule)}`)

  // ═══ [5] MÀN CHỐT %DATE — lọc theo NGUỒN + ô band ═════════════════════════════════════════════
  const rLines = await api(`/wms/outbound/date-rule-lines?date_from=${today}&date_to=${today}&warehouse_id=${wh.id}&page_size=200`)
  const sum = rLines.j?.data?.summary ?? {}
  check('[5a] Ô band có "cần xem" và "khách chưa kênh"',
    rLines.s === 200 && Number(sum.review ?? -1) >= 1 && Number(sum.no_channel ?? -1) >= 1,
    `review=${sum.review} no_channel=${sum.no_channel}`)

  const rChan = await api(`/wms/outbound/date-rule-lines?date_from=${today}&date_to=${today}&warehouse_id=${wh.id}&source=CHANNEL&page_size=200`)
  const chRows = rChan.j?.data?.rows ?? []
  check('[5b] Lọc nguồn = "theo kênh" chỉ trả dòng máy áp theo kênh',
    rChan.s === 200 && chRows.length > 0 && chRows.every(x => x.source === 'CHANNEL'),
    `n=${chRows.length} sources=${[...new Set(chRows.map(x => x.source))].join(',')}`)

  const rRev = await api(`/wms/outbound/date-rule-lines?date_from=${today}&date_to=${today}&warehouse_id=${wh.id}&source=REVIEW&page_size=200`)
  const revRows = rRev.j?.data?.rows ?? []
  check('[5c] Lọc "cần xem" chỉ trả dòng có cờ NO_STOCK',
    rRev.s === 200 && revRows.length > 0 && revRows.every(x => x.review === 'NO_STOCK'),
    `n=${revRows.length}`)

  const cRow = (rLines.j?.data?.rows ?? []).find(x => x.shipto_party === SHIP.C)
  check('[5d] Dòng mang theo TÊN KHÁCH + cờ đã phân kênh chưa (để biết vì sao chưa có mức)',
    !!cRow && cRow.customer_known === true && cRow.customer_has_channel === false,
    `known=${cRow?.customer_known} has_channel=${cRow?.customer_has_channel}`)

  const rSrcBad = await api(`/wms/outbound/date-rule-lines?date_from=${today}&date_to=${today}&source=XYZ`)
  check('[5e] Nguồn lạ → 400, không im lặng trả cả bảng', rSrcBad.s === 400, `${rSrcBad.s} ${err(rSrcBad)}`)

  // ═══ [6] LUẬT CHUYỂN KHO đọc Customer.warehouse_id ════════════════════════════════════════════
  // Khách TRỎ KHO ⇒ kho nhận vào app xác nhận (SCAN); khách ngoài ⇒ tài xế tự xác nhận (SELF).
  const quick = async (ship, plate, code) => api('/wms/outbound/quick-export', 'POST', {
    delivery_date: today, warehouse_id: wh.id, dvvt, customer_name: `KH ${ship}`,
    delivery_code: code, warehouse_type: CAT, shipto_party: ship, license_plate: plate,
    items: [{ material_code: mat.material_code, cartons_ordered: 10 }],
  })
  const rD = await quick(SHIP.D, `${T}XE01`, `${T}QD`)
  const rC = await quick(SHIP.C, `${T}XE02`, `${T}QC`)
  const orderOf = async gdoId => (await restAll('TmsOrder', `select=delivery_mode,destination_warehouse_id&transfer_gdo_id=eq.${gdoId}`))[0]
  const oD = rD.s === 201 || rD.s === 200 ? await orderOf(rD.j?.data?.id ?? rD.j?.data?.gdo?.id) : null
  const oC = rC.s === 201 || rC.s === 200 ? await orderOf(rC.j?.data?.id ?? rC.j?.data?.gdo?.id) : null
  check('[6a] Khách TRỎ KHO → lệnh chuyển kho đặt kho nhận + chờ kho nhận xác nhận (SCAN)',
    !!oD && oD.delivery_mode === 'SCAN' && oD.destination_warehouse_id === whDest.id,
    `${rD.s} ${err(rD)} mode=${oD?.delivery_mode} dest=${oD?.destination_warehouse_id === whDest.id}`)
  check('[6b] Khách KHÔNG trỏ kho → tài xế TỰ xác nhận (SELF) — vào danh mục không kéo theo nghĩa vụ xác nhận',
    !!oC && oC.delivery_mode === 'SELF', `${rC.s} ${err(rC)} mode=${oC?.delivery_mode}`)

  // ═══ [7] API Khách hàng / Kênh ════════════════════════════════════════════════════════════════
  const rDup = await api('/masterdata/customers', 'POST', { ship_to_code: SHIP.A, name: 'trùng' })
  check('[7a] Mã ship-to trùng → 409 (không đẻ khách đôi)', rDup.s === 409, `${rDup.s} ${err(rDup)}`)

  const rBadRule = await api('/masterdata/customers', 'POST', { ship_to_code: `${T}Z1`, name: 'z', date_rule: { kind: 'EXACT', value: '2026-01-01' } })
  check('[7b] Quy tắc master kiểu "chỉ định NSX" → 422 (đó là quyết định của TỪNG DÒNG)',
    rBadRule.s === 422, `${rBadRule.s} ${err(rBadRule)}`)

  const rBadPct = await api('/masterdata/customers', 'POST', { ship_to_code: `${T}Z2`, name: 'z', date_rule: { kind: 'MIN_PCT', value: 140 } })
  check('[7c] Mức %Date ngoài 1–100 → 422', rBadPct.s === 422, `${rBadPct.s} ${err(rBadPct)}`)

  const rBadCh = await api('/masterdata/customers', 'POST', { ship_to_code: `${T}Z3`, name: 'z', channel: 'KHONG_CO_KENH_NAY' })
  check('[7d] Kênh không có trong danh mục → 400 (gõ bừa là %Date im lặng không áp)',
    rBadCh.s === 400, `${rBadCh.s} ${err(rBadCh)}`)

  const rGhost = await api('/masterdata/customers/khong-ton-tai-123', 'PUT', { name: 'x' })
  check('[7e] Sửa khách không tồn tại → 404, không "đã lưu" giả', rGhost.s === 404, `${rGhost.s} ${err(rGhost)}`)

  const custC = (await restAll('Customer', `select=id&ship_to_code=eq.${SHIP.C}`))[0]
  const rBulkBoth = await api('/masterdata/customers/bulk', 'PATCH',
    { ids: [custC.id], filter: { search: T }, patch: { channel: 'NPP' } })
  check('[7f] Gửi CẢ ids lẫn filter → 400 (phạm vi phải rõ ràng, không đoán hộ)',
    rBulkBoth.s === 400, `${rBulkBoth.s} ${err(rBulkBoth)}`)

  const rBulkBadKey = await api('/masterdata/customers/bulk', 'PATCH', { ids: [custC.id], patch: { name: 'đổi tên hàng loạt' } })
  check('[7g] Thao tác hàng loạt KHÔNG đổi được trường ngoài danh sách cho phép → 400',
    rBulkBadKey.s === 400, `${rBulkBadKey.s} ${err(rBulkBadKey)}`)

  const rBulkIds = await api('/masterdata/customers/bulk', 'PATCH', { ids: [custC.id], patch: { channel: 'NPP' } })
  const cAfter = (await restAll('Customer', `select=channel&ship_to_code=eq.${SHIP.C}`))[0]
  check('[7h] Phân kênh hàng loạt theo danh sách đã tick', rBulkIds.s === 200 && cAfter?.channel === 'NPP',
    `${rBulkIds.s} channel=${cAfter?.channel}`)

  const rBulkFilter = await api('/masterdata/customers/bulk', 'PATCH',
    { filter: { search: T, has_channel: '0' }, patch: { channel: 'KHAC' } })
  const newAfter = (await restAll('Customer', `select=channel&ship_to_code=eq.${SHIP.NEW}`))[0]
  const aAfter = (await restAll('Customer', `select=channel&ship_to_code=eq.${SHIP.A}`))[0]
  check('[7i] Chọn-tất-cả theo BỘ LỌC: chỉ đụng khách khớp lọc, khách đã có kênh KHÔNG bị đổi',
    rBulkFilter.s === 200 && newAfter?.channel === 'KHAC' && aAfter?.channel === 'NPP',
    `${rBulkFilter.s} new=${newAfter?.channel} A=${aAfter?.channel}`)

  const rSeedCand = await api('/masterdata/customers/seed-candidates')
  check('[7j] Ứng viên nạp danh mục đọc được + đánh dấu khách đã có',
    rSeedCand.s === 200 && Array.isArray(rSeedCand.j?.data?.rows) && rSeedCand.j.data.rows.length > 0,
    `${rSeedCand.s} n=${rSeedCand.j?.data?.rows?.length}`)

  const rSeedPre = await api('/masterdata/customers/seed?preflight=1', 'POST',
    { rows: [{ ship_to_code: SHIP.A, name: 'x' }, { ship_to_code: `${T}SEED1`, name: 'mới' }] })
  check('[7k] Nạp danh mục KIỂM TRƯỚC: 1 mới · 1 đã có, chưa ghi gì',
    rSeedPre.s === 200 && rSeedPre.j?.data?.to_insert === 1 && rSeedPre.j?.data?.skipped === 1,
    `${rSeedPre.s} insert=${rSeedPre.j?.data?.to_insert} skip=${rSeedPre.j?.data?.skipped}`)
  const seededBefore = (await restAll('Customer', `select=id&ship_to_code=eq.${T}SEED1`)).length
  check('[7l] …và kiểm trước KHÔNG tạo bản ghi nào', seededBefore === 0, `n=${seededBefore}`)

  // Cờ chính sách phải đi được qua CỬA CỦA APP (form Kho), không chỉ qua đường ghi thẳng bảng:
  // thiếu tên cột trong whitelist của controller là ô trên form bấm xong không lưu được gì.
  const rWhPut = await api(`/masterdata/warehouses/${wh.id}`, 'PUT', { date_rule_policy: 'ALL' })
  const whAfter = (await restAll('Warehouse', `select=date_rule_policy&id=eq.${wh.id}`))[0]
  check('[7m] Lưu chính sách %Date qua form Kho (PUT) ăn thật',
    rWhPut.s === 200 && whAfter?.date_rule_policy === 'ALL', `${rWhPut.s} policy=${whAfter?.date_rule_policy}`)
  const rWhBad = await api(`/masterdata/warehouses/${wh.id}`, 'PUT', { date_rule_policy: 'LUNG_TUNG' })
  const whAfter2 = (await restAll('Warehouse', `select=date_rule_policy&id=eq.${wh.id}`))[0]
  check('[7n] Giá trị chính sách lạ → rơi về TẮT, không ghi rác vào DB (CHECK ở DB là lá chắn cuối)',
    whAfter2?.date_rule_policy === 'OFF', `${rWhBad.s} policy=${whAfter2?.date_rule_policy}`)

  // ═══ [8] Nhật ký quản trị ═════════════════════════════════════════════════════════════════════
  const audit = await restAll('admin_audit_events', "select=action&action=in.(CUSTOMER_BULK,CHANNEL_UPDATE)&order=created_at.desc&limit=20")
  check('[8a] Đổi danh mục Khách hàng / Kênh có vết Nhật ký quản trị',
    audit.some(a => a.action === 'CUSTOMER_BULK') && audit.some(a => a.action === 'CHANNEL_UPDATE'),
    `actions=${[...new Set(audit.map(a => a.action))].join(',')}`)

  // ═══ [9] Bảng MỚI phải ĐÓNG với vé của người dùng thường ══════════════════════════════════════
  // Cùng khuôn gói 40: bảng sinh sau là đúng chỗ default privileges có thể hở lại.
  const { readFrontendEnv, realtimeTokenValue } = await import('./lib.mjs')
  const envFE = readFrontendEnv()
  if (!envFE.VITE_SUPABASE_URL || !envFE.VITE_SUPABASE_ANON_KEY) {
    check('[9a] Bảng Customer đóng với anon/vé realtime', true, 'bỏ qua — không có frontend/.env (CI)')
  } else {
    const probe = async tok => {
      const res = await fetch(`${envFE.VITE_SUPABASE_URL}/rest/v1/Customer?select=id&limit=1`, {
        headers: { apikey: envFE.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}` },
      })
      const txt = await res.text()
      return { s: res.status, n: (() => { try { return JSON.parse(txt).length ?? -1 } catch { return -1 } })() }
    }
    const pAnon = await probe(envFE.VITE_SUPABASE_ANON_KEY)
    const pTicket = realtimeTokenValue() ? await probe(realtimeTokenValue()) : { s: 401, n: -1 }
    check('[9a] Bảng Customer ĐÓNG với anon + vé realtime (0 dòng / 401-403)',
      pAnon.n <= 0 && pTicket.n <= 0, `anon=${pAnon.s}/${pAnon.n} ticket=${pTicket.s}/${pTicket.n}`)
  }
} catch (e) {
  check('gói chạy tới cuối', false, String(e?.message ?? e).slice(0, 200))
} finally {
  await cleanup()
  const left = (await restAll('Customer', `select=id&ship_to_code=like.${T}*`)).length
    + (await restAll('GroupDeliveryOrder', `select=id&group_code=like.${T}*`)).length
  check('[dọn] fixture xoá sạch, không để lại rác', left === 0, `còn ${left} bản ghi`)
}

finish('58-customer-date-rule')
