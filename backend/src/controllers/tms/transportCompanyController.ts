import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

export async function listTransportCompanies(req: Request, res: Response) {
  try {
    const { is_active } = req.query as Record<string, string>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('TransportCompany') as any).select('*').order('name')
    if (is_active !== undefined) q = q.eq('is_active', is_active === 'true')
    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, data ?? [])
  } catch (e) { return fail(res, String(e)) }
}

export async function createTransportCompany(req: Request, res: Response) {
  try {
    const { code, name, contact_name, contact_phone } = req.body as {
      code: string; name: string; contact_name?: string; contact_phone?: string
    }
    if (!code || !name) return fail(res, 'code và name là bắt buộc', 400)
    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('TransportCompany') as any)
      .insert({
        id: randomUUID(), code: code.toUpperCase().trim(), name: name.trim(),
        contact_name: contact_name?.trim() ?? null,
        contact_phone: contact_phone?.trim() ?? null,
        is_active: true, created_at: now, updated_at: now,
      })
      .select().single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateTransportCompany(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { name, contact_name, contact_phone, is_active } = req.body as {
      name?: string; contact_name?: string; contact_phone?: string; is_active?: boolean
    }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name          !== undefined) updates.name          = name.trim()
    if (contact_name  !== undefined) updates.contact_name  = contact_name?.trim() ?? null
    if (contact_phone !== undefined) updates.contact_phone = contact_phone?.trim() ?? null
    if (is_active     !== undefined) updates.is_active     = is_active
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('TransportCompany') as any)
      .update(updates).eq('id', id).select().single()
    if (error) return fail(res, error.message)

    // Cascade is_active → tất cả xe → tất cả driver employee của ĐVVT
    if (is_active !== undefined) {
      const now = new Date().toISOString()
      // Lấy biển số xe của ĐVVT để cascade sang employee
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: vehicles } = await (supabase.from('Vehicle') as any)
        .select('license_plate').eq('ncc_id', id)
      // Cập nhật tất cả xe
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('Vehicle') as any)
        .update({ is_active, updated_at: now }).eq('ncc_id', id)
      // Cập nhật tất cả driver employee (via plate)
      if (vehicles?.length) {
        const plates = (vehicles as { license_plate: string }[]).map(v => v.license_plate)
        const empUpdate = is_active
          ? { is_active: true,  deleted_at: null, updated_at: now }
          : { is_active: false, deleted_at: now,  updated_at: now }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('Employee') as any)
          .update(empUpdate)
          .in('employee_code', plates)
          .eq('ncc_id', id)
          .eq('is_driver', true)
      }
    }

    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteTransportCompany(req: Request, res: Response) {
  try {
    const { id } = req.params

    // Lấy tất cả xe của ĐVVT
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vehicles } = await (supabase.from('Vehicle') as any)
      .select('license_plate').eq('ncc_id', id)

    if (vehicles?.length) {
      const plates = (vehicles as { license_plate: string }[]).map(v => v.license_plate)
      // Hard-delete tất cả driver employee của các xe này
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('Employee') as any)
        .delete()
        .in('employee_code', plates)
        .eq('ncc_id', id)
        .eq('is_driver', true)
      // Hard-delete tất cả xe của ĐVVT
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('Vehicle') as any).delete().eq('ncc_id', id)
    }

    // Hard-delete ĐVVT (Postgres sẽ trả lỗi FK nếu còn record tham chiếu)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('TransportCompany') as any).delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { deleted: true })
  } catch (e) { return fail(res, String(e)) }
}
