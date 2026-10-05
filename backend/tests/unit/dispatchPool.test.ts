// Điều vận v2 (25/09) — pool LŨY TIẾN + OD bị SO sửa THAY + cửa đặt lịch khi chuyển OD + máy chọn xe cho "xe mới".
// Một phép kiểm cho một luật user chốt; oracle = viết tay từ câu chốt.
import { describe, it, expect } from 'vitest'
import { splitPool, findReplacedOds, holdsToCarry, redoDispatchedOf, type PoolCandidateRow } from '../../src/services/dispatchPool'
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
  it('OD cũ ĐÃ post ⇒ không bỏ, báo xung đột + phả hệ AFTER_POST (rào DB chặn OD mới đi ngày khác)', () => {
    const r = findReplacedOds(file, [cand('OLD', { mat_doc: '49' })])
    expect(r.replaced).toEqual([])
    expect(r.shipped_conflicts).toEqual([{ od_number: 'OLD', by: 'NEW', so: 'S1/10' }])
    expect(r.edges).toEqual([{ old_od: 'OLD', new_od: 'NEW', kind: 'AFTER_POST', so_number: 'S1', so_item: '10' }])
  })
  // 03/10 tối — KHOẢNG PHỦ theo NGÀY TẠO (SAP đổ ZSD02 theo ngày tạo; file lọc 2 ngày không chứa DO cũ chưa post thì vắng mặt không nói lên gì)
  const c2 = (od: string, created: string, o: Partial<{ so_item: string; mat_doc: string | null }> = {}) => ({ ...cand(od, o), od_created_at: created })
  const COV = { from: '2026-09-24', to: '2026-09-25' }
  it('khai khoảng phủ: OD cũ tạo TRONG khoảng mà vắng ⇒ thay (bất kể ngày giao)', () => {
    const r = findReplacedOds(file, [c2('OLD', '2026-09-24', {})], COV)
    expect(r.replaced).toEqual([{ od_number: 'OLD', od_item: '10', by: 'NEW' }])
    expect(r.edges).toEqual([{ old_od: 'OLD', new_od: 'NEW', kind: 'REPLACE', so_number: 'S1', so_item: '10' }])
  })
  it('OD cũ tạo NGOÀI khoảng ⇒ KHÔNG kết luận thay, chỉ tín hiệu uncertain (giao thêm hay thay? người quyết) — đỏ bản 25/09', () => {
    const r = findReplacedOds(file, [c2('OLD', '2026-09-10')], COV)
    expect(r.replaced).toEqual([])
    expect(r.uncertain).toEqual([{ od_number: 'OLD', by: 'NEW', so: 'S1/10' }])
    expect(r.edges).toEqual([])
  })
  it('khai khoảng phủ nhưng OD cũ KHÔNG có ngày tạo (dòng nạp trước khi có cột) ⇒ rơi về luật ngày giao, không kẹt uncertain (review 03/10)', () => {
    const r = findReplacedOds(file, [cand('OLD')], COV)            // ngày giao = DAY, trong khoảng ngày giao của file
    expect(r.replaced).toEqual([{ od_number: 'OLD', od_item: '10', by: 'NEW' }])
    expect(r.uncertain).toEqual([])
    const r2 = findReplacedOds(file, [cand('OLD', { delivery_date: '2026-09-20' })], COV)   // ngoài khoảng ngày giao ⇒ vẫn uncertain
    expect(r2.replaced).toEqual([])
    expect(r2.uncertain).toEqual([{ od_number: 'OLD', by: 'NEW', so: 'S1/10' }])
  })
  it('TÁCH 1 → N: một OD cũ vắng, hai OD mới cùng SO Item ⇒ hai cạnh SPLIT; `replaced.by` = OD mới đầu tiên', () => {
    const two = [{ od_number: 'N1', so_number: 'S1', so_item: '10', delivery_date: DAY }, { od_number: 'N2', so_number: 'S1', so_item: '10', delivery_date: DAY }]
    const r = findReplacedOds(two, [c2('OLD', '2026-09-24')], COV)
    expect(r.replaced).toEqual([{ od_number: 'OLD', od_item: '10', by: 'N1' }])
    expect(r.edges.map(e => [e.old_od, e.new_od, e.kind])).toEqual([['OLD', 'N1', 'SPLIT'], ['OLD', 'N2', 'SPLIT']])
  })
  it('GỘP N → 1: hai OD cũ vắng, một OD mới ⇒ hai cạnh MERGE', () => {
    const r = findReplacedOds(file, [c2('O1', '2026-09-24'), c2('O2', '2026-09-25')], COV)
    expect(r.replaced.map(x => x.od_number).sort()).toEqual(['O1', 'O2'])
    expect(r.edges.map(e => [e.old_od, e.new_od, e.kind]).sort()).toEqual([['O1', 'NEW', 'MERGE'], ['O2', 'NEW', 'MERGE']])
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
