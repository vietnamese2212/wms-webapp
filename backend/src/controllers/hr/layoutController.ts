import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

const actorOf = (req: Request): string | null => (req as { user?: { name?: string } }).user?.name ?? null
const now = () => new Date().toISOString()
const LAYOUT_SELECT = 'id, warehouse_id, name, note, is_active, created_at, updated_at'

// skill của layout, kèm tên skill + chức danh (phục vụ nhãn vị trí)
export async function layoutSkillsDetailed(layout_id: string) {
  const { data: ls } = await supabase.from('WorkLayoutSkill')
    .select('id, skill_id, required_count, sort_order').eq('layout_id', layout_id).order('sort_order')
  const rows = (ls ?? []) as { id: string; skill_id: string; required_count: number; sort_order: number }[]
  if (!rows.length) return []
  const skillIds = rows.map(r => r.skill_id)
  const { data: skills } = await supabase.from('Skill').select('id, name, shift_tag, job_title_id').in('id', skillIds)
  const jtIds = [...new Set((skills ?? []).map((s: { job_title_id: string | null }) => s.job_title_id).filter(Boolean))] as string[]
  const { data: jts } = jtIds.length ? await supabase.from('JobTitle').select('id, name').in('id', jtIds) : { data: [] }
  const jtMap = new Map((jts ?? []).map((j: { id: string; name: string }) => [j.id, j.name]))
  const skMap = new Map((skills ?? []).map((s: { id: string; name: string; shift_tag: string | null; job_title_id: string | null }) =>
    [s.id, { name: s.name, shift_tag: s.shift_tag, job_title: s.job_title_id ? jtMap.get(s.job_title_id) ?? null : null }]))
  return rows.map(r => ({ ...r, ...(skMap.get(r.skill_id) ?? { name: '—', shift_tag: null, job_title: null }) }))
}

export async function listLayouts(req: Request, res: Response) {
  try {
    const { warehouse_id, include_inactive } = req.query as Record<string, string>
    let q = supabase.from('WorkLayout').select(LAYOUT_SELECT).order('name')
    if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)
    if (include_inactive !== 'true') q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) return fail(res, error.message)
    const layouts = (data ?? []) as { id: string }[]
    if (!layouts.length) return ok(res, [])
    const { data: counts } = await supabase.from('WorkLayoutSkill').select('layout_id, required_count').in('layout_id', layouts.map(l => l.id))
    const cnt = new Map<string, { positions: number; people: number }>()
    for (const c of (counts ?? []) as { layout_id: string; required_count: number }[]) {
      const cur = cnt.get(c.layout_id) ?? { positions: 0, people: 0 }
      cur.positions += 1; cur.people += c.required_count
      cnt.set(c.layout_id, cur)
    }
    return ok(res, layouts.map(l => ({ ...l, ...(cnt.get(l.id) ?? { positions: 0, people: 0 }) })))
  } catch (e) { return fail(res, String(e)) }
}

// chức danh gắn với layout (để gọi đúng nhóm người khi tự xếp)
export async function layoutJobTitleIds(layout_id: string): Promise<string[]> {
  const { data } = await supabase.from('WorkLayoutJobTitle').select('job_title_id').eq('layout_id', layout_id)
  return (data ?? []).map((r: { job_title_id: string }) => r.job_title_id)
}

export async function getLayout(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { data: layout } = await supabase.from('WorkLayout').select(LAYOUT_SELECT).eq('id', id).maybeSingle()
    if (!layout) return fail(res, 'Không tìm thấy layout', 404)
    const skills = await layoutSkillsDetailed(id)
    const job_title_ids = await layoutJobTitleIds(id)
    return ok(res, { ...layout, skills, job_title_ids })
  } catch (e) { return fail(res, String(e)) }
}

// Thay toàn bộ chức danh của layout
export async function setLayoutJobTitles(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { job_title_ids } = req.body as { job_title_ids?: string[] }
    await supabase.from('WorkLayoutJobTitle').delete().eq('layout_id', id)
    const ids = [...new Set((job_title_ids ?? []).filter(Boolean))]
    if (ids.length) {
      const { error } = await supabase.from('WorkLayoutJobTitle').insert(
        ids.map(jt => ({ id: randomUUID(), layout_id: id, job_title_id: jt, created_at: now() }))
      )
      if (error) return fail(res, error.message)
    }
    await supabase.from('WorkLayout').update({ updated_at: now(), updated_by: actorOf(req) }).eq('id', id)
    return ok(res, { layout_id: id, count: ids.length })
  } catch (e) { return fail(res, String(e)) }
}

export async function createLayout(req: Request, res: Response) {
  try {
    const { warehouse_id, name, note } = req.body as { warehouse_id?: string; name?: string; note?: string }
    if (!warehouse_id || !name?.trim()) return fail(res, 'warehouse_id và name là bắt buộc', 400)
    const actor = actorOf(req)
    const { data, error } = await supabase.from('WorkLayout').insert({
      id: randomUUID(), warehouse_id, name: name.trim(), note: note || null, is_active: true,
      created_at: now(), updated_at: now(), created_by: actor, updated_by: actor,
    }).select(LAYOUT_SELECT).single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateLayout(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { name, note, is_active } = req.body as { name?: string; note?: string; is_active?: boolean }
    const updates: Record<string, unknown> = { updated_at: now(), updated_by: actorOf(req) }
    if (name      !== undefined) updates.name      = name.trim()
    if (note      !== undefined) updates.note      = note || null
    if (is_active !== undefined) updates.is_active = is_active
    const { data, error } = await supabase.from('WorkLayout').update(updates).eq('id', id).select(LAYOUT_SELECT).single()
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteLayout(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { count } = await supabase.from('WorkAssignmentSheet').select('id', { count: 'exact', head: true }).eq('layout_id', id)
    if ((count ?? 0) > 0) {
      const { error } = await supabase.from('WorkLayout').update({ is_active: false, updated_at: now(), updated_by: actorOf(req) }).eq('id', id)
      if (error) return fail(res, error.message)
      return ok(res, { deleted: 'soft', message: 'Layout đã dùng trong phiếu — đã ẩn' })
    }
    const { error } = await supabase.from('WorkLayout').delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { deleted: 'hard' })
  } catch (e) { return fail(res, String(e)) }
}

// Thay toàn bộ skill của layout
export async function setLayoutSkills(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { skills } = req.body as { skills?: { skill_id: string; required_count: number; sort_order?: number }[] }
    await supabase.from('WorkLayoutSkill').delete().eq('layout_id', id)
    const valid = (skills ?? []).filter(s => s.skill_id && s.required_count > 0)
    if (valid.length) {
      const { error } = await supabase.from('WorkLayoutSkill').insert(valid.map((s, i) => ({
        id: randomUUID(), layout_id: id, skill_id: s.skill_id, required_count: s.required_count,
        sort_order: s.sort_order ?? i, created_at: now(), updated_at: now(),
      })))
      if (error) return fail(res, error.message)
    }
    await supabase.from('WorkLayout').update({ updated_at: now(), updated_by: actorOf(req) }).eq('id', id)
    return ok(res, { layout_id: id, count: valid.length })
  } catch (e) { return fail(res, String(e)) }
}
