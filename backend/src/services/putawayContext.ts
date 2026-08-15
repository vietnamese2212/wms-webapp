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
  putawayRulesOf, putawayNeedsLots, slotFactsOf, EMPTY_SLOT, PUTAWAY_WH_COLS,
  putawayBlock, putawayBlockMessage, isPutawayOverrideReason,
  type PutawayRules, type SlotFacts, type SlotFactsRaw, type IncomingPallet, type PutawayLoc,
} from '../utils/putaway'

// Dòng Location tối thiểu mà luật cần — caller truyền dòng đã nạp sẵn phải có đủ ngần này
export type PutawayLocRow = PutawayLoc & { location_code: string }

export interface PutawayContext {
  rules:      PutawayRules
  principle:  RotationPrinciple
  facts:      Map<string, SlotFacts>   // theo location_id; vắng mặt = ô rỗng
  incoming:   IncomingPallet
  factsOf:    (locationId: string) => SlotFacts
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
  locIds: string[], materialId: string | null, withLots: boolean,
): Promise<SlotFactsRaw[]> {
  const out: SlotFactsRaw[] = []
  for (let i = 0; i < locIds.length; i += 500) {
    const { data, error } = await supabase.rpc('putaway_slot_facts', {
      p_loc_ids: locIds.slice(i, i + 500),
      p_material_id: materialId,
      p_with_lots: withLots,
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
  if (!loc) return { blocked: null, trace: NO_TRACE, warning: null }   // vị trí sai đã có guard riêng ở controller

  const ctx = await loadPutawayContext({
    warehouseId: opts.warehouseId, locIds: [opts.locationId], incoming: opts.incoming,
    material: opts.material,
  })
  const l = loc as { id: string; location_code: string; max_pallets: number | null; slot_no_in: boolean | null; is_pick_face: boolean | null }
  const facts = ctx.factsOf(l.id)
  const block = putawayBlock(l, facts, ctx.incoming, ctx.rules)
  if (!block) return { blocked: null, trace: { putaway_checked: true, putaway_violation: null, putaway_override_reason: null }, warning: null }

  const msg = putawayBlockMessage(block, l.location_code, facts, ctx.rules, ctx.principle)

  // Kho chưa bật "bắt buộc" → hành vi CŨ: vẫn cất được, nhưng ghi vết + nói ra.
  if (!ctx.rules.required)
    return { blocked: block, trace: { putaway_checked: true, putaway_violation: block, putaway_override_reason: null }, warning: msg }

  const reason = typeof opts.overrideReason === 'string' ? opts.overrideReason.trim() : ''
  if (!reason)
    return { error: { code: 'PUTAWAY_VIOLATION', message: `${msg} Kho yêu cầu cất đúng quy tắc — cần người có quyền duyệt cất khác quy tắc.` },
             blocked: block, trace: NO_TRACE, warning: null }
  if (!opts.canOverride)
    return { error: { code: 'FORBIDDEN', message: 'Bạn không có quyền duyệt cất khác quy tắc' }, blocked: block, trace: NO_TRACE, warning: null }
  if (!isPutawayOverrideReason(reason))
    return { error: { code: 'PUTAWAY_REASON_REQUIRED', message: 'Chọn lý do cất khác quy tắc trong danh sách' }, blocked: block, trace: NO_TRACE, warning: null }

  return { blocked: block, trace: { putaway_checked: true, putaway_violation: block, putaway_override_reason: reason }, warning: msg }
}

// Cấu hình kho đổi rất hiếm (form Cài đặt) nhưng bị đọc MỖI LƯỢT QUÉT → cache 30s như getLabelFormat.
// Bật/tắt công tắc có hiệu lực chậm nhất 30s, đổi lại đường quét bớt hẳn 1 round-trip mỗi lượt.
const _whCache = new Map<string, { at: number; row: Record<string, unknown> }>()
async function whConfig(warehouseId: string): Promise<Record<string, unknown>> {
  const hit = _whCache.get(warehouseId)
  if (hit && Date.now() - hit.at < 30_000) return hit.row
  const { data } = await supabase.from('Warehouse')
    .select(`rotation_principle, ${PUTAWAY_WH_COLS}`).eq('id', warehouseId).maybeSingle()
  const row = (data ?? {}) as Record<string, unknown>
  _whCache.set(warehouseId, { at: Date.now(), row })
  return row
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

  return {
    rules, principle, facts,
    incoming: { material_id: incoming.material_id, ncc_id: incoming.ncc_id ?? null, key },
    factsOf: (id: string) => facts.get(id) ?? EMPTY_SLOT,
  }
}
