// GIỮ HÀNG KHO ĐÃ LÀM khi kế hoạch của chuyến đổi (23/10, user chốt: "đơn cũ 100 thùng, đơn sửa còn 80, mà đã quét 90 thì không được; quét 20
// thì vẫn được — không thể nhả 20 thùng đó để đơn về trắng trơn, mất công quét lại").
// Kế hoạch MỚI của một chuyến kho đã đụng tới (đã quét / đang giữ nhặt lẻ) chỉ áp được khi mọi phần đã làm vẫn còn chỗ: khớp theo NPP + mã hàng
// (chuẩn nghiệp vụ 04/07 — DO chỉ là tham khảo, nên DO cũ bị SAP thay bằng DO mới cùng khách cùng mã vẫn giữ được hàng đã quét), số mới ≥ số
// đã làm. MỘT hàm cho cả hai cửa: Lưu của bàn ghép xe (kiểm TRƯỚC khi ghi, chặn cả lượt) và cửa gộp chuyến Tạm dừng bên Xuất (`mergePausedGDO`).

/** Dòng hàng đang có trên chuyến: `done` = đã quét (cartons_scanned) + đang giữ nhặt lẻ chưa xác nhận — số BASE */
export type KeepItem = { npp: string; material: string; done: number }
/** Dòng của kế hoạch mới — số BASE */
export type NewLine = { npp: string; material: string; qty: number }
export type KeepIssue = { npp: string; material: string; done: number; qty: number }

const keyOf = (npp: string, material: string) => `${npp.trim()}::${material.trim()}`

/** Các (NPP, mã) mà phần kho đã làm KHÔNG còn chỗ trong kế hoạch mới — `qty` = 0 nghĩa là kế hoạch mới bỏ hẳn dòng đó. Rỗng = áp được. */
export function mergeKeepIssues(existing: KeepItem[], incoming: NewLine[]): KeepIssue[] {
  const want = new Map<string, number>()
  for (const l of incoming) want.set(keyOf(l.npp, l.material), (want.get(keyOf(l.npp, l.material)) ?? 0) + Number(l.qty || 0))
  const done = new Map<string, KeepItem>()
  for (const e of existing) {
    if (!(Number(e.done) > 0)) continue
    const k = keyOf(e.npp, e.material)
    const cur = done.get(k)
    done.set(k, { npp: e.npp.trim(), material: e.material.trim(), done: (cur?.done ?? 0) + Number(e.done) })
  }
  const out: KeepIssue[] = []
  for (const [k, e] of done) {
    const qty = want.get(k) ?? 0
    if (qty < e.done) out.push({ npp: e.npp, material: e.material, done: e.done, qty })
  }
  return out
}
