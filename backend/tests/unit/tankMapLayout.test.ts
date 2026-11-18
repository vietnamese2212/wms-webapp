// Sơ đồ bồn 2D (MES 18/11 g): xếp bồn theo khu (kho chế biến), tự xếp vừa khung, chỗ đã đặt được tôn trọng, ghim khi kéo, phần đổi để Lưu.
import { describe, it, expect } from 'vitest'
import {
  layoutTanks, bestColumns, pinArea, changedItems, lodOf, snap, effectivePos,
  NODE_W, NODE_H, GAP_X, GAP_Y, AREA_PAD, AREA_HEAD, AREA_GAP, type LayoutTank, type LayoutDraft,
} from '../../../frontend/src/utils/tankMapLayout'

const T = (id: string, wh = 'K1', x: number | null = null, y: number | null = null): LayoutTank => ({ id, warehouse_id: wh, map_x: x, map_y: y })
const many = (n: number, wh = 'K1') => Array.from({ length: n }, (_, i) => T(`${wh}-${String(i + 1).padStart(2, '0')}`, wh))
const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H
const scaleFor = (c: number, n: number, W: number, H: number) => {
  const r = Math.ceil(n / c)
  return Math.min(W / (c * NODE_W + (c - 1) * GAP_X), H / (r * NODE_H + (r - 1) * GAP_Y))
}

describe('bestColumns — số cột cho lưới vừa khung to nhất', () => {
  it.each([[28, 1240, 520], [28, 360, 520], [30, 1900, 900], [7, 800, 800], [1, 500, 500]])('%i bồn, khung %i × %i: không số cột nào cho tỉ lệ to hơn', (n, W, H) => {
    const c = bestColumns(n, W, H)
    const best = scaleFor(c, n, W, H)
    for (let k = 1; k <= n; k++) expect(scaleFor(k, n, W, H)).toBeLessThanOrEqual(best + 1e-9)
  })
  it('màn ngang nhiều cột hơn màn dọc', () => {
    expect(bestColumns(28, 1240, 520)).toBeGreaterThan(bestColumns(28, 360, 520))
  })
})

describe('layoutTanks — tự xếp', () => {
  const lay = layoutTanks(many(28), { K1: 'Chế biến Ba Vì' }, 1240, 520)
  it('mọi bồn có chỗ, không bồn nào đè bồn nào', () => {
    const ns = [...lay.nodes.values()]
    expect(ns).toHaveLength(28)
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) expect(overlap(ns[i], ns[j])).toBe(false)
  })
  it('bồn nằm trong khung khu; khu mang tên kho và số bồn', () => {
    const a = lay.areas[0]
    expect(a).toMatchObject({ id: 'K1', name: 'Chế biến Ba Vì', count: 28, x: 0, y: 0 })
    for (const n of lay.nodes.values()) {
      expect(n.x).toBeGreaterThanOrEqual(a.x + AREA_PAD); expect(n.y).toBeGreaterThanOrEqual(a.y + AREA_HEAD + AREA_PAD)
      expect(n.x + NODE_W).toBeLessThanOrEqual(a.x + a.w - AREA_PAD + 1e-9); expect(n.y + NODE_H).toBeLessThanOrEqual(a.y + a.h - AREA_PAD + 1e-9)
    }
    expect(lay.width).toBe(a.w); expect(lay.height).toBe(a.h)
  })
  it('giữ thứ tự hiển thị (theo mã): bồn đầu ở góc trái trên', () => {
    expect(lay.nodes.get('K1-01')).toMatchObject({ lx: 0, ly: 0, pinned: false })
    expect(lay.nodes.get('K1-02')).toMatchObject({ lx: NODE_W + GAP_X, ly: 0 })
  })
})

describe('layoutTanks — chỗ đã đặt', () => {
  it('bồn đã đặt đứng đúng toạ độ trong khu; bồn chưa đặt xếp thành hàng ngay dưới', () => {
    const tanks = [T('A', 'K1', 600, 0), T('B', 'K1', 0, 400), T('C'), T('D')]
    const lay = layoutTanks(tanks, {}, 1200, 700)
    const a = lay.areas[0]
    expect(lay.nodes.get('A')).toMatchObject({ lx: 600, ly: 0, x: a.x + AREA_PAD + 600, y: a.y + AREA_HEAD + AREA_PAD, pinned: true })
    const yBelow = snap(400 + NODE_H + GAP_Y)
    expect(lay.nodes.get('C')).toMatchObject({ lx: 0, ly: yBelow, pinned: false })
    expect(lay.nodes.get('D')!.ly).toBe(yBelow)
    expect(overlap(lay.nodes.get('C')!, lay.nodes.get('B')!)).toBe(false)
  })
  it('bản đang sửa thắng DB: null = về tự xếp, {x,y} = chỗ mới', () => {
    const tanks = [T('A', 'K1', 600, 0), T('B')]
    const d: LayoutDraft = new Map([['A', null], ['B', { x: 80, y: 120 }]])
    expect(effectivePos(tanks[0], d)).toBeNull()
    const lay = layoutTanks(tanks, {}, 1200, 700, d)
    expect(lay.nodes.get('B')).toMatchObject({ lx: 80, ly: 120, pinned: true })
    expect(lay.nodes.get('A')!.pinned).toBe(false)
  })
})

describe('layoutTanks — nhiều kho chế biến', () => {
  const tanks = [...many(4, 'K1'), ...many(3, 'K2')]
  it('màn ngang: các khu đứng cạnh nhau, cách AREA_GAP', () => {
    const lay = layoutTanks(tanks, { K1: 'CB1', K2: 'CB2' }, 1600, 700)
    const [a, b] = lay.areas
    expect(b.x).toBe(a.x + a.w + AREA_GAP); expect(b.y).toBe(0)
    expect(lay.nodes.get('K2-01')!.x).toBe(b.x + AREA_PAD)
  })
  it('màn dọc: các khu chồng lên nhau', () => {
    const lay = layoutTanks(tanks, {}, 380, 640)
    const [a, b] = lay.areas
    expect(b.y).toBe(a.y + a.h + AREA_GAP); expect(b.x).toBe(0)
  })
})

describe('pinArea + changedItems — kéo một bồn không làm các bồn khác nhảy chỗ', () => {
  const tanks = many(6)
  const lay = layoutTanks(tanks, {}, 1200, 700)
  it('ghim cả khu tại chỗ đang thấy ⇒ sơ đồ y hệt', () => {
    const d = pinArea(lay, 'K1', new Map())
    const lay2 = layoutTanks(tanks, {}, 1200, 700, d)
    for (const n of lay.nodes.values()) expect(lay2.nodes.get(n.id)).toMatchObject({ x: n.x, y: n.y, pinned: true })
  })
  it('changedItems chỉ gửi bồn khác DB', () => {
    const d = pinArea(lay, 'K1', new Map())
    d.set('K1-03', { x: 1000, y: 40 })
    const tanksWithSaved = tanks.map(t => (t.id === 'K1-01' ? { ...t, map_x: 0, map_y: 0 } : t))
    const items = changedItems(tanksWithSaved, d)
    expect(items.find(i => i.id === 'K1-01')).toBeUndefined()          // ghim đúng chỗ đã lưu ⇒ không đổi
    expect(items.find(i => i.id === 'K1-03')).toEqual({ id: 'K1-03', x: 1000, y: 40 })
    expect(changedItems(tanksWithSaved, new Map([['K1-01', null]]))).toEqual([{ id: 'K1-01', x: null, y: null }])
  })
})

describe('lodOf — mức chi tiết theo tỉ lệ', () => {
  it('toàn cảnh < 0,6 ≤ vận hành < 1,1 ≤ chi tiết', () => {
    expect(lodOf(0.3)).toBe(1); expect(lodOf(0.59)).toBe(1); expect(lodOf(0.6)).toBe(2); expect(lodOf(1.09)).toBe(2); expect(lodOf(1.1)).toBe(3)
  })
  it('snap về lưới 20, không âm', () => {
    expect(snap(29)).toBe(20); expect(snap(31)).toBe(40); expect(snap(-15)).toBe(0)
  })
})
