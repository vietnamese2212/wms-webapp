// TRẠNG THÁI MỘT DÒNG TRÊN PHIẾU CỦA MẺ theo MỨC LỆCH CHO PHÉP (MES 17/11 — user chốt "cấp vượt mức lệch: chỉ tô đỏ", vẫn cho cấp).
// Một hàm cho mọi chỗ vẽ phiếu (bảng máy tính · danh sách điện thoại · ô tổng "NVL đã đủ") — đừng tự so required / consumed ở chỗ khác.
//   • có mức lệch t%: đủ khi cấp trong [yêu cầu × (1 − t), yêu cầu × (1 + t)]; vượt cận trên ⇒ "over" (đỏ); mẻ đã đóng mà dưới cận dưới ⇒ "under" (đỏ).
//   • không khai mức lệch: như trước — đủ khi cấp ≥ yêu cầu, vượt yêu cầu ⇒ "over" (đỏ "Vượt yêu cầu").
export type ReqLineState = 'removed' | 'extra' | 'none' | 'progress' | 'ok' | 'over' | 'under'
export interface ReqLineInput { required: number | null; consumed: number; tol_pct?: number | null; removed?: boolean }
export interface ReqLineResult {
  state: ReqLineState
  /** phần còn phải cấp để ĐỦ (0 khi đã trong mức lệch) */
  need: number
  /** lệch so với yêu cầu, % (1 số lẻ) — null khi chưa cấp / không có yêu cầu */
  devPct: number | null
  /** tô đỏ */
  outOfTol: boolean
}

const EPS = 0.0005
const r3 = (n: number) => Math.round(n * 1000) / 1000

export function reqLineState(r: ReqLineInput, closed = false): ReqLineResult {
  const consumed = Number(r.consumed) || 0
  if (r.removed) return { state: 'removed', need: 0, devPct: null, outOfTol: false }
  if (r.required == null) return { state: 'extra', need: 0, devPct: null, outOfTol: false }
  const req = Number(r.required)
  const devPct = req > 0 && consumed > 0 ? Math.round(((consumed - req) / req) * 1000) / 10 : null
  const exactNeed = Math.max(r3(req - consumed), 0)
  const tol = r.tol_pct == null ? null : Number(r.tol_pct)
  const lo = tol == null ? req : req * (1 - tol / 100)
  const hi = tol == null ? req : req * (1 + tol / 100)
  if (consumed > hi + EPS) return { state: 'over', need: 0, devPct, outOfTol: true }
  if (consumed > 0 && consumed >= lo - EPS) return { state: 'ok', need: 0, devPct, outOfTol: false }
  if (closed) return { state: 'under', need: exactNeed, devPct, outOfTol: true }
  return { state: consumed > 0 ? 'progress' : 'none', need: exactNeed, devPct, outOfTol: false }
}

/** "+2,6%" / "−1%" — dấu trừ thật để đọc rõ trên màn nhỏ */
export const devLabel = (p: number | null): string =>
  p == null ? '' : `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
