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
  const { warehouse_id, name, category } = req.body as { warehouse_id?: string; name?: string; category?: string }
  if (!warehouse_id || !name?.trim()) return fail(res, 'warehouse_id và name là bắt buộc')

  const reqUser = req.user
  if (reqUser?.warehouse_scope === 'ASSIGNED') {
    const allowed: string[] = reqUser.warehouse_ids ?? []
    if (!allowed.includes(warehouse_id)) return fail(res, 'Không có quyền thao tác trên kho này', 403)
  }

  const t = new Date().toISOString()

  // Lấy tất cả code hiện có để tìm số thứ tự tiếp theo
  const { data: existing } = await supabase
    .from('WarehouseZone')
    .select('code, sort_order')
    .eq('warehouse_id', warehouse_id)
    .order('sort_order', { ascending: false })

  const nextSort = existing?.length ? (Number((existing[0] as any).sort_order ?? 0) + 1) : 1

  // Tự sinh mã: Z01, Z02, ... tìm số chưa dùng
  const usedCodes = new Set((existing ?? []).map((z: any) => z.code as string))
  let seq = nextSort
  let autoCode = `Z${String(seq).padStart(2, '0')}`
  while (usedCodes.has(autoCode)) {
    seq++
    autoCode = `Z${String(seq).padStart(2, '0')}`
  }

  const actorName = reqUser?.name || null
  const { data, error } = await supabase
    .from('WarehouseZone')
    .insert({
      id:           randomUUID(),
      warehouse_id,
      code:         autoCode,
      name:         name.trim(),
      category:     category?.trim() || null,
      sort_order:   nextSort,
      created_by:   actorName,
      updated_by:   actorName,
      updated_at:   t,
    })
    .select('id, warehouse_id, code, name, category, sort_order, is_active, created_at, updated_at, created_by, updated_by')
    .single()

  if (error) return fail(res, error.message, 500)
  res.json({ success: true, data })
}

export async function updateZone(req: Request, res: Response) {
  const { id } = req.params
  const { name, category, is_active } = req.body as { name?: string; category?: string | null; is_active?: boolean }

  const actor = req.user
  if (actor?.warehouse_scope === 'ASSIGNED') {
    const { data: target } = await supabase.from('WarehouseZone').select('warehouse_id').eq('id', id).single()
    const allowed: string[] = actor.warehouse_ids ?? []
    if (!target || !allowed.includes((target as any).warehouse_id)) return fail(res, 'Không có quyền thao tác trên kho này', 403)
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor?.name || null }
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
    const deleteActor = req.user
    if (deleteActor?.warehouse_scope === 'ASSIGNED') {
      const allowed: string[] = deleteActor.warehouse_ids ?? []
      if (!allowed.includes((zone as any).warehouse_id)) return fail(res, 'Không có quyền thao tác trên kho này', 403)
    }

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
