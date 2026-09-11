// MIRROR lưới Sơ đồ kho: BE (thứ tự việc lấy hàng theo khoảng cách) ⇄ FE (lớp phủ Đường đi, gợi ý điểm đầu dãy).
// Lệch = bảng Việc cần làm xếp thứ tự khác với đường đi đang vẽ trên bản đồ.
import { describe, it, expect } from 'vitest'
import * as BE from '../../src/utils/warehouseGrid'
import * as FE from '../../../frontend/src/utils/warehouseGrid'
import { rng, SEED, type Rng } from '../helpers/rng'

const KINDS = ['STORAGE', 'STORAGE', 'STORAGE', 'DOCK_IN', 'DOCK_OUT', 'DROP'] as const

function scenario(r: Rng) {
  const f = { width: r.int(3, 12), height: r.int(3, 12) }
  const blocked: [number, number][] = Array.from({ length: r.int(0, 10) }, () => [r.int(0, f.width - 1), r.int(0, f.height - 1)])
  const locs: BE.GridLoc[] = Array.from({ length: r.int(0, 8) }, () => ({
    grid_x: r.bool(0.1) ? null : r.int(0, f.width - 1),
    grid_y: r.bool(0.1) ? null : r.int(0, f.height - 1),
    grid_w: r.bool(0.5) ? undefined : r.int(1, 3),
    grid_h: r.bool(0.5) ? undefined : r.int(1, 3),
    kind: r.pick(KINDS),
  }))
  const start = { x: r.int(0, f.width - 1), y: r.int(0, f.height - 1) }
  return { f, blocked, locs, start }
}

describe(`warehouseGrid BE ⇄ FE (seed ${SEED})`, () => {
  it('mask · BFS · path · orderByNearest · lineCells · naturalCompare · footprint khớp', () => {
    const r = rng()
    for (let i = 0; i < 400; i++) {
      const { f, blocked, locs, start } = scenario(r)
      const ctx = JSON.stringify({ f, blocked, locs, start })
      for (const l of locs) expect(FE.footprintCells(l), ctx).toEqual(BE.footprintCells(l))
      const mb = BE.buildBlockedMask(f, blocked, locs)
      const mf = FE.buildBlockedMask(f, blocked, locs)
      expect(mf, ctx).toEqual(mb)
      const bb = BE.bfsFrom(f, mb, start)
      const bf = FE.bfsFrom(f, mf, start)
      expect(bf.dist, ctx).toEqual(bb.dist)
      expect(bf.parent, ctx).toEqual(bb.parent)
      const t = { x: r.int(0, f.width - 1), y: r.int(0, f.height - 1) }
      expect(FE.distanceTo(f, mf, bf.dist, t), ctx).toBe(BE.distanceTo(f, mb, bb.dist, t))
      expect(FE.pathTo(f, mf, bf, t), ctx).toEqual(BE.pathTo(f, mb, bb, t))
      const targets = locs.map(l => BE.footprintCells(l)).filter(c => c.length)
      expect(FE.distanceToCells(f, mf, bf.dist, targets[0] ?? []), ctx).toBe(BE.distanceToCells(f, mb, bb.dist, targets[0] ?? []))
      expect(FE.pathToCells(f, mf, bf, targets[0] ?? []), ctx).toEqual(BE.pathToCells(f, mb, bb, targets[0] ?? []))
      expect(FE.orderByNearest(f, mf, start, targets), ctx).toEqual(BE.orderByNearest(f, mb, start, targets))
      expect(FE.lineCells(start, t), ctx).toEqual(BE.lineCells(start, t))
    }
    const NAMES = ['A1', 'A10', 'A2', 'a2', 'B_T1', 'B_T10', 'B_T2', '', '10', '9', 'A12_T4', 'A12_T1', 'Kho Lẻ', 'kho lẻ']
    for (const a of NAMES) for (const b of NAMES) expect(FE.naturalCompare(a, b), `${a} vs ${b}`).toBe(BE.naturalCompare(a, b))
    for (const l of [
      { id: 'x', kind: 'STORAGE' as const, sub_code: 'A', row: '12' },
      { id: 'y', kind: 'STORAGE' as const, sub_code: null, row: null },
      { id: 'z', kind: 'DOCK_OUT' as const, sub_code: 'C', row: '1' },
    ]) expect(FE.footprintKeyOf(l), l.id).toBe(BE.footprintKeyOf(l))
  })
})
