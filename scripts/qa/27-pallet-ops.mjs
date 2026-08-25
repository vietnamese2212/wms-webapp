// GÓI 27 — DỒN / TÁCH / GỠ NHÓM PALLET (19/08). Lấp lỗ kiểm pre-go-live: pallet-ops đụng TRỰC TIẾP
// tồn kho (INSERT dòng mới + trừ nguồn bằng CAS) mà trước gói này KHÔNG có phép kiểm máy nào canh —
// mọi lần kiểm trước đều là test tay.
//
// Bất biến cốt tử của module: TÁCH/DỒN KHÔNG ĐƯỢC LÀM ĐỔI TỔNG TỒN (Σ cartons_remaining của nguồn
// + các con = số ban đầu, ở MỌI thời điểm, kể cả khi 2 người tách cùng lúc hay khi hoàn tác).
//
// 14 phép kiểm: dồn ghi parent+dời vị trí con · đích-là-con bị chặn · gỡ nhóm · hoàn tác MERGE khôi
// phục parent + chặn hoàn tác lần 2 · tách V1 đặt `.N` vào ĐOẠN SEQ (đoạn 5) + bảo toàn tổng ·
// thiếu qty_semantics → 409 APP_OUTDATED · hoàn tác SPLIT xóa con + trả đủ nguồn · reserved chặn
// tách (khả dụng = remaining − reserved) · ĐUA 2 người tách 60+60 từ 100 → đúng 1 người thắng +
// tổng vẫn 100 · tách V2 đặt `.N` vào ĐUÔI MÃ LÔ (đoạn 3) + cột batch DB giữ mã lô GỐC ·
// mã trùng 2 kho không khai kho → 400, khai kho → chạy.
// usage: node scripts/qa/27-pallet-ops.mjs
import { login, api, check, finish, restAll, restWrite, resolveFixtures, FIX } from './lib.mjs'
import { randomUUID } from 'crypto'

const TAG = 'QAPOPS'
console.log('── GÓI PALLET-OPS (dồn/tách/gỡ nhóm) ──')
await login()
await resolveFixtures()

const nowIso = () => new Date().toISOString()
const vnDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const created = { locs: [], entries: [] }
const allCodes = []

// Mã V1: đoạn 3 (chu kỳ) mang TAG để nhận diện/dọn; đoạn 5 = seq (nơi split gắn .N)
const v1 = (seq) => `190826_${FIX.MAT_POOL}_${TAG}_M1_${seq}_B`
// Mã V2: mã lô (đoạn 3) mang TAG; 7 đoạn, QA + giờ đệm space như tem nhà máy
const v2 = (lot) => `${FIX.MAT_POOL};      1;${TAG}${lot};19/08/2026;19/02/2027;      1;05:26`

async function cleanup() {
  // PalletOperation log của gói (lọc theo overlap mảng mã) — dọn để lịch sử thao tác không rác
  if (allCodes.length) {
    const list = `{${allCodes.map(c => `"${c}"`).join(',')}}`
    await restWrite('PalletOperation', 'DELETE', `source_codes=ov.${encodeURIComponent(list)}`).catch(() => {})
    await restWrite('PalletOperation', 'DELETE', `target_codes=ov.${encodeURIComponent(list)}`).catch(() => {})
  }
  // Entry: quét theo TAG trong mã (bắt luôn pallet CON do API tạo mà gói không track được id)
  await restWrite('InventoryEntry', 'DELETE', `pallet_code=like.*${TAG}*`).catch(() => {})
  for (const id of created.locs) await restWrite('Location', 'DELETE', `id=eq.${id}`).catch(() => {})
}
// Tàn dư lần chạy hỏng giữa chừng → dọn trước (fixture tự hồi phục)
await restWrite('InventoryEntry', 'DELETE', `pallet_code=like.*${TAG}*`).catch(() => {})
for (const o of await restAll('Location', `select=id&location_code=like.${TAG}-*`))
  await restWrite('Location', 'DELETE', `id=eq.${o.id}`)

try {
  // ── Fixture: 1 vị trí SIM ở kho QR + các pallet V1/V2 ─────────────────────
  const mkLoc = async (whId, code, extra = {}) => {
    const [row] = await restWrite('Location', 'POST', null, {
      id: randomUUID(), location_code: `${TAG}-${code}`, warehouse_id: whId, max_pallets: 30,
      is_active: true, row: 'QA', shelf: '1', sub_code: `${TAG}-${code}`,
      created_at: nowIso(), updated_at: nowIso(), ...extra,
    })
    created.locs.push(row.id)
    return row.id
  }
  const mkPallet = async (code, qty, whId, locId, extra = {}) => {
    const [row] = await restWrite('InventoryEntry', 'POST', null, {
      id: randomUUID(), pallet_code: code, material_id: FIX.MAT_POOL_ID, warehouse_id: whId,
      location_id: locId, cartons_imported: qty, cartons_remaining: qty, cartons_reserved: 0,
      status: 'IN_STOCK', production_date: '2026-06-01', import_date: vnDate(),
      created_at: nowIso(), updated_at: nowIso(), ...extra,
    })
    created.entries.push(row.id)
    allCodes.push(code)
    return row.id
  }
  const entryOf = async (code, whId = FIX.WH_QR.id) => (await restAll('InventoryEntry',
    `select=id,pallet_code,parent_pallet_code,location_id,cartons_imported,cartons_remaining,cartons_reserved,status,batch,origin&pallet_code=eq.${encodeURIComponent(code)}&warehouse_id=eq.${whId}`))[0]
  // Tổng tồn của "gia đình" 1 pallet nguồn (nguồn + mọi con .N) — bất biến bảo toàn
  const familySum = async (prefixLike) => {
    const rows = await restAll('InventoryEntry',
      `select=cartons_remaining&pallet_code=like.${encodeURIComponent(prefixLike)}&warehouse_id=eq.${FIX.WH_QR.id}`)
    return rows.reduce((s, r) => s + Number(r.cartons_remaining), 0)
  }

  const locA = await mkLoc(FIX.WH_QR.id, 'A')
  const locB = await mkLoc(FIX.WH_QR.id, 'B')
  const P1 = v1('901'), P2 = v1('902'), P3 = v1('903')
  await mkPallet(P1, 100, FIX.WH_QR.id, locA)
  await mkPallet(P2, 50, FIX.WH_QR.id, locB)
  await mkPallet(P3, 30, FIX.WH_QR.id, locB)

  // ── [1] DỒN: con nhận parent + DỜI về vị trí đích ──────────────────────────
  {
    const r = await api('/wms/pallet-ops/merge', 'POST', {
      target_pallet_code: P1, child_pallet_codes: [P2, P3], warehouse_id: FIX.WH_QR.id,
    })
    const [e2, e3] = [await entryOf(P2), await entryOf(P3)]
    check('[1] Dồn 2 pallet: parent ghi đúng + con DỜI về vị trí pallet đích',
      r.s === 200 && r.j?.data?.merged === 2
      && e2?.parent_pallet_code === P1 && e3?.parent_pallet_code === P1
      && e2?.location_id === locA && e3?.location_id === locA,
      `http=${r.s} merged=${r.j?.data?.merged} p2=${e2?.parent_pallet_code}@${e2?.location_id === locA ? 'A' : '?'}`)
  }

  // ── [2] Đích đang là CON của nhóm khác → chặn ─────────────────────────────
  {
    const r = await api('/wms/pallet-ops/merge', 'POST', {
      target_pallet_code: P2, child_pallet_codes: [P3], warehouse_id: FIX.WH_QR.id,
    })
    check('[2] Dồn vào pallet đang là con → 400 (phải chọn pallet đầu nhóm)',
      r.s === 400, `http=${r.s} msg=${r.j?.error?.message}`)
  }

  // Tra op id trực tiếp từ bảng log (đừng qua GET search — V1 code chứa `_` làm ilike lệch)
  const findOp = async (type, code) => (await restAll('PalletOperation',
    `select=id,type,undone_at&type=eq.${type}&undone_at=is.null&target_codes=cs.{${encodeURIComponent(code)}}&order=created_at.desc&limit=1`))[0]
    ?? (await restAll('PalletOperation',
      `select=id,type,undone_at&type=eq.${type}&undone_at=is.null&source_codes=cs.{${encodeURIComponent(code)}}&order=created_at.desc&limit=1`))[0]

  // ── [3] HOÀN TÁC MERGE: khôi phục parent + vị trí; hoàn tác lần 2 bị chặn ──
  {
    const mergeOp = await findOp('MERGE', P1)
    const u = await api(`/wms/pallet-ops/${mergeOp?.id}/undo`, 'POST')
    const [e2, e3] = [await entryOf(P2), await entryOf(P3)]
    check('[3] Hoàn tác DỒN: con về lại parent=null + vị trí cũ',
      u.s === 200 && !e2?.parent_pallet_code && !e3?.parent_pallet_code
      && e2?.location_id === locB && e3?.location_id === locB,
      `http=${u.s} p2loc=${e2?.location_id === locB ? 'B' : '?'}`)
    const u2 = await api(`/wms/pallet-ops/${mergeOp?.id}/undo`, 'POST')
    check('[3b] Hoàn tác LẦN 2 cùng thao tác → 400 (không nhân đôi việc khôi phục)',
      u2.s === 400, `http=${u2.s}`)
  }

  // ── [4] TÁCH V1: `.N` vào đoạn SEQ + bảo toàn tổng ────────────────────────
  {
    const r = await api('/wms/pallet-ops/split', 'POST', {
      source_pallet_code: P1, children: [{ qty: 30 }], warehouse_id: FIX.WH_QR.id,
    })
    const childCode = r.j?.data?.children?.[0]?.pallet_code
    if (childCode) allCodes.push(childCode)
    const sum = await familySum(`190826_${FIX.MAT_POOL}_${TAG}_M1_901*`)
    check('[4] Tách V1 30/100: mã con = đoạn seq "901.1" + nguồn còn 70 + TỔNG GIA ĐÌNH vẫn 100',
      r.s === 200 && childCode === `190826_${FIX.MAT_POOL}_${TAG}_M1_901.1_B`
      && Number(r.j?.data?.source_remaining) === 70 && sum === 100,
      `http=${r.s} child=${childCode} remain=${r.j?.data?.source_remaining} sum=${sum}`)
  }

  // ── [5] Thiếu qty_semantics → 409 APP_OUTDATED (chặn bundle cũ) ────────────
  {
    // api() tự gắn qty_semantics — gọi fetch trần qua api() với body mảng? Không: gửi cờ SAI giá trị
    const r = await api('/wms/pallet-ops/split', 'POST', {
      qty_semantics: 'carton', source_pallet_code: P1, children: [{ qty: 5 }], warehouse_id: FIX.WH_QR.id,
    })
    check('[5] qty_semantics ≠ base → 409 APP_OUTDATED (không ghi gì)',
      r.s === 409, `http=${r.s} code=${r.j?.error?.code}`)
  }

  // ── [6] HOÀN TÁC SPLIT: xóa con + trả đủ nguồn về 100 ─────────────────────
  {
    const splitOp = await findOp('SPLIT', P1)
    const u = await api(`/wms/pallet-ops/${splitOp?.id}/undo`, 'POST')
    const src = await entryOf(P1)
    const child = await entryOf(`190826_${FIX.MAT_POOL}_${TAG}_M1_901.1_B`)
    check('[6] Hoàn tác TÁCH: pallet con biến mất + nguồn về đủ 100 + status IN_STOCK',
      u.s === 200 && !child && Number(src?.cartons_remaining) === 100 && src?.status === 'IN_STOCK',
      `http=${u.s} remain=${src?.cartons_remaining} child=${child ? 'CÒN' : 'đã xóa'}`)
  }

  // ── [7] RESERVED chặn tách: khả dụng = remaining − reserved ────────────────
  {
    const src = await entryOf(P1)
    await restWrite('InventoryEntry', 'PATCH', `id=eq.${src.id}`, { cartons_reserved: 80, updated_at: nowIso() })
    const r = await api('/wms/pallet-ops/split', 'POST', {
      source_pallet_code: P1, children: [{ qty: 30 }], warehouse_id: FIX.WH_QR.id,
    })
    await restWrite('InventoryEntry', 'PATCH', `id=eq.${src.id}`, { cartons_reserved: 0, updated_at: nowIso() })
    check('[7] Đang giữ chỗ 80/100 → tách 30 bị chặn (khả dụng chỉ 20 — không cắn vào hàng đã soạn)',
      r.s === 400 && (await familySum(`190826_${FIX.MAT_POOL}_${TAG}_M1_901*`)) === 100,
      `http=${r.s} msg=${(r.j?.error?.message ?? '').slice(0, 60)}`)
  }

  // ── [8] ĐUA: 2 người cùng tách 60 từ 100 → đúng 1 thắng, tổng vẫn 100 ──────
  {
    const [ra, rb] = await Promise.all([
      api('/wms/pallet-ops/split', 'POST', { source_pallet_code: P1, children: [{ qty: 60 }], warehouse_id: FIX.WH_QR.id }),
      api('/wms/pallet-ops/split', 'POST', { source_pallet_code: P1, children: [{ qty: 60 }], warehouse_id: FIX.WH_QR.id }),
    ])
    for (const r of [ra, rb]) for (const c of r.j?.data?.children ?? []) allCodes.push(c.pallet_code)
    const wins = [ra, rb].filter(r => r.s === 200).length
    const loserOk = [ra, rb].every(r => [200, 400, 409].includes(r.s))   // 500 = bug đua đặt tên (23505 thô)
    const sum = await familySum(`190826_${FIX.MAT_POOL}_${TAG}_M1_901*`)
    check('[8] Đua 60+60/100: đúng 1 người thắng, người thua nhận 400/409 SẠCH (không 500) + tổng vẫn 100',
      wins === 1 && loserOk && sum === 100, `wins=${wins} http=[${ra.s},${rb.s}] sum=${sum}`)
  }

  // ── [9] TÁCH V2: `.N` vào ĐUÔI MÃ LÔ (đoạn 3), cột batch giữ mã lô GỐC ─────
  {
    const V2SRC = v2('260819A01')
    await mkPallet(V2SRC, 40, FIX.WH_QR.id, locA, { batch: `${TAG}260819A01`, expiry_date: '2027-02-19' })
    const r = await api('/wms/pallet-ops/split', 'POST', {
      source_pallet_code: V2SRC, children: [{ qty: 10 }], warehouse_id: FIX.WH_QR.id,
    })
    const childCode = r.j?.data?.children?.[0]?.pallet_code
    if (childCode) allCodes.push(childCode)
    const child = childCode ? await entryOf(childCode) : null
    check('[9] Tách V2: `.1` gắn vào đuôi MÃ LÔ (đoạn 3, KHÔNG phải cuối chuỗi) + cột batch giữ mã lô gốc',
      r.s === 200 && childCode === v2('260819A01.1')
      && child?.batch === `${TAG}260819A01` && Number(r.j?.data?.source_remaining) === 30,
      `http=${r.s} child=${childCode} batch=${child?.batch}`)
  }

  // ── [10] Mã trùng 2 KHO: không khai kho → 400; khai kho → chạy ─────────────
  {
    const DUP = v1('904')
    await mkPallet(DUP, 20, FIX.WH_QR.id, locA)
    const [qtyLoc] = await restAll('Location', `select=id&warehouse_id=eq.${FIX.WH_QTY.id}&is_active=is.true&limit=1`)
    await mkPallet(DUP, 20, FIX.WH_QTY.id, qtyLoc?.id ?? null)
    const r1 = await api('/wms/pallet-ops/split', 'POST', { source_pallet_code: DUP, children: [{ qty: 5 }] })
    const r2 = await api('/wms/pallet-ops/split', 'POST', { source_pallet_code: DUP, children: [{ qty: 5 }], warehouse_id: FIX.WH_QR.id })
    for (const c of r2.j?.data?.children ?? []) allCodes.push(c.pallet_code)
    check('[10] Mã có ở 2 kho: thiếu warehouse_id → 400 bắt chọn kho; khai kho → tách đúng kho đó',
      r1.s === 400 && r2.s === 200
      && Number((await entryOf(DUP, FIX.WH_QR.id))?.cartons_remaining) === 15
      && Number((await entryOf(DUP, FIX.WH_QTY.id))?.cartons_remaining) === 20,
      `noWh=${r1.s} wh=${r2.s}`)
  }

  // ── [11] GỠ NHÓM: dồn lại rồi ungroup → parent sạch ───────────────────────
  {
    await api('/wms/pallet-ops/merge', 'POST', { target_pallet_code: P1, child_pallet_codes: [P2], warehouse_id: FIX.WH_QR.id })
    const r = await api('/wms/pallet-ops/ungroup', 'POST', { pallet_codes: [P2], warehouse_id: FIX.WH_QR.id })
    const e2 = await entryOf(P2)
    check('[11] Gỡ nhóm: ungrouped=1 + parent về null',
      r.s === 200 && r.j?.data?.ungrouped === 1 && !e2?.parent_pallet_code,
      `http=${r.s} n=${r.j?.data?.ungrouped}`)
  }
  // ── [12] LUẬT CẤT BẮT BUỘC áp cho Dồn/Tách (bịt lỗ 25/08) ─────────────────
  // Trước fix: tách đặt con vào Ô BẤT KỲ + dồn kéo con về ô đích mà KHÔNG qua luật cất, không
  // kiểm cùng kho, không sức chứa — kho bật "bắt buộc" vẫn bị lách qua 2 cửa này. Đích do người
  // chọn = một lần CẤT HÀNG; giữ chỗ pallet nguồn thì miễn (hàng không di chuyển).
  {
    const [whRow] = await restAll('Warehouse', `select=putaway_enforced&id=eq.${FIX.WH_QR.id}`)
    const putBackup = whRow?.putaway_enforced ?? []
    const setPut = (enforced) => api(`/masterdata/warehouses/${FIX.WH_QR.id}`, 'PUT', { putaway_enforced: enforced })
    const waitCfg = () => new Promise(r => setTimeout(r, 31_000))   // cache cấu hình 30s/instance
    const locNoIn = await mkLoc(FIX.WH_QR.id, 'NOIN', { slot_no_in: true })
    const locCap  = await mkLoc(FIX.WH_QR.id, 'CAP1', { max_pallets: 1 })
    const SRC3 = v1('905'); await mkPallet(SRC3, 100, FIX.WH_QR.id, locA)
    const OCC  = v1('906'); await mkPallet(OCC, 10, FIX.WH_QR.id, locCap)
    try {
      await setPut(['NO_IN']); await waitCfg()
      const a = await api('/wms/pallet-ops/split', 'POST', { source_pallet_code: SRC3, children: [{ qty: 10 }], warehouse_id: FIX.WH_QR.id, location_id: locNoIn })
      check('[12a] Kho BẮT BUỘC NO_IN: tách sang ô cấm → 422 PUTAWAY_VIOLATION, không sinh con, nguồn nguyên 100',
        a.s === 422 && a.j?.error?.code === 'PUTAWAY_VIOLATION'
        && Number((await entryOf(SRC3))?.cartons_remaining) === 100,
        `http=${a.s} code=${a.j?.error?.code}`)
      const b = await api('/wms/pallet-ops/split', 'POST', { source_pallet_code: SRC3, children: [{ qty: 10 }], warehouse_id: FIX.WH_QR.id })
      for (const c of b.j?.data?.children ?? []) allCodes.push(c.pallet_code)
      check('[12b] Giữ chỗ pallet nguồn (không truyền vị trí) → tách vẫn chạy, không ngõ cụt', b.s === 200, `http=${b.s}`)
      const TGN = v1('907'); await mkPallet(TGN, 10, FIX.WH_QR.id, locNoIn)
      const KID = v1('908'); await mkPallet(KID, 10, FIX.WH_QR.id, locA)
      const cM = await api('/wms/pallet-ops/merge', 'POST', { target_pallet_code: TGN, child_pallet_codes: [KID], warehouse_id: FIX.WH_QR.id })
      check('[12c] Dồn về pallet đích đang đứng trong ô cấm → 422, pallet con đứng yên',
        cM.s === 422 && cM.j?.error?.code === 'PUTAWAY_VIOLATION' && (await entryOf(KID))?.location_id === locA,
        `http=${cM.s} code=${cM.j?.error?.code}`)
      await setPut([]); await waitCfg()
      const dM = await api('/wms/pallet-ops/merge', 'POST', { target_pallet_code: TGN, child_pallet_codes: [KID], warehouse_id: FIX.WH_QR.id })
      check('[12d] Mức CẢNH BÁO: dồn chạy + response nói ra vi phạm (putaway_warning, không im lặng)',
        dM.s === 200 && /không đưa hàng vào/i.test(dM.j?.data?.putaway_warning ?? ''),
        `http=${dM.s} warn=${dM.j?.data?.putaway_warning ?? 'KHÔNG'}`)
      // Kho QTY không có vị trí sẵn (pool không vị trí) → tự tạo 1 ô ở kho khác để thử guard cùng-kho
      const locOtherWh = await mkLoc(FIX.WH_QTY.id, 'XWH')
      const eS = await api('/wms/pallet-ops/split', 'POST', { source_pallet_code: SRC3, children: [{ qty: 5 }], warehouse_id: FIX.WH_QR.id, location_id: locOtherWh })
      check('[12e] Tách sang vị trí của KHO KHÁC → 400 (trước fix: pallet con "dịch chuyển" sang kho khác)',
        eS.s === 400, `http=${eS.s}`)
      const fS = await api('/wms/pallet-ops/split', 'POST', { source_pallet_code: SRC3, children: [{ qty: 5 }], warehouse_id: FIX.WH_QR.id, location_id: locCap })
      check('[12f] Ô đã kín chỗ → tách vào đó 400 LOCATION_FULL (trước fix: vượt sức chứa âm thầm)',
        fS.s === 400 && fS.j?.error?.code === 'LOCATION_FULL', `http=${fS.s} code=${fS.j?.error?.code}`)
    } finally {
      await api(`/masterdata/warehouses/${FIX.WH_QR.id}`, 'PUT', { putaway_enforced: putBackup })
    }
  }
} catch (e) {
  check('gói chạy không nổ', false, String(e))
} finally {
  await cleanup()
  // Verify dọn 0 sót
  const left = await restAll('InventoryEntry', `select=id&pallet_code=like.*${TAG}*`)
  check('[dọn] 0 tàn dư InventoryEntry sau cleanup', left.length === 0, `còn ${left.length}`)
}

finish('PALLET-OPS')
