// MIRROR quy nhãn đơn vị / mã / ĐVVT ZSD02: BE (cửa nạp) ⇄ FE (badge, bộ lọc, mẫu upload).
import { describe, it, expect } from 'vitest'
import * as BE from '../../src/utils/sapUnits'
import * as FE from '../../../frontend/src/utils/sapUnits'
import { rng, N, SEED } from '../helpers/rng'

const LABELS = ['Thùng', 'THÙNG', 'thung', ' Thùng ', 'Hộp', 'HỘP', 'Cái', 'cái', 'kg', 'KG', 'CAR', 'HOP', 'EA', 'BT', 'BAG', 'Chai', 'Bao', 'Túi', 'Bộ', 'Cuộn', 'PCE', '', null, undefined, 'Lít', 'XYZ', 'Thùng lớn', 12]

describe(`sapUnits BE ⇄ FE (seed ${SEED})`, () => {
  it('bảng nhãn cố định — cả 2 bản cùng đáp án', () => {
    for (const l of LABELS) expect(FE.normSalesUnit(l), String(l)).toBe(BE.normSalesUnit(l))
    expect(BE.normSalesUnit('Thùng')).toBe('CAR')
    expect(BE.normSalesUnit('Hộp')).toBe('HOP')
    expect(BE.normSalesUnit('Cái')).toBe('EA')
    expect(BE.normSalesUnit('kg')).toBe('KG')
    expect(BE.normSalesUnit('Thùng lớn')).toBeNull()   // nhãn lạ → null → cửa nạp CHẶN kèm bảng
  })
  it('chuỗi ngẫu nhiên có dấu / khoảng trắng — khớp từng hàm', () => {
    const r = rng()
    const alpha = 'aAbBcCđĐêÊôÔàÁ /-_0123456789 '
    for (let i = 0; i < N; i++) {
      const s = r.bool(0.1) ? null : r.str(alpha, 0, 14)
      expect(FE.normSapText(s), JSON.stringify(s)).toBe(BE.normSapText(s))
      expect(FE.normSalesUnit(s), JSON.stringify(s)).toBe(BE.normSalesUnit(s))
      expect(FE.normBaseUnit(s), JSON.stringify(s)).toBe(BE.normBaseUnit(s))
      expect(FE.sapCodeOf(s), JSON.stringify(s)).toBe(BE.sapCodeOf(s))
      expect(FE.normDvvt(s), JSON.stringify(s)).toBe(BE.normDvvt(s))
      expect(FE.normDispatchStatus(s), JSON.stringify(s)).toBe(BE.normDispatchStatus(s))
      const g = r.bool(0.2) ? r.str('0123456789,.', 0, 9) : r.int(-5, 500_000) + r.next()
      expect(FE.gramsToKg(g), JSON.stringify(g)).toBe(BE.gramsToKg(g))
    }
  })
  it('mã SAP + ĐVVT + trạng thái điều phối — ca thật từ file mẫu', () => {
    expect(BE.sapCodeOf('ZOR1-SO Standard')).toBe('ZOR1')
    expect(BE.sapCodeOf('F-Purchase Order')).toBe('F')
    expect(BE.sapCodeOf('ZTA2-IC Pallet')).toBe('ZTA2')
    expect(BE.normDvvt('Đông Á')).toBe(BE.normDvvt('ĐÔNG Á'))
    expect(BE.normDvvt('Hải An')).toBe(BE.normDvvt('HAI AN'))
    expect(BE.normDispatchStatus('Đã điều phối')).toBe('ASSIGNED')
    expect(BE.normDispatchStatus('Chưa điều phối')).toBe('UNASSIGNED')
    expect(BE.gramsToKg(298199.52)).toBe(298.2)   // 60 thùng 510000219 → 4,97 kg/thùng
  })
})
