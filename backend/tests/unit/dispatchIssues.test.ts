// "Xe cần xử lý" của bàn điều vận (frontend/src/components/tms/dispatchIssues.ts) — MỘT nguồn cho dải Soát, Danh sách xe,
// bàn ghép xe dạng thẻ lẫn dạng bảng.
// 06/10: cờ SAP "đã post" (SHIPPED) / "đã gắn xe" (SAP_ASSIGNED) chỉ là THAM CHIẾU (user chốt 03/10 tối — không loại đơn, không chặn
// Xác nhận; cửa Xác nhận và bảng Xem đơn đã đọc đúng) mà bộ đếm này vẫn tính là "OD đổi ở SAP" ⇒ Bàu Bàng 06/10: 695/709 xe "cần xử lý",
// bảng mới tô đỏ gần hết xe. Hai cửa cùng một sổ mà khác luật (C19) — khoá ở đây.
import { describe, it, expect } from 'vitest'
import { issuesOf, needsWork } from '../../../frontend/src/components/tms/dispatchIssues'
import type { DispatchTrip, DispatchOdFlag } from '../../../frontend/src/api/hooks'

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
