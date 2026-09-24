// isDay kiểm LỊCH THẬT, không chỉ dạng — 30/08 fuzz làm vỡ 5 màn chính bằng '2026-02-31' (22008 → 500).
import { describe, it, expect } from 'vitest'
import { isDay, dayOrNull } from '../../src/utils/dates'

describe('isDay / dayOrNull', () => {
  it.each<[unknown, boolean]>([
    ['2026-02-28', true], ['2024-02-29', true], ['2026-12-31', true], [' 2026-01-01 ', true],
    ['2026-02-31', false], ['2026-13-45', false], ['0000-00-00', false], ['2026-1-1', false],
    ['07-09-2026', false], ['2026/09/07', false], ['', false], [null, false], [undefined, false], [20260907, false],
    ['1899-12-31', false], ['2201-01-01', false],
  ])('%j → %s', (v, ok) => {
    expect(isDay(v)).toBe(ok)
    expect(dayOrNull(v)).toBe(ok ? String(v).trim() : null)
  })
})
