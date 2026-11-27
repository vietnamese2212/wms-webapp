// BẤT BIẾN luật BASE UNIT (CLAUDE.md "làm sai là vứt đi") — không so với hằng số gõ tay, so hai
// chiều của cùng một phép: tách rồi gộp phải về đúng số ban đầu; phần lẻ luôn < 1 thùng.
import { describe, it, expect } from 'vitest'
import { qtySplit, qtyFromEntryBase, qtyIntegerError, qtyEntryDecimal, qtyLabel, baseAllowsDecimal, qtyPackHint } from '../../src/utils/qtyUnits'
import { rng, N, SEED } from '../helpers/rng'

describe(`qtyUnits — bất biến (seed ${SEED})`, () => {
  it('mã có entry: gộp(tách(q)) = q · 0 ≤ hộp lẻ < hệ số · số nguyên hợp lệ, số lẻ bị chặn', () => {
    const r = rng()
    for (let i = 0; i < N; i++) {
      const m = { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: r.int(1, 500) }
      const q = r.int(0, 5_000_000)
      const s = qtySplit(q, m)
      expect(s.base, `q=${q} upc=${m.units_per_carton}`).toBeGreaterThanOrEqual(0)
      expect(s.base, `q=${q} upc=${m.units_per_carton}`).toBeLessThan(m.units_per_carton)
      expect(qtyFromEntryBase(s.entry, s.base, m), `q=${q} upc=${m.units_per_carton}`).toBe(q)
      expect(qtyIntegerError(q, m)).toBeNull()
      expect(qtyIntegerError(q + 0.5, m)).not.toBeNull()
      // số theo thùng × hệ số quay lại base (sai số làm tròn 3 số lẻ)
      expect(Math.abs(qtyEntryDecimal(q, m) * m.units_per_carton - q)).toBeLessThanOrEqual(m.units_per_carton * 0.0005 + 1e-6)
    }
  })

  it('mã KHÔNG entry: giữ nguyên số base, thập phân tự do, nhãn theo base_unit', () => {
    const m = { base_unit: 'KG' }
    expect(qtySplit(7004.875, m)).toEqual({ entry: 0, base: 7004.875 })
    expect(qtyIntegerError(7004.875, m)).toBeNull()
    expect(qtyEntryDecimal(7004.875, m)).toBe(7004.875)
    expect(qtyLabel(7004.875, m)).toBe('7.004,875 kg')
  })

  it('mã KG có đơn vị bao (27/11 — đường trắng 1 bao = 20 kg): phần kg được lẻ, phần bao nguyên, tách–gộp về đúng số', () => {
    const m = { base_unit: 'KG', entry_unit: 'BAO', units_per_carton: 20 }
    expect(qtySplit(110, m)).toEqual({ entry: 5, base: 10 })
    // kg là số CHÍNH, bao là GỢI Ý (user 27/11: "110 kg có gợi ý là 5 bao 10 kg")
    expect(qtyLabel(110, m)).toBe('110 kg (5 bao + 10 kg)')
    expect(qtyLabel(110.5, m)).toBe('110,5 kg (5 bao + 10,5 kg)')
    expect(qtyLabel(100, m)).toBe('100 kg (5 bao)')
    expect(qtyLabel(12.345, m)).toBe('12,345 kg')
    expect(qtyLabel(-110, m)).toBe('-110 kg (-5 bao + 10 kg)')
    expect(qtyPackHint(110, m)).toBe('5 bao + 10 kg')
    expect(qtyPackHint(19.9, m)).toBeNull()
    expect(qtyPackHint(4296, { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48 })).toBeNull()
    expect(qtyIntegerError(110.5, m)).toBeNull()
    expect(qtyIntegerError(12.345, m)).toBeNull()
    expect(baseAllowsDecimal(m)).toBe(true)
    expect(qtyFromEntryBase(5, 10.5, m)).toBe(110.5)
    // hộp / chai vẫn bị chặn số lẻ như cũ
    expect(baseAllowsDecimal({ base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48 })).toBe(false)
    expect(qtyIntegerError(0.5, { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48 })).not.toBeNull()
    const r = rng()
    for (let i = 0; i < N; i++) {
      const mm = { base_unit: 'KG', entry_unit: 'BAO', units_per_carton: r.int(1, 60) }
      const q = r.int(0, 5_000_000) / 1000
      const s = qtySplit(q, mm)
      expect(Number.isInteger(s.entry), ).toBe(true)
      expect(s.base, ).toBeGreaterThanOrEqual(0)
      expect(s.base, ).toBeLessThan(mm.units_per_carton)
      expect(qtyFromEntryBase(s.entry, s.base, mm)).toBeCloseTo(q, 6)
      expect(qtyIntegerError(q, mm)).toBeNull()
    }
  })

  it('ca đã gặp thật: 4296 hộp / 48 = 89 thùng + 24 hộp (không trôi float)', () => {
    const m = { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48 }
    expect(qtySplit(4296, m)).toEqual({ entry: 89, base: 24 })
    expect(qtyLabel(4296, m)).toBe('89 thùng + 24 hộp')
    expect(qtyLabel(-4296, m)).toBe('-89 thùng + 24 hộp')
    expect(qtyLabel(0, m)).toBe('0 thùng')
  })
})
