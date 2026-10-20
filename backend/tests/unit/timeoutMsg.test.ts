// CÂU 503 QUÁ HẠN TRUY VẤN theo ĐÚNG cửa — 20/10 (chạy thử một ngày Ba Vì): staging bị bóp IO, Hộp việc lái xe nâng · bảng việc ·
// Giám sát vận hành trả 503 với câu "thu hẹp KHOẢNG NGÀY hoặc chọn 1 Kho" trong khi các màn đó KHÔNG có ô ngày nào để thu hẹp.
// Chỉ khuyên thu hẹp khi request thật sự mang bộ lọc ngày; còn lại là câu "quá tải, chờ vài giây rồi thử lại".
import { describe, it, expect } from 'vitest'
import { timeoutMsgFor, QUERY_TIMEOUT_MSG, QUERY_BUSY_MSG } from '../../src/utils/pagination'

describe('timeoutMsgFor — chỉ khuyên "thu hẹp khoảng ngày" khi request có bộ lọc ngày', () => {
  it('màn không có ô ngày (Hộp việc · Giám sát vận hành · quét) ⇒ câu quá tải', () => {
    expect(timeoutMsgFor({ warehouse_id: 'w1', mine: '1' })).toBe(QUERY_BUSY_MSG)
    expect(timeoutMsgFor({}, { qr_code: 'X', qty_semantics: 'base' })).toBe(QUERY_BUSY_MSG)
    expect(timeoutMsgFor(undefined, null)).toBe(QUERY_BUSY_MSG)
  })
  it('danh sách lọc theo khoảng ngày ⇒ giữ câu thu hẹp', () => {
    expect(timeoutMsgFor({ date_from: '2026-10-01', date_to: '2026-10-20' })).toBe(QUERY_TIMEOUT_MSG)
    expect(timeoutMsgFor({ date: '2026-10-20' })).toBe(QUERY_TIMEOUT_MSG)
    expect(timeoutMsgFor({ plan_date: '2026-10-20' })).toBe(QUERY_TIMEOUT_MSG)
    expect(timeoutMsgFor({ from: '2026-10-01', to: '2026-10-20' })).toBe(QUERY_TIMEOUT_MSG)
    expect(timeoutMsgFor({}, { month: '2026-10' })).toBe(QUERY_TIMEOUT_MSG)
  })
  it('chỉ khớp NGUYÊN mảnh tên (tách theo _) — "total" · "token" · "dates_count" không phải bộ lọc ngày', () => {
    expect(timeoutMsgFor({ total: '1', token: 'x', updated: '1', dates_count: '2' })).toBe(QUERY_BUSY_MSG)
  })
})
