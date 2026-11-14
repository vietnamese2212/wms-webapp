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
/** Mọi mã ô "thường" + tiền tố bảng đang dùng trong phiếu — để sinh mã mới không đụng */
export function usedKeys(blocks: FormBlock[]): Set<string> {
  const s = new Set<string>()
  for (const b of blocks) if (b.type === 'fields') b.fields.forEach(f => s.add(f.key)); else s.add(b.key)
  return s
}

/** Lỗi của bộ khối ô (cùng luật BE processBlocksError) — '' = hợp lệ */
export function blocksError(blocks: FormBlock[]): string {
  if (!blocks.length) return 'Phiếu phải có ít nhất một khối ô'
  const keys = new Set<string>(); const grids: string[] = []
  for (const b of blocks) {
    if (!b.title.trim()) return 'Có khối chưa đặt tên'
    if (b.type === 'grid') {
      if (grids.includes(b.key)) return `Hai bảng cùng mã "${b.key}"`
      grids.push(b.key)
      if (!b.cols.length || !b.cells.length) return `Bảng "${b.title}" phải có ít nhất một cột và một ô`
      if (b.cols.some(c => !c.label.trim()) || b.cells.some(c => !c.label.trim())) return `Bảng "${b.title}" có cột / ô chưa đặt tên`
      continue
    }
    if (!b.fields.length) return `Nhóm "${b.title}" chưa có ô nào`
    for (const f of b.fields) {
      if (!f.label.trim()) return `Nhóm "${b.title}" có ô chưa đặt tên`
      if (keys.has(f.key)) return `Mã ô "${f.key}" bị trùng`
      keys.add(f.key)
      if (f.min != null && f.max != null && f.min > f.max) return `Ô "${f.label}": ngưỡng dưới lớn hơn ngưỡng trên`
    }
  }
  const n = blockCellCount(blocks)
  if (n > MAX_CELLS) return `Phiếu có ${n} ô — tối đa ${MAX_CELLS} (bảng tính số lần × cột × ô)`
  return ''
}
