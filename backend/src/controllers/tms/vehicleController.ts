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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = (req as any).user?.ncc_id ?? null
    const { ncc_id, is_active, unassigned } = req.query as Record<string, string>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('Vehicle') as any).select('*').order('license_plate')
    // ĐVVT user: chỉ được xem xe của mình
    if (userNccId)               q = q.eq('ncc_id', userNccId)
    else if (ncc_id)             q = q.eq('ncc_id', ncc_id)
    if (is_active !== undefined) q = q.eq('is_active', is_active === 'true')
    const { data, error } = await q
    if (error) return fail(res, error.message)

    let vehicles = (data ?? []) as Record<string, unknown>[]

    // Lọc xe chưa có tài khoản lái xe (kể cả soft-deleted)
    if (unassigned === 'true' && vehicles.length > 0) {
      const plates = vehicles.map(v => v.license_plate as string)
      const nccIds = [...new Set(vehicles.map(v => v.ncc_id as string))]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: drivers } = await (supabase.from('Employee') as any)
        .select('employee_code, ncc_id')
        .in('employee_code', plates)
        .in('ncc_id', nccIds)
        .eq('is_driver', true)
      if (drivers?.length) {
        const assigned = new Set(
          (drivers as { employee_code: string; ncc_id: string }[]).map(d => `${d.employee_code}|${d.ncc_id}`)
        )
        vehicles = vehicles.filter(v => !assigned.has(`${v.license_plate}|${v.ncc_id}`))
      }
    }

    return ok(res, await withRelations(vehicles))
  } catch (e) { return fail(res, String(e)) }
}

export async function createVehicle(req: Request, res: Response) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = (req as any).user?.ncc_id ?? null
    const { ncc_id, license_plate, vehicle_type_id } = req.body as {
      ncc_id: string; license_plate: string; vehicle_type_id: string
    }
    // ĐVVT user: chỉ được thêm xe cho công ty của mình
    if (userNccId && ncc_id && ncc_id !== userNccId)
      return fail(res, 'Bạn chỉ được thêm xe cho ĐVVT của mình', 403)
    const effectiveNccId = userNccId ?? ncc_id
    if (!effectiveNccId || !license_plate || !vehicle_type_id)
      return fail(res, 'ncc_id, license_plate, vehicle_type_id là bắt buộc', 400)
    const now = new Date().toISOString()
    const plate = license_plate.toUpperCase().replace(/\s+/g, '')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('Vehicle') as any)
      .insert({ id: randomUUID(), ncc_id: effectiveNccId, license_plate: plate, vehicle_type_id, is_active: true, created_at: now, updated_at: now })
      .select('*').single()
    if (error) return fail(res, error.message)
    const [merged] = await withRelations([data])
    return ok(res, merged, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateVehicle(req: Request, res: Response) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = (req as any).user?.ncc_id ?? null
    const { id } = req.params
    const { ncc_id, vehicle_type_id, is_active } = req.body as {
      ncc_id?: string; vehicle_type_id?: string; is_active?: boolean
    }

    // Lấy thông tin xe hiện tại để cascade is_active → employee
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current } = await (supabase.from('Vehicle') as any)
      .select('license_plate, ncc_id').eq('id', id).single()
    const currentPlate = (current as { license_plate: string; ncc_id: string } | null)?.license_plate ?? null
    const currentNccId = (current as { license_plate: string; ncc_id: string } | null)?.ncc_id ?? null

    // ĐVVT user: chỉ được sửa xe của mình
    if (userNccId && currentNccId && currentNccId !== userNccId)
      return fail(res, 'Bạn không có quyền chỉnh sửa xe này', 403)

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (ncc_id          !== undefined) updates.ncc_id          = ncc_id
    if (vehicle_type_id !== undefined) updates.vehicle_type_id = vehicle_type_id
    if (is_active       !== undefined) updates.is_active       = is_active

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('Vehicle') as any)
      .update(updates).eq('id', id).select('*').single()
    if (error) return fail(res, error.message)

    // Cascade xuống driver employee (khóa theo plate + ncc cũ):
    // - đổi ĐVVT (ncc_id) → di chuyển driver theo xe (giữ tài khoản đăng nhập khớp ncc mới)
    // - is_active → soft-delete / restore driver
    // (KHÔNG đụng dữ liệu lịch sử: booking/gate lưu biển số + tên NCC dạng snapshot text.)
    if (currentPlate && currentNccId) {
      const now = new Date().toISOString()
      const empUpdate: Record<string, unknown> = { updated_at: now }
      if (ncc_id !== undefined && ncc_id !== currentNccId) empUpdate.ncc_id = ncc_id
      if (is_active !== undefined) {
        empUpdate.is_active  = is_active
        empUpdate.deleted_at = is_active ? null : now
      }
      // chỉ ghi khi có thay đổi thực (ngoài updated_at)
      if (Object.keys(empUpdate).length > 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('Employee') as any)
          .update(empUpdate)
          .eq('employee_code', currentPlate)
          .eq('ncc_id', currentNccId)
          .eq('is_driver', true)
      }
    }

    const [merged] = await withRelations([data])
    return ok(res, merged)
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteVehicle(req: Request, res: Response) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = (req as any).user?.ncc_id ?? null
    const { id } = req.params

    // Lấy thông tin xe trước khi xóa
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vehicle } = await (supabase.from('Vehicle') as any)
      .select('license_plate, ncc_id').eq('id', id).single()
    const plate  = (vehicle as { license_plate: string; ncc_id: string } | null)?.license_plate ?? null
    const nccId  = (vehicle as { license_plate: string; ncc_id: string } | null)?.ncc_id       ?? null

    // ĐVVT user: chỉ được xóa xe của mình
    if (userNccId && nccId && nccId !== userNccId)
      return fail(res, 'Bạn không có quyền xóa xe này', 403)

    // Hard-delete driver employee gắn với xe này
    if (plate && nccId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('Employee') as any)
        .delete()
        .eq('employee_code', plate)
        .eq('ncc_id', nccId)
        .eq('is_driver', true)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('Vehicle') as any).delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { deleted: true })
  } catch (e) { return fail(res, String(e)) }
}
