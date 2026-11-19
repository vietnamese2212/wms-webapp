// Đổi mật khẩu ⇒ token phát trước đó hết hiệu lực ở /auth/me (19/11). So theo GIÂY vì iat của JWT là giây.
import { describe, it, expect } from 'vitest'
import { tokenBeforePasswordChange } from '../../src/utils/sessionAge'

const at = '2026-11-19T03:36:27.745Z'
const sec = Math.floor(Date.parse(at) / 1000)
describe('tokenBeforePasswordChange', () => {
  it('token phát trước lần đổi ⇒ hết hiệu lực', () => {
    expect(tokenBeforePasswordChange(sec - 3600, at)).toBe(true)
    expect(tokenBeforePasswordChange(sec - 1, at)).toBe(true)
  })
  it('token phát cùng giây hoặc sau lần đổi ⇒ còn hiệu lực (token mới của người vừa tự đổi)', () => {
    expect(tokenBeforePasswordChange(sec, at)).toBe(false)
    expect(tokenBeforePasswordChange(sec + 5, at)).toBe(false)
  })
  it('chưa từng đổi / mốc hỏng / token không có iat ⇒ không chặn', () => {
    expect(tokenBeforePasswordChange(sec, null)).toBe(false)
    expect(tokenBeforePasswordChange(sec, 'abc')).toBe(false)
    expect(tokenBeforePasswordChange(undefined, at)).toBe(false)
  })
  it('mốc timestamptz có offset +00:00 (PostgREST) đọc đúng UTC', () => {
    expect(tokenBeforePasswordChange(sec - 1, '2026-11-19T03:36:27.745483+00:00')).toBe(true)
    expect(tokenBeforePasswordChange(sec, '2026-11-19T03:36:27.745483+00:00')).toBe(false)
  })
})
