import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { randomUUID } from 'crypto'
import { resolveShelfLife } from '../../utils/shelfLife'

const ENTRY_SELECT = `
  id, pallet_code, location_id, warehouse_id, material_id, manufacturer_id, cycle, machine_code,
  pallet_sequence_no, qa_status_id, stack_layer, cartons_imported, cartons_remaining, cartons_reserved,
  production_date, status, import_date, update_date, adjustment_qty, ncc_id, shelf_life_days,
  parent_pallet_code, origin,
  stocktake_at, stocktake_flagged, stocktake_flag_note,
  created_at, updated_at,
  location:Location(id, location_code, sub_code, sub_name, sub_type, warehouse:Warehouse(id, name, code)),
  material:Material(id, material_code, short_name, shelf_life_days, supplier_shelf_life_overrides, category),
  ncc:TransportCompany!ncc_id(id, name),
  manufacturer:Manufacturer(id, code, name),
  qa_status:QAStatus(id, code, name),
  created_by_emp:Employee!created_by(id, name),
  updated_by_emp:Employee!updated_by(id, name),
  stocktake_by_emp:Employee!stocktake_by(id, name)
`.trim()

// ─── Warehouse-scope cho route GHI (mirror Outbound/Inbound) ───
// NATIONAL → null (toàn quyền). Khác → danh sách kho được gán.
function scopeWhIds(req: Request): string[] | null {
  return req.user?.warehouse_scope === 'NATIONAL' ? null : (req.user?.warehouse_ids ?? [])
}
// Chặn 403 nếu BẤT KỲ entry nào không thuộc kho trong phạm vi user. NATIONAL bỏ qua.
// Kho của entry = location.warehouse_id (QR pallet) HOẶC warehouse_id (POSM, location_id null) —
// KHÔNG tin riêng cột warehouse_id (đa số NULL với pallet QR).
async function guardEntriesScope(req: Request, res: Response, ids: string[]): Promise<boolean> {
  const scope = scopeWhIds(req)
  if (scope === null) return true
  const { data } = await supabase.from('InventoryEntry')
    .select('id, warehouse_id, location:Location!location_id(warehouse_id)')
    .in('id', ids)
  type LocWh = { warehouse_id: string | null }
  const rows = (data ?? []) as unknown as Array<{ warehouse_id: string | null; location: LocWh | LocWh[] | null }>
  for (const e of rows) {
    const loc = Array.isArray(e.location) ? e.location[0] : e.location
    const wh = loc?.warehouse_id ?? e.warehouse_id ?? null
    if (!wh || !scope.includes(wh)) {
      fail(res, 403, 'FORBIDDEN', 'Pallet không thuộc kho trong phạm vi của bạn')
      return false
    }
  }
  return true
}

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

// PostgREST ở project này TẮT aggregate functions + cap ~1000 dòng/response → không dùng được
// sum()/.limit(N) lớn. Helper lấy TẤT CẢ dòng khớp filter bằng cách phân trang 1000 (song song theo
// count đã biết) rồi gộp ở Node. Dùng cho summary (gom nhóm) và tổng thùng tồn. Throw nếu lỗi.
// (Tối ưu sau: chuyển sang RPC để gom phía DB trong 1 call.)
async function fetchAllInventory(select: string, params: FilterParams, datePctIds: string[] | null): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cq = applyInventoryFilters(supabase.from('InventoryEntry').select(select, { count: 'exact', head: true }), params)
  if (datePctIds !== null) cq = cq.in('id', datePctIds)
  const { count, error: cErr } = await cq
  if (cErr) throw new Error(cErr.message)
  const n = count ?? 0
  if (n === 0) return []

  const PAGE = 1000
  const reqs = []
  for (let p = 0; p * PAGE < n; p++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = applyInventoryFilters(supabase.from('InventoryEntry').select(select), params)
      .order('id', { ascending: true })
      .range(p * PAGE, p * PAGE + PAGE - 1)
    if (datePctIds !== null) q = q.in('id', datePctIds)
    reqs.push(q)
  }
  const results = await Promise.all(reqs)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = []
  for (const r of results) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((r as any).error) throw new Error((r as any).error.message)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.push(...((r as any).data ?? []))
  }
  return rows
}

// Phân trang TUẦN TỰ cho 1 query bất kỳ (không gắn applyInventoryFilters) — né cap ~1000 dòng/response.
// `makeQuery`: hàm trả về query MỚI mỗi lần (đã .select + filter + .order ổn định), CHƯA .range. Throw nếu lỗi.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPaged(makeQuery: () => any, pageSize = 1000): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = []
  for (let p = 0; ; p++) {
    const { data, error } = await makeQuery().range(p * pageSize, p * pageSize + pageSize - 1)
    if (error) throw new Error(error.message)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batch = (data ?? []) as any[]
    rows.push(...batch)
    if (batch.length < pageSize) break
  }
  return rows
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
      let locQ = supabase.from('Location').select('id')
      if (effectiveWarehouseIds.length === 1)    locQ = locQ.eq('warehouse_id', effectiveWarehouseIds[0])
      else if (effectiveWarehouseIds.length > 1) locQ = locQ.in('warehouse_id', effectiveWarehouseIds)
      if (filterLocations.length === 1)          locQ = locQ.eq('location_code', filterLocations[0])
      else if (filterLocations.length > 1)       locQ = locQ.in('location_code', filterLocations)
      return await locQ
    })() : Promise.resolve({ data: null, error: null }),

    needMatFilter ? (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let matQ = supabase.from('Material').select('id')
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
          supabase.from('Material').select('id')
            .or(`material_code.ilike.%${term}%,material_description.ilike.%${term}%,short_name.ilike.%${term}%,old_code.ilike.%${term}%`).limit(500),
          supabase.from('Location').select('id')
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
    // Always restrict pre-filter to active stock — %date on EXPORTED entries is meaningless.
    // Phân trang 1000 (cap response) để lấy ĐỦ dòng tính pct, không bị thiếu khi >1000 dòng.
    let preEntries: any[]
    try {
      preEntries = await fetchAllInventory('id, production_date, ncc_id, shelf_life_days, material:Material(shelf_life_days, supplier_shelf_life_overrides)', { ...params, status: '' }, null)
    } catch (e) {
      return { ...base, error: (e as Error).message }
    }
    const now = Date.now()
    datePctIds = (preEntries ?? [])
      .filter((e: any) => {
        const shelfDays = resolveShelfLife(e.shelf_life_days, e.material, e.ncc_id)
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

  // Khi lọc Loại kho: dùng Material!inner để filter category loại HẲN entry khác loại. Embedded filter
  // non-inner (material:Material(...)) chỉ left-join → entry khác category vẫn trả về với material=null
  // (lọt "dòng ma" + phình count). Không lọc category → giữ select gốc (không loại entry material null).
  const catActive = !!(r.params.categoryFilter && r.params.categoryFilter.length)
  const mainSelect = catActive ? ENTRY_SELECT.replace('material:Material(', 'material:Material!inner(') : ENTRY_SELECT

  // Main paginated query — sort by import_date desc + id asc để đảm bảo thứ tự ổn định giữa các trang
  let mainQ = applyInventoryFilters(
    supabase.from('InventoryEntry').select(mainSelect, { count: 'exact' }),
    r.params
  )
  if (r.datePctIds !== null) mainQ = mainQ.in('id', r.datePctIds)
  mainQ = mainQ
    .order('import_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .range(r.offset, r.offset + r.limitNum - 1)

  const { data, count, error } = await mainQ
  if (error) return fail(res, 500, 'DB_ERROR', error.message)

  // Tổng thùng tồn: aggregate functions bị tắt + cap 1000 dòng → cộng theo trang (helper). Lỗi sum
  // KHÔNG chặn list (rows vẫn hiện), chỉ để tổng = 0 và log.
  const sumSelect = catActive ? 'cartons_remaining, material:Material!inner(category)' : 'cartons_remaining'
  let total_cartons_remaining = 0
  try {
    const sumRows = await fetchAllInventory(sumSelect, r.params, r.datePctIds)
    total_cartons_remaining = sumRows.reduce((s, row) => s + Number(row.cartons_remaining ?? 0), 0)
  } catch (e) {
    console.error('[inventory] tính tổng thùng tồn lỗi:', (e as Error).message)
  }

  return ok(res, { entries: data ?? [], total: count ?? 0, page: r.pageNum, limit: r.limitNum, total_cartons_remaining })
}

// View tổng hợp: gom tồn kho theo (Kho × Mã hàng × Ngày SX) — KHÔNG chi tiết tới pallet.
// Vì %date suy ra từ ngày SX + hạn dùng nên mỗi nhóm có 1 giá trị %date duy nhất.
export async function summaryInventory(req: Request, res: Response) {
  const r = await resolveInventoryFilter(req)
  if (r.error) return fail(res, 500, 'DB_ERROR', r.error)
  if (r.empty) return ok(res, { groups: [], total: 0, total_cartons_remaining: 0 })

  // Lấy TOÀN BỘ entry khớp filter (phân trang 1000 — cap response + aggregate tắt) rồi gom JS.
  // !inner: lọc category phải loại HẲN entry khác loại, không để lọt với material=null.
  const summarySelect = 'id, warehouse_id, production_date, cartons_imported, cartons_remaining, material_id, ncc_id, shelf_life_days, '
    + 'location:Location(warehouse:Warehouse(id, name)), '
    + 'material:Material!inner(material_code, short_name, category, shelf_life_days, supplier_shelf_life_overrides)'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[]
  try {
    rows = await fetchAllInventory(summarySelect, r.params, r.datePctIds)
  } catch (e) {
    return fail(res, 500, 'DB_ERROR', (e as Error).message)
  }
  // Map id→tên kho (fallback cho POSM: location_id null nhưng có warehouse_id)
  const { data: whRows } = await supabase.from('Warehouse').select('id, name')

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
    const nccId  = (e.ncc_id ?? null) as string | null
    const shelfDays = (e.shelf_life_days ?? null) as number | null
    // Gom theo NCC + shelflife-lô (cùng mã/kho/ngày nhưng khác NCC hoặc khác shelflife → %Date khác)
    const key    = `${whId}|${matId}|${prod}|${nccId ?? ''}|${shelfDays ?? ''}`

    let g = map.get(key)
    if (!g) {
      const shelf = resolveShelfLife(shelfDays, e.material, nccId)
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

// Export chi tiết pallet: trả TOÀN BỘ entry khớp filter (phân trang 1000) để FE dựng Excel.
// Cùng resolveInventoryFilter → khớp tuyệt đối view pallet. (Summary export dùng dữ liệu /summary sẵn có ở FE.)
export async function exportInventory(req: Request, res: Response) {
  const r = await resolveInventoryFilter(req)
  if (r.error) return fail(res, 500, 'DB_ERROR', r.error)
  if (r.empty) return ok(res, { entries: [] })

  const catActive = !!(r.params.categoryFilter && r.params.categoryFilter.length)
  const sel = catActive ? ENTRY_SELECT.replace('material:Material(', 'material:Material!inner(') : ENTRY_SELECT
  try {
    const entries = await fetchAllInventory(sel, r.params, r.datePctIds)
    return ok(res, { entries })
  } catch (e) {
    return fail(res, 500, 'DB_ERROR', (e as Error).message)
  }
}

export async function listFacets(req: Request, res: Response) {
  const q = req.query as Record<string, string>
  const warehouseIds = parseArr(q.warehouse_ids)
  const categories   = parseArr(q.categories)

  // Materials: query Material table directly (5-10k rows, always complete)
  let matQ = supabase.from('Material')
    .select('id, material_code, short_name')
    .order('material_code')
  if (categories.length === 1)    matQ = matQ.eq('category', categories[0])
  else if (categories.length > 1) matQ = matQ.in('category', categories)

  // Locations: query Location table directly (small, always complete)
  let locQ = supabase.from('Location')
    .select('id, location_code')
    .order('location_code')
  if (warehouseIds.length === 1)    locQ = locQ.eq('warehouse_id', warehouseIds[0])
  else if (warehouseIds.length > 1) locQ = locQ.in('warehouse_id', warehouseIds)

  const [{ data: matData }, { data: locData }] = await Promise.all([matQ, locQ])

  // Cycles & machines: no reference table — query InventoryEntry, lọc theo category/warehouse
  // bằng INNER JOIN (Material/Location) thay vì nhồi hàng nghìn id vào .in() (URL quá dài → 500).
  // Phân trang ĐỦ dòng (cap ~1000/response) — không lấy mẫu, tránh sót giá trị Chu kỳ/Máy.
  const invSelect = 'id, cycle, machine_code'
    + (categories.length > 0   ? ', material:Material!inner(category)'    : '')
    + (warehouseIds.length > 0 ? ', location:Location!inner(warehouse_id)' : '')

  let invData: any[]
  try {
    invData = await fetchAllPaged(() => {
      let q = supabase.from('InventoryEntry')
        .select(invSelect)
        .in('status', ['IN_STOCK', 'PARTIAL'])
        .order('id', { ascending: true })
      if (warehouseIds.length === 1)    q = q.eq('location.warehouse_id', warehouseIds[0])
      else if (warehouseIds.length > 1) q = q.in('location.warehouse_id', warehouseIds)
      if (categories.length === 1)      q = q.eq('material.category', categories[0])
      else if (categories.length > 1)   q = q.in('material.category', categories)
      return q
    })
  } catch (e) {
    return fail(res, 500, 'DB_ERROR', (e as Error).message)
  }

  const cycles   = [...new Set(invData.map((e: any) => e.cycle).filter(Boolean))].sort() as string[]
  const machines = [...new Set(invData.map((e: any) => e.machine_code).filter(Boolean))].sort() as string[]

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
  if (!(await guardEntriesScope(req, res, [id]))) return

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const isValidUUID = (s?: string) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

  // Đọc–tính–ghi NGUYÊN TỬ (optimistic-CAS + jitter): chặn 2 lượt chỉnh cùng pallet đồng thời
  // ghi mù từ số đọc cũ → mất cập nhật tồn + adjustment_qty + log sai cartons_before/after.
  for (let attempt = 0; attempt < 15; attempt++) {
    const { data: entry, error: fetchErr } = await supabase.from('InventoryEntry')
      .select('id, cartons_remaining, cartons_imported, adjustment_qty, status')
      .eq('id', id)
      .maybeSingle()
    if (fetchErr || !entry) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')

    const cartonsBeforeAdjust = Number(entry.cartons_remaining ?? 0)
    const newRemaining = cartonsBeforeAdjust + adjustment
    if (newRemaining < 0) return fail(res, 400, 'INVALID_INPUT', 'Tồn kho không thể âm')

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
    if (stocktake_by) { patch.stocktake_by = stocktake_by; patch.stocktake_at = now }
    if (isValidUUID(employee_id)) patch.updated_by = employee_id

    const { data: updated, error: updateErr } = await supabase.from('InventoryEntry')
      .update(patch)
      .eq('id', id)
      .eq('cartons_remaining', cartonsBeforeAdjust)   // CAS: chỉ ghi nếu tồn VẪN bằng số vừa đọc
      .select(ENTRY_SELECT)
    if (updateErr) return fail(res, 500, 'DB_ERROR', updateErr.message)

    if (updated?.length) {
      // Audit log — KHÔNG nuốt lỗi (mất vết audit âm thầm là tệ). cartons_before/after khớp thật.
      const { error: logErr } = await supabase.from('InventoryAdjustmentLog' as any).insert({
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
      if (logErr) console.error('[adjustInventory] Ghi InventoryAdjustmentLog thất bại:', logErr.message)
      return ok(res, { entry: updated[0] })
    }
    // CAS trượt (người khác vừa chỉnh tồn): chờ jitter rồi đọc lại
    await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * (30 + attempt * 20))))
  }
  return fail(res, 409, 'STOCK_CHANGED', 'Tồn kho pallet này đang bận (nhiều người chỉnh) — thử lại')
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
  if (!(await guardEntriesScope(req, res, ids))) return

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  const patch: Record<string, unknown> = { qa_status_id: qa_status_id ?? null, updated_at: now, update_date: vnDate }
  if (employee_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee_id)) patch.updated_by = employee_id

  const { error } = await supabase.from('InventoryEntry').update(patch).in('id', ids)
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { updated: ids.length })
}

// Sửa NCC hàng loạt — gán/đổi NCC cho các pallet đã chọn (để áp HSD ngoại lệ theo NCC).
// ncc_id null = bỏ NCC (về HSD mặc định). Realtime invalidate inventory → %Date tự tính lại.
export async function bulkUpdateNcc(req: Request, res: Response) {
  const { ids, ncc_id, shelf_life_days, employee_id } = req.body as {
    ids: string[]; ncc_id: string | null; shelf_life_days?: number | null; employee_id?: string
  }
  if (!Array.isArray(ids) || ids.length === 0)
    return fail(res, 400, 'INVALID_INPUT', 'Cần ít nhất 1 pallet')
  if (!(await guardEntriesScope(req, res, ids))) return

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  // Chọn NCC-biến-thể = đặt cả ncc_id + shelflife của lô đó (shelf_life_days). Bỏ NCC → cả 2 về null.
  const patch: Record<string, unknown> = {
    ncc_id: ncc_id ?? null,
    shelf_life_days: (shelf_life_days != null && Number(shelf_life_days) > 0) ? Number(shelf_life_days) : null,
    updated_at: now, update_date: vnDate,
  }
  if (employee_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee_id)) patch.updated_by = employee_id

  const { error } = await supabase.from('InventoryEntry').update(patch).in('id', ids)
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
  if (!(await guardEntriesScope(req, res, ids))) return

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const updatedBy = (employee_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee_id))
    ? employee_id : null

  // Nguyên tử: RPC khóa dòng Location → đếm sức chứa DƯỚI LOCK → move trong cùng transaction.
  // Chống đua quá-tải vị trí khi nhiều người dồn cùng lúc vào CÙNG vị trí.
  const { data: result, error: rpcErr } = await supabase.rpc('move_pallets_to_location', {
    p_ids: ids, p_location_id: location_id, p_updated_by: updatedBy, p_update_date: vnDate, p_now: now,
  })
  if (!rpcErr) {
    const parts = String(result ?? '').split('|')
    switch (parts[0]) {
      case 'NO_IDS':    return fail(res, 400, 'INVALID_INPUT', 'Cần ít nhất 1 pallet')
      case 'NOT_FOUND': return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
      case 'INACTIVE':  return fail(res, 400, 'LOCATION_INACTIVE', 'Vị trí không hoạt động')
      case 'FULL':      return fail(res, 400, 'LOCATION_FULL',
        `Vị trí ${parts[2] ?? ''} không đủ chỗ (còn ${parts[1] ?? 0} slot, cần ${ids.length})`)
      default:          return ok(res, { updated: ids.length, location_code: parts[1] ?? '' })
    }
  }
  // RPC chưa được apply trên DB (function not found) → fallback logic cũ (KHÔNG nguyên tử) để không vỡ tính năng.
  const notDeployed = rpcErr.code === 'PGRST202' || /Could not find the function|does not exist/i.test(rpcErr.message ?? '')
  if (!notDeployed) return fail(res, 500, 'DB_ERROR', rpcErr.message)

  const { data: loc } = await supabase.from('Location')
    .select('id, is_active, location_code, max_pallets')
    .eq('id', location_id).maybeSingle()
  if (!loc)           return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
  if (!loc.is_active) return fail(res, 400, 'LOCATION_INACTIVE', 'Vị trí không hoạt động')
  if (loc.max_pallets > 0) {
    const { count: usedSlots } = await supabase.from('InventoryEntry')
      .select('id', { count: 'exact', head: true })
      .eq('location_id', location_id)
      .in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE'])
    const available = loc.max_pallets - (usedSlots ?? 0)
    if (available < ids.length) {
      return fail(res, 400, 'LOCATION_FULL',
        `Vị trí ${loc.location_code} không đủ chỗ (còn ${Math.max(0, available)} slot, cần ${ids.length})`)
    }
  }
  const patch: Record<string, unknown> = { location_id, updated_at: now, update_date: vnDate }
  if (updatedBy) patch.updated_by = updatedBy
  const { error } = await supabase.from('InventoryEntry').update(patch).in('id', ids)
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
  if (!(await guardEntriesScope(req, res, ids))) return

  const { data: mat } = await supabase.from('Material')
    .select('id, material_code').eq('id', material_id).maybeSingle()
  if (!mat) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy hàng hóa')

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  const patch: Record<string, unknown> = { material_id, updated_at: now, update_date: vnDate }
  if (employee_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee_id)) patch.updated_by = employee_id

  const { error } = await supabase.from('InventoryEntry').update(patch).in('id', ids)
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { updated: ids.length, material_code: mat.material_code })
}

// ─── Stocktake (kiểm kê / check vị trí) ──────────────────────

export async function stocktakeCheck(req: Request, res: Response) {
  const { qr_code } = req.body as { qr_code: string }
  const palletCode = qr_code?.trim()
  if (!palletCode) return fail(res, 400, 'INVALID_INPUT', 'Thiếu mã pallet')

  const { data, error } = await supabase.from('InventoryEntry')
    .select(ENTRY_SELECT)
    .eq('pallet_code', palletCode)
    .in('status', ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  if (!data) return fail(res, 404, 'NOT_FOUND', `Không tìm thấy pallet "${palletCode}" trong tồn kho`)
  // Scope: không cho tra cứu pallet ngoài phạm vi kho của user
  if (!(await guardEntriesScope(req, res, [(data as unknown as { id: string }).id]))) return
  return ok(res, { entry: data, pallet_code: palletCode })
}

export async function stocktakeEntry(req: Request, res: Response) {
  const { id } = req.params
  const { employee_id, new_location_id, physical_count } = req.body as {
    employee_id?: string; new_location_id?: string; physical_count?: number
  }

  const { data: existing, error: fetchErr } = await supabase.from('InventoryEntry')
    .select('id, location_id, cartons_remaining')
    .eq('id', id).maybeSingle()

  if (fetchErr) return fail(res, 500, 'DB_ERROR', fetchErr.message)
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')
  if (!(await guardEntriesScope(req, res, [id]))) return

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

  const { error } = await supabase.from('InventoryEntry').update(patch).eq('id', id)
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { ok: true })
}

export async function stocktakeEntries(req: Request, res: Response) {
  const { warehouse_id, category, location_id, location_ids, view = 'problem' } = req.query as Record<string, string>
  // view: 'all' | 'flagged' | 'unchecked' | 'checked' | 'problem' (flagged + unchecked)

  const scopeWhIds = req.user?.warehouse_scope !== 'NATIONAL'
    ? (req.user?.warehouse_ids ?? [])
    : []

  // Resolve location IDs to query against. Ưu tiên danh sách vị trí chọn (CSV); fallback location_id đơn.
  const explicitIds = location_ids
    ? String(location_ids).split(',').filter(Boolean)
    : (location_id ? [location_id] : [])
  let resolvedLocationIds: string[]
  if (explicitIds.length) {
    resolvedLocationIds = explicitIds
  } else {
    let locQuery = supabase.from('Location').select('id').eq('is_active', true)

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

  // Phân trang lấy ĐỦ — PostgREST cap ~1000 dòng/response, range(0,9999) KHÔNG bypass (đã xác minh).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let entries: any[]
  try {
    entries = await fetchAllPaged(() => supabase.from('InventoryEntry')
      .select(`
        id, pallet_code, cartons_remaining, import_date,
        stocktake_flagged, stocktake_flag_note, stocktake_at,
        location:Location(id, location_code),
        material:Material(material_code, short_name),
        stocktake_by_emp:Employee!stocktake_by(id, name)
      `)
      .in('location_id', resolvedLocationIds)
      .in('status', ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING'])
      .order('id', { ascending: true }))
  } catch (e) {
    return fail(res, 500, 'DB_ERROR', (e as Error).message)
  }

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

  // CHƯA quét lên đầu (cần tập trung tìm); trong nhóm đã quét: lệch trước, rồi đã kiểm OK
  filtered.sort((a, b) => {
    const aOk = isChecked(a), bOk = isChecked(b)
    if (aOk !== bOk) return aOk ? 1 : -1
    if (a.stocktake_flagged !== b.stocktake_flagged) return a.stocktake_flagged ? -1 : 1
    return 0
  })

  return ok(res, { stats: { total, checked, unchecked, flagged }, entries: filtered })
}

export async function unflagEntry(req: Request, res: Response) {
  if (!(await guardEntriesScope(req, res, [req.params.id]))) return
  const now = new Date().toISOString()
  const { error } = await supabase.from('InventoryEntry')
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
  if (!(await guardEntriesScope(req, res, ids))) return

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  const patch: Record<string, unknown> = { production_date, updated_at: now, update_date: vnDate }
  if (employee_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee_id)) patch.updated_by = employee_id

  const { error } = await supabase.from('InventoryEntry').update(patch).in('id', ids)
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { updated: ids.length })
}

export async function getInventoryEntry(req: Request, res: Response) {
  const { id } = req.params
  const { data, error } = await supabase.from('InventoryEntry')
    .select(ENTRY_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) return fail(res, error.message)
  if (!data)  return fail(res, 'Không tìm thấy pallet', 404)
  return ok(res, data)
}
