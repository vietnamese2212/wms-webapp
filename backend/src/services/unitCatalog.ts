// Danh mục Đơn vị tính (LookupValue type 'unit_of_measure') — phần backend cần ĐỌC TƯƠI ở cửa ghi.
//
// 28/11 — đơn vị nào là ĐƠN VỊ ĐO (kg, lít…: bao chỉ là quy cách gợi ý) là cờ meta.measure của danh mục, người dùng bật / tắt ở
// Cài đặt WMS → Đơn vị tính. Cửa ghi Mã hàng (form · Excel) đọc tập này MỖI LẦN ghi — không cache: danh mục chỉ ~12 dòng, còn
// một bản cache cũ ở instance serverless khác sẽ tách sai entry unit / quy cách gợi ý (DB cũng chặn: trg_material_unit_kind).
import { db } from '../lib/supabase'
import { measureUnitCodes } from '../utils/qtyUnits'

export async function loadMeasureUnitCodes(): Promise<Set<string>> {
  const { data, error } = await db.from('LookupValue').select('value, meta').eq('type', 'unit_of_measure')
  if (error) throw error
  return measureUnitCodes((data ?? []) as { value: string | null; meta: { measure?: unknown } | null }[])
}
