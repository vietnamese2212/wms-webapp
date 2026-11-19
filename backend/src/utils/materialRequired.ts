// Ô BẮT BUỘC của một MÃ HÀNG MỚI (19/11, C125 — user duyệt "làm theo đề xuất"): nạp Excel từng tạo được mã mới chỉ có Mã + Tên,
// trong khi form Thêm mã hàng bắt Loại hàng · Base Unit · Thùng/pallet · HSD · Pallet/EA (theo cờ Loại kho). Mã cụt đó vào kho là
// số pallet / HSD / %Date tính sai, và mã không Loại hàng thì mọi phạm vi đều thấy. Một luật — cùng thứ tự kiểm với form
// (frontend pages/masterdata/Materials.tsx `validate()`): phi hàng hoá chỉ cần Mã + Tên; bán thành phẩm theo semiFinishedFlagError;
// pallet mang hàng không cần HSD / Pallet-EA. CHỈ áp mã MỚI — mã đã có (kể cả đang thiếu thông tin) sửa từng ô bằng file vẫn được.
export interface MaterialRequiredInput {
  category?: string | null
  base_unit?: string | null
  cartons_per_pallet?: number | null
  shelf_life_days?: number | null
  pallet_per_ea?: number | null
  is_non_stock?: boolean | null
  is_semi_finished?: boolean | null
  is_pallet_carrier?: boolean | null
}
/** Luật HSD / Pallet-EA của Loại kho (getMaterialCategoryRules): sl = bắt HSD, pe = bắt Pallet/EA */
export type CategoryRule = { sl: boolean; pe: boolean }

/** Danh sách ô còn thiếu (rỗng = đủ), tên ô đúng như trên form / file mẫu */
export function materialMissingFields(m: MaterialRequiredInput, rule: CategoryRule | undefined): string[] {
  if (m.is_non_stock || m.is_semi_finished) return []
  const miss: string[] = []
  if (!m.category) miss.push('Loại hàng')
  if (!String(m.base_unit ?? '').trim()) miss.push('Base Unit')
  if (!(Number(m.cartons_per_pallet) > 0)) miss.push('Thùng/Pallet')
  if (!m.is_pallet_carrier && m.category && rule?.sl && m.shelf_life_days == null) miss.push('HSD (ngày)')
  if (!m.is_pallet_carrier && m.category && rule?.pe && m.pallet_per_ea == null) miss.push('Pallet/EA')
  return miss
}
