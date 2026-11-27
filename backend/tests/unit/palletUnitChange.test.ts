// Số / pallet đổi đơn vị khi mã thêm / bỏ đơn vị quy cách (27/11 — đường trắng 210000262: 1.000 kg / pallet, 1 bao = 20 kg).
// Thiếu bước đổi ⇒ nhập kho gợi ý 1.000 bao = 20.000 kg / pallet (inboundController: số / pallet × hệ số).
import { describe, it, expect } from 'vitest'
import { palletQtyOnUnitChange } from '../../src/utils/palletCalc'

const KG = { entry_unit: null, units_per_carton: null }
const BAO20 = { entry_unit: 'BAO', units_per_carton: 20 }
const BAO25 = { entry_unit: 'BAO', units_per_carton: 25 }

describe('palletQtyOnUnitChange', () => {
  it('thêm bao cho mã kg: 1.000 kg / pallet ⇒ 50 bao / pallet', () => {
    expect(palletQtyOnUnitChange(1000, KG, BAO20)).toEqual({ kind: 'converted', qty: 50 })
  })
  it('không chia hết ⇒ bắt khai lại (990 kg, bao 25 kg = 39,6 bao)', () => {
    expect(palletQtyOnUnitChange(990, KG, BAO25)).toEqual({ kind: 'not_whole', exact: 39.6 })
  })
  it('bỏ bao: 50 bao ⇒ 1.000 kg', () => {
    expect(palletQtyOnUnitChange(50, BAO20, KG)).toEqual({ kind: 'converted', qty: 1000 })
  })
  it('đơn vị của ô không đổi ⇒ giữ nguyên (đổi hệ số bao, thùng → thùng, kg → kg)', () => {
    expect(palletQtyOnUnitChange(50, BAO20, BAO25)).toEqual({ kind: 'same' })
    expect(palletQtyOnUnitChange(140, { entry_unit: 'CAR', units_per_carton: 48 }, { entry_unit: 'CAR', units_per_carton: 24 })).toEqual({ kind: 'same' })
    expect(palletQtyOnUnitChange(1000, KG, KG)).toEqual({ kind: 'same' })
  })
  it('số trống / 0 ⇒ không có gì để đổi', () => {
    expect(palletQtyOnUnitChange(null, KG, BAO20)).toEqual({ kind: 'same' })
    expect(palletQtyOnUnitChange(0, KG, BAO20)).toEqual({ kind: 'same' })
  })
  it('khai đơn vị mà hệ số 0 = chưa có quy cách', () => {
    expect(palletQtyOnUnitChange(1000, KG, { entry_unit: 'BAO', units_per_carton: 0 })).toEqual({ kind: 'same' })
  })
})
