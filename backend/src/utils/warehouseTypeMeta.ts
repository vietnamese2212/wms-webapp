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
  batch_char?: string             // ký tự cố định thế chỗ Máy trong mã lô khi sinh tem V2
  badge_color?: string
}

// Phòng hộ khi meta chưa seed (migration chưa apply) — đúng hardcode cũ
const LEGACY_NCC_CATEGORIES = ['POSM', 'Raw', 'Thùng', 'Giấy']

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

export function invalidateWhTypeMetaCache() { _cache = null }

/** Loại kho là hàng NCC? (đoạn 4 QR V1 = mã NCC). Loại chưa khai cờ → fallback danh sách cũ. */
export async function isNccGoodsCategory(category: string | null | undefined): Promise<boolean> {
  if (!category) return false
  const meta = (await getWhTypeMetaMap()).get(category)
  if (meta && typeof meta.is_ncc_goods === 'boolean') return meta.is_ncc_goods
  return LEGACY_NCC_CATEGORIES.includes(category)
}
