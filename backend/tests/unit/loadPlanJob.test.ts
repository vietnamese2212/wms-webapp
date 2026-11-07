// Phần TÍNH của màn Xếp xe 3D (chạy nền) — frontend/src/components/wms/loadplan3d/planJob.ts.
// User 07/11 (MalCargo): "thay đổi config thì hiện ra rất chậm"; SUPPLYC đo chuyến 3.700 thùng: mỗi tin quét khoá màn 2,7 giây.
import { describe, it, expect } from 'vitest'
import {
  planDraft, progressDraft, withProgress, withoutScan, hasBaseIn,
  type PlanGroup, type PlanInput,
} from '../../../frontend/src/components/wms/loadplan3d/planJob'
import { DEFAULT_PALLET } from '../../../frontend/src/utils/loadPlan'

const TRUCK = { length: 9600, width: 2350, height: 2600 }
const grp = (code: string, count: number, extra: Partial<PlanGroup> = {}): PlanGroup => ({
  key: `D1|${code}`, label: code, doKey: 'D1', doLabel: 'D1', count, done: 0,
  l: 425, w: 240, h: 105, weightKg: 6, assumed: false, maxLayers: 14, onTop: false,
  cpp: 140, isPallet: false, category: 'FG01', qty: count, qtyDone: 0, qtyUnit: 'thùng', ...extra,
})
const input = (groups: PlanGroup[], extra: Partial<PlanInput> = {}): PlanInput => ({
  groups, pallet: false, spec: null, place: {}, lightOwnLoose: false, truck: TRUCK, payloadKg: null, ...extra,
})

describe('Dự toán không tính lại khi có tin quét', () => {
  it('đầu vào giống hệt dù số đã quét khác nhau', () => {
    const chua = [grp('A', 300), grp('B', 200)]
    const roi = [grp('A', 300, { done: 150, qtyDone: 150, firstScanAt: '2026-11-07T01:00:00Z' }), grp('B', 200, { done: 20, qtyDone: 20, firstScanAt: '2026-11-07T02:00:00Z' })]
    expect(JSON.stringify(roi.map(withoutScan))).toBe(JSON.stringify(chua.map(withoutScan)))
  })

  it('xe thường: phần đã xuất theo đúng mã, sơ đồ không đổi', () => {
    const out = planDraft(input([grp('A', 300), grp('B', 200)].map(withoutScan)))
    const shown = withProgress(out, [grp('A', 300, { done: 150, qtyDone: 150 }), grp('B', 200)])
    expect(out.plan!.placedCount).toBe(500)
    expect(shown.map(g => [g.key, g.done, g.qtyDone])).toEqual([['D1|A', 150, 150], ['D1|B', 0, 0]])
  })

  it('xe pallet: pallet nguyên theo tỷ lệ của mã, pallet gộp nhiều mã không quy được ⇒ 0', () => {
    const src = [grp('A', 300), grp('B', 30)]
    const out = planDraft(input(src.map(withoutScan), { pallet: true, spec: DEFAULT_PALLET }))
    const shown = withProgress(out, [grp('A', 300, { done: 150, qtyDone: 150 }), grp('B', 30, { done: 30, qtyDone: 30 })])
    const full = shown.find(g => g.key === 'D1|A|full')!
    expect(full.count).toBe(2)
    expect(full.done).toBe(1)   // 150/300 của 2 pallet
    for (const g of shown.filter(g => g.contents && new Set(g.contents.map(c => c.key)).size > 1)) expect(g.done).toBe(0)
  })
})

describe('Sơ đồ + nhóm đi cùng nhau', () => {
  it('chỉ số nhóm của từng khối trỏ đúng mảng nhóm trả về (cả thùng "Lên nóc" trên xe pallet)', () => {
    const src = [grp('A', 300), grp('N', 40, { category: 'FG02' })]
    const out = planDraft(input(src, { pallet: true, spec: DEFAULT_PALLET, place: { FG02: 'ON_TOP' } }))
    expect(out.groups.filter(g => g.topCarton).map(g => g.key)).toEqual(['D1|N'])
    expect(out.plan!.placed.length).toBeGreaterThan(0)
    for (const b of out.plan!.placed) expect(out.groups[b.group]).toBeDefined()
    expect(out.plan!.placed.some(b => out.groups[b.group].topCarton)).toBe(true)
  })

  it('chưa khai xe: không có sơ đồ nhưng vẫn kể số pallet', () => {
    const out = planDraft(input([grp('A', 300)], { pallet: true, spec: DEFAULT_PALLET, truck: null }))
    expect(out.plan).toBeNull()
    expect(out.palletized!.palletCount).toBe(3)
    expect(out.groups.length).toBeGreaterThan(0)
  })

  it('toàn hàng "Lên nóc", không có nền ⇒ tự đứng pallet, không trống trơn', () => {
    const src = [grp('N', 300, { category: 'FG02' })]
    const place = { FG02: 'ON_TOP' as const }
    expect(hasBaseIn(src, place)).toBe(false)
    const out = planDraft(input(src, { pallet: true, spec: DEFAULT_PALLET, place }))
    expect(out.groups.every(g => !g.topCarton)).toBe(true)
    expect(out.plan!.placedCount).toBeGreaterThan(0)
  })
})

describe('Tiến độ xếp theo trình tự quét thật', () => {
  it('chỉ phần đã quét, mã quét trước nằm phía cabin', () => {
    const sau = grp('A', 300, { done: 100, firstScanAt: '2026-11-07T02:00:00Z' })
    const truoc = grp('B', 200, { done: 80, firstScanAt: '2026-11-07T01:00:00Z' })
    const out = progressDraft(input([sau, truoc, grp('C', 50)]))!
    expect(out.groups.map(g => [g.key, g.count])).toEqual([['D1|B', 80], ['D1|A', 100]])
    expect(out.plan.placedCount).toBe(180)
    const minX = (i: number) => Math.min(...out.plan.placed.filter(b => b.group === i).map(b => b.x))
    expect(minX(0)).toBeLessThan(minX(1))
  })

  it('chưa quét gì / chưa có xe ⇒ không có sơ đồ', () => {
    expect(progressDraft(input([grp('A', 300)]))).toBeNull()
    expect(progressDraft(input([grp('A', 300, { done: 10 })], { truck: null }))).toBeNull()
  })
})
