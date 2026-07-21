// Dữ liệu bên ngoài → tab "Kế hoạch xuất": CRUD trên bảng RAW khvc_lines (tầng 2 điều vận).
// Nguồn: upload KHVC (uploadKhvc lưu song song); tương lai plan-app/SAP. Cho sửa/xóa tay khi cần.
// Phân trang bắt buộc (bảng có thể hàng triệu dòng). Enrich per-trang: đã sinh chuyến chưa + DO đã sẵn sàng (raw).
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { safeFilterValue } from '../../utils/search'

const now = () => new Date().toISOString()

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

// GET /external/khvc — list phân trang + filter + search
export async function listKhvc(req: Request, res: Response) {
  try {
    const { q, group_code, do_no, warehouse_code, veh_type, source, sync_status, date_from, date_to } = req.query as Record<string, string>
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50))

    let query = supabase.from('khvc_lines').select('*', { count: 'exact' })
    // Ngày NẠP dữ liệu (created_at) theo giờ VN — bắt buộc từ FE (không kéo cả bảng)
    if (date_from) query = query.gte('created_at', new Date(`${date_from}T00:00:00+07:00`).toISOString())
    if (date_to)   query = query.lte('created_at', new Date(`${date_to}T23:59:59.999+07:00`).toISOString())
    if (group_code)     query = query.ilike('group_code', `%${safeFilterValue(group_code)}%`)
    if (do_no)          query = query.ilike('do_no', `%${safeFilterValue(do_no)}%`)
    if (warehouse_code) query = query.eq('warehouse_code', warehouse_code)
    if (veh_type)       query = query.eq('veh_type', veh_type)
    if (source)         query = query.eq('source', source)
    if (sync_status)    query = query.eq('sync_status', sync_status)
    if (q && q.trim()) {
      const s = safeFilterValue(q.trim())
      query = query.or(`group_code.ilike.%${s}%,do_no.ilike.%${s}%,npp.ilike.%${s}%,note.ilike.%${s}%`)
    }
    query = query.order('group_code', { ascending: true }).order('do_no', { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1)

    const { data, count, error } = await query
    if (error) throw new Error(error.message)
    const items = (data ?? []) as Record<string, unknown>[]

    // Enrich per-dòng của TRANG (bounded ≤ pageSize):
    // (a) chuyến đã sinh chưa (khớp group_code với GroupDeliveryOrder) + trạng thái chuyến
    const gcs = [...new Set(items.map(i => String(i.group_code ?? '')).filter(Boolean))]
    const gdoByGc = new Map<string, string>()
    if (gcs.length) {
      const { data: gdos } = await supabase.from('GroupDeliveryOrder').select('group_code, status').in('group_code', gcs)
      for (const g of (gdos ?? []) as { group_code: string; status: string }[])
        if (!gdoByGc.has(g.group_code)) gdoByGc.set(g.group_code, g.status)
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
      i.materialized = gdoByGc.has(gc)
      i.gdo_status = gdoByGc.get(gc) ?? null
      i.do_ready = readyDos.has(String(i.do_no ?? ''))
    }
    return ok(res, { items, total: count ?? 0, page, page_size: pageSize })
  } catch (e) { return fail(res, String(e)) }
}

// GET /external/khvc/facets — giá trị lọc
export async function khvcFacets(_req: Request, res: Response) {
  try {
    const { data } = await supabase.from('khvc_lines').select('warehouse_code, veh_type, source, npp').limit(5000)
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
    const { data: dup } = await supabase.from('khvc_lines').select('id')
      .eq('group_code', fields.group_code).eq('do_no', fields.do_no).maybeSingle()
    if (dup) return fail(res, `Đã tồn tại dòng Số xe ${fields.group_code} / DO ${fields.do_no}`, 409)
    const row = {
      id: randomUUID(), ...fields,
      warehouse_code: fields.warehouse_code ?? String(fields.group_code).split('_')[0] ?? null,
      source: fields.source ?? 'MANUAL', sync_status: fields.sync_status ?? 'ACTIVE',
      uploaded_by: req.user?.name ?? null, updated_at: now(),
    }
    const { data, error } = await supabase.from('khvc_lines').insert(row).select().single()
    if (error) throw new Error(error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

// PUT /external/khvc/:id — sửa tay
export async function updateKhvc(req: Request, res: Response) {
  try {
    const fields = pickFields(req.body as Record<string, unknown>)
    if (!Object.keys(fields).length) return fail(res, 'Không có trường nào để cập nhật', 400)
    if ('group_code' in fields || 'do_no' in fields) {
      const { data: cur } = await supabase.from('khvc_lines').select('group_code, do_no').eq('id', req.params.id).maybeSingle()
      const gc = (fields.group_code ?? cur?.group_code) as string | null
      const dn = (fields.do_no ?? cur?.do_no) as string | null
      if (gc && dn) {
        const { data: dup } = await supabase.from('khvc_lines').select('id')
          .eq('group_code', gc).eq('do_no', dn).neq('id', req.params.id).maybeSingle()
        if (dup) return fail(res, `Đã tồn tại dòng Số xe ${gc} / DO ${dn}`, 409)
      }
    }
    const { data, error } = await supabase.from('khvc_lines')
      .update({ ...fields, uploaded_by: req.user?.name ?? null, updated_at: now() })
      .eq('id', req.params.id).select().maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return fail(res, 'Không tìm thấy dòng', 404)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /external/khvc/:id — xóa 1 dòng
export async function deleteKhvc(req: Request, res: Response) {
  try {
    const { error } = await supabase.from('khvc_lines').delete().eq('id', req.params.id)
    if (error) throw new Error(error.message)
    return ok(res, { deleted: 1 })
  } catch (e) { return fail(res, String(e)) }
}

// POST /external/khvc/bulk-delete — xóa nhiều (multi-select), chunk 300
export async function bulkDeleteKhvc(req: Request, res: Response) {
  try {
    const ids = (req.body as { ids?: string[] })?.ids ?? []
    if (!Array.isArray(ids) || !ids.length) return fail(res, 'Không có dòng nào được chọn', 400)
    for (let i = 0; i < ids.length; i += 300) {
      const { error } = await supabase.from('khvc_lines').delete().in('id', ids.slice(i, i + 300))
      if (error) throw new Error(error.message)
    }
    return ok(res, { deleted: ids.length })
  } catch (e) { return fail(res, String(e)) }
}
