// Cửa sổ dòng của bảng dài (frontend/src/utils/rowWindow.ts, 07/10, C65 — Xem đơn Bán hàng Ba Vì 3.529 đơn vẽ hết: tick 1 đơn ~1,1 s).
// Bất biến trên MỌI đầu vào: (1) số dòng vẽ bị chặn trên theo khung nhìn, KHÔNG theo độ dài danh sách; (2) mọi dòng nằm trong khung nhìn
// đều được vẽ; (3) đệm trên + dòng vẽ + đệm dưới = đúng chiều cao cả danh sách (thanh cuộn không nhảy); (4) cuộn quá đáy vẫn vẽ dòng cuối.
import { describe, it, expect } from 'vitest'
import { rowWindow } from '../../../frontend/src/utils/rowWindow'

describe('rowWindow', () => {
  it('danh sách rỗng ⇒ không vẽ gì, không đệm', () => {
    expect(rowWindow({ top: 0, height: 800, rowH: 33, count: 0 })).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
  })

  it('3.529 dòng, đầu bảng ⇒ chỉ vẽ khung nhìn + dự phòng', () => {
    const w = rowWindow({ top: 0, height: 800, rowH: 33, count: 3529 })
    expect(w.start).toBe(0)
    expect(w.end).toBeLessThan(60)
    expect(w.padBottom).toBe((3529 - w.end) * 33)
  })

  it('bất biến trên lưới đầu vào ngẫu nhiên (có cả biên 0 / âm / cuộn quá đáy)', () => {
    let seed = 7
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    for (let k = 0; k < 20000; k++) {
      const count = [0, 1, 5, 40, 3529, 100000][rnd(6)] + rnd(3)
      const rowH = [1, 24, 33, 33.5][rnd(4)]
      const height = rnd(3) ? rnd(2000) : 0
      const overscan = rnd(25)
      const total = count * rowH
      const top = rnd(4) ? rnd(Math.max(1, Math.ceil(total))) : (rnd(2) ? -50 : total + 5000)
      const w = rowWindow({ top, height, rowH, count, overscan })
      const ctx = JSON.stringify({ top, height, rowH, count, overscan, w })
      expect(0 <= w.start && w.start <= w.end && w.end <= count, ctx).toBe(true)
      // (1) chặn trên — không phụ thuộc count
      expect(w.end - w.start, ctx).toBeLessThanOrEqual(Math.ceil(height / rowH) + 1 + 2 * overscan)
      // (3) tổng chiều cao giữ nguyên
      expect(w.padTop + (w.end - w.start) * rowH + w.padBottom, ctx).toBeCloseTo(total, 6)
      if (!count) continue
      // (2) phủ khung nhìn: dòng đầu và dòng cuối đang thấy đều nằm trong [start, end)
      const vTop = Math.min(Math.max(0, top), Math.max(0, total - height))
      const firstSeen = Math.min(count - 1, Math.floor(vTop / rowH))
      const lastSeen = Math.min(count - 1, Math.floor((vTop + Math.max(0, height - 1)) / rowH))
      expect(w.start <= firstSeen && lastSeen < w.end, ctx).toBe(true)
      // (4) cuộn quá đáy ⇒ dòng cuối có mặt
      if (top >= total) expect(w.end, ctx).toBe(count)
    }
  })
})
