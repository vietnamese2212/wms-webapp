// Phép tính của giao diện tab KPI (frontend/src/utils/kpiView.ts, 11/2026): xếp hạng lệch mục tiêu, so hai kỳ gần nhất,
// không nối đường qua kỳ thiếu số, đường cong không vẽ ra đỉnh/đáy không có trong dữ liệu.
import { describe, expect, it } from 'vitest'
import { kpiGap, lastDelta, monotonePath, runsOf } from '../../../frontend/src/utils/kpiView'

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
