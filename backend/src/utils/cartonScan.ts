import { supabase } from '../lib/supabase'

// Cờ "quét tới THÙNG khi xuất" — setup TẠI TỪNG KHO (user chốt 12/07 lần 2):
//   Warehouse.carton_scan_override = công tắc kho (mặc định TẮT)
//   Warehouse.carton_scan_categories = CÁC Loại kho phải quét TẠI KHO ĐÓ (multi, độc lập từng kho)
// → bật khi: công tắc ON && loại hàng của chuyến (GDO.warehouse_type) nằm trong danh sách.
// vd kho 1 quét [Thành phẩm, POSM], kho 2 chỉ [Thùng] — không ảnh hưởng nhau. KHÔNG dùng meta Loại kho.
// Defensive: cột chưa apply migration (production) → select lỗi → coi như tắt (hành vi cũ).
export async function warehouseRequiresCartonScan(
  warehouseId: string | null | undefined,
  cargoCategory: string | null | undefined,
): Promise<boolean> {
  if (!warehouseId || !cargoCategory) return false
  const { data, error } = await supabase.from('Warehouse')
    .select('carton_scan_override, carton_scan_categories').eq('id', warehouseId).maybeSingle()
  if (error) return false
  const row = data as { carton_scan_override?: boolean | null; carton_scan_categories?: string[] | null } | null
  if (row?.carton_scan_override !== true) return false             // công tắc kho tắt → miễn xét
  return (row.carton_scan_categories ?? []).includes(cargoCategory) // đúng loại đã chọn tại kho
}
