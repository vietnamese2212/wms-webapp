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
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}
