// GÓI 29 — LOẠI KHO THEO TỪNG KHO + CHIẾN THUẬT XUẤT/NHẬP 2 TẦNG (21/08).
// Luật "bug chết hai lần" cho đợt này. Ba lớp lỗi mà gói gác:
//   1. HỒI QUY: chưa khai override thì MỌI hành vi phải y hệt trước 21/08 (tiêu chí số 1 của đợt).
//      Kiểm bằng cách so trực tiếp cùng một lượt quét khi bật/tắt override trên CÙNG fixture.
//   2. Override IM LẶNG KHÔNG ĂN: cấu hình lưu được nhưng engine vẫn chạy mặc định kho — không lỗi,
//      không cảnh báo, chỉ sai thứ tự lấy hàng. Fixture cố ý dựng ca FEFO ≠ FIFO nên nếu override
//      không ăn thì kết luận vi phạm không đổi và gói ĐỎ.
//   3. VÒNG ĐỜI: gỡ loại khỏi kho khi CÒN TỒN không được khoá đường xử lý tồn cũ (user chốt 20/08:
//      "ngừng vận hành", không phải xoá) và chiến thuật riêng phải rơi về mặc định kho, không lỗi.
// Kèm: xoá Loại kho khỏi danh mục khi còn kho vận hành / còn chuyến chở lẫn → 409 (lỗ `eq` với
// chuỗi ghép 'FG01+PM01' vá cùng đợt).
// usage: node scripts/qa/29-wh-type-strategy.mjs
import { login, api, check, finish, restAll, restWrite, resolveFixtures, FIX } from './lib.mjs'
import { randomUUID } from 'crypto'

const TAG = 'QA-WHTYPE'
console.log('── GÓI LOẠI KHO 2 TẦNG (chiến thuật xuất/nhập theo loại) ──')
await login()
await resolveFixtures()

const nowIso = () => new Date().toISOString()
const vnDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const whId = FIX.WH_QR.id
const created = { locs: [], entries: [], gdo: null, do: null, items: [] }
let whBackup = null, cfgBackup = null

const STRAT_COLS = 'rotation_principle,rotation_required,putaway_priority,putaway_enforced,' +
  'putaway_max_materials,putaway_date_mix,putaway_block_pick_face,putaway_block_qa_hold,' +
  'putaway_block_full,putaway_single_ncc,putaway_same_mat_date_pref,putaway_fallback'

// Dọn theo TAG trước (lần chạy hỏng giữa chừng để lại fixture mồ côi)
async function sweep() {
  for (const t of ['OutboundScanEntry']) {
    for (const r of await restAll(t, `select=id&pallet_code=like.${TAG}-*`)) await restWrite(t, 'DELETE', `id=eq.${r.id}`)
  }
  for (const g of await restAll('GroupDeliveryOrder', `select=id&group_code=like.${TAG}-*`)) {
    for (const d of await restAll('OutboundDelivery', `select=id&gdo_id=eq.${g.id}`)) {
      for (const it of await restAll('OutboundItem', `select=id&do_id=eq.${d.id}`)) {
        await restWrite('OutboundScanEntry', 'DELETE', `item_id=eq.${it.id}`)
        await restWrite('OutboundItem', 'DELETE', `id=eq.${it.id}`)
      }
      await restWrite('OutboundDelivery', 'DELETE', `id=eq.${d.id}`)
    }
    await restWrite('GroupDeliveryOrder', 'DELETE', `id=eq.${g.id}`)
  }
  for (const e of await restAll('InventoryEntry', `select=id&pallet_code=like.${TAG}-*`)) await restWrite('InventoryEntry', 'DELETE', `id=eq.${e.id}`)
  for (const l of await restAll('Location', `select=id&location_code=like.${TAG}-*`)) await restWrite('Location', 'DELETE', `id=eq.${l.id}`)
}
async function cleanup() {
  await sweep()
  // TRẢ cấu hình kho + tập loại về nguyên trạng — qua API để backend xoá luôn cache 30s
  // (ghi thẳng DB thì instance đang chạy vẫn giữ bản test và chặn oan người dùng thật).
  if (whBackup) await api(`/masterdata/warehouses/${whId}`, 'PUT', whBackup)
  if (cfgBackup) await api(`/masterdata/warehouses/${whId}/type-configs`, 'PUT', { items: cfgBackup })
}
await sweep()

try {
  // ── Fixture: 2 mã KHÁC LOẠI trong cùng kho ───────────────────────────────
  const [wh] = await restAll('Warehouse', `select=id,${STRAT_COLS}&id=eq.${whId}`)
  whBackup = Object.fromEntries(STRAT_COLS.split(',').map(k => [k, wh?.[k] ?? null]))
  const cfg0 = await api(`/masterdata/warehouses/${whId}/type-configs`)
  cfgBackup = (cfg0.j?.data ?? []).map(r => {
    const o = { type_code: r.type_code, sort_order: r.sort_order ?? null }
    for (const k of STRAT_COLS.split(',')) o[k] = r[k] ?? null
    return o
  })
  check('[0] GET type-configs trả tập loại kho đang vận hành',
    cfg0.s === 200 && Array.isArray(cfg0.j?.data) && cfg0.j.data.length > 0,
    `http=${cfg0.s} n=${cfg0.j?.data?.length}`)

  // Mã A = loại của fixture (FG01…), mã B = loại KHÁC — cần cả hai để chứng minh override chỉ
  // ăn ĐÚNG loại được khai, không lan sang loại khác.
  const catA = FIX.MAT_POOL_CAT
  const matA = { id: FIX.MAT_POOL_ID, code: FIX.MAT_POOL, category: catA }
  const [matB] = await restAll('Material',
    `select=id,material_code,category&category=neq.${catA}&category=not.is.null&is_non_stock=not.is.true&order=material_code&limit=1`)
  if (!matB) { check('có 2 loại kho khác nhau để dựng fixture', false, 'DB chỉ có 1 loại'); finish('WHTYPE'); process.exit() }
  const catB = matB.category

  const mkLoc = async (code, extra = {}) => {
    const [row] = await restWrite('Location', 'POST', null, {
      id: randomUUID(), location_code: `${TAG}-${code}`, warehouse_id: whId, max_pallets: 20,
      is_active: true, row: 'QA', shelf: '1', sub_code: `${TAG}-${code}`,
      categories: [catA, catB], created_at: nowIso(), updated_at: nowIso(), ...extra,
    })
    created.locs.push(row.id)
    return row.id
  }
  const loc = await mkLoc('L1')

  // Mỗi mã 2 pallet dựng ca FEFO ≠ FIFO:
  //   OLD  : NSX cũ (2026-01-01), HSD xa (2027-06-01) → FIFO chọn
  //   SHORT: NSX mới (2026-06-01), HSD gần (2026-12-01) → FEFO chọn
  const mkPallet = async (code, matId, prod, exp) => {
    const [row] = await restWrite('InventoryEntry', 'POST', null, {
      id: randomUUID(), pallet_code: `${TAG}-${code}`, material_id: matId, warehouse_id: whId,
      location_id: loc, cartons_imported: 200, cartons_remaining: 200, cartons_reserved: 0,
      status: 'IN_STOCK', production_date: prod, expiry_date: exp,
      import_date: vnDate(), created_at: nowIso(), updated_at: nowIso(),
    })
    created.entries.push(row.id)
    return row.id
  }
  await mkPallet('A-OLD',   matA.id, '2026-01-01', '2027-06-01')
  await mkPallet('A-SHORT', matA.id, '2026-06-01', '2026-12-01')
  await mkPallet('B-OLD',   matB.id, '2026-01-01', '2027-06-01')
  await mkPallet('B-SHORT', matB.id, '2026-06-01', '2026-12-01')

  const [gdo] = await restWrite('GroupDeliveryOrder', 'POST', null, {
    id: randomUUID(), group_code: `${TAG}-GDO`, warehouse_id: whId, warehouse_type: `${catA}+${catB}`,
    delivery_date: FIX.EXEC_DATE, planned_date: FIX.EXEC_DATE, status: 'IN_PROGRESS',
    license_plate: 'QAWHTYPEXE', started_at: nowIso(), created_at: nowIso(), updated_at: nowIso(),
  })
  created.gdo = gdo.id
  const [dlv] = await restWrite('OutboundDelivery', 'POST', null, {
    id: randomUUID(), gdo_id: gdo.id, delivery_code: `${TAG}-DO`, distributor_name: TAG,
    created_at: nowIso(), updated_at: nowIso(),
  })
  created.do = dlv.id
  const mkItem = async (mat) => {
    const [row] = await restWrite('OutboundItem', 'POST', null, {
      id: randomUUID(), do_id: dlv.id, material_id: mat.id, material_code_raw: mat.material_code ?? mat.code,
      cartons_ordered: 900, cartons_scanned: 0, loose_picking: 0, status: 'PENDING',
      created_at: nowIso(), updated_at: nowIso(),
    })
    created.items.push(row.id)
    return row.id
  }
  const itemA = await mkItem(matA)
  const itemB = await mkItem(matB)
  const checkScan = (itemId, qr) => api(`/wms/outbound/${gdo.id}/items/${itemId}/check-scan`, 'POST', { qr_code: qr })
  const scan = (itemId, body) => api(`/wms/outbound/${gdo.id}/items/${itemId}/scan`, 'POST', body)
  const setWh = (body) => api(`/masterdata/warehouses/${whId}`, 'PUT', body)
  const setCfg = (items) => api(`/masterdata/warehouses/${whId}/type-configs`, 'PUT', { items })
  const allTypes = (extra = []) => {
    const base = cfgBackup.map(r => ({ type_code: r.type_code }))
    return base.map(r => ({ ...r, ...(extra.find(e => e.type_code === r.type_code) ?? {}) }))
  }

  // ── [1] HỒI QUY: kho FEFO + chưa khai override ⇒ CẢ HAI loại đều theo FEFO ──
  await setWh({ rotation_principle: 'FEFO', rotation_required: false })
  await setCfg(allTypes())
  {
    const a = (await checkScan(itemA, `${TAG}-A-OLD`)).j?.data?.rotation
    const b = (await checkScan(itemB, `${TAG}-B-OLD`)).j?.data?.rotation
    check('[1] Chưa khai override: cả 2 loại chạy FEFO của kho (hành vi y hệt trước 21/08)',
      a?.principle === 'FEFO' && a?.violation === true && a?.source === 'WAREHOUSE'
      && b?.principle === 'FEFO' && b?.violation === true && b?.source === 'WAREHOUSE',
      `A=${JSON.stringify(a)} B=${JSON.stringify(b)}`)
  }

  // ── [2] Override cho RIÊNG loại B: FIFO ────────────────────────────────────
  await setCfg(allTypes([{ type_code: catB, rotation_principle: 'FIFO' }]))
  {
    const a = (await checkScan(itemA, `${TAG}-A-OLD`)).j?.data?.rotation
    const b = (await checkScan(itemB, `${TAG}-B-OLD`)).j?.data?.rotation
    check(`[2a] Loại ${catB} khai FIFO ⇒ quét pallet NSX cũ nhất KHÔNG còn vi phạm (override ĂN)`,
      b?.principle === 'FIFO' && b?.violation === false && b?.source === 'TYPE' && b?.date_label === 'NSX',
      JSON.stringify(b))
    check(`[2b] Loại ${catA} KHÔNG bị lây — vẫn FEFO của kho`,
      a?.principle === 'FEFO' && a?.violation === true && a?.source === 'WAREHOUSE',
      JSON.stringify(a))
    const bShort = (await checkScan(itemB, `${TAG}-B-SHORT`)).j?.data?.rotation
    check(`[2c] Loại ${catB}: quét pallet NSX mới thành VI PHẠM theo FIFO (đảo đúng chiều)`,
      bShort?.violation === true && bShort?.best_pallet_code === `${TAG}-B-OLD`, JSON.stringify(bShort))
  }

  // ── [3] "Bắt buộc" theo TỪNG loại: kho bắt buộc, loại B nới lỏng ───────────
  await setWh({ rotation_principle: 'FEFO', rotation_required: true })
  await setCfg(allTypes([{ type_code: catB, rotation_principle: 'FEFO', rotation_required: false }]))
  {
    const rA = await scan(itemA, { qr_code: `${TAG}-A-OLD`, cartons_override: 5, qty_semantics: 'base', leftover_ui: true, leftover_location_id: 'KEEP' })
    check(`[3a] Loại ${catA} theo kho (bắt buộc): quét sai thứ tự thiếu lý do → 422`,
      rA.s === 422, `http=${rA.s} code=${rA.j?.error?.code}`)
    const rB = await scan(itemB, { qr_code: `${TAG}-B-OLD`, cartons_override: 5, qty_semantics: 'base', leftover_ui: true, leftover_location_id: 'KEEP' })
    check(`[3b] Loại ${catB} khai "không bắt buộc": CÙNG kiểu vi phạm nhưng vẫn lưu được (chỉ cảnh báo)`,
      rB.s === 200 || rB.s === 201, `http=${rB.s} ${JSON.stringify(rB.j?.error ?? '')}`)
    const [se] = await restAll('OutboundScanEntry', `select=rotation_violation,rotation_principle&item_id=eq.${itemB}&pallet_code=eq.${TAG}-B-OLD`)
    check('[3c] Vẫn GHI VẾT vi phạm dù không chặn (không im lặng)',
      se?.rotation_violation === true && se?.rotation_principle === 'FEFO', JSON.stringify(se))
  }

  // ── [4] Xoá dòng override ⇒ rơi về mặc định kho ────────────────────────────
  await setCfg(allTypes())
  {
    // Dùng pallet CHƯA quét: B-OLD đã ghi ở [3b] nên quét lại bị chặn "đã quét trong phiếu này"
    // (guard sẵn có của Xuất, không liên quan chiến thuật).
    const r = await checkScan(itemB, `${TAG}-B-SHORT`)
    const b = r.j?.data?.rotation
    check('[4] Bỏ override ⇒ loại đó quay lại đúng mặc định kho (FEFO + bắt buộc)',
      b?.principle === 'FEFO' && b?.required === true && b?.source === 'WAREHOUSE',
      `http=${r.s} err=${JSON.stringify(r.j?.error ?? '')} rot=${JSON.stringify(b)}`)
  }
  await setWh({ rotation_required: false })

  // ── [5] PUT round-trip + validate ─────────────────────────────────────────
  {
    const payload = allTypes([{ type_code: catB, rotation_principle: 'LIFO', putaway_priority: 'SPREAD',
      putaway_date_mix: 'SAME', putaway_max_materials: 2, putaway_block_full: true,
      putaway_same_mat_date_pref: 'SAME_DATE', putaway_fallback: 'EMPTY_FIRST', putaway_enforced: ['FULL'] }])
    const put = await setCfg(payload)
    const got = (put.j?.data ?? []).find(r => r.type_code === catB)
    check('[5a] PUT → GET round-trip giữ nguyên MỌI field chiến thuật',
      put.s === 200 && got?.rotation_principle === 'LIFO' && got?.putaway_priority === 'SPREAD'
      && got?.putaway_date_mix === 'SAME' && Number(got?.putaway_max_materials) === 2
      && got?.putaway_block_full === true && got?.putaway_same_mat_date_pref === 'SAME_DATE'
      && got?.putaway_fallback === 'EMPTY_FIRST' && JSON.stringify(got?.putaway_enforced) === JSON.stringify(['FULL']),
      `http=${put.s} got=${JSON.stringify(got)}`)
    const bad1 = await setCfg([{ type_code: 'KHONG_CO_LOAI_NAY' }])
    check('[5b] type_code ngoài danh mục → 400 (không đẻ dòng mồ côi)',
      bad1.s === 400, `http=${bad1.s} code=${bad1.j?.error?.code}`)
    const bad2 = await setCfg(allTypes([{ type_code: catB, rotation_principle: 'XXX' }]))
    check('[5c] Nguyên tắc luân chuyển bậy → 422', bad2.s === 422, `http=${bad2.s} code=${bad2.j?.error?.code}`)
    const bad3 = await setCfg(allTypes([{ type_code: catB, putaway_fallback: 'XXX' }]))
    check('[5d] Bước 3 (thứ tự vị trí còn lại) bậy → 422', bad3.s === 422, `http=${bad3.s}`)
    const bad4 = await setCfg([...allTypes(), { type_code: catB }])
    check('[5e] Khai TRÙNG một loại → 400', bad4.s === 400, `http=${bad4.s}`)
    // Trả về sạch
    await setCfg(allTypes())
  }

  // ── [6] Thang cất hàng: Bước 2/Bước 3 lưu được ở CẢ HAI tầng ──────────────
  {
    const r = await setWh({ putaway_same_mat_date_pref: 'OLDER_FIRST', putaway_fallback: 'MOST_FREE' })
    const [w] = await restAll('Warehouse', `select=putaway_same_mat_date_pref,putaway_fallback&id=eq.${whId}`)
    check('[6a] Kho lưu được Bước 2 + Bước 3 (thang cất hàng tường minh)',
      (r.s === 200 || r.s === 201) && w?.putaway_same_mat_date_pref === 'OLDER_FIRST' && w?.putaway_fallback === 'MOST_FREE',
      `http=${r.s} ${JSON.stringify(w)}`)
    const bad = await setWh({ putaway_same_mat_date_pref: 'XXX' })
    check('[6b] Bước 2 giá trị bậy → 422 ở cấp kho', bad.s === 422, `http=${bad.s}`)
    await setWh({ putaway_same_mat_date_pref: 'NONE', putaway_fallback: 'BY_CODE' })
  }

  // ── [7] Gợi ý vị trí CẤT vẫn chạy khi loại khai chiến thuật riêng ─────────
  {
    await setCfg(allTypes([{ type_code: catA, putaway_priority: 'SPREAD', putaway_fallback: 'EMPTY_FIRST' }]))
    const r = await api(`/masterdata/locations?warehouse_id=${whId}&material_id=${matA.id}&putaway=1&limit=50`)
    const rows = r.j?.data ?? []
    check('[7] Ô chọn vị trí vẫn trả khối putaway cho mọi dòng khi loại chạy chiến thuật riêng',
      r.s === 200 && rows.length > 0 && rows.every(x => x.putaway && 'blocked' in x.putaway),
      `http=${r.s} n=${rows.length}`)
    await setCfg(allTypes())
  }

  // ── [8] VÒNG ĐỜI: gỡ loại khỏi kho khi CÒN TỒN = "ngừng vận hành" ─────────
  {
    const without = cfgBackup.filter(r => r.type_code !== catB).map(r => ({ type_code: r.type_code }))
    const del = await setCfg(without)
    check('[8a] Gỡ loại khỏi kho dù còn tồn: CHO PHÉP (kho phase-out một loại không được kẹt)',
      del.s === 200 && !(del.j?.data ?? []).some(r => r.type_code === catB), `http=${del.s}`)
    const b = (await checkScan(itemB, `${TAG}-B-SHORT`)).j?.data?.rotation
    check('[8b] Tồn CŨ của loại đã gỡ vẫn quét xuất được (chặn tạo mới, không chặn xử lý tồn cũ)',
      b?.principle === 'FEFO' && b?.source === 'WAREHOUSE', JSON.stringify(b))
    const rB = await scan(itemB, { qr_code: `${TAG}-B-SHORT`, cartons_override: 5, qty_semantics: 'base', leftover_ui: true, leftover_location_id: 'KEEP' })
    check('[8c] Ghi nhận xuất tồn cũ vẫn 200 (không ngõ cụt)', rB.s === 200 || rB.s === 201, `http=${rB.s}`)
    await setCfg(allTypes())
    const back = (await api(`/masterdata/warehouses/${whId}/type-configs`)).j?.data ?? []
    check('[8d] Thêm lại loại ⇒ trở lại như cũ (chuỗi CÓ→GỠ→CÓ LẠI)',
      back.some(r => r.type_code === catB) && back.length === cfgBackup.length, `n=${back.length}/${cfgBackup.length}`)
  }

  // ── [9] Xoá Loại kho khỏi DANH MỤC khi còn dùng → 409 ─────────────────────
  {
    const [lk] = await restAll('LookupValue', `select=id,value&type=eq.warehouse_type&value=eq.${catB}`)
    const r = await api(`/wms/lookup/${lk.id}`, 'DELETE')
    check('[9a] Xoá loại đang được kho vận hành / chuyến chở lẫn dùng → 409, KHÔNG xoá',
      r.s === 409, `http=${r.s} msg=${String(r.j?.error?.message ?? '').slice(0, 120)}`)
    // Phải kể ĐÍCH DANH bảng gán mới: thiếu = xoá loại xong tập gán + chiến thuật riêng mồ côi âm thầm
    check('[9b] 409 đếm CẢ "kho đang vận hành loại này" (bảng gán 21/08 vào guard xoá)',
      String(r.j?.error?.message ?? '').includes('kho đang vận hành loại này'),
      String(r.j?.error?.message ?? '').slice(0, 220))
    const [still] = await restAll('LookupValue', `select=id&id=eq.${lk.id}`)
    check('[9c] Loại vẫn còn nguyên trong danh mục', !!still)
  }

  // ── [10] THỨ TỰ LOẠI KHO LÀ CỦA TỪNG KHO (user chốt 21/08 chiều) ──────────
  // Trước đây thứ tự chỉ nằm ở danh mục dùng chung ⇒ kéo ở kho A thì kho B cũng đổi theo.
  {
    const otherWh = FIX.WH_QTY.id
    const codesOf = j => (j?.data ?? []).map(r => r.type_code)
    const before = await api(`/masterdata/warehouses/${whId}/type-configs`)
    const otherBefore = await api(`/masterdata/warehouses/${otherWh}/type-configs`)
    const list = before.j?.data ?? []
    if (list.length < 2) {
      check('[10] bỏ qua — kho fixture chỉ vận hành 1 loại', true, `n=${list.length}`)
    } else {
      // Đảo 2 loại đầu, đánh lại thứ tự 1..n
      const swapped = [list[1], list[0], ...list.slice(2)]
      const items = swapped.map((r, i) => ({ ...r, sort_order: i + 1 }))
      const rw = await api(`/masterdata/warehouses/${whId}/type-configs`, 'PUT', { items })
      const after = await api(`/masterdata/warehouses/${whId}/type-configs`)
      check('[10a] Đổi thứ tự loại kho của MỘT kho: lưu + đọc lại đúng thứ tự mới',
        rw.s === 200 && codesOf(after.j).join(',') === swapped.map(r => r.type_code).join(','),
        `http=${rw.s} sau=${codesOf(after.j).join(',')} mong=${swapped.map(r => r.type_code).join(',')}`)
      const otherAfter = await api(`/masterdata/warehouses/${otherWh}/type-configs`)
      check('[10b] Kho KHÁC không bị đổi theo (thứ tự là của TỪNG kho, không phải danh mục chung)',
        codesOf(otherAfter.j).join(',') === codesOf(otherBefore.j).join(','),
        `truoc=${codesOf(otherBefore.j).join(',')} sau=${codesOf(otherAfter.j).join(',')}`)
      // Client cũ (lưu chiến thuật, không gửi sort_order) KHÔNG được xoá trắng công sắp xếp
      const bare = swapped.map(r => {
        const o = { type_code: r.type_code }
        for (const k of STRAT_COLS.split(',')) o[k] = r[k] ?? null
        return o
      })
      await api(`/masterdata/warehouses/${whId}/type-configs`, 'PUT', { items: bare })
      const kept = await api(`/masterdata/warehouses/${whId}/type-configs`)
      check('[10c] Lưu chiến thuật mà không gửi sort_order ⇒ GIỮ NGUYÊN thứ tự đã sắp',
        codesOf(kept.j).join(',') === swapped.map(r => r.type_code).join(','),
        `sau=${codesOf(kept.j).join(',')}`)
      const bad = await api(`/masterdata/warehouses/${whId}/type-configs`, 'PUT',
        { items: swapped.map((r, i) => ({ type_code: r.type_code, sort_order: i === 0 ? 'một' : i + 1 })) })
      check('[10d] sort_order không phải số nguyên → 422 (không ghi rác)', bad.s === 422, `http=${bad.s}`)
      const neg = await api(`/masterdata/warehouses/${whId}/type-configs`, 'PUT',
        { items: swapped.map((r, i) => ({ type_code: r.type_code, sort_order: i === 0 ? -3 : i + 1 })) })
      check('[10e] sort_order âm → 422', neg.s === 422, `http=${neg.s}`)
    }
  }
} catch (e) {
  check('gói chạy trọn', false, String(e?.message ?? e))
} finally {
  await cleanup()
  const [le, ll, lg] = [
    await restAll('InventoryEntry', `select=id&pallet_code=like.${TAG}-*`),
    await restAll('Location', `select=id&location_code=like.${TAG}-*`),
    await restAll('GroupDeliveryOrder', `select=id&group_code=like.${TAG}-*`),
  ]
  check('[dọn] 0 tàn dư', le.length === 0 && ll.length === 0 && lg.length === 0,
    `entry=${le.length} loc=${ll.length} gdo=${lg.length}`)
}

finish('WHTYPE')
