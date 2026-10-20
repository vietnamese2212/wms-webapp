// LOẠI KHO GHÉP 'FG01+PM01' — một bản ghi mang nhiều loại, "giao ≥1 loại là được" (CLAUDE.md). 20/10 (chạy thử một ngày Ba Vì):
// gợi ý booking của cổng đã tách chuỗi ghép nhưng phép NỐI cổng ↔ lệnh vẫn so nguyên chuỗi ⇒ xe chở lẫn không bao giờ gắn được lệnh,
// và cửa tạo đăng ký cổng 403 với bảo vệ được giao đủ cả FG01 lẫn PM01. Hai cửa nay đọc MỘT hàm.
import { describe, it, expect } from 'vitest'
import type { Request } from 'express'
import { singleTypeMatches, categoryAllowed, splitCategories } from '../../src/utils/categoryScope'

const req = (allowed: string[], scope = 'ASSIGNED') => ({ user: { warehouse_scope: scope, allowed_categories: allowed } } as unknown as Request)

describe('singleTypeMatches — loại ĐƠN của đăng ký cổng ↔ loại (có thể ghép) của lệnh', () => {
  it('lệnh chở lẫn khớp với TỪNG loại thành phần', () => {
    expect(singleTypeMatches('FG01', 'FG01+PM01')).toBe(true)
    expect(singleTypeMatches('PM01', 'FG01+PM01')).toBe(true)
    expect(singleTypeMatches('PM01', 'PM01 + FG01')).toBe(true)
  })
  it('hai bên cùng mang NGUYÊN chuỗi ghép (ghi qua API) vẫn khớp như luật cũ', () => {
    expect(singleTypeMatches('FG01+PM01', 'FG01+PM01')).toBe(true)
  })
  it('loại không có trên lệnh thì không khớp', () => {
    expect(singleTypeMatches('FG02', 'FG01+PM01')).toBe(false)
    expect(singleTypeMatches('FG02', 'FG01')).toBe(false)
  })
  it('thiếu một bên ⇒ không lọc', () => {
    expect(singleTypeMatches(null, 'FG01+PM01')).toBe(true)
    expect(singleTypeMatches('FG01', null)).toBe(true)
    expect(singleTypeMatches('', '')).toBe(true)
  })
})

describe('categoryAllowed — chuỗi ghép: giao ≥1 loại là được', () => {
  it('được giao FG01 + PM01 ⇒ thao tác được bản ghi FG01+PM01 (trước 20/10 cổng 403)', () => {
    expect(categoryAllowed(req(['FG01', 'PM01']), 'FG01+PM01')).toBe(true)
  })
  it('chỉ giao một trong các loại vẫn được', () => {
    expect(categoryAllowed(req(['PM01']), 'FG01+PM01')).toBe(true)
  })
  it('không giao loại nào trên bản ghi ⇒ không được', () => {
    expect(categoryAllowed(req(['FG02']), 'FG01+PM01')).toBe(false)
  })
  it('toàn quốc / không khai phạm vi ⇒ không chặn', () => {
    expect(categoryAllowed(req(['FG02'], 'NATIONAL'), 'FG01')).toBe(true)
    expect(categoryAllowed(req([]), 'FG01')).toBe(true)
  })
  it('splitCategories bỏ khoảng trắng và mẩu rỗng', () => {
    expect(splitCategories(' FG01 + +PM01 ')).toEqual(['FG01', 'PM01'])
  })
})
