// "PALLET CÓ ĐANG BỊ QA GIỮ KHÔNG" — bản FE của luật một nguồn (BE: services/qaStatus.ts · SQL: qa_is_hold()).
//
// Danh mục QAStatus: X · XCQ · X7 = GIỮ, còn **OK = ĐÃ DUYỆT**, xuất được bình thường. Trước 14/09
// năm màn tra tồn (Chuẩn bị hàng · trang chuyến · dòng hàng · Nhặt lẻ · dialog Tra tồn kho) viết
// `!!e.qa_status` ⇒ pallet đã duyệt OK cũng hiện nhãn tím "QA giữ", đúng khuôn lỗi C13 "một cột hai
// nghĩa" vừa vá ở BE ngày 13/09. Ratchet `qa_hold_rule_hand_rolled` nay bắt cả dạng FE này.
export function isQaHeld(qa: { code?: string | null } | null | undefined): boolean {
  return !!qa && (qa.code ?? '') !== 'OK'
}
