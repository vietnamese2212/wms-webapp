// BẤT BIẾN luật BASE UNIT (CLAUDE.md "làm sai là vứt đi") — không so với hằng số gõ tay, so hai
// chiều của cùng một phép: tách rồi gộp phải về đúng số ban đầu; phần lẻ luôn < 1 thùng.
import { describe, it, expect } from 'vitest'
import { qtySplit, qtyFromEntryBase, qtyIntegerError, qtyEntryDecimal, qtyLabel, baseAllowsDecimal, qtyPackHint, qtyMainUnits, hasEntry,
  qtyTotalsByUnit, qtyTotalsText, qtyTotalsPairText, qtyTotalsProgress } from '../../src/utils/qtyUnits'
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

  // BẢNG TÌNH HUỐNG → KẾT QUẢ (user 27/11): "Hàng thành phẩm 1 thùng = 48 hộp: key 60 hộp thì quy đổi thành 1 thùng 12 hộp, key
  // 1 thùng 12 hộp thì giữ 1 thùng 12 hộp. Hàng NVL như đường trắng: key 1000 kg giữ là 1000 kg, chỉ gợi ý 50 bao, kg vẫn là đơn
  // vị chính." App PHÂN BIỆT bằng đơn vị gốc: đơn vị đếm (hộp) ⇒ thùng là entry unit thật; đơn vị đo (kg) ⇒ bao chỉ là gợi ý.
  it('thành phẩm 1 thùng = 48 hộp: 60 hộp = 1 thùng + 12 hộp, hai cách gõ cùng một số, hộp phải nguyên', () => {
    const sua = { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48 }
    expect(qtyFromEntryBase(0, 60, sua)).toBe(60)            // gõ 60 hộp
    expect(qtyFromEntryBase(1, 12, sua)).toBe(60)            // gõ 1 thùng + 12 hộp
    expect(qtyLabel(60, sua)).toBe('1 thùng + 12 hộp')
    expect(qtySplit(60, sua)).toEqual({ entry: 1, base: 12 })
    expect(qtyIntegerError(0.5, sua)).not.toBeNull()
    expect(baseAllowsDecimal(sua)).toBe(false)
    expect(qtyPackHint(60, sua)).toBeNull()
    expect(qtyMainUnits(sua)).toBe(sua)
    expect(qtyTotalsByUnit([{ qty: 480, mat: sua }])).toEqual([{ unit: 'CAR', qty: 10 }])
  })

  it('đường trắng (KG, gợi ý 1 bao = 20 kg): 1.000 kg giữ 1.000 kg, bao chỉ là gợi ý, mọi phép tính như chưa khai bao', () => {
    const duong = { base_unit: 'KG', pack_unit: 'BAO', pack_size: 20 }
    const truoc = { base_unit: 'KG' }   // cùng mã trước khi khai bao
    expect(hasEntry(duong)).toBe(false)
    for (const q of [1000, 110, 110.5, 12.345, 0, -110]) {
      expect(qtySplit(q, duong)).toEqual(qtySplit(q, truoc))
      expect(qtyEntryDecimal(q, duong)).toBe(qtyEntryDecimal(q, truoc))
      expect(qtyIntegerError(q, duong)).toBeNull()
    }
    expect(qtyFromEntryBase(0, 1000, duong)).toBe(1000)      // gõ 1.000 kg
    expect(qtyFromEntryBase(1000, 0, duong)).toBe(1000)      // cột "Thùng" của Excel ghi 1.000 ⇒ vẫn 1.000 kg như trước khi khai bao
    expect(qtyEntryDecimal(1000, duong)).toBe(1000)          // ô tổng "SL (quy đổi)" đếm 1.000, không phải 50
    expect(qtyLabel(1000, duong)).toBe('1.000 kg (50 bao)')
    expect(qtyLabel(110, duong)).toBe('110 kg (5 bao + 10 kg)')
    expect(qtyLabel(110.5, duong)).toBe('110,5 kg (5 bao + 10,5 kg)')
    expect(qtyLabel(12.345, duong)).toBe('12,345 kg')
    expect(qtyLabel(-110, duong)).toBe('-110 kg (-5 bao + 10 kg)')
    expect(qtyPackHint(1000, duong)).toBe('50 bao')
    expect(qtyPackHint(19.9, duong)).toBeNull()
    expect(qtyLabel(110, qtyMainUnits(duong))).toBe('110 kg')
    expect(qtyTotalsByUnit([{ qty: 1000, mat: duong }])).toEqual([{ unit: 'KG', qty: 1000 }])
    // quy cách gợi ý chỉ có nghĩa với đơn vị đo — DB (trg_material_unit_kind) không cho mã đếm mang nó; helper tin dữ liệu
    // (28/11: đơn vị đo là cờ cấu hình, helper không tự đoán theo tên). Mã có thùng thật thì thùng thắng, không in gợi ý.
    expect(qtyPackHint(100, { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48, pack_unit: 'BAO', pack_size: 20 })).toBeNull()
    expect(qtyPackHint(100, { base_unit: 'KG', pack_unit: 'BAO', pack_size: 0 })).toBeNull()
  })

  it('ô tổng chuyến 10 thùng sữa + 1.000 kg đường: "10 thùng · 1.000 kg", tiến độ tính theo từng đơn vị', () => {
    const sua = { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48 }
    const duong = { base_unit: 'KG', pack_unit: 'BAO', pack_size: 20 }
    const plan = qtyTotalsByUnit([{ qty: 480, mat: sua }, { qty: 1000, mat: duong }])
    expect(qtyTotalsText(plan)).toBe('10 thùng · 1.000 kg')
    const done = qtyTotalsByUnit([{ qty: 192, mat: sua }, { qty: 400, mat: duong }])
    expect(qtyTotalsPairText(done, plan)).toBe('4/10 thùng · 400/1.000 kg')
    expect(qtyTotalsProgress(done, plan)).toBeCloseTo(0.4, 9)
    expect(qtyTotalsPairText([], qtyTotalsByUnit([{ qty: 1000, mat: duong }]))).toBe('0/1.000 kg')
    // chuyến chỉ có thùng: tiến độ y như cách cũ (đã quét / kế hoạch)
    const p2 = qtyTotalsByUnit([{ qty: 480, mat: sua }, { qty: 240, mat: { base_unit: 'BT', entry_unit: 'CAR', units_per_carton: 24 } }])
    expect(qtyTotalsText(p2)).toBe('20 thùng')
    expect(qtyTotalsProgress([{ unit: 'CAR', qty: 5 }], p2)).toBeCloseTo(0.25, 9)
  })

  it('ca đã gặp thật: 4296 hộp / 48 = 89 thùng + 24 hộp (không trôi float)', () => {
    const m = { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48 }
    expect(qtySplit(4296, m)).toEqual({ entry: 89, base: 24 })
    expect(qtyLabel(4296, m)).toBe('89 thùng + 24 hộp')
    expect(qtyLabel(-4296, m)).toBe('-89 thùng + 24 hộp')
    expect(qtyLabel(0, m)).toBe('0 thùng')
  })
})
