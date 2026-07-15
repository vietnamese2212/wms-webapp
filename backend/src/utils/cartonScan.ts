import { supabase } from '../lib/supabase'

// Cờ "quét tới THÙNG khi xuất" — setup TẠI TỪNG KHO (user chốt 12/07 lần 2):
//   Warehouse.carton_scan_override = công tắc kho (mặc định TẮT)
//   Warehouse.carton_scan_categories = CÁC Loại kho phải quét TẠI KHO ĐÓ (multi, độc lập từng kho)
//   Warehouse.carton_scan_require_full = BẮT BUỘC quét đủ tem thùng mỗi pallet (user chốt 15/07,
//     mặc định false — không bắt buộc; true → gác chặn Hoàn thành chuyến khi pallet thiếu tem)
// → bật khi: công tắc ON && loại hàng của chuyến (GDO.warehouse_type) nằm trong danh sách.
// vd kho 1 quét [Thành phẩm, POSM], kho 2 chỉ [Thùng] — không ảnh hưởng nhau. KHÔNG dùng meta Loại kho.
// Defensive: cột chưa apply migration (production) → select lỗi → coi như tắt (hành vi cũ).
export interface CartonScanPolicy { enabled: boolean; requireFull: boolean }

export async function warehouseCartonScanPolicy(
  warehouseId: string | null | undefined,
  cargoCategory: string | null | undefined,
): Promise<CartonScanPolicy> {
  if (!warehouseId || !cargoCategory) return { enabled: false, requireFull: false }
  let { data, error } = await supabase.from('Warehouse')
    .select('carton_scan_override, carton_scan_categories, carton_scan_require_full').eq('id', warehouseId).maybeSingle()
  // Cột require_full chưa apply migration → select lại bộ cột cũ (coi như không bắt buộc)
  if (error && /carton_scan_require_full/i.test(error.message)) {
    ;({ data, error } = await supabase.from('Warehouse')
      .select('carton_scan_override, carton_scan_categories').eq('id', warehouseId).maybeSingle())
  }
  if (error) return { enabled: false, requireFull: false }
  const row = data as { carton_scan_override?: boolean | null; carton_scan_categories?: string[] | null; carton_scan_require_full?: boolean | null } | null
  if (row?.carton_scan_override !== true) return { enabled: false, requireFull: false }  // công tắc kho tắt → miễn xét
  const enabled = (row.carton_scan_categories ?? []).includes(cargoCategory)             // đúng loại đã chọn tại kho
  return { enabled, requireFull: enabled && row.carton_scan_require_full === true }
}

export async function warehouseRequiresCartonScan(
  warehouseId: string | null | undefined,
  cargoCategory: string | null | undefined,
): Promise<boolean> {
  return (await warehouseCartonScanPolicy(warehouseId, cargoCategory)).enabled
}
