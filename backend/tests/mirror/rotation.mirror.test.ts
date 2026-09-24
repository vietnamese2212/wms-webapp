// MIRROR luân chuyển: FE KHÔNG tính luật (BE trả khối `rotation`), nhưng FE giữ nhãn + DANH SÁCH LÝ DO
// vượt rào — mã lý do FE gửi lên phải nằm trong danh sách BE nhận (422 ROTATION_REASON_REQUIRED nếu lệch).
import { describe, it, expect } from 'vitest'
import * as BE from '../../src/utils/rotation'
import * as FE from '../../../frontend/src/utils/rotation'

describe('rotation BE ⇄ FE', () => {
  it('nguyên tắc, nhãn, mã lý do vượt rào khớp', () => {
    expect([...FE.ROTATION_PRINCIPLES]).toEqual([...BE.ROTATION_PRINCIPLES])
    expect(FE.ROTATION_LABEL).toEqual(BE.ROTATION_LABEL)
    expect(FE.ROTATION_REASONS.map(r => r.code)).toEqual(BE.ROTATION_REASONS.map(r => r.code))
    expect(FE.ROTATION_REASONS.map(r => r.label)).toEqual(BE.ROTATION_REASONS.map(r => r.label))
    for (const r of FE.ROTATION_REASONS) expect(BE.isRotationReason(r.code), r.code).toBe(true)
  })
})
