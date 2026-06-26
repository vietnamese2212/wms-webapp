import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'

function fail(res: Response, message: string, status = 400) {
  return res.status(status).json({ success: false, error: { message } })
}

export async function listLookup(req: Request, res: Response) {
  const { type } = req.query as { type?: string }
  if (!type) return fail(res, 'type là bắt buộc')

  const { data, error } = await supabase
    .from('LookupValue')
    .select('id, value, sort_order, created_at, updated_at, created_by, updated_by')
    .eq('type', type)
    .order('sort_order')
    .order('created_at')

  if (error) return fail(res, error.message, 500)
  res.json({ success: true, data })
}

export async function addLookup(req: Request, res: Response) {
  const { type, value } = req.body as { type?: string; value?: string }
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
    .insert({ id: randomUUID(), type, value: value.trim(), sort_order: nextSort, created_at: t, updated_at: t, created_by: actor, updated_by: actor })
    .select('id, value, sort_order, created_at, updated_at, created_by, updated_by')
    .single()

  if (error) {
    if (error.code === '23505') return fail(res, `"${value.trim()}" đã tồn tại`)
    return fail(res, error.message, 500)
  }
  res.json({ success: true, data })
}

export async function updateLookup(req: Request, res: Response) {
  const { id } = req.params
  const { value } = req.body as { value?: string }
  if (!value?.trim()) return fail(res, 'value là bắt buộc')

  const { data, error } = await supabase
    .from('LookupValue')
    .update({ value: value.trim(), updated_at: new Date().toISOString(), updated_by: req.user?.name || null })
    .eq('id', id)
    .select('id, value, sort_order, created_at, updated_at, created_by, updated_by')
    .single()

  if (error) {
    if (error.code === '23505') return fail(res, `"${value.trim()}" đã tồn tại`)
    return fail(res, error.message, 500)
  }
  res.json({ success: true, data })
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
