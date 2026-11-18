// Thu phóng / rê của bản vẽ 2D (Sơ đồ kho · Sơ đồ bồn 2D — 18/11 g): một bộ phép toán cho mọi bản vẽ.
import { describe, it, expect } from 'vitest'
import { zoomAt, fitView, pinchView, keepInView, centerOn, toWorld, type View } from '../../../frontend/src/utils/panZoom'

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9)

describe('zoomAt — điểm dưới con trỏ đứng yên', () => {
  it('phóng ×1,15 quanh (300, 200): điểm bản vẽ dưới con trỏ không trôi', () => {
    const v: View = { scale: 0.8, ox: -120, oy: 40 }
    const before = toWorld(v, 300, 200)
    const z = zoomAt(v, 300, 200, 1.15, 0.1, 3)
    const after = toWorld(z, 300, 200)
    close(z.scale, 0.92); close(before.x, after.x); close(before.y, after.y)
  })
  it('kẹp tỉ lệ trong [min, max]', () => {
    expect(zoomAt({ scale: 2.9, ox: 0, oy: 0 }, 0, 0, 1.5, 0.1, 3).scale).toBe(3)
    expect(zoomAt({ scale: 0.11, ox: 0, oy: 0 }, 0, 0, 0.5, 0.1, 3).scale).toBe(0.1)
  })
  it('giống hệt phép lăn chuột cũ của Sơ đồ kho (min 2, max 80, ×1,15)', () => {
    const v: View = { scale: 12, ox: 8, oy: 8 }, mx = 140, my = 90
    const ns = Math.max(2, Math.min(80, v.scale * 1.15)), k = ns / v.scale
    const old = { scale: ns, ox: mx - (mx - v.ox) * k, oy: my - (my - v.oy) * k }
    expect(zoomAt(v, mx, my, 1.15, 2, 80)).toEqual(old)
  })
})

describe('fitView — cả bản vẽ vừa khung, nằm giữa', () => {
  it('bản vẽ 2000 × 1000 trong khung 1000 × 600, lề 20 ⇒ tỉ lệ 0,48, căn giữa', () => {
    const v = fitView(2000, 1000, 1000, 600, 20, 0.05, 3)
    close(v.scale, 0.48)
    close(v.ox, (1000 - 2000 * 0.48) / 2); close(v.oy, (600 - 1000 * 0.48) / 2)
  })
  it('giống hệt "Vừa màn" cũ của Sơ đồ kho (lề 8, tối thiểu 2, không trần)', () => {
    const fw = 60, fh = 40, W = 900, H = 500
    const s = Math.max(2, Math.min((W - 16) / fw, (H - 16) / fh))
    expect(fitView(fw, fh, W, H, 8, 2, Infinity)).toEqual({ scale: s, ox: (W - fw * s) / 2, oy: (H - fh * s) / 2 })
  })
  it('bản vẽ nhỏ không bị phóng quá trần', () => {
    expect(fitView(100, 100, 1000, 1000, 0, 0.1, 1.5).scale).toBe(1.5)
  })
})

describe('pinchView — hai ngón vừa phóng vừa rê', () => {
  const start: View = { scale: 0.6, ox: 30, oy: -50 }
  it('ngón đứng yên ⇒ khung nhìn giữ nguyên', () => {
    const v = pinchView(start, { x: 200, y: 300 }, 120, { x: 200, y: 300 }, 120, 0.1, 3)
    close(v.scale, start.scale); close(v.ox, start.ox); close(v.oy, start.oy)
  })
  it('khoảng cách gấp đôi ⇒ tỉ lệ gấp đôi, điểm giữa hai ngón vẫn dưới điểm giữa', () => {
    const m0 = { x: 200, y: 300 }, m1 = { x: 260, y: 280 }
    const w0 = toWorld(start, m0.x, m0.y)
    const v = pinchView(start, m0, 100, m1, 200, 0.1, 3)
    close(v.scale, 1.2)
    const w1 = toWorld(v, m1.x, m1.y)
    close(w0.x, w1.x); close(w0.y, w1.y)
  })
})

describe('keepInView — không rê bản vẽ trôi mất khỏi khung', () => {
  it('rê quá xa sang phải ⇒ kéo về, còn ít nhất 80 px bản vẽ trong khung', () => {
    const v = keepInView({ scale: 1, ox: 5000, oy: 0 }, 1000, 800, 1200, 700, 80)
    expect(v.ox).toBe(1200 - 80)
  })
  it('rê quá xa sang trái / lên trên ⇒ mép bản vẽ còn trong khung', () => {
    const v = keepInView({ scale: 0.5, ox: -9000, oy: -9000 }, 1000, 800, 1200, 700, 80)
    expect(v.ox).toBe(80 - 500); expect(v.oy).toBe(80 - 400)
  })
  it('trong vùng hợp lệ thì giữ nguyên', () => {
    const v0: View = { scale: 1, ox: -100, oy: 20 }
    expect(keepInView(v0, 1000, 800, 1200, 700, 80)).toEqual(v0)
  })
})

describe('centerOn', () => {
  it('điểm bản vẽ (500, 300) về giữa khung 1000 × 600 ở tỉ lệ 1,2', () => {
    const v = centerOn(500, 300, 1.2, 1000, 600)
    const c = toWorld(v, 500, 300)
    close(c.x, 500); close(c.y, 300); expect(v.scale).toBe(1.2)
  })
})
