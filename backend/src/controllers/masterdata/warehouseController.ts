import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

function extractCount(arr: unknown): number {
  if (Array.isArray(arr) && arr.length > 0) return (arr[0] as { count: number }).count ?? 0
  return 0
}

export async function listWarehouses(req: Request, res: Response) {
  try {
    const onlyActive = req.query.active === 'true'
    let query = supabase.from('Warehouse').select('*, Location(count), Employee(count)').order('name')
    if (onlyActive) query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) throw error

    const result = (data ?? []).map((w) => {
      const { Location, Employee, ...rest } = w as Record<string, unknown>
      return { ...rest, _count: { locations: extractCount(Location), employees: extractCount(Employee) } }
    })
    ok(res, result)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getWarehouse(req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('Warehouse').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')

    const { data: locs, error: locErr } = await supabase
      .from('Location')
      .select('sub_code, sub_name, sub_type')
      .eq('warehouse_id', req.params.id)
      .eq('is_active', true)
      .order('sub_code')
    if (locErr) throw locErr

    const groupMap = new Map<string, { sub_code: string; sub_name: string | null; sub_type: string | null; location_count: number }>()
    for (const loc of locs ?? []) {
      const key = loc.sub_code
      if (!groupMap.has(key)) groupMap.set(key, { sub_code: loc.sub_code, sub_name: loc.sub_name, sub_type: loc.sub_type, location_count: 0 })
      groupMap.get(key)!.location_count++
    }

    ok(res, { ...data, sub_groups: Array.from(groupMap.values()) })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createWarehouse(req: Request, res: Response) {
  try {
    const { code, name, address } = req.body
    if (!code || !name) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu code hoặc name')

    const { data, error } = await supabase
      .from('Warehouse')
      .insert({ id: randomUUID(), code: String(code).toUpperCase().trim(), name: String(name).trim(), address, updated_at: new Date().toISOString() })
      .select().single()

    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', 'Mã kho đã tồn tại')
      throw error
    }
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function updateWarehouse(req: Request, res: Response) {
  try {
    const { name, address, is_active } = req.body
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) patch.name = String(name).trim()
    if (address !== undefined) patch.address = address
    if (is_active !== undefined) patch.is_active = Boolean(is_active)

    const { data, error } = await supabase
      .from('Warehouse').update(patch).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function deleteWarehouse(req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('Warehouse').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}
