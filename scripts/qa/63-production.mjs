// GÓI 63 — MES GIAI ĐOẠN 1: MẺ CHẾ BIẾN · RÚT NVL · BỒN · SỔ ĐÓNG GÓI RÚT TỪ BỒN · TRUY XUẤT SẢN XUẤT
// (14/11, user chốt — docs/plans/MES_PHASE1_PLAN.md, memory mes-phase1-design-2026-11-14).
// Điều phải giữ:
//   [1] Mẻ chỉ mở ở KHO PHỤ nội bộ; mã lô app gợi ý (không lấp chỗ trống), trùng mã gõ tay ⇒ 409; BTP phải tính L/KG
//   [2] Quét tem: chỉ tem CÒN TỒN ở kho của mẻ; tem ở kho khác nói tên kho; mã tồn gộp nhiều lô ⇒ bắt đi đường "Không có tem"
//   [3] Rút theo tem trừ ĐÚNG số; thiếu cờ qty_semantics ⇒ 400; QA giữ ⇒ 409; 5 người cùng rút một tem không vượt tồn
//   [4] Rút theo lô: FEFO trong đúng NSX; thiếu ⇒ 409 và KHÔNG trừ dở; huỷ dòng rút hoàn đúng tồn, huỷ lần 2 ⇒ 409
//   [5] Bồn: sức chứa · không trộn mã · nạp mẻ kho khác ⇒ chặn; nhiều mẻ một bồn ⇒ rút chia theo tỷ lệ
//   [6] Trang sổ: gắn bồn của kho phụ trực thuộc; đóng trang khai lượng rút trong cùng giao dịch; công tắc QA mặc định CẢNH BÁO,
//       đặt CHẶN ⇒ 409 và trang vẫn MỞ (không rút dở); thả QA xong đóng được
//   [7] Điều chỉnh / chuyển / xả bồn; [8] truy xuất: pallet TP → mẻ → NVL, pallet NVL → mẻ → trang sổ → pallet TP; sổ pallet có "Rút vào mẻ"
//   [9] Huỷ mẻ còn dòng rút ⇒ 409; đóng / mở lại mẻ; bất biến tồn: nhập − còn = Σ rút sống
// Fixture QA63: kho cha QA63_PARENT + kho phụ QA63_CB (+ QA63_CB2 để thử chéo kho) · mã NVL/BTP QA63* · tem QA63_* — dọn bằng PostgREST.
import { randomUUID } from 'crypto'
import { login, api, rawFetch, restAll, restWrite, check, finish } from './lib.mjs'

const PACK = '63-production'
await login()
const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const WP = 'QA63_PARENT', WC = 'QA63_CB', WC2 = 'QA63_CB2'
const M_RM = 'QA63_RM1', M_BTP = 'QA63_BTP1', M_BTP2 = 'QA63_BTP2', M_EA = 'QA63_EA1'
const qaX = (await restAll('QAStatus', 'select=id&code=eq.X'))[0]?.id
const ts = () => new Date().toISOString()
const num = (v) => Number(v ?? 0)

async function cleanup() {
  const whs = [WP, WC, WC2]
  const runs = await restAll('packing_runs', `select=id&warehouse_id=in.(${whs.join(',')})`)
  const tanks = await restAll('production_tank', `select=id&warehouse_id=in.(${whs.join(',')})`)
  const batches = await restAll('production_batch', `select=id&warehouse_id=in.(${whs.join(',')})`)
  if (tanks.length) await restWrite('tank_movement', 'DELETE', `tank_id=in.(${tanks.map(t => t.id).join(',')})`)
  if (tanks.length) await restWrite('tank_lot', 'DELETE', `tank_id=in.(${tanks.map(t => t.id).join(',')})`)
  if (batches.length) await restWrite('batch_consumption', 'DELETE', `batch_id=in.(${batches.map(b => b.id).join(',')})`)
  if (runs.length) {
    await restWrite('packing_logs', 'DELETE', `run_id=in.(${runs.map(r => r.id).join(',')})`)
    await restWrite('packing_runs', 'DELETE', `id=in.(${runs.map(r => r.id).join(',')})`)
  }
  if (batches.length) await restWrite('production_batch', 'DELETE', `id=in.(${batches.map(b => b.id).join(',')})`)
  if (tanks.length) await restWrite('production_tank', 'DELETE', `id=in.(${tanks.map(t => t.id).join(',')})`)
  await restWrite('InventoryEntry', 'DELETE', `warehouse_id=in.(${whs.join(',')})`)
  await restWrite('Material', 'DELETE', `id=in.(${[M_RM, M_BTP, M_BTP2, M_EA].join(',')})`)
  await restWrite('Warehouse', 'DELETE', `id=in.(${WC},${WC2})`)
  await restWrite('Warehouse', 'DELETE', `id=eq.${WP}`)
}

await cleanup()
try {
  // ── Fixture ──
  await restWrite('Warehouse', 'POST', null, { id: WP, code: 'QA63PARENT', name: 'QA63 — nhà máy (bộ kiểm tự dùng)', warehouse_type: 'CENTRAL', inventory_mode: 'QR', updated_at: ts() })
  await restWrite('Warehouse', 'POST', null, [
    { id: WC, code: 'QA63CB', name: 'QA63 — kho chế biến', warehouse_type: 'CENTRAL', inventory_mode: 'QR', parent_warehouse_id: WP, updated_at: ts() },
    { id: WC2, code: 'QA63CB2', name: 'QA63 — kho chế biến 2', warehouse_type: 'CENTRAL', inventory_mode: 'QR', parent_warehouse_id: WP, updated_at: ts() },
  ])
  // PostgREST đòi mọi dòng của một lô cùng bộ khoá ⇒ dựng qua một hàm có đủ cột
  const MAT = (id, code, desc, unit, prefix = null, hold = null) => ({ id, material_code: code, material_description: desc, short_name: desc, base_unit: unit, batch_prefix: prefix, tank_hold_hours: hold, updated_at: ts() })
  await restWrite('Material', 'POST', null, [
    MAT(M_RM, 'QA63RM1', 'QA63 NVL đường', 'KG'),
    MAT(M_BTP, 'QA63BTP1', 'QA63 dịch sữa nền', 'L', 'QD', 48),
    MAT(M_BTP2, 'QA63BTP2', 'QA63 dịch khác', 'L'),
    MAT(M_EA, 'QA63EA1', 'QA63 hàng chiếc', 'EA'),
  ])
  const E = (id, pallet, qty, wh, nsx, exp, extra = {}) => ({ id, pallet_code: pallet, material_id: M_RM, cartons_imported: qty, cartons_remaining: qty, status: 'IN_STOCK',
    warehouse_id: wh, production_date: `${nsx}T00:00:00`, expiry_date: exp, import_date: todayVN, qa_status_id: null, created_at: ts(), updated_at: ts(), ...extra })
  await restWrite('InventoryEntry', 'POST', null, [
    E('QA63_E1', 'QA63_P1', 100, WC, '2026-11-01', '2027-01-01'),
    E('QA63_E2', 'QA63_P2', 50, WC, '2026-11-01', '2027-02-01'),
    E('QA63_E3', 'QA63_P3', 40, WC, '2026-11-01', '2027-01-01', { qa_status_id: qaX }),
    E('QA63_E4', 'QA63_P4', 40, WP, '2026-11-01', '2027-01-01'),
    E('QA63_E5', 'QA63RM1', 20, WC, '2026-11-05', '2027-03-01'),   // tồn gộp (mã = mã hàng) hai NSX
    E('QA63_E6', 'QA63RM1', 20, WC, '2026-11-06', '2027-03-02'),
  ])

  // ── [1] mở mẻ ──
  const r1a = await api('/wms/production/batches', 'POST', { warehouse_id: WP, material_id: M_BTP, prod_date: todayVN })
  check('1a. Mở mẻ ở kho KHÔNG phải kho phụ ⇒ 422 NOT_PRODUCTION_WAREHOUSE', r1a.s === 422 && r1a.j?.error?.code === 'NOT_PRODUCTION_WAREHOUSE', `http=${r1a.s} ${r1a.j?.error?.code}`)
  const r1b = await api('/wms/production/batches', 'POST', { warehouse_id: WC, material_id: M_EA, prod_date: todayVN })
  check('1b. Mã tính theo EA ⇒ 422 BTP_UNIT', r1b.s === 422 && r1b.j?.error?.code === 'BTP_UNIT', `http=${r1b.s}`)
  const nc = await api(`/wms/production/batches/next-code?warehouse_id=${WC}&material_id=${M_BTP}&prod_date=${todayVN}&machine_code=t1`)
  const stem = `QD${todayVN.slice(2, 4)}${todayVN.slice(5, 7)}${todayVN.slice(8, 10)}T1`
  check('1c. Mã lô gợi ý = tiền tố + yymmdd + máy + 001', nc.s === 200 && nc.j?.data?.code === `${stem}001`, `http=${nc.s} code=${nc.j?.data?.code}`)
  const b1 = await api('/wms/production/batches', 'POST', { warehouse_id: WC, material_id: M_BTP, prod_date: todayVN, machine_code: 'T1', planned_qty: 1000 })
  const B1 = b1.j?.data
  check('1d. Mở mẻ không gõ mã ⇒ 201, mã = gợi ý, QA mặc định HOLD', b1.s === 201 && B1?.batch_code === `${stem}001` && B1?.qa_status === 'HOLD', `http=${b1.s} ${JSON.stringify(b1.j?.error ?? null)}`)
  const b2 = await api('/wms/production/batches', 'POST', { warehouse_id: WC, material_id: M_BTP, prod_date: todayVN, machine_code: 'T1' })
  const B2 = b2.j?.data
  check('1e. Mẻ thứ hai cùng gốc ⇒ số kế 002', b2.s === 201 && B2?.batch_code === `${stem}002`, `code=${B2?.batch_code}`)
  const dup = await api('/wms/production/batches', 'POST', { warehouse_id: WC, material_id: M_BTP, prod_date: todayVN, batch_code: B1?.batch_code?.toLowerCase() })
  check('1f. Gõ tay trùng mã (chữ thường) ⇒ 409 BATCH_CODE_DUP', dup.s === 409 && dup.j?.error?.code === 'BATCH_CODE_DUP', `http=${dup.s}`)

  // ── [2] tra tem ──
  const s2a = await api(`/wms/production/batches/${B1.id}/scan-check?code=QA63_P1`)
  check('2a. Quét tem còn tồn ở kho của mẻ ⇒ 200 kèm mã + tồn', s2a.s === 200 && s2a.j?.data?.id === 'QA63_E1' && num(s2a.j?.data?.cartons_remaining) === 100, `http=${s2a.s}`)
  const s2b = await api(`/wms/production/batches/${B1.id}/scan-check?code=QA63_P4`)
  check('2b. Tem ở kho khác ⇒ 404 nói đúng tên kho đang giữ', s2b.s === 404 && /QA63 — nhà máy/.test(s2b.j?.error?.message ?? ''), `http=${s2b.s} ${s2b.j?.error?.message}`)
  const s2c = await api(`/wms/production/batches/${B1.id}/scan-check?code=QA63RM1`)
  check('2c. Mã tồn gộp nhiều lô ⇒ 409 POOLED_CODE', s2c.s === 409 && s2c.j?.error?.code === 'POOLED_CODE', `http=${s2c.s}`)

  // ── [3] rút theo tem ──
  // api() tự đắp cờ qty_semantics ⇒ đi cửa THÔ để thử đúng body thiếu cờ (bundle cũ)
  const c3a = await rawFetch(`/wms/production/batches/${B1.id}/consume-scan`, { method: 'POST', body: JSON.stringify({ entry_id: 'QA63_E1', qty: 30 }) })
  check('3a. Thiếu qty_semantics ⇒ 400 VALIDATION', c3a.s === 400, `http=${c3a.s}`)
  const c3b = await api(`/wms/production/batches/${B1.id}/consume-scan`, 'POST', { entry_id: 'QA63_E1', qty: 30, qty_semantics: 'base' })
  const e1 = (await restAll('InventoryEntry', 'select=cartons_remaining,status&id=eq.QA63_E1'))[0]
  check('3b. Rút 30 KG ⇒ tem còn 70, PARTIAL', c3b.s === 200 && num(e1?.cartons_remaining) === 70 && e1?.status === 'PARTIAL', `http=${c3b.s} rem=${e1?.cartons_remaining}`)
  const c3c = await api(`/wms/production/batches/${B1.id}/consume-scan`, 'POST', { entry_id: 'QA63_E3', qty: 1, qty_semantics: 'base' })
  check('3c. Tem QA giữ ⇒ 409 MES_QA_HOLD', c3c.s === 409 && c3c.j?.error?.code === 'MES_QA_HOLD', `http=${c3c.s}`)
  const c3d = await api(`/wms/production/batches/${B1.id}/consume-scan`, 'POST', { entry_id: 'QA63_E4', qty: 1, qty_semantics: 'base' })
  check('3d. Tem kho khác (đi thẳng id) ⇒ 409 MES_WRONG_WAREHOUSE', c3d.s === 409 && c3d.j?.error?.code === 'MES_WRONG_WAREHOUSE', `http=${c3d.s}`)
  // 5 người cùng rút 20 KG trên tem còn 70 ⇒ đúng 3 thành công, 2 thiếu; không âm
  const race = await Promise.all([1, 2, 3, 4, 5].map(() => api(`/wms/production/batches/${B1.id}/consume-scan`, 'POST', { entry_id: 'QA63_E1', qty: 20, qty_semantics: 'base' })))
  const okN = race.filter(r => r.s === 200).length, shortN = race.filter(r => r.s === 409 && r.j?.error?.code === 'MES_SHORT').length
  const e1b = (await restAll('InventoryEntry', 'select=cartons_remaining&id=eq.QA63_E1'))[0]
  check('3e. 5 người cùng rút 20 trên tem còn 70 ⇒ 3 thành công · 2 MES_SHORT · tem còn 10', okN === 3 && shortN === 2 && num(e1b?.cartons_remaining) === 10, `ok=${okN} short=${shortN} other=${race.filter(r => r.s !== 200 && r.s !== 409).map(r => r.s).join(',')} rem=${e1b?.cartons_remaining}`)

  // ── [4] rút theo lô + huỷ ──
  const st = await api(`/wms/production/stock?warehouse_id=${WC}`)
  const stM = (st.j?.data?.materials ?? []).find(m => m.material_id === M_RM)
  check('4a. Tồn rút được của kho: mã NVL có mặt, bỏ phần QA giữ (10 + 50 + 20 + 20 = 100)', st.s === 200 && num(stM?.available) === 100, `http=${st.s} avail=${stM?.available}`)
  const stL = await api(`/wms/production/stock?warehouse_id=${WC}&material_id=${M_RM}`)
  const lots = stL.j?.data?.lots ?? []
  check('4b. Các lô của mã: 3 NSX, HSD sớm nhất lên đầu', stL.s === 200 && lots.length === 3 && String(lots[0]?.production_date).startsWith('2026-11-01'), `n=${lots.length} first=${lots[0]?.production_date}`)
  const c4a = await api(`/wms/production/batches/${B1.id}/consume-lot`, 'POST', { material_id: M_RM, production_date: '2026-11-01', qty: 70, qty_semantics: 'base' })
  check('4c. Thiếu lô NSX 01/11 (có 60, cần 70) ⇒ 409 MES_SHORT', c4a.s === 409 && c4a.j?.error?.code === 'MES_SHORT', `http=${c4a.s}`)
  const after4c = await restAll('InventoryEntry', 'select=id,cartons_remaining&id=in.(QA63_E1,QA63_E2)')
  check('4d. …và KHÔNG trừ dở dòng nào', after4c.every(e => (e.id === 'QA63_E1' ? num(e.cartons_remaining) === 10 : num(e.cartons_remaining) === 50)), JSON.stringify(after4c))
  const c4b = await api(`/wms/production/batches/${B1.id}/consume-lot`, 'POST', { material_id: M_RM, production_date: '2026-11-01', qty: 25, qty_semantics: 'base' })
  const rows4 = c4b.j?.data?.rows ?? []
  check('4e. Rút 25 theo lô ⇒ FEFO: P1 (HSD 01/01) 10 + P2 15', c4b.s === 200 && rows4.length === 2 && rows4[0]?.pallet_code === 'QA63_P1' && num(rows4[0]?.qty) === 10 && num(rows4[1]?.qty) === 15, JSON.stringify(rows4))
  const c4c = await api(`/wms/production/batches/${B1.id}/consume-lot`, 'POST', { material_id: M_RM, production_date: '2026-11-05', qty: 5, qty_semantics: 'base' })
  check('4f. Rút theo lô NSX 05/11 từ tồn gộp ⇒ đúng dòng QA63_E5', c4c.s === 200 && c4c.j?.data?.rows?.[0]?.entry_id === 'QA63_E5', `http=${c4c.s}`)
  const firstCons = (await restAll('batch_consumption', `select=id,qty&batch_id=eq.${B1.id}&source=eq.SCAN&order=created_at&limit=1`))[0]
  const rv = await api(`/wms/production/consumption/${firstCons.id}/reverse`, 'POST', { reason: 'QA63 ghi nhầm' })
  const e1c = (await restAll('InventoryEntry', 'select=cartons_remaining&id=eq.QA63_E1'))[0]
  check('4g. Huỷ dòng rút 30 ⇒ hoàn đúng 30 vào tem', rv.s === 200 && num(e1c?.cartons_remaining) === 30, `http=${rv.s} rem=${e1c?.cartons_remaining}`)
  const rv2 = await api(`/wms/production/consumption/${firstCons.id}/reverse`, 'POST', { reason: 'lần 2' })
  check('4h. Huỷ lần 2 ⇒ 409 MES_ALREADY_REVERSED', rv2.s === 409 && rv2.j?.error?.code === 'MES_ALREADY_REVERSED', `http=${rv2.s}`)
  // bất biến tồn: với mỗi dòng tồn, nhập − còn = Σ rút SỐNG
  const ents = await restAll('InventoryEntry', `select=id,cartons_imported,cartons_remaining&warehouse_id=eq.${WC}`)
  const live = await restAll('batch_consumption', `select=entry_id,qty&batch_id=in.(${B1.id},${B2.id})&reversed_at=is.null`)
  const bad = ents.filter(e => Math.abs(num(e.cartons_imported) - num(e.cartons_remaining) - live.filter(c => c.entry_id === e.id).reduce((s, c) => s + num(c.qty), 0)) > 1e-9)
  check('4i. Bất biến: nhập − còn = Σ rút sống, mọi dòng tồn kho chế biến', bad.length === 0, bad.map(e => e.id).join(','))

  // ── [5] bồn ──
  const t1 = await api('/wms/production/tanks', 'POST', { warehouse_id: WC, code: 'qa63-t1', capacity: 1000, unit: 'L' })
  const T1 = t1.j?.data
  check('5a. Tạo bồn ⇒ 201, mã chuẩn hoá hoa', t1.s === 201 && T1?.code === 'QA63-T1', `http=${t1.s}`)
  const t1dup = await api('/wms/production/tanks', 'POST', { warehouse_id: WC, code: 'QA63-T1', capacity: 10, unit: 'L' })
  check('5b. Trùng mã bồn trong kho ⇒ 409 TANK_DUP', t1dup.s === 409 && t1dup.j?.error?.code === 'TANK_DUP', `http=${t1dup.s}`)
  const T2 = (await api('/wms/production/tanks', 'POST', { warehouse_id: WC, code: 'QA63-T2', capacity: 500, unit: 'L' })).j?.data
  const T3 = (await api('/wms/production/tanks', 'POST', { warehouse_id: WC2, code: 'QA63-T3', capacity: 500, unit: 'L' })).j?.data
  const f1 = await api(`/wms/production/tanks/${T1.id}/fill`, 'POST', { batch_id: B1.id, qty: 600 })
  const f2 = await api(`/wms/production/tanks/${T1.id}/fill`, 'POST', { batch_id: B2.id, qty: 400 })
  check('5c. Nạp 600 (mẻ 1) + 400 (mẻ 2) vào bồn 1000 L', f1.s === 200 && f2.s === 200, `http=${f1.s}/${f2.s} ${f1.j?.error?.message ?? ''}`)
  const f3 = await api(`/wms/production/tanks/${T1.id}/fill`, 'POST', { batch_id: B1.id, qty: 1 })
  check('5d. Nạp thêm khi đầy ⇒ 409 MES_OVER_CAPACITY', f3.s === 409 && f3.j?.error?.code === 'MES_OVER_CAPACITY', `http=${f3.s}`)
  const b3 = (await api('/wms/production/batches', 'POST', { warehouse_id: WC, material_id: M_BTP2, prod_date: todayVN })).j?.data
  await api(`/wms/production/tanks/${T2.id}/fill`, 'POST', { batch_id: B1.id, qty: 100 })
  const f4 = await api(`/wms/production/tanks/${T2.id}/fill`, 'POST', { batch_id: b3.id, qty: 10 })
  check('5e. Trộn mã BTP khác vào bồn ⇒ 409 MES_MIX_MATERIAL', f4.s === 409 && f4.j?.error?.code === 'MES_MIX_MATERIAL', `http=${f4.s}`)
  const f5 = await api(`/wms/production/tanks/${T3.id}/fill`, 'POST', { batch_id: B1.id, qty: 10 })
  check('5f. Nạp mẻ vào bồn KHO KHÁC (cặp id chéo) ⇒ 409 MES_WRONG_WAREHOUSE', f5.s === 409 && f5.j?.error?.code === 'MES_WRONG_WAREHOUSE', `http=${f5.s}`)
  const tl = await api(`/wms/production/tanks?warehouse_id=${WC}`)
  const v1 = (tl.j?.data ?? []).find(t => t.id === T1.id)
  check('5g. Danh sách bồn: bồn 1 chứa 1000, 2 lô, có lô chưa QA thả, hạn lưu 48 giờ', tl.s === 200 && num(v1?.content) === 1000 && v1?.lots?.length === 2 && v1?.qa_pending === true && !!v1?.next_expiry, JSON.stringify({ c: v1?.content, n: v1?.lots?.length, q: v1?.qa_pending }))

  const up1 = await api(`/wms/production/tanks/${T1.id}`, 'PATCH', { is_active: false })
  const up2 = await api(`/wms/production/tanks/${T1.id}`, 'PATCH', { name: 'QA63 bồn 1', unit: 'KG' })
  const up3 = await api(`/wms/production/tanks/${T1.id}`, 'PATCH', { name: 'QA63 bồn 1' })
  check('5h. Sửa bồn: ngừng dùng / đổi đơn vị khi còn hàng ⇒ 409 TANK_NOT_EMPTY; đổi tên ⇒ 200',
    up1.s === 409 && up1.j?.error?.code === 'TANK_NOT_EMPTY' && up2.s === 409 && up3.s === 200 && up3.j?.data?.name === 'QA63 bồn 1', `http=${up1.s}/${up2.s}/${up3.s}`)

  // ── [6] trang sổ đóng gói rút từ bồn ──
  const tfr = await api(`/wms/production/tanks-for-run?warehouse_id=${WP}`)
  check('6a. Bồn chọn được cho trang sổ ở kho cha = bồn của các kho phụ trực thuộc', tfr.s === 200 && (tfr.j?.data ?? []).some(t => t.id === T1.id) && (tfr.j?.data ?? []).some(t => t.id === T3.id), `http=${tfr.s} n=${tfr.j?.data?.length}`)
  const badRun = await api('/wms/packing-runs', 'POST', { warehouse_id: WP, material_codes: ['QA63FG'], machine_code: 'QA63M', cycle: 'C63', tank_id: 'khong-co' })
  check('6b. Mở trang sổ với bồn không hợp lệ ⇒ 422 TANK_INVALID', badRun.s === 422 && badRun.j?.error?.code === 'TANK_INVALID', `http=${badRun.s}`)
  const run1 = await api('/wms/packing-runs', 'POST', { warehouse_id: WP, material_codes: ['QA63FG'], machine_code: 'QA63M', cycle: 'C63', tank_id: T1.id })
  const R1 = run1.j?.data
  check('6c. Mở trang sổ gắn bồn ⇒ 200, tank_id lưu', run1.s === 200 && R1?.tank_id === T1.id, `http=${run1.s} ${JSON.stringify(run1.j?.error ?? null)}`)
  await restWrite('packing_logs', 'POST', null, { id: randomUUID(), pallet_code: 'QA63_FG_PAL1', material_code: 'QA63FG', warehouse_id: WP, run_id: R1.id, status: 'CLOSED', qty_cartons: 10, open_scan_at: ts(), updated_at: ts() })
  const cl1 = await api(`/wms/packing-runs/${R1.id}/close`, 'POST', { tank_qty: 500 })
  const lotsT1 = await restAll('tank_lot', `select=batch_id,qty_remaining&tank_id=eq.${T1.id}&status=eq.ACTIVE`)
  const rem = (b) => num(lotsT1.find(l => l.batch_id === b)?.qty_remaining)
  check('6d. Đóng trang khai rút 500 ⇒ CLOSED, chia 300/200 theo tỷ lệ, có cảnh báo QA (mặc định CẢNH BÁO)',
    cl1.s === 200 && cl1.j?.data?.status === 'CLOSED' && rem(B1.id) === 300 && rem(B2.id) === 200 && (cl1.j?.data?.tank_warnings ?? []).length === 1,
    `http=${cl1.s} ${JSON.stringify(cl1.j?.error ?? null)} rem=${rem(B1.id)}/${rem(B2.id)} warn=${JSON.stringify(cl1.j?.data?.tank_warnings)}`)
  await restWrite('Warehouse', 'PATCH', `id=eq.${WC}`, { production_qa_gate: 'BLOCK', updated_at: ts() })
  const R2 = (await api('/wms/packing-runs', 'POST', { warehouse_id: WP, material_codes: ['QA63FG2'], machine_code: 'QA63M', cycle: 'C63', tank_id: T1.id })).j?.data
  const cl2 = await api(`/wms/packing-runs/${R2.id}/close`, 'POST', { tank_qty: 50 })
  const r2now = (await restAll('packing_runs', `select=status&id=eq.${R2.id}`))[0]
  check('6e. Kho đặt CHẶN ⇒ 409 MES_QA_BLOCK và trang VẪN MỞ', cl2.s === 409 && cl2.j?.error?.code === 'MES_QA_BLOCK' && r2now?.status === 'OPEN', `http=${cl2.s} status=${r2now?.status}`)
  const qa1 = await api(`/wms/production/batches/${B1.id}/qa`, 'POST', { qa_status: 'RELEASED' })
  const qa2 = await api(`/wms/production/batches/${B2.id}/qa`, 'POST', { qa_status: 'RELEASED' })
  const qaRej = await api(`/wms/production/batches/${b3.id}/qa`, 'POST', { qa_status: 'REJECTED' })
  check('6f. QA thả 2 mẻ; loại lô không lý do ⇒ 422', qa1.s === 200 && qa2.s === 200 && qaRej.s === 422, `http=${qa1.s}/${qa2.s}/${qaRej.s}`)
  const cl3 = await api(`/wms/packing-runs/${R2.id}/close`, 'POST', { tank_qty: 50 })
  check('6g. Thả QA xong đóng được, không cảnh báo', cl3.s === 200 && (cl3.j?.data?.tank_warnings ?? []).length === 0, `http=${cl3.s} ${JSON.stringify(cl3.j?.error ?? null)}`)
  const runGet = await api(`/wms/packing-runs/${R1.id}`)
  check('6h. Chi tiết trang sổ kèm bồn + 2 lần rút (theo 2 mẻ)', runGet.s === 200 && runGet.j?.data?.tank?.id === T1.id && (runGet.j?.data?.tank_draws ?? []).length === 2, `n=${runGet.j?.data?.tank_draws?.length}`)
  await restWrite('Warehouse', 'PATCH', `id=eq.${WC}`, { production_qa_gate: 'WARN', updated_at: ts() })

  // ── [7] điều chỉnh / chuyển / xả ──
  const adj = await api(`/wms/production/tanks/${T1.id}/adjust`, 'POST', { level: 400, reason: 'QA63 khớp đồng hồ' })
  const sumT1 = async () => (await restAll('tank_lot', `select=qty_remaining&tank_id=eq.${T1.id}&status=eq.ACTIVE`)).reduce((s, l) => s + num(l.qty_remaining), 0)
  check('7a. Điều chỉnh mức bồn 450 → 400', adj.s === 200 && await sumT1() === 400, `http=${adj.s}`)
  const adjNo = await api(`/wms/production/tanks/${T1.id}/adjust`, 'POST', { level: 400 })
  check('7b. Điều chỉnh không lý do ⇒ 400', adjNo.s === 400, `http=${adjNo.s}`)
  const tr = await api(`/wms/production/tanks/${T1.id}/transfer`, 'POST', { to_tank_id: T2.id, qty: 100 })
  const sumT2 = (await restAll('tank_lot', `select=qty_remaining&tank_id=eq.${T2.id}&status=eq.ACTIVE`)).reduce((s, l) => s + num(l.qty_remaining), 0)
  check('7c. Chuyển 100 sang bồn 2 ⇒ bồn 1 = 300, bồn 2 = 200', tr.s === 200 && await sumT1() === 300 && sumT2 === 200, `http=${tr.s} t2=${sumT2}`)
  const trX = await api(`/wms/production/tanks/${T1.id}/transfer`, 'POST', { to_tank_id: T3.id, qty: 10 })
  check('7d. Chuyển sang bồn kho khác ⇒ 409 MES_WRONG_WAREHOUSE', trX.s === 409 && trX.j?.error?.code === 'MES_WRONG_WAREHOUSE', `http=${trX.s}`)
  const ds = await api(`/wms/production/tanks/${T1.id}/discard`, 'POST', { qty: 300, reason: 'QA63 xả bỏ' })
  check('7e. Xả hết bồn 1 ⇒ bồn trống', ds.s === 200 && await sumT1() === 0, `http=${ds.s}`)
  const mv = await api(`/wms/production/tanks/${T1.id}/movements`)
  check('7f. Sổ bồn ghi đủ nạp · rút · điều chỉnh · chuyển · xả', mv.s === 200 && ['FILL', 'DRAW', 'ADJUST', 'TRANSFER_OUT', 'DISCARD'].every(k => (mv.j?.data?.rows ?? []).some(r => r.kind === k)), `kinds=${[...new Set((mv.j?.data?.rows ?? []).map(r => r.kind))].join(',')}`)

  // ── [8] truy xuất ──
  const gFg = await api('/wms/production/genealogy?kind=FG_PALLET&value=QA63_FG_PAL1')
  const fgB = gFg.j?.data?.batches ?? []
  check('8a. Pallet thành phẩm ⇒ 2 mẻ đã rút vào trang sổ của nó', gFg.s === 200 && fgB.length === 2 && fgB.some(b => b.id === B1.id) && fgB.some(b => b.id === B2.id), `n=${fgB.length}`)
  const fgB1 = fgB.find(b => b.id === B1.id)
  check('8b. …mẻ 1 kèm NVL đã rút (không có dòng đã huỷ) và trang sổ → pallet TP', (fgB1?.materials ?? []).length >= 2 && !(fgB1?.materials ?? []).some(m => m.source === 'SCAN' && num(m.qty) === 30)
    && (fgB1?.runs ?? []).some(r => (r.pallets ?? []).includes('QA63_FG_PAL1')), JSON.stringify({ m: fgB1?.materials?.length, r: fgB1?.runs?.length }))
  const gRm = await api('/wms/production/genealogy?kind=RM_PALLET&value=QA63_P2')
  check('8c. Pallet NVL ⇒ mẻ đã dùng nó', gRm.s === 200 && (gRm.j?.data?.batches ?? []).some(b => b.id === B1.id), `n=${gRm.j?.data?.batches?.length}`)
  const gB = await api(`/wms/production/genealogy?kind=BATCH&value=${B2.batch_code}`)
  check('8d. Tra theo mã lô BTP', gB.s === 200 && gB.j?.data?.batches?.[0]?.id === B2.id, `http=${gB.s}`)
  const led = await api('/wms/inventory/pallet-ledger?pallet_code=QA63_P1')
  const kinds = (led.j?.data?.events ?? []).map(e => e.kind)
  check('8e. Sổ pallet NVL có "Rút vào mẻ" + "Huỷ rút"', led.s === 200 && kinds.includes('CONSUMED') && kinds.includes('CONSUME_REVERSED'), `kinds=${[...new Set(kinds)].join(',')}`)

  // ── [9] vòng đời mẻ ──
  const cx = await api(`/wms/production/batches/${B1.id}/cancel`, 'POST', {})
  check('9a. Huỷ mẻ còn dòng rút ⇒ 409 BATCH_HAS_CONSUMPTION', cx.s === 409 && cx.j?.error?.code === 'BATCH_HAS_CONSUMPTION', `http=${cx.s}`)
  const clB = await api(`/wms/production/batches/${B1.id}/close`, 'POST', {})
  const consClosed = await api(`/wms/production/batches/${B1.id}/consume-scan`, 'POST', { entry_id: 'QA63_E2', qty: 1, qty_semantics: 'base' })
  const reB = await api(`/wms/production/batches/${B1.id}/reopen`, 'POST', {})
  check('9b. Đóng mẻ ⇒ không rút được (409 MES_BATCH_NOT_OPEN); mở lại được', clB.s === 200 && consClosed.s === 409 && consClosed.j?.error?.code === 'MES_BATCH_NOT_OPEN' && reB.s === 200, `http=${clB.s}/${consClosed.s}/${reB.s}`)
  const lockEdit = await api(`/wms/production/batches/${B1.id}`, 'PATCH', { batch_code: 'QA63DOI' })
  check('9c. Đổi mã lô khi đã rút NVL ⇒ 409 BATCH_LOCKED', lockEdit.s === 409 && lockEdit.j?.error?.code === 'BATCH_LOCKED', `http=${lockEdit.s}`)
  const lst = await api(`/wms/production/batches?warehouse_id=${WC}&pageSize=50`)
  const rowB1 = (lst.j?.data?.rows ?? []).find(r => r.id === B1.id)
  check('9d. Danh sách mẻ: dòng + ô tổng một lời gọi; mẻ 1 có NVL + đã nạp', lst.s === 200 && num(lst.j?.data?.summary?.total) >= 3 && num(rowB1?.rm_lines) >= 2 && num(rowB1?.filled) === 700,
    JSON.stringify({ s: lst.s, sum: lst.j?.data?.summary, row: rowB1 && { rm: rowB1.rm_lines, f: rowB1.filled } }))
  const lstP = await api(`/wms/production/batches?warehouse_id=${WP}&pageSize=50`)
  const tP = await api(`/wms/production/tanks?warehouse_id=${WP}`)
  check('9f. Lọc theo KHO NHÀ MÁY ⇒ thấy mẻ + bồn của các kho chế biến trực thuộc', lstP.s === 200 && (lstP.j?.data?.rows ?? []).some(r => r.id === B1.id)
    && (tP.j?.data ?? []).some(t => t.id === T1.id) && (tP.j?.data ?? []).some(t => t.id === T3.id), `http=${lstP.s}/${tP.s} n=${lstP.j?.data?.rows?.length}/${tP.j?.data?.length}`)
  const cx3 = await api(`/wms/production/batches/${b3.id}/cancel`, 'POST', {})
  check('9e. Huỷ mẻ chưa rút / chưa nạp ⇒ 200', cx3.s === 200 && cx3.j?.data?.status === 'CANCELLED', `http=${cx3.s}`)
} finally {
  await cleanup()
  const left = await restAll('Warehouse', `select=id&id=in.(${WP},${WC},${WC2})`)
  check('Z. Dọn sạch fixture QA63', left.length === 0, `còn ${left.length}`)
}
finish(PACK)
