// PHIẾU THEO DÕI của mẻ (MES 14/11/2026) — KIỂU + helper của MẪU PHIẾU.
// Mẫu phiếu là DỮ LIỆU CẤU HÌNH (bảng production_process_form, sửa ở Cài đặt MES → "Mẫu phiếu theo dõi" — user: "những cái khác bạn
// cho nó là số liệu config được"); một phiếu của mẻ có thể mang BẢN SỬA RIÊNG cho lần đó (batch_process_log.blocks — user: "cho phép
// sửa theo từng lần nếu muốn tại bàn"). Nội dung phiếu lưu dạng { mã_ô: 'giá trị' }; mã ô sinh MỘT LẦN khi thêm ô và không đổi
// (đổi nhãn thoải mái) — phiếu đã ghi bám vào mã ô.
export type FieldKind = 'num' | 'time' | 'text'
export type Prefill = 'machine_code' | 'planned_qty'
export interface ProcessField {
  key: string; label: string; kind: FieldKind
  unit?: string
  /** ngưỡng tiêu chuẩn: giá trị vượt ⇒ tô đỏ (không chặn lưu — phiếu ghi đúng thực tế) */
  max?: number; min?: number
  /** ô rộng cả hàng (ghi chú dài) */
  wide?: boolean
  /** phiếu mới tự điền từ mẻ */
  prefill?: Prefill
  /** ô PHẢI ghi trước khi ĐÓNG phiếu (26/11 — trước đó: trước khi nạp bồn; kho bật luồng chặt — hàm DB mes_batch_gate đọc cờ này) */
  required?: boolean
}
export interface FieldsBlock { type: 'fields'; title: string; hint?: string; fields: ProcessField[] }
export interface GridBlock {
  type: 'grid'; key: string; title: string; hint?: string; rows: number
  cols: { key: string; label: string }[]
  cells: { key: string; label: string; kind: FieldKind }[]
}
export type FormBlock = FieldsBlock | GridBlock

export const KIND_LABEL: Record<FieldKind, string> = { num: 'Số', time: 'Giờ', text: 'Chữ' }
export const PREFILL_LABEL: Record<Prefill, string> = { machine_code: 'Máy / bồn của mẻ', planned_qty: 'Kế hoạch của mẻ' }
/** Trần số ô một phiếu (BE cùng trần) */
export const MAX_CELLS = 300

/** Mã ô của bảng theo dõi: <bảng>_<lần>_<cột>_<ô> — vd wash_3_s2_ph */
export const gridKey = (grid: string, row: number, col: string, cell: string) => `${grid}_${row}_${col}_${cell}`
/** Tổng số ô của một phiếu (để báo "đã ghi n / m ô" và chặn vượt trần) */
export const blockCellCount = (blocks: FormBlock[]) =>
  blocks.reduce((s, b) => s + (b.type === 'grid' ? b.rows * b.cols.length * b.cells.length : b.fields.length), 0)
/** Mọi mã ô của phiếu (để tìm giá trị đã ghi mà mẫu không còn ô) */
export function blockKeys(blocks: FormBlock[]): Set<string> {
  const out = new Set<string>()
  for (const b of blocks) {
    if (b.type === 'fields') { for (const f of b.fields) out.add(f.key); continue }
    for (let r = 1; r <= b.rows; r++) for (const c of b.cols) for (const x of b.cells) out.add(gridKey(b.key, r, c.key, x.key))
  }
  return out
}

/** Nhãn tiếng Việt → mã ô (bỏ dấu, chữ thường, `_`), không trùng `used` */
export function slugKey(label: string, used: Set<string>, max = 24): string {
  const base = (label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max) || 'o').replace(/^(\d)/, 'o$1')
  let k = base, i = 2
  while (used.has(k)) k = `${base.slice(0, max - String(i).length - 1)}_${i++}`
  return k
}
/** Mã ngắn cho cột / ô của bảng (chữ thường + số, ≤ 8) */
export function shortKey(label: string, used: Set<string>): string {
  const base = slugKey(label, new Set(), 8).replace(/_/g, '').slice(0, 6) || 'c'
  let k = base, i = 2
  while (used.has(k)) k = `${base}${i++}`
  return k
}
/** Mã cho bảng theo dõi MỚI: bang, bang2, bang3… — không trùng bảng khác và không là tiền tố của mã ô nào (luật BE processBlocksError) */
export function gridKeyFor(blocks: FormBlock[]): string {
  const used = usedKeys(blocks)
  const clash = (k: string) => used.has(k) || [...used].some(u => u.startsWith(`${k}_`))
  let i = 1, k = 'bang'
  while (clash(k)) k = `bang${++i}`
  return k
}
/** Mọi mã ô "thường" + tiền tố bảng đang dùng trong phiếu — để sinh mã mới không đụng */
export function usedKeys(blocks: FormBlock[]): Set<string> {
  const s = new Set<string>()
  for (const b of blocks) if (b.type === 'fields') b.fields.forEach(f => s.add(f.key)); else s.add(b.key)
  return s
}

/** Lỗi của bộ khối ô — MIRROR của BE `utils/processBlocks.ts` processBlocksError (test backend/tests/mirror/processBlocks.mirror.test.ts);
 *  thêm vài luật chỉ FE cần (tên trống, khối rỗng — BE chặn bằng zod). '' = hợp lệ */
export function blocksError(blocks: FormBlock[]): string {
  if (!blocks.length) return 'Phiếu phải có ít nhất một khối ô'
  const keys = new Set<string>(); const grids: string[] = []
  for (const b of blocks) {
    if (!b.title.trim()) return 'Có khối chưa đặt tên'
    if (b.type === 'grid') {
      if (grids.includes(b.key)) return `Hai bảng cùng mã "${b.key}"`
      grids.push(b.key)
      if (new Set(b.cols.map(c => c.key)).size !== b.cols.length) return `Bảng "${b.title}" có cột trùng mã`
      if (new Set(b.cells.map(c => c.key)).size !== b.cells.length) return `Bảng "${b.title}" có ô trùng mã`
      if (!b.cols.length || !b.cells.length) return `Bảng "${b.title}" phải có ít nhất một cột và một ô`
      if (b.cols.some(c => !c.label.trim()) || b.cells.some(c => !c.label.trim())) return `Bảng "${b.title}" có cột / ô chưa đặt tên`
      continue
    }
    if (!b.fields.length) return `Nhóm "${b.title}" chưa có ô nào`
    for (const f of b.fields) {
      if (!f.label.trim()) return `Nhóm "${b.title}" có ô chưa đặt tên`
      if (keys.has(f.key)) return `Mã ô "${f.key}" bị trùng`
      keys.add(f.key)
      if (f.kind !== 'num' && (f.min != null || f.max != null)) return `Ô "${f.label}" không phải ô số — không đặt ngưỡng được`
      if (f.min != null && f.max != null && f.min > f.max) return `Ô "${f.label}": ngưỡng dưới lớn hơn ngưỡng trên`
    }
  }
  for (const k of keys) if (grids.some(g => k.startsWith(`${g}_`))) return `Mã ô "${k}" trùng tiền tố với bảng — đổi tên ô`
  const n = blockCellCount(blocks)
  if (n > MAX_CELLS) return `Phiếu có ${n} ô — tối đa ${MAX_CELLS} (bảng tính số lần × cột × ô)`
  return ''
}

/** TIẾN ĐỘ một phiếu (17/11 — user: "action trước xong mới hiện action sau", "phiếu đang điền / điền xong / chưa điền có dấu hiệu nhận diện").
 *  Mốc giờ = các ô kiểu Giờ của nhóm ô, THEO THỨ TỰ trên mẫu: bấm là ghi giờ; `next` = mốc đầu tiên chưa ghi.
 *  Xong = mọi mốc đã ghi và mọi ô bắt buộc đã có. */
export interface FormProgress { actions: ProcessField[]; done: number; next: ProcessField | null; requiredMissing: ProcessField[]; state: 'none' | 'progress' | 'done' }
export function formProgress(blocks: FormBlock[], data?: Record<string, string> | null): FormProgress {
  const fields = blocks.flatMap(b => (b.type === 'fields' ? b.fields : []))
  const has = (k: string) => !!String(data?.[k] ?? '').trim()
  const actions = fields.filter(f => f.kind === 'time')
  const next = actions.find(f => !has(f.key)) ?? null
  const requiredMissing = fields.filter(f => f.required && !has(f.key))
  const any = !!data && Object.values(data).some(v => String(v ?? '').trim())
  return { actions, done: actions.filter(f => has(f.key)).length, next, requiredMissing, state: !any ? 'none' : !next && !requiredMissing.length ? 'done' : 'progress' }
}

// ── PHIẾU BỔ SUNG (17/11) — phiếu thường mẻ nào cũng có; phiếu bổ sung (optional) chỉ có ở mẻ được chọn ──
type FormLite = { code: string; is_active: boolean; optional?: boolean; material_ids?: string[] }
/** phiếu bổ sung tick sẵn khi mở mẻ mã này (BE: hàm mes_default_forms — cùng luật) */
export const defaultExtraForms = (forms: FormLite[], materialId: string) =>
  forms.filter(f => f.optional && f.is_active && (f.material_ids ?? []).includes(materialId)).map(f => f.code)
/** phiếu hiện trên mẻ: phiếu thường đang dùng + phiếu bổ sung của mẻ + phiếu đã ghi (kể cả mẫu đã ngưng) */
export function formsOfBatch<T extends FormLite>(forms: T[], extra: string[], logged: string[]): T[] {
  return forms.filter(f => logged.includes(f.code) || (f.is_active && (!f.optional || extra.includes(f.code))))
}
