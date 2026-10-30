// HÌNH KHỐI sơ đồ xếp xe 3D (frontend/src/utils/loadPlan.ts) — user 27/10: "thạch túi xếp rất cao,
// hở… vuông vắn nhất có thể, hàng tựa vào nhau không đổ" (ảnh: hàng gửi thành tháp 8 lớp lẻ loi
// trên nóc + khe giữa các cột; pallet gộp lùn 0,45m đứng cạnh pallet 1,6m).
import { describe, it, expect } from 'vitest'
import {
  computeLoadPlan, palletizeGroups, levelFill, palletPattern, layerPattern,
  spreadToDoor, spreadTarget, packPallet, spacePallets, cartonsPerPalletEstimate, cartonsPerLayer,
  type LoadGroup, type PlacedBox, type PalletSpec, type PalletizeInput,
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

  // 28/10 (user: "pallet ghép hình khối rất tệ"; "200 túi hợp lý 1 pallet riêng") — thay luật 27/10
  // "chia từng lớp cho pallet thấp nhất" (mỗi mã xé lẻ ra mọi pallet gộp)
  const spec: PalletSpec = { l: 1200, w: 1000, h: 1650, baseH: 150, baseColor: '#1d4ed8' }
  const pin = (key: string, cartons: number, cpp: number, kg: number, carton: { l: number; w: number; h: number }, layers?: number) =>
    ({ key, label: key, doKey: 'D', doLabel: 'D', cartons, cartonsPerPallet: cpp, isPalletCarrier: false, weightKg: kg, carton, layers })
  const contiguous = (keys: string[]) => keys.every((k, i) => i === 0 || k === keys[i - 1] || !keys.slice(0, i).includes(k))

  it('mẫu xếp lớp NẰM GỌN trong chân pallet: 420×255 trên 1200×1000 — cắt chém 9, chong chóng 10, không chờm', () => {
    expect(palletPattern(1200, 1000, 420, 255)).toHaveLength(9)
    const p = layerPattern(1200, 1000, 420, 255)!
    expect(p).toHaveLength(10)
    for (const c of p) { expect(c.x).toBeGreaterThanOrEqual(0); expect(c.y).toBeGreaterThanOrEqual(0); expect(c.x + c.l).toBeLessThanOrEqual(1200); expect(c.y + c.w).toBeLessThanOrEqual(1000) }
    expect(overlaps(p.map(c => ({ ...c, z: 0, h: 1, group: 0, step: 0 })))).toBe(0)
  })

  // user 28/10: "110 thùng – 11 lớp ⇒ 1 lớp 10 thùng" (ảnh: Sữa 180 thành 13 lớp, vượt chiều cao quy định)
  it('pallet chẵn: thùng/lớp = quy cách ÷ số lớp, không quá số lớp khai; chân không chứa nổi ⇒ chờm mép, khối nới đúng phần chờm', () => {
    const r = palletizeGroups([pin('ST', 110, 110, 10, { l: 420, w: 255, h: 130 }, 11)], spec)
    expect(r.groups[0].h).toBe(150 + 11 * 130)
    expect(r.groups[0].contents!.map(c => c.n)).toEqual(Array(11).fill(10))
    expect([r.groups[0].l, r.groups[0].w]).toEqual([1200, 1000])
    // 430×250, 143 thùng / 14 lớp ⇒ 11/lớp × 13 lớp — 11 thùng không lọt chân 1200×1000 ⇒ chờm ≤ 60mm mỗi bên
    const c = palletizeGroups([pin('C100', 143, 143, 5.9, { l: 430, w: 250, h: 100 }, 14)], spec).groups[0]
    expect(c.contents!.length).toBe(13)
    expect(c.contents!.every(x => x.n === 11 && x.per === 11)).toBe(true)
    expect(c.l - 1200).toBeGreaterThan(0)
    expect(Math.max(c.l - 1200, c.w - 1000)).toBeLessThanOrEqual(120)
    const p = layerPattern(1200, 1000, 430, 250, 11)!
    expect(p).toHaveLength(11)
    expect(overlaps(p.map(s => ({ ...s, z: 0, h: 1, group: 0, step: 0 })))).toBe(0)
  })

  // user 28/10: "Sữa chua uống quy cách 110, đơn có 100 mà không xếp lên 1 pallet?" — bản cắt dãy lớp cho cao
  // đều để 100 thùng nằm 2 pallet, Sữa chua chai chui lên trên một phần của nó
  it('phần lẻ MỖI MÃ nằm nguyên MỘT pallet; gộp chỉ khi tổng ≤ trần', () => {
    const r = palletizeGroups([
      pin('SCU', 100, 110, 10.05, { l: 420, w: 255, h: 130 }, 11),
      pin('C100', 120, 143, 5.9, { l: 430, w: 250, h: 100 }, 14),
    ], spec)
    expect(r.palletCount).toBe(2)
    for (const g of r.groups) expect(new Set(g.contents!.map(c => c.key)).size).toBe(1)
    expect(r.groups.find(g => g.contents![0].key === 'SCU')!.contents!.reduce((s, c) => s + c.n, 0)).toBe(100)
  })

  it('phần lẻ DỒN pallet gộp ≤ trần; mã ghi NHẸ luôn nằm TRÊN CÙNG (kể cả nặng kg hơn)', () => {
    const r = palletizeGroups([
      { ...pin('C100', 57, 143, 5.9, { l: 430, w: 250, h: 100 }, 14) },
      { ...pin('TUI', 30, 216, 8, { l: 310, w: 130, h: 130 }, 8), onTop: true },   // nhẹ nhưng kg/thùng cao hơn
    ], spec)
    expect(r.palletCount).toBe(1)
    const g = r.groups[0]
    expect(g.h).toBeLessThanOrEqual(spec.h)
    const keys = g.contents!.map(c => c.key)
    expect(keys.indexOf('TUI')).toBeGreaterThan(keys.lastIndexOf('C100'))
  })

  // 28/10 tối: lớp lẻ (thiếu thùng) của mã dưới phải lấp phẳng bằng thùng mã trên — sữa 100mm thiếu 2 thùng dưới
  // thạch túi 130mm ⇒ lớp đó cao 130, pallet gộp tính cả phần này mới không vượt trần (bản trước 1,68m)
  it('pallet gộp tính lớp lẻ được lấp bằng thùng mã trên cao hơn — không vượt trần', () => {
    const items = [
      pin('ST180', 40, 110, 9.85, { l: 420, w: 255, h: 130 }, 11),    // 4 lớp đủ
      pin('ST110', 18, 140, 6.2, { l: 420, w: 255, h: 100 }, 14),     // 1 lớp đủ + 1 lớp thiếu 2 thùng
      { ...pin('TUI', 160, 216, 3.08, { l: 310, w: 130, h: 130 }, 8), onTop: true },   // 6 lớp
    ]
    const r = palletizeGroups(items, spec)
    for (const g of r.groups) expect(g.h).toBeLessThanOrEqual(spec.h)
    // 520 + 200 + 780 = 1500 đúng trần nếu lớp thiếu tính 100 — tính đúng 130 thì không gộp đủ cả ba
    expect(r.groups.some(g => new Set(g.contents?.map(c => c.key)).size === 3)).toBe(false)
  })

  it('bể riêng (remPool) ⇒ phần lẻ đứng pallet riêng, không trộn với bể chung', () => {
    const r = palletizeGroups([
      pin('C100', 57, 143, 5.9, { l: 430, w: 250, h: 100 }, 14),
      { ...pin('TUI', 200, 216, 3.08, { l: 310, w: 130, h: 130 }, 8), onTop: true, remPool: { key: 'light', label: 'hàng nhẹ' } },
    ], spec)
    expect(r.palletCount).toBe(2)
    for (const g of r.groups) expect(new Set(g.contents?.map(c => c.key)).size).toBe(1)
  })

  it('phần lẻ nhỏ dồn PALLET GỘP: nặng dưới nhẹ trên, mỗi mã nằm nguyên một pallet, các pallet cao gần đều', () => {
    const items = ['A', 'B', 'C', 'D', 'E', 'F'].map((k, i) => pin(k, 40, 110, 10 - i, { l: 420, w: 255, h: 130 }, 11))   // 4 lớp mỗi mã
    const r = palletizeGroups(items, spec)
    const gop = r.groups.filter(g => g.label.startsWith('Pallet gộp'))
    expect(gop.length).toBeGreaterThanOrEqual(2)
    const hs = gop.map(g => g.h)
    expect(Math.max(...hs) / Math.min(...hs)).toBeLessThanOrEqual(1.3)
    for (const g of gop) {
      expect(g.h).toBeLessThanOrEqual(spec.h)
      const keys = g.contents!.map(c => c.key)
      expect(contiguous(keys)).toBe(true)
      const kg = keys.map(k => 10 - 'ABCDEF'.indexOf(k))
      expect(kg.every((v, i) => i === 0 || v <= kg[i - 1])).toBe(true)   // nặng dưới
    }
    for (const k of 'ABCDEF') expect(r.groups.filter(g => g.contents?.some(c => c.key === k)).length).toBe(1)
    // tổng thùng trong ruột = tổng thùng
    expect(r.groups.reduce((s, g) => s + (g.contents ?? []).reduce((a, c) => a + c.n, 0) * g.count, 0)).toBe(240)
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

// Luật 11-13 (30/10 — chuyển từ MalCargo về lõi): trải sàn tới cửa · từng thùng trên pallet · khe pallet · ước thùng/pallet.
// Số liệu = 2 chuyến mẫu của MalCargo (container 40ft xếp xá; xe pallet 15 tấn 6 mã).
describe('loadPlan — luật 11-13 (trải tới cửa, thùng trên pallet, khe pallet, ước thùng/pallet)', () => {
  const PAL: PalletSpec = { l: 1200, w: 1000, h: 1650, baseH: 150, baseColor: '#a07a4e', weightKg: 25 }
  const minus = (n: number) => (b: { x: number; l: number }) => n - (b.x + b.l)

  it('bốc xá đủ tải ⇒ trải tới SÁT CỬA, không bỏ thùng, không chồng lấn (container 40ft, 94% tải)', () => {
    const truck = { length: 12032, width: 2352, height: 2393 }
    const gs = [
      grp('ST180', 'D1', 1350, 420, 255, 130, { maxLayers: 11 }),
      grp('ST110', 'D1', 1400, 420, 255, 100, { maxLayers: 28 }),   // chồng khi xếp xá 28 (pallet 14)
      grp('TUI', 'D1', 1600, 310, 130, 130, { maxLayers: 8, onTop: true }),
    ]
    const base = computeLoadPlan(truck, gs)
    const p = spreadToDoor(truck, gs, base, 94)
    const gap = Math.min(...p.placed.map(minus(truck.length)))
    expect(Math.min(...base.placed.map(minus(truck.length)))).toBeGreaterThan(255 * 1.5)   // trước: chừa khoảng ở cửa
    expect(gap).toBeLessThan(255 * 1.5)
    expect(p.placedCount).toBe(p.totalCount)
    expect(overlaps(p.placed)).toBe(0)
    // tải ít + sàn chưa tới 75% ⇒ để nguyên
    const few = [grp('ST180', 'D1', 150, 420, 255, 130, { maxLayers: 11 })]
    const b2 = computeLoadPlan(truck, few)
    expect(spreadToDoor(truck, few, b2, null)).toBe(b2)
    expect(spreadTarget(50, 0)).toBeCloseTo(58.8, 0)
    expect(spreadTarget(null, 80)).toBe(100)
  })

  // Đơn mẫu xe pallet: 6 mã, phần lẻ dồn pallet gộp, thạch túi (nhẹ) trên cùng
  const items: PalletizeInput[] = ([
    ['ST110', 740, 420, 255, 100, 140, 14, false], ['C100', 479, 430, 250, 100, 143, 14, false],
    ['C85', 612, 357, 276, 105, 143, 13, false], ['TH170', 40, 430, 250, 130, 100, 11, false],
    ['ST180', 140, 420, 255, 130, 110, 11, false], ['TUI', 472, 310, 130, 130, 216, 8, true],
  ] as const).map(([k, n, l, w, h, cpp, layers, onTop]) => ({
    key: `D1|${k}`, label: k, doKey: 'D1', doLabel: 'D1', cartons: n, cartonsPerPallet: cpp, layers, isPalletCarrier: false,
    weightKg: 5, carton: { l, w, h }, assumed: false, unitless: false, onTop,
  }))

  it('packPallet: đủ thùng, nằm trong khối, không chồng lấn, không thùng nào treo (đỡ ≥ 50% đáy), cột cùng mã ≤ số lớp', () => {
    const res = palletizeGroups(items, PAL)
    const light = new Set(items.filter(i => i.onTop).map(i => i.key))
    const cap = new Map(items.map(i => [i.key, i.layers!]))
    let mixed = 0
    for (const g of res.groups) {
      if (!g.contents) continue
      const { cartons } = packPallet(PAL, g.contents, light, cap)
      if (new Set(g.contents.map(c => c.key)).size > 1) mixed++
      expect(cartons.length).toBe(g.contents.reduce((s, c) => s + c.n, 0))
      for (const c of cartons) {
        expect(c.x).toBeGreaterThanOrEqual(-1); expect(c.y).toBeGreaterThanOrEqual(-1)
        expect(c.x + c.l).toBeLessThanOrEqual(g.l + 1); expect(c.y + c.w).toBeLessThanOrEqual(g.w + 1)
        expect(PAL.baseH + c.z + c.h).toBeLessThanOrEqual(PAL.h + 60)
      }
      const boxes = cartons.map(c => ({ ...c, group: 0, step: 0 }))
      expect(overlaps(boxes as PlacedBox[])).toBe(0)
      for (const c of cartons) {
        if (c.z === 0) continue
        const under = cartons.filter(d => d !== c && Math.abs(d.z + d.h - c.z) <= 35)
        const sup = under.reduce((s, d) => s + Math.max(0, Math.min(c.x + c.l, d.x + d.l) - Math.max(c.x, d.x)) * Math.max(0, Math.min(c.y + c.w, d.y + d.w) - Math.max(c.y, d.y)), 0)
        expect(sup / (c.l * c.w)).toBeGreaterThanOrEqual(light.has(c.key) ? 0.3 : 0.5)
      }
      // hàng nhẹ không nằm dưới hàng thường
      const topHeavy = Math.max(-1, ...cartons.filter(c => !light.has(c.key)).map(c => c.z))
      const lowLight = Math.min(Infinity, ...cartons.filter(c => light.has(c.key)).map(c => c.z))
      if (lowLight < Infinity) expect(lowLight).toBeGreaterThanOrEqual(topHeavy)
    }
    expect(mixed).toBeGreaterThan(0)   // có pallet gộp để kiểm
  })

  it('spacePallets: sàn thừa thành khe giữa các pallet — không chồng lấn, không ra ngoài thùng xe, không bớt pallet', () => {
    const truck = { length: 9500, width: 2500, height: 2600 }
    const res = palletizeGroups(items, PAL)
    const base = computeLoadPlan(truck, res.groups)
    const p = spacePallets(base)
    expect(p.placed.length).toBe(base.placed.length)
    expect(overlaps(p.placed)).toBe(0)
    for (const b of p.placed) {
      expect(b.x + b.l).toBeLessThanOrEqual(truck.length + 1)
      expect(b.y + b.w).toBeLessThanOrEqual(truck.width + 1)
    }
    const gaps = p.placed.filter(b => p.placed.some(a => a !== b && a.x + a.l <= b.x + 1 && a.x + a.l > b.x - 100 && Math.min(a.y + a.w, b.y + b.w) > Math.max(a.y, b.y)))
      .map(b => Math.min(...p.placed.filter(a => a !== b && a.x + a.l <= b.x + 1 && Math.min(a.y + a.w, b.y + b.w) > Math.max(a.y, b.y)).map(a => b.x - a.x - a.l)))
    expect(Math.max(...gaps)).toBeGreaterThan(0)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(80 + 1)
  })

  it('cartonsPerPalletEstimate: mã chưa khai thùng/pallet ⇒ gọn trong chân × số lớp vừa trần (≤ số lớp khai)', () => {
    const per = cartonsPerLayer(PAL, { l: 420, w: 255 })
    expect(cartonsPerPalletEstimate(PAL, { l: 420, w: 255, h: 130 }, null)).toBe(per * 11)   // 1500 ÷ 130 = 11 lớp
    expect(cartonsPerPalletEstimate(PAL, { l: 420, w: 255, h: 130 }, 6)).toBe(per * 6)
    expect(cartonsPerPalletEstimate(PAL, { l: 1500, w: 1300, h: 130 }, null)).toBeNull()      // không nằm nổi trên chân
  })
})
