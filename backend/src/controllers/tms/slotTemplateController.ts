import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

export async function listSlotTemplates(req: Request, res: Response) {
  try {
    const { warehouse_id, vehicle_type_id } = req.query as Record<string, string>
    if (!warehouse_id) return fail(res, 'warehouse_id là bắt buộc', 400)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('SlotTemplate') as any)
      .select('*, vehicle_type:VehicleType(id, code, name)')
      .eq('warehouse_id', warehouse_id)
      .order('vehicle_type_id').order('day_of_week').order('time_from')
    if (vehicle_type_id) q = q.eq('vehicle_type_id', vehicle_type_id)
    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, data ?? [])
  } catch (e) { return fail(res, String(e)) }
}

export async function createSlotTemplate(req: Request, res: Response) {
  try {
    const { warehouse_id, vehicle_type_id, cargo_type = 'ALL', days_of_week, time_from, time_to, max_vehicles } = req.body as {
      warehouse_id: string; vehicle_type_id: string; cargo_type?: string
      days_of_week: number[]; time_from: string; time_to: string; max_vehicles: number
    }
    if (!warehouse_id || !vehicle_type_id || !days_of_week?.length || !time_from || !time_to || !max_vehicles)
      return fail(res, 'Thiếu thông tin bắt buộc', 400)
    const now = new Date().toISOString()
    const actor = (req as any).user?.name || null
    const rows = days_of_week.map(dow => ({
      id: randomUUID(), warehouse_id, vehicle_type_id, cargo_type,
      day_of_week: dow, time_from, time_to, max_vehicles: Number(max_vehicles),
      is_active: true, created_at: now, updated_at: now,
      created_by: actor, updated_by: actor,
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('SlotTemplate') as any)
      .insert(rows).select('*, vehicle_type:VehicleType(id, code, name)')
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateSlotTemplate(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { time_from, time_to, max_vehicles, cargo_type, is_active } = req.body as {
      time_from?: string; time_to?: string; max_vehicles?: number
      cargo_type?: string; is_active?: boolean
    }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: (req as any).user?.name || null }
    if (time_from    !== undefined) updates.time_from    = time_from
    if (time_to      !== undefined) updates.time_to      = time_to
    if (max_vehicles !== undefined) updates.max_vehicles = Number(max_vehicles)
    if (cargo_type   !== undefined) updates.cargo_type   = cargo_type
    if (is_active    !== undefined) updates.is_active    = is_active
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('SlotTemplate') as any)
      .update(updates).eq('id', id).select('*, vehicle_type:VehicleType(id, code, name)').single()
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteSlotTemplate(req: Request, res: Response) {
  try {
    const { id } = req.params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('SlotTemplate') as any).delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { message: 'Đã xóa' })
  } catch (e) { return fail(res, String(e)) }
}
