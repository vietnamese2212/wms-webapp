// BÁN THÀNH PHẨM (BTP) — rà MES 16/11, lớp C117.
// BTP = dịch trộn từ nhiều NVL theo định mức, vào bồn, chờ chiết rót / đóng gói (vd "Dịch sữa chua uống dâu", "Dịch thạch").
// Trước đây Sản xuất coi MỌI mã tính L / KG là BTP ⇒ ô "Mã bán thành phẩm" chỉ toàn NVL (danh mục chưa có mã BTP nào).
// User chốt 16/11: BTP là mã RIÊNG, đánh dấu ở Mã hàng (`Material.is_semi_finished`); Sản xuất chỉ nhận mã đã đánh dấu.
//
// Hai câu hỏi khác nhau, hai hàm — mọi cửa dùng CHUNG, đừng tự viết lại:
//   • semiFinishedFlagError — mã hàng ĐƯỢC đánh dấu BTP không? (form / upload / API Mã hàng; DB còn CHECK
//     `material_semi_finished_chk` làm lưới cuối, hàm này báo câu dễ hiểu trước);
//   • btpUseError — một cửa MES nhận mã này LÀM BTP được không? (mở / sửa mẻ · định mức · hạn lưu bồn).

export const BTP_UNITS: readonly string[] = ['L', 'KG']

export type BtpLike = {
  material_code?: string | null
  base_unit?: string | null
  is_semi_finished?: boolean | null
  is_non_stock?: boolean | null
  is_pallet_carrier?: boolean | null
  is_active?: boolean | null
}

const unitOf = (m: BtpLike) => String(m.base_unit ?? '').trim().toUpperCase()

/** Mã hàng đang (sẽ) mang cờ BTP có hợp lệ không — truyền GIÁ TRỊ HIỆU LỰC sau khi sửa. null = hợp lệ. */
export function semiFinishedFlagError(m: BtpLike): string | null {
  if (!m.is_semi_finished) return null
  if (m.is_non_stock) return 'Mã phi hàng hoá không đánh dấu "Bán thành phẩm" được'
  if (m.is_pallet_carrier) return 'Mã pallet mang hàng không đánh dấu "Bán thành phẩm" được'
  if (!BTP_UNITS.includes(unitOf(m)))
    return `Bán thành phẩm vào bồn nên đơn vị gốc phải là L hoặc KG (đang "${m.base_unit || '—'}")`
  return null
}

/** Cửa MES nhận một mã làm BTP. null = dùng được. `code` để controller trả đúng mã lỗi. */
export function btpUseError(m: BtpLike): { code: 'NOT_SEMI_FINISHED' | 'BTP_UNIT' | 'MATERIAL_INACTIVE'; message: string } | null {
  const c = m.material_code ?? ''
  if (!m.is_semi_finished)
    return { code: 'NOT_SEMI_FINISHED', message: `Mã ${c} không phải mã bán thành phẩm — chỉ mã đã đánh dấu "Bán thành phẩm" ở Mã hàng mới mở mẻ, khai định mức, khai hạn lưu bồn được` }
  if (!BTP_UNITS.includes(unitOf(m)))
    return { code: 'BTP_UNIT', message: `Mã ${c} tính theo "${m.base_unit || '—'}" — bán thành phẩm vào bồn phải có đơn vị gốc L hoặc KG (sửa ở Mã hàng)` }
  if (m.is_active === false) return { code: 'MATERIAL_INACTIVE', message: `Mã ${c} đang ngừng dùng` }
  return null
}
