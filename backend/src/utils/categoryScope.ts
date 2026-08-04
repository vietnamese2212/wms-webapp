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

/**
 * Loại kho GHÉP trên MỘT bản ghi: 1 chuyến chở lẫn nhiều loại lưu 'FG01+PM01'
 * (upload KH xuất gom các "Loại kho" của các dòng bằng `join('+')`).
 * TÁCH Ở ĐÂY — đừng tự `split('+')` rải rác. Bản mirror phía SQL: hàm `wt_cats()`
 * (migration 20260730b_gdo_multi_category_scope) — sửa quy tắc tách phải sửa CẢ HAI.
 */
export function splitCategories(raw: string | null | undefined): string[] {
  return String(raw ?? '').split('+').map(s => s.trim()).filter(Boolean)
}

/**
 * Loại kho của bản ghi có nằm trong scope user không (không khai loại → không chặn).
 *
 * Bản ghi chở LẪN nhiều loại: **GIAO ≥1 loại là được** (user chốt 30/07 — "xe ghép chung
 * thì phải được thấy"). Trước 30/07 so khớp NGUYÊN CHUỖI nên chuyến 'FG01+PM01' biến mất
 * với MỌI user có scope loại, kể cả người có đủ cả hai — 67/122 chuyến bị ẩn oan.
 * Chuyến là 1 xe VẬT LÝ không tách được, nên thao tác (bắt đầu/quét/hoàn thành) cũng theo
 * luật giao ≥1: thấy mà không thao tác được thì xe kẹt tại bãi.
 */
export function categoryAllowed(req: Request, warehouseType: string | null | undefined): boolean {
  const scope = scopeCategoriesOf(req)
  if (scope === null) return true
  const cats = splitCategories(warehouseType)
  if (cats.length === 0) return true
  return cats.some(c => scope.includes(c))
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

/**
 * Cột TEXT chứa loại kho GHÉP ('FG01+PM01') — điều kiện .or() PostgREST cắt LIST theo luật
 * GIAO ≥1 (null-inclusive). Dùng cho bảng KHÔNG đi qua RPC (`TmsOrder`); bảng đi qua RPC thì
 * dùng `wt_cats(col) && p_categories` trong SQL.
 *
 * VÌ SAO PHẢI CÓ: `col.in.(FG01,PM01)` so khớp NGUYÊN CHUỖI nên bản ghi 'FG01+PM01' KHÔNG khớp
 * giá trị đơn nào ⇒ biến mất với MỌI user có scope loại, kể cả người có đủ cả hai. Đúng lớp lỗi
 * đã vá cho GroupDeliveryOrder ngày 30/07, tái sinh ở TmsOrder khi lệnh VC tự sinh (03/08) sao
 * chép chuỗi ghép từ chuyến. Đo staging 04/08: user scope FG01 thấy 50/117 lệnh, PM01 thấy 1/68.
 *
 * Khớp theo ĐOẠN có neo dấu '+' (không dùng '*CAT*') để mã này không ăn nhầm mã khác chứa nó.
 */
export function categoryTextOrScopeFilter(col: string, scope: string[]): string {
  const terms = [`${col}.is.null`]
  for (const raw of scope) {
    const c = String(raw).replace(/["(),]/g, '')     // giá trị danh mục không có ký tự này; chặn vỡ cú pháp or()
    terms.push(`${col}.eq."${c}"`, `${col}.like."${c}+*"`, `${col}.like."*+${c}"`, `${col}.like."*+${c}+*"`)
  }
  return terms.join(',')
}

export const CATEGORY_FORBIDDEN_MSG = 'Ngoài phạm vi Loại hàng được phép — không thể thao tác loại kho này'
