// CẬP NHẬT ỨNG DỤNG — lấy bản mới nhất về máy (user yêu cầu 30/07).
// Vì sao cần: app là PWA, service worker giữ bản đã tải để mở được khi mất mạng. Deploy mới
// thì SW cập nhật NGẦM, nhưng TAB ĐANG MỞ vẫn chạy bản cũ tới khi tải lại — dẫn tới cảnh
// "giao diện cũ + backend mới" (sự cố 30/07: người quét không thấy ô chọn vị trí mà server
// vẫn đòi). Nay: app TỰ SO phiên bản với server và cho người dùng bấm cập nhật ngay.
//
// So bằng SHA commit: FE nhúng lúc build (__BUILD_SHA__), BE trả ở GET /api/version.
// Cùng 1 deploy Vercel ⇒ 2 giá trị phải KHỚP; lệch = máy đang giữ bản cũ.

/** SHA commit của bản FE đang chạy ('local' khi chạy máy dev → không bao giờ báo lệch). */
export const APP_BUILD_SHA: string = __BUILD_SHA__

export function isLocalBuild(): boolean {
  return !APP_BUILD_SHA || APP_BUILD_SHA === 'local'
}

/** SHA bản MỚI NHẤT trên server (null nếu không đọc được — mất mạng/chạy local). */
export async function fetchServerSha(): Promise<string | null> {
  try {
    // no-store: không để chính câu hỏi "có bản mới không" bị cache trả lời bằng bản cũ
    const r = await fetch('/api/version', { cache: 'no-store' })
    if (!r.ok) return null
    const j = await r.json() as { sha?: string | null }
    return j?.sha ? String(j.sha).slice(0, 8) : null
  } catch { return null }
}

/** Có bản mới hơn bản đang chạy không. */
export async function hasNewVersion(): Promise<boolean> {
  if (isLocalBuild()) return false
  const sha = await fetchServerSha()
  return !!sha && sha !== APP_BUILD_SHA
}

/**
 * Ép lấy bản mới: gỡ service worker + xoá toàn bộ cache tĩnh rồi tải lại.
 * Mạnh tay hơn Ctrl+R (điện thoại không có Ctrl+Shift+R) nhưng KHÔNG đụng dữ liệu người dùng:
 * hàng đợi quét offline nằm ở IndexedDB, không nằm trong Cache Storage.
 */
export async function forceUpdateApp(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch { /* gỡ cache lỗi cũng vẫn tải lại — bản mới thường về sau 1-2 lần tải */ }
  // reload() sau khi đã gỡ SW: request đi thẳng ra mạng, không qua bộ nhớ đệm của SW nữa
  window.location.reload()
}
