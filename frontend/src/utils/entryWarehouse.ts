// KHO của một pallet khi CHUYỂN Ô — cùng luật với server (backend/src/utils/entryWarehouse.ts, chặn CROSS_WAREHOUSE):
// cột warehouse_id trước, trống thì suy từ ô đang đứng. Dòng tồn ở màn hình mang ô dạng { warehouse: { id } }.
// MIRROR test: backend/tests/mirror/entryWarehouse.mirror.test.ts. Lớp C118 (17/11).
export interface EntryWhInput {
  warehouse_id?: string | null
  location?: { warehouse_id?: string | null; warehouse?: { id?: string | null } | null } | null
}
export function moveSourceWarehouse(e: EntryWhInput): string | null {
  return e.warehouse_id ?? e.location?.warehouse_id ?? e.location?.warehouse?.id ?? null
}
/** các kho (không trùng) của một lô pallet — dài 1 thì chuyển được một lần */
export function selectionWarehouses(entries: EntryWhInput[]): string[] {
  return [...new Set(entries.map(moveSourceWarehouse).filter((x): x is string => !!x))]
}
