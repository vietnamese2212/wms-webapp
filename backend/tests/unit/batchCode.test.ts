// Mã lô bán thành phẩm (MES 14/11) — gợi ý theo khuôn tem V2: tiền tố + yymmdd + máy + STT 3 chữ số.
import { describe, it, expect } from 'vitest'
import { normalizeBatchCode, batchCodeStem, nextBatchCode, BATCH_CODE_RE } from '../../src/utils/batchCode'

describe('normalizeBatchCode', () => {
  it.each<[string, string]>([
    [' ta 260705 a018 ', 'TA260705A018'],
    ['lô#1/2', 'L12'],                  // ký tự lạ bị bỏ (Ô có dấu tiếng Việt không qua được CHECK của bảng)
    ['bn-01.a_2', 'BN-01.A_2'],
  ])('%j → %j', (raw, out) => expect(normalizeBatchCode(raw)).toBe(out))
})

describe('batchCodeStem', () => {
  it('tiền tố + yymmdd + máy, bỏ dấu nối', () => {
    expect(batchCodeStem('TA', '2026-07-05', 'A')).toBe('TA260705A')
    expect(batchCodeStem('ZZ-RM.1', '2026-11-14', 'm-1')).toBe('ZZRM1261114M1')
  })
  it('không có máy thì chỉ tiền tố + ngày', () => {
    expect(batchCodeStem('SN', '2026-01-09', null)).toBe('SN260109')
  })
})

describe('nextBatchCode', () => {
  it('mã đầu tiên = 001', () => expect(nextBatchCode('TA260705A', [])).toBe('TA260705A001'))
  it('lớn hơn mã lớn nhất cùng gốc, không lấp chỗ trống', () => {
    expect(nextBatchCode('TA260705A', ['TA260705A001', 'TA260705A007', 'TA260705A003'])).toBe('TA260705A008')
  })
  it('bỏ qua mã khác gốc và mã sửa tay không cùng khuôn', () => {
    expect(nextBatchCode('TA260705A', ['TA260705B009', 'TA260705A-X', 'TA260705A12', null])).toBe('TA260705A001')
  })
  it('vượt 999 vẫn tăng', () => expect(nextBatchCode('X', ['X999'])).toBe('X1000'))
  it('mã gợi ý luôn qua CHECK của bảng', () => {
    const c = nextBatchCode(batchCodeStem('Sữa nền 01', '2026-11-14', 'Bồn#2'), [])
    expect(BATCH_CODE_RE.test(c)).toBe(true)
  })
})
