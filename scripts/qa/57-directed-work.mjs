// GÓI 57 — VIỆC CẦN LÀM (Directed Work đợt 1c, user chốt 10/09/2026)
//
// Luật user chốt qua 6 vòng: kho HƯỚNG DẪN thì Bắt đầu chuyến sinh việc lấy hàng có THỨ TỰ cho 3 vai
// (xe nâng hạ · xe nâng chuyển · thủ kho); **quy tắc date phải được CHỐT cho từng dòng, FEFO cũng
// phải bấm xác nhận**, dòng chưa chốt KHÔNG lên bảng việc; xe nâng có nút "✓ Xong" phòng quên.
//
// VÌ SAO PHẢI GÁC BẰNG MÁY: kế hoạch lấy hàng sai KHÔNG BÁO LỖI — nó chỉ khiến người ta đi nhầm ô,
// lấy sai date, hoặc đứng chờ. Ba lớp dễ hỏng âm thầm nhất, gói này soi bằng ORACLE TỰ TÍNH LẠI:
//   (a) thứ tự luân chuyển (FEFO) — fixture cố tình để FEFO NGƯỢC thứ tự mã ô, nên bản chép tay nào
//       lỡ sort theo tên vị trí là lộ ngay;
//   (b) tổng số lượng việc = đúng nhu cầu còn lại (không thừa = giữ chỗ oan, không thiếu = xe về non);
//   (c) dòng CHƯA CHỐT date thì tuyệt đối không có việc nào.
//
// Fixture tự chứa: kho QA57 (QR) + bản vẽ + 2 cửa xuất (1 cửa khai Loại kho) + 2 điểm đầu dãy +
// kệ T1..T3 + ô sàn + ô nhặt lẻ + 2 mã × nhiều NSX. Dọn sạch cuối gói.
import { login, api, check, finish, restWrite, restAll, BASE } from './lib.mjs'
import { randomUUID } from 'crypto'

const T = 'QA57'
console.log('── GÓI 57: Việc cần làm — sinh việc theo vị trí · chốt %Date · 3 bảng theo vai · ✓ Xong ──')
await login()
const nowIso = () => new Date().toISOString()
const vnDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const err = r => `${r.j?.error?.code ?? ''} ${(r.j?.error?.message ?? '').slice(0, 110)}`.trim()
const dPlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

async function cleanup() {
  for (const g of await restAll('GroupDeliveryOrder', `select=id&group_code=like.${T}*`)) {
    // Chuyến ĐÃ HOÀN THÀNH tự sinh lệnh chuyển kho, và `TmsOrder.transfer_gdo_id` KHÔNG có CASCADE
    // ⇒ xoá chuyến bị chặn. Bản đầu của gói này nuốt lỗi bằng .catch() nên để lại kho rác và lượt
    // chạy sau đỏ ngay ở fixture (23505 trùng mã kho). Gỡ liên kết trước, rồi mới xoá.
    for (const o of await restAll('TmsOrder', `select=id&transfer_gdo_id=eq.${g.id}`)) {
      await restWrite('TmsVehicleSlot', 'DELETE', `order_id=eq.${o.id}`).catch(() => {})
      await restWrite('TmsOrder', 'DELETE', `id=eq.${o.id}`).catch(() => {})
    }
    await restWrite('ProductionImport', 'PATCH', `from_gdo_id=eq.${g.id}`, { from_gdo_id: null }).catch(() => {})
    await restWrite('wms_tasks', 'DELETE', `gdo_id=eq.${g.id}`).catch(() => {})
    for (const d of await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`)) {
      for (const it of await restAll('OutboundItem', `select=id&do_id=eq.${d.id}`))
        await restWrite('OutboundScanEntry', 'DELETE', `item_id=eq.${it.id}`).catch(() => {})
      await restWrite('OutboundItem', 'DELETE', `do_id=eq.${d.id}`).catch(() => {})
    }
    await restWrite('OutboundDelivery', 'DELETE', `gdo_id=eq.${g.id}`).catch(() => {})
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${g.id}`).catch(() => {})
  }
  for (const w of await restAll('Warehouse', `select=id&code=like.${T}*`)) {
    // Chuyến Hoàn thành ⇒ tự sinh lệnh chuyển kho + DÒNG KẾ HOẠCH NHẬP ở kho đích; dòng đó trỏ
    // `warehouse_id` (FK không CASCADE) nên còn nó là không xoá được kho — lượt sau đỏ ở fixture.
    await restWrite('inbound_plan_lines', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('InventoryEntry', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('warehouse_maps', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('warehouse_type_configs', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('Location', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})
    await restWrite('WarehouseZone', 'DELETE', `warehouse_id=eq.${w.id}`).catch(() => {})   // khu tạo ở [26]
    await restWrite('Warehouse', 'DELETE', `id=eq.${w.id}`).catch(() => {})
  }
  for (const m of await restAll('Material', `select=id&material_code=like.${T}*`))
    await restWrite('Material', 'DELETE', `id=eq.${m.id}`).catch(() => {})
}
await cleanup()

let whId = null
try {
  // ═══ [0] FIXTURE ══════════════════════════════════════════════════════════════════════════════
  const cats = await restAll('LookupValue', 'select=value&type=eq.warehouse_type&limit=3')
  const CAT_A = cats[0]?.value ?? 'FG01', CAT_B = cats[1]?.value ?? CAT_A
  // `Warehouse.warehouse_type` chỉ nhận 'CENTRAL'|'NPP' (app chặn 400 giá trị khác) — KHÔNG phải
  // Loại kho; Loại kho của kho nằm ở `warehouse_type_configs`. Nhét CAT_A vào đây là ghi giá trị
  // app từ chối, và làm bất biến warehouse_type_column_coverage (gói 00) đỏ oan.
  const [wh] = await restWrite('Warehouse', 'POST', null, {
    id: randomUUID(), code: `${T}_W`, name: 'QA directed work', warehouse_type: 'CENTRAL',
    inventory_mode: 'QR', require_gate_on_start: false, require_weigh_on_start: false,
    is_active: true, work_mode: 'MANUAL', lower_from_level: 2, updated_at: nowIso(),
  })
  whId = wh.id

  const [mat] = await restWrite('Material', 'POST', null, {
    id: randomUUID(), material_code: `${T}-M1`, material_description: 'QA directed', short_name: 'QA DW',
    category: CAT_A, base_unit: 'CS', cartons_per_pallet: 100, shelf_life_days: 365,
    is_active: true, created_at: nowIso(), updated_at: nowIso(),
  })

  // Bản vẽ 24×24 + cửa + điểm đầu dãy
  let r = await api(`/wms/warehouse-map/${whId}`, 'PUT', { width: 24, height: 24, cell_m: 1.2, blocked: [] })
  check('[0a] Dựng khung bản vẽ 24×24', r.s === 200, `http=${r.s} ${err(r)}`)
  r = await api(`/wms/warehouse-map/${whId}/objects`, 'POST', { kind: 'DOCK_OUT', name: 'Cua A', grid_x: 1, grid_y: 22 })
  const dockA = r.j?.data?.id
  r = await api(`/wms/warehouse-map/${whId}/objects`, 'POST', { kind: 'DOCK_OUT', name: 'Cua B', grid_x: 20, grid_y: 22 })
  const dockB = r.j?.data?.id
  // Sức chứa rộng: gói này KHÔNG kiểm lại luật SUẤT CỬA (đó là việc của gói 56). Để mặc định 1 xe
  // thì chuyến thứ hai của chính fixture ăn 422 DOCK_FULL và mọi phép kiểm sau đó đo nhầm thứ.
  for (const d of [dockA, dockB]) await api(`/wms/warehouse-map/${whId}/objects/${d}`, 'PATCH', { dock_capacity: 20 })
  r = await api(`/wms/warehouse-map/${whId}/objects`, 'POST', { kind: 'DROP', name: 'Dau day 1', grid_x: 4, grid_y: 20 })
  const dropA = r.j?.data?.id
  r = await api(`/wms/warehouse-map/${whId}/objects`, 'POST', { kind: 'DROP', name: 'Dau day 2', grid_x: 18, grid_y: 20 })
  const dropB = r.j?.data?.id
  check('[0b] 2 cửa xuất + 2 điểm đầu dãy', !!dockA && !!dockB && !!dropA && !!dropB, `A=${!!dockA} B=${!!dockB}`)

  // Kệ: 2 dãy × T1..T3 (mỗi tầng một Location dùng CHUNG một ô lưới) + ô sàn + ô nhặt lẻ
  const mkLoc = async (sub, row, shelf, gx, gy, extra = {}) => (await restWrite('Location', 'POST', null, {
    id: randomUUID(), location_code: `${T}_${sub}_${row}${shelf ? `_${shelf}` : ''}`, warehouse_id: whId,
    // `shelf` là cột NOT NULL (ô sàn khai chuỗi rỗng, không phải null)
    sub_code: sub, row, shelf: shelf || '', kind: 'STORAGE',
    is_rack: !!shelf, level_no: shelf ? Number(shelf.replace('T', '')) : 1,
    grid_x: gx, grid_y: gy, grid_w: 1, grid_h: 1, max_pallets: 50, is_active: true,
    created_at: nowIso(), updated_at: nowIso(), ...extra,
  }))[0].id
  // NEAR = gần cửa A (x=2) · FAR = xa cửa A (x=16)
  const near = {}, far = {}
  for (const t of ['T1', 'T2', 'T3']) {
    near[t] = await mkLoc('KA', '01', t, 2, 10)
    far[t]  = await mkLoc('KB', '02', t, 16, 10)
  }
  const locFloor = await mkLoc('SAN', '03', '', 6, 10)
  const locPick  = await mkLoc('NL', '04', '', 8, 20, { is_pick_face: true })
  check('[0c] Kệ 2 dãy × T1..T3 + ô sàn + ô nhặt lẻ', !!near.T3 && !!far.T3 && !!locFloor && !!locPick)

  // Pallet — CỐ Ý để FEFO NGƯỢC vị trí: pallet HSD ngắn nhất nằm ở dãy XA cửa và tầng CAO.
  //   FAR_T3  HSD +30 ngày  ← FEFO phải lấy ĐẦU TIÊN dù xa cửa + tầng 3
  //   NEAR_T1 HSD +200 ngày ← gần cửa, tầng thấp, nhưng date dài hơn ⇒ lấy SAU
  //   NEAR_T2 HSD +400 ngày
  //   LOWPCT  HSD +5 ngày (%Date rất thấp) ← FEFO lấy trước NHẤT, nhưng MIN_PCT 50 phải loại
  const mkPallet = async (code, qty, locId, exp, prodOffset = -30) => (await restWrite('InventoryEntry', 'POST', null, {
    id: randomUUID(), pallet_code: `${T}-${code}`, material_id: mat.id, warehouse_id: whId,
    location_id: locId, cartons_imported: qty, cartons_remaining: qty, cartons_reserved: 0,
    status: 'IN_STOCK', production_date: dPlus(prodOffset), expiry_date: exp,
    import_date: vnDate(), created_at: nowIso(), updated_at: nowIso(),
  }))[0]
  const pLow  = await mkPallet('LOWPCT',  50, far.T1,  dPlus(5),   -360)
  const pFar3 = await mkPallet('FAR_T3',  50, far.T3,  dPlus(30),  -300)
  const pNear1= await mkPallet('NEAR_T1', 50, near.T1, dPlus(200), -100)
  const pNear2= await mkPallet('NEAR_T2', 50, near.T2, dPlus(400), -20)
  // Pallet RIÊNG cho phép kiểm "chỉ định đúng NSX" — không dùng chung với các phép trên, vì giữ chỗ
  // mềm khiến pallet đã vào kế hoạch chuyến khác không còn được chia (đúng luật, nhưng làm hỏng phép kiểm)
  const pExact = await mkPallet('EXACT', 50, locFloor, dPlus(500), -7)
  check('[0d] 4 pallet — FEFO cố ý NGƯỢC thứ tự vị trí (HSD ngắn nhất ở dãy xa, tầng cao)',
    !!pLow.id && !!pFar3.id && !!pNear1.id && !!pNear2.id)

  // Nhân sự lái xe nâng thuộc kho
  // Phạm vi TOÀN QUỐC để qua được cửa kiểm "người này có được giao kho của chuyến không"
  // (kho fixture vừa tạo nên không ai được gán riêng).
  const [emp] = await restAll('Employee', 'select=id,name&is_active=is.true&warehouse_scope=eq.NATIONAL&limit=1')
  const drvId = emp?.id ?? null
  check('[0e] Có nhân sự phạm vi toàn quốc để làm lái xe nâng', !!drvId, drvId ? emp.name : 'KHÔNG TÌM THẤY — các phép kiểm sau sẽ sai')

  const mkTrip = async (suffix, cat = CAT_A) => {
    const [g] = await restWrite('GroupDeliveryOrder', 'POST', null, {
      id: randomUUID(), group_code: `${T}_${suffix}`, warehouse_id: whId, warehouse_type: cat,
      delivery_date: vnDate(), planned_date: vnDate(), status: 'PENDING',
      created_at: nowIso(), updated_at: nowIso(),
    })
    const [d] = await restWrite('OutboundDelivery', 'POST', null, {
      id: randomUUID(), gdo_id: g.id, delivery_code: `${T}_${suffix}_DO`, distributor_name: T,
      created_at: nowIso(), updated_at: nowIso(),
    })
    return { gdo: g.id, do: d.id }
  }
  const mkItem = async (doId, ordered, extra = {}) => (await restWrite('OutboundItem', 'POST', null, {
    id: randomUUID(), do_id: doId, material_id: mat.id, material_code_raw: mat.material_code,
    cartons_ordered: ordered, cartons_scanned: 0, status: 'PENDING',
    created_at: nowIso(), updated_at: nowIso(), ...extra,
  }))[0].id
  const tasksOf = g => restAll('wms_tasks', `select=*&gdo_id=eq.${g}&order=seq`)
  const startTrip = (g, body) => api(`/wms/outbound/${g}/start`, 'POST', body)

  // ═══ [1] KHO THỦ CÔNG → KHÔNG sinh việc (hành vi hôm nay không đổi) ═══════════════════════════
  const t1 = await mkTrip('T1')
  const i1 = await mkItem(t1.do, 120)
  r = await startTrip(t1.gdo, { license_plate: '51C11111', dock_location_id: dockA })
  check('[1] Kho THỦ CÔNG: Bắt đầu 200 và KHÔNG sinh việc nào',
    r.s === 200 && (await tasksOf(t1.gdo)).length === 0, `http=${r.s} ${err(r)}`)

  // ═══ [2] BẬT HƯỚNG DẪN — điều kiện nền ═══════════════════════════════════════════════════════
  r = await api(`/masterdata/warehouses/${whId}`, 'PUT', { work_mode: 'GUIDED', lower_from_level: 2 })
  check('[2a] Bật Hướng dẫn cho kho QR có bản vẽ → 200', r.s === 200, `http=${r.s} ${err(r)}`)
  const [whQty] = await restWrite('Warehouse', 'POST', null, {
    id: randomUUID(), code: `${T}_Q`, name: 'QA dw qty', warehouse_type: 'CENTRAL', inventory_mode: 'QTY',
    is_active: true, updated_at: nowIso(),
  })
  r = await api(`/masterdata/warehouses/${whQty.id}`, 'PUT', { work_mode: 'GUIDED' })
  check('[2b] Kho KHÔNG theo tem QR → 422 GUIDED_PREREQ (không bật được, nói rõ lý do)',
    r.s === 422 && r.j?.error?.code === 'GUIDED_PREREQ', `http=${r.s} ${err(r)}`)
  r = await api(`/masterdata/warehouses/${whId}`, 'PUT', { lower_from_level: 0 })
  check('[2c] Ngưỡng tầng 0 → 422 (1–50)', r.s === 422, `http=${r.s} ${err(r)}`)

  // ═══ [3] BẮT BUỘC XE NÂNG CHUYỂN ═════════════════════════════════════════════════════════════
  const t2 = await mkTrip('T2')
  const i2 = await mkItem(t2.do, 120)
  r = await startTrip(t2.gdo, { license_plate: '51C22222', dock_location_id: dockA })
  check('[3a] Kho Hướng dẫn thiếu xe nâng chuyển → 422 FORKLIFT_REQUIRED',
    r.s === 422 && r.j?.error?.code === 'FORKLIFT_REQUIRED', `http=${r.s} ${err(r)}`)
  r = await startTrip(t2.gdo, { license_plate: '51C22222', dock_location_id: dockA, forklift_driver_ids: ['khong-co-nguoi-nay'] })
  check('[3b] Id nhân sự lạ → 400 (không im lặng bỏ qua)', r.s === 400, `http=${r.s} ${err(r)}`)

  // ═══ [4] DÒNG CHƯA CHỐT %DATE → KHÔNG CÓ VIỆC (điểm user nhấn mạnh nhất) ═════════════════════
  r = await startTrip(t2.gdo, { license_plate: '51C22222', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
  const okStart = r.s === 200
  check('[4a] Bắt đầu 200 khi có xe nâng', okStart, `http=${r.s} ${err(r)}`)
  check('[4b] Dòng CHƯA chốt %Date → 0 việc, nhưng chuyến VẪN chạy + báo n dòng chưa chốt',
    okStart && (await tasksOf(t2.gdo)).length === 0 && Number(r.j?.data?.plan_unset_items ?? 0) === 1,
    `việc=${(await tasksOf(t2.gdo)).length} unset=${r.j?.data?.plan_unset_items}`)

  // ═══ [5] CHỐT FEFO → VIỆC XUẤT HIỆN, ĐÚNG THỨ TỰ LUÂN CHUYỂN (oracle) ════════════════════════
  r = await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i2], rule: { kind: 'FEFO' } })
  check('[5a] Chốt FEFO cho dòng → 200, chuyến được sắp lại', r.s === 200 && r.j?.data?.trips_replanned === 1, `http=${r.s} ${err(r)}`)
  let tk = await tasksOf(t2.gdo)
  check('[5b] Có việc sau khi chốt', tk.length > 0, `${tk.length} việc`)
  // ORACLE — tách BẠCH hai việc mà bản đầu của gói này trộn làm một (và suýt báo oan app):
  //   (a) CHỌN pallet nào  = luật luân chuyển (HSD ngắn nhất trước)
  //   (b) ĐI theo thứ tự nào = đường ngắn nhất từ cửa
  // Trộn hai cái là tự dựng kỳ vọng sai. Tính lại cả hai từ dữ liệu thô, không đọc của app.
  const hsdOf = Object.fromEntries([pLow, pFar3, pNear1, pNear2].map(p => [p.pallet_code, p.expiry_date]))
  const expSet = [pLow, pFar3, pNear1].map(p => p.pallet_code).sort()
  const gotSet = tk.map(t => t.pallet_code).sort()
  check('[5c] ORACLE FEFO (a) — chọn ĐÚNG tập 3 pallet HSD ngắn nhất, không phải pallet gần cửa',
    JSON.stringify(gotSet) === JSON.stringify(expSet), `app=${gotSet.join(',')} | đúng=${expSet.join(',')}`)
  const byHsd = tk.slice().sort((a, b) => String(hsdOf[a.pallet_code]).localeCompare(String(hsdOf[b.pallet_code])))
  check('[5c2] ORACLE FEFO (b) — pallet lấy LẺ phải là pallet HSD DÀI NHẤT trong tập (cắt ở đuôi)',
    byHsd[byHsd.length - 1]?.is_partial === true && byHsd.slice(0, -1).every(t => !t.is_partial),
    byHsd.map(t => `${t.pallet_code}(HSD ${String(hsdOf[t.pallet_code]).slice(5)}${t.is_partial ? ',lẻ' : ''})`).join(' → '))
  // ⚠ Bản trước của phép kiểm này khẳng định "thứ tự đi phải TĂNG DẦN theo khoảng cách từ cửa".
  // Đó là QUAN NIỆM SAI đóng khung thành luật (đúng lớp `feedback-qa-can-lock-in-the-bug`): một vòng
  // ngắn nhất KHÔNG có tính chất đó — nó đi sâu vào một dãy rồi vòng ra, nên khoảng cách tới cửa lên
  // xuống là chuyện bình thường. Đo 13/09 trên bản vẽ thật Ba Vì (BFS dựng ngoài app, TB 12 lượt):
  // sắp theo khoảng-cách-tới-cửa đi 4.013 m, còn vòng do `assignSeq` tính đi 3.854 m — tức chính cái
  // mà phép kiểm cũ đòi hỏi lại là cái đi XA HƠN. Giữ nguyên nó là khoá luôn đường cải tiến.
  //
  // Oracle ĐÚNG cho "đi một vòng, không nhảy" = KHÔNG QUAY LẠI Ô ĐÃ RỜI. Đây mới là tính chất thật
  // của một vòng đi, và nó bắt được hồi quy thật (sắp xen kẽ giữa các ô ⇒ A, B, A).
  const visitOrder = tk.map(t => t.from_location_code ?? t.from_location_id ?? '?')
  const firstSeen = new Map(), revisit = []
  visitOrder.forEach((code, i) => {
    if (!firstSeen.has(code)) { firstSeen.set(code, i); return }
    if (visitOrder[i - 1] !== code) revisit.push(`${code} (bước ${firstSeen.get(code) + 1} rồi lại bước ${i + 1})`)
  })
  check('[5c3] ORACLE đường đi — mỗi VỊ TRÍ làm xong một lần rồi mới đi tiếp, không quay lại ô đã rời',
    revisit.length === 0, revisit.length ? `quay lại: ${revisit.join(' · ')}` : visitOrder.join(' → '))
  const sumQty = tk.reduce((s, t) => s + Number(t.qty_base), 0)
  check('[5d] ORACLE số lượng: Σ việc = đúng nhu cầu 120 (không thừa = giữ chỗ oan, không thiếu = xe về non)',
    sumQty === 120, `Σ=${sumQty}`)
  check('[5e] Pallet cuối lấy một PHẦN → đánh dấu is_partial', tk.some(t => t.is_partial), tk.map(t => `${t.pallet_code}:${t.qty_base}${t.is_partial ? '(lẻ)' : ''}`).join(' '))
  check('[5f] Thứ tự đi 1..n, không trùng không hụt',
    tk.length > 0 && JSON.stringify(tk.map(t => t.seq)) === JSON.stringify(tk.map((_, i) => i + 1)), tk.map(t => t.seq).join(','))
  check('[5g] needs_lower ĐÚNG theo tầng (ngưỡng 2): T3/T2 cần hạ, T1 không',
    tk.length > 0 && tk.every(t => t.needs_lower === (Number(t.level_no ?? 0) >= 2)),
    tk.map(t => `${t.from_location_code}:L${t.level_no}${t.needs_lower ? '↓' : ''}`).join(' '))
  check('[5h] Việc cần hạ có ĐIỂM ĐẶT DÃY; việc lấy trực tiếp thì không',
    tk.length > 0 && tk.every(t => t.needs_lower ? !!t.drop_location_id : !t.drop_location_id))
  // Điểm đặt dãy phải là dãy CỦA PALLET, không phải điểm gần cửa nhất (14/09): dãy KB (x=16) có điểm
  // "Dau day 2" (x=18) ngay cạnh, còn "Dau day 1" (x=4) gần Cửa A — bản cũ chọn điểm 1 cho cả kho.
  const lowerTasks = tk.filter(t => t.needs_lower && t.drop_location_id)
  check('[5h2] Điểm đặt dãy = điểm GẦN Ô NGUỒN nhất (dãy KB → Dau day 2, dãy KA → Dau day 1), không phải gần cửa',
    lowerTasks.length > 0 && lowerTasks.every(t => t.drop_location_id === (/_KB_/.test(t.from_location_code ?? '') ? dropB : dropA)),
    lowerTasks.map(t => `${t.from_location_code}→${t.drop_location_id === dropB ? 'Dau day 2' : t.drop_location_id === dropA ? 'Dau day 1' : '?'}`).join(' '))
  check('[5i] Đích của việc ra cửa = CỬA của chuyến', tk.length > 0 && tk.every(t => t.to_location_id === dockA && t.to_kind === 'DOCK'))
  check('[5j] Có khoảng cách BFS từ cửa (bản vẽ đã vẽ)', tk.length > 0 && tk.every(t => t.dist_cells != null), tk.map(t => t.dist_cells).join(','))

  // ═══ [6] SẮP LẠI = BỎ VIỆC CHƯA AI ĐỤNG RỒI SINH LẠI (14/09) ═══════════════════════════════════
  // Trước 14/09 nút này gọi thẳng bộ sinh việc idempotent ⇒ luôn "0 việc mới" và ghim CŨ đứng nguyên
  // (16/18 việc Ba Vì lập bằng bộ lọc QA lỗi vẫn sống sau khi vá). Tồn không đổi thì sắp lại phải ra
  // ĐÚNG bộ pallet cũ, số việc treo không đổi, việc cũ chuyển CANCELLED lý do REPLANNED.
  r = await api(`/wms/directed/gdos/${t2.gdo}/replan`, 'POST', {})
  const tk2 = (await tasksOf(t2.gdo)).filter(t => t.status === 'PENDING')
  const pins = a => JSON.stringify(a.map(t => `${t.entry_id}:${t.qty_base}`).sort())
  check('[6] Sắp lại (tồn không đổi) → việc cũ bỏ lý do REPLANNED, việc mới ghim ĐÚNG bộ pallet cũ, số việc treo không đổi',
    r.s === 200 && r.j?.data?.created === tk.length && r.j?.data?.cancelled >= tk.length && tk.length > 0
      && tk2.length === tk.length && pins(tk2) === pins(tk)
      && (await tasksOf(t2.gdo)).filter(t => t.status === 'CANCELLED' && t.skip_reason === 'REPLANNED').length >= tk.length,
    `created=${r.j?.data?.created} cancelled=${r.j?.data?.cancelled} ${tk.length}→${tk2.length} cùng bộ pallet=${pins(tk2) === pins(tk)}`)
  tk = tk2      // các phép kiểm sau dùng bộ việc mới (id đã đổi)

  // ═══ [7] QUY TẮC ≥ %DATE loại pallet date thấp ═══════════════════════════════════════════════
  const t3 = await mkTrip('T3')
  const i3 = await mkItem(t3.do, 40)
  await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i3], rule: { kind: 'MIN_PCT', value: 50 } })
  r = await startTrip(t3.gdo, { license_plate: '51C33333', dock_location_id: dockB, forklift_driver_ids: drvId ? [drvId] : [] })
  const tk3 = await tasksOf(t3.gdo)
  check('[7a] Chốt "≥ 50 %" → KHÔNG lấy pallet %Date thấp dù FEFO xếp nó đầu',
    r.s === 200 && tk3.length > 0 && !tk3.some(t => t.pallet_code === pLow.pallet_code), tk3.map(t => t.pallet_code).join(','))
  check('[7b] Đích theo cửa của CHÍNH chuyến đó (cửa B), không phải cửa chuyến khác',
    tk3.length > 0 && tk3.every(t => t.to_location_id === dockB))

  // ═══ [8] CHỈ ĐỊNH ĐÚNG NSX (EXACT) ═══════════════════════════════════════════════════════════
  const t4 = await mkTrip('T4')
  const i4 = await mkItem(t4.do, 30)
  await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i4], rule: { kind: 'EXACT', value: String(pExact.production_date).slice(0, 10) } })
  r = await startTrip(t4.gdo, { license_plate: '51C44444', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
  const tk4 = await tasksOf(t4.gdo)
  check('[8] Chỉ định NSX → lấy ĐÚNG pallet NSX đó dù HSD dài nhất (FEFO xếp nó cuối)',
    r.s === 200 && tk4.length === 1 && tk4[0].pallet_code === pExact.pallet_code,
    tk4.map(t => t.pallet_code).join(',') || 'không có việc')

  // ═══ [9] GIỮ CHỖ MỀM — chuyến sau không chia lại pallet đã có chủ ════════════════════════════
  const usedByOthers = new Set([...tk, ...tk3, ...tk4].map(t => t.entry_id))
  check('[9] Không pallet nào bị chia cho 2 chuyến cùng lúc',
    usedByOthers.size > 0 && usedByOthers.size === [...tk, ...tk3, ...tk4].length,
    `${[...tk, ...tk3, ...tk4].length} việc / ${usedByOthers.size} pallet khác nhau`)

  // ═══ [10] BẢNG THEO VAI ══════════════════════════════════════════════════════════════════════
  const board = (mode, extra = '') => api(`/wms/directed/board?warehouse_id=${whId}&mode=${mode}${extra}`)
  let b = await board('LOWER')
  const lowerRows = b.j?.data?.rows ?? []
  check('[10a] Bảng "Cần hạ" chỉ có việc cần hạ, gom theo VỊ TRÍ',
    b.s === 200 && lowerRows.length > 0 && lowerRows.every(x => x.needs_lower), `http=${b.s} ${lowerRows.length} dòng`)
  // Cờ can_confirm quyết định NÚT "✓ Xong" có hiện hay không. Bản đầu dùng chung một điều kiện cho
  // cả 3 bảng nên "chờ xe hạ" khoá luôn tay của CHÍNH XE HẠ: bảng đầy việc mà không ai bấm xong được
  // — không lỗi nào nổ, chỉ nút biến mất. Playwright bắt được, gói này thì không ⇒ thêm phép kiểm.
  check('[10a2] Bảng "Cần hạ": việc CHƯA hạ phải BẤM ĐƯỢC (đó chính là việc của xe hạ)',
    lowerRows.length > 0 && lowerRows.filter(x => !x.stage_done).every(x => x.can_confirm === true),
    lowerRows.map(x => `${x.current_code}:${x.can_confirm}`).slice(0, 4).join(' '))
  b = await board('MOVE')
  const moveRows = b.j?.data?.rows ?? []
  // ĐỔI LUẬT 12/09 (user: "Cần hạ KHÔNG bắt buộc phải thao tác xác nhận đã hạ"): bản cũ khoá mọi
  // dòng chờ hạ ở bảng xe chuyển ⇒ không ai bấm tab Cần hạ thì bảng này đứng im cả ca. Phép kiểm cũ
  // khẳng định `can_confirm === false` — tức KHOÁ CHÍNH LỖI LẠI (lớp feedback-qa-can-lock-in-the-bug).
  check('[10b2] Bảng "Cần đưa ra": việc còn trên kệ VẪN bấm được, bằng một nút "Hạ & đưa ra"',
    moveRows.filter(x => x.waiting_lower && !x.stage_done && !x.skipped)
      .every(x => x.can_confirm === true && x.combined_lower === true),
    moveRows.filter(x => x.waiting_lower).map(x => `${x.current_code}:${x.can_confirm}/${x.combined_lower}`).slice(0, 4).join(' ') || 'không có dòng chờ hạ')
  check('[10b] Bảng "Cần đưa ra" hiện VỊ TRÍ HIỆN TẠI của pallet kể cả đang trên kệ',
    b.s === 200 && moveRows.length > 0 && moveRows.every(x => !!x.current_code), moveRows.map(x => x.current_code).join(' '))
  check('[10c] Dòng chưa hạ vẫn được đánh dấu "chờ xe hạ" để biết hiện trạng — nhưng KHÔNG bị khoá',
    moveRows.some(x => x.waiting_lower === true && x.can_confirm === true))
  // Bảng của xe chuyển phải NÓI HẾT phần việc của kho. Bộ lọc cũ còn loại hẳn việc "đưa về vị trí
  // nhặt lẻ còn trên kệ" nên phần việc đó chỉ sống ở tab Cần hạ — không tab nào nói ra là nó thiếu.
  {
    const allPending = await restAll('wms_tasks', `select=id&warehouse_id=eq.${whId}&status=eq.PENDING`)
    const shown = new Set(moveRows.flatMap(x => x.task_ids ?? []))
    const missing = allPending.filter(t => !shown.has(t.id))
    check('[10b3] "Cần đưa ra" không giấu việc nào: mọi việc còn treo của kho đều có mặt',
      allPending.length > 0 && missing.length === 0,
      `${allPending.length} việc treo · thiếu ${missing.length}`)
  }
  b = await board('SCAN', `&gdo_id=${t2.gdo}`)
  check('[10d] Bảng "Sắp quét" theo chuyến trả TỪNG pallet (thủ kho quét theo tem)',
    b.s === 200 && tk.length > 0 && (b.j?.data?.rows ?? []).length === tk.length, `${(b.j?.data?.rows ?? []).length} vs ${tk.length}`)
  b = await board('SCAN')
  check('[10e] "Sắp quét" thiếu chuyến → 400 (bảng này vô nghĩa nếu không chọn chuyến)', b.s === 400, `http=${b.s}`)
  b = await board('BAY')
  check('[10f] Chế độ xem lạ → 400', b.s === 400, `http=${b.s}`)
  b = await api(`/wms/directed/board?warehouse_id=${encodeURIComponent("' or 1=1--")}&mode=MOVE`)
  check('[10g] Mã kho kiểu injection → 400 (bộ mẫu chuẩn của gói 07)', b.s === 400, `http=${b.s}`)
  b = await api(`/wms/directed/board?mode=MOVE`)
  check('[10h] Thiếu mã kho → 400', b.s === 400, `http=${b.s}`)
  // NGÀY CHUYẾN phải theo được ra bảng: màn này lấy việc của MỌI chuyến đang chạy, không có mốc
  // thời gian nào — thiếu cột này thì chuyến bỏ dở từ tháng trước nằm lẫn với việc hôm nay mà
  // không ai phân biệt được, và băng "chưa chốt %Date" đếm luôn cả chúng nên ngày nào cũng kêu.
  b = await board('LOWER')
  const dRows = b.j?.data?.rows ?? []
  check('[10i] Mỗi dòng việc mang NGÀY CHUYẾN (để tách việc hôm nay với chuyến cũ còn dở)',
    dRows.length > 0 && dRows.every(x => !!x.delivery_date), `${dRows.filter(x => !x.delivery_date).length}/${dRows.length} dòng thiếu ngày`)
  const dUnset = b.j?.data?.unset_items ?? []
  check('[10j] Dòng "chưa chốt %Date" cũng mang ngày chuyến',
    dUnset.every(u => 'delivery_date' in u), dUnset.length ? `${dUnset.length} dòng` : 'không có dòng chưa chốt lúc này')

  // ═══ [10k] HỘP VIỆC theo người (đợt C, 12/09) — mọi nguồn về 3 vùng, số khớp với bảng vai ═══════
  b = await api(`/wms/directed/inbox?warehouse_id=${whId}`)
  const ib = b.j?.data ?? {}
  check('[10k] Hộp việc trả 3 vùng (mine · shared · waiting) + counts',
    b.s === 200 && Array.isArray(ib.mine) && Array.isArray(ib.shared) && Array.isArray(ib.waiting) && typeof ib.counts?.mine === 'number',
    `http=${b.s} mine=${ib.mine?.length} shared=${ib.shared?.length} waiting=${ib.waiting?.length}`)
  // Oracle: "Cần hạ n pallet" ở vùng chung = tổng pallet chưa hạ trên bảng Cần hạ (chưa ai nhận)
  const waitPallets = dRows.filter(x => !x.stage_done && !x.skipped && !x.claim_active).reduce((s, x) => s + Number(x.n_pallets), 0)
  const ibLower = (ib.shared ?? []).find(x => x.source === 'LOWER')
  check('[10k2] Vùng chung: dòng "Cần hạ" khớp tổng pallet chờ hạ chưa ai nhận trên bảng Cần hạ',
    waitPallets === 0 ? !ibLower : (!!ibLower && Number(ibLower.n) === waitPallets && ibLower.link.includes('tab=LOWER')),
    `bảng=${waitPallets} hộp=${ibLower?.n ?? 'không có dòng'}`)
  const ibDate = (ib.shared ?? []).find(x => x.source === 'DATE')
  check('[10k3] Vùng chung: dòng "Khai quy định date" ≥ số dòng chưa chốt của chuyến đang chạy, trỏ trang Quy định date',
    dUnset.length === 0 ? true : (!!ibDate && Number(ibDate.n) >= dUnset.length && ibDate.link === '/wms/outbound/date-rules'),
    `chưa chốt=${dUnset.length} hộp=${ibDate?.n ?? 'không có dòng'}`)
  check('[10k4] Mỗi dòng hộp việc đủ trường hiển thị (title · n · link · warehouse)',
    [...ib.mine, ...ib.shared, ...ib.waiting].every(x => typeof x.title === 'string' && Number.isFinite(Number(x.n)) && typeof x.link === 'string' && !!x.warehouse_id),
    `${[...ib.mine, ...ib.shared, ...ib.waiting].length} dòng`)
  b = await api(`/wms/directed/inbox?warehouse_id=${encodeURIComponent("' or 1=1--")}`)
  check('[10k5] Hộp việc: mã kho kiểu injection → 400', b.s === 400, `http=${b.s}`)
  // Giám sát (quyền replan): chuyến đang chạy có mặt, khối theo ngày / theo người / lead time có hình dạng
  b = await api(`/wms/directed/supervision?warehouse_id=${whId}&days=7`)
  const sv = b.j?.data ?? {}
  check('[10l] Giám sát trả live · by_person · by_day · lead_time, chuyến T2 có trong live',
    b.s === 200 && Array.isArray(sv.live) && Array.isArray(sv.by_person) && Array.isArray(sv.by_day) && typeof sv.lead_time === 'object'
      && sv.live.some(l => l.gdo_id === t2.gdo && Number.isFinite(Number(l.pending))),
    `http=${b.s} live=${sv.live?.length} person=${sv.by_person?.length} day=${sv.by_day?.length}`)
  b = await api(`/wms/directed/supervision?warehouse_id=${whId}&days=9999`)
  check('[10l2] Giám sát kẹp số ngày về trần 90', b.s === 200 && b.j?.data?.days === 90, `days=${b.j?.data?.days}`)

  // ═══ [11] NÚT "✓ XONG" ═══════════════════════════════════════════════════════════════════════
  const lowerGroup = lowerRows.find(x => x.task_ids?.length)
  if (!lowerGroup) throw new Error('Bảng Cần hạ rỗng — không có nhóm nào để thử nút ✓ Xong')
  r = await api('/wms/directed/tasks/confirm', 'POST', { task_ids: lowerGroup.task_ids, stage: 'LOWER' })
  check('[11a] Xe hạ bấm "✓ Xong" cả nhóm vị trí → ghi mốc đã hạ',
    r.s === 200 && r.j?.data?.changed === lowerGroup.task_ids.length, `http=${r.s} ${err(r)}`)
  let after = await restAll('wms_tasks', `select=id,lowered_at,confirm_source&id=in.(${lowerGroup.task_ids.join(',')})`)
  check('[11b] Mốc "đã hạ" + nguồn xác nhận = MANUAL', after.every(t => t.lowered_at && t.confirm_source === 'MANUAL'))
  b = await board('MOVE')
  const nowMovable = (b.j?.data?.rows ?? []).find(x => x.task_ids?.some(id => lowerGroup.task_ids.includes(id)))
  check('[11c] Hạ xong → dòng đó sang bảng xe chuyển ở trạng thái bấm được',
    !!nowMovable && nowMovable.waiting_lower === false && nowMovable.can_confirm === true,
    nowMovable ? `chờ hạ=${nowMovable.waiting_lower} bấm được=${nowMovable.can_confirm}` : 'không thấy dòng')
  r = await api('/wms/directed/tasks/confirm', 'POST', { task_ids: lowerGroup.task_ids, stage: 'LOWER', undo: true })
  after = await restAll('wms_tasks', `select=id,lowered_at&id=in.(${lowerGroup.task_ids.join(',')})`)
  check('[11d] Bấm nhầm → bỏ đánh dấu được', r.s === 200 && after.every(t => !t.lowered_at), `http=${r.s}`)
  await api('/wms/directed/tasks/confirm', 'POST', { task_ids: lowerGroup.task_ids, stage: 'LOWER' })
  r = await api('/wms/directed/tasks/confirm', 'POST', { task_ids: ['khong-co-viec-nay'], stage: 'LOWER' })
  check('[11e] Việc không tồn tại → 404 (không 5xx)', r.s === 404, `http=${r.s}`)
  r = await api('/wms/directed/tasks/confirm', 'POST', { task_ids: [tk[0].id], stage: 'ABC' })
  check('[11f] Giai đoạn lạ → 400', r.s === 400, `http=${r.s}`)
  const ev = await restAll('wms_task_events', `select=event&task_id=eq.${lowerGroup.task_ids[0]}&order=at`)
  check('[11g] Sổ sự kiện ghi đủ vết (lập · hạ · bỏ · hạ lại)', ev.length >= 3, ev.map(e => e.event).join(' → '))

  // ═══ [12] QUÉT ĐÓNG VIỆC ═════════════════════════════════════════════════════════════════════
  const firstTask = tk[0]
  r = await api(`/wms/outbound/${t2.gdo}/items/${i2}/scan`, 'POST', {
    qr_code: firstTask.pallet_code, qty_semantics: 'base', leftover_ui: true, leftover_location_id: 'KEEP',
  })
  const okScan = r.s === 200
  const afterScan = (await restAll('wms_tasks', `select=status,done_at,confirm_source,moved_at&id=eq.${firstTask.id}`))[0]
  check('[12a] Thủ kho quét đúng pallet kế hoạch → việc XONG, tự điền mốc còn trống',
    okScan && afterScan?.status === 'DONE' && !!afterScan?.done_at && afterScan?.confirm_source === 'SCAN' && !!afterScan?.moved_at,
    `http=${r.s} ${err(r)} status=${afterScan?.status}`)
  b = await board('SCAN', `&gdo_id=${t2.gdo}`)
  const doneRow = (b.j?.data?.rows ?? []).find(x => x.pallet_codes?.includes(firstTask.pallet_code))
  check('[12b] Việc xong VẪN Ở LẠI bảng (gạch ngang) — user chốt "phòng tình huống bị quên"',
    !!doneRow && doneRow.stage_done === true, doneRow ? 'còn trong bảng' : 'ĐÃ BIẾN MẤT')

  // Quét pallet KHÁC cùng mã → bỏ một việc treo + sắp bù
  const otherPallet = (await restAll('InventoryEntry',
    `select=pallet_code&warehouse_id=eq.${whId}&cartons_remaining=gt.0&pallet_code=neq.${firstTask.pallet_code}&limit=5`))
    .map(e => e.pallet_code).find(pc => !tk.some(t => t.pallet_code === pc))
  if (otherPallet) {
    const before = (await tasksOf(t2.gdo)).filter(t => t.status === 'PENDING').length
    r = await api(`/wms/outbound/${t2.gdo}/items/${i2}/scan`, 'POST', {
      qr_code: otherPallet, qty_semantics: 'base', leftover_ui: true, leftover_location_id: 'KEEP',
    })
    const skipped = (await tasksOf(t2.gdo)).filter(t => t.status === 'SKIPPED' && t.skip_reason === 'OTHER_PALLET')
    check('[12c] Quét pallet KHÁC kế hoạch → không chặn, việc cũ ghi "lấy pallet khác", kế hoạch tự lành',
      r.s === 200 && skipped.length > 0, `http=${r.s} ${err(r)} bỏ=${skipped.length} treo trước=${before}`)
    // (12/09) Việc bị bỏ KHÔNG được biến mất không lời: xe hạ đã hạ pallet đó xuống rồi. Bảng phải trả dòng
    // đó kèm lý do, gạch xám, không bấm được — và không đè lên nhóm việc còn treo cùng ô.
    b = await board('SCAN', `&gdo_id=${t2.gdo}`)
    const skRow = (b.j?.data?.rows ?? []).find(x => x.skipped === true)
    check('[12d] Bảng trả việc ĐÃ BỎ kèm lý do (skipped + skip_reason), không bấm được',
      !!skRow && skRow.skip_reason === 'OTHER_PALLET' && skRow.can_confirm === false,
      skRow ? `${skRow.pallet_codes?.[0]} · ${skRow.skip_reason} · bấm được=${skRow.can_confirm}` : 'không thấy dòng đã bỏ trên bảng')
    check('[12d2] Ô tổng có số việc đã bỏ', Number(b.j?.data?.totals?.skipped ?? 0) >= skipped.length,
      `totals.skipped=${b.j?.data?.totals?.skipped}`)
    const liveRows = (b.j?.data?.rows ?? []).filter(x => !x.skipped)
    check('[12d3] Dòng đã bỏ đứng nhóm RIÊNG — việc còn treo cùng ô vẫn giữ nguyên cờ của nó',
      liveRows.every(x => x.skipped === false && Array.isArray(x.task_ids)), `${liveRows.length} dòng sống`)
  } else check('[12c] Quét pallet khác kế hoạch', true, 'không còn pallet rảnh để thử — bỏ qua')
  // (12/09) Pallet lấy MỘT PHẦN: thủ kho phải đọc được số THÙNG phải lấy ⇒ mọi dòng mang is_partial + đơn vị mã
  b = await board('SCAN', `&gdo_id=${t2.gdo}`)
  const scanRows = b.j?.data?.rows ?? []
  check('[12e] Mỗi dòng Sắp quét mang is_partial + đơn vị của mã (để in "lấy N thùng" khi lấy một phần)',
    scanRows.length > 0 && scanRows.every(x => typeof x.is_partial === 'boolean' && 'units_per_carton' in x && 'base_unit' in x),
    `${scanRows.filter(x => x.is_partial).length}/${scanRows.length} dòng lấy một phần`)

  // ═══ [12f] NHẬN VIỆC CHUNG (12/09) — khoá mềm 10', người khác đang cầm thì không giành được ═══
  // Chuyến RIÊNG cho hai phép [12f]/[12g]: tới đây mọi việc cần hạ của t2 đã bị [11] hạ hết ⇒ bảng Cần hạ
  // không còn nhóm chờ nào để thử (lượt đầu 12/09 vì thế "bỏ qua" + [12g] đỏ oan).
  // Hai pallet TRÊN KỆ, hạn gần nhất kho ⇒ FEFO chắc chắn chọn chúng ⇒ có việc CẦN HẠ để thử Nhận / Hạ&đưa ra
  await mkPallet('CLAIM_T3', 60, far.T3,  dPlus(3), -50)
  await mkPallet('CLAIM_T2', 60, near.T2, dPlus(4), -50)
  const t7 = await mkTrip('TCLAIM')
  const i7 = await mkItem(t7.do, 100)
  await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i7], rule: { kind: 'FEFO' } })
  await startTrip(t7.gdo, { license_plate: '51C77770', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
  b = await board('LOWER', `&gdo_id=${t7.gdo}`)
  const claimGroup = (b.j?.data?.rows ?? []).find(x => !x.stage_done && !x.skipped && x.task_ids?.length)
  if (claimGroup) {
    const cIds = claimGroup.task_ids
    const minAgo = m => new Date(Date.now() - m * 60_000).toISOString()
    // Người KHÁC đang cầm (ghi thẳng DB — gói chỉ có một tài khoản)
    await restWrite('wms_tasks', 'PATCH', `id=in.(${cIds.join(',')})`, { claimed_by: 'qa57-other', claimed_at: minAgo(1) })
    r = await api('/wms/directed/tasks/claim', 'POST', { task_ids: cIds })
    check('[12f] Việc đang có người khác cầm → KHÔNG giành được (changed=0) và biết ai đang giữ',
      r.s === 200 && r.j?.data?.changed === 0 && !!r.j?.data?.held_by, `http=${r.s} changed=${r.j?.data?.changed} held_by=${r.j?.data?.held_by}`)
    b = await board('LOWER')
    const heldRow = (b.j?.data?.rows ?? []).find(x => x.group_key === claimGroup.group_key)
    check('[12f2] Bảng hiện người đang cầm việc (claim_active + claimed_by)',
      !!heldRow && heldRow.claim_active === true && heldRow.claimed_by === 'qa57-other', heldRow ? `claimed_by=${heldRow.claimed_by}` : 'không thấy dòng')
    // Quá 10 phút không ✓ Xong → tự nhả: người khác nhận được
    await restWrite('wms_tasks', 'PATCH', `id=in.(${cIds.join(',')})`, { claimed_at: minAgo(11) })
    r = await api('/wms/directed/tasks/claim', 'POST', { task_ids: cIds })
    check('[12f3] Người cầm quá 10 phút không làm → việc tự nhả, người sau nhận được đủ nhóm',
      r.s === 200 && r.j?.data?.changed === cIds.length, `http=${r.s} changed=${r.j?.data?.changed}/${cIds.length}`)
    b = await board('LOWER')
    const mineRow = (b.j?.data?.rows ?? []).find(x => x.group_key === claimGroup.group_key)
    check('[12f4] Bảng hiện đúng người vừa nhận (tên, không phải id)',
      !!mineRow && mineRow.claim_active === true && !!mineRow.claimed_by_name && mineRow.claimed_by !== 'qa57-other', mineRow ? `${mineRow.claimed_by_name}` : 'không thấy dòng')
    r = await api('/wms/directed/tasks/claim', 'POST', { task_ids: cIds, undo: true })
    check('[12f5] Bỏ nhận → nhả đủ nhóm', r.s === 200 && r.j?.data?.changed === cIds.length, `http=${r.s} changed=${r.j?.data?.changed}`)
    const evc = await restAll('wms_task_events', `select=event&task_id=eq.${cIds[0]}&event=in.(CLAIMED,UNCLAIMED)`)
    check('[12f6] Sổ sự kiện ghi vết nhận / bỏ nhận', evc.some(e => e.event === 'CLAIMED') && evc.some(e => e.event === 'UNCLAIMED'), evc.map(e => e.event).join(','))
  } else check('[12f] Nhận việc chung', false, `chuyến T7 không có nhóm việc chờ hạ (${(b.j?.data?.rows ?? []).length} dòng) — fixture thiếu pallet trên kệ`)

  // ═══ [12g] KHO KHÔNG CÓ XE HẠ RIÊNG — một nút "Hạ & đưa ra" (12/09) ═══════════════════════════
  await restWrite('Warehouse', 'PATCH', `id=eq.${whId}`, { separate_lowering_forklift: false })
  b = await board('MOVE', `&gdo_id=${t7.gdo}`)
  const comb = (b.j?.data?.rows ?? []).find(x => x.waiting_lower && !x.stage_done && !x.skipped)
  check('[12g] Kho không xe hạ riêng: bảng báo settings + dòng chờ hạ ở xe chuyển BẤM ĐƯỢC (combined_lower)',
    b.j?.data?.settings?.separate_lowering_forklift === false && !!comb && comb.can_confirm === true && comb.combined_lower === true,
    `settings=${JSON.stringify(b.j?.data?.settings)} ${comb ? `can=${comb.can_confirm} comb=${comb.combined_lower}` : 'không có dòng chờ hạ'}`)
  if (comb) {
    r = await api('/wms/directed/tasks/confirm', 'POST', { task_ids: comb.task_ids, stage: 'BOTH' })
    const afterB = await restAll('wms_tasks', `select=id,lowered_at,moved_at&id=in.(${comb.task_ids.join(',')})`)
    check('[12g2] "Hạ & đưa ra" ghi CẢ HAI mốc trong một cú bấm',
      r.s === 200 && afterB.length === comb.task_ids.length && afterB.every(t => t.lowered_at && t.moved_at), `http=${r.s} ${err(r)} ${afterB.map(t => `${!!t.lowered_at}/${!!t.moved_at}`).join(' ')}`)
    r = await api('/wms/directed/tasks/confirm', 'POST', { task_ids: comb.task_ids, stage: 'BOTH', undo: true })
    const afterU = await restAll('wms_tasks', `select=id,lowered_at,moved_at&id=in.(${comb.task_ids.join(',')})`)
    check('[12g3] Bấm nhầm "Hạ & đưa ra" → bỏ CẢ HAI mốc (không để lại mốc đã hạ giả)',
      r.s === 200 && afterU.every(t => !t.lowered_at && !t.moved_at), `${afterU.map(t => `${!!t.lowered_at}/${!!t.moved_at}`).join(' ')}`)
  }
  await restWrite('Warehouse', 'PATCH', `id=eq.${whId}`, { separate_lowering_forklift: true })
  b = await board('MOVE', `&gdo_id=${t7.gdo}`)
  const waitRows = (b.j?.data?.rows ?? []).filter(x => x.waiting_lower && !x.stage_done)
  // Cờ này nay CHỈ còn quyết định có HIỆN tab "Cần hạ" hay không (12/09). Nó KHÔNG được khoá tay
  // xe chuyển trở lại — đó chính là hành vi user bác.
  check('[12g4] Bật lại xe hạ riêng → tab Cần hạ hiện lại, nhưng xe chuyển VẪN bấm được',
    b.j?.data?.settings?.separate_lowering_forklift === true && waitRows.length > 0
      && waitRows.every(x => x.can_confirm === true && x.combined_lower === true),
    `settings=${JSON.stringify(b.j?.data?.settings)} ${waitRows.length} dòng chờ hạ · ${waitRows.map(x => `${x.can_confirm}/${x.combined_lower}`).slice(0, 3).join(' ')}`)

  // ═══ [13] BỎ BẮT ĐẦU → HUỶ VIỆC TREO ═════════════════════════════════════════════════════════
  const t5 = await mkTrip('T5')
  const i5 = await mkItem(t5.do, 20)
  await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i5], rule: { kind: 'FEFO' } })
  await startTrip(t5.gdo, { license_plate: '51C55555', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
  const before5 = (await tasksOf(t5.gdo)).length
  r = await api(`/wms/outbound/${t5.gdo}/unstart`, 'POST', {})
  const after5 = await tasksOf(t5.gdo)
  check('[13] Bỏ Bắt đầu → mọi việc treo hết hiệu lực (không còn ai được chỉ đi lấy hàng)',
    r.s === 200 && before5 > 0 && after5.every(t => t.status === 'CANCELLED'),
    `http=${r.s} trước=${before5} sau=${after5.map(t => t.status).join(',')}`)

  // ═══ [14] CỬA PHỤC VỤ ĐÚNG LOẠI KHO ══════════════════════════════════════════════════════════
  r = await api(`/wms/warehouse-map/${whId}/objects/${dockB}`, 'PATCH', { serve_categories: [CAT_B === CAT_A ? CAT_A : CAT_B] })
  check('[14a] Khai Loại kho phục vụ cho cửa → 200', r.s === 200, `http=${r.s} ${err(r)}`)
  r = await api(`/wms/warehouse-map/${whId}/objects/${dockB}`, 'PATCH', { serve_categories: ['KHONG_CO_LOAI_NAY'] })
  check('[14b] Loại kho ngoài danh mục → 422', r.s === 422, `http=${r.s} ${err(r)}`)
  if (CAT_B !== CAT_A) {
    await restWrite('Location', 'PATCH', `id=eq.${dockB}`, { serve_categories: [CAT_B] })
    const t6 = await mkTrip('T6', CAT_A)
    const i6 = await mkItem(t6.do, 10)
    await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i6], rule: { kind: 'FEFO' } })
    r = await startTrip(t6.gdo, { license_plate: '51C66666', dock_location_id: dockB, forklift_driver_ids: drvId ? [drvId] : [] })
    check('[14c] Chuyến chở loại A vào cửa chỉ nhận loại B → 422 DOCK_CATEGORY_MISMATCH',
      r.s === 422 && r.j?.error?.code === 'DOCK_CATEGORY_MISMATCH', `http=${r.s} ${err(r)}`)
    const t7 = await mkTrip('T7', `${CAT_A}+${CAT_B}`)
    const i7 = await mkItem(t7.do, 10)
    await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i7], rule: { kind: 'FEFO' } })
    r = await startTrip(t7.gdo, { license_plate: '51C77777', dock_location_id: dockB, forklift_driver_ids: drvId ? [drvId] : [] })
    check('[14d] Chuyến chở LẪN A+B vào cửa nhận B → 200 (giao ≥ 1, cùng luật chuyến chở lẫn)',
      r.s === 200, `http=${r.s} ${err(r)}`)
    await restWrite('Location', 'PATCH', `id=eq.${dockB}`, { serve_categories: null })
  } else check('[14c] Cửa theo loại kho', true, 'staging chỉ có 1 loại kho — bỏ qua phần đối chiếu')

  // ═══ [15] CHỐT %DATE HÀNG LOẠT ═══════════════════════════════════════════════════════════════
  r = await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i3, i4], rule: { kind: 'MIN_PCT', value: 30 } })
  check('[15a] Chốt 2 dòng ở 2 chuyến trong MỘT lần lưu → 200', r.s === 200 && r.j?.data?.updated === 2, `http=${r.s} ${err(r)}`)
  r = await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i3], rule: { kind: 'MIN_PCT', value: 150 } })
  check('[15b] %Date 150 → 422 (0–100)', r.s === 422, `http=${r.s}`)
  r = await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i3], rule: { kind: 'NEWEST' } })
  check('[15c] Quy tắc lạ → 422', r.s === 422, `http=${r.s}`)
  r = await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: ["' or 1=1--"], rule: { kind: 'FEFO' } })
  check('[15d] Id kiểu injection trong body → 400 (bộ mẫu chuẩn của gói 07)', r.s === 400, `http=${r.s}`)
  r = await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [], rule: { kind: 'FEFO' } })
  check('[15e] Không chọn dòng nào → 400', r.s === 400, `http=${r.s}`)
  r = await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i4], rule: null })
  const i4row = (await restAll('OutboundItem', `select=date_rule&id=eq.${i4}`))[0]
  check('[15f] Xoá chốt → dòng về "chưa chốt"', r.s === 200 && !i4row?.date_rule, `rule=${JSON.stringify(i4row?.date_rule)}`)

  // ── [15g–15k] ĐÒI %DATE MÀ KHO KHÔNG CÒN HÀNG ĐẠT (user chốt 10/09: "phải cảnh báo NGAY LÚC
  // CHỌN và không cho chọn"). Màn chốt hỏi trước qua /check; cửa ghi gác lại vì lọc trên UI chỉ là
  // gợi ý — gọi thẳng API vẫn đặt được nếu không chặn.
  {
    r = await api('/wms/outbound/items/date-rule/check', 'POST', { rules: [{ item_id: i3, rule: { kind: 'MIN_PCT', value: 1 } }] })
    const okRow = (r.j?.data ?? [])[0]
    check('[15g] Hỏi trước khi chốt: mức khả thi → ok + có pallet đạt',
      r.s === 200 && okRow?.ok === true && Number(okRow?.matched_pallets) > 0,
      `http=${r.s} ok=${okRow?.ok} pallet=${okRow?.matched_pallets} best=${okRow?.best_pct}`)

    const rBad = await api('/wms/outbound/items/date-rule/check', 'POST', { rules: [{ item_id: i3, rule: { kind: 'EXACT', value: '1999-01-01' } }] })
    const badRow = (rBad.j?.data ?? [])[0]
    check('[15h] Hỏi trước khi chốt: NSX không có pallet nào → ok=false (đây là cái làm ô đỏ trên màn)',
      rBad.s === 200 && badRow?.ok === false && Number(badRow?.matched_pallets) === 0,
      `http=${rBad.s} ok=${badRow?.ok} pallet=${badRow?.matched_pallets}`)

    const before = (await restAll('OutboundItem', `select=date_rule&id=eq.${i3}`))[0]?.date_rule
    const rSave = await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i3], rule: { kind: 'EXACT', value: '1999-01-01' } })
    const after = (await restAll('OutboundItem', `select=date_rule&id=eq.${i3}`))[0]?.date_rule
    check('[15i] Gọi THẲNG API chốt mức không có hàng → 422 DATE_RULE_NO_STOCK',
      rSave.s === 422 && rSave.j?.error?.code === 'DATE_RULE_NO_STOCK', `http=${rSave.s} code=${rSave.j?.error?.code}`)
    check('[15j] Lần 422 đó KHÔNG ghi đè chốt đang có (không để dòng rơi về trạng thái lỡ dở)',
      JSON.stringify(before) === JSON.stringify(after), `trước=${JSON.stringify(before)} sau=${JSON.stringify(after)}`)

    // %Date cao hơn mọi pallet trong kho: lấy đúng mốc từ chính câu trả lời của máy chủ
    const best = Number(okRow?.best_pct ?? 0)
    if (best > 0 && best < 100) {
      const rHigh = await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i3], rule: { kind: 'MIN_PCT', value: Math.min(100, Math.ceil(best) + 1) } })
      check('[15k] ≥ %Date cao hơn mọi pallet còn trong kho → 422, thông báo nêu mức cao nhất hiện có',
        rHigh.s === 422 && /cao nhất/.test(rHigh.j?.error?.message ?? ''), `http=${rHigh.s} msg=${(rHigh.j?.error?.message ?? '').slice(0, 90)}`)
    } else check('[15k] ≥ %Date cao hơn mọi pallet', true, `best_pct=${best} — fixture không dựng được mốc, bỏ qua`)

    const rFefo = await api('/wms/outbound/items/date-rule/check', 'POST', { rules: [{ item_id: i3, rule: { kind: 'FEFO' } }] })
    check('[15l] FEFO KHÔNG bị chặn (không đòi mốc date nào nên không mâu thuẫn được với tồn)',
      rFefo.s === 200 && (rFefo.j?.data ?? [])[0]?.ok === true, `http=${rFefo.s} ok=${(rFefo.j?.data ?? [])[0]?.ok}`)
  }

  // ── [15m–15q] MỘT DÒNG NHIỀU MỨC DATE THEO SỐ LƯỢNG (user 10/09: "đơn 280 thùng nhưng 250 thùng
  // date 60, 30 thùng date 90"). Dòng đơn từ SAP không tách đôi được nên phải chia trên quy tắc.
  {
    const it3 = (await restAll('OutboundItem', `select=cartons_ordered&id=eq.${i3}`))[0]
    const ordered = Number(it3?.cartons_ordered ?? 0)
    const a = Math.max(1, Math.floor(ordered * 0.7)), b = Math.max(1, ordered - a)

    let r = await api('/wms/outbound/items/date-rule', 'PATCH', {
      item_ids: [i3], rule: { kind: 'SPLIT', parts: [{ qty_base: a, kind: 'MIN_PCT', value: 1 }, { qty_base: b, kind: 'FEFO' }] },
    })
    const saved = (await restAll('OutboundItem', `select=date_rule&id=eq.${i3}`))[0]?.date_rule
    check('[15m] Chia phần theo SL → 200, lưu đủ CẢ parts (không rơi mất khi gộp nhóm để lưu)',
      r.s === 200 && saved?.kind === 'SPLIT' && (saved?.parts ?? []).length === 2
      && Number(saved.parts[0].qty_base) === a && Number(saved.parts[1].qty_base) === b,
      `http=${r.s} rule=${JSON.stringify(saved)}`)

    r = await api('/wms/outbound/items/date-rule', 'PATCH', {
      item_ids: [i3], rule: { kind: 'SPLIT', parts: [{ qty_base: ordered + 1, kind: 'MIN_PCT', value: 1 }] },
    })
    check('[15n] Tổng các phần VƯỢT số lượng đặt → 422 (gõ nhầm đơn vị thì phải chặn, không cắt ngầm)',
      r.s === 422, `http=${r.s} msg=${(r.j?.error?.message ?? '').slice(0, 70)}`)

    r = await api('/wms/outbound/items/date-rule/check', 'POST', {
      rules: [{ item_id: i3, rule: { kind: 'SPLIT', parts: [{ qty_base: a, kind: 'MIN_PCT', value: 1 }, { qty_base: b, kind: 'MIN_PCT', value: 100 }] } }],
    })
    const row = (r.j?.data ?? [])[0]
    check('[15o] Hỏi trước: chia phần thì trả kết quả TỪNG PHẦN, chỉ đúng phần nào không còn hàng',
      r.s === 200 && Array.isArray(row?.parts) && row.parts.length === 2 && row.parts[0]?.ok === true && row.parts[1]?.ok === false && row?.ok === false,
      `http=${r.s} parts=${JSON.stringify(row?.parts)}`)

    // SỬA quy tắc SAU KHI đã sinh việc thì kế hoạch phải SẮP LẠI — việc cũ trỏ pallet theo mức date
    // CŨ mà vẫn ăn hết nhu cầu thì lần sửa này thành vô tác dụng (đo thật 10/09).
    // FIXTURE RIÊNG (pallet + chuyến + dòng của riêng phép kiểm này). Bản trước mượn dòng i3 dùng
    // chung: lượt nào việc của nó ĐÃ BỊ HẠ bởi phép kiểm khác thì `resetUntouchedTasksOfItems` giữ
    // nguyên — ĐÚNG THIẾT KẾ ("việc đã hạ/đã đưa ra GIỮ NGUYÊN") nhưng làm phép kiểm đỏ oan 2 lượt
    // 10/09. Hai mức cũng phải luôn khả thi (1 % và 2 %), không đo tồn ở đây.
    const pS = await mkPallet('RESET', 40, near.T1, dPlus(240), -30)
    const tS = await mkTrip('TS')
    const iS = await mkItem(tS.do, 40)
    await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [iS], rule: { kind: 'EXACT', value: pS.pallet_code } })
    const rS = await startTrip(tS.gdo, { license_plate: '51C66666', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
    const p1 = await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [iS], rule: { kind: 'MIN_PCT', value: 1 } })
    const beforeIds = (await restAll('wms_tasks', `select=id,lowered_at,moved_at&item_id=eq.${iS}&status=eq.PENDING`))
    const untouched = beforeIds.filter(t => !t.lowered_at && !t.moved_at)
    const p2 = await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [iS], rule: { kind: 'MIN_PCT', value: 2 } })
    const afterIds = (await restAll('wms_tasks', `select=id&item_id=eq.${iS}&status=eq.PENDING`)).map(x => x.id).sort()
    const cancelled = (await restAll('wms_tasks', `select=id&item_id=eq.${iS}&status=eq.CANCELLED&skip_reason=eq.DATE_RULE_CHANGED`)).length
    check('[15s] Đổi %Date khi đã có việc → việc CHƯA AI ĐỤNG bị bỏ và sắp lại (không giữ pallet sai date)',
      rS.s === 200 && p1.s === 200 && p2.s === 200 && untouched.length > 0 && cancelled >= untouched.length
      && JSON.stringify(beforeIds.map(t => t.id).sort()) !== JSON.stringify(afterIds),
      `bắt đầu=${rS.s} chốt=${p1.s}/${p2.s} · trước=${beforeIds.length} (chưa ai đụng ${untouched.length}) sau=${afterIds.length} đã bỏ=${cancelled}`)
    await api(`/wms/outbound/${tS.gdo}`, 'PATCH', { status: 'COMPLETED' })

    // Trả fixture về "chưa chốt" → nhả pallet cho các mục sau (T8 của [16] cần pallet để lập việc)
    await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i3], rule: null })

    // SỔ LỊCH SỬ — user 10/09: "cần có info xem được lịch sử input, sửa"
    const ev = await restAll('outbound_events', `select=event_type,old_value,new_value,actor,material_code&event_type=in.(DATE_RULE_SET,DATE_RULE_CLEARED)&order=created_at.desc&limit=10`)
    check('[15p] Mỗi lần chốt/sửa %Date ghi một dòng sổ CŨ → MỚI kèm người làm',
      ev.length > 0 && ev.every(e => e.actor && e.new_value != null && e.old_value != null),
      `dòng sổ=${ev.length} mới nhất=${JSON.stringify(ev[0] ?? null)}`)

    // MÀN CHỐT %DATE — mọi dòng của mọi chuyến trong khoảng ngày
    const lines = await api(`/wms/outbound/date-rule-lines?date_from=${vnDate()}&date_to=${vnDate()}&page_size=500`)
    const mine = (lines.j?.data?.rows ?? []).filter(x => String(x.group_code ?? '').includes(T))
    check('[15q] Màn "Chốt %Date": thấy dòng hàng của MỌI chuyến trong ngày + ô tổng khớp số dòng',
      lines.s === 200 && mine.length > 0 && Number(lines.j?.data?.summary?.lines ?? -1) === Number(lines.j?.data?.total ?? -2)
      && mine.every(x => x.item_id && x.group_code && x.material_code),
      `http=${lines.s} dòng của gói=${mine.length} tổng=${lines.j?.data?.total} band=${JSON.stringify(lines.j?.data?.summary)}`)

    const bad = await api(`/wms/outbound/date-rule-lines?date_from=${vnDate()}&date_to=2027-12-31`)
    check('[15r] Khoảng ngày quá rộng → 400 (kiểm ở BE TRƯỚC khi gọi DB)', bad.s === 400, `http=${bad.s}`)
  }

  // ═══ [15u] BẤM "✓ XONG" HAI LẦN → KHÔNG GHI ĐÈ MỐC GIỜ, KHÔNG ĐẺ THÊM DÒNG SỔ ════════════════
  // Đo thật 10/09 (diễn tập đồng thời): 8 lượt bấm cùng lúc trên 5 việc = 40 dòng LOWERED cho 5 lần
  // hạ. Giai đoạn là MỐC GIỜ chứ không phải status nên việc đã hạ vẫn PENDING ⇒ lần bấm sau vẫn
  // khớp bộ lọc. Sổ này là nguồn "giờ công theo việc" của KPI ⇒ nhân số là hỏng số.
  // Fixture RIÊNG — không mượn việc còn sót của chuyến khác: mượn thì có lượt chạy rơi vào mảng
  // RỖNG và phép kiểm im lặng không chạy (đúng lớp sai "khẳng định trên mảng rỗng" đã dính trước đây).
  {
    const pU = await mkPallet('DBLTAP', 60, far.T3, dPlus(150), -50)   // tầng 3 ⇒ chắc chắn needs_lower
    const tU = await mkTrip('TU')
    const iU = await mkItem(tU.do, 60)
    await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [iU], rule: { kind: 'EXACT', value: pU.pallet_code } })
    r = await startTrip(tU.gdo, { license_plate: '51C88888', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
    const tkU = (await tasksOf(tU.gdo)).filter(t => t.status === 'PENDING' && t.needs_lower && !t.lowered_at)
    check('[15u0] Dựng được đúng một việc CHỜ HẠ để thử bấm hai lần (không mượn trạng thái chuyến khác)',
      r.s === 200 && tkU.length === 1, `http=${r.s} việc chờ hạ=${tkU.length}`)
    if (tkU.length) {
      const one = [tkU[0].id]
      const r1 = await api('/wms/directed/tasks/confirm', 'POST', { task_ids: one, stage: 'LOWER' })
      const at1 = (await restAll('wms_tasks', `select=lowered_at&id=eq.${one[0]}`))[0]?.lowered_at
      await new Promise(s => setTimeout(s, 1100))   // đủ để mốc giờ MỚI khác mốc cũ nếu bị ghi đè
      const r2 = await api('/wms/directed/tasks/confirm', 'POST', { task_ids: one, stage: 'LOWER' })
      const at2 = (await restAll('wms_tasks', `select=lowered_at&id=eq.${one[0]}`))[0]?.lowered_at
      const evs = await restAll('wms_task_events', `select=id&task_id=eq.${one[0]}&event=eq.LOWERED`)
      check('[15u] Bấm ✓ Xong lần hai: 200 nhưng changed=0, KHÔNG ghi đè mốc giờ đã hạ',
        r1.s === 200 && r2.s === 200 && Number(r2.j?.data?.changed ?? -1) === 0 && at1 === at2,
        `lần1=${r1.s}/${r1.j?.data?.changed} lần2=${r2.s}/${r2.j?.data?.changed} mốc: ${String(at1).slice(11, 19)} → ${String(at2).slice(11, 19)}`)
      check('[15u2] Sổ sự kiện chỉ có ĐÚNG MỘT dòng LOWERED cho một lần hạ', evs.length === 1, `${evs.length} dòng`)
    }
    await api(`/wms/outbound/${tU.gdo}`, 'PATCH', { status: 'COMPLETED' })
  }

  // ═══ [15v] MỨC DATE KẾ THỪA TỪ SAP MÀ KHO KHÔNG CÒN HÀNG ĐẠT → PHẢI NÓI RA ═══════════════════
  // Cửa CHỐT TAY đã gác (422 DATE_RULE_NO_STOCK) nhưng mức đến từ cột "Date (%)" của VL06O KHÔNG đi
  // qua cửa đó: upload xong là dòng có mức ngay. Đo thật 10/09 — SAP đòi 90 %, kho cao nhất 72 % ⇒
  // 0 việc, 0 cảnh báo, bảng Việc cần làm trống trơn mà không ai biết vì sao.
  {
    const tV = await mkTrip('TV')
    await mkItem(tV.do, 40, { date_required: 100 })     // 100 % = không pallet nào đạt (trừ hàng SX hôm nay)
    r = await startTrip(tV.gdo, { license_plate: '51C77777', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
    const tkV = await tasksOf(tV.gdo)
    check('[15v] Mức date kế thừa từ SAP không có hàng đạt → 0 việc NHƯNG có cảnh báo nêu mã + mức + tồn cao nhất',
      r.s === 200 && tkV.length === 0 && /không có pallet nào đạt/i.test(r.j?.data?.plan_warning ?? '')
        && String(r.j?.data?.plan_warning ?? '').includes(mat.material_code),
      `http=${r.s} việc=${tkV.length} cảnh báo=${String(r.j?.data?.plan_warning ?? '—').slice(0, 150)}`)
    await api(`/wms/outbound/${tV.gdo}`, 'PATCH', { status: 'COMPLETED' })
  }

  // ═══ [15t] HÀNG LẺ ĐÃ NẰM SẴN Ở VỊ TRÍ NHẶT LẺ → KHÔNG ĐẺ VIỆC XE NÂNG ═══════════════════════
  // Bug đo thật 10/09 (Ba Vì, mã 610000022): 4.100 đơn vị đã nằm ở 3 vị trí nhặt lẻ, dòng đơn 500
  // và 100 % là nhặt lẻ — vậy mà kế hoạch vẫn sai xe nâng đi lấy 420 từ ô KỆ, lại còn đưa RA CỬA
  // thay vì về vị trí nhặt lẻ. Gốc: phần "đã có sẵn" chỉ được trừ khi vòng lặp ĐI NGANG đúng pallet
  // ở vị trí nhặt lẻ, mà thứ tự pool theo luật luân chuyển nên pallet trên kệ sắp trước ăn mất phần đó.
  {
    const pFace = await mkPallet('PICKFACE', 300, locPick, dPlus(120), -60)
    const t9 = await mkTrip('T9')
    const i9 = await mkItem(t9.do, 100, { loose_picking: 100 })   // cả dòng là nhặt lẻ
    await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i9], rule: { kind: 'FEFO' } })
    r = await startTrip(t9.gdo, { license_plate: '51C99999', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
    const tk9 = await tasksOf(t9.gdo)
    check('[15t] Phần lẻ đã đủ ở vị trí nhặt lẻ → KHÔNG sinh việc xe nâng nào (không đẻ việc thừa)',
      r.s === 200 && tk9.length === 0,
      `http=${r.s} việc=${tk9.length} ${tk9.map(t => `${t.kind}/${t.qty_base}→${t.to_kind}`).join(',')} · pallet nhặt lẻ=${pFace.pallet_code}`)
    check('[15t2] …và tuyệt đối không có việc PICK ra CỬA cho dòng nhặt lẻ',
      !tk9.some(t => t.kind === 'PICK' && t.to_kind === 'DOCK'), `${tk9.filter(t => t.kind === 'PICK').length} việc PICK`)
    await api(`/wms/outbound/${t9.gdo}`, 'PATCH', { status: 'COMPLETED' }).catch(() => {})
  }

  // ═══ [19] KHO HƯỚNG DẪN: CHƯA CHỐT %DATE THÌ CHƯA ĐƯỢC LẤY HÀNG (user chốt 10/09) ════════════
  // Trước bản vá này, chốt tay KHÔNG gác gì ở cửa quét — cửa đó chỉ soi `date_required` của VL06O.
  // Hệ quả: kho Hướng dẫn có dòng chưa chốt ⇒ 0 việc trên bảng, nhưng người quét vẫn xuất bình
  // thường bằng pallet tự chọn — tức chỉ dẫn công việc bị đi vòng mà không ai biết.
  // NHẶT LẺ đi CHUNG cửa quét (user: "bản chất nó là 1") nên gác luôn cả hai chiều.
  {
    const p19 = await mkPallet('DGATE', 40, locFloor, dPlus(300), -15)
    const t19 = await mkTrip('T19')
    const i19 = await mkItem(t19.do, 20)                      // KHÔNG chốt date_rule, không date_required
    r = await startTrip(t19.gdo, { license_plate: '51C19191', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
    const scan19 = (body) => api(`/wms/outbound/${t19.gdo}/items/${i19}/scan`, 'POST',
      { qr_code: p19.pallet_code, qty_semantics: 'base', leftover_ui: true, leftover_location_id: 'KEEP', ...body })
    check('[19a0] Dựng được chuyến Hướng dẫn có dòng CHƯA chốt %Date', r.s === 200, `http=${r.s} ${err(r)}`)
    r = await api(`/wms/outbound/${t19.gdo}/items/${i19}/check-scan`, 'POST', { qr_code: p19.pallet_code })
    check('[19a] Xem trước lượt quét khi chưa chốt %Date → 422 DATE_RULE_REQUIRED (báo ngay trên màn, không đợi bấm Lưu)',
      r.s === 422 && r.j?.error?.code === 'DATE_RULE_REQUIRED', `http=${r.s} ${err(r)}`)
    r = await scan19({ cartons_override: 5 })
    check('[19b] Quét XUẤT khi chưa chốt %Date → 422 (cửa ghi, gác kể cả gọi thẳng API)',
      r.s === 422 && r.j?.error?.code === 'DATE_RULE_REQUIRED', `http=${r.s} ${err(r)}`)
    r = await scan19({ cartons_override: 5, loose_picking_mode: true })
    check('[19c] Quét NHẶT LẺ khi chưa chốt %Date → 422 (nhặt lẻ không phải cửa sau của xuất)',
      r.s === 422 && r.j?.error?.code === 'DATE_RULE_REQUIRED', `http=${r.s} ${err(r)}`)
    await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i19], rule: { kind: 'FEFO' } })
    r = await scan19({ cartons_override: 5 })
    check('[19d] Chốt xong (FEFO) → quét được ngay, không phải làm gì thêm',
      r.s === 200, `http=${r.s} ${err(r)}`)
    // Kho THỦ CÔNG giữ nguyên hành vi cũ — luật này CHỈ áp cho kho Hướng dẫn, đừng khoá nhầm kho khác
    const t19b = await mkTrip('T19B')
    const i19b = await mkItem(t19b.do, 20)
    await restWrite('Warehouse', 'PATCH', `id=eq.${whId}`, { work_mode: 'MANUAL', updated_at: nowIso() })
    await startTrip(t19b.gdo, { license_plate: '51C19192', dock_location_id: dockA })
    r = await api(`/wms/outbound/${t19b.gdo}/items/${i19b}/scan`, 'POST',
      { qr_code: p19.pallet_code, qty_semantics: 'base', cartons_override: 5, leftover_ui: true, leftover_location_id: 'KEEP' })
    check('[19e] Kho THỦ CÔNG: dòng chưa chốt %Date vẫn quét được (luật chỉ áp cho kho Hướng dẫn)',
      r.s === 200, `http=${r.s} ${err(r)}`)
    await restWrite('Warehouse', 'PATCH', `id=eq.${whId}`, { work_mode: 'GUIDED', updated_at: nowIso() })
    await api(`/wms/outbound/${t19.gdo}`, 'PATCH', { status: 'CANCELLED' }).catch(() => {})
    await api(`/wms/outbound/${t19b.gdo}`, 'PATCH', { status: 'CANCELLED' }).catch(() => {})
  }

  // ═══ [20] NHẶT DỌC ĐƯỜNG — bán kính của kho (13/09) ═══════════════════════════════════════════
  // Đo 13/09 (BFS ngoài app, bản vẽ thật Ba Vì): nhóm theo chuyến làm xe nâng đi xa hơn đường ngắn
  // nhất ~25 %, nhưng đổi sang đường ngắn nhất thì giữ cửa lâu hơn 37 % ⇒ phương án giữa: đứng ở
  // điểm đặt dãy mà có việc chuyến khác trong bán kính R thì làm luôn (−16 % đường, cửa vẫn sớm hơn).
  // Phép kiểm gác CẢ HAI chiều: tắt (0) thì tuyệt đối không đảo, bật thì phải đảo đúng dòng gần.
  {
    // Ba ô kệ dựng riêng: A1 và B1 SÁT NHAU, A2 ở tít dãy bên kia.
    const rA1 = await mkLoc('RTA', '91', 'T2', 3, 10)
    const rA2 = await mkLoc('RTA', '92', 'T2', 16, 12)
    const rB1 = await mkLoc('RTB', '93', 'T2', 4, 10)
    // HSD NGẮN HƠN MỌI pallet fixture khác (ngắn nhất trước đó là +5 ngày) để FEFO chắc chắn chọn
    // đúng ba pallet này — không để phép kiểm phụ thuộc pallet còn sót của các mục trước.
    const mk = async (code, loc, expDays) => (await restWrite('InventoryEntry', 'POST', null, {
      id: randomUUID(), pallet_code: `${T}-${code}`, material_id: mat.id, warehouse_id: whId,
      location_id: loc, cartons_imported: 10, cartons_remaining: 10, cartons_reserved: 0,
      status: 'IN_STOCK', production_date: dPlus(-30), expiry_date: dPlus(expDays),
      import_date: vnDate(), created_at: nowIso(), updated_at: nowIso(),
    }))[0]
    await mk('RT_A1', rA1, 1); await mk('RT_A2', rA2, 2); await mk('RT_B1', rB1, 3)

    const tP = await mkTrip('TP'), tQ = await mkTrip('TQ')
    const iP = await mkItem(tP.do, 20), iQ = await mkItem(tQ.do, 10)
    await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [iP, iQ], rule: { kind: 'FEFO' } })
    await startTrip(tP.gdo, { license_plate: '51C20001', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
    await startTrip(tQ.gdo, { license_plate: '51C20002', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })

    const tripsOf = async () => {
      const b = await board('LOWER')
      return (b.j?.data?.rows ?? []).filter(x => !x.stage_done && !x.skipped).map(x => x.license_plate)
    }
    // Tắt (mặc định): bảng đi hết chuyến P rồi mới sang Q — không dòng nào của Q chen vào giữa P
    await restWrite('Warehouse', 'PATCH', `id=eq.${whId}`, { cross_trip_pick_radius: 0, updated_at: nowIso() })
    const off = await tripsOf()
    const grouped = a => { const seen = new Set(); let prev = null
      for (const p of a) { if (p !== prev) { if (seen.has(p)) return false; seen.add(p); prev = p } } return true }
    check('[20a] Bán kính 0 (mặc định): bảng Cần hạ đi TRỌN từng chuyến, không đan xen',
      off.length >= 3 && grouped(off), off.join(' → '))

    // Bật: việc của chuyến Q nằm sát ô đầu của P ⇒ phải được kéo lên làm luôn, không để quay lại
    await restWrite('Warehouse', 'PATCH', `id=eq.${whId}`, { cross_trip_pick_radius: 40, updated_at: nowIso() })
    const on = await tripsOf()
    check('[20b] Bật bán kính: việc chuyến KHÁC ở ô gần được kéo lên xen vào giữa (nhặt dọc đường)',
      on.length === off.length && !grouped(on), `tắt: ${off.join(' → ')} | bật: ${on.join(' → ')}`)
    check('[20c] Sắp lại KHÔNG làm mất hay đẻ thêm việc nào', on.length === off.length
      && JSON.stringify(on.slice().sort()) === JSON.stringify(off.slice().sort()), `${off.length} → ${on.length}`)

    // Bảng "Cần đưa ra" KHÔNG được đụng tới: ở đó mỗi việc đều kết thúc tại cửa nên đảo thứ tự chỉ
    // làm người ta nhảy chuyến mà không rút ngắn được gì.
    const bm = await board('MOVE')
    const moveTrips = (bm.j?.data?.rows ?? []).filter(x => !x.stage_done && !x.skipped).map(x => x.license_plate)
    check('[20d] Bán kính KHÔNG áp cho bảng Cần đưa ra (ở đó thứ tự không đổi được quãng đường)',
      grouped(moveTrips), moveTrips.join(' → '))

    await restWrite('Warehouse', 'PATCH', `id=eq.${whId}`, { cross_trip_pick_radius: 0, updated_at: nowIso() })
    await api(`/wms/outbound/${tP.gdo}`, 'PATCH', { status: 'CANCELLED' }).catch(() => {})
    await api(`/wms/outbound/${tQ.gdo}`, 'PATCH', { status: 'CANCELLED' }).catch(() => {})
  }

  // ═══ [16] HOÀN THÀNH CHUYẾN → DỌN VIỆC TREO ══════════════════════════════════════════════════
  const t8 = await mkTrip('T8')
  const i8 = await mkItem(t8.do, 10)
  await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i8], rule: { kind: 'FEFO' } })
  await startTrip(t8.gdo, { license_plate: '51C88888', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
  const b8 = (await tasksOf(t8.gdo)).length
  await restWrite('OutboundItem', 'PATCH', `id=eq.${i8}`, { cartons_scanned: 10, status: 'COMPLETED' })
  r = await api(`/wms/outbound/${t8.gdo}`, 'PATCH', { status: 'COMPLETED' })
  const a8 = await tasksOf(t8.gdo)
  check('[16] Hoàn thành chuyến → việc còn treo hết hiệu lực, việc đã xong giữ nguyên vết',
    r.s === 200 && b8 > 0 && a8.every(t => t.status !== 'PENDING'),
    `http=${r.s} trước=${b8} sau=${a8.map(t => t.status).join(',')}`)

  // ═══ [21] LOOSE_FEED: "✓ Xong" phải CHUYỂN THẬT pallet về vị trí nhặt lẻ ══════════════════════
  // Bug thật 13/09 (diễn tập vận hành bắt được, không phép kiểm nào chạm): app trả
  // `{ok:true, moved_pallets:1}` mà tồn KHÔNG đổi vị trí — `p_updated_by` nhận TÊN người dùng
  // trong khi `InventoryEntry.updated_by` có khoá ngoại tới `Employee(id)` ⇒ RPC ném 23503, và
  // `error` bị vứt nên số đếm là SỐ LẦN THỬ chứ không phải số lần chuyển được. Thủ kho ra vị trí
  // nhặt lẻ thì không có hàng, sổ tồn vẫn nói pallet nằm trên kệ. ORACLE: đọc lại `location_id`
  // của chính pallet đó — đừng tin con số API tự báo.
  {
    // Nhu cầu nhặt lẻ phải VƯỢT tồn đang có ở vị trí nhặt lẻ (fixture [15t] để sẵn 300 ở đó),
    // nếu không thì đủ hàng tại chỗ ⇒ không sinh việc nào và phép kiểm tự vô hiệu.
    const tLF = await mkTrip('TLF')
    await mkItem(tLF.do, 400, { loose_picking: 400, date_rule: { kind: 'FEFO', source: 'MANUAL', set_at: nowIso() } })
    r = await startTrip(tLF.gdo, { license_plate: '51C21021', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
    const lf = (await tasksOf(tLF.gdo)).filter(t => t.kind === 'LOOSE_FEED')
    check('[21a] Thiếu hàng ở vị trí nhặt lẻ ⇒ sinh việc LOOSE_FEED', lf.length > 0, `http=${r.s} ${err(r)}`)
    if (lf.length) {
      const t = lf[0]
      const locOf = async id => (await restAll('InventoryEntry', `select=location_id&id=eq.${id}`))[0]?.location_id ?? null
      const truoc = await locOf(t.entry_id)
      r = await api('/wms/directed/tasks/confirm', 'POST', { task_ids: [t.id], stage: 'BOTH' })
      const sau = await locOf(t.entry_id)
      check('[21b] "✓ Xong" của LOOSE_FEED CHUYỂN THẬT pallet về vị trí nhặt lẻ (đọc lại tồn, không tin số API báo)',
        r.s === 200 && sau === t.to_location_id && sau !== truoc,
        `http=${r.s} báo moved=${r.j?.data?.moved_pallets} · pallet ${truoc} → ${sau} · đích ${t.to_location_id}`)
      check('[21c] Số pallet API báo đã chuyển = số THẬT SỰ chuyển được',
        Number(r.j?.data?.moved_pallets ?? 0) === (sau === t.to_location_id ? 1 : 0),
        `API báo ${r.j?.data?.moved_pallets} · thật ${sau === t.to_location_id ? 1 : 0}`)
      r = await api('/wms/directed/tasks/confirm', 'POST', { task_ids: [t.id], stage: 'BOTH', undo: true })
      const t2 = (await tasksOf(tLF.gdo)).find(x => x.id === t.id)
      check('[21d] Hoàn tác bỏ CẢ hai mốc giờ', r.s === 200 && !t2?.lowered_at && !t2?.moved_at,
        `http=${r.s} hạ=${t2?.lowered_at} đưa=${t2?.moved_at}`)
      // HAI LỐI HOÀN TÁC (14/09): mặc định CHỈ bỏ dấu, tồn giữ nguyên ở vị trí nhặt lẻ (hàng đã đưa xuống);
      // `restore: true` = người bấm nói hàng CHƯA đưa xuống ⇒ pallet ghi lại về ô cũ. Oracle vẫn là
      // đọc lại location_id của chính pallet đó.
      const sauUndo = await locOf(t.entry_id)
      check('[21e] Hoàn tác KHÔNG kèm restore ⇒ tồn GIỮ NGUYÊN ở vị trí nhặt lẻ (hàng đã đưa xuống)',
        sauUndo === t.to_location_id, `pallet đang ở ${sauUndo} · đích ${t.to_location_id}`)
      r = await api('/wms/directed/tasks/confirm', 'POST', { task_ids: [t.id], stage: 'BOTH' })
      const lai = await locOf(t.entry_id)
      r = await api('/wms/directed/tasks/confirm', 'POST', { task_ids: [t.id], stage: 'BOTH', undo: true, restore: true })
      const veCu = await locOf(t.entry_id)
      const t3 = (await tasksOf(tLF.gdo)).find(x => x.id === t.id)
      check('[21f] Hoàn tác kèm restore ⇒ pallet GHI LẠI VỀ Ô CŨ và bỏ cả hai mốc giờ',
        r.s === 200 && lai === t.to_location_id && veCu === truoc && !t3?.lowered_at && !t3?.moved_at,
        `http=${r.s} báo moved=${r.j?.data?.moved_pallets} · ${lai} → ${veCu} · ô cũ ${truoc} · hạ=${t3?.lowered_at} đưa=${t3?.moved_at}`)
      check('[21g] Số pallet API báo khi restore = số THẬT SỰ ghi lại',
        Number(r.j?.data?.moved_pallets ?? 0) === (veCu === truoc ? 1 : 0),
        `API báo ${r.j?.data?.moved_pallets} · thật ${veCu === truoc ? 1 : 0}`)
      // `restore` không có nghĩa khi KHÔNG undo — gửi kèm lúc xác nhận phải bị bỏ qua (pallet vẫn về vị trí nhặt lẻ)
      r = await api('/wms/directed/tasks/confirm', 'POST', { task_ids: [t.id], stage: 'BOTH', restore: true })
      const xuoi = await locOf(t.entry_id)
      check('[21h] Cờ restore gửi kèm lúc XÁC NHẬN bị bỏ qua — pallet vẫn về vị trí nhặt lẻ',
        r.s === 200 && xuoi === t.to_location_id, `http=${r.s} pallet ở ${xuoi}`)
    }
    await api(`/wms/outbound/${tLF.gdo}`, 'PATCH', { status: 'CANCELLED' }).catch(() => {})
  }

  // ═══ [22] PALLET TƯƠNG ĐƯƠNG (user chốt 14/09) ═══════════════════════════════════════════════
  // "43 pallet chung một date thì pallet nào cũng được." Kế hoạch ghim một tem chỉ để giữ chỗ mềm; thủ
  // kho quét pallet KHÁC nhưng cùng ô · cùng mã · cùng NSX thì việc phải XONG (đổi ghim), KHÔNG bị huỷ
  // OTHER_PALLET và "% làm đúng kế hoạch" không tụt. Chỉ khác date/khác ô mới là lệch kế hoạch thật.
  {
    const locEq = await mkLoc('KE', '05', 'T1', 12, 14)
    // HSD phải NGẮN HƠN mọi pallet còn lại của fixture (PICKFACE +120, NEAR +200/+400…) để FEFO ghim
    // đúng vào A/B — lần chạy đầu 14/09 kế hoạch ghim QA57-PICKFACE vì A/B khai +300.
    const pA = await mkPallet('EQ_A', 50, locEq, dPlus(1), -40)
    const pB = await mkPallet('EQ_B', 50, locEq, dPlus(1), -40)            // tương đương A (cùng ô, cùng NSX, cùng HSD)
    const pC = await mkPallet('EQ_C', 50, locEq, dPlus(2), -10)            // KHÁC date — không tương đương
    const tEq = await mkTrip('TEQ')
    const iEq = await mkItem(tEq.do, 50, { date_rule: { kind: 'FEFO', source: 'MANUAL', set_at: nowIso() } })
    r = await startTrip(tEq.gdo, { license_plate: '51C22221', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
    const tkEq = (await tasksOf(tEq.gdo)).filter(t => t.status === 'PENDING')
    const pinned = tkEq[0]
    const pinnedIsAB = pinned && [pA.id, pB.id].includes(pinned.entry_id)
    check('[22a] Kế hoạch ghim MỘT trong hai pallet cùng date (FEFO: HSD ngắn hơn C)', tkEq.length === 1 && pinnedIsAB,
      `http=${r.s} ${err(r)} việc=${tkEq.length} ghim=${pinned?.pallet_code}`)
    if (pinnedIsAB) {
      const other = pinned.entry_id === pA.id ? pB : pA
      // Bảng phải NÓI "bất kỳ trong 2 cùng NSX" — tem ghim chỉ là gợi ý
      b = await board('SCAN', `&gdo_id=${tEq.gdo}`)
      const rowEq = (b.j?.data?.rows ?? []).find(x => x.task_ids?.includes(pinned.id))
      check('[22b] Bảng trả n_equiv = 2 (hai pallet tương đương trong ô) và cell_ndates = 2 (ô có hai NSX)',
        rowEq && Number(rowEq.n_equiv) === 2 && Number(rowEq.cell_ndates) === 2,
        rowEq ? `n_equiv=${rowEq.n_equiv} cell_ndates=${rowEq.cell_ndates}` : 'không thấy dòng')
      r = await api(`/wms/outbound/${tEq.gdo}/items/${iEq}/scan`, 'POST', {
        qr_code: other.pallet_code, qty_semantics: 'base', leftover_ui: true, leftover_location_id: 'KEEP',
      })
      const afterEq = (await tasksOf(tEq.gdo))
      const doneEq = afterEq.find(t => t.id === pinned.id)
      check('[22c] Quét pallet TƯƠNG ĐƯƠNG (khác tem, cùng ô/mã/NSX) → việc XONG, ghim đổi sang pallet vừa quét',
        r.s === 200 && doneEq?.status === 'DONE' && doneEq?.entry_id === other.id && doneEq?.confirm_source === 'SCAN',
        `http=${r.s} ${err(r)} status=${doneEq?.status} entry=${doneEq?.entry_id === other.id ? 'đã đổi' : doneEq?.pallet_code}`)
      check('[22d] KHÔNG có việc nào bị huỷ OTHER_PALLET — người làm đúng nghiệp vụ không bị trừ điểm',
        !afterEq.some(t => t.status === 'SKIPPED' && t.skip_reason === 'OTHER_PALLET'),
        `skipped=${afterEq.filter(t => t.status === 'SKIPPED').length}`)
      const evEq = await restAll('wms_task_events', `select=note&task_id=eq.${pinned.id}&event=eq.DONE`)
      check('[22e] Sổ sự kiện ghi rõ "pallet tương đương (kế hoạch ghim …)" — vết còn để truy',
        evEq.some(e => /tương đương/.test(e.note ?? '')), evEq.map(e => e.note).join(' | '))
    }
    // Chiều ngược: quét pallet KHÁC DATE trong cùng ô ⇒ vẫn là OTHER_PALLET (đó là lệch kế hoạch thật)
    const tEq2 = await mkTrip('TEQ2')
    const iEq2 = await mkItem(tEq2.do, 50, { date_rule: { kind: 'FEFO', source: 'MANUAL', set_at: nowIso() } })
    r = await startTrip(tEq2.gdo, { license_plate: '51C22222', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
    const tk2 = (await tasksOf(tEq2.gdo)).filter(t => t.status === 'PENDING')
    if (tk2.length && [pA.id, pB.id].includes(tk2[0].entry_id)) {
      r = await api(`/wms/outbound/${tEq2.gdo}/items/${iEq2}/scan`, 'POST', {
        qr_code: pC.pallet_code, qty_semantics: 'base', leftover_ui: true, leftover_location_id: 'KEEP',
      })
      const after2 = await tasksOf(tEq2.gdo)
      check('[22f] Quét pallet KHÁC DATE cùng ô → vẫn OTHER_PALLET (lệch kế hoạch thật, không bị luật tương đương nuốt)',
        r.s === 200 && after2.some(t => t.status === 'SKIPPED' && t.skip_reason === 'OTHER_PALLET'),
        `http=${r.s} ${err(r)} skipped=${after2.filter(t => t.status === 'SKIPPED').map(t => t.skip_reason).join(',')}`)
    } else check('[22f] Quét pallet khác date', true, `bỏ qua — kế hoạch ghim ${tk2[0]?.pallet_code ?? 'không có việc'}`)
    await api(`/wms/outbound/${tEq.gdo}`, 'PATCH', { status: 'CANCELLED' }).catch(() => {})
    await api(`/wms/outbound/${tEq2.gdo}`, 'PATCH', { status: 'CANCELLED' }).catch(() => {})
  }

  // ═══ [23] KẾ HOẠCH CŨ SỐNG SÓT · THIẾU MỘT PHẦN · TRANH CHẤP GIỮA CÁC ĐƠN (user hỏi 14/09) ═════
  // "1 pallet đạt date mà 5 đơn cần 10 pallet thì chỉ định của mỗi đơn thế nào?" Ba lỗ đo được khi trả
  // lời: (a) "Sắp lại" không sắp lại (idempotent nuốt) — [6] đã gác chiều tồn-không-đổi, đây gác chiều
  // TỒN ĐỔI + việc đã hạ phải sống; (b) dòng chỉ đủ MỘT PHẦN không ai báo; (c) màn chốt so từng dòng với
  // toàn kho nên 5 đơn đều thấy "đủ". Pallet ≥ 99 % chỉ có bộ HI tạo ở đây (EXACT của fixture là 98,6 %).
  {
    const locHi = await mkLoc('KE', '06', 'T2', 12, 16)
    const pHi1 = await mkPallet('HI1', 50, locHi, dPlus(1000), -1)          // 99,9 % — pallet DUY NHẤT đạt ≥ 99 lúc này
    const RULE99 = { kind: 'MIN_PCT', value: 99, source: 'MANUAL', set_at: nowIso() }
    const tHi = await mkTrip('THI')
    await mkItem(tHi.do, 100, { date_rule: RULE99 })                          // cần 100, kho đạt mức chỉ có 50
    r = await startTrip(tHi.gdo, { license_plate: '51C23231', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
    let tkHi = (await tasksOf(tHi.gdo)).filter(t => t.status === 'PENDING')
    check('[23b] Dòng chỉ đủ MỘT PHẦN pallet đạt mức → có việc cho phần đủ VÀ cảnh báo nêu "chỉ đủ …" + mã hàng',
      r.s === 200 && tkHi.length === 1 && tkHi[0].entry_id === pHi1.id && Number(tkHi[0].qty_base) === 50
        && /chỉ đủ/i.test(r.j?.data?.plan_warning ?? '') && String(r.j?.data?.plan_warning ?? '').includes(mat.material_code),
      `http=${r.s} việc=${tkHi.length} ghim=${tkHi[0]?.pallet_code}:${tkHi[0]?.qty_base} cảnh báo=${String(r.j?.data?.plan_warning ?? '—').slice(0, 160)}`)

    // (a) Tồn đổi: hàng mới về, HSD NGẮN HƠN HI1 nhưng vẫn ≥ 99 % ⇒ FEFO đúng phải là HI2. Chưa ai đụng
    // việc HI1 ⇒ Sắp lại phải bỏ nó (REPLANNED) và ghim HI2 trọn 100.
    const pHi2 = await mkPallet('HI2', 100, locHi, dPlus(900), -1)
    const oldId = tkHi[0]?.id
    r = await api(`/wms/directed/gdos/${tHi.gdo}/replan`, 'POST', {})
    const allHi = await tasksOf(tHi.gdo)
    tkHi = allHi.filter(t => t.status === 'PENDING')
    const oldRow = allHi.find(t => t.id === oldId)
    check('[23a] Tồn đổi → Sắp lại BỎ việc chưa ai đụng (CANCELLED/REPLANNED) và ghim lại theo FEFO mới (HI2, trọn 100)',
      r.s === 200 && Number(r.j?.data?.created) === 1 && Number(r.j?.data?.cancelled) >= 1
        && oldRow?.status === 'CANCELLED' && oldRow?.skip_reason === 'REPLANNED'
        && tkHi.length === 1 && tkHi[0].entry_id === pHi2.id && Number(tkHi[0].qty_base) === 100,
      `http=${r.s} created=${r.j?.data?.created} cancelled=${r.j?.data?.cancelled} cũ=${oldRow?.status}/${oldRow?.skip_reason} mới=${tkHi[0]?.pallet_code}:${tkHi[0]?.qty_base}`)

    // Việc ĐÃ HẠ là công người ta bỏ ra thật ⇒ Sắp lại phải GIỮ (cùng id, mốc hạ còn), dù có pallet mới tốt hơn
    if (tkHi.length === 1) {
      const keepId = tkHi[0].id
      await api('/wms/directed/tasks/confirm', 'POST', { task_ids: [keepId], stage: 'LOWER' })
      await mkPallet('HI3', 100, locHi, dPlus(800), -1)                       // còn "tốt hơn" HI2 theo FEFO
      r = await api(`/wms/directed/gdos/${tHi.gdo}/replan`, 'POST', {})
      const kept = (await tasksOf(tHi.gdo)).find(t => t.id === keepId)
      const pend = (await tasksOf(tHi.gdo)).filter(t => t.status === 'PENDING')
      check('[23a2] Việc ĐÃ HẠ sống qua Sắp lại: cùng id, vẫn PENDING, mốc hạ còn, không đẻ việc mới',
        r.s === 200 && Number(r.j?.data?.created) === 0 && Number(r.j?.data?.cancelled) === 0
          && kept?.status === 'PENDING' && !!kept?.lowered_at && kept?.entry_id === pHi2.id && pend.length === 1,
        `http=${r.s} created=${r.j?.data?.created} cancelled=${r.j?.data?.cancelled} kept=${kept?.status} hạ=${kept?.lowered_at ? 'còn' : 'MẤT'} treo=${pend.length}`)
    }
    await api(`/wms/outbound/${tHi.gdo}`, 'PATCH', { status: 'CANCELLED' }).catch(() => {})

    // (c) Hai chuyến CÙNG NGÀY cùng mã, mỗi dòng cần 200 mà tồn ≥ 99 % chỉ có bộ HI (250) ⇒ từng dòng "đủ"
    // nhưng CỘNG lại thì thiếu. Máy phải trả competing_lines/competing_base/rule_pool_base để màn chốt nói.
    const hiPool = (await restAll('InventoryEntry', `select=cartons_remaining&pallet_code=like.${T}-HI*&cartons_remaining=gt.0`))
      .reduce((s, e) => s + Number(e.cartons_remaining), 0)
    const tC1 = await mkTrip('TC1'), tC2 = await mkTrip('TC2')
    const iC1 = await mkItem(tC1.do, 200), iC2 = await mkItem(tC2.do, 200)
    r = await api('/wms/outbound/items/date-rule/check', 'POST', { rules: [{ item_id: iC1, rule: RULE99 }, { item_id: iC2, rule: RULE99 }] })
    const c1 = (r.j?.data ?? []).find(x => x.item_id === iC1), c2 = (r.j?.data ?? []).find(x => x.item_id === iC2)
    check('[23c] Hỏi trước khi chốt: mỗi dòng thấy DÒNG KHÁC cùng mã cùng ngày (≥ 1, ≥ 200) và tổng tồn đạt mức = bộ HI',
      r.s === 200 && c1 && c2 && Number(c1.competing_lines) >= 1 && Number(c1.competing_base) >= 200
        && Number(c2.competing_lines) >= 1 && Number(c2.competing_base) >= 200
        && Number(c1.rule_pool_base) === hiPool && Number(c2.rule_pool_base) === hiPool
        && Number(c1.need_base) + Number(c1.competing_base) > Number(c1.rule_pool_base),
      `http=${r.s} c1: rivals=${c1?.competing_lines}/${c1?.competing_base} pool=${c1?.rule_pool_base} (HI=${hiPool}) · c2: rivals=${c2?.competing_lines}/${c2?.competing_base} pool=${c2?.rule_pool_base}`)
    check('[23c2] Cửa gác KHÔNG siết theo tranh chấp — từng dòng vẫn ok=true (giữ chỗ là mềm, chuyến sau vẫn chốt được)',
      c1?.ok === true && c2?.ok === true, `ok=${c1?.ok}/${c2?.ok}`)
    // Chuyến KHÁC NGÀY không phải đối thủ: dòng cùng mã ngày mai không được cộng vào
    const [gT] = await restWrite('GroupDeliveryOrder', 'POST', null, {
      id: randomUUID(), group_code: `${T}_TC3`, warehouse_id: whId, warehouse_type: CAT_A,
      delivery_date: dPlus(1), planned_date: dPlus(1), status: 'PENDING', created_at: nowIso(), updated_at: nowIso(),
    })
    const [dT] = await restWrite('OutboundDelivery', 'POST', null, {
      id: randomUUID(), gdo_id: gT.id, delivery_code: `${T}_TC3_DO`, distributor_name: T, created_at: nowIso(), updated_at: nowIso(),
    })
    const iC3 = await mkItem(dT.id, 200)
    r = await api('/wms/outbound/items/date-rule/check', 'POST', { rules: [{ item_id: iC3, rule: RULE99 }] })
    const c3 = (r.j?.data ?? [])[0]
    check('[23c3] Dòng ngày MAI không thấy hai dòng hôm nay là đối thủ (tranh chấp đo theo NGÀY XUẤT)',
      r.s === 200 && Number(c3?.competing_lines ?? -1) === 0 && Number(c3?.competing_base ?? -1) === 0,
      `rivals=${c3?.competing_lines}/${c3?.competing_base}`)
    for (const g of [tC1.gdo, tC2.gdo, gT.id]) await api(`/wms/outbound/${g}`, 'PATCH', { status: 'CANCELLED' }).catch(() => {})
  }

  // ═══ [24] SẮP LẠI TỰ ĐỘNG THEO TỒN (user chốt 14/09: "chỉ đặt việc lúc Bắt đầu là bước lùi") ════
  // Trigger 20260914e ghi (kho, mã) vào hàng đợi khi tồn của mã đang có việc treo chưa ai đụng đổi; lần
  // tải bảng kế tiếp xả hàng đợi: chạy thử, KHÁC bộ pallet mới sắp lại. Ba chiều: đổi mà không tốt hơn
  // ⇒ không đụng · tốt hơn ⇒ sắp lại có vết STOCK_CHANGED · việc đã hạ ⇒ không bao giờ bị đụng.
  {
    const locQ = await mkLoc('KE', '07', 'T2', 12, 18)
    const R99 = { kind: 'MIN_PCT', value: 99, source: 'MANUAL', set_at: nowIso() }
    const pQ1 = await mkPallet('RQ1', 100, locQ, dPlus(700), -1)            // ≥ 99 % và HSD ngắn nhất trong tập ≥ 99 lúc này
    const tQ = await mkTrip('TRQ')
    await mkItem(tQ.do, 100, { date_rule: R99 })
    r = await startTrip(tQ.gdo, { license_plate: '51C24241', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
    let tkQ = (await tasksOf(tQ.gdo)).filter(t => t.status === 'PENDING')
    const okStart = r.s === 200 && tkQ.length === 1 && tkQ[0].entry_id === pQ1.id
    check('[24a] Bắt đầu → 1 việc ghim RQ1 (HSD ngắn nhất trong tập đạt mức)', okStart, `http=${r.s} việc=${tkQ.length} ghim=${tkQ[0]?.pallet_code}`)
    if (okStart) {
      const id0 = tkQ[0].id
      // Tồn đổi nhưng KHÔNG tốt hơn (HSD dài hơn RQ1) ⇒ hàng đợi có dòng, xả ra KHÔNG sắp lại
      await mkPallet('RQ2', 100, locQ, dPlus(750), -1)
      let q = await restAll('wms_replan_queue', `select=material_id&warehouse_id=eq.${whId}&material_id=eq.${mat.id}`)
      check('[24b] Nhập pallet cùng mã → trigger ghi (kho, mã) vào hàng đợi', q.length === 1, `${q.length} dòng`)
      b = await board('MOVE')
      let after = (await tasksOf(tQ.gdo)).filter(t => t.status === 'PENDING')
      // `auto_replanned` đếm MỌI chuyến của kho fixture (chuyến của các phép kiểm trước còn mở cũng bị
      // xét) nên chỉ đòi là số; oracle là CHÍNH việc của chuyến này
      check('[24c] Xả hàng đợi: pallet mới KHÔNG tốt hơn ⇒ việc của chuyến GIỮ NGUYÊN id (không sắp lại vô cớ)',
        b.s === 200 && Number.isFinite(Number(b.j?.data?.auto_replanned)) && after.length === 1 && after[0].id === id0,
        `http=${b.s} auto=${b.j?.data?.auto_replanned} id giữ=${after[0]?.id === id0}`)
      q = await restAll('wms_replan_queue', `select=material_id&warehouse_id=eq.${whId}&material_id=eq.${mat.id}`)
      check('[24c2] Hàng đợi được xả sạch sau lần tải bảng', q.length === 0, `${q.length} dòng còn`)
      // Tồn đổi TỐT HƠN (HSD ngắn hơn, vẫn ≥ 99 %) ⇒ sắp lại tự động, việc cũ CANCELLED/STOCK_CHANGED, việc mới ghim RQ3
      const pQ3 = await mkPallet('RQ3', 100, locQ, dPlus(600), -1)
      b = await board('MOVE')
      const allQ = await tasksOf(tQ.gdo)
      after = allQ.filter(t => t.status === 'PENDING')
      const old = allQ.find(t => t.id === id0)
      check('[24d] Hàng về HSD ngắn hơn ⇒ lần tải bảng kế tiếp SẮP LẠI: auto_replanned≥1, việc cũ STOCK_CHANGED, việc mới ghim RQ3',
        b.s === 200 && Number(b.j?.data?.auto_replanned) >= 1 && old?.status === 'CANCELLED' && old?.skip_reason === 'STOCK_CHANGED'
          && after.length === 1 && after[0].entry_id === pQ3.id,
        `http=${b.s} auto=${b.j?.data?.auto_replanned} cũ=${old?.status}/${old?.skip_reason} mới=${after[0]?.pallet_code}`)
      // Việc ĐÃ HẠ không bị đụng dù hàng còn tốt hơn nữa về
      if (after.length === 1) {
        const id1 = after[0].id
        await api('/wms/directed/tasks/confirm', 'POST', { task_ids: [id1], stage: 'LOWER' })
        await mkPallet('RQ4', 100, locQ, dPlus(500), -1)
        b = await board('MOVE')
        const kept = (await tasksOf(tQ.gdo)).find(t => t.id === id1)
        check('[24e] Việc ĐÃ HẠ: hàng tốt hơn về vẫn KHÔNG bị đụng (cùng id, vẫn PENDING, mốc hạ còn, vẫn ghim RQ3)',
          b.s === 200 && kept?.status === 'PENDING' && !!kept?.lowered_at && kept?.entry_id === pQ3.id,
          `http=${b.s} auto=${b.j?.data?.auto_replanned} kept=${kept?.status} hạ=${kept?.lowered_at ? 'còn' : 'MẤT'}`)
      }
    }
    await api(`/wms/outbound/${tQ.gdo}`, 'PATCH', { status: 'CANCELLED' }).catch(() => {})
  }

  // ═══ [25] ĐƯỜNG ĐI NHẶT LẺ (user 14/09 "A → B → C sao cho hợp lý") ═══════════════════════════
  // Vị trí lấy = gợi ý đầu của cột "Vị trí lấy"; thứ tự ghé = BFS từ cửa của chuyến. Fixture chỉ có
  // một mã nên một điểm ghé — kiểm hình dạng + routed + vị trí là nơi CÓ hàng của mã.
  {
    const tR = await mkTrip('TROUTE')
    const iR = await mkItem(tR.do, 60, { loose_picking: 60, date_rule: { kind: 'FEFO', source: 'MANUAL', set_at: nowIso() } })
    r = await startTrip(tR.gdo, { license_plate: '51C25251', dock_location_id: dockA, forklift_driver_ids: drvId ? [drvId] : [] })
    const rr = await api(`/wms/directed/loose-route?gdo_id=${tR.gdo}`)
    const st = rr.j?.data?.stops ?? []
    check('[25a] Đường đi nhặt lẻ: 200, có bản vẽ ⇒ routed=true, xuất phát = cửa của chuyến, ≥ 1 điểm ghé seq 1 mang dòng hàng',
      r.s === 200 && rr.s === 200 && rr.j?.data?.routed === true && rr.j?.data?.start_code === 'Cua A'
        && st.length >= 1 && st[0].seq === 1 && st.some(s => s.materials.some(m => m.item_id === iR)),
      `http=${rr.s} routed=${rr.j?.data?.routed} start=${rr.j?.data?.start_code} stops=${st.map(s => `${s.seq}:${s.location_code}`).join(' → ')}`)
    const stockLocs = new Set((await restAll('InventoryEntry', `select=location_id&material_id=eq.${mat.id}&warehouse_id=eq.${whId}&cartons_remaining=gt.0`)).map(e => e.location_id))
    check('[25b] Điểm ghé là vị trí THẬT SỰ có tồn của mã (không chỉ đường tới ô trống)',
      st.length >= 1 && st.every(s => stockLocs.has(s.location_id)), st.map(s => s.location_code).join(','))
    // [25d] THEO VỊ TRÍ CÔNG VIỆC (14/09): mỗi mã mang CÒN LẤY (base) + tên + đơn vị; mỗi điểm mang quãng từ điểm trước;
    // quét nhặt lẻ ĐỦ phần lẻ ⇒ dòng rời khỏi đường đi dù pallet chẵn còn chưa quét (cùng công thức itemLooseProgress)
    {
      const m0 = st[0]?.materials?.find(m => m.item_id === iR)
      check('[25d1] Mỗi mã trên điểm ghé mang remaining_base = phần lẻ còn lấy (60), tên hàng, đơn vị; điểm ghé có quãng ô ≥ 0 và cell_m',
        Number(m0?.remaining_base) === 60 && 'material_name' in (m0 ?? {}) && m0?.units && 'units_per_carton' in m0.units
          && Number(st[0]?.dist_from_prev_cells) >= 0 && Number(rr.j?.data?.cell_m) > 0,
        `rem=${m0?.remaining_base} name=${m0?.material_name} units=${JSON.stringify(m0?.units)} dist=${st[0]?.dist_from_prev_cells} cell_m=${rr.j?.data?.cell_m}`)
      const pal = (await restAll('InventoryEntry', `select=pallet_code,cartons_remaining,cartons_reserved&location_id=eq.${st[0]?.location_id}&material_id=eq.${mat.id}&cartons_remaining=gt.0&order=cartons_remaining.desc&limit=1`))[0]
      const take = Math.min(60, Number(pal?.cartons_remaining ?? 0) - Number(pal?.cartons_reserved ?? 0))
      const sc = await api(`/wms/outbound/${tR.gdo}/items/${iR}/scan`, 'POST',
        { qr_code: pal?.pallet_code, qty_semantics: 'base', cartons_override: take, loose_picking_mode: true, leftover_ui: true, leftover_location_id: 'KEEP' })
      const rr2 = await api(`/wms/directed/loose-route?gdo_id=${tR.gdo}`)
      const st2 = rr2.j?.data?.stops ?? []
      const m2 = st2.flatMap(s => s.materials).find(m => m.item_id === iR)
      check('[25d2] Quét nhặt lẻ N lẻ ⇒ còn lấy giảm đúng N; lấy đủ 60 ⇒ dòng RỜI đường đi (không còn điểm ghé mang nó)',
        sc.s === 200 && rr2.s === 200 && take > 0 && (take >= 60 ? !m2 : Number(m2?.remaining_base) === 60 - take),
        `scan=${sc.s} ${err(sc)} take=${take} rem_sau=${m2?.remaining_base ?? 'rời'} stops=${st2.map(s => `${s.seq}:${s.location_code}`).join(' → ')}`)
    }
    // `GroupDeliveryOrder.id` là TEXT ⇒ id rác = 0 dòng = 404 (luật pg-error-is-user-error: KHÔNG chặn theo hình dạng uuid); chỉ cấm 500
    r = await api('/wms/directed/loose-route?gdo_id=not-a-uuid')
    check('[25c] gdo_id rác → 4xx (404 vì khoá text), không 500', r.s === 400 || r.s === 404, `http=${r.s}`)
    await api(`/wms/outbound/${tR.gdo}`, 'PATCH', { status: 'CANCELLED' }).catch(() => {})
  }

  // ═══ [26] ĐỔI MÃ VỊ TRÍ KHI Ô TRỐNG (user 14/09: "thêm rồi không sửa được khá nhiều — không hợp lý") ═
  // Gõ nhầm lúc tạo mà phải xoá tạo lại là mất toạ độ Sơ đồ kho + cờ. Nay PUT nhận Khu/Dãy/Tầng khi ô
  // KHÔNG hàng, KHÔNG việc treo; mã ghép lại theo tiền tố kho, id giữ nguyên. Có hàng ⇒ 409 nói rõ.
  {
    const [zone] = await restWrite('WarehouseZone', 'POST', null, {
      id: randomUUID(), warehouse_id: whId, code: 'KE', name: 'Ke QA57', categories: [CAT_A], is_active: true,
      created_at: nowIso(), updated_at: nowIso(),
    })
    const locA = await mkLoc('KE', '08', 'T1', 12, 20)          // mkLoc trả ID (như far.T3)
    r = await api(`/masterdata/locations/${locA}`, 'PUT', { row: '80' })
    const a2 = (await restAll('Location', `select=id,location_code,row,shelf,sub_code,grid_x,grid_y&id=eq.${locA}`))[0]
    check('[26a] Ô trống: đổi Dãy → 200, mã ghép lại theo tiền tố kho, giữ id + toạ độ bản vẽ',
      r.s === 200 && a2?.location_code === `${T}_W_KE_80_T1` && a2?.row === '80' && a2?.grid_x === 12 && a2?.grid_y === 20,
      `http=${r.s} ${err(r)} mã=${a2?.location_code} grid=${a2?.grid_x},${a2?.grid_y}`)
    // Ô CÓ HÀNG: far.T3 đang chứa pallet fixture ⇒ 409 có tên lỗi, không đổi gì
    const before = (await restAll('Location', `select=location_code&id=eq.${far.T3}`))[0]?.location_code
    r = await api(`/masterdata/locations/${far.T3}`, 'PUT', { row: '99' })
    const after = (await restAll('Location', `select=location_code&id=eq.${far.T3}`))[0]?.location_code
    check('[26b] Ô CÓ HÀNG: đổi Dãy → 409 LOCATION_NOT_EMPTY, mã giữ nguyên',
      r.s === 409 && r.j?.error?.code === 'LOCATION_NOT_EMPTY' && after === before, `http=${r.s} ${err(r)} mã=${after}`)
    // Trùng mã với ô khác ⇒ 409 DUPLICATE
    const locB = await mkLoc('KE', '09', 'T1', 13, 20)
    r = await api(`/masterdata/locations/${locB}`, 'PUT', { row: '80' })
    check('[26c] Đổi sang mã đã có ô khác dùng → 409 DUPLICATE', r.s === 409 && r.j?.error?.code === 'DUPLICATE', `http=${r.s} ${err(r)}`)
    // Khu không có trong danh mục ⇒ 400 (cùng luật lúc tạo)
    r = await api(`/masterdata/locations/${locB}`, 'PUT', { sub_code: 'KHONGCO' })
    check('[26d] Đổi sang khu chưa khai → 400', r.s === 400, `http=${r.s} ${err(r)}`)
    // Chỉ sửa sức chứa (không gửi Khu/Dãy/Tầng) ⇒ đường cũ y nguyên, không đụng mã
    r = await api(`/masterdata/locations/${locB}`, 'PUT', { max_pallets: 7 })
    const b2 = (await restAll('Location', `select=location_code,max_pallets&id=eq.${locB}`))[0]
    check('[26e] PUT không mang Khu/Dãy/Tầng → hành vi cũ, mã không đổi', r.s === 200 && Number(b2?.max_pallets) === 7 && b2?.location_code === `${T}_KE_09_T1`,
      `http=${r.s} mã=${b2?.location_code} max=${b2?.max_pallets}`)
    await restWrite('WarehouseZone', 'DELETE', `id=eq.${zone.id}`).catch(() => {})
  }

  // ═══ [17] BẤT BIẾN CHUNG ═════════════════════════════════════════════════════════════════════
  const allTasks = await restAll('wms_tasks', `select=id,gdo_id,item_id,qty_base,status&warehouse_id=eq.${whId}`)
  const openByItem = new Map()
  for (const t of allTasks.filter(x => x.status === 'PENDING'))
    openByItem.set(t.item_id, (openByItem.get(t.item_id) ?? 0) + Number(t.qty_base))
  let overplan = 0
  for (const [itemId, q] of openByItem) {
    const it = (await restAll('OutboundItem', `select=cartons_ordered,cartons_scanned&id=eq.${itemId}`))[0]
    if (!it) continue
    if (q > Number(it.cartons_ordered) - Number(it.cartons_scanned)) overplan++
  }
  check('[17] Không dòng nào bị lập việc VƯỢT nhu cầu còn lại', overplan === 0, `${overplan} dòng vượt`)
} catch (e) {
  check('chạy trọn gói', false, String(e).slice(0, 200))
} finally {
  // QA_KEEP_FIXTURE=1 (12/09): GIỮ kho QA57_W + chuyến đang chạy để soi bằng mắt trên Preview (chế độ thẻ
  // PDA, nút Nhận…) — staging không có chuyến GUIDED nào đang mở ngoài fixture này. Lượt chạy sau tự dọn
  // ở đầu gói. CHỈ dùng tay, CI không đặt cờ này.
  if (process.env.QA_KEEP_FIXTURE === '1') {
    console.log(`⚠ QA_KEEP_FIXTURE=1 — giữ fixture ${T}_W để soi bằng mắt; chạy lại gói (không cờ) để dọn`)
  } else {
    await cleanup()
    // Quét PHÒNG THỦ đủ mọi bảng fixture — bản đầu chỉ soi wms_tasks nên không thấy kho rác còn lại
    // (bài học skill check-app: verifyClean có điểm mù thì lượt sau đỏ ở chỗ không liên quan).
    const residue = []
    for (const [tbl, col] of [['wms_tasks', 'pallet_code'], ['InventoryEntry', 'pallet_code'],
      ['Location', 'location_code'], ['GroupDeliveryOrder', 'group_code'],
      ['OutboundDelivery', 'delivery_code'], ['Material', 'material_code'], ['Warehouse', 'code']]) {
      const rows = await restAll(tbl, `select=id&${col}=like.${T}*`)
      if (rows.length) residue.push(`${tbl}:${rows.length}`)
    }
    check('[18] DỌN SẠCH — quét đủ 7 bảng fixture, không sót bản ghi nào', residue.length === 0, residue.join(' '))
  }
}

finish('57-directed-work')
