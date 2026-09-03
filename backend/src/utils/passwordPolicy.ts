// CHÍNH SÁCH MẬT KHẨU — MỘT nguồn luật (03/09). Mirror FE: frontend/src/utils/passwordPolicy.ts (sửa phải sửa cả hai).
// Trước đó chỉ có `length < 8` rải ở 2 controller + `< 6` ở 2 form FE ⇒ "12345678" hay "matkhau1" đặt được.
// Luật: ≥10 ký tự · có CHỮ và SỐ · không phải chuỗi lặp/liên tiếp · không nằm trong danh sách phổ biến ·
// không chứa tên đăng nhập / mã nhân viên. Ratchet `password_rule_hand_rolled` (gói 09) cấm tự viết `length <` nơi khác.
export const PASSWORD_MIN = 10
export const PASSWORD_HINT = `Tối thiểu ${PASSWORD_MIN} ký tự, có cả chữ và số, không trùng tên đăng nhập`

// Gốc từ (bỏ số/ký hiệu) bị cấm khi chiếm gần trọn mật khẩu — "password2026!" gốc = "password".
const COMMON_ROOTS = new Set([
  'password', 'passw0rd', 'matkhau', 'admin', 'administrator', 'qwerty', 'qwertyuiop', 'welcome', 'iloveyou',
  'letmein', 'abcdef', 'abcdefgh', 'abcdefghij', 'warehouse', 'khohang', 'wms', 'wmswebapp', 'lofjsc', 'supplychain',
  'changeme', 'default', 'user', 'guest', 'test', 'demo', 'login', 'system', 'vietnam', 'hanoi', 'saigon',
])

function isRunOrRepeat(s: string): boolean {
  const l = s.toLowerCase()
  if (/^(.)\1+$/.test(l)) return true                                  // aaaaaaaaaa
  if (/^(..)\1+$/.test(l) || /^(...)\1+$/.test(l)) return true          // abababab · 123123123
  let asc = true, desc = true
  for (let i = 1; i < l.length; i++) {
    const d = l.charCodeAt(i) - l.charCodeAt(i - 1)
    if (d !== 1) asc = false
    if (d !== -1) desc = false
  }
  return asc || desc                                                    // 1234567890 · abcdefghij · 0987654321
}

export function passwordError(pw: unknown, ctx: { email?: string | null; employee_code?: string | null } = {}): string | null {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) return `Mật khẩu phải có ít nhất ${PASSWORD_MIN} ký tự`
  if (pw.length > 128) return 'Mật khẩu quá dài (tối đa 128 ký tự)'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Mật khẩu phải có cả chữ và số'
  if (isRunOrRepeat(pw)) return 'Mật khẩu quá dễ đoán (chuỗi lặp hoặc liên tiếp)'
  const lower = pw.toLowerCase()
  const root = lower.replace(/[^a-z]/g, '')
  if (COMMON_ROOTS.has(lower) || (root.length >= 4 && COMMON_ROOTS.has(root) && root.length >= pw.length - 5))
    return 'Mật khẩu nằm trong danh sách quá phổ biến'
  const local = (ctx.email ?? '').trim().toLowerCase().split('@')[0]
  if (local.length >= 4 && lower.includes(local)) return 'Mật khẩu không được chứa tên đăng nhập'
  const code = (ctx.employee_code ?? '').trim().toLowerCase()
  if (code.length >= 4 && lower.includes(code)) return 'Mật khẩu không được chứa mã nhân viên'
  return null
}
