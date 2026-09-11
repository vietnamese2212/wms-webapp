// MIRROR %Date: BE (gác xuất/nhặt lẻ, cảnh báo, chốt %Date) ⇄ FE (Tồn kho, chi tiết pallet).
// Khác biệt CÓ CHỦ ĐÍCH duy nhất: BE trả số CHƯA làm tròn (để so ngưỡng), FE làm tròn để hiển thị
// ⇒ bất biến: FE === Math.round(BE). Mọi lệch khác là lỗi.
import { describe, it, expect } from 'vitest'
import * as BE from '../../src/utils/shelfLife'
import * as FE from '../../../frontend/src/utils/shelfLife'
import { rng, N, SEED } from '../helpers/rng'

const DAY = 86_400_000
const NCC = ['ncc-a', 'ncc-b', 'ncc-c']

describe(`shelfLife BE ⇄ FE (seed ${SEED})`, () => {
  it('effShelfLife / resolveShelfLife / computePctDate khớp (FE = round(BE))', () => {
    const r = rng()
    const base = Date.UTC(2026, 0, 1)
    for (let i = 0; i < N; i++) {
      const material = r.bool(0.15) ? null : {
        shelf_life_days: r.pick([null, 0, 90, 180, 365, 730, -5]),
        supplier_shelf_life_overrides: r.bool(0.4) ? null : Array.from({ length: r.int(0, 3) }, () => ({
          transport_company_id: r.pick(NCC),
          shelf_life_days: r.pick([0, 100, 200, 365]),
        })),
      }
      const ncc = r.bool(0.3) ? null : r.pick(NCC)
      const prod = r.bool(0.1) ? null : base + r.int(-900, 300) * DAY
      const prodVal = prod == null ? null : (r.bool() ? new Date(prod).toISOString().slice(0, 10) : new Date(prod))
      const exp = r.bool(0.5) ? null : (prod ?? base) + r.int(-30, 900) * DAY
      const expVal = exp == null ? null : (r.bool() ? new Date(exp).toISOString().slice(0, 10) : r.bool(0.1) ? 'rác' : new Date(exp))
      const entry = {
        production_date: prodVal,
        expiry_date: expVal,
        shelf_life_days: r.pick([null, undefined, 0, 120, 400]),
        ncc_id: ncc,
      }
      const now = base + r.int(-100, 1000) * DAY + r.int(0, DAY)
      const ctx = JSON.stringify({ material, entry, now })

      expect(FE.effShelfLife(material, ncc), ctx).toBe(BE.effShelfLife(material, ncc))
      expect(FE.resolveShelfLife(entry.shelf_life_days, material, ncc), ctx)
        .toBe(BE.resolveShelfLife(entry.shelf_life_days, material, ncc))

      const be = BE.computePctDate(entry, material, now)
      const fe = FE.computePctDate(entry, material, now)
      if (be == null) expect(fe, ctx).toBeNull()
      else expect(fe, ctx).toBe(Math.max(0, Math.round(be)))
    }
  })
})
