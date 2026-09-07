// GÓI 52 — CÁC MÔ-ĐUN VẬN HÀNH CHƯA CÓ CỔNG QA NÀO GÁC
// (Chi phí kho · Slotting · Fill · Xe nâng · Phiếu cân · Lịch sử quét · 4 cửa Xuất kho còn hở
//  · Đối chiếu SAP · Sửa nhóm phiếu NCC · Upload Tồn kho · Ô lọc In tem)
//
// VÌ SAO CÓ GÓI NÀY: rà 07/09 thấy ~30 route ghi dữ liệu THẬT (tiền chi phí kho, đồng hồ xe nâng,
// gắn phiếu cân với chuyến, số lượng đơn theo SAP, tồn kho upload) chưa phép kiểm nào chạm tới.
// Bộ QA hiện có gác rất chặt Xuất/Nhập/Quét nhưng bỏ trống đúng những chỗ ghi SỐ TIỀN và SỐ TỒN —
// nơi sai một lần là kế toán/kiểm kê phải dò tay. Luật "bug chết hai lần": mỗi nghi ngờ trong
// hợp đồng API đều có ÍT NHẤT 1 phép kiểm ở đây.
//
// NGUYÊN TẮC: mọi ORACLE tự tính lại từ dữ liệu mình vừa ghi (không so hằng số gõ tay).
// AN TOÀN: chỉ đụng bản ghi tự tạo, mã/tem/tên đều mang tiền tố QA52; chi phí ghi vào KỲ TƯƠNG LAI
// (2026-11/2026-12) trên KHO TỰ DỰNG nên không chạm số liệu user đang xem; dọn sạch ở cuối.
import { api, rawFetch, login, restAll, restWrite, restRpc, check, finish, HAS_DB, FIX, BASE } from './lib.mjs'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'

if (!HAS_DB) { console.error('Thiếu backend/.env — gói 52 cần soi DB'); process.exit(1) }

// xlsx lấy từ node_modules của frontend (backend cũng có; thử lần lượt)
let XLSX = null
for (const p of ['../../frontend/package.json', '../../backend/package.json']) {
  try { XLSX = createRequire(new URL(p, import.meta.url))('xlsx'); break } catch { /* thử chỗ kế */ }
}
if (!XLSX) { console.error('Không tìm thấy thư viện xlsx (npm i ở frontend hoặc backend)'); process.exit(1) }

const T = 'QA52'
const now = () => new Date().toISOString()
const num = v => Number(v ?? 0)
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const DMY = TODAY.slice(8, 10) + TODAY.slice(5, 7) + TODAY.slice(2, 4)
const dayShift = n => new Date(Date.now() + n * 86400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const PER = '2026-12', PER_D = '2026-12-01', PREV = '2026-11', PREV_D = '2026-11-01'
const err = r => `${r.j?.error?.code ?? ''} ${(r.j?.error?.message ?? '').slice(0, 70)}`.trim()
const server500 = []   // ca 5xx gặp phải → báo cáo để dọn error_logs

console.log('── GÓI 52: VẬN HÀNH (chi phí · slotting · fill · xe nâng · cân · quét · xuất · SAP · tồn) ──')
await login()

// Token riêng cho multipart (lib.mjs không lộ token ra ngoài)
const TOKEN = await (async () => {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.QA_ADMIN_EMAIL || 'admin', password: process.env.QA_ADMIN_PASSWORD || 'Bavi1234' }),
  })
  return (await r.json())?.data?.token
})()

/** Gửi 1 file Excel lên cửa upload (multipart field `file`) + form field kèm theo. */
async function upload(path, buf, fields = {}) {
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${T}.xlsx`)
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v))
  const r = await fetch(`${BASE}/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd })
  let j = null, text = ''
  try { text = await r.text(); j = JSON.parse(text) } catch { /* không phải JSON */ }
  if (r.status >= 500) server500.push(`${path} → ${r.status} lúc ${new Date().toLocaleTimeString('vi-VN')}`)
  return { s: r.status, j, text }
}
/** Dựng workbook từ mảng dòng; `merges` = [{s:{r,c},e:{r,c}}] để dựng Ô GỘP thật. */
function xbuf(rows, merges) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  if (merges?.length) ws['!merges'] = merges
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}
/** Bỏ trống các ô thuộc vùng gộp (Excel thật chỉ giữ giá trị ở ô trái-trên) rồi khai !merges. */
function mergeDown(rows, col, fromRow, toRow) {
  for (let r = fromRow + 1; r <= toRow; r++) rows[r][col] = ''
  return [{ s: { r: fromRow, c: col }, e: { r: toRow, c: col } }]
}

// ═══ DỌN TRƯỚC (chạy lại gói không bị vướng tàn dư lượt trước) ═══════════════
const GDOS = []   // {id} các chuyến tự tạo
async function wipe() {
  // Xuất kho (Item → Delivery → GDO)
  const gd = await restAll('GroupDeliveryOrder', `select=id&group_code=like.${T}*`)
  if (gd.length) {
    const ids = `(${gd.map(g => g.id).join(',')})`
    const dos = await restAll('OutboundDelivery', `select=id&gdo_id=in.${ids}`)
    if (dos.length) {
      const dids = `(${dos.map(d => d.id).join(',')})`
      const its = await restAll('OutboundItem', `select=id&do_id=in.${dids}`)
      if (its.length) await restWrite('OutboundScanEntry', 'DELETE', `item_id=in.(${its.map(i => i.id).join(',')})`).catch(() => {})
      await restWrite('OutboundItem', 'DELETE', `do_id=in.${dids}`).catch(() => {})
    }
    await restWrite('OutboundDelivery', 'DELETE', `gdo_id=in.${ids}`).catch(() => {})
    // Phiếu cân là liên kết MỀM: gỡ liên kết chứ KHÔNG xoá phiếu (có thể là phiếu thật vừa tự khớp)
    await restWrite('WeighTicket', 'PATCH', `gdo_id=in.${ids}`, { gdo_id: null, matched_at: null, matched_by: null, updated_at: now() }).catch(() => {})
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=in.${ids}`).catch(() => {})
  }
  await restWrite('WeighTicket', 'DELETE', `station_code=eq.${T}`).catch(() => {})
  await restWrite('reconcile_tasks', 'DELETE', `od_number=like.${T}*`).catch(() => {})
  // Fill
  for (const o of await restAll('FillOrder', `select=id&order_code=like.${T}*`)) {
    await restWrite('FillTask', 'DELETE', `fill_order_id=eq.${o.id}`).catch(() => {})
    await restWrite('FillOrder', 'DELETE', `id=eq.${o.id}`).catch(() => {})
  }
  // Slotting
  for (const p of await restAll('SlottingPlan', `select=id&name=like.${T}*`)) {
    await restWrite('SlottingPlanLine', 'DELETE', `plan_id=eq.${p.id}`).catch(() => {})
    await restWrite('SlottingPlan', 'DELETE', `id=eq.${p.id}`).catch(() => {})
  }
  // Tồn kho + phiếu nhập
  for (const e of await restAll('InventoryEntry', `select=id&pallet_code=like.${T}*`)) {
    await restWrite('InventoryAdjustmentLog', 'DELETE', `entry_id=eq.${e.id}`).catch(() => {})
    await restWrite('InventoryEntry', 'DELETE', `id=eq.${e.id}`).catch(() => {})
  }
  for (const p of await restAll('ProductionImport', `select=id&notes=like.*${T}*`)) {
    await restWrite('InventoryEntry', 'DELETE', `import_order_id=eq.${p.id}`).catch(() => {})
    await restWrite('ProductionImport', 'DELETE', `id=eq.${p.id}`).catch(() => {})
  }
  await restWrite('PalletLabelPrint', 'DELETE', `qr_code=like.${T}*`).catch(() => {})
  // Xe nâng
  for (const v of await restAll('forklift_vehicles', `select=id&code=like.${T}*`)) {
    await restWrite('forklift_daily_logs', 'DELETE', `forklift_id=eq.${v.id}`).catch(() => {})
    await restWrite('forklift_vehicles', 'DELETE', `id=eq.${v.id}`).catch(() => {})
  }
  await restWrite('forklift_checklist_items', 'DELETE', `label=like.${T}*`).catch(() => {})
  // Chi phí kho
  await restWrite('warehouse_costs', 'DELETE', `period=in.(${PER_D},${PREV_D})&cost_item=like.${T}*`).catch(() => {})
  await restWrite('LookupValue', 'DELETE', `type=eq.cost_item&value=like.${T}*`).catch(() => {})
  // Vị trí + kho tự dựng (sau cùng vì nhiều bảng trỏ tới)
  for (const l of await restAll('Location', `select=id&row=eq.${T}`)) await restWrite('Location', 'DELETE', `id=eq.${l.id}`).catch(() => {})
  for (const w of await restAll('Warehouse', `select=id&code=like.${T}*`)) {
    await restWrite('warehouse_costs', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('warehouse_cost_locks', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('Warehouse', 'DELETE', `id=eq.${w.id}`).catch(() => {})
  }
  // Tài khoản phụ (kiểm phạm vi)
  for (const e of await restAll('Employee', `select=id&employee_code=like.${T}*`)) {
    await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${e.id}`).catch(() => {})
    await restWrite('Employee', 'DELETE', `id=eq.${e.id}`).catch(() => {})
  }
  for (const j of await restAll('JobTitle', `select=id&name=like.${T}*`)) await restWrite('JobTitle', 'DELETE', `id=eq.${j.id}`).catch(() => {})
}
await wipe()

// ═══ FIXTURE NỀN ════════════════════════════════════════════════════════════
// Kho TỰ DỰNG cho chi phí / xe nâng / phiếu cân / chuyến xuất → không đụng kho thật.
const [WH] = await restWrite('Warehouse', 'POST', null, {
  id: randomUUID(), code: `${T}W`, name: `${T} kho kiểm thử`, warehouse_type: 'CENTRAL',
  inventory_mode: 'QTY', require_gate_on_start: true, require_weigh_on_start: true,
  is_active: true, updated_at: now(),
})
// Mã hàng + vị trí THẬT (slotting/tồn kho phải chạy trên kho có khu vực đã khai)
const [MAT] = await restAll('Material',
  `select=id,material_code,category,units_per_carton,entry_unit,base_unit&material_code=eq.${FIX.MAT_POOL}`)
const UPC = MAT?.entry_unit ? Math.max(1, num(MAT.units_per_carton)) : 1
const HAS_ENTRY = !!MAT?.entry_unit
const [ZONE] = await restAll('WarehouseZone',
  `select=id,code,name,pick_rank&warehouse_id=eq.${FIX.WH_QR.id}&is_active=is.true&order=sort_order&limit=1`)
if (!ZONE) { console.error(`Kho ${FIX.WH_QR.name} chưa khai Khu vực — không dựng được vị trí test`); process.exit(1) }

const mkLoc = async (shelf, cap, pick = false) => {
  const r = await api('/masterdata/locations', 'POST', {
    warehouse_id: FIX.WH_QR.id, sub_code: ZONE.code, sub_name: ZONE.name, row: T, shelf, max_pallets: cap,
  })
  const d = r.j?.data
  if (d?.id && pick) await api(`/masterdata/locations/${d.id}`, 'PUT', { is_pick_face: true })
  return d
}
const LOC_A = await mkLoc('1', 5)          // nguồn
const LOC_B = await mkLoc('2', 5)          // đích còn chỗ
const LOC_F = await mkLoc('3', 1)          // đích sẽ bị làm ĐẦY
const LOC_P = await mkLoc('4', 5, true)    // vị trí nhặt lẻ (fill)
if (!LOC_A?.id || !LOC_B?.id || !LOC_F?.id) { console.error('Không dựng được vị trí test'); process.exit(1) }

const mkEntry = async (code, locId, qty = UPC * 2) => {
  const [e] = await restWrite('InventoryEntry', 'POST', null, {
    id: randomUUID(), pallet_code: code, material_id: MAT.id, location_id: locId, warehouse_id: FIX.WH_QR.id,
    cartons_imported: qty, cartons_remaining: qty, cartons_reserved: 0, adjustment_qty: 0,
    production_date: `${TODAY}T00:00:00`, import_date: TODAY, status: 'IN_STOCK', stack_layer: 1,
    created_at: now(), updated_at: now(),
  })
  return e
}

// ══════════════════════════════════════════════════════════════════════════════
// A. CHI PHÍ KHO
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── A. Chi phí kho ──')
let ITEM1 = null, ITEM2 = null, COST1 = null
{
  let r = await api('/wms/warehouse-costs/items', 'POST', { label: `${T} Thue pallet` })
  ITEM1 = r.j?.data?.code
  r = await api('/wms/warehouse-costs/items', 'POST', { label: `${T} Thue xe nang` })
  ITEM2 = r.j?.data?.code
  check('[1] Thêm 2 khoản mục chi phí mới vào danh mục', !!ITEM1 && !!ITEM2, `${ITEM1} · ${ITEM2}`)

  r = await api('/wms/warehouse-costs', 'POST', { period: PER, warehouse_id: WH.id, cost_item: ITEM1, amount: 45_000_000, note: `${T} ghi chú` })
  COST1 = r.j?.data?.id
  const row = (await restAll('warehouse_costs', `select=amount,period&id=eq.${COST1 ?? '0'}`))[0]
  check('[2] Kê khai 1 dòng chi phí cho kho + kỳ → lưu đúng số tiền và đúng kỳ',
    r.s === 200 && num(row?.amount) === 45_000_000 && String(row?.period).slice(0, 10) === PER_D,
    `s=${r.s} · DB=${row?.amount} · kỳ=${row?.period}`)

  // Kế toán gõ/dán số kiểu Việt Nam. Code khai nhận "45.000.000" (comment parseAmount) và ô nhập
  // cho dán thẳng từ Excel ⇒ phải ăn được. 2 dạng: chấm phân cách nghìn, và chấm nghìn + phẩy thập phân.
  const vn = []
  for (const [txt, canCo] of [['45.000.000', 45_000_000], ['1.234,5', 1234.5], ['12,5', 12.5]]) {
    const rr = await api('/wms/warehouse-costs', 'POST', { period: PER, warehouse_id: WH.id, cost_item: ITEM2, amount: txt })
    const got = num((await restAll('warehouse_costs', `select=amount&period=eq.${PER_D}&warehouse_id=eq.${WH.id}&cost_item=eq.${ITEM2}`))[0]?.amount)
    vn.push(`"${txt}"→${rr.s === 200 ? got : `HTTP ${rr.s} ${err(rr)}`}${rr.s === 200 && got === canCo ? '' : ` (cần ${canCo})`}`)
    await restWrite('warehouse_costs', 'DELETE', `period=eq.${PER_D}&warehouse_id=eq.${WH.id}&cost_item=eq.${ITEM2}`).catch(() => {})
  }
  check('[2b] Gõ số tiền kiểu Việt Nam ("45.000.000") → nhận đúng, không báo "Số tiền không hợp lệ"',
    vn.every(x => !x.includes('cần') && !x.includes('HTTP')), vn.join(' · '))

  // Cùng lỗi đó trên đường UPLOAD: kế toán xuất file có cột Số tiền định dạng VĂN BẢN.
  // Nguy hiểm nhất là "1.234" — nếu bị đọc thành 1,234 thì SAI ÂM THẦM, không báo lỗi gì.
  const upVn = []
  for (const [txt, canCo] of [['45.000.000', 45_000_000], ['1.234', 1234]]) {
    const rr = await upload('/wms/warehouse-costs/upload',
      xbuf([['Tháng', 'Kho', 'Khoản mục', 'Số tiền'], [PER, `${T}W`, ITEM2, txt]]), { period: PER })
    const got = num((await restAll('warehouse_costs', `select=amount&period=eq.${PER_D}&warehouse_id=eq.${WH.id}&cost_item=eq.${ITEM2}`))[0]?.amount)
    const loi = (rr.j?.data?.errors ?? [])[0] ?? (rr.s >= 400 ? rr.j?.error?.message : null)
    upVn.push(`"${txt}"→${rr.s >= 400 || loi ? `TỪ CHỐI CẢ FILE (HTTP ${rr.s}: ${String(loi ?? '').slice(0, 40)})` : `ghi ${got}`}${got === canCo ? '' : ` ✗ cần ${canCo}`}`)
    await restWrite('warehouse_costs', 'DELETE', `period=eq.${PER_D}&warehouse_id=eq.${WH.id}&cost_item=eq.${ITEM2}`).catch(() => {})
  }
  check('[2c] Upload file có cột Số tiền dạng VĂN BẢN kiểu VN → ghi đúng số, không sai âm thầm',
    upVn.every(x => !x.includes('cần')), upVn.join(' · '))

  r = await api('/wms/warehouse-costs', 'POST', { period: PER, warehouse_id: WH.id, cost_item: ITEM1, amount: 1 })
  const dem = (await restAll('warehouse_costs', `select=id&period=eq.${PER_D}&warehouse_id=eq.${WH.id}&cost_item=eq.${ITEM1}`)).length
  check('[3] Khai lại đúng (kho · kỳ · khoản mục) → chặn, KHÔNG đẻ dòng thứ hai',
    r.s === 409 && dem === 1, `s=${r.s} ${err(r)} · số dòng=${dem}`)

  // ORACLE: tổng tiền app trả = tổng tự cộng từ chính các dòng đã ghi
  await api('/wms/warehouse-costs', 'POST', { period: PER, warehouse_id: WH.id, cost_item: ITEM2, amount: 12_500_000 })
  const db = await restAll('warehouse_costs', `select=amount&period=eq.${PER_D}&warehouse_id=eq.${WH.id}`)
  const tuCong = db.reduce((s, x) => s + num(x.amount), 0)
  r = await api(`/wms/warehouse-costs/voucher?warehouse_id=${WH.id}&period=${PER}`, 'GET')
  const v = r.j?.data
  const tongRows = (v?.rows ?? []).reduce((s, x) => s + num(x.amount), 0)
  check('[4] Tổng tiền phiếu app hiện = tổng tự cộng các dòng đã ghi',
    r.s === 200 && num(v?.totals?.amount) === tuCong && tongRows === tuCong,
    `app tổng=${v?.totals?.amount} · cộng dòng app=${tongRows} · cộng DB=${tuCong}`)

  r = await api(`/wms/warehouse-costs/${COST1}`, 'PATCH', { amount: 50_000_000 })
  const sau = (await restAll('warehouse_costs', `select=amount&id=eq.${COST1}`))[0]
  check('[5] Sửa số tiền 1 dòng → đọc lại đúng số mới', r.s === 200 && num(sau?.amount) === 50_000_000, `s=${r.s} · DB=${sau?.amount}`)

  // ── KỲ ĐÃ CHỐT: mọi đường ghi phải 409 ──
  const lock = await api('/wms/warehouse-costs/lock', 'POST', { period: PER, warehouse_id: WH.id, locked: true })
  const rNew = await api('/wms/warehouse-costs', 'POST', { period: PER, warehouse_id: WH.id, cost_item: ITEM1, amount: 9 })
  const rUpd = await api(`/wms/warehouse-costs/${COST1}`, 'PATCH', { amount: 1 })
  const rDel = await api(`/wms/warehouse-costs/${COST1}`, 'DELETE')
  const rVou = await api('/wms/warehouse-costs/voucher', 'PUT', { period: PER, warehouse_id: WH.id, lines: [{ cost_item: ITEM1, amount: 1 }] })
  const conNguyen = num((await restAll('warehouse_costs', `select=amount&id=eq.${COST1}`))[0]?.amount)
  check('[6] Kỳ ĐÃ CHỐT: thêm / sửa / xoá / lưu phiếu đều bị chặn và số cũ giữ nguyên',
    lock.s === 200 && rNew.s === 409 && rUpd.s === 409 && rDel.s === 409 && rVou.s === 409 && conNguyen === 50_000_000,
    `chốt=${lock.s} thêm=${rNew.s} sửa=${rUpd.s} xoá=${rDel.s} phiếu=${rVou.s} · số cũ=${conNguyen}`)

  const upLock = await upload('/wms/warehouse-costs/upload',
    xbuf([['Tháng', 'Kho', 'Khoản mục', 'Số tiền'], [PER, `${T}W`, ITEM1, 777]]), { period: PER })
  const conLock = num((await restAll('warehouse_costs', `select=amount&id=eq.${COST1}`))[0]?.amount)
  check('[7] Kỳ ĐÃ CHỐT: upload Excel vào kỳ đó không ghi được dòng nào',
    (upLock.s >= 400 || num(upLock.j?.data?.inserted) + num(upLock.j?.data?.updated) === 0) && conLock === 50_000_000,
    `s=${upLock.s} · thêm=${upLock.j?.data?.inserted} sửa=${upLock.j?.data?.updated} · số cũ=${conLock}`)

  const unlock = await api('/wms/warehouse-costs/lock', 'POST', { period: PER, warehouse_id: WH.id, locked: false })
  const rAgain = await api(`/wms/warehouse-costs/${COST1}`, 'PATCH', { amount: 50_000_000, note: `${T} mo lai` })
  check('[8] Mở lại kỳ → sửa được như cũ', unlock.s === 200 && rAgain.s === 200, `mở=${unlock.s} sửa=${rAgain.s}`)

  // ── CHÉP THÁNG TRƯỚC: chỉ ĐẮP dòng còn thiếu ──
  // AN TOÀN: tài khoản QA không giới hạn kho ⇒ copy-previous chép MỌI kho. Ghi lại ảnh chụp id
  // đang có ở kỳ đích để xoá đúng những dòng do lệnh chép này sinh ra cho kho KHÁC (nếu có).
  await restWrite('warehouse_costs', 'POST', null, [
    { id: randomUUID(), warehouse_id: WH.id, period: PREV_D, cost_item: ITEM1, amount: 111, created_at: now(), updated_at: now() },
    { id: randomUUID(), warehouse_id: WH.id, period: PREV_D, cost_item: ITEM2, amount: 222, created_at: now(), updated_at: now() },
  ])
  const snap = new Set((await restAll('warehouse_costs', `select=id&period=eq.${PER_D}`)).map(x => x.id))
  const donRac = async () => {
    for (const x of await restAll('warehouse_costs', `select=id,warehouse_id&period=eq.${PER_D}`))
      if (!snap.has(x.id) && x.warehouse_id !== WH.id) await restWrite('warehouse_costs', 'DELETE', `id=eq.${x.id}`).catch(() => {})
  }
  // kỳ đích đang có ITEM1 (50tr) + ITEM2 (12,5tr) → không dòng nào thiếu
  r = await api('/wms/warehouse-costs/copy-previous', 'POST', { period: PER })
  await donRac()
  const giu1 = num((await restAll('warehouse_costs', `select=amount&period=eq.${PER_D}&warehouse_id=eq.${WH.id}&cost_item=eq.${ITEM1}`))[0]?.amount)
  check('[9a] Chép tháng trước KHÔNG đè số đã khai (dòng đã có giữ nguyên)',
    r.s === 200 && giu1 === 50_000_000 && num(r.j?.data?.skipped_existing) >= 2,
    `chép=${r.j?.data?.copied} bỏ vì đã có=${r.j?.data?.skipped_existing} · ITEM1 vẫn=${giu1}`)

  await restWrite('warehouse_costs', 'DELETE', `period=eq.${PER_D}&warehouse_id=eq.${WH.id}&cost_item=eq.${ITEM2}`)
  r = await api('/wms/warehouse-costs/copy-previous', 'POST', { period: PER })
  await donRac()
  const dap2 = num((await restAll('warehouse_costs', `select=amount&period=eq.${PER_D}&warehouse_id=eq.${WH.id}&cost_item=eq.${ITEM2}`))[0]?.amount)
  check('[9b] Xoá 1 dòng rồi chép lại → chỉ ĐẮP đúng dòng còn thiếu (lấy số tháng trước)',
    r.s === 200 && num(r.j?.data?.copied) >= 1 && dap2 === 222, `chép=${r.j?.data?.copied} · số đắp=${dap2} (tháng trước 222)`)

  // ── UPLOAD: kiểm-trước không ghi · trùng khoá trong file thì CỘNG DỒN ──
  const truoc = (await restAll('warehouse_costs', `select=id&period=eq.${PER_D}&warehouse_id=eq.${WH.id}`)).length
  const pre = await upload('/wms/warehouse-costs/upload?preflight=1',
    xbuf([['Tháng', 'Kho', 'Khoản mục', 'Số tiền'], [PER, `${T}W`, ITEM1, 1], [PER, `${T}W`, ITEM1, 2]]), { period: PER })
  const sauPre = await restAll('warehouse_costs', `select=id,amount&period=eq.${PER_D}&warehouse_id=eq.${WH.id}`)
  const giuNguyen = num(sauPre.find(x => true) && (await restAll('warehouse_costs', `select=amount&period=eq.${PER_D}&warehouse_id=eq.${WH.id}&cost_item=eq.${ITEM1}`))[0]?.amount)
  check('[10] Kiểm-trước upload chi phí: xem trước rồi mà DB chưa đổi gì',
    pre.s === 200 && pre.j?.data?.preflight === true && sauPre.length === truoc && giuNguyen === 50_000_000,
    `s=${pre.s} · số dòng trước=${truoc} sau=${sauPre.length} · số tiền vẫn=${giuNguyen}`)

  const up = await upload('/wms/warehouse-costs/upload',
    xbuf([['Tháng', 'Kho', 'Khoản mục', 'Số tiền'], [PER, `${T}W`, ITEM1, 1_000_000], [PER, `${T}W`, ITEM1, 2_500_000]]), { period: PER })
  const cong = num((await restAll('warehouse_costs', `select=amount&period=eq.${PER_D}&warehouse_id=eq.${WH.id}&cost_item=eq.${ITEM1}`))[0]?.amount)
  check('[11] Upload có 2 dòng TRÙNG khoá trong file → cộng dồn thành 1 dòng (1tr + 2,5tr = 3,5tr)',
    up.s === 200 && cong === 3_500_000, `s=${up.s} · DB=${cong}`)

  // Ô GỘP ở cột Kho — cửa Chi phí kho CÓ trải ô gộp (đối chứng dương cho phép kiểm [66])
  const rowsM = [['Tháng', 'Kho', 'Khoản mục', 'Số tiền'], [PER, `${T}W`, ITEM1, 4_000_000], [PER, `${T}W`, ITEM2, 6_000_000]]
  const merges = mergeDown(rowsM, 1, 1, 2)
  const upM = await upload('/wms/warehouse-costs/upload', xbuf(rowsM, merges), { period: PER })
  const m1 = num((await restAll('warehouse_costs', `select=amount&period=eq.${PER_D}&warehouse_id=eq.${WH.id}&cost_item=eq.${ITEM1}`))[0]?.amount)
  const m2 = num((await restAll('warehouse_costs', `select=amount&period=eq.${PER_D}&warehouse_id=eq.${WH.id}&cost_item=eq.${ITEM2}`))[0]?.amount)
  check('[12] File có Ô GỘP cột "Kho" → dòng dưới vẫn nhận đúng kho, không bị bỏ',
    upM.s === 200 && m1 === 4_000_000 && m2 === 6_000_000,
    `s=${upM.s} · dòng gộp 1=${m1} (cần 4tr) · dòng gộp 2=${m2} (cần 6tr) · lỗi=${JSON.stringify(upM.j?.data?.errors ?? []).slice(0, 90)}`)

  r = await api(`/wms/warehouse-costs/items/${ITEM1}`, 'DELETE')
  const conItem = (await restAll('LookupValue', `select=id&type=eq.cost_item&value=eq.${ITEM1}`)).length
  check('[13] Xoá khoản mục ĐANG có dòng chi phí → chặn (không làm mất tên của số đã khai)',
    r.s === 409 && conItem === 1, `s=${r.s} ${err(r)}`)
}

// ══════════════════════════════════════════════════════════════════════════════
// B. SLOTTING — kế hoạch sắp xếp kho + quét thực hiện
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── B. Tối ưu vị trí (Slotting) ──')
let PLAN = null
{
  const P1 = `${T}_SLOT_1`, P2 = `${T}_SLOT_2`, POUT = `${T}_SLOT_NGOAI`
  const e1 = await mkEntry(P1, LOC_A.id), e2 = await mkEntry(P2, LOC_A.id)
  await mkEntry(POUT, LOC_A.id)
  await mkEntry(`${T}_CHAN_DAY`, LOC_F.id)     // làm ĐẦY vị trí sức chứa 1

  let r = await api('/wms/slotting/plans', 'POST', {
    warehouse_id: FIX.WH_QR.id, name: `${T} ke hoach`, level: 'NORMAL', principle: 'FEFO',
    lines: [
      { material_id: MAT.id, material_code: MAT.material_code, entry_ids: [e1.id, e2.id],
        from_location_id: LOC_A.id, from_location_code: LOC_A.location_code,
        to_location_id: LOC_B.id, to_location_code: LOC_B.location_code },
      { material_id: MAT.id, material_code: MAT.material_code, entry_ids: [(await mkEntry(`${T}_SLOT_3`, LOC_A.id)).id],
        from_location_id: LOC_A.id, from_location_code: LOC_A.location_code,
        to_location_id: LOC_F.id, to_location_code: LOC_F.location_code },
    ],
  })
  PLAN = r.j?.data?.id
  check('[14] Tạo kế hoạch sắp xếp 2 dòng chuyển', r.s === 200 && !!PLAN && num(r.j?.data?.n_lines) === 2, `s=${r.s} n_lines=${r.j?.data?.n_lines}`)

  r = await api(`/wms/slotting/plans?warehouse_id=${FIX.WH_QR.id}`, 'GET')
  const p = (r.j?.data ?? []).find(x => x.id === PLAN)
  check('[15] Kế hoạch hiện trong danh sách với tiến độ 0/3 pallet',
    r.s === 200 && p?.status === 'ACTIVE' && num(p?.progress?.done_pallets) === 0 && num(p?.progress?.total_pallets) === 3,
    `s=${r.s} · ${p?.progress?.done_pallets}/${p?.progress?.total_pallets} pallet`)

  r = await api('/wms/slotting/plans/preview', 'POST', { warehouse_id: FIX.WH_QR.id, categories: [MAT.category ?? 'FG01'], days: 30, max_moves: 5 })
  check('[16] Xem trước kế hoạch chạy được (không lỗi máy chủ)', r.s === 200 || r.s === 422 || r.s === 503, `s=${r.s} ${err(r)}`)
  if (r.s >= 500) server500.push(`/wms/slotting/plans/preview → ${r.s}`)

  r = await api(`/wms/slotting/plans/${PLAN}/scan-move`, 'POST', { qr: P1 })
  const loc1 = (await restAll('InventoryEntry', `select=location_id&id=eq.${e1.id}`))[0]?.location_id
  check('[17] Quét thực hiện: pallet chuyển sang đúng vị trí đích và tiến độ tăng lên 1/2',
    r.s === 200 && loc1 === LOC_B.id && num(r.j?.data?.done) === 1 && num(r.j?.data?.total) === 2,
    `s=${r.s} · pallet ở ${loc1 === LOC_B.id ? 'ĐÍCH' : loc1} · ${r.j?.data?.done}/${r.j?.data?.total}`)

  const pl = await api(`/wms/slotting/plans?warehouse_id=${FIX.WH_QR.id}`, 'GET')
  const p2 = (pl.j?.data ?? []).find(x => x.id === PLAN)
  check('[18] Tiến độ trên danh sách kế hoạch tự tăng theo (1/3 pallet)',
    num(p2?.progress?.done_pallets) === 1 && num(p2?.progress?.total_pallets) === 3,
    `${p2?.progress?.done_pallets}/${p2?.progress?.total_pallets}`)

  r = await api(`/wms/slotting/plans/${PLAN}/scan-move`, 'POST', { qr: POUT })
  check('[19] Quét pallet KHÔNG nằm trong kế hoạch → chặn', r.s === 404 && r.j?.error?.code === 'NOT_IN_PLAN', `s=${r.s} ${err(r)}`)

  r = await api(`/wms/slotting/plans/${PLAN}/scan-move`, 'POST', { qr: P1 })
  check('[20] Quét lại pallet đã ở đích → chặn (không chuyển 2 lần)', r.s === 409 && r.j?.error?.code === 'ALREADY_DONE', `s=${r.s} ${err(r)}`)

  const e3 = (await restAll('InventoryEntry', `select=id,location_id&pallet_code=eq.${T}_SLOT_3`))[0]
  r = await api(`/wms/slotting/plans/${PLAN}/scan-move`, 'POST', { qr: `${T}_SLOT_3` })
  const loc3 = (await restAll('InventoryEntry', `select=location_id&id=eq.${e3.id}`))[0]?.location_id
  check('[21] Vị trí đích ĐÃ ĐẦY → chặn có hướng dẫn, pallet vẫn nằm ở chỗ cũ',
    r.s === 400 && r.j?.error?.code === 'LOCATION_FULL' && loc3 === LOC_A.id,
    `s=${r.s} ${err(r)} · pallet còn ở nguồn=${loc3 === LOC_A.id}`)

  r = await api(`/wms/slotting/plans/${PLAN}`, 'PATCH', { status: 'KHONG_CO_THAT' })
  check('[22] Đổi kế hoạch sang trạng thái lạ → 400', r.s === 400, `s=${r.s} ${err(r)}`)

  r = await api(`/wms/slotting/plans/${PLAN}`, 'PATCH', { status: 'COMPLETED' })
  const sm = await api(`/wms/slotting/plans/${PLAN}/scan-move`, 'POST', { qr: P2 })
  check('[23] Kế hoạch đã Hoàn thành → không quét thực hiện được nữa',
    r.s === 200 && sm.s === 409 && sm.j?.error?.code === 'PLAN_NOT_ACTIVE', `hoàn thành=${r.s} · quét=${sm.s} ${err(sm)}`)
  await api(`/wms/slotting/plans/${PLAN}`, 'PATCH', { status: 'ACTIVE' })

  // Cấu hình khu: đổi hạng nhặt rồi TRẢ LẠI giá trị cũ (đọc lại giá trị cũ ngay trước khi đụng)
  {
    const cu = (await restAll('WarehouseZone', `select=pick_rank&id=eq.${ZONE.id}`))[0]?.pick_rank ?? null
    const z = await api(`/wms/slotting/zone-config/${ZONE.id}`, 'PATCH', { pick_rank: 7 })
    const dbZ = (await restAll('WarehouseZone', `select=pick_rank&id=eq.${ZONE.id}`))[0]?.pick_rank
    const bad = await api(`/wms/slotting/zone-config/${ZONE.id}`, 'PATCH', { pick_rank: 5000 })
    await api(`/wms/slotting/zone-config/${ZONE.id}`, 'PATCH', { pick_rank: cu })
    const traLai = (await restAll('WarehouseZone', `select=pick_rank&id=eq.${ZONE.id}`))[0]?.pick_rank ?? null
    check('[24] Đổi hạng nhặt của khu → lưu; số ngoài 1–999 bị chặn; trả lại giá trị cũ được',
      z.s === 200 && num(dbZ) === 7 && bad.s === 400 && String(traLai) === String(cu),
      `đặt=7→DB=${dbZ} · số lạ=${bad.s} · trả lại=${traLai} (cũ ${cu})`)
  }

  const dl = await api(`/wms/slotting/plans/${PLAN}`, 'DELETE')
  const conLine = (await restAll('SlottingPlanLine', `select=id&plan_id=eq.${PLAN}`)).length
  check('[25] Xoá kế hoạch → các dòng chuyển của nó biến mất theo (không mồ côi)',
    dl.s === 200 && conLine === 0, `s=${dl.s} · dòng còn lại=${conLine}`)
  PLAN = null
}

// ══════════════════════════════════════════════════════════════════════════════
// C. FILL — huỷ lệnh + danh sách nhân sự để giao lệnh
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── C. Fill hàng (nhặt lẻ) ──')
{
  const oid = randomUUID(), t1 = randomUUID(), t2 = randomUUID()
  await restWrite('FillOrder', 'POST', null, {
    id: oid, order_code: `${T}F01`, warehouse_id: FIX.WH_QR.id, target_date: TODAY, status: 'PENDING',
    created_at: now(), updated_at: now(),
  })
  const mkTask = (id, status, done) => ({
    id, fill_order_id: oid, warehouse_id: FIX.WH_QR.id, target_date: TODAY, material_id: MAT.id,
    to_location_id: LOC_P?.id ?? LOC_B.id, qty_base: UPC * 3, status, required_pallets: 1,
    qty_done_base: done, created_at: now(), updated_at: now(),
  })
  // PostgREST đòi MỌI object trong lô có CÙNG bộ khoá — thiếu 1 field ở 1 dòng là 400 PGRST102
  await restWrite('FillTask', 'POST', null, [mkTask(t1, 'PENDING', 0), mkTask(t2, 'DONE', UPC * 3)])

  let r = await api(`/wms/fill/orders/${randomUUID()}`, 'DELETE', { reason: `${T}` })
  check('[26] Huỷ lệnh fill không có thật → 404 (không im lặng báo thành công)', r.s === 404, `s=${r.s} ${err(r)}`)

  r = await api(`/wms/fill/orders/${oid}`, 'DELETE', { reason: `${T} huy` })
  const s1 = (await restAll('FillTask', `select=status,cancel_reason&id=eq.${t1}`))[0]
  const s2 = (await restAll('FillTask', `select=status&id=eq.${t2}`))[0]
  check('[27] Huỷ cả lệnh fill → chỉ dòng CHƯA làm bị huỷ, dòng ĐÃ XONG giữ nguyên',
    r.s === 200 && num(r.j?.data?.cancelled) === 1 && s1?.status === 'CANCELLED' && s2?.status === 'DONE',
    `s=${r.s} huỷ=${r.j?.data?.cancelled} · dòng chờ=${s1?.status} · dòng xong=${s2?.status}`)

  r = await api(`/wms/fill/orders/${oid}`, 'DELETE', {})
  check('[28] Huỷ lại lệnh đã đóng → chặn 409', r.s === 409, `s=${r.s} ${err(r)}`)
  await restWrite('FillTask', 'DELETE', `fill_order_id=eq.${oid}`).catch(() => {})
  await restWrite('FillOrder', 'DELETE', `id=eq.${oid}`).catch(() => {})
}

// ══════════════════════════════════════════════════════════════════════════════
// D. XE NÂNG
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── D. Xe nâng ──')
let FKID = null, LOGID = null, ITEM_SHARED = null
{
  const PNG1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  let r = await api('/wms/forklifts', 'POST', { code: `${T}X1`, name: `${T} xe thu`, warehouse_id: WH.id })
  FKID = r.j?.data?.id
  check('[29] Thêm xe nâng mới vào danh mục', (r.s === 200 || r.s === 201) && !!FKID, `s=${r.s} ${err(r)}`)

  r = await api('/wms/forklifts', 'POST', { code: `${T}x1`, name: 'trùng', warehouse_id: WH.id })
  check('[30] Thêm trùng mã xe (khác hoa/thường) → chặn', r.s === 409, `s=${r.s} ${err(r)}`)

  r = await api('/wms/forklift-logs', 'POST', { forklift_id: FKID, log_date: dayShift(-2), status: 'ACTIVE', hour_meter: 1000 })
  check('[31] Xe HOẠT ĐỘNG mà không chụp ảnh → không cho lưu check list', r.s === 422, `s=${r.s} ${err(r)}`)

  r = await api('/wms/forklift-logs', 'POST', {
    forklift_id: FKID, log_date: dayShift(-2), status: 'ACTIVE', hour_meter: 1000, photo_data: PNG1x1,
    checklist: [{ label: `${T} phanh`, ok: true }, { label: `${T} còi`, ok: false, note: 'hỏng' }],
  })
  LOGID = r.j?.data?.id
  const lg = (await restAll('forklift_daily_logs', `select=hour_meter,issue_count,photo_path&id=eq.${LOGID ?? '00000000-0000-0000-0000-000000000000'}`))[0]
  check('[32] Xe HOẠT ĐỘNG có ảnh → lưu được, đếm đúng 1 hạng mục lỗi',
    (r.s === 200 || r.s === 201) && num(lg?.hour_meter) === 1000 && num(lg?.issue_count) === 1 && !!lg?.photo_path,
    `s=${r.s} · đồng hồ=${lg?.hour_meter} lỗi=${lg?.issue_count} ảnh=${!!lg?.photo_path}`)

  r = await api('/wms/forklift-logs', 'POST', { forklift_id: FKID, log_date: dayShift(-1), status: 'ACTIVE', hour_meter: 900, photo_data: PNG1x1 })
  check('[33] Số đồng hồ NHỎ HƠN lần ghi trước → chặn (đồng hồ chỉ tăng)', r.s === 422, `s=${r.s} ${err(r)}`)

  r = await api('/wms/forklift-logs', 'POST', { forklift_id: FKID, log_date: dayShift(-1), status: 'ACTIVE', hour_meter: 9999, photo_data: PNG1x1 })
  check('[34] Số đồng hồ tăng vượt 24h/ngày → chặn (gõ thừa số 0)', r.s === 422, `s=${r.s} ${err(r)}`)

  r = await api('/wms/forklift-logs', 'POST', { forklift_id: FKID, log_date: dayShift(-1), status: 'IDLE' })
  const lg2 = (await restAll('forklift_daily_logs', `select=id,status,hour_meter&forklift_id=eq.${FKID}&log_date=eq.${dayShift(-1)}`))[0]
  check('[35] Xe NGHỈ → không đòi ảnh, không đòi số đồng hồ',
    (r.s === 200 || r.s === 201) && lg2?.status === 'IDLE' && lg2?.hour_meter === null, `s=${r.s} ${err(r)}`)

  r = await api('/wms/forklift-logs', 'POST', { forklift_id: FKID, log_date: dayShift(1), status: 'IDLE' })
  check('[36] Ghi check list cho ngày TƯƠNG LAI → chặn', r.s === 400, `s=${r.s} ${err(r)}`)

  r = await api(`/wms/forklifts/${FKID}`, 'DELETE')
  check('[37] Xoá xe ĐÃ CÓ check list → chặn, hướng dẫn chuyển "Ngừng dùng"', r.s === 409, `s=${r.s} ${err(r)}`)

  r = await api('/wms/forklift-items', 'POST', { label: `${T} hang muc chung`, sort_order: 999 })
  ITEM_SHARED = r.j?.data?.id
  check('[38] Thêm hạng mục check list DÙNG CHUNG mọi kho', (r.s === 200 || r.s === 201) && !!ITEM_SHARED, `s=${r.s} ${err(r)}`)
}

// ══════════════════════════════════════════════════════════════════════════════
// E. PHIẾU CÂN
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── E. Phiếu cân ──')
let KEYID = null, TICKET = null
const GDO_A = randomUUID(), GDO_B = randomUUID()
{
  // 2 chuyến của kho tự dựng (bật CẢ 2 rule cổng + cân) — dùng chung cho khối F
  for (const [id, sfx] of [[GDO_A, 'A'], [GDO_B, 'B']]) {
    await restWrite('GroupDeliveryOrder', 'POST', null, {
      id, group_code: `${T}_GDO_${sfx}`, planned_date: TODAY, delivery_date: TODAY, warehouse_id: WH.id,
      warehouse_type: 'CENTRAL', status: 'PENDING', dvvt: FIX.DVVT_TAG, license_plate: `${T}XE${sfx}`,
      created_at: now(), updated_at: now(),
    })
    GDOS.push(id)
  }

  // Nạp phiếu cân qua CỔNG TÍCH HỢP với MÃ TRẠM RIÊNG (không dùng mã trạm thật)
  let kr = await api('/wms/integration-keys', 'POST', { name: `${T} key`, scopes: ['weigh:write'] })
  KEYID = kr.j?.data?.id
  const RAWKEY = kr.j?.data?.key
  if (RAWKEY) {
    const ing = await fetch(`${BASE}/api/integration/v1/weigh/tickets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': RAWKEY },
      body: JSON.stringify({
        station_code: T, warehouse_id: WH.id,
        tickets: [{ id: 520001, OrderNum: `${T}-PC1`, GDate: `${TODAY.slice(8, 10)}/${TODAY.slice(5, 7)}/${TODAY.slice(0, 4)}`,
          TruckNum: `${T}XEC`, GrossWeight: 20000, TareWeight: 12000, NetWeight: 8000, ImExType: 'Cân Xuất' }],
      }),
    })
    const ij = await ing.json().catch(() => null)
    TICKET = (await restAll('WeighTicket', `select=id,license_plate_norm&station_code=eq.${T}&source_id=eq.520001`))[0]
    check('[39] Nạp phiếu cân qua cổng tích hợp bằng mã trạm riêng → phiếu vào hệ thống',
      ing.status === 200 && num(ij?.data?.upserted) === 1 && !!TICKET?.id,
      `s=${ing.status} ghi=${ij?.data?.upserted} · biển chuẩn hoá=${TICKET?.license_plate_norm}`)
  } else {
    check('[39] Nạp phiếu cân qua cổng tích hợp bằng mã trạm riêng', false,
      `không tạo được API key: s=${kr.s} ${err(kr)}`)
  }

  if (TICKET?.id) {
    let r = await api('/wms/weigh-tickets/warehouses', 'GET')
    const list = r.j?.data ?? []
    check('[40] Danh sách "kho có phiếu cân" chứa kho vừa nạp phiếu',
      r.s === 200 && list.some(w => w.id === WH.id), `s=${r.s} · ${list.length} kho`)

    r = await api(`/wms/weigh-tickets/${TICKET.id}/match`, 'PATCH', { gdo_id: GDO_A })
    let tk = (await restAll('WeighTicket', `select=gdo_id,matched_by,matched_at&id=eq.${TICKET.id}`))[0]
    check('[41] Gắn phiếu cân vào chuyến → lưu chuyến + ghi vết ai gắn, lúc nào',
      r.s === 200 && tk?.gdo_id === GDO_A && !!tk?.matched_by && !!tk?.matched_at,
      `s=${r.s} · chuyến=${tk?.gdo_id === GDO_A} người gắn=${tk?.matched_by}`)

    r = await api(`/wms/weigh-tickets/${TICKET.id}/match`, 'PATCH', { gdo_id: GDO_B })
    tk = (await restAll('WeighTicket', `select=gdo_id&id=eq.${TICKET.id}`))[0]
    check('[42] Phiếu đang gắn chuyến khác mà gắn thẳng chuyến mới → chặn, không cướp âm thầm',
      r.s === 409 && tk?.gdo_id === GDO_A, `s=${r.s} ${err(r)} · vẫn gắn chuyến cũ=${tk?.gdo_id === GDO_A}`)

    const off = await api(`/wms/weigh-tickets/${TICKET.id}/match`, 'PATCH', { gdo_id: null })
    const on = await api(`/wms/weigh-tickets/${TICKET.id}/match`, 'PATCH', { gdo_id: GDO_B })
    tk = (await restAll('WeighTicket', `select=gdo_id&id=eq.${TICKET.id}`))[0]
    check('[43] Gỡ khỏi chuyến cũ rồi gắn chuyến mới → được',
      off.s === 200 && on.s === 200 && tk?.gdo_id === GDO_B, `gỡ=${off.s} gắn=${on.s} · chuyến=${tk?.gdo_id === GDO_B}`)

    r = await api(`/wms/weigh-tickets/${randomUUID()}/match`, 'PATCH', { gdo_id: null })
    check('[44] Gắn/gỡ phiếu cân không có thật → 404 sạch (không lỗi máy chủ)', r.s === 404, `s=${r.s} ${err(r)}`)
    if (r.s >= 500) server500.push(`PATCH /wms/weigh-tickets/:id/match → ${r.s}`)

    await api(`/wms/weigh-tickets/${TICKET.id}/match`, 'PATCH', { gdo_id: null })
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// F. XUẤT KHO — các cửa còn hở
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── F. Xuất kho: gỡ giao đơn · duyệt bỏ qua cân/cổng · mã thùng ──')
{
  let r = await api(`/wms/outbound/${GDO_A}/assign`, 'POST', {})
  const un = await api(`/wms/outbound/${GDO_A}/unassign`, 'POST', {})
  const g = (await restAll('GroupDeliveryOrder', `select=status,assigned_at&id=eq.${GDO_A}`))[0]
  check('[45] Giao đơn rồi gỡ giao đơn → chuyến về trạng thái Chờ, xoá dấu người nhận',
    r.s === 200 && un.s === 200 && g?.status === 'PENDING' && g?.assigned_at === null,
    `giao=${r.s} gỡ=${un.s} · ${g?.status} assigned=${g?.assigned_at}`)

  r = await api(`/wms/outbound/${GDO_A}/unassign`, 'POST', {})
  check('[46] Gỡ giao đơn khi chuyến CHƯA giao ai → 400 nói rõ', r.s === 400, `s=${r.s} ${err(r)}`)

  r = await api(`/wms/outbound/${randomUUID()}/unassign`, 'POST', {})
  check('[47] Gỡ giao đơn chuyến KHÔNG TỒN TẠI → phải 404 "không tìm thấy chuyến"',
    r.s === 404, `s=${r.s} ${err(r)}`)
  if (r.s >= 500) server500.push(`POST /wms/outbound/:id/unassign (id lạ) → ${r.s}`)

  // 2 rule ĐỘC LẬP: duyệt bỏ qua CÂN không được thoát rule CỔNG
  r = await api(`/wms/outbound/${GDO_A}/weigh-waive`, 'POST', { reason: `${T} ly do bo qua can` })
  const w = (await restAll('GroupDeliveryOrder',
    `select=weigh_waived_at,weigh_waived_by,weigh_waive_reason,gate_waived_at&id=eq.${GDO_A}`))[0]
  check('[48] Duyệt bỏ qua CÂN → ghi vết ai duyệt + lý do, và KHÔNG tự động bỏ qua cổng',
    r.s === 200 && !!w?.weigh_waived_at && !!w?.weigh_waived_by && w?.weigh_waive_reason?.includes(T) && w?.gate_waived_at === null,
    `s=${r.s} · người duyệt=${w?.weigh_waived_by} · lý do=${(w?.weigh_waive_reason ?? '').slice(0, 24)} · cổng vẫn chưa duyệt=${w?.gate_waived_at === null}`)

  r = await api(`/wms/outbound/${GDO_A}/start`, 'POST', { license_plate: `${T}XEA` })
  check('[49] Đã duyệt bỏ qua CÂN nhưng chưa đăng ký cổng → Bắt đầu vẫn bị chặn vì rule CỔNG',
    r.s === 422 && r.j?.error?.code === 'GATE_REQUIRED', `s=${r.s} ${err(r)}`)

  r = await api(`/wms/outbound/${GDO_A}/weigh-waive`, 'DELETE')
  const w2 = (await restAll('GroupDeliveryOrder', `select=weigh_waived_at,weigh_waived_by,weigh_waive_reason&id=eq.${GDO_A}`))[0]
  check('[50] Huỷ duyệt bỏ qua cân → 3 dấu vết xoá sạch',
    r.s === 200 && w2?.weigh_waived_at === null && w2?.weigh_waived_by === null && w2?.weigh_waive_reason === null, `s=${r.s}`)

  const gw = await api(`/wms/outbound/${GDO_A}/gate-waive`, 'POST', { reason: `${T} giao le` })
  r = await api(`/wms/outbound/${GDO_A}/gate-waive`, 'DELETE')
  const w3 = (await restAll('GroupDeliveryOrder', `select=gate_waived_at,gate_waived_by,gate_waive_reason&id=eq.${GDO_A}`))[0]
  check('[51] Duyệt rồi huỷ duyệt bỏ qua CỔNG → dấu vết xoá sạch',
    gw.s === 200 && r.s === 200 && w3?.gate_waived_at === null && w3?.gate_waive_reason === null, `duyệt=${gw.s} huỷ=${r.s}`)

  r = await api(`/wms/outbound/${randomUUID()}/weigh-waive`, 'POST', { reason: 'x' })
  check('[52] Duyệt bỏ qua cân cho chuyến không có thật → 404 sạch (không lỗi máy chủ)', r.s === 404, `s=${r.s} ${err(r)}`)
  if (r.s >= 500) server500.push(`POST /wms/outbound/:gdoId/weigh-waive (id lạ) → ${r.s}`)

  // Lưu mã thùng vào 1 dòng quét
  const doId = randomUUID(), itId = randomUUID(), scId = randomUUID()
  await restWrite('OutboundDelivery', 'POST', null, { id: doId, gdo_id: GDO_A, delivery_code: `${T}-DO`, status: 'PENDING', created_at: now(), updated_at: now() })
  await restWrite('OutboundItem', 'POST', null, { id: itId, do_id: doId, material_id: MAT.id, cartons_ordered: UPC * 5, cartons_scanned: UPC, status: 'PENDING', created_at: now(), updated_at: now() })
  await restWrite('OutboundScanEntry', 'POST', null, {
    id: scId, item_id: itId, pallet_code: `${T}_QUET_1`, cartons_scanned: UPC, scanned_at: now(), created_at: now(), updated_at: now(),
  })
  // Quét đúp cùng 1 tem (rất hay xảy ra khi công nhân bắn lại) + tem có khoảng trắng thừa hai đầu
  // (súng PDA hay kèm) phải gộp về 1; ô rỗng phải bỏ. Chữ HOA/thường KHÔNG gộp — tem lưu nguyên văn.
  r = await api(`/wms/outbound/scan-entries/${scId}/cartons`, 'PATCH', {
    cartons: [{ code: `${T}TH1` }, { code: `${T}TH2` }, { code: `${T}TH1` }, { code: `  ${T}TH2  ` }, { code: '' }],
  })
  const sc = (await restAll('OutboundScanEntry', `select=carton_scans&id=eq.${scId}`))[0]
  const n = (sc?.carton_scans ?? []).length
  check('[53] Lưu mã tem thùng: quét đúp và tem thừa khoảng trắng gộp về 1, ô rỗng bị bỏ',
    r.s === 200 && num(r.j?.data?.carton_count) === 2 && n === 2, `s=${r.s} · app đếm=${r.j?.data?.carton_count} DB=${n} (gửi 5 mã, 2 mã thật)`)

  r = await api(`/wms/outbound/scan-entries/${scId}/cartons`, 'PATCH', { cartons: [] })
  const sc2 = (await restAll('OutboundScanEntry', `select=carton_scans&id=eq.${scId}`))[0]
  check('[54] Gửi danh sách mã thùng RỖNG → xoá sạch mã đã lưu', r.s === 200 && (sc2?.carton_scans ?? []).length === 0, `s=${r.s}`)

  r = await api(`/wms/outbound/scan-entries/${randomUUID()}/cartons`, 'PATCH', { cartons: [{ code: 'X' }] })
  check('[55] Lưu mã thùng vào dòng quét không có thật → 404 sạch', r.s === 404, `s=${r.s} ${err(r)}`)
  if (r.s >= 500) server500.push(`PATCH /wms/outbound/scan-entries/:scanId/cartons (id lạ) → ${r.s}`)
}

// ══════════════════════════════════════════════════════════════════════════════
// G. ĐỐI CHIẾU SAP — việc "cần xử lý"
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── G. Đối chiếu SAP ──')
{
  const before = num((await api('/wms/outbound/reconcile-tasks/count', 'GET')).j?.data?.open)
  const dbBefore = (await restAll('reconcile_tasks', 'select=id&status=eq.OPEN')).length
  const tKeep = randomUUID(), tApply = randomUUID(), tMat = randomUUID()
  const mk = (id, over) => ({
    id, od_number: `${T}DO`, od_item: '10', group_code: `${T}_GDO_A`, material_code: MAT.material_code,
    change_type: 'QTY_DECREASE', zone: 'Z2', action: 'NEEDS_REVIEW', status: 'OPEN',
    old_ordered: 100, new_ordered: 60, scanned: 0, detail: `${T}`, created_at: now(), updated_at: now(), ...over,
  })
  await restWrite('reconcile_tasks', 'POST', null, [
    mk(tKeep), mk(tApply, { scanned: 80 }), mk(tMat, { change_type: 'MATERIAL_CHANGED' }),
  ])
  const after = num((await api('/wms/outbound/reconcile-tasks/count', 'GET')).j?.data?.open)
  check('[56] Thêm 3 việc cần xử lý → ô đếm trên nút tăng đúng 3',
    after - before === 3, `trước=${before} sau=${after} (DB trước=${dbBefore})`)

  let r = await api(`/wms/outbound/reconcile-tasks/${tKeep}/resolve`, 'POST', { resolution: 'khong_co_that' })
  check('[57] Cách xử lý không có trong danh sách → 400', r.s === 400, `s=${r.s} ${err(r)}`)

  r = await api(`/wms/outbound/reconcile-tasks/${tKeep}/resolve`, 'POST', { resolution: 'keep' })
  const k = (await restAll('reconcile_tasks', `select=status,resolution,resolved_by,resolved_at&id=eq.${tKeep}`))[0]
  check('[58] Chọn "giữ nguyên" → việc đóng lại kèm vết ai xử lý',
    r.s === 200 && k?.status === 'RESOLVED' && k?.resolution === 'keep' && !!k?.resolved_by && !!k?.resolved_at,
    `s=${r.s} · ${k?.status}/${k?.resolution} bởi ${k?.resolved_by}`)

  r = await api(`/wms/outbound/reconcile-tasks/${tKeep}/resolve`, 'POST', { resolution: 'keep' })
  check('[59] Xử lý lại việc ĐÃ xử lý → chặn 409 (2 người bấm cùng lúc không ghi đè nhau)', r.s === 409, `s=${r.s} ${err(r)}`)

  r = await api(`/wms/outbound/reconcile-tasks/${tApply}/resolve`, 'POST', { resolution: 'apply' })
  const a = (await restAll('reconcile_tasks', `select=status&id=eq.${tApply}`))[0]
  check('[60] Áp số SAP khi SỐ MỚI (60) NHỎ HƠN số đã quét (80) → chặn, nhắc trả hàng',
    r.s === 422 && a?.status === 'OPEN', `s=${r.s} ${err(r)} · việc vẫn mở=${a?.status === 'OPEN'}`)

  r = await api(`/wms/outbound/reconcile-tasks/${tMat}/resolve`, 'POST', { resolution: 'apply' })
  check('[61] Áp số SAP khi ĐỔI MÃ HÀNG → chặn, bắt xử tay ở Xuất kho', r.s === 422, `s=${r.s} ${err(r)}`)

  r = await api(`/wms/outbound/reconcile-tasks/${randomUUID()}/resolve`, 'POST', { resolution: 'keep' })
  check('[62] Xử lý việc không có thật → 404 sạch', r.s === 404, `s=${r.s} ${err(r)}`)
  if (r.s >= 500) server500.push(`POST /wms/outbound/reconcile-tasks/:id/resolve (id lạ) → ${r.s}`)
  await restWrite('reconcile_tasks', 'DELETE', `od_number=eq.${T}DO`).catch(() => {})
}

// ══════════════════════════════════════════════════════════════════════════════
// H. LỊCH SỬ QUÉT
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── H. Lịch sử quét ──')
{
  let r = await api('/wms/outbound/scan-log/facets', 'GET')
  const f = r.j?.data
  check('[63] Ô lọc Máy / Chu kỳ của Lịch sử quét trả về danh sách',
    r.s === 200 && Array.isArray(f?.machines) && Array.isArray(f?.cycles), `s=${r.s} · máy=${f?.machines?.length} chu kỳ=${f?.cycles?.length}`)

  // Tìm theo tem pallet của một lượt quét CÓ THẬT trong DB (chỉ đọc)
  const [sample] = await restAll('OutboundScanEntry', 'select=id,pallet_code&pallet_code=not.is.null&order=scanned_at.desc&limit=1')
  if (sample?.pallet_code) {
    r = await api(`/wms/outbound/scan-log/search?q=${encodeURIComponent(sample.pallet_code)}&limit=50`, 'GET')
    const hit = (r.j?.data?.rows ?? []).some(x => x.pallet_code === sample.pallet_code)
    check('[64] Tìm theo TEM PALLET → ra đúng lượt quét mang tem đó',
      r.s === 200 && hit, `s=${r.s} · ${r.j?.data?.rows?.length ?? 0} dòng · khớp=${hit}`)

    // Biển số của một chuyến ĐÃ TỪNG QUÉT (lấy ngược từ dòng quét mẫu) → tìm phải ra lại nó
    const [scRow] = await restAll('OutboundScanEntry', `select=item_id&id=eq.${sample.id}`)
    const [itRow] = scRow ? await restAll('OutboundItem', `select=do_id&id=eq.${scRow.item_id}`) : []
    const [doRow] = itRow ? await restAll('OutboundDelivery', `select=gdo_id&id=eq.${itRow.do_id}`) : []
    const [gRow] = doRow ? await restAll('GroupDeliveryOrder', `select=license_plate&id=eq.${doRow.gdo_id}`) : []
    if (gRow?.license_plate) {
      const rp = await api(`/wms/outbound/scan-log/search?q=${encodeURIComponent(gRow.license_plate)}&limit=200`, 'GET')
      const hitP = (rp.j?.data?.rows ?? []).some(x => String(x.license_plate ?? '').toUpperCase() === String(gRow.license_plate).toUpperCase())
      check('[65] Tìm theo BIỂN SỐ XE → ra đúng lượt quét của xe đó',
        rp.s === 200 && hitP, `s=${rp.s} · ${rp.j?.data?.rows?.length ?? 0} dòng cho biển ${gRow.license_plate} · khớp=${hitP}`)
    } else check('[65] Tìm theo BIỂN SỐ XE', true, 'lượt quét mẫu không gắn biển số — bỏ qua')

    const [matSample] = await restAll('OutboundScanEntry', 'select=pallet_code&pallet_code=not.is.null&order=scanned_at.desc&limit=1')
    const rm = await api(`/wms/outbound/scan-log/search?q=${encodeURIComponent(MAT.material_code)}&limit=200`, 'GET')
    const rows = rm.j?.data?.rows ?? []
    const sai = rows.filter(x => ![x.material_code, x.material_code_raw, x.pallet_code, x.delivery_code, x.distributor_name, x.group_code, x.license_plate, x.container_number, x.location_code, x.material_name, x.scanner_name, x.warehouse_name]
      .some(v => String(v ?? '').toUpperCase().includes(MAT.material_code.toUpperCase())))
    check('[66] Tìm theo MÃ HÀNG → mọi dòng trả về đều thật sự chứa từ khoá đó',
      rm.s === 200 && sai.length === 0, `s=${rm.s} · ${rows.length} dòng · lệch=${sai.length} (mẫu ${matSample?.pallet_code ?? '—'})`)
  } else check('[64] Tìm theo TEM PALLET', true, 'staging chưa có lượt quét nào — bỏ qua')

  r = await api('/wms/outbound/scan-log/search?q=A', 'GET')
  check('[67] Gõ 1 ký tự vào ô tìm → không làm nổ lỗi máy chủ', r.s === 200, `s=${r.s} ${err(r)}`)
  if (r.s >= 500) server500.push(`GET /wms/outbound/scan-log/search?q=A → ${r.s}`)
}

// ══════════════════════════════════════════════════════════════════════════════
// I. SỬA NHÓM PHIẾU NCC (PATCH /wms/inbound-orders/:id)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── I. Sửa nhóm phiếu NCC ──')
{
  const r0 = await api('/wms/inbound-orders', 'POST', {
    warehouse_id: FIX.WH_QR.id, material_id: MAT.id, location_id: LOC_A.id, import_date: TODAY,
    source_type: 'FACTORY', warehouse_type: MAT.category, notes: `${T} phieu`,
  })
  const ord = r0.j?.data?.order ?? r0.j?.data
  if (!ord?.id) check('[68] Tạo phiếu nhập để thử sửa', false, `s=${r0.s} ${err(r0)}`)
  else {
    // Bundle CŨ (không gửi cờ đơn vị) → phải 409 để FE nạp lại bản mới
    const raw = await rawFetch(`/wms/inbound-orders/${ord.id}`, { method: 'PATCH', body: JSON.stringify({ notes: `${T} bundle cu` }) })
    check('[68] Bản app CŨ gửi lên (thiếu cờ đơn vị) → 409 bắt tải lại, không ghi nhầm đơn vị',
      raw.s === 409, `s=${raw.s} ${raw.text.slice(0, 70)}`)

    let r = await api(`/wms/inbound-orders/${ord.id}`, 'PATCH', { notes: `${T} da sua`, planned_pallets: 3 })
    const db = (await restAll('ProductionImport', `select=notes,planned_pallets&id=eq.${ord.id}`))[0]
    check('[69] Sửa ghi chú + số pallet dự kiến của phiếu đang mở → lưu đúng',
      r.s === 200 && db?.notes === `${T} da sua` && num(db?.planned_pallets) === 3, `s=${r.s} · ${db?.notes} / ${db?.planned_pallets}`)

    if (HAS_ENTRY) {
      r = await api(`/wms/inbound-orders/${ord.id}`, 'PATCH', { planned_cartons: UPC * 2 + 0.5 })
      check('[70] Số lượng LẺ với mã tính theo thùng → 422 kèm gợi ý quy đổi', r.s === 422, `s=${r.s} ${err(r)}`)
    } else check('[70] Số lượng lẻ với mã tính theo thùng', true, `mã ${MAT.material_code} không có đơn vị thùng — bỏ qua`)

    await api(`/wms/inbound-orders/${ord.id}/complete`, 'POST', {})
    r = await api(`/wms/inbound-orders/${ord.id}`, 'PATCH', { notes: `${T} sua sau khi dong` })
    const db2 = (await restAll('ProductionImport', `select=notes&id=eq.${ord.id}`))[0]
    check('[71] Sửa phiếu ĐÃ ĐÓNG → chặn và ghi chú giữ nguyên',
      r.s === 400 && db2?.notes === `${T} da sua`, `s=${r.s} ${err(r)} · ghi chú=${db2?.notes}`)

    await api(`/wms/inbound-orders/${ord.id}/uncomplete`, 'POST', {})
    r = await api(`/wms/inbound-orders/${randomUUID()}`, 'PATCH', { notes: 'x' })
    check('[72] Sửa phiếu KHÔNG TỒN TẠI → 404/403 sạch (không lỗi máy chủ)', r.s === 404 || r.s === 403, `s=${r.s} ${err(r)}`)
    if (r.s >= 500) server500.push(`PATCH /wms/inbound-orders/:id (id lạ) → ${r.s}`)
    await api(`/wms/inbound-orders/${ord.id}/cancel`, 'POST', {})
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// J. UPLOAD TỒN KHO
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── J. Upload Tồn kho ──')
{
  const HEAD = ['Mã pallet', 'Mã hàng', 'Kho (mã)', 'Mã vị trí', 'Số thùng', 'Ngày SX', 'Hộp (lẻ)']
  const P = i => `${T}TON${i}`
  const rowOf = (i, thung, hop = 0) => [P(i), MAT.material_code, FIX.WH_QR.code, LOC_A.location_code, thung, TODAY, hop]
  const baseOf = (thung, hop) => HAS_ENTRY ? thung * UPC + hop : thung

  const truoc = (await restAll('InventoryEntry', `select=id&pallet_code=like.${T}TON*`)).length
  let r = await upload('/wms/inventory/upload?preflight=1', xbuf([HEAD, rowOf(1, 3), rowOf(2, 5)]))
  const sau = (await restAll('InventoryEntry', `select=id&pallet_code=like.${T}TON*`)).length
  check('[73] Kiểm-trước upload tồn kho: báo số sẽ ghi nhưng DB chưa có pallet nào',
    r.s === 200 && r.j?.data?.preflight === true && num(r.j?.data?.to_insert) === 2 && truoc === 0 && sau === 0,
    `s=${r.s} · sẽ thêm=${r.j?.data?.to_insert} · DB=${sau}`)

  // ORACLE: tổng tồn đọc lại từ DB = tổng tự tính từ file (theo luật base unit)
  r = await upload('/wms/inventory/upload', xbuf([HEAD, rowOf(1, 3, HAS_ENTRY ? 2 : 0), rowOf(2, 5)]))
  const canCo = baseOf(3, HAS_ENTRY ? 2 : 0) + baseOf(5, 0)
  const dbRows = await restAll('InventoryEntry', `select=pallet_code,cartons_remaining&pallet_code=like.${T}TON*`)
  const dbTong = dbRows.reduce((s, x) => s + num(x.cartons_remaining), 0)
  check('[74] Ghi thật: tổng tồn đọc lại từ DB đúng bằng tổng tự tính từ file',
    r.s === 200 && num(r.j?.data?.inserted) === 2 && dbRows.length === 2 && dbTong === canCo,
    `s=${r.s} thêm=${r.j?.data?.inserted} · DB=${dbTong} · tự tính=${canCo}`)

  r = await upload('/wms/inventory/upload', xbuf([HEAD, rowOf(1, 10)]))
  const rows2 = await restAll('InventoryEntry', `select=id,cartons_remaining&pallet_code=eq.${P(1)}`)
  check('[75] Upload lại đúng pallet đó → CẬP NHẬT số lượng, không nhân đôi dòng tồn',
    r.s === 200 && num(r.j?.data?.updated) === 1 && rows2.length === 1 && num(rows2[0].cartons_remaining) === baseOf(10, 0),
    `s=${r.s} sửa=${r.j?.data?.updated} · số dòng=${rows2.length} · tồn=${rows2[0]?.cartons_remaining} (cần ${baseOf(10, 0)})`)

  const tonTruoc = num((await restAll('InventoryEntry', `select=cartons_remaining&pallet_code=eq.${P(1)}`))[0]?.cartons_remaining)
  r = await upload('/wms/inventory/upload', xbuf([HEAD, rowOf(1, 4), [P(9), 'MA-KHONG-CO-THAT', FIX.WH_QR.code, LOC_A.location_code, 1, TODAY, 0]]))
  const tonSau = num((await restAll('InventoryEntry', `select=cartons_remaining&pallet_code=eq.${P(1)}`))[0]?.cartons_remaining)
  const co9 = (await restAll('InventoryEntry', `select=id&pallet_code=eq.${P(9)}`)).length
  check('[76] File có 1 dòng sai → trả HTTP 200 kèm danh sách lỗi (dễ tưởng ĐÃ GHI) và KHÔNG ghi gì cả',
    r.s === 200 && (r.j?.data?.errors ?? []).length > 0 && num(r.j?.data?.inserted) === 0 && num(r.j?.data?.updated) === 0
      && tonSau === tonTruoc && co9 === 0,
    `s=${r.s} · lỗi=${(r.j?.data?.errors ?? []).length} · tồn giữ nguyên=${tonSau === tonTruoc} · dòng sai không ghi=${co9 === 0}`)

  // Số mới NHỎ HƠN phần đang giữ chỗ → chặn
  const e1 = (await restAll('InventoryEntry', `select=id&pallet_code=eq.${P(1)}`))[0]
  await restWrite('InventoryEntry', 'PATCH', `id=eq.${e1.id}`, { cartons_reserved: baseOf(8, 0), updated_at: now() })
  r = await upload('/wms/inventory/upload', xbuf([HEAD, rowOf(1, 2)]))
  const tonGiu = num((await restAll('InventoryEntry', `select=cartons_remaining&pallet_code=eq.${P(1)}`))[0]?.cartons_remaining)
  check('[77] Số mới NHỎ HƠN phần đang giữ chỗ cho đơn xuất → chặn, tồn không bị hạ',
    r.s === 200 && (r.j?.data?.errors ?? []).length > 0 && tonGiu === tonTruoc,
    `s=${r.s} · lỗi=${(r.j?.data?.errors ?? [])[0]?.slice(0, 70) ?? 'không có'} · tồn=${tonGiu}`)
  await restWrite('InventoryEntry', 'PATCH', `id=eq.${e1.id}`, { cartons_reserved: 0, updated_at: now() })

  // Ô GỘP THẬT ở cột khoá "Kho (mã)" — người dùng dán từ file kế toán rất hay có
  const rowsM = [HEAD, rowOf(3, 2), rowOf(4, 2)]
  const mg = mergeDown(rowsM, 2, 1, 2)   // cột 2 = "Kho (mã)"
  r = await upload('/wms/inventory/upload', xbuf(rowsM, mg))
  const co3 = (await restAll('InventoryEntry', `select=id&pallet_code=eq.${P(3)}`)).length
  const co4 = (await restAll('InventoryEntry', `select=id&pallet_code=eq.${P(4)}`)).length
  check('[78] File Tồn kho có Ô GỘP cột "Kho" → cả 2 dòng phải vào kho, không dòng nào bị mất/báo lỗi oan',
    r.s === 200 && (r.j?.data?.errors ?? []).length === 0 && co3 === 1 && co4 === 1,
    `s=${r.s} · lỗi=${JSON.stringify((r.j?.data?.errors ?? []).slice(0, 2))} · dòng đầu ghi=${co3} dòng gộp ghi=${co4}`)
}

// ══════════════════════════════════════════════════════════════════════════════
// K. IN TEM PALLET — ô lọc
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── K. Ô lọc trang In tem ──')
{
  let r = await api('/wms/pallet-prints', 'POST', {
    mode: 'GENERATE',
    labels: [
      { qr_code: `${T}TEM1`, material_code: MAT.material_code, category: MAT.category, cycle: `${T}CK`, machine: `${T}MAY`, nmsx: 'B', qty: 10, warehouse_id: FIX.WH_QR.id },
      { qr_code: `${T}TEM2`, material_code: MAT.material_code, category: MAT.category, cycle: `${T}CK`, machine: `${T}MAY`, nmsx: 'B', qty: 10, warehouse_id: FIX.WH_QR.id },
    ],
  })
  const db = (await restAll('PalletLabelPrint', `select=id,batch_id&qr_code=like.${T}TEM*`))
  check('[79] Ghi log in 2 tem → 2 dòng cùng một lượt in',
    r.s === 200 && num(r.j?.data?.logged) === 2 && db.length === 2 && db[0].batch_id === db[1].batch_id,
    `s=${r.s} ghi=${r.j?.data?.logged} · DB=${db.length}`)

  r = await api(`/wms/pallet-prints/facets?date_from=${TODAY}&date_to=${TODAY}&search=${T}TEM`, 'GET')
  const fc = r.j?.data ?? {}
  check('[80] Ô lọc trang In tem có đúng mã hàng / chu kỳ / máy vừa in',
    r.s === 200 && (fc.materials ?? []).includes(MAT.material_code) && (fc.cycles ?? []).includes(`${T}CK`)
      && (fc.machines ?? []).some(m => (m?.v ?? m) === `${T}MAY`),
    `s=${r.s} · mã=${(fc.materials ?? []).length} chu kỳ=${JSON.stringify(fc.cycles ?? [])} máy=${JSON.stringify(fc.machines ?? [])}`)
}

// ══════════════════════════════════════════════════════════════════════════════
// L. PHẠM VI KHO — tài khoản chỉ được gán 1 kho
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── L. Phạm vi kho của tài khoản lẻ ──')
{
  let bcrypt = null
  try { bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(m => m.default ?? m) } catch { /* chưa npm i backend */ }
  if (!bcrypt) {
    check('[81] Danh sách nhân sự để giao lệnh fill bị cắt theo phạm vi kho', true, 'chưa npm i backend (bcrypt) — bỏ qua')
    check('[82] Hạng mục check list DÙNG CHUNG chỉ tài khoản đủ phạm vi mới sửa', true, 'chưa npm i backend (bcrypt) — bỏ qua')
  } else {
    const jid = randomUUID(), eid = randomUUID(), eid2 = randomUUID(), pw = 'Qa' + randomUUID().slice(0, 10) + '!'
    await restWrite('JobTitle', 'POST', null, [{ id: jid, name: `${T} chuc danh`, updated_at: now(),
      module_permissions: { fill: ['view', 'assign', 'plan', 'cancel'], forklift: ['view', 'check', 'manage_item', 'manage_vehicle'] } }])
    const mkEmp = (id, code, whId, hash) => ({
      id, employee_code: code, name: `${T} ${code}`, email: `${code.toLowerCase()}@test.local`,
      password: hash, is_active: true, job_title_id: jid, warehouse_id: whId, warehouse_scope: 'ASSIGNED', updated_at: now(),
    })
    const hash = await bcrypt.hash(pw, 10)
    // Nhân sự MỒI ở kho NGOÀI phạm vi: không có người ở đó thì phép kiểm rò phạm vi trở nên rỗng
    // (kho Bluestar trên staging đang 0 nhân sự → hỏi gì cũng trả [] dù có rò thật).
    await restWrite('Employee', 'POST', null, [mkEmp(eid, `${T}01`, FIX.WH_QR.id, hash), mkEmp(eid2, `${T}02`, FIX.WH_QTY.id, hash)])
    await restWrite('UserWarehouseAccess', 'POST', null, [{ id: randomUUID(), employee_id: eid, warehouse_id: FIX.WH_QR.id }])
    const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${T.toLowerCase()}01@test.local`, password: pw }) })

    const tk = (await lr.json().catch(() => null))?.data?.token
    const call = async (path, method = 'GET', body) => {
      const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
        body: body ? JSON.stringify({ qty_semantics: 'base', ...body }) : undefined })
      let j = null; try { j = JSON.parse(await r.text()) } catch { /* không phải JSON */ }
      return { s: r.status, j }
    }
    if (!tk) {
      check('[81] Danh sách nhân sự để giao lệnh fill bị cắt theo phạm vi kho', false, `không đăng nhập được: http=${lr.status}`)
      check('[82] Hạng mục check list DÙNG CHUNG chỉ tài khoản đủ phạm vi mới sửa', false, `không đăng nhập được: http=${lr.status}`)
    } else {
      // Kho NGOÀI phạm vi (Bluestar) — DB có bao nhiêu nhân sự active ở đó (đã mồi ít nhất 1)?
      const dbKhac = (await restAll('Employee', `select=id&warehouse_id=eq.${FIX.WH_QTY.id}&is_active=is.true`)).length
      const r = await call(`/wms/fill/employees?warehouse_id=${FIX.WH_QTY.id}`)
      const tra = (r.j?.data ?? []).length
      const loMoi = (r.j?.data ?? []).some(e => e.employee_code === `${T}02`)
      check('[81] Tài khoản chỉ quản kho Ba Vì hỏi nhân sự KHO KHÁC → không được trả về',
        dbKhac > 0 && (r.s === 403 || tra === 0) && !loMoi,
        `s=${r.s} · app trả ${tra} người · DB kho đó có ${dbKhac} người · lộ đúng người mồi=${loMoi}`)

      const r2 = ITEM_SHARED
        ? await call(`/wms/forklift-items/${ITEM_SHARED}`, 'PATCH', { label: `${T} bi sua trom` })
        : { s: 0 }
      const lbl = ITEM_SHARED ? (await restAll('forklift_checklist_items', `select=label&id=eq.${ITEM_SHARED}`))[0]?.label : ''
      check('[82] Hạng mục check list DÙNG CHUNG mọi kho: tài khoản 1 kho không sửa được',
        r2.s === 403 && lbl === `${T} hang muc chung`, `s=${r2.s} · nhãn hiện tại=${lbl}`)
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DỌN
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Dọn ──')
if (LOGID) await api(`/wms/forklift-logs/${LOGID}`, 'DELETE')
for (const l of await restAll('forklift_daily_logs', `select=id&forklift_id=eq.${FKID ?? '00000000-0000-0000-0000-000000000000'}`))
  await api(`/wms/forklift-logs/${l.id}`, 'DELETE')
const delXe = FKID ? await api(`/wms/forklifts/${FKID}`, 'DELETE') : { s: 0 }
if (ITEM_SHARED) await api(`/wms/forklift-items/${ITEM_SHARED}`, 'DELETE')
check('[83] Xoá hết check list rồi xoá xe nâng → được (không còn vướng lịch sử)',
  !FKID || delXe.s === 200, `s=${delXe.s} ${err(delXe)}`)

if (KEYID) { await api(`/wms/integration-keys/${KEYID}/revoke`, 'PATCH', {}); await api(`/wms/integration-keys/${KEYID}`, 'DELETE') }
for (const c of await restAll('warehouse_costs', `select=id&warehouse_id=eq.${WH.id}`)) await api(`/wms/warehouse-costs/${c.id}`, 'DELETE')
if (ITEM1) await api(`/wms/warehouse-costs/items/${ITEM1}`, 'DELETE')
if (ITEM2) await api(`/wms/warehouse-costs/items/${ITEM2}`, 'DELETE')
for (const id of GDOS) {
  const dos = await restAll('OutboundDelivery', `select=id&gdo_id=eq.${id}`)
  if (dos.length) {
    const its = await restAll('OutboundItem', `select=id&do_id=in.(${dos.map(d => d.id).join(',')})`)
    if (its.length) await restWrite('OutboundScanEntry', 'DELETE', `item_id=in.(${its.map(i => i.id).join(',')})`).catch(() => {})
    await restWrite('OutboundItem', 'DELETE', `do_id=in.(${dos.map(d => d.id).join(',')})`).catch(() => {})
    await restWrite('OutboundDelivery', 'DELETE', `gdo_id=eq.${id}`).catch(() => {})
  }
}
await wipe()

const tanDu = [
  ['warehouse_costs', `select=id&cost_item=like.${T}*`],
  ['LookupValue', `select=id&type=eq.cost_item&value=like.${T}*`],
  ['SlottingPlan', `select=id&name=like.${T}*`],
  ['FillOrder', `select=id&order_code=like.${T}*`],
  ['forklift_vehicles', `select=id&code=like.${T}*`],
  ['forklift_checklist_items', `select=id&label=like.${T}*`],
  ['WeighTicket', `select=id&station_code=eq.${T}`],
  ['reconcile_tasks', `select=id&od_number=like.${T}*`],
  ['InventoryEntry', `select=id&pallet_code=like.${T}*`],
  ['PalletLabelPrint', `select=id&qr_code=like.${T}*`],
  ['GroupDeliveryOrder', `select=id&group_code=like.${T}*`],
  ['Location', `select=id&row=eq.${T}`],
  ['Warehouse', `select=id&code=like.${T}*`],
  ['Employee', `select=id&employee_code=like.${T}*`],
]
const con = []
for (const [t, f] of tanDu) { const n = (await restAll(t, f)).length; if (n) con.push(`${t}=${n}`) }
check('[84] Dọn sạch: không còn bản ghi thử nào sót lại', con.length === 0, con.join(' · ') || '0 tàn dư')

if (server500.length) console.log(`\n⚠ Ca 5xx đã gây (dọn error_logs): ${server500.join(' ‖ ')}`)
finish('WMS-OPS')
