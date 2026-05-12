import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { randomUUID } from 'crypto'

const ENTRY_SELECT = `
  id, pallet_code, location_id, material_id, manufacturer_id, cycle, machine_code,
  pallet_sequence_no, qa_status_id, stack_layer, cartons_imported, cartons_remaining,
  production_date, status, import_date, update_date, adjustment_qty, stocktake_at,
  created_at, updated_at,
  location:Location(id, location_code, sub_code),
  material:Material(id, material_code, short_name, shelf_life_days),
  manufacturer:Manufacturer(id, code, name),
  qa_status:QAStatus(id, code, name),
  created_by_emp:Employee!created_by(id, name),
  updated_by_emp:Employee!updated_by(id, name),
  stocktake_by_emp:Employee!stocktake_by(id, name)
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

const ACTIVE_STATUSES = ['IN_STOCK', 'PARTIAL', 'EXPORTED']

export async function adjustInventory(req: Request, res: Response) {
  const { id } = req.params
  const { adjustment, stocktake_by } = req.body as { adjustment: number; stocktake_by?: string }

  if (typeof adjustment !== 'number' || adjustment === 0) {
    return fail(res, 400, 'INVALID_INPUT', 'adjustment phải là số khác 0')
  }

  const { data: entry, error: fetchErr } = await (supabase.from('InventoryEntry') as any)
    .select('id, cartons_remaining, cartons_imported, adjustment_qty, status')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr || !entry) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')

  const newRemaining = Number(entry.cartons_remaining ?? 0) + adjustment
  if (newRemaining < 0) return fail(res, 400, 'INVALID_INPUT', 'Tồn kho không thể âm')

  const now = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  let newStatus = entry.status
  if (ACTIVE_STATUSES.includes(entry.status)) {
    if (newRemaining <= 0) newStatus = 'EXPORTED'
    else if (newRemaining >= Number(entry.cartons_imported)) newStatus = 'IN_STOCK'
    else newStatus = 'PARTIAL'
  }

  const patch: Record<string, any> = {
    cartons_remaining: newRemaining,
    adjustment_qty:    Number(entry.adjustment_qty ?? 0) + adjustment,
    status:            newStatus,
    updated_at:        now,
    update_date:       vnDate,
  }

  if (stocktake_by) {
    patch.stocktake_by = stocktake_by
    patch.stocktake_at = now
  }

  const { data: updated, error: updateErr } = await (supabase.from('InventoryEntry') as any)
    .update(patch)
    .eq('id', id)
    .select(ENTRY_SELECT)
    .single()

  if (updateErr) return fail(res, 500, 'DB_ERROR', updateErr.message)
  return ok(res, { entry: updated })
}
