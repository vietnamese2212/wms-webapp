// Mirror FE của backend/src/utils/putaway.ts — CHỈ NHÃN, KHÔNG có luật.
// FE không tự quyết vị trí nào ★ hay bị chặn: backend trả khối `putaway` trên từng vị trí, ở đây
// chỉ dịch mã ra chữ. Trước 15/08 FE tự tính (Inbound.tsx isRecommended + InboundDetail.tsx locRec)
// nên có 2 bản luật lệch backend, còn màn quét PDA thì không hiển thị gì.

export type PutawayBlockCode =
  'NO_IN' | 'FULL' | 'PICK_FACE' | 'QA_HOLD' | 'MAX_MATERIALS' | 'NCC_MIX' | 'DATE_MIX'
export type PutawayReasonCode = 'SAME_MATERIAL' | 'EMPTY' | 'BAND_MATCH'

export interface PutawayHint {
  blocked: PutawayBlockCode | null
  reason:  PutawayReasonCode | null
  // Kho có CHẶN CỨNG luật đang vi phạm không (BE quyết — FE không suy từ cấu hình kho).
  // optional vì bundle cũ/response cũ chưa có field này; thiếu ⇒ coi như chỉ cảnh báo.
  enforced?: boolean
}

export const PUTAWAY_BLOCK_LABEL: Record<PutawayBlockCode, string> = {
  NO_IN:         'Vị trí không đưa hàng vào',
  FULL:          'Vị trí đã đầy',
  PICK_FACE:     'Vị trí nhặt lẻ — không cất pallet nguyên',
  QA_HOLD:       'Đang có pallet bị QA giữ',
  MAX_MATERIALS: 'Vượt số mã tối đa cho một vị trí',
  NCC_MIX:       'Khác NCC với hàng đang để',
  DATE_MIX:      'Date không hợp luật trộn của kho',
}
// Nhãn NGẮN để nhét vừa 1 dòng option trên PDA. NO_IN giữ NGUYÊN VĂN chữ trên ô tick ở trang
// Vị trí kho — rút gọn thành "cấm nhập" là đẻ ra tên thứ hai cho cùng một cờ.
export const PUTAWAY_BLOCK_SHORT: Record<PutawayBlockCode, string> = {
  NO_IN: 'không đưa hàng vào', FULL: 'đã đầy', PICK_FACE: 'nhặt lẻ', QA_HOLD: 'QA giữ',
  MAX_MATERIALS: 'quá số mã', NCC_MIX: 'khác NCC', DATE_MIX: 'lệch date',
}
export const PUTAWAY_REASON_LABEL: Record<PutawayReasonCode, string> = {
  SAME_MATERIAL: 'đang để dở cùng mã',
  EMPTY:         'còn trống',
  BAND_MATCH:    'đúng khu hạng ABC',
}

// Mirror BE PUTAWAY_OVERRIDE_REASONS — danh sách cố định, KHÔNG gõ tự do (để báo cáo gom nhóm được)
export const PUTAWAY_OVERRIDE_REASONS = [
  { code: 'NO_SPACE',  label: 'Khu đúng đã hết chỗ' },
  { code: 'URGENT',    label: 'Hàng gấp — cất tạm' },
  { code: 'EQUIPMENT', label: 'Xe nâng không vào được' },
  { code: 'OTHER',     label: 'Khác' },
] as const

export const blockLabel =(c: PutawayBlockCode | null | undefined) => (c ? PUTAWAY_BLOCK_LABEL[c] ?? c : '')
export const blockShort = (c: PutawayBlockCode | null | undefined) => (c ? PUTAWAY_BLOCK_SHORT[c] ?? c : '')

// Nhãn ô cấu hình (form Kho) — mirror của PUTAWAY_PRIORITIES / PUTAWAY_DATE_MIXES bên BE.
export const PUTAWAY_PRIORITY_OPTS = [
  { value: 'CONSOLIDATE', label: 'Gom — ưu tiên ô đang để dở cùng mã' },
  { value: 'SPREAD',      label: 'Rải — ưu tiên ô còn nhiều chỗ nhất' },
  { value: 'ABC',         label: 'Theo ABC — hàng nhặt nhiều để gần cửa (theo hạng nhặt khu)' },
] as const

// "date" là HSD hay NSX tuỳ nguyên tắc luân chuyển của kho → nhãn nhận vào chữ đó.
export function putawayDateMixOpts(dateLabel: string) {
  return [
    { value: 'ANY',        label: 'Không ràng buộc' },
    { value: 'SAME',       label: `Chỉ để chung khi trùng ${dateLabel}` },
    { value: 'OLDER_ONLY', label: `Chỉ để chung với hàng phải lấy trước (${dateLabel} ngắn hơn hoặc bằng)` },
    { value: 'NEWER_ONLY', label: `Chỉ để chung với hàng lấy sau (${dateLabel} dài hơn hoặc bằng)` },
  ]
}

// ─── THANG ƯU TIÊN CẤT HÀNG 3 BƯỚC (21/08) — mirror PUTAWAY_DATE_PREFS/FALLBACKS bên BE ──
// Bước 2: trong các ô CÙNG MÃ thì ô nào trước (so theo THỨ TỰ LẤY nên đúng cả FEFO lẫn FIFO/LIFO).
export function putawayDatePrefOpts(dateLabel: string) {
  return [
    { value: 'NONE',        label: 'Không xét date', sub: 'mặc định — ô cùng mã nào cũng như nhau' },
    { value: 'SAME_DATE',   label: `Ô trùng ${dateLabel} trước`, sub: 'gom cùng lô cho gọn' },
    { value: 'OLDER_FIRST', label: `Ô chứa hàng phải lấy trước (${dateLabel} ngắn hơn) trước` },
    { value: 'NEWER_FIRST', label: `Ô chứa hàng lấy sau (${dateLabel} dài hơn) trước` },
  ]
}
// Bước 3: hết nhóm ưu tiên thì các ô CÒN LẠI xếp theo gì.
export const PUTAWAY_FALLBACK_OPTS = [
  { value: 'BY_CODE',      label: 'Theo tên vị trí', sub: 'mặc định — thứ tự bảng chữ cái' },
  { value: 'EMPTY_FIRST',  label: 'Ô trống trước' },
  { value: 'MOST_FREE',    label: 'Ô còn nhiều chỗ nhất trước' },
  { value: 'LEAST_FILLED', label: 'Ô đang dở, ít hàng nhất trước', sub: 'đầy nốt ô dở cho gọn' },
] as const

const PRIORITY_STEP1: Record<string, string> = {
  CONSOLIDATE: 'ô đang để dở cùng mã',
  SPREAD:      'ô còn nhiều chỗ nhất',
  ABC:         'ô trong khu đúng hạng ABC',
}
const DATE_PREF_STEP2: Record<string, string> = {
  SAME_DATE:   'trùng date trước',
  OLDER_FIRST: 'date phải-lấy-trước lên trên',
  NEWER_FIRST: 'date lấy-sau lên trên',
}
const FALLBACK_STEP3: Record<string, string> = {
  BY_CODE:      'theo tên vị trí',
  EMPTY_FIRST:  'ô trống trước',
  MOST_FREE:    'ô còn nhiều chỗ nhất',
  LEAST_FILLED: 'ô đang dở ít hàng nhất',
}

/**
 * DIỄN GIẢI SỐNG thang cất hàng — dựng câu từ ĐÚNG giá trị đang chọn trên form (đổi dropdown là
 * câu đổi theo), để người cấu hình đọc được kết quả mà không phải chạy thử.
 * Thuần NHÃN: không quyết định gì, thứ tự thật do `putawayScore` bên BE tính.
 */
export function putawayExplain(v: {
  putaway_priority?: string | null
  putaway_same_mat_date_pref?: string | null
  putaway_fallback?: string | null
  putaway_enforced?: string[] | null
}): string {
  const step1 = PRIORITY_STEP1[String(v.putaway_priority ?? 'CONSOLIDATE')] ?? PRIORITY_STEP1.CONSOLIDATE
  const step2 = DATE_PREF_STEP2[String(v.putaway_same_mat_date_pref ?? 'NONE')]
  const step3 = FALLBACK_STEP3[String(v.putaway_fallback ?? 'BY_CODE')] ?? FALLBACK_STEP3.BY_CODE
  const enf = (v.putaway_enforced ?? []).map(c => blockShort(c as PutawayBlockCode)).filter(Boolean)
  return `Kho sẽ gợi ý: ① ${step1}${step2 ? ` (${step2})` : ''} → ② các ô còn lại ${step3}. `
    + (enf.length ? `Chặn cứng: ${enf.join(', ')}.` : 'Không luật nào chặn cứng — chỉ cảnh báo.')
}
