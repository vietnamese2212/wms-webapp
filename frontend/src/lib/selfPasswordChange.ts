// Máy đang TỰ đổi mật khẩu (19/11): tín hiệu "đá phiên" (kênh realtime cá nhân) có thể tới TRƯỚC khi máy này kịp lưu token
// mới server vừa trả ⇒ kiểm lại phiên bằng token cũ ⇒ tự đá chính mình. Trang Cài đặt bật cờ trong lúc gửi; Shell chờ cờ tắt.
let busy = false
export function markSelfPasswordChange(on: boolean): void { busy = on }
export async function waitSelfPasswordChangeIdle(maxMs = 20_000): Promise<void> {
  const t0 = Date.now()
  while (busy && Date.now() - t0 < maxMs) await new Promise(r => setTimeout(r, 300))
}
