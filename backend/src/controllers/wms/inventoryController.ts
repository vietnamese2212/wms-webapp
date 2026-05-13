import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { randomUUID } from 'crypto'

const ENTRY_SELECT = `
  id, pallet_code, location_id, material_id, manufacturer_id, cycle, machine_code,
  pallet_sequence_no, qa_status_id, stack_layer, cartons_imported, cartons_remaining,
  production_date, status, import_date, update_date, adjustment_qty, stocktake_at,
  created_at, updated_at,
  location:Location(id, location_code, sub_code, sub_name, sub_type, warehouse:Warehouse(id, name, code)),
  material:Material(id, material_code, short_name, shelf_life_days, category),
  manufacturer:Manufacturer(id, code, name),
  qa_status:QAStatus(id, code, name),
  created_by_emp:Employee!created_by(id, name),
  updated_by_emp:Employee!updated_by(id, name),
  stocktake_by_emp:Employee!stocktake_by(id, name)
`.trim()

interface FilterParams {
  status?: string
  locationFilter?: string[] | null
  materialFilter?: string[] | null
  qa_status_ids?: string[]
  search?: string
  manufacturer_id?: string
  filterCycles?: string[]
  filterMachines?: string[]
  import_date_from?: string
  import_date_to?: string
}

function applyInventoryFilters(q: any, p: FilterParams): any {
  if (!p.status || p.status === '') q = q.in('status', ['IN_STOCK', 'PARTIAL'])
  else if (p.status !== 'ALL')       q = q.eq('status', p.status)

  if (p.locationFilter)                              q = q.in('location_id', p.locationFilter)
  if (p.materialFilter)                              q = q.in('material_id', p.materialFilter)
  if (p.qa_status_ids && p.qa_status_ids.length > 0) q = q.in('qa_status_id', p.qa_status_ids)
  if (p.search)          q = q.ilike('pallet_code', `%${p.search}%`)
  if (p.manufacturer_id) q = q.eq('manufacturer_id', p.manufacturer_id)
  const fCyc = p.filterCycles ?? []
  if (fCyc.length === 1)    q = q.eq('cycle', fCyc[0])
  else if (fCyc.length > 1) q = q.in('cycle', fCyc)
  const fMach = p.filterMachines ?? []
  if (fMach.length === 1)    q = q.eq('machine_code', fMach[0])
  else if (fMach.length > 1) q = q.in('machine_code', fMach)
  if (p.import_date_from) q = q.gte('import_date', p.import_date_from)
  if (p.import_date_to)   q = q.lte('import_date', p.import_date_to)
  return q
}

function parseArr(raw: string | undefined): string[] {
  return raw ? raw.split(',').filter(Boolean) : []
}

function calcPct(prodDate: string, shelfDays: number, now: number): number {
  const totalMs = shelfDays * 86_400_000
  const remaining = new Date(prodDate).getTime() + totalMs - now
  return Math.max(0, Math.round((remaining / totalMs) * 100))
}

function matchDatePct(pct: number, range: string): boolean {
  if (range === '80') return pct > 80
  if (range === '60') return pct > 60 && pct <= 80
  if (range === '30') return pct > 30 && pct <= 60
  return false
}

export async function listInventory(req: Request, res: Response) {
  const q = req.query as Record<string, string>
  const status           = q.status
  const search           = q.search
  const material_search  = q.material_search
  const manufacturer_id  = q.manufacturer_id
  const import_date_from = q.import_date_from
  const import_date_to   = q.import_date_to
  const page             = q.page  ?? '1'
  const limit            = q.limit ?? '50'

  // Multi-value params (comma-separated)
  const warehouseIds      = parseArr(q.warehouse_ids)
  const categories        = parseArr(q.categories)
  const filterLocations   = parseArr(q.filter_locations)
  const filterCycles      = parseArr(q.filter_cycles)
  const filterMachines    = parseArr(q.filter_machines)
  const filterMaterialIds = parseArr(q.filter_material_ids)
  const qa_status_ids     = parseArr(q.qa_status_ids).length > 0 ? parseArr(q.qa_status_ids) : undefined
  const datePctRanges     = parseArr(q.date_pct_ranges)

  const pageNum  = Math.max(1, parseInt(page) || 1)
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50))
  const offset   = (pageNum - 1) * limitNum

  // Resolve location_ids for warehouse / location_code filters
  let locationFilter: string[] | null = null
  if (warehouseIds.length || filterLocations.length) {
    let locQ = (supabase.from('Location') as any).select('id')
    if (warehouseIds.length === 1)     locQ = locQ.eq('warehouse_id', warehouseIds[0])
    else if (warehouseIds.length > 1)  locQ = locQ.in('warehouse_id', warehouseIds)
    if (filterLocations.length === 1)  locQ = locQ.eq('location_code', filterLocations[0])
    else if (filterLocations.length > 1) locQ = locQ.in('location_code', filterLocations)

    const { data: locs, error: locErr } = await locQ
    if (locErr) return fail(res, 500, 'DB_ERROR', locErr.message)
    locationFilter = (locs ?? []).map((l: any) => l.id as string)
    if (locationFilter.length === 0)
      return ok(res, { entries: [], total: 0, page: pageNum, limit: limitNum, total_cartons_remaining: 0 })
  }

  // Resolve material_ids for material search + category + explicit IDs
  let materialFilter: string[] | null = null
  if (material_search || categories.length || filterMaterialIds.length) {
    let matQ = (supabase.from('Material') as any).select('id')
    if (material_search)               matQ = matQ.or(`material_code.ilike.%${material_search}%,short_name.ilike.%${material_search}%`)
    if (categories.length === 1)       matQ = matQ.eq('category', categories[0])
    else if (categories.length > 1)    matQ = matQ.in('category', categories)
    if (filterMaterialIds.length > 0)  matQ = matQ.in('id', filterMaterialIds)
    const { data: mats, error: matErr } = await matQ
    if (matErr) return fail(res, 500, 'DB_ERROR', matErr.message)
    materialFilter = (mats ?? []).map((m: any) => m.id as string)
    if (materialFilter.length === 0)
      return ok(res, { entries: [], total: 0, page: pageNum, limit: limitNum, total_cartons_remaining: 0 })
  }

  const filterParams: FilterParams = {
    status, locationFilter, materialFilter, qa_status_ids, search,
    manufacturer_id, filterCycles, filterMachines, import_date_from, import_date_to,
  }

  // Pre-filter by %date: fetch ALL IDs (no pagination) with same filters, compute pct in JS
  let datePctIds: string[] | null = null
  if (datePctRanges.length > 0) {
    const { data: preEntries } = await applyInventoryFilters(
      (supabase.from('InventoryEntry') as any)
        .select('id, production_date, material:Material(shelf_life_days)')
        .limit(100_000),
      filterParams
    )
    const now = Date.now()
    datePctIds = (preEntries ?? [])
      .filter((e: any) => {
        const shelfDays = Number((e.material as any)?.shelf_life_days)
        if (!e.production_date || !shelfDays || shelfDays <= 0) return false
        const pct = calcPct(e.production_date as string, shelfDays, now)
        return datePctRanges.some(r => matchDatePct(pct, r))
      })
      .map((e: any) => e.id as string)

    if (datePctIds.length === 0)
      return ok(res, { entries: [], total: 0, page: pageNum, limit: limitNum, total_cartons_remaining: 0 })
  }

  // Main paginated query — sort by import_date desc + id asc để đảm bảo thứ tự ổn định giữa các trang
  let mainQ = applyInventoryFilters(
    (supabase.from('InventoryEntry') as any).select(ENTRY_SELECT, { count: 'exact' }),
    filterParams
  )
  if (datePctIds !== null) mainQ = mainQ.in('id', datePctIds)
  mainQ = mainQ
    .order('import_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .range(offset, offset + limitNum - 1)

  // Aggregate query (no pagination — sum cartons_remaining across all matching entries)
  let aggQ = applyInventoryFilters(
    (supabase.from('InventoryEntry') as any).select('cartons_remaining'),
    filterParams
  )
  if (datePctIds !== null) aggQ = aggQ.in('id', datePctIds)

  const [{ data, count, error }, { data: aggData }] = await Promise.all([mainQ, aggQ])

  if (error) return fail(res, 500, 'DB_ERROR', error.message)

  const total_cartons_remaining = (aggData ?? []).reduce(
    (s: number, e: any) => s + (Number(e.cartons_remaining) || 0), 0
  )

  return ok(res, { entries: data ?? [], total: count ?? 0, page: pageNum, limit: limitNum, total_cartons_remaining })
}

export async function listFacets(req: Request, res: Response) {
  const q = req.query as Record<string, string>
  const warehouseIds = parseArr(q.warehouse_ids)
  const categories   = parseArr(q.categories)

  let locationFilter: string[] | null = null
  if (warehouseIds.length > 0) {
    let locQ = (supabase.from('Location') as any).select('id')
    if (warehouseIds.length === 1) locQ = locQ.eq('warehouse_id', warehouseIds[0])
    else locQ = locQ.in('warehouse_id', warehouseIds)
    const { data: locs } = await locQ
    locationFilter = (locs ?? []).map((l: any) => l.id as string)
    if (locationFilter.length === 0)
      return ok(res, { cycles: [], machines: [], locations: [], materials: [] })
  }

  let materialFilter: string[] | null = null
  if (categories.length > 0) {
    let matQ = (supabase.from('Material') as any).select('id')
    if (categories.length === 1) matQ = matQ.eq('category', categories[0])
    else matQ = matQ.in('category', categories)
    const { data: mats } = await matQ
    materialFilter = (mats ?? []).map((m: any) => m.id as string)
    if (materialFilter.length === 0)
      return ok(res, { cycles: [], machines: [], locations: [], materials: [] })
  }

  let invQ = (supabase.from('InventoryEntry') as any)
    .select('cycle, machine_code, location_id, material_id, location:Location(location_code), material:Material(material_code, short_name)')
    .in('status', ['IN_STOCK', 'PARTIAL'])
    .limit(5000)

  if (locationFilter) invQ = invQ.in('location_id', locationFilter)
  if (materialFilter) invQ = invQ.in('material_id', materialFilter)

  const { data: entries, error } = await invQ
  if (error) return fail(res, 500, 'DB_ERROR', error.message)

  const cycles   = [...new Set((entries ?? []).map((e: any) => e.cycle).filter(Boolean))].sort() as string[]
  const machines = [...new Set((entries ?? []).map((e: any) => e.machine_code).filter(Boolean))].sort() as string[]

  const locationMap = new Map<string, string>()
  const materialMap = new Map<string, { code: string; name: string | null }>()

  for (const e of (entries ?? [])) {
    if (e.location && !locationMap.has(e.location_id))
      locationMap.set(e.location_id, e.location.location_code)
    if (e.material && !materialMap.has(e.material_id))
      materialMap.set(e.material_id, { code: e.material.material_code, name: e.material.short_name })
  }

  const locations = [...locationMap.entries()].map(([id, code]) => ({ id, code }))
    .sort((a, b) => a.code.localeCompare(b.code))
  const materials = [...materialMap.entries()].map(([id, v]) => ({ id, code: v.code, name: v.name }))
    .sort((a, b) => a.code.localeCompare(b.code))

  return ok(res, { cycles, machines, locations, materials })
}

const ACTIVE_STATUSES = ['IN_STOCK', 'PARTIAL', 'EXPORTED']

export async function adjustInventory(req: Request, res: Response) {
  const { id } = req.params
  const { adjustment, stocktake_by, employee_id } = req.body as { adjustment: number; stocktake_by?: string; employee_id?: string }

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

  const now    = new Date().toISOString()
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
  if (employee_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee_id)) patch.updated_by = employee_id

  const { data: updated, error: updateErr } = await (supabase.from('InventoryEntry') as any)
    .update(patch)
    .eq('id', id)
    .select(ENTRY_SELECT)
    .single()

  if (updateErr) return fail(res, 500, 'DB_ERROR', updateErr.message)
  return ok(res, { entry: updated })
}

// ─── Bulk actions ────────────────────────────────────────────

export async function bulkUpdateQA(req: Request, res: Response) {
  const { ids, qa_status_id, employee_id } = req.body as {
    ids: string[]; qa_status_id: string | null; employee_id?: string
  }
  if (!Array.isArray(ids) || ids.length === 0)
    return fail(res, 400, 'INVALID_INPUT', 'Cần ít nhất 1 pallet')

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  const patch: Record<string, unknown> = { qa_status_id: qa_status_id ?? null, updated_at: now, update_date: vnDate }
  if (employee_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee_id)) patch.updated_by = employee_id

  const { error } = await (supabase.from('InventoryEntry') as any).update(patch).in('id', ids)
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { updated: ids.length })
}

export async function bulkTransferLocation(req: Request, res: Response) {
  const { ids, location_id, employee_id } = req.body as {
    ids: string[]; location_id: string; employee_id?: string
  }
  if (!Array.isArray(ids) || ids.length === 0)
    return fail(res, 400, 'INVALID_INPUT', 'Cần ít nhất 1 pallet')
  if (!location_id)
    return fail(res, 400, 'INVALID_INPUT', 'Thiếu location_id')

  const { data: loc } = await (supabase.from('Location') as any)
    .select('id, is_active, location_code, max_pallets')
    .eq('id', location_id).maybeSingle()
  if (!loc)           return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
  if (!loc.is_active) return fail(res, 400, 'LOCATION_INACTIVE', 'Vị trí không hoạt động')

  // Check capacity: count active pallets already at this location
  if (loc.max_pallets > 0) {
    const { count: usedSlots } = await (supabase.from('InventoryEntry') as any)
      .select('id', { count: 'exact', head: true })
      .eq('location_id', location_id)
      .in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE'])

    const available = loc.max_pallets - (usedSlots ?? 0)
    if (available < ids.length) {
      return fail(res, 400, 'LOCATION_FULL',
        `Vị trí ${loc.location_code} không đủ chỗ (còn ${Math.max(0, available)} slot, cần ${ids.length})`)
    }
  }

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  const patch: Record<string, unknown> = { location_id, updated_at: now, update_date: vnDate }
  if (employee_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee_id)) patch.updated_by = employee_id

  const { error } = await (supabase.from('InventoryEntry') as any).update(patch).in('id', ids)
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { updated: ids.length, location_code: loc.location_code })
}

export async function bulkTransferMaterial(req: Request, res: Response) {
  const { ids, material_id, employee_id } = req.body as {
    ids: string[]; material_id: string; employee_id?: string
  }
  if (!Array.isArray(ids) || ids.length === 0)
    return fail(res, 400, 'INVALID_INPUT', 'Cần ít nhất 1 pallet')
  if (!material_id)
    return fail(res, 400, 'INVALID_INPUT', 'Thiếu material_id')

  const { data: mat } = await (supabase.from('Material') as any)
    .select('id, material_code').eq('id', material_id).maybeSingle()
  if (!mat) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy hàng hóa')

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  const patch: Record<string, unknown> = { material_id, updated_at: now, update_date: vnDate }
  if (employee_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee_id)) patch.updated_by = employee_id

  const { error } = await (supabase.from('InventoryEntry') as any).update(patch).in('id', ids)
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { updated: ids.length, material_code: mat.material_code })
}
