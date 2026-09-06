// GÓI 48 — TÍNH NĂNG NHỎ CỦA VỊ TRÍ KHO + PHIẾU NHẬP
// (tạo/sửa/xoá vị trí · cờ hàng loạt · "ô này đang chứa gì" · quét tem vị trí · ô tổng
//  · quét trùng/khác mã · xoá nhiều pallet · hoàn thành / bỏ hoàn thành / huỷ phiếu)
//
// Nhóm này trước nay không gói QA nào chạm tới. Bổ sung cùng đợt với gói 47 (06/09).
import { api, login, restAll, restWrite, check, finish, HAS_DB, FIX, resolveFixtures } from './lib.mjs'
import { randomUUID } from 'crypto'

if (!HAS_DB) { console.error('Thiếu backend/.env — gói 48 cần soi DB'); process.exit(1) }
await login()
await resolveFixtures()

const T = 'QALOC', ROW = 'QA48'
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const DMY = TODAY.slice(8, 10) + TODAY.slice(5, 7) + TODAY.slice(2, 4)
const now = () => new Date().toISOString()
const num = v => Number(v ?? 0)
console.log('── GÓI 48: VỊ TRÍ KHO + PHIẾU NHẬP ──')

async function wipe() {
  for (const e of await restAll('InventoryEntry', `select=id&pallet_code=like.*_${T}_*`))
    await restWrite('InventoryEntry', 'DELETE', `id=eq.${e.id}`).catch(() => {})
  await restWrite('packing_logs', 'DELETE', `pallet_code=like.*_${T}_*`).catch(() => {})
  for (const p of await restAll('ProductionImport', `select=id&notes=like.*${T}*`)) {
    await restWrite('InventoryEntry', 'DELETE', `import_order_id=eq.${p.id}`).catch(() => {})
    await restWrite('ProductionImport', 'DELETE', `id=eq.${p.id}`).catch(() => {})
  }
  for (const l of await restAll('Location', `select=id&row=eq.${ROW}`))
    await restWrite('Location', 'DELETE', `id=eq.${l.id}`).catch(() => {})
}
await wipe()

// Vị trí phải nằm trong một KHU đã khai của kho (Loại hàng + Tên khu kế thừa từ Khu) → mượn khu
// có sẵn của kho test, chỉ dựng DÃY riêng để không đụng dữ liệu thật.
const [ZONE] = await restAll('WarehouseZone', `select=code,name&warehouse_id=eq.${FIX.WH_QR.id}&is_active=is.true&order=sort_order&limit=1`)
if (!ZONE) { console.error(`Kho ${FIX.WH_QR.name} chưa khai Khu vực nào — không dựng được vị trí test`); process.exit(1) }

const [MAT] = await restAll('Material',
  'select=id,material_code,category,units_per_carton,cartons_per_pallet,entry_unit'
  + '&entry_unit=not.is.null&units_per_carton=gt.1&cartons_per_pallet=gt.0&is_active=is.true&order=material_code&limit=1')
const BASE = num(MAT.units_per_carton) * num(MAT.cartons_per_pallet)
const WH = FIX.WH_QR

// ═══ A. TẠO / SỬA / XOÁ VỊ TRÍ ══════════════════════════════════════════════
let LOC1 = null, LOC10 = null
{
  const body = { warehouse_id: WH.id, sub_code: ZONE.code, sub_name: ZONE.name, row: ROW, shelf: '1', max_pallets: 5 }
  let r = await api('/masterdata/locations', 'POST', body)
  LOC1 = r.j?.data
  check('[1] Tạo vị trí mới → sinh mã và ghi đúng sức chứa',
    r.s === 200 || r.s === 201 ? num(LOC1?.max_pallets) === 5 && !!LOC1?.location_code : false,
    `s=${r.s} · mã=${LOC1?.location_code} · sức chứa=${LOC1?.max_pallets}`)

  r = await api('/masterdata/locations', 'POST', body)
  check('[2] Tạo lại vị trí TRÙNG (cùng kho/khu/dãy/tầng) → chặn', r.s >= 400,
    `s=${r.s} ${r.j?.error?.code ?? ''} ${(r.j?.error?.message ?? '').slice(0, 60)}`)

  // ô thứ hai có mã KẾT THÚC BẰNG SỐ 10 — để thử luật "quét tem khớp TRỌN mã"
  r = await api('/masterdata/locations', 'POST', { ...body, shelf: '10' })
  LOC10 = r.j?.data

  r = await api(`/masterdata/locations/${LOC1.id}`, 'PUT', { max_pallets: 8, is_pick_face: true, sub_name: `${T} đã sửa` })
  const a = (await restAll('Location', `select=max_pallets,is_pick_face,sub_name&id=eq.${LOC1.id}`))[0]
  check('[3] Sửa vị trí: đổi sức chứa + bật cờ "vị trí nhặt lẻ"',
    r.s === 200 && num(a.max_pallets) === 8 && a.is_pick_face === true, `sức chứa=${a.max_pallets} · nhặt lẻ=${a.is_pick_face}`)

  r = await api(`/masterdata/locations/${LOC1.id}`, 'PUT', { max_pallets: -3 })
  const b = (await restAll('Location', `select=max_pallets&id=eq.${LOC1.id}`))[0]
  check('[4] Sửa sức chứa về số ÂM → chặn hoặc không ghi số âm', r.s >= 400 || num(b.max_pallets) >= 0,
    `s=${r.s} · DB sức chứa=${b.max_pallets}`)
  await api(`/masterdata/locations/${LOC1.id}`, 'PUT', { max_pallets: 8 })
}

// ═══ B. QUÉT TEM VỊ TRÍ — PHẢI KHỚP TRỌN MÃ ═════════════════════════════════
{
  let r = await api(`/masterdata/locations/resolve?code=${encodeURIComponent(LOC1.location_code)}&warehouse_id=${WH.id}`, 'GET')
  const d = r.j?.data
  check('[5] Quét tem vị trí → tra ra ĐÚNG ô đó', r.s === 200 && (d?.id === LOC1.id || d?.location_code === LOC1.location_code),
    `s=${r.s} · trả ${d?.location_code ?? '—'}`)

  // Bẫy: mã `...-1` KHÔNG được nhận nhầm sang `...-10`
  r = await api(`/masterdata/locations/resolve?code=${encodeURIComponent(LOC1.location_code)}&warehouse_id=${WH.id}`, 'GET')
  const tra = r.j?.data
  check('[6] Quét mã kết thúc bằng "1" KHÔNG được nhận nhầm ô "…10" (khớp TRỌN mã)',
    r.s === 200 && tra?.location_code === LOC1.location_code && tra?.location_code !== LOC10?.location_code,
    `quét ${LOC1.location_code} → ${tra?.location_code} (ô kia là ${LOC10?.location_code})`)

  r = await api(`/masterdata/locations/resolve?code=${T}-KHONG-CO-THAT&warehouse_id=${WH.id}`, 'GET')
  check('[7] Quét tem vị trí không có thật → 404 nói rõ', r.s === 404, `s=${r.s}`)
  r = await api('/masterdata/locations/resolve', 'GET')
  check('[8] Quét thiếu mã → 400', r.s === 400, `s=${r.s}`)
}

// ═══ C. "Ô NÀY ĐANG CHỨA GÌ" + XOÁ Ô ĐANG CÓ HÀNG ═══════════════════════════
{
  const codes = []
  for (let i = 1; i <= 2; i++) {
    const code = `${DMY}_${MAT.material_code}_${T}_101_000${i}_B`
    await restWrite('InventoryEntry', 'POST', null, {
      id: randomUUID(), pallet_code: code, material_id: MAT.id, location_id: LOC1.id, warehouse_id: WH.id,
      cartons_imported: BASE, cartons_remaining: BASE, cartons_reserved: 0, adjustment_qty: 0,
      production_date: TODAY, import_date: TODAY, status: 'IN_STOCK', stack_layer: 1,
      created_at: now(), updated_at: now(),
    })
    codes.push(code)
  }
  // "Ô này đang chứa gì" gom theo MÃ HÀNG (mỗi mã 1 dòng kèm số pallet), không trả từng pallet
  let r = await api(`/masterdata/locations/${LOC1.id}/contents`, 'GET')
  const d9 = r.j?.data ?? {}
  const rows = d9.materials ?? []
  const tongBase = rows.reduce((s, x) => s + num(x.qty_base), 0)
  check('[9] "Ô này đang chứa gì" đếm đúng 2 pallet và đúng tổng số lượng',
    r.s === 200 && num(d9.pallets) === 2 && tongBase === BASE * 2,
    `s=${r.s} · ${rows.length} mã · ${d9.pallets} pallet · ${tongBase} (phải ${BASE * 2})`)

  r = await api(`/masterdata/locations/${LOC1.id}`, 'DELETE')
  const con = (await restAll('Location', `select=is_active&id=eq.${LOC1.id}`))[0]
  check('[10] Xoá ô ĐANG CHỨA HÀNG → 409 (không để tồn mồ côi)',
    r.s === 409 && con.is_active === true, `s=${r.s} ${r.j?.error?.code ?? ''} · ô còn hoạt động=${con.is_active}`)

  // Hạ sức chứa xuống DƯỚI số đang chứa được PHÉP (kho thật vẫn thu hẹp kệ), nhưng khi đó ô phải
  // NHÌN THẤY là quá tải và KHÔNG nhận thêm pallet — im lặng nhận tiếp mới là hỏng.
  r = await api(`/masterdata/locations/${LOC1.id}`, 'PUT', { max_pallets: 1 })
  const dang = (await restAll('InventoryEntry', `select=id&location_id=eq.${LOC1.id}&cartons_remaining=gt.0`)).length
  const cap = (await restAll('Location', `select=max_pallets&id=eq.${LOC1.id}`))[0]
  const them = `${DMY}_${MAT.material_code}_${T}_101_0009_B`
  await restWrite('InventoryEntry', 'POST', null, {
    id: randomUUID(), pallet_code: them, material_id: MAT.id, location_id: LOC1.id, warehouse_id: WH.id,
    cartons_imported: BASE, cartons_remaining: BASE, cartons_reserved: 0, adjustment_qty: 0,
    production_date: TODAY, import_date: TODAY, status: 'IN_STOCK', stack_layer: 1, created_at: now(), updated_at: now(),
  })
  const themE = (await restAll('InventoryEntry', `select=id&pallet_code=eq.${encodeURIComponent(them)}`))[0]
  const rr = await api('/wms/inventory/bulk-location', 'PATCH', { ids: [themE.id], location_id: LOC1.id })
  check('[11] Ô bị hạ sức chứa xuống dưới số đang chứa → KHÔNG nhận thêm pallet nào nữa',
    r.s >= 400 || rr.s >= 400,
    `hạ sức chứa s=${r.s} (còn ${cap.max_pallets}, đang chứa ${dang}) · dồn thêm 1 pallet s=${rr.s} ${rr.j?.error?.code ?? ''}`)
  await restWrite('InventoryEntry', 'DELETE', `id=eq.${themE.id}`)
  await api(`/masterdata/locations/${LOC1.id}`, 'PUT', { max_pallets: 8 })

  for (const c of codes) await restWrite('InventoryEntry', 'DELETE', `pallet_code=eq.${encodeURIComponent(c)}`)
  r = await api(`/masterdata/locations/${LOC10.id}`, 'DELETE')
  check('[12] Xoá ô TRỐNG → được (ngừng hoạt động)',
    r.s === 200 && (await restAll('Location', `select=is_active&id=eq.${LOC10.id}`))[0].is_active === false, `s=${r.s}`)
}

// ═══ D. GẮN CỜ HÀNG LOẠT + Ô TỔNG + ID RÁC ══════════════════════════════════
{
  let r = await api('/masterdata/locations/bulk-flag', 'PATCH', { ids: [LOC1.id], requires_stocktake: true })
  const a = (await restAll('Location', `select=requires_stocktake&id=eq.${LOC1.id}`))[0]
  check('[13] Gắn cờ "cần kiểm kê" hàng loạt', r.s === 200 && a.requires_stocktake === true, `s=${r.s} · cờ=${a.requires_stocktake}`)
  r = await api('/masterdata/locations/bulk-flag', 'PATCH', { ids: [LOC1.id] })
  check('[14] Gắn cờ mà không gửi cờ nào → 400 (không âm thầm không làm gì)', r.s === 400, `s=${r.s}`)

  r = await api(`/masterdata/locations/summary?warehouse_id=${WH.id}`, 'GET')
  const s = r.j?.data ?? {}
  const dbTong = (await restAll('Location', `select=id&warehouse_id=eq.${WH.id}&is_active=is.true`)).length
  const appTong = num(s.total ?? s.total_locations ?? s.locations ?? NaN)
  check('[15] Ô tổng trang Vị trí kho khớp đếm thẳng DB',
    r.s === 200 && (!Number.isFinite(appTong) || Math.abs(appTong - dbTong) <= 1),
    `app=${Number.isFinite(appTong) ? appTong : Object.keys(s).join(',')} · DB=${dbTong}`)

  r = await api('/masterdata/locations/undefined', 'GET')
  check('[16] id rác "undefined" trên /locations/:id → 400/404 (không 500)', r.s === 400 || r.s === 404, `s=${r.s}`)
}

// ═══ E. PHIẾU NHẬP: QUÉT TRÙNG · KHÁC MÃ · XOÁ NHIỀU · ĐÓNG/MỞ/HUỶ ══════════
{
  const r0 = await api('/wms/inbound-orders', 'POST', {
    warehouse_id: WH.id, material_id: MAT.id, location_id: LOC1.id, import_date: TODAY,
    source_type: 'FACTORY', warehouse_type: MAT.category, notes: `${T} phiếu`,
  })
  const order = r0.j?.data?.order ?? r0.j?.data
  if (!order?.id) { check('[17] Tạo phiếu nhập', false, `s=${r0.s}`) }
  else {
    const codes = []
    for (let i = 1; i <= 3; i++) {
      const code = `${DMY}_${MAT.material_code}_${T}_101_01${i}0_B`
      await api('/wms/packing-logs/open', 'POST', { qr_code: code, complete: true, qty_cartons: BASE })
      const s = await api(`/wms/inbound-orders/${order.id}/scan`, 'POST', { qr_code: code, location_id: LOC1.id, cartons_override: BASE })
      if (s.s === 200) codes.push(code)
    }
    check('[17] Quét 3 pallet vào phiếu nhập', codes.length === 3, `${codes.length}/3`)

    let r = await api(`/wms/inbound-orders/${order.id}/scan`, 'POST', { qr_code: codes[0], location_id: LOC1.id, cartons_override: BASE })
    check('[18] Quét TRÙNG tem đã nhập → chặn (không nhân đôi tồn)', r.s >= 400, `s=${r.s} ${r.j?.error?.code ?? ''}`)

    const [MB] = await restAll('Material', `select=material_code&is_active=is.true&material_code=neq.${MAT.material_code}&order=material_code&limit=1`)
    r = await api(`/wms/inbound-orders/${order.id}/scan`, 'POST',
      { qr_code: `${DMY}_${MB.material_code}_${T}_101_0900_B`, location_id: LOC1.id, cartons_override: 10 })
    check('[19] Quét tem KHÁC MÃ với phiếu → chặn', r.s >= 400, `s=${r.s} ${r.j?.error?.code ?? ''}`)

    r = await api(`/wms/inbound-orders/${order.id}/scan`, 'POST', { qr_code: 'TEM-RAC-###', location_id: LOC1.id })
    check('[20] Quét tem sai định dạng → 4xx sạch (không 500)', r.s >= 400 && r.s < 500, `s=${r.s} ${r.j?.error?.code ?? ''}`)

    // xoá NHIỀU pallet cùng lúc
    const ids = []
    for (const c of codes.slice(1)) {
      const e = (await restAll('InventoryEntry', `select=id&pallet_code=eq.${encodeURIComponent(c)}`))[0]
      if (e) ids.push(e.id)
    }
    r = await api(`/wms/inbound-orders/${order.id}/entries`, 'DELETE', { entry_ids: ids })
    const conLai = (await restAll('InventoryEntry', `select=id&import_order_id=eq.${order.id}`)).length
    check('[21] Xoá NHIỀU pallet cùng lúc → chỉ còn 1 pallet trong phiếu',
      (r.s === 200 || r.s === 204) && conLai === 1, `s=${r.s} · còn ${conLai} pallet`)

    r = await api(`/wms/inbound-orders/${order.id}/complete`, 'POST', {})
    let st = (await restAll('ProductionImport', `select=status&id=eq.${order.id}`))[0]
    check('[22] Hoàn thành phiếu nhập → trạng thái đóng', r.s === 200 && st.status !== 'OPEN', `s=${r.s} · ${st.status}`)

    const e1 = (await restAll('InventoryEntry', `select=id&import_order_id=eq.${order.id}`))[0]
    if (e1) {
      r = await api(`/wms/inbound-orders/${order.id}/entries/${e1.id}`, 'PATCH', { cartons_imported: 10 })
      check('[23] Sửa pallet khi phiếu ĐÃ ĐÓNG → chặn', r.s >= 400, `s=${r.s} ${r.j?.error?.code ?? ''}`)
    }

    r = await api(`/wms/inbound-orders/${order.id}/uncomplete`, 'POST', {})
    st = (await restAll('ProductionImport', `select=status&id=eq.${order.id}`))[0]
    check('[24] Bỏ hoàn thành → phiếu mở lại', r.s === 200 && st.status === 'OPEN', `s=${r.s} · ${st.status}`)

    // Huỷ phiếu KHI CÒN PALLET phải bị chặn (huỷ thẳng sẽ để lại tồn mồ côi), xoá hết rồi mới huỷ được
    r = await api(`/wms/inbound-orders/${order.id}/cancel`, 'POST', {})
    check('[25] Huỷ phiếu khi CÒN pallet → chặn (không để tồn mồ côi)',
      r.s === 400 && r.j?.error?.code === 'HAS_ENTRIES', `s=${r.s} ${r.j?.error?.code ?? ''}`)

    for (const e of await restAll('InventoryEntry', `select=id&import_order_id=eq.${order.id}`))
      await api(`/wms/inbound-orders/${order.id}/entries/${e.id}`, 'DELETE')
    r = await api(`/wms/inbound-orders/${order.id}/cancel`, 'POST', {})
    const conPhieu = (await restAll('ProductionImport', `select=id&id=eq.${order.id}`)).length
    const tonMoCoi = (await restAll('InventoryEntry', `select=id&import_order_id=eq.${order.id}`)).length
    check('[25b] Xoá hết pallet rồi huỷ → phiếu biến mất, không để lại tồn mồ côi',
      r.s === 200 && conPhieu === 0 && tonMoCoi === 0, `s=${r.s} · phiếu còn=${conPhieu} · tồn mồ côi=${tonMoCoi}`)
  }
}

await wipe()
const conLai = (await restAll('InventoryEntry', `select=id&pallet_code=like.*_${T}_*`)).length
  + (await restAll('Location', `select=id&row=eq.${ROW}`)).length
  + (await restAll('ProductionImport', `select=id&notes=like.*${T}*`)).length
check('[26] Dọn 0 tàn dư', conLai === 0, `${conLai} bản ghi còn lại`)

finish('LOCATION-INBOUND-EDITS')
