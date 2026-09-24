// "VỀ NƠI VỪA RỜI" — điểm neo cho trang giao việc (Việc cần làm), 14/09.
//
// Vì sao: mọi dòng Hộp việc và nút "Mở trang chuyến" là link thẳng sang trang chuyên môn (chuyến ·
// lệnh fill · kế hoạch Slotting · Quy định date · Chuyển kho). Mũi tên quay lại của các trang chi tiết
// đi về DANH SÁCH của module đó (viết cứng theo cây menu), trang danh sách thì không có nút nào; PDA
// chạy dạng ứng dụng cài đặt không có nút back trình duyệt ⇒ đường về duy nhất là mở menu tìm lại.
// Xe nâng đứng giữa kho mất ba nhát bấm để về chỗ vừa đứng — màn "giao mọi việc" mà đi ra được
// không về được thì chưa phải điểm neo.
//
// Cách làm: MỘT chỗ (Shell) hiện thanh "‹ Về Việc cần làm" khi có điểm neo, đủ cho mọi trang đích
// kể cả trang không có nút back. Trang chi tiết muốn mũi tên của mình tôn trọng nơi xuất phát thì
// gọi `backTarget(mặc_định)`. Điểm neo TẮT khi: bấm thanh · về đúng đường dẫn neo · đi bằng menu
// (Sidebar / BottomNav / MobileNav gọi `clearReturnTo`) · quá 4 giờ (ca làm việc đã đổi).
const KEY = 'wms-return-to'
const TTL_MS = 4 * 60 * 60_000
const EVT = 'wms-return-to-change'

export interface ReturnTo { to: string; label: string; at: number }

function read(): ReturnTo | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as ReturnTo
    if (!v?.to || Date.now() - (v.at ?? 0) > TTL_MS) { sessionStorage.removeItem(KEY); return null }
    return v
  } catch { return null }
}
function notify() { try { window.dispatchEvent(new Event(EVT)) } catch { /* SSR/test */ } }

export function setReturnTo(to: string, label: string): void {
  try { sessionStorage.setItem(KEY, JSON.stringify({ to, label, at: Date.now() } satisfies ReturnTo)) } catch { /* private mode */ }
  notify()
}
export function clearReturnTo(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
  notify()
}
export function getReturnTo(): ReturnTo | null { return read() }
/** Ảnh chụp THÔ (chuỗi) cho useSyncExternalStore — trả object mới mỗi lần là vòng render vô hạn. */
export function getReturnToRaw(): string | null {
  try { return read() ? sessionStorage.getItem(KEY) : null } catch { return null }
}
/** Đích cho mũi tên quay lại của trang chi tiết: nơi xuất phát nếu có, không thì đường mặc định. */
export function backTarget(fallback: string): string { return read()?.to ?? fallback }

export function subscribeReturnTo(cb: () => void): () => void {
  window.addEventListener(EVT, cb)
  window.addEventListener('storage', cb)
  return () => { window.removeEventListener(EVT, cb); window.removeEventListener('storage', cb) }
}
