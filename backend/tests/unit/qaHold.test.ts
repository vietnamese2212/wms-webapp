// "QA GIỮ" — dấu `OK` nghĩa là ĐÃ DUYỆT, KHÔNG phải đang giữ.
//
// Bug thật 13/09/2026: `isPickEligible` coi MỌI giá trị qa_status_id là "đang giữ", trong khi cửa
// quét xuất chỉ chặn khi `code !== 'OK'` ⇒ cùng một pallet: quét thì xuất được mà bộ sinh việc và
// màn chốt %Date bảo "hết hàng" (đo Ba Vì: 8.760 pallet bị đếm là kẹt trong khi chỉ 5 bị giữ thật;
// 83 mã không chốt được bất kỳ mức %Date nào). Tầng lưới rẻ nhất cho lớp này là test thuần vì luật
// nằm gọn trong một hàm không chạm DB.
import { describe, it, expect } from 'vitest'
import { isPickEligible, availableOf } from '../../src/utils/rotation'

const HOLD = new Set(['id-X', 'id-XCQ', 'id-X7'])   // đúng 3 mã giữ của danh mục QAStatus
const OK_ID = 'id-OK'
const pallet = (over: Record<string, unknown> = {}) => ({
  cartons_remaining: 100, cartons_reserved: 0, qa_status_id: null, ...over,
})

describe('QA giữ hàng', () => {
  it('pallet mang dấu OK vẫn LẤY ĐƯỢC (đã duyệt), y như pallet không gắn QA', () => {
    expect(isPickEligible(pallet({ qa_status_id: OK_ID }), HOLD)).toBe(true)
    expect(isPickEligible(pallet({ qa_status_id: null }), HOLD)).toBe(true)
  })

  it('pallet mang dấu X / X cảm quan / X 7 ngày thì KHÔNG lấy được', () => {
    for (const id of HOLD) expect(isPickEligible(pallet({ qa_status_id: id }), HOLD), id).toBe(false)
  })

  it('hết hàng thì không lấy được dù QA đã duyệt', () => {
    expect(isPickEligible(pallet({ qa_status_id: OK_ID, cartons_remaining: 0 }), HOLD)).toBe(false)
    expect(isPickEligible(pallet({ qa_status_id: OK_ID, cartons_remaining: 50, cartons_reserved: 50 }), HOLD)).toBe(false)
  })

  it('số lấy được trừ phần đang giữ cho nhặt lẻ', () => {
    expect(availableOf(pallet({ cartons_remaining: 100, cartons_reserved: 30 }))).toBe(70)
    expect(availableOf(pallet({ cartons_remaining: 10, cartons_reserved: 99 }))).toBe(0)
  })

  it('danh mục QA rỗng ⇒ không coi ai là bị giữ (đừng khoá kho khi chưa khai danh mục)', () => {
    expect(isPickEligible(pallet({ qa_status_id: 'id-la' }), new Set())).toBe(true)
  })
})
