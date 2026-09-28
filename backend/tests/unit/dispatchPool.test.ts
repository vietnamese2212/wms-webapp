// Điều vận v2 (25/09) — pool LŨY TIẾN + OD bị SO sửa THAY + cửa đặt lịch khi chuyển OD + máy chọn xe cho "xe mới".
// Một phép kiểm cho một luật user chốt; oracle = viết tay từ câu chốt.
import { describe, it, expect } from 'vitest'
import { splitPool, findReplacedOds, daysBetween, holdsToCarry, redoDispatchedOf, type PoolCandidateRow } from '../../src/services/dispatchPool'
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
  const od: EngineOd = { od_number: '1', ship_to_code: 'S', ship_to_name: null, ward_code: 'W1', region_code: 'R', channel: null, flow: 'SALE', lines: [] }
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

describe('HOÃN / KHÔNG ĐIỀU (user 27/09: "đơn key một ngày nhưng điều ngày khác — không tự động được, user review trước")', () => {
  const held = (m: [string, string | null][]) => ({ ...none, held: new Map(m.map(([od, until]) => [od, { until, reason: 'NPP hẹn' }])) })
  it('hoãn tới ngày SAU ngày lập ⇒ không vào, BÁO kèm ngày + lý do; không điều (không ngày) ⇒ không vào', () => {
    const s = splitPool([row('1'), row('2')], DAY, held([['1', '2026-09-27'], ['2', null]]))
    expect(s.include.size).toBe(0)
    // until/reason tách riêng để bảng Xem đơn chia hai tab "Không điều ngày này" (có ngày) / "Không điều" (null) mà không đọc chữ
    expect(s.excluded).toEqual([{ od_number: '1', kind: 'HELD', info: 'hoãn tới 2026-09-27 — NPP hẹn', until: '2026-09-27', reason: 'NPP hẹn' }, { od_number: '2', kind: 'HELD', info: 'không điều — NPP hẹn', until: null, reason: 'NPP hẹn' }])
  })
  it('tới ngày hoãn (hoặc đã qua) ⇒ OD quay lại đợt ghép như OD tồn đọng', () => {
    const s = splitPool([row('1', { delivery_date: '2026-09-22' })], DAY, held([['1', DAY]]))
    expect(s.include.get('1')!.late_days).toBe(3)
  })
  it('OD tồn đọng đang hoãn vẫn được BÁO (quyết định của người phải thấy để còn bỏ hoãn)', () => {
    expect(splitPool([row('1', { delivery_date: '2026-09-20' })], DAY, held([['1', null]])).excluded.map(x => x.kind)).toEqual(['HELD'])
  })
  it('đang Không điều mà SAP đã điều / đã xuất ⇒ về tab Đã điều (SHIPPED / SAP_ASSIGNED), không đứng mãi ở Không điều', () => {
    const s = splitPool([row('1', { mat_doc: '4900001' }), row('2', { sap_dispatch_status: 'ASSIGNED', dvvt_raw: 'HA' })], DAY, held([['1', null], ['2', '2026-09-30']]))
    expect(s.excluded.map(x => [x.od_number, x.kind])).toEqual([['1', 'SHIPPED'], ['2', 'SAP_ASSIGNED']])
  })
})

describe('DO TẠO LẠI – ĐÃ ĐIỀU (user chốt 28/09): OD mới thay OD cũ đã lên xe ⇒ tab Đã điều, không vào đợt ghép', () => {
  it('OD cũ nằm trong Kế hoạch xuất ⇒ OD mới bị loại, kind REDO_DISPATCHED, câu nêu OD cũ + xe; OD cũ chưa lên xe ⇒ không có dấu', () => {
    const redo = redoDispatchedOf([{ od_number: '1', replaced_by_od: '11' }, { od_number: '2', replaced_by_od: '22' }], [{ do_no: '1', group_code: 'K_X_280926_4' }])
    expect([...redo]).toEqual([['11', 'thay OD 1 · xe K_X_280926_4']])
    const s = splitPool([row('11'), row('22')], DAY, { ...none, redo })
    expect([...s.include.keys()]).toEqual(['22'])
    expect(s.excluded).toEqual([{ od_number: '11', kind: 'REDO_DISPATCHED', info: 'thay OD 1 · xe K_X_280926_4' }])
  })
  it('LUÔN báo kể cả OD tồn đọng; thắng dấu Không điều; thua SAP đã xuất / OD mới tự đã trong KH xuất', () => {
    const redo = new Map([['1', 'thay OD 0 · xe G'], ['2', 'x'], ['3', 'y']])
    const s = splitPool([row('1', { delivery_date: '2026-09-20' }), row('2'), row('3', { mat_doc: '49' })], DAY,
      { inPlan: new Map(), otherDraft: new Map(), held: new Map([['2', { until: null, reason: 'r' }]]), redo })
    expect(s.excluded.map(x => [x.od_number, x.kind])).toEqual([['1', 'REDO_DISPATCHED'], ['2', 'REDO_DISPATCHED'], ['3', 'SHIPPED']])
  })
})

describe('SAP thay OD đang Không điều (user chốt 27/09 khuya: "chuyển dấu sang OD mới")', () => {
  const h = (od: string, until: string | null, wh = 'W1') => ({ warehouse_id: wh, od_number: od, hold_until: until, reason: 'NPP hẹn', created_by: 'A' })
  it('dấu còn hiệu lực (không ngày / ngày sau hôm nay) chuyển sang OD mới, lý do ghi "thay cho OD cũ"', () => {
    expect(holdsToCarry([h('1', null), h('2', '2026-09-30')], [['1', '11'], ['2', '22']], [], '2026-09-27')).toEqual([
      { warehouse_id: 'W1', od_number: '11', hold_until: null, reason: 'NPP hẹn (thay cho OD 1)', created_by: 'A' },
      { warehouse_id: 'W1', od_number: '22', hold_until: '2026-09-30', reason: 'NPP hẹn (thay cho OD 2)', created_by: 'A' },
    ])
  })
  it('dấu đã hết hạn (ngày điều lại ≤ hôm nay) KHÔNG chuyển — OD mới vào Điều như thường', () => {
    expect(holdsToCarry([h('1', '2026-09-27'), h('2', '2026-09-20')], [['1', '11'], ['2', '22']], [], '2026-09-27')).toEqual([])
  })
  it('OD mới đã có dấu riêng ở kho đó ⇒ giữ dấu đó; hai OD cũ cùng thay bằng một OD mới ⇒ một dấu; kho khác vẫn chuyển', () => {
    const out = holdsToCarry([h('1', null), h('2', null), h('3', null, 'W2')], [['1', '11'], ['2', '11'], ['3', '33']], [{ warehouse_id: 'W1', od_number: '33' }], '2026-09-27')
    expect(out.map(x => [x.warehouse_id, x.od_number])).toEqual([['W1', '11'], ['W2', '33']])
  })
})
