// Thùng/Pallet hiệu lực theo KHO — ngoại lệ kho đè định mức chung.
// Nếu material có warehouse_pallet_overrides cho kho đang xét → dùng giá trị đó;
// không có (hoặc <=0) → dùng cartons_per_pallet mặc định.

interface PalletOverride {
  warehouse_id: string
  cartons_per_pallet: number
}

interface MaterialPalletInfo {
  cartons_per_pallet?: number | null
  warehouse_pallet_overrides?: PalletOverride[] | null
}

export function effCartonsPerPallet(
  material: MaterialPalletInfo | null | undefined,
  warehouseId: string | null | undefined,
): number {
  const base = Number(material?.cartons_per_pallet ?? 0)
  if (!material || !warehouseId) return base
  const ov = material.warehouse_pallet_overrides?.find(o => o.warehouse_id === warehouseId)
  const v = ov?.cartons_per_pallet
  return v != null && Number(v) > 0 ? Number(v) : base
}
