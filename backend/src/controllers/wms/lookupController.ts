import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { invalidateWhTypeMetaCache, type WhTypeMeta } from '../../utils/warehouseTypeMeta'

function fail(res: Response, message: string, status = 400) {
  return res.status(status).json({ success: false, error: { message } })
}

// meta = cờ hành vi per-giá-trị (hiện dùng cho warehouse_type — xem utils/warehouseTypeMeta).
// Chỉ nhận đúng các key đã biết, ép kiểu — không cho client nhét jsonb tùy ý.
function sanitizeMeta(raw: unknown): WhTypeMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const out: WhTypeMeta = {}
  if (typeof o.is_ncc_goods === 'boolean') out.is_ncc_goods = o.is_ncc_goods
  if (typeof o.requires_shelf_life === 'boolean') out.requires_shelf_life = o.requires_shelf_life
  if (typeof o.requires_pallet_per_ea === 'boolean') out.requires_pallet_per_ea = o.requires_pallet_per_ea
  if (typeof o.requires_ncc === 'boolean') out.requires_ncc = o.requires_ncc
  if (typeof o.batch_char === 'string') out.batch_char = o.batch_char.trim().toUpperCase().slice(0, 1)
  if (typeof o.badge_color === 'string') out.badge_color = o.badge_color.trim()
  return out
}

export async function listLookup(req: Request, res: Response) {
  const { type } = req.query as { type?: string }
  if (!type) return fail(res, 'type là bắt buộc')

  // select('*') thay vì liệt kê cột: không vỡ khi DB chưa apply migration thêm cột meta (deploy trước, apply sau)
  const { data, error } = await supabase
    .from('LookupValue')
    .select('*')
    .eq('type', type)
    .order('sort_order')
    .order('created_at')

  if (error) return fail(res, error.message, 500)
  res.json({ success: true, data })
}

export async function addLookup(req: Request, res: Response) {
  const { type, value, meta } = req.body as { type?: string; value?: string; meta?: unknown }
  if (!type || !value?.trim()) return fail(res, 'type và value là bắt buộc')

  const t = new Date().toISOString()
  const { data: existing } = await supabase
    .from('LookupValue')
    .select('id, sort_order')
    .eq('type', type)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextSort = existing?.length ? Number((existing[0] as any).sort_order ?? 0) + 1 : 1

  const actor = req.user?.name || null
  const { data, error } = await supabase
    .from('LookupValue')
    .insert({ id: randomUUID(), type, value: value.trim(), sort_order: nextSort, meta: sanitizeMeta(meta) ?? {}, created_at: t, updated_at: t, created_by: actor, updated_by: actor })
    .select('id, value, sort_order, meta, created_at, updated_at, created_by, updated_by')
    .single()

  if (error) {
    if (error.code === '23505') return fail(res, `"${value.trim()}" đã tồn tại`)
    return fail(res, error.message, 500)
  }
  if (type === 'warehouse_type') invalidateWhTypeMetaCache()
  res.json({ success: true, data })
}

export async function updateLookup(req: Request, res: Response) {
  const { id } = req.params
  const { value, meta } = req.body as { value?: string; meta?: unknown }
  if (!value?.trim()) return fail(res, 'value là bắt buộc')
  const newValue = value.trim()

  const { data: cur } = await supabase.from('LookupValue').select('type, value').eq('id', id).maybeSingle()
  if (!cur) return fail(res, 'Không tìm thấy giá trị danh mục', 404)

  // Đổi TÊN loại kho = cascade RPC: tên đang lưu dạng text ở ~11 cột dữ liệu (Material/Location/
  // WarehouseZone/Employee.allowed_categories/SlotTemplate/DeliverySlot/TmsOrder/GDO/gate/
  // inbound_plan_lines/ProductionImport) — đổi lẻ danh mục sẽ để lại "tên ma" tàng hình dữ liệu.
  let renamed: Record<string, number> | null = null
  if (cur.type === 'warehouse_type' && newValue !== cur.value) {
    const { data: counts, error: rpcErr } = await supabase.rpc('rename_warehouse_type', {
      p_old: cur.value, p_new: newValue,
    })
    if (rpcErr) {
      if (rpcErr.code === '23505') return fail(res, `"${newValue}" đã tồn tại`)
      if (rpcErr.code === '42883') return fail(res, 'Chưa apply migration 20260710_warehouse_type_options — không thể đổi tên loại kho an toàn', 500)
      return fail(res, rpcErr.message, 500)
    }
    renamed = (counts ?? {}) as Record<string, number>
  }

  const patch: Record<string, unknown> = { value: newValue, updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
  const cleanMeta = sanitizeMeta(meta)
  if (cleanMeta) patch.meta = cleanMeta

  const { data, error } = await supabase
    .from('LookupValue')
    .update(patch)
    .eq('id', id)
    .select('id, value, sort_order, meta, created_at, updated_at, created_by, updated_by')
    .single()

  if (error) {
    if (error.code === '23505') return fail(res, `"${newValue}" đã tồn tại`)
    return fail(res, error.message, 500)
  }
  if (cur.type === 'warehouse_type') invalidateWhTypeMetaCache()
  res.json({ success: true, data: renamed ? { ...data, renamed } : data })
}

// Sắp xếp lại thứ tự (kéo-thả) — set sort_order theo vị trí mảng ids
export async function reorderLookup(req: Request, res: Response) {
  const { type, ids } = req.body as { type?: string; ids?: string[] }
  if (!type || !Array.isArray(ids) || ids.length === 0) return fail(res, 'type và ids là bắt buộc')

  const now = new Date().toISOString()
  const actor = req.user?.name || null
  const results = await Promise.all(
    ids.map((id, i) =>
      supabase
        .from('LookupValue')
        .update({ sort_order: i + 1, updated_at: now, updated_by: actor })
        .eq('id', id)
        .eq('type', type),
    ),
  )
  const err = results.find(r => r.error)?.error
  if (err) return fail(res, err.message, 500)
  res.json({ success: true })
}

export async function deleteLookup(req: Request, res: Response) {
  const { id } = req.params

  // Chặn xóa loại kho đang được dùng làm category ở Location/Material/WarehouseZone → tránh category mồ côi
  const { data: lk } = await supabase.from('LookupValue').select('value, type').eq('id', id).maybeSingle()
  if (lk?.type === 'warehouse_type' && lk.value) {
    const [loc, mat, zone] = await Promise.all([
      supabase.from('Location').select('id', { count: 'exact', head: true }).eq('category', lk.value),
      supabase.from('Material').select('id', { count: 'exact', head: true }).eq('category', lk.value),
      supabase.from('WarehouseZone').select('id', { count: 'exact', head: true }).eq('category', lk.value),
    ])
    const total = (loc.count ?? 0) + (mat.count ?? 0) + (zone.count ?? 0)
    if (total > 0) return fail(res, `Loại kho "${lk.value}" đang được dùng (${total} bản ghi) — không thể xóa`, 409)
  }

  const { error } = await supabase.from('LookupValue').delete().eq('id', id)
  if (error) return fail(res, error.message, 500)
  res.json({ success: true })
}
