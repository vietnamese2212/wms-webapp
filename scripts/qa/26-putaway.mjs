// GÓI 26 — QUY TẮC CẤT HÀNG (putaway, 15/08). Nửa còn lại của gói 25: rotation gác "lấy pallet
// nào trước", gói này gác "cất pallet vào ô nào".
//
// Lớp lỗi đã ĐO ĐƯỢC ngày 15/08 (luật "bug chết hai lần"):
//   1. Cờ `Location.slot_no_in` ("cấm đưa hàng vào") CHỈ Slotting đọc khi lập kế hoạch — cả 3 màn
//      cất hàng đều không lọc, app vẫn gợi ý công nhân cất vào đúng ô kho đã đánh dấu cấm.
//   2. Luật ★ có 3 BẢN CHÉP TAY (BE sameMaterialLocIds · Inbound.tsx · InboundDetail.tsx), còn
//      màn quét PDA thì KHÔNG hiển thị gì.
//   3. Chặn chỉ ở dropdown là vô nghĩa — gọi thẳng API vẫn cất được.
//   4. RPC `scan_insert_pallet` insert bằng danh sách cột GHI TAY ⇒ 3 cột vết rơi ÂM THẦM
//      (API 200, tsc xanh, "quét thành công" xanh, dữ liệu không tới nơi).
//
// 13 phép kiểm: ★ do BE chấm và đứng đầu · mặc định không chặn ai (giữ hành vi cũ) · used_slots
// khớp đếm độc lập · slot_no_in bị loại khỏi gợi ý · từng cờ chỉ chặn khi kho BẬT · ô đang để dở
// cùng mã không dính luật số-mã · chặn THẬT ở cửa ghi (không chỉ dropdown) · lý do gõ tự do bị từ
// chối · thiếu quyền thì lý do đúng vẫn 403 · vượt rào ghi đủ VẾT · kho chỉ-cảnh-báo vẫn ghi vết ·
// dòng cũ không lọt vào mẫu số % tuân thủ · tắt công tắc thì trở lại hành vi cũ.
// usage: node scripts/qa/26-putaway.mjs
import { login, api, check, finish, restAll, restWrite, restRpc } from './lib.mjs'
import { randomUUID } from 'crypto'

const TAG = 'QA-PUTAWAY'
console.log('── GÓI PUTAWAY (quy tắc cất hàng) ──')
await login()

const nowIso = () => new Date().toISOString()
const vnDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const created = { locs: [], orders: [] }
let whId = null, whBackup = null

// Dọn theo TAG chứ không chỉ theo id đã thu được: lần chạy hỏng giữa chừng (vd đọc sai shape
// response nên không lấy được id) sẽ để lại phiếu MỒ CÔI — đã dính đúng lần đầu chạy gói này,
// sót 2 phiếu OPEN trên staging. Quét theo `notes` là lưới phòng thủ, id chỉ là đường nhanh.
async function sweepByTag() {
  for (const o of await restAll('ProductionImport', `select=id&notes=like.*${TAG}*`)) {
    await restWrite('InventoryEntry', 'DELETE', `import_order_id=eq.${o.id}`)
    await restWrite('ProductionImport', 'DELETE', `id=eq.${o.id}`)
  }
  for (const o of await restAll('Location', `select=id&location_code=like.${TAG}-*`))
    await restWrite('Location', 'DELETE', `id=eq.${o.id}`)
}
async function cleanup() {
  for (const id of created.orders) {
    await restWrite('InventoryEntry', 'DELETE', `import_order_id=eq.${id}`)
    await restWrite('ProductionImport', 'DELETE', `id=eq.${id}`)
  }
  for (const id of created.locs) await restWrite('Location', 'DELETE', `id=eq.${id}`)
  await sweepByTag()
  // Gói QA KHÔNG được để lại kho đang bật "bắt buộc" — cả app sẽ chặn oan.
  // Trả qua API để backend xoá luôn cache cấu hình (ghi thẳng DB thì instance đang chạy vẫn giữ
  // bản "bắt buộc" tới 30s sau khi gói kết thúc).
  if (whId && whBackup) await api(`/masterdata/warehouses/${whId}`, 'PUT', whBackup)
}
// Tàn dư lần chạy trước → dọn TRƯỚC khi dựng fixture (gói phải TỰ HỒI PHỤC)
await sweepByTag()

const PUT_COLS = 'putaway_priority,putaway_required,putaway_max_materials,putaway_date_mix,' +
  'putaway_block_pick_face,putaway_block_qa_hold,putaway_block_full,putaway_single_ncc'

try {
  // ── Fixture: kho QR thật + 1 mã có tồn + 2 vị trí QA (1 sạch, 1 gắn cờ cấm) ────────────
  const anyEntry = (await restAll('InventoryEntry',
    'select=warehouse_id,material_id&limit=1&cartons_remaining=gt.0&status=eq.IN_STOCK'))[0]
  if (!anyEntry) { check('có dữ liệu tồn để dựng fixture', false, 'kho rỗng'); finish('PUTAWAY'); process.exit() }
  whId = anyEntry.warehouse_id
  const [mat] = await restAll('Material', `select=id,material_code,category&id=eq.${anyEntry.material_id}`)
  const [wh]  = await restAll('Warehouse', `select=id,nmsx_code,${PUT_COLS}&id=eq.${whId}`)
  // Trả về qua API nên KHÔNG kèm updated_at (backend tự đặt); giữ đúng 8 cờ như trước khi chạy.
  whBackup = Object.fromEntries(PUT_COLS.split(',').map(k => [k, wh?.[k] ?? null]))
  // ⚠️ Bẫy đã dính 15/08: một script thăm dò chạy hỏng giữa chừng để lại kho ở trạng thái "bắt
  // buộc + 1 mã/ô"; gói này chụp đúng trạng thái BẨN đó làm bản gốc rồi khôi phục y nguyên, và
  // phép kiểm dọn (so với chính bản gốc) vẫn XANH. ⇒ Nói ra ngay từ đầu để người đọc còn phân
  // biệt "kho thật sự cấu hình vậy" với "tàn dư lần chạy trước".
  if (wh?.putaway_required || wh?.putaway_max_materials != null || wh?.putaway_priority !== 'CONSOLIDATE'
      || wh?.putaway_date_mix !== 'ANY' || wh?.putaway_block_pick_face || wh?.putaway_block_qa_hold
      || wh?.putaway_block_full || wh?.putaway_single_ncc) {
    console.log(`  ⚠️  kho test đang có cấu hình cất hàng KHÁC mặc định: ${JSON.stringify(whBackup)}`)
    console.log('      (gói sẽ khôi phục đúng trạng thái này — nếu đây là tàn dư của lần chạy hỏng thì reset trước rồi chạy lại)')
  }

  // Đổi cấu hình QUA API như người dùng thật, KHÔNG ghi thẳng DB: backend cache cấu hình kho 30s
  // cho đường quét (hot-path) và chỉ xoá cache khi lưu qua form. Ghi thẳng PostgREST thì luật vẫn
  // chạy theo bản cũ tới 30s — chính chỗ này từng làm 6 phép kiểm đỏ oan.
  const setRules = (patch) => api(`/masterdata/warehouses/${whId}`, 'PUT', patch)
  const mkLoc = async (code, extra = {}) => {
    const [row] = await restWrite('Location', 'POST', null, {
      id: randomUUID(), location_code: `${TAG}-${code}`, warehouse_id: whId, max_pallets: 20,
      is_active: true, row: 'QA', shelf: '1', sub_code: `${TAG}-${code}`,
      categories: mat.category ? [mat.category] : null, updated_at: nowIso(), created_at: nowIso(), ...extra,
    })
    created.locs.push(row.id)
    return row
  }
  const locOk  = await mkLoc('OK')
  const locNoIn = await mkLoc('NOIN', { slot_no_in: true })
  const locPick = await mkLoc('PICK', { is_pick_face: true })

  // ── 1. Picker: mặc định = hành vi cũ, ★ do BE chấm ───────────────────────────────────
  await setRules({ putaway_priority: 'CONSOLIDATE', putaway_date_mix: 'ANY', putaway_max_materials: null,
    putaway_required: false, putaway_block_pick_face: false, putaway_block_qa_hold: false,
    putaway_block_full: false, putaway_single_ncc: false })

  const pick = async () => (await api(`/masterdata/locations?warehouse_id=${whId}&material_id=${mat.id}&view=lite&limit=200`)).j?.data ?? []
  let rows = await pick()
  const hint = (id) => rows.find(r => r.id === id)?.putaway ?? null
  check('[1] BE trả khối `putaway` trên từng vị trí (FE không tự tính)',
    rows.length > 0 && rows.every(r => r.putaway !== undefined), `${rows.length} vị trí`)
  check('[2] vị trí "cấm đưa hàng vào" bị loại khỏi gợi ý — dù kho chưa bật cờ nào',
    hint(locNoIn.id)?.blocked === 'NO_IN', `${locNoIn.location_code}`)
  check('[3] vị trí thường KHÔNG bị chặn khi kho để mặc định (giữ hành vi cũ)',
    hint(locOk.id)?.blocked === null)
  check('[4] ô bị chặn xuống cuối, ô hợp lệ đứng trên',
    rows.findIndex(r => r.id === locOk.id) < rows.findIndex(r => r.id === locNoIn.id))

  // ── 2. Từng cờ chỉ chặn khi kho BẬT ──────────────────────────────────────────────────
  check('[5] kho CHƯA bật → vị trí nhặt lẻ vẫn cất được', hint(locPick.id)?.blocked === null)
  await setRules({ putaway_block_pick_face: true })
  rows = await pick()
  check('[6] kho BẬT → vị trí nhặt lẻ bị chặn (không chiếm chỗ của lệnh Fill)',
    hint(locPick.id)?.blocked === 'PICK_FACE')
  await setRules({ putaway_block_pick_face: false })

  // ── 3. used_slots khớp đếm độc lập (RPC gom thay 2 vòng quét cũ) ─────────────────────
  rows = await pick()
  const ids = rows.map(r => r.id)
  const facts = await restRpc('putaway_slot_facts', { p_loc_ids: ids, p_material_id: mat.id, p_with_lots: false })
  const byId = new Map((facts ?? []).map(f => [f.location_id, Number(f.pallets)]))
  check('[7] used_slots khớp số RPC trả (không lệch định nghĩa giữa 2 đường)',
    rows.every(r => (r.used_slots ?? 0) === (byId.get(r.id) ?? 0)), `${rows.length} ô`)

  // ── 4. CỬA GHI: chặn thật, không chỉ ở dropdown ──────────────────────────────────────
  const mkOrder = async (locationId, extra = {}) => {
    const r = await api('/wms/inbound-orders', 'POST', {
      warehouse_id: whId, material_id: mat.id, location_id: locationId, import_date: vnDate(),
      source_type: 'FACTORY', warehouse_type: mat.category, notes: `${TAG} test`,
      qty_semantics: 'base', ...extra,
    })
    const id = r.j?.data?.order?.id
    if (id) created.orders.push(id)
    return r
  }
  let r = await mkOrder(locNoIn.id)
  check('[8] kho chỉ CẢNH BÁO → vẫn tạo được vào ô cấm nhưng CÓ cảnh báo trả về',
    r.s === 200 && /không nhận hàng vào/i.test(r.j?.data?.putaway_warning ?? ''),
    `HTTP ${r.s}`)

  await setRules({ putaway_required: true })
  r = await mkOrder(locNoIn.id)
  check('[9] kho BẮT BUỘC → gọi THẲNG API vẫn bị chặn (lọc ở dropdown chỉ là gợi ý)',
    r.s === 422 && r.j?.error?.code === 'PUTAWAY_VIOLATION', `HTTP ${r.s} ${r.j?.error?.code}`)

  r = await mkOrder(locOk.id)
  const orderId = r.j?.data?.order?.id
  check('[10] vị trí hợp lệ vẫn qua khi đang bật bắt buộc', r.s === 200, `HTTP ${r.s}`)

  r = await api(`/wms/inbound-orders/${orderId}/location`, 'PATCH',
    { location_id: locNoIn.id, putaway_override_reason: 'tại vì tôi thích' })
  check('[11] lý do GÕ TỰ DO bị từ chối (chỉ nhận mã trong danh sách cố định)',
    r.s === 422 && r.j?.error?.code === 'PUTAWAY_REASON_REQUIRED', `${r.j?.error?.code}`)

  // ── 5. Quét thật: chặn → vượt rào có lý do → GHI VẾT ─────────────────────────────────
  const d = new Date()
  const ddmmyy = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(2)}`
  let seq = 940
  const mkQR = () => `${ddmmyy}_${mat.material_code}_${TAG.replace(/-/g, '')}_M9_${++seq}_${wh.nmsx_code ?? 'B'}`
  const traceOf = async (code) => (await restAll('InventoryEntry',
    `select=putaway_checked,putaway_violation,putaway_override_reason&pallet_code=eq.${encodeURIComponent(code)}`))[0]

  const qr1 = mkQR()
  r = await api(`/wms/inbound-orders/${orderId}/scan`, 'POST',
    { qr_code: qr1, location_id: locNoIn.id, qty_semantics: 'base' })
  check('[12] QUÉT vào ô cấm khi kho bắt buộc → CHẶN và KHÔNG ghi nửa vời',
    r.s === 422 && r.j?.error?.code === 'PUTAWAY_VIOLATION' && !(await traceOf(qr1)),
    `HTTP ${r.s}`)

  r = await api(`/wms/inbound-orders/${orderId}/check-scan`, 'POST',
    { qr_code: qr1, location_id: locNoIn.id, qty_semantics: 'base' })
  check('[13] check-scan BÁO TRƯỚC (required + mã luật) mà không chặn',
    r.j?.data?.putaway?.required === true && r.j?.data?.putaway?.violation === 'NO_IN')

  r = await api(`/wms/inbound-orders/${orderId}/scan`, 'POST',
    { qr_code: qr1, location_id: locNoIn.id, putaway_override_reason: 'NO_SPACE', qty_semantics: 'base' })
  const t1 = await traceOf(qr1)
  check('[14] vượt rào có lý do hợp lệ → qua VÀ ghi đủ 3 cột vết',
    r.s === 200 && t1?.putaway_checked === true && t1?.putaway_violation === 'NO_IN'
      && t1?.putaway_override_reason === 'NO_SPACE',
    `checked=${t1?.putaway_checked} viol=${t1?.putaway_violation} reason=${t1?.putaway_override_reason}`)

  const qr2 = mkQR()
  r = await api(`/wms/inbound-orders/${orderId}/scan`, 'POST',
    { qr_code: qr2, location_id: locOk.id, qty_semantics: 'base' })
  const t2 = await traceOf(qr2)
  check('[15] ô hợp lệ: checked=true + violation NULL (vào mẫu số, không tính vi phạm)',
    r.s === 200 && t2?.putaway_checked === true && t2?.putaway_violation === null,
    `checked=${t2?.putaway_checked}`)

  await setRules({ putaway_required: false })
  const qr3 = mkQR()
  r = await api(`/wms/inbound-orders/${orderId}/scan`, 'POST',
    { qr_code: qr3, location_id: locNoIn.id, qty_semantics: 'base' })
  const t3 = await traceOf(qr3)
  check('[16] kho chỉ cảnh báo: quét qua được NHƯNG vẫn ghi vết + trả cảnh báo',
    r.s === 200 && t3?.putaway_violation === 'NO_IN'
      && (r.j?.data?.warnings ?? []).some(w => /không nhận hàng vào/i.test(w)),
    `viol=${t3?.putaway_violation}`)

  const mine = await restAll('InventoryEntry',
    `select=putaway_checked,putaway_violation&import_order_id=eq.${orderId}`)
  check('[17] % tuân thủ đo được: 3 lượt có mẫu số, 2 vi phạm',
    mine.filter(x => x.putaway_checked).length === 3
      && mine.filter(x => x.putaway_checked && x.putaway_violation).length === 2,
    `mẫu số ${mine.filter(x => x.putaway_checked).length} · vi phạm ${mine.filter(x => x.putaway_checked && x.putaway_violation).length}`)

  // ── 5b. LUẬT TRỘN DATE — luật user nêu đích danh, chỉ kết luận được ở cửa quét ──────
  // Phát biểu theo THỨ TỰ LẤY nên đúng cho cả FEFO (so HSD) lẫn FIFO/LIFO (so NSX):
  // OLDER_ONLY = ô chỉ được chứa hàng PHẢI LẤY TRƯỚC pallet mới ⇒ pallet mới không chôn ai.
  {
    const locD = await mkLoc('DATE')
    const qrDate = (daysAgo, seq) => {
      const dt = new Date(Date.now() - daysAgo * 86400000)
      const s = `${String(dt.getDate()).padStart(2, '0')}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getFullYear()).slice(2)}`
      return `${s}_${mat.material_code}_${TAG.replace(/-/g, '')}_M9_${seq}_${wh.nmsx_code ?? 'B'}`
    }
    const oD = (await mkOrder(locD.id)).j?.data?.order?.id
    await setRules({ putaway_date_mix: 'ANY', putaway_required: false })
    await api(`/wms/inbound-orders/${oD}/scan`, 'POST', { qr_code: qrDate(30, 970), location_id: locD.id, qty_semantics: 'base' })

    await setRules({ putaway_date_mix: 'OLDER_ONLY', putaway_required: true })
    const rNew = await api(`/wms/inbound-orders/${oD}/scan`, 'POST', { qr_code: qrDate(5, 971), location_id: locD.id, qty_semantics: 'base' })
    const rOld = await api(`/wms/inbound-orders/${oD}/scan`, 'POST', { qr_code: qrDate(60, 972), location_id: locD.id, qty_semantics: 'base' })
    check('[19] trộn date OLDER_ONLY: pallet MỚI hơn cho qua, pallet CŨ hơn bị chặn (không chôn hàng phải lấy trước)',
      rNew.s === 200 && rOld.s === 422 && rOld.j?.error?.code === 'PUTAWAY_VIOLATION',
      `mới=${rNew.s} · cũ=${rOld.s} ${rOld.j?.error?.code ?? ''}`)
    check('[20] thông báo giữ nguyên chữ viết tắt HSD/NSX (không lowercase cả câu)',
      /HSD|NSX/.test(rOld.j?.error?.message ?? ''), (rOld.j?.error?.message ?? '').slice(0, 70))

    const rOv = await api(`/wms/inbound-orders/${oD}/scan`, 'POST',
      { qr_code: qrDate(60, 973), location_id: locD.id, putaway_override_reason: 'URGENT', qty_semantics: 'base' })
    const tD = (await restAll('InventoryEntry',
      `select=putaway_violation,putaway_override_reason&pallet_code=eq.${encodeURIComponent(qrDate(60, 973))}`))[0]
    check('[21] vượt rào luật date → qua + ghi vết đúng mã DATE_MIX',
      rOv.s === 200 && tD?.putaway_violation === 'DATE_MIX' && tD?.putaway_override_reason === 'URGENT',
      `viol=${tD?.putaway_violation} reason=${tD?.putaway_override_reason}`)
    await setRules({ putaway_date_mix: 'ANY', putaway_required: false })
  }

  // ── 6. ĐUA: luật "tối đa N mã/ô" phải chốt DƯỚI ROW-LOCK ───────────────────────────
  // Đo 15/08 trước khi sửa: 6 lượt quét đồng thời 6 mã khác nhau vào ô trống giới hạn 1 mã →
  // LỌT 3 MÃ (backend đọc-rồi-ghi, nhiều lượt cùng đọc "ô đang có 0 mã"). Nay đếm trong RPC.
  // Chỉ lấy mã CÓ khai thùng/pallet: mã chưa khai → nhập 0 thùng → tồn 0 → theo luật app KHÔNG
  // tính chiếm chỗ, đưa vào phép đo sẽ nhiễu.
  // `restAll` tự phân trang nên `limit=` trong filter KHÔNG có tác dụng → cắt bằng JS cho tiền định
  const raceMats = (await restAll('Material',
    `select=id,material_code&category=eq.${encodeURIComponent(mat.category)}&no_qr_tracking=not.is.true&cartons_per_pallet=gt.0`)).slice(0, 6)
  if (raceMats.length >= 3) {
    const locRace = await mkLoc('RACE')
    await setRules({ putaway_max_materials: 1, putaway_required: true })
    const raceOrders = []
    for (const m of raceMats) {
      const rr = await mkOrder(locRace.id, { material_id: m.id })
      if (rr.j?.data?.order?.id) raceOrders.push({ oid: rr.j.data.order.id, m })
    }
    const raceRes = await Promise.all(raceOrders.map(({ oid, m }, i) =>
      api(`/wms/inbound-orders/${oid}/scan`, 'POST',
        { qr_code: `${ddmmyy}_${m.material_code}_${TAG.replace(/-/g, '')}_M9_${960 + i}_${wh.nmsx_code ?? 'B'}`,
          location_id: locRace.id, qty_semantics: 'base' })))
    const inSlot = await restAll('InventoryEntry',
      `select=material_id&location_id=eq.${locRace.id}&stack_layer=eq.1&status=in.(IN_STOCK,PARTIAL)&cartons_remaining=gt.0`)
    const distinct = new Set(inSlot.map(x => x.material_id)).size
    check('[18] ĐUA nhiều mã vào 1 ô giới hạn 1 mã → vẫn chỉ 1 mã chiếm chỗ (đếm dưới row-lock)',
      distinct <= 1, `${raceOrders.length} lượt đồng thời · ${raceRes.filter(x => x.s === 200).length} HTTP 200 · ${distinct} mã chiếm chỗ`)
    await setRules({ putaway_max_materials: null, putaway_required: false })
  } else check('[18] ĐUA tối đa N mã/ô', true, 'bỏ qua — không đủ 3 mã có khai thùng/pallet')

} catch (e) {
  check('gói chạy trọn', false, e?.message ?? String(e))
} finally {
  await cleanup()
  const left = await restAll('Location', `select=id&location_code=like.${TAG}-*`)
  const leftPo = await restAll('ProductionImport', `select=id&notes=like.*${TAG}*`)
  const [whNow] = await restAll('Warehouse', `select=putaway_required&id=eq.${whId}`)
  check('[dọn] không còn fixture sót (kể cả phiếu mồ côi) + kho trả về nguyên trạng',
    left.length === 0 && leftPo.length === 0 && whNow?.putaway_required === (whBackup?.putaway_required ?? false),
    `vị trí ${left.length} · phiếu ${leftPo.length}`)
  finish('PUTAWAY')
}
