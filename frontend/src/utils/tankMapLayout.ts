// XẾP BỒN TRÊN SƠ ĐỒ 2D (MES 18/11 g) — hàm thuần, có test (backend/tests/unit/tankMapLayout.test.ts).
// • Mỗi KHO CHẾ BIẾN là một KHU (khung có tên) — giống "khu vực" của phần mềm MES; bồn nằm trong khu của kho mình.
// • Chỗ của bồn = toạ độ ĐÃ ĐẶT (production_tank.map_x / map_y, tính trong khu) nếu có; chưa đặt thì TỰ XẾP thành lưới, số cột chọn sao cho
//   cả khu vừa khung nhìn to nhất. Khu có bồn đã đặt ⇒ bồn chưa đặt xếp thành hàng NGAY DƯỚI các bồn đã đặt.
// • Nhiều khu: khung nhìn ngang ⇒ các khu đứng cạnh nhau; khung dọc (điện thoại) ⇒ chồng lên nhau.

export const NODE_W = 260
export const NODE_H = 380
export const GAP_X = 48
export const GAP_Y = 56
export const GRID = 20
export const AREA_PAD = 36
export const AREA_HEAD = 56
export const AREA_GAP = 120

export interface LayoutTank { id: string; warehouse_id: string; map_x: number | null; map_y: number | null }
export interface MapArea { id: string; name: string; x: number; y: number; w: number; h: number; count: number }
export interface PlacedNode { id: string; area: string; x: number; y: number; lx: number; ly: number; pinned: boolean }
export interface MapLayout { nodes: Map<string, PlacedNode>; areas: MapArea[]; width: number; height: number }
/** chỗ đặt đang sửa (chế độ Sắp xếp): không có khoá = theo DB · null = tự xếp · {x,y} = đặt tại đó (trong khu) */
export type LayoutDraft = Map<string, { x: number; y: number } | null>

/** làm tròn về lưới GRID, không âm */
export const snap = (v: number) => Math.max(0, Math.round(v / GRID) * GRID)

/** số cột cho n bồn sao cho lưới vừa khung W × H với tỉ lệ to nhất (hoà ⇒ ít cột hơn) */
export function bestColumns(n: number, W: number, H: number): number {
  if (n <= 1 || W <= 0 || H <= 0) return 1
  let best = 1, bestS = -1
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c)
    const s = Math.min(W / (c * NODE_W + (c - 1) * GAP_X), H / (r * NODE_H + (r - 1) * GAP_Y))
    if (s > bestS + 1e-9) { best = c; bestS = s }
  }
  return best
}

/** chỗ đặt hiệu lực của một bồn: bản đang sửa (nếu có khoá) rồi tới DB */
export function effectivePos(t: LayoutTank, draft?: LayoutDraft): { x: number; y: number } | null {
  if (draft?.has(t.id)) return draft.get(t.id) ?? null
  return t.map_x != null && t.map_y != null ? { x: t.map_x, y: t.map_y } : null
}

/**
 * Dựng sơ đồ: `tanks` theo thứ tự hiển thị (kho → mã), `names` = tên kho chế biến, khung nhìn W × H (để chọn số cột khi tự xếp và
 * hướng xếp các khu). Trả toạ độ tuyệt đối (lx / ly = toạ độ trong khu — giá trị ghi xuống DB khi Lưu).
 */
export function layoutTanks(tanks: LayoutTank[], names: Record<string, string>, W: number, H: number, draft?: LayoutDraft): MapLayout {
  const order: string[] = []
  const byArea = new Map<string, LayoutTank[]>()
  for (const t of tanks) {
    if (!byArea.has(t.warehouse_id)) { byArea.set(t.warehouse_id, []); order.push(t.warehouse_id) }
    byArea.get(t.warehouse_id)!.push(t)
  }
  const landscape = W >= H
  const n = order.length || 1
  // mỗi khu được một phần khung khi chọn số cột (ngang: chia bề ngang; dọc: chia bề cao)
  const aw = landscape ? Math.max(W / n, 1) : W, ah = landscape ? H : Math.max(H / n, 1)
  const local = new Map<string, { area: string; lx: number; ly: number; pinned: boolean }>()
  const sizes = new Map<string, { w: number; h: number }>()
  for (const a of order) {
    const list = byArea.get(a)!
    const fixed: { t: LayoutTank; p: { x: number; y: number } }[] = []
    const autos: LayoutTank[] = []
    for (const t of list) { const p = effectivePos(t, draft); if (p) fixed.push({ t, p }); else autos.push(t) }
    let cw = 0, ch = 0
    for (const { t, p } of fixed) {
      local.set(t.id, { area: a, lx: p.x, ly: p.y, pinned: true })
      cw = Math.max(cw, p.x + NODE_W); ch = Math.max(ch, p.y + NODE_H)
    }
    if (autos.length) {
      const cols = fixed.length
        ? Math.max(1, Math.floor((cw + GAP_X) / (NODE_W + GAP_X)))
        : bestColumns(autos.length, aw - 2 * AREA_PAD, ah - 2 * AREA_PAD - AREA_HEAD)
      const y0 = fixed.length ? snap(ch + GAP_Y) : 0
      autos.forEach((t, i) => {
        const lx = (i % cols) * (NODE_W + GAP_X), ly = y0 + Math.floor(i / cols) * (NODE_H + GAP_Y)
        local.set(t.id, { area: a, lx, ly, pinned: false })
        cw = Math.max(cw, lx + NODE_W); ch = Math.max(ch, ly + NODE_H)
      })
    }
    sizes.set(a, { w: cw + 2 * AREA_PAD, h: ch + 2 * AREA_PAD + AREA_HEAD })
  }
  const areas: MapArea[] = []
  let cx = 0, cy = 0
  for (const a of order) {
    const s = sizes.get(a)!
    areas.push({ id: a, name: names[a] ?? '', x: cx, y: cy, w: s.w, h: s.h, count: byArea.get(a)!.length })
    if (landscape) cx += s.w + AREA_GAP; else cy += s.h + AREA_GAP
  }
  const at = new Map(areas.map(x => [x.id, x]))
  const nodes = new Map<string, PlacedNode>()
  for (const [id, l] of local) {
    const ar = at.get(l.area)!
    nodes.set(id, { id, area: l.area, lx: l.lx, ly: l.ly, x: ar.x + AREA_PAD + l.lx, y: ar.y + AREA_HEAD + AREA_PAD + l.ly, pinned: l.pinned })
  }
  const width = areas.reduce((m, x) => Math.max(m, x.x + x.w), 0)
  const height = areas.reduce((m, x) => Math.max(m, x.y + x.h), 0)
  return { nodes, areas, width, height }
}

/** Ghim mọi bồn của một khu tại chỗ đang thấy (lần kéo đầu tiên trong khu) — bồn tự xếp không bị dồn chỗ khi một bồn rời lưới. */
export function pinArea(layout: MapLayout, area: string, draft: LayoutDraft): LayoutDraft {
  const out: LayoutDraft = new Map(draft)
  for (const n of layout.nodes.values()) if (n.area === area && !n.pinned) out.set(n.id, { x: n.lx, y: n.ly })
  return out
}

/** Bồn có chỗ đặt khác DB (để bật nút Lưu và gửi đúng phần đổi). */
export function changedItems(tanks: LayoutTank[], draft: LayoutDraft): { id: string; x: number | null; y: number | null }[] {
  const out: { id: string; x: number | null; y: number | null }[] = []
  for (const t of tanks) {
    if (!draft.has(t.id)) continue
    const p = draft.get(t.id) ?? null
    const was = t.map_x != null && t.map_y != null ? { x: t.map_x, y: t.map_y } : null
    if ((p?.x ?? null) !== (was?.x ?? null) || (p?.y ?? null) !== (was?.y ?? null)) out.push({ id: t.id, x: p?.x ?? null, y: p?.y ?? null })
  }
  return out
}

/** Mức chi tiết theo tỉ lệ thu phóng (bảng hiển thị nhiều tầng của MES / ISA-101): 1 = toàn cảnh · 2 = vận hành · 3 = chi tiết */
export type Lod = 1 | 2 | 3
export const LOD2_AT = 0.6
export const LOD3_AT = 1.1
export const lodOf = (scale: number): Lod => (scale >= LOD3_AT ? 3 : scale >= LOD2_AT ? 2 : 1)
