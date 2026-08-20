import { supabase } from '../lib/supabase'

/**
 * Cờ hành vi per-Loại kho (LookupValue type='warehouse_type', cột meta jsonb —
 * migration 20260710_warehouse_type_options). Thay cho các hằng số hardcode tên loại:
 * loại mới/đổi tên tự mang đúng hành vi theo cờ, không sửa code.
 * Cache 30s (cùng pattern getLabelFormat — điểm quét gọi mỗi lần, cờ đổi rất hiếm).
 */
export interface WhTypeMeta {
  is_ncc_goods?: boolean          // QR V1 đoạn 4 = mã NCC (thay vì Máy)
  requires_shelf_life?: boolean   // Mã hàng bắt buộc HSD
  requires_pallet_per_ea?: boolean// Mã hàng bắt buộc Pallet/EA
  requires_ncc?: boolean          // Nhập kho bắt buộc có NCC (quét/nhập tay/upload tồn — chuyển kho kế thừa, không chặn)
  batch_char?: string             // ký tự cố định thế chỗ Máy trong mã lô khi sinh tem V2
  badge_color?: string
}

// Phòng hộ khi meta chưa seed (migration chưa apply) — đúng hardcode cũ
const LEGACY_NCC_CATEGORIES = ['POSM', 'Raw', 'Thùng', 'Giấy']
// Mirror frontend/src/utils/cargoCategory.ts — dùng cho luật "Thiếu thông tin" của danh mục Mã hàng
export const LEGACY_NO_SHELF_LIFE = ['Thùng', 'POSM']
export const LEGACY_PALLET_PER_EA = ['Raw', 'Thùng', 'Giấy']

/** Luật bắt buộc HSD / Pallet-EA theo từng Loại kho → truyền xuống RPC (không hardcode tên trong SQL). */
export async function getMaterialCategoryRules(): Promise<{ c: string; sl: boolean; pe: boolean }[]> {
  const map = await getWhTypeMetaMap()
  return [...map.entries()].map(([c, meta]) => ({
    c,
    sl: typeof meta.requires_shelf_life === 'boolean' ? meta.requires_shelf_life : !LEGACY_NO_SHELF_LIFE.includes(c),
    pe: typeof meta.requires_pallet_per_ea === 'boolean' ? meta.requires_pallet_per_ea : LEGACY_PALLET_PER_EA.includes(c),
  }))
}

let _cache: { map: Map<string, WhTypeMeta>; at: number } | null = null

export async function getWhTypeMetaMap(): Promise<Map<string, WhTypeMeta>> {
  if (_cache && Date.now() - _cache.at < 30_000) return _cache.map
  const { data } = await supabase.from('LookupValue').select('value, meta').eq('type', 'warehouse_type')
  const map = new Map<string, WhTypeMeta>()
  for (const row of (data ?? []) as { value: string; meta?: WhTypeMeta | null }[]) {
    map.set(row.value, row.meta ?? {})
  }
  _cache = { map, at: Date.now() }
  return map
}

export function invalidateWhTypeMetaCache() { _cache = null; _whCache.clear() }

// ─── 3 cờ VẬN HÀNH khai riêng được theo từng kho (21/08) ──────────────────────
// Tên · Màu · Bắt buộc HSD · Bắt buộc Pallet/EA vẫn DÙNG CHUNG (2 cờ sau ràng buộc hồ sơ mã hàng,
// mà mã hàng dùng chung toàn hệ thống). 3 cờ dưới đây thì app luôn đọc khi ĐANG ĐỨNG Ở MỘT KHO nên
// khai riêng được: cột NULL ở `warehouse_type_configs` = theo giá trị chung ở danh mục.
export const WH_TYPE_META_COLS = ['is_ncc_goods', 'requires_ncc', 'batch_char'] as const
type WhOverride = { is_ncc_goods?: boolean | null; requires_ncc?: boolean | null; batch_char?: string | null }

const _whCache = new Map<string, { map: Map<string, WhTypeMeta>; at: number }>()

/** Cờ hành vi HIỆU LỰC tại một kho = danh mục chung + phần kho đó khai riêng. */
export async function getWhTypeMetaMapFor(warehouseId: string | null | undefined): Promise<Map<string, WhTypeMeta>> {
  const base = await getWhTypeMetaMap()
  if (!warehouseId) return base
  const hit = _whCache.get(warehouseId)
  if (hit && Date.now() - hit.at < 30_000) return hit.map
  // Select viết THẲNG chuỗi (không ghép runtime) — parser kiểu của supabase-js không đọc được
  // chuỗi động nên ghép sẽ thành ParserError, phải `as any` mới qua (luật: không `as any`).
  const { data } = await supabase.from('warehouse_type_configs')
    .select('type_code, is_ncc_goods, requires_ncc, batch_char').eq('warehouse_id', warehouseId).limit(200)
  const map = new Map<string, WhTypeMeta>()
  for (const [code, meta] of base.entries()) map.set(code, { ...meta })
  for (const row of (data ?? []) as ({ type_code: string } & WhOverride)[]) {
    const cur = { ...(map.get(row.type_code) ?? {}) }
    if (typeof row.is_ncc_goods === 'boolean') cur.is_ncc_goods = row.is_ncc_goods
    if (typeof row.requires_ncc === 'boolean') cur.requires_ncc = row.requires_ncc
    if (typeof row.batch_char === 'string' && row.batch_char) cur.batch_char = row.batch_char
    map.set(row.type_code, cur)
  }
  _whCache.set(warehouseId, { map, at: Date.now() })
  return map
}

/** Loại kho là hàng NCC? (đoạn 4 QR V1 = mã NCC). Loại chưa khai cờ → fallback danh sách cũ. */
export async function isNccGoodsCategory(category: string | null | undefined, warehouseId?: string | null): Promise<boolean> {
  if (!category) return false
  const meta = (await getWhTypeMetaMapFor(warehouseId)).get(category)
  if (meta && typeof meta.is_ncc_goods === 'boolean') return meta.is_ncc_goods
  return LEGACY_NCC_CATEGORIES.includes(category)
}

/** Loại kho bắt buộc có NCC khi nhập? Cờ mới (10/07) — không có fallback legacy, mặc định KHÔNG bắt buộc. */
export async function categoryRequiresNcc(category: string | null | undefined, warehouseId?: string | null): Promise<boolean> {
  if (!category) return false
  return (await getWhTypeMetaMapFor(warehouseId)).get(category)?.requires_ncc === true
}
