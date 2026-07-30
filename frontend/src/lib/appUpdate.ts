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

// Cờ LEO THANG (theo tab): lần bấm trước đã thử đường nhanh mà máy VẪN cũ → lần bấm sau
// mới dọn sạch. Đặt ở sessionStorage để sống qua reload nhưng không dính sang phiên khác.
const DEEP_KEY = 'app-update-deep'

/** Máy đã đúng bản mới → quên cờ leo thang (lần bấm tới lại bắt đầu từ đường nhanh). */
export function clearDeepUpdateFlag(): void {
  try { sessionStorage.removeItem(DEEP_KEY) } catch { /* chế độ riêng tư chặn storage */ }
}

/** Dọn SẠCH: gỡ service worker + xoá toàn bộ Cache Storage. Chỉ dùng khi đường nhanh bó tay. */
async function wipeCaches(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch { /* dọn lỗi cũng vẫn tải lại — bản mới thường về sau 1-2 lần tải */ }
}

/**
 * Lấy bản mới về máy. HAI TỐC ĐỘ — user báo 30/07: bấm nút phải chờ 30-40s.
 *
 * Vì sao chậm: bản cũ của hàm này XOÁ SẠCH Cache Storage, nên service worker phải nạp lại
 * TOÀN BỘ gói precache (~5,1MB: cả three.js 720KB cho sơ đồ xếp xe 3D và thư viện Excel
 * 492KB — những thứ người quét kho có thể không mở lần nào). Trên 4G trong kho, 5MB ≈ 30-40s.
 * Mà xoá sạch là THỪA: tên file có mã băm nội dung, deploy mới chỉ đổi vài chunk — phần còn
 * lại vẫn dùng được nguyên.
 *
 * 1) ĐƯỜNG NHANH (mặc định): bảo service worker tự kiểm tra bản mới. Nó chỉ tải ĐÚNG những
 *    file đã đổi rồi tự thay ca (SW build với skipWaiting), xong mới tải lại trang.
 * 2) DỌN SÂU (chỉ khi lần bấm trước không ăn thua): xoá sạch như cũ — vẫn giữ làm lối thoát
 *    cho trường hợp cache hỏng.
 *
 * KHÔNG đụng dữ liệu người dùng ở cả hai đường: hàng đợi quét offline nằm ở IndexedDB.
 */
export async function forceUpdateApp(): Promise<void> {
  let deep = false
  try { deep = sessionStorage.getItem(DEEP_KEY) === '1' } catch { /* storage bị chặn → luôn đi đường nhanh */ }

  if (deep) {
    clearDeepUpdateFlag()
    await wipeCaches()
  } else {
    try { sessionStorage.setItem(DEEP_KEY, '1') } catch { /* không lưu được thì thôi */ }
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      if (reg) {
        // update() chỉ resolve SAU KHI service worker mới cài xong (tức là các file đổi đã về máy)
        await reg.update()
        // Phòng khi SW cũ còn giữ ca (build không bật skipWaiting): thúc nó nhường chỗ
        reg.waiting?.postMessage({ type: 'SKIP_WAITING' })
      }
    } catch { /* không có SW (trình duyệt cũ / chạy local) → reload thường là đủ */ }
  }
  window.location.reload()
}
