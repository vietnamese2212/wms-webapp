import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { maskServerMessage } from '../../utils/response'
import { scopeCategoriesOf } from '../../utils/categoryScope'
import { safeFilterValue } from '../../utils/search'
import { normalizeQR } from '../../utils/qrParser'
import { parseListParam } from '../../utils/httpQuery'
import { computePctDate } from '../../utils/shelfLife'
import { notifyEmployees } from '../../services/pushService'
import { rotationConfigOf } from './outboundController'
import { availableOf, isPickEligible, rotationSortKey, type RotationEntry } from '../../utils/rotation'
import { type MaterialShelfInfo } from '../../utils/shelfLife'
import { qaHoldIds } from '../../services/qaStatus'
import { fetchAllByIdChunks, fetchAllRowsParallel, isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { dateRuleOf, palletMeetsDateRule, type DateRule } from '../../services/directedTasks'

// ─── FILL HÀNG PHỤC VỤ NHẶT LẺ (v3 — user chốt 05/08) ───────────────────────
// Nhặt lẻ lấy hàng bằng TAY ⇒ hàng phải nằm ở "vị trí nhặt lẻ" (cờ Location.is_pick_face).
//
// Mô hình lệnh (đổi 05/08): LỆNH KHÔNG GHIM PALLET — chỉ định theo DATE.
//   · "FillOrder" = MỘT lần Ra lệnh fill (gom nhiều mã), mở ra mới thấy chi tiết.
//   · "FillTask"  = MỘT DÒNG của lệnh: mã hàng + NSX yêu cầu (required_date, kèm required_expiry
//     để hiện %Date) + SL cần hạ + số pallet + vị trí đích. Xe nâng lấy pallet NÀO CŨNG ĐƯỢC
//     miễn ĐÚNG MÃ + ĐÚNG DATE, từ tầng trên (ngoài vị trí nhặt lẻ), không đụng hàng block.
//   · "FillTaskScan" = vết từng pallet đã quét (ai, tem nào, từ đâu về đâu, bao nhiêu).
//
// THỰC HIỆN = QUÉT TEM 2 bước: preview (khớp dòng lệnh + soi đích, ĐƯỢC ĐỔI vị trí đến ngay
// trong màn quét) → commit chạy RPC `fill_scan_apply` MỘT transaction (khoá dòng lệnh → kiểm
// mã/date/nguồn → move_pallets_to_location khoá sức chứa → ghi vết → cộng tiến độ → chốt DONE).
// Vì sao 1 RPC: 2 câu qua PostgREST là 2 transaction — đúng lớp lỗi "ghi tồn + log không nguyên
// tử dưới 504" đã dính 23/07.

function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data })
}
function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message: maskServerMessage(message, status, res) } })
}

const now = () => new Date().toISOString()
const vnToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Regex chỉ kiểm ĐỊNH DẠNG — '2026-13-99' vẫn lọt rồi nổ 22008 ở Postgres thành 500
// (check-app bắt 05/08). Ngày phải parse được thật sự mới cho qua.
const isDay = (d: string) => DATE_RE.test(d) && !isNaN(Date.parse(d))
const fmtDMY = (d: string | null | undefined) => {
  if (!d) return '?'
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}/${m}/${y}`
}

/** Tồn "dùng được" (nhặt được / hạ xuống được). QUARANTINE đang giữ ⇒ KHÔNG nằm trong đây. */
const USABLE = ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING']

function scopeWhIds(req: Request): string[] | null {
  if (req.user?.warehouse_scope === 'ASSIGNED') return req.user.warehouse_ids ?? []
  return null
}
function guardWarehouse(req: Request, res: Response, warehouseId: string): boolean {
  const scope = scopeWhIds(req)
  if (scope !== null && !scope.includes(warehouseId)) {
    fail(res, 403, 'FORBIDDEN', 'Kho ngoài phạm vi được phân quyền')
    return false
  }
  return true
}

/** Id nhân sự lấy từ JWT — chỉ nhận dạng uuid (cột FK), khớp cách slottingController làm. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const selfId = (req: Request): string | null =>
  req.user?.sub && UUID_RE.test(req.user.sub) ? req.user.sub : null
const mayFill = (req: Request, action: string): boolean => {
  const perms = req.user?.module_permissions ?? {}
  const isAdmin = req.user?.is_superadmin === true
  return isAdmin || (perms.fill ?? []).includes(action)
}

// ─── "CÓ SẴN Ở KHO LẺ" PHẢI LÀ CÓ ĐÚNG LÔ (15/09, user chốt cùng luật nhặt lẻ) ────────────────
// RPC `fill_demand` đếm SỐ LƯỢNG ở vị trí nhặt lẻ, không hỏi "có phải lô đúng thứ tự không" ⇒ kho
// lẻ giữ lô MỚI trong khi lô cũ nằm trên kệ thì màn này báo "thiếu 0" và KHÔNG ra lệnh fill được,
// trong khi bảng "Theo vị trí" lại đang đòi fill (đo Ba Vì 15/09: 8/8 mã "đúng lô = 0" mà kho lẻ
// có tới 45.259 hộp). Đây là cửa thứ BA cùng trả lời một câu hỏi — lớp lỗi C19.
// Tính LẠI Ở TS, KHÔNG chép luật luân chuyển xuống SQL: `rotationSuggestionsFor` đã gộp sẵn theo
// (lô, vị trí) kèm cờ `is_pick_face`; "đúng lô" = cùng `rot_date` với gợi ý đầu (`pickFaceFirst`).
// ⚠️ Phải tính lại CẢ "thiếu" LẪN "pallet đề xuất hạ": RPC chỉ dựng gợi ý cho mã có `short_base > 0`
// (SQL), nên sửa mỗi con số thiếu sẽ ra màn hình "thiếu 1.068 mà không pallet nào để hạ" — bấm ra
// lệnh cũng không được, tức vẫn đúng cái user hỏi. Tính ở TS còn gỡ được MỘT BẢN CHÉP TAY của luật
// luân chuyển nằm trong SQL (`fefo_key`): thứ tự lấy hàng chỉ có một nguồn là `utils/rotation.ts`.
/**
 * Mức %Date của CÁC DÒNG nhặt lẻ trong ngày, gom theo mã (cùng bộ lọc chuyến với RPC `fill_demand`).
 * Trả `null` cho mã có ÍT NHẤT một dòng chưa chốt mức ⇒ mã đó không ràng buộc lô nào.
 */
async function looseRulesOfDay(warehouseId: string, day: string, matIds: string[]): Promise<Map<string, DateRule[] | null>> {
  const out = new Map<string, DateRule[] | null>()
  if (!matIds.length) return out
  const gdos = await fetchAllRowsParallel(() => supabase.from('GroupDeliveryOrder')
    .select('id, status, awaiting_sap, plan_dropped')
    .eq('warehouse_id', warehouseId).eq('delivery_date', day).order('id')) as unknown as
    Array<{ id: string; status: string | null; awaiting_sap: boolean | null; plan_dropped: boolean | null }>
  const gdoIds = gdos.filter(g => g.status !== 'CANCELLED' && !g.awaiting_sap && !g.plan_dropped).map(g => g.id)
  if (!gdoIds.length) return out
  const dos = await fetchAllByIdChunks(gdoIds, chunk => supabase.from('OutboundDelivery')
    .select('id').in('gdo_id', chunk).order('id')) as unknown as Array<{ id: string }>
  if (!dos.length) return out
  const items = await fetchAllByIdChunks(dos.map(d => d.id), chunk => supabase.from('OutboundItem')
    .select('material_id, date_rule, date_required, status, loose_picking')
    .in('do_id', chunk).gt('loose_picking', 0).order('id')) as unknown as
    Array<{ material_id: string | null; date_rule: unknown; date_required: number | null; status: string | null }>
  const want = new Set(matIds)
  for (const it of items) {
    if (!it.material_id || !want.has(it.material_id) || it.status === 'CANCELLED') continue
    if (out.get(it.material_id) === null) continue                  // đã có dòng không ràng buộc
    const rule = dateRuleOf(it)
    if (!rule) { out.set(it.material_id, null); continue }
    out.set(it.material_id, [...(out.get(it.material_id) ?? []), rule])
  }
  return out
}

const FILL_STATUSES = ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING'] as const
/** Tên tác nhân MÁY ghi vào `created_by` — RPC `fill_task_reduce` cũng so đúng chuỗi này (migration 20260915b) */
export const AUTO_ACTOR = 'Hệ thống'
/** Lý do huỷ do MÁY ghi — dòng máy đặt bị huỷ với lý do KHÁC = quyết định của NGƯỜI (veto trong ngày) */
export const MACHINE_RECALL_REASON = 'Hệ thống thu hồi — nhu cầu nhặt lẻ không còn'
export const MACHINE_LOT_REASON = 'Hệ thống thu hồi — lô không còn đạt mức %Date của đơn'
export const CLOSE_REASON = 'Chốt ngày — chưa thực hiện'
export const MACHINE_REASONS = new Set([MACHINE_RECALL_REASON, MACHINE_LOT_REASON, CLOSE_REASON])
const nsxOf = (d: unknown): string | null => (d ? String(d).slice(0, 10) : null)
const MAX_SUGG = 40
type FillSug = {
  entry_id: string; pallet_code: string | null
  from_location_id: string | null; from_location_code: string | null
  avail: number; production_date: string | null; expiry_date: string | null
}
export type FillDemandRow = {
  material_id: string; demand_base: number
  pending_base: number; short_base: number
  pick_face_base: number; pick_face_ok_base?: number; lot_date?: string | null
  // NSX của lô đúng thứ tự — `lot_date` là khoá FEFO (= HẠN DÙNG), người kho lại nói chuyện bằng NSX
  // (user chốt 16/09 "đúng kho theo NSX") nên màn hình in cột này, không in lot_date.
  lot_nsx?: string | null
  material_code?: string | null; material_name?: string | null; category?: string | null
  // Dòng MÁY đặt của ngày mang NSX KHÔNG CÒN đạt mức %Date của đơn (đơn đổi mức sau khi máy đặt) — không
  // được tính là "đang có lệnh" che nhu cầu; bộ đối chiếu thu hồi chúng theo `stale_dates` (16/09).
  stale_pending_base?: number; stale_dates?: string[]
  // NGƯỜI ĐÃ BÁC hôm nay (huỷ tay dòng máy đặt với lý do riêng) — chỉ gắn ở cửa HTTP để màn hình tách dòng
  veto?: { reason: string; at: string | null } | null
  // Phần nhu cầu đã có việc LOOSE_FEED lo — tách RIÊNG khỏi `pending_base` (gộp cả dòng FillTask)
  // để bộ đối chiếu tính được "nhu cầu còn phải phủ bằng lệnh fill" mà không phải trừ ngược.
  feed_pending_base?: number
  rule_unset?: boolean
  suggestions?: FillSug[]
}
/** Mã có nhặt lẻ hôm nay nhưng dòng đơn CHƯA CHỐT %Date — tách khỏi `rows` ở cửa HTTP (không phải mã thiếu) */
export type FillUnsetMat = {
  material_id: string; material_code: string | null; material_name: string | null
  category: string | null; demand_base: number
}
export type FillVetoedMat = FillUnsetMat & { reason: string; at: string | null }
export type FillDemandPayload = {
  rows?: FillDemandRow[]; pick_face_locations?: number; unset?: FillUnsetMat[]; vetoed?: FillVetoedMat[]
} | null
type FillEntry = RotationEntry & {
  id: string; pallet_code: string | null; material_id: string; location_id: string | null; status: string
  location: { location_code: string | null; warehouse_id: string | null; is_pick_face: boolean | null } | null
  material: (MaterialShelfInfo & { category?: string | null }) | null
}

async function withLotCheck(payload: FillDemandPayload, warehouseId: string, day: string): Promise<FillDemandPayload> {
  const rows = payload?.rows ?? []
  // Kho chưa khai ô nhặt lẻ nào ⇒ không có luật này (không tự bật hộ ai)
  if (!rows.length || !Number(payload?.pick_face_locations ?? 0)) return payload
  // ⚠️ CỐ Ý tính cho MỌI dòng, kể cả mã đang không có gì ở kho lẻ (chỗ đó con số của RPC vẫn đúng):
  // gợi ý của RPC sắp theo `fefo_key` viết trong SQL — không biết nguyên tắc luân chuyển của kho,
  // không biết shelf-life theo NCC, không biết mức %Date của dòng. Để lẫn hai luật trong CÙNG một
  // bảng là đúng thứ đang phải dọn, nên thà trả thêm ít dòng tồn còn hơn hai dòng cạnh nhau nói theo
  // hai luật khác nhau.
  const need = rows.filter(r => r.material_id)
  const matIds = [...new Set(need.map(r => r.material_id))]
  // MỨC %DATE THUỘC VỀ DÒNG ĐƠN — Fill cũng phải đọc (cửa thứ ba, vẫn lớp C19). Không đọc thì màn
  // này đòi hạ một lô mà CHÍNH đơn không được phép lấy: đo Ba Vì 15/09, mã 510000155 lộ trình bảo
  // "lấy ngay ở kho lẻ" (lô đạt mức ≥ 60 %) còn Fill lại bảo "hạ lô cũ hơn xuống" — lô đó rơi dưới
  // mức nên hạ xuống cũng không ai lấy được. Gộp mức của các dòng cùng mã theo phép HỢP: pallet
  // dùng được cho ÍT NHẤT một dòng là đáng fill; dòng chưa chốt mức ⇒ mã đó không ràng buộc gì.
  const rulesByMat = await looseRulesOfDay(warehouseId, day, matIds)
  const [ents, mats, qaHold, rotCfg, busyRaw, feedRaw] = await Promise.all([
    // KHÔNG nhúng Material vào từng dòng tồn: `supplier_shelf_life_overrides` là jsonb lặp lại trên
    // MỌI pallet của mã (hàng nghìn dòng) — tra một lần rồi ghép ở JS.
    fetchAllByIdChunks(matIds, chunk => supabase.from('InventoryEntry')
      .select('id, pallet_code, material_id, location_id, status, cartons_remaining, cartons_imported, cartons_reserved, production_date, expiry_date, shelf_life_days, ncc_id, qa_status_id, location:Location!inner(location_code, warehouse_id, is_pick_face)')
      .in('material_id', chunk).eq('location.warehouse_id', warehouseId)
      .in('status', [...FILL_STATUSES]).gt('cartons_remaining', 0).order('id')) as unknown as Promise<FillEntry[]>,
    fetchAllByIdChunks(matIds, chunk => supabase.from('Material')
      .select('id, category, shelf_life_days, supplier_shelf_life_overrides').in('id', chunk).order('id')) as unknown as
      Promise<Array<MaterialShelfInfo & { id: string; category: string | null }>>,
    qaHoldIds(),
    rotationConfigOf([warehouseId]),
    // Dòng lệnh đang treo của kho: (a) pallet đã ghim thì không đề xuất lần hai (luật RPC); (b) dòng MÁY đặt
    // của NGÀY này mà NSX không còn đạt mức của đơn ⇒ "lệnh cũ", không được che nhu cầu (xem dưới)
    supabase.from('FillTask')
      .select('entry_id, material_id, target_date, required_date, qty_base, qty_done_base, created_by')
      .eq('warehouse_id', warehouseId).eq('status', 'PENDING'),
    // ⚠️ HAI ĐƯỜNG FILL PHẢI BIẾT NHAU (15/09). Việc `LOOSE_FEED` mà bộ lập kế hoạch đặt lúc Bắt đầu
    // chuyến cũng là "hạ hàng xuống ô nhặt lẻ", nhưng RPC `fill_demand` chỉ đếm `FillTask` ⇒ cùng một
    // nhu cầu bị tính hai lần và mã đó bị hạ hai lần. Chưa nổ suốt 6 tuần CHỈ vì chưa ai ra lệnh fill
    // nào (đo 15/09: 0 lệnh / 9 việc LOOSE_FEED) — bật tự động là nó thành chuyện thường ngày.
    // CHỈ việc của chuyến xuất ĐÚNG NGÀY này (embed !inner lọc, không trả cột): lệnh fill là sổ của một
    // ngày, việc hạ cho chuyến hôm nay không được trừ vào nhu cầu ngày mai (cùng lỗ với `pend` của RPC,
    // migration 20260915e — gói 18 [24b2] bắt: dòng ngày 21/12 trừ hết nhu cầu ngày mai ⇒ "thiếu 0").
    supabase.from('wms_tasks').select('material_id, qty_base, gdo:GroupDeliveryOrder!gdo_id!inner()')
      .eq('warehouse_id', warehouseId).eq('kind', 'LOOSE_FEED').eq('status', 'PENDING')
      .eq('gdo.delivery_date', day),
  ])
  type OpenLine = {
    entry_id: string | null; material_id: string | null; target_date: string | null; required_date: string | null
    qty_base: number | null; qty_done_base: number | null; created_by: string | null
  }
  const openLines = (busyRaw.data ?? []) as unknown as OpenLine[]
  const busy = new Set(openLines.map(t => t.entry_id).filter(Boolean))
  const openByMat = new Map<string, OpenLine[]>()
  for (const l of openLines) {
    if (!l.material_id || nsxOf(l.target_date) !== day) continue
    openByMat.set(l.material_id, [...(openByMat.get(l.material_id) ?? []), l])
  }
  const feedPending = new Map<string, number>()
  for (const t of ((feedRaw.data ?? []) as { material_id: string | null; qty_base: number | null }[])) {
    if (!t.material_id) continue
    feedPending.set(t.material_id, (feedPending.get(t.material_id) ?? 0) + Number(t.qty_base ?? 0))
  }
  const matById = new Map(mats.map(m => [m.id, m]))
  const byMat = new Map<string, FillEntry[]>()
  for (const e of ents) {
    e.material = matById.get(e.material_id) ?? null
    byMat.set(e.material_id, [...(byMat.get(e.material_id) ?? []), e])
  }

  for (const r of need) {
    const all = byMat.get(r.material_id) ?? []
    const rules = rulesByMat.get(r.material_id)
    // `rules === null` = có dòng chưa chốt mức ⇒ không ràng buộc; mảng rỗng = không có dòng nào (giữ nguyên)
    const pool = rules == null ? all
      : all.filter(e => rules.some(rule => palletMeetsDateRule(e, e.material, rule)))
    const principle = rotCfg.of(warehouseId, all[0]?.material?.category ?? null).principle
    const keyOf = new Map(pool.map(e => [e.id, rotationSortKey(e, e.material, principle)]))
    const sorted = [...pool].sort((a, b) => {
      const ka = keyOf.get(a.id) ?? Infinity, kb = keyOf.get(b.id) ?? Infinity
      if (ka !== kb) return ka - kb
      return a.id.localeCompare(b.id)
    })
    // LÔ ĐÚNG THỨ TỰ = lô của pallet đứng đầu trong số LẤY ĐƯỢC (bỏ pallet QA giữ — pallet đó cửa
    // quét xuất không cho lấy nên nó không định nghĩa được "lô phải lấy").
    const best = sorted.find(e => isPickEligible(e, qaHold))
    const bestKey = best ? (keyOf.get(best.id) ?? null) : null
    const ok = sorted
      .filter(e => e.location?.is_pick_face === true && isPickEligible(e, qaHold) && (keyOf.get(e.id) ?? null) === bestKey)
      .reduce((s, e) => s + availableOf(e), 0)
    // LỆNH CŨ — ĐƠN ĐỔI MỨC SAU KHI MÁY ĐÃ ĐẶT (đo thật 16/09: dòng 363 chốt ≥ 60 % ⇒ máy đặt lô 27/06 (66 %);
    // người sửa thành ≥ 80 % ⇒ lô đó không còn được lấy, nhưng dòng vẫn treo và "đang có lệnh" che hết
    // nhu cầu ⇒ máy không đặt lô đúng, xe nâng đi hạ một pallet mà đơn không lấy được. Cùng lớp C17
    // "trạng thái cũ ăn hết nhu cầu"). Dòng MÁY đặt mà NSX không nằm trong tập pallet ĐẠT MỨC ⇒ không tính
    // là đang che; bộ đối chiếu đọc `stale_dates` để thu hồi ngay trong lượt. Dòng NGƯỜI đặt giữ nguyên
    // (quyết định của người bất khả xâm phạm). `rules == null` (không ràng buộc) ⇒ không có gì là cũ.
    const poolDates = rules == null ? null : new Set(pool.map(e => nsxOf(e.production_date)).filter(Boolean))
    let stale = 0
    const staleDates: string[] = []
    if (poolDates) {
      for (const l of openByMat.get(r.material_id) ?? []) {
        if ((l.created_by ?? '') !== AUTO_ACTOR) continue
        const d = nsxOf(l.required_date)
        if (!d || poolDates.has(d)) continue
        stale += Math.max(0, Number(l.qty_base ?? 0) - Number(l.qty_done_base ?? 0))
        if (!staleDates.includes(d)) staleDates.push(d)
      }
    }
    const feed = feedPending.get(r.material_id) ?? 0
    const pending = Math.max(0, Number(r.pending_base ?? 0) - stale) + feed
    const short = Math.max(0, Number(r.demand_base ?? 0) - ok - pending)
    r.stale_pending_base = stale
    r.stale_dates = staleDates
    r.feed_pending_base = feed
    r.pick_face_ok_base = ok
    r.lot_date = bestKey == null ? null : new Date(bestKey).toISOString().slice(0, 10)
    r.lot_nsx = best?.production_date ? String(best.production_date).slice(0, 10) : null
    r.pending_base = pending
    r.short_base = short
    // "Có dòng CHƯA CHỐT mức %Date" ≠ "không dòng nào ràng buộc". Với người xem thì cả hai đều là
    // không lọc gì, nhưng đường TỰ RA LỆNH phải phân biệt: chưa chốt thì chưa được lấy (luật 10/09),
    // nên máy không được tự chọn lô hộ. `undefined` = mã không có dòng lẻ nào hôm nay.
    r.rule_unset = rulesByMat.has(r.material_id) && rules === null

    const sug: FillSug[] = []
    let cum = 0
    for (const e of sorted) {
      if (cum >= short || sug.length >= MAX_SUGG) break
      if (e.location?.is_pick_face === true || busy.has(e.id)) continue
      const avail = availableOf(e)
      if (avail <= 0) continue
      sug.push({
        entry_id: e.id, pallet_code: e.pallet_code,
        from_location_id: e.location_id, from_location_code: e.location?.location_code ?? null,
        avail, production_date: (e.production_date as string | null) ?? null,
        expiry_date: (keyOf.get(e.id) != null ? new Date(keyOf.get(e.id)!).toISOString().slice(0, 10) : null),
      })
      cum += avail
    }
    r.suggestions = sug
  }
  return payload
}

// Trạng thái LỆNH suy lại từ các dòng của nó (rollup trong DB, tránh drift khi đua). Gói vào hàm để
// đường tự động gọi được mà không phải mở thêm một client DB thứ hai.
export async function fillOrderRollup(orderId: string): Promise<void> {
  await supabase.rpc('fill_order_rollup', { p_order_id: orderId })
}

export interface DayOrder {
  id: string; order_code: string; created?: boolean
  assignee_id: string | null; assignee_name: string | null; assigned_by: string | null
}

/**
 * LỆNH CỦA NGÀY — một lệnh ĐANG MỞ cho mỗi (kho, ngày xuất, loại kho); khoá `uq_fillorder_open` gác
 * ở DB (user chốt 15/09: "1 ngày, 1 kho, 1 loại kho chỉ có 1 lệnh fill"). RPC `fill_order_ensure` tự
 * đọc-lại-rồi-tạo dưới lock; ở đây chỉ lo sinh MÃ lệnh (unique riêng) và thử lại khi đụng mã.
 *
 * Đặt ở ĐÂY chứ không ở `services/autoFill`: service đó đã import file này, để hàm bên kia rồi import
 * ngược là vòng khép kín ngay lúc nạp module.
 */
export async function ensureDayOrder(
  warehouseId: string, day: string, type: string | null, auto: boolean, actor: string | null,
): Promise<DayOrder | null> {
  const prefix = 'F' + day.slice(2).replace(/-/g, '') + '-'
  const t = now()
  for (let attempt = 0; attempt < 5; attempt++) {
    const { count } = await supabase.from('FillOrder')
      .select('id', { count: 'exact', head: true }).like('order_code', `${prefix}%`)
    const { data, error } = await supabase.rpc('fill_order_ensure', {
      p_id: randomUUID(), p_warehouse_id: warehouseId, p_target_date: day, p_type: type,
      p_order_code: prefix + String((count ?? 0) + 1 + attempt).padStart(2, '0'),
      p_auto: auto, p_actor: actor, p_now: t,
    })
    if (error) throw error
    if (data) return data as DayOrder
    await new Promise(r => setTimeout(r, 80 + Math.random() * 200))
  }
  return null
}

/**
 * Nhu cầu fill của (kho, ngày) — THÂN DUY NHẤT dùng cho cả trang Đề xuất lẫn đường TỰ RA LỆNH
 * (`services/autoFill.ts`). Máy và màn hình phải nhìn cùng một con số, nếu không người mở trang sẽ
 * thấy "thiếu 0" trong khi máy vừa đặt một lệnh hạ hàng — đúng lớp lỗi hai-bản-luật đang phải dọn.
 * KHÔNG cắt phạm vi kho/loại: đường tự động chạy dưới danh nghĩa hệ thống, không phải một người.
 */
export async function fillDemandOf(warehouseId: string, day: string): Promise<FillDemandPayload> {
  const { data, error } = await supabase.rpc('fill_demand', {
    p_wh_scope: null, p_cat_scope: null, p_warehouse_id: warehouseId, p_date: day,
  })
  if (error) throw error
  return withLotCheck(data as FillDemandPayload, warehouseId, day)
}

// ─── GET /wms/fill/demand?warehouse_id&date ─────────────────────────────────
export async function getFillDemand(req: Request, res: Response) {
  try {
    const { warehouse_id, date } = req.query as Record<string, string>
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (date && !isDay(date)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')
    if (!guardWarehouse(req, res, warehouse_id)) return

    const { data, error } = await supabase.rpc('fill_demand', {
      p_wh_scope:     scopeWhIds(req),
      p_cat_scope:    scopeCategoriesOf(req),
      p_warehouse_id: warehouse_id,
      p_date:         date || vnToday(),
    })
    if (error) {
      if (error.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260804 (fill hàng)')
      if (isQueryTimeout(error)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
      return fail(res, 500, 'DB_ERROR', error.message)
    }
    const out = await withLotCheck(data as FillDemandPayload, warehouse_id, date || vnToday())
    // MÃ CHƯA CHỐT %DATE KHÔNG PHẢI MÃ THIẾU (user chốt 16/09: "chưa chốt thì không cần đưa yêu cầu — đầy đủ
    // rồi mới tới bước fill"). Bản cũ để nó nằm lẫn trong bảng như mã thiếu thường ⇒ người bấm "Đưa vào lệnh
    // fill" là chọn lô hộ một dòng chưa ai quyết (luật 10/09). Tách ra `unset[]` để màn hình NÓI RA và chỉ
    // đường sang Quy định date — không lọc im lặng (cùng khuôn `excluded`). CHỈ ở cửa HTTP: bộ đối chiếu
    // (`fillDemandOf`) vẫn nhận trọn `rows` để chiều HẠ còn thấy nhu cầu của mã đó (rút khỏi rows là nó
    // coi nhu cầu = 0 và thu hồi nhầm dòng đang có).
    if (out?.rows?.some(r => r.rule_unset)) {
      out.unset = out.rows.filter(r => r.rule_unset).map(r => ({
        material_id: r.material_id, material_code: r.material_code ?? null, material_name: r.material_name ?? null,
        category: r.category ?? null, demand_base: Number(r.demand_base ?? 0),
      }))
      out.rows = out.rows.filter(r => !r.rule_unset)
    }
    // NGƯỜI ĐÃ BÁC (user hỏi 16/09 "tại sao 363 và 022 lại có mặt ở Đề xuất?"): dòng máy đặt bị huỷ tay hôm nay ⇒
    // máy không đặt lại (luật vòng 4), nhưng nhu cầu vẫn còn nên bảng liệt như mã thiếu thường — người xem tưởng
    // còn việc. Gắn `veto` lên dòng + trả `vetoed[]` để màn hình tách ra băng riêng (nêu lý do), vẫn hiện lại được
    // khi người đổi ý và đưa vào lệnh tay. Cùng định nghĩa veto với bộ đối chiếu (`MACHINE_REASONS`).
    if (out?.rows?.length) {
      const day = date || vnToday()
      const { data: cancelled } = await supabase.from('FillTask')
        .select('material_id, cancel_reason, updated_at')
        .eq('warehouse_id', warehouse_id).eq('target_date', day).eq('status', 'CANCELLED').eq('created_by', AUTO_ACTOR)
        .order('updated_at', { ascending: false }).limit(1000)
      const vetoByMat = new Map<string, { reason: string; at: string | null }>()
      for (const c of (cancelled ?? []) as { material_id: string | null; cancel_reason: string | null; updated_at: string | null }[]) {
        if (!c.material_id || MACHINE_REASONS.has(c.cancel_reason ?? '') || vetoByMat.has(c.material_id)) continue
        vetoByMat.set(c.material_id, { reason: c.cancel_reason ?? '', at: c.updated_at })
      }
      if (vetoByMat.size) {
        out.vetoed = []
        for (const r of out.rows) {
          const v = vetoByMat.get(r.material_id)
          if (!v) continue
          r.veto = v
          out.vetoed.push({
            material_id: r.material_id, material_code: r.material_code ?? null, material_name: r.material_name ?? null,
            category: r.category ?? null, demand_base: Number(r.demand_base ?? 0), reason: v.reason, at: v.at,
          })
        }
      }
    }
    return ok(res, out)
  } catch (e) {
    // Bước tính "đúng lô" kéo tồn của các mã đang cần ⇒ lúc DB bận có thể chạm trần câu lệnh.
    // Đó là QUÁ TẢI, không phải lỗi lập trình: trả 503 kèm hướng dẫn (và không thổi cờ "lỗi BE").
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    // Câu lỗi THẬT, không `String(e)`: đối tượng lỗi Supabase in ra thành "[object Object]".
    console.error(e)
    return fail(res, 500, 'SERVER_ERROR', e instanceof Error ? e.message
      : String((e as { message?: string })?.message ?? 'Lỗi không rõ'))
  }
}

// ─── GET /wms/fill/candidates?warehouse_id&material_id ─────────────────────
// Dialog "Đổi date chỉ định": toàn bộ pallet ứng viên của MỘT mã (FEFO) để người nhặt lẻ chọn
// NSX họ cần từ tồn thật; không chọn = mặc định FEFO (date xa nhất).
export async function getFillCandidates(req: Request, res: Response) {
  try {
    const { warehouse_id, material_id } = req.query as Record<string, string>
    if (!warehouse_id || !material_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho hoặc mã hàng')
    if (!UUID_RE.test(material_id)) return fail(res, 400, 'INVALID_INPUT', 'Mã hàng không hợp lệ')
    if (!guardWarehouse(req, res, warehouse_id)) return

    const { data, error } = await supabase.rpc('fill_candidates', {
      p_wh_scope:     scopeWhIds(req),
      p_warehouse_id: warehouse_id,
      p_material_id:  material_id,
    })
    if (error) {
      if (error.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260805b (fill hàng)')
      return fail(res, 500, 'DB_ERROR', error.message)
    }
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── GET /wms/fill/orders — danh sách LỆNH (mỗi dòng = 1 lần Ra lệnh) ────────
export async function listFillOrders(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>
    if (!q.warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, q.warehouse_id)) return
    for (const d of [q.date_from, q.date_to])
      if (d && !isDay(d)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')

    const page     = Math.max(1, Number(q.page) || 1)
    const pageSize = Math.min(500, Math.max(1, Number(q.page_size) || 100))
    // `?status=` rỗng nghĩa là "không trạng thái nào" → trả rỗng, KHÔNG bỏ lọc (parseListParam)
    const status   = parseListParam(q.status)
    // "Việc của tôi": lấy id từ TOKEN, không tin id client gửi
    const assignee = q.mine === '1' || q.mine === 'true' ? selfId(req) : (q.assignee_id || null)
    if ((q.mine === '1' || q.mine === 'true') && !assignee) return ok(res, { rows: [], total: 0 })

    const { data, error } = await supabase.rpc('fill_orders_page', {
      p_wh_scope:     scopeWhIds(req),
      p_warehouse_id: q.warehouse_id,
      p_from:         q.date_from || null,
      p_to:           q.date_to   || null,
      p_status:       status,
      p_assignee:     assignee,
      p_search:       q.search || null,
      p_offset:       (page - 1) * pageSize,
      p_limit:        pageSize,
    })
    if (error) {
      if (error.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260805d (lệnh fill gom)')
      return fail(res, 500, 'DB_ERROR', error.message)
    }
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── GET /wms/fill/orders/:id — chi tiết lệnh: dòng mã + vết quét ────────────
export async function getFillOrder(req: Request, res: Response) {
  try {
    const { data: order } = await supabase.from('FillOrder')
      .select('*').eq('id', req.params.id).maybeSingle()
    if (!order) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy lệnh fill')
    if (!guardWarehouse(req, res, order.warehouse_id as string)) return

    // Dòng lệnh kèm đơn vị của mã (FE hiện "N thùng + M hộp" qua qtyLabel)
    const { data: lines, error: e1 } = await supabase.from('FillTask')
      .select('*, material:Material!material_id(entry_unit, units_per_carton, base_unit)')
      .eq('fill_order_id', order.id)
      .order('status').order('material_code').limit(1000)
    if (e1) throw e1
    const { data: scans, error: e2 } = await supabase.from('FillTaskScan')
      .select('*').eq('fill_order_id', order.id)
      .order('created_at', { ascending: false }).limit(1000)
    if (e2) throw e2
    return ok(res, { order, lines: lines ?? [], scans: scans ?? [] })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── LOẠI KHO: vị trí đích phải NHẬN loại của mã ─────────────────────────────
// Null-inclusive hai chiều — cùng khuôn với picker vị trí toàn app (user bắt 05/08:
// hàng FG02 không được hạ về khu FG01).
function locAcceptsCat(locCats: string[] | null, matCat: string | null): boolean {
  return !locCats || !matCat || locCats.includes(matCat)
}

// ─── Chỉ mục vị trí nhặt lẻ còn chỗ (dựng MỘT LẦN cho cả lệnh) ───────────────
// Ưu tiên chỗ ĐANG chứa đúng mã đó, rồi tới chỗ trống nhiều. `free` bị TRỪ theo SỐ PALLET của
// từng dòng để 3 dòng cùng lúc không dồn hết vào một ô 2 slot.
export type PickFaceIdx = {
  locs: { id: string; code: string; cats: string[] | null; free: number }[]
  hasMat: Map<string, Set<string>>
}
export async function buildPickFaceIdx(warehouseId: string, materialIds: string[]): Promise<PickFaceIdx> {
  const { data: locRaw } = await supabase.from('Location')
    .select('id, location_code, max_pallets, categories')
    .eq('warehouse_id', warehouseId).eq('is_pick_face', true).eq('is_active', true)
    .order('location_code').limit(1000)
  const locs = (locRaw ?? []) as { id: string; location_code: string; max_pallets: number | null; categories: string[] | null }[]
  if (!locs.length) return { locs: [], hasMat: new Map() }
  const ids = locs.map(l => l.id)

  // Chỗ đã chiếm — ĐỊNH NGHĨA KHỚP RPC move_pallets_to_location (nơi thực sự chặn lúc quét)
  const used = new Map<string, number>()
  const hasMat = new Map<string, Set<string>>()
  const matSet = new Set(materialIds)
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from('InventoryEntry')
      .select('location_id, material_id, status')
      .in('location_id', ids.slice(i, i + 300))
      .in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING'])
      .gt('cartons_remaining', 0)
    for (const e of (data ?? []) as { location_id: string; material_id: string; status: string }[]) {
      if (e.status !== 'LOOSE_PICKING') used.set(e.location_id, (used.get(e.location_id) ?? 0) + 1)
      if (matSet.has(e.material_id) && USABLE.includes(e.status)) {
        if (!hasMat.has(e.material_id)) hasMat.set(e.material_id, new Set())
        hasMat.get(e.material_id)!.add(e.location_id)
      }
    }
  }
  return {
    locs: locs.map(l => ({
      id: l.id, code: l.location_code, cats: l.categories,
      free: Number(l.max_pallets ?? 0) - (used.get(l.id) ?? 0),
    })),
    hasMat,
  }
}
export function takePickFace(idx: PickFaceIdx, materialId: string, matCat: string | null, nPallets: number): { id: string; code: string } | null {
  const same = idx.hasMat.get(materialId)
  const pool = idx.locs.filter(l => l.free > 0 && locAcceptsCat(l.cats, matCat))
  if (!pool.length) return null
  pool.sort((a, b) => {
    const sa = same?.has(a.id) ? 0 : 1, sb = same?.has(b.id) ? 0 : 1
    return sa !== sb ? sa - sb : (b.free - a.free) || a.code.localeCompare(b.code)
  })
  const hit = pool[0]
  hit.free -= Math.max(1, nPallets)   // giữ chỗ trong phạm vi lệnh này
  if (!same) idx.hasMat.set(materialId, new Set([hit.id]))
  else same.add(hit.id)
  return { id: hit.id, code: hit.code }
}

// ─── POST /wms/fill/orders — RA LỆNH (một lệnh gom nhiều dòng mã, chỉ định theo DATE) ──
// body { warehouse_id, target_date, assignee_id?, lines: [{ material_id, required_date?,
//        required_expiry?, qty_base, required_pallets, src_hint?, to_location_id? }] }
export async function createFillOrder(req: Request, res: Response) {
  try {
    const { warehouse_id, target_date, assignee_id, lines } = req.body as {
      warehouse_id?: string; target_date?: string; assignee_id?: string
      lines?: {
        material_id?: string; required_date?: string | null; required_expiry?: string | null
        qty_base?: number; required_pallets?: number; src_hint?: string; to_location_id?: string
      }[]
    }
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, warehouse_id)) return
    const day = target_date || vnToday()
    if (!isDay(day)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')
    const list = (Array.isArray(lines) ? lines : []).filter(l =>
      l && typeof l.material_id === 'string' && UUID_RE.test(l.material_id)
      && Number(l.qty_base) > 0 && Number.isFinite(Number(l.qty_base)))
    if (!list.length) return fail(res, 400, 'INVALID_INPUT', 'Chưa có dòng mã nào để ra lệnh')
    if (list.length > 200) return fail(res, 400, 'TOO_MANY', 'Tối đa 200 dòng mỗi lệnh — chia nhỏ giúp')
    for (const l of list) {
      if (l.required_date && !isDay(String(l.required_date).slice(0, 10)))
        return fail(res, 400, 'INVALID_INPUT', 'Date yêu cầu không hợp lệ (YYYY-MM-DD)')
    }

    const matIds = [...new Set(list.map(l => l.material_id as string))]
    const matMap = new Map<string, { material_code: string; short_name: string | null; category: string | null }>()
    for (let i = 0; i < matIds.length; i += 300) {
      const { data } = await supabase.from('Material')
        .select('id, material_code, short_name, category').in('id', matIds.slice(i, i + 300))
      for (const m of (data ?? []) as { id: string; material_code: string; short_name: string | null; category: string | null }[])
        matMap.set(m.id, { material_code: m.material_code, short_name: m.short_name, category: m.category })
    }

    // Vị trí đích chỉ định — kiểm ở BE, không tin FE (thuộc kho + cờ nhặt lẻ + đang hoạt động)
    const destIds = [...new Set(list.map(l => l.to_location_id).filter(Boolean))] as string[]
    const destOk = new Map<string, { code: string; cats: string[] | null }>()
    if (destIds.length) {
      const { data } = await supabase.from('Location')
        .select('id, location_code, categories').in('id', destIds.slice(0, 300))
        .eq('warehouse_id', warehouse_id).eq('is_pick_face', true).eq('is_active', true)
      for (const d of (data ?? []) as { id: string; location_code: string; categories: string[] | null }[])
        destOk.set(d.id, { code: d.location_code, cats: d.categories })
    }

    // Người được gán (một người cho CẢ lệnh — dialog "Giao lệnh fill cho ai?")
    let asg: { id: string; name: string } | null = null
    if (assignee_id) {
      const { data: emp } = await supabase.from('Employee')
        .select('id, name').eq('id', assignee_id).eq('is_active', true).maybeSingle()
      if (!emp) return fail(res, 400, 'INVALID_INPUT', 'Nhân sự được gán không tồn tại hoặc đã nghỉ')
      asg = { id: emp.id as string, name: emp.name as string }
    }

    const t = now()
    const actor = req.user?.name || null
    const pfIdx = await buildPickFaceIdx(warehouse_id, matIds)
    const skipped: { material_code?: string; required_date?: string | null; reason: string }[] = []
    const rows: Record<string, unknown>[] = []

    for (const l of list) {
      const mat = matMap.get(l.material_id as string)
      if (!mat) { skipped.push({ material_code: l.material_id, reason: 'Mã hàng không tồn tại' }); continue }
      const reqDate = l.required_date ? String(l.required_date).slice(0, 10) : null
      const nPallets = Math.min(500, Math.max(1, Math.round(Number(l.required_pallets) || 1)))
      // Đích chỉ định sai LOẠI → báo rõ và bỏ dòng, KHÔNG âm thầm đổi chỗ thay user
      let destId: string | null = null, destCode: string | null = null
      if (l.to_location_id) {
        const d = destOk.get(l.to_location_id)
        if (d && !locAcceptsCat(d.cats, mat.category)) {
          skipped.push({ material_code: mat.material_code, required_date: reqDate,
            reason: `Vị trí ${d.code} không nhận Loại kho ${mat.category} của mã này` }); continue
        }
        if (d) { destId = l.to_location_id; destCode = d.code }
      }
      if (!destId) {
        const b = takePickFace(pfIdx, l.material_id as string, mat.category, nPallets)
        if (b) { destId = b.id; destCode = b.code }
      }
      if (!destId) {
        skipped.push({ material_code: mat.material_code, required_date: reqDate,
          reason: 'Không còn vị trí nhặt lẻ trống nhận Loại kho của mã này' }); continue
      }
      rows.push({
        id: randomUUID(), warehouse_id, target_date: day,
        material_id: l.material_id, material_code: mat.material_code, material_name: mat.short_name,
        required_date: reqDate,
        required_expiry: l.required_expiry ? String(l.required_expiry).slice(0, 10) : null,
        required_pallets: nPallets, qty_base: Number(l.qty_base),
        from_location_code: (l.src_hint ?? '').slice(0, 200) || null,   // gợi ý hiển thị "lấy tại đâu"
        to_location_id: destId, to_location_code: destCode,
        status: 'PENDING',
        assignee_id: asg?.id ?? null, assignee_name: asg?.name ?? null,
        assigned_by: asg ? actor : null, assigned_at: asg ? t : null,
        created_by: actor, created_at: t, updated_at: t,
      })
    }
    if (!rows.length) return res.status(201).json({ success: true, data: { created: 0, skipped } })

    // MỘT LỆNH CHO MỖI (kho, ngày, LOẠI KHO) — không còn "mỗi lần bấm một lệnh" (user chốt 15/09).
    // Bấm tay giờ là THÊM VÀO lệnh của ngày, nên một mẻ trải nhiều Loại kho sẽ rơi vào nhiều lệnh.
    const orderOf = new Map<string, DayOrder>()
    for (const cat of new Set(rows.map(r => matMap.get(r.material_id as string)?.category ?? null))) {
      const o = await ensureDayOrder(warehouse_id, day, cat, false, actor)
      if (!o) return fail(res, 409, 'CONFLICT', 'Không mở được lệnh của ngày — thử lại giúp')
      orderOf.set(cat ?? '', o)
    }
    for (const r of rows) {
      const o = orderOf.get(matMap.get(r.material_id as string)?.category ?? '')
      if (o) r.fill_order_id = o.id
    }
    const order = orderOf.values().next().value as DayOrder

    // "Giao cho ai" ở dialog nay gán CẢ LỆNH NGÀY — người đó nhận kế hoạch cả ngày, kể cả dòng máy
    // thêm vào lúc 11h (user chốt 15/09). Dòng của mẻ này vẫn mang tên người đó như cũ.
    if (asg) {
      for (const o of orderOf.values()) {
        await supabase.from('FillOrder').update({
          assignee_id: asg.id, assignee_name: asg.name, assigned_by: actor, assigned_at: t, updated_at: t,
        }).eq('id', o.id).eq('status', 'PENDING')
      }
    }

    // Ghi theo LÔ; đụng unique (mã+date này ĐANG có dòng treo) → rơi xuống từng dòng, và dòng
    // trùng thì CỘNG DỒN vào dòng treo (đơn phát sinh — user chốt 05/08) qua RPC nguyên tử
    // fill_task_topup (qty = qty + delta dưới lock, không đọc-rồi-ghi). RPC trả NULL = dòng vừa
    // DONE/hủy giữa chừng → unique đã nhả, thử INSERT lại (tối đa 3 vòng, có jitter).
    let created = 0
    const merged: { material_code: string; required_date: string | null; added_qty: number
      added_pallets: number; fill_order_id: string | null }[] = []
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500)
      const { error } = await supabase.from('FillTask').insert(batch)
      if (!error) { created += batch.length; continue }
      for (const r of batch) {
        let settled = false
        for (let attempt = 0; attempt < 3 && !settled; attempt++) {
          const { error: e1 } = await supabase.from('FillTask').insert(r)
          if (!e1) { created++; settled = true; break }
          if ((e1 as { code?: string }).code !== '23505') {
            skipped.push({ material_code: r.material_code as string,
              required_date: r.required_date as string | null, reason: 'Không ghi được dòng lệnh' })
            settled = true; break
          }
          const { data: tp } = await supabase.rpc('fill_task_topup', {
            p_warehouse_id: warehouse_id, p_target_date: day, p_material_id: r.material_id,
            p_required_date: r.required_date, p_add_qty: r.qty_base,
            p_add_pallets: r.required_pallets, p_now: t,
          })
          if (tp) {
            merged.push({ material_code: r.material_code as string,
              required_date: r.required_date as string | null,
              added_qty: Number(r.qty_base), added_pallets: Number(r.required_pallets),
              fill_order_id: (tp as { fill_order_id?: string }).fill_order_id ?? null })
            settled = true; break
          }
          await new Promise(rs => setTimeout(rs, 80 + Math.random() * 200))
        }
        if (!settled) skipped.push({ material_code: r.material_code as string,
          required_date: r.required_date as string | null,
          reason: 'Đụng độ liên tục với lệnh khác — thử lại giúp' })
      }
    }
    // Nhãn lệnh đích cho các dòng đã cộng dồn (để user biết mở lệnh nào)
    const mergedOrderIds = [...new Set(merged.map(m => m.fill_order_id).filter(Boolean))] as string[]
    const codeOf = new Map<string, string>()
    if (mergedOrderIds.length) {
      const { data: ords } = await supabase.from('FillOrder')
        .select('id, order_code').in('id', mergedOrderIds.slice(0, 300))
      for (const o of ords ?? []) codeOf.set(o.id as string, o.order_code as string)
    }
    const mergedOut = merged.map(m => ({
      material_code: m.material_code, required_date: m.required_date,
      added_qty: m.added_qty, added_pallets: m.added_pallets,
      order_code: m.fill_order_id ? codeOf.get(m.fill_order_id) ?? null : null,
    }))
    // Lệnh VỪA MỞ trong lượt này mà rốt cuộc không nhận dòng nào (tất cả cộng dồn vào dòng cũ) thì
    // đừng để lại vỏ. Lệnh ĐÃ CÓ TỪ TRƯỚC thì không đụng — đó là sổ của cả ngày, không phải của mẻ này.
    for (const o of orderOf.values()) {
      if (!o.created) continue
      if (rows.some(r => r.fill_order_id === o.id)) continue
      await supabase.from('FillOrder').delete().eq('id', o.id)
    }
    if (!created) return res.status(201).json({ success: true, data: { created: 0, skipped, merged: mergedOut } })
    // Báo người được giao (nếu giao cho NGƯỜI KHÁC): ghi feed Cá nhân (nút chuông) + đổ chuông
    // theo cài đặt. Await để chắc xong trước khi serverless đóng, nhưng KHÔNG fail response.
    if (asg && asg.id !== selfId(req)) {
      await notifyEmployees([asg.id], 'ASSIGN', 'assign', {
        title: `Lệnh fill ${order.order_code}`,
        body: `${actor ?? 'Quản lý'} giao bạn kế hoạch fill CẢ NGÀY ${fmtDMY(day)} — ${created} dòng hạ hàng nhặt lẻ`,
        url: `/wms/fill/orders/${order.id}`,
        tag: `fill-${order.id}`,
      })
    }
    return res.status(201).json({ success: true, data: {
      created, skipped, merged: mergedOut, order_id: order.id, order_code: order.order_code,
    } })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── PATCH /wms/fill/tasks/:id — gán người / đổi vị trí đích cho MỘT dòng ────
// Đổi đích PHẢI có: đích đầy thì dòng kẹt vĩnh viễn (quét luôn trả LOCATION_FULL) — đúng loại
// "ngõ cụt" app đã dính vài lần. Gán người = quyền `assign`; đổi đích = quyền `plan`.
// Multi-select ở trang chi tiết lệnh gọi route này SONG SONG từng dòng (Promise.all).
export async function updateFillTask(req: Request, res: Response) {
  try {
    const { assignee_id, to_location_id } = req.body as { assignee_id?: string | null; to_location_id?: string }
    const hasAsg  = assignee_id !== undefined
    const hasDest = to_location_id !== undefined
    if (!hasAsg && !hasDest) return fail(res, 400, 'INVALID_INPUT', 'Không có gì để sửa')

    const { data: task } = await supabase.from('FillTask')
      .select('id, warehouse_id, status, material_id, material_code, fill_order_id').eq('id', req.params.id).maybeSingle()
    if (!task) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy dòng lệnh fill')
    if (!guardWarehouse(req, res, task.warehouse_id as string)) return
    if (task.status !== 'PENDING') return fail(res, 409, 'NOT_PENDING', 'Dòng đã xong hoặc đã hủy — không sửa được')

    if (hasAsg  && !mayFill(req, 'assign'))      return fail(res, 403, 'FORBIDDEN', 'Không có quyền gán lệnh fill')
    if (hasDest && !mayFill(req, 'change_dest')) return fail(res, 403, 'FORBIDDEN', 'Không có quyền đổi vị trí đến của lệnh fill')

    const patch: Record<string, unknown> = { updated_at: now() }
    if (hasAsg) {
      if (!assignee_id) Object.assign(patch, { assignee_id: null, assignee_name: null, assigned_by: null, assigned_at: null })
      else {
        const { data: emp } = await supabase.from('Employee')
          .select('id, name').eq('id', assignee_id).eq('is_active', true).maybeSingle()
        if (!emp) return fail(res, 400, 'INVALID_INPUT', 'Nhân sự không tồn tại hoặc đã nghỉ')
        Object.assign(patch, {
          assignee_id: emp.id, assignee_name: emp.name,
          assigned_by: req.user?.name || null, assigned_at: now(),
        })
      }
    }
    if (hasDest) {
      const { data: loc } = await supabase.from('Location')
        .select('id, location_code, categories').eq('id', to_location_id)
        .eq('warehouse_id', task.warehouse_id).eq('is_pick_face', true).eq('is_active', true).maybeSingle()
      if (!loc) return fail(res, 400, 'INVALID_INPUT', 'Vị trí đích phải là VỊ TRÍ NHẶT LẺ đang hoạt động của kho này')
      const { data: mat } = task.material_id
        ? await supabase.from('Material').select('category').eq('id', task.material_id).maybeSingle()
        : { data: null }
      if (!locAcceptsCat(loc.categories as string[] | null, (mat?.category as string | null) ?? null))
        return fail(res, 400, 'CATEGORY_MISMATCH',
          `Vị trí ${loc.location_code} không nhận Loại kho ${mat?.category} của mã trên dòng lệnh`)
      Object.assign(patch, { to_location_id: loc.id, to_location_code: loc.location_code })
    }

    const { data, error } = await supabase.from('FillTask')
      .update(patch).eq('id', task.id).eq('status', 'PENDING').select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 409, 'NOT_PENDING', 'Dòng vừa đổi trạng thái — tải lại danh sách')
    // Push cho người MỚI được giao (khác chính mình). Multi-select gọi route này song song
    // per-dòng → dùng chung tag theo LỆNH để trình duyệt gộp thành 1 thông báo, không dội chuông N lần.
    if (hasAsg && assignee_id && assignee_id !== selfId(req)) {
      await notifyEmployees([assignee_id], 'ASSIGN', 'assign', {
        title: 'Được giao lệnh fill',
        body: `${req.user?.name ?? 'Quản lý'} giao bạn dòng hạ hàng ${task.material_code ?? ''} — mở lệnh để xem`,
        url: task.fill_order_id ? `/wms/fill/orders/${task.fill_order_id}` : '/wms/fill',
        tag: `fill-asg-${task.fill_order_id ?? task.id}`,
      })   // multi-select giao N dòng song song → 1 dòng feed/lệnh (gộp bằng unique DB)
    }
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── DELETE /wms/fill/tasks/:id — HỦY một dòng (giữ để tra cứu, không xóa cứng) ──
export async function cancelFillTask(req: Request, res: Response) {
  try {
    const { data: task } = await supabase.from('FillTask')
      .select('id, warehouse_id, status, fill_order_id').eq('id', req.params.id).maybeSingle()
    if (!task) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy dòng lệnh fill')
    if (!guardWarehouse(req, res, task.warehouse_id as string)) return
    if (task.status === 'DONE') return fail(res, 409, 'ALREADY_DONE', 'Dòng đã hoàn thành — không hủy được')

    const reason = String((req.body as { reason?: string })?.reason ?? '').trim() || null
    const { data, error } = await supabase.from('FillTask')
      .update({ status: 'CANCELLED', cancel_reason: reason, updated_at: now() })
      .eq('id', task.id).neq('status', 'DONE').select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 409, 'ALREADY_DONE', 'Dòng vừa được hoàn thành — không hủy được')
    // Hủy dòng cuối cùng thì trạng thái LỆNH phải đổi theo (rollup trong DB, tránh drift khi đua)
    if (task.fill_order_id) await supabase.rpc('fill_order_rollup', { p_order_id: task.fill_order_id })
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── DELETE /wms/fill/orders/:id — HỦY cả lệnh (chỉ các dòng còn treo) ───────
export async function cancelFillOrder(req: Request, res: Response) {
  try {
    const { data: order } = await supabase.from('FillOrder')
      .select('id, warehouse_id, status').eq('id', req.params.id).maybeSingle()
    if (!order) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy lệnh fill')
    if (!guardWarehouse(req, res, order.warehouse_id as string)) return
    if (order.status !== 'PENDING') return fail(res, 409, 'NOT_PENDING', 'Lệnh đã xong hoặc đã hủy')

    const reason = String((req.body as { reason?: string })?.reason ?? '').trim() || null
    const { data: cancelled, error } = await supabase.from('FillTask')
      .update({ status: 'CANCELLED', cancel_reason: reason ?? 'Hủy cả lệnh', updated_at: now() })
      .eq('fill_order_id', order.id).eq('status', 'PENDING').select('id')
    if (error) throw error
    // Lệnh của NGÀY không còn tự suy trạng thái từ dòng (nếu không, hạ xong dòng cuối lúc 10h là
    // lệnh đóng, 11h có đơn mới lại phải mở lại một chứng từ đã đóng). Huỷ cả lệnh là hành vi CỦA
    // NGƯỜI nên đặt trạng thái thẳng tay ở đây.
    await supabase.from('FillOrder')
      .update({ status: 'CANCELLED', closed_at: now(), closed_by: req.user?.name || null, updated_at: now() })
      .eq('id', order.id).eq('status', 'PENDING')
    return ok(res, { cancelled: (cancelled ?? []).length })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── PATCH /wms/fill/orders/:id — GÁN NGƯỜI cho CẢ LỆNH NGÀY ────────────────
/**
 * "Lệnh fill có thể được vào gán người, và người đó sẽ nhận kế hoạch cả ngày" (user chốt 15/09).
 * Gán ở cấp LỆNH chứ không phải từng dòng: dòng máy thêm vào lúc 11h tự kế thừa (xem
 * `services/autoFill` → reconcileUp), nên người nhận lúc 7h không phải quay lại nhận lại.
 * Dòng đang treo được kéo theo NGAY — trừ dòng đã giao đích danh người KHÁC (đó là chỉ định riêng).
 */
export async function assignFillOrder(req: Request, res: Response) {
  try {
    const { assignee_id } = req.body as { assignee_id?: string | null }
    if (assignee_id === undefined) return fail(res, 400, 'INVALID_INPUT', 'Không có gì để sửa')
    const { data: order } = await supabase.from('FillOrder')
      .select('id, order_code, warehouse_id, target_date, status, assignee_id').eq('id', req.params.id).maybeSingle()
    if (!order) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy lệnh fill')
    if (!guardWarehouse(req, res, order.warehouse_id as string)) return
    if (order.status !== 'PENDING') return fail(res, 409, 'NOT_PENDING', 'Lệnh đã chốt hoặc đã hủy — không gán được')

    let asg: { id: string; name: string } | null = null
    if (assignee_id) {
      const { data: emp } = await supabase.from('Employee')
        .select('id, name').eq('id', assignee_id).eq('is_active', true).maybeSingle()
      if (!emp) return fail(res, 400, 'INVALID_INPUT', 'Nhân sự không tồn tại hoặc đã nghỉ')
      asg = { id: emp.id as string, name: emp.name as string }
    }
    const t = now()
    const actor = req.user?.name || null
    await supabase.from('FillOrder').update({
      assignee_id: asg?.id ?? null, assignee_name: asg?.name ?? null,
      assigned_by: asg ? actor : null, assigned_at: asg ? t : null, updated_at: t,
    }).eq('id', order.id).eq('status', 'PENDING')

    // Kéo theo dòng đang treo CHƯA GÁN hoặc đang mang tên người giữ kế hoạch CŨ
    const prev = order.assignee_id as string | null
    let q = supabase.from('FillTask').update({
      assignee_id: asg?.id ?? null, assignee_name: asg?.name ?? null,
      assigned_by: asg ? actor : null, assigned_at: asg ? t : null, updated_at: t,
    }).eq('fill_order_id', order.id).eq('status', 'PENDING')
    q = prev ? q.or(`assignee_id.is.null,assignee_id.eq.${prev}`) : q.is('assignee_id', null)
    const { data: moved } = await q.select('id')

    if (asg && asg.id !== selfId(req)) {
      await notifyEmployees([asg.id], 'ASSIGN', 'assign', {
        title: `Kế hoạch fill ${order.order_code}`,
        body: `${actor ?? 'Quản lý'} giao bạn kế hoạch fill CẢ NGÀY ${fmtDMY(String(order.target_date).slice(0, 10))}`,
        url: `/wms/fill/orders/${order.id}`,
        tag: `fill-${order.id}`,
      })
    }
    return ok(res, { assignee_id: asg?.id ?? null, assignee_name: asg?.name ?? null, lines: (moved ?? []).length })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── POST /wms/fill/orders/:id/close — CHỐT NGÀY ────────────────────────────
/**
 * Lệnh của một ngày sống tới lúc được chốt. Không có cron nên đường "tự" là lượt chạy đầu tiên của
 * hôm sau (`closeStaleOrders`); nút này cho người muốn đóng sớm khi ca đã xong.
 */
export async function closeFillOrder(req: Request, res: Response) {
  try {
    const { data: order } = await supabase.from('FillOrder')
      .select('id, warehouse_id, status').eq('id', req.params.id).maybeSingle()
    if (!order) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy lệnh fill')
    if (!guardWarehouse(req, res, order.warehouse_id as string)) return
    const { data } = await supabase.rpc('fill_order_close', {
      p_order_id: order.id, p_actor: req.user?.name || null, p_now: now(),
    })
    const out = data as { code?: string; cancelled_lines?: number; status?: string } | null
    if (out?.code === 'NOT_OPEN') return fail(res, 409, 'NOT_PENDING', 'Lệnh đã chốt hoặc đã hủy')
    if (out?.code !== 'CLOSED')   return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy lệnh fill')
    return ok(res, { cancelled_lines: Number(out.cancelled_lines ?? 0) })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── POST /wms/fill/scan — QUÉT THỰC HIỆN (2 bước: preview → commit) ─────────
// body { qr, warehouse_id, order_id?, to_location_id?, commit?, take_over? }
// · KHÔNG ghim pallet: quét tem BẤT KỲ, hệ thống khớp dòng lệnh theo MÃ + DATE (NSX) của pallet.
// · preview (mặc định): khớp + soi, KHÔNG ghi gì — màn quét hiện dòng lệnh + date yêu cầu +
//   vị trí đến (ĐƯỢC ĐỔI ngay tại đây; đổi sẽ lưu vào dòng lệnh khi commit — phạm vi hẹp đúng
//   tiền lệ `leftover_location_id` bên Xuất: người quét bắt buộc khai được chỗ đặt).
// · commit: chạy RPC fill_scan_apply MỘT transaction (khoá lệnh + khoá sức chứa + ghi vết).
export async function scanFill(req: Request, res: Response) {
  try {
    const { qr, warehouse_id, order_id, to_location_id, commit, take_over } = req.body as {
      qr?: string; warehouse_id?: string; order_id?: string
      to_location_id?: string; commit?: boolean; take_over?: boolean
    }
    if (!qr || !String(qr).trim()) return fail(res, 400, 'INVALID_INPUT', 'Thiếu mã QR')
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, warehouse_id)) return

    const code = normalizeQR(String(qr))
    // Pallet theo tem (kho QTY có thể nhiều dòng cùng pallet_code — lấy hết rồi lọc).
    // Lọc KHO bằng cột warehouse_id TRỰC TIẾP của entry (luật CLAUDE.md) — bản cũ suy kho qua join
    // Location nên pallet CHƯA GÁN VỊ TRÍ (location_id null, phổ biến sau quét nhập) bị chối oan
    // "không tìm thấy trong kho" (user báo 05/08).
    type LocEmb = { warehouse_id: string | null; is_pick_face: boolean | null; location_code: string | null }
    type ScanEntry = {
      id: string; pallet_code: string; material_id: string; location_id: string | null
      warehouse_id: string | null
      status: string; cartons_remaining: number; cartons_reserved: number | null
      production_date: string | null; expiry_date: string | null; shelf_life_days: number | null
      location: LocEmb | LocEmb[] | null
    }
    const { data: entRaw } = await supabase.from('InventoryEntry')
      .select('id, pallet_code, material_id, location_id, warehouse_id, status, cartons_remaining, cartons_reserved, production_date, expiry_date, shelf_life_days, location:Location!location_id(warehouse_id, is_pick_face, location_code)')
      .eq('pallet_code', code).limit(50)
    const all = ((entRaw ?? []) as unknown as ScanEntry[])
      .map(r => ({ ...r, loc: Array.isArray(r.location) ? r.location[0] : r.location }))
    if (!all.length) return fail(res, 404, 'PALLET_NOT_FOUND', 'Không tìm thấy pallet này trong tồn kho — kiểm tra lại tem')
    const whOf = (r: (typeof all)[number]) => r.loc?.warehouse_id ?? r.warehouse_id
    const ents = all.filter(r => whOf(r) === warehouse_id)
    if (!ents.length) {
      // Pallet CÓ tồn nhưng ở kho khác — nói rõ để user biết đang chọn nhầm kho (không nói "không có tồn")
      const otherWh = [...new Set(all.map(whOf).filter(Boolean))] as string[]
      const { data: whs } = await supabase.from('Warehouse').select('name').in('id', otherWh.slice(0, 5))
      const names = (whs ?? []).map(w => w.name as string).join(', ')
      return fail(res, 409, 'WRONG_WAREHOUSE',
        `Pallet đang ở kho ${names || 'khác'} — màn quét đang chọn kho khác. Đổi kho rồi quét lại.`)
    }

    const avail = (e: Record<string, unknown>) =>
      Math.max(0, Number(e.cartons_remaining) - Number(e.cartons_reserved ?? 0))
    const usable = ents.filter(e => !e.loc?.is_pick_face && USABLE.includes(e.status as string) && avail(e) > 0)
    if (!usable.length) {
      if (ents.some(e => e.loc?.is_pick_face)) return fail(res, 409, 'ALREADY_PICK_FACE', 'Pallet đã ở vị trí nhặt lẻ rồi')
      if (ents.some(e => e.status === 'QUARANTINE')) return fail(res, 409, 'BLOCKED', 'Pallet đang bị giữ (QA/block) — không được hạ')
      // Còn tồn nhưng bị GIỮ (reserved) cho đơn xuất/nhặt lẻ ≠ đã xuất hết — nói rõ (user báo 05/08 "có tồn mà bị chối")
      const held = ents.find(e => USABLE.includes(e.status) && Number(e.cartons_remaining) > 0 && Number(e.cartons_reserved ?? 0) > 0)
      if (held) return fail(res, 409, 'RESERVED',
        `Pallet còn tồn nhưng đang bị GIỮ cho đơn xuất/nhặt lẻ (giữ ${Number(held.cartons_reserved)}/${Number(held.cartons_remaining)}) — không còn khả dụng để fill`)
      return fail(res, 409, 'GONE', 'Pallet đã xuất hết / hết khả dụng')
    }

    // Khớp dòng lệnh theo MÃ + DATE: ưu tiên dòng ĐÚNG date, rồi dòng không ràng date
    const matIds = [...new Set(usable.map(e => e.material_id as string))]
    let lq = supabase.from('FillTask')
      .select('*').eq('warehouse_id', warehouse_id).eq('status', 'PENDING')
      .in('material_id', matIds.slice(0, 50)).limit(200)
    if (order_id) lq = lq.eq('fill_order_id', order_id)
    const { data: lineRaw } = await lq
    const pending = (lineRaw ?? []) as Record<string, unknown>[]
    if (!pending.length) {
      return fail(res, 404, 'NO_TASK', order_id
        ? 'Mã hàng trên pallet không có dòng nào đang chờ trong lệnh này'
        : 'Mã hàng trên pallet không có lệnh fill nào đang chờ')
    }
    const dateOf = (e: Record<string, unknown>) =>
      e.production_date ? String(e.production_date).slice(0, 10) : null
    let entry: (typeof usable)[number] | null = null
    let line: Record<string, unknown> | null = null
    outer:
    for (const exact of [true, false]) {
      for (const e of usable) {
        const cands = pending
          .filter(l => l.material_id === e.material_id)
          .filter(l => exact ? l.required_date === dateOf(e) : l.required_date == null)
          .sort((a, b) => String(a.target_date).localeCompare(String(b.target_date))
            || String(a.created_at).localeCompare(String(b.created_at)))
        if (cands.length) { entry = e; line = cands[0]; break outer }
      }
    }
    if (!entry || !line) {
      // Có lệnh cho mã này nhưng DATE không khớp → nói rõ date + %Date yêu cầu (user chốt 05/08)
      const wants = pending.map(l => {
        const pct = computePctDate({
          production_date: l.required_date as string | null,
          expiry_date: l.required_expiry as string | null,
        }, null)
        return `NSX ${fmtDMY(l.required_date as string | null)}${pct !== null ? ` (${pct}%Date)` : ''}`
      })
      return fail(res, 409, 'DATE_MISMATCH',
        `Lệnh yêu cầu ${[...new Set(wants)].join(' hoặc ')} — pallet này NSX ${fmtDMY(dateOf(usable[0]))}. Lấy pallet đúng date yêu cầu.`)
    }

    // Lệnh của người khác → không cướp việc âm thầm; người có quyền `assign` mới nhận lại được
    const me = selfId(req)
    const meName = req.user?.name || null
    const asg = line.assignee_id as string | null
    if (asg && me && asg !== me) {
      if (!take_over) return fail(res, 409, 'NOT_YOUR_TASK', `Dòng lệnh này đã giao cho ${line.assignee_name ?? 'người khác'}`)
      if (!mayFill(req, 'assign')) return fail(res, 403, 'FORBIDDEN', 'Không có quyền nhận lệnh của người khác')
    }

    // Vị trí đến: đổi ngay trong màn quét được (phạm vi hẹp: vị trí nhặt lẻ của kho + nhận loại)
    let destId = line.to_location_id as string
    let destCode = line.to_location_code as string | null
    if (to_location_id && to_location_id !== destId) {
      const { data: loc } = await supabase.from('Location')
        .select('id, location_code, categories').eq('id', to_location_id)
        .eq('warehouse_id', warehouse_id).eq('is_pick_face', true).eq('is_active', true).maybeSingle()
      if (!loc) return fail(res, 400, 'INVALID_INPUT', 'Vị trí đến phải là VỊ TRÍ NHẶT LẺ đang hoạt động của kho này')
      const { data: mat } = await supabase.from('Material')
        .select('category').eq('id', line.material_id as string).maybeSingle()
      if (!locAcceptsCat(loc.categories as string[] | null, (mat?.category as string | null) ?? null))
        return fail(res, 400, 'CATEGORY_MISMATCH', `Vị trí ${loc.location_code} không nhận Loại kho ${mat?.category} của mã này`)
      destId = loc.id as string; destCode = loc.location_code as string
    }

    // Đơn vị của mã (màn quét hiện "N thùng + M hộp")
    const { data: unit } = await supabase.from('Material')
      .select('entry_unit, units_per_carton, base_unit').eq('id', line.material_id as string).maybeSingle()
    const taskOut = { ...line, ...(unit ?? {}) }
    const entryOut = {
      entry_id: entry.id, pallet_code: entry.pallet_code, avail: avail(entry),
      production_date: entry.production_date, expiry_date: entry.expiry_date,
    }
    const willComplete = Number(line.scanned_pallets) + 1 >= Number(line.required_pallets)
      || Number(line.qty_done_base) + avail(entry) >= Number(line.qty_base)

    if (!commit) {
      return ok(res, { preview: true, task: taskOut, entry: entryOut,
        dest: { id: destId, code: destCode }, will_complete: willComplete })
    }

    // COMMIT — một transaction trong DB (khoá dòng lệnh + khoá sức chứa + ghi vết + tiến độ)
    const { data: applied, error: rpcErr } = await supabase.rpc('fill_scan_apply', {
      p_task_id: line.id as string, p_entry_id: entry.id as string, p_to_location_id: destId,
      p_actor_id: me, p_actor_name: meName, p_take_over: !!take_over,
      p_update_date: vnToday(), p_now: now(),
    })
    if (rpcErr) {
      if (rpcErr.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260805d (lệnh fill gom)')
      return fail(res, 500, 'DB_ERROR', rpcErr.message)
    }
    const r = (applied ?? {}) as { code?: string; task?: Record<string, unknown>; scanned_qty?: number; order_status?: string }
    switch (r.code) {
      case 'OK':
        return ok(res, { task: { ...(r.task ?? {}), ...(unit ?? {}) }, entry: entryOut, moved: true,
          scanned_qty: r.scanned_qty, order_status: r.order_status,
          done: (r.task?.status === 'DONE') })
      case 'FULL':
        return fail(res, 400, 'LOCATION_FULL',
          `Vị trí đến ${destCode ?? ''} đã đầy — đổi vị trí đến ngay trên màn quét rồi xác nhận lại`)
      case 'INACTIVE':  return fail(res, 400, 'LOCATION_INACTIVE', 'Vị trí đến không hoạt động')
      case 'NOT_PENDING': return fail(res, 409, 'NOT_PENDING', 'Dòng lệnh vừa được hoàn thành/hủy — quét lại để khớp dòng khác')
      case 'DUP':       return fail(res, 409, 'DUP', 'Pallet này đã được ghi nhận cho dòng lệnh này rồi')
      case 'GONE':      return fail(res, 409, 'GONE', 'Pallet vừa hết khả dụng — quét pallet khác')
      case 'ALREADY_PICK_FACE': return fail(res, 409, 'ALREADY_PICK_FACE', 'Pallet đã ở vị trí nhặt lẻ rồi')
      case 'DATE_MISMATCH': return fail(res, 409, 'DATE_MISMATCH', 'Pallet không đúng date yêu cầu của dòng lệnh')
      case 'WRONG_MATERIAL': return fail(res, 409, 'WRONG_MATERIAL', 'Pallet không đúng mã của dòng lệnh')
      default: return fail(res, 400, 'SCAN_FAILED', `Không thực hiện được (${r.code ?? 'UNKNOWN'})`)
    }
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── GET /wms/fill/report?warehouse_id&date_from&date_to ────────────────────
export async function getFillReport(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>
    if (!q.warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, q.warehouse_id)) return
    for (const d of [q.date_from, q.date_to])
      if (d && !isDay(d)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')

    const { data, error } = await supabase.rpc('fill_report', {
      p_wh_scope: scopeWhIds(req), p_warehouse_id: q.warehouse_id,
      p_from: q.date_from || null, p_to: q.date_to || null,
    })
    if (error) {
      if (error.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260804 (fill hàng)')
      return fail(res, 500, 'DB_ERROR', error.message)
    }
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── GET /wms/fill/pick-face-locations?warehouse_id&material_id ─────────────
// Ô chọn "vị trí đến" — chỉ vị trí nhặt lẻ của kho (danh sách nhỏ, không phải danh mục lớn).
// Có material_id thì lọc luôn theo LOẠI KHO của mã (đừng bày ra lựa chọn mà BE sẽ 400).
export async function listPickFaceLocations(req: Request, res: Response) {
  try {
    const { warehouse_id, material_id } = req.query as Record<string, string>
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, warehouse_id)) return
    let matCat: string | null = null
    if (material_id && UUID_RE.test(material_id)) {
      const { data: mat } = await supabase.from('Material').select('category').eq('id', material_id).maybeSingle()
      matCat = (mat?.category as string | null) ?? null
    }
    let q = supabase.from('Location')
      .select('id, location_code, sub_code, max_pallets')
      .eq('warehouse_id', warehouse_id).eq('is_pick_face', true).eq('is_active', true)
    // Cùng khuôn picker vị trí toàn app: khớp loại HOẶC vị trí chưa khai loại (null-inclusive)
    if (matCat) q = q.or(`categories.cs.{"${safeFilterValue(matCat)}"},categories.is.null`)
    const { data, error } = await q.order('location_code').limit(1000)
    if (error) throw error
    return ok(res, data ?? [])
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}
