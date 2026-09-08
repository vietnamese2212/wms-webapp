// SƠ ĐỒ KHO — lưới 2D + tìm đường (08/09/2026). MIRROR: backend/src/utils/warehouseGrid.ts.
// Sửa luật ở đây thì sửa CẢ HAI (cùng bài học qtyUnits/plate: hai bản phải khớp từng dòng).
//
// Mô hình: 1 ô lưới ≈ 1 chân pallet (mét/ô = warehouse_maps.cell_m). Vị trí chiếm một KHỐI
// grid_w × grid_h ô, neo (grid_x, grid_y) = góc trên-trái. Ô của VỊ TRÍ CHỨA HÀNG (kind STORAGE)
// hoặc TƯỜNG = chắn; ô trống, cửa/bãi (DOCK_*), điểm đầu dãy (DROP) = lối đi.
// Khoảng cách = số ô phải đi (BFS 4 hướng). Đích là khối chắn (kệ) thì "tới" = đứng ở ô lối đi
// KỀ khối — nên distanceToCells lấy min qua các ô kề + 1. Ra mét: × cell_m.
// KHÔNG lưu khoảng cách trong DB: bản vẽ là nguồn duy nhất, đổi bản vẽ là số đổi theo.

export type GridFrame = { width: number; height: number }
export type GridCell = { x: number; y: number }
export type GridKind = 'STORAGE' | 'DOCK_IN' | 'DOCK_OUT' | 'DROP'
export type GridLoc = { grid_x: number | null; grid_y: number | null; grid_w?: number | null; grid_h?: number | null; kind: GridKind }

export const inFrame = (f: GridFrame, x: number, y: number) => x >= 0 && y >= 0 && x < f.width && y < f.height
export const cellIndex = (f: GridFrame, x: number, y: number) => y * f.width + x

/** Mọi ô một vị trí chiếm (theo neo + kích thước; kích thước thiếu = 1×1). Chưa đặt → []. */
export function footprintCells(l: GridLoc): GridCell[] {
  if (l.grid_x == null || l.grid_y == null) return []
  const w = Math.max(1, l.grid_w ?? 1), h = Math.max(1, l.grid_h ?? 1)
  const out: GridCell[] = []
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: l.grid_x + dx, y: l.grid_y + dy })
  return out
}

/** Mặt nạ chắn: 1 = không đi qua được. `blocked` = tường/cột khai tay; khối STORAGE tự chắn. */
export function buildBlockedMask(f: GridFrame, blocked: ReadonlyArray<readonly [number, number]>, locs: ReadonlyArray<GridLoc>): Uint8Array {
  const m = new Uint8Array(f.width * f.height)
  for (const [x, y] of blocked) if (inFrame(f, x, y)) m[cellIndex(f, x, y)] = 1
  for (const l of locs) {
    if (l.kind !== 'STORAGE') continue
    for (const c of footprintCells(l)) if (inFrame(f, c.x, c.y)) m[cellIndex(f, c.x, c.y)] = 1
  }
  return m
}

const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/**
 * BFS từ một ô: trả mảng khoảng cách (số ô), -1 = không tới được. Ô xuất phát được coi là đi được
 * kể cả khi nó chắn (đứng ở cửa/điểm đầu dãy đặt lên ô tường vẫn xuất phát được).
 * Kèm mảng `parent` để dựng đường đi (pathToCells).
 */
export function bfsFrom(f: GridFrame, mask: Uint8Array, start: GridCell): { dist: Int32Array; parent: Int32Array } {
  const n = f.width * f.height
  const dist = new Int32Array(n).fill(-1)
  const parent = new Int32Array(n).fill(-1)
  if (!inFrame(f, start.x, start.y)) return { dist, parent }
  const q = new Int32Array(n)
  let head = 0, tail = 0
  const s = cellIndex(f, start.x, start.y)
  dist[s] = 0; q[tail++] = s
  while (head < tail) {
    const cur = q[head++]
    const cx = cur % f.width, cy = (cur - cx) / f.width
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy
      if (!inFrame(f, nx, ny)) continue
      const ni = cellIndex(f, nx, ny)
      if (dist[ni] !== -1 || mask[ni]) continue
      dist[ni] = dist[cur] + 1; parent[ni] = cur; q[tail++] = ni
    }
  }
  return { dist, parent }
}

/** Ô "đứng tới được" gần nhất cho một khối đích: chính ô đó nếu đi được, không thì ô kề đi được. */
function nearestReach(f: GridFrame, mask: Uint8Array, dist: Int32Array, cells: ReadonlyArray<GridCell>): { idx: number; d: number } {
  let best = -1, bestIdx = -1
  for (const t of cells) {
    if (!inFrame(f, t.x, t.y)) continue
    const ti = cellIndex(f, t.x, t.y)
    if (!mask[ti]) {
      if (dist[ti] >= 0 && (best < 0 || dist[ti] < best)) { best = dist[ti]; bestIdx = ti }
      continue
    }
    for (const [dx, dy] of DIRS) {
      const nx = t.x + dx, ny = t.y + dy
      if (!inFrame(f, nx, ny)) continue
      const ni = cellIndex(f, nx, ny)
      const d = dist[ni]
      if (d >= 0 && !mask[ni] && (best < 0 || d + 1 < best)) { best = d + 1; bestIdx = ni }
    }
  }
  return { idx: bestIdx, d: best }
}

/** Khoảng cách (số ô) tới một khối đích. -1 = không tới. */
export function distanceToCells(f: GridFrame, mask: Uint8Array, dist: Int32Array, cells: ReadonlyArray<GridCell>): number {
  return nearestReach(f, mask, dist, cells).d
}
/** Tiện cho đích 1 ô. */
export function distanceTo(f: GridFrame, mask: Uint8Array, dist: Int32Array, t: GridCell): number {
  return distanceToCells(f, mask, dist, [t])
}

/** Đường đi từ điểm BFS tới khối đích: dừng ở ô kề gần nhất rồi bước vào ô đích gần đó. */
export function pathToCells(f: GridFrame, mask: Uint8Array, bfs: { dist: Int32Array; parent: Int32Array }, cells: ReadonlyArray<GridCell>): GridCell[] {
  const r = nearestReach(f, mask, bfs.dist, cells)
  if (r.idx < 0) return []
  const out: GridCell[] = []
  for (let i = r.idx; i !== -1; i = bfs.parent[i]) out.push({ x: i % f.width, y: (i - (i % f.width)) / f.width })
  out.reverse()
  const last = out[out.length - 1]
  // ô cuối chưa nằm trong khối → bước vào ô của khối kề nó (để vẽ mũi tên chạm đúng kệ)
  if (last && !cells.some(c => c.x === last.x && c.y === last.y)) {
    const into = cells.find(c => Math.abs(c.x - last.x) + Math.abs(c.y - last.y) === 1)
    if (into) out.push(into)
  }
  return out
}
export function pathTo(f: GridFrame, mask: Uint8Array, bfs: { dist: Int32Array; parent: Int32Array }, t: GridCell): GridCell[] {
  return pathToCells(f, mask, bfs, [t])
}

/**
 * Thứ tự ghé các đích từ điểm xuất phát: tham lam "đích gần nhất chưa ghé" (đủ tốt cho mười mấy
 * điểm của một chuyến; không giải TSP). Trả mảng CHỈ SỐ của `targets`; đích không tới được xếp cuối.
 */
export function orderByNearest(f: GridFrame, mask: Uint8Array, start: GridCell, targets: ReadonlyArray<ReadonlyArray<GridCell>>): number[] {
  const remaining = new Set(targets.map((_, i) => i))
  const order: number[] = []
  let cur = start
  while (remaining.size) {
    const { dist } = bfsFrom(f, mask, cur)
    let bestI = -1, bestD = -1, bestCell: GridCell | null = null
    for (const i of remaining) {
      const r = nearestReach(f, mask, dist, targets[i])
      if (r.d >= 0 && (bestD < 0 || r.d < bestD)) { bestD = r.d; bestI = i; bestCell = { x: r.idx % f.width, y: (r.idx - (r.idx % f.width)) / f.width } }
    }
    if (bestI < 0 || !bestCell) break
    order.push(bestI); remaining.delete(bestI); cur = bestCell
  }
  for (const i of [...remaining].sort((a, b) => a - b)) order.push(i)
  return order
}

/** Các ô trên đoạn thẳng A→B (Bresenham) — dùng khi "rải dãy" bằng một vệt kéo chuột. */
export function lineCells(a: GridCell, b: GridCell): GridCell[] {
  const out: GridCell[] = []
  let x0 = a.x, y0 = a.y
  const x1 = b.x, y1 = b.y
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (let guard = 0; guard < 10_000; guard++) {
    out.push({ x: x0, y: y0 })
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
  return out
}

/** So "tự nhiên" cho mã dãy: A2 < A10, 9 < 10 (sort chuỗi thuần xếp 10 trước 2). */
export function naturalCompare(a: string, b: string): number {
  const ra = a.match(/\d+|\D+/g) ?? [a], rb = b.match(/\d+|\D+/g) ?? [b]
  const n = Math.min(ra.length, rb.length)
  for (let i = 0; i < n; i++) {
    const x = ra[i], y = rb[i]
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y)
    if (nx && ny) { const d = Number(x) - Number(y); if (d) return d }
    else if (x !== y) return x < y ? -1 : 1
  }
  return ra.length - rb.length
}

/** Khoá CHÂN KỆ: các tầng cùng chân dùng chung một ô. Cửa/bãi/điểm hạ = chân riêng theo id. */
export function footprintKeyOf(l: { id: string; kind: GridKind; sub_code: string | null; row: string | null }): string {
  return l.kind === 'STORAGE' ? `${l.sub_code ?? ''}|${l.row ?? ''}` : `K|${l.id}`
}
