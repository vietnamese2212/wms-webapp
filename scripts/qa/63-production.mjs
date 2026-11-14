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
//   [6s] Sửa / khai bù lượng rút của trang ĐÃ ĐÓNG: tăng = rút thêm, giảm = trả về đúng mẻ, bắt lý do, trang mở ⇒ 409 (14/11 tối)
//   [6t] Cài đặt MES là cửa ghi DUY NHẤT của công tắc QA + hạn lưu bồn; cửa Loại kho của Cài đặt WMS không đè mất khai riêng
//   [10] Bàn làm việc của mẻ (14/11 đêm): định mức ⇒ yêu cầu của mẻ × kế hoạch; hàng CÓ TEM không đi đường chọn lô (MUST_SCAN);
//        bàn trả yêu cầu · đã cấp · tồn có tem / không tem; sửa yêu cầu không đụng phần đã cấp
//   [11] Báo cáo sử dụng NVL theo ca: một kho một ca mở; số dùng theo mẻ / tồn sổ khớp dữ liệu gốc; chốt ca chụp số (không đổi khi tồn đổi);
//        ca sau lấy số đếm ca trước làm tồn đầu và chỉ tính lượng dùng sau lúc chốt
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
  if (batches.length) await restWrite('batch_requirement', 'DELETE', `batch_id=in.(${batches.map(b => b.id).join(',')})`)
  await restWrite('production_shift_report', 'DELETE', `warehouse_id=in.(${whs.join(',')})`)
  await restWrite('production_recipe', 'DELETE', `material_id=in.(${[M_BTP, M_BTP2].join(',')})`)
  if (runs.length) {
    await restWrite('packing_logs', 'DELETE', `run_id=in.(${runs.map(r => r.id).join(',')})`)
    await restWrite('packing_runs', 'DELETE', `id=in.(${runs.map(r => r.id).join(',')})`)
  }
  if (batches.length) await restWrite('production_batch', 'DELETE', `id=in.(${batches.map(b => b.id).join(',')})`)
  if (tanks.length) await restWrite('production_tank', 'DELETE', `id=in.(${tanks.map(t => t.id).join(',')})`)
  await restWrite('InventoryEntry', 'DELETE', `warehouse_id=in.(${whs.join(',')})`)
  await restWrite('warehouse_type_configs', 'DELETE', `warehouse_id=in.(${whs.join(',')})`)
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
  check('4c. Lô NSX 01/11 nằm trên pallet CÓ TEM ⇒ chọn lô bị từ chối 409 MES_MUST_SCAN', c4a.s === 409 && c4a.j?.error?.code === 'MES_MUST_SCAN', `http=${c4a.s} ${c4a.j?.error?.code}`)
  const after4c = await restAll('InventoryEntry', 'select=id,cartons_remaining&id=in.(QA63_E1,QA63_E2)')
  check('4d. …và KHÔNG trừ dở dòng nào', after4c.every(e => (e.id === 'QA63_E1' ? num(e.cartons_remaining) === 10 : num(e.cartons_remaining) === 50)), JSON.stringify(after4c))
  // hàng có tem ⇒ quét từng tem (P1 lấy nốt 10, P2 lấy 15)
  const c4s1 = await api(`/wms/production/batches/${B1.id}/consume-scan`, 'POST', { entry_id: 'QA63_E1', qty: 10, qty_semantics: 'base' })
  const c4s2 = await api(`/wms/production/batches/${B1.id}/consume-scan`, 'POST', { entry_id: 'QA63_E2', qty: 15, qty_semantics: 'base' })
  // tồn gộp KHÔNG tem (mỗi NSX một dòng) ⇒ chọn lô được
  await restWrite('InventoryEntry', 'POST', null, [E('QA63_E10', 'QA63RM1', 50, WC, '2026-11-07', '2027-05-01')])
  const c4b = await api(`/wms/production/batches/${B1.id}/consume-lot`, 'POST', { material_id: M_RM, production_date: '2026-11-07', qty: 15, qty_semantics: 'base' })
  const rows4 = c4b.j?.data?.rows ?? []
  check('4e. Có tem ⇒ quét từng tem; tồn gộp không tem ⇒ chọn lô trừ đúng dòng đó',
    c4s1.s === 200 && c4s2.s === 200 && c4b.s === 200 && rows4.length === 1 && rows4[0]?.entry_id === 'QA63_E10' && num(rows4[0]?.qty) === 15, `http=${c4s1.s}/${c4s2.s}/${c4b.s} ${JSON.stringify(rows4)}`)
  const stL2 = await api(`/wms/production/stock?warehouse_id=${WC}&material_id=${M_RM}`)
  const lot0111 = (stL2.j?.data?.lots ?? []).find(l => String(l.production_date).startsWith('2026-11-01'))
  const lot0711 = (stL2.j?.data?.lots ?? []).find(l => String(l.production_date).startsWith('2026-11-07'))
  check('4e2. Tra tồn theo lô tách phần có tem / không tem', num(lot0111?.available_no_tem) === 0 && num(lot0111?.tem_pallets) >= 1 && num(lot0711?.available_no_tem) === 35 && num(lot0711?.tem_pallets) === 0,
    `0111=${lot0111?.available_no_tem}/${lot0111?.tem_pallets} 0711=${lot0711?.available_no_tem}/${lot0711?.tem_pallets}`)
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

  // ── [6+] đợt rà 14/11 (migration 20261114d): lô QA LOẠI · đúng mã lô · dòng tồn không còn trong kho ──
  const rej = await api(`/wms/production/batches/${B2.id}/qa`, 'POST', { qa_status: 'REJECTED', note: 'QA63 thử loại lô' })
  const R3 = (await api('/wms/packing-runs', 'POST', { warehouse_id: WP, material_codes: ['QA63FG3'], machine_code: 'QA63M', cycle: 'C63', tank_id: T1.id })).j?.data
  const cl4 = await api(`/wms/packing-runs/${R3.id}/close`, 'POST', { tank_qty: 10 })
  const r3now = (await restAll('packing_runs', `select=status&id=eq.${R3.id}`))[0]
  check('6i. Bồn có lô QA LOẠI ⇒ rút đóng gói 409 MES_QA_REJECTED dù công tắc chỉ CẢNH BÁO, trang vẫn mở',
    rej.s === 200 && cl4.s === 409 && cl4.j?.error?.code === 'MES_QA_REJECTED' && r3now?.status === 'OPEN', `qa=${rej.s} http=${cl4.s} ${cl4.j?.error?.code} status=${r3now?.status}`)
  const fillRej = await api(`/wms/production/tanks/${T1.id}/fill`, 'POST', { batch_id: B2.id, qty: 1 })
  check('6j. Nạp lô QA loại vào bồn ⇒ 409 MES_QA_REJECTED', fillRej.s === 409 && fillRej.j?.error?.code === 'MES_QA_REJECTED', `http=${fillRej.s} ${fillRej.j?.error?.code}`)
  await api(`/wms/production/batches/${B2.id}/qa`, 'POST', { qa_status: 'RELEASED' })
  const cl5 = await api(`/wms/packing-runs/${R3.id}/close`, 'POST', { tank_qty: 0 })   // 0 = không rút: mức bồn giữ nguyên cho các phép sau
  check('6k. QA đổi kết luận về THẢ ⇒ đóng trang được', cl5.s === 200 && cl5.j?.data?.status === 'CLOSED', `http=${cl5.s} ${JSON.stringify(cl5.j?.error ?? null)}`)
  await restWrite('InventoryEntry', 'POST', null, [
    E('QA63_E7', 'QA63_P7', 30, WC, '2026-11-20', '2027-04-01'),                          // cùng NSX, KHÔNG mã lô
    E('QA63_E8', 'QA63_P8', 50, WC, '2026-11-20', '2027-04-01', { batch: 'QA63LX' }),     // cùng NSX, CÓ mã lô
    E('QA63_E9', 'QA63_P9', 5, WC, '2026-11-21', '2027-04-01', { status: 'EXPORTED' }),   // không còn là hàng trong kho
  ].map(e => ({ batch: null, ...e })))
  const lotNull = await api(`/wms/production/batches/${B1.id}/consume-lot`, 'POST', { material_id: M_RM, production_date: '2026-11-20', qty: 40, qty_semantics: 'base' })
  const e8 = (await restAll('InventoryEntry', 'select=cartons_remaining&id=eq.QA63_E8'))[0]
  check('6l. Chọn lô KHÔNG mã lô (hàng trên tem) ⇒ 409 MES_MUST_SCAN, không ăn sang lô có mã lô cùng NSX',
    lotNull.s === 409 && lotNull.j?.error?.code === 'MES_MUST_SCAN' && num(e8?.cartons_remaining) === 50, `http=${lotNull.s} ${lotNull.j?.error?.code} e8=${e8?.cartons_remaining}`)
  const lotX = await api(`/wms/production/batches/${B1.id}/consume-scan`, 'POST', { entry_id: 'QA63_E8', qty: 40, qty_semantics: 'base' })
  const e78 = await restAll('InventoryEntry', 'select=id,cartons_remaining&id=in.(QA63_E7,QA63_E8)')
  check('6m. Quét tem lô QA63LX ⇒ trừ 40 ở tem đó, lô không mã lô giữ nguyên',
    lotX.s === 200 && num(e78.find(e => e.id === 'QA63_E8')?.cartons_remaining) === 10 && num(e78.find(e => e.id === 'QA63_E7')?.cartons_remaining) === 30, `http=${lotX.s} ${JSON.stringify(e78)}`)
  const scanGone = await api(`/wms/production/batches/${B1.id}/consume-scan`, 'POST', { entry_id: 'QA63_E9', qty: 1, qty_semantics: 'base' })
  check('6n. Quét dòng tồn không còn trong kho (EXPORTED) ⇒ 409 MES_NOT_IN_STOCK', scanGone.s === 409 && scanGone.j?.error?.code === 'MES_NOT_IN_STOCK', `http=${scanGone.s} ${scanGone.j?.error?.code}`)

  // ── [6s] sửa / khai bù lượng rút của trang ĐÃ ĐÓNG (migration 20261114e) ──
  const lotsNow = async () => { const l = await restAll('tank_lot', `select=batch_id,qty_remaining&tank_id=eq.${T1.id}&status=eq.ACTIVE`); return (b) => num(l.find(x => x.batch_id === b)?.qty_remaining) }
  const before = await lotsNow()
  const b1Before = before(B1.id), b2Before = before(B2.id)
  const rdNoReason = await api(`/wms/packing-runs/${R3.id}/tank-draw`, 'POST', { tank_qty: 45 })
  check('6o. Sửa lượng rút thiếu lý do ⇒ 400', rdNoReason.s === 400, `http=${rdNoReason.s}`)
  const rdUp = await api(`/wms/packing-runs/${R3.id}/tank-draw`, 'POST', { tank_qty: 45, reason: 'QA63 khai bù' })
  const mid = await lotsNow()
  check('6p. Trang đã đóng (rút 0) khai bù 45 ⇒ rút thêm chia theo tỷ lệ 2 mẻ, tổng bồn giảm đúng 45',
    rdUp.s === 200 && num(rdUp.j?.data?.drawn) === 45 && Math.abs((b1Before + b2Before) - (mid(B1.id) + mid(B2.id)) - 45) < 0.001 && mid(B1.id) < b1Before && mid(B2.id) < b2Before,
    `http=${rdUp.s} ${JSON.stringify(rdUp.j?.error ?? null)} ${b1Before}/${b2Before} → ${mid(B1.id)}/${mid(B2.id)}`)
  const rdDown = await api(`/wms/packing-runs/${R3.id}/tank-draw`, 'POST', { tank_qty: 0, reason: 'QA63 gõ nhầm' })
  const after = await lotsNow()
  const r3draws = (await api(`/wms/packing-runs/${R3.id}`)).j?.data?.tank_draws ?? []
  check('6q. Sửa về 0 ⇒ từng mẻ về ĐÚNG mức cũ, sổ bồn giữ dòng cũ + dòng sửa có lý do (Σ = 0)',
    rdDown.s === 200 && Math.abs(after(B1.id) - b1Before) < 0.001 && Math.abs(after(B2.id) - b2Before) < 0.001
      && r3draws.length === 4 && Math.abs(r3draws.reduce((x, d) => x + num(d.qty), 0)) < 0.001 && r3draws.filter(d => d.reason === 'QA63 gõ nhầm').length === 2,
    `http=${rdDown.s} ${after(B1.id)}/${after(B2.id)} n=${r3draws.length}`)
  const genZero = await api(`/wms/production/genealogy?kind=BATCH&value=${encodeURIComponent(B1.batch_code)}`)
  check('6r. Gia phả: trang rút thuần 0 KHÔNG còn nối vào mẻ', genZero.s === 200 && !((genZero.j?.data?.batches ?? [])[0]?.runs ?? []).some(r => r.run_id === R3.id), `http=${genZero.s}`)
  const R4 = (await api('/wms/packing-runs', 'POST', { warehouse_id: WP, material_codes: ['QA63FG4'], machine_code: 'QA63M', cycle: 'C63', tank_id: T1.id })).j?.data
  const rdOpen = await api(`/wms/packing-runs/${R4.id}/tank-draw`, 'POST', { tank_qty: 5, reason: 'QA63' })
  const rdOver = await api(`/wms/packing-runs/${R3.id}/tank-draw`, 'POST', { tank_qty: 9_000_000, reason: 'QA63 quá bồn' })
  check('6s. Trang ĐANG MỞ ⇒ 409 MES_RUN_NOT_CLOSED; khai quá lượng bồn có ⇒ 409 MES_TANK_SHORT (không rút dở)',
    rdOpen.s === 409 && rdOpen.j?.error?.code === 'MES_RUN_NOT_CLOSED' && rdOver.s === 409 && rdOver.j?.error?.code === 'MES_TANK_SHORT',
    `http=${rdOpen.s} ${rdOpen.j?.error?.code} / ${rdOver.s} ${rdOver.j?.error?.code}`)
  await api(`/wms/packing-runs/${R4.id}/cancel`, 'POST', { note: 'QA63' })

  // ── [6t] Cài đặt MES — cửa ghi DUY NHẤT của công tắc QA + hạn lưu bồn ──
  const st0 = await api(`/wms/production/settings?warehouse_id=${WC}`)
  check('6t. Cài đặt MES đọc: công tắc của kho + bảng hạn lưu bồn có mã BTP đã khai 48 giờ',
    st0.s === 200 && st0.j?.data?.production_qa_gate === 'WARN' && (st0.j?.data?.hold_hours ?? []).some(m => m.id === M_BTP && num(m.tank_hold_hours) === 48), `http=${st0.s}`)
  const stParent = await api('/wms/production/settings', 'PUT', { warehouse_id: WP, production_qa_gate: 'BLOCK' })
  const stBad = await api('/wms/production/settings', 'PUT', { warehouse_id: WC, production_qa_gate: 'XYZ' })
  check('6u. Kho không phải kho chế biến ⇒ 422; giá trị công tắc lạ ⇒ 400', stParent.s === 422 && stBad.s === 400, `http=${stParent.s}/${stBad.s}`)
  const typeCode = (await restAll('LookupValue', 'select=value&type=eq.warehouse_type&order=value&limit=1'))[0]?.value
  const tc1 = await api(`/masterdata/warehouses/${WC}/type-configs`, 'PUT', { items: [{ type_code: typeCode }] })
  const st1 = await api('/wms/production/settings', 'PUT', { warehouse_id: WC, production_qa_gate: 'BLOCK',
    types: [{ type_code: typeCode, production_qa_gate: 'OFF' }], hold_hours: [{ material_id: M_BTP2, tank_hold_hours: 24 }, { material_id: M_BTP, tank_hold_hours: null }] })
  const whRow = (await restAll('Warehouse', `select=production_qa_gate&id=eq.${WC}`))[0]
  const mats = await restAll('Material', `select=id,tank_hold_hours&id=in.(${M_BTP},${M_BTP2})`)
  check('6v. Cài đặt MES ghi: công tắc kho · khai riêng Loại kho · đặt / gỡ hạn lưu bồn — MỘT lần lưu',
    tc1.s === 200 && st1.s === 200 && whRow?.production_qa_gate === 'BLOCK' && (st1.j?.data?.types ?? []).find(t => t.type_code === typeCode)?.production_qa_gate === 'OFF'
      && num(mats.find(m => m.id === M_BTP2)?.tank_hold_hours) === 24 && mats.find(m => m.id === M_BTP)?.tank_hold_hours === null,
    `http=${tc1.s}/${st1.s} ${JSON.stringify(st1.j?.error ?? null)} wh=${whRow?.production_qa_gate}`)
  // cửa Loại kho của Cài đặt WMS lưu lại (không gửi / gửi giá trị khác) ⇒ khai riêng MES phải SỐNG — trước bản này nó ghi NULL đè
  const tc2 = await api(`/masterdata/warehouses/${WC}/type-configs`, 'PUT', { items: [{ type_code: typeCode, production_qa_gate: 'WARN' }] })
  const tcRow = (await restAll('warehouse_type_configs', `select=production_qa_gate&warehouse_id=eq.${WC}&type_code=eq.${encodeURIComponent(typeCode)}`))[0]
  check('6w. Cửa Loại kho của Cài đặt WMS không đè / không ghi được công tắc MES', tc2.s === 200 && tcRow?.production_qa_gate === 'OFF', `http=${tc2.s} gate=${tcRow?.production_qa_gate}`)
  const stUnknown = await api('/wms/production/settings', 'PUT', { warehouse_id: WC, types: [{ type_code: 'QA63_KHONG_CO', production_qa_gate: 'OFF' }] })
  check('6x. Loại kho không thuộc kho ⇒ 422, không ghi gì', stUnknown.s === 422, `http=${stUnknown.s}`)
  // trả về trạng thái các phép sau cần
  await api('/wms/production/settings', 'PUT', { warehouse_id: WC, production_qa_gate: 'WARN', types: [{ type_code: typeCode, production_qa_gate: null }],
    hold_hours: [{ material_id: M_BTP, tank_hold_hours: 48 }, { material_id: M_BTP2, tank_hold_hours: null }] })

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
  // ── [10] BÀN LÀM VIỆC CỦA MẺ: định mức → yêu cầu → cấp ──
  const rcBad = await api(`/wms/production/recipes/${M_BTP2}`, 'PUT', { base_qty: 100, lines: [{ material_id: M_BTP2, qty: 1 }] })
  const rcEa = await api(`/wms/production/recipes/${M_EA}`, 'PUT', { base_qty: 100, lines: [{ material_id: M_RM, qty: 1 }] })
  check('10a. Định mức chứa chính mã BTP ⇒ 422; mã không tính L / KG ⇒ 422', rcBad.s === 422 && rcEa.s === 422, `http=${rcBad.s}/${rcEa.s}`)
  const rcOk = await api(`/wms/production/recipes/${M_BTP2}`, 'PUT', { base_qty: 100, note: 'QA63', lines: [{ material_id: M_RM, qty: 5 }, { material_id: M_EA, qty: 2 }] })
  const rcGet = await api(`/wms/production/recipes/${M_BTP2}`)
  const rcList = await api('/wms/production/recipes')
  check('10b. Lưu định mức 2 dòng; đọc lại đủ dòng; có trong danh sách',
    rcOk.s === 200 && rcGet.s === 200 && (rcGet.j?.data?.lines ?? []).length === 2 && num(rcGet.j?.data?.base_qty) === 100 && (rcList.j?.data ?? []).some(r => r.material_id === M_BTP2),
    `http=${rcOk.s}/${rcGet.s}/${rcList.s} ${JSON.stringify(rcOk.j?.error ?? null)}`)
  const bw = await api('/wms/production/batches', 'POST', { warehouse_id: WC, material_id: M_BTP2, prod_date: todayVN, planned_qty: 300, cycle: 'C63' })
  const BW = bw.j?.data
  const bwGet = await api(`/wms/production/batches/${BW?.id}`)
  const board0 = bwGet.j?.data?.board ?? []
  const rowRm = board0.find(r => r.material_id === M_RM)
  check('10c. Mở mẻ kế hoạch 300 (cỡ chuẩn 100) ⇒ yêu cầu = định mức × 3, chu kỳ lưu, bàn có tồn tách tem / không tem',
    bw.s === 201 && num(BW?.requirement_count) === 2 && bwGet.j?.data?.cycle === 'C63' && board0.length === 2 && num(rowRm?.required) === 15 && num(rowRm?.consumed) === 0
      && num(rowRm?.available) > 0 && num(rowRm?.tem_pallets) >= 1 && num(rowRm?.available_no_tem) > 0,
    `http=${bw.s} n=${BW?.requirement_count} board=${JSON.stringify(rowRm ?? null)}`)
  const wScan = await api(`/wms/production/batches/${BW.id}/consume-scan`, 'POST', { entry_id: 'QA63_E2', qty: 6, qty_semantics: 'base' })
  const board1 = (await api(`/wms/production/batches/${BW.id}`)).j?.data?.board ?? []
  check('10d. Cấp 6 bằng quét tem ⇒ bàn: đã cấp 6 / yêu cầu 15', wScan.s === 200 && num(board1.find(r => r.material_id === M_RM)?.consumed) === 6, `http=${wScan.s}`)
  const rq1 = await api(`/wms/production/batches/${BW.id}/requirements`, 'PUT', { items: [{ material_id: M_EA, qty: 4 }] })
  const board2 = (await api(`/wms/production/batches/${BW.id}`)).j?.data?.board ?? []
  const rm2 = board2.find(r => r.material_id === M_RM), ea2 = board2.find(r => r.material_id === M_EA)
  check('10e. Sửa yêu cầu (bỏ NVL đã cấp dở) ⇒ dòng đó còn trên bàn là NGOÀI yêu cầu, phần đã cấp giữ nguyên',
    rq1.s === 200 && rm2 && rm2.required == null && num(rm2.consumed) === 6 && num(ea2?.required) === 4, `http=${rq1.s} ${JSON.stringify(rm2 ?? null)}`)
  const rqSelf = await api(`/wms/production/batches/${BW.id}/requirements`, 'PUT', { items: [{ material_id: M_BTP2, qty: 1 }] })
  const rqDup = await api(`/wms/production/batches/${BW.id}/requirements`, 'PUT', { items: [{ material_id: M_RM, qty: 1 }, { material_id: M_RM, qty: 2 }] })
  check('10f. Yêu cầu chứa chính mã BTP ⇒ 422; trùng mã ⇒ 422', rqSelf.s === 422 && rqDup.s === 422, `http=${rqSelf.s}/${rqDup.s}`)
  const apOk = await api(`/wms/production/batches/${BW.id}/apply-recipe`, 'POST', { replace: true })
  const board3 = (await api(`/wms/production/batches/${BW.id}`)).j?.data?.board ?? []
  const apNone = await api(`/wms/production/batches/${B1.id}/apply-recipe`, 'POST', {})
  check('10g. Chép lại định mức ⇒ yêu cầu về 15 / 6; mã chưa khai định mức ⇒ 409 MES_NO_RECIPE',
    apOk.s === 200 && num(board3.find(r => r.material_id === M_RM)?.required) === 15 && num(board3.find(r => r.material_id === M_EA)?.required) === 6 && apNone.s === 409 && apNone.j?.error?.code === 'MES_NO_RECIPE',
    `http=${apOk.s}/${apNone.s} ${apNone.j?.error?.code}`)
  await api(`/wms/production/batches/${BW.id}/close`, 'POST', {})
  const rqClosed = await api(`/wms/production/batches/${BW.id}/requirements`, 'PUT', { items: [] })
  check('10h. Mẻ đã đóng ⇒ sửa yêu cầu 409 MES_BATCH_NOT_OPEN', rqClosed.s === 409 && rqClosed.j?.error?.code === 'MES_BATCH_NOT_OPEN', `http=${rqClosed.s} ${rqClosed.j?.error?.code}`)

  // ── [11] BÁO CÁO SỬ DỤNG NVL THEO CA ──
  const shBad = await api('/wms/production/shift-reports', 'POST', { warehouse_id: WP, report_date: todayVN, shift: 'Ca 1' })
  const sh1 = await api('/wms/production/shift-reports', 'POST', { warehouse_id: WC, report_date: todayVN, shift: 'Ca 1' })
  const sh1b = await api('/wms/production/shift-reports', 'POST', { warehouse_id: WC, report_date: todayVN, shift: 'Ca 2' })
  const S1 = sh1.j?.data?.id
  check('11a. Mở ca ở kho không phải chế biến ⇒ 422; kho chế biến ⇒ 201; còn ca mở ⇒ 409 MES_SHIFT_OPEN',
    shBad.s === 422 && sh1.s === 201 && !!S1 && sh1b.s === 409 && sh1b.j?.error?.code === 'MES_SHIFT_OPEN', `http=${shBad.s}/${sh1.s}/${sh1b.s} ${sh1b.j?.error?.code}`)
  const rp1 = await api(`/wms/production/shift-reports/${S1}`)
  const rmRow = (rp1.j?.data?.rows ?? []).find(r => r.material_id === M_RM)
  const whBatches = await restAll('production_batch', `select=id&warehouse_id=eq.${WC}`)
  const liveRm = await restAll('batch_consumption', `select=batch_id,qty&material_id=eq.${M_RM}&reversed_at=is.null&batch_id=in.(${whBatches.map(b => b.id).join(',')})`)
  const stockRm = await restAll('InventoryEntry', `select=cartons_remaining&warehouse_id=eq.${WC}&material_id=eq.${M_RM}&status=in.(IN_STOCK,PARTIAL)`)
  const sumLive = liveRm.reduce((x, c) => x + num(c.qty), 0), sumStock = stockRm.reduce((x, e) => x + num(e.cartons_remaining), 0)
  const b1Used = liveRm.filter(c => c.batch_id === B1.id).reduce((x, c) => x + num(c.qty), 0)
  check('11b. Báo cáo ca: tổng dùng = Σ dòng cấp sống · dùng của mẻ B1 đúng · tồn sổ = tồn kho chế biến · có cột cho từng mẻ',
    rp1.s === 200 && rmRow && Math.abs(num(rmRow.used) - sumLive) < 0.001 && Math.abs(num(rmRow.by_batch?.[B1.id]) - b1Used) < 0.001 && Math.abs(num(rmRow.book) - sumStock) < 0.001
      && (rp1.j?.data?.batches ?? []).some(b => b.id === B1.id) && rp1.j?.data?.report?.status === 'OPEN',
    `http=${rp1.s} used=${rmRow?.used}/${sumLive} b1=${rmRow?.by_batch?.[B1.id]}/${b1Used} book=${rmRow?.book}/${sumStock}`)
  const actual1 = sumStock - 2
  const svNeg = await api(`/wms/production/shift-reports/${S1}`, 'PUT', { items: [{ material_id: M_RM, qty_actual: -1 }] })
  const svDraft = await api(`/wms/production/shift-reports/${S1}`, 'PUT', { items: [{ material_id: M_RM, qty_actual: actual1 }] })
  check('11c. Số đếm âm ⇒ 400; lưu nháp số đếm ⇒ 200, ca vẫn mở', svNeg.s === 400 && svDraft.s === 200 && svDraft.j?.data?.report?.status === 'OPEN'
    && num((svDraft.j?.data?.rows ?? []).find(r => r.material_id === M_RM)?.actual) === actual1, `http=${svNeg.s}/${svDraft.s}`)
  const svClose = await api(`/wms/production/shift-reports/${S1}`, 'PUT', { items: [], note: 'QA63 giao ca', close: true })
  const afterScan = await api(`/wms/production/batches/${B1.id}/consume-scan`, 'POST', { entry_id: 'QA63_E2', qty: 1, qty_semantics: 'base' })
  const rp1c = await api(`/wms/production/shift-reports/${S1}`)
  const rmClosed = (rp1c.j?.data?.rows ?? []).find(r => r.material_id === M_RM)
  check('11d. Chốt ca ⇒ CLOSED, chụp số; cấp thêm sau khi chốt KHÔNG làm đổi báo cáo đã chốt',
    svClose.s === 200 && afterScan.s === 200 && rp1c.j?.data?.report?.status === 'CLOSED' && rp1c.j?.data?.report?.note === 'QA63 giao ca'
      && Math.abs(num(rmClosed?.used) - sumLive) < 0.001 && Math.abs(num(rmClosed?.book) - sumStock) < 0.001 && num(rmClosed?.actual) === actual1,
    `http=${svClose.s}/${afterScan.s} used=${rmClosed?.used} book=${rmClosed?.book} actual=${rmClosed?.actual}`)
  const svAfter = await api(`/wms/production/shift-reports/${S1}`, 'PUT', { items: [{ material_id: M_RM, qty_actual: 1 }] })
  const sh2 = await api('/wms/production/shift-reports', 'POST', { warehouse_id: WC, report_date: todayVN, shift: 'Ca 2' })
  const rp2 = await api(`/wms/production/shift-reports/${sh2.j?.data?.id}`)
  const rm2nd = (rp2.j?.data?.rows ?? []).find(r => r.material_id === M_RM)
  check('11e. Ca đã chốt không sửa (409); ca sau: tồn đầu = số đếm ca trước, chỉ tính 1 dùng sau lúc chốt',
    svAfter.s === 409 && svAfter.j?.error?.code === 'MES_SHIFT_CLOSED' && sh2.s === 201 && num(rm2nd?.opening) === actual1 && rm2nd?.opening_src === 'COUNT'
      && num(rm2nd?.used) === 1 && num(rm2nd?.by_batch?.[B1.id]) === 1 && Math.abs(num(rm2nd?.book) - (sumStock - 1)) < 0.001,
    `http=${svAfter.s}/${sh2.s} opening=${rm2nd?.opening}(${rm2nd?.opening_src}) used=${rm2nd?.used} book=${rm2nd?.book}`)
  const shList = await api(`/wms/production/shift-reports?warehouse_id=${WC}`)
  check('11f. Danh sách báo cáo ca của kho: 2 ca, ca mở đứng đầu', shList.s === 200 && (shList.j?.data ?? []).length === 2 && shList.j?.data?.[0]?.status === 'OPEN', `http=${shList.s} n=${shList.j?.data?.length}`)

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
