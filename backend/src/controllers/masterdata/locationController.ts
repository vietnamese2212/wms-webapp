import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { scopeCategoriesOf, categoriesAllAllowed, categoriesAnyAllowed, categoriesOrScopeFilter, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'
import { fetchAllRowsParallel, fetchAllByIdChunks, isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { safeFilterValue, safeSearch, searchLooksLikeInjection, normalizeSearchTerm, SEARCH_INVALID_MSG } from '../../utils/search'
import { parseSheetByHeader, type FieldDef } from '../../utils/excelHeader'
import { parseListParam } from '../../utils/httpQuery'
import { normalizeLocScan } from '../../utils/locationScan'
import { isPreflight, buildPreflight } from '../../utils/uploadPreflight'
import { loadPutawayContext, loadSlotFactsRaw, putawayTargetZones } from '../../services/putawayContext'
import { putawayBlock, putawayReason, putawayScore, putawayEnforces, type PutawayLoc, type PutawayHint } from '../../utils/putaway'

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
  'max_pallets, is_active, requires_stocktake, is_pick_face, slot_no_in, slot_no_out'

// ─── Phân trang SERVER cho TRANG danh mục Vị trí kho ────────────────────────────────────────────
// 1 kho có thể vài nghìn vị trí (Bàu Bàng 1.517) — trước đây render hết + cộng tổng ở máy.
// Bộ lọc parse 1 CHỖ cho cả trang / tổng / gắn-cờ-hàng-loạt.
type LocListCtx = {
  whIds: string[] | null      // rỗng = ngoài phạm vi → trả rỗng
  category: string | null
  scopeCats: string[] | null
  tokens: string[] | null
  subs: string[] | null       // Khu vực kho (sub_code) — [] = có mặt nhưng rỗng ⇒ trả RỖNG
  // Các cờ đều BA TRẠNG THÁI: null = không lọc; true/false = chỉ có / chỉ chưa có cờ
  flag: boolean | null        // requires_stocktake (cần check hàng ngày)
  pickFace: boolean | null    // is_pick_face (vị trí nhặt lẻ)
  noIn: boolean | null        // slot_no_in (không đưa hàng vào — kho tạm/ngoài đường)
  noOut: boolean | null       // slot_no_out (không lấy hàng đi — hàng kẹt)
  inclInactive: boolean
  blocked: boolean
}
// Cờ 3 trạng thái qua query-string: vắng/rỗng = không lọc; '1'|'true'|true = có; còn lại = không.
const tri = (v: unknown): boolean | null =>
  v === undefined || v === '' || v === null ? null : (v === '1' || v === 'true' || v === true)

function getLocListCtx(req: Request, raw?: Record<string, unknown>): LocListCtx {
  const q = (raw ?? req.query) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const warehouseId = str(q.warehouse_id) || null
  const scope = scopeWhIds(req)
  let whIds: string[] | null = warehouseId ? [warehouseId] : null
  let blocked = false
  if (scope !== null) {
    const eff = warehouseId ? scope.filter(id => id === warehouseId) : scope
    blocked = eff.length === 0
    whIds = eff
  }
  const norm = normalizeSearchTerm(str(q.search)).trim()
  return {
    whIds, blocked,
    category: str(q.category) || null,
    scopeCats: scopeCategoriesOf(req),
    tokens: norm ? norm.split(/\s+/).filter(Boolean) : null,
    subs: parseListParam(q.zones),
    // nhận '1' | 'true' | true — cờ boolean qua query-string mỗi client serialize một kiểu
    flag: tri(q.flag),
    pickFace: tri(q.pick_face),
    noIn: tri(q.slot_no_in),
    noOut: tri(q.slot_no_out),
    inclInactive: q.include_inactive === '1' || q.include_inactive === 'true' || q.include_inactive === true,
  }
}
const locRpcParams = (c: LocListCtx) => ({
  p_wh_ids: c.whIds, p_category: c.category, p_scope_cats: c.scopeCats,
  p_tokens: c.tokens, p_flag: c.flag, p_pick_face: c.pickFace, p_subs: c.subs,
  p_slot_no_in: c.noIn, p_slot_no_out: c.noOut,
})

async function listLocationsPaged(req: Request, res: Response) {
  const q = req.query as Record<string, string | undefined>
  const page = Math.max(1, Number(q.page) || 1)
  const pageSize = Math.min(1000, Math.max(1, Number(q.page_size) || 200))
  const ctx = getLocListCtx(req)
  if (ctx.blocked) return ok(res, { rows: [], total: 0 })
  // RPC trả THẲNG dòng + used_slots (migration 20260729, p_with_rows) ⇒ 1 request thay vì 3.
  const { data, error } = await supabase.rpc('locations_page', {
    p_offset: (page - 1) * pageSize, p_limit: pageSize,
    ...locRpcParams(ctx), p_incl_inactive: ctx.inclInactive,
    p_with_rows: true,
  })
  if (error) throw error
  const p = (data ?? {}) as { rows?: unknown[]; total?: number }
  return ok(res, { rows: p.rows ?? [], total: p.total ?? 0 })
}

// GET /api/masterdata/locations/summary — 4 ô SummaryBand trên TOÀN BỘ bộ lọc (chỉ vị trí đang dùng)
export async function listLocationsSummary(req: Request, res: Response) {
  try {
    const ctx = getLocListCtx(req)
    if (ctx.blocked) return ok(res, { count: 0, capacity: 0, used: 0, full: 0 })
    const { data, error } = await supabase.rpc('locations_summary', locRpcParams(ctx))
    if (error) throw error
    return ok(res, data ?? {})
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    console.error(e); return fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

// Tập vị trí ĐANG ĐỂ DỞ đúng mã này (layer-1, còn tồn) — nguồn của gợi ý ★ "gom pallet".
// Hỏi DB trả về TẬP VỊ TRÍ chứ không kéo dòng tồn về đếm; trần 300 = trần id trên URL.
async function sameMaterialLocIds(materialId: string, warehouseId: string | null): Promise<string[]> {
  let q = supabase.from('InventoryEntry').select('location_id')
    .eq('material_id', materialId).eq('stack_layer', 1)
    .in('status', ['IN_STOCK', 'PARTIAL']).gt('cartons_remaining', 0)
    .not('location_id', 'is', null).limit(1000)
  if (warehouseId) q = q.eq('warehouse_id', warehouseId)
  const { data } = await q
  return [...new Set((data ?? []).map(r => (r as { location_id: string }).location_id))].slice(0, 300)
}

export async function listLocations(req: Request, res: Response) {
  try {
    const { warehouse_id, sub_code, active, category, material_id, view, search, limit } = req.query
    if (search && searchLooksLikeInjection(search)) return fail(res, 400, 'INVALID_SEARCH', SEARCH_INVALID_MSG)
    // limit=N (typeahead): chỉ N dòng đầu → không kéo cả nghìn vị trí về trình duyệt.
    // Trần 300 (17/08, trước là 200): picker cất hàng xin 300 để kho cỡ thường (Ba Vì 236 ô) thấy
    // TRỌN danh sách một lần — user báo "chỉ hiện vài vị trí, gõ tay mới ra ô khác" vì 50 dòng đầu
    // theo mã vị trí bị lọc Loại kho cắt gần hết. Kho nghìn ô vẫn cắt ở 300 + tìm server.
    const cap = Math.min(Math.max(Number(limit) || 0, 0), 300)
    // ids=... : tra NHÃN cho vị trí ĐANG CHỌN (khuôn useMaterialsByIds). Ô chọn tìm-trên-server chỉ
    // giữ 50 dòng khớp từ khoá HIỆN TẠI, nên value đang chọn phải có đường tra riêng — không thì
    // chip/ô in uuid thô và user tưởng mất dữ liệu (bài học nghiệm thu 29/07). Cap 300 = trần URL.
    const ids = parseListParam(req.query.ids, 300)

    // CỜ NGỮ NGHĨA (15/08) — trả TẬP vị trí mang cờ, thay vì để FE kéo CẢ KHO rồi tự `.filter()`.
    // Đo thật kho Bàu Bàng 1.517 vị trí: **1.030KB / 2,9s MỖI LẦN mở màn** (3 màn Kiểm kho +
    // tab cấu hình Slotting đều làm vậy) — và phần đắt nhất là `used_slots` (quét InventoryEntry
    // chunk 300 = 6 lượt round-trip) mà mấy màn đó KHÔNG dùng tới. Cờ nào cũng là tập CON có chủ
    // đích (vị trí cần kiểm / kho tạm / hàng kẹt), nên trả đủ tập là an toàn — khác hẳn "cả danh mục".
    // ⚠️ Thêm cờ lọc mới thì phải khai ở CẢ HAI nhánh (mảng ở đây + `locations_page` bên dưới).
    // Bắt được 17/08: `pick_face` chỉ có ở nhánh phân trang ⇒ gọi `?pick_face=1` KHÔNG có `page=`
    // trả về TOÀN BỘ vị trí của kho mà không báo gì — người gọi tưởng đã lọc (đo Ba Vì: xin tập ô
    // nhặt lẻ, nhận đủ 236 ô). Đúng lớp lỗi "lọc bị bỏ qua âm thầm" đã dính với chính cờ này ở FE
    // ngày 04/08.
    const flagStk   = tri(req.query.flag)          // requires_stocktake — "cần kiểm kê"
    const flagPick  = tri(req.query.pick_face)     // is_pick_face — vị trí nhặt lẻ
    const flagNoIn  = tri(req.query.slot_no_in)    // Slotting: kho tạm, không đưa hàng vào
    const flagNoOut = tri(req.query.slot_no_out)   // Slotting: hàng kẹt, không lấy hàng đi
    const byFlag = flagStk !== null || flagNoIn !== null || flagNoOut !== null || flagPick !== null

    // Scope kho: ASSIGNED chỉ thấy vị trí kho được gán — kể cả khi KHÔNG truyền warehouse_id
    // (vd Check vị trí để "tất cả kho" trước đây lộ toàn bộ vị trí mọi kho)
    const scope = scopeWhIds(req)
    let effective: string[] | null = null
    if (scope !== null) {
      effective = warehouse_id ? scope.filter(id => id === String(warehouse_id)) : scope
      if (effective.length === 0) return ok(res, [])
    }
    const scopeCats = scopeCategoriesOf(req)

    // Có ?page= → TRANG (trang danh mục Vị trí kho). Không có → giữ mode cũ trả MẢNG cho mọi
    // consumer khác (picker chọn vị trí, gợi ý vị trí theo mã hàng, Slotting…).
    if (req.query.page) return await listLocationsPaged(req, res)

    // Phân trang né cap ~1000 (>1000 vị trí thì list/dropdown mất vị trí)
    const buildQ = () => {
      let query = supabase
        .from('Location')
        .select(view === 'lite' || byFlag ? LOCATION_LITE_COLS : '*, warehouse:Warehouse(id, code, name), InventoryEntry(count)')
        .order('sub_code').order('row').order('shelf').order('id')
      if (ids) query = query.in('id', ids.slice(0, 300))   // cap 300 = trần id trên URL PostgREST
      if (flagStk   !== null) query = query.eq('requires_stocktake', flagStk)
      if (flagPick  !== null) query = query.eq('is_pick_face', flagPick)
      if (flagNoIn  !== null) query = query.eq('slot_no_in', flagNoIn)
      if (flagNoOut !== null) query = query.eq('slot_no_out', flagNoOut)
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
      // Ô chọn tìm-trên-server chỉ lấy `cap` dòng ĐẦU theo thứ tự mã vị trí. Với picker Nhập kho
      // (có material_id) thì vị trí ★ "đang để dở cùng mã" gần như CHẮC CHẮN nằm ngoài 50 dòng đầu
      // ⇒ mất gợi ý gom pallet. Nên khi có material_id: lấy nhóm ★ TRƯỚC (theo tập vị trí đang
      // chứa mã đó) rồi bù danh sách thường cho đủ. 2 truy vấn nhỏ, vẫn rẻ hơn nhiều so với kéo
      // cả kho (Bàu Bàng 1.517 vị trí = 616KB + hàng chục round-trip tính used_slots).
      // Cùng lý do đó, KHU ĐÍCH của chiến thuật ABC cũng phải được nạp TRƯỚC khi cắt: khu đích
      // nằm cuối bảng chữ cái thì bị `limit` cắt gần hết, tức chiến thuật ABC gợi ý vào khu mà
      // picker không hề hiện (đo 17/08 Ba Vì band C = TP3: limit=200 lọt 6/41 vị trí TP3).
      const whForZones = effective?.length === 1 ? effective[0] : (warehouse_id ? String(warehouse_id) : null)
      const [recIds, bandZones] = await Promise.all([
        material_id ? sameMaterialLocIds(String(material_id), warehouse_id ? String(warehouse_id) : null) : Promise.resolve([]),
        material_id ? putawayTargetZones(whForZones, String(material_id)) : Promise.resolve([]),
      ])
      const rec: Record<string, unknown>[] = []
      if (recIds.length) {
        const { data: r, error } = await buildQ().in('id', recIds.slice(0, 300)).limit(cap)
        if (error) throw error
        rec.push(...((r ?? []) as unknown as Record<string, unknown>[]))
      }
      if (bandZones.length) {
        const { data: z, error } = await buildQ().in('sub_code', bandZones.slice(0, 100)).limit(cap)
        if (error) throw error
        rec.push(...((z ?? []) as unknown as Record<string, unknown>[]))
      }
      const { data: page, error } = await buildQ().limit(cap)
      if (error) throw error
      // rec gộp 2 nguồn (★ cùng mã + khu đích ABC) nên tự nó có thể TRÙNG — khử trước, không thì
      // một vị trí hiện 2 dòng trong ô chọn.
      const seen = new Set<string>()
      const recUniq = rec.filter(l => !seen.has(l.id as string) && seen.add(l.id as string))
      data = [...recUniq, ...((page ?? []) as unknown as Record<string, unknown>[]).filter(l => !seen.has(l.id as string))]
    } else {
      data = await fetchAllRowsParallel(buildQ) as unknown as Record<string, unknown>[]
    }

    // Hỏi theo CỜ = chỉ cần biết "vị trí nào mang cờ" (id + mã) → trả thẳng, KHÔNG quét
    // InventoryEntry tính used_slots (chunk 300 = phần đắt nhất của endpoint này).
    if (byFlag) return ok(res, data ?? [])

    // used_slots + "đang để dở cùng mã": HỎI DB TRẢ SỐ (RPC putaway_slot_facts), không kéo dòng
    // tồn về đếm. Trước đây 2 vòng quét InventoryEntry riêng — Bàu Bàng 1.517 vị trí kéo về
    // 15.009 dòng chỉ để đếm; nay tối đa 1.517 dòng, mỗi ô một dòng.
    const locIdsAll = (data ?? []).map((l: Record<string, unknown>) => l.id as string)
    const matId = material_id ? String(material_id) : null

    // Picker CẤT HÀNG ⇒ chấm ★ / lý do chặn theo quy tắc của kho; danh sách thường chỉ cần
    // used_slots, khỏi nạp cấu hình kho.
    // `putaway=1` cho picker KHÔNG biết trước mã hàng — Chuyển vị trí hàng loạt chọn được pallet
    // NHIỀU MÃ, mà suy "có material_id ⇒ là picker cất hàng" thì đúng ca đó picker KHÔNG hiện gì
    // (không "cấm nhập", không "đã đầy"), người dùng chọn xong bấm Chuyển mới ăn 422. Thiếu mã thì
    // các luật phụ thuộc mã tự im (NCC/trộn date cần dữ liệu của pallet), còn luật của Ô vẫn chấm.
    const wantPutaway = !!matId || req.query.putaway === '1'
    const whForRules = effective?.length === 1 ? effective[0] : (warehouse_id ? String(warehouse_id) : null)
    const ctx = wantPutaway && locIdsAll.length > 0
      ? await loadPutawayContext({
          warehouseId: whForRules,
          locIds: locIdsAll,
          incoming: { material_id: matId ?? '', ncc_id: req.query.ncc_id ? String(req.query.ncc_id) : null },
        })
      : null
    const rawFacts = ctx ? null : (locIdsAll.length > 0 ? await loadSlotFactsRaw(locIdsAll, null, false) : [])
    const usedCount = new Map<string, number>()
    if (ctx) for (const [id, f] of ctx.facts) usedCount.set(id, f.pallets)
    else for (const r of rawFacts ?? []) usedCount.set(r.location_id, Number(r.pallets ?? 0))

    const withUsage = (data ?? []).map((loc: Record<string, unknown>) => {
      const { InventoryEntry, ...rest } = loc
      const id = rest.id as string
      const row: Record<string, unknown> = {
        ...rest,
        _count: { inventory_entries: Array.isArray(InventoryEntry) ? ((InventoryEntry[0] as { count: number })?.count ?? 0) : 0 },
        used_slots: usedCount.get(id) ?? 0,
        has_same_material: false,
      }
      if (ctx) {
        const f = ctx.factsOf(id)
        const l: PutawayLoc = {
          id,
          sub_code:     rest.sub_code     as string | null,   // chiến thuật ABC chấm theo KHU
          max_pallets:  rest.max_pallets  as number | null,
          slot_no_in:   rest.slot_no_in   as boolean | null,
          is_pick_face: rest.is_pick_face as boolean | null,
        }
        row.has_same_material = f.sameMaterial
        // FE CHỈ hiển thị khối này, KHÔNG tự tính lại (luật một nguồn — utils/putaway.ts)
        const blocked = putawayBlock(l, f, ctx.incoming, ctx.rules)
        row.putaway = {
          blocked,
          reason:  putawayReason(l, f, ctx.incoming, ctx.rules, ctx.abc),
          enforced: blocked != null && putawayEnforces(ctx.rules, blocked),
        } satisfies PutawayHint
        row._score = putawayScore(l, f, ctx.incoming, ctx.rules, ctx.abc)
      }
      return row
    })

    // Sắp xếp theo quy tắc cất hàng: ★ lên đầu, ô bị chặn xuống cuối, còn lại giữ nguyên thứ tự
    // gốc (mã vị trí) — sort ỔN ĐỊNH nên hai ô cùng điểm không nhảy chỗ giữa các lần gõ.
    if (ctx) {
      withUsage.sort((a, b) => (a._score as number) - (b._score as number))
      for (const r of withUsage) delete r._score
    }

    ok(res, withUsage)
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

// ─── QUÉT TEM VỊ TRÍ ────────────────────────────────────────────────────────────────────────────
// GET /masterdata/locations/resolve?code=&warehouse_id=&material_id=&putaway=1
// Tra ĐÚNG MỘT vị trí theo mã quét từ tem (user chốt 21/08: mọi chỗ chọn vị trí đều quét được).
//
// Vì sao KHÔNG dùng lại `?search=` của listLocations: search là `ilike %…%` trên `search_norm`
// (gồm cả mã khu + TÊN khu) nên một phát quét có thể ra nhiều dòng, và "dòng đầu tiên" thì phụ
// thuộc thứ tự sắp xếp — quét tem ô `B_TP1_5_T1` mà nhận về `B_TP1_5_T10` là pallet đi sai ô mà
// không ai biết. Ở đây bắt buộc khớp TRỌN mã: 1 dòng thì nhận, nhiều dòng thì báo mơ hồ.
//
// Trả về CÙNG HÌNH DẠNG với một dòng của listLocations (`used_slots` + khối `putaway`) để màn quét
// hiện y nguyên nhãn "đã đầy / không đưa hàng vào / ★ đang để dở cùng mã" như khi bấm chọn tay —
// luật một nguồn, FE không tự chấm lại.
export async function resolveLocation(req: Request, res: Response) {
  try {
    const code = normalizeLocScan(req.query.code)
    if (!code) return fail(res, 400, 'MISSING_CODE', 'Chưa có mã vị trí để tra')
    if (searchLooksLikeInjection(code)) return fail(res, 400, 'INVALID_SEARCH', SEARCH_INVALID_MSG)

    const warehouseId = req.query.warehouse_id ? String(req.query.warehouse_id) : null
    const scope = scopeWhIds(req)
    let effective: string[] | null = null
    if (scope !== null) {
      effective = warehouseId ? scope.filter(id => id === warehouseId) : scope
      if (effective.length === 0) {
        return fail(res, 404, 'LOCATION_NOT_FOUND', `Không tìm thấy vị trí "${code}" trong phạm vi kho của bạn`)
      }
    }
    type LocRow = {
      id: string; location_code: string; warehouse_id: string | null
      sub_code: string | null; max_pallets: number | null; categories: string[] | null
      slot_no_in: boolean | null; is_pick_face: boolean | null; is_active: boolean | null
    }

    // Khoanh SQL bằng đúng MỘT kho (nếu người gọi khai) rồi CẮT SCOPE TRONG JS trên vài dòng khớp
    // mã. Cố ý không nhồi cả danh sách kho/loại vào URL: một phát quét chỉ có thể khớp vài dòng,
    // nên lọc trong JS vừa đúng vừa khỏi dính 2 trần đã biết (id-list-url-limits + cap 1000).
    const inScope = (rows: LocRow[]) => rows.filter(l =>
      (!effective || (l.warehouse_id != null && effective.includes(l.warehouse_id)))
      && categoriesAnyAllowed(req, l.categories))
    const buildQ = () => {
      const q = supabase.from('Location').select(LOCATION_LITE_COLS)
      return warehouseId ? q.eq('warehouse_id', warehouseId) : q
    }
    // Vòng 1 — khớp CHÍNH XÁC (ilike không wildcard = bỏ qua hoa/thường, giữ nguyên dấu).
    // limit 50 (không phải 5): cắt scope làm ở JS nên phải chắc dòng THUỘC scope không bị `limit`
    // gạt ra trước khi lọc — mã vị trí gần như duy nhất nên 50 là dư sức.
    const { data: exact, error: e1 } = await buildQ().ilike('location_code', safeSearch(code)).limit(50)
    if (e1) throw e1
    let rows = inScope((exact ?? []) as unknown as LocRow[])

    // Vòng 2 — tem in KHÔNG DẤU (máy in nhãn thiếu font tiếng Việt là chuyện thường). So trên cột
    // chuẩn-hoá bỏ dấu rồi lọc lại trong JS để chỉ nhận đúng MÃ: `search_norm` còn chứa tên khu,
    // không lọc lại thì quét "TP1" ra cả trăm ô.
    if (rows.length === 0) {
      const norm = normalizeSearchTerm(code)
      const { data: fuzzy, error: e2 } = await buildQ().ilike('search_norm', `%${safeSearch(norm)}%`).limit(200)
      if (e2) throw e2
      rows = inScope((fuzzy ?? []) as unknown as LocRow[]).filter(l => normalizeSearchTerm(l.location_code) === norm)
    }

    if (rows.length === 0) {
      return fail(res, 404, 'LOCATION_NOT_FOUND',
        `Không tìm thấy vị trí "${code}"${warehouseId ? ' trong kho này' : ''}`)
    }
    // Cùng một mã ở 2 kho (chưa chọn kho) → KHÔNG tự đoán, bắt chọn kho. Đoán sai = pallet nhảy kho.
    if (rows.length > 1) {
      return fail(res, 409, 'LOCATION_AMBIGUOUS',
        `Mã "${code}" đang có ở ${rows.length} kho — chọn kho trước khi quét`)
    }

    const loc = rows[0]
    // Ô ngưng sử dụng VẪN trả về (kèm `is_active:false`) để màn quét nói đúng "ô này đã ngưng sử
    // dụng" thay vì "không tìm thấy" — người quét đứng trước tem thật, báo không-tìm-thấy là bắt họ
    // quét lại vô ích. Chặn chọn là việc của FE + của các cửa ghi.
    const matId = req.query.material_id ? String(req.query.material_id) : null
    const wantPutaway = !!matId || req.query.putaway === '1'
    const row: Record<string, unknown> = { ...loc, has_same_material: false }

    if (wantPutaway) {
      const ctx = await loadPutawayContext({
        warehouseId: loc.warehouse_id,
        locIds: [loc.id],
        incoming: { material_id: matId ?? '', ncc_id: req.query.ncc_id ? String(req.query.ncc_id) : null },
      })
      const f = ctx.factsOf(loc.id)
      const l: PutawayLoc = {
        id: loc.id, sub_code: loc.sub_code, max_pallets: loc.max_pallets,
        slot_no_in: loc.slot_no_in, is_pick_face: loc.is_pick_face,
      }
      const blocked = putawayBlock(l, f, ctx.incoming, ctx.rules)
      row.used_slots = f.pallets
      row.has_same_material = f.sameMaterial
      row.putaway = {
        blocked,
        reason: putawayReason(l, f, ctx.incoming, ctx.rules, ctx.abc),
        enforced: blocked != null && putawayEnforces(ctx.rules, blocked),
      } satisfies PutawayHint
    } else {
      const facts = await loadSlotFactsRaw([loc.id], null, false)
      row.used_slots = Number(facts?.[0]?.pallets ?? 0)
    }
    ok(res, row)
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

// GET /masterdata/locations/:id/contents — "Ô này đang chứa GÌ" (user yêu cầu 17/08).
// Người cất hàng nhìn ★/used-slots vẫn phải đoán: cùng mã hay khác mã? date nào? có pallet QA giữ
// không? Trả bản GỌN gom theo MÃ (không trả từng pallet — ô nặng nhất staging 69 mã / hàng trăm
// pallet) và CHỈ cho MỘT vị trí (1 request khi người dùng chọn, không phải mỗi lần gõ phím).
export async function getLocationContents(req: Request, res: Response) {
  try {
    const id = req.params.id
    if (!(await guardLocScope(req, res, id))) return
    const { data: locRaw } = await supabase.from('Location')
      .select('id, location_code, max_pallets, categories, is_pick_face, slot_no_in')
      .eq('id', id).maybeSingle()
    const loc = locRaw as { id: string; location_code: string; max_pallets: number | null
                            categories: string[] | null; is_pick_face: boolean | null; slot_no_in: boolean | null } | null
    if (!loc) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')

    // Cùng ĐỊNH NGHĨA "đang chiếm chỗ" với putaway_slot_facts / used_slots (lớp 1, còn tồn) —
    // lệch định nghĩa là hai màn nói hai số rồi người dùng mất tin.
    type Ent = {
      material_id: string; pallet_code: string | null; status: string
      cartons_remaining: number; production_date: string | null; expiry_date: string | null
    }
    const ents = await fetchAllRowsParallel(() => supabase.from('InventoryEntry')
      .select('material_id, pallet_code, status, cartons_remaining, production_date, expiry_date')
      .eq('location_id', id).eq('stack_layer', 1)
      .in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE'])
      .gt('cartons_remaining', 0).order('material_id')) as unknown as Ent[]

    const live = ents.filter(e => e.status !== 'QUARANTINE')
    type Grp = { material_id: string; pallets: number; qty_base: number
                 date_min: string | null; date_max: string | null; date_kind: 'HSD' | 'NSX' | null; qa_hold: number }
    const byMat = new Map<string, Grp>()
    for (const e of ents) {
      const g: Grp = byMat.get(e.material_id)
        ?? { material_id: e.material_id, pallets: 0, qty_base: 0, date_min: null, date_max: null, date_kind: null, qa_hold: 0 }
      g.pallets += 1
      g.qty_base += Number(e.cartons_remaining ?? 0)
      if (e.status === 'QUARANTINE') g.qa_hold += 1
      // Ngày để người cất so "hàng trong ô cũ hay mới hơn pallet mình cầm" — ưu tiên HSD tường minh
      // (tem V2), không có thì NSX. Trả kèm date_kind để FE in ĐÚNG CHỮ, khỏi đoán theo nguyên tắc
      // luân chuyển của kho (đoán sai là dán nhãn HSD lên một cái ngày sản xuất). Chỉ để HIỂN THỊ —
      // luật trộn date vẫn nằm ở BE lúc quét.
      const kind: 'HSD' | 'NSX' | null = e.expiry_date ? 'HSD' : e.production_date ? 'NSX' : null
      const d = e.expiry_date ?? e.production_date
      if (d) {
        if (!g.date_min || d < g.date_min) g.date_min = d
        if (!g.date_max || d > g.date_max) g.date_max = d
        // Ô trộn cả 2 kiểu (hàng cũ chưa có HSD tường minh) → ghi 'HSD' vì đó là mốc rõ nghĩa hơn
        g.date_kind = g.date_kind === null ? kind : (g.date_kind === kind ? kind : 'HSD')
      }
      byMat.set(e.material_id, g)
    }
    type MatLite = { id: string; material_code: string; short_name: string | null
                     base_unit: string | null; entry_unit: string | null; units_per_carton: number | null }
    const mats = await fetchAllByIdChunks([...byMat.keys()], chunk => supabase.from('Material')
      .select('id, material_code, short_name, base_unit, entry_unit, units_per_carton').in('id', chunk)) as unknown as MatLite[]
    const matById = new Map(mats.map(m => [m.id, m]))
    const rows = [...byMat.values()]
      .map(g => ({
        ...g,
        material_code: matById.get(g.material_id)?.material_code ?? null,
        short_name:    matById.get(g.material_id)?.short_name ?? null,
        base_unit:     matById.get(g.material_id)?.base_unit ?? null,
        units_per_carton: matById.get(g.material_id)?.units_per_carton ?? null,
        entry_unit:    matById.get(g.material_id)?.entry_unit ?? null,
      }))
      .sort((a, b) => b.pallets - a.pallets)

    return ok(res, {
      location_code: loc.location_code,
      max_pallets: loc.max_pallets ?? 0,
      pallets: live.length,                       // = used_slots (không tính pallet QA giữ)
      qa_hold: ents.length - live.length,
      materials: rows,
    })
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    console.error(e); return fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
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
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
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
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
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
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

export async function updateLocation(req: Request, res: Response) {
  try {
    if (!(await guardLocScope(req, res, req.params.id))) return
    // Loại của vị trí KHÔNG sửa lẻ ở đây — kế thừa từ Khu (sửa loại = sửa ở Khu vực, tự cascade)
    const { sub_name, sub_type, max_pallets, is_active, requires_stocktake, is_pick_face, slot_no_in, slot_no_out } = req.body
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    if (sub_name !== undefined)          patch.sub_name          = sub_name ? String(sub_name).trim() : null
    if (sub_type !== undefined)          patch.sub_type          = sub_type
    if (max_pallets !== undefined)       patch.max_pallets       = Number(max_pallets)
    if (is_active !== undefined)         patch.is_active         = Boolean(is_active)
    if (requires_stocktake !== undefined) patch.requires_stocktake = Boolean(requires_stocktake)
    if (is_pick_face !== undefined)      patch.is_pick_face       = Boolean(is_pick_face)
    // 2 cờ "Vị trí đặc biệt". Trang này là ĐƯỜNG KHAI DUY NHẤT từ 18/08 — khối multi-select
    // replace-all ở tab Cài đặt trang Tối ưu vị trí đã gỡ (user chê khó config; và một cờ hai chỗ
    // khai thì thêm cờ mới là quên một bên).
    if (slot_no_in !== undefined)        patch.slot_no_in         = Boolean(slot_no_in)
    if (slot_no_out !== undefined)       patch.slot_no_out        = Boolean(slot_no_out)

    const { data, error } = await supabase
      .from('Location').update(patch).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
    ok(res, data)
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

// Gắn / bỏ cờ HÀNG LOẠT — "cần kiểm kê" / "vị trí nhặt lẻ" / "không đưa hàng vào" / "không lấy
// hàng đi" (2 cờ sau = Vị trí đặc biệt, chỉ khai ở trang này). Chỉ áp cho vị
// trí TRONG phạm vi kho + loại của user (bỏ qua id ngoài scope, không báo lỗi cả lô). Chunk 300/lô.
export async function bulkFlagLocations(req: Request, res: Response) {
  try {
    const { ids, requires_stocktake, is_pick_face, slot_no_in, slot_no_out } = req.body as {
      ids?: unknown; requires_stocktake?: unknown; is_pick_face?: unknown; slot_no_in?: unknown; slot_no_out?: unknown
    }
    const flags: Record<string, boolean> = {}
    if (requires_stocktake !== undefined) flags.requires_stocktake = Boolean(requires_stocktake)
    if (is_pick_face       !== undefined) flags.is_pick_face       = Boolean(is_pick_face)
    if (slot_no_in         !== undefined) flags.slot_no_in         = Boolean(slot_no_in)
    if (slot_no_out        !== undefined) flags.slot_no_out        = Boolean(slot_no_out)
    if (Object.keys(flags).length === 0)
      return fail(res, 400, 'INVALID_INPUT', 'Thiếu cờ cần gắn')
    let idList = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
    // Danh sách đã PHÂN TRANG → client không còn đủ id của bộ lọc: gửi CỜ bộ lọc, BE tự resolve
    // (luật id-list-url-limits: không nhồi hàng nghìn id qua mạng).
    const body = req.body as { by_filter?: boolean; filter?: Record<string, unknown> }
    if (!idList.length && body.by_filter) {
      const ctx = getLocListCtx(req, body.filter ?? {})
      if (ctx.blocked) return ok(res, { updated: 0, ...flags })
      const { data, error } = await supabase.rpc('locations_page', {
        p_offset: 0, p_limit: 1_000_000, ...locRpcParams(ctx), p_incl_inactive: false,
      })
      if (error) throw error
      idList = ((data ?? {}) as { ids?: string[] }).ids ?? []
    }
    if (!idList.length) return fail(res, 400, 'INVALID_INPUT', 'Thiếu danh sách vị trí')

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
        .update({ ...flags, updated_at: now, updated_by: by })
        .in('id', allowed)
      if (upErr) throw upErr
      updated += allowed.length
    }
    ok(res, { updated, ...flags })
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
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
    // KIỂM TRƯỚC (preflight): file có lỗi → báo cáo luôn, khỏi phải đếm insert/update
    if (errors.length) {
      if (isPreflight(req)) return ok(res, buildPreflight({ unit: 'vị trí', total: rows.length, errors }))
      return ok(res, { inserted: 0, updated: 0, errors })
    }

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

    // File sạch → báo cáo "sẽ thêm / sẽ cập nhật" rồi DỪNG (chưa ghi gì). Đếm lấy từ chính 2 mảng
    // sắp ghi nên số trên dialog = số thật sau khi bấm Xác nhận.
    if (isPreflight(req)) return ok(res, buildPreflight({
      unit: 'vị trí', total: rows.length, toInsert: inserts.length, toUpdate: updates.length,
    }))

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
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
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
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}
