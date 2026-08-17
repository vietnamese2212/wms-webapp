// Nạp dữ liệu để CHẤM một loạt vị trí theo quy tắc cất hàng của kho.
// Tách khỏi utils/putaway.ts (thuần logic, không đụng DB) để cả 2 phía dùng CHUNG một đường nạp:
//   - đợt A: picker vị trí (listLocations) — chấm ★ / chặn ngay trên danh sách
//   - đợt B: các cửa GHI (scanQR / scanManual / setOrderLocation) — chặn thật
// Nếu để mỗi bên tự nạp thì đúng 2 tuần nữa lại có 2 bản luật lệch nhau.

import { supabase } from '../lib/supabase'
import { fetchAllByIdChunks } from '../utils/pagination'
import { asRotationPrinciple, rotationSortKey, type RotationPrinciple } from '../utils/rotation'
import type { MaterialShelfInfo } from '../utils/shelfLife'
import {
  putawayRulesOf, putawayNeedsLots, putawayNeedsMats, slotFactsOf, EMPTY_SLOT, PUTAWAY_WH_COLS,
  putawayBlock, putawayBlockBatch, putawayBlockMessage, isPutawayOverrideReason, PUTAWAY_RULES_DEFAULT,
  putawayEnforces, NO_ABC,
  type PutawayRules, type SlotFacts, type SlotFactsRaw, type IncomingPallet, type PutawayLoc, type PutawayAbc,
} from '../utils/putaway'
import { targetZoneCodes, type Band, type BandZone } from '../utils/slottingBands'

// Dòng Location tối thiểu mà luật cần — caller truyền dòng đã nạp sẵn phải có đủ ngần này
export type PutawayLocRow = PutawayLoc & { location_code: string }

export interface PutawayContext {
  rules:      PutawayRules
  principle:  RotationPrinciple
  facts:      Map<string, SlotFacts>   // theo location_id; vắng mặt = ô rỗng
  incoming:   IncomingPallet
  factsOf:    (locationId: string) => SlotFacts
  abc:        PutawayAbc               // chỉ có nội dung khi kho chạy chiến thuật ABC
}

// Pallet sắp cất. Ở picker (đợt A) chưa quét QR nên KHÔNG có ngày → luật trộn date im lặng
// (không đủ dữ liệu thì không kết luận, đúng kỷ luật của rotation). Ở cửa ghi thì có đủ.
export interface IncomingInput {
  material_id:      string
  ncc_id?:          string | null
  production_date?: string | Date | null
  expiry_date?:     string | Date | null
  shelf_life_days?: number | null
}

const MAT_SHELF_COLS = 'id, shelf_life_days, supplier_shelf_life_overrides'

// Sự thật của các ô, gom trong SQL — MỘT dòng/ô thay vì kéo từng pallet về đếm.
// (Bàu Bàng 1.517 vị trí = 15.009 dòng tồn nếu kéo về; RPC trả tối đa 1.517 dòng.)
// Danh sách id đi trong BODY của RPC nên KHÔNG dính trần ~300 id trên URL.
export async function loadSlotFactsRaw(
  locIds: string[], materialId: string | null, withLots: boolean, withMats = false,
): Promise<SlotFactsRaw[]> {
  const out: SlotFactsRaw[] = []
  for (let i = 0; i < locIds.length; i += 500) {
    const { data, error } = await supabase.rpc('putaway_slot_facts', {
      p_loc_ids: locIds.slice(i, i + 500),
      p_material_id: materialId,
      p_with_lots: withLots,
      p_with_mats: withMats,
    })
    if (error) throw error
    out.push(...((data ?? []) as SlotFactsRaw[]))
  }
  return out
}

// ─── CỬA GHI (đợt B) ─────────────────────────────────────────────────────────
// Lọc ở picker chỉ là GỢI Ý — gọi thẳng API vẫn cất được, nên điểm chặn thật phải nằm ở đây.
// Trả về vết để caller ghi kèm bản ghi tồn; `error` khác null = phải dừng.
export interface PutawayGuardResult {
  error?:  { code: string; message: string }
  // Mã luật bị vi phạm — LUÔN có, kể cả khi chặn (đường `error` không ghi vết nên nếu chỉ đọc
  // trace thì màn preview mất mã lý do, chỉ còn câu văn; FE cần mã để hiển thị theo từng luật).
  blocked: string | null
  // Cấu hình đang hiệu lực — caller cần để chốt lại ràng buộc ĐẾM dưới row-lock của RPC
  rules:   PutawayRules
  trace:   { putaway_checked: boolean; putaway_violation: string | null; putaway_override_reason: string | null }
  warning: string | null     // kho CHƯA bật bắt buộc: cho qua nhưng nói ra
}

export async function guardPutaway(opts: {
  warehouseId:    string | null
  locationId:     string
  incoming:       IncomingInput
  overrideReason?: unknown
  canOverride:    boolean
  // Dòng ĐÃ NẠP SẴN của caller — truyền vào để KHỎI hỏi lại. Quét nhập là đường ghi nóng nhất của
  // app và pool PostgREST chỉ ~10 khe: 3 request thừa mỗi lượt quét làm chậm CẢ APP, không riêng
  // màn quét. `scanQR` đã có sẵn cả 2 dòng này trong Promise.all ngay phía trên.
  loc?:      PutawayLocRow | null
  material?: MaterialShelfInfo | null
}): Promise<PutawayGuardResult> {
  const NO_TRACE = { putaway_checked: false, putaway_violation: null, putaway_override_reason: null }
  const loc = opts.loc ?? (await supabase.from('Location')
    .select('id, location_code, max_pallets, slot_no_in, is_pick_face')
    .eq('id', opts.locationId).maybeSingle()).data
  if (!loc) return { blocked: null, rules: PUTAWAY_RULES_DEFAULT, trace: NO_TRACE, warning: null }   // vị trí sai đã có guard riêng ở controller

  const ctx = await loadPutawayContext({
    warehouseId: opts.warehouseId, locIds: [opts.locationId], incoming: opts.incoming,
    material: opts.material,
  })
  const l = loc as { id: string; location_code: string; max_pallets: number | null; slot_no_in: boolean | null; is_pick_face: boolean | null }
  const facts = ctx.factsOf(l.id)
  const block = putawayBlock(l, facts, ctx.incoming, ctx.rules)
  if (!block) return { blocked: null, rules: ctx.rules, trace: { putaway_checked: true, putaway_violation: null, putaway_override_reason: null }, warning: null }

  const msg = putawayBlockMessage(block, l.location_code, facts, ctx.rules, ctx.principle)

  // Luật này chỉ ở mức CẢNH BÁO → vẫn cất được, nhưng ghi vết + nói ra (không im lặng).
  if (!putawayEnforces(ctx.rules, block))
    return { blocked: block, rules: ctx.rules, trace: { putaway_checked: true, putaway_violation: block, putaway_override_reason: null }, warning: msg }

  const reason = typeof opts.overrideReason === 'string' ? opts.overrideReason.trim() : ''
  if (!reason)
    return { error: { code: 'PUTAWAY_VIOLATION', message: `${msg} Kho yêu cầu cất đúng quy tắc — cần người có quyền duyệt cất khác quy tắc.` },
             blocked: block, rules: ctx.rules, trace: NO_TRACE, warning: null }
  if (!opts.canOverride)
    return { error: { code: 'FORBIDDEN', message: 'Bạn không có quyền duyệt cất khác quy tắc' }, blocked: block, rules: ctx.rules, trace: NO_TRACE, warning: null }
  if (!isPutawayOverrideReason(reason))
    return { error: { code: 'PUTAWAY_REASON_REQUIRED', message: 'Chọn lý do cất khác quy tắc trong danh sách' }, blocked: block, rules: ctx.rules, trace: NO_TRACE, warning: null }

  return { blocked: block, rules: ctx.rules, trace: { putaway_checked: true, putaway_violation: block, putaway_override_reason: reason }, warning: msg }
}

// ─── CỬA GHI cất NHIỀU pallet một lượt (đợt D) ───────────────────────────────
// "Chuyển vị trí hàng loạt" (trang Tồn kho) đẩy N pallet vào MỘT ô trong một request. Không thể
// gọi `guardPutaway` N lần: mỗi lần sẽ đọc lại sự thật của ô ở trạng thái CHƯA có pallet nào của
// lô ⇒ ràng buộc trên tập (số mã, một NCC) bị vô hiệu. Nạp sự thật MỘT lần rồi chấm cả lô.
export async function guardPutawayBatch(opts: {
  warehouseId:     string | null
  locationId:      string
  entries:         IncomingInput[]
  overrideReason?: unknown
  canOverride:     boolean
}): Promise<PutawayGuardResult> {
  const NO_TRACE = { putaway_checked: false, putaway_violation: null, putaway_override_reason: null }
  const { data: loc } = await supabase.from('Location')
    .select('id, location_code, max_pallets, slot_no_in, is_pick_face')
    .eq('id', opts.locationId).maybeSingle()
  // Vị trí sai/không tồn tại đã có guard riêng trong RPC move (NOT_FOUND/INACTIVE)
  if (!loc || opts.entries.length === 0)
    return { blocked: null, rules: PUTAWAY_RULES_DEFAULT, trace: NO_TRACE, warning: null }
  const l = loc as PutawayLocRow

  const wh = opts.warehouseId ? await whConfig(opts.warehouseId) : {}
  const rules = putawayRulesOf(wh)
  const principle = asRotationPrinciple(wh.rotation_principle)

  const raws = await loadSlotFactsRaw(
    [opts.locationId], null, putawayNeedsLots(rules), putawayNeedsMats(rules))

  // Shelf-life của mã trong ô LẪN mã của lô — một lượt hỏi, chunk 300 theo luật id-trên-URL
  const matIds = [...new Set([
    ...raws.flatMap(r => (r.lots ?? []).map(x => x.m)),
    ...opts.entries.map(e => e.material_id),
  ].filter(Boolean))]
  const matById = new Map<string, MaterialShelfInfo>()
  if (matIds.length > 0) {
    const rows = await fetchAllByIdChunks(matIds, chunk =>
      supabase.from('Material').select(MAT_SHELF_COLS).in('id', chunk))
    for (const m of rows as ({ id: string } & MaterialShelfInfo)[]) matById.set(m.id, m)
  }

  const facts = raws[0] ? slotFactsOf(raws[0], principle, matById) : EMPTY_SLOT
  const batch: IncomingPallet[] = opts.entries.map(e => ({
    material_id: e.material_id,
    ncc_id:      e.ncc_id ?? null,
    key: (e.production_date || e.expiry_date)
      ? rotationSortKey(
          { production_date: e.production_date ?? null, expiry_date: e.expiry_date ?? null,
            shelf_life_days: e.shelf_life_days ?? null, ncc_id: e.ncc_id ?? null },
          matById.get(e.material_id) ?? null, principle)
      : null,
  }))

  const block = putawayBlockBatch(l, facts, batch, rules)
  if (!block)
    return { blocked: null, rules, trace: { putaway_checked: true, putaway_violation: null, putaway_override_reason: null }, warning: null }

  const after = block === 'MAX_MATERIALS'
    ? new Set([...facts.mats, ...batch.map(b => b.material_id)]).size : undefined
  const msg = putawayBlockMessage(block, l.location_code, facts, rules, principle, after)
  if (!putawayEnforces(rules, block))
    return { blocked: block, rules, trace: { putaway_checked: true, putaway_violation: block, putaway_override_reason: null }, warning: msg }

  const reason = typeof opts.overrideReason === 'string' ? opts.overrideReason.trim() : ''
  if (!reason)
    return { error: { code: 'PUTAWAY_VIOLATION', message: `${msg} Kho yêu cầu cất đúng quy tắc — cần người có quyền duyệt cất khác quy tắc.` },
             blocked: block, rules, trace: NO_TRACE, warning: null }
  if (!opts.canOverride)
    return { error: { code: 'FORBIDDEN', message: 'Bạn không có quyền duyệt cất khác quy tắc' }, blocked: block, rules, trace: NO_TRACE, warning: null }
  if (!isPutawayOverrideReason(reason))
    return { error: { code: 'PUTAWAY_REASON_REQUIRED', message: 'Chọn lý do cất khác quy tắc trong danh sách' }, blocked: block, rules, trace: NO_TRACE, warning: null }

  return { blocked: block, rules, trace: { putaway_checked: true, putaway_violation: block, putaway_override_reason: reason }, warning: msg }
}

// Cấu hình kho đổi rất hiếm (form Cài đặt) nhưng bị đọc MỖI LƯỢT QUÉT → cache 30s, cùng khuôn với
// `getLabelFormat` / getter trong utils/settings (mẫu đã dùng khắp app).
// Lưu form Kho gọi `invalidatePutawayConfig` nên bình thường có hiệu lực NGAY. Serverless nhiều
// instance thì instance khác vẫn có thể giữ bản cũ tối đa 30s — chấp nhận được cho một công tắc
// vận hành, nhưng phải BIẾT: vừa bật "bắt buộc" xong mà lượt quét kế lọt qua thì đó là cache,
// không phải luật hỏng. (Chính điều này làm 6 phép kiểm của gói QA 26 đỏ khi nó ghi thẳng DB —
// gói đã sửa để đổi cấu hình QUA API như người dùng thật.)
const _whCache = new Map<string, { at: number; row: Record<string, unknown> }>()

export function invalidatePutawayConfig(warehouseId: string): void {
  _whCache.delete(warehouseId)
}
async function whConfig(warehouseId: string): Promise<Record<string, unknown>> {
  const hit = _whCache.get(warehouseId)
  if (hit && Date.now() - hit.at < 30_000) return hit.row
  const { data } = await supabase.from('Warehouse')
    .select(`rotation_principle, ${PUTAWAY_WH_COLS}`).eq('id', warehouseId).maybeSingle()
  const row = (data ?? {}) as Record<string, unknown>
  _whCache.set(warehouseId, { at: Date.now(), row })
  return row
}

// ─── Chiến thuật ABC (đợt C) ─────────────────────────────────────────────────
// ABC là hạng TƯƠNG ĐỐI trong (kho, cửa sổ ngày) nên phải tính trên CẢ kho — không thể hỏi riêng
// một mã. Cửa sổ chốt 30 ngày (bằng mặc định trang Tối ưu vị trí) để hai bên nói cùng một hạng.
// Cache 5 phút: bản đồ nhỏ (đo staging: 132 và 416 mã) mà nếu không cache thì MỖI PHÍM GÕ ở ô chọn
// vị trí bắt DB chạy lại một câu tổng hợp toàn kho.
const ABC_DAYS = 30
const _abcCache  = new Map<string, { at: number; map: Map<string, { abc: Band; category: string | null }> }>()
const _zoneCache = new Map<string, { at: number; zones: BandZone[] }>()

async function abcMapOf(warehouseId: string): Promise<Map<string, { abc: Band; category: string | null }>> {
  const hit = _abcCache.get(warehouseId)
  if (hit && Date.now() - hit.at < 300_000) return hit.map
  const { data } = await supabase.rpc('material_abc', {
    p_warehouse_id: warehouseId, p_categories: null, p_days: ABC_DAYS,
  })
  const map = new Map<string, { abc: Band; category: string | null }>()
  for (const r of (data ?? []) as { material_id: string; abc: string; category: string | null }[])
    map.set(r.material_id, { abc: (r.abc === 'A' || r.abc === 'B' ? r.abc : 'C'), category: r.category })
  _abcCache.set(warehouseId, { at: Date.now(), map })
  return map
}

async function zonesOf(warehouseId: string): Promise<BandZone[]> {
  const hit = _zoneCache.get(warehouseId)
  if (hit && Date.now() - hit.at < 300_000) return hit.zones
  const { data } = await supabase.from('WarehouseZone')
    .select('code, categories, pick_rank').eq('warehouse_id', warehouseId).eq('is_active', true)
  const zones = (data ?? []) as BandZone[]
  _zoneCache.set(warehouseId, { at: Date.now(), zones })
  return zones
}

// Cấu hình khu (hạng nhặt) đổi ở trang Tối ưu vị trí → xoá cache để có hiệu lực ngay
export function invalidatePutawayZones(warehouseId: string): void {
  _zoneCache.delete(warehouseId)
}

/**
 * KHU ĐÍCH theo chiến thuật ABC của kho cho một mã — trả [] nếu kho không chạy ABC hoặc mã chưa
 * có hạng. Tách riêng để ô chọn vị trí biết khu đích **TRƯỚC KHI CẮT DANH SÁCH**.
 *
 * Vì sao cần: picker lấy `limit` dòng ĐẦU theo mã vị trí rồi mới chấm điểm ⇒ khu đích nằm cuối
 * bảng chữ cái bị cắt gần hết, đúng cái khu mà ABC muốn người ta cất vào. Đo thật 17/08 (Ba Vì,
 * 236 vị trí, band C = TP3): limit=200 chỉ lọt 6/41 vị trí TP3 (5 dòng ★), limit=300 mới đủ 41
 * (38 dòng ★). Kho 1.517 vị trí thì mọi limit hợp lý đều cắt mất khu đích.
 * Dùng lại 2 cache sẵn có (bản đồ ABC 5 phút + khu 5 phút) nên KHÔNG thêm round-trip.
 */
export async function putawayTargetZones(warehouseId: string | null, materialId: string | null): Promise<string[]> {
  if (!warehouseId || !materialId) return []
  const rules = putawayRulesOf(await whConfig(warehouseId))
  if (rules.priority !== 'ABC') return []
  const [map, zones] = await Promise.all([abcMapOf(warehouseId), zonesOf(warehouseId)])
  const row = map.get(materialId)
  return row ? targetZoneCodes(zones, { category: row.category }, row.abc) : []
}

export async function loadPutawayContext(opts: {
  warehouseId: string | null
  locIds:      string[]
  incoming:    IncomingInput
  material?:   MaterialShelfInfo | null   // dòng Material đã nạp sẵn của caller (khỏi hỏi lại)
}): Promise<PutawayContext> {
  const { warehouseId, locIds, incoming } = opts

  const wh = warehouseId ? await whConfig(warehouseId) : {}
  const rules = putawayRulesOf(wh)
  const principle = asRotationPrinciple(wh.rotation_principle)

  const facts = new Map<string, SlotFacts>()
  if (locIds.length > 0) {
    const withLots = putawayNeedsLots(rules)
    const raws = await loadSlotFactsRaw(locIds, incoming.material_id || null, withLots)

    // Shelf-life của các mã ĐANG NẰM trong ô — chỉ cần khi phải so ngày (luật trộn date bật).
    const matById = new Map<string, MaterialShelfInfo>()
    if (withLots) {
      const ids = [...new Set(raws.flatMap(r => (r.lots ?? []).map(l => l.m)).filter(Boolean))]
      if (ids.length > 0) {
        const rows = await fetchAllByIdChunks(ids, chunk =>
          supabase.from('Material').select(MAT_SHELF_COLS).in('id', chunk))
        for (const m of rows as ({ id: string } & MaterialShelfInfo)[]) matById.set(m.id, m)
      }
    }
    for (const raw of raws) facts.set(raw.location_id, slotFactsOf(raw, principle, matById))
  }

  // Khóa luân chuyển của chính pallet sắp cất — tính bằng ĐÚNG rotationSortKey, không tự so ngày.
  let key: number | null = null
  if (incoming.production_date || incoming.expiry_date) {
    const mat = opts.material ?? (await supabase.from('Material').select(MAT_SHELF_COLS)
      .eq('id', incoming.material_id).maybeSingle()).data
    key = rotationSortKey(
      {
        production_date: incoming.production_date ?? null,
        expiry_date:     incoming.expiry_date ?? null,
        shelf_life_days: incoming.shelf_life_days ?? null,
        ncc_id:          incoming.ncc_id ?? null,
      },
      (mat ?? null) as MaterialShelfInfo | null,
      principle,
    )
  }

  // Chiến thuật ABC: hạng của mã + khu nên cất. Chỉ nạp khi kho THẬT SỰ chạy ABC.
  let abc: PutawayAbc = NO_ABC
  if (rules.priority === 'ABC' && warehouseId && incoming.material_id) {
    const [map, zones] = await Promise.all([abcMapOf(warehouseId), zonesOf(warehouseId)])
    const row = map.get(incoming.material_id)
    // Mã chưa có tồn/lượt nhặt nào trong kho → không có hạng → xuống thang về Gom (targetZones rỗng)
    if (row) abc = { abc: row.abc, targetZones: targetZoneCodes(zones, { category: row.category }, row.abc) }
  }

  return {
    rules, principle, facts, abc,
    incoming: { material_id: incoming.material_id, ncc_id: incoming.ncc_id ?? null, key },
    factsOf: (id: string) => facts.get(id) ?? EMPTY_SLOT,
  }
}
