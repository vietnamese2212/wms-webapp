// PHIÊN CŨ HẾT HIỆU LỰC KHI ĐỔI MẬT KHẨU (19/11 — user: "đổi pass Hà Thị Thu Hương nhưng mà đăng nhập cũ vẫn được").
// Token JWT không trạng thái + /auth/me cấp token MỚI mỗi lần làm mới ⇒ trước đây phiên mở trước lần đổi mật khẩu sống mãi.
// Mốc `Employee.password_changed_at` do trigger DB đặt (migration 20261119c). Test: backend/tests/unit/sessionAge.test.ts.
import { utcMs } from './dates'

/** Token phát TRƯỚC lần đổi mật khẩu cuối ⇒ phải đăng nhập lại.
 *  `iat` của JWT tính bằng GIÂY (làm tròn xuống) ⇒ so theo giây: token phát CÙNG giây với lần đổi vẫn được — đó là token
 *  mới của chính người vừa tự đổi (cấp ngay sau khi ghi). Chưa từng đổi / token không có iat ⇒ không chặn. */
export function tokenBeforePasswordChange(iat: number | null | undefined, passwordChangedAt: unknown): boolean {
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return false
  const ms = utcMs(passwordChangedAt)
  if (!Number.isFinite(ms)) return false
  return iat < Math.floor(ms / 1000)
}

export const PASSWORD_CHANGED_MSG = 'Mật khẩu tài khoản đã được đổi — đăng nhập lại bằng mật khẩu mới'
