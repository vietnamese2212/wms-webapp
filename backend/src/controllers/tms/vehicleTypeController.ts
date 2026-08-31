import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { applyBoxDims } from '../../utils/boxDims'

export async function listVehicleTypes(req: Request, res: Response) {
  try {
    const { is_active } = req.query as Record<string, string>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = supabase.from('VehicleType').select('*').order('name')
    if (is_active !== undefined) q = q.eq('is_active', is_active === 'true')
    const { data, error } = await q
    if (error) return fail(res, error.message)
    // Sắp theo sort_order (resilient: thiếu cột → undefined→0 → giữ thứ tự tên SQL đã trả; sort ổn định)
    const sorted = [...((data ?? []) as Record<string, unknown>[])]
      .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    return ok(res, sorted)
  } catch (e) { return fail(res, String(e)) }
}

// Kéo-thả sắp thứ tự loại xe — set sort_order theo vị trí mảng ids
export async function reorderVehicleTypes(req: Request, res: Response) {
  try {
    const { ids } = req.body as { ids?: string[] }
    if (!Array.isArray(ids) || ids.length === 0) return fail(res, 'ids là bắt buộc', 400)
    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actor = req.user?.name || null
    const results = await Promise.all(
      ids.map((id, i) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.from('VehicleType')
          .update({ sort_order: i + 1, updated_at: now, updated_by: actor })
          .eq('id', id),
      ),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = results.find((r: any) => r.error)?.error
    if (err) return fail(res, err.message)
    return ok(res, { reordered: ids.length })
  } catch (e) { return fail(res, String(e)) }
}

export async function createVehicleType(req: Request, res: Response) {
  try {
    const { code, name, box_length_mm, box_width_mm, box_height_mm, is_pallet_truck } = req.body as { code: string; name: string; box_length_mm?: number | null; box_width_mm?: number | null; box_height_mm?: number | null; is_pallet_truck?: boolean }
    if (!code || !name) return fail(res, 'code và name là bắt buộc', 400)
    const dims: Record<string, unknown> = {}
    const dimErr = applyBoxDims({ box_length_mm, box_width_mm, box_height_mm }, dims)
    if (dimErr) return fail(res, dimErr, 400)
    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actor = req.user?.name || null
    const { data, error } = await supabase.from('VehicleType')
      .insert({
        id: randomUUID(), code: code.toUpperCase().trim(), name: name.trim(), is_active: true,
        ...dims,
        // Xe chở hàng ĐÃ LÊN PALLET — quyết định CÁCH VẼ sơ đồ xếp xe (26/08). Mặc định false =
        // xe thường = đúng hành vi cũ, không loại xe nào tự đổi kiểu xếp sau khi deploy.
        is_pallet_truck: Boolean(is_pallet_truck),
        created_at: now, updated_at: now, created_by: actor, updated_by: actor,
      })
      .select().single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateVehicleType(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { code, name, is_active, box_length_mm, box_width_mm, box_height_mm, is_pallet_truck } = req.body as { code?: string; name?: string; is_active?: boolean; box_length_mm?: number | null; box_width_mm?: number | null; box_height_mm?: number | null; is_pallet_truck?: boolean }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    if (code      !== undefined) updates.code      = code.toUpperCase().trim()
    if (name      !== undefined) updates.name      = name.trim()
    if (is_active !== undefined) updates.is_active = is_active
    const dimErr = applyBoxDims({ box_length_mm, box_width_mm, box_height_mm }, updates)
    if (dimErr) return fail(res, dimErr, 400)
    if (is_pallet_truck !== undefined) updates.is_pallet_truck = Boolean(is_pallet_truck)
    const { data, error } = await supabase.from('VehicleType')
      .update(updates).eq('id', id).select().maybeSingle()
    if (error) return fail(res, error.message)
    if (!data) return fail(res, 'Không tìm thấy loại xe', 404)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteVehicleType(req: Request, res: Response) {
  try {
    const { id } = req.params
    // Gác: không xóa loại xe đang được tham chiếu (Xe / Khung giờ template / Slot booking)
    const [veh, tpl, slot] = await Promise.all([
      supabase.from('Vehicle').select('id', { count: 'exact', head: true }).eq('vehicle_type_id', id),
      supabase.from('SlotTemplate').select('id', { count: 'exact', head: true }).eq('vehicle_type_id', id),
      supabase.from('DeliverySlot').select('id', { count: 'exact', head: true }).eq('vehicle_type_id', id),
    ])
    const used = (veh.count ?? 0) + (tpl.count ?? 0) + (slot.count ?? 0)
    if (used > 0) {
      const parts = []
      if (veh.count)  parts.push(`${veh.count} xe`)
      if (tpl.count)  parts.push(`${tpl.count} khung giờ`)
      if (slot.count) parts.push(`${slot.count} lịch booking`)
      return fail(res, `Không thể xóa: loại xe đang được dùng bởi ${parts.join(', ')}. Hãy gỡ liên kết trước hoặc đặt Tạm dừng.`, 409)
    }
    const { error } = await supabase.from('VehicleType').delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { deleted: id })
  } catch (e) { return fail(res, String(e)) }
}
