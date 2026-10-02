/**
 * DÒNG XE THEO KHO (03/10/2026 — user 02/10: "cũng là các dòng xe đã khai, nhưng mỗi kho sẽ có setting khác nhau: Bàu Bàng có
 * xe 1,9 tấn, Ba Vì không" · "thêm dòng xe thì bắt buộc thêm ở Chung, không cho master data dòng xe khác nhau ở các kho").
 *
 * Một bảng master `vehicle_model` (bản CHUNG: mã SAP · tên · cha · điều kiện bảo quản · thước đo · cách tính cước · số mặc định)
 * + bảng `warehouse_vehicle_model` = cấu hình RIÊNG của kho cho một dòng xe: dùng hay không + sức chứa + điểm giao.
 * Kho chưa có dòng ⇒ chạy theo Chung. Đã có dòng ⇒ BẢN CHỤP đầy đủ (user: "config riêng rồi thì không lấy theo chung nữa").
 * Mọi cửa đọc dòng xe "của một kho" (điều vận · cước · cột Tải ở Xuất kho · danh sách ở tab Mã dòng xe) đi qua đây — không
 * tự join rải rác.
 */
import { db } from '../lib/supabase'
import { fetchAllRowsParallel } from '../utils/pagination'

export interface WhModelOverride {
  vehicle_model_id: string
  is_active: boolean
  max_pallets: number | null
  max_tons: number | null
  max_drops: number | null
}
export interface ScopableModel { id: string; is_active: boolean; max_pallets: number | null; max_tons: number | null; max_drops: number | null }
export type ScopedModel<T> = T & { wh_override: boolean }

const numOrNull = (v: unknown): number | null => { const n = Number(v); return v == null || !Number.isFinite(n) ? null : n }

/** Thuần: đè bản chụp của kho lên bản Chung. Có dòng kho ⇒ CẢ BỐN giá trị lấy theo kho (kể cả is_active: Chung tắt mà kho bật
 *  = kho dùng). Không có ⇒ nguyên bản Chung. `wh_override` để màn hình in "Riêng" / "Theo chung". */
export function applyWarehouseOverrides<T extends ScopableModel>(models: T[], overrides: WhModelOverride[]): ScopedModel<T>[] {
  const by = new Map(overrides.map(o => [o.vehicle_model_id, o]))
  return models.map(m => {
    const o = by.get(m.id)
    return o
      ? { ...m, is_active: o.is_active, max_pallets: o.max_pallets, max_tons: o.max_tons, max_drops: o.max_drops, wh_override: true }
      : { ...m, wh_override: false }
  })
}

/** Ngưỡng Non tải áp cho một dòng xe tại kho: dải tải theo dòng xe CHA của kho → ngưỡng Non tải của kho → 70.
 *  (02/10: ô "Non tải dưới %" của dòng xe BỎ — bàn điều vận là chỗ khai duy nhất, kho là mặc định khi mở bàn.) */
export function underloadPctAt(wh: { dispatch_load_bands?: unknown; dispatch_underload_pct?: number | string | null } | null | undefined, parentTypeId: string | null | undefined): number {
  const bands = (wh?.dispatch_load_bands ?? null) as Record<string, { min?: unknown }> | null
  const band = parentTypeId && bands && typeof bands === 'object' ? bands[parentTypeId] : undefined
  const bMin = numOrNull(band?.min)
  if (bMin != null && bMin >= 0) return bMin
  const w = numOrNull(wh?.dispatch_underload_pct)
  return w != null && w > 0 ? w : 70
}

/** Dòng cấu hình riêng của MỘT kho (danh mục nhỏ: ≤ số dòng xe). */
export async function loadWarehouseOverrides(whId: string): Promise<WhModelOverride[]> {
  const rows = await fetchAllRowsParallel(() => db.from('warehouse_vehicle_model')
    .select('vehicle_model_id, is_active, max_pallets, max_tons, max_drops').eq('warehouse_id', whId).order('vehicle_model_id')) as
    { vehicle_model_id: string; is_active: boolean; max_pallets: number | null; max_tons: number | string | null; max_drops: number | null }[]
  return rows.map(r => ({ vehicle_model_id: r.vehicle_model_id, is_active: r.is_active, max_pallets: numOrNull(r.max_pallets), max_tons: numOrNull(r.max_tons), max_drops: numOrNull(r.max_drops) }))
}

/** Dòng cấu hình riêng của NHIỀU kho, gom theo kho (cước ước tính của chuyến Xuất kho: mỗi chuyến một kho). */
export async function loadWarehouseOverridesMany(whIds: string[]): Promise<Map<string, WhModelOverride[]>> {
  const out = new Map<string, WhModelOverride[]>()
  const ids = [...new Set(whIds.filter(Boolean))]
  if (!ids.length) return out
  const rows = await fetchAllRowsParallel(() => db.from('warehouse_vehicle_model')
    .select('warehouse_id, vehicle_model_id, is_active, max_pallets, max_tons, max_drops').in('warehouse_id', ids.slice(0, 300)).order('id')) as
    { warehouse_id: string; vehicle_model_id: string; is_active: boolean; max_pallets: number | null; max_tons: number | string | null; max_drops: number | null }[]
  for (const r of rows) {
    const l = out.get(r.warehouse_id) ?? []
    l.push({ vehicle_model_id: r.vehicle_model_id, is_active: r.is_active, max_pallets: numOrNull(r.max_pallets), max_tons: numOrNull(r.max_tons), max_drops: numOrNull(r.max_drops) })
    out.set(r.warehouse_id, l)
  }
  return out
}
