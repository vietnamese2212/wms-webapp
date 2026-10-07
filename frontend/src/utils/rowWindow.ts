// CỬA SỔ DÒNG của bảng dài (07/10, C65): chỉ vẽ dòng nằm trong khung nhìn ± dự phòng; phần trên / dưới thay bằng dòng đệm cao đúng
// bằng chỗ của chúng — vẫn MỘT danh sách cuộn thấy hết (không chia trang, user 05/10) mà mỗi lần tick / gõ chỉ vẽ lại vài chục dòng.
// Đo Xem đơn Bán hàng Ba Vì 3.529 đơn trước khi có cửa sổ: 207.673 phần tử trên trang, tick 1 đơn ~1,1 s, gõ 1 chữ ~1,2 s.
// Hàm thuần (không React) để test bất biến: cửa sổ luôn bị chặn trên dù danh sách dài bao nhiêu, và luôn phủ đủ khung nhìn.
export function rowWindow(p: { top: number; height: number; rowH: number; count: number; overscan?: number }) {
  const ov = Math.max(0, p.overscan ?? 15)
  const rowH = Math.max(1, p.rowH)
  const count = Math.max(0, p.count)
  const vis = Math.ceil(Math.max(0, p.height) / rowH) + 1
  // cuộn quá đáy (danh sách vừa co lại, trình duyệt chưa kịp kéo scrollTop về) ⇒ vẫn vẽ các dòng cuối, không để khung trắng
  const first = Math.min(Math.floor(Math.max(0, p.top) / rowH), Math.max(0, count - vis))
  const start = Math.max(0, first - ov)
  const end = Math.min(count, first + vis + ov)
  return { start, end, padTop: start * rowH, padBottom: (count - end) * rowH }
}
