// Việc NỀN hỏng vì QUÁ TẢI hay vì ĐUA DỮ LIỆU thì app vẫn chạy — ghi 503 để digest không dựng cờ đỏ
// và không gửi email báo hỏng oan. Chỉ hỏng THẬT mới 500 (lớp C25; ca đua đo được 18/09:
// `planGdoTasks` ngã với `wms_tasks_item_id_fkey` đúng lúc dòng hàng bị dựng lại).
import { describe, it, expect } from 'vitest'
import { classifyBackgroundFailure } from '../../src/utils/response'

describe('classifyBackgroundFailure', () => {
  it('quá tải (statement timeout) → 503 kèm _OVERLOAD', () => {
    const e = { code: '57014', message: 'canceling statement due to statement timeout' }
    const r = classifyBackgroundFailure(e, 'PLAN_FAILED')
    expect(r.status).toBe(503)
    expect(r.code).toBe('PLAN_FAILED_OVERLOAD')
  })

  it('đua dữ liệu — khoá ngoại 23503 → 503 kèm _RACE', () => {
    const e = { code: '23503', message: 'insert or update on table "wms_tasks" violates foreign key constraint "wms_tasks_item_id_fkey"' }
    const r = classifyBackgroundFailure(e, 'PLAN_FAILED')
    expect(r.status).toBe(503)
    expect(r.code).toBe('PLAN_FAILED_RACE')
  })

  it('đua dữ liệu — trùng khoá 23505 → 503 kèm _RACE', () => {
    const r = classifyBackgroundFailure({ code: '23505', message: 'duplicate key value violates unique constraint' }, 'FILL_FAILED')
    expect(r.status).toBe(503)
    expect(r.code).toBe('FILL_FAILED_RACE')
  })

  it('nhận ra ĐUA cả khi lỗi chỉ có CÂU CHỮ, không có mã (lỗi bọc qua nhiều tầng)', () => {
    const r = classifyBackgroundFailure(new Error('… violates foreign key constraint "x_fkey"'), 'PLAN_FAILED')
    expect(r.status).toBe(503)
    expect(r.code).toBe('PLAN_FAILED_RACE')
  })

  it('HỎNG THẬT vẫn 500 — cổng không được nới', () => {
    const r = classifyBackgroundFailure(new TypeError("Cannot read properties of undefined (reading 'x')"), 'PLAN_FAILED')
    expect(r.status).toBe(500)
    expect(r.code).toBe('PLAN_FAILED')
  })

  it('lỗi rỗng / null → 500 (không đoán bừa là lành tính)', () => {
    expect(classifyBackgroundFailure(null, 'X').status).toBe(500)
    expect(classifyBackgroundFailure(undefined, 'X').status).toBe(500)
  })
})
