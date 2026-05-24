import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

export async function listVehicleTypes(req: Request, res: Response) {
  try {
    const { is_active } = req.query as Record<string, string>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('VehicleType') as any).select('*').order('name')
    if (is_active !== undefined) q = q.eq('is_active', is_active === 'true')
    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, data ?? [])
  } catch (e) { return fail(res, String(e)) }
}

export async function createVehicleType(req: Request, res: Response) {
  try {
    const { code, name } = req.body as { code: string; name: string }
    if (!code || !name) return fail(res, 'code và name là bắt buộc', 400)
    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('VehicleType') as any)
      .insert({ id: randomUUID(), code: code.toUpperCase().trim(), name: name.trim(), is_active: true, created_at: now, updated_at: now })
      .select().single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateVehicleType(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { code, is_active } = req.body as { code?: string; is_active?: boolean }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (code      !== undefined) updates.code      = code.toUpperCase().trim()
    if (is_active !== undefined) updates.is_active = is_active
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('VehicleType') as any)
      .update(updates).eq('id', id).select().single()
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}
