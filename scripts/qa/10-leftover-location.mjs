// GÓI 10 — "PALLET ĐI KHÔNG HẾT PHẢI KHAI VỊ TRÍ PHẦN CÒN LẠI" (user chốt 30/07).
// Vì sao cần máy canh: luồng xuất trước đây KHÔNG BAO GIỜ đụng `location_id` — rất dễ có người
// sửa scanItem rồi đánh rơi nhánh này, và lỗi đó KHÔNG làm sai số lượng nên không ai thấy: chỉ
// tới lúc ra kho lấy hàng mới biết pallet không nằm ở chỗ hệ thống ghi.
// 6 bất biến (tự dựng fixture, tự dọn — chạy lúc nào cũng được):
//   1. pallet còn dư mà THIẾU vị trí → 422 và KHÔNG ghi gì (tồn nguyên, 0 scan entry)
//   2. vị trí khác kho / không tồn tại → chặn, tồn KHÔNG bị trừ
//   3. vị trí ĐÃ ĐẦY → chặn, và tồn phải được HOÀN NGUYÊN (đây là ca rollback, dễ hỏng nhất)
//   4. vị trí mới hợp lệ → xuất đúng số + pallet dư CHUYỂN sang vị trí mới
//   5. pallet đi HẾT → không đòi vị trí
//   6. nhặt lẻ → LUÔN đòi vị trí (chỉ giữ hàng, pallet vẫn còn hàng trên đó)
// usage: node scripts/qa/10-leftover-location.mjs
import { login, api, check, finish, restAll, restWrite } from './lib.mjs'
import { randomUUID } from 'crypto'

const TAG = 'QA-LEFTOVER'
console.log('── GÓI LEFTOVER-LOCATION ──')
await login()

const nowIso = () => new Date().toISOString()
const vnDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const created = { locs: [], entries: [], gdo: null, do: null, items: [] }

async function cleanup() {
  for (const id of created.items) await restWrite('OutboundScanEntry', 'DELETE', `item_id=eq.${id}`)
  for (const id of created.items) await restWrite('OutboundItem', 'DELETE', `id=eq.${id}`)
  if (created.do)  await restWrite('OutboundDelivery', 'DELETE', `id=eq.${created.do}`)
  if (created.gdo) await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${created.gdo}`)
  for (const id of created.entries) await restWrite('InventoryEntry', 'DELETE', `id=eq.${id}`)
  for (const id of created.locs)    await restWrite('Location', 'DELETE', `id=eq.${id}`)
}
// Tàn dư của lần chạy hỏng giữa chừng → dọn trước (fixture phải TỰ HỒI PHỤC)
for (const t of ['InventoryEntry', 'Location']) {
  const col = t === 'Location' ? 'location_code' : 'pallet_code'
  const olds = await restAll(t, `select=id&${col}=like.${TAG}-*`)
  for (const o of olds) await restWrite(t, 'DELETE', `id=eq.${o.id}`)
}

try {
  // ── Fixture: 1 kho có tồn thật + 4 vị trí + 4 pallet + 1 chuyến 3 dòng ──
  const anyEntry = (await restAll('InventoryEntry', 'select=warehouse_id,material_id&limit=1&cartons_remaining=gt.0'))[0]
  if (!anyEntry) { check('có dữ liệu tồn để dựng fixture', false, 'kho rỗng'); finish('LEFTOVER-LOCATION'); process.exit()  }
  const whId = anyEntry.warehouse_id
  const [mat] = await restAll('Material', `select=id,material_code,category&id=eq.${anyEntry.material_id}`)
  const otherWh = (await restAll('Warehouse', `select=id&id=neq.${whId}&limit=1`))[0]

  const mkLoc = async (code, maxPallets, wh = whId) => {
    const [row] = await restWrite('Location', 'POST', null, {
      id: randomUUID(), location_code: `${TAG}-${code}`, warehouse_id: wh, max_pallets: maxPallets,
      is_active: true, row: 'QA', shelf: '1', sub_code: `${TAG}-${code}`,
      created_at: nowIso(), updated_at: nowIso(),
    })
    created.locs.push(row.id)
    return { id: row.id, code: row.location_code }
  }
  const locSrc  = await mkLoc('SRC', 10)
  const locDest = await mkLoc('DEST', 10)
  const locFull = await mkLoc('FULL', 1)
  const locOther = otherWh ? await mkLoc('OTHERWH', 5, otherWh.id) : null

  const mkPallet = async (code, qty, locId) => {
    const [row] = await restWrite('InventoryEntry', 'POST', null, {
      id: randomUUID(), pallet_code: `${TAG}-${code}`, material_id: mat.id, warehouse_id: whId,
      location_id: locId, cartons_imported: qty, cartons_remaining: qty, cartons_reserved: 0,
      status: 'IN_STOCK', import_date: vnDate(), created_at: nowIso(), updated_at: nowIso(),
    })
    created.entries.push(row.id)
    return row.id
  }
  await mkPallet('FILLER', 50, locFull.id)          // lấp đầy vị trí FULL (max_pallets = 1)
  const pA = await mkPallet('A', 100, locSrc.id)    // xuất một phần
  const pB = await mkPallet('B', 40,  locSrc.id)    // xuất hết
  const pC = await mkPallet('C', 60,  locSrc.id)    // nhặt lẻ

  const [gdo] = await restWrite('GroupDeliveryOrder', 'POST', null, {
    id: randomUUID(), group_code: `${TAG}-GDO`, warehouse_id: whId, warehouse_type: mat.category,
    delivery_date: vnDate(), planned_date: vnDate(), status: 'IN_PROGRESS',
    license_plate: `${TAG}-XE`, started_at: nowIso(), created_at: nowIso(), updated_at: nowIso(),
  })
  created.gdo = gdo.id
  const [dlv] = await restWrite('OutboundDelivery', 'POST', null, {
    id: randomUUID(), gdo_id: gdo.id, delivery_code: `${TAG}-DO`, distributor_name: 'QA NPP',
    status: 'IN_PROGRESS', created_at: nowIso(), updated_at: nowIso(),
  })
  created.do = dlv.id
  const mkItem = async (ordered, loose = 0) => {
    const [row] = await restWrite('OutboundItem', 'POST', null, {
      id: randomUUID(), do_id: dlv.id, material_id: mat.id, material_code_raw: mat.material_code,
      cartons_ordered: ordered, cartons_scanned: 0, loose_picking: loose, status: 'PENDING',
      created_at: nowIso(), updated_at: nowIso(),
    })
    created.items.push(row.id)
    return row.id
  }
  const itPartial = await mkItem(30), itFull = await mkItem(40), itLoose = await mkItem(20, 20)

  const scan = (itemId, body) => api(`/wms/outbound/${gdo.id}/items/${itemId}/scan`, 'POST', body)
  const entryOf = async (id) => (await restAll('InventoryEntry',
    `select=cartons_remaining,cartons_reserved,status,location_id&id=eq.${id}`))[0]
  const scanCount = async (itemId) => (await restAll('OutboundScanEntry', `select=id&item_id=eq.${itemId}`)).length

  // 1) FE bản MỚI (khai leftover_ui) thiếu vị trí → 422, không ghi gì
  {
    const r = await scan(itPartial, { qr_code: `${TAG}-A`, cartons_override: 30, leftover_ui: true })
    const e = await entryOf(pA)
    check('FE mới thiếu vị trí + pallet còn dư → 422 và KHÔNG ghi gì',
      r.s === 422 && Number(e.cartons_remaining) === 100 && (await scanCount(itPartial)) === 0,
      `HTTP ${r.s} · tồn ${e.cartons_remaining}/100`)
  }

  // 1b) FE bản CŨ (PWA chưa cập nhật — KHÔNG khai leftover_ui, không gửi vị trí) → vẫn quét được,
  // pallet dư giữ chỗ cũ. Đây là lỗi thật user gặp 30/07: siết BE mà bundle cũ không có ô chọn ⇒
  // người quét bị khoá không lưu được gì. Sau khi lưu thì HOÀN NGUYÊN để các bước sau chạy tiếp.
  {
    const r = await scan(itPartial, { qr_code: `${TAG}-A`, cartons_override: 10 })
    const e = await entryOf(pA)
    check('FE CŨ (không khai cờ) vẫn quét được, pallet dư giữ chỗ cũ',
      r.s === 200 && Number(e.cartons_remaining) === 90 && e.location_id === locSrc.id,
      `HTTP ${r.s} · tồn ${e.cartons_remaining}/100 · ${r.j?.error?.message ?? ''}`)
    // hoàn nguyên: xoá scan entry vừa tạo + trả tồn
    const sc = await restAll('OutboundScanEntry', `select=id&item_id=eq.${itPartial}`)
    for (const s of sc) await restWrite('OutboundScanEntry', 'DELETE', `id=eq.${s.id}`)
    await restWrite('InventoryEntry', 'PATCH', `id=eq.${pA}`, { cartons_remaining: 100, status: 'IN_STOCK', updated_at: nowIso() })
    await restWrite('OutboundItem', 'PATCH', `id=eq.${itPartial}`, { cartons_scanned: 0, status: 'PENDING', updated_at: nowIso() })
  }

  // 2+3) vị trí không hợp lệ / đã đầy → chặn, tồn phải NGUYÊN VẸN (ca 'đầy' là rollback sau khi đã trừ)
  const badLocs = [[randomUUID(), 'không tồn tại'], [locFull.id, 'đã đầy']]
  if (locOther) badLocs.unshift([locOther.id, 'khác kho'])
  for (const [loc, label] of badLocs) {
    const r = await scan(itPartial, { qr_code: `${TAG}-A`, cartons_override: 30, leftover_ui: true, leftover_location_id: loc })
    const e = await entryOf(pA)
    check(`vị trí ${label} → chặn, tồn KHÔNG bị trừ`,
      (r.s === 422 || r.s === 409) && Number(e.cartons_remaining) === 100 && (await scanCount(itPartial)) === 0,
      `HTTP ${r.s} · tồn ${e.cartons_remaining}/100`)
  }

  // 4) vị trí mới hợp lệ → xuất OK + pallet dư chuyển chỗ
  {
    const r = await scan(itPartial, { qr_code: `${TAG}-A`, cartons_override: 30, leftover_ui: true, leftover_location_id: locDest.id })
    const e = await entryOf(pA)
    check('chọn vị trí mới → xuất 30, pallet dư 70 CHUYỂN sang vị trí mới',
      r.s === 200 && Number(e.cartons_remaining) === 70 && e.location_id === locDest.id && e.status === 'PARTIAL',
      `HTTP ${r.s} · tồn ${e.cartons_remaining} · ${e.status}`)
  }

  // 5) pallet đi HẾT → không đòi vị trí
  {
    const r = await scan(itFull, { qr_code: `${TAG}-B`, cartons_override: 40 })
    const e = await entryOf(pB)
    check('pallet đi HẾT → không đòi vị trí',
      r.s === 200 && Number(e.cartons_remaining) === 0 && e.status === 'EXPORTED', `HTTP ${r.s} · ${e.status}`)
  }

  // 6) nhặt lẻ → luôn đòi vị trí; KEEP giữ chỗ cũ
  {
    const miss = await scan(itLoose, { qr_code: `${TAG}-C`, cartons_override: 5, loose_picking_mode: true, leftover_ui: true })
    check('nhặt lẻ thiếu vị trí → 422 (pallet luôn còn hàng)', miss.s === 422, `HTTP ${miss.s}`)
    const r = await scan(itLoose, { qr_code: `${TAG}-C`, cartons_override: 5, loose_picking_mode: true, leftover_ui: true, leftover_location_id: 'KEEP' })
    const e = await entryOf(pC)
    check('nhặt lẻ + KEEP → giữ hàng 5, pallet Ở NGUYÊN chỗ cũ',
      r.s === 200 && Number(e.cartons_reserved) === 5 && e.location_id === locSrc.id,
      `HTTP ${r.s} · reserved ${e.cartons_reserved}`)
  }
} finally {
  await cleanup()
  const leftLoc = (await restAll('Location', `select=id&location_code=like.${TAG}-*`)).length
  const leftInv = (await restAll('InventoryEntry', `select=id&pallet_code=like.${TAG}-*`)).length
  check('DỌN SẠCH fixture', leftLoc + leftInv === 0, `còn ${leftLoc + leftInv} dòng`)
}

finish('LEFTOVER-LOCATION')
