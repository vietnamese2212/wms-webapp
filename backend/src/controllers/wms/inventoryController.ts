import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { randomUUID } from 'crypto'

const ENTRY_SELECT = `
  id, pallet_code, location_id, warehouse_id, material_id, manufacturer_id, cycle, machine_code,
  pallet_sequence_no, qa_status_id, stack_layer, cartons_imported, cartons_remaining, cartons_reserved,
  production_date, status, import_date, update_date, adjustment_qty,
  parent_pallet_code, origin,
  stocktake_at, stocktake_flagged, stocktake_flag_note,
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
  warehouseIds?: string[]
  materialFilter?: string[] | null
  categoryFilter?: string[]
  qa_status_ids?: string[]
  search?: string
  searchMatIds?: string[]   // material_id khớp omni-search (resolve trước) → OR vào search
  searchLocIds?: string[]   // location_id khớp omni-search
  manufacturer_id?: string
  filterCycles?: string[]
  filterMachines?: string[]
  import_date_from?: string
  import_date_to?: string
}

function applyInventoryFilters(q: any, p: FilterParams): any {
  if (!p.status || p.status === '') q = q.in('status', ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING'])
  else if (p.status !== 'ALL')       q = q.eq('status', p.status)

  if (p.locationFilter !== null && p.locationFilter !== undefined) {
    const whIds = p.warehouseIds ?? []
    if (p.locationFilter.length > 0 && whIds.length > 0) {
      const locStr = p.locationFilter.join(',')
      const whStr  = whIds.join(',')
      q = q.or(`location_id.in.(${locStr}),and(location_id.is.null,warehouse_id.in.(${whStr}))`)
    } else if (p.locationFilter.length > 0) {
      q = q.in('location_id', p.locationFilter)
    } else if (whIds.length > 0) {
      // Kho chưa có location nào nhưng có thể có POSM
      q = q.is('location_id', null).in('warehouse_id', whIds)
    }
  }
  if (p.materialFilter)  q = q.in('material_id', p.materialFilter)
  // Dùng embedded filter thay vì IN (material_id) để tránh URL quá dài khi nhiều material
  if (p.categoryFilter && p.categoryFilter.length === 1)    q = q.eq('material.category', p.categoryFilter[0])
  else if (p.categoryFilter && p.categoryFilter.length > 1) q = q.in('material.category', p.categoryFilter)
  if (p.qa_status_ids && p.qa_status_ids.length > 0) q = q.in('qa_status_id', p.qa_status_ids)
  if (p.search) {
    // Omni-search: khớp mã pallet HOẶC mã/tên hàng HOẶC mã vị trí (đã resolve ID trước)
    const term = p.search.replace(/[,()]/g, ' ').trim()
    const ors = [`pallet_code.ilike.%${term}%`]
    if (p.searchMatIds?.length) ors.push(`material_id.in.(${p.searchMatIds.join(',')})`)
    if (p.searchLocIds?.length) ors.push(`location_id.in.(${p.searchLocIds.join(',')})`)
    q = q.or(ors.join(','))
  }
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
  if (range === '80')   return pct > 80
  if (range === '60')   return pct > 60 && pct <= 80
  if (range === '30')   return pct > 30 && pct <= 60
  if (range === 'le30') return pct <= 30
  return false
}

// Resolve scope (kho/loại kho theo JWT) + tất cả filter + pre-filter %date → dùng CHUNG cho cả
// view pallet (listInventory) lẫn view tổng hợp (summaryInventory) để filter khớp tuyệt đối.
interface ResolvedFilter {
  empty?: boolean
  error?: string
  params: FilterParams
  datePctIds: string[] | null
  pageNum: number
  limitNum: number
  offset: number
}

async function resolveInventoryFilter(req: Request): Promise<ResolvedFilter> {
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

  // Enforce user's warehouse + category scope from JWT
  const scopeWarehouses = req.user?.warehouse_scope !== 'NATIONAL'
    ? (req.user?.warehouse_ids ?? [])
    : []
  const effectiveWarehouseIds = scopeWarehouses.length > 0
    ? (warehouseIds.length > 0 ? warehouseIds.filter(id => scopeWarehouses.includes(id)) : scopeWarehouses)
    : warehouseIds

  // Normalize old abbreviations from stale JWT (TP→Thành phẩm, BAO_BI→Bao bì)
  // NATIONAL scope: bỏ qua allowed_categories restriction
  const normCat = (c: string) => c === 'TP' ? 'Thành phẩm' : c === 'BAO_BI' ? 'Bao bì' : c
  const isNational = req.user?.warehouse_scope === 'NATIONAL'
  const scopeCategories = isNational ? [] : (req.user?.allowed_categories ?? []).map(normCat)
  const effectiveCategories = scopeCategories.length > 0
    ? (categories.length > 0 ? categories.filter(c => scopeCategories.includes(c)) : scopeCategories)
    : categories

  const filterLocations   = parseArr(q.filter_locations)
  const filterCycles      = parseArr(q.filter_cycles)
  const filterMachines    = parseArr(q.filter_machines)
  const filterMaterialIds = parseArr(q.filter_material_ids)
  const qa_status_ids     = parseArr(q.qa_status_ids).length > 0 ? parseArr(q.qa_status_ids) : undefined
  const datePctRanges     = parseArr(q.date_pct_ranges)

  const pageNum  = Math.max(1, parseInt(page) || 1)
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50))
  const offset   = (pageNum - 1) * limitNum

  const base = { params: {} as FilterParams, datePctIds: null as string[] | null, pageNum, limitNum, offset }

  // Empty intersection → user's scope and UI filter don't overlap → return empty immediately
  if (scopeWarehouses.length > 0 && warehouseIds.length > 0 && effectiveWarehouseIds.length === 0)
    return { ...base, empty: true }
  if (scopeCategories.length > 0 && categories.length > 0 && effectiveCategories.length === 0)
    return { ...base, empty: true }

  const needLocFilter = effectiveWarehouseIds.length > 0 || filterLocations.length > 0
  // Category filter dùng embedded resource filter — không cần pre-query material IDs
  const needMatFilter = !!(material_search) || filterMaterialIds.length > 0

  // Resolve location_ids and material_ids in parallel — they are independent queries
  const [locResult, matResult] = await Promise.all([
    needLocFilter ? (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let locQ = (supabase.from('Location') as any).select('id')
      if (effectiveWarehouseIds.length === 1)    locQ = locQ.eq('warehouse_id', effectiveWarehouseIds[0])
      else if (effectiveWarehouseIds.length > 1) locQ = locQ.in('warehouse_id', effectiveWarehouseIds)
      if (filterLocations.length === 1)          locQ = locQ.eq('location_code', filterLocations[0])
      else if (filterLocations.length > 1)       locQ = locQ.in('location_code', filterLocations)
      return await locQ
    })() : Promise.resolve({ data: null, error: null }),

    needMatFilter ? (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let matQ = (supabase.from('Material') as any).select('id')
      if (material_search)            matQ = matQ.or(`material_code.ilike.%${material_search}%,short_name.ilike.%${material_search}%`)
      if (filterMaterialIds.length > 0) matQ = matQ.in('id', filterMaterialIds)
      return await matQ
    })() : Promise.resolve({ data: null, error: null }),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((locResult as any).error) return { ...base, error: (locResult as any).error.message }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((matResult as any).error) return { ...base, error: (matResult as any).error.message }

  let locationFilter: string[] | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((locResult as any).data !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    locationFilter = ((locResult as any).data ?? []).map((l: any) => l.id as string)
    // Trả về rỗng nếu: không tìm được location VÀ (có filter location cụ thể HOẶC không có warehouse scope nào)
    // → Không áp dụng khi chỉ có warehouse scope — vẫn có thể có POSM (location_id IS NULL)
    if (locationFilter!.length === 0 && (filterLocations.length > 0 || effectiveWarehouseIds.length === 0))
      return { ...base, empty: true }
  }

  let materialFilter: string[] | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((matResult as any).data !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    materialFilter = ((matResult as any).data ?? []).map((m: any) => m.id as string)
    if (materialFilter!.length === 0) return { ...base, empty: true }
  }

  // Omni-search 1 ô: resolve material/location ID khớp term → search tìm cả mã pallet / mã+tên hàng / mã vị trí.
  // (ilike Postgres KHÔNG bỏ dấu — bỏ dấu server-side cần extension unaccent, xem ghi chú.)
  let searchMatIds: string[] | undefined
  let searchLocIds: string[] | undefined
  if (search) {
    const term = search.replace(/[,()]/g, ' ').trim()
    if (term) {
      // Ưu tiên RPC unaccent (bỏ dấu). Nếu chưa apply migration → fallback ilike (phân biệt dấu).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [smat, sloc] = await Promise.all([
        (supabase.rpc('omni_material_ids', { term }) as any),
        (supabase.rpc('omni_location_ids', { term }) as any),
      ])
      if (!smat.error && !sloc.error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        searchMatIds = (smat.data ?? []).map((m: any) => m.id as string)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        searchLocIds = (sloc.data ?? []).map((l: any) => l.id as string)
      } else {
        const [fmat, floc] = await Promise.all([
          (supabase.from('Material') as any).select('id')
            .or(`material_code.ilike.%${term}%,material_description.ilike.%${term}%,short_name.ilike.%${term}%,old_code.ilike.%${term}%`).limit(500),
          (supabase.from('Location') as any).select('id')
            .or(`location_code.ilike.%${term}%,sub_code.ilike.%${term}%,sub_name.ilike.%${term}%`).limit(500),
        ])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        searchMatIds = ((fmat as any).data ?? []).map((m: any) => m.id as string)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        searchLocIds = ((floc as any).data ?? []).map((l: any) => l.id as string)
      }
    }
  }

  const params: FilterParams = {
    status, locationFilter, materialFilter,
    warehouseIds: effectiveWarehouseIds.length > 0 ? effectiveWarehouseIds : undefined,
    categoryFilter: effectiveCategories.length > 0 ? effectiveCategories : undefined,
    qa_status_ids, search, searchMatIds, searchLocIds, manufacturer_id, filterCycles, filterMachines, import_date_from, import_date_to,
  }

  // Pre-filter by %date: fetch ALL IDs (no pagination) with same filters, compute pct in JS
  let datePctIds: string[] | null = null
  if (datePctRanges.length > 0) {
    // Always restrict pre-filter to active stock — %date on EXPORTED entries is meaningless
    // and would inflate row count beyond the 100k limit unnecessarily
    const { data: preEntries } = await applyInventoryFilters(
      (supabase.from('InventoryEntry') as any)
        .select('id, production_date, material:Material(shelf_life_days)')
        .limit(100_000),
      { ...params, status: '' }
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

    if (datePctIds!.length === 0) return { ...base, params, empty: true }
  }

  return { params, datePctIds, pageNum, limitNum, offset }
}

export async function listInventory(req: Request, res: Response) {
  const r = await resolveInventoryFilter(req)
  if (r.error) return fail(res, 500, 'DB_ERROR', r.error)
  if (r.empty) return ok(res, { entries: [], total: 0, page: r.pageNum, limit: r.limitNum, total_cartons_remaining: 0 })

  // Main paginated query — sort by import_date desc + id asc để đảm bảo thứ tự ổn định giữa các trang
  let mainQ = applyInventoryFilters(
    (supabase.from('InventoryEntry') as any).select(ENTRY_SELECT, { count: 'exact' }),
    r.params
  )
  if (r.datePctIds !== null) mainQ = mainQ.in('id', r.datePctIds)
  mainQ = mainQ
    .order('import_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .range(r.offset, r.offset + r.limitNum - 1)

  // Aggregate: use SQL SUM() instead of fetching all rows and summing in JS
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let aggQ = applyInventoryFilters(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('InventoryEntry') as any).select('cartons_remaining.sum()'),
    r.params
  )
  if (r.datePctIds !== null) aggQ = aggQ.in('id', r.datePctIds)

  const [{ data, count, error }, { data: aggData }] = await Promise.all([mainQ, aggQ])

  if (error) return fail(res, 500, 'DB_ERROR', error.message)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const total_cartons_remaining = Number((aggData as any[])?.[0]?.sum ?? 0)

  return ok(res, { entries: data ?? [], total: count ?? 0, page: r.pageNum, limit: r.limitNum, total_cartons_remaining })
}

// View tổng hợp: gom tồn kho theo (Kho × Mã hàng × Ngày SX) — KHÔNG chi tiết tới pallet.
// Vì %date suy ra từ ngày SX + hạn dùng nên mỗi nhóm có 1 giá trị %date duy nhất.
export async function summaryInventory(req: Request, res: Response) {
  const r = await resolveInventoryFilter(req)
  if (r.error) return fail(res, 500, 'DB_ERROR', r.error)
  if (r.empty) return ok(res, { groups: [], total: 0, total_cartons_remaining: 0 })

  // Lấy toàn bộ entry khớp filter (chỉ cột cần để gom) — gom trong JS (giống pre-filter %date đã có).
  let entQ = applyInventoryFilters(
    (supabase.from('InventoryEntry') as any).select(
      'id, warehouse_id, production_date, cartons_imported, cartons_remaining, material_id, '
      + 'location:Location(warehouse:Warehouse(id, name)), '
      + 'material:Material(material_code, short_name, category, shelf_life_days)'
    ).limit(100_000),
    r.params
  )
  if (r.datePctIds !== null) entQ = entQ.in('id', r.datePctIds)

  // Map id→tên kho (fallback cho POSM: location_id null nhưng có warehouse_id)
  const [{ data: rows, error }, { data: whRows }] = await Promise.all([
    entQ,
    (supabase.from('Warehouse') as any).select('id, name'),
  ])
  if (error) return fail(res, 500, 'DB_ERROR', error.message)

  const whMap: Record<string, string> = Object.fromEntries(((whRows ?? []) as any[]).map(w => [w.id, w.name]))
  const now = Date.now()

  interface Group {
    warehouse_id: string | null; warehouse_name: string; material_id: string
    material_code: string | null; short_name: string | null; category: string | null
    production_date: string | null; date_pct: number | null
    cartons_imported: number; cartons_remaining: number; pallet_count: number
  }
  const map = new Map<string, Group>()

  for (const e of (rows ?? []) as any[]) {
    const whId   = (e.location?.warehouse?.id ?? e.warehouse_id ?? null) as string | null
    const whName = e.location?.warehouse?.name ?? (whId ? whMap[whId] : null) ?? '—'
    const matId  = e.material_id as string
    const prod   = (e.production_date ?? null) as string | null
    const key    = `${whId}|${matId}|${prod}`

    let g = map.get(key)
    if (!g) {
      const shelf = Number(e.material?.shelf_life_days)
      g = {
        warehouse_id: whId, warehouse_name: whName, material_id: matId,
        material_code: e.material?.material_code ?? null,
        short_name:    e.material?.short_name ?? null,
        category:      e.material?.category ?? null,
        production_date: prod,
        date_pct: prod && shelf > 0 ? calcPct(prod, shelf, now) : null,
        cartons_imported: 0, cartons_remaining: 0, pallet_count: 0,
      }
      map.set(key, g)
    }
    g.cartons_imported  += Number(e.cartons_imported ?? 0)
    g.cartons_remaining += Number(e.cartons_remaining ?? 0)
    g.pallet_count      += 1
  }

  const groups = [...map.values()]
    .map(g => ({ ...g, cartons_exported: Math.max(0, g.cartons_imported - g.cartons_remaining) }))
    .sort((a, b) => {
      const mc = (a.material_code ?? '').localeCompare(b.material_code ?? '')
      if (mc !== 0) return mc
      const wn = a.warehouse_name.localeCompare(b.warehouse_name)
      if (wn !== 0) return wn
      return (b.production_date ?? '').localeCompare(a.production_date ?? '') // ngày SX mới nhất trước
    })

  const total_cartons_remaining = groups.reduce((s, g) => s + g.cartons_remaining, 0)
  return ok(res, { groups, total: groups.length, total_cartons_remaining })
}

export async function listFacets(req: Request, res: Response) {
  const q = req.query as Record<string, string>
  const warehouseIds = parseArr(q.warehouse_ids)
  const categories   = parseArr(q.categories)

  // Materials: query Material table directly (5-10k rows, always complete)
  let matQ = (supabase.from('Material') as any)
    .select('id, material_code, short_name')
    .order('material_code')
  if (categories.length === 1)    matQ = matQ.eq('category', categories[0])
  else if (categories.length > 1) matQ = matQ.in('category', categories)

  // Locations: query Location table directly (small, always complete)
  let locQ = (supabase.from('Location') as any)
    .select('id, location_code')
    .order('location_code')
  if (warehouseIds.length === 1)    locQ = locQ.eq('warehouse_id', warehouseIds[0])
  else if (warehouseIds.length > 1) locQ = locQ.in('warehouse_id', warehouseIds)

  const [{ data: matData }, { data: locData }] = await Promise.all([matQ, locQ])

  // Cycles & machines: no reference table — query InventoryEntry, lọc theo category/warehouse
  // bằng INNER JOIN (Material/Location) thay vì nhồi hàng nghìn id vào .in() (URL quá dài → 500).
  // Distinct values are few (< 50), so a sample easily covers them all.
  const invSelect = 'cycle, machine_code'
    + (categories.length > 0   ? ', material:Material!inner(category)'    : '')
    + (warehouseIds.length > 0 ? ', location:Location!inner(warehouse_id)' : '')

  let invQ = (supabase.from('InventoryEntry') as any)
    .select(invSelect)
    .in('status', ['IN_STOCK', 'PARTIAL'])
    .limit(10000)
  if (warehouseIds.length === 1)    invQ = invQ.eq('location.warehouse_id', warehouseIds[0])
  else if (warehouseIds.length > 1) invQ = invQ.in('location.warehouse_id', warehouseIds)
  if (categories.length === 1)      invQ = invQ.eq('material.category', categories[0])
  else if (categories.length > 1)   invQ = invQ.in('material.category', categories)

  const { data: invData, error } = await invQ
  if (error) return fail(res, 500, 'DB_ERROR', error.message)

  const cycles   = [...new Set((invData ?? []).map((e: any) => e.cycle).filter(Boolean))].sort() as string[]
  const machines = [...new Set((invData ?? []).map((e: any) => e.machine_code).filter(Boolean))].sort() as string[]

  const materials = ((matData ?? []) as any[])
    .map((m: any) => ({ id: m.id as string, code: m.material_code as string, name: (m.short_name ?? null) as string | null }))
  const locations = ((locData ?? []) as any[])
    .map((l: any) => ({ id: l.id as string, code: l.location_code as string }))

  return ok(res, { cycles, machines, locations, materials })
}

const ACTIVE_STATUSES = ['IN_STOCK', 'PARTIAL', 'EXPORTED']

export async function adjustInventory(req: Request, res: Response) {
  const { id } = req.params
  const { adjustment, stocktake_by, employee_id, note, actor_name } = req.body as {
    adjustment: number; stocktake_by?: string; employee_id?: string; note?: string; actor_name?: string
  }

  if (typeof adjustment !== 'number' || adjustment === 0) {
    return fail(res, 400, 'INVALID_INPUT', 'adjustment phải là số khác 0')
  }

  const { data: entry, error: fetchErr } = await (supabase.from('InventoryEntry') as any)
    .select('id, cartons_remaining, cartons_imported, adjustment_qty, status')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr || !entry) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')

  const cartonsBeforeAdjust = Number(entry.cartons_remaining ?? 0)
  const newRemaining = cartonsBeforeAdjust + adjustment
  if (newRemaining < 0) return fail(res, 400, 'INVALID_INPUT', 'Tồn kho không thể âm')

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  let newStatus = entry.status
  if (ACTIVE_STATUSES.includes(entry.status)) {
    if (newRemaining <= 0) newStatus = 'EXPORTED'
    else if (newRemaining >= Number(entry.cartons_imported)) newStatus = 'IN_STOCK'
    else newStatus = 'PARTIAL'
  }

  const isValidUUID = (s?: string) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

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
  if (isValidUUID(employee_id)) patch.updated_by = employee_id

  const { data: updated, error: updateErr } = await (supabase.from('InventoryEntry') as any)
    .update(patch)
    .eq('id', id)
    .select(ENTRY_SELECT)
    .single()

  if (updateErr) return fail(res, 500, 'DB_ERROR', updateErr.message)

  // Insert audit log
  await supabase.from('InventoryAdjustmentLog' as any).insert({
    id:             randomUUID(),
    entry_id:       id,
    delta:          adjustment,
    cartons_before: cartonsBeforeAdjust,
    cartons_after:  newRemaining,
    note:           note?.trim() || null,
    actor_name:     actor_name?.trim() || null,
    actor_id:       isValidUUID(employee_id) ? employee_id : null,
    adjusted_at:    now,
  })

  return ok(res, { entry: updated })
}

export async function listAdjustmentLog(req: Request, res: Response) {
  const { id } = req.params
  const { data, error } = await supabase
    .from('InventoryAdjustmentLog' as any)
    .select('id, delta, cartons_before, cartons_after, note, actor_name, actor_id, adjusted_at')
    .eq('entry_id', id)
    .order('adjusted_at', { ascending: false })

  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  res.json({ success: true, data })
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

// ─── Stocktake (kiểm kê / check vị trí) ──────────────────────

export async function stocktakeCheck(req: Request, res: Response) {
  const { qr_code } = req.body as { qr_code: string }
  const palletCode = qr_code?.trim()
  if (!palletCode) return fail(res, 400, 'INVALID_INPUT', 'Thiếu mã pallet')

  const { data, error } = await (supabase.from('InventoryEntry') as any)
    .select(ENTRY_SELECT)
    .eq('pallet_code', palletCode)
    .in('status', ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  if (!data) return fail(res, 404, 'NOT_FOUND', `Không tìm thấy pallet "${palletCode}" trong tồn kho`)
  return ok(res, { entry: data, pallet_code: palletCode })
}

export async function stocktakeEntry(req: Request, res: Response) {
  const { id } = req.params
  const { employee_id, new_location_id, physical_count } = req.body as {
    employee_id?: string; new_location_id?: string; physical_count?: number
  }

  const { data: existing, error: fetchErr } = await (supabase.from('InventoryEntry') as any)
    .select('id, location_id, cartons_remaining')
    .eq('id', id).maybeSingle()

  if (fetchErr) return fail(res, 500, 'DB_ERROR', fetchErr.message)
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const patch: Record<string, unknown> = { stocktake_at: now, updated_at: now, update_date: vnDate }

  if (employee_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee_id)) {
    patch.stocktake_by = employee_id
    patch.updated_by   = employee_id
  }

  if (new_location_id) patch.location_id = new_location_id

  if (physical_count !== undefined && physical_count !== null) {
    const appCount = Number(existing.cartons_remaining ?? 0)
    if (Number(physical_count) !== appCount) {
      patch.stocktake_flagged   = true
      patch.stocktake_flag_note = `Thực tế: ${physical_count} / App: ${appCount}`
    } else {
      patch.stocktake_flagged   = false
      patch.stocktake_flag_note = null
    }
  }

  const { error } = await (supabase.from('InventoryEntry') as any).update(patch).eq('id', id)
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { ok: true })
}

export async function stocktakeSummary(req: Request, res: Response) {
  const { warehouse_id, category, requires_stocktake_only } = req.query as Record<string, string>

  const scopeWhIds = req.user?.warehouse_scope !== 'NATIONAL'
    ? (req.user?.warehouse_ids ?? [])
    : []

  let locQuery = (supabase.from('Location') as any)
    .select('id, location_code, sub_code, requires_stocktake, warehouse:Warehouse(name)')
    .eq('is_active', true)

  if (scopeWhIds.length > 0) {
    const effective = warehouse_id
      ? scopeWhIds.filter(id => id === warehouse_id)
      : scopeWhIds
    if (effective.length === 0) return ok(res, [])
    effective.length === 1
      ? (locQuery = locQuery.eq('warehouse_id', effective[0]))
      : (locQuery = locQuery.in('warehouse_id', effective))
  } else {
    if (warehouse_id) locQuery = locQuery.eq('warehouse_id', warehouse_id)
  }

  if (category)     locQuery = locQuery.or(`category.eq.${category},category.is.null`)
  if (requires_stocktake_only === 'true') locQuery = locQuery.eq('requires_stocktake', true)

  const { data: locations, error: locError } = await locQuery
  if (locError) return fail(res, 500, 'DB_ERROR', locError.message)
  if (!locations || locations.length === 0) return ok(res, [])

  const locationIds = (locations as { id: string }[]).map(l => l.id)
  const todayVN    = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const todayStart = new Date(`${todayVN}T00:00:00+07:00`).toISOString()

  const { data: entries, error: entError } = await (supabase.from('InventoryEntry') as any)
    .select('id, location_id, stocktake_at, stocktake_flagged, import_date')
    .in('location_id', locationIds)
    .in('status', ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING'])

  if (entError) return fail(res, 500, 'DB_ERROR', entError.message)

  type Stats = { total: number; checked: number; flagged: number }
  const statsMap = new Map<string, Stats>()
  for (const loc of locations as { id: string }[]) statsMap.set(loc.id, { total: 0, checked: 0, flagged: 0 })

  for (const e of (entries ?? []) as { location_id: string; stocktake_at: string | null; stocktake_flagged: boolean; import_date: string }[]) {
    const s = statsMap.get(e.location_id)
    if (!s) continue
    s.total++
    if ((e.stocktake_at && e.stocktake_at >= todayStart) || e.import_date === todayVN) s.checked++
    if (e.stocktake_flagged) s.flagged++
  }

  const result = (locations as { id: string; location_code: string; sub_code: string; requires_stocktake: boolean; warehouse: { name: string } | null }[])
    .map(loc => {
      const s = statsMap.get(loc.id) ?? { total: 0, checked: 0, flagged: 0 }
      return {
        location_id:        loc.id,
        location_code:      loc.location_code,
        sub_code:           loc.sub_code,
        requires_stocktake: loc.requires_stocktake,
        warehouse_name:     loc.warehouse?.name ?? '',
        total:              s.total,
        checked:            s.checked,
        unchecked:          s.total - s.checked,
        flagged:            s.flagged,
      }
    })

  return ok(res, result)
}

export async function stocktakeEntries(req: Request, res: Response) {
  const { warehouse_id, category, location_id, view = 'problem' } = req.query as Record<string, string>
  // view: 'all' | 'flagged' | 'unchecked' | 'checked' | 'problem' (flagged + unchecked)

  const scopeWhIds = req.user?.warehouse_scope !== 'NATIONAL'
    ? (req.user?.warehouse_ids ?? [])
    : []

  // Resolve location IDs to query against
  let resolvedLocationIds: string[]
  if (location_id) {
    resolvedLocationIds = [location_id]
  } else {
    let locQuery = (supabase.from('Location') as any).select('id').eq('is_active', true)

    if (scopeWhIds.length > 0) {
      const effective = warehouse_id
        ? scopeWhIds.filter(id => id === warehouse_id)
        : scopeWhIds
      if (effective.length === 0) return ok(res, { stats: { total: 0, checked: 0, unchecked: 0, flagged: 0 }, entries: [] })
      effective.length === 1
        ? (locQuery = locQuery.eq('warehouse_id', effective[0]))
        : (locQuery = locQuery.in('warehouse_id', effective))
    } else {
      if (warehouse_id) locQuery = locQuery.eq('warehouse_id', warehouse_id)
    }

    if (category)     locQuery = locQuery.or(`category.eq.${category},category.is.null`)
    const { data: locs, error: locErr } = await locQuery
    if (locErr) return fail(res, 500, 'DB_ERROR', locErr.message)
    if (!locs?.length) return ok(res, { stats: { total: 0, checked: 0, unchecked: 0, flagged: 0 }, entries: [] })
    resolvedLocationIds = (locs as { id: string }[]).map(l => l.id)
  }

  const todayVN    = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const todayStart = new Date(`${todayVN}T00:00:00+07:00`).toISOString()

  // Use range(0, 9999) to bypass Supabase default 1000-row limit
  const { data: entries, error: entErr } = await (supabase.from('InventoryEntry') as any)
    .select(`
      id, pallet_code, cartons_remaining, import_date,
      stocktake_flagged, stocktake_flag_note, stocktake_at,
      location:Location(id, location_code),
      material:Material(material_code, short_name),
      stocktake_by_emp:Employee!stocktake_by(id, name)
    `)
    .in('location_id', resolvedLocationIds)
    .in('status', ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING'])
    .range(0, 9999)
  if (entErr) return fail(res, 500, 'DB_ERROR', entErr.message)

  type E = { id: string; import_date: string; stocktake_at: string | null; stocktake_flagged: boolean }
  const all = (entries ?? []) as E[]

  const isChecked = (e: E) => !!(e.stocktake_at && e.stocktake_at >= todayStart) || e.import_date === todayVN

  const total    = all.length
  const checked  = all.filter(isChecked).length
  const unchecked = total - checked
  const flagged  = all.filter(e => e.stocktake_flagged).length

  let filtered: E[]
  if (view === 'flagged')   filtered = all.filter(e => e.stocktake_flagged)
  else if (view === 'unchecked') filtered = all.filter(e => !isChecked(e))
  else if (view === 'checked')   filtered = all.filter(isChecked)
  else if (view === 'problem')   filtered = all.filter(e => e.stocktake_flagged || !isChecked(e))
  else                           filtered = all

  filtered.sort((a, b) => {
    if (a.stocktake_flagged !== b.stocktake_flagged) return a.stocktake_flagged ? -1 : 1
    const aOk = isChecked(a), bOk = isChecked(b)
    if (aOk !== bOk) return aOk ? 1 : -1
    return 0
  })

  return ok(res, { stats: { total, checked, unchecked, flagged }, entries: filtered })
}

export async function unflagEntry(req: Request, res: Response) {
  const now = new Date().toISOString()
  const { error } = await (supabase.from('InventoryEntry') as any)
    .update({ stocktake_flagged: false, stocktake_flag_note: null, updated_at: now })
    .eq('id', req.params.id)
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { ok: true })
}

export async function bulkUpdateProductionDate(req: Request, res: Response) {
  const { ids, production_date, employee_id } = req.body as {
    ids: string[]; production_date: string; employee_id?: string
  }
  if (!Array.isArray(ids) || ids.length === 0)
    return fail(res, 400, 'INVALID_INPUT', 'Cần ít nhất 1 pallet')
  if (!production_date)
    return fail(res, 400, 'INVALID_INPUT', 'Thiếu ngày sản xuất')
  const d = new Date(production_date)
  if (isNaN(d.getTime()))
    return fail(res, 400, 'INVALID_INPUT', 'Ngày sản xuất không hợp lệ')

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  const patch: Record<string, unknown> = { production_date, updated_at: now, update_date: vnDate }
  if (employee_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee_id)) patch.updated_by = employee_id

  const { error } = await (supabase.from('InventoryEntry') as any).update(patch).in('id', ids)
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { updated: ids.length })
}

export async function getInventoryEntry(req: Request, res: Response) {
  const { id } = req.params
  const { data, error } = await (supabase.from('InventoryEntry') as any)
    .select(ENTRY_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) return fail(res, error.message)
  if (!data)  return fail(res, 'Không tìm thấy pallet', 404)
  return ok(res, data)
}
