import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

// Helper: fetch related ncc + vehicle_type and merge into vehicle rows
// Avoids PostgREST FK-join syntax which requires schema-cache to know about FKs
async function withRelations(vehicles: Record<string, unknown>[]) {
  if (!vehicles.length) return vehicles
  const nccIds = [...new Set(vehicles.map(v => v.ncc_id as string))]
  const vtIds  = [...new Set(vehicles.map(v => v.vehicle_type_id as string))]
  const [{ data: nccs }, { data: vts }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('TransportCompany') as any).select('id, code, name').in('id', nccIds),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('VehicleType') as any).select('id, code, name').in('id', vtIds),
  ])
  return vehicles.map(v => ({
    ...v,
    ncc:          (nccs ?? []).find((n: Record<string, unknown>) => n.id === v.ncc_id)          ?? null,
    vehicle_type: (vts  ?? []).find((t: Record<string, unknown>) => t.id === v.vehicle_type_id) ?? null,
  }))
}

export async function listVehicles(req: Request, res: Response) {
  try {
    const { ncc_id, is_active } = req.query as Record<string, string>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('Vehicle') as any).select('*').order('license_plate')
    if (ncc_id)             q = q.eq('ncc_id', ncc_id)
    if (is_active !== undefined) q = q.eq('is_active', is_active === 'true')
    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, await withRelations(data ?? []))
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
      .select('*').single()
    if (error) return fail(res, error.message)
    const [merged] = await withRelations([data])
    return ok(res, merged, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateVehicle(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { ncc_id, license_plate, vehicle_type_id, is_active } = req.body as {
      ncc_id?: string; license_plate?: string; vehicle_type_id?: string; is_active?: boolean
    }

    // Lấy biển số cũ trước khi update (để cascade sang Employee)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current } = await (supabase.from('Vehicle') as any)
      .select('license_plate, ncc_id').eq('id', id).single()
    const oldPlate = (current as { license_plate: string; ncc_id: string } | null)?.license_plate ?? null
    const vehicleNccId = (current as { license_plate: string; ncc_id: string } | null)?.ncc_id ?? null

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (ncc_id          !== undefined) updates.ncc_id          = ncc_id
    if (license_plate   !== undefined) updates.license_plate   = license_plate.toUpperCase().replace(/\s+/g, '')
    if (vehicle_type_id !== undefined) updates.vehicle_type_id = vehicle_type_id
    if (is_active       !== undefined) updates.is_active       = is_active

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('Vehicle') as any)
      .update(updates).eq('id', id).select('*').single()
    if (error) return fail(res, error.message)

    // Cascade biển số mới sang employee_code của lái xe gắn với xe này
    const newPlate = updates.license_plate as string | undefined
    if (newPlate && oldPlate && newPlate !== oldPlate && vehicleNccId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('Employee') as any)
        .update({ employee_code: newPlate, updated_at: new Date().toISOString() })
        .eq('employee_code', oldPlate)
        .eq('ncc_id', vehicleNccId)
        .eq('is_driver', true)
    }

    const [merged] = await withRelations([data])
    return ok(res, merged)
  } catch (e) { return fail(res, String(e)) }
}
