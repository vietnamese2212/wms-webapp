import { describe, it, expect } from 'vitest'
import { batchLabelQr, parseBatchLabel, normalizeCycle, CYCLE_RE } from '../../src/utils/batchLabel'

describe('tem pallet của mẻ (MES 17/11)', () => {
  it('in rồi đọc lại ra đúng mẻ · pallet i/n · bản tem', () => {
    const qr = batchLabelQr('B300001BD62', 2, 4, 3)
    expect(qr).toBe('MEB;B300001BD62;2;4;3')
    expect(parseBatchLabel(qr)).toEqual({ batch_code: 'B300001BD62', pallet_no: 2, pallet_total: 4, label_ver: 3 })
  })
  it('mọi i/n trong 1..99 đều đọc lại được', () => {
    for (let n = 1; n <= 99; n += 7) for (let i = 1; i <= n; i += 3)
      expect(parseBatchLabel(batchLabelQr('B300001BD62', i, n, 1))).toMatchObject({ pallet_no: i, pallet_total: n })
  })
  it('chữ thường / khoảng trắng quanh vẫn nhận', () => {
    expect(parseBatchLabel('  meb; b300001bd62 ;1;4;1 ')?.batch_code).toBe('B300001BD62')
  })
  it('không phải tem mẻ ⇒ null (tem pallet nhập kho, tem hỏng, i > n, bản tem 0)', () => {
    for (const bad of ['', 'B300001BD62', '210000262_20251030_LOT1_25', '210000262;20251030;LOT;25;X', 'MEB;B300001BD62;5;4;1',
      'MEB;B300001BD62;0;4;1', 'MEB;B300001BD62;1;4;0', 'MEB;B300001BD62;1;100;1', 'MEB;;1;4;1', 'MEB;B300001BD62;1;4', 'XYZ;B300001BD62;1;4;1'])
      expect(parseBatchLabel(bad)).toBeNull()
  })
  it('chu kỳ: viết hoa, bỏ ký tự lạ; 1–6 chữ số', () => {
    expect(normalizeCycle(' 30 ')).toBe('30')
    expect(normalizeCycle('ck-2a')).toBe('CK2A')
    expect(CYCLE_RE.test(normalizeCycle('30'))).toBe(true)
    expect(CYCLE_RE.test(normalizeCycle(''))).toBe(false)
    expect(CYCLE_RE.test(normalizeCycle('1234567'))).toBe(false)
  })
})
