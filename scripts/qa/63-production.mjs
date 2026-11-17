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
//        bàn trả yêu cầu · đã cấp · tồn có tem / không tem; sửa yêu cầu không đụng phần đã cấp;
//        sửa kế hoạch ⇒ yêu cầu nhân theo tỷ lệ, đổi mã BTP ⇒ chép định mức mã mới (C114)
//   [11] Báo cáo sử dụng NVL theo ca: một kho một ca mở; số dùng theo mẻ / tồn sổ khớp dữ liệu gốc; chốt ca chụp số (không đổi khi tồn đổi);
//        ca sau lấy số đếm ca trước làm tồn đầu và chỉ tính lượng dùng sau lúc chốt; hàng nhận GỘP vào dòng tồn cũ vẫn lên cột Nhập (C113)
//   [12] Phiếu theo dõi của mẻ (phối trộn · dịch thạch): lưu trọn nội dung, bỏ ô trống; QA xác nhận ⇒ khoá sửa + chụp mẫu, bỏ xác nhận ⇒ sửa lại được
//   [14] Chức danh chỉ có quyền Sản xuất (mở mẻ) tìm được mã hàng cho form Mở mẻ / Định mức; chức danh chỉ xem thì không (16/11)
//   [13] Mẫu phiếu là CẤU HÌNH (Cài đặt MES): tạo / sửa / ngưng mẫu; phiếu của mẻ sửa riêng cấu trúc cho lần đó (thêm lần, thêm ô) và về theo mẫu chung
//   [9] Huỷ mẻ còn dòng rút ⇒ 409; đóng / mở lại mẻ; bất biến tồn: nhập − còn = Σ rút sống
//   [16] LUỒNG CỦA MẺ (17/11): chu kỳ · số mẻ · bồn bắt buộc, mã lô = <chữ nhà máy><chu kỳ><số mẻ 4 số><mã bồn>; tạo mẻ chặn bồn thiếu chỗ /
//        khác mã; nạp sai bồn ⇒ 409; kho bật `mes_flow_gate`: chưa đủ 2 duyệt không cấp NVL, QA duyệt ⇒ phiếu khoá; tem pallet i/n;
//        đổ bồn sai bồn / sai tem / tem cũ ⇒ chặn; đổi bồn ⇒ mã lô đổi + tem mất hiệu lực; nạp bồn cần đủ tem + đủ NVL + ô bắt buộc;
//        QA đạt / không đạt ở BỒN (cửa QA ở mẻ đã gỡ)
//   [2g] "Lấy ở đâu" GOM THEO DATE (17/11): tem cùng HSD cùng vị trí = một nhóm; hàng không tem gom theo lô; hàng hết hạn chưa duyệt không xếp hạng
//   [2e] NVL HẾT HẠN (17/11 — user chốt "chặn và cho qua khi QA duyệt"): cấp ⇒ 422; gửi QA ⇒ chờ; từ chối / gửi lại / duyệt; lô không tem cùng luật
//   [2l] cửa "Không có tem" CÙNG luật luân chuyển với cửa quét (kho bắt buộc ⇒ lý do + quyền, dòng cấp ghi vết)
// Fixture QA63: kho cha QA63_PARENT + kho phụ QA63_CB (+ QA63_CB2 để thử chéo kho) · mã NVL/BTP QA63* · tem QA63_* — dọn bằng PostgREST.
import { randomUUID } from 'crypto'
import { login, api, rawFetch, restAll, restWrite, check, finish, BASE } from './lib.mjs'

const PACK = '63-production'
await login()
const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const WP = 'QA63_PARENT', WC = 'QA63_CB', WC2 = 'QA63_CB2'
const M_RM = 'QA63_RM1', M_BTP = 'QA63_BTP1', M_BTP2 = 'QA63_BTP2', M_EA = 'QA63_EA1', M_RM2 = 'QA63_RM2'
const qaX = (await restAll('QAStatus', 'select=id&code=eq.X'))[0]?.id
const ts = () => new Date().toISOString()
const JT_OPEN = 'QA63_JT_OPEN', JT_VIEW = 'QA63_JT_VIEW'
let bcrypt = null
try { bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(m => m.default ?? m) } catch { /* chưa npm i backend */ }
const num = (v) => Number(v ?? 0)

async function cleanup() {
  const whs = [WP, WC, WC2]
  const roleEmps = await restAll('Employee', 'select=id&email=like.qa63role*')
  for (const e of roleEmps) { await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${e.id}`); await restWrite('Employee', 'DELETE', `id=eq.${e.id}`) }
  await restWrite('JobTitle', 'DELETE', `id=in.(${JT_OPEN},${JT_VIEW})`)
  const runs = await restAll('packing_runs', `select=id&warehouse_id=in.(${whs.join(',')})`)
  const tanks = await restAll('production_tank', `select=id&warehouse_id=in.(${whs.join(',')})`)
  const batches = await restAll('production_batch', `select=id&warehouse_id=in.(${whs.join(',')})`)
  if (tanks.length) await restWrite('tank_movement', 'DELETE', `tank_id=in.(${tanks.map(t => t.id).join(',')})`)
  if (tanks.length) await restWrite('tank_lot', 'DELETE', `tank_id=in.(${tanks.map(t => t.id).join(',')})`)
  if (batches.length) await restWrite('batch_consumption', 'DELETE', `batch_id=in.(${batches.map(b => b.id).join(',')})`)
  if (batches.length) await restWrite('mes_expiry_approval', 'DELETE', `batch_id=in.(${batches.map(b => b.id).join(',')})`)
  if (batches.length) await restWrite('batch_pour_scan', 'DELETE', `batch_id=in.(${batches.map(b => b.id).join(',')})`)
  if (batches.length) await restWrite('batch_process_log', 'DELETE', `batch_id=in.(${batches.map(b => b.id).join(',')})`)
  await restWrite('production_process_form', 'DELETE', 'code=like.QA63*')
  if (batches.length) await restWrite('batch_requirement', 'DELETE', `batch_id=in.(${batches.map(b => b.id).join(',')})`)
  await restWrite('production_shift_report', 'DELETE', `warehouse_id=in.(${whs.join(',')})`)
  if (runs.length) {
    await restWrite('packing_logs', 'DELETE', `run_id=in.(${runs.map(r => r.id).join(',')})`)
    await restWrite('packing_runs', 'DELETE', `id=in.(${runs.map(r => r.id).join(',')})`)
  }
  if (batches.length) await restWrite('production_batch', 'DELETE', `id=in.(${batches.map(b => b.id).join(',')})`)
  // SAU mẻ (production_batch.recipe_id trỏ tới công thức, 17/11) · đủ CẢ BỐN mã: bản lỗi C117 cho khai công thức với mã NVL
  await restWrite('production_recipe', 'DELETE', `material_id=in.(${[M_RM, M_BTP, M_BTP2, M_EA].join(',')})`)
  await restWrite('Material', 'DELETE', 'material_code=eq.QA63BTPX')
  if (tanks.length) await restWrite('production_tank', 'DELETE', `id=in.(${tanks.map(t => t.id).join(',')})`)
  await restWrite('InventoryEntry', 'DELETE', `warehouse_id=in.(${whs.join(',')})`)
  await restWrite('warehouse_type_configs', 'DELETE', `warehouse_id=in.(${whs.join(',')})`)
  await restWrite('Material', 'DELETE', `id=in.(${[M_RM, M_BTP, M_BTP2, M_EA, M_RM2].join(',')})`)
  await restWrite('Warehouse', 'DELETE', `id=in.(${WC},${WC2})`)
  await restWrite('Warehouse', 'DELETE', `id=eq.${WP}`)
}

await cleanup()
try {
  // ── Fixture ──
  await restWrite('Warehouse', 'POST', null, { id: WP, code: 'QA63PARENT', name: 'QA63 — nhà máy (bộ kiểm tự dùng)', warehouse_type: 'CENTRAL', inventory_mode: 'QR', nmsx_code: 'Q', updated_at: ts() })
  await restWrite('Warehouse', 'POST', null, [
    { id: WC, code: 'QA63CB', name: 'QA63 — kho chế biến', warehouse_type: 'CENTRAL', inventory_mode: 'QR', parent_warehouse_id: WP, updated_at: ts() },
    { id: WC2, code: 'QA63CB2', name: 'QA63 — kho chế biến 2', warehouse_type: 'CENTRAL', inventory_mode: 'QR', parent_warehouse_id: WP, updated_at: ts() },
  ])
  // PostgREST đòi mọi dòng của một lô cùng bộ khoá ⇒ dựng qua một hàm có đủ cột
  // btp = cờ "Bán thành phẩm" ở Mã hàng (16/11, C117) — Sản xuất chỉ nhận mã có cờ; NVL tính KG KHÔNG còn làm BTP được
  const MAT = (id, code, desc, unit, prefix = null, hold = null, btp = false) => ({ id, material_code: code, material_description: desc, short_name: desc, base_unit: unit, batch_prefix: prefix, tank_hold_hours: hold, is_semi_finished: btp, updated_at: ts() })
  await restWrite('Material', 'POST', null, [
    MAT(M_RM, 'QA63RM1', 'QA63 NVL đường', 'KG'),
    MAT(M_BTP, 'QA63BTP1', 'QA63 dịch sữa nền', 'L', 'QD', 48, true),
    MAT(M_BTP2, 'QA63BTP2', 'QA63 dịch khác', 'L', null, null, true),
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

  // ── bồn dựng trước (17/11: mẻ chọn bồn ngay lúc tạo) — các phép 5a / 5b ở dưới đọc lại kết quả ──
  const t1 = await api('/wms/production/tanks', 'POST', { warehouse_id: WC, code: 'qa63-t1', capacity: 1000, unit: 'L' })
  const T1 = t1.j?.data
  const t1dup = await api('/wms/production/tanks', 'POST', { warehouse_id: WC, code: 'QA63-T1', capacity: 10, unit: 'L' })
  const T2 = (await api('/wms/production/tanks', 'POST', { warehouse_id: WC, code: 'QA63-T2', capacity: 500, unit: 'L' })).j?.data
  const T3 = (await api('/wms/production/tanks', 'POST', { warehouse_id: WC2, code: 'QA63-T3', capacity: 500, unit: 'L' })).j?.data
  const T4 = (await api('/wms/production/tanks', 'POST', { warehouse_id: WC, code: 'QA63-T4', capacity: 2000, unit: 'L' })).j?.data   // các mẻ M_BTP2
  const T5 = (await api('/wms/production/tanks', 'POST', { warehouse_id: WC2, code: 'QA63-T5', capacity: 500, unit: 'L' })).j?.data
  const T6 = (await api('/wms/production/tanks', 'POST', { warehouse_id: WC, code: 'QA63-T6', capacity: 500, unit: 'L' })).j?.data    // mẻ đổi mã (10j)
  const NEW = (o) => ({ warehouse_id: WC, prod_date: todayVN, cycle: 'Q1', ...o })

  // ── [1] mở mẻ ──
  const r1a = await api('/wms/production/batches', 'POST', NEW({ warehouse_id: WP, material_id: M_BTP, tank_id: T1.id }))
  check('1a. Mở mẻ ở kho KHÔNG phải kho phụ ⇒ 422 NOT_PRODUCTION_WAREHOUSE', r1a.s === 422 && r1a.j?.error?.code === 'NOT_PRODUCTION_WAREHOUSE', `http=${r1a.s} ${r1a.j?.error?.code}`)
  const r1b = await api('/wms/production/batches', 'POST', NEW({ material_id: M_EA, tank_id: T1.id }))
  check('1b. Mã tính theo EA (không phải BTP) ⇒ 422 NOT_SEMI_FINISHED', r1b.s === 422 && r1b.j?.error?.code === 'NOT_SEMI_FINISHED', `http=${r1b.s} ${r1b.j?.error?.code}`)
  // C117: NVL tính KG từng lọt làm "mã bán thành phẩm" (luật cũ chỉ xét đơn vị L / KG)
  const r1b2 = await api('/wms/production/batches', 'POST', NEW({ material_id: M_RM, tank_id: T1.id }))
  check('1b2. Mở mẻ với mã NGUYÊN LIỆU tính KG (chưa đánh dấu BTP) ⇒ 422 NOT_SEMI_FINISHED', r1b2.s === 422 && r1b2.j?.error?.code === 'NOT_SEMI_FINISHED', `http=${r1b2.s} ${r1b2.j?.error?.code}`)
  const r1g = await api('/wms/production/batches', 'POST', { warehouse_id: WC, material_id: M_BTP, prod_date: todayVN })
  check('1g. Mở mẻ thiếu chu kỳ / bồn ⇒ 400 (17/11: bắt buộc)', r1g.s === 400, `http=${r1g.s}`)
  const nc = await api(`/wms/production/batches/next-code?warehouse_id=${WC}&cycle=q1&tank_id=${T1.id}`)
  check('1c. Gợi ý: chữ nhà máy lấy ở kho CHA (Q) · số mẻ kế tiếp 1 · mã lô = Q + Q1 + 0001 + mã bồn', nc.s === 200 && nc.j?.data?.plant === 'Q' && nc.j?.data?.next_no === 1 && nc.j?.data?.code === 'QQ10001QA63-T1',
    `http=${nc.s} ${JSON.stringify(nc.j?.data ?? null)}`)
  const b1 = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP, tank_id: T1.id, machine_code: 'T1', planned_qty: 1000 }))
  const B1 = b1.j?.data
  check('1d. Mở mẻ không gõ số mẻ ⇒ 201, mã lô tự ghép, số mẻ 1, QA mặc định HOLD', b1.s === 201 && B1?.batch_code === 'QQ10001QA63-T1' && B1?.batch_no === 1 && B1?.tank_id === T1.id && B1?.qa_status === 'HOLD', `http=${b1.s} ${JSON.stringify(b1.j?.error ?? null)} ${B1?.batch_code}`)
  const b2 = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP, tank_id: T1.id, machine_code: 'T1' }))
  const B2 = b2.j?.data
  check('1e. Mẻ thứ hai cùng chu kỳ ⇒ số mẻ kế 2', b2.s === 201 && B2?.batch_code === 'QQ10002QA63-T1' && B2?.batch_no === 2, `code=${B2?.batch_code}`)
  const dup = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP, tank_id: T1.id, batch_no: 1 }))
  check('1f. Gõ số mẻ đã có trong chu kỳ ⇒ 409 BATCH_NO_DUP', dup.s === 409 && dup.j?.error?.code === 'BATCH_NO_DUP', `http=${dup.s} ${dup.j?.error?.code}`)
  const over = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP, tank_id: T1.id, planned_qty: 1 }))
  check('1h. Bồn 1.000 đã đặt đủ cho mẻ 1 (kế hoạch 1.000) ⇒ mẻ có kế hoạch nữa bị 409 MES_OVER_CAPACITY', over.s === 409 && over.j?.error?.code === 'MES_OVER_CAPACITY', `http=${over.s} ${over.j?.error?.code}`)

  // ── [2] tra tem ──
  const s2a = await api(`/wms/production/batches/${B1.id}/scan-check?code=QA63_P1`)
  check('2a. Quét tem còn tồn ở kho của mẻ ⇒ 200 kèm mã + tồn', s2a.s === 200 && s2a.j?.data?.id === 'QA63_E1' && num(s2a.j?.data?.cartons_remaining) === 100, `http=${s2a.s}`)
  const s2b = await api(`/wms/production/batches/${B1.id}/scan-check?code=QA63_P4`)
  check('2b. Tem ở kho khác ⇒ 404 nói đúng tên kho đang giữ', s2b.s === 404 && /QA63 — nhà máy/.test(s2b.j?.error?.message ?? ''), `http=${s2b.s} ${s2b.j?.error?.message}`)
  const s2c = await api(`/wms/production/batches/${B1.id}/scan-check?code=QA63RM1`)
  check('2c. Mã tồn gộp nhiều lô ⇒ 409 POOLED_CODE', s2c.s === 409 && s2c.j?.error?.code === 'POOLED_CODE', `http=${s2c.s}`)

  // ── [2r] CẤP NVL = MỘT LOẠI XUẤT (17/11): "lấy ở đâu" + luân chuyển cùng luật quét xuất ──
  // mẻ RIÊNG cho phần này (cấp rồi trả lại) — không làm lệch số dòng cấp của mẻ 1 mà các phép sau đếm
  const BR = (await api('/wms/production/batches', 'POST', NEW({ cycle: 'QR', material_id: M_BTP, tank_id: T1.id }))).j?.data
  const pk = await api(`/wms/production/batches/${BR.id}/pick-list?material_id=${M_RM}`)
  const tg = pk.j?.data?.tem_groups ?? [], lg = pk.j?.data?.lot_groups ?? []
  const ids = g => (g?.items ?? []).map(i => i.entry_id)
  check('2r1. Lấy ở đâu (gom theo date): nhóm tem HSD sớm nhất (P1) hạng 1, nhóm QA giữ (P3) không xếp hạng và xuống cuối, tem kho khác (P4) không có; hàng không tem gom theo lô',
    pk.s === 200 && pk.j?.data?.principle === 'FEFO' && ids(tg[0]).join() === 'QA63_E1' && tg[0]?.rank === 1
      && tg[tg.length - 1]?.state === 'QA' && ids(tg[tg.length - 1]).join() === 'QA63_E3' && tg[tg.length - 1]?.rank === null
      && !tg.some(g => ids(g).includes('QA63_E4')) && typeof tg[0]?.pct_date === 'number'
      && lg.length === 2 && lg.every(g => g.kind === 'LOT' && g.state === 'OK' && typeof g.rank === 'number'),
    `http=${pk.s} tem=${JSON.stringify(tg.map(g => [ids(g), g.rank, g.state]))} lot=${JSON.stringify(lg.map(g => [g.production_date, g.rank, g.state]))}`)
  const sOk = await api(`/wms/production/batches/${BR.id}/scan-check?code=QA63_P1`)
  const sLate = await api(`/wms/production/batches/${BR.id}/scan-check?code=QA63_P2`)
  check('2r2. Quét tem HSD sớm nhất ⇒ đúng thứ tự; tem HSD muộn hơn ⇒ sai thứ tự, chỉ đúng tem P1 phải dùng trước (kho không bắt buộc)',
    sOk.s === 200 && sOk.j?.data?.rotation?.violation === false && typeof sOk.j?.data?.pct_date === 'number'
      && sLate.s === 200 && sLate.j?.data?.rotation?.violation === true && sLate.j?.data?.rotation?.best_pallet_code === 'QA63_P1' && sLate.j?.data?.rotation?.required === false,
    `ok=${JSON.stringify(sOk.j?.data?.rotation ?? null)} late=${JSON.stringify(sLate.j?.data?.rotation ?? null)}`)
  await restWrite('Warehouse', 'PATCH', `id=eq.${WC}`, { rotation_required: true, updated_at: ts() })
  const rNo = await api(`/wms/production/batches/${BR.id}/consume-scan`, 'POST', { entry_id: 'QA63_E2', qty: 1, qty_semantics: 'base' })
  const rYes = await api(`/wms/production/batches/${BR.id}/consume-scan`, 'POST', { entry_id: 'QA63_E2', qty: 1, qty_semantics: 'base', rotation_override_reason: 'BLOCKED' })
  await restWrite('Warehouse', 'PATCH', `id=eq.${WC}`, { rotation_required: false, updated_at: ts() })
  const rRow = rYes.j?.data?.rows?.[0]?.id ? (await restAll('batch_consumption', `select=rotation_violation,rotation_principle,rotation_best_date,rotation_override_reason&id=eq.${rYes.j.data.rows[0].id}`))[0] : null
  check('2r3. Kho bật "bắt buộc lấy đúng thứ tự": cấp tem sai thứ tự thiếu lý do ⇒ 422 ROTATION_REASON_REQUIRED; có lý do ⇒ cấp được, dòng cấp ghi vết (sai thứ tự · FEFO · HSD tem đúng · lý do)',
    rNo.s === 422 && rNo.j?.error?.code === 'ROTATION_REASON_REQUIRED' && rYes.s === 200 && rRow?.rotation_violation === true
      && rRow?.rotation_principle === 'FEFO' && rRow?.rotation_best_date === '2027-01-01' && rRow?.rotation_override_reason === 'BLOCKED',
    `http=${rNo.s}/${rYes.s} ${rNo.j?.error?.code} row=${JSON.stringify(rRow)}`)
  // trả lại 1 KG cho các phép sau (tồn P2 = 50)
  if (rYes.j?.data?.rows?.[0]?.id) await api(`/wms/production/consumption/${rYes.j.data.rows[0].id}/reverse`, 'POST', { reason: 'QA63 trả lại phép 2r3' })
  const okRow = (await api(`/wms/production/batches/${BR.id}/consume-scan`, 'POST', { entry_id: 'QA63_E1', qty: 1, qty_semantics: 'base' })).j?.data?.rows?.[0]
  const okRec = okRow?.id ? (await restAll('batch_consumption', `select=rotation_violation&id=eq.${okRow.id}`))[0] : null
  if (okRow?.id) await api(`/wms/production/consumption/${okRow.id}/reverse`, 'POST', { reason: 'QA63 trả lại phép 2r4' })
  const e2back = (await restAll('InventoryEntry', 'select=cartons_remaining&id=in.(QA63_E1,QA63_E2)&order=id'))
  check('2r4. Cấp đúng thứ tự ⇒ dòng cấp ghi rotation_violation = false; trả lại ⇒ tồn P1 100 · P2 50 như trước',
    okRec?.rotation_violation === false && num(e2back[0]?.cartons_remaining) === 100 && num(e2back[1]?.cartons_remaining) === 50,
    `rec=${JSON.stringify(okRec)} tồn=${JSON.stringify(e2back)}`)

  // ── [2g] [2e] [2l] — mã RIÊNG QA63RM2 trên mẻ BR (trả lại hết rồi huỷ mẻ): không đụng số của các phép sau ──
  await restWrite('Material', 'POST', null, [MAT(M_RM2, 'QA63RM2', 'QA63 NVL sữa bột', 'KG')])
  const X = (id, pallet, qty, nsx, exp, lot) => ({ ...E(id, pallet, qty, WC, nsx, exp), material_id: M_RM2, batch: lot })
  await restWrite('InventoryEntry', 'POST', null, [
    X('QA63_X1', 'QA63_X1', 30, '2025-01-01', '2025-06-01', null),    // tem HẾT HẠN
    X('QA63_X2', 'QA63_X2', 20, '2026-10-01', '2027-10-01', null),    // hai tem cùng HSD, cùng (không) vị trí ⇒ một nhóm
    X('QA63_X3', 'QA63_X3', 10, '2026-10-01', '2027-10-01', null),
    X('QA63_X4', 'QA63RM2', 15, '2025-02-01', '2025-07-01', 'L1'),    // lô KHÔNG tem hết hạn
    X('QA63_X5', 'QA63RM2', 25, '2026-10-05', '2027-10-05', 'L2'),    // lô không tem còn hạn — HSD muộn hơn tem X2/X3
  ])
  const pg2 = await api(`/wms/production/batches/${BR.id}/pick-list?material_id=${M_RM2}`)
  const tg2 = pg2.j?.data?.tem_groups ?? [], lg2 = pg2.j?.data?.lot_groups ?? []
  const okTem = tg2.find(g => g.state === 'OK'), expTem = tg2.find(g => g.state === 'EXPIRED')
  const lotL1 = lg2.find(g => g.batch_lot === 'L1'), lotL2 = lg2.find(g => g.batch_lot === 'L2')
  check('2g1. Gom theo date: hai tem cùng HSD cùng vị trí (X2, X3) là MỘT nhóm hạng 1 (2 tem · 30 KG); tem hết hạn (X1) KHÔNG xếp hạng — FEFO không bắt lấy hàng hết hạn trước',
    pg2.s === 200 && okTem?.rank === 1 && okTem?.count === 2 && num(okTem?.available) === 30 && JSON.stringify(ids(okTem).sort()) === '["QA63_X2","QA63_X3"]'
      && expTem?.rank === null && expTem?.expired === true && ids(expTem).join() === 'QA63_X1' && pg2.j?.data?.best?.kind === 'TEM' && pg2.j?.data?.best?.pallet_code === 'QA63_X2',
    `http=${pg2.s} tem=${JSON.stringify(tg2.map(g => [ids(g), g.rank, g.state, g.count]))} best=${JSON.stringify(pg2.j?.data?.best ?? null)}`)
  check('2g2. Hàng không tem gom theo LÔ: lô L2 cấp được nhưng SAI thứ tự (còn tem HSD sớm hơn); lô L1 hết hạn chưa duyệt — không xếp hạng',
    lotL2?.state === 'OK' && lotL2?.violation === true && typeof lotL2?.rank === 'number' && lotL1?.state === 'EXPIRED' && lotL1?.rank === null && lotL1?.expired === true,
    `lot=${JSON.stringify(lg2.map(g => [g.batch_lot, g.state, g.rank, g.violation]))}`)
  const sx1 = await api(`/wms/production/batches/${BR.id}/scan-check?code=QA63_X1`)
  const sx2 = await api(`/wms/production/batches/${BR.id}/scan-check?code=QA63_X2`)
  check('2e1. Quét tem hết hạn ⇒ tra được, báo hết hạn + HSD, chưa có duyệt; quét tem còn hạn sớm nhất ⇒ ĐÚNG thứ tự (tem hết hạn không là "phải dùng trước")',
    sx1.s === 200 && sx1.j?.data?.expiry?.expired === true && sx1.j?.data?.expiry?.expiry_date === '2025-06-01' && sx1.j?.data?.expiry?.approval === null
      && sx2.s === 200 && sx2.j?.data?.rotation?.violation === false && sx2.j?.data?.expiry?.expired === false,
    `x1=${JSON.stringify(sx1.j?.data?.expiry ?? sx1.j?.error ?? null)} x2=${JSON.stringify(sx2.j?.data?.rotation ?? null)}`)
  const consX1 = () => api(`/wms/production/batches/${BR.id}/consume-scan`, 'POST', { entry_id: 'QA63_X1', qty: 5, qty_semantics: 'base' })
  const reqX = (entry_id) => api(`/wms/production/batches/${BR.id}/expiry-approvals`, 'POST', { entry_id })
  const decX = (body) => api(`/wms/production/batches/${BR.id}/expiry-approvals/decide`, 'POST', body)
  const cx1 = await consX1()
  const rqX1 = await reqX('QA63_X1')
  const cx2 = await consX1()
  const rqOk = await reqX('QA63_X2')
  check('2e2. Cấp tem hết hạn chưa duyệt ⇒ 422 MES_EXPIRED; gửi QA duyệt ⇒ CHỜ, vẫn 422; gửi duyệt tem CÒN hạn ⇒ 422 MES_NOT_EXPIRED',
    cx1.s === 422 && cx1.j?.error?.code === 'MES_EXPIRED' && rqX1.s === 200 && rqX1.j?.data?.status === 'PENDING'
      && cx2.s === 422 && cx2.j?.error?.code === 'MES_EXPIRED' && rqOk.s === 422 && rqOk.j?.error?.code === 'MES_NOT_EXPIRED',
    `http=${cx1.s}/${rqX1.s}/${cx2.s}/${rqOk.s} ${cx1.j?.error?.code} ${rqX1.j?.data?.status} ${rqOk.j?.error?.code}`)
  const dNo = await decX({ entry_id: 'QA63_X1', decision: 'APPROVED' })
  const dRej = await decX({ entry_id: 'QA63_X1', decision: 'REJECTED', note: 'QA63 vi sinh không đạt' })
  const cxRej = await consX1()
  const rq2 = await reqX('QA63_X1')
  const dOk = await decX({ entry_id: 'QA63_X1', decision: 'APPROVED', note: 'QA63 kiểm lại đạt' })
  const cx4 = await consX1()
  const cx4row = cx4.j?.data?.rows?.[0]?.id ? (await restAll('batch_consumption', `select=expiry_approval_id&id=eq.${cx4.j.data.rows[0].id}`))[0] : null
  check('2e3. QA duyệt thiếu căn cứ ⇒ 400; từ chối ⇒ cấp 422 MES_EXPIRED_REJECTED; gửi lại ⇒ chờ; QA duyệt ⇒ cấp được, dòng cấp mang id dòng duyệt',
    dNo.s === 400 && dRej.s === 200 && dRej.j?.data?.status === 'REJECTED' && cxRej.s === 422 && cxRej.j?.error?.code === 'MES_EXPIRED_REJECTED'
      && rq2.j?.data?.status === 'PENDING' && dOk.s === 200 && dOk.j?.data?.status === 'APPROVED' && cx4.s === 200 && !!cx4row?.expiry_approval_id && cx4row.expiry_approval_id === dOk.j?.data?.id,
    `http=${dNo.s}/${dRej.s}/${cxRej.s}/${dOk.s}/${cx4.s} ${cxRej.j?.error?.code} row=${JSON.stringify(cx4row)}`)
  const bdx = await api(`/wms/production/batches/${BR.id}`)
  const pg3 = await api(`/wms/production/batches/${BR.id}/pick-list?material_id=${M_RM2}`)
  const x1g = (pg3.j?.data?.tem_groups ?? []).find(g => ids(g).includes('QA63_X1'))
  check('2e4. Trang mẻ có dòng duyệt (đã duyệt · căn cứ); tem đã được duyệt vào lại thứ tự — hạng 1 (HSD sớm nhất), vẫn ghi "hết hạn"',
    (bdx.j?.data?.expiry_approvals ?? []).some(a => a.entry_id === 'QA63_X1' && a.status === 'APPROVED' && a.note === 'QA63 kiểm lại đạt' && !!a.decided_by_name)
      && x1g?.state === 'OK' && x1g?.rank === 1 && x1g?.expired === true,
    `appr=${JSON.stringify((bdx.j?.data?.expiry_approvals ?? []).map(a => [a.entry_id, a.status]))} x1=${JSON.stringify(x1g && [x1g.state, x1g.rank, x1g.expired])}`)
  const consL = (lot, nsx, extra = {}) => api(`/wms/production/batches/${BR.id}/consume-lot`, 'POST', { material_id: M_RM2, production_date: nsx, batch_lot: lot, qty: 5, qty_semantics: 'base', ...extra })
  const el1 = await consL('L1', '2025-02-01')
  const dl1 = await decX({ material_id: M_RM2, production_date: '2025-02-01', batch_lot: 'L1', decision: 'APPROVED', note: 'QA63 lô kiểm đạt' })
  const el2 = await consL('L1', '2025-02-01')
  const el2row = el2.j?.data?.rows?.[0]?.id ? (await restAll('batch_consumption', `select=expiry_approval_id,source&id=eq.${el2.j.data.rows[0].id}`))[0] : null
  check('2e5. Lô KHÔNG tem hết hạn ⇒ cấp 422 MES_EXPIRED; QA duyệt thẳng lô (chưa có yêu cầu) ⇒ cấp được, dòng cấp mang id dòng duyệt',
    el1.s === 422 && el1.j?.error?.code === 'MES_EXPIRED' && dl1.s === 200 && dl1.j?.data?.status === 'APPROVED' && dl1.j?.data?.entry_id === null
      && el2.s === 200 && el2row?.source === 'LOT' && el2row?.expiry_approval_id === dl1.j?.data?.id,
    `http=${el1.s}/${dl1.s}/${el2.s} ${el1.j?.error?.code} row=${JSON.stringify(el2row)}`)
  await restWrite('Warehouse', 'PATCH', `id=eq.${WC}`, { rotation_required: true, updated_at: ts() })
  const ll1 = await consL('L2', '2026-10-05')
  const ll2 = await consL('L2', '2026-10-05', { rotation_override_reason: 'BLOCKED' })
  await restWrite('Warehouse', 'PATCH', `id=eq.${WC}`, { rotation_required: false, updated_at: ts() })
  const llRow = ll2.j?.data?.rows?.[0]?.id ? (await restAll('batch_consumption', `select=rotation_violation,rotation_principle,rotation_override_reason,source&id=eq.${ll2.j.data.rows[0].id}`))[0] : null
  check('2l1. Cửa "Không có tem" CÙNG luật luân chuyển với cửa quét: kho bắt buộc + lô sai thứ tự ⇒ thiếu lý do 422 ROTATION_REASON_REQUIRED; có lý do ⇒ cấp được, dòng LOT ghi vết sai thứ tự + lý do',
    ll1.s === 422 && ll1.j?.error?.code === 'ROTATION_REASON_REQUIRED' && ll2.s === 200
      && llRow?.source === 'LOT' && llRow?.rotation_violation === true && llRow?.rotation_principle === 'FEFO' && llRow?.rotation_override_reason === 'BLOCKED',
    `http=${ll1.s}/${ll2.s} ${ll1.j?.error?.code} row=${JSON.stringify(llRow)}`)
  for (const c of await restAll('batch_consumption', `select=id&batch_id=eq.${BR.id}&reversed_at=is.null`))
    await api(`/wms/production/consumption/${c.id}/reverse`, 'POST', { reason: 'QA63 trả lại phép 2e' })
  const xBack = await restAll('InventoryEntry', `select=id,cartons_remaining&material_id=eq.${M_RM2}&order=id`)
  check('2e6. Trả lại mọi dòng cấp ⇒ tồn mã QA63RM2 về đúng như nạp (30 · 20 · 10 · 15 · 25)',
    JSON.stringify(xBack.map(r => num(r.cartons_remaining))) === '[30,20,10,15,25]', `tồn=${JSON.stringify(xBack)}`)

  if (BR?.id) await api(`/wms/production/batches/${BR.id}/cancel`, 'POST', {})

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
  check('5a. Tạo bồn ⇒ 201, mã chuẩn hoá hoa', t1.s === 201 && T1?.code === 'QA63-T1', `http=${t1.s}`)
  check('5b. Trùng mã bồn trong kho ⇒ 409 TANK_DUP', t1dup.s === 409 && t1dup.j?.error?.code === 'TANK_DUP', `http=${t1dup.s}`)
  const f1 = await api(`/wms/production/tanks/${T1.id}/fill`, 'POST', { batch_id: B1.id, qty: 600 })
  const f2 = await api(`/wms/production/tanks/${T1.id}/fill`, 'POST', { batch_id: B2.id, qty: 400 })
  check('5c. Nạp 600 (mẻ 1) + 400 (mẻ 2) vào bồn 1000 L', f1.s === 200 && f2.s === 200, `http=${f1.s}/${f2.s} ${f1.j?.error?.message ?? ''}`)
  const f3 = await api(`/wms/production/tanks/${T1.id}/fill`, 'POST', { batch_id: B1.id, qty: 1 })
  check('5d. Nạp thêm khi đầy ⇒ 409 MES_OVER_CAPACITY', f3.s === 409 && f3.j?.error?.code === 'MES_OVER_CAPACITY', `http=${f3.s}`)
  const b3 = (await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP2, tank_id: T4.id }))).j?.data
  // bồn 2 nhận một mẻ M_BTP riêng (17/11: một mẻ chỉ vào ĐÚNG bồn đã đặt — không còn nạp mẻ 1 sang bồn 2)
  const B1b = (await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP, tank_id: T2.id, planned_qty: 100 }))).j?.data
  const f1b = await api(`/wms/production/tanks/${T2.id}/fill`, 'POST', { batch_id: B1b?.id, qty: 100 })
  const f4 = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP2, tank_id: T2.id }))
  check('5e. Đặt mẻ mã BTP KHÁC vào bồn đang chứa mã khác ⇒ 409 MES_MIX_MATERIAL (chặn ngay lúc tạo mẻ)', f1b.s === 200 && f4.s === 409 && f4.j?.error?.code === 'MES_MIX_MATERIAL', `http=${f1b.s}/${f4.s} ${f4.j?.error?.code}`)
  const fWrong = await api(`/wms/production/tanks/${T2.id}/fill`, 'POST', { batch_id: b3.id, qty: 10 })
  check('5e2. Nạp mẻ vào bồn KHÁC bồn đã đặt ⇒ 409 MES_WRONG_TANK', fWrong.s === 409 && fWrong.j?.error?.code === 'MES_WRONG_TANK', `http=${fWrong.s} ${fWrong.j?.error?.code}`)
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
  const qaOld = await api(`/wms/production/batches/${B1.id}/qa`, 'POST', { qa_status: 'RELEASED' })
  const qaRej = await api(`/wms/production/tanks/${T1.id}/qa`, 'POST', { qa_status: 'REJECTED' })
  const qaEmpty = await api(`/wms/production/tanks/${T4.id}/qa`, 'POST', { qa_status: 'RELEASED' })
  const qa1 = await api(`/wms/production/tanks/${T1.id}/qa`, 'POST', { qa_status: 'RELEASED' })
  const qaNow = await restAll('production_batch', `select=id,qa_status&id=in.(${B1.id},${B2.id},${B1b.id})`)
  check('6f. QA ĐẠT bấm ở BỒN ⇒ cả 2 mẻ trong bồn 1 thành RELEASED, mẻ ở bồn khác không đổi; không đạt thiếu lý do ⇒ 422; bồn trống ⇒ 409; cửa QA ở mẻ đã gỡ (404)',
    qa1.s === 200 && num(qa1.j?.data?.batches) === 2 && qaRej.s === 422 && qaEmpty.s === 409 && qaEmpty.j?.error?.code === 'MES_TANK_EMPTY' && qaOld.s === 404
      && qaNow.find(x => x.id === B1.id)?.qa_status === 'RELEASED' && qaNow.find(x => x.id === B2.id)?.qa_status === 'RELEASED' && qaNow.find(x => x.id === B1b.id)?.qa_status === 'HOLD',
    `http=${qa1.s}/${qaRej.s}/${qaEmpty.s}/${qaOld.s} ${JSON.stringify(qaNow)}`)
  const cl3 = await api(`/wms/packing-runs/${R2.id}/close`, 'POST', { tank_qty: 50 })
  check('6g. Thả QA xong đóng được, không cảnh báo', cl3.s === 200 && (cl3.j?.data?.tank_warnings ?? []).length === 0, `http=${cl3.s} ${JSON.stringify(cl3.j?.error ?? null)}`)
  const runGet = await api(`/wms/packing-runs/${R1.id}`)
  check('6h. Chi tiết trang sổ kèm bồn + 2 lần rút (theo 2 mẻ)', runGet.s === 200 && runGet.j?.data?.tank?.id === T1.id && (runGet.j?.data?.tank_draws ?? []).length === 2, `n=${runGet.j?.data?.tank_draws?.length}`)
  await restWrite('Warehouse', 'PATCH', `id=eq.${WC}`, { production_qa_gate: 'WARN', updated_at: ts() })

  // ── [6+] đợt rà 14/11 (migration 20261114d): lô QA LOẠI · đúng mã lô · dòng tồn không còn trong kho ──
  const rej = await api(`/wms/production/tanks/${T1.id}/qa`, 'POST', { qa_status: 'REJECTED', note: 'QA63 thử loại lô' })
  const R3 = (await api('/wms/packing-runs', 'POST', { warehouse_id: WP, material_codes: ['QA63FG3'], machine_code: 'QA63M', cycle: 'C63', tank_id: T1.id })).j?.data
  const cl4 = await api(`/wms/packing-runs/${R3.id}/close`, 'POST', { tank_qty: 10 })
  const r3now = (await restAll('packing_runs', `select=status&id=eq.${R3.id}`))[0]
  check('6i. Bồn có lô QA LOẠI ⇒ rút đóng gói 409 MES_QA_REJECTED dù công tắc chỉ CẢNH BÁO, trang vẫn mở',
    rej.s === 200 && cl4.s === 409 && cl4.j?.error?.code === 'MES_QA_REJECTED' && r3now?.status === 'OPEN', `qa=${rej.s} http=${cl4.s} ${cl4.j?.error?.code} status=${r3now?.status}`)
  const fillRej = await api(`/wms/production/tanks/${T1.id}/fill`, 'POST', { batch_id: B2.id, qty: 1 })
  check('6j. Nạp lô QA loại vào bồn ⇒ 409 MES_QA_REJECTED', fillRej.s === 409 && fillRej.j?.error?.code === 'MES_QA_REJECTED', `http=${fillRej.s} ${fillRej.j?.error?.code}`)
  await api(`/wms/production/tanks/${T1.id}/qa`, 'POST', { qa_status: 'RELEASED' })
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
  const stRm = await api('/wms/production/settings', 'PUT', { warehouse_id: WC, hold_hours: [{ material_id: M_RM, tank_hold_hours: 24 }] })
  const stRmNull = await api('/wms/production/settings', 'PUT', { warehouse_id: WC, hold_hours: [{ material_id: M_RM, tank_hold_hours: null }] })
  check('6y. Khai hạn lưu bồn cho mã NGUYÊN LIỆU ⇒ 422 NOT_SEMI_FINISHED; gỡ hạn (null) thì mã nào cũng được (C117)',
    stRm.s === 422 && stRm.j?.error?.code === 'NOT_SEMI_FINISHED' && stRmNull.s === 200, `http=${stRm.s} ${stRm.j?.error?.code} / ${stRmNull.s}`)
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
  const RC = (material_id, name, lines, extra = {}) => api('/wms/production/recipes', 'POST', { material_id, name, base_qty: 100, lines, ...extra })
  const rcBad = await RC(M_BTP2, 'QA63 tự chứa', [{ material_id: M_BTP2, qty: 1 }])
  const rcEa = await RC(M_EA, 'QA63 EA', [{ material_id: M_RM, qty: 1 }])
  const rcRm = await RC(M_RM, 'QA63 NVL', [{ material_id: M_EA, qty: 1 }])
  check('10a. Định mức chứa chính mã BTP ⇒ 422; mã EA ⇒ 422; mã NGUYÊN LIỆU tính KG ⇒ 422 NOT_SEMI_FINISHED (C117)',
    rcBad.s === 422 && rcEa.s === 422 && rcRm.s === 422 && rcRm.j?.error?.code === 'NOT_SEMI_FINISHED', `http=${rcBad.s}/${rcEa.s}/${rcRm.s} ${rcRm.j?.error?.code}`)
  const rcOk = await RC(M_BTP2, 'Chuẩn', [{ material_id: M_RM, qty: 5 }, { material_id: M_EA, qty: 2 }], { note: 'QA63' })
  const RCP1 = rcOk.j?.data?.id
  const rcGet = await api(`/wms/production/recipes/${RCP1}`)
  const rcList = await api('/wms/production/recipes')
  check('10b. Lưu định mức 2 dòng; đọc lại đủ dòng; có trong danh sách',
    rcOk.s === 201 && rcOk.j?.data?.is_default === true && rcGet.s === 200 && (rcGet.j?.data?.lines ?? []).length === 2 && num(rcGet.j?.data?.base_qty) === 100 && (rcList.j?.data ?? []).some(r => r.material_id === M_BTP2),
    `http=${rcOk.s}/${rcGet.s}/${rcList.s} ${JSON.stringify(rcOk.j?.error ?? null)}`)
  const bw = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP2, planned_qty: 300, cycle: 'C63', tank_id: T4.id }))
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
  const rq1 = await api(`/wms/production/batches/${BW.id}/requirements`, 'PUT', { reason: 'QA63 bỏ NVL đang cấp dở', items: [{ material_id: M_EA, qty: 4 }] })
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
  // ── [10k] NHIỀU CÔNG THỨC / mã + PHIẾU CỦA MẺ GIỮ ĐỊNH MỨC GỐC (17/11 — phiếu chế biến giấy SC CĐ Long Thành) ──
  const rc2 = await RC(M_BTP2, 'QA63 bản 2', [{ material_id: M_RM, qty: 8, tol_pct: 2 }], { is_default: true })
  const RCP2 = rc2.j?.data?.id
  const rcDupName = await RC(M_BTP2, 'qa63 BẢN 2', [{ material_id: M_RM, qty: 1 }])
  const rl = await api(`/wms/production/recipes?material_id=${M_BTP2}`)
  const defs = (rl.j?.data ?? []).filter(r => r.is_default).map(r => r.id)
  check('10k. Một mã BTP có 2 công thức; đặt mặc định công thức mới ⇒ đúng MỘT mặc định; trùng tên (khác hoa thường) ⇒ 409 MES_DUPLICATE_NAME',
    rc2.s === 201 && (rl.j?.data ?? []).length === 2 && defs.length === 1 && defs[0] === RCP2 && rcDupName.s === 409 && rcDupName.j?.error?.code === 'MES_DUPLICATE_NAME',
    `http=${rc2.s}/${rl.s}/${rcDupName.s} defs=${JSON.stringify(defs)} ${rcDupName.j?.error?.code}`)
  const bv = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP2, planned_qty: 200, recipe_id: RCP1, tank_id: T4.id }))
  const BV = bv.j?.data
  const bvGet = (await api(`/wms/production/batches/${BV?.id}`)).j?.data
  const bvRm = (bvGet?.board ?? []).find(r => r.material_id === M_RM)
  const bvMis = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP, recipe_id: RCP1, tank_id: T2.id }))
  check('10l. Mở mẻ chọn công thức KHÔNG mặc định ⇒ phiếu theo đúng công thức đó (× 2), gốc = yêu cầu; công thức của mã khác ⇒ 422 MES_RECIPE_MISMATCH',
    bv.s === 201 && bvGet?.recipe?.id === RCP1 && num(bvRm?.required) === 10 && num(bvRm?.standard) === 10 && bvMis.s === 422 && bvMis.j?.error?.code === 'MES_RECIPE_MISMATCH',
    `http=${bv.s}/${bvMis.s} recipe=${bvGet?.recipe?.name} rm=${JSON.stringify(bvRm ?? null)}`)
  const bvNoReason = await api(`/wms/production/batches/${BV?.id}/requirements`, 'PUT', { items: [{ material_id: M_RM, qty: 11 }, { material_id: M_EA, qty: 4 }] })
  const bvEdit = await api(`/wms/production/batches/${BV?.id}/requirements`, 'PUT', { reason: 'QA63 đường ẩm', items: [{ material_id: M_RM, qty: 11 }] })
  const bvB = (await api(`/wms/production/batches/${BV?.id}`)).j?.data?.board ?? []
  const vRm = bvB.find(r => r.material_id === M_RM), vEa = bvB.find(r => r.material_id === M_EA)
  check('10m. Sửa định mức của mẻ: thiếu lý do ⇒ 422 MES_REASON; có lý do ⇒ yêu cầu 11 mà GỐC vẫn 10 + lý do; bỏ dòng công thức ⇒ còn "đã bỏ" giữ gốc 4',
    bvNoReason.s === 422 && bvNoReason.j?.error?.code === 'MES_REASON' && bvEdit.s === 200 && num(vRm?.required) === 11 && num(vRm?.standard) === 10
      && vRm?.change_reason === 'QA63 đường ẩm' && vEa?.removed === true && vEa?.required == null && num(vEa?.standard) === 4,
    `http=${bvNoReason.s}/${bvEdit.s} rm=${JSON.stringify(vRm ?? null)} ea=${JSON.stringify(vEa ?? null)}`)
  const bvSwap = await api(`/wms/production/batches/${BV?.id}/requirements`, 'PUT', { reason: 'QA63 hết mã cũ, đổi', items: [{ material_id: M_BTP, qty: 11, replaces: M_RM }] })
  const bvS = (await api(`/wms/production/batches/${BV?.id}`)).j?.data?.board ?? []
  const sNew = bvS.find(r => r.material_id === M_BTP), sOld = bvS.find(r => r.material_id === M_RM)
  check('10n. Đổi mã ⇒ dòng mới ghi "thay cho" mã cũ (gốc trống), dòng cũ "đã bỏ → mã mới" vẫn giữ gốc 10',
    bvSwap.s === 200 && sNew?.replaces_code === 'QA63RM1' && sNew?.standard == null && num(sNew?.required) === 11 && sOld?.removed === true && sOld?.replaced_by_code === 'QA63BTP1' && num(sOld?.standard) === 10,
    `http=${bvSwap.s} new=${JSON.stringify(sNew ?? null)} old=${JSON.stringify(sOld ?? null)}`)
  const bvSw = await api(`/wms/production/batches/${BV?.id}/apply-recipe`, 'POST', { replace: true, recipe_id: RCP2 })
  const bvR = (await api(`/wms/production/batches/${BV?.id}`)).j?.data
  const r2Rm = (bvR?.board ?? []).find(r => r.material_id === M_RM)
  check('10o. Đổi công thức trên mẻ ⇒ phiếu theo công thức mới (8 × 2 = 16, mức lệch ±2%), mẻ ghi công thức mới',
    bvSw.s === 200 && bvR?.recipe?.id === RCP2 && (bvR?.board ?? []).length === 1 && num(r2Rm?.required) === 16 && num(r2Rm?.standard) === 16 && num(r2Rm?.tol_pct) === 2,
    `http=${bvSw.s} recipe=${bvR?.recipe?.name} board=${JSON.stringify(bvR?.board ?? null)}`)
  if (BV?.id) await api(`/wms/production/batches/${BV.id}/cancel`, 'POST', {})
  // các phép sau (10i, 10j) chép công thức MẶC ĐỊNH ⇒ trả mặc định về công thức 1
  const back = await api(`/wms/production/recipes/${RCP1}`, 'PUT', { name: 'Chuẩn', base_qty: 100, note: 'QA63', is_default: true, lines: [{ material_id: M_RM, qty: 5 }, { material_id: M_EA, qty: 2 }] })
  const r2Now = (await api(`/wms/production/recipes/${RCP2}`)).j?.data
  check('10p. Đặt lại mặc định cho công thức 1 ⇒ công thức 2 thôi mặc định', back.s === 200 && back.j?.data?.is_default === true && r2Now?.is_default === false,
    `http=${back.s} ${JSON.stringify(back.j?.error ?? null)} r2=${r2Now?.is_default}`)
  // sửa mẻ ⇒ bàn tính lại yêu cầu (C114, 16/11)
  const upPlan = await api(`/wms/production/batches/${BW.id}`, 'PATCH', { planned_qty: 600 })
  const board4 = (await api(`/wms/production/batches/${BW.id}`)).j?.data?.board ?? []
  check('10i. Sửa kế hoạch 300 → 600 ⇒ yêu cầu nhân đôi (15 → 30, 6 → 12), phần đã cấp giữ nguyên',
    upPlan.s === 200 && num(board4.find(r => r.material_id === M_RM)?.required) === 30 && num(board4.find(r => r.material_id === M_EA)?.required) === 12
      && num(board4.find(r => r.material_id === M_RM)?.consumed) === 6, `http=${upPlan.s} ${JSON.stringify(board4.map(r => [r.material_id, r.required, r.consumed]))}`)
  const bx = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP2, planned_qty: 100, tank_id: T6.id }))
  const BX = bx.j?.data
  const upRm = await api(`/wms/production/batches/${BX?.id}`, 'PATCH', { material_id: M_RM })
  check('10j0. Sửa mẻ đổi mã BTP sang mã NGUYÊN LIỆU ⇒ 422 NOT_SEMI_FINISHED (C117)', upRm.s === 422 && upRm.j?.error?.code === 'NOT_SEMI_FINISHED', `http=${upRm.s} ${upRm.j?.error?.code}`)
  const upMat = await api(`/wms/production/batches/${BX?.id}`, 'PATCH', { material_id: M_BTP })
  const boardX = (await api(`/wms/production/batches/${BX?.id}`)).j?.data?.board ?? []
  const upBack = await api(`/wms/production/batches/${BX?.id}`, 'PATCH', { material_id: M_BTP2, planned_qty: 200 })
  const boardX2 = (await api(`/wms/production/batches/${BX?.id}`)).j?.data?.board ?? []
  check('10j. Đổi mã BTP sang mã chưa có định mức ⇒ bàn bỏ nguyên liệu của mã cũ; đổi về ⇒ chép định mức × kế hoạch mới',
    bx.s === 201 && num(BX?.requirement_count) === 2 && upMat.s === 200 && boardX.length === 0 && upBack.s === 200
      && num(boardX2.find(r => r.material_id === M_RM)?.required) === 10 && num(boardX2.find(r => r.material_id === M_EA)?.required) === 4,
    `http=${bx.s}/${upMat.s}/${upBack.s} board=${boardX.length} → ${JSON.stringify(boardX2.map(r => [r.material_id, r.required]))}`)
  if (BX?.id) await api(`/wms/production/batches/${BX.id}/cancel`, 'POST', {})
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
  // nhận GỘP vào dòng tồn gộp đã có (kho QTY_DATE cộng cartons_imported vào dòng cũ, không tạo dòng mới) + xuất tiêu hao 2 (C113, 16/11)
  const e5 = (await restAll('InventoryEntry', 'select=cartons_imported,cartons_remaining&id=eq.QA63_E5'))[0]
  await restWrite('InventoryEntry', 'PATCH', 'id=eq.QA63_E5', { cartons_imported: num(e5?.cartons_imported) + 5, cartons_remaining: num(e5?.cartons_remaining) + 3, updated_at: ts() })
  const rp2b = await api(`/wms/production/shift-reports/${sh2.j?.data?.id}`)
  const rm2b = (rp2b.j?.data?.rows ?? []).find(r => r.material_id === M_RM)
  check('11g. Hàng nhận gộp vào dòng tồn cũ lên cột Nhập của ca (5); tồn sổ theo kịp',
    rp2b.s === 200 && num(rm2b?.received) === 5 && Math.abs(num(rm2b?.book) - (sumStock - 1 + 3)) < 0.001 && !('cum_in' in (rp2b.j?.data?.report ?? {})),
    `http=${rp2b.s} received=${rm2b?.received} book=${rm2b?.book}/${sumStock + 2}`)

  // ── [12] PHIẾU THEO DÕI của mẻ ──
  const plBadForm = await api(`/wms/production/batches/${B1.id}/process-log/xyz`, 'PUT', { data: { water_l: '1' } })
  const plNoForm = await api(`/wms/production/batches/${B1.id}/process-log/XYZ`, 'PUT', { data: { water_l: '1' } })
  const plBadKey = await api(`/wms/production/batches/${B1.id}/process-log/MIX`, 'PUT', { data: { 'Bad Key': '1' } })
  check('12a. Mã phiếu sai dạng ⇒ 400; mẫu phiếu không có ⇒ 404; mã ô sai dạng ⇒ 400', plBadForm.s === 400 && plNoForm.s === 404 && plBadKey.s === 400, `http=${plBadForm.s}/${plNoForm.s}/${plBadKey.s}`)
  const pl1 = await api(`/wms/production/batches/${B1.id}/process-log/MIX`, 'PUT', { data: { water_l: '1.200', ph_water: '7,1', note: '  ' } })
  const pl2 = await api(`/wms/production/batches/${B1.id}/process-log/MIX`, 'PUT', { data: { water_l: '1.250', brix: '12,5' } })
  const plGet = ((await api(`/wms/production/batches/${B1.id}`)).j?.data?.process_logs ?? []).find(l => l.form === 'MIX')
  check('12b. Ghi phiếu lần đầu ⇒ 201 (bỏ ô trống); ghi lại ⇒ 200 thay trọn nội dung; chi tiết mẻ trả kèm phiếu',
    pl1.s === 201 && Object.keys(pl1.j?.data?.data ?? {}).length === 2 && pl2.s === 200 && plGet?.data?.water_l === '1.250' && plGet?.data?.brix === '12,5' && plGet?.data?.ph_water === undefined,
    `http=${pl1.s}/${pl2.s} ${JSON.stringify(plGet?.data ?? null)}`)
  const plNone = await api(`/wms/production/batches/${B1.id}/process-log/JELLY/confirm`, 'POST', { confirm: true })
  const plCf = await api(`/wms/production/batches/${B1.id}/process-log/MIX/confirm`, 'POST', { confirm: true })
  const plLocked = await api(`/wms/production/batches/${B1.id}/process-log/MIX`, 'PUT', { data: { water_l: '9' } })
  const plUn = await api(`/wms/production/batches/${B1.id}/process-log/MIX/confirm`, 'POST', { confirm: false })
  const plAgain = await api(`/wms/production/batches/${B1.id}/process-log/MIX`, 'PUT', { data: { water_l: '1.300' } })
  check('12c. Xác nhận phiếu chưa ghi ⇒ 404; QA xác nhận ⇒ khoá sửa (409) + chụp mẫu vào phiếu; bỏ xác nhận ⇒ gỡ bản chụp, sửa lại được',
    plNone.s === 404 && plCf.s === 200 && !!plCf.j?.data?.confirmed_at && Array.isArray(plCf.j?.data?.blocks) && plLocked.s === 409 && plLocked.j?.error?.code === 'PROCESS_LOG_CONFIRMED'
      && plUn.s === 200 && plUn.j?.data?.blocks === null && plAgain.s === 200,
    `http=${plNone.s}/${plCf.s}/${plLocked.s}/${plUn.s}/${plAgain.s} snap=${Array.isArray(plCf.j?.data?.blocks)} unsnap=${JSON.stringify(plUn.j?.data?.blocks)}`)

  // ── [13] MẪU PHIẾU = CẤU HÌNH · sửa riêng tại bàn ──
  const pfList = await api('/wms/production/process-forms')
  const pfMix = (pfList.j?.data ?? []).find(x => x.code === 'MIX'), pfJelly = (pfList.j?.data ?? []).find(x => x.code === 'JELLY')
  check('13a. Danh sách mẫu phiếu có MIX + JELLY kèm khối ô (bảng rửa thạch 8 lần)',
    pfList.s === 200 && Array.isArray(pfMix?.blocks) && (pfJelly?.blocks ?? []).some(b => b.type === 'grid' && b.key === 'wash' && b.rows === 8),
    `http=${pfList.s} n=${pfList.j?.data?.length}`)
  const pfBody = (blocks, is_active = true) => ({ title: 'QA63 phiếu thử', short: 'QA63', is_active, blocks })
  const okBlocks = [{ type: 'fields', title: 'Thông số', fields: [{ key: 'nhiet_do', label: 'Nhiệt độ', kind: 'num', unit: '°C', max: 90 }] },
    { type: 'grid', key: 'tt', title: 'Theo dõi', rows: 2, cols: [{ key: 'b1', label: 'Bồn 1' }], cells: [{ key: 't', label: 'Giờ', kind: 'time' }] }]
  const pfDup = await api('/wms/production/process-forms/QA63F', 'PUT', pfBody([{ type: 'fields', title: 'A', fields: [{ key: 'x', label: 'X', kind: 'num' }, { key: 'x', label: 'Y', kind: 'num' }] }]))
  const pfRange = await api('/wms/production/process-forms/QA63F', 'PUT', pfBody([{ type: 'fields', title: 'A', fields: [{ key: 'x', label: 'X', kind: 'text', max: 1 }] }]))
  const pfBadCode = await api('/wms/production/process-forms/qa63f', 'PUT', pfBody(okBlocks))
  const pfNew = await api('/wms/production/process-forms/QA63F', 'PUT', pfBody(okBlocks))
  check('13b. Mẫu trùng mã ô / ngưỡng trên ô chữ ⇒ 422; mã mẫu sai dạng ⇒ 400; mẫu hợp lệ ⇒ 201',
    pfDup.s === 422 && pfRange.s === 422 && pfBadCode.s === 400 && pfNew.s === 201,
    `http=${pfDup.s}/${pfRange.s}/${pfBadCode.s}/${pfNew.s}`)
  const plF1 = await api(`/wms/production/batches/${B1.id}/process-log/QA63F`, 'PUT', { data: { nhiet_do: '95', tt_1_b1_t: '08:00' } })
  const pfOff = await api('/wms/production/process-forms/QA63F', 'PUT', pfBody(okBlocks, false))
  const plF2 = await api(`/wms/production/batches/${B2.id}/process-log/QA63F`, 'PUT', { data: { nhiet_do: '80' } })
  const plF3 = await api(`/wms/production/batches/${B1.id}/process-log/QA63F`, 'PUT', { data: { nhiet_do: '85' } })
  check('13c. Phiếu theo mẫu mới ghi được; mẫu NGƯNG ⇒ mẻ khác không mở phiếu mới (409), phiếu đã có vẫn sửa được',
    plF1.s === 201 && pfOff.s === 200 && plF2.s === 409 && plF2.j?.error?.code === 'PROCESS_FORM_INACTIVE' && plF3.s === 200,
    `http=${plF1.s}/${pfOff.s}/${plF2.s}/${plF3.s}`)
  // ── [13x] PHIẾU BỔ SUNG theo mã BTP (17/11): JELLY chỉ có ở mẻ được chọn ──
  const jOpt = pfJelly?.optional === true
  const plJ0 = await api(`/wms/production/batches/${B1.id}/process-log/JELLY`, 'PUT', { data: { nuoc_bu: '1' } })
  const stJ0 = await api(`/wms/production/batches/${B1.id}/process-log/JELLY/stamp`, 'POST', { key: 'abc' })
  const fBad = await api(`/wms/production/batches/${B1.id}/forms`, 'PUT', { forms: ['MIX'] })
  const fAdd = await api(`/wms/production/batches/${B1.id}/forms`, 'PUT', { forms: ['JELLY'] })
  const b1Forms = (await api(`/wms/production/batches/${B1.id}`)).j?.data?.extra_forms
  check('13x1. JELLY là phiếu bổ sung; mẻ chưa có phiếu ⇒ ghi / bấm giờ đều 409 FORM_NOT_ON_BATCH; thêm phiếu thường (MIX) ⇒ 422; thêm JELLY ⇒ mẻ có phiếu',
    jOpt && plJ0.s === 409 && plJ0.j?.error?.code === 'MES_FORM_NOT_ON_BATCH' && stJ0.s === 409 && stJ0.j?.error?.code === 'MES_FORM_NOT_ON_BATCH'
      && fBad.s === 422 && fBad.j?.error?.code === 'MES_FORM_INVALID' && fAdd.s === 200 && Array.isArray(b1Forms) && b1Forms.includes('JELLY'),
    `opt=${jOpt} http=${plJ0.s}/${stJ0.s}/${fBad.s}/${fAdd.s} ${plJ0.j?.error?.code}/${stJ0.j?.error?.code}/${fBad.j?.error?.code} forms=${JSON.stringify(b1Forms)}`)
  // sửa riêng cho lần này: bảng rửa thạch thêm lần 9 + một ô mới — mẫu chung không đổi
  const custom = structuredClone(pfJelly?.blocks ?? [])
  for (const b of custom) if (b.type === 'grid' && b.key === 'wash') b.rows = 9
  if (custom[0]?.type === 'fields') custom[0].fields.push({ key: 'nuoc_bu', label: 'Nước bù', kind: 'num', unit: 'L' })
  const plC1 = await api(`/wms/production/batches/${B1.id}/process-log/JELLY`, 'PUT', { data: { wash_9_s1_t: '10:30', nuoc_bu: '12' }, blocks: custom })
  const badCustom = structuredClone(custom); if (badCustom[0]?.type === 'fields') badCustom[0].fields.push({ key: 'nuoc_bu', label: 'Trùng', kind: 'num' })
  const plC2 = await api(`/wms/production/batches/${B1.id}/process-log/JELLY`, 'PUT', { data: { nuoc_bu: '12' }, blocks: badCustom })
  const plC3 = await api(`/wms/production/batches/${B1.id}/process-log/JELLY`, 'PUT', { data: { wash_9_s1_t: '10:30', nuoc_bu: '13' } })
  const pfJ2 = ((await api('/wms/production/process-forms')).j?.data ?? []).find(x => x.code === 'JELLY')
  const plC4 = await api(`/wms/production/batches/${B1.id}/process-log/JELLY`, 'PUT', { data: { wash_9_s1_t: '10:30' }, blocks: null })
  check('13d. Sửa riêng tại bàn (thêm lần 9, thêm ô) lưu cùng phiếu; trùng mã ô ⇒ 422; ghi tiếp không gửi cấu trúc ⇒ giữ bản riêng; mẫu chung không đổi; blocks:null ⇒ về theo mẫu chung',
    plC1.s === 201 && (plC1.j?.data?.blocks ?? []).some(b => b.key === 'wash' && b.rows === 9) && plC1.j?.data?.data?.wash_9_s1_t === '10:30'
      && plC2.s === 422 && plC3.s === 200 && Array.isArray(plC3.j?.data?.blocks) && plC3.j?.data?.data?.nuoc_bu === '13'
      && (pfJ2?.blocks ?? []).some(b => b.key === 'wash' && b.rows === 8)
      && plC4.s === 200 && plC4.j?.data?.blocks === null && plC4.j?.data?.data?.wash_9_s1_t === '10:30',
    `http=${plC1.s}/${plC2.s}/${plC3.s}/${plC4.s} c4blocks=${JSON.stringify(plC4.j?.data?.blocks)}`)
  const fDrop = await api(`/wms/production/batches/${B1.id}/forms`, 'PUT', { forms: [] })
  check('13x2. Bỏ phiếu bổ sung ĐÃ GHI khỏi mẻ ⇒ 409 FORM_HAS_LOG', fDrop.s === 409 && fDrop.j?.error?.code === 'MES_FORM_HAS_LOG', `http=${fDrop.s} ${fDrop.j?.error?.code}`)
  // mặc định theo mã: mẫu bổ sung QA63X gắn M_BTP2 ⇒ mở mẻ M_BTP2 tự có; gửi extra_forms [] ⇒ không có; mã khác ⇒ không có
  const pfX = await api('/wms/production/process-forms/QA63X', 'PUT', { title: 'QA63 phiếu bổ sung', short: 'QA63X', is_active: true, optional: true, material_ids: [M_BTP2],
    blocks: [{ type: 'fields', title: 'A', fields: [{ key: 'x', label: 'X', kind: 'num' }] }] })
  const pfXbad = await api('/wms/production/process-forms/QA63X', 'PUT', { title: 'QA63 phiếu bổ sung', short: 'QA63X', is_active: true, optional: true, material_ids: [M_RM],
    blocks: [{ type: 'fields', title: 'A', fields: [{ key: 'x', label: 'X', kind: 'num' }] }] })
  const bx1 = await api('/wms/production/batches', 'POST', NEW({ cycle: 'QX', material_id: M_BTP2, tank_id: T4.id, planned_qty: 10 }))
  const bx2 = await api('/wms/production/batches', 'POST', NEW({ cycle: 'QX', material_id: M_BTP2, tank_id: T4.id, planned_qty: 10, extra_forms: [] }))
  const fx1 = (await api(`/wms/production/batches/${bx1.j?.data?.id}`)).j?.data?.extra_forms
  const fx2 = (await api(`/wms/production/batches/${bx2.j?.data?.id}`)).j?.data?.extra_forms
  const fb2 = (await api(`/wms/production/batches/${B2.id}`)).j?.data?.extra_forms
  check('13x3. Mẫu bổ sung gắn mã BTP: mở mẻ mã đó ⇒ tick sẵn; mở mẻ gửi danh sách rỗng ⇒ không có; mẻ mã khác ⇒ không có; mã không phải BTP ⇒ 422',
    pfX.s === 201 && pfX.j?.data?.optional === true && pfXbad.s === 422 && bx1.s === 201 && bx2.s === 201
      && JSON.stringify(fx1) === '["QA63X"]' && JSON.stringify(fx2) === '[]' && JSON.stringify(fb2) === '[]',
    `http=${pfX.s}/${pfXbad.s}/${bx1.s}/${bx2.s} ${JSON.stringify(bx1.j?.error ?? null)} fx1=${JSON.stringify(fx1)} fx2=${JSON.stringify(fx2)} b2=${JSON.stringify(fb2)}`)
  for (const x of [bx1, bx2]) if (x.j?.data?.id) await api(`/wms/production/batches/${x.j.data.id}/cancel`, 'POST', {})
  await api('/wms/production/process-forms/QA63X', 'PUT', { title: 'QA63 phiếu bổ sung', short: 'QA63X', is_active: false, blocks: [{ type: 'fields', title: 'A', fields: [{ key: 'x', label: 'X', kind: 'num' }] }] })

  check('9a. Huỷ mẻ còn dòng rút ⇒ 409 BATCH_HAS_CONSUMPTION', cx.s === 409 && cx.j?.error?.code === 'BATCH_HAS_CONSUMPTION', `http=${cx.s}`)
  const clB = await api(`/wms/production/batches/${B1.id}/close`, 'POST', {})
  const consClosed = await api(`/wms/production/batches/${B1.id}/consume-scan`, 'POST', { entry_id: 'QA63_E2', qty: 1, qty_semantics: 'base' })
  const reB = await api(`/wms/production/batches/${B1.id}/reopen`, 'POST', {})
  check('9b. Đóng mẻ ⇒ không rút được (409 MES_BATCH_NOT_OPEN); mở lại được', clB.s === 200 && consClosed.s === 409 && consClosed.j?.error?.code === 'MES_BATCH_NOT_OPEN' && reB.s === 200, `http=${clB.s}/${consClosed.s}/${reB.s}`)
  const lockEdit = await api(`/wms/production/batches/${B1.id}`, 'PATCH', { material_id: M_BTP2 })
  const lockTank = await api(`/wms/production/batches/${B1.id}`, 'PATCH', { tank_id: T2.id })
  check('9c. Đổi mã BTP khi đã rút NVL ⇒ 409 BATCH_LOCKED; đổi bồn khi đã nạp ⇒ 409 MES_FILLED', lockEdit.s === 409 && lockEdit.j?.error?.code === 'BATCH_LOCKED' && lockTank.s === 409 && lockTank.j?.error?.code === 'MES_FILLED', `http=${lockEdit.s}/${lockTank.s} ${lockTank.j?.error?.code}`)
  const lst = await api(`/wms/production/batches?warehouse_id=${WC}&pageSize=50`)
  const rowB1 = (lst.j?.data?.rows ?? []).find(r => r.id === B1.id)
  check('9d. Danh sách mẻ: dòng + ô tổng một lời gọi; mẻ 1 có NVL + đã nạp', lst.s === 200 && num(lst.j?.data?.summary?.total) >= 3 && num(rowB1?.rm_lines) >= 2 && num(rowB1?.filled) === 600 && rowB1?.tank_code === 'QA63-T1' && rowB1?.batch_no === 1,
    JSON.stringify({ s: lst.s, sum: lst.j?.data?.summary, row: rowB1 && { rm: rowB1.rm_lines, f: rowB1.filled } }))
  const lstP = await api(`/wms/production/batches?warehouse_id=${WP}&pageSize=50`)
  const tP = await api(`/wms/production/tanks?warehouse_id=${WP}`)
  check('9f. Lọc theo KHO NHÀ MÁY ⇒ thấy mẻ + bồn của các kho chế biến trực thuộc', lstP.s === 200 && (lstP.j?.data?.rows ?? []).some(r => r.id === B1.id)
    && (tP.j?.data ?? []).some(t => t.id === T1.id) && (tP.j?.data ?? []).some(t => t.id === T3.id), `http=${lstP.s}/${tP.s} n=${lstP.j?.data?.rows?.length}/${tP.j?.data?.length}`)
  const cx3 = await api(`/wms/production/batches/${b3.id}/cancel`, 'POST', {})
  check('9e. Huỷ mẻ chưa rút / chưa nạp ⇒ 200', cx3.s === 200 && cx3.j?.data?.status === 'CANCELLED', `http=${cx3.s}`)

  // ── [16] LUỒNG CỦA MẺ (17/11) ở kho chế biến 2 bật `mes_flow_gate` ──
  {
    const setOn = await api('/wms/production/settings', 'PUT', { warehouse_id: WC2, mes_flow_gate: true })
    await restWrite('InventoryEntry', 'POST', null, [E('QA63_E16', 'QA63_P16', 50, WC2, '2026-11-01', '2027-01-01')])
    const fb = await api('/wms/production/batches', 'POST', { warehouse_id: WC2, material_id: M_BTP, prod_date: todayVN, cycle: 'Q2', tank_id: T3.id, planned_qty: 100 })
    const FB = fb.j?.data
    check('16a. Bật luồng chặt qua Cài đặt MES; mở mẻ ở kho 2 ⇒ mã lô QQ20001QA63-T3', setOn.s === 200 && setOn.j?.data?.mes_flow_gate === true && fb.s === 201 && FB?.batch_code === 'QQ20001QA63-T3', `http=${setOn.s}/${fb.s} ${FB?.batch_code}`)
    const fbOver = await api('/wms/production/batches', 'POST', { warehouse_id: WC2, material_id: M_BTP, prod_date: todayVN, cycle: 'Q2', tank_id: T3.id, planned_qty: 401 })
    check('16b. Bồn 500 đã đặt 100 ⇒ mẻ kế hoạch 401 bị 409 MES_OVER_CAPACITY', fbOver.s === 409 && fbOver.j?.error?.code === 'MES_OVER_CAPACITY', `http=${fbOver.s}`)
    const rq = await api(`/wms/production/batches/${FB.id}/requirements`, 'PUT', { reason: 'QA63 khai phiếu', items: [{ material_id: M_RM, qty: 10 }] })
    const cNo = await api(`/wms/production/batches/${FB.id}/consume-scan`, 'POST', { entry_id: 'QA63_E16', qty: 10, qty_semantics: 'base' })
    const cNoLot = await api(`/wms/production/batches/${FB.id}/consume-lot`, 'POST', { material_id: M_RM, production_date: '2026-11-01', qty: 1, qty_semantics: 'base' })
    check('16c. Chưa duyệt ⇒ CẢ HAI cửa cấp NVL (quét tem · chọn lô) đều 409 MES_NOT_APPROVED', rq.s === 200 && cNo.s === 409 && cNo.j?.error?.code === 'MES_NOT_APPROVED' && cNoLot.s === 409 && cNoLot.j?.error?.code === 'MES_NOT_APPROVED', `http=${rq.s}/${cNo.s}/${cNoLot.s}`)
    const aQa0 = await api(`/wms/production/batches/${FB.id}/approve-qa`, 'POST', { approve: true })
    const aLead = await api(`/wms/production/batches/${FB.id}/approve-lead`, 'POST', { approve: true })
    const aLead2 = await api(`/wms/production/batches/${FB.id}/approve-lead`, 'POST', { approve: true })
    const lbl0 = await api(`/wms/production/batches/${FB.id}/labels`, 'POST', { count: 2 })
    const aQa = await api(`/wms/production/batches/${FB.id}/approve-qa`, 'POST', { approve: true })
    const rqLocked = await api(`/wms/production/batches/${FB.id}/requirements`, 'PUT', { reason: 'QA63', items: [{ material_id: M_RM, qty: 11 }] })
    const planLocked = await api(`/wms/production/batches/${FB.id}`, 'PATCH', { planned_qty: 120 })
    check('16d. QA duyệt trước trưởng ca ⇒ 409; trưởng ca duyệt (lần 2 ⇒ 409); in tem khi QA chưa duyệt ⇒ 409; QA duyệt ⇒ phiếu + kế hoạch khoá (409 MES_APPROVED)',
      aQa0.s === 409 && aLead.s === 200 && aLead2.s === 409 && lbl0.s === 409 && lbl0.j?.error?.code === 'MES_NOT_APPROVED' && aQa.s === 200 && rqLocked.s === 409 && rqLocked.j?.error?.code === 'MES_APPROVED' && planLocked.s === 409,
      `http=${aQa0.s}/${aLead.s}/${aLead2.s}/${lbl0.s}/${aQa.s}/${rqLocked.s}/${planLocked.s}`)
    const cOk = await api(`/wms/production/batches/${FB.id}/consume-scan`, 'POST', { entry_id: 'QA63_E16', qty: 10, qty_semantics: 'base' })
    const lbl = await api(`/wms/production/batches/${FB.id}/labels`, 'POST', { count: 2 })
    const L = lbl.j?.data?.labels ?? []
    check('16e. Đủ hai duyệt ⇒ cấp NVL được; in 2 tem pallet: QR MEB;<mã lô>;i;2;1', cOk.s === 200 && lbl.s === 200 && L.length === 2 && L[0]?.qr === 'MEB;QQ20001QA63-T3;1;2;1' && L[1]?.qr === 'MEB;QQ20001QA63-T3;2;2;1', `http=${cOk.s}/${lbl.s} ${JSON.stringify(L)}`)
    const fEarly = await api(`/wms/production/tanks/${T3.id}/fill`, 'POST', { batch_id: FB.id, qty: 100 })
    check('16f. Nạp bồn khi chưa quét tem nào ⇒ 409 MES_NOT_READY (nêu "tem pallet")', fEarly.s === 409 && fEarly.j?.error?.code === 'MES_NOT_READY' && /tem pallet/.test(fEarly.j?.error?.message ?? ''), `http=${fEarly.s} ${fEarly.j?.error?.message}`)
    const psWrong = await api(`/wms/production/pour-status?warehouse_id=${WC2}&tank_id=${T5.id}&cycle=Q2&batch_no=1`)
    const psNone = await api(`/wms/production/pour-status?warehouse_id=${WC2}&tank_id=${T3.id}&cycle=Q2&batch_no=9`)
    const psOk = await api(`/wms/production/pour-status?warehouse_id=${WC2}&tank_id=${T3.id}&cycle=q2&batch_no=1`)
    check('16g. Đổ bồn: khai SAI bồn ⇒ 409 MES_WRONG_TANK (nói đúng bồn phải đổ); số mẻ không có ⇒ 404; đúng ⇒ 200 kèm mẻ + 0 tem đã quét',
      psWrong.s === 409 && psWrong.j?.error?.code === 'MES_WRONG_TANK' && /QA63-T3/.test(psWrong.j?.error?.message ?? '') && psNone.s === 404 && psOk.s === 200 && psOk.j?.data?.batch?.id === FB.id && (psOk.j?.data?.scans ?? []).length === 0,
      `http=${psWrong.s}/${psNone.s}/${psOk.s} ${psWrong.j?.error?.message}`)
    const scBad = await api('/wms/production/pour-scan', 'POST', { batch_id: FB.id, tank_id: T3.id, code: 'QA63_P16' })
    const scOther = await api('/wms/production/pour-scan', 'POST', { batch_id: FB.id, tank_id: T3.id, code: 'MEB;QQ10001QA63-T1;1;2;1' })
    const scTank = await api('/wms/production/pour-scan', 'POST', { batch_id: FB.id, tank_id: T5.id, code: L[0]?.qr })
    const sc1 = await api('/wms/production/pour-scan', 'POST', { batch_id: FB.id, tank_id: T3.id, code: L[0]?.qr })
    const sc1b = await api('/wms/production/pour-scan', 'POST', { batch_id: FB.id, tank_id: T3.id, code: L[0]?.qr })
    check('16h. Quét tem nguyên liệu ⇒ 422 NOT_BATCH_LABEL; tem của MẺ KHÁC ⇒ 409 MES_WRONG_LABEL; đứng SAI BỒN ⇒ 409 MES_WRONG_TANK; tem 1/2 ⇒ 200; quét lại ⇒ 409 MES_ALREADY',
      scBad.s === 422 && scBad.j?.error?.code === 'NOT_BATCH_LABEL' && scOther.s === 409 && scOther.j?.error?.code === 'MES_WRONG_LABEL' && scTank.s === 409 && scTank.j?.error?.code === 'MES_WRONG_TANK'
        && sc1.s === 200 && (sc1.j?.data?.scans ?? []).length === 1 && sc1b.s === 409 && sc1b.j?.error?.code === 'MES_ALREADY',
      `http=${scBad.s}/${scOther.s}/${scTank.s}/${sc1.s}/${sc1b.s}`)
    // ĐỔI BỒN tại mẻ ⇒ mã lô đổi theo, tem đã in mất hiệu lực
    const mv = await api(`/wms/production/batches/${FB.id}`, 'PATCH', { tank_id: T5.id })
    const scOld = await api('/wms/production/pour-scan', 'POST', { batch_id: FB.id, tank_id: T5.id, code: L[1]?.qr })
    const lbl2 = await api(`/wms/production/batches/${FB.id}/labels`, 'POST', { count: 3 })
    const L2 = lbl2.j?.data?.labels ?? []
    check('16i. Đổi bồn ⇒ mã lô QQ20001QA63-T5 + cờ in lại tem; tem cũ quét ⇒ 409; in lại 3 tem ⇒ bản tem 3 (đổi mã +1, in lại +1)',
      mv.s === 200 && mv.j?.data?.batch_code === 'QQ20001QA63-T5' && mv.j?.data?.relabel === true && scOld.s === 409 && lbl2.s === 200 && L2.length === 3 && L2[2]?.qr === 'MEB;QQ20001QA63-T5;3;3;3',
      `http=${mv.s}/${scOld.s}/${lbl2.s} ${mv.j?.data?.batch_code} ${scOld.j?.error?.code} ${JSON.stringify(L2.map(x => x.qr))}`)
    const tkMid = (await api(`/wms/production/tanks?warehouse_id=${WC2}`)).j?.data ?? []
    const m5 = tkMid.find(t => t.id === T5.id), m3 = tkMid.find(t => t.id === T3.id)
    check('16i2. Danh sách bồn kèm phần ĐÃ ĐẶT: bồn 5 có mẻ vừa chuyển sang đặt 100, bồn 3 hết phần đặt', num(m5?.reserved) === 100 && m5?.incoming?.[0]?.batch_id === FB.id && num(m3?.reserved) === 0 && m5?.qa_state === 'EMPTY',
      JSON.stringify({ r5: m5?.reserved, r3: m3?.reserved, q: m5?.qa_state }))
    for (const l of L2) await api('/wms/production/pour-scan', 'POST', { batch_id: FB.id, tank_id: T5.id, code: l.qr })
    // ô BẮT BUỘC của phiếu (bản sửa riêng của phiếu này — không đụng mẫu chung) chưa ghi ⇒ chưa nạp
    const blocks = [{ type: 'fields', title: 'QA63 mốc', fields: [{ key: 'qa63_start', label: 'Bắt đầu đổ', kind: 'time', required: true }, { key: 'qa63_temp', label: 'Nhiệt độ', kind: 'num' }] }]
    const plReq = await api(`/wms/production/batches/${FB.id}/process-log/MIX`, 'PUT', { data: { qa63_temp: '45' }, blocks })
    const gate1 = (await api(`/wms/production/batches/${FB.id}`)).j?.data?.gate
    const fNoLog = await api(`/wms/production/tanks/${T5.id}/fill`, 'POST', { batch_id: FB.id, qty: 100 })
    check('16j. Đã quét đủ 3/3 nhưng phiếu còn ô bắt buộc ⇒ 409 MES_NOT_READY; cổng của mẻ liệt kê đúng ô thiếu',
      plReq.s < 300 && num(gate1?.scanned) === 3 && (gate1?.missing ?? []).length === 1 && gate1.missing[0].key === 'qa63_start' && fNoLog.s === 409 && fNoLog.j?.error?.code === 'MES_NOT_READY' && /bắt buộc/.test(fNoLog.j?.error?.message ?? ''),
      `http=${plReq.s}/${fNoLog.s} gate=${JSON.stringify(gate1 ?? null)}`)
    const st1 = await api(`/wms/production/batches/${FB.id}/process-log/MIX/stamp`, 'POST', { key: 'qa63_start' })
    const st2 = await api(`/wms/production/batches/${FB.id}/process-log/MIX/stamp`, 'POST', { key: 'qa63_start' })
    const stBad = await api(`/wms/production/batches/${FB.id}/process-log/MIX/stamp`, 'POST', { key: 'qa63_temp' })
    const logRow = (await restAll('batch_process_log', `select=data,stamps&batch_id=eq.${FB.id}&form=eq.MIX`))[0]
    check('16k. Bấm mốc giờ ⇒ ghi HH:MM + người bấm; bấm lần 2 ⇒ 409 MES_ALREADY; ô không phải mốc giờ ⇒ 422',
      st1.s === 200 && /^\d\d:\d\d$/.test(st1.j?.data?.value ?? '') && logRow?.data?.qa63_start === st1.j?.data?.value && !!logRow?.stamps?.qa63_start?.by && logRow?.data?.qa63_temp === '45'
        && st2.s === 409 && st2.j?.error?.code === 'MES_ALREADY' && stBad.s === 422,
      `http=${st1.s}/${st2.s}/${stBad.s} ${JSON.stringify(logRow ?? null)}`)
    const edit = await api(`/wms/production/batches/${FB.id}/process-log/MIX`, 'PUT', { data: { qa63_temp: '45', qa63_start: '07:30' } })
    const logRow2 = (await restAll('batch_process_log', `select=data,stamps&batch_id=eq.${FB.id}&form=eq.MIX`))[0]
    check('16l. Sửa giờ đã bấm tại phiếu ⇒ lưu giờ mới + giữ vết người sửa', edit.s === 200 && logRow2?.data?.qa63_start === '07:30' && !!logRow2?.stamps?.qa63_start?.edited_by && !!logRow2?.stamps?.qa63_start?.by, JSON.stringify(logRow2 ?? null))
    // thiếu NVL ⇒ chưa nạp: huỷ dòng cấp rồi cấp lại
    const consId = (await restAll('batch_consumption', `select=id&batch_id=eq.${FB.id}&reversed_at=is.null`))[0]?.id
    await api(`/wms/production/consumption/${consId}/reverse`, 'POST', { reason: 'QA63 thử thiếu NVL' })
    const fShort = await api(`/wms/production/tanks/${T5.id}/fill`, 'POST', { batch_id: FB.id, qty: 100 })
    await api(`/wms/production/batches/${FB.id}/consume-scan`, 'POST', { entry_id: 'QA63_E16', qty: 10, qty_semantics: 'base' })
    const fOk = await api(`/wms/production/tanks/${T5.id}/fill`, 'POST', { batch_id: FB.id, qty: 100 })
    check('16m. Nguyên liệu cấp chưa đủ ⇒ 409 MES_NOT_READY (nêu mã thiếu); đủ cả ba điều kiện ⇒ nạp 200', fShort.s === 409 && fShort.j?.error?.code === 'MES_NOT_READY' && /QA63RM1/.test(fShort.j?.error?.message ?? '') && fOk.s === 200,
      `http=${fShort.s}/${fOk.s} ${fShort.j?.error?.message} ${JSON.stringify(fOk.j?.error ?? null)}`)
    const unQa = await api(`/wms/production/batches/${FB.id}/approve-qa`, 'POST', { approve: false })
    const tq = await api(`/wms/production/tanks/${T5.id}/qa`, 'POST', { qa_status: 'REJECTED', note: 'QA63 không đạt' })
    const tk = (await api(`/wms/production/tanks?warehouse_id=${WC2}`)).j?.data ?? []
    const t5 = tk.find(t => t.id === T5.id), t3 = tk.find(t => t.id === T3.id)
    const fbNow = (await restAll('production_batch', `select=qa_status,qa_note&id=eq.${FB.id}`))[0]
    check('16n. Đã nạp ⇒ QA không bỏ duyệt được (409 MES_FILLED); QA KHÔNG ĐẠT ở bồn ⇒ mẻ REJECTED + lý do; danh sách bồn: bồn 5 chứa 100 / không đạt, bồn 3 trống không còn phần đặt',
      unQa.s === 409 && unQa.j?.error?.code === 'MES_FILLED' && tq.s === 200 && fbNow?.qa_status === 'REJECTED' && fbNow?.qa_note === 'QA63 không đạt'
        && num(t5?.content) === 100 && t5?.qa_state === 'REJECTED' && num(t5?.reserved) === 0 && t3?.qa_state === 'EMPTY' && num(t3?.reserved) === 0,
      `http=${unQa.s}/${tq.s} ${JSON.stringify(fbNow ?? null)} t5=${JSON.stringify(t5 && { c: t5.content, q: t5.qa_state, r: t5.reserved })}`)
  }

  // ── [14] CHỨC DANH CHỈ CÓ QUYỀN SẢN XUẤT (16/11 — nghiệm thu bằng vai thật): form Mở / Sửa mẻ, Định mức tìm mã qua danh mục Mã hàng ──
  if (!bcrypt) console.log('  ⏭  [14] không load được bcrypt của backend — bỏ qua')
  else {
    const pw = 'Qa' + randomUUID().slice(0, 10) + '!'   // dùng một lần, không in
    await restWrite('JobTitle', 'POST', '', [
      { id: JT_OPEN, name: 'QA63 tổ trưởng chế biến', updated_at: ts(), module_permissions: { production: ['view', 'open_batch', 'consume'] } },
      { id: JT_VIEW, name: 'QA63 chỉ xem sản xuất', updated_at: ts(), module_permissions: { production: ['view'] } },
    ])
    const mk = async (jid, n) => {
      const id = randomUUID()
      await restWrite('Employee', 'POST', '', [{ id, employee_code: `QA63R${n}`, name: `QA63 vai ${n}`, email: `qa63role${n}@test.local`,
        password: await bcrypt.hash(pw, 10), is_active: true, job_title_id: jid, warehouse_id: WC, warehouse_scope: 'ASSIGNED', updated_at: ts() }])
      await restWrite('UserWarehouseAccess', 'POST', '', [{ id: randomUUID(), employee_id: id, warehouse_id: WC }])
      const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `qa63role${n}@test.local`, password: pw }) })
      return (await r.json().catch(() => null))?.data?.token ?? null
    }
    const tkOpen = await mk(JT_OPEN, 1), tkView = await mk(JT_VIEW, 2)
    const st = async (tk, p) => (await fetch(`${BASE}/api${p}`, { headers: { Authorization: `Bearer ${tk}` } })).status
    const q = '/masterdata/materials?search=QA63BTP&limit=5&view=lite'
    const sOpen = tkOpen ? await st(tkOpen, q) : 0, sView = tkView ? await st(tkView, q) : 0
    check('14a. Chức danh chỉ có quyền Sản xuất được mở mẻ ⇒ tìm được mã hàng (200); chức danh chỉ xem ⇒ 403',
      !!tkOpen && !!tkView && sOpen === 200 && sView === 403, `open=${sOpen} view=${sView}`)
    const putAs = async (tk, p, body) => (await fetch(`${BASE}/api${p}`, { method: 'PUT', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status
    const sEdit = tkOpen ? await putAs(tkOpen, `/wms/production/batches/${BW?.id ?? 'x'}/requirements`, { items: [], reason: 'QA63' }) : 0
    check('14b. Chức danh mở mẻ được nhưng KHÔNG có quyền "Sửa định mức của mẻ" ⇒ 403 (17/11 — chỉ người được phân quyền, vd trưởng ca)', sEdit === 403, `http=${sEdit}`)
    const postAs = async (tk, p, body) => (await fetch(`${BASE}/api${p}`, { method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status
    const sDec = tkOpen ? await postAs(tkOpen, `/wms/production/batches/${BR?.id ?? 'x'}/expiry-approvals/decide`, { entry_id: 'QA63_X1', decision: 'APPROVED', note: 'QA63' }) : 0
    check('14c. Chức danh cấp NVL được nhưng KHÔNG có quyền QA duyệt hàng hết hạn ⇒ 403 (17/11)', sDec === 403, `http=${sDec}`)
  }

  // ── [15] CỜ "BÁN THÀNH PHẨM" Ở MÃ HÀNG (16/11, C117 — ô "Mã bán thành phẩm" từng chỉ liệt kê nguyên liệu) ──
  const sf = await api('/masterdata/materials?search=QA63&limit=20&view=lite&semi_finished=1')
  const sfIds = (sf.j?.data ?? []).map(m => m.id).sort()
  check('15a. Ô tìm mã BTP (semi_finished=1) chỉ ra mã đã đánh dấu — không có NVL / mã EA',
    sf.s === 200 && JSON.stringify(sfIds) === JSON.stringify([M_BTP, M_BTP2].sort()), `http=${sf.s} ${JSON.stringify(sfIds)}`)
  const pg = await api('/masterdata/materials?page=1&page_size=50&search=QA63&flags=semi_finished')
  check('15b. Trang Mã hàng lọc Cờ = Bán thành phẩm ⇒ đúng 2 mã', pg.s === 200 && num(pg.j?.data?.total) === 2, `http=${pg.s} total=${pg.j?.data?.total}`)
  const fEa = await api(`/masterdata/materials/${M_EA}`, 'PUT', { is_semi_finished: true })
  const fUnit = await api(`/masterdata/materials/${M_BTP2}`, 'PUT', { base_unit: 'HOP' })
  const fHold = await api(`/masterdata/materials/${M_RM}`, 'PUT', { tank_hold_hours: 12 })
  const fNew = await api('/masterdata/materials', 'POST', { material_code: 'QA63BTPX', material_description: 'QA63 BTP sai đơn vị', base_unit: 'BAG', is_semi_finished: true })
  const fRow = (await restAll('Material', `select=is_semi_finished,base_unit,tank_hold_hours&id=in.(${M_EA},${M_BTP2},${M_RM})`))
  check('15c. Mã hàng: đánh dấu BTP cho mã EA · đổi BTP sang HOP · khai hạn lưu bồn cho NVL · tạo BTP tính BAG ⇒ đều 400, không ghi gì',
    fEa.s === 400 && fUnit.s === 400 && fHold.s === 400 && fNew.s === 400
      && fRow.every(r => r.base_unit !== 'HOP' && r.tank_hold_hours == null && !(r.base_unit === 'EA' && r.is_semi_finished)),
    `http=${fEa.s}/${fUnit.s}/${fHold.s}/${fNew.s}`)
  const fOn = await api(`/masterdata/materials/${M_RM}`, 'PUT', { is_semi_finished: true })
  const fOff = await api(`/masterdata/materials/${M_RM}`, 'PUT', { is_semi_finished: false })
  const rmFlag = (await restAll('Material', `select=is_semi_finished&id=eq.${M_RM}`))[0]
  check('15d. Mã tính KG bật / tắt cờ BTP qua form Mã hàng ⇒ 200, ghi đúng', fOn.s === 200 && fOn.j?.data?.is_semi_finished === true && fOff.s === 200 && rmFlag?.is_semi_finished === false,
    `http=${fOn.s}/${fOff.s} now=${rmFlag?.is_semi_finished}`)
  if (fNew.s === 200) await restWrite('Material', 'DELETE', 'material_code=eq.QA63BTPX')
} finally {
  await cleanup()
  const left = await restAll('Warehouse', `select=id&id=in.(${WP},${WC},${WC2})`)
  check('Z. Dọn sạch fixture QA63', left.length === 0, `còn ${left.length}`)
}
finish(PACK)
