// PHẠM VI ĐVVT THEO CÔNG TY — 20/10 C3 lặp hai lần trong một ngày (vehicleSlotController rồi orderController cho tài khoản `ncc_id`
// "toàn quyền"). Luật nay là MỘT hàm (utils/carrierScope) cho mọi cửa chạm lệnh vận chuyển; test này giữ luật đó.
import { describe, it, expect } from 'vitest'
import { carrierMayTouch } from '../../src/utils/carrierScope'

const ME = 'ncc-3s', OTHER = 'ncc-hai-an'

describe('carrierMayTouch — ĐVVT chỉ chạm lệnh của CHÍNH công ty mình', () => {
  it('lệnh VC của công ty mình ⇒ được; của hãng khác ⇒ không', () => {
    expect(carrierMayTouch(ME, { ncc_id: ME, source_type: 'NCC' })).toBe(true)
    expect(carrierMayTouch(ME, { ncc_id: OTHER, source_type: 'NCC' })).toBe(false)
  })
  it('lệnh CHUYỂN KHO: đã kế thừa ĐVVT thì theo công ty; lệnh cũ chưa gán hãng vẫn khai được giờ đến / SĐT', () => {
    expect(carrierMayTouch(ME, { ncc_id: ME, source_type: 'TRANSFER' })).toBe(true)
    expect(carrierMayTouch(ME, { ncc_id: OTHER, source_type: 'TRANSFER' })).toBe(false)
    expect(carrierMayTouch(ME, { ncc_id: null, source_type: 'TRANSFER' })).toBe(true)
  })
  it('lệnh VC CHƯA gán ĐVVT không phải của ai ⇒ ĐVVT không chạm', () => {
    expect(carrierMayTouch(ME, { ncc_id: null, source_type: 'NCC' })).toBe(false)
    expect(carrierMayTouch(ME, { ncc_id: null, source_type: null })).toBe(false)
  })
})
