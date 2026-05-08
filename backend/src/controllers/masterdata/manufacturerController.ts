import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

function extractCount(arr: unknown): number {
  if (Array.isArray(arr) && arr.length > 0) return (arr[0] as { count: number }).count ?? 0
  return 0
}

export async function listManufacturers(req: Request, res: Response) {
  try {
    const onlyActive = req.query.active === 'true'
    let query = supabase.from('Manufacturer').select('*, Material(count)').order('code')
    if (onlyActive) query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) throw error

    const result = (data ?? []).map((m) => {
      const { Material, ...rest } = m as Record<string, unknown>
      return { ...rest, _count: { materials: extractCount(Material) } }
    })
    ok(res, result)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getManufacturer(req: Request, res: Response) {
  try {
    const [{ data: mfr, error: mErr }, { data: mats, error: matErr }] = await Promise.all([
      supabase.from('Manufacturer').select('*').eq('id', req.params.id).maybeSingle(),
      supabase.from('Material').select('*').eq('manufacturer_id', req.params.id).eq('is_active', true).order('material_code'),
    ])
    if (mErr) throw mErr
    if (matErr) throw matErr
    if (!mfr) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy nhà máy')
    ok(res, { ...mfr, materials: mats ?? [] })
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createManufacturer(req: Request, res: Response) {
  try {
    const { code, name } = req.body
    if (!code) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu code')

    const { data, error } = await supabase
      .from('Manufacturer')
      .insert({ code: String(code).trim(), name: name ? String(name).trim() : null })
      .select().single()

    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', 'Mã nhà máy đã tồn tại')
      throw error
    }
    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function updateManufacturer(req: Request, res: Response) {
  try {
    const { name, is_active } = req.body
    const patch: Record<string, unknown> = {}
    if (name !== undefined) patch.name = String(name).trim()
    if (is_active !== undefined) patch.is_active = Boolean(is_active)

    const { data, error } = await supabase
      .from('Manufacturer').update(patch).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy nhà máy')
    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function deleteManufacturer(req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('Manufacturer').update({ is_active: false }).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy nhà máy')
    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}
