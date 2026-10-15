// "Xe cần xử lý" của bàn điều vận (frontend/src/components/tms/dispatchIssues.ts) — MỘT nguồn cho dải Soát, Danh sách xe,
// bàn ghép xe dạng thẻ lẫn dạng bảng.
// 06/10: cờ SAP "đã post" (SHIPPED) / "đã gắn xe" (SAP_ASSIGNED) chỉ là THAM CHIẾU (user chốt 03/10 tối — không loại đơn, không chặn
// Xác nhận; cửa Xác nhận và bảng Xem đơn đã đọc đúng) mà bộ đếm này vẫn tính là "OD đổi ở SAP" ⇒ Bàu Bàng 06/10: 695/709 xe "cần xử lý",
// bảng mới tô đỏ gần hết xe. Hai cửa cùng một sổ mà khác luật (C19) — khoá ở đây.
import { describe, it, expect } from 'vitest'
import { issuesOf, needsWork, selectionAfterMove, inPlanRow, boardPlanOf, planHoldsOrders, outOfScopeCats, poolLotGroups, rowVehiclesTicked, undoSteps, liveTripId, routeMatches, fitPairs, routeTags } from '../../../frontend/src/components/tms/dispatchIssues'
import type { DispatchTrip, DispatchOdFlag, DispatchPlan, DispatchTripOd } from '../../../frontend/src/api/hooks'

const trip = (ods: string[]): DispatchTrip => ({
  id: 't1', plan_id: 'p1', seq: 1, group_code: 'G1', vehicle_model_id: 'vm', transport_company_id: 'c1',
  stops: 1, wards: ['W'], pallets: 10, tons: 5, load_pct: 80, underload: false, oversize: false, freight_estimated: 1000,
  detail: {
    freight: { total: 1000, base: 1000, billed_pallets: null, unit: 'PER_TRIP', tariff_id: null, ward: 'W', surcharges: [], reason: null },
    load: { basis: 'PALLET', used: 10, cap: 12, pct: 80, underload: false, underload_pct: 70 },
    categories: ['FG01'], booking_category: 'FG01', cluster: 'x', carrier_reasons: [], warnings: [], merge_hint: null,
    vehicle_model: { id: 'vm', sap_code: 'X', name: 'Xe', parent_type_name: null }, carrier: { id: 'c1', code: 'C', name: 'C' },
  },
  manual_edited: false, status: 'DRAFT', tendered_at: null, responded_at: null, response_by: null, response_note: null, confirmed_at: null,
  ods: ods.map((od, i) => ({ id: `o${i}`, plan_id: 'p1', trip_id: 't1', od_number: od, ship_to_code: 'S', ship_to_name: 'S', ward_code: 'W',
    pallets: 1, tons: 1, lines: 1, part_index: null, part_of: null, material_codes: [] })),
})
const flags = (m: Record<string, DispatchOdFlag['kind']>) => ({ flags: new Map(Object.entries(m).map(([od, kind]) => [od, { od_number: od, kind, info: null }])) })

describe('dispatchIssues — cờ SAP tham chiếu không thành việc của người', () => {
  it('xe sạch: không vấn đề, không cần xử lý', () => {
    expect(issuesOf(trip(['A']), flags({}))).toEqual([])
    expect(needsWork(trip(['A']), flags({}))).toBe(false)
  })
  it.each(['SHIPPED', 'SAP_ASSIGNED'] as const)('cờ %s (tham chiếu) KHÔNG là "OD đổi ở SAP", xe KHÔNG cần xử lý', kind => {
    const t = trip(['A', 'B'])
    expect(issuesOf(t, flags({ A: kind }))).not.toContain('sapflag')
    expect(needsWork(t, flags({ A: kind }))).toBe(false)
  })
  it.each(['REPLACED', 'GONE', 'CHANGED', 'IN_PLAN', 'KIN_SHIPPED'] as const)('cờ cứng %s vẫn là "OD đổi ở SAP" và cần xử lý', kind => {
    const t = trip(['A', 'B'])
    expect(issuesOf(t, flags({ A: kind }))).toContain('sapflag')
    expect(needsWork(t, flags({ A: kind }))).toBe(true)
  })
  it('một đơn cờ tham chiếu + một đơn cờ cứng trên cùng xe ⇒ vẫn cần xử lý', () => {
    expect(needsWork(trip(['A', 'B']), flags({ A: 'SHIPPED', B: 'GONE' }))).toBe(true)
  })
})

// 12/10 (đóng vai 12/10: vai chỉ được giao FG01 vẫn được máy ghép OD FG02, "Cần xử lý" = 0, tới Xác nhận mới 403 nêu xe): báo SỚM
// bằng ĐÚNG luật cửa Xác nhận (C78) — từng Loại kho trên xe phải được giao; không giới hạn (null) thì không bao giờ báo
describe('dispatchIssues — Loại kho ngoài phạm vi được giao (scope)', () => {
  const withCats = (cats: string[]) => { const t = trip(['A']); t.detail.categories = cats; return t }
  it('scope null (superadmin / NATIONAL / chưa cấu hình) ⇒ không báo', () => {
    expect(outOfScopeCats(['FG02'], null)).toEqual([])
    expect(issuesOf(withCats(['FG02']), { flags: new Map(), scope: null })).not.toContain('scope')
    expect(issuesOf(withCats(['FG02']), { flags: new Map() })).not.toContain('scope')
  })
  it('xe chở loại ngoài phạm vi ⇒ "scope", là việc cần xử lý; nêu đúng loại ngoài phạm vi (giao ≥1 KHÔNG đủ — cửa Xác nhận xét từng loại)', () => {
    const c = { flags: new Map(), scope: new Set(['FG01', 'PM01']) }
    expect(outOfScopeCats(['FG01', 'FG02'], c.scope)).toEqual(['FG02'])
    expect(issuesOf(withCats(['FG01', 'FG02']), c)).toContain('scope')
    expect(needsWork(withCats(['FG02']), c)).toBe(true)
  })
  it('xe chỉ chở loại được giao, hoặc chưa biết loại ⇒ không báo', () => {
    const c = { flags: new Map(), scope: new Set(['FG01', 'PM01']) }
    expect(issuesOf(withCats(['FG01', 'PM01']), c)).not.toContain('scope')
    expect(issuesOf(withCats([]), c)).not.toContain('scope')
  })
})

// 06/10: kế hoạch lớn trả lời chậm (709 xe ~8 s) — người tick tiếp trong lúc chờ; chuyển xong chỉ được bỏ chọn đơn VỪA chuyển
describe('selectionAfterMove — lựa chọn sau một lần chuyển', () => {
  it('bỏ đúng các đơn vừa chuyển, giữ ô tick khác (tick trong lúc chờ)', () => {
    expect([...selectionAfterMove(new Set(['a', 'b', 'x']), ['a', 'b'])]).toEqual(['x'])
  })
  it('đơn vừa chuyển không nằm trong lựa chọn (Hoàn tác) ⇒ giữ NGUYÊN lựa chọn người vừa tick', () => {
    const s = new Set(['x', 'y'])
    expect(selectionAfterMove(s, ['a'])).toBe(s)
  })
  it('chuyển đúng các đơn đã tick ⇒ lựa chọn rỗng như trước', () => {
    expect(selectionAfterMove(new Set(['a']), ['a']).size).toBe(0)
  })
})

// 15/10 (user: "khung chờ đánh dấu + lọc đơn có route của nó đi mà chưa lên được xe; bên bàn có ký hiệu tiếp nhận"; chốt cùng tuyến = CÙNG
// VÙNG): xe cùng khách › cùng phường › cùng vùng — xe tuyến liên tỉnh đi qua vùng cũng tính, xe trống không tính
describe('routeMatches / fitPairs / routeTags — xe cùng tuyến của đơn khung chờ', () => {
  const od = (ship: string | null, ward: string | null, region: string | null) => ({ ship_to_code: ship, ward_code: ward, region_code: region })
  const trips = [
    { id: 'T1', seq: 1, load_pct: 101, ods: [od('K1', 'BN-DaMai', 'BN')] },             // cùng khách với đơn a
    { id: 'T2', seq: 2, load_pct: 60, ods: [od('K9', 'BN-DaMai', 'BN')] },              // cùng phường
    { id: 'T3', seq: 3, load_pct: 80, ods: [od('K8', 'BN-Chu', 'BN')] },                // cùng vùng, tải 80
    { id: 'T4', seq: 4, load_pct: 50, ods: [od('K7', 'HY-PhoHien', 'HY'), od('K6', 'HP-KienAn', 'HP')] },   // xe tuyến HY → HP
    { id: 'T5', seq: 5, load_pct: null, ods: [] },                                       // xe trống
  ]
  const pool = [
    { id: 'a', ...od('K1', 'BN-DaMai', 'BN') }, { id: 'b', ...od('K2', 'BN-VoCuong', 'BN') },
    { id: 'c', ...od('K3', 'HP-HongBang', 'HP') }, { id: 'd', ...od('K4', 'DB-ThanhNua', 'DB') }, { id: 'e', ...od(null, null, null) },
  ]
  it('mức gần trước (khách › phường › vùng), cùng mức thì xe tải thấp (còn chỗ) trước; xe tuyến liên tỉnh tính cho vùng nó đi qua; không xe ⇒ không có trong map', () => {
    const m = routeMatches(pool, trips)
    expect(m.get('a')).toEqual([{ trip_id: 'T1', seq: 1, level: 'customer' }, { trip_id: 'T2', seq: 2, level: 'ward' }, { trip_id: 'T3', seq: 3, level: 'region' }])
    expect(m.get('b')).toEqual([{ trip_id: 'T2', seq: 2, level: 'region' }, { trip_id: 'T3', seq: 3, level: 'region' }, { trip_id: 'T1', seq: 1, level: 'region' }])
    expect(m.get('c')).toEqual([{ trip_id: 'T4', seq: 4, level: 'region' }])
    expect(m.has('d')).toBe(false)
    expect(m.has('e')).toBe(false)
    expect([...m.values()].flat().some(x => x.trip_id === 'T5')).toBe(false)
  })
  it('cặp gửi server: tối đa n xe mỗi đơn (xe gần trước), cả lượt có trần', () => {
    const m = routeMatches(pool, trips)
    expect(fitPairs(m, ['a', 'b', 'd'], 2)).toEqual([{ row_id: 'a', trip_id: 'T1' }, { row_id: 'a', trip_id: 'T2' }, { row_id: 'b', trip_id: 'T2' }, { row_id: 'b', trip_id: 'T3' }])
    expect(fitPairs(m, ['a', 'b'], 40, 3)).toHaveLength(3)
  })
  it('kết quả luật: đơn "nhận được" khi CÓ xe nhận, "đầy" khi mọi xe đã hỏi đều không, chưa hỏi = null; nhãn xe chỉ tính đơn đang lọc', () => {
    const m = routeMatches(pool, trips)
    expect(routeTags(m, undefined, ['a']).rows.get('a')?.fit).toBeNull()
    const res = [
      { row_id: 'a', trip_id: 'T1', fits: false, reason: 'Xe sẽ vượt trần tải' }, { row_id: 'a', trip_id: 'T2', fits: true, reason: null },
      { row_id: 'b', trip_id: 'T2', fits: false, reason: 'Khách K9 đi xe riêng' }, { row_id: 'b', trip_id: 'T3', fits: false, reason: 'Xe sẽ vượt trần tải' },
    ]
    const g = routeTags(m, res, ['a', 'b'])
    expect(g.rows.get('a')?.fit).toBe(true)
    expect(g.rows.get('b')?.fit).toBe(false)
    expect(g.rows.get('c')?.fit).toBeNull()   // có xe cùng tuyến nhưng chưa hỏi (ngoài trần)
    expect(g.trips.get('T2')).toEqual({ fit: ['a'], full: null })
    expect(g.trips.get('T1')).toEqual({ fit: [], full: 'Xe sẽ vượt trần tải' })
    expect(g.trips.get('T3')).toEqual({ fit: [], full: 'Xe sẽ vượt trần tải' })
    expect(routeTags(m, res, ['b']).trips.get('T2')).toEqual({ fit: [], full: 'Khách K9 đi xe riêng' })   // chỉ đơn đang lọc
  })
})

// 15/10 (user: "gỡ đơn ra khỏi xe 31 thì phải xoá cả xe"): server bỏ xe hết OD ngay ⇒ Hoàn tác phải DỰNG LẠI đúng xe đó từ bản chụp, không
// "Xe mới" để máy chọn; bước Hoàn tác cũ hơn còn trỏ id xe cũ ⇒ đi theo id của xe vừa dựng lại
describe('undoSteps — Hoàn tác khi xe nguồn đã bị bỏ', () => {
  const snap = { seq: 31, vehicle_model_ids: ['vm'], transport_company_id: 'co', locked: false, allow_mix_categories: null }
  const prev = new Map<string, string | null>([['a', 'X'], ['b', 'X'], ['c', 'Y'], ['d', null]])
  it('xe cũ còn ⇒ thả vào xe đó · khung chờ ⇒ pool · dòng không còn trên bàn thì bỏ qua', () => {
    const s = undoSteps(prev, ['a', 'b', 'c', 'd', 'z'], new Set(['a', 'b', 'c', 'd']), new Set(['X', 'Y']), new Map([['X', snap]]), new Map())
    expect(s).toEqual([
      { tid: 'X', ids: ['a', 'b'], to: 'trip', to_trip_id: 'X' },
      { tid: 'Y', ids: ['c'], to: 'trip', to_trip_id: 'Y' },
      { tid: null, ids: ['d'], to: 'pool' },
    ])
  })
  it('xe cũ đã bị bỏ ⇒ to:new kèm BẢN CHỤP của chính xe đó (số xe · dòng xe · ĐVVT)', () => {
    const s = undoSteps(prev, ['a', 'b'], new Set(['a', 'b']), new Set(['Y']), new Map([['X', snap]]), new Map())
    expect(s).toEqual([{ tid: 'X', ids: ['a', 'b'], to: 'new', restore: snap }])
  })
  it('xe đã dựng lại ở lần Hoàn tác trước (X → X2 → X3) ⇒ thả vào id MỚI nhất, không dựng thêm xe thứ hai', () => {
    const rebuilt = new Map([['X', 'X2'], ['X2', 'X3']])
    expect(liveTripId(rebuilt, 'X')).toBe('X3')
    const s = undoSteps(prev, ['a'], new Set(['a']), new Set(['X3', 'Y']), new Map([['X', snap]]), rebuilt)
    expect(s).toEqual([{ tid: 'X', ids: ['a'], to: 'trip', to_trip_id: 'X3' }])
  })
  it('id dựng lại cũng đã bị bỏ ⇒ dựng lại lần nữa từ bản chụp của xe GỐC', () => {
    const s = undoSteps(prev, ['a'], new Set(['a']), new Set(['Y']), new Map([['X', snap]]), new Map([['X', 'X2']]))
    expect(s).toEqual([{ tid: 'X', ids: ['a'], to: 'new', restore: snap }])
  })
})

// 07/10 (user: "đơn không tick ở lại Chờ điều"): khung chờ tách hai theo mốc reviewed_at — bàn ghép xe chỉ vẽ phần THUỘC kế hoạch,
// cảnh báo Xác nhận "N OD còn ở khung chờ" chỉ đếm phần đó, băng "nháp quá ngày" chỉ nhắc nháp còn giữ đơn
describe('ranh giới kế hoạch — Chờ điều ⇄ trong kế hoạch', () => {
  const row = (id: string, od: string, trip: string | null, rev: string | null, pallets = 1): DispatchTripOd => ({
    id, plan_id: 'p1', trip_id: trip, od_number: od, ship_to_code: 'S', ship_to_name: 'S', ward_code: 'W', pallets, tons: 1, lines: 1, part_index: null, part_of: null, material_codes: [], reviewed_at: rev,
  })
  it('dòng trên xe luôn thuộc kế hoạch; dòng khung chờ thuộc kế hoạch khi và chỉ khi có mốc', () => {
    expect(inPlanRow(row('a', 'A', 't1', null))).toBe(true)
    expect(inPlanRow(row('b', 'B', null, '2026-10-07T01:00:00Z'))).toBe(true)
    expect(inPlanRow(row('c', 'C', null, null))).toBe(false)
  })
  it('bàn ghép xe: khung chờ bỏ đơn Chờ điều, số khung chờ tính lại theo đúng tập đó', () => {
    const plan = { trips: [], pool: [row('b', 'B', null, 'x', 2.5), row('c', 'C', null, null, 9), row('d', 'D', null, 'x', 1)],
      summary: { pool_ods: 3, pool_pallets: 12.5, unreviewed_ods: 1 } } as unknown as DispatchPlan
    const v = boardPlanOf(plan)
    expect(v.pool.map(o => o.od_number)).toEqual(['B', 'D'])
    expect(v.summary.pool_ods).toBe(2)
    expect(v.summary.pool_pallets).toBe(3.5)
    expect(plan.pool).toHaveLength(3)   // không đụng kế hoạch gốc — bảng Xem đơn vẫn cần đủ Chờ điều
  })
  it('nháp chỉ chứa Chờ điều (bấm Xem đơn rồi bỏ đó) KHÔNG giữ đơn; có xe hoặc có khung chờ của kế hoạch thì giữ', () => {
    expect(planHoldsOrders({ trips: 0, pool_ods: 3500, unreviewed_ods: 3500 })).toBe(false)
    expect(planHoldsOrders({ trips: 1, pool_ods: 3500, unreviewed_ods: 3500 })).toBe(true)
    expect(planHoldsOrders({ trips: 0, pool_ods: 3500, unreviewed_ods: 3499 })).toBe(true)
    expect(planHoldsOrders({ trips: 0, pool_ods: 12 })).toBe(true)   // tổng kết cũ thiếu số Chờ điều ⇒ coi như còn giữ (nhắc thừa hơn bỏ sót)
    expect(planHoldsOrders(null)).toBe(false)
  })
})

// 15/10 — KHUNG CHỜ GOM THEO LÔ (user: "khối vàng và bảng diễn giải gần giống nhau — gom lại dạng table"). Nhóm phải là ĐÚNG lô máy định
// xếp: khoá đoán cũ của khối vàng (phường · xe · % · số OD) tách lô hai phường làm đôi và gộp hai lô cùng phường cùng % làm một ⇒ "Gom" /
// "Xe mới" trên dòng lô ra hai xe, hoặc một xe 10 pallet trên xe 9.
describe('poolLotGroups — khung chờ gom theo lô máy định xếp', () => {
  const prow = (od: string, ward: string, cust: string, pallets: number): DispatchTripOd => ({
    id: `r${od}`, plan_id: 'p1', trip_id: null, od_number: od, ship_to_code: `S${cust}`, ship_to_name: cust, ward_code: ward, pallets, tons: 1, lines: 1, part_index: null, part_of: null, material_codes: [],
  })
  const um = (lot: string | undefined, pct: number, ods: number) => ({ vehicle: 'Xe 9', pct, min: 70, ods, ...(lot ? { lot } : {}) })
  const keyOf = (gs: ReturnType<typeof poolLotGroups>) => gs.map(g => [g.label, g.rows.map(r => r.od_number).join('+'), g.lot?.kind ?? null])

  it('lô hai phường (cùng mã lô) là MỘT nhóm; hai lô cùng phường cùng % (khác mã) là HAI nhóm', () => {
    const pool = [prow('1', 'W1', 'An', 1), prow('2', 'W2', 'Bình', 1), prow('3', 'W3', 'Chi', 5), prow('4', 'W3', 'Dũng', 5)]
    const g = poolLotGroups(pool, { 1: um('1', 22.2, 2), 2: um('1', 22.2, 2), 3: um('3', 55.6, 1), 4: um('4', 55.6, 1) }, {})
    expect(keyOf(g)).toEqual([['Chi', '3', 'under'], ['Dũng', '4', 'under'], ['An +1 khách · 2 OD', '1+2', 'under']])
  })
  it('kế hoạch ghép trước 15/10 (không mã lô) vẫn đoán theo phường · xe · % · số OD', () => {
    const pool = [prow('1', 'W1', 'An', 2), prow('2', 'W1', 'An', 3), prow('3', 'W2', 'Chi', 1)]
    const g = poolLotGroups(pool, { 1: um(undefined, 55.6, 2), 2: um(undefined, 55.6, 2), 3: um(undefined, 11.1, 1) }, {})
    expect(keyOf(g)).toEqual([['An · 2 OD', '1+2', 'under'], ['Chi', '3', 'under']])
  })
  it('đơn lớn hơn xe: mỗi đơn một lô (đỏ) sau lô dưới tối thiểu; đơn không thuộc lô nào ở "Ngoài lô" cuối bảng; lô sắp pallet giảm', () => {
    const pool = [prow('9', 'W9', 'Zen', 7), prow('1', 'W1', 'An', 2), prow('5', 'W5', 'Em', 20), prow('6', 'W6', 'Phú', 25), prow('2', 'W2', 'Bình', 4)]
    const g = poolLotGroups(pool, { 1: um('1', 22.2, 1), 2: um('2', 44.4, 1) }, { 5: { vehicle: 'Xe 9', pct: 222.2, max: 100 }, 6: { vehicle: 'Xe 9', pct: 277.8, max: 100 } })
    expect(keyOf(g)).toEqual([['Bình', '2', 'under'], ['An', '1', 'under'], ['Phú', '6', 'big'], ['Em', '5', 'big'], ['Ngoài lô · 1 OD', '9', null]])
    expect(g[0].lot).toEqual({ kind: 'under', vehicle: 'Xe 9', pct: 44.4, bound: 70 })
    expect(g[2].lot).toEqual({ kind: 'big', vehicle: 'Xe 9', pct: 277.8, bound: 100 })
    expect(g.map(x => x.pallets)).toEqual([4, 2, 25, 20, 7])
  })
})

// 15/10 — tấm "Dòng xe được vào — ngoại lệ chỉ xe đó": bản chụp có dòng xe KHO KHÁC (khai theo kênh) mà tấm không hiện; bản đầu giữ chúng
// trong danh sách gửi lên ⇒ server 400 "không dùng ở kho này" dù người không đụng (kiểm giao diện nháp Ba Vì: 5 ô tick, bản chụp 6 dòng).
describe('rowVehiclesTicked — ô tick ban đầu của tấm ngoại lệ dòng xe', () => {
  const models = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]
  it('bản chụp có dòng xe kho khác ⇒ chỉ tick (và chỉ gửi) dòng xe của kho', () => {
    expect(rowVehiclesTicked(['A', 'X_KHO_KHAC', 'C'], ['A', 'B'], models)).toEqual(['A', 'C'])
  })
  it('chưa có bản chụp (null) ⇒ theo cấu hình khách ∩ kho; bản chụp RỖNG (chưa khai) ⇒ không tick gì, không lấy cấu hình', () => {
    expect(rowVehiclesTicked(null, ['B', 'Y_KHO_KHAC'], models)).toEqual(['B'])
    expect(rowVehiclesTicked([], ['A', 'B'], models)).toEqual([])
  })
})
