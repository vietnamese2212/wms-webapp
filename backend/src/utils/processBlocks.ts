// LUẬT HÌNH DẠNG của mẫu phiếu theo dõi (MES 14/11) — BE dùng ở PUT mẫu phiếu + PUT phiếu của mẻ (bản sửa riêng tại bàn).
// MIRROR: FE `frontend/src/config/processForms.ts` → `blocksError` (test backend/tests/mirror/processBlocks.mirror.test.ts).
// Sửa một bên thì sửa cả hai — FE lọt luật thì người dùng gõ xong cả phiếu mới bị 422 lúc lưu.
export interface ProcessBlockField { key: string; label: string; kind: 'num' | 'time' | 'text'; min?: number; max?: number }
export type ProcessBlock =
  | { type: 'fields'; title: string; fields: ProcessBlockField[] }
  | { type: 'grid'; key: string; title: string; rows: number; cols: { key: string }[]; cells: { key: string }[] }
export const PROCESS_MAX_CELLS = 300

/** lỗi nghiệp vụ của một bộ khối ô (trùng mã ô, ngưỡng ngược, quá số ô một phiếu chứa được) — null = hợp lệ */
export function processBlocksError(blocks: ProcessBlock[]): string | null {
  const keys = new Set<string>()
  const gridKeys: string[] = []
  let total = 0
  for (const bl of blocks) {
    if (bl.type === 'grid') {
      if (gridKeys.includes(bl.key)) return `Hai bảng cùng mã "${bl.key}"`
      gridKeys.push(bl.key)
      if (new Set(bl.cols.map(c => c.key)).size !== bl.cols.length) return `Bảng "${bl.title}" có cột trùng mã`
      if (new Set(bl.cells.map(c => c.key)).size !== bl.cells.length) return `Bảng "${bl.title}" có ô trùng mã`
      total += bl.rows * bl.cols.length * bl.cells.length
      continue
    }
    for (const f of bl.fields) {
      if (keys.has(f.key)) return `Mã ô "${f.key}" bị trùng`
      keys.add(f.key)
      if (f.kind !== 'num' && (f.min != null || f.max != null)) return `Ô "${f.label}" không phải ô số — không đặt ngưỡng được`
      if (f.min != null && f.max != null && f.min > f.max) return `Ô "${f.label}": ngưỡng dưới lớn hơn ngưỡng trên`
      total++
    }
  }
  for (const k of keys) if (gridKeys.some(g => k.startsWith(`${g}_`))) return `Mã ô "${k}" trùng tiền tố với bảng — đổi tên ô`
  if (total > PROCESS_MAX_CELLS) return `Phiếu có ${total} ô — tối đa ${PROCESS_MAX_CELLS} ô (bảng tính số lần × cột × ô)`
  return null
}
