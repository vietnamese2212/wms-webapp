// MIRROR kho của pallet khi chuyển ô: BE (chặn CROSS_WAREHOUSE) ⇄ FE (ô chọn vị trí ở Tồn kho). Lớp C118 (17/11).
import { describe, it, expect } from 'vitest'
import { moveSourceWarehouse as BE, selectionWarehouses as BEsel } from '../../src/utils/entryWarehouse'
import { moveSourceWarehouse as FE, selectionWarehouses as FEsel } from '../../../frontend/src/utils/entryWarehouse'

type Case = { col: string | null; loc: string | null }
const cases: Case[] = [
  { col: 'A', loc: 'A' }, { col: 'A', loc: null }, { col: null, loc: 'B' }, { col: null, loc: null }, { col: 'A', loc: 'B' },
]
const be = (c: Case) => ({ warehouse_id: c.col, location: c.loc === null ? null : { warehouse_id: c.loc } })
// màn hình nhận ô dạng lồng { warehouse: { id } } (select của danh sách tồn)
const fe = (c: Case) => ({ warehouse_id: c.col, location: c.loc === null ? null : { warehouse: { id: c.loc } } })

describe('entryWarehouse BE ⇄ FE', () => {
  it('kho của từng pallet khớp — kể cả pallet CHƯA xếp ô (kho chế biến)', () => {
    for (const c of cases) expect(FE(fe(c)), JSON.stringify(c)).toBe(BE(be(c)))
    expect(FE(fe({ col: 'CB', loc: null }))).toBe('CB')   // bản lỗi (chỉ đọc kho của ô) trả null ở ca này
  })
  it('kho của một lô khớp; lô hai kho ⇒ 2 kho', () => {
    const lot = [cases[0], cases[1], cases[2], cases[3]]
    expect(FEsel(lot.map(fe)).sort()).toEqual(BEsel(lot.map(be)).sort())
    expect(BEsel(lot.map(be)).sort()).toEqual(['A', 'B'])
  })
})
