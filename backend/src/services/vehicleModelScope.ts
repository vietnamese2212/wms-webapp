/**
 * DÒNG XE THEO KHO (03/10/2026 — user 02/10: "cũng là các dòng xe đã khai, nhưng mỗi kho sẽ có setting khác nhau: Bàu Bàng có
 * xe 1,9 tấn, Ba Vì không" · "thêm dòng xe thì bắt buộc thêm ở Chung, không cho master data dòng xe khác nhau ở các kho").
 *
 * Một bảng master `vehicle_model` (bản CHUNG: mã SAP · tên · cha · điều kiện bảo quản · thước đo · cách tính cước · số mặc định)
 * + bảng `warehouse_vehicle_model` = cấu hình RIÊNG của kho cho một dòng xe: dùng hay không + sức chứa + điểm giao.
 * RIÊNG THEO TỪNG Ô (03/10 chiều, user: "thay đổi 1 điểm tại kho riêng thì mọi setting của Chung không còn với tới kho — chưa hợp
 * lý"): ô nào của dòng kho là NULL thì ô đó theo Chung; kho chỉ giữ ô đã chỉnh. Không có dòng = theo Chung hoàn toàn.
 * Mọi cửa đọc dòng xe "của một kho" (điều vận · cước · cột Tải ở Xuất kho · danh sách ở tab Mã dòng xe) đi qua đây — không
 * tự join rải rác.
 */
import { db } from '../lib/supabase'
import { fetchAllRowsParallel } from '../utils/pagination'

export const WH_MODEL_FIELDS = ['is_active', 'max_pallets', 'max_tons', 'max_drops', 'allow_multi_vehicle', 'detour_pct'] as const
export type WhModelField = typeof WH_MODEL_FIELDS[number]
export interface WhModelOverride {
  vehicle_model_id: string
  is_active: boolean | null       // NULL = theo Chung
  max_pallets: number | null
  max_tons: number | null
  max_drops: number | null
  allow_multi_vehicle?: boolean | null   // 07/10 — ghép nhiều xe trên một thẻ; NULL = theo dòng xe (bản Chung)
  detour_pct?: number | null             // 08/10 — xe tuyến liên tỉnh: đường vòng tối đa %; NULL = theo dòng xe (bản Chung), 0 = tắt ở kho
}
export interface ScopableModel { id: string; is_active: boolean; max_pallets: number | null; max_tons: number | null; max_drops: number | null; allow_multi_vehicle?: boolean | null; detour_pct?: number | null }
/** "GHÉP NHIỀU XE TRÊN MỘT THẺ" hiệu lực (07/10, user: "khai như các tính năng khác — xe cha lấy xuống xe con, theo kho"): ô của dòng
 *  xe tại kho (đã đè kho ?? Chung qua `applyWarehouseOverrides`) → loại xe CHA → mặc định được ghép (hành vi trước 07/10). */
export const multiVehicleOf = (model: boolean | null | undefined, parent: boolean | null | undefined): boolean => model ?? parent ?? true
/** "XE TUYẾN LIÊN TỈNH — ĐƯỜNG VÒNG TỐI ĐA %" hiệu lực (08/10, user: "chuyển sang dòng xe cha; dòng xe con chọn khác thì lấy theo con"):
 *  ô của dòng xe tại kho (kho ?? Chung) → loại xe CHA → tắt. 0 ở bậc nào là TẮT ở bậc đó (con tắt dù cha bật). null = không ghép khác tỉnh. */
export const detourPctOf = (model: number | string | null | undefined, parent: number | string | null | undefined): number | null => {
  const v = numOrNull(model) ?? numOrNull(parent)
  return v != null && v > 0 ? v : null
}
/** `wh_fields` = các ô kho đã chỉnh riêng (rỗng = theo Chung hoàn toàn); `wh_override` = có ô nào riêng. */
export type ScopedModel<T> = T & { wh_override: boolean; wh_fields: WhModelField[] }

const numOrNull = (v: unknown): number | null => { const n = Number(v); return v == null || !Number.isFinite(n) ? null : n }

/** Thuần: đè TỪNG Ô kho đã chỉnh lên bản Chung. Ô NULL ở dòng kho = theo Chung (kể cả is_active). Không có dòng ⇒ nguyên bản Chung.
 *  Lưu ý: `max_drops` kho = null nghĩa là THEO CHUNG, không phải "chưa khai" — kho muốn mỗi khách một xe thì khai 1. */
export function applyWarehouseOverrides<T extends ScopableModel>(models: T[], overrides: WhModelOverride[]): ScopedModel<T>[] {
  const by = new Map(overrides.map(o => [o.vehicle_model_id, o]))
  return models.map(m => {
    const o = by.get(m.id)
    if (!o) return { ...m, wh_override: false, wh_fields: [] }
    const fields = WH_MODEL_FIELDS.filter(k => o[k] != null)
    return {
      ...m,
      is_active:   o.is_active   ?? m.is_active,
      max_pallets: o.max_pallets ?? m.max_pallets,
      max_tons:    o.max_tons    ?? m.max_tons,
      max_drops:   o.max_drops   ?? m.max_drops,
      allow_multi_vehicle: o.allow_multi_vehicle ?? m.allow_multi_vehicle ?? null,
      detour_pct: o.detour_pct ?? m.detour_pct ?? null,
      wh_override: fields.length > 0, wh_fields: fields,
    }
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

type OvRow = { warehouse_id?: string; vehicle_model_id: string; is_active: boolean | null; max_pallets: number | null; max_tons: number | string | null; max_drops: number | null; allow_multi_vehicle?: boolean | null; detour_pct?: number | string | null }
const ovOf = (r: OvRow): WhModelOverride => ({ vehicle_model_id: r.vehicle_model_id, is_active: r.is_active ?? null, max_pallets: numOrNull(r.max_pallets), max_tons: numOrNull(r.max_tons), max_drops: numOrNull(r.max_drops), allow_multi_vehicle: r.allow_multi_vehicle ?? null, detour_pct: numOrNull(r.detour_pct) })

/** Dòng cấu hình riêng của MỘT kho (danh mục nhỏ: ≤ số dòng xe). */
export async function loadWarehouseOverrides(whId: string): Promise<WhModelOverride[]> {
  const rows = await fetchAllRowsParallel(() => db.from('warehouse_vehicle_model')
    .select('vehicle_model_id, is_active, max_pallets, max_tons, max_drops, allow_multi_vehicle, detour_pct').eq('warehouse_id', whId).order('vehicle_model_id')) as OvRow[]
  return rows.map(ovOf)
}

/** Dòng cấu hình riêng của NHIỀU kho, gom theo kho (cước ước tính của chuyến Xuất kho: mỗi chuyến một kho). */
export async function loadWarehouseOverridesMany(whIds: string[]): Promise<Map<string, WhModelOverride[]>> {
  const out = new Map<string, WhModelOverride[]>()
  const ids = [...new Set(whIds.filter(Boolean))]
  if (!ids.length) return out
  const rows = await fetchAllRowsParallel(() => db.from('warehouse_vehicle_model')
    .select('warehouse_id, vehicle_model_id, is_active, max_pallets, max_tons, max_drops, allow_multi_vehicle, detour_pct').in('warehouse_id', ids.slice(0, 300)).order('id')) as (OvRow & { warehouse_id: string })[]
  for (const r of rows) {
    const l = out.get(r.warehouse_id) ?? []
    l.push(ovOf(r))
    out.set(r.warehouse_id, l)
  }
  return out
}
