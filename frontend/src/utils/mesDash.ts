// CHIA KỲ cho dashboard Báo cáo NVL theo thời gian (22–23/11). Hàm thuần — test: backend/tests/unit/mesDash.test.ts.
// 23/11 — user: "3 năm thì chọn năm hiện tại, năm trước đó và năm sau đó · 1 năm thì chọn các tháng của năm hiện tại · dữ liệu gom luôn ·
// phải có mục chọn theo mốc thời gian". User chốt: 3 tháng = tháng trước · tháng chọn · tháng sau (gom theo tháng); 7 ngày = tuần lịch
// Thứ Hai → Chủ nhật. ⇒ KỲ THEO LỊCH quanh một MỐC (ngày được chọn), không còn "N ngày gần nhất":
//   1 ngày  = ngày mốc, từng mẻ          · 7 ngày = tuần T2→CN chứa mốc, theo ngày · 1 tháng = tháng của mốc, theo ngày
//   3 tháng = tháng trước · tháng mốc · tháng sau, theo tháng · 1 năm = 12 tháng của năm mốc · 3 năm = năm trước · năm mốc · năm sau, theo năm
//   Tự chọn = Từ / Đến tự gõ, cách gom theo độ dài (grainOf).
// Kỳ so (▲▼) = kỳ liền trước CÙNG kiểu: hôm qua · tuần trước · tháng trước · 3 tháng trước đó · năm trước · 3 năm trước đó.
// Bấm một kỳ trên biểu đồ ⇒ đi sâu đúng một bậc: năm → 1 năm · tháng → 1 tháng · tuần → 7 ngày · ngày → 1 ngày (drillOf).
//   • allBucketKeys / withAllBuckets: DB chỉ trả kỳ CÓ mẻ ⇒ trục tự đủ MỌI kỳ (lỗi 22/11: 7 ngày còn 2 cột). Khoá tuần = thứ Hai (như
//     date_trunc('week')), tháng = ngày 1, năm = 01/01.
export type Grain = 'batch' | 'day' | 'week' | 'month' | 'year'
export type PeriodKind = '1d' | '1w' | '1m' | '3m' | '1y' | '3y'
export const PERIOD_KINDS: readonly PeriodKind[] = ['1d', '1w', '1m', '3m', '1y', '3y']

export const addDays = (d: string, n: number): string => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
/** cộng tháng, giữ ngày 1 (mốc tháng / năm luôn quy về ngày 1) */
export const addMonths = (d: string, n: number): string => { const t = new Date(`${d.slice(0, 7)}-01T00:00:00Z`); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 10) }
const monthEnd = (d: string) => addDays(addMonths(d, 1), -1)
const weekStart = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7))
const yearStart = (d: string) => `${d.slice(0, 4)}-01-01`
const yearEnd = (d: string) => `${d.slice(0, 4)}-12-31`
/** cộng năm; 29/02 sang năm không nhuận ⇒ 01/03 (không sinh ngày không có thật) */
const addYears = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCFullYear(t.getUTCFullYear() + n); return t.toISOString().slice(0, 10) }
/** số ngày của khoảng [a, b] tính cả hai đầu */
export const daysOf = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1

/** cách gom cho khoảng TỰ CHỌN theo độ dài (mỗi biểu đồ vài chục điểm) */
export const grainOf = (days: number): Grain => (days <= 1 ? 'batch' : days <= 92 ? 'day' : days <= 400 ? 'week' : 'month')

export interface Period { from: string; to: string; grain: Grain; prevFrom: string; prevTo: string }
/** kỳ theo lịch quanh mốc + kỳ so liền trước cùng kiểu */
export function periodOf(kind: PeriodKind, anchor: string): Period {
  switch (kind) {
    case '1d': return { from: anchor, to: anchor, grain: 'batch', prevFrom: addDays(anchor, -1), prevTo: addDays(anchor, -1) }
    case '1w': { const s = weekStart(anchor); return { from: s, to: addDays(s, 6), grain: 'day', prevFrom: addDays(s, -7), prevTo: addDays(s, -1) } }
    case '1m': { const s = addMonths(anchor, 0); return { from: s, to: monthEnd(s), grain: 'day', prevFrom: addMonths(s, -1), prevTo: addDays(s, -1) } }
    case '3m': { const s = addMonths(anchor, -1); return { from: s, to: monthEnd(addMonths(anchor, 1)), grain: 'month', prevFrom: addMonths(s, -3), prevTo: addDays(s, -1) } }
    case '1y': return { from: yearStart(anchor), to: yearEnd(anchor), grain: 'month', prevFrom: yearStart(addYears(anchor, -1)), prevTo: yearEnd(addYears(anchor, -1)) }
    case '3y': { const s = yearStart(addYears(anchor, -1)); return { from: s, to: yearEnd(addYears(anchor, 1)), grain: 'year', prevFrom: yearStart(addYears(anchor, -4)), prevTo: addDays(s, -1) } }
  }
}
/** lùi / tiến mốc đúng một bước của kiểu kỳ (‹ ›) */
export function stepAnchor(kind: PeriodKind, anchor: string, dir: 1 | -1): string {
  switch (kind) {
    case '1d': return addDays(anchor, dir)
    case '1w': return addDays(anchor, 7 * dir)
    case '1m': case '3m': return addMonths(anchor, dir)
    case '1y': case '3y': return addYears(anchor, dir)
  }
}
/** bấm một kỳ trên biểu đồ ⇒ đi sâu đúng một bậc (null = hết bậc) */
export function drillOf(g: Grain, k: string): { kind: PeriodKind; anchor: string } | null {
  return g === 'year' ? { kind: '1y', anchor: k } : g === 'month' ? { kind: '1m', anchor: k } : g === 'week' ? { kind: '1w', anchor: k } : g === 'day' ? { kind: '1d', anchor: k } : null
}
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const mY = (d: string) => `${Number(d.slice(5, 7))}/${d.slice(0, 4)}`
/** tên kỳ cho đầu trang / nút quay lại */
export function periodLabel(kind: PeriodKind, anchor: string): string {
  const p = periodOf(kind, anchor)
  switch (kind) {
    case '1d': return dmy(anchor)
    case '1w': return `Tuần ${p.from.slice(8, 10)}/${p.from.slice(5, 7)} → ${dmy(p.to)}`
    case '1m': return `Tháng ${mY(anchor)}`
    case '3m': return `Tháng ${mY(p.from)} → ${mY(p.to)}`
    case '1y': return `Năm ${anchor.slice(0, 4)}`
    case '3y': return `Năm ${p.from.slice(0, 4)} → ${p.to.slice(0, 4)}`
  }
}

/** mọi khoá kỳ của khoảng [from, to] theo cách gom */
export function allBucketKeys(g: Grain, from: string, to: string): string[] {
  if (g === 'batch' || !(from <= to)) return []
  const out: string[] = []
  let k = g === 'week' ? weekStart(from) : g === 'month' ? addMonths(from, 0) : g === 'year' ? yearStart(from) : from
  for (let guard = 0; k <= to && guard < 2000; guard++) {
    out.push(k)
    k = g === 'day' ? addDays(k, 1) : g === 'week' ? addDays(k, 7) : g === 'month' ? addMonths(k, 1) : addYears(k, 1)
  }
  return out
}

/** đắp kỳ trống vào danh sách kỳ của DB (giữ thứ tự thời gian) */
export function withAllBuckets<B extends { k: string }>(g: Grain, from: string, to: string, have: B[], empty: (k: string) => B): B[] {
  if (g === 'batch') return have
  const m = new Map(have.map(b => [b.k, b]))
  return allBucketKeys(g, from, to).map(k => m.get(k) ?? empty(k))
}

/** khoảng ngày của một kỳ, cắt theo khoảng đang xem */
export function bucketRange(g: Grain, k: string, from: string, to: string): { from: string; to: string } {
  let a = k, b = k
  if (g === 'week') b = addDays(k, 6)
  if (g === 'month') b = monthEnd(k)
  if (g === 'year') b = yearEnd(k)
  if (a < from) a = from
  if (b > to) b = to
  return { from: a, to: b }
}
