// MIRROR biển số: BE `normalizePlate` (cửa ghi mọi đường: API/upload/tích hợp) ⇄ FE `normalizeLicensePlate` (ô nhập).
// Lệch = biển gõ ở form khớp phiếu cân, nhưng biển từ upload không khớp — chuyến "không tìm thấy phiếu cân".
import { describe, it, expect } from 'vitest'
import * as BE from '../../src/utils/plate'
import { normalizeLicensePlate, isValidLicensePlate } from '../../../frontend/src/utils/formatters'
import { rng, N, SEED } from '../helpers/rng'

// Bảng chữ THẬT của biển số + rác người dùng gõ (không dùng ß/ﬁ — toUpperCase nở thành 2 ký tự, không có trên biển).
const ALPHABET = 'ABCDEFGHKLMNPSTUVXYZabcdefghklmnpstuvxyz0123456789 -._/đĐăĂơƠ\t'

describe(`plate BE ⇄ FE (seed ${SEED})`, () => {
  it('normalize khớp (BE null ≡ FE rỗng) và kiểm dạng chuẩn khớp trên chuỗi không rỗng', () => {
    const r = rng()
    for (let i = 0; i < N; i++) {
      const s = r.str(ALPHABET, 0, 14)
      expect(normalizeLicensePlate(s), JSON.stringify(s)).toBe(BE.normalizePlate(s) ?? '')
      const n = normalizeLicensePlate(s)
      if (n) expect(isValidLicensePlate(n), n).toBe(BE.isPlateNormalized(n))
    }
    for (const s of ['29e-09404', '66H 07144', '29K.12948', '', '  ', '51C-123.45'])
      expect(normalizeLicensePlate(s), s).toBe(BE.normalizePlate(s) ?? '')
  })
})
