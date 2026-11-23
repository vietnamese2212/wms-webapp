// Chia kỳ của dashboard Báo cáo NVL — utils/mesDash.ts.
// 22/11 (C131): DB chỉ trả kỳ CÓ mẻ ⇒ trục phải tự đủ mọi kỳ. 23/11 — user: kỳ THEO LỊCH quanh MỐC: 3 năm = năm trước · năm chọn · năm sau
// (gom năm) · 1 năm = 12 tháng của năm · 3 tháng = tháng trước · tháng chọn · tháng sau (gom tháng) · 7 ngày = tuần T2→CN · có ô chọn mốc.
import { describe, it, expect } from 'vitest'
import { grainOf, allBucketKeys, withAllBuckets, bucketRange, daysOf, addDays, periodOf, stepAnchor, drillOf, periodLabel } from '../../../frontend/src/utils/mesDash'

describe('periodOf — kỳ theo lịch quanh mốc (23/11)', () => {
  const A = '2026-11-22'   // Chủ nhật
  it('3 năm = năm trước · năm mốc · năm sau, gom theo năm; kỳ so = 3 năm trước đó', () => {
    expect(periodOf('3y', A)).toEqual({ from: '2025-01-01', to: '2027-12-31', grain: 'year', prevFrom: '2022-01-01', prevTo: '2024-12-31' })
  })
  it('1 năm = 12 tháng của năm mốc; kỳ so = năm trước', () => {
    expect(periodOf('1y', A)).toEqual({ from: '2026-01-01', to: '2026-12-31', grain: 'month', prevFrom: '2025-01-01', prevTo: '2025-12-31' })
  })
  it('3 tháng = tháng trước · tháng mốc · tháng sau, gom theo tháng (qua năm đúng)', () => {
    expect(periodOf('3m', A)).toEqual({ from: '2026-10-01', to: '2026-12-31', grain: 'month', prevFrom: '2026-07-01', prevTo: '2026-09-30' })
    expect(periodOf('3m', '2026-01-15')).toMatchObject({ from: '2025-12-01', to: '2026-02-28' })
  })
  it('1 tháng = cả tháng của mốc theo ngày; tháng 2 năm nhuận', () => {
    expect(periodOf('1m', A)).toEqual({ from: '2026-11-01', to: '2026-11-30', grain: 'day', prevFrom: '2026-10-01', prevTo: '2026-10-31' })
    expect(periodOf('1m', '2028-02-10')).toMatchObject({ from: '2028-02-01', to: '2028-02-29' })
  })
  it('7 ngày = tuần lịch Thứ Hai → Chủ nhật chứa mốc (mốc Chủ nhật ⇒ tuần 16 → 22/11)', () => {
    expect(periodOf('1w', A)).toEqual({ from: '2026-11-16', to: '2026-11-22', grain: 'day', prevFrom: '2026-11-09', prevTo: '2026-11-15' })
    expect(periodOf('1w', '2026-11-23')).toMatchObject({ from: '2026-11-23', to: '2026-11-29' })
  })
  it('1 ngày = từng mẻ; kỳ so = hôm trước', () => {
    expect(periodOf('1d', A)).toEqual({ from: A, to: A, grain: 'batch', prevFrom: '2026-11-21', prevTo: '2026-11-21' })
  })
})

describe('stepAnchor / drillOf / periodLabel — mốc lùi tiến, đi sâu một bậc', () => {
  it('‹ › theo kiểu kỳ', () => {
    expect(stepAnchor('1d', '2026-11-30', 1)).toBe('2026-12-01')
    expect(stepAnchor('1w', '2026-11-22', -1)).toBe('2026-11-15')
    expect(stepAnchor('1m', '2026-12-15', 1)).toBe('2027-01-01')
    expect(stepAnchor('3y', '2026-11-22', -1)).toBe('2025-11-22')
    expect(stepAnchor('1y', '2028-02-29', 1)).toBe('2029-03-01')   // không sinh 29/02/2029
  })
  it('năm → 1 năm · tháng → 1 tháng · tuần → 7 ngày · ngày → 1 ngày · từng mẻ hết bậc', () => {
    expect(drillOf('year', '2025-01-01')).toEqual({ kind: '1y', anchor: '2025-01-01' })
    expect(drillOf('month', '2026-03-01')).toEqual({ kind: '1m', anchor: '2026-03-01' })
    expect(drillOf('week', '2026-11-16')).toEqual({ kind: '1w', anchor: '2026-11-16' })
    expect(drillOf('day', '2026-11-17')).toEqual({ kind: '1d', anchor: '2026-11-17' })
    expect(drillOf('batch', 'x')).toBeNull()
  })
  it('tên kỳ', () => {
    expect(periodLabel('3y', '2026-11-22')).toBe('Năm 2025 → 2027')
    expect(periodLabel('1y', '2026-11-22')).toBe('Năm 2026')
    expect(periodLabel('3m', '2026-11-22')).toBe('Tháng 10/2026 → 12/2026')
    expect(periodLabel('1w', '2026-11-22')).toBe('Tuần 16/11 → 22/11/2026')
  })
})

describe('grainOf — khoảng tự chọn: mỗi biểu đồ vài chục điểm', () => {
  it('1 ngày từng mẻ · ≤ 92 ngày theo ngày · ≤ 400 theo tuần · dài hơn theo tháng', () => {
    expect([1, 7, 30, 90, 92, 93, 365, 400, 401, 1095].map(grainOf)).toEqual(['batch', 'day', 'day', 'day', 'day', 'week', 'week', 'week', 'month', 'month'])
  })
})

describe('allBucketKeys / withAllBuckets — trục đủ mọi kỳ (C131)', () => {
  it('7 ngày mà chỉ 2 ngày có mẻ ⇒ vẫn 7 kỳ, kỳ trống lấy giá trị rỗng', () => {
    expect(allBucketKeys('day', '2026-11-16', '2026-11-22')).toHaveLength(7)
    const full = withAllBuckets('day', '2026-11-16', '2026-11-22', [{ k: '2026-11-17', n: 1 }, { k: '2026-11-18', n: 1 }], k => ({ k, n: 0 }))
    expect(full.map(b => b.n)).toEqual([0, 1, 1, 0, 0, 0, 0])
  })
  it('tuần bắt đầu thứ Hai · năm = 01/01', () => {
    expect(allBucketKeys('week', '2026-11-22', '2026-11-30')).toEqual(['2026-11-16', '2026-11-23', '2026-11-30'])
    expect(allBucketKeys('year', '2025-01-01', '2027-12-31')).toEqual(['2025-01-01', '2026-01-01', '2027-01-01'])
  })
  it('1 năm theo tháng ⇒ 12 kỳ; 3 năm theo tháng ⇒ 37 kỳ', () => {
    expect(allBucketKeys('month', '2026-01-01', '2026-12-31')).toHaveLength(12)
    expect(allBucketKeys('month', addDays('2026-11-22', -1094), '2026-11-22')).toHaveLength(37)
  })
  it('1 ngày (từng mẻ) không đắp kỳ · khoảng ngược ⇒ rỗng', () => {
    expect(withAllBuckets('batch', '2026-11-22', '2026-11-22', [{ k: 'x' }], k => ({ k }))).toEqual([{ k: 'x' }])
    expect(allBucketKeys('day', '2026-11-22', '2026-11-20')).toEqual([])
  })
})

describe('bucketRange — khoảng ngày của một kỳ, cắt theo kỳ đang xem', () => {
  it('ngày · tuần cắt hai đầu · tháng 2 năm nhuận · năm', () => {
    expect(bucketRange('day', '2026-11-17', '2026-11-01', '2026-11-30')).toEqual({ from: '2026-11-17', to: '2026-11-17' })
    expect(bucketRange('week', '2026-11-16', '2026-11-18', '2026-11-20')).toEqual({ from: '2026-11-18', to: '2026-11-20' })
    expect(bucketRange('month', '2028-02-01', '2027-01-01', '2028-12-31')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(bucketRange('year', '2026-01-01', '2025-01-01', '2027-12-31')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })
  it('daysOf tính cả hai đầu', () => {
    expect(daysOf('2026-11-16', '2026-11-22')).toBe(7)
    expect(daysOf('2025-01-01', '2027-12-31')).toBe(1095)
  })
})
