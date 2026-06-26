import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

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
    const { code, name } = req.body as { code: string; name: string }
    if (!code || !name) return fail(res, 'code và name là bắt buộc', 400)
    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actor = req.user?.name || null
    const { data, error } = await supabase.from('VehicleType')
      .insert({ id: randomUUID(), code: code.toUpperCase().trim(), name: name.trim(), is_active: true, created_at: now, updated_at: now, created_by: actor, updated_by: actor })
      .select().single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateVehicleType(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { code, is_active } = req.body as { code?: string; is_active?: boolean }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    if (code      !== undefined) updates.code      = code.toUpperCase().trim()
    if (is_active !== undefined) updates.is_active = is_active
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from('VehicleType')
      .update(updates).eq('id', id).select().single()
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}
