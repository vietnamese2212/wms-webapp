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

/**
 * SỐ / PALLET ĐỔI ĐƠN VỊ khi mã THÊM hoặc BỎ đơn vị quy cách (27/11 — đường trắng: 1 bao = 20 kg).
 * Số / pallet (cartons_per_pallet, số của từng kho) tính theo ĐƠN VỊ QUY CÁCH nếu mã có (thùng / bao), không có thì
 * theo ĐƠN VỊ GỐC (kg). Thêm quy cách mà giữ nguyên số ⇒ "1.000 kg / pallet" bị hiểu là 1.000 bao = 20.000 kg khi gợi ý nhập.
 *   • có → có, không → không: đơn vị của ô không đổi ⇒ 'same';
 *   • không → có (hệ số f): số mới = số cũ ÷ f, phải ra số nguyên — không ⇒ 'not_whole' (bắt khai lại theo đơn vị mới);
 *   • có (hệ số f) → không: số mới = số cũ × f.
 * Số cũ trống / ≤ 0 ⇒ 'same' (không có gì để đổi). Dùng chung: form Mã hàng (gợi ý), API sửa mã + nạp Excel (ghi).
 */
export type PalletUnits = { entry_unit?: string | null; units_per_carton?: number | null }
export type PalletQtyChange = { kind: 'same' } | { kind: 'converted'; qty: number } | { kind: 'not_whole'; exact: number }
export function palletQtyOnUnitChange(qty: number | null | undefined, from: PalletUnits, to: PalletUnits): PalletQtyChange {
  const v = Number(qty)
  if (!(v > 0) || !Number.isFinite(v)) return { kind: 'same' }
  const fromF = from.entry_unit && Number(from.units_per_carton) > 0 ? Number(from.units_per_carton) : 0
  const toF = to.entry_unit && Number(to.units_per_carton) > 0 ? Number(to.units_per_carton) : 0
  if ((fromF > 0) === (toF > 0)) return { kind: 'same' }
  if (toF > 0) {
    const exact = v / toF
    return Math.abs(exact - Math.round(exact)) < 1e-9 ? { kind: 'converted', qty: Math.round(exact) } : { kind: 'not_whole', exact: Math.round(exact * 1000) / 1000 }
  }
  return { kind: 'converted', qty: Math.round(v * fromF * 1000) / 1000 }
}
