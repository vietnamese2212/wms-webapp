// Chế độ quản tồn kho (Warehouse.inventory_mode) — khớp BE backend/src/lib/inventoryMode.ts.
// QTY_DATE = như QTY (tồn số lượng, không quét tem) nhưng pool tách theo NSX, xuất trừ FEFO.
export function isQtyLike(inventoryMode: string | null | undefined): boolean {
  return inventoryMode === 'QTY' || inventoryMode === 'QTY_DATE'
}
