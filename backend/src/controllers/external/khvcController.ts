// Dữ liệu bên ngoài → tab "Kế hoạch xuất": CRUD trên bảng RAW khvc_lines (tầng 2 điều vận).
// Nguồn: upload KHVC (uploadKhvc lưu song song); tương lai plan-app/SAP. Cho sửa/xóa tay khi cần.
// Phân trang bắt buộc (bảng có thể hàng triệu dòng). Enrich per-trang: đã sinh chuyến chưa + DO đã sẵn sàng (raw).
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { safeFilterValue } from '../../utils/search'
import { fetchAllByIdChunks, fetchAllRowsParallel } from '../../utils/pagination'
import { replanKhvcGroups } from '../wms/outboundController'

const now = () => new Date().toISOString()

// REPLAN sau CRUD (user chốt 02/08): Xuất là KẾT QUẢ DẪN XUẤT của Kế hoạch xuất — sửa/xóa/thêm dòng
// tại đây phải TỰ DỘI xuống chuyến. AUGMENT: lỗi replan không làm hỏng thao tác CRUD gốc (đã ghi raw);
// trả kèm `replan` (hoặc `replan_error`) để FE hiện kết quả.
async function replanAfterCrud(req: Request, groupCodes: string[]): Promise<{ replan?: Record<string, unknown>; replan_error?: string }> {
  try { return { replan: await replanKhvcGroups(req, groupCodes) } }
  catch (e) { console.error('[khvc replan]', e); return { replan_error: String(e) } }
}

// DO bắt buộc có trong VL06O (raw, không OBSOLETE) — cùng luật uploadKhvc "DO LUÔN bắt buộc".
// Thiếu raw thì dòng kế hoạch không derive được chuyến → chặn ngay lúc nhập cho khỏi lệch.
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
  }
  const deletable: KDelRow[] = [], blocked: (KDelRow & { reason: string })[] = []
  for (const r of rows) {
    if (scannedGcs.has(r.group_code)) blocked.push({ ...r, reason: 'Chuyến đã có hàng đã quét — không xóa cứng' })
    else deletable.push(r)
  }
  return { deletable, blocked }
}

const STR_FIELDS = [
  'group_code', 'do_no', 'warehouse_code', 'npp', 'veh_type', 'dvvt',
  'priority', 'cs', 'note', 'source', 'sync_status',
] as const

function pickFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of STR_FIELDS) if (f in body) { const v = body[f]; out[f] = v == null || v === '' ? null : String(v).trim() }
  if ('export_date' in body) { const v = body.export_date; out.export_date = v == null || v === '' ? null : String(v) }
  return out
}

// GET /external/khvc — list phân trang + filter + search (+ in_do_sap)
export async function listKhvc(req: Request, res: Response) {
  try {
    const { q, group_code, group_code_eq, do_no, warehouse_code, veh_type, source, sync_status, date_from, date_to, in_do_sap, gdo_issue } = req.query as Record<string, string>
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50))
    const s = q && q.trim() ? safeFilterValue(q.trim()) : ''
    const gteFrom = date_from ? new Date(`${date_from}T00:00:00+07:00`).toISOString() : ''
    const lteTo   = date_to   ? new Date(`${date_to}T23:59:59.999+07:00`).toISOString() : ''

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
      for (let i = 0; i < windowDos.length; i += 300) {
        const { data } = await supabase.from('erp_outbound_orders').select('od_number').in('od_number', windowDos.slice(i, i + 300))
        for (const r of (data ?? []) as { od_number: string }[]) present.add(String(r.od_number))
      }
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
      const { data: raws } = await supabase.from('erp_outbound_orders').select('od_number').in('od_number', dos)
      for (const r of (raws ?? []) as { od_number: string }[]) readyDos.add(r.od_number)
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
    if (await doMissingInRaw(String(fields.do_no)))
      return fail(res, `DO ${fields.do_no} chưa có trong VL06O — Up VL06O trước rồi thêm dòng kế hoạch (DO luôn bắt buộc).`, 400)
    const row = {
      id: randomUUID(), ...fields,
      warehouse_code: fields.warehouse_code ?? String(fields.group_code).split('_')[0] ?? null,
      source: fields.source ?? 'MANUAL', sync_status: fields.sync_status ?? 'ACTIVE',
      uploaded_by: req.user?.name ?? null, updated_at: now(), manual_edited_at: now(),
    }
    const { data, error } = await supabase.from('khvc_lines').insert(row).select().single()
    if (error) throw new Error(error.message)
    const extra = await replanAfterCrud(req, [String(fields.group_code)])
    return ok(res, { ...(data as Record<string, unknown>), ...extra }, 201)
  } catch (e) { return fail(res, String(e)) }
}

// PUT /external/khvc/:id — sửa tay
export async function updateKhvc(req: Request, res: Response) {
  try {
    const fields = pickFields(req.body as Record<string, unknown>)
    if (!Object.keys(fields).length) return fail(res, 'Không có trường nào để cập nhật', 400)
    // Group_code CŨ cần cho replan (đổi Số xe = chuyến cũ mất 1 dòng + chuyến mới thêm 1 dòng — dội CẢ HAI)
    const { data: cur } = await supabase.from('khvc_lines').select('group_code, do_no').eq('id', req.params.id).maybeSingle()
    if (!cur) return fail(res, 'Không tìm thấy dòng', 404)
    // Scope kho: gác CẢ dòng đang sửa (kho cũ) lẫn Số xe mới (kho đích nếu đổi xe)
    const scopeErr = await khvcScopeError(req, [String(cur.group_code ?? ''), String(fields.group_code ?? '')])
    if (scopeErr) return fail(res, scopeErr, 403)
    if ('group_code' in fields || 'do_no' in fields) {
      const gc = (fields.group_code ?? cur?.group_code) as string | null
      const dn = (fields.do_no ?? cur?.do_no) as string | null
      if (gc && dn) {
        const { data: dup } = await supabase.from('khvc_lines').select('id')
          .eq('group_code', gc).eq('do_no', dn).neq('id', req.params.id).maybeSingle()
        if (dup) return fail(res, `Đã tồn tại dòng Số xe ${gc} / DO ${dn}`, 409)
      }
      if ('do_no' in fields && dn && (await doMissingInRaw(dn)))
        return fail(res, `DO ${dn} chưa có trong VL06O — Up VL06O trước (DO luôn bắt buộc).`, 400)
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
    if ('export_date' in fields && !('group_code' in fields)) {
      const { data: synced } = await supabase.from('khvc_lines')
        .update({ export_date: (fields.export_date ?? null) as string | null, updated_at: now() })
        .eq('group_code', String((data as { group_code?: string }).group_code ?? ''))
        .neq('id', req.params.id).neq('sync_status', 'OBSOLETE').select('id')
      dateSynced = (synced ?? []).length
    }
    const gcs = [...new Set([String(cur.group_code ?? ''), String((data as { group_code?: string }).group_code ?? '')].filter(Boolean))]
    const extra = await replanAfterCrud(req, gcs)
    return ok(res, { ...(data as Record<string, unknown>), ...extra, ...(dateSynced ? { date_synced_lines: dateSynced } : {}) })
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
    const { error } = await supabase.from('khvc_lines').delete().eq('id', req.params.id)
    if (error) throw new Error(error.message)
    const extra = await replanAfterCrud(req, [dr.group_code])
    return ok(res, { deleted: 1, blocked, ...extra })
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
    for (let i = 0; i < delIds.length; i += 300) {
      const { error } = await supabase.from('khvc_lines').delete().in('id', delIds.slice(i, i + 300))
      if (error) throw new Error(error.message)
    }
    const extra = await replanAfterCrud(req, [...new Set(deletable.map(d => d.group_code))])
    return ok(res, { deleted: delIds.length, blocked_count: blocked.length, blocked: blockedOut, ...extra })
  } catch (e) { return fail(res, String(e)) }
}
