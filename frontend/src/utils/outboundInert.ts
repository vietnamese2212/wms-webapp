// CHUYẾN BẤT ĐỘNG — bản MIRROR của inertError() bên backend (outboundController).
// Sửa luật thì sửa CẢ HAI: backend là điểm chặn thật (422 TRIP_INERT), đây chỉ để giao diện
// làm mờ + khóa nút + giải thích lý do trước khi user bấm.
type TripInertFields = {
  awaiting_sap?: boolean | null
  awaiting_dos?: string[] | null
  plan_dropped?: boolean | null
}

// Trả lý do (chuỗi hiển thị) nếu chuyến đang bất động; null = chuyến bình thường.
export function tripInert(gdo: TripInertFields | null | undefined): string | null {
  if (!gdo) return null
  if (gdo.plan_dropped)
    return 'Chuyến đã NGỪNG HOẠT ĐỘNG vì Kế hoạch xuất không còn Số xe này — chỉ xem được thông tin và lịch sử. Thêm lại dòng kế hoạch để chạy tiếp.'
  if (gdo.awaiting_sap) {
    const dos = (gdo.awaiting_dos ?? []).filter(Boolean)
    return `Chuyến đang CHỜ DỮ LIỆU SAP${dos.length ? ` (DO: ${dos.join(', ')})` : ''} — chưa có dòng hàng nên chưa xuất được. Up VL06O có các DO này là chuyến tự hoạt động trở lại.`
  }
  return null
}

// Nhãn ngắn cho badge/tooltip trên bảng
export function tripInertBadge(gdo: TripInertFields | null | undefined): string | null {
  if (gdo?.plan_dropped) return 'Kế hoạch đã bỏ'
  if (gdo?.awaiting_sap) return 'Chờ dữ liệu SAP'
  return null
}
