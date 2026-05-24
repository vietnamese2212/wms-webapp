import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

export async function listVehicles(req: Request, res: Response) {
  try {
    const { ncc_id, is_active } = req.query as Record<string, string>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('Vehicle') as any)
      .select('*, ncc:TransportCompany!ncc_id(id, code, name), vehicle_type:VehicleType!vehicle_type_id(id, code, name)')
      .order('license_plate')
    if (ncc_id)    q = q.eq('ncc_id', ncc_id)
    if (is_active !== undefined) q = q.eq('is_active', is_active === 'true')
    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, data ?? [])
  } catch (e) { return fail(res, String(e)) }
}

export async function createVehicle(req: Request, res: Response) {
  try {
    const { ncc_id, license_plate, vehicle_type_id } = req.body as {
      ncc_id: string; license_plate: string; vehicle_type_id: string
    }
    if (!ncc_id || !license_plate || !vehicle_type_id)
      return fail(res, 'ncc_id, license_plate, vehicle_type_id là bắt buộc', 400)
    const now = new Date().toISOString()
    const plate = license_plate.toUpperCase().replace(/\s+/g, '')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('Vehicle') as any)
      .insert({ id: randomUUID(), ncc_id, license_plate: plate, vehicle_type_id, is_active: true, created_at: now, updated_at: now })
      .select('*, ncc:TransportCompany!ncc_id(id, code, name), vehicle_type:VehicleType!vehicle_type_id(id, code, name)').single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateVehicle(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { ncc_id, license_plate, vehicle_type_id, is_active } = req.body as {
      ncc_id?: string; license_plate?: string; vehicle_type_id?: string; is_active?: boolean
    }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (ncc_id          !== undefined) updates.ncc_id          = ncc_id
    if (license_plate   !== undefined) updates.license_plate   = license_plate.toUpperCase().replace(/\s+/g, '')
    if (vehicle_type_id !== undefined) updates.vehicle_type_id = vehicle_type_id
    if (is_active       !== undefined) updates.is_active       = is_active
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('Vehicle') as any)
      .update(updates).eq('id', id)
      .select('*, ncc:TransportCompany!ncc_id(id, code, name), vehicle_type:VehicleType!vehicle_type_id(id, code, name)').single()
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}
