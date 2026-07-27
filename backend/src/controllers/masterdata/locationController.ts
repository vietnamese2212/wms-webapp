import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { scopeCategoriesOf, categoriesAllAllowed, categoriesOrScopeFilter, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'
import { fetchAllRowsParallel } from '../../utils/pagination'
import { safeFilterValue, safeSearch, searchLooksLikeInjection, normalizeSearchTerm, SEARCH_INVALID_MSG } from '../../utils/search'
import { parseSheetByHeader, type FieldDef } from '../../utils/excelHeader'

// location_code = <tiền tố kho>_<khu>_<dãy>_<tầng>. Tiền tố = nmsx_code nếu có, không thì mã kho.
function buildLocationCode(prefix: string, subCode: string, row: string, shelf: string) {
  return [prefix, subCode, row, shelf].filter(Boolean).join('_')
}

// Warehouse-scope: NATIONAL = mọi kho (null), còn lại = danh sách kho được gán.
function scopeWhIds(req: Request): string[] | null {
  return req.user?.warehouse_scope === 'NATIONAL' ? null : (req.user?.warehouse_ids ?? [])
}
// Chặn 403 nếu vị trí (theo id) không thuộc kho trong phạm vi user. NATIONAL bỏ qua.
async function guardLocScope(req: Request, res: Response, locationId: string): Promise<boolean> {
  const scope = scopeWhIds(req)
  const cats = scopeCategoriesOf(req)
  if (scope === null && cats === null) return true
  const { data } = await supabase.from('Location').select('warehouse_id, categories').eq('id', locationId).maybeSingle()
  const row = data as { warehouse_id: string | null; categories: string[] | null } | null
  const wh = row?.warehouse_id ?? null
  if (scope !== null && (!wh || !scope.includes(wh))) { fail(res, 403, 'FORBIDDEN', 'Vị trí không thuộc kho trong phạm vi của bạn'); return false }
  // Scope Loại: MỌI loại của vị trí phải trong phạm vi (vị trí chưa gán loại → cho qua)
  if (!categoriesAllAllowed(req, row?.categories)) { fail(res, 403, 'FORBIDDEN', CATEGORY_FORBIDDEN_MSG); return false }
  return true
}

// Cột tối thiểu cho dropdown chọn vị trí (view=lite): bỏ audit + join Kho + đếm tồn tổng.
// Giữ max_pallets/categories/slot_no_* vì picker Nhập kho & Slotting đọc.
const LOCATION_LITE_COLS =
  'id, location_code, warehouse_id, sub_code, sub_name, categories, row, shelf,' +
  'max_pallets, is_active, requires_stocktake, slot_no_in, slot_no_out'

export async function listLocations(req: Request, res: Response) {
  try {
    const { warehouse_id, sub_code, active, category, material_id, view, search, limit } = req.query
    if (search && searchLooksLikeInjection(search)) return fail(res, 400, 'INVALID_SEARCH', SEARCH_INVALID_MSG)
    // limit=N (typeahead): chỉ N dòng đầu → không kéo cả nghìn vị trí về trình duyệt
    const cap = Math.min(Math.max(Number(limit) || 0, 0), 200)

    // Scope kho: ASSIGNED chỉ thấy vị trí kho được gán — kể cả khi KHÔNG truyền warehouse_id
    // (vd Check vị trí để "tất cả kho" trước đây lộ toàn bộ vị trí mọi kho)
    const scope = scopeWhIds(req)
    let effective: string[] | null = null
    if (scope !== null) {
      effective = warehouse_id ? scope.filter(id => id === String(warehouse_id)) : scope
      if (effective.length === 0) return ok(res, [])
    }
    const scopeCats = scopeCategoriesOf(req)

    // Phân trang né cap ~1000 (>1000 vị trí thì list/dropdown mất vị trí)
    const buildQ = () => {
      let query = supabase
        .from('Location')
        .select(view === 'lite' ? LOCATION_LITE_COLS : '*, warehouse:Warehouse(id, code, name), InventoryEntry(count)')
        .order('sub_code').order('row').order('shelf').order('id')
      if (effective) {
        query = effective.length === 1 ? query.eq('warehouse_id', effective[0]) : query.in('warehouse_id', effective)
      } else if (warehouse_id) {
        query = query.eq('warehouse_id', String(warehouse_id))
      }
      if (sub_code) query = query.eq('sub_code', String(sub_code))
      if (active === 'true') query = query.eq('is_active', true)
      // category filter: vị trí NHẬN loại này (mảng chứa) OR null (vị trí chưa gán loại = dùng chung)
      if (category) query = (query as any).or(`categories.cs.{"${safeFilterValue(category)}"},categories.is.null`)
      // Scope Loại hàng: không truyền category → vẫn cắt theo allowed_categories (giao ≥1 loại; null vẫn hiện)
      if (scopeCats) query = (query as any).or(categoriesOrScopeFilter('categories', scopeCats))
      // Tìm BỎ DẤU trên cột chuẩn-hoá (mã vị trí + mã khu + tên khu)
      if (search) query = query.ilike('search_norm', `%${safeSearch(normalizeSearchTerm(search))}%`)
      return query
    }
    let data: Record<string, unknown>[]
    if (cap > 0) {
      const { data: page, error } = await buildQ().limit(cap)
      if (error) throw error
      data = (page ?? []) as unknown as Record<string, unknown>[]
    } else {
      data = await fetchAllRowsParallel(buildQ) as unknown as Record<string, unknown>[]
    }

    // used_slots (layer 1 IN_STOCK/PARTIAL): 1 lượt quét gộp thay N+1 count query
    // (trước: mỗi vị trí 1 roundtrip — nghìn vị trí = nghìn query song song, cạn connection)
    const locIdsAll = (data ?? []).map((l: Record<string, unknown>) => l.id as string)
    const usedCount = new Map<string, number>()
    for (let i = 0; i < locIdsAll.length; i += 300) {
      const rows = await fetchAllRowsParallel(() => supabase.from('InventoryEntry')
        .select('location_id').in('location_id', locIdsAll.slice(i, i + 300))
        .eq('stack_layer', 1).in('status', ['IN_STOCK', 'PARTIAL']).gt('cartons_remaining', 0).order('id'))
      for (const r of rows as { location_id: string }[])
        usedCount.set(r.location_id, (usedCount.get(r.location_id) ?? 0) + 1)
    }
    const withUsage = (data ?? []).map((loc: Record<string, unknown>) => {
      const { InventoryEntry, ...rest } = loc
      return {
        ...rest,
        _count: { inventory_entries: Array.isArray(InventoryEntry) ? ((InventoryEntry[0] as { count: number })?.count ?? 0) : 0 },
        used_slots: usedCount.get(rest.id as string) ?? 0,
        has_same_material: false,
      } as Record<string, unknown>
    })

    // has_same_material: vị trí đang chứa (layer-1, IN_STOCK/PARTIAL) đúng material_id này
    // → để FE gợi ý "nơi loại hàng đó đang để dở". Chunk 300 + phân trang.
    if (material_id && withUsage.length > 0) {
      const locIds = withUsage.map(l => l.id as string)
      const sameSet = new Set<string>()
      for (let i = 0; i < locIds.length; i += 300) {
        const sameMat = await fetchAllRowsParallel(() => supabase
          .from('InventoryEntry')
          .select('location_id')
          .in('location_id', locIds.slice(i, i + 300))
          .eq('material_id', String(material_id))
          .eq('stack_layer', 1)
          .in('status', ['IN_STOCK', 'PARTIAL'])
          .gt('cartons_remaining', 0)
          .order('id'))
        for (const e of sameMat as { location_id: string }[]) sameSet.add(e.location_id)
      }
      for (const l of withUsage) l.has_same_material = sameSet.has(l.id as string)
    }

    ok(res, withUsage)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function listSubGroups(req: Request, res: Response) {
  try {
    const { warehouse_id } = req.query
    if (!warehouse_id) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu warehouse_id')
    const zoneScope = scopeWhIds(req)
    if (zoneScope !== null && !zoneScope.includes(String(warehouse_id))) return ok(res, [])

    // Phân trang (kho lớn >1000 vị trí → sót khu)
    const data = await fetchAllRowsParallel(() => supabase
      .from('Location')
      .select('sub_code, sub_name, sub_type')
      .eq('warehouse_id', String(warehouse_id))
      .eq('is_active', true)
      .order('sub_code').order('id'))

    const groupMap = new Map<string, { sub_code: string; sub_name: string | null; sub_type: string | null; location_count: number }>()
    for (const loc of data ?? []) {
      const key = loc.sub_code
      if (!groupMap.has(key)) groupMap.set(key, { sub_code: loc.sub_code, sub_name: loc.sub_name, sub_type: loc.sub_type, location_count: 0 })
      groupMap.get(key)!.location_count++
    }
    ok(res, Array.from(groupMap.values()))
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getLocation(req: Request, res: Response) {
  try {
    if (!(await guardLocScope(req, res, req.params.id))) return
    const { data: loc, error } = await supabase
      .from('Location').select('*, warehouse:Warehouse(id, code, name)').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!loc) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')

    const { data: entries, error: entErr } = await supabase
      .from('InventoryEntry')
      .select('*, material:Material(id, material_code, short_name)')
      .eq('location_id', req.params.id)
      .in('status', ['IN_STOCK', 'PARTIAL'])
      .gt('cartons_remaining', 0) // pallet tồn=0 không còn nằm ở vị trí
      .order('stack_layer')
    if (entErr) throw entErr

    ok(res, { ...loc, inventory_entries: entries ?? [] })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createLocation(req: Request, res: Response) {
  try {
    const { warehouse_id, sub_code, sub_name, sub_type, row, shelf, max_pallets } = req.body
    if (!warehouse_id || !sub_code || !row)
      return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu warehouse_id, sub_code hoặc row')
    const scope = scopeWhIds(req)
    if (scope !== null && !scope.includes(String(warehouse_id)))
      return fail(res, 403, 'FORBIDDEN', 'Không thể tạo vị trí ở kho ngoài phạm vi của bạn')

    const { data: wh, error: whErr } = await supabase
      .from('Warehouse').select('code, nmsx_code').eq('id', warehouse_id).maybeSingle()
    if (whErr) throw whErr
    if (!wh) return fail(res, 404, 'NOT_FOUND', 'Kho không tồn tại')

    const prefix = (wh.nmsx_code && String(wh.nmsx_code).trim()) || wh.code
    const location_code = buildLocationCode(
      prefix,
      String(sub_code).trim().toUpperCase(),
      String(row).trim(),
      String(shelf ?? '').trim()
    )

    // KHU LÀ CHUẨN (27/07): Loại của vị trí KẾ THỪA từ WarehouseZone — không nhận từ body.
    // Khu chưa khai → chặn (khớp luật upload), tránh vị trí mồ côi loại.
    const subUpper = String(sub_code).trim().toUpperCase()
    const { data: zone } = await supabase.from('WarehouseZone')
      .select('name, categories').eq('warehouse_id', warehouse_id).eq('code', subUpper).maybeSingle()
    if (!zone) return fail(res, 400, 'VALIDATION_ERROR', `Khu "${subUpper}" chưa có trong Khu vực của kho — tạo khu ở Cài đặt WMS → Khu vực trước`)
    const zoneCats = (zone as { categories: string[] | null }).categories ?? null
    if (!categoriesAllAllowed(req, zoneCats)) return fail(res, 403, 'FORBIDDEN', CATEGORY_FORBIDDEN_MSG)

    const actor = req.user?.name || null
    const { data, error } = await supabase
      .from('Location')
      .insert({
        id:          randomUUID(),
        warehouse_id,
        sub_code: subUpper,
        sub_name: sub_name ? String(sub_name).trim() : ((zone as { name: string | null }).name ?? null),
        sub_type: sub_type ?? null,
        categories: zoneCats,
        location_code,
        row: String(row).trim(),
        shelf: String(shelf ?? '').trim(),
        max_pallets: max_pallets ? Number(max_pallets) : 1,
        created_by: actor, updated_by: actor,
        updated_at: new Date().toISOString(),
      })
      .select('*, warehouse:Warehouse(id, code, name)')
      .single()

    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', 'Vị trí này đã tồn tại')
      throw error
    }
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function updateLocation(req: Request, res: Response) {
  try {
    if (!(await guardLocScope(req, res, req.params.id))) return
    // Loại của vị trí KHÔNG sửa lẻ ở đây — kế thừa từ Khu (sửa loại = sửa ở Khu vực, tự cascade)
    const { sub_name, sub_type, max_pallets, is_active, requires_stocktake } = req.body
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    if (sub_name !== undefined)          patch.sub_name          = sub_name ? String(sub_name).trim() : null
    if (sub_type !== undefined)          patch.sub_type          = sub_type
    if (max_pallets !== undefined)       patch.max_pallets       = Number(max_pallets)
    if (is_active !== undefined)         patch.is_active         = Boolean(is_active)
    if (requires_stocktake !== undefined) patch.requires_stocktake = Boolean(requires_stocktake)

    const { data, error } = await supabase
      .from('Location').update(patch).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// Gắn / bỏ cờ "cần kiểm kê" HÀNG LOẠT (vị trí quan trọng). Chỉ áp cho vị trí TRONG phạm vi kho + loại
// của user (bỏ qua id ngoài scope, không báo lỗi cả lô). Chunk 300/lô né URL dài + cap ~1000.
export async function bulkFlagLocations(req: Request, res: Response) {
  try {
    const { ids, requires_stocktake } = req.body as { ids?: unknown; requires_stocktake?: unknown }
    const idList = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
    if (!idList.length) return fail(res, 400, 'INVALID_INPUT', 'Thiếu danh sách vị trí')
    const flag = Boolean(requires_stocktake)

    const scope = scopeWhIds(req)
    const cats  = scopeCategoriesOf(req)
    const now   = new Date().toISOString()
    const by    = req.user?.name || null

    let updated = 0
    for (let i = 0; i < idList.length; i += 300) {
      const chunk = idList.slice(i, i + 300)
      // Lọc id thuộc phạm vi (kho + loại) — KHÔNG tin id từ client
      let q = supabase.from('Location').select('id, warehouse_id, categories').in('id', chunk)
      if (scope !== null) q = scope.length === 1 ? q.eq('warehouse_id', scope[0]) : q.in('warehouse_id', scope)
      const { data, error } = await q
      if (error) throw error
      const allowed = ((data ?? []) as { id: string; categories: string[] | null }[])
        .filter(r => categoriesAllAllowed(req, r.categories))
        .map(r => r.id)
      if (!allowed.length) continue
      const { error: upErr } = await supabase.from('Location')
        .update({ requires_stocktake: flag, updated_at: now, updated_by: by })
        .in('id', allowed)
      if (upErr) throw upErr
      updated += allowed.length
    }
    ok(res, { updated, requires_stocktake: flag })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── UPLOAD EXCEL VỊ TRÍ KHO ────────────────────────────────────────────────
// Mirror `scripts/import_locations.js` (chuẩn skill upload-download-standard):
//  • map theo TÊN cột (chịu đảo cột / đổi nhãn) — sheet ĐẦU TIÊN
//  • KHU VỰC (WarehouseZone) là CHUẨN: Loại hàng + Tên khu LẤY TỪ ZONE theo (kho, mã khu),
//    KHÔNG lấy từ file; khu chưa khai trong Khu vực kho → BÁO LỖI (không tự tạo zone)
//  • ALL-OR-NOTHING: còn 1 dòng lỗi thì KHÔNG ghi gì (giống upload Tồn kho — bước kế tiếp
//    của cùng luồng dựng kho mới, tránh nửa vời phải dò thủ công)
//  • Idempotent theo `location_code` (unique DB): đã có → CẬP NHẬT sức chứa/kiểu, mới → THÊM
const L_FIELDS: FieldDef[] = [
  { key: 'warehouse',   label: 'Kho',      aliases: ['ma kho', 'ten kho'], required: true },
  { key: 'sub_code',    label: 'Khu',      aliases: ['ma khu', 'khu vuc'], required: true },
  { key: 'row',         label: 'Dãy',      aliases: ['hang'], required: true },
  { key: 'shelf',       label: 'Tầng',     aliases: ['ke'] },
  { key: 'max_pallets', label: 'Sức chứa', aliases: ['so pallet toi da', 'max pallets'] },
  { key: 'sub_type',    label: 'Kiểu',     aliases: ['kieu vi tri', 'sub type'] },
]

const lcStr = (v: unknown): string => String(v ?? '').trim()
const lcInt = (v: unknown): number | null => {
  const s = lcStr(v); if (!s) return null
  const n = parseInt(s.replace(/[^\d-]/g, ''), 10)
  return (!Number.isFinite(n) || n <= 0) ? null : n
}

type ExistingLoc = Record<string, unknown> & { id: string; location_code: string }

export async function uploadExcel(req: Request, res: Response) {
  try {
    if (!req.file) return fail(res, 400, 'VALIDATION_ERROR', 'Không có file upload')
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const { rows, missingRequired } = parseSheetByHeader(ws, L_FIELDS)
    if (missingRequired.length)
      return fail(res, 400, 'VALIDATION_ERROR', `File thiếu cột bắt buộc: ${missingRequired.join(', ')} — kiểm tra đúng mẫu Vị trí kho`)
    if (!rows.length) return fail(res, 400, 'VALIDATION_ERROR', 'Không có dòng dữ liệu nào')

    // Danh mục: kho (khớp MÃ hoặc TÊN) + khu vực — phân trang né cap-1000
    const whs = await fetchAllRowsParallel(() => supabase.from('Warehouse')
      .select('id, code, name, nmsx_code').order('id')) as { id: string; code: string; name: string; nmsx_code: string | null }[]
    const whByCode = new Map(whs.map(w => [lcStr(w.code).toLowerCase(), w]))
    const whByName = new Map(whs.map(w => [lcStr(w.name).toLowerCase(), w]))
    const zones = await fetchAllRowsParallel(() => supabase.from('WarehouseZone')
      .select('warehouse_id, code, name, categories').order('id')) as { warehouse_id: string; code: string; name: string | null; categories: string[] | null }[]
    const zoneMap = new Map(zones.map(z => [`${z.warehouse_id}|${lcStr(z.code).toLowerCase()}`, z]))

    // ── PHA 1: validate TOÀN BỘ (all-or-nothing) ─────────────────────────────
    const errors: string[] = []
    type Parsed = { code: string; wh_id: string; sub_code: string; sub_name: string | null
                    categories: string[] | null; row: string; shelf: string; max_pallets: number; sub_type: string | null }
    const parsed: Parsed[] = []
    const seenCode = new Map<string, number>()
    const scope = scopeWhIds(req)
    let lineNo = 0

    for (const r of rows) {
      lineNo++
      const whRaw = lcStr(r.warehouse), subRaw = lcStr(r.sub_code), rowRaw = lcStr(r.row)
      const shelf = lcStr(r.shelf)
      // Đánh số theo DÒNG DỮ LIỆU (đã bỏ dòng tiêu đề) — nhắc rõ trong hint dialog để user không lệch
      const at = `dòng dữ liệu #${lineNo}`

      const missing: string[] = []
      if (!whRaw) missing.push('kho')
      if (!subRaw) missing.push('khu')
      if (!rowRaw) missing.push('dãy')
      if (missing.length) {
        // Kèm các ô ĐÃ điền để user dò ra đúng dòng trong file (dòng thiếu thì không có mã vị trí để bám)
        const co = [whRaw && `kho "${whRaw}"`, subRaw && `khu "${subRaw}"`, rowRaw && `dãy "${rowRaw}"`, shelf && `tầng "${shelf}"`].filter(Boolean)
        errors.push(`${at} — thiếu: ${missing.join(', ')}${co.length ? ` (đang có ${co.join(' · ')})` : ' (dòng trống các cột bắt buộc)'}`)
        continue
      }

      const wh = whByCode.get(whRaw.toLowerCase()) ?? whByName.get(whRaw.toLowerCase())
      if (!wh) { errors.push(`${at} — kho không khớp danh mục: "${whRaw}" (điền MÃ kho hoặc TÊN kho)`); continue }
      if (scope !== null && !scope.includes(wh.id)) {
        errors.push(`${at} — kho "${whRaw}" ngoài phạm vi của bạn`); continue
      }

      const sub = subRaw.toUpperCase()
      // Khu vực là CHUẨN: chưa khai khu thì KHÔNG tự tạo (Loại hàng của vị trí suy từ khu)
      const zone = zoneMap.get(`${wh.id}|${sub.toLowerCase()}`)
      if (!zone) {
        errors.push(`${at} — khu "${sub}" chưa có trong Khu vực của kho "${wh.name}" — tạo khu ở Cài đặt WMS → Khu vực trước`); continue
      }
      if (!categoriesAllAllowed(req, zone.categories)) {
        errors.push(`${at} — khu "${sub}" thuộc loại hàng "${(zone.categories ?? []).join(', ')}" ngoài phạm vi của bạn`); continue
      }

      const maxRaw = lcStr(r.max_pallets)
      const max_pallets = lcInt(r.max_pallets)
      if (maxRaw && max_pallets == null) { errors.push(`${at} — sức chứa phải là số nguyên > 0 (nhận "${maxRaw}")`); continue }

      const prefix = (wh.nmsx_code && lcStr(wh.nmsx_code)) || wh.code
      const code = buildLocationCode(prefix, sub, rowRaw, shelf)
      const dup = seenCode.get(code.toLowerCase())
      if (dup) { errors.push(`${at} — trùng vị trí "${code}" với dòng dữ liệu #${dup} trong cùng file`); continue }
      seenCode.set(code.toLowerCase(), lineNo)

      parsed.push({
        code, wh_id: wh.id, sub_code: sub, sub_name: zone.name ?? null, categories: zone.categories ?? null,
        row: rowRaw, shelf, max_pallets: max_pallets ?? 1, sub_type: lcStr(r.sub_type) || null,
      })
    }
    if (errors.length) return ok(res, { inserted: 0, updated: 0, errors })

    // ── PHA 2: ghi theo LÔ ───────────────────────────────────────────────────
    // Nạp vị trí đã có bằng select('*') → merge FULL RECORD (cột không khai trong file
    // giữ nguyên; upsert lô lấy HỢP key cả lô nên thiếu cột = bị ghi NULL đè).
    const codes = parsed.map(p => p.code)
    const exRows: ExistingLoc[] = []
    for (let i = 0; i < codes.length; i += 300) {
      exRows.push(...await fetchAllRowsParallel(() => supabase.from('Location')
        .select('*').in('location_code', codes.slice(i, i + 300)).order('id')) as ExistingLoc[])
    }
    const exMap = new Map(exRows.map(e => [lcStr(e.location_code).toLowerCase(), e]))

    const now = new Date().toISOString()
    const actor = req.user?.name || null
    const buildNew = (p: Parsed) => ({
      id: randomUUID(), location_code: p.code, warehouse_id: p.wh_id,
      sub_code: p.sub_code, sub_name: p.sub_name, sub_type: p.sub_type, categories: p.categories,
      row: p.row, shelf: p.shelf, max_pallets: p.max_pallets,
      is_active: true, created_at: now, updated_at: now, created_by: actor, updated_by: actor,
    })
    const inserts: Record<string, unknown>[] = []
    const updates: Record<string, unknown>[] = []
    for (const p of parsed) {
      const ex = exMap.get(p.code.toLowerCase())
      if (ex) {
        // Vị trí đã có → cập nhật sức chứa/kiểu + đồng bộ lại Tên khu & Loại theo ZONE.
        // KHÔNG đụng is_active/requires_stocktake/slot_no_in/slot_no_out (quản ở nơi khác).
        updates.push({ ...ex, sub_name: p.sub_name, sub_type: p.sub_type, categories: p.categories,
                       max_pallets: p.max_pallets, updated_at: now, updated_by: actor })
      } else inserts.push(buildNew(p))
    }

    let inserted = 0, updated = 0
    for (let i = 0; i < inserts.length; i += 500) {
      const chunk = inserts.slice(i, i + 500)
      const { error } = await supabase.from('Location').insert(chunk)
      if (!error) { inserted += chunk.length; continue }
      if (error.code !== '23505') { console.error('[locations upload]', error.message); return fail(res, 500, 'DB_ERROR', 'Lỗi ghi dữ liệu') }
      // Thua đua (người khác vừa tạo cùng mã) → jitter rồi chuyển các mã đã tồn tại thành UPDATE
      await new Promise(r => setTimeout(r, 100 + Math.floor(Math.random() * 300)))
      const chunkCodes = chunk.map(c => String(c.location_code))
      const winners = await fetchAllRowsParallel(() => supabase.from('Location')
        .select('*').in('location_code', chunkCodes).order('id')) as ExistingLoc[]
      const winMap = new Map(winners.map(w => [lcStr(w.location_code).toLowerCase(), w]))
      const retryIns: Record<string, unknown>[] = []
      for (const rec of chunk) {
        const w = winMap.get(String(rec.location_code).toLowerCase())
        if (!w) { retryIns.push(rec); continue }
        updates.push({ ...w, sub_name: rec.sub_name, sub_type: rec.sub_type, categories: rec.categories,
                       max_pallets: rec.max_pallets, updated_at: now, updated_by: actor })
      }
      if (retryIns.length) {
        const { error: e2 } = await supabase.from('Location').insert(retryIns)
        if (e2) return fail(res, 409, 'CONFLICT', 'Có người khác vừa tạo vị trí trùng mã — bấm upload lại để cập nhật')
        inserted += retryIns.length
      }
    }
    for (let i = 0; i < updates.length; i += 500) {
      const chunk = updates.slice(i, i + 500)
      const { error } = await supabase.from('Location').upsert(chunk, { onConflict: 'id' })
      if (error) { console.error('[locations upload]', error.message); return fail(res, 500, 'DB_ERROR', 'Lỗi ghi dữ liệu') }
      updated += chunk.length
    }
    ok(res, { inserted, updated, errors: [] })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function deleteLocation(req: Request, res: Response) {
  try {
    if (!(await guardLocScope(req, res, req.params.id))) return
    // Chặn xóa vị trí đang chứa hàng → tránh tồn kho mồ côi trên location inactive
    const { count } = await supabase
      .from('InventoryEntry')
      .select('id', { count: 'exact', head: true })
      .eq('location_id', req.params.id)
      .in('status', ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING'])
    if ((count ?? 0) > 0) return fail(res, 409, 'IN_USE', `Vị trí đang chứa ${count} pallet tồn — không thể xóa`)

    const { data, error } = await supabase
      .from('Location').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}
