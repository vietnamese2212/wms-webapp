// SỐ LƯỢNG TRONG CÔNG THỨC theo quyền (27/11 — user chốt "ẩn số lượng với người không phải QA / quản lý", bảo mật công thức).
// Cỡ mẻ chuẩn · số từng nguyên liệu · mức lệch chỉ trả cho người có quyền "Xem công thức" (production.view_recipe) hoặc "Khai định mức"
// (manage_recipe). Người khác vẫn nhận TÊN công thức + DANH SÁCH MÃ (form Mở / Lập mẻ, Sửa danh sách NVL cần).
// `list_only` (công thức chỉ danh sách mã — kho không định mức) tính TRƯỚC khi ẩn ⇒ màn hình không đoán từ base_qty null.
// Một hàm cho mọi cửa đọc công thức (danh sách · một công thức · công thức gắn trên mẻ). Test: tests/unit/recipeView.test.ts.
export function recipeView<T extends { base_qty: number | null }>(row: T, canSeeQty: boolean): T & { list_only: boolean; qty_hidden: boolean } {
  const list_only = row.base_qty == null
  return canSeeQty ? { ...row, list_only, qty_hidden: false } : { ...row, base_qty: null, list_only, qty_hidden: true }
}
/** SỐ ĐỊNH MỨC / LỆCH trong Báo cáo NVL (27/11 — user chốt "ẩn luôn cột định mức trong Báo cáo NVL" với người không có quyền Xem
 *  công thức): định mức gốc · phiếu · mức lệch · lệch (KG / %) · sửa phiếu · cấp lệch · lý do sửa phiếu đều suy ngược ra công thức (lệch =
 *  thực cấp − định mức) ⇒ bỏ hết, GIỮ thực cấp + số đếm (mẻ · dòng lệch · đạt). Đi sâu mọi tầng (dashboard · chi tiết · báo cáo chu kỳ ·
 *  sheet định mức của dữ liệu thô); ô NVL × mẻ của báo cáo chu kỳ mang `hid` để màn hình không coi là "ngoài định mức". */
export const NORM_FIGURE_KEYS: ReadonlySet<string> = new Set([
  'std', 'req', 'tol', 'tol_pct', 'sheet', 'diff', 'edit', 'exec', 'pct', 'why', 'change_reason',
  'std_kg', 'sheet_kg', 'total_kg', 'edit_kg', 'exec_kg',
])
export function hideNormFigures<T>(v: T): T {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk)
    if (!x || typeof x !== 'object') return x
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
      if (k === 'cells' && val && typeof val === 'object' && !Array.isArray(val)) {
        o[k] = Object.fromEntries(Object.entries(val as Record<string, unknown>).map(([bk, c]) => [bk, { ...(walk(c) as object), hid: true }]))
      } else o[k] = NORM_FIGURE_KEYS.has(k) ? null : walk(val)
    }
    return o
  }
  const out = walk(v)
  return (out && typeof out === 'object' && !Array.isArray(out) ? { ...(out as object), norm_hidden: true } : out) as T
}
export function recipeLinesView<L extends { qty: number | null; tol_pct: number | null }>(lines: L[], canSeeQty: boolean): L[] {
  return canSeeQty ? lines : lines.map(l => ({ ...l, qty: null, tol_pct: null }))
}
