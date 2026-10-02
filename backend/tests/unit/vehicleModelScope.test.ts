// Dòng xe theo KHO (03/10) — RIÊNG THEO TỪNG Ô: ô kho đã chỉnh đè Chung, ô NULL theo Chung; ngưỡng Non tải đọc từ kho.
import { describe, it, expect } from 'vitest'
import { applyWarehouseOverrides, underloadPctAt } from '../../src/services/vehicleModelScope'

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
