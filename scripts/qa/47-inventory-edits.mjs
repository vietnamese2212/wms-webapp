// GÓI 47 — CÁC TÍNH NĂNG SỬA TRÊN TỒN KHO (đổi mã · đổi vị trí · đổi NCC/hạn lô · đổi ngày SX ·
// đổi QA · điều chỉnh tồn · kiểm kê 1 pallet · sửa/xoá pallet trong phiếu nhập · tách/dồn).
//
// VÌ SAO CÓ GÓI NÀY (đo 06/09 — cả 3 lỗi đều ÂM THẦM, API đều trả 200):
//   1. Chuyển pallet sang một ô THUỘC KHO KHÁC được chấp nhận, mà RPC không đụng `warehouse_id`
//      ⇒ sổ ghi hàng ở kho A, kệ chứa nó ở kho B, sức chứa kho B bị ăn mất 1 chỗ.
//   2. Sửa "số nhập" của pallet đã quét chỉ ghi `cartons_imported`, KHÔNG kéo `cartons_remaining`
//      ⇒ tồn > số nhập cho pallet chưa xuất lượt nào; và số ÂM được ghi thẳng vào DB.
//   3. Mọi cửa bulk trả `updated: ids.length` — ĐẾM Ý ĐỊNH, không phải kết quả: gọi với id không
//      tồn tại vẫn nhận "đã cập nhật 1 pallet".
import { api, login, restAll, restWrite, check, finish, HAS_DB, FIX, resolveFixtures } from './lib.mjs'
import { randomUUID } from 'crypto'

if (!HAS_DB) { console.error('Thiếu backend/.env — gói 47 cần soi DB'); process.exit(1) }
await login()
await resolveFixtures()

const T = 'QAINV'
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const DMY = TODAY.slice(8, 10) + TODAY.slice(5, 7) + TODAY.slice(2, 4)
const now = () => new Date().toISOString()
const num = v => Number(v ?? 0)
const day = (off) => new Date(Date.now() + off * 86400e3).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

console.log('── GÓI 47: SỬA TRÊN TỒN KHO ──')

async function wipe() {
  for (const e of await restAll('InventoryEntry', `select=id&pallet_code=like.*_${T}_*`)) {
    await restWrite('InventoryAdjustmentLog', 'DELETE', `entry_id=eq.${e.id}`).catch(() => {})
    await restWrite('InventoryEntry', 'DELETE', `id=eq.${e.id}`).catch(() => {})
  }
  await restWrite('StocktakeLog', 'DELETE', `pallet_code=like.*_${T}_*`).catch(() => {})
  await restWrite('packing_logs', 'DELETE', `pallet_code=like.*_${T}_*`).catch(() => {})
  for (const p of await restAll('ProductionImport', `select=id&notes=like.*${T}*`)) {
    await restWrite('InventoryEntry', 'DELETE', `import_order_id=eq.${p.id}`).catch(() => {})
    await restWrite('ProductionImport', 'DELETE', `id=eq.${p.id}`).catch(() => {})
  }
  for (const l of await restAll('Location', `select=id&location_code=like.${T}-*`))
    await restWrite('Location', 'DELETE', `id=eq.${l.id}`).catch(() => {})
}
await wipe()

// ── fixture: mã CÓ đơn vị thùng (để kiểm luật số nguyên) + 3 ô ở 2 KHO KHÁC NHAU ──
const [MAT] = await restAll('Material',
  'select=id,material_code,category,units_per_carton,cartons_per_pallet,entry_unit,base_unit,shelf_life_days'
  + '&entry_unit=not.is.null&units_per_carton=gt.1&cartons_per_pallet=gt.0&is_active=is.true&order=material_code&limit=1')
if (!MAT) { console.error('Không tìm được mã hàng có đơn vị thùng để test'); process.exit(1) }
const BASE = num(MAT.units_per_carton) * num(MAT.cartons_per_pallet)

const mkLoc = async (sfx, whId, max = 30) => (await restWrite('Location', 'POST', null, {
  id: randomUUID(), location_code: `${T}-${sfx}`, warehouse_id: whId, row: 'QA47', shelf: sfx,
  sub_code: `${T}-Z`, max_pallets: max, is_active: true, created_at: now(), updated_at: now(),
}))[0]
const L1 = await mkLoc('A1', FIX.WH_QR.id)
const L2 = await mkLoc('A2', FIX.WH_QR.id)
const LFULL = await mkLoc('A3', FIX.WH_QR.id, 1)
const LOTHER = await mkLoc('B1', FIX.WH_QTY.id)     // ô của KHO KHÁC

let seq = 0
const mkPallet = async (locId, extra = {}) => {
  const code = `${DMY}_${MAT.material_code}_${T}_101_${String(++seq).padStart(4, '0')}_B`
  await restWrite('InventoryEntry', 'POST', null, {
    id: randomUUID(), pallet_code: code, material_id: MAT.id, location_id: locId,
    warehouse_id: FIX.WH_QR.id, cartons_imported: BASE, cartons_remaining: BASE, cartons_reserved: 0,
    adjustment_qty: 0, production_date: day(-30), import_date: TODAY, status: 'IN_STOCK',
    stack_layer: 1, created_at: now(), updated_at: now(), ...extra,
  })
  return code
}
const entryOf = async c => (await restAll('InventoryEntry',
  `select=id,pallet_code,warehouse_id,location_id,material_id,cartons_imported,cartons_remaining,adjustment_qty,production_date,shelf_life_days,ncc_id,qa_status_id,stocktake_flagged,status&pallet_code=eq.${encodeURIComponent(c)}`))[0]

// ═══ 1. ĐỔI MÃ ══════════════════════════════════════════════════════════════
{
  const [MB] = await restAll('Material', `select=id,material_code&is_active=is.true&id=neq.${MAT.id}&order=material_code&limit=1`)
  const p = await mkPallet(L1.id)
  const e = await entryOf(p)
  const r = await api('/wms/inventory/bulk-material', 'PATCH', { ids: [e.id], material_id: MB.id })
  const a = await entryOf(p)
  check('[1] Đổi mã pallet: đổi đúng mã và KHÔNG đổi số lượng base (đổi nhãn, không bốc dỡ)',
    r.s === 200 && a.material_id === MB.id && num(a.cartons_remaining) === BASE,
    `s=${r.s} · base ${BASE}→${a.cartons_remaining}`)
  const r2 = await api('/wms/inventory/bulk-material', 'PATCH', { ids: [e.id], material_id: randomUUID() })
  check('[2] Đổi sang mã KHÔNG tồn tại → 404', r2.s === 404, `s=${r2.s}`)
  await api('/wms/inventory/bulk-material', 'PATCH', { ids: [e.id], material_id: MAT.id })
}

// ═══ 2. BỘ ĐẾM "ĐÃ CẬP NHẬT" PHẢI LÀ SỐ THẬT (hồi quy 06/09) ════════════════
{
  const lạ = randomUUID()
  const rs = await Promise.all([
    api('/wms/inventory/bulk-qa', 'PATCH', { ids: [lạ], qa_status_id: null }),
    api('/wms/inventory/bulk-material', 'PATCH', { ids: [lạ], material_id: MAT.id }),
    api('/wms/inventory/bulk-production-date', 'PATCH', { ids: [lạ], production_date: TODAY }),
  ])
  check('[3] Cửa sửa hàng loạt gọi với id KHÔNG tồn tại → báo "đã cập nhật 0" (không đếm ý định)',
    rs.every(r => r.s >= 400 || num(r.j?.data?.updated) === 0),
    rs.map(r => `${r.s}/${r.j?.data?.updated}`).join(' · '))
}

// ═══ 3. ĐỔI VỊ TRÍ ══════════════════════════════════════════════════════════
{
  const p1 = await mkPallet(L1.id), p2 = await mkPallet(L1.id)
  const e1 = await entryOf(p1), e2 = await entryOf(p2)

  let r = await api('/wms/inventory/bulk-location', 'PATCH', { ids: [e1.id], location_id: L2.id })
  check('[4] Chuyển pallet sang ô khác CÙNG KHO → được', r.s === 200 && (await entryOf(p1)).location_id === L2.id, `s=${r.s}`)

  // hồi quy 06/09: ô đích thuộc KHO KHÁC → phải chặn, và pallet KHÔNG được xê dịch
  r = await api('/wms/inventory/bulk-location', 'PATCH', { ids: [e1.id], location_id: LOTHER.id })
  const sau = await entryOf(p1)
  check('[5] Chuyển pallet sang ô của KHO KHÁC → CHẶN (hàng liên kho phải đi lệnh Chuyển kho)',
    r.s === 422 && r.j?.error?.code === 'CROSS_WAREHOUSE' && sau.location_id !== LOTHER.id,
    `s=${r.s} ${r.j?.error?.code ?? ''} · vị trí ${sau.location_id === LOTHER.id ? 'ĐÃ BỊ ĐỔI' : 'giữ nguyên'}`)

  await api('/wms/inventory/bulk-location', 'PATCH', { ids: [e1.id], location_id: LFULL.id })
  r = await api('/wms/inventory/bulk-location', 'PATCH', { ids: [e2.id], location_id: LFULL.id })
  const dem = (await restAll('InventoryEntry', `select=id&location_id=eq.${LFULL.id}&cartons_remaining=gt.0`)).length
  check('[6] Ô sức chứa 1 → nhận 1, chặn pallet thứ 2, ô không quá tải', r.s >= 400 && dem === 1,
    `s=${r.s} ${r.j?.error?.code ?? ''} · ô chứa ${dem}/1`)
}

// ═══ 4. ĐỔI NCC + HẠN DÙNG RIÊNG CỦA LÔ ═════════════════════════════════════
{
  const [NCC] = await restAll('TransportCompany', 'select=id,name&order=name&limit=1')
  const p = await mkPallet(L1.id)
  const e = await entryOf(p)
  let r = await api('/wms/inventory/bulk-ncc', 'PATCH', { ids: [e.id], ncc_id: NCC.id, shelf_life_days: 200 })
  let a = await entryOf(p)
  check('[7] Gán NCC kèm hạn dùng riêng của lô → ghi cả 2 cột',
    r.s === 200 && a.ncc_id === NCC.id && num(a.shelf_life_days) === 200, `ncc=${!!a.ncc_id} · hạn lô=${a.shelf_life_days}`)
  r = await api('/wms/inventory/bulk-ncc', 'PATCH', { ids: [e.id], ncc_id: null })
  a = await entryOf(p)
  check('[8] Bỏ NCC → xoá luôn hạn dùng riêng (quay về hạn của mã)',
    r.s === 200 && a.ncc_id === null && a.shelf_life_days === null, `ncc=${a.ncc_id} · hạn lô=${a.shelf_life_days}`)
}

// ═══ 5. ĐỔI NGÀY SX · ĐỔI QA ════════════════════════════════════════════════
{
  const p = await mkPallet(L1.id)
  const e = await entryOf(p)
  let r = await api('/wms/inventory/bulk-production-date', 'PATCH', { ids: [e.id], production_date: day(-10) })
  check('[9] Đổi ngày sản xuất → ghi đúng ngày',
    r.s === 200 && String((await entryOf(p)).production_date).slice(0, 10) === day(-10), `s=${r.s}`)
  r = await api('/wms/inventory/bulk-production-date', 'PATCH', { ids: [e.id], production_date: '32/13/2026' })
  check('[10] Ngày sản xuất không hợp lệ → 400', r.s === 400, `s=${r.s}`)

  const [QA] = await restAll('QAStatus', 'select=id,code&is_active=is.true&order=display_order&limit=1')
  r = await api('/wms/inventory/bulk-qa', 'PATCH', { ids: [e.id], qa_status_id: QA.id })
  const a1 = await entryOf(p)
  r = await api('/wms/inventory/bulk-qa', 'PATCH', { ids: [e.id], qa_status_id: null })
  const a2 = await entryOf(p)
  check('[11] Gán rồi gỡ trạng thái QA của pallet', a1.qa_status_id === QA.id && a2.qa_status_id === null,
    `gán=${a1.qa_status_id === QA.id} · gỡ=${a2.qa_status_id === null}`)
}

// ═══ 6. ĐIỀU CHỈNH TỒN + SỔ VẾT ═════════════════════════════════════════════
{
  const p = await mkPallet(L1.id)
  const e = await entryOf(p)
  const upc = num(MAT.units_per_carton)
  let r = await api(`/wms/inventory/${e.id}/adjust`, 'PATCH', { adjustment: -upc, note: `${T} hụt` })
  let a = await entryOf(p)
  check('[12] Điều chỉnh giảm → tồn giảm đúng và cột "đã điều chỉnh" cộng dồn',
    r.s === 200 && num(a.cartons_remaining) === BASE - upc && num(a.adjustment_qty) === -upc,
    `tồn=${a.cartons_remaining} · adjustment_qty=${a.adjustment_qty}`)

  r = await api(`/wms/inventory/${e.id}/adjustment-log`, 'GET')
  const logs = r.j?.data ?? []
  check('[13] Sổ điều chỉnh ghi đúng trước/sau', logs.length === 1
    && num(logs[0].cartons_before) === BASE && num(logs[0].cartons_after) === BASE - upc,
    `${logs.length} dòng · ${logs[0]?.cartons_before}→${logs[0]?.cartons_after}`)

  r = await api(`/wms/inventory/${e.id}/adjust`, 'PATCH', { adjustment: -(BASE * 2) })
  check('[14] Điều chỉnh làm tồn ÂM → chặn', r.s >= 400 && num((await entryOf(p)).cartons_remaining) === BASE - upc, `s=${r.s}`)
  r = await api(`/wms/inventory/${e.id}/adjust`, 'PATCH', { adjustment: 0 })
  check('[15] Điều chỉnh 0 → 400 (không tạo vết rỗng)', r.s === 400, `s=${r.s}`)
  r = await api(`/wms/inventory/${e.id}/adjust`, 'PATCH', { adjustment: 1.5 })
  check('[16] Mã bán theo thùng: điều chỉnh số lẻ → 422 (luật số nguyên)', r.s === 422, `s=${r.s}`)
}

// ═══ 7. KIỂM KÊ 1 PALLET + GỠ CỜ LỆCH ═══════════════════════════════════════
{
  const p = await mkPallet(L1.id)
  const e = await entryOf(p)
  const dem = BASE - num(MAT.units_per_carton) * 2
  let r = await api(`/wms/inventory/${e.id}/stocktake`, 'POST', { physical_count: dem })
  const a = await entryOf(p)
  const log = await restAll('StocktakeLog', `select=physical_qty,app_qty,diff&pallet_code=eq.${encodeURIComponent(p)}`)
  check('[17] Kiểm kê đếm thiếu → bật cờ lệch + sổ kiểm ghi đúng đếm/hệ thống/độ lệch',
    r.s === 200 && a.stocktake_flagged === true && log.length === 1
    && num(log[0].physical_qty) === dem && num(log[0].app_qty) === BASE && num(log[0].diff) === dem - BASE,
    `cờ=${a.stocktake_flagged} · ${log[0]?.physical_qty}/${log[0]?.app_qty} lệch ${log[0]?.diff}`)
  r = await api(`/wms/inventory/${e.id}/unflag`, 'PATCH', {})
  const sau = await restAll('StocktakeLog', `select=id&pallet_code=eq.${encodeURIComponent(p)}`)
  check('[18] Gỡ cờ lệch → cờ tắt nhưng GIỮ lịch sử kiểm',
    r.s === 200 && (await entryOf(p)).stocktake_flagged !== true && sau.length === log.length, `s=${r.s}`)
}

// ═══ 8. SỬA / XOÁ PALLET TRONG PHIẾU NHẬP (hồi quy 06/09) ═══════════════════
{
  const r0 = await api('/wms/inbound-orders', 'POST', {
    warehouse_id: FIX.WH_QR.id, material_id: MAT.id, location_id: L1.id, import_date: TODAY,
    source_type: 'FACTORY', warehouse_type: MAT.category, notes: `${T} phiếu`,
  })
  const order = r0.j?.data?.order ?? r0.j?.data
  if (!order?.id) {
    check('[19] Tạo phiếu nhập để test sửa pallet', false, `s=${r0.s} ${JSON.stringify(r0.j?.error ?? {}).slice(0, 100)}`)
  } else {
    const code = `${DMY}_${MAT.material_code}_${T}_101_${String(++seq).padStart(4, '0')}_B`
    await api('/wms/packing-logs/open', 'POST', { qr_code: code, complete: true, qty_cartons: BASE })
    const sc = await api(`/wms/inbound-orders/${order.id}/scan`, 'POST', { qr_code: code, location_id: L1.id, cartons_override: BASE })
    const e = await entryOf(code)
    check('[19] Quét 1 pallet vào phiếu nhập', sc.s === 200 && !!e, `s=${sc.s}`)
    if (e) {
      const moi = BASE - num(MAT.units_per_carton)
      let r = await api(`/wms/inbound-orders/${order.id}/entries/${e.id}`, 'PATCH', { cartons_imported: moi })
      let a = await entryOf(code)
      check('[20] Sửa "số nhập" của pallet CHƯA xuất → TỒN đi theo (không để tồn > số nhập)',
        r.s === 200 && num(a.cartons_imported) === moi && num(a.cartons_remaining) === moi,
        `s=${r.s} · nhập=${a.cartons_imported} · còn=${a.cartons_remaining} (phải bằng nhau)`)

      r = await api(`/wms/inbound-orders/${order.id}/entries/${e.id}`, 'PATCH', { cartons_imported: -5 })
      a = await entryOf(code)
      check('[21] Sửa "số nhập" về số ÂM → 422, DB không nhận', r.s === 422 && num(a.cartons_imported) >= 0,
        `s=${r.s} · DB nhập=${a.cartons_imported}`)

      r = await api(`/wms/inbound-orders/${order.id}/entries/${randomUUID()}`, 'DELETE')
      check('[22] Xoá pallet không thuộc phiếu → 404 (chống IDOR cặp id)', r.s === 404, `s=${r.s}`)

      r = await api(`/wms/inbound-orders/${order.id}/entries/${e.id}`, 'DELETE')
      check('[23] Xoá pallet quét nhầm → dòng tồn biến mất', r.s === 200 && !(await entryOf(code)), `s=${r.s}`)
    }
  }
}

// ═══ 9. TÁCH / DỒN PALLET ═══════════════════════════════════════════════════
{
  const p = await mkPallet(L1.id)
  const pref = p.split('_').slice(0, 5).join('_')   // pallet con V1 mang `.N` ở ĐOẠN SỐ THỨ TỰ
  const sum = async () => (await restAll('InventoryEntry', `select=cartons_remaining&pallet_code=like.${encodeURIComponent(pref)}*`))
    .reduce((s, r) => s + num(r.cartons_remaining), 0)
  const truoc = await sum()
  const q = Math.floor(BASE / 4)
  const r = await api('/wms/pallet-ops/split', 'POST',
    { source_pallet_code: p, warehouse_id: FIX.WH_QR.id, children: [{ qty: q }, { qty: q }] })
  check('[24] Tách pallet: tổng số lượng KHÔNG đổi, sinh đúng 2 pallet con',
    r.s === 200 && (await sum()) === truoc
    && (await restAll('InventoryEntry', `select=id&pallet_code=like.${encodeURIComponent(pref)}*`)).length === 3,
    `${truoc}→${await sum()}`)

  const t1 = await mkPallet(L1.id), t2 = await mkPallet(L1.id)
  const rd = await api('/wms/pallet-ops/merge', 'POST',
    { target_pallet_code: t1, child_pallet_codes: [t2], warehouse_id: FIX.WH_QR.id })
  const a1 = await entryOf(t1), a2 = await entryOf(t2)
  check('[25] Dồn pallet: tổng 2 pallet không đổi (dồn là GOM NHÓM, không làm bốc hơi hàng)',
    rd.s === 200 && num(a1.cartons_remaining) + num(a2.cartons_remaining) === BASE * 2,
    `s=${rd.s} · ${a1.cartons_remaining} + ${a2.cartons_remaining} = ${num(a1.cartons_remaining) + num(a2.cartons_remaining)} (phải ${BASE * 2})`)
}

// ═══ 10. BẤT BIẾN: KHÔNG PALLET NÀO CÓ TỒN > SỐ NHẬP ════════════════════════
// Trạng thái này chỉ sinh ra từ đường ghi SAI (số dôi ra không đến từ đâu cả). Staging đang có
// 2 dòng di sản từ đợt upload Tồn kho 29/07 (upload cố ý giữ nguyên `cartons_imported`) — baseline
// 2, KHÔNG được tăng. Tăng = có đường ghi mới đang làm hỏng dữ liệu.
{
  const BASELINE = 2
  const xau = await restAll('InventoryEntry',
    'select=pallet_code,cartons_imported,cartons_remaining,adjustment_qty&cartons_remaining=gt.0')
  const lech = xau.filter(r => num(r.cartons_remaining) > num(r.cartons_imported) + num(r.adjustment_qty) + 0.001)
  check('[26] Không pallet nào có TỒN lớn hơn SỐ NHẬP (số dôi không rõ nguồn) — baseline 2 dòng di sản',
    lech.length <= BASELINE,
    `${lech.length}/${BASELINE} dòng${lech.length > BASELINE ? ` · MỚI: ${lech.slice(0, 3).map(r => r.pallet_code).join(', ')}` : ''}`)
}

await wipe()
const conLai = (await restAll('InventoryEntry', `select=id&pallet_code=like.*_${T}_*`)).length
  + (await restAll('Location', `select=id&location_code=like.${T}-*`)).length
check('[27] Dọn 0 tàn dư', conLai === 0, `${conLai} bản ghi còn lại`)

finish('INVENTORY-EDITS')
