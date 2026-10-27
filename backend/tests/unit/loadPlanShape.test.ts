// HÌNH KHỐI sơ đồ xếp xe 3D (frontend/src/utils/loadPlan.ts) — user 27/10: "thạch túi xếp rất cao,
// hở… vuông vắn nhất có thể, hàng tựa vào nhau không đổ" (ảnh: hàng gửi thành tháp 8 lớp lẻ loi
// trên nóc + khe giữa các cột; pallet gộp lùn 0,45m đứng cạnh pallet 1,6m).
import { describe, it, expect } from 'vitest'
import {
  computeLoadPlan, palletizeGroups, levelFill,
  type LoadGroup, type PlacedBox, type PalletSpec,
} from '../../../frontend/src/utils/loadPlan'

const grp = (key: string, doKey: string, count: number, l: number, w: number, h: number, extra: Partial<LoadGroup> = {}): LoadGroup => ({
  key: `${doKey}|${key}`, label: key, doKey, doLabel: doKey, count, l, w, h,
  weightKg: 5, assumed: false, maxLayers: null, onTop: false, ...extra,
})

function overlaps(ps: PlacedBox[]): number {
  let n = 0
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], b = ps[j]
    if (a.x + a.l - 1 > b.x && b.x + b.l - 1 > a.x && a.y + a.w - 1 > b.y && b.y + b.w - 1 > a.y && a.z + a.h - 1 > b.z && b.z + b.h - 1 > a.z) n++
  }
  return n
}

describe('loadPlan — hình khối vuông vắn', () => {
  // Ca ảnh user 27/10: xe 5 tấn, 2 đơn; đơn xếp SAU (giao trước, sát cửa) có 40 túi nhẹ (thùng
  // 310×130×130, chồng ≤ 8) — bản cũ: dựng thềm hụt → chất 5 cột × 8 lớp lên nóc từng chân
  const truck = { length: 5700, width: 2000, height: 2000 }
  const groups = [
    grp('SCU180', 'D2', 100, 420, 255, 130, { maxLayers: 11 }),
    grp('C100', 'D2', 120, 430, 250, 100, { maxLayers: 14 }),
    grp('ST180', 'D1', 150, 420, 255, 130, { maxLayers: 11 }),
    grp('ST110', 'D1', 160, 420, 255, 100, { maxLayers: 14 }),
    grp('TUI', 'D1', 40, 310, 130, 130, { maxLayers: 8, onTop: true }),
  ]

  it('hàng nhẹ KHÔNG dựng tháp: không chồng quá 3 lớp tại một chỗ, đỉnh ≤ khối nặng của đơn + 1 lớp', () => {
    const p = computeLoadPlan(truck, groups)
    expect(p.placedCount).toBe(p.totalCount)
    expect(overlaps(p.placed)).toBe(0)
    const light = p.placed.filter(b => b.group === 4)
    const perSpot = new Map<string, number>()
    for (const b of light) perSpot.set(`${b.x},${b.y}`, (perSpot.get(`${b.x},${b.y}`) ?? 0) + 1)
    expect(Math.max(...perSpot.values())).toBeLessThanOrEqual(3)
    const heavyTop = Math.max(...p.placed.filter(b => b.group === 2 || b.group === 3).map(b => b.z + b.h))
    expect(Math.max(...light.map(b => b.z + b.h))).toBeLessThanOrEqual(heavyTop + 130)
  })

  it('2 mã nhẹ cùng một đơn đều có chỗ (mã đầu không trải mỏng chiếm hết mặt — chuyến thật _559)', () => {
    const t = { length: 9200, width: 2350, height: 2400 }
    const gs = [
      grp('A', 'D1', 420, 420, 255, 100, { maxLayers: 14 }),
      grp('B', 'D1', 280, 420, 255, 100, { maxLayers: 14 }),
      grp('L1', 'D1', 216, 310, 130, 130, { maxLayers: 8, onTop: true }),
      grp('C', 'D1', 140, 420, 255, 100, { maxLayers: 14 }),
      grp('L2', 'D1', 216, 310, 130, 130, { maxLayers: 8, onTop: true }),
    ]
    const p = computeLoadPlan(t, gs)
    expect(p.placedCount).toBe(p.totalCount)
    expect(overlaps(p.placed)).toBe(0)
  })

  it('pallet gộp hàng lẻ CAO ĐỀU (không pallet lùn lẻ loi cạnh pallet cao)', () => {
    const spec: PalletSpec = { l: 1200, w: 1000, h: 1650, baseH: 150, baseColor: '#1d4ed8' }
    const r = palletizeGroups([
      { key: 'SCU', label: 'SCU', doKey: 'D2', doLabel: 'D2', cartons: 100, cartonsPerPallet: 110, isPalletCarrier: false, weightKg: 10, carton: { l: 420, w: 255, h: 130 } },
      { key: 'C100', label: 'C100', doKey: 'D2', doLabel: 'D2', cartons: 120, cartonsPerPallet: 143, isPalletCarrier: false, weightKg: 6, carton: { l: 430, w: 250, h: 100 } },
    ], spec)
    const hs = r.groups.filter(g => g.label.startsWith('Pallet gộp')).map(g => g.h)
    expect(hs.length).toBeGreaterThanOrEqual(2)
    expect(Math.max(...hs) / Math.min(...hs)).toBeLessThanOrEqual(1.3)
    for (const h of hs) expect(h).toBeLessThanOrEqual(spec.h)
  })

  it('levelFill: thùng cỡ lẻ (422×233) không chờm nhau, nằm trọn trên mặt đỡ phẳng', () => {
    const base: PlacedBox[] = []
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) base.push({ x: i * 255, y: j * 255, z: 0, l: 255, w: 255, h: 300, group: 0, step: 1 })
    const g = grp('X', 'D1', 30, 422, 233, 100, { onTop: true })
    const r = levelFill({ boxes: base, region: base.map(b => ({ x: b.x, y: b.y, l: b.l, w: b.w })), g, gi: 1, count: 30, capZ: 2000, stepStart: 1 })
    expect(r.placed.length + r.left).toBe(30)
    expect(overlaps([...base, ...r.placed])).toBe(0)
    for (const b of r.placed) {
      expect(b.x + b.l).toBeLessThanOrEqual(1020 + 10)
      expect(b.y + b.w).toBeLessThanOrEqual(1020 + 10)
      expect(b.z % 100).toBe(0)
    }
  })
})
