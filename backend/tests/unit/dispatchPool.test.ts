// Điều vận v2 (25/09) — pool LŨY TIẾN + OD bị SO sửa THAY + cửa đặt lịch khi chuyển OD + máy chọn xe cho "xe mới".
// Một phép kiểm cho một luật user chốt; oracle = viết tay từ câu chốt.
import { describe, it, expect } from 'vitest'
import { splitPool, soScopedChanges, holdsToCarry, redoDispatchedOf, shareBaseRange, type PoolCandidateRow } from '../../src/services/dispatchPool'
import { bookingFromCatLoads, catLoadOf, suggestVehicle, runDispatch, type EngineModel, type EngineCarrier, type EngineTariff, type EngineOd } from '../../src/services/dispatchEngine'

const DAY = '2026-09-25'
const row = (od: string, o: Partial<PoolCandidateRow> = {}): PoolCandidateRow =>
  ({ od_number: od, delivery_date: DAY, sap_dispatch_status: 'UNASSIGNED', mat_doc: null, qty_issued_base: 0, dvvt_raw: null, license_plate: null, ...o })
const none = { inPlan: new Map<string, string>(), otherDraft: new Map<string, string>() }

describe('pool lũy tiến — OD đã được lo thì KHÔNG vào đợt ghép', () => {
  it('chưa điều · chưa đi · chưa trong kế hoạch ⇒ vào, chỉ mang ngày giao SAP để hiển thị (không "trễ n ngày")', () => {
    const s = splitPool([row('1')], DAY, none)
    expect([...s.include.keys()]).toEqual(['1'])
    expect(s.include.get('1')).toEqual({ delivery_date: DAY })
    expect(s.excluded).toEqual([])
  })
  // 03/10 tối (user: "dựa theo SAP sẽ rối loạn — SAP có đơn return, đã đi chưa post, đã post chưa đi; lấy theo lịch sử của app và dấu
  // tay"): cờ SAP KHÔNG loại đơn nữa — đơn vào Điều, cờ vàng do odFlags cắm, người quyết bằng dấu Ngoài app. Hai phép dưới đây đảo
  // kết quả của bản 25/09 (đỏ trên bản cũ).
  it('SAP đã điều ở một dòng của OD ⇒ VẪN vào đợt ghép (chỉ là cờ tham chiếu)', () => {
    const s = splitPool([row('1'), row('1', { sap_dispatch_status: 'ASSIGNED', dvvt_raw: 'HẢI AN', license_plate: '29C12345' })], DAY, none)
    expect([...s.include.keys()]).toEqual(['1'])
    expect(s.excluded).toEqual([])
  })
  it('đã post ở SAP (Mat Doc / số đã xuất) ⇒ VẪN vào đợt ghép — người đánh dấu Ngoài app nếu đúng là đã đi', () => {
    expect([...splitPool([row('1', { mat_doc: '4900001' })], DAY, none).include.keys()]).toEqual(['1'])
    expect([...splitPool([row('2', { qty_issued_base: 24 })], DAY, none).include.keys()]).toEqual(['2'])
  })
  it('dấu Ngoài app của kho ⇒ loại, kind OUTSIDE_APP, luôn báo kèm lý do (kể cả tồn đọng)', () => {
    const s = splitPool([row('1'), row('2', { delivery_date: '2026-09-20' })], DAY, { ...none, outside: new Map([['1', { reason: 'SAP đã post', by: 'A' }], ['2', { reason: 'điều tay', by: null }]]) })
    expect(s.include.size).toBe(0)
    expect(s.excluded.map(x => [x.od_number, x.kind, x.reason])).toEqual([['1', 'OUTSIDE_APP', 'SAP đã post'], ['2', 'OUTSIDE_APP', 'điều tay']])
  })
  it('đã trong Kế hoạch xuất / đang XẾP ở nháp mở khác ⇒ loại, thứ tự ưu tiên Kế hoạch xuất trước; nháp khác mang ref (nháp nào · ai · xe)', () => {
    const ref = { info: 'nháp ngày 2026-09-24 · xe #2 · Lâm · 14:03 02/10', plan_id: 'P', plan_date: '2026-09-24', created_by: 'Lâm', created_at: '2026-10-02T07:03:00Z', seq: 2 }
    const s = splitPool([row('1'), row('2')], DAY, { inPlan: new Map([['1', 'K_X_250926_3']]), otherDraft: new Map([['1', 'nháp'], ['2', ref]]) })
    expect(s.excluded).toEqual([{ od_number: '1', kind: 'IN_PLAN', info: 'K_X_250926_3' },
      { od_number: '2', kind: 'OTHER_DRAFT', info: ref.info, ref: { plan_id: 'P', plan_date: '2026-09-24', created_by: 'Lâm', created_at: '2026-10-02T07:03:00Z', seq: 2 } }])
  })
  // 05/10 khuya (user: "gỡ luật, dữ liệu trong zsd02 mặc kệ nó, trong đó không có ngày giao đáng tin cậy. USER sẽ là người chọn")
  it('NGÀY GIAO KHÔNG QUYẾT: đơn ngày giao trước, đúng hay SAU ngày lập (kể cả gõ nhầm năm 2040) chưa điều chưa đi ⇒ đều VÀO', () => {
    const s = splitPool([row('9', { delivery_date: '2026-09-22' }), row('8'), row('7', { delivery_date: '2026-09-30' }), row('6', { delivery_date: '2040-10-03' }), row('5', { delivery_date: null })], DAY, none)
    expect([...s.include.keys()]).toEqual(['5', '6', '7', '8', '9'])
    expect(s.excluded).toEqual([])
  })
  it('đã post / SAP đã điều ⇒ vẫn VÀO (03/10 tối — lịch sử app mới là sự thật, SAP chỉ tham chiếu)', () => {
    const s = splitPool([row('8', { delivery_date: '2026-09-20', sap_dispatch_status: 'ASSIGNED' }), row('7', { delivery_date: '2026-09-21', mat_doc: 'x' })], DAY, none)
    expect([...s.include.keys()].sort()).toEqual(['7', '8'])
  })
  it('tồn đọng đang XẾP ở NHÁP MỞ ngày khác ⇒ loại nhưng LUÔN báo (29/09: 223 OD 25/09 kẹt trong nháp 28/09 bị quên, KH 29/09 tưởng đủ)', () => {
    const s = splitPool([row('5', { delivery_date: '2026-09-21' })], DAY, { ...none, otherDraft: new Map([['5', 'nháp ngày 2026-09-24']]) })
    expect(s.include.size).toBe(0)
    expect(s.excluded).toEqual([{ od_number: '5', kind: 'OTHER_DRAFT', info: 'nháp ngày 2026-09-24' }])
  })
  it('ĐÃ Ở Kế hoạch xuất ⇒ LUÔN báo IN_PLAN kèm Số xe, ngày giao nào cũng vậy (bản cũ chỉ báo đơn "đúng ngày lập")', () => {
    const s = splitPool([row('8', { delivery_date: '2026-09-20' }), row('9', { delivery_date: '2040-10-03' })], DAY, { ...none, inPlan: new Map([['8', 'K_X_200926_1'], ['9', 'K_X_250926_2']]) })
    expect(s.include.size).toBe(0)
    expect(s.excluded).toEqual([{ od_number: '8', kind: 'IN_PLAN', info: 'K_X_200926_1' }, { od_number: '9', kind: 'IN_PLAN', info: 'K_X_250926_2' }])
  })
})

// 24/10 (user chốt): SO là MẸ, DO là CON — SO có trong file là BẢN CUỐI của SO đó; SO vắng file không đụng; đã xuất chỉ tính theo APP.
// Thay luật 03/10 "khoảng phủ ngày tạo OD" (OD cũ ngoài khoảng ⇒ uncertain, cả A lẫn B + C cùng sống).
describe('nạp ZSD02 theo SO — SO trong file là bản cuối, đã xuất (theo app) không bao giờ bị xoá', () => {
  const line = (od: string, item = '10', so = 'S1') => ({ od_number: od, od_item: item, so_number: so, so_item: item })
  const prior = (od: string, item = '10', so = 'S1') => ({ id: `${od}-${item}`, ...line(od, item, so) })
  const noShip = new Set<string>()
  it('SAP xoá A, tạo B + C cùng dòng SO ⇒ A xoá mềm, thay bằng B; hai cạnh SPLIT — SO chỉ còn B, C', () => {
    const r = soScopedChanges([line('B'), line('C')], ['S1'], [prior('A')], noShip)
    expect(r.obsolete).toEqual([{ id: 'A-10', od_number: 'A', od_item: '10', by: 'B' }])
    expect(r.replaced).toEqual([['A', 'B']])
    expect(r.gone).toEqual([])
    expect(r.edges.map(e => [e.old_od, e.new_od, e.kind])).toEqual([['A', 'B', 'SPLIT'], ['A', 'C', 'SPLIT']])
  })
  it('SO KHÔNG có trong file (nạp lẻ SO khác) ⇒ không đụng DO của SO đó', () => {
    const r = soScopedChanges([line('X', '10', 'S9')], ['S9'], [prior('A')], noShip)
    expect(r.obsolete).toEqual([])
    expect(r.edges).toEqual([])
  })
  it('SO có trong file chỉ ở dòng CHƯA có DO (SAP xoá DO, dòng SO mở lại) ⇒ DO cũ = SAP đã bỏ', () => {
    const r = soScopedChanges([], ['S1'], [prior('A')], noShip)
    expect(r.obsolete).toEqual([{ id: 'A-10', od_number: 'A', od_item: '10', by: null }])
    expect(r.gone).toEqual(['A'])
  })
  it('A ĐÃ XUẤT theo app mà SAP xoá A, tạo B + C ⇒ A GIỮ NGUYÊN, cạnh AFTER_POST tới B và C (người quyết phần đã đi / giao thêm)', () => {
    const r = soScopedChanges([line('B'), line('C')], ['S1'], [prior('A')], new Set(['A']))
    expect(r.obsolete).toEqual([])
    expect(r.replaced).toEqual([])
    expect(r.kept_shipped).toEqual(['A'])
    expect(r.edges.map(e => [e.old_od, e.new_od, e.kind])).toEqual([['A', 'B', 'AFTER_POST'], ['A', 'C', 'AFTER_POST']])
  })
  it('SAP sửa A từ 100 xuống 80 + tạo C 20 (A còn trong file) ⇒ không xoá, không phả hệ (C là đơn thường)', () => {
    const r = soScopedChanges([line('A'), line('C')], ['S1'], [prior('A')], noShip)
    expect(r.obsolete).toEqual([])
    expect(r.edges).toEqual([])
  })
  it('DO còn trong file nhưng MẤT một dòng ⇒ chỉ dòng đó xoá mềm, không phả hệ, không tính "SAP bỏ DO"', () => {
    const r = soScopedChanges([line('A', '10')], ['S1'], [prior('A', '10'), prior('A', '20')], noShip)
    expect(r.obsolete).toEqual([{ id: 'A-20', od_number: 'A', od_item: '20', by: null }])
    expect(r.gone).toEqual([])
    expect(r.edges).toEqual([])
  })
  it('khác dòng SO ⇒ không phải thay (A vắng ⇒ SAP bỏ)', () => {
    const r = soScopedChanges([line('B', '20')], ['S1'], [prior('A', '10')], noShip)
    expect(r.replaced).toEqual([])
    expect(r.gone).toEqual(['A'])
  })
  it('GỘP N → 1: hai DO cũ vắng, một DO mới ⇒ hai cạnh MERGE', () => {
    const r = soScopedChanges([line('N')], ['S1'], [prior('O1'), prior('O2')], noShip)
    expect(r.replaced.map(x => x[0]).sort()).toEqual(['O1', 'O2'])
    expect(r.edges.map(e => [e.old_od, e.new_od, e.kind]).sort()).toEqual([['O1', 'N', 'MERGE'], ['O2', 'N', 'MERGE']])
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
  const m = (id: string, max: number): EngineModel => ({ id, sap_code: id, name: id, parent_type_name: 'XE', capacity_mode: 'PALLET', max_pallets: max, max_tons: null, tariff_unit: 'PER_PALLET', serve_conditions: null, max_drops: 3, is_active: true })
  const A: EngineCarrier = { id: 'A', code: 'A', name: 'A' }
  const t = (mid: string, price: number): EngineTariff => ({ id: mid, transport_company_id: 'A', vehicle_model_id: mid, ward_code: 'W1', price, distance_km: 5, effective_from: '2026-01-01', effective_to: null, is_active: true })
  const od: EngineOd = { od_number: '1', ship_to_code: 'S', ship_to_name: null, ward_code: 'W1', region_code: 'R', channel: null, flow: 'SALE', lines: [] }
  const input = { ods: [], models: [m('M9', 9), m('M16', 16)], carriers: [A], tariffs: [t('M9', 100_000), t('M16', 90_000)], surcharges: [], allocations: [], share_targets: [], share_actual: {}, params: { day: DAY, allow_mix_channels: false, underload_pct: null, code_prefix: 'K_', start_seq: 1 } }
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
  it('tới ngày người hẹn (hoặc đã qua) ⇒ OD quay lại đợt ghép', () => {
    const s = splitPool([row('1', { delivery_date: '2026-09-22' }), row('2', { delivery_date: '2026-09-30' })], DAY, held([['1', DAY], ['2', '2026-09-24']]))
    expect([...s.include.keys()]).toEqual(['1', '2'])
  })
  it('OD đang hoãn vẫn được BÁO (quyết định của người phải thấy để còn bỏ hoãn)', () => {
    expect(splitPool([row('1', { delivery_date: '2026-09-20' })], DAY, held([['1', null]])).excluded.map(x => x.kind)).toEqual(['HELD'])
  })
  it('đang Không điều mà SAP đã post / đã điều ⇒ VẪN Không điều (03/10 tối: dấu tay của người thắng cờ SAP; bản 27/09 để SAP thắng)', () => {
    const s = splitPool([row('1', { mat_doc: '4900001' }), row('2', { sap_dispatch_status: 'ASSIGNED', dvvt_raw: 'HA' })], DAY, held([['1', null], ['2', '2026-09-30']]))
    expect(s.excluded.map(x => [x.od_number, x.kind])).toEqual([['1', 'HELD'], ['2', 'HELD']])
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
  it('LUÔN báo kể cả OD tồn đọng; thắng dấu Không điều; thua OD mới tự đã trong KH xuất (cờ SAP đã post không còn thắng — 03/10 tối)', () => {
    const redo = new Map([['1', 'thay OD 0 · xe G'], ['2', 'x'], ['3', 'y']])
    const s = splitPool([row('1', { delivery_date: '2026-09-20' }), row('2'), row('3', { mat_doc: '49' })], DAY,
      { inPlan: new Map([['3', 'K_X']]), otherDraft: new Map(), held: new Map([['2', { until: null, reason: 'r' }]]), redo })
    expect(s.excluded.map(x => [x.od_number, x.kind])).toEqual([['1', 'REDO_DISPATCHED'], ['2', 'REDO_DISPATCHED'], ['3', 'IN_PLAN']])
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

// 22/10 (user: "tối ưu 2 lần ra 1 kết quả, xoá đi tạo lại ra kết quả khác"): tỷ trọng ĐVVT chỉ đếm chuyến TRƯỚC ngày của kế hoạch — đếm cả
// chính ngày đó thì chuyến vừa xoá / mảng kia vừa chốt làm đổi hãng dưới chỉ tiêu ⇒ đổi giá ⇒ đổi cách ghép.
describe('shareBaseRange — tỷ trọng ĐVVT không đếm chính ngày của kế hoạch', () => {
  it('đầu tháng → TRƯỚC ngày kế hoạch (cận trên loại trừ)', () => {
    expect(shareBaseRange('2026-10-22')).toEqual({ from: '2026-10-01', before: '2026-10-22' })
  })
  it('ngày đầu tháng ⇒ khoảng rỗng (from = before) — chưa có lịch sử, không lấy tháng trước', () => {
    expect(shareBaseRange('2026-11-01')).toEqual({ from: '2026-11-01', before: '2026-11-01' })
  })
})
