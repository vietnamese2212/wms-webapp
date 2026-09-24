// MIRROR qtyUnits: BE (câu lỗi 422, upload, tổng) ⇄ FE (mọi ô số lượng) phải ra CÙNG số.
// Lệch một nhánh = "SL hiện 89 thùng + 24 hộp" ở màn này nhưng BE tính 90 thùng ở cửa ghi.
import { describe, it, expect } from 'vitest'
import * as BE from '../../src/utils/qtyUnits'
import * as FE from '../../../frontend/src/utils/qtyUnits'
import { rng, N, SEED } from '../helpers/rng'

const MATS: (BE.MatUnits | null | undefined)[] = [
  null, undefined, {},
  { base_unit: 'KG' },
  { base_unit: 'EA', entry_unit: null, units_per_carton: null },
  { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48 },
  { base_unit: 'BT', entry_unit: 'CAR', units_per_carton: 24 },
  { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 1 },
  { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 0 },      // hệ số 0 = KHÔNG entry
  { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: null },
  { base_unit: 'set', entry_unit: 'car', units_per_carton: 7.5 },     // hệ số lẻ + mã thường
  { base_unit: 'XYZ', entry_unit: 'ABC', units_per_carton: 12 },      // ĐVT lạ → mã thô
]

function randQty(r: ReturnType<typeof rng>): number {
  switch (r.int(0, 7)) {
    case 0: return r.int(0, 1_000_000)
    case 1: return -r.int(0, 100_000)
    case 2: return r.int(0, 10_000) / 8            // thập phân
    case 3: return r.int(0, 1000) + 0.1 * r.int(0, 9)
    case 4: return NaN
    case 5: return Infinity
    case 6: return 1e15 + r.int(0, 999)
    default: return r.int(0, 50)
  }
}

describe(`qtyUnits BE ⇄ FE (seed ${SEED})`, () => {
  it('mọi hàm thuần ra cùng kết quả trên input ngẫu nhiên', () => {
    const r = rng()
    for (let i = 0; i < N; i++) {
      const m = r.pick(MATS)
      const q = randQty(r)
      const ctx = `m=${JSON.stringify(m)} q=${q}`
      expect(FE.hasEntry(m), ctx).toBe(BE.hasEntry(m))
      expect(FE.qtySplit(q, m), ctx).toEqual(BE.qtySplit(q, m))
      expect(FE.qtyEntryDecimal(q, m), ctx).toBe(BE.qtyEntryDecimal(q, m))
      expect(FE.qtyIntegerError(q, m), ctx).toBe(BE.qtyIntegerError(q, m))
      expect(FE.qtyLabel(q, m), ctx).toBe(BE.qtyLabel(q, m))
      expect(FE.qtyEntryText(q, m), ctx).toBe(BE.qtyEntryText(q, m))
      expect(FE.qtyUnitLabel(m), ctx).toBe(BE.qtyUnitLabel(m))
      expect(FE.qtyBaseLabel(m), ctx).toBe(BE.qtyBaseLabel(m))
      expect(FE.unitCodeOf(m), ctx).toBe(BE.unitCodeOf(m))
      const e = r.int(-5, 500), b = r.int(-5, 200)
      expect(FE.qtyFromEntryBase(e, b, m), `${ctx} e=${e} b=${b}`).toBe(BE.qtyFromEntryBase(e, b, m))
    }
  })

  it('bảng nhãn ĐVT tĩnh khớp nhau (FE chưa nạp danh mục = dùng đúng bảng BE)', () => {
    for (const code of ['CAR', 'HOP', 'KG', 'BAG', 'EA', 'BT', 'SET', 'ROL', 'M2', 'G', 'L', '', null, 'car', ' hop ', 'LẠ'])
      expect(FE.unitLabel(code), String(code)).toBe(BE.unitLabel(code))
  })
})
