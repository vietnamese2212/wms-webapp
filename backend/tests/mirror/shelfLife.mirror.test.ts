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

      // HSD hiệu lực: hai bản phải chỉ vào ĐÚNG một mốc thời gian (không có chuyện làm tròn).
      expect(FE.effectiveExpiryMs(entry, material), ctx).toBe(BE.effectiveExpiryMs(entry, material))

      // Số ngày còn lại: FE làm tròn XUỐNG (còn 2,6 ngày thì nói "2 ngày").
      const beD = BE.computeDaysLeft(entry, material, now)
      const feD = FE.computeDaysLeft(entry, material, now)
      if (beD == null) expect(feD, ctx).toBeNull()
      else expect(feD, ctx).toBe(Math.max(0, Math.floor(beD)))
    }
  })

  // Quan hệ giữa hai thước đo — KHÔNG đối xứng, và sự bất đối xứng đó là CÓ THẬT:
  //   • Không đo được NGÀY ⇒ chắc chắn không đo được %Date (không có mốc HSD nào).
  //   • Ngược lại thì KHÔNG: tem V2 mang HSD tường minh mà mã chưa khai shelf-life và pallet
  //     thiếu NSX ⇒ "còn 45 ngày" tính được, nhưng %Date thì KHÔNG (không có mẫu số).
  // Phép kiểm này phát hiện đúng ca đó lần chạy đầu (seed 20260911) ⇒ điều kiện miễn trừ của
  // bậc 5 phải đọc CỜ ĐỊNH DẠNG TEM, không chỉ đọc shelf_life_days. Xem `dateMeasurable`.
  it('không đo được NGÀY thì cũng không đo được %Date (chiều ngược lại KHÔNG đúng)', () => {
    const r = rng()
    const base = Date.UTC(2026, 0, 1)
    for (let i = 0; i < N; i++) {
      const material = { shelf_life_days: r.pick([null, 0, 45, 60, 248, 720]), supplier_shelf_life_overrides: null }
      const prod = r.bool(0.15) ? null : new Date(base + r.int(-900, 300) * DAY).toISOString().slice(0, 10)
      const exp = r.bool(0.6) ? null : new Date(base + r.int(-30, 900) * DAY).toISOString().slice(0, 10)
      const entry = { production_date: prod, expiry_date: exp, shelf_life_days: null, ncc_id: null }
      const now = base + r.int(-100, 1000) * DAY
      const ctx = JSON.stringify({ material, entry, now })

      const pct = BE.computePctDate(entry, material, now)
      const days = BE.computeDaysLeft(entry, material, now)
      if (days == null) expect(pct, ctx).toBeNull()
      // Đo được cả hai thì phải cùng kết luận còn hạn hay hết (chung một mốc HSD).
      if (pct != null && days != null) expect(pct > 0, ctx).toBe(days > 0)
    }
  })
})
