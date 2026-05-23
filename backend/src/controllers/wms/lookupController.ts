import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'

function fail(res: Response, message: string, status = 400) {
  return res.status(status).json({ success: false, error: { message } })
}

export async function listLookup(req: Request, res: Response) {
  const { type } = req.query as { type?: string }
  if (!type) return fail(res, 'type là bắt buộc')

  const { data, error } = await supabase
    .from('LookupValue')
    .select('id, value, sort_order')
    .eq('type', type)
    .order('sort_order')
    .order('created_at')

  if (error) return fail(res, error.message, 500)
  res.json({ success: true, data })
}

export async function addLookup(req: Request, res: Response) {
  const { type, value } = req.body as { type?: string; value?: string }
  if (!type || !value?.trim()) return fail(res, 'type và value là bắt buộc')

  const t = new Date().toISOString()
  const { data: existing } = await supabase
    .from('LookupValue')
    .select('id, sort_order')
    .eq('type', type)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextSort = existing?.length ? Number((existing[0] as any).sort_order ?? 0) + 1 : 1

  const { data, error } = await supabase
    .from('LookupValue')
    .insert({ id: randomUUID(), type, value: value.trim(), sort_order: nextSort, updated_at: t })
    .select('id, value, sort_order')
    .single()

  if (error) {
    if (error.code === '23505') return fail(res, `"${value.trim()}" đã tồn tại`)
    return fail(res, error.message, 500)
  }
  res.json({ success: true, data })
}

export async function updateLookup(req: Request, res: Response) {
  const { id } = req.params
  const { value } = req.body as { value?: string }
  if (!value?.trim()) return fail(res, 'value là bắt buộc')

  const { data, error } = await supabase
    .from('LookupValue')
    .update({ value: value.trim(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, value, sort_order')
    .single()

  if (error) {
    if (error.code === '23505') return fail(res, `"${value.trim()}" đã tồn tại`)
    return fail(res, error.message, 500)
  }
  res.json({ success: true, data })
}

export async function deleteLookup(req: Request, res: Response) {
  const { id } = req.params
  const { error } = await supabase.from('LookupValue').delete().eq('id', id)
  if (error) return fail(res, error.message, 500)
  res.json({ success: true })
}
