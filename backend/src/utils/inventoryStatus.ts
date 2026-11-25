// MỘT luật trạng thái của dòng tồn (InventoryEntry.status) sau khi đổi còn / giữ — bản TS của hàm SQL `inventory_entry_status`
// (migration 20261125e). Hai bản cùng chạy bảng ca `backend/tests/unit/inventoryStatusCases.json` (vitest + khối DO của migration).
// 25/11 rà soát MES: trước đây 6 chỗ tự viết CASE riêng (có chỗ bỏ qua phần giữ chỗ ⇒ đè mất LOOSE_PICKING, có chỗ không tính lại).
//   • trạng thái đặc biệt ngoài bộ bốn IN_STOCK / PARTIAL / EXPORTED / LOOSE_PICKING (vd QUARANTINE) ⇒ giữ nguyên;
//   • còn phần đang GIỮ cho nhặt lẻ ⇒ LOOSE_PICKING;
//   • hết ⇒ EXPORTED; còn ít hơn nhập ⇒ PARTIAL; còn đủ ⇒ IN_STOCK.
const ORDINARY = new Set(['IN_STOCK', 'PARTIAL', 'EXPORTED', 'LOOSE_PICKING'])

export function inventoryEntryStatus(cur: string | null | undefined, remaining: number | null | undefined,
  imported: number | null | undefined, reserved: number | null | undefined): string {
  if (cur != null && !ORDINARY.has(cur)) return cur
  if (Number(reserved ?? 0) > 0) return 'LOOSE_PICKING'
  const rem = Number(remaining ?? 0)
  if (rem <= 0) return 'EXPORTED'
  if (rem < Number(imported ?? 0)) return 'PARTIAL'
  return 'IN_STOCK'
}
