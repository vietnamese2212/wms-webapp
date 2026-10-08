// Cước một chuyến — bất biến theo 4 điều user chốt 23/09 (plan TMS_DISPATCH 6.0/6.3).
import { describe, it, expect } from 'vitest'
import { computeFreight, stopFeeQty, billedPallets, pickTariff, routeTariff, loadUtilization, type TariffLike, type SurchargeLike } from '../../src/services/freight'

describe('tải / Non tải — % tải so sức chứa dòng xe con (đợt 1 mục 15)', () => {
  const pal16 = { capacity_mode: 'PALLET', max_pallets: 16, max_tons: null, underload_pct: 70 }
  const ton5  = { capacity_mode: 'TON', max_pallets: null, max_tons: '5', underload_pct: null }
  it('xe pallet đo theo pallet: 12/16 = 75 % không Non tải · 10,4/16 = 65 % Non tải (ngưỡng 70)', () => {
    expect(loadUtilization(pal16, 12, 9)).toMatchObject({ basis: 'PALLET', used: 12, cap: 16, pct: 75, underload: false })
    expect(loadUtilization(pal16, 10.4, 9)).toMatchObject({ pct: 65, underload: true })
  })
  it('xe tấn đo theo tấn (max_tons là chuỗi numeric từ DB), ngưỡng mặc định 70 khi null', () => {
    expect(loadUtilization(ton5, 12, 4.2)).toMatchObject({ basis: 'TON', used: 4.2, cap: 5, pct: 84, underload: false, underload_pct: 70 })
    expect(loadUtilization(ton5, 12, 3)).toMatchObject({ pct: 60, underload: true })
  })
  it('không đo được thì null, KHÔNG đoán: thiếu dòng xe · thiếu tải · dòng xe không khai sức chứa', () => {
    expect(loadUtilization(null, 12, 9).pct).toBeNull()
    expect(loadUtilization(pal16, null, 9)).toMatchObject({ basis: 'PALLET', pct: null, underload: null })
    expect(loadUtilization({ capacity_mode: 'TON', max_pallets: null, max_tons: null, underload_pct: 70 }, 12, 9)).toMatchObject({ pct: null, cap: null })
  })
})

const tariff = (over: Partial<TariffLike> = {}): TariffLike =>
  ({ id: 't1', price: 250_000, ward_code: 'HN-Phú Lương', distance_km: 40, effective_from: '2026-09-01', effective_to: null, ...over })
const drop = (over: Partial<SurchargeLike> = {}): SurchargeLike =>
  ({ id: 's1', kind: 'DROP_POINT', amount: 100_000, per: 'PER_STOP', count_mode: 'ALL_STOPS', min_stops: 2, effective_from: '2026-09-01', effective_to: null, ...over })

describe('cước — xe pallet làm tròn LÊN, không pallet tối thiểu', () => {
  it('15,2 pallet → tính 16 pallet · 16,0 → 16 · 0,3 → 1', () => {
    expect(billedPallets(15.2)).toBe(16)
    expect(billedPallets(16)).toBe(16)
    expect(billedPallets(0.3)).toBe(1)
    expect(billedPallets(15.9999999999)).toBe(16)   // sai số nhị phân không đẻ thêm pallet
    expect(billedPallets(0)).toBe(0)
  })
  it('PER_PALLET: 250.000 × ceil(15,2) = 4.000.000; PER_TRIP: đúng giá chuyến bất kể pallet', () => {
    const r = computeFreight({ unit: 'PER_PALLET', tariff: tariff(), surcharges: [], pallets: 15.2, tons: 9, stops: 1 })
    expect(r.total).toBe(4_000_000); expect(r.billed_pallets).toBe(16); expect(r.reason).toBeNull()
    const t = computeFreight({ unit: 'PER_TRIP', tariff: tariff({ price: 3_100_000 }), surcharges: [], pallets: 15.2, tons: 9, stops: 1 })
    expect(t.total).toBe(3_100_000); expect(t.billed_pallets).toBeNull()
  })
})

describe('rớt điểm — theo thực tế chuyến', () => {
  it('1 điểm = 0 · 2 điểm ALL_STOPS = 2 khoản · 3 điểm EXTRA_STOPS (min 2) = 2 khoản', () => {
    expect(stopFeeQty(1, 'ALL_STOPS', 2)).toBe(0)
    expect(stopFeeQty(2, 'ALL_STOPS', 2)).toBe(2)
    expect(stopFeeQty(3, 'EXTRA_STOPS', 2)).toBe(2)
    expect(stopFeeQty(2, 'EXTRA_STOPS', 2)).toBe(1)
    expect(stopFeeQty(0, 'ALL_STOPS', 2)).toBe(0)
  })
  it('chuyến 3 điểm, hợp đồng ALL_STOPS 100k: tổng = cước + 300k; hợp đồng khác EXTRA_STOPS: + 200k', () => {
    const all = computeFreight({ unit: 'PER_TRIP', tariff: tariff({ price: 1_000_000 }), surcharges: [drop()], pallets: 10, tons: 5, stops: 3 })
    expect(all.total).toBe(1_300_000)
    expect(all.surcharges).toEqual([{ kind: 'DROP_POINT', per: 'PER_STOP', unit_amount: 100_000, qty: 3, total: 300_000 }])
    const extra = computeFreight({ unit: 'PER_TRIP', tariff: tariff({ price: 1_000_000 }), surcharges: [drop({ count_mode: 'EXTRA_STOPS' })], pallets: 10, tons: 5, stops: 3 })
    expect(extra.total).toBe(1_200_000)
    const one = computeFreight({ unit: 'PER_TRIP', tariff: tariff({ price: 1_000_000 }), surcharges: [drop()], pallets: 10, tons: 5, stops: 1 })
    expect(one.total).toBe(1_000_000); expect(one.surcharges).toEqual([])
  })
})

describe('phụ phí khác + thiếu cước', () => {
  it('bốc xếp PER_TRIP cộng một lần; PER_TON × tấn; PER_PALLET × pallet đã làm tròn', () => {
    const r = computeFreight({
      unit: 'PER_PALLET', tariff: tariff({ price: 100_000 }), pallets: 10.5, tons: 6.25, stops: 1,
      surcharges: [
        drop({ id: 'a', kind: 'LOADING', per: 'PER_TRIP', amount: 150_000 }),
        drop({ id: 'b', kind: 'OTHER', per: 'PER_TON', amount: 10_000 }),
        drop({ id: 'c', kind: 'OTHER', per: 'PER_PALLET', amount: 5_000 }),
      ],
    })
    expect(r.base).toBe(1_100_000)                         // 11 pallet × 100k
    expect(r.surcharges.map(s => s.total)).toEqual([150_000, 62_500, 55_000])
    expect(r.total).toBe(1_100_000 + 150_000 + 62_500 + 55_000)
  })
  it('không có bảng cước → total null kèm lý do, không đoán', () => {
    const r = computeFreight({ unit: 'PER_PALLET', tariff: null, surcharges: [drop()], pallets: 3, tons: 1, stops: 2 })
    expect(r.total).toBeNull(); expect(r.reason).toMatch(/Chưa có bảng cước/); expect(r.surcharges).toEqual([])
  })
})

describe('hiệu lực + phường xa nhất', () => {
  it('pickTariff lấy dòng hiệu lực MỚI NHẤT tại ngày; hết hiệu lực thì bỏ', () => {
    const rows = [tariff({ id: 'old', price: 1, effective_from: '2026-01-01', effective_to: '2026-08-31' }),
      tariff({ id: 'cur', price: 2, effective_from: '2026-09-01' }), tariff({ id: 'future', price: 3, effective_from: '2026-10-01' })]
    expect(pickTariff(rows, '2026-09-15')?.id).toBe('cur')
    expect(pickTariff(rows, '2026-08-15')?.id).toBe('old')
    expect(pickTariff(rows, '2026-10-01')?.id).toBe('future')
    expect(pickTariff([tariff({ is_active: false })], '2026-09-15')).toBeNull()
  })
  it('routeTariff (08/10 "cước của tuyến cao nhất"): phường GIÁ cao nhất — không phải phường xa nhất; hoà giá ⇒ xa hơn ⇒ mã; phường thiếu cước nói ra', () => {
    const rows = [
      tariff({ id: 'near-pricey', ward_code: 'NUI', price: 900, distance_km: 120 }),   // tuyến núi: gần hơn mà đắt hơn
      tariff({ id: 'far-cheap', ward_code: 'DONG', price: 700, distance_km: 160 }),
      tariff({ id: 'old', ward_code: 'DONG', price: 9999, distance_km: 160, effective_to: '2026-08-31' }),   // hết hiệu lực — không tính
    ]
    expect(routeTariff(rows, ['DONG', 'NUI'], '2026-09-15').tariff?.id).toBe('near-pricey')
    expect(routeTariff(rows, ['DONG', 'NUI', 'X'], '2026-09-15')).toMatchObject({ missing: ['X'] })
    const tie = [tariff({ id: 'a', ward_code: 'A', price: 500, distance_km: 10 }), tariff({ id: 'b', ward_code: 'B', price: 500, distance_km: 40 }), tariff({ id: 'c', ward_code: 'C', price: 500, distance_km: 40 })]
    expect(routeTariff(tie, ['A', 'B', 'C'], '2026-09-15').tariff?.id).toBe('b')   // hoà giá ⇒ xa hơn ⇒ theo mã
    expect(routeTariff(rows, [], '2026-09-15')).toEqual({ tariff: null, missing: [] })
    expect(routeTariff(rows, ['X'], '2026-09-15')).toEqual({ tariff: null, missing: ['X'] })
  })
})
