// GÓI 53 — 19 ROUTE CUỐI CÙNG CHƯA PHÉP KIỂM NÀO CHẠM (đo bằng coverage-surface 07/09)
//
// VÌ SAO CÓ GÓI NÀY: sau 52 gói, thước đo bề-mặt-từ-code vẫn chỉ ra 18 route + 1 nhánh chưa ai gọi
// tới — 3 đường GHI (xoá hàng loạt DO SAP · quét kiểm kho · sửa xe nâng), 5 cửa ERP kéo dữ liệu
// (xác thực bằng KHOÁ API nên bộ kiểm đăng-nhập-như-người không với tới), còn lại là đường đọc.
// Đọc hợp đồng API của 19 route này lộ ra 3 nhóm nghi ngờ, mỗi nghi ngờ = ít nhất 1 phép kiểm:
//   (a) id/ngày rác trên query đi thẳng xuống Postgres rồi trả 500 "Lỗi hệ thống" (6 route);
//   (b) cửa ERP `limit=1000` xin PostgREST 1001 dòng để biết "còn trang sau" — nhưng PostgREST
//       trần 1000 ⇒ has_more luôn false ở đúng trang cuối cùng của mọi lượt kéo lớn = ERP mất dữ liệu ÂM THẦM;
//   (c) sổ Dồn/Tách (GET /wms/pallet-ops) không đọc warehouse_ids lần nào = kho A xem sổ kho B.
// Cửa ERP: gói tự CẤP khoá API rồi THU HỒI + XOÁ — không giữ khoá nào sau khi chạy.
//
// AN TOÀN: chỉ đụng bản ghi tự tạo (tiền tố QA53), dọn sạch ở cuối kể cả khi đổ giữa chừng.
import { api, rawFetch, login, restAll, restWrite, check, finish, resolveFixtures, HAS_DB, FIX, BASE } from './lib.mjs'
import { randomUUID } from 'crypto'

if (!HAS_DB) { console.error('Thiếu backend/.env — gói 53 cần soi DB'); process.exit(1) }

const T = 'QA53'
const now = () => new Date().toISOString()
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const dayShift = n => new Date(Date.now() + n * 86400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const err = r => `${r.j?.error?.code ?? ''} ${(r.j?.error?.message ?? '').slice(0, 80)}`.trim()
const notServerError = r => r.s < 500

console.log('── GÓI 53: 19 route cuối chưa ai chạm (đọc · ghi · cổng ERP · phạm vi kho) ──')
await login()
await resolveFixtures()

// ═══ DỌN TRƯỚC ═══════════════════════════════════════════════════════════════
async function wipe() {
  await restWrite('PalletOperation', 'DELETE', `operated_by_name=eq.${T}`).catch(() => {})
  for (const v of await restAll('forklift_vehicles', `select=id&code=like.${T}*`)) {
    await restWrite('forklift_daily_logs', 'DELETE', `forklift_id=eq.${v.id}`).catch(() => {})
    await restWrite('forklift_vehicles', 'DELETE', `id=eq.${v.id}`).catch(() => {})
  }
  await restWrite('erp_outbound_orders', 'DELETE', `od_number=like.${T}*`).catch(() => {})
  await restWrite('Vehicle', 'DELETE', `license_plate=like.53QA*`).catch(() => {})
  for (const k of await restAll('ApiKey', `select=id&name=like.${T}*`))
    await restWrite('ApiKey', 'DELETE', `id=eq.${k.id}`).catch(() => {})
  for (const e of await restAll('Employee', `select=id&employee_code=like.${T}*`)) {
    await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${e.id}`).catch(() => {})
    await restWrite('Employee', 'DELETE', `id=eq.${e.id}`).catch(() => {})
  }
  await restWrite('JobTitle', 'DELETE', `name=like.${T}*`).catch(() => {})
  await restWrite('auth_login_events', 'DELETE', `email=like.${T.toLowerCase()}*`).catch(() => {})
}
await wipe()

// ═══ TÀI KHOẢN PHẠM VI HẸP (kho Ba Vì) — để đo scope trên từng route ═══════════
let scoped = null   // hàm gọi API bằng tài khoản kho lẻ
{
  let bcrypt = null
  try { bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(m => m.default ?? m) } catch { /* chưa npm i backend */ }
  if (!bcrypt) console.log('  ⏭  không load được bcrypt của backend — bỏ qua các phép kiểm PHẠM VI KHO')
  else {
    const jid = randomUUID(), eid = randomUUID(), pw = 'Qa' + randomUUID().slice(0, 10) + '!'
    await restWrite('JobTitle', 'POST', '', [{ id: jid, name: `${T} chuc danh`, updated_at: now(),
      module_permissions: {
        pallet_ops: ['view'], stocktake: ['view', 'scan'], inventory: ['view', 'export', 'move_location'],
        slotting: ['view'], forklift: ['view', 'manage_vehicle'], tms_plan: ['view'],
        external_do_sap: ['view', 'delete'], tms_vehicles: ['view', 'delete'],
      } }])
    await restWrite('Employee', 'POST', '', [{ id: eid, employee_code: `${T}01`, name: `${T} nv kho le`, email: `${T.toLowerCase()}01@test.local`,
      password: await bcrypt.hash(pw, 10), is_active: true, job_title_id: jid, warehouse_id: FIX.WH_QR.id, warehouse_scope: 'ASSIGNED', updated_at: now() }])
    await restWrite('UserWarehouseAccess', 'POST', '', [{ id: randomUUID(), employee_id: eid, warehouse_id: FIX.WH_QR.id }])
    const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${T.toLowerCase()}01@test.local`, password: pw }) })
    const tk = (await lr.json().catch(() => null))?.data?.token
    check('[0] Đăng nhập tài khoản ASSIGNED kho Ba Vì', !!tk, `http=${lr.status}`)
    if (tk) scoped = async (path, method = 'GET', body) => {
      const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
        body: body ? JSON.stringify({ qty_semantics: 'base', ...body }) : undefined })
      let j = null; try { j = JSON.parse(await r.text()) } catch { /* không phải JSON */ }
      return { s: r.status, j }
    }
  }
}

try {
  // ═══ [1] GET /wms/events — SSE ═══════════════════════════════════════════════
  {
    // SSE không bao giờ tự kết thúc → cắt sau 5s; chỉ cần header về là kênh mở được.
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 5000)
    let s = 0, note = ''
    const t0 = Date.now()
    try { s = (await rawFetch('/wms/events', { signal: ac.signal })).s }
    catch (e) { note = e.name === 'AbortError' ? 'không có header nào về trong 5s' : String(e.message).slice(0, 80) }
    clearTimeout(t)
    check(`[1] GET /wms/events (SSE) mở được kênh — 200 (${Date.now() - t0}ms)`, s === 200, `http=${s} ${note}`)
  }

  // ═══ [2] GET /wms/pallet-ops — sổ Dồn/Tách ═════════════════════════════════
  {
    let r = await api('/wms/pallet-ops?limit=50')
    check('[2a] Sổ Dồn/Tách (không trang) → 200 + mảng', r.s === 200 && Array.isArray(r.j?.data), `http=${r.s} n=${r.j?.data?.length}`)
    r = await api('/wms/pallet-ops?page=1&page_size=20')
    check('[2b] Sổ Dồn/Tách (có trang) → 200 + items/total', r.s === 200 && Array.isArray(r.j?.data?.items) && typeof r.j?.data?.total === 'number', `http=${r.s} total=${r.j?.data?.total}`)
    r = await api('/wms/pallet-ops?date_from=abc&date_to=xyz')
    check('[2c] Ngày rác trên bộ lọc → 400, không "Lỗi hệ thống"', r.s === 400, `http=${r.s} ${err(r)}`)
    r = await api('/wms/pallet-ops?page=1&date_from=abc')
    check('[2d] Ngày rác (đường phân trang) → 400', r.s === 400, `http=${r.s} ${err(r)}`)
    r = await api(`/wms/pallet-ops?search=${encodeURIComponent('a"b,c')}`)
    check('[2e] Tìm tem có dấu nháy/phẩy → không 5xx', notServerError(r), `http=${r.s} ${err(r)}`)
    r = await api('/wms/pallet-ops?warehouse_id=abc')
    check('[2f] warehouse_id rác → không 5xx', notServerError(r), `http=${r.s}`)
    // PHẠM VI: thao tác của kho Bluestar phải VÔ HÌNH với tài khoản kho Ba Vì
    if (scoped) {
      const opId = randomUUID()
      await restWrite('PalletOperation', 'POST', '', [{ id: opId, type: 'MERGE', source_codes: [`${T}_SRC`], target_codes: [`${T}_TGT`], detail: { prev: [] },
        warehouse_id: FIX.WH_QTY.id, operated_by_name: T, created_at: now(), updated_at: now() }])
      const a = await api(`/wms/pallet-ops?search=${T}_SRC`)
      check('[2g] Admin thấy thao tác vừa ghi (nền cho phép kiểm phạm vi)', a.s === 200 && (a.j?.data ?? []).some(o => o.id === opId), `http=${a.s} n=${a.j?.data?.length}`)
      let sc = await scoped(`/wms/pallet-ops?search=${T}_SRC`)
      check('[2h] PHẠM VI: kho Ba Vì KHÔNG thấy thao tác của kho Bluestar (không trang)', sc.s === 200 && !(sc.j?.data ?? []).some(o => o.id === opId), `http=${sc.s} lọt=${(sc.j?.data ?? []).some(o => o.id === opId)}`)
      sc = await scoped(`/wms/pallet-ops?page=1&page_size=50&search=${T}_SRC`)
      check('[2i] PHẠM VI: kho Ba Vì KHÔNG thấy thao tác của kho Bluestar (có trang)', sc.s === 200 && !(sc.j?.data?.items ?? []).some(o => o.id === opId), `http=${sc.s} lọt=${(sc.j?.data?.items ?? []).some(o => o.id === opId)}`)
      sc = await scoped(`/wms/pallet-ops?page=1&page_size=50&warehouse_id=${FIX.WH_QTY.id}`)
      check('[2j] PHẠM VI: kho Ba Vì xin sổ kho Bluestar bằng warehouse_id → rỗng hoặc 403', sc.s === 403 || (sc.s === 200 && (sc.j?.data?.items ?? []).length === 0), `http=${sc.s} n=${sc.j?.data?.items?.length}`)
    }
  }

  // ═══ [3] GET /wms/inventory/export — xuất Excel tồn ═══════════════════════════
  {
    const dbActive = (await restAll('InventoryEntry', `select=id&warehouse_id=eq.${FIX.WH_QR.id}&cartons_remaining=gt.0&status=in.(IN_STOCK,PARTIAL)`)).length
    const t0 = Date.now()
    const r = await api(`/wms/inventory/export?warehouse_ids=${FIX.WH_QR.id}`)
    const n = r.j?.data?.entries?.length ?? -1
    check(`[3a] Xuất tồn kho Ba Vì → 200 (${Date.now() - t0}ms, ${(r.bytes / 1024).toFixed(0)}KB)`, r.s === 200 && Array.isArray(r.j?.data?.entries), `http=${r.s} ${err(r)}`)
    check(`[3b] Xuất tồn KHÔNG bị cắt ở trần 1.000 dòng (DB còn tồn=${dbActive})`, r.s !== 200 || dbActive <= 1000 || n > 1000, `trả ${n} dòng`)
    check('[3c] Xuất tồn trả ≥ số dòng còn tồn của kho', r.s !== 200 || n >= dbActive, `trả ${n} · DB ${dbActive}`)
    const b = await api('/wms/inventory/export?warehouse_ids=abc')
    check('[3d] warehouse_ids rác → 400', b.s === 400, `http=${b.s} ${err(b)}`)
    if (scoped) {
      const sc = await scoped(`/wms/inventory/export?warehouse_ids=${FIX.WH_QTY.id}`)
      const leak = (sc.j?.data?.entries ?? []).some(e => e.warehouse_id === FIX.WH_QTY.id)
      check('[3e] PHẠM VI: kho Ba Vì xuất tồn kho Bluestar → rỗng, không lọt dòng', sc.s === 200 && !leak, `http=${sc.s} n=${sc.j?.data?.entries?.length} lọt=${leak}`)
    }
  }

  // ═══ [4] GET /wms/inventory/stocktake-entries — danh sách kiểm kho ═══════════
  {
    let r = await api(`/wms/inventory/stocktake-entries?warehouse_id=${FIX.WH_QR.id}&view=all&page=1&page_size=50`)
    check('[4a] Danh sách kiểm kho Ba Vì → 200 + stats/entries', r.s === 200 && r.j?.data?.stats && Array.isArray(r.j?.data?.entries), `http=${r.s} ${err(r)} total=${r.j?.data?.stats?.total}`)
    // Location.warehouse_id / Location.id là cột TEXT → id rác = 0 dòng, không phải lỗi (luật: KHÔNG chặn theo hình dạng UUID)
    r = await api('/wms/inventory/stocktake-entries?warehouse_id=abc')
    check('[4b] warehouse_id rác → rỗng hoặc 400, không "Lỗi hệ thống"', notServerError(r), `http=${r.s} ${err(r)} total=${r.j?.data?.stats?.total}`)
    r = await api('/wms/inventory/stocktake-entries?location_ids=abc,def')
    check('[4c] location_ids rác → rỗng hoặc 400, không "Lỗi hệ thống"', notServerError(r), `http=${r.s} ${err(r)} total=${r.j?.data?.stats?.total}`)
    r = await api(`/wms/inventory/stocktake-entries?warehouse_id=${FIX.WH_QR.id}&page=abc&page_size=1000000000`)
    check('[4d] page/page_size rác → không 5xx', notServerError(r), `http=${r.s} ${err(r)}`)
    r = await api(`/wms/inventory/stocktake-entries?warehouse_id=${FIX.WH_QR.id}&date_from=2026-13-45`)
    check('[4e] Ngày rác → không 5xx (tự về hôm nay)', notServerError(r), `http=${r.s}`)
    if (scoped) {
      const sc = await scoped(`/wms/inventory/stocktake-entries?warehouse_id=${FIX.WH_QTY.id}&view=all`)
      check('[4f] PHẠM VI: kho Ba Vì xem kiểm kho Bluestar → 0 dòng', sc.s === 200 && (sc.j?.data?.stats?.total ?? -1) === 0, `http=${sc.s} total=${sc.j?.data?.stats?.total}`)
    }
  }

  // ═══ [5] GET /wms/inventory/move-log — sổ chuyển vị trí ═════════════════════
  {
    let r = await api(`/wms/inventory/move-log?date_from=2026-01-01&date_to=${TODAY}&page=1&page_size=50`)
    check('[5a] Sổ chuyển vị trí → 200 + rows/total', r.s === 200 && Array.isArray(r.j?.data?.rows) && typeof r.j?.data?.total === 'number', `http=${r.s} total=${r.j?.data?.total}`)
    r = await api('/wms/inventory/move-log?warehouse_id=abc')
    check('[5b] warehouse_id rác → rỗng hoặc 400, không "Lỗi hệ thống"', notServerError(r), `http=${r.s} ${err(r)} total=${r.j?.data?.total}`)
    r = await api(`/wms/inventory/move-log?date_from=2026-01-01&date_to=${TODAY}&page=1000000000`)
    check('[5c] Trang quá xa → 400 có hướng dẫn (lưới BAD_PAGE) hoặc 200 rỗng', r.s === 400 || (r.s === 200 && (r.j?.data?.rows ?? [1]).length === 0), `http=${r.s} ${err(r)}`)
    r = await api(`/wms/inventory/move-log?search=${encodeURIComponent("' or 1=1 --")}`)
    check('[5d] Tìm kiếm dạng injection → 400', r.s === 400, `http=${r.s} ${err(r)}`)
    if (scoped) {
      const sc = await scoped(`/wms/inventory/move-log?warehouse_id=${FIX.WH_QTY.id}&date_from=2026-01-01&date_to=${TODAY}`)
      check('[5e] PHẠM VI: kho Ba Vì xem sổ kho Bluestar → 0 dòng', sc.s === 200 && (sc.j?.data?.total ?? -1) === 0, `http=${sc.s} total=${sc.j?.data?.total}`)
    }
  }

  // ═══ [6] POST /wms/inventory/stocktake-check — quét kiểm kho (ĐƯỜNG GHI) ═════
  {
    const live = async wh => (await restAll('InventoryEntry', `select=id,pallet_code,warehouse_id&warehouse_id=eq.${wh}&cartons_remaining=gt.0&status=in.(IN_STOCK,PARTIAL)&order=updated_at.desc&limit=1`))[0]
    const pBV = await live(FIX.WH_QR.id), pBS = await live(FIX.WH_QTY.id)
    if (!pBV) console.log('  ⏭  kho Ba Vì không có pallet còn tồn — bỏ qua [6a][6b][6h]')
    else {
      let r = await api('/wms/inventory/stocktake-check', 'POST', { qr_code: pBV.pallet_code, warehouse_id: FIX.WH_QR.id })
      check('[6a] Quét kiểm tem đúng kho → 200 + entry', r.s === 200 && r.j?.data?.entry?.id === pBV.id, `http=${r.s} ${err(r)}`)
      r = await api('/wms/inventory/stocktake-check', 'POST', { qr_code: pBV.pallet_code, warehouse_id: FIX.WH_NONE.id })
      check('[6b] Quét kiểm tem ở KHO KHÁC → 404 (không lấy nhầm pallet kho người ta)', r.s === 404, `http=${r.s} ${err(r)}`)
      r = await api('/wms/inventory/stocktake-check', 'POST', { qr_code: pBV.pallet_code, warehouse_id: 'abc' })
      check('[6c] warehouse_id rác → 404 (kho không có), không "Lỗi hệ thống"', notServerError(r), `http=${r.s} ${err(r)}`)
    }
    // Body sai KIỂU: trước 07/09 `.trim()` trên số ném TypeError trong handler async → không ai trả lời → Vercel 504 sau 60s
    let t0 = Date.now()
    let r = await api('/wms/inventory/stocktake-check', 'POST', { qr_code: 12345 })
    check(`[6d] qr_code là SỐ → 400 trong ${Date.now() - t0}ms, không treo tới 504`, r.s === 400 && Date.now() - t0 < 15_000, `http=${r.s} ${err(r)}`)
    t0 = Date.now()
    r = await api('/wms/inventory/stocktake-check', 'POST', { qr_code: { a: 1 } })
    check(`[6e] qr_code là OBJECT → 400 trong ${Date.now() - t0}ms, không treo tới 504`, r.s === 400 && Date.now() - t0 < 15_000, `http=${r.s} ${err(r)}`)
    // Lưới cuối của app: body không phải JSON → JSON 400 nói thẳng, không phải trang HTML mặc định của Express
    const raw = await rawFetch('/wms/inventory/stocktake-check', { method: 'POST', body: '{"qr_code": ' })
    let rj = null; try { rj = JSON.parse(raw.text) } catch { /* HTML */ }
    check('[6j] Body hỏng JSON → 400 dạng JSON {success:false}', raw.s === 400 && rj?.success === false && typeof rj?.error?.message === 'string', `http=${raw.s} ${raw.text.slice(0, 60)}`)
    r = await api('/wms/inventory/stocktake-check', 'POST', {})
    check('[6f] Thiếu qr_code → 400', r.s === 400, `http=${r.s} ${err(r)}`)
    r = await api('/wms/inventory/stocktake-check', 'POST', { qr_code: `${T}_KHONG_TON_TAI` })
    check('[6g] Tem không có trong tồn → 404', r.s === 404, `http=${r.s} ${err(r)}`)
    if (scoped && pBS) {
      const sc = await scoped('/wms/inventory/stocktake-check', 'POST', { qr_code: pBS.pallet_code, warehouse_id: FIX.WH_QTY.id })
      check('[6h] PHẠM VI: kho Ba Vì quét kiểm pallet kho Bluestar → 403', sc.s === 403, `http=${sc.s} ${err(sc)}`)
    }
    if (scoped && pBV) {
      const sc = await scoped('/wms/inventory/stocktake-check', 'POST', { qr_code: pBV.pallet_code, warehouse_id: FIX.WH_QR.id })
      check('[6i] PHẠM VI: kho Ba Vì quét kiểm pallet kho mình → 200', sc.s === 200, `http=${sc.s} ${err(sc)}`)
    }
  }

  // ═══ [7] GET /wms/slotting — bảng phân tích ABC ═════════════════════════════
  {
    let r = await api(`/wms/slotting?warehouse_id=${FIX.WH_QR.id}&page=1&page_size=20`)
    check('[7a] Phân tích ABC kho Ba Vì → 200 (hoặc 503 quá hạn có hướng dẫn)', r.s === 200 || r.s === 503, `http=${r.s} ${err(r)} mã=${r.j?.data?.materials_total}`)
    r = await api('/wms/slotting')
    check('[7b] Thiếu warehouse_id → 400', r.s === 400, `http=${r.s}`)
    r = await api('/wms/slotting?warehouse_id=abc')
    check('[7c] warehouse_id rác → rỗng hoặc 4xx, không "Lỗi hệ thống"', notServerError(r), `http=${r.s} ${err(r)} mã=${r.j?.data?.materials_total}`)
    r = await api(`/wms/slotting?warehouse_id=${FIX.WH_QR.id}&days=abc&page=abc&page_size=-5`)
    check('[7d] days/page rác → không 5xx (về mặc định)', notServerError(r) || r.s === 503, `http=${r.s}`)
    r = await api(`/wms/slotting?warehouse_id=${FIX.WH_QR.id}&categories=%00`)
    check('[7e] categories chứa ký tự điều khiển → không 500', r.s !== 500, `http=${r.s} ${err(r)}`)
    if (scoped) {
      const sc = await scoped(`/wms/slotting?warehouse_id=${FIX.WH_QTY.id}`)
      check('[7f] PHẠM VI: kho Ba Vì xem ABC kho Bluestar → 403', sc.s === 403, `http=${sc.s} ${err(sc)}`)
    }
  }

  // ═══ [8][9][10] Xe nâng: board · report · PATCH ═════════════════════════════
  {
    let r = await api('/wms/forklift-board')
    check('[8a] Board check list hôm nay → 200 + vehicles', r.s === 200 && r.j?.data?.date === TODAY && Array.isArray(r.j?.data?.vehicles), `http=${r.s} n=${r.j?.data?.vehicles?.length}`)
    r = await api('/wms/forklift-board?date=abc')
    check('[8b] date rác → 200 (tự về hôm nay)', r.s === 200 && r.j?.data?.date === TODAY, `http=${r.s} date=${r.j?.data?.date}`)

    r = await api(`/wms/forklift-report?from=${dayShift(-7)}&to=${TODAY}`)
    check('[9a] Báo cáo vận hành 7 ngày → 200 + rows/summary/issue_items', r.s === 200 && Array.isArray(r.j?.data?.rows) && Array.isArray(r.j?.data?.summary), `http=${r.s} ${err(r)}`)
    r = await api(`/wms/forklift-report?from=${TODAY}&to=${dayShift(-3)}`)
    check('[9b] Khoảng ngày ngược → 400', r.s === 400, `http=${r.s} ${err(r)}`)
    r = await api(`/wms/forklift-report?from=${dayShift(-400)}&to=${TODAY}`)
    check('[9c] Khoảng ngày quá dài → 400 kèm hướng dẫn', r.s === 400, `http=${r.s} ${err(r)}`)
    r = await api(`/wms/forklift-report?from=${dayShift(-7)}&to=${TODAY}&warehouse_id=abc`)
    check('[9d] warehouse_id rác → không 5xx', notServerError(r), `http=${r.s} ${err(r)}`)

    // PATCH /wms/forklifts/:id — tạo 2 xe ở Ba Vì rồi sửa
    const c1 = await api('/wms/forklifts', 'POST', { code: `${T}X1`, name: `${T} xe 1`, warehouse_id: FIX.WH_QR.id })
    const c2 = await api('/wms/forklifts', 'POST', { code: `${T}X2`, name: `${T} xe 2`, warehouse_id: FIX.WH_QR.id })
    const X1 = c1.j?.data?.id, X2 = c2.j?.data?.id
    check('[10a] Dựng nền: tạo 2 xe nâng ở Ba Vì', !!X1 && !!X2, `http=${c1.s}/${c2.s} ${err(c1)}`)
    if (X1 && X2) {
      r = await api(`/wms/forklifts/${X1}`, 'PATCH', { name: `${T} xe 1 đổi tên` })
      const row = (await restAll('forklift_vehicles', `select=name,code&id=eq.${X1}`))[0]
      check('[10b] Sửa tên xe → 200 + DB đúng tên mới', r.s === 200 && row?.name === `${T} xe 1 đổi tên`, `http=${r.s} db=${row?.name}`)
      r = await api(`/wms/forklifts/${X2}`, 'PATCH', { code: `${T.toLowerCase()}x1` })
      check('[10c] Đổi mã xe 2 thành mã xe 1 (khác hoa/thường) → 409', r.s === 409, `http=${r.s} ${err(r)}`)
      r = await api(`/wms/forklifts/${X1}`, 'PATCH', { code: '' })
      check('[10d] Mã xe rỗng → 400', r.s === 400, `http=${r.s}`)
      r = await api(`/wms/forklifts/${X1}`, 'PATCH', { warehouse_id: 'abc' })
      check('[10e] Kho không tồn tại → 400, không "Lỗi hệ thống"', r.s === 400, `http=${r.s} ${err(r)}`)
      r = await api(`/wms/forklifts/abc`, 'PATCH', { name: 'x' })
      check('[10f] id xe rác → 404/400, không 5xx', notServerError(r), `http=${r.s} ${err(r)}`)
      r = await api(`/wms/forklifts/${randomUUID()}`, 'PATCH', { name: 'x' })
      check('[10g] id xe không tồn tại → 404', r.s === 404, `http=${r.s}`)
      if (scoped) {
        let sc = await scoped(`/wms/forklifts/${X1}`, 'PATCH', { name: `${T} sửa bởi kho lẻ` })
        check('[10h] PHẠM VI: kho Ba Vì sửa xe kho mình → 200', sc.s === 200, `http=${sc.s} ${err(sc)}`)
        sc = await scoped(`/wms/forklifts/${X1}`, 'PATCH', { warehouse_id: FIX.WH_QTY.id })
        check('[10i] PHẠM VI: kho Ba Vì chuyển xe sang kho Bluestar → 403', sc.s === 403, `http=${sc.s} ${err(sc)}`)
        await api(`/wms/forklifts/${X2}`, 'PATCH', { warehouse_id: FIX.WH_QTY.id })
        sc = await scoped(`/wms/forklifts/${X2}`, 'PATCH', { name: 'lén' })
        check('[10j] PHẠM VI: kho Ba Vì sửa xe của kho Bluestar → 403', sc.s === 403, `http=${sc.s} ${err(sc)}`)
        const b = await scoped('/wms/forklift-board')
        check('[10k] PHẠM VI: board kho Ba Vì không hiện xe kho Bluestar', b.s === 200 && !(b.j?.data?.vehicles ?? []).some(v => v.id === X2) && (b.j?.data?.vehicles ?? []).some(v => v.id === X1), `http=${b.s} n=${b.j?.data?.vehicles?.length}`)
      }
      const d1 = await api(`/wms/forklifts/${X1}`, 'DELETE'), d2 = await api(`/wms/forklifts/${X2}`, 'DELETE')
      check('[10l] Xoá 2 xe nền → 200', d1.s === 200 && d2.s === 200, `http=${d1.s}/${d2.s}`)
    }
  }

  // ═══ [11] GET /tms/reports/inbound — báo cáo nhập ══════════════════════════
  {
    let r = await api(`/tms/reports/inbound?date_from=${dayShift(-30)}&date_to=${TODAY}`)
    check('[11a] Báo cáo nhập 30 ngày → 200 + mảng', r.s === 200 && Array.isArray(r.j?.data), `http=${r.s} ${err(r)} n=${r.j?.data?.length}`)
    r = await api('/tms/reports/inbound')
    check('[11b] Thiếu khoảng ngày → 400', r.s === 400, `http=${r.s}`)
    r = await api('/tms/reports/inbound?date_from=2026-13-45&date_to=abc')
    check('[11c] Ngày rác → 400', r.s === 400, `http=${r.s} ${err(r)}`)
    r = await api(`/tms/reports/inbound?date_from=${dayShift(-30)}&date_to=${TODAY}&warehouse_id=abc`)
    check('[11d] warehouse_id rác → 400/404, không "Lỗi hệ thống"', notServerError(r), `http=${r.s} ${err(r)}`)
    if (scoped) {
      let sc = await scoped(`/tms/reports/inbound?date_from=${dayShift(-30)}&date_to=${TODAY}&warehouse_id=${FIX.WH_QTY.id}`)
      check('[11e] PHẠM VI: kho Ba Vì xin báo cáo kho Bluestar → 403', sc.s === 403, `http=${sc.s} ${err(sc)}`)
      sc = await scoped(`/tms/reports/inbound?date_from=${dayShift(-90)}&date_to=${TODAY}`)
      const leak = (sc.j?.data ?? []).filter(x => x.warehouse_id && x.warehouse_id !== FIX.WH_QR.id).length
      check('[11f] PHẠM VI: bỏ trống kho → chỉ dòng kho Ba Vì', sc.s === 200 && leak === 0, `http=${sc.s} n=${sc.j?.data?.length} lọt=${leak}`)
    }
  }

  // ═══ [12] POST /external/do-sap/bulk-delete — XOÁ HÀNG LOẠT DO SAP ═══════════
  {
    let r = await api('/external/do-sap/bulk-delete', 'POST', { ids: [] })
    check('[12a] Không chọn dòng → 400', r.s === 400, `http=${r.s}`)
    r = await api('/external/do-sap/bulk-delete', 'POST', { ids: 'abc' })
    check('[12b] ids không phải mảng → 400', r.s === 400, `http=${r.s}`)
    r = await api('/external/do-sap/bulk-delete', 'POST', { ids: [`${T}-khong-co`, 123, null] })
    check('[12c] ids rác/không tồn tại → 200 deleted=0, không 5xx', r.s === 200 && r.j?.data?.deleted === 0, `http=${r.s} ${err(r)} deleted=${r.j?.data?.deleted}`)

    const plantBV = (await restAll('Warehouse', `select=sap_plant&id=eq.${FIX.WH_QR.id}`))[0]?.sap_plant ?? null
    const mk = (suffix, item, plant) => ({ id: `${T}-${suffix}`, od_number: `${T}DO1`, od_item: item, plant, material_code: 'QA53M', qty_base: 10, source: 'EXCEL', created_at: now(), updated_at: now() })
    await restWrite('erp_outbound_orders', 'POST', '', [mk('A', '10', plantBV), mk('B', '20', plantBV), mk('C', '30', '9999')])
    r = await api('/external/do-sap/bulk-delete?check=1', 'POST', { ids: [`${T}-A`, `${T}-B`] })
    check('[12d] Kiểm trước (check=1) → deletable=2, blocked=0, chưa xoá', r.s === 200 && r.j?.data?.deletable_count === 2 && r.j?.data?.blocked_count === 0
      && (await restAll('erp_outbound_orders', `select=id&od_number=eq.${T}DO1`)).length === 3, `http=${r.s} ${JSON.stringify(r.j?.data).slice(0, 100)}`)
    if (scoped) {
      const sc = await scoped('/external/do-sap/bulk-delete', 'POST', { ids: [`${T}-C`] })
      const still = (await restAll('erp_outbound_orders', `select=id&id=eq.${T}-C`)).length
      check('[12e] PHẠM VI: kho Ba Vì xoá DO plant 9999 (ngoài phạm vi) → 403 + dòng còn nguyên', sc.s === 403 && still === 1, `http=${sc.s} ${err(sc)} còn=${still}`)
      if (plantBV) {
        const sc2 = await scoped('/external/do-sap/bulk-delete', 'POST', { ids: [`${T}-A`, `${T}-C`] })
        const stillAll = (await restAll('erp_outbound_orders', `select=id&od_number=eq.${T}DO1`)).length
        check('[12f] PHẠM VI: lô có 1 dòng ngoài phạm vi → từ chối CẢ LÔ, không xoá lén dòng hợp lệ', sc2.s === 403 && stillAll === 3, `http=${sc2.s} còn=${stillAll}/3`)
      }
    }
    r = await api('/external/do-sap/bulk-delete', 'POST', { ids: [`${T}-A`, `${T}-B`, `${T}-C`] })
    const left = (await restAll('erp_outbound_orders', `select=id&od_number=eq.${T}DO1`)).length
    check('[12g] Admin xoá thật 3 dòng → deleted=3 + DB sạch', r.s === 200 && r.j?.data?.deleted === 3 && left === 0, `http=${r.s} deleted=${r.j?.data?.deleted} còn=${left}`)
  }

  // ═══ [13] POST /wms/vision-config/test ══════════════════════════════════════
  {
    const r = await api('/wms/vision-config/test', 'POST', {})
    check('[13a] Admin bấm thử khoá AI → 200 (có khoá) hoặc 422 (chưa cấu hình/lỗi nhà cung cấp), không 5xx', r.s === 200 || r.s === 422, `http=${r.s} ${err(r) || JSON.stringify(r.j?.data).slice(0, 80)}`)
    if (scoped) {
      const sc = await scoped('/wms/vision-config/test', 'POST', {})
      check('[13b] Không phải superadmin → 403', sc.s === 403, `http=${sc.s}`)
    }
  }

  // ═══ [14] Cổng ERP /integration/v1/* — tự cấp khoá rồi thu hồi ══════════════
  {
    const ck = await api('/wms/integration-keys', 'POST', { name: `${T} key`, scopes: ['materials:read', 'inventory:read', 'inbound:read', 'outbound:read'] })
    const KEY = ck.j?.data?.key, KID = ck.j?.data?.id
    check('[14a] Cấp khoá API tạm (4 scope đọc) → 201 + trả khoá thô 1 lần', ck.s === 201 && typeof KEY === 'string' && KEY.startsWith('wms_'), `http=${ck.s} ${err(ck)}`)
    const erp = async (path, key = KEY) => {
      const r = await fetch(`${BASE}/api/integration${path}`, { headers: key ? { 'X-API-Key': key } : {} })
      let j = null; try { j = JSON.parse(await r.text()) } catch { /* */ }
      return { s: r.status, j }
    }
    if (KEY) {
      for (const [name, path] of [['materials', '/v1/materials'], ['inventory', '/v1/inventory'], ['inbound-receipts', '/v1/inbound-receipts'], ['outbound-orders', '/v1/outbound-orders']]) {
        const r = await erp(`${path}?limit=5`)
        const p = r.j?.paging
        check(`[14b] ERP kéo ${name} limit=5 → 200 + data ≤5 + paging{count,has_more,next_cursor}`, r.s === 200 && Array.isArray(r.j?.data) && r.j.data.length <= 5 && p && typeof p.has_more === 'boolean' && p.count === r.j.data.length, `http=${r.s} n=${r.j?.data?.length} has_more=${p?.has_more}`)
      }
      let r = await erp('/v1/scan-entries?limit=5')
      check('[14c] Khoá KHÔNG có scope scans:read gọi scan-entries → 403 FORBIDDEN_SCOPE', r.s === 403 && r.j?.error?.code === 'FORBIDDEN_SCOPE', `http=${r.s} ${err(r)}`)
      r = await erp('/v1/materials?limit=5', null)
      check('[14d] Không gửi khoá → 401', r.s === 401, `http=${r.s}`)
      r = await erp('/v1/materials?limit=5', 'wms_khoa_rac')
      check('[14e] Khoá rác → 401', r.s === 401, `http=${r.s}`)
      r = await erp('/v1/materials?updated_since=hom-qua')
      check('[14f] updated_since không phải ISO → 400', r.s === 400, `http=${r.s}`)
      const badCur = Buffer.from(JSON.stringify({ s: null, i: 'zzz-khong-phai-uuid' })).toString('base64url')
      r = await erp(`/v1/inventory?limit=5&cursor=${badCur}`)
      check('[14g] cursor mang id lạ → 200 rỗng hoặc 400, không "Lỗi hệ thống"', r.s === 200 || r.s === 400, `http=${r.s} ${err(r)}`)
      r = await erp('/v1/materials?limit=5&cursor=%%%khong-phai-base64')
      check('[14h] cursor không giải mã được → bỏ qua cursor, 200', r.s === 200, `http=${r.s}`)

      // ĐI QUA 2 TRANG: id tăng dần, không trùng, không hở
      const p1 = await erp('/v1/materials?limit=3')
      const p2 = p1.j?.paging?.next_cursor ? await erp(`/v1/materials?limit=3&cursor=${encodeURIComponent(p1.j.paging.next_cursor)}`) : null
      if (p2) {
        const ids1 = p1.j.data.map(x => x.id), ids2 = p2.j?.data?.map(x => x.id) ?? []
        const overlap = ids1.filter(i => ids2.includes(i)).length
        check('[14i] Lật trang bằng cursor → trang 2 không trùng trang 1 và id lớn hơn', p2.s === 200 && ids2.length > 0 && overlap === 0 && ids2[0] > ids1[ids1.length - 1], `http=${p2.s} trùng=${overlap}`)
      } else check('[14i] Lật trang bằng cursor (cần ≥4 mã hàng trong DB)', false, `has_more=${p1.j?.paging?.has_more}`)

      // TRẦN 1.000: limit=1000 mà DB còn nhiều hơn thì has_more PHẢI true
      const dbTotal = (await restAll('InventoryEntry', 'select=id', 5000)).length
      if (dbTotal > 1000) {
        const big = await erp('/v1/inventory?limit=1000')
        check(`[14j] ERP kéo tồn limit=1000 (DB có ≥${dbTotal} dòng) → has_more=TRUE, không được báo hết dữ liệu`, big.s === 200 && big.j?.paging?.has_more === true, `http=${big.s} count=${big.j?.paging?.count} has_more=${big.j?.paging?.has_more}`)
      } else console.log(`  ⏭  DB chỉ có ${dbTotal} dòng tồn — không đo được trần 1.000`)

      const rv = await api(`/wms/integration-keys/${KID}/revoke`, 'PATCH', {})
      r = await erp('/v1/materials?limit=1')
      check('[14k] Thu hồi khoá → gọi lại 401 ngay', rv.s === 200 && r.s === 401, `revoke=${rv.s} sau=${r.s}`)
      const dl = await api(`/wms/integration-keys/${KID}`, 'DELETE')
      check('[14l] Xoá hẳn khoá đã thu hồi → 200 + DB không còn', dl.s === 200 && (await restAll('ApiKey', `select=id&id=eq.${KID}`)).length === 0, `http=${dl.s}`)
    }
    if (scoped) {
      const sc = await scoped('/wms/integration-keys', 'POST', { name: `${T} len`, scopes: ['*'] })
      check('[14m] Không phải superadmin tạo khoá API → 403', sc.s === 403, `http=${sc.s}`)
    }
  }

  // ═══ [15] DELETE /tms/vehicles/:id — xoá thật một chiếc xe ══════════════════
  {
    const tc = (await restAll('TransportCompany', 'select=id&limit=1'))[0]
    const vt = (await restAll('VehicleType', 'select=id&limit=1'))[0]
    if (!tc || !vt) console.log('  ⏭  thiếu ĐVVT/loại xe nền — bỏ qua [15]')
    else {
      const cv = await api('/tms/vehicles', 'POST', { ncc_id: tc.id, license_plate: '53QA0001', vehicle_type_id: vt.id })
      const VID = cv.j?.data?.id
      check('[15a] Dựng nền: tạo xe 53QA0001', (cv.s === 201 || cv.s === 200) && !!VID, `http=${cv.s} ${err(cv)}`)
      if (VID) {
        let r = await api(`/tms/vehicles/${VID}`, 'DELETE')
        const gone = (await restAll('Vehicle', `select=id&id=eq.${VID}`)).length === 0
        check('[15b] Xoá xe → 200 + DB không còn', r.s === 200 && gone, `http=${r.s} ${err(r)} còn=${!gone}`)
        r = await api(`/tms/vehicles/${VID}`, 'DELETE')
        check('[15c] Xoá LẠI xe đã xoá → 404, không phải "đã xoá" giả', r.s === 404, `http=${r.s} ${JSON.stringify(r.j?.data ?? r.j?.error).slice(0, 60)}`)
        r = await api(`/tms/vehicles/${randomUUID()}`, 'DELETE')
        check('[15d] Xoá xe không tồn tại → 404', r.s === 404, `http=${r.s}`)
      }
    }
  }
} finally {
  await wipe()
  const left = (await restAll('Employee', `select=id&employee_code=like.${T}*`)).length
    + (await restAll('ApiKey', `select=id&name=like.${T}*`)).length
    + (await restAll('forklift_vehicles', `select=id&code=like.${T}*`)).length
    + (await restAll('erp_outbound_orders', `select=id&od_number=like.${T}*`)).length
    + (await restAll('PalletOperation', `select=id&operated_by_name=eq.${T}`)).length
  check('[dọn] 0 bản ghi QA53 sót lại', left === 0, `sót=${left}`)
}
finish('UNTOUCHED-ROUTES')
