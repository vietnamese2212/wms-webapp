import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

const ENTRY_SELECT = `
  id, pallet_code, location_id, material_id, manufacturer_id, cycle, machine_code,
  pallet_sequence_no, qa_status_id, stack_layer, cartons_imported, cartons_remaining,
  production_date, status, import_date, update_date, created_at, updated_at,
  location:Location(id, location_code, sub_code),
  material:Material(id, material_code, short_name),
  manufacturer:Manufacturer(id, code, name),
  qa_status:QAStatus(id, code, name)
`.trim()

export async function listInventory(req: Request, res: Response) {
  const {
    warehouse_id, location_code, material_search, qa_status_id,
    status, search, page = '1', limit = '50',
  } = req.query as Record<string, string>

  const pageNum  = Math.max(1, parseInt(page) || 1)
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50))
  const offset   = (pageNum - 1) * limitNum

  // Resolve location_ids for warehouse / location_code filters
  let locationFilter: string[] | null = null
  if (warehouse_id || location_code) {
    let q = (supabase.from('Location') as any).select('id')
    if (warehouse_id)  q = q.eq('warehouse_id', warehouse_id)
    if (location_code) q = q.ilike('location_code', `%${location_code}%`)
    const { data: locs, error: locErr } = await q
    if (locErr) return fail(res, 500, 'DB_ERROR', locErr.message)
    locationFilter = (locs ?? []).map((l: any) => l.id as string)
    if (locationFilter.length === 0)
      return ok(res, { entries: [], total: 0, page: pageNum, limit: limitNum })
  }

  // Resolve material_ids for material search
  let materialFilter: string[] | null = null
  if (material_search) {
    const { data: mats, error: matErr } = await (supabase.from('Material') as any)
      .select('id')
      .or(`material_code.ilike.%${material_search}%,short_name.ilike.%${material_search}%`)
    if (matErr) return fail(res, 500, 'DB_ERROR', matErr.message)
    materialFilter = (mats ?? []).map((m: any) => m.id as string)
    if (materialFilter.length === 0)
      return ok(res, { entries: [], total: 0, page: pageNum, limit: limitNum })
  }

  let query = (supabase.from('InventoryEntry') as any).select(ENTRY_SELECT, { count: 'exact' })

  // Status: default = IN_STOCK + PARTIAL; 'ALL' = no filter; specific value = exact match
  if (!status || status === '') {
    query = query.in('status', ['IN_STOCK', 'PARTIAL'])
  } else if (status !== 'ALL') {
    query = query.eq('status', status)
  }

  if (locationFilter) query = query.in('location_id', locationFilter)
  if (materialFilter) query = query.in('material_id', materialFilter)
  if (qa_status_id)   query = query.eq('qa_status_id', qa_status_id)
  if (search)         query = query.ilike('pallet_code', `%${search}%`)

  query = query
    .order('import_date', { ascending: false, nullsFirst: false })
    .range(offset, offset + limitNum - 1)

  const { data, count, error } = await query
  if (error) return fail(res, 500, 'DB_ERROR', error.message)

  return ok(res, { entries: data ?? [], total: count ?? 0, page: pageNum, limit: limitNum })
}
