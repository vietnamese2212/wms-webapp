// Dán từ Excel vào bảng dòng hàng (frontend/src/utils/excelPaste.ts, 26/11 — form Tạo phiếu nhập "Nhập nhiều mã" / NCC
// chỉ dán được MÃ: khối Mã | Số lượng bị coi cả dòng (có TAB) là mã; dán cột số vào ô Thùng thì ghi thẳng làm đơn vị gốc).
// Hợp đồng: lưới dòng × cột theo TAB; một ô đơn trả null (trình duyệt tự dán); số đọc kiểu VN; Thùng quy đổi qua hệ số mã.
import { describe, it, expect } from 'vitest'
import { pasteGrid, pasteNum } from '../../../frontend/src/utils/excelPaste'
import { qtyFromEntryBase, type MatUnits } from '../../../frontend/src/utils/qtyUnits'

const CARTON: MatUnits = { base_unit: 'EA', entry_unit: 'CAR', units_per_carton: 24 }
const KG: MatUnits = { base_unit: 'KG', entry_unit: null, units_per_carton: null }

describe('pasteGrid', () => {
  it('một ô đơn (Excel kèm \\r\\n cuối) ⇒ null — để trình duyệt tự dán', () => {
    expect(pasteGrid('RM001\r\n')).toBeNull()
    expect(pasteGrid('RM001')).toBeNull()
  })
  it('khối Mã | Thùng | Lẻ nhiều dòng ⇒ lưới theo TAB, bỏ dòng trống cuối', () => {
    expect(pasteGrid('RM001\t10\t\r\nPK002\t2\t5\r\n')).toEqual([['RM001', '10', ''], ['PK002', '2', '5']])
  })
  it('một dòng có TAB vẫn là khối (bản cũ dán cả "RM001\\t10" vào ô mã)', () => {
    expect(pasteGrid('RM001\t10')).toEqual([['RM001', '10']])
  })
  it('một cột số nhiều dòng ⇒ mỗi dòng một ô', () => {
    expect(pasteGrid('10\n20\n\n30\n')).toEqual([['10'], ['20'], ['30']])
  })
})

describe('pasteNum + quy đổi', () => {
  it('đọc số kiểu VN; trống / chữ / âm ⇒ 0', () => {
    expect(pasteNum('1.234')).toBe(1234)
    expect(pasteNum('12,5')).toBe(12.5)
    expect(pasteNum('')).toBe(0)
    expect(pasteNum(undefined)).toBe(0)
    expect(pasteNum('abc')).toBe(0)
    expect(pasteNum('-3')).toBe(0)
  })
  it('mã có thùng: cột Thùng nhân hệ số, cột Lẻ cộng thêm (dán 10 thùng KHÔNG thành 10 hộp)', () => {
    const [cols] = pasteGrid('PK002\t10\t5')!
    expect(qtyFromEntryBase(pasteNum(cols[1]), pasteNum(cols[2]), CARTON)).toBe(245)
  })
  it('mã tính KG: dán 2 cột Mã | SL ⇒ SL là đơn vị gốc, giữ thập phân', () => {
    const [cols] = pasteGrid('RM001\t12,5')!
    expect(qtyFromEntryBase(pasteNum(cols[1]), pasteNum(cols[2]), KG)).toBe(12.5)
  })
})
