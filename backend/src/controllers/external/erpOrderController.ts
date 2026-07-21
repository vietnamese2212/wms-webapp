// Dữ liệu bên ngoài → tab DO SAP: CRUD trên bảng RAW erp_outbound_orders.
// Nguồn: upload tay (VL06O) hiện tại; tương lai SAP kéo vào cùng bảng (cột source EXCEL/SAP/MANUAL).
// Cho phép sửa/xóa tay khi SAP chưa cập nhật/lỗi. Phân trang bắt buộc (bảng có thể hàng triệu dòng).
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { safeFilterValue } from '../../utils/search'
import { fetchAllRowsParallel } from '../../utils/pagination'
import { reconcileFromSap, type OdKey } from '../../services/outboundReconcile'

const now = () => new Date().toISOString()

// Cap an toàn cho filter chéo "Trong kế hoạch": số DO của cửa sổ đưa vào .in() không được quá lớn
// (URL PostgREST) → vượt thì bỏ filter + trả cảnh báo (KHÔNG cắt âm thầm). Ngày đơn lẻ luôn dưới ngưỡng.
const PLAN_FILTER_CAP = 1500

// Đối chiếu SAP↔WMS sau khi SỬA/XÓA raw tay (AUGMENT — lỗi engine KHÔNG làm hỏng thao tác CRUD raw).
async function reconcileQuiet(keys: OdKey[], actor: string | null) {
  if (!keys.length) return
  try { await reconcileFromSap(keys, { actor: actor || 'DO-SAP-EDIT' }) }
  catch (e) { console.error('[reconcileFromSap] DO SAP edit:', e) }
}

// Cột nghiệp vụ cho phép ghi tay (id/created_at do hệ thống; qty là numeric)
const NUM_FIELDS = ['qty_sales', 'qty_base', 'date_req', 'pct_date_req'] as const
const STR_FIELDS = [
  'od_number', 'od_item', 'material_code', 'material_name', 'sales_unit', 'base_unit',
  'ship_to_code', 'ship_to_name', 'plant', 'storage_location', 'batch', 'batch_so',
  'note_delivery', 'note_invoice', 'shipping_point', 'license_plate', 'source',
] as const

function pickFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of STR_FIELDS) if (f in body) { const v = body[f]; out[f] = v == null || v === '' ? null : String(v).trim() }
  for (const f of NUM_FIELDS) if (f in body) { const v = body[f]; out[f] = v == null || v === '' ? null : Number(v) }
  return out
}

// GET /external/do-sap — list phân trang + filter + search (?q, od_number, material_code, ship_to_code, plant, source, batch, in_plan, page, page_size)
export async function listDoSap(req: Request, res: Response) {
  try {
    const { q, od_number, od_number_eq, material_code, ship_to_code, plant, source, batch, date_from, date_to, in_plan } = req.query as Record<string, string>
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50))
    const s = q && q.trim() ? safeFilterValue(q.trim()) : ''
    const gteFrom = date_from ? new Date(`${date_from}T00:00:00+07:00`).toISOString() : ''
    const lteTo   = date_to   ? new Date(`${date_to}T23:59:59.999+07:00`).toISOString() : ''

    // Search bắt: DO / mã hàng / tên hàng / ship-to / batch + **SỐ XE (KH)**: tra khvc_lines group_code ~ q
    // → od_number các DO trên số xe đó (bounded — số xe cụ thể ~ vài DO; cap 300 chống URL dài). Ghép vào OR.
    let searchOr = ''
    if (s) {
      const parts = [`od_number.ilike.%${s}%`, `material_code.ilike.%${s}%`, `material_name.ilike.%${s}%`, `ship_to_name.ilike.%${s}%`, `batch.ilike.%${s}%`]
      const { data: klSearch } = await supabase.from('khvc_lines').select('do_no').ilike('group_code', `%${s}%`).limit(400)
      const planDos = [...new Set((klSearch ?? []).map(r => String((r as { do_no: string }).do_no)).filter(d => /^[\w.-]+$/.test(d)))].slice(0, 300)
      if (planDos.length) parts.push(`od_number.in.(${planDos.join(',')})`)
      searchOr = parts.join(',')
    }

    // ── Filter chéo "Trong kế hoạch" (in_plan: '1'=có / '0'=không) ──
    // Ngữ nghĩa: DO của cửa sổ đang xem CÓ/KHÔNG khớp khvc_lines.do_no (bất kể ngày nạp kế hoạch).
    // Scalable: chỉ lấy tập DO CỦA CỬA SỔ (đã date-gate) rồi hỏi khvc — KHÔNG kéo cả bảng khvc.
    let restrictOds: string[] | null = null
    let planWarning: string | null = null
    if (in_plan === '1' || in_plan === '0') {
      const winRows = await fetchAllRowsParallel(() => {
        // Bộ lọc inline (KHÔNG tách helper generic — builder supabase deep-instantiate → TS2589)
        let wq = supabase.from('erp_outbound_orders').select('od_number')
        if (gteFrom) wq = wq.gte('created_at', gteFrom)
        if (lteTo)   wq = wq.lte('created_at', lteTo)
        if (od_number)     wq = wq.ilike('od_number', `%${safeFilterValue(od_number)}%`)
        if (material_code) wq = wq.ilike('material_code', `%${safeFilterValue(material_code)}%`)
        if (ship_to_code)  wq = wq.eq('ship_to_code', ship_to_code)
        if (plant)         wq = wq.eq('plant', plant)
        if (source)        wq = wq.eq('source', source)
        if (batch)         wq = wq.ilike('batch', `%${safeFilterValue(batch)}%`)
        if (searchOr) wq = wq.or(searchOr)
        return wq.order('od_number')
      }) as { od_number: string }[]
      const windowDos = [...new Set(winRows.map(r => String(r.od_number ?? '')).filter(Boolean))]
      const planned = new Set<string>()
      for (let i = 0; i < windowDos.length; i += 300) {
        const { data } = await supabase.from('khvc_lines').select('do_no').in('do_no', windowDos.slice(i, i + 300))
        for (const r of (data ?? []) as { do_no: string }[]) planned.add(String(r.do_no))
      }
      restrictOds = in_plan === '1' ? windowDos.filter(d => planned.has(d)) : windowDos.filter(d => !planned.has(d))
      if (restrictOds.length > PLAN_FILTER_CAP) {
        planWarning = `Khoảng ngày quá rộng để lọc theo kế hoạch (${restrictOds.length} DO) — thu hẹp Ngày nạp rồi lọc lại.`
        restrictOds = null
      } else if (restrictOds.length === 0) {
        return ok(res, { items: [], total: 0, page, page_size: pageSize, plan_filter_warning: planWarning ?? undefined })
      }
    }

    let query = supabase.from('erp_outbound_orders').select('*', { count: 'exact' })
    if (gteFrom) query = query.gte('created_at', gteFrom)
    if (lteTo)   query = query.lte('created_at', lteTo)
    if (od_number)     query = query.ilike('od_number', `%${safeFilterValue(od_number)}%`)
    if (od_number_eq)  query = query.eq('od_number', od_number_eq)   // editor gom theo DO — khớp CHÍNH XÁC (ilike substring làm DO khác chiếm chỗ trang 200)
    if (material_code) query = query.ilike('material_code', `%${safeFilterValue(material_code)}%`)
    if (ship_to_code)  query = query.eq('ship_to_code', ship_to_code)
    if (plant)         query = query.eq('plant', plant)
    if (source)        query = query.eq('source', source)
    if (batch)         query = query.ilike('batch', `%${safeFilterValue(batch)}%`)
    if (searchOr) query = query.or(searchOr)
    if (restrictOds) query = query.in('od_number', restrictOds)
    query = query.order('od_number', { ascending: true }).order('od_item', { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1)

    const { data, count, error } = await query
    if (error) throw new Error(error.message)
    const items = (data ?? []) as Record<string, unknown>[]

    // Enrich per-dòng của TRANG (bounded ≤ pageSize): (a) đã sinh chuyến chưa (used); (b) lệch đơn vị vs Material;
    // (c) kế hoạch VC gắn với DO (Số xe + Ngày xuất) — khớp khvc_lines.do_no = od_number
    const dos = [...new Set(items.map(i => String(i.od_number ?? '')).filter(Boolean))]
    const usedSet = new Set<string>()
    const planByDo = new Map<string, { group_codes: string[]; export_date: string | null }>()
    if (dos.length) {
      // Chunk 40 DO/truy vấn (mẫu outboundController) — 1 .or() 200 vế + không limit dễ chạm cap-1000
      // PostgREST → thiếu dòng ÂM THẦM → badge "Chưa dùng" SAI (user tin badge rồi xóa nhầm DO đang dùng).
      const odChunks: string[][] = []
      for (let i = 0; i < dos.length; i += 40) odChunks.push(dos.slice(i, i + 40))
      const odResults = await Promise.all(odChunks.map(chunk =>
        supabase.from('OutboundDelivery').select('delivery_code')
          .or(chunk.map(d => `delivery_code.ilike.%${safeFilterValue(d)}%`).join(','))
      ))
      for (const r of odResults)
        for (const o of (r.data ?? []) as { delivery_code: string | null }[])
          for (const tok of String(o.delivery_code ?? '').split(/,\s*/)) if (tok.trim()) usedSet.add(tok.trim())
      const klChunks: string[][] = []
      for (let i = 0; i < dos.length; i += 100) klChunks.push(dos.slice(i, i + 100))
      const klResults = await Promise.all(klChunks.map(chunk =>
        supabase.from('khvc_lines').select('do_no, group_code, export_date').in('do_no', chunk)
      ))
      for (const r of klResults)
        for (const k of (r.data ?? []) as { do_no: string; group_code: string | null; export_date: string | null }[]) {
          const key = String(k.do_no)
          const e = planByDo.get(key) ?? { group_codes: [], export_date: null }
          if (k.group_code && !e.group_codes.includes(k.group_code)) e.group_codes.push(k.group_code)
          if (!e.export_date && k.export_date) e.export_date = k.export_date
          planByDo.set(key, e)
        }
    }
    const mcs = [...new Set(items.map(i => String(i.material_code ?? '')).filter(Boolean))]
    const matMap = new Map<string, { base_unit: string | null; entry_unit: string | null; units_per_carton: number | null }>()
    if (mcs.length) {
      const { data: mats } = await supabase.from('Material').select('material_code, base_unit, entry_unit, units_per_carton').in('material_code', mcs)
      for (const m of (mats ?? []) as { material_code: string; base_unit: string | null; entry_unit: string | null; units_per_carton: number | null }[])
        matMap.set(String(m.material_code).trim(), m)
    }
    for (const i of items) {
      i.used = usedSet.has(String(i.od_number ?? ''))
      const pl = planByDo.get(String(i.od_number ?? ''))
      i.in_plan = !!pl
      i.plan_group_code = pl?.group_codes[0] ?? null
      i.plan_group_count = pl?.group_codes.length ?? 0
      i.plan_export_date = pl?.export_date ?? null
      const m = i.material_code ? matMap.get(String(i.material_code).trim()) : undefined
      let mm = false
      if (m) {
        const bu = String(i.base_unit ?? '').toUpperCase(), su = String(i.sales_unit ?? '').toUpperCase()
        if (bu && m.base_unit && bu !== String(m.base_unit).toUpperCase()) mm = true
        const allowed = [m.entry_unit, m.base_unit].filter(Boolean).map(x => String(x).toUpperCase())
        if (su && allowed.length && !allowed.includes(su)) mm = true
      }
      i.unit_mismatch = mm
      // Quy cách mã (Material master) — FE dùng tách 2 ô Thùng+Hộp khi sửa qty_base
      i.mat_units = m ?? null
    }
    return ok(res, { items, total: count ?? 0, page, page_size: pageSize, plan_filter_warning: planWarning ?? undefined })
  } catch (e) { return fail(res, String(e)) }
}

// GET /external/do-sap/facets — giá trị lọc (plant, source, ship_to) — gọn, lấy distinct từ trang đầu lớn
export async function doSapFacets(_req: Request, res: Response) {
  try {
    const { data } = await supabase.from('erp_outbound_orders').select('plant, source, ship_to_code, ship_to_name').limit(5000)
    const plants = [...new Set((data ?? []).map(r => r.plant).filter(Boolean))].sort()
    const sources = [...new Set((data ?? []).map(r => r.source).filter(Boolean))].sort()
    const shiptos = [...new Map((data ?? []).filter(r => r.ship_to_code).map(r => [r.ship_to_code, r.ship_to_name])).entries()]
      .map(([code, name]) => ({ code, name })).sort((a, b) => String(a.code).localeCompare(String(b.code)))
    return ok(res, { plants, sources, shiptos })
  } catch (e) { return fail(res, String(e)) }
}

// POST /external/do-sap — thêm tay 1 dòng
export async function createDoSap(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>
    const fields = pickFields(body)
    if (!fields.od_number || !fields.od_item) return fail(res, 'Thiếu Delivery (DO) hoặc Item', 400)
    // Chặn trùng (od_number, od_item) — bảng có unique index
    const { data: dup } = await supabase.from('erp_outbound_orders').select('id')
      .eq('od_number', fields.od_number).eq('od_item', fields.od_item).maybeSingle()
    if (dup) return fail(res, `Đã tồn tại dòng DO ${fields.od_number} / Item ${fields.od_item}`, 409)
    const row = { id: randomUUID(), ...fields, source: fields.source ?? 'MANUAL', uploaded_by: req.user?.name ?? null, updated_at: now() }
    const { data, error } = await supabase.from('erp_outbound_orders').insert(row).select().single()
    if (error) throw new Error(error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

// PUT /external/do-sap/:id — sửa tay
export async function updateDoSap(req: Request, res: Response) {
  try {
    const fields = pickFields(req.body as Record<string, unknown>)
    if (!Object.keys(fields).length) return fail(res, 'Không có trường nào để cập nhật', 400)
    // Đổi khóa (od_number, od_item) → chặn trùng dòng khác (unique index; báo 409 rõ thay vì 500 khó hiểu)
    if ('od_number' in fields || 'od_item' in fields) {
      const { data: cur } = await supabase.from('erp_outbound_orders')
        .select('od_number, od_item').eq('id', req.params.id).maybeSingle()
      const od = (fields.od_number ?? cur?.od_number) as string | null
      const item = (fields.od_item ?? cur?.od_item) as string | null
      if (od && item) {
        const { data: dup } = await supabase.from('erp_outbound_orders').select('id')
          .eq('od_number', od).eq('od_item', item).neq('id', req.params.id).maybeSingle()
        if (dup) return fail(res, `Đã tồn tại dòng DO ${od} / Item ${item}`, 409)
      }
    }
    const { data, error } = await supabase.from('erp_outbound_orders')
      .update({ ...fields, uploaded_by: req.user?.name ?? null, updated_at: now() })
      .eq('id', req.params.id).select().maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return fail(res, 'Không tìm thấy dòng', 404)
    // Sửa raw tay → đối chiếu lại các đơn WMS dùng dòng OD này
    await reconcileQuiet([{ od_number: String(data.od_number), od_item: String(data.od_item) }], req.user?.name ?? null)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// v2.2 — luật XÓA an toàn: dòng OD ĐÃ DÙNG + ĐÃ QUÉT (od_refs của item có cartons_scanned>0) → CHẶN xóa cứng
// (giữ raw cho post-back + Cần xử lý). Dòng chưa dùng / đã dùng-chưa-quét → xóa được (reconcile tự giảm đơn).
type DelRow = { id: string; od_number: string; od_item: string }
async function classifyDoSapDelete(rows: DelRow[]): Promise<{ deletable: DelRow[]; blocked: (DelRow & { reason: string })[] }> {
  const ods = [...new Set(rows.map(r => r.od_number))]
  const scannedKeys = new Set<string>()
  // Song song theo lô 8 (KHÔNG tuần tự từng DO — chọn nhiều trang = hàng trăm DO → quá maxDuration 60s)
  // + chỉ lấy item ĐÃ QUÉT (gt 0) — cần mỗi dòng đã quét để khóa, giảm hẳn payload. Index GIN od_refs: migration 20260722.
  for (let i = 0; i < ods.length; i += 8) {
    const results = await Promise.all(ods.slice(i, i + 8).map(od =>
      supabase.from('OutboundItem')
        .select('cartons_scanned, od_refs')
        .filter('od_refs', 'cs', JSON.stringify([{ od_number: od }]))
        .gt('cartons_scanned', 0)
    ))
    for (const r of results)
      for (const it of ((r.data ?? []) as { cartons_scanned: number; od_refs: { od_number: string; od_item: string }[] | null }[]))
        for (const ref of (it.od_refs ?? [])) scannedKeys.add(`${ref.od_number}__${ref.od_item}`)
  }
  const deletable: DelRow[] = [], blocked: (DelRow & { reason: string })[] = []
  for (const r of rows) {
    if (scannedKeys.has(`${r.od_number}__${r.od_item}`)) blocked.push({ ...r, reason: 'Đã dùng + đã quét — không xóa cứng (xử ở Xuất kho / Cần xử lý)' })
    else deletable.push(r)
  }
  return { deletable, blocked }
}

// DELETE /external/do-sap/:id (?check=1 = chỉ kiểm, không xóa)
export async function deleteDoSap(req: Request, res: Response) {
  try {
    const { data: row } = await supabase.from('erp_outbound_orders').select('od_number, od_item').eq('id', req.params.id).maybeSingle()
    if (!row) return fail(res, 'Không tìm thấy dòng', 404)
    const dr: DelRow = { id: req.params.id, od_number: String(row.od_number), od_item: String(row.od_item) }
    const { deletable, blocked } = await classifyDoSapDelete([dr])
    if (req.query.check === '1') return ok(res, { deletable: deletable.map(d => d.id), blocked })
    if (!deletable.length) return fail(res, blocked[0]?.reason ?? 'Không xóa được dòng này', 409)
    const { error } = await supabase.from('erp_outbound_orders').delete().eq('id', req.params.id)
    if (error) throw new Error(error.message)
    await reconcileQuiet([{ od_number: dr.od_number, od_item: dr.od_item }], req.user?.name ?? null)
    return ok(res, { deleted: 1, blocked })
  } catch (e) { return fail(res, String(e)) }
}

// POST /external/do-sap/bulk-delete (?check=1 = chỉ kiểm) — xóa nhiều, guard từng dòng
export async function bulkDeleteDoSap(req: Request, res: Response) {
  try {
    const ids = (req.body as { ids?: string[] })?.ids ?? []
    if (!Array.isArray(ids) || !ids.length) return fail(res, 'Không có dòng nào được chọn', 400)
    const rows: DelRow[] = []
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase.from('erp_outbound_orders').select('id, od_number, od_item').in('id', ids.slice(i, i + 300))
      for (const r of ((data ?? []) as DelRow[])) rows.push({ id: r.id, od_number: String(r.od_number), od_item: String(r.od_item) })
    }
    const { deletable, blocked } = await classifyDoSapDelete(rows)
    const blockedOut = blocked.map(b => ({ od_number: b.od_number, od_item: b.od_item, reason: b.reason }))
    if (req.query.check === '1') return ok(res, { deletable_count: deletable.length, blocked_count: blocked.length, blocked: blockedOut })
    const delIds = deletable.map(d => d.id)
    for (let i = 0; i < delIds.length; i += 300) {
      const { error } = await supabase.from('erp_outbound_orders').delete().in('id', delIds.slice(i, i + 300))
      if (error) throw new Error(error.message)
    }
    if (deletable.length) await reconcileQuiet(deletable.map(d => ({ od_number: d.od_number, od_item: d.od_item })), req.user?.name ?? null)
    return ok(res, { deleted: delIds.length, blocked_count: blocked.length, blocked: blockedOut })
  } catch (e) { return fail(res, String(e)) }
}
