// AI ĐANG LÀM — lớp lỗi "ai làm lấy từ THÂN REQUEST" (C31) đã nổ 3 lần trong 2 ngày.
// Luật: client gửi UUID thì tin client; KHÔNG gửi (hoặc gửi rác) thì rơi về NGƯỜI ĐĂNG NHẬP.
// Ca quan trọng nhất là ca "client không gửi gì" — đó là mọi nút gọi API không kèm thân request,
// và chính nó làm 0/22.986 phiếu nhập đã hoàn thành không có tên người.
import { describe, it, expect } from 'vitest'
import type { Request } from 'express'
import { actorUuid, resolveActorId, resolveActorName, isUuid } from '../../src/utils/actor'

const UID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const OTHER = 'b0f5ce45-2e08-4676-aa07-1dbb8c492e0c'
const req = (user?: { sub?: unknown; name?: string }) => ({ user } as unknown as Request)

describe('actor — người thực hiện cho cột vết', () => {
  it('KHÔNG gửi gì ⇒ rơi về người đăng nhập (ca làm hỏng ProductionImport.updated_by)', () => {
    expect(resolveActorId(req({ sub: UID }), undefined)).toBe(UID)
    expect(resolveActorId(req({ sub: UID }), null)).toBe(UID)
    expect(resolveActorId(req({ sub: UID }), '')).toBe(UID)
  })

  it('client gửi UUID ⇒ TIN client (màn cho ghi hộ người khác)', () => {
    expect(resolveActorId(req({ sub: UID }), OTHER)).toBe(OTHER)
  })

  it('client gửi thứ KHÔNG phải UUID ⇒ bỏ qua, rơi về người đăng nhập (cột có khoá ngoại Employee)', () => {
    for (const bad of ['Nguyễn Văn A', 'NV001', 'undefined', 12345, {}, [], true])
      expect(resolveActorId(req({ sub: UID }), bad)).toBe(UID)
  })

  it('token không mang id hợp lệ ⇒ null, KHÔNG ném (vết thiếu còn hơn 23503 làm hỏng lượt ghi)', () => {
    expect(actorUuid(req({ sub: 'jt-admin' }))).toBeNull()
    expect(actorUuid(req({}))).toBeNull()
    expect(actorUuid(req(undefined))).toBeNull()
    expect(resolveActorId(req(undefined), 'không-phải-uuid')).toBeNull()
  })

  it('tên: client gửi chuỗi có nội dung thì dùng, rỗng/thiếu thì lấy tên người đăng nhập', () => {
    expect(resolveActorName(req({ name: 'Admin' }), 'Thủ kho B')).toBe('Thủ kho B')
    expect(resolveActorName(req({ name: 'Admin' }), '   ')).toBe('Admin')
    expect(resolveActorName(req({ name: 'Admin' }), undefined)).toBe('Admin')
    expect(resolveActorName(req({}), undefined)).toBeNull()
  })

  it('isUuid chỉ nhận đúng dạng uuid (chống ghi rác vào cột khoá ngoại)', () => {
    expect(isUuid(UID)).toBe(true)
    expect(isUuid(UID.toUpperCase())).toBe(true)
    expect(isUuid(UID.slice(0, -1))).toBe(false)
    expect(isUuid(`${UID} `)).toBe(false)
    expect(isUuid('jt-tk-tp')).toBe(false)
  })
})
