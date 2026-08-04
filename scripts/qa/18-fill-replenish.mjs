// GÓI 18 — FILL HÀNG PHỤC VỤ NHẶT LẺ (sinh cùng tính năng, 04/08).
//
// Vì sao phải có máy canh: cả tính năng đứng trên MỘT phép trừ — "cần" (nhặt lẻ còn lại của ngày
// xuất) trừ "đang có ở vị trí nhặt lẻ". Sai phép trừ đó thì KHÔNG có gì báo lỗi: hoặc kho hạ thừa
// pallet xuống chật chỗ, hoặc sáng ra công nhân không có hàng để nhặt mà bảng vẫn xanh.
// Thêm hai chỗ dễ vỡ: (a) hai người cùng ra lệnh cho MỘT pallet, (b) lệnh phải CHẾT ĐỨNG khi
// pallet đã bị chuyển đi / vị trí đích đầy — không được âm thầm chuyển sai chỗ.
//
// 14 phép kiểm, tự dựng fixture + tự dọn (chạy lúc nào cũng được):
//   1  cần/đang có/thiếu khớp ORACLE tự tính lại
//   2  pallet gợi ý là FEFO và VỪA ĐỦ bù thiếu (tham lam, không thừa pallet cuối)
//   3  pallet ĐANG Ở vị trí nhặt lẻ không bao giờ được đề xuất hạ
//   4  ra lệnh → lệnh treo trừ vào phần "thiếu" (không ra lệnh chồng lần sau)
//   5  ĐUA: 2 người cùng ra lệnh 1 pallet → đúng 1 lệnh (unique index), người kia được báo rõ
//   6  quét pallet KHÔNG còn ở vị trí nguồn → 409 và lệnh VẪN TREO, tồn không đổi
//   7  vị trí đích ĐẦY → 400 LOCATION_FULL và lệnh VẪN TREO (không mất việc)
//   8  đổi vị trí đích (gỡ ngõ cụt) rồi quét → 200
//   9  quét hợp lệ: pallet đổi VỊ TRÍ, số lượng KHÔNG đổi (fill là chuyển chỗ, không phải xuất)
//   10 quét lại lệnh đã xong → 404 NO_TASK (không nhân đôi)
//   11 hủy lệnh → phần "thiếu" quay lại như cũ
//   12 báo cáo theo người: đã xong / tỷ lệ khớp đếm tay
//   13 `?status=` RỖNG trả RỖNG (đúng ngữ nghĩa parseListParam — không âm thầm bỏ lọc)
//   14 thiếu kho → 400, không dump dữ liệu kho khác
//   15 bộ lọc cờ vị trí (nhặt lẻ / cần check) THẬT SỰ cắt: khớp oracle · có+chưa = tổng · band khớp
// usage: node scripts/qa/18-fill-replenish.mjs
import { login, api, check, finish, restAll, restWrite } from './lib.mjs'
import { randomUUID } from 'crypto'

const TAG = 'QAFILL'
const nowIso = () => new Date().toISOString()
// Ngày xuất TƯƠNG LAI XA để nhu cầu nhặt lẻ của fixture KHÔNG lẫn với dữ liệu thật của kho
const DAY = '2026-12-21'

console.log('── GÓI FILL-REPLENISH ──')
await login()

const created = { locs: [], entries: [], gdo: null, do: null, items: [] }
async function cleanup() {
  for (const id of created.entries) await restWrite('FillTask', 'DELETE', `entry_id=eq.${id}`).catch(() => {})
  for (const id of created.items)   await restWrite('OutboundScanEntry', 'DELETE', `item_id=eq.${id}`).catch(() => {})
  for (const id of created.items)   await restWrite('OutboundItem', 'DELETE', `id=eq.${id}`).catch(() => {})
  if (created.do)  await restWrite('OutboundDelivery', 'DELETE', `id=eq.${created.do}`).catch(() => {})
  if (created.gdo) await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${created.gdo}`).catch(() => {})
  for (const id of created.entries) await restWrite('InventoryEntry', 'DELETE', `id=eq.${id}`).catch(() => {})
  for (const id of created.locs)    await restWrite('Location', 'DELETE', `id=eq.${id}`).catch(() => {})
}
// Tàn dư của lần chạy hỏng giữa chừng (fixture phải TỰ HỒI PHỤC)
for (const e of await restAll('InventoryEntry', `select=id&pallet_code=like.${TAG}-*`))
  await restWrite('FillTask', 'DELETE', `entry_id=eq.${e.id}`).catch(() => {})
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
for (const t of ['InventoryEntry', 'Location']) {
  const col = t === 'Location' ? 'location_code' : 'pallet_code'
  for (const o of await restAll(t, `select=id&${col}=like.${TAG}-*`))
    await restWrite(t, 'DELETE', `id=eq.${o.id}`).catch(() => {})
}

try {
  // ── Fixture ────────────────────────────────────────────────────────────────
  const anyEntry = (await restAll('InventoryEntry', 'select=warehouse_id,material_id&limit=1&cartons_remaining=gt.0'))[0]
  if (!anyEntry) { check('có dữ liệu tồn để dựng fixture', false, 'kho rỗng'); finish('FILL-REPLENISH') }
  const whId = anyEntry.warehouse_id
  const [mat] = await restAll('Material', `select=id,material_code,category,entry_unit,units_per_carton&id=eq.${anyEntry.material_id}`)

  const mkLoc = async (code, maxPallets, pickFace, needStocktake = false) => {
    const [row] = await restWrite('Location', 'POST', null, {
      id: randomUUID(), location_code: `${TAG}-${code}`, warehouse_id: whId, max_pallets: maxPallets,
      is_active: true, is_pick_face: pickFace, requires_stocktake: needStocktake,
      row: 'QA', shelf: pickFace ? 'T1' : 'T3',
      sub_code: `${TAG}-${code}`, created_at: nowIso(), updated_at: nowIso(),
    })
    created.locs.push(row.id)
    return { id: row.id, code: row.location_code }
  }
  const locRsv  = await mkLoc('RSV',  10, false)  // tầng trên — nguồn
  const locPF   = await mkLoc('PF',    5, true, true)   // vị trí nhặt lẻ — đích (+ cờ kiểm kê, cho phép kiểm 15)
  const locFull = await mkLoc('FULL',  1, true)   // vị trí nhặt lẻ ĐÃ ĐẦY

  // NSX lệch nhau để kiểm thứ tự FEFO (A cũ nhất → phải được gợi ý trước)
  const mkPallet = async (code, qty, locId, prodDaysAgo = 0, reserved = 0) => {
    const d = new Date(); d.setDate(d.getDate() - prodDaysAgo)
    const [row] = await restWrite('InventoryEntry', 'POST', null, {
      id: randomUUID(), pallet_code: `${TAG}-${code}`, material_id: mat.id, warehouse_id: whId,
      location_id: locId, cartons_imported: qty, cartons_remaining: qty, cartons_reserved: reserved,
      status: 'IN_STOCK', stack_layer: 1, production_date: d.toISOString(),
      import_date: nowIso(), created_at: nowIso(), updated_at: nowIso(),
    })
    created.entries.push(row.id)
    return { id: row.id, code: row.pallet_code, qty }
  }
  await mkPallet('FILLER', 30, locFull.id, 1)              // lấp đầy vị trí FULL (max = 1)
  const pOnPF = await mkPallet('ONPF', 40, locPF.id, 2)    // ĐANG Ở vị trí nhặt lẻ → là "đang có"
  const pA = await mkPallet('A', 60, locRsv.id, 90)        // FEFO: cũ nhất
  const pB = await mkPallet('B', 60, locRsv.id, 60)
  const pC = await mkPallet('C', 60, locRsv.id, 30)        // mới nhất — không cần tới

  // Nhu cầu: 1 chuyến, 1 dòng hàng nhặt lẻ 150 base, chưa quét gì
  const LOOSE = 150
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
    cartons_ordered: 400, cartons_scanned: 0, loose_picking: LOOSE, status: 'PENDING',
    created_at: nowIso(), updated_at: nowIso(),
  })
  created.items.push(item.id)

  const demandOf = async () => {
    const r = await api(`/wms/fill/demand?warehouse_id=${whId}&date=${DAY}`)
    const row = (r.j?.data?.rows ?? []).find(x => x.material_id === mat.id)
    return { s: r.s, row, all: r.j?.data }
  }

  // ── 1. Oracle cần / đang có / thiếu ────────────────────────────────────────
  // Nhu cầu của fixture là DUY NHẤT trong ngày DAY (ngày tương lai xa), nhưng "đang có ở vị trí
  // nhặt lẻ" tính trên TOÀN KHO nên phải cộng cả pallet thật đang nằm ở vị trí nhặt lẻ khác.
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

  // ── 4. Ra lệnh → trừ vào phần thiếu ───────────────────────────────────────
  const short0 = Number(d1.row?.short_base)
  const mk = await api('/wms/fill/tasks', 'POST', {
    warehouse_id: whId, target_date: DAY,
    items: [{ entry_id: pA.id, to_location_id: locPF.id }],
  })
  check('4a. Ra lệnh fill trả 201', mk.s === 201 && mk.j?.data?.created === 1,
    `http=${mk.s} created=${mk.j?.data?.created}`)
  const d2 = await demandOf()
  check('4b. Lệnh treo trừ vào phần thiếu (không ra lệnh chồng)',
    Number(d2.row?.pending_base) === pA.qty && Number(d2.row?.short_base) === Math.max(0, short0 - pA.qty),
    `treo=${d2.row?.pending_base} thiếu=${d2.row?.short_base} (trước=${short0})`)

  // ── 5. ĐUA: 2 người cùng ra lệnh cho MỘT pallet ───────────────────────────
  const [r1, r2] = await Promise.all([
    api('/wms/fill/tasks', 'POST', { warehouse_id: whId, target_date: DAY, items: [{ entry_id: pB.id, to_location_id: locPF.id }] }),
    api('/wms/fill/tasks', 'POST', { warehouse_id: whId, target_date: DAY, items: [{ entry_id: pB.id, to_location_id: locPF.id }] }),
  ])
  const pendB = await restAll('FillTask', `select=id&entry_id=eq.${pB.id}&status=eq.PENDING`)
  const nCreated = (r1.j?.data?.created ?? 0) + (r2.j?.data?.created ?? 0)
  const nSkipped = (r1.j?.data?.skipped?.length ?? 0) + (r2.j?.data?.skipped?.length ?? 0)
  check('5a. Hai người cùng ra lệnh 1 pallet → đúng 1 lệnh treo', pendB.length === 1,
    `lệnh treo=${pendB.length} created=${nCreated}`)
  check('5b. Người thua được báo rõ (không nuốt lỗi)', nSkipped === 1 && nCreated === 1,
    `skipped=${nSkipped}`)

  // ── 6. Quét khi pallet KHÔNG còn ở vị trí nguồn ───────────────────────────
  await restWrite('InventoryEntry', 'PATCH', `id=eq.${pA.id}`, { location_id: locRsv.id === locPF.id ? locRsv.id : locFull.id })
  const scanDrift = await api('/wms/fill/scan', 'POST', { qr: pA.code, warehouse_id: whId })
  const taskA1 = (await restAll('FillTask', `select=status&entry_id=eq.${pA.id}`))[0]
  check('6a. Pallet lệch vị trí nguồn → 409 NOT_AT_SOURCE',
    scanDrift.s === 409 && scanDrift.j?.error?.code === 'NOT_AT_SOURCE', `http=${scanDrift.s} code=${scanDrift.j?.error?.code}`)
  check('6b. Lệnh VẪN TREO sau khi quét lệch', taskA1?.status === 'PENDING', `status=${taskA1?.status}`)
  await restWrite('InventoryEntry', 'PATCH', `id=eq.${pA.id}`, { location_id: locRsv.id })   // trả về nguồn

  // ── 7. Vị trí đích ĐẦY ────────────────────────────────────────────────────
  const taskA = (await restAll('FillTask', `select=id&entry_id=eq.${pA.id}&status=eq.PENDING`))[0]
  await api(`/wms/fill/tasks/${taskA.id}`, 'PATCH', { to_location_id: locFull.id })
  const scanFull = await api('/wms/fill/scan', 'POST', { qr: pA.code, warehouse_id: whId })
  const taskA2 = (await restAll('FillTask', `select=status&id=eq.${taskA.id}`))[0]
  check('7a. Vị trí đích đầy → 400 LOCATION_FULL',
    scanFull.s === 400 && scanFull.j?.error?.code === 'LOCATION_FULL', `http=${scanFull.s} code=${scanFull.j?.error?.code}`)
  check('7b. Đích đầy KHÔNG làm mất lệnh (vẫn treo để đổi đích)', taskA2?.status === 'PENDING', `status=${taskA2?.status}`)

  // ── 8+9. Đổi đích rồi quét hợp lệ ─────────────────────────────────────────
  const fix = await api(`/wms/fill/tasks/${taskA.id}`, 'PATCH', { to_location_id: locPF.id })
  check('8. Đổi vị trí đích được (gỡ ngõ cụt)', fix.s === 200, `http=${fix.s}`)
  const before = (await restAll('InventoryEntry', `select=cartons_remaining,location_id&id=eq.${pA.id}`))[0]
  const scanOk = await api('/wms/fill/scan', 'POST', { qr: pA.code, warehouse_id: whId })
  const after = (await restAll('InventoryEntry', `select=cartons_remaining,location_id&id=eq.${pA.id}`))[0]
  const taskA3 = (await restAll('FillTask', `select=status,done_at,done_by_name&id=eq.${taskA.id}`))[0]
  check('9a. Quét hợp lệ → 200 và lệnh chuyển ĐÃ HẠ',
    scanOk.s === 200 && taskA3?.status === 'DONE' && !!taskA3?.done_at, `http=${scanOk.s} status=${taskA3?.status}`)
  check('9b. Pallet ĐỔI vị trí sang đích', after?.location_id === locPF.id, `loc=${after?.location_id === locPF.id ? 'PF' : after?.location_id}`)
  check('9c. Fill KHÔNG đụng số lượng (chỉ chuyển chỗ)',
    Number(after?.cartons_remaining) === Number(before?.cartons_remaining),
    `trước=${before?.cartons_remaining} sau=${after?.cartons_remaining}`)

  // ── 10. Quét lại lệnh đã xong ─────────────────────────────────────────────
  const scanAgain = await api('/wms/fill/scan', 'POST', { qr: pA.code, warehouse_id: whId })
  check('10. Quét lại pallet đã hạ → 404 NO_TASK (không nhân đôi)',
    scanAgain.s === 404 && scanAgain.j?.error?.code === 'NO_TASK', `http=${scanAgain.s} code=${scanAgain.j?.error?.code}`)

  // ── 11. Hủy lệnh → NHẢ phần đang giữ, phép trừ vẫn khớp ───────────────────
  // Không khẳng định "thiếu tăng đúng +qty": `short` bị KẸP SÀN ở 0, nên khi nhu cầu đã được phủ
  // dư thì hủy 1 lệnh chỉ đẩy thiếu lên tới mức thật, không phải cả lượng pallet. Bất biến đúng =
  // lệnh treo giảm đúng lượng đó VÀ short vẫn = max(0, cần − đang có − đang treo).
  const taskB = (await restAll('FillTask', `select=id&entry_id=eq.${pB.id}&status=eq.PENDING`))[0]
  const dBefore = await demandOf()
  const del = await api(`/wms/fill/tasks/${taskB.id}`, 'DELETE')
  const dAfter = await demandOf()
  const pendDrop = Number(dBefore.row?.pending_base) - Number(dAfter.row?.pending_base)
  const shortExp = Math.max(0, Number(dAfter.row?.demand_base) - Number(dAfter.row?.pick_face_base) - Number(dAfter.row?.pending_base))
  check('11a. Hủy lệnh → NHẢ đúng lượng đang giữ', del.s === 200 && pendDrop === pB.qty,
    `treo ${dBefore.row?.pending_base} → ${dAfter.row?.pending_base} (giảm ${pendDrop}, kỳ vọng ${pB.qty})`)
  check('11b. Sau khi hủy, phép trừ vẫn khớp (thiếu = cần − có − treo, kẹp sàn 0)',
    Number(dAfter.row?.short_base) === shortExp, `thiếu=${dAfter.row?.short_base} kỳ vọng=${shortExp}`)

  // ── 11c. Ô tổng phải mô tả TOÀN CẢNH, không chỉ phần đang lọc ─────────────
  // Lọc mặc định của tab là "Chờ làm"; nếu 4 ô đếm trên tập ĐÃ LỌC thì vừa hủy xong vẫn thấy
  // "Đã hủy = 0" (đo thật 04/08 trên Preview). Bảng lọc, ô tổng thì không.
  const band = await api(`/wms/fill/tasks?warehouse_id=${whId}&status=PENDING`)
  check('11c. Ô tổng đếm toàn cảnh (lọc "Chờ làm" vẫn thấy số đã hủy)',
    band.s === 200 && Number(band.j?.data?.cancelled_n) >= 1
      && (band.j?.data?.rows ?? []).every(r => r.status === 'PENDING'),
    `rows=${band.j?.data?.rows?.length} đã hủy=${band.j?.data?.cancelled_n}`)

  // ── 12. Báo cáo theo người ────────────────────────────────────────────────
  const rep = await api(`/wms/fill/report?warehouse_id=${whId}&date_from=${DAY}&date_to=${DAY}`)
  const repRows = rep.j?.data?.rows ?? []
  const doneTotal = repRows.reduce((s, r) => s + Number(r.done_n), 0)
  const rateOk = repRows.every(r => Math.abs(r.rate - (r.total_n ? r.done_n * 100 / r.total_n : 0)) < 0.11)
  check('12a. Báo cáo đếm đúng số lệnh đã hạ', rep.s === 200 && doneTotal === 1, `done=${doneTotal}`)
  check('12b. Tỷ lệ hoàn thành = xong / được giao', rateOk, `rows=${repRows.length}`)

  // ── 13+14. Ngữ nghĩa tham số ──────────────────────────────────────────────
  const empty = await api(`/wms/fill/tasks?warehouse_id=${whId}&status=`)
  check('13. `?status=` RỖNG trả RỖNG (không âm thầm bỏ lọc)',
    empty.s === 200 && (empty.j?.data?.rows ?? []).length === 0, `rows=${empty.j?.data?.rows?.length}`)
  const noWh = await api('/wms/fill/demand')
  check('14. Thiếu kho → 400 (không dump dữ liệu kho khác)', noWh.s === 400, `http=${noWh.s}`)

  // ── 15. Bộ lọc cờ vị trí PHẢI THẬT SỰ CẮT (bug 04/08) ─────────────────────
  // Tham số `pick_face` từng bị hook FE bỏ rơi trên đường xuống query-string: chip lọc bật,
  // danh sách vẫn trả ĐỦ 1.517 dòng, không lỗi nào để lần ra. Phép kiểm chốt ở lớp API —
  // nếu một cờ bị bỏ qua thì "có" + "chưa" sẽ cộng thành GẤP ĐÔI tổng, không thể lọt.
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
  // Ô tổng dùng CHUNG bộ lọc với danh sách — lệch nhau là band "1.517" trên bảng 25 dòng
  const sum = await api(`/masterdata/locations/summary?warehouse_id=${whId}&pick_face=1`)
  const pg1 = await locTotal('&pick_face=1')
  check('15. Ô tổng đếm cùng tập với danh sách', sum.s === 200 && Number(sum.j?.data?.count) === pg1.n,
    `band=${sum.j?.data?.count} danh sách=${pg1.n}`)
} finally {
  console.log('\n🧹 dọn…')
  await cleanup()
  const residue = (await restAll('InventoryEntry', `select=id&pallet_code=like.${TAG}-*`)).length
    + (await restAll('Location', `select=id&location_code=like.${TAG}-*`)).length
  console.log(`residue=${residue}`)
}

finish('FILL-REPLENISH')
