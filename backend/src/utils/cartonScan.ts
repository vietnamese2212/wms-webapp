import { supabase } from '../lib/supabase'
import { getWhTypeMetaMap } from './warehouseTypeMeta'

// Cờ "quét tới THÙNG khi xuất" giải theo 2 cấp — KHO đè LOẠI KHO:
//   override (Warehouse.carton_scan_override, theo warehouse_id) ??
//   Loại kho / cargo category (LookupValue.meta.requires_carton_scan, theo cargoCategory) ?? false.
// LƯU Ý: Warehouse.warehouse_type = CENTRAL/NPP (vai kho), KHÔNG phải cargo category — cờ Loại kho
// tra theo cargoCategory (= GDO.warehouse_type, vd Thành phẩm/POSM…), truyền vào từ nơi gọi.
// Defensive: cột carton_scan_override có thể CHƯA tồn tại (migration 20260712 chưa apply) →
// select lỗi thì coi override = null → chỉ theo Loại kho (mặc định tắt) = hành vi cũ.
export async function warehouseRequiresCartonScan(
  warehouseId: string | null | undefined,
  cargoCategory: string | null | undefined,
): Promise<boolean> {
  let override: boolean | null = null
  if (warehouseId) {
    const { data, error } = await supabase.from('Warehouse')
      .select('carton_scan_override').eq('id', warehouseId).maybeSingle()
    if (!error) override = (data as { carton_scan_override?: boolean | null } | null)?.carton_scan_override ?? null
  }
  if (override !== null && override !== undefined) return override    // Kho đè Loại kho
  if (!cargoCategory) return false
  return (await getWhTypeMetaMap()).get(cargoCategory)?.requires_carton_scan === true
}
