// Dòng xe theo KHO (03/10) — RIÊNG THEO TỪNG Ô: ô kho đã chỉnh đè Chung, ô NULL theo Chung; ngưỡng Non tải đọc từ kho.
import { describe, it, expect } from 'vitest'
import { applyWarehouseOverrides, underloadPctAt, multiVehicleOf, detourPctOf } from '../../src/services/vehicleModelScope'

const m = (id: string, o: Partial<{ is_active: boolean; max_pallets: number | null; max_tons: number | null; max_drops: number | null }> = {}) =>
  ({ id, name: id, is_active: true, max_pallets: 16, max_tons: 16, max_drops: 3, ...o })
const ov = (id: string, o: Partial<{ is_active: boolean | null; max_pallets: number | null; max_tons: number | null; max_drops: number | null }>) =>
  ({ vehicle_model_id: id, is_active: null, max_pallets: null, max_tons: null, max_drops: null, ...o })

describe('applyWarehouseOverrides — riêng theo TỪNG Ô (user 03/10: "đổi 1 điểm tại kho mà mọi setting Chung không với tới nữa — chưa hợp lý")', () => {
  it('không có dòng kho ⇒ nguyên bản Chung, wh_override=false, wh_fields rỗng', () => {
    const r = applyWarehouseOverrides([m('A')], [])
    expect(r[0]).toMatchObject({ id: 'A', max_pallets: 16, max_drops: 3, is_active: true, wh_override: false, wh_fields: [] })
  })
  it('kho chỉ chỉnh sức chứa ⇒ CHỈ ô đó riêng (đỏ bản chụp cũ: điểm giao / is_active vẫn đi theo Chung)', () => {
    const r = applyWarehouseOverrides([m('A', { max_drops: 5, is_active: false })], [ov('A', { max_pallets: 12 })])
    expect(r[0]).toMatchObject({ max_pallets: 12, max_drops: 5, is_active: false, wh_override: true, wh_fields: ['max_pallets'] })
  })
  it('kho chỉnh is_active riêng ⇒ thắng Chung ở ô đó (Chung tắt mà kho bật = kho dùng; Chung bật mà kho tắt = kho không dùng)', () => {
    const r = applyWarehouseOverrides([m('OFF', { is_active: false }), m('ON')], [ov('OFF', { is_active: true }), ov('ON', { is_active: false })])
    expect(r.find(x => x.id === 'OFF')).toMatchObject({ is_active: true, wh_fields: ['is_active'] })
    expect(r.find(x => x.id === 'ON')).toMatchObject({ is_active: false, wh_fields: ['is_active'] })
  })
  it('dòng kho mà cả bốn ô NULL = không có gì riêng (wh_override=false)', () => {
    const r = applyWarehouseOverrides([m('A')], [ov('A', {})])
    expect(r[0]).toMatchObject({ max_pallets: 16, is_active: true, wh_override: false, wh_fields: [] })
  })
  it('giữ nguyên các trường master khác (tên, thước đo) — kho không được đổi master data', () => {
    const r = applyWarehouseOverrides([{ ...m('A'), capacity_mode: 'PALLET', sap_code: '9' }], [ov('A', { max_pallets: 1, max_drops: 1 })])
    expect(r[0]).toMatchObject({ capacity_mode: 'PALLET', sap_code: '9', name: 'A', max_pallets: 1, max_drops: 1, wh_fields: ['max_pallets', 'max_drops'] })
  })
})

// 07/10 — "ghép nhiều xe trên một thẻ" (user: "khai như các tính năng khác — xe cha lấy xuống xe con, theo kho")
describe('ghép nhiều xe: kho → dòng xe → loại xe cha → mặc định được', () => {
  it('ô kho riêng thắng dòng xe; ô kho trống theo dòng xe; dòng xe trống theo cha; cả ba trống = được (hành vi trước 07/10)', () => {
    const r = applyWarehouseOverrides([{ ...m('A'), allow_multi_vehicle: true }, { ...m('B'), allow_multi_vehicle: null }, { ...m('C'), allow_multi_vehicle: false }],
      [{ ...ov('A', {}), allow_multi_vehicle: false }, { ...ov('C', {}), allow_multi_vehicle: null }])
    expect(r.map(x => [x.id, x.allow_multi_vehicle, x.wh_fields])).toEqual([['A', false, ['allow_multi_vehicle']], ['B', null, []], ['C', false, []]])
    expect(multiVehicleOf(r[0].allow_multi_vehicle, true)).toBe(false)    // kho tắt dù cha bật
    expect(multiVehicleOf(r[1].allow_multi_vehicle, false)).toBe(false)   // dòng xe trống ⇒ theo cha (tắt)
    expect(multiVehicleOf(true, false)).toBe(true)                        // dòng xe bật riêng dù cha tắt
    expect(multiVehicleOf(null, null)).toBe(true)
    expect(multiVehicleOf(undefined, undefined)).toBe(true)
  })
})

// 08/10 — "xe tuyến liên tỉnh — đường vòng tối đa %" chuyển từ form Kho sang dòng xe (user: "config TMS ở kho là không phù hợp —
// chuyển sang dòng xe cha; dòng xe con chọn khác thì lấy theo con, tương tự các config khác")
describe('đường vòng %: kho → dòng xe → loại xe cha → tắt; 0 ở bậc nào là TẮT ở bậc đó', () => {
  it('ô kho riêng thắng dòng xe; ô kho trống theo dòng xe; dòng xe trống theo cha; cả ba trống = không ghép khác tỉnh', () => {
    const r = applyWarehouseOverrides([{ ...m('A'), detour_pct: 20 }, { ...m('B'), detour_pct: null }, { ...m('C'), detour_pct: 10 }],
      [{ ...ov('A', {}), detour_pct: 0 }, { ...ov('C', {}), detour_pct: null }])
    expect(r.map(x => [x.id, x.detour_pct, x.wh_fields])).toEqual([['A', 0, ['detour_pct']], ['B', null, []], ['C', 10, []]])
    expect(detourPctOf(r[0].detour_pct, 30)).toBeNull()   // kho tắt (0) dù dòng xe 20 và cha 30
    expect(detourPctOf(r[1].detour_pct, 15)).toBe(15)      // dòng xe trống ⇒ theo cha
    expect(detourPctOf(r[2].detour_pct, 30)).toBe(10)      // dòng xe khai riêng thắng cha
    expect(detourPctOf(0, 30)).toBeNull()                  // dòng xe tắt riêng dù cha bật
    expect(detourPctOf(null, null)).toBeNull()
    expect(detourPctOf(undefined, '12.5')).toBe(12.5)      // numeric của Postgres về dạng chuỗi
  })
})

describe('underloadPctAt — dải tải theo cha của kho → ngưỡng kho → 70 (ô Non tải của dòng xe đã bỏ)', () => {
  it('cha có trong dải ⇒ min của dải (kể cả 0 = bỏ qua)', () => {
    expect(underloadPctAt({ dispatch_load_bands: { P1: { min: 85, max: 105 } }, dispatch_underload_pct: 60 }, 'P1')).toBe(85)
    expect(underloadPctAt({ dispatch_load_bands: { P1: { min: 0, max: 100 } }, dispatch_underload_pct: 60 }, 'P1')).toBe(0)
  })
  it('cha không có trong dải ⇒ ngưỡng kho; kho không khai ⇒ 70; kho null ⇒ 70', () => {
    expect(underloadPctAt({ dispatch_load_bands: { P1: { min: 85, max: 105 } }, dispatch_underload_pct: 60 }, 'P2')).toBe(60)
    expect(underloadPctAt({ dispatch_load_bands: null, dispatch_underload_pct: '55' }, null)).toBe(55)
    expect(underloadPctAt({ dispatch_load_bands: null, dispatch_underload_pct: null }, 'P1')).toBe(70)
    expect(underloadPctAt(null, 'P1')).toBe(70)
  })
})
