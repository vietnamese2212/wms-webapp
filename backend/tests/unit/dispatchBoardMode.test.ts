// Bàn ghép xe ở chế độ SỬA hay XEM (23/10, user: "khi xem bàn điều lại không thấy các đơn chờ"): chế độ Sửa nhớ trong bộ lọc theo người —
// phiên sửa đã kết thúc ở nơi khác mà bàn còn nhớ ⇒ khung chờ chỉ hiện đơn đã nạp (0 OD), 95 đơn Chờ điều biến mất. Kế hoạch đã xác nhận
// chỉ ở Sửa khi còn bản sửa đang mở.
import { describe, it, expect } from 'vitest'
import { boardEditing } from '../../../frontend/src/components/tms/dispatchEdit'

const P = { warehouse_id: 'W', plan_date: '2026-10-02' }
const DAY = 'W|2026-10-02'
const edit = { started_at: '2026-10-23T08:00:00Z', started_by: 'A' }

describe('boardEditing', () => {
  it('kế hoạch còn mở luôn sửa; đã xoá / không có kế hoạch thì không', () => {
    expect(boardEditing({ ...P, status: 'DRAFT' }, null)).toBe(true)
    expect(boardEditing({ ...P, status: 'TENDERED' }, null)).toBe(true)
    expect(boardEditing({ ...P, status: 'DISCARDED', edit }, DAY)).toBe(false)
    expect(boardEditing(null, DAY)).toBe(false)
  })
  it('đã xác nhận: chỉ sửa khi người này bấm Sửa ĐÚNG kho × ngày VÀ còn bản sửa đang mở', () => {
    expect(boardEditing({ ...P, status: 'CONFIRMED', edit }, DAY)).toBe(true)
    expect(boardEditing({ ...P, status: 'CONFIRMED', edit: null }, DAY)).toBe(false)   // phiên sửa đã kết thúc ở nơi khác — lỗi 23/10
    expect(boardEditing({ ...P, status: 'CONFIRMED' }, DAY)).toBe(false)
    expect(boardEditing({ ...P, status: 'CONFIRMED', edit }, null)).toBe(false)
    expect(boardEditing({ ...P, status: 'CONFIRMED', edit }, 'W2|2026-10-02')).toBe(false)
  })
})
