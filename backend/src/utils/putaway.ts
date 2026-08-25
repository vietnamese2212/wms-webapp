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

import {
  rotationSortKey, asRotationPrinciple, ROTATION_DATE_LABEL, ROTATION_PRINCIPLES,
  type RotationPrinciple, type RotationEntry,
} from './rotation'
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

// THANG ƯU TIÊN CẤT HÀNG — 3 BƯỚC, khai TƯỜNG MINH thay vì chôn trong code (21/08).
// Trước đó thang chỉ có 2 bậc và bậc 2 là "theo tên vị trí" (alphabet) — người cấu hình không
// có cách nào biết, cũng không đổi được. Nay:
//   Bước 1 = `priority`                  → chia NHÓM ưu tiên (★) và phần còn lại
//   Bước 2 = `same_mat_date_pref`        → xếp thứ tự TRONG nhóm ★ theo date
//   Bước 3 = `fallback`                  → xếp thứ tự phần CÒN LẠI
// Mặc định 'NONE' + 'BY_CODE' = ĐÚNG hành vi trước 21/08 (không đổi gì cho kho chưa chỉnh).
export const PUTAWAY_DATE_PREFS = ['NONE', 'SAME_DATE', 'OLDER_FIRST', 'NEWER_FIRST'] as const
export type PutawayDatePref = typeof PUTAWAY_DATE_PREFS[number]
export const PUTAWAY_FALLBACKS = ['BY_CODE', 'EMPTY_FIRST', 'MOST_FREE', 'LEAST_FILLED'] as const
export type PutawayFallback = typeof PUTAWAY_FALLBACKS[number]

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
  same_mat_date_pref: PutawayDatePref
  fallback:           PutawayFallback
}

export const PUTAWAY_RULES_DEFAULT: PutawayRules = {
  priority: 'CONSOLIDATE', enforced: [], max_materials: null, date_mix: 'ANY',
  block_pick_face: false, block_qa_hold: false, block_full: false, single_ncc: false,
  same_mat_date_pref: 'NONE', fallback: 'BY_CODE',
}

// Luật này có bị CHẶN CỨNG ở kho đó không (khác với "có chấm hay không")
export function putawayEnforces(rules: PutawayRules, code: PutawayBlockCode): boolean {
  return rules.enforced.includes(code)
}

// Cột cần select ở bảng Warehouse (giữ 1 chỗ để thêm luật mới không phải đi sửa từng controller)
export const PUTAWAY_WH_COLS =
  'putaway_priority, putaway_enforced, putaway_max_materials, putaway_date_mix,' +
  'putaway_block_pick_face, putaway_block_qa_hold, putaway_block_full, putaway_single_ncc,' +
  'putaway_same_mat_date_pref, putaway_fallback'

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
  const pref = w.putaway_same_mat_date_pref
  const fb   = w.putaway_fallback
  return {
    priority: (PUTAWAY_PRIORITIES as readonly unknown[]).includes(pri) ? pri as PutawayPriority : 'CONSOLIDATE',
    enforced,
    max_materials: Number.isFinite(maxMat) && maxMat >= 1 ? Math.floor(maxMat) : null,
    date_mix: (PUTAWAY_DATE_MIXES as readonly unknown[]).includes(mix) ? mix as PutawayDateMix : 'ANY',
    block_pick_face: w.putaway_block_pick_face === true,
    block_qa_hold:   w.putaway_block_qa_hold === true,
    block_full:      w.putaway_block_full === true,
    single_ncc:      w.putaway_single_ncc === true,
    // Cột chưa apply migration / giá trị lạ → mặc định = thang cứng cũ (không đổi hành vi)
    same_mat_date_pref: (PUTAWAY_DATE_PREFS as readonly unknown[]).includes(pref) ? pref as PutawayDatePref : 'NONE',
    fallback:           (PUTAWAY_FALLBACKS as readonly unknown[]).includes(fb)   ? fb   as PutawayFallback  : 'BY_CODE',
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
  if (body.putaway_same_mat_date_pref !== undefined) {
    if (!(PUTAWAY_DATE_PREFS as readonly unknown[]).includes(body.putaway_same_mat_date_pref))
      return 'Ưu tiên date trong ô cùng mã không hợp lệ'
    target.putaway_same_mat_date_pref = body.putaway_same_mat_date_pref
  }
  if (body.putaway_fallback !== undefined) {
    if (!(PUTAWAY_FALLBACKS as readonly unknown[]).includes(body.putaway_fallback))
      return 'Thứ tự các vị trí còn lại không hợp lệ'
    target.putaway_fallback = body.putaway_fallback
  }
  for (const k of ['putaway_block_pick_face', 'putaway_block_qa_hold',
                   'putaway_block_full', 'putaway_single_ncc'] as const) {
    if (body[k] !== undefined) target[k] = Boolean(body[k])
  }
  // Nhặt lẻ tự sinh (24/08) — cùng validator cho cả 2 tầng như các cờ trên
  if (body.loose_mode !== undefined) {
    if (!(LOOSE_MODES as readonly unknown[]).includes(body.loose_mode))
      return 'Chế độ nhặt lẻ không hợp lệ (REMAINDER / ALL / OFF)'
    target.loose_mode = body.loose_mode
  }
  if (body.loose_max_cartons !== undefined) {
    const v = body.loose_max_cartons
    if (v === null || v === '') target.loose_max_cartons = null
    else {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 1) return 'Trần nhặt lẻ (thùng) phải là số ≥ 1 (để trống = không chặn)'
      if (n > 100_000) return 'Trần nhặt lẻ (thùng) không quá 100.000 (để trống = không chặn)'
      target.loose_max_cartons = n
    }
  }
  return null
}

// ─── Nhặt lẻ tự sinh — 2 tầng như chiến thuật (24/08) ────────────────────────
// REMAINDER = phần lẻ dưới 1 pallet nguyên (hành vi gốc 20/07) · ALL = TOÀN BỘ SL vào nhặt lẻ
// (user chốt cho POSM — mã CÁI/EA soạn full trước như nhặt lẻ) · OFF = kho/loại không nhặt lẻ.
// Trần max_cartons CHỈ áp cho REMAINDER (khai bằng THÙNG — ALL/OFF không so được, user lưu ý 24/08).
export const LOOSE_MODES = ['REMAINDER', 'ALL', 'OFF'] as const
export type LooseMode = typeof LOOSE_MODES[number]
export function asLooseMode(v: unknown): LooseMode {
  return (LOOSE_MODES as readonly unknown[]).includes(v) ? v as LooseMode : 'REMAINDER'
}
export interface LoosePolicy { mode: LooseMode; max_cartons: number | null }
export function resolveLoosePolicy(
  wh: Record<string, unknown> | null | undefined,
  typeRows: WhTypeConfigRow[] | null | undefined,
  category: string | null | undefined,
): LoosePolicy {
  const m = mergedConfig(wh, typeRowOf(typeRows, category))
  const max = Number(m.loose_max_cartons)
  return {
    mode: asLooseMode(m.loose_mode),
    max_cartons: Number.isFinite(max) && max > 0 ? max : null,
  }
}

// Kho có bật luật nào cần biết ngày của hàng đang nằm trong ô không (quyết định có xin `lots` của
// RPC hay không — tắt thì payload bằng 0).
// Bước 2 (ưu tiên date trong ô cùng mã) cũng so ngày ⇒ bật là phải xin lots, không thì thang im lặng
// không có tác dụng (đúng họ lỗi "cờ bật mà không ai đọc").
export function putawayNeedsLots(rules: PutawayRules): boolean {
  return rules.date_mix !== 'ANY' || rules.same_mat_date_pref !== 'NONE'
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

// Tỷ lệ chỗ TRỐNG của ô — ô không khai sức chứa (0) coi như rộng nhất.
function freeRatioOf(loc: PutawayLoc, facts: SlotFacts): number {
  const cap = Number(loc.max_pallets ?? 0)
  return cap > 0 ? Math.max(0, (cap - facts.pallets) / cap) : 1
}

// BƯỚC 2 — trong nhóm ô CÙNG MÃ thì ô nào trước, so theo THỨ TỰ LẤY (khóa rotation), nên phát biểu
// đúng cho cả FEFO (so HSD) lẫn FIFO/LIFO (so NSX) mà không cần 3 nhánh.
// Trả [0, 0.5]: 0 = hợp ý muốn, 0.5 = không (hoặc thiếu dữ liệu → KHÔNG kết luận, đứng sau).
function step2Frac(facts: SlotFacts, incoming: IncomingPallet, pref: PutawayDatePref): number {
  if (pref === 'NONE') return 0
  const k = incoming.key
  if (k == null || facts.keyMin == null || facts.keyMax == null) return 0.5
  const hit =
    pref === 'SAME_DATE'   ? (facts.keyMin === k || facts.keyMax === k)  // chắc chắn có lô trùng date
    : pref === 'OLDER_FIRST' ? facts.keyMax <= k    // cả ô đều phải lấy TRƯỚC (hoặc cùng lúc) pallet mới
    :                          facts.keyMin >= k    // NEWER_FIRST — cả ô đều lấy SAU
  return hit ? 0 : 0.5
}

// BƯỚC 3 — các ô NGOÀI nhóm ưu tiên xếp theo gì. Trả [0, 0.5].
// BY_CODE trả 0 cho mọi ô ⇒ giữ NGUYÊN thứ tự tên vị trí nhờ sort ổn định = hành vi trước 21/08.
function step3Frac(loc: PutawayLoc, facts: SlotFacts, fb: PutawayFallback): number {
  switch (fb) {
    case 'EMPTY_FIRST':  return facts.pallets === 0 ? 0 : 0.5
    case 'MOST_FREE':    return (1 - freeRatioOf(loc, facts)) / 2          // còn nhiều chỗ → nhỏ hơn
    // "Đầy nốt ô đang dở cho gọn": ô đã có hàng đứng trước (ít pallet nhất trước), ô trống xuống cuối
    case 'LEAST_FILLED': return facts.pallets === 0 ? 0.5 : 0.4 * (1 - freeRatioOf(loc, facts))
    default:             return 0                                          // BY_CODE
  }
}

// Điểm sắp xếp — NHỎ HƠN đứng trước. Ô bị chặn luôn xuống cuối (100).
//
// Cấu trúc điểm = ĐIỂM NHÓM (số nguyên, y hệt trước 21/08) + phần lẻ ≤ 0.5 của Bước 2/Bước 3.
// Phần lẻ luôn < 1 nên KHÔNG BAO GIỜ đổi được thứ tự giữa các nhóm — nó chỉ xếp lại bên trong một
// nhóm. Mặc định (NONE + BY_CODE) phần lẻ = 0 ⇒ điểm trùng khít bản cũ.
export function putawayScore(
  loc: PutawayLoc, facts: SlotFacts, incoming: IncomingPallet, rules: PutawayRules,
  abc: PutawayAbc = NO_ABC,
): number {
  if (putawayBlock(loc, facts, incoming, rules) != null) return 100
  // Ô cùng mã = nhóm ★ của chiến thuật Gom (và của phần trong-band khi chạy ABC) → Bước 2;
  // còn lại → Bước 3.
  const refine = (base: number, inStar: boolean) =>
    base + (inStar ? step2Frac(facts, incoming, rules.same_mat_date_pref)
                   : step3Frac(loc, facts, rules.fallback))

  if (rules.priority === 'ABC' && abc.targetZones.length > 0) {
    // Đúng band trước; trong cùng band thì vẫn gom cùng mã (đỡ chia lẻ tồn), rồi mới tới phần còn lại.
    const inBand = !!loc.sub_code && abc.targetZones.includes(loc.sub_code)
    return refine(inBand ? (facts.sameMaterial ? 0 : 1) : (facts.sameMaterial ? 8 : 10), facts.sameMaterial)
  }
  if (rules.priority === 'SPREAD') {
    // Rải: bản thân chiến thuật ĐÃ xếp theo chỗ trống (điểm liên tục 9..10) ⇒ Bước 3 không áp thêm,
    // tránh hai luật cùng xếp một thứ mà đá nhau. Bước 2 chỉ được PHÁ THẾ HÒA (nhân epsilon) —
    // cộng nguyên 0,5 vào đây sẽ lấn qua chênh lệch chỗ trống thật (1/sức chứa), tức Bước 2 lật
    // ngược chính chiến thuật Bước 1.
    const base = 10 - freeRatioOf(loc, facts)
    return facts.sameMaterial ? base + step2Frac(facts, incoming, rules.same_mat_date_pref) * 0.001 : base
  }
  return refine(facts.sameMaterial ? 0 : 10, facts.sameMaterial)
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

// ─── CHIẾN THUẬT 2 TẦNG: kho (mặc định) → LOẠI KHO (đặc trưng)  [21/08] ──────
//
// Cùng một kho có thể chạy FEFO cho thành phẩm nhưng FIFO cho nguyên liệu. Tầng 2 = bảng
// `warehouse_type_configs`: MỖI trường NULL nghĩa là "kế thừa mặc định của kho" — KHÔNG có giá trị
// nào khác mang nghĩa đó, nên `false` của loại vẫn tắt được luật mà kho đang bật.
//
// ⚠️ Vào đây bằng `Material.category` (giá trị ĐƠN của MÃ HÀNG), TUYỆT ĐỐI không phải
// `GroupDeliveryOrder.warehouse_type` (chuỗi ghép 'FG01+PM01' của CHUYẾN chở lẫn — luật giao ≥1,
// memory 30/07). Chuỗi ghép lọt vào đây sẽ không khớp dòng nào và âm thầm rơi về mặc định kho;
// `typeRowOf` chặn thẳng để lỗi lộ ra ở chỗ gọi sai chứ không hoá thành "chiến thuật im lặng sai".
// Các cột chiến thuật của tầng 2 — MỘT danh sách cho cả select DB, merge, validate và KIỂU dữ liệu.
// Thêm luật mới chỉ cần thêm tên vào đây (+ cột DB) là 4 chỗ kia tự theo.
export const WH_TYPE_CFG_COLS = [
  'rotation_principle', 'rotation_required',
  // `putaway_enforced` (bật bắt buộc) + `putaway_enforced_off` (ép về chỉ-cảnh-báo) — 2 cột này
  // KHÔNG ghép theo kiểu "khai thì đè" như các cột khác, xem `mergedConfig`.
  'putaway_priority', 'putaway_enforced', 'putaway_enforced_off', 'putaway_max_materials', 'putaway_date_mix',
  'putaway_block_pick_face', 'putaway_block_qa_hold', 'putaway_block_full', 'putaway_single_ncc',
  'putaway_same_mat_date_pref', 'putaway_fallback',
  'loose_mode', 'loose_max_cartons',   // nhặt lẻ tự sinh 2 tầng (24/08) — validate ở applyPutawayBody
] as const
export type WhTypeCfgCol = typeof WH_TYPE_CFG_COLS[number]

// Giá trị để `unknown`: đã có `putawayRulesOf`/`asRotationPrinciple` chốt kiểu ở đúng MỘT chỗ,
// khai lại kiểu ở đây là mở đường cho hai bản luật lệch nhau.
export type WhTypeConfigRow = { type_code: string } & Partial<Record<WhTypeCfgCol, unknown>>

export function typeRowOf(
  typeRows: WhTypeConfigRow[] | null | undefined, category: string | null | undefined,
): WhTypeConfigRow | null {
  if (!typeRows?.length || !category) return null
  // Chuỗi ghép là của CHUYẾN, không phải của mã hàng — gọi tới đây là lỗi lập trình, không phải
  // dữ liệu xấu; trả null (mặc định kho) và im lặng thì 2 tuần nữa không ai lần ra.
  if (category.includes('+')) return null
  return typeRows.find(r => r.type_code === category) ?? null
}

// Ghép mặc định kho + override của loại: trường nào loại KHAI (khác null/undefined) thì thắng.
// `putaway_enforced` THAY THẾ nguyên mảng — merge mảng sẽ là bản luật thứ hai, không ai đoán được
// kết quả cuối là gì.
function mergedConfig(
  wh: Record<string, unknown> | null | undefined, row: WhTypeConfigRow | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(wh ?? {}) }
  if (!row) return out
  for (const k of WH_TYPE_CFG_COLS) {
    if (k === 'putaway_enforced' || k === 'putaway_enforced_off') continue   // ghép per-LUẬT, xem dưới
    const v = row[k]
    if (v !== null && v !== undefined) out[k] = v
  }
  // MỨC XỬ LÝ của từng luật kế thừa ĐỘC LẬP nhau (user chốt 25/08: "không khai gì thì để bao nhiêu
  // thì để, có thì cũng cho theo rule"). Trước đây mảng của loại THAY THẾ nguyên khối mảng của kho
  // ⇒ khai 1 luật là lặng lẽ tắt mọi luật bắt buộc còn lại (đo thật: PM01 khai [FULL] làm hàng POSM
  // thoát luật "tối đa 2 mã/vị trí" của kho). Nay: hiệu lực = (kho ∪ loại.bật) \ loại.tắt.
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const off = new Set(arr(row.putaway_enforced_off))
  out.putaway_enforced = [...new Set([...arr(out.putaway_enforced), ...arr(row.putaway_enforced)])]
    .filter(code => !off.has(code))
  return out
}

export interface RotationConfig {
  principle: RotationPrinciple
  required:  boolean
  // Cấu hình đang hiệu lực đến từ tầng nào — để màn quét nói được "(theo Loại kho RM01)" mà KHÔNG
  // phải tự suy từ cấu hình kho (đó lại là bản luật chép tay).
  source:    'WAREHOUSE' | 'TYPE'
}

export function resolveRotation(
  wh: Record<string, unknown> | null | undefined,
  typeRows: WhTypeConfigRow[] | null | undefined,
  category: string | null | undefined,
): RotationConfig {
  const row = typeRowOf(typeRows, category)
  const m = mergedConfig(wh, row)
  const overridden = !!row && (row.rotation_principle != null || row.rotation_required != null)
  return {
    principle: asRotationPrinciple(m.rotation_principle),
    required:  m.rotation_required === true,
    source:    overridden ? 'TYPE' : 'WAREHOUSE',
  }
}

export function resolvePutawayRules(
  wh: Record<string, unknown> | null | undefined,
  typeRows: WhTypeConfigRow[] | null | undefined,
  category: string | null | undefined,
): PutawayRules {
  return putawayRulesOf(mergedConfig(wh, typeRowOf(typeRows, category)))
}

// Nhận 1 dòng override từ body (form Kho) → patch, dùng lại ĐÚNG validator của cấp kho để hai tầng
// không bao giờ nhận hai tập giá trị khác nhau. Khác biệt duy nhất: null = "theo kho" (xoá override).
// Trả mã lỗi hoặc null.
export function applyWhTypeConfigBody(
  body: Record<string, unknown>, target: Record<string, unknown>,
): string | null {
  if (body.rotation_principle !== undefined) {
    if (body.rotation_principle === null) target.rotation_principle = null
    else {
      if (!(ROTATION_PRINCIPLES as readonly unknown[]).includes(body.rotation_principle))
        return 'Nguyên tắc luân chuyển không hợp lệ'
      target.rotation_principle = body.rotation_principle
    }
  }
  if (body.rotation_required !== undefined)
    target.rotation_required = body.rotation_required === null ? null : Boolean(body.rotation_required)

  // Danh sách luật ép về CHỈ CẢNH BÁO — chỉ tầng LOẠI mới có cột này (bảng Warehouse không có),
  // nên validate tại đây chứ KHÔNG giao cho applyPutawayBody dùng chung với form Kho.
  if (body.putaway_enforced_off !== undefined) {
    const v = body.putaway_enforced_off
    if (v === null || (Array.isArray(v) && v.length === 0)) target.putaway_enforced_off = null
    else {
      if (!Array.isArray(v)) return 'Danh sách luật chỉ-cảnh-báo không hợp lệ'
      const bad = v.find(x => !PUTAWAY_BLOCKS.some(b => b.code === x))
      if (bad !== undefined) return `Mã luật không hợp lệ: ${String(bad).slice(0, 30)}`
      target.putaway_enforced_off = [...new Set(v as string[])]
    }
  }

  // Các cờ putaway: null = theo kho (applyPutawayBody không hiểu null nên xử trước rồi mới giao)
  const rest: Record<string, unknown> = {}
  for (const k of WH_TYPE_CFG_COLS) {
    if (k === 'rotation_principle' || k === 'rotation_required' || k === 'putaway_enforced_off') continue
    if (body[k] === undefined) continue
    if (body[k] === null || body[k] === '') { target[k] = null; continue }
    rest[k] = body[k]
  }
  return applyPutawayBody(rest, target)
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
