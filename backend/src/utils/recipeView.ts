// SỐ LƯỢNG TRONG CÔNG THỨC theo quyền (27/11 — user chốt "ẩn số lượng với người không phải QA / quản lý", bảo mật công thức).
// Cỡ mẻ chuẩn · số từng nguyên liệu · mức lệch chỉ trả cho người có quyền "Xem công thức" (production.view_recipe) hoặc "Khai định mức"
// (manage_recipe). Người khác vẫn nhận TÊN công thức + DANH SÁCH MÃ (form Mở / Lập mẻ, Sửa danh sách NVL cần).
// `list_only` (công thức chỉ danh sách mã — kho không định mức) tính TRƯỚC khi ẩn ⇒ màn hình không đoán từ base_qty null.
// Một hàm cho mọi cửa đọc công thức (danh sách · một công thức · công thức gắn trên mẻ). Test: tests/unit/recipeView.test.ts.
export function recipeView<T extends { base_qty: number | null }>(row: T, canSeeQty: boolean): T & { list_only: boolean; qty_hidden: boolean } {
  const list_only = row.base_qty == null
  return canSeeQty ? { ...row, list_only, qty_hidden: false } : { ...row, base_qty: null, list_only, qty_hidden: true }
}
export function recipeLinesView<L extends { qty: number | null; tol_pct: number | null }>(lines: L[], canSeeQty: boolean): L[] {
  return canSeeQty ? lines : lines.map(l => ({ ...l, qty: null, tol_pct: null }))
}
