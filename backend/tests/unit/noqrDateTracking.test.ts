// 26/11 — "Hàng không tem theo NSX" ở kho QR (user: NVL không tem ở Chế biến Ba Vì không có NSX ⇒ không HSD, không FEFO).
// Hai mảnh thuần mà mọi cửa nhập / xuất hàng không tem dựa vào (qua services/noQrPool.ts):
//   • resolveNoQrDateTracking — ghép 2 tầng Kho + Loại kho (null ở loại = theo kho, false của loại tắt được kho đang bật)
//   • poolTracksDate          — tồn gộp có tách NSX không (kho QTY_DATE luôn; kho QR theo cờ; kho QTY / NONE bỏ qua cờ)
import { describe, it, expect } from 'vitest'
import { resolveNoQrDateTracking, WH_TYPE_CFG_COLS } from '../../src/utils/putaway'
import { poolTracksDate } from '../../src/lib/inventoryMode'

describe('resolveNoQrDateTracking — ghép tầng Kho + Loại kho', () => {
  it('cột có trong WH_TYPE_CFG_COLS (select / ghi / ghép tầng loại tự theo)', () => {
    expect((WH_TYPE_CFG_COLS as readonly string[]).includes('noqr_date_tracking')).toBe(true)
  })
  it('kho bật, loại không khai ⇒ bật (nguồn: kho)', () => {
    expect(resolveNoQrDateTracking({ noqr_date_tracking: true }, [{ type_code: 'RM01', noqr_date_tracking: null }], 'RM01'))
      .toEqual({ enabled: true, source: 'WAREHOUSE' })
  })
  it('kho bật, loại PK01 khai TẮT ⇒ tắt riêng loại đó (nguồn: loại); loại khác vẫn theo kho', () => {
    const rows = [{ type_code: 'PK01', noqr_date_tracking: false }]
    expect(resolveNoQrDateTracking({ noqr_date_tracking: true }, rows, 'PK01')).toEqual({ enabled: false, source: 'TYPE' })
    expect(resolveNoQrDateTracking({ noqr_date_tracking: true }, rows, 'RM01')).toEqual({ enabled: true, source: 'WAREHOUSE' })
  })
  it('kho tắt, loại khai BẬT ⇒ bật riêng loại đó', () => {
    expect(resolveNoQrDateTracking({ noqr_date_tracking: false }, [{ type_code: 'RM01', noqr_date_tracking: true }], 'RM01').enabled).toBe(true)
  })
  it('chuỗi loại ghép của chuyến (FG01+PM01) không khớp dòng loại nào ⇒ theo kho', () => {
    expect(resolveNoQrDateTracking({ noqr_date_tracking: false }, [{ type_code: 'FG01', noqr_date_tracking: true }], 'FG01+PM01').enabled).toBe(false)
  })
  it('kho chưa có cột (null) ⇒ tắt — hành vi cũ', () => {
    expect(resolveNoQrDateTracking(null, [], 'RM01').enabled).toBe(false)
  })
})

describe('poolTracksDate — tồn gộp có tách theo NSX không', () => {
  it('kho QTY_DATE luôn theo NSX, có cờ hay không', () => {
    expect(poolTracksDate('QTY_DATE', false)).toBe(true)
    expect(poolTracksDate('QTY_DATE', true)).toBe(true)
  })
  it('kho QR theo cờ', () => {
    expect(poolTracksDate('QR', true)).toBe(true)
    expect(poolTracksDate('QR', false)).toBe(false)
  })
  it('kho QTY / NONE / chưa rõ bỏ qua cờ (QTY muốn theo NSX thì đổi chế độ sang QTY_DATE)', () => {
    expect(poolTracksDate('QTY', true)).toBe(false)
    expect(poolTracksDate('NONE', true)).toBe(false)
    expect(poolTracksDate(null, true)).toBe(false)
  })
})
