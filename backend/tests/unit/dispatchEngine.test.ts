// Engine ghép chuyến — MỘT phép kiểm cho MỘT luật (services/dispatchEngine.ts, đợt 2 TMS điều vận 24/09).
// Fixture thuần: không DB, không cước thật; oracle = tự tính lại bằng tay (số pallet × đơn giá, thứ tự ưu tiên).
import { describe, it, expect } from 'vitest'
import {
  runDispatch, fits, splitOversize, classKey, mergeKey, clusterKey, pickBookingCategory, codePrefixOf, tripLoad, sumLines, buildCtx, priceFor,
  mainCatsOf, lineConditions, resolveAllowedModels, mixBlockReason, splitLoad, priceCombo,
  type EngineInput, type EngineModel, type EngineOd, type EngineCarrier, type EngineTariff, type EngineLine,
} from '../../src/services/dispatchEngine'

const model = (o: Partial<EngineModel> & { id: string }): EngineModel => ({
  sap_code: o.id, name: o.id, parent_type_name: 'XE PALLET', capacity_mode: 'PALLET', max_pallets: 9, max_tons: null,
  tariff_unit: 'PER_PALLET', underload_pct: 70, serve_conditions: null, max_drops: null, is_active: true, ...o,
})
const M9 = model({ id: 'M9' })
const M16 = model({ id: 'M16', max_pallets: 16 })
const A: EngineCarrier = { id: 'A', code: 'A', name: 'ĐVVT A' }
const B: EngineCarrier = { id: 'B', code: 'B', name: 'ĐVVT B' }
const tariff = (carrier: string, m: string, ward: string, price: number, km: number | null = 10): EngineTariff =>
  ({ id: `${carrier}|${m}|${ward}`, transport_company_id: carrier, vehicle_model_id: m, ward_code: ward, price, distance_km: km, effective_from: '2026-01-01', effective_to: null, is_active: true })
const line = (pallets: number, over: Partial<EngineLine> = {}): EngineLine => ({ material_code: 'M1', qty_base: 1, pallets, kg: pallets * 500, category: 'FG01', condition: null, ...over })
const od = (n: string, ward: string, pallets: number, over: Partial<EngineOd> = {}): EngineOd => ({
  od_number: n, ship_to_code: `S${n}`, ship_to_name: null, ward_code: ward, region_code: 'R1', channel: null, flow: 'SALE',
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
  it('28/09 — không tự ép: chỉ khách BẬT "Đi xe riêng" mới có khoá riêng theo ship-to, còn lại một lớp chung', () => {
    expect(classKey(od('1', 'W1', 1, { separate: true }))).toBe('SEP:S1')
    expect(classKey(od('1', 'W1', 1, { separate: false }))).toBe('ALL')
    expect(classKey(od('1', 'W1', 1))).toBe('ALL')
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
  it('hạ xe ba bậc: xe 30 pallet rẻ nhất/pallet nhưng 3 pallet ⇒ chọn M9 NHỎ NHẤT (không ai đủ tải, không lấy "rẻ nhất tuyệt đối"); 8 pallet ⇒ M9 đủ tải; 20 pallet ⇒ M30 duy nhất vừa', () => {
    const M30 = model({ id: 'M30', max_pallets: 30 })
    const cheapBig = [tariff('A', 'M30', 'W1', 50_000), tariff('A', 'M9', 'W1', 100_000), tariff('A', 'M16', 'W1', 80_000)]
    const t3 = runDispatch(input([od('1', 'W1', 3)], { models: [M9, M16, M30], tariffs: cheapBig })).trips[0]
    expect(t3.vehicle_model?.id).toBe('M9'); expect(t3.freight.total).toBe(3 * 100_000)
    expect(t3.carrier_reasons.join(' ')).toMatch(/nhỏ nhất còn vừa/)
    const t8 = runDispatch(input([od('1', 'W1', 8)], { models: [M9, M16, M30], tariffs: cheapBig })).trips[0]
    expect(t8.vehicle_model?.id).toBe('M9'); expect(t8.underload).toBe(false)
    // 12 pallet: M16 75 % đủ tải (80k) · M30 40 % không ⇒ M16 dù M30 rẻ hơn
    const t12 = runDispatch(input([od('1', 'W1', 12)], { models: [M9, M16, M30], tariffs: cheapBig })).trips[0]
    expect(t12.vehicle_model?.id).toBe('M16')
    const t20 = runDispatch(input([od('1', 'W1', 20)], { models: [M9, M16, M30], tariffs: cheapBig })).trips[0]
    expect(t20.vehicle_model?.id).toBe('M30'); expect(t20.oversize).toBe(false)
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
  it('khách bật "Đi xe riêng" không đi chung với khách khác cùng phường; tắt (mặc định) thì ghép bình thường', () => {
    expect(runDispatch(input([od('1', 'W1', 2, { separate: true }), od('2', 'W1', 2)])).trips).toHaveLength(2)
    expect(runDispatch(input([od('1', 'W1', 2), od('2', 'W1', 2)])).trips).toHaveLength(1)
  })
})

describe('28/09 — số khách tối đa cùng xe theo KHÁCH / KÊNH (mặc định không giới hạn)', () => {
  it('OD khai max_customers 1 ⇒ không ghép với khách khác; OD không khai ⇒ ghép; OD khắt khe nhất áp cho cả xe', () => {
    expect(runDispatch(input([od('1', 'W1', 2, { max_customers: 1 }), od('2', 'W1', 2)])).trips).toHaveLength(2)
    expect(runDispatch(input([od('1', 'W1', 2, { max_customers: null }), od('2', 'W1', 2)])).trips).toHaveLength(1)
    // 3 khách: một khách chịu tối đa 2 ⇒ xe chở khách đó chỉ 2 khách, khách thứ ba đi xe khác
    const r = runDispatch(input([od('1', 'W1', 1, { max_customers: 2 }), od('2', 'W1', 1), od('3', 'W1', 1)]))
    expect(r.trips).toHaveLength(2)
    const withOne = r.trips.find(t => t.ods.some(o => o.od_number === '1'))!
    expect(withOne.ods).toHaveLength(2)
  })
  it('kho không giới hạn điểm giao (max_drops null) ⇒ 5 khách 1 pallet cùng phường lên một xe', () => {
    const r = runDispatch(input(['1', '2', '3', '4', '5'].map(n => od(n, 'W1', 1)), { params: { ...params, max_drops: null } }))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].ods).toHaveLength(5)
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
  it('lý do phải nêu ĐÚNG bước thu hẹp: tỷ trọng lọc còn 1 ĐVVT ⇒ KHÔNG được nói "duy nhất có cước"', () => {
    // Đo Ba Vì 07/09: 22/22 chuyến nói "ĐVVT duy nhất có cước" trong khi CẢ 3 ĐVVT đều có cước cho
    // mọi (phường × dòng xe) — pool bị bộ lọc TỶ TRỌNG thu hẹp, không phải vì thiếu báo giá.
    const r = runDispatch(input([od('1', 'W1', 8, { region_code: 'R1' }), od('2', 'W1', 8, { region_code: 'R2' })], {
      share_targets: [{ transport_company_id: 'A', share_pct: 30, basis: 'TRIPS' }, { transport_company_id: 'B', share_pct: 70, basis: 'TRIPS' }],
    }))
    const b = r.trips.find(t => t.carrier?.id === 'B')!
    const w = b.carrier_reasons.join(' ')
    expect(w).toMatch(/dưới tỷ trọng kỳ \(2 ĐVVT có cước cho tuyến này\)/)
    expect(w).not.toMatch(/duy nhất có cước cho tuyến/)
  })
  it('chỉ MỘT ĐVVT có cước thật ⇒ vẫn nói đúng "duy nhất có cước" (không nới lỏng câu đúng)', () => {
    // B chỉ chào giá ở W1, nên ở W2 chỉ còn A — đây mới là ca câu cũ nói đúng.
    const t = runDispatch(input([od('1', 'W2', 8)])).trips[0]
    expect(t.carrier?.id).toBe('A')
    expect(t.carrier_reasons.join(' ')).toMatch(/ĐVVT duy nhất có cước cho tuyến\/dòng xe này/)
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
})

// ── Luật 4 — ĐIỀU KIỆN BẢO QUẢN (user chốt 24/09: lạnh âm · 2–8 · 15–25 · thường) ──
describe('luật 4 — điều kiện bảo quản: hàng theo Loại kho, xe khai phục vụ được mức nào', () => {
  const AMB = model({ id: 'AMB', serve_conditions: ['AMBIENT'] })
  const COLD = model({ id: 'COLD', serve_conditions: ['FROZEN', 'CHILL', 'COOL'] })
  const MIX = model({ id: 'MIX', serve_conditions: ['FROZEN', 'CHILL', 'COOL', 'AMBIENT'] })
  const T = (m: string, w = 'W1', p = 100_000) => tariff('A', m, w, p)
  const chilled = (n: string, ward: string, pallets: number) => od(n, ward, 0, { lines: [line(pallets, { category: 'FG02', condition: 'CHILL' })] })
  const ambient = (n: string, ward: string, pallets: number) => od(n, ward, 0, { lines: [line(pallets, { category: 'FG01', condition: 'AMBIENT' })] })
  const labels = { CHILL: '2 – 8 °C', AMBIENT: 'Thường' }

  it('hàng 2–8 °C chỉ lên xe lạnh, không lên xe thường dù xe thường rẻ hơn', () => {
    const r = runDispatch(input([chilled('1', 'W1', 8)], { models: [AMB, COLD], tariffs: [T('AMB', 'W1', 50_000), T('COLD')] }))
    expect(r.trips[0].vehicle_model?.id).toBe('COLD')
    expect(r.trips[0].conditions).toEqual(['CHILL'])
  })
  it('không xe nào phục vụ điều kiện ⇒ cảnh báo gọi ĐÚNG TÊN mức và chỉ chỗ khai, không im lặng', () => {
    const r = runDispatch(input([chilled('1', 'W1', 8)], { models: [AMB], tariffs: [T('AMB')], condition_labels: labels }))
    expect(r.trips[0].vehicle_model).toBeNull()
    expect(r.trips[0].warnings.join(' ')).toMatch(/phục vụ điều kiện bảo quản 2 – 8 °C/)
    expect(r.trips[0].warnings.join(' ')).toMatch(/Mã dòng xe/)
  })
  it('ĐÃ khai xe lạnh nhưng đội xe lạnh quá nhỏ ⇒ bảo TÁCH CHUYẾN kèm số, KHÔNG giục đi khai thêm', () => {
    // Ca thật ở Ba Vì 07/09 sau khi khai FG02 = 2–8 °C: 31,564 pallet hàng lạnh, xe lạnh lớn nhất 30 pallet.
    // Giục "khai ở Cài đặt TMS" ở đây là mời người ta tick bừa xe thường thành xe lạnh.
    // 25/09: OD tách được theo dòng hàng ⇒ máy TỰ TÁCH theo xe lạnh lớn nhất (bản trước để nguyên 12 pallet một chuyến
    // "chưa chọn dòng xe" rồi bảo người tách tay). Chỉ khi MỘT dòng hàng lớn hơn xe lạnh mới còn phải báo.
    const AMB16 = model({ id: 'AMB16', max_pallets: 16, serve_conditions: ['AMBIENT'] })   // xe thường CHỞ ĐƯỢC 12 pallet, xe lạnh thì không
    const two = od('1', 'W1', 0, { lines: [line(6, { category: 'FG02', condition: 'CHILL', material_code: 'a' }), line(6, { category: 'FG02', condition: 'CHILL', material_code: 'b' })] })
    const r = runDispatch(input([two], { models: [AMB16, COLD], tariffs: [T('AMB16', 'W1', 50_000), T('COLD')], condition_labels: labels }))
    expect(r.trips).toHaveLength(2)
    expect(r.trips.every(t => t.vehicle_model?.id === 'COLD')).toBe(true)
    const one = runDispatch(input([chilled('1', 'W1', 12)], { models: [AMB16, COLD], tariffs: [T('AMB16', 'W1', 50_000), T('COLD')], condition_labels: labels }))
    const w = one.trips[0].warnings.join(' ')
    expect(one.trips[0].vehicle_model?.id).toBe('COLD')        // không bao giờ đẩy hàng lạnh lên xe thường
    expect(one.trips[0].oversize).toBe(true)
    expect(w).toMatch(/lớn hơn xe lớn nhất/)
    expect(w).not.toMatch(/Mã dòng xe/)
  })
  it('vượt tải thì vẫn báo "không vừa tải", KHÔNG đổ tại điều kiện bảo quản', () => {
    const r = runDispatch(input([chilled('1', 'W1', 40)], { models: [COLD], tariffs: [T('COLD')], condition_labels: labels }))
    expect(r.trips[0].warnings.join(' ')).toMatch(/không vừa tải|lớn hơn xe lớn nhất/i)
  })
  it('lạnh + thường cùng phường: CÓ xe kết hợp ⇒ một chuyến; KHÔNG có ⇒ TỰ TÁCH hai chuyến (không bế tắc)', () => {
    const ods = [chilled('1', 'W1', 3), ambient('2', 'W1', 3)]
    const withMix = runDispatch(input(ods, { models: [AMB, COLD, MIX], tariffs: [T('AMB'), T('COLD'), T('MIX')] }))
    expect(withMix.trips).toHaveLength(1)
    expect(withMix.trips[0].vehicle_model?.id).toBe('MIX')
    expect(withMix.trips[0].conditions).toEqual(['AMBIENT', 'CHILL'])
    const noMix = runDispatch(input(ods, { models: [AMB, COLD], tariffs: [T('AMB'), T('COLD')] }))
    expect(noMix.trips).toHaveLength(2)
    expect(noMix.trips.map(t => t.vehicle_model?.id).sort()).toEqual(['AMB', 'COLD'])
    expect(noMix.trips.every(t => t.conditions.length === 1)).toBe(true)
  })
  it('gộp chuyến Non tải cùng vùng cũng không được trộn hai điều kiện khi thiếu xe kết hợp', () => {
    const r = runDispatch(input([chilled('1', 'W1', 2), ambient('2', 'W2', 2)], { models: [AMB, COLD], tariffs: [T('AMB', 'W1'), T('COLD', 'W1'), T('AMB', 'W2'), T('COLD', 'W2')] }))
    expect(r.trips).toHaveLength(2)
  })
  it('tương thích ngược: xe khai RỖNG = chở mọi điều kiện · Loại kho chưa khai ⇒ hàng không ràng buộc gì', () => {
    const blank = model({ id: 'BLANK' })
    expect(runDispatch(input([chilled('1', 'W1', 8)], { models: [blank], tariffs: [T('BLANK')] })).trips[0].vehicle_model?.id).toBe('BLANK')
    const r = runDispatch(input([od('1', 'W1', 8)], { models: [AMB, COLD], tariffs: [T('AMB', 'W1', 50_000), T('COLD')] }))
    expect(r.trips[0].vehicle_model?.id).toBe('AMB')     // hàng chưa khai điều kiện ⇒ rẻ nhất như trước
    expect(r.trips[0].conditions).toEqual([])
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

describe('vá 25/09 — bin có hàng lạnh phải vừa MỘT dòng xe vừa phục vụ lạnh vừa đủ tải', () => {
  // Đội xe thật Ba Vì: xe thường tới 68 pallet, xe kết hợp (lạnh + thường) lớn nhất 30 pallet
  const BIG = model({ id: 'BIG', max_pallets: 68, serve_conditions: ['AMBIENT'] })
  const MIX = model({ id: 'MIX', max_pallets: 30, serve_conditions: ['CHILL', 'AMBIENT'] })
  const inp = (ods: EngineOd[]) => input(ods, { models: [BIG, MIX], tariffs: [] })
  it('33 pl thường + 19 pl lạnh + 2 pl thường cùng phường ⇒ KHÔNG chuyến nào thiếu dòng xe (bản cũ gom 54 pl một chuyến)', () => {
    const r = runDispatch(inp([
      od('1', 'W1', 33, { lines: [line(33, { condition: 'AMBIENT' })] }),
      od('2', 'W1', 19, { lines: [line(19, { condition: 'CHILL' })] }),
      od('3', 'W1', 2, { lines: [line(2, { condition: 'AMBIENT' })] }),
    ]))
    expect(r.trips.every(t => t.vehicle_model != null)).toBe(true)
    for (const t of r.trips) expect(fits(t.vehicle_model!, t.pallets, t.tons)).toBe(true)
    const cold = r.trips.find(t => t.conditions.includes('CHILL'))!
    expect(cold.vehicle_model?.id).toBe('MIX')
  })
  it('OD lạnh 31,5 pl ⇒ tách theo xe LẠNH lớn nhất (30), không theo xe thường 68', () => {
    const o = od('9', 'W1', 0, { lines: [line(16, { condition: 'CHILL', material_code: 'a' }), line(15.5, { condition: 'CHILL', material_code: 'b' })] })
    const r = runDispatch(inp([o]))
    expect(r.trips.length).toBe(2)
    expect(r.trips.every(t => t.vehicle_model?.id === 'MIX' && (t.pallets ?? 0) <= 30)).toBe(true)
  })
})

describe('luật 7 BỎ (user 29/09: "dòng xe là đơn vị thấp hơn của loại xe — bỏ loại xe, chọn dòng xe luôn")', () => {
  // Không còn kiểu đi Pallet / Xá của khách hay của xe. "Xe pallet một khách" = `max_drops = 1` khai ở CHÍNH dòng xe;
  // hai khách chung xe hay không do danh sách "Dòng xe được vào" GIAO nhau quyết.
  const P10 = model({ id: 'P10', max_pallets: 10, max_drops: 1 })
  const T8 = model({ id: 'T8', capacity_mode: 'TON', max_pallets: null, max_tons: 8, tariff_unit: 'PER_TRIP' })
  const inp = (ods: EngineOd[], models: EngineModel[] = [P10, T8]) => input(ods, { models, tariffs: [] })
  it('dòng xe khai max_drops = 1 ⇒ hai khách cùng phường được vào đúng dòng đó đi HAI xe, mỗi xe một khách', () => {
    const r = runDispatch(inp([od('1', 'W1', 3, { allowed_models: ['P10'] }), od('2', 'W1', 3, { allowed_models: ['P10'] })]))
    expect(r.trips).toHaveLength(2)
    expect(r.trips.every(t => t.vehicle_model?.id === 'P10' && t.stops === 1)).toBe(true)
  })
  it('dòng xe đó khai max_drops = 2 ⇒ MỘT xe hai khách (cấu hình ở Mã dòng xe, không phải tham số kho)', () => {
    const r = runDispatch(inp([od('1', 'W1', 3, { allowed_models: ['P10'] }), od('2', 'W1', 3, { allowed_models: ['P10'] })], [model({ ...P10, max_drops: 2 }), T8]))
    expect(r.trips).toHaveLength(1); expect(r.trips[0].stops).toBe(2)
  })
  it('khách A chỉ vào T8, khách B chỉ vào P10 ⇒ không dòng xe chung ⇒ hai xe; cả hai cùng vào T8 ⇒ một xe', () => {
    const r = runDispatch(inp([od('1', 'W1', 2, { allowed_models: ['T8'] }), od('2', 'W1', 2, { allowed_models: ['P10'] })]))
    expect(r.trips).toHaveLength(2)
    expect(r.trips.map(t => t.vehicle_model?.id).sort()).toEqual(['P10', 'T8'])
    const r2 = runDispatch(inp([od('1', 'W1', 2, { allowed_models: ['T8'] }), od('2', 'W1', 2, { allowed_models: ['T8'] })]))
    expect(r2.trips).toHaveLength(1); expect(r2.trips[0].vehicle_model?.id).toBe('T8'); expect(r2.trips[0].stops).toBe(2)
  })
  it('không còn họ xe ngầm: OD không khai danh sách (dòng cũ) mà đội xe chỉ có xe đo bằng pallet vẫn lên xe đó, câu lý do không nói "Pallet / Xá"', () => {
    const r = runDispatch(inp([od('1', 'W1', 2), od('2', 'W1', 2)], [model({ id: 'P9' })]))
    expect(r.trips).toHaveLength(1); expect(r.trips[0].stops).toBe(2)
    const r2 = runDispatch(inp([od('3', 'W1', 2)], [model({ id: 'Z', max_pallets: null })]))
    expect(r2.trips).toHaveLength(0)
    expect(r2.unplanned[0].reason).not.toMatch(/Pallet|Xá/)
  })
})
describe('luật 8 BỎ (user 28/09: "dòng xe chọn theo khai báo của khách, khách không khai thì không chọn")', () => {
  const T15 = model({ id: 'T15', capacity_mode: 'TON', max_pallets: null, max_tons: 15, tariff_unit: 'PER_TRIP' })
  const CONT = model({ id: 'CONT', parent_type_name: 'XE CONTAINER', capacity_mode: 'TON', max_pallets: null, max_tons: 26, tariff_unit: 'PER_TRIP' })
  const big = (n: string, over: Partial<EngineOd> = {}) => od(n, 'W1', 0, { lines: [line(1, { kg: 20_000 })], ...over })
  const inp = (ods: EngineOd[]) => input(ods, { models: [T15, CONT], tariffs: [] })
  it('khách chưa khai (danh sách rỗng) ⇒ KHÔNG chọn xe nào: không chuyến, unplanned code NO_VEHICLE nêu chỗ khai', () => {
    const r = runDispatch(inp([big('1', { allowed_models: [] })]))
    expect(r.trips).toHaveLength(0)
    expect(r.unplanned[0]).toMatchObject({ od_number: '1', code: 'NO_VEHICLE' })
    expect(r.unplanned[0].reason).toMatch(/chưa có dòng xe nào được vào.*theo kênh/)
  })
  it('OD trung chuyển KHÔNG còn luật riêng: kho đích khai container ⇒ container; cờ transfer vẫn chụp trên dòng OD', () => {
    const r = runDispatch(inp([big('2', { flow: 'STO', allowed_models: ['CONT'] })]))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].vehicle_model?.id).toBe('CONT')
    expect(r.trips[0].ods[0].transfer).toBe(true)
    // trung chuyển mà kho đích chỉ khai xe 15 tấn ⇒ không lên container
    const r2 = runDispatch(inp([big('3', { flow: 'STO', allowed_models: ['T15'] })]))
    expect(r2.trips.every(t => t.vehicle_model?.id === 'T15')).toBe(true)
  })
})
describe('hàng lạnh của khách vào xe pallet lẫn xe SCA (29/09: không còn luật 7b đổi kiểu đi — chỉ còn danh sách + điều kiện bảo quản)', () => {
  const COLD = 'CHILL'
  const P16 = model({ id: 'P16', max_pallets: 16, max_tons: 16, serve_conditions: ['AMBIENT'] })
  const MIX16 = model({ id: 'MIX16', parent_type_name: 'XE SCA', max_pallets: 16, max_tons: 16, serve_conditions: ['CHILL', 'AMBIENT'] })
  const coldOd = (n: string, over: Partial<EngineOd> = {}) => od(n, 'W1', 0, { allowed_models: ['P16', 'MIX16'], lines: [line(5, { condition: COLD })], ...over })
  it('hàng thường ⇒ lên xe đúng mức (P16), không rơi về xe kết hợp', () => {
    const r = runDispatch(input([od('1', 'W1', 5, { allowed_models: ['P16', 'MIX16'], lines: [line(5, { condition: 'AMBIENT' })] })], { models: [P16, MIX16], tariffs: [], params: { ...params, combo_conditions: ['AMBIENT', 'CHILL'] } }))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].vehicle_model?.id).toBe('P16')
  })
  it('hàng LẠNH ⇒ chỉ MIX16 phục vụ ⇒ lên MIX16, không cảnh báo "khách đi Pallet"', () => {
    const r = runDispatch(input([coldOd('2')], { models: [P16, MIX16], tariffs: [] }))
    expect(r.unplanned).toHaveLength(0)
    expect(r.trips[0].vehicle_model?.id).toBe('MIX16')
    expect(r.trips[0].warnings.join(' ')).not.toMatch(/Pallet|Xá/)
  })
  it('không xe nào trong danh sách chở lạnh ⇒ cảnh báo luật 4 nói đúng "không dòng xe nào phục vụ điều kiện bảo quản"', () => {
    const r = runDispatch(input([coldOd('3', { allowed_models: ['P16'] })], { models: [P16], tariffs: [] }))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].warnings.join(' ')).toMatch(/không dòng xe nào phục vụ điều kiện bảo quản/i)
  })
})
describe('luật 9 — không trộn Loại kho trên một chuyến (user 26/09: "FG01 đi FG01, FG02 đi FG02, muốn đi chung phải bật")', () => {
  // xe khai rỗng điều kiện = chở mọi mức ⇒ ca này CHỈ còn luật 9 quyết tách hay gộp
  const noMix = { ...params, allow_mix_categories: false, follow_categories: ['PM01'] }
  const fg = (n: string, cat: string, over: Partial<EngineOd> = {}) => od(n, 'W1', 3, { lines: [line(3, { category: cat })], ...over })
  it('FG01 + FG02 cùng phường · kho KHÔNG cho trộn ⇒ HAI chuyến, mỗi chuyến một loại', () => {
    const r = runDispatch(input([fg('1', 'FG01'), fg('2', 'FG02')], { params: noMix }))
    expect(r.trips).toHaveLength(2)
    expect(r.trips.map(t => t.categories.join('+')).sort()).toEqual(['FG01', 'FG02'])
  })
  it('kho BẬT cho trộn ⇒ một chuyến (hành vi trước 26/09)', () => {
    const r = runDispatch(input([fg('1', 'FG01'), fg('2', 'FG02')], { params: { ...noMix, allow_mix_categories: true } }))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].categories).toEqual(['FG01', 'FG02'])
  })
  it('POSM "đi theo đơn": OD chỉ có POSM của CÙNG khách ké vào chuyến FG01 của khách đó, không đẻ chuyến riêng', () => {
    const r = runDispatch(input([fg('1', 'FG01', { ship_to_code: 'K1' }), od('2', 'W1', 1, { ship_to_code: 'K1', lines: [line(1, { category: 'PM01' })] })], { params: noMix }))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].ods.map(o => o.od_number).sort()).toEqual(['1', '2'])
  })
  it('POSM ké ưu tiên chuyến của chính khách đó khi cùng phường có cả chuyến FG01 lẫn FG02', () => {
    const r = runDispatch(input([fg('1', 'FG01', { ship_to_code: 'K1' }), fg('2', 'FG02', { ship_to_code: 'K2' }), od('3', 'W1', 1, { ship_to_code: 'K2', lines: [line(1, { category: 'PM01' })] })], { params: noMix }))
    expect(r.trips).toHaveLength(2)
    expect(r.trips.find(t => t.ods.some(o => o.od_number === '3'))?.categories).toContain('FG02')
  })
  it('OD FG01 kèm dòng POSM KHÔNG bị coi là trộn loại (không cảnh báo)', () => {
    const r = runDispatch(input([od('1', 'W1', 3, { lines: [line(2, { category: 'FG01' }), line(1, { category: 'PM01', material_code: 'P' })] })], { params: noMix }))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].warnings.join(' ')).not.toMatch(/nhiều Loại kho/)
  })
  it('một OD tự chứa FG01 + FG02 ⇒ không tách được OD: một chuyến kèm cảnh báo nêu số OD', () => {
    const r = runDispatch(input([od('9', 'W1', 3, { lines: [line(2, { category: 'FG01' }), line(1, { category: 'FG02', material_code: 'X' })] })], { params: noMix }))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].warnings.join(' ')).toMatch(/1 OD chứa nhiều Loại kho \(FG01 \+ FG02\).*OD:9/)
  })
  it('POSM riêng lẻ không có chuyến nào cùng cụm ⇒ Ở LẠI khung chờ với lý do, KHÔNG đi xe riêng (user 30/09: "POSM đi chung hàng, không được tự ghép POSM đi một xe riêng")', () => {
    const r = runDispatch(input([od('5', 'W2', 1, { lines: [line(1, { category: 'PM01' })] })], { params: noMix }))
    expect(r.trips).toHaveLength(0)
    expect(r.unplanned).toEqual([{ od_number: '5', ship_to_code: 'S5', code: 'FOLLOW_ONLY', reason: expect.stringMatching(/hàng đi kèm .*chờ đơn hàng chính/) }])
  })
  it('OD toàn mã CHƯA KHAI Loại kho KHÔNG phải POSM: vẫn lên xe như hàng thường (01/10: 17 OD Ba Vì kẹt khung chờ oan với lý do "chỉ POSM")', () => {
    const r = runDispatch(input([od('6', 'W2', 2, { lines: [line(2, { category: null })] })], { params: noMix }))
    expect(r.unplanned).toHaveLength(0)
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].ods.map(o => o.od_number)).toEqual(['6'])
  })
  it('THẺ NHIỀU XE của cùng khách nhận POSM và OD nhỏ của khách đó khi N xe còn chở vừa (Ba Vì 30/09: #68 0,7 pallet POSM cạnh #70 2 × 17 pallet)', () => {
    // OD 20 pallet > xe lớn nhất 16 ⇒ đi 2 × M16 (còn 12 pallet trống); POSM 1 pallet + OD nhỏ 2 pallet CÙNG khách phải ké vào
    const big = od('1', 'W1', 20, { ship_to_code: 'K1' })
    const posm = od('2', 'W1', 1, { ship_to_code: 'K1', lines: [line(1, { category: 'PM01' })] })
    const small = od('3', 'W1', 2, { ship_to_code: 'K1' })
    const r = runDispatch(input([big, posm, small], { params: { ...noMix, max_vehicles: 2 } }))
    expect(r.unplanned).toHaveLength(0)
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].vehicles).toHaveLength(2)
    expect(r.trips[0].ods.map(o => o.od_number).sort()).toEqual(['1', '2', '3'])
    // khách KHÁC thì không ké vào thẻ nhiều xe (chỉ khách của chính thẻ)
    const other = od('4', 'W1', 2, { ship_to_code: 'K2' })
    const r2 = runDispatch(input([big, other], { params: { ...noMix, max_vehicles: 2 } }))
    expect(r2.trips).toHaveLength(2)
  })
})
describe('Loại kho chính của OD', () => {
  it('mainCatsOf bỏ loại đi kèm + dòng chưa khai loại', () => {
    expect(mainCatsOf([{ category: 'PM01' }, { category: 'FG01' }, { category: null }, { category: 'FG01' }], ['PM01'])).toEqual(['FG01'])
  })
})
describe('ĐK bảo quản theo VỊ TRÍ (user 26/09: "kho RM01 có cả kho lạnh, thường — mặc định theo loại kho")', () => {
  it('mã không nằm ở ô khai riêng ⇒ theo Loại kho; nằm ở ô lạnh ⇒ lạnh; nằm cả ô lạnh lẫn ô theo loại ⇒ cả hai', () => {
    expect(lineConditions('AMBIENT', undefined)).toEqual(['AMBIENT'])
    expect(lineConditions(null, [])).toEqual([])
    expect(lineConditions('AMBIENT', ['CHILL'])).toEqual(['CHILL'])
    expect(lineConditions('AMBIENT', [null, 'CHILL'])).toEqual(['AMBIENT', 'CHILL'])
    expect(lineConditions(null, [null])).toEqual([])
  })
  it('hàng "đi kèm đơn" (POSM) KHÔNG áp ĐK lên xe — kể cả khi Loại kho khai Thường hoặc nằm ở ô lạnh', () => {
    expect(lineConditions('AMBIENT', undefined, true)).toEqual([])
    expect(lineConditions('AMBIENT', ['CHILL'], true)).toEqual([])
  })
  it('POSM khai Thường đi kèm đơn FG02 (2–8 °C) ⇒ xe LẠNH chở được, không bị ép sang xe kết hợp', () => {
    const COLD = model({ id: 'COLD', max_pallets: 10, serve_conditions: ['CHILL'] })
    const MIX = model({ id: 'MIX', max_pallets: 10, serve_conditions: ['CHILL', 'AMBIENT'] })
    const posm = { material_code: 'P', qty_base: 1, pallets: 1, kg: 100, category: 'PM01', condition: 'AMBIENT', conditions: lineConditions('AMBIENT', undefined, true) }
    const r = runDispatch(input([od('1', 'W1', 3, { lines: [line(3, { category: 'FG02', condition: 'CHILL' }), posm] })],
      { models: [COLD, MIX], tariffs: [tariff('A', 'COLD', 'W1', 100_000), tariff('A', 'MIX', 'W1', 150_000)], params: { ...params, allow_mix_categories: false, follow_categories: ['PM01'] } }))
    expect(r.trips[0].conditions).toEqual(['CHILL'])
    expect(r.trips[0].vehicle_model?.id).toBe('COLD')
  })
  it('dòng hàng mang ĐK theo vị trí (conditions) THAY ĐK theo loại ⇒ máy chọn xe lạnh dù Loại kho là hàng thường', () => {
    const AMB = model({ id: 'AMB', max_pallets: 10, serve_conditions: ['AMBIENT'] })
    const COLD = model({ id: 'COLD', max_pallets: 10, serve_conditions: ['CHILL'] })
    const r = runDispatch(input([od('1', 'W1', 3, { lines: [line(3, { category: 'RM01', condition: 'AMBIENT', conditions: ['CHILL'] })] })], { models: [AMB, COLD], tariffs: [] }))
    expect(r.trips[0].vehicle_model?.id).toBe('COLD')
    expect(r.trips[0].conditions).toEqual(['CHILL'])
  })
})
describe('xe LỚN NHẤT trong họ xe trộn hai cách đo + chuyến vượt tải (đo Bàu Bàng 26/09: 6 chuyến 18–27 tấn lên xe 1 tấn, tải 2.737 %)', () => {
  // họ xá sau 26/09 có cả xe kết hợp đo bằng PALLET (17 pallet / 16 tấn) lẫn xe tải đo bằng TẤN (30 tấn)
  const K17 = model({ id: 'K17', parent_type_name: 'XE SCA', capacity_mode: 'PALLET', max_pallets: 17, max_tons: 16 })
  const T1 = model({ id: 'T1', parent_type_name: 'XE XÁ', capacity_mode: 'TON', max_pallets: null, max_tons: 1, tariff_unit: 'PER_TRIP', pallet_truck: false })
  const T30 = model({ id: 'T30', parent_type_name: 'XE XÁ', capacity_mode: 'TON', max_pallets: null, max_tons: 30, tariff_unit: 'PER_TRIP', pallet_truck: false })
  const tar = [tariff('A', 'K17', 'W1', 50_000), tariff('A', 'T1', 'W1', 300_000), tariff('A', 'T30', 'W1', 5_000_000)]
  const heavy = (n: string, tons: number) => od(n, 'W1', 0, { lines: [line(tons * 1.06, { kg: tons * 1000 })] })
  it('dòng hàng 27 tấn · họ có xe 30 tấn ⇒ KHÔNG vượt tải, lên xe 30 tấn (bản cũ coi xe 17 pallet là lớn nhất vì so pallet trước)', () => {
    const r = runDispatch(input([heavy('1', 27)], { models: [K17, T1, T30], tariffs: tar }))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].oversize).toBe(false)
    expect(r.trips[0].vehicle_model?.id).toBe('T30')
  })
  it('dòng hàng 40 tấn lớn hơn MỌI xe ⇒ vượt tải, nhưng xếp lên xe LỚN NHẤT (30 tấn), không phải xe rẻ nhất 1 tấn', () => {
    const r = runDispatch(input([heavy('2', 40)], { models: [K17, T1, T30], tariffs: tar }))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].oversize).toBe(true)
    expect(r.trips[0].vehicle_model?.id).toBe('T30')
  })
})
describe('luật 4b — xe kết hợp chỉ khi ghép (user 26/09: "được ghép thì mới lôi vào")', () => {
  const AMB = model({ id: 'AMB', max_pallets: 10, serve_conditions: ['AMBIENT'] })
  const COMBO = model({ id: 'COMBO', max_pallets: 10, serve_conditions: ['CHILL', 'AMBIENT'] })
  const tar = [tariff('A', 'AMB', 'W1', 150_000), tariff('A', 'COMBO', 'W1', 100_000)]   // xe kết hợp RẺ hơn — bẫy của cước giả định
  const combo = { ...params, combo_conditions: ['AMBIENT', 'CHILL'], allow_mix_categories: true }
  const fg01 = (n: string) => od(n, 'W1', 8, { lines: [line(8, { category: 'FG01', condition: 'AMBIENT' })] })
  it('chuyến chỉ FG01 (Thường) ⇒ xe THƯỜNG dù xe kết hợp rẻ hơn', () => {
    const r = runDispatch(input([fg01('1')], { models: [AMB, COMBO], tariffs: tar, params: combo }))
    expect(r.trips[0].vehicle_model?.id).toBe('AMB')
  })
  it('chuyến ghép FG01 + FG02 (cần hai mức) ⇒ xe kết hợp', () => {
    const r = runDispatch(input([od('2', 'W1', 8, { lines: [line(5, { category: 'FG01', condition: 'AMBIENT' }), line(3, { category: 'FG02', condition: 'CHILL', material_code: 'X' })] })],
      { models: [AMB, COMBO], tariffs: tar, params: combo }))
    expect(r.trips[0].vehicle_model?.id).toBe('COMBO')
  })
  it('không xe thường nào có cước ⇒ rơi về xe kết hợp và NÓI lý do', () => {
    const r = runDispatch(input([fg01('3')], { models: [AMB, COMBO], tariffs: [tariff('A', 'COMBO', 'W1', 100_000)], params: combo }))
    expect(r.trips[0].vehicle_model?.id).toBe('COMBO')
    expect(r.trips[0].carrier_reasons.join(' ')).toMatch(/xe kết hợp/)
  })
  it('không khai combo_conditions (dữ liệu/test cũ) ⇒ như trước: rẻ nhất', () => {
    const r = runDispatch(input([fg01('4')], { models: [AMB, COMBO], tariffs: tar }))
    expect(r.trips[0].vehicle_model?.id).toBe('COMBO')
  })
})
describe('luật 10 — dòng xe được vào theo Kênh → Khách × Loại kho (user 27/09: "khách hàng nào vào được dòng xe nào")', () => {
  const T5 = model({ id: 'T5', parent_type_name: 'XE XÁ', capacity_mode: 'TON', max_pallets: null, max_tons: 5, tariff_unit: 'PER_TRIP' })
  const T15 = model({ id: 'T15', parent_type_name: 'XE XÁ', capacity_mode: 'TON', max_pallets: null, max_tons: 15, tariff_unit: 'PER_TRIP', underload_pct: 20 })   // ngưỡng thấp ⇒ 4 tấn vẫn "đủ tải" ⇒ không khai thì xe 15 tấn RẺ HƠN thắng
  const CONT = model({ id: 'CONT', parent_type_name: 'XE CONTAINER', capacity_mode: 'TON', max_pallets: null, max_tons: 26, tariff_unit: 'PER_TRIP' })
  const tar = [tariff('A', 'T5', 'W1', 900_000), tariff('A', 'T15', 'W1', 800_000), tariff('A', 'CONT', 'W1', 700_000)]
  const tonOd = (n: string, t: number, over: Partial<EngineOd> = {}) => od(n, 'W1', 0, { lines: [line(1, { kg: t * 1000, material_code: `m${n}` })], ...over })
  it('khách chỉ được vào xe 5 tấn ⇒ xe 5 tấn dù xe 15 tấn rẻ hơn; khách không khai ⇒ xe 15 tấn', () => {
    const r = runDispatch(input([tonOd('1', 4, { allowed_models: ['T5'] })], { models: [T5, T15, CONT], tariffs: tar }))
    expect(r.trips[0].vehicle_model?.id).toBe('T5')
    const r2 = runDispatch(input([tonOd('2', 4)], { models: [T5, T15, CONT], tariffs: tar }))
    expect(r2.trips[0].vehicle_model?.id).toBe('T15')
  })
  it('OD 12 tấn nhiều dòng của khách chỉ vào xe 5 tấn ⇒ tách theo xe 5 tấn, mọi chuyến là xe 5 tấn', () => {
    const lines = [4, 4, 4].map((t, i) => line(1, { kg: t * 1000, material_code: `L${i}` }))
    const r = runDispatch(input([od('3', 'W1', 0, { allowed_models: ['T5'], lines })], { models: [T5, T15], tariffs: tar }))
    expect(r.trips.length).toBe(3)
    expect(r.trips.every(t => t.vehicle_model?.id === 'T5' && !t.oversize)).toBe(true)
  })
  it('ghép với khách khác ⇒ chỉ dòng xe CẢ HAI được vào; chụp danh sách lên dòng OD', () => {
    const r = runDispatch(input([tonOd('4', 2, { allowed_models: ['T5'] }), tonOd('5', 2)], { models: [T5, T15, CONT], tariffs: tar }))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].vehicle_model?.id).toBe('T5')
    expect(r.trips[0].ods.find(o => o.od_number === '4')?.allowed_models).toEqual(['T5'])
    expect(r.trips[0].ods.find(o => o.od_number === '5')?.allowed_models).toBeNull()
  })
  it('hai khách cùng phường không có dòng xe CHUNG ⇒ hai chuyến, không ép khách nào lên xe cấm', () => {
    const r = runDispatch(input([tonOd('7', 2, { allowed_models: ['T5'] }), tonOd('8', 2, { allowed_models: ['T15'] })], { models: [T5, T15], tariffs: tar }))
    expect(r.trips).toHaveLength(2)
    expect(r.trips.find(t => t.ods.some(o => o.od_number === '7'))?.vehicle_model?.id).toBe('T5')
    expect(r.trips.find(t => t.ods.some(o => o.od_number === '8'))?.vehicle_model?.id).toBe('T15')
  })
  it('khách xuất khẩu khai container ⇒ ĐI CONTAINER nguyên OD; khách khai xe khác (không tick container) ⇒ không lên container', () => {
    const big = (n: string, over: Partial<EngineOd> = {}) => od(n, 'W1', 0, { lines: [line(1, { kg: 24_750, material_code: `e${n}` })], ...over })
    const r = runDispatch(input([big('9', { allowed_models: ['CONT'] })], { models: [T5, T15, CONT], tariffs: tar }))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].vehicle_model?.id).toBe('CONT')
    expect(r.trips[0].ods[0].part).toBeNull()   // nguyên OD một xe, không tách
    const r2 = runDispatch(input([big('10', { allowed_models: ['T5', 'T15'] })], { models: [T5, T15, CONT], tariffs: tar }))
    expect(r2.trips.every(t => t.vehicle_model?.id !== 'CONT')).toBe(true)
  })
  it('danh sách khai không có dòng xe nào đang hoạt động ⇒ OD ra "không xếp được", nêu đúng chỗ sửa', () => {
    const r = runDispatch(input([tonOd('6', 2, { allowed_models: ['GONE'] })], { models: [T5, T15], tariffs: tar }))
    expect(r.trips).toHaveLength(0)
    expect(r.unplanned[0].reason).toMatch(/Dòng xe được vào/)
  })
})
describe('resolveAllowedModels — thứ tự Khách × Loại kho → Khách → Kênh × Loại kho → Kênh', () => {
  it('khách khai riêng loại thắng mọi bậc; loại không khai rơi về "*" của khách rồi tới kênh', () => {
    const cust = { FG01: ['P1'], '*': ['X1'] }, chan = { FG02: ['S1'], '*': ['A1', 'A2'] }
    expect(resolveAllowedModels(cust, chan, ['FG01'])).toEqual(['P1'])
    expect(resolveAllowedModels(cust, chan, ['FG02'])).toEqual(['X1'])   // "*" của KHÁCH đứng trước loại của kênh
    expect(resolveAllowedModels({ FG01: ['P1'] }, chan, ['FG02'])).toEqual(['S1'])
    expect(resolveAllowedModels({}, chan, ['RM01'])).toEqual(['A1', 'A2'])
  })
  it('28/09 — không bậc nào khai ⇒ [] (khách không khai thì KHÔNG chọn xe); {} rỗng cũng là chưa khai; rỗng tường minh ⇒ []', () => {
    expect(resolveAllowedModels(null, null, ['FG01'])).toEqual([])
    expect(resolveAllowedModels({}, {}, ['FG01'])).toEqual([])
    expect(resolveAllowedModels({ FG01: [] }, null, ['FG01'])).toEqual([])
  })
  it('OD hai Loại kho chính ⇒ GIAO hai danh sách (loại không bậc nào khai ⇒ không xe nào); OD chỉ POSM ⇒ khoá "*"', () => {
    expect(resolveAllowedModels({ FG01: ['A', 'B'], FG02: ['B', 'C'] }, null, ['FG01', 'FG02'])).toEqual(['B'])
    expect(resolveAllowedModels({ FG01: ['A'] }, null, ['FG01', 'FG02'])).toEqual([])   // FG02 chưa khai ở đâu ⇒ không chọn
    expect(resolveAllowedModels({ FG01: ['A'] }, { '*': ['A', 'B'] }, ['FG01', 'FG02'])).toEqual(['A'])   // FG02 lấy theo kênh
    expect(resolveAllowedModels({ '*': ['Z'], FG01: ['A'] }, null, [])).toEqual(['Z'])
  })
})
describe('mixBlockReason — switch "Ghép Loại kho khác" trên thẻ xe (user 27/09: "TẮT = chặn thả")', () => {
  const f1 = { cat_load: { FG01: 5 } }, f2 = { cat_load: { FG02: 3 } }, posm = { cat_load: { PM01: 1 } }, both = { cat_load: { FG01: 2, FG02: 2 } }
  it('tắt: xe FG01 nhận thêm FG02 ⇒ chặn, câu nói rõ xe đang chở gì và bật ở đâu', () => {
    expect(mixBlockReason(false, [f1], [f2], ['PM01'])).toMatch(/đang chở FG01 — OD thả vào là FG02.*Ghép Loại kho khác/)
  })
  it('bật / chưa khai (kế hoạch cũ) ⇒ cho thả', () => {
    expect(mixBlockReason(true, [f1], [f2])).toBeNull()
    expect(mixBlockReason(undefined, [f1], [f2])).toBeNull()
  })
  it('POSM đi kèm, cùng loại, xe trống, một OD tự chứa hai loại ⇒ cho thả', () => {
    expect(mixBlockReason(false, [f1], [posm], ['PM01'])).toBeNull()
    expect(mixBlockReason(false, [f1], [f1])).toBeNull()
    expect(mixBlockReason(false, [], [f2])).toBeNull()
    expect(mixBlockReason(false, [], [both])).toBeNull()
  })
  it('tắt: chọn nhiều OD khác loại thả vào xe trống ⇒ chặn', () => {
    expect(mixBlockReason(false, [], [f1, f2])).toMatch(/nhiều Loại kho \(FG01, FG02\)/)
  })
})

describe('luật 11 — nhiều xe trên một thẻ (user 27/09: "10 tấn dùng xe 8 + 2 thay vì 15 tấn" · "luôn so tổ hợp")', () => {
  it('splitLoad: xe lớn chở đầy trước, phần còn lại sang xe kế; không chở hết / có xe thừa ⇒ null', () => {
    expect(splitLoad([M16, M9], 20, 10)).toEqual([{ pallets: 16, tons: 8 }, { pallets: 4, tons: 2 }])
    expect(splitLoad([M16, M9], 26, 13)).toBeNull()
    expect(splitLoad([M16, M9], 10, 5)).toBeNull()   // M9 không nhận phần nào = xe thừa
  })
  it('OD 20 pallet > xe lớn nhất 16: một xe/thẻ ⇒ TÁCH OD ra 2 chuyến (hành vi cũ); cho 2 xe ⇒ MỘT thẻ M16 + M9, OD nguyên', () => {
    const one = runDispatch(input([od('1', 'W1', 0, { lines: [line(10, { material_code: 'a' }), line(10, { material_code: 'b' })] })]))
    expect(one.trips).toHaveLength(2)
    const two = runDispatch(input([od('1', 'W1', 0, { lines: [line(10, { material_code: 'a' }), line(10, { material_code: 'b' })] })], { params: { ...params, max_vehicles: 2 } }))
    expect(two.trips).toHaveLength(1)
    const t = two.trips[0]
    expect(t.ods[0].part).toBeNull()
    expect(t.vehicles.map(v => v.model.id)).toEqual(['M16', 'M9'])
    // oracle: A · M16 16 pl × 150k + M9 4 pl × 100k = 2,8 tr — rẻ hơn M16 + M16 (20 × 150k = 3 tr)
    expect(t.freight.total).toBe(2_800_000)
    expect(t.vehicles.map(v => v.freight)).toEqual([2_400_000, 400_000])
    expect(t.load.pct).toBe(80)   // 20 / (16 + 9)
    expect(t.oversize).toBe(false)
  })
  const ton = (id: string, t: number) => model({ id, parent_type_name: 'XE TẢI', capacity_mode: 'TON', max_pallets: null, max_tons: t, tariff_unit: 'PER_TRIP' })
  const T15 = ton('T15', 15), T8 = ton('T8', 8), T2 = ton('T2', 2)
  const tonIn = (price15: number, maxVeh: number) => input([od('1', 'W1', 0, { lines: [line(0, { pallets: null, kg: 10_000 })] })], {
    models: [T15, T8, T2], carriers: [A], tariffs: [tariff('A', 'T15', 'W1', price15), tariff('A', 'T8', 'W1', 1_200_000), tariff('A', 'T2', 'W1', 500_000)],
    params: { ...params, max_vehicles: maxVeh },
  })
  it('10 tấn: một xe ⇒ xe 15 tấn 3 tr; cho so tổ hợp ⇒ xe 8 + xe 2 tấn 1,7 tr', () => {
    expect(runDispatch(tonIn(3_000_000, 1)).trips[0].vehicles.map(v => v.model.id)).toEqual(['T15'])
    const t = runDispatch(tonIn(3_000_000, 3)).trips[0]
    expect(t.vehicles.map(v => v.model.id)).toEqual(['T8', 'T2'])
    expect(t.freight.total).toBe(1_700_000)
    expect(t.carrier_reasons[0]).toMatch(/Ghép 2 xe.*rẻ hơn một xe T15/)
  })
  it('tổ hợp KHÔNG rẻ hơn ⇒ giữ một xe (15 tấn chỉ 1,5 tr)', () => {
    expect(runDispatch(tonIn(1_500_000, 3)).trips[0].vehicles.map(v => v.model.id)).toEqual(['T15'])
  })
  it('tổ hợp vẫn chỉ trong dòng xe khách được vào (luật 10): khách chỉ vào T15 + T8 ⇒ không có T2', () => {
    const inp = tonIn(3_000_000, 3)
    inp.ods[0].allowed_models = ['T15', 'T8']
    const t = runDispatch(inp).trips[0]
    expect(t.vehicles.every(v => ['T15', 'T8'].includes(v.model.id))).toBe(true)
  })
  it('priceCombo: một xe thiếu cước ⇒ cả thẻ không có cước, nêu lý do', () => {
    const ctx = buildCtx(input([], { models: [T15, T8, T2], carriers: [A], tariffs: [tariff('A', 'T8', 'W1', 1)] }))
    const r = priceCombo(ctx, [T8, T2], 'A', ['W1'], 1, null, 10)
    expect(r.freight.total).toBeNull()
    expect(r.freight.reason).toMatch(/Chưa có bảng cước.*T2/)
  })
})
describe('luật 11 — hai lỗi gói 61 bắt trên Preview 27/09 (phép kiểm này ĐỎ trên 088444d6)', () => {
  it('kho cho TỐI ĐA 3 xe mà OD chỉ cần 2 ⇒ vẫn một thẻ, không tách OD (splitLoad coi xe thứ 3 là thừa)', () => {
    const r = runDispatch(input([od('1', 'W1', 14)], { models: [M9], params: { ...params, max_vehicles: 3 } }))
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0].vehicles.map(v => v.model.id)).toEqual(['M9', 'M9'])
    expect(r.trips[0].vehicles.map(v => v.pallets)).toEqual([9, 5])
    expect(r.trips[0].oversize).toBe(false)
  })
  it('không dòng xe nào phục vụ mức bảo quản của hàng ⇒ KHÔNG ném lỗi (so tổ hợp trên danh sách rỗng), chuyến không dòng xe + cảnh báo', () => {
    const r = runDispatch(input([od('1', 'W1', 3, { lines: [line(3, { condition: 'CHILL' })] })], { models: [{ ...M9, serve_conditions: ['AMBIENT'] }], params: { ...params, max_vehicles: 3 } }))
    expect(r.trips[0].vehicle_model).toBeNull()
    expect(r.trips[0].warnings.join(' ')).toMatch(/phục vụ điều kiện bảo quản/)
  })
})
