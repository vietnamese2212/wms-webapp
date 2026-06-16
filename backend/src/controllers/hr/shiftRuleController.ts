import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

const SEL = 'id, from_shift, to_shift'

export async function listShiftRules(_req: Request, res: Response) {
  try {
    const { data, error } = await supabase.from('ShiftRestRule').select(SEL).order('from_shift').order('to_shift')
    if (error) return fail(res, error.message)
    return ok(res, data ?? [])
  } catch (e) { return fail(res, String(e)) }
}

export async function createShiftRule(req: Request, res: Response) {
  try {
    const { from_shift, to_shift } = req.body as { from_shift?: string; to_shift?: string }
    if (!from_shift || !to_shift) return fail(res, 'from_shift, to_shift là bắt buộc', 400)
    if (from_shift === to_shift) return fail(res, 'Ca trước và ca sau không được trùng', 400)
    const { data, error } = await supabase.from('ShiftRestRule')
      .insert({ id: randomUUID(), from_shift, to_shift, created_at: new Date().toISOString() }).select(SEL).single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteShiftRule(req: Request, res: Response) {
  try {
    const { error } = await supabase.from('ShiftRestRule').delete().eq('id', req.params.id)
    if (error) return fail(res, error.message)
    return ok(res, { deleted: true })
  } catch (e) { return fail(res, String(e)) }
}

// Map quy tắc: from_shift -> Set(to_shift bị cấm). Dùng trong autoAssign.
export async function loadShiftRuleMap(): Promise<Map<string, Set<string>>> {
  const { data } = await supabase.from('ShiftRestRule').select('from_shift, to_shift')
  const m = new Map<string, Set<string>>()
  for (const r of (data ?? []) as { from_shift: string; to_shift: string }[]) {
    const s = m.get(r.from_shift) ?? new Set<string>()
    s.add(r.to_shift); m.set(r.from_shift, s)
  }
  return m
}
