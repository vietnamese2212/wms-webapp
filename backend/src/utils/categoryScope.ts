import type { Request } from 'express'

/**
 * Scope Loại hàng/Loại kho (allowed_categories) của user — dùng cho guard write + cắt list.
 * null = không giới hạn (NATIONAL / superadmin / chưa cấu hình).
 * Chuẩn hoá giá trị cũ còn trong JWT (migration 20260702_normalize_allowed_categories dọn DB).
 */
export function scopeCategoriesOf(req: Request): string[] | null {
  if (req.user?.name === 'Admin' || req.user?.warehouse_scope === 'NATIONAL') return null
  const raw = req.user?.allowed_categories ?? []
  if (raw.length === 0) return null
  const out = new Set<string>()
  for (const c of raw) {
    if (c === 'TP') out.add('Thành phẩm')
    else if (c === 'NVL') { out.add('Raw'); out.add('Giấy'); out.add('Thùng') }
    else if (c === 'Bao bì' || c === 'BAO_BI') { out.add('Giấy'); out.add('Thùng') }
    else out.add(c)
  }
  return out.size > 0 ? [...out] : null
}

/** Loại kho của bản ghi có nằm trong scope user không (không khai loại → không chặn). */
export function categoryAllowed(req: Request, warehouseType: string | null | undefined): boolean {
  const scope = scopeCategoriesOf(req)
  if (scope === null || !warehouseType) return true
  return scope.includes(warehouseType)
}

/**
 * Bản ghi mang MẢNG loại (Khu vực / Vị trí multi-loại, 27/07) — guard WRITE:
 * MỌI loại của bản ghi phải trong scope (thao tác lên khu [RM01,PK01] ảnh hưởng cả 2 loại).
 * null/rỗng (di sản) → không chặn, khớp categoryAllowed.
 */
export function categoriesAllAllowed(req: Request, cats: string[] | null | undefined): boolean {
  const scope = scopeCategoriesOf(req)
  if (scope === null || !cats || cats.length === 0) return true
  return cats.every(c => scope.includes(c))
}

/** Điều kiện .or() PostgREST cắt LIST theo scope trên cột MẢNG (null-inclusive, giao ≥1 loại là thấy). */
export function categoriesOrScopeFilter(col: string, scope: string[]): string {
  return `${col}.is.null,${col}.ov.{${scope.map(c => `"${c}"`).join(',')}}`
}

export const CATEGORY_FORBIDDEN_MSG = 'Ngoài phạm vi Loại hàng được phép — không thể thao tác loại kho này'
