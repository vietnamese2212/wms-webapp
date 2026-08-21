// GÓI 25 — NGUYÊN TẮC LUÂN CHUYỂN FEFO/FIFO/LIFO (14/08). Luật "bug chết hai lần" cho lớp lỗi
// đã đo được ngày 14/08: luật "pallet nào nên lấy trước" tồn tại 4 BẢN CHÉP TAY khác nhau —
// cột "Vị trí lấy" sắp theo %Date (tức HSD), 3 màn quét so production_date (tức NSX), và nền so
// sánh của cảnh báo hẹp hơn tập pallet thật sự lấy được. Hàng cùng mã khác NCC có shelf-life khác
// nhau ⇒ hai bản chỉ vào HAI pallet khác nhau là chuyện thường. Thêm nữa gợi ý KHÔNG lọc pallet bị
// QA giữ, mà lúc quét thì chặn — công nhân đi tới nơi mới biết không lấy được.
//
// Fixture cố tình dựng ca mà FEFO và FIFO TRẢ LỜI KHÁC NHAU (pallet NSX mới nhưng HSD ngắn nhất):
// nếu ai đó lỡ gộp hai khái niệm lại làm một, gói này đỏ ngay.
//
// 13 phép kiểm: FEFO chọn đúng HSD ngắn nhất · FIFO chọn đúng NSX cũ nhất (KHÁC pallet FEFO) ·
// pallet QA giữ không bao giờ được đề cử · quét đúng thứ tự = không vi phạm · kho chỉ-cảnh-báo
// KHÔNG chặn · kho bắt-buộc chặn khi thiếu lý do · mã lý do bậy bị từ chối · có lý do thì qua và
// GHI VẾT đủ 4 cột · cột gợi ý không liệt kê vị trí của pallet QA · dòng ghi lưu đúng nguyên tắc
// đang hiệu lực · [11..13] HÀNG DƯ sau khi bốc đặt sang ô khác phải theo QUY TẮC CẤT của kho
// (cảnh báo / chặn theo mức), còn "Giữ chỗ cũ" thì không bao giờ bị chặn.
// usage: node scripts/qa/25-rotation.mjs
import { login, api, check, finish, restAll, restWrite } from './lib.mjs'
import { randomUUID } from 'crypto'

const TAG = 'QA-ROTATION'
console.log('── GÓI ROTATION (nguyên tắc luân chuyển) ──')
await login()

const nowIso = () => new Date().toISOString()
const vnDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const created = { locs: [], entries: [], gdo: null, do: null, items: [] }
let whId = null, whBackup = null, putBackup = null

async function cleanup() {
  for (const id of created.items) await restWrite('OutboundScanEntry', 'DELETE', `item_id=eq.${id}`)
  for (const id of created.items) await restWrite('OutboundItem', 'DELETE', `id=eq.${id}`)
  if (created.do)  await restWrite('OutboundDelivery', 'DELETE', `id=eq.${created.do}`)
  if (created.gdo) await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${created.gdo}`)
  for (const id of created.entries) await restWrite('InventoryEntry', 'DELETE', `id=eq.${id}`)
  for (const id of created.locs)    await restWrite('Location', 'DELETE', `id=eq.${id}`)
  // TRẢ cấu hình kho về nguyên trạng — gói QA không được để lại kho đang bật "bắt buộc"
  if (whId && whBackup) await restWrite('Warehouse', 'PATCH', `id=eq.${whId}`, whBackup)
  // Luật CẤT trả qua API để backend xoá luôn cache 30s (ghi thẳng PostgREST thì instance đang
  // chạy vẫn giữ bản "bắt buộc" sau khi gói kết thúc → chặn oan người dùng thật).
  if (whId && putBackup) await api(`/masterdata/warehouses/${whId}`, 'PUT', putBackup)
}
// Tàn dư lần chạy hỏng giữa chừng → dọn trước (fixture phải TỰ HỒI PHỤC)
for (const [t, col] of [['InventoryEntry', 'pallet_code'], ['Location', 'location_code']]) {
  const olds = await restAll(t, `select=id&${col}=like.${TAG}-*`)
  for (const o of olds) await restWrite(t, 'DELETE', `id=eq.${o.id}`)
}

try {
  // ── Fixture ────────────────────────────────────────────────────────────────
  const anyEntry = (await restAll('InventoryEntry', 'select=warehouse_id,material_id&limit=1&cartons_remaining=gt.0'))[0]
  if (!anyEntry) { check('có dữ liệu tồn để dựng fixture', false, 'kho rỗng'); finish('ROTATION'); process.exit() }
  whId = anyEntry.warehouse_id

  // MÃ dùng cho fixture phải KHÔNG CÓ tồn sống nào khác trong kho này.
  // VÌ SAO (bug của chính gói này, đo 21/08): trước đây gói lấy luôn `anyEntry.material_id`, tức MỘT
  // MÃ TUỲ Ý đang có tồn — rồi dựng 3 pallet với ngày CỐ ĐỊNH và khẳng định pallet SHORT là "HSD
  // ngắn nhất". Khẳng định đó chỉ đúng khi mã đó không có lô nào cũ hơn. Nó xanh nhiều tháng vì
  // `limit=1` KHÔNG có ORDER BY nên vô tình luôn bốc đúng một mã "sạch" — cho tới khi
  // `ALTER COLUMN TYPE` (migration 20260821h) GHI LẠI TOÀN BẢNG làm đổi thứ tự dòng vật lý ⇒ bốc
  // phải mã có lô NSX 14/07 (HSD suy ra 28/08, sớm hơn 01/12 của fixture) ⇒ 4 phép kiểm FEFO đỏ
  // dù engine trả lời HOÀN TOÀN ĐÚNG.
  // Nay chọn mã TRỐNG tồn ⇒ fixture là TOÀN BỘ tập ứng viên ⇒ kết quả tất định, không phụ thuộc
  // dữ liệu nền (staging giữ ~150k dòng seed vĩnh viễn nên "dữ liệu nền" chỉ ngày càng dày).
  const liveMatIds = new Set((await restAll('InventoryEntry',
    `select=material_id&warehouse_id=eq.${whId}&cartons_remaining=gt.0`)).map(r => r.material_id))
  const cands = await restAll('Material',
    'select=id,material_code,category,shelf_life_days&is_active=is.true&is_non_stock=not.is.true'
    + '&category=not.is.null&order=material_code&limit=1000')
  const mat = cands.find(m => !liveMatIds.has(m.id))
  if (!mat) {
    check('tìm được mã TRỐNG tồn để dựng fixture tất định', false,
      `${cands.length} mã ứng viên đều đang có tồn ở kho ${whId}`)
    finish('ROTATION'); process.exit()
  }
  const [wh] = await restAll('Warehouse',
    `select=id,rotation_principle,rotation_required,putaway_enforced&id=eq.${whId}`)
  whBackup = { rotation_principle: wh?.rotation_principle ?? 'FEFO', rotation_required: wh?.rotation_required === true, updated_at: nowIso() }
  putBackup = { putaway_enforced: wh?.putaway_enforced ?? [] }

  const setRot = (principle, required) =>
    restWrite('Warehouse', 'PATCH', `id=eq.${whId}`, { rotation_principle: principle, rotation_required: required, updated_at: nowIso() })
  // Luật CẤT đi qua API (backend cache 30s cho hot-path quét — ghi thẳng DB thì luật không hiệu lực)
  const setPut = (enforced) => api(`/masterdata/warehouses/${whId}`, 'PUT', { putaway_enforced: enforced })
  // Cache cấu hình 30s/instance serverless → phải chờ hết cửa sổ mới đo được mức BẮT BUỘC
  const waitConfigSettled = () => new Promise(r => setTimeout(r, 31_000))

  const mkLoc = async (code, extra = {}) => {
    const [row] = await restWrite('Location', 'POST', null, {
      id: randomUUID(), location_code: `${TAG}-${code}`, warehouse_id: whId, max_pallets: 20,
      is_active: true, row: 'QA', shelf: '1', sub_code: `${TAG}-${code}`,
      created_at: nowIso(), updated_at: nowIso(), ...extra,
    })
    created.locs.push(row.id)
    return row.id
  }
  const locMain = await mkLoc('MAIN')
  const locQa   = await mkLoc('QAHOLD')
  const locNoIn1 = await mkLoc('NOIN1', { slot_no_in: true })
  const locNoIn2 = await mkLoc('NOIN2', { slot_no_in: true })

  // Pallet: cố tình để FEFO ≠ FIFO.
  //   OLD  — NSX cũ nhất (2026-01-01) nhưng HSD xa (2027-06-01) → FIFO chọn cái này
  //   SHORT— NSX mới (2026-06-01) nhưng HSD gần nhất (2026-12-01) → FEFO chọn cái này
  //   HOLD — NSX + HSD đều sớm nhất NHƯNG bị QA giữ → KHÔNG bao giờ được đề cử
  const mkPallet = async (code, qty, locId, prod, exp, qaId = null) => {
    const [row] = await restWrite('InventoryEntry', 'POST', null, {
      id: randomUUID(), pallet_code: `${TAG}-${code}`, material_id: mat.id, warehouse_id: whId,
      location_id: locId, cartons_imported: qty, cartons_remaining: qty, cartons_reserved: 0,
      status: 'IN_STOCK', production_date: prod, expiry_date: exp, qa_status_id: qaId,
      import_date: vnDate(), created_at: nowIso(), updated_at: nowIso(),
    })
    created.entries.push(row.id)
    return row.id
  }
  const [qaHold] = await restAll('QAStatus', 'select=id,code&code=neq.OK&limit=1')
  await mkPallet('OLD',   100, locMain, '2026-01-01', '2027-06-01')
  await mkPallet('SHORT', 100, locMain, '2026-06-01', '2026-12-01')
  if (qaHold) await mkPallet('HOLD', 100, locQa, '2025-01-01', '2026-01-05', qaHold.id)

  // Chuyến ĐANG XUẤT ngày HÔM NAY (luật 02/08: ngày tương lai bị chặn FUTURE_DATE)
  const [gdo] = await restWrite('GroupDeliveryOrder', 'POST', null, {
    id: randomUUID(), group_code: `${TAG}-GDO`, warehouse_id: whId, warehouse_type: mat.category,
    delivery_date: vnDate(), planned_date: vnDate(), status: 'IN_PROGRESS',
    license_plate: 'QAROTATIONXE', started_at: nowIso(), created_at: nowIso(), updated_at: nowIso(),
  })
  created.gdo = gdo.id
  const [dlv] = await restWrite('OutboundDelivery', 'POST', null, {
    id: randomUUID(), gdo_id: gdo.id, delivery_code: `${TAG}-DO`, distributor_name: TAG,
    created_at: nowIso(), updated_at: nowIso(),
  })
  created.do = dlv.id
  const mkItem = async (ordered) => {
    const [row] = await restWrite('OutboundItem', 'POST', null, {
      id: randomUUID(), do_id: dlv.id, material_id: mat.id, material_code_raw: mat.material_code,
      cartons_ordered: ordered, cartons_scanned: 0, loose_picking: 0, status: 'PENDING',
      created_at: nowIso(), updated_at: nowIso(),
    })
    created.items.push(row.id)
    return row.id
  }
  const itemA = await mkItem(500)

  const checkScan = (itemId, qr) => api(`/wms/outbound/${gdo.id}/items/${itemId}/check-scan`, 'POST', { qr_code: qr })
  const scan = (itemId, body) => api(`/wms/outbound/${gdo.id}/items/${itemId}/scan`, 'POST', body)

  // ── [1] FEFO chọn HSD ngắn nhất ────────────────────────────────────────────
  await setRot('FEFO', false)
  {
    const r = await checkScan(itemA, `${TAG}-OLD`)
    const rot = r.j?.data?.rotation
    check('[1] FEFO: quét pallet HSD xa → báo vi phạm, chỉ sang pallet HSD 2026-12-01',
      r.s === 200 && rot?.principle === 'FEFO' && rot?.violation === true
      && rot?.best_date === '2026-12-01' && rot?.best_pallet_code === `${TAG}-SHORT` && rot?.date_label === 'HSD',
      `http=${r.s} rot=${JSON.stringify(rot)}`)
  }
  {
    const r = await checkScan(itemA, `${TAG}-SHORT`)
    check('[2] FEFO: quét đúng pallet HSD ngắn nhất → KHÔNG vi phạm',
      r.s === 200 && r.j?.data?.rotation?.violation === false,
      `http=${r.s} rot=${JSON.stringify(r.j?.data?.rotation)}`)
  }

  // ── [3] FIFO trả lời KHÁC FEFO (chống gộp 2 khái niệm làm một) ─────────────
  await setRot('FIFO', false)
  {
    const rShort = await checkScan(itemA, `${TAG}-SHORT`)
    const rOld   = await checkScan(itemA, `${TAG}-OLD`)
    check('[3] FIFO: đảo kết luận — pallet NSX mới thành vi phạm, pallet NSX cũ thành hợp lệ',
      rShort.j?.data?.rotation?.violation === true && rShort.j?.data?.rotation?.best_pallet_code === `${TAG}-OLD`
      && rShort.j?.data?.rotation?.date_label === 'NSX' && rOld.j?.data?.rotation?.violation === false,
      `short=${JSON.stringify(rShort.j?.data?.rotation)} old=${JSON.stringify(rOld.j?.data?.rotation)}`)
  }

  // ── [4] Pallet bị QA GIỮ không bao giờ được đề cử ──────────────────────────
  await setRot('FEFO', false)
  if (qaHold) {
    const r = await checkScan(itemA, `${TAG}-OLD`)
    const rot = r.j?.data?.rotation
    check('[4] Pallet QA giữ (HSD sớm nhất) KHÔNG được đề cử — lúc quét bị chặn nên đề cử là chỉ sai đường',
      rot?.best_pallet_code === `${TAG}-SHORT` && rot?.best_pallet_code !== `${TAG}-HOLD`,
      `best=${rot?.best_pallet_code}`)
    const sug = await api(`/wms/outbound/${gdo.id}/pick-suggestions`)
    const locs = JSON.stringify(sug.j?.data ?? {})
    check('[5] Cột "Vị trí lấy" không liệt kê vị trí của pallet QA giữ',
      sug.s === 200 && !locs.includes(`${TAG}-QAHOLD`), `http=${sug.s}`)
  } else {
    check('[4] Pallet QA giữ không được đề cử', true, 'BỎ QUA — DB không có QAStatus khác OK')
    check('[5] Cột "Vị trí lấy" bỏ pallet QA giữ', true, 'BỎ QUA — DB không có QAStatus khác OK')
  }

  // ── [6] Kho CHỈ CẢNH BÁO: không được chặn ─────────────────────────────────
  {
    const r = await scan(itemA, { qr_code: `${TAG}-OLD`, cartons_override: 10, qty_semantics: 'base', leftover_ui: true, leftover_location_id: 'KEEP' })
    check('[6] Kho chỉ-cảnh-báo: quét sai thứ tự VẪN lưu được (không đổi hành vi cũ)',
      r.s === 200 || r.s === 201, `http=${r.s} ${JSON.stringify(r.j?.error ?? '')}`)
    const [se] = await restAll('OutboundScanEntry', `select=rotation_violation,rotation_principle,rotation_best_date,rotation_override_reason&item_id=eq.${itemA}&pallet_code=eq.${TAG}-OLD`)
    check('[7] Ghi VẾT: vi phạm=true, nguyên tắc FEFO, date nên lấy 2026-12-01, không có lý do vượt rào',
      se?.rotation_violation === true && se?.rotation_principle === 'FEFO'
      && se?.rotation_best_date === '2026-12-01' && !se?.rotation_override_reason,
      JSON.stringify(se))
  }

  // ── [8..10] Kho BẮT BUỘC: chặn, đòi lý do đúng danh sách ──────────────────
  await setRot('FEFO', true)
  const itemB = await mkItem(500)
  {
    const r = await scan(itemB, { qr_code: `${TAG}-OLD`, cartons_override: 10, qty_semantics: 'base', leftover_ui: true, leftover_location_id: 'KEEP' })
    check('[8] Kho bắt buộc: quét sai thứ tự mà THIẾU lý do → 422, không ghi gì',
      r.s === 422 && (await restAll('OutboundScanEntry', `select=id&item_id=eq.${itemB}`)).length === 0,
      `http=${r.s} code=${r.j?.error?.code}`)
  }
  {
    const r = await scan(itemB, { qr_code: `${TAG}-OLD`, cartons_override: 10, qty_semantics: 'base', leftover_ui: true, leftover_location_id: 'KEEP', rotation_override_reason: 'KHONG_CO_MA_NAY' })
    check('[9] Lý do NGOÀI danh sách bị từ chối (không cho gõ tự do → báo cáo mới gom nhóm được)',
      r.s === 422 && (await restAll('OutboundScanEntry', `select=id&item_id=eq.${itemB}`)).length === 0,
      `http=${r.s} code=${r.j?.error?.code}`)
  }
  {
    const r = await scan(itemB, { qr_code: `${TAG}-OLD`, cartons_override: 10, qty_semantics: 'base', leftover_ui: true, leftover_location_id: 'KEEP', rotation_override_reason: 'BLOCKED' })
    const [se] = await restAll('OutboundScanEntry', `select=rotation_violation,rotation_override_reason&item_id=eq.${itemB}`)
    check('[10] Có lý do hợp lệ → qua được VÀ lưu vết lý do (van xả có dấu vết, không phải cửa mở toang)',
      (r.s === 200 || r.s === 201) && se?.rotation_violation === true && se?.rotation_override_reason === 'BLOCKED',
      `http=${r.s} se=${JSON.stringify(se)}`)
  }

  // ── [11..13] HÀNG DƯ SAU KHI BỐC = MỘT LẦN CẤT HÀNG (user chốt 18/08) ─────────────────
  // Bốc không hết rồi mang phần dư sang ô khác thì đó là "đưa hàng vào ô đó" — trước 18/08 cửa này
  // đi thẳng xuống RPC move, không hỏi luật cất, nên ô đánh dấu "không đưa hàng vào" vẫn nhận hàng
  // qua đường xuất. Van an toàn: "Giữ chỗ cũ" KHÔNG bị chấm (pallet đã nằm sẵn đó — chặn là ngõ cụt).
  await setRot('FEFO', false)          // tách khỏi luật luân chuyển: đang đo luật CẤT
  const itemC = await mkItem(500)
  const locOf = async (code) => (await restAll('InventoryEntry',
    `select=location_id&pallet_code=eq.${code}`))[0]?.location_id ?? null
  {
    const r = await scan(itemC, { qr_code: `${TAG}-OLD`, cartons_override: 10, qty_semantics: 'base',
      leftover_ui: true, leftover_location_id: locNoIn1 })
    check('[11] Kho chỉ CẢNH BÁO: hàng dư vẫn đặt được vào ô "không đưa hàng vào" NHƯNG có cảnh báo',
      (r.s === 200 || r.s === 201) && /không đưa hàng vào/i.test(r.j?.data?.putaway_warning ?? '')
        && (await locOf(`${TAG}-OLD`)) === locNoIn1,
      `http=${r.s} warn=${r.j?.data?.putaway_warning ?? 'KHÔNG có'}`)
  }
  await setPut(['NO_IN']); await waitConfigSettled()
  {
    const r = await scan(itemC, { qr_code: `${TAG}-SHORT`, cartons_override: 10, qty_semantics: 'base',
      leftover_ui: true, leftover_location_id: locNoIn2 })
    check('[12] Kho BẮT BUỘC: gọi THẲNG API vẫn KHÔNG đặt được hàng dư vào ô cấm, pallet đứng yên',
      r.s === 422 && r.j?.error?.code === 'PUTAWAY_VIOLATION'
        && (await locOf(`${TAG}-SHORT`)) === locMain,
      `http=${r.s} code=${r.j?.error?.code} loc=${await locOf(`${TAG}-SHORT`)}`)
  }
  {
    // Pallet OLD đang NẰM ở ô cấm (từ [11]). Nếu "Giữ chỗ cũ" cũng bị chặn thì người quét kẹt:
    // không lưu được lượt quét mà cũng chẳng có cách nào dời pallet đi trong màn quét.
    const itemD = await mkItem(500)   // item MỚI: cùng pallet + cùng item = lượt quét trùng, bị chặn vì lý do khác
    const r = await scan(itemD, { qr_code: `${TAG}-OLD`, cartons_override: 10, qty_semantics: 'base',
      leftover_ui: true, leftover_location_id: 'KEEP' })
    check('[13] "Giữ chỗ cũ" KHÔNG bị chặn dù pallet đang ở chính ô cấm (không tạo ngõ cụt)',
      r.s === 200 || r.s === 201, `http=${r.s} ${JSON.stringify(r.j?.error ?? '')}`)
  }
} catch (e) {
  check('gói chạy không nổ', false, String(e))
} finally {
  await cleanup()
}

finish('ROTATION')
