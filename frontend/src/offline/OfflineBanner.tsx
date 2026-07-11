import { useEffect, useRef, useState } from 'react'
import { WifiOff, Wifi } from 'lucide-react'
import { useOnline } from './useOnline'

// Banner toàn cục báo trạng thái mạng — đặt ngay dưới Header (Shell.tsx).
// Offline: dải amber cố định. Online lại: dải xanh "Đã kết nối lại" tự ẩn sau 3s.
export function OfflineBanner() {
  const online = useOnline()
  const [justReconnected, setJustReconnected] = useState(false)
  const wasOffline = useRef(false)

  useEffect(() => {
    if (!online) {
      wasOffline.current = true
      setJustReconnected(false)
      return
    }
    if (wasOffline.current) {
      wasOffline.current = false
      setJustReconnected(true)
      const t = setTimeout(() => setJustReconnected(false), 3000)
      return () => clearTimeout(t)
    }
  }, [online])

  if (!online) {
    return (
      <div className="flex items-center gap-2 bg-amber-500 px-3 py-1.5 text-[11px] font-medium text-white shrink-0">
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
        <span>Mất kết nối mạng — đang hiển thị dữ liệu đã lưu; thao tác ghi sẽ không thực hiện được.</span>
      </div>
    )
  }
  if (justReconnected) {
    return (
      <div className="flex items-center gap-2 bg-green-600 px-3 py-1.5 text-[11px] font-medium text-white shrink-0">
        <Wifi className="h-3.5 w-3.5 shrink-0" />
        <span>Đã kết nối lại — đang làm mới dữ liệu…</span>
      </div>
    )
  }
  return null
}
