// MIRROR số kiểu VN: BE (Chi phí kho, upload) ⇄ FE (upload Kế hoạch xuất). Đo 06/09: bản chép tay
// đọc "1.234" thành 1,234 (sai 1.000 lần, ghi êm). Bất biến: cùng chuỗi → cùng số hoặc cùng null.
import { describe, it, expect } from 'vitest'
import { parseVnNumber as BE, vnNumberInput as BE_IN } from '../../src/utils/vnNumber'
import { parseVnNumber as FE, vnNumberInput as FE_IN } from '../../../frontend/src/utils/vnNumber'
import { rng, N, SEED } from '../helpers/rng'

const CORPUS: unknown[] = ['1.234,56', '1,234,567', '12,5', '45.000.000', '1.234', '12.5', '1.2345', '0.123', '-1.234',
  '', ' ', 'abc', '45.000.000 ₫', '1 234', null, undefined, 5, NaN, Infinity, '1,5,', '.5', ',5', '1.', '1,']

describe(`vnNumber BE ⇄ FE (seed ${SEED})`, () => {
  it('parseVnNumber khớp trên corpus + chuỗi ngẫu nhiên', () => {
    for (const v of CORPUS) expect(FE(v), JSON.stringify(v)).toBe(BE(v))
    const r = rng()
    for (let i = 0; i < N; i++) {
      const s = r.str('0123456789.,-  ₫đ', 0, 12)
      expect(FE(s), JSON.stringify(s)).toBe(BE(s))
    }
  })
  // 14/11 (MES): ô nhập điền sẵn String(933.333) bị đọc lại thành 933333 — điền sẵn phải đi-về đúng số
  it('vnNumberInput → parseVnNumber đi-về đúng số (≤ 3 số lẻ), hai bản khớp nhau', () => {
    for (const x of [933.333, 2.125, 0.5, 1234.5, 4000, 12.375, 0, 999.999, 1000.001]) {
      expect(FE_IN(x)).toBe(BE_IN(x))
      expect(FE(FE_IN(x)), String(x)).toBe(x)
    }
    let seed = 20261114
    for (let i = 0; i < 5000; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      const x = (seed % 20_000_000) / 1000
      expect(BE(BE_IN(x)), String(x)).toBe(x)
    }
    expect(FE_IN(null)).toBe(''); expect(FE_IN(NaN)).toBe('')
  })
})
