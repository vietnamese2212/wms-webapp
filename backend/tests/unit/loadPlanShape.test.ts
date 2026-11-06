// HÌNH KHỐI sơ đồ xếp xe 3D (frontend/src/utils/loadPlan.ts) — user 27/10: "thạch túi xếp rất cao,
// hở… vuông vắn nhất có thể, hàng tựa vào nhau không đổ" (ảnh: hàng gửi thành tháp 8 lớp lẻ loi
// trên nóc + khe giữa các cột; pallet gộp lùn 0,45m đứng cạnh pallet 1,6m).
import { describe, it, expect } from 'vitest'
import {
  computeLoadPlan, palletizeGroups, levelFill, palletPattern, layerPattern,
  spreadToDoor, spreadTarget, packPallet, placePallets, palletFloorSlots, PALLET_GAP, cartonsPerPalletEstimate, cartonsPerLayer,
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
describe('loadPlan — luật 11-14 (trải tới cửa, thùng trên pallet, ước thùng/pallet, khe pallet 5 cm)', () => {
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

  // User 06/11 (ảnh container 3.700 thùng): 'hàng nhẹ lẽ ra lên hàng đầu, nhiều lớp, nằm trên hàng khác' — lõi đã gom đúng,
  // bước trải tới cửa chạy lại với ít lớp hơn thì lõi lùi về trải phẳng (hàng gửi dài 8,6 m)
  it('trải tới cửa KHÔNG làm tan khối hàng gửi đã gom ở đầu xe (container 40ft, 92% tải)', () => {
    const truck = { length: 12032, width: 2352, height: 2393 }
    const gs = [
      grp('A180', 'D1', 1450, 425, 260, 145, { maxLayers: 15 }),
      grp('A110', 'D1', 1500, 425, 240, 105, { maxLayers: 20 }),
      grp('NHE', 'D1', 600, 315, 140, 135, { maxLayers: 11, onTop: true }),
      grp('LY', 'D1', 150, 360, 250, 265, { maxLayers: 5 }),
    ]
    const p = spreadToDoor(truck, gs, computeLoadPlan(truck, gs), 92)
    const li = p.groups.findIndex(g => g.onTop), light = p.placed.filter(b => b.group === li)
    const x0 = Math.min(...light.map(b => b.x)), x1 = Math.max(...light.map(b => b.x + b.l))
    expect(x0).toBeLessThan(100)                                      // ngay đầu xe
    expect(x1 - x0).toBeLessThanOrEqual(3000)                         // gom gọn, không trải dọc xe
    expect(Math.min(...light.map(b => b.z))).toBeGreaterThan(0)       // nằm trên hàng khác
    const cols = new Map<string, number>()
    for (const b of light) cols.set(b.x + '|' + b.y, (cols.get(b.x + '|' + b.y) ?? 0) + 1)
    expect(Math.max(...cols.values())).toBeGreaterThanOrEqual(5)      // nhiều lớp
    expect(p.placedCount).toBe(p.totalCount)
    expect(Math.min(...p.placed.map(minus(truck.length)))).toBeLessThan(240 * 1.5)   // vẫn tới sát cửa
    expect(overlaps(p.placed)).toBe(0)
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

  // xe pallet: chia làn tối ưu, khoảng cách `gap` giữa hai pallet kề nhau cả dọc lẫn ngang; không chồng lấn, trong lòng xe;
  // làn ép sát hai vách (bề ngang thừa thành rãnh giữa), một làn thì đặt giữa
  const palletShape = (p: ReturnType<typeof placePallets>, truck: { length: number; width: number }, gap = PALLET_GAP) => {
    expect(overlaps(p.placed)).toBe(0)
    for (const b of p.placed) {
      expect(b.z).toBe(0)
      expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.l).toBeLessThanOrEqual(truck.length)
      expect(b.y + b.w).toBeLessThanOrEqual(truck.width)
    }
    // hai pallet đứng cạnh nhau (chung một đoạn dọc xe) cách ≥ khoảng cách theo bề ngang; nối nhau trong làn — theo chiều dọc
    for (const a of p.placed) for (const b of p.placed) {
      if (a === b) continue
      const ovX = Math.min(a.x + a.l, b.x + b.l) - Math.max(a.x, b.x), ovY = Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y)
      if (ovX > 1) expect(Math.max(b.y - a.y - a.w, a.y - b.y - b.w)).toBeGreaterThanOrEqual(gap)
      if (ovY > 1) expect(Math.max(b.x - a.x - a.l, a.x - b.x - b.l)).toBeGreaterThanOrEqual(gap)
    }
    const y0 = Math.min(...p.placed.map(b => b.y)), y1 = Math.max(...p.placed.map(b => b.y + b.w))
    if (new Set(p.placed.map(b => b.y)).size > 1) { expect(y0).toBe(0); expect(y1).toBe(truck.width) }
    else expect(Math.abs(y0 - (truck.width - y1))).toBeLessThanOrEqual(1)
  }
  const fullPallets = (n: number) => palletizeGroups([{ key: 'D1|A', label: 'A', doKey: 'D1', doLabel: 'D1', cartons: 110 * n, cartonsPerPallet: 110, layers: 11,
    isPalletCarrier: false, weightKg: 5, carton: { l: 420, w: 255, h: 130 }, assumed: false, unitless: false, onTop: false }], PAL).groups
  const lanesOf = (p: ReturnType<typeof placePallets>) => {
    const m = new Map<number, typeof p.placed>()
    for (const b of p.placed) { const k = [...m.keys()].find(y => Math.abs(y - b.y) < 300) ?? b.y; m.set(k, [...(m.get(k) ?? []), b]) }
    return [...m.values()]
  }

  it('placePallets: chia làn NHIỀU PALLET NHẤT — xếp sát 9,6 × 2,35 m: 9 quay ngang + 8 quay dọc = 17, rãnh giữa 15 cm', () => {
    // [dài, rộng, khoảng cách, số pallet]
    for (const [L, W, g, n] of [[9600, 2350, 0, 17], [9600, 2400, 0, 18], [9500, 2500, 0, 18], [7400, 2350, 0, 13],
      [9600, 2400, 5, 16], [9600, 2350, 5, 16], [9640, 2400, 5, 17], [9500, 2500, 5, 18], [7400, 2350, 5, 13]] as const) {
      const truck = { length: L, width: W, height: 2600 }
      const p = placePallets(truck, fullPallets(24), g)
      expect(p.placedCount).toBe(n)
      expect(palletFloorSlots(PAL, truck, g)).toBe(n)
      palletShape(p, truck, g)
    }
    // 9,6 × 2,35 xếp sát: làn chân 1,0 m dọc xe 9 pallet ép vách trái, làn chân 1,2 m dọc xe 8 pallet (vừa khít 9,6 m) ép
    // vách phải; rãnh giữa = 2,35 − 1,2 − 1,0 = 0,15 m
    const p = placePallets({ length: 9600, width: 2350, height: 2600 }, fullPallets(24))
    const ls = lanesOf(p)
    expect(ls.map(l => `${l.length}×${l[0].l}`).sort()).toEqual(['8×1200', '9×1000'])
    for (const l of ls) l.sort((a, b) => a.x - b.x).forEach((b, i) => expect(b.x).toBe(i * b.l))
    const [a, b] = ls.sort((u, v) => u[0].y - v[0].y)
    expect(b[0].y - (a[0].y + a[0].w)).toBe(150)
    // khoảng cách 5 mm: làn 1,2 m dọc xe chỉ còn 7 (8 × 1,2 + 7 × 0,005 = 9,635 m), pallet trong làn cách đúng 5 mm
    const q = placePallets({ length: 9600, width: 2400, height: 2600 }, fullPallets(24), 5)
    const qs = lanesOf(q)
    expect(qs.map(l => `${l.length}×${l[0].l}`).sort()).toEqual(['7×1200', '9×1000'])
    for (const l of qs) l.sort((u, v) => u.x - v.x).forEach((u, i) => expect(u.x).toBe(i * (u.l + 5)))
  })

  it('placePallets: đơn mẫu 6 mã (17 pallet, có pallet chờm mép) vừa xe 9,6 × 2,35 m xếp sát, đơn đầu nằm phía cabin', () => {
    const truck = { length: 9600, width: 2350, height: 2600 }
    const res = palletizeGroups(items, PAL)
    expect(res.palletCount).toBe(17)
    const p = placePallets(truck, res.groups)
    expect(p.placedCount).toBe(17)
    palletShape(p, truck)
    expect(placePallets(truck, res.groups, 5).placedCount).toBe(16)
    expect(placePallets({ ...truck, length: 9640 }, res.groups, 5).placedCount).toBe(17)
    // hai đơn: đơn đầu (D1) trước, đơn sau (D2) ra phía cửa
    const two = [...res.groups, ...fullPallets(3).map(g => ({ ...g, key: 'D2|A|full', doKey: 'D2', doLabel: 'D2' }))]
    const q = placePallets({ length: 12000, width: 2350, height: 2600 }, two)
    const xs = (d: string) => q.placed.filter(b => two[b.group].doKey === d).map(b => b.x)
    expect(Math.min(...xs('D2'))).toBeGreaterThanOrEqual(Math.max(...xs('D1')) - 1300)
    expect(Math.max(...xs('D2'))).toBeGreaterThan(Math.max(...xs('D1')))
  })

  it('cartonsPerPalletEstimate: mã chưa khai thùng/pallet ⇒ gọn trong chân × số lớp vừa trần (≤ số lớp khai)', () => {
    const per = cartonsPerLayer(PAL, { l: 420, w: 255 })
    expect(cartonsPerPalletEstimate(PAL, { l: 420, w: 255, h: 130 }, null)).toBe(per * 11)   // 1500 ÷ 130 = 11 lớp
    expect(cartonsPerPalletEstimate(PAL, { l: 420, w: 255, h: 130 }, 6)).toBe(per * 6)
    expect(cartonsPerPalletEstimate(PAL, { l: 1500, w: 1300, h: 130 }, null)).toBeNull()      // không nằm nổi trên chân
  })
})

// Luật 15 (user 04/11, ảnh xe 9,6 m): 2 mã gửi trên khối nền đầu chỉ 40 thùng — bản cũ: xúc xích đè lên túi thành
// tháp 2,5 m ở cabin, phần dư văng sang nóc khối sát cửa. "Xếp phía trên thì không được nằm 2 đầu xe".
describe('loadPlan — luật 15 (hàng gửi một dải liền)', () => {
  const truck = { length: 9600, width: 2350, height: 2600 }
  const gs = [
    grp('ST110', 'D1', 740, 420, 255, 100, { maxLayers: 28 }),
    grp('C85', 'D1', 612, 357, 276, 105, { maxLayers: 13 }),
    grp('TH170', 'D1', 40, 430, 250, 130, { maxLayers: 11 }),
    grp('ST180', 'D1', 140, 420, 255, 130, { maxLayers: 11 }),
    grp('TUI', 'D1', 472, 310, 130, 130, { maxLayers: 8, onTop: true }),
    grp('XX', 'D1', 190, 342, 259, 226, { maxLayers: 6, onTop: true }),
  ]
  const p = computeLoadPlan(truck, gs)
  const light = gs.map((g, i) => ({ g, i })).filter(x => x.g.onTop).map(x => p.placed.filter(b => b.group === x.i))
  const heavy = p.placed.filter(b => !gs[b.group].onTop)

  it('chở hết, không chồng lấn, mã gửi không thành tháp', () => {
    expect(p.placedCount).toBe(p.totalCount)
    expect(overlaps(p.placed)).toBe(0)
    const top = Math.max(...p.placed.map(b => b.z + b.h)), body = Math.max(...heavy.map(b => b.z + b.h))
    expect(top - body).toBeLessThanOrEqual(400)
  })

  it('mỗi mã gửi MỘT khối, hai mã liền nhau — không nằm hai đầu xe, không đè nhau', () => {
    const spans = light.map(bs => {
      const seg = bs.map(b => [b.x, b.x + b.l]).sort((a, c) => a[0] - c[0])
      let end = seg[0][1]
      for (const [s0, e] of seg) { expect(s0 - end).toBeLessThanOrEqual(700); end = Math.max(end, e) }
      return [seg[0][0], end]
    }).sort((a, c) => a[0] - c[0])
    expect(spans[1][0] - spans[0][1]).toBeLessThanOrEqual(700)
    const [a, c] = light
    const onTopOf = (x: PlacedBox, y: PlacedBox) => Math.abs(x.z - (y.z + y.h)) < 1 && x.x < y.x + y.l && x.x + x.l > y.x && x.y < y.y + y.w && x.y + x.w > y.y
    expect(a.some(x => c.some(y => onTopOf(x, y) || onTopOf(y, x)))).toBe(false)
  })

  it('luật 17-18: mã gửi đầu gom gọn sát cabin, không trải khắp xe', () => {
    const tui = light[0]
    const span = Math.max(...tui.map(b => b.x + b.l)) - Math.min(...tui.map(b => b.x))
    const high = Math.max(...tui.map(b => b.z + b.h)) - Math.min(...tui.map(b => b.z))
    expect(Math.min(...tui.map(b => b.x))).toBeLessThanOrEqual(50)
    expect(span).toBeLessThanOrEqual(2400)
    expect(high).toBeGreaterThanOrEqual(600)
  })

  it('luật 16: một chân một loại hàng — hai mã cùng cỡ thành hai khối, hàng thường không nằm trên mã khác', () => {
    const gs2 = [grp('A', 'D1', 300, 420, 255, 130, { maxLayers: 11 }), grp('B', 'D1', 305, 420, 255, 130, { maxLayers: 11 }), grp('C', 'D1', 200, 430, 250, 100, { maxLayers: 14 })]
    const r = computeLoadPlan({ length: 7400, width: 2350, height: 2150 }, gs2)
    expect(r.placedCount).toBe(r.totalCount)
    for (const a of r.placed) for (const c of r.placed) {
      if (a.group === c.group) continue
      const ix = Math.min(a.x + a.l, c.x + c.l) - Math.max(a.x, c.x), iy = Math.min(a.y + a.w, c.y + c.w) - Math.max(a.y, c.y)
      expect(ix > 20 && iy > 20).toBe(false)
    }
  })

  it('xe chật: không chở kém cách cũ — hàng gửi vẫn đặt được hết khi có chỗ', () => {
    const small = { length: 5700, width: 2000, height: 2000 }
    const tight = [grp('A', 'D1', 370, 420, 255, 130, { maxLayers: 11 }), grp('B', 'D1', 370, 420, 255, 100, { maxLayers: 14 }), grp('T', 'D1', 75, 310, 130, 130, { maxLayers: 8, onTop: true }), grp('X', 'D1', 30, 342, 259, 226, { maxLayers: 6, onTop: true })]
    const r = computeLoadPlan(small, tight)
    expect(r.placedCount).toBe(r.totalCount)
    expect(overlaps(r.placed)).toBe(0)
  })
})

// Luật 18 (user 05/11, ảnh 2 chuyến xe 9,6 m): "còn nhiều khoảng hở; có quyền quay ngang, dọc, miễn hàng nào ngang thì cả hàng ngang";
// mã ít thùng từng thành tháp giữa xe; Túi 8 lớp trên thạch 1-2 lớp thành tháp hàng nhẹ.
describe('loadPlan — luật 18 (mỗi hàng ngang một hướng)', () => {
  const truck = { length: 9600, width: 2350, height: 2600 }
  const heavyOf = (gs: LoadGroup[], p: ReturnType<typeof computeLoadPlan>) => p.placed.filter(b => !gs[b.group].onTop)
  const uniformRows = (gs: LoadGroup[], p: ReturnType<typeof computeLoadPlan>) => {
    gs.forEach((g, gi) => {
      if (g.onTop) return
      // luật 20: một hướng hở vách quá 10 cm thì được trộn — không xét ở đây (C85 trên xe 2,35 m hở 14 cm)
      if (Math.min(truck.width % g.l, truck.width % g.w) > 100) return
      const rows = new Map<number, Set<number>>()
      for (const b of p.placed) if (b.group === gi && b.z === 0) { if (!rows.has(b.x)) rows.set(b.x, new Set()); rows.get(b.x)!.add(b.l) }
      for (const v of rows.values()) expect(v.size).toBe(1)
    })
  }
  const a = [
    grp('ST110', 'D1', 740, 420, 255, 100, { maxLayers: 28 }), grp('C85', 'D1', 612, 357, 276, 105, { maxLayers: 13 }),
    grp('TH170', 'D1', 20, 430, 250, 130, { maxLayers: 11 }), grp('ST180', 'D1', 140, 420, 255, 130, { maxLayers: 11 }),
    grp('TUI', 'D1', 472, 310, 130, 130, { maxLayers: 8, onTop: true }), grp('XX', 'D1', 200, 342, 259, 226, { maxLayers: 6, onTop: true }),
  ]
  const b = [
    grp('ST110', 'D1', 740, 420, 255, 100, { maxLayers: 28 }), grp('TH100', 'D1', 479, 430, 250, 100, { maxLayers: 28 }),
    grp('C85', 'D1', 612, 357, 276, 105, { maxLayers: 13 }), grp('TH170', 'D1', 40, 430, 250, 130, { maxLayers: 11 }),
    grp('ST180', 'D1', 140, 420, 255, 130, { maxLayers: 11 }), grp('TUI', 'D1', 472, 310, 130, 130, { maxLayers: 8, onTop: true }),
  ]
  const pa = computeLoadPlan(truck, a), pb = computeLoadPlan(truck, b)

  it('chở hết, không chồng lấn, mỗi hàng ngang của mã đứng sàn chỉ một hướng', () => {
    for (const [gs, p] of [[a, pa], [b, pb]] as const) {
      expect(p.placedCount).toBe(p.totalCount)
      expect(overlaps(p.placed)).toBe(0)
      uniformRows(gs, p)
    }
  })

  it('mã ít thùng nằm thấp sát cửa, không thành tháp giữa xe', () => {
    for (const [gs, p] of [[a, pa], [b, pb]] as const) {
      const gi = gs.findIndex(g => g.key.endsWith('TH170') || g.label === 'TH170')
      const bs = p.placed.filter(x => x.group === gi)
      expect(Math.max(...bs.map(x => x.z + x.h))).toBeLessThanOrEqual(700)
      const door = Math.max(...heavyOf(gs, p).map(x => x.x + x.l))
      expect(Math.max(...bs.map(x => x.x + x.l))).toBe(door)
    }
  })

  it('hàng nhẹ không thành tháp: nền đủ dày, đỉnh gần thân hàng', () => {
    const gi = b.findIndex(g => g.onTop), bs = pb.placed.filter(x => x.group === gi)
    const z0 = Math.min(...bs.map(x => x.z)), z1 = Math.max(...bs.map(x => x.z + x.h))
    expect(z0).toBeGreaterThanOrEqual(0.5 * (z1 - z0))
    expect(z1).toBeLessThanOrEqual(1500)
    expect(z1 - Math.max(...heavyOf(b, pb).map(x => x.z + x.h))).toBeLessThanOrEqual(400)
  })
})

// Luật 19-20 (user 05/11): "hở rộng quá không được"; "phần tiếp giáp 2 đơn đè lên nhau được"; hàng nhẹ nhiều hơn nặng đứng sàn; thứ tự khối tự tìm.
describe('loadPlan — luật 19-20', () => {
  const truck = { length: 9200, width: 2350, height: 2400 }
  // user 06/11, chuyến thật xe rộng 1,9 m: 420×255 một hướng hở 11,5 cm "không hợp lý" ⇒ 2 dài + 4 hẹp còn hở 4 cm
  it('hở vách quá 10 cm mà trộn hướng sát hơn thì trộn (xe rộng 1,9 m)', () => {
    const t = { length: 4300, width: 1900, height: 1900 }
    const p = computeLoadPlan(t, [grp('ST110', 'D1', 300, 420, 255, 100, { maxLayers: 14 })])
    expect(p.placedCount).toBe(p.totalCount)
    expect(overlaps(p.placed)).toBe(0)
    const floor = p.placed.filter(b => !b.z)
    expect(new Set(floor.map(b => b.l)).size).toBe(2)
    expect(t.width - Math.max(...floor.map(b => b.y + b.w))).toBeLessThanOrEqual(40)
  })
  it('hở vách quá 10 cm mà trộn hướng sát hơn thì trộn', () => {
    const p = computeLoadPlan(truck, [grp('TO', 'D1', 250, 600, 400, 300, { maxLayers: 6 }), grp('NHO', 'D1', 900, 200, 150, 100, { maxLayers: 18 })])
    expect(p.placedCount).toBe(p.totalCount)
    expect(overlaps(p.placed)).toBe(0)
    const to = p.placed.filter(b => b.group === 0 && !b.z)
    expect(truck.width - Math.max(...to.map(b => b.y + b.w))).toBeLessThanOrEqual(200)
    expect(new Set(to.map(b => b.l)).size).toBe(2)
  })
  it('hở vách không quá 10 cm thì không trộn hướng', () => {
    const p = computeLoadPlan(truck, [grp('ST110', 'D1', 700, 420, 255, 100, { maxLayers: 14 })])   // 9 × 255 hở 5,5 cm
    const rows = new Map<number, Set<number>>()
    for (const b of p.placed) if (!b.z) { if (!rows.has(b.x)) rows.set(b.x, new Set()); rows.get(b.x)!.add(b.l) }
    for (const v of rows.values()) expect(v.size).toBe(1)
  })
  it('đơn sau đè lên hàng thấp cuối đơn trước, không để lõm', () => {
    const t8 = { length: 7400, width: 2350, height: 2150 }
    const gs = [grp('ST110', 'D1', 180, 420, 255, 100, { maxLayers: 28 }), grp('TH170', 'D1', 8, 430, 250, 130, { maxLayers: 11 }), grp('C85', 'D2', 150, 357, 276, 105, { maxLayers: 13 }), grp('ST180', 'D2', 10, 420, 255, 130, { maxLayers: 11 })]
    const p = computeLoadPlan(t8, gs)
    expect(p.placedCount).toBe(p.totalCount)
    expect(overlaps(p.placed)).toBe(0)
    const low = p.placed.filter(b => b.group === 1), onTop = p.placed.filter(b => b.group === 2 && b.z > 0 && low.some(l => Math.min(l.x + l.l, b.x + b.l) - Math.max(l.x, b.x) > 20 && Math.min(l.y + l.w, b.y + b.w) - Math.max(l.y, b.y) > 20))
    expect(onTop.length).toBeGreaterThan(0)
  })
  it('hàng nhẹ nhiều hơn hàng nặng: mã nhẹ lớn nhất đứng sàn, không tháp', () => {
    const t8 = { length: 7400, width: 2350, height: 2150 }
    const p = computeLoadPlan(t8, [grp('ST110', 'D1', 200, 420, 255, 100, { maxLayers: 28 }), grp('TUI', 'D1', 700, 310, 130, 130, { maxLayers: 8, onTop: true }), grp('XX', 'D1', 200, 342, 259, 226, { maxLayers: 6, onTop: true }), grp('NL', 'D1', 30, 600, 500, 400, { maxLayers: 4, onTop: true })])
    expect(p.placedCount).toBe(p.totalCount)
    expect(p.placed.some(b => (b.group === 2 || b.group === 3) && !b.z)).toBe(true)
    expect(Math.max(...p.placed.map(b => b.z + b.h))).toBeLessThanOrEqual(1600)
  })
})
