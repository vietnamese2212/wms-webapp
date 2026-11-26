// TIẾN ĐỘ NHẬP (% thực nhập / kế hoạch) — MỘT luật cho dòng phiếu ở danh sách, dòng mã của trang phiếu chung và dòng phiếu chung
// (user 26/11: "các format khi hàng đủ, thiếu, xong… tương tự như khi xem ở 1 phiếu bình thường"). Ô hiển thị: `InboundProgress`.
// Đủ = thực nhập ≥ kế hoạch, so SỐ THẬT — không so % đã làm tròn (1.999,6 / 2.000 KG làm tròn ra 100% mà vẫn thiếu 0,4 KG;
// trước 26/11 dòng đó hiện "100%" xanh trong khi cột Chênh báo Thiếu).

export type InboundProgressInfo = { pct: number; done: boolean }

const EPS = 1e-9

/** Một phiếu / một mã. Không có kế hoạch (null / 0) ⇒ null (ô hiện —). Chưa đủ thì % tối đa 99. */
export function inboundProgressOf(received: number, planned: number | null | undefined): InboundProgressInfo | null {
  if (planned == null || !(planned > 0)) return null
  const done = received >= planned - EPS
  const pct = Math.round((received / planned) * 100)
  return { pct: done ? pct : Math.min(99, pct), done }
}

/** Phiếu chung: trung bình tiến độ từng mã có kế hoạch (mỗi mã tối đa 100%) — các mã khác ĐVT nên không cộng số lượng.
 *  100% khi và chỉ khi mọi mã đủ; mã thừa không bù cho mã thiếu. */
export function receiptProgressOf(lines: { received: number; planned: number | null | undefined }[]): InboundProgressInfo | null {
  const ps = lines.map(l => inboundProgressOf(l.received, l.planned)).filter((p): p is InboundProgressInfo => p != null)
  if (!ps.length) return null
  const done = ps.every(p => p.done)
  const pct = Math.round(ps.reduce((a, p) => a + Math.min(100, p.pct), 0) / ps.length)
  return { pct: done ? 100 : Math.min(99, pct), done }
}
