/**
 * NHẶT DỌC ĐƯỜNG — sắp lại bảng "Cần hạ" để xe nâng khỏi quay lại chỗ vừa đi qua.
 *
 * VÌ SAO (đo 13/09, BFS dựng NGOÀI app trên bản vẽ thật Kho Ba Vì, trung bình 12 lượt gieo):
 * thứ tự việc đứng giữa HAI tiêu chí đối nhau — nhóm theo CHUYẾN thì xe rời cửa sớm nhưng xe nâng
 * đi xa hơn đường ngắn nhất ~25 %; đi đường ngắn nhất toàn kho thì ngược lại, giữ cửa lâu hơn 37 %.
 * Không được đổi sang tối ưu đường thuần — cửa mới là tài nguyên hiếm.
 *
 * Phương án THẮNG CẢ HAI: giữ nguyên nhóm theo chuyến, nhưng khi xe nâng đang đứng ở một điểm đặt
 * dãy mà có việc của CHUYẾN KHÁC trong bán kính R thì làm luôn. Đo: 3.854 → 3.242 m (−16 % đường)
 * và 2.071 → 1.982 m (−4 % thời gian giữ cửa) ở 8 chuyến × 10 việc, hàng rải đều.
 *
 * RANH GIỚI CỐ Ý:
 *  • CHỈ bảng "Cần hạ". Bảng "Cần đưa ra" mỗi việc đều kết thúc tại CỬA nên tổng quãng đường KHÔNG
 *    phụ thuộc thứ tự — sắp lại ở đó chỉ làm người ta nhảy chuyến mà chẳng được gì.
 *  • Đo gần/xa bằng BFS trên bản vẽ, KHÔNG bằng khoảng cách hình học: đo cả hai thì hình học chỉ lấy
 *    lại được một nửa lợi ích (−10 % so với −16 %) vì nó coi hai ô kề nhau qua một khối kệ là gần.
 *  • Dùng ĐÚNG `utils/warehouseGrid.ts` mà bộ lập kế hoạch dùng — một nguồn cho phép đo đường đi.
 *  • Việc đã xong / đã bỏ giữ nguyên ở cuối, không đưa vào vòng sắp.
 */
import { db } from '../lib/supabase'
import { fetchAllRowsParallel } from '../utils/pagination'
import {
  buildBlockedMask, bfsFrom, distanceToCells, footprintCells, orderByNearest,
  type GridFrame, type GridLoc,
} from '../utils/warehouseGrid'

/** Chỉ lấy đúng phần dòng bảng mà việc sắp lại cần đọc — phần còn lại đi qua nguyên vẹn. */
export interface RoutableRow {
  gdo_id?: string | null
  from_location_id?: string | null
  drop_location_id?: string | null
  stage_done?: boolean | null
  skipped?: boolean | null
}

type LocRow = { id: string; kind: string; grid_x: number | null; grid_y: number | null; grid_w: number | null; grid_h: number | null }
type Grid = { frame: GridFrame; mask: Uint8Array; locById: Map<string, LocRow>; cellM: number }

// Bản vẽ đổi rất ít (chỉ khi có người sửa Sơ đồ kho) nhưng bảng việc được tải lại mỗi 10 giây và
// nhiều người cùng mở ⇒ nhớ trong tiến trình 60 giây, theo đúng khuôn getter-cache của dự án.
const CACHE_MS = 60_000
const cache = new Map<string, { at: number; grid: Grid | null }>()

async function loadGrid(warehouseId: string): Promise<Grid | null> {
  const hit = cache.get(warehouseId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.grid
  const [{ data: mapRow }, locsRaw] = await Promise.all([
    db.from('warehouse_maps').select('width, height, blocked, cell_m').eq('warehouse_id', warehouseId).maybeSingle(),
    fetchAllRowsParallel(() => db.from('Location')
      .select('id, kind, grid_x, grid_y, grid_w, grid_h')
      .eq('warehouse_id', warehouseId).eq('is_active', true).order('id')),
  ])
  const map = mapRow as { width: number; height: number; blocked: [number, number][] | null; cell_m: number | null } | null
  let grid: Grid | null = null
  if (map) {
    const locs = (locsRaw ?? []) as LocRow[]
    const frame: GridFrame = { width: map.width, height: map.height }
    grid = {
      frame,
      mask: buildBlockedMask(frame, map.blocked ?? [], locs as unknown as GridLoc[]),
      locById: new Map(locs.map(l => [l.id, l])),
      cellM: Number(map.cell_m) > 0 ? Number(map.cell_m) : 1.2,
    }
  }
  cache.set(warehouseId, { at: Date.now(), grid })
  return grid
}

/** Chỉ dùng trong phép kiểm — buộc nạp lại bản vẽ ngay sau khi sửa Sơ đồ kho. */
export function clearRouteGridCache(warehouseId?: string): void {
  if (warehouseId) cache.delete(warehouseId); else cache.clear()
}

/**
 * ĐƯỜNG ĐI NHẶT LẺ (user 14/09: "con đường của Nhặt lẻ A → B → C sao cho hợp lý"): thứ tự ghé các
 * vị trí từ cửa của chuyến, tham lam "gần nhất chưa ghé" trên BFS của bản vẽ — cùng phép đo với vòng
 * đi của xe nâng (`assignSeq`), không chép bản thứ hai. Không có bản vẽ / không có điểm xuất phát ⇒
 * trả nguyên thứ tự đưa vào và `routed=false` để màn hình nói thật là chưa có đường.
 */
export async function orderLocationsFromDock(
  warehouseId: string, startLocationId: string | null, locationIds: string[],
): Promise<{ order: string[]; routed: boolean; legs: number[]; cell_m: number | null }> {
  const uniq = [...new Set(locationIds)]
  const grid = await loadGrid(warehouseId)
  const noLegs = uniq.map(() => -1)
  if (!grid) return { order: uniq, routed: false, legs: noLegs, cell_m: null }
  const start = (startLocationId ? grid.locById.get(startLocationId) : null)
    ?? [...grid.locById.values()].find(l => l.kind === 'DROP' && l.grid_x != null) ?? null
  if (!start || start.grid_x == null || start.grid_y == null) return { order: uniq, routed: false, legs: noLegs, cell_m: grid.cellM }
  const targets = uniq.map(id => { const l = grid.locById.get(id); return l ? footprintCells(l as unknown as GridLoc) : [] })
  // Một điểm ghé vẫn chạy qua BFS để có quãng đường từ cửa (trước 14/09 dưới 2 điểm thì trả nguyên)
  const legs: number[] = []
  const idx = orderByNearest(grid.frame, grid.mask, { x: start.grid_x, y: start.grid_y }, targets, legs)
  return { order: idx.map(i => uniq[i]), routed: true, legs, cell_m: grid.cellM }
}

/**
 * Sắp lại `rows` (ĐÃ theo thứ tự bảng: ưu tiên chuyến → vòng đường của chuyến).
 * Trả về mảng MỚI; `rows` không bị đụng. Thiếu bản vẽ / bán kính 0 / dưới 2 dòng ⇒ trả nguyên trạng.
 */
export async function reorderCrossTripPickup<T extends RoutableRow>(
  rows: T[], warehouseId: string, radius: number,
): Promise<T[]> {
  if (!Array.isArray(rows) || rows.length < 2 || !(radius > 0)) return rows
  const open = rows.filter(r => !r.stage_done && !r.skipped)
  const closed = rows.filter(r => r.stage_done || r.skipped)
  if (open.length < 2) return rows
  const grid = await loadGrid(warehouseId)
  if (!grid) return rows

  const { frame, mask, locById } = grid
  // Chỗ xe nâng ĐỨNG sau mỗi việc = điểm đặt dãy (việc cần hạ luôn có), nên số điểm xuất phát khác
  // nhau rất ít ⇒ mỗi điểm chỉ BFS MỘT lần rồi tra bảng, không BFS theo từng việc.
  const bfsCache = new Map<string, Int32Array>()
  const distFrom = (fromId: string, toId: string | null | undefined): number => {
    if (!toId) return -1
    const src = locById.get(fromId), dst = locById.get(toId)
    if (!src || !dst || src.grid_x == null || src.grid_y == null) return -1
    let d = bfsCache.get(fromId)
    if (!d) { d = bfsFrom(frame, mask, { x: src.grid_x, y: src.grid_y }).dist; bfsCache.set(fromId, d) }
    const cells = footprintCells(dst as unknown as GridLoc)
    if (!cells.length) return -1
    return distanceToCells(frame, mask, d, cells)
  }
  const standAfter = (r: T): string | null => r.drop_location_id ?? r.from_location_id ?? null

  const pending = new Set(open)
  const out: T[] = []
  let stand: string | null = null
  while (pending.size) {
    // Việc kế tiếp theo ĐÚNG thứ tự bảng — đây là cái neo giữ nguyên ưu tiên chuyến
    let next: T | null = null
    for (const r of open) if (pending.has(r)) { next = r; break }
    if (!next) break
    // …trước khi đi, nhặt hết việc của CHUYẾN KHÁC nằm trong bán kính từ chỗ đang đứng
    for (;;) {
      if (!stand) break
      let best: T | null = null, bestD = -1
      for (const r of pending) {
        if (r === next || (r.gdo_id && next.gdo_id && r.gdo_id === next.gdo_id)) continue
        const d = distFrom(stand, r.from_location_id)
        if (d >= 0 && d <= radius && (bestD < 0 || d < bestD)) { bestD = d; best = r }
      }
      if (!best) break
      out.push(best); pending.delete(best); stand = standAfter(best)
    }
    out.push(next); pending.delete(next); stand = standAfter(next)
  }
  return [...out, ...closed]
}
