// MÃ LÔ BÁN THÀNH PHẨM (mẻ chế biến, MES 14/11) — app GỢI Ý, người mở mẻ sửa được (user chốt 14/11).
// Khuôn giống mã lô tem V2 (`TA260705A018` = tiền tố hàng + yymmdd + máy + số thứ tự 3 chữ số):
//   tiền tố = Material.batch_prefix nếu có, không thì mã hàng · ngày = ngày SX (ngày VN) · máy = mã máy (bỏ ký tự lạ)
// Hàm thuần — test ở backend/tests/unit/batchCode.test.ts.

/** Chuẩn hoá mã lô người gõ: hoa, bỏ khoảng trắng; chỉ giữ chữ số, chữ cái và `_ . -`. */
export function normalizeBatchCode(raw: string): string {
  return String(raw ?? '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9_.-]/g, '')
}

/** Mã lô hợp lệ theo CHECK của bảng production_batch. */
export const BATCH_CODE_RE = /^[A-Z0-9][A-Z0-9_.-]{0,39}$/

/** Gốc mã lô (chưa có số thứ tự): tiền tố + yymmdd + máy. `prodDate` dạng YYYY-MM-DD. */
export function batchCodeStem(prefix: string, prodDate: string, machine: string | null | undefined): string {
  const p = normalizeBatchCode(prefix).replace(/[_.-]/g, '').slice(0, 12)
  const d = `${prodDate.slice(2, 4)}${prodDate.slice(5, 7)}${prodDate.slice(8, 10)}`
  const m = normalizeBatchCode(machine ?? '').replace(/[_.-]/g, '').slice(0, 6)
  return `${p}${d}${m}`
}

/** Mã kế tiếp = gốc + số thứ tự 3 chữ số, lớn hơn mọi mã đã có cùng gốc (mã lạ không cùng khuôn bị bỏ qua). */
export function nextBatchCode(stem: string, existing: (string | null | undefined)[]): string {
  let max = 0
  for (const c of existing) {
    if (!c || !c.startsWith(stem)) continue
    const tail = c.slice(stem.length)
    if (!/^\d{3,}$/.test(tail)) continue
    max = Math.max(max, parseInt(tail, 10))
  }
  return `${stem}${String(max + 1).padStart(3, '0')}`
}
