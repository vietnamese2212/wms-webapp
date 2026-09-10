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
  const [wh] = await restWrite('Warehouse', 'POST', null, {
    id: randomUUID(), code: `${T}_W`, name: 'QA directed work', warehouse_type: CAT_A,
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
    id: randomUUID(), code: `${T}_Q`, name: 'QA dw qty', warehouse_type: CAT_A, inventory_mode: 'QTY',
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
  const dists = tk.map(t => Number(t.dist_cells ?? 1e9))
  check('[5c3] ORACLE đường đi — thứ tự ĐI tăng dần theo khoảng cách từ cửa (đi một vòng, không nhảy)',
    dists.every((d, i) => i === 0 || d >= dists[i - 1]), tk.map(t => `${t.seq}:${t.dist_cells}ô`).join(' '))
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
  check('[5i] Đích của việc ra cửa = CỬA của chuyến', tk.length > 0 && tk.every(t => t.to_location_id === dockA && t.to_kind === 'DOCK'))
  check('[5j] Có khoảng cách BFS từ cửa (bản vẽ đã vẽ)', tk.length > 0 && tk.every(t => t.dist_cells != null), tk.map(t => t.dist_cells).join(','))

  // ═══ [6] LẬP LẠI KHÔNG ĐẺ THÊM (idempotent) ══════════════════════════════════════════════════
  r = await api(`/wms/directed/gdos/${t2.gdo}/replan`, 'POST', {})
  const tk2 = await tasksOf(t2.gdo)
  check('[6] Sắp lại → 0 việc mới (nhu cầu đã được việc treo phủ hết)',
    r.s === 200 && r.j?.data?.created === 0 && tk.length > 0 && tk2.length === tk.length, `created=${r.j?.data?.created} ${tk.length}→${tk2.length}`)

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
  check('[10b2] Bảng "Cần đưa ra": việc CHƯA hạ thì KHÔNG bấm được (phải chờ xe hạ)',
    moveRows.filter(x => x.waiting_lower).every(x => x.can_confirm === false),
    moveRows.filter(x => x.waiting_lower).map(x => `${x.current_code}:${x.can_confirm}`).slice(0, 4).join(' ') || 'không có dòng chờ hạ')
  check('[10b] Bảng "Cần đưa ra" hiện VỊ TRÍ HIỆN TẠI của pallet kể cả đang trên kệ',
    b.s === 200 && moveRows.length > 0 && moveRows.every(x => !!x.current_code), moveRows.map(x => x.current_code).join(' '))
  check('[10c] Dòng chưa hạ được đánh dấu "chờ xe hạ" (mờ, chưa bấm được)',
    moveRows.some(x => x.waiting_lower === true && x.can_confirm === false))
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
  } else check('[12c] Quét pallet khác kế hoạch', true, 'không còn pallet rảnh để thử — bỏ qua')

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
    await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i3], rule: { kind: 'MIN_PCT', value: 1 } })
    const beforeIds = (await restAll('wms_tasks', `select=id&item_id=eq.${i3}&status=eq.PENDING`)).map(x => x.id).sort()
    // Đếm DELTA quanh đúng lần PATCH này, không đếm TỔNG tích luỹ: dòng i3 bị đổi quy tắc nhiều lần
    // trong khối này nên đếm tổng khiến phép kiểm phụ thuộc lịch sử — chập chờn, đã đỏ oan 1 lượt 10/09.
    const cancel0 = (await restAll('wms_tasks', `select=id&item_id=eq.${i3}&status=eq.CANCELLED&skip_reason=eq.DATE_RULE_CHANGED`)).length
    await api('/wms/outbound/items/date-rule', 'PATCH', { item_ids: [i3], rule: { kind: 'MIN_PCT', value: 50 } })
    const afterIds = (await restAll('wms_tasks', `select=id&item_id=eq.${i3}&status=eq.PENDING`)).map(x => x.id).sort()
    const cancelled = (await restAll('wms_tasks', `select=id&item_id=eq.${i3}&status=eq.CANCELLED&skip_reason=eq.DATE_RULE_CHANGED`)).length - cancel0
    check('[15s] Đổi %Date khi đã có việc → việc CHƯA AI ĐỤNG bị bỏ và sắp lại (không giữ pallet sai date)',
      beforeIds.length > 0 && cancelled >= beforeIds.length && JSON.stringify(beforeIds) !== JSON.stringify(afterIds),
      `trước=${beforeIds.length} sau=${afterIds.length} lần này bỏ=${cancelled}`)

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

finish('57-directed-work')
