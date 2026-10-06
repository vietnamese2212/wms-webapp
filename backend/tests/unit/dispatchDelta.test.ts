// Ghép "phần thay đổi" của thao tác bàn ghép xe vào kế hoạch đang giữ (frontend/src/utils/dispatchDelta.ts, 06/10).
// Bất biến: sau khi ghép, MỖI dòng OD nằm đúng một chỗ (một xe hoặc khung chờ) và trùng với cái server vừa trả; xe không bị đụng
// giữ NGUYÊN đối tượng cũ (bàn dạng bảng chỉ vẽ lại xe đổi — memo theo đối tượng xe).
import { describe, it, expect } from 'vitest'
import { applyDispatchDelta, applyDispatchTrip } from '../../../frontend/src/utils/dispatchDelta'
import type { DispatchPlan, DispatchTrip, DispatchTripOd } from '../../../frontend/src/api/hooks'

const od = (id: string, trip_id: string | null, od_number = id.toUpperCase()): DispatchTripOd =>
  ({ id, plan_id: 'p', trip_id, od_number, ship_to_code: null, ship_to_name: null, ward_code: null, pallets: 1, tons: 1, lines: 1, part_index: null, part_of: null, material_codes: [] })
const trip = (id: string, seq: number, ods: DispatchTripOd[], pallets = ods.length): DispatchTrip => ({
  id, plan_id: 'p', seq, group_code: id, vehicle_model_id: null, transport_company_id: null, stops: ods.length, wards: [], pallets, tons: pallets, load_pct: null,
  underload: false, oversize: false, freight_estimated: null, manual_edited: false, status: 'DRAFT', tendered_at: null, responded_at: null, response_by: null, response_note: null, confirmed_at: null,
  detail: { freight: { total: null, base: null, billed_pallets: null, unit: null, tariff_id: null, ward: null, surcharges: [], reason: null }, load: { basis: null, used: null, cap: null, pct: null, underload: null, underload_pct: 70 },
    categories: [], booking_category: null, cluster: '', carrier_reasons: [], warnings: [], merge_hint: null, vehicle_model: null, carrier: null },
  ods,
})
const plan = (): DispatchPlan => ({
  id: 'p', warehouse_id: 'w', plan_date: '2026-10-10', status: 'DRAFT', segment: 'SALES', params: {}, unplanned: [], engine_version: null, created_by: null, confirmed_by: null, confirmed_at: null,
  created_at: '', updated_at: 'u0', summary: { trips: 2, ods: 3, pallets: 3, tons: 3, freight_total: 0, unpriced: 0, underload: 0, oversize: 0, shares: [] },
  trips: [trip('A', 1, [od('a1', 'A'), od('a2', 'A')]), trip('B', 2, [od('b1', 'B')]), trip('C', 3, [od('c1', 'C')])],
  pool: [od('p1', null)],
})
/** mỗi dòng OD nằm ở đâu — kiểm "đúng một chỗ" */
const where = (p: DispatchPlan) => {
  const m = new Map<string, string[]>()
  for (const t of p.trips) for (const o of t.ods) m.set(o.id, [...(m.get(o.id) ?? []), t.id])
  for (const o of p.pool ?? []) m.set(o.id, [...(m.get(o.id) ?? []), 'POOL'])
  return m
}

describe('applyDispatchDelta', () => {
  it('đơn xe A → xe B: A và B thay bằng bản mới, xe C giữ NGUYÊN đối tượng cũ, đơn nằm đúng một chỗ', () => {
    const p0 = plan()
    const p = applyDispatchDelta(p0, { trips: [trip('A', 1, [od('a1', 'A')]), trip('B', 2, [od('a2', 'B'), od('b1', 'B')])], pool_add: [], removed_od_ids: ['a2'], updated_at: 'u1', stamp: 's1' })
    expect(where(p).get('a2')).toEqual(['B'])
    expect([...where(p).values()].every(v => v.length === 1)).toBe(true)
    expect(p.trips.find(t => t.id === 'C')).toBe(p0.trips[2])
    expect(p.updated_at).toBe('u1')
    expect(p.stamp).toBe('s1')
  })
  it('đơn về khung chờ: rời xe, vào khung chờ một lần', () => {
    const p = applyDispatchDelta(plan(), { trips: [trip('B', 2, [])], pool_add: [od('b1', null)], removed_od_ids: ['b1'] })
    expect(where(p).get('b1')).toEqual(['POOL'])
    expect(p.trips.find(t => t.id === 'B')?.ods).toEqual([])
  })
  it('đơn khung chờ → XE MỚI (chưa có trong kế hoạch): xe mới thêm vào, xếp theo số xe, đơn rời khung chờ', () => {
    const p = applyDispatchDelta(plan(), { trips: [trip('N', 9, [od('p1', 'N')])], pool_add: [], removed_od_ids: ['p1'] })
    expect(p.trips.map(t => t.id)).toEqual(['A', 'B', 'C', 'N'])
    expect(where(p).get('p1')).toEqual(['N'])
    expect(p.pool).toEqual([])
  })
  it('gộp xe: mọi đơn của C sang B — C còn trống (không tự xoá), mỗi đơn một chỗ', () => {
    const p = applyDispatchDelta(plan(), { trips: [trip('B', 2, [od('b1', 'B'), od('c1', 'B')]), trip('C', 3, [])], pool_add: [], removed_od_ids: ['c1'] })
    expect(where(p).get('c1')).toEqual(['B'])
    expect(p.trips.find(t => t.id === 'C')?.ods.length).toBe(0)
  })
  it('server quên liệt kê một dòng trong removed_od_ids — dòng đã có ở xe mới vẫn bị bỏ khỏi chỗ cũ (không nằm hai nơi)', () => {
    const p = applyDispatchDelta(plan(), { trips: [trip('B', 2, [od('a2', 'B'), od('b1', 'B')])], pool_add: [], removed_od_ids: [] })
    expect(where(p).get('a2')).toEqual(['B'])
  })
  it('bỏ xe trống', () => {
    const p = applyDispatchDelta(plan(), { trips: [], pool_add: [], removed_od_ids: [], removed_trip_ids: ['C'] })
    expect(p.trips.map(t => t.id)).toEqual(['A', 'B'])
  })
})
describe('applyDispatchTrip', () => {
  it('sửa một xe (khoá / ĐVVT): chỉ xe đó thay, kế hoạch nhận tổng kết + dấu mới', () => {
    const p0 = plan()
    const locked = { ...p0.trips[0], locked: true }
    const p = applyDispatchTrip(p0, locked, { stamp: 's2', updated_at: 'u2' })
    expect(p.trips[0].locked).toBe(true)
    expect(p.trips[1]).toBe(p0.trips[1])
    expect(p.stamp).toBe('s2')
  })
})
