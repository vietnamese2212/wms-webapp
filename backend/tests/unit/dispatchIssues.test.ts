// "Xe cần xử lý" của bàn điều vận (frontend/src/components/tms/dispatchIssues.ts) — MỘT nguồn cho dải Soát, Danh sách xe,
// bàn ghép xe dạng thẻ lẫn dạng bảng.
// 06/10: cờ SAP "đã post" (SHIPPED) / "đã gắn xe" (SAP_ASSIGNED) chỉ là THAM CHIẾU (user chốt 03/10 tối — không loại đơn, không chặn
// Xác nhận; cửa Xác nhận và bảng Xem đơn đã đọc đúng) mà bộ đếm này vẫn tính là "OD đổi ở SAP" ⇒ Bàu Bàng 06/10: 695/709 xe "cần xử lý",
// bảng mới tô đỏ gần hết xe. Hai cửa cùng một sổ mà khác luật (C19) — khoá ở đây.
import { describe, it, expect } from 'vitest'
import { issuesOf, needsWork, selectionAfterMove, inPlanRow, boardPlanOf, planHoldsOrders } from '../../../frontend/src/components/tms/dispatchIssues'
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
  it('bàn ghép xe: khung chờ bỏ đơn Chờ điều + đơn "Không liên quan" của người xem, số khung chờ tính lại theo đúng tập đó', () => {
    const plan = { trips: [], pool: [row('b', 'B', null, 'x', 2.5), row('c', 'C', null, null, 9), row('d', 'D', null, 'x', 1), row('e', 'E', null, 'x', 4)],
      summary: { pool_ods: 4, pool_pallets: 16.5, unreviewed_ods: 1 } } as unknown as DispatchPlan
    const v = boardPlanOf(plan, new Set(['E']))
    expect(v.pool.map(o => o.od_number)).toEqual(['B', 'D'])
    expect(v.summary.pool_ods).toBe(2)
    expect(v.summary.pool_pallets).toBe(3.5)
    expect(plan.pool).toHaveLength(4)   // không đụng kế hoạch gốc — bảng Xem đơn vẫn cần đủ Chờ điều
  })
  it('nháp chỉ chứa Chờ điều (bấm Xem đơn rồi bỏ đó) KHÔNG giữ đơn; có xe hoặc có khung chờ của kế hoạch thì giữ', () => {
    expect(planHoldsOrders({ trips: 0, pool_ods: 3500, unreviewed_ods: 3500 })).toBe(false)
    expect(planHoldsOrders({ trips: 1, pool_ods: 3500, unreviewed_ods: 3500 })).toBe(true)
    expect(planHoldsOrders({ trips: 0, pool_ods: 3500, unreviewed_ods: 3499 })).toBe(true)
    expect(planHoldsOrders({ trips: 0, pool_ods: 12 })).toBe(true)   // tổng kết cũ thiếu số Chờ điều ⇒ coi như còn giữ (nhắc thừa hơn bỏ sót)
    expect(planHoldsOrders(null)).toBe(false)
  })
})
