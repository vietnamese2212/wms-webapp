// Điều vận v2 (25/09) — pool LŨY TIẾN + OD bị SO sửa THAY + cửa đặt lịch khi chuyển OD + máy chọn xe cho "xe mới".
// Một phép kiểm cho một luật user chốt; oracle = viết tay từ câu chốt.
import { describe, it, expect } from 'vitest'
import { splitPool, findReplacedOds, daysBetween, type PoolCandidateRow } from '../../src/services/dispatchPool'
import { bookingFromCatLoads, catLoadOf, suggestVehicle, runDispatch, type EngineModel, type EngineCarrier, type EngineTariff, type EngineOd } from '../../src/services/dispatchEngine'

const DAY = '2026-09-25'
const row = (od: string, o: Partial<PoolCandidateRow> = {}): PoolCandidateRow =>
  ({ od_number: od, delivery_date: DAY, sap_dispatch_status: 'UNASSIGNED', mat_doc: null, qty_issued_base: 0, dvvt_raw: null, license_plate: null, ...o })
const none = { inPlan: new Map<string, string>(), otherDraft: new Map<string, string>() }

describe('pool lũy tiến — OD đã được lo thì KHÔNG vào đợt ghép', () => {
  it('chưa điều · chưa đi · chưa trong kế hoạch ⇒ vào, trễ 0 ngày', () => {
    const s = splitPool([row('1')], DAY, none)
    expect([...s.include.keys()]).toEqual(['1'])
    expect(s.include.get('1')!.late_days).toBe(0)
    expect(s.excluded).toEqual([])
  })
  it('SAP đã điều ở BẤT KỲ dòng nào của OD ⇒ loại, báo ĐVVT + biển số', () => {
    const s = splitPool([row('1'), row('1', { sap_dispatch_status: 'ASSIGNED', dvvt_raw: 'HẢI AN', license_plate: '29C12345' })], DAY, none)
    expect(s.include.size).toBe(0)
    expect(s.excluded).toEqual([{ od_number: '1', kind: 'SAP_ASSIGNED', info: 'HẢI AN · 29C12345' }])
  })
  it('đã xuất kho (chứng từ xuất HOẶC số đã xuất > 0) ⇒ loại — kể cả SAP còn ghi chưa điều', () => {
    expect(splitPool([row('1', { mat_doc: '4900001' })], DAY, none).excluded[0].kind).toBe('SHIPPED')
    expect(splitPool([row('2', { qty_issued_base: 24 })], DAY, none).excluded[0].kind).toBe('SHIPPED')
  })
  it('đã trong Kế hoạch xuất / nháp mở ngày khác ⇒ loại, thứ tự ưu tiên Kế hoạch xuất trước', () => {
    const s = splitPool([row('1'), row('2')], DAY, { inPlan: new Map([['1', 'K_X_250926_3']]), otherDraft: new Map([['1', 'nháp'], ['2', 'nháp ngày 2026-09-24']]) })
    expect(s.excluded).toEqual([{ od_number: '1', kind: 'IN_PLAN', info: 'K_X_250926_3' }, { od_number: '2', kind: 'OTHER_DRAFT', info: 'nháp ngày 2026-09-24' }])
  })
  it('TỒN ĐỌNG (ngày giao trước) chưa điều chưa đi ⇒ VÀO kèm số ngày trễ (user chốt gộp)', () => {
    const s = splitPool([row('9', { delivery_date: '2026-09-22' })], DAY, none)
    expect(s.include.get('9')!.late_days).toBe(3)
  })
  it('tồn đọng ĐÃ điều / đã đi ⇒ loại nhưng KHÔNG báo (lịch sử bình thường, không phải việc hôm nay)', () => {
    const s = splitPool([row('8', { delivery_date: '2026-09-20', sap_dispatch_status: 'ASSIGNED' }), row('7', { delivery_date: '2026-09-21', mat_doc: 'x' })], DAY, none)
    expect(s.include.size).toBe(0)
    expect(s.excluded).toEqual([])
  })
  it('daysBetween theo lịch, không theo giờ', () => { expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1) })
})

describe('SO sửa ⇒ OD mới — chỉ kết luận "đã thay" khi có bằng chứng trong file', () => {
  const cand = (od: string, o: Partial<{ so_item: string; delivery_date: string; mat_doc: string | null; qty_issued_base: number }> = {}) =>
    ({ od_number: od, od_item: o.so_item ?? '10', so_number: 'S1', so_item: o.so_item ?? '10', delivery_date: o.delivery_date ?? DAY, mat_doc: o.mat_doc ?? null, qty_issued_base: o.qty_issued_base ?? 0 })
  const file = [{ od_number: 'NEW', so_number: 'S1', so_item: '10', delivery_date: DAY }]
  it('OD cũ vắng file, cùng (SO, item) có OD mới, ngày trong khoảng file ⇒ thay', () => {
    expect(findReplacedOds(file, [cand('OLD')]).replaced).toEqual([{ od_number: 'OLD', od_item: '10', by: 'NEW' }])
  })
  it('OD cũ VẪN có trong file (SO tách hai lần giao) ⇒ KHÔNG thay', () => {
    expect(findReplacedOds([...file, { od_number: 'OLD', so_number: 'S1', so_item: '10', delivery_date: DAY }], [cand('OLD')]).replaced).toEqual([])
  })
  it('ngày giao OD cũ ngoài khoảng ngày của file (file cắt ngắn) ⇒ KHÔNG kết luận', () => {
    expect(findReplacedOds(file, [cand('OLD', { delivery_date: '2026-09-20' })]).replaced).toEqual([])
  })
  it('khác dòng SO ⇒ KHÔNG thay', () => {
    expect(findReplacedOds(file, [cand('OLD', { so_item: '20' })]).replaced).toEqual([])
  })
  it('OD cũ ĐÃ xuất kho ⇒ không bỏ, chỉ báo xung đột', () => {
    const r = findReplacedOds(file, [cand('OLD', { mat_doc: '49' })])
    expect(r.replaced).toEqual([])
    expect(r.shipped_conflicts).toEqual([{ od_number: 'OLD', by: 'NEW', so: 'S1/10' }])
  })
})

describe('cửa đặt lịch khi OD di chuyển — suy từ tải theo loại của từng OD', () => {
  it('loại chiếm tải lớn nhất thắng; hoà ⇒ theo mã', () => {
    expect(bookingFromCatLoads([{ FG01: 3 }, { PM01: 5 }, { FG01: 1 }])).toBe('PM01')
    expect(bookingFromCatLoads([{ FG02: 2 }, { FG01: 2 }])).toBe('FG01')
    expect(bookingFromCatLoads([null, {}])).toBeNull()
  })
  it('catLoadOf cộng pallet + kg/1e6 theo loại, bỏ dòng chưa khai loại', () => {
    expect(catLoadOf([
      { material_code: 'a', qty_base: 1, pallets: 2, kg: 1000, category: 'FG01', condition: null },
      { material_code: 'b', qty_base: 1, pallets: 1, kg: 0, category: null, condition: null },
    ])).toEqual({ FG01: 2.001 })
  })
})

describe('xe mới do người kéo OD ra — máy chọn dòng xe + ĐVVT theo đúng ba bậc', () => {
  const m = (id: string, max: number): EngineModel => ({ id, sap_code: id, name: id, parent_type_name: 'XE', capacity_mode: 'PALLET', max_pallets: max, max_tons: null, tariff_unit: 'PER_PALLET', underload_pct: 70, serve_conditions: null, max_drops: null, is_active: true })
  const A: EngineCarrier = { id: 'A', code: 'A', name: 'A' }
  const t = (mid: string, price: number): EngineTariff => ({ id: mid, transport_company_id: 'A', vehicle_model_id: mid, ward_code: 'W1', price, distance_km: 5, effective_from: '2026-01-01', effective_to: null, is_active: true })
  const od: EngineOd = { od_number: '1', ship_to_code: 'S', ship_to_name: null, ward_code: 'W1', region_code: 'R', channel: null, internal_wh: null, scan_mode: false, flow: 'SALE', lines: [] }
  const input = { ods: [], models: [m('M9', 9), m('M16', 16)], carriers: [A], tariffs: [t('M9', 100_000), t('M16', 90_000)], surcharges: [], allocations: [], share_targets: [], share_actual: {}, params: { day: DAY, max_drops: 3, allow_mix_channels: false, underload_pct: null, code_prefix: 'K_', start_seq: 1 } }
  it('8 pallet: M9 đủ tải (89 %) còn M16 Non tải (50 %) ⇒ chọn M9 dù cước/pallet M16 rẻ hơn', () => {
    const s = suggestVehicle(input, [{ od, pallets: 8, tons: 4, conditions: [] }], {})
    expect(s.model?.id).toBe('M9')
    expect(s.carrier?.id).toBe('A')
    expect(s.freight.total).toBe(800_000)
  })
  it('engine vẫn gắn điều kiện + tải theo loại lên từng OD của chuyến (nguồn cho các lần chuyển sau)', () => {
    const r = runDispatch({ ...input, ods: [{ ...od, lines: [{ material_code: 'x', qty_base: 1, pallets: 3, kg: 900, category: 'FG02', condition: 'CHILL' }] }] })
    expect(r.trips[0].ods[0].conditions).toEqual(['CHILL'])
    expect(r.trips[0].ods[0].cat_load).toEqual({ FG02: 3.0009 })
  })
})
