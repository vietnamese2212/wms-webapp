// Bất biến của helper địa lý thuần (02/10) — đường chim bay + hệ số đường bộ là đường lùi của mọi phép đo km khi chưa có nhà cung cấp.
import { describe, it, expect } from 'vitest'
import { haversineKm, estimateRoadKm, ROAD_FACTOR, routeKm, detourOk, kmLookup } from '../../src/utils/geoMath'

describe('geo — đường vòng (routeKm / detourOk) cho gộp xe khác tỉnh', () => {
  // kho ở 0; A cách 50 km trên đường tới B (100 km); C ở hướng ngược lại 60 km
  const km: Record<string, number> = { 'WH|A': 50, 'WH|B': 100, 'A|B': 50, 'WH|C': 60, 'A|C': 110, 'B|C': 160 }
  const dist = (a: string, b: string) => kmLookup(km, a, b)
  it('A nằm trên đường đi B: kho→A→B = 100 = đường thẳng tới B ⇒ đường vòng 0 %, thứ tự gần trước', () => {
    const r = routeKm(['B', 'A'], dist)!
    expect(r).toEqual({ total: 100, farthest: 100, order: ['A', 'B'] })
    expect(detourOk(r, 15)).toBe(true)
    expect(detourOk(r, 0)).toBe(true)
  })
  it('C ngược hướng: kho→A→C = 160 so với xa nhất 60 ⇒ vòng 167 %, không gộp ở 15 %', () => {
    const r = routeKm(['A', 'C'], dist)!
    expect(r.total).toBe(160); expect(r.farthest).toBe(60)
    expect(detourOk(r, 15)).toBe(false)
    expect(detourOk(r, 200)).toBe(true)
  })
  it('thiếu km một cặp ⇒ null ⇒ KHÔNG gộp (không đoán); không điểm ⇒ null', () => {
    expect(routeKm(['A', 'X'], dist)).toBeNull()
    expect(detourOk(null, 15)).toBe(false)
    expect(routeKm([], dist)).toBeNull()
  })
})

const BAVI = { lat: 21.1958, lng: 105.3936 }      // kho Ba Vì (Suối Hai)
const HANOI = { lat: 21.0285, lng: 105.8542 }     // hồ Hoàn Kiếm
const HAIPHONG = { lat: 20.8449, lng: 106.6881 }

describe('geo — đường chim bay (haversine) và ước lượng đường bộ', () => {
  it('cùng điểm = 0; đối xứng; Ba Vì → Hà Nội ≈ 51 km, Ba Vì → Hải Phòng ≈ 140 km', () => {
    expect(haversineKm(BAVI, BAVI)).toBe(0)
    expect(haversineKm(BAVI, HANOI)).toBeCloseTo(haversineKm(HANOI, BAVI), 9)
    expect(haversineKm(BAVI, HANOI)).toBeGreaterThan(48); expect(haversineKm(BAVI, HANOI)).toBeLessThan(54)
    expect(haversineKm(BAVI, HAIPHONG)).toBeGreaterThan(135); expect(haversineKm(BAVI, HAIPHONG)).toBeLessThan(145)
  })
  it('ước lượng đường bộ = chim bay × 1,3, làm tròn 2 số lẻ, không âm', () => {
    expect(ROAD_FACTOR).toBe(1.3)
    const d = estimateRoadKm(BAVI, HANOI)
    expect(d).toBeCloseTo(Number((haversineKm(BAVI, HANOI) * 1.3).toFixed(2)), 6)
    expect(String(d).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2)
    expect(estimateRoadKm(HANOI, HANOI)).toBe(0)
  })
  it('bất đẳng thức tam giác: Ba Vì → Hải Phòng ≤ Ba Vì → Hà Nội + Hà Nội → Hải Phòng', () => {
    expect(haversineKm(BAVI, HAIPHONG)).toBeLessThanOrEqual(haversineKm(BAVI, HANOI) + haversineKm(HANOI, HAIPHONG) + 1e-9)
  })
})
