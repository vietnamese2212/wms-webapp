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
  type PutawayRules, type SlotFacts, type SlotFactsRaw, type IncomingPallet,
} from '../utils/putaway'

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

export async function loadPutawayContext(opts: {
  warehouseId: string | null
  locIds:      string[]
  incoming:    IncomingInput
}): Promise<PutawayContext> {
  const { warehouseId, locIds, incoming } = opts

  const { data: whRow } = warehouseId
    ? await supabase.from('Warehouse')
        .select(`rotation_principle, ${PUTAWAY_WH_COLS}`)
        .eq('id', warehouseId).maybeSingle()
    : { data: null }
  const wh = (whRow ?? {}) as Record<string, unknown>
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
    const { data: mat } = await supabase.from('Material').select(MAT_SHELF_COLS)
      .eq('id', incoming.material_id).maybeSingle()
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
