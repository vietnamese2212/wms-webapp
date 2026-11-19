// Máy đang TỰ đổi mật khẩu (19/11): tín hiệu "đá phiên" (kênh realtime cá nhân) tới mọi tab của người đó — có thể TRƯỚC khi tab
// đang đổi kịp lưu token mới server vừa trả ⇒ tab đó (và tab khác cùng trình duyệt, đọc chung localStorage) kiểm lại phiên bằng
// token cũ ⇒ tự đá mình, còn xoá luôn token mới. Cờ nằm ở localStorage để MỌI tab cùng trình duyệt thấy; quá 20 giây coi như hết.
const KEY = 'wms-pwd-changing'
const MAX_MS = 20_000
export function markSelfPasswordChange(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, String(Date.now())); else localStorage.removeItem(KEY) } catch { /* bộ nhớ bị chặn — bỏ qua */ }
}
function busy(): boolean {
  try { const t = Number(localStorage.getItem(KEY)); return Number.isFinite(t) && t > 0 && Date.now() - t < MAX_MS } catch { return false }
}
export async function waitSelfPasswordChangeIdle(): Promise<void> {
  const t0 = Date.now()
  while (busy() && Date.now() - t0 < MAX_MS) await new Promise(r => setTimeout(r, 300))
}
