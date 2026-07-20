// Dữ liệu bên ngoài → tab DO SAP: CRUD trên bảng RAW erp_outbound_orders.
// Nguồn: upload tay (VL06O) hiện tại; tương lai SAP kéo vào cùng bảng (cột source EXCEL/SAP/MANUAL).
// Cho phép sửa/xóa tay khi SAP chưa cập nhật/lỗi. Phân trang bắt buộc (bảng có thể hàng triệu dòng).
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { safeFilterValue } from '../../utils/search'

const now = () => new Date().toISOString()

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
    const { data, error } = await supabase.from('erp_outbound_orders')
      .update({ ...fields, uploaded_by: req.user?.name ?? null, updated_at: now() })
      .eq('id', req.params.id).select().maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return fail(res, 'Không tìm thấy dòng', 404)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /external/do-sap/:id — xóa 1 dòng
export async function deleteDoSap(req: Request, res: Response) {
  try {
    const { error } = await supabase.from('erp_outbound_orders').delete().eq('id', req.params.id)
    if (error) throw new Error(error.message)
    return ok(res, { deleted: 1 })
  } catch (e) { return fail(res, String(e)) }
}

// POST /external/do-sap/bulk-delete — xóa nhiều (multi-select), chunk 300
export async function bulkDeleteDoSap(req: Request, res: Response) {
  try {
    const ids = (req.body as { ids?: string[] })?.ids ?? []
    if (!Array.isArray(ids) || !ids.length) return fail(res, 'Không có dòng nào được chọn', 400)
    for (let i = 0; i < ids.length; i += 300) {
      const { error } = await supabase.from('erp_outbound_orders').delete().in('id', ids.slice(i, i + 300))
      if (error) throw new Error(error.message)
    }
    return ok(res, { deleted: ids.length })
  } catch (e) { return fail(res, String(e)) }
}
