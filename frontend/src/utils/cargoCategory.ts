// Loại kho hàng nhập từ NCC: mã pallet đoạn 4 = NCC (thay vì Máy), NMSX = nơi nhận đầu tiên.
// Thành phẩm (và khác) = format Máy: ddmmyy_Mã_Chukỳ_Máy_Seq_NMSX.
export const NCC_CATEGORIES = ['POSM', 'Raw', 'Thùng', 'Giấy'] as const

export function isNccCategory(category?: string | null): boolean {
  return !!category && (NCC_CATEGORIES as readonly string[]).includes(category)
}
