// Phép tính của giao diện tab KPI (frontend/src/utils/kpiView.ts, 11/2026): xếp hạng lệch mục tiêu, so hai kỳ gần nhất,
// không nối đường qua kỳ thiếu số, đường cong không vẽ ra đỉnh/đáy không có trong dữ liệu.
import { describe, expect, it } from 'vitest'
import { kpiGap, lastDelta, monotonePath, runsOf, squarify } from '../../../frontend/src/utils/kpiView'

describe('kpiGap', () => {
  it('chưa đo được hoặc chưa đặt mục tiêu = null, không phải "đạt"', () => {
    expect(kpiGap('up', null, [98, 96])).toBeNull()
    expect(kpiGap('up', 90, null)).toBeNull()
  })
  it('cao hơn là tốt: đạt thì gap 0, thiếu thì đo tới ngưỡng ĐẠT', () => {
    expect(kpiGap('up', 98, [98, 96])).toEqual({ gap: 0, rel: 0, side: null })
    const g = kpiGap('up', 88, [98, 96])!
    expect(g.side).toBe('short'); expect(g.gap).toBe(10); expect(g.rel).toBeCloseTo(10 / 98)
  })
  it('thấp hơn là tốt: vượt ngưỡng mới lệch', () => {
    expect(kpiGap('down', 60, [60, 90])!.gap).toBe(0)
    const g = kpiGap('down', 90, [60, 90])!
    expect(g.side).toBe('over'); expect(g.gap).toBe(30); expect(g.rel).toBe(0.5)
  })
  it('dải: lệch cả hai phía, trong dải là đạt', () => {
    expect(kpiGap('band', 80, [75, 85, 90])!.gap).toBe(0)
    expect(kpiGap('band', 70, [75, 85, 90])!.side).toBe('short')
    expect(kpiGap('band', 88, [75, 85, 90])!.side).toBe('over')
  })
  it('ngưỡng 0 không chia cho 0', () => {
    expect(Number.isFinite(kpiGap('down', 1, [0, 1])!.rel)).toBe(true)
  })
})

describe('lastDelta', () => {
  const p = (label: string, value: number | null) => ({ label, value })
  it('chưa đủ hai kỳ có số = null', () => {
    expect(lastDelta([p('a', null), p('b', 5)])).toBeNull()
  })
  it('bỏ qua kỳ trống ở giữa và ở cuối', () => {
    const d = lastDelta([p('a', 4), p('b', null), p('c', 7), p('d', null)])!
    expect(d.delta).toBe(3); expect(d.prevLabel).toBe('a'); expect(d.label).toBe('c')
  })
  it('số 0 là số thật, không phải kỳ trống', () => {
    expect(lastDelta([p('a', 0), p('b', 2)])!.delta).toBe(2)
  })
})

describe('runsOf', () => {
  it('kỳ thiếu số cắt đường thành hai đoạn', () => {
    expect(runsOf([1, 2, null, 3, null], v => v != null)).toEqual([[1, 2], [3]])
  })
})

describe('monotonePath', () => {
  /** Lấy mọi toạ độ y (cả điểm điều khiển) trong path */
  const ys = (d: string) => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => Number(m[2]))
  it('không có điểm thì không vẽ, một điểm thì chỉ MoveTo', () => {
    expect(monotonePath([])).toBe('')
    expect(monotonePath([{ x: 1, y: 2 }])).toBe('M1.0,2.0')
  })
  it('không vượt khỏi miền giá trị thật — dữ liệu răng cưa không sinh đỉnh giả', () => {
    const pts = [0, 40, 10, 90, 5, 60, 60, 20].map((y, i) => ({ x: i * 30, y }))
    for (const y of ys(monotonePath(pts))) { expect(y).toBeGreaterThanOrEqual(-0.05); expect(y).toBeLessThanOrEqual(90.05) }
  })
  it('dòng phẳng giữ phẳng', () => {
    for (const y of ys(monotonePath([0, 1, 2, 3].map(i => ({ x: i * 10, y: 7 }))))) expect(y).toBe(7)
  })
})

describe('squarify', () => {
  const W = 150, H = 100
  const items = [60, 25, 8, 4, 2, 1].map((value, i) => ({ key: `k${i}`, value }))
  const total = items.reduce((s, i) => s + i.value, 0)

  it('diện tích mỗi ô tỉ lệ đúng với giá trị, không lệch hình', () => {
    for (const t of squarify(items, W, H)) expect(t.w * t.h).toBeCloseTo((t.value / total) * W * H, 6)
  })

  it('các ô phủ kín khung, không ô nào lòi ra ngoài và không đè nhau', () => {
    const out = squarify(items, W, H)
    expect(out.reduce((s, t) => s + t.w * t.h, 0)).toBeCloseTo(W * H, 6)
    for (const t of out) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-9)
      expect(t.y).toBeGreaterThanOrEqual(-1e-9)
      expect(t.x + t.w).toBeLessThanOrEqual(W + 1e-9)
      expect(t.y + t.h).toBeLessThanOrEqual(H + 1e-9)
    }
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j]
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      expect(ox > 1e-9 && oy > 1e-9).toBe(false)
    }
  })

  it('ô gần vuông, không dẹt: chia theo cột rồi theo hàng luân phiên', () => {
    const ratio = (t: { w: number; h: number }) => Math.max(t.w / t.h, t.h / t.w)
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `m${i}`, value: 12 - i }))
    expect(Math.max(...squarify(many, W, H).map(ratio))).toBeLessThan(2.5)
  })

  it('giá trị 0 hoặc âm không thành ô; không có gì để vẽ thì trả rỗng', () => {
    expect(squarify([{ value: 0 }, { value: -3 }, { value: 5 }], W, H)).toHaveLength(1)
    expect(squarify([{ value: 0 }], W, H)).toEqual([])
    expect(squarify([], W, H)).toEqual([])
  })

  it('một nhóm duy nhất chiếm trọn khung', () => {
    const [t] = squarify([{ value: 7 }], W, H)
    expect(t.x).toBe(0)
    expect(t.y).toBe(0)
    expect(t.w).toBeCloseTo(W, 6)
    expect(t.h).toBeCloseTo(H, 6)
  })
})
