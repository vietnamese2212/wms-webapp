import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'

function fail(res: Response, message: string, status = 400) {
  return res.status(status).json({ success: false, error: { message } })
}

export async function listZones(req: Request, res: Response) {
  const { warehouse_id } = req.query as { warehouse_id?: string }

  let query = supabase
    .from('WarehouseZone')
    .select('id, warehouse_id, code, name, category, sort_order, is_active, created_at, updated_at, created_by, updated_by')
    .order('sort_order')
    .order('created_at')

  if (warehouse_id) query = query.eq('warehouse_id', warehouse_id)

  const { data, error } = await query
  if (error) return fail(res, error.message, 500)
  res.json({ success: true, data })
}

export async function createZone(req: Request, res: Response) {
  const { warehouse_id, code, name, category } = req.body as { warehouse_id?: string; code?: string; name?: string; category?: string }
  if (!warehouse_id || !code?.trim() || !name?.trim()) return fail(res, 'warehouse_id, code và name là bắt buộc')

  const t = new Date().toISOString()

  const { data: existing } = await supabase
    .from('WarehouseZone')
    .select('sort_order')
    .eq('warehouse_id', warehouse_id)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextSort = existing?.length ? (Number((existing[0] as any).sort_order ?? 0) + 1) : 1

  const actor = (req as any).user?.name || null
  const { data, error } = await supabase
    .from('WarehouseZone')
    .insert({
      id:           randomUUID(),
      warehouse_id,
      code:         code.trim().toUpperCase(),
      name:         name.trim(),
      category:     category?.trim() || null,
      sort_order:   nextSort,
      created_by:   actor,
      updated_by:   actor,
      updated_at:   t,
    })
    .select('id, warehouse_id, code, name, category, sort_order, is_active, created_at, updated_at, created_by, updated_by')
    .single()

  if (error) {
    if (error.code === '23505') return fail(res, `Mã khu vực "${code.trim().toUpperCase()}" đã tồn tại trong kho này`)
    return fail(res, error.message, 500)
  }
  res.json({ success: true, data })
}

export async function updateZone(req: Request, res: Response) {
  const { id } = req.params
  const { name, category, is_active } = req.body as { name?: string; category?: string | null; is_active?: boolean }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: (req as any).user?.name || null }
  if (name !== undefined) updates.name = name.trim()
  if (category !== undefined) updates.category = category?.trim() || null
  if (is_active !== undefined) updates.is_active = is_active

  const { data, error } = await supabase
    .from('WarehouseZone')
    .update(updates)
    .eq('id', id)
    .select('id, warehouse_id, code, name, category, sort_order, is_active, created_at, updated_at, created_by, updated_by')
    .single()

  if (error) return fail(res, error.message, 500)
  res.json({ success: true, data })
}

export async function deleteZone(req: Request, res: Response) {
  const { id } = req.params

  const { data: zone } = await supabase
    .from('WarehouseZone')
    .select('code, warehouse_id')
    .eq('id', id)
    .single()

  if (zone) {
    const { count } = await supabase
      .from('Location')
      .select('id', { count: 'exact', head: true })
      .eq('warehouse_id', (zone as any).warehouse_id)
      .eq('sub_code', (zone as any).code)

    if (count && count > 0) {
      return fail(res, `Khu vực này có ${count} vị trí, không thể xóa. Xóa hoặc chuyển vị trí trước.`)
    }
  }

  const { error } = await supabase.from('WarehouseZone').delete().eq('id', id)
  if (error) return fail(res, error.message, 500)
  res.json({ success: true })
}
