// Bất biến của helper địa lý thuần (02/10) — đường chim bay + hệ số đường bộ là đường lùi của mọi phép đo km khi chưa có nhà cung cấp.
import { describe, it, expect } from 'vitest'
import { haversineKm, estimateRoadKm, ROAD_FACTOR } from '../../src/services/geo'

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
