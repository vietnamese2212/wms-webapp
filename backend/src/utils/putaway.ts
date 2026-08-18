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
  // Mã luật bị CHẶN CỨNG. Luật có chấm nhưng không nằm trong đây = chỉ cảnh báo + loại khỏi gợi ý.
  // Cố ý KHÔNG còn trường `required` chung: một công tắc không diễn đạt được hai ý định trái chiều
  // của cùng một kho ("cấm ngoài đường" chỉ muốn hết gợi ý · "trộn date" muốn chặn thật).
  enforced:        PutawayBlockCode[]
  max_materials:   number | null    // null = không giới hạn số mã trong 1 ô
  date_mix:        PutawayDateMix
  block_pick_face: boolean
  block_qa_hold:   boolean
  block_full:      boolean
  single_ncc:      boolean
}

export const PUTAWAY_RULES_DEFAULT: PutawayRules = {
  priority: 'CONSOLIDATE', enforced: [], max_materials: null, date_mix: 'ANY',
  block_pick_face: false, block_qa_hold: false, block_full: false, single_ncc: false,
}

// Luật này có bị CHẶN CỨNG ở kho đó không (khác với "có chấm hay không")
export function putawayEnforces(rules: PutawayRules, code: PutawayBlockCode): boolean {
  return rules.enforced.includes(code)
}

// Cột cần select ở bảng Warehouse (giữ 1 chỗ để thêm luật mới không phải đi sửa từng controller)
export const PUTAWAY_WH_COLS =
  'putaway_priority, putaway_enforced, putaway_max_materials, putaway_date_mix,' +
  'putaway_block_pick_face, putaway_block_qa_hold, putaway_block_full, putaway_single_ncc'

// Đọc cấu hình từ 1 dòng Warehouse. Giá trị lạ (DB cũ, cột thiếu) → rơi về mặc định = hành vi cũ.
export function putawayRulesOf(wh: Record<string, unknown> | null | undefined): PutawayRules {
  const w = wh ?? {}
  const pri = w.putaway_priority
  const mix = w.putaway_date_mix
  const maxMat = Number(w.putaway_max_materials)
  // Mức xử lý theo TỪNG luật. Cột RỖNG là ý định thật của người dùng ("không luật nào chặn cứng")
  // — không suy diễn thêm. (Công tắc chung `putaway_required` đã bị migration 20260816 thay thế.)
  const enforced: PutawayBlockCode[] = Array.isArray(w.putaway_enforced)
    ? (w.putaway_enforced as unknown[]).filter((x): x is PutawayBlockCode =>
        PUTAWAY_BLOCKS.some(b => b.code === x))
    : []
  return {
    priority: (PUTAWAY_PRIORITIES as readonly unknown[]).includes(pri) ? pri as PutawayPriority : 'CONSOLIDATE',
    enforced,
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
      // Trần 1000: cột DB là `integer` nên số quá lớn (vd 1e12) làm Postgres tràn kiểu → 500
      // thay vì lỗi nhập liệu 4xx (fuzz 15/08 bắt được). Ô lớn nhất đo thật mới 69 mã ⇒ 1000 là
      // thừa sức, và "không giới hạn" đã có cách khai riêng là ĐỂ TRỐNG.
      if (!Number.isFinite(n) || n < 1) return 'Số mã tối đa trong 1 vị trí phải là số nguyên ≥ 1'
      if (n > 1000) return 'Số mã tối đa trong 1 vị trí không quá 1000 (để trống = không giới hạn)'
      target.putaway_max_materials = Math.floor(n)
    }
  }
  if (body.putaway_enforced !== undefined) {
    const v = body.putaway_enforced
    if (!Array.isArray(v)) return 'Danh sách luật bắt buộc không hợp lệ'
    const bad = v.find(x => !PUTAWAY_BLOCKS.some(b => b.code === x))
    if (bad !== undefined) return `Mã luật không hợp lệ: ${String(bad).slice(0, 30)}`
    target.putaway_enforced = [...new Set(v as string[])]
  }
  for (const k of ['putaway_block_pick_face', 'putaway_block_qa_hold',
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

// Cất theo LÔ mới cần TẬP mã của ô (xem `putawayBlockBatch`); cất 1 pallet thì không.
export function putawayNeedsMats(rules: PutawayRules): boolean {
  return rules.max_materials != null
}

// ─── Lý do CHẶN — danh sách cố định, có nhãn để hiện thẳng cho người quét ────
export const PUTAWAY_BLOCKS = [
  // Nhãn phải TRÙNG chữ trên ô tick ở trang Vị trí kho ("Không đưa hàng vào"). Đặt tên khác đi
  // ("cấm nhập", "không nhận hàng") là buộc người dùng tự đoán hai chữ đó cùng chỉ một cờ.
  { code: 'NO_IN',         label: 'Vị trí không đưa hàng vào' },
  { code: 'FULL',          label: 'Vị trí đã đầy' },
  { code: 'PICK_FACE',     label: 'Vị trí nhặt lẻ — không cất pallet nguyên' },
  { code: 'QA_HOLD',       label: 'Đang có pallet bị QA giữ' },
  { code: 'MAX_MATERIALS', label: 'Vượt số mã tối đa cho một vị trí' },
  { code: 'NCC_MIX',       label: 'Khác NCC với hàng đang để' },
  { code: 'DATE_MIX',      label: 'Date không hợp luật trộn của kho' },
] as const
export type PutawayBlockCode = typeof PUTAWAY_BLOCKS[number]['code']

// Lý do VƯỢT RÀO khi kho bật "bắt buộc" — DANH SÁCH CỐ ĐỊNH, không gõ tự do (cùng lý lẽ với
// ROTATION_REASONS: biết 70% lượt vượt rào là "khu đúng đã đầy" thì vấn đề là SỨC CHỨA/quy hoạch
// khu, không phải người cất; gõ tự do thì mãi mãi không gom nhóm được).
export const PUTAWAY_OVERRIDE_REASONS = [
  { code: 'NO_SPACE',  label: 'Khu đúng đã hết chỗ' },
  { code: 'URGENT',    label: 'Hàng gấp — cất tạm để giải phóng xe' },
  { code: 'EQUIPMENT', label: 'Xe nâng / lối đi không vào được' },
  { code: 'OTHER',     label: 'Khác (ghi rõ)' },
] as const
export type PutawayOverrideCode = typeof PUTAWAY_OVERRIDE_REASONS[number]['code']

export function isPutawayOverrideReason(code: unknown): code is PutawayOverrideCode {
  return typeof code === 'string' && PUTAWAY_OVERRIDE_REASONS.some(r => r.code === code)
}

export const PUTAWAY_REASONS = [
  { code: 'SAME_MATERIAL', label: 'Đang để dở cùng mã' },
  { code: 'EMPTY',         label: 'Vị trí còn trống' },
  { code: 'BAND_MATCH',    label: 'Đúng khu theo hạng ABC' },
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
  same_material: boolean; qa_hold: boolean; nccs: string[] | null
  mats: string[] | null; lots: SlotLot[] | null
}

export interface SlotFacts {
  pallets:       number
  materials:     number
  sameMaterial:  boolean
  qaHold:        boolean
  nccs:          string[]
  // TẬP mã đang có trong ô — RỖNG khi caller không xin (`putawayNeedsMats`). Chỉ đường cất theo LÔ
  // cần tập này; đường cất 1 pallet dùng `materials` + `sameMaterial` là đủ.
  mats:          string[]
  keyMin:        number | null   // thứ tự lấy SỚM nhất đang có trong ô (null = không đủ dữ liệu)
  keyMax:        number | null
}
export const EMPTY_SLOT: SlotFacts = {
  pallets: 0, materials: 0, sameMaterial: false, qaHold: false, nccs: [], mats: [],
  keyMin: null, keyMax: null,
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
    mats: (raw.mats ?? []).filter(Boolean),
    keyMin, keyMax,
  }
}

// ─── Vị trí ứng viên + pallet sắp cất ────────────────────────────────────────
export interface PutawayLoc {
  id:           string
  sub_code?:    string | null   // mã KHU — chiến thuật ABC chấm theo khu, không theo từng ô
  max_pallets?: number | null   // <= 0 = không giới hạn sức chứa (nhiều khu đang khai 0)
  slot_no_in?:  boolean | null
  is_pick_face?: boolean | null
}

// Chiến thuật ABC (đợt C): khu NÊN cất mã này, do `utils/slottingBands` tính từ hạng nhặt khu +
// hạng ABC của mã (SQL `material_abc`). RỖNG = kho chưa xếp hạng khu nào hợp loại hàng đó ⇒ xuống
// thang về Gom (và form Kho nói rõ điều đó, không im lặng).
export interface PutawayAbc {
  abc:          'A' | 'B' | 'C' | null
  targetZones:  string[]
}
export const NO_ABC: PutawayAbc = { abc: null, targetZones: [] }
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

// Cất MỘT LÔ pallet vào CÙNG một ô (Chuyển vị trí hàng loạt) — trả lý do chặn đầu tiên.
//
// KHÔNG được chấm từng pallet với sự thật TĨNH của ô rồi cộng lại: kho giới hạn 3 mã/ô, ô đang có
// 2 mã, dồn 5 pallet của 5 mã mới → mỗi pallet đều thấy "mới 2 mã, còn chỗ" và cả 5 cùng lọt.
// Đúng lớp lỗi đã đo ở màn quét 15/08 (6 lượt quét đồng thời lọt 3 mã vào ô giới hạn 1), chỉ khác
// là ở đây nó xảy ra TRONG MỘT REQUEST nên row-lock không cứu được — phải gộp lô rồi mới chấm.
//
// Luật nào gộp, luật nào không — theo BẢN CHẤT của luật:
//   • Gộp (ràng buộc trên TẬP, không phụ thuộc thứ tự đặt): số mã tối đa, một NCC.
//   • KHÔNG gộp (ràng buộc theo THỨ TỰ CHỒNG HÀNG): trộn date — cả lô cất trong cùng một lượt nên
//     người cất tự xếp được thứ tự trong ô; chỉ so với hàng ĐANG CÓ SẴN là đủ nghĩa "không chôn
//     hàng phải lấy trước". Gộp cả lô vào đây sẽ chặn oan mọi lô nhiều date, kể cả khi xếp đúng.
export function putawayBlockBatch(
  loc: PutawayLoc, facts: SlotFacts, batch: IncomingPallet[], rules: PutawayRules,
): PutawayBlockCode | null {
  // Luật không phụ thuộc hàng sắp cất — chấm một lần cho cả lô
  if (loc.slot_no_in === true) return 'NO_IN'
  if (rules.block_pick_face && loc.is_pick_face === true) return 'PICK_FACE'
  if (rules.block_qa_hold && facts.qaHold) return 'QA_HOLD'
  // FULL cố ý KHÔNG kiểm ở đây: sức chứa đã được RPC `move_pallets_to_location` chốt dưới row-lock
  // (đúng số pallet của lô, loại pallet đang dời khỏi chính ô đó) — kiểm thêm ở backend chỉ tạo
  // định nghĩa "đầy" thứ hai, lệch nhau là báo oan.

  if (rules.max_materials != null) {
    const after = new Set(facts.mats)
    for (const p of batch) after.add(p.material_id)
    if (after.size > rules.max_materials) return 'MAX_MATERIALS'
  }
  if (rules.single_ncc) {
    const nccs = new Set(facts.nccs)
    for (const p of batch) if (p.ncc_id) nccs.add(p.ncc_id)   // null-inclusive: chưa khai thì không kết luận
    if (nccs.size > 1) return 'NCC_MIX'
  }
  if (rules.date_mix !== 'ANY') {
    for (const p of batch) {
      // Dùng lại ĐÚNG hàm chấm 1 pallet — luật trộn date chỉ có một bản, ở `putawayBlock`.
      // Tắt hết luật khác để không có luật nào trả về TRƯỚC date_mix (thứ tự kiểm trong
      // `putawayBlock` đặt date_mix cuối cùng) — nếu không sẽ bỏ sót vi phạm date thật.
      if (putawayBlock({ ...loc, slot_no_in: false, is_pick_face: false }, facts, p,
                       { ...rules, block_full: false, block_pick_face: false, block_qa_hold: false,
                         max_materials: null, single_ncc: false }) === 'DATE_MIX')
        return 'DATE_MIX'
    }
  }
  return null
}

// ★ = vì sao ô này được đẩy lên đầu. Chỉ đánh cho ô CẤT ĐƯỢC (đánh ★ vào ô bị chặn là chỉ người
// ta tới chỗ không cất được — đúng lỗi mà rotation gặp 14/08 với pallet bị QA giữ).
export function putawayReason(
  loc: PutawayLoc, facts: SlotFacts, incoming: IncomingPallet, rules: PutawayRules,
  abc: PutawayAbc = NO_ABC,
): PutawayReasonCode | null {
  if (putawayBlock(loc, facts, incoming, rules) != null) return null
  // ABC: khu đúng band là lý do MẠNH nhất; kho chưa xếp hạng khu (targetZones rỗng) thì rơi xuống Gom
  if (rules.priority === 'ABC' && abc.targetZones.length > 0)
    return loc.sub_code && abc.targetZones.includes(loc.sub_code) ? 'BAND_MATCH' : null
  if (rules.priority === 'SPREAD') return facts.pallets === 0 ? 'EMPTY' : null
  return facts.sameMaterial ? 'SAME_MATERIAL' : null
}

// Điểm sắp xếp — NHỎ HƠN đứng trước. Ô bị chặn luôn xuống cuối.
export function putawayScore(
  loc: PutawayLoc, facts: SlotFacts, incoming: IncomingPallet, rules: PutawayRules,
  abc: PutawayAbc = NO_ABC,
): number {
  if (putawayBlock(loc, facts, incoming, rules) != null) return 100
  if (rules.priority === 'ABC' && abc.targetZones.length > 0) {
    // Đúng band trước; trong cùng band thì vẫn gom cùng mã (đỡ chia lẻ tồn), rồi mới tới phần còn lại.
    const inBand = !!loc.sub_code && abc.targetZones.includes(loc.sub_code)
    return inBand ? (facts.sameMaterial ? 0 : 1) : (facts.sameMaterial ? 8 : 10)
  }
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

// Thông báo chặn — nói rõ VÌ SAO và cần làm gì, để người cất còn xoay được, thay vì chỉ bị từ chối
// (cùng tinh thần rotationBlockMessage).
export function putawayBlockMessage(
  code: PutawayBlockCode, locationCode: string, facts: SlotFacts, rules: PutawayRules,
  principle: RotationPrinciple,
  // Cất theo LÔ: nói con số SAU KHI chuyển. Nói "đang có 1 mã, kho giới hạn 1 mã" thì người đọc
  // thấy hai số bằng nhau, tưởng app báo nhầm — lý do thật là 2 mã của lô sẽ nâng ô lên 3.
  afterMaterials?: number,
): string {
  const at = `Vị trí ${locationCode}`
  switch (code) {
    case 'NO_IN':         return `${at} được đánh dấu KHÔNG ĐƯA HÀNG VÀO. Chọn vị trí khác.`
    case 'FULL':          return `${at} đã đầy (${facts.pallets} pallet). Chọn vị trí còn chỗ.`
    case 'PICK_FACE':     return `${at} là vị trí nhặt lẻ — kho không cho cất pallet nguyên vào đây (chỗ này để lệnh Fill đổ hàng).`
    case 'QA_HOLD':       return `${at} đang có pallet bị QA giữ — cất đè lên sẽ chôn pallet đó. Chọn vị trí khác.`
    case 'MAX_MATERIALS': return afterMaterials != null
      ? `${at} sẽ có ${afterMaterials} mã sau khi chuyển (đang có ${facts.materials}), kho giới hạn ${rules.max_materials} mã cho một vị trí.`
      : `${at} đang có ${facts.materials} mã, kho giới hạn ${rules.max_materials} mã cho một vị trí.`
    case 'NCC_MIX':       return `${at} đang để hàng của NCC khác — kho không cho trộn NCC trong một vị trí.`
    // KHÔNG toLowerCase cả câu — nuốt luôn chữ viết tắt ("HSD" thành "hsd"). Chỉ hạ chữ ĐẦU.
    case 'DATE_MIX': {
      const lb = putawayDateMixLabel(rules.date_mix, principle)
      return `${at} không hợp luật trộn ${ROTATION_DATE_LABEL[principle]} của kho: ${lb.charAt(0).toLowerCase()}${lb.slice(1)}.`
    }
  }
}

// Khối BE trả kèm MỖI vị trí — FE chỉ hiển thị, KHÔNG tự tính lại (bài học 4 bản chép tay).
export interface PutawayHint {
  blocked: PutawayBlockCode | null
  reason:  PutawayReasonCode | null
  // Luật đang vi phạm có bị CHẶN CỨNG ở kho này không. FE cần để biết chọn ô đó là "cứ chọn, có
  // ghi vết" hay "phải có lý do vượt rào mới lưu được" — mà KHÔNG được tự suy từ cấu hình kho
  // (đó lại là bản luật chép tay thứ N). false khi không vi phạm gì.
  enforced: boolean
}
