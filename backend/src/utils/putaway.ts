// QUY TẮC CẤT HÀNG (putaway) — NGUỒN DUY NHẤT của luật "pallet này được cất vào đâu".
//
// Nửa còn lại của utils/rotation.ts: rotation trả lời "lấy pallet nào trước", file này trả lời
// "cất pallet vào ô nào". Trước 15/08 luật cất hàng đã kịp có 3 bản KHÔNG bản nào biết bản kia:
//   1. BE sameMaterialLocIds  — quyết định ô nào LỌT vào 50 dòng trả về
//   2. Inbound.tsx isRecommended — tự đánh ★ + tự sắp xếp lại
//   3. InboundDetail.tsx locRec  — bản chép thứ hai của (2)
// …còn màn quét PDA (InboundScanSheet) KHÔNG có ★ nào cả, chỉ ăn theo thứ tự BE trả về, nên
// công nhân — người thật sự đứng cất hàng — không hề biết vì sao dòng đó nằm trên.
// Và cờ Location.slot_no_in ("cấm đưa hàng vào") thì CHỈ Slotting đọc lúc lập kế hoạch, luồng
// nhập vẫn thản nhiên gợi ý cất vào đó.
//
// Mirror FE (CHỈ nhãn + mã, KHÔNG có luật): frontend/src/utils/putaway.ts.

import { rotationSortKey, ROTATION_DATE_LABEL, type RotationPrinciple, type RotationEntry } from './rotation'
import type { MaterialShelfInfo } from './shelfLife'

// ─── Cấu hình theo kho ───────────────────────────────────────────────────────
export const PUTAWAY_PRIORITIES = ['CONSOLIDATE', 'SPREAD', 'ABC'] as const
export type PutawayPriority = typeof PUTAWAY_PRIORITIES[number]

// Luật trộn date PHÁT BIỂU THEO THỨ TỰ LẤY, không theo "ngày to/nhỏ" — nhờ vậy nó đúng cho cả
// FEFO (so HSD) lẫn FIFO/LIFO (so NSX) mà không cần viết 3 nhánh:
//   OLDER_ONLY = ô chỉ được chứa hàng PHẢI LẤY TRƯỚC pallet mới (kho FEFO: date ngắn hơn/bằng)
//                ⇒ pallet mới đứng sau cùng, KHÔNG chôn hàng cần lấy trước.
//   NEWER_ONLY = ngược lại, ô chỉ chứa hàng lấy sau (kho FEFO: date dài hơn/bằng).
//   SAME       = chỉ được để chung khi TRÙNG date.
export const PUTAWAY_DATE_MIXES = ['ANY', 'SAME', 'NEWER_ONLY', 'OLDER_ONLY'] as const
export type PutawayDateMix = typeof PUTAWAY_DATE_MIXES[number]

export interface PutawayRules {
  priority:        PutawayPriority
  required:        boolean          // đợt B: bật = vi phạm thì CHẶN, tắt = chỉ cảnh báo
  max_materials:   number | null    // null = không giới hạn số mã trong 1 ô
  date_mix:        PutawayDateMix
  block_pick_face: boolean
  block_qa_hold:   boolean
  block_full:      boolean
  single_ncc:      boolean
}

export const PUTAWAY_RULES_DEFAULT: PutawayRules = {
  priority: 'CONSOLIDATE', required: false, max_materials: null, date_mix: 'ANY',
  block_pick_face: false, block_qa_hold: false, block_full: false, single_ncc: false,
}

// Cột cần select ở bảng Warehouse (giữ 1 chỗ để thêm luật mới không phải đi sửa từng controller)
export const PUTAWAY_WH_COLS =
  'putaway_priority, putaway_required, putaway_max_materials, putaway_date_mix,' +
  'putaway_block_pick_face, putaway_block_qa_hold, putaway_block_full, putaway_single_ncc'

// Đọc cấu hình từ 1 dòng Warehouse. Giá trị lạ (DB cũ, cột thiếu) → rơi về mặc định = hành vi cũ.
export function putawayRulesOf(wh: Record<string, unknown> | null | undefined): PutawayRules {
  const w = wh ?? {}
  const pri = w.putaway_priority
  const mix = w.putaway_date_mix
  const maxMat = Number(w.putaway_max_materials)
  return {
    priority: (PUTAWAY_PRIORITIES as readonly unknown[]).includes(pri) ? pri as PutawayPriority : 'CONSOLIDATE',
    required: w.putaway_required === true,
    max_materials: Number.isFinite(maxMat) && maxMat >= 1 ? Math.floor(maxMat) : null,
    date_mix: (PUTAWAY_DATE_MIXES as readonly unknown[]).includes(mix) ? mix as PutawayDateMix : 'ANY',
    block_pick_face: w.putaway_block_pick_face === true,
    block_qa_hold:   w.putaway_block_qa_hold === true,
    block_full:      w.putaway_block_full === true,
    single_ncc:      w.putaway_single_ncc === true,
  }
}

// Nhận cấu hình từ body form Kho → patch. MỘT chỗ cho cả create lẫn update: 7 cờ mà chép tay 2
// nơi thì sớm muộn cũng quên một cái ở một bên (DB CHECK là lưới cuối, không phải lưới đầu).
// Trả về mã lỗi nếu giá trị sai, null nếu OK.
export function applyPutawayBody(
  body: Record<string, unknown>, target: Record<string, unknown>,
): string | null {
  if (body.putaway_priority !== undefined) {
    if (!(PUTAWAY_PRIORITIES as readonly unknown[]).includes(body.putaway_priority))
      return 'Chiến thuật cất hàng không hợp lệ'
    target.putaway_priority = body.putaway_priority
  }
  if (body.putaway_date_mix !== undefined) {
    if (!(PUTAWAY_DATE_MIXES as readonly unknown[]).includes(body.putaway_date_mix))
      return 'Luật trộn date không hợp lệ'
    target.putaway_date_mix = body.putaway_date_mix
  }
  if (body.putaway_max_materials !== undefined) {
    const v = body.putaway_max_materials
    if (v === null || v === '') target.putaway_max_materials = null
    else {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 1) return 'Số mã tối đa trong 1 vị trí phải là số nguyên ≥ 1'
      target.putaway_max_materials = Math.floor(n)
    }
  }
  for (const k of ['putaway_required', 'putaway_block_pick_face', 'putaway_block_qa_hold',
                   'putaway_block_full', 'putaway_single_ncc'] as const) {
    if (body[k] !== undefined) target[k] = Boolean(body[k])
  }
  return null
}

// Kho có bật luật nào cần biết ngày của hàng đang nằm trong ô không (quyết định có xin `lots` của
// RPC hay không — tắt thì payload bằng 0).
export function putawayNeedsLots(rules: PutawayRules): boolean {
  return rules.date_mix !== 'ANY'
}

// ─── Lý do CHẶN — danh sách cố định, có nhãn để hiện thẳng cho người quét ────
export const PUTAWAY_BLOCKS = [
  { code: 'NO_IN',         label: 'Vị trí không nhận hàng vào' },
  { code: 'FULL',          label: 'Vị trí đã đầy' },
  { code: 'PICK_FACE',     label: 'Vị trí nhặt lẻ — không cất pallet nguyên' },
  { code: 'QA_HOLD',       label: 'Đang có pallet bị QA giữ' },
  { code: 'MAX_MATERIALS', label: 'Vượt số mã tối đa cho một vị trí' },
  { code: 'NCC_MIX',       label: 'Khác NCC với hàng đang để' },
  { code: 'DATE_MIX',      label: 'Date không hợp luật trộn của kho' },
] as const
export type PutawayBlockCode = typeof PUTAWAY_BLOCKS[number]['code']

export const PUTAWAY_REASONS = [
  { code: 'SAME_MATERIAL', label: 'Đang để dở cùng mã' },
  { code: 'EMPTY',         label: 'Vị trí còn trống' },
] as const
export type PutawayReasonCode = typeof PUTAWAY_REASONS[number]['code']

// ─── Sự thật của một ô (từ RPC putaway_slot_facts) ───────────────────────────
// `lots` = các NHÓM (mã, NCC, shelf-life, có-HSD-tường-minh) kèm min/max ngày trong nhóm.
// Trong 1 nhóm shelf-life là hằng số ⇒ min/max NSX cho ra đúng min/max HSD suy diễn, nên chỉ cần
// 2 mốc là dựng được khoảng ngày của cả ô mà không kéo từng pallet về.
export interface SlotLot {
  m: string; n: string | null; s: number | null; no_exp: boolean
  pmin: string | null; pmax: string | null
  emin: string | null; emax: string | null
}
export interface SlotFactsRaw {
  location_id: string; pallets: number; materials: number
  same_material: boolean; qa_hold: boolean; nccs: string[] | null; lots: SlotLot[] | null
}

export interface SlotFacts {
  pallets:       number
  materials:     number
  sameMaterial:  boolean
  qaHold:        boolean
  nccs:          string[]
  keyMin:        number | null   // thứ tự lấy SỚM nhất đang có trong ô (null = không đủ dữ liệu)
  keyMax:        number | null
}
export const EMPTY_SLOT: SlotFacts = {
  pallets: 0, materials: 0, sameMaterial: false, qaHold: false, nccs: [], keyMin: null, keyMax: null,
}

// Quy `lots` về [keyMin, keyMax] bằng ĐÚNG hàm rotationSortKey — không tự so ngày ở đây.
export function slotFactsOf(
  raw: SlotFactsRaw,
  principle: RotationPrinciple,
  materialById: Map<string, MaterialShelfInfo>,
): SlotFacts {
  let keyMin: number | null = null
  let keyMax: number | null = null
  for (const lot of raw.lots ?? []) {
    const mat = materialById.get(lot.m) ?? null
    // 2 mốc của nhóm: đầu và cuối. Nhóm có HSD tường minh dùng emin/emax, nhóm suy từ NSX dùng pmin/pmax.
    const ends: RotationEntry[] = lot.no_exp
      ? [{ production_date: lot.pmin, shelf_life_days: lot.s, ncc_id: lot.n },
         { production_date: lot.pmax, shelf_life_days: lot.s, ncc_id: lot.n }]
      : [{ production_date: lot.pmin, expiry_date: lot.emin, shelf_life_days: lot.s, ncc_id: lot.n },
         { production_date: lot.pmax, expiry_date: lot.emax, shelf_life_days: lot.s, ncc_id: lot.n }]
    for (const e of ends) {
      const k = rotationSortKey(e, mat, principle)
      if (k == null) continue
      if (keyMin == null || k < keyMin) keyMin = k
      if (keyMax == null || k > keyMax) keyMax = k
    }
  }
  return {
    pallets: Number(raw.pallets ?? 0),
    materials: Number(raw.materials ?? 0),
    sameMaterial: raw.same_material === true,
    qaHold: raw.qa_hold === true,
    nccs: (raw.nccs ?? []).filter(Boolean),
    keyMin, keyMax,
  }
}

// ─── Vị trí ứng viên + pallet sắp cất ────────────────────────────────────────
export interface PutawayLoc {
  id:           string
  max_pallets?: number | null   // <= 0 = không giới hạn sức chứa (nhiều khu đang khai 0)
  slot_no_in?:  boolean | null
  is_pick_face?: boolean | null
}
export interface IncomingPallet {
  material_id: string
  ncc_id:      string | null
  key:         number | null    // rotationSortKey của chính pallet sắp cất (null = không đủ dữ liệu)
}

export function isSlotFull(loc: PutawayLoc, facts: SlotFacts): boolean {
  const cap = Number(loc.max_pallets ?? 0)
  return cap > 0 && facts.pallets >= cap
}

// Lý do CHẶN đầu tiên gặp phải, null = cất được.
// Thứ tự kiểm = thứ tự dễ hiểu với người quét: cấm hẳn → hết chỗ → sai công năng → nội dung ô.
export function putawayBlock(
  loc: PutawayLoc, facts: SlotFacts, incoming: IncomingPallet, rules: PutawayRules,
): PutawayBlockCode | null {
  // slot_no_in KHÔNG phụ thuộc cờ cấu hình nào: đánh dấu "cấm đưa hàng vào" là đã nói rõ ý định.
  if (loc.slot_no_in === true) return 'NO_IN'
  if (rules.block_full && isSlotFull(loc, facts)) return 'FULL'
  if (rules.block_pick_face && loc.is_pick_face === true) return 'PICK_FACE'
  if (rules.block_qa_hold && facts.qaHold) return 'QA_HOLD'
  // Mã mới làm tăng số mã trong ô; mã đã có sẵn thì không.
  if (rules.max_materials != null && !facts.sameMaterial && facts.materials >= rules.max_materials)
    return 'MAX_MATERIALS'
  // null-inclusive: pallet hoặc hàng trong ô chưa khai NCC → không kết luận
  if (rules.single_ncc && incoming.ncc_id && facts.nccs.some(n => n !== incoming.ncc_id))
    return 'NCC_MIX'
  if (rules.date_mix !== 'ANY' && incoming.key != null && facts.keyMin != null && facts.keyMax != null) {
    const k = incoming.key
    const bad =
      rules.date_mix === 'SAME'       ? !(facts.keyMin === k && facts.keyMax === k)
      : rules.date_mix === 'OLDER_ONLY' ? facts.keyMax > k    // có hàng phải lấy SAU pallet mới ⇒ bị chôn
      :                                   facts.keyMin < k    // NEWER_ONLY
    if (bad) return 'DATE_MIX'
  }
  return null
}

// ★ = vì sao ô này được đẩy lên đầu. Chỉ đánh cho ô CẤT ĐƯỢC (đánh ★ vào ô bị chặn là chỉ người
// ta tới chỗ không cất được — đúng lỗi mà rotation gặp 14/08 với pallet bị QA giữ).
export function putawayReason(
  loc: PutawayLoc, facts: SlotFacts, incoming: IncomingPallet, rules: PutawayRules,
): PutawayReasonCode | null {
  if (putawayBlock(loc, facts, incoming, rules) != null) return null
  if (rules.priority === 'SPREAD') return facts.pallets === 0 ? 'EMPTY' : null
  // CONSOLIDATE (và ABC ở đợt C dùng lại làm tie-break)
  return facts.sameMaterial ? 'SAME_MATERIAL' : null
}

// Điểm sắp xếp — NHỎ HƠN đứng trước. Ô bị chặn luôn xuống cuối.
export function putawayScore(
  loc: PutawayLoc, facts: SlotFacts, incoming: IncomingPallet, rules: PutawayRules,
): number {
  if (putawayBlock(loc, facts, incoming, rules) != null) return 100
  if (rules.priority === 'SPREAD') {
    const cap = Number(loc.max_pallets ?? 0)
    // Ô không khai sức chứa coi như rộng nhất (0 = không giới hạn), ô trống đứng trước ô đã có hàng.
    const freeRatio = cap > 0 ? Math.max(0, (cap - facts.pallets) / cap) : 1
    return 10 - freeRatio            // 9..10 → luôn đứng trước 100, sau nhóm ★
  }
  return facts.sameMaterial ? 0 : 10
}

// Nhãn của luật trộn date phụ thuộc kho chạy FEFO hay FIFO/LIFO ("date" là HSD hay NSX).
export function putawayDateMixLabel(mix: PutawayDateMix, principle: RotationPrinciple): string {
  const d = ROTATION_DATE_LABEL[principle]
  switch (mix) {
    case 'SAME':       return `Chỉ để chung khi trùng ${d}`
    case 'OLDER_ONLY': return `Chỉ để chung với hàng phải lấy trước (${d} ngắn hơn hoặc bằng)`
    case 'NEWER_ONLY': return `Chỉ để chung với hàng lấy sau (${d} dài hơn hoặc bằng)`
    default:           return 'Không ràng buộc'
  }
}

// Khối BE trả kèm MỖI vị trí — FE chỉ hiển thị, KHÔNG tự tính lại (bài học 4 bản chép tay).
export interface PutawayHint {
  blocked: PutawayBlockCode | null
  reason:  PutawayReasonCode | null
}
