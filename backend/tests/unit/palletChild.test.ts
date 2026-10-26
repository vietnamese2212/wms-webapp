import { describe, it, expect } from 'vitest'
import { childBaseOf, childLikePattern, childIndexOf, childCodeOf } from '../../src/utils/palletChild'

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
  it('tem sai dạng ⇒ lỗi, không đoán', () => {
    expect(childBaseOf('ABC_123').error).toMatch(/không đúng định dạng/)
    expect(childBaseOf('50033;1').error).toMatch(/thiếu mã lô/)
  })
})
