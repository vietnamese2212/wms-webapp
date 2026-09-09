// Chu kỳ cho tab KPI: ngày / tuần ISO (thứ Hai) / tháng / năm — MỘT nguồn cho ô chọn Từ–Đến, nhãn kỳ và
// việc tách một khoảng dài thành các đoạn ≤ N kỳ (BE chỉ nhận ≤ 60 kỳ/1 request để không chạm timeout
// 60s của Vercel; khoảng 2 năm theo tuần = 105 kỳ ⇒ trình duyệt gọi 4 đoạn rồi ghép).
// Ranh giới đoạn phải trùng ranh giới kỳ (thứ Hai / mùng 1 / 1/1) để BE cắt kỳ y hệt như gọi một lần.
import type { KpiGrain } from '@/api/hooks'

export const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
export const pad2 = (n: number) => String(n).padStart(2, '0')
export function addDays(ymd: string, n: number): string { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export function monthStart(back: number): string {
  const [y, m] = TODAY().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10)
}
export function monthEnd(ymd: string): string { const [y, m] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }
export const yearStart = (back = 0) => `${Number(TODAY().slice(0, 4)) - back}-01-01`
export function isoWeekOf(ymd: string): { y: number; w: number } {
  const d = new Date(`${ymd}T00:00:00Z`); const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return { y: d.getUTCFullYear(), w: Math.ceil(((d.getTime() - y0.getTime()) / 86400000 + 1) / 7) }
}
export function isoWeekMonday(y: number, w: number): string {
  const jan4 = new Date(Date.UTC(y, 0, 4)); const day = jan4.getUTCDay() || 7
  const mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - (day - 1) + (w - 1) * 7)
  return mon.toISOString().slice(0, 10)
}
export const toWeekInput = (ymd: string) => { const { y, w } = isoWeekOf(ymd); return `${y}-W${pad2(w)}` }
/** Thứ Hai của tuần chứa ngày */
export function weekStartOf(ymd: string): string { const { y, w } = isoWeekOf(ymd); return isoWeekMonday(y, w) }

export const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1

/** Ngày đầu từng kỳ chứa khoảng [from, to] — đúng cách BE cắt (date_trunc từ p_from) */
export function bucketStarts(grain: KpiGrain, from: string, to: string): string[] {
  const out: string[] = []
  let cur = grain === 'day' ? from : grain === 'week' ? weekStartOf(from) : grain === 'month' ? `${from.slice(0, 7)}-01` : `${from.slice(0, 4)}-01-01`
  let guard = 0
  while (cur <= to && guard++ < 2000) {
    out.push(cur)
    cur = grain === 'day' ? addDays(cur, 1) : grain === 'week' ? addDays(cur, 7)
      : grain === 'month' ? addDays(monthEnd(cur), 1) : `${Number(cur.slice(0, 4)) + 1}-01-01`
  }
  return out
}
export function bucketEnd(grain: KpiGrain, start: string): string {
  return grain === 'day' ? start : grain === 'week' ? addDays(start, 6) : grain === 'month' ? monthEnd(start) : `${start.slice(0, 4)}-12-31`
}
/** Tách khoảng thành các đoạn ≤ maxBuckets kỳ, ranh giới trùng ranh giới kỳ */
export function chunkRanges(grain: KpiGrain, from: string, to: string, maxBuckets = 30): Array<{ from: string; to: string }> {
  const starts = bucketStarts(grain, from, to)
  const out: Array<{ from: string; to: string }> = []
  for (let i = 0; i < starts.length; i += maxBuckets) {
    const seg = starts.slice(i, i + maxBuckets)
    out.push({ from: seg[0], to: bucketEnd(grain, seg[seg.length - 1]) })
  }
  return out.length ? out : [{ from, to }]
}

/** Khoảng mặc định khi đổi chu kỳ: 30 ngày · 12 tuần · 12 tháng · 2 năm */
export function defaultRange(g: KpiGrain): { from: string; to: string } {
  const t = TODAY()
  if (g === 'day') return { from: addDays(t, -29), to: t }
  if (g === 'week') return { from: addDays(weekStartOf(t), -7 * 11), to: t }
  if (g === 'month') return { from: monthStart(11), to: t }
  return { from: yearStart(1), to: t }
}
/** Trần theo chu kỳ (user 09/09: xem tối đa TRÒN 2 NĂM 1/1 → 31/12 năm sau; theo NGÀY thì 3 tháng là đủ đọc) */
export const MAX_BUCKETS: Record<KpiGrain, number> = { day: 92, week: 106, month: 24, year: 3 }
export const GRAIN_LABEL: Record<KpiGrain, string> = { day: 'ngày', week: 'tuần', month: 'tháng', year: 'năm' }
