// MIRROR tem pallet: FE `isValidTem` (khung xanh/đỏ scanner, ghi carton_scans) ⇄ BE `parseInboundQR`.
// Fuzz 26/07 từng lộ 7.776 ca FE loại nhưng BE nhận = quét tem thùng bị loại oan, MẤT dữ liệu truy vết.
// Phép kiểm này biến "phải khớp" từ ghi chú thành máy: FE.isValidTem(raw) === BE.parse(raw).is_valid.
import { describe, it, expect } from 'vitest'
import * as BE from '../../src/utils/qrParser'
import * as FE from '../../../frontend/src/utils/qr'
import { rng, N, SEED, type Rng } from '../helpers/rng'

const pad = (r: Rng, s: string) => (r.bool(0.5) ? ' '.repeat(r.int(0, 6)) : '') + s + (r.bool(0.2) ? ' '.repeat(r.int(1, 3)) : '')
const dd = (r: Rng) => r.pick(['01', '05', '15', '28', '29', '30', '31', '00', '32', '99', '7', 'ab'])
const mm = (r: Rng) => r.pick(['01', '02', '04', '06', '07', '12', '00', '13', 'x1'])
const yy = (r: Rng) => r.pick(['24', '25', '26', '27', '99', '00'])
const dmy = (r: Rng) => r.bool(0.85) ? `${dd(r)}/${mm(r)}/20${yy(r)}` : r.pick(['', '2026-07-05', '05/07/26', '5/7/2026', '31/02/2026', 'rác'])
const lot = (r: Rng) => r.pick([
  'TA260705A018', 'ta260705a018', '1A260705N001', 'TA260705A018.1', 'TA261345A018', 'TA260732B999',
  'XX', '', 'LOT-KHÔNG-CHUẨN', '12345678901234',
])

function v1(r: Rng): string {
  const parts = [`${dd(r)}${mm(r)}${yy(r)}`, r.pick(['510000127', '50033', '', 'ABC']), r.pick(['C05', '55', '']),
    r.pick(['M1', 'A', '10008728', '']), r.pick(['001', '1', '', 'x']), r.pick(['B', 'D', ''])]
  const n = r.bool(0.8) ? 6 : r.int(1, 8)
  const arr = parts.slice(0, Math.min(6, n))
  while (arr.length < n) arr.push(r.pick(['x', '1', '']))
  return arr.join('_')
}
function v2(r: Rng): string {
  const parts = [r.pick(['50033', '510000127', '', 'AB-1']), r.pick(['1', '0', 'X', '']), lot(r), dmy(r), dmy(r), r.pick(['1', '2', '10', '']), r.pick(['05:26', '23:59', '', 'ab'])]
  const n = r.bool(0.7) ? 7 : r.int(1, 9)
  const arr = parts.slice(0, Math.min(7, n)).map(p => pad(r, p))
  while (arr.length < n) arr.push(pad(r, r.pick(['1', ''])))
  return arr.join(';')
}
function garbage(r: Rng): string {
  return r.str('abcXYZ019 _;/.-\n\t', 0, 30)
}

describe(`qrParser BE ⇄ FE (seed ${SEED})`, () => {
  it('isValidTem ⇔ parseInboundQR.is_valid · normalizeQR · materialCodeOf khớp', () => {
    const r = rng()
    for (let i = 0; i < N; i++) {
      const kind = r.int(0, 9)
      let raw = kind < 4 ? v1(r) : kind < 8 ? v2(r) : garbage(r)
      if (r.bool(0.2)) raw = raw + r.pick(['\n', '\r\n', ' ', '\t'])     // súng PDA thêm CR/LF
      if (r.bool(0.1)) raw = ' ' + raw
      const be = BE.parseInboundQR(raw)
      const ctx = JSON.stringify(raw)
      expect(FE.normalizeQR(raw), ctx).toBe(BE.normalizeQR(raw))
      expect(FE.isValidTem(raw), `${ctx} → BE ${be.is_valid ? 'NHẬN' : `LOẠI (${be.error})`}`).toBe(be.is_valid)
      if (be.is_valid) expect(FE.materialCodeOf(raw), ctx).toBe(be.material_code)
    }
  })

  it('tem thật 2 định dạng: cả hai bên NHẬN, mã hàng khớp, pallet_code giữ nguyên đệm space', () => {
    const V1 = '070526_510000127_C05_M1_001_B'
    const V2 = '50033;      1;TA260705A018;05/07/2026;05/03/2027;      1;05:26'
    for (const t of [V1, V2]) {
      const be = BE.parseInboundQR(t)
      expect(be.is_valid, t).toBe(true)
      expect(FE.isValidTem(t), t).toBe(true)
      expect(FE.materialCodeOf(t), t).toBe(be.material_code)
      expect(be.pallet_code, t).toBe(t)
    }
  })
})
