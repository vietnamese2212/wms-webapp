// Đơn vị khai ở Mã hàng (form · file Excel) ⇒ cột lưu trong DB — MỘT hàm cho mọi cửa ghi Mã hàng (27/11).
//
// Người dùng luôn khai "Entry Unit + 1 Entry = N Base". App PHÂN BIỆT bằng ĐƠN VỊ GỐC:
//  - đơn vị đếm (HOP, BT, EA…): entry unit THẬT — "60 hộp = 1 thùng + 12 hộp", số theo hộp phải nguyên;
//  - đơn vị đo (KG, L…): QUY CÁCH GỢI Ý — user 27/11 "đường trắng key 1000 kg giữ là 1000 kg, chỉ gợi ý 50 bao, kg vẫn là đơn
//    vị chính" ⇒ lưu ở pack_unit / pack_size, entry_unit để trống. Mọi phép quy đổi / tổng / Excel / số pallet thấy mã như chưa
//    khai bao. DB chặn cửa quên tách: trigger trg_material_unit_kind (migration 20261128).
// Đơn vị nào là đơn vị đo do CỜ của danh mục Đơn vị tính quyết định (28/11 — Cài đặt WMS → Đơn vị tính, không còn danh sách cố
// định): cửa ghi nạp tập mã đơn vị đo bằng loadMeasureUnitCodes() (services/unitCatalog.ts) rồi truyền vào đây.

export type UnitCols = {
  entry_unit: string | null
  units_per_carton: number | null
  pack_unit: string | null
  pack_size: number | null
}

export function splitEntryPack(base: string | null | undefined, entry: string | null | undefined, factor: number | string | null | undefined,
                               measureUnits: ReadonlySet<string>): UnitCols {
  const e = String(entry ?? '').trim().toUpperCase() || null
  const n = factor == null || factor === '' ? null : Number(factor)
  const f = n != null && isFinite(n) ? n : null
  const b = String(base ?? '').trim().toUpperCase()
  if (e && b && measureUnits.has(b)) return { entry_unit: null, units_per_carton: null, pack_unit: e, pack_size: f }
  return { entry_unit: e, units_per_carton: f, pack_unit: null, pack_size: null }
}

/** Entry như người dùng thấy ở form / file: entry unit thật, không có thì quy cách gợi ý. */
export function declaredEntry(m: { entry_unit?: string | null; units_per_carton?: number | null; pack_unit?: string | null; pack_size?: number | null } | null | undefined): { entry: string | null; factor: number | null } {
  if (!m) return { entry: null, factor: null }
  return { entry: m.entry_unit || m.pack_unit || null, factor: m.units_per_carton ?? m.pack_size ?? null }
}
