// HSD (shelf-life) hiệu lực theo NCC — ngoại lệ NCC đè định mức chung.
// Nếu material có supplier_shelf_life_overrides cho NCC đang xét → dùng giá trị đó;
// không có NCC (SX/chuyển kho/pallet cũ) hoặc không khai override → dùng shelf_life_days mặc định.

interface SupplierOverride {
  transport_company_id: string
  shelf_life_days: number
}

interface MaterialShelfInfo {
  shelf_life_days?: number | null
  supplier_shelf_life_overrides?: SupplierOverride[] | null
}

// 1 NCC có thể khai NHIỀU shelflife (100 & 200) → khi đó không tự quyết được, trả base;
// giá trị thật lấy từ InventoryEntry.shelf_life_days. Chỉ NCC có ĐÚNG 1 shelflife mới suy tự động.
export function effShelfLife(
  material: MaterialShelfInfo | null | undefined,
  nccId: string | null | undefined,
): number {
  const base = Number(material?.shelf_life_days ?? 0)
  if (!material || !nccId) return base
  const matches = (material.supplier_shelf_life_overrides ?? [])
    .filter(o => o.transport_company_id === nccId && o.shelf_life_days != null && Number(o.shelf_life_days) > 0)
  return matches.length === 1 ? Number(matches[0].shelf_life_days) : base
}

// %Date 1 pallet: ưu tiên shelflife chọn theo lô (entry) → suy theo NCC → mặc định.
export function resolveShelfLife(
  entryShelfLife: number | null | undefined,
  material: MaterialShelfInfo | null | undefined,
  nccId: string | null | undefined,
): number {
  if (entryShelfLife != null && Number(entryShelfLife) > 0) return Number(entryShelfLife)
  return effShelfLife(material, nccId)
}
