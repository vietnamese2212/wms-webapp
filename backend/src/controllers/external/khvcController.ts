// Dữ liệu bên ngoài → tab "Kế hoạch xuất": CRUD trên bảng RAW khvc_lines (tầng 2 điều vận).
// Nguồn: upload KHVC (uploadKhvc lưu song song); tương lai plan-app/SAP. Cho sửa/xóa tay khi cần.
// Phân trang bắt buộc (bảng có thể hàng triệu dòng). Enrich per-trang: đã sinh chuyến chưa + DO đã sẵn sàng (raw).
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { safeFilterValue } from '../../utils/search'
import { fetchAllByIdChunks, fetchAllRowsParallel } from '../../utils/pagination'
import { replanKhvcGroups, looseHeldGdoIds } from '../wms/outboundController'
import { logOutboundEvents, actorOf, type OutboundEventInput } from '../../services/outboundEvents'
import { categoryAllowed } from '../../utils/categoryScope'
import { heldSlotsByVehicle, slotHeldBlockingCategory, slotHeldBlockingDate } from '../../utils/bookingGuards'

const now = () => new Date().toISOString()

// REPLAN sau CRUD (user chốt 02/08): Xuất là KẾT QUẢ DẪN XUẤT của Kế hoạch xuất — sửa/xóa/thêm dòng
// tại đây phải TỰ DỘI xuống chuyến. AUGMENT: lỗi replan không làm hỏng thao tác CRUD gốc (đã ghi raw);
// trả kèm `replan` (hoặc `replan_error`) để FE hiện kết quả.
async function replanAfterCrud(req: Request, groupCodes: string[]): Promise<{ replan?: Record<string, unknown>; replan_error?: string }> {
  try { return { replan: await replanKhvcGroups(req, groupCodes) } }
  catch (e) { console.error('[khvc replan]', e); return { replan_error: String(e) } }
}

// DO đã có dữ liệu VL06O chưa (raw, bỏ dòng OBSOLETE — dòng SAP đã bỏ thì derive cũng không dùng).
// KHÔNG còn chặn nhập (user chốt 03/08: điều vận nạp kế hoạch TRƯỚC khi có VL06O) — chỉ dùng để
// báo cho người nhập biết dòng này sẽ ra chuyến CHỜ dữ liệu.
async function doMissingInRaw(doNo: string): Promise<boolean> {
  const { data } = await supabase.from('erp_outbound_orders')
    .select('id').eq('od_number', doNo).neq('sync_status', 'OBSOLETE').limit(1)
  return !(data ?? []).length
}

// SCOPE KHO cho CRUD (fix check-app 02/08 — lỗ CŨ nhưng nặng lên khi CRUD sinh được chuyến):
// uploadKhvc gác 403 file mang Số xe kho ngoài phạm vi, còn create/update/delete từng KHÔNG gác
// → user kho A ghi được raw kế hoạch kho B (replan may mắn 403 trong processVehicleGroups nhưng
// raw đã lệch). Kho suy từ ĐOẠN ĐẦU Số xe (Mãkho_X_ddmmyy_stt) — cùng cách uploadKhvc.
// Trả chuỗi lỗi = chặn 403; null = qua. Mã kho không tồn tại → qua (validation derive sẽ báo).
async function khvcScopeError(req: Request, groupCodes: (string | null | undefined)[]): Promise<string | null> {
  if (req.user?.warehouse_scope === 'NATIONAL') return null
  const scope = req.user?.warehouse_ids ?? []
  const whCodes = [...new Set(groupCodes.map(g => String(g ?? '').split('_')[0]).filter(Boolean))]
  if (!whCodes.length) return null
  const { data } = await supabase.from('Warehouse').select('id, code').in('code', whCodes)
  const outside = whCodes.filter(c => {
    const w = ((data ?? []) as { id: string; code: string }[]).find(x => x.code === c)
    return w && !scope.includes(w.id)
  })
  return outside.length ? `Ngoài phạm vi kho — Số xe thuộc kho: ${outside.join(', ')}` : null
}

// SỬA NGÀY XUẤT phụ thuộc TÌNH TRẠNG chuyến (user chốt 02/08): chuyến ĐANG XUẤT / ĐÃ HOÀN THÀNH
// → ngày là sự thật vận hành, KHÔNG đổi từ KH (replan vốn skip chuyến bận ⇒ đổi được raw thì
// KH lệch chuyến vĩnh viễn). PENDING/PAUSED/chưa sinh chuyến → đổi tự do, replan dội xuống.
// `newDate` (tùy chọn) để gác thêm luật CẤM DỜI SANG TƯƠNG LAI khi chuyến ĐÃ BẮT ĐẦU.
// Bug thật đo 03/08: chuyến đã Bắt đầu + đã ghi nhận số, TẠM DỪNG rồi dời ngày —
//   · cửa "sửa trên đơn" (updateGDO/patchGDO): 422 FUTURE_DATE (đúng luật CLAUDE.md)
//   · cửa "Kế hoạch xuất" (updateKhvc/bulk-date): CHO QUA 200  ⇒ ĐƯỜNG LÁCH
// Lách được là tạo NGÕ CỤT: tồn đã trừ thật mà chuyến nằm ở ngày tương lai. Trạng thái PAUSED
// KHÔNG nằm trong danh sách chặn cũ nên lỗ này ẩn sau nút "Tạm dừng". Muốn hoãn sang ngày khác
// thì phải Bỏ bắt đầu (hoàn số đã ghi + trả tồn) TRƯỚC — cùng hướng dẫn với futureShiftError.
async function dateLockedGroups(groupCodes: string[], newDate?: string | null): Promise<Map<string, string>> {
  const locked = new Map<string, string>()
  const nd = newDate ? String(newDate).slice(0, 10) : null
  const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  for (let i = 0; i < groupCodes.length; i += 300) {
    const { data } = await supabase.from('GroupDeliveryOrder')
      .select('group_code, status, started_at, delivery_date')
      .in('group_code', groupCodes.slice(i, i + 300))
    for (const g of ((data ?? []) as { group_code: string; status: string; started_at: string | null; delivery_date: string | null }[])) {
      if (g.status === 'COMPLETED') {
        locked.set(g.group_code, 'Chuyến bên Xuất ĐÃ HOÀN THÀNH — ngày không đổi được nữa'); continue
      }
      if (g.status === 'IN_PROGRESS') {
        locked.set(g.group_code, 'Chuyến bên Xuất ĐANG XUẤT HÀNG — chờ hoàn thành hoặc Tạm dừng chuyến rồi mới đổi ngày'); continue
      }
      // ĐÃ BẮT ĐẦU (kể cả đang TẠM DỪNG) + dời sang TƯƠNG LAI → chặn
      if (g.started_at && nd && nd > todayVN && nd !== String(g.delivery_date ?? '').slice(0, 10)) {
        const [yy, mm, dd] = nd.split('-')
        locked.set(g.group_code, `Chuyến ĐÃ BẮT ĐẦU xuất hàng — không dời Ngày xuất sang ${dd}/${mm}/${yy} (tương lai). `
          + 'Muốn hoãn sang ngày khác: vào chuyến bấm "Bỏ bắt đầu" (hoàn số đã ghi + trả tồn về kho) rồi dời ngày; '
          + 'nếu hàng đã bốc lên xe thì Hoàn thành theo số thực xuất, phần rớt lại lên kế hoạch ngày mới.')
      }
    }
  }
  return locked
}

// Cap an toàn cho filter chéo "Trong DO SAP" (đối xứng erpOrderController): tập DO của cửa sổ đưa vào .in()
// không được quá lớn → vượt thì bỏ filter + trả cảnh báo (không cắt âm thầm). Ngày đơn lẻ luôn dưới ngưỡng.
// 800 ≈ 9KB URL. ĐO 27/07 trên PostgREST staging: 1000 giá trị 9 ký tự = 9,8KB → 200; 1300 = 12,7KB
// → đứt kết nối. Cap cũ 1500 (≈16KB) là VƯỢT NGƯỠNG — lọc rộng sẽ lỗi thay vì hiện cảnh báo.
const DOSAP_FILTER_CAP = 800

// v2.2 — luật XÓA an toàn: dòng Kế hoạch mà chuyến đã sinh CÓ HÀNG ĐÃ QUÉT → CHẶN xóa cứng.
type KDelRow = { id: string; group_code: string }
async function classifyKhvcDelete(rows: KDelRow[]): Promise<{ deletable: KDelRow[]; blocked: (KDelRow & { reason: string })[] }> {
  const gcs = [...new Set(rows.map(r => r.group_code))]
  const scannedGcs = new Set<string>()
  // CẤM xóa kế hoạch của chuyến ĐÃ HOÀN THÀNH / ĐANG XUẤT (user chốt 03/08: "user xóa đi các đơn hàng
  // Kế hoạch xuất mà bên Xuất đã hoàn thành — việc này là không được phép"). Chuyến đã xuất là CHỨNG TỪ:
  // xóa nguồn của nó làm mất đường đối chiếu SAP↔thực xuất. Chặn theo TRẠNG THÁI, không chỉ theo "đã quét"
  // (chuyến hoàn thành với 0 thùng quét vẫn là chuyến đã chốt).
  const lockedGcs = new Map<string, string>()
  for (let i = 0; i < gcs.length; i += 300) {
    const { data } = await supabase.from('GroupDeliveryOrder').select('group_code, status')
      .in('group_code', gcs.slice(i, i + 300)).in('status', ['IN_PROGRESS', 'COMPLETED'])
    for (const g of ((data ?? []) as { group_code: string; status: string }[]))
      lockedGcs.set(g.group_code, g.status === 'COMPLETED'
        ? 'Chuyến bên Xuất ĐÃ HOÀN THÀNH — không xóa được kế hoạch của chuyến đã xuất (muốn sửa số thì sửa DO ở tab DO SAP)'
        : 'Chuyến bên Xuất ĐANG XUẤT HÀNG — chờ hoàn thành hoặc Tạm dừng chuyến rồi mới sửa kế hoạch')
  }
  // Chuyến đang GIỮ HÀNG NHẶT LẺ (soạn — hàng vật lý đã rời pallet xuống vị trí chờ, user chốt
  // 05/08): chặn xóa kế hoạch, user gỡ trả hàng nhặt lẻ trên chuyến trước rồi mới được xóa.
  const looseGcs = new Set<string>()
  for (let i = 0; i < gcs.length; i += 100) {
    const { data: gdos } = await supabase.from('GroupDeliveryOrder').select('id, group_code').in('group_code', gcs.slice(i, i + 100))
    const gcByGdoId = new Map((gdos ?? []).map((g: { id: string; group_code: string }) => [g.id, g.group_code]))
    const gdoIds = (gdos ?? []).map((g: { id: string }) => g.id)
    if (!gdoIds.length) continue
    const { data: dvs } = await supabase.from('OutboundDelivery').select('id, gdo_id').in('gdo_id', gdoIds)
    const gcByDo = new Map<string, string>()
    for (const d of ((dvs ?? []) as { id: string; gdo_id: string }[])) { const gc = gcByGdoId.get(d.gdo_id); if (gc) gcByDo.set(d.id, gc) }
    const doIds = (dvs ?? []).map((d: { id: string }) => d.id)
    if (doIds.length) {
      const its = await fetchAllByIdChunks(doIds, c => supabase.from('OutboundItem').select('do_id, cartons_scanned').in('do_id', c).order('id')) as { do_id: string; cartons_scanned: number }[]
      for (const it of (its ?? [])) if (Number(it.cartons_scanned) > 0) { const gc = gcByDo.get(it.do_id); if (gc) scannedGcs.add(gc) }
    }
    const held = await looseHeldGdoIds(gdoIds)
    for (const gid of held) { const gc = gcByGdoId.get(gid); if (gc) looseGcs.add(gc) }
  }
  const deletable: KDelRow[] = [], blocked: (KDelRow & { reason: string })[] = []
  for (const r of rows) {
    const lockMsg = lockedGcs.get(r.group_code)
    if (lockMsg) blocked.push({ ...r, reason: lockMsg })
    else if (looseGcs.has(r.group_code)) blocked.push({ ...r, reason: 'Chuyến đang GIỮ HÀNG NHẶT LẺ ở vị trí chờ — gỡ trả hàng nhặt lẻ trên chuyến rồi mới xóa kế hoạch' })
    else if (scannedGcs.has(r.group_code)) blocked.push({ ...r, reason: 'Chuyến đã có hàng đã quét — không xóa cứng' })
    else deletable.push(r)
  }
  return { deletable, blocked }
}

const STR_FIELDS = [
  'group_code', 'do_no', 'warehouse_code', 'npp', 'veh_type', 'dvvt',
  'priority', 'cs', 'note', 'source', 'sync_status', 'booking_category',
] as const

// ── LOẠI KHO BOOKING (cửa đặt lịch) — luật khoá cứng user chốt 03/08 ─────────────────────────
// 1 Số xe CHỈ 1 giá trị. Trigger DB `khvc_booking_category_uniform` là lá chắn cuối; ở đây gác sớm
// để trả lỗi tiếng Việt rõ ràng + ÉP theo xe (thêm dòng vào xe đã có cửa thì theo cửa đó, y hệt
// cách Ngày xuất đã làm — 1 xe vật lý 1 ngày, 1 xe 1 cửa).
async function resolveBookingCategory(req: Request, raw: unknown): Promise<{ value: string } | { error: string; status: number }> {
  const v = String(raw ?? '').trim()
  if (!v) return { error: 'Thiếu "Loại kho booking" — cửa đặt lịch là bắt buộc (1 Số xe chỉ 1 loại)', status: 400 }
  const { data } = await supabase.from('LookupValue').select('value').eq('type', 'warehouse_type')
  const byUpper = new Map(((data ?? []) as { value: string }[]).map(x => [String(x.value).trim().toUpperCase(), String(x.value).trim()]))
  const hit = byUpper.get(v.toUpperCase())
  if (!hit) return { error: `Loại kho booking "${v}" không có trong danh mục (hợp lệ: ${[...byUpper.values()].join(', ')})`, status: 400 }
  if (!categoryAllowed(req, hit)) return { error: `Loại kho booking "${hit}" ngoài phạm vi loại kho của bạn`, status: 403 }
  return { value: hit }
}

// Xe ĐANG GIỮ khung giờ của cửa CŨ thì không cho đổi cửa âm thầm: đổi xong khung đang giữ thuộc
// cửa khác = dữ liệu tự mâu thuẫn. Bắt nhả khung trước (KHÔNG tự nhả hộ — mất chỗ âm thầm còn tệ hơn).
// Luật + cách đo nằm ở `utils/bookingGuards` (dùng chung với gác ĐỔI NGÀY — cùng một họ lỗi).
async function bookedSlotBlockingCategory(groupCode: string, newCat: string): Promise<string | null> {
  return slotHeldBlockingCategory((await heldSlotsByVehicle([groupCode])).get(groupCode), newCat)
}

// Đổi NGÀY xuất khi xe đang giữ khung giờ của NGÀY KHÁC → chặn per-xe (trả Map gc→lý do).
async function dateBlockedByHeldSlot(groupCodes: string[], newDate: string): Promise<Map<string, string>> {
  const held = await heldSlotsByVehicle(groupCodes)
  const out = new Map<string, string>()
  for (const gc of groupCodes) {
    const msg = slotHeldBlockingDate(held.get(gc), newDate)
    if (msg) out.set(gc, msg)
  }
  return out
}

function pickFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of STR_FIELDS) if (f in body) { const v = body[f]; out[f] = v == null || v === '' ? null : String(v).trim() }
  if ('export_date' in body) { const v = body.export_date; out.export_date = v == null || v === '' ? null : String(v) }
  return out
}

// GET /external/khvc — list phân trang + filter + search (+ in_do_sap)
export async function listKhvc(req: Request, res: Response) {
  try {
    const { q, group_code, group_code_eq, do_no, warehouse_code, veh_type, source, sync_status, date_from, date_to, export_from, export_to, in_do_sap, gdo_issue } = req.query as Record<string, string>
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50))
    const s = q && q.trim() ? safeFilterValue(q.trim()) : ''
    const gteFrom = date_from ? new Date(`${date_from}T00:00:00+07:00`).toISOString() : ''
    const lteTo   = date_to   ? new Date(`${date_to}T23:59:59.999+07:00`).toISOString() : ''
    // Ngày XUẤT (export_date) = cột date-only, so thẳng chuỗi YYYY-MM-DD — KHÁC "Ngày nạp" (created_at,
    // timestamp UTC phải quy giờ VN). Điều vận tìm theo ngày xe chạy chứ không theo ngày up file.
    const expFrom = /^\d{4}-\d{2}-\d{2}$/.test(export_from ?? '') ? export_from : ''
    const expTo   = /^\d{4}-\d{2}-\d{2}$/.test(export_to ?? '')   ? export_to   : ''

    // ── Filter chéo "Trong DO SAP" (in_do_sap: '1'=có / '0'=không) ──
    // DO của cửa sổ đang xem CÓ/KHÔNG có trong erp_outbound_orders (raw VL06O, bất kể ngày nạp).
    // Scalable: chỉ lấy tập DO CỦA CỬA SỔ (đã date-gate) rồi hỏi raw — KHÔNG kéo cả bảng raw.
    let restrictDos: string[] | null = null
    let doSapWarning: string | null = null
    if (in_do_sap === '1' || in_do_sap === '0') {
      const winRows = await fetchAllRowsParallel(() => {
        // Bộ lọc inline (KHÔNG tách helper generic — builder supabase deep-instantiate → TS2589)
        let wq = supabase.from('khvc_lines').select('do_no')
        if (gteFrom) wq = wq.gte('created_at', gteFrom)
        if (lteTo)   wq = wq.lte('created_at', lteTo)
        if (expFrom) wq = wq.gte('export_date', expFrom)
        if (expTo)   wq = wq.lte('export_date', expTo)
        if (group_code)     wq = wq.ilike('group_code', `%${safeFilterValue(group_code)}%`)
        if (do_no)          wq = wq.ilike('do_no', `%${safeFilterValue(do_no)}%`)
        if (warehouse_code) wq = wq.eq('warehouse_code', warehouse_code)
        if (veh_type)       wq = wq.eq('veh_type', veh_type)
        if (source)         wq = wq.eq('source', source)
        if (sync_status)    wq = wq.eq('sync_status', sync_status)
        if (s) wq = wq.or(`group_code.ilike.%${s}%,do_no.ilike.%${s}%,npp.ilike.%${s}%,note.ilike.%${s}%`)
        return wq.order('do_no')
      }) as { do_no: string }[]
      const windowDos = [...new Set(winRows.map(r => String(r.do_no ?? '')).filter(Boolean))]
      const present = new Set<string>()
      // LỌC OBSOLETE: DO mà SAP đã bỏ hết dòng thì derive coi như CHƯA CÓ — cột/bộ lọc phải nói
      // cùng một sự thật với engine, không thì user thấy "có DO" mà chuyến vẫn chờ dữ liệu.
      // Chunk 300 là để không vượt trần URL, nhưng CHƯA đủ: mỗi chunk vẫn có thể trả >1000 DÒNG
      // (1 DO nhiều mã hàng) nên phải phân trang TRONG chunk — fetchAllByIdChunks làm cả hai.
      // Thiếu bước này thì bộ lọc "Trong DO SAP" phân loại sai đúng như cột badge (bug 03/08).
      const rawsWin = await fetchAllByIdChunks(windowDos, chunk => supabase.from('erp_outbound_orders')
        .select('od_number').in('od_number', chunk).neq('sync_status', 'OBSOLETE').order('od_number'))
      for (const r of (rawsWin ?? []) as { od_number: string }[]) present.add(String(r.od_number))
      restrictDos = in_do_sap === '1' ? windowDos.filter(d => present.has(d)) : windowDos.filter(d => !present.has(d))
      if (restrictDos.length > DOSAP_FILTER_CAP) {
        doSapWarning = `Khoảng ngày quá rộng để lọc theo DO SAP (${restrictDos.length} DO) — thu hẹp Ngày nạp rồi lọc lại.`
        restrictDos = null
      } else if (restrictDos.length === 0) {
        return ok(res, { items: [], total: 0, page, page_size: pageSize, do_sap_filter_warning: doSapWarning ?? undefined })
      }
    }

    // ── Filter "Lệch với Xuất" (gdo_issue: 'missing' = không còn chuyến / 'date_mismatch' = ngày chuyến ≠ Ngày xuất KH) ──
    // Cùng pattern window+cap như in_do_sap: lấy tập Số xe CỦA CỬA SỔ rồi hỏi GroupDeliveryOrder — không kéo cả bảng.
    // Restrict theo group_code (vấn đề là cấp CHUYẾN); lệch ngày so per-xe (mọi dòng cùng xe chung Ngày xuất).
    let restrictGcs: string[] | null = null
    let gdoIssueWarning: string | null = null
    if (gdo_issue === 'missing' || gdo_issue === 'date_mismatch') {
      const winRows = await fetchAllRowsParallel(() => {
        let wq = supabase.from('khvc_lines').select('group_code, export_date')
        if (gteFrom) wq = wq.gte('created_at', gteFrom)
        if (lteTo)   wq = wq.lte('created_at', lteTo)
        if (expFrom) wq = wq.gte('export_date', expFrom)
        if (expTo)   wq = wq.lte('export_date', expTo)
        if (group_code)     wq = wq.ilike('group_code', `%${safeFilterValue(group_code)}%`)
        if (do_no)          wq = wq.ilike('do_no', `%${safeFilterValue(do_no)}%`)
        if (warehouse_code) wq = wq.eq('warehouse_code', warehouse_code)
        if (veh_type)       wq = wq.eq('veh_type', veh_type)
        if (source)         wq = wq.eq('source', source)
        if (sync_status)    wq = wq.eq('sync_status', sync_status)
        if (s) wq = wq.or(`group_code.ilike.%${s}%,do_no.ilike.%${s}%,npp.ilike.%${s}%,note.ilike.%${s}%`)
        if (restrictDos) wq = wq.in('do_no', restrictDos)
        return wq.order('group_code')
      }) as { group_code: string | null; export_date: string | null }[]
      const dateByGc = new Map<string, string | null>()
      for (const r of winRows) { const gc = String(r.group_code ?? ''); if (gc && !dateByGc.has(gc)) dateByGc.set(gc, r.export_date ?? null) }
      const winGcs = [...dateByGc.keys()]
      const gdoDateByGc = new Map<string, string | null>()
      for (let i = 0; i < winGcs.length; i += 300) {
        const { data: gdos } = await supabase.from('GroupDeliveryOrder').select('group_code, delivery_date').in('group_code', winGcs.slice(i, i + 300))
        for (const g of (gdos ?? []) as { group_code: string; delivery_date: string | null }[])
          if (!gdoDateByGc.has(g.group_code)) gdoDateByGc.set(g.group_code, g.delivery_date)
      }
      restrictGcs = winGcs.filter(gc => gdo_issue === 'missing'
        ? !gdoDateByGc.has(gc)
        : gdoDateByGc.has(gc) && String(gdoDateByGc.get(gc) ?? '') !== String(dateByGc.get(gc) ?? ''))
      if (restrictGcs.length > DOSAP_FILTER_CAP) {
        gdoIssueWarning = `Khoảng ngày quá rộng để lọc Lệch với Xuất (${restrictGcs.length} Số xe) — thu hẹp Ngày nạp rồi lọc lại.`
        restrictGcs = null
      } else if (restrictGcs.length === 0) {
        return ok(res, { items: [], total: 0, page, page_size: pageSize, do_sap_filter_warning: doSapWarning ?? undefined, gdo_issue_warning: gdoIssueWarning ?? undefined })
      }
    }

    let query = supabase.from('khvc_lines').select('*', { count: 'exact' })
    if (gteFrom) query = query.gte('created_at', gteFrom)
    if (lteTo)   query = query.lte('created_at', lteTo)
    if (expFrom) query = query.gte('export_date', expFrom)
    if (expTo)   query = query.lte('export_date', expTo)
    if (group_code)     query = query.ilike('group_code', `%${safeFilterValue(group_code)}%`)
    if (group_code_eq)  query = query.eq('group_code', group_code_eq)   // editor gom theo Số xe — khớp CHÍNH XÁC
    if (do_no)          query = query.ilike('do_no', `%${safeFilterValue(do_no)}%`)
    if (warehouse_code) query = query.eq('warehouse_code', warehouse_code)
    if (veh_type)       query = query.eq('veh_type', veh_type)
    if (source)         query = query.eq('source', source)
    if (sync_status)    query = query.eq('sync_status', sync_status)
    if (s) query = query.or(`group_code.ilike.%${s}%,do_no.ilike.%${s}%,npp.ilike.%${s}%,note.ilike.%${s}%`)
    if (restrictDos) query = query.in('do_no', restrictDos)
    if (restrictGcs) query = query.in('group_code', restrictGcs)
    query = query.order('group_code', { ascending: true }).order('do_no', { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1)

    const { data, count, error } = await query
    if (error) throw new Error(error.message)
    const items = (data ?? []) as Record<string, unknown>[]

    // Enrich per-dòng của TRANG (bounded ≤ pageSize):
    // (a) chuyến đã sinh chưa (khớp group_code với GroupDeliveryOrder) + trạng thái chuyến
    const gcs = [...new Set(items.map(i => String(i.group_code ?? '')).filter(Boolean))]
    const gdoByGc = new Map<string, { status: string; delivery_date: string | null }>()
    if (gcs.length) {
      const { data: gdos } = await supabase.from('GroupDeliveryOrder').select('group_code, status, delivery_date').in('group_code', gcs)
      for (const g of (gdos ?? []) as { group_code: string; status: string; delivery_date: string | null }[])
        if (!gdoByGc.has(g.group_code)) gdoByGc.set(g.group_code, { status: g.status, delivery_date: g.delivery_date })
    }
    // (b) DO đã sẵn sàng trong raw (VL06O) chưa — B4a: kế hoạch phụ thuộc DO
    const dos = [...new Set(items.map(i => String(i.do_no ?? '')).filter(Boolean))]
    const readyDos = new Set<string>()
    if (dos.length) {
      // PHẢI phân trang (fetchAllByIdChunks = chunk 300 + range-loop). 1 DO có NHIỀU dòng VL06O
      // (mỗi mã hàng 1 dòng) nên 200 DO của 1 trang đã cho ~1.000+ dòng ⇒ query trần bị cap ~1000
      // CẮT ÂM THẦM và những DO rơi vào phần bị cắt hiện sai thành "DO chưa có" (bug thật user báo
      // 03/08: đo được 200 DO → 1.047 dòng, mất 47 dòng, dù 200/200 DO đều có trong VL06O).
      // dòng SAP đã bỏ (OBSOLETE) = coi như chưa có, khớp engine derive.
      const raws = await fetchAllByIdChunks(dos, chunk => supabase.from('erp_outbound_orders')
        .select('od_number').in('od_number', chunk).neq('sync_status', 'OBSOLETE').order('od_number'))
      for (const r of (raws ?? []) as { od_number: string }[]) readyDos.add(String(r.od_number))
    }
    for (const i of items) {
      const gc = String(i.group_code ?? '')
      const g = gdoByGc.get(gc)
      i.materialized = gdoByGc.has(gc)
      i.gdo_status = g?.status ?? null
      i.gdo_date = g?.delivery_date ?? null   // ngày chuyến bên Xuất — FE so với export_date để báo lệch
      i.do_ready = readyDos.has(String(i.do_no ?? ''))
    }
    return ok(res, { items, total: count ?? 0, page, page_size: pageSize, do_sap_filter_warning: doSapWarning ?? undefined, gdo_issue_warning: gdoIssueWarning ?? undefined })
  } catch (e) { return fail(res, String(e)) }
}

// GET /external/khvc/facets — giá trị lọc
export async function khvcFacets(_req: Request, res: Response) {
  try {
    // Phân trang né cap-1000: .limit(5000) KHÔNG vượt cap PostgREST (~1000) → facet thiếu giá trị khi bảng >1000 dòng
    const data = await fetchAllRowsParallel(() => supabase.from('khvc_lines').select('warehouse_code, veh_type, source, npp').order('id'))
    const warehouses = [...new Set((data ?? []).map(r => r.warehouse_code).filter(Boolean))].sort()
    const vehTypes = [...new Set((data ?? []).map(r => r.veh_type).filter(Boolean))].sort()
    const sources = [...new Set((data ?? []).map(r => r.source).filter(Boolean))].sort()
    const npps = [...new Set((data ?? []).map(r => r.npp).filter(Boolean))].sort()
    return ok(res, { warehouses, veh_types: vehTypes, sources, npps })
  } catch (e) { return fail(res, String(e)) }
}

// POST /external/khvc — thêm tay 1 dòng
export async function createKhvc(req: Request, res: Response) {
  try {
    const fields = pickFields(req.body as Record<string, unknown>)
    if (!fields.group_code || !fields.do_no) return fail(res, 'Thiếu Số xe hoặc DO', 400)
    const scopeErr = await khvcScopeError(req, [String(fields.group_code)])
    if (scopeErr) return fail(res, scopeErr, 403)
    const { data: dup } = await supabase.from('khvc_lines').select('id')
      .eq('group_code', fields.group_code).eq('do_no', fields.do_no).maybeSingle()
    if (dup) return fail(res, `Đã tồn tại dòng Số xe ${fields.group_code} / DO ${fields.do_no}`, 409)
    const awaitingData = await doMissingInRaw(String(fields.do_no))   // chỉ để BÁO, không chặn
    // NGÀY XUẤT LÀ THUỘC TÍNH CẤP XE (1 xe vật lý chạy 1 ngày): thêm DO vào xe ĐÃ CÓ thì phải theo
    // ngày của xe. Không ép thì xe mang 2 ngày và ngày chuyến phụ thuộc dòng nào đứng đầu — probe
    // 02/08 C1 tái hiện được. Muốn đổi ngày cả xe: dùng "Đổi ngày" (bulk-date) / sửa dòng.
    let dateForcedTo: string | null = null
    let bookingCatForcedTo: string | null = null
    {
      // Lấy dòng ĐÃ CHỐT CỬA làm mẫu (nullsFirst:false). Xe di sản có dòng cửa NULL lẫn dòng có cửa
      // (sau migration, MỌI dòng cũ đều NULL cho tới khi ai đó khai): bốc đúng dòng NULL thì code
      // tưởng "xe chưa có cửa" → cho khai cửa khác → trigger DB chặn 23514 → user ăn 500 vô cớ.
      const { data: sib } = await supabase.from('khvc_lines').select('export_date, booking_category')
        .eq('group_code', fields.group_code).neq('sync_status', 'OBSOLETE')
        .order('booking_category', { nullsFirst: false }).limit(1).maybeSingle()
      const sibRow = sib as { export_date?: string | null; booking_category?: string | null } | null
      const xeDate = sibRow?.export_date ?? null
      if (sib && String(xeDate ?? '') !== String(fields.export_date ?? '')) {
        fields.export_date = xeDate
        dateForcedTo = xeDate
      }
      // CỬA cũng là thuộc tính CẤP XE: thêm DO vào xe đã có cửa → theo cửa đó, không cho khai lệch
      const xeCat = sibRow?.booking_category ?? null
      if (xeCat) {
        if (String(fields.booking_category ?? '') !== xeCat) bookingCatForcedTo = xeCat
        fields.booking_category = xeCat
      } else {
        const bc = await resolveBookingCategory(req, fields.booking_category)
        if ('error' in bc) return fail(res, bc.error, bc.status)
        fields.booking_category = bc.value
      }
      // ĐƯỜNG "NHẬN NUÔI" (probe 04/08): Số xe này có thể ĐÃ có lệnh vận chuyển tạo tay và ĐÃ đặt
      // khung giờ TRƯỚC khi kế hoạch khai cửa. Dòng kế hoạch đầu tiên khai cửa khác ⇒ lệnh bị
      // syncTmsPlanFromKhvc đóng dấu cửa mới trong khi vẫn đậu khung của cửa cũ — đúng trạng thái mà
      // luật "đổi cửa" đang chặn ở updateKhvc, chỉ khác là lọt qua cửa TẠO. Gác cùng ngữ nghĩa.
      const heldErr = await bookedSlotBlockingCategory(String(fields.group_code), String(fields.booking_category))
      if (heldErr) return fail(res, 422, 'BOOKING_CATEGORY_SLOT_HELD', heldErr)
    }
    const row = {
      id: randomUUID(), ...fields,
      warehouse_code: fields.warehouse_code ?? String(fields.group_code).split('_')[0] ?? null,
      source: fields.source ?? 'MANUAL', sync_status: fields.sync_status ?? 'ACTIVE',
      uploaded_by: req.user?.name ?? null, updated_at: now(), manual_edited_at: now(),
    }
    const { data, error } = await supabase.from('khvc_lines').insert(row).select().single()
    if (error) throw new Error(error.message)
    await logOutboundEvents([{
      group_code: String(fields.group_code), event_type: 'PLAN_DO_ADDED', source: 'PLAN', actor: actorOf(req),
      do_number: String(fields.do_no), new_value: String(fields.export_date ?? ''),
      detail: `Thêm DO ${fields.do_no} vào Số xe ${fields.group_code}${awaitingData ? ' (DO chưa có dữ liệu VL06O — chuyến sẽ chờ)' : ''}`,
    }])
    const extra = await replanAfterCrud(req, [String(fields.group_code)])
    return ok(res, { ...(data as Record<string, unknown>), ...extra, ...(awaitingData ? { awaiting_sap: true } : {}), ...(dateForcedTo !== null ? { date_forced_to: dateForcedTo } : {}), ...(bookingCatForcedTo !== null ? { booking_category_forced_to: bookingCatForcedTo } : {}) }, 201)
  } catch (e) { return fail(res, String(e)) }
}

// PUT /external/khvc/:id — sửa tay
export async function updateKhvc(req: Request, res: Response) {
  try {
    const fields = pickFields(req.body as Record<string, unknown>)
    if (!Object.keys(fields).length) return fail(res, 'Không có trường nào để cập nhật', 400)
    // Group_code CŨ cần cho replan (đổi Số xe = chuyến cũ mất 1 dòng + chuyến mới thêm 1 dòng — dội CẢ HAI)
    const { data: cur } = await supabase.from('khvc_lines').select('group_code, do_no, export_date, booking_category').eq('id', req.params.id).maybeSingle()
    if (!cur) return fail(res, 'Không tìm thấy dòng', 404)
    // Scope kho: gác CẢ dòng đang sửa (kho cũ) lẫn Số xe mới (kho đích nếu đổi xe)
    const scopeErr = await khvcScopeError(req, [String(cur.group_code ?? ''), String(fields.group_code ?? '')])
    if (scopeErr) return fail(res, scopeErr, 403)
    // ĐO THAY ĐỔI BẰNG GIÁ TRỊ, KHÔNG BẰNG "key có mặt trong body" (bug 04/08 — xem chú thích dưới):
    // FE gửi NGUYÊN dòng mỗi lần lưu, nên `'x' in fields` luôn đúng và mọi nhánh dựa vào nó chết lặng.
    const movingVehicle = 'group_code' in fields && String(fields.group_code ?? '') !== String(cur.group_code ?? '')
    const changingDate  = 'export_date' in fields && String(fields.export_date ?? '') !== String(cur.export_date ?? '')
    const changingCat   = 'booking_category' in fields && String(fields.booking_category ?? '') !== String(cur.booking_category ?? '')

    // Đổi Ngày xuất phụ thuộc tình trạng chuyến — gác trên xe ĐÍCH (đổi cả Số xe thì dòng theo xe mới)
    if (changingDate) {
      const targetGc = String((fields.group_code ?? cur.group_code) ?? '')
      const locked = targetGc ? await dateLockedGroups([targetGc], String(fields.export_date ?? '')) : new Map<string, string>()
      const lockMsg = locked.get(targetGc)
      if (lockMsg) return fail(res, 422, 'GDO_STATUS_LOCKED', `${lockMsg} (xe ${targetGc}).`)
      // …và trên KHUNG GIỜ đang giữ: dời ngày mà giữ nguyên khung của ngày cũ = xe chiếm chỗ ngày nó
      // không chạy, còn ngày nó chạy thì không có khung (probe 04/08 P4).
      const heldMsg = targetGc ? (await dateBlockedByHeldSlot([targetGc], String(fields.export_date ?? ''))).get(targetGc) : null
      if (heldMsg) return fail(res, 422, 'BOOKING_SLOT_HELD_DATE', `${heldMsg} (xe ${targetGc}).`)
    }
    // ĐỔI CỬA đặt lịch: validate danh mục + scope, và chặn nếu xe đang giữ khung giờ của cửa cũ
    if (changingCat) {
      const bc = await resolveBookingCategory(req, fields.booking_category)
      if ('error' in bc) return fail(res, bc.error, bc.status)
      fields.booking_category = bc.value
      const targetGc = String((fields.group_code ?? cur.group_code) ?? '')
      const blocking = targetGc ? await bookedSlotBlockingCategory(targetGc, bc.value) : null
      if (blocking) return fail(res, 422, 'BOOKING_CATEGORY_SLOT_HELD', blocking)
    }
    if ('group_code' in fields || 'do_no' in fields) {
      const gc = (fields.group_code ?? cur?.group_code) as string | null
      const dn = (fields.do_no ?? cur?.do_no) as string | null
      if (gc && dn) {
        const { data: dup } = await supabase.from('khvc_lines').select('id')
          .eq('group_code', gc).eq('do_no', dn).neq('id', req.params.id).maybeSingle()
        if (dup) return fail(res, `Đã tồn tại dòng Số xe ${gc} / DO ${dn}`, 409)
      }
    }
    // CHUYỂN dòng sang xe KHÁC → dòng phải mang ngày của xe ĐÍCH (1 xe 1 ngày). Không ép thì xe đích
    // mang 2 ngày y hệt lỗi thêm-dòng (probe 02/08 C1). Không áp khi cùng lượt chỉ định export_date mới.
    let dateForcedTo: string | null = null
    let bookingCatForcedTo: string | null = null
    if (movingVehicle) {
      const { data: sib } = await supabase.from('khvc_lines').select('export_date, booking_category')
        .eq('group_code', String(fields.group_code ?? '')).neq('id', req.params.id)
        .neq('sync_status', 'OBSOLETE')
        .order('booking_category', { nullsFirst: false })    // ưu tiên dòng ĐÃ chốt cửa (xem chú thích ở createKhvc)
        .limit(1).maybeSingle()
      const sibRow = sib as { export_date?: string | null; booking_category?: string | null } | null
      const xeDate = sibRow?.export_date ?? null
      if (sib && !changingDate && String(xeDate ?? '') !== String(cur.export_date ?? '')) {
        fields.export_date = xeDate
        dateForcedTo = xeDate
      }
      // Dòng chuyển sang xe khác thì mang CỬA của xe đích (1 xe 1 cửa) — không thì trigger DB chặn
      const xeCat = sibRow?.booking_category ?? null
      if (xeCat && String(fields.booking_category ?? cur.booking_category ?? '') !== xeCat) {
        fields.booking_category = xeCat
        bookingCatForcedTo = xeCat
      }
    }
    // ⚠ CỬA phải ghi CẢ XE trong MỘT câu và ghi TRƯỚC câu sửa dòng lẻ. Sửa dòng lẻ trước rồi mới
    // đồng bộ (như export_date đang làm) sẽ tạo trạng thái LỆCH giữa 2 câu — mà 2 câu này là 2
    // TRANSACTION riêng qua PostgREST nên trigger `khvc_booking_category_uniform` chặn ngay câu đầu
    // (đo thật 03/08: PUT trả 500). DEFERRABLE không cứu được vì lệch đã COMMIT ở transaction 1.
    let bookingCatSynced = 0
    if (changingCat && !movingVehicle) {
      const { data: synced, error: syncErr } = await supabase.from('khvc_lines')
        .update({ booking_category: (fields.booking_category ?? null) as string | null, updated_at: now() })
        .eq('group_code', String(cur.group_code ?? '')).neq('sync_status', 'OBSOLETE').select('id')
      if (syncErr) throw new Error(syncErr.message)
      bookingCatSynced = Math.max(0, (synced ?? []).length - 1)   // trừ chính dòng đang sửa
    }
    const { data, error } = await supabase.from('khvc_lines')
      .update({ ...fields, uploaded_by: req.user?.name ?? null, updated_at: now(), manual_edited_at: now() })
      .eq('id', req.params.id).select().maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return fail(res, 'Không tìm thấy dòng', 404)
    // NGÀY XUẤT là thuộc tính CẤP XE lưu per-dòng (1 xe vật lý chạy 1 ngày; chuyến lấy ngày dòng đầu):
    // đổi ngày 1 dòng → ĐỒNG BỘ mọi dòng còn sống của xe, không thì xe mang 2 ngày + ngày chuyến
    // phụ thuộc dòng nào đứng đầu (hớ thật khi xe hoãn sang ngày khác mà điều vận chỉ sửa 1 dòng).
    // Không đồng bộ khi cùng lượt đổi cả Số xe (dòng chuyển sang xe khác thì theo ngày xe ĐÍCH).
    let dateSynced = 0
    if (changingDate && !movingVehicle) {
      const { data: synced } = await supabase.from('khvc_lines')
        .update({ export_date: (fields.export_date ?? null) as string | null, updated_at: now() })
        .eq('group_code', String((data as { group_code?: string }).group_code ?? ''))
        .neq('id', req.params.id).neq('sync_status', 'OBSOLETE').select('id')
      dateSynced = (synced ?? []).length
    }
    // (CỬA đặt lịch đã đồng bộ CẢ XE ở TRÊN — phải ghi trước câu sửa dòng lẻ, xem chú thích ở đó)
    const gcs = [...new Set([String(cur.group_code ?? ''), String((data as { group_code?: string }).group_code ?? '')].filter(Boolean))]
    // Ghi sổ: đổi ngày / chuyển DO sang xe khác — 2 thay đổi kế hoạch hay gây thắc mắc nhất khi truy vết
    {
      const evs: OutboundEventInput[] = []
      const actor = actorOf(req)
      const newGc = String((data as { group_code?: string }).group_code ?? '')
      const doNo = String((data as { do_no?: string }).do_no ?? cur.do_no ?? '')
      if (newGc && newGc !== String(cur.group_code ?? '')) {
        evs.push({ group_code: String(cur.group_code ?? ''), event_type: 'PLAN_DO_REMOVED', source: 'PLAN', actor, do_number: doNo,
          detail: `Chuyển DO ${doNo} sang Số xe ${newGc}` })
        evs.push({ group_code: newGc, event_type: 'PLAN_DO_ADDED', source: 'PLAN', actor, do_number: doNo,
          detail: `Nhận DO ${doNo} từ Số xe ${cur.group_code}` })
      }
      if ('export_date' in fields && String(fields.export_date ?? '') !== String(cur.export_date ?? ''))
        evs.push({ group_code: newGc || String(cur.group_code ?? ''), event_type: 'PLAN_DATE_CHANGED', source: 'PLAN', actor,
          do_number: doNo, old_value: cur.export_date as string | null, new_value: fields.export_date as string | null,
          detail: `Đổi Ngày xuất: ${cur.export_date ?? '—'} → ${fields.export_date ?? '—'}${dateSynced ? ` (đồng bộ ${dateSynced} dòng cùng xe)` : ''}` })
      if ('booking_category' in fields && String(fields.booking_category ?? '') !== String(cur.booking_category ?? ''))
        evs.push({ group_code: newGc || String(cur.group_code ?? ''), event_type: 'PLAN_BOOKING_CATEGORY_CHANGED', source: 'PLAN', actor,
          do_number: doNo, old_value: (cur.booking_category ?? null) as string | null, new_value: fields.booking_category as string | null,
          detail: `Đổi Loại kho booking (cửa đặt lịch): ${cur.booking_category ?? '—'} → ${fields.booking_category ?? '—'}${bookingCatSynced ? ` (đồng bộ ${bookingCatSynced} dòng cùng xe)` : ''}` })
      await logOutboundEvents(evs)
    }
    const extra = await replanAfterCrud(req, gcs)
    return ok(res, { ...(data as Record<string, unknown>), ...extra, ...(dateSynced ? { date_synced_lines: dateSynced } : {}), ...(dateForcedTo !== null ? { date_forced_to: dateForcedTo } : {}), ...(bookingCatSynced ? { booking_category_synced_lines: bookingCatSynced } : {}), ...(bookingCatForcedTo !== null ? { booking_category_forced_to: bookingCatForcedTo } : {}) })
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /external/khvc/:id (?check=1 = chỉ kiểm, không xóa)
export async function deleteKhvc(req: Request, res: Response) {
  try {
    const { data: row } = await supabase.from('khvc_lines').select('group_code').eq('id', req.params.id).maybeSingle()
    if (!row) return fail(res, 'Không tìm thấy dòng', 404)
    const delScopeErr = await khvcScopeError(req, [String(row.group_code)])
    if (delScopeErr) return fail(res, delScopeErr, 403)
    const dr: KDelRow = { id: req.params.id, group_code: String(row.group_code) }
    const { deletable, blocked } = await classifyKhvcDelete([dr])
    if (req.query.check === '1') return ok(res, { deletable: deletable.map(d => d.id), blocked })
    if (!deletable.length) return fail(res, blocked[0]?.reason ?? 'Không xóa được dòng này', 409)
    const { data: full } = await supabase.from('khvc_lines').select('do_no').eq('id', req.params.id).maybeSingle()
    const { error } = await supabase.from('khvc_lines').delete().eq('id', req.params.id)
    if (error) throw new Error(error.message)
    await logOutboundEvents([{
      group_code: dr.group_code, event_type: 'PLAN_DO_REMOVED', source: 'PLAN', actor: actorOf(req),
      do_number: (full as { do_no?: string } | null)?.do_no ?? null,
      detail: `Xóa DO ${(full as { do_no?: string } | null)?.do_no ?? ''} khỏi Số xe ${dr.group_code}`,
    }])
    const extra = await replanAfterCrud(req, [dr.group_code])
    return ok(res, { deleted: 1, blocked, ...extra })
  } catch (e) { return fail(res, String(e)) }
}

// POST /external/khvc/bulk-date { ids, export_date } — ĐỔI NGÀY XUẤT HÀNG LOẠT (user chốt 02/08:
// "cần có nút sửa ngày xuất hàng loạt, phụ thuộc tình trạng đơn bên Xuất mà cho sửa hay không").
// Đơn vị đổi = CẢ XE (mọi dòng sống của group_code — 1 xe chạy 1 ngày), tick dòng nào cũng tính theo xe đó.
// Xe có chuyến ĐANG XUẤT/ĐÃ HOÀN THÀNH → bị chặn per-xe (trả blocked, các xe còn lại vẫn đổi).
export async function bulkDateKhvc(req: Request, res: Response) {
  try {
    const { ids, export_date } = req.body as { ids?: string[]; export_date?: string }
    if (!Array.isArray(ids) || !ids.length) return fail(res, 'Không có dòng nào được chọn', 400)
    if (!export_date || !/^\d{4}-\d{2}-\d{2}$/.test(export_date)) return fail(res, 'Ngày xuất không hợp lệ (YYYY-MM-DD)', 400)
    const gcSet = new Set<string>()
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase.from('khvc_lines').select('group_code').in('id', ids.slice(i, i + 300))
      for (const r of ((data ?? []) as { group_code: string | null }[])) if (r.group_code) gcSet.add(String(r.group_code))
    }
    const groupCodes = [...gcSet]
    if (!groupCodes.length) return fail(res, 'Không tìm thấy dòng', 404)
    const scopeErr = await khvcScopeError(req, groupCodes)
    if (scopeErr) return fail(res, scopeErr, 403)
    const locked = await dateLockedGroups(groupCodes, export_date)
    // Xe đang GIỮ khung giờ của ngày cũ cũng bị chặn per-xe (không tự nhả hộ) — cùng ngữ nghĩa với
    // gác đổi CỬA, và khôi phục luật vốn có bên TMS ("lệnh đang giữ booking thì không đổi ngày"):
    // lệnh tự sinh bị 422 TMS_PLAN_DERIVED ở cửa TMS nên cửa này là cửa DUY NHẤT, thiếu gác = mất luật.
    const heldBlocked = await dateBlockedByHeldSlot(groupCodes.filter(g => !locked.has(g)), export_date)
    const allowed = groupCodes.filter(g => !locked.has(g) && !heldBlocked.has(g))
    const blocked = [...locked, ...heldBlocked].map(([group_code, reason]) => ({ group_code, reason }))
    let updatedLines = 0
    for (let i = 0; i < allowed.length; i += 300) {
      const { data: upd, error } = await supabase.from('khvc_lines')
        .update({ export_date, uploaded_by: req.user?.name ?? null, updated_at: now(), manual_edited_at: now() })
        .in('group_code', allowed.slice(i, i + 300)).neq('sync_status', 'OBSOLETE').select('id')
      if (error) throw new Error(error.message)
      updatedLines += (upd ?? []).length
    }
    const extra = allowed.length ? await replanAfterCrud(req, allowed) : {}
    return ok(res, { updated_groups: allowed.length, updated_lines: updatedLines, blocked, ...extra })
  } catch (e) { return fail(res, String(e)) }
}

// POST /external/khvc/bulk-delete (?check=1 = chỉ kiểm) — xóa nhiều, guard từng dòng
export async function bulkDeleteKhvc(req: Request, res: Response) {
  try {
    const ids = (req.body as { ids?: string[] })?.ids ?? []
    if (!Array.isArray(ids) || !ids.length) return fail(res, 'Không có dòng nào được chọn', 400)
    const rows: KDelRow[] = []
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase.from('khvc_lines').select('id, group_code').in('id', ids.slice(i, i + 300))
      for (const r of ((data ?? []) as KDelRow[])) rows.push({ id: r.id, group_code: String(r.group_code) })
    }
    const bulkScopeErr = await khvcScopeError(req, rows.map(r => r.group_code))
    if (bulkScopeErr) return fail(res, bulkScopeErr, 403)
    const { deletable, blocked } = await classifyKhvcDelete(rows)
    const blockedOut = blocked.map(b => ({ group_code: b.group_code, reason: b.reason }))
    if (req.query.check === '1') return ok(res, { deletable_count: deletable.length, blocked_count: blocked.length, blocked: blockedOut })
    const delIds = deletable.map(d => d.id)
    const delRows = new Map<string, string>()   // id → do_no (lấy TRƯỚC khi xóa để ghi sổ)
    for (let i = 0; i < delIds.length; i += 300) {
      const { data } = await supabase.from('khvc_lines').select('id, do_no').in('id', delIds.slice(i, i + 300))
      for (const r of ((data ?? []) as { id: string; do_no: string }[])) delRows.set(r.id, r.do_no)
    }
    for (let i = 0; i < delIds.length; i += 300) {
      const { error } = await supabase.from('khvc_lines').delete().in('id', delIds.slice(i, i + 300))
      if (error) throw new Error(error.message)
    }
    await logOutboundEvents(deletable.map(d => ({
      group_code: d.group_code, event_type: 'PLAN_DO_REMOVED', source: 'PLAN' as const, actor: actorOf(req),
      do_number: delRows.get(d.id) ?? null,
      detail: `Xóa DO ${delRows.get(d.id) ?? ''} khỏi Số xe ${d.group_code} (xóa hàng loạt)`,
    })))
    const extra = await replanAfterCrud(req, [...new Set(deletable.map(d => d.group_code))])
    return ok(res, { deleted: delIds.length, blocked_count: blocked.length, blocked: blockedOut, ...extra })
  } catch (e) { return fail(res, String(e)) }
}
