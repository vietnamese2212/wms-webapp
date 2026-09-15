// GÓI 18 — FILL HÀNG PHỤC VỤ NHẶT LẺ (v3 gom lệnh theo DATE, 05/08).
//
// Vì sao phải có máy canh: cả tính năng đứng trên MỘT phép trừ — "cần" (nhặt lẻ còn lại của ngày
// xuất) trừ "đang có ở vị trí nhặt lẻ". Sai phép trừ đó thì KHÔNG có gì báo lỗi. Mô hình v3 thêm
// ba chỗ dễ vỡ mới: (a) hai người cùng ra lệnh MỘT (mã, date) → unique index; (b) quét theo
// MÃ+DATE (không ghim tem) — sai date phải bị chặn, nói rõ date yêu cầu; (c) commit = RPC
// fill_scan_apply MỘT transaction (move + vết + tiến độ) — hai người quét cùng tem chỉ 1 ăn.
//
// Các cụm kiểm, tự dựng fixture + tự dọn (chạy lúc nào cũng được):
//   1  cần/đang có/thiếu khớp ORACLE tự tính lại
//   2  pallet gợi ý là FEFO và VỪA ĐỦ bù thiếu
//   3  pallet ĐANG Ở vị trí nhặt lẻ không bao giờ được đề xuất hạ
//   4  ra lệnh → MỘT FillOrder + dòng theo (mã, DATE); dòng treo trừ vào phần "thiếu"
//   5  ĐUA: 2 người cùng ra lệnh 1 (mã, date) → đúng 1 dòng treo (unique index), người kia báo rõ
//   6  quét pallet SAI DATE → 409 DATE_MISMATCH, thông báo nêu NSX yêu cầu
//   7  preview KHÔNG ghi gì (tồn + tiến độ y nguyên)
//   8  vị trí đến ĐẦY → 400 LOCATION_FULL và dòng VẪN TREO (không mất việc)
//   9  đổi vị trí đến NGAY TRONG MÀN QUÉT (commit kèm to_location_id) → 200, pallet đổi chỗ,
//      SỐ LƯỢNG KHÔNG đổi, dòng DONE + vết quét + đích lưu lại + LỆNH rollup DONE
//   10 quét lại pallet đã hạ → 409 ALREADY_PICK_FACE (không nhân đôi)
//   11 hủy dòng → nhả phần đang giữ, phép trừ vẫn khớp; lệnh 1-dòng rollup CANCELLED
//   12 ĐUA QUÉT: 2 người commit CÙNG TEM cùng lúc → đúng 1 ăn (RPC khoá dòng lệnh)
//   13 ô tổng /fill/orders toàn cảnh · report · ?status= rỗng · thiếu kho 400
//   15 bộ lọc cờ vị trí (nhặt lẻ / cần check) THẬT SỰ cắt (bug 04/08)
//   16 bộ lọc Khu vực kho (`?zones=`)
//   17 đích fill PHẢI KHỚP LOẠI KHO của mã — đủ MỌI cửa: gợi ý RPC · đích chỉ định · đổi đích ·
//      tự chọn · ô chọn đích · ĐỔI ĐÍCH TRONG MÀN QUÉT
//   18 kho KHÔNG có vị trí nhặt lẻ nhận loại ⇒ mã bị LOẠI khỏi Đề xuất
//   19 fill_candidates: nguồn ngoài nhặt lẻ · FEFO · v3 KHÔNG loại pallet theo lệnh treo
// usage: node scripts/qa/18-fill-replenish.mjs
import { login, api, check, finish, restAll, restWrite } from './lib.mjs'
import { randomUUID } from 'crypto'

const TAG = 'QAFILL'
const nowIso = () => new Date().toISOString()
// Ngày xuất TƯƠNG LAI XA để nhu cầu + LỆNH của fixture không lẫn dữ liệu thật (cleanup lọc theo ngày này)
const DAY = '2026-12-21'

console.log('── GÓI FILL-REPLENISH (v3 gom lệnh theo DATE) ──')
await login()

const created = { locs: [], entries: [], gdo: null, do: null, items: [], mat2: null }
// Công tắc mượn của kho thật (cụm 22) — null = chưa đụng tới
let savedAutoFill = null
let savedTypeAutoFill
let savedTypeCode = null
async function cleanupOrders(whId) {
  // FillOrder → FillTask → FillTaskScan đều ON DELETE CASCADE; lệnh fixture nhận diện bằng DAY
  if (whId) await restWrite('FillOrder', 'DELETE', `warehouse_id=eq.${whId}&target_date=eq.${DAY}`).catch(() => {})
}
async function cleanup(whId) {
  await cleanupOrders(whId)
  await restWrite('FillOrder', 'DELETE', `order_code=eq.${TAG}-TODAY`).catch(() => {})
  // Công tắc "tự ra lệnh fill" mượn của kho thật → TRẢ LẠI đúng giá trị cũ (gói 22)
  if (whId && savedAutoFill !== null)
    await restWrite('Warehouse', 'PATCH', `id=eq.${whId}`, { auto_fill: savedAutoFill, updated_at: nowIso() }).catch(() => {})
  if (whId && savedTypeAutoFill !== undefined && savedTypeCode)
    await restWrite('warehouse_type_configs', 'PATCH', `warehouse_id=eq.${whId}&type_code=eq.${savedTypeCode}`,
      { auto_fill: savedTypeAutoFill, updated_at: nowIso() }).catch(() => {})
  if (created.gdo) await restWrite('wms_tasks', 'DELETE', `gdo_id=eq.${created.gdo}`).catch(() => {})
  for (const id of created.items)   await restWrite('OutboundScanEntry', 'DELETE', `item_id=eq.${id}`).catch(() => {})
  for (const id of created.items)   await restWrite('OutboundItem', 'DELETE', `id=eq.${id}`).catch(() => {})
  if (created.do)  await restWrite('OutboundDelivery', 'DELETE', `id=eq.${created.do}`).catch(() => {})
  if (created.gdo) await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${created.gdo}`).catch(() => {})
  for (const id of created.entries) {
    await restWrite('FillTaskScan', 'DELETE', `entry_id=eq.${id}`).catch(() => {})
    await restWrite('InventoryEntry', 'DELETE', `id=eq.${id}`).catch(() => {})
  }
  for (const id of created.locs)    await restWrite('Location', 'DELETE', `id=eq.${id}`).catch(() => {})
  if (created.mat2) await restWrite('Material', 'DELETE', `id=eq.${created.mat2}`).catch(() => {})
  if (created.mat3) await restWrite('Material', 'DELETE', `id=eq.${created.mat3}`).catch(() => {})
  // HÀNG ĐỢI ĐỐI CHIẾU XOÁ CUỐI CÙNG: chính các bước khôi phục ở trên (trả lại công tắc `auto_fill`,
  // trả ngày chuyến, xoá dòng hàng) đều kích trigger ghi lại (kho, ngày) — dọn trước là dọn hụt.
  if (whId) await restWrite('fill_reconcile_queue', 'DELETE', `warehouse_id=eq.${whId}`).catch(() => {})
}
// Tàn dư của lần chạy hỏng giữa chừng (fixture phải TỰ HỒI PHỤC)
for (const o of await restAll('FillOrder', `select=id&target_date=eq.${DAY}`))
  await restWrite('FillOrder', 'DELETE', `id=eq.${o.id}`).catch(() => {})
for (const g of await restAll('GroupDeliveryOrder', `select=id&group_code=like.${TAG}-*`)) {
  for (const d of await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`)) {
    for (const it of await restAll('OutboundItem', `select=id&do_id=eq.${d.id}`)) {
      await restWrite('OutboundScanEntry', 'DELETE', `item_id=eq.${it.id}`).catch(() => {})
      await restWrite('OutboundItem', 'DELETE', `id=eq.${it.id}`).catch(() => {})
    }
    await restWrite('OutboundDelivery', 'DELETE', `id=eq.${d.id}`).catch(() => {})
  }
  await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${g.id}`).catch(() => {})
}
for (const e of await restAll('InventoryEntry', `select=id&pallet_code=like.${TAG}-*`))
  await restWrite('FillTaskScan', 'DELETE', `entry_id=eq.${e.id}`).catch(() => {})
for (const t of ['InventoryEntry', 'Location']) {
  const col = t === 'Location' ? 'location_code' : 'pallet_code'
  for (const o of await restAll(t, `select=id&${col}=like.${TAG}-*`))
    await restWrite(t, 'DELETE', `id=eq.${o.id}`).catch(() => {})
}
for (const m of await restAll('Material', `select=id&material_code=like.${TAG}-*`))
  await restWrite('Material', 'DELETE', `id=eq.${m.id}`).catch(() => {})

let WH = null
try {
  // ── Fixture ────────────────────────────────────────────────────────────────
  // Mã fixture phải CÓ Loại kho (category not null) — không thì cụm 17 vô nghĩa (mã chưa khai
  // loại được hạ mọi chỗ theo luật null-inclusive).
  const catMats = (await restAll('Material', 'select=id&category=not.is.null')).slice(0, 50)
  const inList = catMats.map(m => m.id).join(',')
  const anyEntry = (inList
    ? await restAll('InventoryEntry', `select=warehouse_id,material_id&material_id=in.(${inList})&cartons_remaining=gt.0&limit=1`)
    : [])[0]
    ?? (await restAll('InventoryEntry', 'select=warehouse_id,material_id&limit=1&cartons_remaining=gt.0'))[0]
  if (!anyEntry) { check('có dữ liệu tồn để dựng fixture', false, 'kho rỗng'); finish('FILL-REPLENISH') }
  const whId = anyEntry.warehouse_id
  WH = whId
  const [mat] = await restAll('Material', `select=id,material_code,category,entry_unit,units_per_carton&id=eq.${anyEntry.material_id}`)

  const mkLoc = async (code, maxPallets, pickFace, needStocktake = false, cats = null) => {
    const [row] = await restWrite('Location', 'POST', null, {
      id: randomUUID(), location_code: `${TAG}-${code}`, warehouse_id: whId, max_pallets: maxPallets,
      is_active: true, is_pick_face: pickFace, requires_stocktake: needStocktake, categories: cats,
      row: 'QA', shelf: pickFace ? 'T1' : 'T3',
      sub_code: `${TAG}-${code}`, created_at: nowIso(), updated_at: nowIso(),
    })
    created.locs.push(row.id)
    return { id: row.id, code: row.location_code }
  }
  // 2 vị trí nhặt lẻ fixture khai ĐÚNG loại của mã (KHÔNG để NULL — NULL nhận mọi hàng làm
  // phép kiểm 18 vô nghĩa). locBad = khác loại + trống NHIỀU NHẤT + chứa sẵn mã → nếu luật
  // loại vắng mặt thì mọi cửa chọn đích rơi vào đây.
  const locRsv  = await mkLoc('RSV',  10, false)
  const locPF   = await mkLoc('PF',    5, true, true, [mat.category])
  const locFull = await mkLoc('FULL',  1, true, false, [mat.category])
  const locBad  = await mkLoc('BAD',  50, true, false, ['__QAKHAC__'])

  // NSX lệch nhau để kiểm FEFO + kiểm quét-theo-DATE
  const mkPallet = async (code, qty, locId, prodDaysAgo = 0, reserved = 0) => {
    const d = new Date(); d.setDate(d.getDate() - prodDaysAgo)
    const [row] = await restWrite('InventoryEntry', 'POST', null, {
      id: randomUUID(), pallet_code: `${TAG}-${code}`, material_id: mat.id, warehouse_id: whId,
      location_id: locId, cartons_imported: qty, cartons_remaining: qty, cartons_reserved: reserved,
      status: 'IN_STOCK', stack_layer: 1, production_date: d.toISOString(),
      import_date: nowIso(), created_at: nowIso(), updated_at: nowIso(),
    })
    created.entries.push(row.id)
    return { id: row.id, code: row.pallet_code, qty, date: d.toISOString().slice(0, 10) }
  }
  // Tồn THẬT của mã ở vị trí nhặt lẻ thật của kho — đo TRƯỚC khi bơm fixture để "thiếu" luôn = 100
  const pfIdsReal = (await restAll('Location', `select=id&warehouse_id=eq.${whId}&is_pick_face=is.true`))
    .map(l => l.id).slice(0, 300)
  const realPF = !pfIdsReal.length ? 0 : (await restAll('InventoryEntry',
    `select=cartons_remaining,cartons_reserved&material_id=eq.${mat.id}&status=in.(IN_STOCK,PARTIAL,LOOSE_PICKING)&cartons_remaining=gt.0&location_id=in.(${pfIdsReal.join(',')})`))
    .reduce((s, e) => s + Math.max(0, Number(e.cartons_remaining) - Number(e.cartons_reserved ?? 0)), 0)

  await mkPallet('FILLER', 30, locFull.id, 1)              // lấp đầy vị trí FULL (max = 1)
  // Kho lẻ ĐẦY hàng nhưng là lô MỚI (2 ngày) — tái hiện đúng hiện trạng Ba Vì 15/09: tồn ở kho lẻ
  // thừa thãi mà không có lô nào đúng thứ tự ⇒ vẫn PHẢI fill. Chỉ 45 là lô ĐÚNG (cùng NSX với pA).
  const pOnPF = await mkPallet('ONPF', 200, locPF.id, 2)   // ĐANG Ở vị trí nhặt lẻ → là "đang có"
  await mkPallet('ONPFOK', 45, locPF.id, 500)              // ở kho lẻ VÀ đúng lô ⇒ khỏi fill 45
  await mkPallet('BADSTOCK', 5, locBad.id, 3)              // locBad chứa sẵn mã (bẫy cụm 17)
  // NSX fixture phải GIÀ HƠN mọi tồn thật của mã (mã chọn ngẫu nhiên từ kho — staging dữ liệu
  // lớn có pallet thật NSX ~105 ngày ⇒ 90 ngày thua FEFO, check 2c đỏ oan dù app gợi ý ĐÚNG)
  const pA = await mkPallet('A', 60, locRsv.id, 500)       // FEFO: cũ nhất
  const pB = await mkPallet('B', 60, locRsv.id, 470)
  const pC = await mkPallet('C', 60, locRsv.id, 440)       // mới nhất (trong bộ fixture)

  // Nhu cầu CỐ ĐỊNH: thiếu kỳ vọng = 145 − 45 (phần ĐÚNG LÔ ở kho lẻ) = 100.
  // (Trước 15/09 công thức phải cộng `realPF` để triệt tiêu tồn thật ở kho lẻ; nay "có" chỉ tính
  //  hàng ĐÚNG LÔ nên tồn thật lô khác không còn triệt tiêu được — và đó chính là điều phải kiểm.)
  const LOOSE = 145
  const [gdo] = await restWrite('GroupDeliveryOrder', 'POST', null, {
    id: randomUUID(), group_code: `${TAG}-GDO`, warehouse_id: whId, warehouse_type: mat.category,
    delivery_date: DAY, planned_date: DAY, status: 'PENDING',
    license_plate: TAG + 'XE', created_at: nowIso(), updated_at: nowIso(),
  })
  created.gdo = gdo.id
  const [dlv] = await restWrite('OutboundDelivery', 'POST', null, {
    id: randomUUID(), gdo_id: gdo.id, delivery_code: `${TAG}-DO`, distributor_name: 'QA NPP',
    status: 'PENDING', created_at: nowIso(), updated_at: nowIso(),
  })
  created.do = dlv.id
  const [item] = await restWrite('OutboundItem', 'POST', null, {
    id: randomUUID(), do_id: dlv.id, material_id: mat.id, material_code_raw: mat.material_code,
    cartons_ordered: LOOSE + 250, cartons_scanned: 0, loose_picking: LOOSE, status: 'PENDING',
    created_at: nowIso(), updated_at: nowIso(),
  })
  created.items.push(item.id)

  // Mã LOẠI KHÔNG ĐƯỢC PHỤC VỤ (kiểm 18) — kỳ vọng tính ĐỘNG từ DB
  const [mat2] = await restWrite('Material', 'POST', null, {
    id: randomUUID(), material_code: `${TAG}-M2`, material_description: 'QA fill no-pickface',
    short_name: 'QA fill no-pickface', category: '__QANOPF__',
    created_at: nowIso(), updated_at: nowIso(),
  })
  created.mat2 = mat2.id
  const [item2] = await restWrite('OutboundItem', 'POST', null, {
    id: randomUUID(), do_id: dlv.id, material_id: mat2.id, material_code_raw: mat2.material_code,
    cartons_ordered: 60, cartons_scanned: 0, loose_picking: 60, status: 'PENDING',
    created_at: nowIso(), updated_at: nowIso(),
  })
  created.items.push(item2.id)

  const demandOf = async () => {
    const r = await api(`/wms/fill/demand?warehouse_id=${whId}&date=${DAY}`)
    const row = (r.j?.data?.rows ?? []).find(x => x.material_id === mat.id)
    return { s: r.s, row, all: r.j?.data }
  }
  const mkOrder = (lines, extra = {}) => api('/wms/fill/orders', 'POST', {
    warehouse_id: whId, target_date: DAY,
    lines: lines.map(l => ({ qty_base: 60, required_pallets: 1, ...l, material_id: l.material_id ?? mat.id })),
    ...extra,
  })
  const scan = (qr, body = {}) => api('/wms/fill/scan', 'POST', { qr, warehouse_id: whId, ...body })
  const lineOf = async (reqDate) => (await restAll('FillTask',
    `select=*&warehouse_id=eq.${whId}&target_date=eq.${DAY}&material_id=eq.${mat.id}&required_date=eq.${reqDate}&order=created_at.desc&limit=5`))[0]

  // ── 1. Oracle cần / đang có / thiếu ────────────────────────────────────────
  const pfRows = await restAll('InventoryEntry',
    `select=cartons_remaining,cartons_reserved,location_id&material_id=eq.${mat.id}&status=in.(IN_STOCK,PARTIAL,LOOSE_PICKING)&cartons_remaining=gt.0`)
  const pfLocIds = new Set((await restAll('Location',
    `select=id&warehouse_id=eq.${whId}&is_pick_face=is.true`)).map(l => l.id))
  const oraclePF = pfRows.filter(e => pfLocIds.has(e.location_id))
    .reduce((s, e) => s + Math.max(0, Number(e.cartons_remaining) - Number(e.cartons_reserved ?? 0)), 0)
  // ORACLE "ĐÚNG LÔ" — tự cài lại, KHÔNG gọi code app (15/09): "đang có ở kho lẻ" chỉ tính là CÓ khi
  // đó là lô ĐÚNG THỨ TỰ; kho lẻ giữ lô mới trong khi lô cũ nằm trên kệ thì vẫn phải fill (nhặt ở đó
  // là vi phạm chính luật luân chuyển kho đang chạy). Trước 15/09 phép kiểm này KHOÁ luật cũ lại.
  const [matFull] = await restAll('Material', `select=shelf_life_days&id=eq.${mat.id}`)
  const qaHoldQA = new Set((await restAll('QAStatus', 'select=id,code'))
    .filter(q => String(q.code).toUpperCase() !== 'OK').map(q => q.id))
  const okAtPickFace = async () => {
    const es = await restAll('InventoryEntry',
      `select=location_id,cartons_remaining,cartons_reserved,production_date,expiry_date,shelf_life_days,qa_status_id,status&material_id=eq.${mat.id}&warehouse_id=eq.${whId}&cartons_remaining=gt.0`)
    const live = es.filter(e => ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING'].includes(e.status)
      && !(e.qa_status_id && qaHoldQA.has(e.qa_status_id))
      && Math.max(0, Number(e.cartons_remaining) - Number(e.cartons_reserved ?? 0)) > 0)
    const keyOf = e => e.expiry_date ? Date.parse(e.expiry_date)
      : (e.production_date && (e.shelf_life_days ?? matFull?.shelf_life_days)
        ? Date.parse(e.production_date) + Number(e.shelf_life_days ?? matFull.shelf_life_days) * 864e5 : null)
    const keyed = live.map(e => ({ ...e, k: keyOf(e) })).filter(e => e.k != null).sort((a, b) => a.k - b.k)
    const best = keyed[0]?.k ?? null
    return keyed.filter(e => pfLocIds.has(e.location_id) && e.k === best)
      .reduce((s, e) => s + Math.max(0, Number(e.cartons_remaining) - Number(e.cartons_reserved ?? 0)), 0)
  }
  const ok1 = await okAtPickFace()
  const d1 = await demandOf()
  check('1a. "Cần nhặt lẻ" khớp oracle', Number(d1.row?.demand_base) === LOOSE,
    `api=${d1.row?.demand_base} oracle=${LOOSE}`)
  check('1b. "Đang có ở vị trí nhặt lẻ" khớp oracle', Number(d1.row?.pick_face_base) === oraclePF,
    `api=${d1.row?.pick_face_base} oracle=${oraclePF}`)
  check('1c. "Thiếu" = cần − ĐÚNG LÔ ở kho lẻ − đang có lệnh',
    Number(d1.row?.short_base) === Math.max(0, LOOSE - ok1 - Number(d1.row?.pending_base ?? 0))
      && Number(d1.row?.pick_face_ok_base) === ok1,
    `thiếu=${d1.row?.short_base} · đúng lô api=${d1.row?.pick_face_ok_base} oracle=${ok1} (tổng ở kho lẻ ${oraclePF})`)
  // Ca SINH RA bản vá: kho lẻ ĐẦY hàng nhưng toàn lô mới ⇒ app từng báo "thiếu 0" và KHÔNG ra lệnh
  // fill được, trong khi bảng "Theo vị trí" lại đang đòi fill (đo Ba Vì: 8/8 mã, kho lẻ 45.259 hộp).
  check('1d. Kho lẻ có hàng nhưng SAI LÔ ⇒ vẫn báo thiếu VÀ vẫn có pallet để hạ (không phải ngõ cụt)',
    ok1 < oraclePF ? (Number(d1.row?.short_base) > 0 && (d1.row?.suggestions ?? []).length > 0) : true,
    `đúng lô=${ok1}/${oraclePF} thiếu=${d1.row?.short_base} gợi ý=${(d1.row?.suggestions ?? []).length} pallet`)

  // ── 1e. MỨC %DATE CỦA DÒNG ĐƠN quyết định "lô đúng" (15/09) ───────────────
  // Không đọc mức thì màn này đòi hạ một lô mà CHÍNH đơn không được phép lấy (đo Ba Vì: mã
  // 510000155 — lộ trình bảo "lấy ngay ở kho lẻ" vì lô ở đó đạt ≥ 60 %, Fill lại bảo "hạ lô cũ
  // hơn xuống", mà lô đó dưới mức nên hạ xuống cũng không ai lấy được).
  {
    const [m3] = await restWrite('Material', 'POST', null, {
      id: randomUUID(), material_code: `${TAG}-M3`, material_description: 'QA fill date-rule',
      short_name: 'QA fill date-rule', category: mat.category, shelf_life_days: 365,
      created_at: nowIso(), updated_at: nowIso(),
    })
    created.mat3 = m3.id
    const mk3 = async (code, qty, locId, prodOff, expOff) => {
      const dt = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
      const [row] = await restWrite('InventoryEntry', 'POST', null, {
        id: randomUUID(), pallet_code: `${TAG}-${code}`, material_id: m3.id, warehouse_id: whId,
        location_id: locId, cartons_imported: qty, cartons_remaining: qty, cartons_reserved: 0,
        status: 'IN_STOCK', production_date: dt(prodOff), expiry_date: dt(expOff),
        import_date: nowIso(), created_at: nowIso(), updated_at: nowIso(),
      })
      created.entries.push(row.id)
      return row
    }
    await mk3('OLD3', 100, locRsv.id, -355, 10)     // %Date ≈ 2,7 % — CŨ nhất nhưng dòng KHÔNG lấy được
    await mk3('NEW3', 100, locPF.id, -5, 360)       // %Date ≈ 98,6 % — đạt mức, ĐANG Ở kho lẻ
    const [it3] = await restWrite('OutboundItem', 'POST', null, {
      id: randomUUID(), do_id: dlv.id, material_id: m3.id, material_code_raw: m3.material_code,
      cartons_ordered: 50, cartons_scanned: 0, loose_picking: 50, status: 'PENDING',
      date_rule: { kind: 'MIN_PCT', value: 60, source: 'MANUAL', set_at: nowIso() },
      created_at: nowIso(), updated_at: nowIso(),
    })
    created.items.push(it3.id)
    const dm3 = await api(`/wms/fill/demand?warehouse_id=${whId}&date=${DAY}`)
    const r3 = (dm3.j?.data?.rows ?? []).find(x => x.material_id === m3.id)
    check('1e. Lô ĐẠT MỨC của dòng đã nằm ở kho lẻ ⇒ KHÔNG đòi fill (dù có lô cũ hơn trên kệ)',
      Number(r3?.short_base) === 0 && Number(r3?.pick_face_ok_base) >= 50,
      `thiếu=${r3?.short_base} đúng lô=${r3?.pick_face_ok_base} gợi ý=${(r3?.suggestions ?? []).length}`)
  }

  // ── 2. Gợi ý FEFO + vừa đủ ────────────────────────────────────────────────
  const sug = d1.row?.suggestions ?? []
  const sumSug = sug.reduce((s, x) => s + Number(x.avail), 0)
  const sumNoLast = sumSug - Number(sug[sug.length - 1]?.avail ?? 0)
  check('2a. Pallet gợi ý đủ bù phần thiếu', sumSug >= Number(d1.row?.short_base),
    `Σgợi ý=${sumSug} thiếu=${d1.row?.short_base}`)
  check('2b. Không thừa pallet (bỏ pallet cuối là KHÔNG đủ)', sumNoLast < Number(d1.row?.short_base),
    `Σ(bỏ cuối)=${sumNoLast}`)
  check('2c. Thứ tự FEFO — pallet NSX cũ nhất đứng đầu', sug[0]?.pallet_code === pA.code,
    `đầu=${sug[0]?.pallet_code} (kỳ vọng ${pA.code})`)

  // ── 3. Pallet đang ở vị trí nhặt lẻ KHÔNG được đề xuất hạ ─────────────────
  check('3. Pallet đang ở vị trí nhặt lẻ không bị đề xuất hạ',
    !sug.some(x => x.entry_id === pOnPF.id), `gợi ý gồm ${sug.length} pallet`)

  // ── 4. Ra lệnh → MỘT FillOrder + dòng theo (mã, DATE) trừ vào phần thiếu ──
  const short0 = Number(d1.row?.short_base)
  const mk = await mkOrder([{ required_date: pA.date, to_location_id: locPF.id }])
  check('4a. Ra lệnh trả 201 + tạo 1 lệnh 1 dòng', mk.s === 201 && mk.j?.data?.created === 1 && !!mk.j?.data?.order_code,
    `http=${mk.s} created=${mk.j?.data?.created} code=${mk.j?.data?.order_code}`)
  const order1 = mk.j?.data?.order_id
  const lineA = await lineOf(pA.date)
  check('4b. Dòng lệnh mang DATE + %Date nguyên liệu (không ghim tem)',
    !!lineA && lineA.required_date === pA.date && lineA.entry_id === null && Number(lineA.required_pallets) === 1,
    `required_date=${lineA?.required_date} entry_id=${lineA?.entry_id}`)
  const d2 = await demandOf()
  check('4c. Dòng treo trừ vào phần thiếu (không ra lệnh chồng)',
    Number(d2.row?.pending_base) === 60 && Number(d2.row?.short_base) === Math.max(0, short0 - 60),
    `treo=${d2.row?.pending_base} thiếu=${d2.row?.short_base} (trước=${short0})`)
  const ordList = await api(`/wms/fill/orders?warehouse_id=${whId}`)
  const ordRow = (ordList.j?.data?.rows ?? []).find(o => o.id === order1)
  check('4d. Danh sách lệnh gom: 1 dòng mã, 1 pallet cần', ordList.s === 200 && ordRow?.lines_n === 1 && Number(ordRow?.pallets_req) === 1,
    `lines=${ordRow?.lines_n} pallets_req=${ordRow?.pallets_req}`)

  // ── 5. ĐUA: 2 người cùng ra lệnh MỘT (mã, date) — từ 05/08 người thua CỘNG DỒN (đơn phát sinh) ──
  const [r1, r2] = await Promise.all([
    mkOrder([{ required_date: pB.date, to_location_id: locPF.id }]),
    mkOrder([{ required_date: pB.date, to_location_id: locPF.id }]),
  ])
  const pendB = await restAll('FillTask',
    `select=id,qty_base&warehouse_id=eq.${whId}&target_date=eq.${DAY}&material_id=eq.${mat.id}&required_date=eq.${pB.date}&status=eq.PENDING`)
  const nCreated = (r1.j?.data?.created ?? 0) + (r2.j?.data?.created ?? 0)
  const nSkipped = (r1.j?.data?.skipped?.length ?? 0) + (r2.j?.data?.skipped?.length ?? 0)
  const nMerged = (r1.j?.data?.merged?.length ?? 0) + (r2.j?.data?.merged?.length ?? 0)
  check('5a. Hai người cùng ra lệnh 1 (mã,date) → đúng 1 dòng treo', pendB.length === 1,
    `dòng treo=${pendB.length} created=${nCreated}`)
  check('5b. Người thua CỘNG DỒN vào dòng người thắng (không nuốt, không đôi lệnh)',
    nCreated === 1 && nMerged === 1 && nSkipped === 0 && Number(pendB[0]?.qty_base) === 120,
    `created=${nCreated} merged=${nMerged} skipped=${nSkipped} qty=${pendB[0]?.qty_base}`)

  // ── 6. Quét SAI DATE → chặn + nói rõ date yêu cầu ─────────────────────────
  const scanWrong = await scan(pC.code, { commit: true })
  check('6a. Pallet sai date → 409 DATE_MISMATCH',
    scanWrong.s === 409 && scanWrong.j?.error?.code === 'DATE_MISMATCH',
    `http=${scanWrong.s} code=${scanWrong.j?.error?.code}`)
  check('6b. Thông báo nêu rõ NSX yêu cầu (user chốt: thể hiện date yêu cầu)',
    /NSX/.test(scanWrong.j?.error?.message ?? ''), `msg="${scanWrong.j?.error?.message}"`)

  // ── 7. PREVIEW không ghi gì ───────────────────────────────────────────────
  const pv = await scan(pA.code)
  const lineA7 = await lineOf(pA.date)
  const entA7 = (await restAll('InventoryEntry', `select=location_id&id=eq.${pA.id}`))[0]
  check('7a. Preview trả dòng lệnh + vị trí đến', pv.s === 200 && pv.j?.data?.preview === true
    && pv.j?.data?.task?.id === lineA7?.id && pv.j?.data?.dest?.id === locPF.id,
    `http=${pv.s} task=${pv.j?.data?.task?.id === lineA7?.id} dest=${pv.j?.data?.dest?.code}`)
  check('7b. Preview KHÔNG ghi gì (tồn + tiến độ y nguyên)',
    entA7?.location_id === locRsv.id && Number(lineA7?.scanned_pallets) === 0,
    `loc=${entA7?.location_id === locRsv.id ? 'RSV' : entA7?.location_id} scanned=${lineA7?.scanned_pallets}`)

  // ── 8. Vị trí đến ĐẦY ─────────────────────────────────────────────────────
  await api(`/wms/fill/tasks/${lineA7.id}`, 'PATCH', { to_location_id: locFull.id })
  const scanFull = await scan(pA.code, { commit: true })
  const lineA8 = await lineOf(pA.date)
  check('8a. Vị trí đến đầy → 400 LOCATION_FULL',
    scanFull.s === 400 && scanFull.j?.error?.code === 'LOCATION_FULL', `http=${scanFull.s} code=${scanFull.j?.error?.code}`)
  check('8b. Đích đầy KHÔNG làm mất dòng lệnh (vẫn treo để đổi đích)', lineA8?.status === 'PENDING', `status=${lineA8?.status}`)

  // ── 9. Đổi vị trí đến NGAY TRONG MÀN QUÉT + commit nguyên tử ──────────────
  const before = (await restAll('InventoryEntry', `select=cartons_remaining,location_id&id=eq.${pA.id}`))[0]
  const scanOk = await scan(pA.code, { commit: true, to_location_id: locPF.id })
  const after = (await restAll('InventoryEntry', `select=cartons_remaining,location_id&id=eq.${pA.id}`))[0]
  const lineA9 = await lineOf(pA.date)
  const scans9 = await restAll('FillTaskScan', `select=entry_id,qty_base&task_id=eq.${lineA9?.id}`)
  const [order1Row] = await restAll('FillOrder', `select=status&id=eq.${order1}`)
  check('9a. Commit → 200, dòng DONE, tiến độ 1/1 pallet',
    scanOk.s === 200 && lineA9?.status === 'DONE' && Number(lineA9?.scanned_pallets) === 1
      && Number(lineA9?.qty_done_base) === 60,
    `http=${scanOk.s} status=${lineA9?.status} scanned=${lineA9?.scanned_pallets} qty_done=${lineA9?.qty_done_base}`)
  check('9b. Pallet ĐỔI vị trí sang đích đã đổi trong màn quét (đích lưu vào dòng)',
    after?.location_id === locPF.id && lineA9?.to_location_id === locPF.id,
    `loc=${after?.location_id === locPF.id ? 'PF' : after?.location_id} line_dest=${lineA9?.to_location_id === locPF.id ? 'PF' : lineA9?.to_location_id}`)
  check('9c. Fill KHÔNG đụng số lượng (chỉ chuyển chỗ)',
    Number(after?.cartons_remaining) === Number(before?.cartons_remaining),
    `trước=${before?.cartons_remaining} sau=${after?.cartons_remaining}`)
  check('9d. Có VẾT QUÉT (FillTaskScan) đúng tem đúng SL', scans9.length === 1
    && scans9[0].entry_id === pA.id && Number(scans9[0].qty_base) === 60,
    `scans=${scans9.length}`)
  // 15/09 — LỆNH LÀ SỔ CỦA CẢ NGÀY: hạ xong dòng cuối KHÔNG đóng lệnh. Tự đóng thì 10h sáng đóng,
  // 11h có đơn mới là phải mở lại một chứng từ đã đóng. Đóng sổ là việc của 'Chốt ngày'.
  check('9e. Hạ xong dòng cuối, lệnh của NGÀY vẫn ĐANG MỞ (chỉ chốt ngày mới đóng)',
    order1Row?.status === 'PENDING', `order=${order1Row?.status}`)

  // ── 10. Quét lại pallet đã hạ ─────────────────────────────────────────────
  const scanAgain = await scan(pA.code, { commit: true })
  check('10. Quét lại pallet đã hạ → 409 ALREADY_PICK_FACE (không nhân đôi)',
    scanAgain.s === 409 && scanAgain.j?.error?.code === 'ALREADY_PICK_FACE',
    `http=${scanAgain.s} code=${scanAgain.j?.error?.code}`)

  // ── 11. Hủy dòng → NHẢ phần đang giữ + lệnh rollup ────────────────────────
  const lineB = await lineOf(pB.date)
  const dBefore = await demandOf()
  const del = await api(`/wms/fill/tasks/${lineB.id}`, 'DELETE')
  const dAfter = await demandOf()
  const pendDrop = Number(dBefore.row?.pending_base) - Number(dAfter.row?.pending_base)
  // "có" ở đây là có ĐÚNG LÔ (15/09) — dùng lại đúng con số app trả để phép trừ vẫn kiểm được,
  // còn ĐỊNH NGHĨA của con số đó do [1c]/[1d] gác bằng oracle tự cài.
  const shortExp = Math.max(0, Number(dAfter.row?.demand_base) - Number(dAfter.row?.pick_face_ok_base) - Number(dAfter.row?.pending_base))
  const [orderB] = await restAll('FillOrder', `select=status&id=eq.${lineB.fill_order_id}`)
  // Kỳ vọng = qty THẬT của dòng lúc hủy (đua cụm 5 đã cộng dồn thành 120 — đừng hard-code 60)
  check('11a. Hủy dòng → NHẢ đúng lượng đang giữ', del.s === 200 && pendDrop === Number(lineB.qty_base),
    `treo ${dBefore.row?.pending_base} → ${dAfter.row?.pending_base} (giảm ${pendDrop}, kỳ vọng ${lineB.qty_base})`)
  check('11b. Sau khi hủy, phép trừ vẫn khớp (thiếu = cần − có − treo, kẹp sàn 0)',
    Number(dAfter.row?.short_base) === shortExp, `thiếu=${dAfter.row?.short_base} kỳ vọng=${shortExp}`)
  check('11c. Hủy dòng cuối, lệnh của NGÀY vẫn ĐANG MỞ (đơn phát sinh sau còn vào được sổ này)',
    orderB?.status === 'PENDING',
    `order=${orderB?.status}`)

  // ── 12. ĐUA QUÉT: 2 người commit CÙNG TEM cùng lúc → đúng 1 ăn ────────────
  const mk12 = await mkOrder([{ required_date: pC.date, qty_base: 120, required_pallets: 2, to_location_id: locPF.id }])
  const line12 = await lineOf(pC.date)
  const [s1, s2] = await Promise.all([
    scan(pC.code, { commit: true }),
    scan(pC.code, { commit: true }),
  ])
  const line12b = await lineOf(pC.date)
  const okN = [s1, s2].filter(r => r.s === 200).length
  check('12. Hai người commit cùng tem → đúng 1 ăn (RPC khoá dòng lệnh, không đếm đôi)',
    mk12.s === 201 && !!line12 && okN === 1 && Number(line12b?.scanned_pallets) === 1,
    `ok=${okN} scanned=${line12b?.scanned_pallets} codes=${s1.j?.error?.code ?? 'OK'}/${s2.j?.error?.code ?? 'OK'}`)
  await api(`/wms/fill/tasks/${line12.id}`, 'DELETE')   // dọn dòng 2-pallet còn treo

  // ── 13. Ô tổng toàn cảnh + ngữ nghĩa tham số ──────────────────────────────
  // 15/09: lệnh KHÔNG còn tự chuyển CANCELLED khi dòng cuối bị hủy (nó là sổ của cả ngày), nên
  // dựng thẳng một lệnh đã hủy làm mồi — phép kiểm này đo Ô TỔNG có đếm ngoài bộ lọc hay không,
  // không đo cách lệnh trở thành đã-hủy.
  const baitId = randomUUID()
  await restWrite('FillOrder', 'POST', null, {
    id: baitId, order_code: `QAFILL-CXL-${Date.now() % 1000000}`, warehouse_id: whId,
    target_date: DAY, status: 'CANCELLED', created_by: 'QA', created_at: nowIso(), updated_at: nowIso(),
  }).catch(() => {})
  const band = await api(`/wms/fill/orders?warehouse_id=${whId}&status=PENDING`)
  check('13a. Ô tổng /fill/orders đếm toàn cảnh (lọc "Chờ làm" vẫn thấy số đã hủy)',
    band.s === 200 && Number(band.j?.data?.cancelled_n) >= 1
      && (band.j?.data?.rows ?? []).every(r => r.status === 'PENDING'),
    `rows=${band.j?.data?.rows?.length} đã hủy=${band.j?.data?.cancelled_n}`)
  // Dọn con mồi NGAY: [21b] đếm "lệnh vỏ" trên MỌI lệnh của ngày, để lại là nó báo oan
  await restWrite('FillOrder', 'DELETE', `id=eq.${baitId}`).catch(() => {})
  const rep = await api(`/wms/fill/report?warehouse_id=${whId}&date_from=${DAY}&date_to=${DAY}`)
  const repRows = rep.j?.data?.rows ?? []
  const doneTotal = repRows.reduce((s, r) => s + Number(r.done_n), 0)
  const rateOk = repRows.every(r => Math.abs(r.rate - (r.total_n ? r.done_n * 100 / r.total_n : 0)) < 0.11)
  check('13b. Báo cáo đếm đúng số dòng đã hạ + tỷ lệ = xong/được giao',
    rep.s === 200 && doneTotal === 1 && rateOk, `done=${doneTotal} rows=${repRows.length}`)
  const empty = await api(`/wms/fill/orders?warehouse_id=${whId}&status=`)
  check('13c. `?status=` RỖNG trả RỖNG (không âm thầm bỏ lọc)',
    empty.s === 200 && (empty.j?.data?.rows ?? []).length === 0, `rows=${empty.j?.data?.rows?.length}`)
  const noWh = await api('/wms/fill/demand')
  check('13d. Thiếu kho → 400 (không dump dữ liệu kho khác)', noWh.s === 400, `http=${noWh.s}`)

  // ── 15. Bộ lọc cờ vị trí PHẢI THẬT SỰ CẮT (bug 04/08) ─────────────────────
  const locTotal = async qs => {
    const r = await api(`/masterdata/locations?warehouse_id=${whId}&page=1&page_size=1${qs}`)
    return { s: r.s, n: Number(r.j?.data?.total ?? -1) }
  }
  const oracleCount = async extra =>
    (await restAll('Location', `select=id&warehouse_id=eq.${whId}&is_active=is.true${extra}`)).length
  for (const [nhãn, qsKey, cột] of [['Vị trí nhặt lẻ', 'pick_face', 'is_pick_face'],
                                    ['Cần check hàng ngày', 'flag', 'requires_stocktake']]) {
    const [yes, no, all] = await Promise.all([
      locTotal(`&${qsKey}=1`), locTotal(`&${qsKey}=0`), locTotal(''),
    ])
    const oYes = await oracleCount(`&${cột}=is.true`)
    check(`15. Lọc "${nhãn}" = CÓ cắt đúng oracle`, yes.s === 200 && yes.n === oYes && oYes > 0,
      `api=${yes.n} oracle=${oYes}`)
    check(`15. Lọc "${nhãn}": có + chưa = tổng (cờ không bị bỏ rơi)`, yes.n + no.n === all.n,
      `${yes.n} + ${no.n} so với tổng ${all.n}`)
  }
  const sum = await api(`/masterdata/locations/summary?warehouse_id=${whId}&pick_face=1`)
  const pg1 = await locTotal('&pick_face=1')
  check('15. Ô tổng đếm cùng tập với danh sách', sum.s === 200 && Number(sum.j?.data?.count) === pg1.n,
    `band=${sum.j?.data?.count} danh sách=${pg1.n}`)

  // ── 16. Bộ lọc "Khu vực kho" (`?zones=`) ──────────────────────────────────
  const [z2, zEmpty, zSum] = await Promise.all([
    locTotal(`&zones=QAFILL-PF,QAFILL-FULL`),
    locTotal('&zones='),
    api(`/masterdata/locations/summary?warehouse_id=${whId}&zones=QAFILL-PF,QAFILL-FULL`),
  ])
  check('16a. Lọc theo 2 khu trả đúng 2 vị trí fixture', z2.s === 200 && z2.n === 2, `total=${z2.n}`)
  check('16b. `?zones=` RỖNG trả RỖNG (không âm thầm bỏ lọc)', zEmpty.s === 200 && zEmpty.n === 0,
    `total=${zEmpty.n}`)
  check('16c. Ô tổng cũng lọc theo khu', zSum.s === 200 && Number(zSum.j?.data?.count) === 2,
    `band=${zSum.j?.data?.count}`)

  // ── 17. VỊ TRÍ ĐÍCH PHẢI KHỚP LOẠI KHO của mã (user bắt 05/08) ─────────────
  check('17. (tiền đề) mã fixture có Loại kho', !!mat.category, `category=${mat.category}`)
  const d17 = await api(`/wms/fill/demand?warehouse_id=${whId}&date=${DAY}`)
  const row17 = (d17.j?.data?.rows ?? []).find(r => r.material_id === mat.id)
  check('17a. Gợi ý đích của RPC không rơi vào vị trí khác loại (dù nó chứa sẵn mã + trống nhất)',
    !!row17?.to_location?.id && row17.to_location.id !== locBad.id,
    `to_location=${row17?.to_location?.code ?? 'null'}`)

  const mkBad = await mkOrder([{ required_date: pB.date, to_location_id: locBad.id }])
  const badSkip = (mkBad.j?.data?.skipped ?? [])[0]
  check('17b. Ra lệnh với đích chỉ định KHÁC LOẠI → bị từ chối, báo rõ lý do',
    mkBad.s === 201 && mkBad.j?.data?.created === 0 && /Loại kho/i.test(badSkip?.reason ?? ''),
    `created=${mkBad.j?.data?.created} reason="${badSkip?.reason ?? ''}"`)

  const mk17 = await mkOrder([{ required_date: pB.date, to_location_id: locPF.id }])
  const line17 = await lineOf(pB.date)
  const patchBad = await api(`/wms/fill/tasks/${line17?.id}`, 'PATCH', { to_location_id: locBad.id })
  check('17c. Đổi đích sang vị trí khác loại → 400 CATEGORY_MISMATCH',
    mk17.s === 201 && patchBad.s === 400 && patchBad.j?.error?.code === 'CATEGORY_MISMATCH',
    `http=${patchBad.s} code=${patchBad.j?.error?.code}`)

  // Đổi đích TRONG MÀN QUÉT sang vị trí khác loại cũng phải chặn (cửa mới của v3)
  const scanBadDest = await scan(pB.code, { commit: true, to_location_id: locBad.id })
  check('17d. Đổi vị trí đến trong màn quét sang vị trí khác loại → 400 CATEGORY_MISMATCH',
    scanBadDest.s === 400 && scanBadDest.j?.error?.code === 'CATEGORY_MISMATCH',
    `http=${scanBadDest.s} code=${scanBadDest.j?.error?.code}`)

  const pfList = await api(`/wms/fill/pick-face-locations?warehouse_id=${whId}&material_id=${mat.id}`)
  const pfIds = (pfList.j?.data ?? []).map(l => l.id)
  check('17e. Ô chọn đích lọc theo loại của mã (không bày lựa chọn sẽ bị 400)',
    pfList.s === 200 && !pfIds.includes(locBad.id) && pfIds.includes(locPF.id),
    `${pfIds.length} vị trí, chứa BAD=${pfIds.includes(locBad.id)}`)

  // TỰ CHỌN đích (không gửi to_location_id): nếu luật vắng mặt, locBad thắng chắc
  await api(`/wms/fill/tasks/${line17?.id}`, 'DELETE')
  const mkAuto = await mkOrder([{ required_date: pB.date }])
  const autoSkip = (mkAuto.j?.data?.skipped ?? [])[0]
  const autoLine = await lineOf(pB.date)
  check('17f. Tự chọn đích KHÔNG lấy vị trí khác loại (dù nó chứa sẵn mã + trống nhất)',
    mkAuto.s === 201 && (mkAuto.j?.data?.created === 1
      ? autoLine?.to_location_id !== locBad.id && autoLine?.status === 'PENDING'
      : /Loại kho/i.test(autoSkip?.reason ?? '')),
    `created=${mkAuto.j?.data?.created} dest≠BAD=${autoLine?.to_location_id !== locBad.id}`)
  if (autoLine?.status === 'PENDING') await api(`/wms/fill/tasks/${autoLine.id}`, 'DELETE')

  // ── 18. Kho KHÔNG có vị trí nhặt lẻ nhận loại ⇒ mã bị LOẠI khỏi Đề xuất ────
  const accepts18 = await restAll('Location',
    `select=id,categories&warehouse_id=eq.${whId}&is_pick_face=is.true&is_active=is.true`)
  const servable18 = accepts18.some(l => !l.categories || l.categories.includes('__QANOPF__'))
  const d18 = await api(`/wms/fill/demand?warehouse_id=${whId}&date=${DAY}`)
  const row18 = (d18.j?.data?.rows ?? []).find(r => r.material_id === mat2.id)
  check('18. Mã loại kho KHÔNG phục vụ nhặt lẻ bị LOẠI khỏi Đề xuất (kỳ vọng động theo DB)',
    servable18 ? !!row18 : row18 === undefined,
    `kho ${servable18 ? 'CÓ' : 'KHÔNG có'} chỗ nhận '__QANOPF__' → dòng ${row18 ? 'CÓ' : 'KHÔNG'} trong Đề xuất`)

  // ── 19. fill_candidates — nguồn ngoài nhặt lẻ, FEFO, v3 KHÔNG loại theo lệnh treo ──
  // pA (cụm 9) và pC (cụm 12) đã hạ xuống locPF → phải VẮNG; pB còn tự do ở tầng trên
  // (phải CÓ — kể cả khi có lệnh treo, vì lệnh v3 không ghim pallet).
  const mk19 = await mkOrder([{ required_date: pB.date, to_location_id: locPF.id }])
  const cand19 = await api(`/wms/fill/candidates?warehouse_id=${whId}&material_id=${mat.id}`)
  const cRows = cand19.j?.data?.rows ?? []
  const cIds = new Set(cRows.map(c => c.entry_id))
  const keys19 = cRows.map(c => c.fefo_key)
  const firstNull = keys19.findIndex(k => !k)
  const nonNull = keys19.filter(Boolean)
  const fefoSorted = JSON.stringify(nonNull) === JSON.stringify([...nonNull].sort())
    && (firstNull === -1 || keys19.slice(firstNull).every(k => !k))
  check('19a. Candidates: có pallet tự do tầng trên, VẮNG mọi pallet đang ở vị trí nhặt lẻ, xếp FEFO',
    cand19.s === 200 && cIds.has(pB.id) && !cIds.has(pOnPF.id) && !cIds.has(pA.id) && !cIds.has(pC.id)
      && cRows.every(c => 'production_date' in c) && fefoSorted,
    `n=${cRows.length} FEFO=${fefoSorted} pB=${cIds.has(pB.id)} pA/pC vắng=${!cIds.has(pA.id) && !cIds.has(pC.id)}`)
  check('19b. v3: pallet vẫn xuất hiện dù (mã,date) đang có lệnh treo (lệnh không ghim tem)',
    mk19.s === 201 && cIds.has(pB.id), `pB trong danh sách=${cIds.has(pB.id)}`)
  const line19 = await lineOf(pB.date)
  if (line19?.status === 'PENDING') await api(`/wms/fill/tasks/${line19.id}`, 'DELETE')
  const candBad = await api(`/wms/fill/candidates?warehouse_id=${whId}&material_id=khong-phai-uuid`)
  check('19c. material_id không hợp lệ → 400 (không 500)', candBad.s === 400, `http=${candBad.s}`)

  // ── 20. Pallet CHƯA GÁN VỊ TRÍ (location_id NULL) vẫn quét fill được ────────
  // Bug user bắt 05/08: kho của pallet từng suy qua JOIN Location nên pallet chưa gán vị trí
  // (phổ biến ngay sau quét nhập) bị chối "không tìm thấy trong kho" ở controller và
  // WRONG_WAREHOUSE ở RPC. Luật: lọc kho bằng cột warehouse_id TRỰC TIẾP của entry.
  const locPF20 = await mkLoc('PF20', 2, true, false, [mat.category])
  const pNoLoc = await mkPallet('NOLOC', 48, null, 120)
  const mk20 = await mkOrder([{ required_date: pNoLoc.date, to_location_id: locPF20.id }])
  const prev20 = await scan(pNoLoc.code)
  check('20a. Preview pallet chưa gán vị trí → 200 khớp dòng lệnh (không PALLET_NOT_FOUND)',
    mk20.s === 201 && prev20.s === 200 && prev20.j?.data?.entry?.entry_id === pNoLoc.id,
    `mk=${mk20.s} scan=${prev20.s} code=${prev20.j?.error?.code ?? 'OK'}`)
  const cm20 = await scan(pNoLoc.code, { commit: true })
  const ent20 = (await restAll('InventoryEntry', `select=location_id&id=eq.${pNoLoc.id}`))[0]
  check('20b. Commit → RPC hạ pallet chưa-gán-vị-trí về đúng vị trí nhặt lẻ',
    cm20.s === 200 && ent20?.location_id === locPF20.id,
    `http=${cm20.s} code=${cm20.j?.error?.code ?? 'OK'} loc=${ent20?.location_id === locPF20.id ? 'PF20' : ent20?.location_id}`)

  // ── 21. ĐƠN PHÁT SINH — ra lệnh trùng (mã,date) đang treo = CỘNG DỒN vào dòng cũ ──
  const mk21a = await mkOrder([{ required_date: pB.date, to_location_id: locPF.id }])
  const mk21b = await mkOrder([{ required_date: pB.date, to_location_id: locPF.id }])
  const m21 = (mk21b.j?.data?.merged ?? [])[0]
  const line21 = await lineOf(pB.date)
  check('21a. Lệnh trùng (mã,date) → created=0 + merged trỏ đúng lệnh cũ, dòng cộng dồn 60→120',
    mk21a.s === 201 && mk21b.s === 201 && mk21b.j?.data?.created === 0
      && m21?.order_code === mk21a.j?.data?.order_code
      && Number(line21?.qty_base) === 120 && line21?.required_pallets === 2,
    `created=${mk21b.j?.data?.created} merged→${m21?.order_code} (kỳ vọng ${mk21a.j?.data?.order_code}) qty=${line21?.qty_base} pl=${line21?.required_pallets}`)

  // 5 người cùng lúc ra lệnh trùng — cộng dồn NGUYÊN TỬ: đủ đúng 5×60, vẫn đúng 1 dòng treo, 0 lệnh vỏ
  const race21 = await Promise.all(Array.from({ length: 5 }, () =>
    mkOrder([{ required_date: pB.date, to_location_id: locPF.id }])))
  const line21r = await lineOf(pB.date)
  const dupPending = (await restAll('FillTask',
    `select=id&warehouse_id=eq.${whId}&target_date=eq.${DAY}&material_id=eq.${mat.id}&required_date=eq.${pB.date}&status=eq.PENDING`)).length
  const emptyOrders = (await restAll('FillOrder',
    `select=id,FillTask(id)&warehouse_id=eq.${whId}&target_date=eq.${DAY}`))
    .filter(o => !(o.FillTask ?? []).length).length
  check('21b. 5 người cùng cộng dồn → đủ đúng 120+300=420 / 7 pallet, 1 dòng treo, 0 lệnh vỏ',
    race21.every(r => r.s === 201) && Number(line21r?.qty_base) === 420 && line21r?.required_pallets === 7
      && dupPending === 1 && emptyOrders === 0,
    `qty=${line21r?.qty_base} pl=${line21r?.required_pallets} pending=${dupPending} vỏ=${emptyOrders}`)

  // ── 22. TỰ RA LỆNH FILL (15/09) ────────────────────────────────────────────
  // Vì sao có cụm này: module Fill ra 05/08 mà tới 15/09 có ĐÚNG 0 lệnh được tạo — nút "Ra lệnh"
  // là một nhát bấm không ai đi qua. Máy ra lệnh thay, nhưng đúng 4 ranh giới: kho phải TỰ BẬT ·
  // chạy hai lần không đẻ lệnh đôi · dòng chưa chốt %Date thì máy KHÔNG chọn lô hộ · hết nhu cầu
  // thì tự thu hồi. Bỏ bất kỳ cái nào trong bốn là máy đi hạ hàng không ai cần.
  await cleanupOrders(whId)                      // xoá lệnh của các cụm trên để phép trừ sạch
  const runAuto = () => api('/wms/fill/auto', 'POST', { warehouse_id: whId, date: DAY })
  const autoLines = async () => (await restAll('FillTask',
    `select=id,material_id,qty_base,assignee_id,status,fill_order_id&warehouse_id=eq.${whId}&target_date=eq.${DAY}`))
  const autoOrders = async () => (await restAll('FillOrder',
    `select=id,auto_created,created_by&warehouse_id=eq.${whId}&target_date=eq.${DAY}`))

  const [whBefore] = await restAll('Warehouse', `select=auto_fill&id=eq.${whId}`)
  savedAutoFill = whBefore?.auto_fill === true

  // 22a. Kho CHƯA bật ⇒ máy không được tự làm gì (đo 15/09: 153/153 kho đang tắt)
  await restWrite('Warehouse', 'PATCH', `id=eq.${whId}`, { auto_fill: false, updated_at: nowIso() })
  const off22 = await runAuto()
  check('22a. Kho TẮT công tắc → máy không ra lệnh nào (không tự bật hộ ai)',
    off22.s === 200 && Number(off22.j?.data?.created ?? -1) === 0 && (await autoLines()).length === 0,
    `http=${off22.s} created=${off22.j?.data?.created} lines=${(await autoLines()).length}`)

  await restWrite('Warehouse', 'PATCH', `id=eq.${whId}`, { auto_fill: true, updated_at: nowIso() })

  // 22b. Dòng CHƯA CHỐT %Date ⇒ máy KHÔNG tự chọn lô hộ (luật 10/09 "chưa chốt thì chưa được lấy")
  await restWrite('OutboundItem', 'PATCH', `id=eq.${item.id}`, { date_rule: null, updated_at: nowIso() })
  const unset22 = await runAuto()
  check('22b. Dòng chưa chốt %Date → bỏ qua + nêu MÃ, không đẻ dòng lệnh',
    unset22.s === 200 && Number(unset22.j?.data?.created ?? -1) === 0
      && (unset22.j?.data?.unset ?? []).includes(mat.material_code),
    `created=${unset22.j?.data?.created} unset=${JSON.stringify(unset22.j?.data?.unset ?? [])}`)

  // 22c. Chốt mức → máy ra lệnh ĐÚNG phần thiếu mà trang Đề xuất đang hiện, KHÔNG gán ai
  await restWrite('OutboundItem', 'PATCH', `id=eq.${item.id}`, { date_rule: { kind: 'FEFO' }, updated_at: nowIso() })
  const before22 = await demandOf()
  const shortNow = Number(before22.row?.short_base ?? 0)
  const on22 = await runAuto()
  const lines22 = (await autoLines()).filter(l => l.material_id === mat.id && l.status === 'PENDING')
  const ords22 = await autoOrders()
  const qty22 = lines22.reduce((s, l) => s + Number(l.qty_base), 0)
  check('22c. Bật → ra lệnh đúng phần THIẾU của trang Đề xuất, lệnh mang dấu "máy tạo", KHÔNG gán ai',
    on22.s === 200 && shortNow > 0 && Number(on22.j?.data?.created ?? 0) > 0
      && qty22 === shortNow
      && lines22.every(l => l.assignee_id === null)
      && ords22.length === 1 && ords22[0].auto_created === true,
    `thiếu=${shortNow} lệnh=${qty22} dòng=${lines22.length} gán=${lines22.filter(l => l.assignee_id).length} auto=${ords22[0]?.auto_created}`)

  // 22d. Chạy lại ⇒ KHÔNG đẻ lệnh thứ hai (phần đang treo đã trừ vào "thiếu"; unique gác nốt)
  const again22 = await runAuto()
  const lines22b = (await autoLines()).filter(l => l.material_id === mat.id && l.status === 'PENDING')
  check('22d. Chạy lần hai → 0 dòng mới, không nhân đôi việc (máy KHÔNG cộng dồn như người bấm tay)',
    again22.s === 200 && Number(again22.j?.data?.created ?? -1) === 0 && lines22b.length === lines22.length,
    `created=${again22.j?.data?.created} dòng ${lines22.length}→${lines22b.length}`)

  // 22e. VIỆC LOOSE_FEED của bộ lập kế hoạch cũng là "hàng sắp xuống ô lẻ" — Fill phải trừ nó ra,
  // không thì cùng một nhu cầu bị hạ HAI lần (hai đường fill vốn mù với nhau tới 15/09).
  await cleanupOrders(whId)
  const feedQty = 30
  await restWrite('wms_tasks', 'POST', null, {
    id: randomUUID(), warehouse_id: whId, gdo_id: gdo.id, item_id: item.id, material_id: mat.id,
    entry_id: pA.id, pallet_code: pA.code, qty_base: feedQty, kind: 'LOOSE_FEED',
    needs_lower: false, seq: 1, status: 'PENDING', plan_version: 1,
    created_at: nowIso(), updated_at: nowIso(),
  })
  const withFeed = await demandOf()
  check('22e. Việc LOOSE_FEED đang treo được trừ vào "đang có lệnh" → thiếu giảm đúng 30',
    Number(withFeed.row?.short_base ?? -1) === Math.max(0, shortNow - feedQty)
      && Number(withFeed.row?.pending_base ?? 0) >= feedQty,
    `thiếu ${shortNow}→${withFeed.row?.short_base} (kỳ vọng ${Math.max(0, shortNow - feedQty)}) · đang-có-lệnh=${withFeed.row?.pending_base}`)
  await restWrite('wms_tasks', 'DELETE', `gdo_id=eq.${created.gdo}`).catch(() => {})

  // 22f. Công tắc theo LOẠI KHO TẮT được cái kho đang bật (2 tầng, user chốt 15/09)
  savedTypeCode = mat.category
  const [tcfg] = await restAll('warehouse_type_configs',
    `select=auto_fill&warehouse_id=eq.${whId}&type_code=eq.${savedTypeCode}`)
  if (tcfg) {
    savedTypeAutoFill = tcfg.auto_fill
    await cleanupOrders(whId)
    await restWrite('warehouse_type_configs', 'PATCH', `warehouse_id=eq.${whId}&type_code=eq.${savedTypeCode}`,
      { auto_fill: false, updated_at: nowIso() })
    const typeOff = await runAuto()
    check('22f. Loại kho tắt riêng → mã thuộc loại đó KHÔNG được máy ra lệnh dù KHO đang bật',
      typeOff.s === 200 && !(await autoLines()).some(l => l.material_id === mat.id && l.status === 'PENDING'),
      `created=${typeOff.j?.data?.created}`)
    await restWrite('warehouse_type_configs', 'PATCH', `warehouse_id=eq.${whId}&type_code=eq.${savedTypeCode}`,
      { auto_fill: savedTypeAutoFill, updated_at: nowIso() })
    savedTypeAutoFill = undefined
  } else {
    savedTypeCode = null
    check('22f. Loại kho tắt riêng → mã thuộc loại đó KHÔNG được máy ra lệnh dù KHO đang bật',
      true, 'kho fixture chưa khai dòng cấu hình loại — bỏ qua (không có gì để tắt)')
  }

  // 22g. HẾT NHU CẦU (đơn huỷ / đổi ngày) ⇒ lệnh máy đặt mà CHƯA AI ĐỤNG phải tự thu hồi —
  // không thì có người đi hạ pallet không ai cần VÀ chiếm mất ô nhặt lẻ.
  await cleanupOrders(whId)
  await runAuto()
  const born = (await autoLines()).filter(l => l.material_id === mat.id && l.status === 'PENDING').length
  await restWrite('OutboundItem', 'PATCH', `id=eq.${item.id}`, { loose_picking: 0, updated_at: nowIso() })
  const recall = await runAuto()
  const stillOpen = (await autoLines()).filter(l => l.material_id === mat.id && l.status === 'PENDING').length
  check('22g. Nhu cầu về 0 → thu hồi dòng máy đặt chưa ai đụng, không để lệnh ma',
    born > 0 && Number(recall.j?.data?.recalled ?? 0) >= born && stillOpen === 0,
    `đặt=${born} thu hồi=${recall.j?.data?.recalled} còn treo=${stillOpen}`)
  await restWrite('OutboundItem', 'PATCH', `id=eq.${item.id}`, { loose_picking: LOOSE, updated_at: nowIso() })

  // ── 23. LỆNH THEO NGÀY (user chốt 15/09): 1 kho × 1 ngày × 1 loại kho = 1 lệnh ───────────────
  // Đơn vị công việc là TRẠNG THÁI của một ngày, không phải SỰ KIỆN của một lần bấm.
  await cleanupOrders(whId)
  await runAuto()
  const day1 = (await restAll('FillOrder',
    `select=id,status,warehouse_type,assignee_id&warehouse_id=eq.${whId}&target_date=eq.${DAY}&status=eq.PENDING`))
  check('23a. Một lệnh ĐANG MỞ cho mỗi (kho, ngày, loại kho) — không còn "mỗi lần bấm một lệnh"',
    day1.length === 1 && day1[0].warehouse_type === mat.category,
    `n=${day1.length} loại=${day1[0]?.warehouse_type} (mã thuộc ${mat.category})`)

  // 23b. ĐƠN PHÁT SINH — lỗi mô hình cũ ĐÁNH RƠI: dòng cùng (mã, NSX) đang treo ⇒ INSERT đụng
  // uq_filltask_pending_matdate ⇒ đường tự động nuốt 23505 ⇒ phần tăng KHÔNG BAO GIỜ thành lệnh
  // (đường bấm tay thì cộng dồn). Đo thật trên bản cũ: nhu cầu 150→250 mà tổng dòng đứng im 150.
  const sumOpen = async () => (await restAll('FillTask',
    `select=qty_base&warehouse_id=eq.${whId}&target_date=eq.${DAY}&material_id=eq.${mat.id}&status=eq.PENDING`))
    .reduce((s, t) => s + Number(t.qty_base), 0)
  const before23 = await sumOpen()
  await restWrite('OutboundItem', 'PATCH', `id=eq.${item.id}`,
    { loose_picking: LOOSE + 80, updated_at: nowIso() })
  const grow = await runAuto()
  const after23 = await sumOpen()
  check('23b. Đơn phát sinh → phần tăng được CỘNG vào dòng cùng NSX (không bị nuốt 23505)',
    after23 > before23, `tổng ${before23}→${after23} · cộng=${grow.j?.data?.added} mới=${grow.j?.data?.created}`)
  check('23c. …và vẫn ĐÚNG MỘT lệnh của ngày, không mở lệnh thứ hai',
    (await restAll('FillOrder',
      `select=id&warehouse_id=eq.${whId}&target_date=eq.${DAY}&status=eq.PENDING`)).length === 1)
  await restWrite('OutboundItem', 'PATCH', `id=eq.${item.id}`, { loose_picking: LOOSE, updated_at: nowIso() })

  // 23d. GÁN CẢ LỆNH = "nhận kế hoạch cả ngày" (user chốt) — dòng đang treo kéo theo NGAY
  const emp23 = (await restAll('Employee', 'select=id,name&is_active=eq.true&limit=1'))[0]
  const asg23 = await api(`/wms/fill/orders/${day1[0].id}`, 'PATCH', { assignee_id: emp23?.id })
  const lines23 = await restAll('FillTask',
    `select=assignee_id&fill_order_id=eq.${day1[0].id}&status=eq.PENDING`)
  check('23d. Gán CẢ LỆNH → mọi dòng đang treo nhận người đó (kế hoạch cả ngày)',
    asg23.s === 200 && lines23.length > 0 && lines23.every(l => l.assignee_id === emp23?.id),
    `http=${asg23.s} dòng=${lines23.length}`)

  // 23e. CHỐT NGÀY — lệnh chỉ đóng bằng hành vi này (rollup KHÔNG tự đóng nữa)
  const close23 = await api(`/wms/fill/orders/${day1[0].id}/close`, 'POST', {})
  const [closed23] = await restAll('FillOrder', `select=status,closed_at&id=eq.${day1[0].id}`)
  const left23 = await restAll('FillTask',
    `select=id,cancel_reason&fill_order_id=eq.${day1[0].id}&status=eq.PENDING`)
  check('23e. Chốt ngày → lệnh ĐÃ CHỐT, dòng chưa làm bị huỷ kèm lý do (không để việc mồ côi)',
    close23.s === 200 && closed23?.status === 'DONE' && !!closed23?.closed_at && left23.length === 0,
    `http=${close23.s} status=${closed23?.status} còn_treo=${left23.length}`)
  check('23f. Chốt lần hai → 409, không đóng chồng',
    (await api(`/wms/fill/orders/${day1[0].id}/close`, 'POST', {})).s === 409)

  // ── 24. RÀ RỦI RO 15/09 (vòng 3) — bốn lỗ user duyệt vá ───────────────────────────────────────
  const TODAY    = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const TOMORROW = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  // 24a. LỖI ĐÃ NỔ THẬT: chính gói này gọi /fill/auto với DAY = 21/12 và làm hai lệnh HÔM NAY của kho
  // thật bị "Hệ thống" chốt (15:17 · 15:23 ngày 15/09) — chốt lười lấy `day` truyền vào làm mốc thay
  // cho 0h hôm nay. Mồi = một lệnh ĐANG MỞ của hôm nay (loại kho giả để không đụng khoá với lệnh thật).
  const bait24 = (await restWrite('FillOrder', 'POST', null, {
    id: randomUUID(), order_code: `${TAG}-TODAY`, warehouse_id: whId, target_date: TODAY,
    warehouse_type: '__QA24__', status: 'PENDING', auto_created: false, created_by: 'QA',
    created_at: nowIso(), updated_at: nowIso(),
  }))[0]
  const future24 = await runAuto()                  // DAY = ngày tương lai
  const [bait24After] = await restAll('FillOrder', `select=status,closed_by&id=eq.${bait24.id}`)
  check('24a. Chạy tay cho ngày TƯƠNG LAI → lệnh HÔM NAY vẫn ĐANG MỞ (mốc chốt lười = 0h hôm nay, không phải ngày truyền vào)',
    future24.s === 200 && bait24After?.status === 'PENDING',
    `http=${future24.s} status=${bait24After?.status} closed_by=${bait24After?.closed_by ?? '—'}`)
  await restWrite('FillOrder', 'DELETE', `id=eq.${bait24.id}`).catch(() => {})

  // 24c. BÁO CÁO KẾT QUẢ phải giữ dòng "chốt ngày — chưa thực hiện" trong MẪU SỐ (23e vừa huỷ ≥1 dòng
  // như vậy). Bản cũ lọc `status <> 'CANCELLED'` ⇒ sau chốt ai cũng 100 % — lớp "xoá dấu vết" 28/08.
  const rep24 = await api(`/wms/fill/report?warehouse_id=${whId}&date_from=${DAY}&date_to=${DAY}`)
  check('24c. Báo cáo Kết quả đếm dòng "không kịp" (huỷ lúc chốt ngày) vào mẫu số',
    rep24.s === 200 && Number(rep24.j?.data?.missed ?? 0) >= 1
      && Number(rep24.j?.data?.total ?? 0) >= Number(rep24.j?.data?.missed ?? 0)
      && (rep24.j?.data?.rows ?? []).some(r => Number(r.missed_n ?? 0) >= 1),
    `missed=${rep24.j?.data?.missed} total=${rep24.j?.data?.total}`)

  // 24d. MÁY ĐỔI DÒNG CỦA NGƯỜI ĐANG GIỮ KẾ HOẠCH ⇒ báo đích danh (feed cá nhân), không chỉ dải xanh
  const day24 = (await restAll('FillOrder',
    `select=id&warehouse_id=eq.${whId}&target_date=eq.${DAY}&status=eq.PENDING&warehouse_type=eq.${mat.category}`))[0]
  await restWrite('user_notifications', 'DELETE', `employee_id=eq.${emp23?.id}&kind=eq.FILL_CHANGED`).catch(() => {})
  const asg24 = day24 ? await api(`/wms/fill/orders/${day24.id}`, 'PATCH', { assignee_id: emp23?.id }) : { s: 0 }
  await restWrite('OutboundItem', 'PATCH', `id=eq.${item.id}`, { loose_picking: LOOSE + 80, updated_at: nowIso() })
  const grow24 = await runAuto()
  const notif24 = await restAll('user_notifications',
    `select=id,url,body&employee_id=eq.${emp23?.id}&kind=eq.FILL_CHANGED`)
  check('24d. Đơn phát sinh làm máy CỘNG vào dòng đã giao ⇒ người giữ kế hoạch nhận thông báo đích danh',
    asg24.s === 200 && Number(grow24.j?.data?.added ?? 0) >= 1
      && notif24.some(n => n.url === `/wms/fill/orders/${day24?.id}`),
    `assign=${asg24.s} added=${grow24.j?.data?.added} notif=${notif24.length}`)
  await restWrite('OutboundItem', 'PATCH', `id=eq.${item.id}`, { loose_picking: LOOSE, updated_at: nowIso() })
  await restWrite('user_notifications', 'DELETE', `employee_id=eq.${emp23?.id}&kind=eq.FILL_CHANGED`).catch(() => {})

  // 24b. HÀNG ĐỢI THEO (kho, NGÀY XUẤT): đơn của NGÀY MAI đổi ⇒ trigger ghi (kho, mai) ⇒ lần đọc kế
  // tiếp (trang Fill) tự đối chiếu đúng ngày đó — không cần ai bấm, không chờ nhịp 10 phút, và
  // "chỉ hôm nay" không còn bỏ rơi ca 22h chuẩn bị cho chuyến ngày mai.
  await restWrite('fill_reconcile_queue', 'DELETE', `warehouse_id=eq.${whId}`).catch(() => {})
  await restWrite('GroupDeliveryOrder', 'PATCH', `id=eq.${gdo.id}`, { delivery_date: TOMORROW, updated_at: nowIso() })
  const queued24 = await restAll('fill_reconcile_queue', `select=target_date&warehouse_id=eq.${whId}&target_date=eq.${TOMORROW}`)
  check('24b1. Đổi ngày chuyến sang MAI → trigger ghi (kho, mai) vào hàng đợi đối chiếu',
    queued24.length === 1, `rows=${queued24.length}`)
  const read24 = await api(`/wms/fill/demand?warehouse_id=${whId}&date=${TODAY}`)   // xem HÔM NAY, máy vẫn soát MAI
  const tomLines = await restAll('FillTask',
    `select=id,fill_order_id&warehouse_id=eq.${whId}&target_date=eq.${TOMORROW}&material_id=eq.${mat.id}&status=eq.PENDING`)
  const queuedAfter = await restAll('fill_reconcile_queue', `select=target_date&warehouse_id=eq.${whId}&target_date=eq.${TOMORROW}`)
  check('24b2. Lần đọc kế tiếp xả hàng đợi → lệnh fill cho NGÀY MAI tự có, hàng đợi rỗng',
    read24.s === 200 && tomLines.length >= 1 && queuedAfter.length === 0,
    `http=${read24.s} dòng_mai=${tomLines.length} còn_đợi=${queuedAfter.length}`)
  // dọn phần 24b: chỉ dòng của MÃ fixture + vỏ lệnh rỗng (kho thật có thể có lệnh mai của người khác)
  for (const l of tomLines) await restWrite('FillTask', 'DELETE', `id=eq.${l.id}`).catch(() => {})
  for (const o of await restAll('FillOrder', `select=id,FillTask(id)&warehouse_id=eq.${whId}&target_date=eq.${TOMORROW}&auto_created=eq.true`))
    if (!(o.FillTask ?? []).length) await restWrite('FillOrder', 'DELETE', `id=eq.${o.id}`).catch(() => {})
  await restWrite('GroupDeliveryOrder', 'PATCH', `id=eq.${gdo.id}`, { delivery_date: DAY, updated_at: nowIso() })
  await restWrite('fill_reconcile_queue', 'DELETE', `warehouse_id=eq.${whId}`).catch(() => {})
} finally {
  console.log('\n🧹 dọn…')
  await cleanup(WH)
  const residue = (await restAll('InventoryEntry', `select=id&pallet_code=like.${TAG}-*`)).length
    + (await restAll('Location', `select=id&location_code=like.${TAG}-*`)).length
    + (WH ? (await restAll('FillOrder', `select=id&warehouse_id=eq.${WH}&target_date=eq.${DAY}`)).length : 0)
    + (created.gdo ? (await restAll('wms_tasks', `select=id&gdo_id=eq.${created.gdo}`)).length : 0)
    + (WH ? (await restAll('fill_reconcile_queue', `select=warehouse_id&warehouse_id=eq.${WH}`)).length : 0)
  console.log(`residue=${residue}`)
}

finish('FILL-REPLENISH')
