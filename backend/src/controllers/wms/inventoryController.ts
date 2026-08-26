import { Request, Response } from 'express'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { randomUUID } from 'crypto'
import { computePctDate, type MaterialShelfInfo } from '../../utils/shelfLife'
import { fetchAllRowsParallel, fetchAllByIdChunks, isRangeNotSatisfiable } from '../../utils/pagination'
import { scopeCategoriesOf, categoryAllowed, categoriesOrScopeFilter, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'
import { safeSearch, safeFilterValue, searchLooksLikeInjection, SEARCH_INVALID_MSG } from '../../utils/search'
import { normalizeQR } from '../../utils/qrParser'
import { getWhTypeMetaMap } from '../../utils/warehouseTypeMeta'
import { wrongFormatHint } from './systemSettingController'
import { hasEntry, qtyIntegerError, qtyLabel, qtyEntryDecimal, type MatUnits } from '../../utils/qtyUnits'
import { requireBaseQty } from '../../utils/qtySemantics'
import { parseSheetByHeader, type FieldDef } from '../../utils/excelHeader'
import { isPreflight, buildPreflight } from '../../utils/uploadPreflight'
import { parseListParam, nonUuidEntries } from '../../utils/httpQuery'
import { getOrgProfile } from '../../utils/settings'
import { guardPutawayBatch, type IncomingInput } from '../../services/putawayContext'
import { putawayEnforces } from '../../utils/putaway'

// Quyền duyệt cất khác quy tắc — MỘT quyền cho cả app (`inbound.putaway_override`), không đẻ thêm
// bản riêng cho từng trang: nó là một NĂNG LỰC ("được cất lệch luật"), không phải một cái nút.
const canPutawayOverride = (req: Request): boolean =>
  req.user?.is_superadmin === true ||
  (req.user?.module_permissions ?? {})['inbound']?.includes('putaway_override') === true

const ENTRY_SELECT = `
  id, pallet_code, location_id, warehouse_id, material_id, manufacturer_id, nmsx, cycle, machine_code,
  pallet_sequence_no, qa_status_id, stack_layer, cartons_imported, cartons_remaining, cartons_reserved,
  production_date, status, import_date, update_date, adjustment_qty, ncc_id, shelf_life_days,
  batch, expiry_date, parent_pallet_code, origin,
  stocktake_at, stocktake_flagged, stocktake_flag_note,
  created_at, updated_at, created_by, updated_by,
  location:Location(id, location_code, sub_code, sub_name, sub_type, warehouse:Warehouse(id, name, code)),
  material:Material(id, material_code, short_name, shelf_life_days, supplier_shelf_life_overrides, category, base_unit, entry_unit, units_per_carton),
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
  const cats = scopeCategoriesOf(req)
  if (scope === null && cats === null) return true
  // Chunk ids 300 — phải kiểm ĐỦ MỌI id, không chỉ 1000 đầu.
  // ⚠️ 300 là TRẦN CỨNG của filter `.in()` (id 36 ký tự): đo 27/07 trên PostgREST staging —
  // 300 id = URL 11KB → 200; 400 id = 14,5KB → đứt kết nối; 700 id = 25KB → 400 Bad Request.
  // Trước đây chunk 500 (18KB) → user có scope kho bulk >400 pallet là hỏng.
  const data: unknown[] = []
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300)
    const r = await supabase.from('InventoryEntry')
      .select('id, warehouse_id, location:Location!location_id(warehouse_id), material:Material(category)')
      .in('id', chunk)
    if (r.error) { fail(res, 500, 'DB_ERROR', r.error.message); return false }
    data.push(...(r.data ?? []))
  }
  type LocWh = { warehouse_id: string | null }
  type MatCat = { category: string | null }
  const rows = data as unknown as Array<{ warehouse_id: string | null; location: LocWh | LocWh[] | null; material: MatCat | MatCat[] | null }>
  for (const e of rows) {
    const loc = Array.isArray(e.location) ? e.location[0] : e.location
    const wh = loc?.warehouse_id ?? e.warehouse_id ?? null
    if (scope !== null && (!wh || !scope.includes(wh))) {
      fail(res, 403, 'FORBIDDEN', 'Pallet không thuộc kho trong phạm vi của bạn')
      return false
    }
    // Mirror guardEntryRead: chặn ghi lên pallet LOẠI ngoài phạm vi (dù cùng kho) — chống IDOR-loại.
    const mat = Array.isArray(e.material) ? e.material[0] : e.material
    if (!categoryAllowed(req, mat?.category)) {
      fail(res, 403, 'FORBIDDEN', CATEGORY_FORBIDDEN_MSG); return false
    }
  }
  return true
}

// Gác ĐỌC-theo-id 1 pallet: cắt CẢ kho VÀ loại hàng (mirror listInventory) — chống IDOR đọc chéo kho/loại.
// Trả false + đã gửi lỗi nếu chặn. Bản ghi không tồn tại → true (để handler tự trả 404 riêng).
async function guardEntryRead(req: Request, res: Response, id: string): Promise<boolean> {
  const scope = scopeWhIds(req)
  const cats = scopeCategoriesOf(req)
  if (scope === null && cats === null) return true
  const { data, error } = await supabase.from('InventoryEntry')
    .select('warehouse_id, location:Location!location_id(warehouse_id), material:Material(category)')
    .eq('id', id).maybeSingle()
  if (error) { fail(res, 500, 'DB_ERROR', error.message); return false }
  if (!data) return true
  type LocWh = { warehouse_id: string | null }
  const row = data as unknown as { warehouse_id: string | null; location: LocWh | LocWh[] | null; material: { category: string | null } | { category: string | null }[] | null }
  const loc = Array.isArray(row.location) ? row.location[0] : row.location
  const wh = loc?.warehouse_id ?? row.warehouse_id ?? null
  if (scope !== null && (!wh || !scope.includes(wh))) {
    fail(res, 403, 'FORBIDDEN', 'Pallet không thuộc kho trong phạm vi của bạn'); return false
  }
  const mat = Array.isArray(row.material) ? row.material[0] : row.material
  if (!categoryAllowed(req, mat?.category)) { fail(res, 403, 'FORBIDDEN', CATEGORY_FORBIDDEN_MSG); return false }
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
  filterNmsx?: string[]
  nccIds?: string[]
  import_date_from?: string
  import_date_to?: string
}

// Escape ký tự đặc biệt LIKE/ILIKE (\ % _) → coi là literal. Mã pallet/vị trí đầy dấu '_';
// không escape thì '_' thành wildcard "1 ký tự bất kỳ" → search sai + omni khớp phình (URL fail).
// PostgreSQL dùng '\' làm ESCAPE mặc định nên '\_' = literal '_'. Áp cả term truyền vào RPC omni.
const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => '\\' + m)

// Trần an toàn cho số id nhét vào filter `col.in.(…)`: mỗi id ~37 ký tự → 350 id ≈ 13KB URL là mức
// PostgREST bắt đầu từ chối (đo 26/07: term khớp 350 id còn OK, 371 id → API 500). Giữ dưới mức đó.
const OMNI_ID_CAP = 300

// Thu hẹp id omni-search về id THỰC SỰ có dữ liệu trong bảng tồn (RPC DISTINCT trong DB — migration
// 20260726_omni_search_narrow.sql). KHÔNG mất dòng (id không có trong bảng thì không khớp dòng nào),
// chỉ để URL filter không phình: term "-" 453 mã → 38, "_" 194 vị trí → 171.
// RPC chưa apply → trả nguyên (giữ hành vi cũ) rồi bị chặn bởi trần trên với thông báo rõ.
async function narrowOmniIds(matIds?: string[], locIds?: string[]): Promise<[string[] | undefined, string[] | undefined]> {
  const call = async (fn: string, ids?: string[]): Promise<string[] | undefined> => {
    if (!ids || ids.length <= 60) return ids   // ít id → khỏi thêm roundtrip
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc(fn, { p_ids: ids }) as any)
    if (error) return ids
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map(r => String(r.id))
  }
  return [await call('omni_narrow_material_ids', matIds), await call('omni_narrow_location_ids', locIds)]
}

// Mảng rỗng → null cho tham số RPC (null = "không lọc theo chiều này")
const arrOrNull = (v: string[] | null | undefined): string[] | null => (v && v.length ? v : null)

function applyInventoryFilters(q: any, p: FilterParams): any {
  // Mặc định "Còn tồn" = status active VÀ tồn > 0 (user 18/07: upload cho phép tồn=0 → 31k dòng
  // tồn=0 status IN_STOCK lọt list dù filter ghi "Còn tồn"). Muốn xem cả tồn=0 → chọn "Tất cả".
  if (!p.status || p.status === '') q = q.in('status', ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING']).gt('cartons_remaining', 0)
  else if (p.status !== 'ALL')       q = q.eq('status', p.status)

  // Lọc KHO = cột warehouse_id TRỰC TIẾP (index idx_ie_wh_importdate) — cột đã backfill từ Location
  // + mọi writer set khi tạo / sync khi đổi vị trí (migration 20260727_entry_warehouse_id_direct).
  // ⚠️ TRƯỚC ĐÂY liệt kê mọi location_id của kho nhét vào .or(): kho 1.517 vị trí → filter ~56KB
  // → PostgREST nghiền 60s → Vercel 504 (bug filter Kho Bàu Bàng 27/07). KHÔNG quay lại cách cũ.
  const whIds = p.warehouseIds ?? []
  if (whIds.length === 1)    q = q.eq('warehouse_id', whIds[0])
  else if (whIds.length > 1) q = q.in('warehouse_id', whIds)
  // Lọc VỊ TRÍ cụ thể (facet chọn lẻ vài vị trí — id đã resolve + cắt scope ở resolveInventoryFilter)
  if (p.locationFilter && p.locationFilter.length > 0) q = q.in('location_id', p.locationFilter)
  if (p.materialFilter)  q = q.in('material_id', p.materialFilter)
  // Dùng embedded filter thay vì IN (material_id) để tránh URL quá dài khi nhiều material
  if (p.categoryFilter && p.categoryFilter.length === 1)    q = q.eq('material.category', p.categoryFilter[0])
  else if (p.categoryFilter && p.categoryFilter.length > 1) q = q.in('material.category', p.categoryFilter)
  if (p.qa_status_ids && p.qa_status_ids.length > 0) q = q.in('qa_status_id', p.qa_status_ids)
  if (p.search) {
    // Omni-search: khớp mã pallet HOẶC mã/tên hàng HOẶC mã vị trí (đã resolve ID trước)
    const term = escapeLike(p.search.replace(/[,()]/g, ' ').trim())
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
  const fNmsx = p.filterNmsx ?? []
  if (fNmsx.length === 1)    q = q.eq('nmsx', fNmsx[0])
  else if (fNmsx.length > 1) q = q.in('nmsx', fNmsx)
  const fNcc = p.nccIds ?? []
  if (fNcc.length === 1)    q = q.eq('ncc_id', fNcc[0])
  else if (fNcc.length > 1) q = q.in('ncc_id', fNcc)
  if (p.import_date_from) q = q.gte('import_date', p.import_date_from)
  if (p.import_date_to)   q = q.lte('import_date', p.import_date_to)
  return q
}

function parseArr(raw: string | undefined): string[] {
  return parseListParam(raw) ?? []
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
  // Lọc %Date: datePctIds ĐÃ là kết quả áp đủ filter (tính ở resolveInventoryFilter). Chỉ cần nạp
  // entry theo id — CHUNK 300 (né URL 414 khi vài chục nghìn id) thay vì nhồi cả tập vào 1 `.in()`.
  if (datePctIds !== null) {
    if (!datePctIds.length) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = await Promise.all(chunkArray(datePctIds, IN_CHUNK).map(c =>
      supabase.from('InventoryEntry').select(select).in('id', c)))
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cq = applyInventoryFilters(supabase.from('InventoryEntry').select(select, { count: 'exact', head: true }), params)
  const { count, error: cErr } = await cq
  if (cErr) throw new Error(cErr.message)
  const n = count ?? 0
  if (n === 0) return []

  const PAGE = 1000
  const reqs = []
  for (let p = 0; p * PAGE < n; p++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = applyInventoryFilters(supabase.from('InventoryEntry').select(select), params)
      .order('id', { ascending: true })
      .range(p * PAGE, p * PAGE + PAGE - 1)
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

// Chia mảng thành các lô nhỏ — chống `.in('id', ids)` với ids lớn (URL quá dài → 414 URI Too Large
// + cap ~1000 dòng/response). Dùng cho tập id lọc %Date (kho lớn có thể vài chục nghìn pallet).
function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
const IN_CHUNK = 300

// UPDATE hàng loạt theo tập id: BẮT BUỘC chunk — filter `.in()` nằm trên URL nên >300 id (36 ký tự)
// là vỡ (đo 27/07: 400 id đứt kết nối, 700 id → 400). Bulk chọn cả trang/cả kho vài nghìn pallet
// trước đây ném lỗi toàn bộ. Trả message lỗi đầu tiên (lô trước đã ghi — vẫn hơn hỏng sạch).
async function updateEntriesByIds(ids: string[], patch: Record<string, unknown>): Promise<string | null> {
  for (const c of chunkArray(ids, IN_CHUNK)) {
    const { error } = await supabase.from('InventoryEntry').update(patch).in('id', c)
    if (error) return error.message
  }
  return null
}

// Tổng cartons_remaining của 1 tập id (chunk 300 → tránh URL 414). Song song các lô.
async function sumRemainingByIds(ids: string[]): Promise<number> {
  if (!ids.length) return 0
  // BASE UNIT: tổng cross-mã = THÙNG QUY ĐỔI (base ÷ hệ_số per mã) — kéo kèm units qua embed
  const results = await Promise.all(chunkArray(ids, IN_CHUNK).map(c =>
    supabase.from('InventoryEntry').select('cartons_remaining, material:Material(base_unit, entry_unit, units_per_carton)').in('id', c)))
  let total = 0
  for (const r of results) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((r as any).error) throw new Error((r as any).error.message)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of ((r as any).data ?? [])) total += qtyEntryDecimal(Number(row.cartons_remaining ?? 0), row.material ?? null)
  }
  return total
}

// Đếm pallet còn tồn (>0) trong 1 tập id (chunk 300). Song song các lô.
async function countPositiveByIds(ids: string[]): Promise<number> {
  if (!ids.length) return 0
  const results = await Promise.all(chunkArray(ids, IN_CHUNK).map(c =>
    supabase.from('InventoryEntry').select('id', { count: 'exact', head: true }).in('id', c).gt('cartons_remaining', 0)))
  let total = 0
  for (const r of results) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((r as any).error) throw new Error((r as any).error.message)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    total += ((r as any).count as number | null) ?? 0
  }
  return total
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
  tooBroad?: string   // từ khóa khớp quá nhiều mã/vị trí → 400 kèm thông báo, KHÔNG để thành 500
  badParam?: string   // id sai dạng uuid (warehouse_ids/ncc_ids) → 400, kẻo 22P02 thành 500
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
  const manufacturer_id  = q.manufacturer_id
  const import_date_from = q.import_date_from
  const import_date_to   = q.import_date_to
  const page             = q.page  ?? '1'
  const limit            = q.limit ?? '50'

  // Multi-value params (comma-separated)
  const warehouseIds      = parseArr(q.warehouse_ids)
  const categories        = parseArr(q.categories)
  // warehouse_id/ncc_id là CỘT uuid — chuỗi lạ lọt xuống Postgres = 22P02 → 500 (fuzz 29/07)
  const badIds = nonUuidEntries([...warehouseIds, ...parseArr(q.ncc_ids)])

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
  const filterNmsx        = parseArr(q.filter_nmsx)
  const filterMaterialIds = parseArr(q.filter_material_ids)
  const qa_status_ids     = parseArr(q.qa_status_ids).length > 0 ? parseArr(q.qa_status_ids) : undefined
  const nccIds            = parseArr(q.ncc_ids)
  const datePctRanges     = parseArr(q.date_pct_ranges)

  const pageNum  = Math.max(1, parseInt(page) || 1)
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit) || 50))   // tối đa 1000/trang (= cap PostgREST 1 response)
  const offset   = (pageNum - 1) * limitNum

  const base = { params: {} as FilterParams, datePctIds: null as string[] | null, pageNum, limitNum, offset }

  if (badIds.length) return { ...base, badParam: `Tham số id không hợp lệ: ${badIds.slice(0, 3).join(', ')}` }

  // Empty intersection → user's scope and UI filter don't overlap → return empty immediately
  if (scopeWarehouses.length > 0 && warehouseIds.length > 0 && effectiveWarehouseIds.length === 0)
    return { ...base, empty: true }
  if (scopeCategories.length > 0 && categories.length > 0 && effectiveCategories.length === 0)
    return { ...base, empty: true }

  // Chỉ resolve id vị trí khi user CHỌN vị trí cụ thể trong facet. Lọc theo KHO đi thẳng cột
  // warehouse_id (applyInventoryFilters) — KHÔNG liệt kê nghìn vị trí của kho vào URL nữa.
  const needLocFilter = filterLocations.length > 0

  const locResult = needLocFilter ? await (async () => {
    try {
      // fetchAllRowsParallel: vượt cap ~1000 dòng/response (kho lớn >1000 vị trí)
      const rows = await fetchAllRowsParallel(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let locQ = supabase.from('Location').select('id').order('id')
        if (effectiveWarehouseIds.length === 1)    locQ = locQ.eq('warehouse_id', effectiveWarehouseIds[0])
        else if (effectiveWarehouseIds.length > 1) locQ = locQ.in('warehouse_id', effectiveWarehouseIds)
        if (filterLocations.length === 1)          locQ = locQ.eq('location_code', filterLocations[0])
        else if (filterLocations.length > 1)       locQ = locQ.in('location_code', filterLocations)
        return locQ
      })
      return { data: rows, error: null }
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  })() : { data: null, error: null }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((locResult as any).error) return { ...base, error: (locResult as any).error.message }

  let locationFilter: string[] | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((locResult as any).data !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    locationFilter = ((locResult as any).data ?? []).map((l: any) => l.id as string)
    // Có chọn vị trí cụ thể mà không resolve ra id nào (sai mã / ngoài scope kho) → list rỗng
    if (locationFilter!.length === 0) return { ...base, empty: true }
  }

  // filter_material_ids từ facet ĐÃ là material_id → dùng thẳng, không cần query Material resolve.
  // (Param material_search cũ đã BỎ — dead param 0 caller, term rộng resolve >1000 id nhét .in() = URL quá dài → 500.)
  const materialFilter: string[] | null = filterMaterialIds.length > 0 ? filterMaterialIds : null

  // Omni-search 1 ô: resolve material/location ID khớp term → search tìm cả mã pallet / mã+tên hàng / mã vị trí.
  // (ilike Postgres KHÔNG bỏ dấu — bỏ dấu server-side cần extension unaccent, xem ghi chú.)
  let searchMatIds: string[] | undefined
  let searchLocIds: string[] | undefined
  if (search && searchLooksLikeInjection(search)) return { ...base, tooBroad: SEARCH_INVALID_MSG }
  if (search) {
    const term = escapeLike(search.replace(/[,()]/g, ' ').trim())   // escape '_'/'%' → literal (mã đầy '_')
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
        const st = safeSearch(term)
        const [fmat, floc] = await Promise.all([
          supabase.from('Material').select('id')
            .or(`material_code.ilike.%${st}%,material_description.ilike.%${st}%,short_name.ilike.%${st}%,old_code.ilike.%${st}%`).limit(500),
          supabase.from('Location').select('id')
            .or(`location_code.ilike.%${st}%,sub_code.ilike.%${st}%,sub_name.ilike.%${st}%`).limit(500),
        ])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        searchMatIds = ((fmat as any).data ?? []).map((m: any) => m.id as string)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        searchLocIds = ((floc as any).data ?? []).map((l: any) => l.id as string)
      }
      // Term NGẮN/PHỔ BIẾN khớp hàng trăm mã ("51" → 371 mã, "-" → 453, "_" → 374, "a" → 500) làm
      // filter `material_id.in.(…)` phình >13KB → PostgREST từ chối → API 500, trang trắng (đo 26/07).
      // B1: thu hẹp về id thực có dữ liệu. B2: vẫn quá nhiều → 400 báo rõ (KHÔNG cắt id âm thầm = mất dòng).
      ;[searchMatIds, searchLocIds] = await narrowOmniIds(searchMatIds, searchLocIds)
      if ((searchMatIds?.length ?? 0) + (searchLocIds?.length ?? 0) > OMNI_ID_CAP) return {
        ...base,
        tooBroad: `Từ khóa "${search}" quá chung (khớp ${searchMatIds?.length ?? 0} mã hàng · ${searchLocIds?.length ?? 0} vị trí). Gõ thêm ký tự để thu hẹp.`,
      }
    }
  }

  const params: FilterParams = {
    status, locationFilter, materialFilter,
    warehouseIds: effectiveWarehouseIds.length > 0 ? effectiveWarehouseIds : undefined,
    categoryFilter: effectiveCategories.length > 0 ? effectiveCategories : undefined,
    qa_status_ids, search, searchMatIds, searchLocIds, manufacturer_id, filterCycles, filterMachines, filterNmsx, nccIds, import_date_from, import_date_to,
  }

  // Pre-filter by %date: fetch ALL IDs (no pagination) with same filters, compute pct in JS
  let datePctIds: string[] | null = null
  if (datePctRanges.length > 0) {
    // Always restrict pre-filter to active stock — %date on EXPORTED entries is meaningless.
    // Phân trang 1000 (cap response) để lấy ĐỦ dòng tính pct, không bị thiếu khi >1000 dòng.
    let preEntries: any[]
    try {
      // import_date thêm vào để sort datePctIds ĐÚNG thứ tự list (import_date desc, id asc) — nhờ đó
      // listInventory chỉ cần slice trang rồi `.in()` ~50 id, không nhồi cả tập id vào URL (tránh 414).
      preEntries = await fetchAllInventory('id, import_date, production_date, expiry_date, ncc_id, shelf_life_days, material:Material(shelf_life_days, supplier_shelf_life_overrides)', { ...params, status: '' }, null)
    } catch (e) {
      return { ...base, error: (e as Error).message }
    }
    const now = Date.now()
    datePctIds = (preEntries ?? [])
      .filter((e: any) => {
        const pct = computePctDate(e, e.material, now)   // ưu tiên HSD tường minh (tem V2), fallback NSX+shelflife
        if (pct == null) return false
        return datePctRanges.some(r => matchDatePct(Math.round(pct), r))
      })
      // Sort khớp listInventory: import_date desc (null cuối) + id asc → slice trang là ra đúng trang.
      .sort((a: any, b: any) => {
        const ad = a.import_date ?? '', bd = b.import_date ?? ''
        if (ad !== bd) { if (!ad) return 1; if (!bd) return -1; return ad > bd ? -1 : 1 }
        return String(a.id) < String(b.id) ? -1 : 1
      })
      .map((e: any) => e.id as string)

    if (datePctIds!.length === 0) return { ...base, params, empty: true }
  }

  return { params, datePctIds, pageNum, limitNum, offset }
}

export async function listInventory(req: Request, res: Response) {
  const r = await resolveInventoryFilter(req)
  if (r.tooBroad) return fail(res, 400, 'SEARCH_TOO_BROAD', r.tooBroad)
  if (r.badParam) return fail(res, 400, 'INVALID_ID', r.badParam)
  if (r.error) return fail(res, 500, 'DB_ERROR', r.error)
  if (r.empty) return ok(res, { entries: [], total: 0, page: r.pageNum, limit: r.limitNum, total_cartons_remaining: 0, total_pallets_in_stock: 0 })

  // Khi lọc Loại kho: dùng Material!inner để filter category loại HẲN entry khác loại. Embedded filter
  // non-inner (material:Material(...)) chỉ left-join → entry khác category vẫn trả về với material=null
  // (lọt "dòng ma" + phình count). Không lọc category → giữ select gốc (không loại entry material null).
  const catActive = !!(r.params.categoryFilter && r.params.categoryFilter.length)
  const mainSelect = catActive ? ENTRY_SELECT.replace('material:Material(', 'material:Material!inner(') : ENTRY_SELECT

  // ── Nhánh LỌC %DATE: datePctIds đã lọc + sort sẵn (import_date desc, id asc) ở resolve. KHÔNG nhồi
  // cả tập id vào `.in()` (kho lớn vài chục nghìn → URL 414). Slice trang → chỉ `.in()` ~limit id;
  // tổng/đếm chunk 300. ──
  if (r.datePctIds !== null) {
    const allIds = r.datePctIds
    const pageIds = allIds.slice(r.offset, r.offset + r.limitNum)
    try {
      let rows: any[] = []
      if (pageIds.length) {
        const { data, error } = await supabase.from('InventoryEntry').select(mainSelect).in('id', pageIds)
        if (error) return fail(res, 500, 'DB_ERROR', error.message)
        // `.in()` không giữ thứ tự → sắp lại theo pageIds (đã đúng import_date desc, id asc)
        const pos = new Map(pageIds.map((id, i) => [id, i]))
        rows = ((data ?? []) as any[]).sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
      }
      const [total_cartons_remaining, total_pallets_in_stock] = await Promise.all([
        sumRemainingByIds(allIds),
        countPositiveByIds(allIds),
      ])
      return ok(res, { entries: rows, total: allIds.length, page: r.pageNum, limit: r.limitNum, total_cartons_remaining, total_pallets_in_stock })
    } catch (e) {
      return fail(res, 500, 'DB_ERROR', (e as Error).message)
    }
  }

  // ── Nhánh KHÔNG lọc %Date: phân trang + aggregate SUM/count phía DB (nhanh) ──
  // Main paginated query — sort by import_date desc + id asc để đảm bảo thứ tự ổn định giữa các trang
  const mainQ = applyInventoryFilters(
    supabase.from('InventoryEntry').select(mainSelect, { count: 'exact' }),
    r.params
  )
    .order('import_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .range(r.offset, r.offset + r.limitNum - 1)

  // Tổng thùng tồn: aggregate SUM phía DB (db-aggregates-enabled đã bật lại) — 1 query thay vì kéo ~4000
  // dòng về Node. Tái dùng NGUYÊN applyInventoryFilters → tổng khớp tuyệt đối list. catActive: embed
  // material!inner để lọc category → PostgREST group-by category (mỗi category 1 dòng) nên cộng .sum tất cả.
  // BASE UNIT: SUM group theo material_id để chia hệ số ra "thùng quy đổi" (JS chia sau khi nhận group).
  // Group rows ≤ số mã khớp filter — phân trang qua fetchAllPaged để không dính cap 1000.
  // 2 ô SummaryBand ("Thùng tồn" + "Pallet") gom trong MỘT lời gọi RPC `inventory_band_totals`.
  //
  // Bản cũ không phải 1 query mà là một CHUỖI round-trip: `fetchAllPaged` nạp nhóm SUM theo
  // material_id (tới ~2.700 dòng) → rồi chunk 300 tra `Material` lấy hệ số thùng → quy đổi trong
  // Node → cộng thêm 1 query đếm pallet còn tồn. Đo 28/07 (gói QA `06-readload` + đường cong sức
  // chứa): trang Tồn kho từ 1.955ms (0 người ghi) lên **19.774ms ở 24 người ghi** rồi vượt trần
  // 8s của PostgREST thành 500 — trong khi câu NHẸ cùng lúc vẫn 1.147ms và connection chỉ 26/60,
  // tức nút thắt nằm ở chính chuỗi round-trip này.
  const bandQ = supabase.rpc('inventory_band_totals', {
    p_ids:            r.datePctIds,
    p_status:         r.params.status ?? null,
    p_wh_ids:         arrOrNull(r.params.warehouseIds),
    p_location_ids:   arrOrNull(r.params.locationFilter),
    p_material_ids:   arrOrNull(r.params.materialFilter),
    p_categories:     arrOrNull(r.params.categoryFilter),
    p_qa_ids:         arrOrNull(r.params.qa_status_ids),
    p_search:         r.params.search ? r.params.search.replace(/[,()]/g, ' ').trim() : null,
    p_search_mat_ids: arrOrNull(r.params.searchMatIds),
    p_search_loc_ids: arrOrNull(r.params.searchLocIds),
    p_manufacturer:   r.params.manufacturer_id ?? null,
    p_cycles:         arrOrNull(r.params.filterCycles),
    p_machines:       arrOrNull(r.params.filterMachines),
    p_nmsx:           arrOrNull(r.params.filterNmsx),
    p_ncc_ids:        arrOrNull(r.params.nccIds),
    p_import_from:    r.params.import_date_from ?? null,
    p_import_to:      r.params.import_date_to ?? null,
  })

  // Chạy SONG SONG: list rows (main) + 2 ô band (1 RPC) — độc lập nhau.
  const [mainRes, bandRes] = await Promise.all([mainQ, bandQ])
  const { data, count, error } = mainRes
  if (error) {
    // Trang vượt phạm vi = TRANG RỖNG, không phải lỗi hệ thống. Số trang được NHỚ THEO USER
    // (`scopedPersist`) nên mở lại app khi dữ liệu đã ít đi là gặp ngay. Xem `isRangeNotSatisfiable`.
    // Đếm tổng CHỈ chạy ở nhánh này (query chính đã mang `count:'exact'`) — thêm 1 câu đếm luôn
    // chạy là tự làm nặng đường nóng: đo 28/07 dưới tải ghi, mỗi câu đếm thừa đẩy trang này thêm
    // vài giây và tới trần 8s của PostgREST thì thành 500.
    if (isRangeNotSatisfiable(error)) {
      const { count: totCount } = await applyInventoryFilters(
        supabase.from('InventoryEntry').select('id', { count: 'exact', head: true }), r.params,
      )
      const band0 = (bandRes.data ?? {}) as { total_pallets_in_stock?: number }
      return ok(res, {
        entries: [], total: totCount ?? 0,
        page: r.pageNum, limit: r.limitNum,
        total_cartons_remaining: 0, total_pallets_in_stock: Number(band0.total_pallets_in_stock) || 0,
      })
    }
    return fail(res, 500, 'DB_ERROR', error.message)
  }

  // Lỗi band KHÔNG chặn list (rows vẫn hiện), chỉ để tổng = 0 và log.
  let total_cartons_remaining = 0
  let total_pallets_in_stock = 0
  // Tách ô tổng theo ĐƠN VỊ (21/08) — RPC cũ chưa trả khoá này thì [] và FE tự ẩn dòng phụ.
  let by_unit: { unit: string; qty: number }[] = []
  if (bandRes.error) console.error('[inventory] tính 2 ô band lỗi:', bandRes.error.message)
  else {
    const b = (bandRes.data ?? {}) as {
      total_cartons_remaining?: number; total_pallets_in_stock?: number
      by_unit?: { unit: string; qty: number }[]
    }
    total_cartons_remaining = Number(b.total_cartons_remaining) || 0
    total_pallets_in_stock  = Number(b.total_pallets_in_stock)  || 0
    by_unit = Array.isArray(b.by_unit) ? b.by_unit : []
  }

  return ok(res, { entries: data ?? [], total: count ?? 0, page: r.pageNum, limit: r.limitNum, total_cartons_remaining, total_pallets_in_stock, by_unit })
}

// View tổng hợp: gom tồn kho theo (Kho × Mã hàng × Ngày SX) — KHÔNG chi tiết tới pallet.
// Vì %date suy ra từ ngày SX + hạn dùng nên mỗi nhóm có 1 giá trị %date duy nhất.
//
// GOM + PHÂN TRANG TRONG SQL (RPC `inventory_summary_page`). Đo 28/07 với 52.635 pallet →
// 41.107 nhóm: đường cũ trả HẾT nhóm = **18.147KB / 12,8s** (4× trần 4,5MB của Vercel — local
// "chạy được", production đứt); gom trong Node vẫn phải kéo 52.635 dòng thô MỖI lần đổi trang
// (duyệt 42 trang = 251s). Nay DB gom 1 lượt, chỉ trả 1 trang.
// ⚠️ Bộ lọc trong RPC phải KHỚP `applyInventoryFilters` — đổi 1 bên mà quên bên kia là bảng và
// ô tổng lệch nhau. Xem migration 20260728c_inventory_summary_paged_rpc.sql
export async function summaryInventory(req: Request, res: Response) {
  const r = await resolveInventoryFilter(req)
  if (r.tooBroad) return fail(res, 400, 'SEARCH_TOO_BROAD', r.tooBroad)
  if (r.badParam) return fail(res, 400, 'INVALID_ID', r.badParam)
  if (r.error) return fail(res, 500, 'DB_ERROR', r.error)
  if (r.empty) return ok(res, { groups: [], total: 0, total_cartons_remaining: 0, page: r.pageNum, limit: r.limitNum })

  const p = r.params
  const arr = (v: string[] | null | undefined) => (v && v.length ? v : null)
  const { data, error } = await supabase.rpc('inventory_summary_page', {
    // Lọc %Date: tầng TS đã resolve tập id ĐÃ áp đủ filter khác → chỉ cần lọc theo id.
    // Danh sách id đi POST body của RPC nên KHÔNG dính trần ~300 id của URL PostgREST.
    p_ids:            r.datePctIds,
    p_status:         p.status ?? null,
    p_wh_ids:         arr(p.warehouseIds),
    p_location_ids:   arr(p.locationFilter),
    p_material_ids:   arr(p.materialFilter),
    p_categories:     arr(p.categoryFilter),
    p_qa_ids:         arr(p.qa_status_ids),
    p_search:         p.search ? p.search.replace(/[,()]/g, ' ').trim() : null,
    p_search_mat_ids: arr(p.searchMatIds),
    p_search_loc_ids: arr(p.searchLocIds),
    p_manufacturer:   p.manufacturer_id ?? null,
    p_cycles:         arr(p.filterCycles),
    p_machines:       arr(p.filterMachines),
    p_nmsx:           arr(p.filterNmsx),
    p_ncc_ids:        arr(p.nccIds),
    p_import_from:    p.import_date_from ?? null,
    p_import_to:      p.import_date_to ?? null,
    p_offset:         r.offset,
    p_limit:          r.limitNum,
  })
  if (error) return fail(res, 500, 'DB_ERROR', error.message)

  type RpcGroup = MaterialShelfInfo & {
    warehouse_id: string | null; warehouse_name: string; material_id: string
    material_code: string | null; short_name: string | null; category: string | null
    production_date: string | null; expiry_date: string | null
    ncc_id: string | null; ncc_name: string | null
    mat_shelf_life_days: number | null
    cartons_imported: number; cartons_remaining: number; cartons_exported: number
    pallet_count: number; base_unit: string | null; entry_unit: string | null; units_per_carton: number | null
  }
  const out = (data ?? {}) as {
    total?: number; total_cartons_remaining?: number; groups?: RpcGroup[]
    by_unit?: { unit: string; qty: number }[]
  }
  const now = Date.now()
  // %Date tính bằng hàm TẬP TRUNG `computePctDate` cho ĐÚNG các nhóm của trang — cố tình KHÔNG
  // viết lại công thức trong SQL (shelf-life có ngoại lệ theo NCC; tách 2 nơi là lệch số).
  const groups = (out.groups ?? []).map(g => {
    const pct = computePctDate(
      { production_date: g.production_date, expiry_date: g.expiry_date, ncc_id: g.ncc_id, shelf_life_days: g.shelf_life_days },
      { shelf_life_days: g.mat_shelf_life_days, supplier_shelf_life_overrides: g.supplier_shelf_life_overrides },
      now,
    )
    return {
      warehouse_id: g.warehouse_id, warehouse_name: g.warehouse_name, material_id: g.material_id,
      material_code: g.material_code, short_name: g.short_name, category: g.category,
      production_date: g.production_date,
      date_pct: pct == null ? null : Math.round(pct),
      ncc_name: g.ncc_name,
      cartons_imported: Number(g.cartons_imported) || 0,
      cartons_remaining: Number(g.cartons_remaining) || 0,
      cartons_exported: Number(g.cartons_exported) || 0,
      pallet_count: Number(g.pallet_count) || 0,
      base_unit: g.base_unit, entry_unit: g.entry_unit, units_per_carton: g.units_per_carton,
    }
  })
  return ok(res, {
    groups,
    total: out.total ?? 0,
    // BASE UNIT: tổng cross-mã = thùng quy đổi per-mã rồi mới cộng (SQL dùng chung qty_entry_decimal)
    total_cartons_remaining: Number(out.total_cartons_remaining) || 0,
    // Tách ô tổng theo ĐƠN VỊ (21/08) — RPC cũ chưa trả thì [] và FE tự ẩn dòng phụ.
    by_unit: Array.isArray(out.by_unit) ? out.by_unit : [],
    page: r.pageNum, limit: r.limitNum,
  })
}

// Export chi tiết pallet: trả TOÀN BỘ entry khớp filter (phân trang 1000) để FE dựng Excel.
// Cùng resolveInventoryFilter → khớp tuyệt đối view pallet. (Summary export dùng dữ liệu /summary sẵn có ở FE.)
export async function exportInventory(req: Request, res: Response) {
  const r = await resolveInventoryFilter(req)
  if (r.tooBroad) return fail(res, 400, 'SEARCH_TOO_BROAD', r.tooBroad)
  if (r.badParam) return fail(res, 400, 'INVALID_ID', r.badParam)
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
  // Intersect với scope JWT — không tin query param (trước đây truyền tay kho/loại khác vẫn xem được facet)
  const scopeWh   = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : []
  const scopeCats = scopeCategoriesOf(req)
  const reqWh  = parseArr(q.warehouse_ids)
  const reqCat = parseArr(q.categories)
  if (nonUuidEntries(reqWh).length) return fail(res, 400, 'INVALID_ID', 'Tham số warehouse_ids không hợp lệ')
  const warehouseIds = scopeWh.length > 0 ? (reqWh.length > 0 ? reqWh.filter(id => scopeWh.includes(id)) : scopeWh) : reqWh
  const categories   = scopeCats ? (reqCat.length > 0 ? reqCat.filter(c => scopeCats.includes(c)) : scopeCats) : reqCat
  if ((scopeWh.length > 0 && warehouseIds.length === 0) || (scopeCats && categories.length === 0)) {
    return ok(res, { cycles: [], machines: [], locations: [], materials: [], nccs: [] })
  }

  // Chu kỳ / Máy / NCC: DISTINCT DƯỚI DB (RPC `inventory_facet_values`) — trước đây kéo TOÀN BỘ
  // dòng tồn IN_STOCK/PARTIAL về Node chỉ để gom tập giá trị: 12.637 dòng ≈ 13 round-trip hôm nay,
  // vài triệu dòng/năm là hàng nghìn round-trip mỗi lần mở trang Tồn kho.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let facetVals: { kind: string; val: string }[]
  try {
    const { data, error } = await supabase.rpc('inventory_facet_values', {
      p_warehouse_ids: warehouseIds.length ? warehouseIds : null,
      p_categories:    categories.length   ? categories   : null,
    })
    if (error) throw error
    facetVals = (data ?? []) as { kind: string; val: string }[]
  } catch (e) {
    return fail(res, 500, 'DB_ERROR', (e as Error).message)
  }

  const pick = (k: string) => facetVals.filter(v => v.kind === k).map(v => v.val)
  const cycles   = pick('cycle').sort()
  const machines = pick('machine').sort()

  // NCC facet: hàng nhập NCC có ncc_id (đoạn 4 QR = mã NCC, machine_code = null) → lọc "Máy" không ra.
  // Lấy tên NCC từ TransportCompany cho các ncc_id thực có trong tồn (scope kho/loại hàng).
  const nccIds = pick('ncc')
  let nccs: { id: string; name: string }[] = []
  if (nccIds.length) {
    // Chunk 300 + phân trang (fetchAllByIdChunks) — >1000 NCC distinct trong tồn thì facet NCC bị cắt âm thầm
    const nccData = await fetchAllByIdChunks(nccIds, chunk =>
      supabase.from('TransportCompany').select('id, name').in('id', chunk).order('name'))
    nccs = (nccData as any[])
      .map((n: any) => ({ id: n.id as string, name: n.name as string }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }

  // `materials` + `locations` KHÔNG còn nằm trong facet: 2.740 mã + 1.753 vị trí = phần lớn
  // của 420KB mỗi lần mở trang. Hai filter đó nay TÌM TRÊN SERVER
  // (`/masterdata/materials?search=&limit=` và `/masterdata/locations?search=&limit=`).
  return ok(res, { cycles, machines, nccs })
}

// Trạng thái mà ĐIỀU CHỈNH TỒN được phép TỰ SUY LẠI status (hết → EXPORTED, đủ → IN_STOCK,
// còn dở → PARTIAL). KHÁC danh sách "pallet còn sống" của upload bên dưới (`ACTIVE_PALLET_STATUSES`)
// — hai tập KHÔNG trùng nhau (ở đây có EXPORTED, không có QUARANTINE/LOOSE_PICKING) nên phải mang
// TÊN RIÊNG; trước 14/08 cả hai đều tên `ACTIVE_STATUSES` trong CÙNG file, rất dễ dùng nhầm.
const STATUS_RECALC_ON_ADJUST = ['IN_STOCK', 'PARTIAL', 'EXPORTED']

export async function adjustInventory(req: Request, res: Response) {
  const { id } = req.params
  const { adjustment, stocktake_by, employee_id, note, actor_name } = req.body as {
    adjustment: number; stocktake_by?: string; employee_id?: string; note?: string; actor_name?: string
  }

  if (typeof adjustment !== 'number' || adjustment === 0) {
    return fail(res, 400, 'INVALID_INPUT', 'adjustment phải là số khác 0')
  }
  if (!requireBaseQty(req, res)) return   // BASE UNIT: chặn payload bundle cũ (thùng thập phân)
  if (!(await guardEntriesScope(req, res, [id]))) return

  // BASE UNIT: adjustment = SỐ BASE — mã có entry phải là số nguyên
  {
    const { data: entMat } = await supabase.from('InventoryEntry')
      .select('material:Material!material_id(base_unit, entry_unit, units_per_carton)').eq('id', id).maybeSingle()
    const ie = qtyIntegerError(adjustment, ((entMat as any)?.material ?? null) as MatUnits | null)
    if (ie) return fail(res, 422, 'VALIDATION_ERROR', ie)
  }

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const isValidUUID = (s?: string) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  const updatedBy: string | null = isValidUUID(employee_id) && employee_id ? employee_id : null

  // NGUYÊN TỬ: gộp cập-nhật-tồn + ghi-AdjustmentLog trong 1 transaction (RPC row-lock).
  // Chống mất dòng log khi request bị 504 xen giữa 2 bước (test tải 23/07) + bỏ bão CAS-retry.
  const { data: rpcResult, error: rpcErr } = await supabase.rpc('adjust_inventory_atomic', {
    p_entry_id: id, p_delta: adjustment, p_note: note?.trim() || null,
    p_actor_name: actor_name?.trim() || null, p_actor_id: updatedBy,
    p_stocktake_by: stocktake_by || null, p_now: now, p_vn_date: vnDate, p_updated_by: updatedBy,
  })
  if (!rpcErr) {
    if (rpcResult === 'NOT_FOUND') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')
    if (rpcResult === 'NEGATIVE') return fail(res, 400, 'INVALID_INPUT', 'Tồn kho không thể âm')
    const { data: entry } = await supabase.from('InventoryEntry').select(ENTRY_SELECT).eq('id', id).maybeSingle()
    return ok(res, { entry })
  }

  // Fallback (RPC chưa deploy — vd production trước khi apply migration 20260723_adjust_inventory_atomic.sql):
  // đọc–tính–ghi optimistic-CAS + jitter, log riêng như cũ (không nguyên tử nhưng đúng khi không có 504).
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
    if (STATUS_RECALC_ON_ADJUST.includes(entry.status)) {
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
  if (!(await guardEntryRead(req, res, id))) return   // chống IDOR: lịch sử điều chỉnh chỉ cho pallet trong phạm vi
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

  const upErr = await updateEntriesByIds(ids, patch)   // chunk 300 — bulk vài nghìn pallet không vỡ URL
  if (upErr) return fail(res, 500, 'DB_ERROR', upErr)
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

  const upErr = await updateEntriesByIds(ids, patch)   // chunk 300 — bulk vài nghìn pallet không vỡ URL
  if (upErr) return fail(res, 500, 'DB_ERROR', upErr)
  return ok(res, { updated: ids.length })
}

export async function bulkTransferLocation(req: Request, res: Response) {
  const { ids, location_id, employee_id } = req.body as {
    ids: string[]; location_id: string; employee_id?: string
  }
  // Màn "Chuyển vị trí quét QR" (20/08): 1 lần chuyển = 1 lượt kiểm kê của pallet đó —
  // ghi StocktakeLog (chỉ đánh dấu đã kiểm, không đếm SL) + stocktake_at. Cờ opt-in để
  // panel Chuyển vị trí hàng loạt ở Tồn kho giữ nguyên hành vi cũ.
  const countAsStocktake = (req.body as { count_as_stocktake?: unknown }).count_as_stocktake === true
  if (!Array.isArray(ids) || ids.length === 0)
    return fail(res, 400, 'INVALID_INPUT', 'Cần ít nhất 1 pallet')
  if (!location_id)
    return fail(res, 400, 'INVALID_INPUT', 'Thiếu location_id')
  if (!(await guardEntriesScope(req, res, ids))) return

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const updatedBy = (employee_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee_id))
    ? employee_id : null

  // QUY TẮC CẤT HÀNG — cửa này từng đi thẳng xuống RPC, nên kho bật "bắt buộc" vẫn dồn được pallet
  // vào ô cấm nhận hàng / ô nhặt lẻ / vượt số mã. Lọc ở picker chỉ là gợi ý; chặn thật nằm ở đây.
  // fetchAllByIdChunks (chunk 300) chứ KHÔNG cắt danh sách: luật ở đây tính trên TẬP mã/NCC của cả
  // lô, thiếu vài pallet là chấm ra kết quả khác — đúng lớp lỗi "cắt âm thầm" đã đo nhiều lần.
  // Select đủ trường snapshot cho StocktakeLog (nhánh count_as_stocktake) — chụp TRƯỚC khi move
  // để còn biết vị trí CŨ; nhánh thường chỉ dùng 5 cột đầu, thừa vài cột không đáng kể.
  const moving = await fetchAllByIdChunks(ids, chunk => supabase.from('InventoryEntry')
    .select(`id, pallet_code, location_id, cartons_remaining, material_id, ncc_id, production_date,
      expiry_date, shelf_life_days,
      material:Material!material_id(material_code, short_name, base_unit, entry_unit, units_per_carton),
      location:Location!location_id(location_code)`)
    .in('id', chunk))
  const { data: destLoc } = await supabase.from('Location')
    .select('warehouse_id, location_code, categories').eq('id', location_id).maybeSingle()
  const put = await guardPutawayBatch({
    warehouseId: (destLoc as { warehouse_id?: string | null } | null)?.warehouse_id ?? null,
    locationId:  location_id,
    entries:     moving as unknown as IncomingInput[],
    overrideReason: (req.body as { putaway_override_reason?: unknown }).putaway_override_reason,
    canOverride:    canPutawayOverride(req),
  })
  if (put.error) return fail(res, put.error.code === 'FORBIDDEN' ? 403 : 422, put.error.code, put.error.message)

  // Nguyên tử: RPC khóa dòng Location → đếm sức chứa DƯỚI LOCK → move trong cùng transaction.
  // Chống đua quá-tải vị trí khi nhiều người dồn cùng lúc vào CÙNG vị trí.
  const { data: result, error: rpcErr } = await supabase.rpc('move_pallets_to_location', {
    p_ids: ids, p_location_id: location_id, p_updated_by: updatedBy, p_update_date: vnDate, p_now: now,
    // Chốt lại số mã dưới row-lock — hai người cùng dồn vào một ô thì cả hai cùng đọc "còn chỗ mã"
    // Chỉ chốt dưới row-lock khi luật này ở mức BẮT BUỘC (xem inboundController cùng lý lẽ)
    p_max_materials: (putawayEnforces(put.rules, 'MAX_MATERIALS') && !put.trace.putaway_override_reason)
      ? put.max_materials : null,
    p_putaway_checked:         put.trace.putaway_checked ? true : null,
    p_putaway_violation:       put.trace.putaway_violation,
    p_putaway_override_reason: put.trace.putaway_override_reason,
  })
  if (!rpcErr) {
    const parts = String(result ?? '').split('|')
    switch (parts[0]) {
      case 'NO_IDS':    return fail(res, 400, 'INVALID_INPUT', 'Cần ít nhất 1 pallet')
      case 'NOT_FOUND': return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
      case 'INACTIVE':  return fail(res, 400, 'LOCATION_INACTIVE', 'Vị trí không hoạt động')
      case 'FULL':      return fail(res, 400, 'LOCATION_FULL',
        `Vị trí ${parts[2] ?? ''} không đủ chỗ (còn ${parts[1] ?? 0} slot, cần ${ids.length})`)
      case 'MAXMAT':    return fail(res, 422, 'PUTAWAY_VIOLATION',
        `Vị trí sẽ có ${parts[1] ?? ''} mã, kho giới hạn ${parts[2] ?? ''} mã cho một vị trí.`)
      default: {
        // 1 lần chuyển vị trí = 1 lượt kiểm kê của pallet (màn Chuyển vị trí quét QR): ghi
        // StocktakeLog append-only (chỉ xác nhận pallet có mặt — physical_qty null, không đếm SL)
        // + stocktake_at để tab Tổng hợp KK/Luân phiên ABC tính "đã kiểm". Ghi SAU khi move đã
        // commit; lỗi ghi log KHÔNG làm hỏng lượt chuyển (cùng cách stocktakeEntry).
        if (countAsStocktake) {
          try {
            type MovingSnap = {
              id: string; pallet_code: string; location_id: string | null; cartons_remaining: number | null
              material_id: string | null
              material?: { material_code?: string; short_name?: string; base_unit?: string; entry_unit?: string; units_per_carton?: number } | null
              location?: { location_code?: string } | null
            }
            const dest = destLoc as { warehouse_id?: string | null; location_code?: string | null; categories?: string[] | null } | null
            const rows = (moving as unknown as MovingSnap[]).map(en => ({
              id: randomUUID(),
              entry_id: en.id,
              pallet_code: en.pallet_code,
              location_id,                              // vị trí ĐÍCH — nơi pallet thực đứng lúc kiểm
              location_code: dest?.location_code ?? null,
              warehouse_id: dest?.warehouse_id ?? null,
              categories: dest?.categories ?? null,
              material_id: en.material_id,
              material_code: en.material?.material_code ?? null,
              short_name: en.material?.short_name ?? null,
              base_unit: en.material?.base_unit ?? null,
              entry_unit: en.material?.entry_unit ?? null,
              units_per_carton: en.material?.units_per_carton ?? null,
              app_qty: Number(en.cartons_remaining ?? 0),
              physical_qty: null,
              diff: null,
              is_flagged: false,
              note: 'Kiểm kê qua chuyển vị trí (quét QR)',
              location_changed_to: en.location_id !== location_id ? location_id : null,
              location_from_id:   en.location_id,
              location_from_code: en.location?.location_code ?? null,
              counted_by: updatedBy,
              counted_by_name: req.user?.name ?? null,
              counted_at: now, created_at: now, updated_at: now,
            }))
            if (rows.length > 0) {
              const { error: logErr } = await supabase.from('StocktakeLog').insert(rows)
              if (logErr) throw new Error(logErr.message)
              const stPatch: Record<string, unknown> = { stocktake_at: now, updated_at: now }
              if (updatedBy) stPatch.stocktake_by = updatedBy
              await updateEntriesByIds(ids, stPatch)
            }
          } catch (e) {
            console.error('StocktakeLog (move) insert failed:', (e as Error).message)
          }
        }
        return ok(res, { updated: ids.length, location_code: parts[1] ?? '', putaway_warning: put.warning, stocktake_logged: countAsStocktake })
      }
    }
  }
  // RPC vắng mặt ⇒ BÁO LỖI, KHÔNG tự đi đường vòng. Nhánh dự phòng cũ (đếm sức chứa rồi update)
  // không nguyên tử VÀ bỏ qua luật "tối đa N mã/vị trí" — cứu được tính năng nhưng lặng lẽ tắt 2
  // lớp bảo vệ. Cùng cách xử như slottingController.scanMove.
  if (rpcErr.code === 'PGRST202' || /Could not find the function|does not exist/i.test(rpcErr.message ?? ''))
    return fail(res, 503, 'NOT_READY', 'Chưa apply RPC move_pallets_to_location')
  return fail(res, 500, 'DB_ERROR', rpcErr.message)
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

  const upErr = await updateEntriesByIds(ids, patch)   // chunk 300 — bulk vài nghìn pallet không vỡ URL
  if (upErr) return fail(res, 500, 'DB_ERROR', upErr)
  return ok(res, { updated: ids.length, material_code: mat.material_code })
}

// ─── Stocktake (kiểm kê / check vị trí) ──────────────────────

export async function stocktakeCheck(req: Request, res: Response) {
  const { qr_code, warehouse_id } = req.body as { qr_code: string; warehouse_id?: string }
  const palletCode = normalizeQR(qr_code ?? '')   // tem V2 (`;`) đệm space từng đoạn → chuẩn hóa để khớp pallet_code đã lưu
  if (!palletCode) return fail(res, 400, 'INVALID_INPUT', 'Thiếu mã pallet')

  // warehouse_id (tùy chọn — màn Chuyển vị trí BẮT BUỘC gửi, user chốt 20/08): 1 mã pallet có thể
  // tồn ở NHIỀU kho (mã trùng 2 kho — đã có gói QA 27 đo), không khoanh kho thì "dòng mới nhất"
  // có thể là pallet của kho khác → chuyển nhầm hàng của kho người ta.
  let q = supabase.from('InventoryEntry')
    .select(ENTRY_SELECT)
    .eq('pallet_code', palletCode)
    .in('status', ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING'])
    .gt('cartons_remaining', 0)   // bỏ pallet đã HẾT TỒN (remaining 0 = đã xuất hết, không kiểm)
  if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)
  const { data, error } = await q
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  if (!data) return fail(res, 404, 'NOT_FOUND', (await wrongFormatHint(palletCode)) ?? `Không tìm thấy pallet "${palletCode}" trong tồn kho`)
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
    .select(`id, pallet_code, location_id, cartons_remaining, material_id,
      material:Material!material_id(material_code, short_name, base_unit, entry_unit, units_per_carton),
      location:Location!location_id(location_code, warehouse_id, categories)`)
    .eq('id', id).maybeSingle()

  if (fetchErr) return fail(res, 500, 'DB_ERROR', fetchErr.message)
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')
  if (!(await guardEntriesScope(req, res, [id]))) return

  // BASE UNIT: physical_count từ FE = SỐ BASE (đếm N thùng + M hộp → quy đổi tại rìa) — mã entry phải nguyên
  if (physical_count !== undefined && physical_count !== null) {
    if (!requireBaseQty(req, res)) return
    const ie = qtyIntegerError(Number(physical_count), ((existing as any).material ?? null) as MatUnits | null)
    if (ie) return fail(res, 422, 'VALIDATION_ERROR', ie)
  }

  const now    = new Date().toISOString()
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const patch: Record<string, unknown> = { stocktake_at: now, updated_at: now, update_date: vnDate }

  if (employee_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee_id)) {
    patch.stocktake_by = employee_id
    patch.updated_by   = employee_id
  }

  // Đổi vị trí khi kiểm: nạp vị trí mới 1 lần — sync cả warehouse_id (cột lọc theo kho) + dùng lại cho snapshot log
  type SnapLoc = { location_code?: string; warehouse_id?: string; categories?: string[] | null }
  let newLoc: SnapLoc | null = null
  if (new_location_id) {
    if (new_location_id !== existing.location_id) {
      const { data: nl } = await supabase.from('Location')
        .select('location_code, warehouse_id, categories').eq('id', new_location_id).maybeSingle()
      newLoc = (nl as SnapLoc | null) ?? null
    }
    patch.location_id = new_location_id
    if (newLoc?.warehouse_id) patch.warehouse_id = newLoc.warehouse_id
  }

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

  // Nhật ký kiểm kê (append-only): 1 dòng mỗi lần kiểm → xem lại quá khứ vô thời hạn.
  // Snapshot đủ trường để độc lập dòng tồn sống. Lỗi ghi log KHÔNG làm hỏng lượt kiểm (đã lưu xong).
  try {
    const appCount = Number(existing.cartons_remaining ?? 0)
    const phys = (physical_count !== undefined && physical_count !== null) ? Number(physical_count) : null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mat = (existing as any).material as { material_code?: string; short_name?: string; base_unit?: string; entry_unit?: string; units_per_carton?: number } | null
    // Vị trí nơi ĐẾM: nếu đổi vị trí → lấy vị trí mới; ngược lại vị trí app hiện tại
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let snapLoc = (existing as any).location as { location_code?: string; warehouse_id?: string; categories?: string[] | null } | null
    let snapLocId = existing.location_id as string | null
    const fromLocCode = snapLoc?.location_code ?? null   // chụp ô NGUỒN trước khi snapLoc bị gán sang ô mới
    if (newLoc) { snapLoc = newLoc; snapLocId = new_location_id ?? snapLocId }
    await supabase.from('StocktakeLog').insert({
      id: randomUUID(),
      entry_id: id,
      pallet_code: existing.pallet_code,
      location_id: snapLocId,
      location_code: snapLoc?.location_code ?? null,
      warehouse_id: snapLoc?.warehouse_id ?? null,
      categories: snapLoc?.categories ?? null,
      material_id: existing.material_id,
      material_code: mat?.material_code ?? null,
      short_name: mat?.short_name ?? null,
      base_unit: mat?.base_unit ?? null,
      entry_unit: mat?.entry_unit ?? null,
      units_per_carton: mat?.units_per_carton ?? null,
      app_qty: appCount,
      physical_qty: phys,
      diff: phys !== null ? phys - appCount : null,
      is_flagged: patch.stocktake_flagged === true,
      note: (patch.stocktake_flag_note as string | null) ?? null,
      location_changed_to: (new_location_id && new_location_id !== existing.location_id) ? new_location_id : null,
      // Snapshot ô NGUỒN (20/08) — tab Lịch sử chuyển vị trí cần "từ ô nào → đến ô nào"
      location_from_id:   existing.location_id ?? null,
      location_from_code: fromLocCode,
      counted_by: (patch.stocktake_by as string | undefined) ?? null,
      counted_by_name: req.user?.name ?? null,
      counted_at: now,
      created_at: now,
      updated_at: now,
    })
  } catch (e) {
    console.error('StocktakeLog insert failed:', (e as Error).message)
  }
  return ok(res, { ok: true })
}

export async function stocktakeEntries(req: Request, res: Response) {
  const { warehouse_id, category, location_id, location_ids, requires_only, view = 'problem', date_from, date_to, page, page_size } = req.query as Record<string, string>
  // view: 'all' | 'flagged' | 'unchecked' | 'checked' | 'problem' (flagged + unchecked)
  // requires_only='1': lọc "chỉ vị trí cần check" bằng CỜ — BE tự resolve vị trí từ kho. FE KHÔNG
  // được nhồi hàng nghìn id vào query string (kho 1.517 vị trí = URL 55KB → Vercel 414 trước khi
  // request tới được BE; đo 27/07 ngưỡng ~800 id / 32KB).
  const reqOnly = String(requires_only ?? '') === '1'

  const scopeWhIds = req.user?.warehouse_scope !== 'NATIONAL'
    ? (req.user?.warehouse_ids ?? [])
    : []

  // Resolve location IDs to query against. Ưu tiên danh sách vị trí chọn (CSV); fallback location_id đơn.
  const locIdsParam = parseListParam(location_ids) ?? []
  const explicitIds = locIdsParam.length ? locIdsParam : (location_id ? [location_id] : [])
  const stCats = scopeCategoriesOf(req)
  let resolvedLocationIds: string[]
  if (explicitIds.length) {
    // KHÔNG tin location_ids từ client — chỉ giữ vị trí thuộc kho + loại trong phạm vi user.
    // Chunk 300: user chọn cả trăm/nghìn vị trí thì `.in()` 1 phát là vỡ URL (trần ~300 id).
    const validIds: string[] = []
    for (const c of chunkArray(explicitIds, IN_CHUNK)) {
      let vQ = supabase.from('Location').select('id').in('id', c)
      if (scopeWhIds.length > 0) vQ = scopeWhIds.length === 1 ? vQ.eq('warehouse_id', scopeWhIds[0]) : vQ.in('warehouse_id', scopeWhIds)
      if (stCats) vQ = vQ.or(categoriesOrScopeFilter('categories', stCats))
      const { data: valid, error: vErr } = await vQ
      if (vErr) return fail(res, 500, 'DB_ERROR', vErr.message)
      validIds.push(...((valid ?? []) as { id: string }[]).map(l => l.id))
    }
    resolvedLocationIds = validIds
    if (!resolvedLocationIds.length) return ok(res, { stats: { total: 0, checked: 0, unchecked: 0, flagged: 0 }, entries: [] })
  } else {
    if (scopeWhIds.length > 0 && warehouse_id && !scopeWhIds.includes(warehouse_id))
      return ok(res, { stats: { total: 0, checked: 0, unchecked: 0, flagged: 0 }, entries: [] })
    // Phân trang đủ (kho lớn >1000 vị trí)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let locs: any[]
    try {
      locs = await fetchAllRowsParallel(() => {
        let locQuery = supabase.from('Location').select('id').eq('is_active', true).order('id')
        if (reqOnly) locQuery = locQuery.eq('requires_stocktake', true)

        if (scopeWhIds.length > 0) {
          const effective = warehouse_id
            ? scopeWhIds.filter(id => id === warehouse_id)
            : scopeWhIds
          effective.length === 1
            ? (locQuery = locQuery.eq('warehouse_id', effective[0]))
            : (locQuery = locQuery.in('warehouse_id', effective))
        } else {
          if (warehouse_id) locQuery = locQuery.eq('warehouse_id', warehouse_id)
        }

        if (category)     locQuery = locQuery.or(`categories.cs.{"${safeFilterValue(category)}"},categories.is.null`)
        if (stCats)       locQuery = locQuery.or(categoriesOrScopeFilter('categories', stCats))
        return locQuery
      })
    } catch (e) {
      return fail(res, 500, 'DB_ERROR', (e as Error).message)
    }
    if (!locs.length) return ok(res, { stats: { total: 0, checked: 0, unchecked: 0, flagged: 0 }, entries: [] })
    resolvedLocationIds = (locs as { id: string }[]).map(l => l.id)
  }

  const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  // KHOẢNG NGÀY KIỂM (đợt kiểm) — mặc định hôm nay. "Đã kiểm" = CÓ stocktake_at TRONG khoảng.
  // BỎ luật cũ "nhập hôm nay = đã kiểm": hàng mới nhập KHÔNG phải kết quả đếm thật, tính vào sẽ thổi
  // phồng số đã-kiểm. Trang này là BÁO CÁO KẾT QUẢ KIỂM nên chỉ đếm pallet thực sự được kiểm trong đợt.
  const dfrom  = /^\d{4}-\d{2}-\d{2}$/.test(String(date_from ?? '')) ? String(date_from) : todayVN
  const dtoRaw = /^\d{4}-\d{2}-\d{2}$/.test(String(date_to   ?? '')) ? String(date_to)   : dfrom
  const dto    = dtoRaw < dfrom ? dfrom : dtoRaw
  const rangeStart = new Date(`${dfrom}T00:00:00.000+07:00`).toISOString()
  const rangeEnd   = new Date(`${dto}T23:59:59.999+07:00`).toISOString()

  // LỌC + SẮP + ĐẾM + CẮT TRANG đều nằm trong RPC `stocktake_entries_page` (migration
  // 20260728_stocktake_paged_rpc.sql). Đường cũ chặn cứng 2000 dòng: kho 8.074 pallet chỉ xem
  // được 25% và không có cách nào tới phần còn lại. Danh sách vị trí đi qua THAM SỐ MẢNG của
  // RPC (POST body) nên không dính trần ~300 id trên URL ⇒ bỏ luôn vòng chunk 300 × 4 câu đếm.
  const pageNum  = Math.max(1, parseInt(String(page ?? '1'), 10) || 1)
  const pageSize = Math.min(1000, Math.max(1, parseInt(String(page_size ?? '200'), 10) || 200))

  const { data: pageData, error: pageErr } = await supabase.rpc('stocktake_entries_page', {
    p_loc_ids: resolvedLocationIds,
    p_from:    rangeStart,
    p_to:      rangeEnd,
    p_view:    view,
    p_offset:  (pageNum - 1) * pageSize,
    p_limit:   pageSize,
  })
  if (pageErr) return fail(res, 500, 'DB_ERROR', pageErr.message)
  const pd = (pageData ?? {}) as { ids?: string[]; total?: number; st_total?: number; checked?: number; flagged?: number }
  const pageIds = pd.ids ?? []
  const total   = pd.st_total ?? 0
  const checked = pd.checked ?? 0
  const flagged = pd.flagged ?? 0
  const unchecked = total - checked
  const matched   = Math.max(0, checked - flagged)   // đã kiểm KHỚP = đã kiểm − chênh lệch

  // Nạp dòng đầy đủ của ĐÚNG trang này rồi xếp lại theo thứ tự RPC đã quyết (join làm ở PostgREST
  // cho gọn — 1 trang ≤1000 id nên chunk 300 là đủ, không cần đưa join vào SQL).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let entries: any[] = []
  if (pageIds.length) {
    try {
      const rows = await fetchAllByIdChunks(pageIds, chunk => supabase.from('InventoryEntry')
        .select(`
          id, pallet_code, cartons_remaining, import_date,
          stocktake_flagged, stocktake_flag_note, stocktake_at,
          location:Location(id, location_code),
          material:Material(material_code, short_name, base_unit, entry_unit, units_per_carton),
          stocktake_by_emp:Employee!stocktake_by(id, name)
        `)
        .in('id', chunk))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byId = new Map((rows as any[]).map(r => [r.id as string, r]))
      entries = pageIds.map(id => byId.get(id)).filter(Boolean)
    } catch (e) {
      return fail(res, 500, 'DB_ERROR', (e as Error).message)
    }
  }

  return ok(res, {
    stats: { total, checked, unchecked, flagged, matched },
    entries,
    total_filtered: pd.total ?? 0,
    page: pageNum, page_size: pageSize,
    date_from: dfrom, date_to: dto,
  })
}

// Lịch sử kiểm kê: đọc từ StocktakeLog (append-only) — xem lại kết quả kiểm mọi ngày/đợt,
// kể cả pallet đã xuất / đã kiểm lại. Scope kho + loại (null-inclusive) như báo cáo tổng hợp.
export async function stocktakeLog(req: Request, res: Response) {
  const { warehouse_id, category, location_ids, requires_only, date_from, date_to, search, page, page_size } = req.query as Record<string, string>
  const reqOnly = String(requires_only ?? '') === '1'   // cờ thay cho danh sách id (xem stocktakeEntries)
  const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const dfrom  = /^\d{4}-\d{2}-\d{2}$/.test(String(date_from ?? '')) ? String(date_from) : todayVN
  const dtoRaw = /^\d{4}-\d{2}-\d{2}$/.test(String(date_to   ?? '')) ? String(date_to)   : dfrom
  const dto    = dtoRaw < dfrom ? dfrom : dtoRaw
  const rangeStart = new Date(`${dfrom}T00:00:00.000+07:00`).toISOString()
  const rangeEnd   = new Date(`${dto}T23:59:59.999+07:00`).toISOString()

  const scope = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : null
  let whFilter: string[] | null = null
  if (scope !== null) {
    if (warehouse_id && !scope.includes(warehouse_id)) return ok(res, { rows: [], total: 0 })
    whFilter = warehouse_id ? [warehouse_id] : scope
    if (!whFilter.length) return ok(res, { rows: [], total: 0 })
  } else if (warehouse_id) {
    whFilter = [warehouse_id]
  }
  const stCats = scopeCategoriesOf(req)

  let locIdList = parseListParam(location_ids) ?? []
  // Cờ "chỉ vị trí cần check": BE tự resolve id (phân trang) → client không phải gửi nghìn id
  if (reqOnly && !locIdList.length) {
    try {
      const impLocs = await fetchAllRowsParallel(() => {
        let lq = supabase.from('Location').select('id').eq('is_active', true).eq('requires_stocktake', true).order('id')
        if (whFilter) lq = whFilter.length === 1 ? lq.eq('warehouse_id', whFilter[0]) : lq.in('warehouse_id', whFilter)
        if (category) lq = lq.or(`categories.cs.{"${safeFilterValue(category)}"},categories.is.null`)
        if (stCats)   lq = lq.or(categoriesOrScopeFilter('categories', stCats))
        return lq
      })
      locIdList = (impLocs as { id: string }[]).map(l => l.id)
      if (!locIdList.length) return ok(res, { rows: [], total: 0, date_from: dfrom, date_to: dto })
    } catch (e) {
      return fail(res, 500, 'DB_ERROR', (e as Error).message)
    }
  }
  // Lọc + sắp + đếm + cắt trang trong RPC `stocktake_log_page`. Đường cũ cắt cứng 2000 dòng và
  // chunk vị trí 300/lô rồi gộp ở Node — vừa không tới được phần sau, vừa lệch thứ tự giữa các lô.
  // 1 lần quét kiểm = 1 dòng ⇒ bảng này phình nhanh nhất module (kho 12k pallet ≈ 150k dòng/năm).
  const pageNum  = Math.max(1, parseInt(String(page ?? '1'), 10) || 1)
  const pageSize = Math.min(1000, Math.max(1, parseInt(String(page_size ?? '200'), 10) || 200))

  const { data: pageData, error: rpcErr } = await supabase.rpc('stocktake_log_page', {
    p_wh_ids:     whFilter,
    p_loc_ids:    locIdList.length ? locIdList : null,
    p_category:   category || null,
    p_scope_cats: stCats,
    p_search:     search ? safeFilterValue(String(search)) : null,
    p_from:       rangeStart,
    p_to:         rangeEnd,
    p_offset:     (pageNum - 1) * pageSize,
    p_limit:      pageSize,
  })
  if (rpcErr) return fail(res, 500, 'DB_ERROR', rpcErr.message)
  const pd = (pageData ?? {}) as { ids?: string[]; total?: number; counted?: number; flagged?: number }
  const pageIds = pd.ids ?? []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[] = []
  if (pageIds.length) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = await fetchAllByIdChunks(pageIds, chunk => supabase.from('StocktakeLog').select('*').in('id', chunk)) as any[]
      const byId = new Map(raw.map(r => [r.id as string, r]))
      rows = pageIds.map(id => byId.get(id)).filter(Boolean)
    } catch (e) {
      return fail(res, 500, 'DB_ERROR', (e as Error).message)
    }
  }
  return ok(res, {
    rows,
    total: pd.total ?? 0,
    counted: pd.counted ?? 0,     // 2 ô SummaryBand tính trên TOÀN BỘ bộ lọc, không phải trang
    flagged: pd.flagged ?? 0,
    page: pageNum, page_size: pageSize,
    date_from: dfrom, date_to: dto,
  })
}

// Lịch sử CHUYỂN VỊ TRÍ (tab Lịch sử màn Chuyển vị trí, 20/08): các dòng StocktakeLog có
// location_changed_to — gồm cả lượt "kiểm kê đổi vị trí" bên trang Kiểm kê (cùng bản chất).
// Volume nhỏ hơn kiểm kê nhiều lần ⇒ query thẳng + range-pagination (partial index
// idx_stocktakelog_moves), không cần RPC như stocktake_log_page. Scope kho + loại như stocktakeLog.
export async function moveLog(req: Request, res: Response) {
  const { warehouse_id, category, date_from, date_to, search, page, page_size } = req.query as Record<string, string>
  const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const dfrom  = /^\d{4}-\d{2}-\d{2}$/.test(String(date_from ?? '')) ? String(date_from) : todayVN
  const dtoRaw = /^\d{4}-\d{2}-\d{2}$/.test(String(date_to   ?? '')) ? String(date_to)   : dfrom
  const dto    = dtoRaw < dfrom ? dfrom : dtoRaw
  const rangeStart = new Date(`${dfrom}T00:00:00.000+07:00`).toISOString()
  const rangeEnd   = new Date(`${dto}T23:59:59.999+07:00`).toISOString()

  const scope = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : null
  let whFilter: string[] | null = null
  if (scope !== null) {
    if (warehouse_id && !scope.includes(warehouse_id)) return ok(res, { rows: [], total: 0, date_from: dfrom, date_to: dto })
    whFilter = warehouse_id ? [warehouse_id] : scope
    if (!whFilter.length) return ok(res, { rows: [], total: 0, date_from: dfrom, date_to: dto })
  } else if (warehouse_id) {
    whFilter = [warehouse_id]
  }
  const stCats = scopeCategoriesOf(req)

  const pageNum  = Math.max(1, parseInt(String(page ?? '1'), 10) || 1)
  const pageSize = Math.min(500, Math.max(1, parseInt(String(page_size ?? '100'), 10) || 100))

  let q = supabase.from('StocktakeLog')
    .select('*', { count: 'exact' })
    .not('location_changed_to', 'is', null)
    .gte('counted_at', rangeStart).lte('counted_at', rangeEnd)
  // whFilter = warehouse_ids của user (nhỏ) — slice 300 chỉ là trần an toàn URL (id-list-url-limits)
  if (whFilter) q = whFilter.length === 1 ? q.eq('warehouse_id', whFilter[0]) : q.in('warehouse_id', whFilter.slice(0, 300))
  if (category) q = q.or(`categories.cs.{"${safeFilterValue(category)}"},categories.is.null`)
  if (stCats)   q = q.or(categoriesOrScopeFilter('categories', stCats))
  if (search) {
    if (searchLooksLikeInjection(String(search))) return fail(res, 400, 'INVALID_INPUT', SEARCH_INVALID_MSG)
    const s = safeSearch(String(search))
    q = q.or(`pallet_code.ilike.%${s}%,material_code.ilike.%${s}%,short_name.ilike.%${s}%,location_code.ilike.%${s}%,location_from_code.ilike.%${s}%`)
  }
  const { data, error, count } = await q.order('counted_at', { ascending: false })
    .range((pageNum - 1) * pageSize, pageNum * pageSize - 1)
  if (error) {
    if (isRangeNotSatisfiable(error)) return ok(res, { rows: [], total: count ?? 0, page: pageNum, page_size: pageSize, date_from: dfrom, date_to: dto })
    return fail(res, 500, 'DB_ERROR', error.message)
  }
  return ok(res, { rows: data ?? [], total: count ?? 0, page: pageNum, page_size: pageSize, date_from: dfrom, date_to: dto })
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

  const upErr = await updateEntriesByIds(ids, patch)   // chunk 300 — bulk vài nghìn pallet không vỡ URL
  if (upErr) return fail(res, 500, 'DB_ERROR', upErr)
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
  if (!(await guardEntryRead(req, res, id))) return   // chống IDOR: chỉ đọc pallet trong phạm vi kho+loại
  return ok(res, data)
}

// ─── Upload Excel: TỒN KHO ĐẦU KỲ (all-or-nothing) ──────────────────────────
// Mirror scripts/import_inventory.js: kiểm TOÀN BỘ file trước — có BẤT KỲ lỗi nào thì KHÔNG nhập gì
// (trả về danh sách lỗi để sửa & up lại). File sạch 100% → nhập theo lô. status=IN_STOCK, origin=IMPORT.
// NMSX = đoạn 6 mã pallet (QR), thiếu → nmsx_code của kho. Trùng pallet (trong file / đã có) = lỗi.
// BASE UNIT (đợt 2): cột 'boxes_base' (Hộp — đơn vị gốc, mã có entry). File cũ không có cột này thì bỏ trống.
// Map theo TÊN CỘT (đồng bộ VL06O/KHVC) — chịu ĐẢO cột + đổi tên nhãn; alias = {key + nhãn VN}.
const INV_FIELDS: FieldDef[] = [
  { key: 'pallet_code',     label: 'Mã pallet',   aliases: ['ma pallet'], required: true },
  { key: 'material_code',   label: 'Mã hàng',     aliases: ['ma hang'], required: true },
  { key: 'warehouse',       label: 'Kho (mã)',    aliases: ['kho ma', 'kho'], required: true },
  { key: 'location_code',   label: 'Mã vị trí',   aliases: ['ma vi tri', 'vi tri'], required: true },
  { key: 'cartons',         label: 'Số thùng',    aliases: ['so thung', 'so thung so nguyen'], required: true },
  { key: 'production_date', label: 'Ngày SX',     aliases: ['ngay sx', 'ngay san xuat', 'ngay sx yyyy mm dd'], required: true },
  { key: 'ncc',             label: 'NCC',         aliases: ['ncc ma ten tuy'] },
  { key: 'qa_status',       label: 'QA',          aliases: ['qa', 'qa mac dinh ok'] },
  { key: 'shelf_life_days', label: 'HSD (ngày)',  aliases: ['hsd', 'hsd ngay', 'hsd ngay tuy'] },
  { key: 'boxes_base',      label: 'Hộp (lẻ)',    aliases: ['hop', 'hop phan le', 'hop phan le tuy'] },
  // 2 cột TÙY CHỌN (29/07) — bê tồn kho cũ vào thì phải khai được NGÀY VÀO KHO THẬT + AI nhận,
  // không thì mọi số "nhập trong ngày" (Giám sát vận hành/Dashboard) tính cả tồn upload thành hàng mới nhận.
  { key: 'import_date',     label: 'Ngày nhập',   aliases: ['ngay nhap', 'ngay nhap kho', 'ngay nhap tuy', 'ngay nhap trong hom nay'] },
  { key: 'created_by',      label: 'Người nhập',  aliases: ['nguoi nhap', 'nguoi nhan', 'nguoi nhap tuy'] },
]

const invNum = (v: unknown): number | null => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isNaN(n) ? null : n }
const invInt = (v: unknown): number | null => { const n = parseInt(String(v ?? '').trim(), 10); return Number.isNaN(n) ? null : n }
const invStr = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null }

const HASH8 = /^[0-9a-f]{8}$/i
// Ánh xạ mã nhà máy CŨ → MỚI lấy từ cấu hình đơn vị (org_profile.nmsx_alias, mặc định { A: 'O' } =
// đúng giá trị LOF đang chạy). Truyền vào thay vì đọc hằng số toàn cục: alias là dữ liệu của ĐƠN VỊ.
function nmsxFromPallet(code: string, fallback: string | null, alias: Record<string, string>): string | null {
  const parts = String(code || '').split('_')
  const raw = (parts.length >= 6 && parts[5] && !HASH8.test(parts[5])) ? parts[5] : fallback
  return raw ? (alias[raw] ?? raw) : raw
}
// Ngày phải TỒN TẠI trên lịch: regex chỉ soi hình dạng nên "32/13/2026" hay "31/02/2026" vẫn khớp
// → ghép thành '2026-02-31' rồi Postgres nổ "date out of range" LÚC GHI (vỡ cam kết "lỗi hiện ở bước
// kiểm trước"). Round-trip qua Date để loại ngày không có thật.
function isRealISODate(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
// Ngày SX / Ngày nhập → yyyy-mm-dd. Chịu: yyyy-mm-dd / dd-mm-yyyy (- hoặc /), số serial Excel.
function invToISODate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  const ok = (iso: string) => (isRealISODate(iso) ? iso : null)
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s)
  if (m) return ok(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`)
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s)
  if (m) return ok(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400000))
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  return null
}
// Phân giải theo MÃ (ưu tiên) → TÊN (fallback); tên trùng → buộc dùng mã.
function makeNccResolver(items: { id: string; code?: string | null; name?: string | null; alias_codes?: string[] | null }[]) {
  const byCode = new Map<string, string>(), byName = new Map<string, string>(), nameCount = new Map<string, number>()
  for (const it of items) {
    const c = String(it.code ?? '').trim().toLowerCase()
    const n = String(it.name ?? '').trim().toLowerCase()
    if (c) byCode.set(c, it.id)
    for (const a of (it.alias_codes ?? [])) { const ac = String(a ?? '').trim().toLowerCase(); if (ac) byCode.set(ac, it.id) }
    if (n) { byName.set(n, it.id); nameCount.set(n, (nameCount.get(n) ?? 0) + 1) }
  }
  return (input: string): { id: string | null; error: string | null } => {
    const k = String(input ?? '').trim().toLowerCase()
    if (!k) return { id: null, error: null }
    if (byCode.has(k)) return { id: byCode.get(k)!, error: null }
    if ((nameCount.get(k) ?? 0) > 1) return { id: null, error: 'trùng tên, hãy dùng MÃ' }
    if (byName.has(k)) return { id: byName.get(k)!, error: null }
    return { id: null, error: 'không khớp (mã hoặc tên)' }
  }
}

export async function uploadExcel(req: Request, res: Response) {
  try {
    if (!req.file) return fail(res, 'Không có file upload', 400)
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const { rows, missingRequired } = parseSheetByHeader(ws, INV_FIELDS)   // map theo TÊN cột (chịu đảo cột)
    if (missingRequired.length) return fail(res, `File thiếu cột bắt buộc: ${missingRequired.join(', ')} — kiểm tra đúng mẫu Tồn kho`, 400)
    if (!rows.length) return fail(res, 'Không có dòng dữ liệu nào', 400)

    const [mats, whs, locs, cos, qas] = await Promise.all([
      fetchAllRowsParallel(() => supabase.from('Material').select('id, material_code, category, base_unit, entry_unit, units_per_carton')),
      fetchAllRowsParallel(() => supabase.from('Warehouse').select('id, code, name, nmsx_code')),
      fetchAllRowsParallel(() => supabase.from('Location').select('id, location_code, warehouse_id')),
      fetchAllRowsParallel(() => supabase.from('TransportCompany').select('id, code, name, type, alias_codes')),
      fetchAllRowsParallel(() => supabase.from('QAStatus').select('id, name')),
    ]) as [
      ({ id: string; material_code: string; category: string | null } & MatUnits)[],
      { id: string; code: string; name: string; nmsx_code: string | null }[],
      { id: string; location_code: string; warehouse_id: string | null }[],
      { id: string; code: string | null; name: string | null; type: string; alias_codes: string[] | null }[],
      { id: string; name: string }[],
    ]

    const matMap = new Map(mats.map(m => [String(m.material_code).trim().toLowerCase(), m.id]))
    const matCatMap = new Map(mats.map(m => [m.id, m.category ?? '']))
    const matUnitsById = new Map<string, MatUnits>(mats.map(m => [m.id, m]))
    const whTypeMeta = await getWhTypeMetaMap()   // cờ requires_ncc per Loại kho (kiểm dòng thiếu NCC)
    // Cờ này khai RIÊNG được theo kho (21/08). File có thể trải nhiều kho ⇒ nạp MỘT lượt các dòng
    // khai riêng (bảng tối đa số_kho × số_loại, hôm nay 765 dòng) thay vì tra theo từng dòng Excel.
    const { data: nccOvr } = await supabase.from('warehouse_type_configs')
      .select('warehouse_id, type_code, requires_ncc').not('requires_ncc', 'is', null).limit(5000)
    const nccOvrMap = new Map((nccOvr ?? []).map(r => {
      const row = r as { warehouse_id: string; type_code: string; requires_ncc: boolean | null }
      return [`${row.warehouse_id}|${row.type_code}`, row.requires_ncc === true]
    }))
    const requiresNccAt = (whId: string, cat: string) =>
      nccOvrMap.get(`${whId}|${cat}`) ?? (whTypeMeta.get(cat)?.requires_ncc === true)
    const nmsxAlias = (await getOrgProfile()).nmsx_alias   // gộp mã nhà máy cũ→mới theo cấu hình đơn vị
    const whByCode = new Map(whs.map(w => [String(w.code).trim().toLowerCase(), w]))
    const whByName = new Map(whs.map(w => [String(w.name).trim().toLowerCase(), w]))
    const locMap = new Map(locs.map(l => [String(l.location_code).trim().toLowerCase(), l.id]))
    // Vị trí thuộc kho nào — kiểm chéo với cột "Kho" của dòng: mã vị trí trùng nhau giữa các kho là
    // chuyện thường, thiếu kiểm này thì pallet khai kho A nhưng nằm ở vị trí kho B (list/summary/export
    // cắt scope theo Location.warehouse_id → pallet BIẾN khỏi kho A, hiện ở kho B; verify 26/07 ghi được 1 entry lệch).
    const locWhMap = new Map(locs.map(l => [l.id, l.warehouse_id]))
    const resolveNcc = makeNccResolver(cos.filter(c => c.type === 'NCC'))
    const qaMap = new Map(qas.map(q => [String(q.name).trim().toLowerCase(), q.id]))
    const qaNames = qas.map(q => q.name).join(' / ')

    // NGƯỜI NHẬP (cột tùy chọn): `created_by` là FK → Employee.id, KHÔNG phải tên. File khai
    // mã nhân viên hoặc tên → resolve sang id; sai/trùng tên thì báo lỗi dòng (đừng ghi bừa → 23503).
    // Chỉ nạp danh sách nhân sự KHI file thật sự có khai (đỡ 1 query cho phần lớn file).
    const hasImporterCol = rows.some(r => invStr(r.created_by))
    const empByCode = new Map<string, string>()
    const empByName = new Map<string, string[]>()
    if (hasImporterCol) {
      const emps = await fetchAllRowsParallel(() => supabase.from('Employee')
        .select('id, employee_code, name').order('id')) as { id: string; employee_code: string | null; name: string | null }[]
      for (const e of emps) {
        const code = String(e.employee_code ?? '').trim().toLowerCase()
        const name = String(e.name ?? '').trim().toLowerCase()
        if (code) empByCode.set(code, e.id)
        if (name) empByName.set(name, [...(empByName.get(name) ?? []), e.id])
      }
    }

    // Pallet ĐÃ CÓ (active) khớp mã trong file → CẬP NHẬT thay vì báo lỗi (user chốt 05/07).
    // Khóa khớp = (kho, mã pallet) — 1 mã pallet tồn tại hợp lệ ở NHIỀU kho (no-QR pallet_code=mã hàng),
    // khớp unique index uq_inventory_active_wh_pallet. Chỉ fetch entry theo mã trong file (không kéo cả bảng).
    // Pallet CÒN SỐNG (đang chiếm chỗ trong kho) — KHÔNG gồm EXPORTED. Tên riêng để không lẫn với
    // `STATUS_RECALC_ON_ADJUST` ở đầu file (tập khác nghĩa, khác phần tử).
    const ACTIVE_PALLET_STATUSES = ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING']
    const filePallets = [...new Set(rows
      .flatMap(r => { const p = invStr(r.pallet_code); return p ? [p, p.toUpperCase()] : [] }))]
    const exRows: Record<string, unknown>[] = []
    for (let i = 0; i < filePallets.length; i += 400) {
      const chunk = filePallets.slice(i, i + 400)
      exRows.push(...await fetchAllRowsParallel(() =>
        supabase.from('InventoryEntry').select('*').in('pallet_code', chunk).in('status', ACTIVE_PALLET_STATUSES).order('id')))
    }
    const exMap = new Map(exRows.map(e =>
      [`${e.warehouse_id}|${String(e.pallet_code ?? '').trim().toLowerCase()}`, e]))

    const now = new Date().toISOString()
    // import_date là timestamp KHÔNG timezone, luồng quét nhập ghi ngày VN thuần (vnDate) —
    // upload phải cùng convention, ghi ISO UTC sẽ rớt filter biên "đến ngày" + lệch ngày lúc 0h-7h VN.
    const importDateVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

    // ── PHA 1: kiểm TOÀN BỘ. Có lỗi → KHÔNG nhập/cập nhật gì. ──
    const errors: string[] = []
    const records: Record<string, unknown>[] = []
    const updates: Record<string, unknown>[] = []
    const adjustLogs: Record<string, unknown>[] = []
    const actorName = req.user?.name ?? null
    const actorId = req.user?.sub ?? null
    const uploadScope = scopeWhIds(req)   // null = NATIONAL (toàn quyền); mảng = chỉ kho được gán
    const seenInFile = new Set<string>()
    let lineNo = 0
    for (const r of rows) {
      lineNo++
      const pallet = invStr(r.pallet_code), mcode = invStr(r.material_code), whRaw = invStr(r.warehouse)
      const cartons = invNum(r.cartons)
      const locRaw = invStr(r.location_code)
      const prodRaw = invStr(r.production_date)
      const prodIso = invToISODate(r.production_date)
      const at = pallet || `(dòng #${lineNo})`

      const missing: string[] = []
      if (!pallet)         missing.push('mã pallet')
      if (!mcode)          missing.push('mã hàng')
      if (!whRaw)          missing.push('kho')
      if (cartons == null)      missing.push('số thùng')
      else if (cartons < 0)     missing.push(`số thùng không được âm (nhận ${cartons})`)   // tồn = 0 HỢP LỆ (user chốt 05/07: chốt pallet hết hàng / đăng ký chỗ)
      if (!locRaw)         missing.push('vị trí')
      if (!prodIso)        missing.push(prodRaw ? `ngày SX sai định dạng "${prodRaw}"` : 'ngày SX')
      if (missing.length) { errors.push(`${at} — thiếu/sai: ${missing.join(', ')}`); continue }

      // NGÀY NHẬP (tùy): khai thì dùng ngày trong file, trống thì = hôm nay. Ngày ở TƯƠNG LAI là
      // gõ sai (hàng chưa vào kho) → chặn, không thì mọi báo cáo "nhập trong ngày" lệch âm thầm.
      const impRaw = invStr(r.import_date)
      const impIso = invToISODate(r.import_date)
      if (impRaw && !impIso) { errors.push(`${at} — Ngày nhập sai định dạng "${impRaw}" (dùng dd/mm/yyyy hoặc yyyy-mm-dd)`); continue }
      if (impIso && impIso > importDateVN) { errors.push(`${at} — Ngày nhập ${impIso} ở TƯƠNG LAI (hôm nay ${importDateVN})`); continue }

      // NGƯỜI NHẬP: trống = người bấm upload. Khai thì phải khớp nhân sự (mã ưu tiên, rồi tên).
      const impByRaw = invStr(r.created_by)
      let importerId: string | null = null
      if (impByRaw) {
        const k = impByRaw.toLowerCase()
        importerId = empByCode.get(k) ?? null
        if (!importerId) {
          const hits = empByName.get(k) ?? []
          if (hits.length === 1) importerId = hits[0]
          else if (hits.length > 1) { errors.push(`${at} — "Người nhập" trùng ${hits.length} nhân sự cùng tên "${impByRaw}" — điền MÃ nhân viên`); continue }
          else { errors.push(`${at} — "Người nhập" không khớp nhân sự: "${impByRaw}" (điền mã nhân viên hoặc tên đúng)`); continue }
        }
      }

      const palletLc = pallet!.toLowerCase()
      const matId = matMap.get(mcode!.toLowerCase())
      if (!matId) { errors.push(`${at} — mã hàng không khớp: ${mcode}`); continue }
      // BASE UNIT: mã có entry → "Số thùng" NGUYÊN + cột Hộp NGUYÊN; lượng lưu = base
      const mu = matUnitsById.get(matId) ?? null
      const boxesBase = invNum(r.boxes_base) ?? 0
      let qtyBase = cartons!
      if (hasEntry(mu)) {
        const f = Number(mu!.units_per_carton)
        if (!Number.isInteger(cartons!)) {
          const goiY = Math.round((cartons! - Math.floor(cartons!)) * f)
          errors.push(`${at} — "Số thùng" phải là SỐ NGUYÊN (mã ${f}/thùng — ${cartons} thùng ≈ ${Math.floor(cartons!)} thùng + ${goiY}: ghi ${goiY} vào cột Hộp)`); continue
        }
        if (!Number.isInteger(boxesBase) || boxesBase < 0) { errors.push(`${at} — cột "Hộp" phải là SỐ NGUYÊN ≥ 0`); continue }
        qtyBase = cartons! * f + boxesBase
      }
      const wh = whByCode.get(whRaw!.toLowerCase()) || whByName.get(whRaw!.toLowerCase())
      if (!wh) { errors.push(`${at} — kho không khớp: ${whRaw}`); continue }
      // Scope: chặn upload ghi tồn sang kho ngoài phạm vi user (all-or-nothing như các lỗi khác)
      if (uploadScope !== null && !uploadScope.includes(wh.id)) { errors.push(`${at} — kho "${whRaw}" ngoài phạm vi của bạn`); continue }
      // Trùng trong file theo (kho, pallet) — cùng mã ở 2 kho khác nhau là hợp lệ
      const fileKey = `${wh.id}|${palletLc}`
      if (seenInFile.has(fileKey)) { errors.push(`${at} — trùng mã pallet trong file (cùng kho ${whRaw})`); continue }
      const locId = locMap.get(locRaw!.toLowerCase())
      if (!locId) { errors.push(`${at} — vị trí không khớp: ${locRaw}`); continue }
      // Vị trí phải THUỘC ĐÚNG kho của dòng — lệch thì pallet biến khỏi kho khai báo (list/export cắt
      // theo Location.warehouse_id) và vượt biên scope kho. Verify 26/07: từng ghi được, không báo lỗi.
      {
        const locWh = locWhMap.get(locId)
        if (locWh && locWh !== wh.id) {
          errors.push(`${at} — vị trí "${locRaw}" không thuộc kho "${whRaw}" (vị trí này thuộc kho khác)`); continue
        }
      }
      const nccRaw = invStr(r.ncc)
      let nccId: string | null = null
      if (nccRaw) { const resu = resolveNcc(nccRaw); if (!resu.id) { errors.push(`${at} — NCC ${resu.error ?? 'không khớp'}: ${nccRaw}`); continue } nccId = resu.id }
      // Cờ requires_ncc của Loại kho (user chốt 10/07): dòng loại này thiếu NCC → lỗi (all-or-nothing như các lỗi khác)
      const rowCat = matCatMap.get(matId) ?? ''
      // Scope Loại hàng: chặn ghi mã thuộc loại ngoài phạm vi user (mã chưa gán loại vẫn cho)
      if (!categoryAllowed(req, rowCat)) { errors.push(`${at} — Loại hàng "${rowCat}" ngoài phạm vi của bạn`); continue }
      if (!nccId && requiresNccAt(wh.id, rowCat)) {
        errors.push(`${at} — Loại kho "${rowCat}" bắt buộc có NCC (cột NCC đang trống)`); continue
      }
      // QA: trống hoặc "OK" = pallet tốt → NULL. Chỉ gán khi là cờ GIỮ thật; giá trị lạ → lỗi.
      const qaRaw = invStr(r.qa_status)
      let qaId: string | null = null
      if (qaRaw && qaRaw.toLowerCase() !== 'ok') {
        qaId = qaMap.get(qaRaw.toLowerCase()) ?? null
        if (qaId == null) { errors.push(`${at} — QA không khớp: "${qaRaw}" (hợp lệ: ${qaNames})`); continue }
      }
      const nmsx = nmsxFromPallet(pallet!, (wh.nmsx_code && String(wh.nmsx_code).trim()) || null, nmsxAlias)

      seenInFile.add(fileKey)
      const ex = exMap.get(fileKey)
      if (ex) {
        // Pallet đã có (active) trong ĐÚNG kho này → CẬP NHẬT theo file (user chốt 05/07).
        // Giữ nguyên: id, pallet, kho, cartons_imported, import_date, created_at, origin, status, reserved.
        const reserved = Number(ex.cartons_reserved) || 0
        if (qtyBase < reserved) {
          errors.push(`${at} — số mới ${qtyLabel(qtyBase, mu)} < đang giữ chỗ ${qtyLabel(reserved, mu)} (kho ${whRaw}) — xử lý đơn xuất đang mở trước`)
          continue
        }
        const before = Number(ex.cartons_remaining) || 0
        updates.push({
          ...ex,
          material_id: matId, location_id: locId,
          cartons_remaining: qtyBase,
          production_date: `${prodIso}T00:00:00`,
          shelf_life_days: invInt(r.shelf_life_days), ncc_id: nccId, qa_status_id: qaId, nmsx,
          // Ngày nhập / Người nhập: CHỈ đè khi file có khai (ô trống giữ giá trị cũ — đúng luật merge,
          // không được lấy "hôm nay" đè lên ngày nhập thật của pallet đã có).
          ...(impIso ? { import_date: impIso } : {}),
          ...(importerId ? { created_by: importerId } : {}),
          updated_at: now, updated_by: actorId,   // FK → Employee.id (KHÔNG phải tên)
        })
        if (qtyBase !== before) {
          adjustLogs.push({
            id: randomUUID(), entry_id: ex.id, delta: qtyBase - before,
            cartons_before: before, cartons_after: qtyBase,
            note: 'Upload tồn kho (cập nhật theo file)', actor_name: actorName, actor_id: actorId,
            adjusted_at: now,
          })
        }
      } else {
        records.push({
          id: randomUUID(), pallet_code: pallet, material_id: matId, warehouse_id: wh.id, location_id: locId,
          cartons_imported: qtyBase, cartons_remaining: qtyBase, cartons_reserved: 0, adjustment_qty: 0,
          stack_layer: 1, status: 'IN_STOCK', origin: 'IMPORT',
          production_date: `${prodIso}T00:00:00`,
          shelf_life_days: invInt(r.shelf_life_days), ncc_id: nccId, qa_status_id: qaId, nmsx,
          // Ngày nhập từ file nếu có (bê tồn cũ giữ đúng ngày vào kho), trống = hôm nay.
          // created_by/updated_by là FK → Employee.id: trước 29/07 upload KHÔNG ghi gì nên mọi
          // pallet bê vào đều "không rõ ai nhập"; nay = nhân sự khai ở file, trống = người upload.
          import_date: impIso ?? importDateVN,
          created_by: importerId ?? actorId, updated_by: actorId,
          created_at: now, updated_at: now,
        })
      }
    }

    // KIỂM TRƯỚC (preflight): trả báo cáo từ CHÍNH kết quả PHA 1 — số trên dialog = số sẽ ghi thật.
    // Kèm số dòng ghi AdjustmentLog (pallet đã có bị đổi số lượng) để user thấy tác động lên tồn.
    if (isPreflight(req)) return ok(res, buildPreflight({
      unit: 'pallet', total: rows.length, errors,
      toInsert: records.length, toUpdate: updates.length,
      extra: adjustLogs.length ? [{ label: 'Pallet bị ĐỔI số lượng', value: adjustLogs.length, warn: true }] : [],
    }))

    if (errors.length) return ok(res, { inserted: 0, updated: 0, errors })
    if (!records.length && !updates.length) return ok(res, { inserted: 0, updated: 0, errors: [] })

    // ── PHA 2: file sạch → ghi theo lô 500 (validate đã chặn hết lỗi dữ liệu). ──
    for (let i = 0; i < records.length; i += 500) {
      const { error } = await supabase.from('InventoryEntry').insert(records.slice(i, i + 500))
      if (error) {
        // Thua đua: pallet vừa được người khác upload cùng lúc (unique pallet/kho) — upload lại là
        // idempotent (pallet đã tồn tại → đi nhánh cập nhật), không double.
        if (error.code === '23505')
          return fail(res, `Có người khác vừa upload trùng pallet đúng cùng lúc (đã nhập ${i} pallet trước đó) — bấm Upload lại file để cập nhật phần còn lại.`, 409)
        return fail(res, `Lỗi khi nhập (đã nhập ${i} pallet trước đó): ${error.message}`, 500)
      }
    }
    // Cập nhật pallet đã có: merge full record (đắp field file lên record cũ) → upsert theo id
    for (let i = 0; i < updates.length; i += 500) {
      const { error } = await supabase.from('InventoryEntry').upsert(updates.slice(i, i + 500), { onConflict: 'id' })
      if (error) return fail(res, `Lỗi khi cập nhật pallet (đã cập nhật ${i} trước đó): ${error.message}`, 500)
    }
    // Audit log điều chỉnh tồn cho pallet cập nhật có đổi số lượng
    for (let i = 0; i < adjustLogs.length; i += 500) {
      const { error } = await supabase.from('InventoryAdjustmentLog').insert(adjustLogs.slice(i, i + 500))
      if (error) console.error('[uploadExcel] Ghi InventoryAdjustmentLog thất bại:', error.message)
    }
    return ok(res, { inserted: records.length, updated: updates.length, errors: [] })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}
