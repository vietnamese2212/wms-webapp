// ĐVT in bằng MÃ của danh mục ở các màn Sản xuất (MES) — user 17/11: "hạn chế dùng văn viết, và dùng đơn vị tính của app".
// Số trong ô bảng là CON SỐ TRẦN (ĐVT in một lần ở cột / nhãn); mã có quy cách thùng giữ "N thùng + M hộp" (chuẩn chung qtyLabel).
import { describe, it, expect } from 'vitest'
import { unitCode, matUnitCode, qtyNum, qtyCode } from '../../../frontend/src/utils/unitCode'
import { qtyLabel } from '../../../frontend/src/utils/qtyUnits'

const KG = { base_unit: 'KG' }
const BAG = { base_unit: 'bag' }
const CASE = { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48 }

describe('unitCode — mã ĐVT để in', () => {
  it('chuẩn hoá chữ hoa, bỏ khoảng trắng; trống ⇒ ""', () => {
    expect(unitCode(' kg ')).toBe('KG')
    expect(unitCode('L')).toBe('L')
    expect(unitCode(null)).toBe('')
    expect(unitCode(undefined)).toBe('')
  })
  it('cột ĐVT: mã thường ⇒ mã gốc; mã có thùng ⇒ "gốc/thùng" như trang Mã hàng', () => {
    expect(matUnitCode(KG)).toBe('KG')
    expect(matUnitCode(BAG)).toBe('BAG')
    expect(matUnitCode(CASE)).toBe('HOP/CAR')
    expect(matUnitCode({ base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 0 })).toBe('HOP')   // hệ số 0 = không quy cách thùng
  })
})

describe('qtyNum / qtyCode — không còn chữ "kilogram" sau mỗi con số', () => {
  it('mã không quy cách thùng: số trần định dạng vi-VN, tối đa 3 số lẻ', () => {
    expect(qtyNum(374.1666666, KG)).toBe('374,167')
    expect(qtyNum(1200, KG)).toBe('1.200')
    expect(qtyNum(0, KG)).toBe('0')
    expect(qtyCode(487.5, KG)).toBe('487,5 KG')
    expect(qtyCode(2, BAG)).toBe('2 BAG')
  })
  it('mã có quy cách thùng: giữ đúng chuẩn hiển thị chung "N thùng + M hộp"', () => {
    expect(qtyNum(100, CASE)).toBe(qtyLabel(100, CASE))
    expect(qtyCode(100, CASE)).toBe(qtyLabel(100, CASE))
  })
  it('không số ⇒ "—"; thiếu ĐVT ⇒ chỉ con số', () => {
    expect(qtyNum(NaN, KG)).toBe('—')
    expect(qtyCode(Infinity, KG)).toBe('—')
    expect(qtyCode(5, {})).toBe('5')
    expect(qtyCode(5, null)).toBe('5')
  })
  it('không in nhãn dài của danh mục', () => {
    for (const s of [qtyNum(50, KG), qtyCode(50, KG), matUnitCode(KG)]) expect(s.toLowerCase()).not.toContain('kilogram')
  })
})
