// C125 (19/11): mã MỚI nạp bằng Excel phải đủ ô bắt buộc như form Thêm mã hàng.
import { describe, it, expect } from 'vitest'
import { materialMissingFields } from '../../src/utils/materialRequired'

const NVL = { sl: true, pe: true }
describe('materialMissingFields — ô bắt buộc của mã mới', () => {
  it('mã chỉ có Mã + Tên ⇒ thiếu Loại hàng, Base Unit, Thùng/Pallet', () => {
    expect(materialMissingFields({}, undefined)).toEqual(['Loại hàng', 'Base Unit', 'Thùng/Pallet'])
  })
  it('NVL (loại bắt HSD + Pallet/EA) thiếu hai ô đó ⇒ báo đúng tên ô', () => {
    expect(materialMissingFields({ category: 'RM01', base_unit: 'KG', cartons_per_pallet: 1000 }, NVL)).toEqual(['HSD (ngày)', 'Pallet/EA'])
  })
  it('đủ ô ⇒ rỗng; HSD = 0 vẫn tính là đã khai (khác trống)', () => {
    expect(materialMissingFields({ category: 'RM01', base_unit: 'KG', cartons_per_pallet: 1000, shelf_life_days: 720, pallet_per_ea: 0.001 }, NVL)).toEqual([])
    expect(materialMissingFields({ category: 'RM01', base_unit: 'KG', cartons_per_pallet: 1000, shelf_life_days: 0, pallet_per_ea: 0.001 }, NVL)).toEqual([])
  })
  it('ngoại lệ như form: phi hàng hoá / bán thành phẩm không ép; pallet mang hàng không cần HSD, Pallet/EA', () => {
    expect(materialMissingFields({ is_non_stock: true }, NVL)).toEqual([])
    expect(materialMissingFields({ is_semi_finished: true }, NVL)).toEqual([])
    expect(materialMissingFields({ category: 'RM01', base_unit: 'EA', cartons_per_pallet: 1, is_pallet_carrier: true }, NVL)).toEqual([])
  })
  it('Thùng/Pallet = 0 hoặc âm ⇒ coi như thiếu', () => {
    expect(materialMissingFields({ category: 'FG', base_unit: 'HOP', cartons_per_pallet: 0 }, { sl: false, pe: false })).toEqual(['Thùng/Pallet'])
  })
})
