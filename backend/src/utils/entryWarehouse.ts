// KHO của một pallet khi CHUYỂN Ô — một luật cho server (chặn CROSS_WAREHOUSE ở bulkTransferLocation) và màn
// hình (ô chọn vị trí của Tồn kho → Chuyển vị trí). Cột warehouse_id trước, trống thì suy từ ô đang đứng.
// MIRROR: FE `frontend/src/utils/entryWarehouse.ts` (test backend/tests/mirror/entryWarehouse.mirror.test.ts).
// Lớp C118 (17/11): màn hình từng chỉ lấy kho của Ô ⇒ pallet chưa xếp ô (kho chế biến) mất kho, ô chọn tải vị trí của mọi kho.
export interface EntryWhInput { warehouse_id?: string | null; location?: { warehouse_id?: string | null } | null }
export function moveSourceWarehouse(e: EntryWhInput): string | null {
  return e.warehouse_id ?? e.location?.warehouse_id ?? null
}
/** các kho (không trùng) của một lô pallet — dài 1 thì chuyển được một lần */
export function selectionWarehouses(entries: EntryWhInput[]): string[] {
  return [...new Set(entries.map(moveSourceWarehouse).filter((x): x is string => !!x))]
}
