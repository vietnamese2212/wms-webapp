// Dòng xe theo KHO (03/10) — bản chụp của kho đè bản Chung; không có dòng kho ⇒ theo Chung; ngưỡng Non tải đọc từ kho.
import { describe, it, expect } from 'vitest'
import { applyWarehouseOverrides, underloadPctAt } from '../../src/services/vehicleModelScope'

const m = (id: string, o: Partial<{ is_active: boolean; max_pallets: number | null; max_tons: number | null; max_drops: number | null }> = {}) =>
  ({ id, name: id, is_active: true, max_pallets: 16, max_tons: 16, max_drops: 3, ...o })

describe('applyWarehouseOverrides — kho đã cấu hình riêng thì KHÔNG theo chung nữa', () => {
  it('không có dòng kho ⇒ nguyên bản Chung, wh_override=false', () => {
    const r = applyWarehouseOverrides([m('A')], [])
    expect(r[0]).toMatchObject({ id: 'A', max_pallets: 16, max_drops: 3, is_active: true, wh_override: false })
  })
  it('có dòng kho ⇒ cả bốn giá trị theo kho (kể cả null = chưa khai điểm giao), wh_override=true; dòng khác giữ chung', () => {
    const r = applyWarehouseOverrides([m('A'), m('B')], [{ vehicle_model_id: 'A', is_active: true, max_pallets: 12, max_tons: 16, max_drops: null }])
    expect(r[0]).toMatchObject({ id: 'A', max_pallets: 12, max_drops: null, wh_override: true })
    expect(r[1]).toMatchObject({ id: 'B', max_pallets: 16, max_drops: 3, wh_override: false })
  })
  it('Chung tắt mà kho bật ⇒ kho dùng; Chung bật mà kho tắt ⇒ kho không dùng (bản chụp thắng, không min/max)', () => {
    const r = applyWarehouseOverrides([m('OFF', { is_active: false }), m('ON')], [
      { vehicle_model_id: 'OFF', is_active: true, max_pallets: 16, max_tons: 16, max_drops: 3 },
      { vehicle_model_id: 'ON', is_active: false, max_pallets: 16, max_tons: 16, max_drops: 3 },
    ])
    expect(r.find(x => x.id === 'OFF')?.is_active).toBe(true)
    expect(r.find(x => x.id === 'ON')?.is_active).toBe(false)
  })
  it('giữ nguyên các trường master khác (tên, thước đo) — kho không được đổi master data', () => {
    const r = applyWarehouseOverrides([{ ...m('A'), capacity_mode: 'PALLET', sap_code: '9' }], [{ vehicle_model_id: 'A', is_active: true, max_pallets: 1, max_tons: null, max_drops: 1 }])
    expect(r[0]).toMatchObject({ capacity_mode: 'PALLET', sap_code: '9', name: 'A' })
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
