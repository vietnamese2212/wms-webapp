import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { scopeCategoriesOf, categoryAllowed, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'

function fail(res: Response, message: string, status = 400) {
  return res.status(status).json({ success: false, error: { message } })
}

export async function listZones(req: Request, res: Response) {
  const { warehouse_id } = req.query as { warehouse_id?: string }

  let query = supabase
    .from('WarehouseZone')
    .select('id, warehouse_id, code, name, category, sort_order, pick_rank, slot_group, flow_type, is_active, created_at, updated_at, created_by, updated_by')
    .order('sort_order')
    .order('created_at')

  // Cắt theo scope Kho + Loại kho của user (null-inclusive: khu vực chưa gắn loại vẫn hiện)
  if (req.user?.warehouse_scope === 'ASSIGNED') {
    const allowedWh: string[] = req.user.warehouse_ids ?? []
    if (warehouse_id && !allowedWh.includes(warehouse_id)) return res.json({ success: true, data: [] })
    if (!warehouse_id && allowedWh.length > 0) query = query.in('warehouse_id', allowedWh)
  }
  const scopeCats = scopeCategoriesOf(req)
  if (scopeCats) query = query.or(`category.is.null,category.in.("${scopeCats.join('","')}")`)

  if (warehouse_id) query = query.eq('warehouse_id', warehouse_id)

  const { data, error } = await query
  if (error) return fail(res, error.message, 500)
  res.json({ success: true, data })
}

export async function createZone(req: Request, res: Response) {
  const { warehouse_id, name, category, code } = req.body as { warehouse_id?: string; name?: string; category?: string; code?: string }
  if (!warehouse_id || !name?.trim()) return fail(res, 'warehouse_id và name là bắt buộc')

  const reqUser = req.user
  if (reqUser?.warehouse_scope === 'ASSIGNED') {
    const allowed: string[] = reqUser.warehouse_ids ?? []
    if (!allowed.includes(warehouse_id)) return fail(res, 'Không có quyền thao tác trên kho này', 403)
  }
  if (!categoryAllowed(req, category?.trim() || null)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)

  const t = new Date().toISOString()

  // Lấy tất cả code hiện có để tìm số thứ tự tiếp theo
  const { data: existing } = await supabase
    .from('WarehouseZone')
    .select('code, sort_order')
    .eq('warehouse_id', warehouse_id)
    .order('sort_order', { ascending: false })

  const nextSort = existing?.length ? (Number((existing[0] as any).sort_order ?? 0) + 1) : 1

  const usedCodes = new Set((existing ?? []).map((z: any) => String(z.code).toUpperCase()))

  // Mã do người dùng nhập (ưu tiên) — chuẩn hoá UPPER, bỏ khoảng trắng. Để trống → tự sinh Z01, Z02…
  // Trùng trong CÙNG kho → chặn (DB cũng có unique (warehouse_id, code)). Khác kho trùng nhau OK.
  const manualCode = String(code ?? '').toUpperCase().trim().replace(/\s+/g, '')
  let finalCode: string
  if (manualCode) {
    if (usedCodes.has(manualCode)) return fail(res, `Mã khu vực "${manualCode}" đã tồn tại trong kho này`, 409)
    finalCode = manualCode
  } else {
    let seq = nextSort
    let autoCode = `Z${String(seq).padStart(2, '0')}`
    while (usedCodes.has(autoCode)) {
      seq++
      autoCode = `Z${String(seq).padStart(2, '0')}`
    }
    finalCode = autoCode
  }

  const actorName = reqUser?.name || null
  const { data, error } = await supabase
    .from('WarehouseZone')
    .insert({
      id:           randomUUID(),
      warehouse_id,
      code:         finalCode,
      name:         name.trim(),
      category:     category?.trim() || null,
      sort_order:   nextSort,
      created_by:   actorName,
      updated_by:   actorName,
      updated_at:   t,
    })
    .select('id, warehouse_id, code, name, category, sort_order, pick_rank, slot_group, flow_type, is_active, created_at, updated_at, created_by, updated_by')
    .single()

  if (error) {
    if ((error as { code?: string }).code === '23505') return fail(res, `Mã khu vực "${finalCode}" đã tồn tại trong kho này`, 409)
    return fail(res, error.message, 500)
  }
  res.json({ success: true, data })
}

export async function updateZone(req: Request, res: Response) {
  const { id } = req.params
  const { name, category, is_active, pick_rank, slot_group, flow_type } = req.body as {
    name?: string; category?: string | null; is_active?: boolean; pick_rank?: number | null
    slot_group?: string | null; flow_type?: string | null
  }

  const actor = req.user
  const scopeCats = scopeCategoriesOf(req)
  if (actor?.warehouse_scope === 'ASSIGNED' || scopeCats) {
    const { data: target } = await supabase.from('WarehouseZone').select('warehouse_id, category').eq('id', id).single()
    if (!target) return fail(res, 'Không tìm thấy khu vực', 404)
    if (actor?.warehouse_scope === 'ASSIGNED') {
      const allowed: string[] = actor.warehouse_ids ?? []
      if (!allowed.includes((target as any).warehouse_id)) return fail(res, 'Không có quyền thao tác trên kho này', 403)
    }
    // Khu vực đang gắn loại ngoài scope → không được sửa; đổi sang loại ngoài scope cũng chặn
    if (!categoryAllowed(req, (target as any).category)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)
  }
  if (category !== undefined && !categoryAllowed(req, category?.trim() || null)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor?.name || null }
  if (name !== undefined) updates.name = name.trim()
  if (category !== undefined) updates.category = category?.trim() || null
  if (is_active !== undefined) updates.is_active = is_active
  // Hạng nhặt (slotting): 1 = gần cửa xuất nhất; null = chưa xếp hạng (khu bị loại khỏi gợi ý)
  if (pick_rank !== undefined) {
    const n = pick_rank === null ? null : Number(pick_rank)
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 999)) return fail(res, 'Hạng nhặt phải là số nguyên 1–999')
    updates.pick_rank = n
  }
  // Nhóm riêng (slotting — vd SCA lạnh): khu chỉ nhận mã cùng nhóm; trống = khu thường
  if (slot_group !== undefined) updates.slot_group = slot_group ? String(slot_group).trim().toUpperCase() : null
  // Luồng cửa (slotting): SAME_END = xuất nhập cùng 1 đầu; FLOW_THROUGH = nhập 1 đầu xuất 1 đầu
  if (flow_type !== undefined) {
    if (flow_type !== null && !['SAME_END', 'FLOW_THROUGH'].includes(flow_type)) return fail(res, 'flow_type phải là SAME_END / FLOW_THROUGH / null')
    updates.flow_type = flow_type
  }

  const { data, error } = await supabase
    .from('WarehouseZone')
    .update(updates)
    .eq('id', id)
    .select('id, warehouse_id, code, name, category, sort_order, pick_rank, slot_group, flow_type, is_active, created_at, updated_at, created_by, updated_by')
    .single()

  if (error) return fail(res, error.message, 500)
  res.json({ success: true, data })
}

export async function deleteZone(req: Request, res: Response) {
  const { id } = req.params

  const { data: zone } = await supabase
    .from('WarehouseZone')
    .select('code, warehouse_id, category')
    .eq('id', id)
    .single()

  if (zone) {
    const deleteActor = req.user
    if (deleteActor?.warehouse_scope === 'ASSIGNED') {
      const allowed: string[] = deleteActor.warehouse_ids ?? []
      if (!allowed.includes((zone as any).warehouse_id)) return fail(res, 'Không có quyền thao tác trên kho này', 403)
    }
    if (!categoryAllowed(req, (zone as any).category)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)

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
