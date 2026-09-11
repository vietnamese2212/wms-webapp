// Parser tem pallet 2 định dạng — luật "QR quét sao lưu vậy" + bóc trường đúng vị trí.
import { describe, it, expect } from 'vitest'
import { parseInboundQR, normalizeQR } from '../../src/utils/qrParser'

describe('parseInboundQR', () => {
  it('V1 `_`: bóc đủ 6 đoạn, ngày ddmmyy theo UTC', () => {
    const p = parseInboundQR('070526_510000127_C05_M1_001_B')
    expect(p.is_valid).toBe(true)
    expect(p.format).toBe('v1')
    expect(p.material_code).toBe('510000127')
    expect(p.cycle).toBe('C05')
    expect(p.machine_code).toBe('M1')
    expect(p.pallet_sequence_no).toBe(1)
    expect(p.manufacturer_code).toBe('B')
    expect(p.production_date?.toISOString().slice(0, 10)).toBe('2026-05-07')
    expect(p.batch).toBeNull()
    expect(p.expiry_date).toBeNull()
  })

  it('V2 `;`: giữ NGUYÊN đệm space trong pallet_code, trim khi bóc trường, QA/mã lô/HSD/Máy/STT', () => {
    const raw = '50033;      1;TA260705A018;05/07/2026;05/03/2027;      1;05:26'
    const p = parseInboundQR(raw)
    expect(p.is_valid).toBe(true)
    expect(p.format).toBe('v2')
    expect(p.pallet_code).toBe(raw)
    expect(p.material_code).toBe('50033')
    expect(p.qa_ok).toBe(true)
    expect(p.batch).toBe('TA260705A018')
    expect(p.machine_code).toBe('A')
    expect(p.pallet_sequence_no).toBe(18)
    expect(p.production_date?.toISOString().slice(0, 10)).toBe('2026-07-05')
    expect(p.expiry_date?.toISOString().slice(0, 10)).toBe('2027-03-05')
    expect(p.production_time).toBe('1:05:26')
    expect(parseInboundQR(raw.replace(';      1;TA', ';      0;TA')).qa_ok).toBe(false)
  })

  it('ngày không có thật bị loại ở cả hai định dạng (không roll-over)', () => {
    expect(parseInboundQR('300226_510000127_C05_M1_001_B').is_valid).toBe(false)
    expect(parseInboundQR('50033;1;TA260705A018;31/02/2026;05/03/2027').is_valid).toBe(false)
    expect(parseInboundQR('50033;1;TA260705A018;05/07/2026;05/13/2027').is_valid).toBe(false)
  })

  it('thiếu đoạn / thiếu mã hàng / thiếu mã lô → không hợp lệ kèm lý do', () => {
    expect(parseInboundQR('070526_510000127_C05').is_valid).toBe(false)
    expect(parseInboundQR('50033;1;TA260705A018;05/07/2026').is_valid).toBe(false)
    expect(parseInboundQR(';1;TA260705A018;05/07/2026;05/03/2027').error).toMatch(/mã hàng/)
    expect(parseInboundQR('50033;1;;05/07/2026;05/03/2027').error).toMatch(/mã lô/)
  })

  it('normalizeQR chỉ trim NGOÀI', () => {
    expect(normalizeQR('  50033;      1;X;05/07/2026;05/03/2027\r\n')).toBe('50033;      1;X;05/07/2026;05/03/2027')
  })
})
