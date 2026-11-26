// GÓI 63 — MES GIAI ĐOẠN 1: MẺ CHẾ BIẾN · RÚT NVL · BỒN · SỔ ĐÓNG GÓI RÚT TỪ BỒN · TRUY XUẤT SẢN XUẤT
// (14/11, user chốt — docs/plans/MES_PHASE1_PLAN.md, memory mes-phase1-design-2026-11-14).
// Điều phải giữ:
//   [0] Kho phụ tạo phiếu nhập trực tiếp được (Nhập SX / Nhập NCC — user chốt 19/11), ngoài nhận chuyển kho từ kho cha
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
//   [10q] NẠP ĐỊNH MỨC TỪ EXCEL (19/11): kiểm trước không ghi · gộp dòng cùng mã + tên · đã có ⇒ thay trọn, giữ mặc định · lỗi báo theo số dòng Excel,
//        một lỗi là không ghi gì · thiếu cột bắt buộc 400 · [14e] cần quyền manage_recipe
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
//   [2x] DÒNG MỞ RỘNG của bàn (18/11): mỗi dòng cấp kèm %Date LÚC CẤP + HSD hiệu lực (như "pallet đã quét" của Xuất kho)
//   [2e7] quyền duyệt NVL hết hạn chỉ ở chức danh QA (18/11 — gỡ ở Quản lý kho NPP / site / toàn quốc)
//   [17] BÁO CÁO NVL THEO CHU KỲ (18/11 f): danh sách chu kỳ · Σ thực cấp NVL × mẻ = sổ · nhân sự đếm đúng việc · chi tiết cấp kể cả lần huỷ ·
//        chu kỳ sai dạng 400; sơ đồ bồn: mẻ đặt bồn chưa nạp mang tình trạng + bước đang tới (mes_batch_steps)
//   [18] DỮ LIỆU THÔ TIÊU HAO NVL (18/11 g — "raw data đủ thông tin để làm việc với ERP SAP"): mỗi dòng một phát sinh Cấp (+) / Huỷ cấp (−);
//        Σ SL có dấu = sổ; lọc ngày VN · chặn khoảng sai; file xuất 3 phần (phát sinh · định mức – thực cấp · nạp bồn); phân trang server;
//        SƠ ĐỒ BỒN 2D: lưu chỗ đặt (map_x / map_y), chặn dữ liệu sai; ống ra = sổ đóng gói đang mở rút từ bồn. [14d] quyền view / export /
//        manage_tank + phạm vi kho của hai cửa mới.
//   [21] HÀNG KHÔNG TEM THEO NSX ở kho QR (26/11 — user "bắt nhập nếu có config như vậy ở kho cb"): cờ tắt = hành vi cũ (không NSX);
//        bật ở tầng Kho ⇒ Lưu thủ công thiếu NSX 422 · NSX tương lai 422 · mỗi NSX một dòng tồn, cùng NSX cộng dồn; loại kho khai TẮT ⇒
//        mã loại đó không bị bắt; hộp Lưu số lượng của chuyến xuất liệt kê theo NSX, ghi nhận trừ NSX cũ trước / đúng NSX đã chọn
//   [22] CHUYẾN TRONG KHUÔN VIÊN (26/11 — "bản chất kho chế biến đâu có yêu cầu biển số xe"): kho phụ xuất tiêu hao (không ship-to)
//        Bắt đầu KHÔNG biển số ⇒ 200; kho thường không ship-to vẫn bắt biển số ⇒ 400
// Fixture QA63: kho cha QA63_PARENT + kho phụ QA63_CB (+ QA63_CB2 để thử chéo kho) · mã NVL/BTP QA63* · tem QA63_* — dọn bằng PostgREST.
import { randomUUID } from 'crypto'
import { login, api, rawFetch, restAll, restWrite, check, finish, BASE, authToken } from './lib.mjs'
import { createRequire } from 'module'
const XLSX = createRequire(new URL('../../backend/package.json', import.meta.url))('xlsx')

const PACK = '63-production'
await login()
const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const WP = 'QA63_PARENT', WC = 'QA63_CB', WC2 = 'QA63_CB2'
const M_RM = 'QA63_RM1', M_BTP = 'QA63_BTP1', M_BTP2 = 'QA63_BTP2', M_EA = 'QA63_EA1', M_RM2 = 'QA63_RM2'
const M_G1 = 'QA63_G1', M_G2 = 'QA63_G2', M_G3 = 'QA63_G3'   // [23] Nhập nhiều mã: 3 mã RM01 có tem
const M_NT = 'QA63_NT1', M_NT2 = 'QA63_NT2'   // [21] hàng KHÔNG TEM: RM01 (theo NSX) · PK01 (loại kho tắt riêng)
const qaX = (await restAll('QAStatus', 'select=id&code=eq.X'))[0]?.id
const ts = () => new Date().toISOString()
const JT_OPEN = 'QA63_JT_OPEN', JT_VIEW = 'QA63_JT_VIEW', JT_OUT = 'QA63_JT_OUT'   // JT_OUT: [22c] chỉ xem Xuất kho, không quyền Khách hàng
let bcrypt = null
try { bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(m => m.default ?? m) } catch { /* chưa npm i backend */ }
const num = (v) => Number(v ?? 0)
// nạp Excel (19/11): dựng .xlsx trong bộ nhớ (dòng đầu = nhãn cột) rồi gửi multipart như form "Nạp Excel"
async function uploadXlsx(route, aoa, { preflight = false, token = null } = {}) {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Định mức')
  const fd = new FormData()
  fd.append('file', new Blob([Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'qa63.xlsx')
  const r = await fetch(`${BASE}/api${route}${preflight ? '?preflight=1' : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${token ?? authToken()}` }, body: fd })
  let j = null; try { j = JSON.parse(await r.text()) } catch { /* không JSON */ }
  return { s: r.status, j }
}
const RIMP_HEAD = ['Mã BTP *', 'Tên BTP', 'Tên công thức *', 'Cỡ mẻ chuẩn *', 'Mã NVL *', 'Số lượng *', 'ĐVT', 'Mức lệch ± %', 'Mặc định']

async function cleanup() {
  const whs = [WP, WC, WC2]
  const roleEmps = await restAll('Employee', 'select=id&email=like.qa63role*')
  for (const e of roleEmps) { await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${e.id}`); await restWrite('Employee', 'DELETE', `id=eq.${e.id}`) }
  await restWrite('JobTitle', 'DELETE', `id=in.(${JT_OPEN},${JT_VIEW},${JT_OUT})`)
  // [21] / [22] chuyến xuất ở kho thử: vết quét → dòng hàng → DO → chuyến (theo khoá ngoại), TRƯỚC tồn và mã hàng
  const gdos = await restAll('GroupDeliveryOrder', `select=id&warehouse_id=in.(${whs.join(',')})`)
  if (gdos.length) {
    const dos = await restAll('OutboundDelivery', `select=id&gdo_id=in.(${gdos.map(g => g.id).join(',')})`)
    const its = dos.length ? await restAll('OutboundItem', `select=id&do_id=in.(${dos.map(d => d.id).join(',')})`) : []
    if (its.length) {
      await restWrite('OutboundScanEntry', 'DELETE', `item_id=in.(${its.map(i => i.id).join(',')})`)
      await restWrite('wms_tasks', 'DELETE', `item_id=in.(${its.map(i => i.id).join(',')})`)
      await restWrite('OutboundItem', 'DELETE', `id=in.(${its.map(i => i.id).join(',')})`)
    }
    await restWrite('wms_tasks', 'DELETE', `gdo_id=in.(${gdos.map(g => g.id).join(',')})`)
    if (dos.length) await restWrite('OutboundDelivery', 'DELETE', `id=in.(${dos.map(d => d.id).join(',')})`)
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=in.(${gdos.map(g => g.id).join(',')})`)
  }
  const runs = await restAll('packing_runs', `select=id&warehouse_id=in.(${whs.join(',')})`)
  const tanks = await restAll('production_tank', `select=id&warehouse_id=in.(${whs.join(',')})`)
  const batches = await restAll('production_batch', `select=id&warehouse_id=in.(${whs.join(',')})`)
  if (tanks.length) await restWrite('tank_movement', 'DELETE', `tank_id=in.(${tanks.map(t => t.id).join(',')})`)
  if (tanks.length) await restWrite('tank_lot', 'DELETE', `tank_id=in.(${tanks.map(t => t.id).join(',')})`)
  await restWrite('inventory_block_event', 'DELETE', `warehouse_id=in.(${whs.join(',')})`)   // 25/11 hàng chặn — trước dòng cấp / tồn / báo cáo ca
  await restWrite('inventory_block', 'DELETE', `warehouse_id=in.(${whs.join(',')})`)
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
  await restWrite('ProductionImport', 'DELETE', `warehouse_id=in.(${whs.join(',')})`)   // phiếu nhập trực tiếp ở kho phụ ([0a])
  await restWrite('inbound_receipts', 'DELETE', `warehouse_id=in.(${whs.join(',')})`)   // [24] đầu phiếu chung — SAU dòng (FK dòng → đầu phiếu)
  await restWrite('warehouse_type_configs', 'DELETE', `warehouse_id=in.(${whs.join(',')})`)
  await restWrite('Material', 'DELETE', `id=in.(${[M_RM, M_BTP, M_BTP2, M_EA, M_RM2, M_NT, M_NT2, M_G1, M_G2, M_G3].join(',')})`)
  await restWrite('Location', 'DELETE', `warehouse_id=in.(${whs.join(',')})`)   // [23] vị trí thử của kho phụ
  await restWrite('Customer', 'DELETE', 'id=eq.QA63_CUST')   // [22c] ship-to trỏ kho cha — trước khi xoá kho
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
  const NEW = (o) => ({ warehouse_id: WC, prod_date: todayVN, cycle: 'Q1', shift: 'Ca 1', ...o })   // ca bắt buộc từ 21/11

  // ── [0] kho phụ TẠO PHIẾU NHẬP trực tiếp được (user chốt 19/11 "cứ cho nhập đi thôi" — trước đó 400 "Kho phụ nội bộ chỉ
  //        nhận hàng qua chuyển kho từ kho parent"): cả Nhập SX lẫn Nhập NCC ──
  const ncc0 = (await restAll('TransportCompany', 'select=id&limit=1'))[0]
  const r0a = await api('/wms/inbound-orders', 'POST', { warehouse_id: WC, material_id: M_RM, source_type: 'FACTORY', import_date: todayVN, planned_cartons: 100 })
  const r0b = ncc0 ? await api('/wms/inbound-orders', 'POST', { warehouse_id: WC, material_id: M_RM, source_type: 'NCC', ncc_id: ncc0.id, import_date: todayVN, planned_cartons: 100 }) : null
  check('0a. Kho phụ tạo phiếu nhập trực tiếp: Nhập SX + Nhập NCC ⇒ tạo được (không còn chặn "chỉ nhận qua chuyển kho")',
    r0a.s < 300 && (!r0b || r0b.s < 300), `SX http=${r0a.s} ${r0a.j?.error?.message ?? ''} · NCC http=${r0b?.s ?? 'bỏ (không có NCC)'} ${r0b?.j?.error?.message ?? ''}`)

  // ── [1] mở mẻ ──
  const r1a =await api('/wms/production/batches', 'POST', NEW({ warehouse_id: WP, material_id: M_BTP, tank_id: T1.id }))
  check('1a. Mở mẻ ở kho KHÔNG phải kho phụ ⇒ 422 NOT_PRODUCTION_WAREHOUSE', r1a.s === 422 && r1a.j?.error?.code === 'NOT_PRODUCTION_WAREHOUSE', `http=${r1a.s} ${r1a.j?.error?.code}`)
  const r1b = await api('/wms/production/batches', 'POST', NEW({ material_id: M_EA, tank_id: T1.id }))
  check('1b. Mã tính theo EA (không phải BTP) ⇒ 422 NOT_SEMI_FINISHED', r1b.s === 422 && r1b.j?.error?.code === 'NOT_SEMI_FINISHED', `http=${r1b.s} ${r1b.j?.error?.code}`)
  // C117: NVL tính KG từng lọt làm "mã bán thành phẩm" (luật cũ chỉ xét đơn vị L / KG)
  const r1b2 = await api('/wms/production/batches', 'POST', NEW({ material_id: M_RM, tank_id: T1.id }))
  check('1b2. Mở mẻ với mã NGUYÊN LIỆU tính KG (chưa đánh dấu BTP) ⇒ 422 NOT_SEMI_FINISHED', r1b2.s === 422 && r1b2.j?.error?.code === 'NOT_SEMI_FINISHED', `http=${r1b2.s} ${r1b2.j?.error?.code}`)
  const r1g = await api('/wms/production/batches', 'POST', { warehouse_id: WC, material_id: M_BTP, prod_date: todayVN })
  check('1g. Mở mẻ thiếu chu kỳ / bồn ⇒ 400 (17/11: bắt buộc)', r1g.s === 400, `http=${r1g.s}`)
  const r1gShift = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP, tank_id: T1.id, shift: undefined }))
  const r1gBlank = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP, tank_id: T1.id, shift: '  ' }))
  check('1g2. Mở mẻ thiếu CA / ca để trống ⇒ 400 (21/11: ca bắt buộc — Báo cáo NVL chia lệch định mức theo ca)', r1gShift.s === 400 && r1gBlank.s === 400, `http=${r1gShift.s}/${r1gBlank.s}`)
  const nc = await api(`/wms/production/batches/next-code?warehouse_id=${WC}&cycle=q1&tank_id=${T1.id}`)
  check('1c. Gợi ý: chữ nhà máy lấy ở kho CHA (Q) · số mẻ kế tiếp 1 · mã lô = Q + Q1 + 0001 + mã bồn', nc.s === 200 && nc.j?.data?.plant === 'Q' && nc.j?.data?.next_no === 1 && nc.j?.data?.code === 'QQ10001QA63-T1',
    `http=${nc.s} ${JSON.stringify(nc.j?.data ?? null)}`)
  const b1 = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP, tank_id: T1.id, machine_code: 'T1', planned_qty: 1000 }))
  const B1 = b1.j?.data
  check('1d. Mở mẻ không gõ số mẻ ⇒ 201, mã lô tự ghép, số mẻ 1, QA mặc định HOLD', b1.s === 201 && B1?.batch_code === 'QQ10001QA63-T1' && B1?.batch_no === 1 && B1?.tank_id === T1.id && B1?.qa_status === 'HOLD', `http=${b1.s} ${JSON.stringify(b1.j?.error ?? null)} ${B1?.batch_code}`)
  const b1NoShift = await api(`/wms/production/batches/${B1?.id}`, 'PATCH', { shift: null })
  const b1Shift = await api(`/wms/production/batches/${B1?.id}`, 'PATCH', { shift: 'Ca 2' })
  const b1Back = await api(`/wms/production/batches/${B1?.id}`, 'PATCH', { shift: 'Ca 1' })
  check('1d2. Sửa mẻ: xoá ca ⇒ 400; đổi ca ⇒ 200 (ca bắt buộc 21/11)', b1NoShift.s === 400 && b1Shift.s === 200 && b1Shift.j?.data?.shift === 'Ca 2' && b1Back.s === 200,
    `http=${b1NoShift.s}/${b1Shift.s}/${b1Back.s} ${b1Shift.j?.data?.shift}`)
  const b2 = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP, tank_id: T1.id, machine_code: 'T1' }))
  const B2 = b2.j?.data
  check('1e. Mẻ thứ hai cùng chu kỳ ⇒ số mẻ kế 2', b2.s === 201 && B2?.batch_code === 'QQ10002QA63-T1' && B2?.batch_no === 2, `code=${B2?.batch_code}`)
  const dup = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP, tank_id: T1.id, batch_no: 1 }))
  check('1f. Gõ số mẻ đã có trong chu kỳ ⇒ 409 BATCH_NO_DUP', dup.s === 409 && dup.j?.error?.code === 'BATCH_NO_DUP', `http=${dup.s} ${dup.j?.error?.code}`)
  const over = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP, tank_id: T1.id, planned_qty: 1 }))
  check('1h. Bồn 1.000 đã đặt đủ cho mẻ 1 (kế hoạch 1.000) ⇒ mẻ có kế hoạch nữa bị 409 MES_OVER_CAPACITY', over.s === 409 && over.j?.error?.code === 'MES_OVER_CAPACITY', `http=${over.s} ${over.j?.error?.code}`)
  // 25/11 rà soát B2: mẻ số 2 bị huỷ ⇒ số kế tiếp (gợi ý + tự lấy) nhảy sang 3, không va mã lô của mẻ huỷ cùng bồn
  const z1 = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP2, tank_id: T4.id, cycle: 'QZ' }))
  const z2 = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP2, tank_id: T4.id, cycle: 'QZ' }))
  await api(`/wms/production/batches/${z2.j?.data?.id}/cancel`, 'POST', {})
  const ncZ = await api(`/wms/production/batches/next-code?warehouse_id=${WC}&cycle=QZ&tank_id=${T4.id}`)
  const z3 = await api('/wms/production/batches', 'POST', NEW({ material_id: M_BTP2, tank_id: T4.id, cycle: 'QZ' }))
  check('1i. Mẻ 2 của chu kỳ bị huỷ ⇒ gợi ý số kế 3 và mở mẻ không gõ số ra số 3 (trước: gợi ý 2 ⇒ 409 MES_CODE_USED)',
    z2.j?.data?.batch_no === 2 && ncZ.j?.data?.next_no === 3 && z3.s === 201 && z3.j?.data?.batch_no === 3,
    `z2=${z2.j?.data?.batch_no} next=${ncZ.j?.data?.next_no} z3=${z3.s} ${z3.j?.data?.batch_no ?? z3.j?.error?.code}`)
  for (const z of [z1, z3]) if (z.j?.data?.id) await api(`/wms/production/batches/${z.j.data.id}/cancel`, 'POST', {})

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
  // ── [2x] DÒNG MỞ RỘNG CỦA BÀN (18/11 — user: "expand sau khi quét xong tương tự bên xuất"): %Date LÚC CẤP + HSD hiệu lực ──
  const gx = await api(`/wms/production/batches/${BR.id}`)
  const crow = id => (gx.j?.data?.consumption ?? []).find(c => c.id === id)
  const cX1 = crow(cx4.j?.data?.rows?.[0]?.id), cL1 = crow(el2.j?.data?.rows?.[0]?.id), cL2 = crow(ll2.j?.data?.rows?.[0]?.id)
  const atMs = c => Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(c?.created_at ?? '') ? c.created_at : `${c?.created_at}Z`)
  // ORACLE tự tính lại: HSD tường minh ⇒ %Date = (HSD − lúc cấp) / (HSD − NSX), không âm. NSX lưu không múi giờ ⇒ máy chạy BE ở +07
  // lệch tối đa 7 giờ trên mẫu số 365 ngày ⇒ dung sai 1 điểm
  const wantPct = (c, nsx, hsd) => Math.max(0, (Date.parse(`${hsd}T00:00:00Z`) - atMs(c)) / (Date.parse(`${hsd}T00:00:00Z`) - Date.parse(`${nsx}T00:00:00Z`)) * 100)
  check('2x1. Trang mẻ: dòng cấp kèm %Date LÚC CẤP (khớp tự tính lại) + HSD hiệu lực — tem / lô hết hạn đã duyệt %Date 0; lô sai thứ tự giữ ngày hàng nên lấy trước (tem hết hạn đã duyệt X1); không trả hạn dùng của mã',
    gx.s === 200 && cX1?.pct_date === 0 && cX1?.expiry_date === '2025-06-01' && !!cX1?.expiry_approval_id
      && cL1?.pct_date === 0 && cL1?.expiry_date === '2025-07-01' && !!cL1?.expiry_approval_id
      && typeof cL2?.pct_date === 'number' && Math.abs(cL2.pct_date - wantPct(cL2, '2026-10-05', '2027-10-05')) < 1 && cL2?.expiry_date === '2027-10-05'
      && cL2?.rotation_violation === true && cL2?.rotation_best_date === '2025-06-01'
      && !('supplier_shelf_life_overrides' in (cL2?.material ?? {})) && !('shelf_life_days' in (cL2?.material ?? {})),
    `http=${gx.s} x1=${JSON.stringify(cX1 && [cX1.pct_date, cX1.expiry_date])} l1=${JSON.stringify(cL1 && [cL1.pct_date, cL1.expiry_date])} l2=${JSON.stringify(cL2 && [cL2.pct_date, wantPct(cL2, '2026-10-05', '2027-10-05').toFixed(2), cL2.expiry_date, cL2.rotation_best_date])}`)
  // ── [2e7] quyền duyệt NVL hết hạn: chỉ chức danh QA (18/11 "Bỏ" ở ba chức danh quản lý kho — migration 20261118) ──
  const jts = await restAll('JobTitle', 'select=name,module_permissions')
  const prodPerms = j => (Array.isArray(j.module_permissions?.production) ? j.module_permissions.production : [])
  const withExp = jts.filter(j => prodPerms(j).includes('approve_expired'))
  const MGR = ['Quản lý kho NPP', 'Quản lý kho site', 'Quản lý kho toàn quốc']
  check('2e7. Quyền duyệt NVL hết hạn chỉ ở chức danh QA: không chức danh quản lý kho nào có; mọi chức danh có quyền đều là chức danh QA duyệt phiếu',
    withExp.length > 0 && !withExp.some(j => MGR.includes(j.name)) && withExp.every(j => prodPerms(j).includes('approve_qa')),
    `có quyền: ${withExp.map(j => j.name).join(', ')}`)
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
  // (18/11 c) mẻ đã nạp BTP vào bồn ⇒ sổ NVL khoá: cấp thêm (quét / chọn lô) và huỷ dòng cấp đều 409 MES_BATCH_FILLED — một chỗ mes_open_batch_wh
  const lkScan = await api(`/wms/production/batches/${B1.id}/consume-scan`, 'POST', { entry_id: 'QA63_E2', qty: 1, qty_semantics: 'base', rotation_override_reason: 'BLOCKED' })
  const lkLot = await api(`/wms/production/batches/${B1.id}/consume-lot`, 'POST', { material_id: M_RM, production_date: '2026-11-01', qty: 1, qty_semantics: 'base', rotation_override_reason: 'BLOCKED' })
  const lkRow = (await restAll('batch_consumption', `select=id&batch_id=eq.${B1.id}&reversed_at=is.null&limit=1`))[0]
  const lkRev = lkRow ? await api(`/wms/production/consumption/${lkRow.id}/reverse`, 'POST', { reason: 'QA63 thử khoá sau nạp' }) : { s: 0, j: null }
  check('5d2. Mẻ đã nạp BTP vào bồn ⇒ cấp thêm (quét · chọn lô) và huỷ dòng cấp đều 409 MES_BATCH_FILLED (user chốt 18/11)',
    lkScan.s === 409 && lkScan.j?.error?.code === 'MES_BATCH_FILLED' && lkLot.s === 409 && lkLot.j?.error?.code === 'MES_BATCH_FILLED'
      && lkRev.s === 409 && lkRev.j?.error?.code === 'MES_BATCH_FILLED',
    `http=${lkScan.s}/${lkLot.s}/${lkRev.s} ${lkScan.j?.error?.code}/${lkLot.j?.error?.code}/${lkRev.j?.error?.code}`)
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
  // mẻ 1 đã nạp bồn (sổ NVL khoá — 18/11 c) ⇒ các phép cấp từ đây dùng mẻ BL chưa nạp
  const BL = (await api('/wms/production/batches', 'POST', NEW({ cycle: 'QL', material_id: M_BTP2, tank_id: T4.id }))).j?.data
  const lotNull = await api(`/wms/production/batches/${BL?.id}/consume-lot`, 'POST', { material_id: M_RM, production_date: '2026-11-20', qty: 40, qty_semantics: 'base' })
  const e8 = (await restAll('InventoryEntry', 'select=cartons_remaining&id=eq.QA63_E8'))[0]
  check('6l. Chọn lô KHÔNG mã lô (hàng trên tem) ⇒ 409 MES_MUST_SCAN, không ăn sang lô có mã lô cùng NSX',
    lotNull.s === 409 && lotNull.j?.error?.code === 'MES_MUST_SCAN' && num(e8?.cartons_remaining) === 50, `http=${lotNull.s} ${lotNull.j?.error?.code} e8=${e8?.cartons_remaining}`)
  const lotX = await api(`/wms/production/batches/${BL?.id}/consume-scan`, 'POST', { entry_id: 'QA63_E8', qty: 40, qty_semantics: 'base' })
  const e78 = await restAll('InventoryEntry', 'select=id,cartons_remaining&id=in.(QA63_E7,QA63_E8)')
  check('6m. Quét tem lô QA63LX ⇒ trừ 40 ở tem đó, lô không mã lô giữ nguyên',
    lotX.s === 200 && num(e78.find(e => e.id === 'QA63_E8')?.cartons_remaining) === 10 && num(e78.find(e => e.id === 'QA63_E7')?.cartons_remaining) === 30, `http=${lotX.s} ${JSON.stringify(e78)}`)
  const scanGone = await api(`/wms/production/batches/${BL?.id}/consume-scan`, 'POST', { entry_id: 'QA63_E9', qty: 1, qty_semantics: 'base' })
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
  // 25/11 rà soát X3: trang đã ĐÓNG còn lượng rút bồn ⇒ hủy bị chặn (không thì bồn hụt vĩnh viễn); sửa về 0 rồi hủy được
  const beforeCx = await lotsNow()
  const rdAgain = await api(`/wms/packing-runs/${R3.id}/tank-draw`, 'POST', { tank_qty: 10, reason: 'QA63 rút lại' })
  const cxDrawn = await api(`/wms/packing-runs/${R3.id}/cancel`, 'POST', { note: 'QA63' })
  const r3st = (await restAll('packing_runs', `select=status&id=eq.${R3.id}`))[0]
  await api(`/wms/packing-runs/${R3.id}/tank-draw`, 'POST', { tank_qty: 0, reason: 'QA63 trả lại' })
  const cxZero = await api(`/wms/packing-runs/${R3.id}/cancel`, 'POST', { note: 'QA63' })
  const afterCx = await lotsNow()
  check('6s2. Hủy trang ĐÃ ĐÓNG còn rút bồn ⇒ 409 RUN_HAS_TANK_DRAW, trang giữ CLOSED; sửa lượng rút về 0 rồi hủy được, bồn về đúng mức cũ',
    rdAgain.s === 200 && cxDrawn.s === 409 && cxDrawn.j?.error?.code === 'RUN_HAS_TANK_DRAW' && r3st?.status === 'CLOSED' && cxZero.s === 200
      && Math.abs(afterCx(B1.id) - beforeCx(B1.id)) < 0.001 && Math.abs(afterCx(B2.id) - beforeCx(B2.id)) < 0.001,
    `rút=${rdAgain.s} hủy=${cxDrawn.s} ${cxDrawn.j?.error?.code} status=${r3st?.status} hủy0=${cxZero.s}`)

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
  // (21/11) BÁO CÁO NVL so với ĐỊNH MỨC GỐC: ô của mẻ mang std (gốc) · req (phiếu) · lý do; dòng BỎ khỏi phiếu vẫn có mặt (rm, req null, giữ gốc)
  const crQ1 = (await api(`/wms/production/cycles/report?warehouse_id=${WC}&cycle=Q1`)).j?.data
  const cRm = (crQ1?.rows ?? []).find(r => r.material_id === M_RM)?.cells?.[BV?.id]
  const cEa = (crQ1?.rows ?? []).find(r => r.material_id === M_EA)?.cells?.[BV?.id]
  check('10m2. Báo cáo chu kỳ (21/11): ô NVL mang định mức gốc 10 · phiếu 11 · lý do; dòng đã bỏ vẫn có mặt (rm, phiếu trống, gốc 4)',
    num(cRm?.std) === 10 && num(cRm?.req) === 11 && cRm?.rm === false && cRm?.why === 'QA63 đường ẩm' && cEa?.rm === true && cEa?.req == null && num(cEa?.std) === 4,
    `rm=${JSON.stringify(cRm ?? null)} ea=${JSON.stringify(cEa ?? null)}`)
  const rawQ1 = (await api(`/wms/production/consumption-raw/export?warehouse_id=${WC}&cycle=Q1&part=req&page_size=500`)).j?.data?.rows ?? []
  const rEa = rawQ1.find(x => x.batch_id === BV?.id && x.mat_code === 'QA63EA1')
  check('10m3. Dữ liệu thô "Định mức – thực cấp": dòng đã bỏ có mặt (Bỏ khỏi phiếu, gốc 4, lệch so chuẩn −4)',
    !!rEa && rEa.removed === true && rEa.in_sheet === false && num(rEa.std) === 4 && num(rEa.diff_std) === -4, JSON.stringify(rEa ?? null))
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
  // ── [10q] NẠP ĐỊNH MỨC TỪ EXCEL (19/11): mỗi dòng một NVL · cùng mã + tên = một công thức · đã có ⇒ thay trọn · tất cả hoặc không gì ──
  const IMP = '/wms/production/recipes/import'
  const goodFile = [RIMP_HEAD,
    ['QA63BTP2', 'QA63 dịch khác', 'QA63 nạp Excel', '1.000', 'QA63RM1', '12,5', 'kg', '1', ''],
    ['QA63BTP2', 'QA63 dịch khác', 'qa63 NẠP excel', '', 'QA63EA1', '3', 'EA', '', ''],
    ['QA63BTP2', 'QA63 dịch khác', 'QA63 bản 2', '100', 'QA63RM1', '7', '', '', ''],
  ]
  const nBefore = (await restAll('production_recipe', `select=id&material_id=eq.${M_BTP2}`)).length
  const pf = await uploadXlsx(IMP, goodFile, { preflight: true })
  const nAfterPf = (await restAll('production_recipe', `select=id&material_id=eq.${M_BTP2}`)).length
  const pd = pf.j?.data
  check('10q. Nạp định mức — KIỂM TRƯỚC: 1 công thức mới (2 dòng cùng tên khác hoa thường gộp một) + 1 công thức đã có sẽ thay; không ghi gì vào DB',
    pf.s === 200 && pd?.preflight === true && pd?.to_insert === 1 && pd?.to_update === 1 && pd?.will_write === 2 && pd?.errors_total === 0
      && (pd?.warnings ?? []).some(w => /QA63 bản 2.*đã có \(1 nguyên liệu\)/.test(w)) && nAfterPf === nBefore,
    `http=${pf.s} ${JSON.stringify(pd ?? pf.j?.error ?? null).slice(0, 300)} n=${nBefore}→${nAfterPf}`)
  const wr = await uploadXlsx(IMP, goodFile)
  const impNew = (await restAll('production_recipe', `select=id,name,base_qty,is_default,updated_by&material_id=eq.${M_BTP2}&name=eq.QA63 nạp Excel`))[0]
  const impLines = impNew ? await restAll('production_recipe_line', `select=material_id,qty,tol_pct,sort_order&recipe_id=eq.${impNew.id}&order=sort_order`) : []
  const r2Lines = await restAll('production_recipe_line', `select=material_id,qty&recipe_id=eq.${RCP2}`)
  const btp2Defs = (await restAll('production_recipe', `select=id&material_id=eq.${M_BTP2}&is_default=eq.true`)).map(r => r.id)
  check('10r. Nạp định mức — GHI: công thức mới đúng cỡ mẻ 1.000 + 2 dòng (12,5 kg ±1% · 3 EA); công thức đã có thay trọn (còn 1 dòng 7); mặc định giữ nguyên',
    wr.s === 200 && wr.j?.data?.inserted === 1 && wr.j?.data?.updated === 1 && num(impNew?.base_qty) === 1000 && impNew?.is_default === false
      && impLines.length === 2 && impLines[0].material_id === M_RM && num(impLines[0].qty) === 12.5 && num(impLines[0].tol_pct) === 1
      && impLines[1].material_id === M_EA && num(impLines[1].qty) === 3 && impLines[1].tol_pct == null
      && r2Lines.length === 1 && r2Lines[0].material_id === M_RM && num(r2Lines[0].qty) === 7 && btp2Defs.length === 1 && btp2Defs[0] === RCP1,
    `http=${wr.s} ${JSON.stringify(wr.j?.data ?? wr.j?.error ?? null)} new=${JSON.stringify(impNew ?? null)} lines=${JSON.stringify(impLines)} r2=${JSON.stringify(r2Lines)} defs=${JSON.stringify(btp2Defs)}`)
  const badFile = [RIMP_HEAD,
    ['QA63BTP2', '', 'QA63 lỗi A', '100', 'QA63RM1', '1', '', '', ''],
    ['QA63BTP2', '', 'QA63 lỗi A', '', 'QA63EA1', '2', 'KG', '', ''],
    ['QA63BTP2', '', 'QA63 lỗi A', '', 'QA63KHONGCO', '2', '', '', ''],
  ]
  const bpf = await uploadXlsx(IMP, badFile, { preflight: true })
  const bwr = await uploadXlsx(IMP, badFile)
  const errTxt = (bpf.j?.data?.errors ?? []).join(' | ')
  const leaked = (await restAll('production_recipe', `select=id&material_id=eq.${M_BTP2}&name=eq.QA63 lỗi A`)).length
  const noQty = await uploadXlsx(IMP, [RIMP_HEAD.filter(h => h !== 'Số lượng *'), ['QA63BTP2', '', 'QA63 lỗi B', '100', 'QA63RM1', '', '', '']], { preflight: true })
  check('10s. File lỗi ⇒ báo theo SỐ DÒNG Excel (dòng 3 sai ĐVT · dòng 4 mã không có), nút ghi tắt; gửi ghi vẫn KHÔNG ghi gì; thiếu cột Số lượng ⇒ 400',
    bpf.s === 200 && bpf.j?.data?.will_write === 0 && /Dòng 3 — ĐVT "KG" khác đơn vị gốc EA/.test(errTxt) && /Dòng 4 — không có mã NVL "QA63KHONGCO"/.test(errTxt)
      && bwr.s === 200 && bwr.j?.data?.inserted === 0 && leaked === 0 && noQty.s === 400 && /Số lượng/.test(noQty.j?.error?.message ?? ''),
    `http=${bpf.s}/${bwr.s}/${noQty.s} errs=${errTxt.slice(0, 240)} leaked=${leaked} ${noQty.j?.error?.message ?? ''}`)
  // [10s2] DANH SÁCH MÃ cho file mẫu Nạp định mức (20/11): Mã BTP qua cùng hàm kiểm của lần nạp, Mã NVL = mọi mã của Mã hàng
  const catR = await api('/wms/production/recipes/import-catalog')
  const catB = (catR.j?.data?.btp ?? []).map(m => m.code), catN = (catR.j?.data?.nvl ?? []).map(m => m.code)
  check('10s2. File mẫu Nạp định mức — danh sách mã: Mã BTP có QA63BTP2, KHÔNG có mã NVL QA63RM1; Mã NVL có QA63RM1 + QA63EA1, mỗi dòng đủ tên + ĐVT',
    catR.s === 200 && catB.includes('QA63BTP2') && !catB.includes('QA63RM1') && catN.includes('QA63RM1') && catN.includes('QA63EA1')
      && (catR.j?.data?.nvl ?? []).find(m => m.code === 'QA63EA1')?.unit === 'EA',
    `http=${catR.s} btp=${catB.length} (QA63: ${catB.filter(c => c.startsWith('QA63')).join(',')}) nvl=${catN.length}`)
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
  // 25/11 rà soát B4: sửa mẻ đổi bồn + kế hoạch quá bồn mới ⇒ 409 và mẻ KHÔNG đổi gì (trước: kế hoạch / ghi chú đã ghi rồi mới báo lỗi)
  const upHalf = await api(`/wms/production/batches/${BX?.id}`, 'PATCH', { tank_id: T4.id, planned_qty: 1_000_000, note: 'QA63 sửa dở' })
  const bxNow = (await restAll('production_batch', `select=planned_qty,tank_id,note&id=eq.${BX?.id}`))[0]
  check('10j2. Sửa mẻ đổi bồn + kế hoạch vượt bồn mới ⇒ 409 MES_OVER_CAPACITY, mẻ giữ nguyên kế hoạch / bồn / ghi chú (một giao dịch)',
    upHalf.s === 409 && upHalf.j?.error?.code === 'MES_OVER_CAPACITY' && num(bxNow?.planned_qty) === 200 && bxNow?.tank_id === T6.id && bxNow?.note !== 'QA63 sửa dở',
    `http=${upHalf.s} ${upHalf.j?.error?.code} ${JSON.stringify(bxNow)}`)
  if (BX?.id) await api(`/wms/production/batches/${BX.id}/cancel`, 'POST', {})
  // (18/11) không còn "đóng mẻ" ⇒ mẻ KHÔNG MỞ duy nhất là mẻ đã huỷ (BX vừa huỷ ở trên)
  const rqClosed = await api(`/wms/production/batches/${BX?.id ?? 'x'}/requirements`, 'PUT', { items: [] })
  check('10h. Mẻ đã huỷ ⇒ sửa yêu cầu 409 MES_BATCH_NOT_OPEN', rqClosed.s === 409 && rqClosed.j?.error?.code === 'MES_BATCH_NOT_OPEN', `http=${rqClosed.s} ${rqClosed.j?.error?.code}`)

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
  const afterScan = await api(`/wms/production/batches/${BL?.id}/consume-scan`, 'POST', { entry_id: 'QA63_E2', qty: 1, qty_semantics: 'base' })
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
      && num(rm2nd?.used) === 1 && num(rm2nd?.by_batch?.[BL?.id]) === 1 && Math.abs(num(rm2nd?.book) - (sumStock - 1)) < 0.001,
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
  const stJ0 = await api(`/wms/production/batches/${B1.id}/process-log/JELLY/cell`, 'POST', { key: 'abc' })
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
  // (18/11) bỏ "Đóng mẻ" (user: không phải bước cần để đổ bồn) — TÌNH TRẠNG mẻ do MỘT hàm DB mes_batch_stage: dòng danh sách · ô tổng ·
  // lọc · trang mẻ (gate.stage). Mẻ đã nạp bồn ⇒ filled / released / rejected theo kết luận QA bồn.
  const clGone = await api(`/wms/production/batches/${B1.id}/close`, 'POST', {})
  const lsSt = await api(`/wms/production/batches?warehouse_id=${WC}&pageSize=200`)
  const rB1 = (lsSt.j?.data?.rows ?? []).find(r => r.id === B1.id)
  const wantSt = rB1?.qa_status === 'REJECTED' ? 'rejected' : rB1?.qa_status === 'RELEASED' ? 'released' : 'filled'
  const lsF = await api(`/wms/production/batches?warehouse_id=${WC}&pageSize=200&stage=${wantSt}`)
  const lsW = await api(`/wms/production/batches?warehouse_id=${WC}&pageSize=200&stage=wait_lead`)
  const lsBad = await api(`/wms/production/batches?warehouse_id=${WC}&stage=CLOSED`)
  const sumSt = lsSt.j?.data?.summary ?? {}
  const sumAll = ['new', 'wait_lead', 'wait_qa', 'working', 'filled', 'released', 'rejected', 'cancelled'].reduce((s, k) => s + num(sumSt[k]), 0)
  const gB1 = (await api(`/wms/production/batches/${B1.id}`)).j?.data?.gate?.stage
  check('9b. Bỏ "Đóng mẻ" (đường đóng mẻ 404); mẻ đã nạp ⇒ tình trạng theo QA bồn, dòng danh sách = trang mẻ; lọc tình trạng đúng; ô tổng cộng đủ',
    clGone.s === 404 && rB1?.stage === wantSt && gB1 === wantSt && (lsF.j?.data?.rows ?? []).some(r => r.id === B1.id)
      && (lsF.j?.data?.rows ?? []).every(r => r.stage === wantSt) && !(lsW.j?.data?.rows ?? []).some(r => r.id === B1.id)
      && lsBad.s === 400 && sumAll === num(sumSt.total) && num(sumSt.total) > 0,
    `close=${clGone.s} stage=${rB1?.stage}/${gB1} want=${wantSt} bad=${lsBad.s} sum=${JSON.stringify(sumSt)}`)
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
    const fb = await api('/wms/production/batches', 'POST', { warehouse_id: WC2, material_id: M_BTP, prod_date: todayVN, shift: 'Ca 1', cycle: 'Q2', tank_id: T3.id, planned_qty: 100 })
    const FB = fb.j?.data
    check('16a. Bật luồng chặt qua Cài đặt MES; mở mẻ ở kho 2 ⇒ mã lô QQ20001QA63-T3', setOn.s === 200 && setOn.j?.data?.mes_flow_gate === true && fb.s === 201 && FB?.batch_code === 'QQ20001QA63-T3', `http=${setOn.s}/${fb.s} ${FB?.batch_code}`)
    const fbOver = await api('/wms/production/batches', 'POST', { warehouse_id: WC2, material_id: M_BTP, prod_date: todayVN, shift: 'Ca 1', cycle: 'Q2', tank_id: T3.id, planned_qty: 401 })
    check('16b. Bồn 500 đã đặt 100 ⇒ mẻ kế hoạch 401 bị 409 MES_OVER_CAPACITY', fbOver.s === 409 && fbOver.j?.error?.code === 'MES_OVER_CAPACITY', `http=${fbOver.s}`)
    const rq = await api(`/wms/production/batches/${FB.id}/requirements`, 'PUT', { reason: 'QA63 khai phiếu', items: [{ material_id: M_RM, qty: 10 }] })
    const cNo = await api(`/wms/production/batches/${FB.id}/consume-scan`, 'POST', { entry_id: 'QA63_E16', qty: 10, qty_semantics: 'base' })
    const cNoLot = await api(`/wms/production/batches/${FB.id}/consume-lot`, 'POST', { material_id: M_RM, production_date: '2026-11-01', qty: 1, qty_semantics: 'base' })
    check('16c. Chưa duyệt ⇒ CẢ HAI cửa cấp NVL (quét tem · chọn lô) đều 409 MES_NOT_APPROVED', rq.s === 200 && cNo.s === 409 && cNo.j?.error?.code === 'MES_NOT_APPROVED' && cNoLot.s === 409 && cNoLot.j?.error?.code === 'MES_NOT_APPROVED', `http=${rq.s}/${cNo.s}/${cNoLot.s}`)
    // (18/11 d) BƯỚC ĐANG TỚI do DB tính (mes_batch_gate.step) — dải bước của trang mẻ và cột Tình trạng của danh sách đọc cùng giá trị
    const stepOf = async () => (await api(`/wms/production/batches/${FB.id}`)).j?.data?.gate?.step ?? null
    const stLead = await stepOf()
    const aQa0 = await api(`/wms/production/batches/${FB.id}/approve-qa`, 'POST', { approve: true })
    const aLead = await api(`/wms/production/batches/${FB.id}/approve-lead`, 'POST', { approve: true })
    const stQa = await stepOf()
    check('16c2. Bước đang tới: mẻ mới mở ⇒ "lead" (Trưởng ca duyệt); trưởng ca duyệt xong ⇒ "qa" (QA duyệt)', stLead === 'lead' && stQa === 'qa', `${stLead}/${stQa}`)
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
    // (18/11) "Check trước khi đổ bồn" CHỈ QUÉT — không khai chu kỳ / số mẻ / bồn: trang mẻ hỏi theo batch_id; thẻ bồn quét không batch_id
    // ⇒ server lấy mẻ từ mã lô in trong tem, bồn đang đứng = thẻ bồn
    const psOk = await api(`/wms/production/pour-status?batch_id=${FB.id}`)
    const psNone = await api('/wms/production/pour-status?batch_id=QA63_KHONG_CO_ME')
    const pbWrong = await api('/wms/production/pour-scan', 'POST', { tank_id: T5.id, code: L[0]?.qr })
    const pbNone = await api('/wms/production/pour-scan', 'POST', { tank_id: T3.id, code: 'MEB;QQ29999QA63-T3;1;2;1' })
    check('16g. Check trước khi đổ bồn chỉ quét: tình trạng theo mẻ ⇒ 200 kèm 0 tem đã quét; mẻ không có ⇒ 404; quét ở thẻ bồn (không gửi mẻ) tem của mẻ bồn khác ⇒ 409 MES_WRONG_TANK nói đúng bồn phải đổ; mã lô không có mẻ đang mở ⇒ 404 MES_LABEL_NO_BATCH',
      psOk.s === 200 && psOk.j?.data?.batch?.id === FB.id && (psOk.j?.data?.scans ?? []).length === 0 && psNone.s === 404
        && pbWrong.s === 409 && pbWrong.j?.error?.code === 'MES_WRONG_TANK' && /QA63-T3/.test(pbWrong.j?.error?.message ?? '')
        && pbNone.s === 404 && pbNone.j?.error?.code === 'MES_LABEL_NO_BATCH',
      `http=${psOk.s}/${psNone.s}/${pbWrong.s}/${pbNone.s} ${pbWrong.j?.error?.message} ${pbNone.j?.error?.code}`)
    const scBad = await api('/wms/production/pour-scan', 'POST', { batch_id: FB.id, tank_id: T3.id, code: 'QA63_P16' })
    const scOther = await api('/wms/production/pour-scan', 'POST', { batch_id: FB.id, tank_id: T3.id, code: 'MEB;QQ10001QA63-T1;1;2;1' })
    const scTank = await api('/wms/production/pour-scan', 'POST', { batch_id: FB.id, tank_id: T5.id, code: L[0]?.qr })
    const sc1 = await api('/wms/production/pour-scan', 'POST', { tank_id: T3.id, code: L[0]?.qr })   // thẻ bồn: mẻ lấy từ tem
    const sc1b = await api('/wms/production/pour-scan', 'POST', { batch_id: FB.id, tank_id: T3.id, code: L[0]?.qr })
    check('16h. Quét tem nguyên liệu ⇒ 422 NOT_BATCH_LABEL; tem của MẺ KHÁC ⇒ 409 MES_WRONG_LABEL; đứng SAI BỒN ⇒ 409 MES_WRONG_TANK; tem 1/2 quét ở thẻ bồn (không gửi mẻ) ⇒ 200 đúng mẻ; quét lại ⇒ 409 MES_ALREADY',
      scBad.s === 422 && scBad.j?.error?.code === 'NOT_BATCH_LABEL' && scOther.s === 409 && scOther.j?.error?.code === 'MES_WRONG_LABEL' && scTank.s === 409 && scTank.j?.error?.code === 'MES_WRONG_TANK'
        && sc1.s === 200 && sc1.j?.data?.batch?.id === FB.id && (sc1.j?.data?.scans ?? []).length === 1 && sc1b.s === 409 && sc1b.j?.error?.code === 'MES_ALREADY',
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
    check('16j. Đã quét đủ 3/3 nhưng phiếu còn ô bắt buộc ⇒ 409 MES_NOT_READY; cổng của mẻ liệt kê đúng ô thiếu; bước đang tới = "log" (Ghi phiếu)',
      plReq.s < 300 && num(gate1?.scanned) === 3 && (gate1?.missing ?? []).length === 1 && gate1.missing[0].key === 'qa63_start' && fNoLog.s === 409 && fNoLog.j?.error?.code === 'MES_NOT_READY' && /bắt buộc/.test(fNoLog.j?.error?.message ?? '')
        && gate1?.step === 'log',
      `http=${plReq.s}/${fNoLog.s} gate=${JSON.stringify(gate1 ?? null)}`)
    // (18/11) phiếu ghi TỪNG Ô: bấm ô giờ (không gửi giá trị) = giờ máy chủ + người bấm
    const st1 = await api(`/wms/production/batches/${FB.id}/process-log/MIX/cell`, 'POST', { key: 'qa63_start' })
    const st2 = await api(`/wms/production/batches/${FB.id}/process-log/MIX/cell`, 'POST', { key: 'qa63_start' })
    const stBad = await api(`/wms/production/batches/${FB.id}/process-log/MIX/cell`, 'POST', { key: 'qa63_temp' })
    const logRow = (await restAll('batch_process_log', `select=data,stamps&batch_id=eq.${FB.id}&form=eq.MIX`))[0]
    check('16k. Bấm mốc giờ ⇒ ghi HH:MM + người bấm; bấm lần 2 ⇒ 409 MES_ALREADY; ô không phải mốc giờ ⇒ 422',
      st1.s === 200 && /^\d\d:\d\d$/.test(st1.j?.data?.value ?? '') && logRow?.data?.qa63_start === st1.j?.data?.value && !!logRow?.stamps?.qa63_start?.by && logRow?.data?.qa63_temp === '45'
        && st2.s === 409 && st2.j?.error?.code === 'MES_ALREADY' && stBad.s === 422,
      `http=${st1.s}/${st2.s}/${stBad.s} ${JSON.stringify(logRow ?? null)}`)
    const edit = await api(`/wms/production/batches/${FB.id}/process-log/MIX`, 'PUT', { data: { qa63_temp: '45', qa63_start: '07:30' } })
    const logRow2 = (await restAll('batch_process_log', `select=data,stamps&batch_id=eq.${FB.id}&form=eq.MIX`))[0]
    check('16l. Sửa giờ đã bấm tại phiếu ⇒ lưu giờ mới + giữ vết người sửa', edit.s === 200 && logRow2?.data?.qa63_start === '07:30' && !!logRow2?.stamps?.qa63_start?.edited_by && !!logRow2?.stamps?.qa63_start?.by, JSON.stringify(logRow2 ?? null))
    // ghi MỘT ô có giá trị (khung nhập): sửa giờ đúng dạng · giờ sai dạng 422 · ô lạ 422 · xoá ô · ô số; cấu trúc lưu riêng không đè giá trị
    const cTime = await api(`/wms/production/batches/${FB.id}/process-log/MIX/cell`, 'POST', { key: 'qa63_start', value: '07:45' })
    const cBadT = await api(`/wms/production/batches/${FB.id}/process-log/MIX/cell`, 'POST', { key: 'qa63_start', value: '7h' })
    const cKey = await api(`/wms/production/batches/${FB.id}/process-log/MIX/cell`, 'POST', { key: 'khong_co_o', value: '1' })
    const cNum = await api(`/wms/production/batches/${FB.id}/process-log/MIX/cell`, 'POST', { key: 'qa63_temp', value: '52,5' })
    const cDel = await api(`/wms/production/batches/${FB.id}/process-log/MIX/cell`, 'POST', { key: 'qa63_temp', value: '' })
    const cStart = await api(`/wms/production/batches/${FB.id}/process-log/MIX/start`, 'POST', {})
    const onlyBlocks = await api(`/wms/production/batches/${FB.id}/process-log/MIX`, 'PUT', { blocks })
    const logRow3 = (await restAll('batch_process_log', `select=data,stamps,blocks&batch_id=eq.${FB.id}&form=eq.MIX`))[0]
    check('16l2. Ghi từng ô: sửa giờ ⇒ giờ mới + vết người sửa; giờ sai dạng / ô lạ ⇒ 422; ô số ghi rồi xoá; Bắt đầu lần 2 không ghi đè; lưu cấu trúc không gửi giá trị ⇒ giữ nguyên giá trị',
      cTime.s === 200 && cBadT.s === 422 && cBadT.j?.error?.code === 'MES_TIME' && cKey.s === 422 && cKey.j?.error?.code === 'MES_KEY'
        && cNum.s === 200 && cNum.j?.data?.value === '52,5' && cDel.s === 200 && cStart.s === 200 && cStart.j?.data?.changed === false
        && onlyBlocks.s === 200 && logRow3?.data?.qa63_start === '07:45' && !('qa63_temp' in (logRow3?.data ?? {})) && !!logRow3?.stamps?.qa63_start?.edited_by,
      `http=${cTime.s}/${cBadT.s}/${cKey.s}/${cNum.s}/${cDel.s}/${cStart.s}/${onlyBlocks.s} ${JSON.stringify(logRow3?.data ?? null)}`)
    // thiếu NVL ⇒ chưa nạp: huỷ dòng cấp rồi cấp lại
    const consId = (await restAll('batch_consumption', `select=id&batch_id=eq.${FB.id}&reversed_at=is.null`))[0]?.id
    await api(`/wms/production/consumption/${consId}/reverse`, 'POST', { reason: 'QA63 thử thiếu NVL' })
    const fShort = await api(`/wms/production/tanks/${T5.id}/fill`, 'POST', { batch_id: FB.id, qty: 100 })
    const stRm = await stepOf()
    await api(`/wms/production/batches/${FB.id}/consume-scan`, 'POST', { entry_id: 'QA63_E16', qty: 10, qty_semantics: 'base' })
    const stFill = await stepOf()
    // cột Tình trạng của danh sách mẻ: dòng đang làm mang CÙNG bước với trang mẻ
    const lrow = ((await api(`/wms/production/batches?warehouse_id=${WC2}&search=QQ20001`)).j?.data?.rows ?? []).find(r => r.id === FB.id)
    const fOk = await api(`/wms/production/tanks/${T5.id}/fill`, 'POST', { batch_id: FB.id, qty: 100 })
    const stAfter = await stepOf()
    check('16m. Nguyên liệu cấp chưa đủ ⇒ 409 MES_NOT_READY (nêu mã thiếu); đủ cả ba điều kiện ⇒ nạp 200', fShort.s === 409 && fShort.j?.error?.code === 'MES_NOT_READY' && /QA63RM1/.test(fShort.j?.error?.message ?? '') && fOk.s === 200,
      `http=${fShort.s}/${fOk.s} ${fShort.j?.error?.message} ${JSON.stringify(fOk.j?.error ?? null)}`)
    check('16m2. Bước đang tới: thiếu NVL ⇒ "rm" (Cấp nguyên liệu); đủ mọi điều kiện ⇒ "fill" (Nạp BTP vào bồn) — danh sách mẻ cùng "fill" ở dòng đang làm; đã nạp ⇒ "tankqa" (QA bồn)',
      stRm === 'rm' && stFill === 'fill' && lrow?.stage === 'working' && lrow?.step === 'fill' && stAfter === 'tankqa',
      `${stRm}/${stFill}/list=${lrow?.stage}:${lrow?.step}/${stAfter}`)
    const unQa = await api(`/wms/production/batches/${FB.id}/approve-qa`, 'POST', { approve: false })
    const tq = await api(`/wms/production/tanks/${T5.id}/qa`, 'POST', { qa_status: 'REJECTED', note: 'QA63 không đạt' })
    const tk = (await api(`/wms/production/tanks?warehouse_id=${WC2}`)).j?.data ?? []
    const t5 = tk.find(t => t.id === T5.id), t3 = tk.find(t => t.id === T3.id)
    const fbNow = (await restAll('production_batch', `select=qa_status,qa_note&id=eq.${FB.id}`))[0]
    check('16n. Đã nạp ⇒ QA không bỏ duyệt được (409 MES_FILLED); QA KHÔNG ĐẠT ở bồn ⇒ mẻ REJECTED + lý do; danh sách bồn: bồn 5 chứa 100 / không đạt, bồn 3 trống không còn phần đặt',
      unQa.s === 409 && unQa.j?.error?.code === 'MES_FILLED' && tq.s === 200 && fbNow?.qa_status === 'REJECTED' && fbNow?.qa_note === 'QA63 không đạt'
        && num(t5?.content) === 100 && t5?.qa_state === 'REJECTED' && num(t5?.reserved) === 0 && t3?.qa_state === 'EMPTY' && num(t3?.reserved) === 0,
      `http=${unQa.s}/${tq.s} ${JSON.stringify(fbNow ?? null)} t5=${JSON.stringify(t5 && { c: t5.content, q: t5.qa_state, r: t5.reserved })}`)

    // ── [17] BÁO CÁO NVL THEO CHU KỲ + MẺ TRÊN SƠ ĐỒ BỒN (18/11 f — "theo chu kỳ, tách ca, mẻ, nhân sự"; "mẻ hiện trên sơ đồ, liên kết tình trạng") ──
    const cl = await api(`/wms/production/cycles?warehouse_id=${WC2}`)
    const cQ2 = (cl.j?.data ?? []).find(c => c.cycle === 'Q2')
    check('17a. Danh sách chu kỳ của kho: Q2 có 1 mẻ, 1 mẻ đã nạp bồn', cl.s === 200 && num(cQ2?.batches) === 1 && num(cQ2?.filled) === 1, `http=${cl.s} ${JSON.stringify(cQ2 ?? null)}`)
    const cr = await api(`/wms/production/cycles/report?warehouse_id=${WC2}&cycle=q2`)
    const R = cr.j?.data
    const rb = (R?.batches ?? []).find(b => b.id === FB.id)
    const live16 = await restAll('batch_consumption', `select=material_id,qty,reversed_at&batch_id=eq.${FB.id}`)
    const sumDb = live16.filter(x => !x.reversed_at).reduce((s, x) => s + num(x.qty), 0)
    const sumRep = (R?.rows ?? []).reduce((s, r) => s + Object.values(r.cells ?? {}).reduce((a, c) => a + num(c.iss), 0), 0)
    const rmCell = (R?.rows ?? []).find(r => r.material_id === M_RM)?.cells?.[FB.id]
    check('17b. Báo cáo chu kỳ (gõ "q2" ⇒ Q2): mẻ QA loại, nạp 100, 1 lần cấp phải huỷ; ô NVL định mức 10 · thực cấp 10; Σ thực cấp = Σ lần cấp chưa huỷ trong sổ',
      cr.s === 200 && R?.cycle === 'Q2' && rb?.stage === 'rejected' && num(rb?.filled_qty) === 100 && num(rb?.rm_rev) >= 1
        && num(rmCell?.req) === 10 && num(rmCell?.iss) === 10 && Math.abs(sumRep - sumDb) < 1e-6,
      `http=${cr.s} b=${JSON.stringify(rb && { s: rb.stage, f: rb.filled_qty, rev: rb.rm_rev })} cell=${JSON.stringify(rmCell ?? null)} rep=${sumRep} db=${sumDb}`)
    const me = (R?.people ?? []).find(p => num(p.rm) >= 1)
    check('17c. Nhân sự của chu kỳ: người cấp có lần cấp ≥ 1, cấp phải huỷ ≥ 1, nạp bồn ≥ 1, quét đổ bồn ≥ 1, mở mẻ 1, duyệt TC + QA',
      !!me && num(me.rm_rev) >= 1 && num(me.fill) >= 1 && num(me.pour) >= 1 && num(me.open) === 1 && num(me.lead) === 1 && num(me.qaok) === 1,
      JSON.stringify(me ?? null))
    const crBad = await api(`/wms/production/cycles/report?warehouse_id=${WC2}&cycle=QABCDEFG`)
    const rawBad = await api(`/wms/production/consumption-raw?warehouse_id=${WC2}&cycle=QABCDEFG`)
    check('17d. Chu kỳ quá 6 ký tự ⇒ 400 BAD_CYCLE (báo cáo chu kỳ và dữ liệu thô cùng luật)',
      crBad.s === 400 && crBad.j?.error?.code === 'BAD_CYCLE' && rawBad.s === 400 && rawBad.j?.error?.code === 'BAD_CYCLE', `http=${crBad.s}/${rawBad.s}`)
    // sơ đồ bồn: mẻ đặt bồn mà chưa nạp đứng trên bồn kèm tình trạng + bước (cùng hàm cổng với danh sách mẻ)
    const qb = (await api('/wms/production/batches', 'POST', { warehouse_id: WC2, material_id: M_BTP, prod_date: todayVN, shift: 'Ca 2', cycle: 'Q3', tank_id: T3.id, planned_qty: 10 })).j?.data
    const inc = async () => ((await api(`/wms/production/tanks?warehouse_id=${WC2}`)).j?.data ?? []).find(t => t.id === T3.id)?.incoming?.find(x => x.batch_id === qb?.id)
    const i1 = await inc()
    // trưởng ca chỉ duyệt được phiếu đã có NVL (MES_EMPTY_SHEET) ⇒ khai một dòng trước
    await api(`/wms/production/batches/${qb?.id}/requirements`, 'PUT', { reason: 'QA63 khai phiếu', items: [{ material_id: M_RM, qty: 1 }] })
    const ap = await api(`/wms/production/batches/${qb?.id}/approve-lead`, 'POST', { approve: true })
    const i2 = await inc()
    await api(`/wms/production/batches/${qb?.id}/cancel`, 'POST', {})
    const cQ3 = ((await api(`/wms/production/cycles?warehouse_id=${WC2}&search=Q3`)).j?.data ?? []).find(c => c.cycle === 'Q3')
    check('17e. Sơ đồ bồn: mẻ đặt bồn chưa nạp mang tình trạng + bước — mới mở "wait_lead/lead", trưởng ca duyệt "wait_qa/qa"; huỷ ⇒ chu kỳ Q3 còn 0 mẻ (1 huỷ)',
      !!qb && i1?.stage === 'wait_lead' && i1?.step === 'lead' && i2?.stage === 'wait_qa' && i2?.step === 'qa' && num(cQ3?.batches) === 0 && num(cQ3?.cancelled) === 1,
      `${i1?.stage}/${i1?.step} → duyệt http=${ap.s} → ${i2?.stage}/${i2?.step} q3=${JSON.stringify(cQ3 ?? null)}`)

    // ── [19] DASHBOARD BÁO CÁO NVL THEO THỜI GIAN (22/11) — sổ tổng hợp dựng lúc nạp bồn, bấm vào ra dữ liệu, mục tiêu ở Cài đặt MES ──
    {
      const dq = (extra = '') => api(`/wms/production/dashboard?warehouse_id=${WC2}&date_from=${todayVN}&date_to=${todayVN}${extra}`)
      const fact = (await restAll('production_batch_fact', `select=batch_id,lines,extra,over,under,qa_status,total_kg,edit_kg&batch_id=eq.${FB.id}`))[0]
      const devl = await restAll('production_batch_dev_line', `select=material_id,state,std,sheet,iss&batch_id=eq.${FB.id}`)
      check('19a. Nạp bồn ⇒ sổ tổng hợp có mẻ (trigger): 1 dòng NVL NGOÀI ĐỊNH MỨC (khai tay vào phiếu, không có định mức gốc) · lệch +10 KG đều do sửa phiếu · QA bồn loại ghi theo (dựng lại khi mẻ đổi) · sổ dòng lệch có QA63RM1',
        !!fact && fact.lines === 1 && fact.extra === 1 && fact.qa_status === 'REJECTED' && num(fact.total_kg) === 10 && num(fact.edit_kg) === 10
          && devl.length === 1 && devl[0].material_id === M_RM && devl[0].state === 'extra' && num(devl[0].iss) === 10,
        JSON.stringify({ fact: fact ?? null, devl }))
      const db1 = await dq('&grain=batch')
      const D1 = db1.j?.data
      check('19b. Dashboard 1 ngày kho 2: 1 mẻ đã nạp · 0 đạt · 1 dòng ngoài định mức · lệch +10 KG (sửa phiếu +10) · QA loại 1 · điểm từng mẻ có mẻ này · NVL gây lệch đầu = QA63RM1',
        db1.s === 200 && num(D1?.totals?.batches) === 1 && num(D1?.totals?.filled) === 1 && num(D1?.totals?.pass) === 0 && num(D1?.totals?.extra) === 1
          && num(D1?.totals?.total_kg) === 10 && num(D1?.totals?.edit_kg) === 10 && num(D1?.totals?.qa_rejected) === 1
          && (D1?.points ?? []).some(p => p.id === FB.id) && D1?.pareto?.[0]?.code === 'QA63RM1' && num(D1?.pareto_total) === 1,
        `http=${db1.s} ${JSON.stringify(D1?.totals ?? db1.j?.error ?? null)}`)
      const dd = (extra) => api(`/wms/production/dashboard/detail?warehouse_id=${WC2}&date_from=${todayVN}&date_to=${todayVN}${extra}`)
      const dtB = await dd('&kind=batches&only=fail'), dtL = await dd(`&kind=lines&material_id=${M_RM}`), dtS = await dd(`&kind=batches&shift=${encodeURIComponent('Ca 2')}`)
      const lr = dtL.j?.data?.rows?.[0]
      check('19c. Bấm vào dashboard ra dữ liệu: "mẻ không đạt" = mẻ này · NVL QA63RM1 = 1 dòng (định mức 0 · phiếu 10 · thực cấp 10 · sửa phiếu +10) · lọc Ca 2 ⇒ 0 mẻ',
        dtB.s === 200 && num(dtB.j?.data?.total) === 1 && dtB.j?.data?.rows?.[0]?.id === FB.id
          && dtL.s === 200 && num(dtL.j?.data?.total) === 1 && lr?.state === 'extra' && num(lr?.std) === 0 && num(lr?.sheet) === 10 && num(lr?.iss) === 10 && num(lr?.edit) === 10
          && dtS.s === 200 && num(dtS.j?.data?.total) === 0,
        `http=${dtB.s}/${dtL.s}/${dtS.s} ${JSON.stringify(lr ?? null)}`)
      // 25/11 rà soát B7: bấm thẻ "Sửa phiếu" ⇒ số dòng ra = số dòng sửa phiếu của thẻ (trước: dòng trong dung sai không có trong sổ dòng)
      const dtE = await dd('&kind=lines&only=edited')
      check('19c2. Bấm "Sửa phiếu" ⇒ số dòng = số dòng sửa phiếu trên thẻ', dtE.s === 200 && num(dtE.j?.data?.total) === num(D1?.totals?.edited),
        `http=${dtE.s} rows=${dtE.j?.data?.total} card=${D1?.totals?.edited}`)
      const tPut = await api('/wms/production/settings', 'PUT', { warehouse_id: WC2, mes_dev_target_pct: 0.8, mes_pass_target_pct: 90 })
      const tBad = await api('/wms/production/settings', 'PUT', { warehouse_id: WC2, mes_dev_target_pct: 0 })
      const D2 = (await dq('&grain=batch')).j?.data
      const tNull = await api('/wms/production/settings', 'PUT', { warehouse_id: WC2, mes_dev_target_pct: null, mes_pass_target_pct: null })
      const D3 = (await dq('&grain=batch')).j?.data
      check('19d. Mục tiêu ở Cài đặt MES: đặt ±0,8% / 90% ⇒ dashboard dùng · 0 ⇒ 400 · xoá ⇒ về mặc định ±0,5% / 95%',
        tPut.s === 200 && num(tPut.j?.data?.mes_dev_target_pct) === 0.8 && tBad.s === 400 && num(D2?.targets?.dev_pct) === 0.8 && num(D2?.targets?.pass_pct) === 90
          && tNull.s === 200 && num(D3?.targets?.dev_pct) === 0.5 && num(D3?.targets?.pass_pct) === 95,
        `http=${tPut.s}/${tBad.s}/${tNull.s} t2=${JSON.stringify(D2?.targets ?? null)} t3=${JSON.stringify(D3?.targets ?? null)}`)
      const bad1 = await api(`/wms/production/dashboard?warehouse_id=${WC2}&date_from=2020-01-01&date_to=${todayVN}`)
      const bad2 = await api(`/wms/production/dashboard?warehouse_id=${WC2}&date_from=${todayVN}&date_to=2020-01-01`)
      const bad3 = await api(`/wms/production/dashboard?warehouse_id=${WC2}&date_from=${todayVN}&date_to=${todayVN}&grain=decade`)
      check('19e. Khoảng ngày quá 3 năm / ngược ⇒ 400 · cách gom lạ ⇒ 400', bad1.s === 400 && bad2.s === 400 && bad3.s === 400, `http=${bad1.s}/${bad2.s}/${bad3.s}`)
      // 23/11 — kỳ theo lịch: 3 năm = năm trước · năm này · năm sau gom theo NĂM; kỳ so do màn gửi (3 năm trước đó); kỳ so thiếu một đầu ⇒ 400
      const yy = Number(todayVN.slice(0, 4))
      const y3 = await api(`/wms/production/dashboard?warehouse_id=${WC2}&date_from=${yy - 1}-01-01&date_to=${yy + 1}-12-31&grain=year&prev_from=${yy - 4}-01-01&prev_to=${yy - 2}-12-31`)
      const Y3 = y3.j?.data
      const yBad = await api(`/wms/production/dashboard?warehouse_id=${WC2}&date_from=${yy}-01-01&date_to=${yy}-12-31&grain=month&prev_from=${yy - 1}-01-01`)
      check('19f. 3 năm gom theo NĂM: kỳ năm nay (khoá 01/01) có mẻ thử · kỳ so = 3 năm trước đó như màn gửi · kỳ so thiếu một đầu ⇒ 400',
        y3.s === 200 && (Y3?.buckets ?? []).some(b => b.k === `${yy}-01-01` && num(b.batches) >= 1) && (Y3?.buckets ?? []).every(b => /-01-01$/.test(b.k))
          && Y3?.prev_from === `${yy - 4}-01-01` && Y3?.prev_to === `${yy - 2}-12-31` && yBad.s === 400,
        `http=${y3.s}/${yBad.s} ${JSON.stringify((Y3?.buckets ?? []).map(b => b.k + ':' + b.batches))} prev=${Y3?.prev_from}→${Y3?.prev_to}`)
    }

    // ── [18] DỮ LIỆU THÔ TIÊU HAO NVL (18/11 g) + SƠ ĐỒ BỒN 2D ──
    const revN = live16.filter(x => !!x.reversed_at).length
    const rawQ = await api(`/wms/production/consumption-raw?warehouse_id=${WC2}&cycle=q2&page_size=1000`)
    const RW = rawQ.j?.data
    const rows18 = RW?.rows ?? []
    const sumSigned = rows18.reduce((s, r) => s + num(r.signed_qty), 0)
    const revRow = rows18.find(r => r.event === 'REVERSAL')
    check('18a. Dữ liệu thô chu kỳ Q2: số phát sinh = số lần cấp + số lần huỷ; Σ SL có dấu = Σ cấp còn hiệu lực; dòng Huỷ cấp SL âm, ghi ngày huỷ; mỗi dòng đủ mã lô BTP · mã NVL · ĐVT · kho · mã dòng',
      rawQ.s === 200 && revN >= 1 && num(RW?.total) === live16.length + revN && Math.abs(sumSigned - sumDb) < 1e-6
        && !!revRow && num(revRow.signed_qty) < 0 && revRow.at === revRow.reversed_at
        && num(RW?.summary?.issues) === live16.length && num(RW?.summary?.reversals) === revN
        && rows18.every(r => r.batch_code && r.mat_code && r.unit && r.wh_code && r.line_id),
      `http=${rawQ.s} total=${RW?.total} lines=${live16.length}+${revN} Σ=${sumSigned}/${sumDb}`)
    const ydVN = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    const rawDay = await api(`/wms/production/consumption-raw?warehouse_id=${WC2}&date_from=${ydVN}&date_to=${todayVN}&page_size=1000`)
    const badRange = await api(`/wms/production/consumption-raw?warehouse_id=${WC2}&date_from=${todayVN}&date_to=2020-01-01`)
    const noRange = await api(`/wms/production/consumption-raw?warehouse_id=${WC2}`)
    const badDay = await api(`/wms/production/consumption-raw?warehouse_id=${WC2}&date_from=2026-02-31&date_to=2026-03-01`)
    check('18b. Lọc theo NGÀY phát sinh (giờ VN): hôm qua → hôm nay có đủ phát sinh của Q2; Đến < Từ · thiếu cả ngày lẫn chu kỳ · ngày không có thật ⇒ 400',
      rawDay.s === 200 && num(rawDay.j?.data?.total) >= live16.length + revN && badRange.s === 400 && badRange.j?.error?.code === 'DATE_RANGE'
        && noRange.s === 400 && badDay.s === 400,
      `http=${rawDay.s}/${badRange.s}/${noRange.s}/${badDay.s} total=${rawDay.j?.data?.total}`)
    const exE = await api(`/wms/production/consumption-raw/export?warehouse_id=${WC2}&cycle=Q2&part=events`)
    const exR = await api(`/wms/production/consumption-raw/export?warehouse_id=${WC2}&cycle=Q2&part=req`)
    const exF = await api(`/wms/production/consumption-raw/export?warehouse_id=${WC2}&cycle=Q2&part=fill`)
    const evs = exE.j?.data?.rows ?? [], rqs = exR.j?.data?.rows ?? [], fls = exF.j?.data?.rows ?? []
    check('18c. File xuất (quyền export): phát sinh đủ dòng, sắp theo thời gian; định mức – thực cấp: Σ thực cấp = sổ, dòng NVL định mức 10 · thực cấp 10; nạp bồn: tổng 100 vào bồn QA63-T5',
      exE.s === 200 && evs.length === live16.length + revN && evs.every((r, i, a) => i === 0 || a[i - 1].at <= r.at)
        && exR.s === 200 && Math.abs(rqs.reduce((s, r) => s + num(r.iss), 0) - sumDb) < 1e-6 && rqs.some(r => r.batch_id === FB.id && num(r.req) === 10 && num(r.iss) === 10)
        && exF.s === 200 && fls.length >= 1 && Math.abs(fls.reduce((s, r) => s + num(r.qty), 0) - 100) < 1e-6 && fls.every(r => r.tank_code === 'QA63-T5'),
      `http=${exE.s}/${exR.s}/${exF.s} ev=${evs.length} req=${rqs.length} fill=${fls.length}`)
    const pg2 = await api(`/wms/production/consumption-raw?warehouse_id=${WC2}&cycle=Q2&sort=asc&page=2&page_size=1`)
    check('18d. Phân trang server: trang 2 cỡ 1 (sắp tăng) = dòng thứ 2 của file xuất; tổng không đổi theo trang',
      pg2.s === 200 && pg2.j?.data?.rows?.length === 1 && pg2.j.data.rows[0].line_id === evs[1]?.line_id && pg2.j.data.rows[0].event === evs[1]?.event
        && num(pg2.j?.data?.total) === live16.length + revN,
      `http=${pg2.s} ${pg2.j?.data?.rows?.[0]?.line_id}/${evs[1]?.line_id}`)
    const lay1 = await api('/wms/production/tank-layout', 'PUT', { items: [{ id: T3.id, x: 40, y: 80 }, { id: T5.id, x: 320, y: 80 }] })
    const tkL = (await api(`/wms/production/tanks?warehouse_id=${WC2}`)).j?.data ?? []
    const t3p = tkL.find(t => t.id === T3.id), t5p = tkL.find(t => t.id === T5.id)
    const lay2 = await api('/wms/production/tank-layout', 'PUT', { items: [{ id: T3.id, x: 40, y: 80 }] })
    const layBad = await api('/wms/production/tank-layout', 'PUT', { items: [{ id: T3.id, x: 40, y: null }] })
    const layNf = await api('/wms/production/tank-layout', 'PUT', { items: [{ id: 'QA63_NO_TANK', x: 0, y: 0 }] })
    const layDup = await api('/wms/production/tank-layout', 'PUT', { items: [{ id: T3.id, x: 0, y: 0 }, { id: T3.id, x: 20, y: 0 }] })
    const layReset = await api('/wms/production/tank-layout', 'PUT', { items: [{ id: T3.id, x: null, y: null }] })
    const t3r = (await restAll('production_tank', `select=map_x,map_y&id=eq.${T3.id}`))[0]
    check('18e. Sơ đồ 2D — lưu chỗ đặt: 2 bồn ⇒ 2, danh sách bồn trả map_x / map_y; lưu lại y hệt ⇒ 0; x có mà y trống ⇒ 400; bồn không có ⇒ 404; trùng bồn ⇒ 422; về tự xếp ⇒ null',
      lay1.s === 200 && num(lay1.j?.data?.updated) === 2 && t3p?.map_x === 40 && t3p?.map_y === 80 && t5p?.map_x === 320 && t5p?.map_y === 80
        && lay2.s === 200 && num(lay2.j?.data?.updated) === 0 && layBad.s === 400 && layNf.s === 404 && layDup.s === 422
        && layReset.s === 200 && num(layReset.j?.data?.updated) === 1 && t3r?.map_x == null && t3r?.map_y == null,
      `http=${lay1.s}/${lay2.s}/${layBad.s}/${layNf.s}/${layDup.s}/${layReset.s} t3=${t3p?.map_x},${t3p?.map_y} reset=${JSON.stringify(t3r ?? null)}`)
    const runId = randomUUID()
    await restWrite('packing_runs', 'POST', '', [{ id: runId, warehouse_id: WC2, run_date: todayVN, material_code: 'QA63BTP1', machine_code: 'QA63M', start_at: ts(),
      status: 'OPEN', tank_id: T5.id, created_at: ts(), updated_at: ts() }])
    const t5run = ((await api(`/wms/production/tanks?warehouse_id=${WC2}`)).j?.data ?? []).find(t => t.id === T5.id)
    await restWrite('packing_runs', 'DELETE', `id=eq.${runId}`)
    const t5none = ((await api(`/wms/production/tanks?warehouse_id=${WC2}`)).j?.data ?? []).find(t => t.id === T5.id)
    check('18f. Sơ đồ 2D — ống ra: sổ đóng gói ĐANG MỞ rút từ bồn 5 ⇒ danh sách bồn trả máy QA63M; sổ đã gỡ ⇒ không còn',
      t5run?.runs?.length === 1 && t5run.runs[0].machine_code === 'QA63M' && Array.isArray(t5none?.runs) && t5none.runs.length === 0,
      `${JSON.stringify(t5run?.runs ?? null)} / ${JSON.stringify(t5none?.runs ?? null)}`)
  }

  // ── [20] HÀNG CHẶN — "NVL đã mất" (25/11, user chốt: "huỷ lô nào thì tồn lô đó hồi về, block đúng lô; điều chỉnh làm đúng lô block" ·
  //        kiểm kê đối chiếu SAP ⇒ sổ chênh lệch). Oracle: tự tính tồn tem / phần chặn / tồn sổ rồi so với app.
  {
    const T20 = (await api('/wms/production/tanks', 'POST', { warehouse_id: WC, code: 'QA63-T20', capacity: 1000, unit: 'L' })).j?.data
    await restWrite('InventoryEntry', 'POST', null, [E('QA63_E20', 'QA63_P20', 30, WC, '2026-10-01', '2026-12-31')])   // NSX / HSD sớm nhất ⇒ đầu thứ tự luân chuyển
    const mkB = async (cycle) => (await api('/wms/production/batches', 'POST', { warehouse_id: WC, material_id: M_BTP, prod_date: todayVN, shift: 'Ca 1', cycle, tank_id: T20?.id })).j?.data
    const scan = async (bid, qty) => (await api(`/wms/production/batches/${bid}/consume-scan`, 'POST', { entry_id: 'QA63_E20', qty, qty_semantics: 'base' })).j?.data?.rows?.[0]
    const rem20 = async () => num((await restAll('InventoryEntry', 'select=cartons_remaining&id=eq.QA63_E20'))[0]?.cartons_remaining)
    const openBlk = async () => (await restAll('inventory_block', 'select=qty,qty_written_off,qty_released&pallet_code=eq.QA63_P20')).reduce((x, k) => x + num(k.qty) - num(k.qty_written_off) - num(k.qty_released), 0)
    const B20 = await mkB('Q20')
    const c1 = await scan(B20?.id, 10), c2 = await scan(B20?.id, 6)
    const rvBad = await api(`/wms/production/consumption/${c1?.id}/reverse`, 'POST', { reason: 'QA63 chặn quá', qty_block: 11, qty_semantics: 'base' })
    const rv1 = await api(`/wms/production/consumption/${c1?.id}/reverse`, 'POST', { reason: 'QA63 đổ vào mẻ hỏng', qty_block: 4, qty_semantics: 'base' })
    const r1 = await rem20(), o1 = await openBlk()
    check('20a. Huỷ cấp 10 chặn 4 ⇒ tem hoàn 6 dùng được (30 − 16 + 6 = 20), 4 chặn ĐÚNG tem; chặn > lượng cấp ⇒ 422 MES_BLOCK_QTY',
      !!c1?.id && !!c2?.id && rvBad.s === 422 && rvBad.j?.error?.code === 'MES_BLOCK_QTY' && rv1.s === 200 && r1 === 20 && o1 === 4,
      `scan=${!!c1?.id}/${!!c2?.id} bad=${rvBad.s} ${rvBad.j?.error?.code} rv=${rv1.s} tồn=${r1} chặn=${o1}`)
    const cxNo = await api(`/wms/production/batches/${B20?.id}/cancel`, 'POST', {})
    const cxStale = await api(`/wms/production/batches/${B20?.id}/cancel`, 'POST', { reason: 'QA63 mẻ hỏng', lines: [{ consumption_id: c1?.id, qty_block: 0 }], qty_semantics: 'base' })
    const cxOk = await api(`/wms/production/batches/${B20?.id}/cancel`, 'POST', { reason: 'QA63 mẻ hỏng', lines: [{ consumption_id: c2?.id, qty_block: 6 }], qty_semantics: 'base' })
    const b20 = (await api(`/wms/production/batches/${B20?.id}`)).j?.data
    const r2 = await rem20(), o2 = await openBlk()
    check('20b. Huỷ mẻ đã cấp: không gửi dòng ⇒ 409 BATCH_HAS_CONSUMPTION · sai tập dòng ⇒ 409 MES_LINES_CHANGED · đúng tập, chặn hết 6 ⇒ mẻ Huỷ có lý do, tồn tem giữ 20, chặn 10',
      cxNo.s === 409 && cxNo.j?.error?.code === 'BATCH_HAS_CONSUMPTION' && cxStale.s === 409 && cxStale.j?.error?.code === 'MES_LINES_CHANGED'
        && cxOk.s === 200 && b20?.status === 'CANCELLED' && b20?.cancel_reason === 'QA63 mẻ hỏng' && r2 === 20 && o2 === 10
        && num((b20?.consumption ?? []).find(c => c.id === c2?.id)?.block?.qty) === 6,
      `http=${cxNo.s}/${cxStale.s}/${cxOk.s} ${cxStale.j?.error?.code} st=${b20?.status} tồn=${r2} chặn=${o2}`)
    // sổ ca: ca đang mở của kho (mở ở [11]) — đếm = tồn sổ − 10 (phần chặn thật ra đã mất) rồi chốt
    let S = (await restAll('production_shift_report', `select=id&warehouse_id=eq.${WC}&status=eq.OPEN`))[0]?.id
    if (!S) S = (await api('/wms/production/shift-reports', 'POST', { warehouse_id: WC, report_date: todayVN, shift: 'Ca 20' })).j?.data?.id
    const rpO = await api(`/wms/production/shift-reports/${S}`)
    const rmO = (rpO.j?.data?.rows ?? []).find(r => r.material_id === M_RM)
    const useRm = (await restAll('InventoryEntry', `select=cartons_remaining&warehouse_id=eq.${WC}&material_id=eq.${M_RM}&status=in.(IN_STOCK,PARTIAL)`)).reduce((x, e) => x + num(e.cartons_remaining), 0)
    const blkRm = (await restAll('inventory_block', `select=qty,qty_written_off,qty_released&warehouse_id=eq.${WC}&material_id=eq.${M_RM}`)).reduce((x, k) => x + num(k.qty) - num(k.qty_written_off) - num(k.qty_released), 0)
    check('20c. Báo cáo ca: tồn sổ = tồn dùng được + đang chặn ("tồn về làm tồn ảo trước"), cột chặn = 10',
      rpO.s === 200 && Math.abs(num(rmO?.book) - (useRm + blkRm)) < 0.001 && num(rmO?.blocked) === 10 && blkRm === 10,
      `book=${rmO?.book} dùng được=${useRm} chặn=${rmO?.blocked}/${blkRm}`)
    const planOpen = await api(`/wms/production/shift-reports/${S}/adjust-plan`)
    const cnt = Math.round((num(rmO?.book) - 10) * 1000) / 1000
    const sv = await api(`/wms/production/shift-reports/${S}`, 'PUT', { items: [{ material_id: M_RM, qty_actual: cnt }], close: true })
    const plan = await api(`/wms/production/shift-reports/${S}/adjust-plan`)
    const pm = (plan.j?.data?.materials ?? []).find(m => m.material_id === M_RM)
    check('20d. Kế hoạch điều chỉnh: ca chưa chốt ⇒ không cho; chốt (đếm thiếu 10) ⇒ xoá đúng 10 từ 2 lô chặn của tem QA63_P20, không còn thiếu chưa rõ lô',
      planOpen.s === 200 && planOpen.j?.data?.ok === false && sv.s === 200 && plan.s === 200 && plan.j?.data?.ok === true && num(pm?.write_off) === 10
        && num(pm?.unexplained) === 0 && (pm?.blocks ?? []).filter(k => num(k.take) > 0).length === 2 && (pm?.blocks ?? []).every(k => k.pallet_code === 'QA63_P20'),
      `open=${planOpen.s}/${planOpen.j?.data?.ok} close=${sv.s} plan=${plan.s}/${plan.j?.data?.ok} ${JSON.stringify(pm ? { w: pm.write_off, u: pm.unexplained, n: pm.blocks?.length } : null)}`)
    const adj = await api(`/wms/production/shift-reports/${S}/adjust`, 'POST', { material_ids: [M_RM] })
    const adj2 = await api(`/wms/production/shift-reports/${S}/adjust`, 'POST', {})
    const rpA = await api(`/wms/production/shift-reports/${S}`)
    const rmA = (rpA.j?.data?.rows ?? []).find(r => r.material_id === M_RM)
    const r3a = await rem20(), o3 = await openBlk()
    check('20e. Điều chỉnh tồn theo số đếm ⇒ hết chặn, tồn dùng được của tem KHÔNG đổi (20), báo cáo ghi đã xoá 10 + người / lúc; bấm lần hai ⇒ 409 MES_ADJUST_NOT_ALLOWED',
      adj.s === 200 && o3 === 0 && r3a === 20 && num(rmA?.written_off) === 10 && !!rpA.j?.data?.report?.stock_adjusted_at
        && adj2.s === 409 && adj2.j?.error?.code === 'MES_ADJUST_NOT_ALLOWED',
      `http=${adj.s}/${adj2.s} ${adj2.j?.error?.code} chặn=${o3} tồn=${r3a} wo=${rmA?.written_off}`)
    // bỏ chặn / xoá từng lô (tab Chênh lệch tồn)
    const B21 = await mkB('Q21')
    const c3 = await scan(B21?.id, 3)
    await api(`/wms/production/consumption/${c3?.id}/reverse`, 'POST', { reason: 'QA63 bao rách', qty_block: 3, qty_semantics: 'base' })
    const k3 = (await restAll('inventory_block', `select=id&consumption_id=eq.${c3?.id}`))[0]?.id
    const relBad = await api(`/wms/production/blocks/${k3}/release`, 'POST', { qty: 5, qty_semantics: 'base' })
    const rel = await api(`/wms/production/blocks/${k3}/release`, 'POST', { qty: 2, note: 'QA63 dùng lại được', qty_semantics: 'base' })
    const wo = await api(`/wms/production/blocks/${k3}/write-off`, 'POST', { note: 'QA63 kiểm kê xác nhận mất' })
    const r4 = await rem20(), o4 = await openBlk()
    check('20f. Bỏ chặn quá phần chặn ⇒ 422; bỏ chặn 2 ⇒ tem +2 dùng được (20 − 3 + 0 + 2 = 19); xoá phần còn lại ⇒ hết chặn',
      !!k3 && relBad.s === 422 && rel.s === 200 && wo.s === 200 && r4 === 19 && o4 === 0, `http=${relBad.s}/${rel.s}/${wo.s} tồn=${r4} chặn=${o4}`)
    // sổ chênh lệch hôm nay
    const vq = (part, extra = '') => api(`/wms/production/stock-variance?warehouse_id=${WC}&date_from=${todayVN}&date_to=${todayVN}&part=${part}${extra}`)
    const vs = await vq('summary'), ve = await vq('events', `&material_id=${M_RM}&page_size=200`), vb = await vq('blocks')
    const vx = await api(`/wms/production/stock-variance/export?warehouse_id=${WC}&date_from=${todayVN}&date_to=${todayVN}&part=events`)
    const vBad = await api(`/wms/production/stock-variance?warehouse_id=${WC}&date_from=${todayVN}&date_to=2020-01-01`)
    const vNot = await api(`/wms/production/stock-variance?warehouse_id=${WP}&date_from=${todayVN}&date_to=${todayVN}`)
    const vr = (vs.j?.data?.rows ?? []).find(r => r.material_id === M_RM)
    const kinds = (ve.j?.data?.rows ?? []).filter(e => e.pallet_code === 'QA63_P20').map(e => e.kind)
    check('20g. Sổ chênh lệch (đối chiếu SAP): xoá hàng chặn 11 (10 theo số đếm + 1 tay) · chặn trong kỳ 13 · bỏ chặn 2 · đang chặn 0 · chênh = điều chỉnh khác − 11; từng tác động đủ 3 chặn / 1 bỏ chặn / 3 xoá; file xuất 200; kỳ ngược 400; kho không phải chế biến 422',
      vs.s === 200 && num(vr?.written_off) === 11 && num(vr?.blocked) === 13 && num(vr?.released) === 2 && num(vr?.blocked_open) === 0
        && Math.abs(num(vr?.variance) - (num(vr?.adjusted) - 11)) < 0.001
        && ve.s === 200 && kinds.filter(k => k === 'BLOCK').length === 3 && kinds.filter(k => k === 'RELEASE').length === 1 && kinds.filter(k => k === 'WRITE_OFF').length === 3
        && vb.s === 200 && !(vb.j?.data?.rows ?? []).some(b => b.pallet_code === 'QA63_P20') && vx.s === 200 && vBad.s === 400 && vNot.s === 422,
      `http=${vs.s}/${ve.s}/${vb.s}/${vx.s}/${vBad.s}/${vNot.s} ${JSON.stringify(vr ? { wo: vr.written_off, b: vr.blocked, rel: vr.released, adj: vr.adjusted, v: vr.variance } : null)} kinds=${kinds.join(',')}`)
    const led20 = await api('/wms/inventory/pallet-ledger?pallet_code=QA63_P20')
    const lk = new Set((led20.j?.data?.events ?? []).map(e => e.kind))
    check('20h. Sổ pallet của tem có Chặn · Bỏ chặn · Xoá hàng chặn', led20.s === 200 && lk.has('BLOCKED') && lk.has('BLOCK_RELEASED') && lk.has('BLOCK_WRITTEN_OFF'), `kinds=${[...lk].join(',')}`)
  }

  // ── [14] CHỨC DANH CHỈ CÓ QUYỀN SẢN XUẤT (16/11 — nghiệm thu bằng vai thật): form Mở / Sửa mẻ, Định mức tìm mã qua danh mục Mã hàng ──
  if (!bcrypt) console.log('  ⏭  [14] không load được bcrypt của backend — bỏ qua')
  else {
    const pw = 'Qa' + randomUUID().slice(0, 10) + '!'   // dùng một lần, không in
    await restWrite('JobTitle', 'POST', '', [
      { id: JT_OPEN, name: 'QA63 tổ trưởng chế biến', updated_at: ts(), module_permissions: { production: ['view', 'open_batch', 'consume', 'manage_tank'] } },
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
    // 18/11 g: hai cửa mới — dữ liệu thô (view đọc · export xuất file) và lưu chỗ đặt bồn (manage_tank), cắt theo kho được giao
    const putLay = async (tk, items) => (await fetch(`${BASE}/api/wms/production/tank-layout`, { method: 'PUT', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })).status
    const rawP = (w, exp = false) => `/wms/production/consumption-raw${exp ? '/export' : ''}?warehouse_id=${w}&date_from=${todayVN}&date_to=${todayVN}`
    const sRawView = tkView ? await st(tkView, rawP(WC)) : 0
    const sRawExp = tkView ? await st(tkView, rawP(WC, true)) : 0
    const sRawScope = tkView ? await st(tkView, rawP(WC2)) : 0
    const sLayView = tkView ? await putLay(tkView, [{ id: T1.id, x: 0, y: 0 }]) : 0
    const sLayScope = tkOpen ? await putLay(tkOpen, [{ id: T3.id, x: 0, y: 0 }]) : 0
    const sLayOk = tkOpen ? await putLay(tkOpen, [{ id: T1.id, x: 20, y: 40 }]) : 0
    const sImpView = tkView ? (await uploadXlsx('/wms/production/recipes/import', [RIMP_HEAD, ['QA63BTP2', '', 'QA63 vai', '100', 'QA63RM1', '1', '', '', '']], { preflight: true, token: tkView })).s : 0
    const sImpOpen = tkOpen ? (await uploadXlsx('/wms/production/recipes/import', [RIMP_HEAD, ['QA63BTP2', '', 'QA63 vai', '100', 'QA63RM1', '1', '', '', '']], { preflight: true, token: tkOpen })).s : 0
    const sCatView = tkView ? await st(tkView, '/wms/production/recipes/import-catalog') : 0
    check('14e. Nạp định mức từ Excel cần quyền "Khai định mức" (manage_recipe): chức danh chỉ xem 403 · chức danh mở mẻ 403 · danh sách mã của file mẫu 403', sImpView === 403 && sImpOpen === 403 && sCatView === 403, `view=${sImpView} open=${sImpOpen} catalog=${sCatView}`)
    // 22/11: dashboard Báo cáo NVL — quyền xem, cắt theo kho được giao (kho ngoài phạm vi 403)
    const dashP = (w) => `/wms/production/dashboard?warehouse_id=${w}&date_from=${todayVN}&date_to=${todayVN}`
    const sDashOk = tkView ? await st(tkView, dashP(WC)) : 0
    const sDashScope = tkView ? await st(tkView, dashP(WC2)) : 0
    const sDetScope = tkView ? await st(tkView, `/wms/production/dashboard/detail?warehouse_id=${WC2}&date_from=${todayVN}&date_to=${todayVN}&kind=batches`) : 0
    // 25/11 hàng chặn: xoá / bỏ chặn / điều chỉnh theo số đếm = quyền Điều chỉnh tồn (inventory.adjust) · huỷ mẻ đã cấp cần thêm "Huỷ dòng cấp" · sổ chênh lệch = quyền xem
    const sBlkOpen = tkOpen ? await postAs(tkOpen, '/wms/production/blocks/x/write-off', {}) : 0
    const sAdjView = tkView ? await st(tkView, '/wms/production/shift-reports/x/adjust-plan') : 0
    const sCxOpen = tkOpen ? await postAs(tkOpen, `/wms/production/batches/${B1.id}/cancel`, { reason: 'QA63', lines: [{ consumption_id: 'x', qty_block: 0 }] }) : 0
    const sVarView = tkView ? await st(tkView, `/wms/production/stock-variance?warehouse_id=${WC}&date_from=${todayVN}&date_to=${todayVN}`) : 0
    const sVarScope = tkView ? await st(tkView, `/wms/production/stock-variance?warehouse_id=${WC2}&date_from=${todayVN}&date_to=${todayVN}`) : 0
    check('14g. Hàng chặn: không có quyền Điều chỉnh tồn ⇒ xoá hàng chặn 403 · xem kế hoạch điều chỉnh 403; huỷ mẻ đã cấp khi thiếu quyền "Huỷ dòng cấp" ⇒ 403; sổ chênh lệch: kho mình 200 · kho ngoài phạm vi 403',
      sBlkOpen === 403 && sAdjView === 403 && sCxOpen === 403 && sVarView === 200 && sVarScope === 403, `blk=${sBlkOpen} plan=${sAdjView} cancel=${sCxOpen} var=${sVarView}/${sVarScope}`)
    check('14f. Dashboard Báo cáo NVL: chức danh chỉ xem đọc kho mình 200 · kho ngoài phạm vi 403 (cả bảng chi tiết khi bấm vào)', sDashOk === 200 && sDashScope === 403 && sDetScope === 403,
      `dash=${sDashOk}/${sDashScope} detail=${sDetScope}`)
    check('14d. Dữ liệu thô: chức danh chỉ xem đọc kho mình 200 · xuất file 403 (cần quyền export) · kho ngoài phạm vi 403; sơ đồ 2D: không có "Quản lý bồn" 403 · bồn kho ngoài phạm vi 403 · bồn kho mình 200',
      sRawView === 200 && sRawExp === 403 && sRawScope === 403 && sLayView === 403 && sLayScope === 403 && sLayOk === 200,
      `raw=${sRawView}/${sRawExp}/${sRawScope} layout=${sLayView}/${sLayScope}/${sLayOk}`)
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

  // ── [21] HÀNG KHÔNG TEM THEO NSX ở kho QR (26/11 — NVL không tem nhập Chế biến Ba Vì từng không có NSX ⇒ không HSD, không FEFO) ──
  {
    const dayAgo = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    const D1 = dayAgo(20), D2 = dayAgo(10), DF = dayAgo(-5)
    await restWrite('Material', 'POST', null, [
      { id: M_NT, material_code: 'QA63NT1', material_description: 'QA63 NVL không tem', short_name: 'QA63 NVL không tem', base_unit: 'KG', category: 'RM01', no_qr_tracking: true, shelf_life_days: 365, updated_at: ts() },
      { id: M_NT2, material_code: 'QA63NT2', material_description: 'QA63 bao bì không tem', short_name: 'QA63 bao bì không tem', base_unit: 'EA', category: 'PK01', no_qr_tracking: true, shelf_life_days: null, updated_at: ts() },
    ])
    const newOrder = async (mat) => (await api('/wms/inbound-orders', 'POST', { warehouse_id: WC, material_id: mat, source_type: 'FACTORY', import_date: todayVN, planned_cartons: 100 })).j?.data?.order?.id
    const save = (oid, body) => api(`/wms/inbound-orders/${oid}/scan-manual`, 'POST', body)
    const poolRows = (mat) => restAll('InventoryEntry', `select=id,production_date,cartons_remaining&warehouse_id=eq.${WC}&material_id=eq.${mat}&order=production_date.asc.nullsfirst`)
    const qOf = (rows, d) => num(rows.find(r => String(r.production_date ?? '').slice(0, 10) === d)?.cartons_remaining)
    const show = (rows) => JSON.stringify(rows.map(r => [String(r.production_date ?? '').slice(0, 10) || null, num(r.cartons_remaining)]))

    const o0 = await newOrder(M_NT)
    const d0 = o0 ? await api(`/wms/inbound-orders/${o0}`) : { s: 0 }
    const s0 = o0 ? await save(o0, { cartons: 4 }) : { s: 0 }
    const r0 = await poolRows(M_NT)
    check('21a. Cờ TẮT (mặc định) = hành vi cũ: Lưu thủ công hàng không tem không cần NSX ⇒ 1 dòng tồn NSX trống; trang phiếu báo không bắt NSX',
      !!o0 && s0.s === 200 && r0.length === 1 && r0[0].production_date == null && d0.j?.data?.noqr_pool_by_date === false,
      `order=${!!o0} http=${s0.s} ${s0.j?.error?.message ?? ''} rows=${show(r0)} flag=${d0.j?.data?.noqr_pool_by_date}`)
    await restWrite('InventoryEntry', 'DELETE', `warehouse_id=eq.${WC}&material_id=eq.${M_NT}`)   // dòng NSX trống không lẫn vào phép trừ theo NSX ở 21e

    const on = await api(`/masterdata/warehouses/${WC}`, 'PUT', { noqr_date_tracking: true })
    const whOn = (await restAll('Warehouse', `select=noqr_date_tracking&id=eq.${WC}`))[0]
    const o1 = await newOrder(M_NT)
    const d1 = o1 ? await api(`/wms/inbound-orders/${o1}`) : { s: 0 }
    const s1miss = o1 ? await save(o1, { cartons: 10 }) : { s: 0 }
    const s1fut = o1 ? await save(o1, { cartons: 10, production_date: DF }) : { s: 0 }
    const r1 = await poolRows(M_NT)
    check('21b. Bật "Hàng không tem theo NSX" ở tầng Kho (Cài đặt WMS) ⇒ trang phiếu báo bắt NSX; Lưu thủ công thiếu NSX ⇒ 422 NSX_REQUIRED · NSX tương lai ⇒ 422 NSX_FUTURE; không ghi tồn',
      on.s === 200 && whOn?.noqr_date_tracking === true && d1.j?.data?.noqr_pool_by_date === true
        && s1miss.s === 422 && s1miss.j?.error?.code === 'NSX_REQUIRED' && s1fut.s === 422 && s1fut.j?.error?.code === 'NSX_FUTURE' && r1.length === 0,
      `put=${on.s} db=${whOn?.noqr_date_tracking} flag=${d1.j?.data?.noqr_pool_by_date} miss=${s1miss.s}/${s1miss.j?.error?.code} fut=${s1fut.s}/${s1fut.j?.error?.code} rows=${r1.length}`)

    const s1 = o1 ? await save(o1, { cartons: 10, production_date: D1 }) : { s: 0 }
    const o2 = await newOrder(M_NT); const s2 = o2 ? await save(o2, { cartons: 10, production_date: D2 }) : { s: 0 }
    const o3 = await newOrder(M_NT); const s3 = o3 ? await save(o3, { cartons: 5, production_date: D1 }) : { s: 0 }
    const r3 = await poolRows(M_NT)
    check('21c. Mỗi NSX một dòng tồn; cùng NSX cộng dồn vào dòng đó (D1 10 + 5 = 15 · D2 10)',
      s1.s === 200 && s2.s === 200 && s3.s === 200 && r3.length === 2 && qOf(r3, D1) === 15 && qOf(r3, D2) === 10,
      `http=${s1.s}/${s2.s}/${s3.s} rows=${show(r3)}`)

    const tcfg = await api(`/masterdata/warehouses/${WC}/type-configs`, 'PUT', { items: [{ type_code: 'PK01', noqr_date_tracking: false }] })
    const o4 = await newOrder(M_NT2); const s4 = o4 ? await save(o4, { cartons: 7 }) : { s: 0 }
    const r4 = await poolRows(M_NT2)
    const o5 = await newOrder(M_NT); const s5 = o5 ? await save(o5, { cartons: 1 }) : { s: 0 }
    check('21d. Loại kho PK01 khai TẮT (kho vẫn bật) ⇒ mã PK01 lưu không cần NSX (1 dòng NSX trống); mã RM01 vẫn bị bắt NSX',
      tcfg.s === 200 && s4.s === 200 && r4.length === 1 && r4[0].production_date == null && s5.s === 422 && s5.j?.error?.code === 'NSX_REQUIRED',
      `cfg=${tcfg.s} ${tcfg.j?.error?.message ?? ''} pk=${s4.s} rows=${r4.length} rm=${s5.s}/${s5.j?.error?.code}`)

    // ── [22] CHUYẾN TRONG KHUÔN VIÊN: kho phụ xuất tiêu hao không cần biển số; kho thường vẫn cần ──
    const g = await api('/wms/outbound', 'POST', { delivery_date: todayVN, warehouse_id: WC, customer_name: 'QA63 xuất tiêu hao', delivery_code: `QA63XTH${Date.now() % 1e7}`, warehouse_type: 'RM01', items: [{ material_code: 'QA63NT1', cartons_ordered: 8 }] })
    const GID = g.j?.data?.id
    const st = GID ? await api(`/wms/outbound/${GID}/start`, 'POST', {}) : { s: 0 }
    const gRow = GID ? (await restAll('GroupDeliveryOrder', `select=started_at,license_plate&id=eq.${GID}`))[0] : null
    const gp = await api('/wms/outbound', 'POST', { delivery_date: todayVN, warehouse_id: WP, customer_name: 'QA63 kho thường', delivery_code: `QA63XTP${Date.now() % 1e7}`, warehouse_type: 'RM01', items: [{ material_code: 'QA63NT1', cartons_ordered: 1 }] })
    const stp = gp.j?.data?.id ? await api(`/wms/outbound/${gp.j.data.id}/start`, 'POST', {}) : { s: 0 }
    check('22a. Kho phụ xuất tiêu hao (không ship-to): Bắt đầu KHÔNG biển số ⇒ 200, chuyến đã bắt đầu, biển số trống',
      g.s < 300 && st.s === 200 && !!gRow?.started_at && !gRow?.license_plate, `create=${g.s} ${g.j?.error?.message ?? ''} start=${st.s} ${st.j?.error?.message ?? ''}`)
    check('22b. Kho thường (không phải kho phụ), không ship-to: Bắt đầu không biển số vẫn ⇒ 400 (luật cũ giữ nguyên)',
      gp.s < 300 && stp.s === 400, `create=${gp.s} start=${stp.s} ${stp.j?.error?.message ?? ''}`)
    // 22c (C137): form Tạo đơn tra "ship-to trỏ kho nào" để miễn ĐVVT / Loại xe / biển số cho chuyến trả về kho cha. Từng tra qua
    // danh mục Khách hàng ⇒ vai không có quyền Khách hàng (Phó phòng QA ở kho chế biến) bị đòi ĐVVT. Nay cửa riêng của Xuất kho.
    await restWrite('Customer', 'POST', '', [{ id: 'QA63_CUST', ship_to_code: 'QA63SHIP', name: 'QA63 kho cha (ship-to)', warehouse_id: WP, updated_at: ts() }])
    if (!bcrypt) console.log('  ⏭  22c không load được bcrypt của backend — bỏ qua')
    else {
      const pw3 = 'Qa' + randomUUID().slice(0, 10) + '!'
      await restWrite('JobTitle', 'POST', '', [{ id: JT_OUT, name: 'QA63 chỉ xem xuất kho', updated_at: ts(), module_permissions: { outbound: ['view', 'create'] } }])
      const eid = randomUUID()
      await restWrite('Employee', 'POST', '', [{ id: eid, employee_code: 'QA63R3', name: 'QA63 vai 3', email: 'qa63role3@test.local',
        password: await bcrypt.hash(pw3, 10), is_active: true, job_title_id: JT_OUT, warehouse_id: WC, warehouse_scope: 'ASSIGNED', updated_at: ts() }])
      await restWrite('UserWarehouseAccess', 'POST', '', [{ id: randomUUID(), employee_id: eid, warehouse_id: WC }])
      const lg = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'qa63role3@test.local', password: pw3 }) })
      const tk3 = (await lg.json().catch(() => null))?.data?.token ?? null
      const get3 = async (p) => { const r = await fetch(`${BASE}/api${p}`, { headers: { Authorization: `Bearer ${tk3}` } }); let j = null; try { j = await r.json() } catch {} return { s: r.status, j } }
      const sd = tk3 ? await get3('/wms/outbound/shipto-dest?shipto=qa63ship') : { s: 0 }
      const sdNone = tk3 ? await get3('/wms/outbound/shipto-dest?shipto=QA63KHONGCO') : { s: 0 }
      const cust = tk3 ? await get3('/masterdata/customers?search=QA63SHIP&page=1&page_size=5') : { s: 0 }
      check('22c. Chức danh chỉ có quyền Xuất kho (không quyền Khách hàng): tra ship-to ⇒ đúng kho cha (không phân biệt hoa thường), mã lạ ⇒ rỗng — danh mục Khách hàng với vai này 403 (đường cũ của form)',
        !!tk3 && sd.s === 200 && sd.j?.data?.dest?.id === WP && sdNone.s === 200 && sdNone.j?.data?.dest === null && cust.s === 403,
        `login=${!!tk3} dest=${sd.s}/${sd.j?.data?.dest?.id} lạ=${sdNone.s}/${JSON.stringify(sdNone.j?.data?.dest)} customers=${cust.s}`)
    }

    // 21e — cửa XUẤT của tồn gộp theo NSX: hộp Lưu số lượng + ghi nhận (cùng hàm `noQrPoolPolicy` với cửa nhập)
    const gd = GID ? await api(`/wms/outbound/${GID}`) : null
    const IID = gd?.j?.data?.delivery_orders?.[0]?.items?.[0]?.id
    const stock = IID ? await api(`/wms/outbound/${GID}/items/${IID}/manual-stock`) : { s: 0 }
    const pools = stock.j?.data?.date_pools ?? []
    const mc1 = IID ? await api(`/wms/outbound/${GID}/items/${IID}/manual-complete`, 'POST', { cartons: 5 }) : { s: 0 }
    const rA = await poolRows(M_NT)
    const mc2 = IID ? await api(`/wms/outbound/${GID}/items/${IID}/manual-complete`, 'POST', { cartons: 8, production_date: D2 }) : { s: 0 }
    const rB = await poolRows(M_NT)
    check('21e. Chuyến xuất: hộp Lưu số lượng liệt kê tồn theo NSX (cũ trước); ghi 5 ⇒ trừ NSX cũ nhất (D1 15→10); sửa lên 8 chọn NSX D2 ⇒ phần thêm 3 trừ đúng D2 (10→7)',
      stock.s === 200 && stock.j?.data?.pool_by_date === true && pools.length === 2 && String(pools[0]?.production_date ?? '').slice(0, 10) === D1
        && mc1.s === 200 && qOf(rA, D1) === 10 && qOf(rA, D2) === 10 && mc2.s === 200 && qOf(rB, D1) === 10 && qOf(rB, D2) === 7,
      `stock=${stock.s} byDate=${stock.j?.data?.pool_by_date} pools=${JSON.stringify(pools)} mc=${mc1.s}/${mc2.s} ${mc1.j?.error?.message ?? ''} ${mc2.j?.error?.message ?? ''} A=${show(rA)} B=${show(rB)}`)

    // ── [23] NHẬP NHIỀU MÃ (26/11): một chứng từ nhiều mã ⇒ mỗi mã một phiếu SX, chung receipt_group; kiểm hết rồi ghi một lô ──
    const shift = (await restAll('ImportShift', 'select=id&is_active=is.true&limit=1'))[0]
    await restWrite('Location', 'POST', '', [{ id: 'QA63_LOC1', location_code: 'QA63_L1', row: 'A', shelf: '1', max_pallets: 99, warehouse_id: WC, sub_code: 'QA63', updated_at: ts() }])
    const GM = (id, code) => ({ id, material_code: code, material_description: `QA63 NVL nhóm ${code}`, short_name: `QA63 ${code}`, base_unit: 'KG', category: 'RM01', no_qr_tracking: false, updated_at: ts() })
    await restWrite('Material', 'POST', '', [GM(M_G1, 'QA63G1'), GM(M_G2, 'QA63G2'), GM(M_G3, 'QA63G3')])
    const base = { warehouse_id: WC, warehouse_type: 'RM01', import_date: todayVN, shift_id: shift?.id, notes: 'QA63 chứng từ nội bộ' }
    const cnt = async () => (await restAll('ProductionImport', `select=id&warehouse_id=eq.${WC}&material_id=in.(${M_G1},${M_G2},${M_G3})`)).length
    const g1 = await api('/wms/inbound-orders/group', 'POST', { ...base, location_id: 'QA63_LOC1',
      lines: [{ material_id: M_G1, planned_cartons: 50 }, { material_id: M_G2, planned_cartons: 30 }, { material_id: M_NT, planned_cartons: 20 }] })
    const grp = g1.j?.data?.receipt_group
    const rows = grp ? await restAll('ProductionImport', `select=id,import_code,material_id,location_id,source_type,planned_cartons,receipt_group,status&receipt_group=eq.${grp}&order=import_code`) : []
    const byMat = new Map(rows.map(r => [r.material_id, r]))
    const seqs = rows.map(r => Number(String(r.import_code).split('_').pop()))
    check('23a. Nhập nhiều mã: 3 dòng (2 mã có tem + 1 mã không tem) ⇒ MỘT request tạo 3 phiếu SX chung nhóm; mã có tem nhận vị trí mặc định, mã không tem không vị trí; số phiếu liền nhau',
      g1.s === 200 && rows.length === 3 && rows.every(r => r.source_type === 'FACTORY' && r.status === 'OPEN')
        && byMat.get(M_G1)?.location_id === 'QA63_LOC1' && byMat.get(M_G2)?.location_id === 'QA63_LOC1' && byMat.get(M_NT)?.location_id == null
        && num(byMat.get(M_G1)?.planned_cartons) === 50 && num(byMat.get(M_NT)?.planned_cartons) === 20
        && seqs.length === 3 && seqs[1] === seqs[0] + 1 && seqs[2] === seqs[1] + 1,
      `http=${g1.s} ${g1.j?.error?.message ?? ''} rows=${JSON.stringify(rows.map(r => [r.import_code, r.location_id, r.planned_cartons]))}`)
    const lst = grp ? await api(`/wms/inbound-orders?receipt_group=${grp}`) : { s: 0 }
    check('23b. Danh sách lọc theo nhóm (Sửa nhóm · Quét cả nhóm) trả đủ 3 phiếu, mỗi phiếu mang receipt_group',
      lst.s === 200 && (lst.j?.data ?? []).length === 3 && (lst.j?.data ?? []).every(o => o.receipt_group === grp), `http=${lst.s} n=${(lst.j?.data ?? []).length}`)
    const before = await cnt()
    const bDup = await api('/wms/inbound-orders/group', 'POST', { ...base, location_id: 'QA63_LOC1', lines: [{ material_id: M_G3, planned_cartons: 5 }, { material_id: M_G3, planned_cartons: 6 }] })
    const bCat = await api('/wms/inbound-orders/group', 'POST', { ...base, location_id: 'QA63_LOC1', lines: [{ material_id: M_G3, planned_cartons: 5 }, { material_id: M_NT2, planned_cartons: 6 }] })
    const bLoc = await api('/wms/inbound-orders/group', 'POST', { ...base, lines: [{ material_id: M_G3, planned_cartons: 5 }] })
    const bFlag = await fetch(`${BASE}/api/wms/inbound-orders/group`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken()}` },
      body: JSON.stringify({ ...base, location_id: 'QA63_LOC1', lines: [{ material_id: M_G3, planned_cartons: 5 }] }) })
    check('23c. Kiểm hết rồi mới ghi: trùng mã · mã khác loại kho · thiếu vị trí mặc định (có mã theo tem) ⇒ 422 · thiếu cờ đơn vị gốc ⇒ 400; KHÔNG tạo phiếu nào',
      bDup.s === 422 && bCat.s === 422 && bLoc.s === 422 && bLoc.j?.error?.code === 'LOCATION_REQUIRED' && bFlag.status === 400 && (await cnt()) === before,
      `dup=${bDup.s} cat=${bCat.s} ${bCat.j?.error?.message ?? ''} loc=${bLoc.s}/${bLoc.j?.error?.code} cờ=${bFlag.status} trước=${before} sau=${await cnt()}`)
    const aAgain = grp ? await api('/wms/inbound-orders/group', 'POST', { ...base, location_id: 'QA63_LOC1', receipt_group: grp, lines: [{ material_id: M_G1, planned_cartons: 1 }] }) : { s: 0 }
    const aNew = grp ? await api('/wms/inbound-orders/group', 'POST', { ...base, location_id: 'QA63_LOC1', receipt_group: grp, lines: [{ material_id: M_G3, planned_cartons: 7.5 }] }) : { s: 0 }   // C140: mã KG ⇒ kế hoạch số lẻ
    const aOther = grp ? await api('/wms/inbound-orders/group', 'POST', { ...base, warehouse_id: WC2, location_id: null, receipt_group: grp, lines: [{ material_id: M_NT, planned_cartons: 1 }] }) : { s: 0 }
    const after = grp ? (await restAll('ProductionImport', `select=id&receipt_group=eq.${grp}`)).length : 0
    const g3Plan = num((await restAll('ProductionImport', `select=planned_cartons&material_id=eq.${M_G3}&receipt_group=eq.${grp}`))[0]?.planned_cartons)
    check('23d. Sửa nhóm — thêm mã vào nhóm có sẵn: mã đã có ⇒ 422 · mã mới ⇒ 200 vào CÙNG nhóm (4 phiếu), kế hoạch KG số lẻ 7,5 lưu nguyên (C140 — cột từng là integer ⇒ 500) · nhóm của kho khác ⇒ 422',
      aAgain.s === 422 && aNew.s === 200 && aNew.j?.data?.receipt_group === grp && after === 4 && g3Plan === 7.5 && aOther.s === 422,
      `có sẵn=${aAgain.s} mới=${aNew.s} ${aNew.j?.error?.message ?? ''} kế hoạch=${g3Plan} kho khác=${aOther.s} ${aOther.j?.error?.code ?? ''} nhóm=${after}`)
    // 23e (C138): mã CHƯA khai quy cách pallet + quét không gõ số ⇒ từng tạo PALLET 0 KG (bắt ở nghiệm thu Nhập nhiều mã)
    const dmy = `${todayVN.slice(8, 10)}${todayVN.slice(5, 7)}${todayVN.slice(2, 4)}`
    const oG1 = byMat.get(M_G1)
    const sq0 = oG1 ? await api(`/wms/inbound-orders/${oG1.id}/scan`, 'POST', { qr_code: `${dmy}_QA63G1_QA63_10009402_1_B`, location_id: 'QA63_LOC1' }) : { s: 0 }
    const ent0 = await restAll('InventoryEntry', `select=id,cartons_imported&material_id=eq.${M_G1}`)
    check('23e. (C138) Quét tem mã CHƯA khai quy cách pallet mà không gõ số lượng ⇒ 422 QTY_REQUIRED, không tạo pallet 0',
      sq0.s === 422 && sq0.j?.error?.code === 'QTY_REQUIRED' && ent0.length === 0,
      `http=${sq0.s} ${sq0.j?.error?.code ?? ''} ${sq0.j?.error?.message ?? ''} pallet=${JSON.stringify(ent0)}`)

    // ── 23f–i (26/11 lượt 2): UPLOAD chỉ tạo nhóm mới (loại kho THEO TỪNG MÃ) · Hoàn thành / Huỷ cả nhóm · Sửa nhóm đổi vị trí / NCC ──
    const upGroup = async (aoa, preflight, head = {}) => {
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Nhập nhiều mã')
      const fd = new FormData()
      fd.append('file', new Blob([Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'qa63_nhom.xlsx')
      for (const [k, v] of Object.entries({ warehouse_id: WC, import_date: todayVN, shift_id: shift?.id, location_id: 'QA63_LOC1', ...head })) if (v != null) fd.append(k, String(v))
      const r = await fetch(`${BASE}/api/wms/inbound-orders/group/upload${preflight ? '?preflight=1' : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${authToken()}` }, body: fd })
      let j = null; try { j = JSON.parse(await r.text()) } catch { /* không JSON */ }
      return { s: r.status, j }
    }
    const HEAD = ['Mã hàng *', 'Tên hàng', 'Số thùng', 'Số lẻ (ĐVT gốc)', 'Ghi chú']
    const upBefore = (await restAll('ProductionImport', `select=id&warehouse_id=eq.${WC}`)).length
    const pf = await upGroup([HEAD, ['QA63G1', 'đường', '', 10, ''], ['qa63nt2', 'bao bì', '', 5, 'thùng ngoài'], ['QA63G1', '', '', 5, ''], ['QA63KHONGCO', '', '', 3, '']], true)
    const pfd = pf.j?.data
    const upMid = (await restAll('ProductionImport', `select=id&warehouse_id=eq.${WC}`)).length
    const up = await upGroup([HEAD, ['QA63G1', 'đường', '', 10, ''], ['qa63nt2', 'bao bì', '', 5, 'thùng ngoài'], ['QA63G1', '', '', 5, '']], false)
    const upGrp = up.j?.data?.receipt_group
    const upRows = upGrp ? await restAll('ProductionImport', `select=id,material_id,warehouse_type,location_id,planned_cartons,notes&receipt_group=eq.${upGrp}`) : []
    const uG1 = upRows.find(r => r.material_id === M_G1), uNT2 = upRows.find(r => r.material_id === M_NT2)
    check('23f. Upload Nhập nhiều mã: kiểm trước KHÔNG ghi (mã lạ báo theo dòng Excel, mã trùng cộng gộp + cảnh báo); file sạch ⇒ MỘT nhóm trộn RM01 + PK01 (loại kho theo từng mã), mã trùng gộp 15, mã không tem không vị trí',
      pf.s === 200 && pfd?.preflight === true && (pfd?.errors ?? []).some(e => /QA63KHONGCO/.test(e) && /Dòng 5/.test(e)) && (pfd?.warnings ?? []).some(w => /cộng gộp/.test(w))
        && upMid === upBefore && up.s === 200 && num(up.j?.data?.inserted) === 2 && upRows.length === 2
        && uG1?.warehouse_type === 'RM01' && uG1?.location_id === 'QA63_LOC1' && num(uG1?.planned_cartons) === 15
        && uNT2?.warehouse_type === 'PK01' && uNT2?.location_id == null && /thùng ngoài/.test(uNT2?.notes ?? ''),
      `pf=${pf.s} lỗi=${JSON.stringify(pfd?.errors)} cảnh báo=${JSON.stringify(pfd?.warnings)} ghi giữa=${upMid - upBefore} up=${up.s} ${up.j?.error?.message ?? ''} rows=${JSON.stringify(upRows.map(r => [r.warehouse_type, r.location_id, r.planned_cartons]))}`)

    // 23g HOÀN THÀNH CẢ NHÓM (nhóm 23a: G1 · G2 · NT · G3) — chỉ phiếu đã nhận; nhận thiếu nêu riêng ở xem trước
    const oNT = byMat.get(M_NT)
    const sv = oNT ? await api(`/wms/inbound-orders/${oNT.id}/scan-manual`, 'POST', { cartons: 15, production_date: dayAgo(3) }) : { s: 0 }
    const cpv = grp ? await api(`/wms/inbound-orders/group/${grp}/complete?preview=1`, 'POST', {}) : { s: 0 }
    const cp = grp ? await api(`/wms/inbound-orders/group/${grp}/complete`, 'POST', {}) : { s: 0 }
    const afterCp = grp ? await restAll('ProductionImport', `select=id,material_id,status&receipt_group=eq.${grp}`) : []
    check('23g. Hoàn thành cả nhóm: xem trước = 1 phiếu đã nhận (mã không tem lưu 15/20 ⇒ nằm trong danh sách nhận THIẾU), 3 phiếu chưa nhận giữ mở; xác nhận ⇒ đúng phiếu đó COMPLETED',
      sv.s === 200 && cpv.s === 200 && (cpv.j?.data?.will ?? []).length === 1 && cpv.j?.data?.will?.[0]?.id === oNT?.id && (cpv.j?.data?.short ?? []).length === 1
        && (cpv.j?.data?.keep ?? []).length === 3 && cp.s === 200 && num(cp.j?.data?.completed) === 1
        && afterCp.find(r => r.id === oNT?.id)?.status === 'COMPLETED' && afterCp.filter(r => r.status === 'OPEN').length === 3,
      `lưu=${sv.s} ${sv.j?.error?.message ?? ''} xem=${cpv.s} will=${(cpv.j?.data?.will ?? []).length} short=${(cpv.j?.data?.short ?? []).length} keep=${(cpv.j?.data?.keep ?? []).length} làm=${cp.s}/${cp.j?.data?.completed}`)

    // 23h HUỶ CẢ NHÓM — chỉ phiếu đang mở chưa có hàng; phiếu đã hoàn thành giữ lại
    const xpv = grp ? await api(`/wms/inbound-orders/group/${grp}/cancel?preview=1`, 'POST', {}) : { s: 0 }
    const xc = grp ? await api(`/wms/inbound-orders/group/${grp}/cancel`, 'POST', {}) : { s: 0 }
    const afterX = grp ? await restAll('ProductionImport', `select=id,status&receipt_group=eq.${grp}`) : []
    check('23h. Huỷ cả nhóm: xem trước = 3 phiếu chưa nhận sẽ huỷ, phiếu đã hoàn thành giữ lại; xác nhận ⇒ còn đúng 1 phiếu (đã hoàn thành)',
      xpv.s === 200 && (xpv.j?.data?.will ?? []).length === 3 && (xpv.j?.data?.keep ?? []).length === 1
        && xc.s === 200 && num(xc.j?.data?.cancelled) === 3 && afterX.length === 1 && afterX[0].status === 'COMPLETED',
      `xem=${xpv.s} will=${(xpv.j?.data?.will ?? []).length} keep=${(xpv.j?.data?.keep ?? []).length} huỷ=${xc.s}/${xc.j?.data?.cancelled} còn=${JSON.stringify(afterX.map(r => r.status))}`)

    // 23i SỬA NHÓM đổi vị trí / NCC ⇒ mọi phiếu CHƯA quét (vị trí chỉ cho mã có tem); vị trí kho khác ⇒ 422
    await restWrite('Location', 'POST', '', [{ id: 'QA63_LOC2', location_code: 'QA63_L2', row: 'A', shelf: '2', max_pallets: 99, warehouse_id: WC, sub_code: 'QA63', updated_at: ts() },
      { id: 'QA63_LOCX', location_code: 'QA63_LX', row: 'A', shelf: '3', max_pallets: 99, warehouse_id: WC2, sub_code: 'QA63', updated_at: ts() }])
    const nccP = (await restAll('TransportCompany', 'select=id&type=eq.NCC&limit=1'))[0]
    const pt = upGrp ? await api(`/wms/inbound-orders/group/${upGrp}`, 'PATCH', { location_id: 'QA63_LOC2', ...(nccP ? { ncc_id: nccP.id } : {}) }) : { s: 0 }
    const ptBad = upGrp ? await api(`/wms/inbound-orders/group/${upGrp}`, 'PATCH', { location_id: 'QA63_LOCX' }) : { s: 0 }
    const afterPt = upGrp ? await restAll('ProductionImport', `select=material_id,location_id,ncc_id&receipt_group=eq.${upGrp}`) : []
    check('23i. Sửa nhóm đổi vị trí (+ NCC) ⇒ mọi phiếu chưa quét: mã có tem sang QA63_L2, mã không tem vẫn không vị trí, NCC đổi cả hai; vị trí thuộc kho khác ⇒ 422',
      pt.s === 200 && afterPt.find(r => r.material_id === M_G1)?.location_id === 'QA63_LOC2' && afterPt.find(r => r.material_id === M_NT2)?.location_id == null
        && (!nccP || afterPt.every(r => r.ncc_id === nccP.id)) && ptBad.s === 422,
      `patch=${pt.s} ${pt.j?.error?.message ?? ''} kho khác=${ptBad.s} rows=${JSON.stringify(afterPt.map(r => [r.location_id, r.ncc_id ? 'ncc' : null]))}`)

    // ── [24] PHIẾU NHẬP CHUNG + CÔNG TẮC NHẬP VƯỢT KẾ HOẠCH (26/11 — user chốt) ──
    // 24a đầu phiếu: số phiếu app sinh theo kho + ngày; Số chứng từ; trang phiếu chung; tìm theo số phiếu / số chứng từ
    const hd = async (g) => (await restAll('inbound_receipts', `select=id,receipt_code,doc_no,source_type,warehouse_id&id=eq.${g}`))[0]
    const hA = grp ? await hd(grp) : null, hU = upGrp ? await hd(upGrp) : null
    const g24 = await api('/wms/inbound-orders/group', 'POST', { ...base, location_id: 'QA63_LOC1', doc_no: 'QA63-CT-01',
      lines: [{ material_id: M_G2, planned_cartons: 10 }, { material_id: M_G3, planned_cartons: 4 }] })
    const gB = g24.j?.data?.receipt_group
    const rcp = gB ? await api(`/wms/inbound-receipts/${gB}`) : { s: 0 }
    const srch = await api(`/wms/inbound-orders?page=1&limit=50&warehouse_id=${WC}&search=QA63-CT-01`)
    const srchItems = srch.j?.data?.items ?? []
    const codeRe = /^QA63CB_PN_\d{6}_\d{3}$/
    check('24a. Phiếu chung: mỗi nhóm có ĐẦU PHIẾU (số <KHO>_PN_<ddmmyy>_<seq>, cả nhóm tạo tay lẫn upload) · Số chứng từ lưu ở đầu phiếu · trang phiếu chung trả đầu phiếu + 2 dòng mã + bảng pallet · tìm theo Số chứng từ ra đúng các dòng của phiếu, mỗi dòng mang đầu phiếu',
      codeRe.test(hA?.receipt_code ?? '') && codeRe.test(hU?.receipt_code ?? '') && g24.s === 200 && codeRe.test(g24.j?.data?.receipt_code ?? '')
        && rcp.s === 200 && rcp.j?.data?.receipt?.doc_no === 'QA63-CT-01' && (rcp.j?.data?.lines ?? []).length === 2 && Array.isArray(rcp.j?.data?.entries)
        && srch.s === 200 && srchItems.length === 2 && srchItems.every(o => o.receipt_group === gB && o.receipt?.doc_no === 'QA63-CT-01'),
      `số=${hA?.receipt_code}/${hU?.receipt_code}/${g24.j?.data?.receipt_code} tạo=${g24.s} ${g24.j?.error?.message ?? ''} trang=${rcp.s} dòng=${(rcp.j?.data?.lines ?? []).length} tìm=${srch.s}/${srchItems.length}`)

    // 24b nhóm NCC là phiếu chung: thiếu NCC ⇒ 422 · có NCC, không vị trí (chọn lúc quét) ⇒ 200, dòng nguồn NCC · lượt xe không có ⇒ 404
    const nccNo = await api('/wms/inbound-orders/group', 'POST', { ...base, source_type: 'NCC', lines: [{ material_id: M_G1, planned_cartons: 5 }] })
    const nccOk = nccP ? await api('/wms/inbound-orders/group', 'POST', { ...base, source_type: 'NCC', ncc_id: nccP.id, doc_no: 'QA63-NCC-1', lines: [{ material_id: M_G1, planned_cartons: 5 }] }) : { s: 0 }
    const nccGate = nccP ? await api('/wms/inbound-orders/group', 'POST', { ...base, source_type: 'NCC', ncc_id: nccP.id, gate_registration_id: 'QA63_KHONG_CO_LUOT', lines: [{ material_id: M_G1, planned_cartons: 5 }] }) : { s: 0 }
    const gN = nccOk.j?.data?.receipt_group
    const nRows = gN ? await restAll('ProductionImport', `select=source_type,location_id,ncc_id&receipt_group=eq.${gN}`) : []
    const hN = gN ? await hd(gN) : null
    check('24b. Nhóm NCC cũng là phiếu chung: thiếu NCC ⇒ 422 · có NCC, chưa chọn vị trí ⇒ 200, dòng nguồn NCC không vị trí, đầu phiếu nguồn NCC + số chứng từ · lượt xe không có ⇒ 404 (không tạo gì)',
      nccNo.s === 422 && (!nccP || (nccOk.s === 200 && nRows.length === 1 && nRows[0].source_type === 'NCC' && nRows[0].location_id == null && nRows[0].ncc_id === nccP.id
        && hN?.source_type === 'NCC' && hN?.doc_no === 'QA63-NCC-1' && nccGate.s === 404)),
      `thiếu NCC=${nccNo.s} có=${nccOk.s} ${nccOk.j?.error?.message ?? ''} lượt lạ=${nccGate.s} rows=${JSON.stringify(nRows)} đầu=${hN?.source_type}/${hN?.doc_no}`)

    // 24c NHẬP VƯỢT KẾ HOẠCH — cờ 2 tầng Kho + Loại kho; dòng G2 kế hoạch 10 KG (mã có tem, quét tem gõ số)
    const lG2 = (rcp.j?.data?.lines ?? []).find(l => l.material?.id === M_G2)
    let seq = 10009500
    const scanG2 = (qty) => lG2 ? api(`/wms/inbound-orders/${lG2.id}/scan`, 'POST', { qr_code: `${dmy}_QA63G2_QA63_${++seq}_1_B`, location_id: 'QA63_LOC1', cartons_override: qty }) : Promise.resolve({ s: 0 })
    const setWh = (v) => restWrite('Warehouse', 'PATCH', `id=eq.${WC}`, { inbound_over_plan: v, updated_at: ts() })
    await setWh('BLOCK')
    const ov1 = await scanG2(6)                 // 6 / 10 ⇒ qua
    const ov2 = await scanG2(6)                 // 12 / 10 ⇒ BLOCK chặn
    const ovEq = await scanG2(4)                // 10 / 10 ⇒ bằng kế hoạch vẫn qua
    await setWh('ALLOW')
    const ov3 = await scanG2(2)                 // 12 / 10 ⇒ ALLOW cho vượt
    const ordG2 = lG2 ? await api(`/wms/inbound-orders/${lG2.id}`) : { s: 0 }
    const rcp2 = gB ? await api(`/wms/inbound-receipts/${gB}`) : { s: 0 }
    const l2 = (rcp2.j?.data?.lines ?? []).find(l => l.material?.id === M_G2)
    // tầng Loại kho đè tầng Kho: kho ALLOW + RM01 BLOCK ⇒ chặn; bỏ cả hai (như cũ) ⇒ máy chủ không chặn
    await restWrite('warehouse_type_configs', 'POST', '', [{ id: 'QA63_TC_OVER', warehouse_id: WC, type_code: 'RM01', inbound_over_plan: 'BLOCK', updated_at: ts() }])
    const ov4 = await scanG2(1)
    await restWrite('warehouse_type_configs', 'DELETE', 'id=eq.QA63_TC_OVER')
    await setWh(null)
    const ov5 = await scanG2(1)
    const recvG2 = lG2 ? (await restAll('InventoryEntry', `select=cartons_imported&import_order_id=eq.${lG2.id}`)).reduce((a, e) => a + num(e.cartons_imported), 0) : 0
    check('24c. Nhập vượt kế hoạch (cờ 2 tầng): Kho = Chặn ⇒ pallet làm tổng 12 / KH 10 bị 422 OVER_PLAN, đúng bằng KH vẫn nhận · Kho = Cho vượt ⇒ nhận, trang phiếu báo Thừa 2, trang dòng trả over_plan=ALLOW + đầu phiếu · Loại kho = Chặn đè Kho = Cho vượt ⇒ 422 · bỏ cả hai (như cũ) ⇒ máy chủ không chặn',
      ov1.s === 200 && ov2.s === 422 && ov2.j?.error?.code === 'OVER_PLAN' && ovEq.s === 200 && ov3.s === 200
        && ordG2.s === 200 && ordG2.j?.data?.over_plan === 'ALLOW' && ordG2.j?.data?.receipt?.doc_no === 'QA63-CT-01'
        && Math.abs(num(l2?.diff) - 2) < 1e-9 && l2?.over_plan === 'ALLOW'
        && ov4.s === 422 && ov4.j?.error?.code === 'OVER_PLAN' && ov5.s === 200 && Math.abs(recvG2 - 13) < 1e-9,
      `quét=${[ov1, ov2, ovEq, ov3, ov4, ov5].map(r => r.s).join('/')} ${ov2.j?.error?.message ?? ''} ${ov1.s !== 200 ? ov1.j?.error?.message ?? '' : ''} luật=${ordG2.j?.data?.over_plan} chênh=${l2?.diff} nhận=${recvG2}`)

    // 24d Sửa phiếu đổi Số chứng từ ⇒ đầu phiếu đổi; 24e huỷ hết mã của phiếu ⇒ xoá luôn đầu phiếu
    const pDoc = gB ? await api(`/wms/inbound-orders/group/${gB}`, 'PATCH', { doc_no: 'QA63-CT-02' }) : { s: 0 }
    const hB2 = gB ? await hd(gB) : null
    const xN = gN ? await api(`/wms/inbound-orders/group/${gN}/cancel`, 'POST', {}) : { s: 0 }
    const hNgone = gN ? await hd(gN) : null
    check('24d. Sửa phiếu đổi Số chứng từ ⇒ đầu phiếu đổi · Huỷ cả phiếu khi mọi mã chưa nhận ⇒ xoá luôn đầu phiếu',
      pDoc.s === 200 && hB2?.doc_no === 'QA63-CT-02' && (!gN || (xN.s === 200 && !hNgone)),
      `sửa=${pDoc.s} ${pDoc.j?.error?.message ?? ''} số CT=${hB2?.doc_no} huỷ=${xN.s} đầu còn=${!!hNgone}`)
  }
} finally {
  await cleanup()
  const left = await restAll('Warehouse', `select=id&id=in.(${WP},${WC},${WC2})`)
  check('Z. Dọn sạch fixture QA63', left.length === 0, `còn ${left.length}`)
}
finish(PACK)
