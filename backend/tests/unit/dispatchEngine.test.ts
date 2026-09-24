// Engine ghép chuyến — MỘT phép kiểm cho MỘT luật (services/dispatchEngine.ts, đợt 2 TMS điều vận 24/09).
// Fixture thuần: không DB, không cước thật; oracle = tự tính lại bằng tay (số pallet × đơn giá, thứ tự ưu tiên).
import { describe, it, expect } from 'vitest'
import {
  runDispatch, fits, splitOversize, classKey, mergeKey, clusterKey, pickBookingCategory, codePrefixOf, tripLoad, sumLines, buildCtx, priceFor,
  type EngineInput, type EngineModel, type EngineOd, type EngineCarrier, type EngineTariff, type EngineLine,
} from '../../src/services/dispatchEngine'

const model = (o: Partial<EngineModel> & { id: string }): EngineModel => ({
  sap_code: o.id, name: o.id, parent_type_name: 'XE PALLET', capacity_mode: 'PALLET', max_pallets: 9, max_tons: null,
  tariff_unit: 'PER_PALLET', underload_pct: 70, serve_categories: null, max_drops: null, is_active: true, ...o,
})
const M9 = model({ id: 'M9' })
const M16 = model({ id: 'M16', max_pallets: 16 })
const A: EngineCarrier = { id: 'A', code: 'A', name: 'ĐVVT A' }
const B: EngineCarrier = { id: 'B', code: 'B', name: 'ĐVVT B' }
const tariff = (carrier: string, m: string, ward: string, price: number, km: number | null = 10): EngineTariff =>
  ({ id: `${carrier}|${m}|${ward}`, transport_company_id: carrier, vehicle_model_id: m, ward_code: ward, price, distance_km: km, effective_from: '2026-01-01', effective_to: null, is_active: true })
const line = (pallets: number, over: Partial<EngineLine> = {}): EngineLine => ({ material_code: 'M1', qty_base: 1, pallets, kg: pallets * 500, category: 'FG01', ...over })
const od = (n: string, ward: string, pallets: number, over: Partial<EngineOd> = {}): EngineOd => ({
  od_number: n, ship_to_code: `S${n}`, ship_to_name: null, ward_code: ward, region_code: 'R1', channel: null, internal_wh: null, scan_mode: false, flow: 'SALE',
  lines: [line(pallets)], ...over,
})
const params = { day: '2026-09-25', max_drops: 3, allow_mix_channels: false, underload_pct: null, code_prefix: 'K_X_250926_', start_seq: 1 }
// A có cước cho MỌI phường ở cả hai dòng xe (M9 rẻ hơn M16 theo pallet); B chỉ có ở W1 và đắt hơn
const TARIFFS = ['W1', 'W2', 'W3', 'W4'].flatMap(w => [tariff('A', 'M9', w, 100_000), tariff('A', 'M16', w, 150_000)]).concat([tariff('B', 'M9', 'W1', 120_000), tariff('B', 'M16', 'W1', 170_000)])
const input = (ods: EngineOd[], extra: Partial<EngineInput> = {}): EngineInput =>
  ({ ods, models: [M9, M16], carriers: [A, B], tariffs: TARIFFS, surcharges: [], allocations: [], share_targets: [], share_actual: {}, params, ...extra })

describe('sức chứa — fits đo theo chế độ dòng xe', () => {
  it('PALLET: 9 vừa, 9,001 không; thiếu số pallet ⇒ không kết luận vừa', () => {
    expect(fits(M9, 9, 4)).toBe(true)
    expect(fits(M9, 9.001, 4)).toBe(false)
    expect(fits(M9, null, 4)).toBe(false)
  })
  it('PALLET có khai thêm tấn ⇒ gác cả tấn; TON ⇒ chỉ tấn', () => {
    const both = model({ id: 'X', max_pallets: 9, max_tons: 4 })
    expect(fits(both, 8, 4.5)).toBe(false)
    const ton = model({ id: 'T', capacity_mode: 'TON', max_pallets: null, max_tons: 5 })
    expect(fits(ton, 99, 4.9)).toBe(true)
    expect(fits(ton, 1, 5.1)).toBe(false)
  })
})

describe('luật 3 — OD lớn hơn xe lớn nhất tách theo DÒNG HÀNG NGUYÊN', () => {
  it('3 dòng 5+5+2 pallet, xe 9 ⇒ 2 phần [5+2] và [5], không phần nào oversize', () => {
    const o = od('1', 'W1', 0, { lines: [line(5, { material_code: 'a' }), line(5, { material_code: 'b' }), line(2, { material_code: 'c' })] })
    const parts = splitOversize(o, M9)
    expect(parts.map(p => p.pallets).sort()).toEqual([5, 7])
    expect(parts.every(p => !p.oversize)).toBe(true)
    expect(parts.map(p => p.part?.of)).toEqual([2, 2])
  })
  it('một dòng 12 pallet > xe 9 ⇒ phần riêng gắn cờ oversize; OD vừa xe ⇒ một đơn vị, không part', () => {
    const big = splitOversize(od('2', 'W1', 12), M9)
    expect(big).toHaveLength(1); expect(big[0].oversize).toBe(true)
    const ok = splitOversize(od('3', 'W1', 8), M9)
    expect(ok).toHaveLength(1); expect(ok[0].part).toBeNull()
  })
})

describe('luật 1 + 2 — khoá nhóm bắt buộc và khoá cụm', () => {
  it('khách nội bộ theo kho đích · khách SCAN · khách ngoài là ba lớp khác nhau', () => {
    expect(classKey(od('1', 'W1', 1, { internal_wh: 'WH2' }))).toBe('INT:WH2')
    expect(classKey(od('1', 'W1', 1, { scan_mode: true }))).toBe('SCAN')
    expect(classKey(od('1', 'W1', 1))).toBe('EXT')
  })
  it('kênh nằm trong khoá gộp trừ khi kho cho trộn; phường chỉ nằm ở khoá cụm', () => {
    const npp = od('1', 'W1', 1, { channel: 'NPP' }), bhx = od('2', 'W1', 1, { channel: 'BHX' })
    expect(mergeKey(npp, false)).not.toBe(mergeKey(bhx, false))
    expect(mergeKey(npp, true)).toBe(mergeKey(bhx, true))
    expect(clusterKey(od('1', 'W1', 1), false)).not.toBe(clusterKey(od('2', 'W2', 1), false))
  })
})

describe('runDispatch — xếp lớn trước theo cụm, hạ xe rẻ nhất, số xe theo quy ước', () => {
  it('2 OD cùng phường 5 + 3 pallet ⇒ MỘT chuyến 8 pallet trên M9 (100k/pl rẻ hơn M16 150k/pl), ĐVVT A, Số xe K_X_250926_1', () => {
    const r = runDispatch(input([od('1', 'W1', 5), od('2', 'W1', 3)]))
    expect(r.trips).toHaveLength(1)
    const t = r.trips[0]
    expect(t.group_code).toBe('K_X_250926_1')
    expect(t.pallets).toBe(8); expect(t.stops).toBe(2)
    expect(t.vehicle_model?.id).toBe('M9')
    expect(t.carrier?.id).toBe('A')
    expect(t.freight.total).toBe(8 * 100_000)
    expect(t.booking_category).toBe('FG01')
    expect(r.summary.freight_total).toBe(800_000)
  })
  it('OD 12 pallet ⇒ lên M16 (không vừa M9); 20 pallet ⇒ tách 2 phần theo dòng hàng, phần dư sang xe kế', () => {
    const r = runDispatch(input([od('1', 'W1', 12)]))
    expect(r.trips).toHaveLength(1); expect(r.trips[0].vehicle_model?.id).toBe('M16')
    const r2 = runDispatch(input([od('2', 'W2', 0, { lines: [line(12, { material_code: 'a' }), line(8, { material_code: 'b' })] })]))
    expect(r2.trips).toHaveLength(2)
    expect(r2.trips.flatMap(t => t.ods).map(o => o.part?.of)).toEqual([2, 2])
    expect(r2.summary.oversize).toBe(0)
  })
  it('xe LỚN NHẤT để xếp chỉ tính dòng xe CÓ CƯỚC cho phường: M30 không ai chào giá ⇒ 12 + 12 pallet thành 2 xe M16 có cước, không phải 1 xe M30 không ĐVVT', () => {
    const M30 = model({ id: 'M30', max_pallets: 30 })
    const r = runDispatch(input([od('1', 'W1', 12), od('2', 'W1', 12)], { models: [M9, M16, M30] }))
    expect(r.trips).toHaveLength(2)
    expect(r.trips.every(t => t.vehicle_model?.id === 'M16' && t.carrier?.id === 'A' && t.freight.total === 12 * 150_000)).toBe(true)
    // phường không có cước nào ⇒ rơi về xe lớn nhất chung (vẫn xếp, cước null)
    const r2 = runDispatch(input([od('3', 'W9', 12), od('4', 'W9', 12)], { models: [M9, M16, M30] }))
    expect(r2.trips).toHaveLength(1); expect(r2.trips[0].vehicle_model?.id).toBe('M30'); expect(r2.trips[0].carrier).toBeNull()
  })
  it('một dòng 20 pallet > xe lớn nhất 16 ⇒ chuyến riêng oversize + cảnh báo nói thẳng', () => {
    const r = runDispatch(input([od('1', 'W1', 20)]))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].oversize).toBe(true)
    expect(r.trips[0].warnings.join(' ')).toMatch(/lớn hơn xe lớn nhất/)
  })
  it('max_drops 3: 4 khách 1 pallet cùng phường ⇒ 2 chuyến (3 điểm + 1 điểm) dù vừa một xe', () => {
    const r = runDispatch(input(['1', '2', '3', '4'].map(n => od(n, 'W1', 1))))
    expect(r.trips.map(t => t.stops).sort()).toEqual([1, 3])
  })
  it('Số xe nối tiếp từ start_seq (STT đã có trong Kế hoạch xuất)', () => {
    const r = runDispatch(input([od('1', 'W1', 8), od('2', 'W2', 8)], { params: { ...params, start_seq: 5 } }))
    expect(r.trips.map(t => t.group_code)).toEqual(['K_X_250926_5', 'K_X_250926_6'])
  })
})

describe('luật 2 — không trộn kênh / kho nội bộ đi riêng', () => {
  it('cùng phường khác kênh ⇒ 2 chuyến; kho cho trộn kênh ⇒ 1 chuyến', () => {
    const ods = [od('1', 'W1', 2, { channel: 'NPP' }), od('2', 'W1', 2, { channel: 'BHX' })]
    expect(runDispatch(input(ods)).trips).toHaveLength(2)
    expect(runDispatch(input(ods, { params: { ...params, allow_mix_channels: true } })).trips).toHaveLength(1)
  })
  it('khách là kho nội bộ không đi chung với khách ngoài cùng phường', () => {
    const r = runDispatch(input([od('1', 'W1', 2, { internal_wh: 'WH2' }), od('2', 'W1', 2)]))
    expect(r.trips).toHaveLength(2)
  })
})

describe('luật 5 — gộp chuyến Non tải cùng vùng khi vừa xe, đủ điểm giao và không đắt hơn đi riêng', () => {
  it('2 + 2 pallet ở W1/W2 cùng vùng (mỗi chuyến 22 % < 70) ⇒ gộp thành một chuyến 2 phường, cước 4 pallet = 2 + 2 pallet', () => {
    const r = runDispatch(input([od('1', 'W1', 2), od('2', 'W2', 2)]))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].wards.sort()).toEqual(['W1', 'W2'])
    expect(r.trips[0].freight.total).toBe(4 * 100_000)
  })
  it('max_drops 1 ⇒ không gộp được, chuyến Non tải giữ merge_hint nói vì sao', () => {
    const r = runDispatch(input([od('1', 'W1', 2), od('2', 'W2', 2)], { params: { ...params, max_drops: 1 } }))
    expect(r.trips).toHaveLength(2)
    expect(r.trips.every(t => t.underload)).toBe(true)
    expect(r.trips[0].merge_hint).toMatch(/Non tải/)
  })
  it('khác vùng ⇒ không gộp dù cả hai Non tải', () => {
    const r = runDispatch(input([od('1', 'W1', 2), od('2', 'W2', 2, { region_code: 'R2' })]))
    expect(r.trips).toHaveLength(2)
  })
  it('ngưỡng Non tải của kho đè ngưỡng dòng xe: 6/9 = 67 % Non tải ở ngưỡng 70, không Non tải ở ngưỡng kho 60', () => {
    expect(runDispatch(input([od('1', 'W1', 6)])).trips[0].underload).toBe(true)
    expect(runDispatch(input([od('1', 'W1', 6)], { params: { ...params, underload_pct: 60 } })).trips[0].underload).toBe(false)
    expect(tripLoad(M9, 3, 1, null)).toMatchObject({ pct: 33.3, underload: true })
    expect(tripLoad(M9, 3, 1, 30)).toMatchObject({ underload: false })
  })
})

describe('luật 6 — chọn ĐVVT: phân tuyến → dưới tỷ trọng → cước thấp nhất → mã', () => {
  it('mặc định rẻ nhất: W1 có A 100k và B 120k ⇒ A', () => {
    const t = runDispatch(input([od('1', 'W1', 8)])).trips[0]
    expect(t.carrier?.id).toBe('A')
    expect(t.carrier_reasons.join(' ')).toMatch(/Cước thấp nhất/)
  })
  it('phân tuyến WARD W1 → B ưu tiên 1 ⇒ B dù đắt hơn, lý do ghi "Phân tuyến"', () => {
    const t = runDispatch(input([od('1', 'W1', 8)], { allocations: [{ area_kind: 'WARD', area_code: 'W1', transport_company_id: 'B', priority: 1, effective_from: '2026-01-01', effective_to: null }] })).trips[0]
    expect(t.carrier?.id).toBe('B')
    expect(t.carrier_reasons.join(' ')).toMatch(/Phân tuyến phường W1/)
    expect(t.freight.total).toBe(8 * 120_000)
  })
  it('phân tuyến hết hiệu lực ⇒ bỏ qua, về rẻ nhất', () => {
    const t = runDispatch(input([od('1', 'W1', 8)], { allocations: [{ area_kind: 'WARD', area_code: 'W1', transport_company_id: 'B', priority: 1, effective_from: '2026-01-01', effective_to: '2026-06-30' }] })).trips[0]
    expect(t.carrier?.id).toBe('A')
  })
  it('tỷ trọng cộng dồn NGAY trong lượt: mục tiêu A 30 % · B 70 %, hai chuyến W1 ⇒ chuyến 1 A (rẻ, cả hai dưới mục tiêu), chuyến 2 B (A đã 100 % ≥ 30, B 0 % < 70)', () => {
    const r = runDispatch(input([od('1', 'W1', 8, { region_code: 'R1' }), od('2', 'W1', 8, { region_code: 'R2' })], {
      share_targets: [{ transport_company_id: 'A', share_pct: 30, basis: 'TRIPS' }, { transport_company_id: 'B', share_pct: 70, basis: 'TRIPS' }],
    }))
    expect(r.trips).toHaveLength(2)
    expect(r.trips.map(t => t.carrier?.id).sort()).toEqual(['A', 'B'])
    const b = r.trips.find(t => t.carrier?.id === 'B')!
    expect(b.carrier_reasons.join(' ')).toMatch(/Dưới tỷ trọng kỳ/)
    const shares = Object.fromEntries(r.summary.shares.map(s => [s.code, s]))
    expect(shares.A.trips).toBe(1); expect(shares.B.trips).toBe(1); expect(shares.A.pct).toBe(50)
  })
  it('nền kỳ (chuyến đã xác nhận) tính vào tỷ trọng: A đã 9 chuyến / B 1 ⇒ chuyến mới về B', () => {
    const r = runDispatch(input([od('1', 'W1', 8)], {
      share_targets: [{ transport_company_id: 'A', share_pct: 50, basis: 'TRIPS' }, { transport_company_id: 'B', share_pct: 50, basis: 'TRIPS' }],
      share_actual: { A: { trips: 9, pallets: 0, tons: 0 }, B: { trips: 1, pallets: 0, tons: 0 } },
    }))
    expect(r.trips[0].carrier?.id).toBe('B')
  })
  it('không ĐVVT nào có cước cho phường ⇒ dòng xe nhỏ nhất còn vừa, ĐVVT trống, cước null có lý do', () => {
    const t = runDispatch(input([od('1', 'W9', 8)])).trips[0]
    expect(t.carrier).toBeNull(); expect(t.vehicle_model?.id).toBe('M9')
    expect(t.freight.total).toBeNull(); expect(t.freight.reason).toMatch(/Chưa có bảng cước/)
  })
  it('priceFor: cước theo phường XA NHẤT của chuyến (km lớn hơn), PER_TRIP không nhân pallet', () => {
    const ctx = buildCtx(input([], { tariffs: [tariff('A', 'M9', 'W1', 100_000, 10), tariff('A', 'M9', 'W2', 130_000, 40), tariff('A', 'MT', 'W1', 2_500_000)] , models: [M9, model({ id: 'MT', tariff_unit: 'PER_TRIP' })] }))
    const f = priceFor(ctx, M9, 'A', ['W1', 'W2'], 2, 7.2, 3)
    expect(f.ward).toBe('W2'); expect(f.billed_pallets).toBe(8); expect(f.total).toBe(8 * 130_000)
    const g = priceFor(ctx, model({ id: 'MT', tariff_unit: 'PER_TRIP' }), 'A', ['W1'], 1, 7.2, 3)
    expect(g.total).toBe(2_500_000)
  })
})

describe('OD không lên xe — lý do nói thẳng', () => {
  it('flow RETURN · OD không dòng hàng · không đo được tải', () => {
    const r = runDispatch(input([od('1', 'W1', 2, { flow: 'RETURN' }), od('2', 'W1', 2, { lines: [] }), od('3', 'W1', 0, { lines: [line(0, { pallets: null, kg: null })] })]))
    expect(r.trips).toHaveLength(0)
    expect(r.unplanned.map(u => u.od_number).sort()).toEqual(['1', '2', '3'])
    expect(r.unplanned.find(u => u.od_number === '1')!.reason).toMatch(/RETURN/)
    expect(r.unplanned.find(u => u.od_number === '3')!.reason).toMatch(/Không đo được tải/)
  })
  it('không dòng xe con nào gán cha ⇒ mọi OD không xếp được, không ném lỗi', () => {
    const r = runDispatch(input([od('1', 'W1', 2)], { models: [model({ id: 'X', parent_type_name: null })] }))
    expect(r.trips).toHaveLength(0); expect(r.unplanned[0].reason).toMatch(/gán cha/)
  })
  it('dòng xe không phục vụ loại hàng ⇒ không chọn dòng xe đó', () => {
    const cold = model({ id: 'COLD', serve_categories: ['SCA'] })
    const r = runDispatch(input([od('1', 'W1', 2)], { models: [cold], tariffs: [tariff('A', 'COLD', 'W1', 50_000)] }))
    expect(r.trips[0].vehicle_model).toBeNull()
    expect(r.trips[0].warnings.join(' ')).toMatch(/phục vụ loại FG01/)
  })
})

describe('ổn định + tiện ích', () => {
  it('cùng input đảo thứ tự ⇒ cùng output (sort trước khi duyệt)', () => {
    const ods = [od('3', 'W2', 2), od('1', 'W1', 5), od('2', 'W1', 3), od('4', 'W3', 8, { region_code: 'R2' })]
    const a = runDispatch(input(ods)), b = runDispatch(input([...ods].reverse()))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
  it('booking_category = loại chiếm nhiều pallet nhất, hoà theo mã; không loại ⇒ null', () => {
    expect(pickBookingCategory([line(5, { category: 'FG01' }), line(1, { category: 'PM01' })])).toBe('FG01')
    expect(pickBookingCategory([line(2, { category: 'PM01' }), line(2, { category: 'FG01' })])).toBe('FG01')
    expect(pickBookingCategory([line(2, { category: null })])).toBeNull()
  })
  it('codePrefixOf giữ đúng quy ước <MãKho>_X_<ddmmyy>_ mà buildKhvcByVehicle đọc', () => {
    expect(codePrefixOf('20000016', '2026-09-25')).toBe('20000016_X_250926_')
  })
  it('sumLines: thiếu một dòng ⇒ chiều đó null (không đoán 0)', () => {
    expect(sumLines([line(2), line(3, { pallets: null })])).toEqual({ pallets: null, tons: 2.5 })
  })
})
