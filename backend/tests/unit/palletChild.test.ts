import { describe, it, expect } from 'vitest'
import { childBaseOf, childLikePattern, childIndexOf, childCodeOf, childInheritedFields, CHILD_INHERITED_COLS } from '../../src/utils/palletChild'

const V1 = '070526_510000127_C05_M1_001_B'
const V2 = '50033;      1;TA260705A018;05/07/2026;05/03/2027;      1;05:26'

describe('palletChild — mã pallet con ".N" (Tách pallet + hàng lẻ trả về)', () => {
  it('V1: ".N" gắn vào đoạn STT, giữ các đoạn khác', () => {
    const b = childBaseOf(V1).base!
    expect(childCodeOf(b, 3)).toBe('070526_510000127_C05_M1_001.3_B')
    expect(childLikePattern(b)).toBe('070526_510000127_C05_M1_001.%')
  })
  it('V2: ".N" gắn vào đuôi mã lô (đoạn 3), GIỮ đệm space các đoạn khác', () => {
    const b = childBaseOf(V2).base!
    expect(childCodeOf(b, 2)).toBe('50033;      1;TA260705A018.2;05/07/2026;05/03/2027;      1;05:26')
    expect(childLikePattern(b)).toBe('%TA260705A018.%')
  })
  it('childIndexOf: nhận đúng con trực tiếp, loại mã khác gốc', () => {
    const b1 = childBaseOf(V1).base!
    expect(childIndexOf(b1, childCodeOf(b1, 7))).toBe(7)
    expect(childIndexOf(b1, '070526_510000127_C05_M2_001.7_B')).toBeNull()   // khác máy
    expect(childIndexOf(b1, V1)).toBeNull()                                     // chính tem gốc
    const b2 = childBaseOf(V2).base!
    expect(childIndexOf(b2, childCodeOf(b2, 12))).toBe(12)
    expect(childIndexOf(b2, '50033;      1;TA260705A018.1.2;05/07/2026;05/03/2027;      1;05:26')).toBeNull()   // cháu
  })
  it('pallet con kế thừa ĐỦ lý lịch lô của tem gốc — NCC · NMSX · HSD theo NCC không được rơi (C123)', () => {
    for (const c of ['ncc_id', 'nmsx', 'shelf_life_days', 'qa_status_id', 'production_date', 'batch', 'expiry_date', 'cycle', 'machine_code', 'manufacturer_id'])
      expect(CHILD_INHERITED_COLS).toContain(c)
    const src = { material_id: 'm', manufacturer_id: null, nmsx: 'B', cycle: 'L2611', machine_code: null, pallet_sequence_no: 1, qa_status_id: 'x',
      production_date: '2026-11-19', batch: null, expiry_date: null, ncc_id: 'n1', shelf_life_days: 200, cartons_remaining: 999 }
    const out = childInheritedFields(src)
    expect(out).toMatchObject({ ncc_id: 'n1', nmsx: 'B', shelf_life_days: 200, cycle: 'L2611', qa_status_id: 'x' })
    expect(out).not.toHaveProperty('cartons_remaining')   // số lượng KHÔNG kế thừa — con mang số tách ra
  })
  it('tem sai dạng ⇒ lỗi, không đoán', () => {
    expect(childBaseOf('ABC_123').error).toMatch(/không đúng định dạng/)
    expect(childBaseOf('50033;1').error).toMatch(/thiếu mã lô/)
  })
})
