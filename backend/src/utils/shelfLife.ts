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

export function effShelfLife(
  material: MaterialShelfInfo | null | undefined,
  nccId: string | null | undefined,
): number {
  const base = Number(material?.shelf_life_days ?? 0)
  if (!material || !nccId) return base
  const ov = material.supplier_shelf_life_overrides?.find(o => o.transport_company_id === nccId)
  const v = ov?.shelf_life_days
  return v != null && Number(v) > 0 ? Number(v) : base
}
