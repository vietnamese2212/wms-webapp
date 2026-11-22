// Chia kỳ của dashboard Báo cáo NVL (22/11) — utils/mesDash.ts. Lỗi bắt 22/11 khi nghiệm thu: DB chỉ trả kỳ CÓ mẻ ⇒ kỳ 7 ngày còn 2 cột,
// 3 năm còn 1 cột. Trục thời gian phải đủ mọi kỳ; khoá tuần = thứ Hai (như date_trunc('week') của Postgres), khoá tháng = ngày 1.
import { describe, it, expect } from 'vitest'
import { grainOf, allBucketKeys, withAllBuckets, bucketRange, daysOf, addDays } from '../../../frontend/src/utils/mesDash'

describe('grainOf — mỗi biểu đồ vài chục điểm dù xem 3 năm', () => {
  it('1 ngày từng mẻ · 7 / 30 / 90 ngày theo ngày · 1 năm theo tuần · 3 năm theo tháng', () => {
    expect([1, 7, 30, 90, 92, 93, 365, 400, 401, 1095].map(grainOf)).toEqual(['batch', 'day', 'day', 'day', 'day', 'week', 'week', 'week', 'month', 'month'])
  })
})

describe('allBucketKeys / withAllBuckets — trục đủ mọi kỳ', () => {
  it('7 ngày mà chỉ 2 ngày có mẻ ⇒ vẫn 7 kỳ, kỳ trống lấy giá trị rỗng', () => {
    const keys = allBucketKeys('day', '2026-11-16', '2026-11-22')
    expect(keys).toHaveLength(7)
    const full = withAllBuckets('day', '2026-11-16', '2026-11-22', [{ k: '2026-11-17', n: 1 }, { k: '2026-11-18', n: 1 }], k => ({ k, n: 0 }))
    expect(full.map(b => b.n)).toEqual([0, 1, 1, 0, 0, 0, 0])
  })
  it('tuần bắt đầu thứ Hai (22/11/2026 là Chủ nhật ⇒ tuần 16/11)', () => {
    expect(allBucketKeys('week', '2026-11-22', '2026-11-30')).toEqual(['2026-11-16', '2026-11-23', '2026-11-30'])
  })
  it('3 năm theo tháng ⇒ 37 kỳ, khoá ngày 1, qua năm đúng', () => {
    const k = allBucketKeys('month', addDays('2026-11-22', -1094), '2026-11-22')
    expect(k).toHaveLength(37)
    expect(k[0]).toBe('2023-11-01')
    expect(k[k.length - 1]).toBe('2026-11-01')
    expect(k).toContain('2024-01-01')
  })
  it('1 ngày (từng mẻ) không đắp kỳ · khoảng ngược ⇒ rỗng', () => {
    expect(withAllBuckets('batch', '2026-11-22', '2026-11-22', [{ k: 'x' }], k => ({ k }))).toEqual([{ k: 'x' }])
    expect(allBucketKeys('day', '2026-11-22', '2026-11-20')).toEqual([])
  })
})

describe('bucketRange — khoảng ngày của một kỳ, cắt theo kỳ đang xem', () => {
  it('ngày · tuần cắt hai đầu · tháng 2 năm nhuận', () => {
    expect(bucketRange('day', '2026-11-17', '2026-11-01', '2026-11-30')).toEqual({ from: '2026-11-17', to: '2026-11-17' })
    expect(bucketRange('week', '2026-11-16', '2026-11-18', '2026-11-20')).toEqual({ from: '2026-11-18', to: '2026-11-20' })
    expect(bucketRange('month', '2028-02-01', '2027-01-01', '2028-12-31')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
  it('daysOf tính cả hai đầu', () => {
    expect(daysOf('2026-11-16', '2026-11-22')).toBe(7)
    expect(daysOf('2026-11-22', '2026-11-22')).toBe(1)
  })
})
