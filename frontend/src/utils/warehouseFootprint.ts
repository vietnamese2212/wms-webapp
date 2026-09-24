// Chân kệ (Footprint) — kiểu dữ liệu dẫn xuất dùng chung cho Sơ đồ kho 2D (WarehouseMap.tsx) và góc nhìn
// 3D chỉ xem (components/wms/WarehouseMap3D.tsx, 09/09). Tách khỏi trang để Giám sát vận hành (TV) dựng 3D
// từ CÙNG dữ liệu mà không import trang.
// Chân kệ = nhóm vị trí dùng chung một ô lưới (các tầng T1..T4 của cùng (khu, dãy)). Cửa/bãi/điểm hạ = chân riêng.
import type { MapLoc, MapKind } from '@/api/warehouseMap'
import { footprintCells, footprintKeyOf, type GridCell } from '@/utils/warehouseGrid'

export interface Footprint {
  key: string
  kind: MapKind
  sub_code: string
  label: string            // mã dãy (row) — hiện trên ô
  code: string             // mã vị trí đại diện (tầng 1 hoặc dòng đầu)
  locs: MapLoc[]           // sắp theo tầng TĂNG (T1 trước)
  anchor: GridCell | null
  w: number; h: number
  is_rack: boolean
  cells: GridCell[]
}

export const KIND_LABEL: Record<MapKind, string> = { STORAGE: 'Ô chứa hàng', DOCK_OUT: 'Cửa / bãi xuất', DOCK_IN: 'Cửa / bãi nhập', DROP: 'Điểm đầu dãy' }
export const KIND_COLOR: Record<Exclude<MapKind, 'STORAGE'>, string> = { DOCK_OUT: '#22c55e', DOCK_IN: '#3b82f6', DROP: '#f59e0b' }
// Bảng màu khu (tông nhẹ, phân biệt được ~8 khu; vượt thì lặp)
export const ZONE_PALETTE = ['#bae6fd', '#bbf7d0', '#fde68a', '#fecaca', '#ddd6fe', '#fbcfe8', '#a7f3d0', '#fed7aa']

export function groupFootprints(locs: MapLoc[]): Footprint[] {
  const map = new Map<string, MapLoc[]>()
  for (const l of locs) {
    const k = footprintKeyOf(l)
    const arr = map.get(k)
    if (arr) arr.push(l); else map.set(k, [l])
  }
  const out: Footprint[] = []
  for (const [key, arr] of map) {
    arr.sort((a, b) => (a.level_no ?? 0) - (b.level_no ?? 0) || a.location_code.localeCompare(b.location_code))
    // Neo/kích thước lấy từ dòng ĐÃ ĐẶT (tầng nào cũng chung một ô — dòng nào có toạ độ là đúng)
    const placed = arr.find(l => l.grid_x != null && l.grid_y != null)
    const first = arr[0]
    const w = placed?.grid_w ?? 1, h = placed?.grid_h ?? 1
    const anchor = placed ? { x: placed.grid_x as number, y: placed.grid_y as number } : null
    out.push({
      key, kind: first.kind, sub_code: first.sub_code ?? '', label: first.row ?? first.location_code, code: first.location_code,
      locs: arr, anchor, w, h, is_rack: arr.some(l => l.is_rack),
      cells: placed ? footprintCells({ grid_x: placed.grid_x, grid_y: placed.grid_y, grid_w: w, grid_h: h, kind: first.kind }) : [],
    })
  }
  return out
}

// Màu khu theo thứ tự tự nhiên của mã khu — cùng một hàm cho 2D và 3D để một khu không đổi màu giữa hai góc nhìn
export function zoneColorMap(footprints: Footprint[], naturalCompare: (a: string, b: string) => number): Map<string, string> {
  const zones = [...new Set(footprints.filter(f => f.kind === 'STORAGE').map(f => f.sub_code))].sort(naturalCompare)
  return new Map(zones.map((z, i) => [z, ZONE_PALETTE[i % ZONE_PALETTE.length]]))
}
