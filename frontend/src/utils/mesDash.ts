// CHIA KỲ cho dashboard Báo cáo NVL theo thời gian (22/11). Hàm thuần — test: backend/tests/unit/mesDash.test.ts.
//   • grainOf: cách gom theo độ dài kỳ ⇒ mỗi biểu đồ vài chục điểm dù xem 3 năm (1 ngày = từng mẻ · ≤ 92 ngày = ngày · ≤ 400 = tuần · còn lại = tháng).
//   • allBucketKeys / withAllBuckets: DB (mes_dashboard) chỉ trả kỳ CÓ mẻ ⇒ trục thời gian phải tự đủ MỌI kỳ trong khoảng, kỳ trống để trống
//     (lỗi bắt 22/11: kỳ 7 ngày mà chỉ 2 ngày có mẻ thì biểu đồ chỉ còn 2 cột, 3 năm còn 1 cột). Khoá tuần = thứ Hai (như date_trunc('week')),
//     khoá tháng = ngày 1.
//   • bucketRange: khoảng ngày của một kỳ, cắt theo kỳ đang xem — bấm một kỳ để đi sâu / mở dữ liệu.
export type Grain = 'batch' | 'day' | 'week' | 'month'

export const addDays = (d: string, n: number): string => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
/** số ngày của khoảng [a, b] tính cả hai đầu */
export const daysOf = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1

export const grainOf = (days: number): Grain => (days <= 1 ? 'batch' : days <= 92 ? 'day' : days <= 400 ? 'week' : 'month')

/** mọi khoá kỳ của khoảng [from, to] theo cách gom */
export function allBucketKeys(g: Grain, from: string, to: string): string[] {
  if (g === 'batch' || !(from <= to)) return []
  const out: string[] = []
  let k = from
  if (g === 'week') { const dow = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7; k = addDays(from, -dow) }
  if (g === 'month') k = `${from.slice(0, 7)}-01`
  for (let guard = 0; k <= to && guard < 2000; guard++) {
    out.push(k)
    if (g === 'day') k = addDays(k, 1)
    else if (g === 'week') k = addDays(k, 7)
    else { const t = new Date(`${k}T00:00:00Z`); t.setUTCMonth(t.getUTCMonth() + 1); k = t.toISOString().slice(0, 10) }
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
  if (g === 'month') { const t = new Date(`${k}T00:00:00Z`); t.setUTCMonth(t.getUTCMonth() + 1); t.setUTCDate(0); b = t.toISOString().slice(0, 10) }
  if (a < from) a = from
  if (b > to) b = to
  return { from: a, to: b }
}
