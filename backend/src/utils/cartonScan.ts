import { supabase } from '../lib/supabase'
import { getWhTypeMetaMap } from './warehouseTypeMeta'

// Cờ "quét tới THÙNG khi xuất" — 2 điều kiện VÀ (user chốt 12/07):
//   1) KHO bật công tắc (Warehouse.carton_scan_override = true; mặc định TẮT) — kho tắt thì miễn xét.
//   2) LOẠI HÀNG của chuyến (cargoCategory = GDO.warehouse_type) có cờ meta.requires_carton_scan.
// → chỉ kho ĐÃ BẬT và đúng loại hàng ĐANG BẬT mới phải quét thùng; mặc định cả 2 đều tắt.
// Defensive: cột kho chưa apply migration (production) → coi như kho tắt (hành vi cũ, không vỡ).
export async function warehouseRequiresCartonScan(
  warehouseId: string | null | undefined,
  cargoCategory: string | null | undefined,
): Promise<boolean> {
  if (!warehouseId || !cargoCategory) return false
  const { data, error } = await supabase.from('Warehouse')
    .select('carton_scan_override').eq('id', warehouseId).maybeSingle()
  if (error) return false
  const whOn = (data as { carton_scan_override?: boolean | null } | null)?.carton_scan_override === true
  if (!whOn) return false   // kho tắt → không xét loại kho
  return (await getWhTypeMetaMap()).get(cargoCategory)?.requires_carton_scan === true
}
