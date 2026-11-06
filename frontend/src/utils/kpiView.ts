// Phép tính THUẦN của giao diện tab KPI (11/2026) — tách khỏi component để test đơn vị được
// (backend/tests/unit/kpiView.test.ts). KHÔNG định nghĩa KPI ở đây: định nghĩa vẫn ở backend/src/utils/kpiDefs.ts.

export type KpiDir = 'up' | 'down' | 'band'

/** Khoảng cách từ giá trị tới NGƯỠNG ĐẠT. null = chưa đo được hoặc chưa đặt mục tiêu; gap 0 = đang đạt.
 *  `rel` = gap ÷ ngưỡng, để so được hai KPI khác đơn vị khi xếp hạng "lệch nhiều nhất". */
export function kpiGap(dir: KpiDir, v: number | null | undefined, t: number[] | null | undefined):
  { gap: number; rel: number; side: 'short' | 'over' | null } | null {
  if (v == null || !Number.isFinite(v) || !t) return null
  const of = (gap: number, ref: number, side: 'short' | 'over') =>
    ({ gap, rel: gap / Math.max(Math.abs(ref), 1e-9), side })
  if (dir === 'up') return v >= t[0] ? { gap: 0, rel: 0, side: null } : of(t[0] - v, t[0], 'short')
  if (dir === 'down') return v <= t[0] ? { gap: 0, rel: 0, side: null } : of(v - t[0], t[0], 'over')
  if (v < t[0]) return of(t[0] - v, t[0], 'short')
  if (v > t[1]) return of(v - t[1], t[1], 'over')
  return { gap: 0, rel: 0, side: null }
}

/** So HAI KỲ gần nhất CÓ SỐ (kỳ giữa không có số thì bỏ qua). Chưa đủ hai kỳ có số = null. */
export function lastDelta<P extends { label: string; value: number | null }>(points: P[]):
  { curr: number; prev: number; delta: number; label: string; prevLabel: string } | null {
  const has = points.filter((p): p is P & { value: number } => p.value != null && Number.isFinite(p.value))
  if (has.length < 2) return null
  const a = has[has.length - 2], b = has[has.length - 1]
  return { curr: b.value, prev: a.value, delta: b.value - a.value, label: b.label, prevLabel: a.label }
}

/** Chia dãy thành các đoạn liền nhau — kỳ không có số là LỖ HỔNG, không được nối đường qua nó. */
export function runsOf<T>(items: T[], has: (t: T) => boolean): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  for (const it of items) {
    if (has(it)) cur.push(it)
    else if (cur.length) { out.push(cur); cur = [] }
  }
  if (cur.length) out.push(cur)
  return out
}

/** Đường cong ĐƠN ĐIỆU (Fritsch–Carlson): uốn mềm như biểu đồ mẫu nhưng KHÔNG vượt quá giá trị thật giữa
 *  hai điểm — đường cong thường (Catmull-Rom) sẽ vẽ ra đỉnh/đáy không có trong dữ liệu. x phải tăng dần. */
export function monotonePath(pts: Array<{ x: number; y: number }>): string {
  const n = pts.length
  if (n === 0) return ''
  const f = (v: number) => v.toFixed(1)
  if (n === 1) return `M${f(pts[0].x)},${f(pts[0].y)}`
  const dx: number[] = [], m: number[] = []
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1].x - pts[i].x; m[i] = (pts[i + 1].y - pts[i].y) / dx[i] }
  const tan: number[] = [m[0]]
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) tan[i] = 0     // đổi chiều ⇒ tiếp tuyến ngang, điểm đó là đỉnh/đáy thật
    else {
      const w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1]
      tan[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i])
    }
  }
  tan[n - 1] = m[n - 2]
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`
  for (let i = 0; i < n - 1; i++) {
    const c = dx[i] / 3
    d += ` C${f(pts[i].x + c)},${f(pts[i].y + tan[i] * c)} ${f(pts[i + 1].x - c)},${f(pts[i + 1].y - tan[i + 1] * c)} ${f(pts[i + 1].x)},${f(pts[i + 1].y)}`
  }
  return d
}

/** Bố trí TREEMAP kiểu "squarified": diện tích mỗi ô tỉ lệ đúng với value, ô càng gần vuông càng dễ so.
 *  Bỏ qua value ≤ 0; trả toạ độ cùng hệ với w × h (bên gọi quy ra %). */
export function squarify<T extends { value: number }>(items: T[], w: number, h: number):
  Array<T & { x: number; y: number; w: number; h: number }> {
  const sorted = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value)
  const total = sorted.reduce((s, i) => s + i.value, 0)
  const out: Array<T & { x: number; y: number; w: number; h: number }> = []
  if (total <= 0 || w <= 0 || h <= 0) return out
  const scale = (w * h) / total
  let x = 0, y = 0, rw = w, rh = h
  let row: Array<{ item: T; area: number }> = []
  const sumOf = (r: typeof row) => r.reduce((s, c) => s + c.area, 0)
  const worst = (r: typeof row, side: number) => {
    const s = sumOf(r), areas = r.map(c => c.area)
    return Math.max((side * side * Math.max(...areas)) / (s * s), (s * s) / (side * side * Math.min(...areas)))
  }
  const flush = () => {
    const s = sumOf(row)
    if (rw >= rh) {
      const cw = s / rh
      let cy = y
      for (const c of row) { const ch = c.area / cw; out.push({ ...c.item, x, y: cy, w: cw, h: ch }); cy += ch }
      x += cw; rw -= cw
    } else {
      const ch = s / rw
      let cx = x
      for (const c of row) { const cw = c.area / ch; out.push({ ...c.item, x: cx, y, w: cw, h: ch }); cx += cw }
      y += ch; rh -= ch
    }
    row = []
  }
  for (const item of sorted) {
    const cell = { item, area: item.value * scale }
    const side = Math.min(rw, rh)
    if (row.length === 0 || worst([...row, cell], side) <= worst(row, side)) row.push(cell)
    else { flush(); row.push(cell) }
  }
  if (row.length) flush()
  return out
}
