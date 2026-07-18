import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { scopeCategoriesOf } from '../../utils/categoryScope'
import { fetchAllRowsParallel } from '../../utils/pagination'

// ─── Slotting v2 (Tối ưu vị trí) — user chỉnh rule 17/07 ────────────────────
// 3 MỨC ĐỘ (filter trên trang, không cài đặt kho): EASY = gom mã về ít vị trí (giải
// phóng chỗ, không quan tâm date) · NORMAL = gom theo DATE + nguyên tắc FIFO/FEFO/LIFO
// (LIFO: date dài dồn VÀO vị trí date ngắn; FIFO/FEFO: date ngắn dồn vào vị trí date dài)
// · HARD = NORMAL + đảo khu theo ABC velocity (cần chỗ trống đệm).
// KHU ĐẶC THÙ (SCA lạnh…) = LOẠI KHO có sẵn (user chốt v3 — không trường khớp tay): khu có Loại
// CHỈ nhận mã đúng Loại; pallet nằm sai Loại khu → CẢNH BÁO; checkbox "kéo về đúng khu" lúc tạo KH
// (pull_wrong_zone) mới sinh lệnh kéo — mặc định tắt (hàng để tạm có chủ đích không bị đuổi).
// DÒNG KẾ HOẠCH GOM theo (mã + date): "Mã A date X — N pallet: vị trí 1 → 2", không per-pallet;
// tiến độ x/N suy sống từ vị trí hiện tại của các pallet trong entry_ids.

function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data })
}
function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message } })
}
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function guardWarehouse(req: Request, res: Response, warehouseId: string): boolean {
  if (req.user?.warehouse_scope === 'ASSIGNED') {
    const allowed: string[] = req.user.warehouse_ids ?? []
    if (!allowed.includes(warehouseId)) {
      fail(res, 403, 'FORBIDDEN', 'Kho ngoài phạm vi được phân quyền')
      return false
    }
  }
  return true
}

type Level = 'EASY' | 'NORMAL' | 'HARD'
type Principle = 'FIFO' | 'FEFO' | 'LIFO'
const LEVELS: Level[] = ['EASY', 'NORMAL', 'HARD']
const PRINCIPLES: Principle[] = ['FIFO', 'FEFO', 'LIFO']

// ─── Kiểu dữ liệu từ RPC ─────────────────────────────────────────────────────
interface StatsZone { id: string; code: string; name: string; category: string | null; pick_rank: number | null; flow_type: string | null; capacity: number; used_slots: number }
interface StatsMaterial { material_id: string; code: string; name: string | null; category: string | null; picks: number; cartons_out: number; pallets_touched: number; stock_pallets: number; stock_cartons: number; abc: 'A' | 'B' | 'C'; cum_share: number }
interface StatsPlacement { material_id: string; sub_code: string | null; pallets: number; cartons: number }
// slot_no_in = vị trí KHÔNG đưa hàng vào (kho tạm — không làm đích, hàng ở đó luôn kéo đi)
// slot_no_out = vị trí KHÔNG lấy hàng đi (hàng kẹt — loại khỏi nguồn). Optional: RPC cũ chưa có cột → undefined = false.
interface StatsLocation { id: string; location_code: string; sub_code: string | null; max_pallets: number; used_slots: number; slot_no_in?: boolean; slot_no_out?: boolean }
interface Stats { total_picks: number; materials: StatsMaterial[]; placement: StatsPlacement[]; zones: StatsZone[]; locations: StatsLocation[] }

async function fetchStats(warehouseId: string, categories: string[] | null, days: number): Promise<{ stats?: Stats; notReady?: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('slotting_stats', {
    p_warehouse_id: warehouseId,
    p_categories: categories && categories.length > 0 ? categories : null,
    p_days: days,
  })
  if (error) {
    if (error.code === 'PGRST202' || /slotting_stats/i.test(error.message)) return { notReady: true }
    return { error: error.message }
  }
  return { stats: data as Stats }
}

// ─── Luật khớp hàng ↔ khu (STRICT theo Loại kho — user chốt v3) ─────────────
// Khu có Loại → CHỈ nhận mã đúng Loại (khu SCA chỉ nhận mã loại SCA; mã chưa khai loại KHÔNG vào được).
// Khu chưa gắn Loại → nhận mọi mã (khu đa dụng).
function zoneAccepts(zone: StatsZone, mat: { category: string | null }): boolean {
  return zone.category == null || zone.category === mat.category
}

// ─── Banding khu theo hạng nhặt (chỉ dùng mức HARD) ─────────────────────────
type Band = 'A' | 'B' | 'C'
function eligibleRankedZones(zones: StatsZone[], mat: { category: string | null }): StatsZone[] {
  return zones
    .filter(z => z.pick_rank != null && zoneAccepts(z, mat))
    .sort((a, b) => (a.pick_rank! - b.pick_rank!) || a.code.localeCompare(b.code))
}
function bandOfIndex(idx: number, n: number): Band {
  if (n <= 1) return 'A'
  const f = idx / n
  return f < 1 / 3 ? 'A' : f < 2 / 3 ? 'B' : 'C'
}

interface EnrichedMaterial extends StatsMaterial {
  zones_current: { sub_code: string | null; pallets: number; cartons: number }[]
  suggested_zones: string[]
  misplaced_pallets: number
}
function enrichMaterials(stats: Stats): EnrichedMaterial[] {
  const placementByMat = new Map<string, StatsPlacement[]>()
  for (const p of stats.placement) {
    const arr = placementByMat.get(p.material_id) ?? []
    arr.push(p)
    placementByMat.set(p.material_id, arr)
  }
  return stats.materials.map(mat => {
    const ranked = eligibleRankedZones(stats.zones, mat)
    const bands = new Map<string, Band>()
    ranked.forEach((z, i) => bands.set(z.code, bandOfIndex(i, ranked.length)))
    const placement = (placementByMat.get(mat.material_id) ?? []).sort((a, b) => b.pallets - a.pallets)
    const suggested = ranked.filter(z => bands.get(z.code) === mat.abc).map(z => z.code)
    let misplaced = 0
    for (const p of placement) {
      if (!p.sub_code) continue
      const band = bands.get(p.sub_code)
      if (band && band !== mat.abc) misplaced += p.pallets
    }
    return { ...mat, zones_current: placement.map(p => ({ sub_code: p.sub_code, pallets: p.pallets, cartons: p.cartons })), suggested_zones: suggested, misplaced_pallets: misplaced }
  })
}

// Cảnh báo LOẠI (từ placement — dùng cho GET analysis + preview): pallet nằm ở khu có Loại
// khác Loại của mã (vd hàng thường trong khu SCA, hoặc mã SCA lạc ra khu Thành phẩm).
// CHỈ cảnh báo mặc định; sinh lệnh kéo về = checkbox pull_wrong_zone lúc tạo kế hoạch.
interface CategoryWarning { type: 'WRONG_CATEGORY'; material_code: string; material_name: string | null; material_category: string | null; zone_code: string; zone_category: string; pallets: number }
function categoryWarnings(stats: Stats): CategoryWarning[] {
  const zoneByCode = new Map(stats.zones.map(z => [z.code, z]))
  const matById = new Map(stats.materials.map(m => [m.material_id, m]))
  const out: CategoryWarning[] = []
  for (const p of stats.placement) {
    if (!p.sub_code) continue
    const zone = zoneByCode.get(p.sub_code)
    const mat = matById.get(p.material_id)
    if (!zone || !mat || zone.category == null) continue
    if (zone.category !== mat.category)
      out.push({ type: 'WRONG_CATEGORY', material_code: mat.code, material_name: mat.name, material_category: mat.category, zone_code: zone.code, zone_category: zone.category, pallets: p.pallets })
  }
  return out.sort((a, b) => b.pallets - a.pallets)
}

function parseDays(raw: unknown): number {
  const n = Number(raw ?? 30)
  if (!Number.isFinite(n)) return 30
  return Math.min(365, Math.max(7, Math.round(n)))
}

// GET /wms/slotting?warehouse_id=&categories=a,b&days=30
export async function getSlotting(req: Request, res: Response) {
  try {
    const warehouseId = String(req.query.warehouse_id ?? '')
    if (!warehouseId) return fail(res, 400, 'INVALID_INPUT', 'Thiếu warehouse_id')
    if (!guardWarehouse(req, res, warehouseId)) return
    const scopeCats = scopeCategoriesOf(req)
    const reqCats = req.query.categories ? String(req.query.categories).split(',').filter(Boolean) : []
    const effCats = scopeCats
      ? (reqCats.length > 0 ? reqCats.filter(c => scopeCats.includes(c)) : scopeCats)
      : reqCats
    if (reqCats.length > 0 && effCats.length === 0)
      return fail(res, 403, 'FORBIDDEN', 'Loại kho chọn ngoài phạm vi được phân quyền')
    const days = parseDays(req.query.days)

    const { stats, notReady, error } = await fetchStats(warehouseId, effCats.length > 0 ? effCats : null, days)
    if (notReady) return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260717_slotting + 20260718_slotting_v2 (RPC slotting_stats)')
    if (error || !stats) return fail(res, 500, 'DB_ERROR', error ?? 'RPC không trả dữ liệu')

    const materials = enrichMaterials(stats)
    const hasRanked = stats.zones.some(z => z.pick_rank != null)
    const zones = stats.zones.map(z => {
      // band hiển thị = band trong nhóm khu cùng Loại với chính khu đó
      const ranked = eligibleRankedZones(stats.zones, { category: z.category })
      const idx = ranked.findIndex(r => r.code === z.code)
      return { ...z, band: z.pick_rank != null && idx >= 0 ? bandOfIndex(idx, ranked.length) : null }
    })
    return ok(res, {
      window_days: days, total_picks: stats.total_picks, has_ranked_zones: hasRanked,
      zones, materials, warnings: categoryWarnings(stats),
    })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── Engine sinh gợi ý (preview) ─────────────────────────────────────────────
interface EntryRow { id: string; material_id: string; location_id: string; production_date: string | null; expiry_date: string | null }

// date đại diện theo nguyên tắc: FEFO = HSD (thiếu thì NSX); FIFO/LIFO = NSX
function dateKeyOf(e: EntryRow, principle: Principle): string | null {
  const raw = principle === 'FEFO' ? (e.expiry_date ?? e.production_date) : e.production_date
  return raw ? String(raw).slice(0, 10) : null
}
function flowNote(zone: StatsZone | undefined, principle: Principle): string | null {
  if (!zone?.flow_type) return null
  if (zone.flow_type === 'FLOW_THROUGH') return 'Đưa pallet vào từ ĐẦU NHẬP của dãy'
  // SAME_END: pallet cần lấy trước phải nằm NGOÀI — FIFO/FEFO = date ngắn ngoài; LIFO = date dài ngoài
  return principle === 'LIFO'
    ? 'Xuất nhập cùng 1 đầu — xếp date DÀI ở ngoài cùng (LIFO lấy hàng mới trước)'
    : `Xuất nhập cùng 1 đầu — xếp date NGẮN ở ngoài cùng (${principle} lấy date ngắn trước)`
}

interface PlanLineDraft {
  material_id: string; material_code: string | null; material_name: string | null
  date_key: string | null; n_pallets: number; entry_ids: string[]
  abc: Band | null; reason: string; flow_note: string | null; priority: number; pass: number
  from_location_id: string | null; from_location_code: string | null
  to_location_id: string; to_location_code: string | null
}

// POST /wms/slotting/plans/preview { warehouse_id, level, principle, days, max_moves, pull_wrong_zone?, categories? }
export async function previewPlan(req: Request, res: Response) {
  try {
    const { warehouse_id, level: rawLevel, principle: rawPrinciple, days: rawDays, max_moves, pull_wrong_zone, categories } = req.body as {
      warehouse_id?: string; level?: string; principle?: string; days?: number; max_moves?: number; pull_wrong_zone?: boolean; categories?: string[]
    }
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu warehouse_id')
    if (!guardWarehouse(req, res, warehouse_id)) return
    const level: Level = LEVELS.includes(rawLevel as Level) ? rawLevel as Level : 'NORMAL'
    const principle: Principle = PRINCIPLES.includes(rawPrinciple as Principle) ? rawPrinciple as Principle : 'FEFO'
    const scopeCats = scopeCategoriesOf(req)
    const reqCats = Array.isArray(categories) ? categories.filter(Boolean) : []
    const effCats = scopeCats
      ? (reqCats.length > 0 ? reqCats.filter(c => scopeCats.includes(c)) : scopeCats)
      : reqCats
    // Nguyên tắc (user 18/07): PHẢI chọn Loại kho mới được sinh kế hoạch —
    // kế hoạch đi theo từng loại hàng, không trộn Thành phẩm/Thùng/Raw trong 1 bản
    if (reqCats.length === 0)
      return fail(res, 400, 'CHOOSE_CATEGORY', 'Chọn Loại kho (filter) trước khi sinh kế hoạch sắp xếp')
    if (effCats.length === 0)
      return fail(res, 403, 'FORBIDDEN', 'Loại kho chọn ngoài phạm vi được phân quyền')
    const days = parseDays(rawDays)
    // Trần 500 = khớp trần 500 dòng/kế hoạch (user 18/07: 100 quá thấp — nếu cắt phải BÁO còn bao nhiêu)
    const cap = Math.min(500, Math.max(1, Math.round(Number(max_moves ?? 300)) || 300))

    const { stats, notReady, error } = await fetchStats(warehouse_id, effCats, days)
    if (notReady) return fail(res, 503, 'NOT_READY', 'Chưa apply migration slotting (RPC slotting_stats)')
    if (error || !stats) return fail(res, 500, 'DB_ERROR', error ?? 'RPC không trả dữ liệu')
    if (level === 'HARD' && !stats.zones.some(z => z.pick_rank != null))
      return fail(res, 422, 'NO_RANK', 'Mức Hard cần "Hạng nhặt" của khu — vào Cài đặt WMS → Khu vực xếp hạng (1 = gần cửa xuất nhất), hoặc chọn mức Normal/Easy')

    const matById = new Map(stats.materials.map(m => [m.material_id, m]))
    const locById = new Map(stats.locations.map(l => [l.id, l]))
    const zoneByCode = new Map(stats.zones.map(z => [z.code, z]))
    const zoneOfLoc = (locId: string | null) => {
      const sub = locId ? locById.get(locId)?.sub_code : null
      return sub ? zoneByCode.get(sub) : undefined
    }
    const freeByLoc = new Map<string, number>()
    // Vị trí "không đưa hàng vào" → free = 0: không bao giờ được chọn làm đích ở mọi bước
    for (const l of stats.locations) freeByLoc.set(l.id, l.slot_no_in ? 0 : Math.max(0, l.max_pallets - l.used_slots))

    // Kéo toàn bộ tồn của kho (mọi mã trong scope) — engine gom cần nhìn đủ
    const matIds = stats.materials.map(m => m.material_id)
    const entries: EntryRow[] = []
    // Ảnh chụp "đang chứa gì" per vị trí (trong phạm vi loại đã chọn) — gồm CẢ pallet reserved/kẹt
    // (không được chuyển nhưng vẫn CHIẾM chỗ): dùng cho phân tích kết quả kỳ vọng + cột "Đích đang chứa"
    const rowsAtLoc = new Map<string, EntryRow[]>()
    for (const ids of chunk(matIds, 300)) {
      const rows = await fetchAllRowsParallel(() => supabase
        .from('InventoryEntry')
        .select('id, material_id, location_id, production_date, expiry_date, cartons_reserved')
        .eq('warehouse_id', warehouse_id)
        .in('material_id', ids)
        .in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE'])
        .gt('cartons_remaining', 0)
        .order('id'))
      for (const r of rows) {
        if (r.location_id) {
          const arr = rowsAtLoc.get(r.location_id) ?? []
          arr.push(r)
          rowsAtLoc.set(r.location_id, arr)
        }
        if ((r.cartons_reserved ?? 0) > 0) continue       // đang giữ cho đơn xuất — không xáo trộn
        if (!r.location_id) continue                       // chưa có vị trí — không gợi ý
        if (locById.get(r.location_id)?.slot_no_out) continue  // vị trí không lấy hàng được — loại khỏi nguồn
        entries.push(r)
      }
    }

    // ── Mô phỏng ẢO nhiều lượt (fix hội tụ 18/07 — user test: làm xong vòng 1 mà sinh lại
    // vẫn ra yêu cầu nghĩa là vòng 1 sai). 3 mấu chốt:
    // (a) locOf = vị trí ẢO của pallet, cập nhật khi gán lệnh — các bước sau nhìn thấy trạng thái SAU lệnh trước;
    // (b) pallet đã gán lệnh vẫn làm MỎ NEO nhóm gom (không bốc lại, nhưng được tính "mã đang ở đây");
    // (c) lặp các bước tới khi không sinh thêm lệnh — chỗ trống giải phóng ở nguồn được cộng lại giữa các lượt.
    const locOf = new Map<string, string>()
    for (const e of entries) locOf.set(e.id, e.location_id)
    const zoneOfEntry = (eid: string) => zoneOfLoc(locOf.get(eid) ?? null)

    const draftMap = new Map<string, PlanLineDraft>()
    const movedEntry = new Set<string>()
    // Mỗi pallet rời đi giải phóng đúng 1 chỗ — KHỚP thước đo của RPC move_pallets_to_location
    // (đếm mọi tầng; migration 20260718_slotting_capacity_fix đồng bộ slotting_stats theo cùng thước)
    const movedOutCnt = new Map<string, number>()
    const movedInCnt = new Map<string, number>()
    let pass = 0
    function addMoves(list: EntryRow[], toLoc: StatsLocation, reason: string, priority: number) {
      for (const e of list) {
        const mat = matById.get(e.material_id)!
        const dk = dateKeyOf(e, principle)
        const fromId = locOf.get(e.id)!                    // = vị trí gốc (pallet chỉ được gán lệnh 1 lần)
        const fromLoc = locById.get(fromId)
        // Khóa gộp CÓ pass: lệnh của lượt sau phụ thuộc chỗ trống do lệnh lượt trước giải phóng —
        // gộp chung 1 dòng sẽ tạo lệnh "chuyển N cùng lúc" vượt chỗ trống tại-thời-điểm (test hội tụ 18/07:
        // dòng x23 vào vị trí chỉ trống 19 → LOCATION_FULL). Tách dòng theo lượt = thực hiện được tuần tự.
        const key = `${e.material_id}|${dk ?? ''}|${fromId}|${toLoc.id}|${pass}`
        let d = draftMap.get(key)
        if (!d) {
          d = {
            material_id: e.material_id, material_code: mat.code, material_name: mat.name,
            date_key: dk, n_pallets: 0, entry_ids: [],
            abc: mat.abc, reason, flow_note: flowNote(zoneOfLoc(toLoc.id) ?? zoneByCode.get(toLoc.sub_code ?? ''), principle),
            priority, pass,
            from_location_id: fromId, from_location_code: fromLoc?.location_code ?? null,
            to_location_id: toLoc.id, to_location_code: toLoc.location_code,
          }
          draftMap.set(key, d)
        }
        d.n_pallets++
        d.entry_ids.push(e.id)
        movedEntry.add(e.id)
        movedOutCnt.set(fromId, (movedOutCnt.get(fromId) ?? 0) + 1)
        movedInCnt.set(toLoc.id, (movedInCnt.get(toLoc.id) ?? 0) + 1)
        locOf.set(e.id, toLoc.id)
        freeByLoc.set(toLoc.id, (freeByLoc.get(toLoc.id) ?? 1) - 1)
      }
    }
    // Chọn dãy vị trí đích trong 1 tập khu, rót theo sức chứa còn lại.
    // ƯU TIÊN vị trí ĐANG chứa cùng mã (tránh tự tạo phân mảnh — bài học test hội tụ 18/07),
    // sau đó mới quét theo thứ tự khu (chỗ trống nhiều trước).
    function assignTargets(list: EntryRow[], targetZones: StatsZone[], reason: string, priority: number, matId?: string): number {
      // Hàng đợi rót theo CHIỀU DATE (user 18/07 "date nào xếp vào trước"): FEFO/FIFO date DÀI vào
      // vị trí neo trước (date ngắn tràn ra chỗ phụ để lấy trước); LIFO ngược lại. Không sort →
      // pallet date dài nhất văng vào chỗ tràn phụ = sinh "mỏ neo mới" không hội tụ.
      const queue = list.filter(e => !movedEntry.has(e.id)).sort((a, b) => {
        const da = dateKeyOf(a, principle) ?? '0000', db2 = dateKeyOf(b, principle) ?? '0000'
        if (da === db2) return 0
        return principle === 'LIFO' ? (da < db2 ? -1 : 1) : (da > db2 ? -1 : 1)
      })
      const pour = (locs: StatsLocation[]) => {
        for (const loc of locs) {
          if (queue.length === 0) break
          const free = freeByLoc.get(loc.id) ?? 0
          if (free <= 0) continue
          const take = queue.splice(0, free).filter(e => locOf.get(e.id) !== loc.id)   // không "chuyển" vào chính nó
          addMoves(take, loc, reason, priority)
        }
      }
      if (matId) {
        // Thứ tự rót cùng-mã = ĐÚNG thứ tự mỏ neo của bước gom P3 (FEFO/FIFO: date dài nhất trước;
        // LIFO: date ngắn nhất; EASY: đông pallet nhất) — rót lệch mỏ neo thì P3 vòng sau muốn dồn tiếp
        // nhưng pallet đã đi 1 lần không đi lần 2 → dư việc sang kế hoạch sau (test hội tụ 18/07 còn 15 dòng)
        const zoneOk = new Set(targetZones.map(z => z.code))
        const byLoc = new Map<string, EntryRow[]>()
        for (const e of entries) {
          if (e.material_id !== matId) continue
          const lid = locOf.get(e.id)!
          const arr = byLoc.get(lid) ?? []
          arr.push(e)
          byLoc.set(lid, arr)
        }
        const anchorStats = [...byLoc.entries()].map(([lid, list]) => {
          const dates = list.map(e => dateKeyOf(e, principle)).filter(Boolean) as string[]
          return {
            loc: locById.get(lid),
            n: list.length,
            minDate: dates.length ? dates.reduce((a, b) => a < b ? a : b) : '9999',
            maxDate: dates.length ? dates.reduce((a, b) => a > b ? a : b) : '0000',
          }
        })
        pour(anchorStats
          .filter((s): s is typeof s & { loc: StatsLocation } =>
            !!s.loc && !!s.loc.sub_code && zoneOk.has(s.loc.sub_code) && (freeByLoc.get(s.loc.id) ?? 0) > 0)
          .sort((a, b) => {
            if (level !== 'EASY') {
              if (principle === 'LIFO') { if (a.minDate !== b.minDate) return a.minDate < b.minDate ? -1 : 1 }
              else { if (a.maxDate !== b.maxDate) return a.maxDate > b.maxDate ? -1 : 1 }
            }
            return (b.n - a.n) || a.loc.location_code.localeCompare(b.loc.location_code)
          })
          .map(s => s.loc))
      }
      for (const z of targetZones) {
        if (queue.length === 0) break
        pour(stats!.locations
          .filter(l => l.sub_code === z.code && (freeByLoc.get(l.id) ?? 0) > 0)
          .sort((a, b) => (freeByLoc.get(b.id)! - freeByLoc.get(a.id)!) || a.location_code.localeCompare(b.location_code)))
      }
      return queue.length
    }

    let skippedNoCapacity = 0

    // Pallet nằm SAI LOẠI khu: mặc định ĐÓNG BĂNG (chỉ cảnh báo — hàng để tạm có chủ đích
    // không bị đuổi); pull_wrong_zone=true → P0 kéo về khu đúng Loại (ưu tiên cao nhất).
    const frozen = new Set<string>()
    for (const e of entries) {
      const z = zoneOfLoc(e.location_id)
      const mat = matById.get(e.material_id)
      if (z?.category != null && mat && z.category !== mat.category) frozen.add(e.id)
    }

    const homeZonesOf = (mat: StatsMaterial) => stats!.zones
      .filter(z => zoneAccepts(z, mat))
      .sort((a, b) => ((a.pick_rank ?? 9999) - (b.pick_rank ?? 9999)) || a.code.localeCompare(b.code))

    // Vòng lặp mô phỏng: mỗi lượt tính lại chỗ trống ẢO (đã cộng slot giải phóng ở nguồn),
    // chạy đủ các bước; dừng khi không sinh thêm lệnh nào (đã hội tụ). Trần 20 chỉ là chốt an toàn —
    // thực tế hội tụ sau vài lượt (test 18/07: trần 4 → dư 15 dòng, trần 6 → dư 7; đừng hạ lại).
    let prevDrafts = -1
    for (pass = 0; pass < 20 && draftMap.size !== prevDrafts; pass++) {
      prevDrafts = draftMap.size
      skippedNoCapacity = 0   // chỉ giữ số của lượt cuối (lượt sau đã xử được phần lượt trước bỏ)
      for (const l of stats.locations) {
        freeByLoc.set(l.id, l.slot_no_in ? 0
          : Math.max(0, Math.max(0, l.max_pallets - l.used_slots) + (movedOutCnt.get(l.id) ?? 0) - (movedInCnt.get(l.id) ?? 0)))
      }

      // ── P0 (checkbox): kéo pallet sai loại khu về khu đúng Loại
      if (pull_wrong_zone) {
        const wrongByMat = new Map<string, EntryRow[]>()
        for (const e of entries) {
          if (!frozen.has(e.id) || movedEntry.has(e.id)) continue
          const arr = wrongByMat.get(e.material_id) ?? []
          arr.push(e)
          wrongByMat.set(e.material_id, arr)
        }
        for (const [mid, list] of wrongByMat) {
          const mat = matById.get(mid)!
          const homeZones = homeZonesOf(mat)
          if (homeZones.length === 0) continue             // kho không có khu nào nhận loại này
          skippedNoCapacity += assignTargets(list, homeZones,
            `Nằm sai loại khu — kéo về khu ${mat.category ?? 'đúng loại'}`, 0, mid)
          for (const e of list) if (movedEntry.has(e.id)) frozen.delete(e.id)
        }
      }

      // ── P1: VỊ TRÍ KHÔNG ĐƯA HÀNG VÀO (kho tạm) — hàng nằm đó LUÔN bị kéo đi
      {
        const tempByMat = new Map<string, EntryRow[]>()
        for (const e of entries) {
          if (movedEntry.has(e.id)) continue
          if (!locById.get(locOf.get(e.id)!)?.slot_no_in) continue
          const arr = tempByMat.get(e.material_id) ?? []
          arr.push(e)
          tempByMat.set(e.material_id, arr)
        }
        for (const [mid, list] of tempByMat) {
          const mat = matById.get(mid)!
          const homeZones = homeZonesOf(mat)
          if (homeZones.length === 0) continue
          skippedNoCapacity += assignTargets(list, homeZones, 'Vị trí tạm (không chứa hàng) — kéo hàng đi', 1, mid)
          for (const e of list) if (movedEntry.has(e.id)) frozen.delete(e.id)
        }
      }

      // ── P2 (chỉ HARD): đảo khu theo ABC velocity
      if (level === 'HARD') {
        interface Cand { e: EntryRow; mat: StatsMaterial; prio: number }
        const cands: Cand[] = []
        for (const e of entries) {
          if (movedEntry.has(e.id) || frozen.has(e.id)) continue
          const mat = matById.get(e.material_id)
          if (!mat) continue
          const ranked = eligibleRankedZones(stats.zones, mat)
          if (ranked.length === 0) continue
          const bands = new Map<string, Band>()
          ranked.forEach((z, i) => bands.set(z.code, bandOfIndex(i, ranked.length)))
          const z = zoneOfEntry(e.id)
          const band = z ? bands.get(z.code) : undefined
          if (!band || band === mat.abc) continue
          const prio =
            mat.abc === 'A' && band === 'C' ? 1 :
            mat.abc === 'A' && band === 'B' ? 2 :
            mat.abc === 'C' && band === 'A' ? 3 :
            mat.abc === 'C' && band === 'B' ? 4 : 5
          cands.push({ e, mat, prio })
        }
        cands.sort((a, b) => (a.prio - b.prio) || (b.mat.picks - a.mat.picks))
        // gán theo từng mã để giữ nhóm gọn
        const byMat = new Map<string, Cand[]>()
        for (const c of cands) {
          const arr = byMat.get(c.e.material_id) ?? []
          arr.push(c)
          byMat.set(c.e.material_id, arr)
        }
        for (const [mid, list] of byMat) {
          const mat = matById.get(mid)!
          const ranked = eligibleRankedZones(stats.zones, mat)
          const bands = new Map<string, Band>()
          ranked.forEach((z, i) => bands.set(z.code, bandOfIndex(i, ranked.length)))
          const targetZones = ranked.filter(z => bands.get(z.code) === mat.abc)
          const reason = mat.abc === 'A'
            ? 'Mã nhặt nhiều (A) đang ở khu xa cửa — đưa về khu gần cửa'
            : mat.abc === 'C' ? 'Mã nhặt ít (C) chiếm khu gần cửa — chuyển ra khu xa'
            : 'Mã hạng B lệch khu'
          skippedNoCapacity += assignTargets(list.map(c => c.e), targetZones, reason, 2, mid)
        }
      }

      // ── P3/P4: GOM trong-cùng-mã (mọi mức; NORMAL/HARD thêm hướng theo date).
      // Nhóm theo vị trí ẢO của TẤT CẢ pallet của mã — pallet đã gán lệnh vẫn là MỎ NEO
      // (đích nhận thêm), chỉ pallet CHƯA gán lệnh mới được bốc đi.
      for (const mat of stats.materials) {
        const all = entries.filter(e => e.material_id === mat.material_id && !frozen.has(e.id)
          && (() => { const z = zoneOfEntry(e.id); return z ? zoneAccepts(z, mat) : false })())
        if (all.length === 0) continue
        const byLoc = new Map<string, EntryRow[]>()
        for (const e of all) {
          const lid = locOf.get(e.id)!
          const arr = byLoc.get(lid) ?? []
          arr.push(e)
          byLoc.set(lid, arr)
        }
        if (byLoc.size <= 1) continue

        interface LocGroup { loc: StatsLocation; movable: EntryRow[]; minDate: string; maxDate: string }
        const groups: LocGroup[] = []
        for (const [locId, list] of byLoc) {
          const loc = locById.get(locId)
          if (!loc) continue
          const dates = list.map(e => dateKeyOf(e, principle)).filter(Boolean) as string[]
          groups.push({
            loc, movable: list.filter(e => !movedEntry.has(e.id)),
            minDate: dates.length ? dates.reduce((a, b) => a < b ? a : b) : '9999',
            maxDate: dates.length ? dates.reduce((a, b) => a > b ? a : b) : '0000',
          })
        }
        if (groups.length <= 1 || !groups.some(g => g.movable.length > 0)) continue

        const useDate = level !== 'EASY' && groups.some(g => g.minDate !== '9999')
        // anchors[0] = vị trí NHẬN (đích); cuối mảng = nguồn bốc đi trước
        // LIFO: đích = vị trí chứa date NGẮN nhất (dồn date dài vào) · FIFO/FEFO: đích = chứa date DÀI nhất
        const anchors = [...groups].sort((a, b) => {
          if (useDate) {
            if (principle === 'LIFO') { if (a.minDate !== b.minDate) return a.minDate < b.minDate ? -1 : 1 }
            else { if (a.maxDate !== b.maxDate) return a.maxDate > b.maxDate ? -1 : 1 }
          }
          return b.movable.length - a.movable.length
        })
        const reason = !useDate
          ? 'Gom mã về ít vị trí — giải phóng chỗ'
          : principle === 'LIFO' ? 'Dồn date dài vào vị trí chứa date ngắn (LIFO)'
          : principle === 'FEFO' ? 'Dồn date ngắn (theo HSD) vào vị trí chứa date dài (FEFO)'
          : 'Dồn date ngắn vào vị trí chứa date dài (FIFO)'
        const priority = useDate ? 3 : 4

        // Nhóm nguồn tiêu thụ từ XA đích nhất trước (si từ cuối lên — ĐÃ thử "nhóm liền kề trước"
        // 18/07: kết quả TỆ hơn, dư 21 dòng vs 7 — đừng đổi lại). Trong nhóm bốc pallet có date
        // GẦN đích nhất trước (FEFO/FIFO: date dài trước; LIFO: date ngắn trước) — bốc date xa trước
        // làm ĐẢO tầng date (date ngắn leo lên neo dài, date dài kẹt lại → vòng sau phải xếp lại).
        let ti = 0, si = anchors.length - 1
        while (si > ti) {
          const tgt = anchors[ti], src = anchors[si]
          if (src.movable.length === 0) { si--; continue }   // nguồn chỉ còn pallet mỏ neo — bỏ qua
          const free = freeByLoc.get(tgt.loc.id) ?? 0
          if (free <= 0) { ti++; continue }
          const ordered = [...src.movable].sort((a, b) => {
            const da = dateKeyOf(a, principle) ?? '0000', db2 = dateKeyOf(b, principle) ?? '0000'
            return principle === 'LIFO' ? (da < db2 ? -1 : da > db2 ? 1 : 0) : (da > db2 ? -1 : da < db2 ? 1 : 0)
          })
          const take = ordered.slice(0, free)
          addMoves(take, tgt.loc, reason, priority)
          src.movable = src.movable.filter(e => !movedEntry.has(e.id))
          if (src.movable.length === 0) si--
          else ti++
        }
      }
    }

    // Chốt danh sách — thứ tự dòng = THỨ TỰ THỰC HIỆN (trên xuống):
    // 1) LƯỢT mô phỏng trước (lệnh lượt sau cần chỗ do lệnh lượt trước giải phóng — trong 1 lượt thì
    //    đảo thứ tự vẫn an toàn vì engine không tính chỗ giải-phóng-trong-lượt);
    // 2) trong lượt: gom CÙNG MÃ cạnh nhau → cùng VỊ TRÍ ĐÍCH liền nhau (user 18/07);
    // 3) cùng đích nhiều date: dòng XẾP VÀO TRƯỚC nằm trên — FEFO/FIFO: date DÀI vào trước (vào sâu,
    //    date ngắn nằm ngoài lấy trước); LIFO: date NGẮN vào trước.
    // KHÔNG cắt âm thầm: trả total_generated để FE báo "còn M dòng chưa hiện".
    const dateIn = (a: PlanLineDraft, b: PlanLineDraft) => {
      const da = a.date_key ?? '', db2 = b.date_key ?? ''
      if (da === db2) return 0
      if (!da) return 1
      if (!db2) return -1
      return principle === 'LIFO' ? (da < db2 ? -1 : 1) : (da > db2 ? -1 : 1)
    }
    const totalGenerated = draftMap.size
    const lines = [...draftMap.values()]
      .sort((a, b) => (a.pass - b.pass)
        || (a.material_code ?? '').localeCompare(b.material_code ?? '')
        || (a.to_location_code ?? '').localeCompare(b.to_location_code ?? '')
        || dateIn(a, b)
        || (a.priority - b.priority))
      .slice(0, cap)

    // ── Phân tích kết quả kỳ vọng (user 18/07: "biết làm nhưng chưa biết đúng sai") ──
    // Tính trên danh sách dòng ĐÃ CẮT trần (đúng những gì sẽ vào kế hoạch).
    const movedOutByLoc = new Map<string, number>()
    const movedInByLoc = new Map<string, number>()
    for (const l of lines) {
      if (l.from_location_id) movedOutByLoc.set(l.from_location_id, (movedOutByLoc.get(l.from_location_id) ?? 0) + l.n_pallets)
      movedInByLoc.set(l.to_location_id, (movedInByLoc.get(l.to_location_id) ?? 0) + l.n_pallets)
    }
    // Vị trí được GIẢI PHÓNG HOÀN TOÀN: mọi pallet đang nằm đó đều chuyển đi + không có pallet nào chuyển đến
    const freedCodes: string[] = []
    for (const [locId, rows] of rowsAtLoc) {
      if (rows.length > 0 && (movedOutByLoc.get(locId) ?? 0) === rows.length && (movedInByLoc.get(locId) ?? 0) === 0)
        freedCodes.push(locById.get(locId)?.location_code ?? '?')
    }
    freedCodes.sort()
    const palletsByPrio = (p: number) => lines.filter(l => l.priority === p).reduce((s, l) => s + l.n_pallets, 0)
    const impact = {
      lines: lines.length,
      moved_pallets: lines.reduce((s, l) => s + l.n_pallets, 0),
      freed_locations: freedCodes.length,
      freed_location_codes: freedCodes.slice(0, 30),
      wrong_zone_pallets: palletsByPrio(0),   // kéo về đúng loại khu (P0)
      temp_cleared_pallets: palletsByPrio(1), // dọn khỏi vị trí tạm (P1)
      abc_pallets: palletsByPrio(2),          // đảo khu theo ABC (HARD)
      date_group_pallets: palletsByPrio(3),   // gom theo date (NORMAL/HARD)
      free_group_pallets: palletsByPrio(4),   // gom giải phóng chỗ (EASY)
    }
    // Mô tả vị trí đích ĐANG chứa gì (trước khi chuyển) — để user tự soi gợi ý đúng/sai
    const describeLoc = (locId: string, materialId: string): string => {
      const rows = rowsAtLoc.get(locId) ?? []
      if (rows.length === 0) return 'Trống'
      const same = rows.filter(r => r.material_id === materialId)
      const parts: string[] = []
      if (same.length > 0) {
        const dates = same.map(e => dateKeyOf(e, principle)).filter(Boolean).sort() as string[]
        const dr = dates.length === 0 ? ''
          : dates[0] === dates[dates.length - 1] ? ` (date ${dates[0]})` : ` (date ${dates[0]} → ${dates[dates.length - 1]})`
        parts.push(`${same.length} pallet cùng mã${dr}`)
      }
      const other = rows.length - same.length
      if (other > 0) {
        const nMats = new Set(rows.filter(r => r.material_id !== materialId).map(r => r.material_id)).size
        parts.push(`${other} pallet ${nMats} mã khác`)
      }
      return parts.join(' + ')
    }

    return ok(res, {
      level, principle,
      lines: lines.map(({ priority: _p, pass: _pass, ...rest }) => ({
        ...rest,
        to_current: describeLoc(rest.to_location_id, rest.material_id),
        // Chỗ trống còn lại ở đích SAU khi thực hiện kế hoạch (freeByLoc đã trừ dần khi gán)
        to_free_after: Math.max(0, freeByLoc.get(rest.to_location_id) ?? 0),
      })),
      impact,
      total_generated: totalGenerated,
      skipped_no_capacity: skippedNoCapacity,
      warnings: pull_wrong_zone ? [] : categoryWarnings(stats),
      message: lines.length === 0 ? 'Không có gì cần sắp xếp theo mức độ/nguyên tắc đã chọn' : undefined,
    })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// POST /wms/slotting/plans { warehouse_id, name, level, principle, window_days?, note?, lines: [...] }
export async function createPlan(req: Request, res: Response) {
  try {
    const { warehouse_id, name, level, principle, window_days, note, lines } = req.body as {
      warehouse_id?: string; name?: string; level?: string; principle?: string
      window_days?: number; note?: string
      lines?: { material_id: string; material_code?: string | null; material_name?: string | null; date_key?: string | null; n_pallets: number; entry_ids: string[]; abc?: string | null; reason?: string; flow_note?: string | null; from_location_id?: string | null; from_location_code?: string | null; to_location_id: string; to_location_code?: string | null }[]
    }
    if (!warehouse_id || !name?.trim()) return fail(res, 400, 'INVALID_INPUT', 'Thiếu warehouse_id hoặc tên kế hoạch')
    if (!Array.isArray(lines) || lines.length === 0) return fail(res, 400, 'INVALID_INPUT', 'Kế hoạch phải có ít nhất 1 dòng chuyển')
    if (lines.length > 500) return fail(res, 400, 'INVALID_INPUT', 'Tối đa 500 dòng / kế hoạch — chia thành nhiều kế hoạch nhỏ')
    if (lines.some(l => !l.material_id || !l.to_location_id || !Array.isArray(l.entry_ids) || l.entry_ids.length === 0))
      return fail(res, 400, 'INVALID_INPUT', 'Dòng chuyển thiếu mã hàng / vị trí đích / danh sách pallet')
    if (!guardWarehouse(req, res, warehouse_id)) return

    const now = new Date().toISOString()
    const planId = randomUUID()
    const actor = req.user?.name ?? null
    const { error: planErr } = await supabase.from('SlottingPlan').insert({
      id: planId, warehouse_id, name: name.trim(), status: 'ACTIVE',
      level: LEVELS.includes(level as Level) ? level : null,
      principle: PRINCIPLES.includes(principle as Principle) ? principle : null,
      note: note?.trim() || null, window_days: window_days ?? null, n_lines: lines.length,
      created_by: actor, updated_by: actor, updated_at: now,
    })
    if (planErr) return fail(res, 500, 'DB_ERROR', planErr.message)

    const rows = lines.map(l => ({
      id: randomUUID(), plan_id: planId,
      material_id: l.material_id, material_code: l.material_code ?? null, material_name: l.material_name ?? null,
      date_key: l.date_key ?? null, n_pallets: l.entry_ids.length, entry_ids: l.entry_ids,
      abc: l.abc ?? null, reason: l.reason ?? null, flow_note: l.flow_note ?? null,
      from_location_id: l.from_location_id ?? null, from_location_code: l.from_location_code ?? null,
      to_location_id: l.to_location_id, to_location_code: l.to_location_code ?? null,
      updated_at: now,
    }))
    for (const c of chunk(rows, 500)) {
      const { error: lineErr } = await supabase.from('SlottingPlanLine').insert(c)
      if (lineErr) {
        await supabase.from('SlottingPlan').delete().eq('id', planId)
        return fail(res, 500, 'DB_ERROR', `Ghi dòng kế hoạch thất bại: ${lineErr.message}`)
      }
    }
    return ok(res, { id: planId, n_lines: lines.length })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── Tiến độ dòng gom: đếm pallet theo vị trí hiện tại ───────────────────────
type LineStatus = 'PENDING' | 'PARTIAL' | 'DONE' | 'GONE'
interface LineWithStatus {
  id: string; material_code: string | null; material_name: string | null; date_key: string | null
  abc: string | null; reason: string | null; flow_note: string | null
  from_location_code: string | null; to_location_code: string | null; to_location_id: string
  n_pallets: number
  status: LineStatus
  done: number; pending: number; moved_other: number; gone: number
  moved_at: string | null; moved_by_name: string | null
}
interface RawLine {
  id: string; material_id: string; material_code: string | null; material_name: string | null
  date_key: string | null; n_pallets: number; entry_ids: string[]
  abc: string | null; reason: string | null; flow_note: string | null
  from_location_id: string | null; from_location_code: string | null
  to_location_id: string; to_location_code: string | null
}
async function deriveLineStatuses(lines: RawLine[]): Promise<LineWithStatus[]> {
  const allIds = [...new Set(lines.flatMap(l => Array.isArray(l.entry_ids) ? l.entry_ids : []))]
  const entryMap = new Map<string, { location_id: string | null; status: string; cartons_remaining: number; updated_at: string | null; updated_by: string | null }>()
  for (const ids of chunk(allIds, 300)) {
    const { data } = await supabase.from('InventoryEntry')
      .select('id, location_id, status, cartons_remaining, updated_at, updated_by')
      .in('id', ids)
    for (const e of data ?? []) entryMap.set(e.id, e)
  }
  const empIds = [...new Set([...entryMap.values()].map(e => e.updated_by).filter(v => v && /^[0-9a-f-]{36}$/i.test(v)))] as string[]
  const empMap = new Map<string, string>()
  for (const ids of chunk(empIds, 300)) {
    const { data } = await supabase.from('Employee').select('id, name').in('id', ids)
    for (const e of data ?? []) empMap.set(e.id, e.name)
  }
  return lines.map(l => {
    let done = 0, pending = 0, movedOther = 0, gone = 0
    let lastAt: string | null = null, lastBy: string | null = null
    for (const eid of (l.entry_ids ?? [])) {
      const e = entryMap.get(eid)
      if (!e || Number(e.cartons_remaining) <= 0 || e.status === 'EXPORTED') { gone++; continue }
      if (e.location_id === l.to_location_id) {
        done++
        if (e.updated_at && (!lastAt || e.updated_at > lastAt)) { lastAt = e.updated_at; lastBy = e.updated_by ? (empMap.get(e.updated_by) ?? null) : null }
      }
      else if (e.location_id === l.from_location_id) pending++
      else movedOther++
    }
    const total = (l.entry_ids ?? []).length
    const status: LineStatus =
      gone === total ? 'GONE'
      : done + gone === total ? 'DONE'
      : done + movedOther === 0 ? 'PENDING'
      : 'PARTIAL'
    return {
      id: l.id, material_code: l.material_code, material_name: l.material_name, date_key: l.date_key,
      abc: l.abc, reason: l.reason, flow_note: l.flow_note,
      from_location_code: l.from_location_code, to_location_code: l.to_location_code, to_location_id: l.to_location_id,
      n_pallets: total, status, done, pending, moved_other: movedOther, gone,
      moved_at: lastAt, moved_by_name: lastBy,
    }
  })
}

const LINE_SELECT = 'id, material_id, material_code, material_name, date_key, n_pallets, entry_ids, abc, reason, flow_note, from_location_id, from_location_code, to_location_id, to_location_code'

// GET /wms/slotting/plans?warehouse_id=
export async function listPlans(req: Request, res: Response) {
  try {
    let query = supabase.from('SlottingPlan')
      .select('id, warehouse_id, name, status, level, principle, note, window_days, n_lines, created_by, created_at, completed_at, completed_by, updated_at')
      .order('created_at', { ascending: false })
      .limit(200)
    const warehouseId = req.query.warehouse_id ? String(req.query.warehouse_id) : null
    if (warehouseId) {
      if (!guardWarehouse(req, res, warehouseId)) return
      query = query.eq('warehouse_id', warehouseId)
    } else if (req.user?.warehouse_scope === 'ASSIGNED') {
      const allowed: string[] = req.user.warehouse_ids ?? []
      if (allowed.length === 0) return ok(res, [])
      query = query.in('warehouse_id', allowed)
    }
    const { data: plans, error } = await query
    if (error) return fail(res, 500, 'DB_ERROR', error.message)

    // Tiến độ sống chỉ tính cho plan ACTIVE (ít) — plan đã đóng hiển thị n_lines tĩnh
    const active = (plans ?? []).filter(p => p.status === 'ACTIVE')
    const progress = new Map<string, { done_pallets: number; total_pallets: number; done_lines: number; total_lines: number }>()
    for (const p of active) {
      const lines = await fetchAllRowsParallel(() => supabase.from('SlottingPlanLine')
        .select(LINE_SELECT).eq('plan_id', p.id).order('id'))
      const withStatus = await deriveLineStatuses(lines)
      progress.set(p.id, {
        done_pallets: withStatus.reduce((s, l) => s + l.done + l.gone, 0),
        total_pallets: withStatus.reduce((s, l) => s + l.n_pallets, 0),
        done_lines: withStatus.filter(l => l.status === 'DONE' || l.status === 'GONE').length,
        total_lines: withStatus.length,
      })
    }
    return ok(res, (plans ?? []).map(p => ({ ...p, progress: progress.get(p.id) ?? null })))
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// GET /wms/slotting/plans/:id
export async function getPlan(req: Request, res: Response) {
  try {
    const { data: plan } = await supabase.from('SlottingPlan')
      .select('id, warehouse_id, name, status, level, principle, note, window_days, n_lines, created_by, created_at, completed_at, completed_by, updated_at')
      .eq('id', req.params.id).maybeSingle()
    if (!plan) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kế hoạch')
    if (!guardWarehouse(req, res, plan.warehouse_id)) return

    const lines = await fetchAllRowsParallel(() => supabase.from('SlottingPlanLine')
      .select(LINE_SELECT).eq('plan_id', plan.id).order('id'))
    const withStatus = await deriveLineStatuses(lines)
    const summary = {
      total_lines: withStatus.length,
      done_lines: withStatus.filter(l => l.status === 'DONE' || l.status === 'GONE').length,
      partial_lines: withStatus.filter(l => l.status === 'PARTIAL').length,
      pending_lines: withStatus.filter(l => l.status === 'PENDING').length,
      total_pallets: withStatus.reduce((s, l) => s + l.n_pallets, 0),
      done_pallets: withStatus.reduce((s, l) => s + l.done, 0),
      gone_pallets: withStatus.reduce((s, l) => s + l.gone, 0),
      moved_other_pallets: withStatus.reduce((s, l) => s + l.moved_other, 0),
      pending_pallets: withStatus.reduce((s, l) => s + l.pending, 0),
    }
    return ok(res, { ...plan, summary, lines: withStatus })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// PATCH /wms/slotting/plans/:id { status: 'COMPLETED' | 'CANCELLED' | 'ACTIVE' }
export async function updatePlan(req: Request, res: Response) {
  try {
    const { status } = req.body as { status?: string }
    if (!status || !['COMPLETED', 'CANCELLED', 'ACTIVE'].includes(status))
      return fail(res, 400, 'INVALID_INPUT', 'status phải là COMPLETED / CANCELLED / ACTIVE')
    const { data: plan } = await supabase.from('SlottingPlan')
      .select('id, warehouse_id, status').eq('id', req.params.id).maybeSingle()
    if (!plan) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kế hoạch')
    if (!guardWarehouse(req, res, plan.warehouse_id)) return

    const now = new Date().toISOString()
    const actor = req.user?.name ?? null
    const patch: Record<string, unknown> = { status, updated_at: now, updated_by: actor }
    if (status === 'COMPLETED' || status === 'CANCELLED') { patch.completed_at = now; patch.completed_by = actor }
    else { patch.completed_at = null; patch.completed_by = null }
    const { error } = await supabase.from('SlottingPlan').update(patch).eq('id', plan.id)
    if (error) return fail(res, 500, 'DB_ERROR', error.message)
    return ok(res, { id: plan.id, status })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// PATCH /wms/slotting/zone-config/:id { pick_rank?, flow_type? } — cấu hình slotting của KHU
// (tab Cài đặt trang Tối ưu vị trí, quyền slotting.configure). Route RIÊNG, không đi ké
// PUT /wms/zones (quyền manage_zone sửa tên/loại khu) — tránh gộp quyền.
export async function updateZoneConfig(req: Request, res: Response) {
  try {
    const { pick_rank, flow_type } = req.body as { pick_rank?: number | null; flow_type?: string | null }
    const { data: zone } = await supabase.from('WarehouseZone')
      .select('id, warehouse_id').eq('id', req.params.id).maybeSingle()
    if (!zone) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy khu vực')
    if (!guardWarehouse(req, res, zone.warehouse_id)) return

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: req.user?.name ?? null }
    if (pick_rank !== undefined) {
      const n = pick_rank === null ? null : Number(pick_rank)
      if (n !== null && (!Number.isInteger(n) || n < 1 || n > 999))
        return fail(res, 400, 'INVALID_INPUT', 'Hạng nhặt phải là số nguyên 1–999 (hoặc trống)')
      patch.pick_rank = n
    }
    if (flow_type !== undefined) {
      if (flow_type !== null && !['SAME_END', 'FLOW_THROUGH'].includes(flow_type))
        return fail(res, 400, 'INVALID_INPUT', 'flow_type phải là SAME_END / FLOW_THROUGH / null')
      patch.flow_type = flow_type
    }
    const { data, error } = await supabase.from('WarehouseZone').update(patch).eq('id', zone.id)
      .select('id, code, name, category, pick_rank, flow_type').single()
    if (error) return fail(res, 500, 'DB_ERROR', error.message)
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// PUT /wms/slotting/location-config { warehouse_id, no_in_ids: string[], no_out_ids: string[] }
// Cấu hình VỊ TRÍ (tab Cài đặt): replace-all 2 danh sách per kho —
// no_in = vị trí KHÔNG đưa hàng vào (kho tạm); no_out = vị trí KHÔNG lấy hàng đi.
export async function updateLocationConfig(req: Request, res: Response) {
  try {
    const { warehouse_id, no_in_ids, no_out_ids } = req.body as {
      warehouse_id?: string; no_in_ids?: string[]; no_out_ids?: string[]
    }
    if (!warehouse_id || !Array.isArray(no_in_ids) || !Array.isArray(no_out_ids))
      return fail(res, 400, 'INVALID_INPUT', 'Thiếu warehouse_id / no_in_ids / no_out_ids')
    if (!guardWarehouse(req, res, warehouse_id)) return

    // Chỉ nhận id vị trí THUỘC kho này (chống gán chéo kho)
    const valid = new Set<string>(
      (await fetchAllRowsParallel(() => supabase.from('Location')
        .select('id').eq('warehouse_id', warehouse_id).order('id'))).map((l: { id: string }) => l.id))
    const inIds = [...new Set(no_in_ids)].filter(id => valid.has(id))
    const outIds = [...new Set(no_out_ids)].filter(id => valid.has(id))

    const now = new Date().toISOString()
    // Reset cả kho về false rồi bật lại theo danh sách (replace-all, khớp UI multi-select)
    const { error: resetErr } = await supabase.from('Location')
      .update({ slot_no_in: false, slot_no_out: false, updated_at: now })
      .eq('warehouse_id', warehouse_id)
    if (resetErr) {
      if (/slot_no_in|slot_no_out/.test(resetErr.message))
        return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260718_slotting_locations')
      return fail(res, 500, 'DB_ERROR', resetErr.message)
    }
    for (const ids of chunk(inIds, 300)) {
      const { error } = await supabase.from('Location').update({ slot_no_in: true, updated_at: now }).in('id', ids)
      if (error) return fail(res, 500, 'DB_ERROR', error.message)
    }
    for (const ids of chunk(outIds, 300)) {
      const { error } = await supabase.from('Location').update({ slot_no_out: true, updated_at: now }).in('id', ids)
      if (error) return fail(res, 500, 'DB_ERROR', error.message)
    }
    return ok(res, { no_in: inIds.length, no_out: outIds.length })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// DELETE /wms/slotting/plans/:id — cascade lines
export async function deletePlan(req: Request, res: Response) {
  try {
    const { data: plan } = await supabase.from('SlottingPlan')
      .select('id, warehouse_id').eq('id', req.params.id).maybeSingle()
    if (!plan) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kế hoạch')
    if (!guardWarehouse(req, res, plan.warehouse_id)) return
    const { error } = await supabase.from('SlottingPlan').delete().eq('id', plan.id)
    if (error) return fail(res, 500, 'DB_ERROR', error.message)
    return ok(res, { id: plan.id })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}
