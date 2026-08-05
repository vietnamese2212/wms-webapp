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
async function cleanupOrders(whId) {
  // FillOrder → FillTask → FillTaskScan đều ON DELETE CASCADE; lệnh fixture nhận diện bằng DAY
  if (whId) await restWrite('FillOrder', 'DELETE', `warehouse_id=eq.${whId}&target_date=eq.${DAY}`).catch(() => {})
}
async function cleanup(whId) {
  await cleanupOrders(whId)
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
  const pOnPF = await mkPallet('ONPF', 40, locPF.id, 2)    // ĐANG Ở vị trí nhặt lẻ → là "đang có"
  await mkPallet('BADSTOCK', 5, locBad.id, 3)              // locBad chứa sẵn mã (bẫy cụm 17)
  const pA = await mkPallet('A', 60, locRsv.id, 90)        // FEFO: cũ nhất
  const pB = await mkPallet('B', 60, locRsv.id, 60)
  const pC = await mkPallet('C', 60, locRsv.id, 30)        // mới nhất

  // Nhu cầu: thiếu kỳ vọng = LOOSE − (tồn thật + 40 pOnPF + 5 BADSTOCK) = 100
  const LOOSE = realPF + 45 + 100
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
  const d1 = await demandOf()
  check('1a. "Cần nhặt lẻ" khớp oracle', Number(d1.row?.demand_base) === LOOSE,
    `api=${d1.row?.demand_base} oracle=${LOOSE}`)
  check('1b. "Đang có ở vị trí nhặt lẻ" khớp oracle', Number(d1.row?.pick_face_base) === oraclePF,
    `api=${d1.row?.pick_face_base} oracle=${oraclePF}`)
  check('1c. "Thiếu" = cần − đang có − đang có lệnh',
    Number(d1.row?.short_base) === Math.max(0, LOOSE - oraclePF - Number(d1.row?.pending_base ?? 0)),
    `thiếu=${d1.row?.short_base}`)

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

  // ── 5. ĐUA: 2 người cùng ra lệnh MỘT (mã, date) ───────────────────────────
  const [r1, r2] = await Promise.all([
    mkOrder([{ required_date: pB.date, to_location_id: locPF.id }]),
    mkOrder([{ required_date: pB.date, to_location_id: locPF.id }]),
  ])
  const pendB = await restAll('FillTask',
    `select=id&warehouse_id=eq.${whId}&target_date=eq.${DAY}&material_id=eq.${mat.id}&required_date=eq.${pB.date}&status=eq.PENDING`)
  const nCreated = (r1.j?.data?.created ?? 0) + (r2.j?.data?.created ?? 0)
  const nSkipped = (r1.j?.data?.skipped?.length ?? 0) + (r2.j?.data?.skipped?.length ?? 0)
  check('5a. Hai người cùng ra lệnh 1 (mã,date) → đúng 1 dòng treo', pendB.length === 1,
    `dòng treo=${pendB.length} created=${nCreated}`)
  check('5b. Người thua được báo rõ (không nuốt lỗi)', nSkipped === 1 && nCreated === 1,
    `skipped=${nSkipped}`)

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
  check('9e. Lệnh 1-dòng rollup DONE khi dòng xong', order1Row?.status === 'DONE', `order=${order1Row?.status}`)

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
  const shortExp = Math.max(0, Number(dAfter.row?.demand_base) - Number(dAfter.row?.pick_face_base) - Number(dAfter.row?.pending_base))
  const [orderB] = await restAll('FillOrder', `select=status&id=eq.${lineB.fill_order_id}`)
  check('11a. Hủy dòng → NHẢ đúng lượng đang giữ', del.s === 200 && pendDrop === 60,
    `treo ${dBefore.row?.pending_base} → ${dAfter.row?.pending_base} (giảm ${pendDrop}, kỳ vọng 60)`)
  check('11b. Sau khi hủy, phép trừ vẫn khớp (thiếu = cần − có − treo, kẹp sàn 0)',
    Number(dAfter.row?.short_base) === shortExp, `thiếu=${dAfter.row?.short_base} kỳ vọng=${shortExp}`)
  check('11c. Lệnh 1-dòng rollup CANCELLED khi dòng cuối bị hủy', orderB?.status === 'CANCELLED',
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
  const band = await api(`/wms/fill/orders?warehouse_id=${whId}&status=PENDING`)
  check('13a. Ô tổng /fill/orders đếm toàn cảnh (lọc "Chờ làm" vẫn thấy số đã hủy)',
    band.s === 200 && Number(band.j?.data?.cancelled_n) >= 1
      && (band.j?.data?.rows ?? []).every(r => r.status === 'PENDING'),
    `rows=${band.j?.data?.rows?.length} đã hủy=${band.j?.data?.cancelled_n}`)
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
  // pA đã hạ xuống locPF (phải VẮNG); pB/pC tự do ở tầng trên (phải CÓ — kể cả khi có lệnh
  // treo, vì lệnh v3 không ghim pallet).
  const mk19 = await mkOrder([{ required_date: pB.date, to_location_id: locPF.id }])
  const cand19 = await api(`/wms/fill/candidates?warehouse_id=${whId}&material_id=${mat.id}`)
  const cRows = cand19.j?.data?.rows ?? []
  const cIds = new Set(cRows.map(c => c.entry_id))
  const keys19 = cRows.map(c => c.fefo_key)
  const firstNull = keys19.findIndex(k => !k)
  const nonNull = keys19.filter(Boolean)
  const fefoSorted = JSON.stringify(nonNull) === JSON.stringify([...nonNull].sort())
    && (firstNull === -1 || keys19.slice(firstNull).every(k => !k))
  check('19a. Candidates: có pallet tự do tầng trên, VẮNG pallet đang ở vị trí nhặt lẻ, xếp FEFO',
    cand19.s === 200 && cIds.has(pC.id) && !cIds.has(pOnPF.id) && !cIds.has(pA.id)
      && cRows.every(c => 'production_date' in c) && fefoSorted,
    `n=${cRows.length} FEFO=${fefoSorted}`)
  check('19b. v3: pallet vẫn xuất hiện dù (mã,date) đang có lệnh treo (lệnh không ghim tem)',
    mk19.s === 201 && cIds.has(pB.id), `pB trong danh sách=${cIds.has(pB.id)}`)
  const line19 = await lineOf(pB.date)
  if (line19?.status === 'PENDING') await api(`/wms/fill/tasks/${line19.id}`, 'DELETE')
  const candBad = await api(`/wms/fill/candidates?warehouse_id=${whId}&material_id=khong-phai-uuid`)
  check('19c. material_id không hợp lệ → 400 (không 500)', candBad.s === 400, `http=${candBad.s}`)
} finally {
  console.log('\n🧹 dọn…')
  await cleanup(WH)
  const residue = (await restAll('InventoryEntry', `select=id&pallet_code=like.${TAG}-*`)).length
    + (await restAll('Location', `select=id&location_code=like.${TAG}-*`)).length
    + (WH ? (await restAll('FillOrder', `select=id&warehouse_id=eq.${WH}&target_date=eq.${DAY}`)).length : 0)
  console.log(`residue=${residue}`)
}

finish('FILL-REPLENISH')
