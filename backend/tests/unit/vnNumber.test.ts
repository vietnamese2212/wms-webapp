// Luật đọc số kiểu VN — mỗi dòng là một ca đã gây lỗi thật hoặc ca nhập nhằng đã chốt (xem đầu file utils/vnNumber.ts).
import { describe, it, expect } from 'vitest'
import { parseVnNumber } from '../../src/utils/vnNumber'

describe('parseVnNumber', () => {
  it.each<[unknown, number | null]>([
    ['1.234,56', 1234.56],
    ['1,234,567', 1234567],
    ['12,5', 12.5],
    ['45.000.000', 45_000_000],      // 06/09: bản chép tay ra NaN → từ chối cả file kê khai
    ['1.234', 1234],                 // 07/09: bản vá đầu ra 1,234 đồng — sai 1.000 lần, ghi êm
    ['12.5', 12.5],
    ['1.2345', 1.2345],
    ['0.123', 0.123],
    ['-1.234', -1234],
    ['45.000.000 ₫', 45_000_000],
    ['1 234', 1234],
    ['', null], ['  ', null], ['abc', null], [null, null], [undefined, null],
    [5, 5], [NaN, null], [Infinity, null],
  ])('%j → %j', (input, expected) => {
    expect(parseVnNumber(input)).toBe(expected)
  })
})
