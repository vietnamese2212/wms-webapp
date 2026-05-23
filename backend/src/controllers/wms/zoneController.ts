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
    .select('id, warehouse_id, code, name, sort_order, is_active')
    .order('sort_order')
    .order('created_at')

  if (warehouse_id) query = query.eq('warehouse_id', warehouse_id)

  const { data, error } = await query
  if (error) return fail(res, error.message, 500)
  res.json({ success: true, data })
}

export async function createZone(req: Request, res: Response) {
  const { warehouse_id, code, name } = req.body as { warehouse_id?: string; code?: string; name?: string }
  if (!warehouse_id || !code?.trim() || !name?.trim()) return fail(res, 'warehouse_id, code và name là bắt buộc')

  const t = new Date().toISOString()

  const { data: existing } = await supabase
    .from('WarehouseZone')
    .select('sort_order')
    .eq('warehouse_id', warehouse_id)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextSort = existing?.length ? (Number((existing[0] as any).sort_order ?? 0) + 1) : 1

  const { data, error } = await supabase
    .from('WarehouseZone')
    .insert({
      id:           randomUUID(),
      warehouse_id,
      code:         code.trim().toUpperCase(),
      name:         name.trim(),
      sort_order:   nextSort,
      updated_at:   t,
    })
    .select('id, warehouse_id, code, name, sort_order, is_active')
    .single()

  if (error) {
    if (error.code === '23505') return fail(res, `Mã khu vực "${code.trim().toUpperCase()}" đã tồn tại trong kho này`)
    return fail(res, error.message, 500)
  }
  res.json({ success: true, data })
}

export async function updateZone(req: Request, res: Response) {
  const { id } = req.params
  const { name, is_active } = req.body as { name?: string; is_active?: boolean }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (name !== undefined) updates.name = name.trim()
  if (is_active !== undefined) updates.is_active = is_active

  const { data, error } = await supabase
    .from('WarehouseZone')
    .update(updates)
    .eq('id', id)
    .select('id, warehouse_id, code, name, sort_order, is_active')
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
