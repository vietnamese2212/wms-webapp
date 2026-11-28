// Cửa ghi Mã hàng: "Entry Unit + 1 Entry = N Base" khai ở form / Excel ⇒ entry unit THẬT (mã đếm: hộp, chai) hoặc QUY CÁCH GỢI Ý
// (mã đo: kg, lít) — user 27/11: thành phẩm 1 thùng = 48 hộp là thùng thật; đường trắng 1 bao = 20 kg chỉ là gợi ý, kg là chính.
// 28/11: đơn vị nào là đơn vị đo do cờ của danh mục Đơn vị tính quyết định (tập truyền vào), không phải danh sách trong code.
import { describe, it, expect } from 'vitest'
import { splitEntryPack, declaredEntry } from '../../src/utils/materialUnits'

const MEASURE = new Set(['KG', 'L', 'M2'])

describe('splitEntryPack — tách entry unit thật / quy cách gợi ý theo cờ đơn vị đo của đơn vị gốc', () => {
  it('thành phẩm HOP + CAR 48 ⇒ entry unit thật', () => {
    expect(splitEntryPack('HOP', 'car', 48, MEASURE)).toEqual({ entry_unit: 'CAR', units_per_carton: 48, pack_unit: null, pack_size: null })
  })
  it('đường trắng KG + BAO 20 ⇒ quy cách gợi ý, entry để trống', () => {
    expect(splitEntryPack('KG', 'BAO', 20, MEASURE)).toEqual({ entry_unit: null, units_per_carton: null, pack_unit: 'BAO', pack_size: 20 })
    expect(splitEntryPack(' kg ', ' bao ', '20', MEASURE)).toEqual({ entry_unit: null, units_per_carton: null, pack_unit: 'BAO', pack_size: 20 })
  })
  it('theo CỜ, không theo tên: KG không gắn cờ ⇒ bao là thùng thật; HOP gắn cờ ⇒ thùng thành gợi ý', () => {
    expect(splitEntryPack('KG', 'BAO', 20, new Set())).toEqual({ entry_unit: 'BAO', units_per_carton: 20, pack_unit: null, pack_size: null })
    expect(splitEntryPack('HOP', 'CAR', 48, new Set(['HOP']))).toEqual({ entry_unit: null, units_per_carton: null, pack_unit: 'CAR', pack_size: 48 })
  })
  it('mọi đơn vị có cờ đều thành gợi ý; không khai entry thì giữ hệ số như cũ', () => {
    for (const u of MEASURE) expect(splitEntryPack(u, 'CAN', 5, MEASURE).entry_unit, u).toBeNull()
    expect(splitEntryPack('KG', null, null, MEASURE)).toEqual({ entry_unit: null, units_per_carton: null, pack_unit: null, pack_size: null })
    expect(splitEntryPack('EA', '', 12, MEASURE)).toEqual({ entry_unit: null, units_per_carton: 12, pack_unit: null, pack_size: null })
    expect(splitEntryPack(null, 'CAR', 12, MEASURE)).toEqual({ entry_unit: 'CAR', units_per_carton: 12, pack_unit: null, pack_size: null })
  })
  it('đọc lại: form hiện quy cách gợi ý ở cùng ô Entry Unit ⇒ lưu lại không mất bao', () => {
    const dbDuong = { entry_unit: null, units_per_carton: null, pack_unit: 'BAO', pack_size: 20 }
    const d = declaredEntry(dbDuong)
    expect(d).toEqual({ entry: 'BAO', factor: 20 })
    expect(splitEntryPack('KG', d.entry, d.factor, MEASURE)).toEqual(dbDuong)
    expect(declaredEntry({ entry_unit: 'CAR', units_per_carton: 48 })).toEqual({ entry: 'CAR', factor: 48 })
  })
})
