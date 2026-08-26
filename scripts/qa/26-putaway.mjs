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
// 34 phép kiểm: ★ do BE chấm và đứng đầu · mặc định không chặn ai (giữ hành vi cũ) · used_slots
// khớp đếm độc lập · slot_no_in bị loại khỏi gợi ý · từng cờ chỉ chặn khi kho BẬT · ô đang để dở
// cùng mã không dính luật số-mã · chặn THẬT ở cửa ghi (không chỉ dropdown) · lý do gõ tự do bị từ
// chối · thiếu quyền thì lý do đúng vẫn 403 · vượt rào ghi đủ VẾT · kho chỉ-cảnh-báo vẫn ghi vết ·
// dòng cũ không lọt vào mẫu số % tuân thủ · tắt công tắc thì trở lại hành vi cũ · MỨC XỬ LÝ THEO TỪNG LUẬT: cùng một kho vừa có luật chỉ CẢNH BÁO vừa có luật BẮT BUỘC.
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

const PUT_COLS = 'putaway_priority,putaway_enforced,putaway_date_mix,' +
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
  if ((wh?.putaway_enforced ?? []).length || wh?.putaway_priority !== 'CONSOLIDATE'
      || wh?.putaway_date_mix !== 'ANY' || wh?.putaway_block_pick_face || wh?.putaway_block_qa_hold
      || wh?.putaway_block_full || wh?.putaway_single_ncc) {
    console.log(`  ⚠️  kho test đang có cấu hình cất hàng KHÁC mặc định: ${JSON.stringify(whBackup)}`)
    console.log('      (gói sẽ khôi phục đúng trạng thái này — nếu đây là tàn dư của lần chạy hỏng thì reset trước rồi chạy lại)')
  }

  // Đổi cấu hình QUA API như người dùng thật, KHÔNG ghi thẳng DB: backend cache cấu hình kho 30s
  // cho đường quét (hot-path) và chỉ xoá cache khi lưu qua form. Ghi thẳng PostgREST thì luật vẫn
  // chạy theo bản cũ tới 30s — chính chỗ này từng làm 6 phép kiểm đỏ oan.
  const setRules = (patch) => api(`/masterdata/warehouses/${whId}`, 'PUT', patch)
  // Chờ cấu hình có hiệu lực trên MỌI instance serverless trước khi ĐO ĐUA.
  // Lưu qua API chỉ xoá cache của instance nhận request; instance khác giữ bản cũ tới 30s
  // (putawayContext.whConfig). Bắn 6 lượt đồng thời NGAY sau khi bật luật thì vài lượt rơi vào
  // instance chưa biết luật ⇒ phép kiểm lật qua lật lại giữa các lần chạy (đo thật 15/08: cùng
  // một bản code, lượt 1 ra "1 mã" XANH, lượt 2 ra "2 mã" ĐỎ). Đây là ĐỘ TRỄ CẤU HÌNH, không
  // phải row-lock hỏng — chờ hết cửa sổ rồi mới đo thì phép kiểm mới nói đúng thứ nó định nói.
  const waitConfigSettled = () => new Promise(r => setTimeout(r, 31_000))
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
  // Chỉ để phép kiểm [38]/[38b] có ÍT NHẤT 1 dòng mang cờ "không lấy hàng đi" — kho thật đang 0
  // vị trí, mà lọc ra 0 dòng thì không phân biệt được "cắt đúng" với "cắt sạch vì query hỏng".
  await mkLoc('NOOUT', { slot_no_out: true })

  // ── 1. Picker: mặc định = hành vi cũ, ★ do BE chấm ───────────────────────────────────
  await setRules({ putaway_priority: 'CONSOLIDATE', putaway_date_mix: 'ANY',
    putaway_enforced: [], putaway_block_pick_face: false, putaway_block_qa_hold: false,
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
  // Picker Chuyển vị trí hàng loạt chọn được pallet NHIỀU MÃ ⇒ không có material_id. Suy "có
  // material_id mới là picker cất hàng" làm đúng ca đó picker KHÔNG hiện gì (soi UI 15/08 thấy
  // thật: ô cấm nhận hàng trông y hệt ô thường, chọn xong bấm Chuyển mới ăn 422).
  {
    const noMat = (await api(`/masterdata/locations?warehouse_id=${whId}&view=lite&limit=200&putaway=1`)).j?.data ?? []
    check('[3b] picker KHÔNG biết mã hàng (lô nhiều mã) vẫn được chấm luật của Ô',
      noMat.find(r => r.id === locNoIn.id)?.putaway?.blocked === 'NO_IN',
      `${noMat.length} vị trí · ${JSON.stringify(noMat.find(r => r.id === locNoIn.id)?.putaway ?? null)}`)
  }
  check('[4] ô bị chặn xuống cuối, ô hợp lệ đứng trên',
    rows.findIndex(r => r.id === locOk.id) < rows.findIndex(r => r.id === locNoIn.id))
  // Lọc Loại kho phải cắt TRÊN SERVER (bug 17/08: form Nhập kho lọc client trên 50 dòng server
  // đã cắt → user thấy "chỉ hiện vài vị trí, gõ tay mới ra ô khác" — lớp lỗi lọc-trên-list-cắt-cụt).
  if (mat.category) {
    const locWrongCat = await mkLoc('WRONGCAT', { categories: [`${TAG}-khac`] })
    const locNullCat  = await mkLoc('NULLCAT',  { categories: null })
    const byCat = (await api(`/masterdata/locations?warehouse_id=${whId}&material_id=${mat.id}&view=lite&limit=300&category=${encodeURIComponent(mat.category)}`)).j?.data ?? []
    check('[4b] &category= cắt trên SERVER: vị trí loại KHÁC không về, đúng loại có về',
      !byCat.some(r => r.id === locWrongCat.id) && byCat.some(r => r.id === locOk.id), `${byCat.length} vị trí`)
    check('[4c] vị trí CHƯA khai loại (dùng chung) vẫn có mặt khi lọc category',
      byCat.some(r => r.id === locNullCat.id))
  }

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
    r.s === 200 && /không đưa hàng vào/i.test(r.j?.data?.putaway_warning ?? ''),
    `HTTP ${r.s}`)

  await setRules({ putaway_enforced: ['NO_IN'] }); await waitConfigSettled()
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

  await setRules({ putaway_enforced: [] })
  const qr3 = mkQR()
  r = await api(`/wms/inbound-orders/${orderId}/scan`, 'POST',
    { qr_code: qr3, location_id: locNoIn.id, qty_semantics: 'base' })
  const t3 = await traceOf(qr3)
  // user chốt 18/08: màn QUÉT không cảnh báo quy tắc cất — nơi quyết định chỗ cất là bước CHỌN VỊ
  // TRÍ (đã gác + đã nói ra ở [8]/[11]). Nhắc lại mỗi tem chỉ dạy người quét bấm bỏ qua. Nhưng VẾT
  // thì bắt buộc còn, nếu không % tuân thủ ở [17] mất mẫu số mà không ai biết.
  check('[16] kho chỉ cảnh báo: quét qua được + VẪN ghi vết, nhưng KHÔNG cảnh báo ở màn quét',
    r.s === 200 && t3?.putaway_violation === 'NO_IN'
      && !(r.j?.data?.warnings ?? []).some(w => /đưa hàng vào/i.test(w)),
    `viol=${t3?.putaway_violation} warnings=${JSON.stringify(r.j?.data?.warnings ?? [])}`)

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
    await setRules({ putaway_date_mix: 'ANY', putaway_enforced: [] })
    await api(`/wms/inbound-orders/${oD}/scan`, 'POST', { qr_code: qrDate(30, 970), location_id: locD.id, qty_semantics: 'base' })

    await setRules({ putaway_date_mix: 'OLDER_ONLY', putaway_enforced: ['DATE_MIX'] }); await waitConfigSettled()
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
    await setRules({ putaway_date_mix: 'ANY', putaway_enforced: [] })
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
    // Trần khai TRÊN Ô (26/08). Kho chỉ còn quyết định MỨC XỬ LÝ (chặn hay cảnh báo).
    const locRace = await mkLoc('RACE', { max_materials: 1 })
    await setRules({ putaway_enforced: ['MAX_MATERIALS'] })
    await waitConfigSettled()
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
    await setRules({ putaway_enforced: [] })
  } else check('[18] ĐUA tối đa N mã/ô', true, 'bỏ qua — không đủ 3 mã có khai thùng/pallet')

  // ── 6b. TRẦN SỐ MÃ KHAI THEO TỪNG VỊ TRÍ (26/08) ─────────────────────────────────────
  // Đây là lý do đổi trục: "Ngoài đường" / "Mặt đất" là nơi CHỨA CHUNG nhưng nằm CÙNG KHU và
  // CÙNG LOẠI HÀNG với kệ thường (đo staging: B_TP1_NGOÀI ĐƯỜNG SCA giữ 29 mã, ngay cạnh các kệ
  // 1-2 mã cùng khu TP1). Không tầng nào của kho tách được hai thứ đó ⇒ phép kiểm phải dựng đúng
  // hình đó: HAI Ô cùng kho, cùng loại hàng, chỉ khác ở CHÍNH Ô — một ô phải chặn, ô kia phải qua.
  if (raceMats.length >= 3) {
    const locLimit = await mkLoc('MMLIMIT', { max_materials: 1 })   // kệ thường: 1 mã
    const locFree  = await mkLoc('MMFREE')                          // "Ngoài đường": để trống
    await setRules({ putaway_enforced: ['MAX_MATERIALS'] })
    await waitConfigSettled()

    // Cất TUẦN TỰ 2 mã khác nhau vào từng ô (đua đã đo ở [18]; ở đây đo LUẬT, không đo khoá)
    const put = async (locId, m, seq) => {
      const rr = await mkOrder(locId, { material_id: m.id })
      const oid = rr.j?.data?.order?.id
      if (!oid) return { s: 0 }
      return api(`/wms/inbound-orders/${oid}/scan`, 'POST',
        { qr_code: `${ddmmyy}_${m.material_code}_${TAG.replace(/-/g, '')}_M8_${seq}_${wh.nmsx_code ?? 'B'}`,
          location_id: locId, qty_semantics: 'base' })
    }
    const l1 = await put(locLimit.id, raceMats[0], 971)
    const l2 = await put(locLimit.id, raceMats[1], 972)
    check('[18b] ô KHAI trần 1 mã → mã thứ HAI bị CHẶN (mã đầu vẫn vào bình thường)',
      l1.s === 200 && l2.s === 422 && l2.j?.error?.code === 'PUTAWAY_VIOLATION',
      `mã1 HTTP ${l1.s} · mã2 HTTP ${l2.s} ${l2.j?.error?.code ?? ''}`)
    // Câu chữ phải chỉ đúng chỗ cần sửa. Nói "kho giới hạn" là đẩy người ta đi sửa nhầm cấu hình kho.
    check('[18c] thông báo chặn nói "vị trí này", KHÔNG đổ cho kho',
      typeof l2.j?.error?.message === 'string' && /vị trí này/i.test(l2.j.error.message)
        && !/kho giới hạn/i.test(l2.j.error.message),
      String(l2.j?.error?.message ?? '').slice(0, 120))

    const f1 = await put(locFree.id, raceMats[0], 973)
    const f2 = await put(locFree.id, raceMats[1], 974)
    const f3 = await put(locFree.id, raceMats[2], 975)
    check('[18d] ô ĐỂ TRỐNG = KHÔNG GIỚI HẠN → 3 mã vào cùng ô đều qua, DÙ cùng kho + cùng loại hàng với [18b]',
      f1.s === 200 && f2.s === 200 && f3.s === 200,
      `HTTP ${f1.s}/${f2.s}/${f3.s} — chứng minh luật đi theo Ô, không theo kho/loại kho`)

    // Trần nằm trên dòng Location nên đọc TƯƠI mỗi lượt — khác cấu hình kho (cache 30s). Khai xong
    // là ăn ngay, không có cửa sổ "vừa bật xong mà lượt kế vẫn lọt" như luật của kho.
    await restWrite('Location', 'PATCH', `id=eq.${locLimit.id}`, { max_materials: null })
    const l3 = await put(locLimit.id, raceMats[1], 976)
    check('[18e] gỡ trần của ô → có hiệu lực NGAY (không phải chờ 30s như cấu hình kho)',
      l3.s === 200, `HTTP ${l3.s} ${l3.j?.error?.code ?? ''}`)
    await setRules({ putaway_enforced: [] })
  } else check('[18b] trần số mã theo từng vị trí', true, 'bỏ qua — không đủ 3 mã có khai thùng/pallet')

  // ── 7. CHIẾN THUẬT ABC (đợt C) — phải chỉ vào ĐÚNG khu Slotting coi là band của hạng đó ──────
  // Oracle dựng ĐỘC LẬP từ `material_abc` + hạng nhặt khu, rồi so với cái BE đánh dấu. Đây chính
  // là chỗ hai module từng đánh nhau: Slotting đẩy hàng A ra gần cửa, luồng nhập cất vào khu C.
  {
    const abcRows = await restRpc('material_abc', { p_warehouse_id: whId, p_categories: null, p_days: 30 })
    const zoneRows = await restAll('WarehouseZone',
      `select=code,categories,pick_rank&warehouse_id=eq.${whId}&is_active=is.true&pick_rank=not.is.null`)
    const target = (mrow) => {
      const hop = zoneRows
        .filter(z => !z.categories?.length || (mrow.category && z.categories.includes(mrow.category)))
        .sort((a, b) => (a.pick_rank - b.pick_rank) || a.code.localeCompare(b.code))
      const band = (i, n) => (n <= 1 ? 'A' : (i / n < 1 / 3 ? 'A' : (i / n < 2 / 3 ? 'B' : 'C')))
      return hop.filter((_, i) => band(i, hop.length) === mrow.abc).map(z => z.code)
    }
    // Chọn mã có khu đích THẬT SỰ tồn tại — loại hàng chỉ có 1 khu xếp hạng thì khu đó là band A,
    // nên mã hạng C ĐÚNG RA không có khu đích nào (rỗng là kết quả hợp lệ, không phải lỗi).
    const withTarget = (abcRows ?? []).map(r => ({ r, want: target(r) })).find(x => x.want.length > 0)
    if (withTarget && zoneRows.length > 0) {
      const { r: mrow, want } = withTarget
        await setRules({ putaway_priority: 'ABC' }); await waitConfigSettled()
      const url = `/masterdata/locations?warehouse_id=${whId}&material_id=${mrow.material_id}&view=lite&limit=200`
      const rowsAbc = (await api(url)).j?.data ?? []
      const marked = rowsAbc.filter(x => x.putaway?.reason === 'BAND_MATCH')
      check('[22] chiến thuật ABC đánh dấu ĐÚNG khu mà oracle độc lập tính ra',
        marked.length > 0 && marked.every(x => want.includes(x.sub_code)),
        `mã ${mrow.material_code} hạng ${mrow.abc} · oracle [${want.join(',')}] · BE [${[...new Set(marked.map(x => x.sub_code))].join(',')}]`)
      const top = rowsAbc.find(x => !x.putaway?.blocked)
      check('[23] vị trí ĐẦU danh sách nằm trong khu đúng band',
        !!top && want.includes(top.sub_code), `đầu = ${top?.location_code} (khu ${top?.sub_code})`)
      // Khu đích phải lọt vào danh sách NGAY CẢ KHI kho nhiều vị trí hơn `limit`: picker cắt theo
      // mã vị trí TRƯỚC khi chấm điểm, nên khu đích nằm cuối bảng chữ cái từng bị cắt gần hết —
      // ABC gợi ý vào đúng khu mà ô chọn không hiện (đo 17/08: Ba Vì limit=200 lọt 6/41 vị trí TP3).
      const nLoc = (await restAll('Location', `select=id&warehouse_id=eq.${whId}&is_active=is.true`)).length
      const tight = (await api(`${url.replace(/limit=\d+/, 'limit=' + Math.max(10, Math.floor(nLoc / 2)))}`)).j?.data ?? []
      const inBand = tight.filter(x => want.includes(x.sub_code))
      check('[25b] cắt danh sách KHÔNG làm mất khu đích ABC (nạp khu đích trước khi cắt)',
        inBand.length > 0, `kho ${nLoc} vị trí · xin ${Math.max(10, Math.floor(nLoc / 2))} · khu đích về ${inBand.length} dòng`)
      await setRules({ putaway_priority: 'CONSOLIDATE' })
      const rowsGom = (await api(url)).j?.data ?? []
      check('[24] đổi về Gom → hết đánh dấu BAND_MATCH (không dính cache chiến thuật cũ)',
        rowsGom.every(x => x.putaway?.reason !== 'BAND_MATCH'))
    } else {
      // Không dựng được ca có khu đích → vẫn phải chứng minh BE KHÔNG đánh dấu bừa
        await setRules({ putaway_priority: 'ABC' }); await waitConfigSettled()
      const rowsAbc = (await api(`/masterdata/locations?warehouse_id=${whId}&material_id=${mat.id}&view=lite&limit=100`)).j?.data ?? []
      check('[22] kho/loại hàng chưa có khu đích → ABC xuống thang, KHÔNG đánh dấu bừa',
        rowsAbc.every(x => x.putaway?.reason !== 'BAND_MATCH'),
        `${zoneRows.length} khu xếp hạng, không khu nào hợp band`)
      await setRules({ putaway_priority: 'CONSOLIDATE' })
    }
  }

  // ── 8. CỬA "CHUYỂN VỊ TRÍ HÀNG LOẠT" (đợt D) ────────────────────────────────────────
  // Đợt B gác 4 cửa của Nhập kho rồi coi như xong; cửa này — công nhân kho dùng nhiều thứ hai —
  // vẫn đi THẲNG xuống RPC move, nên kho bật "bắt buộc" vẫn dồn được pallet vào ô CẤM NHẬN HÀNG.
  // [28] là phép kiểm quan trọng nhất: chấm TỪNG pallet với sự thật TĨNH của ô sẽ LỌT, chỉ gộp
  // cả lô mới bắt được.
  {
    const mat2 = (raceMats ?? []).find(m => m.id !== mat.id)
    await setRules({ putaway_enforced: [], putaway_date_mix: 'ANY' })
    const locBulk = await mkLoc('BULK')
    const qrFor = (code, s) => `${ddmmyy}_${code}_${TAG.replace(/-/g, '')}_M9_${s}_${wh.nmsx_code ?? 'B'}`
    const mkPallet = async (m, s) => {
      const oid = (await mkOrder(locOk.id, { material_id: m.id })).j?.data?.order?.id
      const code = qrFor(m.material_code, s)
      await api(`/wms/inbound-orders/${oid}/scan`, 'POST', { qr_code: code, location_id: locOk.id, qty_semantics: 'base' })
      const row = (await restAll('InventoryEntry', `select=id&pallet_code=eq.${encodeURIComponent(code)}`))[0]
      return row ? { id: row.id, code } : null
    }
    const p1 = await mkPallet(mat, 980)
    const p2 = mat2 ? await mkPallet(mat2, 981) : null
    const move = (ids, location_id, extra = {}) =>
      api('/wms/inventory/bulk-location', 'PATCH', { ids, location_id, ...extra })

    if (p1) {
      let rb = await move([p1.id], locNoIn.id)
      check('[25] Chuyển vị trí hàng loạt — kho chỉ CẢNH BÁO: vẫn chuyển được nhưng nói ra là lệch luật',
        rb.s === 200 && /không đưa hàng vào/i.test(rb.j?.data?.putaway_warning ?? ''),
        `HTTP ${rb.s} · ${rb.j?.data?.putaway_warning ?? 'không có cảnh báo'}`)

      await setRules({ putaway_enforced: ['NO_IN'] }); await waitConfigSettled()
      rb = await move([p1.id], locNoIn.id)
      check('[26] kho BẮT BUỘC → cửa này bị CHẶN THẬT (trước 15/08 nó đi thẳng xuống RPC, không hỏi luật)',
        rb.s === 422 && rb.j?.error?.code === 'PUTAWAY_VIOLATION', `HTTP ${rb.s} ${rb.j?.error?.code ?? ''}`)

      rb = await move([p1.id], locNoIn.id, { putaway_override_reason: 'EQUIPMENT' })
      const tb = await traceOf(p1.code)
      check('[27] vượt rào → qua VÀ vết ghi theo LẦN CẤT NÀY (không giữ vết của lần nhập đầu tiên)',
        rb.s === 200 && tb?.putaway_checked === true && tb?.putaway_violation === 'NO_IN'
          && tb?.putaway_override_reason === 'EQUIPMENT',
        `HTTP ${rb.s} viol=${tb?.putaway_violation} reason=${tb?.putaway_override_reason}`)
    }

    if (p1 && p2) {
      await restWrite('Location', 'PATCH', `id=eq.${locBulk.id}`, { max_materials: 1 })
      await setRules({ putaway_enforced: ['MAX_MATERIALS'] })
      await waitConfigSettled()
      let rb = await move([p1.id, p2.id], locBulk.id)
      check('[28] ô trống giới hạn 1 mã + lô 2 MÃ → CHẶN (chấm từng pallet với sự thật tĩnh sẽ lọt cả 2)',
        rb.s === 422 && rb.j?.error?.code === 'PUTAWAY_VIOLATION', `HTTP ${rb.s} ${rb.j?.error?.code ?? ''}`)

      rb = await move([p1.id], locBulk.id)
      check('[29] cũng ô đó, chuyển RIÊNG 1 pallet thì QUA — chứng minh [28] chặn vì TẬP của lô, không chặn bừa',
        rb.s === 200, `HTTP ${rb.s} ${rb.j?.error?.code ?? ''}`)

      // Đua: 2 lượt chuyển đồng thời, mỗi lượt 1 mã, vào CÙNG ô trống giới hạn 1 mã. Cả hai đều
      // qua được guard ở backend (lúc đọc, ô còn trống) ⇒ chỉ row-lock trong RPC mới cứu được.
      const locR2 = await mkLoc('RACE2', { max_materials: 1 })
      await Promise.all([move([p1.id], locR2.id), move([p2.id], locR2.id)])
      const inR2 = await restAll('InventoryEntry',
        `select=material_id&location_id=eq.${locR2.id}&stack_layer=eq.1&status=in.(IN_STOCK,PARTIAL)&cartons_remaining=gt.0`)
      check('[30] ĐUA 2 lượt chuyển đồng thời vào ô giới hạn 1 mã → chỉ 1 mã chiếm chỗ (đếm dưới row-lock)',
        new Set(inR2.map(x => x.material_id)).size <= 1,
        `${inR2.length} pallet · ${new Set(inR2.map(x => x.material_id)).size} mã`)
      await setRules({ putaway_enforced: [] })
    } else check('[28] lô nhiều mã vào ô giới hạn 1 mã', true, 'bỏ qua — không tìm được mã thứ hai cùng loại hàng')
  }

  // ── 9. MỨC XỬ LÝ THEO TỪNG LUẬT (16/08) — hai luật, hai mức, CÙNG một kho ────────────
  // User chốt: "cấm đưa hàng vào là cấm gợi ý và lên kế hoạch, chứ thực tế khi cần tôi vẫn để ở
  // đó" — trong khi luật trộn date thì đáng chặn thật (chạy ngược 60 ngày ở Ba Vì: 31,1% lượt cất
  // đang chôn hàng phải lấy trước). MỘT công tắc chung không diễn đạt được hai ý định trái chiều
  // đó, và bật nó lên là biến khu ngoài đường đang chứa 70 pallet thành khu NGOẠI LỆ.
  {
    const locE = await mkLoc('LEVEL')
    const oE = (await mkOrder(locE.id)).j?.data?.order?.id
    const qrLv = (daysAgo, s) => {
      const dt = new Date(Date.now() - daysAgo * 86400000)
      const d2 = `${String(dt.getDate()).padStart(2, '0')}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getFullYear()).slice(2)}`
      return `${d2}_${mat.material_code}_${TAG.replace(/-/g, '')}_M9_${s}_${wh.nmsx_code ?? 'B'}`
    }
    await setRules({ putaway_date_mix: 'ANY', putaway_enforced: [], putaway_block_pick_face: false })
    await api(`/wms/inbound-orders/${oE}/scan`, 'POST', { qr_code: qrLv(30, 990), location_id: locE.id, qty_semantics: 'base' })

    // CÙNG MỘT LƯỢT CẤU HÌNH: trộn date = BẮT BUỘC, còn "cấm đưa hàng vào" + "ô nhặt lẻ" = CẢNH BÁO
    await setRules({ putaway_block_pick_face: true, putaway_date_mix: 'OLDER_ONLY', putaway_enforced: ['DATE_MIX'] }); await waitConfigSettled()

    let r = await mkOrder(locNoIn.id)
    check('[31] "Không đưa hàng vào" ở mức CẢNH BÁO → VẪN cất được + nói ra (đúng ý user)',
      r.s === 200 && /không đưa hàng vào/i.test(r.j?.data?.putaway_warning ?? ''),
      `HTTP ${r.s} · ${r.j?.data?.putaway_warning ?? 'KHÔNG có cảnh báo'}`)

    r = await mkOrder(locPick.id)
    check('[32] Luật "ô nhặt lẻ" cũng ở mức CẢNH BÁO → không chặn', r.s === 200, `HTTP ${r.s} ${r.j?.error?.code ?? ''}`)

    const rDate = await api(`/wms/inbound-orders/${oE}/scan`, 'POST',
      { qr_code: qrLv(60, 991), location_id: locE.id, qty_semantics: 'base' })
    check('[33] CÙNG LÚC, CÙNG KHO: luật trộn date ở mức BẮT BUỘC vẫn CHẶN THẬT',
      rDate.s === 422 && rDate.j?.error?.code === 'PUTAWAY_VIOLATION',
      `HTTP ${rDate.s} ${rDate.j?.error?.code ?? ''}`)

    const bad = await setRules({ putaway_enforced: ['KHONG_CO_THAT'] })
    check('[34] mã luật lạ trong danh sách bắt buộc → từ chối, không ghi bừa vào DB',
      bad.s === 422 || bad.s === 400, `HTTP ${bad.s}`)

    await setRules({ putaway_date_mix: 'ANY', putaway_enforced: [], putaway_block_pick_face: false })
  }

  // ── 10. "Ô ĐANG CHỨA GÌ" + Slotting KHÔNG giằng hàng với Fill (17/08) ────────────────
  {
    // [35][36] endpoint contents: số pallet phải khớp ĐÚNG định nghĩa used_slots của picker,
    // không thì hai chỗ trên cùng màn nói hai số.
    const cts = (await api(`/masterdata/locations/${locOk.id}/contents`)).j?.data
    const pickRow = (await pick()).find(r => r.id === locOk.id)
    check('[35] "ô đang chứa gì" trả đúng vị trí + có danh sách mã',
      !!cts && cts.location_code === locOk.location_code && Array.isArray(cts.materials),
      `${cts?.location_code} · ${cts?.materials?.length ?? '?'} mã`)
    check('[36] số pallet của "đang chứa" KHỚP used_slots của picker (một định nghĩa)',
      Number(cts?.pallets ?? -1) === Number(pickRow?.used_slots ?? -2),
      `contents=${cts?.pallets} picker=${pickRow?.used_slots}`)

    // [37] Slotting: ô vừa NHẶT LẺ vừa CẤM NHẬP thì hàng trong đó KHÔNG bị xếp vào diện kéo đi
    // (nếu không, Fill hạ hàng xuống rồi Slotting lại đòi bốc lên — giằng nhau vô tận).
    const stats = await restRpc('slotting_stats', { p_warehouse_id: whId, p_categories: null, p_days: 30 })
    const locs = stats?.locations ?? []
    // [38] Lọc theo CỜ phải CẮT THẬT ở cả nhánh mảng (không có ?page=). Bắt 17/08: `pick_face`
    // chỉ khai ở nhánh phân trang nên `?pick_face=1` trả TOÀN BỘ vị trí của kho mà không báo gì.
    {
      const nAll  = ((await api(`/masterdata/locations?warehouse_id=${whId}&view=lite`)).j?.data ?? []).length
      const pf    = (await api(`/masterdata/locations?warehouse_id=${whId}&pick_face=1&view=lite`)).j?.data ?? []
      const noIn  = (await api(`/masterdata/locations?warehouse_id=${whId}&slot_no_in=1&view=lite`)).j?.data ?? []
      const noOut = (await api(`/masterdata/locations?warehouse_id=${whId}&slot_no_out=1&view=lite`)).j?.data ?? []
      check('[38] lọc theo cờ CẮT THẬT (không im lặng trả cả kho)',
        pf.length < nAll && pf.every(l => l.is_pick_face === true) && noIn.every(l => l.slot_no_in === true)
          && noOut.every(l => l.slot_no_out === true) && noOut.length < nAll,
        `cả kho ${nAll} · nhặt lẻ ${pf.length} · không đưa hàng vào ${noIn.length} · không lấy hàng đi ${noOut.length}`)

      // [38b] Nhánh PHÂN TRANG (?page=) đi qua RPC, khác nhánh mảng ở trên. Cờ khai thiếu ở một
      // trong hai nhánh = im lặng trả cả kho — đúng bug `pick_face` 17/08, nay gác cả 2 cờ.
      const paged = async (qs) => (await api(`/masterdata/locations?warehouse_id=${whId}&page=1&page_size=500${qs}`)).j?.data ?? {}
      const pIn  = await paged('&slot_no_in=1')
      const pOut = await paged('&slot_no_out=1')
      const pAll = await paged('')
      check('[38b] nhánh PHÂN TRANG cũng cắt theo 2 cờ (RPC có p_slot_no_in + p_slot_no_out)',
        (pIn.rows ?? []).every(l => l.slot_no_in === true) && pIn.total === noIn.length
          && (pOut.rows ?? []).every(l => l.slot_no_out === true) && pOut.total === noOut.length
          && pAll.total > pIn.total,
        `cả kho ${pAll.total} · cấm nhập ${pIn.total}/${noIn.length} · hàng kẹt ${pOut.total}/${noOut.length}`)
    }
    check('[37] slotting_stats trả cờ is_pick_face cho từng vị trí (P1 cần để chừa ô nhặt lẻ)',
      locs.length === 0 || locs.every(l => Object.prototype.hasOwnProperty.call(l, 'is_pick_face')),
      `${locs.length} vị trí`)

    // [39] Pallet ĐANG BỊ QA GIỮ không bao giờ được đưa vào kế hoạch xếp lại. Kho hay gom hàng
    // KPH/chờ tái kiểm vào đúng những ô đánh dấu "không đưa hàng vào" (đo Ba Vì 17/08: 40/95
    // pallet QA giữ nằm trong 4 ô như thế) ⇒ bước P1 "kéo hàng khu tạm về kho chuẩn" sẽ dọn
    // chính số hàng đang bị đóng băng vào rack thường, trong khi Xuất kho vẫn từ chối xuất nó.
    // Kiểm trên DỮ LIỆU THẬT của kho (không fixture): engine mà quay lại lấy nguồn QA giữ là đỏ.
    {
      const qaBad = (await restAll('QAStatus', 'select=id,code&code=neq.OK')).map(q => q.id)
      if (qaBad.length === 0) {
        check('[39] kế hoạch Slotting không kéo pallet QA giữ', true, 'BỎ QUA — DB không có QAStatus khác OK')
      } else {
        const held = new Set((await restAll('InventoryEntry',
          `select=id&warehouse_id=eq.${whId}&qa_status_id=in.(${qaBad.join(',')})` +
          `&status=in.(IN_STOCK,PARTIAL,QUARANTINE)&cartons_remaining=gt.0`)).map(r => r.id))
        // Engine BẮT BUỘC chọn Loại kho (400 CHOOSE_CATEGORY) — chạy từng loại rồi gộp, để không
        // bỏ sót loại nào có pallet QA giữ.
        const cats = [...new Set((await restAll('Location', `select=categories&warehouse_id=eq.${whId}`))
          .flatMap(l => l.categories ?? []).filter(Boolean))]
        const lines = []
        let httpBad = 0
        for (const c of (cats.length ? cats : [mat.category])) {
          const pv = await api('/wms/slotting/plans/preview', 'POST',
            { warehouse_id: whId, level: 'NORMAL', principle: 'FEFO', days: 30, max_moves: 300,
              pull_wrong_zone: true, categories: [c] })
          if (pv.s !== 200) { httpBad++; continue }
          lines.push(...(pv.j?.data?.lines ?? []))
        }
        const bad = lines.flatMap(l => l.entry_ids ?? []).filter(id => held.has(id))
        check('[39] kế hoạch Slotting KHÔNG lấy pallet đang bị QA giữ làm nguồn (đóng băng tại chỗ)',
          httpBad === 0 && bad.length === 0,
          `${cats.length} loại · ${lines.length} dòng · ${held.size} pallet QA giữ trong kho · ${bad.length} bị kéo · lỗi HTTP ${httpBad}`)
      }
    }
  }

} catch (e) {
  check('gói chạy trọn', false, e?.message ?? String(e))
} finally {
  await cleanup()
  const left = await restAll('Location', `select=id&location_code=like.${TAG}-*`)
  const leftPo = await restAll('ProductionImport', `select=id&notes=like.*${TAG}*`)
  const [whNow] = await restAll('Warehouse', `select=putaway_enforced&id=eq.${whId}`)
  check('[dọn] không còn fixture sót (kể cả phiếu mồ côi) + kho trả về nguyên trạng',
    left.length === 0 && leftPo.length === 0 && JSON.stringify((whNow?.putaway_enforced ?? []).slice().sort()) === JSON.stringify((whBackup?.putaway_enforced ?? []).slice().sort()),
    `vị trí ${left.length} · phiếu ${leftPo.length}`)
  finish('PUTAWAY')
}
