// Cờ hành vi per-Loại kho (LookupValue.meta — migration 20260710_warehouse_type_options).
// Loại kho tùy biến: hành vi đi theo CỜ của từng loại, không hardcode tên.
// Lấy map qua hook useWhTypeMetaMap() (hooks/useWhTypeMeta) rồi truyền vào các helper dưới.
export interface WhTypeMeta {
  is_ncc_goods?: boolean           // QR V1 đoạn 4 = mã NCC (thay vì Máy); NMSX = nơi nhận đầu tiên
  requires_shelf_life?: boolean    // Mã hàng bắt buộc HSD
  requires_pallet_per_ea?: boolean // Mã hàng bắt buộc Pallet/EA (quy đổi tồn EA → pallet)
  requires_ncc?: boolean           // Nhập kho bắt buộc có NCC (quét/nhập tay/upload — chuyển kho kế thừa, không chặn)
  requires_carton_scan?: boolean   // Xuất kho: sau khi quét pallet phải multiscan tem THÙNG đính kèm (truy vết)
  batch_char?: string              // ký tự cố định thế chỗ Máy trong mã lô khi sinh tem V2 (vd 'N')
  badge_color?: string             // blue | purple | orange | green | amber | red | emerald | cyan | slate
}
export type WhTypeMetaMap = Map<string, WhTypeMeta>

// Phòng hộ khi meta chưa seed (migration chưa apply / loại chưa cấu hình) — đúng hardcode cũ
export const NCC_CATEGORIES = ['POSM', 'Raw', 'Thùng', 'Giấy'] as const
const LEGACY_NO_SHELF_LIFE = ['Thùng', 'POSM']
const LEGACY_PALLET_PER_EA = ['Raw', 'Thùng', 'Giấy']

export function isNccCategory(category: string | null | undefined, metaMap?: WhTypeMetaMap): boolean {
  if (!category) return false
  const meta = metaMap?.get(category)
  if (meta && typeof meta.is_ncc_goods === 'boolean') return meta.is_ncc_goods
  return (NCC_CATEGORIES as readonly string[]).includes(category)
}

/** HSD (shelf_life_days) bắt buộc với loại này? */
export function needsShelfLife(category: string | null | undefined, metaMap?: WhTypeMetaMap): boolean {
  if (!category) return false
  const meta = metaMap?.get(category)
  if (meta && typeof meta.requires_shelf_life === 'boolean') return meta.requires_shelf_life
  return !LEGACY_NO_SHELF_LIFE.includes(category)
}

/** Pallet/EA bắt buộc với loại này? */
export function needsPalletPerEa(category: string | null | undefined, metaMap?: WhTypeMetaMap): boolean {
  if (!category) return false
  const meta = metaMap?.get(category)
  if (meta && typeof meta.requires_pallet_per_ea === 'boolean') return meta.requires_pallet_per_ea
  return LEGACY_PALLET_PER_EA.includes(category)
}

/** Nhập kho bắt buộc có NCC? Cờ mới 10/07 — không fallback legacy, mặc định KHÔNG bắt buộc. */
export function requiresNcc(category: string | null | undefined, metaMap?: WhTypeMetaMap): boolean {
  if (!category) return false
  return metaMap?.get(category)?.requires_ncc === true
}

/** Ký tự cố định thế chỗ Máy trong mã lô V2 (rỗng = chọn Máy tay như Thành phẩm). */
export function batchCharOf(category: string | null | undefined, metaMap?: WhTypeMetaMap): string {
  if (!category) return ''
  return (metaMap?.get(category)?.batch_char ?? '').trim().toUpperCase().slice(0, 1)
}

// Màu badge Loại kho — tên màu trong meta → class Tailwind (fallback = màu hardcode cũ → slate)
export const WH_BADGE_COLORS: Record<string, string> = {
  blue:    'bg-blue-100 text-blue-700',
  purple:  'bg-purple-100 text-purple-700',
  orange:  'bg-orange-100 text-orange-700',
  green:   'bg-green-100 text-green-700',
  amber:   'bg-amber-100 text-amber-700',
  red:     'bg-red-100 text-red-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  cyan:    'bg-cyan-100 text-cyan-700',
  slate:   'bg-slate-100 text-slate-600',
}
const LEGACY_BADGE: Record<string, string> = {
  'Thành phẩm': 'blue', 'POSM': 'purple', 'Raw': 'orange', 'NVL': 'green', 'Bao bì': 'amber',
}

export function whTypeBadgeCls(category: string | null | undefined, metaMap?: WhTypeMetaMap): string {
  if (!category) return WH_BADGE_COLORS.slate
  const color = metaMap?.get(category)?.badge_color || LEGACY_BADGE[category] || 'slate'
  return WH_BADGE_COLORS[color] ?? WH_BADGE_COLORS.slate
}
