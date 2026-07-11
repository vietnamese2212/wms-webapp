import { useSyncExternalStore } from 'react'

// Trạng thái online/offline của trình duyệt (navigator.onLine + event online/offline).
// Lưu ý: onLine=false là CHẮC CHẮN offline; onLine=true chỉ là "có kết nối mạng cục bộ"
// (wifi dính AP nhưng không có internet vẫn true) — trường hợp đó request sẽ tự fail
// ERR_NETWORK/timeout và đi đường xử lý lỗi thường.
function subscribe(cb: () => void): () => void {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}
