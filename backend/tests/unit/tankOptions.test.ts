// C143 (27/11): ô "Bồn" của form Mở / Lập mẻ LỌC BỎ âm thầm bồn khác đơn vị với mã BTP ⇒ bồn lít BD63 (mọi mã BTP tính KG) lúc hiện
// (chưa biết đơn vị mã) lúc mất ⇒ user tưởng bồn mới "chưa realtime". Luật mới: mọi bồn của kho đều hiện; khác đơn vị ⇒ khoá kèm lý do.
import { describe, it, expect } from 'vitest'
import { tankOptions, type TankOptInput } from '../../../frontend/src/utils/tankOptions'

const T = (id: string, unit: string, o: Partial<TankOptInput> = {}): TankOptInput =>
  ({ id, code: id.toUpperCase(), warehouse_id: 'wh', unit, capacity: 10000, content: 0, incoming: [], lots: [], ...o })
const tanks = [T('bd62', 'KG', { incoming: [{ batch_id: 'b1', qty: 6000, material_code: 'BTP-A' }] }), T('bd63', 'L'), T('x', 'KG', { warehouse_id: 'khac' })]

describe('tankOptions — ô Bồn của form tạo mẻ', () => {
  it('chưa chọn mã (đơn vị trống): mọi bồn CỦA KHO hiện, không khoá; bồn kho khác không hiện', () => {
    const o = tankOptions(tanks, 'wh', '', undefined, '')
    expect(o.map(x => x.value)).toEqual(['bd62', 'bd63'])
    expect(o.every(x => !x.disabled && !x.wrongUnit)).toBe(true)
  })
  it('mã BTP tính KG: bồn lít VẪN HIỆN nhưng khoá, ghi lý do; bồn KG còn chỗ = sức chứa − phần mẻ khác đã đặt', () => {
    const o = tankOptions(tanks, 'wh', 'KG', undefined, '')
    expect(o.map(x => x.value)).toEqual(['bd62', 'bd63'])
    const l = o.find(x => x.value === 'bd63')!
    expect(l).toMatchObject({ wrongUnit: true, disabled: true })
    expect(l.sub).toMatch(/bồn L ≠ mã KG/)
    expect(o.find(x => x.value === 'bd62')).toMatchObject({ free: 4000, disabled: false })
  })
  it('bồn khác đơn vị ĐANG CHỌN sẵn (vd đổi mã BTP sau khi chọn bồn): vẫn chọn được, cờ wrongUnit để form báo đỏ', () => {
    const o = tankOptions(tanks, 'wh', 'KG', undefined, 'bd63')
    expect(o.find(x => x.value === 'bd63')).toMatchObject({ wrongUnit: true, disabled: false })
  })
  it('sửa mẻ: phần đặt của CHÍNH mẻ đang sửa không trừ vào chỗ trống', () => {
    expect(tankOptions(tanks, 'wh', 'KG', 'b1', 'bd62').find(x => x.value === 'bd62')?.free).toBe(10000)
  })
})
