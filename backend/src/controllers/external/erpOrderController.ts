// Dữ liệu bên ngoài → tab DO SAP: CRUD trên bảng RAW erp_outbound_orders.
// Nguồn: upload tay (VL06O) hiện tại; tương lai SAP kéo vào cùng bảng (cột source EXCEL/SAP/MANUAL).
// Cho phép sửa/xóa tay khi SAP chưa cập nhật/lỗi. Phân trang bắt buộc (bảng có thể hàng triệu dòng).
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { safeFilterValue } from '../../utils/search'
import { reconcileFromSap, type OdKey } from '../../services/outboundReconcile'

const now = () => new Date().toISOString()

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

// GET /external/do-sap — list phân trang + filter + search (?q, od_number, material_code, ship_to_code, plant, source, batch, page, page_size)
export async function listDoSap(req: Request, res: Response) {
  try {
    const { q, od_number, material_code, ship_to_code, plant, source, batch, date_from, date_to } = req.query as Record<string, string>
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50))

    let query = supabase.from('erp_outbound_orders').select('*', { count: 'exact' })
    // Ngày NẠP dữ liệu (created_at) theo giờ VN — bắt buộc từ FE (không tự kéo cả bảng triệu dòng)
    if (date_from) query = query.gte('created_at', new Date(`${date_from}T00:00:00+07:00`).toISOString())
    if (date_to)   query = query.lte('created_at', new Date(`${date_to}T23:59:59.999+07:00`).toISOString())
    if (od_number)     query = query.ilike('od_number', `%${safeFilterValue(od_number)}%`)
    if (material_code) query = query.ilike('material_code', `%${safeFilterValue(material_code)}%`)
    if (ship_to_code)  query = query.eq('ship_to_code', ship_to_code)
    if (plant)         query = query.eq('plant', plant)
    if (source)        query = query.eq('source', source)
    if (batch)         query = query.ilike('batch', `%${safeFilterValue(batch)}%`)
    if (q && q.trim()) {
      const s = safeFilterValue(q.trim())
      query = query.or(`od_number.ilike.%${s}%,material_code.ilike.%${s}%,material_name.ilike.%${s}%,ship_to_name.ilike.%${s}%,batch.ilike.%${s}%`)
    }
    query = query.order('od_number', { ascending: true }).order('od_item', { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1)

    const { data, count, error } = await query
    if (error) throw new Error(error.message)
    const items = (data ?? []) as Record<string, unknown>[]

    // Enrich per-dòng của TRANG (bounded ≤ pageSize): (a) đã sinh chuyến chưa (used); (b) lệch đơn vị vs Material
    const dos = [...new Set(items.map(i => String(i.od_number ?? '')).filter(Boolean))]
    const usedSet = new Set<string>()
    if (dos.length) {
      const orExpr = dos.map(d => `delivery_code.ilike.%${safeFilterValue(d)}%`).join(',')
      const { data: ods } = await supabase.from('OutboundDelivery').select('delivery_code').or(orExpr)
      for (const o of (ods ?? []) as { delivery_code: string | null }[])
        for (const tok of String(o.delivery_code ?? '').split(/,\s*/)) if (tok.trim()) usedSet.add(tok.trim())
    }
    const mcs = [...new Set(items.map(i => String(i.material_code ?? '')).filter(Boolean))]
    const matMap = new Map<string, { base_unit: string | null; entry_unit: string | null }>()
    if (mcs.length) {
      const { data: mats } = await supabase.from('Material').select('material_code, base_unit, entry_unit').in('material_code', mcs)
      for (const m of (mats ?? []) as { material_code: string; base_unit: string | null; entry_unit: string | null }[])
        matMap.set(String(m.material_code).trim(), m)
    }
    for (const i of items) {
      i.used = usedSet.has(String(i.od_number ?? ''))
      const m = i.material_code ? matMap.get(String(i.material_code).trim()) : undefined
      let mm = false
      if (m) {
        const bu = String(i.base_unit ?? '').toUpperCase(), su = String(i.sales_unit ?? '').toUpperCase()
        if (bu && m.base_unit && bu !== String(m.base_unit).toUpperCase()) mm = true
        const allowed = [m.entry_unit, m.base_unit].filter(Boolean).map(x => String(x).toUpperCase())
        if (su && allowed.length && !allowed.includes(su)) mm = true
      }
      i.unit_mismatch = mm
    }
    return ok(res, { items, total: count ?? 0, page, page_size: pageSize })
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
  for (const od of ods) {
    // item tham chiếu OD này (jsonb cs) + đã quét → khóa (od,item) của nó bị chặn
    const { data } = await supabase.from('OutboundItem')
      .select('cartons_scanned, od_refs').filter('od_refs', 'cs', JSON.stringify([{ od_number: od }]))
    for (const it of ((data ?? []) as { cartons_scanned: number; od_refs: { od_number: string; od_item: string }[] | null }[]))
      if (Number(it.cartons_scanned) > 0)
        for (const r of (it.od_refs ?? [])) scannedKeys.add(`${r.od_number}__${r.od_item}`)
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
